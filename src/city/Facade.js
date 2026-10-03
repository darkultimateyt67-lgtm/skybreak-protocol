import * as THREE from 'three';

/**
 * Facades — what turns a box into a building.
 *
 * Every building in the city is still, underneath, an extruded box. What was
 * wrong was the skin: a 512-pixel canvas of an eight-by-eight window grid,
 * stretched over every block in six colours. Painted windows have no depth,
 * no room behind them, no frame, and every one of them is the same window.
 * From the street a city of those reads as boxes with a pattern on, which is
 * exactly what it was.
 *
 * This replaces the texture with a SHADER that works out the facade from the
 * wall's real position in the world:
 *
 *   WINDOWS are laid out on a grid of bays and storeys measured in metres, so
 *   a window is the same real size on a shop and on a tower. Each one has a
 *   frame, a mullion or transom where a real one would, a stone sill and
 *   lintel on masonry, and a reveal that throws a shadow line.
 *
 *   BEHIND EVERY WINDOW IS A ROOM. The view ray is traced into a box behind
 *   the glass — side walls, floor, ceiling and back wall — so as you walk past
 *   a building its rooms shift in parallax like real ones. Rooms differ: wall
 *   colour, carpet or boards, lights on or off, blinds part-drawn, a desk or a
 *   sofa against the back wall. ("Interior mapping": the technique big city
 *   games use to give ten thousand windows depth without a polygon each.)
 *
 *   GLASS reflects the sky on top of that, tinted, and curtain-wall towers are
 *   near-mirrors.
 *
 *   WALLS are materials, not colours: running-bond brick with mortar joints
 *   and per-brick variation, precast concrete panels with joints, render,
 *   corrugated cladding, curtain-wall mullions and spandrels. Weathered: rain
 *   streaks run down from the sills, grime rises at street level.
 *
 *   GROUND FLOORS are taller and glazed floor to ceiling — lobbies and
 *   shopfronts, lit.
 *
 *   DISTANCE is handled: when a window shrinks below a couple of pixels the
 *   pattern fades to its average, so a far tower does not shimmer with moiré.
 *
 * Per-building variety (storey height, bay width, ground-floor height and a
 * seed for which rooms are which) rides on a vertex attribute, so a thousand
 * buildings still merge into a handful of draw calls.
 */

export const STYLES = {
  // Curtain-wall towers: nearly all glass, reflective.
  glass: { wall: 0x2b3642, wall2: 0x1b222b, frame: 0x1c2229, glass: 0x7a96ab, bay: 1.55, floor: 3.9,
    win: [0.035, 0.965, 0.13, 0.985], pattern: 0, tint: 0.62 },
  glassGreen: { wall: 0x2a3a3a, wall2: 0x1a2424, frame: 0x1b2424, glass: 0x7aa39a, bay: 1.7, floor: 4.0,
    win: [0.035, 0.965, 0.14, 0.985], pattern: 0, tint: 0.58 },
  // Office slab: ribbon windows between precast spandrels.
  office: { wall: 0xbcb6aa, wall2: 0x9c978d, frame: 0x2a2e34, glass: 0x5a6c78, bay: 1.8, floor: 3.9,
    win: [0.0, 1.0, 0.34, 0.9], pattern: 1, tint: 0.42 },
  // Masonry walk-ups: punched windows in brick, stone sills and lintels.
  brick: { wall: 0x6e3526, wall2: 0xd8d0c0, frame: 0xe9e4d8, glass: 0x3e4a54, bay: 3.0, floor: 3.3,
    win: [0.27, 0.73, 0.22, 0.8], pattern: 2, tint: 0.28 },
  brickBrown: { wall: 0x5a4032, wall2: 0xcfc6b4, frame: 0x2d2a27, glass: 0x3a4650, bay: 2.8, floor: 3.2,
    win: [0.26, 0.74, 0.22, 0.8], pattern: 2, tint: 0.28 },
  // Residential slab block: concrete panels, medium windows.
  concrete: { wall: 0xc8c1b2, wall2: 0xa9a293, frame: 0x3b3f44, glass: 0x46545d, bay: 3.2, floor: 3.0,
    win: [0.2, 0.8, 0.26, 0.82], pattern: 3, tint: 0.32 },
  // Low-rise render: pastel walls, small windows with shutters.
  stucco: { wall: 0xe2d4b6, wall2: 0x3f5e58, frame: 0xf2efe6, glass: 0x3e4a54, bay: 3.4, floor: 3.0,
    win: [0.31, 0.69, 0.3, 0.78], pattern: 4, tint: 0.28 },
  stuccoRose: { wall: 0xd9b9a8, wall2: 0x5a4a6a, frame: 0xf2efe6, glass: 0x3e4a54, bay: 3.2, floor: 3.0,
    win: [0.3, 0.7, 0.3, 0.78], pattern: 4, tint: 0.28 },
  // Industrial: corrugated cladding, a strip of high windows.
  metal: { wall: 0x8e959b, wall2: 0x6a7076, frame: 0x30353a, glass: 0x4a5a64, bay: 5.0, floor: 6.0,
    win: [0.1, 0.9, 0.72, 0.9], pattern: 5, tint: 0.35 }
};

