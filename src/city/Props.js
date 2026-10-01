import * as THREE from 'three';
import { Body } from '../physics/Rigid.js';

/**
 * Props — the loose objects. The things that move when you hit them.
 *
 * A city where nothing can be knocked over does not feel solid, it feels
 * painted. Every cone, bin, crate, drum, chair and sign here is a real rigid
 * body: it tips, tumbles, slides, stacks, falls off kerbs, gets flung by a
 * bumper at forty and rolls to a stop, and settles wherever it ends up.
 *
 * DRAW COST. Each kind is ONE instanced mesh for the whole city, and an
 * instance's matrix is only rewritten while its body is awake — which, after
 * the dust settles, is none of them. Three hundred props cost three draw calls
 * and no CPU until you drive into them.
 */

const _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _lift = new THREE.Vector3();

/** Build one prop kind: a merged mesh, and the body dimensions that suit it. */
function kinds() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const merge = (parts) => {
    // Everything is a handful of primitives; bake them into one geometry so a
    // prop is a single instance rather than a little scene graph.
    let count = 0;
    for (const p of parts) count += p.geometry.attributes.position.count;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const idx = [];
    let o = 0;
    for (const p of parts) {
      p.updateMatrix();
      const g = p.geometry.clone();
      g.applyMatrix4(p.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      _c.copy(p.material.color);
      for (let i = 0; i < g.attributes.position.count; i++) {
        col[(o + i) * 3] = _c.r; col[(o + i) * 3 + 1] = _c.g; col[(o + i) * 3 + 2] = _c.b;
      }
      const gi = g.index;
      if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + o);
      else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + o);
      o += g.attributes.position.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  };
  const M = (geo, mat, x = 0, y = 0, z = 0, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    return m;
  };
  const orange = std({ color: 0xe2571c, roughness: 0.7 });
  const white = std({ color: 0xe8e6de, roughness: 0.7 });
  const green = std({ color: 0x2f5d3a, roughness: 0.8 });
  const grey = std({ color: 0x5a6068, roughness: 0.7, metalness: 0.3 });
  const steel = std({ color: 0x8b9199, roughness: 0.45, metalness: 0.75 });
  const wood = std({ color: 0x8a6538, roughness: 0.92 });
  const blue = std({ color: 0x24506e, roughness: 0.75 });
  const red = std({ color: 0xa8231c, roughness: 0.7 });
  const black = std({ color: 0x1b1d20, roughness: 0.85 });
  const sand = std({ color: 0xd9c79a, roughness: 0.9 });

  return {
    // A traffic cone: base, body, and the reflective band.
    cone: {
      geo: merge([
        M(new THREE.BoxGeometry(0.42, 0.05, 0.42), orange, 0, 0.025),
        M(new THREE.ConeGeometry(0.17, 0.62, 10), orange, 0, 0.36),
        M(new THREE.CylinderGeometry(0.115, 0.135, 0.1, 10), white, 0, 0.42)
      ]),
      half: new THREE.Vector3(0.21, 0.34, 0.21), mass: 3.2,
      restitution: 0.22, friction: 0.72, count: 70
    },
    // A wheelie bin, on its two little wheels.
    bin: {
      geo: merge([
        M(new THREE.BoxGeometry(0.62, 0.95, 0.56), green, 0, 0.5),
        M(new THREE.BoxGeometry(0.66, 0.08, 0.6), black, 0, 1.0),
        M(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), black, -0.26, 0.09, -0.2, Math.PI / 2),
        M(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), black, 0.26, 0.09, -0.2, Math.PI / 2)
      ]),
      half: new THREE.Vector3(0.33, 0.52, 0.3), mass: 16,
      restitution: 0.12, friction: 0.6, count: 46
    },
    // A shipping crate with slats.
    crate: {
      geo: merge([
        M(new THREE.BoxGeometry(0.8, 0.72, 0.8), wood, 0, 0.36),
        M(new THREE.BoxGeometry(0.84, 0.07, 0.84), grey, 0, 0.14),
        M(new THREE.BoxGeometry(0.84, 0.07, 0.84), grey, 0, 0.58)
      ]),
      half: new THREE.Vector3(0.4, 0.36, 0.4), mass: 24,
      restitution: 0.1, friction: 0.7, count: 44
    },
    // An oil drum with its rolling hoops.
    drum: {
      geo: merge([
        M(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 14), blue, 0, 0.44),
        M(new THREE.TorusGeometry(0.3, 0.035, 5, 16), blue, 0, 0.28, 0, Math.PI / 2),
        M(new THREE.TorusGeometry(0.3, 0.035, 5, 16), blue, 0, 0.6, 0, Math.PI / 2)
      ]),
      half: new THREE.Vector3(0.29, 0.44, 0.29), mass: 30,
      restitution: 0.24, friction: 0.42, count: 40
    },
    // A café chair.
    chair: {
      geo: merge([
        M(new THREE.BoxGeometry(0.42, 0.05, 0.42), wood, 0, 0.44),
        M(new THREE.BoxGeometry(0.42, 0.5, 0.05), wood, 0, 0.69, -0.18),
        M(new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6), steel, -0.17, 0.22, -0.17),
        M(new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6), steel, 0.17, 0.22, -0.17),
        M(new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6), steel, -0.17, 0.22, 0.17),
        M(new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6), steel, 0.17, 0.22, 0.17)
      ]),
      half: new THREE.Vector3(0.22, 0.47, 0.22), mass: 6,
      restitution: 0.2, friction: 0.55, count: 40
    },
    // A road sign on a weighted foot: tips, and rocks back if it lands flat.
    sign: {
      geo: merge([
        M(new THREE.BoxGeometry(0.62, 0.06, 0.4), grey, 0, 0.03),
        M(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), grey, 0, 0.6),
        M(new THREE.BoxGeometry(0.62, 0.46, 0.04), red, 0, 1.28),
        M(new THREE.BoxGeometry(0.5, 0.1, 0.05), white, 0, 1.28)
      ]),
      half: new THREE.Vector3(0.31, 0.75, 0.2), mass: 11,
      restitution: 0.18, friction: 0.62, count: 34
    },
    // A pallet — flat, slides a long way.
    pallet: {
      geo: merge([
        M(new THREE.BoxGeometry(1.15, 0.05, 0.95), wood, 0, 0.115),
        M(new THREE.BoxGeometry(1.15, 0.05, 0.95), wood, 0, 0.02),
        M(new THREE.BoxGeometry(0.12, 0.08, 0.95), wood, -0.5, 0.07),
        M(new THREE.BoxGeometry(0.12, 0.08, 0.95), wood, 0, 0.07),
        M(new THREE.BoxGeometry(0.12, 0.08, 0.95), wood, 0.5, 0.07)
      ]),
      half: new THREE.Vector3(0.58, 0.07, 0.48), mass: 14,
      restitution: 0.08, friction: 0.72, count: 30
    },
    // A beach ball: light, and it actually bounces.
    ball: {
      geo: merge([M(new THREE.SphereGeometry(0.28, 14, 10), white)]),
      half: new THREE.Vector3(0.26, 0.26, 0.26), mass: 0.9,
      restitution: 0.72, friction: 0.35, count: 16, buoyancy: 1.6
    },
    // A deck chair on the sand.
    deckchair: {
      geo: merge([
        M(new THREE.BoxGeometry(0.6, 0.06, 1.2), sand, 0, 0.36, 0, -0.35),
        M(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), wood, -0.28, 0.2, 0.3),
        M(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), wood, 0.28, 0.2, 0.3),
        M(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), wood, -0.28, 0.2, -0.3),
        M(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), wood, 0.28, 0.2, -0.3)
      ]),
      half: new THREE.Vector3(0.3, 0.38, 0.6), mass: 5,
      restitution: 0.15, friction: 0.6, count: 22
    }
  };
}

