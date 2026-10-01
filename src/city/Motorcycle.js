import * as THREE from 'three';
import { loft, ellipseRing, sweep, curve, gridPatch, mergeGeos } from './Shape.js';

/**
 * Motorcycles.
 *
 * A bike is the one vehicle where there is nowhere to hide: no bodywork
 * wraps it, so every mechanical part is on show from every angle. A car can
 * get away with a good shell and dark wheel arches. A motorcycle that is a
 * tank, a seat and two wheels on sticks reads instantly as a toy, because
 * the eye goes looking for the frame, the engine, the pipes, the chain, the
 * brakes and the suspension — and finds nothing.
 *
 * So this builds all of them, in the places they actually are:
 *
 *   - three distinct machines — a faired SPORT bike, a NAKED streetfighter on
 *     a trellis frame, and a V-twin CRUISER — not one model in three colours;
 *   - a real frame, swingarm, rear shock with a coiled spring, chain running
 *     round both sprockets, and a front end that STEERS about its raked axis
 *     with the forks, calipers, mudguard, bars and headlight all going with it;
 *   - round-profile motorcycle tyres (a car tyre is flat across the tread; a
 *     bike tyre is a half-round, and that curve is what it leans on), cast or
 *     laced wheels, drilled floating discs and calipers on every wheel;
 *   - an engine with a crankcase, cylinders, head and cam cover, side covers,
 *     radiator and hoses, and four headers sweeping under it into a silencer;
 *   - a rider posed for the machine — tucked on the sport bike, upright on the
 *     naked, feet-forward on the cruiser — whose arms and legs reach the grips
 *     and pegs by two-bone IK rather than by hand-placed guesses;
 *   - and behaviour: the bike LEANS into corners by the lean angle the turn
 *     actually needs, and a parked bike drops its side stand and rests on it.
 *
 * FRAME: nose toward +Z like every vehicle, y = 0 at the contact patches.
 * Local +X is the bike's LEFT (the group is yawed a half turn), which is why
 * the chain, the side stand and the clutch lever are on +X and the exhaust
 * and rear brake on -X, where they sit on nearly every bike on the road.
 *
 * Every model is generic. Nothing here copies a manufacturer's design or
 * carries anybody's marks.
 */

export const BIKE_MODELS = {
  sport: {
    fz: 0.70, rz: -0.70, rf: 0.31, rr: 0.32, wf: 0.12, wr: 0.19, rimF: 0.216, rimR: 0.216,
    rake: 0.42, forkLen: 0.82, fork: 'usd', wheel: 'cast', engine: 'four', frame: 'spar',
    bars: 'clipon', body: 'faired', pipe: 'side', pivot: [0.135, 0.45, -0.20],
    pegs: [0.17, 0.46, -0.30], grips: [0.33, 0.975, 0.315], shock: 'mono',
    rider: { pelvis: [0, 0.98, -0.25], chest: [0, 1.27, 0.05], head: [0, 1.38, 0.19] }
  },
  naked: {
    fz: 0.71, rz: -0.69, rf: 0.31, rr: 0.32, wf: 0.12, wr: 0.18, rimF: 0.216, rimR: 0.216,
    rake: 0.44, forkLen: 0.84, fork: 'usd', wheel: 'cast', engine: 'four', frame: 'trellis',
    bars: 'tube', body: 'naked', pipe: 'side', pivot: [0.135, 0.45, -0.20],
    pegs: [0.17, 0.42, -0.22], grips: [0.36, 1.13, 0.27], shock: 'mono',
    rider: { pelvis: [0, 0.97, -0.22], chest: [0, 1.40, -0.03], head: [0, 1.58, 0.03] }
  },
  cruiser: {
    fz: 0.86, rz: -0.76, rf: 0.34, rr: 0.32, wf: 0.10, wr: 0.20, rimF: 0.241, rimR: 0.203,
    rake: 0.56, forkLen: 0.92, fork: 'conv', wheel: 'wire', engine: 'twin', frame: 'cradle',
    bars: 'pullback', body: 'cruiser', pipe: 'shotgun', pivot: [0.14, 0.40, -0.22],
    pegs: [0.22, 0.40, 0.50], grips: [0.40, 1.17, 0.20], shock: 'twin',
    rider: { pelvis: [0, 0.80, -0.30], chest: [0, 1.29, -0.34], head: [0, 1.49, -0.30] }
  }
};

const _UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------- textures

const _tex = new Map();

/**
 * A drilled floating brake disc: steel rotor band with a ring of holes, a
 * coloured carrier with cut-outs, and the bobbins that join them. Drawn once
 * per carrier colour, on a disc whose UVs map straight onto the canvas.
 */
function discTexture(carrier) {
  const key = 'disc' + carrier;
  if (_tex.has(key)) return _tex.get(key);
  const S = 256, C = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // Rotor band.
  g.fillStyle = '#b9bec4';
  g.beginPath(); g.arc(C, C, C * 0.99, 0, Math.PI * 2); g.arc(C, C, C * 0.70, 0, Math.PI * 2, true); g.fill();
  // Machining rings, faint.
  g.strokeStyle = 'rgba(90,95,100,0.35)';
  for (let r = 0.73; r < 0.98; r += 0.035) { g.lineWidth = 1; g.beginPath(); g.arc(C, C, C * r, 0, Math.PI * 2); g.stroke(); }
  // Drilled holes, in staggered rows.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r = C * (i % 2 ? 0.80 : 0.89);
    g.beginPath(); g.arc(C + Math.cos(a) * r, C + Math.sin(a) * r, S * 0.012, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // Carrier with six cut-outs.
  g.fillStyle = carrier;
  g.beginPath(); g.arc(C, C, C * 0.70, 0, Math.PI * 2); g.arc(C, C, C * 0.30, 0, Math.PI * 2, true); g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    g.beginPath(); g.ellipse(C + Math.cos(a) * C * 0.5, C + Math.sin(a) * C * 0.5, C * 0.12, C * 0.07, a, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // Bobbins.
  g.fillStyle = '#e8e8e8';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.beginPath(); g.arc(C + Math.cos(a) * C * 0.70, C + Math.sin(a) * C * 0.70, S * 0.016, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _tex.set(key, tex);
  return tex;
}

/** Radiator core: fine vertical fins and horizontal tubes. */
function coreTexture() {
  if (_tex.has('core')) return _tex.get('core');
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#16181b'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#2f3237';
  for (let x = 0; x < 128; x += 3) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 128); g.stroke(); }
  g.fillStyle = '#3a3d42';
  for (let y = 4; y < 128; y += 11) g.fillRect(0, y, 128, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  _tex.set('core', tex);
  return tex;
}

// ----------------------------------------------------------------- helpers

/** Place/rotate a fresh geometry in the frame it will live in. */
function at(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  if (x || y || z) geo.translate(x, y, z);
  return geo;
}

/** A cylinder baked between two points, optionally tapering from r to r2. */
function rod(a, b, r, segs = 8, r2 = r) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r2, r, Math.max(1e-4, L), segs);
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  _q.setFromUnitVectors(_UP, _d);
  g.applyQuaternion(_q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** A rounded capsule between two points — limbs, grips, indicator stalks. */
function capsule(a, b, r, segs = 8) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.005, L - r * 2), 3, segs);
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  _q.setFromUnitVectors(_UP, _d);
  g.applyQuaternion(_q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** Ball joint. */
function ball(p, r, w = 10, h = 8) {
  return at(new THREE.SphereGeometry(r, w, h), p[0], p[1], p[2]);
}

/** Lathe about the X axis — tyres, rims, hubs, covers, headlight buckets. */
function latheX(profile, segs = 32) {
  // Profile is [radius, axial] pairs; LatheGeometry revolves about Y.
  const g = new THREE.LatheGeometry(profile.map(([r, a]) => new THREE.Vector2(r, a)), segs);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Lathe about the Z axis — lamps and cans that face forward or back. */
function latheZ(profile, segs = 24) {
  const g = new THREE.LatheGeometry(profile.map(([r, a]) => new THREE.Vector2(r, a)), segs);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Loft a body panel from a station table of [z, rx, ry, cy]. */
function body(stations, { n = 2.4, segs = 16, flat = 0, capStart = true, capEnd = true, cx = 0 } = {}) {
  return loft(stations.map(([z, rx, ry, cy]) => ellipseRing(segs, rx, ry, { n, cx, cy, z, flatBottom: flat })),
    { capStart, capEnd });
}

/** A gear outline, for sprockets. */
function sprocket(r, teeth, thick) {
  const sh = new THREE.Shape();
  const N = teeth * 2;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = i % 2 ? r : r * 0.9;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  // Lightening holes, so it reads as a machined part rather than a coin.
  if (r > 0.07) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.17, 0, Math.PI * 2, true);
      sh.holes.push(hole);
    }
  }
  const centre = new THREE.Path();
  centre.absarc(0, 0, r * 0.2, 0, Math.PI * 2, true);
  sh.holes.push(centre);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);          // face along X, like the wheel it sits on
  return g;
}

/**
 * Two-bone IK: where the elbow or knee goes, given the two ends, the bone
 * lengths and a hint direction for which way the joint should bend.
 */
function joint(a, b, l1, l2, hint) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const d = Math.min(dir.length(), l1 + l2 - 1e-3);
  dir.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const H = new THREE.Vector3(...hint);
  H.addScaledVector(dir, -H.dot(dir)).normalize();
  const p = A.addScaledVector(dir, x).addScaledVector(H, h);
  return [p.x, p.y, p.z];
}

