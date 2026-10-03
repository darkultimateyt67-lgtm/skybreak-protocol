import { Object3D } from 'three';

/**
 * Cheaper per-frame transform updates. Imported once, before anything else.
 *
 * three.js rebuilds every object's matrix on every render, moved or not. The
 * city holds over 23,000 objects — parked cars, buildings, the parts of every
 * car in traffic — and that walk alone cost ~20 ms a frame on an ordinary
 * laptop, on every render pass. Two changes, neither visible on screen:
 *
 *  1. An object whose position, rotation and scale are exactly what they were
 *     at its last rebuild keeps its matrix. Its world matrix is then only
 *     recomputed if a parent moved, exactly as three.js already does.
 *  2. An object marked `skipWhenHidden` (whole vehicles past draw distance,
 *     car trim hidden by LOD) skips its subtree while invisible, and catches
 *     up in full the first frame it is shown again.
 *
 * Nothing in the game raycasts meshes and getWorldPosition() walks its own
 * path (updateWorldMatrix), so a skipped hidden matrix is never read stale.
 */
const P = Object3D.prototype;

P.updateMatrix = function () {
  const p = this.position, q = this.quaternion, s = this.scale;
  let c = this._mc;
  if (c !== undefined &&
      c[0] === p.x && c[1] === p.y && c[2] === p.z &&
      c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w &&
      c[7] === s.x && c[8] === s.y && c[9] === s.z) return;
  this.matrix.compose(p, q, s);
  this.matrixWorldNeedsUpdate = true;
  if (c === undefined) c = this._mc = new Float64Array(10);
  c[0] = p.x; c[1] = p.y; c[2] = p.z;
  c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w;
  c[7] = s.x; c[8] = s.y; c[9] = s.z;
};

P.updateMatrixWorld = function (force) {
  if (this.visible === false && this.skipWhenHidden === true) {
    this._behind = true;
    return;
  }
  if (this.matrixAutoUpdate) this.updateMatrix();
  if (this.matrixWorldNeedsUpdate || force || this._behind) {
    if (this.matrixWorldAutoUpdate === true) {
      if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    this.matrixWorldNeedsUpdate = false;
    this._behind = false;
    force = true;
  }
  const children = this.children;
  for (let i = 0, l = children.length; i < l; i++) children[i].updateMatrixWorld(force);
};
