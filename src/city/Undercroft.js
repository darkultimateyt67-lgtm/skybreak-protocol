import * as THREE from 'three';
import { sweep, gridPatch } from './Shape.js';

/**
 * Undercroft — what stands in the halls.
 *
 * The masonry was already right and the rooms were still empty, which reads
 * as a level rather than a place. Everything here exists to answer one of two
 * questions a player asks on walking in: WHO BUILT THIS, and WHO HAS BEEN
 * HERE SINCE.
 *
 *   The wardens answer the first: inscribed steles, braziers they lit, their
 *   banners, their statues standing round the deep hall, and the sealed gate
 *   they spent four generations holding shut.
 *
 *   The dig answers the second, and answers it in a completely different
 *   material: scaffold tube, crates, rubber cable, work lamps, hazard tape.
 *   Forty years newer than everything around it and already abandoned. That
 *   contrast does more storytelling than any amount of text, because you read
 *   it before you read anything.
 *
 * Every piece is decoration and none of it collides, except the statues and
 * the gate, which are big enough that walking through them would be worse
 * than walking round them. It all goes through the city's static merge.
 */

/** One extra palette per cave, on top of the masonry set. */
export function dressMaterials(base, glow) {
  const c = new THREE.Color(base);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    cloth: std({ color: c.clone().lerp(new THREE.Color(glow), 0.5).multiplyScalar(0.9), roughness: 0.95, side: THREE.DoubleSide }),
    bone: std({ color: 0xcfc6ae, roughness: 0.85 }),
    urn: std({ color: c.clone().multiplyScalar(0.9), roughness: 0.9 }),
    ember: std({ color: 0x2a0f06, emissive: 0xff5a1e, emissiveIntensity: 1.6, roughness: 0.8 }),
    rune: std({ color: 0x0c1014, emissive: glow, emissiveIntensity: 2.1, roughness: 0.6 }),
    // The dig: everything below is deliberately NOT stone.
    rust: std({ color: 0x6b4a33, roughness: 0.92, metalness: 0.35 }),
    steel: std({ color: 0x8b9199, roughness: 0.45, metalness: 0.8 }),
    timber: std({ color: 0x7c5a36, roughness: 0.92 }),
    paper: std({ color: 0xd9d2bd, roughness: 0.95 }),
    rubber: std({ color: 0x1a1c1f, roughness: 0.95 }),
    hazard: std({ color: 0xe8c02a, roughness: 0.8 }),
    lamp: std({ color: 0x1a1a16, emissive: 0xfff0c0, emissiveIntensity: 2.2, roughness: 0.4 })
  };
}

const _q = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

/** A cylinder between two points, baked into world space. */
function rod(w, a, b, r, mat, segs = 7) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r, r, Math.max(0.02, L), segs);
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  _q.setFromUnitVectors(_UP, _d);
  g.applyQuaternion(_q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  w.group.add(m);
  return m;
}

function put(w, geo, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  w.group.add(m);
  return m;
}

/**
 * A brazier the wardens lit: tripod, bowl, coals and a flame. Registered as a
 * torch so it flickers and takes one of the six moving lights when near.
 */
function brazier(cave, x, y, z, rand, mats, M) {
  const w = cave.world;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand();
    rod(w, [x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3], [x, y + 0.95, z], 0.045, mats.bracket, 5);
  }
  put(w, new THREE.CylinderGeometry(0.46, 0.26, 0.34, 14), mats.trim, x, y + 1.1, z);
  put(w, new THREE.CylinderGeometry(0.44, 0.44, 0.06, 14), M.ember, x, y + 1.26, z);
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0x2a1408, emissive: 0xff9a3c, emissiveIntensity: 2.4, roughness: 0.5
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.15, 8), flameMat);
  flame.position.set(x, y + 1.9, z);
  w.group.add(flame);
  cave.torches.push({ mesh: flame, mat: flameMat, phase: rand() * 10 });
}

