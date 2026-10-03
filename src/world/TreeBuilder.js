import * as THREE from 'three';
import { WIND } from './Wind.js';

/**
 * TreeBuilder — actual trees, grown rather than stacked.
 *
 * A trunk is walked upward in short segments, each one bending slightly and
 * tapering as it climbs. At intervals it throws off child limbs at a species
 * angle; those limbs recurse the same way until they're too thin to continue.
 * The result is a real branching structure — forking limbs, tapering twigs,
 * an asymmetric crown — instead of cones on a pole.
 *
 * Every branch of every tree is written into ONE merged buffer, so the whole
 * grove costs a single draw call. Leaf clusters are registered at the twig
 * tips (where leaves actually grow) rather than filling an ellipsoid, which
 * is what makes the canopy read as foliage on branches instead of a blob.
 */

const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

/** Species presets: silhouette comes almost entirely from these numbers. */
export const SPECIES = {
  // Tall, straight, high crown — the canopy layer.
  pine: {
    height: 15, radius: 0.42, taper: 0.9, segments: 7, curve: 0.06,
    forks: 3, forkAngle: 1.05, forkSpread: 0.55, depth: 4, startFork: 0.28,
    lengthFalloff: 0.66, leafSize: 1.4, leafDensity: 1.0, barkHue: 0.07
  },
  // Wide, gnarled, low fork — the character trees you fight around.
  oak: {
    height: 11, radius: 0.55, taper: 0.89, segments: 6, curve: 0.13,
    forks: 3, forkAngle: 0.85, forkSpread: 0.9, depth: 4, startFork: 0.18,
    lengthFalloff: 0.7, leafSize: 1.8, leafDensity: 1.25, barkHue: 0.08
  },
  // Slim, whippy, sparse — fills gaps without blocking sightlines.
  birch: {
    height: 13, radius: 0.28, taper: 0.92, segments: 7, curve: 0.16,
    forks: 2, forkAngle: 0.7, forkSpread: 0.7, depth: 4, startFork: 0.4,
    lengthFalloff: 0.7, leafSize: 1.1, leafDensity: 0.8, barkHue: 0.11
  },
  // Squat and broad — undergrowth-scale, breaks up the floor.
  scrub: {
    height: 5.5, radius: 0.22, taper: 0.9, segments: 4, curve: 0.2,
    forks: 3, forkAngle: 1.2, forkSpread: 1.1, depth: 3, startFork: 0.1,
    lengthFalloff: 0.72, leafSize: 1.2, leafDensity: 1.1, barkHue: 0.06
  }
};

