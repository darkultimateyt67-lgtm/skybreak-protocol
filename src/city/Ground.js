import * as THREE from 'three';
import { WIND } from '../world/Wind.js';

/**
 * Ground — the surfaces you stand on: beach sand, park lawns, and everything
 * lying on them.
 *
 * WHAT WAS WRONG. The sand was one 512-pixel tile repeated every seven metres
 * across eight kilometres of beach: blurry at your feet, a visible repeating
 * grid from any height, and eighteen straight "ripple" lines per tile. The
 * park lawns were a flat plane with the same noise stamped forty times over.
 * Neither had anything ON it — no shells, no weed, no fallen leaves, no grass
 * that stood up off the ground.
 *
 * WHAT THIS DOES.
 *
 *   SAND is sampled in WORLD space at two scales and two angles, so there is
 *   no tile to see; its texture is built per pixel with individual mineral
 *   grains, quartz glints and shell fragments; dry sand carries wind ripples
 *   (asymmetric, gentle on the windward side and steep on the lee, warped so
 *   they wander rather than run in rulers); the swash zone turns dark and
 *   glossy like real wet sand; and the beach is scattered with shells,
 *   pebbles, a weed line at high tide, driftwood and dune grass.
 *
 *   LAWNS get a dense blade texture, patchy lush-and-dry colour, mowing
 *   stripes along each park's long side, and real 3D grass that moves in the
 *   same wind as the trees and parts around you as you walk through it.
 *   Under every tree: a mulch bed with an edge, and fallen leaves. Through
 *   every park: a gravel path with stone edging, benches and a bin.
 *
 * Everything is instanced or merged. The grass is the only heavy part, so it
 * is only drawn for parks near the camera.
 */

// ------------------------------------------------------------ texture kit

