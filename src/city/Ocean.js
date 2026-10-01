import * as THREE from 'three';
import { sandMaps, SAND_GLSL } from './Ground.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * THE SEA AROUND GTAZ.
 *
 * What was here before was one 12 km quad — literally a single rectangle with
 * one segment — at a fixed height, on a flat material. Nothing could move on it
 * because there was nothing to move: no vertices to lift, no normals to bend.
 * The beach was four flat sand strips floating a metre above that quad, so the
 * shore was a vertical step rather than a slope, there was no line for a wave
 * to reach, and there was no seabed at all, so diving showed you nothing.
 *
 * This replaces all of it with four connected pieces:
 *
 *   A SLOPED SHORE AND SEABED. Dry sand, a wet swash zone, a shelf, then open
 *   seabed at 28 m. It is real terrain: you walk down the beach into the water,
 *   cars roll down it, and the waterline is simply wherever the sea surface
 *   meets the sand — which moves as the waves do.
 *
 *   A MOVING SURFACE. Swell offshore from three crossing wave trains, and
 *   breaking surf lines that travel IN toward the beach and shoal out on the
 *   sand. Fine ripples are layered on per pixel from a tiling normal map
 *   scrolled in two directions. Colour and transparency follow the real depth
 *   of water under each point, so the shallows are clear turquoise over sand
 *   and the deep is dark blue.
 *
 *   FOAM WHERE WATER IS THIN. The shader knows the seabed height, so it puts
 *   foam exactly where the surface comes within a few centimetres of the sand.
 *   That line runs up and down the beach as each wave arrives and drains — the
 *   swash — without any separate animation driving it. Breaking crests and
 *   offshore whitecaps get their own foam.
 *
 *   A REEF. Branching, brain, table and fan corals, sponges, rocks and kelp in
 *   patches along the shelf, with schools of fish circling them. Only drawn
 *   when you are near the coast, and the fish only move when you can see them.
 *
 * Every height the shaders use is mirrored exactly on the CPU (`groundAt`,
 * `heightAt`) so boats ride the actual waves, swimmers float on them, and the
 * physics floor is the same sand you see.
 */

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Shore-to-open-sea height profile, d metres outward from the shoreline. */
function bedProfile(d) {
  let h = 0.04;
  h += (-0.35 - h) * ss(45, 105, d);     // dry sand running down to the swash
  h += (-1.45 - h) * ss(105, 165, d);    // the swash zone; waterline ~135 m
  h += (-9.0 - h) * ss(165, 440, d);     // the shelf the reef sits on
  h += (-28.0 - h) * ss(440, 1300, d);   // open seabed
  return h;
}

