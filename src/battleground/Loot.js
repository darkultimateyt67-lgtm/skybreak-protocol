import * as THREE from 'three';
import { WEAPON_DEFS } from '../weapons/WeaponSystem.js';

const _v = new THREE.Vector3();

/**
 * Loot — rarity tiers, ground spawns, chests and consumables.
 *
 * Rarity is a multiplier layered over the existing weapon stats rather than a
 * separate weapon list, so a Legendary Riptide is the same gun you already
 * know, hitting meaningfully harder. Chests roll better than floor loot;
 * supply drops roll better than chests.
 */

export const RARITY = [
  { id: 0, name: 'COMMON',    color: 0x9aa3ad, hex: '#9aa3ad', dmg: 1.00, reload: 1.00, weight: 42 },
  { id: 1, name: 'UNCOMMON',  color: 0x4ec95a, hex: '#4ec95a', dmg: 1.12, reload: 0.96, weight: 28 },
  { id: 2, name: 'RARE',      color: 0x3f8ef7, hex: '#3f8ef7', dmg: 1.26, reload: 0.92, weight: 18 },
  { id: 3, name: 'EPIC',      color: 0xa855f7, hex: '#a855f7', dmg: 1.42, reload: 0.87, weight: 9 },
  { id: 4, name: 'LEGENDARY', color: 0xf5a524, hex: '#f5a524', dmg: 1.60, reload: 0.82, weight: 3 }
];

/** Consumables that aren't weapons. */
export const CONSUMABLES = {
  shieldSmall: { id: 'shieldSmall', name: 'SMALL SHIELD', color: 0x4ec9ff, amount: 25, cap: 50, time: 2.0, kind: 'shield' },
  shieldBig:   { id: 'shieldBig',   name: 'SHIELD POTION', color: 0x3f8ef7, amount: 50, cap: 100, time: 4.0, kind: 'shield' },
  medkit:      { id: 'medkit',      name: 'MEDKIT',        color: 0xff6b6b, amount: 100, cap: 100, time: 6.0, kind: 'health' },
  bandage:     { id: 'bandage',     name: 'BANDAGE',       color: 0xffd2d2, amount: 15, cap: 75,  time: 2.5, kind: 'health' }
};

/** Weighted rarity roll, with a luck bias for chests and drops. */
export function rollRarity(luck = 0) {
  const table = RARITY.map((r, i) => ({ r, w: Math.max(0.2, r.weight * Math.pow(1.9, luck * i * 0.5)) }));
  const total = table.reduce((a, b) => a + b.w, 0);
  let roll = Math.random() * total;
  for (const t of table) {
    roll -= t.w;
    if (roll <= 0) return t.r;
  }
  return RARITY[0];
}

/** One pickup lying in the world. */
class Pickup {
  constructor(loot, kind, payload, pos, rarity) {
    this.loot = loot;
    this.kind = kind;              // 'weapon' | 'consumable' | 'ammo' | 'mats'
    this.payload = payload;
    this.rarity = rarity;
    this.position = pos.clone();
    this.taken = false;
    this._build();
  }

  _build() {
    const g = new THREE.Group();
    const col = this.rarity ? this.rarity.color : 0xbfc7d2;

    if (this.kind === 'weapon') {
      // A small stand-in gun silhouette so you can tell class at a glance.
      const body = new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.5, metalness: 0.8 });
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.62), body);
      b1.rotation.z = 0.25;
      g.add(b1);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), body);
      b2.position.set(0.02, -0.14, 0.16);
      g.add(b2);
    } else if (this.kind === 'consumable') {
      const m = new THREE.MeshStandardMaterial({
        color: this.payload.color, roughness: 0.3, metalness: 0.2,
        emissive: this.payload.color, emissiveIntensity: 0.5
      });
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.34, 10), m));
    } else if (this.kind === 'ammo') {
      const m = new THREE.MeshStandardMaterial({ color: 0x9b7a3a, roughness: 0.5, metalness: 0.8 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.22), m));
    } else {
      const m = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.32), m));
    }

    // Rarity beam so loot reads from across a room.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 2.4, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    beam.position.y = 1.1;
    g.add(beam);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 14),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    g.add(disc);

    g.position.copy(this.position);
    this.loot.game.scene.add(g);
    this.group = g;
  }

  update(t) {
    if (this.taken) return;
    this.group.position.y = this.position.y + 0.35 + Math.sin(t * 2 + this.position.x) * 0.08;
    this.group.rotation.y = t * 0.9;
  }

  take() {
    this.taken = true;
    this.loot.game.scene.remove(this.group);
  }

  /** Text the pickup prompt shows. */
  get label() {
    if (this.kind === 'weapon') return `${this.rarity.name} ${this.payload.name}`;
    if (this.kind === 'consumable') return this.payload.name;
    if (this.kind === 'ammo') return 'AMMO';
    return 'MATERIALS';
  }

  get labelColor() {
    return this.rarity ? this.rarity.hex : '#bfc7d2';
  }
}

