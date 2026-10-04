import * as THREE from 'three';

const GRAVITY = 24;

// Everything the player moves at is scaled by this. Seven times the old pace
// puts a sprint at ~59 m/s — roughly 210 km/h on foot, faster than most of the
// traffic — so the whole 2 km city is about thirty seconds end to end.
//
// Two things had to change underneath for this to work rather than just break:
// the collision solver now substeps (see PhysicsWorld.moveCapsule, which would
// otherwise let you run through walls at this pace), and the acceleration and
// air-control figures below are scaled with it, because a 59 m/s target speed
// reached at the old acceleration would take most of a second to arrive at and
// steer like a barge.
// The designed figures. GTAZ's FUN ruleset multiplies these at the point of
// use via `this.sc`; every other mode runs them exactly as written.
//
// The multiplier is applied live rather than baked into these constants the
// way it used to be, because a baked constant cannot be switched off — and it
// reaches further than movement: footstep cadence, camera bob, the slide and
// wall-run thresholds and the anti-blowup speed cap are all measured against
// it. Miss one and you get a boosted sprint with a walking-pace stride, or a
// 7x runner still clamped to the stock ceiling.
const WALK_SPEED = 5.4;
const SPRINT_SPEED = 8.4;
const CROUCH_SPEED = 2.8;
const AIR_ACCEL = 26;
const JUMP_VEL = 8.2;
const BOOST_VEL = 8.6;
const RADIUS = 0.42;
const STAND_H = 1.8;
const CROUCH_H = 1.25;

/**
 * Operators — the playable characters. Each has a stat identity, an accent
 * color (armor + gloves), and its own starting loadout; everything else is
 * bought at the supply uplink.
 */
export const OPERATORS = {
  vector: {
    id: 'vector', label: 'VECTOR-7',
    desc: 'The last ARC operative. Balanced hull, plate and stride.',
    health: 100, armor: 50, speed: 1, color: 0x2d4a56, accent: 0x37e6ff,
    loadout: ['riptide', 'wasp'], weaponNote: 'RIPTIDE rifle + WASP sidearm'
  },
  rush: {
    id: 'rush', label: 'RUSH',
    desc: 'Courier frame-runner. +8% speed, thinner hull (90).',
    health: 90, armor: 50, speed: 1.08, color: 0x5c3a22, accent: 0xff9b3d,
    loadout: ['kestrel', 'blade'], weaponNote: 'KESTREL SMG + ARC BLADE'
  },
  aegis: {
    id: 'aegis', label: 'AEGIS',
    desc: 'Breacher plating. Starts with 85 plate, −5% speed.',
    health: 100, armor: 85, speed: 0.95, color: 0x2f4a30, accent: 0x7dffb8,
    loadout: ['mauler', 'wasp'], weaponNote: 'MAULER shotgun + WASP sidearm'
  },
  ghost: {
    id: 'ghost', label: 'GHOST',
    desc: 'Recon build. Boost energy recharges 40% faster, hull 95.',
    health: 95, armor: 45, speed: 1.02, energy: 1.4, color: 0x3a3a4a, accent: 0xb08cff,
    loadout: ['lance', 'blade'], weaponNote: 'LANCE marksman + ARC BLADE'
  },
  titan: {
    id: 'titan', label: 'TITAN',
    desc: 'Heavy assault chassis. Hull 120, −8% speed.',
    health: 120, armor: 55, speed: 0.92, color: 0x4a3226, accent: 0xff3b4d,
    loadout: ['riptide', 'mauler'], weaponNote: 'RIPTIDE rifle + MAULER shotgun'
  }
};

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

/**
 * Player — first-person character controller.
 *
 * Movement model: exponential ground acceleration/friction with preserved
 * momentum in the air, plus sprint, crouch, slide, coyote-time jumps,
 * thruster double-jump and wall running. Camera feel (bob, tilt, land dip,
 * FOV kick, recoil recovery) lives here too, since it is driven directly by
 * movement state.
 */
