import * as THREE from 'three';

/**
 * Island — the BATTLEGROUND arena.
 *
 * A 2400 x 2400 m island built from a procedural heightfield: rolling hills,
 * two lakes, a river cutting to the coast, beaches at the waterline and
 * cliffs inland. Eighteen named landmarks sit on flattened pads so buildings
 * never float or sink.
 *
 * The terrain is one merged mesh. Collision uses a heightfield sampler rather
 * than boxes — a 2400 m island can't be paved with colliders — so the player
 * and bots query ground height directly.
 *
 * On doubling: landmark coordinates scale with the island, but their radii
 * only grow by ~1.4x and six new districts fill the extra ground. Scaling
 * everything by two would have produced the same twelve places bigger, which
 * reads as the same map — more places to go is what actually makes it larger.
 */

/** Named landmarks. Each is a district with its own look and loot weight. */
export const POIS = [
  { id: 'foundry', name: 'TILTED FOUNDRY', x: -420, z: -380, r: 109, kind: 'industrial', loot: 1.4 },
  { id: 'harbor', name: 'SALT HARBOR', x: 680, z: 600, r: 118, kind: 'docks', loot: 1.3 },
  { id: 'greenhouse', name: 'THE GREENHOUSE', x: 120, z: -660, r: 87, kind: 'glass', loot: 1.1 },
  { id: 'rustwood', name: 'RUSTWOOD', x: -740, z: 280, r: 104, kind: 'town', loot: 1.35 },
  { id: 'cinder', name: 'CINDER PEAK', x: 360, z: -240, r: 98, kind: 'mountain', loot: 1.2 },
  { id: 'motel', name: 'MOTEL ROW', x: -160, z: 500, r: 92, kind: 'town', loot: 1.15 },
  { id: 'quarry', name: 'THE QUARRY', x: 800, z: -560, r: 112, kind: 'quarry', loot: 1.25 },
  { id: 'lilypad', name: 'LILYPAD LAKE', x: -80, z: 60, r: 126, kind: 'lake', loot: 0.7 },
  { id: 'boneyard', name: 'BONEYARD', x: -690, z: -600, r: 101, kind: 'scrap', loot: 1.3 },
  { id: 'chapel', name: 'SUNKEN CHAPEL', x: 500, z: 240, r: 76, kind: 'ruin', loot: 1.0 },
  { id: 'silos', name: 'THE SILOS', x: -360, z: 840, r: 90, kind: 'farm', loot: 1.1 },
  { id: 'ridge', name: 'WATCHTOWER RIDGE', x: 860, z: -80, r: 81, kind: 'ridge', loot: 0.95 },
  // --- Districts added to fill the doubled island ---------------------------
  { id: 'terminal', name: 'NEON TERMINAL', x: -820, z: -120, r: 100, kind: 'town', loot: 1.35 },
  { id: 'coolant', name: 'COOLANT WORKS', x: 300, z: 780, r: 95, kind: 'industrial', loot: 1.3 },
  { id: 'dunes', name: 'AMBER DUNES', x: -560, z: 640, r: 88, kind: 'quarry', loot: 1.1 },
  { id: 'array', name: 'STARFALL ARRAY', x: 540, z: -720, r: 82, kind: 'ridge', loot: 1.2 },
  { id: 'vault', name: 'THE VAULT', x: -120, z: -880, r: 78, kind: 'ruin', loot: 1.45 },
  { id: 'lagoon', name: 'MIRROR LAGOON', x: 780, z: 300, r: 96, kind: 'lake', loot: 0.75 }
];

// Resolved once. _rawHeight runs per heightfield vertex, so it can't afford a
// linear search, and bare indices into POIS break the moment the list is
// reordered.
const LAKES = POIS.filter((p) => p.kind === 'lake');
const MAIN_LAKE = POIS.find((p) => p.id === 'lilypad');
const PEAK = POIS.find((p) => p.id === 'cinder');

export const ISLAND_SIZE = 2400;
const HALF = ISLAND_SIZE / 2;
// Resolution rises with the island but not in step with it: matching the old
// 7.5 m cell would mean 4x the vertices for ground most players never stand on.
const GRID = 256;              // heightfield resolution -> 9.375 m cells
const CELL = ISLAND_SIZE / GRID;
export const WATER_LEVEL = 0;