/** Which styles suit which kind of building. */
export const STYLE_FOR = {
  tower: ['glass', 'glassGreen', 'glass', 'office'],
  block: ['brick', 'brickBrown', 'concrete', 'office', 'brick'],
  shore: ['stucco', 'stuccoRose', 'concrete'],
  house: ['stucco', 'stuccoRose', 'brick', 'brickBrown'],
  warehouse: ['metal', 'brickBrown'],
  hangar: ['metal'],
  shop: ['brick', 'stucco']
};

const FACADE_GLSL = /* glsl */`
uniform vec3 uWall;
uniform vec3 uWall2;
uniform vec3 uFrame;
uniform vec3 uGlass;
uniform vec4 uWin;
uniform vec2 uGrid;
uniform float uPattern;
uniform float uTint;
varying vec3 vFW;
varying vec3 vFN;
varying vec4 vBld;

float fh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fh2(vec2 p) { return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453); }
float fnz(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh1(i), fh1(i + vec2(1.0, 0.0)), w.x), mix(fh1(i + vec2(0.0, 1.0)), fh1(i + vec2(1.0, 1.0)), w.x), w.y);
}
// Band test with a one-pixel soft edge, so lines do not alias.
float band(float x, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x));
}

vec3 fAlb; float fRough; float fMetal; vec3 fEmit; vec3 fBend;

vec3 roomPalette(float h) {
  if (h < 0.25) return vec3(0.86, 0.83, 0.76);
  if (h < 0.45) return vec3(0.78, 0.80, 0.82);
  if (h < 0.62) return vec3(0.84, 0.76, 0.64);
  if (h < 0.78) return vec3(0.66, 0.72, 0.70);
  if (h < 0.9) return vec3(0.9, 0.9, 0.88);
  return vec3(0.72, 0.62, 0.58);
}

void facadeSurface() {
  vec3 N = normalize(vFN);
  fBend = vec3(0.0);
  fEmit = vec3(0.0);
  float seed = vBld.x;

  // --- Roofs and undersides ------------------------------------------------
  if (N.y > 0.6) {
    vec2 r = vFW.xz;
    float g = fnz(r * 1.7) * 0.5 + fnz(r * 6.3) * 0.3 + fh1(floor(r * 40.0)) * 0.2;
    fAlb = mix(vec3(0.34, 0.33, 0.32), vec3(0.46, 0.45, 0.43), g);
    // Membrane seams.
    float seam = max(band(fract(r.x / 1.9), 0.0, 0.015, 0.01), band(fract(r.y / 12.0), 0.0, 0.004, 0.002));
    fAlb *= 1.0 - 0.25 * seam;
    fRough = 0.95; fMetal = 0.0;
    return;
  }
  if (N.y < -0.6) { fAlb = uWall * 0.45; fRough = 0.9; fMetal = 0.0; return; }

  // --- Facade frame --------------------------------------------------------
  vec3 T = abs(N.x) > abs(N.z) ? vec3(0.0, 0.0, -sign(N.x)) : vec3(sign(N.z), 0.0, 0.0);
  float u = dot(vFW, T);
  float v = vFW.y;
  vec2 grid = uGrid * vec2(vBld.z, vBld.y);
  float gH = vBld.w;
  bool ground = gH > 0.5 && v < gH;
  vec2 cell = ground ? vec2(grid.x * 2.0, gH) : grid;
  vec2 q = ground ? vec2(u, v) : vec2(u, v - gH);
  vec2 cid = floor(q / cell) + vec2(floor(seed * 97.0), ground ? -7.0 : 0.0);
  vec2 f = fract(q / cell);
  vec4 win = ground ? vec4(0.03, 0.97, 0.03, 0.9) : uWin;
  // Industrial ground floors are roller doors, not glass.
  if (ground && uPattern > 4.5) win = vec4(0.12, 0.88, 0.0, 0.78);

  // Derivatives of the CONTINUOUS coordinate: fract() jumps at every cell
  // edge, and its derivative there would draw a seam down every column.
  vec2 aa = fwidth(q / cell) * 1.2;
  // How many pixels a window cell covers: below ~3 the detail fades out.
  float lod = clamp(max(fwidth(q.x / cell.x), fwidth(q.y / cell.y)) * 3.0 - 0.35, 0.0, 1.0);

  // Window aperture, and inside it the glass (frame width 6 cm).
  vec2 fr = vec2(0.06) / cell;
  float inWin = band(f.x, win.x, win.y, aa.x) * band(f.y, win.z, win.w, aa.y);
  float inGlass = band(f.x, win.x + fr.x, win.y - fr.x, aa.x) * band(f.y, win.z + fr.y, win.w - fr.y, aa.y);
  // Mullion and transom, where a real window of this size would have them.
  float wwM = (win.y - win.x) * cell.x;
  float whM = (win.w - win.z) * cell.y;
  float mull = 0.0;
  if (wwM > 1.5 && uPattern > 0.5) mull = band(f.x, 0.5 - fr.x * 0.5, 0.5 + fr.x * 0.5, aa.x);
  if (whM > 2.2 && !ground) mull = max(mull, band(f.y, win.z + (win.w - win.z) * 0.74, win.z + (win.w - win.z) * 0.74 + fr.y, aa.y));
  if (ground) mull = max(mull, band(fract(f.x * 3.0), 0.0, fr.x * 3.0, aa.x * 3.0));
  inGlass *= 1.0 - mull;

  // --- The wall itself ------------------------------------------------------
  vec3 wall = uWall;
  float wRough = 0.9;
  vec2 bq = vec2(u, v);
  if (uPattern < 0.5) {
    // Curtain wall: dark spandrel panel across the floor slab, metal frame.
    wall = mix(uWall, uWall2, band(f.y, 0.0, win.z, aa.y));
    wRough = 0.35;
  } else if (uPattern < 1.5) {
    // Precast spandrel bands with a faint panel joint every bay.
    wall = uWall * (0.92 + 0.12 * fnz(bq * vec2(0.4, 2.0)));
    wall *= 1.0 - 0.3 * band(f.x, 0.0, 0.012, aa.x);
    wall = mix(wall, uWall2, band(f.y, win.w, win.w + 0.03, aa.y));
  } else if (uPattern < 2.5) {
    // Running-bond brick. Mortar recessed, bricks individually coloured.
    vec2 b = bq / vec2(0.225, 0.075);
    float row = floor(b.y);
    b.x += mod(row, 2.0) * 0.5;
    vec2 bf = fract(b);
    vec2 bid = floor(b);
    vec2 baa = fwidth(b) * 1.5;
    float mortar = 1.0 - band(bf.x, 0.05, 0.97, baa.x) * band(bf.y, 0.1, 0.93, baa.y);
    // The bond stays legible until a course is barely a pixel, and even past
    // that the wall keeps a patchy brick tone instead of going flat.
    float bl = clamp(max(baa.x, baa.y) - 0.55, 0.0, 1.0);
    vec3 brick = uWall * (0.74 + 0.42 * fh1(bid)) * vec3(1.0, 0.95 + 0.08 * fh2(bid), 0.92 + 0.1 * fh2(bid + 3.0));
    brick *= 0.88 + 0.24 * fnz(bq * 0.45 + seed * 7.0);
    vec3 mortarC = vec3(0.62, 0.6, 0.56);
    wall = mix(mix(brick, mortarC, mortar), mix(uWall * (0.9 + 0.2 * fnz(bq * 0.45 + seed * 7.0)), mortarC, 0.22), bl);
    // Stone sill and lintel, and a stone band at each floor line.
    float sill = band(f.y, win.z - 0.07 / cell.y, win.z, aa.y) * band(f.x, win.x - 0.05, win.y + 0.05, aa.x);
    float lintel = band(f.y, win.w, win.w + 0.09 / cell.y, aa.y) * band(f.x, win.x - 0.03, win.y + 0.03, aa.x);
    wall = mix(wall, uWall2, max(sill, lintel));
    fBend.y += sill * 0.45;
    wRough = 0.92;
  } else if (uPattern < 3.5) {
    // Precast panels: a joint at every floor and every other bay.
    vec2 pid = floor(q / (cell * vec2(2.0, 1.0)));
    wall = uWall * (0.9 + 0.12 * fh1(pid + seed));
    float joint = max(band(fract(q.x / (cell.x * 2.0)), 0.0, 0.02 / (cell.x * 2.0), aa.x),
                      band(f.y, 0.0, 0.02 / cell.y, aa.y));
    wall *= 1.0 - 0.35 * joint;
    float sill = band(f.y, win.z - 0.05 / cell.y, win.z, aa.y) * band(f.x, win.x - 0.03, win.y + 0.03, aa.x);
    wall = mix(wall, uWall2, sill);
    fBend.y += sill * 0.35;
  } else if (uPattern < 4.5) {
    // Render, a little uneven, with painted shutters beside the windows.
    wall = uWall * (0.93 + 0.1 * fnz(bq * 0.8) + 0.04 * fnz(bq * 7.0));
    float sh = band(f.y, win.z, win.w, aa.y) * (band(f.x, win.x - 0.16, win.x - 0.015, aa.x) + band(f.x, win.y + 0.015, win.y + 0.16, aa.x));
    float slat = 0.85 + 0.15 * step(0.5, fract(q.y * 12.0));
    if (!ground) wall = mix(wall, uWall2 * slat, sh);
    float sill = band(f.y, win.z - 0.06 / cell.y, win.z, aa.y) * band(f.x, win.x - 0.04, win.y + 0.04, aa.x);
    wall = mix(wall, vec3(0.9, 0.88, 0.84), sill);
    fBend.y += sill * 0.4;
    wRough = 0.95;
  } else {
    // Corrugated cladding: the ridges are the light and shade.
    float c = sin(u * 6.2831 / 0.2);
    wall = uWall * (0.86 + 0.14 * c) * (0.9 + 0.12 * fnz(bq * vec2(0.2, 1.3)));
    fBend += T * c * 0.35;
    wRough = 0.55;
  }

  // Weathering: rain streaks below each sill, grime at street level, and a
  // slow drift of dirt across the whole face.
  float below = band(f.y, 0.0, win.z, aa.y) * band(f.x, win.x + 0.05, win.y - 0.05, aa.x);
  float streak = fnz(vec2(u * 9.0, cid.y * 3.1)) * (1.0 - smoothstep(0.0, win.z, win.z - f.y));
  wall *= 1.0 - 0.18 * below * streak * (1.0 - lod);
  wall *= mix(0.72, 1.0, smoothstep(0.0, 1.6, v));
  wall *= 0.9 + 0.14 * fnz(vec2(u, v) * 0.07 + seed * 13.0);

  // --- Behind the glass: a room --------------------------------------------
  vec3 V = normalize(vFW - cameraPosition);
  float vx = dot(V, T);
  float vy = V.y;
  float vz = max(dot(V, -N), 0.05);
  vec2 lp = vec2(f.x * cell.x, (ground ? f.y : f.y) * cell.y);
  float W = cell.x, H = cell.y, D = ground ? 7.0 : 4.2;
  float tx = vx > 0.0 ? (W - lp.x) / vx : -lp.x / min(vx, -1e-4);
  float ty = vy > 0.0 ? (H - lp.y) / vy : -lp.y / min(vy, -1e-4);
  float tz = D / vz;
  float t = min(min(tx, ty), tz);
  vec3 hit = vec3(lp + vec2(vx, vy) * t, vz * t);
  float rh = fh1(cid);
  float lit = step(ground ? 0.25 : 0.58, fh2(cid + 1.7));
  vec3 wallC = roomPalette(rh);
  vec3 room;
  if (t == tz) {
    room = wallC;
    // Something against the back wall: a desk, a cabinet or a sofa.
    float kind = fh1(cid + 9.3);
    float fx = hit.x / W;
    if (hit.y < (kind < 0.5 ? 0.78 : 0.95) && fx > 0.18 && fx < (kind < 0.5 ? 0.7 : 0.86)) room = kind < 0.33 ? vec3(0.32, 0.22, 0.15) : (kind < 0.66 ? vec3(0.24, 0.26, 0.3) : vec3(0.5, 0.3, 0.22));
    // A picture or a doorway.
    if (hit.y > 1.3 && hit.y < 2.0 && fx > 0.3 && fx < 0.55 && kind > 0.4) room = vec3(0.2, 0.3, 0.38) * (0.8 + fh2(cid));
  } else if (t == ty) {
    room = vy > 0.0 ? vec3(0.9, 0.9, 0.88) : (fh2(cid + 4.0) > 0.5 ? vec3(0.42, 0.29, 0.2) : vec3(0.36, 0.38, 0.4));
    // A ceiling light in the lit rooms.
    if (vy > 0.0 && lit > 0.5) {
      vec2 cp = vec2(hit.x / W, hit.z / D) - vec2(0.5, 0.45);
      if (abs(cp.x) < 0.16 && abs(cp.y) < 0.08) room = vec3(3.0, 2.8, 2.4);
    }
  } else {
    room = wallC * 0.82;
  }
  // Light falls off into the room; lit rooms are warm, unlit ones dim.
  room *= mix(1.0, 0.5, clamp(t / (D * 1.6), 0.0, 1.0));
  room *= lit > 0.5 ? vec3(1.0, 0.93, 0.8) * 0.85 : vec3(0.28);
  if (ground) room *= lit > 0.5 ? 1.25 : 0.8;
  // Blinds part-drawn from the top.
  float gy = (f.y - win.z) / max(win.w - win.z, 1e-3);
  float blind = step(0.5, fh2(cid + 5.5)) * fh1(cid + 7.7) * 0.85;
  if (!ground && gy > 1.0 - blind) room = mix(vec3(0.78, 0.74, 0.66), vec3(0.62, 0.58, 0.52), step(0.5, fract(gy * 30.0))) * (lit > 0.5 ? 0.9 : 0.45);
  // Reveal shadow round the inside edge of the opening.
  float edge = min(min(f.x - win.x, win.y - f.x) * cell.x, min(f.y - win.z, win.w - f.y) * cell.y);
  room *= mix(0.55, 1.0, smoothstep(0.0, 0.18, edge));

  // --- Compose -------------------------------------------------------------
  // What is seen through the glass is light from INSIDE — it goes in as
  // emission, untouched by the sun on the facade. The glass itself is a
  // tinted reflector that picks up the sky over the top of it.
  vec3 frameC = uFrame;
  float isFrame = inWin * (1.0 - inGlass);
  vec3 glassTint = uGlass;
  fAlb = mix(wall, frameC, isFrame);
  fAlb = mix(fAlb, glassTint * uTint, inGlass);
  fRough = mix(wRough, 0.5, isFrame);
  fRough = mix(fRough, 0.05, inGlass);
  fMetal = mix(0.0, 0.3, isFrame);
  fMetal = mix(fMetal, 0.85, inGlass);
  fEmit = room * inGlass * (1.0 - uTint * 0.75) * 0.55;
  // Frames and sills stand proud of the wall: a little lift on their normals.
  fBend.y += isFrame * 0.15;

  // Far away the whole pattern resolves to its average — no moiré.
  float area = (win.y - win.x) * (win.w - win.z);
  vec3 avgA = mix(wall, glassTint * uTint, area * 0.85);
  fAlb = mix(fAlb, avgA, lod);
  fRough = mix(fRough, mix(wRough, 0.2, area), lod);
  fMetal = mix(fMetal, 0.6 * area, lod);
  fEmit = mix(fEmit, vec3(0.05, 0.048, 0.042) * area * (ground ? 2.0 : 1.0), lod);
  fBend *= 1.0 - lod;
}
`;

