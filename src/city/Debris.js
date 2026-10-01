import * as THREE from 'three';
import { Body } from '../physics/Rigid.js';

/**
 * What is left of a car.
 *
 * An explosion used to be a puff of particles and a vehicle that turned black
 * and stayed exactly where it was, the right way up, in one piece. Nothing
 * came off it and nothing landed anywhere. The moment that most wants to be
 * physical in the whole game was the one place there was none.
 *
 * So: a pool of real rigid bodies, torn off and thrown. Panels come off in
 * slabs the colour of the car, glass comes off in small dark chips, and both
 * go into the same solver everything else uses — they bounce off the road,
 * skid, hit kerbs and walls, come to rest and then lie there. A blast going
 * off next to them picks them up again, because by then they are simply more
 * loose objects in the street.
 *
 * WHY A POOL. Bodies are cheap to step and expensive to create, and an
 * explosion is exactly the frame where there is no budget to spare. Every
 * chunk is allocated once at startup and recycled: a burst takes the oldest
 * ones back if it has to, so a street full of wrecks can never grow without
 * bound. One InstancedMesh draws all of them in a single call, with each
 * chunk's size baked into its instance matrix, so there is no per-chunk
 * geometry either.
 */

const POOL = 96;
const LIFE = 14;                 // seconds before a chunk fades out
const FADE = 1.6;                // of which this long is spent shrinking

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _m4 = new THREE.Matrix4();
const _c = new THREE.Color();
const _axis = new THREE.Vector3();

export class Debris {
  constructor(world, rigid) {
    this.rigid = rigid;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: false, roughness: 0.62, metalness: 0.35
    });
    const mesh = new THREE.InstancedMesh(geo, mat, POOL);
    // White to begin with: a zero-filled colour buffer draws every chunk
    // black, which is exactly what a burst of debris must not look like.
    const cols = new Float32Array(POOL * 3).fill(1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = POOL;
    world.group.add(mesh);
    this.mesh = mesh;

    // Every chunk exists from the start; `live` is what makes it visible.
    this.chunks = [];
    for (let i = 0; i < POOL; i++) {
      const body = new Body({
        half: new THREE.Vector3(0.2, 0.05, 0.3),
        mass: 9, restitution: 0.22, friction: 0.66, drag: 0.35, angDrag: 0.5
      });
      body.alive = false;
      body.sleeping = true;
      rigid.add(body);
      this.chunks.push({ body, life: 0, scale: new THREE.Vector3(0.4, 0.1, 0.6), live: false, idx: i });
      // Parked well below the world until it is used.
      body.pos.set(0, -9999, 0);
    }
    this._next = 0;
    this._hide();
  }

  _hide() {
    _m4.makeScale(0, 0, 0);
    for (let i = 0; i < POOL; i++) this.mesh.setMatrixAt(i, _m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The next free chunk, or the oldest live one if every chunk is busy. */
  _take() {
    for (let n = 0; n < POOL; n++) {
      const c = this.chunks[(this._next + n) % POOL];
      if (!c.live) { this._next = (this._next + n + 1) % POOL; return c; }
    }
    const c = this.chunks[this._next];
    this._next = (this._next + 1) % POOL;
    return c;
  }

  /**
   * Blow a vehicle apart.
   *
   * @param position where the vehicle is
   * @param opts.style the chassis entry, for the size of the pieces
   * @param opts.color the car's paint, so the panels match the car
   * @param opts.count how many pieces
   * @param opts.power how hard they leave
   */
  burst(position, opts = {}) {
    const style = opts.style || { l: 4.5, w: 1.9, h: 1.35 };
    const count = opts.count ?? 14;
    const power = opts.power ?? 1;
    const paint = opts.color !== undefined ? _c.set(opts.color) : _c.setHex(0x8a8f96);
    const pr = paint.r, pg = paint.g, pb = paint.b;

    for (let i = 0; i < count; i++) {
      const c = this._take();
      const b = c.body;
      // Two thirds panel, one third glass and trim. Panels are big flat
      // slabs; the rest are small dark chips.
      // Sizes are HALF-extents. Scaled off the car they came out as 1.6 x 2.5
      // metre slabs — half a bonnet each, which read as fins bolted to the
      // wreck rather than as anything that had come off it. A door skin torn
      // in half is about 60 cm across; that is the size to aim at, and the
      // pieces have to be small enough that fourteen of them look like a
      // scattering rather than a second vehicle.
      const panel = i % 3 !== 2;
      const sx = panel ? 0.11 + Math.random() * 0.27 : 0.05 + Math.random() * 0.08;
      const sy = panel ? 0.012 + Math.random() * 0.022 : 0.04 + Math.random() * 0.05;
      const sz = panel ? 0.13 + Math.random() * 0.32 : 0.05 + Math.random() * 0.09;
      c.scale.set(sx * 2, sy * 2, sz * 2);
      b.half.set(sx, sy, sz);
      b.radius = b.half.length();
      // Inertia has to be rebuilt for the new shape or a wide panel spins
      // like a cube.
      const m = b.mass = panel ? 4 + Math.random() * 5 : 1.8;
      b.invMass = 1 / m;
      const w2 = (2 * sx) ** 2, h2 = (2 * sy) ** 2, d2 = (2 * sz) ** 2;
      b.invI.set(12 / (m * (h2 + d2)), 12 / (m * (w2 + d2)), 12 / (m * (w2 + h2)));

      // Colour: paint for the panels, smoked glass for the rest, each with a
      // little scatter so a wreck is not fourteen identical rectangles.
      const j = 0.82 + Math.random() * 0.36;
      if (panel) _c.setRGB(pr * j, pg * j, pb * j);
      else _c.setRGB(0.05 * j, 0.06 * j, 0.07 * j);
      this.mesh.setColorAt(c.idx, _c);

      // Thrown out and up, from somewhere inside the car's own volume.
      b.pos.set(
        position.x + (Math.random() - 0.5) * style.w * 0.9,
        position.y + style.h * (0.25 + Math.random() * 0.6),
        position.z + (Math.random() - 0.5) * style.l * 0.9
      );
      _axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      b.quat.setFromAxisAngle(_axis, Math.random() * Math.PI * 2);
      const out = _v.set(b.pos.x - position.x, 0, b.pos.z - position.z);
      if (out.lengthSq() < 1e-6) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize().multiplyScalar((3 + Math.random() * 7) * power);
      b.vel.set(out.x, (5 + Math.random() * 8) * power, out.z);
      b.ang.set(
        (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14
      );
      b.alive = true;
      b.sleeping = false;
      b._still = 0;
      c.life = LIFE;
      c.live = true;
      c._wrote = false;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Age the live chunks and rewrite the instance matrices. */
  update(dt) {
    let dirty = false;
    for (let i = 0; i < POOL; i++) {
      const c = this.chunks[i];
      if (!c.live) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.live = false;
        c.body.alive = false;
        c.body.sleeping = true;
        c.body.pos.set(0, -9999, 0);
        _m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m4);
        dirty = true;
        continue;
      }
      // A settled chunk still needs writing while it is shrinking away.
      const fading = c.life < FADE;
      if (c.body.sleeping && !fading && c._wrote) continue;
      const k = fading ? c.life / FADE : 1;
      _s.copy(c.scale).multiplyScalar(k);
      _m4.compose(c.body.pos, c.body.quat, _s);
      this.mesh.setMatrixAt(i, _m4);
      c._wrote = true;
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
