import * as THREE from 'three';
import { POIS } from './Island.js';

/**
 * POIBuilder — the twelve named landmarks.
 *
 * Each district gets its own architecture so you can tell where you are from
 * a rooftop half the island away: the Foundry is chimneys and gantries, Salt
 * Harbor is piers and containers, Rustwood is pitched-roof houses, and so on.
 *
 * Every building also registers loot anchors (floor spawns) and chest
 * anchors, which the loot system fills at match start. Buildings are made of
 * destructible-tagged boxes so the building system can chew through them.
 */

export class POIBuilder {
  constructor(world, island) {
    this.world = world;
    this.island = island;
    this.lootSpots = [];
    this.chestSpots = [];
    this.buildings = 0;
  }

  /** Structural box that sits on the POI pad and registers a collider. */
  _box(w, h, d, x, y, z, mat, opts = {}) {
    this.world._block(w, h, d, x, y, z, mat, opts);
    this.buildings++;
  }

  _loot(x, y, z, weight = 1) { this.lootSpots.push({ x, y, z, weight }); }
  _chest(x, y, z) { this.chestSpots.push({ x, y, z }); }

  /** A basic building shell: walls, floor, roof, a door gap and windows. */
  _house(x, y, z, w, d, h, mats, opts = {}) {
    const { wall, roof, trim } = mats;
    const t = 0.35;
    // Floor slab.
    this._box(w, 0.4, d, x, y, z, wall);
    // Four walls with a doorway punched in the south face.
    this._box(w, h, t, x, y + 0.4, z - d / 2, wall);                 // north
    const doorW = 2.2;
    const side = (w - doorW) / 2;
    this._box(side, h, t, x - (doorW + side) / 2, y + 0.4, z + d / 2, wall);
    this._box(side, h, t, x + (doorW + side) / 2, y + 0.4, z + d / 2, wall);
    this._box(doorW, h - 2.4, t, x, y + 2.8, z + d / 2, wall);        // lintel
    this._box(t, h, d, x - w / 2, y + 0.4, z, wall);                  // west
    this._box(t, h, d, x + w / 2, y + 0.4, z, wall);                  // east
    // Roof: either flat or a simple gable.
    if (opts.gable) {
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const k = i / steps;
        this._box(w * (1 - k * 0.75), 0.5, d + 0.6, x, y + 0.4 + h + i * 0.7, z, roof);
      }
    } else {
      this._box(w + 0.8, 0.45, d + 0.8, x, y + 0.4 + h, z, roof);
    }
    // Window trim and a doorstep so it reads as a building not a crate.
    this._box(w + 0.5, 0.25, 0.3, x, y + 0.4 + h * 0.62, z + d / 2 + 0.1, trim, { collide: false });
    this._box(2.6, 0.2, 1.1, x, y, z + d / 2 + 0.6, trim);

