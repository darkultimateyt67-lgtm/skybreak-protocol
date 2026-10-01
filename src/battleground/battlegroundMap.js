import * as THREE from 'three';
import { Island, POIS, ISLAND_SIZE, WATER_LEVEL } from './Island.js';
import { POIBuilder } from './POIBuilder.js';
import { Ocean } from './Ocean.js';

/**
 * The BATTLEGROUND map definition, in the same shape the World builder
 * expects. It has no quests or NPCs — the match manager drives everything —
 * but it does publish the island sampler and loot anchors the mode needs.
 */
export const BATTLEGROUND_MAP = {
  id: 'battleground',
  name: 'BATTLEGROUND',
  chapter: 'BATTLE ROYALE',
  blurb: 'A 2400-metre island, eighteen districts, fifty fighters, one shrinking storm. Land, loot, build, and be the last one standing.',
  mode: 'br',
  groundCover: 0,          // handled per-biome by the island itself
  atmosphere: { rays: 16, pollen: 1600, birds: 34, radius: 840 },
  intro: [],
  npcs: [],
  quests: [],

  build(w) {
    const M = w.mats;

    // --- Lighting: open sky, long shadows, clean air ---------------------
    w._lighting({
      fogColor: 0x9dc4d8, fogDensity: 0.0012,
      hemi: [0xcfe4f2, 0x54604e, 1.5],
      sun: { color: 0xfff3d6, intensity: 3.1, pos: [320, 460, 180] },
      accents: [],
      // The shadow camera is re-fitted around the player each frame by
      // Photoreal._followShadows, so this is only the initial extent.
      shadowSize: 90
    });
    w._sky({ turbidity: 3.4, rayleigh: 1.1, mieC: 0.004, mieG: 0.78, phi: Math.PI * 0.34, theta: Math.PI * 0.28 });

    // --- Terrain ----------------------------------------------------------
    const island = new Island(w, 20260725);
    island.build();
    w.island = island;
    // Hand the sampler to physics so capsules and rays hit the landscape.
    w.physics.terrain = (x, z) => island.heightAt(x, z);

    // Reflective ocean with shoreline surf.
    const q = w.game.photoreal && w.game.photoreal.q;
    const ocean = new Ocean(w, island, {
      level: WATER_LEVEL,
      size: ISLAND_SIZE * 3,
      reflectionRes: q ? q.reflect : 512
    });
    ocean.build(w.sun ? w.sun.position.clone().normalize() : null);
    w.ocean = ocean;
    w._animated.push((dt) => ocean.update(dt));

    // --- Landmarks --------------------------------------------------------
    const poi = new POIBuilder(w, island);
    const stats = poi.build();
    w.poiBuilder = poi;
    w.lootSpots = poi.lootSpots;
    w.chestSpots = poi.chestSpots;

    // --- Roads linking the districts -------------------------------------
    const road = new THREE.MeshLambertMaterial({ color: 0x4b4741 });
    const linkOrder = ['foundry', 'rustwood', 'motel', 'silos', 'harbor', 'chapel', 'ridge', 'quarry', 'cinder', 'greenhouse', 'boneyard'];
    for (let i = 0; i < linkOrder.length - 1; i++) {
      const a = POIS.find((p) => p.id === linkOrder[i]);
      const b = POIS.find((p) => p.id === linkOrder[i + 1]);
      if (!a || !b) continue;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const y = island.heightAt(x, z);
        if (y < 1.5) continue;                     // roads don't cross water
        const seg = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 11), road);
        seg.position.set(x, y + 0.14, z);
        seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        seg.receiveShadow = true;
        w.group.add(seg);
      }
    }

    // --- Vegetation -------------------------------------------------------
    island.vegetate(Math.round(2600 * (w.detail ?? 1)));

    // Shadow budget: on a 1200 m island only things you read as landmarks
    // need to cast. Small scattered props are lit but don't re-render into
    // the shadow map, which is the single biggest frame cost out here.
    let stripped = 0;
    w.group.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      o.geometry.computeBoundingSphere?.();
      const r = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0;
      const scale = Math.max(o.scale.x, o.scale.y, o.scale.z);
      if (r * scale < 2.6) { o.castShadow = false; stripped++; }
    });
    w.shadowStripped = stripped;

    // --- Spawn + supply-drop anchors -------------------------------------
    w.playerSpawn.set(0, island.heightAt(0, 0) + 1, 0);
    w.enemySpawns = POIS.map((p) => new THREE.Vector3(p.x, (p.groundY ?? 0) + 1, p.z));
    w.brStats = stats;
  }
};