/** A warden's inscription: plinth, raked slab, carved lines lit from within. */
function stele(cave, x, y, z, face, mats, M) {
  const w = cave.world;
  put(w, new THREE.BoxGeometry(1.15, 0.34, 0.85), mats.trim, x, y + 0.17, z, face);
  const slab = put(w, new THREE.BoxGeometry(1.0, 1.75, 0.2), mats.panel, x, y + 1.2, z, face);
  slab.rotation.x = -0.08;
  // Carved text: a block of ruled lines of uneven length, lit faintly. Read
  // as writing at a glance, which is all a stele has to do from six metres.
  const lines = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const wLine = 0.72 * (i === 0 ? 0.55 : 0.55 + ((i * 37) % 9) / 20);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(wLine, 0.045, 0.02), M.rune);
    bar.position.set(-(0.72 - wLine) / 2, 0.62 - i * 0.16, 0.11);
    lines.add(bar);
  }
  lines.position.set(x, y + 1.2, z);
  lines.rotation.y = face;
  lines.rotation.x = -0.08;
  w.group.add(lines);
  return { x, y: y + 1.2, z };
}

/** The dig's notice board: scaffold legs, a ply board, paper, a clip lamp. */
function digBoard(cave, x, y, z, face, mats, M) {
  const w = cave.world;
  const c = Math.cos(face), s = Math.sin(face);
  for (const off of [-0.55, 0.55]) {
    rod(w, [x + c * off, y, z - s * off], [x + c * off, y + 1.45, z - s * off], 0.035, M.steel, 6);
  }
  put(w, new THREE.BoxGeometry(1.35, 0.95, 0.05), M.timber, x, y + 1.05, z, face);
  for (let i = 0; i < 3; i++) {
    const px = -0.4 + i * 0.4, py = (i % 2) * 0.12;
    const sheet = put(w, new THREE.BoxGeometry(0.34, 0.46, 0.01), M.paper,
      x + c * px + s * 0.04, y + 1.05 + py, z - s * px + c * 0.04, face);
    sheet.rotation.z = (i - 1) * 0.06;
  }
  // A lamp clipped to the top, still burning on whatever the dig left running.
  put(w, new THREE.BoxGeometry(0.22, 0.12, 0.14), M.rust, x + s * 0.08, y + 1.62, z + c * 0.08, face);
  put(w, new THREE.BoxGeometry(0.17, 0.09, 0.02), M.lamp, x + s * 0.15, y + 1.58, z + c * 0.15, face);
  return { x, y: y + 1.1, z };
}

/** A warden banner, hanging in strips where the bottom has rotted away. */
function banner(cave, cx, cz, r, ang, y, M) {
  const w = cave.world;
  const c = Math.cos(ang), s = Math.sin(ang);
  const x = cx + c * (r - 0.35), z = cz + s * (r - 0.35);
  const top = y + 9.2;
  const wide = 1.9;
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    const len = 4.6 - Math.abs(t) * 0.9 - ((i * 13) % 7) * 0.22;
    const geo = gridPatch(1, 5, (u, v) => {
      const off = (u - 0.5) * (wide / 5);
      const px = x - s * (t * (wide / 5) + off) - c * 0.02 * Math.sin(v * 3.3);
      const pz = z + c * (t * (wide / 5) + off) - s * 0.02 * Math.sin(v * 3.3);
      return [px, top - v * len, pz];
    }, new THREE.Vector3(-c, 0, -s));
    const m = new THREE.Mesh(geo, M.cloth);
    w.group.add(m);
  }
  // The rail it hangs from.
  rod(w, [x - s * wide * 0.6, top + 0.1, z + c * wide * 0.6], [x + s * wide * 0.6, top + 0.1, z - c * wide * 0.6], 0.05, M.rust, 6);
}

