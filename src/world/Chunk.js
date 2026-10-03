import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Split one InstancedMesh into a grid of smaller ones.
 *
 * A single instanced mesh spanning the whole map has one bounding volume, so
 * it is always "on screen" and every instance is drawn every frame — the grass
 * behind you included. Tiles get their own bounds, so three.js skips the ones
 * outside the view, and callers can hide far tiles by distance.
 *
 * Base vertex data and the material are shared; only per-instance data is
 * copied. `pad` grows each tile's bounds to cover vertex-shader wind sway.
 */
export function chunkInstanced(mesh, cell, pad = 1) {
  const n = mesh.count;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    mesh.getMatrixAt(i, _m);
    const key = Math.floor(_m.elements[12] / cell) + ',' + Math.floor(_m.elements[14] / cell);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(i);
  }

  const src = mesh.geometry;
  if (!src.boundingSphere) src.computeBoundingSphere();
  const inst = Object.entries(src.attributes).filter(([, a]) => a.isInstancedBufferAttribute);
  const chunks = [];

  for (const idx of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(src.index);
    for (const [name, a] of Object.entries(src.attributes)) {
      if (!a.isInstancedBufferAttribute) geo.setAttribute(name, a);
    }
    for (const [name, a] of inst) {
      const s = a.itemSize;
      const arr = new a.array.constructor(idx.length * s);
      idx.forEach((j, k) => { for (let c = 0; c < s; c++) arr[k * s + c] = a.array[j * s + c]; });
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, s));
    }
    geo.boundingSphere = src.boundingSphere.clone();

    const m = new THREE.InstancedMesh(geo, mesh.material, idx.length);
    idx.forEach((j, k) => {
      mesh.getMatrixAt(j, _m);
      m.setMatrixAt(k, _m);
      if (mesh.instanceColor) { mesh.getColorAt(j, _c); m.setColorAt(k, _c); }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = mesh.castShadow;
    m.receiveShadow = mesh.receiveShadow;
    m.renderOrder = mesh.renderOrder;
    m.computeBoundingSphere();
    m.boundingSphere.radius += pad;
    m.frustumCulled = true;
    chunks.push(m);
  }

  const group = new THREE.Group();
  for (const c of chunks) group.add(c);
  group.userData.chunks = chunks;
  return group;
}