/** Tileable value noise over [0,1)^2 with the given lattice period. */
function tileNoise(period, seed) {
  const g = new Float32Array(period * period);
  let s = seed | 0 || 1;
  for (let i = 0; i < g.length; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; }
  const at = (x, y) => g[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (u, v) => {
    const x = u * period, y = v * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

/**
 * Deterministic hash in [0,1).
 *
 * Math.imul, not `*`. A plain multiply of two 32-bit values runs past 2^53,
 * the float silently drops the low bits, and the "random" result correlates
 * with its inputs — which is exactly how the grass came out planted in rows.
 */
function hash(x, y, k = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Turn a height field into a tangent-space normal map canvas. */
function normalCanvas(height, S, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const H = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let nx = (H(x - 1, y) - H(x + 1, y)) * strength;
      let ny = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * S + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A full sand material set: colour, normal, roughness — grain by grain. */
export function sandMaps(S = 1024) {
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const cg = col.getContext('2d');
  const ci = cg.createImageData(S, S);
  const rough = document.createElement('canvas');
  rough.width = rough.height = S;
  const rg = rough.getContext('2d');
  const ri = rg.createImageData(S, S);
  const height = new Float32Array(S * S);
  const clump = tileNoise(6, 11), mottle = tileNoise(24, 23), fine = tileNoise(96, 37);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n1 = clump(u, v), n2 = mottle(u, v), n3 = fine(u, v);
      const gr = hash(x, y);
      // Base: warm beach sand, broken up at three scales plus grain noise.
      const tone = 0.82 + 0.18 * n1 + 0.09 * n2 + 0.06 * n3 + 0.2 * (gr - 0.5);
      let r = 192 * tone, g = 168 * tone, b = 126 * tone;
      let h = 0.45 + 0.18 * n3 + 0.22 * (gr - 0.5);
      let ro = 0.93;
      // Individual grains: dark minerals, quartz glints, shell fragments.
      const k = hash(x, y, 7);
      if (k > 0.982) { const d = 0.45 + 0.2 * hash(x, y, 3); r *= d; g *= d * 0.98; b *= d * 0.95; h -= 0.08; }
      else if (k > 0.972) { r = 250; g = 246; b = 236; h += 0.18; ro = 0.55; }
      else if (k > 0.969) { r = 238; g = 206; b = 196; h += 0.22; ro = 0.6; }
      else if (k > 0.962) { r *= 1.08; g *= 1.0; b *= 0.86; }           // iron-stained grain
      const o = (y * S + x) * 4;
      ci.data[o] = Math.min(255, r); ci.data[o + 1] = Math.min(255, g); ci.data[o + 2] = Math.min(255, b); ci.data[o + 3] = 255;
      const rv = Math.min(255, (ro + 0.05 * (hash(x, y, 9) - 0.5)) * 255);
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = rv; ri.data[o + 3] = 255;
      height[y * S + x] = h;
    }
  }
  cg.putImageData(ci, 0, 0);
  rg.putImageData(ri, 0, 0);
  return {
    map: tex(col, true),
    normalMap: tex(normalCanvas(height, S, 3.2), false),
    roughnessMap: tex(rough, false)
  };
}

/**
 * GLSL for world-space sand. Needs `vBedW` (world position) and `vnoise`
 * (from the Ocean's common block) in the fragment shader, plus `uSea`.
 */
export const SAND_GLSL = {
  // Replaces <map_fragment>. Two scales at two angles: no tile, anywhere.
  map: /* glsl */`
    vec2 sw = vBedW.xz;
    vec2 swB = mat2(0.8, -0.6, 0.6, 0.8) * sw;
    vec4 sA = texture2D(map, sw / 1.6);
    vec4 sB = texture2D(map, swB / 9.3 + 0.37);
    vec4 texelColor = mix(sA, sB, 0.38);
    // Broad tonal drift: darker damp hollows, bleached crests.
    float tone = vnoise(sw * 0.021) * 0.55 + vnoise(sw * 0.083) * 0.3 + vnoise(sw * 0.31) * 0.15;
    texelColor.rgb *= 0.86 + 0.26 * tone;
    diffuseColor *= texelColor;
  `,
  // Replaces <roughnessmap_fragment>. Wet sand at the swash is glossy.
  rough: /* glsl */`
    float roughnessFactor = roughness;
    {
      float rA = texture2D(roughnessMap, vBedW.xz / 1.6).g;
      float rB = texture2D(roughnessMap, (mat2(0.8, -0.6, 0.6, 0.8) * vBedW.xz) / 9.3 + 0.37).g;
      roughnessFactor *= mix(rA, rB, 0.38);
      float dB = uSea - vBedW.y;
      float gloss = smoothstep(-0.55, -0.15, dB) * (1.0 - smoothstep(0.25, 0.9, dB));
      roughnessFactor = mix(roughnessFactor, 0.16, gloss * 0.85);
    }
  `,
  // Replaces the tangent-space branch of <normal_fragment_maps>.
  normal: /* glsl */`
    {
      vec2 sw = vBedW.xz;
      vec3 nA = texture2D(normalMap, sw / 1.6).xyz * 2.0 - 1.0;
      vec3 nB = texture2D(normalMap, (mat2(0.8, -0.6, 0.6, 0.8) * sw) / 9.3 + 0.37).xyz * 2.0 - 1.0;
      vec3 mapN = normalize(mix(nA, nB, 0.38));
      mapN.xy *= normalScale;
      float dB = uSea - vBedW.y;
      float px = length(fwidth(sw));
      // Wind ripples on the dry sand: two crossing sets, warped so the crests
      // wander, fork and die out, with a gentle windward face and a short lee.
      // Kept subtle — at full strength they read as a raked garden.
      float dry = 1.0 - smoothstep(-0.9, -0.35, dB);
      vec2 wd = normalize(vec2(0.62, 0.40));
      vec2 wd2 = normalize(vec2(0.35, 0.72));
      float warp = vnoise(sw * 0.07) * 6.0 + vnoise(sw * 0.23) * 2.2 + vnoise(sw * 0.9) * 0.35;
      float q = dot(sw, wd) + warp;
      // Named apart from the underwater set below: two variables of the same
      // name in one GLSL scope is a compile error, and a beach whose shader
      // will not compile is a beach that does not draw at all.
      float qB = dot(sw, wd2) + warp * 0.8 + 3.7;
      float ph = fract(q / 0.14), phB = fract(qB / 0.19);
      float slope = ph < 0.7 ? 1.0 / 0.7 : -1.0 / 0.3;
      float slopeB = phB < 0.7 ? 1.0 / 0.7 : -1.0 / 0.3;
      float patchy = smoothstep(0.35, 0.7, vnoise(sw * 0.12 + 5.0));
      float ripA = dry * (1.0 - smoothstep(0.006, 0.026, px)) * 0.22 * (0.4 + 0.6 * patchy);
      float ripA2 = dry * (1.0 - smoothstep(0.006, 0.026, px)) * 0.12 * (1.0 - patchy);
      // Underwater: bigger, symmetric wave ripples in the shallows.
      float wet = smoothstep(0.15, 0.6, dB) * (1.0 - smoothstep(2.5, 6.0, dB));
      float q2 = dot(sw, vec2(0.0, 1.0)) + vnoise(sw * 0.05) * 3.0;
      float s2 = cos(q2 * 6.2831 / 0.55);
      float ripB = wet * (1.0 - smoothstep(0.02, 0.08, px)) * 0.45;
      vec2 grad = wd * slope * ripA + wd2 * slopeB * ripA2 + vec2(0.0, 1.0) * s2 * ripB;
      mapN.xy += grad * 0.45;
      // Hummocks: the sand is never a billiard table. Low-frequency relief as
      // a normal tilt, strongest on the dry upper beach.
      float e = 0.35;
      float h0 = vnoise(sw * 0.35) + 0.4 * vnoise(sw * 1.3);
      float hx = vnoise((sw + vec2(e, 0.0)) * 0.35) + 0.4 * vnoise((sw + vec2(e, 0.0)) * 1.3);
      float hz = vnoise((sw + vec2(0.0, e)) * 0.35) + 0.4 * vnoise((sw + vec2(0.0, e)) * 1.3);
      mapN.xy += vec2(h0 - hx, h0 - hz) * (0.9 * dry + 0.3);
      normal = normalize(tbn * normalize(mapN));
    }
  `
};

/** A lawn: dense blades, clover, the odd daisy. */
function lawnMaps(S = 1024) {
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const g = col.getContext('2d');
  g.fillStyle = '#35532a';
  g.fillRect(0, 0, S, S);
  const patch = tileNoise(5, 5);
  // Soil showing through at the roots.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    g.fillStyle = `rgba(${60 + Math.random() * 30},${48 + Math.random() * 20},${30},${0.25 + Math.random() * 0.3})`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  // Blades, drawn in colour batches so eighty thousand strokes cost a dozen
  // stroke() calls. Each is short, slightly curved, and wraps across the tile
  // edge so the texture repeats seamlessly.
  const shades = [];
  for (let k = 0; k < 12; k++) {
    const l = 0.2 + (k / 11) * 0.34;
    const hue = 0.24 + (Math.random() - 0.5) * 0.04 + (k % 3 === 0 ? -0.03 : 0);
    shades.push(new THREE.Color().setHSL(hue, 0.42 + Math.random() * 0.2, l, THREE.SRGBColorSpace).getStyle(THREE.SRGBColorSpace));
  }
  for (let k = 0; k < shades.length; k++) {
    g.strokeStyle = shades[k];
    g.lineWidth = 1.1 + (k % 4) * 0.3;
    g.beginPath();
    for (let i = 0; i < 6800; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      // Dry patches get more of the pale shades.
      if (k > 8 && patch(x / S, y / S) < 0.45 && Math.random() < 0.6) continue;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.3;
      const L = 5 + Math.random() * 12;
      const bx = Math.cos(a) * L, by = Math.sin(a) * L;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        if (ox && Math.abs(x + ox - S / 2) > S / 2 + L) continue;
        if (oy && Math.abs(y + oy - S / 2) > S / 2 + L) continue;
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + bx * 0.5 + (Math.random() - 0.5) * 3, y + oy + by * 0.5, x + ox + bx, y + oy + by);
      }
    }
    g.stroke();
  }
  // Clover patches and a scatter of daisies.
  for (let i = 0; i < 70; i++) {
    const cx = Math.random() * S, cy = Math.random() * S;
    for (let j = 0; j < 40; j++) {
      const x = cx + (Math.random() - 0.5) * 50, y = cy + (Math.random() - 0.5) * 50;
      g.fillStyle = `rgba(${55 + Math.random() * 20},${105 + Math.random() * 30},${45},0.9)`;
      for (let p = 0; p < 3; p++) {
        const a = (p / 3) * Math.PI * 2;
        g.beginPath(); g.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 2.1, 0, 7); g.fill();
      }
    }
  }
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    g.fillStyle = 'rgba(245,245,238,0.95)';
    for (let p = 0; p < 7; p++) {
      const a = (p / 7) * Math.PI * 2;
      g.beginPath(); g.ellipse(x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 1.6, 0.8, a, 0, 7); g.fill();
    }
    g.fillStyle = '#e8c23a';
    g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill();
  }
  // Height from luminance: blades stand, soil sits low.
  const d = g.getImageData(0, 0, S, S).data;
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return { map: tex(col, true), normalMap: tex(normalCanvas(h, S, 2.2), false) };
}

