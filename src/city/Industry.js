import * as THREE from 'three';
import { sweep } from './Shape.js';

/**
 * Industry — the working edges of the city: the docks, the airfield apron and
 * the marina.
 *
 * All three were named districts that had nothing in them but the ordinary
 * building generator. A port is not warehouses near water; it is the STUFF —
 * containers stacked four high, gantry cranes on rails, bollards with rope
 * still on them, a coaster tied up alongside, floodlight masts, a fence with
 * a gate. An airfield is not a strip of tarmac; it is taxiway paint, a
 * windsock, edge lights, a fuel bowser and a tug parked where the last crew
 * left it. A marina is not three jetties; it is cleats, fuel pumps, a
 * harbourmaster's hut, boats up on cradles and life rings on posts.
 *
 * Everything is placed by hand against the district's own geometry, and all
 * of it is static, so the city's merge folds it into the existing batches.
 * Repeated objects (containers, edge lights, cleats) go through instancing.
 */

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

function mats() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    concrete: std({ color: 0xb2ada2, roughness: 0.92 }),
    concreteDark: std({ color: 0x8b8880, roughness: 0.95 }),
    steel: std({ color: 0x7f868d, roughness: 0.45, metalness: 0.8 }),
    paintedSteel: std({ color: 0xd8621f, roughness: 0.6, metalness: 0.4 }),
    yellow: std({ color: 0xd8ae1c, roughness: 0.6, metalness: 0.3 }),
    rust: std({ color: 0x7a4a30, roughness: 0.95, metalness: 0.2 }),
    timber: std({ color: 0x7a5c3a, roughness: 0.94 }),
    dark: std({ color: 0x2a2e33, roughness: 0.7, metalness: 0.4 }),
    black: std({ color: 0x15171a, roughness: 0.9 }),
    white: std({ color: 0xdcdcd6, roughness: 0.7 }),
    paint: std({ color: 0xe6e2d2, roughness: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x2b3a44, roughness: 0.06, metalness: 0.2, clearcoat: 1
    }),
    lamp: std({ color: 0x24241c, emissive: 0xfff0c8, emissiveIntensity: 2.0, roughness: 0.4 }),
    green: std({ color: 0x2f6b46, roughness: 0.8 }),
    red: std({ color: 0xa8231c, roughness: 0.8 }),
    net: std({ color: 0x6d747a, roughness: 0.8, metalness: 0.5, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  };
}

/** A cylinder between two points. */
function rod(w, a, b, r, mat, segs = 8) {
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

function put(w, geo, mat, x, y, z, ry = 0, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  w.group.add(m);
  return m;
}

/** A flat painted marking lying on the ground. */
function mark(w, mat, x, y, z, sx, sz, ry = 0) {
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.receiveShadow = true;
  w.group.add(m);
  return m;
}

/** A chain-link run: posts, top rail and a translucent mesh panel. */
function fence(w, M, ax, az, bx, bz, h = 2.4, gap = 8) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / gap));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    rod(w, [ax + (bx - ax) * t, 0, az + (bz - az) * t], [ax + (bx - ax) * t, h, az + (bz - az) * t], 0.05, M.steel, 6);
  }
  rod(w, [ax, h - 0.05, az], [bx, h - 0.05, bz], 0.04, M.steel, 6);
  const panel = new THREE.PlaneGeometry(len, h - 0.15);
  const m = new THREE.Mesh(panel, M.net);
  m.position.set((ax + bx) / 2, (h - 0.15) / 2 + 0.1, (az + bz) / 2);
  m.rotation.y = -Math.atan2(bz - az, bx - ax);
  w.group.add(m);
}

