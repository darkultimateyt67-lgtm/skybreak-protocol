import { FIREBASE_CONFIG, DEFAULT_MAX_PLAYERS } from './config.js';
import { deviceInfo } from './device.js';

/** Seconds between live updates while someone is playing. */
const HEARTBEAT = 20;
/** Past this, a slow or unreachable server lets the player in rather than block them. */
const JOIN_TIMEOUT_MS = 7000;

/**
 * Online — the player limit, play statistics and staff roles.
 *
 * Everything here is optional. With no Firebase config, or with the server
 * unreachable, the game behaves exactly as it always has: a broken backend
 * must never stop anyone playing.
 *
 * The database connection is only held while someone is actually in a game
 * (from DEPLOY until they return to the menu). Firebase's free plan allows
 * 100 simultaneous connections, and visitors idling on the menu would
 * otherwise use them up.
 *
 * Roles:
 *   creator — sees everything, sets the player limit, grants roles; models
 *             they place are saved into the game for everyone.
 *   admin   — in-game powers and read-only stats; their models only last
 *             for themselves, until they reload.
 *   player  — anonymous, counted against the limit.
 */
export class Online {
  constructor(game) {
    this.game = game;
    this.enabled = !!FIREBASE_CONFIG;
    this.role = null;
    this.user = null;
    this.uid = null;
    this.maxPlayers = DEFAULT_MAX_PLAYERS;
    this.slotRef = null;
    this.liveRef = null;
    this.sessionRef = null;
    this.playing = false;
    this._boot = null;
    this._onRole = new Set();
    this._beatTimer = 0;
    this._holds = 0;
  }

  get isStaff() { return this.role === 'creator' || this.role === 'admin'; }
  get isCreator() { return this.role === 'creator'; }

  /** Called whenever the signed-in account or its role changes. */
  onRole(fn) {
    this._onRole.add(fn);
    return () => this._onRole.delete(fn);
  }

  // ------------------------------------------------------------------ setup

  /** Load the SDK and sign in. No database connection is held afterwards. */
  boot() {
    if (!this.enabled) return Promise.resolve(false);
    if (!this._boot) {
      this._boot = this._doBoot().catch((e) => {
        console.warn('[online] unavailable, playing offline:', e);
        this.enabled = false;
        return false;
      });
    }
    return this._boot;
  }

  async _doBoot() {
    const [appMod, A, D] = await Promise.all([
      import('firebase/app'), import('firebase/auth'), import('firebase/database')
    ]);
    this.A = A;
    this.D = D;
    this.app = appMod.initializeApp(FIREBASE_CONFIG);
    this.auth = A.getAuth(this.app);
    this.db = D.getDatabase(this.app);
    D.goOffline(this.db);
    await this.auth.authStateReady();
    // Players are anonymous; staff stay signed in with Google between visits.
    if (!this.auth.currentUser) await A.signInAnonymously(this.auth);
    await this._loadUser();
    return true;
  }

  /** Hold the connection open for the duration of `fn`. */
  async _connected(fn) {
    this._holds++;
    this.D.goOnline(this.db);
    try {
      return await fn();
    } finally {
      this._holds--;
      if (this._holds === 0 && !this.playing) this.D.goOffline(this.db);
    }
  }

  async _loadUser() {
    const { D } = this;
    this.user = this.auth.currentUser;
    this.uid = this.user.uid;
    this.role = null;
    if (!this.user.isAnonymous) {
      await this._connected(async () => {
        const mine = D.ref(this.db, 'roles/' + this.uid);
        this.role = (await D.get(mine)).val();
        // The very first staff sign-in, while nobody holds a role, becomes
        // the first creator. The database rules allow exactly this and
        // nothing else; every later role is granted by a creator.
        if (!this.role) {
          const any = await D.get(D.ref(this.db, 'roles'));
          if (!any.exists()) {
            await D.set(mine, 'creator');
            this.role = 'creator';
          }
        }
        // Listed for the creators, so they can see who to grant a role to.
        await D.update(D.ref(this.db, 'users/' + this.uid), {
          name: this.user.displayName || '',
          email: this.user.email || '',
          lastSeen: D.serverTimestamp()
        });
      });
    }
    for (const fn of this._onRole) fn(this.role);
  }

