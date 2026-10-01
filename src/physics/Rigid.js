import * as THREE from 'three';

/**
 * Rigid bodies — the half of the physics that was missing.
 *
 * Everything in the world was STATIC. The collision system knew how to stop a
 * capsule against a box and how to fire a ray, and that was all it could do:
 * nothing in the city could be knocked over, thrown, tipped, stacked or
 * dropped. Drive through a row of cones and the cones win.
 *
 * This is a small impulse-based solver for boxes, written for the kind of
 * object a city is full of — bins, cones, crates, drums, chairs, signs, debris
 * — and for how they are actually used: hit hard once, tumble, and settle.
 *
 * HOW IT WORKS. Each body integrates under gravity, then its eight CORNERS
 * are tested against the world: the terrain height under them, and any static
 * box they have gone inside. Every corner that is penetrating becomes a
 * contact, and each contact gets a normal impulse (with restitution) and a
 * Coulomb friction impulse applied at that point — which is what makes a box
 * dropped on an edge topple rather than sink, and a cone struck at the base
 * fly rather than slide. Positions are corrected straight after, so nothing
 * sinks through the floor while the velocities settle.
 *
 * WHAT MAKES IT AFFORDABLE. Bodies sleep: once one has been nearly still for
 * half a second it stops integrating entirely until something touches it, so
 * a street full of clutter costs nothing until you drive into it. Bodies far
 * from the action are frozen outright. And the broadphase for static boxes is
 * the same bounding-sphere test the capsule sweep already uses.
 */

const GRAVITY = -19.6;            // 2g: game-feel gravity, matching the player
const SLEEP_LIN = 0.16;           // m/s below which a body counts as still
const SLEEP_ANG = 0.35;           // rad/s ditto
const SLEEP_TIME = 0.5;
const CRAWL_TIME = 3.5;           // barely moving for this long: put it down anyway
const MAX_STEP = 1 / 45;

// Contacts are found with a MARGIN, before anything has actually gone inside
// anything. Without it a resting box falls freely for several frames, is
// found deep inside the floor, is shoved back out above it, and falls again:
// it never stops moving, so it never sleeps, and the error compounds until it
// is doing thousands of metres a second. SLOP is the penetration we are happy
// to live with, so a settled box is left completely alone.
const MARGIN = 0.035;
const SLOP = 0.008;
const BETA = 0.55;                // how much of the excess is corrected per step
const MAX_CORRECT = 0.22;         // and never more than this in one go
const MAX_LIN = 70;               // a backstop: nothing in a city moves faster
const MAX_ANG = 24;

// Body-against-body. A slightly wider margin than the static case, because
// two things that are both moving need to find each other a frame earlier.
const PAIR_MARGIN = 0.045;
const PAIR_CELL = 2.2;
/** How much of a pair impulse's spin actually lands. See _applyPair. */
const PAIR_SPIN = 0.0;
/**
 * Penetration between two bodies that is simply left alone — deliberately
 * looser than the world's SLOP.
 *
 * Positional correction is not subject to friction: it moves a body along the
 * contact normal whatever is in the way. The box underneath is never exactly
 * level (its own ground contact leaves it a fraction of a degree off), so the
 * normal is a fraction of a degree off vertical, so every frame the box on top
 * gets pushed very slightly sideways — and a resting object that is corrected
 * every single frame never stops, never sleeps, and walks across the street
 * over a minute or two. Widening the band it is happy to sit in ends the
 * correction, and the pile settles and goes quiet.
 */
const PAIR_SLOP = 0.008;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _m3b = new THREE.Matrix3();
const _m4 = new THREE.Matrix4();
const _push = new THREE.Vector3();
const _o = new THREE.Vector3();
const _idx = new Int32Array(24);
const _ja = new THREE.Vector3();
const _jb = new THREE.Vector3();
const _jd = new THREE.Vector3();
const _jv = new THREE.Vector3();
const _jw = new THREE.Vector3();
const _jt = new THREE.Vector3();
const _ju = new THREE.Vector3();
const _jimp = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _mA = new THREE.Matrix3();
const _mB = new THREE.Matrix3();
const _qi = new THREE.Quaternion();
const _ra = new THREE.Vector3();
const _rb = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _sep = new THREE.Vector3();
const _pn = new THREE.Vector3();
const _axes = [];
for (let i = 0; i < 6; i++) _axes.push(new THREE.Vector3());
const _order = new Int32Array(8);
const _corners = [];
const _cornB = [];
for (let i = 0; i < 8; i++) { _corners.push(new THREE.Vector3()); _cornB.push(new THREE.Vector3()); }

let bodySeq = 0;

/** One dynamic box. */
export class Body {
  constructor(opts = {}) {
    const h = opts.half || new THREE.Vector3(0.3, 0.3, 0.3);
    this.half = h.clone();
    this.mass = opts.mass ?? 8;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.pos = (opts.pos || new THREE.Vector3()).clone();
    this.quat = (opts.quat || new THREE.Quaternion()).clone();
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();
    this.restitution = opts.restitution ?? 0.18;
    this.friction = opts.friction ?? 0.62;
    this.drag = opts.drag ?? 0.12;
    this.angDrag = opts.angDrag ?? 0.35;
    this.radius = this.half.length();
    // Box inertia, and its inverse in body space.
    const m = this.mass;
    const w2 = (2 * h.x) ** 2, h2 = (2 * h.y) ** 2, d2 = (2 * h.z) ** 2;
    const ix = (m / 12) * (h2 + d2), iy = (m / 12) * (w2 + d2), iz = (m / 12) * (w2 + h2);
    this.invI = new THREE.Vector3(ix > 0 ? 1 / ix : 0, iy > 0 ? 1 / iy : 0, iz > 0 ? 1 / iz : 0);
    this.sleeping = false;
    this._still = 0;
    this.mesh = opts.mesh || null;     // optional: a mesh to drive
    this.onSettle = opts.onSettle || null;
    this.userData = opts.userData || {};
    this.buoyancy = opts.buoyancy ?? 0; // >0: floats at the water line
    this.offset = opts.offset || null;  // mesh origin relative to the centre
    this.id = ++bodySeq;                // stable, for pair de-duplication
    /** Bodies sharing a group never collide — a ragdoll's own limbs overlap. */
    this.group = opts.group;
    this.alive = true;
  }