/** A closed chest that pops open and sprays loot. */
class Chest {
  constructor(loot, pos) {
    this.loot = loot;
    this.position = pos.clone();
    this.opened = false;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a24, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({
      color: 0x2a1c0c, roughness: 0.4, metalness: 0.8,
      emissive: 0xf5a524, emissiveIntensity: 0.9
    });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.8), wood);
    base.position.y = 0.35;
    base.castShadow = true;
    g.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.3, 0.84), wood);
    lid.position.set(0, 0.85, -0.4);
    lid.geometry.translate(0, 0, 0.4);   // hinge at the back edge
    g.add(lid);
    this.lid = lid;
    for (const z of [-0.3, 0.3]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.75, 0.08), trim);
      band.position.set(0, 0.36, z);
      g.add(band);
    }
    const glow = new THREE.PointLight(0xf5a524, 6, 7, 2);
    glow.position.y = 1.1;
    g.add(glow);
    this.glow = glow;
    g.position.copy(pos);
    loot.game.scene.add(g);
    this.group = g;
  }

  update(t) {
    if (this.opened) return;
    this.glow.intensity = 4.5 + Math.sin(t * 3 + this.position.x) * 1.8;
  }

  open() {
    if (this.opened) return [];
    this.opened = true;
    this.glow.intensity = 0;
    // Lid swings back.
    const start = performance.now();
    const anim = () => {
      const k = Math.min(1, (performance.now() - start) / 420);
      this.lid.rotation.x = -k * 2.0;
      if (k < 1) requestAnimationFrame(anim);
    };
    anim();
    return this.loot.rollChestContents(this.position);
  }
}

export class Loot {
  constructor(game) {
    this.game = game;
    this.pickups = [];
    this.chests = [];
    this._t = 0;
  }

  clear() {
    for (const p of this.pickups) if (!p.taken) this.game.scene.remove(p.group);
    for (const c of this.chests) this.game.scene.remove(c.group);
    this.pickups = [];
    this.chests = [];
  }

  /** Weapons that can appear as loot (the blade is a tool, not a drop). */
  get pool() {
    return WEAPON_DEFS.filter((w) => !w.melee);
  }

  spawnWeapon(pos, luck = 0) {
    const def = this.pool[Math.floor(Math.random() * this.pool.length)];
    const rarity = rollRarity(luck);
    const p = new Pickup(this, 'weapon', def, pos, rarity);
    this.pickups.push(p);
    return p;
  }

  spawnConsumable(pos, key) {
    const keys = Object.keys(CONSUMABLES);
    const c = CONSUMABLES[key || keys[Math.floor(Math.random() * keys.length)]];
    const p = new Pickup(this, 'consumable', c, pos, null);
    this.pickups.push(p);
    return p;
  }

  spawnAmmo(pos) {
    const p = new Pickup(this, 'ammo', { amount: 40 + Math.floor(Math.random() * 60) }, pos, null);
    this.pickups.push(p);
    return p;
  }

  spawnMats(pos) {
    const p = new Pickup(this, 'mats', { amount: 40 + Math.floor(Math.random() * 60) }, pos, null);
    this.pickups.push(p);
    return p;
  }

  /** Contents of an opened chest: a weapon plus support items. */
  rollChestContents(pos) {
    const made = [];
    const ring = (i, n, r) => {
      const a = (i / n) * Math.PI * 2 + Math.random();
      return _v.set(pos.x + Math.cos(a) * r, pos.y + 0.1, pos.z + Math.sin(a) * r).clone();
    };
    made.push(this.spawnWeapon(ring(0, 4, 1.1), 1));
    if (Math.random() < 0.6) made.push(this.spawnWeapon(ring(1, 4, 1.1), 0.6));
    made.push(this.spawnConsumable(ring(2, 4, 1.1)));
    made.push(this.spawnAmmo(ring(3, 4, 1.1)));
    if (Math.random() < 0.5) made.push(this.spawnMats(ring(4, 5, 1.3)));
    this.game.audio.chestOpen?.();
    return made;
  }

  /**
   * Fill the island: chests at their anchors, floor loot at theirs, weighted
   * by each POI's loot rating.
   */
  populate(world) {
    this.clear();
    const chestSpots = world.chestSpots || [];
    const lootSpots = world.lootSpots || [];

    for (const s of chestSpots) {
      // Not every anchor spawns — variety between matches.
      if (Math.random() > 0.82) continue;
      this.chests.push(new Chest(this, _v.set(s.x, s.y, s.z).clone()));
    }
    for (const s of lootSpots) {
      if (Math.random() > 0.78) continue;
      const roll = Math.random();
      const pos = _v.set(s.x + (Math.random() - 0.5) * 2, s.y + 0.1, s.z + (Math.random() - 0.5) * 2).clone();
      if (roll < 0.42) this.spawnWeapon(pos, 0);
      else if (roll < 0.68) this.spawnConsumable(pos);
      else if (roll < 0.88) this.spawnAmmo(pos);
      else this.spawnMats(pos);
    }
    return { chests: this.chests.length, pickups: this.pickups.length };
  }

  /** Nearest interactable within range of a position, or null. */
  nearest(pos, range = 2.6) {
    let best = null;
    let bestD = range * range;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const d = p.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = { type: 'pickup', item: p }; }
    }
    for (const c of this.chests) {
      if (c.opened) continue;
      const d = c.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = { type: 'chest', item: c }; }
    }
    return best;
  }

  update(dt) {
    this._t += dt;
    for (const p of this.pickups) p.update(this._t);
    for (const c of this.chests) c.update(this._t);
  }
}
