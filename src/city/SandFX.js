import * as THREE from 'three';

/**
 * SandFX — sand that answers back.
 *
 * Sand is not a floor. Step on it and grains fly off your heel; land on it
 * from a jump and it sprays out in a ring and pits under your feet; drive on
 * it and the tyres throw a rooster tail and cut two tracks behind you. On dry
 * sand a little dust hangs in the air after; wet sand is heavy, throws less,
 * darkens where it is pressed — and the waves smooth the marks away.
 *
 * WHAT IS SIMULATED. Every grain is a particle with a position and velocity,
 * integrated each frame under gravity and air drag until it strikes the sand
 * surface (the same height function the physics floor uses), where it stops
 * dead — sand does not bounce — and settles into the beach. Launch speed and
 * count come from the event: how fast you were falling when you landed, how
 * fast the car is going, how big the blast was. Dust is a slower, lighter
 * population that billows, drifts downwind and thins out.
 *
 * WHAT IS LEFT BEHIND. Footprints, landing pits, tyre tracks and blast
 * craters are pressed into the surface as decals in ring buffers — the oldest
 * mark is the one that goes — and anything on wet sand fades as the swash
 * washes over it.
 *
 * Budget: 5,000 grains, 90 dust puffs, 360 prints and pits, 1,400 track
 * segments. One draw call each.
 */