  // ------------------------------------------------------------ staff login

  async staffSignIn() {
    if (!(await this.boot())) throw new Error('Online features are not set up yet.');
    const { A } = this;
    await A.signInWithPopup(this.auth, new A.GoogleAuthProvider());
    await this._loadUser();
    return this.role;
  }

  async staffSignOut() {
    if (!this.enabled) return;
    const { A } = this;
    await A.signOut(this.auth);
    await A.signInAnonymously(this.auth);
    await this._loadUser();
  }

  // ----------------------------------------------------------- play session

  /**
   * Called on DEPLOY. Resolves { ok: true } to let the player in, or
   * { ok: false, full: true, max } when every slot is taken. Staff are never
   * turned away. Any failure lets the player in.
   */
  async join() {
    if (!(await this.boot())) return { ok: true };
    if (this.playing) return { ok: true };
    const attempt = this._join();
    const timeout = new Promise((res) => setTimeout(() => res({ ok: true, late: true }), JOIN_TIMEOUT_MS));
    const r = await Promise.race([attempt, timeout]);
    if (r.late) attempt.catch(() => {});
    return r;
  }

  async _join() {
    const { D } = this;
    this.playing = true;
    D.goOnline(this.db);
    try {
      const cfg = (await D.get(D.ref(this.db, 'config'))).val() || {};
      this.maxPlayers = cfg.maxPlayers || DEFAULT_MAX_PLAYERS;
      if (!this.isStaff && !(await this._claimSlot())) {
        this.playing = false;
        D.goOffline(this.db);
        return { ok: false, full: true, max: this.maxPlayers };
      }
      await this._startSession();
      return { ok: true };
    } catch (e) {
      console.warn('[online] join failed, playing anyway:', e);
      return { ok: true };
    }
  }

