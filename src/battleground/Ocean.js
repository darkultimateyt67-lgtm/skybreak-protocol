import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

/**
 * Ocean — genuinely reflective water.
 *
 * The surface uses real planar reflection: a mirrored camera renders the
 * world into a texture every frame, and the water shader samples it with a
 * scrolling normal map so the reflection ripples with the waves. That is
 * what makes it read as water rather than a blue plane — you can see the
 * island, the trees and the sky bending on the surface.
 *
 * On top of that:
 *  · Two normal-map layers scrolling at different speeds and scales, so the
 *    wave pattern never visibly repeats.
 *  · A Fresnel term: near-transparent looking straight down, mirror-like at
 *    grazing angles. This is the single biggest cue for realistic water.
 *  · Sun glitter — a specular highlight that scatters across the chop.
 *  · A shoreline foam band that follows the island's actual coastline,
 *    pulsing in and out like surf.
 *  · Depth tinting: shallows go turquoise, deep water goes near-black blue.
 */

export class Ocean {
  constructor(world, island, opts = {}) {
    this.world = world;
    this.game = world.game;
    this.island = island;
    this.level = opts.level ?? 0;
    this.size = opts.size ?? 3000;
    this.opts = opts;
    this._t = 0;
  }

  /**
   * A tiling ripple normal map. Sum of several sine ridges at different
   * angles and frequencies gives a believable chop without a source texture.
   */
  _waveNormals(size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);

