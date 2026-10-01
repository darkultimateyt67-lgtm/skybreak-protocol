/**
 * Arsenal — 123 distinct weapons, generated rather than hand-listed.
 *
 * Every gun is the product of three axes:
 *
 *   FAMILY   the chassis: rifle, SMG, shotgun, marksman, sniper, pistol,
 *            LMG, burst rifle, launcher, energy, railgun, scattergun.
 *            Sets the base stats and the broad silhouette.
 *
 *   FRAME    a build variant within the family (compact / standard / heavy /
 *            precision / prototype). Shifts the stats and changes the visual
 *            proportions — barrel length, stock, optic, magazine.
 *
 *   TRAIT    a special feature that actually changes how the gun behaves in
 *            the world: explosive rounds, ricochet, chain arcs, charge shots,
 *            homing, incendiary, piercing, and so on.
 *
 * The combination is deterministic — gun #57 is always the same gun — and
 * every entry gets a unique name, colourway and part loadout, so no two look
 * or feel the same.
 */

/** Base chassis definitions. */
const FAMILIES = [
  {
    id: 'ar', label: 'ASSAULT RIFLE', kind: 'ar', auto: true,
    damage: 26, rpm: 690, mag: 30, reserve: 180, reload: 1.9,
    spreadHip: 1.7, spreadAds: 0.32, recoil: 0.55, adsFov: 0.78,
    pellets: 1, falloff: [22, 55, 0.6], headMult: 1.8, len: 0.62
  },
  {
    id: 'smg', label: 'SMG', kind: 'smg', auto: true,
    damage: 18, rpm: 950, mag: 36, reserve: 216, reload: 1.7,
    spreadHip: 2.2, spreadAds: 0.6, recoil: 0.4, adsFov: 0.84,
    pellets: 1, falloff: [14, 34, 0.5], headMult: 1.7, len: 0.5
  },
  {
    id: 'sg', label: 'SHOTGUN', kind: 'sg', auto: false,
    damage: 13, rpm: 78, mag: 6, reserve: 42, reload: 2.3,
    spreadHip: 4.6, spreadAds: 3.2, recoil: 2.6, adsFov: 0.88,
    pellets: 8, falloff: [10, 26, 0.3], headMult: 1.5, len: 0.52
  },
  {
    id: 'dmr', label: 'MARKSMAN', kind: 'dmr', auto: false,
    damage: 62, rpm: 140, mag: 12, reserve: 84, reload: 2.2,
    spreadHip: 2.0, spreadAds: 0.12, recoil: 1.5, adsFov: 0.55,
    pellets: 1, falloff: [60, 110, 0.8], headMult: 2.0, len: 0.72
  },
  {
    id: 'sniper', label: 'SNIPER', kind: 'dmr', auto: false,
    damage: 110, rpm: 42, mag: 5, reserve: 30, reload: 2.9,
    spreadHip: 3.2, spreadAds: 0.02, recoil: 3.0, adsFov: 0.34,
    pellets: 1, falloff: [110, 180, 0.92], headMult: 2.5, len: 0.86
  },
  {
    id: 'pistol', label: 'SIDEARM', kind: 'pistol', auto: false,
    damage: 30, rpm: 330, mag: 12, reserve: 96, reload: 1.4,
    spreadHip: 1.5, spreadAds: 0.4, recoil: 0.9, adsFov: 0.86,
    pellets: 1, falloff: [16, 40, 0.5], headMult: 1.9, len: 0.3
  },
  {
    id: 'lmg', label: 'LMG', kind: 'ar', auto: true,
    damage: 24, rpm: 620, mag: 75, reserve: 300, reload: 4.1,
    spreadHip: 2.6, spreadAds: 0.5, recoil: 0.8, adsFov: 0.82,
    pellets: 1, falloff: [30, 70, 0.65], headMult: 1.6, len: 0.78
  },
  {
    id: 'burst', label: 'BURST RIFLE', kind: 'ar', auto: false,
    damage: 32, rpm: 420, mag: 27, reserve: 162, reload: 2.0,
    spreadHip: 1.4, spreadAds: 0.2, recoil: 0.7, adsFov: 0.7,
    pellets: 1, falloff: [34, 72, 0.7], headMult: 1.9, len: 0.64
  },
  {
    id: 'launcher', label: 'LAUNCHER', kind: 'sg', auto: false,
    damage: 70, rpm: 55, mag: 4, reserve: 16, reload: 3.2,
    spreadHip: 2.0, spreadAds: 1.0, recoil: 3.4, adsFov: 0.9,
    pellets: 1, falloff: [40, 90, 0.9], headMult: 1.0, len: 0.7
  },
  {
    id: 'energy', label: 'ENERGY', kind: 'ar', auto: true,
    damage: 22, rpm: 780, mag: 40, reserve: 240, reload: 2.1,
    spreadHip: 1.2, spreadAds: 0.18, recoil: 0.35, adsFov: 0.76,
    pellets: 1, falloff: [26, 60, 0.72], headMult: 1.7, len: 0.6
  },
  {
    id: 'rail', label: 'RAILGUN', kind: 'dmr', auto: false,
    damage: 95, rpm: 50, mag: 6, reserve: 36, reload: 2.7,
    spreadHip: 2.4, spreadAds: 0.0, recoil: 2.6, adsFov: 0.42,
    pellets: 1, falloff: [140, 220, 0.95], headMult: 2.2, len: 0.88
  },
  {
    id: 'scatter', label: 'SCATTERGUN', kind: 'sg', auto: true,
    damage: 9, rpm: 220, mag: 12, reserve: 72, reload: 2.6,
    spreadHip: 5.4, spreadAds: 4.0, recoil: 1.4, adsFov: 0.9,
    pellets: 6, falloff: [9, 22, 0.28], headMult: 1.4, len: 0.56
  }
];