    // Loot: two spots inside, one chest chance upstairs/attic.
    this._loot(x - w * 0.25, y + 0.5, z + d * 0.2);
    this._loot(x + w * 0.25, y + 0.5, z - d * 0.2);
    if (opts.chest !== false) this._chest(x, y + 0.5, z);
    return { x, y, z, w, d, h };
  }

  build() {
    const M = this.world.mats;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b533a, roughness: 0.92 });
    const plaster = new THREE.MeshStandardMaterial({ color: 0x9a9285, roughness: 0.9 });
    const brick = new THREE.MeshStandardMaterial({ color: 0x7d4a3c, roughness: 0.92 });
    const roofRed = new THREE.MeshStandardMaterial({ color: 0x8c3b30, roughness: 0.88 });
    const roofBlue = new THREE.MeshStandardMaterial({ color: 0x33506b, roughness: 0.88 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.95, metalness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fd4e0, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.42
    });
    const conc = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95 });

    for (const p of POIS) {
      const y = p.groundY ?? 0;
      switch (p.kind) {
        case 'industrial': this._foundry(p, y, { M, rust, conc, brick }); break;
        case 'docks': this._harbor(p, y, { M, wood, rust, conc }); break;
        case 'glass': this._greenhouse(p, y, { M, glass, conc, wood }); break;
        case 'town': this._town(p, y, { wood, plaster, brick, roofRed, roofBlue }); break;
        case 'mountain': this._peak(p, y, { M, conc, rust }); break;
        case 'quarry': this._quarry(p, y, { M, conc, rust }); break;
        case 'lake': this._lake(p, y, { wood, M }); break;
        case 'scrap': this._boneyard(p, y, { rust, conc, M }); break;
        case 'ruin': this._chapel(p, y, { conc, plaster, M }); break;
        case 'farm': this._silos(p, y, { M, conc, rust, wood, roofRed }); break;
        case 'ridge': this._ridge(p, y, { M, conc, wood }); break;
        default: this._town(p, y, { wood, plaster, brick, roofRed, roofBlue });
      }
      // Every POI gets a name marker the map can read.
      p.labelY = y;
    }
    return { buildings: this.buildings, loot: this.lootSpots.length, chests: this.chestSpots.length };
  }

  // ------------------------------------------------------------ districts

  _foundry(p, y, m) {
    // Big shed, twin chimneys, gantry walkway, ore hoppers.
    this._box(46, 16, 30, p.x, y, p.z, m.conc);
    this._box(48, 0.7, 32, p.x, y + 16, p.z, m.rust);
    for (const cx of [-14, 14]) {
      this._box(7, 34, 7, p.x + cx, y + 16, p.z - 6, m.brick);
      this._box(8.4, 1.2, 8.4, p.x + cx, y + 50, p.z - 6, m.rust);
    }
    // Gantry between the chimneys.
    this._box(30, 0.5, 3, p.x, y + 26, p.z - 6, m.rust);
    this._box(30, 2.4, 0.3, p.x, y + 26.5, p.z - 7.4, m.rust, { collide: false });
    // Hoppers and pipes.
    for (let i = 0; i < 4; i++) {
      this._box(5, 7, 5, p.x - 18 + i * 12, y, p.z + 20, m.rust);
      this._loot(p.x - 18 + i * 12, y + 0.4, p.z + 24);
    }
    this._box(40, 1.2, 1.2, p.x, y + 12, p.z + 16, m.rust, { collide: false });
    for (let i = 0; i < 3; i++) this._chest(p.x - 14 + i * 14, y + 0.5, p.z);
    for (let i = 0; i < 6; i++) this._loot(p.x - 20 + i * 8, y + 0.5, p.z - 8);
    this._chest(p.x, y + 26.5, p.z - 6);
  }

  _harbor(p, y, m) {
    // Piers over the water, stacked containers, a crane.
    for (let i = 0; i < 3; i++) {
      const pz = p.z + 14 + i * 16;
      this._box(52, 0.6, 7, p.x, y + 0.6, pz, m.wood);
      for (let j = 0; j < 7; j++) {
        this._box(0.8, 4, 0.8, p.x - 22 + j * 7, y - 3.4, pz, m.wood, { collide: false });
      }
      this._loot(p.x - 16 + i * 12, y + 1.2, pz);
    }
    // Container stacks in three colours.
    const cols = [0x9c3f34, 0x2f6b7a, 0x6b7a2f];
    for (let i = 0; i < 9; i++) {
      const cm = new THREE.MeshStandardMaterial({ color: cols[i % 3], roughness: 0.85, metalness: 0.3 });
      const cx = p.x - 26 + (i % 3) * 20;
      const cz = p.z - 24 + Math.floor(i / 3) * 12;
      const stack = 1 + (i % 2);
      for (let s = 0; s < stack; s++) this._box(11, 5, 5.5, cx, y + s * 5, cz, cm);
      if (i % 3 === 0) this._chest(cx, y + stack * 5 + 0.4, cz);
      this._loot(cx + 6, y + 0.4, cz);
    }
    // Gantry crane.
    this._box(3, 26, 3, p.x - 30, y, p.z - 4, m.rust);
    this._box(3, 26, 3, p.x + 30, y, p.z - 4, m.rust);
    this._box(64, 2.2, 4, p.x, y + 26, p.z - 4, m.rust);
    this._chest(p.x, y + 28.5, p.z - 4);
    // Warehouse.
    this._box(30, 12, 22, p.x, y, p.z - 34, m.conc);
    this._box(32, 0.6, 24, p.x, y + 12, p.z - 34, m.rust);
    for (let i = 0; i < 4; i++) this._loot(p.x - 10 + i * 7, y + 0.5, p.z - 34);
    this._chest(p.x, y + 12.6, p.z - 34);
  }

  _greenhouse(p, y, m) {
    // Long glass halls on a concrete base with planting beds inside.
    for (let i = 0; i < 3; i++) {
      const gz = p.z - 18 + i * 18;
      this._box(40, 0.5, 14, p.x, y, gz, m.conc);
      this._box(40, 7, 0.3, p.x, y + 0.5, gz - 7, m.glass);
      this._box(40, 7, 0.3, p.x, y + 0.5, gz + 7, m.glass);
      this._box(0.3, 7, 14, p.x - 20, y + 0.5, gz, m.glass);
      this._box(0.3, 7, 14, p.x + 20, y + 0.5, gz, m.glass);
      this._box(41, 0.4, 15, p.x, y + 7.5, gz, m.glass);
      // Planting beds.
      for (let j = 0; j < 4; j++) {
        this._box(7, 1, 3, p.x - 14 + j * 9, y + 0.5, gz, m.wood);
      }
      this._loot(p.x - 12, y + 1, gz);
      this._loot(p.x + 12, y + 1, gz);
      if (i === 1) this._chest(p.x, y + 1, gz);
    }
    this._box(10, 14, 10, p.x + 26, y, p.z, m.conc);   // pump house
    this._chest(p.x + 26, y + 0.5, p.z);
  }

  _town(p, y, m) {
    // A ring of houses around a small square — the classic BR fight box.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const r = p.r * 0.55;
      const hx = p.x + Math.cos(a) * r;
      const hz = p.z + Math.sin(a) * r;
      const wide = 11 + (i % 3) * 3;
      const deep = 9 + (i % 2) * 3;
      const tall = i % 3 === 0 ? 9 : 5.5;   // some two-storey
      this._house(hx, y, hz, wide, deep, tall, {
        wall: i % 2 ? m.plaster : m.brick,
        roof: i % 2 ? m.roofRed : m.roofBlue,
        trim: m.wood
      }, { gable: i % 2 === 0 });
    }
    // Square with a water tower for high ground.
    this._box(3, 18, 3, p.x - 2, y, p.z - 2, m.wood);
    this._box(3, 18, 3, p.x + 2, y, p.z - 2, m.wood);
    this._box(3, 18, 3, p.x - 2, y, p.z + 2, m.wood);
    this._box(3, 18, 3, p.x + 2, y, p.z + 2, m.wood);
    this._box(11, 7, 11, p.x, y + 18, p.z, m.wood);
    this._chest(p.x, y + 25.5, p.z);
    for (let i = 0; i < 5; i++) {
      this._loot(p.x + Math.cos(i * 1.3) * 14, y + 0.4, p.z + Math.sin(i * 1.3) * 14);
    }
  }

  _peak(p, y, m) {
    // Observation post at altitude with a switchback ramp.
    this._box(20, 10, 20, p.x, y + 44, p.z, m.conc);
    this._box(22, 0.6, 22, p.x, y + 54, p.z, m.rust);
    this._box(6, 12, 6, p.x, y + 54, p.z, m.conc);
    this._chest(p.x, y + 44.5, p.z);
    this._chest(p.x, y + 54.6, p.z);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      this._box(14, 1, 5, p.x + Math.cos(a) * 16, y + 30 + i * 4, p.z + Math.sin(a) * 16, m.rust);
      this._loot(p.x + Math.cos(a) * 16, y + 31 + i * 4, p.z + Math.sin(a) * 16);
    }
  }

  _quarry(p, y, m) {
    // Terraced pit with machinery on the benches.
    for (let i = 0; i < 4; i++) {
      const r = p.r * (1 - i * 0.18);
      const ty = y - i * 5;
      const seg = 12;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        this._box(14, 5, 8, p.x + Math.cos(a) * r, ty - 5, p.z + Math.sin(a) * r, m.conc,
          { rotY: -a });
      }
      if (i % 2 === 0) this._chest(p.x + r * 0.7, ty - 4.5, p.z);
    }
    this._box(16, 9, 10, p.x, y - 20, p.z, m.rust);  // crusher
    this._chest(p.x, y - 19.5, p.z);
    for (let i = 0; i < 6; i++) {
      this._loot(p.x + Math.cos(i) * 20, y - 19.5, p.z + Math.sin(i) * 20);
    }
  }

  _lake(p, y, m) {
    // Boathouse and floating platforms on the shore.
    const sx = p.x + p.r * 0.85;
    this._box(14, 6, 11, sx, y, p.z, m.wood);
    this._box(16, 0.5, 13, sx, y + 6, p.z, m.wood);
    this._chest(sx, y + 0.5, p.z);
    for (let i = 0; i < 3; i++) {
      this._box(8, 0.5, 8, p.x + Math.cos(i * 2.1) * p.r * 0.5, y - 1.2, p.z + Math.sin(i * 2.1) * p.r * 0.5, m.wood);
      this._loot(p.x + Math.cos(i * 2.1) * p.r * 0.5, y - 0.6, p.z + Math.sin(i * 2.1) * p.r * 0.5);
    }
  }

  _boneyard(p, y, m) {
    // Wrecked hulls half-buried in scrap.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const hx = p.x + Math.cos(a) * p.r * 0.55;
      const hz = p.z + Math.sin(a) * p.r * 0.55;
      this._box(26, 8, 9, hx, y, hz, m.rust, { rotY: a * 1.4 });
      this._box(9, 5, 7, hx + 8, y + 8, hz, m.rust, { rotY: a * 1.4 });
      this._loot(hx, y + 0.5, hz);
      if (i % 2 === 0) this._chest(hx, y + 8.5, hz);
    }
    // Scrap piles.
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28;
      const r = Math.random() * p.r * 0.8;
      this._box(4 + Math.random() * 4, 2 + Math.random() * 3, 4, p.x + Math.cos(a) * r, y, p.z + Math.sin(a) * r, m.rust, { rotY: a });
    }
    this._chest(p.x, y + 0.5, p.z);
  }

  _chapel(p, y, m) {
    // Roofless ruin: nave walls, broken columns, a bell tower.
    this._box(20, 0.5, 34, p.x, y, p.z, m.conc);
    this._box(20, 9, 0.6, p.x, y + 0.5, p.z - 17, m.plaster);
    this._box(0.6, 9, 34, p.x - 10, y + 0.5, p.z, m.plaster);
    this._box(0.6, 9, 22, p.x + 10, y + 0.5, p.z - 6, m.plaster);
    for (let i = 0; i < 5; i++) {
      this._box(1.6, 5 + (i % 3) * 2, 1.6, p.x - 6 + i * 3, y + 0.5, p.z + 10, m.plaster);
    }
    this._box(9, 26, 9, p.x, y, p.z - 22, m.plaster);   // tower
    this._chest(p.x, y + 0.5, p.z - 22);
    this._chest(p.x, y + 0.5, p.z + 6);
    for (let i = 0; i < 4; i++) this._loot(p.x - 5 + i * 3.5, y + 0.5, p.z);
  }

  _silos(p, y, m) {
    // Four grain silos, a barn, and open fields.
    for (let i = 0; i < 4; i++) {
      const sx = p.x - 18 + (i % 2) * 36;
      const sz = p.z - 12 + Math.floor(i / 2) * 24;
      this._box(11, 26, 11, sx, y, sz, m.conc);
      this._box(12, 1.2, 12, sx, y + 26, sz, m.rust);
      this._loot(sx + 7, y + 0.4, sz);
      if (i % 2 === 0) this._chest(sx, y + 26.6, sz);
    }
    // Barn with a gable roof.
    this._house(p.x, y, p.z + 28, 24, 16, 10, {
      wall: m.wood, roof: m.roofRed, trim: m.rust
    }, { gable: true });
    this._chest(p.x, y + 0.5, p.z + 28);
  }

  _ridge(p, y, m) {
    // Watchtowers along a spine — the sniper POI.
    for (let i = 0; i < 3; i++) {
      const tz = p.z - 24 + i * 24;
      const th = 16 + i * 5;
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        this._box(1.4, th, 1.4, p.x + dx, y, tz + dz, m.wood);
      }
      this._box(11, 0.6, 11, p.x, y + th, tz, m.wood);
      this._box(11, 1.6, 0.4, p.x, y + th + 0.6, tz - 5.3, m.wood, { collide: false });
      this._box(11, 1.6, 0.4, p.x, y + th + 0.6, tz + 5.3, m.wood, { collide: false });
      this._chest(p.x, y + th + 0.7, tz);
      this._loot(p.x, y + 0.4, tz);
    }
    this._box(20, 8, 12, p.x - 18, y, p.z, m.conc);  // bunker
    this._chest(p.x - 18, y + 0.5, p.z);
  }
}
