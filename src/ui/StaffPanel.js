import { State } from '../engine/Game.js';

/**
 * The in-game staff panel (F9, or STAFF on the menu).
 *
 * Signed-out it is a Google sign-in. Signed in as an admin or creator it
 * holds the powers — fly, god mode, endless ammo, credits, teleport, cars —
 * and model placement. Creators' models are saved into the game for every
 * player; admins' last only until they reload.
 */
export class StaffPanel {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = document.createElement('div');
    this.el.id = 'staff';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this.el.addEventListener('keydown', (e) => e.stopPropagation());

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F9') return;
      if (!game.online.enabled) return;
      e.preventDefault();
      this.toggle();
    });
    game.online.onRole(() => {
      if (!game.online.isStaff) Object.assign(game.admin, { fly: false, god: false, ammo: false });
      this._syncMenuButton();
      if (this.open) this.render();
    });
    this._syncMenuButton();
  }

  _syncMenuButton() {
    const b = document.getElementById('btn-staff');
    if (b) b.classList.toggle('hidden', !this.game.online.enabled);
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const g = this.game;
    this.open = true;
    // In a game: pause without the pause menu, and free the mouse to click.
    if (g.state === State.PLAYING) {
      this._resumeOnClose = true;
      g.state = State.PAUSED;
      g.input.unlock();
    }
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
    if (this._resumeOnClose) {
      this._resumeOnClose = false;
      this.game.resume();
    }
  }

  _msg(text, bad = false) {
    const m = this.el.querySelector('.st-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  }

  render() {
    const g = this.game;
    const o = g.online;
    const inGame = g.state !== State.MENU;
    const title = o.isCreator ? 'CREATOR PANEL' : o.isStaff ? 'ADMIN PANEL' : 'STAFF SIGN-IN';
    const who = o.user && !o.user.isAnonymous ? (o.user.displayName || o.user.email) : '';
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let body = '';
    if (!o.isStaff) {
      body = `
        <p class="st-note">${who
          ? `Signed in as <b>${esc(who)}</b>, but this account has no staff role yet. Ask a creator to grant you one in the dashboard.`
          : 'Staff only. Sign in with the Google account a creator gave a role to.'}</p>
        <div class="st-row">
          ${who ? '<button data-a="signout">SIGN OUT</button>' : '<button class="st-main" data-a="signin">SIGN IN WITH GOOGLE</button>'}
        </div>`;
    } else {
      const a = g.admin;
      const tog = (k, label) => `<button class="st-tog ${a[k] ? 'on' : ''}" data-t="${k}">${label}: ${a[k] ? 'ON' : 'OFF'}</button>`;
      const gtaz = g.isGTAZ && g.freeRoam && g.freeRoam.city;
      const models = (g.placed._world === g.world ? g.placed.items : []).map((it, i) => `
        <div class="st-model">
          <span>${esc(it.data.name || 'model')}${it.saved ? ' <em>saved</em>' : ' <em>only you</em>'}</span>
          <button data-del="${i}">REMOVE</button>
        </div>`).join('');
      body = `
        <p class="st-note">Signed in as <b>${esc(who)}</b> · ${o.isCreator ? 'creator' : 'admin'}
          · <a href="#" data-a="signout">sign out</a> · <a href="admin.html" target="_blank" rel="noopener">player dashboard ↗</a></p>
        ${inGame ? `
        <div class="st-h">POWERS</div>
        <div class="st-grid">
          ${tog('fly', 'FLY')}${tog('god', 'GOD MODE')}${tog('ammo', 'ENDLESS AMMO')}
          <button data-a="heal">HEAL + REFILL</button>
          <button data-a="credits">+10,000 CREDITS</button>
          <button data-a="spawn">TELEPORT TO SPAWN</button>
          ${gtaz ? '<button data-a="car">SPAWN A CAR</button><button data-a="wanted">CLEAR WANTED</button>' : ''}
        </div>
        <p class="st-note small">FLY: WASD to move, SPACE up, CTRL down, SHIFT fast.</p>
        <div class="st-h">MODELS FROM THE INTERNET</div>
        <p class="st-note small">Paste a direct link to a <b>.glb</b> or <b>.gltf</b> file. It appears 8 m in front of you.
          ${o.isCreator ? '<b>Creator: it is saved into this map for every player.</b>' : 'Admin: only you will see it, until you reload.'}</p>
        <div class="st-row">
          <input class="st-url" placeholder="https://…/model.glb" spellcheck="false" />
          <input class="st-scale" type="number" min="0.01" max="500" step="0.1" value="1" title="Scale" />
          <label class="st-solid"><input type="checkbox" checked /> solid</label>
          <button class="st-main" data-a="place">PLACE</button>
        </div>
        <div class="st-models">${models || '<p class="st-note small">No models in this map yet.</p>'}</div>
        ` : '<p class="st-note">Deploy into a game to use your powers and place models. Press <b>F9</b> in game to open this panel.</p>'}`;
    }

    this.el.innerHTML = `
      <div class="st-card">
        <div class="st-top"><b>${title}</b><button class="st-x" data-a="close">✕</button></div>
        ${body}
        <div class="st-msg"></div>
      </div>`;
    this.el.onclick = (e) => this._click(e);
  }

  async _click(e) {
    const t = e.target.closest('button, a');
    if (!t) return;
    const g = this.game;
    const o = g.online;
    if (t.tagName === 'A' && !t.dataset.a) return;   // ordinary link
    e.preventDefault();
    const act = t.dataset.a;
    try {
      if (act === 'close') return this.close();
      if (act === 'signin') {
        this._msg('Opening Google sign-in…');
        await o.staffSignIn();
        return this.render();
      }
      if (act === 'signout') {
        await o.staffSignOut();
        return this.render();
      }
      if (t.dataset.t) {
        g.admin[t.dataset.t] = !g.admin[t.dataset.t];
        if (t.dataset.t === 'fly' && g.admin.fly) g.player.velocity.set(0, 0, 0);
        return this.render();
      }
      if (t.dataset.del !== undefined) {
        const item = g.placed.items[+t.dataset.del];
        if (item) await g.placed.remove(item);
        return this.render();
      }
      const p = g.player;
      if (act === 'heal') {
        p.health = p.maxHealth ?? 100;
        p.armor = p.maxArmor ?? p.armor;
        const w = g.weapons.current;
        if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; }
        this._msg('Health, plate and ammo refilled.');
      } else if (act === 'credits') {
        g.addCredits(10000);
        this._msg('+10,000 credits.');
      } else if (act === 'spawn') {
        p.position.copy(g.world.playerSpawn);
        p.velocity.set(0, 0, 0);
        this._msg('Back at the spawn point.');
      } else if (act === 'car') {
        const car = g.freeRoam.spawnCarNear(p.position, p.yaw);
        this._msg(car ? `${car.name || 'Car'} delivered in front of you. Press F next to it.` : 'No road here.');
      } else if (act === 'wanted') {
        g.freeRoam.wanted?.reset?.();
        this._msg('Police called off.');
      } else if (act === 'place') {
        const url = this.el.querySelector('.st-url').value.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) return this._msg('Paste a full https:// link to a .glb or .gltf file.', true);
        const scale = parseFloat(this.el.querySelector('.st-scale').value) || 1;
        const solid = this.el.querySelector('.st-solid input').checked;
        this._msg('Downloading the model…');
        await g.placed.placeInFront({ url, scale, solid }, o.isCreator);
        this.render();
        this._msg(o.isCreator ? 'Placed and saved into this map for everyone.' : 'Placed. Only you can see it.');
      }
    } catch (err) {
      const text = String(err && err.message || err);
      this._msg(/Failed to fetch|CORS|NetworkError|404/i.test(text)
        ? 'Could not download that model. The link must point straight at a .glb/.gltf file on a site that allows it (for example a GitHub raw link).'
        : text, true);
    }
  }
}