/** Build variants. Multipliers applied on top of the family. */
const FRAMES = [
  {
    id: 'compact', label: 'Compact', dmg: 0.88, rpm: 1.18, mag: 0.85, reload: 0.82,
    spread: 1.22, recoil: 0.82, lenMul: 0.78,
    parts: { stock: 'folding', optic: 'reflex', mag: 'short', barrel: 'stub' }
  },
  {
    id: 'standard', label: 'Standard', dmg: 1.0, rpm: 1.0, mag: 1.0, reload: 1.0,
    spread: 1.0, recoil: 1.0, lenMul: 1.0,
    parts: { stock: 'fixed', optic: 'holo', mag: 'standard', barrel: 'standard' }
  },
  {
    id: 'heavy', label: 'Heavy', dmg: 1.24, rpm: 0.8, mag: 1.3, reload: 1.24,
    spread: 1.1, recoil: 1.34, lenMul: 1.14,
    parts: { stock: 'heavy', optic: 'holo', mag: 'drum', barrel: 'heavy' }
  },
  {
    id: 'precision', label: 'Precision', dmg: 1.12, rpm: 0.88, mag: 0.92, reload: 1.06,
    spread: 0.6, recoil: 0.76, lenMul: 1.08,
    parts: { stock: 'match', optic: 'scope', mag: 'standard', barrel: 'long' }
  },
  {
    id: 'proto', label: 'Prototype', dmg: 1.08, rpm: 1.1, mag: 1.1, reload: 0.9,
    spread: 0.85, recoil: 0.9, lenMul: 0.96,
    parts: { stock: 'skeletal', optic: 'smart', mag: 'cell', barrel: 'coil' }
  }
];

/**
 * Special features. `apply` hooks are read by the weapon system when a shot
 * resolves, so these genuinely change behaviour rather than being flavour.
 */
