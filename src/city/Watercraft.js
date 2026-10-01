import * as THREE from 'three';
import { loft, gridPatch, tube, aimMesh, span, mergeGeos } from './Shape.js';

/**
 * Watercraft — jetskis, boats and the marina they live in.
 *
 * THE HANDLING RULE that makes a boat feel like a boat is that it has NO
 * GRIP. A car's tyres bite, so it goes where it points; a hull just shoves
 * water aside, so it slides wide through every turn and keeps drifting after
 * you back off the throttle. That single difference — steering authority tied
 * to thrust rather than to speed, plus a long lateral decay — is what stops
 * these reading as cars that happen to float. The other rule: they only work
 * on water, so beaching one grinds it to a halt and the marina never becomes
 * a car park.
 *
 * THE HULLS used to be a single extruded wedge with boxes on top. A boat is
 * the most sculptural object anyone builds, and the whole of it lives in the
 * cross-section: a deep V at the bow that warps to a flat planing run aft, a
 * hard chine you can trace from stem to transom, topsides that flare outward,
 * and a sheer line that sweeps up toward the bow. All of that is one loft of
 * a varying section (see Shape.js), and everything else — antifouling below
 * the waterline, boot stripe, rubbing strake, deck camber — hangs off the
 * same section function, so it all lies on the hull instead of near it.
 *
 * THE ORIGIN IS THE WATERLINE. Keel below, sheer above, so the boat floats by
 * putting the group at sea level and nothing has to be nudged by hand.
 */

const HULLS = [
  {
    id: 'jetski', name: 'SPINDRIFT', l: 3.0, w: 1.2, h: 1.0,
    topSpeed: 30, accel: 16, turn: 1.5, drag: 0.55, wake: 0.7, seats: 1,
    draft: 0.24, freeboard: 0.34, deadrise: 0.42, bowRise: 0.22
  },
  {
    id: 'speedboat', name: 'RIPTIDE 22', l: 6.8, w: 2.4, h: 1.8,
    topSpeed: 38, accel: 12, turn: 0.9, drag: 0.42, wake: 1.0, seats: 4,
    draft: 0.44, freeboard: 0.66, deadrise: 0.38, bowRise: 0.30
  },
  {
    id: 'launch', name: 'HARBOUR RUNNER', l: 9.0, w: 3.0, h: 2.6,
    topSpeed: 22, accel: 6, turn: 0.55, drag: 0.5, wake: 1.3, seats: 8,
    draft: 0.68, freeboard: 0.88, deadrise: 0.30, bowRise: 0.34
  },
  {
    id: 'yacht', name: 'MERIDIAN 48', l: 14.0, w: 4.2, h: 4.0,
    topSpeed: 18, accel: 4, turn: 0.34, drag: 0.55, wake: 1.8, seats: 12,
    draft: 0.98, freeboard: 1.30, deadrise: 0.26, bowRise: 0.42
  }
];

const PAINTS = [0xe8e8ea, 0x1f4f8c, 0xc21f3a, 0x2b2f36, 0xe8b21c, 0x2e6b4f];
const PORTS = ['PORT AZURA', 'SKYBREAK', 'CAPE VERDE', 'LONGSHORE', 'NORTH BAY'];

const _v = new THREE.Vector3();