  /** World-space inverse inertia tensor, rebuilt from the current rotation. */
  _invInertiaWorld(out) {
    _m4.makeRotationFromQuaternion(this.quat);
    _m3.setFromMatrix4(_m4);
    const e = _m3.elements;
    const I = this.invI;
    // R * diag(invI) * R^T, written out.
    const a = [e[0] * I.x, e[3] * I.y, e[6] * I.z,
      e[1] * I.x, e[4] * I.y, e[7] * I.z,
      e[2] * I.x, e[5] * I.y, e[8] * I.z];
    out.set(
      a[0] * e[0] + a[1] * e[3] + a[2] * e[6], a[0] * e[1] + a[1] * e[4] + a[2] * e[7], a[0] * e[2] + a[1] * e[5] + a[2] * e[8],
      a[3] * e[0] + a[4] * e[3] + a[5] * e[6], a[3] * e[1] + a[4] * e[4] + a[5] * e[7], a[3] * e[2] + a[4] * e[5] + a[5] * e[8],
      a[6] * e[0] + a[7] * e[3] + a[8] * e[6], a[6] * e[1] + a[7] * e[4] + a[8] * e[7], a[6] * e[2] + a[7] * e[5] + a[8] * e[8]
    );
    return out;
  }

  wake() {
    this.sleeping = false;
    this._still = 0;
  }

  /** An impulse at a world point: the only way anything gets moved in here. */
  applyImpulse(j, point) {
    if (this.invMass === 0) return;
    this.wake();
    this.vel.addScaledVector(j, this.invMass);
    _r.subVectors(point, this.pos);
    _v2.crossVectors(_r, j);
    const II = this._invInertiaWorld(_m3b);
    _v2.applyMatrix3(II);
    this.ang.add(_v2);
  }

  /**
   * Push the mesh (if any) to wherever the body ended up.
   *
   * `offset` is for meshes whose origin is not their centre of mass — a car
   * is modelled standing on the road but tumbles about its middle, so the
   * group has to be placed half a body-height below the body, in the body's
   * own frame rather than the world's.
   */
  sync() {
    if (!this.mesh) return;
    if (this.offset) {
      _o.copy(this.offset).applyQuaternion(this.quat);
      this.mesh.position.copy(this.pos).add(_o);
    } else {
      this.mesh.position.copy(this.pos);
    }
    this.mesh.quaternion.copy(this.quat);
  }
}

export class RigidWorld {
  /** @param {import('./PhysicsWorld.js').PhysicsWorld} phys the static world */
  constructor(phys) {
    this.phys = phys;
    this.bodies = [];
    this.awake = 0;
    /** Bodies beyond this from the focus point are not simulated at all. */
    this.range = 190;
    this.waterAt = null;            // (x, z) => surface height, or null
    this.surfaceAt = null;          // (x, z) => ground height, for unsticking
    /** Distance joints, solved after the contacts. See addJoint. */
    this.joints = [];
    // Reused contact records: eight corners against the floor and a handful
    // of walls is the realistic worst case, and nothing here allocates.
    this._contacts = [];
    for (let i = 0; i < 24; i++) {
      this._contacts.push({ point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 });
    }
    // Body-against-body: the active set for this substep, a hash over it, a
    // small contact pool for one pair, and the pair de-duplication stamps.
    this._act = [];
    this._wake = [];
    /** Last frame's contact impulses, keyed by pair and corner. See _collidePair. */
    this._cache = new Map();
    this._pairGrid = new Map();
    this._seen = new Map();
    this._pairStamp = 0;
    this._pairCts = [];
    for (let i = 0; i < 8; i++) {
      this._pairCts.push({ point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 });
    }
    /** Turn off to get the old behaviour: everything ghosting through everything. */
    this.pairs = true;
  }

  /**
   * A bullet, a fist, a thrown thing: a push at a point, in a direction.
   *
   * Different from `blast`, which is radial and throws everything away from a
   * centre. This is directional, so a round through a traffic cone sends it
   * the way the round was going, and one that clips the top of a crate tips
   * the crate rather than sliding it.
   */
  impact(x, y, z, dir, force = 1, radius = 0.5) {
    for (const b of this.bodies) {
      if (!b.alive || b.invMass === 0) continue;
      const dx = b.pos.x - x, dy = b.pos.y - y, dz = b.pos.z - z;
      const reach = radius + b.radius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      // Applied AT the strike point, so where you hit it decides whether it
      // slides, spins or goes over.
      _p.set(x, y, z);
      _v.copy(dir).normalize().multiplyScalar(force * Math.max(1.4, b.mass * 0.4));
      b.applyImpulse(_v, _p);
      b.wake();
    }
  }

  add(body) {
    this.bodies.push(body);
    return body;
  }

  /**
   * Pin a point on one body to a point on another.
   *
   * This is what turns a pile of boxes into a body that hangs together: a
   * head that stays on its shoulders while both are being thrown down a road.
   * It is a distance constraint rather than a real joint — no cone limits, no
   * motors — because a ragdoll seen from a car does not need elbows that
   * refuse to bend backwards, it needs limbs that stay attached and swing.
   *
   * @param a,b     the two bodies
   * @param ra,rb   the anchor on each, in that body's own frame
   * @param rest    how far apart the anchors should sit (0 pins them together)
   */
  addJoint(a, b, ra, rb, rest = 0) {
    const j = { a, b, ra: ra.clone(), rb: rb.clone(), rest };
    this.joints.push(j);
    return j;
  }