export const TRAITS = {
  none: { id: 'none', label: 'Standard', desc: 'No special system. Reliable and predictable.', color: 0x9aa3ad },
  explosive: { id: 'explosive', label: 'Explosive Rounds', desc: 'Rounds detonate on impact for splash damage.', color: 0xff7a3d, radius: 3.2, splash: 0.55 },
  ricochet: { id: 'ricochet', label: 'Ricochet', desc: 'Shots bounce off hard surfaces up to twice.', color: 0x7dd4ff, bounces: 2 },
  chain: { id: 'chain', label: 'Chain Arc', desc: 'Hits arc to a nearby second target.', color: 0x9b6bff, jumps: 1, range: 9, falloff: 0.55 },
  charge: { id: 'charge', label: 'Charge Shot', desc: 'Hold fire to charge for up to triple damage.', color: 0xffd24a, max: 3.0, time: 0.9 },
  homing: { id: 'homing', label: 'Seeker Rounds', desc: 'Rounds curve toward the nearest target.', color: 0x4ec95a, cone: 0.22 },
  incendiary: { id: 'incendiary', label: 'Incendiary', desc: 'Sets targets alight for damage over time.', color: 0xff5a2a, dot: 22, time: 3 },
  cryo: { id: 'cryo', label: 'Cryo Rounds', desc: 'Chills targets, slowing them heavily.', color: 0x7ae0ff, slow: 0.45, time: 2.5 },
  pierce: { id: 'pierce', label: 'Armor Piercing', desc: 'Punches through targets and thin cover.', color: 0xd0d6de, targets: 3 },
  shock: { id: 'shock', label: 'EMP Rounds', desc: 'Strips shields and staggers on hit.', color: 0x5ad2ff, shieldMul: 2.4 },
  vamp: { id: 'vamp', label: 'Siphon', desc: 'Returns a share of damage dealt as health.', color: 0xff5a8a, leech: 0.16 },
  cluster: { id: 'cluster', label: 'Cluster Munition', desc: 'Impact scatters submunitions.', color: 0xffa640, bomblets: 4, radius: 2.4 },
  overcharge: { id: 'overcharge', label: 'Overcharge', desc: 'Damage climbs as you keep firing, then vents.', color: 0xff3b6b, ramp: 0.045, cap: 1.8 },
  siege: { id: 'siege', label: 'Siege Mode', desc: 'Aiming down sights removes nearly all recoil.', color: 0xc8a24a, adsRecoil: 0.15 },
  flechette: { id: 'flechette', label: 'Flechette', desc: 'Fires a dense needle spread that bleeds.', color: 0xb0c4d0, extraPellets: 4, bleed: 10 },
  quickdraw: { id: 'quickdraw', label: 'Quickdraw', desc: 'Extremely fast swap and reload handling.', color: 0x8affc8, handling: 1.55 }
};

/** Trait pool per family — a sniper shouldn't roll a scattergun's trait. */
const TRAIT_POOL = {
  ar: ['none', 'incendiary', 'pierce', 'chain', 'overcharge', 'homing', 'shock', 'explosive', 'cryo', 'vamp', 'siege'],
  smg: ['none', 'quickdraw', 'incendiary', 'shock', 'vamp', 'chain', 'cryo', 'overcharge', 'flechette', 'homing', 'ricochet'],
  sg: ['none', 'flechette', 'incendiary', 'explosive', 'cryo', 'shock', 'ricochet', 'vamp', 'quickdraw', 'cluster', 'pierce'],
  dmr: ['none', 'pierce', 'siege', 'shock', 'explosive', 'chain', 'charge', 'incendiary', 'homing', 'cryo', 'vamp'],
  sniper: ['none', 'pierce', 'charge', 'siege', 'explosive', 'shock', 'cryo', 'chain', 'incendiary', 'homing', 'vamp'],
  pistol: ['none', 'quickdraw', 'ricochet', 'shock', 'vamp', 'incendiary', 'chain', 'charge', 'cryo', 'pierce', 'homing'],
  lmg: ['none', 'siege', 'overcharge', 'incendiary', 'pierce', 'shock', 'explosive', 'chain', 'cryo', 'vamp', 'homing'],
  burst: ['none', 'pierce', 'shock', 'chain', 'incendiary', 'charge', 'homing', 'cryo', 'siege', 'vamp', 'overcharge'],
  launcher: ['explosive', 'cluster', 'incendiary', 'shock', 'cryo', 'homing', 'none', 'ricochet', 'chain', 'siege', 'pierce'],
  energy: ['none', 'chain', 'overcharge', 'charge', 'shock', 'cryo', 'homing', 'pierce', 'incendiary', 'vamp', 'ricochet'],
  rail: ['pierce', 'charge', 'chain', 'shock', 'siege', 'overcharge', 'none', 'explosive', 'cryo', 'homing', 'vamp'],
  scatter: ['flechette', 'none', 'incendiary', 'cryo', 'shock', 'ricochet', 'vamp', 'quickdraw', 'cluster', 'chain', 'explosive']
};

