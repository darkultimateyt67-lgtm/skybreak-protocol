import * as THREE from 'three';
import { WIND } from './Wind.js';
import { chunkInstanced } from './Chunk.js';

/**
 * Foliage — 200,000 individually placed leaves across the grove, rendered as
 * ONE instanced draw call.
 *
 * Each leaf gets its own position, orientation, scale, color tint and wind
 * phase. Motion runs entirely in the vertex shader: a two-octave wind field
 * plus a per-leaf flutter, so every leaf moves independently without costing
 * a single CPU cycle per leaf. That is the only way this many leaves can
 * animate at 60 FPS — per-leaf JavaScript would be ~200k updates a frame.
 *
 * Footprints live here too: a 30-slot ring buffer of boot decals pressed into
 * the soil. The 31st step overwrites the 1st, so a trail of exactly 30 always
 * follows the player.
 */

/** Leaves carried by one instanced sprig. Must match _leafGeometry(). */
const LEAVES_PER_SPRIG = 5;

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qJit = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

export class Foliage {
  constructor(world, maxLeaves = 200000) {
    this.world = world;
    this.scene = world.game.scene;
    this.maxLeaves = maxLeaves;
    this.canopies = [];
    this.leafMesh = null;
    this._time = 0;
  }

  /**
   * Register a foliage volume — one per twig tip. `weight` biases how much
   * of the leaf budget this cluster claims, so outer twigs get denser
   * foliage than the shaded inner branches.
   */
  addCanopy(x, y, z, radius, height, weight = 1, root = null) {
    this.canopies.push({ x, y, z, radius, height, weight, root });
  }

  /** Single leaf sprite: a slightly folded quad reads better than a flat one. */
  /**
   * A SPRIG: several leaves on a short shared stem, not one lone leaf.
   *
   * Trees don't carry leaves one at a time at random angles — they carry them
   * in sprays off twig tips, which is why a canopy reads as mass rather than
   * as scattered flakes. Instancing single leaves produced confetti no matter
   * how many were used. Grouping them costs triangles per instance but buys
   * them straight back, because the instance COUNT drops by the same factor
   * (see LEAVES_PER_SPRIG) — same triangle budget, completely different read.
   */
  _leafGeometry() {
    const pos = [];
    const uvs = [];
    const nrm = [];

    // One leaf, built in its own frame then transformed onto the stem.
    const leaf = (originY, yaw, pitch, scale, curl) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const put = (x, y, z, u, v) => {
        // Scale, then pitch away from the stem, then spin around it.
        x *= scale; y *= scale; z *= scale;
        const y2 = y * cp - z * sp;
        const z2 = y * sp + z * cp;
        const x3 = x * cy + z2 * sy;
        const z3 = -x * sy + z2 * cy;
        pos.push(x3, y2 + originY, z3);
        uvs.push(u, v);
        // Normal follows the blade's curl so the two halves catch light apart.
        const n = new THREE.Vector3(x3 * curl * 0.6, 0.35, z3 * curl * 0.6 + 0.9).normalize();
        nrm.push(n.x, n.y, n.z);
      };
      // Blade: base, two shoulders, tip — folded along the midrib.
      put(0, 0, 0, 0.5, 0);
      put(-0.42, 0.34, curl * 0.1, 0.04, 0.44);
      put(0, 0.86, 0, 0.5, 1);
      put(0, 0, 0, 0.5, 0);
      put(0, 0.86, 0, 0.5, 1);
      put(0.42, 0.34, curl * 0.1, 0.96, 0.44);
    };