const _mats = new Map();

/** The shared material for a style, built once. */
export function facadeMaterial(styleId) {
  if (_mats.has(styleId)) return _mats.get(styleId);
  const st = STYLES[styleId] || STYLES.concrete;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, envMapIntensity: 1.25 });
  const uniforms = {
    uWall: { value: new THREE.Color(st.wall) },
    uWall2: { value: new THREE.Color(st.wall2) },
    uFrame: { value: new THREE.Color(st.frame) },
    uGlass: { value: new THREE.Color(st.glass) },
    uWin: { value: new THREE.Vector4(...st.win) },
    uGrid: { value: new THREE.Vector2(st.bay, st.floor) },
    uPattern: { value: st.pattern },
    uTint: { value: st.tint }
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBld;\nvarying vec3 vFW;\nvarying vec3 vFN;\nvarying vec4 vBld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vFN = normalize(mat3(modelMatrix) * objectNormal);
        vBld = aBld;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfacadeSurface();\ndiffuseColor.rgb = fAlb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(fBend, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmit;');
  };
  // One program for every style: the GLSL is identical and the style lives
  // entirely in uniforms, which three.js keeps per material. A key per style
  // compiled nine copies of the same shader at load.
  mat.customProgramCacheKey = () => 'facade';
  mat.userData.facade = styleId;
  _mats.set(styleId, mat);
  return mat;
}

