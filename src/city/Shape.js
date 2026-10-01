import * as THREE from 'three';

/**
 * Lofting toolkit — the shared machinery behind every curved vehicle surface.
 *
 * WHY THIS EXISTS. The cars were rebuilt around one idea: a real vehicle is a
 * CROSS-SECTION SWEPT ALONG A LINE, not a pile of boxes. A fuselage is a ring
 * that grows and shrinks from nose to tail; a wing is an aerofoil that tapers,
 * sweeps and twists out to the tip; a boat hull is a deep V forward that warps
 * to a flat run aft. None of those can be faked with primitives — you get the
 * "brick with no doors" look the moment you try — and all three are the same
 * operation with different inputs.
 *
 * So the operation lives here once, and Aircraft, Watercraft and Vehicles all
 * feed it. Everything returns plain BufferGeometry with positions, normals and
 * UVs, so it merges, batches and instances like anything else.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * A curved patch, sampled from a surface function over a u/v grid and turned
 * so it faces the given direction. Door skins, deck panels, shut lines and
 * sills are all built this way, which is what lets them lie ON a curved
 * surface instead of standing off it as flat boxes.
 */
export function gridPatch(cols, rows, pointAt, outward) {
  const pos = [];
  const uv = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      pos.push(...pointAt(i / cols, j / rows));
      uv.push(i / cols, j / rows);
    }
  }
  const W = cols + 1;
  const idx = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const at = (k, v) => v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  at(0, _a);
  _n.subVectors(at(1, _b), _a).cross(_dir.subVectors(at(W, _b), _a));
  if (outward && _n.dot(outward) < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sweep a closed ring of points along a series of stations.
 *
 * `rings` is an array of equal-length arrays of [x, y, z]. Consecutive rings
 * are joined into a tube; the ends can be capped with a fan from their centre,
 * which is what closes off a nose cone or a wingtip.
 *
 * The winding is checked against the sweep direction and flipped if it came
 * out inside-out — the single most common way a lofted surface goes wrong is
 * that half of it culls away and you are left looking through the model.
 */
export function loft(rings, opts = {}) {
  const { capStart = true, capEnd = true, closed = true } = opts;
  if (rings.length < 2) return new THREE.BufferGeometry();
  const N = rings[0].length;
  const pos = [];
  const uv = [];
  for (let s = 0; s < rings.length; s++) {
    const r = rings[s];
    for (let i = 0; i < N; i++) {
      pos.push(r[i][0], r[i][1], r[i][2]);
      uv.push(i / N, s / (rings.length - 1));
    }
  }
  const idx = [];
  const lim = closed ? N : N - 1;
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < lim; i++) {
      const i2 = (i + 1) % N;
      const a = s * N + i, b = s * N + i2, c = a + N, d = b + N;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Caps: a centre vertex per end, fanned out to the ring.
  const cap = (s, flip) => {
    const r = rings[s];
    let cx = 0, cy = 0, cz = 0;
    for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const c = pos.length / 3;
    pos.push(cx / N, cy / N, cz / N);
    uv.push(0.5, 0.5);
    for (let i = 0; i < N; i++) {
      const a = s * N + i, b = s * N + ((i + 1) % N);
      if (flip) idx.push(c, b, a); else idx.push(c, a, b);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(rings.length - 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Sanity: does the surface face outward? Take a vertex on the first ring,
  // compare its normal with its offset from that ring's centre.
  const nrm = geo.attributes.normal;
  const p0 = rings[0], k = (N / 4) | 0;
  let cx = 0, cy = 0, cz = 0;
  for (const p of p0) { cx += p[0]; cy += p[1]; cz += p[2]; }
  _a.set(p0[k][0] - cx / N, p0[k][1] - cy / N, p0[k][2] - cz / N);
  _b.set(nrm.getX(k), nrm.getY(k), nrm.getZ(k));
  if (_a.lengthSq() > 1e-8 && _a.dot(_b) < 0) {
    const ix = geo.index;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t);
    }
    ix.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * A superellipse ring in the XY plane — the cross-section shape for almost
 * every fuselage, hull and boom in the game.
 *
 * `n = 2` is an ellipse, higher is squarer, lower is a pinched diamond. Real
 * airframes are somewhere around 2.2–2.8: round enough to catch a highlight
 * that runs the length of the body, square enough to have a definite side.
 */
export function ellipseRing(segs, rx, ry, { n = 2, cx = 0, cy = 0, z = 0, flatBottom = 0 } = {}) {
  const pts = [];
  const e = 2 / n;
  for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    let x = Math.sign(c) * Math.pow(Math.abs(c), e) * rx;
    let y = Math.sign(s) * Math.pow(Math.abs(s), e) * ry;
    if (flatBottom > 0 && y < 0) y *= 1 - flatBottom * (-y / ry);
    pts.push([cx + x, cy + y, z]);
  }
  return pts;
}

/**
 * NACA-style aerofoil section, as a closed ring in (chord, thickness).
 *
 * Returned points run from the leading edge over the UPPER surface to the
 * trailing edge and back along the lower — the order a loft wants. Cosine
 * spacing bunches points at the leading edge, which is where all the
 * curvature is and where a linear sampling visibly facets.
 *
 * `chordFrac < 1` truncates the section, leaving a blunt tail: that is how a
 * wing makes room for the aileron or flap that hinges onto it.
 */
export function aerofoil(n = 12, T = 0.12, camber = 0.02, chordFrac = 1) {
  const yt = (x) => 5 * T * (0.2969 * Math.sqrt(x) - 0.1260 * x
    - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
  const yc = (x) => camber * (x < 0.4 ? (2 * 0.4 * x - x * x) / 0.16 : ((1 - 2 * 0.4) + 2 * 0.4 * x - x * x) / 0.36);
  const up = [];
  const lo = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI * 0.5)) * chordFrac;
    up.push([x, yc(x) + yt(x)]);
    lo.push([x, yc(x) - yt(x)]);
  }
  // Leading edge once, upper to the tail, lower back — minus the shared ends.
  return [...up, ...lo.slice(1, lo.length - 1).reverse()];
}

/**
 * A wing, fin or stabiliser: an aerofoil lofted out along the span with
 * taper, sweep, dihedral and washout.
 *
 * Built in a local frame where span runs along +X, chord along +Z with the
 * LEADING EDGE toward +Z (the nose convention every vehicle in this game
 * uses), and thickness along Y. `side` of -1 mirrors it for the other wing.
 */
export function wingGeometry(o = {}) {
  const {
    span = 5, rootChord = 1.6, tipChord = 0.8, sweep = 0.35, dihedral = 0.04,
    thick = 0.12, camber = 0.015, twist = -0.05, chordFrac = 1,
    side = 1, stations = 6, segs = 10, rootY = 0, rootZ = 0, tipDrop = 0,
    taperCurve = 1
  } = o;
  const rings = [];
  for (let s = 0; s <= stations; s++) {
    const u = s / stations;
    const chord = rootChord + (tipChord - rootChord) * Math.pow(u, taperCurve);
    const sec = aerofoil(segs, thick, camber, chordFrac);
    const x = side * u * span;
    const y = rootY + dihedral * u * span + tipDrop * u * u;
    const le = rootZ - sweep * u * span;
    const tw = twist * u;
    const ring = sec.map(([c, t]) => {
      // Chord runs back from the leading edge, so +c is toward -Z.
      const cz = -c * chord;
      const ty = t * chord;
      // Twist about the quarter-chord point.
      const qz = cz + chord * 0.25;
      const rz = qz * Math.cos(tw) - ty * Math.sin(tw) - chord * 0.25;
      const ry = qz * Math.sin(tw) + ty * Math.cos(tw);
      return [x, y + ry, le + rz];
    });
    rings.push(side < 0 ? ring.slice().reverse() : ring);
  }
  return loft(rings, { capStart: true, capEnd: true });
}

/**
 * A thin tapered control surface — aileron, flap, elevator, rudder.
 *
 * Six points per ring: a rounded nose at the hinge and a sharp trailing edge,
 * which is exactly what a real surface looks like in section. Built with its
 * HINGE AT THE LOCAL ORIGIN so the mesh can simply be rotated to deflect.
 */
export function surfaceGeometry(o = {}) {
  const {
    span = 2, rootChord = 0.4, tipChord = 0.3, sweep = 0.2, dihedral = 0,
    thick = 0.05, side = 1, stations = 3
  } = o;
  const rings = [];
  for (let s = 0; s <= stations; s++) {
    const u = s / stations;
    const chord = rootChord + (tipChord - rootChord) * u;
    const t = thick * chord * 2;
    const x = side * u * span;
    const y = dihedral * u * span;
    const z = -sweep * u * span;
    const ring = [
      [x, y + t * 0.5, z - chord * 0.06],
      [x, y + t * 0.32, z - chord * 0.45],
      [x, y, z - chord],
      [x, y - t * 0.32, z - chord * 0.45],
      [x, y - t * 0.5, z - chord * 0.06],
      [x, y, z + chord * 0.08]
    ];
    rings.push(side < 0 ? ring.slice().reverse() : ring);
  }
  return loft(rings, { capStart: true, capEnd: true });
}

/**
 * A pipe along a polyline: exhausts, rails, struts, fuel lines, rigging.
 * Frames are built from the segment direction with a fixed up-vector, which
 * is stable for everything that isn't looping the loop.
 */
export function tube(points, radius, segs = 8, taper = null) {
  const rings = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    _dir.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (_dir.lengthSq() < 1e-9) _dir.set(0, 0, 1);
    _dir.normalize();
    _a.copy(Math.abs(_dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : _UP).cross(_dir).normalize();
    _b.copy(_dir).cross(_a).normalize();
    const r = taper ? radius * taper(i / (points.length - 1)) : radius;
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const th = (k / segs) * Math.PI * 2;
      const c = Math.cos(th) * r, s = Math.sin(th) * r;
      ring.push([p[0] + _a.x * c + _b.x * s, p[1] + _a.y * c + _b.y * s, p[2] + _a.z * c + _b.z * s]);
    }
    rings.push(ring);
  }
  return loft(rings, { capStart: true, capEnd: true });
}

