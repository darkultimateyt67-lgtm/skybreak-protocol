import * as THREE from 'three';
import { Vehicle } from './Vehicles.js';
import { raySphere } from '../physics/PhysicsWorld.js';

/**
 * Wanted — the police response, and the only real pressure in a mode with no
 * missions. Free roam with nothing pushing back is a walking simulator; the
 * stars are what turn "drive around" into a game you can lose.
 *
 * Five levels. Each raises the number of pursuing units, how aggressive they
 * are, and how fast the heat decays. Heat only cools while you are OUT of
 * sight of every unit, so escaping is an act — break line of sight and keep it
 * broken — rather than a timer you wait out in the open.
 */

// `cool` is stars-worth of heat shed per second while unseen. Escaping a
// five-star chase should be an achievement, not a chore: these clear a fresh
// one-star in about 8 seconds and a full five-star in around 40, which is long
// enough to be tense and short enough that you keep playing rather than
// driving in circles waiting for a number to tick down.
//
// `aggression` is the one that had never been wired to anything. It now drives
// the guns: how often an officer fires, how hard the round hits and how far
// out they will take the shot. One star is a traffic stop — they want you to
// pull over and nobody shoots. From two stars they are shooting at the car,
// and by five they are shooting to end it.
const LEVELS = [
  { units: 0, speed: 0, aggression: 0, cool: 1.0, fireRate: 0, range: 0, dmg: 0 },
  { units: 1, speed: 26, aggression: 0.3, cool: 0.13, fireRate: 0, range: 0, dmg: 0 },
  { units: 2, speed: 30, aggression: 0.5, cool: 0.11, fireRate: 1.35, range: 42, dmg: 7 },
  { units: 3, speed: 34, aggression: 0.7, cool: 0.10, fireRate: 0.95, range: 52, dmg: 9 },
  { units: 5, speed: 38, aggression: 0.85, cool: 0.09, fireRate: 0.70, range: 62, dmg: 11 },
  { units: 7, speed: 42, aggression: 1.0, cool: 0.08, fireRate: 0.50, range: 72, dmg: 13 }
];

/** What each crime is worth, in heat. 100 heat = one star. */
export const CRIMES = {
  hitPed: 55,
  killPed: 130,
  hitCar: 18,
  shootInPublic: 70,
  killCop: 220,
  stealOccupied: 60,
  reckless: 6            // per second of very fast driving near people
};

const _v = new THREE.Vector3();

export class Wanted {
  constructor(freeRoam) {
    this.fr = freeRoam;
    this.game = freeRoam.game;
    this.city = freeRoam.city;
    this.heat = 0;
    this.level = 0;
    this.units = [];
    this.seenTimer = 0;
    this._spawnCd = 0;
  }

  reset() {
    this.heat = 0;
    this.level = 0;
    for (const u of this.units) u.car.dispose();
    this.units.length = 0;
  }

  /**
   * FUN mode has no police unless you switch them on. REAL always has them.
   * Read live, so flipping the toggle takes effect on the next frame.
   */
  get enabled() {
    const r = this.game.rules;
    return r ? r.police !== false : true;
  }

  /** Register a crime. Returns the new level. */
  commit(kind, mult = 1) {
    if (!this.enabled) return 0;
    const gain = (CRIMES[kind] ?? 0) * mult;
    if (gain <= 0) return this.level;
    const before = this.level;
    this.heat = Math.min(560, this.heat + gain);
    this._syncLevel();
    if (this.level > before) this._announce();
    return this.level;
  }

  _syncLevel() {
    this.level = this.heat <= 0 ? 0 : Math.max(1, Math.min(5, Math.ceil(this.heat / 100)));
  }

  _announce() {
    const g = this.game;
    const stars = '★'.repeat(this.level) + '☆'.repeat(5 - this.level);
    if (g.hud.brToast) {
      g.hud.brToast(`WANTED  ${stars}`,
        this.level >= 4 ? 'They are shooting to stop you'
          : this.level >= 2 ? 'They have opened fire'
            : 'Pull over or run');
    }
    // Throttled. Driving through a crowd can push through several stars in a
    // second, and one klaxon per star arrived as a single overlapping blare.
    const now = performance.now();
    if (now - (this._lastKlaxon || 0) > 1400) {
      this._lastKlaxon = now;
      if (g.audio && g.audio.stormWarn) g.audio.stormWarn();
    }
  }

  /** Where the player currently is — on foot or behind the wheel. */
  _playerPos(out) {
    const fr = this.fr;
    if (fr.driving) return out.copy(fr.driving.position);
    return out.copy(this.game.player.position);
  }