/** Bones, urns and a fallen column drum — the floor has a history. */
function litter(cave, x, y, z, rand, mats, M) {
  const w = cave.world;
  const kind = rand();
  if (kind < 0.34) {
    // An urn, lidded or spilled.
    const h = 0.5 + rand() * 0.35;
    put(w, new THREE.CylinderGeometry(0.16, 0.24, h, 10), M.urn, x, y + h / 2, z);
    put(w, new THREE.CylinderGeometry(0.2, 0.17, 0.08, 10), mats.trim, x, y + h + 0.03, z);
  } else if (kind < 0.68) {
    // A scatter of bones, no two alike.
    for (let i = 0; i < 4 + ((rand() * 4) | 0); i++) {
      const a = rand() * Math.PI * 2, d = rand() * 0.9;
      const b = put(w, new THREE.CapsuleGeometry(0.035, 0.18 + rand() * 0.3, 3, 6), M.bone,
        x + Math.cos(a) * d, y + 0.05, z + Math.sin(a) * d);
      b.rotation.set(Math.PI / 2, rand() * 3, rand() * 3);
    }
  } else {
    // A drum off a broken column, lying where it fell.
    const drum = put(w, new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), mats.slabDark, x, y + 0.55, z);
    drum.rotation.z = Math.PI / 2;
    drum.rotation.y = rand() * 3;
  }
}

/**
 * The dig camp: where a drilling crew broke into someone else's architecture
 * and set up shop. Scaffold, crates, a generator, cable strung along the wall
 * with work lamps, planks and hazard tape.
 */
