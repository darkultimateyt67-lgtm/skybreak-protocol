import * as THREE from 'three';

/**
 * PhysicsWorld — minimal, allocation-free static collision world.
 *
 * The map registers oriented boxes (OBBs; axis-aligned boxes are the fast
 * path). Characters are vertical capsules resolved against those boxes with
 * iterative penetration correction, which gives stable sliding along walls,
 * ramps and edges. Raycasts (slab test) serve bullets, ground probes and AI
 * line-of-sight checks.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _la = new THREE.Vector3();
const _lb = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _segPt = new THREE.Vector3();
const _boxPt = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ro = new THREE.Vector3();
const _rd = new THREE.Vector3();

function closestPointOnSegment(a, b, point, out) {
  _v1.subVectors(b, a);
  const len2 = _v1.lengthSq();
  if (len2 < 1e-10) return out.copy(a);
  const t = THREE.MathUtils.clamp(_v2.subVectors(point, a).dot(_v1) / len2, 0, 1);
  return out.copy(a).addScaledVector(_v1, t);
}

export class PhysicsWorld {
  constructor() {
    /** @type {Array<object>} static box colliders */
    this.boxes = [];
    /**
     * Optional terrain sampler: (x, z) => groundHeight. When set, capsules
     * and rays resolve against the landscape as well as the boxes — a 1200 m
     * island would need tens of thousands of boxes otherwise.
     */
    this.terrain = null;

    // --- Broadphase ---------------------------------------------------------
    // A uniform grid over the map. Without it every query walked all ten
    // thousand colliders: the capsule sweep did that three times per substep,
    // per capsule, and the rigid solver would have done it eight times per
    // body. Boxes go in every cell they overlap; anything too big to bucket
    // sensibly (ground plates, runway slabs) goes in a short list that is
    // always tested.
    this.cell = 24;
    this._grid = new Map();
    this._big = [];
    this._stamp = 0;
    this._out = [];
  }

  _cellKey(ix, iz) { return (ix + 4096) * 16384 + (iz + 4096); }

  _index(box) {
    const r = box.boundRadius;
    // A tall tower's bounding radius is ~95 m; bucketing it over its own
    // footprint costs a few dozen cell entries and keeps it out of the list
    // that every single query has to walk.
    if (r > 130) { this._big.push(box); return; }
    const c = this.cell;
    const x0 = Math.floor((box.center.x - r) / c), x1 = Math.floor((box.center.x + r) / c);
    const z0 = Math.floor((box.center.z - r) / c), z1 = Math.floor((box.center.z + r) / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._cellKey(ix, iz);
        let list = this._grid.get(k);
        if (!list) { list = []; this._grid.set(k, list); }
        list.push(box);
      }
    }
  }

  /**
   * Every collider that could touch a sphere at (x, z) of radius r. Results
   * are de-duplicated with a visit stamp rather than a Set, because this runs
   * several times per body per frame.
   */
  query(x, z, r) {
    const out = this._out;
    out.length = 0;
    const st = ++this._stamp;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this._grid.get(this._cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (b._stamp === st) continue;
          b._stamp = st;
          out.push(b);
        }
      }
    }
    for (let i = 0; i < this._big.length; i++) {
      const b = this._big[i];
      if (b._stamp === st) continue;
      b._stamp = st;
      out.push(b);
    }
    return out;
  }

  /**
   * Register a static box collider.
   * @param {THREE.Vector3} center world-space center
   * @param {THREE.Vector3} size   full extents (w, h, d)
   * @param {THREE.Quaternion|null} quat optional orientation (null = axis aligned)
   * @param {object} opts flags: { wallRun }
   */
  addBox(center, size, quat = null, opts = {}) {
    const half = new THREE.Vector3().copy(size).multiplyScalar(0.5);
    const box = {
      center: center.clone(),
      half,
      quat: quat ? quat.clone() : null,
      quatInv: quat ? quat.clone().invert() : null,
      boundRadius: half.length(),
      wallRun: !!opts.wallRun,
      // What this surface is made of, so bullets can react correctly.
      surface: opts.surface || 'metal'
    };
    this.boxes.push(box);
    this._index(box);
    return box;
  }

  _toLocal(v, box, out) {
    out.copy(v).sub(box.center);
    if (box.quatInv) out.applyQuaternion(box.quatInv);
    return out;
  }

  _dirToLocal(v, box, out) {
    out.copy(v);
    if (box.quatInv) out.applyQuaternion(box.quatInv);
    return out;
  }

  _dirToWorld(v, box) {
    if (box.quat) v.applyQuaternion(box.quat);
    return v;
  }

  /**
   * Squared distance between capsule segment [a,b] and a box; closest points
   * are written to outSeg (on segment) and outBox (on box), in world space.
   */
  _segBoxDist2(a, b, box, outSeg, outBox) {
    this._toLocal(a, box, _la);
    this._toLocal(b, box, _lb);
    const h = box.half;

    // Alternate clamping between the segment and the box surface; converges
    // fast enough for game collision in a handful of iterations.
    _p.copy(_la).add(_lb).multiplyScalar(0.5);
    for (let i = 0; i < 4; i++) {
      _q.set(
        THREE.MathUtils.clamp(_p.x, -h.x, h.x),
        THREE.MathUtils.clamp(_p.y, -h.y, h.y),
        THREE.MathUtils.clamp(_p.z, -h.z, h.z)
      );
      closestPointOnSegment(_la, _lb, _q, _p);
    }
    _q.set(
      THREE.MathUtils.clamp(_p.x, -h.x, h.x),
      THREE.MathUtils.clamp(_p.y, -h.y, h.y),
      THREE.MathUtils.clamp(_p.z, -h.z, h.z)
    );

    const d2 = _p.distanceToSquared(_q);
    outSeg.copy(_p);
    outBox.copy(_q);
    if (box.quat) {
      outSeg.applyQuaternion(box.quat);
      outBox.applyQuaternion(box.quat);
    }
    outSeg.add(box.center);
    outBox.add(box.center);
    return d2;
  }

  /**
   * Move a capsule (position = feet) by velocity*dt and resolve collisions.
   * Mutates position and velocity (velocity is clipped against contacts).
   * @returns {{onGround:boolean, wallNormal:THREE.Vector3|null, wallRunOK:boolean, hitCeiling:boolean}}
   */
  moveCapsule(position, radius, height, velocity, dt, result) {
    // SUBSTEP, or fast movers walk through walls.
    //
    // The solver below is teleport-then-push-out: it advances the capsule by
    // velocity*dt and then resolves whatever it is now overlapping. That is
    // fine while a frame's travel is smaller than the capsule, and completely
    // broken once it isn't — land beyond a wall instead of inside it and there
    // is nothing to push out of, so you pass clean through.
    //
    // A sprinting player at normal pace covers 0.14 m a frame against a 0.42 m
    // radius, so this never mattered. Anything appreciably faster — a speed
    // multiplier, a vehicle impact, or just a bad frame where dt hits its 1/20
    // cap — puts a metre or more between one test and the next. Splitting the
    // move into steps no longer than three quarters of the radius keeps every
    // intermediate position overlapping whatever it is about to hit.
    //
    // Capped at 16 substeps: beyond that the mover is going fast enough that
    // it is somebody's bug, and spending the whole frame in the collider is
    // worse than the tunnel.
    const travel = Math.hypot(velocity.x, velocity.y, velocity.z) * dt;
    const maxStep = radius * 0.75;
    if (travel > maxStep) {
      const steps = Math.min(16, Math.ceil(travel / maxStep));
      const sub = dt / steps;
      let onGround = false, hitCeiling = false, wallRunOK = false;
      let wallNormal = null;
      for (let i = 0; i < steps; i++) {
        this._moveCapsuleStep(position, radius, height, velocity, sub, result);
        onGround = onGround || result.onGround;
        hitCeiling = hitCeiling || result.hitCeiling;
        if (result.wallNormal) {
          if (!wallNormal) wallNormal = new THREE.Vector3();
          wallNormal.copy(result.wallNormal);
          wallRunOK = result.wallRunOK;
        }
      }
      result.onGround = onGround;
      result.hitCeiling = hitCeiling;
      result.wallNormal = wallNormal;
      result.wallRunOK = wallRunOK;
      return result;
    }
    return this._moveCapsuleStep(position, radius, height, velocity, dt, result);
  }

  /** One collision step. See moveCapsule for why this is not called directly. */
  _moveCapsuleStep(position, radius, height, velocity, dt, result) {
    position.addScaledVector(velocity, dt);

    result.onGround = false;
    result.hitCeiling = false;
    result.wallNormal = null;
    result.wallRunOK = false;

    const capHalf = height * 0.5 + radius;

    // Terrain first: stand the capsule on the landscape, and slide down
    // slopes too steep to walk by clipping velocity to the surface plane.
    if (this.terrain) {
      const g = this.terrain(position.x, position.z);
      if (position.y < g) {
        position.y = g;
        if (velocity.y < 0) velocity.y = 0;
        result.onGround = true;
        // Sample neighbours for the surface normal so steep faces push back.
        const e = 1.2;
        const nx = this.terrain(position.x - e, position.z) - this.terrain(position.x + e, position.z);
        const nz = this.terrain(position.x, position.z - e) - this.terrain(position.x, position.z + e);
        _n.set(nx, 2 * e, nz).normalize();
        if (_n.y < 0.62) {
          const vn = velocity.dot(_n);
          if (vn < 0) velocity.addScaledVector(_n, -vn);
        }
      }
    }

    // Only the colliders near this capsule, from the grid.
    const near = this.query(position.x, position.z, capHalf + 1.5);
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < near.length; i++) {
        const box = near[i];

        // Narrower broadphase: capsule center vs box bounding sphere.
        _v3.set(position.x, position.y + height * 0.5, position.z);
        const reach = box.boundRadius + capHalf + 0.5;
        if (_v3.distanceToSquared(box.center) > reach * reach) continue;

        const a = _v1.set(position.x, position.y + radius, position.z);
        const b = _v2.set(position.x, position.y + height - radius, position.z);
        const d2 = this._segBoxDist2(a, b, box, _segPt, _boxPt);
        if (d2 >= radius * radius) continue;

        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          _n.subVectors(_segPt, _boxPt).divideScalar(d);
          position.addScaledVector(_n, radius - d);
        } else {
          // Segment intersects the box: push out along the axis of least
          // penetration, in the box's local frame.
          this._toLocal(_segPt, box, _p);
          const h = box.half;
          const px = h.x - Math.abs(_p.x);
          const py = h.y - Math.abs(_p.y);
          const pz = h.z - Math.abs(_p.z);
          if (py <= px && py <= pz) _n.set(0, Math.sign(_p.y) || 1, 0).multiplyScalar(1);
          else if (px <= pz) _n.set(Math.sign(_p.x) || 1, 0, 0);
          else _n.set(0, 0, Math.sign(_p.z) || 1);
          this._dirToWorld(_n, box);
          const push = Math.min(px, py, pz) + radius;
          position.addScaledVector(_n, push);
        }

        // Contact classification + velocity clipping.
        if (_n.y > 0.55) result.onGround = true;
        if (_n.y < -0.55) result.hitCeiling = true;
        if (Math.abs(_n.y) < 0.3) {
          if (!result.wallNormal) result.wallNormal = new THREE.Vector3();
          result.wallNormal.copy(_n);
          result.wallRunOK = box.wallRun;
        }
        const vn = velocity.dot(_n);
        if (vn < 0) velocity.addScaledVector(_n, -vn);
      }
    }
    return result;
  }

  /**
   * Raycast against all boxes. Returns nearest hit or null.
   * @returns {{dist:number, point:THREE.Vector3, normal:THREE.Vector3}|null}
   */
  raycast(origin, dir, maxDist) {
    let best = maxDist;
    let bestBox = null;
    let bestAxis = -1;
    let bestSign = 1;

    for (let i = 0; i < this.boxes.length; i++) {
      const box = this.boxes[i];

      // Broadphase: ray vs bounding sphere.
      _v1.subVectors(box.center, origin);
      const proj = _v1.dot(dir);
      if (proj < -box.boundRadius || proj - box.boundRadius > best) continue;
      if (_v1.lengthSq() - proj * proj > box.boundRadius * box.boundRadius) continue;

      this._toLocal(origin, box, _ro);
      this._dirToLocal(dir, box, _rd);

      let tmin = 0;
      let tmax = best;
      let axis = -1;
      let sign = 1;
      let ok = true;

      for (let k = 0; k < 3; k++) {
        const o = _ro.getComponent(k);
        const d = _rd.getComponent(k);
        const h = box.half.getComponent(k);
        if (Math.abs(d) < 1e-9) {
          if (Math.abs(o) > h) { ok = false; break; }
          continue;
        }
        let t1 = (-h - o) / d;
        let t2 = (h - o) / d;
        let s = d > 0 ? -1 : 1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }

      if (ok && axis >= 0 && tmin > 1e-5 && tmin < best) {
        best = tmin;
        bestBox = box;
        bestAxis = axis;
        bestSign = sign;
      }
    }

    // March the ray against the terrain and keep whichever hit is nearer.
    if (this.terrain && dir.y < 0.999) {
      const step = 1.4;
      let t = step;
      let prevGap = origin.y - this.terrain(origin.x, origin.z);
      while (t < best) {
        const px = origin.x + dir.x * t;
        const py = origin.y + dir.y * t;
        const pz = origin.z + dir.z * t;
        const gap = py - this.terrain(px, pz);
        if (gap <= 0) {
          // Refine to the crossing point between the last two samples.
          const frac = prevGap / (prevGap - gap || 1e-6);
          const hitT = (t - step) + step * THREE.MathUtils.clamp(frac, 0, 1);
          if (hitT < best) {
            const point = new THREE.Vector3().copy(origin).addScaledVector(dir, hitT);
            const e = 1.2;
            const nx = this.terrain(point.x - e, point.z) - this.terrain(point.x + e, point.z);
            const nz = this.terrain(point.x, point.z - e) - this.terrain(point.x, point.z + e);
            const normal = new THREE.Vector3(nx, 2 * e, nz).normalize();
            return { dist: hitT, point, normal, box: { surface: 'soil' } };
          }
          break;
        }
        prevGap = gap;
        t += step;
      }
    }

    if (!bestBox) return null;
    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, best);
    const normal = new THREE.Vector3();
    normal.setComponent(bestAxis, bestSign);
    this._dirToWorld(normal, bestBox);
    return { dist: best, point, normal, box: bestBox };
  }
}

/**
 * Ray vs sphere intersection distance, or -1. Used for enemy hitboxes.
 */
export function raySphere(origin, dir, center, radius) {
  _v1.subVectors(center, origin);
  const proj = _v1.dot(dir);
  if (proj < 0) return -1;
  const d2 = _v1.lengthSq() - proj * proj;
  const r2 = radius * radius;
  if (d2 > r2) return -1;
  return proj - Math.sqrt(r2 - d2);
}
