import * as THREE from 'three';

/**
 * Wind — one moving air field that every tree, branch and leaf answers to.
 *
 * Leaves already fluttered, but the branches they hung from were rigid, so a
 * canopy shimmered over a frozen skeleton. Worse, the flutter was applied in
 * each sprig's own rotated frame, so every sprig "felt" the wind from a
 * different direction and the crown never moved as one thing.
 *
 * Here the motion is layered the way it is on a real tree:
 *
 *   1. THE TREE bends from its root. Displacement grows with the square of
 *      height up the trunk — the base never moves, the crown moves most — and
 *      each tree rocks at a natural frequency set by its size, so a tall pine
 *      sways slowly and a sapling quickly.
 *   2. GUST FRONTS roll across the map along the wind direction. You can see a
 *      gust arrive at one side of a park and travel through it.
 *   3. BRANCHES move on top of the bend: the further a point sits from the
 *      trunk axis, the more it swings and bobs on its own.
 *   4. LEAVES ride all of that (they are displaced by the same field at their
 *      own position, so they stay on their twigs) and flutter on top.
 *
 * And the world can push on it:
 *
 *   - hit(): a car into a trunk, a blast nearby — a damped shake that rings
 *     out over a few seconds, strongest at the trees closest to it;
 *   - wash(): a helicopter's rotor downwash, flattening and thrashing the
 *     crowns underneath it while it hovers low.
 *
 * All of it runs in the vertex shader. There are 870,000 branch vertices and
 * tens of thousands of leaf sprigs in the city; nothing here costs the CPU
 * more than setting a handful of uniforms a frame.
 */

const HITS = 8;

export const WIND = {
  uniforms: {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(0.62, 0, 0.40) },
    uHits: { value: Array.from({ length: HITS }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uWash: { value: new THREE.Vector4(0, 0, 1, 0) }
  },
  _next: 0,

  /** Advance the clock. Called once a frame by the World. */
  update(t) {
    this.uniforms.uTime.value = t;
    // Downwash is re-asserted every frame by whatever is making it; if nothing
    // does, it dies away rather than hanging over the trees forever.
    const w = this.uniforms.uWash.value;
    w.w *= 0.9;
  },

  /** A shake radiating out from (x, z). `strength` ~1 for a knock, ~4 for a blast. */
  hit(x, z, strength = 1) {
    if (!(strength > 0.05)) return;
    const slot = this.uniforms.uHits.value[this._next];
    this._next = (this._next + 1) % HITS;
    slot.set(x, z, this.uniforms.uTime.value, Math.min(5, strength));
  },

  /** Rotor downwash centred on (x, z). Call every frame it applies. */
  wash(x, z, radius, strength) {
    const w = this.uniforms.uWash.value;
    if (strength >= w.w) w.set(x, z, radius, strength);
  },

  /** Hook the tree-bend into a material whose vertices carry `aRoot`. */
  patchBranches(material) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SWAY_GLSL + '\nattribute vec4 aRoot;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // The branch mesh is built in world space, so its local position is
          // already where the wind acts.
          transformed += treeSway(transformed, aRoot);`);
    };
    material.customProgramCacheKey = () => 'tree-sway';
    return material;
  },

  /**
   * Hook the same bend into an instanced leaf material. The offset has to be
   * applied AFTER the instance transform, in world space: added before it, as
   * the old flutter was, it gets spun by each sprig's own random rotation.
   */
  patchLeaves(material, localFlutter) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SWAY_GLSL
          + '\nattribute vec4 aRoot;\nattribute float aPhase;\nattribute float aStiff;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + localFlutter)
        .replace('#include <project_vertex>', `
          vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition.xyz += treeSway(mvPosition.xyz, aRoot);
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;
        `);
    };
    material.customProgramCacheKey = () => 'leaf-sway';
    return material;
  }
};

/**
 * The field itself. `root` is (x, y, z) of the tree's base and w its height.
 */
const SWAY_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
uniform vec4 uHits[${HITS}];
uniform vec4 uWash;

vec3 treeSway(vec3 wp, vec4 root) {
  float H = max(root.w, 1.0);
  float h = clamp((wp.y - root.y) / H, 0.0, 1.35);
  // Anchored at the root, freest at the crown.
  float bend = h * h;
  float speed = length(uWind.xz);
  vec2 dir = uWind.xz / max(speed, 1e-4);
  vec2 side = vec2(-dir.y, dir.x);
  float along = dot(root.xz, dir);

  // Gust fronts travelling downwind across the map, with a slower swell in
  // their strength so the air has calm spells and busy ones.
  float swell = 0.62 + 0.38 * sin(uTime * 0.11 + along * 0.003);
  float gust = (0.45 + 0.55 * max(0.0, sin(uTime * 0.62 - along * 0.021))) * swell;

  // The tree rocks at its own natural frequency: taller is slower.
  float f = 2.2 / sqrt(H);
  float ph = root.x * 0.37 + root.z * 0.29;
  float rock = sin(uTime * f + ph);
  float lean = speed * H * 0.042;
  vec3 off = vec3(dir.x, 0.0, dir.y) * bend * lean * (gust * 0.8 + 0.35 * rock * gust);
  off.xz += side * bend * lean * 0.22 * sin(uTime * f * 1.37 + ph * 1.7);

  // Branches swing on top of the bend, more the further out along a limb.
  float rr = length(wp.xz - root.xz);
  float limb = smoothstep(0.35, 3.8, rr) * smoothstep(0.15, 0.6, h);
  float b1 = sin(uTime * 2.1 + wp.x * 0.61 + wp.z * 0.83 + ph);
  float b2 = sin(uTime * 3.3 + wp.x * 1.3 - wp.z * 0.9);
  off.y += limb * (0.11 * b1 + 0.04 * b2) * (0.35 + gust);
  off.xz += limb * (0.095 * dir * b2 + 0.08 * side * b1) * (0.35 + gust);

  // Knocks and blasts: a damped oscillation away from the source.
  for (int i = 0; i < ${HITS}; i++) {
    vec4 hi = uHits[i];
    float age = uTime - hi.z;
    if (hi.w <= 0.0 || age < 0.0 || age > 4.5) continue;
    vec2 d2 = root.xz - hi.xy;
    float d = length(d2);
    float reach = 5.0 + hi.w * 5.0;
    float fall = hi.w * exp(-age * 1.35) * (1.0 - smoothstep(0.0, reach, d));
    vec2 away = d > 1e-3 ? d2 / d : dir;
    off.xz += away * (bend + limb * 0.6) * fall * sin(age * 8.5) * H * 0.022;
    off.y += limb * fall * 0.08 * sin(age * 13.0 + wp.x);
  }

  // Rotor downwash: out and down, thrashing, under a low hovering helicopter.
  vec2 dw2 = root.xz - uWash.xy;
  float dw = length(dw2);
  float wash = uWash.w * (1.0 - smoothstep(uWash.z * 0.35, uWash.z, dw));
  vec2 outw = dw > 1e-3 ? dw2 / dw : dir;
  off.xz += outw * (bend + limb) * wash * (0.65 + 0.35 * sin(uTime * 11.0 + wp.x * 0.7)) * H * 0.035;
  off.y -= (bend + limb) * wash * 0.22;

  // A bent crown drops a little rather than stretching.
  off.y -= bend * 0.12 * length(off.xz);
  return off;
}
`;