/**
 * Collects geometry per (parent, material) and merges each bin into a single
 * mesh. A detailed bike is several hundred parts; left as meshes that is
 * several hundred draw calls per bike, times every bike in traffic.
 */
class Kit {
  constructor() { this.bins = new Map(); }
  add(parent, mat, geo) {
    if (!geo) return;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    if (!this.bins.has(parent)) this.bins.set(parent, new Map());
    const m = this.bins.get(parent);
    if (!m.has(mat)) m.set(mat, []);
    m.get(mat).push(geo);
  }
  flush() {
    for (const [parent, byMat] of this.bins) {
      for (const [mat, geos] of byMat) {
        const merged = mergeGeos(geos);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        for (const g of geos) if (g !== merged) g.dispose();
      }
    }
    this.bins.clear();
  }
}

// ------------------------------------------------------------------ builder

/**
 * Build a motorcycle into a Vehicle.
 *
 * @param v     the Vehicle; its group is populated, and wheels, occupants,
 *              eye and bikeSteer are set on it
 * @param M     the vehicle's shared materials: body, accent, chrome, trim,
 *              lamp, tail, plate
 * @param kind  'sport' | 'naked' | 'cruiser'
 * @returns     the rig — lean, stand and steer state, synced every frame
 */
export function buildMotorcycle(v, M, kind = 'sport') {
  const spec = BIKE_MODELS[kind] || BIKE_MODELS.sport;
  const G = v.group;
  const kit = new Kit();
  const put = (mat, geo, parent = G) => kit.add(parent, mat, geo);
  const mirror = (fn) => { fn(1); fn(-1); };

  // --- Materials ---------------------------------------------------------
  const paint = M.body;
  // Panels you can see both sides of — fenders, fairing flanks — get their
  // own double-sided copy of the paint. Everything closed stays single-sided.
  const paint2 = M.body.clone();
  paint2.side = THREE.DoubleSide;
  const accent = M.accent;
  const chrome = M.chrome;
  const plastic = M.trim;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const mat = {
    frame: kind === 'naked'
      ? M.accent
      : std({ color: kind === 'sport' ? 0x8f969e : 0x141518, roughness: kind === 'sport' ? 0.34 : 0.22, metalness: 0.85 }),
    engine: std({ color: 0x1c1e22, roughness: 0.55, metalness: 0.7 }),
    alloy: std({ color: 0xa3a9b0, roughness: 0.3, metalness: 0.92 }),
    rim: std({
      color: kind === 'sport' ? 0x1a1b1e : (kind === 'naked' ? 0x26282c : 0xc9ced4),
      roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide
    }),
    rubber: std({ color: 0x141517, roughness: 0.93, metalness: 0.0 }),
    disc: std({
      map: discTexture(kind === 'sport' ? '#c9a24a' : (kind === 'naked' ? '#1d1f23' : '#cfd4d9')),
      alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.32, metalness: 0.9
    }),
    caliper: std({ color: kind === 'cruiser' ? 0x2a2c30 : (kind === 'sport' ? 0xc9a227 : 0xb3261e), roughness: 0.4, metalness: 0.55 }),
    fork: std({ color: kind === 'cruiser' ? 0xd4d8dd : 0xc9a24a, roughness: 0.15, metalness: 1.0 }),
    chain: std({ color: 0x3b3d42, roughness: 0.45, metalness: 0.9 }),
    spring: std({ color: kind === 'sport' ? 0xd8b21c : (kind === 'naked' ? 0xc0281f : 0xd4d8dd), roughness: 0.4, metalness: 0.5 }),
    seat: std({ color: kind === 'cruiser' ? 0x2a1c14 : 0x141518, roughness: 0.82 }),
    ti: std({ color: 0xb8aa92, roughness: 0.28, metalness: 1.0 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    core: std({ map: coreTexture(), roughness: 0.8, metalness: 0.3 }),
    amber: std({ color: 0x3a2206, emissive: 0xff9a1a, emissiveIntensity: 0.7, roughness: 0.3 }),
    dash: std({ color: 0x06121a, emissive: 0x3ad2ff, emissiveIntensity: 0.9, roughness: 0.3 }),
    screen: new THREE.MeshPhysicalMaterial({
      color: 0x3a4650, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.45,
      clearcoat: 1, side: THREE.DoubleSide, depthWrite: false
    })
  };

  // --- Steering: a head group on the rake, and the steered group inside it
  //
  // The fork axis passes through the front axle, raked back. `head` sits at
  // the bottom yoke, tilted by the rake; `steer` turns about its local Y —
  // which IS the steering axis — so forks, wheel, calipers, bars and lamp
  // all turn together about the line they really turn about. Rotating the
  // front wheel about vertical, as the cars do, is visibly wrong on a bike.
  const { rake, forkLen, fz, rf } = spec;
  const Lb = forkLen - 0.15;                       // axle to bottom yoke
  const cr = Math.cos(rake), sr = Math.sin(rake);
  const bot = [0, rf + Lb * cr, fz - Lb * sr];
  const top = [0, rf + forkLen * cr, fz - forkLen * sr];
  const headC = [0, rf + (forkLen - 0.075) * cr, fz - (forkLen - 0.075) * sr];
  const head = new THREE.Group();
  head.position.set(bot[0], bot[1], bot[2]);
  head.rotation.x = -rake;
  G.add(head);
  const steer = new THREE.Group();
  head.add(steer);
  v.bikeSteer = steer;
  head.updateMatrix();
  const invHead = head.matrix.clone().invert();
  /** Bake a geometry built in the BIKE frame into the steered frame. */
  const S = (geo) => geo.applyMatrix4(invHead);
  // In the steered frame the fork axis is simply +Y, the axle at y = -Lb.

  // --- Wheels --------------------------------------------------------------
  const wheel = (R, W, rimR, front) => {
    const w = new THREE.Group();
    const parent = w;
    // Tyre: a half-round crown, not a flat tread. That profile IS a
    // motorcycle tyre; it is what the bike rolls onto as it leans.
    const h = R - rimR;
    const prof = [
      [rimR + 0.004, -W * 0.40], [rimR + h * 0.30, -W * 0.48], [rimR + h * 0.55, -W * 0.50],
      [R - h * 0.30, -W * 0.49], [R - h * 0.13, -W * 0.42], [R - h * 0.03, -W * 0.26],
      [R, -W * 0.08], [R, W * 0.08], [R - h * 0.03, W * 0.26], [R - h * 0.13, W * 0.42],
      [R - h * 0.30, W * 0.49], [rimR + h * 0.55, W * 0.50], [rimR + h * 0.30, W * 0.48],
      [rimR + 0.004, W * 0.40]
    ];
    put(mat.rubber, latheX(prof, 40), parent);
    // Rim: barrel with flanges, lit both sides so it reads through the spokes.
    put(mat.rim, latheX([
      [rimR + 0.012, -W * 0.44], [rimR - 0.004, -W * 0.46], [rimR - 0.014, -W * 0.40],
      [rimR - 0.018, -W * 0.18], [rimR - 0.018, W * 0.18], [rimR - 0.014, W * 0.40],
      [rimR - 0.004, W * 0.46], [rimR + 0.012, W * 0.44]
    ], 40), parent);
    if (kind === 'sport') {
      // Pinstripe on the rim edge, both sides.
      for (const sx of [-1, 1]) {
        put(accent, at(new THREE.TorusGeometry(rimR + 0.002, 0.0035, 4, 40), sx * W * 0.45, 0, 0, 0, Math.PI / 2, 0), parent);
      }
    }
    // Hub.
    put(mat.alloy, latheX([[0.03, -W * 0.40], [0.055, -W * 0.36], [0.06, -W * 0.1], [0.06, W * 0.1], [0.055, W * 0.36], [0.03, W * 0.40]], 16), parent);
    put(chrome, rod([-W * 0.52, 0, 0], [W * 0.52, 0, 0], 0.012, 8), parent);
    if (spec.wheel === 'cast') {
      // Five split spokes, curving slightly as they run out to the rim.
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        for (const off of [-0.17, 0.17]) {
          const pts = [];
          for (let i = 0; i <= 5; i++) {
            const t = i / 5;
            const r = 0.056 + (rimR - 0.074) * t;
            const ang = a + off * Math.pow(t, 1.3) + 0.06 * Math.sin(t * Math.PI);
            pts.push([0, Math.sin(ang) * r, Math.cos(ang) * r]);
          }
          put(mat.rim, sweep(pts, (u) => [0.016 - 0.005 * u, 0.012 - 0.003 * u], { segs: 6, n: 3 }), parent);
        }
      }
    } else {
      // Laced wire wheel: thirty-six spokes crossing from alternate flanges.
      for (let k = 0; k < 36; k++) {
        const side = k % 2 ? 1 : -1;
        const a = (k / 36) * Math.PI * 2;
        const b = a + side * 0.42;
        put(chrome, rod(
          [side * W * 0.30, Math.sin(a) * 0.055, Math.cos(a) * 0.055],
          [side * W * 0.06, Math.sin(b) * (rimR - 0.016), Math.cos(b) * (rimR - 0.016)], 0.0028, 4), parent);
      }
      for (const sx of [-1, 1]) {
        put(chrome, at(new THREE.CylinderGeometry(0.068, 0.068, 0.008, 18), sx * W * 0.30, 0, 0, 0, 0, Math.PI / 2), parent);
      }
    }
    // Brake discs — drilled, floating, and spinning with the wheel.
    const discs = front ? (kind === 'cruiser' ? [-1] : [-1, 1]) : [-1];
    const dr = front ? (kind === 'cruiser' ? 0.15 : 0.155) : 0.11;
    const dx = front ? 0.065 : 0.07;
    for (const sx of discs) {
      put(mat.disc, at(new THREE.CircleGeometry(dr, 40), sx * dx, 0, 0, 0, Math.PI / 2, 0), parent);
    }
    // The rear sprocket rides on the left of the rear hub.
    if (!front) {
      put(mat.alloy, at(sprocket(0.11, 21, 0.007), 0.078, 0, 0), parent);
    }
    return { group: w, discs, dr, dx };
  };

  // Front wheel lives in the steered frame, at the axle.
  const fw = wheel(rf, spec.wf, spec.rimF, true);
  fw.group.position.set(0, -Lb, 0);
  steer.add(fw.group);
  // Rear wheel in the bike frame.
  const rw = wheel(spec.rr, spec.wr, spec.rimR, false);
  rw.group.position.set(0, spec.rr, spec.rz);
  G.add(rw.group);
  // Both are spin-only handles: steering is the steer group's job, so the
  // generic car code must not also yaw the front wheel.
  v.wheels = [{ mesh: fw.group, front: false }, { mesh: rw.group, front: false }];

  // --- Front end: forks, yokes, calipers, mudguard -----------------------
  const FX = kind === 'cruiser' ? 0.105 : 0.098;
  mirror((sx) => {
    const x = sx * FX;
    if (spec.fork === 'usd') {
      // Upside-down forks: fat outer tubes clamped in the yokes, slim gold
      // stanchions sliding out of them down to the axle.
      put(mat.frame === M.accent ? plastic : mat.engine, rod([x, -Lb + 0.36, 0], [x, 0.19, 0], 0.03, 12), steer);
      put(mat.fork, rod([x, -Lb + 0.05, 0], [x, -Lb + 0.40, 0], 0.0235, 12), steer);
      put(plastic, rod([x, -Lb - 0.035, 0.005], [x, -Lb + 0.08, 0.0], 0.031, 10), steer);
      put(mat.alloy, rod([x, 0.19, 0], [x, 0.205, 0], 0.024, 10), steer);        // preload caps
    } else {
      // Conventional: chrome stanchions above, polished sliders below.
      put(mat.fork, rod([x, -Lb + 0.30, 0], [x, 0.19, 0], 0.021, 12), steer);
      put(chrome, rod([x, -Lb - 0.035, 0.004], [x, -Lb + 0.34, 0], 0.03, 12, 0.027), steer);
    }
    // Front calipers, radially mounted behind each disc.
    if (fw.discs.includes(sx === 1 ? 1 : -1)) {
      const dx = sx * fw.dx;
      // A point on the disc band, behind and a little above the axle in
      // the BIKE frame (angle measured from forward, toward up).
      const ang = (160 * Math.PI) / 180 - rake;          // steered frame
      const rc = fw.dr * 0.8;
      const c = [dx, -Lb + Math.sin(ang) * rc, Math.cos(ang) * rc];
      // Along the disc edge: the tangent to the circle at this angle.
      const t = [0, Math.cos(ang) * 0.055, -Math.sin(ang) * 0.055];
      put(mat.caliper, sweep([[c[0], c[1] - t[1], c[2] - t[2]], [c[0], c[1] + t[1], c[2] + t[2]]],
        [0.026, 0.03], { segs: 8, n: 4 }), steer);
      put(mat.alloy, rod([dx, c[1], c[2]], [x, -Lb + 0.12, -0.01], 0.009, 5), steer);
      put(plastic, rod([x, -Lb + 0.18, 0], [x * 0.4, 0.0, 0.02], 0.004, 4), steer);     // brake line
    }
  });
  // Axle and pinch bolts.
  put(chrome, rod([-FX - 0.02, -Lb, 0], [FX + 0.02, -Lb, 0], 0.013, 8), steer);
  // Yokes: bottom and top, with the steering stem nut.
  const yoke = (y, mt) => put(mt, sweep([[-FX - 0.035, y, 0], [FX + 0.035, y, 0]], [0.045, 0.02], { segs: 10, n: 4 }), steer);
  yoke(0, plastic);
  yoke(0.15, kind === 'cruiser' ? chrome : mat.alloy);
  put(chrome, rod([0, 0.15, -0.01], [0, 0.18, -0.01], 0.02, 8), steer);

  // Front mudguard over the tyre, curved in section, turning with the forks.
  put(paint2, gridPatch(12, 3, (u, vv) => {
    const b = 0.20 + 1.40 * u;                          // local angle along the arc
    const w = vv * 2 - 1;
    const r = rf + 0.022 - 0.016 * w * w;
    return [w * (spec.wf * 0.5 + 0.018), -Lb + Math.sin(b) * r, Math.cos(b) * r];
  }, new THREE.Vector3(0, 1, 0)), steer);

  // --- Frame ---------------------------------------------------------------
  const [pvx, pvy, pvz] = spec.pivot;
  // Headstock tube along the rake, in the bike frame.
  const hs0 = [0, headC[1] - 0.09 * cr, headC[2] + 0.09 * sr];
  const hs1 = [0, headC[1] + 0.09 * cr, headC[2] - 0.09 * sr];
  put(mat.frame, rod(hs0, hs1, 0.042, 12));

  if (spec.frame === 'spar') {
    // Twin aluminium beams from the headstock round the engine to the pivot.
    mirror((sx) => {
      put(mat.frame, sweep(curve([
        [sx * 0.05, headC[1] + 0.02, headC[2] - 0.02], [sx * 0.15, 0.87, 0.24],
        [sx * 0.185, 0.76, 0.04], [sx * 0.175, 0.62, -0.13], [sx * pvx, pvy + 0.02, pvz - 0.01]
      ], 14), (u) => [0.022, 0.062 - 0.012 * u], { segs: 10, n: 4 }));
      // Engine hanger down from the beam.
      put(mat.frame, rod([sx * 0.17, 0.72, 0.18], [sx * 0.16, 0.56, 0.20], 0.018, 6));
    });
  } else if (spec.frame === 'trellis') {
    // Steel trellis: upper and lower rails joined by a lattice of short
    // tubes. The classic naked-bike frame, and the reason its paint is on
    // the frame rather than on the bodywork.
    mirror((sx) => {
      const upper = [
        [sx * 0.05, headC[1] + 0.05, headC[2] - 0.04], [sx * 0.15, 0.93, 0.18],
        [sx * 0.17, 0.88, -0.05], [sx * pvx, 0.72, -0.20]
      ];
      const lower = [
        [sx * 0.05, headC[1] - 0.07, headC[2] + 0.02], [sx * 0.16, 0.74, 0.26],
        [sx * 0.18, 0.62, 0.02], [sx * pvx, pvy + 0.03, pvz]
      ];
      const U = curve(upper, 8), Lw = curve(lower, 8);
      put(mat.frame, sweep(U, 0.014, { segs: 7 }));
      put(mat.frame, sweep(Lw, 0.014, { segs: 7 }));
      for (let i = 0; i < 8; i++) {
        put(mat.frame, rod(U[i], Lw[i + 1], 0.011, 6));
        put(mat.frame, rod(U[i + 1], Lw[i + 1], 0.011, 6));
      }
      put(mat.frame, rod([sx * pvx, 0.72, -0.20], [sx * pvx, pvy + 0.03, pvz], 0.016, 6));
    });
  } else {
    // Cruiser cradle: a backbone under the tank and twin down-tubes that
    // run in front of the engine, under it, and up to the pivot.
    put(mat.frame, sweep(curve([
      [0, headC[1] + 0.04, headC[2] - 0.03], [0, 0.96, 0.18], [0, 0.88, -0.10], [0, 0.72, -0.26]
    ], 10), 0.026, { segs: 10 }));
    mirror((sx) => {
      put(mat.frame, sweep(curve([
        [sx * 0.03, headC[1] - 0.07, headC[2] + 0.02], [sx * 0.08, 0.72, 0.34],
        [sx * 0.10, 0.34, 0.30], [sx * 0.11, 0.15, 0.14], [sx * 0.11, 0.14, -0.14],
        [sx * pvx, pvy, pvz]
      ], 16), 0.02, { segs: 8 }));
      put(mat.frame, rod([0, 0.72, -0.26], [sx * pvx, pvy + 0.04, pvz], 0.018, 6));
    });
  }
  // Rear subframe under the seat and tail.
  if (kind !== 'cruiser') {
    mirror((sx) => {
      put(mat.frame, sweep([[sx * 0.12, 0.76, -0.14], [sx * 0.10, 0.84, -0.46], [sx * 0.07, 0.88, -0.74]], 0.012, { segs: 6 }));
      put(mat.frame, rod([sx * 0.13, 0.54, -0.22], [sx * 0.10, 0.83, -0.52], 0.011, 6));
    });
  }
  // Swingarm pivot bolt.
  put(chrome, rod([-pvx - 0.02, pvy, pvz], [pvx + 0.02, pvy, pvz], 0.014, 8));

  // --- Swingarm --------------------------------------------------------------
  const { rr, rz } = spec;
  mirror((sx) => {
    put(kind === 'cruiser' ? mat.frame : mat.alloy, sweep([
      [sx * pvx, pvy, pvz], [sx * (pvx - 0.005), (pvy + rr) / 2 + 0.01, (pvz + rz) / 2],
      [sx * 0.125, rr, rz + 0.03]
    ], (u) => [0.022, 0.056 - 0.02 * u], { segs: 10, n: 4 }));
    // Chain adjuster block at the axle end.
    put(mat.alloy, at(new THREE.BoxGeometry(0.035, 0.03, 0.06), sx * 0.13, rr, rz + 0.01));
  });
  put(kind === 'cruiser' ? mat.frame : mat.alloy, rod([-pvx + 0.01, pvy - 0.01, pvz - 0.12], [pvx - 0.01, pvy - 0.01, pvz - 0.12], 0.02, 8));
  put(chrome, rod([-0.14, rr, rz], [0.14, rr, rz], 0.013, 8));

  // --- Rear suspension -----------------------------------------------------
  const spring = (A, B, coils, rad) => {
    const ax = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const L = ax.length();
    ax.normalize();
    const a = new THREE.Vector3(1, 0, 0).addScaledVector(ax, -ax.x).normalize();
    const b = ax.clone().cross(a);
    const pts = [];
    const N = coils * 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const s = 0.05 + t * (L - 0.1);
      const th = t * coils * Math.PI * 2;
      pts.push([
        A[0] + ax.x * s + (a.x * Math.cos(th) + b.x * Math.sin(th)) * rad,
        A[1] + ax.y * s + (a.y * Math.cos(th) + b.y * Math.sin(th)) * rad,
        A[2] + ax.z * s + (a.z * Math.cos(th) + b.z * Math.sin(th)) * rad
      ]);
    }
    put(mat.spring, sweep(pts, 0.0065, { segs: 5 }));
    put(kind === 'cruiser' ? chrome : mat.engine, rod(A, B, rad * 0.55, 10));
    put(mat.alloy, ball(A, rad * 0.7, 8, 6));
    put(mat.alloy, ball(B, rad * 0.7, 8, 6));
  };
  if (spec.shock === 'mono') {
    spring([0, pvy - 0.05, pvz - 0.16], [0, 0.74, -0.20], 7, 0.034);
    put(mat.alloy, rod([0.04, 0.70, -0.20], [0.05, 0.62, -0.30], 0.018, 8));         // reservoir
  } else {
    mirror((sx) => spring([sx * 0.155, rr + 0.05, rz + 0.08], [sx * 0.155, 0.78, rz + 0.30], 6, 0.03));
  }

  // --- Final drive: sprockets and a chain that runs round both ---------------
  {
    const C1 = { z: pvz + 0.07, y: pvy - 0.03, r: 0.045 };
    const C2 = { z: rz, y: rr, r: 0.105 };
    const X = 0.078;
    put(mat.engine, at(sprocket(0.045, 15, 0.008), X, C1.y, C1.z));
    const dz = C2.z - C1.z, dy = C2.y - C1.y;
    const d = Math.hypot(dz, dy);
    const th = Math.atan2(dy, dz);
    const beta = Math.acos(THREE.MathUtils.clamp((C1.r - C2.r) / d, -1, 1));
    const aTop = th - beta, aBot = th + beta;
    const pt = (C, a) => [X, C.y + Math.sin(a) * C.r, C.z + Math.cos(a) * C.r];
    const path = [];
    const line = (p, q, n) => { for (let i = 0; i < n; i++) { const t = i / n; path.push([p[0], p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); } };
    line(pt(C1, aTop), pt(C2, aTop), 8);
    for (let i = 0; i < 12; i++) path.push(pt(C2, aTop + ((aBot - aTop) * i) / 12));
    line(pt(C2, aBot), pt(C1, aBot), 8);
    const aEnd = aTop + Math.PI * 2;
    for (let i = 0; i <= 8; i++) path.push(pt(C1, aBot + ((aEnd - aBot) * i) / 8));
    put(mat.chain, sweep(path, kind === 'cruiser' ? [0.012, 0.004] : [0.0075, 0.006], { segs: 6, n: 3 }));
    // Chain guard over the top run.
    if (kind !== 'cruiser') {
      put(plastic, sweep([pt(C1, aTop).map((c, i) => c + [0, 0.03, -0.1][i]), pt(C2, aTop).map((c, i) => c + [0, 0.028, 0.14][i])],
        [0.012, 0.004], { segs: 6, n: 4 }));
    }
  }

  // --- Rear brake: caliper on its hanger, above the disc --------------------
  {
    const a = (115 * Math.PI) / 180;
    const rc = rw.dr * 0.8;
    const c = [-rw.dx, rr + Math.sin(a) * rc, rz + Math.cos(a) * rc];
    const ty = Math.cos(a) * 0.035, tz = -Math.sin(a) * 0.035;
    put(mat.caliper, sweep([[c[0], c[1] - ty, c[2] - tz], [c[0], c[1] + ty, c[2] + tz]], [0.022, 0.026], { segs: 8, n: 4 }));
    put(mat.alloy, rod([c[0] - 0.02, c[1], c[2]], [-0.12, (pvy + rr) / 2, (pvz + rz) / 2 + 0.1], 0.009, 5));
  }

  // --- Engine ----------------------------------------------------------------
  if (spec.engine === 'four') buildFour();
  else buildTwin();

  function buildFour() {
    // Crankcase and gearbox, a rounded block low between the wheels.
    put(mat.engine, body([
      [-0.21, 0.15, 0.09, 0.40], [-0.14, 0.19, 0.13, 0.40], [0.04, 0.205, 0.15, 0.39],
      [0.18, 0.19, 0.13, 0.37], [0.25, 0.13, 0.08, 0.35]
    ], { n: 3.2, segs: 18 }));
    // Sump and oil filter.
    put(mat.engine, body([[-0.08, 0.10, 0.04, 0.23], [0.16, 0.11, 0.045, 0.22]], { n: 4, segs: 12 }));
    put(chrome, rod([0, 0.27, 0.24], [0, 0.22, 0.30], 0.036, 12));
    // Cylinder block, canted forward, with cooling fins.
    const cb0 = [0, 0.50, 0.10], cb1 = [0, 0.70, 0.22];
    put(mat.engine, sweep([cb0, cb1], [0.19, 0.075], { segs: 16, n: 4 }));
    const ax = [cb1[0] - cb0[0], cb1[1] - cb0[1], cb1[2] - cb0[2]];
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const p = [cb0[0] + ax[0] * t, cb0[1] + ax[1] * t, cb0[2] + ax[2] * t];
      const q = [p[0] + ax[0] * 0.03, p[1] + ax[1] * 0.03, p[2] + ax[2] * 0.03];
      put(mat.alloy, sweep([p, q], [0.198, 0.084], { segs: 16, n: 4 }));
    }
    // Head, cam cover and coils.
    const hd = [0, 0.80, 0.28];
    put(mat.alloy, sweep([cb1, hd], [0.2, 0.08], { segs: 16, n: 4 }));
    put(kind === 'sport' ? mat.engine : plastic, sweep([hd, [0, 0.845, 0.305]], [0.185, 0.068], { segs: 16, n: 5 }));
    for (let i = 0; i < 4; i++) {
      put(plastic, rod([-0.12 + i * 0.08, 0.84, 0.30], [-0.12 + i * 0.08, 0.88, 0.32], 0.018, 8));
    }
    put(M.accent, rod([0.13, 0.84, 0.28], [0.13, 0.87, 0.29], 0.014, 8));      // oil filler
    // Clutch cover on the right, stator cover on the left, sprocket cover.
    put(mat.alloy, at(latheX([[0.12, 0], [0.118, 0.018], [0.105, 0.034], [0.07, 0.046], [0.0, 0.05]], 24), -0.19, 0.42, -0.02, 0, 0, Math.PI));
    put(mat.engine, at(latheX([[0.10, 0], [0.098, 0.016], [0.085, 0.03], [0.05, 0.04], [0.0, 0.042]], 22), 0.19, 0.40, 0.08));
    put(mat.alloy, at(new THREE.TorusGeometry(0.075, 0.006, 4, 22), 0.232, 0.40, 0.08, 0, Math.PI / 2, 0));
    put(mat.engine, body([[-0.20, 0.03, 0.05, 0.44], [-0.05, 0.03, 0.07, 0.44]], { n: 3, segs: 10, cx: 0.19 }));
    // Radiator in front of the block, tilted back, with hoses to the engine.
    const rad = new THREE.Group();
    rad.position.set(0, 0.72, 0.42);
    rad.rotation.x = -0.24;
    rad.updateMatrix();
    const radGeo = (geo) => geo.applyMatrix4(rad.matrix);
    put(mat.core, radGeo(at(new THREE.PlaneGeometry(0.38, 0.32), 0, 0, 0.026)));
    put(mat.core, radGeo(at(new THREE.PlaneGeometry(0.38, 0.32), 0, 0, -0.026, 0, Math.PI, 0)));
    put(mat.alloy, radGeo(at(new THREE.BoxGeometry(0.02, 0.34, 0.05), -0.2, 0, 0)));
    put(mat.alloy, radGeo(at(new THREE.BoxGeometry(0.02, 0.34, 0.05), 0.2, 0, 0)));
    put(plastic, radGeo(at(new THREE.BoxGeometry(0.42, 0.02, 0.05), 0, 0.17, 0)));
    put(plastic, radGeo(at(new THREE.BoxGeometry(0.42, 0.02, 0.05), 0, -0.17, 0)));
    put(plastic, radGeo(at(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16), 0, 0, -0.04, Math.PI / 2, 0, 0)));
    put(mat.rubber, sweep(curve([[0.16, 0.57, 0.42], [0.17, 0.48, 0.34], [0.13, 0.44, 0.23]], 6), 0.018, { segs: 6 }));
    put(mat.rubber, sweep(curve([[-0.15, 0.87, 0.37], [-0.13, 0.85, 0.33], [-0.09, 0.81, 0.30]], 6), 0.016, { segs: 6 }));
  }

  function buildTwin() {
    // Crankcase: a wide, polished lump with the gearbox behind it.
    put(mat.engine, body([
      [-0.24, 0.11, 0.08, 0.36], [-0.12, 0.15, 0.12, 0.37], [0.08, 0.16, 0.13, 0.37], [0.22, 0.12, 0.09, 0.35]
    ], { n: 3, segs: 18 }));
    // Two finned cylinders in a V. The fins are what makes an air-cooled
    // twin read as one, so there are plenty of them.
    for (const [lean, zb] of [[0.40, 0.07], [-0.40, -0.07]]) {
      const base = [0, 0.46, zb];
      const dir = [0, Math.cos(lean), Math.sin(lean)];
      const tip = [0, base[1] + dir[1] * 0.34, base[2] + dir[2] * 0.34];
      put(mat.engine, rod(base, tip, 0.07, 16));
      for (let i = 0; i < 10; i++) {
        const t = 0.06 + i * 0.03;
        const c = [0, base[1] + dir[1] * t, base[2] + dir[2] * t];
        const g = new THREE.CylinderGeometry(0.105 - i * 0.002, 0.105 - i * 0.002, 0.008, 18);
        _q.setFromUnitVectors(_UP, _d.set(0, dir[1], dir[2]));
        g.applyQuaternion(_q);
        g.translate(c[0], c[1], c[2]);
        put(mat.alloy, g);
      }
      // Head and rocker box.
      const hc = [0, base[1] + dir[1] * 0.37, base[2] + dir[2] * 0.37];
      put(mat.alloy, rod([0, base[1] + dir[1] * 0.33, base[2] + dir[2] * 0.33], hc, 0.11, 16, 0.1));
      put(chrome, rod(hc, [0, hc[1] + dir[1] * 0.05, hc[2] + dir[2] * 0.05], 0.085, 16, 0.07));
      // Pushrod tube up the right side.
      put(chrome, rod([-0.07, 0.48, zb * 0.3], [-0.07, hc[1] - dir[1] * 0.03, hc[2] - dir[2] * 0.03], 0.012, 6));
    }
    // Primary cover on the left, air cleaner on the right, timing cover.
    {
      const pc = new THREE.SphereGeometry(1, 20, 14);
      pc.scale(0.045, 0.12, 0.22);
      put(chrome, at(pc, 0.15, 0.31, -0.10));
      put(chrome, at(new THREE.TorusGeometry(0.055, 0.01, 6, 18), 0.19, 0.33, 0.02, 0, Math.PI / 2, 0));
    }
    put(chrome, at(latheX([[0.12, 0], [0.12, 0.02], [0.11, 0.04], [0.06, 0.055], [0, 0.058]], 26), -0.12, 0.64, 0.02, 0, 0, Math.PI));
    put(chrome, at(latheX([[0.07, 0], [0.068, 0.02], [0.04, 0.03], [0, 0.032]], 18), -0.16, 0.36, 0.14, 0, 0, Math.PI));
  }

  // --- Exhaust ---------------------------------------------------------------
  if (spec.pipe === 'side') {
    // Four headers off the front of the head, heat-coloured titanium,
    // sweeping down in front of the engine and under it into a collector.
    for (const x of [-0.12, -0.04, 0.04, 0.12]) {
      put(mat.ti, sweep(curve([
        [x, 0.72, 0.30], [x * 0.95, 0.60, 0.36], [x * 0.8, 0.40, 0.37],
        [x * 0.5, 0.21, 0.30], [x * 0.2, 0.15, 0.10], [-0.02, 0.15, -0.04]
      ], 14), 0.021, { segs: 8 }));
    }
    put(mat.ti, sweep(curve([[-0.02, 0.15, -0.04], [-0.10, 0.18, -0.20], [-0.17, 0.30, -0.33]], 8), 0.036, { segs: 10 }));
    // Silencer: an angular can rising toward the tail, with an end cap.
    const can0 = kind === 'sport' ? [-0.18, 0.31, -0.33] : [-0.18, 0.30, -0.33];
    const can1 = kind === 'sport' ? [-0.205, 0.52, -0.76] : [-0.2, 0.44, -0.64];
    put(kind === 'sport' ? mat.carbon : mat.alloy, sweep([can0, can1], (u) => [0.05 + 0.01 * u, 0.07 + 0.01 * u], { segs: 14, n: 3.5 }));
    put(mat.carbon, sweep([can1, [can1[0] - 0.003, can1[1] + 0.02, can1[2] - 0.04]], [0.058, 0.078], { segs: 14, n: 3.5 }));
    put(chrome, rod([can1[0], can1[1] + 0.02, can1[2] - 0.03], [can1[0] - 0.004, can1[1] + 0.03, can1[2] - 0.08], 0.024, 12));
    put(mat.alloy, rod([can1[0], can1[1] + 0.02, can1[2] + 0.12], [-0.09, 0.84, -0.50], 0.008, 5));   // hanger
  } else {
    // Shotgun pipes: two long chrome pipes low along the right side, one
    // from each cylinder, with a heat shield over the front run.
    const f = [-0.06, 0.74, 0.25], r = [-0.06, 0.74, -0.25];
    put(chrome, sweep(curve([f, [-0.14, 0.56, 0.32], [-0.19, 0.32, 0.20], [-0.20, 0.27, -0.25], [-0.20, 0.30, -1.02]], 22), 0.036, { segs: 12 }));
    put(chrome, sweep(curve([r, [-0.16, 0.58, -0.30], [-0.20, 0.44, -0.42], [-0.20, 0.42, -1.00]], 18), 0.036, { segs: 12 }));
    put(chrome, sweep(curve([[-0.15, 0.52, 0.31], [-0.2, 0.33, 0.18], [-0.21, 0.28, -0.1]], 10), 0.044, { segs: 12 }));
  }

  // --- Bodywork --------------------------------------------------------------
  const tailLamp = [];
  if (spec.body === 'faired') buildFaired();
  else if (spec.body === 'naked') buildNaked();
  else buildCruiser();

  function sportSeatAndTail(lowTail = false) {
    // Side covers under the seat.
    put(paint, body([[0.00, 0.13, 0.06, 0.80], [-0.20, 0.15, 0.08, 0.78], [-0.38, 0.14, 0.09, 0.82]], { n: 2.6 }));
    // Rider's seat, a real cushion shape rather than a slab.
    put(mat.seat, body([[0.02, 0.10, 0.03, 0.895], [-0.10, 0.14, 0.04, 0.895], [-0.30, 0.14, 0.04, 0.90], [-0.42, 0.11, 0.035, 0.925]], { n: 3 }));
    // Tail unit rising to a point, with the lamp at the tip.
    const k = lowTail ? 0.7 : 1;
    put(paint, body([
      [-0.36, 0.14, 0.08, 0.84], [-0.50, 0.13, 0.08, 0.88 + 0.02 * k], [-0.66, 0.10, 0.07, 0.92 + 0.04 * k],
      [-0.80, 0.06, 0.05, 0.95 + 0.05 * k], [-0.87, 0.02, 0.02, 0.96 + 0.05 * k]
    ], { n: 2.6 }));
    // Pillion pad.
    put(mat.seat, body([[-0.46, 0.10, 0.028, 0.95 + 0.03 * k], [-0.56, 0.095, 0.028, 0.97 + 0.04 * k], [-0.64, 0.075, 0.024, 0.99 + 0.05 * k]], { n: 3 }));
    tailLamp.push([0, 0.95 + 0.05 * k, -0.84]);
    // Hugger over the rear tyre, off the swingarm.
    put(paint2, gridPatch(8, 2, (u, vv) => {
      const b = 0.55 + 1.25 * u;
      const w = vv * 2 - 1;
      const r = rr + 0.035 - 0.015 * w * w;
      return [w * (spec.wr * 0.5 + 0.012), rr + Math.sin(b) * r, rz + Math.cos(b) * r];
    }, new THREE.Vector3(0, 1, 0)));
    // Number plate hanger, plate, plate lamp and rear indicators.
    put(plastic, sweep([[0, 0.86, -0.70], [0, 0.78, -0.82], [0, 0.66, -0.90]], [0.06, 0.008], { segs: 6, n: 4 }));
    put(M.plate, at(new THREE.BoxGeometry(0.2, 0.14, 0.01), 0, 0.59, -0.925, 0.32, 0, 0));
    mirror((sx) => {
      put(plastic, capsule([sx * 0.04, 0.72, -0.86], [sx * 0.13, 0.73, -0.87], 0.007, 5));
      put(mat.amber, capsule([sx * 0.13, 0.73, -0.87], [sx * 0.17, 0.73, -0.875], 0.016, 8));
    });
  }

  function sportTank(kneeX = 0.12) {
    put(paint, body([
      [-0.04, kneeX, 0.06, 0.90], [0.06, 0.16, 0.09, 0.93], [0.18, 0.19, 0.11, 0.96],
      [0.30, 0.18, 0.10, 0.97], [0.37, 0.12, 0.07, 0.96]
    ], { n: 2.4, flat: 0.5, segs: 18 }));
    put(mat.alloy, at(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16), 0, 1.068, 0.20, 0.12, 0, 0));
    put(plastic, at(new THREE.CylinderGeometry(0.052, 0.052, 0.006, 16), 0, 1.062, 0.20, 0.12, 0, 0));
  }

  function buildFaired() {
    sportTank();
    sportSeatAndTail();
    // Upper fairing: a nose that wraps the headstock and radiator. It is
    // frame-mounted on a sport bike, so it does NOT steer.
    // Pointed and low at the tip, rising and widening back to the screen —
    // a wedge. At n = 2.6 with a fat tip it was a red ball on the front.
    const nose = [
      [0.69, 0.015, 0.015, 0.815], [0.64, 0.09, 0.065, 0.835], [0.57, 0.165, 0.115, 0.84],
      [0.48, 0.215, 0.155, 0.825], [0.37, 0.24, 0.18, 0.795]
    ];
    put(paint2, body(nose, { n: 2.2, segs: 20, capStart: true, capEnd: false }));
    // What the rider sees behind the fairing: black inner panels.
    put(plastic, at(new THREE.CircleGeometry(1, 20).scale(0.24, 0.18, 1), 0, 0.79, 0.365, 0, Math.PI, 0));
    // A point on the nose loft, for things that sit on it.
    const onNose = (z, th, out = 0.006) => {
      let i = 0;
      while (i < nose.length - 2 && z < nose[i + 1][0]) i++;
      const a = nose[i], b = nose[i + 1];
      const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
      const rx = a[1] + (b[1] - a[1]) * t + out, ry = a[2] + (b[2] - a[2]) * t + out, cy = a[3] + (b[3] - a[3]) * t;
      const e = 2 / 2.2;
      const c = Math.sin(th), s = Math.cos(th);
      return [Math.sign(c) * Math.pow(Math.abs(c), e) * rx, cy + Math.sign(s) * Math.pow(Math.abs(s), e) * ry, z];
    };
    // Twin headlights, swept back into the nose, and a ram-air intake.
    mirror((sx) => {
      put(M.lamp, gridPatch(6, 2, (u, vv) => onNose(0.635 - 0.10 * u, sx * (1.28 + 0.26 * vv - 0.18 * u), 0.007), new THREE.Vector3(sx, 0, 1)));
      put(plastic, gridPatch(6, 1, (u, vv) => onNose(0.64 - 0.11 * u, sx * (1.24 + 0.34 * vv - 0.18 * u), 0.004), new THREE.Vector3(sx, 0, 1)));
      put(mat.amber, gridPatch(2, 1, (u, vv) => onNose(0.46 - 0.04 * u, sx * (1.30 + 0.16 * vv), 0.008), new THREE.Vector3(sx, 0, 0)));
    });
    put(plastic, gridPatch(4, 2, (u, vv) => onNose(0.655 - 0.05 * u, Math.PI - 0.55 + 1.1 * vv, 0.005), new THREE.Vector3(0, -0.3, 1)));
    // Windscreen, smoked, curving up and back off the nose.
    put(mat.screen, gridPatch(6, 4, (u, vv) => {
      const w = u * 2 - 1;
      const z = 0.50 - 0.20 * vv;
      const y = 0.99 + 0.17 * vv + 0.02 * (1 - w * w);
      return [w * (0.17 - 0.05 * vv), y, z];
    }, new THREE.Vector3(0, 0.6, 1)));
    // Side fairings down to the belly, with a vent and an accent flash.
    // The flank is a swept shape: its top runs back toward the knee, its
    // trailing edge rakes forward as it drops, and its lower edge climbs
    // toward the back — and it bulges, so it catches a highlight instead of
    // reading as a flat board bolted to the side.
    const flank = (sx, u, vv, out = 0) => {
      const zF = 0.43 - 0.02 * vv;
      const zB = 0.10 + 0.20 * vv;
      const z = zF + (zB - zF) * u;
      const yLo = 0.38 + 0.10 * u;
      const yHi = 0.80 - 0.06 * u;
      const y = yLo + (yHi - yLo) * vv;
      const bulge = 0.022 * Math.sin(Math.PI * vv) * (1 - 0.5 * u);
      return [sx * (0.228 + bulge - 0.03 * u + out), y, z];
    };
    mirror((sx) => {
      put(paint2, gridPatch(10, 6, (u, vv) => flank(sx, u, vv), new THREE.Vector3(sx, 0, 0)));
      // Cooling vent: three raked louvres rather than a painted black square.
      for (let k = 0; k < 3; k++) {
        put(plastic, gridPatch(4, 1, (u, vv) => flank(sx, 0.18 + 0.34 * u, 0.40 + k * 0.10 + 0.05 * vv + 0.04 * u, 0.004),
          new THREE.Vector3(sx, 0, 0)));
      }
      // Accent flash following the lower edge.
      put(accent, gridPatch(8, 1, (u, vv) => flank(sx, 0.05 + 0.85 * u, 0.06 + 0.07 * vv, 0.003), new THREE.Vector3(sx, 0, 0)));
      // Mirrors on the fairing.
      put(plastic, rod([sx * 0.20, 0.99, 0.41], [sx * 0.29, 1.02, 0.39], 0.008, 5));
      put(paint, sweep([[sx * 0.27, 1.03, 0.40], [sx * 0.34, 1.035, 0.385]], [0.028, 0.03], { segs: 10, n: 3 }));
    });
    // Belly pan under the engine.
    put(paint, body([[0.25, 0.12, 0.035, 0.22], [0.14, 0.17, 0.055, 0.195], [0.00, 0.16, 0.05, 0.20], [-0.07, 0.11, 0.035, 0.22]], { n: 2.2 }));
    // Dash behind the screen.
    put(mat.dash, at(new THREE.PlaneGeometry(0.16, 0.09), 0, 1.03, 0.38, 1.0, Math.PI, 0));
    // Clip-on bars, in the steered frame.
    clipOns();
  }

  function clipOns() {
    mirror((sx) => {
      // Built in the bike frame: out from the fork leg to the grip.
      const g = [sx * spec.grips[0], spec.grips[1], spec.grips[2]];
      const base = [sx * FX, top[1] - 0.04 * cr, top[2] + 0.04 * sr];
      put(mat.alloy, S(rod(base, [sx * 0.19, g[1] + 0.012, (base[2] + g[2]) / 2], 0.012, 8)), steer);
      put(mat.alloy, S(rod([sx * 0.19, g[1] + 0.012, (base[2] + g[2]) / 2], g, 0.011, 8)), steer);
      put(mat.rubber, S(capsule([sx * 0.22, g[1] + 0.007, g[2] + 0.018], [g[0] + sx * 0.02, g[1], g[2] - 0.004], 0.017, 8)), steer);
      put(chrome, S(ball([g[0] + sx * 0.035, g[1], g[2] - 0.006], 0.018, 8, 6)), steer);
      levers(sx, g);
    });
  }

  function levers(sx, g) {
    // Brake lever on the right (-X), clutch on the left, each with its
    // switch pod — and the brake fluid reservoir by the right grip.
    const inner = [g[0] - sx * 0.12, g[1], g[2]];
    put(plastic, S(sweep([[inner[0], inner[1] + 0.02, inner[2]], [inner[0] - sx * 0.02, inner[1] + 0.02, inner[2]]], [0.03, 0.028], { segs: 8, n: 3 })), steer);
    put(mat.alloy, S(sweep(curve([
      [inner[0], inner[1], inner[2] + 0.03], [inner[0] + sx * 0.08, inner[1] - 0.005, inner[2] + 0.07], [g[0] + sx * 0.01, g[1] - 0.01, g[2] + 0.06]
    ], 6), [0.006, 0.012], { segs: 6, n: 3 })), steer);
    if (sx < 0) put(plastic, S(rod([inner[0] + 0.02, inner[1] + 0.03, inner[2] - 0.01], [inner[0] + 0.02, inner[1] + 0.07, inner[2] - 0.02], 0.02, 10)), steer);
  }

  function buildNaked() {
    sportTank(0.13);
    sportSeatAndTail(true);
    // Radiator shrouds flaring forward off the tank — the naked bike's
    // signature, and the only bodywork forward of the rider.
    mirror((sx) => {
      put(paint2, gridPatch(6, 4, (u, vv) => {
        const z = 0.40 - 0.20 * u;
        const y = 0.62 + 0.30 * vv + 0.02 * u;
        const w = vv * 2 - 1;
        return [sx * (0.23 - 0.05 * vv * vv - 0.02 * u + 0.01 * (1 - w * w)), y, z - 0.06 * vv];
      }, new THREE.Vector3(sx, 0, 0)));
      put(accent, gridPatch(4, 1, (u, vv) => [sx * (0.235 - 0.02 * u), 0.66 + 0.02 * vv, 0.39 - 0.18 * u], new THREE.Vector3(sx, 0, 0)));
    });
    // Small black belly pan.
    put(plastic, body([[0.30, 0.13, 0.04, 0.17], [0.05, 0.16, 0.055, 0.15], [-0.08, 0.12, 0.04, 0.16]], { n: 3 }));
    // Headlight: a squat LED unit on the forks, with a flyscreen over it and
    // the instrument pod behind — all steered.
    const hl = [0, 0.93, 0.56];
    put(plastic, S(sweep([[hl[0], hl[1], hl[2] - 0.03], [hl[0], hl[1] - 0.01, hl[2] + 0.07]], [0.105, 0.085], { segs: 18, n: 2.6 })), steer);
    put(M.lamp, S(at(new THREE.CircleGeometry(1, 20).scale(0.09, 0.07, 1), hl[0], hl[1] - 0.01, hl[2] + 0.072)), steer);
    put(plastic, S(at(new THREE.TorusGeometry(0.068, 0.006, 4, 20).scale(1.3, 1, 1), hl[0], hl[1] - 0.01, hl[2] + 0.074)), steer);
    put(paint, S(gridPatch(4, 3, (u, vv) => {
      const w = u * 2 - 1;
      return [w * 0.11, hl[1] + 0.08 + 0.10 * vv, hl[2] + 0.02 - 0.08 * vv + 0.01 * (1 - w * w)];
    }, new THREE.Vector3(0, 0.5, 1))), steer);
    put(mat.dash, S(at(new THREE.PlaneGeometry(0.13, 0.08), 0, 1.06, 0.40, 0.9, Math.PI, 0)), steer);
    put(plastic, S(at(new THREE.BoxGeometry(0.15, 0.1, 0.03), 0, 1.06, 0.415, 0.9, 0, 0)), steer);
    mirror((sx) => {
      put(plastic, S(capsule([sx * 0.10, 0.90, 0.54], [sx * 0.16, 0.91, 0.55], 0.007, 5)), steer);
      put(mat.amber, S(capsule([sx * 0.16, 0.91, 0.55], [sx * 0.20, 0.91, 0.555], 0.016, 8)), steer);
    });
    tubeBars(0.06);
  }

  function tubeBars(riseH) {
    // One-piece tubular bar on risers above the top yoke.
    const g = spec.grips;
    const riseY = top[1] + riseH + 0.01;
    mirror((sx) => put(mat.alloy, S(rod([sx * 0.03, top[1], top[2]], [sx * 0.03, top[1] + riseH, top[2] - 0.01], 0.014, 8)), steer));
    const bar = curve([
      [-g[0], g[1], g[2]], [-g[0] * 0.55, riseY + 0.005, g[2] + 0.05], [0, riseY, top[2] + 0.02],
      [g[0] * 0.55, riseY + 0.005, g[2] + 0.05], [g[0], g[1], g[2]]
    ], 16);
    put(kind === 'cruiser' ? chrome : plastic, S(sweep(bar, 0.0125, { segs: 8 })), steer);
    mirror((sx) => {
      const gg = [sx * g[0], g[1], g[2]];
      put(mat.rubber, S(capsule([sx * (g[0] - 0.12), g[1] - 0.002, g[2] + 0.012], [sx * (g[0] + 0.005), g[1], g[2]], 0.018, 8)), steer);
      put(chrome, S(ball([sx * (g[0] + 0.02), g[1], g[2]], 0.017, 8, 6)), steer);
      levers(sx, gg);
      // Mirrors on stalks off the bar.
      const m0 = [sx * (g[0] - 0.13), g[1] + 0.01, g[2] + 0.01];
      const m1 = [sx * (g[0] - 0.05), g[1] + 0.13, g[2] - 0.03];
      put(chrome, S(rod(m0, m1, 0.007, 6)), steer);
      put(plastic, S(sweep([[m1[0] - sx * 0.02, m1[1] + 0.02, m1[2]], [m1[0] + sx * 0.09, m1[1] + 0.03, m1[2] - 0.01]],
        [0.018, 0.042], { segs: 12, n: 2.6 })), steer);
      put(chrome, S(sweep([[m1[0] - sx * 0.015, m1[1] + 0.02, m1[2] - 0.019], [m1[0] + sx * 0.085, m1[1] + 0.03, m1[2] - 0.029]],
        [0.004, 0.034], { segs: 10, n: 2.6 })), steer);
    });
  }

  function buildCruiser() {
    // Teardrop tank, high at the front, with a chrome console and a round
    // speedo set into it.
    put(paint, body([
      [-0.08, 0.11, 0.05, 0.86], [0.04, 0.16, 0.09, 0.90], [0.18, 0.17, 0.10, 0.94],
      [0.30, 0.15, 0.09, 0.97], [0.39, 0.10, 0.06, 0.99]
    ], { n: 2.3, flat: 0.4, segs: 18 }));
    put(chrome, sweep([[0, 1.04, 0.28], [0, 1.045, 0.14], [0, 1.04, -0.02]], [0.034, 0.012], { segs: 10, n: 3 }));
    put(mat.dash, at(new THREE.CircleGeometry(0.036, 18), 0, 1.06, 0.16, -Math.PI / 2 - 0.25, 0, 0));
    put(chrome, at(new THREE.TorusGeometry(0.038, 0.006, 4, 18), 0, 1.06, 0.16, -Math.PI / 2 - 0.25, 0, 0));
    // A low scooped solo seat.
    put(mat.seat, body([
      [-0.06, 0.12, 0.035, 0.80], [-0.18, 0.17, 0.045, 0.77], [-0.32, 0.18, 0.05, 0.775], [-0.44, 0.13, 0.045, 0.82]
    ], { n: 3 }));
    // Side cover over the battery box.
    mirror((sx) => put(paint, body([[-0.02, 0.02, 0.07, 0.60], [-0.24, 0.025, 0.09, 0.62]], { n: 3, cx: sx * 0.13 })));
    // Big valanced fenders front and rear.
    put(paint2, gridPatch(14, 3, (u, vv) => {
      const b = 0.25 + 2.35 * u;
      const w = vv * 2 - 1;
      const r = rr + 0.05 - 0.035 * w * w;
      return [w * (spec.wr * 0.5 + 0.04), rr + Math.sin(b) * r, rz + Math.cos(b) * r];
    }, new THREE.Vector3(0, 1, 0)));
    put(M.tail, at(new THREE.BoxGeometry(0.1, 0.035, 0.03), 0, rr + Math.sin(2.45) * (rr + 0.05) + 0.02, rz + Math.cos(2.45) * (rr + 0.05) - 0.01, -0.8, 0, 0));
    tailLamp.push(null);
    put(M.plate, at(new THREE.BoxGeometry(0.18, 0.12, 0.01), 0, rr + 0.06, rz - rr - 0.07, 0.15, 0, 0));
    mirror((sx) => {
      put(chrome, capsule([sx * 0.13, 0.72, -0.98], [sx * 0.2, 0.72, -0.99], 0.007, 5));
      put(mat.amber, capsule([sx * 0.2, 0.72, -0.99], [sx * 0.24, 0.72, -0.995], 0.018, 8));
      // Leather saddlebags either side of the fender.
      put(mat.seat, body([[-0.52, 0.07, 0.13, 0.64], [-0.62, 0.09, 0.15, 0.63], [-0.84, 0.09, 0.15, 0.63], [-0.94, 0.06, 0.12, 0.65]],
        { n: 3.5, cx: sx * 0.28 }));
      put(chrome, rod([sx * 0.36, 0.72, -0.60], [sx * 0.36, 0.72, -0.86], 0.006, 5));
      // Forward controls.
      put(chrome, rod([sx * 0.10, 0.40, 0.44], [sx * 0.26, 0.40, 0.50], 0.014, 8));
    });
    put(paint2, S(gridPatch(12, 3, (u, vv) => {
      const b = 0.35 + 1.9 * u;
      const w = vv * 2 - 1;
      const r = rf + 0.045 - 0.025 * w * w;
      return [w * (spec.wf * 0.5 + 0.035), rf + Math.sin(b) * r, fz + Math.cos(b) * r];
    }, new THREE.Vector3(0, 1, 0))), steer);
    // Round headlight in a chrome bucket, with spot lamps below it.
    const hl = [0, 1.00, 0.58];
    put(chrome, S(at(latheZ([[0.0, -0.10], [0.06, -0.09], [0.10, -0.05], [0.11, 0.0], [0.112, 0.02]], 24), hl[0], hl[1], hl[2])), steer);
    put(M.lamp, S(at(new THREE.CircleGeometry(0.1, 24), hl[0], hl[1], hl[2] + 0.021)), steer);
    put(chrome, S(at(new THREE.TorusGeometry(0.105, 0.008, 5, 24), hl[0], hl[1], hl[2] + 0.021)), steer);
    mirror((sx) => {
      put(chrome, S(at(latheZ([[0.0, -0.05], [0.045, -0.03], [0.05, 0.0]], 16), sx * 0.13, 0.86, 0.56)), steer);
      put(M.lamp, S(at(new THREE.CircleGeometry(0.045, 16), sx * 0.13, 0.86, 0.561)), steer);
      put(chrome, S(rod([sx * FX, 0.90, 0.47], [sx * 0.13, 0.86, 0.52], 0.01, 5)), steer);
      put(mat.amber, S(capsule([sx * 0.16, 0.97, 0.52], [sx * 0.21, 0.97, 0.53], 0.018, 8)), steer);
    });
    // Pullback bars on tall risers.
    tubeBars(0.09);
  }

  // Tail lamp for the sport and naked bikes, at the tip of the tail.
  for (const p of tailLamp) {
    if (!p) continue;
    put(M.tail, gridPatch(4, 1, (u, vv) => [(u * 2 - 1) * 0.07, p[1] - 0.012 + 0.024 * vv, p[2] - 0.004 * (1 - Math.abs(u * 2 - 1))], new THREE.Vector3(0, 0, -1)));
  }

  // --- Pegs, levers and the side stand ----------------------------------------
  const [pgx, pgy, pgz] = spec.pegs;
  mirror((sx) => {
    if (kind !== 'cruiser') {
      // Rear-set hanger plate, peg, and the gear or brake lever.
      put(mat.alloy, sweep([[sx * 0.14, pgy + 0.12, pgz + 0.10], [sx * 0.145, pgy, pgz], [sx * 0.14, pgy - 0.02, pgz - 0.06]], [0.006, 0.03], { segs: 6, n: 4 }));
      put(mat.alloy, rod([sx * 0.14, pgy, pgz], [sx * (pgx + 0.04), pgy, pgz], 0.011, 8));
      put(mat.rubber, rod([sx * (pgx - 0.02), pgy, pgz], [sx * (pgx + 0.035), pgy, pgz], 0.013, 8));
      put(mat.alloy, sweep([[sx * 0.15, pgy - 0.01, pgz + 0.02], [sx * 0.155, pgy + 0.03, pgz + 0.16], [sx * 0.16, pgy + 0.05, pgz + 0.20]], [0.006, 0.01], { segs: 5, n: 3 }));
    } else {
      put(mat.rubber, rod([sx * (pgx - 0.03), pgy, pgz], [sx * (pgx + 0.04), pgy, pgz], 0.022, 10));
    }
  });
  // Side stand on the LEFT (+X). Kept as a handle: it swings down when the
  // bike is parked and tucks up along the frame the moment it is ridden.
  const stand = new THREE.Group();
  stand.position.set(0.12, kind === 'cruiser' ? 0.32 : 0.36, -0.04);
  G.add(stand);
  const standLen = (kind === 'cruiser' ? 0.32 : 0.36) + 0.02;
  put(mat.engine, rod([0, 0, 0], [0, -standLen, 0.02], 0.013, 6), stand);
  put(mat.engine, at(new THREE.BoxGeometry(0.05, 0.012, 0.07), 0, -standLen, 0.02), stand);

  // --- Rider ----------------------------------------------------------------
  v.occupants = new THREE.Group();
  G.add(v.occupants);
  buildRider(v.occupants, spec, kit, kind);

  kit.flush();

  // Helmet cam: just in front of the visor, so first person on a bike looks
  // down over the bars and the dash rather than out of the rider's chin.
  const hd = spec.rider.head;
  v.eye = new THREE.Vector3(0, hd[1] + 0.02, hd[2] + 0.12);

  return new BikeRig(v, stand, kind);
}

