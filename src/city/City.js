import * as THREE from 'three';
import { normalFromBump } from '../engine/Photoreal.js';
import { buildDungeons } from './Dungeon.js';
import { Ocean } from './Ocean.js';
import { buildParkland, buildBeachDebris } from './Ground.js';
import { facadeMaterial, facadeMaterials, tagFacade, STYLES, STYLE_FOR, roofTileMaterial } from './Facade.js';
import { Undercity } from './Undercity.js';
import { buildIndustry } from './Industry.js';

/**
 * City — the GTAZ sandbox: a 2000 m coastal city with no missions in it.
 *
 * Built from a street grid rather than hand-placed geometry. Roads are laid
 * first and everything else is derived from them, which is what keeps the
 * place coherent: buildings fill the blocks the roads leave behind, kerbs and
 * lamps follow the kerb line, and the road graph the generator produces is the
 * same graph traffic and police drive on. Hand-placing roads and then bolting
 * on a navigation graph is how you end up with cars driving through walls.
 *
 * DISTRICTS are a function of distance from the centre, so the skyline falls
 * away naturally instead of switching over at a hard border:
 *   core     towers, tight blocks, glass
 *   midtown  offices and apartments
 *   suburb   houses, gardens, wide blocks
 *   industry warehouses and yards, on the east flank
 *   shore    beach and boardwalk along the west edge
 *
 * The ground is flat on purpose. Cars, kerbs and a grid do not want rolling
 * terrain, and a flat plate means the whole city needs exactly one collider
 * underfoot instead of a heightfield sampled every frame by every vehicle.
 */

export const CITY_SIZE = 2000;
const HALF = CITY_SIZE / 2;

/** Street layout. Avenues run N-S, streets run E-W. */
export const BLOCK = 105;          // centre-to-centre spacing of roads
export const ROAD_W = 17;          // driveable width
const KERB_W = 3.4;                // pavement either side
const LANE = ROAD_W / 4;

// Metres covered by one repeat of the facade texture. The canvas draws an
// eight-by-eight window grid, so 28 m gives a 3.5 m window bay and a 3.5 m
// storey — close enough to real commercial construction that the eye reads
// the building's height off its window count without being told.
const FACADE_TILE = 28;

export const DISTRICTS = [
  { id: 'core', name: 'SPIRE CROSS', x: 0, z: 0, r: 300 },
  { id: 'midtown', name: 'ASHWATER', x: 420, z: -330, r: 300 },
  { id: 'docks', name: 'IRONSIDE DOCKS', x: 640, z: 420, r: 320 },
  { id: 'suburb', name: 'PALM HOLLOW', x: -450, z: 480, r: 340 },
  { id: 'hills', name: 'VISTA HEIGHTS', x: -520, z: -470, r: 320 },
  { id: 'shore', name: 'LONG SHORE', x: -820, z: 40, r: 260 },
  { id: 'strip', name: 'THE STRIP', x: 300, z: 620, r: 240 },
  { id: 'airfield', name: 'CROSSWIND FIELD', x: 760, z: -680, r: 280 }
];

// Island extents, shared by the ground plate and the shoreline so they can't
// disagree. The ground used to be laid out 2800 m across while the beach
// ended at 1090 — 300 m of grass sat on top of the sea in every direction and
// the ocean was simply buried under it.
const SHORE_INSET = 40;                  // land stops this far inside the grid
const BEACH_W = 130;                     // width of the sand ring
const SHORE = HALF - SHORE_INSET;        // 960
const BEACH_OUTER = SHORE + BEACH_W;     // 1090 — the true edge of the island
const SEA_LEVEL = -0.9;

/** Traffic-lamp lens colours, lit and dark. Index order: red, amber, green. */
const LAMP_ON = [0xff2a18, 0xffa513, 0x22ff5a];
const LAMP_OFF = [0x2a0b08, 0x2a1e06, 0x08240f];

