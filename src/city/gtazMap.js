import * as THREE from 'three';
import { City, CITY_SIZE, DISTRICTS } from './City.js';

/**
 * GTAZ — a 2000 m open city with nothing to do in it, on purpose.
 *
 * No quests, no objectives, no fail state that isn't self-inflicted. The mode
 * is the city: drive it, walk it, wreck it, and outrun the consequences. The
 * map definition itself is thin because everything interactive is owned by
 * FreeRoam; this file only has to raise the geography and hand over the
 * road graph.
 */

export const GTAZ_MAP = {
  id: 'gtaz',
  name: 'GTAZ',
  chapter: 'FREE ROAM',
  blurb: 'A city of eight districts and no missions. Take any car, go anywhere, and try not to attract the law.',
  mode: 'gtaz',
  groundCover: 0,
  // Leaves per twig rather than a fixed total: 214 park trees carry 30,000
  // twig tips, and the grove's budget spread over them left bare branches.
  // Larger sprigs so a crown fills without a million triangles.
  foliage: { perCluster: 3.2, scale: 2.2, cap: 100000 },
  atmosphere: { rays: 10, pollen: 500, birds: 22, radius: 700 },
  intro: [],
  npcs: [],
  quests: [],

  build(w) {
    // --- Light: late afternoon, long shadows down the avenues ---------------
    w._lighting({
      fogColor: 0xb7c6d4,
      fogDensity: 0.00055,
      hemi: [0xcddcec, 0x5a5348, 1.35],
      sun: { color: 0xffe6bd, intensity: 3.0, pos: [-420, 380, 260] },
      accents: [],
      shadowSize: 110
    });
    w._sky({ turbidity: 5.2, rayleigh: 1.5, mieC: 0.006, mieG: 0.80, phi: Math.PI * 0.30, theta: Math.PI * 0.62 });

    const city = new City(w, 90210);
    const stats = city.build();
    w.city = city;
    w.cityStats = stats;

    // Flat ground: a constant sampler is cheaper and steadier than a
    // heightfield for a place where every surface is meant to be level.
    // Flat everywhere on the island itself; the beach and seabed beyond the
    // shoreline are real slopes you can walk down into the sea.
    w.physics.terrain = (x, z) => city.terrainAt(x, z);

    // Spawn on a kerb downtown, facing the middle of the map.
    w.playerSpawn = new THREE.Vector3(city.xs[Math.floor(city.xs.length / 2)] + 12, 0.1, 30);

    // Landmark anchors so the minimap and district banners have something to
    // point at.
    w.districts = DISTRICTS;
    w.lootSpots = [];
    w.enemySpawns = [];
    return stats;
  }
};

export { CITY_SIZE };