export function digCamp(cave, hall, rand, mats, M) {
  const w = cave.world;
  const { x: cx, z: cz, y } = hall;
  const r = hall.radius;
  const a0 = rand() * Math.PI * 2;
  const px = cx + Math.cos(a0) * r * 0.55, pz = cz + Math.sin(a0) * r * 0.55;

  // Scaffold tower: four standards, ledgers every 2 m, diagonal braces, and a
  // boarded lift at the top.
  const S = 1.6, H = 6.5;
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [px + sx * S / 2, pz + sz * S / 2]);
  for (const [lx, lz] of legs) rod(w, [lx, y, lz], [lx, y + H, lz], 0.05, M.steel, 6);
  for (let lev = 1; lev <= 3; lev++) {
    const ly = y + lev * 2.0;
    for (let i = 0; i < 4; i++) {
      const A = legs[i], B = legs[(i + 1) % 4];
      rod(w, [A[0], ly, A[1]], [B[0], ly, B[1]], 0.04, M.steel, 5);
      if (lev < 3) rod(w, [A[0], ly, A[1]], [B[0], ly + 2.0, B[1]], 0.032, M.steel, 5);
    }
  }
  for (let i = 0; i < 4; i++) {
    put(w, new THREE.BoxGeometry(S + 0.3, 0.05, 0.4), M.timber, px, y + H - 0.2, pz - 0.6 + i * 0.4);
  }
  // A ladder up one face.
  rod(w, [px - 0.3, y, pz + S / 2 + 0.25], [px - 0.3, y + H, pz + S / 2 + 0.25], 0.03, M.steel, 5);
  rod(w, [px + 0.3, y, pz + S / 2 + 0.25], [px + 0.3, y + H, pz + S / 2 + 0.25], 0.03, M.steel, 5);
  for (let i = 0; i < 12; i++) {
    rod(w, [px - 0.3, y + 0.5 + i * 0.5, pz + S / 2 + 0.25], [px + 0.3, y + 0.5 + i * 0.5, pz + S / 2 + 0.25], 0.02, M.steel, 4);
  }

  // Crates and drums, stacked the way tired people stack things.
  for (let i = 0; i < 7; i++) {
    const a = a0 + 0.6 + rand() * 2.2;
    const d = r * (0.35 + rand() * 0.4);
    const bx = cx + Math.cos(a) * d, bz = cz + Math.sin(a) * d;
    if (rand() < 0.6) {
      const s = 0.65 + rand() * 0.35;
      const c = put(w, new THREE.BoxGeometry(s, s * 0.8, s * 0.9), M.timber, bx, y + s * 0.4, bz, rand() * 3);
      // Slats, so it is a crate and not a cube.
      for (const sy of [-0.25, 0.25]) {
        put(w, new THREE.BoxGeometry(s + 0.02, 0.05, s * 0.92), M.rust, bx, y + s * 0.4 + sy * s, bz, c.rotation.y);
      }
      if (rand() < 0.4) {
        const s2 = s * 0.8;
        put(w, new THREE.BoxGeometry(s2, s2 * 0.8, s2 * 0.9), M.timber, bx + 0.05, y + s * 0.8 + s2 * 0.4, bz, rand() * 3);
      }
    } else {
      put(w, new THREE.CylinderGeometry(0.29, 0.29, 0.85, 12), M.rust, bx, y + 0.43, bz);
      put(w, new THREE.TorusGeometry(0.3, 0.03, 4, 14), M.rust, bx, y + 0.6, bz).rotation.x = Math.PI / 2;
    }
  }

  // The generator that is somehow still running, and the cable from it.
  const gx = cx + Math.cos(a0 - 0.9) * r * 0.5, gz = cz + Math.sin(a0 - 0.9) * r * 0.5;
  put(w, new THREE.BoxGeometry(1.5, 0.9, 0.85), M.rust, gx, y + 0.45, gz);
  put(w, new THREE.BoxGeometry(1.3, 0.12, 0.7), M.steel, gx, y + 0.95, gz);
  put(w, new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), M.steel, gx + 0.6, y + 1.2, gz);
  // Cable around the wall, sagging between nails, with lamps along it.
  const pts = [];
  const NL = 14;
  for (let i = 0; i <= NL; i++) {
    const a = a0 - 0.9 + (i / NL) * Math.PI * 1.5;
    const sag = Math.sin((i / NL) * Math.PI * 4) * 0.18;
    pts.push([cx + Math.cos(a) * (r - 0.5), y + 3.4 + sag, cz + Math.sin(a) * (r - 0.5)]);
  }
  const cable = new THREE.Mesh(sweep(pts, 0.035, { segs: 5 }), M.rubber);
  w.group.add(cable);
  for (let i = 2; i < NL; i += 4) {
    const p = pts[i];
    put(w, new THREE.BoxGeometry(0.16, 0.2, 0.16), M.rust, p[0], p[1] - 0.22, p[2]);
    const lamp = put(w, new THREE.SphereGeometry(0.11, 10, 8), M.lamp, p[0], p[1] - 0.36, p[2]);
    cave.torches.push({ mesh: lamp, mat: M.lamp, phase: rand() * 10, steady: true });
  }
  // Hazard tape between two posts, across where they stopped digging.
  const ta = a0 + 2.4;
  const tx = cx + Math.cos(ta) * r * 0.5, tz = cz + Math.sin(ta) * r * 0.5;
  for (const side of [-1, 1]) {
    rod(w, [tx - Math.sin(ta) * side * 1.6, y, tz + Math.cos(ta) * side * 1.6],
      [tx - Math.sin(ta) * side * 1.6, y + 1.1, tz + Math.cos(ta) * side * 1.6], 0.03, M.steel, 5);
  }
  for (const hy of [0.75, 1.05]) {
    const tape = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.01), M.hazard);
    tape.position.set(tx, y + hy, tz);
    tape.rotation.y = -ta;
    w.group.add(tape);
  }
  // Planks dropped across the floor.
  for (let i = 0; i < 4; i++) {
    const a = a0 + rand() * 6.28, d = r * (0.2 + rand() * 0.5);
    put(w, new THREE.BoxGeometry(2.2 + rand(), 0.06, 0.24), M.timber,
      cx + Math.cos(a) * d, y + 0.03, cz + Math.sin(a) * d, rand() * 3);
  }
}

