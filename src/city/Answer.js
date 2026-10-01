import * as THREE from 'three';

/**
 * The things at the bottom.
 *
 * Every ward of the Undercity used to end with the same fight: the same
 * scaled-up raider in the same exo-rig, with the same slam and the same
 * summon, wearing a different number in its name. The story around it said
 * something much better than that — the wardens wrote that the thing below
 * GROWS A BODY, sends it up, watches it die, and grows a better one, and that
 * they had buried eleven of them — and the fight itself said "here is a large
 * man in armour, again".
 *
 * So each ward now fields its own draft, shaped by the ward it grew in.
 *
 *   HOLLOW      THE LISTENER        stone strapped on with wire. Slow and
 *                                   heavy, and it holds its ground, because
 *                                   the wardens wrote that it is not hunting
 *                                   you — it is waiting for the building to
 *                                   stop.
 *   MARROW      THE ELEVENTH        the one that knew their names. Bore steel
 *                                   through the shoulders, a drill for a right
 *                                   arm, fast and close, and it calls the rest
 *                                   up twice as often as anything else.
 *   EMBERFALL   THE ELEVEN DAYS     what walked out of the fire. Burnt crust
 *                                   over a lit core, the hardest hitter, and
 *                                   the one that wants you off the floor.
 *   SALTMAW     THE DROWNED CACHE   grown around the thing the dig pulled out
 *                                   of the water, still carrying it in a cage
 *                                   of ribs. Slow, enormous, does not stop.
 *   GRAVEMOUTH  THE LAST WEIGHT     wearing the crown, dragging the chains off
 *                                   the sealed gate. It does everything the
 *                                   other four do.
 *
 * WHAT IS ACTUALLY DIFFERENT: name and epithet, the lines it is announced and
 * buried with, health, damage, speed and preferred range, how often and how
 * hard it slams, how many it calls, and what it looks like. The shells are
 * built here rather than in EnemyManager because they are scenery about a
 * story, not part of how an enemy works — the fight code should not have to
 * know that the third ward's boss is on fire.
 *
 * WHAT STAYS: the boss still learns from how the last one died — see
 * BossMemory, which shapes these numbers again before they are used. That
 * mechanic is the reason the premise works at all. A ward decides what the
 * draft IS; the memory decides what it has learned since.
 */