  /** Take one of the numbered player slots. Freed by the server if the tab closes. */
  async _claimSlot() {
    const { D } = this;
    const taken = (await D.get(D.ref(this.db, 'slots'))).val() || {};
    const n = this.maxPlayers;
    const start = Math.floor(Math.random() * n);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (taken[i]) continue;
      const ref = D.ref(this.db, 'slots/' + i);
      const res = await D.runTransaction(ref, (cur) => (cur ? undefined : this.uid), { applyLocally: false });
      if (res.committed && res.snapshot.val() === this.uid) {
        await D.onDisconnect(ref).remove();
        this.slotRef = ref;
        return true;
      }
    }
    return false;
  }

  _callsign() {
    const c = this.game.settings.career;
    return ((c && c.name) || 'VECTOR').slice(0, 16);
  }

  _snapshot() {
    const g = this.game;
    return {
      callsign: this._callsign(),
      mode: g.settings.mode || '',
      map: g.settings.map || '',
      state: g.state || '',
      fps: g.fps || 0,
      quality: g.settings.quality || '',
      score: g.score || 0,
      kills: g.kills || 0,
      credits: g.credits || 0,
      role: this.role || 'player'
    };
  }

  async _startSession() {
    const { D } = this;
    const now = D.serverTimestamp();
    this.device = this.device || deviceInfo(this.game.renderer);
    const snap = this._snapshot();

    this.liveRef = D.ref(this.db, 'live/' + this.uid);
    await D.onDisconnect(this.liveRef).remove();
    await D.set(this.liveRef, { ...snap, device: this.device, startedAt: now, lastBeat: now });

    this.sessionRef = D.push(D.ref(this.db, 'sessions'));
    await D.set(this.sessionRef, {
      uid: this.uid, callsign: snap.callsign, mode: snap.mode, map: snap.map,
      role: snap.role, device: this.device, start: now
    });
    await D.onDisconnect(D.child(this.sessionRef, 'end')).set(now);

    const player = D.ref(this.db, 'players/' + this.uid);
    await D.runTransaction(D.child(player, 'firstSeen'), (cur) => cur || Date.now());
    await D.update(player, {
      callsign: snap.callsign, lastSeen: now, sessions: D.increment(1),
      device: this.device, lastMode: snap.mode, lastMap: snap.map, role: snap.role
    });
    this.playerRef = player;

    this._lastBeat = performance.now();
    clearInterval(this._beatTimer);
    this._beatTimer = setInterval(() => this._beat(), HEARTBEAT * 1000);
  }

  _beat() {
    if (!this.playing || !this.liveRef) return;
    const { D } = this;
    const now = performance.now();
    const secs = Math.round((now - this._lastBeat) / 1000);
    this._lastBeat = now;
    const snap = this._snapshot();
    const g = this.game;
    D.update(this.liveRef, { ...snap, lastBeat: D.serverTimestamp() }).catch(() => {});
    D.update(this.sessionRef, {
      seconds: D.increment(secs), score: snap.score, kills: snap.kills,
      fps: snap.fps, mode: snap.mode, map: snap.map
    }).catch(() => {});
    D.update(this.playerRef, {
      lastSeen: D.serverTimestamp(), totalSeconds: D.increment(secs),
      callsign: snap.callsign, lastMode: snap.mode, lastMap: snap.map,
      lastFps: snap.fps, quality: snap.quality,
      bestScore: Math.max(g.score || 0, this._best || 0)
    }).catch(() => {});
    this._best = Math.max(g.score || 0, this._best || 0);
  }

  /** Back to the menu: close the session, free the slot, drop the connection. */
  async leave() {
    if (!this.enabled || !this.playing) return;
    const { D } = this;
    clearInterval(this._beatTimer);
    try {
      if (this.liveRef) this._beat();
      const now = D.serverTimestamp();
      const ops = [];
      if (this.sessionRef) {
        ops.push(D.set(D.child(this.sessionRef, 'end'), now));
        ops.push(D.onDisconnect(D.child(this.sessionRef, 'end')).cancel());
      }
      if (this.liveRef) {
        ops.push(D.remove(this.liveRef));
        ops.push(D.onDisconnect(this.liveRef).cancel());
      }
      if (this.slotRef) {
        ops.push(D.remove(this.slotRef));
        ops.push(D.onDisconnect(this.slotRef).cancel());
      }
      await Promise.all(ops);
    } catch (e) {
      console.warn('[online] leave:', e);
    }
    this.liveRef = this.sessionRef = this.slotRef = null;
    this.playing = false;
    if (this._holds === 0) D.goOffline(this.db);
  }

  // ------------------------------------------------------ creator-placed models

  /** Models a creator has saved into this map, for everyone. */
  async worldModels(mapId) {
    if (!(await this.boot())) return [];
    const { D } = this;
    return this._connected(async () => {
      const v = (await D.get(D.ref(this.db, 'world/' + mapId))).val() || {};
      return Object.entries(v).map(([id, m]) => ({ id, ...m }));
    });
  }

  async saveWorldModel(mapId, model) {
    if (!this.isCreator) throw new Error('Only creators can save models into the game.');
    const { D } = this;
    return this._connected(async () => {
      const ref = D.push(D.ref(this.db, 'world/' + mapId));
      await D.set(ref, { ...model, by: this.user.displayName || this.user.email || this.uid, at: D.serverTimestamp() });
      return ref.key;
    });
  }

  async deleteWorldModel(mapId, id) {
    if (!this.isCreator) throw new Error('Only creators can remove saved models.');
    const { D } = this;
    return this._connected(() => D.remove(D.ref(this.db, `world/${mapId}/${id}`)));
  }
}