    // Five leaves fanned around a stem, alternating up its length — the
    // arrangement most broadleaf twigs actually use.
    leaf(0.00, 0.0, 0.55, 0.80, 1);
    leaf(0.14, 2.3, 0.70, 0.92, -1);
    leaf(0.26, 4.1, 0.48, 0.85, 1);
    leaf(0.40, 1.1, 0.34, 0.72, -1);
    leaf(0.52, 3.6, 0.22, 0.62, 1);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    return g;
  }

  /**
   * A leaf, at a resolution where it actually reads as one. The old 64 px
   * canvas could not hold a serrated edge or a vein network — at 256 the
   * silhouette does the work, and the silhouette is what you recognise a leaf
   * by long before you see its colour.
   */
  _leafTexture() {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.clearRect(0, 0, s, s);

    // --- Serrated blade outline --------------------------------------------
    // Built as an explicit point list so each edge can carry teeth. A pair of
    // quadratic curves (the old approach) can only ever give a smooth almond.
    const TEETH = 11;
    const mid = s * 0.5;
    const tipY = s * 0.04;
    const baseY = s * 0.97;
    const halfW = s * 0.30;
    const outline = [];
    const bulge = (t) => Math.sin(Math.pow(t, 0.72) * Math.PI); // widest ~40% up
    for (let i = 0; i <= TEETH; i++) {
      const t = i / TEETH;
      const y = baseY + (tipY - baseY) * t;
      const tooth = (i % 2 === 0 ? 1 : 0.84);
      outline.push([mid - halfW * bulge(t) * tooth, y]);
    }
    for (let i = TEETH; i >= 0; i--) {
      const t = i / TEETH;
      const y = baseY + (tipY - baseY) * t;
      const tooth = (i % 2 === 0 ? 1 : 0.84);
      outline.push([mid + halfW * bulge(t) * tooth, y]);
    }
    g.beginPath();
    g.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of outline) g.lineTo(x, y);
    g.closePath();

    const grad = g.createLinearGradient(0, s, 0, 0);
    grad.addColorStop(0, '#35682c');
    grad.addColorStop(0.45, '#549c42');
    grad.addColorStop(0.8, '#6fba57');
    grad.addColorStop(1, '#88cc68');
    g.fillStyle = grad;
    g.fill();
    g.save();
    g.clip();   // everything below stays inside the blade

    // --- Vein network -------------------------------------------------------
    g.strokeStyle = 'rgba(28,58,24,0.42)';
    g.lineWidth = s * 0.014;
    g.beginPath(); g.moveTo(mid, baseY); g.lineTo(mid, tipY); g.stroke();
    g.lineWidth = s * 0.006;
    for (let i = 1; i < 9; i++) {
      const t = i / 9;
      const y = baseY + (tipY - baseY) * t;
      const reach = halfW * bulge(t) * 0.95;
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.moveTo(mid, y);
        g.quadraticCurveTo(mid + dir * reach * 0.5, y - s * 0.02, mid + dir * reach, y - s * 0.06);
        g.stroke();
      }
    }
    // Fine tertiary veining.
    g.strokeStyle = 'rgba(30,62,26,0.20)';
    g.lineWidth = s * 0.003;
    for (let i = 0; i < 46; i++) {
      const y = tipY + Math.random() * (baseY - tipY);
      const x = mid + (Math.random() - 0.5) * halfW * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * s * 0.09, y + (Math.random() - 0.5) * s * 0.07);
      g.stroke();
    }
    // Blotchy mottling and a little edge scorch, so no two leaves tile alike.
    for (let i = 0; i < 26; i++) {
      const x = mid + (Math.random() - 0.5) * halfW * 2;
      const y = tipY + Math.random() * (baseY - tipY);
      const r = s * (0.02 + Math.random() * 0.05);
      const rad = g.createRadialGradient(x, y, 1, x, y, r);
      const warm = Math.random() > 0.6;
      rad.addColorStop(0, warm ? 'rgba(150,130,50,0.22)' : 'rgba(20,50,18,0.20)');
      rad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rad;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.restore();

    // --- Stem ---------------------------------------------------------------
    g.strokeStyle = '#4a6b32';
    g.lineWidth = s * 0.016;
    g.beginPath(); g.moveTo(mid, baseY); g.lineTo(mid, s); g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * Distribute `maxLeaves` across every registered canopy and upload them as
   * one InstancedMesh. Leaf density per canopy is proportional to its volume.
   */
  build() {
    if (!this.canopies.length) return;

    const geo = this._leafGeometry();
    // NO vertexColors. The sprig geometry has no colour attribute, and with
    // vertexColors on, WebGL feeds a missing attribute as (0, 0, 0): every
    // leaf in the game rendered black and the trees read as dead. The
    // per-sprig tint comes from instanceColor, which three.js applies on its
    // own whenever the mesh has one.
    const mat = new THREE.MeshLambertMaterial({
      map: this._leafTexture(),
      alphaTest: 0.42,
      side: THREE.DoubleSide
    });

    // maxLeaves stays a count of LEAVES, which is what callers reason about.
    // Each instance now carries a whole sprig, so the instance count is that
    // budget divided by the leaves on one — the triangle total is unchanged.
    //
    // A map can instead ask for a density PER TWIG. The budget was tuned for a
    // single forest grove; spread across a whole city's parks it came to about
    // one sprig per twig tip, and every tree in GTAZ looked dead in winter.
    const cfg = this.world.def && this.world.def.foliage;
    const detail = this.world.detail ?? 1;
    let total = Math.ceil(this.maxLeaves / LEAVES_PER_SPRIG);
    if (cfg && cfg.perCluster) {
      total = Math.min(cfg.cap || 140000, Math.ceil(this.canopies.length * cfg.perCluster * Math.max(0.5, detail)));
    }
    const leafScale = (cfg && cfg.scale) || 1;
    this.sprigCount = total;
    const phase = new Float32Array(total);
    const stiff = new Float32Array(total);
    const roots = new Float32Array(total * 4);

    // Whole-tree bend, gust fronts, branch swing and knocks all come from the
    // shared wind field, applied in WORLD space after the instance transform
    // so every sprig on a tree moves with its branch. What stays here is the
    // leaf's own flutter, which is meant to be local and random.
    WIND.patchLeaves(mat, `
      float bendL = position.y / 1.05;
      float flutter = sin(uTime * 7.5 + aPhase * 6.2831) * 0.35
                    + sin(uTime * 11.3 + aPhase * 12.566) * 0.18;
      transformed.x += flutter * bendL * aStiff * 0.10;
      transformed.z += flutter * bendL * aStiff * 0.08;
    `);

    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Volume-weighted distribution so big canopies get proportionally more.
    const weights = this.canopies.map((c) => c.radius * c.radius * c.height * (c.weight ?? 1));
    const wSum = weights.reduce((a, b) => a + b, 0);

    const color = new THREE.Color();
    let i = 0;
    for (let ci = 0; ci < this.canopies.length && i < total; ci++) {
      const c = this.canopies[ci];
      const share = ci === this.canopies.length - 1
        ? total - i
        : Math.floor((weights[ci] / wSum) * total);

      for (let n = 0; n < share && i < total; n++, i++) {
        // Rejection-free placement inside an ellipsoid shell, denser outside
        // (real canopies carry their foliage on the surface, not the core).
        const u = Math.random();
        const r = c.radius * (0.55 + 0.45 * Math.cbrt(u));
        const theta = Math.random() * Math.PI * 2;
        const cosPhi = Math.random() * 2 - 1;
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        const lx = r * sinPhi * Math.cos(theta);
        const lz = r * sinPhi * Math.sin(theta);
        const ly = (c.height * 0.5) * cosPhi;

        _pos.set(c.x + lx, c.y + ly, c.z + lz);
        // Sprigs grow OUTWARD from the canopy core, the way twigs reach for
        // light, with enough jitter that the surface isn't a hedgehog. Fully
        // random rotation was a large part of why the old foliage read as
        // scattered flakes instead of a canopy.
        _dir.set(lx, ly * 1.6 + c.height * 0.12, lz).normalize();
        _q.setFromUnitVectors(_UP, _dir);
        _euler.set(
          (Math.random() - 0.5) * 0.9,
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 0.9
        );
        _q.multiply(_qJit.setFromEuler(_euler));
        const s = (0.26 + Math.random() * 0.22) * leafScale;
        _scl.set(s, s, s);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);

        // Tint: sunlit crown greens up top, shaded interior darker.
        const lit = 0.55 + 0.45 * (ly / (c.height * 0.5) * 0.5 + 0.5);
        color.setHSL(
          0.24 + (Math.random() - 0.5) * 0.05,
          0.45 + Math.random() * 0.2,
          0.22 + lit * 0.26
        );
        mesh.setColorAt(i, color);

        phase[i] = Math.random();
        stiff[i] = 0.65 + Math.random() * 0.7;
        const rt = c.root || [c.x, c.y - c.height * 2, c.z, c.height * 3];
        roots[i * 4] = rt[0]; roots[i * 4 + 1] = rt[1]; roots[i * 4 + 2] = rt[2]; roots[i * 4 + 3] = rt[3];
      }
    }

    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stiff, 1));
    geo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 4));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    mesh.count = i;
    // Tiled so canopies behind the camera are skipped. Pad covers the
    // whole-tree wind bend applied in the vertex shader.
    this.leafMesh = chunkInstanced(mesh, 40, 4);
    geo.dispose();
    this.leafCount = i;
    this.world.group.add(this.leafMesh);
  }

  update(dt) {
    this._time += dt;
    if (this._shader) this._shader.uniforms.uTime.value = this._time;
  }
}