export const ANSWERS = {
  hollow: {
    ward: 'hollow',
    title: 'THE LISTENER',
    epithet: 'First draft. It has never had to try before.',
    color: 0x9fd8c0,
    hp: 820,
    dmg: 0.85,
    speed: 0.82,
    range: 16,
    shell: 'stone',
    enter: 'It stands up slowly, like something that has all the time there is.',
    half: 'The stone across its shoulders splits. It does not appear to notice.',
    enrage: 'THE LISTENER has stopped waiting.',
    death: 'It comes apart into dressed blocks. Somebody cut every one of those by hand.',
    slam: { cd: 6.0, radius: 7.0, dmg: 26, knock: 9 },
    summon: { cd: 16, count: 2 }
  },
  marrow: {
    ward: 'marrow',
    title: 'THE ELEVENTH',
    epithet: 'The one that knew their names.',
    color: 0xffc46a,
    hp: 950,
    dmg: 1.0,
    speed: 1.22,
    range: 8,
    shell: 'bore',
    enter: 'It says something in a voice you have heard before. Do not answer it.',
    half: 'The bore steel through its shoulders begins to turn.',
    enrage: 'THE ELEVENTH has stopped copying and started improvising.',
    death: 'It goes down still talking. It was using the foreman’s voice.',
    slam: { cd: 4.2, radius: 5.5, dmg: 22, knock: 7 },
    summon: { cd: 8, count: 3 }
  },
  emberfall: {
    ward: 'emberfall',
    title: 'THE ELEVEN DAYS',
    epithet: 'What walked out of the fire the wardens lit.',
    color: 0xff7a2e,
    hp: 1050,
    dmg: 1.25,
    speed: 1.0,
    range: 12,
    shell: 'ember',
    enter: 'Nineteen went down to light that fire and four came back. This is what it bought.',
    half: 'The crust splits, and whatever is under it is still burning.',
    enrage: 'THE ELEVEN DAYS is running hot. Get off the floor.',
    death: 'The seams go dark one at a time, from the feet upward.',
    slam: { cd: 3.6, radius: 8.5, dmg: 34, knock: 12 },
    summon: { cd: 14, count: 2 }
  },
  saltmaw: {
    ward: 'saltmaw',
    title: 'THE DROWNED CACHE',
    epithet: 'Grown around the thing they should have left in the water.',
    color: 0x7fd4ff,
    hp: 1250,
    dmg: 1.05,
    speed: 0.9,
    range: 10,
    shell: 'salt',
    enter: 'The cache is a lung, the wardens wrote. Something in there is breathing.',
    half: 'Sea water sheets off it, and the ribs open a little wider.',
    enrage: 'THE DROWNED CACHE has stopped being careful with what it is carrying.',
    death: 'It folds down and the water runs out of it. The cage is empty.',
    slam: { cd: 5.0, radius: 9.5, dmg: 28, knock: 8 },
    summon: { cd: 11, count: 3 }
  },
  gravemouth: {
    ward: 'gravemouth',
    title: 'THE LAST WEIGHT',
    epithet: 'Wearing the crown. It was never a crown.',
    color: 0xd8c89a,
    hp: 1600,
    dmg: 1.35,
    speed: 1.08,
    range: 11,
    shell: 'crown',
    enter: 'Four generations stayed down here so that this would not come up.',
    half: 'The chains come off the gate, one link at a time.',
    enrage: 'THE LAST WEIGHT is finished being a draft.',
    death: 'It puts the crown down. That is the only thing it does.',
    slam: { cd: 3.2, radius: 10, dmg: 36, knock: 13 },
    summon: { cd: 7, count: 4 }
  }
};

/** The ward a cave belongs to, worked out the same way Undercity does it. */
export function wardOf(cave) {
  return (cave && (cave.def?.id || cave.id)) || null;
}

/**
 * The spec for one fight.
 *
 * `defeated` is how many of these you have already put down, which is exactly
 * what the thing below is counting. Later drafts are tougher, so going back in
 * is not a victory lap.
 */
export function answerFor(cave, defeated = 0) {
  const id = wardOf(cave);
  const base = ANSWERS[id] || ANSWERS.hollow;
  const rep = Math.max(0, defeated);
  return {
    ...base,
    name: base.title,
    hp: Math.round(base.hp * (1 + rep * 0.12)),
    dmg: base.dmg * (1 + rep * 0.05),
    speed: base.speed * (1 + Math.min(0.25, rep * 0.03))
  };
}

// --- Shells -----------------------------------------------------------------
// Each one is a group of plain solids hung on the enemy's own body, built at
// the body's own scale: the group they join has already been scaled up.

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.05
  });
}

/** Put one solid in a group. Returns it so the caller can keep a handle. */
function piece(g, geo, m, x, y, z, rx = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, 0, rz);
  o.castShadow = true;
  g.add(o);
  return o;
}

/** Dressed stone strapped over the shoulders and chest with wire. */
function stoneShell(lit) {
  const g = new THREE.Group();
  const rock = mat(0x6d6f66, { rough: 0.98 });
  const wire = mat(0x2a2722, { rough: 0.7, metal: 0.4 });
  piece(g, new THREE.BoxGeometry(0.5, 0.42, 0.1), rock, 0, 1.14, 0.17, 0, 0.05);
  piece(g, new THREE.BoxGeometry(0.46, 0.38, 0.09), rock, 0, 1.1, -0.2, 0, -0.07);
  piece(g, new THREE.BoxGeometry(0.26, 0.2, 0.3), rock, -0.34, 1.42, 0, 0, 0.18);
  piece(g, new THREE.BoxGeometry(0.26, 0.2, 0.3), rock, 0.34, 1.42, 0, 0, -0.18);
  for (let i = 0; i < 3; i++) {
    piece(g, new THREE.BoxGeometry(0.56, 0.03, 0.03), wire, 0, 1.0 + i * 0.13, 0.19);
  }
  // A slab over the face with nothing cut in it, and the only light on the
  // whole thing behind the jaw.
  piece(g, new THREE.BoxGeometry(0.3, 0.3, 0.1), rock, 0, 1.64, 0.14);
  const throat = piece(g, new THREE.BoxGeometry(0.1, 0.06, 0.04), lit, 0, 1.46, 0.17);
  return { group: g, lights: [throat] };
}

