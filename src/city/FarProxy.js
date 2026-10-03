import * as THREE from 'three';

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _nm = new THREE.Matrix3();

/**
 * A vehicle seen from a distance, as one mesh per material.
 *
 * Past its detail range a car is still a dozen separate meshes (body, glass,
 * wheels, lamps, trim) and a parked plane over fifty — each one a draw call,
 * every frame, for something a few pixels tall. The proxy is those same
 * visible parts merged in the vehicle's own space: identical shapes and the
 * very same material objects (so a flashing police beacon still flashes).
 * Wheels and propellers freeze in place, which nobody can see at that range.
 *
 * Built when the vehicle goes far, rebuilt if invalidate() is called while it
 * is (damage, an explosion, new materials). The parts it replaces are hidden,
 * not removed, and come back exactly as they were.
 */
export class FarProxy {
  constructor(group, keep = []) {
    this.group = group;
    this.keep = new Set(keep.filter(Boolean));
    this.mesh = null;
    this.on = false;
    this.dirty = true;
    this._hidden = [];
  }

  invalidate() {
    this.dirty = true;
    if (this.on) {
      this.set(false);
      this.set(true);
    }
  }

  set(far) {
    if (far === this.on && !(far && this.dirty)) return;
    if (far) {
      if (this.on) this._show();
      if (this.dirty || !this.mesh) this._build();
      this._hide();
      this.on = true;
    } else {
      this._show();
      this.on = false;
    }
  }

  _hide() {
    for (const m of this._parts) {
      if (!m.visible) continue;
      m.visible = false;
      m.skipWhenHidden = true;
      this._hidden.push(m);
    }
    if (this.mesh) this.mesh.visible = true;
  }

  _show() {
    for (const m of this._hidden) m.visible = true;
    this._hidden.length = 0;
    if (this.mesh) this.mesh.visible = false;
  }

  /** Visible meshes under the group, skipping anything in `keep`. */
  _collect() {
    const out = [];
    const walk = (o) => {
      if (!o.visible || this.keep.has(o) || o === this.mesh) return;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.material && !Array.isArray(o.material) &&
          o.geometry?.attributes?.position) out.push(o);
      for (const c of o.children) walk(c);
    };
    for (const c of this.group.children) walk(c);
    return out;
  }

  _build() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      for (const c of this.mesh.children) c.geometry.dispose();
    }
    this.group.updateMatrixWorld(true);
    _inv.copy(this.group.matrixWorld).invert();
    const parts = this._collect();
    const byMat = new Map();
    for (const p of parts) {
      if (!byMat.has(p.material)) byMat.set(p.material, []);
      byMat.get(p.material).push(p);
    }
    const proxy = new THREE.Group();
    proxy.visible = false;
    for (const [mat, list] of byMat) {
      const m = new THREE.Mesh(mergeLocal(list), mat);
      m.castShadow = list.some((p) => p.castShadow);
      m.receiveShadow = list.some((p) => p.receiveShadow);
      proxy.add(m);
    }
    this.group.add(proxy);
    this.mesh = proxy;
    this._parts = parts;
    this.dirty = false;
  }
}

/** Merge meshes into one geometry in the proxy group's local space. */
function mergeLocal(list) {
  let nv = 0, ni = 0;
  for (const p of list) {
    const g = p.geometry;
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const p of list) {
    _rel.multiplyMatrices(_inv, p.matrixWorld);
    _nm.getNormalMatrix(_rel);
    const e = _rel.elements, n = _nm.elements;
    const g = p.geometry;
    const P = g.attributes.position, N = g.attributes.normal, T = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (N) {
        const a = N.getX(i), b = N.getY(i), c = N.getZ(i);
        const nx = n[0] * a + n[3] * b + n[6] * c;
        const ny = n[1] * a + n[4] * b + n[7] * c;
        const nz = n[2] * a + n[5] * b + n[8] * c;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
      }
      if (T) { uv[(vo + i) * 2] = T.getX(i); uv[(vo + i) * 2 + 1] = T.getY(i); }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
