import * as THREE from 'three';

const _v = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * ThirdPerson — the over-the-shoulder camera used in BATTLEGROUND.
 *
 * Three problems have to be solved for a third-person shooter to feel right:
 *
 *  1. WHERE YOU SHOOT. The camera sits behind and left of the character, but
 *     bullets must leave the *gun*. So the aim ray is cast from the camera,
 *     and the body is then turned to face wherever that ray lands. Without
 *     this, the crosshair and the barrel disagree and nothing feels accurate.
 *  2. WALLS. A trailing camera will happily bury itself in geometry, so the
 *     boom is raycast every frame and pulled in to the first obstruction.
 *  3. WEIGHT. Snapping the camera to the character reads as cheap. The boom
 *     follows on a critically damped spring so it lags a little and settles
 *     without wobbling.
 *
 * Aiming pulls the camera in tight over the shoulder and narrows the FOV,
 * which is the standard language for "you are now precise".
 */

const HIP = { dist: 4.2, height: 1.75, side: 0.75, fov: 1.0 };
const ADS = { dist: 1.9, height: 1.6, side: 0.55, fov: 0.82 };

export class ThirdPerson {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.blend = 0;                    // 0 = first person, 1 = third
    this.smoothed = new THREE.Vector3();
    this.body = null;
    this._initialised = false;
  }

  /** Build the visible character. Only made once, reused across matches. */
  _buildBody() {
    if (this.body) {
      this.game.scene.remove(this.body);
      this.body.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const op = this.game.operator;
    const g = new THREE.Group();

    const suit = new THREE.MeshStandardMaterial({ color: op.color, roughness: 0.72, metalness: 0.18 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.82, metalness: 0.25 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc08a63, roughness: 0.85 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.92 });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x0a0f14, emissive: op.accent, emissiveIntensity: 2.0, roughness: 0.4
    });

    const add = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // --- Legs, hip-pivoted so they can stride --------------------------
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.15 * side, 0.92, 0);
      g.add(hip);
      add(new THREE.BoxGeometry(0.18, 0.44, 0.21), suit, 0, -0.23, 0, hip);
      add(new THREE.BoxGeometry(0.15, 0.4, 0.18), suit, 0, -0.62, 0.02, hip);
      add(new THREE.BoxGeometry(0.17, 0.12, 0.3), boot, 0, -0.86, 0.05, hip);
      add(new THREE.BoxGeometry(0.19, 0.1, 0.22), gear, 0, -0.4, 0.02, hip);   // knee pad
      this.legs.push(hip);
    }

    // --- Torso -----------------------------------------------------------
    this.torso = new THREE.Group();
    this.torso.position.y = 1.02;
    g.add(this.torso);
    add(new THREE.BoxGeometry(0.46, 0.58, 0.27), suit, 0, 0.2, 0, this.torso);
    add(new THREE.BoxGeometry(0.42, 0.42, 0.32), gear, 0, 0.22, 0, this.torso);  // plate carrier
    add(new THREE.BoxGeometry(0.09, 0.11, 0.05), gear, -0.11, 0.28, 0.17, this.torso);
    add(new THREE.BoxGeometry(0.09, 0.11, 0.05), gear, 0.11, 0.28, 0.17, this.torso);
    add(new THREE.BoxGeometry(0.07, 0.06, 0.04), glow, 0, 0.4, 0.17, this.torso);
    add(new THREE.BoxGeometry(0.34, 0.34, 0.16), gear, 0, 0.2, -0.2, this.torso); // pack
    add(new THREE.BoxGeometry(0.44, 0.1, 0.28), gear, 0, -0.1, 0, this.torso);    // belt

    // --- Arms, shoulder-pivoted -------------------------------------------
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.3 * side, 0.4, 0);
      this.torso.add(sh);
      add(new THREE.BoxGeometry(0.15, 0.11, 0.22), gear, 0, 0.02, 0, sh);       // pauldron
      add(new THREE.BoxGeometry(0.12, 0.3, 0.14), suit, 0, -0.17, 0, sh);
      add(new THREE.BoxGeometry(0.1, 0.28, 0.12), skin, 0, -0.44, 0.03, sh);
      add(new THREE.BoxGeometry(0.1, 0.1, 0.12), suit, 0, -0.6, 0.05, sh);      // glove
      this.arms.push(sh);
    }

    // --- Head --------------------------------------------------------------
    this.head = new THREE.Group();
    this.head.position.y = 1.62;
    g.add(this.head);
    add(new THREE.SphereGeometry(0.18, 14, 12), suit, 0, 0, 0, this.head);       // helmet
    add(new THREE.BoxGeometry(0.3, 0.08, 0.12), glow, 0, 0.01, 0.14, this.head); // visor
    add(new THREE.BoxGeometry(0.06, 0.1, 0.06), gear, 0.17, 0.02, 0, this.head); // comms pod

    // --- Carried weapon ------------------------------------------------------
    this.gun = new THREE.Group();
    this.gun.position.set(0.26, 0.12, 0.2);
    this.torso.add(this.gun);
    add(new THREE.BoxGeometry(0.08, 0.1, 0.62), gear, 0, 0, 0, this.gun);
    add(new THREE.BoxGeometry(0.05, 0.14, 0.07), gear, 0, -0.11, 0.12, this.gun);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.4), glow, 0, 0.06, -0.05, this.gun);

    g.visible = false;
    this.game.scene.add(g);
    this.body = g;
    this._phase = 0;
  }

  setEnabled(on) {
    if (on && !this.body) this._buildBody();
    this.enabled = on;
    if (this.body) this.body.visible = on;
    // Hide the first-person arms/weapon when the body is on show.
    if (this.game.weapons && this.game.weapons.rig) {
      this.game.weapons.rig.visible = !on;
    }
    if (this.game.player && this.game.player._legRig) {
      this.game.player._legRig.visible = !on;
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    this.game.hud.brToast?.(
      this.enabled ? 'THIRD PERSON' : 'FIRST PERSON', 'Press T to switch'
    );
    return this.enabled;
  }

  /** Rebuild the body when the operator changes between matches. */
  refresh() {
    if (this.body) this._buildBody();
    if (this.body) this.body.visible = this.enabled;
  }

  /**
   * Where the camera is actually looking — used so bullets converge on the
   * crosshair instead of firing parallel to it.
   *
   * Two subtleties, both learned the hard way:
   *
   *  - The ray must test ACTORS as well as world geometry. Aiming only at
   *    terrain means a target standing in front of a distant hill resolves to
   *    the hill, and on a downward shot the ray grazes the ground a couple of
   *    metres short of them — so the muzzle fires into the dirt at their feet.
   *  - Very near hits are rejected. The camera sits behind the character, so
   *    a ray leaving it can clip scenery beside the shoulder that the player
   *    can plainly see past. Anything closer than the boom length is treated
   *    as not-really-in-the-way and the aim carries on to full range.
   */
  aimPoint(out = new THREE.Vector3()) {
    const g = this.game;
    const cam = g.camera;
    cam.getWorldDirection(_dir);

    // Ignore anything between the camera and the character's own position.
    const skip = cam.position.distanceTo(g.player.position) + 0.6;

    // Actors are tested at full range and win outright. That looks like it
    // would let you shoot through walls, but it can't: this only decides where
    // the rounds CONVERGE. _resolveShot still traces the real path from the
    // muzzle, so a target behind cover still stops the bullet. Clamping actors
    // to the world hit instead would be actively wrong, because the terrain
    // march is coarse enough to report a graze in front of a target standing
    // in the open, which is exactly the case that must keep working.
    const actors = g.isBR && g.br ? g.br : g.enemies;
    if (actors && actors.raycast) {
      const a = actors.raycast(cam.position, _dir, 300);
      if (a && a.dist > skip) return out.copy(cam.position).addScaledVector(_dir, a.dist);
    }

    const world = g.physics.raycast(cam.position, _dir, 300);
    const best = world && world.dist > skip ? world.dist : 300;
    return out.copy(cam.position).addScaledVector(_dir, best);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!this.enabled || !p) return;

    const adsT = g.weapons ? g.weapons.adsT : 0;
    const mode = {
      dist: THREE.MathUtils.lerp(HIP.dist, ADS.dist, adsT),
      height: THREE.MathUtils.lerp(HIP.height, ADS.height, adsT),
      side: THREE.MathUtils.lerp(HIP.side, ADS.side, adsT)
    };

    // Pivot point sits at the character's shoulders.
    const pivot = _v.set(p.position.x, p.position.y + mode.height, p.position.z);

    // Boom direction is straight back along the look vector.
    const cp = Math.cos(p.pitch);
    _dir.set(
      Math.sin(p.yaw) * cp,
      Math.sin(p.pitch),
      Math.cos(p.yaw) * cp
    ).normalize();

    // Shoulder offset, perpendicular to the look direction.
    _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    _desired.copy(pivot)
      .addScaledVector(_dir, mode.dist)
      .addScaledVector(_right, mode.side);

    // Pull the boom in if it would pass through geometry.
    _fwd.copy(_desired).sub(pivot);
    const boomLen = _fwd.length();
    _fwd.divideScalar(boomLen);
    const hit = g.physics.raycast(pivot, _fwd, boomLen + 0.35);
    if (hit) {
      _desired.copy(pivot).addScaledVector(_fwd, Math.max(0.6, hit.dist - 0.3));
    }
    // Never let it drop below the ground on a big island.
    const island = g.world && g.world.island;
    if (island) {
      const floor = island.heightAt(_desired.x, _desired.z) + 0.45;
      if (_desired.y < floor) _desired.y = floor;
    }

    // Critically damped follow — lags slightly, settles without wobble.
    const k = 1 - Math.exp(-16 * dt);
    this.smoothed.lerp(_desired, k);
    g.camera.position.copy(this.smoothed);
    g.camera.rotation.set(p.pitch, p.yaw, p.roll * 0.4);

    this._animateBody(dt, p, adsT);
  }

  _animateBody(dt, p, adsT) {
    const b = this.body;
    if (!b) return;

    b.position.set(p.position.x, p.position.y, p.position.z);
    // The body turns to face where you're aiming, not where the camera sits.
    b.rotation.y = p.yaw + Math.PI;

    // Crouch/slide squash.
    const squash = p.height / 1.8;
    b.scale.y = 0.78 + squash * 0.22;

    // Stride from actual horizontal speed.
    const speed = p.speedH;
    this._phase += speed * dt * 1.6;
    const swing = Math.sin(this._phase) * Math.min(0.62, speed * 0.09);
    const airborne = !p.grounded;
    this.legs[0].rotation.x = airborne ? 0.4 : swing;
    this.legs[1].rotation.x = airborne ? 0.15 : -swing;

    // Arms counter-swing, and both come up when aiming.
    const aimRaise = -1.15 * adsT;
    this.arms[0].rotation.x = aimRaise + (airborne ? -0.3 : -swing * 0.55);
    this.arms[1].rotation.x = aimRaise - 0.55 + (airborne ? -0.2 : swing * 0.3);
    this.arms[1].rotation.z = -0.25 - adsT * 0.2;

    // Head and torso lean into the pitch so the character looks where you do.
    this.head.rotation.x = p.pitch * 0.55;
    this.torso.rotation.x = p.pitch * 0.28;
    this.torso.rotation.z = p.roll * 0.5;

    // Weapon swings up to the shoulder when aiming.
    this.gun.rotation.x = -0.15 + adsT * 0.15;
    this.gun.position.set(0.26 - adsT * 0.2, 0.12 + adsT * 0.12, 0.2 + adsT * 0.06);
  }

  dispose() {
    if (this.body) this.game.scene.remove(this.body);
    this.body = null;
  }
}
