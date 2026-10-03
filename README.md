# SKYBREAK PROTOCOL

### ▶ [Play it in your browser](https://darkultimateyt67-lgtm.github.io/skybreak-protocol/)

An **original** futuristic quest-driven FPS for the browser, built on **Three.js**.
Fast movement — sprint, slide, thruster double-jumps, wall running — across three
open chapters of an orbital station gone silent. Find the survivors, take their
quests, earn credits, gear up, and learn what HELIOS heard in the Skybreak signal.

Everything is generated in code: geometry, textures, weapon models, characters,
sounds and UI. No binary assets, no third-party creative content.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

Or double-click `PLAY.cmd`.

## Controls

| Input | Action |
| --- | --- |
| W A S D / Shift | Move / Sprint |
| Space | Jump · press again in air for thruster boost |
| C / Ctrl | Crouch · slide while sprinting |
| Hold W beside a wall (airborne) | Wall run · Space to leap off |
| Mouse 1 / Mouse 2 | Fire / Aim down sights |
| R | Reload |
| 1–5 / Wheel | Switch weapon |
| **E** | Talk to survivors / interact |
| **G** | Frag charge |
| **Q** | Recon pulse (damages + pings all enemies on the tac-map) |
| **B** | Supply uplink (shop) |

## The campaign

Three chapters and an epilogue, each with its own arena, survivors and quest chain:

1. **HALCYON PLAZA** — hold the atrium, recover the black box, power the lifts.
2. **IRONWORKS** — jam the forge that prints new SENTINEL frames.
3. **SKYDOCK** — fuel the last ferry and hold the pad for the final burn.
4. **EPILOGUE — VERDANT DECK** — sent back months later, shot down over a forest
   nobody knew was aboard, and the truth about HELIOS.

Quests pay **credits**. Spend them at the supply uplink (B) on new weapons
(SMG, shotgun, marksman rifle), frag and recon charges, repairs, ammo and
armor upgrades. Dying costs 20% of your credits but keeps quest progress.

## Loadout

- **VX-9 RIPTIDE** — full-auto pulse rifle (starting primary)
- **WASP P-9** — sidearm (starting secondary)
- **KESTREL SMG-4** — 950 rpm slide-and-spray (600 cr)
- **MAULER SG-8** — 8-pellet scatter cannon (800 cr)
- **LANCE DMR-50** — high-zoom one-headshot rifle (1200 cr)

## Operators

Pick your body in the menu: **VECTOR-7** (balanced), **RUSH** (+8% speed,
thinner hull) or **AEGIS** (heavy plating, −5% speed).

## Documentation

See [documentation/ARCHITECTURE.md](documentation/ARCHITECTURE.md) for the
subsystem graph, physics model and extension points.

## Copyright

© 2026 darkultimateyt67-lgtm. All rights reserved.

The source is published so it can be read and played. It is **not** open
source: no licence is granted to copy, modify, redistribute, rehost or sell
this game or any part of it without written permission.