/** Bore steel driven through the shoulders, and a drill for a right arm. */
function boreShell(lit) {
  const g = new THREE.Group();
  const steel = mat(0x585d63, { rough: 0.35, metal: 0.9 });
  const rust = mat(0x6a4326, { rough: 0.9, metal: 0.2 });
  piece(g, new THREE.CylinderGeometry(0.035, 0.035, 1.05, 8), steel, 0, 1.4, -0.02, 0, Math.PI / 2);
  piece(g, new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), steel, 0, 1.24, 0.06, 0, Math.PI / 2.3);
  const shaft = piece(g, new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), steel, 0.34, 0.95, 0.06, Math.PI / 2);
  const bit = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 10), steel);
  bit.position.set(0.34, 0.95, 0.36);
  bit.rotation.x = Math.PI / 2;
  bit.castShadow = true;
  g.add(bit);
  // Survey stakes driven into its back, carried like a crest.
  for (let i = -2; i <= 2; i++) {
    piece(g, new THREE.BoxGeometry(0.03, 0.34, 0.03), rust, i * 0.09, 1.52, -0.22, -0.3 + i * 0.05, i * 0.12);
  }
  const eye = piece(g, new THREE.BoxGeometry(0.22, 0.03, 0.03), lit, 0, 1.66, 0.16);
  return { group: g, lights: [eye], spin: [shaft, bit] };
}

/** Burnt crust over something that never went out. */
function emberShell(lit) {
  const g = new THREE.Group();
  const crust = mat(0x2b211c, { rough: 0.95 });
  const lights = [];
  const plates = [
    [0, 1.26, 0.16, 0.42, 0.2], [0, 1.02, 0.17, 0.44, 0.22],
    [-0.3, 1.36, 0.02, 0.22, 0.18], [0.3, 1.36, 0.02, 0.22, 0.18],
    [0, 1.16, -0.2, 0.4, 0.34], [0, 0.78, 0.13, 0.36, 0.16]
  ];
  for (const [x, y, z, w, h] of plates) piece(g, new THREE.BoxGeometry(w, h, 0.1), crust, x, y, z);
  for (let i = 0; i < 5; i++) {
    lights.push(piece(g, new THREE.BoxGeometry(0.44, 0.022, 0.03), lit,
      0, 0.9 + i * 0.13, 0.19, 0, (i % 2 ? 1 : -1) * 0.09));
  }
  lights.push(piece(g, new THREE.BoxGeometry(0.16, 0.16, 0.04), lit, 0, 1.13, 0.2));
  lights.push(piece(g, new THREE.BoxGeometry(0.03, 0.22, 0.03), lit, -0.03, 1.64, 0.16, 0, 0.16));
  return { group: g, lights };
}

