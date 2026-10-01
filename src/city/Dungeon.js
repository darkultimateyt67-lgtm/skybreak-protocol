import * as THREE from 'three';
import { dressMaterials, dressHall, digCamp, deepHall } from './Undercroft.js';

/**
 * The Undercity — built halls beneath GTAZ.
 *
 * These were raw caves: rings of rotated boxes standing in for boulders. The
 * problem with that is not that boulders are wrong, it is that a pile of
 * irregular lumps has no readable scale and nothing for the eye to measure
 * against, so a big cave and a small one look identical and both look like
 * rubble. Architecture fixes that for free — a flagstone is always about a
 * metre, a baluster is always about waist height, so the moment you put a
 * railing and a tiled floor in a room, the room has a size.
 *
 * So this is masonry now: flagstone floors, panelled walls with carved
 * insets, pillars with bases and capitals, balustrades along the drops, and
 * a lit chasm underneath it all. Bigger too — chambers are roughly three
 * times the floor area they were, with ceilings at 14 m instead of 9.
 *
 * COST. Nearly all of this is decoration, and decoration must not be solid:
 * a physics box per flagstone would put tens of thousands of colliders in the
 * broadphase, which every raycast in the game then walks. Only the things you
 * can actually walk into — walls, pillars, plinths — collide. Everything else
 * is `collide: false` and gets swallowed by the city's static merge, so the
 * whole underworld still costs a handful of draw calls.
 */

const DEPTH = -60;              // floor level of every hall
const CHAMBER_H = 14.0;         // was 9 — the rooms are properly tall now
const SLAB = 2.6;               // flagstone size, and the module everything uses
// How far down the lit floor of a chasm sits. Deliberately shallow: at 26 m
// the glow was completely hidden behind the parapet from anywhere you could
// actually stand, so the most striking thing in the room was invisible. At 13
// it lights the parapet and the columns behind it from below, which is the
// whole point of having it.
const CHASM_DROP = 9;

/** One contract per hall, so each has its own reason to exist. */
const CAVE_DEFS = [
  {
    id: 'hollow', name: 'THE WEEPING HOLLOW', x: -320, z: 240,
    chambers: 4, tint: 0x5a5148, glow: 0x2fd88a,
    mission: {
      title: 'THE WEEPING HOLLOW',
      brief: 'Something is down there taking people. Go in, find what is at the bottom, kill it, come back.',
      objective: 'RELIC', pay: 900, threat: 1
    }
  },
  {
    id: 'marrow', name: 'MARROW DEEP', x: 480, z: -180,
    chambers: 6, tint: 0x4c4640, glow: 0x36c8ff,
    mission: {
      title: 'MARROW DEEP',
      brief: 'The old dig went too far and hit something. Bring back the core sample and whatever is guarding it can stay.',
      objective: 'CORE SAMPLE', pay: 1400, threat: 2
    }
  },
  {
    id: 'emberfall', name: 'EMBERFALL', x: -560, z: -420,
    chambers: 5, tint: 0x6b4a3a, glow: 0xff7a2e,
    mission: {
      title: 'EMBERFALL',
      brief: 'Heat is coming up through the floor and so is everything living in it. Take the ember and get out before it finds you.',
      objective: 'EMBER HEART', pay: 1200, threat: 2
    }
  },
  {
    id: 'saltmaw', name: 'SALTMAW', x: 300, z: 520,
    chambers: 5, tint: 0x54606b, glow: 0x4fe0d0,
    mission: {
      title: 'SALTMAW',
      brief: 'Sea caves under the strip. The tide brought something in with it. Retrieve the drowned cache.',
      objective: 'DROWNED CACHE', pay: 1100, threat: 2
    }
  },
  {
    id: 'gravemouth', name: 'GRAVEMOUTH', x: 700, z: 180,
    chambers: 7, tint: 0x3f3a44, glow: 0x9a6bff,
    mission: {
      title: 'GRAVEMOUTH',
      brief: 'The deepest one. Nobody who has gone in has come back up. Prove them wrong and bring the crown.',
      objective: 'BONE CROWN', pay: 2200, threat: 3
    }
  }
];

