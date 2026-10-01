import * as THREE from 'three';
import { raySphere } from '../physics/PhysicsWorld.js';
import { buildHead, animateHead } from '../fx/Anatomy.js';

const GRAVITY = 24;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

const HUNT = 0, COMBAT = 1, DEAD = 2;

let nextId = 1;

/**
 * Raider callouts. These are spoken aloud (and only when close enough to
 * plausibly hear), which does most of the work of making a firefight feel
 * like it has people in it rather than targets.
 */
const BARKS = {
  spot: [
    'Contact! I see him!', 'There! Right there!', 'Got eyes on!',
    'He\'s here! Move up!', 'Target spotted!', 'Hey! Over here!'
  ],
  lost: [
    'Where\'d he go?', 'Lost him!', 'Anyone got eyes?', 'He\'s gone dark!'
  ],
  reload: [
    'Reloading!', 'Changing mags!', 'Cover me, I\'m dry!', 'Out! Reloading!'
  ],
  flank: [
    'Flanking left!', 'Going around!', 'Cutting him off!', 'Moving wide!'
  ],
  hurt: [
    'I\'m hit!', 'He got me!', 'Taking fire!', 'Aagh!'
  ],
  death: [
    'No—!', 'Aagh!', 'I\'m down!', 'Ghh...'
  ],
  boss: [
    'You cannot stop this.', 'The signal is inevitable.',
    'Kneel.', 'You are already too late.', 'HELIOS sees you.'
  ]
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Enemy classes. Roams and quest spawns mix these by chapter progress:
 * stalkers appear early, brutes join once the chain heats up. `boss` is the
 * chassis for quest bosses — per-map identity comes from the quest data.
 */
export const VARIANTS = {
  sentinel: { id: 'sentinel', tag: 'RAIDER', scale: 1, hp: 1, dmg: 1, speed: 1, visor: 0xff5030 },
  stalker: { id: 'stalker', tag: 'SCOUT', scale: 0.92, hp: 0.55, dmg: 0.75, speed: 1.4, visor: 0xff8030 },
  brute: { id: 'brute', tag: 'HEAVY', scale: 1.18, hp: 2.4, dmg: 1.7, speed: 0.72, visor: 0xff3030 },
  boss: { id: 'boss', tag: 'BOSS', scale: 1.5, hp: 1, dmg: 2.6, speed: 0.78, visor: 0xffffff }
};

// Wardrobe pools — every raider rolls their own look from these.
const SKINS = [0xd9a077, 0xb5825e, 0x8c5f42, 0xe8b98f, 0x6e4a32, 0xc99568];
const HAIRS = [0x241a12, 0x0e0c0a, 0x4a3826, 0x6b6560, 0x2e1608, 0x8a7a5a];
const SHIRTS = [0x4a4a3c, 0x3c4a52, 0x52443c, 0x39463a, 0x4e3e46, 0x44515b, 0x5a5244];
const PANTS = [0x2a2f3a, 0x33302a, 0x26323a, 0x3a2e2a];

/**
 * Difficulty presets. Multipliers apply on top of the per-wave scaling, so a
 * higher threat level is harder from wave one and scales faster in absolute
 * terms. `score` rewards the risk.
 */
export const DIFFICULTIES = {
  recruit: {
    id: 'recruit', label: 'RECRUIT',
    desc: 'New here? Start on this. Raiders hit soft, move slow and come in small groups.',
    hp: 0.45, dmg: 0.3, speed: 0.78, count: 0.5, maxAlive: 4, score: 0.5,
    regenDelay: 2.2, regenRate: 40, aimTime: 1.15, armorBonus: 25
  },
  operative: {
    id: 'operative', label: 'OPERATIVE',
    desc: 'Reduced enemy strength and thinner waves. Learn the movement.',
    hp: 0.7, dmg: 0.55, speed: 0.9, count: 0.75, maxAlive: 6, score: 0.75
  },
  veteran: {
    id: 'veteran', label: 'VETERAN',
    desc: 'The intended experience. SENTINELs fight at spec.',
    hp: 1, dmg: 1, speed: 1, count: 1, maxAlive: 8, score: 1
  },
  skybreaker: {
    id: 'skybreaker', label: 'SKYBREAKER',
    desc: 'Faster, harder, relentless. For wall-running ghosts only.',
    hp: 1.4, dmg: 1.5, speed: 1.15, count: 1.3, maxAlive: 11, score: 1.5
  }
};

/**
 * Enemy — a SENTINEL combat frame. Simple but readable AI:
 *   HUNT   — steer toward the player, raycast-based obstacle avoidance
 *   COMBAT — hold 9–22 m, strafe, telegraphed burst fire with line of sight
 *   DEAD   — topple, dissolve, recycle
 */
class Enemy {
  constructor(game, level, variantId = 'sentinel', bossCfg = null) {
    this.game = game;
    this.id = nextId++;
    this.state = HUNT;
    this.variant = VARIANTS[variantId] || VARIANTS.sentinel;
    this.bossCfg = bossCfg;
    this.isBoss = !!bossCfg;
    this.s = this.variant.scale;
    const v = this.variant;
    const d = game.difficulty;
    // `level` = quest-chain progress; later quests field tougher frames.
    this.maxHp = this.isBoss
      ? bossCfg.hp * d.hp
      : 100 * (1 + level * 0.15) * d.hp * v.hp;
    this.hp = this.maxHp;
    this.damageOut = Math.min(7 * (1 + level * 0.08), 14) * d.dmg * v.dmg;
    this.speed = Math.min(4.4 + level * 0.2, 6.2) * d.speed * v.speed;
    this._slamCd = 3;      // boss ground-slam cooldown
    this._summonCd = 10;   // boss minion-call cooldown
    this._enraged = false;
    this._stuckClock = 0;  // anti-glitch: teleport if wedged in geometry
    this._stuckAnchor = new THREE.Vector3();
    // Garrison duty: hold near this post until the player closes in.
    this.guardPos = null;
    this._patrolTarget = new THREE.Vector3();
    this._patrolT = 0;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this._moveResult = { onGround: false, wallNormal: null, wallRunOK: false, hitCeiling: false };
    this._strafe = 1;
    this._strafeTimer = 0;
    this._losTimer = 0;
    this._phase = Math.random() * 10;

    // Fire-control state.
    this._aimTime = 0;       // telegraph before a burst
    this._burstLeft = 0;
    this._shotTimer = 0;
    this._cooldown = 1 + Math.random();

    this._deadTime = 0;
    this._build();
  }

  /**
   * Human raider, rolled unique from wardrobe pools: skin tone, hair style
   * and color, beard, shirt/pants colors, gear. Scouts run hooded and light;
   * heavies wear plated vests and helmets; bosses are juggernauts in exo-rig
   * armor. The laser/lamp (visorMat) doubles as the firing telegraph.
   */
  _build() {
    const g = new THREE.Group();
    const r = (n) => Math.floor(Math.random() * n);
    const skinHex = SKINS[r(SKINS.length)];
    const hairHex = HAIRS[r(HAIRS.length)];
    const skin = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.85 });
    const hair = new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.95 });
    const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[r(SHIRTS.length)], roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: PANTS[r(PANTS.length)], roughness: 0.9 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.8, metalness: 0.2 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.95 });
    const gun = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.7 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.4 });
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x160a04, emissive: this.isBoss ? (this.bossCfg.color || 0xffffff) : this.variant.visor,
      emissiveIntensity: 1.6, roughness: 0.3
    });

    const add = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const heavy = this.variant.id === 'brute' || this.isBoss;
    const scout = this.variant.id === 'stalker';

    // Legs: thigh, knee wrap, shin, boot with heel.
    const makeLeg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.13 * side, 0.72, 0);
      g.add(pivot);
      add(new THREE.BoxGeometry(0.17, 0.38, 0.2), pants, 0, -0.19, 0, pivot);
      add(new THREE.BoxGeometry(0.15, 0.08, 0.17), gear, 0, -0.39, 0.02, pivot);
      add(new THREE.BoxGeometry(0.14, 0.32, 0.17), pants, 0, -0.55, 0.01, pivot);
      add(new THREE.BoxGeometry(0.16, 0.1, 0.28), boots, 0, -0.69, 0.04, pivot);
      return pivot;
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);
    add(new THREE.BoxGeometry(0.42, 0.09, 0.26), gear, 0, 0.76, 0);            // belt
    add(new THREE.BoxGeometry(0.08, 0.14, 0.1), gear, 0.2, 0.68, 0.1);         // thigh holster

    // Torso: shirt, chest rig with mag pouches, shoulder wraps, backpack.
    add(new THREE.BoxGeometry(0.46, 0.58, 0.27), shirt, 0, 1.08, 0);
    add(new THREE.BoxGeometry(0.4, 0.4, 0.32), gear, 0, 1.12, 0);
    add(new THREE.BoxGeometry(0.09, 0.13, 0.05), gear, -0.11, 1.12, 0.18);
    add(new THREE.BoxGeometry(0.09, 0.13, 0.05), gear, 0.11, 1.12, 0.18);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.05), this.visorMat, 0, 1.24, 0.18); // chest lamp
    add(new THREE.BoxGeometry(0.15, 0.11, 0.24), shirt, -0.3, 1.34, 0);
    add(new THREE.BoxGeometry(0.15, 0.11, 0.24), shirt, 0.3, 1.34, 0);
    add(new THREE.BoxGeometry(0.32, 0.4, 0.16), gear, 0, 1.14, -0.25);          // pack
    add(new THREE.BoxGeometry(0.2, 0.12, 0.1), boots, 0, 0.92, -0.26);          // bedroll
    if (heavy) {
      // Plated vest + pauldrons for the big ones.
      const plate = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.4, metalness: 0.75 });
      add(new THREE.BoxGeometry(0.44, 0.3, 0.36), plate, 0, 1.16, 0);
      add(new THREE.BoxGeometry(0.18, 0.14, 0.28), plate, -0.33, 1.38, 0);
      add(new THREE.BoxGeometry(0.18, 0.14, 0.28), plate, 0.33, 1.38, 0);
    }

    // Arms: shoulder pivots, rolled sleeves → bare forearms, hands.
    const makeArm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.31 * side, 1.32, 0);
      g.add(pivot);
      add(new THREE.BoxGeometry(0.13, 0.3, 0.15), shirt, 0, -0.15, 0, pivot);
      add(new THREE.BoxGeometry(0.1, 0.28, 0.12), skin, 0, -0.42, 0.03, pivot);
      add(new THREE.BoxGeometry(0.1, 0.1, 0.11), skin, 0, -0.58, 0.05, pivot);
      return pivot;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    // Head: face, eyes, brows, nose, ears; beard for some; hair or headgear.
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.62, 0);
    g.add(this.headGroup);
    // Full anatomical head: jaw, nose, ears, brows, eyes with lids, a mouth
    // that snarls in combat, and simulated hair. Headgear layers on top.
    const hairStyles = ['short', 'crop', 'tied', 'buzz', 'long'];
    this.head = buildHead(this.headGroup, {
      skin: skinHex,
      hairColor: hairHex,
      eyeColor: [0x4a3a26, 0x2f4a52, 0x3a5a34][r(3)],
      hair: heavy ? 'buzz' : hairStyles[r(hairStyles.length)],
      beard: Math.random() < 0.55,
      guides: 10,
      strands: 620
    });
    if (heavy) {
      const helm = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.45, metalness: 0.7 });
      add(new THREE.SphereGeometry(0.192, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helm, 0, 0.03, 0, this.headGroup);
      add(new THREE.BoxGeometry(0.26, 0.06, 0.06), gear, 0, 0.085, 0.15, this.headGroup); // goggles
    } else if (scout) {
      add(new THREE.SphereGeometry(0.205, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), gear, 0, 0.02, -0.02, this.headGroup); // hood
    }

    // Rifle carried across the chest, laser sight = telegraph.
    add(new THREE.BoxGeometry(0.07, 0.09, 0.6), gun, 0.22, 1.22, 0.2);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.08), gun, 0.22, 1.14, 0.32);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.16), this.visorMat, 0.22, 1.28, 0.42);

    if (this.isBoss) {
      // Warlord exo-rig: frame struts, crest, glowing power lines.
      const rig = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.35, metalness: 0.85 });
      add(new THREE.BoxGeometry(0.08, 0.7, 0.08), rig, -0.28, 1.0, -0.18);
      add(new THREE.BoxGeometry(0.08, 0.7, 0.08), rig, 0.28, 1.0, -0.18);
      add(new THREE.BoxGeometry(0.55, 0.1, 0.12), rig, 0, 1.42, -0.16);
      add(new THREE.BoxGeometry(0.05, 0.24, 0.12), rig, 0, 0.24, -0.03, this.headGroup);
      add(new THREE.BoxGeometry(0.04, 0.5, 0.04), this.visorMat, -0.28, 1.0, -0.13);
      add(new THREE.BoxGeometry(0.04, 0.5, 0.04), this.visorMat, 0.28, 1.0, -0.13);
    }

    g.scale.setScalar(this.s);
    this.group = g;
    this.game.scene.add(g);
  }

  /** Place the enemy, and remember the spot as its recovery point. */
  spawnAt(point) {
    if (point) {
      this._homePoint = point.clone ? point.clone() : { ...point };
      // Anything spawned well below ground belongs to a dungeon: move its
      // out-of-world floor down with it.
      if (point.y !== undefined && point.y < -20) this.voidY = -90;
    }
    this.position.copy(point);
    this.group.position.copy(point);
    this.game.effects.burst(_v1.copy(point).setY(point.y + 1), { count: 24, color: 0xff7a2d, speed: 5, life: 0.5 });
    this.game.effects.flash(_v1, 0xff7a2d, 40, 0.2);
  }

  get alive() { return this.state !== DEAD; }

  /** Hit spheres tested by player weapons: head then torso then pelvis. */
  raycast(origin, dir, maxDist) {
    if (!this.alive) return null;
    const p = this.position;
    const s = this.s;
    let best = -1;
    let part = null;
    _v1.set(p.x, p.y + 1.62 * s, p.z);
    let t = raySphere(origin, dir, _v1, 0.27 * s);
    if (t > 0 && t < maxDist) { best = t; part = 'head'; }
    _v1.set(p.x, p.y + 1.05 * s, p.z);
    t = raySphere(origin, dir, _v1, 0.44 * s);
    if (t > 0 && t < maxDist && (best < 0 || t < best)) { best = t; part = 'body'; }
    _v1.set(p.x, p.y + 0.5 * s, p.z);
    t = raySphere(origin, dir, _v1, 0.38 * s);
    if (t > 0 && t < maxDist && (best < 0 || t < best)) { best = t; part = 'body'; }
    if (best < 0) return null;
    return { enemy: this, part, dist: best, point: new THREE.Vector3().copy(origin).addScaledVector(dir, best) };
  }

  damage(amount, head, weaponName) {
    if (!this.alive) return;
    this.hp -= amount;
    this.visorMat.emissiveIntensity = 6; // pain flash, decays in update
    if (this.hp <= 0) {
      this._die(head, weaponName);
    } else {
      const d = this.position.distanceTo(this.game.player.position);
      this.game.audio.enemyHurt(d);
      if (Math.random() < 0.4) this._say('hurt', d);
    }
  }

  _die(head, weaponName) {
    this.state = DEAD;
    this._deadTime = 0;
    const dist = this.position.distanceTo(this.game.player.position);
    this.game.audio.enemyDeath(dist);
    // A headshot drops them mid-word; anything else gets a last shout.
    if (!head) {
      this._lastSaid = 0;
      this._say('death', dist);
    }
    _v1.copy(this.position).setY(this.position.y + 1.1 * this.s);
    if (this.isBoss) {
      // A boss goes out loud — their exo-rig detonates.
      this.game.effects.explosion(_v1, this.bossCfg.color || 0xffffff);
      this.game.audio.explosion();
    } else {
      // A person drops: a final spray and a pool left behind.
      this.game.effects.burst(_v1, { count: 22, color: 0x8e1220, speed: 3.4, life: 0.6, gravity: 15 });
      _v2.set(this.position.x, 0.02, this.position.z);
      this.game.effects.bloodDecal(_v2, true);
    }
    this.game.audio.kill();
    this.game.enemies.onKilled(this, head, weaponName);
  }

  /**
   * Shout a callout. Only fires if the player is near enough to hear it and
   * this unit hasn't spoken too recently — a squad all yelling CONTACT at
   * once is comedy, not tension.
   */
  _say(kind, dist) {
    if (dist > 34) return;
    const now = performance.now() * 0.001;
    if (now - (this._lastSaid || 0) < 2.2) return;
    this._lastSaid = now;
    const lines = this.isBoss && BARKS[kind] === BARKS.spot ? BARKS.boss : BARKS[kind];
    if (!lines) return;
    const line = pick(lines);
    // Claim the mouth for roughly as long as this line will take to say.
    this._barkUntil = now + Math.max(0.7, line.length / 13);
    this.game.voice.bark(line, this.isBoss ? 'HELIOS' : 'RAIDER');
  }

  _hasLOS(player) {
    _v1.set(this.position.x, this.position.y + 1.55, this.position.z);
    _v2.set(player.position.x, player.position.y + player.eyeHeight * 0.8, player.position.z);
    _dir.subVectors(_v2, _v1);
    const dist = _dir.length();
    if (dist < 0.5) return true;
    _dir.divideScalar(dist);
    const hit = this.game.physics.raycast(_v1, _dir, dist - 0.3);
    return !hit;
  }

  update(dt) {
    const game = this.game;
    const player = game.player;

    if (this.state === DEAD) {
      this._deadTime += dt;
      // Topple, then sink through the deck.
      this.group.rotation.x = Math.min(this._deadTime * 5, Math.PI / 2);
      if (this._deadTime > 1.1) this.group.position.y -= dt * 1.2;
      return this._deadTime > 2.2; // signal: remove me
    }

    this.visorMat.emissiveIntensity = Math.max(1.6, this.visorMat.emissiveIntensity - dt * 18);

    _dir.subVectors(player.position, this.position);
    _dir.y = 0;
    const distToPlayer = _dir.length();
    if (distToPlayer > 0.01) _dir.divideScalar(distToPlayer);

    const los = this._hasLOS(player);
    this._losTimer = los ? 2 : Math.max(0, this._losTimer - dt);

    // --- State selection --------------------------------------------------
    if (this.state === HUNT && distToPlayer < 22 && los) {
      this.state = COMBAT;
      this._say('spot', distToPlayer);
    } else if (this.state === COMBAT && (distToPlayer > 30 || this._losTimer <= 0)) {
      this.state = HUNT;
      this._say('lost', distToPlayer);
    }

    // Garrison duty ends the moment the player closes in or lands a hit.
    if (this.guardPos && (distToPlayer < 26 || this.hp < this.maxHp - 0.5)) {
      this.guardPos = null;
    }

    // --- Locomotion ----------------------------------------------------------
    let moveX = 0, moveZ = 0, moveSpeed = this.speed;
    if (this.state === HUNT && this.guardPos) {
      // On post: slow patrol loops around the objective.
      this._patrolT -= dt;
      const dpx = this._patrolTarget.x - this.position.x;
      const dpz = this._patrolTarget.z - this.position.z;
      if (this._patrolT <= 0 || dpx * dpx + dpz * dpz < 1.2) {
        this._patrolT = 3 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 6;
        this._patrolTarget.set(this.guardPos.x + Math.cos(a) * r, 0, this.guardPos.z + Math.sin(a) * r);
      }
      const len = Math.hypot(dpx, dpz) || 1;
      moveX = dpx / len;
      moveZ = dpz / len;
      moveSpeed = this.speed * 0.35;
    } else if (this.state === HUNT) {
      moveX = _dir.x; moveZ = _dir.z;
      // Obstacle avoidance: probe ahead, deflect to the clearer side.
      _v1.set(this.position.x, this.position.y + 1.0, this.position.z);
      _v2.set(moveX, 0, moveZ);
      const ahead = game.physics.raycast(_v1, _v2, 2.4);
      if (ahead && Math.abs(ahead.normal.y) < 0.4) {
        const c = Math.cos(1.0), s = Math.sin(1.0);
        const rx = moveX * c - moveZ * s, rz = moveX * s + moveZ * c;
        const lx = moveX * c + moveZ * s, lz = -moveX * s + moveZ * c;
        _v2.set(rx, 0, rz);
        const rHit = game.physics.raycast(_v1, _v2, 2.4);
        if (!rHit) { moveX = rx; moveZ = rz; }
        else { moveX = lx; moveZ = lz; }
      }
    } else { // COMBAT
      this._strafeTimer -= dt;
      if (this._strafeTimer <= 0) {
        this._strafe = Math.random() < 0.5 ? -1 : 1;
        this._strafeTimer = 1.2 + Math.random() * 1.4;
        if (Math.random() < 0.22) this._say('flank', distToPlayer);
      }
      // Perpendicular strafe plus range keeping.
      moveX = -_dir.z * this._strafe;
      moveZ = _dir.x * this._strafe;
      if (distToPlayer > 20) { moveX += _dir.x; moveZ += _dir.z; }
      else if (distToPlayer < 9) { moveX -= _dir.x * 1.2; moveZ -= _dir.z * 1.2; }
      moveSpeed = this.speed * 0.72;
      const len = Math.hypot(moveX, moveZ) || 1;
      moveX /= len; moveZ /= len;
    }

    const k = 1 - Math.exp(-8 * dt);
    this.velocity.x += (moveX * moveSpeed - this.velocity.x) * k;
    this.velocity.z += (moveZ * moveSpeed - this.velocity.z) * k;
    this.velocity.y -= GRAVITY * dt;
    game.physics.moveCapsule(this.position, 0.38 * this.s, 1.75 * this.s, this.velocity, dt, this._moveResult);
    if (this._moveResult.onGround && this.velocity.y < 0) this.velocity.y = 0;

    // Anti-glitch: a frame wedged in geometry gets relocated, not abandoned.
    this._stuckClock += dt;
    if (this._stuckClock > 4) {
      if (this.position.distanceToSquared(this._stuckAnchor) < 0.36 && this.state === HUNT && distToPlayer > 8) {
        const spawns = game.world.enemySpawns;
        this.position.copy(spawns[Math.floor(Math.random() * spawns.length)]);
        this.velocity.set(0, 0, 0);
      }
      this._stuckAnchor.copy(this.position);
      this._stuckClock = 0;
    }
    // Fell through the world: recover, don't haunt it.
    //
    // Both halves of this had to become mode-aware. The threshold was fixed
    // at -12, which treats a dungeon garrison sixty metres down as having
    // fallen out of the map; and the recovery read enemySpawns[0], which is
    // undefined on a map that publishes no spawn table (GTAZ) and threw.
    if (this.position.y < (this.voidY ?? -12)) {
      const home = this._homePoint || game.world.enemySpawns[0];
      if (home) this.position.copy(home);
      this.velocity.set(0, 0, 0);
    }

    // --- Boss abilities -----------------------------------------------------
    if (this.isBoss) {
      // A boss can bring its own slam and summon rhythm (the Undercity wards
      // each do — see city/Answer.js); anything that does not gets the
      // original numbers, so quest bosses elsewhere are unchanged.
      const slam = this.bossCfg.slam || { cd: 5, radius: 6.5, dmg: 30, knock: 11 };
      const summon = this.bossCfg.summon || { cd: 13, count: 2 };
      // Ground slam when the player crowds it. It triggers a little inside
      // its own radius, so standing at the edge of the blast is a choice.
      this._slamCd -= dt;
      if (this._slamCd <= 0 && distToPlayer < slam.radius * 0.75 && this._moveResult.onGround) {
        this._slamCd = this._enraged ? slam.cd * 0.64 : slam.cd;
        _v1.set(this.position.x, this.position.y + 0.5, this.position.z);
        game.effects.explosion(_v1, this.bossCfg.color || 0xffffff);
        game.audio.explosion();
        // Loose things in the hall go flying too, not only the player.
        game.freeRoam?.rigid?.blast(_v1.x, _v1.y, _v1.z, 2.4, slam.radius * 1.2);
        if (distToPlayer < slam.radius) {
          player.damage(slam.dmg * game.difficulty.dmg, this.position);
          // Knockback: shove the player away and up.
          _v2.subVectors(player.position, this.position).setY(0).normalize();
          player.velocity.x += _v2.x * slam.knock;
          player.velocity.z += _v2.z * slam.knock;
          player.velocity.y = Math.max(player.velocity.y, 7);
        }
      }
      // Call minions to the fight.
      this._summonCd -= dt;
      if (this._summonCd <= 0) {
        this._summonCd = this._enraged ? summon.cd * 0.7 : summon.cd;
        game.enemies.spawnGroup(summon.count, this.position);
        this.visorMat.emissiveIntensity = 6;
        game.audio.roar();
      }
      // Half health: said once, before the enrage, so the fight has a middle.
      if (!this._halfSaid && this.bossCfg.half && this.hp < this.maxHp * 0.62) {
        this._halfSaid = true;
        game.hud.comms(this.bossCfg.half, this.bossCfg.name);
      }
      // Enrage at half health: faster, meaner bursts.
      if (!this._enraged && this.hp < this.maxHp * 0.5) {
        this._enraged = true;
        this.speed *= 1.35;
        game.audio.roar();
        game.hud.comms(this.bossCfg.enrage || `${this.bossCfg.name} is enraged — finish it!`, 'TACNET');
      }
    }

    // Soft separation from the player (no hard body-blocking).
    if (distToPlayer < 1.1 && distToPlayer > 0.01) {
      this.position.x -= _dir.x * (1.1 - distToPlayer) * 0.5;
      this.position.z -= _dir.z * (1.1 - distToPlayer) * 0.5;
    }

    // --- Facing + leg cycle ----------------------------------------------
    const faceDir = this.state === COMBAT ? _dir : _v2.set(moveX, 0, moveZ);
    const targetYaw = Math.atan2(faceDir.x, faceDir.z);
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 8);
    this.group.rotation.y = this.yaw;
    this.group.position.copy(this.position);

    this._phase += Math.hypot(this.velocity.x, this.velocity.z) * dt * 3;
    const swing = Math.sin(this._phase) * 0.55;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    // Arms counter-swing the legs; right arm carries the weapon steadier.
    this.armL.rotation.x = -swing * 0.7;
    this.armR.rotation.x = swing * 0.35;
    // Head: scans side to side while hunting, locks forward in combat.
    const scanTarget = this.state === HUNT ? Math.sin(performance.now() * 0.0016 + this._phase) * 0.5 : 0;
    this.headGroup.rotation.y += (scanTarget - this.headGroup.rotation.y) * Math.min(1, dt * 5);

    // Face: they shout when they open fire, set their jaw in a fight, and
    // idle when they haven't found you yet. Hair rides the head's motion.
    if (this.head) {
      const now = performance.now() * 0.001;
      // If this raider is the one currently shouting a callout, their mouth
      // forms the words; otherwise it's shout / set-jaw / idle by situation.
      const voice = this.game.voice;
      const barking = this._barkUntil && now < this._barkUntil &&
        voice && voice.speakingWho === (this.isBoss ? 'HELIOS' : 'RAIDER');
      const mood = barking ? 'talk'
        : this._burstLeft > 0 ? 'shout'
          : this.state === COMBAT ? 'alert'
            : 'idle';
      _v2.set(this.position.x, this.position.y + 1.62 * this.s, this.position.z);
      animateHead(this.head, dt, now + this._phase, mood, _v2);
    }

    // --- Fire control -------------------------------------------------------
    if (this.state === COMBAT && los) {
      if (this._burstLeft > 0) {
        this._shotTimer -= dt;
        if (this._shotTimer <= 0) {
          this._shoot(player, distToPlayer);
          this._burstLeft--;
          this._shotTimer = 0.12;
          if (this._burstLeft === 0) {
            this._cooldown = 1.3 + Math.random() * 1.1;
            // Between bursts they're topping off — call it out.
            if (Math.random() < 0.35) this._say('reload', distToPlayer);
          }
        }
      } else if (this._cooldown > 0) {
        this._cooldown -= dt;
      } else if (this._aimTime < (game.difficulty.aimTime ?? 0.5)) {
        // Telegraph: lamp flares before the burst. Longer on easy tiers so
        // there's time to react.
        const tell = game.difficulty.aimTime ?? 0.5;
        this._aimTime += dt;
        this.visorMat.emissiveIntensity = 1.6 + (this._aimTime / tell) * 4;
      } else {
        this._aimTime = 0;
        this._burstLeft = 3 + Math.floor(Math.random() * 3) + (this.isBoss ? (this._enraged ? 4 : 2) : 0);
        this._shotTimer = 0;
      }
    } else {
      this._aimTime = 0;
      this._burstLeft = 0;
    }
    return false;
  }

  _shoot(player, dist) {
    const game = this.game;
    // Muzzle: weapon offset in facing frame (scaled with the chassis).
    const s = this.s;
    _v1.set(
      this.position.x + (Math.sin(this.yaw) * 0.3 + Math.cos(this.yaw) * 0.24) * s,
      this.position.y + 1.3 * s,
      this.position.z + (Math.cos(this.yaw) * 0.3 - Math.sin(this.yaw) * 0.24) * s
    );
    _aim.set(player.position.x, player.position.y + player.eyeHeight * 0.75, player.position.z);
    _dir.subVectors(_aim, _v1).normalize();
    // Spread grows with distance so close-range pressure feels dangerous but fair.
    const spread = 0.02 + dist * 0.0012;
    _dir.x += (Math.random() - 0.5) * spread;
    _dir.y += (Math.random() - 0.5) * spread;
    _dir.z += (Math.random() - 0.5) * spread;
    _dir.normalize();

    const wall = game.physics.raycast(_v1, _dir, dist + 3);
    const playerT = raySphere(_v1, _dir, _aim, 0.55);
    const wallDist = wall ? wall.dist : Infinity;

    if (playerT > 0 && playerT < wallDist) {
      _v2.copy(_v1).addScaledVector(_dir, playerT);
      game.effects.tracer(_v1, _v2, 0xff5d3d);
      player.damage(this.damageOut, this.position);
    } else if (wall) {
      // Missed — if it passed close to your head, you hear it crack by.
      _v2.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
      const along = _v2.clone().sub(_v1).dot(_dir);
      if (along > 0 && along < wall.dist) {
        const miss = _v2.distanceTo(_v1.clone().addScaledVector(_dir, along));
        game.audio.whizz(miss);
      }
      game.effects.tracer(_v1, wall.point, 0xff5d3d);
      game.effects.impact(wall.point, wall.normal, 0xff8873, wall.box.surface);
    } else {
      _v2.copy(_v1).addScaledVector(_dir, 60);
      game.effects.tracer(_v1, _v2, 0xff5d3d);
    }
    game.effects.flash(_v1, 0xff5d3d, 10, 0.04);
    game.audio.enemyShoot(dist);
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.visorMat.dispose();
  }
}