  update(dt) {
    const g = this.game;
    if (!this.enabled) {
      // Switched off mid-chase: call it off entirely.
      if (this.heat > 0 || this.units.length) {
        this.reset();
        g.hud.setWanted?.(0);
      }
      return;
    }
    this._frame = (this._frame || 0) + 1;   // per-frame sight cache key
    this._playerPos(_v);
    const cfg = LEVELS[this.level];

    // --- Cool down, but only while somebody actually has eyes on you --------
    // "Within 90 m" is not the same as "can see you". Units drive straight to
    // the player, so a pure distance test is true almost permanently once a
    // chase starts — heat never decayed and the chase could not be escaped at
    // all. Sight needs range AND an unobstructed line, which is what makes
    // ducking behind a block a real move rather than a cosmetic one.
    let seen = false;
    for (const u of this.units) {
      if (!u.car.alive) continue;
      if (this._canSee(u, _v)) { seen = true; break; }
    }
    this.seenTimer = seen ? 0 : this.seenTimer + dt;
    if (!seen && this.seenTimer > 3 && this.heat > 0) {
      this.heat = Math.max(0, this.heat - cfg.cool * 100 * dt);
      const before = this.level;
      this._syncLevel();
      if (this.level < before && this.level === 0) {
        if (g.hud.brToast) g.hud.brToast('YOU LOST THEM', 'Heat clear');
        for (const u of this.units) u.car.dispose();
        this.units.length = 0;
      }
    }

    // --- Maintain the pursuing fleet ---------------------------------------
    this.units = this.units.filter((u) => {
      if (u.car.alive) return true;
      u.car.dispose();
      return false;
    });
    this._spawnCd -= dt;
    if (this.level > 0 && this.units.length < cfg.units && this._spawnCd <= 0) {
      this._spawnUnit(_v);
      this._spawnCd = 2.4;
    }

    // --- Drive the pursuit --------------------------------------------------
    for (const u of this.units) this._driveUnit(u, dt, _v, cfg);

    // Flashing beacons while a chase is live.
    if (this.level > 0) {
      const t = performance.now() * 0.006;
      for (const u of this.units) {
        if (!u.car.beacons) continue;
        const f = Math.sin(t) > 0;
        u.car.beacons[0].emissiveIntensity = f ? 3.2 : 0.25;
        u.car.beacons[1].emissiveIntensity = f ? 0.25 : 3.2;
      }
    }
  }

  /**
   * Can this unit see the player right now? Range plus a clear line — the
   * result is cached per frame because both the sight test and the pursuit
   * steering want it, and each call is a raycast.
   */
  _canSee(u, target) {
    if (u._seenFrame === this._frame) return u._seen;
    u._seenFrame = this._frame;
    const d = u.car.position.distanceTo(target);
    if (d > 110) { u._seen = false; return false; }
    _sight.subVectors(target, u.car.position).normalize();
    _eye.copy(u.car.position).setY(1.2);
    const hit = this.game.physics.raycast(_eye, _sight, d);
    // Anything solid between the two, other than the ground itself, blocks it.
    u._seen = !hit || hit.dist >= d - 1.5;
    return u._seen;
  }

  /** Take over a patrol car that's already on the street and give it chase. */
  adopt(car) {
    car.driver = 'ai';
    car.setOccupantsVisible?.(true);
    this.units.push({ car, node: this.city.nearestNode(car.position.x, car.position.z) });
    return car;
  }

  _spawnUnit(playerPos) {
    const c = this.city;
    // Come in from a junction a few blocks out, not out of thin air beside you.
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 30; i++) {
      const n = c.nodes[(Math.random() * c.nodes.length) | 0];
      const d = Math.hypot(n.x - playerPos.x, n.z - playerPos.z);
      if (d < 120) continue;
      const score = Math.abs(d - 190);
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (!best) return;
    const car = new Vehicle(this.city, best.x, best.z, 'sedan', { police: true });
    car.driver = 'ai';
    this.units.push({ car, node: best });
  }

