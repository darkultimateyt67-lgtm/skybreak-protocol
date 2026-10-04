import * as THREE from 'three';
import { OPERATORS } from '../player/Player.js';
import { WeaponTraits } from './WeaponTraits.js';
import { ARSENAL } from './Arsenal.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();

const DEG = Math.PI / 180;

/**
 * Weapon definitions — pure data. `price` of 0 means part of the starting
 * loadout; everything else is bought from the supply uplink with credits.
 */
export const WEAPON_DEFS = [
  {
    id: 'riptide', name: 'VX-9 RIPTIDE', kind: 'ar', price: 500,
    desc: 'Full-auto pulse rifle. The all-rounder.',
    auto: true, damage: 26, headMult: 1.8, rpm: 690, mag: 30, reserve: 180,
    reloadTime: 1.9, spreadHip: 1.7, spreadAds: 0.32, recoil: 0.55, recoilRand: 0.35,
    adsFov: 0.78, pellets: 1, falloff: [22, 55, 0.6], tracer: 0x37e6ff, accent: 0x37e6ff
  },
  {
    id: 'wasp', name: 'WASP P-9', kind: 'pistol', price: 200,
    desc: 'Sidearm. Never jams, never impresses.',
    auto: false, damage: 30, headMult: 1.9, rpm: 330, mag: 12, reserve: 96,
    reloadTime: 1.4, spreadHip: 1.5, spreadAds: 0.4, recoil: 0.9, recoilRand: 0.3,
    adsFov: 0.86, pellets: 1, falloff: [16, 40, 0.5], tracer: 0xffe07d, accent: 0xffe07d
  },
  {
    id: 'blade', name: 'ARC BLADE', kind: 'melee', price: 450, melee: true,
    desc: 'Charged mono-edge. Silent, no ammo, ends arguments inside 3 m.',
    auto: false, damage: 95, headMult: 1.3, rpm: 88, mag: Infinity, reserve: Infinity,
    reloadTime: 1, spreadHip: 0.4, spreadAds: 0.4, recoil: 0.3, recoilRand: 0.2,
    adsFov: 0.92, pellets: 1, falloff: [3, 4, 1], tracer: 0x37e6ff, accent: 0x37e6ff,
    range: 2.9, arc: 0.75
  },
  {
    id: 'kestrel', name: 'KESTREL SMG-4', kind: 'smg', price: 600,
    desc: 'Hyper-cyclic SMG. Made for slides and wall runs.',
    auto: true, damage: 18, headMult: 1.7, rpm: 950, mag: 36, reserve: 216,
    reloadTime: 1.7, spreadHip: 2.2, spreadAds: 0.6, recoil: 0.4, recoilRand: 0.45,
    adsFov: 0.84, pellets: 1, falloff: [14, 34, 0.5], tracer: 0xffb35d, accent: 0xffb35d
  },
  {
    id: 'mauler', name: 'MAULER SG-8', kind: 'sg', price: 800,
    desc: '8-pellet scatter cannon. Brutal inside 15 m.',
    auto: false, damage: 13, headMult: 1.5, rpm: 78, mag: 6, reserve: 42,
    reloadTime: 2.3, spreadHip: 4.6, spreadAds: 3.2, recoil: 2.6, recoilRand: 0.8,
    adsFov: 0.88, pellets: 8, falloff: [10, 26, 0.3], tracer: 0xff9b3d, accent: 0xff9b3d
  },
  {
    id: 'lance', name: 'LANCE DMR-50', kind: 'dmr', price: 1200,
    desc: 'High-zoom marksman rifle. One headshot, one kill.',
    auto: false, damage: 88, headMult: 2.0, rpm: 52, mag: 5, reserve: 30,
    reloadTime: 2.5, spreadHip: 2.3, spreadAds: 0.04, recoil: 2.1, recoilRand: 0.5,
    adsFov: 0.45, pellets: 1, falloff: [80, 120, 0.85], tracer: 0xb08cff, accent: 0xb08cff
  }
];