// ------------------------------------------------------------------- rider

function buildRider(grp, spec, kit, kind) {
  const JACKETS = [0x1d2530, 0x5a1f1f, 0x23352a, 0x2b2b31, 0x4a3a22, 0x1f3a5a, 0x3a3f46];
  const HELMETS = [0xe8e8e8, 0x151515, 0xa8231c, 0xe0b52a, 0x2a5fb0, 0x2f2f33];
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const jacket = new THREE.MeshStandardMaterial({ color: pick(JACKETS), roughness: 0.78 });
  const legs = new THREE.MeshStandardMaterial({ color: kind === 'sport' ? 0x17181b : 0x1e2838, roughness: kind === 'sport' ? 0.6 : 0.9 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.65 });
  const helmet = new THREE.MeshPhysicalMaterial({ color: pick(HELMETS), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, roughness: 0.05, metalness: 0.7, clearcoat: 1 });
  const add = (m, g) => kit.add(grp, m, g);

  const R = spec.rider;
  const pelvis = R.pelvis, chest = R.chest, headP = R.head;
  // Torso: a tapered, slightly flattened sweep from hips to shoulders.
  const neckBase = [0, chest[1] + 0.06, chest[2] + (headP[2] - chest[2]) * 0.3];
  add(jacket, sweep(curve([pelvis, [0, (pelvis[1] + chest[1]) / 2, (pelvis[2] + chest[2]) / 2 - 0.02], neckBase], 6),
    (u) => [0.135 + 0.045 * u, 0.092 + 0.016 * Math.sin(u * Math.PI)], { segs: 12, n: 2.6 }));
  add(legs, capsule([-0.1, pelvis[1] - 0.01, pelvis[2]], [0.1, pelvis[1] - 0.01, pelvis[2]], 0.1, 10));
  add(black, rod(neckBase, [headP[0], headP[1] - 0.09, headP[2] - 0.01], 0.05, 8));

  // Helmet: a full-face shell with a visor across the front, a chin bar and
  // a darker neck roll. No face to get wrong.
  const hg = new THREE.SphereGeometry(0.142, 18, 14);
  hg.scale(0.93, 1.0, 1.08);
  add(helmet, at(hg, headP[0], headP[1], headP[2]));
  const vg = new THREE.SphereGeometry(0.148, 16, 8, Math.PI / 2 - 0.85, 1.7, 1.18, 0.52);
  vg.scale(0.93, 1.0, 1.08);
  add(visor, at(vg, headP[0], headP[1], headP[2]));
  add(black, at(new THREE.TorusGeometry(0.105, 0.03, 6, 16), headP[0], headP[1] - 0.105, headP[2] - 0.01, Math.PI / 2, 0, 0));
  if (kind === 'sport') add(helmet, sweep([[0, headP[1] + 0.09, headP[2] - 0.13], [0, headP[1] + 0.06, headP[2] - 0.17]], [0.06, 0.018], { segs: 8, n: 3 }));

  for (const sx of [-1, 1]) {
    // Arms: shoulder to grip, elbow placed by IK and bent out and down.
    const sh = [sx * 0.185, chest[1] + 0.02, chest[2]];
    const grip = [sx * spec.grips[0], spec.grips[1] + 0.02, spec.grips[2]];
    const el = joint(sh, grip, 0.30, 0.30, [sx * 0.8, -0.6, -0.1]);
    add(jacket, ball(sh, 0.058));
    add(jacket, capsule(sh, el, 0.049));
    add(jacket, ball(el, 0.045));
    add(jacket, capsule(el, grip, 0.041));
    add(black, sweep([[grip[0] - sx * 0.05, grip[1], grip[2]], [grip[0] + sx * 0.035, grip[1], grip[2]]], [0.042, 0.036], { segs: 10, n: 2.6 }));
    // Legs: hip to peg, knee by IK — tucked in on the sport bike, pushed
    // forward and out on the cruiser.
    const hip = [sx * 0.1, pelvis[1] - 0.02, pelvis[2] + 0.02];
    const foot = [sx * (spec.pegs[0] + 0.01), spec.pegs[1] + 0.04, spec.pegs[2] + 0.01];
    const knee = joint(hip, foot, 0.45, 0.46, [sx * 0.45, 0.25, 1]);
    add(legs, capsule(hip, knee, 0.068));
    add(legs, ball(knee, 0.056));
    add(legs, capsule(knee, foot, 0.05));
    // Boot on the peg, toe forward.
    add(black, sweep([[foot[0], foot[1] - 0.01, foot[2] - 0.08], [foot[0], foot[1] - 0.02, foot[2] + 0.04], [foot[0], foot[1] - 0.035, foot[2] + 0.12]],
      [0.045, 0.05], { segs: 10, n: 3 }));
  }
}