/** Every facade material created so far. */
export function facadeMaterials() {
  return [..._mats.values()];
}

/**
 * Stamp per-building data onto a facade mesh's geometry: seed, storey-height
 * scale, bay-width scale, ground-floor height. Must be done to EVERY mesh
 * using a facade material before the static merge, which needs identical
 * attribute sets across a batch.
 */
export function tagFacade(mesh, bld) {
  // A baked box record (World._block during a city build): the merge writes
  // the attribute itself.
  if (mesh.isStaticBox) { mesh.bld = bld; return; }
  let g = mesh.geometry;
  if (!g.userData.ownedByFacade) {
    g = g.clone();
    g.userData.ownedByFacade = true;
    mesh.geometry = g;
  }
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) arr.set(bld, i * 4);
  g.setAttribute('aBld', new THREE.BufferAttribute(arr, 4));
}

/**
 * Roof tiles in world space: courses running level, each tile its own shade,
 * a shadow line under every course where it laps the one below, and a little
 * moss and dirt. Terracotta or slate, depending on the colour.
 */
export function roofTileMaterial(color) {
  const key = 'roof-' + color;
  if (_mats.has(key)) return _mats.get(key);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  const uTile = { value: new THREE.Color(color) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = uTile;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW;\nvarying vec3 vRN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uTile;
        varying vec3 vRW;
        varying vec3 vRN;
        float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
          return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), w.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), w.x), w.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 N = normalize(vRN);
          float along = abs(N.x) > abs(N.z) ? vRW.z : vRW.x;
          float row = vRW.y / 0.15;
          float ri = floor(row);
          float col = along / 0.29 + mod(ri, 2.0) * 0.5;
          vec2 id = vec2(floor(col), ri);
          float lap = fract(row);
          float aa = fwidth(row) * 1.5;
          float far = clamp(aa * 2.0 - 0.4, 0.0, 1.0);
          vec3 c = uTile * (0.78 + 0.34 * rh(id));
          c *= mix(0.62, 1.0, smoothstep(0.0, 0.28 + aa, lap));
          c *= 1.0 - 0.3 * smoothstep(0.9 - aa, 1.0, fract(col)) * (1.0 - far);
          c = mix(c, uTile * 0.9, far);
          float moss = smoothstep(0.62, 0.85, rn(vRW.xz * 0.6 + vRW.y));
          c = mix(c, vec3(0.24, 0.3, 0.16), moss * 0.35);
          if (N.y < 0.0) c = uTile * 0.3;
          diffuseColor.rgb = c;
        }`);
  };
  mat.customProgramCacheKey = () => 'roof';   // same shader for every colour
  _mats.set(key, mat);
  return mat;
}