export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    this.height = STAND_H;
    this.grounded = false;
    this.sliding = false;
    this.crouching = false;
    this.sprinting = false;
    this.wallrun = null; // { normal, side } while wall running

    this.health = 100;
    this.maxHealth = 100;
    this.armor = 50;
    this.maxArmor = 100;
    this.energy = 100;
    this.alive = true;

    // Set by the weapon system each frame (ADS zoom / slow-walk).
    this.fovScale = 1;
    this.moveMult = 1;

    this._moveResult = { onGround: false, wallNormal: null, wallRunOK: false, hitCeiling: false };
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._airJumps = 1;
    this._slideTime = 0;
    this._bobPhase = 0;
    this._bobAmp = 0;
    this._dip = 0;
    this._dipVel = 0;
    this._recoilP = 0;
    this._recoilY = 0;
    this._stepDist = 0;
    this._lastDamage = -10;
    this._hurtSoundAt = 0;
    this._fov = 80;
  }

  reset(spawn) {
    const op = this.game.operator;
    this._buildLegs(op);
    this._opSpeed = op.speed;
    this._opEnergy = op.energy || 1;
    // Health rides the ruleset too. Applied here rather than to the operator
    // definition so the operator table stays the game's real balance data and
    // FUN mode stays a multiplier on top of it.
    this.maxHealth = Math.round(op.health * (this.game.rules ? this.game.rules.health : 1));
    this._lastSafe = null;
    this._safeTimer = 0;
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = 0; // -Z: facing the plaza from the south spawn
    this.pitch = 0;
    this.roll = 0;
    this.health = this.maxHealth;
    // Recruits get a starting plate bonus on top of their operator's armor.
    const bonus = this.game.difficulty.armorBonus ?? 0;
    this.maxArmor = Math.max(this.maxArmor, op.armor + bonus);
    this.armor = op.armor + bonus;
    this.energy = 100;
    this.alive = true;
    this.height = STAND_H;
    this.sliding = false;
    this.wallrun = null;
    this.fovScale = 1;
    this.moveMult = 1;
    this._airJumps = 1;
    this._lastDamage = -10;
    this._fov = this.game.settings.fov;
  }

  /** First-person legs: look down and your body is actually there. */
  _buildLegs(op) {
    if (this._legRig) this.game.scene.remove(this._legRig);
    const rig = new THREE.Group();
    const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
    const jacket = new THREE.MeshStandardMaterial({ color: op.color, roughness: 0.8 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.95 });
    this._legPivots = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.14 * side, 0.95, 0.02);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.45, 0.2), pants);
      thigh.position.y = -0.24;
      hip.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.16), pants);
      shin.position.set(0, -0.62, 0.03);
      hip.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.3), boots);
      boot.position.set(0, -0.86, 0.07);
      hip.add(boot);
      hip.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      rig.add(hip);
      this._legPivots.push(hip);
    }
    const torsoHint = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.24), jacket);
    torsoHint.position.set(0, 1.05, 0.02);
    rig.add(torsoHint);
    this.game.scene.add(rig);
    this._legRig = rig;
  }

  _updateLegs(dt) {
    const rig = this._legRig;
    if (!rig) return;
    rig.position.copy(this.position);
    rig.rotation.y = this.yaw;
    // Squash when crouching/sliding so knees don't rise into the lens.
    const squash = this.height / STAND_H;
    rig.scale.y = 0.75 + squash * 0.25;
    const swing = Math.sin(this._bobPhase) * 0.55 * this._bobAmp;
    const air = !this.grounded ? 0.35 : 0;
    this._legPivots[0].rotation.x = swing + air;
    this._legPivots[1].rotation.x = -swing + air * 0.6;
  }

  /** Camera recoil kick, applied by weapons; recovers exponentially. */
  addRecoil(pitchKick, yawKick) {
    this._recoilP = Math.min(this._recoilP + pitchKick, 0.22);
    this._recoilY += yawKick;
  }

  /**
   * Active speed multiplier. 1 everywhere except GTAZ's FUN ruleset.
   *
   * Read fresh each time so the menu dial takes effect immediately; the cost
   * is a property lookup and a clamp, which is nothing against what the
   * movement solver does with the result.
   */
  get sc() {
    return this.game.rules ? this.game.rules.speed : 1;
  }

  /** Horizontal speed (m/s), used by HUD/weapons for bloom and bob. */
  get speedH() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get eyeHeight() {
    return this.height - 0.22;
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (!this.alive) return;
    const input = this.game.input;
    const now = performance.now() * 0.001;
    // Snapshot the ruleset's speed multiplier once for the frame, so every
    // threshold below is measured against the same number.
    const sc = this.sc;

    // --- Look (ADS gets its own sensitivity multiplier) -------------------
    const adsT = this.game.weapons ? this.game.weapons.adsT : 0;
    const sens = 0.0022 * this.game.settings.sensitivity *
      THREE.MathUtils.lerp(1, this.game.settings.adsSens, adsT);
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * (this.game.settings.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);

    // Staff power: free flight, straight through anything.
    if (this.game.admin && this.game.admin.fly) {
      this._fly(dt, input);
      return;
    }

    // --- Input intent -----------------------------------------------------
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.set(0, 0, 0);
    if (input.key('KeyW')) _wish.add(_fwd);
    if (input.key('KeyS')) _wish.sub(_fwd);
    if (input.key('KeyD')) _wish.add(_right);
    if (input.key('KeyA')) _wish.sub(_right);
    const hasInput = _wish.lengthSq() > 0;
    if (hasInput) _wish.normalize();

    const wantCrouch = input.key('ControlLeft') || input.key('KeyC');
    this.sprinting = input.key('ShiftLeft') && input.key('KeyW') && !wantCrouch && !this.sliding;

    if (input.pressed('Space')) this._jumpBuffer = 0.12;
    else this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.grounded ? 0.12 : Math.max(0, this._coyote - dt);

    // --- Crouch / slide ---------------------------------------------------
    const hSpeed = this.speedH;
    if (wantCrouch && !this.crouching && this.grounded && this.sprinting === false && hSpeed > 7 * sc && !this.sliding) {
      // Sprint momentum + crouch = slide (sprint flag already dropped above).
      this._startSlide();
    } else if (wantCrouch && this.grounded && hSpeed > 7 && !this.sliding && !this.crouching) {
      this._startSlide();
    }
    this.crouching = wantCrouch && !this.sliding;
    if (this.sliding) {
      this._slideTime -= dt;
      if (this._slideTime <= 0 || hSpeed < 3.5 || !wantCrouch || !this.grounded) this.sliding = false;
    }
    const targetH = (this.crouching || this.sliding) ? CROUCH_H : STAND_H;
    this.height = THREE.MathUtils.lerp(this.height, targetH, Math.min(1, dt * 12));

    // --- Wall running -----------------------------------------------------
    this._updateWallrun(dt, input, hasInput);

    // --- Acceleration -----------------------------------------------------
    if (this.wallrun) {
      // Reduced gravity, velocity glued to the wall plane.
      this.velocity.y = Math.max(this.velocity.y - GRAVITY * 0.12 * dt, -2.5);
      const n = this.wallrun.normal;
      const vn = this.velocity.x * n.x + this.velocity.z * n.z;
      this.velocity.x -= n.x * vn;
      this.velocity.z -= n.z * vn;
      // Keep a healthy pace along the wall.
      const h = this.speedH;
      if (h > 0.1 && h < 6.5 * sc) {
        const k = 6.5 * sc / h;
        this.velocity.x *= k;
        this.velocity.z *= k;
      }
      this.energy = Math.max(0, this.energy - 26 * dt);
    } else if (this.grounded && !this.sliding) {
      const speed = (this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED)
        * sc * this.moveMult * (this._opSpeed || 1)
        * (this.game.momentum ? this.game.momentum.speedBonus : 1);
      const k = 1 - Math.exp(-(hasInput ? 13 : 10) * dt);
      this.velocity.x += (_wish.x * speed - this.velocity.x) * k;
      this.velocity.z += (_wish.z * speed - this.velocity.z) * k;
      this.velocity.y -= GRAVITY * dt;
    } else if (this.sliding) {
      // Low friction + light steering; the fun is keeping the momentum.
      const k = 1 - Math.exp(-1.1 * dt);
      this.velocity.x -= this.velocity.x * k;
      this.velocity.z -= this.velocity.z * k;
      if (hasInput) {
        this.velocity.x += _wish.x * 6 * sc * dt;
        this.velocity.z += _wish.z * 6 * sc * dt;
      }
      this.velocity.y -= GRAVITY * dt;
    } else {
      // Airborne: additive control, capped so momentum is preserved not grown.
      const preH = this.speedH;
      if (hasInput) {
        this.velocity.x += _wish.x * AIR_ACCEL * sc * dt;
        this.velocity.z += _wish.z * AIR_ACCEL * sc * dt;
        const cap = Math.max(preH, SPRINT_SPEED * sc);
        const h = this.speedH;
        if (h > cap) {
          const s = cap / h;
          this.velocity.x *= s;
          this.velocity.z *= s;
        }
      }
      this.velocity.y -= GRAVITY * dt;
    }

    // --- Jumps ------------------------------------------------------------
    if (this._jumpBuffer > 0) {
      if (this.wallrun) {
        const n = this.wallrun.normal;
        this.velocity.x += n.x * 7.5;
        this.velocity.z += n.z * 7.5;
        this.velocity.y = 7.2;
        this.wallrun = null;
        this._jumpBuffer = 0;
        this.game.audio.jump();
      } else if (this.grounded || this._coyote > 0) {
        // Pushing off sand drives it down and back from both feet.
        this.game.freeRoam?.sandFX?.takeoff(this.position, this.velocity);
        this.velocity.y = JUMP_VEL * (this.sliding ? 1.05 : 1);
        this.grounded = false;
        this._coyote = 0;
        this._jumpBuffer = 0;
        this.game.audio.jump();
      } else if (this._airJumps > 0 && this.energy >= 30) {
        this.velocity.y = BOOST_VEL;
        this._airJumps--;
        this.energy -= 30;
        this._jumpBuffer = 0;
        _v1.copy(this.position);
        this.game.effects.thrust(_v1);
        this.game.audio.boost();
      }
    }

    // --- Integrate + collide ----------------------------------------------
    const wasGrounded = this.grounded;
    const fallSpeed = -this.velocity.y;
    this.game.physics.moveCapsule(this.position, RADIUS, this.height, this.velocity, dt, this._moveResult);
    this.grounded = this._moveResult.onGround;

    // Ground snap when running down ramps/steps.
    //
    // The probe length has to scale with how fast you are going. A frame at
    // walking pace covers 14 cm and a fixed 0.62 m probe always found the
    // floor; a frame at full sprint covers most of a metre, and over anything
    // but billiard-table ground you land the next test airborne. The player
    // then skips across the city like a stone, never touching down long enough
    // for the ground-acceleration branch to run — which is why 7x speed
    // topped out at 32 m/s instead of 59 and steered like a paper aeroplane.
    //
    // Allowing a little upward velocity matters for the same reason: cresting
    // a rise at speed gives you a positive vy that has nothing to do with
    // jumping. A real jump leaves at 8.2, so 2.0 separates the two cleanly.
    if (!this.grounded && wasGrounded && this.velocity.y <= 2.0) {
      const reach = 0.62 + this.speedH * dt * 0.9;
      _v1.set(this.position.x, this.position.y + 0.3, this.position.z);
      const hit = this.game.physics.raycast(_v1, _down, reach);
      if (hit && hit.normal.y > 0.55) {
        this.position.y -= hit.dist - 0.3;
        this.grounded = true;
        this.velocity.y = 0;
      } else if (this.game.physics.terrain) {
        // The raycast only knows about boxes. Out on open ground the terrain
        // height field is the floor, and it was never consulted here at all.
        const gy = this.game.physics.terrain(this.position.x, this.position.z);
        if (this.position.y - gy < reach - 0.3) {
          this.position.y = gy;
          this.grounded = true;
          this.velocity.y = 0;
        }
      }
    }

    if (this.grounded) {
      this._airJumps = 1;
      // Landing on sand throws a ring of it out from your feet, sized by how
      // hard you came down, and leaves a pit.
      if (!wasGrounded && fallSpeed > 2.5) {
        this.game.freeRoam?.sandFX?.land(this.position, fallSpeed, this.velocity);
      }
      if (!wasGrounded && fallSpeed > 7) {
        if (this.game.settings.shake) this._dipVel -= Math.min(fallSpeed * 0.02, 0.3);
        this.game.audio.land(Math.min(fallSpeed / 20, 1));
      }
      this.energy = Math.min(100, this.energy + 26 * this._opEnergy * dt);
    } else {
      this.energy = Math.min(100, this.energy + 6 * this._opEnergy * dt);
    }

    // --- Jump pads ----------------------------------------------------------
    for (const pad of this.game.world.jumpPads) {
      pad.cooldown = Math.max(0, pad.cooldown - dt);
      if (pad.cooldown > 0) continue;
      const dx = this.position.x - pad.pos.x;
      const dz = this.position.z - pad.pos.z;
      if (dx * dx + dz * dz < pad.radius * pad.radius && Math.abs(this.position.y - pad.pos.y) < 1) {
        this.velocity.y = pad.power;
        this.grounded = false;
        pad.cooldown = 0.6;
        this._airJumps = 1;
        _v1.set(pad.pos.x, pad.pos.y + 0.3, pad.pos.z);
        this.game.effects.thrust(_v1);
        this.game.effects.flash(_v1, 0xffb347, 40, 0.15);
        this.game.audio.boost();
      }
    }

    // --- Health / anti-glitch failsafes --------------------------------------
    // Easier tiers regenerate sooner and faster.
    const diff = this.game.difficulty;
    const regenDelay = diff.regenDelay ?? 4.5;
    const regenRate = diff.regenRate ?? 24;
    // Regeneration is a MODE decision, not a global one.
    //
    // Skirmish and the campaign want it: those are fights you are meant to
    // walk away from and keep pushing.
    //
    // GTAZ does not — the tension of going into a cave with ten hostiles in
    // it evaporates if the damage heals itself on the walk between chambers.
    // Down there the only way back to full is to go and buy food.
    //
    // BATTLEGROUND does not either, and for a sharper reason: free healing
    // rewards disengaging. Every fight becomes back off, wait, re-enter at
    // full, and the shrinking circle stops mattering. Shields and medkits are
    // already in the loot pool, so the health you get back should be health
    // you went and found.
    const regenAllowed = !this.game.isGTAZ && !this.game.isBR;
    if (regenAllowed && now - this._lastDamage > regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + regenRate * dt);
    }

    // NaN guard: if the sim ever produces garbage, recover instead of dying.
    if (!Number.isFinite(this.position.x + this.position.y + this.position.z) ||
        !Number.isFinite(this.velocity.x + this.velocity.y + this.velocity.z)) {
      this.position.copy(this._lastSafe || this.game.world.playerSpawn);
      this.velocity.set(0, 0, 0);
    }
    // Speed caps: no physics blowups past what movement can legitimately reach.
    // This is a garbage guard, not a design limit, so it has to sit above what
    // movement can actually produce — at a flat 32 it WAS the design limit, and
    // quietly held the 7x sprint down to 32 m/s no matter what the movement
    // code asked for.
    const hNow = this.speedH;
    const hCap = 32 * this.sc;
    if (hNow > hCap) {
      const k = hCap / hNow;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -45, 45);
    // Remember the last spot that was solid ground…
    if (this.grounded && this.position.y > -1) {
      this._safeTimer += dt;
      if (this._safeTimer > 0.5) {
        this._safeTimer = 0;
        (this._lastSafe || (this._lastSafe = new THREE.Vector3())).copy(this.position);
      }
    }
    // …and if we ever clip out of the world, snap back there instead of dying.
    //
    // The floor of the world is not a constant. GTAZ builds dungeon complexes
    // at -60, which a fixed -8 threshold treated as falling through the map:
    // you dropped down a hatch and were instantly yanked back to the street
    // with damage. Modes that build real geometry below ground lower this.
    if (this.position.y < (this.voidY ?? -8)) {
      this.position.copy(this._lastSafe || this.game.world.playerSpawn);
      this.velocity.set(0, 0, 0);
      this.damage(10, null);
      this.game.hud.comms('Deck integrity fault detected — position restored.', 'TACNET');
    }

    // --- Camera + body -------------------------------------------------------
    this._updateCamera(dt, hSpeed);
    this._updateLegs(dt);

    // --- Footsteps ------------------------------------------------------------
    // On sand, every real step presses a print and kicks grains off the heel —
    // at a true pace length, not the audio stride, or the trail would be one
    // print every two metres.
    const sand = this.game.freeRoam?.sandFX;
    if (sand && this.grounded && hSpeed > 0.8) {
      this._sandStep = (this._sandStep || 0) + hSpeed * dt;
      const pace = (this.sprinting ? 1.15 : 0.74) * this.sc;
      if (this._sandStep > pace) {
        this._sandStep = 0;
        this._foot = -(this._foot || 1);
        sand.step(this.position, this.yaw, this.sprinting, hSpeed, this._foot);
      }
    }
    if (this.grounded && !this.sliding && hSpeed > 1.5 * this.sc) {
      this._stepDist += hSpeed * dt;
      // Stride scales with the speed multiplier. It has to: the trigger is a
      // distance, so leaving it at 3.1 m while covering 59 m/s fires nineteen
      // footsteps a second, which is not a run — it is a buzzsaw.
      const stride = (this.sprinting ? 3.1 : 2.3) * this.sc;
      if (this._stepDist > stride) {
        this._stepDist = 0;
        this.game.audio.footstep(this.sprinting);
        // Press a boot print into the soil. The trail holds 30; step 31
        // recycles the oldest slot, so the first print is the one erased.
        if (this.game.footprints) {
          this.game.footprints.step(this.position, this.yaw);
        }
      }
    }
  }

  _startSlide() {
    this.sliding = true;
    this._slideTime = 1.0;
    const h = this.speedH;
    const boost = Math.max(h, 10.8);
    if (h > 0.1) {
      const k = boost / h;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }
    this.game.audio.slide();
  }

  _updateWallrun(dt, input, hasInput) {
    if (this.wallrun) {
      // Confirm the wall is still there; nudge back onto it.
      const side = this.wallrun.side;
      _v1.set(-this.wallrun.normal.x, 0, -this.wallrun.normal.z);
      const origin = _v1.copy(this.position).setY(this.position.y + 1.0);
      const towards = _fwd.set(-this.wallrun.normal.x, 0, -this.wallrun.normal.z);
      const hit = this.game.physics.raycast(origin, towards, 1.1);
      const stillValid = hit && Math.abs(hit.normal.y) < 0.3 &&
        input.key('KeyW') && !this.grounded && this.energy > 1 && this.speedH > 3 * this.sc;
      if (!stillValid) {
        this.wallrun = null;
      } else {
        this.wallrun.normal.copy(hit.normal);
        if (hit.dist > 0.75) {
          this.velocity.x -= hit.normal.x * 2.2;
          this.velocity.z -= hit.normal.z * 2.2;
        }
        return;
      }
      // fallthrough: just detached — try to reacquire below
    }

    if (this.grounded || !input.key('KeyW') || this.speedH < 4.5 * this.sc || this.velocity.y > 4 || this.energy < 8) return;

    // Probe both sides for a runnable wall.
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); // camera-right on XZ
    _v1.set(this.position.x, this.position.y + 1.0, this.position.z);
    const hitR = this.game.physics.raycast(_v1, _right, 0.95);
    _fwd.copy(_right).negate();
    const hitL = this.game.physics.raycast(_v1, _fwd, 0.95);

    const pick = (hitR && Math.abs(hitR.normal.y) < 0.3) ? { hit: hitR, side: 1 }
      : (hitL && Math.abs(hitL.normal.y) < 0.3) ? { hit: hitL, side: -1 }
        : null;
    if (pick) {
      this.wallrun = { normal: pick.hit.normal.clone(), side: pick.side };
      this.velocity.y = Math.max(this.velocity.y, 1.5);
    }
  }

  /** Staff flight: look where you want to go. No gravity, no collision. */
  _fly(dt, input) {
    const cp = Math.cos(this.pitch);
    _fwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish.set(0, 0, 0);
    if (input.key('KeyW')) _wish.add(_fwd);
    if (input.key('KeyS')) _wish.sub(_fwd);
    if (input.key('KeyD')) _wish.add(_right);
    if (input.key('KeyA')) _wish.sub(_right);
    if (input.key('Space')) _wish.y += 1;
    if (input.key('ControlLeft') || input.key('KeyC')) _wish.y -= 1;
    if (_wish.lengthSq() > 0) _wish.normalize();
    const speed = input.key('ShiftLeft') ? 70 : 20;
    this.position.addScaledVector(_wish, speed * dt);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
    this.wallrun = null;
    this._updateCamera(dt, 0);
  }

  _updateCamera(dt, hSpeed) {
    const cam = this.camera;

    // Head bob while running on the ground (can be disabled in settings).
    const bobTarget = (this.grounded && !this.sliding && hSpeed > 1 * this.sc && this.game.settings.bob)
      ? Math.min(hSpeed / SPRINT_SPEED, 1) : 0;
    this._bobAmp += (bobTarget - this._bobAmp) * Math.min(1, dt * 8);
    // Bob phase is driven by distance travelled, so it needs the same divisor
    // as the stride or the camera turns into a paint mixer.
    this._bobPhase += (hSpeed / this.sc) * dt * (this.grounded ? 1.35 : 0);
    const bobY = Math.sin(this._bobPhase * 2) * 0.028 * this._bobAmp;
    const bobX = Math.cos(this._bobPhase) * 0.02 * this._bobAmp;

    // Landing dip spring.
    this._dipVel += -this._dip * 120 * dt;
    this._dipVel *= Math.exp(-9 * dt);
    this._dip += this._dipVel * dt;

    cam.position.set(
      this.position.x + bobX * Math.cos(this.yaw),
      this.position.y + this.eyeHeight + bobY + this._dip,
      this.position.z - bobX * Math.sin(this.yaw)
    );

    // Roll: wall-run lean + subtle strafe lean.
    let rollTarget = 0;
    if (this.wallrun) rollTarget = this.wallrun.side * 0.21;
    else {
      const lateral = this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
      rollTarget = THREE.MathUtils.clamp(-lateral * 0.006, -0.03, 0.03);
    }
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 9);

    // Recoil recovery.
    this._recoilP *= Math.exp(-8 * dt);
    this._recoilY *= Math.exp(-8 * dt);

    cam.rotation.set(this.pitch + this._recoilP, this.yaw + this._recoilY, this.roll);

    // FOV: base setting, ADS zoom (fovScale), sprint/slide kick.
    const kick = this.sliding ? 1.08 : (this.sprinting && hSpeed > 6 ? 1.05 : 1);
    const target = this.game.settings.fov * this.fovScale * kick;
    this._fov += (target - this._fov) * Math.min(1, dt * 11);
    if (Math.abs(cam.fov - this._fov) > 0.01) {
      cam.fov = this._fov;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ damage

  /**
   * Apply incoming damage. Armor plates absorb 55% of what remains of them.
   */
  damage(amount, fromPos) {
    if (!this.alive) return;
    if (this.game.admin && this.game.admin.god) return;
    const absorbed = Math.min(this.armor, amount * 0.55);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this._lastDamage = performance.now() * 0.001;

    this.game.hud.damageFlash();
    if (this.game.momentum) this.game.momentum.onPlayerHit(amount);
    const now = this._lastDamage;
    if (now - this._hurtSoundAt > 0.35) {
      this._hurtSoundAt = now;
      this.game.audio.hurt();
      // Your character reacts out loud; harder hits hit harder.
      this.game.audio.playerHurt(Math.min(1, amount / 40));
      // Once you're badly hurt, you start breathing heavy.
      if (this.health < this.maxHealth * 0.35) {
        this.game.audio.playerGasp();
      }
    }

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.game.onPlayerDeath();
    }
  }
}