/** Deterministic per-tree RNG so a seed always grows the same tree. */
function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export class TreeBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
    this.vertCount = 0;
    // Every vertex remembers which tree it belongs to — the base position and
    // the height — so the wind can bend each tree from its own root.
    this.roots = [];
    this._root = [0, 0, 0, 1];
    /** Leaf clusters emitted at twig tips: { x, y, z, r }. */
    this.clusters = [];
    this.trunkColliders = [];
  }

  /**
   * Lay a tapered tube between two points and stitch it to the previous ring.
   * Returns the ring index so the next segment can connect to it.
   */
  _tube(from, to, r0, r1, sides, prevRing, shade) {
    // Build a stable frame perpendicular to the segment direction.
    _v.subVectors(to, from);
    const len = _v.length();
    if (len < 1e-5) return prevRing;
    _v.divideScalar(len);
    _q.setFromUnitVectors(_up, _v);

    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      _axis.set(Math.cos(a) * r1, 0, Math.sin(a) * r1).applyQuaternion(_q);
      this.positions.push(to.x + _axis.x, to.y + _axis.y, to.z + _axis.z);
      // Normal points out from the branch axis.
      _axis.normalize();
      this.normals.push(_axis.x, _axis.y, _axis.z);
      this.colors.push(shade.r, shade.g, shade.b);
      this.roots.push(this._root[0], this._root[1], this._root[2], this._root[3]);
      ring.push(this.vertCount++);
    }

    // First segment of a branch needs its own base ring.
    if (!prevRing) {
      const base = [];
      _q.setFromUnitVectors(_up, _v);
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        _axis.set(Math.cos(a) * r0, 0, Math.sin(a) * r0).applyQuaternion(_q);
        this.positions.push(from.x + _axis.x, from.y + _axis.y, from.z + _axis.z);
        _axis.normalize();
        this.normals.push(_axis.x, _axis.y, _axis.z);
        this.colors.push(shade.r * 0.9, shade.g * 0.9, shade.b * 0.9);
        this.roots.push(this._root[0], this._root[1], this._root[2], this._root[3]);
        base.push(this.vertCount++);
      }
      prevRing = base;
    }

    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.indices.push(prevRing[i], ring[i], prevRing[j]);
      this.indices.push(prevRing[j], ring[i], ring[j]);
    }
    return ring;
  }

  /**
   * Grow one branch: walk it in segments, bending and tapering, forking off
   * children partway up, and dropping a leaf cluster when it runs out.
   */
  _branch(origin, dir, length, radius, depth, sp, rand, shade) {
    const sides = depth === 0 ? 6 : depth === 1 ? 5 : 4;
    const segs = Math.max(2, Math.round(sp.segments * (depth === 0 ? 1 : 0.6)));
    const segLen = length / segs;

    const pos = origin.clone();
    const heading = dir.clone().normalize();
    let r = radius;
    let ring = null;

    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      // Bend: branches curve toward the light as they climb, plus wander.
      heading.x += (rand() - 0.5) * sp.curve;
      heading.z += (rand() - 0.5) * sp.curve;
      heading.y += (depth === 0 ? 0.02 : 0.055) * sp.curve * 8;
      heading.normalize();

      const next = pos.clone().addScaledVector(heading, segLen);
      const rNext = r * sp.taper;
      ring = this._tube(pos, next, r, rNext, sides, ring, shade);
      pos.copy(next);
      r = rNext;

      // Fork off child limbs above the species' start height. The radius
      // floor is what finally stops the recursion — twigs get too thin to
      // carry another generation.
      const canFork = depth < sp.depth && t >= sp.startFork && r > 0.014;
      if (canFork && (s === segs - 1 || rand() < 0.42)) {
        const n = s === segs - 1 ? sp.forks : 1;
        for (let f = 0; f < n; f++) {
          const a = rand() * Math.PI * 2;
          const spread = sp.forkAngle * (0.6 + rand() * 0.8);
          const child = heading.clone();
          // Rotate the child away from the parent axis.
          _axis.set(Math.cos(a), 0, Math.sin(a)).normalize();
          child.applyAxisAngle(_axis, spread * sp.forkSpread);
          child.y = Math.max(child.y, depth === 0 ? 0.15 : -0.25);
          child.normalize();
          this._branch(
            pos.clone(),
            child,
            length * sp.lengthFalloff * (0.75 + rand() * 0.45),
            r * (0.62 + rand() * 0.2),
            depth + 1,
            sp, rand, shade
          );
        }
        if (s === segs - 1) return; // trunk ends where it forks
      }
    }

    // Twig tip: this is where foliage hangs.
    if (depth >= 1) {
      this.clusters.push({
        root: this._root,
        x: pos.x, y: pos.y, z: pos.z,
        r: sp.leafSize * (0.55 + rand() * 0.6) * (1 - depth * 0.12),
        w: sp.leafDensity * (depth >= sp.depth - 1 ? 1.4 : 0.7)
      });
    }
  }

  /** Grow a tree at (x, z), rooted at ground height `baseY`. */
  add(x, z, speciesName, scale = 1, seed = 1, baseY = 0) {
    const sp = SPECIES[speciesName] || SPECIES.oak;
    const rand = rng(seed);
    const shade = new THREE.Color().setHSL(
      sp.barkHue + (rand() - 0.5) * 0.02,
      0.22 + rand() * 0.12,
      0.14 + rand() * 0.1
    );

    const h = sp.height * scale * (0.85 + rand() * 0.35);
    const r = sp.radius * scale * (0.85 + rand() * 0.3);
    const v0 = this.vertCount, i0 = this.indices.length;
    const origin = new THREE.Vector3(x, baseY, z);
    const dir = new THREE.Vector3((rand() - 0.5) * 0.08, 1, (rand() - 0.5) * 0.08).normalize();
    this._root = [x, baseY, z, h];

    this._branch(origin, dir, h, r, 0, sp, rand, shade);

    // Root flare: a few short buttress stubs at the base.
    const roots = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + rand();
      const d = new THREE.Vector3(Math.cos(a), -0.55, Math.sin(a)).normalize();
      const start = new THREE.Vector3(x, baseY + 0.55 * scale, z);
      const end = start.clone().addScaledVector(d, 1.1 * scale);
      end.y = Math.max(end.y, baseY + 0.04);
      this._tube(start, end, r * 0.55, r * 0.16, 4, null, shade);
    }

    (this._ranges || (this._ranges = [])).push({ x, z, v0, v1: this.vertCount, i0, i1: this.indices.length });
    this.trunkColliders.push({ x, z, r: r * 1.5, h });
    return { height: h, radius: r };
  }

  /**
   * Fuse everything grown so far into meshes, one per 48 m tile of ground.
   * One mesh for the whole forest could never be culled: it was drawn in full,
   * twice (colour and shadow), whichever way you looked.
   */
  build() {
    const mat = WIND.patchBranches(new THREE.MeshLambertMaterial({ vertexColors: true }));
    // Shadows sway with the branches that cast them.
    const depth = WIND.patchBranches(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    const CELL = 48;
    const cells = new Map();
    for (const t of this._ranges || []) {
      const k = Math.floor(t.x / CELL) + ',' + Math.floor(t.z / CELL);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(t);
    }
    const group = new THREE.Group();
    for (const trees of cells.values()) {
      let nv = 0, ni = 0;
      for (const t of trees) { nv += t.v1 - t.v0; ni += t.i1 - t.i0; }
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
      const root = new Float32Array(nv * 4);
      const idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const t of trees) {
        const n = t.v1 - t.v0;
        pos.set(this.positions.slice(t.v0 * 3, t.v1 * 3), vo * 3);
        nrm.set(this.normals.slice(t.v0 * 3, t.v1 * 3), vo * 3);
        col.set(this.colors.slice(t.v0 * 3, t.v1 * 3), vo * 3);
        root.set(this.roots.slice(t.v0 * 4, t.v1 * 4), vo * 4);
        for (let i = t.i0; i < t.i1; i++) idx[io++] = this.indices[i] - t.v0 + vo;
        vo += n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aRoot', new THREE.BufferAttribute(root, 4));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      // The crowns move, so the bounds get a little slack.
      geo.boundingSphere.radius += 2;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      group.add(mesh);
    }
    return group;
  }

  get stats() {
    return {
      branches: this.clusters.length,
      vertices: this.vertCount,
      triangles: this.indices.length / 3,
      clusters: this.clusters.length
    };
  }
}