/**
 * The deep hall: the wardens standing round their own work, and the gate they
 * were standing round it for.
 */
export function deepHall(cave, hall, rand, mats, M) {
  const w = cave.world;
  const { x: cx, z: cz, y } = hall;
  const r = hall.radius;

  // A ring of warden statues, facing in. Robed, weathered, no faces — the
  // inscriptions say they stopped carving faces after the third generation.
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.2;
    const sx = cx + Math.cos(a) * r * 0.62, sz = cz + Math.sin(a) * r * 0.62;
    put(w, new THREE.BoxGeometry(1.5, 0.45, 1.5), mats.trim, sx, y + 0.22, sz, -a);
    put(w, new THREE.BoxGeometry(1.15, 0.25, 1.15), mats.wall, sx, y + 0.57, sz, -a);
    // The figure: a robe that widens to the floor, shoulders, a bowed head.
    const robe = new THREE.Mesh(sweep([
      [sx, y + 0.7, sz], [sx, y + 1.6, sz], [sx, y + 2.35, sz], [sx, y + 2.75, sz]
    ], (u) => [0.62 - u * 0.2, 0.52 - u * 0.16], { segs: 12, n: 2.4 }), mats.slabDark);
    robe.castShadow = true;
    w.group.add(robe);
    put(w, new THREE.SphereGeometry(0.26, 12, 10), mats.slabDark, sx, y + 2.92, sz);
    // A hood, and hands folded over a staff.
    const hood = put(w, new THREE.SphereGeometry(0.33, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.slab, sx, y + 2.86, sz);
    hood.rotation.x = 0.25;
    rod(w, [sx + Math.cos(a + 1.6) * 0.3, y + 0.7, sz + Math.sin(a + 1.6) * 0.3],
      [sx + Math.cos(a + 1.6) * 0.3, y + 2.5, sz + Math.sin(a + 1.6) * 0.3], 0.05, mats.trim, 6);
    // Only the plinth is solid; you can walk between them.
    cave.world.physics?.addBox(
      new THREE.Vector3(sx, y + 0.35, sz), new THREE.Vector3(1.5, 0.7, 1.5), null, { surface: 'stone' }
    );
  }

  // THE GATE. Set into the far wall, twice a person's height, chained shut,
  // with a seal in the middle that is the same colour as whatever is behind
  // it. Nothing opens it — it is there to be understood, not used.
  const ga = Math.atan2(cz - (cave.chambers[cave.chambers.length - 2] || hall).z,
    cx - (cave.chambers[cave.chambers.length - 2] || hall).x);
  const gx = cx + Math.cos(ga) * (r - 0.9), gz = cz + Math.sin(ga) * (r - 0.9);
  const face = -ga + Math.PI / 2;
  put(w, new THREE.BoxGeometry(7.4, 9.2, 0.7), mats.panel, gx, y + 4.6, gz, face);
  for (const side of [-1, 1]) {
    put(w, new THREE.BoxGeometry(0.8, 9.6, 1.1), mats.trim, gx - Math.sin(face) * 0 + Math.cos(face) * side * 3.6, y + 4.8, gz + Math.sin(face) * side * 3.6, face);
    // Each leaf, with its ring handle.
    put(w, new THREE.BoxGeometry(3.3, 8.2, 0.35), mats.slabDark, gx + Math.cos(face) * side * 1.72 - Math.sin(face) * 0.35, y + 4.2, gz + Math.sin(face) * side * 1.72 + Math.cos(face) * 0.35, face);
    const ring = put(w, new THREE.TorusGeometry(0.42, 0.07, 6, 18), mats.trim,
      gx + Math.cos(face) * side * 0.9 - Math.sin(face) * 0.55, y + 3.6, gz + Math.sin(face) * side * 0.9 + Math.cos(face) * 0.55, face);
    ring.rotation.x = 0;
  }
  put(w, new THREE.BoxGeometry(8.2, 0.9, 1.4), mats.trim, gx, y + 9.4, gz, face);
  // The seal: a disc of rune-light, and the chains across it.
  const seal = put(w, new THREE.CylinderGeometry(1.35, 1.35, 0.12, 24), M.rune,
    gx - Math.sin(face) * 0.5, y + 4.4, gz + Math.cos(face) * 0.5, face);
  seal.rotation.x = Math.PI / 2;
  seal.rotation.z = face;
  for (let i = 0; i < 3; i++) {
    const cy = y + 2.4 + i * 2.1;
    const A = [gx + Math.cos(face) * -3.3 - Math.sin(face) * 0.6, cy + 0.35, gz + Math.sin(face) * -3.3 + Math.cos(face) * 0.6];
    const B = [gx + Math.cos(face) * 3.3 - Math.sin(face) * 0.6, cy + 0.35, gz + Math.sin(face) * 3.3 + Math.cos(face) * 0.6];
    const mid = [(A[0] + B[0]) / 2, cy - 0.15, (A[2] + B[2]) / 2];
    const chain = new THREE.Mesh(sweep([A, mid, B], 0.09, { segs: 6 }), mats.bracket);
    w.group.add(chain);
  }
  // Two braziers flanking it, the last ones anybody lit.
  brazier(cave, gx + Math.cos(face) * 4.6, y, gz + Math.sin(face) * 4.6, rand, mats, M);
  brazier(cave, gx - Math.cos(face) * 4.6, y, gz - Math.sin(face) * 4.6, rand, mats, M);
}