/** Build a low-poly sci-fi viewmodel; returns the magazine part for reload anim. */
export function buildViewmodel(def) {
  const group = new THREE.Group();
  // Finish drives the body colour and how the metal responds to light, so
  // an arctic nickel rifle and a matte olive one read as different objects.
  const fin = def.finish || { body: 0x252b38, metal: 0.85, rough: 0.35 };
  const gunmetal = new THREE.MeshStandardMaterial({
    color: fin.body, roughness: fin.rough, metalness: fin.metal
  });
  const dark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(fin.body).multiplyScalar(0.55), roughness: fin.rough + 0.15, metalness: fin.metal * 0.8
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x0a0f14, emissive: def.accent, emissiveIntensity: 1.3, roughness: 0.4
  });

  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };

  // Extra materials for the detail pass.
  const polymer = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.82, metalness: 0.12 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x585f6b, roughness: 0.22, metalness: 0.98 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.3, metalness: 0.95 });
  const lens = new THREE.MeshStandardMaterial({
    color: 0x04141c, emissive: def.accent, emissiveIntensity: 2.6,
    roughness: 0.1, metalness: 0.4
  });

  /** A run of picatinny rail teeth. */
  const rail = (x, y, z, length, teeth) => {
    part(new THREE.BoxGeometry(0.03, 0.012, length), steel, x, y, z);
    const step = length / teeth;
    for (let i = 0; i < teeth; i++) {
      part(new THREE.BoxGeometry(0.036, 0.016, step * 0.5), steel,
        x, y + 0.012, z - length / 2 + step * (i + 0.5));
    }
  };

  /** Cooling vents cut along a shroud or handguard. */
  const vents = (x, y, z, count, spacing, r = 0.008) => {
    for (let i = 0; i < count; i++) {
      part(new THREE.CylinderGeometry(r, r, 0.05, 6), dark,
        x, y, z - i * spacing, 0, 0, Math.PI / 2);
    }
  };

  const kind = def.kind;
  // Catalogue weapons carry their own length; the fixed starter guns fall
  // back to a per-class default.
  const len = def.len ?? (kind === 'sg' ? 0.52 : kind === 'dmr' ? 0.78 : kind === 'pistol' ? 0.3 : kind === 'smg' ? 0.5 : 0.62);
  const P = def.parts || {};
  let mag;

  if (kind === 'melee') {
    // ARC BLADE: wrapped handle, crossguard, mono-edge with a charged spine.
    part(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 8), polymer, 0, -0.06, 0.04, 0.35);
    // Grip wrap rings.
    for (let i = 0; i < 5; i++) {
      part(new THREE.TorusGeometry(0.025, 0.004, 5, 10), dark,
        0, -0.11 + i * 0.028, 0.055 - i * 0.009, 0.35 + Math.PI / 2);
    }
    part(new THREE.BoxGeometry(0.11, 0.028, 0.055), steel, 0, 0.03, 0.02);   // crossguard
    part(new THREE.BoxGeometry(0.03, 0.03, 0.03), lens, 0, 0.03, 0.055);     // charge cell
    part(new THREE.BoxGeometry(0.016, 0.34, 0.07), steel, 0, 0.2, -0.05, 0.18);
    part(new THREE.BoxGeometry(0.019, 0.1, 0.05), steel, 0, 0.09, -0.02, 0.18); // ricasso
    part(new THREE.BoxGeometry(0.008, 0.34, 0.022), lens, 0, 0.2, -0.093, 0.18); // edge
    part(new THREE.BoxGeometry(0.004, 0.3, 0.012), lens, 0, 0.2, -0.012, 0.18);  // fuller
    part(new THREE.SphereGeometry(0.018, 8, 6), steel, 0, -0.16, 0.075);     // pommel
    mag = part(new THREE.BoxGeometry(0.001, 0.001, 0.001), dark, 0, -0.2, 0);
    mag.visible = false;
  } else {
    // ---- Lower receiver, grip, trigger group -----------------------------
    part(new THREE.BoxGeometry(0.072, 0.075, len * 0.42), polymer, 0, -0.032, -len * 0.1);
    const grip = part(new THREE.BoxGeometry(0.05, 0.14, 0.062), polymer, 0, -0.105, 0.022, 0.3);
    // Grip stippling.
    for (let i = 0; i < 4; i++) {
      part(new THREE.BoxGeometry(0.053, 0.008, 0.012), dark, 0, -0.07 - i * 0.026, 0.045 - i * 0.008, 0.3);
    }
    part(new THREE.BoxGeometry(0.014, 0.03, 0.012), steel, 0, -0.05, -0.028);          // trigger
    part(new THREE.TorusGeometry(0.028, 0.006, 5, 10), polymer, 0, -0.048, -0.026, 0, Math.PI / 2, 0); // guard
    part(new THREE.BoxGeometry(0.02, 0.014, 0.014), steel, 0.042, -0.012, -0.02);      // mag release
    // Fire selector — a real lever with a detent plate.
    part(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 8), steel, -0.042, -0.012, -0.005, 0, 0, Math.PI / 2);
    part(new THREE.BoxGeometry(0.01, 0.026, 0.008), steel, -0.048, -0.005, -0.005, 0, 0, 0.5);

    // ---- Upper receiver, rail, ejection port -----------------------------
    part(new THREE.BoxGeometry(0.075, 0.062, len * 0.55), gunmetal, 0, 0.024, -len * 0.18);
    rail(0, 0.058, -len * 0.2, len * 0.5, Math.round(len * 22));
    // Ejection port: a recessed bay with a dust cover and a brass round inside.
    part(new THREE.BoxGeometry(0.014, 0.03, 0.07), dark, 0.038, 0.02, -len * 0.06);
    part(new THREE.BoxGeometry(0.006, 0.032, 0.072), gunmetal, 0.045, 0.022, -len * 0.06, 0, 0, 0.15);
    part(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6), brass, 0.034, 0.02, -len * 0.06, 0, 0, Math.PI / 2);
    // Brass deflector + forward assist.
    part(new THREE.BoxGeometry(0.016, 0.024, 0.03), gunmetal, 0.036, 0.038, 0.01, 0, 0, -0.3);
    part(new THREE.CylinderGeometry(0.009, 0.009, 0.022, 6), steel, 0.032, 0.008, 0.03, 0, 0, Math.PI / 2);
    // Ammo counter — glowing digits panel on the left flank.
    part(new THREE.BoxGeometry(0.008, 0.026, 0.05), dark, -0.04, 0.022, -len * 0.04);
    part(new THREE.BoxGeometry(0.003, 0.02, 0.042), lens, -0.045, 0.022, -len * 0.04);

    // ---- Magazine: body, floor plate, witness holes ----------------------
    mag = part(new THREE.BoxGeometry(0.048, 0.15, 0.07), polymer, 0, -0.115, -len * 0.16, -0.18);
    part(new THREE.BoxGeometry(0.054, 0.014, 0.076), dark, 0, -0.078, -0.012, 0);
    for (let i = 0; i < 3; i++) {
      part(new THREE.BoxGeometry(0.003, 0.008, 0.02), lens, -0.025, -0.03 - i * 0.032, 0.004 + i * 0.006);
    }

    // ---- Barrel, gas system, handguard, muzzle --------------------------
    part(new THREE.CylinderGeometry(0.014, 0.016, len * 0.66, 10), steel, 0, 0.012, -len * 0.62, Math.PI / 2);
    // Handguard shroud with vent slots down both flanks.
    part(new THREE.BoxGeometry(0.056, 0.05, len * 0.4), polymer, 0, 0.012, -len * 0.5);
    vents(0.03, 0.012, -len * 0.38, 5, len * 0.06);
    vents(-0.03, 0.012, -len * 0.38, 5, len * 0.06);
    // Gas block + tube.
    part(new THREE.BoxGeometry(0.03, 0.03, 0.036), steel, 0, 0.036, -len * 0.42);
    part(new THREE.CylinderGeometry(0.005, 0.005, len * 0.3, 6), steel, 0, 0.042, -len * 0.3, Math.PI / 2);
    // Bottom accessory rail + angled foregrip.
    rail(0, -0.02, -len * 0.5, len * 0.3, Math.round(len * 12));
    part(new THREE.BoxGeometry(0.03, 0.07, 0.04), polymer, 0, -0.05, -len * 0.44, 0.35);
    // Muzzle brake with cut ports.
    part(new THREE.CylinderGeometry(0.021, 0.024, 0.06, 10), steel, 0, 0.012, -len * 0.93, Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      part(new THREE.BoxGeometry(0.05, 0.006, 0.008), dark, 0, 0.03, -len * 0.93 + 0.018 - i * 0.016);
    }
    // Sling loops.
    part(new THREE.TorusGeometry(0.012, 0.003, 4, 8), steel, -0.036, -0.005, -len * 0.36, 0, Math.PI / 2, 0);
    part(new THREE.TorusGeometry(0.012, 0.003, 4, 8), steel, -0.03, -0.01, 0.13, 0, Math.PI / 2, 0);

    // ---- Frame-specific parts: this is what makes 123 guns look distinct --
    if (P.mag === 'drum') {
      // Drum magazine replaces the box mag's read.
      part(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14), dark, 0, -0.13, -len * 0.16, 0, 0, Math.PI / 2);
      part(new THREE.TorusGeometry(0.06, 0.012, 6, 14), steel, 0, -0.13, -len * 0.16, 0, 0, Math.PI / 2);
    } else if (P.mag === 'cell') {
      // Energy cell: a glowing block instead of brass.
      part(new THREE.BoxGeometry(0.056, 0.1, 0.06), dark, 0, -0.1, -len * 0.14);
      part(new THREE.BoxGeometry(0.03, 0.07, 0.035), lens, 0, -0.1, -len * 0.14 + 0.02);
    } else if (P.mag === 'short') {
      part(new THREE.BoxGeometry(0.046, 0.04, 0.06), dark, 0, -0.06, -len * 0.16);
    }

    if (P.barrel === 'long') {
      part(new THREE.CylinderGeometry(0.012, 0.013, len * 0.34, 10), steel, 0, 0.012, -len * 1.02, Math.PI / 2);
    } else if (P.barrel === 'heavy') {
      part(new THREE.CylinderGeometry(0.026, 0.028, len * 0.3, 10), steel, 0, 0.012, -len * 0.86, Math.PI / 2);
      part(new THREE.BoxGeometry(0.05, 0.02, 0.16), dark, 0, 0.046, -len * 0.72);   // heat shield
    } else if (P.barrel === 'coil') {
      // Accelerator coils down the barrel — the prototype look.
      for (let i = 0; i < 4; i++) {
        part(new THREE.TorusGeometry(0.028, 0.007, 6, 12), lens, 0, 0.012, -len * (0.62 + i * 0.1), 0, Math.PI / 2, 0);
      }
    } else if (P.barrel === 'stub') {
      part(new THREE.CylinderGeometry(0.02, 0.022, 0.05, 10), steel, 0, 0.012, -len * 0.76, Math.PI / 2);
    }

    if (P.stock === 'folding') {
      part(new THREE.BoxGeometry(0.03, 0.06, 0.12), polymer, 0.05, -0.01, 0.1, 0, 0.5, 0);
    } else if (P.stock === 'skeletal') {
      part(new THREE.BoxGeometry(0.045, 0.014, 0.2), polymer, 0, 0.03, 0.16);
      part(new THREE.BoxGeometry(0.045, 0.014, 0.2), polymer, 0, -0.05, 0.16);
      part(new THREE.BoxGeometry(0.045, 0.09, 0.02), polymer, 0, -0.01, 0.25);
    } else if (P.stock === 'match') {
      part(new THREE.BoxGeometry(0.06, 0.11, 0.2), polymer, 0, -0.01, 0.18);
      part(new THREE.BoxGeometry(0.05, 0.05, 0.09), polymer, 0, 0.05, 0.12);        // adjustable comb
      part(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), steel, 0, 0.08, 0.14);
    } else if (P.stock === 'heavy') {
      part(new THREE.BoxGeometry(0.07, 0.12, 0.22), polymer, 0, -0.02, 0.19);
      part(new THREE.BoxGeometry(0.14, 0.02, 0.1), steel, 0, -0.09, -len * 0.5, 0.2);  // bipod rail
    }

    // ---- Optics ----------------------------------------------------------
    if (P.optic === 'scope' || kind === 'dmr') {
      // Long-range scope: tube, bells, turrets, glowing objective.
      part(new THREE.CylinderGeometry(0.028, 0.028, 0.24, 12), dark, 0, 0.098, -0.14, Math.PI / 2);
      part(new THREE.CylinderGeometry(0.036, 0.03, 0.05, 12), dark, 0, 0.098, -0.27, Math.PI / 2);
      part(new THREE.CylinderGeometry(0.032, 0.028, 0.04, 12), dark, 0, 0.098, -0.02, Math.PI / 2);
      part(new THREE.CircleGeometry(0.03, 12), lens, 0, 0.098, -0.293, 0, Math.PI, 0);
      part(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 8), steel, 0, 0.13, -0.14);            // elevation turret
      part(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 8), steel, 0.03, 0.098, -0.14, 0, 0, Math.PI / 2); // windage
      part(new THREE.BoxGeometry(0.03, 0.03, 0.024), steel, 0, 0.072, -0.06);                     // rings
      part(new THREE.BoxGeometry(0.03, 0.03, 0.024), steel, 0, 0.072, -0.21);
    } else if (P.optic === 'reflex') {
      // Small open reflex sight — the compact frame's signature.
      part(new THREE.BoxGeometry(0.034, 0.028, 0.012), dark, 0, 0.078, -0.07);
      part(new THREE.BoxGeometry(0.028, 0.024, 0.003), lens, 0, 0.08, -0.062);
      part(new THREE.BoxGeometry(0.006, 0.006, 0.006), lens, 0, 0.066, -0.076);
    } else if (P.optic === 'smart') {
      // Prototype smart optic: boxy housing with a data strip.
      part(new THREE.BoxGeometry(0.05, 0.046, 0.075), dark, 0, 0.086, -0.085);
      part(new THREE.BoxGeometry(0.038, 0.032, 0.004), lens, 0, 0.088, -0.05);
      part(new THREE.BoxGeometry(0.03, 0.006, 0.05), lens, 0, 0.112, -0.085);
      part(new THREE.BoxGeometry(0.012, 0.02, 0.012), steel, 0.03, 0.086, -0.085);
    } else if (kind === 'pistol') {
      part(new THREE.BoxGeometry(0.01, 0.016, 0.01), steel, 0, 0.062, -0.11);   // front post
      part(new THREE.BoxGeometry(0.026, 0.014, 0.008), steel, 0, 0.062, 0.02);  // rear notch
      part(new THREE.BoxGeometry(0.006, 0.008, 0.006), lens, 0, 0.066, -0.11);  // tritium dot
    } else {
      // Holographic sight: hooded housing with a floating reticle pane.
      part(new THREE.BoxGeometry(0.042, 0.04, 0.06), dark, 0, 0.082, -0.09);
      part(new THREE.BoxGeometry(0.032, 0.03, 0.004), lens, 0, 0.084, -0.062);
      part(new THREE.BoxGeometry(0.046, 0.006, 0.05), dark, 0, 0.104, -0.09);   // hood
      part(new THREE.BoxGeometry(0.006, 0.006, 0.006), lens, 0, 0.084, -0.12);  // emitter
      // Folded backup iron sight behind it.
      part(new THREE.BoxGeometry(0.02, 0.014, 0.006), steel, 0, 0.068, 0.0, -0.7);
    }

    // ---- Per-weapon furniture ---------------------------------------------
    // Family, frame and finish already differ for every one of the 123 guns,
    // but frames are shared 12-ish ways, so two rifles on the same frame read
    // as the same gun in a different colour. `variant` hangs distinct hardware
    // off each one: what you notice on a weapon is its silhouette, and that
    // lives in the muzzle, the handguard and what's bolted to the rails.
    const V = def.variant ?? 0;
    if (V === 0) {
      // Angled foregrip.
      part(new THREE.BoxGeometry(0.026, 0.07, 0.05), polymer, 0, -0.062, -len * 0.5, 0.55);
    } else if (V === 1) {
      // Muzzle brake with side ports.
      part(new THREE.CylinderGeometry(0.024, 0.026, 0.07, 8), steel, 0, 0.012, -len * 0.94, Math.PI / 2);
      part(new THREE.BoxGeometry(0.056, 0.008, 0.03), dark, 0, 0.012, -len * 0.94);
      part(new THREE.BoxGeometry(0.056, 0.008, 0.03), dark, 0, 0.03, -len * 0.94);
    } else if (V === 2) {
      // Suppressor.
      part(new THREE.CylinderGeometry(0.03, 0.03, len * 0.26, 12), dark, 0, 0.012, -len * 0.96, Math.PI / 2);
      part(new THREE.TorusGeometry(0.03, 0.004, 6, 12), steel, 0, 0.012, -len * 0.85, 0, Math.PI / 2, 0);
    } else if (V === 3) {
      // Vertical grip plus a laser box.
      part(new THREE.CylinderGeometry(0.018, 0.02, 0.09, 8), polymer, 0, -0.075, -len * 0.48);
      part(new THREE.BoxGeometry(0.026, 0.022, 0.05), dark, 0.036, -0.012, -len * 0.56);
      part(new THREE.BoxGeometry(0.008, 0.008, 0.006), lens, 0.036, -0.012, -len * 0.6);
    } else if (V === 4) {
      // Vented handguard shroud.
      for (let i = 0; i < 3; i++) {
        part(new THREE.BoxGeometry(0.062, 0.006, 0.03), dark, 0, 0.044, -len * (0.44 + i * 0.11));
      }
      part(new THREE.BoxGeometry(0.05, 0.05, len * 0.3), polymer, 0, 0.004, -len * 0.55);
    } else {
      // Underbarrel canister and a rail cover.
      part(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 10), dark, 0, -0.056, -len * 0.52, Math.PI / 2);
      part(new THREE.BoxGeometry(0.03, 0.012, 0.14), polymer, 0, 0.042, -len * 0.36);
    }

    // ---- Class-specific furniture ----------------------------------------
    if (kind === 'sg') {
      // Pump action: tube magazine, forend, action bars.
      part(new THREE.CylinderGeometry(0.019, 0.019, 0.4, 10), steel, 0, -0.03, -0.4, Math.PI / 2);
      part(new THREE.BoxGeometry(0.05, 0.045, 0.13), polymer, 0, -0.03, -0.34);
      for (let i = 0; i < 5; i++) {
        part(new THREE.BoxGeometry(0.054, 0.006, 0.012), dark, 0, -0.03, -0.29 - i * 0.024);
      }
      part(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), steel, 0.022, -0.012, -0.32, Math.PI / 2);
    }
    if (kind === 'smg') {
      part(new THREE.BoxGeometry(0.03, 0.05, 0.1), polymer, 0, -0.01, -len * 0.34, 0.2); // vertical grip
      part(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 10), steel, 0, 0.012, -len * 0.86, Math.PI / 2); // suppressor
    }
    if (kind !== 'pistol') {
      // Collapsible stock: buffer tube, cheek riser, rubber butt pad.
      part(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 10), gunmetal, 0, -0.01, 0.11, Math.PI / 2);
      part(new THREE.BoxGeometry(0.055, 0.075, 0.1), polymer, 0, -0.015, 0.16);
      part(new THREE.BoxGeometry(0.05, 0.03, 0.07), polymer, 0, 0.035, 0.14);   // cheek riser
      part(new THREE.BoxGeometry(0.058, 0.09, 0.014), dark, 0, -0.015, 0.213);  // butt pad
      for (let i = 0; i < 3; i++) {
        part(new THREE.BoxGeometry(0.06, 0.006, 0.016), dark, 0, 0.01 - i * 0.02, 0.216);
      }
    }
  }

  // Charging handle — slides back during the final reload phase.
  const charge = part(new THREE.BoxGeometry(0.05, 0.018, 0.05), steel, 0.035, 0.05, 0.022);
  part(new THREE.BoxGeometry(0.022, 0.03, 0.014), steel, 0.052, 0.05, 0.022); // latch

  // Operator hands: gloved palm + thumb, one material so runs can re-tint.
  const glove = new THREE.MeshStandardMaterial({ color: 0x2d4a56, roughness: 0.85 });
  const wrap = new THREE.MeshStandardMaterial({ color: 0x191d24, roughness: 0.9 });
  const makeHand = (x, y, z, ry) => {
    const hand = new THREE.Group();
    hand.position.set(x, y, z);
    hand.rotation.y = ry;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.1), glove);
    palm.frustumCulled = false;
    hand.add(palm);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), glove);
    thumb.position.set(0.03, 0.015, -0.02);
    thumb.frustumCulled = false;
    hand.add(thumb);
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.06), wrap);
    wrist.position.set(0, -0.01, 0.07);
    wrist.frustumCulled = false;
    hand.add(wrist);
    // Forearm sleeve reaching back toward the camera — arms, not floating gloves.
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.065, 0.2), glove);
    forearm.position.set(0.01, -0.015, 0.19);
    forearm.rotation.x = -0.12;
    forearm.frustumCulled = false;
    hand.add(forearm);
    group.add(hand);
    return hand;
  };
  const handR = makeHand(0.005, -0.1, 0.045, 0);
  const handL = makeHand(-0.01, -0.055, -len * 0.42, 0.25);
  if (kind === 'pistol') handL.position.set(-0.02, -0.09, 0.02);
  if (kind === 'melee') handL.position.set(-0.16, -0.13, -0.06); // off-hand guard

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -len * 0.95);
  group.add(muzzle);

  foldRigidParts(group, new Set([mag, charge]));
  return { group, muzzle, mag, charge, handL, gloveMat: glove };
}