/** Bark mulch and soil for the beds under the trees. */
function mulchTexture(S = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2a1c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const w = 4 + Math.random() * 14, h = 2 + Math.random() * 5;
    const v = 60 + Math.random() * 70;
    g.fillStyle = `rgb(${v},${v * 0.72 | 0},${v * 0.46 | 0})`;
    g.save(); g.translate(x, y); g.rotate(Math.random() * Math.PI);
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(-w / 2, h / 2 - 1, w, 1);
    g.restore();
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(20,14,8,${0.3 + Math.random() * 0.4})`;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 0, 7); g.fill();
  }
  // Fade to soil at the rim so the bed sits into the lawn.
  const rad = g.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S * 0.5);
  rad.addColorStop(0, 'rgba(40,30,20,0)');
  rad.addColorStop(1, 'rgba(40,30,20,0.85)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  return tex(c, true);
}

/** Pea gravel for the paths. */
function gravelMaps(S = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#7d7568';
  g.fillRect(0, 0, S, S);
  const h = new Float32Array(S * S).fill(0.3);
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const r = 2 + Math.random() * 4.5;
    const v = 110 + Math.random() * 90;
    const warm = Math.random();
    g.fillStyle = `rgb(${v + warm * 18 | 0},${v + warm * 6 | 0},${v - 10 - warm * 12 | 0})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.7 + Math.random() * 0.3), Math.random() * 3, 0, 7); g.fill();
    for (let yy = -r; yy <= r; yy++) {
      for (let xx = -r; xx <= r; xx++) {
        const dd = (xx * xx + yy * yy) / (r * r);
        if (dd > 1) continue;
        const ix = ((x + xx) | 0) % S, iy = ((y + yy) | 0) % S;
        h[iy * S + ix] = Math.max(h[iy * S + ix], 0.3 + 0.7 * Math.sqrt(1 - dd));
      }
    }
  }
  return { map: tex(c, true), normalMap: tex(normalCanvas(h, S, 4), false) };
}

// ------------------------------------------------------------- materials

/**
 * A lawn material: world-space blades at two scales, patchy colour, and
 * mowing stripes along each park's long axis (carried per vertex).
 */
function lawnMaterial() {
  const maps = lawnMaps();
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.96, metalness: 0
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStripe;\nvarying vec3 vLawnW;\nvarying float vStripe;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLawnW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvStripe = aStripe;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLawnW;\nvarying float vStripe;\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', /* glsl */`
        vec2 lw = vLawnW.xz;
        vec4 gA = texture2D(map, lw / 1.25);
        vec4 gB = texture2D(map, (mat2(0.8, -0.6, 0.6, 0.8) * lw) / 6.1 + 0.21);
        vec4 texelColor = mix(gA, gB, 0.35);
        // Lush and dry patches, the way a real park lawn goes in summer.
        float p = gnoise(lw * 0.045) * 0.6 + gnoise(lw * 0.17) * 0.4;
        vec3 lush = vec3(0.80, 1.00, 0.78), dry = vec3(1.18, 1.06, 0.66);
        texelColor.rgb *= mix(lush, dry, smoothstep(0.52, 0.8, p));
        // Mowing stripes, five metres wide, along the park's long side.
        float axis = vStripe > 0.5 ? lw.y : lw.x;
        float st = smoothstep(0.42, 0.58, abs(fract(axis / 10.0) - 0.5) * 2.0);
        texelColor.rgb *= 0.93 + 0.12 * st;
        diffuseColor *= texelColor;
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        {
          vec3 mapN = texture2D(normalMap, vLawnW.xz / 1.25).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);
        }
      `);
  };
  mat.customProgramCacheKey = () => 'lawn';
  return mat;
}

/** A world-space material for gravel. */
function gravelMaterial() {
  const maps = gravelMaps();
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.95, metalness: 0
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <map_fragment>', 'vec4 texelColor = texture2D(map, vGW.xz / 0.9);\ndiffuseColor *= texelColor;')
      .replace('#include <normal_fragment_maps>', `{
        vec3 mapN = texture2D(normalMap, vGW.xz / 0.9).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);
      }`);
  };
  mat.customProgramCacheKey = () => 'gravel';
  return mat;
}

const NOISE_GLSL = /* glsl */`
  float ghash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(ghash(i), ghash(i + vec2(1.0, 0.0)), u.x), mix(ghash(i + vec2(0.0, 1.0)), ghash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

// ------------------------------------------------------------- geometry

/** A tuft: tapered blades fanning out of one root, darker at the base. */
function tuftGeometry(tall = 0.28, width = 0.034, blades = 7) {
  const pos = [], col = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const lean = 0.25 + (b % 3) * 0.12;
    const h = tall * (0.7 + ((b * 37) % 10) / 22);
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const base = pos.length / 3;
    const rows = tall < 0.2 ? 2 : 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const w = width * (1 - t * 0.92);
      const cx = dx * lean * h * t * t + dx * 0.02, cz = dz * lean * h * t * t + dz * 0.02, cy = h * t;
      pos.push(cx - px * w, cy, cz - pz * w, cx + px * w, cy, cz + pz * w);
      const k = 0.45 + 0.55 * t;
      col.push(k, k, k, k, k, k);
    }
    for (let r = 0; r < rows; r++) {
      const i = base + r * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Grass is lit from above more than from its blade faces.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const y = n.getY(i);
    n.setXYZ(i, n.getX(i) * 0.4, Math.abs(y) * 0.4 + 0.8, n.getZ(i) * 0.4);
  }
  return g;
}