export class Props {
  constructor(city, rigid) {
    this.city = city;
    this.rigid = rigid;
    this.kinds = kinds();
    this.groups = {};
    const w = city.world;
    for (const [id, k] of Object.entries(this.kinds)) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
      const mesh = new THREE.InstancedMesh(k.geo, mat, k.count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      w.group.add(mesh);
      this.groups[id] = { mesh, bodies: [], dirty: true };
    }
  }

  /** Put one down, resting on the ground, facing anywhere. */
  spawn(id, x, z, y = null, yaw = null) {
    const k = this.kinds[id];
    const g = this.groups[id];
    if (!k || !g || g.bodies.length >= k.count) return null;
    const gy = y !== null ? y : (this.city.surfaceAt ? this.city.surfaceAt(x, z) : 0);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0),
      yaw === null ? Math.random() * Math.PI * 2 : yaw);
    const body = new Body({
      half: k.half, mass: k.mass, restitution: k.restitution, friction: k.friction,
      buoyancy: k.buoyancy || 0,
      pos: new THREE.Vector3(x, gy + k.half.y, z), quat: q
    });
    // The mesh is modelled standing on y = 0; the body's origin is its centre.
    body.userData.lift = k.half.y;
    body.sleeping = true;
    g.bodies.push(body);
    this.rigid.add(body);
    g.mesh.count = g.bodies.length;
    g.dirty = true;
    return body;
  }

  /** Rewrite the instance matrices of everything that moved this frame. */
  update() {
    for (const g of Object.values(this.groups)) {
      let dirty = g.dirty;
      for (let i = 0; i < g.bodies.length; i++) {
        const b = g.bodies[i];
        if (b.sleeping && !g.dirty) continue;
        dirty = true;
        _v.copy(b.pos);
        _q.copy(b.quat);
        // Down to the modelled base, in the body's own frame.
        _v.add(_lift.set(0, -b.userData.lift, 0).applyQuaternion(_q));
        _m4.compose(_v, _q, _s);
        g.mesh.setMatrixAt(i, _m4);
      }
      if (dirty) {
        g.mesh.instanceMatrix.needsUpdate = true;
        g.dirty = false;
      }
    }
  }
}