/**
 * Merge the gun's rigid parts into one mesh per material.
 *
 * A viewmodel is ~90 small boxes and cylinders, every one its own draw call,
 * every frame you have a gun out. Only the magazine and the charging handle
 * move relative to the gun (the hands are groups and stay as they are), so the
 * rest is baked in the gun's own space. Materials are kept, so the glove tint
 * and any glow still work.
 */
function foldRigidParts(group, moving) {
  const byMat = new Map();
  for (const c of group.children) {
    if (!c.isMesh || moving.has(c) || !c.visible) continue;
    const m = c.material;
    if (!m || Array.isArray(m) || m.transparent) continue;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(c);
  }
  for (const [mat, parts] of byMat) {
    if (parts.length < 2) continue;
    let nv = 0, ni = 0;
    for (const p of parts) {
      const g = p.geometry;
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const idx = new Uint32Array(ni);
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const p of parts) {
      p.updateMatrix();
      nm.getNormalMatrix(p.matrix);
      const g = p.geometry;
      const P = g.attributes.position, N = g.attributes.normal, T = g.attributes.uv;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(p.matrix);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        if (N) {
          v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
          nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
        }
        if (T) { uv[(vo + i) * 2] = T.getX(i); uv[(vo + i) * 2 + 1] = T.getY(i); }
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
      else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
      vo += P.count;
      group.remove(p);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const merged = new THREE.Mesh(geo, mat);
    merged.frustumCulled = false;
    group.add(merged);
  }
}

/** Runtime state for one carried weapon. */
class WeaponInstance {
  constructor(def) {
    this.def = def;
    this.owned = false; // set from the operator's loadout at reset()
    this.mag = def.mag;
    this.reserve = def.reserve;
    this.cooldown = 0;
    this.reloading = 0;   // remaining reload time, 0 = not reloading
    this._rlStage = 0;    // reload sfx staging
    const built = buildViewmodel(def);
    this.model = built.group;
    this.muzzle = built.muzzle;
    this.magPart = built.mag;
    this.magBase = built.mag.position.clone();
    this.chargePart = built.charge;
    this.chargeBase = built.charge.position.clone();
    this.handL = built.handL;
    this.handLBase = built.handL.position.clone();
    this.gloveMat = built.gloveMat;
    this.model.visible = false;
  }
}

/**
 * WeaponSystem — carries the loadout, drives the viewmodel (sway, bob, ADS,
 * recoil, staged reload — all procedural) and resolves shots against the
 * world and enemy hitboxes. Weapons are bought with credits via buy().
 */
export class WeaponSystem {
  constructor(game) {
    this.game = game;
    // The six fixed weapons plus every catalogue gun. Only the ones in your
    // loadout are owned; the rest are built lazily on first equip so 123
    // viewmodels aren't constructed at boot.
    this.weapons = WEAPON_DEFS.map((d) => new WeaponInstance(d));
    this._catalogue = new Map();
    this.index = 0;
    this.adsT = 0;
    this.switchT = 1;
    this._pendingIndex = -1;
    this._swayX = 0;
    this._swayY = 0;
    this._kick = 0;

    // Runtime for weapon special features (explosive, chain, charge, ...).
    this.traits = new WeaponTraits(game);

    this.rig = new THREE.Group();
    game.camera.add(this.rig);
    for (const w of this.weapons) this.rig.add(w.model);
    this.weapons[0].model.visible = true;

    this.hipPos = new THREE.Vector3(0.26, -0.24, -0.5);
    this.adsPos = new THREE.Vector3(0, -0.155, -0.34);
  }

  get current() { return this.weapons[this.index]; }
  get owned() { return this.weapons.filter((w) => w.owned); }

  /**
   * Add a catalogue weapon to the rack, building its viewmodel on demand.
   * Returns the instance's index.
   */
  addCatalogue(def) {
    if (this._catalogue.has(def.id)) return this._catalogue.get(def.id);
    const inst = new WeaponInstance(def);
    this.rig.add(inst.model);
    inst.gloveMat.color.setHex(this.game.operator.color);
    this.weapons.push(inst);
    const idx = this.weapons.length - 1;
    this._catalogue.set(def.id, idx);
    return idx;
  }

  reset() {
    const op = this.game.operator;
    const loadout = op.loadout || ['riptide', 'wasp'];
    for (const w of this.weapons) {
      w.owned = loadout.includes(w.def.id);
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
      w.cooldown = 0;
      w.reloading = 0;
      w.model.visible = false;
      w.magPart.position.copy(w.magBase);
      w.handL.position.copy(w.handLBase);
      w.gloveMat.color.setHex(op.color);
    }
    // Skirmish lets you carry any gun from the 123-weapon armory.
    let primaryIdx = -1;
    const pick = this.game.settings.skirmishGun;
    if (this.game.settings.mode === 'skirmish' && pick) {
      const def = ARSENAL.find((d) => d.id === pick);
      if (def) {
        primaryIdx = this.addCatalogue(def);
        const inst = this.weapons[primaryIdx];
        inst.owned = true;
        inst.mag = def.mag;
        inst.reserve = def.reserve;
        inst.model.visible = false;
        inst.gloveMat.color.setHex(op.color);
      }
    }
    if (primaryIdx < 0) primaryIdx = this.weapons.findIndex((w) => w.def.id === loadout[0]);
    this.index = primaryIdx >= 0 ? primaryIdx : Math.max(0, this.weapons.findIndex((w) => w.owned));
    this.traits.reset();
    this._pendingIndex = -1;
    this.switchT = 1;
    this.adsT = 0;
    this._swingT = 0;
    this.weapons[this.index].model.visible = true;
    this._pushHUD();
  }

  /** Buy a weapon by def id. Returns true on success. */
  buy(id) {
    const w = this.weapons.find((x) => x.def.id === id);
    if (!w || w.owned) return false;
    if (!this.game.spendCredits(w.def.price)) return false;
    w.owned = true;
    this._switchTo(this.weapons.indexOf(w));
    this.game.audio.purchase();
    this._pushHUD();
    return true;
  }

  /** Refill every owned weapon's reserve (shop resupply / quest rewards). */
  refillReserve(fraction) {
    for (const w of this.weapons) {
      if (w.owned) w.reserve = Math.min(w.def.reserve, w.reserve + Math.ceil(w.def.reserve * fraction));
    }
    this._pushHUD();
  }

  _switchTo(idx) {
    if (idx === this.index || !this.weapons[idx].owned) return;
    if (this._pendingIndex < 0) this.current.reloading = 0;
    this._pendingIndex = idx;
  }

  update(dt) {
    const game = this.game;
    const input = game.input;
    const player = game.player;

    // --- Switching: digits map to owned weapons in order; wheel cycles. ---
    const owned = this.owned;
    for (let d = 0; d < 5; d++) {
      if (input.pressed(`Digit${d + 1}`) && owned[d]) {
        this._switchTo(this.weapons.indexOf(owned[d]));
      }
    }
    if (input.wheel !== 0 && owned.length > 1) {
      const cur = owned.indexOf(this.current);
      const next = (cur + (input.wheel > 0 ? 1 : owned.length - 1)) % owned.length;
      this._switchTo(this.weapons.indexOf(owned[next]));
    }
    if (this._pendingIndex >= 0) {
      this.switchT -= dt * 6;
      if (this.switchT <= 0) {
        this.current.model.visible = false;
        this.index = this._pendingIndex;
        this._pendingIndex = -1;
        this.current.model.visible = true;
        this._pushHUD();
      }
    } else if (this.switchT < 1) {
      this.switchT = Math.min(1, this.switchT + dt * 6);
    }
    const cw = this.current;

    // --- ADS -----------------------------------------------------------------
    const wantAds = input.button(2) && cw.reloading <= 0 && this.switchT > 0.8;
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    player.fovScale = THREE.MathUtils.lerp(1, cw.def.adsFov, this.adsT);
    player.moveMult = THREE.MathUtils.lerp(1, 0.55, this.adsT);

    // --- Reload (melee has nothing to reload) -----------------------------------
    if (cw.def.melee) {
      cw.reloading = 0;
    } else if (cw.reloading > 0) {
      cw.reloading -= dt;
      const rt = 1 - cw.reloading / cw.def.reloadTime;
      if (cw._rlStage === 0 && rt > 0.3) { cw._rlStage = 1; game.audio.reload('out'); }
      if (cw._rlStage === 1 && rt > 0.78) { cw._rlStage = 2; game.audio.reload('in'); }
      if (cw.reloading <= 0) {
        const need = cw.def.mag - cw.mag;
        const take = Math.min(need, cw.reserve);
        cw.mag += take;
        cw.reserve -= take;
        cw.reloading = 0;
        game.audio.reload('end');
        this._pushHUD();
      }
    } else if ((input.pressed('KeyR') || cw.mag === 0) && cw.mag < cw.def.mag && cw.reserve > 0 && this.switchT > 0.8) {
      // Adrenaline makes your hands faster.
      const handling = game.momentum ? game.momentum.handlingBonus : 1;
      cw.reloading = cw._reloadDur = cw.def.reloadTime / handling;
      cw._rlStage = 0;
      game.audio.reload('start');
    }

    // --- Fire / swing -------------------------------------------------------------
    cw.cooldown = Math.max(0, cw.cooldown - dt);
    const isCharge = cw.def.trait && cw.def.trait.id === 'charge';
    // Charge weapons fire on release, so holding builds power.
    const released = this._wasHeld && !input.button(0);
    this._wasHeld = input.button(0);
    const trigger = isCharge ? released
      : cw.def.auto ? input.button(0) : input.buttonPressed(0);

    if (trigger && cw.cooldown <= 0 && cw.reloading <= 0 && cw.mag > 0 && this.switchT > 0.9) {
      if (cw.def.melee) this._swing(cw);
      else this._fire(cw);
    }
    // Charge readout under the crosshair.
    if (isCharge) game.hud.setCharge?.(this.traits.charge);
    else game.hud.setCharge?.(null);

    // Trait runtime: charge build-up, overcharge heat, burn/chill ticks.
    this.traits.update(dt, input.button(0) && cw.reloading <= 0, cw.def);

    this._updateViewmodel(dt, cw, player);

    const spread = THREE.MathUtils.lerp(cw.def.spreadHip, cw.def.spreadAds, this.adsT);
    const bloom = Math.min(player.speedH * 0.35, 3) + (player.grounded ? 0 : 2);
    game.hud.setCrosshair((spread + bloom) * 3.2, this.adsT);
    game.hud.setReload(cw.reloading > 0 ? 1 - cw.reloading / cw.def.reloadTime : null);
  }

  /** Melee: swing the blade, hit the nearest enemy inside the arc. */
  _swing(w) {
    const game = this.game;
    const cam = game.camera;
    w.cooldown = 60 / w.def.rpm;
    this._swingT = 1;

    cam.getWorldDirection(_dir);
    _origin.copy(cam.position);

    // Nearest live target inside range and swing arc, with line of sight.
    // In GTAZ the "enemy list" is the crowd, so fists and blades reach
    // civilians the same way bullets do.
    let best = null;
    let bestDist = w.def.range;
    const list = (game.isGTAZ && game.freeRoam && game.freeRoam.traffic)
      ? game.freeRoam.traffic.meleeTargets()
      : game.enemies.list;
    for (const e of list) {
      if (!e.alive) continue;
      _end.set(e.position.x, e.position.y + 1.05 * e.s, e.position.z);
      const d = _end.distanceTo(_origin);
      if (d > w.def.range + e.s * 0.4) continue;
      _muzzle.copy(_end).sub(_origin).normalize();
      if (_muzzle.dot(_dir) < w.def.arc) continue; // outside the arc
      const wall = game.physics.raycast(_origin, _muzzle, d);
      if (wall) continue;
      if (d < bestDist + e.s * 0.4) { best = e; bestDist = d; }
    }

    game.audio.swing();
    game.player.addRecoil(0.008, (Math.random() - 0.5) * 0.01);
    if (best) {
      const dmg = w.def.damage;
      best.damage(dmg, false, w.def.name);
      _end.set(best.position.x, best.position.y + 1.05 * best.s, best.position.z);
      game.effects.burst(_end, { count: 12, color: 0x9fefff, speed: 5, life: 0.3 });
      game.hud.hitmarker(false);
      game.audio.hit(false);
    }
  }

  _fire(w) {
    const game = this.game;
    const player = game.player;
    const cam = game.camera;
    w.cooldown = 60 / w.def.rpm;
    if (!(game.admin && game.admin.ammo)) w.mag--;

    cam.getWorldDirection(_dir);
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    _origin.copy(cam.position);
    w.muzzle.getWorldPosition(_muzzle);

    // Third person: the camera sits behind and beside the character, so
    // firing along its axis would send rounds off to one side. Instead find
    // what the crosshair is actually pointing at, then shoot from the
    // character's shoulder toward that point — barrel and reticle agree.
    const tp = game.thirdPerson;
    if (tp && tp.enabled) {
      tp.aimPoint(_end);
      // The muzzle stays level with the eye. Dropping it to the hands looks
      // marginally better but sits below the camera's sightline, so shallow
      // downhill shots clip ground the player can clearly see over.
      _muzzle.set(
        player.position.x - Math.sin(player.yaw) * 0.35 + Math.cos(player.yaw) * 0.28,
        player.position.y + player.eyeHeight,
        player.position.z - Math.cos(player.yaw) * 0.35 - Math.sin(player.yaw) * 0.28
      );
      _origin.copy(_muzzle);
      _dir.copy(_end).sub(_origin).normalize();
      // Rebuild the spread basis around the new firing axis.
      _right.set(_dir.z, 0, -_dir.x).normalize();
      _up.crossVectors(_right, _dir).normalize();
    }

    const moveBloom = Math.min(player.speedH * 0.08, 0.7) + (player.grounded ? 0 : 0.5);
    const spreadDeg = THREE.MathUtils.lerp(w.def.spreadHip, w.def.spreadAds, this.adsT) + moveBloom;

    for (let p = 0; p < w.def.pellets; p++) {
      const r = spreadDeg * DEG * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      _end.copy(_dir)
        .addScaledVector(_right, Math.cos(th) * r)
        .addScaledVector(_up, Math.sin(th) * r)
        .normalize();
      this._resolveShot(w, _origin, _end.clone());
    }

    // Siege weapons brace hard when aiming; everything else kicks normally.
    const recoilMul = this.traits.recoilMultiplier(w.def, this.adsT);
    player.addRecoil(
      w.def.recoil * DEG * (0.8 + Math.random() * 0.4) * recoilMul,
      w.def.recoilRand * DEG * (Math.random() - 0.5) * recoilMul
    );
    this._kick = Math.min(this._kick + 0.35, 1);
    game.effects.flash(_muzzle, w.def.tracer, 20, 0.045);
    game.effects.burst(_muzzle, { count: 3, color: 0xffe0a0, speed: 1.5, life: 0.08, gravity: 0 });
    // Lingering muzzle smoke drifting up.
    game.effects.burst(_muzzle, { count: 2, color: 0x33373d, speed: 0.5, life: 0.7, gravity: -1.4 });
    // Eject brass from the port, just right of the receiver.
    _end.copy(_origin).addScaledVector(_right, 0.16).addScaledVector(_dir, 0.28).addScaledVector(_up, -0.1);
    game.effects.ejectCasing(_end, _right, _dir);
    game.audio.shoot(w.def.kind);
    // Firing a gun in the open city is a crime, and the whole street hears it.
    if (game.isGTAZ && game.freeRoam) game.freeRoam.onPlayerShot();
    this._pushHUD();
  }

  /**
   * Trace one pellet: nearest of world geometry vs enemy hitboxes wins.
   * Weapon traits hook in here — piercing keeps the ray alive through a
   * target, ricochet reflects it off walls, and impact traits fire on hit.
   */
  _resolveShot(w, origin, dir, bounce = 0, pierced = 0, from = null) {
    const game = this.game;
    const def = w.def;
    const trait = def.trait || null;
    const MAX = 220;

    // Seeker rounds bend toward a target before the cast.
    if (bounce === 0 && pierced === 0) dir = this.traits.aimAssist(def, origin, dir);

    const worldHit = game.physics.raycast(origin, dir, MAX);
    const worldDist = worldHit ? worldHit.dist : MAX;

    // Every mode exposes a raycast over whatever it considers a target:
    // battle-royale bots, campaign enemies, or the GTAZ crowd.
    const actors = game.isBR && game.br ? game.br
      : (game.isGTAZ && game.freeRoam ? game.freeRoam.traffic : game.enemies);
    const enemyHit = actors && actors.raycast ? actors.raycast(origin, dir, worldDist) : null;

    // Tracers start at the barrel. In third person the viewmodel is hidden,
    // so the origin passed in already is the character's muzzle.
    const tp = game.thirdPerson;
    if (!(tp && tp.enabled)) w.muzzle.getWorldPosition(_muzzle);
    const traceFrom = from || (tp && tp.enabled ? origin : _muzzle);

    if (enemyHit) {
      let dmg = def.damage * this.traits.damageMultiplier(def);
      const [f0, f1, fmin] = def.falloff;
      if (enemyHit.dist > f0) {
        dmg *= THREE.MathUtils.clamp(1 - (enemyHit.dist - f0) / (f1 - f0), fmin, 1);
      }
      const head = enemyHit.part === 'head';
      if (head) dmg *= def.headMult;

      enemyHit.enemy.damage(dmg, head, def.name, game.player);
      game.effects.bloodHit(enemyHit.point, dir, head);
      game.hud.hitmarker(head);
      game.audio.hit(head);
      game.effects.tracer(traceFrom, enemyHit.point, def.tracer);

      this.traits.onHitTarget(def, enemyHit.enemy, enemyHit.point, dir, dmg, head);

      // Armour-piercing rounds carry on through the body.
      if (trait && trait.id === 'pierce' && pierced < (trait.targets ?? 3) - 1) {
        const next = enemyHit.point.clone().addScaledVector(dir, 0.9);
        this._resolveShot(w, next, dir, bounce, pierced + 1, enemyHit.point);
      }
      return;
    }

    if (worldHit) {
      game.effects.impact(worldHit.point, worldHit.normal, 0xffc873, worldHit.box.surface);
      game.effects.tracer(traceFrom, worldHit.point, def.tracer);
      // Build pieces take damage from gunfire.
      if (game.isBR && game.br) game.br.build.damageCollider(worldHit.box, def.damage);

      const follow = this.traits.onHitWorld(def, worldHit.point, worldHit.normal, dir, bounce);
      if (follow) {
        this._resolveShot(w, follow.origin, follow.dir, bounce + 1, pierced, worldHit.point);
      }
      return;
    }

    _end.copy(origin).addScaledVector(dir, 90);
    game.effects.tracer(traceFrom, _end, def.tracer);
  }

  /**
   * Procedural viewmodel animation. The reload is staged like a real mag
   * change: tilt the gun in, pull the mag (it physically drops out of the
   * well), seat the fresh one, then a charge-pull kick to chamber.
   */
  _updateViewmodel(dt, w, player) {
    const input = this.game.input;

    const swayScale = (1 - this.adsT * 0.85) * 0.0009;
    this._swayX += (-input.mouseDX * swayScale - this._swayX) * Math.min(1, dt * 10);
    this._swayY += (input.mouseDY * swayScale - this._swayY) * Math.min(1, dt * 10);

    // Melee swing: fast diagonal slash arc, then recover.
    this._swingT = Math.max(0, (this._swingT || 0) - dt * 4.5);
    const sw = this._swingT > 0 ? Math.sin((1 - this._swingT) * Math.PI) : 0;

    const bob = player._bobAmp * (1 - this.adsT * 0.8);
    const bx = Math.cos(player._bobPhase) * 0.012 * bob;
    const by = Math.sin(player._bobPhase * 2) * 0.01 * bob;

    this._kick *= Math.exp(-11 * dt);

    // Reload staging — a real mag change, hands and all:
    //   grab (hand travels to the mag) → pull (mag + hand drop out of the
    //   well) → seat (fresh mag rides back up) → rack (hand jumps to the
    //   charging handle and pulls it; handle physically slides).
    let tilt = 0, magY = 0, magOut = 0, charge = 0;
    const hl = w.handL;
    hl.position.copy(w.handLBase);
    w.chargePart.position.copy(w.chargeBase);

    if (w.reloading > 0) {
      const rt = 1 - w.reloading / (w._reloadDur || w.def.reloadTime);
      // Where the left hand holds the mag, in rig space.
      const gripX = w.magBase.x - 0.015;
      const gripY = w.magBase.y - 0.03;
      const gripZ = w.magBase.z + 0.012;

      if (rt < 0.14) {
        // Grab: hand moves from the foregrip to the mag well.
        const k = rt / 0.14;
        tilt = k * 0.6;
        hl.position.lerpVectors(w.handLBase, _end.set(gripX, gripY, gripZ), k);
      } else if (rt < 0.3) {
        // Pull: mag comes out, hand wrapped around it.
        const k = (rt - 0.14) / 0.16;
        tilt = 0.6 + k * 0.4;
        magY = -k * 0.26;
        magOut = k * 0.09;
        hl.position.set(gripX, gripY + magY, gripZ + magOut);
      } else if (rt < 0.55) {
        // Swap: hand and old mag drop out of view for the fresh one.
        const k = Math.sin(((rt - 0.3) / 0.25) * Math.PI); // down and back up
        tilt = 1;
        magY = -0.26 - k * 0.16;
        magOut = 0.09;
        hl.position.set(gripX, gripY + magY, gripZ + magOut);
      } else if (rt < 0.78) {
        // Seat: fresh mag rides up into the well, firm push at the end.
        const k = 1 - (rt - 0.55) / 0.23;
        tilt = 1;
        magY = -0.26 * k;
        magOut = 0.09 * k;
        hl.position.set(gripX, gripY + magY, gripZ + magOut);
      } else {
        // Rack: hand flies to the charging handle and pulls it back.
        const k = (rt - 0.78) / 0.22;
        tilt = 1 - k;
        charge = Math.sin(k * Math.PI);
        const pull = charge * 0.07;
        w.chargePart.position.z = w.chargeBase.z + pull;
        hl.position.lerpVectors(
          _end.set(gripX, gripY, gripZ),
          _origin.set(w.chargeBase.x - 0.02, w.chargeBase.y - 0.01, w.chargeBase.z + pull + 0.03),
          Math.min(1, k * 2.5)
        );
      }
    }
    w.magPart.position.set(w.magBase.x, w.magBase.y + magY, w.magBase.z + magOut);
    w.magPart.rotation.x = -0.18 + magOut * 3;

    const t = this.adsT;
    this.rig.position.set(
      THREE.MathUtils.lerp(this.hipPos.x, this.adsPos.x, t) + this._swayX + bx,
      THREE.MathUtils.lerp(this.hipPos.y, this.adsPos.y, t) + this._swayY + by - (1 - this.switchT) * 0.35,
      THREE.MathUtils.lerp(this.hipPos.z, this.adsPos.z, t) + this._kick * 0.06 + charge * 0.04
    );
    this.rig.rotation.set(
      this._kick * 0.12 - tilt * 0.5 + this._swayY * 6 + charge * 0.08 - sw * 0.55,
      this._swayX * 6 + sw * 0.7,
      this._swayX * 3 - tilt * 0.22 - sw * 0.9
    );
  }

  _pushHUD() {
    const w = this.current;
    const owned = this.owned;
    this.game.hud.setAmmo(w.def.name, w.mag, w.reserve, owned.indexOf(w), owned.map((x) => x.def.name));
  }
}
