import * as THREE from 'three';

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Effects — pooled visual effects. Nothing here allocates during gameplay:
 * particles live in one THREE.Points buffer, tracers/decals/flash-lights are
 * fixed pools recycled oldest-first.
 */
export class Effects {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;

    this._initParticles(1400);
    this._initCasings(40);
    this._initTracers(28);
    this._initDecals(64);
    this._initFlashes(6);
  }

  // ------------------------------------------------------------- particles

  _initParticles(max) {
    this.pMax = max;
    this.pPos = new Float32Array(max * 3);
    this.pVel = new Float32Array(max * 3);
    this.pCol = new Float32Array(max * 3);
    this.pBase = new Float32Array(max * 3); // spawn color, faded toward black
    this.pLife = new Float32Array(max);     // remaining life
    this.pDur = new Float32Array(max);      // total life
    this.pGrav = new Float32Array(max);
    this.pCursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    // Never let the whole cloud get culled by a stale bounding sphere.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Park unused particles far below the map.
    for (let i = 0; i < max; i++) this.pPos[i * 3 + 1] = -1000;
  }

  /**
   * Emit a radial burst of particles.
   * @param {THREE.Vector3} pos origin
   * @param {object} o { count, color, speed, life, gravity, dir, spread }
   */
  burst(pos, o = {}) {
    const count = o.count ?? 12;
    const color = new THREE.Color(o.color ?? 0xffc873);
    const speed = o.speed ?? 5;
    const life = o.life ?? 0.5;
    const gravity = o.gravity ?? 9;
    for (let n = 0; n < count; n++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.pMax;
      const i3 = i * 3;
      this.pPos[i3] = pos.x; this.pPos[i3 + 1] = pos.y; this.pPos[i3 + 2] = pos.z;
      // Random direction, optionally biased along o.dir.
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      if (o.dir) {
        const bias = o.spread ?? 0.5;
        dx = o.dir.x + dx * bias; dy = o.dir.y + dy * bias; dz = o.dir.z + dz * bias;
      }
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pVel[i3] = dx * s; this.pVel[i3 + 1] = dy * s; this.pVel[i3 + 2] = dz * s;
      this.pBase[i3] = color.r; this.pBase[i3 + 1] = color.g; this.pBase[i3 + 2] = color.b;
      const l = life * (0.6 + Math.random() * 0.8);
      this.pLife[i] = l; this.pDur[i] = l;
      this.pGrav[i] = gravity;
    }
  }

  _updateParticles(dt) {
    for (let i = 0; i < this.pMax; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) {
        this.pPos[i3 + 1] = -1000;
        this.pCol[i3] = this.pCol[i3 + 1] = this.pCol[i3 + 2] = 0;
        continue;
      }
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      // Additive blending: fading color toward black fades the particle out.
      const f = this.pLife[i] / this.pDur[i];
      this.pCol[i3] = this.pBase[i3] * f;
      this.pCol[i3 + 1] = this.pBase[i3 + 1] * f;
      this.pCol[i3 + 2] = this.pBase[i3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // --------------------------------------------------------------- tracers

  _initTracers(max) {
    this.tracers = [];
    const geo = new THREE.CylinderGeometry(0.016, 0.016, 1, 5, 1, true);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x37e6ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this._tCursor = 0;
  }

  /** Flash a light beam between two points, fading over ~70 ms. */
  tracer(from, to, color = 0x37e6ff) {
    const t = this.tracers[this._tCursor];
    this._tCursor = (this._tCursor + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.4) return;
    t.mesh.visible = true;
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 0.85;
    t.mesh.scale.set(1, len, 1);
    t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    _v.subVectors(to, from).normalize();
    t.mesh.quaternion.setFromUnitVectors(_up, _v);
    t.life = 0.07;
  }

  _updateTracers(dt) {
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, (t.life / 0.07) * 0.85);
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  // ---------------------------------------------------------------- decals

  _initDecals(max) {
    this.decals = [];
    const geo = new THREE.CircleGeometry(0.07, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x090a0c,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });
    for (let i = 0; i < max; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.decals.push({ mesh, life: 0 });
    }
    this._dCursor = 0;
  }

  /** Bullet impact mark aligned to the surface normal. */
  decal(point, normal) {
    const d = this.decals[this._dCursor];
    this._dCursor = (this._dCursor + 1) % this.decals.length;
    d.mesh.visible = true;
    d.mesh.material.opacity = 0.85;
    d.mesh.position.copy(point).addScaledVector(normal, 0.012);
    _v.copy(point).add(normal);
    d.mesh.lookAt(_v);
    d.life = 9;
  }

  _updateDecals(dt) {
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.85;
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  // --------------------------------------------------------------- flashes

  _initFlashes(max) {
    this.flashes = [];
    for (let i = 0; i < max; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 9, 2);
      light.visible = false;
      this.scene.add(light);
      this.flashes.push({ light, life: 0 });
    }
    this._fCursor = 0;
  }

  /** Brief point-light pop (muzzle flashes, deaths, pad launches). */
  flash(pos, color = 0xffc873, intensity = 26, duration = 0.05) {
    const f = this.flashes[this._fCursor];
    this._fCursor = (this._fCursor + 1) % this.flashes.length;
    f.light.visible = true;
    f.light.color.set(color);
    f.light.intensity = intensity;
    f.light.position.copy(pos);
    f.life = duration;
    f.dur = duration;
    f.max = intensity;
  }

  _updateFlashes(dt) {
    for (const f of this.flashes) {
      if (!f.light.visible) continue;
      f.life -= dt;
      f.light.intensity = Math.max(0, (f.life / f.dur)) * f.max;
      if (f.life <= 0) f.light.visible = false;
    }
  }

  // -------------------------------------------------------------- compound

  // --------------------------------------------------------------- casings

  /** Spent brass: real little cylinders that tumble, bounce and settle. */
  _initCasings(max) {
    this.casings = [];
    const geo = new THREE.CylinderGeometry(0.011, 0.0125, 0.045, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9a227, roughness: 0.32, metalness: 0.95
    });
    for (let i = 0; i < max; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.casings.push({
        mesh,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        rest: false
      });
    }
    this._cCursor = 0;
  }

  /**
   * Eject a casing from the weapon's port, kicked right-and-back the way a
   * real action throws them.
   */
  ejectCasing(pos, right, forward) {
    const c = this.casings[this._cCursor];
    this._cCursor = (this._cCursor + 1) % this.casings.length;
    c.mesh.visible = true;
    c.mesh.position.copy(pos);
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    c.vel.copy(right).multiplyScalar(2.1 + Math.random() * 1.1);
    c.vel.addScaledVector(forward, -0.7 - Math.random() * 0.5);
    c.vel.y += 1.5 + Math.random() * 0.9;
    c.spin.set(
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 26
    );
    c.life = 6;
    c.rest = false;
  }

  _updateCasings(dt) {
    for (const c of this.casings) {
      if (!c.mesh.visible) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      if (c.rest) continue;

      c.vel.y -= 22 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;

      // Bounce off the deck, losing energy each time, then lie still.
      if (c.mesh.position.y < 0.012) {
        c.mesh.position.y = 0.012;
        if (Math.abs(c.vel.y) < 0.55) {
          c.rest = true;
          c.mesh.rotation.x = Math.PI / 2;
          c.mesh.rotation.z = Math.random() * Math.PI;
        } else {
          c.vel.y *= -0.36;
          c.vel.x *= 0.62;
          c.vel.z *= 0.62;
          c.spin.multiplyScalar(0.55);
          if (this.game.audio) this.game.audio.casing();
        }
      }
    }
  }

  /**
   * Bullet hitting the world. What comes off depends on what was hit:
   * metal throws sparks, wood throws splinters, soil throws a dirt plume,
   * foliage just bursts into shredded leaves.
   */
  impact(point, normal, color = 0xffc873, surface = 'metal') {
    switch (surface) {
      case 'wood': {
        // Pale splinters flying along the shot, plus dark dust from the bore.
        this.burst(point, { count: 12, color: 0xa8814e, speed: 5.5, life: 0.5, gravity: 14, dir: normal, spread: 0.75 });
        this.burst(point, { count: 5, color: 0x4a3421, speed: 1.4, life: 0.7, gravity: 2, dir: normal, spread: 1.3 });
        this.decal(point, normal);
        if (this.game.audio) this.game.audio.impactWood();
        break;
      }
      case 'soil': {
        // Dirt kicks up and falls back down — no sparks, no decal ring.
        this.burst(point, { count: 16, color: 0x6b5636, speed: 3.6, life: 0.7, gravity: 17, dir: normal, spread: 0.9 });
        this.burst(point, { count: 7, color: 0x8a7550, speed: 1.1, life: 1.0, gravity: -0.4, dir: normal, spread: 1.5 });
        if (this.game.audio) this.game.audio.impactSoil();
        break;
      }
      case 'foliage': {
        this.burst(point, { count: 14, color: 0x4e8c3c, speed: 3.2, life: 0.9, gravity: 5, dir: normal, spread: 1.4 });
        if (this.game.audio) this.game.audio.impactFoliage();
        break;
      }
      default: {
        // Metal: hot sparks that arc off, plus grey dust and a scorch mark.
        this.burst(point, { count: 9, color, speed: 5.5, life: 0.35, gravity: 16, dir: normal, spread: 0.7 });
        this.burst(point, { count: 4, color: 0x3d4148, speed: 1.2, life: 0.55, gravity: -0.6, dir: normal, spread: 1.2 });
        this.decal(point, normal);
        if (this.game.audio) this.game.audio.impactMetal();
      }
    }
  }

  /**
   * A hit on a person: arterial spray out the back along the shot line, a
   * finer mist at the entry, and a mark left on the ground beneath.
   */
  bloodHit(point, dir, head = false) {
    const n = head ? 26 : 14;
    this.burst(point, {
      count: n, color: 0x8e1220, speed: head ? 7 : 4.5,
      life: 0.55, gravity: 16, dir, spread: 0.55
    });
    this.burst(point, {
      count: Math.round(n * 0.5), color: 0xc4303c, speed: 2.2,
      life: 0.4, gravity: 12
    });
    // Ground splatter under the impact.
    _v.set(point.x, 0.02, point.z);
    this.bloodDecal(_v, head);
  }

  /** Dark pooling mark left on the deck. */
  bloodDecal(point, big = false) {
    if (!this._bloodPool) {
      this._bloodPool = [];
      const geo = new THREE.CircleGeometry(0.28, 12);
      for (let i = 0; i < 24; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x5c0d16, transparent: true, opacity: 0,
          depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3
        });
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        this.scene.add(m);
        this._bloodPool.push({ mesh: m, life: 0 });
      }
      this._bCursor = 0;
    }
    const b = this._bloodPool[this._bCursor];
    this._bCursor = (this._bCursor + 1) % this._bloodPool.length;
    b.mesh.visible = true;
    b.mesh.position.set(point.x, 0.022, point.z);
    b.mesh.rotation.z = Math.random() * Math.PI;
    const s = (big ? 1.5 : 0.9) * (0.7 + Math.random() * 0.6);
    b.mesh.scale.set(s, s, s);
    b.mesh.material.opacity = 0.8;
    b.life = 22;
  }

  _updateBlood(dt) {
    if (!this._bloodPool) return;
    for (const b of this._bloodPool) {
      if (!b.mesh.visible) continue;
      b.life -= dt;
      if (b.life < 5) b.mesh.material.opacity = Math.max(0, b.life / 5) * 0.8;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }

  /** Enemy death detonation. */
  explosion(pos, color = 0xff9b3d) {
    this.burst(pos, { count: 46, color, speed: 8, life: 0.8, gravity: 7 });
    this.burst(pos, { count: 18, color: 0xffffff, speed: 3, life: 0.4, gravity: 2 });
    this.flash(pos, color, 60, 0.16);
  }

  /** Thruster puff for boost jumps and pads. */
  thrust(pos) {
    this.burst(pos, { count: 16, color: 0x63c8ff, speed: 4, life: 0.4, gravity: -2, dir: new THREE.Vector3(0, -1, 0), spread: 0.7 });
  }

  update(dt) {
    this._updateParticles(dt);
    this._updateTracers(dt);
    this._updateDecals(dt);
    this._updateFlashes(dt);
    this._updateCasings(dt);
    this._updateBlood(dt);
  }

  clear() {
    for (let i = 0; i < this.pMax; i++) { this.pLife[i] = 0; this.pPos[i * 3 + 1] = -1000; }
    for (const t of this.tracers) t.mesh.visible = false;
    for (const d of this.decals) d.mesh.visible = false;
    for (const f of this.flashes) f.light.visible = false;
    for (const c of this.casings) c.mesh.visible = false;
    if (this._bloodPool) for (const b of this._bloodPool) b.mesh.visible = false;
  }
}