/** Cheap deterministic value noise — no dependencies, same island every time. */
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y) => {
    const u = (h & 1) ? x : -x;
    const v = (h & 2) ? y : -y;
    return u + v;
  };
  return (x, y) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    ) * 0.5;
  };
}

export class Island {
  constructor(world, seed = 1337) {
    this.world = world;
    this.game = world.game;
    this.noise = makeNoise(seed);
    this.heights = new Float32Array((GRID + 1) * (GRID + 1));
    this._buildHeightfield();
  }

  /** Terrain height at a world position, bilinearly interpolated. */
  heightAt(x, z) {
    const fx = (x + HALF) / CELL;
    const fz = (z + HALF) / CELL;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= GRID || iz >= GRID) return -14;
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const w = GRID + 1;
    const h00 = h[iz * w + ix];
    const h10 = h[iz * w + ix + 1];
    const h01 = h[(iz + 1) * w + ix];
    const h11 = h[(iz + 1) * w + ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Raw shape before POI flattening: island falloff, hills, lake, river. */
  _rawHeight(x, z) {
    const n = this.noise;
    // Radial falloff makes it an island rather than an infinite plain.
    const d = Math.sqrt(x * x + z * z) / HALF;
    const falloff = Math.max(0, 1 - Math.pow(d * 1.06, 3.1));

    // Layered hills. The plateau term dominates so the interior sits well
    // clear of the waterline; noise only shapes it into hills and valleys.
    // The two lowest octaves halve in frequency so the island's silhouette
    // scales with it. The upper two keep their old frequency, which means the
    // extra ground arrives with extra detail rather than the same hills
    // stretched to twice the width.
    let h = 0;
    h += n(x * 0.0011, z * 0.0011) * 34;
    h += n(x * 0.00275, z * 0.00275) * 15;
    h += n(x * 0.009, z * 0.009) * 6;
    h += n(x * 0.031, z * 0.031) * 2.0;
    h = h * falloff * 0.62 + falloff * 52 - 11;

    // Every 'lake' landmark carves its own basin.
    for (let i = 0; i < LAKES.length; i++) {
      const lake = LAKES[i];
      const ld = Math.hypot(x - lake.x, z - lake.z);
      if (ld < lake.r) h -= Math.pow(1 - ld / lake.r, 1.6) * 26;
    }

    // River: a sine channel running from the main lake to the north-east coast.
    const rz = z * 0.9 + Math.sin(x * 0.004) * 120;
    const riverDist = Math.abs(rz - (x * 0.55 - 80));
    if (riverDist < 40 && x > MAIN_LAKE.x) {
      const t = 1 - riverDist / 40;
      h -= Math.pow(t, 1.4) * 19;
    }

    // Cinder Peak gets a real mountain.
    const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
    if (pd < 300) h += Math.pow(1 - pd / 300, 2.2) * 68;

    return h;
  }

  _buildHeightfield() {
    const w = GRID + 1;
    // Pass 1: raw terrain.
    for (let iz = 0; iz <= GRID; iz++) {
      for (let ix = 0; ix <= GRID; ix++) {
        const x = ix * CELL - HALF;
        const z = iz * CELL - HALF;
        this.heights[iz * w + ix] = this._rawHeight(x, z);
      }
    }
    // Pass 2: flatten a pad under every buildable POI so structures sit level.
    for (const poi of POIS) {
      if (poi.kind === 'lake') continue;
      const padH = this._rawHeight(poi.x, poi.z);
      poi.groundY = padH;
      const rad = poi.r;
      const i0 = Math.max(0, Math.floor((poi.x - rad + HALF) / CELL));
      const i1 = Math.min(GRID, Math.ceil((poi.x + rad + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((poi.z - rad + HALF) / CELL));
      const j1 = Math.min(GRID, Math.ceil((poi.z + rad + HALF) / CELL));
      for (let iz = j0; iz <= j1; iz++) {
        for (let ix = i0; ix <= i1; ix++) {
          const x = ix * CELL - HALF;
          const z = iz * CELL - HALF;
          const d = Math.hypot(x - poi.x, z - poi.z);
          if (d > rad) continue;
          // Full flatten in the core, easing out to natural terrain at the rim.
          const t = Math.min(1, Math.max(0, 1 - (d / rad - 0.45) / 0.55));
          const k = t * t * (3 - 2 * t);
          const idx = iz * w + ix;
          this.heights[idx] = this.heights[idx] * (1 - k) + padH * k;
        }
      }
    }
    // Record spawn-safe ground for the lakes too — on the shore, not the bed.
    for (const lake of LAKES) {
      lake.groundY = this.heightAt(lake.x + lake.r * 0.8, lake.z);
    }
  }

  /** Build the terrain mesh, water plane and beach ring. */
  build() {
    const w = GRID + 1;
    const geo = new THREE.PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE, GRID, GRID);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const ix = i % w;
      const iz = Math.floor(i / w);
      const h = this.heights[iz * w + ix];
      pos.setY(i, h);

      // Slope drives the material blend: flats get grass, steeps get rock.
      const hL = this.heights[iz * w + Math.max(0, ix - 1)];
      const hR = this.heights[iz * w + Math.min(GRID, ix + 1)];
      const hD = this.heights[Math.max(0, iz - 1) * w + ix];
      const hU = this.heights[Math.min(GRID, iz + 1) * w + ix];
      const slope = Math.min(1, (Math.abs(hR - hL) + Math.abs(hU - hD)) / (CELL * 2.2));

      if (h < 1.2) {
        c.setHSL(0.11, 0.42, 0.56);                       // wet sand
      } else if (h < 4) {
        c.setHSL(0.12, 0.38, 0.52);                       // dry beach
      } else if (h > 52) {
        c.setHSL(0.08, 0.05, 0.62 + Math.random() * 0.06); // snow-dusted rock
      } else if (slope > 0.55) {
        c.setHSL(0.07, 0.12, 0.3);                        // cliff rock
      } else {
        const lush = 0.22 + Math.random() * 0.1 - slope * 0.08;
        c.setHSL(0.25 + Math.random() * 0.03, 0.34, lush);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.world.group.add(mesh);
    this.mesh = mesh;

    // The ocean is built separately (see Ocean.js) so it can carry real
    // planar reflections rather than being a flat translucent plane.
    return mesh;
  }

  /**
   * Scatter trees and rocks by biome, avoiding POI cores and water.
   *
   * The budget is a count, not a density, so it has to rise with the island or
   * doubling the map just spreads the same forest thinner. It does NOT rise
   * fourfold with the area — trees merge into a single mesh and that would
   * quadruple the triangle count for scenery seen mostly from a distance.
   */
  vegetate(treeBudget = 1700) {
    const w = this.world;
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    let placed = 0;
    let n = 0;
    while (placed < treeBudget && n < treeBudget * 6) {
      const t = n / treeBudget;
      const a = n * GOLDEN;
      const r = Math.sqrt(t) * HALF * 0.94;
      const x = Math.cos(a) * r + (Math.random() - 0.5) * 26;
      const z = Math.sin(a) * r + (Math.random() - 0.5) * 26;
      n++;
      const h = this.heightAt(x, z);
      // No trees in the sea, on the beach, on cliffs or on the peak.
      if (h < 3.5 || h > 50) continue;
      // Keep POI interiors clear enough to fight in.
      let blocked = false;
      for (const p of POIS) {
        if (Math.hypot(x - p.x, z - p.z) < p.r * 0.85) { blocked = true; break; }
      }
      if (blocked) continue;

      const kinds = ['oak', 'pine', 'birch', 'pine', 'oak', 'scrub'];
      const kind = h > 34 ? 'pine' : kinds[Math.floor(Math.abs(x + z)) % kinds.length];
      w._treeAt(x, h, z, 0.85 + Math.random() * 0.6, placed * 3.7, kind);
      placed++;
    }
    this.treesPlaced = placed;

    // Boulders on the high slopes.
    let rocks = 0;
    for (let i = 0; i < 520; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * HALF * 0.9;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < 5) continue;
      w._rockAt(x, h, z, 0.9 + Math.random() * 2.2, i);
      rocks++;
    }
    this.rocksPlaced = rocks;
    return { trees: placed, rocks };
  }
}
