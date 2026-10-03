import * as THREE from 'three';
import { chunkInstanced } from './Chunk.js';

const _cp = new THREE.Vector3();

/**
 * GroundCover — the forest floor.
 *
 * Six instanced layers, one draw call each: grass tufts, ferns, low bushes,
 * fallen branches, mushroom clusters and pebbles. Grass and ferns bend in
 * the same wind field the canopy uses, so the whole forest breathes together.
 *
 * Placement is blue-noise-ish (golden-angle spiral + jitter) which avoids the
 * grid artifacts you get from naive random scatter, and everything is pushed
 * clear of structures, the plaza and the survivor camp so nothing sprouts
 * through a wall.
 */

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _euler = new THREE.Euler();

export class GroundCover {
  constructor(world) {
    this.world = world;
    this.group = world.group;
    this._shaders = [];
    this._time = 0;
    // Rectangles where nothing should grow: [x, z, halfW, halfD].
    this.exclusions = [];
    // [group, drawDistance, shadowDistance] per layer, culled each frame.
    this._layers = [];
  }

  /** Tile a finished layer so off-screen and distant parts are skipped. */
  _add(mesh, far, shadowFar = 0) {
    const g = chunkInstanced(mesh, 24, 1.5);
    mesh.geometry.dispose();
    this.group.add(g);
    this._layers.push([g, far, mesh.castShadow ? shadowFar : 0]);
    return g;
  }

  exclude(x, z, halfW, halfD) {
    this.exclusions.push([x, z, halfW, halfD]);
  }

  _blocked(x, z) {
    for (const [ex, ez, hw, hd] of this.exclusions) {
      if (Math.abs(x - ex) < hw && Math.abs(z - ez) < hd) return true;
    }
    return false;
  }