/**
 * Scatter props through the city: cones and bins on the pavements, crates and
 * drums round the docks and yards, chairs outside the cafés, deck chairs and
 * balls on the beach.
 */
export function buildProps(city, rigid) {
  const props = new Props(city, rigid);
  const rand = city.rand || Math.random;
  const nodes = city.nodes || [];
  const ROADW = 17;

  // Street furniture along the kerbs, in little groups the way it really is:
  // three cones round a hole, two bins at a back gate.
  for (let i = 0; i < 46 && nodes.length; i++) {
    const n = nodes[(rand() * nodes.length) | 0];
    const link = n.links && n.links[(rand() * n.links.length) | 0];
    if (!link) continue;
    const dx = link.x - n.x, dz = link.z - n.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const t = 0.2 + rand() * 0.6;
    const side = rand() < 0.5 ? 1 : -1;
    const off = ROADW * 0.5 + 1.4 + rand() * 1.6;
    const bx = n.x + dx * t - uz * off * side;
    const bz = n.z + dz * t + ux * off * side;
    const roll = rand();
    if (roll < 0.42) {
      const n2 = 2 + ((rand() * 3) | 0);
      for (let k = 0; k < n2; k++) {
        props.spawn('cone', bx + (rand() - 0.5) * 2.2, bz + (rand() - 0.5) * 2.2);
      }
    } else if (roll < 0.72) {
      props.spawn('bin', bx, bz);
      if (rand() < 0.5) props.spawn('bin', bx + ux * 0.9, bz + uz * 0.9);
    } else if (roll < 0.86) {
      props.spawn('sign', bx, bz);
    } else {
      props.spawn('crate', bx, bz);
      if (rand() < 0.4) props.spawn('crate', bx + 0.1, bz + 0.1, null);
    }
  }

  // Chairs outside the cafés and shops.
  for (const b of (city.buildings || [])) {
    if (b.kind !== 'shop' || rand() > 0.3) continue;
    const n2 = 2 + ((rand() * 3) | 0);
    for (let k = 0; k < n2; k++) {
      props.spawn('chair', b.x + (rand() - 0.5) * 4, b.z + b.d * 0.5 + 2.2 + rand() * 1.6);
    }
  }

  // The dock yard: crates, drums and pallets behind the fence.
  const dk = city.docksPlan;
  if (dk) {
    for (let i = 0; i < 40; i++) {
      const x = dk.x - 45 - rand() * 60;
      const z = dk.z0 + 20 + rand() * (dk.z1 - dk.z0 - 40);
      const r = rand();
      props.spawn(r < 0.4 ? 'drum' : r < 0.75 ? 'crate' : 'pallet', x, z, 2.1);
    }
  }

  // The beach: deck chairs above the tide line, and a few balls.
  if (city.ocean) {
    const shore = city.shore;
    for (let i = 0; i < 26; i++) {
      const side = (rand() * 4) | 0;
      const d = 20 + rand() * 80;
      const along = (rand() - 0.5) * 2 * (shore - 60);
      const r = shore + d;
      const x = side === 0 || side === 1 ? along : (side === 2 ? -r : r);
      const z = side === 0 ? -r : side === 1 ? r : along;
      const y = city.ocean.groundAt(x, z);
      if (y < (city.seaLevel ?? -0.9) + 0.3) continue;
      props.spawn(rand() < 0.75 ? 'deckchair' : 'ball', x, z, y);
    }
  }
  return props;
}