  /**
   * Pursuit steering. Units drive the road graph toward the player rather than
   * beelining, so they arrive down streets instead of through buildings, but
   * they cut straight once they're close enough to have line of sight.
   */
  _driveUnit(u, dt, target, cfg) {
    const car = u.car;

    // Units pursue the last place they SAW you, not your live position.
    // Perfect knowledge made the chase unloseable; a stale target means
    // breaking away sends them to where you were.
    if (!u.lastSeen) u.lastSeen = target.clone();
    if (this._canSee(u, target)) {
      u.lastSeen.copy(target);
      u.searchT = 0;
    } else {
      u.searchT = (u.searchT || 0) + dt;
    }
    target = u.lastSeen;

    const toPlayer = _tmp.subVectors(target, car.position);
    const dist = toPlayer.length();

    let steerTo;
    if (dist < 60) {
      steerTo = _tmp2.copy(target);
    } else {
      // Head for the graph node that most reduces distance to the player.
      if (!u.node || car.position.distanceTo(_tmp3.set(u.node.x, 0, u.node.z)) < 12) {
        u.node = this._nextHop(u.node || this.city.nearestNode(car.position.x, car.position.z), target);
      }
      steerTo = _tmp2.set(u.node.x, 0, u.node.z);
    }

    const desired = Math.atan2(-(steerTo.x - car.position.x), -(steerTo.z - car.position.z));
    let diff = desired - car.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // NEGATED. Vehicle.drive() applies `yaw -= steer * ...`, so a positive
    // steer turns the car AWAY from a positive heading error. Feeding the raw
    // difference in made every unit steer off the player and accelerate into
    // the distance — the chase ran backwards.
    const steer = THREE.MathUtils.clamp(-diff * 1.6, -1, 1);
    // Ease off the throttle through hard corners, and stop short of ramming
    // at max speed from point blank.
    const throttle = dist < 12 ? -0.4 : (1 - Math.min(0.55, Math.abs(steer) * 0.6));
    // Top speed tracks the wanted level, but the style object is shared with
    // every other car of this body type — mutate the unit's own copy only.
    //
    // PURSUIT SPEED IS RELATIVE TO WHAT YOU ARE DRIVING. A fixed figure stopped
    // meaning anything the moment the player's car got a 7x boost: a supercar
    // at 350 m/s simply drives away from a 42 m/s patrol car and the chase is
    // over before it starts. Units now scale to a fraction of YOUR top speed,
    // ramping from clearly-slower-than-you at one star to marginally faster at
    // five. So a fast car really does buy you an escape early on, and at five
    // stars nothing outruns them — you have to break line of sight instead,
    // which is the mechanic the whole system is built around.
    const PURSUIT_FRAC = [0, 0.72, 0.84, 0.92, 0.98, 1.03];
    // What the player can currently do, which is a completely different number
    // on foot to behind the wheel. Chasing the boosted CAR figure while the
    // player is running turned patrol cars into 160 m/s projectiles that blew
    // through every junction they were steering for and wrecked themselves —
    // the chase got FURTHER away the higher the wanted level went.
    const quarry = this.fr.driving
      ? this.fr.driving.style.topSpeed
      : Math.max(cfg.speed, this.game.player.speedH * 1.25);
    car.style.topSpeed = Math.max(cfg.speed, quarry * (PURSUIT_FRAC[this.level] || 0.8));
    // A top speed they can't accelerate to is decoration.
    car.style.accel = Math.max(car.style.accel, car.style.topSpeed * 0.32);
    car.drive(dt, throttle, steer, false);

    // Ramming. One impact per unit per second, sized by how hard they are
    // actually closing on you — not a flat hit every frame they are near,
    // which is what used to wreck a car the instant a cruiser touched it.
    u.bumpCd = Math.max(0, (u.bumpCd || 0) - dt);
    const prey = this.fr.driving;
    if (prey && dist < 4.2 && u.bumpCd <= 0) {
      u.bumpCd = 1.0;
      const closing = Math.abs(car.speed - prey.speed * Math.cos(prey.yaw - car.yaw));
      prey.takeDamage(Math.min(30, 6 + closing * 0.5));
    }

    // --- And they shoot ----------------------------------------------------
    this._fireAtPlayer(u, dt, cfg);
  }