/** A floodlight mast: lattice column and a head of lamps. */
function floodMast(w, M, x, z, h = 16, aim = 0) {
  rod(w, [x, 0, z], [x, h, z], 0.22, M.steel, 8);
  for (let i = 1; i < 5; i++) {
    const y = (h / 5) * i;
    rod(w, [x - 0.5, y, z], [x + 0.5, y, z], 0.05, M.steel, 5);
    rod(w, [x, y, z - 0.5], [x, y, z + 0.5], 0.05, M.steel, 5);
  }
  put(w, new THREE.BoxGeometry(2.6, 0.2, 0.9), M.steel, x, h + 0.2, z, aim);
  for (let i = -1; i <= 1; i++) {
    put(w, new THREE.BoxGeometry(0.7, 0.5, 0.25), M.dark, x + Math.cos(aim) * i * 0.9, h + 0.55, z - Math.sin(aim) * i * 0.9, aim, 0.4);
    put(w, new THREE.BoxGeometry(0.6, 0.4, 0.04), M.lamp, x + Math.cos(aim) * i * 0.9, h + 0.42, z - Math.sin(aim) * i * 0.9 + 0.12, aim, 0.4);
  }
}

// ------------------------------------------------------------------- docks

/**
 * IRONSIDE DOCKS. A concrete quay along the shoreline, two piers running out
 * to deeper water, gantry cranes on rails, a container yard behind and a
 * coaster tied up alongside.
 */
