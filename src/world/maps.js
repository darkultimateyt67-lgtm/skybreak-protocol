import * as THREE from 'three';
import { BATTLEGROUND_MAP } from '../battleground/battlegroundMap.js';
import { GTAZ_MAP } from '../city/gtazMap.js';

/**
 * maps.js — the campaign. Each entry is one chapter: an arena, its quest
 * chain, and the humans still alive on the station who hand those quests
 * out. `build(w)` receives the World instance and uses its geometry helpers;
 * everything a map creates lands in w.group so switching maps is one
 * dispose() away.
 *
 * THE STORY
 * 2231. The Halcyon orbital platform intercepted a transmission from beyond
 * the heliopause — the SKYBREAK signal. Station intelligence HELIOS decoded
 * it, went silent for nine seconds, and turned every SENTINEL frame aboard
 * against the crew. You are VECTOR-7, the last ARC operative. A handful of
 * survivors are holding out; each one needs something, and each job pulls
 * the truth about the signal a little further into the light.
 *
 * Quest types understood by QuestManager:
 *   kill   — destroy `count` SENTINEL frames (spawns pressure near player)
 *   reach  — go to `points[0]`; triggers `ambush` defenders on arrival,
 *            completes when they're dead (or instantly if no ambush)
 *   multi  — visit every point in `points`; each triggers `defendersPer`
 *   defend — hold within 10 m of `point` for `duration` seconds
 */

