import * as THREE from 'three';

/**
 * Atmosphere — the air itself.
 *
 *  · God rays: soft additive shafts angled with the sun, slowly breathing so
 *    they read as light through a moving canopy rather than static cones.
 *  · Pollen: 3,000 motes drifting in a volume that follows the player, so the
 *    air is always alive without simulating the whole 600 m deck.
 *  · Birds: flocks circling the treeline, wings beating, banking as they turn.
 *
 * All three are instanced or pooled and cost one draw call each.
 */

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _euler = new THREE.Euler();

export class Atmosphere {
  constructor(world, opts = {}) {
    this.world = world;
    this.game = world.game;
    this.group = world.group;
    this._t = 0;
    this.sunDir = opts.sunDir || new THREE.Vector3(0.5, 0.8, 0.3).normalize();
    this._buildGodRays(opts.rays ?? 22, opts.radius ?? 200);
    this._buildPollen(opts.pollen ?? 3000);
    this._buildBirds(opts.birds ?? 26, opts.radius ?? 200);
  }

  // ------------------------------------------------------------- god rays

  _buildGodRays(count, radius) {
    // A soft-edged shaft: cone with an additive gradient fading to nothing.
    const c = document.createElement('canvas');
    c.width = 16; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,246,214,0.55)');
    grad.addColorStop(0.55, 'rgba(255,240,200,0.18)');
    grad.addColorStop(1, 'rgba(255,235,190,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 64);
    const tex = new THREE.CanvasTexture(c);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true
    });
    const geo = new THREE.ConeGeometry(2.6, 26, 6, 1, true);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;

    // Tilt every shaft to match the sun's incidence.
    const tiltQ = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), this.sunDir
    );
    this._rayData = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.sin(i * 3.1) * 0.4;
      const r = 24 + ((i * 37) % 100) / 100 * radius * 0.85;
      const d = {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        phase: Math.random() * 6.28,
        scale: 0.7 + Math.random() * 0.8
      };
      this._rayData.push(d);
      _pos.set(d.x, 13, d.z);
      _scl.set(d.scale, 1, d.scale);
      _m4.compose(_pos, tiltQ, _scl);
      mesh.setMatrixAt(i, _m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.rays = mesh;
    this._rayTilt = tiltQ;
  }

  // --------------------------------------------------------------- pollen

  _buildPollen(count) {
    this.pollenCount = count;
    this.pollenBox = 70; // motes live in a box this wide, centered on you
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    this._pollenSeed = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3] = (Math.random() - 0.5) * this.pollenBox;
      pos[i3 + 1] = Math.random() * 14;
      pos[i3 + 2] = (Math.random() - 0.5) * this.pollenBox;
      this._pollenSeed[i3] = Math.random() * 6.28;
      this._pollenSeed[i3 + 1] = 0.2 + Math.random() * 0.5;   // rise rate
      this._pollenSeed[i3 + 2] = 0.4 + Math.random() * 1.2;   // drift rate
      const warm = 0.75 + Math.random() * 0.25;
      col[i3] = warm;
      col[i3 + 1] = warm * 0.94;
      col[i3 + 2] = warm * 0.68;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.pollen = pts;
    this._pollenPos = pos;
    this._pollenCenter = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- birds

  _buildBirds(count, radius) {
    // Two-triangle bird: a body with a wing either side that flaps.
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0, 0, -0.22, -0.42, 0.02, 0.14, 0, 0, 0.1,
      0, 0, -0.22, 0, 0, 0.1, 0.42, 0.02, 0.14
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1c1f22, side: THREE.DoubleSide, fog: true
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.birds = mesh;

    // Birds fly in a few loose flocks on shared orbits.
    this._birdData = [];
    const flocks = Math.max(1, Math.round(count / 7));
    for (let i = 0; i < count; i++) {
      const f = i % flocks;
      this._birdData.push({
        orbit: 60 + (f / flocks) * radius * 0.7,
        height: 22 + (f % 3) * 9,
        speed: 0.07 + (f % 4) * 0.015,
        phase: (i / count) * Math.PI * 2 + f,
        jitterR: (Math.random() - 0.5) * 9,
        jitterY: (Math.random() - 0.5) * 4,
        flap: Math.random() * 6.28,
        flapRate: 7 + Math.random() * 5
      });
    }
  }

  // --------------------------------------------------------------- update

  update(dt, playerPos) {
    this._t += dt;
    const t = this._t;

    // God rays breathe as the canopy above them stirs.
    if (this.rays) {
      for (let i = 0; i < this._rayData.length; i++) {
        const d = this._rayData[i];
        const pulse = 0.75 + Math.sin(t * 0.5 + d.phase) * 0.25;
        _pos.set(d.x, 13 + Math.sin(t * 0.3 + d.phase) * 0.6, d.z);
        _scl.set(d.scale * pulse, 1, d.scale * pulse);
        _m4.compose(_pos, this._rayTilt, _scl);
        this.rays.setMatrixAt(i, _m4);
      }
      this.rays.instanceMatrix.needsUpdate = true;
    }

    // Pollen drifts and rises; the volume re-centers on the player and motes
    // wrap around it, so you're always inside a living cloud.
    if (this.pollen && playerPos) {
      const p = this._pollenPos;
      const s = this._pollenSeed;
      const half = this.pollenBox * 0.5;
      const cx = playerPos.x;
      const cz = playerPos.z;
      for (let i = 0; i < this.pollenCount; i++) {
        const i3 = i * 3;
        p[i3] += Math.sin(t * 0.6 + s[i3]) * s[i3 + 2] * dt;
        p[i3 + 1] += s[i3 + 1] * dt * 0.35;
        p[i3 + 2] += Math.cos(t * 0.45 + s[i3]) * s[i3 + 2] * dt;
        // Wrap into the box around the player.
        if (p[i3] - cx > half) p[i3] -= this.pollenBox;
        else if (p[i3] - cx < -half) p[i3] += this.pollenBox;
        if (p[i3 + 2] - cz > half) p[i3 + 2] -= this.pollenBox;
        else if (p[i3 + 2] - cz < -half) p[i3 + 2] += this.pollenBox;
        if (p[i3 + 1] > 16) p[i3 + 1] = 0.2;
      }
      this.pollen.geometry.attributes.position.needsUpdate = true;
    }

    // Birds circle, flap and bank into their turns.
    if (this.birds) {
      for (let i = 0; i < this._birdData.length; i++) {
        const b = this._birdData[i];
        const a = t * b.speed + b.phase;
        const r = b.orbit + b.jitterR + Math.sin(t * 0.3 + b.phase) * 5;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = b.height + b.jitterY + Math.sin(t * 0.55 + b.phase) * 1.8;
        // Heading is the orbit tangent; roll banks the turn.
        _euler.set(
          Math.sin(t * 0.5 + b.phase) * 0.12,
          -a + Math.PI / 2,
          0.32
        );
        _q.setFromEuler(_euler);
        // Wing beat rides on the Y scale of the card.
        const flap = 0.55 + Math.abs(Math.sin(t * b.flapRate + b.flap)) * 0.85;
        _pos.set(x, y, z);
        _scl.set(1, flap, 1);
        _m4.compose(_pos, _q, _scl);
        this.birds.setMatrixAt(i, _m4);
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }
  }
}