export class Cave {
  constructor(city, def) {
    this.city = city;
    this.world = city.world;
    this.game = city.game;
    this.def = def;
    this.name = def.name;
    this.mission = def.mission;
    this.chambers = [];
    this.cleared = false;
    this.objective = null;
    this.torches = [];
  }

  /**
   * Hall centres on a wandering path. Steps are much longer than they were,
   * because the halls themselves are much wider — at the old 34 m spacing
   * a 24 m room would have overlapped its neighbour.
   */
  _path(rand) {
    const pts = [{ x: 0, z: 0 }];
    let ang = -Math.PI / 2;
    // No hall may land on top of an earlier one. With enough halls a random
    // walk WILL fold back on itself — GRAVEMOUTH's seven did, and the two that
    // overlapped shared a wall through the middle of the great hall, leaving
    // half of it walled off. The largest hall is 34 m, so two of them need
    // 68 m plus wall thickness between centres to stay clear of each other.
    const MIN_SEP = 80;
    for (let i = 1; i < this.def.chambers; i++) {
      const p = pts[i - 1];
      let placed = null;
      for (let tries = 0; tries < 24 && !placed; tries++) {
        // Widen the search as attempts fail rather than re-rolling the same
        // narrow cone, so a boxed-in path can still escape.
        const turn = (rand() - 0.5) * (2.0 + tries * 0.22);
        const step = 74 + rand() * 26 + tries * 3;
        const a = ang + turn;
        const cand = { x: p.x + Math.cos(a) * step, z: p.z + Math.sin(a) * step };
        let ok = true;
        for (const q of pts) {
          if (Math.hypot(cand.x - q.x, cand.z - q.z) < MIN_SEP) { ok = false; break; }
        }
        if (ok) { placed = cand; ang = a; }
      }
      // Nothing fit in 24 tries: push straight on, which is always clear
      // because the path has never doubled back on this heading.
      if (!placed) {
        placed = { x: p.x + Math.cos(ang) * (MIN_SEP + 12), z: p.z + Math.sin(ang) * (MIN_SEP + 12) };
      }
      pts.push(placed);
    }
    return pts;
  }

  // ---------------------------------------------------------------- masonry

