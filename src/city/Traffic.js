import * as THREE from 'three';
import { Vehicle } from './Vehicles.js';
import { Crowd } from './Crowd.js';
import { ROAD_W } from './City.js';

/**
 * Traffic and pedestrians — the ambient life of GTAZ.
 *
 * Both drive off the city's road graph rather than free-roaming, because the
 * illusion depends entirely on things using the streets correctly: cars in the
 * right-hand lane, people on the pavement, everyone stopping at the thing in
 * front of them. A crowd wandering across the tarmac reads as broken instantly.
 *
 * Population is CULLED BY DISTANCE and recycled. Simulating a whole city's
 * worth of agents would cost more than the rest of the frame put together, so
 * a fixed pool is kept near the player and quietly teleported around the far
 * side of the map as they fall behind. What's off screen doesn't exist.
 */

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _bz = { x: 0, z: 0, tx: 0, tz: 0 };
/** Metres either side of a junction that a corner is spread over. */
const TURN_R = 11;

// Skin, hair, clothing and shoe palettes moved into Crowd with the rest of
// the wardrobe, so one place decides what a person looks like.

export class Traffic {
  constructor(city, opts = {}) {
    this.city = city;
    this.game = city.game;
    this.carCount = opts.cars ?? 26;
    this.pedCount = opts.peds ?? 40;
    this.cars = [];
    this.peds = [];
    this.recycleDist = opts.recycleDist ?? 420;
    this.spawnRing = opts.spawnRing ?? 300;
  }

  build() {
    for (let i = 0; i < this.carCount; i++) this.cars.push(this._makeCar());
    // Patrol cars. Without these the city has no police at all until you
    // commit a crime, which reads as there being no law rather than as law
    // you haven't provoked yet — you should see a cruiser go past and think
    // twice, not summon one out of nothing by misbehaving.
    // No cruisers at all in FUN unless its police toggle is on.
    const policeOn = !this.game.rules || this.game.rules.police !== false;
    const patrols = policeOn ? Math.max(2, Math.round(this.carCount * 0.09)) : 0;
    for (let i = 0; i < patrols; i++) {
      const ai = this._makeCar('sedan', { police: true });
      ai.cruise = 11 + Math.random() * 6;
      ai.isPatrol = true;
      this.cars.push(ai);
    }
    this.patrolCount = patrols;
    this._buildPeds();
  }

  // ------------------------------------------------------------------- cars

  _makeCar(styleId = null, opts = {}) {
    const c = this.city;
    const n = c.nodes[(Math.random() * c.nodes.length) | 0];
    const to = n.links[(Math.random() * n.links.length) | 0] || n;
    const v = new Vehicle(c, n.x, n.z, styleId, opts);
    v.driver = 'ai';
    const ai = {
      car: v, from: n, to, t: Math.random(),
      cruise: 12 + Math.random() * 10,
      panic: 0
    };
    this._placeOnEdge(ai);
    return ai;
  }

  /** Put a car at its current point along the from->to edge, in the right lane. */
  _placeOnEdge(ai) {
    const { from, to, t } = ai;
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    // Right-hand lane: offset perpendicular, to the right of travel.
    const off = ROAD_W * 0.25;
    ai.car.position.set(
      from.x + dx * t + nz * off,
      0,
      from.z + dz * t - nx * off
    );
    ai.car.yaw = Math.atan2(-nx, -nz);
    ai.car.syncMesh();
  }

  _chooseNext(ai) {
    const opts = ai.to.links.filter((n) => n !== ai.from);
    return opts.length ? opts[(Math.random() * opts.length) | 0] : ai.from;
  }