const GRAINS = 5000;
const PUFFS = 90;
const MARKS = 360;
const TRACKS = 1400;
const G = 9.81;

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function pointMaterial(soft) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, aSize * uScale / -mv.z);
        vAlpha = aAlpha;
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        if (r > 1.0) discard;
        float a = ${soft ? 'vAlpha * (1.0 - r * r)' : 'vAlpha * (1.0 - smoothstep(0.75, 1.0, r))'};
        gl_FragColor = vec4(vColor, a);
      }`
  });
}

function markTexture(kind) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  if (kind === 'print') {
    // A boot sole pressed in: dark hollow with a lighter raised rim of
    // displaced sand round it.
    const blob = (x, y, rx, ry, a) => {
      g.save(); g.translate(x, y); g.scale(1, ry / rx);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      r.addColorStop(0, `rgba(96,78,56,${a})`);
      r.addColorStop(0.72, `rgba(110,90,64,${a * 0.85})`);
      r.addColorStop(0.9, 'rgba(236,222,190,0.45)');
      r.addColorStop(1, 'rgba(236,222,190,0)');
      g.fillStyle = r;
      g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill();
      g.restore();
    };
    blob(S * 0.5, S * 0.32, S * 0.2, S * 0.26, 0.8);
    blob(S * 0.5, S * 0.76, S * 0.15, S * 0.17, 0.8);
    g.fillStyle = 'rgba(150,126,92,0.6)';
    for (let i = 0; i < 5; i++) g.fillRect(S * 0.34, S * (0.16 + i * 0.065), S * 0.32, S * 0.016);
  } else if (kind === 'pit') {
    const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(92,74,52,0.6)');
    r.addColorStop(0.55, 'rgba(118,96,68,0.35)');
    r.addColorStop(0.78, 'rgba(240,226,194,0.5)');
    r.addColorStop(1, 'rgba(240,226,194,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, S, S);
  } else {
    // Tyre tread: chevrons across a flattened band.
    g.fillStyle = 'rgba(104,86,62,0.55)';
    g.fillRect(S * 0.08, 0, S * 0.84, S);
    g.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < S; y += 16) {
      g.beginPath();
      g.moveTo(S * 0.1, y); g.lineTo(S * 0.5, y + 7); g.lineTo(S * 0.9, y);
      g.lineTo(S * 0.9, y + 5); g.lineTo(S * 0.5, y + 12); g.lineTo(S * 0.1, y + 5);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SandFX {
  constructor(game, city) {
    this.game = game;
    this.city = city;
    this.t = 0;

    // --- Grains --------------------------------------------------------------
    this.gp = new Float32Array(GRAINS * 3);
    this.gv = new Float32Array(GRAINS * 3);
    this.gl = new Float32Array(GRAINS);          // life: <0 dead, else seconds settled/age
    this.gs = new Float32Array(GRAINS);          // settled flag / fade timer
    this.gl.fill(-1);
    this._gi = 0;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this.gp, 3).setUsage(THREE.DynamicDrawUsage));
    this.gSize = new Float32Array(GRAINS);
    this.gAlpha = new Float32Array(GRAINS);
    this.gCol = new Float32Array(GRAINS * 3);
    gg.setAttribute('aSize', new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('aAlpha', new THREE.BufferAttribute(this.gAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('aColor', new THREE.BufferAttribute(this.gCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.grains = new THREE.Points(gg, pointMaterial(false));
    this.grains.frustumCulled = false;
    this.grains.renderOrder = 3;
    game.scene.add(this.grains);

    // --- Dust ---------------------------------------------------------------
    this.dp = new Float32Array(PUFFS * 3);
    this.dv = new Float32Array(PUFFS * 3);
    this.dl = new Float32Array(PUFFS).fill(-1);
    this.dmax = new Float32Array(PUFFS).fill(1);
    this.dr0 = new Float32Array(PUFFS);
    this._di = 0;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dp, 3).setUsage(THREE.DynamicDrawUsage));
    this.dSize = new Float32Array(PUFFS);
    this.dAlpha = new Float32Array(PUFFS);
    this.dCol = new Float32Array(PUFFS * 3);
    dg.setAttribute('aSize', new THREE.BufferAttribute(this.dSize, 1).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute('aAlpha', new THREE.BufferAttribute(this.dAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute('aColor', new THREE.BufferAttribute(this.dCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(dg, pointMaterial(true));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 4;
    game.scene.add(this.dust);

    // --- Marks pressed into the sand -----------------------------------------
    const markGeo = new THREE.PlaneGeometry(1, 1);
    markGeo.rotateX(-Math.PI / 2);
    const decal = (tex, n) => {
      const m = new THREE.InstancedMesh(markGeo, new THREE.MeshStandardMaterial({
        map: tex, transparent: true, depthWrite: false, roughness: 1,
        color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3
      }), n);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.setColorAt(0, _c.set(1, 1, 1));
      game.scene.add(m);
      return m;
    };
    this.prints = decal(markTexture('print'), MARKS);
    this.pits = decal(markTexture('pit'), 64);
    this.tracks = decal(markTexture('track'), TRACKS);
    this._marks = { prints: [], pits: [], tracks: [] };
    this._washT = 0;
    this._wheelAcc = new Map();
  }

  // ----------------------------------------------------------------- queries

  /** Is this point on the beach sand, above the waterline? */
  isSand(x, z) {
    const c = this.city;
    if (!c || !c.ocean) return false;
    if (Math.max(Math.abs(x), Math.abs(z)) <= c.shore) return false;
    return c.ocean.groundAt(x, z) > c.seaLevel - 0.6;
  }

  _ground(x, z) {
    return this.city.surfaceAt ? this.city.surfaceAt(x, z) : 0;
  }

  /** 0 dry .. 1 soaked, from how far above the still waterline the sand is. */
  _wet(y) {
    return THREE.MathUtils.clamp(1 - (y - (this.city.seaLevel - 0.45)) / 0.8, 0, 1);
  }

  _sandColor(wet, out, i) {
    const v = (1 - 0.42 * wet) * (0.88 + Math.random() * 0.24);
    out[i * 3] = 0.6 * v; out[i * 3 + 1] = 0.53 * v; out[i * 3 + 2] = 0.41 * v;
  }

  // ------------------------------------------------------------------ emitters

  /** Throw `n` grains from p with a velocity drawn by `vel(out)`. */
  _throw(px, py, pz, n, vel, wet, size = 0.035) {
    const tmp = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const i = this._gi;
      this._gi = (this._gi + 1) % GRAINS;
      vel(tmp);
      this.gp[i * 3] = px + (Math.random() - 0.5) * 0.18;
      this.gp[i * 3 + 1] = py + 0.02;
      this.gp[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.18;
      this.gv[i * 3] = tmp[0]; this.gv[i * 3 + 1] = tmp[1]; this.gv[i * 3 + 2] = tmp[2];
      this.gl[i] = 0;
      this.gs[i] = -1;                 // in flight
      this.gSize[i] = size * (0.6 + Math.random() * 0.8) * (wet > 0.5 ? 1.35 : 1);
      this.gAlpha[i] = 1;
      this._sandColor(wet, this.gCol, i);
    }
  }

  _puff(px, py, pz, r0, vx, vy, vz, life, wet) {
    if (wet > 0.6) return;             // wet sand does not raise dust
    const i = this._di;
    this._di = (this._di + 1) % PUFFS;
    this.dp[i * 3] = px; this.dp[i * 3 + 1] = py + r0 * 0.4; this.dp[i * 3 + 2] = pz;
    this.dv[i * 3] = vx; this.dv[i * 3 + 1] = vy; this.dv[i * 3 + 2] = vz;
    this.dl[i] = 0;
    this.dmax[i] = life;
    this.dr0[i] = r0;
    const v = 0.8 + Math.random() * 0.15;
    this.dCol[i * 3] = 0.84 * v; this.dCol[i * 3 + 1] = 0.76 * v; this.dCol[i * 3 + 2] = 0.6 * v;
  }

  _mark(list, mesh, cap, x, y, z, yaw, sx, sz, wet) {
    list.push({ x, y, z, yaw, sx, sz, wet, t: this.t });
    if (list.length > cap) list.shift();
    this._dirty = true;
  }

  /** A footstep on sand: grains off the heel, and a print where the foot was. */
  step(pos, yaw, sprint, speed, side) {
    if (!this.isSand(pos.x, pos.z)) return false;
    const y = this._ground(pos.x, pos.z);
    const wet = this._wet(y);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);        // facing
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);         // right
    const ox = pos.x + rx * 0.12 * side, oz = pos.z + rz * 0.12 * side;
    // Kicked back off the heel, more of it the harder you run.
    const n = Math.round((sprint ? 26 : 12) * (1 - 0.5 * wet) * Math.min(2, 0.6 + speed / 8));
    const kick = (sprint ? 2.4 : 1.4) * Math.min(1.8, 0.7 + speed / 10);
    this._throw(ox, y, oz, n, (o) => {
      const a = (Math.random() - 0.5) * 1.1;
      const sp = kick * (0.4 + Math.random() * 0.8);
      o[0] = (-fx * Math.cos(a) - rx * Math.sin(a)) * sp;
      o[2] = (-fz * Math.cos(a) - rz * Math.sin(a)) * sp;
      o[1] = sp * (0.6 + Math.random() * 0.7);
    }, wet);
    if (sprint) this._puff(ox - fx * 0.3, y, oz - fz * 0.3, 0.18, -fx * 0.6, 0.35, -fz * 0.6, 1.1, wet);
    this._mark(this._marks.prints, this.prints, MARKS, ox, y, oz, yaw, 0.13, 0.3, wet);
    return true;
  }

  /** Pushing off to jump: sand driven down and back from both feet. */
  takeoff(pos, vel) {
    if (!this.isSand(pos.x, pos.z)) return;
    const y = this._ground(pos.x, pos.z);
    const wet = this._wet(y);
    const hs = Math.hypot(vel.x, vel.z);
    this._throw(pos.x, y, pos.z, Math.round(40 * (1 - 0.5 * wet)), (o) => {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.4;
      o[0] = Math.cos(a) * sp - vel.x * 0.25;
      o[2] = Math.sin(a) * sp - vel.z * 0.25;
      o[1] = 0.8 + Math.random() * 1.6 + hs * 0.05;
    }, wet);
  }

  /**
   * Landing: a ring of sand thrown out from the feet, sized by the impact —
   * the vertical speed you arrived at — and a pit pressed into the surface.
   */
  land(pos, impact, vel) {
    if (!this.isSand(pos.x, pos.z)) return false;
    const y = this._ground(pos.x, pos.z);
    const wet = this._wet(y);
    const k = THREE.MathUtils.clamp(impact / 9, 0.25, 3.5);
    const n = Math.round(THREE.MathUtils.clamp(70 * k, 30, 420) * (1 - 0.45 * wet));
    const hx = vel ? vel.x * 0.18 : 0, hz = vel ? vel.z * 0.18 : 0;
    this._throw(pos.x, y, pos.z, n, (o) => {
      const a = Math.random() * Math.PI * 2;
      // Shallow and fast at the rim, steep and slow near the feet.
      const steep = Math.random();
      const sp = (1.2 + Math.random() * 2.6) * Math.sqrt(k);
      o[0] = Math.cos(a) * sp * (1.1 - steep * 0.6) + hx;
      o[2] = Math.sin(a) * sp * (1.1 - steep * 0.6) + hz;
      o[1] = sp * (0.35 + steep * 0.9);
    }, wet);
    for (let i = 0; i < Math.round(3 + k * 2); i++) {
      const a = Math.random() * Math.PI * 2;
      this._puff(pos.x + Math.cos(a) * 0.3, y, pos.z + Math.sin(a) * 0.3, 0.25 + 0.1 * k,
        Math.cos(a) * 0.9 * k + hx, 0.25, Math.sin(a) * 0.9 * k + hz, 1.3 + 0.3 * k, wet);
    }
    const r = 0.55 + 0.22 * k;
    this._mark(this._marks.pits, this.pits, 64, pos.x, y, pos.z, Math.random() * 6.28, r, r, wet);
    return true;
  }

  /** A blast on the beach: a crater and a fountain of sand. */
  blast(pos, power = 4) {
    if (!this.isSand(pos.x, pos.z)) return;
    const y = this._ground(pos.x, pos.z);
    const wet = this._wet(y);
    this._throw(pos.x, y, pos.z, Math.round(380 * Math.min(2, power / 4)), (o) => {
      const a = Math.random() * Math.PI * 2;
      const sp = (3 + Math.random() * 7) * Math.sqrt(power / 4);
      o[0] = Math.cos(a) * sp * 0.6;
      o[2] = Math.sin(a) * sp * 0.6;
      o[1] = sp * (0.7 + Math.random() * 0.7);
    }, wet, 0.05);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this._puff(pos.x, y, pos.z, 0.8, Math.cos(a) * 2.5, 0.8 + Math.random(), Math.sin(a) * 2.5, 2.6, wet * 0.5);
    }
    const r = 1.6 + power * 0.25;
    this._mark(this._marks.pits, this.pits, 64, pos.x, y, pos.z, Math.random() * 6.28, r, r, wet);
  }

  /**
   * A vehicle crossing sand: every driven wheel throws grains back and up in
   * proportion to its speed, raises dust, and lays tread behind it.
   */
  wheels(car, dt) {
    if (!car || !car.alive || car.isBoat || car.isAircraft) return;
    const px = car.position.x, pz = car.position.z;
    if (!this.isSand(px, pz)) return;
    const sp = Math.abs(car.speed || 0);
    if (sp < 1.2) return;
    const s = car.style;
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
    const halfW = s.id === 'bike' ? 0 : s.w * 0.42;
    const axles = s.id === 'bike' ? [s.l * 0.34, -s.l * 0.34] : [s.l * 0.31, -s.l * 0.31];
    const sides = halfW ? [-1, 1] : [0];
    const y = this._ground(px, pz);
    const wet = this._wet(y);
    // Tracks: one tread segment per wheel every 0.32 m travelled.
    const key = car;
    const acc = (this._wheelAcc.get(key) || 0) + sp * dt;
    const lay = acc > 0.32;
    this._wheelAcc.set(key, lay ? acc - 0.32 : acc);
    const dir = Math.sign(car.speed) || 1;
    for (const az of axles) {
      for (const sd of sides) {
        const wx = px + fx * az + rx * halfW * sd, wz = pz + fz * az + rz * halfW * sd;
        const wy = this._ground(wx, wz);
        if (lay) this._mark(this._marks.tracks, this.tracks, TRACKS, wx, wy, wz, car.yaw, s.id === 'bike' ? 0.16 : 0.26, 0.36, wet);
        // Only the rear (driven) wheels dig in and throw.
        if (az > 0) continue;
        const n = Math.min(14, Math.round(sp * 0.45 * (1 - 0.4 * wet) * dt * 60));
        const back = Math.min(9, 1.2 + sp * 0.28);
        this._throw(wx - fx * 0.3 * dir, wy, wz - fz * 0.3 * dir, n, (o) => {
          const a = (Math.random() - 0.5) * 0.7;
          const v = back * (0.5 + Math.random() * 0.7);
          o[0] = (-fx * dir * Math.cos(a) + rx * Math.sin(a)) * v;
          o[2] = (-fz * dir * Math.cos(a) + rz * Math.sin(a)) * v;
          o[1] = v * (0.45 + Math.random() * 0.6);
        }, wet);
        if (Math.random() < dt * 9) {
          this._puff(wx - fx * 0.8 * dir, wy, wz - fz * 0.8 * dir, 0.4, -fx * dir * sp * 0.12, 0.4, -fz * dir * sp * 0.12, 1.6, wet);
        }
      }
    }
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.t += dt;
    const ground = (x, z) => this._ground(x, z);
    const drag = Math.exp(-0.9 * dt);
    const gp = this.gp, gv = this.gv;
    let alive = 0;
    for (let i = 0; i < GRAINS; i++) {
      if (this.gl[i] < 0) { this.gAlpha[i] = 0; continue; }
      alive++;
      this.gl[i] += dt;
      if (this.gs[i] < 0) {
        // Ballistic flight.
        gv[i * 3 + 1] -= G * dt;
        gv[i * 3] *= drag; gv[i * 3 + 1] *= drag; gv[i * 3 + 2] *= drag;
        gp[i * 3] += gv[i * 3] * dt;
        gp[i * 3 + 1] += gv[i * 3 + 1] * dt;
        gp[i * 3 + 2] += gv[i * 3 + 2] * dt;
        const gy = ground(gp[i * 3], gp[i * 3 + 2]);
        if (gp[i * 3 + 1] <= gy + 0.01 && gv[i * 3 + 1] < 0) {
          // Sand does not bounce: it lands and stays.
          gp[i * 3 + 1] = gy + 0.008;
          this.gs[i] = 0;
        }
        if (this.gl[i] > 6) this.gl[i] = -1;
      } else {
        // Settled: lie on the surface a moment, then become part of it.
        this.gs[i] += dt;
        this.gAlpha[i] = Math.max(0, 1 - this.gs[i] / 1.6);
        if (this.gs[i] > 1.6) this.gl[i] = -1;
      }
    }
    const ga = this.grains.geometry.attributes;
    ga.position.needsUpdate = true;
    ga.aAlpha.needsUpdate = true;
    ga.aSize.needsUpdate = true;
    ga.aColor.needsUpdate = true;
    this.grains.visible = alive > 0;

    // Dust: rises, spreads, drifts downwind, thins.
    let dAlive = 0;
    for (let i = 0; i < PUFFS; i++) {
      if (this.dl[i] < 0) { this.dAlpha[i] = 0; continue; }
      dAlive++;
      this.dl[i] += dt;
      const f = this.dl[i] / this.dmax[i];
      if (f >= 1) { this.dl[i] = -1; this.dAlpha[i] = 0; continue; }
      const k = Math.exp(-1.6 * dt);
      this.dv[i * 3] = this.dv[i * 3] * k + 0.35 * dt;
      this.dv[i * 3 + 1] = this.dv[i * 3 + 1] * k;
      this.dv[i * 3 + 2] = this.dv[i * 3 + 2] * k + 0.22 * dt;
      this.dp[i * 3] += this.dv[i * 3] * dt;
      this.dp[i * 3 + 1] += this.dv[i * 3 + 1] * dt;
      this.dp[i * 3 + 2] += this.dv[i * 3 + 2] * dt;
      this.dSize[i] = this.dr0[i] * (1 + f * 4.5) * 2;
      this.dAlpha[i] = 0.32 * Math.sin(Math.min(1, f * 4) * Math.PI * 0.5) * (1 - f) * (1 - f);
    }
    const da = this.dust.geometry.attributes;
    da.position.needsUpdate = true;
    da.aAlpha.needsUpdate = true;
    da.aSize.needsUpdate = true;
    da.aColor.needsUpdate = true;
    this.dust.visible = dAlive > 0;

    // Pixel scale for point sizes follows the viewport.
    const h = this.game.renderer ? this.game.renderer.domElement.height : 800;
    const fov = this.game.camera ? this.game.camera.fov : 70;
    const sc = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.grains.material.uniforms.uScale.value = sc;
    this.dust.material.uniforms.uScale.value = sc;

    // The sea washes marks on wet sand away; dry marks last minutes.
    this._washT += dt;
    if (this._washT > 0.5 || this._dirty) {
      this._washT = 0;
      this._dirty = false;
      this._flush(this._marks.prints, this.prints);
      this._flush(this._marks.pits, this.pits);
      this._flush(this._marks.tracks, this.tracks);
    }
  }

  _flush(list, mesh) {
    const now = this.t;
    // Drop anything fully faded.
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const life = m.wet > 0.35 ? 25 : 240;
      if (now - m.t > life) list.splice(i, 1);
    }
    let n = 0;
    for (const m of list) {
      const life = m.wet > 0.35 ? 25 : 240;
      const age = (now - m.t) / life;
      const fade = 1 - Math.pow(age, 3);
      _q.setFromAxisAngle(_UP, m.yaw);
      _m4.compose(_p.set(m.x, m.y + 0.012, m.z), _q, _s.set(m.sx, 1, m.sz));
      mesh.setMatrixAt(n, _m4);
      // Wet prints are darker; everything lightens into the beach as it fades.
      const d = (1 + 0.8 * (1 - fade)) * (1 - 0.3 * m.wet);
      mesh.setColorAt(n, _c.setRGB(d, d, d));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const o of [this.grains, this.dust, this.prints, this.pits, this.tracks]) {
      this.game.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}
