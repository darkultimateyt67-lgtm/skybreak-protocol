# SKYBREAK PROTOCOL — Architecture

Original browser FPS built on Three.js. All assets (geometry, textures,
audio, UI) are generated procedurally in code — the project ships zero
binary assets and zero third-party creative content.

## Subsystem graph

`Game` (src/engine/Game.js) owns every subsystem and the frame loop.
Subsystems never import each other — they receive the `Game` instance and
communicate through its references, keeping the dependency graph acyclic:

```
main.js
  └─ Game ──────────── state machine: MENU / PLAYING / PAUSED / DEAD
       ├─ Input        keyboard/mouse + pointer lock (engine/Input.js)
       ├─ PhysicsWorld capsule-vs-OBB collision + raycasts (physics/)
       ├─ World        arena geometry, lighting, sky, jump pads (world/)
       ├─ Effects      pooled particles / tracers / decals / flashes (effects/)
       ├─ Player       movement controller + camera feel (player/)
       ├─ WeaponSystem data-driven weapons + procedural viewmodels (weapons/)
       ├─ EnemyManager SENTINEL AI + wave director (ai/)
       ├─ AudioSys     procedural WebAudio synthesis (audio/)
       └─ HUD          DOM overlay binding (ui/)
```

## Update order (per frame, PLAYING state)

1. `Player.update` — look, movement state machine, collision, camera
2. `WeaponSystem.update` — switching, ADS, reload, firing, viewmodel anim
3. `EnemyManager.update` — wave sequencing, AI states, enemy fire
4. `Effects.update` — advance all pools
5. `World.update` — animated landmarks
6. `HUD.tick` — change-detected DOM writes
7. `Input.endFrame` — clear per-frame edges/deltas
8. `EffectComposer.render` — RenderPass → UnrealBloom → OutputPass (ACES)

## Physics

Custom, allocation-free static collision (`physics/PhysicsWorld.js`):

- The map registers **oriented boxes**; axis-aligned boxes skip the
  quaternion transforms entirely.
- Characters are vertical **capsules** (position = feet). Movement
  integrates velocity then iteratively resolves penetration (3 passes)
  against the nearest point between the capsule segment and each box,
  clipping velocity against contact normals — this produces stable wall
  sliding, ramp walking and edge behavior.
- **Raycasts** use the OBB slab test and serve bullets, ground snapping,
  AI line of sight and wall-run probes. Enemy hitboxes are ray-vs-sphere
  (head / torso / pelvis) resolved against the nearest world hit.

## Movement model

Grounded: exponential approach toward wish-direction × target speed
(distinct accelerate/friction rates). Airborne: additive acceleration
capped at max(entry speed, sprint speed), so slide- and wall-run momentum
is preserved but not farmed. Systems on top: sprint, crouch, slide
(low-friction boost + steering), coyote time, jump buffering, thruster
double-jump (energy cost), wall running (side raycasts, reduced gravity,
velocity projected onto the wall plane, camera roll), jump pads,
landing-dip spring, head bob, FOV kick, recoil recovery.

## Weapons

`WEAPON_DEFS` is pure data (damage, RPM, spread, recoil, falloff, pellets,
ADS zoom…). Adding a weapon = one new entry. Viewmodels are assembled from
primitives per class and animated procedurally (sway from mouse deltas,
bob from player phase, ADS position blend, kick springs, reload dip).
Shots are hitscan: cone-sampled rays resolved against world geometry and
enemy hit spheres, with distance falloff and headshot multipliers.

## Performance choices

- Every visual effect is pooled; nothing allocates per frame in hot paths
  (module-level scratch vectors throughout).
- Crates are a single `InstancedMesh`; particles are one `THREE.Points`
  buffer; decals/tracers/flash-lights are fixed recycled pools.
- One shadow-casting light (CSM-free by design at this map scale);
  accent lights are shadowless.
- Pixel ratio clamped to 1.5; bloom is the only post pass besides output.

## Extension points (deliberately out of scope in this build)

- **Multiplayer**: `Game`'s state machine and the data-driven weapon/enemy
  layers are server-friendly (deterministic sim inputs: wish-dir, yaw,
  trigger). A Colyseus/Socket.io server would own `PhysicsWorld` +
  authoritative player state; the client keeps prediction using the same
  `Player.update`.
- **Maps**: `World` is the only file that knows the arena; a map is a list
  of `_block/_ramp/_strip` calls plus spawn/pad tables — trivially
  serializable to JSON for custom maps.
- **Attachments/progression**: extend `WEAPON_DEFS` entries with modifier
  stacks; the system reads all stats per shot already.
