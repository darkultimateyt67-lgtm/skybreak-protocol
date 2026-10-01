import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Photoreal — the rendering pipeline.
 *
 * What actually sells realism, in rough order of impact:
 *
 *  1. Ambient occlusion. Contact darkening where surfaces meet is the single
 *     biggest cue that geometry is physically present rather than pasted on.
 *  2. Correct exposure and a filmic curve. Real cameras roll off highlights
 *     instead of clipping them to white.
 *  3. Soft shadows that harden near the contact point.
 *  4. Real surface microdetail — normal maps derived from the existing bump
 *     maps so light scatters off the grain of a material.
 *  5. Lens behaviour: subtle vignette, a whisper of chromatic aberration at
 *     the edges, and film grain. Photographs are never perfectly clean.
 *
 * All of it is a quality tier so weaker machines can drop back.
 */

/** Final grade: exposure, vignette, chromatic aberration, grain, saturation. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0016 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.09 },
    uSharpen: { value: 0.55 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uLift: { value: new THREE.Vector3(0.004, 0.005, 0.009) },
    uGain: { value: new THREE.Vector3(1.03, 1.0, 0.97) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSaturation, uContrast, uSharpen;
    uniform vec2 uTexel;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 toCentre = uv - 0.5;
      float r2 = dot(toCentre, toCentre);

      // Chromatic aberration: colour channels focus at slightly different
      // radii, exactly like a real lens. Zero at centre, strongest at edges.
      float ab = uAberration * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + toCentre * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - toCentre * ab).b;

      // Unsharp mask: subtract a blurred neighbourhood to recover the
      // micro-contrast that tone mapping and AA soften away. This is what
      // makes edges and surface grain read crisp rather than muddy.
      vec3 blur =
        texture2D(tDiffuse, uv + vec2( uTexel.x, 0.0)).rgb +
        texture2D(tDiffuse, uv + vec2(-uTexel.x, 0.0)).rgb +
        texture2D(tDiffuse, uv + vec2(0.0,  uTexel.y)).rgb +
        texture2D(tDiffuse, uv + vec2(0.0, -uTexel.y)).rgb;
      blur *= 0.25;
      col += (col - blur) * uSharpen;

      // Lift/gain colour grade — cool the shadows, warm the highlights.
      col = col * uGain + uLift;

      // Filmic S-curve: deepens shadows and rolls highlights for real
      // photographic contrast instead of a flat linear ramp.
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), uContrast - 1.0 + 0.35);

      // Saturation around luminance.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // Natural lens vignette (cos^4 falloff, softened).
      float vig = 1.0 - uVignette * smoothstep(0.15, 0.85, r2 * 2.0);
      col *= vig;

      // Film grain, stronger in shadow where real sensors are noisiest.
      float g = hash(uv * 800.0 + uTime * 60.0) - 0.5;
      col += g * uGrain * (1.0 - luma * 0.7);

      gl_FragColor = vec4(col, 1.0);
    }`
};

/**
 * Ambient occlusion costs roughly 12 ms a frame — real money. It lives on
 * ULTRA only; HIGH still gets soft shadows, SMAA and the full filmic grade,
 * which carries most of the realism at a fraction of the cost.
 */
export const QUALITY = {
  // `aniso` is texture anisotropy. It is the cheapest sharpness available:
  // ground, roads and terrain are all viewed at grazing angles, and that is
  // exactly the case trilinear filtering smears into mush. Costs fill rate,
  // not geometry, so it scales with tier rather than with scene complexity.
  // `content` scales how much WORLD gets built — leaves, trees, undergrowth,
  // traffic, crowds. This matters more than any other setting on a weak
  // machine: shadow resolution and post-processing are a fixed cost, but
  // 200,000 leaves and 2,600 trees are a cost that scales with the GPU's
  // willingness to push geometry. Tiers that only dimmed the effects left the
  // heaviest part of the frame untouched, so LOW barely helped anyone.
  // Adaptive quality walks this ladder, so POTATO must be its first entry for
  // a struggling machine to be able to reach it.
  potato: { ao: false, smaa: false, grade: false, shadowMap: 0,    pixelCap: 0.75, bloom: 0,    reflect: 0,    aniso: 1,  content: 0.12, shadows: false },
  low:    { ao: false, smaa: false, grade: true,  shadowMap: 1024, pixelCap: 1.0,  bloom: 0.28, reflect: 256,  aniso: 1,  content: 0.30, shadows: true },
  medium: { ao: false, smaa: true,  grade: true,  shadowMap: 1536, pixelCap: 1.25, bloom: 0.32, reflect: 512,  aniso: 4,  content: 0.55, shadows: true },
  high:   { ao: true,  smaa: true,  grade: true,  shadowMap: 2560, pixelCap: 1.5,  bloom: 0.34, reflect: 512,  aniso: 8,  content: 0.80, shadows: true },
  ultra:  { ao: true,  smaa: true,  grade: true,  shadowMap: 4096, pixelCap: 2.0,  bloom: 0.36, reflect: 1024, aniso: 16, content: 1.00, shadows: true }
};