/** A park bench: slatted seat and back on cast-iron ends. Returns [wood, iron]. */
function benchGeometry() {
  const wood = [], iron = [];
  const box = (arr, w, h, d, x, y, z, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    arr.push(g);
  };
  for (let i = 0; i < 4; i++) box(wood, 1.7, 0.035, 0.085, 0, 0.44, -0.16 + i * 0.105);
  for (let i = 0; i < 3; i++) box(wood, 1.7, 0.08, 0.03, 0, 0.62 + i * 0.12, -0.25 - i * 0.03, -0.22);
  for (const sx of [-0.78, 0.78]) {
    box(iron, 0.05, 0.44, 0.05, sx, 0.22, 0.18);
    box(iron, 0.05, 0.8, 0.05, sx, 0.4, -0.22, -0.2);
    box(iron, 0.05, 0.05, 0.46, sx, 0.42, -0.02);
    box(iron, 0.05, 0.04, 0.34, sx, 0.66, 0.03);
    box(iron, 0.05, 0.22, 0.04, sx, 0.55, 0.19);
  }
  return [mergeSimple(wood), mergeSimple(iron)];
}

function mergeSimple(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const idx = [];
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** A grass material that bends with the shared wind and parts around you. */
function grassMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const uPush = { value: new THREE.Vector4(0, -100, 0, 0.9) };
  const uField = { value: new THREE.Vector4(0, 0, 0, 1e6) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.uniforms.uTime;
    shader.uniforms.uWind = WIND.uniforms.uWind;
    shader.uniforms.uPush = uPush;
    shader.uniforms.uField = uField;
    // Blades are double-sided, and by default the back face of a double-sided
    // triangle flips its normal — here that turned half the grass's normals
    // toward the ground, and half the lawn rendered black. Grass is lit from
    // the sky on both faces, so the flip is taken out.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
      float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
      vec3 normal = normalize( vNormal );
      vec3 nonPerturbedNormal = normal;
    `);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;\nuniform vec4 uPush;\nuniform vec4 uField;')
      .replace('#include <project_vertex>', /* glsl */`
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 root = vec3(0.0);
        #endif
        // Shrink into the lawn toward the edge of the field, so the grass
        // grows out of the texture as you approach instead of popping in.
        float fade = 1.0 - smoothstep(uField.w * 0.7, uField.w, length(root.xz - uField.xz));
        mvPosition.xyz = root + (mvPosition.xyz - root) * vec3(1.0, fade, 1.0);
        float hb = clamp(position.y / 0.3, 0.0, 1.4);
        float bend = hb * hb * fade;
        float sp = length(uWind.xz);
        vec2 wd = uWind.xz / max(sp, 1e-4);
        float along = dot(root.xz, wd);
        float gust = 0.5 + 0.5 * sin(uTime * 1.2 - along * 0.09) * (0.7 + 0.3 * sin(uTime * 0.23 + along * 0.01));
        float flick = sin(uTime * 5.3 + root.x * 3.1 + root.z * 2.7 + position.x * 20.0);
        mvPosition.xz += wd * bend * sp * (0.07 + 0.09 * gust) + vec2(-wd.y, wd.x) * bend * flick * 0.018;
        // Parted by whoever walks through it: pushed out and flattened.
        vec2 away = root.xz - uPush.xz;
        float d = length(away);
        float push = (1.0 - smoothstep(0.1, uPush.w, d)) * step(abs(root.y - uPush.y), 2.0);
        mvPosition.xz += (d > 1e-3 ? away / d : vec2(0.0)) * bend * push * 0.22;
        mvPosition.y -= bend * push * 0.14;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `);
  };
  mat.customProgramCacheKey = () => 'park-grass';
  mat.userData.push = uPush;
  mat.userData.field = uField;
  return mat;
}

// --------------------------------------------------------------- parkland

/**
 * Dress every park the city laid out. Call once, after the blocks and before
 * the static merge.
 */
export function buildParkland(city) {
  const w = city.world;
  const parks = city.parks || [];
  const rand = city.rand || Math.random;
  const lawn = lawnMaterial();
  city.mats.lawn = lawn;
  const gravel = gravelMaterial();
  const edging = new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.88 });
  const soilEdge = new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 1.0 });
  const mulch = new THREE.MeshStandardMaterial({ map: mulchTexture(), roughness: 1.0, transparent: false });
  const grassMat = grassMaterial();
  const tuft = tuftGeometry();

  const pathGeos = [], edgeGeos = [];
  const benches = [], bins = [], pits = [];
  const lawns = [];
  const litter = [];

  for (const pk of parks) {
    // Re-skin the lawn plane with the new material, carrying the stripe axis.
    if (pk.mesh) {
      pk.mesh.material = lawn;
      const g = pk.mesh.geometry;
      const n = g.attributes.position.count;
      g.setAttribute('aStripe', new THREE.BufferAttribute(new Float32Array(n).fill(pk.bd > pk.bw ? 1 : 0), 1));
    }
    const long = pk.bd > pk.bw;           // path runs along the long side
    const L = long ? pk.bd : pk.bw;
    const S = long ? pk.bw : pk.bd;
    const pathW = 2.4;
    const off = (rand() - 0.5) * S * 0.3;
    const pc = long ? [pk.cx + off, pk.cz] : [pk.cx, pk.cz + off];
    // Gravel path, edged with stone both sides.
    {
      const g = new THREE.PlaneGeometry(long ? pathW : L, long ? L : pathW);
      g.rotateX(-Math.PI / 2);
      g.translate(pc[0], 0.172, pc[1]);
      pathGeos.push(g);
      for (const s of [-1, 1]) {
        const e = new THREE.BoxGeometry(long ? 0.12 : L, 0.06, long ? L : 0.12);
        e.translate(long ? pc[0] + s * (pathW / 2 + 0.06) : pc[0], 0.19, long ? pc[1] : pc[1] + s * (pathW / 2 + 0.06));
        edgeGeos.push(e);
      }
    }
    // Stone kerb round the lawn.
    for (const [ex, ez, sx, sz] of [
      [pk.cx, pk.cz - pk.bd / 2, pk.bw, 0.18], [pk.cx, pk.cz + pk.bd / 2, pk.bw, 0.18],
      [pk.cx - pk.bw / 2, pk.cz, 0.18, pk.bd], [pk.cx + pk.bw / 2, pk.cz, 0.18, pk.bd]
    ]) {
      const e = new THREE.BoxGeometry(sx, 0.14, sz);
      e.translate(ex, 0.2, ez);
      edgeGeos.push(e);
    }
    // Benches either side of the path, facing it, and a bin by one.
    for (let b = 0; b < 2; b++) {
      const t = (b === 0 ? -0.22 : 0.24) * L;
      const side = b === 0 ? 1 : -1;
      const pos = long
        ? [pc[0] + side * (pathW / 2 + 0.75), pc[1] + t]
        : [pc[0] + t, pc[1] + side * (pathW / 2 + 0.75)];
      const yaw = long ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
      benches.push({ x: pos[0], z: pos[1], yaw });
      if (b === 0) bins.push({ x: pos[0] + (long ? 0 : 1.3), z: pos[1] + (long ? 1.3 : 0) });
      w.physics?.addBox(new THREE.Vector3(pos[0], 0.5, pos[1]),
        new THREE.Vector3(long ? 0.6 : 1.8, 1.0, long ? 1.8 : 0.6), null, { surface: 'wood' });
    }
    // Tree beds and leaf fall.
    const inPath = (x, z) => long ? Math.abs(x - pc[0]) < pathW / 2 + 0.25 : Math.abs(z - pc[1]) < pathW / 2 + 0.25;
    for (const tr of pk.trees || []) {
      const r = 1.35 + rand() * 0.6;
      pits.push({ x: tr.x, z: tr.z, r });
      for (let i = 0; i < 46; i++) {
        const a = rand() * Math.PI * 2;
        const d = r * 0.4 + Math.pow(rand(), 0.7) * 6.5;
        const lx = tr.x + Math.cos(a) * d, lz = tr.z + Math.sin(a) * d;
        if (Math.abs(lx - pk.cx) > pk.bw / 2 - 0.3 || Math.abs(lz - pk.cz) > pk.bd / 2 - 0.3) continue;
        litter.push({ x: lx, z: lz, y: inPath(lx, lz) ? 0.176 : 0.168 });
      }
    }
    // What the grass field needs to know about this park.
    lawns.push({
      x0: pk.cx - pk.bw / 2 + 0.25, x1: pk.cx + pk.bw / 2 - 0.25,
      z0: pk.cz - pk.bd / 2 + 0.25, z1: pk.cz + pk.bd / 2 - 0.25,
      alongZ: long, pc: long ? pc[0] : pc[1], half: pathW / 2 + 0.25,
      beds: (pk.trees || []).map((t) => ({ x: t.x, z: t.z, r2: 2.0 * 2.0 })),
      benches: benches.slice(-2)
    });
  }

  const add = (mesh) => { w.group.add(mesh); return mesh; };

  // Paths and edging: plain meshes, merged with the rest of the city later.
  if (pathGeos.length) add(new THREE.Mesh(mergeSimple(pathGeos), gravel)).receiveShadow = true;
  if (edgeGeos.length) {
    const m = add(new THREE.Mesh(mergeSimple(edgeGeos), edging));
    m.receiveShadow = true; m.castShadow = true;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);

  // Benches and bins, instanced across the whole city.
  if (benches.length) {
    const [bw, bi] = benchGeometry();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5434, roughness: 0.8 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1d2320, roughness: 0.5, metalness: 0.6 });
    for (const [geo, mat] of [[bw, woodMat], [bi, ironMat]]) {
      const im = new THREE.InstancedMesh(geo, mat, benches.length);
      benches.forEach((b, i) => {
        q.setFromAxisAngle(UP, b.yaw);
        m4.compose(p.set(b.x, 0.17, b.z), q, s.set(1, 1, 1));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true; im.receiveShadow = true;
      add(im);
    }
    const binGeo = new THREE.CylinderGeometry(0.24, 0.21, 0.78, 14);
    binGeo.translate(0, 0.39, 0);
    const im = new THREE.InstancedMesh(binGeo, new THREE.MeshStandardMaterial({ color: 0x24402c, roughness: 0.55, metalness: 0.4 }), bins.length);
    bins.forEach((b, i) => { m4.compose(p.set(b.x, 0.17, b.z), q.identity(), s.set(1, 1, 1)); im.setMatrixAt(i, m4); });
    im.castShadow = true;
    add(im);
  }

  // Mulch beds with a soil rim, one draw call each for the whole city.
  if (pits.length) {
    const disc = new THREE.CircleGeometry(1, 28);
    disc.rotateX(-Math.PI / 2);
    const bed = new THREE.InstancedMesh(disc, mulch, pits.length);
    const ringG = new THREE.RingGeometry(0.97, 1.07, 28);
    ringG.rotateX(-Math.PI / 2);
    const rim = new THREE.InstancedMesh(ringG, soilEdge, pits.length);
    pits.forEach((t, i) => {
      q.setFromAxisAngle(UP, rand() * 6.28);
      m4.compose(p.set(t.x, 0.176, t.z), q, s.set(t.r, 1, t.r));
      bed.setMatrixAt(i, m4);
      m4.compose(p.set(t.x, 0.18, t.z), q, s.set(t.r, 1, t.r));
      rim.setMatrixAt(i, m4);
    });
    bed.receiveShadow = true; rim.receiveShadow = true;
    add(bed); add(rim);
  }

  // Fallen leaves: small flat leaves in autumn colours, lying where they fell.
  if (litter.length && w.foliage && w.foliage._leafTexture) {
    const lg = new THREE.PlaneGeometry(0.13, 0.17);
    lg.rotateX(-Math.PI / 2);
    const lm = new THREE.MeshLambertMaterial({ map: w.foliage._leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(lg, lm, litter.length);
    const c = new THREE.Color();
    litter.forEach((l, i) => {
      e.set((rand() - 0.5) * 0.4, rand() * 6.28, (rand() - 0.5) * 0.4);
      q.setFromEuler(e);
      const sc = 0.8 + rand() * 0.7;
      m4.compose(p.set(l.x, l.y + rand() * 0.004, l.z), q, s.set(sc, 1, sc));
      im.setMatrixAt(i, m4);
      const k = rand();
      c.setHSL(k < 0.35 ? 0.09 : (k < 0.7 ? 0.06 : 0.14), 0.55 + rand() * 0.25, 0.28 + rand() * 0.18);
      im.setColorAt(i, c);
    });
    im.receiveShadow = true;
    add(im);
  }

  const field = new GrassField(w, lawns, grassMat);

  return {
    field,
    /** Grow the lawn round the camera; part it around the player. */
    update(cam, player) {
      field.update(cam);
      if (player) grassMat.userData.push.value.set(player.x, player.y, player.z, 0.9);
    }
  };
}

/**
 * The lawn, as a field of real grass that follows the camera.
 *
 * Planting every park in full at lawn density would be close to a million
 * tufts and tens of megabytes of instance data for grass nobody is near.
 * Instead the world is divided into two-metre cells, each with its own fixed
 * pseudo-random set of tufts — so a tuft is always in the same place — and
 * only the cells within ~34 m of the camera that fall on a lawn are written
 * into one pooled instanced mesh. Dense at your feet, thinning with range,
 * shrinking into the lawn texture at the edge so nothing pops.
 */
class GrassField {
  constructor(world, lawns, mat) {
    this.lawns = lawns;
    this.mat = mat;
    this.CELL = 2.0;
    this.R = 34;
    this.cap = 42000;
    const short = tuftGeometry(0.12, 0.02, 6);
    const tall = tuftGeometry(0.3, 0.02, 7);
    this.short = new THREE.InstancedMesh(short, mat, this.cap);
    this.tall = new THREE.InstancedMesh(tall, mat, (this.cap / 6) | 0);
    for (const m of [this.short, this.tall]) {
      m.count = 0;
      m.frustumCulled = false;          // it moves with you; bounds would lag
      m.receiveShadow = true;
      m.castShadow = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      world.group.add(m);
    }
    this._cell = [1e9, 1e9];
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._UP = new THREE.Vector3(0, 1, 0);
  }

  _onLawn(L, x, z) {
    if (x < L.x0 || x > L.x1 || z < L.z0 || z > L.z1) return false;
    if (Math.abs((L.alongZ ? x : z) - L.pc) < L.half) return false;
    for (const b of L.beds) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r2) return false;
    for (const b of L.benches) if (Math.abs(x - b.x) < 1.1 && Math.abs(z - b.z) < 1.1) return false;
    return true;
  }

  update(cam) {
    const { CELL, R } = this;
    this.mat.userData.field.value.set(cam.x, cam.y, cam.z, R);
    // High above the city there is no grass to see.
    if (cam.y > 90) { this.short.count = this.tall.count = 0; return; }
    const cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL);
    if (cx === this._cell[0] && cz === this._cell[1]) return;
    this._cell = [cx, cz];
    const near = this.lawns.filter((L) => cam.x > L.x0 - R && cam.x < L.x1 + R && cam.z > L.z0 - R && cam.z < L.z1 + R);
    let ns = 0, nt = 0;
    if (near.length) {
      const n = Math.ceil(R / CELL);
      const m4 = this._m4, q = this._q, p = this._p, s = this._s, col = this._c;
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const gx = cx + i, gz = cz + j;
          const ox = gx * CELL, oz = gz * CELL;
          const d = Math.hypot(ox + CELL / 2 - cam.x, oz + CELL / 2 - cam.z);
          if (d > R) continue;
          let L = null;
          for (const c of near) {
            if (ox + CELL > c.x0 && ox < c.x1 && oz + CELL > c.z0 && oz < c.z1) { L = c; break; }
          }
          if (!L) continue;
          // Density falls smoothly with range: thirty tufts a cell at your
          // feet, a handful at the edge of the field.
          const want = 30 * Math.pow(1 - 0.85 * Math.min(1, d / R), 1.6);
          for (let k = 0; k < 30; k++) {
            if (k >= want) break;
            const hx = hash(gx, gz, k * 3 + 1), hz = hash(gx, gz, k * 3 + 2), hk = hash(gx, gz, k * 3 + 3);
            const x = ox + hx * CELL, z = oz + hz * CELL;
            if (!this._onLawn(L, x, z)) continue;
            const isTall = hk > 0.9;
            if (isTall ? nt >= this.tall.instanceMatrix.count : ns >= this.cap) continue;
            q.setFromAxisAngle(this._UP, hk * 40);
            const sc = 0.7 + hash(gx, gz, k + 91) * 0.7;
            m4.compose(p.set(x, 0.165, z), q, s.set(sc, sc * (0.75 + hash(gx, gz, k + 57) * 0.6), sc));
            col.setHSL(0.25 + (hash(gx, gz, k + 13) - 0.5) * 0.05, 0.55 + hash(gx, gz, k + 7) * 0.2,
              0.40 + hash(gx, gz, k + 5) * 0.16, THREE.SRGBColorSpace);
            if (isTall) { this.tall.setMatrixAt(nt, m4); this.tall.setColorAt(nt, col); nt++; }
            else { this.short.setMatrixAt(ns, m4); this.short.setColorAt(ns, col); ns++; }
          }
        }
      }
    }
    this.short.count = ns;
    this.tall.count = nt;
    for (const m of [this.short, this.tall]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

/** A shoe print: heel and treaded forefoot, soft-edged, pressed into sand. */
function footprintTexture() {
  const w = 64, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const blob = (x, y, rx, ry, a) => {
    const r = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    r.addColorStop(0, `rgba(255,255,255,${a})`);
    r.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`);
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y);
    g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, 7); g.fill();
    g.restore();
  };
  blob(w * 0.5, h * 0.3, w * 0.36, h * 0.25, 0.95);
  blob(w * 0.5, h * 0.78, w * 0.28, h * 0.17, 0.95);
  blob(w * 0.5, h * 0.55, w * 0.16, h * 0.12, 0.5);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) g.fillRect(w * 0.18, h * (0.16 + i * 0.07), w * 0.64, h * 0.018);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------- beach debris