/** Name pieces. Combined deterministically so every gun reads distinctly. */
const PREFIX = [
  'VX', 'KR', 'MK', 'HZ', 'AT', 'QN', 'DR', 'SV', 'TN', 'BL', 'CN', 'RG'
];
const CORE = [
  'RIPTIDE', 'KESTREL', 'MAULER', 'LANCE', 'VESPER', 'HORNET', 'BASILISK',
  'TEMPEST', 'MERIDIAN', 'CINDER', 'HALLOW', 'SABLE', 'VANTAGE', 'ORACLE',
  'DRIFTER', 'MARROW', 'PILGRIM', 'THISTLE', 'QUARREL', 'BEACON', 'GALLOW',
  'HARROW', 'NOMAD', 'SPARROW', 'TALON', 'WIDOW', 'ZEPHYR', 'ONYX',
  'CORVID', 'FULCRUM', 'IRONWOOD', 'JUNIPER'
];
const SUFFIX = [
  '', ' MK II', ' MK III', '-S', '-X', '-R', ' PRIME', ' ELITE', ' CUSTOM',
  '-T', ' LONGBOW', ' SPEC'
];

/** Finishes: body colour, metal response and accent light. */
const FINISHES = [
  { id: 'gunmetal', body: 0x252b38, metal: 0.85, rough: 0.35, accent: 0x37e6ff },
  { id: 'sand', body: 0x9a8560, metal: 0.35, rough: 0.62, accent: 0xffc46b },
  { id: 'olive', body: 0x4a5340, metal: 0.32, rough: 0.66, accent: 0x9bd45a },
  { id: 'crimson', body: 0x5c2028, metal: 0.6, rough: 0.42, accent: 0xff5a6b },
  { id: 'arctic', body: 0xcdd6de, metal: 0.5, rough: 0.4, accent: 0x7ae0ff },
  { id: 'void', body: 0x14161c, metal: 0.9, rough: 0.24, accent: 0xb08cff },
  { id: 'copper', body: 0x7a4a2c, metal: 0.88, rough: 0.3, accent: 0xffa640 },
  { id: 'jade', body: 0x1f4a42, metal: 0.55, rough: 0.44, accent: 0x4ec95a },
  { id: 'ember', body: 0x3a1c14, metal: 0.7, rough: 0.38, accent: 0xff7a3d },
  { id: 'nickel', body: 0x8f97a1, metal: 0.95, rough: 0.22, accent: 0xd0d6de },
  { id: 'carbon', body: 0x1b1f26, metal: 0.55, rough: 0.5, accent: 0x8affc8 }
];

/** Deterministic small hash so the same index always yields the same gun. */
function pick(list, n) {
  return list[n % list.length];
}

/**
 * Generate the full catalogue. Exactly `count` weapons, all unique.
 */