/**
 * Dress one hall: braziers, banners, litter, and whatever inscriptions this
 * ward still has to hand out.
 */
export function dressHall(cave, hall, rand, mats, M, undercity) {
  const { x: cx, z: cz, y } = hall;
  const r = hall.radius;
  const nBraz = hall.deep ? 4 : 2 + ((rand() * 2) | 0);
  for (let i = 0; i < nBraz; i++) {
    const a = (i / nBraz) * Math.PI * 2 + rand() * 0.6;
    brazier(cave, cx + Math.cos(a) * r * 0.55, y, cz + Math.sin(a) * r * 0.55, rand, mats, M);
  }
  for (let i = 0; i < (hall.deep ? 4 : 2); i++) {
    banner(cave, cx, cz, r, rand() * Math.PI * 2, y, M);
  }
  const bits = 3 + ((rand() * 4) | 0);
  for (let i = 0; i < bits; i++) {
    const a = rand() * Math.PI * 2, d = r * (0.25 + rand() * 0.6);
    litter(cave, cx + Math.cos(a) * d, y, cz + Math.sin(a) * d, rand, mats, M);
  }

  // Inscriptions. Spread over the halls rather than dumped in the first one:
  // each hall takes a share of what its ward has left to say.
  if (!undercity) return;
  const left = undercity.remaining(cave.def.id);
  if (left <= 0) return;
  const hallsLeft = Math.max(1, cave.chambers.length - hall.index);
  const take = Math.max(1, Math.round(left / hallsLeft));
  for (let i = 0; i < take; i++) {
    const a = rand() * Math.PI * 2;
    const x = cx + Math.cos(a) * (r - 2.4), z = cz + Math.sin(a) * (r - 2.4);
    // Turn to face the middle of the hall. A mesh's +Z is its front, so the
    // yaw that points it inward from a point at angle `a` is -a - 90 degrees;
    // +90 (the first guess) stands it side-on against the wall with its
    // inscription facing the stone.
    const face = -a - Math.PI / 2;
    const piece = undercity.peek(cave.def.id);
    if (!piece) break;
    const at = piece.kind === 'warden'
      ? stele(cave, x, y, z, face, mats, M)
      : digBoard(cave, x, y, z, face, mats, M);
    undercity.claim(cave.def.id, at.x, at.y, at.z);
  }
}