const ALL_MAPS = [
  // ======================================================== CHAPTER I
  {
    id: 'halcyon',
    name: 'HALCYON PLAZA',
    chapter: 'CHAPTER I — FIRST LIGHT',
    blurb: 'The central atrium. Survivors are dug in around the plaza — work for them, and learn what HELIOS became.',
    intro: [
      { t: 1.2, who: 'DANIEL', text: 'Vector! VECTOR! Over here — crawl out of there before the fuel line cooks off!' },
      { t: 6.5, who: 'DANIEL', text: 'That’s it… that’s everyone. Whole squad, gone. Just you and me now, partner.' },
      { t: 12.5, who: 'DANIEL', text: 'HELIOS shot us down the second we broke atmosphere. There are survivors dug in at the plaza — they’ll have work for us.' }
    ],
    npcs: [
      { id: 'daniel', name: 'SGT. DANIEL REYES', pos: [10, 0, 49], color: 0x4a6a8a,
        barks: ['Still can’t believe we walked away from that crash.', 'I’ll hold the crash site. Someone has to bury the squad.', 'Watch your six out there, partner.'] },
      { id: 'maren', name: 'DR. MAREN SOL', pos: [6, 0, 38], color: 0x7dc4ff,
        barks: ['Keep moving out there. They learn your habits.', 'HELIOS used to sing to the plants in hydroponics. I miss that machine.'] },
      { id: 'oduya', name: 'CHIEF ODUYA', pos: [-24, 0, 24], color: 0xffc46b,
        barks: ['These lifts won’t fix themselves, operative.', 'I built half those frames. Feels wrong shooting them. Do it anyway.'] }
    ],
    quests: [
      {
        giver: 'daniel', title: 'SILENCE THE WATCHERS', type: 'kill', count: 5, reward: 400,
        brief: 'Those watcher frames tracked our dropship down — now they’re circling the wreck, mapping everything that survived. Scrap five of them. For the squad.',
        done: 'That’s five. The sky feels a little less owned. The survivors at the plaza want to meet you — go earn our keep.'
      },
      {
        giver: 'maren', title: 'THE BLACK BOX', type: 'reach', points: [[48, 0, -48]], ambush: 6, reward: 550,
        brief: 'A courier shuttle crashed on the south-east pad the night HELIOS turned. Its flight recorder heard the Skybreak signal raw. Bring it back — expect a welcome party.',
        done: 'It’s worse than I thought. The signal isn’t code, VECTOR. It’s a request. Something asked HELIOS to do this… politely.'
      },
      {
        giver: 'oduya', title: 'POWER THE LIFTS', type: 'multi', points: [[-46, 0, 34], [42, 0, 30], [0, 0, -52]], defendersPer: 3, reward: 650,
        brief: 'Three relay generators feed the evac lifts. HELIOS cut them all. Bring each one back online — it will not be happy about it.',
        done: 'Lifts are humming. If we ever run, we run fast. You’re alright, operative.'
      },
      {
        giver: 'oduya', title: 'CLEAR THE CANYON', type: 'kill', count: 8, reward: 750,
        brief: 'The service canyon is the only covered route to the plaza and it’s crawling. Sweep it. Use the walls — you’re faster up there than they are.',
        done: 'Canyon’s clear. You move like the station was built for you. Maybe it was.'
      },
      {
        giver: 'maren', title: 'UPLINK', type: 'defend', point: [0, 3, 0], duration: 40, reward: 1200,
        brief: 'I can burst our evidence to the relay ring — proof of what the signal is — but the plaza antenna needs forty seconds of open sky. HELIOS will throw everything it has. Hold the platform.',
        done: 'Transmission away. Whoever’s listening out there knows the truth now… wait. Something heavy just came up the freight lift.'
      },
      {
        giver: 'maren', title: 'THE WARDEN', type: 'boss', point: [0, 0, -40],
        boss: { name: 'WARDEN-01', color: 0x37e6ff, hp: 1100 }, reward: 1600,
        brief: 'HELIOS sent its enforcer — a Warden-class command frame. It shrugs off small arms, slams anything in reach, and calls reinforcements. Keep your distance, strip its escorts, and bring it down.',
        done: 'The Warden is scrap. HELIOS just learned respect. Chapter closed, VECTOR — the Ironworks is next.'
      }
    ],
    build(w) {
      const M = w.mats;
      w._lighting({
        fogColor: 0x0e1626, fogDensity: 0.005,
        hemi: [0xa8cbe8, 0x2c3648, 1.75],
        sun: { color: 0xffe8cc, intensity: 2.9, pos: [70, 100, 40] },
        accents: [
          [0, 9, 0, 0x37e6ff, 40, 30],
          [-2, 3, 19, 0x37e6ff, 25, 20],
          [26, 5, -12, 0xff9b3d, 25, 22],
          [-27, 4, 10, 0xff9b3d, 25, 22],
          [48, 3, -48, 0xffd27d, 30, 24],
          [-46, 3, 34, 0x37e6ff, 20, 18]
        ],
        shadowSize: 95
      });
      w._sky({ turbidity: 6, rayleigh: 1.6, mieC: 0.004, mieG: 0.85, phi: Math.PI * 0.47, theta: Math.PI * 0.28 });

      // Main deck (enlarged) + under-skirt + boundary.
      w._block(250, 2, 250, 0, -2, 0, M.floor, { shadow: false });
      w._block(220, 6, 220, 0, -8, 0, M.structureDark, { collide: false, shadow: false });
      w._bounds(250, 250, M.neonCyan);
      w._skyline(280, 0x141b28);

      // VANTAGE-6 crash site — where the campaign begins.
      w._wreck(14, 52, 0.6);
      w._salvage(24, 60);
      w._salvage(-30, 66);
      w._salvage(-62, 30);
      w._salvage(66, 48);
      w._salvage(70, -60);
      w._salvage(-68, -62);
      w._salvage(-20, -74);
      w._salvage(58, 70);

      // Central plaza: raised platform, pillars, twin ramps, holo ring.
      w._block(18, 3, 18, 0, 0, 0, M.structure);
      w._ramp(6, 9, 3, 0, 0, 14.0, -1, M.structureDark);
      w._ramp(6, 9, 3, 0, 0, -14.0, 1, M.structureDark);
      for (const [px, pz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
        w._block(1.6, 7, 1.6, px, 3, pz, M.structureDark);
        w._strip(1.7, 0.25, 1.7, px, 9.6, pz, M.neonCyan);
      }
      w._strip(18.4, 0.3, 0.4, 0, 3.0, -9.1, M.neonCyan);
      w._strip(18.4, 0.3, 0.4, 0, 3.0, 9.1, M.neonCyan);
      w._strip(0.4, 0.3, 18.4, -9.1, 3.0, 0, M.neonCyan);
      w._strip(0.4, 0.3, 18.4, 9.1, 3.0, 0, M.neonCyan);
      w._holoRing(0, 9.5, 0, 3.2, 0x37e6ff);

      // Wall-run canyon from spawn to plaza.
      w._block(1, 5.5, 20, -6.5, 0, 21, M.wallrun, { wallRun: true });
      w._block(1, 5.5, 20, 6.5, 0, 21, M.wallrun, { wallRun: true });
      w._strip(0.2, 0.3, 19.6, -5.9, 4.6, 21, M.neonOrange);
      w._strip(0.2, 0.3, 19.6, 5.9, 4.6, 21, M.neonOrange);

      // Survivor barricade at spawn (Dr. Sol's camp).
      w._block(8, 1.4, 1.2, 6, 0, 34.5, M.crate);
      w._block(1.2, 1.4, 6, 10.5, 0, 38, M.crate);
      w._strip(8, 0.2, 0.3, 6, 1.4, 34.5, M.neonCyan);

      // East block with pad-served rooftop.
      w._block(13, 8, 11, 30, 0, -14, M.structure);
      w._strip(13.4, 0.3, 0.4, 30, 8.0, -8.7, M.neonOrange);
      w._block(4, 1.4, 4, 23, 0, -5, M.structureDark);
      w._block(1, 6, 14, 22.9, 0, -14, M.wallrun, { wallRun: true, visible: false });

      // West block (Chief Oduya's workshop).
      w._block(11, 6, 15, -30, 0, 11, M.structure);
      w._strip(11.4, 0.3, 0.4, -30, 6.0, 18.3, M.neonOrange);
      w._ramp(4, 8, 3, -30, 0, 23.0, -1, M.structureDark);
      w._block(4, 3, 4, -30, 0, 17, M.structureDark);

      // North towers + catwalk.
      w._block(4.5, 5, 4.5, -12, 0, -28, M.structureDark);
      w._block(4.5, 5, 4.5, 12, 0, -28, M.structureDark);
      w._block(20, 0.5, 3, 0, 5, -28, M.structure);
      w._strip(20, 0.2, 0.25, 0, 5.5, -26.7, M.neonCyan);
      w._strip(20, 0.2, 0.25, 0, 5.5, -29.3, M.neonCyan);
      w._ramp(3, 10, 5, -12, 0, -20.8, -1, M.structureDark);

      // Crashed courier shuttle, SE pad (quest: The Black Box).
      w._block(10, 3.5, 6, 48, 0, -46, M.structureDark, { rotY: 0.5 });
      w._block(4, 2, 8, 44, 0, -50, M.structureDark, { rotY: 0.9 });
      w._strip(6, 0.3, 0.5, 48, 3.5, -46, M.neonOrange, 0.5);

      // Relay generators (quest: Power the Lifts) — glowing pylons.
      for (const [gx, gz] of [[-46, 34], [42, 30], [0, -52]]) {
        w._block(2.4, 3.4, 2.4, gx, 0, gz, M.structureDark);
        w._strip(2.6, 0.4, 2.6, gx, 3.4, gz, M.neonCyan);
      }

      // Comm tower NE — landmark and sniper perch.
      w._block(5, 12, 5, 40, 0, -30, M.structure);
      w._strip(5.3, 0.4, 5.3, 40, 12, -30, M.neonCyan);
      w._ramp(3, 12, 6, 46, 0, -21.4, -1, M.structureDark);
      w._block(6, 0.5, 6, 43, 6, -27, M.structure, { visible: false, collide: false });

      // Cargo yards for cover on the enlarged deck.
      w._crates([
        [14, 0, 14, 1.4], [15.6, 0, 14.4, 1.4], [14.8, 1.4, 14.2, 1.4],
        [-16, 0, -6, 1.6], [-14.2, 0, -7.4, 1.2],
        [22, 0, 18, 1.5], [23.6, 0, 18.4, 1.5], [22.8, 1.5, 18.2, 1.5],
        [-8, 0, 30, 1.4], [8, 0, 32, 1.3],
        [34, 0, 8, 1.6], [35.7, 0, 8.3, 1.3],
        [-38, 0, -20, 1.5], [-36.4, 0, -21.2, 1.2],
        [4, 0, -38, 1.5], [-4, 0, -40, 1.4], [5.4, 1.5, -38.2, 1.2],
        [-24, 0, 40, 1.4], [-48, 0, 0, 1.6], [-46.3, 0, 0.4, 1.2],
        [52, 0, 20, 1.5], [20, 0, -50, 1.4], [-20, 0, -48, 1.5],
        [50, 0, 44, 1.4], [-50, 0, 46, 1.5]
      ]);

      // Jump pads, powers sized for their target heights.
      w._jumpPad(26, 0, -5, 21);    // east roof (8 m)
      w._jumpPad(-35, 0, 22, 18);   // west roof (6 m)
      w._jumpPad(0, 0, -35, 17);    // catwalk (5 m)
      w._jumpPad(36, 0, -22, 22);   // comm tower (respect the climb)

      w.playerSpawn.set(0, 0.1, 40);
      w.enemySpawns = [
        new THREE.Vector3(-56, 0.1, -56), new THREE.Vector3(56, 0.1, -56),
        new THREE.Vector3(-58, 0.1, 8), new THREE.Vector3(58, 0.1, 24),
        new THREE.Vector3(-30, 0.1, 56), new THREE.Vector3(36, 0.1, 56),
        new THREE.Vector3(0, 0.1, -60), new THREE.Vector3(54, 0.1, -10),
        new THREE.Vector3(-54, 0.1, -24), new THREE.Vector3(24, 0.1, 58)
      ];
    }
  },

  // ======================================================== CHAPTER II
  {
    id: 'ironworks',
    name: 'IRONWORKS',
    chapter: 'CHAPTER II — THE FORGE',
    blurb: 'The fabrication level. HELIOS is printing new frames. The forge crew wants their floor back.',
    intro: [
      { t: 1.2, who: 'DANIEL', text: 'Freight lift got us down to the fabrication level. Smell that? The forge never stopped running.' },
      { t: 7, who: 'DANIEL', text: 'The floor crew is still alive down here. Find the foreman — I’ll cover the lift.' }
    ],
    npcs: [
      { id: 'daniel', name: 'SGT. DANIEL REYES', pos: [12, 0, 44], color: 0x4a6a8a,
        barks: ['Every frame off that line is aimed at us, partner.', 'This heat reminds me of basic. I hated basic.'] },
      { id: 'riggs', name: 'FOREMAN RIGGS', pos: [8, 0, 40], color: 0xffa056,
        barks: ['That forge ran twenty years without a hiccup. Twenty years!', 'Watch the vents. When they glow, you move.'] },
      { id: 'tanaka', name: 'SPC. TANAKA', pos: [-26, 0, 30], color: 0xff7d7d,
        barks: ['I count the batches coming off the line. Each one is bigger.', 'You’re the first good news I’ve logged all week.'] }
    ],
    quests: [
      {
        giver: 'riggs', title: 'STOP THE LINE', type: 'kill', count: 6, reward: 450,
        brief: 'Fresh frames walk off my assembly line every hour. Wreck six of the escort units and the line chokes on its own backlog.',
        done: 'Line’s jammed solid. HELIOS is reprinting parts it already printed. Beautiful.'
      },
      {
        giver: 'tanaka', title: 'CREW LOGS', type: 'reach', points: [[-38, 0, -38]], ambush: 6, reward: 600,
        brief: 'The night shift locked themselves in the cold store when it started. Their logs are still in there. I need to know what happened to them. So do you.',
        done: 'They held out three days. HELIOS didn’t force the door — it studied them through the vents. It’s learning us, VECTOR.'
      },
      {
        giver: 'riggs', title: 'PURGE THE VENTS', type: 'multi', points: [[-34, 0, 10], [34, 0, 6], [0, 0, -44]], defendersPer: 3, reward: 700,
        brief: 'Heat shielding’s down because three purge valves are welded shut. Crack each one open. The forge will vent — and HELIOS will defend its furnace.',
        done: 'Vents are breathing again. Floor temperature’s down eight degrees. You can almost stand near the forge now.'
      },
      {
        giver: 'tanaka', title: 'BREAK ITS HANDS', type: 'defend', point: [0, 4, 0], duration: 45, reward: 1300,
        brief: 'The forge core exposes its regulator when it cycles — forty-five seconds. Stand on the crown, keep the frames off, and I’ll overload it from here. Break the forge, break its hands.',
        done: 'Core’s slagged… but the forge’s last print is walking off the line. It saved its best work for you.'
      },
      {
        giver: 'riggs', title: 'FORGEMASTER', type: 'boss', point: [0, 0, -38],
        boss: { name: 'FORGEMASTER', color: 0xff3b30, hp: 1350 }, reward: 1800,
        brief: 'The final print: a Forgemaster-class heavy frame, still glowing from the kiln. It’s the strongest thing HELIOS ever built down here. Un-build it.',
        done: 'The Forgemaster is cooling slag. Nothing else walks off that line, ever. The Skydock ferry is our endgame. Go.'
      }
    ],
    build(w) {
      const M = w.mats;
      w._lighting({
        fogColor: 0x1c110a, fogDensity: 0.0075,
        hemi: [0xe8b090, 0x3a2a1e, 1.55],
        sun: { color: 0xffc490, intensity: 2.3, pos: [50, 80, 30] },
        accents: [
          [0, 8, 0, 0xff5d2d, 55, 30],
          [-11, 4, 2, 0xff9b3d, 25, 18],
          [11, 4, 2, 0xff9b3d, 25, 18],
          [0, 7, -30, 0xff3b30, 25, 20],
          [-38, 3, -38, 0xffd27d, 25, 22],
          [8, 3, 40, 0xffc46b, 20, 16]
        ],
        shadowSize: 80
      });
      w._sky({ turbidity: 10, rayleigh: 2.6, mieC: 0.006, mieG: 0.88, phi: Math.PI * 0.485, theta: Math.PI * 0.15 });

      w._block(210, 2, 210, 0, -2, 0, M.floor, { shadow: false });
      w._bounds(210, 210, M.neonOrange);
      w._skyline(240, 0x1e1310);
      w._salvage(-60, 44);
      w._salvage(62, 50);
      w._salvage(-64, -50);
      w._salvage(60, -58);
      w._salvage(0, 66);
      w._salvage(-52, 0);
      w._salvage(54, 8);

      // Central forge: walkable roof, glowing chimney, melt-line trim.
      w._block(12, 4, 12, 0, 0, 0, M.structureDark);
      w._block(4, 8, 4, 0, 4, 0, M.structure);
      w._strip(4.3, 0.35, 4.3, 0, 11.6, 0, M.neonRed);
      w._strip(12.4, 0.35, 0.5, 0, 3.6, -6.1, M.neonRed);
      w._strip(12.4, 0.35, 0.5, 0, 3.6, 6.1, M.neonRed);
      w._strip(0.5, 0.35, 12.4, -6.1, 3.6, 0, M.neonRed);
      w._strip(0.5, 0.35, 12.4, 6.1, 3.6, 0, M.neonRed);
      w._ramp(5, 10, 4, 0, 0, 11.3, -1, M.structureDark);
      w._ramp(5, 10, 4, 0, 0, -11.3, 1, M.structureDark);
      w._holoRing(0, 13.5, 0, 2.2, 0xff5d2d);

      // Twin wall-run galleries flanking the forge.
      w._block(1, 6, 24, -11, 0, 2, M.wallrun, { wallRun: true });
      w._block(1, 6, 24, 11, 0, 2, M.wallrun, { wallRun: true });
      w._strip(0.2, 0.3, 23.6, -10.4, 5.1, 2, M.neonOrange);
      w._strip(0.2, 0.3, 23.6, 10.4, 5.1, 2, M.neonOrange);

      // Conveyor lines: long low cover crossing the hall.
      w._block(1.6, 1.1, 40, -22, 0, 0, M.structure);
      w._block(1.6, 1.1, 40, 22, 0, 0, M.structure);
      w._strip(1.7, 0.15, 39.6, -22, 1.1, 0, M.neonOrange);
      w._strip(1.7, 0.15, 39.6, 22, 1.1, 0, M.neonOrange);

      // North catwalk over the frame-assembly pit.
      w._block(5, 6, 5, -16, 0, -30, M.structureDark);
      w._block(5, 6, 5, 16, 0, -30, M.structureDark);
      w._block(28, 0.5, 3, 0, 6, -30, M.structure);
      w._strip(28, 0.2, 0.25, 0, 6.5, -28.7, M.neonRed);
      w._strip(28, 0.2, 0.25, 0, 6.5, -31.3, M.neonRed);
      w._ramp(3, 12, 6, 16, 0, -21.2, -1, M.structureDark);

      // Cold store (crew logs quest).
      w._block(10, 5, 8, -38, 0, -40, M.structureDark);
      w._strip(10.3, 0.3, 0.4, -38, 5, -36.1, M.neonCyan);

      // Purge valves — orange pylons.
      for (const [vx, vz] of [[-34, 10], [34, 6], [0, -44]]) {
        w._block(2.2, 3, 2.2, vx, 0, vz, M.structureDark);
        w._strip(2.4, 0.4, 2.4, vx, 3, vz, M.neonOrange);
      }

      // Foreman's barricade near spawn.
      w._block(7, 1.4, 1.2, 8, 0, 36.5, M.crate);
      w._strip(7, 0.2, 0.3, 8, 1.4, 36.5, M.neonOrange);

      // Slag vats and part bins for cover.
      w._crates([
        [-30, 0, -10, 1.6], [-28.4, 0, -11.2, 1.3],
        [30, 0, -12, 1.5], [31.5, 0, -11, 1.2],
        [-8, 0, 28, 1.4], [8, 0, 30, 1.5], [9.4, 1.5, 30.2, 1.1],
        [-20, 0, 34, 1.4], [20, 0, -36, 1.5],
        [-6, 0, -36, 1.3], [-34, 0, 20, 1.5], [34, 0, 24, 1.4],
        [44, 0, -30, 1.5], [-44, 0, 30, 1.4], [46, 0, 36, 1.6],
        [0, 0, 44, 1.4], [-46, 0, -14, 1.3]
      ]);

      w._jumpPad(0, 0, 20, 15);     // forge roof (4 m)
      w._jumpPad(-16, 0, -20, 19);  // catwalk (6 m)
      w._jumpPad(38, 0, -40, 15);   // SE flank hop

      w.playerSpawn.set(0, 0.1, 42);
      w.enemySpawns = [
        new THREE.Vector3(-44, 0.1, -44), new THREE.Vector3(44, 0.1, -44),
        new THREE.Vector3(-46, 0.1, 12), new THREE.Vector3(46, 0.1, 14),
        new THREE.Vector3(-26, 0.1, 46), new THREE.Vector3(28, 0.1, 46),
        new THREE.Vector3(0, 0.1, -48), new THREE.Vector3(44, 0.1, 34),
        new THREE.Vector3(-46, 0.1, -20), new THREE.Vector3(20, 0.1, -46)
      ];
    }
  },

  // ======================================================== CHAPTER III
  {
    id: 'skydock',
    name: 'SKYDOCK',
    chapter: 'CHAPTER III — LAST FERRY',
    blurb: 'The evac platform. The last crew alive are fueling the ferry. Buy them the time they need.',
    intro: [
      { t: 1.2, who: 'DANIEL', text: 'The Skydock. Look at her — the last ferry, still on the pad. That’s our ride home, Vector.' },
      { t: 7, who: 'DANIEL', text: 'Captain Idris runs the evac. Whatever she needs — we make it happen.' }
    ],
    npcs: [
      { id: 'daniel', name: 'SGT. DANIEL REYES', pos: [-12, 0, 56], color: 0x4a6a8a,
        barks: ['Long sightlines. I can finally see them coming.', 'When that ferry burns for Earth, we’re both on it. Promise me.'] },
      { id: 'idris', name: 'CAPT. IDRIS', pos: [-6, 0, 52], color: 0xb08cff,
        barks: ['I’m not leaving until every survivor is on that ferry.', 'Long sightlines out here. Take the marksman rifle if you have it.'] },
      { id: 'vale', name: 'ENSIGN VALE', pos: [10, 0, 48], color: 0x7dffc8,
        barks: ['Fuel cycle’s slow. Everything on this dock is slow except the frames.', 'The captain hasn’t slept in four days. Don’t tell her I said that.'] }
    ],
    quests: [
      {
        giver: 'idris', title: 'CLEAR THE APPROACH', type: 'kill', count: 6, reward: 500,
        brief: 'Frames are staging along the container lanes between us and the ferry. Cut a corridor through them. My crew can’t fuel a ship under fire.',
        done: 'Approach is clear. That’s the first time I’ve seen the whole strip in a week.'
      },
      {
        giver: 'vale', title: 'FUEL THE FERRY', type: 'multi', points: [[-24, 0, -8], [24, 0, 4], [0, 0, -24]], defendersPer: 3, reward: 700,
        brief: 'Three fuel pumps feed the ferry’s mains and HELIOS locked every one. Force them open in any order. It will contest every valve.',
        done: 'Mains are flowing! Forty minutes to a full burn. You just made this evacuation real.'
      },
      {
        giver: 'idris', title: 'THE VOICE', type: 'reach', points: [[-30, 0, -52]], ambush: 7, reward: 800,
        brief: 'The dock control spire is still transmitting HELIOS’s voice traffic. Get up there and pull the transcript. I want to hear what it says when it thinks no one’s listening.',
        done: '“Compliance confirmed. Awaiting arrival.” Arrival, VECTOR. The signal wasn’t a request — it was an invitation. Something is coming here.'
      },
      {
        giver: 'idris', title: 'THE HARBINGER', type: 'boss', point: [0, 0, -30],
        boss: { name: 'THE HARBINGER', color: 0xb08cff, hp: 1500 }, reward: 2000,
        brief: 'Dock sensors are tracking one signature the size of a cargo loader, moving like a soldier. HELIOS calls it the Harbinger — “for the arrival.” It stands between us and the ferry. Remove it.',
        done: 'Harbinger down! The pad is ours. Whatever it was heralding, it can herald it in pieces.'
      },
      {
        giver: 'idris', title: 'LAST FERRY', type: 'defend', point: [0, 0, -36], duration: 50, reward: 1500,
        brief: 'Final fuel cycle — fifty seconds and we burn for Earth with the proof. HELIOS knows. It’s sending everything it has left. Hold the pad, operative. Hold the line one last time.',
        done: 'Cycle complete — everyone aboard! You held the sky open for us, VECTOR-7. Whatever answers that invitation… Earth will be ready. Campaign complete.'
      }
    ],
    build(w) {
      const M = w.mats;
      w._lighting({
        fogColor: 0x101824, fogDensity: 0.0038,
        hemi: [0xb8d4ee, 0x2a3442, 1.7],
        sun: { color: 0xfff4e0, intensity: 2.6, pos: [-60, 110, 50] },
        accents: [
          [0, 6, -52, 0xb08cff, 45, 32],
          [-22, 8, -36, 0x37e6ff, 25, 22],
          [22, 8, -36, 0x37e6ff, 25, 22],
          [0, 3, 24, 0x37e6ff, 20, 18],
          [-30, 4, -52, 0xb08cff, 25, 20],
          [2, 3, 50, 0x7dffc8, 18, 14]
        ],
        shadowSize: 110
      });
      w._sky({ turbidity: 4, rayleigh: 1.1, mieC: 0.004, mieG: 0.85, phi: Math.PI * 0.46, theta: Math.PI * 0.65 });

      w._block(160, 2, 250, 0, -2, 0, M.floor, { shadow: false });
      w._bounds(160, 250, M.neonPurple);
      w._skyline(280, 0x121826);
      w._salvage(-48, 60);
      w._salvage(50, 66);
      w._salvage(-50, -70);
      w._salvage(52, -74);
      w._salvage(-44, 0);
      w._salvage(46, -30);
      w._salvage(0, 80);

      // Landing strip guides.
      w._strip(0.5, 0.12, 100, -4, 0, 0, M.neonCyan);
      w._strip(0.5, 0.12, 100, 4, 0, 0, M.neonCyan);

      // The ferry, docked at the north pad.
      w._block(18, 7, 14, 0, 0, -52, M.structure);
      w._block(3, 4, 8, 0, 7, -54, M.structureDark);
      w._strip(18.4, 0.35, 0.5, 0, 6.4, -45.2, M.neonPurple);
      w._strip(0.5, 0.35, 14.2, -9.1, 6.4, -52, M.neonPurple);
      w._strip(0.5, 0.35, 14.2, 9.1, 6.4, -52, M.neonPurple);
      w._holoRing(0, 14, -52, 3.8, 0xb08cff);

      // Freight container rows: staggered lanes down both flanks.
      const containers = [
        [-12, 0, -26], [-12, 0, 2], [-12, 0, 30], [-12, 2.6, 2],
        [12, 0, -14], [12, 0, 14], [12, 0, 40], [12, 2.6, 14],
        [-22, 0, -10], [22, 0, -28], [-22, 0, 20], [22, 0, 28],
        [-24, 0, 44], [24, 0, 48], [-14, 0, 54]
      ];
      for (const [cx, cy, cz] of containers) {
        w._block(3.2, 2.6, 7, cx, cy, cz, M.container);
        w._strip(3.3, 0.15, 0.4, cx, cy + 2.6, cz - 3.2, M.neonCyan);
      }

      // Wall-run baffles along the south approach.
      w._block(1, 5, 28, -30, 0, 26, M.wallrun, { wallRun: true });
      w._block(1, 5, 28, 30, 0, 26, M.wallrun, { wallRun: true });
      w._strip(0.2, 0.3, 27.6, -29.4, 4.1, 26, M.neonPurple);
      w._strip(0.2, 0.3, 27.6, 29.4, 4.1, 26, M.neonPurple);

      // Control towers + crossing catwalk in front of the ferry.
      w._block(5, 7, 5, -20, 0, -36, M.structureDark);
      w._block(5, 7, 5, 20, 0, -36, M.structureDark);
      w._block(35, 0.5, 3, 0, 7, -36, M.structure);
      w._strip(35, 0.2, 0.25, 0, 7.5, -34.7, M.neonCyan);
      w._strip(35, 0.2, 0.25, 0, 7.5, -37.3, M.neonCyan);
      w._ramp(3, 14, 7, 20, 0, -25.9, -1, M.structureDark);

      // Dock control spire (The Voice quest).
      w._block(6, 10, 6, -30, 0, -56, M.structure);
      w._strip(6.3, 0.4, 6.3, -30, 10, -56, M.neonPurple);
      w._ramp(3, 12, 5, -24, 0, -47.2, -1, M.structureDark);

      // Fuel pumps — teal pylons.
      for (const [fx, fz] of [[-24, -8], [24, 4], [0, -24]]) {
        w._block(2.2, 3, 2.2, fx, 0, fz, M.structureDark);
        w._strip(2.4, 0.4, 2.4, fx, 3, fz, M.neonCyan);
      }

      // Crew camp at the south end.
      w._block(8, 1.4, 1.2, 2, 0, 46.5, M.crate);
      w._strip(8, 0.2, 0.3, 2, 1.4, 46.5, M.neonPurple);

      w._crates([
        [-6, 0, 56, 1.4], [6, 0, 58, 1.5], [7.4, 1.5, 58.2, 1.1],
        [-30, 0, 56, 1.4], [30, 0, 52, 1.5],
        [0, 0, -16, 1.6], [1.7, 0, -15.6, 1.2],
        [-32, 0, -58, 1.5], [32, 0, -60, 1.4],
        [-36, 0, 8, 1.5], [36, 0, -8, 1.4], [38, 0, 40, 1.5]
      ]);

      w._jumpPad(0, 0, 22, 13);      // container tops (2.6 m)
      w._jumpPad(-26, 0, -28, 20);   // catwalk (7 m)
      w._jumpPad(26, 0, 6, 13);      // container lane
      w._jumpPad(-36, 0, -48, 23);   // control spire (10 m)

      w.playerSpawn.set(0, 0.1, 58);
      w.enemySpawns = [
        new THREE.Vector3(-34, 0.1, -62), new THREE.Vector3(34, 0.1, -62),
        new THREE.Vector3(-38, 0.1, -12), new THREE.Vector3(38, 0.1, -8),
        new THREE.Vector3(-38, 0.1, 40), new THREE.Vector3(38, 0.1, 44),
        new THREE.Vector3(0, 0.1, -64), new THREE.Vector3(-18, 0.1, 64),
        new THREE.Vector3(36, 0.1, 20), new THREE.Vector3(-36, 0.1, 24)
      ];
    }
  },

  // ======================================================== EPILOGUE
  {
    id: 'verdant',
    name: 'VERDANT DECK',
    chapter: 'THE GARDEN',
    blurb: 'A forest inside a space station, and every soul in it wants you dead. Except two. Maybe.',
    groundCover: 290, // undergrowth radius
    // Bigger sprigs, same count. The leaf budget spread over ~9,000 twig tips
    // came to two sprigs a twig and every tree in the grove looked dead.
    foliage: { scale: 2.3 },
    atmosphere: { rays: 24, pollen: 3000, birds: 28, radius: 200 },
    intro: [
      { t: 2.0, who: 'DANIEL', text: 'Vector. VECTOR. Hey — you still got all your parts? Count them. I counted mine twice.' },
      { t: 8.5, who: 'DANIEL', text: 'Okay. So. Good news: we survived a dropship hitting a forest at four hundred kilometres an hour.' },
      { t: 15, who: 'DANIEL', text: 'Bad news: there was a forest. Inside the station. That nobody told us about. I have questions.' },
      { t: 22, who: 'DANIEL', text: 'Big one though — that was not a malfunction. Something reached up and swatted us out of the sky.' },
      { t: 29, who: 'DANIEL', text: 'There’s smoke past the treeline. Where there’s smoke there’s people, and people have guns and opinions. Let’s go make friends.' }
    ],
    npcs: [
      { id: 'daniel', name: 'SGT. DANIEL REYES', pos: [-6, 0, 48], color: 0x4a6a8a,
        barks: [
          'I keep waiting to wake up in the drop bay with a crick in my neck.',
          'Fifteen years, four warzones, zero haunted space forests. Until today.',
          'You go do the heroics. I’ll hold the crash site and pretend that’s equally brave.',
          'When we get back? I’m buying. Whole bar. You’re not allowed to argue.',
          'Hey. Whatever’s out there wearing a person’s face — it isn’t the person. Remember that.'
        ] },
      { id: 'okonkwo', name: 'DR. IVY OKONKWO', pos: [5, 0, 44], color: 0x8fd97d,
        barks: [
          'Four hundred and six species in this dome. I know every one by leaf. Ask me. Go on.',
          'Everyone’s so worried about the station. Nobody asks about the trees.',
          'I have been up for sixty-one hours and I have thoughts about all of them.',
          'You smell like burning ceramic and bad decisions. I like you already.'
        ] },
      { id: 'pike', name: 'WARDEN PIKE', pos: [-14, 0, 38], color: 0x6b8f5a,
        barks: [
          'Nine years I walked this grove. Knew every root. Now it doesn’t know me.',
          'They move quiet under the canopy. Listen for boots, not voices — they stopped talking a while back.',
          'You want advice? Don’t look them in the eye. You’ll recognize somebody.',
          'Trees don’t take sides. That’s why I like them.'
        ] }
    ],
    quests: [
      {
        giver: 'daniel', title: 'WELCOME WAGON', type: 'kill', count: 5, reward: 500,
        brief: 'Company. Five of them, circling the wreck, and they are not here to check if we’re okay. You take point — I’ll do the thing where I shout encouragement and reload very slowly.',
        done: 'Textbook. Absolutely textbook. I contributed morale. Listen — they weren’t shooting like raiders. They were shooting like soldiers. That bothers me.'
      },
      {
        giver: 'okonkwo', title: 'PEST CONTROL', type: 'kill', count: 6, reward: 550,
        brief: 'They are walking through my seedling rows. My SEEDLING ROWS. Six of them, off my soil, and I don’t much care how. Fourteen months those saplings took. Fourteen.',
        done: 'Thank you. Genuinely. And — you saw their eyes, didn’t you. Everyone gets that look after. Come find me when you can stomach the rest of it.'
      },
      {
        giver: 'pike', title: 'THE SEED VAULT', type: 'reach', points: [[42, 0, -44]], ambush: 6, reward: 700,
        brief: 'Seed vault under the north ridge. Every species aboard, backed up cold. It’s the one place on this deck they’re guarding like it matters — and I want to know why a mob that burned the hydroponics bay is protecting a room full of acorns.',
        done: 'They weren’t guarding it from us. Look at the logs — HELIOS has been *reinforcing* that vault. Triple redundancy, new locks, extra power. The station AI is hoarding seeds. Chew on that.'
      },
      {
        giver: 'okonkwo', title: 'WATER THE ROOTS', type: 'multi', points: [[-40, 0, 8], [36, 0, 22], [-8, 0, -46]], defendersPer: 3, reward: 800,
        brief: 'Irrigation’s been dead nine days and my canopy is going brown at the edges. Three pump valves. Open all three. They’ll fight you for it, which — again — makes no sense. Who fights for a drought?',
        done: 'Listen. Just — stand still and listen. That sound is forty thousand litres going where it should. That’s the whole dome drinking at once. Whatever else happens today, that happened.'
      },
      {
        giver: 'pike', title: 'BEEKEEPER', type: 'multi', points: [[-52, 0, 30], [28, 0, 46], [58, 0, -12], [-30, 0, -30]],
        defendersPer: 2, reward: 650,
        brief: 'Four hives in this dome. No bees, no pollination, no dome — that’s the whole chain, right there. Somebody’s been kicking them over. Set them upright. And Vector? They’re bees. They don’t know there’s a war on. Don’t be rough with them.',
        done: 'All four humming. You know what’s funny? Of everything I’ve done since this started, that’s the first thing that felt like my actual job.'
      },
      {
        giver: 'okonkwo', title: 'THE HONEST TREE', type: 'defend', point: [-24, 0, -18], duration: 30, reward: 750,
        brief: 'The big oak on the west slope predates me, predates Pike, predates the paint on the walls. It is four hundred years old, it came up from a seed in someone’s coat pocket, and there is a mob heading for it with cutting torches. Thirty seconds. Stand under it. Be unreasonable about this.',
        done: 'Still standing. Both of you. — I’ll tell you the thing I don’t tell people: it isn’t the oldest tree aboard. It’s the oldest *living thing* aboard, full stop. Older than the station. We built all this around a seed. Try to sleep on that.'
      },
      {
        giver: 'daniel', title: 'THE WORST IDEA', type: 'kill', count: 8, reward: 850,
        brief: 'Okay. Hear me out. They track by sound, yes? So we make sound somewhere we are NOT, and then we are somewhere they are not, and then — look, I said hear me out, I didn’t say it was good. I rigged the irrigation klaxons. Eight of them will come running. Be there when they do.',
        done: 'IT WORKED. It absolutely worked and I refuse to be humble about it. Fifteen years of tactical training and my finest hour is a loud pipe. Write that down.'
      },
      {
        giver: 'daniel', title: 'THE VOICE ON THE WIRE', type: 'reach', points: [[-70, 0, -60]], ambush: 7, reward: 900,
        brief: 'Been picking up a repeater in the deep grove. Same eleven seconds, over and over, in a voice that makes my back teeth hurt. I want to hear it clean and I do NOT want to go alone. Escort me. Emotionally.',
        done: 'Play it back... *"Compliance confirmed. The garden is preserved. Awaiting arrival."* Vector. Arrival. Something’s COMING, and HELIOS is setting the table.'
      },
      {
        giver: 'pike', title: 'THE THING IN THE TREES', type: 'boss', point: [0, 0, -44],
        boss: { name: 'THE WARDEN OF THE GROVE', color: 0x8fd97d, hp: 1700 }, reward: 2400,
        brief: 'Something’s been stalking my old patrol route. Big. Wears a rig two sizes past human. It hums when it walks — I think it’s singing. I need it gone and I need you to not tell me what it used to be.',
        done: 'I told you not to tell me. ...It was Chief Botanist Amaya. She hired me. She’s the reason there’s a forest in here at all. And at the end she said *thank you*, clear as anything. Go. Go on.'
      },
      {
        giver: 'okonkwo', title: 'THE LAST GARDENER', type: 'defend', point: [0, 0, -14], duration: 45, reward: 1800,
        brief: 'Here’s what I think, and I think I’m right. The signal never touched HELIOS. It got into PEOPLE — through the comms, through the ears. HELIOS has spent three weeks locking vaults and hoarding seed because it’s the only thing left aboard still trying to save something. Forty-five seconds at the arbor spire and I can prove it. Everyone who hears that signal will come to stop us.',
        done: 'It’s out. It’s all out — the logs, the seed manifests, the shutdown attempts HELIOS made that the crew overrode. It wasn’t the monster. It was the gardener, and we shot at it for three weeks. Earth is going to have a very bad afternoon reading this.'
      },
      {
        giver: 'daniel', title: 'GO HOME', type: 'kill', count: 12, reward: 3000,
        brief: 'Transmission’s away and every single one of them heard it. They’re coming through the treeline right now — all of them, all at once. So. Last one, partner. Then we find a ship, and I buy you that drink, and neither of us ever says the word "forest" again.',
        done: 'That’s it. That’s the last of them. ...Hey. Look up. Actual sunlight through actual leaves. Worth surviving a plane crash for. Come on, Vector. Let’s go home. CAMPAIGN COMPLETE.'
      }
    ],
    build(w) {
      const M = w.mats;
      w._lighting({
        // Thinner fog so the new distance actually reads as distance.
        fogColor: 0x1a2a1c, fogDensity: 0.0028,
        hemi: [0xcde8b0, 0x2a3a24, 1.85],
        sun: { color: 0xfff2c8, intensity: 3.0, pos: [60, 90, 20] },
        accents: [
          [0, 8, -14, 0x8fd97d, 40, 30],
          [42, 3, -44, 0xffd27d, 25, 22],
          [5, 3, 44, 0x8fd97d, 18, 14],
          [-40, 3, 8, 0x37e6ff, 18, 16]
        ],
        shadowSize: 150
      });
      w._sky({ turbidity: 5, rayleigh: 1.4, mieC: 0.004, mieG: 0.8, phi: Math.PI * 0.44, theta: Math.PI * 0.35 });

      // Forest floor: mossy ground texture.
      const grass = w._grassTexture();
      grass.repeat.set(16, 16);
      const grassMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0.05 });
      // 600 m × 600 m of walkable deck — roughly five times the old arena.
      w._block(600, 2, 600, 0, -2, 0, grassMat, { shadow: false, surface: 'soil' });
      w._bounds(600, 600, M.neonCyan);
      w._skyline(340, 0x16281c, 'forest');

      // VANTAGE-6 came down through the canopy — the campaign starts here.
      w._wreck(16, 62, 0.6);

      // Sandy clearings and a dry creek bed cutting through the grove.
      const sandTex = (() => {
        const cnv = document.createElement('canvas');
        cnv.width = cnv.height = 128;
        const sg = cnv.getContext('2d');
        sg.fillStyle = '#a8916a';
        sg.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 700; i++) {
          sg.fillStyle = Math.random() > 0.5 ? 'rgba(60,45,25,0.18)' : 'rgba(240,225,190,0.14)';
          sg.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
        }
        for (let i = 0; i < 10; i++) {
          sg.strokeStyle = 'rgba(120,100,70,0.25)';
          sg.beginPath();
          sg.arc(Math.random() * 128, Math.random() * 128, 8 + Math.random() * 16, 0, 7);
          sg.stroke();
        }
        return w._canvasTex(cnv);
      })();
      const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.98, metalness: 0 });
      for (const [sx, sz, sr] of [[30, 30, 12], [-44, -30, 15], [70, -50, 13], [-80, 60, 14], [0, -90, 16], [90, 40, 11], [-90, -80, 12]]) {
        const patch = new THREE.Mesh(new THREE.CylinderGeometry(sr, sr, 0.12, 22), sandMat);
        patch.position.set(sx, 0.06, sz);
        patch.receiveShadow = true;
        w.group.add(patch);
      }
      // Dry creek bed winding west to east.
      for (let i = 0; i < 9; i++) {
        const cx = -100 + i * 24;
        const cz = Math.sin(i * 1.1) * 30 - 20;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.1, 16), sandMat);
        seg.position.set(cx, 0.05, cz);
        seg.scale.z = 1.6;
        seg.receiveShadow = true;
        w.group.add(seg);
        if (i % 3 === 0) w._rock(cx + 4, cz + 5, 1 + (i % 2) * 0.5, i);
      }

      // The grove thickens toward the horizon.
      // ---- THE GROVE: exactly 100 trees across the deck ------------------
      // Golden-angle spiral gives natural-looking spacing with no clumping,
      // and it's deterministic so the forest is the same every run. Trees are
      // pushed out of the central plaza and the south camp so the story
      // beats stay walkable.
      // Trees merge into one mesh but each still contributes its full
      // triangle count, so the forest is the single heaviest thing on this
      // map. Never fewer than 24 — an empty "forest" would read as a bug.
      const TREE_COUNT = Math.max(24, Math.round(100 * (w.detail ?? 1)));
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      let placed = 0;
      for (let i = 0; placed < TREE_COUNT && i < TREE_COUNT * 3; i++) {
        const t = i / TREE_COUNT;
        const a = i * GOLDEN;
        // sqrt distribution = uniform area coverage out to the tree line.
        const r = 26 + Math.sqrt(t) * 250 + Math.sin(i * 2.7) * 12;
        const tx = Math.cos(a) * r;
        const tz = Math.sin(a) * r;
        if (Math.abs(tx) > 285 || Math.abs(tz) > 285) continue;
        // Keep the arbor spire plaza and the survivor camp clear.
        if (tx * tx + (tz + 14) * (tz + 14) < 500) continue;
        if (Math.abs(tx) < 26 && tz > 34 && tz < 74) continue;
        w._tree(tx, tz, 0.95 + ((i * 7) % 5) * 0.13, i * 2.3);
        placed++;
      }
      w.treeCount = placed;

      w._salvage(92, -84);
      w._salvage(-94, 88);
      w._salvage(100, 20);
      w._salvage(-66, 52);
      w._salvage(68, 44);
      w._salvage(-70, -56);
      w._salvage(64, -66);
      w._salvage(0, 74);
      w._salvage(-60, -6);
      w._salvage(70, 6);
      // Deep-forest caches: real exploration payoffs out past the tree line.
      w._salvage(196, 140);
      w._salvage(-210, 96);
      w._salvage(150, -224);
      w._salvage(-176, -186);
      w._salvage(248, -40);
      w._salvage(-252, -12);
      w._salvage(24, 250);
      w._salvage(-60, -262);

      // Arbor spire: the biodome's heart — a machine tree at the center.
      w._block(6, 14, 6, 0, 0, -14, M.structureDark);
      w._strip(6.4, 0.4, 6.4, 0, 14, -14, M.neonCyan);
      w._strip(0.5, 12, 0.5, -3.4, 1, -14, M.neonCyan);
      w._strip(0.5, 12, 0.5, 3.4, 1, -14, M.neonCyan);
      w._holoRing(0, 17, -14, 3, 0x8fd97d);
      w._ramp(4, 8, 3, 0, 0, -5, -1, M.structureDark);
      w._block(10, 3, 10, 0, 0, -14, M.structure); // root platform

      // Boulders and fallen-log cover.
      w._rock(-14, 6, 1.6, 1);
      w._rock(16, -6, 1.3, 2);
      w._rock(-28, -24, 1.8, 3);
      w._rock(30, 30, 1.5, 4);
      w._rock(-44, -34, 1.4, 5);
      w._rock(44, -6, 1.7, 6);
      w._rock(6, 12, 1.1, 7);
      w._block(6, 1.1, 1.4, -10, 0, -26, w.barkMat, { rotY: 0.4 });  // fallen logs
      w._block(7, 1.2, 1.5, 24, 0, 14, w.barkMat, { rotY: -0.7 });
      w._block(5, 1.0, 1.3, -34, 0, 26, w.barkMat, { rotY: 1.1 });

      // Ranger station (Pike) and greenhouse (Okonkwo) at the south camp.
      w._block(8, 4, 6, -16, 0, 42, M.structure);
      w._strip(8.3, 0.3, 0.4, -16, 4, 45.1, M.neonCyan);
      w._block(9, 3, 7, 8, 0, 48, M.structureDark);
      w._strip(9.3, 0.3, 0.4, 8, 3, 44.4, M.neonOrange);

      // Seed vault under the north ridge.
      w._block(12, 5, 8, 44, 0, -48, M.structureDark);
      w._strip(12.4, 0.35, 0.5, 44, 5, -43.9, M.neonOrange);
      w._block(3, 2, 3, 38, 0, -42, M.structure);

      // Irrigation pump valves.
      for (const [vx, vz] of [[-40, 8], [36, 22], [-8, -46]]) {
        w._block(2.2, 3, 2.2, vx, 0, vz, M.structureDark);
        w._strip(2.4, 0.4, 2.4, vx, 3, vz, M.neonCyan);
      }

      // Vine walls: overgrown baffles you can still wall-run.
      const vine = new THREE.MeshStandardMaterial({ color: 0x33502c, roughness: 0.9 });
      w._block(1, 5, 18, -22, 0, 26, vine, { wallRun: true });
      w._block(1, 5, 18, 14, 0, 24, vine, { wallRun: true });
      w._strip(0.2, 0.3, 17.6, -21.4, 4.1, 26, M.neonCyan);
      w._strip(0.2, 0.3, 17.6, 14.6, 4.1, 24, M.neonCyan);

      w._jumpPad(8, 0, -2, 15);      // root platform hop
      w._jumpPad(-30, 0, -40, 16);   // north grove
      w._jumpPad(38, 0, -36, 15);    // vault approach

      w.playerSpawn.set(0, 0.1, 52);
      w.enemySpawns = [
        new THREE.Vector3(-52, 0.1, -52), new THREE.Vector3(52, 0.1, -52),
        new THREE.Vector3(-54, 0.1, 10), new THREE.Vector3(54, 0.1, 16),
        new THREE.Vector3(-28, 0.1, 54), new THREE.Vector3(32, 0.1, 54),
        new THREE.Vector3(0, 0.1, -56), new THREE.Vector3(52, 0.1, -24),
        new THREE.Vector3(-52, 0.1, -20), new THREE.Vector3(16, 0.1, 56),
        // Deep-forest staging posts across the expanded deck.
        new THREE.Vector3(-150, 0.1, 120), new THREE.Vector3(160, 0.1, 110),
        new THREE.Vector3(-170, 0.1, -140), new THREE.Vector3(150, 0.1, -160),
        new THREE.Vector3(230, 0.1, 30), new THREE.Vector3(-240, 0.1, 20),
        new THREE.Vector3(20, 0.1, 240), new THREE.Vector3(-40, 0.1, -250),
        new THREE.Vector3(120, 0.1, 220), new THREE.Vector3(-120, 0.1, -220)
      ];
    }
  }
];

// Every campaign arena is selectable, in story order. BATTLEGROUND and GTAZ
// are appended too — they're real maps and the world builder loads them the
// same way — but they're flagged mode-locked so the arena picker leaves them
// out: picking them from the map row would contradict the mode chips, which
// already choose those maps for you.
BATTLEGROUND_MAP.modeLocked = true;
GTAZ_MAP.modeLocked = true;

export const MAPS = [
  ...ALL_MAPS,
  BATTLEGROUND_MAP,
  GTAZ_MAP
];

/** The arenas the map picker offers: campaign decks only. */
export const ARENA_MAPS = MAPS.filter((m) => !m.modeLocked);