/**
 * EnemyManager — the enemy director. No waves: SENTINEL pressure comes from
 * three sources — a light roaming patrol so the station always feels
 * hostile, quest spawn groups requested by the QuestManager, and sustained
 * "pressure" mode during defend objectives.
 */
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this._queue = [];      // pending spawns: { near: Vector3|null }
    this._queueTimer = 0;
    this._roamTimer = 6;
    this.pressure = false; // defend-quest mode: continuous reinforcement
    this._pressureTimer = 0;
  }

  reset() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this._queue = [];
    this._queueTimer = 0;
    this._roamTimer = 6;
    this.pressure = false;
    this.game.hud.setEnemies(0);
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  /**
   * Queue n enemies. `near` biases spawn selection toward a location;
   * opts.exact drops them right at the site (± a few meters) and opts.guard
   * puts them on garrison duty there until the player closes in.
   */
  spawnGroup(n, near = null, opts = {}) {
    for (let i = 0; i < n; i++) this._queue.push({ near, exact: !!opts.exact, guard: !!opts.guard });
  }

  /** Defend-quest reinforcement mode. */
  setPressure(on) {
    this.pressure = on;
    this._pressureTimer = 0;
  }

  update(dt) {
    const game = this.game;
    const diff = game.difficulty;

    // Trickle queued quest spawns.
    this._queueTimer -= dt;
    if (this._queue.length && this._queueTimer <= 0 && this.aliveCount < diff.maxAlive + 4) {
      this._queueTimer = 0.55;
      const job = this._queue.shift();
      this._spawn(job.near, job);
    }

    // A light roaming patrol; the real pressure lives at mission sites.
    const roamCap = Math.max(1, Math.round(2 * diff.count));
    this._roamTimer -= dt;
    if (this._roamTimer <= 0) {
      this._roamTimer = 8;
      if (!this._queue.length && !this.pressure && this.aliveCount < roamCap) this._spawn(null);
    }

    // Defend pressure: constant reinforcement while the hold is active.
    if (this.pressure) {
      this._pressureTimer -= dt;
      if (this._pressureTimer <= 0 && this.aliveCount < diff.maxAlive) {
        this._pressureTimer = 2.4 / diff.count;
        this._spawn(null);
      }
    }

    // Update + cull enemies.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const done = this.list[i].update(dt);
      if (done) {
        this.list[i].dispose();
        this.list.splice(i, 1);
      }
    }

    // Pairwise separation so units don't stack (n is small).
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (1 - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.position.x -= nx * push; a.position.z -= nz * push;
          b.position.x += nx * push; b.position.z += nz * push;
        }
      }
    }

    game.hud.setEnemies(this.aliveCount);
  }

  _spawn(near, job = {}) {
    const game = this.game;
    const spawns = game.world.enemySpawns;
    let point;
    if (near && job.exact) {
      // Deploy right at the site, fanned out around it.
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 8;
      // Spawn at the REQUESTED height, not at ground level. Hardcoding 0.1
      // put every garrison on the street when the room they were meant to
      // defend was sixty metres underground.
      point = new THREE.Vector3(near.x + Math.cos(a) * r, near.y ?? 0.1, near.z + Math.sin(a) * r);
    } else if (near) {
      // Closest few points to the requested location, picked randomly.
      const sorted = [...spawns].sort((a, b) => a.distanceTo(near) - b.distanceTo(near));
      point = sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
      // A map with no spawn table (GTAZ) would hand spawnAt undefined.
      if (!point) point = near.clone();
    } else {
      const far = spawns.filter((s) => s.distanceTo(game.player.position) > 22);
      const pool = far.length ? far : spawns;
      point = pool[Math.floor(Math.random() * pool.length)];
      if (!point) return;          // nowhere legal to put one; skip quietly
    }
    const level = game.quests ? game.quests.index : 0;
    // Mix in variants as the chapter progresses.
    let variant = 'sentinel';
    const roll = Math.random();
    if (roll < 0.2 + level * 0.04) variant = 'stalker';
    else if (level >= 2 && roll > 0.82 - level * 0.03) variant = 'brute';
    const e = new Enemy(game, level, variant);
    e.spawnAt(point);
    if (job.guard && near) e.guardPos = near.clone();
    this.list.push(e);
  }

  /** Spawn a quest boss at a specific point. Returns the boss entity. */
  spawnBoss(bossCfg, point) {
    const level = this.game.quests ? this.game.quests.index : 0;
    const e = new Enemy(this.game, level, 'boss', bossCfg);
    e.spawnAt(point);
    e.guardPos = point.clone(); // holds its arena until you come for it
    this.list.push(e);
    this.game.audio.roar();
    return e;
  }

  /** Nearest enemy hitbox along a ray, or null. Used by player weapons. */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const e of this.list) {
      const hit = e.raycast(origin, dir, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    return best;
  }

  onKilled(enemy, head, weaponName) {
    const game = this.game;
    game.kills++;
    if (head) game.headshots++;
    const bounty = enemy.isBoss ? 500 : enemy.variant.id === 'brute' ? 60 : enemy.variant.id === 'stalker' ? 30 : 25;
    game.addScore(Math.round((head ? 150 : 100) * (enemy.isBoss ? 5 : 1) * game.difficulty.score));
    game.addCredits(Math.round((head ? bounty * 1.5 : bounty) * game.difficulty.score));
    const label = enemy.isBoss ? enemy.bossCfg.name : `${enemy.variant.tag}-${String(enemy.id).padStart(2, '0')}`;
    game.hud.killfeed(`${weaponName || 'UNKNOWN'} ▸ ${label}`, head);
    if (game.momentum) game.momentum.onKill(enemy, head);
    if (game.quests) game.quests.notifyKill(enemy);
  }
}