    // Height field first.
    const height = new Float32Array(size * size);
    const waves = [
      { a: 1.00, fx: 2, fy: 1, ph: 0.0 },
      { a: 0.55, fx: -1, fy: 3, ph: 1.7 },
      { a: 0.38, fx: 4, fy: -2, ph: 3.1 },
      { a: 0.22, fx: -3, fy: -5, ph: 0.6 },
      { a: 0.14, fx: 7, fy: 3, ph: 2.2 },
      { a: 0.09, fx: -6, fy: 8, ph: 4.4 }
    ];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2;
        const v = (y / size) * Math.PI * 2;
        let h = 0;
        for (const w of waves) h += w.a * Math.sin(u * w.fx + v * w.fy + w.ph);
        height[y * size + x] = h;
      }
    }

    // Sobel to normals.
    const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    const strength = 1.7;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = at(x + 1, y) - at(x - 1, y);
        const gy = at(x, y + 1) - at(x, y - 1);
        let nx = -gx * strength;
        let ny = -gy * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        const i = (y * size + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  build(sunDirection) {
    const opts = this.opts;
    const normals = this._waveNormals(512);
    this.normals = normals;

    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    // Planar reflection re-renders the whole scene, so its resolution is the
    // single most expensive knob here. 512 still reads as a true mirror once
    // the wave normals distort it — the ripples hide the resolution.
    const rt = opts.reflectionRes ?? 512;
    const water = new Water(geo, {
      textureWidth: rt,
      textureHeight: rt,
      waterNormals: normals,
      sunDirection: (sunDirection || new THREE.Vector3(0.4, 0.85, 0.3)).clone().normalize(),
      sunColor: 0xfff2d8,
      waterColor: 0x0b3d52,
      distortionScale: 4.2,
      fog: !!this.game.scene.fog,
      alpha: 0.94
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = this.level;
    water.receiveShadow = false;
    this.world.group.add(water);
    this.water = water;

    this._enhance(water);
    this._buildFoam();
    return water;
  }

  /**
   * Layer extra realism onto the stock water shader: a second normal octave,
   * a stronger Fresnel curve, depth tinting and sun glitter.
   */
  _enhance(water) {
    const mat = water.material;
    mat.transparent = true;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDeepColor = { value: new THREE.Color(0x04202e) };
      shader.uniforms.uShallowColor = { value: new THREE.Color(0x2fa5a8) };
      shader.uniforms.uHorizon = { value: new THREE.Color(0x9dc4d8) };

      // Second, larger-scale normal sample so the chop has big swell under it.
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 noise = getNoise( worldPosition.xz * size );',
        `
        vec4 noise = getNoise( worldPosition.xz * size );
        vec4 swell = getNoise( worldPosition.xz * size * 0.22 + vec2( 14.0, -9.0 ) );
        // Blend the swell in so the surface has two scales of motion.
        noise = normalize( mix( noise, swell, 0.42 ) );
        `
      );

      // Fresnel + depth tint + glitter, applied to the final colour.
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( color, alpha );',
        `
        vec3 viewDir = normalize( vToEye );
        float fres = pow( 1.0 - clamp( dot( viewDir, surfaceNormal ), 0.0, 1.0 ), 3.4 );

        // Depth cue: distance from the camera stands in for water depth here,
        // pulling near water toward turquoise and far water toward deep blue.
        float far = clamp( length( vToEye ) / 900.0, 0.0, 1.0 );
        vec3 body = mix( uShallowColor, uDeepColor, far );

        // Water is mostly its own colour looking down, mostly reflection at
        // grazing angles — that swap is what makes it read as a liquid.
        color = mix( body * 0.85 + color * 0.35, color, clamp( fres * 1.25, 0.06, 0.97 ) );

        // Horizon haze so the far ocean melts into the sky.
        color = mix( color, uHorizon, smoothstep( 0.55, 1.0, far ) * 0.6 );

        // Sun glitter: sharp specular scattered by the wave normals.
        vec3 hv = normalize( sunDirection + viewDir );
        float glint = pow( max( dot( surfaceNormal, hv ), 0.0 ), 220.0 );
        color += sunColor * glint * 1.6;

        // Slight opacity gain at grazing angles, like real water.
        float a = mix( 0.82, 0.99, fres );
        gl_FragColor = vec4( color, a );
        `
      );
      this._shader = shader;
    };
    mat.needsUpdate = true;
  }

  /**
   * Shoreline foam: a ring of quads laid along the island's actual coastline,
   * found by walking outward until the terrain drops below the waterline.
   */
  _buildFoam() {
    if (!this.island) return;
    const island = this.island;
    const positions = [];
    const RAYS = 220;

    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // March outward to find where the land meets the sea.
      let shore = null;
      for (let r = 40; r < 620; r += 4) {
        const x = cos * r;
        const z = sin * r;
        if (island.heightAt(x, z) <= this.level + 0.35) { shore = { x, z, r }; break; }
      }
      if (shore) positions.push(shore);
    }
    if (positions.length < 8) return;

    // Build a foam band as a triangle strip hugging the coast.
    const verts = [];
    const uvs = [];
    const inner = 5.5;
    const outer = 9.0;
    for (let i = 0; i <= positions.length; i++) {
      const p = positions[i % positions.length];
      const a = Math.atan2(p.z, p.x);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      verts.push(cos * (p.r - inner), 0, sin * (p.r - inner));
      verts.push(cos * (p.r + outer), 0, sin * (p.r + outer));
      const u = i / positions.length;
      uvs.push(u, 0, u, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const idx = [];
    for (let i = 0; i < positions.length; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float n(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
        }
        void main() {
          // Surf runs up the beach and pulls back.
          float surge = sin(uTime * 0.55 + vUv.x * 26.0) * 0.5 + 0.5;
          float edge = vUv.y;
          float band = smoothstep(0.0, 0.35, edge) * smoothstep(1.0, 0.45 + surge * 0.3, edge);
          // Broken foam texture.
          float f = n(vec2(vUv.x * 300.0, vUv.y * 9.0 + uTime * 0.5));
          f = smoothstep(0.35, 0.85, f);
          float a = band * (0.35 + f * 0.75);
          gl_FragColor = vec4(vec3(0.94, 0.98, 1.0), a * 0.85);
        }`
    });

    const foam = new THREE.Mesh(geo, mat);
    foam.position.y = this.level + 0.08;
    foam.frustumCulled = false;
    this.world.group.add(foam);
    this.foam = foam;
    this._foamMat = mat;
  }

  update(dt) {
    this._t += dt;
    if (this.water) {
      // Drives the stock water's wave scroll.
      this.water.material.uniforms.time.value += dt * 0.42;
    }
    if (this._foamMat) this._foamMat.uniforms.uTime.value = this._t;
  }
}