  /**
   * Sequential impulses along each joint's axis.
   *
   * Four passes, because a chain (head to torso to leg) only propagates one
   * link per pass and a ragdoll that is solved once per frame comes apart at
   * the extremities the moment it is hit hard. The bias term pulls the joint
   * back toward its rest length rather than only cancelling the velocity
   * across it, so drift under load is corrected instead of accumulating.
   */
  _solveJoints(dt) {
    const js = this.joints;
    if (!js.length) return;
    for (let it = 0; it < 4; it++) {
      for (let k = 0; k < js.length; k++) {
        const j = js[k];
        const a = j.a, b = j.b;
        if (!a.alive || !b.alive) continue;
        if (a.sleeping && b.sleeping) continue;
        _ja.copy(j.ra).applyQuaternion(a.quat);
        _jb.copy(j.rb).applyQuaternion(b.quat);
        _pa.copy(a.pos).add(_ja);
        _pb.copy(b.pos).add(_jb);
        _jd.subVectors(_pb, _pa);
        const dist = _jd.length();
        if (dist < 1e-6) continue;
        const err = dist - j.rest;
        _jd.divideScalar(dist);

        // Relative velocity of the two anchor points, along the joint.
        _jv.crossVectors(b.ang, _jb).add(b.vel);
        _jw.crossVectors(a.ang, _ja).add(a.vel);
        _jv.sub(_jw);
        const vn = _jv.dot(_jd);

        // Deadband. A joint within a couple of millimetres of where it wants
        // to be, on parts that are barely moving, is finished.
        if (Math.abs(err) < 0.002 && Math.abs(vn) < 0.02) continue;

        const ia = a._invInertiaWorld(_mA);
        const ib = b._invInertiaWorld(_mB);
        _jt.crossVectors(_ja, _jd).applyMatrix3(ia).cross(_ja);
        _ju.crossVectors(_jb, _jd).applyMatrix3(ib).cross(_jb);
        const denom = a.invMass + b.invMass + _jt.dot(_jd) + _ju.dot(_jd);
        if (denom <= 1e-9) continue;

        // No positional bias here. Folding the position error into the
        // velocity impulse is what made a ragdoll lying still in the road
        // hum: the contacts push a limb out, the joint's bias converts that
        // displacement into velocity, the contacts take it out again, and
        // every part stays a hair above the sleep threshold forever. The
        // error is corrected below instead, where it moves positions without
        // leaving anything behind in the velocities.
        const imp = -vn / denom;
        _jimp.copy(_jd).multiplyScalar(imp);
        b.applyImpulse(_jimp, _pb);
        _jimp.copy(_jd).multiplyScalar(-imp);
        a.applyImpulse(_jimp, _pa);
      }
    }

    // --- Drift ---------------------------------------------------------------
    // What the velocity pass could not reach: the two anchors are simply
    // moved back together, split by inverse mass, so a light arm travels
    // further than the torso it hangs off. Purely positional, so it cannot
    // add energy.
    for (let it = 0; it < 2; it++) {
      for (let k = 0; k < js.length; k++) {
        const j = js[k];
        const a = j.a, b = j.b;
        if (!a.alive || !b.alive) continue;
        if (a.sleeping && b.sleeping) continue;
        const wSum = a.invMass + b.invMass;
        if (wSum <= 0) continue;
        _ja.copy(j.ra).applyQuaternion(a.quat);
        _jb.copy(j.rb).applyQuaternion(b.quat);
        _pa.copy(a.pos).add(_ja);
        _pb.copy(b.pos).add(_jb);
        _jd.subVectors(_pb, _pa);
        const dist = _jd.length();
        if (dist < 1e-6) continue;
        const err = dist - j.rest;
        if (Math.abs(err) < 0.0015) continue;
        _jd.divideScalar(dist);
        const corr = err * 0.55;
        a.pos.addScaledVector(_jd, corr * (a.invMass / wSum));
        b.pos.addScaledVector(_jd, -corr * (b.invMass / wSum));
      }
    }
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  clear() {
    this.bodies.length = 0;
  }

  /** Wake everything within `r` of a point — an explosion, a crash, a footstep. */
  wakeNear(x, z, r) {
    const r2 = r * r;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if ((b.pos.x - x) ** 2 + (b.pos.z - z) ** 2 < r2) b.wake();
    }
  }

  /**
   * A blast: everything in range gets an impulse away from the centre, scaled
   * by distance, applied a little above its centre of mass so things tumble
   * rather than slide.
   */
  blast(x, y, z, power = 1, radius = 12) {
    for (const b of this.bodies) {
      if (!b.alive || b.invMass === 0) continue;
      _v.set(b.pos.x - x, b.pos.y - y, b.pos.z - z);
      const d = _v.length();
      if (d > radius || d < 1e-4) continue;
      const fall = 1 - d / radius;
      _v.divideScalar(d);
      _v.y += 0.55;
      _v.normalize().multiplyScalar(power * fall * b.mass * 2.4);
      _p.copy(b.pos);
      _p.y += b.half.y * 0.6;
      b.applyImpulse(_v, _p);
    }
  }

  /**
   * Shove anything inside a moving box — a car, a door, a boat hull. The
   * impulse comes from the MOVER's velocity, so a parked car does nothing and
   * one at speed sends a bin over a roof.
   */
  sweepBox(center, half, quat, velocity, opts = {}) {
    const massFactor = opts.massFactor ?? 1;
    const speed = velocity.length();
    const qi = quat ? _q.copy(quat).invert() : null;
    let hit = null;
    for (const b of this.bodies) {
      if (!b.alive || b.invMass === 0) continue;
      const dx = b.pos.x - center.x, dy = b.pos.y - center.y, dz = b.pos.z - center.z;
      const reach = half.length() + b.radius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      // Into the mover's local frame, then a box-vs-sphere test.
      _local.set(dx, dy, dz);
      if (qi) _local.applyQuaternion(qi);
      const cx = Math.max(-half.x, Math.min(half.x, _local.x));
      const cy = Math.max(-half.y, Math.min(half.y, _local.y));
      const cz = Math.max(-half.z, Math.min(half.z, _local.z));
      _v.set(_local.x - cx, _local.y - cy, _local.z - cz);
      const dist = _v.length();
      if (dist > b.radius * 0.85) continue;
      // Contact normal: out of the mover's surface, in world space.
      if (dist > 1e-4) _v.divideScalar(dist);
      else _v.set(_local.x, 0, _local.z).normalize();
      _n.copy(_v);
      if (quat) _n.applyQuaternion(quat);
      _n.y = Math.max(_n.y, -0.2);
      _n.normalize();
      // Separate, then hand over momentum.
      const pen = b.radius * 0.85 - dist;
      b.pos.addScaledVector(_n, pen * 0.9);
      // Already leaving faster than the mover? Separate it and leave it be,
      // otherwise a car overlapping a cone for six frames hits it six times.
      const closing = velocity.dot(_n) - b.vel.dot(_n);
      if (closing <= 0.1) { b.wake(); continue; }
      const along = Math.max(0, velocity.dot(_n));
      const j = _v2.copy(_n).multiplyScalar(b.mass * (1.1 + along * 0.9) * massFactor)
        .addScaledVector(velocity, b.mass * 0.32 * massFactor);
      _p.copy(b.pos);
      _p.y -= b.half.y * 0.45;         // below the centre: it tips as it goes
      b.applyImpulse(j, _p);
      b.wake();
      hit = b;
      if (speed > 3 && opts.onHit) opts.onHit(b, speed);
    }
    return hit;
  }