/** Deterministic RNG so the same city comes back every session. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class City {
  constructor(world, seed = 90210) {
    this.world = world;
    this.game = world.game;
    this.rand = rng(seed);

    // Road graph: nodes at intersections, edges are driveable segments.
    this.nodes = [];
    this.edges = [];
    this.nodeAt = new Map();       // "gx,gz" -> node
    this.buildings = [];
    this.spawns = [];              // safe places to put a car or a person
    this.enterable = [];           // shops and cafes you can walk into
    this.venues = [];              // the subset that serve food
  }

  // --------------------------------------------------------------- road grid

  /**
   * Grid lines. The core gets an extra road between each pair so downtown
   * blocks are tighter than suburban ones — the single cheapest thing you can
   * do to make a generated city stop feeling uniform.
   */
  _gridLines() {
    const lines = [];
    for (let v = -HALF + BLOCK; v <= HALF - BLOCK; v += BLOCK) lines.push(v);
    const extra = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const mid = (lines[i] + lines[i + 1]) / 2;
      if (Math.abs(mid) < 300) extra.push(mid);
    }
    return lines.concat(extra).sort((a, b) => a - b);
  }

  district(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const d of DISTRICTS) {
      const dist = Math.hypot(x - d.x, z - d.z) / d.r;
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return bestD < 1.15 ? best : null;
  }

  /** Height class for a block, from district and distance to centre. */
  _blockProfile(x, z) {
    const d = this.district(x, z);
    const id = d ? d.id : 'midtown';
    const r = this.rand();
    if (id === 'core') return { kind: 'tower', h: 60 + r * 130, w: 0.82 };
    if (id === 'midtown' || id === 'strip') return { kind: 'block', h: 26 + r * 46, w: 0.86 };
    if (id === 'docks') return { kind: 'warehouse', h: 12 + r * 12, w: 0.92 };
    if (id === 'airfield') return { kind: 'hangar', h: 14 + r * 10, w: 0.94 };
    if (id === 'suburb' || id === 'hills') return { kind: 'house', h: 6 + r * 6, w: 0.5 };
    if (id === 'shore') return { kind: 'shore', h: 8 + r * 10, w: 0.6 };
    return { kind: 'block', h: 18 + r * 26, w: 0.8 };
  }

  build() {
    const w = this.world;
    this._materials();

    const xs = this._gridLines();
    const zs = this._gridLines();
    this.xs = xs;
    this.zs = zs;

    this._ground();
    this._roads(xs, zs);
    this._roadDetail(xs, zs);
    this._graph(xs, zs);
    this._blocks(xs, zs);
    this._shoreline();
    this._airport();
    // Signals first: street furniture needs to know where they are so it can
    // keep its lamp posts clear of them.
    // The working districts: the quay, the container yard and its cranes, the
    // apron's paint and vehicles, the marina's fittings.
    buildIndustry(this);
    this._signals(xs, zs);
    this._streetFurniture(xs, zs);
    // What lies on the ground: lawns, grass, tree beds, leaves, paths and
    // benches in the parks; shells, weed, driftwood and dune grass on the
    // beach. Before the merge, so the static parts bake with the city.
    this.parkland = buildParkland(this);
    if (this.ocean) this.beachDebris = buildBeachDebris(this, this.ocean);

    // Distant skyline so the map doesn't end in fog with nothing behind it.
    if (w._skyline) w._skyline(HALF * 1.7, 0x2a3340, 'towers');

    // Dungeons BEFORE the merge. Built afterwards they stayed as thousands of
    // individual wall and floor blocks — 12,953 scene meshes against a merged
    // city of 86 batches, which is the whole draw-call win handed straight
    // back. They are static geometry like everything else, so they belong in
    // the bake.
    // The story under the city. Built before the halls, because the halls
    // ask it for their inscriptions as they are dressed.
    this.undercity = new Undercity(this.game);
    this.dungeons = buildDungeons(this, this.rand);

    // Anything still wearing a facade material without building data gets a
    // default — the merge needs every mesh in a batch to carry the same
    // attributes, or it refuses the whole batch.
    const facadeSet = new Set(facadeMaterials());
    w.group.traverse((o) => {
      if (o.isMesh && facadeSet.has(o.material) && !o.geometry.attributes.aBld) {
        const p = o.position;
        tagFacade(o, [Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233)) % 1, 1, 1, 0]);
      }
    });

    const merged = this._mergeStatics();
    return {
      buildings: this.buildings.length, nodes: this.nodes.length,
      edges: this.edges.length, merged
    };
  }

  /**
   * Collapse the static city into a handful of meshes.
   *
   * A thousand buildings meant a thousand draw calls, and each one is CPU
   * work the GPU then waits on — the city was issuing ~8,000 calls a frame
   * against a sane budget of a few hundred, which is what pinned the frame
   * rate. None of this geometry ever moves, so it can be baked per material
   * into single buffers. The visual result is identical; the cost is not.
   *
   * Anything animated, instanced, or transparent is left alone: it either
   * can't be merged or is already cheap.
   */
  _mergeStatics() {
    const w = this.world;
    // Batched per material AND per 160 m tile. One batch per material
    // spanning the whole city could never be culled, so all of it — and all
    // of it again for the shadow map — was drawn every frame, whichever way
    // the camera faced.
    //
    // Plain untextured materials are additionally FOLDED: their colour, glow,
    // roughness and metalness are written per vertex, and they share a single
    // material per tile (see foldMaterial). Same pixels, but a few hundred
    // fewer draw calls — the city had ~150 such materials, each a draw per
    // tile. Anything that changes at runtime is kept out (see _liveMaterials).
    const CELL = 160;
    const live = this._liveMaterials();
    const groups = new Map();       // material (or fold material) -> tile -> meshes
    for (const obj of w.group.children) {
      if (!obj.isMesh || obj.isInstancedMesh || obj.userData.dynamic) continue;
      const mat = obj.material;
      if (!mat || Array.isArray(mat)) continue;
      // Transparent parts merge only when they are many panes of one shared
      // material (shop glazing); anything else keeps its own sort order.
      if (mat.transparent && mat !== this._shopGlass) continue;
      if (!obj.geometry || !obj.geometry.attributes.position) continue;
      obj.updateMatrixWorld(true);
      const e = obj.matrixWorld.elements;
      const g = obj.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      // Small things (bins, kerbs, benches, signs) go in their own batches,
      // which are dropped beyond DETAIL_DIST: unreadable that far out.
      const small = g.boundingSphere.radius * obj.matrixWorld.getMaxScaleOnAxis() < 4;
      const key = Math.floor(e[12] / CELL) + ',' + Math.floor(e[14] / CELL) + (small ? 's' : '');
      const gk = this._foldable(mat, live) ? this._foldMaterial(mat) : mat;
      let tiles = groups.get(gk);
      if (!tiles) groups.set(gk, (tiles = new Map()));
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(obj);
    }

    // Written straight into one buffer per material, transformed on the way
    // in. The old path cloned all ~118k parts first, and then removed each
    // original with group.remove() — a search-and-splice through a 118k-long
    // child list, every time. Together that was over twenty seconds of load.
    let batches = 0;
    this._detailTiles = [];
    const folded = new Set();
    for (const [mat, tiles] of groups) {
      const fold = !!mat.userData.cityFold;
      let total = 0;
      for (const l of tiles.values()) total += l.length;
      if (total < 2 && !fold) continue;
      for (const [key, list] of tiles) {
        const mesh = new THREE.Mesh(bakeWorld(list, fold), mat);
        if (key.endsWith('s')) this._detailTiles.push(mesh);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Already in world space.
        mesh.matrixAutoUpdate = false;
        w.group.add(mesh);
        batches++;
        for (const o of list) folded.add(o);
      }
    }
    // One pass instead of one splice per part. NOT disposed: _block hands
    // every box the same shared BoxGeometry.
    const kept = w.group.children.filter((o) => !folded.has(o));
    for (const o of folded) o.parent = null;
    w.group.children.length = 0;
    w.group.children.push(...kept);
    return { batches, meshesFolded: folded.size };
  }

  /** Materials something changes while the game runs. Never folded. */
  _liveMaterials() {
    const live = new Set();
    for (const b of this.sigBuckets || []) for (const m of [...b.ns, ...b.ew]) live.add(m);
    for (const d of this.dungeons || []) {
      for (const f of d._flames || []) live.add(f.mat);
      for (const t of d.torches || []) live.add(t.mat);
    }
    return live;
  }

  /** An untextured, stock MeshStandardMaterial whose values never change. */
  _foldable(m, live) {
    if (m.type !== 'MeshStandardMaterial' || live.has(m) || m.userData.animated) return false;
    if (m.transparent || m.vertexColors || m.alphaTest || m.opacity !== 1 || !m.visible) return false;
    if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
    if (m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return false;
    for (const k in m) if (m[k] && m[k].isTexture) return false;
    return true;
  }

  /** The shared material a foldable one is folded into. */
  _foldMaterial(m) {
    const key = [m.side, m.flatShading, m.envMapIntensity, m.fog, m.depthWrite, m.depthTest,
      m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.toneMapped, m.dithering,
      m.shadowSide, m.wireframe, m.colorWrite].join('|');
    this._folds = this._folds || new Map();
    let f = this._folds.get(key);
    if (!f) {
      f = foldMaterial(m);
      this._folds.set(key, f);
    }
    return f;
  }

  // ----------------------------------------------------------------- surfaces

  _materials() {
    const w = this.world;
    const tex = (draw, rep = 1) => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      draw(c.getContext('2d'), 512);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.repeat.set(rep, rep);
      t.anisotropy = 8;
      return t;
    };

    /**
     * Derive NORMAL and ROUGHNESS maps from the same canvas that produced the
     * colour.
     *
     * This is the missing half of the material. Albedo alone tells the
     * renderer what colour a surface is and nothing about how it catches
     * light, so every surface in the city reflected identically — which is
     * exactly why it read as plastic. A normal map fakes the surface relief
     * (kerb grain, asphalt chip, window reveals) at no geometry cost, and a
     * roughness map is what lets wet tarmac shine while the pavement beside it
     * stays matte.
     *
     * Both are derived from luminance: bright pixels read as raised and
     * smoother, dark pixels as recessed and rougher. That correlation is not
     * physically rigorous, but on procedurally drawn surfaces it lands
     * remarkably close and costs one pass over the canvas.
     */
    const pbr = (draw, rep = 1, { bumpiness = 2.0, roughLo = 0.45, roughHi = 0.95 } = {}) => {
      const S = 512;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const ctx = c.getContext('2d');
      draw(ctx, S);

      const src = ctx.getImageData(0, 0, S, S).data;
      const rc = document.createElement('canvas');
      rc.width = rc.height = S;
      const rctx = rc.getContext('2d');
      const rimg = rctx.createImageData(S, S);
      const bc = document.createElement('canvas');
      bc.width = bc.height = S;
      const bctx = bc.getContext('2d');
      const bimg = bctx.createImageData(S, S);

      for (let i = 0; i < S * S; i++) {
        const o = i * 4;
        const lum = (src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114) / 255;
        // Roughness: darker = rougher.
        const r = Math.round((roughHi - (roughHi - roughLo) * lum) * 255);
        rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = r;
        rimg.data[o + 3] = 255;
        // Height field for the normal pass.
        const h = Math.round(lum * 255);
        bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = h;
        bimg.data[o + 3] = 255;
      }
      rctx.putImageData(rimg, 0, 0);
      bctx.putImageData(bimg, 0, 0);

      const colour = new THREE.CanvasTexture(c);
      colour.colorSpace = THREE.SRGBColorSpace;
      const rough = new THREE.CanvasTexture(rc);
      const bump = new THREE.CanvasTexture(bc);
      const normal = normalFromBump(bump, bumpiness) || null;

      for (const t of [colour, rough, normal]) {
        if (!t) continue;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rep, rep);
        t.anisotropy = 8;
      }
      return { map: colour, roughnessMap: rough, normalMap: normal };
    };
    this._pbr = pbr;

    // Asphalt: dark, speckled, with a worn sheen down the wheel tracks.
    const asphalt = pbr((g, S) => {
      g.fillStyle = '#22242a';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 14000; i++) {
        const v = 20 + Math.random() * 42;
        g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.25 + Math.random() * 0.4})`;
        g.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
      }
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(15,15,18,${0.1 + Math.random() * 0.2})`;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath();
        g.moveTo(Math.random() * S, Math.random() * S);
        g.lineTo(Math.random() * S, Math.random() * S);
        g.stroke();
      }
    }, 6);

    // Pavement slabs.
    const paving = pbr((g, S) => {
      g.fillStyle = '#6b6a66';
      g.fillRect(0, 0, S, S);
      const cell = S / 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = 96 + Math.random() * 26;
          g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
          g.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3);
        }
      }
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.14})`;
        g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
    }, 3);

    const grass = pbr((g, S) => {
      g.fillStyle = '#3c5a2c';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 18000; i++) {
        const h = 40 + Math.random() * 60;
        g.fillStyle = `rgba(${h * 0.5},${h + 20},${h * 0.4},0.5)`;
        g.fillRect(Math.random() * S, Math.random() * S, 2, 3);
      }
    }, 40);

    const sand = pbr((g, S) => {
      g.fillStyle = '#cdb98c';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 16000; i++) {
        const v = 180 + Math.random() * 60;
        g.fillStyle = `rgba(${v},${v - 14},${v - 44},0.5)`;
        g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
    }, 24);

    // Full PBR set on every surface you drive over or stand on. The
    // roughness map is what stops tarmac, paving, grass and sand all
    // reflecting the sky identically, and the normal map gives each one its
    // own grain under a moving sun.
    this.mats = {
      road: new THREE.MeshStandardMaterial({ ...asphalt, roughness: 1.0, metalness: 0.04,
        normalScale: new THREE.Vector2(0.7, 0.7) }),
      kerb: new THREE.MeshStandardMaterial({ ...paving, roughness: 1.0, metalness: 0.02,
        normalScale: new THREE.Vector2(0.9, 0.9) }),
      grass: new THREE.MeshStandardMaterial({ ...grass, roughness: 1.0, metalness: 0,
        normalScale: new THREE.Vector2(0.5, 0.5) }),
      sand: new THREE.MeshStandardMaterial({ ...sand, roughness: 1.0, metalness: 0,
        normalScale: new THREE.Vector2(0.6, 0.6) }),
      paint: new THREE.MeshStandardMaterial({ color: 0xd8d2b4, roughness: 0.7 }),
      water: new THREE.MeshStandardMaterial({
        color: 0x1e4a63, roughness: 0.16, metalness: 0.5, transparent: true, opacity: 0.9
      })
    };

    // Facades: one shared window-grid texture per palette, tinted per building.
    // Patches and ironwork: the same asphalt, darker and smoother, so a
    // repair reads as newer tar rather than a different material.
    this.mats.asphaltDark = new THREE.MeshStandardMaterial({
      color: 0x22252a, roughness: 0.82, metalness: 0.05
    });

    // Facades are a shader now, not a texture: see Facade.js. `facades` is
    // kept as the list of styled materials for anything that still picks one
    // at random.
    this.facades = Object.keys(STYLES).map((id) => facadeMaterial(id));
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.archMats = {
      concrete: std({ color: 0xb9b3a7, roughness: 0.88 }),
      stone: std({ color: 0xd6cfbf, roughness: 0.85 }),
      metal: std({ color: 0x8d9398, roughness: 0.45, metalness: 0.7 }),
      plant: std({ color: 0xa4a9ad, roughness: 0.55, metalness: 0.5 }),
      grille: std({ color: 0x2c3034, roughness: 0.6, metalness: 0.6 }),
      iron: std({ color: 0x23262a, roughness: 0.6, metalness: 0.65 }),
      fin: std({ color: 0xbfc5cc, roughness: 0.3, metalness: 0.85 }),
      tank: std({ color: 0x6b4a32, roughness: 0.9 }),
      hedge: std({ color: 0x2f4a24, roughness: 0.95 }),
      door: std({ color: 0x3a2618, roughness: 0.7 }),
      // Opaque, reflective tinted glass. As a transparent material every
      // railing stayed out of the static merge — 9,294 separate draw calls
      // for balcony glass alone.
      glassRail: std({ color: 0x6f8796, roughness: 0.08, metalness: 0.55, envMapIntensity: 1.2 }),
      warn: std({ color: 0x2a0606, emissive: 0xff2010, emissiveIntensity: 2.2 }),
      crown: std({ color: 0x1a1d20, emissive: 0xf4f0e0, emissiveIntensity: 1.3 }),
      roofTerracotta: roofTileMaterial(0x9a4b33),
      roofSlate: roofTileMaterial(0x3c4046)
    };
  }

  _ground() {
    const w = this.world;
    // The plate stops at the SHORELINE now, not the outer edge of the sand.
    // Beyond it the ground is the sloped beach and seabed the ocean builds, and
    // a flat plate carried on under that would hold everything at street level
    // over the top of the sand you can see sloping down into the water.
    const span = SHORE * 2 + 2;
    const geo = new THREE.PlaneGeometry(span, span, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, this.mats.grass);
    m.position.y = -0.06;
    m.receiveShadow = true;
    w.group.add(m);

    w.physics.addBox(
      new THREE.Vector3(0, -3.06, 0),
      new THREE.Vector3(span, 6, span),
      null, { surface: 'soil' }
    );
  }

  /** Lay every road quad, plus lane markings. */
  /**
   * Scale a ground quad's UVs so its texture keeps a fixed real-world size.
   *
   * Same defect the facades had, in a different place. A road quad is 2000 m
   * long and the asphalt material repeats six times across it, which puts one
   * texture tile every 333 metres — so the speckle, the wheel-track sheen and
   * the grain were all stretched into invisibility and the road read as a
   * featureless grey plane. The pavement's slab grid was stretched the same
   * way, giving four-metre paving stones.
   *
   * `rep` is the repeat already baked into the shared material, divided out so
   * the two do not multiply.
   */
  _uvWorld(geo, sx, sz, tile, rep = 1) {
    const uv = geo.attributes.uv;
    const su = (sx / tile) / rep;
    const sv = (sz / tile) / rep;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
    return geo;
  }

  _roads(xs, zs) {
    const w = this.world;
    const road = this.mats.road;
    const quad = (cx, cz, sx, sz, mat, y) => {
      const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
      // 8 m of asphalt per texture tile. Any larger and the chip grain stops
      // reading at walking pace; any smaller and it tiles visibly at speed.
      this._uvWorld(g, sx, sz, 8, 6);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(cx, y, cz);
      m.receiveShadow = true;
      w.group.add(m);
      return m;
    };

    const L = CITY_SIZE;
    for (const x of xs) quad(x, 0, ROAD_W, L, road, 0.02);
    for (const z of zs) quad(0, z, L, ROAD_W, road, 0.021);

    // Dashed centre lines, skipped through junctions so they don't cross.
    const dash = 5, gap = 6.5;
    const paint = this.mats.paint;
    const marks = [];
    const nearCross = (v, list) => list.some((c) => Math.abs(v - c) < ROAD_W * 0.8);
    for (const x of xs) {
      for (let z = -HALF; z < HALF; z += dash + gap) {
        if (nearCross(z, zs)) continue;
        marks.push([x, z + dash / 2, 0.32, dash]);
      }
    }
    for (const z of zs) {
      for (let x = -HALF; x < HALF; x += dash + gap) {
        if (nearCross(x, xs)) continue;
        marks.push([x + dash / 2, z, dash, 0.32]);
      }
    }
    // One merged mesh: thousands of separate dashes would be thousands of draws.
    const geos = [];
    for (const [mx, mz, sx, sz] of marks) {
      const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(mx, 0.035, mz);
      geos.push(g);
    }
    if (geos.length) {
      const merged = mergeGeometries(geos);
      if (merged) {
        const mesh = new THREE.Mesh(merged, paint);
        mesh.receiveShadow = true;
        w.group.add(mesh);
      }
      for (const g of geos) g.dispose();
    }
  }

  /**
   * Everything painted on or set into the road surface.
   *
   * A bare asphalt plane with a dashed centre line is the single flattest
   * thing you look at in this game, because you spend the whole time driving
   * over it and it never changes. Real streets are covered in marks that tell
   * you where you are: edge lines, stop bars, crossings, and the patchwork of
   * repairs and ironwork that accumulates over decades.
   *
   * All of it is flat geometry at a few centimetres, merged per material into
   * a handful of meshes, and none of it collides — the road already has its
   * own floor. Cost is vertices at build time and nothing per frame.
   */
  _roadDetail(xs, zs) {
    const w = this.world;
    const rand = this.rand;
    const paint = this.mats.paint;
    const half = ROAD_W / 2;

    // Collected per material, merged once at the end.
    const white = [];
    const dark = [];
    const quad = (into, cx, cz, sx, sz, y) => {
      const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, y, cz);
      into.push(g);
    };

    const nearCross = (v, list) => list.some((c) => Math.abs(v - c) < ROAD_W * 0.75);

    // --- Edge lines ---------------------------------------------------------
    // The solid line at the lane's outer edge. More than any other mark this
    // is what gives a road width you can judge at speed.
    for (const x of xs) {
      for (let z = -HALF; z < HALF; z += 40) {
        if (nearCross(z, zs)) continue;
        const len = Math.min(40, HALF - z);
        quad(white, x - half + 0.55, z + len / 2, 0.18, len, 0.033);
        quad(white, x + half - 0.55, z + len / 2, 0.18, len, 0.033);
      }
    }
    for (const z of zs) {
      for (let x = -HALF; x < HALF; x += 40) {
        if (nearCross(x, xs)) continue;
        const len = Math.min(40, HALF - x);
        quad(white, x + len / 2, z - half + 0.55, len, 0.18, 0.034);
        quad(white, x + len / 2, z + half - 0.55, len, 0.18, 0.034);
      }
    }

    // --- Junctions: stop bars and zebra crossings ---------------------------
    // Drawn on all four approaches. The stop bar sits outside the crossing,
    // the way it does in the road, so the crossing is the thing you stop
    // short of rather than something you park on top of.
    for (const x of xs) {
      for (const z of zs) {
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const ox = x + dx * (half + 2.2);
          const oz = z + dz * (half + 2.2);
          const across = dx !== 0;
          // Stop bar.
          quad(white, ox + dx * 3.0, oz + dz * 3.0,
            across ? 0.4 : ROAD_W - 2.4, across ? ROAD_W - 2.4 : 0.4, 0.036);
          // Zebra stripes, spanning the full carriageway. Hard-coding seven
          // stripes covered under 7 m of a 17 m road, so every crossing
          // stopped halfway across and read as debris rather than a crossing.
          const n = Math.floor((ROAD_W - 2.2) / 1.3);
          for (let i = -n / 2; i <= n / 2; i++) {
            const off = i * 1.3;
            if (across) quad(white, ox, oz + off, 3.4, 0.66, 0.037);
            else quad(white, ox + off, oz, 0.66, 3.4, 0.037);
          }
        }
      }
    }

    // --- Ironwork and repairs ----------------------------------------------
    // Manhole covers, drain grates at the kerb line, and the darker rectangles
    // where the surface has been dug up and filled. The patches matter most:
    // an unbroken sheet of identical asphalt is the giveaway that a road was
    // generated rather than laid, resurfaced and dug up again.
    const lanes = [];
    for (const x of xs) for (let z = -HALF + 30; z < HALF; z += 46) lanes.push([x, z, true]);
    for (const z of zs) for (let x = -HALF + 30; x < HALF; x += 46) lanes.push([x, z, false]);
    for (const [lx, lz, vertical] of lanes) {
      const r = rand();
      const jx = (rand() - 0.5) * (ROAD_W - 5);
      if (r > 0.62) {
        // Manhole: a disc of darker iron, slightly proud of the surface.
        const g = new THREE.CircleGeometry(0.42, 12);
        g.rotateX(-Math.PI / 2);
        g.translate(vertical ? lx + jx : lx, 0.032, vertical ? lz : lz + jx);
        dark.push(g);
      }
      if (r < 0.34) {
        // Repair patch, deliberately not square to the road: a patch is cut
        // around the hole somebody dug, not aligned to the lane.
        const pw = 2.2 + rand() * 3.4;
        const pd = 1.4 + rand() * 2.6;
        const g = new THREE.PlaneGeometry(vertical ? pw : pd, vertical ? pd : pw, 1, 1);
        g.rotateX(-Math.PI / 2);
        g.rotateY((rand() - 0.5) * 0.09);
        g.translate(vertical ? lx + jx : lx, 0.0305, vertical ? lz : lz + jx);
        dark.push(g);
      }
    }

    // --- Kerbs --------------------------------------------------------------
    // The road quad is ROAD_W wide and the pavement starts at ROAD_W/2 + 0.5,
    // so a half-metre ribbon of bare ground showed down both sides of every
    // street in the city — a hard green seam between tarmac and paving. A kerb
    // is the thing that belongs in that gap anyway: it covers the seam, gives
    // the carriageway a defined edge, and puts a shadow line along the street
    // that reads from a long way off.
    const kerbs = [];
    const kerbAt = (cx, cz, sx, sz) => {
      const g = new THREE.BoxGeometry(sx, 0.19, sz);
      this._uvWorld(g, Math.max(sx, sz), 0.19, 5, 3);
      g.translate(cx, 0.095, cz);
      kerbs.push(g);
    };
    const KERB_OFF = half + 0.55;
    const KERB_T = 1.3;
    for (const x of xs) {
      for (let z = -HALF; z < HALF; z += 50) {
        if (nearCross(z + 25, zs)) continue;
        const len = Math.min(50, HALF - z);
        kerbAt(x - KERB_OFF, z + len / 2, KERB_T, len);
        kerbAt(x + KERB_OFF, z + len / 2, KERB_T, len);
      }
    }
    for (const z of zs) {
      for (let x = -HALF; x < HALF; x += 50) {
        if (nearCross(x + 25, xs)) continue;
        const len = Math.min(50, HALF - x);
        kerbAt(x + len / 2, z - KERB_OFF, len, KERB_T);
        kerbAt(x + len / 2, z + KERB_OFF, len, KERB_T);
      }
    }

    const flush = (geos, mat) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos);
      if (merged) {
        const mesh = new THREE.Mesh(merged, mat);
        mesh.receiveShadow = true;
        w.group.add(mesh);
      }
      for (const g of geos) g.dispose();
    };
    flush(white, paint);
    flush(dark, this.mats.asphaltDark || this.mats.road);
    flush(kerbs, this.mats.kerb);
  }

  /** Build the driveable graph from the same lines the roads were drawn on. */
  _graph(xs, zs) {
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < zs.length; j++) {
        const n = { id: this.nodes.length, x: xs[i], z: zs[j], gx: i, gz: j, links: [] };
        this.nodes.push(n);
        this.nodeAt.set(`${i},${j}`, n);
      }
    }
    const link = (a, b) => {
      if (!a || !b) return;
      a.links.push(b);
      b.links.push(a);
      this.edges.push([a, b]);
    };
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < zs.length; j++) {
        const n = this.nodeAt.get(`${i},${j}`);
        if (i + 1 < xs.length) link(n, this.nodeAt.get(`${i + 1},${j}`));
        if (j + 1 < zs.length) link(n, this.nodeAt.get(`${i},${j + 1}`));
      }
    }
  }

  // ------------------------------------------------------------- signals

  /**
   * Traffic lights. One controller per junction, alternating between the
   * north-south and east-west approaches with an amber in between.
   *
   * Junctions carry their own phase OFFSET rather than sharing a global clock.
   * Synchronised lights make a city feel like a machine — staggering them is
   * what produces the stop-start rhythm real streets have, and that rhythm is
   * what gives you a queue of stationary cars to go and steal.
   */
  _signals(xs, zs) {
    const w = this.world;
    this.signals = new Map();
    const housing = new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.8, metalness: 0.35 });
    // The lens carries its own colour as base colour too, not just emissive.
    // Emissive alone had to be cranked high to be seen, and ACES tone mapping
    // then clipped all three channels — a "red" light rendered as a white
    // dot. Colour in the albedo survives the tonemap, so the lamp stays red.
    const mk = (hex) => new THREE.MeshStandardMaterial({
      color: hex, emissive: hex, emissiveIntensity: 0.06,
      roughness: 0.35, metalness: 0
    });

    // Phases are QUANTISED into a few buckets, and every junction in a bucket
    // shares one set of lamp materials. Giving each junction its own offset
    // meant 840 unique materials — 840 draw calls the merge pass couldn't
    // collapse, against 15 for the whole rest of the city. Eight buckets is
    // still plenty of stagger, and costs 48 materials instead of 840.
    const BUCKETS = 8;
    this.sigBuckets = [];
    for (let b = 0; b < BUCKETS; b++) {
      this.sigBuckets.push({
        offset: (b / BUCKETS) * 26,
        ns: [mk(LAMP_ON[0]), mk(LAMP_ON[1]), mk(LAMP_ON[2])],
        ew: [mk(LAMP_ON[0]), mk(LAMP_ON[1]), mk(LAMP_ON[2])]
      });
    }

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 5.4, 6);
    const headGeo = new THREE.BoxGeometry(0.5, 1.05, 0.42);
    // Bigger than scale-accurate on purpose: a real lamp lens is ~20 cm, which
    // is a couple of pixels from a moving car. These have to be readable at
    // the distance you actually decide whether to stop.
    const bulbGeo = new THREE.SphereGeometry(0.16, 10, 8);

    // Only every third junction gets a signal, and each gets TWO heads rather
    // than four. Lighting every junction on the grid meant 525 controllers at
    // twenty meshes apiece — over ten thousand extra objects to draw, for
    // hardware that's already struggling. Signalling the arterial junctions
    // produces the same stop-start rhythm at a fraction of the cost.
    for (let i = 0; i < xs.length; i += 2) {
      for (let j = 0; j < zs.length; j += 2) {
        const n = this.nodeAt.get(`${i},${j}`);
        if (!n || n.links.length < 3) continue;   // only real junctions
        const bucket = this.sigBuckets[(this.rand() * this.sigBuckets.length) | 0];
        const sig = { node: n, bucket, offset: bucket.offset, lamps: { ns: [], ew: [] } };
        // One head per axis, on opposite corners.
        const corners = [[1, 1, 'ns'], [1, -1, 'ew']];
        for (const [sx, sz, axis] of corners) {
          const px = n.x + sx * (ROAD_W / 2 + 1.5);
          const pz = n.z + sz * (ROAD_W / 2 + 1.5);
          const pole = new THREE.Mesh(poleGeo, housing);
          pole.position.set(px, 2.7, pz);
          pole.castShadow = true;
          w.group.add(pole);
          const head = new THREE.Mesh(headGeo, housing);
          head.position.set(px, 5.3, pz);
          head.rotation.y = axis === 'ew' ? Math.PI / 2 : 0;
          w.group.add(head);

          // Bulbs on BOTH faces of the housing. One face meant the lamps were
          // invisible from the far approach — you'd be looking at the back of
          // a box and have no idea what the light was doing. Each colour
          // shares one material across its two bulbs so they light together.
          // Materials come from the shared bucket, not fresh per junction.
          const set = bucket[axis];
          const ns = axis === 'ns';
          for (let k = 0; k < 3; k++) {
            const mat = set[k];
            for (const face of [1, -1]) {
              // Stand the lens WELL clear of the housing. At 0.22 the sphere
              // sat almost entirely inside the 0.42-deep box — the lamp was
              // switching colour correctly and you simply couldn't see it.
              const b = new THREE.Mesh(bulbGeo, mat);
              b.position.set(
                px + (ns ? 0 : face * 0.36),
                5.62 - k * 0.30,
                pz + (ns ? face * 0.36 : 0)
              );
              w.group.add(b);
            }
          }
          sig.lamps[axis].push(set);
        }
        this.signals.set(n, sig);
      }
    }
    this.signalCount = this.signals.size;
  }

  /**
   * Light state for a node, for traffic travelling along `axis` ('ns'|'ew').
   * Returns 'green' | 'amber' | 'red'.
   */
  lightAt(node, axis) {
    const sig = this.signals && this.signals.get(node);
    if (!sig) return 'green';                    // uncontrolled junction
    return this._stateFor(sig.offset, axis);
  }

  /** Advance the signal clock and repaint the bulbs. */
  updateSignals(dt) {
    if (!this.signals) return;
    this._sigTime = (this._sigTime || 0) + dt;
    // Repaint per BUCKET, not per junction. Every junction in a bucket shares
    // the same materials and the same phase, so walking all 140 of them would
    // write the same 48 materials over and over.
    for (const bucket of this.sigBuckets) {
      for (const axis of ['ns', 'ew']) {
        const state = this._stateFor(bucket.offset, axis);
        const lit = state === 'red' ? 0 : (state === 'amber' ? 1 : 2);
        const set = bucket[axis];
        // Lit lamps glow but stay under the tonemap's clipping point, so they
        // read as red/amber/green rather than as white. Unlit lenses go nearly
        // black, which is what makes the lit one unmistakable.
        for (let k = 0; k < 3; k++) {
          const on = k === lit;
          set[k].emissiveIntensity = on ? 1.6 : 0.02;
          set[k].color.setHex(on ? LAMP_ON[k] : LAMP_OFF[k]);
        }
      }
    }
  }

  /** Light state for a given phase offset. Shared by lightAt and the repaint. */
  _stateFor(offset, axis) {
    const CYCLE = 26;
    const t = ((this._sigTime || 0) + offset) % CYCLE;
    if (axis === 'ns') return t < 11 ? 'green' : (t < 13 ? 'amber' : 'red');
    return (t >= 13 && t < 24) ? 'green' : (t >= 24 ? 'amber' : 'red');
  }

  /** Which signal axis an edge runs along. */
  axisOf(a, b) {
    return Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? 'ew' : 'ns';
  }

  /** Nearest graph node to a world position. */
  nearestNode(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Lane centre offset for driving on the right. */
  laneOffset() { return LANE; }

  // ---------------------------------------------------------------- buildings

  _blocks(xs, zs) {
    const w = this.world;
    const rand = this.rand;

    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        const x0 = xs[i] + ROAD_W / 2 + KERB_W;
        const x1 = xs[i + 1] - ROAD_W / 2 - KERB_W;
        const z0 = zs[j] + ROAD_W / 2 + KERB_W;
        const z1 = zs[j + 1] - ROAD_W / 2 - KERB_W;
        const bw = x1 - x0;
        const bd = z1 - z0;
        if (bw < 12 || bd < 12) continue;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;

        // Nothing is built on the airfield. The apron and runway are laid over
        // this ground later, and the block generator was putting hangars and
        // pavements straight across them — which is why aircraft ended up
        // parked on somebody's lawn.
        const af = DISTRICTS.find((x) => x.id === 'airfield');
        if (af && Math.abs(cx - af.x) < 185 && Math.abs(cz - af.z) < 155) continue;

        // Pavement slab covering the whole block footprint plus the kerb.
        this._pavement(cx, cz, bw + KERB_W * 2, bd + KERB_W * 2);

        const prof = this._blockProfile(cx, cz);
        // A fraction of blocks stay open: parks, lots, plazas. Cities have gaps.
        const roll = rand();
        if (roll < 0.10) { this._park(cx, cz, bw, bd); continue; }
        if (roll < 0.17) { this._lot(cx, cz, bw, bd); continue; }

        // A row of small shopfronts along the street edge, with the block's
        // bulk set back behind them. This is what makes a street read as a
        // street: doors, awnings and signs at eye level. One big extruded mass
        // per block gives you a business park, not a city.
        let setback = 0;
        if (prof.kind !== 'house' && bd > 34 && rand() < 0.72) {
          setback = this._shopRow(x0, z0 + bd - 14, x1, z0 + bd, prof);
        }
        if (prof.kind === 'house') this._houses(x0, z0, x1, z1);
        else this._towerBlock(cx, cz - setback / 2, bw, bd - setback, prof);
      }
    }
  }

  /**
   * A parade of small shops along a street edge. Returns the depth consumed.
   *
   * Each unit is its own little building — its own width, height, paint,
   * awning and sign — because a high street is a row of DIFFERENT small
   * things, and that variation at eye level does more for how a city looks
   * than anything happening forty storeys up.
   */
  _shopRow(x0, z0, x1, z1) {
    const w = this.world;
    const rand = this.rand;
    const depth = z1 - z0;
    const kinds = [
      { id: 'cafe',   name: 'CAFE',     sign: 0xffb347, food: true },
      { id: 'diner',  name: 'DINER',    sign: 0xff5a5a, food: true },
      { id: 'noodle', name: 'NOODLES',  sign: 0xff8c2b, food: true },
      { id: 'bakery', name: 'BAKERY',   sign: 0xffd98a, food: true },
      { id: 'store',  name: 'GROCER',   sign: 0x6fd98a, food: false },
      { id: 'laundry',name: 'LAUNDRY',  sign: 0x7ab8ff, food: false },
      { id: 'barber', name: 'BARBER',   sign: 0xff7ad4, food: false },
      { id: 'phone',  name: 'REPAIRS',  sign: 0x9f8cff, food: false }
    ];
    // Built once and shared. A fresh material per shop meant 394 materials
    // that the merge pass could never batch together — draw calls went from
    // 64 to 458 for six actual colours.
    if (!this._shopPaints) {
      this._shopPaints = [0xb8b0a4, 0x8f9b8a, 0xa8907e, 0x7f8794, 0xb09a8a, 0x93a3a8]
        .map((col) => new THREE.MeshStandardMaterial({
          color: col, roughness: 0.85, metalness: 0.04
        }));
      this._awnMats = new Map();
      this._signMats = new Map();
    }
    const paints = this._shopPaints;

    let x = x0 + 1;
    while (x < x1 - 9) {
      const unitW = 9 + rand() * 7;
      if (x + unitW > x1 - 1) break;
      const cx = x + unitW / 2;
      const cz = (z0 + z1) / 2;
      const h = 4.6 + rand() * 3.2;
      const kind = kinds[(rand() * kinds.length) | 0];
      const wallMat = paints[(rand() * paints.length) | 0];

      // Hollow ground floor you can walk into.
      this._interior(cx, cz, unitW - 0.6, depth - 1.2, Math.min(h, 4.2), wallMat, kind);

      // Parapet and a cornice band, so the roofline isn't a bare cut.
      w._block(unitW - 0.2, 0.55, depth - 0.9, cx, h + 0.3, cz, wallMat, { collide: false });
      w._block(unitW, 0.28, depth - 0.6, cx, h + 0.85, cz, w.mats.structureDark, { collide: false });

      // Awning over the pavement, striped by tilting two slabs together.
      // One awning material per shop TYPE, not per shop.
      let awn = this._awnMats.get(kind.id);
      if (!awn) {
        awn = new THREE.MeshStandardMaterial({ color: kind.sign, roughness: 0.8 });
        this._awnMats.set(kind.id, awn);
      }
      const aw = w._block(unitW - 1.4, 0.12, 2.0, cx, 3.05, cz + depth / 2 + 0.5, awn,
        { collide: false });
      aw.rotation.x = -0.28;
      // Support poles.
      for (const s of [-1, 1]) {
        w._block(0.09, 3.0, 0.09, cx + s * (unitW / 2 - 0.9), 0, cz + depth / 2 + 1.3,
          w.mats.structureDark, { collide: false });
      }

      // Illuminated fascia sign above the awning.
      let signMat = this._signMats.get(kind.id);
      if (!signMat) {
        signMat = new THREE.MeshStandardMaterial({
          color: 0x14161a, emissive: kind.sign, emissiveIntensity: 1.15, roughness: 0.5
        });
        this._signMats.set(kind.id, signMat);
      }
      w._block(unitW - 2.2, 0.62, 0.18, cx, 3.5, cz + depth / 2 - 0.15, signMat,
        { collide: false });

      this.buildings.push({ x: cx, z: cz, w: unitW, d: depth, h, kind: 'shop' });
      x += unitW + 0.5 + rand() * 1.2;
    }
    return depth;
  }

  _pavement(cx, cz, sx, sz) {
    const w = this.world;
    const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
    // The canvas draws an 8x8 slab grid, so 5 m a tile gives 0.6 m paving
    // stones — the size they actually are, which is what lets the pavement
    // give the street a sense of scale instead of being a beige sheet.
    this._uvWorld(g, sx, sz, 5, 3);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.mats.kerb);
    m.position.set(cx, 0.14, cz);
    m.receiveShadow = true;
    w.group.add(m);
    // The kerb face is a low collider so cars bump up rather than through.
    w.physics.addBox(
      new THREE.Vector3(cx, 0.07, cz),
      new THREE.Vector3(sx, 0.14, sz),
      null, { surface: 'stone' }
    );
  }

  /** Downtown / midtown: one to four masses per block with setbacks. */
  _towerBlock(cx, cz, bw, bd, prof) {
    const rand = this.rand;
    const count = prof.kind === 'tower' ? 1 + ((rand() * 2) | 0) : 1 + ((rand() * 3) | 0);
    const cells = this._split(cx, cz, bw * prof.w, bd * prof.w, count);
    for (const c of cells) {
      const h = prof.h * (0.7 + rand() * 0.6);
      this._building(c.x, c.z, c.w, c.d, h, prof.kind);
    }
  }

  /** Split a block footprint into `n` non-overlapping cells. */
  _split(cx, cz, bw, bd, n) {
    let cells = [{ x: cx, z: cz, w: bw, d: bd }];
    for (let i = 1; i < n; i++) {
      // Always split the largest cell, so pieces stay reasonably sized.
      cells.sort((a, b) => b.w * b.d - a.w * a.d);
      const c = cells.shift();
      const along = c.w > c.d;
      const f = 0.38 + this.rand() * 0.24;
      if (along) {
        const w1 = c.w * f, w2 = c.w * (1 - f);
        cells.push({ x: c.x - c.w / 2 + w1 / 2, z: c.z, w: w1 * 0.94, d: c.d });
        cells.push({ x: c.x + c.w / 2 - w2 / 2, z: c.z, w: w2 * 0.94, d: c.d });
      } else {
        const d1 = c.d * f, d2 = c.d * (1 - f);
        cells.push({ x: c.x, z: c.z - c.d / 2 + d1 / 2, w: c.w, d: d1 * 0.94 });
        cells.push({ x: c.x, z: c.z + c.d / 2 - d2 / 2, w: c.w, d: d2 * 0.94 });
      }
    }
    return cells;
  }

  /**
   * One building. Tall ones get stepped setbacks and a roof cap, which is what
   * stops a skyline of extruded rectangles from reading as a bar chart.
   */
  /**
   * A ground floor you can walk into.
   *
   * The trick is what NOT to collide. A normal building is one solid box, so
   * the only way in is to stop making the ground floor solid at all: the
   * storey becomes four walls, a slab and a ceiling, with the street-facing
   * wall split either side of a door gap. Everything above it stacks on top
   * as usual and never knows the difference.
   */
  _interior(x, z, bw, bd, floorH, mat, kind = null) {
    const w = this.world;
    const rand = this.rand;
    const T = 0.45;                       // wall thickness
    const DOOR = 3.0;                     // doorway width
    const hw = bw / 2, hd = bd / 2;

    const inner = w.mats.structure;
    const floorMat = w.mats.structureDark;

    // Slab and ceiling.
    w._block(bw, 0.2, bd, x, 0, z, floorMat, { surface: 'stone' });
    w._block(bw, 0.3, bd, x, floorH, z, floorMat, { surface: 'stone' });

    // Back and side walls.
    w._block(bw, floorH, T, x, 0.2, z - hd + T / 2, mat, { surface: 'stone' });
    w._block(T, floorH, bd, x - hw + T / 2, 0.2, z, mat, { surface: 'stone' });
    w._block(T, floorH, bd, x + hw - T / 2, 0.2, z, mat, { surface: 'stone' });

    // Street-facing wall, split around the doorway, with a lintel over it.
    const side = (bw - DOOR) / 2;
    if (side > 0.4) {
      w._block(side, floorH, T, x - (DOOR / 2 + side / 2), 0.2, z + hd - T / 2, mat, { surface: 'stone' });
      w._block(side, floorH, T, x + (DOOR / 2 + side / 2), 0.2, z + hd - T / 2, mat, { surface: 'stone' });
    }
    const doorTop = 2.6;
    w._block(DOOR, floorH - doorTop, T, x, doorTop + 0.2, z + hd - T / 2, mat, { surface: 'stone' });

    // Shopfront glazing either side of the door, so it reads as a shop.
    // Shared by every shop: one material per shop was hundreds of draw calls.
    const glassMat = this._shopGlass || (this._shopGlass = new THREE.MeshPhysicalMaterial({
      color: 0x9fc4d8, roughness: 0.05, metalness: 0.1,
      transparent: true, opacity: 0.22, clearcoat: 1
    }));
    if (side > 1.2) {
      for (const s of [-1, 1]) {
        w._block(side * 0.8, 1.9, 0.08, x + s * (DOOR / 2 + side / 2), 0.9,
          z + hd - T - 0.05, glassMat, { collide: false });
      }
    }

    // --- Contents ---------------------------------------------------------
    // A counter, shelving down one wall, and a light so the inside isn't a
    // black hole from the street.
    w._block(bw * 0.42, 1.05, 0.7, x - bw * 0.16, 0.2, z - hd * 0.35, inner, { surface: 'wood' });
    for (let i = 0; i < 3; i++) {
      w._block(0.6, 0.12, bd * 0.5, x + hw - 0.9, 0.9 + i * 0.85, z - bd * 0.1, inner,
        { surface: 'wood', collide: false });
    }
    const lamp = this._shopLamp || (this._shopLamp = new THREE.MeshStandardMaterial({
      color: 0x14171c, emissive: 0xffe6b8, emissiveIntensity: 2.2, roughness: 0.4
    }));
    w._block(bw * 0.5, 0.12, 0.4, x, floorH - 0.35, z, lamp, { collide: false });

    const venue = {
      x, z, w: bw, d: bd, kind: kind ? kind.id : 'shop',
      name: kind ? kind.name : 'SHOP',
      door: { x, z: z + hd },
      // Where you stand to be served, and where you sit to eat.
      counter: { x: x - bw * 0.16, z: z - bd * 0.35 }
    };
    this.enterable.push(venue);
    if (kind && kind.food) this.venues.push(venue);
  }

  _building(x, z, bw, bd, h, kind, enterable = false) {
    const w = this.world;
    const rand = this.rand;
    const A = this.archMats;
    const pool = STYLE_FOR[kind] || STYLE_FOR.block;
    // Tall blocks in midtown lean toward concrete and office; walk-up height
    // is where brick lives.
    let styleId = pool[(rand() * pool.length) | 0];
    if (kind === 'block' && h > 46 && styleId.startsWith('brick')) styleId = rand() < 0.5 ? 'office' : 'concrete';
    const st = STYLES[styleId];
    const mat = facadeMaterial(styleId);
    const floorScale = 0.94 + rand() * 0.14;
    const bayScale = 0.86 + rand() * 0.3;
    const floorH = st.floor * floorScale;
    const bayW = st.bay * bayScale;
    const big = (kind === 'tower' || kind === 'block' || kind === 'shore') && h > 10;
    const groundH = big ? 4.6 + rand() * 0.8 : ((kind === 'warehouse' || kind === 'hangar') ? 4.5 : 0);
    const bld = [rand(), floorScale, bayScale, groundH];
    const tag = (m) => { tagFacade(m, bld); return m; };
    const face = (m) => tag(m);

    let y = 0;
    let cw = bw, cd = bd;

    // --- BASE ---------------------------------------------------------------
    // Towers and big blocks stand on a glazed lobby set back under the floors
    // above, carried on a colonnade. That recess — a dark band of shadow at
    // street level with columns in front of it — is the single strongest cue
    // that separates a building from a box sitting on the pavement.
    const lobby = (kind === 'tower' || (kind === 'block' && h > 30)) && bw > 16 && bd > 16;
    if (lobby) {
      const inset = 1.6;
      face(w._block(bw - inset * 2, groundH, bd - inset * 2, x, 0, z, mat, { surface: 'stone', tile: FACADE_TILE }));
      const col = (cx2, cz2) => w._block(0.7, groundH, 0.7, cx2, 0, cz2, A.concrete, { surface: 'stone' });
      const nx = Math.max(2, Math.round(bw / 7.5)), nz = Math.max(2, Math.round(bd / 7.5));
      for (let i = 0; i < nx; i++) {
        const px = x - bw / 2 + 0.6 + (i / (nx - 1)) * (bw - 1.2);
        col(px, z - bd / 2 + 0.6); col(px, z + bd / 2 - 0.6);
      }
      for (let i = 1; i < nz - 1; i++) {
        const pz = z - bd / 2 + 0.6 + (i / (nz - 1)) * (bd - 1.2);
        col(x - bw / 2 + 0.6, pz); col(x + bw / 2 - 0.6, pz);
      }
      // Entrance canopy on the street face.
      w._block(Math.min(9, bw * 0.4), 0.22, 2.6, x, groundH - 0.9, z + bd / 2 + 0.6, A.fin, { collide: false });
      y = groundH;
    } else if (big) {
      // A door and a canopy over it; the shader glazes the rest of the floor.
      w._block(2.2, 0.18, 1.3, x, groundH - 0.5, z + bd / 2 + 0.65, A.iron, { collide: false });
    }

    // --- MIDDLE: the tiers ----------------------------------------------------
    let rem = h - y;
    const steps = kind === 'tower' ? 1 + ((rand() * 3) | 0) : 1;
    const tiers = [];
    for (let sI = 0; sI < steps; sI++) {
      // Tier heights snap to whole storeys, so a setback lands on a floor line.
      let sh = sI === steps - 1 ? rem : rem * (0.4 + rand() * 0.28);
      sh = Math.max(floorH, Math.round(sh / floorH) * floorH);
      if (sI === steps - 1) sh = rem;
      face(w._block(cw, sh, cd, x, y, z, mat, { surface: 'stone', tile: FACADE_TILE }));
      tiers.push({ y, h: sh, w: cw, d: cd });
      y += sh;
      rem -= sh;
      if (rem < 6) break;
      // Setback terrace: a parapet round the ledge the next tier leaves.
      const nw = cw * (0.74 + rand() * 0.14), nd = cd * (0.74 + rand() * 0.14);
      this._parapet(x, y, z, cw, cd, st.pattern >= 2 ? A.stone : A.metal, 1.05);
      cw = nw; cd = nd;
    }
    const topY = y;

    // --- Facade elements, lined up with the shader's window grid -------------
    const main = tiers[0];
    // Vertical fins on half the curtain-wall towers: shadow lines that run the
    // full height and make the tower read as engineered, not wallpapered.
    if (st.pattern === 0 && rand() < 0.55) {
      for (const t of tiers) this._fins(x, z, t, bayW * 3, A.fin);
    }
    // Balconies on the residential slabs: under real windows, every storey.
    if (styleId === 'concrete' || (styleId === 'stucco' && h > 9)) {
      this._balconies(x, z, main, groundH, floorH, bayW, st, A);
    }
    // Fire escapes down the side of the masonry walk-ups.
    if (st.pattern === 2 && h < 44 && h > 10) {
      this._fireEscape(x, z, main, groundH, floorH, bayW, st, A);
    }
    // Slab edges on the office slabs, catching the light at every floor.
    if (styleId === 'office') {
      for (let fy = groundH + floorH; fy < topY - 0.5; fy += floorH) {
        const t = tiers.find((tt) => fy >= tt.y && fy < tt.y + tt.h) || main;
        w._block(t.w + 0.3, 0.28, t.d + 0.3, x, fy - 0.14, z, A.concrete, { collide: false, shadow: false });
      }
    }

    // --- TOP ------------------------------------------------------------------
    const cap = st.pattern >= 2 && st.pattern <= 4 ? A.stone : A.metal;
    if (h > 8) {
      // Cornice or coping, then a parapet.
      w._block(cw + (st.pattern >= 2 ? 0.7 : 0.25), st.pattern >= 2 ? 0.55 : 0.3, cd + (st.pattern >= 2 ? 0.7 : 0.25),
        x, topY - (st.pattern >= 2 ? 0.55 : 0.3), z, cap, { collide: false });
      this._parapet(x, topY, z, cw, cd, cap, st.pattern >= 2 ? 0.9 : 1.1);
      this._roofPlant(x, topY, z, cw, cd, kind, styleId, A);
    }
    if (kind === 'tower') {
      // A lit crown band and, on the tallest, a spire with a warning light.
      if (rand() < 0.5) w._block(cw + 0.1, 0.5, cd + 0.1, x, topY - 2.2, z, A.crown, { collide: false, shadow: false });
      if (h > 130 && rand() < 0.7) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.1, 18 + rand() * 20, 10), A.metal);
        sp.position.set(x, topY + 1.2 + sp.geometry.parameters.height / 2, z);
        sp.castShadow = true;
        w.group.add(sp);
        w._block(0.7, 0.7, 0.7, x, topY + 1.2 + sp.geometry.parameters.height, z, A.warn, { collide: false, shadow: false });
      }
    }
    this.buildings.push({ x, z, w: bw, d: bd, h, kind, style: styleId });
  }

  /** A parapet wall round a roof or terrace edge. */
  _parapet(x, y, z, cw, cd, mat, ht = 1.0) {
    const w = this.world;
    for (const [ox, oz, sw, sd] of [
      [0, cd * 0.5 - 0.12, cw, 0.25], [0, -cd * 0.5 + 0.12, cw, 0.25],
      [cw * 0.5 - 0.12, 0, 0.25, cd], [-cw * 0.5 + 0.12, 0, 0.25, cd]
    ]) {
      w._block(sw, ht, sd, x + ox, y, z + oz, mat, { collide: false });
    }
  }

  /** Full-height fins at a fixed pitch round a tier. */
  _fins(x, z, t, pitch, mat) {
    const w = this.world;
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const len = nx ? t.d : t.w;
      const n = Math.floor(len / pitch);
      for (let i = 1; i < n; i++) {
        const a = -len / 2 + i * (len / n);
        const fx = nx ? x + nx * (t.w / 2 + 0.22) : x + a;
        const fz = nz ? z + nz * (t.d / 2 + 0.22) : z + a;
        w._block(nx ? 0.45 : 0.28, t.h, nz ? 0.45 : 0.28, fx, t.y, fz, mat, { collide: false });
      }
    }
  }

  /**
   * Balconies on the two long faces, placed on the same bay grid the shader
   * draws windows on — so every balcony sits under a real window.
   */
  _balconies(x, z, t, groundH, floorH, bayW, st, A) {
    const w = this.world;
    const rand = this.rand;
    const alongX = t.w >= t.d;
    const faces = alongX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const winC = (st.win[0] + st.win[1]) / 2;
    const floors = Math.min(16, Math.floor((t.y + t.h - groundH) / floorH));
    const glass = rand() < 0.5;
    for (const [nx, nz] of faces) {
      // The shader's horizontal coordinate on this face (see Facade.js).
      const sgn = nz ? Math.sign(nz) : -Math.sign(nx);
      const lo = nz ? x - t.w / 2 : z - t.d / 2, hi = nz ? x + t.w / 2 : z + t.d / 2;
      const k0 = Math.ceil((sgn > 0 ? lo : -hi) / bayW), k1 = Math.floor((sgn > 0 ? hi : -lo) / bayW) - 1;
      for (let k = k0; k <= k1; k++) {
        if (((k % 2) + 2) % 2 === 0) continue;
        const along = sgn * (k + winC) * bayW;
        if (along < lo + 1.4 || along > hi - 1.4) continue;
        for (let f = 1; f < floors; f++) {
          const fy = groundH + f * floorH;
          if (fy < t.y || fy > t.y + t.h - 1) continue;
          const bwid = bayW * 0.9;
          const out = 0.62;
          const px = nz ? along : x + nx * (t.w / 2 + out);
          const pz = nz ? z + nz * (t.d / 2 + out) : along;
          w._block(nz ? bwid : 1.24, 0.16, nz ? 1.24 : bwid, px, fy - 0.16, pz, A.concrete, { collide: false });
          const rx = nz ? along : x + nx * (t.w / 2 + 1.2);
          const rz = nz ? z + nz * (t.d / 2 + 1.2) : along;
          w._block(nz ? bwid : 0.05, 1.0, nz ? 0.05 : bwid, rx, fy, rz, glass ? A.glassRail : A.iron, { collide: false, shadow: !glass });
          w._block(nz ? bwid : 0.07, 0.06, nz ? 0.07 : bwid, rx, fy + 1.0, rz, A.iron, { collide: false });
        }
      }
    }
  }

  /** A zig-zag iron fire escape on one short face, floor by floor. */
  _fireEscape(x, z, t, groundH, floorH, bayW, st, A) {
    const w = this.world;
    const alongX = t.w >= t.d;
    // On a short face.
    const nx = alongX ? 1 : 0, nz = alongX ? 0 : 1;
    const len = nx ? t.d : t.w;
    if (len < 8) return;
    const pw = Math.min(bayW * 2.2, len * 0.6);
    const floors = Math.floor((t.y + t.h - groundH) / floorH);
    for (let f = 1; f < floors; f++) {
      const fy = groundH + f * floorH + floorH * st.win[2] - 0.12;
      if (fy > t.y + t.h - 1.2) break;
      const cx = nx ? x + t.w / 2 + 0.6 : x;
      const cz = nx ? z : z + t.d / 2 + 0.6;
      w._block(nx ? 1.1 : pw, 0.07, nx ? pw : 1.1, cx, fy, cz, A.iron, { collide: false });
      const rx = nx ? x + t.w / 2 + 1.12 : x, rz = nx ? z : z + t.d / 2 + 1.12;
      w._block(nx ? 0.04 : pw, 0.95, nx ? pw : 0.04, rx, fy, rz, A.iron, { collide: false, shadow: false });
      for (const s2 of [-1, 1]) {
        const ex = nx ? cx : cx + s2 * pw / 2, ez = nx ? cz + s2 * pw / 2 : cz;
        w._block(nx ? 1.1 : 0.04, 0.95, nx ? 0.04 : 1.1, ex, fy, ez, A.iron, { collide: false, shadow: false });
      }
      // The stair down to the platform below, alternating direction.
      if (f > 1) {
        const dir = f % 2 ? 1 : -1;
        const run = pw * 0.8;
        const ang = Math.atan2(floorH, run);
        const sx = nx ? cx : cx + dir * 0.0, sz = nx ? cz : cz;
        const stair = w._block(nx ? 0.7 : Math.hypot(run, floorH), 0.06, nx ? Math.hypot(run, floorH) : 0.7,
          sx, fy - floorH / 2, sz, A.iron, { collide: false, rotY: nx ? 0 : 0, tiltX: nx ? dir * ang : 0 });
        if (!nx) stair.rotation.z = dir * ang;
      }
    }
  }

  /**
   * What sits on a flat roof: a stair and lift overrun, air handlers with fan
   * grilles, ducts, and — on the masonry walk-ups — the timber water tank on
   * steel legs that says "city" from a mile off. Towers get a gantry and masts.
   */
  _roofPlant(x, y, z, cw, cd, kind, styleId, A) {
    const w = this.world;
    const rand = this.rand;
    const ox = (f) => x + (rand() - 0.5) * cw * f;
    const oz = (f) => z + (rand() - 0.5) * cd * f;
    // Overrun.
    if (cw > 8 && cd > 8) {
      const rw = Math.min(6, cw * 0.28), rd = Math.min(7, cd * 0.3);
      const rx = ox(0.4), rz = oz(0.4);
      w._block(rw, 3.2, rd, rx, y, rz, A.concrete, { collide: false });
      w._block(rw + 0.3, 0.2, rd + 0.3, rx, y + 3.2, rz, A.metal, { collide: false });
    }
    // Air handlers.
    const units = kind === 'tower' ? 3 + ((rand() * 4) | 0) : 1 + ((rand() * 4) | 0);
    for (let i = 0; i < units; i++) {
      const ux = ox(0.7), uz = oz(0.7);
      const uw = 1.6 + rand() * 1.6, ud = 1.2 + rand() * 1.2, uh = 1.1 + rand() * 0.8;
      w._block(uw, uh, ud, ux, y, uz, A.plant, { collide: false });
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(uw, ud) * 0.32, Math.min(uw, ud) * 0.32, 0.12, 14), A.grille);
      fan.position.set(ux, y + uh + 0.06, uz);
      w.group.add(fan);
      w._block(uw * 0.96, 0.05, 0.06, ux, y + uh * 0.5, uz + ud / 2 + 0.02, A.grille, { collide: false, shadow: false });
      // A duct run across the roof to the overrun.
      if (rand() < 0.5) w._block(0.45, 0.45, cd * 0.3, ux, y + 0.2, uz - cd * 0.15, A.plant, { collide: false });
    }
    // Water tank on the walk-ups.
    if (styleId.startsWith('brick') && rand() < 0.75) {
      const tx = ox(0.5), tz = oz(0.5), r = 1.3 + rand() * 0.6, th = 2.6 + rand() * 0.8;
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        w._block(0.14, 2.2, 0.14, tx + lx * r * 0.6, y, tz + lz * r * 0.6, A.iron, { collide: false });
      }
      w._block(r * 1.8, 0.12, r * 1.8, tx, y + 2.2, tz, A.iron, { collide: false });
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, th, 18), A.tank);
      tank.position.set(tx, y + 2.3 + th / 2, tz);
      tank.castShadow = true;
      w.group.add(tank);
      const lid = new THREE.Mesh(new THREE.ConeGeometry(r * 1.06, 0.9, 18), A.iron);
      lid.position.set(tx, y + 2.3 + th + 0.45, tz);
      w.group.add(lid);
      for (let b = 0; b < 3; b++) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, 0.035, 4, 24), A.iron);
        hoop.rotation.x = Math.PI / 2;
        hoop.position.set(tx, y + 2.3 + th * (0.2 + b * 0.3), tz);
        w.group.add(hoop);
      }
    }
    // Masts, dishes and a window-cleaning gantry on the towers.
    if (kind === 'tower' || rand() < 0.3) {
      for (let i = 0; i < 1 + ((rand() * 3) | 0); i++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 4 + rand() * 10, 6), A.metal);
        m.position.set(ox(0.8), y + m.geometry.parameters.height / 2, oz(0.8));
        w.group.add(m);
      }
      if (rand() < 0.5) {
        const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.3), A.plant);
        dish.position.set(ox(0.6), y + 1.4, oz(0.6));
        dish.rotation.x = -1.1;
        w.group.add(dish);
      }
    }
    if (kind === 'tower' && cw > 16) {
      w._block(cw * 0.8, 0.35, 0.5, x, y + 2.2, z + cd * 0.35, A.metal, { collide: false });
      w._block(0.5, 2.2, 0.5, x - cw * 0.38, y, z + cd * 0.35, A.metal, { collide: false });
      w._block(0.5, 2.2, 0.5, x + cw * 0.38, y, z + cd * 0.35, A.metal, { collide: false });
    }
  }

  /**
   * Suburbs: houses, not boxes. Two storeys whose windows line up with their
   * floors, a real pitched roof in tile or slate with eaves overhanging the
   * walls, a chimney, a porch over a front door, and a hedge round the plot.
   */
  _houses(x0, z0, x1, z1) {
    const w = this.world;
    const rand = this.rand;
    const A = this.archMats;
    const step = 26;
    for (let x = x0 + 13; x < x1 - 6; x += step) {
      for (let z = z0 + 13; z < z1 - 6; z += step) {
        if (rand() < 0.18) continue;                    // gaps: gardens, drives
        const hw = 9 + rand() * 4;
        const hd = 8 + rand() * 4;
        const storeys = rand() < 0.7 ? 2 : 1;
        const hh = storeys * (2.9 + rand() * 0.3) + 0.3;
        const pool = STYLE_FOR.house;
        const styleId = pool[(rand() * pool.length) | 0];
        const st = STYLES[styleId];
        const mat = facadeMaterial(styleId);
        // Scale the style's storey so the windows sit one row per floor.
        const bld = [rand(), (hh / storeys) / st.floor, 0.95 + rand() * 0.2, 0];
        tagFacade(w._block(hw, hh, hd, x, 0, z, mat, { surface: 'stone' }), bld);
        // Roof: ridge along the longer side, eaves 0.45 m past the walls.
        const ridgeX = hw >= hd;
        const span = (ridgeX ? hd : hw) + 0.9;
        const run = (ridgeX ? hw : hd) + 0.9;
        const pitch = 0.55 + rand() * 0.2;
        const rise = (span / 2) * Math.tan(pitch);
        const roofMat = rand() < 0.6 ? A.roofTerracotta : A.roofSlate;
        this._gableRoof(x, hh, z, span, run, rise, ridgeX, roofMat, mat, bld);
        // Chimney through one slope.
        const cxo = ridgeX ? (rand() - 0.5) * run * 0.6 : span * 0.22;
        const czo = ridgeX ? span * 0.22 : (rand() - 0.5) * run * 0.6;
        w._block(0.9, rise + 1.2, 0.9, x + cxo, hh - 0.2, z + czo, facadeMaterial('brickBrown'), { collide: false });
        w._block(1.05, 0.15, 1.05, x + cxo, hh + rise + 1.0, z + czo, A.stone, { collide: false });
        // Front door, porch roof on two posts, and a step.
        const fz = z + hd / 2;
        w._block(1.1, 2.15, 0.12, x, 0, fz + 0.03, A.door, { collide: false });
        w._block(1.4, 0.12, 0.16, x, 2.15, fz + 0.05, A.stone, { collide: false });
        w._block(2.8, 0.14, 1.6, x, 2.7, fz + 0.8, roofMat === A.roofSlate ? A.iron : A.stone, { collide: false });
        for (const sx of [-1, 1]) w._block(0.14, 2.7, 0.14, x + sx * 1.25, 0, fz + 1.5, A.stone, { collide: false });
        w._block(2.0, 0.18, 0.9, x, 0, fz + 0.5, A.concrete, { collide: false });
        // Hedge round the plot, with a gap for the path.
        const pw = step - 1.5;
        for (const [hx, hz, sx, sz] of [
          [x, z - pw / 2, pw, 0.8], [x - pw / 2, z, 0.8, pw], [x + pw / 2, z, 0.8, pw],
          [x - pw * 0.3, z + pw / 2, pw * 0.4, 0.8], [x + pw * 0.3, z + pw / 2, pw * 0.4, 0.8]
        ]) {
          w._block(sx, 0.9 + rand() * 0.3, sz, hx, 0.14, hz, A.hedge, { collide: false });
        }
        this.buildings.push({ x, z, w: hw, d: hd, h: hh + rise, kind: 'house', style: styleId });
      }
    }
  }

  /**
   * A gable roof: two tiled slopes meeting at a ridge, and the triangular
   * gable ends in the wall's own facade material so they read as wall.
   */
  _gableRoof(x, y, z, span, run, rise, ridgeX, roofMat, wallMat, bld) {
    const w = this.world;
    const h = span / 2, r = run / 2;
    // Local frame: ridge along +X of the local roof, span along Z.
    const P = (lx, ly, lz) => ridgeX ? [x + lx, y + ly, z + lz] : [x + lz, y + ly, z + lx];
    const slopes = [];
    const t = 0.14;                                    // tile thickness
    for (const s2 of [-1, 1]) {
      const a = P(-r, 0, s2 * h), b = P(r, 0, s2 * h), c = P(r, rise, 0), d = P(-r, rise, 0);
      const a2 = P(-r, -t, s2 * h), b2 = P(r, -t, s2 * h), c2 = P(r, rise - t, 0), d2 = P(-r, rise - t, 0);
      slopes.push(a, b, c, a, c, d, a2, c2, b2, a2, d2, c2, a, a2, b2, a, b2, b);
    }
    const flat = [];
    for (const p of slopes) flat.push(...p);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((flat.length / 3) * 2), 2));
    const roof = new THREE.Mesh(g, roofMat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    w.group.add(roof);
    // Gable ends.
    const ends = [];
    for (const s3 of [-1, 1]) {
      const ex = s3 * (r - 0.45);
      const p0 = P(ex, 0, -h + 0.45), p1 = P(ex, 0, h - 0.45), p2 = P(ex, rise - 0.3, 0);
      if (s3 > 0) ends.push(...p0, ...p1, ...p2); else ends.push(...p0, ...p2, ...p1);
    }
    const ge = new THREE.BufferGeometry();
    ge.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
    ge.computeVertexNormals();
    ge.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((ends.length / 3) * 2), 2));
    const gm = new THREE.Mesh(ge, wallMat);
    gm.castShadow = true;
    w.group.add(gm);
    tagFacade(gm, bld);
    // Ridge capping.
    const rc = P(0, rise + 0.02, 0);
    w._block(ridgeX ? run : 0.3, 0.14, ridgeX ? 0.3 : run, rc[0], rc[1], rc[2], roofMat === this.archMats.roofSlate ? this.archMats.iron : this.archMats.tank, { collide: false });
  }

  _park(cx, cz, bw, bd) {
    const w = this.world;
    const rand = this.rand;
    const g = new THREE.PlaneGeometry(bw, bd, 1, 1);
    g.rotateX(-Math.PI / 2);
    // Built in world position, not moved there, so the lawn shader's world
    // coordinates and the static merge agree about where it is.
    g.translate(cx, 0.16, cz);
    const m = new THREE.Mesh(g, this.mats.grass);
    m.receiveShadow = true;
    w.group.add(m);
    // Trees, using the world's existing tree builder so parks match the rest
    // of the game's foliage rather than inventing a second kind of tree.
    const n = 3 + ((rand() * 5) | 0);
    const trees = [];
    for (let i = 0; i < n; i++) {
      const tx = cx + (rand() - 0.5) * bw * 0.8;
      const tz = cz + (rand() - 0.5) * bd * 0.8;
      w._treeAt(tx, 0.16, tz, 0.8 + rand() * 0.5, (tx + tz) | 0, rand() > 0.5 ? 'oak' : 'birch');
      trees.push({ x: tx, z: tz });
    }
    // Remembered, so the ground pass can dress the park once it is laid out.
    (this.parks || (this.parks = [])).push({ cx, cz, bw, bd, mesh: m, trees });
    this.spawns.push({ x: cx, z: cz, kind: 'park' });
  }

  _lot(cx, cz, bw, bd) {
    const w = this.world;
    const g = new THREE.PlaneGeometry(bw, bd, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.mats.road);
    m.position.set(cx, 0.16, cz);
    m.receiveShadow = true;
    w.group.add(m);
    this.spawns.push({ x: cx, z: cz, kind: 'lot' });
  }

  // ----------------------------------------------------------------- scenery

  /**
   * Ring the whole city with beach and open ocean — it's an island now, not a
   * coastline on one side.
   *
   * SHORE is the outer edge of the buildable grid; beyond it a sand ring, then
   * water out to the horizon. Boats need somewhere to be, so a marina is cut
   * into the south shore with jetties to tie up against.
   */
  _shoreline() {
    const w = this.world;
    const BEACH = BEACH_W;
    this.shore = SHORE;
    this.beachOuter = BEACH_OUTER;
    this.seaLevel = SEA_LEVEL;

    const quad = (x, z, sx, sz, mat, y) => {
      const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      w.group.add(m);
      return m;
    };

    // (Four flat sand strips and a single 12 km water quad used to live here.
    // The beach, the seabed, the moving sea and the reef are all built by the
    // Ocean below, once the marina and the runway are known, so the harbour
    // can be dredged and the runway given a causeway out over the shallows.)

    // Where the port will go. Fixed here rather than in Industry.js because
    // the seabed is built below and has to know where to dredge.
    this.docksPlan = { x: SHORE + 6, z0: 150, z1: 690 };

    // --- Marina, cut into the south shore -----------------------------------
    const mz = SHORE + BEACH * 0.35;
    this.marina = { x: 220, z: mz, berths: [] };
    // (The quay, the pontoons and their berths are built with the rest of the
    // marina's fittings in Industry.js, once the harbour has been dredged.)
    // Beacons over the marina and the airport. Both sit at the edge of a
    // 2 km map with nothing pointing at them — the boats and planes existed
    // for several builds without anyone being able to find them.
    const markMat = new THREE.MeshBasicMaterial({
      color: 0x4ad2ff, transparent: true, opacity: 0.22, depthWrite: false
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 5.0, 170, 10, 1, true), markMat);
    beam.position.set(this.marina.x, 85, mz + 20);
    w.group.add(beam);
    this.marinaBeacon = { x: this.marina.x, z: mz + 20 };

    this.seaEdge = -(SHORE + BEACH);

    const air = DISTRICTS.find((x) => x.id === 'airfield');
    this.ocean = new Ocean(this, {
      rand: this.rand,
      // Dredged basin under the marina so the berths are actually afloat.
      basin: { x0: this.marina.x - 105, x1: this.marina.x + 105, depth: -3.2 },
      // And a deeper one along the docks, so a coaster can lie at the quay.
      harbour: { z0: this.docksPlan.z0 - 40, z1: this.docksPlan.z1 + 40, depth: -7.5 },
      // The runway runs 240 m past the shoreline; build it land to sit on.
      strip: air ? { x0: air.x - 45, x1: air.x + 45, z0: air.z - 660, z1: air.z - 220 } : undefined
    });
  }

  /** Per-frame: near-camera grass and beach detail on, the rest off. */
  updateGround(cam, player) {
    if (this.parkland) this.parkland.update(cam, player);
    if (this.beachDebris) this.beachDebris.update(cam);
    if (this._detailTiles) {
      const p = cam;
      for (const m of this._detailTiles) {
        const s = m.geometry.boundingSphere;
        m.visible = s.center.distanceTo(p) - s.radius < DETAIL_DIST;
      }
    }
  }

  /** Sand or seabed height beyond the shore; street level inside it. */
  groundAt(x, z) {
    return this.ocean ? this.ocean.groundAt(x, z) : 0;
  }

  /** What a wheel or a foot rests on anywhere on the map. */
  surfaceAt(x, z) {
    if (Math.max(Math.abs(x), Math.abs(z)) <= SHORE) return 0;
    return this.groundAt(x, z);
  }

  /** Live sea surface height, waves included. */
  waterHeightAt(x, z) {
    return this.ocean ? this.ocean.heightAt(x, z) : SEA_LEVEL;
  }

  /**
   * Physics terrain. Inside the shoreline the city plate is the floor, so this
   * steps aside; beyond it, it is the beach. Underground it steps aside
   * entirely — the caves run out under the sea, and a seabed pushing anyone
   * below it up to its own height would lift a cave fight straight out onto
   * the ocean floor.
   */
  terrainAt(x, z) {
    if (this.game && this.game.freeRoam && this.game.freeRoam.inDungeon) return -1e9;
    if (Math.max(Math.abs(x), Math.abs(z)) <= SHORE) return -1e9;
    return this.groundAt(x, z);
  }

  /** True if a world position is out over open water. */
  isWater(x, z) {
    // Wherever the sand has gone under the still waterline, rather than a
    // fixed square — so the dredged marina counts and the runway causeway
    // does not.
    if (Math.max(Math.abs(x), Math.abs(z)) <= SHORE) return false;
    return this.groundAt(x, z) < this.seaLevel - 0.25;
  }

  /**
   * CROSSWIND FIELD: the airport, out on the north-east flank.
   *
   * A real runway rather than a decorative one — 700 m of tarmac with a clear
   * approach, because the planes parked here are meant to be flown, and a
   * plane needs room to get its nose up. Everything is kept off the street
   * grid so taxiing doesn't fight the traffic graph.
   */
  _airport() {
    const w = this.world;
    const d = DISTRICTS.find((x) => x.id === 'airfield');
    const cx = d.x, cz = d.z;
    this.airport = { x: cx, z: cz, runway: { x: cx, z: cz, len: 700, w: 46, heading: 0 }, planeSpots: [] };

    const quad = (x, z, sx, sz, mat, y) => {
      const g = new THREE.PlaneGeometry(sx, sz, 1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      w.group.add(m);
    };

    // Apron and runway, laid ABOVE the street surface and its markings so the
    // roads that cross the field disappear under the tarmac rather than
    // running across the apron.
    quad(cx, cz, 320, 260, this.mats.road, 0.20);
    quad(cx, cz - 300, 46, 700, this.mats.road, 0.21);

    // Centreline dashes down the runway.
    const geos = [];
    for (let t = -330; t <= 330; t += 34) {
      const g = new THREE.PlaneGeometry(1.6, 16, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, 0.26, cz - 300 + t);
      geos.push(g);
    }
    // Threshold bars at both ends.
    for (const end of [-345, 345]) {
      for (let k = -3; k <= 3; k++) {
        const g = new THREE.PlaneGeometry(3, 22, 1, 1);
        g.rotateX(-Math.PI / 2);
        g.translate(cx + k * 5, 0.26, cz - 300 + end);
        geos.push(g);
      }
    }
    const merged = mergeGeometries(geos);
    if (merged) w.group.add(new THREE.Mesh(merged, this.mats.paint));
    for (const g of geos) g.dispose();

    // Hangars along the apron's west edge.
    const hangarMat = w.mats.structureDark;
    for (let i = 0; i < 3; i++) {
      const hx = cx - 120;
      const hz = cz - 70 + i * 70;
      w._block(58, 18, 46, hx, 0, hz, hangarMat, { surface: 'metal' });
      // Open front face implied by a darker recess.
      w._block(40, 13, 2, hx + 30, 0, hz, w.mats.structure, { collide: false });
    }

    // Control tower.
    w._block(14, 34, 14, cx + 130, 0, cz + 70, hangarMat, { surface: 'stone' });
    w._block(22, 6, 22, cx + 130, 34, cz + 70, w.mats.structure, { surface: 'metal' });

    // Where aircraft sit, spaced along the apron.
    for (let i = 0; i < 4; i++) {
      this.airport.planeSpots.push({ x: cx - 40 + i * 42, z: cz + 60, yaw: 0 });
    }
    // Two more at the runway threshold, nose-on for a quick departure.
    const apMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.2, depthWrite: false
    });
    const apBeam = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 5.0, 170, 10, 1, true), apMat);
    apBeam.position.set(cx, 85, cz);
    w.group.add(apBeam);

    this.airport.planeSpots.push({ x: cx - 14, z: cz - 620, yaw: 0 });
    this.airport.planeSpots.push({ x: cx + 14, z: cz - 600, yaw: 0 });
  }

  /** Lamps, kerbs and crossings along every road — the texture of a street. */
  _streetFurniture(xs, zs) {
    const w = this.world;
    const rand = this.rand;
    const lampMat = w.mats.structureDark;
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x1a1408, emissive: 0xffc98a, emissiveIntensity: 1.6, roughness: 0.4
    });

    // Instanced lamp posts: one draw call for the whole city.
    // Street lamps sat at ROAD_W/2 + 1.6 and signal poles at + 1.5 — ten
    // centimetres apart. The lamp's bright amber head ended up buried inside
    // the signal head, so the traffic lamps were invisible behind a permanent
    // orange glow. Keep them well clear of every signalled junction.
    const posts = [];
    // Nothing of the street belongs on the airfield.
    const af = DISTRICTS.find((x) => x.id === 'airfield');
    const onField = (x, z) => af && Math.abs(x - af.x) < 180 && Math.abs(z - af.z) < 150;
    const nearSignal = (x, z) => {
      for (const sig of this.signals.values()) {
        if (Math.abs(sig.node.x - x) < 26 && Math.abs(sig.node.z - z) < 26) return true;
      }
      return false;
    };
    for (const x of xs) {
      for (let z = -HALF + 40; z < HALF; z += 62) {
        if (zs.some((c) => Math.abs(z - c) < ROAD_W)) continue;
        if (nearSignal(x, z) || onField(x, z)) continue;
        posts.push([x + ROAD_W / 2 + 1.6, z]);
        posts.push([x - ROAD_W / 2 - 1.6, z]);
      }
    }
    const postGeo = new THREE.CylinderGeometry(0.16, 0.2, 7.4, 6);
    const headGeo = new THREE.BoxGeometry(1.5, 0.28, 0.5);
    const pole = new THREE.InstancedMesh(postGeo, lampMat, posts.length);
    const head = new THREE.InstancedMesh(headGeo, glowMat, posts.length);
    pole.castShadow = true;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < posts.length; i++) {
      const [px, pz] = posts[i];
      m4.makeTranslation(px, 3.7, pz);
      pole.setMatrixAt(i, m4);
      m4.makeTranslation(px + (px > 0 ? -0.7 : 0.7), 7.3, pz);
      head.setMatrixAt(i, m4);
    }
    pole.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    w.group.add(pole, head);
    this.lampCount = posts.length;

    // --- Street clutter -----------------------------------------------------
    // Bins, hydrants, benches, bollards, post boxes, meters. All of it goes
    // through ONE InstancedMesh per kind, so a thousand objects cost a
    // thousand matrices and a handful of draw calls rather than a thousand
    // draws. At 36 FPS that distinction is the whole budget.
    const kinds = {
      bin:     { geo: new THREE.CylinderGeometry(0.28, 0.24, 0.92, 8),  mat: lampMat, y: 0.46 },
      hydrant: { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.72, 8),  mat: new THREE.MeshStandardMaterial({ color: 0xb03428, roughness: 0.6 }), y: 0.36 },
      bollard: { geo: new THREE.CylinderGeometry(0.09, 0.11, 0.86, 6),  mat: lampMat, y: 0.43 },
      box:     { geo: new THREE.BoxGeometry(0.44, 1.16, 0.36),          mat: new THREE.MeshStandardMaterial({ color: 0x2b5540, roughness: 0.7 }), y: 0.58 },
      bench:   { geo: new THREE.BoxGeometry(1.7, 0.12, 0.5),            mat: new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 }), y: 0.48 },
      meter:   { geo: new THREE.BoxGeometry(0.16, 1.2, 0.12),           mat: lampMat, y: 0.6 }
    };
    const picks = { bin: [], hydrant: [], bollard: [], box: [], bench: [], meter: [] };
    const names = Object.keys(kinds);
    for (const x of xs) {
      for (let z = -HALF + 24; z < HALF; z += 27) {
        if (zs.some((cz) => Math.abs(z - cz) < ROAD_W * 1.2)) continue;
        if (rand() > 0.55) continue;
        const side = rand() > 0.5 ? 1 : -1;
        const px = x + side * (ROAD_W / 2 + 2.4);
        picks[names[(rand() * names.length) | 0]].push([px, z, rand() * Math.PI * 2]);
      }
    }
    const m4b = new THREE.Matrix4();
    const qb = new THREE.Quaternion();
    const vb = new THREE.Vector3();
    const sb = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    this.clutterCount = 0;
    for (const name of names) {
      const list = picks[name];
      if (!list.length) continue;
      const k = kinds[name];
      const inst = new THREE.InstancedMesh(k.geo, k.mat, list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const [px, pz, rot] = list[i];
        qb.setFromAxisAngle(up, rot);
        m4b.compose(vb.set(px, k.y, pz), qb, sb);
        inst.setMatrixAt(i, m4b);
      }
      inst.instanceMatrix.needsUpdate = true;
      w.group.add(inst);
      this.clutterCount += list.length;
    }

    // Zebra crossings at a share of junctions.
    const stripes = [];
    for (const x of xs) {
      for (const z of zs) {
        if (rand() > 0.45) continue;
        for (let s = -3; s <= 3; s++) {
          stripes.push([x + s * 2.2, z + ROAD_W / 2 + 1.6, 1.2, 3.0]);
        }
      }
    }
    const geos = [];
    for (const [sx, sz, gw, gd] of stripes) {
      const g = new THREE.PlaneGeometry(gw, gd, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(sx, 0.038, sz);
      geos.push(g);
    }
    if (geos.length) {
      const merged = mergeGeometries(geos);
      if (merged) w.group.add(new THREE.Mesh(merged, this.mats.paint));
      for (const g of geos) g.dispose();
    }
  }
}

const _nm = new THREE.Matrix3();
/** Beyond this, merged tiles of small street detail are not drawn. */
const DETAIL_DIST = 260;

/**
 * A copy of `like` that takes colour, glow, roughness and metalness from the
 * vertices (written by bakeWorld) instead of its uniforms.
 */
function foldMaterial(like) {
  const f = like.clone();
  f.vertexColors = true;
  f.color.setRGB(1, 1, 1);
  f.userData = { cityFold: true };
  f.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aEmis;\nattribute vec2 aRM;\nvarying vec3 vEmis;\nvarying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmis = aEmis;\nvRM = aRM;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmis;\nvarying vec2 vRM;')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vEmis;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  f.customProgramCacheKey = () => 'city-fold';
  return f;
}

/**
 * Merge meshes into one world-space geometry without cloning them first.
 * Keeps position, normal and uv (zero-filled where a part has none), plus any
 * other attribute that every part carries — the facade shader reads those.
 */
function bakeWorld(meshes, fold = false) {
  let vtx = 0, ni = 0;
  for (const m of meshes) {
    const g = m.geometry;
    vtx += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vtx * 3);
  const nor = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const idx = vtx > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const first = meshes[0].geometry.attributes;
  const col = fold ? new Float32Array(vtx * 3) : null;
  const emis = fold ? new Float32Array(vtx * 3) : null;
  const rm = fold ? new Float32Array(vtx * 2) : null;
  const extra = Object.keys(first).filter((n) => n !== 'position' && n !== 'normal' && n !== 'uv' &&
    !(fold && n === 'color') &&
    meshes.every((m) => m.geometry.attributes[n] && m.geometry.attributes[n].itemSize === first[n].itemSize));
  const extraArr = extra.map((n) => new Float32Array(vtx * first[n].itemSize));

  let vo = 0, io = 0;
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const e = m.matrixWorld.elements;
    _nm.getNormalMatrix(m.matrixWorld);
    const ne = _nm.elements;
    const g = m.geometry;
    const P = g.attributes.position, N = g.attributes.normal, T = g.attributes.uv;
    const c = P.count;
    for (let i = 0; i < c; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (N) {
        const a = N.getX(i), b = N.getY(i), d = N.getZ(i);
        let nx = ne[0] * a + ne[3] * b + ne[6] * d;
        let ny = ne[1] * a + ne[4] * b + ne[7] * d;
        let nz = ne[2] * a + ne[5] * b + ne[8] * d;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
      } else {
        nor[o + 1] = 1;
      }
      if (T) { uv[(vo + i) * 2] = T.getX(i); uv[(vo + i) * 2 + 1] = T.getY(i); }
    }
    for (let k = 0; k < extra.length; k++) {
      const A = g.attributes[extra[k]];
      const sz = A.itemSize;
      const out = extraArr[k];
      for (let i = 0; i < c; i++) for (let j = 0; j < sz; j++) out[(vo + i) * sz + j] = A.getComponent(i, j);
    }
    if (fold) {
      // The material's own values, per vertex. emissive is pre-multiplied by
      // its intensity, which is exactly what three.js uploads as the uniform.
      const mt = m.material;
      const k = mt.emissiveIntensity;
      for (let i = vo; i < vo + c; i++) {
        col[i * 3] = mt.color.r; col[i * 3 + 1] = mt.color.g; col[i * 3 + 2] = mt.color.b;
        emis[i * 3] = mt.emissive.r * k; emis[i * 3 + 1] = mt.emissive.g * k; emis[i * 3 + 2] = mt.emissive.b * k;
        rm[i * 2] = mt.roughness; rm[i * 2 + 1] = mt.metalness;
      }
    }
    const gi = g.index;
    if (gi) { const arr = gi.array; for (let i = 0; i < gi.count; i++) idx[io++] = arr[i] + vo; }
    else for (let i = 0; i < c; i++) idx[io++] = vo + i;
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  extra.forEach((n, k) => out.setAttribute(n, new THREE.BufferAttribute(extraArr[k], first[n].itemSize)));
  if (fold) {
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aEmis', new THREE.BufferAttribute(emis, 3));
    out.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Minimal geometry merge. Only positions/normals/uvs are needed here and
 * pulling in the full BufferGeometryUtils addon for that is not worth it.
 */
function mergeGeometries(geos) {
  if (!geos.length) return null;
  let vtx = 0;
  for (const g of geos) vtx += g.attributes.position.count;
  const pos = new Float32Array(vtx * 3);
  const nor = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const idx = [];
  let vo = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (t) uv.set(t.array, vo * 2);
    const gi = g.index;
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + vo);
    else for (let i = 0; i < p.count; i++) idx.push(i + vo);
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Any other attribute every part carries comes through too. This merge
  // used to keep only the three above, and silently dropped the per-building
  // data the facade shader reads — storey height became zero, the shader
  // divided by it, and every building in the city rendered black.
  for (const name of Object.keys(geos[0].attributes)) {
    if (name === 'position' || name === 'normal' || name === 'uv') continue;
    const size = geos[0].attributes[name].itemSize;
    if (!geos.every((g) => g.attributes[name] && g.attributes[name].itemSize === size)) continue;
    const arr = new Float32Array(vtx * size);
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[name];
      arr.set(a.array, o * size);
      o += a.count;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.setIndex(idx);
  return out;
}