/** Salt crust, hanging weed, and a cage of ribs with a dark space behind it. */
function saltShell(lit) {
  const g = new THREE.Group();
  const salt = mat(0xcfd6d2, { rough: 0.92 });
  const weed = mat(0x2f4434, { rough: 0.95 });
  const dark = mat(0x0a0d10, { rough: 0.6 });
  // Encrustation is lumps, not plates — it grew on, it was not fitted.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    piece(g, new THREE.BoxGeometry(0.1 + (i % 3) * 0.04, 0.09, 0.09), salt,
      Math.cos(a) * 0.24, 0.92 + (i % 4) * 0.16, Math.sin(a) * 0.17, a, a * 0.5);
  }
  piece(g, new THREE.BoxGeometry(0.34, 0.3, 0.16), dark, 0, 1.14, 0.1);
  for (let i = 0; i < 4; i++) {
    const y = 1.0 + i * 0.1;
    piece(g, new THREE.BoxGeometry(0.03, 0.03, 0.26), salt, -0.16, y, 0.16, 0, 0.5 - i * 0.1);
    piece(g, new THREE.BoxGeometry(0.03, 0.03, 0.26), salt, 0.16, y, 0.16, 0, -0.5 + i * 0.1);
  }
  for (let i = 0; i < 7; i++) {
    const x = -0.36 + (i / 6) * 0.72;
    piece(g, new THREE.BoxGeometry(0.035, 0.24 + (i % 3) * 0.12, 0.025), weed,
      x, 1.28, -0.12, 0.1 * (i % 2 ? 1 : -1));
  }
  const glow = piece(g, new THREE.BoxGeometry(0.16, 0.1, 0.03), lit, 0, 1.14, 0.2);
  const eye = piece(g, new THREE.BoxGeometry(0.2, 0.025, 0.03), lit, 0, 1.63, 0.16);
  return { group: g, lights: [glow, eye] };
}

/** The crown, the chains, and slabs off the gate the wardens sealed. */
function crownShell(lit) {
  const g = new THREE.Group();
  const stone = mat(0x7a7468, { rough: 0.95 });
  const iron = mat(0x30302f, { rough: 0.5, metal: 0.8 });
  const gold = mat(0x9a7c3a, { rough: 0.4, metal: 0.9 });
  piece(g, new THREE.BoxGeometry(0.72, 0.09, 0.28), stone, 0, 1.5, -0.04, 0, 0.04);
  piece(g, new THREE.BoxGeometry(0.5, 0.36, 0.11), stone, 0, 1.12, 0.18);
  // Deliberately graceless: a ring of blunt, uneven uprights. The wardens
  // shaped it like a crown so that anyone greedy enough to take it would be
  // remembered as a fool, so it should look like it was made to be ugly.
  const ring = new THREE.Group();
  ring.position.set(0, 1.78, 0);
  g.add(ring);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13 + (i % 3) * 0.05, 0.05), gold);
    p.position.set(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19);
    p.rotation.y = -a;
    p.castShadow = true;
    ring.add(p);
  }
  piece(g, new THREE.TorusGeometry(0.19, 0.022, 6, 14), gold, 0, 1.72, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      piece(g, new THREE.BoxGeometry(0.04, 0.05, 0.04), iron,
        sx * (0.33 + i * 0.008), 1.34 - i * 0.12, -0.16, 0, i * 0.18 * sx);
    }
  }
  const lights = [
    piece(g, new THREE.BoxGeometry(0.26, 0.03, 0.03), lit, 0, 1.64, 0.16),
    piece(g, new THREE.BoxGeometry(0.06, 0.24, 0.03), lit, 0, 1.12, 0.21)
  ];
  return { group: g, lights, ring };
}

const SHELLS = {
  stone: stoneShell, bore: boreShell, ember: emberShell, salt: saltShell, crown: crownShell
};

/**
 * What each draft's body is made of. `trim` is for whatever was darkest on
 * the old body — boots, straps, the rifle — so the figure keeps its joints
 * and edges. `glow` is a faint heat from inside, for the one that has it.
 */
const FLESH = {
  stone: { color: 0x5f625a, trim: 0x3d3f39, rough: 0.97, metal: 0.02 },
  bore: { color: 0x4a4038, trim: 0x2a2623, rough: 0.7, metal: 0.35 },
  ember: { color: 0x2a1c16, trim: 0x140d0a, rough: 0.95, metal: 0.05, glow: 0x5a1a06 },
  salt: { color: 0xa9b3b0, trim: 0x5d6a67, rough: 0.9, metal: 0.02 },
  crown: { color: 0x4f4a42, trim: 0x2b2824, rough: 0.9, metal: 0.1 }
};