/**
 * Sweep a superellipse section along a path — frame spars, swingarms,
 * exhaust cans, chains, limbs. `size` is a number, an [rx, ry] pair, or a
 * function of u (0..1 along the path) returning one. `rx` runs sideways off
 * the path, `ry` up from it, so a forward-running beam that is tall and thin
 * is simply `[0.025, 0.06]`.
 */
export function sweep(points, size, { segs = 8, n = 2, capStart = true, capEnd = true } = {}) {
  const rings = [];
  const Z = new THREE.Vector3(0, 0, 1);
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const prevT = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = 2 / n;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    _dir.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (_dir.lengthSq() < 1e-12) _dir.set(0, 0, 1);
    _dir.normalize();
    // PARALLEL TRANSPORT. The side vector is chosen once, then carried along
    // the path by the same rotation that turns each tangent into the next.
    // Re-deriving it from a fixed up-vector at every point flips it through
    // 180 degrees wherever the path passes vertical — a fender arc, a chain
    // loop, an upright torso — and the loft between the two flipped rings
    // pinches through its own centre.
    if (i === 0) {
      side.copy(Math.abs(_dir.y) > 0.95 ? Z : _UP).cross(_dir).normalize();
    } else {
      q.setFromUnitVectors(prevT, _dir);
      side.applyQuaternion(q);
      side.addScaledVector(_dir, -side.dot(_dir)).normalize();
    }
    prevT.copy(_dir);
    up.copy(_dir).cross(side).normalize();
    const u = points.length > 1 ? i / (points.length - 1) : 0;
    const sz = typeof size === 'function' ? size(u) : size;
    const rx = Array.isArray(sz) ? sz[0] : sz;
    const ry = Array.isArray(sz) ? sz[1] : sz;
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const th = (k / segs) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const a = Math.sign(c) * Math.pow(Math.abs(c), e) * rx;
      const b = Math.sign(s) * Math.pow(Math.abs(s), e) * ry;
      ring.push([
        p[0] + side.x * a + up.x * b,
        p[1] + side.y * a + up.y * b,
        p[2] + side.z * a + up.z * b
      ]);
    }
    rings.push(ring);
  }
  return loft(rings, { capStart, capEnd });
}