  /**
   * A flagged floor. Slabs are laid on a grid, inset slightly from each other
   * so the gaps read as mortar lines, with per-slab tone and a few millimetres
   * of height variation so the surface catches light unevenly. That variation
   * is doing most of the work — a perfectly flat tiled plane reads as a
   * texture, an uneven one reads as stone somebody laid badly a long time ago.
   *
   * None of these collide. One flat collider underneath carries the floor.
   */
  _flagstones(cx, cz, radius, rand, mats, holeHalf = 0) {
    const w = this.world;
    const n = Math.ceil(radius / SLAB);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = cx + i * SLAB;
        const z = cz + j * SLAB;
        const r = Math.hypot(i * SLAB, j * SLAB);
        if (r > radius + SLAB) continue;
        // Don't pave over the drop.
        if (holeHalf && Math.abs(i * SLAB) < holeHalf && Math.abs(j * SLAB) < holeHalf) continue;
        // A ring of broken edge where the floor meets the wall.
        const edge = r > radius - SLAB * 1.5;
        if (edge && rand() > 0.72) continue;
        const t = rand();
        const mat = t < 0.18 ? mats.slabDark : t > 0.84 ? mats.slabLight : mats.slab;
        const drop = rand() * 0.05;
        w._block(SLAB - 0.12, 0.25, SLAB - 0.12, x, DEPTH - 0.25 - drop, z, mat,
          { collide: false, shadow: false });
      }
    }
    // The one thing that actually holds you up.
    //
    // When there is a chasm this has to be a FRAME, not a slab. A single box
    // across the whole hall left the pit purely painted on: the floor was
    // still solid over it, so you walked on thin air above a visible drop.
    // Four boxes around a square opening give the hole a real edge.
    const R = radius * 1.2;
    if (holeHalf > 0) {
      const arm = R - holeHalf;
      w._block(R * 2, 0.9, arm, cx, DEPTH - 0.95, cz + (holeHalf + R) / 2, mats.slab,
        { surface: 'stone', visible: false });
      w._block(R * 2, 0.9, arm, cx, DEPTH - 0.95, cz - (holeHalf + R) / 2, mats.slab,
        { surface: 'stone', visible: false });
      w._block(arm, 0.9, holeHalf * 2, cx + (holeHalf + R) / 2, DEPTH - 0.95, cz, mats.slab,
        { surface: 'stone', visible: false });
      w._block(arm, 0.9, holeHalf * 2, cx - (holeHalf + R) / 2, DEPTH - 0.95, cz, mats.slab,
        { surface: 'stone', visible: false });
    } else {
      w._block(R * 2, 0.9, R * 2, cx, DEPTH - 0.95, cz, mats.slab,
        { surface: 'stone', visible: false });
    }
  }

  /**
   * Panelled wall running around the hall.
   *
   * Each bay is three pieces: the wall itself, a recessed panel a little
   * proud of it, and a carved inset in the middle of that. The inset is the
   * only emissive thing down here besides the torches, so the gold catches
   * the eye at the exact height a doorway would be — which is what makes a
   * wall read as built rather than poured.
   */
  _wall(cx, cz, radius, rand, mats, doors = []) {
    const w = this.world;
    const bays = Math.max(16, Math.round(radius * 0.9));
    // Half-width of a doorway, in radians at this radius. Doors are cut to a
    // fixed METRIC width so a great hall's door is the same size as a small
    // one's — a door that scaled with the room would destroy the sense of
    // scale the masonry exists to create.
    const doorHalf = Math.atan2(5.0, radius);
    for (let i = 0; i < bays; i++) {
      const a = (i / bays) * Math.PI * 2;
      const bw = (Math.PI * 2 * radius) / bays + 0.5;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      const rotY = -a + Math.PI / 2;

      // Is this bay part of a doorway? The wall used to be an unbroken ring,
      // and the passages only got in because they were driven from centre to
      // centre and happened to punch through it — which also planted a 7 m
      // tunnel ceiling and two tunnel walls right across the middle of every
      // hall. Cutting proper openings is what lets the passages stop at the
      // rim where they belong.
      let inDoor = false;
      for (const d of doors) {
        let diff = a - d;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < doorHalf) { inDoor = true; break; }
      }
      if (inDoor) {
        // Arch over the opening: jambs are handled by the neighbouring bays,
        // so this is the lintel and the wall above it.
        w._block(bw, CHAMBER_H - 7.4, 2.2, x, DEPTH + 7.4, z, mats.wall,
          { surface: 'stone', rotY });
        w._block(bw, 0.7, 2.8, x, DEPTH + 6.7, z, mats.trim, { collide: false, rotY });
        continue;
      }

      // Wall block, full height. This is the only solid piece.
      w._block(bw, CHAMBER_H, 2.2, x, DEPTH, z, mats.wall, { surface: 'stone', rotY });

      // Recessed panel, proud of the wall face.
      const px = cx + Math.cos(a) * (radius - 1.15);
      const pz = cz + Math.sin(a) * (radius - 1.15);
      w._block(bw - 1.0, 5.2, 0.22, px, DEPTH + 1.6, pz, mats.panel,
        { collide: false, rotY, shadow: false });
      // Carved inset.
      if (rand() > 0.35) {
        w._block(bw - 2.6, 1.5, 0.12, px, DEPTH + 3.1, pz, mats.gold,
          { collide: false, rotY, shadow: false });
      }
      // A course of trim along the top of the wall, all the way round.
      w._block(bw, 0.5, 2.6, x, DEPTH + 7.0, z, mats.trim, { collide: false, rotY });
      w._block(bw, 0.35, 2.5, x, DEPTH + CHAMBER_H - 1.2, z, mats.trim,
        { collide: false, rotY, shadow: false });
    }
    // Ceiling.
    w._block(radius * 2.5, 1.4, radius * 2.5, cx, DEPTH + CHAMBER_H, cz, mats.wall,
      { surface: 'stone' });
  }

  /** Base, shaft, capital — the three pieces that make a box read as a column. */
  _pillar(x, z, mats) {
    const w = this.world;
    w._block(2.0, 0.5, 2.0, x, DEPTH, z, mats.trim, { surface: 'stone' });
    w._block(1.5, 0.35, 1.5, x, DEPTH + 0.5, z, mats.trim, { collide: false });
    w._block(1.25, CHAMBER_H - 2.2, 1.25, x, DEPTH + 0.85, z, mats.wall, { surface: 'stone' });
    w._block(1.6, 0.4, 1.6, x, DEPTH + CHAMBER_H - 1.35, z, mats.trim, { collide: false });
    w._block(2.1, 0.5, 2.1, x, DEPTH + CHAMBER_H - 0.95, z, mats.trim, { collide: false });
  }

  /**
   * A balustrade: posts at a fixed pitch with a rail over the top.
   *
   * This is the single most valuable object in the whole set, because it is
   * the only one whose real-world size everybody already knows. Put a railing
   * at the edge of a drop and the drop instantly has a depth.
   */
  _balustrade(cx, cz, radius, from, to, mats) {
    const w = this.world;
    const span = to - from;
    const posts = Math.max(3, Math.round((span * radius) / 1.5));
    // Balusters sit ON the kerb, so the gaps between them stay open. That gap
    // is the whole reason a balustrade reads as a balustrade — the first
    // version raised the kerb to full railing height to stop the player
    // walking into the pit, which worked and simultaneously buried every post
    // inside it, leaving a plain parapet wall. Collision and appearance are
    // separated below instead: an invisible blocker does the stopping.
    const KERB_TOP = DEPTH + 0.12;
    for (let i = 0; i <= posts; i++) {
      const a = from + (i / posts) * span;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      // Post: foot, waist, neck. Three boxes is enough to read as turned stone.
      w._block(0.34, 0.14, 0.34, x, KERB_TOP, z, mats.trim, { collide: false, shadow: false });
      w._block(0.2, 0.62, 0.2, x, KERB_TOP + 0.14, z, mats.trim, { collide: false, shadow: false });
      w._block(0.3, 0.12, 0.3, x, KERB_TOP + 0.76, z, mats.trim, { collide: false, shadow: false });
      // Rail segment, reaching to the next post.
      if (i < posts) {
        const a2 = from + ((i + 0.5) / posts) * span;
        const rx = cx + Math.cos(a2) * radius;
        const rz = cz + Math.sin(a2) * radius;
        const seg = (span * radius) / posts + 0.12;
        w._block(seg, 0.18, 0.4, rx, KERB_TOP + 0.88, rz, mats.trim,
          { collide: false, rotY: -a2 + Math.PI / 2, shadow: false });
      }
    }
    // The parapet the railing stands on, and the thing that keeps you out of
    // the drop. Full railing height and solid, deliberately: in the reference
    // the chasm is something you look INTO from behind a balustrade, not
    // somewhere you go. A knee-high kerb would just be a hole to fall down
    // and never climb out of — a 1.15 m parapet reads the same and works.
    const kerbs = Math.max(4, Math.round(span * radius / 2));
    for (let i = 0; i < kerbs; i++) {
      const a = from + ((i + 0.5) / kerbs) * span;
      const kx = cx + Math.cos(a) * radius;
      const kz = cz + Math.sin(a) * radius;
      const rotY = -a + Math.PI / 2;
      const seg = (span * radius) / kerbs + 0.4;
      // Visible kerb: low, so you see over it into the drop.
      w._block(seg, 0.42, 0.62, kx, DEPTH - 0.3, kz, mats.trim,
        { collide: false, rotY });
      // Invisible blocker at railing height. The chasm is something you look
      // INTO from behind a rail, not somewhere to fall down and never climb
      // out of, and a knee-high collider at 7x sprint speed stops nobody.
      w._block(seg, 1.4, 0.62, kx, DEPTH - 0.3, kz, mats.trim,
        { surface: 'stone', visible: false, rotY });
    }
  }

  /**
   * The lit drop. A shaft in the floor with a glowing floor far below it,
   * ringed by a balustrade.
   *
   * The glow is the reason to bother: it is the only light source down here
   * that is not a torch, so it colours the room from underneath and puts a
   * cold edge on everything the warm light doesn't reach. That contrast is
   * most of what makes the reference shot look like a place rather than a
   * model.
   */
  _chasm(cx, cz, radius, rand, mats) {
    const w = this.world;
    const inner = radius * 0.42;
    // The lit bottom, well below the floor.
    w._block(inner * 2.1, 1.0, inner * 2.1, cx, DEPTH - CHASM_DROP, cz, mats.glow,
      { collide: false });
    // Shaft walls, so you see stonework going down rather than a hole in space.
    const bays = Math.max(10, Math.round(inner * 1.6));
    for (let i = 0; i < bays; i++) {
      const a = (i / bays) * Math.PI * 2;
      const bw = (Math.PI * 2 * inner) / bays + 0.6;
      w._block(bw, CHASM_DROP, 1.6,
        cx + Math.cos(a) * inner, DEPTH - CHASM_DROP, cz + Math.sin(a) * inner,
        mats.wall, { collide: false, rotY: -a + Math.PI / 2 });
    }
    // A band of lit rock immediately below the floor line.
    //
    // The glowing floor alone was never visible: from standing height, seven
    // metres back from a waist-high rail, you are looking into a shaft at
    // about six degrees and you simply cannot see the bottom of it. All the
    // light was landing where nobody could ever be. This ring sits just under
    // the lip instead, so it underlights the balusters and the columns behind
    // them — which is the effect that makes the reference read as a place
    // rather than a room with a hole in it.
    const bandBays = Math.max(12, Math.round(inner * 1.8));
    for (let i = 0; i < bandBays; i++) {
      const a = (i / bandBays) * Math.PI * 2;
      const bw = (Math.PI * 2 * inner) / bandBays + 0.5;
      w._block(bw, 1.6, 0.5,
        cx + Math.cos(a) * (inner - 0.2), DEPTH - 1.9, cz + Math.sin(a) * (inner - 0.2),
        mats.glow, { collide: false, rotY: -a + Math.PI / 2, shadow: false });
    }
    this._balustrade(cx, cz, inner + 1.1, 0, Math.PI * 2, mats);
    return inner;
  }

  /** Broken slabs and chips of masonry, in the corners and along the walls. */
  _rubble(cx, cz, radius, rand, mats) {
    const w = this.world;
    const n = 14 + ((rand() * 14) | 0);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = radius * (0.55 + rand() * 0.42);
      const s = 0.3 + rand() * 0.9;
      w._block(s, s * (0.25 + rand() * 0.5), s * (0.7 + rand() * 0.6),
        cx + Math.cos(a) * r, DEPTH, cz + Math.sin(a) * r,
        rand() > 0.5 ? mats.slabDark : mats.trim,
        { collide: false, rotY: rand() * Math.PI, tiltX: (rand() - 0.5) * 0.3 });
    }
  }

  /** One hall. */
  _chamber(cx, cz, radius, rand, mats, opts = {}) {
    // The shaft radius has to be known before the floor is laid, so the floor
    // can be laid around it.
    const inner = opts.chasm ? radius * 0.42 : 0;
    this._flagstones(cx, cz, radius, rand, mats, inner * 0.95);
    this._wall(cx, cz, radius, rand, mats, opts.doors || []);

    // Pillars set in from the wall, on the module.
    const cols = Math.max(6, Math.round(radius * 0.45));
    const clearOf = (a, arc) => {
      for (const d of (opts.doors || [])) {
        let diff = a - d;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < arc) return false;
      }
      return true;
    };
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2 + 0.3;
      // A column planted in a doorway is a column you walk into in the dark.
      if (!clearOf(a, Math.atan2(6.5, radius))) continue;
      this._pillar(cx + Math.cos(a) * (radius - 4.5), cz + Math.sin(a) * (radius - 4.5), mats);
    }

    if (opts.chasm) this._chasm(cx, cz, radius, rand, mats);
    // Keep rubble and pillars out of the void.
    const clearOfHole = (x, z) => !inner || Math.hypot(x - cx, z - cz) > inner + 2.5;
    this._rubble(cx, cz, radius, rand, mats);

    // Torches on alternate pillars, at head height.
    const n = Math.max(3, Math.round(cols / 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      if (!clearOf(a, Math.atan2(6.0, radius))) continue;
      this._torch(cx + Math.cos(a) * (radius - 3.0), cz + Math.sin(a) * (radius - 3.0),
        rand, mats.bracket);
    }
  }

  /**
   * A vaulted passage between two halls. Same masonry vocabulary as the halls
   * so the two read as one building: flagged floor, panelled sides, a ribbed
   * ceiling, and the passage still bends so you cannot see one hall from the
   * other.
   */
  _tunnel(aIn, bIn, ra, rb, rand, mats) {
    const w = this.world;
    // Start and finish at the RIMS, not the centres. Running centre to centre
    // meant every passage bored 34 m into the great hall, leaving its walls
    // and its low ceiling standing in the middle of the room.
    const ux = bIn.x - aIn.x, uz = bIn.z - aIn.z;
    const full = Math.hypot(ux, uz) || 1;
    const a = { x: aIn.x + (ux / full) * (ra - 1.6), z: aIn.z + (uz / full) * (ra - 1.6) };
    const b = { x: bIn.x - (ux / full) * (rb - 1.6), z: bIn.z - (uz / full) * (rb - 1.6) };
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 4) return;
    const steps = Math.max(4, Math.round(len / 3.2));
    const nx = dx / len, nz = dz / len;
    const px = -nz, pz = nx;
    // The wobble has to vanish at both ends: it is multiplied by sin(t*PI),
    // which is already zero at t=0 and t=1, so the mouths line up with the
    // doorways while the middle still wanders enough to block the sightline.
    const bend = (rand() - 0.5) * 18;
    const half = 4.2;
    const H = 7.0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = Math.sin(t * Math.PI) * bend;
      const cx = a.x + dx * t + px * off;
      const cz = a.z + dz * t + pz * off;
      const rotY = Math.atan2(nx, nz);
      const seg = len / steps + 0.6;

      // Flagged floor, two slabs wide.
      for (const lane of [-1, 0, 1]) {
        w._block(SLAB - 0.1, 0.25, seg,
          cx + px * lane * SLAB, DEPTH - 0.25, cz + pz * lane * SLAB,
          rand() > 0.8 ? mats.slabDark : mats.slab, { collide: false, rotY, shadow: false });
      }
      w._block(half * 2.2, 0.9, seg, cx, DEPTH - 0.95, cz, mats.slab,
        { surface: 'stone', rotY, visible: false });

      // Side walls with a panel course.
      for (const side of [-1, 1]) {
        w._block(1.6, H, seg, cx + px * side * half, DEPTH, cz + pz * side * half,
          mats.wall, { surface: 'stone', rotY });
        w._block(0.2, 2.4, seg - 0.8,
          cx + px * side * (half - 0.85), DEPTH + 1.5, cz + pz * side * (half - 0.85),
          mats.panel, { collide: false, rotY, shadow: false });
      }
      // Ceiling, with a rib every few steps so the vault has rhythm.
      w._block(half * 2.2, 0.8, seg, cx, DEPTH + H, cz, mats.wall, { surface: 'stone', rotY });
      if (i % 4 === 0) {
        w._block(half * 2.3, 0.6, 0.7, cx, DEPTH + H - 0.6, cz, mats.trim,
          { collide: false, rotY });
        for (const side of [-1, 1]) {
          w._block(0.5, H - 1.0, 0.7,
            cx + px * side * (half - 0.9), DEPTH, cz + pz * side * (half - 0.9),
            mats.trim, { collide: false, rotY });
        }
      }
      // A torch every so often, or the passage is pitch black.
      if (i % 7 === 3) {
        this._torch(cx + px * (half - 1.3), cz + pz * (half - 1.3), rand, mats.bracket);
      }
    }
  }

  /** A wall torch. Kept as a handle so it can flicker. */
  _torch(x, z, rand, bracketMat) {
    const w = this.world;
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0x2a1408, emissive: 0xff9a3c, emissiveIntensity: 2.6, roughness: 0.5
    });
    w._block(0.16, 0.3, 0.16, x, DEPTH + 2.0, z, bracketMat, { collide: false });
    w._block(0.34, 0.5, 0.34, x, DEPTH + 2.3, z, bracketMat, { collide: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.95, 7), flameMat);
    flame.position.set(x, DEPTH + 3.3, z);
    w.group.add(flame);
    this.torches.push({ mesh: flame, mat: flameMat, phase: rand() * 10 });
  }

  build(rand) {
    const w = this.world;
    const d = this.def;
    const base = new THREE.Color(d.tint);

    // One palette per hall, and deliberately few entries: the city's static
    // merge batches by material, so every extra material is another draw call
    // for the whole underworld.
    const mats = {
      wall: new THREE.MeshStandardMaterial({ color: d.tint, roughness: 0.94, metalness: 0.03 }),
      panel: new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(0.78), roughness: 0.9, metalness: 0.05
      }),
      trim: new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(1.22), roughness: 0.82, metalness: 0.08
      }),
      slab: new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(1.05), roughness: 0.96
      }),
      slabDark: new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(0.72), roughness: 0.97
      }),
      slabLight: new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(1.32), roughness: 0.93
      }),
      gold: new THREE.MeshStandardMaterial({
        color: 0x2a2210, emissive: 0xffc65a, emissiveIntensity: 0.85,
        roughness: 0.45, metalness: 0.6
      }),
      glow: new THREE.MeshStandardMaterial({
        color: 0x0a1410, emissive: d.glow, emissiveIntensity: 2.4, roughness: 0.7
      }),
      void: new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1 }),
      bracket: new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.9, metalness: 0.3 })
    };

    const pts = this._path(rand);

    // Two passes. Sizes and connections have to be known for EVERY hall before
    // any wall goes up, because a wall needs to know where its doors are and a
    // door depends on the neighbour it leads to.
    const halls = pts.map((p, i) => {
      const last = i === pts.length - 1;
      return {
        x: d.x + p.x, z: d.z + p.z, y: DEPTH,
        // Roughly three times the floor area of the old caves, and the last
        // hall is the great one.
        radius: last ? 34 : 20 + rand() * 7,
        entry: i === 0, deep: last, index: i,
        doors: []
      };
    });
    for (let i = 1; i < halls.length; i++) {
      const A = halls[i - 1], B = halls[i];
      A.doors.push(Math.atan2(B.z - A.z, B.x - A.x));
      B.doors.push(Math.atan2(A.z - B.z, A.x - B.x));
    }

    for (const h of halls) {
      // A drop in every other middle hall — never the first (you arrive
      // standing there) or the last (the boss fight needs its floor).
      //
      // Deliberately NOT a dice roll. At a 45% chance per eligible hall this
      // produced exactly ONE chasm across all twenty-seven halls in the five
      // caves, which made the best-looking thing down here something almost
      // nobody would ever see. Alternating indices guarantees the spread.
      const chasm = !h.deep && !h.entry && (h.index % 2 === 1);
      this._chamber(h.x, h.z, h.radius, rand, mats, { chasm, doors: h.doors });
      this.chambers.push(h);
    }
    for (let i = 1; i < halls.length; i++) {
      const A = halls[i - 1], B = halls[i];
      this._tunnel(A, B, A.radius, B.radius, rand, mats);
    }

    // --- What stands in the halls ------------------------------------------
    // Braziers, banners, bones and the wardens' inscriptions; the dig crew's
    // camp in the hall they broke into; the statues and the sealed gate in
    // the deep one. See Undercroft.js, and Undercity.js for what it all says.
    const M = dressMaterials(d.tint, d.glow);
    const story = this.city.undercity || null;
    for (const h of this.chambers) {
      dressHall(this, h, rand, mats, M, story);
      if (h.entry) digCamp(this, h, rand, mats, M);
      if (h.deep) deepHall(this, h, rand, mats, M);
    }

    // The prize, on a stepped plinth in the great hall.
    const deep = this.chambers[this.chambers.length - 1];
    const prizeMat = new THREE.MeshStandardMaterial({
      color: 0x2a2410, emissive: 0xffd24a, emissiveIntensity: 2.2,
      roughness: 0.3, metalness: 0.7
    });
    w._block(4.4, 0.4, 4.4, deep.x, DEPTH, deep.z, mats.trim, { surface: 'stone' });
    w._block(3.2, 0.4, 3.2, deep.x, DEPTH + 0.4, deep.z, mats.trim, { surface: 'stone' });
    w._block(2.2, 0.5, 2.2, deep.x, DEPTH + 0.8, deep.z, mats.wall, { surface: 'stone' });
    w._block(1.1, 1.1, 1.1, deep.x, DEPTH + 1.3, deep.z, prizeMat, { collide: false });
    this.objective = {
      x: deep.x, y: DEPTH + 1.9, z: deep.z,
      taken: false, label: d.mission.objective
    };

    // --- Surface: a built gatehouse, not a hole ----------------------------
    const entry = this.chambers[0];
    const gateMat = new THREE.MeshStandardMaterial({
      color: base.clone().multiplyScalar(0.85), roughness: 0.93
    });
    // Two piers and a lintel, so the entrance reads as a door from a distance.
    for (const side of [-1, 1]) {
      w._block(2.2, 6.0, 2.2, d.x + side * 4.0, 0, d.z, gateMat, { surface: 'stone' });
      w._block(2.8, 0.6, 2.8, d.x + side * 4.0, 6.0, d.z, mats.trim, { collide: false });
    }
    w._block(10.4, 1.8, 2.4, d.x, 6.0, d.z, gateMat, { surface: 'stone' });
    w._block(11.0, 0.5, 2.8, d.x, 7.8, d.z, mats.trim, { collide: false });
    // Steps down into the dark.
    for (let i = 0; i < 4; i++) {
      w._block(6.0 - i * 0.4, 0.4, 1.4, d.x, -0.4 * i, d.z + 1.6 + i * 1.3, mats.trim,
        { surface: 'stone' });
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1 });
    w._block(5.6, 5.2, 0.8, d.x, 0, d.z - 0.6, dark, { collide: false });
    this._torchSurface(d.x - 4.0, d.z - 1.6, rand, mats.bracket);
    this._torchSurface(d.x + 4.0, d.z - 1.6, rand, mats.bracket);

    // A beacon you can see from across town. Five entrances in a 2 km city is
    // a needle in a haystack otherwise.
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffc24a, transparent: true, opacity: 0.24, depthWrite: false
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.2, 160, 10, 1, true), beamMat);
    beam.position.set(d.x, 80, d.z);
    w.group.add(beam);
    this.beam = beam;

    this.hatch = { x: d.x, z: d.z };
    this.entryPoint = { x: entry.x, y: DEPTH + 0.8, z: entry.z };
    this.exitPoint = { x: d.x, y: 0.6, z: d.z + 9 };
    return this;
  }

  /** Same torch, but at street level rather than hall level. */
  _torchSurface(x, z, rand, bracketMat) {
    const w = this.world;
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0x2a1408, emissive: 0xff9a3c, emissiveIntensity: 2.6, roughness: 0.5
    });
    w._block(0.34, 0.5, 0.34, x, 3.0, z, bracketMat, { collide: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.95, 7), flameMat);
    flame.position.set(x, 4.0, z);
    w.group.add(flame);
    this.torches.push({ mesh: flame, mat: flameMat, phase: rand() * 10 });
  }

  /** Torch flicker. Cheap, and it does more for a hall than any texture. */
  update(dt, t) {
    for (const tr of this.torches) {
      tr.mat.emissiveIntensity = 2.0 + Math.sin(t * 9 + tr.phase) * 0.5
        + Math.sin(t * 21 + tr.phase * 2) * 0.25;
    }
  }

  get size() { return this.chambers.length; }
  get rooms() { return this.chambers; }
}

export function buildDungeons(city, rand) {
  return CAVE_DEFS.map((d) => new Cave(city, d).build(rand));
}

export { DEPTH as DUNGEON_DEPTH, CAVE_DEFS };