/** Cheapest to most expensive. Adaptive quality steps along this. */
const TIER_ORDER = ['potato', 'low', 'medium', 'high', 'ultra'];

export class Photoreal {
  constructor(game) {
    this.game = game;
    this.tier = 'high';
    this._t = 0;
  }

  /** Build the composer chain for the current quality tier. */
  build(tier = this.tier) {
    const g = this.game;
    const q = QUALITY[tier] || QUALITY.high;
    this.tier = tier;
    this.q = q;

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Physically sane camera response. Real scenes have huge dynamic range;
    // ACES rolls the highlights off instead of clipping them flat white.
    g.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    g.renderer.toneMappingExposure = 1.0;
    // Shadows off entirely on POTATO: a shadow pass re-renders every caster
    // in the scene, so it's a whole extra geometry pass to delete.
    g.renderer.shadowMap.enabled = q.shadows !== false;
    g.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    g.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelCap) * (g.settings.renderScale ?? 1));

    if (this.composer) this.composer.dispose?.();
    const composer = new EffectComposer(g.renderer);
    composer.addPass(new RenderPass(g.scene, g.camera));

    // --- Ambient occlusion ------------------------------------------------
    if (q.ao) {
      const ao = new SSAOPass(g.scene, g.camera, w, h);
      // Tuned for a world measured in metres: a ~1.2 m contact radius reads
      // as real corner shadowing without haloing distant geometry.
      ao.kernelRadius = 1.2;
      ao.minDistance = 0.0015;
      ao.maxDistance = 0.12;
      ao.output = SSAOPass.OUTPUT.Default;
      composer.addPass(ao);
      this.ao = ao;
    }

    // --- Bloom: restrained, only genuinely bright things glow -------------
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), q.bloom, 0.5, 0.92);
    composer.addPass(bloom);
    this.bloom = bloom;

    // --- Anti-aliasing ------------------------------------------------------
    if (q.smaa) {
      composer.addPass(new SMAAPass(w * g.renderer.getPixelRatio(), h * g.renderer.getPixelRatio()));
    }

    // --- Final grade ---------------------------------------------------------
    if (q.grade) {
      const grade = new ShaderPass(GradeShader);
      composer.addPass(grade);
      this.grade = grade;
    }

    composer.addPass(new OutputPass());
    this.composer = composer;
    g.composer = composer;
    g.bloom = bloom;

    this._applyShadowQuality(q.shadowMap);
    this.applyAnisotropy();
    this.setSize(w, h);
    return composer;
  }

  /** Higher-resolution, softer shadow maps on the world's sun. */
  /**
   * Push the tier's anisotropy onto every texture in the scene.
   *
   * Done as a sweep rather than at each texture's creation point because
   * textures are built by a dozen unrelated systems — world, city, weapons,
   * foliage — and any one of them forgetting would leave a visibly blurry
   * surface. A sweep can't be forgotten. Re-run whenever a world is built or
   * the quality tier changes, since both bring new textures with them.
   */
  applyAnisotropy() {
    const g = this.game;
    const want = Math.min(
      this.q ? this.q.aniso : 4,
      g.renderer.capabilities.getMaxAnisotropy()
    );
    const seen = new Set();
    const bump = (t) => {
      if (!t || !t.isTexture || seen.has(t)) return;
      seen.add(t);
      if (t.anisotropy !== want) {
        t.anisotropy = want;
        t.needsUpdate = true;
      }
    };
    g.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        bump(m.map); bump(m.normalMap); bump(m.roughnessMap);
        bump(m.metalnessMap); bump(m.bumpMap); bump(m.emissiveMap); bump(m.alphaMap);
      }
    });
    this.anisoApplied = { level: want, textures: seen.size };
    return this.anisoApplied;
  }

  _applyShadowQuality(size) {
    const sun = this.game.world && this.game.world.sun;
    if (!sun) return;
    // Remember the light's direction so the follow-camera can re-anchor it.
    this._sunOffset = sun.position.clone();
    this._shadowExtent = this.game.world.def && this.game.world.def.mode === 'br' ? 90 : 150;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.radius = 3.5;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }

  /** Called after a world rebuild so the new sun picks up the settings. */
  onWorldBuilt() {
    this._applyShadowQuality(this.q ? this.q.shadowMap : 3072);
    // A new world means a whole new set of textures, none of which have been
    // told what anisotropy this tier wants.
    this.applyAnisotropy();
  }

  setSize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
    if (this.ao) this.ao.setSize(w, h);
    // The sharpen kernel samples exact neighbouring pixels, so it has to
    // know the real buffer size or it blurs instead of sharpening.
    if (this.grade) {
      const r = this.game.renderer.getPixelRatio();
      this.grade.uniforms.uTexel.value.set(1 / (w * r), 1 / (h * r));
    }
  }

  update(dt) {
    this._t += dt;
    if (this.grade) this.grade.uniforms.uTime.value = this._t;
    this._followShadows();
    this._adapt(dt);
  }

  /**
   * Adaptive quality.
   *
   * Machines vary enormously and the heaviest map here (a 1200 m island with
   * a reflective ocean) can outrun a weak GPU. Rather than ship a guess,
   * watch the real frame time and step the tier down when it's persistently
   * bad — and back up if there's clearly headroom. Hysteresis and a cooldown
   * stop it oscillating between tiers mid-fight.
   */
  _adapt(dt) {
    if (this.game.settings.autoQuality === false) return;
    // Ignore hitches from loading, alt-tabbing or a debugger pause.
    if (dt > 0.2) return;

    this._samples = this._samples || [];
    this._samples.push(dt);
    if (this._samples.length < 90) return;

    const avg = this._samples.reduce((a, b) => a + b, 0) / this._samples.length;
    this._samples.length = 0;
    this._cooldown = Math.max(0, (this._cooldown || 0) - 1);
    if (this._cooldown > 0) return;

    const order = TIER_ORDER;
    const i = order.indexOf(this.tier);
    const fps = 1 / avg;

    if (fps < 40 && i > 0) {
      this._cooldown = 3;
      this._retune(order[i - 1], `performance (${Math.round(fps)} fps)`);
    } else if (fps > 115 && i < order.length - 1 && !this._steppedDown) {
      this._cooldown = 6;
      this._retune(order[i + 1], `headroom (${Math.round(fps)} fps)`);
    }
  }

  _retune(tier, why) {
    if (tier === this.tier) return;
    const order = TIER_ORDER;
    if (order.indexOf(tier) < order.indexOf(this.tier)) this._steppedDown = true;
    this.build(tier);
    this.onWorldBuilt();
    this.game.settings.quality = tier;
    this.game.saveSettings();
    this.game.hud.syncQualityChips?.(tier);
    this.game.hud.brToast?.('GRAPHICS ADJUSTED', `${tier.toUpperCase()} — ${why}`);
  }

  /**
   * Keep the shadow camera tight around the player.
   *
   * A single shadow map stretched over a 1200 m island is both expensive and
   * blurry — every texel covers metres of ground. Sliding a small box along
   * with the player gives crisp contact shadows where you can actually see
   * them, for the cost of a much smaller map. Movement is snapped to texel
   * increments so shadow edges don't shimmer as you walk.
   */
  _followShadows() {
    const g = this.game;
    const sun = g.world && g.world.sun;
    if (!sun || !sun.castShadow || !g.player) return;

    const cam = sun.shadow.camera;
    const extent = this._shadowExtent || 90;
    if (cam.right !== extent) {
      cam.left = -extent; cam.right = extent;
      cam.top = extent; cam.bottom = -extent;
      cam.near = 1; cam.far = 900;
      cam.updateProjectionMatrix();
    }

    // Snap to whole shadow texels to stop edge crawl.
    const texel = (extent * 2) / (this.q ? this.q.shadowMap : 2048);
    const px = Math.round(g.player.position.x / texel) * texel;
    const pz = Math.round(g.player.position.z / texel) * texel;

    // Keep the light's offset direction, just re-anchor it over the player.
    if (!this._sunOffset) this._sunOffset = sun.position.clone();
    sun.position.set(px + this._sunOffset.x, this._sunOffset.y, pz + this._sunOffset.z);
    sun.target.position.set(px, 0, pz);
    sun.target.updateMatrixWorld();
  }
}

/**
 * Derive a normal map from a greyscale bump canvas via Sobel. Real surfaces
 * scatter light off their microgeometry; a normal map is what makes a wall
 * read as concrete rather than a flat painted plane.
 */
export function normalFromBump(bumpTexture, strength = 2.4) {
  const img = bumpTexture.image;
  if (!img || !img.width) return null;
  const w = img.width;
  const h = img.height;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, w, h).data;

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const dst = octx.createImageData(w, h);

  const lum = (x, y) => {
    const xi = (x + w) % w;
    const yi = (y + h) % h;
    return data[(yi * w + xi) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel gradients.
      const gx =
        -lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1) +
        lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) +
        lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);

      let nx = -gx * strength;
      let ny = -gy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const i = (y * w + x) * 4;
      dst.data[i] = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