/**
 * Things washed up and growing on the beach: shells and pebbles across the
 * sand, a line of weed and small wrack along high tide, driftwood, and dune
 * grass on the upper beach against the promenade.
 */
export function buildBeachDebris(city, ocean) {
  const w = city.world;
  const shore = ocean.shore;
  const sea = ocean.sea;
  const rand = city.rand || Math.random;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const e = new THREE.Euler();

  // A point on the beach ring at a given distance past the shoreline.
  const onRing = (d) => {
    const side = (rand() * 4) | 0;
    const along = (rand() - 0.5) * 2 * (shore + d);
    const r = shore + d;
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? -r : r;
    const z = side === 0 ? -r : side === 1 ? r : along;
    return [x, z];
  };
  const blocked = (x, z) => {
    if (ocean.basin && x > ocean.basin.x0 - 20 && x < ocean.basin.x1 + 20 && z > shore - 10) return true;
    const st = ocean.strip;
    if (st && x > st.x0 - 10 && x < st.x1 + 10 && z > st.z0 - 10 && z < st.z1 + 10) return true;
    return false;
  };

  const chunks = new Map();
  const CH = 320;
  const put = (kind, geo, mat, x, y, z, rot, scl, color) => {
    const key = kind + ':' + Math.floor(x / CH) + ',' + Math.floor(z / CH);
    if (!chunks.has(key)) chunks.set(key, { kind, geo, mat, list: [] });
    chunks.get(key).list.push({ x, y, z, rot, scl, color });
  };

  // Shells: a fluted scallop, flattened.
  const shellGeo = new THREE.ConeGeometry(0.045, 0.02, 9, 1, true, 0, Math.PI * 1.2);
  shellGeo.rotateX(Math.PI / 2 - 0.2);
  const shellMat = new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide });
  const pebbleGeo = new THREE.DodecahedronGeometry(0.05, 0);
  pebbleGeo.scale(1, 0.55, 0.8);
  const pebbleMat = new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true });
  // Weed: a crumpled dark ribbon.
  const weedGeo = new THREE.PlaneGeometry(0.5, 0.12, 6, 1);
  {
    const pa = weedGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) * 12) * 0.03);
    weedGeo.rotateX(-Math.PI / 2);
    weedGeo.computeVertexNormals();
  }
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x2f3a1c, roughness: 0.4, side: THREE.DoubleSide });
  const woodGeo = new THREE.CylinderGeometry(0.11, 0.08, 2.2, 7, 3);
  {
    const pa = woodGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      pa.setX(i, pa.getX(i) + Math.sin(y * 2.1) * 0.06);
      pa.setZ(i, pa.getZ(i) * (0.85 + 0.15 * Math.cos(y * 3.3)));
    }
    woodGeo.rotateZ(Math.PI / 2);
    woodGeo.computeVertexNormals();
  }
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a8a74, roughness: 0.95 });
  const duneGeo = tuftGeometry(0.62, 0.02);
  const duneMat = grassMaterial();

  const col = new THREE.Color();
  for (let i = 0; i < 16000; i++) {
    // Most of it on the lower beach, where the sea leaves it.
    const [x, z] = onRing(12 + (1 - Math.pow(rand(), 1.8)) * 118);
    if (blocked(x, z)) continue;
    const y = ocean.groundAt(x, z);
    if (y < sea - 0.3) continue;
    const k = rand();
    if (k < 0.5) {
      col.setHSL(0.07 + rand() * 0.05, 0.25 + rand() * 0.3, 0.72 + rand() * 0.2);
      put('shell', shellGeo, shellMat, x, y + 0.008, z, rand() * 6.28, 0.6 + rand() * 0.9, col.clone());
    } else {
      const v = 0.3 + rand() * 0.4;
      col.setRGB(v, v * 0.96, v * 0.9);
      put('pebble', pebbleGeo, pebbleMat, x, y + 0.012, z, rand() * 6.28, 0.5 + rand() * 1.4, col.clone());
    }
  }
  // The strand line: weed and wrack exactly where the highest waves reach.
  for (let i = 0; i < 5600; i++) {
    const [x, z] = onRing(118 + rand() * 11);
    if (blocked(x, z)) continue;
    const y = ocean.groundAt(x, z);
    col.setHSL(0.18 + rand() * 0.08, 0.35, 0.12 + rand() * 0.1);
    put('weed', weedGeo, weedMat, x, y + 0.01, z, rand() * 6.28, 0.6 + rand() * 1.2, col.clone());
  }
  for (let i = 0; i < 90; i++) {
    const [x, z] = onRing(70 + rand() * 55);
    if (blocked(x, z)) continue;
    const y = ocean.groundAt(x, z);
    col.setHSL(0.08, 0.12, 0.45 + rand() * 0.2);
    put('wood', woodGeo, woodMat, x, y + 0.07, z, rand() * 6.28, 0.6 + rand() * 1.2, col.clone());
  }
  for (let i = 0; i < 4200; i++) {
    const [x, z] = onRing(2 + Math.pow(rand(), 1.6) * 40);
    if (blocked(x, z)) continue;
    const y = ocean.groundAt(x, z);
    col.setHSL(0.16 + rand() * 0.05, 0.35 + rand() * 0.2, 0.35 + rand() * 0.15);
    put('dune', duneGeo, duneMat, x, y, z, rand() * 6.28, 0.7 + rand() * 0.8, col.clone());
  }

  // Footprints: people have walked here. Trails wander from the promenade
  // down toward the water and along it — pairs of prints, left and right,
  // deeper and darker in the wet sand.
  const printTex = footprintTexture();
  const printGeo = new THREE.PlaneGeometry(0.12, 0.28);
  printGeo.rotateX(-Math.PI / 2);
  const printMat = new THREE.MeshStandardMaterial({
    map: printTex, transparent: true, depthWrite: false, roughness: 1,
    color: 0x6f5a40, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2
  });
  for (let t = 0; t < 70; t++) {
    let [x, z] = onRing(15 + rand() * 100);
    const r0 = Math.max(Math.abs(x), Math.abs(z));
    // Head roughly seaward, wandering.
    let heading = Math.abs(x) > Math.abs(z)
      ? (x > 0 ? 0 : Math.PI) : (z > 0 ? Math.PI / 2 : -Math.PI / 2);
    heading += (rand() - 0.5) * 1.6;
    void r0;
    let left = true;
    for (let k = 0; k < 60; k++) {
      heading += (rand() - 0.5) * 0.18;
      x += Math.cos(heading) * 0.36;
      z += Math.sin(heading) * 0.36;
      if (blocked(x, z)) break;
      const y = ocean.groundAt(x, z);
      if (y < sea - 0.15) break;              // the sea has taken the rest
      const side = left ? 1 : -1;
      left = !left;
      const px = x + Math.cos(heading + Math.PI / 2) * 0.1 * side;
      const pz = z + Math.sin(heading + Math.PI / 2) * 0.1 * side;
      const wetK = THREE.MathUtils.clamp((y - (sea - 0.1)) / 0.6, 0, 1);
      col.setRGB(0.75 + 0.25 * wetK, 0.75 + 0.25 * wetK, 0.75 + 0.25 * wetK);
      put('print', printGeo, printMat, px, y + 0.004, pz, -heading + Math.PI / 2, 1, col.clone());
    }
  }

  const meshes = [];
  for (const { kind, geo, mat, list } of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      if (kind === 'wood') e.set(0, it.rot, (rand() - 0.5) * 0.1);
      else if (kind === 'dune' || kind === 'print') e.set(0, it.rot, 0);
      else e.set((rand() - 0.5) * 0.5, it.rot, (rand() - 0.5) * 0.5);
      q.setFromEuler(e);
      const sy = kind === 'dune' ? it.scl * (0.8 + rand() * 0.6) : it.scl;
      m4.compose(p.set(it.x, it.y, it.z), q, s.set(it.scl, sy, it.scl));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, it.color);
    });
    im.computeBoundingSphere();
    im.castShadow = kind === 'wood';
    im.receiveShadow = true;
    w.group.add(im);
    const b = im.boundingSphere;
    meshes.push({ mesh: im, x: b.center.x, z: b.center.z, r: b.radius, near: kind === 'dune' ? 150 : 110 });
  }
  return {
    meshes,
    update(cam) {
      for (const m of meshes) {
        const d = Math.hypot(cam.x - m.x, cam.z - m.z) - m.r;
        m.mesh.visible = d < m.near && cam.y < 200;
      }
    }
  };
}