function buildDocks(city, M) {
  const w = city.world;
  const rand = city.rand;
  const shore = city.shore;
  const sea = city.seaLevel ?? -0.9;
  const QY = 2.0;                            // quay deck height
  // Footprint fixed by the City before the seabed was built, because the
  // harbour in front of it is dredged to match.
  const plan = city.docksPlan || { x: shore + 6, z0: 150, z1: 690 };
  const z0 = plan.z0, z1 = plan.z1;
  const qx = plan.x;                         // quay face, at the water's edge

  // --- Quay deck on piles ---------------------------------------------------
  w._block(54, 0.9, z1 - z0, qx - 20, QY - 0.9, (z0 + z1) / 2, M.concrete, { surface: 'stone' });
  for (let z = z0 + 6; z < z1; z += 12) {
    for (const px of [qx - 2, qx - 18, qx - 38]) {
      rod(w, [px, sea - 3.5, z], [px, QY - 0.9, z], 0.35, M.concreteDark, 7);
    }
  }
  // Fender line and a rubbing strake of old tyres along the face.
  w._block(0.7, 1.5, z1 - z0, qx + 0.35, QY - 1.4, (z0 + z1) / 2, M.concreteDark, { collide: false });
  for (let z = z0 + 4; z < z1; z += 9) {
    const t = put(w, new THREE.TorusGeometry(0.55, 0.16, 6, 14), M.black, qx + 0.6, QY - 1.0, z, 0);
    t.rotation.y = Math.PI / 2;
  }
  // Bollards, with rope on the ones a ship is tied to.
  for (let z = z0 + 10; z < z1; z += 16) {
    put(w, new THREE.CylinderGeometry(0.28, 0.36, 0.95, 12), M.black, qx - 2.2, QY, z);
    put(w, new THREE.SphereGeometry(0.3, 10, 8), M.black, qx - 2.2, QY + 0.95, z);
  }
  // Painted edge line and hazard chevrons at the crane rails.
  mark(w, M.yellow, qx - 3.6, QY + 0.02, (z0 + z1) / 2, 0.35, z1 - z0);
  for (const rx of [qx - 8, qx - 30]) {
    w._block(0.5, 0.18, z1 - z0, rx, QY, (z0 + z1) / 2, M.steel, { collide: false });
  }

  // --- Two gantry cranes on the rails --------------------------------------
  const gantry = (gz) => {
    const legs = [[qx - 8, gz - 7], [qx - 8, gz + 7], [qx - 30, gz - 7], [qx - 30, gz + 7]];
    const H = 26;
    for (const [lx, lz] of legs) {
      rod(w, [lx, QY, lz], [lx, H, lz], 0.5, M.paintedSteel, 8);
      for (let i = 1; i < 4; i++) {
        const y = QY + (H - QY) * (i / 4);
        rod(w, [lx, y, lz], [lx + (lx < qx - 20 ? 22 : -22), y + (H - QY) / 4, lz], 0.16, M.paintedSteel, 5);
      }
    }
    // Portal beam across, and the boom reaching out over the water.
    for (const lz of [gz - 7, gz + 7]) {
      w._block(30, 1.8, 1.6, qx - 19, H, lz, M.paintedSteel, { collide: false });
      rod(w, [qx - 8, H + 1.8, lz], [qx + 26, H + 1.0, lz], 0.45, M.paintedSteel, 7);
      rod(w, [qx - 30, H + 1.8, lz], [qx - 46, H + 1.4, lz], 0.4, M.paintedSteel, 7);
      // Stays from the top of the A-frame down to the boom.
      rod(w, [qx - 19, H + 9, lz], [qx + 24, H + 1.1, lz], 0.12, M.steel, 5);
      rod(w, [qx - 19, H + 9, lz], [qx - 44, H + 1.4, lz], 0.12, M.steel, 5);
    }
    rod(w, [qx - 19, H + 1.8, gz - 7], [qx - 19, H + 9, gz], 0.35, M.paintedSteel, 6);
    rod(w, [qx - 19, H + 1.8, gz + 7], [qx - 19, H + 9, gz], 0.35, M.paintedSteel, 6);
    // Trolley and spreader hanging on its wires.
    const tx = qx + 6 + rand() * 12;
    w._block(3.4, 1.4, 4.2, tx, H + 0.4, gz, M.dark, { collide: false });
    for (const sx of [-1.3, 1.3]) {
      rod(w, [tx + sx, H + 0.4, gz - 1.6], [tx + sx, QY + 9, gz - 1.6], 0.05, M.black, 4);
      rod(w, [tx + sx, H + 0.4, gz + 1.6], [tx + sx, QY + 9, gz + 1.6], 0.05, M.black, 4);
    }
    w._block(2.6, 0.9, 12.5, tx, QY + 8.2, gz, M.yellow, { collide: false });
    // Machinery house and the operator's cab under the beam.
    w._block(5, 3.4, 6, qx - 30, H + 1.8, gz, M.white, { collide: false });
    w._block(2.6, 2.4, 2.8, qx - 10, H - 3.4, gz + 5, M.white, { collide: false });
    w._block(2.2, 1.4, 2.4, qx - 10, H - 2.6, gz + 5, M.glass, { collide: false });
  };
  gantry(z0 + 150);
  gantry(z0 + 340);

  // --- Container yard -------------------------------------------------------
  // One instanced box per colour, four high, in rows with service lanes.
  const COLS = [0xb03a2e, 0x1f6b8a, 0x2f7d4f, 0xb5892a, 0x7a4a8a, 0x8d9296];
  const boxGeo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
  // Corrugation: shallow ribs down the long sides, so a container is not a box.
  const ribGeo = new THREE.BoxGeometry(12.2, 2.4, 0.06);
  const stacks = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 14; col++) {
      if (rand() < 0.18) continue;
      const bx = qx - 52 - row * 14.5;
      const bz = z0 + 40 + col * 13.4 + (row % 2) * 2;
      const high = 1 + ((rand() * 4) | 0);
      for (let k = 0; k < high; k++) {
        stacks.push({ x: bx, y: 2.2 + k * 2.62, z: bz, c: COLS[(rand() * COLS.length) | 0], r: rand() < 0.5 ? 0 : Math.PI });
      }
    }
  }
  const im = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.25 }), stacks.length);
  const rim = new THREE.InstancedMesh(ribGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.3 }), stacks.length * 2);
  let ri = 0;
  stacks.forEach((s, i) => {
    _q.setFromAxisAngle(_UP, s.r);
    _m4.compose(_p.set(s.x, s.y, s.z), _q, _s.set(1, 1, 1));
    im.setMatrixAt(i, _m4);
    _c.setHex(s.c);
    im.setColorAt(i, _c);
    for (const off of [-1.24, 1.24]) {
      _m4.compose(_p.set(s.x, s.y, s.z + off), _q, _s.set(1, 1, 1));
      rim.setMatrixAt(ri, _m4);
      rim.setColorAt(ri, _c.multiplyScalar(0.86));
      ri++;
      _c.setHex(s.c);
    }
  });
  rim.count = ri;
  for (const m of [im, rim]) { m.castShadow = true; m.receiveShadow = true; w.group.add(m); }
  // Ground under the yard: concrete hardstanding.
  w._block(78, 0.3, z1 - z0 - 30, qx - 78, 1.7, (z0 + z1) / 2, M.concreteDark, { surface: 'stone' });

  // --- A coaster tied up alongside ------------------------------------------
  const sz = z0 + 250, L = 96, B = 15;
  const hull = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // Full amidships, fine at the bow, square at the transom.
    const beam = B * 0.5 * (t < 0.72 ? 1 : Math.pow(1 - (t - 0.72) / 0.28, 0.6));
    const keel = sea - 4.2 * (t < 0.8 ? 1 : Math.pow(1 - (t - 0.8) / 0.2, 1.4));
    const sheer = 4.6 + t * 1.4;
    const zz = sz - L / 2 + t * L;
    hull.push([
      [qx + 3 + 0, keel, zz], [qx + 3 + beam * 0.35, keel + 0.6, zz], [qx + 3 + beam, sea + 0.6, zz],
      [qx + 3 + beam, sheer, zz], [qx + 3 - beam, sheer, zz], [qx + 3 - beam, sea + 0.6, zz],
      [qx + 3 - beam * 0.35, keel + 0.6, zz]
    ]);
  }
  const hullGeo = (() => {
    const rings = hull;
    const N = rings[0].length;
    const pos = [], idx = [];
    rings.forEach((r) => r.forEach((p) => pos.push(...p)));
    for (let s = 0; s < rings.length - 1; s++) {
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        const a = s * N + i, b = s * N + j, c = a + N, d2 = b + N;
        idx.push(a, b, c, b, d2, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const ship = new THREE.Mesh(hullGeo, M.rust);
  ship.castShadow = true;
  w.group.add(ship);
  // Deck, hatches, superstructure aft, funnel and a deck crane.
  w._block(B - 1.2, 0.3, L - 10, qx + 3, 4.7, sz, M.dark, { collide: false });
  for (let i = 0; i < 3; i++) {
    w._block(B - 5, 1.1, 16, qx + 3, 4.9, sz - 26 + i * 20, M.concreteDark, { collide: false });
  }
  w._block(B - 3, 9, 14, qx + 3, 5.0, sz + L * 0.34, M.white, { surface: 'metal' });
  for (let f = 0; f < 3; f++) {
    w._block(B - 2.6, 0.9, 0.2, qx + 3, 6.6 + f * 2.6, sz + L * 0.34 - 7.1, M.glass, { collide: false });
  }
  w._block(4.4, 7, 4.4, qx + 3, 14, sz + L * 0.34 + 2, M.red, { collide: false });
  w._block(5, 0.6, 5, qx + 3, 21, sz + L * 0.34 + 2, M.black, { collide: false });
  rod(w, [qx + 3, 5.0, sz - L * 0.36], [qx + 3, 22, sz - L * 0.36], 0.22, M.white, 7);
  // Mooring lines to the quay bollards.
  for (const t of [-0.34, 0.3]) {
    const a = [qx + 3 - B * 0.45, 5.2, sz + L * t];
    const b = [qx - 2.2, QY + 0.7, sz + L * t * 0.8];
    const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 0.8, (a[2] + b[2]) / 2];
    const line = new THREE.Mesh(sweep([a, mid, b], 0.08, { segs: 5 }), M.white);
    w.group.add(line);
  }
  // Gangway down to the quay.
  const gw = put(w, new THREE.BoxGeometry(1.2, 0.14, 12), M.steel, qx - 0.5, 3.6, sz - 6, 0, 0);
  gw.rotation.x = 0.16;
  gw.rotation.y = Math.PI / 2;

  // --- Yard clutter, lighting and the fence --------------------------------
  for (let i = 0; i < 26; i++) {
    const bx = qx - 40 - rand() * 60, bz = z0 + 20 + rand() * (z1 - z0 - 40);
    const k = rand();
    if (k < 0.35) {
      // A pallet stack under a tarp.
      w._block(1.6, 0.16, 1.2, bx, 1.9, bz, M.timber, { collide: false });
      w._block(1.5, 1.1, 1.1, bx, 2.05, bz, rand() < 0.5 ? M.green : M.dark, { collide: false });
    } else if (k < 0.62) {
      for (let d2 = 0; d2 < 3 + ((rand() * 4) | 0); d2++) {
        put(w, new THREE.CylinderGeometry(0.31, 0.31, 0.9, 12), rand() < 0.5 ? M.paintedSteel : M.green,
          bx + (rand() - 0.5) * 2.4, 2.3, bz + (rand() - 0.5) * 2.4);
      }
    } else if (k < 0.82) {
      // A forklift: mast, body, forks.
      w._block(1.5, 1.1, 2.4, bx, 1.9, bz, M.yellow, { collide: false });
      w._block(1.2, 1.2, 0.2, bx, 3.0, bz - 0.9, M.dark, { collide: false });
      rod(w, [bx - 0.5, 1.9, bz - 1.2], [bx - 0.5, 4.4, bz - 1.2], 0.08, M.steel, 5);
      rod(w, [bx + 0.5, 1.9, bz - 1.2], [bx + 0.5, 4.4, bz - 1.2], 0.08, M.steel, 5);
      w._block(0.14, 0.1, 1.1, bx - 0.35, 1.95, bz - 1.7, M.steel, { collide: false });
      w._block(0.14, 0.1, 1.1, bx + 0.35, 1.95, bz - 1.7, M.steel, { collide: false });
    } else {
      // Coils of rope and a cable drum on its side.
      const drum = put(w, new THREE.CylinderGeometry(1.3, 1.3, 1.1, 14), M.timber, bx, 3.0, bz);
      drum.rotation.z = Math.PI / 2;
      put(w, new THREE.CylinderGeometry(1.05, 1.05, 1.15, 14), M.black, bx, 3.0, bz).rotation.z = Math.PI / 2;
    }
  }
  for (let i = 0; i < 6; i++) floodMast(w, M, qx - 46, z0 + 40 + i * 100, 18, Math.PI / 2);
  fence(w, M, qx - 118, z0 - 4, qx - 4, z0 - 4);
  fence(w, M, qx - 118, z1 + 4, qx - 4, z1 + 4);
  fence(w, M, qx - 118, z0 - 4, qx - 118, z1 + 4);
  // Gatehouse on the landward fence.
  w._block(4, 3.2, 4, qx - 118, 1.9, (z0 + z1) / 2, M.white, { surface: 'stone' });
  w._block(3.4, 1.2, 0.2, qx - 116, 3.6, (z0 + z1) / 2, M.glass, { collide: false });
  city.docks = { x: qx, z0, z1, quayY: QY };
}

// ---------------------------------------------------------------- airfield

/** CROSSWIND FIELD: the paint, the lights and the vehicles an apron needs. */
function buildAirfield(city, M) {
  const w = city.world;
  const rand = city.rand;
  const ap = city.airport;
  if (!ap) return;
  const cx = ap.x, cz = ap.z;

  // Taxiway from the apron to the runway threshold, with its centreline.
  const tw = 24;
  w._block(tw, 0.06, 150, cx - 40, 0.19, cz - 120, city.mats.road, { collide: false });
  for (let t = -70; t < 70; t += 12) {
    mark(w, M.yellow, cx - 40, 0.27, cz - 120 + t, 0.5, 7);
  }
  // Hold-short bars where the taxiway meets the runway.
  for (let i = -1; i <= 1; i += 2) {
    mark(w, M.yellow, cx - 40 + i * 3.2, 0.27, cz - 196, 0.4, 20, Math.PI / 2);
  }
  // Stand markings on the apron: a T for each aircraft spot.
  for (const spot of ap.planeSpots) {
    mark(w, M.paint, spot.x, 0.27, spot.z, 0.4, 26);
    mark(w, M.paint, spot.x, 0.27, spot.z - 12, 7, 0.4);
    mark(w, M.yellow, spot.x, 0.28, spot.z + 13, 5, 0.5);
  }
  // Runway edge lights, both sides, all the way down.
  const bulb = new THREE.SphereGeometry(0.22, 8, 6);
  const lights = [];
  for (let t = -340; t <= 340; t += 20) {
    lights.push([cx - 24, cz - 300 + t], [cx + 24, cz - 300 + t]);
  }
  const lm = new THREE.InstancedMesh(bulb, M.lamp, lights.length);
  lights.forEach((p, i) => {
    _m4.compose(_p.set(p[0], 0.28, p[1]), _q.identity(), _s.set(1, 1, 1));
    lm.setMatrixAt(i, _m4);
  });
  w.group.add(lm);
  // Approach lights and a PAPI off the threshold.
  for (let i = 1; i <= 5; i++) {
    put(w, new THREE.BoxGeometry(2.6, 0.16, 0.3), M.lamp, cx, 0.3, cz - 300 - 345 - i * 18);
  }
  for (let i = 0; i < 4; i++) {
    put(w, new THREE.BoxGeometry(0.7, 0.5, 0.5), M.dark, cx - 34 - i * 2.2, 0.5, cz - 300 - 330);
    put(w, new THREE.BoxGeometry(0.5, 0.3, 0.06), i < 2 ? M.red : M.lamp, cx - 34 - i * 2.2, 0.5, cz - 300 - 330 - 0.3);
  }

  // Windsock on its pole, and a wind tee.
  const wx = cx + 96, wz = cz - 40;
  rod(w, [wx, 0, wz], [wx, 7.5, wz], 0.09, M.white, 6);
  put(w, new THREE.TorusGeometry(0.75, 0.06, 6, 16), M.dark, wx + 0.8, 7.4, wz).rotation.y = Math.PI / 2;
  const sock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.42, 3.4, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xe06a1c, roughness: 0.9, side: THREE.DoubleSide })
  );
  sock.position.set(wx + 2.5, 7.2, wz + 0.4);
  sock.rotation.z = Math.PI / 2;
  sock.rotation.y = 0.35;
  w.group.add(sock);
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72 - i * 0.1, 0.66 - i * 0.1, 0.5, 12, 1, true), M.white
    );
    band.position.set(wx + 1.6 + i * 0.95, 7.24 - i * 0.03, wz + 0.4 + i * 0.12);
    band.rotation.z = Math.PI / 2;
    band.rotation.y = 0.35;
    w.group.add(band);
  }

  // Ground equipment, parked where the last crew left it.
  const gse = (x, z, kind) => {
    if (kind === 'bowser') {
      w._block(2.5, 1.6, 7.5, x, 0.5, z, M.white, { collide: false });
      put(w, new THREE.CylinderGeometry(1.25, 1.25, 5.4, 14), M.white, x, 2.0, z).rotation.x = Math.PI / 2;
      w._block(2.2, 1.5, 2.2, x, 0.5, z - 4.2, M.green, { collide: false });
      for (const sx of [-1.1, 1.1]) for (const sz2 of [-3.4, 1.2, 2.6]) {
        put(w, new THREE.CylinderGeometry(0.45, 0.45, 0.32, 10), M.black, x + sx, 0.45, z + sz2).rotation.z = Math.PI / 2;
      }
    } else if (kind === 'tug') {
      w._block(1.8, 0.9, 3.2, x, 0.35, z, M.yellow, { collide: false });
      w._block(1.5, 0.9, 1.2, x, 1.25, z + 0.6, M.dark, { collide: false });
      for (const sx of [-0.85, 0.85]) for (const sz2 of [-1.1, 1.1]) {
        put(w, new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), M.black, x + sx, 0.38, z + sz2).rotation.z = Math.PI / 2;
      }
    } else {
      // Baggage cart, sometimes with bags on it.
      w._block(1.6, 0.5, 3.0, x, 0.55, z, M.dark, { collide: false });
      for (let i = 0; i < 4; i++) {
        rod(w, [x - 0.75 + (i % 2) * 1.5, 0.8, z - 1.4 + ((i / 2) | 0) * 2.8], [x - 0.75 + (i % 2) * 1.5, 1.6, z - 1.4 + ((i / 2) | 0) * 2.8], 0.04, M.steel, 5);
      }
      if (rand() < 0.6) w._block(1.2, 0.7, 2.2, x, 0.8, z, M.green, { collide: false });
      for (const sx of [-0.7, 0.7]) for (const sz2 of [-1.1, 1.1]) {
        put(w, new THREE.CylinderGeometry(0.27, 0.27, 0.24, 10), M.black, x + sx, 0.28, z + sz2).rotation.z = Math.PI / 2;
      }
    }
  };
  gse(cx - 96, cz + 30, 'bowser');
  gse(cx - 84, cz + 46, 'tug');
  gse(cx - 76, cz + 58, 'cart');
  gse(cx - 68, cz + 58, 'cart');
  gse(cx + 100, cz + 50, 'tug');

  // Hangar doors: a run of folding leaves with a personnel door in one.
  for (let i = 0; i < 3; i++) {
    const hx = cx - 120, hz = cz - 70 + i * 70;
    for (let k = 0; k < 6; k++) {
      w._block(0.3, 15, 7.2, hx + 29.2, 0.2, hz - 21 + k * 7.4, k % 2 ? M.concreteDark : M.white, { collide: false });
    }
    w._block(0.35, 2.2, 1.0, hx + 29.4, 0.2, hz + 16, M.dark, { collide: false });
    // Number on the door.
    mark(w, M.paint, hx + 29.5, 9, hz, 0.1, 3);
  }

  // Perimeter fence along the landward side, with a gate on the road.
  fence(w, M, cx - 160, cz + 120, cx + 160, cz + 120, 2.6, 10);
  floodMast(w, M, cx - 130, cz + 96, 14, -Math.PI / 2);
  floodMast(w, M, cx + 130, cz + 96, 14, -Math.PI / 2);
}