/** Name and home port on the transom, the way every boat in a marina wears it. */
function transomTexture(name, port) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = '#f4f6f8';
  g.font = 'bold 58px Georgia, serif';
  g.textAlign = 'center';
  g.fillText(name, 256, 62);
  g.font = '26px Georgia, serif';
  g.fillStyle = 'rgba(235,240,245,0.85)';
  g.fillText(port, 256, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Watercraft {
  constructor(city, x, z, typeId = null, yaw = 0) {
    this.city = city;
    this.game = city.game;
    const found = typeId ? HULLS.find((h) => h.id === typeId) : null;
    this.type = { ...(found || HULLS[(Math.random() * HULLS.length) | 0]) };
    this.style = this.type;
    this.name = this.type.name;

    this.position = new THREE.Vector3(x, city.seaLevel ?? -0.9, z);
    this.yaw = yaw;
    this.speed = 0;
    this.lateral = 0;
    this.steer = 0;
    this.driver = null;
    this.alive = true;
    this.health = 120;
    this.maxHealth = 120;
    this.isBoat = true;
    this.radius = this.type.w * 0.55;
    this._bob = Math.random() * 10;

    this.group = new THREE.Group();
    this._statics = new Map();
    this.props = [];
    this._wellSpec = this._well();
    this._build();
    this._flushStatics();
    this.game.scene.add(this.group);
    this.sync();
  }

  // ---------------------------------------------------------------- helpers

  _st(geo, mat) {
    if (!geo) return;
    if (!this._statics.has(mat)) this._statics.set(mat, []);
    this._statics.get(mat).push(geo);
  }

  _flushStatics() {
    for (const [mat, geos] of this._statics) {
      const merged = mergeGeos(geos);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      for (const g of geos) if (g !== merged) g.dispose();
    }
    this._statics.clear();
  }

  _put(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    geo = geo.clone();
    if (rx || ry || rz) {
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    }
    geo.translate(x, y, z);
    this._st(geo, mat);
    return geo;
  }

  _strut(a, b, r, mat, segs = 6) {
    const L = span(a, b);
    if (L < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, L, segs);
    const m = new THREE.Mesh(g);
    aimMesh(m, a, b);
    m.updateMatrix();
    g.applyMatrix4(m.matrix);
    this._st(g, mat);
  }

  // ------------------------------------------------------------ the section

  /**
   * The hull's defining curve, as a function of position along the boat.
   *
   * `t` runs 0 at the transom to 1 at the stem. Everything that makes a hull
   * a hull is in here: the beam swelling to its widest around two-thirds aft,
   * the deadrise sharpening from a flat planing run into a deep V forward, the
   * forefoot lifting out of the water at the bow, and the sheer sweeping up to
   * meet it.
   */
  _station(t) {
    const T = this.type;
    const halfB = T.w * 0.5;
    // Beam: full aft, widest just forward of midships, pinched to the stem.
    const beam = halfB * (t < 0.62
      ? 0.90 + 0.10 * Math.sin((t / 0.62) * Math.PI * 0.6)
      : Math.pow(1 - (t - 0.62) / 0.38, 0.62));
    // Deadrise: flat run at the transom, deep V at the bow.
    const dead = T.deadrise * (0.55 + 1.5 * Math.pow(Math.max(0, t - 0.25) / 0.75, 1.5));
    // Keel: straight run aft, forefoot rising sharply into the stem.
    const keel = -T.draft * (t < 0.55 ? 1 : Math.pow(1 - (t - 0.55) / 0.45, 1.5));
    // Sheer: sweeps up toward the bow, and a touch up at the transom too.
    const sheer = T.freeboard + T.bowRise * Math.pow(t, 2.2) + T.freeboard * 0.05 * Math.pow(1 - t, 3);
    return { beam: Math.max(0.02, beam), dead, keel, sheer };
  }

  /**
   * A point on the hull's half-section. `v` runs 0 at the keel to 1 at the
   * sheer, through the chine at 0.55 — which is why the chine stays a single
   * traceable line from stem to transom instead of wandering.
   */
  _hullPoint(t, v, side = 1) {
    const s = this._station(t);
    const chineY = s.keel + s.dead * s.beam * 0.92;
    let x, y;
    if (v <= 0.55) {
      const u = v / 0.55;
      x = s.beam * 0.92 * u;
      // Slight convexity in the bottom panel, so it isn't a dead flat plane.
      y = s.keel + (chineY - s.keel) * u - s.beam * 0.05 * u * (1 - u);
    } else {
      const u = (v - 0.55) / 0.45;
      // Topside, flared outward as it rises — the flare that throws spray.
      x = s.beam * (0.92 + 0.08 * Math.pow(u, 0.7));
      y = chineY + (s.sheer - chineY) * Math.pow(u, 0.92);
    }
    return [side * x, y, (t - 0.5) * this.type.l];
  }

  /** Where the waterline crosses the section, as a `v`. */
  _waterV(t) {
    let lo = 0, hi = 1;
    if (this._hullPoint(t, 1)[1] < 0) return 1;
    for (let i = 0; i < 16; i++) {
      const m = (lo + hi) / 2;
      if (this._hullPoint(t, m)[1] < 0) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /**
   * The sunken cockpit: which stretch of the boat it occupies and how deep.
   *
   * Without this the hull loft closes flush across the sheer from stem to
   * stern, and every seat, wheel and sole placed inside the boat is sealed
   * under a solid deck where nobody will ever see it. A cockpit is a WELL,
   * and the well has to be cut out of the same surface that makes the deck.
   */
  _well() {
    switch (this.type.id) {
      case 'speedboat': return { t0: 0.09, t1: 0.60, depth: 0.52 };
      case 'launch': return { t0: 0.06, t1: 0.42, depth: 0.52 };
      case 'yacht': return { t0: 0.05, t1: 0.33, depth: 0.44 };
      default: return null;
    }
  }

  /** The sole height inside the well, in the same frame as everything else. */
  get soleY() {
    const w = this._wellSpec;
    return w ? this._station((w.t0 + w.t1) / 2).sheer - w.depth : this.type.freeboard;
  }

  /**
   * A point on the deck, spanning sheer to sheer at station t — cambered
   * where it is deck, and dropped to the sole where it is cockpit. The
   * gunwale itself always stays up at the sheer, so the drop reads as an
   * inner liner running down into the boat rather than a hole in the side.
   */
  _deckPoint(t, u) {
    const s = this._station(t);
    const x = (u * 2 - 1);
    const edge = this._hullPoint(t, 1, 1);
    const crown = Math.min(0.12, s.beam * 0.07);
    let y = s.sheer + crown * (1 - x * x);
    const w = this._wellSpec;
    if (w && t > w.t0 && t < w.t1) {
      // Faired in at both ends, so there is a step down rather than a cliff.
      const ends = Math.min(1, Math.min(t - w.t0, w.t1 - t) / 0.07);
      const side = Math.min(1, Math.max(0, (0.88 - Math.abs(x)) / 0.16));
      y += (s.sheer - w.depth - y) * ends * side;
    }
    return [x * edge[0], y, edge[2]];
  }

  /** The complete closed hull: topsides down to the keel, closed by the deck. */
  _hullGeometry(stations = 16, half = 9) {
    const rings = [];
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const ring = [];
      // Port sheer down to the keel.
      for (let k = half; k >= 1; k--) ring.push(this._hullPoint(t, k / half, -1));
      // Keel, once.
      ring.push(this._hullPoint(t, 0, 1));
      // Starboard keel up to the sheer.
      for (let k = 1; k <= half; k++) ring.push(this._hullPoint(t, k / half, 1));
      // Across the cambered deck, back to the port sheer. Enough points that
      // the cockpit well has walls and a floor rather than a crease.
      for (let k = 1; k < 8; k++) ring.push(this._deckPoint(t, 1 - k / 8));
      rings.push(ring);
    }
    return loft(rings, { capStart: true, capEnd: true });
  }

  // ----------------------------------------------------------------- build

  _build() {
    const T = this.type;
    const paint = PAINTS[(Math.random() * PAINTS.length) | 0];
    const M = this.mats = {
      hull: new THREE.MeshPhysicalMaterial({
        color: paint, roughness: 0.22, metalness: 0.25,
        clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.6
      }),
      // Gelcoat white for the deck and superstructure, whatever the topsides.
      gel: new THREE.MeshPhysicalMaterial({
        color: 0xeef0f2, roughness: 0.25, metalness: 0.12,
        clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.3
      }),
      // Antifouling: the dull dark red every hull wears below the waterline.
      anti: new THREE.MeshStandardMaterial({
        color: 0x59201c, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide
      }),
      boot: new THREE.MeshStandardMaterial({
        color: 0x14161a, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide
      }),
      teak: new THREE.MeshStandardMaterial({ color: 0xb2895c, roughness: 0.82 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x191c21, roughness: 0.62, metalness: 0.4 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc6ccd2, roughness: 0.22, metalness: 0.95 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.95 }),
      cushion: new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.88 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x1d2b35, roughness: 0.03, metalness: 0.14,
        transparent: true, opacity: 0.68, clearcoat: 1, clearcoatRoughness: 0.02,
        envMapIntensity: 2.0, depthWrite: false
      }),
      screen: new THREE.MeshPhysicalMaterial({
        color: 0x93b6c9, roughness: 0.02, metalness: 0.1,
        transparent: true, opacity: 0.32, clearcoat: 1, envMapIntensity: 2.2,
        depthWrite: false
      }),
      // WHAT SITS BEHIND THE GLASS. A tinted pane laid on a white cabin side
      // renders as a pale grey stripe, because there is nothing dark for it
      // to be dark against — the saloon windows read as a painted band. Real
      // cabin glass looks black from outside because the inside is a shaded
      // room, so every window here gets a recessed dark panel behind it.
      void: new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.95 })
    };
    this.lamps = {
      port: new THREE.MeshStandardMaterial({ color: 0x2a0606, emissive: 0xff2818, emissiveIntensity: 1.5, roughness: 0.3 }),
      stbd: new THREE.MeshStandardMaterial({ color: 0x052a10, emissive: 0x2cff60, emissiveIntensity: 1.5, roughness: 0.3 }),
      mast: new THREE.MeshStandardMaterial({ color: 0x24241e, emissive: 0xfff4d0, emissiveIntensity: 1.2, roughness: 0.3 })
    };

    // --- The hull, and what is painted on it ------------------------------
    this._st(this._hullGeometry(T.id === 'yacht' ? 20 : 16, 9), M.hull);

    // Antifouling below the waterline and the boot stripe just above it, both
    // lying exactly on the hull because they are sampled from the same curve.
    for (const side of [1, -1]) {
      this._st(gridPatch(18, 4, (u, v) => {
        const t = u;
        return this._hullPoint(t, this._waterV(t) * v, side).map((c, i) => c + (i === 0 ? side * 0.006 : 0));
      }, null), M.anti);
      this._st(gridPatch(18, 1, (u, v) => {
        const t = u;
        const w = this._waterV(t);
        return this._hullPoint(t, Math.min(1, w + (1 - w) * 0.10 * v), side)
          .map((c, i) => c + (i === 0 ? side * 0.009 : 0));
      }, null), M.boot);
      // Rubbing strake: the fat rubber moulding along the sheer that every
      // boat wears because every boat hits the dock eventually.
      const strake = [];
      for (let i = 0; i <= 14; i++) {
        const p = this._hullPoint(i / 14, 0.93, side);
        strake.push([p[0] + side * 0.02, p[1], p[2]]);
      }
      this._st(tube(strake, Math.max(0.03, T.w * 0.022), 6), M.rubber);
      // A spray rail along the chine, which is what actually lifts a hull on
      // to the plane — and the line your eye follows down the side.
      const rail = [];
      for (let i = 0; i <= 14; i++) {
        const p = this._hullPoint(i / 14, 0.55, side);
        rail.push([p[0] + side * 0.012, p[1], p[2]]);
      }
      this._st(tube(rail, Math.max(0.018, T.w * 0.012), 5), M.hull);
    }

    if (T.id === 'jetski') this._buildJetski();
    else {
      this._buildDeck();
      if (T.id === 'speedboat') this._buildSportsboat();
      else if (T.id === 'launch') this._buildLaunch();
      else this._buildYacht();
      this._buildGround();
    }
  }

  /** Transom name board, swim platform and ladder — the stern, close up. */
  _transom() {
    const T = this.type;
    const M = this.mats;
    const z = -T.l * 0.5;
    const s = this._station(0);
    const port = PORTS[(Math.random() * PORTS.length) | 0];
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(s.beam * 1.3, s.beam * 0.33),
      new THREE.MeshStandardMaterial({
        map: transomTexture(this.name, port), transparent: true,
        roughness: 0.5, metalness: 0.1, depthWrite: false
      })
    );
    plate.position.set(0, T.freeboard * 0.42, z - 0.03);
    plate.rotation.y = Math.PI;
    this.group.add(plate);

    // Swim platform and a folding ladder, which is how you get back aboard.
    const pw = s.beam * 1.4, pd = Math.max(0.4, T.l * 0.075);
    this._put(new THREE.BoxGeometry(pw, 0.07, pd), M.teak, 0, 0.12, z - pd * 0.5);
    for (const sx of [-1, 1]) {
      this._strut([sx * pw * 0.4, 0.12, z - 0.05], [sx * pw * 0.4, T.freeboard * 0.5, z + 0.02], 0.03, M.steel);
      this._strut([sx * 0.16, 0.1, z - pd * 0.85], [sx * 0.16, -0.45, z - pd * 0.7], 0.022, M.steel);
    }
    for (let r = 0; r < 2; r++) {
      this._strut([-0.16, -0.12 - r * 0.2, z - pd * 0.76], [0.16, -0.12 - r * 0.2, z - pd * 0.76], 0.018, M.steel);
    }
  }

  /**
   * Deck fittings every boat in the world carries: cleats to tie up to, a
   * bow roller with an anchor in it, fenders over the side, and the nav
   * lights that tell you which way it is pointing at night.
   */
  _buildGround() {
    const T = this.type;
    const M = this.mats;
    this._transom();

    // Cleats and fairleads, fore and aft on both sides.
    for (const side of [-1, 1]) {
      for (const t of [0.12, 0.5, 0.86]) {
        const p = this._deckPoint(t, side > 0 ? 0.92 : 0.08);
        this._put(new THREE.BoxGeometry(0.07, 0.06, 0.26), M.steel, p[0], p[1] + 0.06, p[2]);
        this._put(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 6), M.steel, p[0], p[1] + 0.03, p[2], 0, 0, Math.PI / 2);
      }
      // Fenders hung over the side amidships, the detail that says "moored".
      for (const t of [0.34, 0.52]) {
        const p = this._hullPoint(t, 0.95, side);
        const f = new THREE.CylinderGeometry(T.w * 0.055, T.w * 0.055, T.w * 0.26, 8);
        this._put(f, M.gel, p[0] + side * 0.07, p[1] - T.w * 0.12, p[2]);
        this._strut([p[0], p[1] + 0.1, p[2]], [p[0] + side * 0.07, p[1] - T.w * 0.02, p[2]], 0.008, M.trim, 4);
      }
      // Nav light in the pulpit: red to port, green to starboard.
      const n = this._deckPoint(0.9, side > 0 ? 0.88 : 0.12);
      this._put(new THREE.BoxGeometry(0.09, 0.09, 0.1), side > 0 ? this.lamps.stbd : this.lamps.port,
        n[0], n[1] + 0.12, n[2]);
    }

    // Bow roller with the anchor stowed in it, and the chain running aft.
    const bow = this._deckPoint(0.985, 0.5);
    this._put(new THREE.BoxGeometry(0.12, 0.09, 0.4), M.steel, 0, bow[1] + 0.04, bow[2] - 0.12);
    this._put(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), M.steel, 0, bow[1] + 0.06, bow[2] + 0.02, 0, 0, Math.PI / 2);
    const aw = Math.max(0.22, T.w * 0.13);
    this._put(new THREE.BoxGeometry(0.06, aw * 0.9, 0.1), M.steel, 0, bow[1] - aw * 0.2, bow[2] - 0.02);
    for (const sx of [-1, 1]) {
      this._strut([0, bow[1] - aw * 0.55, bow[2] - 0.02], [sx * aw * 0.55, bow[1] - aw * 0.1, bow[2] - 0.02], 0.03, M.steel, 5);
    }
    this._put(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 7), M.steel, 0, bow[1] + 0.02, bow[2] - 0.5, Math.PI / 2);
  }

  /** Teak deck planking laid over the moulded deck, plus a toe rail. */
  _buildDeck() {
    const T = this.type;
    const M = this.mats;
    // A planked panel over the foredeck: the laid teak you see on anything
    // bigger than a runabout, and the thing that stops the bow being a blank.
    const t0 = T.id === 'yacht' ? 0.52 : 0.58;
    this._st(gridPatch(10, 6, (u, v) => {
      const p = this._deckPoint(t0 + (0.96 - t0) * u, 0.07 + v * 0.86);
      return [p[0], p[1] + 0.012, p[2]];
    }, new THREE.Vector3(0, 1, 0)), M.teak);
    // Toe rail round the edge of the deck.
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const p = this._deckPoint(0.06 + (i / 12) * 0.92, side > 0 ? 0.965 : 0.035);
        pts.push([p[0], p[1] + 0.03, p[2]]);
      }
      this._st(tube(pts, 0.028, 5), M.gel);
    }
  }

  /** A stanchioned guard rail along a run of deck. */
  _rail(t0, t1, side, height, posts = 4) {
    const M = this.mats;
    const top = [];
    for (let i = 0; i <= posts; i++) {
      const t = t0 + (t1 - t0) * (i / posts);
      const p = this._deckPoint(t, side > 0 ? 0.94 : 0.06);
      this._strut([p[0], p[1], p[2]], [p[0], p[1] + height, p[2]], 0.017, M.steel, 5);
      top.push([p[0], p[1] + height, p[2]]);
    }
    this._st(tube(top, 0.019, 6), M.steel);
    const mid = top.map((p) => [p[0], p[1] - height * 0.45, p[2]]);
    this._st(tube(mid, 0.013, 5), M.steel);
  }

  /** The helm: a console, a wheel that turns, throttle and instruments. */
  _helm(x, y, z, scale = 1, seatBack = true) {
    const M = this.mats;
    this._put(new THREE.BoxGeometry(0.66 * scale, 0.58 * scale, 0.36 * scale), M.gel, x, y + 0.29 * scale, z);
    const dash = new THREE.MeshStandardMaterial({
      color: 0x14171c, roughness: 0.8, emissive: 0x0c2029, emissiveIntensity: 0.8
    });
    this._put(new THREE.BoxGeometry(0.58 * scale, 0.26 * scale, 0.06 * scale), dash,
      x, y + 0.56 * scale, z - 0.14 * scale, -0.34);
    const scr = new THREE.MeshStandardMaterial({
      color: 0x08181a, emissive: 0x24c8b0, emissiveIntensity: 0.9, roughness: 0.3
    });
    this._put(new THREE.BoxGeometry(0.3 * scale, 0.18 * scale, 0.02 * scale), scr,
      x - 0.12 * scale, y + 0.57 * scale, z - 0.16 * scale, -0.34);
    for (const dx of [0.14, 0.24]) {
      this._put(new THREE.CylinderGeometry(0.04 * scale, 0.04 * scale, 0.02, 10), scr,
        x + dx * scale, y + 0.57 * scale, z - 0.16 * scale, -0.34 + Math.PI / 2);
    }
    // Wheel on a column, kept as a handle so it turns with the helm.
    const wheel = new THREE.Group();
    wheel.position.set(x, y + 0.52 * scale, z - 0.30 * scale);
    wheel.rotation.x = -0.42;
    this.group.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.16 * scale, 0.017 * scale, 6, 18), M.trim));
    for (let s = 0; s < 3; s++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02 * scale, 0.3 * scale, 0.012 * scale), M.steel);
      sp.rotation.z = (s / 3) * Math.PI;
      wheel.add(sp);
    }
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035 * scale, 0.035 * scale, 0.05, 8), M.steel));
    this.helm = wheel;
    // Throttle lever at the right hand.
    this._put(new THREE.BoxGeometry(0.07 * scale, 0.1 * scale, 0.14 * scale), M.trim, x + 0.36 * scale, y + 0.5 * scale, z - 0.1 * scale);
    this._put(new THREE.CylinderGeometry(0.014 * scale, 0.014 * scale, 0.22 * scale, 6), M.steel,
      x + 0.36 * scale, y + 0.6 * scale, z - 0.06 * scale, 0.45);
    this._put(new THREE.SphereGeometry(0.03 * scale, 8, 6), M.trim, x + 0.36 * scale, y + 0.7 * scale, z - 0.01 * scale);
    if (seatBack) this._seat(x, y, z - 0.86 * scale, scale);
    this.eye = new THREE.Vector3(x, y + 1.18 * scale, z - 0.62 * scale);
  }

  /** A helm or passenger seat: base, squab, bolstered back. */
  _seat(x, y, z, scale = 1) {
    const M = this.mats;
    this._put(new THREE.CylinderGeometry(0.1 * scale, 0.14 * scale, 0.34 * scale, 8), M.gel, x, y + 0.17 * scale, z);
    this._put(new THREE.BoxGeometry(0.46 * scale, 0.12 * scale, 0.42 * scale), M.cushion, x, y + 0.4 * scale, z);
    this._put(new THREE.BoxGeometry(0.46 * scale, 0.52 * scale, 0.12 * scale), M.cushion, x, y + 0.68 * scale, z - 0.2 * scale, -0.16);
    this._put(new THREE.BoxGeometry(0.46 * scale, 0.1 * scale, 0.14 * scale), M.cushion, x, y + 0.94 * scale, z - 0.24 * scale);
  }

  /**
   * A wraparound windscreen on a frame, bent round the section so it follows
   * the deck instead of standing across it as a flat pane.
   */
  _windscreen(t0, t1, height, tilt = 0.3) {
    const M = this.mats;
    const at = (u, v) => {
      // u walks the screen from the port end, round the front, to starboard.
      // The CENTRE of that path is the furthest forward point — running t
      // straight from t0 to t1 instead gives a pane set diagonally across
      // the boat, which is not a thing any boat has.
      const side = u < 0.5 ? -1 : 1;
      const k = Math.abs(u - 0.5) * 2;
      const t = t1 + (t0 - t1) * k;
      const p = this._deckPoint(t, 0.5 + side * 0.44 * k);
      return [p[0], p[1] + v * height, p[2] + v * height * tilt];
    };
    this._st(gridPatch(8, 3, at, new THREE.Vector3(0, 0.4, 1)), M.screen);
    // Frame: uprights and a capping rail.
    const cap = [];
    for (let i = 0; i <= 8; i++) cap.push(at(i / 8, 1));
    this._st(tube(cap, 0.022, 5), M.steel);
    const base = [];
    for (let i = 0; i <= 8; i++) base.push(at(i / 8, 0));
    this._st(tube(base, 0.02, 5), M.steel);
    for (const u of [0, 0.5, 1]) this._strut(at(u, 0), at(u, 1), 0.018, M.steel, 5);
  }

  // --------------------------------------------------------------- jetski

  _buildJetski() {
    const T = this.type;
    const M = this.mats;
    const L = T.l;
    // A jetski has no flat deck — it has a moulded top that swells over the
    // engine and dips into footwells either side. Lofted the same way as the
    // hull, so the two shapes share an edge.
    const rings = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const s = this._station(t);
      const hump = Math.sin(Math.min(1, Math.max(0, (t - 0.1) / 0.8)) * Math.PI);
      const hy = s.sheer + 0.30 * hump;
      const hw = s.beam * (0.52 + 0.3 * hump);
      const ring = [];
      for (let k = 0; k < 10; k++) {
        const th = (k / 10) * Math.PI * 2;
        ring.push([
          Math.cos(th) * hw,
          s.sheer - 0.02 + (hy - s.sheer) * (0.5 + 0.5 * Math.sin(th)),
          (t - 0.5) * L
        ]);
      }
      rings.push(ring);
    }
    this._st(loft(rings, { capStart: true, capEnd: true }), M.hull);
    // Gunwale strip in gelcoat, and the footwells.
    for (const side of [-1, 1]) {
      this._st(gridPatch(8, 1, (u, v) => {
        const t = 0.1 + u * 0.55;
        const p = this._hullPoint(t, 1 - v * 0.12, side);
        return [p[0], p[1] + 0.01, p[2]];
      }, new THREE.Vector3(0, 1, 0)), M.gel);
      // Mirror on a stalk.
      this._strut([side * 0.16, T.freeboard + 0.42, L * 0.24], [side * 0.26, T.freeboard + 0.6, L * 0.22], 0.012, M.trim, 4);
      this._put(new THREE.BoxGeometry(0.11, 0.07, 0.03), M.trim, side * 0.27, T.freeboard + 0.62, L * 0.22);
    }
    // Seat: a long stepped saddle, stitched.
    this._put(new THREE.BoxGeometry(T.w * 0.46, 0.14, L * 0.36), M.trim, 0, T.freeboard + 0.34, -L * 0.08);
    this._put(new THREE.BoxGeometry(T.w * 0.42, 0.1, L * 0.16), M.trim, 0, T.freeboard + 0.42, -L * 0.24);
    // Handlebar pole, bars and grips.
    this._strut([0, T.freeboard + 0.26, L * 0.26], [0, T.freeboard + 0.52, L * 0.20], 0.05, M.gel, 7);
    this._strut([-0.30, T.freeboard + 0.54, L * 0.19], [0.30, T.freeboard + 0.54, L * 0.19], 0.018, M.steel, 6);
    for (const side of [-1, 1]) {
      this._put(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 7), M.rubber,
        side * 0.26, T.freeboard + 0.54, L * 0.19, 0, 0, Math.PI / 2);
    }
    // Front hood with a dark instrument pod, and a grab handle at the back.
    this._put(new THREE.BoxGeometry(T.w * 0.4, 0.06, 0.24), M.trim, 0, T.freeboard + 0.44, L * 0.3, -0.3);
    this._strut([-0.14, T.freeboard + 0.36, -L * 0.42], [0.14, T.freeboard + 0.36, -L * 0.42], 0.02, M.steel, 5);
    // Jet nozzle in the tunnel under the transom, and the steering nozzle.
    this._put(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10), M.trim, 0, -0.1, -L * 0.48, Math.PI / 2);
    this._put(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 10), M.steel, 0, -0.1, -L * 0.54, Math.PI / 2);
    // Nav lights and a boarding step.
    this._put(new THREE.BoxGeometry(0.06, 0.05, 0.06), this.lamps.port, -T.w * 0.36, T.freeboard + 0.16, L * 0.22);
    this._put(new THREE.BoxGeometry(0.06, 0.05, 0.06), this.lamps.stbd, T.w * 0.36, T.freeboard + 0.16, L * 0.22);
    this._put(new THREE.BoxGeometry(T.w * 0.5, 0.05, 0.3), M.trim, 0, 0.06, -L * 0.42);
    this.eye = new THREE.Vector3(0, T.freeboard + 1.0, -L * 0.02);
  }

  // ------------------------------------------------------------ sportsboat

  /** An open bowrider: windscreen, helm, bucket seats, sunpad, outboard. */
  _buildSportsboat() {
    const T = this.type;
    const M = this.mats;
    const L = T.l;
    const deckY = T.freeboard;
    const sole = this.soleY;

    // Teak laid on the cockpit floor — the floor itself is part of the hull
    // loft now, so this is decoration rather than structure.
    this._put(new THREE.BoxGeometry(T.w * 0.62, 0.04, L * 0.40), M.teak, 0, sole + 0.03, -L * 0.1);
    for (const side of [-1, 1]) this._rail(0.66, 0.96, side, 0.38, 3);
    this._windscreen(0.60, 0.66, 0.44, 0.34);
    this._helm(T.w * 0.22, sole, L * 0.06, 1, true);
    this._seat(-T.w * 0.22, sole, L * 0.06 - 0.86);
    // Rear bench across the transom, with a bolster.
    this._put(new THREE.BoxGeometry(T.w * 0.66, 0.16, 0.5), M.cushion, 0, sole + 0.40, -L * 0.32);
    this._put(new THREE.BoxGeometry(T.w * 0.66, 0.42, 0.12), M.cushion, 0, sole + 0.66, -L * 0.38);
    this._put(new THREE.BoxGeometry(T.w * 0.66, 0.34, 0.42), M.gel, 0, sole + 0.2, -L * 0.32);
    // Bow sunpad, forward of the screen.
    this._put(new THREE.BoxGeometry(T.w * 0.5, 0.12, L * 0.18), M.cushion, 0, deckY + 0.14, L * 0.26);
    // Ski pylon and a pair of grab rails.
    this._strut([0, sole + 0.1, -L * 0.2], [0, deckY + 0.66, -L * 0.2], 0.035, M.steel, 7);
    this._strut([-0.3, deckY + 0.62, -L * 0.2], [0.3, deckY + 0.62, -L * 0.2], 0.022, M.steel, 5);

    // --- Outboard on the transom ------------------------------------------
    // The single most recognisable object on a small boat, and it was missing
    // entirely: this hull had no visible means of propulsion at all.
    const oz = -L * 0.5 - 0.22;
    const bracket = new THREE.Group();
    bracket.position.set(0, sole + 0.22, oz + 0.1);
    this.group.add(bracket);
    this.outboard = bracket;
    const cowl = loft([
      [[-0.20, -0.02, 0.22], [0.20, -0.02, 0.22], [0.22, 0.30, 0.20], [-0.22, 0.30, 0.20]],
      [[-0.24, -0.04, 0.02], [0.24, -0.04, 0.02], [0.26, 0.38, 0.0], [-0.26, 0.38, 0.0]],
      [[-0.22, -0.04, -0.24], [0.22, -0.04, -0.24], [0.23, 0.34, -0.26], [-0.23, 0.34, -0.26]]
    ], { capStart: true, capEnd: true });
    bracket.add(new THREE.Mesh(cowl, M.trim));
    // Midsection, cavitation plate, gearcase and propeller.
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.3), M.gel);
    mid.position.set(0, -0.34, -0.02);
    bracket.add(mid);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.42), M.gel);
    plate.position.set(0, -0.64, -0.02);
    bracket.add(plate);
    const gear = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 4, 8), M.gel);
    gear.rotation.x = Math.PI / 2;
    gear.position.set(0, -0.78, -0.02);
    bracket.add(gear);
    const prop = new THREE.Group();
    prop.position.set(0, -0.78, -0.26);
    bracket.add(prop);
    for (let b = 0; b < 3; b++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.1), M.steel);
      bl.position.set(Math.cos((b / 3) * Math.PI * 2) * 0.1, Math.sin((b / 3) * Math.PI * 2) * 0.1, 0);
      bl.rotation.z = (b / 3) * Math.PI * 2;
      bl.rotation.y = 0.5;
      prop.add(bl);
    }
    this.props.push(prop);
    // Tilt ram and the clamp bracket on the transom.
    this._put(new THREE.BoxGeometry(0.34, 0.3, 0.12), M.gel, 0, sole + 0.3, -L * 0.5 + 0.04);
  }

  // ---------------------------------------------------------------- launch

  /** A working launch: a small pilothouse, a mast, and a shaft drive. */
  _buildLaunch() {
    const T = this.type;
    const M = this.mats;
    const L = T.l;
    const deckY = T.freeboard;

    // Pilothouse: a lofted box with a raked front and wrapped glazing.
    const hw = T.w * 0.36, hz0 = -L * 0.02, hz1 = L * 0.24, hy = deckY + 1.32;
    this._st(loft([
      [[-hw, deckY, hz0], [hw, deckY, hz0], [hw, hy, hz0], [-hw, hy, hz0]],
      [[-hw * 1.02, deckY, hz1 * 0.5], [hw * 1.02, deckY, hz1 * 0.5], [hw * 0.98, hy + 0.04, hz1 * 0.5], [-hw * 0.98, hy + 0.04, hz1 * 0.5]],
      [[-hw * 0.94, deckY, hz1], [hw * 0.94, deckY, hz1], [hw * 0.84, hy - 0.06, hz1 - 0.22], [-hw * 0.84, hy - 0.06, hz1 - 0.22]]
    ], { capStart: true, capEnd: true }), M.gel);
    // Glazing: front screen, side windows, rear light.
    this._put(new THREE.BoxGeometry(hw * 1.55, 0.46, 0.03), M.void, 0, hy - 0.36, hz1 - 0.17, -0.28);
    this._put(new THREE.BoxGeometry(hw * 1.6, 0.52, 0.04), M.screen, 0, hy - 0.36, hz1 - 0.14, -0.28);
    for (const side of [-1, 1]) {
      this._put(new THREE.BoxGeometry(0.04, 0.42, L * 0.13), M.void, side * hw * 0.96, hy - 0.34, hz1 * 0.5);
      this._put(new THREE.BoxGeometry(0.04, 0.42, L * 0.09), M.void, side * hw * 0.96, hy - 0.34, hz0 + 0.5);
      this._put(new THREE.BoxGeometry(0.04, 0.46, L * 0.14), M.glass, side * hw * 1.0, hy - 0.34, hz1 * 0.5);
      this._put(new THREE.BoxGeometry(0.04, 0.46, L * 0.1), M.glass, side * hw * 1.0, hy - 0.34, hz0 + 0.5);
      // Door aperture in the side of the house.
      this._put(new THREE.BoxGeometry(0.03, 1.0, 0.56), M.trim, side * hw * 1.005, deckY + 0.5, hz0 + 0.42);
      this._rail(0.06, 0.94, side, 0.46, 6);
      // Grab rail along the house roof.
      this._strut([side * hw * 0.8, hy + 0.06, hz0 + 0.1], [side * hw * 0.8, hy + 0.06, hz1 - 0.3], 0.018, M.steel, 5);
    }
    // Roof overhang, mast, radar and the masthead light.
    this._put(new THREE.BoxGeometry(hw * 2.16, 0.07, (hz1 - hz0) + 0.3), M.gel, 0, hy + 0.04, (hz0 + hz1) / 2);
    this._strut([0, hy + 0.06, hz0 + 0.1], [0, hy + 1.25, hz0 - 0.02], 0.05, M.gel, 7);
    this._put(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12), M.gel, 0, hy + 0.92, hz0 + 0.04);
    for (const sx of [-1, 1]) {
      this._strut([0, hy + 0.66, hz0 + 0.06], [sx * 0.6, hy + 0.5, hz0 + 0.06], 0.014, M.steel, 4);
    }
    this._put(new THREE.SphereGeometry(0.07, 8, 6), this.lamps.mast, 0, hy + 1.3, hz0 - 0.02);

    // Cockpit aft: benches down each side, on the sole the hull now has.
    const sole = this.soleY;
    this._put(new THREE.BoxGeometry(T.w * 0.62, 0.04, L * 0.3), M.teak, 0, sole + 0.03, -L * 0.24);
    for (const side of [-1, 1]) {
      this._put(new THREE.BoxGeometry(0.4, 0.1, L * 0.26), M.teak, side * T.w * 0.26, sole + 0.42, -L * 0.24);
      this._put(new THREE.BoxGeometry(0.36, 0.42, L * 0.26), M.gel, side * T.w * 0.26, sole + 0.2, -L * 0.24);
    }
    this._helm(0, deckY, hz1 - 0.42, 1, true);
    this._shaftDrive(1);
  }

  // ----------------------------------------------------------------- yacht

  /** A flybridge motor yacht: saloon, upper helm, radar arch, twin screws. */
  _buildYacht() {
    const T = this.type;
    const M = this.mats;
    const L = T.l;
    const deckY = T.freeboard;
    const hw = T.w * 0.38;

    // --- Saloon: a long lofted superstructure with a raked screen ---------
    const z0 = -L * 0.14, z1 = L * 0.26, hy = deckY + 1.95;
    this._st(loft([
      [[-hw, deckY - 0.05, z0], [hw, deckY - 0.05, z0], [hw * 0.97, hy, z0], [-hw * 0.97, hy, z0]],
      [[-hw * 1.02, deckY - 0.05, (z0 + z1) / 2], [hw * 1.02, deckY - 0.05, (z0 + z1) / 2],
        [hw * 0.99, hy + 0.05, (z0 + z1) / 2], [-hw * 0.99, hy + 0.05, (z0 + z1) / 2]],
      [[-hw * 0.92, deckY - 0.05, z1], [hw * 0.92, deckY - 0.05, z1],
        [hw * 0.72, hy - 0.16, z1 - 0.5], [-hw * 0.72, hy - 0.16, z1 - 0.5]]
    ], { capStart: true, capEnd: true }), M.gel);
    // Wrapped saloon glazing, port and starboard, plus the windscreen.
    for (const side of [-1, 1]) {
      this._put(new THREE.BoxGeometry(0.05, 0.58, L * 0.29), M.void, side * hw * 0.96, hy - 0.5, (z0 + z1) / 2 - 0.2);
      this._put(new THREE.BoxGeometry(0.05, 0.62, L * 0.3), M.glass, side * hw * 1.01, hy - 0.5, (z0 + z1) / 2 - 0.2);
      this._put(new THREE.BoxGeometry(0.05, 0.1, L * 0.3), M.trim, side * hw * 1.02, hy - 0.86, (z0 + z1) / 2 - 0.2);
      // Hull portholes, down in the accommodation.
      for (let i = 0; i < 4; i++) {
        const p = this._hullPoint(0.56 + i * 0.09, 0.86, side);
        this._put(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12), M.glass, p[0] + side * 0.01, p[1], p[2], 0, 0, Math.PI / 2);
        this._put(new THREE.TorusGeometry(0.12, 0.018, 6, 14), M.steel, p[0] + side * 0.02, p[1], p[2], 0, Math.PI / 2, 0);
      }
      // Side decks with rails, all the way to the bow.
      this._rail(0.36, 0.96, side, 0.62, 7);
      // Boarding gate amidships.
      this._put(new THREE.BoxGeometry(0.04, 0.5, 0.7), M.steel, side * hw * 1.05, deckY + 0.3, -L * 0.02);
    }
    this._put(new THREE.BoxGeometry(hw * 1.44, 0.6, 0.04), M.void, 0, hy - 0.44, z1 - 0.45, -0.32);
    this._put(new THREE.BoxGeometry(hw * 1.5, 0.66, 0.05), M.screen, 0, hy - 0.44, z1 - 0.42, -0.32);
    // Saloon door aft, and the aft deck down in the well.
    this._put(new THREE.BoxGeometry(hw * 0.86, 1.26, 0.03), M.void, 0, deckY + 0.62, z0 + 0.02);
    this._put(new THREE.BoxGeometry(hw * 0.9, 1.3, 0.04), M.glass, 0, deckY + 0.62, z0 - 0.02);
    const sole = this.soleY;
    this._put(new THREE.BoxGeometry(T.w * 0.62, 0.04, L * 0.2), M.teak, 0, sole + 0.03, -L * 0.28);
    for (const side of [-1, 1]) {
      this._put(new THREE.BoxGeometry(0.42, 0.14, L * 0.16), M.cushion, side * T.w * 0.26, sole + 0.46, -L * 0.28);
      this._put(new THREE.BoxGeometry(0.42, 0.44, L * 0.16), M.gel, side * T.w * 0.26, sole + 0.22, -L * 0.28);
    }
    // Table in the cockpit, because an empty deck reads as unfinished.
    this._put(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), M.steel, 0, sole + 0.32, -L * 0.28);
    this._put(new THREE.BoxGeometry(0.7, 0.05, 0.5), M.teak, 0, sole + 0.62, -L * 0.28);

    // --- Flybridge --------------------------------------------------------
    const fy = hy + 0.1;
    this._put(new THREE.BoxGeometry(hw * 1.92, 0.1, L * 0.34), M.gel, 0, fy, (z0 + z1) / 2 - 0.1);
    for (const side of [-1, 1]) {
      // Bulwark round the bridge deck.
      this._put(new THREE.BoxGeometry(0.07, 0.56, L * 0.34), M.gel, side * hw * 0.93, fy + 0.3, (z0 + z1) / 2 - 0.1);
    }
    this._put(new THREE.BoxGeometry(hw * 1.86, 0.5, 0.07), M.gel, 0, fy + 0.27, z0 + 0.1);
    this._put(new THREE.BoxGeometry(hw * 1.4, 0.44, 0.06), M.screen, 0, fy + 0.34, z1 - 0.56, -0.3);
    this._helm(hw * 0.4, fy + 0.05, z1 - 0.8, 1.05, true);
    this._put(new THREE.BoxGeometry(hw * 0.9, 0.12, 0.5), M.cushion, -hw * 0.3, fy + 0.45, z1 - 1.3);
    this._put(new THREE.BoxGeometry(hw * 1.2, 0.14, 0.52), M.cushion, 0, fy + 0.45, z0 + 0.6);
    // Radar arch over the bridge, with a dome, whips and the masthead light.
    for (const side of [-1, 1]) {
      this._strut([side * hw * 0.86, fy + 0.1, z0 + 0.3], [side * hw * 0.7, fy + 1.5, z0 + 0.18], 0.06, M.gel, 7);
      this._strut([side * hw * 0.68, fy + 1.55, z0 + 0.18], [side * hw * 0.5, fy + 1.9, z0 + 0.4], 0.02, M.steel, 5);
    }
    this._strut([-hw * 0.7, fy + 1.5, z0 + 0.18], [hw * 0.7, fy + 1.5, z0 + 0.18], 0.06, M.gel, 7);
    this._put(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 14), M.gel, 0, fy + 1.66, z0 + 0.18);
    this._put(new THREE.SphereGeometry(0.08, 8, 6), this.lamps.mast, 0, fy + 1.82, z0 + 0.18);
    // Tender chocked on the aft deck — the detail that gives a yacht scale.
    this._put(new THREE.SphereGeometry(1, 10, 8).scale(0.62, 0.22, 1.25), M.gel, 0, fy + 0.34, z0 - 0.6);
    this._put(new THREE.BoxGeometry(0.9, 0.06, 0.4), M.trim, 0, fy + 0.38, z0 - 0.6);

    this._shaftDrive(2);
  }

  /** Shafts, struts, rudders and screws under the hull. */
  _shaftDrive(count) {
    const T = this.type;
    const M = this.mats;
    const L = T.l;
    const xs = count === 1 ? [0] : [-T.w * 0.18, T.w * 0.18];
    for (const x of xs) {
      const y0 = -T.draft * 0.55, y1 = -T.draft * 0.9;
      this._strut([x, y0, -L * 0.12], [x, y1, -L * 0.46], 0.035, M.steel, 6);
      // P-bracket carrying the shaft.
      this._strut([x, y1 + 0.02, -L * 0.40], [x + Math.sign(x || 1) * 0.16, -T.draft * 0.5, -L * 0.40], 0.022, M.steel, 5);
      const prop = new THREE.Group();
      prop.position.set(x, y1, -L * 0.455);
      this.group.add(prop);
      const r = Math.max(0.16, T.w * 0.08);
      prop.add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.34, 0.16, 8), M.steel).rotateX(-Math.PI / 2));
      for (let b = 0; b < 4; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.5, 0.035), M.steel);
        bl.position.set(Math.cos((b / 4) * Math.PI * 2) * r * 0.75, Math.sin((b / 4) * Math.PI * 2) * r * 0.75, 0);
        bl.rotation.z = (b / 4) * Math.PI * 2;
        bl.rotation.y = 0.55;
        prop.add(bl);
      }
      this.props.push(prop);
      // Rudder behind the screw, on its own stock.
      const rud = new THREE.Group();
      rud.position.set(x, 0, -L * 0.5 + 0.02);
      this.group.add(rud);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, T.draft * 0.62, L * 0.055), M.steel);
      blade.position.set(0, -T.draft * 0.72, -L * 0.02);
      rud.add(blade);
      const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, T.draft * 0.6, 6), M.steel);
      stock.position.y = -T.draft * 0.5;
      rud.add(stock);
      this.rudders = this.rudders || [];
      this.rudders.push(rud);
    }
  }

  // ------------------------------------------------------------- behaviour

  sync() {
    this.group.position.copy(this.position);
    // Same nose-toward-+Z convention as every other vehicle.
    this.group.rotation.set(this.trimPitch || 0, this.yaw + Math.PI, this.roll || 0, 'YXZ');
  }

  get playerDriven() { return this.driver === 'player'; }

  /**
   * @param throttle -1..1
   * @param steerIn  -1..1
   */
  drive(dt, throttle, steerIn) {
    const t = this.type;
    // Ride the actual sea surface under the hull, waves and all.
    const sea = this.city.waterHeightAt
      ? this.city.waterHeightAt(this.position.x, this.position.z)
      : (this.city.seaLevel ?? -0.9);

    // Beached? A hull out of water does nothing but scrape.
    const afloat = this.city.isWater(this.position.x, this.position.z);
    if (!afloat) {
      this.speed *= Math.pow(0.02, dt);
      this.lateral *= Math.pow(0.02, dt);
    } else {
      this.speed += throttle * t.accel * dt;
    }
    this.speed -= this.speed * t.drag * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, -t.topSpeed * 0.35, t.topSpeed);

    // Steering authority comes from THRUST, not speed: a boat under power can
    // pivot almost on the spot, and one coasting barely answers the helm.
    const bite = afloat ? (0.35 + Math.abs(throttle) * 0.65) : 0;
    this.yaw -= steerIn * t.turn * bite * dt * Math.sign(this.speed || 1);

    // No grip: sideways momentum bleeds off slowly, so every turn slides wide.
    this.lateral += steerIn * this.speed * dt * 0.9;
    this.lateral *= Math.pow(0.28, dt);

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.position.x += (fx * this.speed + Math.cos(this.yaw) * this.lateral) * dt;
    this.position.z += (fz * this.speed - Math.sin(this.yaw) * this.lateral) * dt;

    // Keep it in the world.
    const LIM = 2800;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -LIM, LIM);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -LIM, LIM);

    // --- Ride: bob at rest, bow-up under power, roll into the turn ---------
    this._bob += dt;
    const sp = Math.abs(this.speed) / t.topSpeed;
    const swell = Math.sin(this._bob * 1.6) * 0.10 + Math.sin(this._bob * 2.7) * 0.05;
    // The origin is the waterline, so the hull floats by sitting ON the sea —
    // and lifts a little as it comes onto the plane.
    this.position.y = sea + sp * t.draft * 0.35 + swell * (1 - sp * 0.6);
    this.trimPitch = -sp * 0.16 + Math.sin(this._bob * 1.9) * 0.02;
    this.roll = THREE.MathUtils.clamp(-this.lateral * 0.06, -0.35, 0.35)
      + Math.sin(this._bob * 1.3) * 0.02;

    this._animate(dt, steerIn, sp);

    // Wake spray off the stern while moving.
    if (sp > 0.25 && this.game.effects && this.game.effects.burst && Math.random() < dt * 14) {
      _v.set(this.position.x - fx * t.l * 0.5, sea + 0.2, this.position.z - fz * t.l * 0.5);
      this.game.effects.burst(_v, {
        count: 2, color: 0xdff2ff, speed: 2.2 * t.wake, life: 0.4
      });
    }
    // Spray off the bow once it is really moving — a hull throws water sideways
    // off the chine, which is most of what fast on water looks like.
    if (sp > 0.45 && this.game.effects && this.game.effects.burst && Math.random() < dt * 10) {
      const side = Math.random() < 0.5 ? 1 : -1;
      _v.set(
        this.position.x + fx * t.l * 0.34 - fz * side * t.w * 0.5,
        sea + 0.1,
        this.position.z + fz * t.l * 0.34 + fx * side * t.w * 0.5
      );
      this.game.effects.burst(_v, { count: 2, color: 0xeaf6ff, speed: 3.4 * t.wake, life: 0.5 });
    }
    this.sync();
  }

  /** Wheel, rudders and screws follow what the boat is actually doing. */
  _animate(dt, steerIn, sp) {
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 5);
    if (this.helm) this.helm.rotation.z = -this.steer * 2.6;
    if (this.rudders) for (const r of this.rudders) r.rotation.y = -this.steer * 0.5;
    for (const p of this.props) p.rotation.z += dt * (4 + sp * 60);
    if (this.outboard) this.outboard.rotation.y = -this.steer * 0.42;
  }

  /** Moored boats still breathe: they bob, and their screws idle. */
  idle(dt) {
    if (this.driver) return;
    this._bob += dt;
    const sea = this.city.waterHeightAt
      ? this.city.waterHeightAt(this.position.x, this.position.z)
      : (this.city.seaLevel ?? -0.9);
    this.position.y = sea + Math.sin(this._bob * 1.6) * 0.09 + Math.sin(this._bob * 2.7) * 0.045;
    this.trimPitch = Math.sin(this._bob * 1.9) * 0.022;
    this.roll = Math.sin(this._bob * 1.3) * 0.03;
    this.sync();
  }

  damage(n) {
    this.health -= n;
    if (this.health <= 0 && this.alive) {
      this.alive = false;
      const g = this.game;
      if (g.effects && g.effects.burst) {
        g.effects.burst(this.position.clone(), { count: 40, color: 0xffa040, speed: 12, life: 0.9 });
      }
      if (g.audio && g.audio.explosion) g.audio.explosion();
    }
  }

  /** Same signature the cars use, so police fire and collisions reach here. */
  takeDamage(n) { this.damage(n); return n; }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
}

export { HULLS };