// --------------------------------------------------------------------- rig

/**
 * Per-frame state for a motorcycle: lean and side stand.
 *
 * LEAN comes from the turn the bike is actually making. A bike going round a
 * bend of radius r at speed v has to lean by atan(v^2 / (g r)) — equivalently
 * atan(v * yawRate / g) — or it falls over. Reading the yaw rate off the real
 * heading change, rather than off steering input, means player bikes and
 * traffic bikes lean identically and by the right amount, and a bike braking
 * in a straight line stays upright however hard the bars are turned.
 */
class BikeRig {
  constructor(v, stand, kind) {
    this.v = v;
    this.stand = stand;
    this.kind = kind;
    this.lean = -0.13;
    this.standT = 1;
    this._t = 0;
    this._yaw = v.yaw;
    this._apply();
  }

  sync(v) {
    const now = performance.now();
    if (!this._t) { this._t = now; this._yaw = v.yaw; }
    const el = (now - this._t) / 1000;
    // Several calls a frame come through here; only integrate on a real step.
    if (el > 0.01) {
      let dy = v.yaw - this._yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const omega = dy / Math.min(el, 0.1);
      this._t = now;
      this._yaw = v.yaw;
      const parked = !v.driver && Math.abs(v.speed) < 0.4;
      // Positive rotation raises the LEFT side (+X), i.e. leans right; a
      // right turn is a falling yaw. Parked, it rests on the stand to the left.
      const target = parked
        ? -0.13
        : THREE.MathUtils.clamp(Math.atan((v.speed * -omega) / 9.81), -0.8, 0.8);
      const k = 1 - Math.exp(-Math.min(el, 0.1) * (parked ? 3.5 : 6));
      this.lean += (target - this.lean) * k;
      const sk = 1 - Math.exp(-Math.min(el, 0.1) * 6);
      this.standT += ((parked ? 1 : 0) - this.standT) * sk;
    }
    this._apply();
  }

  _apply() {
    const v = this.v;
    v.group.rotation.set(0, v.yaw + Math.PI, this.lean, 'YXZ');
    const t = this.standT;
    // Down and splayed out when parked; swung back along the frame when not.
    this.stand.rotation.set((1 - t) * 1.45, 0, t * 0.38 + (1 - t) * 0.05);
  }
}