/**
 * Footprints — exactly 30 boot prints follow the player. Step 31 recycles
 * slot 1, so the oldest print is always the one erased.
 */
export class Footprints {
  constructor(game, count = 30) {
    this.game = game;
    this.count = count;
    this.cursor = 0;
    this.slots = [];

    const tex = this._soleTexture();
    const geo = new THREE.PlaneGeometry(0.3, 0.62);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = true;
      game.scene.add(mesh);
      this.slots.push({ mesh, born: 0 });
    }
    this._left = true;
  }

  /** Boot sole: heel block, arch waist, treaded forefoot. */
  _soleTexture() {
    const w = 64, h = 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(24,18,12,0.85)';
    // Forefoot pad.
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.3, w * 0.34, h * 0.24, 0, 0, Math.PI * 2);
    g.fill();
    // Heel pad.
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.79, w * 0.27, h * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    // Narrow arch bridging them.
    g.fillRect(w * 0.36, h * 0.48, w * 0.28, h * 0.2);
    // Lug tread cut into the forefoot.
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      g.fillRect(w * 0.16, h * (0.15 + i * 0.075), w * 0.68, h * 0.022);
    }
    for (let i = 0; i < 2; i++) {
      g.fillRect(w * 0.24 + i * w * 0.3, h * 0.72, w * 0.1, h * 0.13);
    }
    g.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  /**
   * Press a print at the player's feet, offset to whichever foot is landing
   * and rotated to their heading.
   */
  step(position, yaw) {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;

    // Lateral offset alternates so the trail reads as two feet, not one line.
    const side = this._left ? -1 : 1;
    this._left = !this._left;
    const offX = Math.cos(yaw) * 0.17 * side;
    const offZ = -Math.sin(yaw) * 0.17 * side;

    slot.mesh.position.set(position.x + offX, position.y + 0.02, position.z + offZ);
    slot.mesh.rotation.set(-Math.PI / 2, 0, -yaw);
    slot.mesh.material.opacity = 0.8;
    slot.mesh.visible = true;
    slot.born = performance.now() * 0.001;
  }

  /** Prints weather away slowly; the ring buffer does the hard erasing. */
  update() {
    const now = performance.now() * 0.001;
    for (const s of this.slots) {
      if (!s.mesh.visible) continue;
      const age = now - s.born;
      if (age > 26) {
        s.mesh.visible = false;
      } else if (age > 16) {
        s.mesh.material.opacity = 0.8 * (1 - (age - 16) / 10);
      }
    }
  }

  clear() {
    for (const s of this.slots) s.mesh.visible = false;
    this.cursor = 0;
  }
}
