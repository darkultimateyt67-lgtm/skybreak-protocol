import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { MAPS } from './maps.js';
import { Foliage } from './Foliage.js';
import { GroundCover } from './GroundCover.js';
import { Atmosphere } from './Atmosphere.js';
import { TreeBuilder } from './TreeBuilder.js';
import { WIND } from './Wind.js';
import { normalFromBump } from '../engine/Photoreal.js';

/**
 * World — arena host. The geometry itself lives in maps.js as data-driven
 * builders; this class provides the construction helpers, owns the scene
 * group everything is parented to, and registers matching physics colliders.
 * Switching maps = dispose() the old world and construct a new one.
 */
export class World {
  constructor(game, mapId = 'halcyon') {
    this.game = game;
    this.scene = game.scene;
    this.physics = game.physics;

    this.def = MAPS.find((m) => m.id === mapId) || MAPS[0];
    this.mapId = this.def.id;
    this.story = this.def.story;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.playerSpawn = new THREE.Vector3(0, 0.1, 30);
    this.enemySpawns = [];
    this.jumpPads = [];
    this.salvagePoints = [];
    this._animated = [];

    // How much world to build, from the quality tier. Photoreal is constructed
    // before the first World, so this is available on every build including
    // the first. Falls back to full detail if it somehow isn't.
    this.detail = (game.photoreal && game.photoreal.q && game.photoreal.q.content) ?? 1;

    this._buildMaterials();
    this.foliage = new Foliage(this, Math.round(200000 * this.detail));
    this.cover = new GroundCover(this);
    this.trees = new TreeBuilder();
    this.treeCount = 0;
    this.def.build(this);
    this._growTrees();
    // Every tree registered a canopy volume; upload all 200k leaves at once.
    this.foliage.build();
    // Undergrowth goes down last so it can dodge everything already placed.
    // Undergrowth radius shrinks with detail: cover is seeded across an area,
    // so scaling the radius by sqrt keeps its density constant near the player
    // while cutting the total instance count roughly in proportion.
    if (this.def.groundCover) {
      this.cover.build(Math.round(this.def.groundCover * Math.sqrt(this.detail)));
    }
    if (this.def.atmosphere) {
      this.atmos = new Atmosphere(this, {
        ...this.def.atmosphere,
        sunDir: this.sun ? this.sun.position.clone().normalize() : undefined
      });
    }
  }