/** A smooth path through control points (Catmull-Rom), as [x, y, z] arrays. */
export function curve(points, samples = 16) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return c.getPoints(samples).map((v) => [v.x, v.y, v.z]);
}

/**
 * Point a mesh from a to b. Used everywhere a strut, rail or limb has to run
 * between two known places rather than sit at a known angle.
 */
export function aimMesh(mesh, a, b) {
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  mesh.quaternion.setFromUnitVectors(_UP, _dir);
  return mesh;
}

/** Length of the segment a->b, for sizing the geometry aimMesh will orient. */
export function span(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** Merge geometries that already share a material. Position/normal/uv only. */
export function mergeGeos(geos) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  let vtx = 0;
  for (const g of list) vtx += g.attributes.position.count;
  const pos = new Float32Array(vtx * 3);
  const nor = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const idx = [];
  let vo = 0;
  for (const g of list) {
    const p = g.attributes.position;
    pos.set(p.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index;
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + vo);
    else for (let i = 0; i < p.count; i++) idx.push(i + vo);
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/**
 * A soft radial disc, used for the blur a spinning propeller or rotor leaves
 * behind. Nothing else sells rotation as cheaply: real blades vanish into a
 * translucent disc above a few hundred RPM, and a game that keeps drawing
 * three crisp blades reads as a toy with a windmill on the front.
 */
export function bladeDiscTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // Faint disc, with a brighter ring near the tips where the blade spends
  // most of its area, and a dark hub.
  for (let i = 0; i < 360; i += 2) {
    const a = (i * Math.PI) / 180;
    g.strokeStyle = `rgba(210,220,230,${0.05 + 0.05 * Math.abs(Math.sin(a * 3))})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * S * 0.09, S / 2 + Math.sin(a) * S * 0.09);
    g.lineTo(S / 2 + Math.cos(a) * S * 0.48, S / 2 + Math.sin(a) * S * 0.48);
    g.stroke();
  }
  const ring = g.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.49);
  ring.addColorStop(0, 'rgba(200,215,230,0)');
  ring.addColorStop(0.75, 'rgba(210,225,240,0.30)');
  ring.addColorStop(1, 'rgba(200,215,230,0)');
  g.fillStyle = ring;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