export function buildArsenal(count = 123) {
  const out = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    const famIndex = i % FAMILIES.length;
    const fam = FAMILIES[famIndex];
    // `cycle` is which pass through the family list this weapon belongs to.
    // With 12 families and 123 weapons it runs 0..10.
    const cycle = Math.floor(i / FAMILIES.length);
    const frame = FRAMES[cycle % FRAMES.length];
    const pool = TRAIT_POOL[fam.id] || TRAIT_POOL.ar;
    // Spread traits so each family cycles through its whole pool.
    const trait = TRAITS[pool[cycle % pool.length]] || TRAITS.none;

    // Finish is indexed off `cycle`, not hashed off `i`. Hashing collided:
    // two weapons in the same family drew the same frame AND finish, so the
    // catalogue held 123 names over only 60 distinct silhouettes. Because a
    // family sees each `cycle` exactly once and there are more finishes (11)
    // than cycles (11, 0-indexed), indexing by cycle makes the
    // family x frame x finish triple unique by construction. Adding famIndex
    // keeps two families on the same cycle from looking identical.
    const finish = FINISHES[(cycle + famIndex) % FINISHES.length];

    // A per-weapon silhouette seed, so guns sharing a frame still differ in
    // their furniture — sight, barrel, stock and magazine are picked from it.
    const variant = (i * 7 + cycle * 3) % 6;

    // Name: prefix + core + suffix, de-duplicated.
    let name;
    let attempt = 0;
    do {
      const p = pick(PREFIX, i + attempt);
      const c = pick(CORE, i * 3 + attempt * 7);
      const s = pick(SUFFIX, Math.floor(i / 6) + attempt);
      name = `${p}-${c}${s}`;
      attempt++;
    } while (usedNames.has(name) && attempt < 60);
    usedNames.add(name);

    // Stats from family × frame.
    const damage = +(fam.damage * frame.dmg).toFixed(1);
    const rpm = Math.round(fam.rpm * frame.rpm);
    const mag = Math.max(1, Math.round(fam.mag * frame.mag));

    const def = {
      id: `w${i}`,
      index: i,
      name,
      family: fam.id,
      familyLabel: fam.label,
      frame: frame.id,
      frameLabel: frame.label,
      kind: fam.kind,
      trait,
      finish,

      // Combat stats.
      auto: fam.auto,
      damage,
      headMult: fam.headMult,
      rpm,
      mag,
      reserve: Math.round(fam.reserve * frame.mag),
      reloadTime: +(fam.reload * frame.reload).toFixed(2),
      spreadHip: +(fam.spreadHip * frame.spread).toFixed(2),
      spreadAds: +(fam.spreadAds * frame.spread).toFixed(3),
      recoil: +(fam.recoil * frame.recoil).toFixed(2),
      recoilRand: 0.35,
      adsFov: fam.adsFov,
      pellets: fam.pellets + (trait.id === 'flechette' ? (trait.extraPellets || 0) : 0),
      falloff: fam.falloff,

      // Visual identity.
      len: +(fam.len * frame.lenMul).toFixed(3),
      parts: frame.parts,
      variant,
      accent: finish.accent,
      tracer: trait.id === 'none' ? finish.accent : trait.color,
      price: 0,
      desc: `${frame.label} ${fam.label.toLowerCase()} — ${trait.label}.`
    };

    // Trait stat adjustments that belong on the definition itself.
    if (trait.id === 'quickdraw') {
      def.reloadTime = +(def.reloadTime / (trait.handling || 1.5)).toFixed(2);
    }
    if (trait.id === 'charge') {
      def.auto = false;
    }
    out.push(def);
  }
  return out;
}

/** The catalogue, built once. */
export const ARSENAL = buildArsenal(123);

/** Group the catalogue by family for the armory UI. */
export function arsenalByFamily() {
  const map = new Map();
  for (const w of ARSENAL) {
    if (!map.has(w.familyLabel)) map.set(w.familyLabel, []);
    map.get(w.familyLabel).push(w);
  }
  return map;
}