  /** A point in the right-hand lane, s metres along from -> to. */
  _lanePoint(from, to, s) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    const off = ROAD_W * 0.25;
    return { x: from.x + nx * s + nz * off, z: from.z + nz * s - nx * off, nx, nz };
  }

  /**
   * Plan the corner: a quadratic curve from the lane on this street to the
   * lane on the next, with its control point where the two lane lines cross.
   */
  _beginTurn(ai, len, R, lenB) {
    const next = ai.next || this._chooseNext(ai);
    const p0 = this._lanePoint(ai.from, ai.to, len - R);
    const p2 = this._lanePoint(ai.to, next, R);
    const cross = p0.nx * p2.nz - p0.nz * p2.nx;
    let p1;
    if (Math.abs(cross) > 0.2) {
      const k = ((p2.x - p0.x) * p2.nz - (p2.z - p0.z) * p2.nx) / cross;
      p1 = { x: p0.x + p0.nx * k, z: p0.z + p0.nz * k };
    } else if (p0.nx * p2.nx + p0.nz * p2.nz > 0) {
      p1 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };          // straight on
    } else {
      p1 = { x: ai.to.x + p0.nx * R, z: ai.to.z + p0.nz * R };      // dead end: come round
    }
    const turn = { next, p0, p1, p2, R, lenB, arc: 1, u: 0 };
    let arc = 0;
    let px = p0.x, pz = p0.z;
    for (let k = 1; k <= 12; k++) {
      const q = this._bez(turn, k / 12, _bz);
      arc += Math.hypot(q.x - px, q.z - pz);
      px = q.x; pz = q.z;
    }
    turn.arc = Math.max(0.5, arc);
    ai.turn = turn;
  }

  _bez(tr, u, out) {
    const a = tr.p0, b = tr.p1, c = tr.p2;
    const v = 1 - u;
    out.x = v * v * a.x + 2 * v * u * b.x + u * u * c.x;
    out.z = v * v * a.z + 2 * v * u * b.z + u * u * c.z;
    out.tx = 2 * v * (b.x - a.x) + 2 * u * (c.x - b.x);
    out.tz = 2 * v * (b.z - a.z) + 2 * u * (c.z - b.z);
    return out;
  }

  _steer(car, angle) {
    const a = Math.max(-0.55, Math.min(0.55, angle));
    car.steer = a;
    for (const wl of car.wheels) if (wl.front) wl.mesh.rotation.y = -a;
    if (car.wheelRig) car.wheelRig.rotation.z = -a * 3.4;
    if (car.bikeSteer) car.bikeSteer.rotation.y = -a * 0.8;
  }

  _pickNext(ai) {
    const opts = ai.to.links.filter((n) => n !== ai.from);
    const next = opts.length
      ? opts[(Math.random() * opts.length) | 0]
      : ai.from;
    ai.from = ai.to;
    ai.to = next;
    ai.t = 0;
  }

  updateCars(dt, player) {
    const wanted = this.game.freeRoam ? this.game.freeRoam.wanted : null;
    for (const ai of this.cars) {
      const car = ai.car;
      if (!car.alive) { this._respawnCar(ai, player); continue; }

      // Rolled over: the solver owns it. Putting it back on its lane every
      // frame would drag a tumbling car down the road on its roof, so the
      // path is left alone until it has landed and righted itself.
      if (car.tumbling) { car.updateTumble(dt); continue; }

      // Recycle anything that has fallen too far behind.
      const d = Math.hypot(car.position.x - player.x, car.position.z - player.z);
      if (d > this.recycleDist) { this._respawnCar(ai, player); continue; }

      const dx = ai.to.x - ai.from.x, dz = ai.to.z - ai.from.z;
      const len = Math.hypot(dx, dz) || 1;
      // Where this car is going after the junction, decided as soon as it is
      // on the street, so the corner can be planned before it arrives.
      if (!ai.next) ai.next = this._chooseNext(ai);
      const lenB = Math.hypot(ai.next.x - ai.to.x, ai.next.z - ai.to.z) || 1;
      const turnR = Math.min(TURN_R, len * 0.45, lenB * 0.45);

      // Slow for the car in front, so queues form instead of cars overlapping.
      let target = ai.cruise;
      for (const other of this.cars) {
        if (other === ai || !other.car.alive) continue;
        const od = other.car.position.distanceTo(car.position);
        if (od > 16) continue;
        _v.subVectors(other.car.position, car.position).normalize();
        _a.set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
        if (_v.dot(_a) > 0.72) target = Math.min(target, Math.max(0, (od - 7) * 1.6));
      }
      // Scatter from a live police chase.
      if (wanted && wanted.level > 0) {
        const pd = Math.hypot(car.position.x - player.x, car.position.z - player.z);
        if (pd < 45) target = Math.min(target, 4);
      }

      // --- Stop at the lights -----------------------------------------------
      // Cars slow as they approach the junction they're heading for and hold
      // at the line on red. This is what produces standing queues, which is
      // the point: a stationary car is one you can walk up to and take.
      const axis = this.city.axisOf(ai.from, ai.to);
      const light = this.city.lightAt(ai.to, axis);
      // A car already in the corner is committed and carries on.
      if (light !== 'green' && !ai.turn) {
        const toJunction = len * (1 - ai.t);
        // The line sits before the point the turn begins, or a car could
        // start its corner and then sail through the red.
        const STOP_LINE = Math.max(ROAD_W * 0.6, turnR + 1.5);
        if (toJunction < 34) {
          // Amber means stop unless you're already committed to the junction.
          const mustStop = light === 'red' || toJunction > 12;
          if (mustStop) {
            const room = Math.max(0, toJunction - STOP_LINE);
            target = Math.min(target, room * 0.55);
          }
        }
      }

      // --- A patrol that spots you joins the pursuit -------------------------
      // Far better than conjuring a cruiser out of empty street: the car that
      // comes after you is one you could already see.
      if (ai.isPatrol && wanted && wanted.level > 0) {
        const pd = Math.hypot(car.position.x - player.x, car.position.z - player.z);
        if (pd < 140 && wanted.units.length < 8) {
          const idx = this.cars.indexOf(ai);
          if (idx >= 0) this.cars.splice(idx, 1);
          wanted.adopt(car);
          continue;
        }
        // Lights flash while there's heat, even before they've closed in.
        const t = performance.now() * 0.006;
        if (car.beacons) {
          const f = Math.sin(t) > 0;
          car.beacons[0].emissiveIntensity = f ? 3.2 : 0.25;
          car.beacons[1].emissiveIntensity = f ? 0.25 : 3.2;
        }
      }

      // --- Along the street, then round the corner --------------------------
      // Cars used to be snapped from one road to the next the moment they
      // reached a junction. The lane offset is perpendicular to travel, so a
      // right-angle turn moved the car about six metres sideways and swung it
      // ninety degrees in a single frame — a teleport, every junction, for
      // every car in the city. Now the last few metres of one street and the
      // first few of the next are joined by a curve that the car actually
      // drives, heading along its tangent.
      if (!ai.turn) {
        ai.t += (target * dt) / len;
        const sAlong = ai.t * len;
        if (sAlong >= len - turnR) {
          this._beginTurn(ai, len, turnR, lenB);
          ai.turn.u = Math.min(1, (sAlong - (len - turnR)) / ai.turn.arc);
        }
      } else {
        ai.turn.u += (target * dt) / ai.turn.arc;
      }
      if (ai.turn && ai.turn.u >= 1) {
        const tr = ai.turn;
        const over = (tr.u - 1) * tr.arc;
        ai.from = ai.to;
        ai.to = tr.next;
        ai.t = Math.min(0.95, (tr.R + over) / tr.lenB);
        ai.turn = null;
        ai.next = null;
      }
      if (ai.turn) {
        const q = this._bez(ai.turn, ai.turn.u, _bz);
        const yaw = Math.atan2(-q.tx, -q.tz);
        let dyaw = yaw - car.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        car.position.set(q.x, 0, q.z);
        car.yaw = yaw;
        car.syncMesh();
        // Front wheels and steering wheel follow the corner.
        const omega = dt > 0 ? dyaw / dt : 0;
        const wheelbase = car.style.l * 0.62;
        this._steer(car, -Math.atan((wheelbase * omega) / Math.max(1.5, target)));
      } else {
        this._placeOnEdge(ai);
        this._steer(car, 0);
      }
      car.speed = target;
      car.wheelSpin += target * dt * 2.6;
      for (const wl of car.wheels) (wl.spin || wl.mesh).rotation.x = car.wheelSpin;

      // Traffic follows the road graph kinematically, which used to mean it
      // slid around corners perfectly flat while the player's car leaned. Run
      // the same chassis for the cars close enough to see it on: they lean
      // through the bends, settle on the straights, and ride whatever the
      // road is doing under them.
      if (car.chassis && !car.bike && !car.tumbling) {
        const pd = (car.position.x - player.x) ** 2 + (car.position.z - player.z) ** 2;
        if (pd < 95 * 95) {
          car.chassis.update(dt, 0, false);
          car.position.y = car.chassis.y;
          car.syncMesh();
        }
      }
    }
  }

  /** Move a car to a fresh edge near the player, but out of sight behind them. */
  _respawnCar(ai, player) {
    const c = this.city;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const n = c.nodes[(Math.random() * c.nodes.length) | 0];
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      if (d < 90 || d > this.spawnRing) continue;
      const score = -Math.abs(d - this.spawnRing * 0.7);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (!best) return;
    if (!ai.car.alive) {
      ai.car.dispose();
      ai.car = new Vehicle(c, best.x, best.z, null, {});
      ai.car.driver = 'ai';
    }
    ai.from = best;
    ai.to = best.links[(Math.random() * best.links.length) | 0] || best;
    ai.t = 0;
    ai.turn = null;
    ai.next = null;
    ai.car.health = 100;
    this._placeOnEdge(ai);
  }

  // ------------------------------------------------------------ pedestrians

  _buildPeds() {
    // A pedestrian used to be five boxes with no joints in them. Crowd owns
    // the whole rig now — pelvis, chest, head, hair, jointed arms and legs,
    // shoes and a bag — still as instanced meshes, so the crowd costs about a
    // dozen draw calls rather than five and looks like people rather than
    // furniture. See Crowd.js.
    const N = this.pedCount;
    this.crowd = new Crowd(this.game.scene, N);
    for (let i = 0; i < N; i++) this.peds.push(this._makePed());
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  _makePed() {
    const c = this.city;
    const n = c.nodes[(Math.random() * c.nodes.length) | 0];
    const to = n.links[(Math.random() * n.links.length) | 0] || n;
    return {
      from: n, to, t: Math.random(),
      speed: 1.1 + Math.random() * 0.8,
      phase: Math.random() * 10,
      side: Math.random() > 0.5 ? 1 : -1,
      x: n.x, z: n.z, yaw: 0, flee: 0,
      // Civilians are people, not scenery: they take damage, go down, and
      // stay down until the pool recycles them somewhere else.
      hp: 100, alive: true, downT: 0,
      // Roughly a third of people don't run — they square up. A crowd that
      // only ever flees makes the player feel like they're hitting furniture.
      brave: Math.random() < 0.34,
      aggro: 0, swingCd: 0
    };
  }

  /**
   * Ray against the crowd. Mirrors BattleRoyale.raycast so the weapon system
   * can treat civilians exactly like any other target — the same falloff,
   * headshots, tracers and impact traits all come along for free.
   *
   * Two spheres per person: head and body. A capsule would be more accurate
   * but this is a 44-agent crowd being tested by every pellet of every
   * shotgun blast, and two sphere tests are far cheaper than a capsule solve.
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.peds) {
      if (!p.alive) continue;
      // Cheap reject before the per-part maths.
      const dx = p.x - origin.x, dz = p.z - origin.z;
      if (dx * dx + dz * dz > (bestD + 2) * (bestD + 2)) continue;
      const parts = [
        { y: 1.52, r: 0.19, part: 'head' },
        { y: 1.05, r: 0.36, part: 'body' },
        { y: 0.50, r: 0.30, part: 'legs' }
      ];
      for (const q of parts) {
        _v.set(p.x - origin.x, (q.y) - origin.y, p.z - origin.z);
        const proj = _v.dot(dir);
        if (proj < 0 || proj > bestD) continue;
        const perp2 = _v.lengthSq() - proj * proj;
        if (perp2 > q.r * q.r) continue;
        const hitD = proj - Math.sqrt(Math.max(0, q.r * q.r - perp2));
        if (hitD > 0 && hitD < bestD) {
          bestD = hitD;
          best = {
            dist: hitD, part: q.part, enemy: this._actorFor(p),
            point: new THREE.Vector3().copy(origin).addScaledVector(dir, hitD)
          };
        }
      }
    }
    return best;
  }

  /**
   * Wrap a pedestrian in the small interface the weapon system expects
   * (`position`, `damage()`, `alive`). Cached on the ped so repeated hits in
   * one burst address the same object.
   */
  _actorFor(p) {
    if (p._actor) { p._actor.position.set(p.x, 0, p.z); return p._actor; }
    const traffic = this;
    p._actor = {
      position: new THREE.Vector3(p.x, 0, p.z),
      s: 1,
      get alive() { return p.alive; },
      damage(amount, head, sourceName) {
        traffic.hurtPed(p, amount, head);
      }
    };
    return p._actor;
  }

  /** Living civilians as melee-shaped actors, for the swing search. */
  meleeTargets() {
    const out = [];
    for (const p of this.peds) if (p.alive) out.push(this._actorFor(p));
    return out;
  }

  /**
   * One shared throttle for all crowd audio.
   *
   * Ploughing through a pavement full of people used to fire a hit sound per
   * person per frame. Even a gentle sound stacks into a wall of noise at that
   * rate, so nothing gets to play more than a few times a second no matter
   * how many people are involved.
   */
  _crowdSound(fn) {
    const now = performance.now();
    if (now - (this._lastCrowdSfx || 0) < 130) return;
    this._lastCrowdSfx = now;
    fn();
  }

  /**
   * Apply damage to a civilian. Returns true if this blow killed them.
   * `source` picks the sound: 'vehicle' gets a dull thud, anything else gets
   * the sharp combat hitmarker.
   */
  hurtPed(p, amount, head = false, source = 'weapon', blow = null) {
    if (!p.alive) return false;
    p.hp -= amount * (head ? 2.2 : 1);
    // Brave ones come at you instead of running. Everyone else runs.
    if (p.brave) { p.aggro = 12; p.flee = 0; } else { p.flee = 4.5; }
    // Everyone nearby sees it happen and runs.
    for (const o of this.peds) {
      if (o === p || !o.alive) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) < 22) {
        // Witnesses split the same way: the brave wade in, the rest scatter.
        if (o.brave) o.aggro = Math.max(o.aggro, 9); else o.flee = Math.max(o.flee, 3.5);
      }
    }
    const g = this.game;
    if (g.effects && g.effects.bloodHit) {
      g.effects.bloodHit(_v.set(p.x, head ? 1.5 : 1.05, p.z), _a.set(0, 1, 0), head);
    }
    if (p.hp <= 0) {
      p.alive = false;
      p.downT = 0;
      // Down: hand the body to the solver. Whatever knocked them over lends
      // its momentum; a bullet with no `blow` just drops them where they are.
      if (this.ragdolls) {
        const y = this.city.surfaceAt ? this.city.surfaceAt(p.x, p.z) : 0;
        _v.set(0, 0, 0);
        if (blow && blow.impulse) _v.copy(blow.impulse);
        else if (head) _v.set(0, 1.2, 0);
        p.ragdoll = this.ragdolls.spawn(p.x, y, p.z, _v, p.yaw || 0,
          { spin: blow ? blow.spin : 0.55 });
      }
      const fr = g.freeRoam;
      if (fr && fr.wanted) fr.wanted.commit('killPed');
      this._crowdSound(() => {
        if (source === 'vehicle') g.audio.thud?.();
        else g.audio.hit?.(true);
      });
      return true;
    }
    const fr = g.freeRoam;
    if (fr && fr.wanted) fr.wanted.commit('hitPed', 0.35);
    this._crowdSound(() => {
      if (source === 'vehicle') g.audio.thud?.();
      else g.audio.hit?.(head);
    });
    return false;
  }

  updatePeds(dt, player, threat) {
    const N = this.peds.length;
    if (!N) return;
    const m4 = this._m4, q = this._q, s = this._s;
    const pave = ROAD_W * 0.5 + 2.0;

    for (let i = 0; i < N; i++) {
      const p = this.peds[i];
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > this.recycleDist) { this._respawnPed(p, player); }

      // --- Downed civilians ------------------------------------------------
      // They stop walking, drop to the pavement, and lie there. After a while
      // the pool quietly recycles them somewhere the player isn't looking, so
      // a rampage doesn't permanently empty the streets.
      if (!p.alive) {
        p.downT += dt;
        if (p.downT > 22 && d > 60) { this._respawnPed(p, player); continue; }
        // A real ragdoll if one was allocated: every part is drawn wherever
        // the solver has put it. The fallback below is only reached when every
        // ragdoll in the pool is already in use.
        const rag = p.ragdoll;
        if (rag && rag.live) {
          this.crowd.poseFromRagdoll(i, rag.parts);
          continue;
        }
        // No body to drive them: fold the rig forward and let it lie. Slower
        // than it used to be, because a person who has been knocked down and
        // snaps flat in a third of a second reads as a dropped prop.
        const fall = Math.min(1, p.downT * 1.6);
        p.gait = 0;
        p.phase = 0;
        this.crowd.pose(i, p, this._groundAt(p) - fall * 0.86);
        continue;
      }

      // Panic: gunfire or a wanted level sends people running.
      if (threat > 0 && d < 30) {
        if (p.brave) p.aggro = Math.max(p.aggro, 6); else p.flee = Math.max(p.flee, 2.4);
      }
      p.flee = Math.max(0, p.flee - dt);
      p.aggro = Math.max(0, p.aggro - dt);
      p.swingCd = Math.max(0, p.swingCd - dt);

      // --- Fighting back ----------------------------------------------------
      // An angry civilian abandons the pavement route entirely and comes
      // straight at you. Give up if you get far enough away.
      if (p.aggro > 0 && d < 40) {
        const ang = Math.atan2(player.x - p.x, player.z - p.z);
        const step = 2.6 * dt;
        if (d > 1.5) {
          p.x += Math.sin(ang) * step;
          p.z += Math.cos(ang) * step;
        } else if (p.swingCd <= 0) {
          // In range: take a swing.
          p.swingCd = 1.1;
          const g = this.game;
          // fromPos drives the damage-direction indicator.
          g.player.damage?.(6 + Math.random() * 5, _v.set(p.x, 1.2, p.z));
          if (g.audio && g.audio.swing) g.audio.swing();
          if (g.hud.brToast && !this._warned) {
            this._warned = true;
            g.hud.brToast('THEY FIGHT BACK', 'Not everyone runs');
          }
        }
        p.yaw = Math.atan2(-Math.sin(ang), -Math.cos(ang));
        p.phase += dt * 9;
        this._writePed(i, p, 0.9);      // charging you: near a full sprint
        continue;
      }

      const speed = p.speed * (p.flee > 0 ? 3.1 : 1);

      const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z;
      const len = Math.hypot(dx, dz) || 1;
      p.t += (speed * dt) / len;
      if (p.t >= 1) {
        const opts = p.to.links.filter((n) => n !== p.from);
        const next = opts.length ? opts[(Math.random() * opts.length) | 0] : p.from;
        p.from = p.to; p.to = next; p.t = 0;
      }
      const nx = dx / len, nz = dz / len;
      // Walk the pavement, not the road.
      p.x = p.from.x + dx * p.t + nz * pave * p.side;
      p.z = p.from.z + dz * p.t - nx * pave * p.side;
      p.yaw = Math.atan2(-nx, -nz);
      p.phase += dt * speed * 4.4;

      // How hard they are moving, not how fast the cycle is playing. A walk
      // and a run are the same cycle with different amplitude, knee bend and
      // forward lean — playing a walk faster just looks like a fast walk.
      this._writePed(i, p, p.flee > 0 ? 1 : Math.min(0.55, (p.speed - 0.9) * 0.55));
    }
    this.crowd.flush();
  }

  /** Ground under a pedestrian, so nobody walks through a kerb. */
  _groundAt(p) {
    const c = this.city;
    if (!c.surfaceAt) return 0;
    const h = c.surfaceAt(p.x, p.z);
    return h > -1e6 ? h : 0;
  }

  /**
   * Pose one pedestrian. Shared by the walking and the fighting paths so an
   * angry civilian animates like a person rather than sliding along frozen.
   *
   * All the articulation lives in Crowd; what belongs here is only how hard
   * this particular person is moving, which is what the whole cycle is scaled
   * by. `gait` runs 0 (standing) to 1 (sprinting away).
   */
  _writePed(i, p, gait) {
    p.gait = gait;
    this.crowd.pose(i, p, this._groundAt(p));
  }

  _respawnPed(p, player) {
    const c = this.city;
    for (let i = 0; i < 20; i++) {
      const n = c.nodes[(Math.random() * c.nodes.length) | 0];
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      if (d < 70 || d > this.spawnRing) continue;
      p.from = n;
      p.to = n.links[(Math.random() * n.links.length) | 0] || n;
      p.t = 0; p.flee = 0;
      p.x = n.x; p.z = n.z;
      // Give the ragdoll back before this slot becomes a new person.
      if (p.ragdoll) { this.ragdolls?.release(p.ragdoll); p.ragdoll = null; }
      // Recycled means a NEW person, so they come back on their feet.
      p.hp = 100; p.alive = true; p.downT = 0;
      return;
    }
  }

  update(dt, player, threat = 0) {
    this.updateCars(dt, player);
    this.updatePeds(dt, player, threat);
  }

  dispose() {
    for (const ai of this.cars) ai.car.dispose();
    this.cars.length = 0;
    if (this.crowd) this.crowd.dispose(this.game.scene);
    this.peds.length = 0;
  }
}