/**
 * Hang a ward's shell on a boss.
 *
 * Returns something the caller ticks with `update(dt, enemy)`. The glow
 * breathes rather than sitting flat — a static emissive reads as paint, a
 * moving one reads as something alive in there — and it doubles as a tell:
 * it runs faster and brighter once the thing is enraged, which is information
 * a player can read from the far side of a hall.
 */
export function dressAnswer(enemy, spec) {
  if (!enemy || !enemy.group) return null;
  const make = SHELLS[spec.shell] || SHELLS.stone;
  const lit = new THREE.MeshStandardMaterial({
    color: 0x101010, emissive: spec.color, emissiveIntensity: 1.8, roughness: 0.4
  });

  // --- The body is the ward's substance, not a man in costume --------------
  // The first version hung the shell on top of the ordinary enemy body, and
  // what you saw was a raider in a blue shirt with a helmet and a human face,
  // wearing some burnt plates. That is precisely the thing the story says
  // this is NOT. It grows a body; it does not hire one. So every surface of
  // the underlying body is re-cut in the ward's material first — skin,
  // shirt, trousers, boots, helmet, the rifle — and the face becomes a carved
  // one. Hair is dropped outright: stone does not have any.
  //
  // Materials are REPLACED on each mesh rather than edited in place, so an
  // ordinary enemy sharing one of them is left exactly as it was.
  const flesh = FLESH[spec.shell] || FLESH.stone;
  const body = new THREE.MeshStandardMaterial({
    color: flesh.color, roughness: flesh.rough, metalness: flesh.metal,
    emissive: flesh.glow || 0x000000, emissiveIntensity: flesh.glow ? 0.35 : 0
  });
  const trim = new THREE.MeshStandardMaterial({
    color: flesh.trim, roughness: Math.min(1, flesh.rough + 0.05), metalness: flesh.metal
  });
  enemy.group.traverse((o) => {
    if (o.isLine || o.isLineSegments || o.isPoints) { o.visible = false; return; }
    if (!o.isMesh || o.material === enemy.visorMat) return;
    // Darker parts of the old body (boots, gear, the gun) take the trim, so
    // the silhouette keeps some structure instead of going one flat colour.
    const c = o.material && o.material.color;
    const dark = c ? (c.r + c.g + c.b) / 3 < 0.09 : false;
    o.material = dark ? trim : body;
  });

  const built = make(lit);
  // A face, covered. Re-materialling the head was not enough on its own: the
  // nose, brows and jaw are still there in the geometry, and under the warm
  // light of a hall they read as a man's face in a dark helmet. The stone
  // draft already wears a blank slab; every other draft gets one in its own
  // trim, set just behind its eye light so the light still shows.
  if (spec.shell !== 'stone') {
    piece(built.group, new THREE.BoxGeometry(0.3, 0.34, 0.1), trim, 0, 1.6, 0.11);
  }
  enemy.group.add(built.group);
  // The boss's own visor takes the ward's colour, so the firing telegraph and
  // the shell are obviously the same creature.
  if (enemy.visorMat) enemy.visorMat.emissive.setHex(spec.color);

  let t = Math.random() * 6;
  return {
    group: built.group,
    update(dt, e) {
      t += dt * (e && e._enraged ? 3.4 : 1.5);
      const pulse = 1.35 + Math.sin(t) * 0.55 + Math.sin(t * 2.7) * 0.18;
      lit.emissiveIntensity = pulse * (e && e._enraged ? 1.9 : 1);
      if (built.spin) for (const m of built.spin) m.rotation.z += dt * (e && e._enraged ? 14 : 5);
      if (built.ring) built.ring.rotation.y += dt * 0.35;
    },
    dispose() {
      built.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      lit.dispose();
    }
  };
}