  /**
   * An officer leaning out of the window and firing.
   *
   * Two rules keep this from being cheap. They only shoot at what they can
   * actually SEE — the same line-of-sight test that governs the chase, so
   * putting a building between you and them stops the bullets as well as the
   * pursuit. And the shot comes from the car's passenger side rather than its
   * centre, so the tracer reads as a person shooting rather than the vehicle
   * itself attacking you.
   *
   * Shooting at a moving car is hard, and it should be: spread grows with
   * range AND with how fast you are going, so flooring it down a straight is a
   * genuine defence rather than the thing that gets you killed.
   */
  _fireAtPlayer(u, dt, cfg) {
    if (!cfg.fireRate) return;
    const g = this.game;
    const car = u.car;
    u.fireCd = (u.fireCd || 0) - dt;

    this._playerPos(_shotTarget);
    const dist = car.position.distanceTo(_shotTarget);
    if (dist > cfg.range || dist < 3) return;
    if (!this._canSee(u, _shotTarget)) return;
    if (u.fireCd > 0) return;

    // Reset with a little jitter so a pack of units doesn't fire in lockstep.
    u.fireCd = cfg.fireRate * (0.75 + Math.random() * 0.5);

    // Muzzle: out of the passenger window, at shoulder height.
    const side = u._side || (u._side = Math.random() < 0.5 ? -1 : 1);
    _muzzle.set(
      car.position.x + Math.cos(car.yaw) * 0.95 * side - Math.sin(car.yaw) * 0.6,
      car.position.y + 1.15,
      car.position.z - Math.sin(car.yaw) * 0.95 * side - Math.cos(car.yaw) * 0.6
    );

    // Aim at centre mass, or at the driver's seat if you're in a car.
    _aimAt.copy(_shotTarget);
    _aimAt.y += this.fr.driving ? 0.35 : g.player.eyeHeight * 0.72;

    _shotDir.subVectors(_aimAt, _muzzle).normalize();
    const speedPenalty = Math.min(0.05, Math.abs(this.fr.driving?.speed || 0) * 0.0016);
    const spread = 0.022 + dist * 0.0016 + speedPenalty;
    _shotDir.x += (Math.random() - 0.5) * spread;
    _shotDir.y += (Math.random() - 0.5) * spread;
    _shotDir.z += (Math.random() - 0.5) * spread;
    _shotDir.normalize();

    const wall = g.physics.raycast(_muzzle, _shotDir, dist + 4);
    const wallDist = wall ? wall.dist : Infinity;
    // A car is a much bigger thing to hit than a person on foot.
    const hitRadius = this.fr.driving ? 1.5 : 0.55;
    const t = raySphere(_muzzle, _shotDir, _aimAt, hitRadius);

    // Anything else in the line of fire takes the round first. Police shoot
    // cars to pieces — including the ones that happen to be in the way.
    let stray = null;
    let strayT = Math.min(wallDist, t > 0 ? t : Infinity);
    for (const v of this.fr._allVehicles()) {
      if (v === car || v === this.fr.driving) continue;
      if (Math.abs(v.position.x - _muzzle.x) > cfg.range || Math.abs(v.position.z - _muzzle.z) > cfg.range) continue;
      _strayC.set(v.position.x, v.position.y + (v.style.h || 1.4) * 0.45, v.position.z);
      const vt = raySphere(_muzzle, _shotDir, _strayC, Math.max(1.0, (v.style.w || 2) * 0.75));
      if (vt > 0 && vt < strayT) { strayT = vt; stray = v; }
    }
    if (stray) {
      _shotEnd.copy(_muzzle).addScaledVector(_shotDir, strayT);
      g.effects.tracer(_muzzle, _shotEnd, 0x9fd8ff);
      g.effects.impact?.(_shotEnd, _shotDir, 0xffd0a0, 'metal');
      stray.takeDamage(cfg.dmg * 1.6);
      stray._dented = stray._dented || 0;
      this.fr._applyDents?.(stray);
    } else if (t > 0 && t < wallDist) {
      _shotEnd.copy(_muzzle).addScaledVector(_shotDir, t);
      g.effects.tracer(_muzzle, _shotEnd, 0x9fd8ff);
      if (this.fr.driving) {
        // Rounds into the bodywork wreck the car a piece at a time and bleed
        // through to you.
        this.fr.driving.takeDamage(cfg.dmg * 1.1);
        this.fr._applyDents?.(this.fr.driving);
        g.player.damage?.(cfg.dmg * 0.35, car.position);
      } else {
        g.player.damage?.(cfg.dmg, car.position);
      }
      g.effects.impact?.(_shotEnd, _shotDir, 0xffd0a0, 'metal');
    } else if (wall) {
      g.effects.tracer(_muzzle, wall.point, 0x9fd8ff);
      g.effects.impact?.(wall.point, wall.normal, 0xffd0a0, wall.box.surface);
      // A round that went past your head should be heard doing it.
      _shotEnd.copy(_aimAt);
      const along = _shotEnd.sub(_muzzle).dot(_shotDir);
      if (along > 0 && along < wall.dist) {
        _shotEnd.copy(_muzzle).addScaledVector(_shotDir, along);
        g.audio?.whizz?.(_shotEnd.distanceTo(_aimAt));
      }
    } else {
      _shotEnd.copy(_muzzle).addScaledVector(_shotDir, cfg.range);
      g.effects.tracer(_muzzle, _shotEnd, 0x9fd8ff);
    }

    g.effects.flash?.(_muzzle, 0xbfe4ff, 9, 0.04);
    g.audio?.enemyShoot?.(dist);
  }

  /** One step of greedy graph search toward the target. */
  _nextHop(from, target) {
    if (!from) return this.city.nodes[0];
    let best = from, bd = Infinity;
    for (const n of from.links) {
      const d = (n.x - target.x) ** 2 + (n.z - target.z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
}

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tmp3 = new THREE.Vector3();
const _sight = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _shotEnd = new THREE.Vector3();
const _shotTarget = new THREE.Vector3();
const _aimAt = new THREE.Vector3();
const _strayC = new THREE.Vector3();