  /** Remove every scene object and collider this world created. */
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.physics.boxes.length = 0;
    this.jumpPads.length = 0;
    this._animated.length = 0;
  }

  // ------------------------------------------------------------------ visuals

  _canvasTex(c, srgb = true) {
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * Worn metal paneling: seams, rivets, scratches and grime, plus a matching
   * bump map so the wear catches the light. The workhorse surface material.
   */
  // 1024 rather than 512: these are read at arm's length on walls the player
  // walks right up to, and at 512 the seams and rivets visibly soften. Detail
  // counts below scale with area so density stays constant as size changes.
  _panelTexture(baseHex, { panel = 256, grime = 96, size = 1024 } = {}) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const b = document.createElement('canvas');
    b.width = b.height = size;
    const bg = b.getContext('2d');

    const col = new THREE.Color(baseHex);
    g.fillStyle = `rgb(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0})`;
    g.fillRect(0, 0, size, size);
    bg.fillStyle = '#808080';
    bg.fillRect(0, 0, size, size);

    // Detail budget scales with area, so a bigger canvas means more grain
    // rather than the same grain enlarged.
    const A = (size / 512) ** 2;

    // Tonal noise so flat faces aren't dead, at two scales: broad mottling
    // that reads as uneven paint, and fine speckle that reads as tooth.
    for (let i = 0; i < 500 * A; i++) {
      const l = Math.random() > 0.5;
      g.fillStyle = l ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
      g.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 8, 2 + Math.random() * 8);
    }
    for (let i = 0; i < 2600 * A; i++) {
      const v = Math.random() > 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${0.012 + Math.random() * 0.03})`;
      g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
      // The same speckle in the bump canvas gives the surface microrelief,
      // which is what the normal map turns into a non-flat sheen.
      const bv = 128 + (Math.random() - 0.5) * 26;
      bg.fillStyle = `rgb(${bv | 0},${bv | 0},${bv | 0})`;
      bg.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    // Panel seams with rivets at the crossings.
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    bg.strokeStyle = '#484848';
    g.lineWidth = bg.lineWidth = 2;
    const seams = [];
    for (let i = 0; i <= size; i += panel) {
      const j = i + (Math.random() * 10 - 5);
      seams.push(j);
      g.beginPath(); g.moveTo(j, 0); g.lineTo(j, size); g.stroke();
      g.beginPath(); g.moveTo(0, j); g.lineTo(size, j); g.stroke();
      bg.beginPath(); bg.moveTo(j, 0); bg.lineTo(j, size); bg.stroke();
      bg.beginPath(); bg.moveTo(0, j); bg.lineTo(size, j); bg.stroke();
    }
    for (const x of seams) {
      for (const y of seams) {
        for (const [ox, oy] of [[6, 6], [-6, 6], [6, -6], [-6, -6]]) {
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.beginPath(); g.arc(x + ox, y + oy, 1.6, 0, 7); g.fill();
          bg.fillStyle = '#b8b8b8';
          bg.beginPath(); bg.arc(x + ox, y + oy, 1.6, 0, 7); bg.fill();
        }
      }
    }
    // Scratches.
    for (let i = 0; i < 26 * A; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const dx = (Math.random() - 0.5) * 50, dy = (Math.random() - 0.5) * 12;
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke();
      bg.strokeStyle = '#a0a0a0';
      bg.lineWidth = 1;
      bg.beginPath(); bg.moveTo(x, y); bg.lineTo(x + dx, y + dy); bg.stroke();
    }
    // Grime blotches settling at panel lines.
    for (let i = 0; i < grime; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = 10 + Math.random() * 26;
      const rad = g.createRadialGradient(x, y, 2, x, y, r);
      rad.addColorStop(0, 'rgba(8,8,10,0.22)');
      rad.addColorStop(1, 'rgba(8,8,10,0)');
      g.fillStyle = rad;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // Streaks running down from the seams, where water and dirt actually
    // collect. Vertical wear is the single strongest cue that a surface has
    // been outdoors rather than freshly modelled.
    for (let i = 0; i < 34 * A; i++) {
      const x = seams[(Math.random() * seams.length) | 0] + (Math.random() - 0.5) * 14;
      const y = Math.random() * size;
      const len = 20 + Math.random() * 90;
      const grad = g.createLinearGradient(x, y, x, y + len);
      grad.addColorStop(0, 'rgba(10,10,12,0.20)');
      grad.addColorStop(1, 'rgba(10,10,12,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, 1 + Math.random() * 3.5, len);
    }
    return { map: this._canvasTex(c), bump: this._canvasTex(b, false) };
  }

  /** Ribbed cargo-container skin: corrugation columns + stencil markings. */
  _containerTexture(baseHex) {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const b = document.createElement('canvas');
    b.width = b.height = size;
    const bg = b.getContext('2d');
    const col = new THREE.Color(baseHex);
    g.fillStyle = `rgb(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0})`;
    g.fillRect(0, 0, size, size);
    bg.fillStyle = '#808080';
    bg.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x, 0, 5, size);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + 8, 0, 4, size);
      bg.fillStyle = '#585858';
      bg.fillRect(x, 0, 5, size);
      bg.fillStyle = '#b0b0b0';
      bg.fillRect(x + 8, 0, 4, size);
    }
    // Stencil ID + wear.
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.font = 'bold 22px monospace';
    g.fillText('ARC-' + ((Math.random() * 90 + 10) | 0), 26, 132);
    for (let i = 0; i < 220; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.03)';
      g.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    return { map: this._canvasTex(c), bump: this._canvasTex(b, false) };
  }

  /** Procedural grid + wear texture used on station floors. */
  _gridTexture(size = 512, major = 128, minor = 32) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#171c26';
    g.fillRect(0, 0, size, size);
    // Wear noise under the grid.
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
      g.fillRect(Math.random() * size, Math.random() * size, 3 + Math.random() * 10, 3 + Math.random() * 10);
    }
    g.strokeStyle = '#1f2530';
    g.lineWidth = 1;
    for (let i = 0; i <= size; i += minor) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
    }
    g.strokeStyle = '#2b3242';
    g.lineWidth = 2;
    for (let i = 0; i <= size; i += major) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
    }
    // Scuffs and stains.
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = 12 + Math.random() * 34;
      const rad = g.createRadialGradient(x, y, 2, x, y, r);
      rad.addColorStop(0, 'rgba(5,6,8,0.25)');
      rad.addColorStop(1, 'rgba(5,6,8,0)');
      g.fillStyle = rad;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    return this._canvasTex(c);
  }

  /** Procedural mossy-ground texture for the biodome: greens with blade strokes. */
  _grassTexture(size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#27381f';
    g.fillRect(0, 0, size, size);
    // Patchy tone variation.
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${30 + Math.random() * 30}, ${60 + Math.random() * 40}, ${25 + Math.random() * 20}, 0.25)`;
      const r = 8 + Math.random() * 26;
      g.beginPath();
      g.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      g.fill();
    }
    // Grass-blade strokes.
    g.strokeStyle = 'rgba(90, 140, 70, 0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 5);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * A biodome tree: trunk (collides) + layered canopy cones. Slight per-tree
   * variation from the seed so the grove doesn't look copy-pasted.
   */
  /** Streaky bark + mottled leaf canvases for the biodome trees. */
  _organicTexture(baseHex, mode) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const col = new THREE.Color(baseHex);
    g.fillStyle = `rgb(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0})`;
    g.fillRect(0, 0, size, size);
    if (mode === 'bark') {
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * size;
        g.strokeStyle = Math.random() > 0.5 ? 'rgba(20,12,6,0.35)' : 'rgba(180,140,100,0.12)';
        g.lineWidth = 1 + Math.random() * 2;
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + 6, size * 0.33, x - 6, size * 0.66, x + 3, size);
        g.stroke();
      }
    } else {
      for (let i = 0; i < 320; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(12,40,12,0.25)' : 'rgba(130,190,90,0.14)';
        g.beginPath();
        g.arc(Math.random() * size, Math.random() * size, 2 + Math.random() * 5, 0, 7);
        g.fill();
      }
    }
    return this._canvasTex(c);
  }

  /**
   * Plant a tree. Nothing is created here — the trunk and limbs are grown
   * into the shared TreeBuilder and fused into one mesh by _growTrees()
   * after the map has finished laying itself out.
   */
  /**
   * Plant a tree on sloped terrain. Same as _tree but the trunk starts at an
   * explicit ground height instead of assuming a flat deck at y = 0.
   */
  _treeAt(x, y, z, scale = 1, seed = 0, species = null) {
    const kinds = ['oak', 'pine', 'birch', 'oak', 'pine', 'scrub'];
    const kind = species || kinds[Math.floor(Math.abs(seed) * 1.7) % kinds.length];
    const info = this.trees.add(x, z, kind, scale, Math.abs(seed) + 1, y);
    this.treeCount++;
    this.physics.addBox(
      new THREE.Vector3(x, y + info.height * 0.5, z),
      new THREE.Vector3(info.radius * 2.1, info.height, info.radius * 2.1),
      null,
      { surface: 'wood' }
    );
    return info;
  }

  /** A boulder resting on sloped terrain. */
  _rockAt(x, y, z, s = 1, seed = 0) {
    if (!this._rockMat) {
      this._rockMat = new THREE.MeshStandardMaterial({ color: 0x5d6660, roughness: 0.95, flatShading: true });
    }
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this._rockMat);
    rock.position.set(x, y + s * 0.4, z);
    rock.rotation.set(seed, seed * 2, seed * 0.5);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.group.add(rock);
    this.physics.addBox(
      new THREE.Vector3(x, y + s * 0.4, z),
      new THREE.Vector3(s * 1.5, s * 1.1, s * 1.5),
      null,
      { surface: 'stone' }
    );
    return rock;
  }

  _tree(x, z, scale = 1, seed = 0, species = null) {
    // Rotate through species so the grove isn't a monoculture, with the
    // caller's seed deciding which one this position gets.
    const kinds = ['oak', 'pine', 'birch', 'oak', 'pine', 'scrub'];
    const kind = species || kinds[Math.floor(Math.abs(seed) * 1.7) % kinds.length];
    const info = this.trees.add(x, z, kind, scale, Math.abs(seed) + 1);
    this.treeCount++;

    // Trunk collider + keep undergrowth off the root plate.
    this.physics.addBox(
      new THREE.Vector3(x, info.height * 0.5, z),
      new THREE.Vector3(info.radius * 2.1, info.height, info.radius * 2.1),
      null,
      { surface: 'wood' }
    );
    if (this.cover) this.cover.exclude(x, z, info.radius * 2.6, info.radius * 2.6);
    return info;
  }

  /**
   * Fuse every branch of every tree into one mesh, then hand each twig tip
   * to the foliage system so the 200,000 leaves grow on branches instead of
   * floating in a ball.
   */
  _growTrees() {
    if (!this.treeCount) return;
    const mesh = this.trees.build();
    this.group.add(mesh);
    this.treeMesh = mesh;

    if (this.foliage) {
      for (const c of this.trees.clusters) {
        this.foliage.addCanopy(c.x, c.y, c.z, c.r, c.r * 1.5, c.w, c.root);
      }
    }
    this.treeStats = this.trees.stats;
  }

  /** Bark material for standalone woodwork (fallen logs, stumps). */
  get barkMat() {
    if (!this._barkMat) {
      this._barkMat = new THREE.MeshStandardMaterial({
        map: this._organicTexture(0x5a4230, 'bark'), roughness: 0.95
      });
    }
    return this._barkMat;
  }

  /** A mossy boulder with a matching collider. */
  _rock(x, z, s = 1, seed = 0) {
    if (!this._rockMat) {
      this._rockMat = new THREE.MeshStandardMaterial({ color: 0x5d6660, roughness: 0.95, flatShading: true });
    }
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this._rockMat);
    rock.position.set(x, s * 0.55, z);
    rock.rotation.set(seed, seed * 2, seed * 0.5);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.group.add(rock);
    this.physics.addBox(new THREE.Vector3(x, s * 0.55, z), new THREE.Vector3(s * 1.5, s * 1.1, s * 1.5));
    return rock;
  }

  _buildMaterials() {
    const grid = this._gridTexture();
    grid.repeat.set(20, 20);
    const panelMid = this._panelTexture(0x2b3242);
    // Panel pitches doubled alongside the canvas so seam spacing in world
    // units is unchanged — only the resolution they're drawn at went up.
    const panelDark = this._panelTexture(0x1a1f2b, { panel: 336 });
    const panelWall = this._panelTexture(0x232c3e, { panel: 192, grime: 48 });
    const crateTex = this._containerTexture(0x3a4257);
    const containerTex = this._containerTexture(0x2e4152);

    // Real surfaces scatter light off their microgeometry — a normal map
    // derived from the bump canvas is what makes concrete read as concrete
    // instead of a flat painted plane.
    const surf = (t, rough, metal) => {
      const m = new THREE.MeshStandardMaterial({
        map: t.map, roughness: rough, metalness: metal
      });
      const n = normalFromBump(t.bump, 2.2);
      if (n) {
        m.normalMap = n;
        m.normalScale = new THREE.Vector2(0.85, 0.85);
      } else {
        m.bumpMap = t.bump;
        m.bumpScale = 0.5;
      }
      return m;
    };

    this.mats = {
      floor: new THREE.MeshStandardMaterial({ map: grid, roughness: 0.85, metalness: 0.35 }),
      structure: surf(panelMid, 0.62, 0.5),
      structureDark: surf(panelDark, 0.55, 0.62),
      wallrun: surf(panelWall, 0.45, 0.62),
      crate: surf(crateTex, 0.75, 0.35),
      container: surf(containerTex, 0.7, 0.4),
      // Worklight trims, not neon — the station reads industrial, lived-in.
      neonCyan: new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x7ac8dd, emissiveIntensity: 1.1, roughness: 0.4 }),
      neonOrange: new THREE.MeshStandardMaterial({ color: 0x2b1806, emissive: 0xffa050, emissiveIntensity: 1.1, roughness: 0.4 }),
      neonRed: new THREE.MeshStandardMaterial({ color: 0x2b0a06, emissive: 0xff5040, emissiveIntensity: 1.2, roughness: 0.4 }),
      neonPurple: new THREE.MeshStandardMaterial({ color: 0x160a2b, emissive: 0xb8a0e0, emissiveIntensity: 1.0, roughness: 0.4 }),
      pad: new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffb347, emissiveIntensity: 1.2, roughness: 0.4 })
    };
    this._boxGeo = new THREE.BoxGeometry(1, 1, 1);
  }

  /**
   * Distant silhouettes ringing the map — towers for station decks, a tree
   * line for the biodome — so the horizon reads as a place, not a void.
   * Purely visual; fog does most of the painting.
   */
  _skyline(radius, color, style = 'towers') {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.1 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x0a1014, emissive: 0x37e6ff, emissiveIntensity: 1.2 });
    const count = 18;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.sin(i * 7) * 0.12;
      const r = radius + (Math.sin(i * 13) * 0.5 + 0.5) * 60;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (style === 'towers') {
        const w = 18 + (i % 4) * 9;
        const h = 35 + ((i * 17) % 55);
        const tower = new THREE.Mesh(this._boxGeo, mat);
        tower.scale.set(w, h, w);
        tower.position.set(x, h / 2 - 12, z);
        tower.rotation.y = a;
        this.group.add(tower);
        if (i % 3 === 0) {
          const strip = new THREE.Mesh(this._boxGeo, glow);
          strip.scale.set(w * 0.7, 0.8, 2);
          strip.position.set(x, h - 14, z);
          strip.rotation.y = a;
          this.group.add(strip);
        }
      } else {
        const s = 10 + ((i * 11) % 14);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(s, s * 2.6, 7), mat);
        cone.position.set(x, s * 1.1 - 4, z);
        this.group.add(cone);
      }
    }
  }

  /** Per-map atmosphere: fog, hemisphere fill, shadow-casting sun, accents. */
  _lighting({ fogColor, fogDensity, hemi, sun, accents = [], shadowSize = 70 }) {
    this.scene.fog = new THREE.FogExp2(fogColor, fogDensity);

    const hemiLight = new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]);
    this.group.add(hemiLight);
    // Kept as handles so going underground can put the daylight out.
    this.hemi = hemiLight;

    const dir = new THREE.DirectionalLight(sun.color, sun.intensity);
    dir.position.set(...sun.pos);
    dir.castShadow = this.game.settings.shadows !== false;
    this.sun = dir;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.radius = 5; // soft penumbra instead of razor edges
    dir.shadow.camera.left = -shadowSize;
    dir.shadow.camera.right = shadowSize;
    dir.shadow.camera.top = shadowSize;
    dir.shadow.camera.bottom = -shadowSize;
    dir.shadow.camera.near = 10;
    dir.shadow.camera.far = 260;
    dir.shadow.bias = -0.0004;
    this.group.add(dir);
    this.group.add(dir.target);

    for (const [x, y, z, color, intensity, dist] of accents) {
      const l = new THREE.PointLight(color, intensity, dist, 1.8);
      l.position.set(x, y, z);
      this.group.add(l);
    }
  }

  /** Per-map sky dome. */
  _sky({ turbidity, rayleigh, mieC, mieG, phi, theta }) {
    const sky = new Sky();
    sky.scale.setScalar(1200); // stay inside the camera far plane
    const u = sky.material.uniforms;
    u.turbidity.value = turbidity;
    u.rayleigh.value = rayleigh;
    u.mieCoefficient.value = mieC;
    u.mieDirectionalG.value = mieG;
    u.sunPosition.value.setFromSphericalCoords(1, phi, theta);
    this.group.add(sky);
  }

  // --------------------------------------------------------------- structure

  /**
   * Place a visible box with a matching collider.
   * (x, y, z) is the center of the footprint at its BASE; height extends up.
   */
  /**
   * Rescale a box's UVs so a tiling texture keeps a CONSTANT real-world size
   * regardless of how big the box is.
   *
   * BoxGeometry gives every face UVs spanning 0..1, so a shared facade texture
   * stretched to fit whatever it was put on: a 10 m shopfront and an 80 m
   * tower both showed exactly the eight-by-eight window grid drawn on the
   * canvas. On the tower that made each window seven metres tall and four
   * wide, which is why the city read as noise rather than architecture — the
   * windows had no consistent size to measure the building against.
   *
   * Repeats are ROUNDED to whole numbers so the grid lands flush with the
   * corners instead of slicing a window in half at every edge.
   *
   * Face order in BoxGeometry is +X, -X, +Y, -Y, +Z, -Z, four verts each, and
   * each face's extent in world units differs — so they cannot share a scale.
   */
  _uvScaleBox(geo, w, h, d, tile) {
    const uv = geo.attributes.uv;
    const spans = [
      [d, h], [d, h],   // +X, -X
      [w, d], [w, d],   // +Y, -Y
      [w, h], [w, h]    // +Z, -Z
    ];
    for (let f = 0; f < 6; f++) {
      const su = Math.max(1, Math.round(spans[f][0] / tile));
      const sv = Math.max(1, Math.round(spans[f][1] / tile));
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
      }
    }
    uv.needsUpdate = true;
    return geo;
  }

  _block(w, h, d, x, y, z, mat, opts = {}) {
    // A world-scaled tile needs its own geometry, since UVs are baked per box.
    // Everything else keeps sharing the one box, and the static merge folds
    // the clones away afterwards so this costs draw calls nowhere.
    const geo = opts.tile
      ? this._uvScaleBox(this._boxGeo.clone(), w, h, d, opts.tile)
      : this._boxGeo;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y + h / 2, z);
    let quat = null;
    if (opts.tiltX || opts.rotY) {
      const e = new THREE.Euler(opts.tiltX || 0, opts.rotY || 0, 0, 'YXZ');
      quat = new THREE.Quaternion().setFromEuler(e);
      mesh.quaternion.copy(quat);
    }
    if (opts.visible !== false) {
      mesh.castShadow = opts.shadow !== false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (opts.collide !== false) {
      this.physics.addBox(mesh.position, new THREE.Vector3(w, h, d), quat, {
        wallRun: !!opts.wallRun,
        surface: opts.surface || 'metal'
      });
      // Keep undergrowth from sprouting through anything solid. Floors are
      // huge and shouldn't clear the whole map, so they're skipped.
      if (this.cover && w < 60 && d < 60) {
        this.cover.exclude(x, z, w * 0.5 + 0.6, d * 0.5 + 0.6);
      }
    }
    return mesh;
  }

  /** Non-colliding emissive trim strip. */
  _strip(w, h, d, x, y, z, mat, rotY = 0) {
    const mesh = new THREE.Mesh(this._boxGeo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Ramp ascending toward -Z when dir=-1, toward +Z when dir=+1,
   * from ground level y0 up `rise` meters over `length`.
   */
  _ramp(width, length, rise, x, y0, zCenter, dir, mat) {
    const angle = Math.atan2(rise, length);
    // Thick slab: a thin ramp lets a fast capsule tunnel past the top face
    // and get resolved out the back — reading as an invisible wall. With a
    // deep wedge, penetration always resolves out the walkable surface.
    const thick = 2.4;
    const hyp = Math.sqrt(length * length + rise * rise);
    const mesh = new THREE.Mesh(this._boxGeo, mat);
    mesh.scale.set(width, thick, hyp);
    const e = new THREE.Euler(-dir * angle, 0, 0, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(e);
    mesh.quaternion.copy(quat);
    mesh.position.set(x, y0 + rise / 2 - (thick / 2) * Math.cos(angle), zCenter);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.physics.addBox(mesh.position, new THREE.Vector3(width, thick, hyp), quat);
    return mesh;
  }

  /** Invisible boundary walls + glowing rim marking the playable area. */
  _bounds(width, depth, rimMat) {
    const hw = width / 2 + 1;
    const hd = depth / 2 + 1;
    this._block(width, 24, 2, 0, 0, -hd, this.mats.structure, { visible: false });
    this._block(width, 24, 2, 0, 0, hd, this.mats.structure, { visible: false });
    this._block(2, 24, depth, -hw, 0, 0, this.mats.structure, { visible: false });
    this._block(2, 24, depth, hw, 0, 0, this.mats.structure, { visible: false });
    this._strip(width - 2, 0.5, 0.35, 0, 0, -hd + 1.6, rimMat);
    this._strip(width - 2, 0.5, 0.35, 0, 0, hd - 1.6, rimMat);
    this._strip(0.35, 0.5, depth - 2, -hw + 1.6, 0, 0, rimMat);
    this._strip(0.35, 0.5, depth - 2, hw - 1.6, 0, 0, rimMat);
  }

  /** Cover crates: one InstancedMesh for visuals, one collider per crate. */
  _crates(defs) {
    const crates = new THREE.InstancedMesh(this._boxGeo, this.mats.crate, defs.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    defs.forEach(([x, y, z, s], i) => {
      m4.compose(new THREE.Vector3(x, y + s / 2, z), q, new THREE.Vector3(s, s, s));
      crates.setMatrixAt(i, m4);
      this.physics.addBox(new THREE.Vector3(x, y + s / 2, z), new THREE.Vector3(s, s, s));
    });
    crates.castShadow = true;
    crates.receiveShadow = true;
    this.group.add(crates);
  }

  /** Slowly rotating emissive ring — a landmark beacon. */
  _holoRing(x, y, z, radius, color) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.09, 10, 64),
      new THREE.MeshStandardMaterial({ color: 0x061a20, emissive: color, emissiveIntensity: 3.2 })
    );
    ring.position.set(x, y, z);
    ring.rotation.x = Math.PI / 2;
    ring.userData.dynamic = true;   // it spins: never bake it into a static batch
    this.group.add(ring);
    this._animated.push((dt, t) => {
      ring.rotation.z += dt * 0.5;
      ring.position.y = y + Math.sin(t * 0.8) * 0.3;
    });
  }

  /** Looping fire + smoke column (crash sites, burning wreckage). */
  _fire(x, y, z, scale = 1) {
    const pos = new THREE.Vector3();
    let acc = Math.random() * 0.1;
    this._animated.push((dt) => {
      const fx = this.game.effects;
      if (!fx) return;
      acc += dt;
      if (acc < 0.13) return;
      acc = 0;
      pos.set(x + (Math.random() - 0.5) * scale, y, z + (Math.random() - 0.5) * scale);
      fx.burst(pos, { count: 2, color: 0xff7a26, speed: 1.3 * scale, life: 0.5, gravity: -3.5 });
      if (Math.random() < 0.55) {
        fx.burst(pos, { count: 1, color: 0x24262a, speed: 0.6, life: 1.5, gravity: -2.4 });
      }
    });
    const glow = new THREE.PointLight(0xff7a26, 14 * scale, 10 * scale, 2);
    glow.position.set(x, y + 0.8, z);
    this.group.add(glow);
    this._animated.push((dt, t) => {
      glow.intensity = (12 + Math.sin(t * 11 + x) * 4 + Math.sin(t * 23) * 2) * scale;
    });
  }

  /** Downed dropship wreck: split fuselage, shorn wing, debris, fires. */
  _wreck(x, z, yaw = 0) {
    const M = this.mats;
    const scorched = new THREE.MeshStandardMaterial({ color: 0x181a1e, roughness: 0.9, metalness: 0.5 });
    const hullMat = this.mats.structureDark;

    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 9, 12), hullMat);
    hull.position.set(x, 1.5, z);
    hull.rotation.set(0, yaw, Math.PI / 2 - 0.12);
    hull.castShadow = true;
    this.group.add(hull);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.physics.addBox(new THREE.Vector3(x, 1.5, z), new THREE.Vector3(9, 3.4, 3.8), q);

    // Shorn wing, tail section, cockpit ring, scattered plating.
    const wing = new THREE.Mesh(this._boxGeo, hullMat);
    wing.scale.set(7, 0.4, 2.4);
    wing.position.set(x + Math.cos(yaw) * 6, 0.5, z - Math.sin(yaw) * 6);
    wing.rotation.set(0.2, yaw + 0.7, 0.3);
    wing.castShadow = true;
    this.group.add(wing);
    this.physics.addBox(wing.position, new THREE.Vector3(7, 1, 2.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + 0.7, 0, 'YXZ')));

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.7, 3.5, 10), scorched);
    tail.position.set(x - Math.sin(yaw) * 7.5, 1, z - Math.cos(yaw) * 7.5);
    tail.rotation.set(0.4, yaw, Math.PI / 2 + 0.3);
    tail.castShadow = true;
    this.group.add(tail);
    this.physics.addBox(tail.position, new THREE.Vector3(3.5, 2.4, 2.6), q);

    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(this._boxGeo, i % 2 ? scorched : hullMat);
      const a = yaw + i * 1.1;
      shard.scale.set(0.8 + Math.random(), 0.15, 0.5 + Math.random() * 0.8);
      shard.position.set(x + Math.cos(a) * (4 + i), 0.08, z + Math.sin(a) * (3 + i * 0.8));
      shard.rotation.y = a * 2.3;
      this.group.add(shard);
    }
    this._strip(1.4, 0.2, 0.3, x + Math.cos(yaw) * 2, 2.8, z - Math.sin(yaw) * 2, this.mats.neonOrange, yaw);

    this._fire(x + Math.cos(yaw) * 3.4, 0.4, z - Math.sin(yaw) * 3.4, 1.3);
    this._fire(tail.position.x, 0.6, tail.position.z, 0.9);
  }

  /** Salvage cache: explore the map, crack them open for credits (E). */
  _salvage(x, z) {
    const box = new THREE.Mesh(this._boxGeo, this.mats.container);
    box.scale.set(0.85, 0.7, 0.85);
    box.position.set(x, 0.35, z);
    box.rotation.y = x * 0.7 + z * 0.3;
    box.castShadow = true;
    this.group.add(box);
    const lid = new THREE.Mesh(this._boxGeo, new THREE.MeshStandardMaterial({
      color: 0x1a1503, emissive: 0xffd24a, emissiveIntensity: 1.8
    }));
    lid.scale.set(0.88, 0.08, 0.88);
    lid.position.set(x, 0.72, z);
    lid.rotation.y = box.rotation.y;
    this.group.add(lid);
    this.physics.addBox(box.position, new THREE.Vector3(0.85, 0.7, 0.85));
    this.salvagePoints.push({ pos: new THREE.Vector3(x, 0, z), taken: false, box, lid });
  }

  _jumpPad(x, y, z, power) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.22, 24), this.mats.pad);
    pad.position.set(x, y + 0.11, z);
    pad.receiveShadow = true;
    this.group.add(pad);
    this.jumpPads.push({ pos: new THREE.Vector3(x, y, z), radius: 1.5, power, cooldown: 0 });
    this._animated.push((dt, t) => {
      pad.material.emissiveIntensity = 1.4 + Math.sin(t * 3 + x) * 0.5;
    });
  }

  update(dt) {
    const t = performance.now() * 0.001;
    // The wind clock runs from zero for each world, so the shader never has
    // to take the sine of a number in the millions.
    this._windT = (this._windT || 0) + dt;
    WIND.update(this._windT);
    for (const fn of this._animated) fn(dt, t);
    if (this.foliage) this.foliage.update(dt);
    if (this.cover) this.cover.update(dt);
    if (this.atmos) this.atmos.update(dt, this.game.player ? this.game.player.position : null);
  }
}