  /** The player walking into things: a gentle nudge, never a launch. */
  pushCapsule(pos, radius, height, velocity) {
    for (const b of this.bodies) {
      if (!b.alive || b.invMass === 0) continue;
      const dx = b.pos.x - pos.x, dz = b.pos.z - pos.z;
      const dy = b.pos.y - (pos.y + height * 0.5);
      const reach = radius + b.radius;
      if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > height * 0.5 + b.radius) continue;
      const d = Math.hypot(dx, dz) || 1e-4;
      _n.set(dx / d, 0, dz / d);
      const pen = reach - d;
      if (pen <= 0) continue;
      b.pos.addScaledVector(_n, pen * 0.5);
      const push = Math.min(3.2, velocity.length());
      _v2.copy(_n).multiplyScalar(b.mass * (0.5 + push * 0.55));
      _p.copy(b.pos);
      _p.y -= b.half.y * 0.3;
      b.applyImpulse(_v2, _p);
    }
  }

  // ------------------------------------------------------------------ step

  step(dt, focus) {
    // Fixed-ish stepping: one long frame must not launch everything.
    let remaining = Math.min(dt, 0.1);
    let guard = 0;
    while (remaining > 1e-4 && guard++ < 4) {
      const h = Math.min(MAX_STEP, remaining);
      this._substep(h, focus);
      remaining -= h;
    }
  }

  _substep(dt, focus) {
    const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
    const r2 = this.range * this.range;
    let awake = 0;
    // The active set: everything near enough to matter, asleep or not. A
    // sleeping crate still has to be something you can stack a box on.
    const act = this._act;
    act.length = 0;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if ((b.pos.x - fx) ** 2 + (b.pos.z - fz) ** 2 > r2) continue;
      act.push(b);
    }
    // Everything awake, integrated first as a set. Integrating and colliding
    // one body at a time meant the second body's contacts were solved against
    // the first body's ALREADY-corrected state, which is fine while nothing
    // touches anything and wrong the moment two bodies do.
    const wake = this._wake;
    wake.length = 0;
    for (let ai = 0; ai < act.length; ai++) {
      const b = act[ai];
      if (b.sleeping) continue;
      wake.push(b);
      awake++;
      this._integrate(b, dt);
    }
    for (let i = 0; i < wake.length; i++) this._collide(wake[i], dt);

    // Bodies against each other — and then the world AGAIN, so the ground has
    // the last word.
    //
    // Without that second pass a stack sinks. The pair contact between a crate
    // and the crate under it conserves momentum between the two of them, which
    // means it answers "the top one is falling" by splitting the difference:
    // the top one slows and the BOTTOM one is driven downward. The bottom one
    // had already been stopped by the floor earlier in the substep and nothing
    // was left to stop it again, so every frame the whole tower was handed a
    // little more downward speed and the pile ground its way into the road.
    if (this.pairs && awake) {
      this._solvePairs(dt);
      for (let i = 0; i < wake.length; i++) this._collide(wake[i], dt);
    }

    // Joints last, so they pull against the positions the contacts settled on
    // rather than being immediately undone by them.
    this._solveJoints(dt);

    for (let i = 0; i < wake.length; i++) {
      const b = wake[i];
      // Settle test: still for long enough and it stops costing anything.
      //
      // The second clause is a hard cap, and it is there because of the
      // body-against-body pass. Positional correction between two bodies is
      // not subject to friction, and the thing underneath is never exactly
      // level, so anything resting on anything gets nudged a hair sideways
      // every frame. It converges — but asymptotically, and a dozen objects
      // sliding across the street at a tenth of a metre a second, forever, is
      // both visible and a cost that never ends. Anything that has been going
      // this slowly for this long has finished moving in every sense that
      // matters, so it is put down where it is.
      const slow = b.vel.lengthSq() < SLEEP_LIN * SLEEP_LIN && b.ang.lengthSq() < SLEEP_ANG * SLEEP_ANG;
      const crawling = b.vel.lengthSq() < 0.55 * 0.55 && b.ang.lengthSq() < 2.2 * 2.2;
      if (slow || crawling) {
        b._still += dt;
        if (b._still > (slow ? SLEEP_TIME : CRAWL_TIME)) {
          b.sleeping = true;
          b.vel.set(0, 0, 0);
          b.ang.set(0, 0, 0);
          if (b.onSettle) b.onSettle(b);
        }
      } else {
        b._still = 0;
      }
      b.sync();
    }
    this.awake = awake;
  }

  /**
   * Bodies against each other.
   *
   * Until now every loose object in the world was solid against the CITY and
   * transparent to everything else. Crates fell through crates. A ragdoll lay
   * half inside the wreck that had killed it. A blast threw twenty bins into
   * one corner and they all occupied the same corner. It was the largest
   * remaining hole in the whole thing: a heap of objects was a heap only
   * until you looked at it.
   *
   * The broadphase is a spatial hash over the active set, rebuilt every
   * substep. Rebuilding sounds wasteful and is not — the active set is the
   * few dozen things near the player, the cell is about the size of a crate,
   * and keeping an incremental structure correct while an explosion is
   * throwing bodies across the street costs more than it saves.
   *
   * A pair is only tested when at least one of the two is awake: two boxes
   * that have both settled against each other have nothing left to say.
   */
  _solvePairs(dt) {
    const act = this._act;
    const grid = this._pairGrid;
    grid.clear();
    const inv = 1 / PAIR_CELL;
    for (let i = 0; i < act.length; i++) {
      const b = act[i];
      const r = b.radius;
      const x0 = Math.floor((b.pos.x - r) * inv), x1 = Math.floor((b.pos.x + r) * inv);
      const y0 = Math.floor((b.pos.y - r) * inv), y1 = Math.floor((b.pos.y + r) * inv);
      const z0 = Math.floor((b.pos.z - r) * inv), z1 = Math.floor((b.pos.z + r) * inv);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (let z = z0; z <= z1; z++) {
            const k = ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
            let list = grid.get(k);
            if (!list) { list = []; grid.set(k, list); }
            list.push(b);
          }
        }
      }
    }

    // Two passes. One is not enough for a stack, where the bottom box only
    // learns about the weight on it after the top one has been dealt with.
    for (let it = 0; it < 2; it++) {
      const st = ++this._pairStamp;
      for (const list of grid.values()) {
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            if (a.sleeping && b.sleeping) continue;
            if (a.invMass === 0 && b.invMass === 0) continue;
            // Parts of the same ragdoll ignore each other: they overlap by
            // design, and making a shoulder solid against its own arm tears
            // the joints holding them together apart.
            if (a.group !== undefined && a.group === b.group) continue;
            // A pair sits in every cell that both bodies touch, so it comes
            // round several times in one pass.
            const key = a.id < b.id ? a.id * 1048576 + b.id : b.id * 1048576 + a.id;
            if (this._seen.get(key) === st) continue;
            this._seen.set(key, st);
            this._collidePair(a, b, dt);
          }
        }
      }
    }
    // Both of these grow without bound otherwise — a rampage touches thousands
    // of distinct pairs and nothing ever removes them. Dropping the impulse
    // cache costs one frame of warm starting, which nothing can see.
    if (this._seen.size > 20000) this._seen.clear();
    if (this._cache.size > 8000) {
      const cut = this._pairStamp - 240;
      for (const [k, slot] of this._cache) if (slot.stamp < cut) this._cache.delete(k);
    }
  }

  /** Corners of a body into a caller-supplied array. */
  _cornersInto(b, out) {
    const h = b.half;
    let i = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          out[i].set(sx * h.x, sy * h.y, sz * h.z).applyQuaternion(b.quat).add(b.pos);
          i++;
        }
      }
    }
    return out;
  }

  /**
   * The direction two boxes have to move to stop overlapping.
   *
   * The static pass gets away with deciding this per corner — "leave by the
   * nearest face of the box you are inside" — because the thing it is leaving
   * is a wall or a road plate, and a corner just inside one of those really is
   * nearest to the face it came through.
   *
   * Between two loose boxes it is wrong, and wrong in the worst possible way.
   * Drop a crate squarely onto another crate: the falling crate's bottom
   * corners end up a few centimetres inside the top face, but they are also
   * sitting right at the side faces, so "nearest face" is a SIDE, the escape
   * direction is sideways, and the depth along it is zero. The crates settle
   * into each other and stay there. Two boxes stacked is the single most
   * obvious thing this whole pass exists to do, and it was the one case the
   * corner test could not handle.
   *
   * So: the penetration axis is decided ONCE for the pair, by projecting both
   * boxes onto each of their six face normals and taking the axis with the
   * least overlap. That is the face half of a separating-axis test. The nine
   * edge-edge cross-product axes are left out; skipping them means two boxes
   * meeting corner-to-corner resolve along a face instead of an edge, which
   * looks the same for city clutter and costs a third of the work.
   *
   * @returns the overlap depth, or -1 if the boxes are apart
   */
  _pairAxis(a, b, out) {
    _mat.makeRotationFromQuaternion(a.quat);
    const ea = _mat.elements;
    _axes[0].set(ea[0], ea[1], ea[2]);
    _axes[1].set(ea[4], ea[5], ea[6]);
    _axes[2].set(ea[8], ea[9], ea[10]);
    _mat.makeRotationFromQuaternion(b.quat);
    const eb = _mat.elements;
    _axes[3].set(eb[0], eb[1], eb[2]);
    _axes[4].set(eb[4], eb[5], eb[6]);
    _axes[5].set(eb[8], eb[9], eb[10]);

    _sep.subVectors(a.pos, b.pos);            // from B toward A
    let best = Infinity, bi = -1;
    for (let i = 0; i < 6; i++) {
      const n = _axes[i];
      const ra = a.half.x * Math.abs(_axes[0].dot(n))
        + a.half.y * Math.abs(_axes[1].dot(n))
        + a.half.z * Math.abs(_axes[2].dot(n));
      const rb = b.half.x * Math.abs(_axes[3].dot(n))
        + b.half.y * Math.abs(_axes[4].dot(n))
        + b.half.z * Math.abs(_axes[5].dot(n));
      // The margin matters as much here as it does against the world. Without
      // it a box resting on a box is only a contact on the frames where it has
      // actually sunk INTO the other one: it falls a hair, is caught, is
      // pushed back out to touching, is not a contact any more, and falls
      // again. It never holds a steady contact, so there is nothing for the
      // impulse cache to warm-start from and nothing for friction to grip
      // with, and the thing on top wanders off. Allowing a small negative
      // overlap makes it a contact BEFORE it is a penetration.
      const overlap = ra + rb - Math.abs(_sep.dot(n));
      if (overlap <= -PAIR_MARGIN) return -1;   // a real gap: they are apart
      if (overlap < best) { best = overlap; bi = i; }
    }
    out.copy(_axes[bi]);
    if (out.dot(_sep) < 0) out.negate();      // always points from B toward A
    // Which box owns the face the other one is resting on. The contact points
    // have to come from the OTHER box, not both — see _collidePair.
    this._refIsA = bi < 3;
    return best;
  }

  /**
   * One pair of boxes: find the axis, find where they touch, resolve.
   *
   * The contact POINTS still come from corners inside the other box, because
   * that is what gives a face contact its four separate points and therefore
   * its resistance to tipping. Only the direction comes from the axis test. If
   * no corner is inside either box — a shallow edge-on touch — one contact is
   * placed on the overlapping surface so the pair still separates.
   */
  _collidePair(a, b, dt) {
    // Canonical order. The grid hands pairs over in whatever order the cell
    // happened to be filled, and that order can flip from one substep to the
    // next — which flips the contact normal, flips which box the contact
    // points come off, and turns a steady resting contact into one that is
    // solved from a different side every frame.
    if (a.id > b.id) { const t = a; a = b; b = t; }
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
    const reach = a.radius + b.radius + PAIR_MARGIN;
    if (dx * dx + dy * dy + dz * dz > reach * reach) return;

    // `depth` can come back slightly negative: touching, not yet overlapping.
    // That is a contact worth solving — the velocity pass ignores anything
    // that is separating anyway, and the positional pass only fires past SLOP.
    const depth = this._pairAxis(a, b, _pn);
    if (depth <= -PAIR_MARGIN) return;

    const cs = this._pairCts;
    let n = 0;

    // The contact points come from ONE box: the one resting on the other's
    // face. Taking corners from both gives eight points describing the same
    // single face, which is the same contact counted twice — twice the
    // stiffness, and every asymmetry in it applied as torque. A tower of three
    // crates built that way tipped itself over and slid apart within a second.
    // Four points off the incident face is the whole manifold.
    const ref = this._refIsA ? a : b;      // owns the face
    const inc = this._refIsA ? b : a;      // rests on it
    // Key for the impulse cache: this pair, this side, this corner.
    const base = ((a.id * 1048576 + b.id) * 2 + (this._refIsA ? 0 : 1)) * 8;
    // The manifold is the four corners of the incident box's nearest face,
    // CLIPPED into the reference face — not "whichever corners happen to test
    // as inside".
    //
    // That test was the whole problem. Set a crate down squarely on another
    // crate and its bottom corners land exactly on the edges of the face
    // below: |x| is 0.4 and the limit is 0.4, so whether a corner counts comes
    // down to the last bit of a float. Some frames gave four contacts, some
    // three, some two — and a three-point manifold on a symmetric contact is a
    // lever. That is where half a radian a second of spin was coming from out
    // of a dead-level start, and no amount of extra solver sweeps could fix
    // it, because the sweeps were faithfully solving a lopsided problem.
    //
    // Taking the four deepest corners always gives four points, and clamping
    // them into the reference box puts them where the surfaces actually meet.
    _qi.copy(ref.quat).invert();
    const pts = this._cornersInto(inc, _corners);
    for (let i = 0; i < 8; i++) _order[i] = i;
    // Deepest first: most negative along the normal is furthest into `ref`.
    for (let i = 1; i < 8; i++) {
      const key = _order[i];
      const kd = pts[key].dot(_pn);
      let j = i - 1;
      while (j >= 0 && pts[_order[j]].dot(_pn) > kd) { _order[j + 1] = _order[j]; j--; }
      _order[j + 1] = key;
    }
    for (let k = 0; k < 4; k++) {
      const i = _order[k];
      _v.subVectors(pts[i], ref.pos).applyQuaternion(_qi);
      _v.x = Math.max(-ref.half.x, Math.min(ref.half.x, _v.x));
      _v.y = Math.max(-ref.half.y, Math.min(ref.half.y, _v.y));
      _v.z = Math.max(-ref.half.z, Math.min(ref.half.z, _v.z));
      const ct = cs[n++];
      ct.normal.copy(_pn);
      ct.point.copy(_v).applyQuaternion(ref.quat).add(ref.pos);
      ct.depth = depth;
      ct.key = base + i;
      ct.tv = -1;
      const old = this._cache.get(ct.key);
      ct.sumN = old ? old.n : 0;
      ct.sumT = old ? old.t : 0;
    }

    // --- Warm start -----------------------------------------------------------
    // Re-apply last frame's impulses before solving anything.
    //
    // This is what makes a stack stand up. Four corner contacts solved one
    // after another can never come out perfectly even: each corner is solved
    // against a body the previous ones have already started to turn, and three
    // sweeps a frame gets close but leaves a little torque, always biased the
    // same way. On a box resting on a box that bias adds up over a couple of
    // seconds until it has tilted far enough to slide off. Starting each frame
    // from the answer the last frame converged on means the sweeps are
    // correcting a nearly-solved system rather than solving it from cold, and
    // the leftover torque goes with it.
    for (let k = 0; k < n; k++) {
      const ct = cs[k];
      if (!ct.sumN && !ct.sumT) continue;
      _v2.copy(ct.normal).multiplyScalar(ct.sumN);
      this._applyPair(a, _v2, ct.point);
      _v2.copy(ct.normal).multiplyScalar(-ct.sumN);
      this._applyPair(b, _v2, ct.point);
    }

    // Three sweeps over the manifold.
    for (let it = 0; it < 3; it++) {
      for (let k = 0; k < n; k++) this._resolvePair(a, b, cs[k], dt);
    }

    for (let k = 0; k < n; k++) {
      const ct = cs[k];
      if (ct.key < 0) continue;
      let slot = this._cache.get(ct.key);
      if (!slot) { slot = { n: 0, t: 0, stamp: 0 }; this._cache.set(ct.key, slot); }
      slot.n = ct.sumN;
      slot.t = ct.sumT;
      slot.stamp = this._pairStamp;
    }

    // Separation, split by weight: a bin shoved by a crate moves, and a crate
    // shoved by a bin mostly does not.
    if (depth > PAIR_SLOP) {
      const wSum = a.invMass + b.invMass;
      if (wSum > 1e-9) {
        const corr = Math.min((depth - PAIR_SLOP) * BETA, MAX_CORRECT);
        a.pos.addScaledVector(_pn, corr * (a.invMass / wSum));
        b.pos.addScaledVector(_pn, -corr * (b.invMass / wSum));
      }
    }
    // Anything still badly overlapped is NOT settled, whatever its velocity
    // says. Separation is positional and adds no velocity, so a crate half
    // inside another crate reads as perfectly still, hits the sleep timer
    // half a second later, and freezes there — which is how a stack of three
    // ended up as one box with two others buried in it.
    if (depth > PAIR_SLOP * 3) { a._still = 0; b._still = 0; }

    // --- Resting stabilisation ----------------------------------------------
    // Sequential impulses at four corners cannot help leaving a little net
    // spin behind: each corner is solved against a body the previous corners
    // have already started turning, and a few sweeps per frame is not enough
    // to cancel that exactly. On a thrown object it is invisible. On one that
    // is just sitting on another one it accumulates, frame after frame, until
    // the box has tilted enough to slide off something it was resting on
    // perfectly squarely.
    //
    // The real answer is persistent contact manifolds carried between frames
    // with warm-started impulses, which is a different and much larger piece
    // of machinery. This is the standard cheap one: when a pair is in contact
    // and neither is actually going anywhere, bleed the spin. It has no effect
    // on anything that has just been hit — the gate is relative speed — and it
    // is what keeps a pile a pile.
    _rel.subVectors(a.vel, b.vel);
    if (_rel.lengthSq() < 0.25) {
      const k = Math.max(0, 1 - 9 * dt);
      a.ang.multiplyScalar(k);
      b.ang.multiplyScalar(k);
    }
  }

  /**
   * One contact between two bodies: bounce, then rub.
   *
   * The impulses are ACCUMULATED per contact and the running total is clamped,
   * rather than each sweep applying a fresh impulse of its own. It matters
   * more than it sounds. A box resting on another box has four corner
   * contacts solved one after another; the first one cancels the velocity at
   * its own corner, which rotates the box a little, and the other three then
   * see a body that is already turning. Without accumulation a later sweep can
   * only ever ADD more impulse — it has no way to give back the excess the
   * first one applied — so every frame leaves a little more spin than it
   * found. It is not visible for a second or two, and then the box tips off
   * the one underneath it. Clamping the TOTAL to be non-negative instead lets
   * a later sweep apply a negative correction and undo that spin, which is the
   * difference between a stack and a slow-motion collapse.
   */
  _resolvePair(a, b, ct, dt) {
    const nrm = ct.normal;                  // points from B toward A
    _ra.subVectors(ct.point, a.pos);
    _rb.subVectors(ct.point, b.pos);
    _rel.crossVectors(a.ang, _ra).add(a.vel);
    _tmp.crossVectors(b.ang, _rb).add(b.vel);
    _rel.sub(_tmp);
    const vn = _rel.dot(nrm);

    const ia = a._invInertiaWorld(_mA);
    const ib = b._invInertiaWorld(_mB);
    _tmp.crossVectors(_ra, nrm).applyMatrix3(ia).cross(_ra);
    _tmp2.crossVectors(_rb, nrm).applyMatrix3(ib).cross(_rb);
    const denom = a.invMass + b.invMass + _tmp.dot(nrm) + _tmp2.dot(nrm);
    if (denom <= 1e-9) return;

    // Restitution is decided once, from the speed they actually met at, and
    // then held for the rest of the sweeps. Recomputing it each sweep would
    // let a contact bounce off its own corrections.
    if (ct.tv < 0) ct.tv = -vn > 1.2 ? Math.min(a.restitution, b.restitution) * -vn : 0;

    let jn = (ct.tv - vn) / denom;
    const newN = Math.max(0, ct.sumN + jn);
    jn = newN - ct.sumN;
    ct.sumN = newN;
    if (jn !== 0) {
      _v2.copy(nrm).multiplyScalar(jn);
      this._applyPair(a, _v2, ct.point);
      _v2.copy(nrm).multiplyScalar(-jn);
      this._applyPair(b, _v2, ct.point);
    }
    if (ct.sumN <= 0) return;               // not actually pressed together

    // Friction across the contact, from whatever sliding is left.
    _rel.crossVectors(a.ang, _ra).add(a.vel);
    _tmp.crossVectors(b.ang, _rb).add(b.vel);
    _rel.sub(_tmp);
    _tan.copy(_rel).addScaledVector(nrm, -_rel.dot(nrm));
    const tl = _tan.length();
    if (tl < 1e-6) return;
    _tan.divideScalar(tl);
    _tmp.crossVectors(_ra, _tan).applyMatrix3(ia).cross(_ra);
    _tmp2.crossVectors(_rb, _tan).applyMatrix3(ib).cross(_rb);
    const dt2 = a.invMass + b.invMass + _tmp.dot(_tan) + _tmp2.dot(_tan);
    if (dt2 <= 1e-9) return;
    // Clamped against the TOTAL normal impulse this contact has taken. By the
    // third sweep the normal velocity is already cancelled, so the sweep's own
    // increment is nearly zero, and a friction limit of mu times nearly zero
    // is no friction at all — the boxes end up on ice exactly when they have
    // settled enough to need friction most.
    const mu = Math.min(a.friction, b.friction);
    const max = mu * ct.sumN;
    let jt = -tl / dt2;
    const newT = Math.max(-max, Math.min(max, ct.sumT + jt));
    jt = newT - ct.sumT;
    ct.sumT = newT;
    if (jt === 0) return;
    _v2.copy(_tan).multiplyScalar(jt);
    this._applyPair(a, _v2, ct.point);
    _v2.copy(_tan).multiplyScalar(-jt);
    this._applyPair(b, _v2, ct.point);
  }

  /**
   * An impulse from a body-against-body contact, with the spin it induces
   * turned down.
   *
   * Between a body and the WORLD the full angular response is what you want:
   * it is what makes a crate dropped on its edge topple instead of landing
   * flat, and that path is left alone. Between two bodies that are both free
   * to move it is the thing that will not hold still. Four corner contacts
   * solved one after another leave a little residual torque; against the
   * immovable world that torque is taken out again by the world's own
   * contacts the next sweep, but between two loose boxes each one's leftover
   * spin becomes the other one's input, and the pair winds itself up. From a
   * dead-level start a crate resting on a crate had half a radian a second of
   * spin within one frame and was on its side inside two.
   *
   * Scaling the angular half down to a third leaves the linear response — the
   * part that decides whether things interpenetrate, which is the whole point
   * of the pass — completely intact, and leaves piles that stay piles. It is a
   * simplification and worth naming as one: two boxes clipping each other at a
   * corner exchange less spin than they really would.
   */
  _applyPair(body, imp, point) {
    if (body.invMass === 0) return;
    body.wake();
    body.vel.addScaledVector(imp, body.invMass);
    _tmp.subVectors(point, body.pos);
    _tmp2.crossVectors(_tmp, imp).applyMatrix3(body._invInertiaWorld(_m3b));
    body.ang.addScaledVector(_tmp2, PAIR_SPIN);
  }

  _integrate(b, dt) {
    b.vel.y += GRAVITY * dt;
    // Buoyancy: a float pushed under comes back up, with heavy damping so it
    // bobs instead of pumping itself out of the water.
    if (b.buoyancy > 0 && this.waterAt) {
      const wl = this.waterAt(b.pos.x, b.pos.z);
      const sub = Math.max(0, Math.min(1, (wl - (b.pos.y - b.half.y)) / (b.half.y * 2)));
      if (sub > 0) {
        b.vel.y += -GRAVITY * sub * b.buoyancy * dt;
        b.vel.multiplyScalar(1 - Math.min(0.9, 2.6 * sub * dt));
        b.ang.multiplyScalar(1 - Math.min(0.9, 3.0 * sub * dt));
      }
    }
    const lin = Math.max(0, 1 - b.drag * dt);
    b.vel.multiplyScalar(lin);
    b.ang.multiplyScalar(Math.max(0, 1 - b.angDrag * dt));
    // Backstop. Any solver can be handed something absurd - a car at speed, a
    // blast, a body wedged between two walls - and without a ceiling one bad
    // frame turns into a bin in orbit.
    if (!Number.isFinite(b.vel.x + b.vel.y + b.vel.z)) b.vel.set(0, 0, 0);
    if (!Number.isFinite(b.ang.x + b.ang.y + b.ang.z)) b.ang.set(0, 0, 0);
    if (b.vel.lengthSq() > MAX_LIN * MAX_LIN) b.vel.setLength(MAX_LIN);
    if (b.ang.lengthSq() > MAX_ANG * MAX_ANG) b.ang.setLength(MAX_ANG);
    b.pos.addScaledVector(b.vel, dt);
    // q += 0.5 * omega * q * dt
    _q.set(b.ang.x * dt * 0.5, b.ang.y * dt * 0.5, b.ang.z * dt * 0.5, 0).multiply(b.quat);
    b.quat.x += _q.x; b.quat.y += _q.y; b.quat.z += _q.z; b.quat.w += _q.w;
    b.quat.normalize();
  }

  /** World positions of the eight corners. */
  _cornersOf(b) {
    const h = b.half;
    let i = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          _corners[i].set(sx * h.x, sy * h.y, sz * h.z).applyQuaternion(b.quat).add(b.pos);
          i++;
        }
      }
    }
    return _corners;
  }

  _collide(b, dt) {
    const pts = this._cornersOf(b);
    const phys = this.phys;
    // One broadphase query for the whole body, reused by all eight corners.
    const near = phys.query ? phys.query(b.pos.x, b.pos.z, b.radius + 1.0) : phys.boxes;
    const boxes = near === phys._out ? near.slice() : near;
    const cs = this._contacts;
    let n = 0;

    for (let i = 0; i < 8 && n < cs.length; i++) {
      const c = pts[i];

      // --- Ground ------------------------------------------------------------
      // The city has no heightfield: `terrain` reports the void there and the
      // roads are thin collider plates instead. A chunk of debris falling at
      // twenty metres a second covers more than a plate is thick in a single
      // substep, so it went straight through the road and came to rest on the
      // slab underneath it. `surfaceAt` is the same analytic surface the cars
      // drive on, and as a plane it cannot be tunnelled through.
      let gy = phys.terrain ? phys.terrain(c.x, c.z) : 0;
      if (gy <= -1e8 && this.surfaceAt) gy = this.surfaceAt(c.x, c.z);
      if (gy > -1e8 && c.y < gy + MARGIN) {
        const ct = cs[n++];
        ct.point.copy(c); ct.normal.set(0, 1, 0); ct.depth = gy - c.y;
      }

      // --- Static boxes ------------------------------------------------------
      for (let k = 0; k < boxes.length && n < cs.length; k++) {
        const box = boxes[k];
        _v.subVectors(c, box.center);
        const br = box.boundRadius + MARGIN;
        if (_v.lengthSq() > br * br) continue;
        if (box.quatInv) _v.applyQuaternion(box.quatInv);
        // Test against the box grown by MARGIN, so a corner resting ON a
        // surface is a contact rather than a near miss.
        const hx = box.half.x + MARGIN, hy = box.half.y + MARGIN, hz = box.half.z + MARGIN;
        const ax0 = Math.abs(_v.x), ay0 = Math.abs(_v.y), az0 = Math.abs(_v.z);
        if (ax0 > hx || ay0 > hy || az0 > hz) continue;
        // Leave by the nearest face of the REAL box; depth can come out
        // slightly negative, which means touching but not yet inside.
        const dx = hx - ax0, dy = hy - ay0, dz = hz - az0;
        let depth = dx, ax = 0;
        if (dy < depth) { depth = dy; ax = 1; }
        if (dz < depth) { depth = dz; ax = 2; }
        const ct = cs[n++];
        ct.normal.set(0, 0, 0);
        ct.normal.setComponent(ax, Math.sign(_v.getComponent(ax)) || 1);
        if (box.quat) ct.normal.applyQuaternion(box.quat);
        ct.point.copy(c);
        ct.depth = depth - MARGIN;
      }
    }

    if (n === 0) return;

    // --- Velocity ------------------------------------------------------------
    // Sequential impulses, three passes. One pass is not enough when a box
    // lands on an edge: the first contact kills the fall, the rotation that
    // induces drives the other corners down, and only a second pass sees it.
    for (let it = 0; it < 3; it++) {
      let worst = 0;
      for (let k = 0; k < n; k++) worst = Math.max(worst, this._resolveVel(b, cs[k], it === 0));
      if (worst < 0.01) break;
    }

    // --- Position ------------------------------------------------------------
    // One correction for the whole body, deepest contact first.
    //
    // Order matters because contacts disagree. A body lying on the road
    // beside a tower has its lower corners a metre inside the ground slab
    // (push up) and its upper corners just inside the tower, whose nearest
    // face is its underside (push down). Taken in the order they were found
    // the two cancel and the body sits there, half sunk, forever. Taken
    // deepest-first, the correction that matters is applied and anything that
    // would undo it is dropped: the deepest penetration is the one actually
    // describing where the body has to go.
    let order = 0;
    for (let k = 0; k < n; k++) if (cs[k].depth > SLOP) { _idx[order++] = k; }
    for (let a = 1; a < order; a++) {
      const key = _idx[a];
      let j = a - 1;
      while (j >= 0 && cs[_idx[j]].depth < cs[key].depth) { _idx[j + 1] = _idx[j]; j--; }
      _idx[j + 1] = key;
    }
    _push.set(0, 0, 0);
    let deepest = 0;
    for (let a = 0; a < order; a++) {
      const ct = cs[_idx[a]];
      if (a === 0) deepest = ct.depth;
      // Would this undo a correction already made? Then it is the contact
      // that is wrong, not the one before it.
      else if (_push.dot(ct.normal) < -1e-4) continue;
      const need = (ct.depth - SLOP) * BETA - _push.dot(ct.normal);
      if (need > 0) _push.addScaledVector(ct.normal, need);
    }
    const pl = _push.length();
    if (pl > 1e-6) {
      if (pl > MAX_CORRECT) _push.multiplyScalar(MAX_CORRECT / pl);
      b.pos.add(_push);
      // Still climbing out of something: not settled, whatever the velocity
      // says. See the same note in _collidePair.
      if (deepest > SLOP * 4) b._still = 0;
    }

    // --- Stuck ---------------------------------------------------------------
    // Buried deeper than the body is big, frame after frame, means it is
    // inside something rather than resting on it — thrown through a wall by a
    // blast, or spawned in a doorway. Local resolution cannot get it out of
    // there (pushing it along the nearest face just moves it further in), so
    // after half a second it is put back on the ground above and left still.
    if (deepest > b.radius * 0.9) {
      b._stuck = (b._stuck || 0) + 1;
      if (b._stuck > 30 && this.surfaceAt) {
        const gy = this.surfaceAt(b.pos.x, b.pos.z);
        if (gy > -1e6) {
          b.pos.y = gy + b.half.y + 0.04;
          b.vel.set(0, 0, 0);
          b.ang.set(0, 0, 0);
          b.quat.identity();
        }
        b._stuck = 0;
      }
    } else if (b._stuck) {
      b._stuck = 0;
    }
  }

  /**
   * One contact, velocity only. Returns the approach speed it removed, so the
   * caller can stop iterating once the contact set has gone quiet.
   */
  _resolveVel(b, ct, allowBounce) {
    const normal = ct.normal;
    _r.subVectors(ct.point, b.pos);
    _v.crossVectors(b.ang, _r).add(b.vel);
    const vn = _v.dot(normal);
    // A contact inside the margin but still separating is left alone: that is
    // what stops a box that is simply resting from being kicked every frame.
    if (vn > 0) return 0;

    const inv = b._invInertiaWorld(_m3b);
    _v2.crossVectors(_r, normal).applyMatrix3(inv).cross(_r);
    const denom = b.invMass + _v2.dot(normal);
    if (denom <= 1e-9) return 0;
    // Bounce only on a real impact, and only on the first pass.
    const e = (allowBounce && -vn > 1.2) ? b.restitution : 0;
    const jn = (-(1 + e) * vn) / denom;
    _v2.copy(normal).multiplyScalar(jn);
    b.vel.addScaledVector(_v2, b.invMass);
    _t.crossVectors(_r, _v2).applyMatrix3(inv);
    b.ang.add(_t);

    // Friction along whatever sideways motion is left.
    _r.subVectors(ct.point, b.pos);
    _v.crossVectors(b.ang, _r).add(b.vel);
    _t.copy(_v).addScaledVector(normal, -_v.dot(normal));
    const tl = _t.length();
    if (tl < 1e-5) return -vn;
    _t.divideScalar(tl);
    _v2.crossVectors(_r, _t).applyMatrix3(inv).cross(_r);
    const dt2 = b.invMass + _v2.dot(_t);
    if (dt2 <= 1e-9) return -vn;
    let jt = -tl / dt2;
    const max = b.friction * Math.abs(jn);
    jt = Math.max(-max, Math.min(max, jt));
    _v2.copy(_t).multiplyScalar(jt);
    b.vel.addScaledVector(_v2, b.invMass);
    _t.crossVectors(_r, _v2).applyMatrix3(inv);
    b.ang.add(_t);
    return -vn;
  }
}