// ------------------------------------------------------------------ marina

/** The marina: pontoon fittings, a fuel dock, cradles and a harbour hut. */
function buildMarina(city, M) {
  const w = city.world;
  const rand = city.rand;
  const m = city.marina;
  if (!m) return;
  const mz = m.z;
  const deckY = 1.4;

  // The quay along the shore and three finger pontoons reaching into the
  // dredged basin, with two berths apiece.
  w._block(180, 1.4, 12, m.x, 0, mz, M.concrete, { surface: 'wood' });
  for (let i = 0; i < 3; i++) {
    const jx = m.x - 60 + i * 60;
    w._block(7, 1.2, 74, jx, 0, mz + 43, M.timber, { surface: 'wood' });
    m.berths.push({ x: jx - 9, z: mz + 34 }, { x: jx + 9, z: mz + 62 });
  }

  // Cleats and posts down every finger, and a life ring on a stand.
  for (let i = 0; i < 3; i++) {
    const jx = m.x - 60 + i * 60;
    for (let k = 0; k < 11; k++) {
      const z = mz + 8 + k * 6.9;
      for (const sx of [-3.2, 3.2]) {
        put(w, new THREE.BoxGeometry(0.16, 0.12, 0.5), M.steel, jx + sx, deckY + 0.06, z);
        put(w, new THREE.CylinderGeometry(0.06, 0.06, 0.22, 6), M.steel, jx + sx, deckY + 0.11, z);
      }
      if (k % 3 === 0) {
        put(w, new THREE.CylinderGeometry(0.16, 0.2, 1.3, 10), M.timber, jx + 3.6, deckY + 0.65, z);
        put(w, new THREE.SphereGeometry(0.19, 8, 6), M.dark, jx + 3.6, deckY + 1.3, z);
      }
    }
    // A power and water post at the head of each finger.
    put(w, new THREE.BoxGeometry(0.4, 1.1, 0.4), M.white, jx, deckY + 0.55, mz + 10);
    put(w, new THREE.BoxGeometry(0.44, 0.12, 0.44), M.dark, jx, deckY + 1.15, mz + 10);
    // Life ring on a post.
    rod(w, [jx - 3.6, deckY, mz + 24], [jx - 3.6, deckY + 1.2, mz + 24], 0.06, M.white, 6);
    const ring = put(w, new THREE.TorusGeometry(0.34, 0.09, 8, 18), M.red, jx - 3.6, deckY + 1.35, mz + 24);
    ring.rotation.y = Math.PI / 2;
  }

  // Fuel dock at the east end: two pumps, a hose reel and a sign.
  const fx = m.x + 76;
  w._block(9, 1.4, 7, fx, 0, mz + 8, M.timber, { surface: 'wood' });
  for (const off of [-1.6, 1.6]) {
    w._block(0.7, 1.6, 0.5, fx + off, deckY, mz + 8, M.red, { collide: false });
    w._block(0.5, 0.35, 0.06, fx + off, deckY + 1.1, mz + 7.72, M.dark, { collide: false });
    rod(w, [fx + off, deckY + 1.5, mz + 8], [fx + off + 0.5, deckY + 0.4, mz + 7.2], 0.05, M.black, 5);
  }
  w._block(3.2, 0.9, 0.12, fx, deckY + 2.4, mz + 8, M.white, { collide: false });
  rod(w, [fx - 1.4, deckY, mz + 8.4], [fx - 1.4, deckY + 2.4, mz + 8.4], 0.07, M.steel, 6);
  rod(w, [fx + 1.4, deckY, mz + 8.4], [fx + 1.4, deckY + 2.4, mz + 8.4], 0.07, M.steel, 6);

  // Harbourmaster's hut on the quay, with a mast and a flag.
  const hx = m.x - 84;
  w._block(7, 3.4, 6, hx, deckY, mz - 1, M.white, { surface: 'wood' });
  w._block(7.6, 0.5, 6.6, hx, deckY + 3.4, mz - 1, M.dark, { collide: false });
  w._block(2.6, 1.3, 0.12, hx, deckY + 1.9, mz + 2.1, M.glass, { collide: false });
  w._block(1.0, 2.1, 0.1, hx + 2.2, deckY, mz + 2.05, M.timber, { collide: false });
  rod(w, [hx - 4.5, deckY, mz - 1], [hx - 4.5, deckY + 9, mz - 1], 0.09, M.white, 6);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), M.red);
  flag.position.set(hx - 3.6, deckY + 8.2, mz - 1);
  w.group.add(flag);

  // Boats up on cradles ashore, one under a tarp, and a stack of dinghies.
  for (let i = 0; i < 3; i++) {
    const bx = m.x - 30 + i * 26, bz = mz - 14;
    for (const off of [-2.2, 2.2]) {
      w._block(0.5, 1.6, 3.4, bx + off, 0, bz, M.steel, { collide: false });
      w._block(2.4, 0.3, 0.5, bx, 1.6, bz + (off > 0 ? 1.2 : -1.2), M.steel, { collide: false });
    }
    const hullG = new THREE.SphereGeometry(1, 14, 10);
    hullG.scale(1.5, 0.85, 4.6);
    const hull = put(w, hullG, i === 1 ? M.green : M.white, bx, 2.9, bz);
    hull.scale.y = 0.9;
    if (i === 1) {
      const tarp = put(w, new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), M.dark, bx, 3.3, bz);
      tarp.scale.set(1.7, 1.1, 4.8);
    }
  }
  for (let i = 0; i < 4; i++) {
    const d = new THREE.SphereGeometry(1, 10, 8);
    d.scale(0.8, 0.3, 2.1);
    put(w, d, i % 2 ? M.white : M.green, m.x + 40, 0.35 + i * 0.5, mz - 12 + i * 0.3, 0.1 * i);
  }

  // Lamps down the quay and a beacon at the end of the breakwater.
  for (let i = 0; i < 7; i++) {
    const lx = m.x - 84 + i * 28;
    rod(w, [lx, deckY, mz - 4.6], [lx, deckY + 4.4, mz - 4.6], 0.07, M.dark, 6);
    put(w, new THREE.SphereGeometry(0.2, 10, 8), M.lamp, lx, deckY + 4.5, mz - 4.6);
  }
  // Breakwater: a rubble mound arm with a green beacon on its head.
  const bwX = m.x + 112;
  for (let i = 0; i < 16; i++) {
    const z = mz + 4 + i * 5.5;
    const rock = put(w, new THREE.DodecahedronGeometry(2.6 + rand() * 1.4, 0), M.concreteDark,
      bwX + (rand() - 0.5) * 2.5, -0.4 + rand() * 0.8, z, rand() * 3);
    rock.rotation.x = rand();
  }
  rod(w, [bwX, 1.2, mz + 92], [bwX, 6.5, mz + 92], 0.16, M.white, 8);
  put(w, new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshStandardMaterial({
    color: 0x0a2a14, emissive: 0x2cff60, emissiveIntensity: 2.0, roughness: 0.4
  }), bwX, 6.8, mz + 92);
}

/** Dress the working districts. Call before the static merge. */
export function buildIndustry(city) {
  const M = mats();
  city.industryMats = M;
  buildDocks(city, M);
  buildAirfield(city, M);
  buildMarina(city, M);
}