  /** Attach the shared wind bend to a material's vertex stage. */
  _windify(mat, strength = 1, fadeFar = 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uStrength = { value: strength };
      shader.uniforms.uFadeFar = { value: fadeFar };
      this._shaders.push(shader);
      // Double-sided blades: by default the back face flips its normal toward
      // the ground, so every blade seen from behind rendered black. Lit from
      // the sky on both faces, same as the city's lawns.
      if (mat.side === THREE.DoubleSide) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
          float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
          vec3 normal = normalize( vNormal );
          vec3 nonPerturbedNormal = normal;
        `);
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform float uTime;
          uniform float uStrength;
          uniform float uFadeFar;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          // Bend scales with height up the blade; the root never moves.
          float bend = clamp(position.y, 0.0, 3.0);
          vec3 wp = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float gust = sin(uTime * 1.1 + wp.x * 0.09 + wp.z * 0.07)
                     + 0.5 * sin(uTime * 2.6 + wp.x * 0.21 - wp.z * 0.17);
          float sway = gust * 0.14 * uStrength * bend;
          transformed.x += sway;
          transformed.z += sway * 0.6;
          // Sink into the ground toward the draw distance instead of popping.
          if (uFadeFar > 0.0) {
            float fd = distance(wp.xz, cameraPosition.xz);
            transformed *= smoothstep(uFadeFar, uFadeFar * 0.7, fd);
          }
        `);
    };
  }

  /** A tuft of crossed grass blades. */
  _grassGeometry() {
    const blades = [];
    const idx = [];
    let v = 0;
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + Math.random();
      const lean = (Math.random() - 0.5) * 0.25;
      const h = 0.26 + Math.random() * 0.22;
      const w = 0.022;
      const dx = Math.cos(a) * 0.03;
      const dz = Math.sin(a) * 0.03;
      // Three-segment blade tapering to a point.
      blades.push(
        dx - w, 0, dz, dx + w, 0, dz,
        dx - w * 0.6 + lean * h * 0.5, h * 0.55, dz + lean * h * 0.3,
        dx + w * 0.6 + lean * h * 0.5, h * 0.55, dz + lean * h * 0.3,
        dx + lean * h, h, dz + lean * h * 0.6
      );
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2, v + 2, v + 3, v + 4);
      v += 5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
    g.setIndex(idx);
    // Straight-up normals. Computed ones point sideways, and on a double-sided
    // blade the back face flips them away from the sun: half the field read
    // as black specks. Grass is lit from above far more than through a blade.
    const nrm = new Float32Array(blades.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    return g;
  }

  /** A fern frond: a stem with paired leaflets. */
  _fernGeometry() {
    const pts = [];
    const idx = [];
    let v = 0;
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * Math.PI * 2;
      const arc = 0.55;
      for (let s = 0; s < 4; s++) {
        const t = (s + 1) / 4;
        const r = t * 0.52;
        const y = Math.sin(t * arc * Math.PI) * 0.42;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const w = 0.09 * (1 - t * 0.6);
        pts.push(
          x - Math.sin(a) * w, y, z + Math.cos(a) * w,
          x + Math.sin(a) * w, y, z - Math.cos(a) * w,
          x + Math.cos(a) * 0.12, y - 0.02, z + Math.sin(a) * 0.12
        );
        idx.push(v, v + 1, v + 2);
        v += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    // Up-facing normals, for the same reason as the grass.
    const nrm = new Float32Array(pts.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    return g;
  }

  /** Scatter `count` instances using a golden-angle spiral over a disc. */
  _scatter(mesh, count, radius, place) {
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    let i = 0;
    let n = 0;
    while (i < count && n < count * 4) {
      const t = n / count;
      const a = n * GOLDEN;
      const r = Math.sqrt(t) * radius + (Math.random() - 0.5) * 3.5;
      const x = Math.cos(a) * r + (Math.random() - 0.5) * 2.5;
      const z = Math.sin(a) * r + (Math.random() - 0.5) * 2.5;
      n++;
      if (Math.abs(x) > radius || Math.abs(z) > radius) continue;
      if (this._blocked(x, z)) continue;
      place(i, x, z);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return i;
  }

  build(radius = 290) {
    // No vertexColors on any of these materials. None of the geometries has a
    // colour attribute, and WebGL feeds a missing one as black — every blade,
    // fern, bush and mushroom on the forest floor rendered black. The tint
    // comes from instanceColor, which three.js applies on its own.
    const counts = {};
    const color = new THREE.Color();

    // ---- Grass: the dense base layer -------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      this._windify(mat, 1.0, 62);
      const mesh = new THREE.InstancedMesh(this._grassGeometry(), mat, 60000);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      counts.grass = this._scatter(mesh, 60000, radius, (i, x, z) => {
        _pos.set(x, 0, z);
        _euler.set(0, Math.random() * Math.PI * 2, 0);
        _q.setFromEuler(_euler);
        const s = 0.75 + Math.random() * 0.85;
        _scl.set(s, s * (0.8 + Math.random() * 0.6), s);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);
        color.setHSL(0.25 + (Math.random() - 0.5) * 0.06, 0.38 + Math.random() * 0.2, 0.13 + Math.random() * 0.12);
        mesh.setColorAt(i, color);
      });
      this.grass = this._add(mesh, 62);
    }

    // ---- Ferns: mid-height undergrowth ------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      this._windify(mat, 0.55, 95);
      const mesh = new THREE.InstancedMesh(this._fernGeometry(), mat, 4200);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      counts.ferns = this._scatter(mesh, 4200, radius, (i, x, z) => {
        _pos.set(x, 0.02, z);
        _euler.set(0, Math.random() * Math.PI * 2, 0);
        _q.setFromEuler(_euler);
        const s = 0.8 + Math.random() * 0.9;
        _scl.set(s, s, s);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);
        color.setHSL(0.27 + (Math.random() - 0.5) * 0.05, 0.42, 0.17 + Math.random() * 0.14);
        mesh.setColorAt(i, color);
      });
      this.ferns = this._add(mesh, 95, 40);
    }

    // ---- Bushes: rounded shrub clumps ---------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial({ flatShading: true });
      this._windify(mat, 0.3);
      const geo = new THREE.IcosahedronGeometry(0.55, 1);
      const mesh = new THREE.InstancedMesh(geo, mat, 1400);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      counts.bushes = this._scatter(mesh, 1400, radius, (i, x, z) => {
        _pos.set(x, 0.3 + Math.random() * 0.15, z);
        _euler.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4);
        _q.setFromEuler(_euler);
        const s = 0.7 + Math.random() * 1.1;
        _scl.set(s * 1.2, s * 0.8, s * 1.2);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);
        color.setHSL(0.26 + (Math.random() - 0.5) * 0.05, 0.38, 0.14 + Math.random() * 0.1);
        mesh.setColorAt(i, color);
      });
      this.bushes = this._add(mesh, 150, 75);
    }

    // ---- Fallen branches ----------------------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial();
      const geo = new THREE.CylinderGeometry(0.045, 0.075, 1.5, 5);
      const mesh = new THREE.InstancedMesh(geo, mat, 900);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      counts.branches = this._scatter(mesh, 900, radius, (i, x, z) => {
        _pos.set(x, 0.06, z);
        _euler.set(Math.PI / 2 + (Math.random() - 0.5) * 0.25, Math.random() * Math.PI * 2, 0);
        _q.setFromEuler(_euler);
        const s = 0.6 + Math.random() * 1.3;
        _scl.set(1, s, 1);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);
        const l = 0.16 + Math.random() * 0.12;
        color.setHSL(0.08, 0.3, l);
        mesh.setColorAt(i, color);
      });
      this.branches = this._add(mesh, 80, 40);
    }

    // ---- Mushrooms ------------------------------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial();
      const geo = new THREE.ConeGeometry(0.09, 0.11, 7);
      const mesh = new THREE.InstancedMesh(geo, mat, 700);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      counts.mushrooms = this._scatter(mesh, 700, radius, (i, x, z) => {
        _pos.set(x, 0.07, z);
        _euler.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
        _q.setFromEuler(_euler);
        const s = 0.6 + Math.random() * 1.0;
        _scl.set(s, s, s);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);
        // Mostly earthy caps, the odd pale one.
        if (Math.random() < 0.2) color.setHSL(0.11, 0.1, 0.7);
        else color.setHSL(0.05 + Math.random() * 0.04, 0.35, 0.25 + Math.random() * 0.15);
        mesh.setColorAt(i, color);
      });
      this.mushrooms = this._add(mesh, 45);
    }

    // ---- Pebbles ---------------------------------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial({ flatShading: true });
      const geo = new THREE.DodecahedronGeometry(0.1, 0);
      const mesh = new THREE.InstancedMesh(geo, mat, 2200);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      counts.pebbles = this._scatter(mesh, 2200, radius, (i, x, z) => {
        _pos.set(x, 0.04, z);
        _euler.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        _q.setFromEuler(_euler);
        const s = 0.4 + Math.random() * 1.1;
        _scl.set(s, s * 0.6, s);
        _m4.compose(_pos, _q, _scl);
        mesh.setMatrixAt(i, _m4);
        const l = 0.22 + Math.random() * 0.18;
        color.setRGB(l, l * 0.98, l * 0.92);
        mesh.setColorAt(i, color);
      });
      this.pebbles = this._add(mesh, 45);
    }

    this.counts = counts;
    this.total = Object.values(counts).reduce((a, b) => a + b, 0);
    return counts;
  }

  update(dt) {
    this._time += dt;
    for (const s of this._shaders) s.uniforms.uTime.value = this._time;
    // Small things only cast shadows near the camera: past ~40 m a fern's
    // shadow is under a pixel, and the shadow pass was drawing every tile of
    // undergrowth across the whole shadow map — half the forest's draw calls.
    const cam = this.world.game.camera.position;
    for (const [g, far, shadowFar] of this._layers) {
      for (const c of g.userData.chunks) {
        const s = c.boundingSphere;
        const d = _cp.copy(s.center).distanceTo(cam) - s.radius;
        c.visible = d < far;
        if (shadowFar) c.castShadow = d < shadowFar;
      }
    }
  }
}