const GLSL_COMMON = /* glsl */`
  uniform float uTime;
  uniform float uShore;
  uniform float uSea;
  uniform vec4 uBasin;   // marina: x0, x1, unused, depth
  uniform vec4 uHarbour; // docks: z0, z1, unused, depth
  uniform vec4 uStrip;   // runway causeway: x0, x1, z0, z1

  float oceanDist(vec2 p) { return max(abs(p.x), abs(p.y)) - uShore; }

  float bedProfile(float d) {
    float h = 0.04;
    h = mix(h, -0.35, smoothstep(45.0, 105.0, d));
    h = mix(h, -1.45, smoothstep(105.0, 165.0, d));
    h = mix(h, -9.0, smoothstep(165.0, 440.0, d));
    h = mix(h, -28.0, smoothstep(440.0, 1300.0, d));
    return h;
  }

  float bedHeight(vec2 p) {
    float d = oceanDist(p);
    float h = bedProfile(d);
    // The marina is dredged almost to its quay, so there is water at the
    // pontoons rather than a hundred metres of sand under them.
    float basin = smoothstep(uBasin.x, uBasin.x + 14.0, p.x) * (1.0 - smoothstep(uBasin.y - 14.0, uBasin.y, p.x))
      * smoothstep(16.0, 34.0, d) * step(0.0, p.y) * step(abs(p.x), abs(p.y));
    h = mix(h, min(h, uBasin.w), basin);
    // The docks are dredged deeper still: a ship has to lie alongside.
    float harb = smoothstep(uHarbour.x, uHarbour.x + 18.0, p.y) * (1.0 - smoothstep(uHarbour.y - 18.0, uHarbour.y, p.y))
      * smoothstep(8.0, 26.0, d) * step(0.0, p.x) * step(abs(p.y), abs(p.x));
    h = mix(h, min(h, uHarbour.w), harb);
    float strip = smoothstep(uStrip.x - 25.0, uStrip.x, p.x) * (1.0 - smoothstep(uStrip.y, uStrip.y + 25.0, p.x))
      * smoothstep(uStrip.z - 25.0, uStrip.z, p.y) * (1.0 - smoothstep(uStrip.w, uStrip.w + 25.0, p.y));
    h = mix(h, max(h, 0.04), strip);
    return h;
  }

  float surfLine(float d) {
    float a = smoothstep(112.0, 150.0, d) * (1.0 - smoothstep(210.0, 380.0, d));
    float s = 0.5 + 0.5 * sin(d * 0.19 + uTime * 1.45);
    return a * s * s * s;
  }

  float oceanH(vec2 p) {
    float d = oceanDist(p);
    float swell = smoothstep(90.0, 420.0, d) * (1.0 - smoothstep(1400.0, 1700.0, d));
    float h = swell * (
        0.38 * sin(dot(p, vec2(0.0194, 0.0071)) + uTime * 0.62)
      + 0.24 * sin(dot(p, vec2(-0.0112, 0.0231)) + uTime * 0.81)
      + 0.13 * sin(dot(p, vec2(0.0421, -0.0263)) + uTime * 1.13));
    return h + 0.30 * surfLine(d);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/** Four trapezoid strips tiling a square ring, rows at the given distances. */
function ringGeometry(shore, rows, cols, heightAt) {
  const geos = [];
  const sides = [
    (s, L) => [s, L], (s, L) => [L, -s], (s, L) => [-s, -L], (s, L) => [-L, s]
  ];
  for (const place of sides) {
    const pos = [];
    for (const d of rows) {
      const L = shore + d;
      for (let c = 0; c <= cols; c++) {
        const s = -L + (2 * L * c) / cols;
        const [x, z] = place(s, L);
        pos.push(x, heightAt(x, z), z);
      }
    }
    const W = cols + 1;
    const idx = [];
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * W + c, b = a + 1, cc = a + W, dd = cc + 1;
        idx.push(a, cc, b, b, cc, dd);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    // Face the sky whichever way round the strip was laid.
    g.computeVertexNormals();
    let up = 0;
    const n = g.attributes.normal;
    for (let i = 0; i < Math.min(n.count, 64); i++) up += n.getY(i);
    if (up < 0) {
      for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = pos[i * 3] / 7;
      uv[i * 2 + 1] = pos[i * 3 + 2] / 7;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  return merged;
}

function rowsFrom(spans) {
  const out = [];
  for (const [a, b, step] of spans) {
    for (let d = a; d < b; d += step) out.push(d);
  }
  out.push(spans[spans.length - 1][1]);
  return out;
}

/** Tileable ripple normal map from integer-frequency sines. */
function rippleTexture() {
  const S = 256;
  const waves = [
    [3, 1, 0.5, 0.0], [1, 4, 0.35, 1.3], [5, -2, 0.22, 2.1], [-4, 6, 0.16, 0.7],
    [7, 3, 0.12, 4.0], [2, -7, 0.1, 5.2], [9, 5, 0.06, 3.3], [-6, -9, 0.05, 1.9],
    [12, -4, 0.04, 0.4], [-11, 8, 0.03, 2.8]
  ];
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [fx, fy, a, ph] of waves) v += a * Math.sin(Math.PI * 2 * (fx * x / S + fy * y / S) + ph);
      h[y * S + x] = v;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const k = 5.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dz = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      let nx = -dx * k, ny = 1, nz = -dz * k;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * S + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 2] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class Ocean {
  constructor(city, opts = {}) {
    this.city = city;
    this.world = city.world;
    this.shore = city.shore;
    this.sea = city.seaLevel;
    this.basin = opts.basin || { x0: 1e6, x1: 1e6, depth: -3 };
    this.harbour = opts.harbour || { z0: 1e6, z1: 1e6, depth: -7 };
    this.strip = opts.strip || { x0: 1e6, x1: 1e6, z0: 1e6, z1: 1e6 };
    this.rand = opts.rand || Math.random;
    this.time = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uShore: { value: this.shore },
      uSea: { value: this.sea },
      uBasin: { value: new THREE.Vector4(this.basin.x0, this.basin.x1, 0, this.basin.depth) },
      uHarbour: { value: new THREE.Vector4(this.harbour.z0, this.harbour.z1, 0, this.harbour.depth) },
      uStrip: { value: new THREE.Vector4(this.strip.x0, this.strip.x1, this.strip.z0, this.strip.z1) },
      uRipple: { value: rippleTexture() }
    };

    this._buildSeabed();
    this._buildWater();
    this._buildReef();
  }

  // ------------------------------------------------------------ CPU mirrors

  /** Height of sand or seabed at a point beyond the shoreline. */
  groundAt(x, z) {
    const d = Math.max(Math.abs(x), Math.abs(z)) - this.shore;
    if (d < 0) return 0;
    let h = bedProfile(d);
    const b = this.basin;
    if (z > 0 && Math.abs(z) >= Math.abs(x)) {
      const e = ss(b.x0, b.x0 + 14, x) * (1 - ss(b.x1 - 14, b.x1, x)) * ss(16, 34, d);
      h += (Math.min(h, b.depth) - h) * e;
    }
    const hb = this.harbour;
    if (x > 0 && Math.abs(x) > Math.abs(z)) {
      const e = ss(hb.z0, hb.z0 + 18, z) * (1 - ss(hb.z1 - 18, hb.z1, z)) * ss(8, 26, d);
      h += (Math.min(h, hb.depth) - h) * e;
    }
    const s = this.strip;
    const e2 = ss(s.x0 - 25, s.x0, x) * (1 - ss(s.x1, s.x1 + 25, x))
      * ss(s.z0 - 25, s.z0, z) * (1 - ss(s.z1, s.z1 + 25, z));
    h += (Math.max(h, 0.04) - h) * e2;
    return h;
  }

  /** Sea surface height at a point, including swell and surf, right now. */
  heightAt(x, z) {
    const d = Math.max(Math.abs(x), Math.abs(z)) - this.shore;
    const t = this.time;
    const swell = ss(90, 420, d) * (1 - ss(1400, 1700, d));
    let h = swell * (
      0.38 * Math.sin(x * 0.0194 + z * 0.0071 + t * 0.62)
      + 0.24 * Math.sin(x * -0.0112 + z * 0.0231 + t * 0.81)
      + 0.13 * Math.sin(x * 0.0421 + z * -0.0263 + t * 1.13));
    const a = ss(112, 150, d) * (1 - ss(210, 380, d));
    const sw = 0.5 + 0.5 * Math.sin(d * 0.19 + t * 1.45);
    h += 0.30 * a * sw * sw * sw;
    return this.sea + h;
  }

  // ------------------------------------------------------------- building

  _buildSeabed() {
    const city = this.city;
    // Sand built grain by grain and sampled in world space at two scales —
    // see Ground.js. The old single tile repeated every seven metres.
    const maps = sandMaps();
    const mat = new THREE.MeshStandardMaterial({
      ...maps, color: 0xffffff, roughness: 1.0, metalness: 0.0, normalScale: new THREE.Vector2(0.9, 0.9)
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBedW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBedW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', SAND_GLSL.map)
        .replace('#include <roughnessmap_fragment>', SAND_GLSL.rough)
        .replace('#include <normal_fragment_maps>', SAND_GLSL.normal)
        .replace('#include <common>', '#include <common>\nvarying vec3 vBedW;\n' + GLSL_COMMON + /* glsl */`
          float caustic(vec2 p, float t) {
            vec2 q = p + vec2(sin(p.y * 1.3 + t * 0.7), cos(p.x * 1.1 - t * 0.6)) * 0.6;
            float v = sin(q.x * 2.1 + t * 0.9) * sin(q.y * 2.3 - t * 0.8);
            float w = sin((q.x + q.y) * 1.7 + t * 1.1);
            return pow(clamp(1.0 - abs(v + w * 0.5), 0.0, 1.0), 6.0);
          }`)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + /* glsl */`
          {
            float depthB = uSea - vBedW.y;
            // Wet sand a little above the still waterline, where the swash reaches.
            float wet = smoothstep(-0.45, 0.05, depthB);
            diffuseColor.rgb *= mix(1.0, 0.6, wet);
            float uw = smoothstep(0.0, 1.2, depthB);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.86, 0.9), uw);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.26, 0.34), smoothstep(2.0, 26.0, depthB) * 0.8);
            // Sunlight focused by the surface, dancing on the seabed in the shallows.
            float c = caustic(vBedW.xz * 0.28, uTime) + 0.6 * caustic(vBedW.xz * 0.61 + 3.1, uTime * 1.3);
            diffuseColor.rgb += c * vec3(0.42, 0.6, 0.58) * uw * (1.0 - smoothstep(3.0, 18.0, depthB)) * 0.55;
          }`);
    };

    const rows = rowsFrom([[0, 45, 15], [45, 200, 2.5], [200, 520, 8], [520, 1700, 40]]);
    const geo = ringGeometry(this.shore, rows, 180, (x, z) => this.groundAt(x, z));
    const bed = new THREE.Mesh(geo, mat);
    bed.receiveShadow = true;
    this.world.group.add(bed);
    this.bed = bed;
  }

  _buildWater() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.06, metalness: 0.18, envMapIntensity: 1.25,
      transparent: true, side: THREE.DoubleSide
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\nvarying float vOceanH;\n' + GLSL_COMMON)
        .replace('#include <beginnormal_vertex>', /* glsl */`
          vec2 owp = position.xz;
          float oh = oceanH(owp);
          float ohx = oceanH(owp + vec2(1.5, 0.0));
          float ohz = oceanH(owp + vec2(0.0, 1.5));
          vec3 objectNormal = normalize(vec3(-(ohx - oh) / 1.5, 1.0, -(ohz - oh) / 1.5));
          vOceanH = oh;
          vWN = objectNormal;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += vOceanH;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uRipple;\nvarying vec3 vWPos;\nvarying vec3 vWN;\nvarying float vOceanH;\n' + GLSL_COMMON)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + /* glsl */`
          float foamAmt = 0.0;
          {
            float dS = oceanDist(vWPos.xz);
            float depthW = max(0.0, vWPos.y - bedHeight(vWPos.xz));
            vec3 shallow = vec3(0.17, 0.68, 0.67);
            vec3 midC = vec3(0.05, 0.38, 0.47);
            vec3 deep = vec3(0.02, 0.13, 0.23);
            vec3 wc = mix(shallow, midC, smoothstep(0.3, 5.0, depthW));
            wc = mix(wc, deep, smoothstep(5.0, 22.0, depthW));
            float alpha = mix(0.38, 0.93, smoothstep(0.2, 9.0, depthW));

            float n1 = vnoise(vWPos.xz * 0.35 + vec2(uTime * 0.4, 0.0));
            float n2 = vnoise(vWPos.xz * 1.3 - vec2(0.0, uTime * 0.6));
            float lace = smoothstep(0.35, 0.75, n1 * 0.6 + n2 * 0.4);
            // Right where the water thins to nothing over the sand: the swash
            // line, which runs up and down the beach with every wave.
            float swash = (1.0 - smoothstep(0.0, 0.42, depthW)) * (0.5 + 0.5 * lace);
            // White water on the breaking crests.
            float crest = smoothstep(0.62, 0.95, surfLine(dS) / max(0.001, smoothstep(112.0, 150.0, dS) * (1.0 - smoothstep(210.0, 380.0, dS))))
              * smoothstep(112.0, 150.0, dS) * (1.0 - smoothstep(210.0, 380.0, dS)) * lace;
            // Sparse whitecaps on the biggest swells offshore.
            float caps = smoothstep(0.55, 0.85, vOceanH / 0.75) * smoothstep(0.62, 0.9, n2) * 0.55;
            foamAmt = clamp(swash + crest + caps, 0.0, 1.0);

            diffuseColor.rgb = mix(wc, vec3(0.93, 0.97, 0.98), foamAmt);
            diffuseColor.a = mix(alpha, 0.97, foamAmt);
            if (!gl_FrontFacing) {
              // From underneath: the bright, rippling ceiling you see diving.
              diffuseColor.rgb = vec3(0.3, 0.66, 0.72);
              diffuseColor.a = 0.82;
            }
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, foamAmt);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + /* glsl */`
          {
            vec2 uvA = vWPos.xz * 0.045 + vec2(uTime * 0.021, uTime * 0.013);
            vec2 uvB = vWPos.xz * 0.11 + vec2(-uTime * 0.034, uTime * 0.027);
            vec3 rA = texture2D(uRipple, uvA).xyz * 2.0 - 1.0;
            vec3 rB = texture2D(uRipple, uvB).xyz * 2.0 - 1.0;
            vec2 rip = rA.xy * 0.55 + rB.xy * 0.45;
            vec3 wn = normalize(vWN + vec3(rip.x, 0.0, rip.y) * mix(0.34, 0.08, foamAmt));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            #ifdef DOUBLE_SIDED
              normal *= faceDirection;
            #endif
          }`);
    };

    const rows = rowsFrom([[60, 200, 3], [200, 520, 10], [520, 1700, 40]]);
    const geo = ringGeometry(this.shore, rows, 190, () => 0);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = this.sea;
    water.renderOrder = 2;
    water.frustumCulled = false;
    this.world.group.add(water);
    this.water = water;

    // Open ocean past the moving grid, out to the horizon. Opaque and flat —
    // at that distance the swell is below a pixel and the fog is doing the rest.
    const far = new THREE.MeshStandardMaterial({ color: 0x0b2a3c, roughness: 0.14, metalness: 0.2, envMapIntensity: 1.0 });
    const edge = this.shore + 1700;
    const R = 24000;
    const band = (cx, cz, sx, sz) => {
      const g = new THREE.PlaneGeometry(sx, sz);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, far);
      m.position.set(cx, this.sea - 0.05, cz);
      this.world.group.add(m);
    };
    band(0, (edge + R) / 2, R * 2, R - edge);
    band(0, -(edge + R) / 2, R * 2, R - edge);
    band((edge + R) / 2, 0, R - edge, edge * 2);
    band(-(edge + R) / 2, 0, R - edge, edge * 2);
  }

  // ------------------------------------------------------------------ reef

  _buildReef() {
    const rand = this.rand;
    const shore = this.shore;
    const patches = [];
    for (let i = 0; i < 74; i++) {
      const d = 175 + Math.pow(rand(), 1.4) * 520;
      const L = shore + d;
      const s = (rand() * 2 - 1) * (L - 40);
      const side = (rand() * 4) | 0;
      const [x, z] = [[s, L], [L, -s], [-s, -L], [-L, s]][side];
      // Keep the marina basin and the runway causeway clear.
      if (z > 0 && Math.abs(z) >= Math.abs(x) && x > this.basin.x0 - 40 && x < this.basin.x1 + 40) continue;
      if (x > 0 && Math.abs(x) > Math.abs(z) && z > this.harbour.z0 - 40 && z < this.harbour.z1 + 40) continue;
      if (x > this.strip.x0 - 60 && x < this.strip.x1 + 60 && z > this.strip.z0 - 60 && z < this.strip.z1 + 60) continue;
      patches.push({ x, z, r: 14 + rand() * 26 });
    }
    this.reefPatches = patches;

    const scatter = (count, spread, minDepth) => {
      const out = [];
      let guard = 0;
      while (out.length < count && guard++ < count * 6) {
        const p = patches[(rand() * patches.length) | 0];
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * p.r * spread;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        const y = this.groundAt(x, z);
        if (this.sea - y < minDepth) continue;
        out.push({ x, y, z });
      }
      return out;
    };

    const PALETTE = [0xd9468a, 0xf07b2a, 0xf2c53d, 0x8a4fd1, 0x2fbfae, 0xc93b36, 0xf28aa8, 0x9bd13d, 0xe85d4a, 0x5a7be0];
    const tmpM = new THREE.Matrix4();
    const tmpQ = new THREE.Quaternion();
    const tmpS = new THREE.Vector3();
    const tmpP = new THREE.Vector3();
    const tmpC = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    const instanced = (geo, mat, spots, scaleLo, scaleHi, colours, squash = 1) => {
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach((sp, i) => {
        const k = scaleLo + rand() * (scaleHi - scaleLo);
        tmpQ.setFromAxisAngle(up, rand() * Math.PI * 2);
        tmpS.set(k, k * (squash === 1 ? 1 : squash + rand() * 0.3), k);
        tmpP.set(sp.x, sp.y, sp.z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        mesh.setMatrixAt(i, tmpM);
        if (colours) mesh.setColorAt(i, tmpC.setHex(colours[(rand() * colours.length) | 0]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.world.group.add(mesh);
      return mesh;
    };

    const coralMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.0 });
    const coralTwoSide = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide });
    this.reef = [];

    // Branching coral: a trunk throwing out tapering branches with rounded tips.
    {
      const parts = [];
      const trunk = new THREE.CylinderGeometry(0.05, 0.085, 0.5, 6);
      trunk.translate(0, 0.25, 0);
      parts.push(trunk);
      for (let b = 0; b < 6; b++) {
        const lean = 0.5 + (b % 3) * 0.18;
        const ang = (b / 6) * Math.PI * 2;
        const baseY = 0.28 + (b % 2) * 0.1;
        const br = new THREE.CylinderGeometry(0.022, 0.048, 0.46, 5);
        br.translate(0, 0.23, 0);
        br.rotateZ(lean);
        br.rotateY(ang);
        br.translate(0, baseY, 0);
        parts.push(br);
        // The branch's far end, carried through the same two rotations.
        const tip = new THREE.SphereGeometry(0.034, 6, 4);
        tip.translate(-0.46 * Math.sin(lean) * Math.cos(ang), baseY + 0.46 * Math.cos(lean), 0.46 * Math.sin(lean) * Math.sin(ang));
        parts.push(tip);
      }
      const geo = mergeGeometries(parts);
      for (const p of parts) p.dispose();
      this.reef.push(instanced(geo, coralMat, scatter(950, 1.0, 1.2), 0.8, 2.3, PALETTE));
    }

    // Brain coral: a squashed, lumpy dome.
    {
      const geo = new THREE.IcosahedronGeometry(0.45, 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const bump = 1 + 0.08 * Math.sin(x * 22) * Math.sin(z * 22) + 0.05 * Math.sin(y * 30);
        p.setXYZ(i, x * bump, Math.max(-0.05, y) * bump * 0.62, z * bump);
      }
      geo.computeVertexNormals();
      this.reef.push(instanced(geo, coralMat, scatter(520, 0.9, 1.0), 0.6, 2.0, [0xc9a24a, 0x9bb85a, 0xd07a4a, 0xb8a8d8, 0xe0c27a]));
    }

    // Table coral: a wide plate on a short stalk.
    {
      const plate = new THREE.CylinderGeometry(0.72, 0.5, 0.07, 14);
      plate.translate(0, 0.46, 0);
      const stalk = new THREE.CylinderGeometry(0.07, 0.12, 0.44, 6);
      stalk.translate(0, 0.22, 0);
      const geo = mergeGeometries([plate, stalk]);
      plate.dispose(); stalk.dispose();
      this.reef.push(instanced(geo, coralMat, scatter(240, 0.85, 2.0), 0.8, 2.2, [0x7fb8a8, 0xa6c77a, 0xd8a86a, 0x8fa6d6]));
    }

    // Sea fans: flat lattices standing edge-on to the current.
    {
      const fan = new THREE.CircleGeometry(0.62, 14, 0, Math.PI);
      fan.translate(0, 0.08, 0);
      const stem = new THREE.CylinderGeometry(0.02, 0.03, 0.14, 5);
      stem.translate(0, 0.07, 0);
      const geo = mergeGeometries([fan, stem]);
      fan.dispose(); stem.dispose();
      this.reef.push(instanced(geo, coralTwoSide, scatter(360, 1.0, 1.6), 0.7, 2.0, [0x8a2f6a, 0xc0392b, 0x9b59b6, 0xe67e22, 0xd35d9a]));
    }

    // Tube sponges: a clump of open-topped tubes.
    {
      const parts = [];
      const spots = [[0, 0, 0.62], [0.12, 0.05, 0.44], [-0.1, 0.09, 0.5], [0.03, -0.12, 0.36]];
      for (const [x, z, h] of spots) {
        const t = new THREE.CylinderGeometry(0.065, 0.075, h, 9, 1, true);
        t.translate(x, h / 2, z);
        parts.push(t);
      }
      const geo = mergeGeometries(parts);
      for (const p of parts) p.dispose();
      this.reef.push(instanced(geo, coralTwoSide, scatter(380, 1.0, 1.4), 0.8, 2.1, [0xf39c12, 0xf1c40f, 0xe74c3c, 0x8e44ad, 0x16a085]));
    }

    // Rocks the reef grows on.
    {
      const geo = new THREE.DodecahedronGeometry(0.7, 0);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) * (0.8 + Math.abs(Math.sin(i * 1.7)) * 0.4), Math.max(-0.1, p.getY(i)) * 0.55, p.getZ(i) * (0.8 + Math.abs(Math.cos(i * 2.3)) * 0.4));
      }
      geo.computeVertexNormals();
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d6a60, roughness: 0.95 });
      this.reef.push(instanced(geo, rockMat, scatter(720, 1.25, 0.6), 0.6, 2.6, [0x6d6a60, 0x5a5c55, 0x7a7266, 0x4f5552]));
    }

    // Kelp: tall ribbons that sway with the swell.
    {
      const a = new THREE.PlaneGeometry(0.26, 2.4, 1, 8);
      a.translate(0, 1.2, 0);
      const b = a.clone();
      b.rotateY(Math.PI / 2);
      const geo = mergeGeometries([a, b]);
      a.dispose(); b.dispose();
      const kelpMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
      kelpMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.uniforms.uTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
            float kh = clamp(position.y / 2.4, 0.0, 1.0);
            #ifdef USE_INSTANCING
              float kph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.23;
            #else
              float kph = 0.0;
            #endif
            transformed.x += sin(uTime * 1.1 + kph) * 0.38 * kh * kh;
            transformed.z += cos(uTime * 0.9 + kph * 1.3) * 0.24 * kh * kh;`);
      };
      this.reef.push(instanced(geo, kelpMat, scatter(1150, 1.5, 2.2), 0.7, 1.9, [0x3f7a3a, 0x5c8a2e, 0x2f6b4f, 0x6f8f35], 1.0));
    }

    // Fish, in schools that circle the reef patches.
    {
      const body = new THREE.ConeGeometry(0.085, 0.34, 7);
      body.rotateX(Math.PI / 2);
      const tail = new THREE.ConeGeometry(0.07, 0.1, 4);
      tail.rotateX(-Math.PI / 2);
      tail.translate(0, 0, -0.2);
      const geo = mergeGeometries([body, tail]);
      body.dispose(); tail.dispose();
      geo.scale(1, 0.75, 1);
      const fishMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 });
      const schools = [];
      const FISH_COLOURS = [0xf5d142, 0x3aa6e8, 0xf07b2a, 0xd8e0e6, 0x8be0c8, 0xe0457a];
      const PER = 16;
      for (let i = 0; i < 30 && patches.length; i++) {
        const p = patches[(rand() * patches.length) | 0];
        const bed = this.groundAt(p.x, p.z);
        if (this.sea - bed < 2.5) continue;
        schools.push({
          x: p.x, z: p.z,
          y: Math.min(this.sea - 1.2, bed + 1.5 + rand() * 3),
          r: 4 + rand() * 9, w: (0.25 + rand() * 0.35) * (rand() < 0.5 ? -1 : 1),
          phase: rand() * Math.PI * 2,
          colour: FISH_COLOURS[(rand() * FISH_COLOURS.length) | 0],
          offsets: Array.from({ length: PER }, () => [rand() * 1.6, (rand() - 0.5) * 1.4, (rand() - 0.5) * 1.8, rand()])
        });
      }
      const fish = new THREE.InstancedMesh(geo, fishMat, Math.max(1, schools.length * PER));
      schools.forEach((sc, si) => {
        for (let k = 0; k < PER; k++) fish.setColorAt(si * PER + k, tmpC.setHex(sc.colour).offsetHSL((sc.offsets[k][3] - 0.5) * 0.04, 0, 0));
      });
      if (fish.instanceColor) fish.instanceColor.needsUpdate = true;
      fish.frustumCulled = false;
      this.world.group.add(fish);
      this.fish = fish;
      this.schools = schools;
      this.reef.push(fish);
    }
  }

  // --------------------------------------------------------------- per frame

  update(dt, camera) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    // The reef is only drawn when the coast is close enough to matter — from
    // downtown it is hundreds of metres of fog and water away.
    const cam = camera ? camera.position : null;
    const dCam = cam ? Math.max(Math.abs(cam.x), Math.abs(cam.z)) - this.shore : 0;
    const show = dCam > -220;
    for (const m of this.reef) m.visible = show;
    if (!show || !this.fish) return;

    const tmpM = this._m || (this._m = new THREE.Matrix4());
    const q = this._q || (this._q = new THREE.Quaternion());
    const e = this._e || (this._e = new THREE.Euler());
    const p = this._p || (this._p = new THREE.Vector3());
    const one = this._one || (this._one = new THREE.Vector3(1, 1, 1));
    const PER = this.schools.length ? this.schools[0].offsets.length : 0;
    this.schools.forEach((sc, si) => {
      const base = sc.phase + this.time * sc.w;
      for (let k = 0; k < PER; k++) {
        const [dr, dy, lag, wig] = sc.offsets[k];
        const a = base - lag * 0.25;
        const r = sc.r + dr;
        p.set(sc.x + Math.cos(a) * r, sc.y + dy + Math.sin(this.time * 2 + wig * 6) * 0.15, sc.z + Math.sin(a) * r);
        // Face along the circle, with a little tail-wag yaw.
        const heading = Math.atan2(-Math.sin(a) * Math.sign(sc.w), Math.cos(a) * Math.sign(sc.w));
        e.set(0, heading + Math.sin(this.time * 9 + wig * 12) * 0.18, 0);
        q.setFromEuler(e);
        tmpM.compose(p, q, one);
        this.fish.setMatrixAt(si * PER + k, tmpM);
      }
    });
    this.fish.instanceMatrix.needsUpdate = true;
  }
}
