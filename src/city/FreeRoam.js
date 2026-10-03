import { FarProxy } from './FarProxy.js';
import * as THREE from 'three';
// Cockpit view is the default: you asked to look through the windscreen, and
// that only means anything if it's what you get when you sit down.
import { Vehicle, tickVehiclePanels } from './Vehicles.js';
import { Aircraft } from './Aircraft.js';
import { Watercraft } from './Watercraft.js';
import { SandFX } from './SandFX.js';
import { RigidWorld } from '../physics/Rigid.js';
import { buildProps } from './Props.js';
import { Debris } from './Debris.js';
import { RagdollPool } from './Ragdoll.js';
import { Dining } from './Dining.js';
import { models } from './ModelLibrary.js';
import { Missions } from './Missions.js';
import { BossMemory } from './BossMemory.js';
import { answerFor, dressAnswer } from './Answer.js';
import { Traffic } from './Traffic.js';
import { Wanted } from './Wanted.js';
import { DISTRICTS } from './City.js';

/**
 * FreeRoam — the GTAZ mode manager.
 *
 * There are no missions here by design. What the mode provides instead is a
 * city that reacts: traffic that queues, people who scatter, and police who
 * arrive when you earn them. Everything below exists to keep those three
 * things running and to move the player between two states — on foot, and
 * behind the wheel.
 *
 * Driving deliberately borrows the player's own yaw for the camera rather than
 * hard-locking behind the car. Chase cameras that snap to the vehicle's
 * heading make you carsick and take away your ability to look at what you are
 * about to hit; letting the stick steer the view and the car separately is
 * what every open-world game settled on.
 */

const _v = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _rc = new THREE.Vector3();
const _rh = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _RY = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();

export class FreeRoam {
  constructor(game) {
    this.game = game;
    this.city = null;
    this.traffic = null;
    this.wanted = null;
    this.parked = [];            // enterable cars sitting in the world
    this.driving = null;         // Vehicle the player is currently in
    this.active = false;
    this.camYaw = 0;
    this.camDist = 11.5;      // far enough back that the road, not the car, is the subject
    this._smooth = new THREE.Vector3();
    this._enterCd = 0;
    this._district = null;
    this._threat = 0;
    this.stats = { distance: 0, topSpeed: 0, busted: 0 };
  }

  /**
   * Look for drop-in models before anything spawns.
   *
   * Called ahead of start() so a downloaded body is already in the cache by
   * the time the first car is constructed. Resolves either way — every id
   * that has no file simply falls back to the generated shape.
   */
  async preloadModels() {
    const ids = [
      'sedan', 'coupe', 'sport', 'muscle', 'suv', 'pickup', 'van', 'truck', 'bus', 'bike',
      'prop', 'jet', 'heli',
      'jetski', 'speedboat', 'launch', 'yacht'
    ];
    const res = await models.preload(ids);
    if (res.found.length) {
      this.game.hud.brToast?.('CUSTOM MODELS LOADED', res.found.join(', '));
    }
    return res;
  }

  /**
   * Called once the GTAZ world has been built.
   *
   * Async, with a pause between each stage, so the loading screen can show
   * what is happening and actually move. `loading` is the loading screen (or
   * nothing, in which case the stages run back to back as they always did).
   */
  async start(loading = null) {
    const g = this.game;
    this.city = g.world.city;
    if (!this.city) return;
    // One stage at a time: say what it is, let that paint, then do it.
    const stage = async (label, from, to, ms) => {
      if (!loading) return;
      loading.step(label, from, to, ms);
      await loading.frame();
    };
    // Out-of-world depth on the surface. The old -8 m was fine over a flat
    // sheet of water; with a seabed at 28 m it would respawn anyone who dived.
    g.player.voidY = -40;

    // Crowd and traffic size follow the quality tier. Each car and pedestrian
    // is a simulated agent as well as something to draw, so on a weak machine
    // this is the cheapest large saving available in the city.
    // Crowd and traffic size follow the quality tier. Pedestrians are cheap —
    // five instanced meshes cover the whole crowd regardless of headcount — so
    // they scale up hard. Cars are each their own object hierarchy, so they
    // rise more carefully.
    const d = g.world.detail ?? 1;
    await stage('Filling the streets with traffic and people', 0.6, 0.74, 2200);
    // TRAFFIC DENSITY, RAISED ON THE BACK OF THE VEHICLE LOD.
    //
    // 70 was the right number when every car in the city was 61 meshes
    // whatever its distance, which had vehicles alone accounting for three
    // quarters of the scene's draw calls. Distant cars now drop their 46
    // sub-half-metre parts and vanish entirely past 420 m, so a car you cannot
    // read costs about a quarter of what it did. That saving is what pays for
    // this: more than twice the traffic for less total cost than the old
    // number carried.
    this.traffic = new Traffic(this.city, {
      cars: Math.max(24, Math.round(155 * d)),
      peds: Math.max(30, Math.round(190 * d))
    });
    this.traffic.build();
    this.wanted = new Wanted(this);
    await stage('Setting up physics: props, debris, ragdolls', 0.75, 0.8, 600);
    // Sand that reacts: grains, dust, prints, pits and tyre tracks.
    this.sandFX?.dispose();
    this.sandFX = new SandFX(g, this.city);
    // Loose objects: cones, bins, crates, drums, chairs, signs. Real bodies.
    this.rigid = new RigidWorld(g.physics);
    this.rigid.waterAt = (x, z) => (this.city.waterHeightAt ? this.city.waterHeightAt(x, z) : -0.9);
    // Used only to recover a body that has ended up inside geometry.
    this.rigid.surfaceAt = (x, z) => (this.city.surfaceAt ? this.city.surfaceAt(x, z) : 0);
    this.props = buildProps(this.city, this.rigid);
    // Wreckage: panels and glass, thrown as real bodies when something blows.
    this.debris = new Debris(this.city.world, this.rigid);
    // Pedestrians who go down do it as six jointed bodies, not an animation.
    this.ragdolls = new RagdollPool(this.rigid);
    this.traffic.ragdolls = this.ragdolls;
    this.dining = new Dining(this);
    await stage('Opening the Undercity', 0.81, 0.83, 300);
    // Underground complexes and the contracts that send you into them.
    this.dungeons = this.city.dungeons || [];
    // The Undercity's story: inscriptions you read by standing at them, and
    // the count of wards you have unlocked by carrying keys up.
    this.undercity = this.city.undercity || null;
    if (this.undercity) this.undercity.fr = this;
    this.missions = new Missions(this).build(Math.random);
    this.dungeonKills = 0;
    this.inDungeon = null;
    // Bosses remember how the last one died.
    this.bossMemory = this.bossMemory || new BossMemory(g);
    this.boss = null;
    this._bossShell = null;

    // Parked cars are the cheaper half of the population — they never move,
    // so they cost nothing but their meshes, and those are LOD'd too.
    await stage('Parking cars', 0.84, 0.94, 1800);
    this._spawnParked(Math.max(36, Math.round(150 * d)));
    await stage('Fuelling planes and boats', 0.95, 0.98, 500);
    this._spawnAircraft();
    this._spawnBoats();
    this.active = true;
    this.driving = null;
    this.stats = { distance: 0, topSpeed: 0, busted: 0 };

    g.hud.setBRMode(false);
    g.hud.setGTAZMode?.(true);
    g.hud.brToast?.('GTAZ — FREE ROAM', 'No missions. F to take a car, F to get out.');
  }

  /** Scatter enterable cars along the kerbs so one is always nearby. */
  _spawnParked(n) {
    const c = this.city;
    for (let i = 0; i < n; i++) {
      const node = c.nodes[(Math.random() * c.nodes.length) | 0];
      const link = node.links[(Math.random() * node.links.length) | 0];
      if (!link) continue;
      const t = 0.25 + Math.random() * 0.5;
      const dx = link.x - node.x, dz = link.z - node.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dx / len, nz = dz / len;
      // Sit in the right-hand lane, clear of the kerb at ROAD_W/2 = 8.5 m.
      const off = 4.6;
      const car = new Vehicle(
        c,
        node.x + dx * t + nz * off,
        node.z + dz * t - nx * off
      );
      car.yaw = Math.atan2(-nx, -nz);
      // A parked bike is on its stand with nobody on it.
      if (car.style.id === 'bike') car.setOccupantsVisible(false);
      car.syncMesh();
      this.parked.push(car);
    }
  }

  /** Park aircraft on the apron and at the runway threshold. */
  _spawnAircraft() {
    const ap = this.city.airport;
    if (!ap) return;
    this.aircraft = [];
    const kinds = ['prop', 'prop', 'jet', 'heli', 'jet', 'prop'];
    ap.planeSpots.forEach((spot, i) => {
      const a = new Aircraft(this.city, spot.x, spot.z, kinds[i % kinds.length], spot.yaw);
      this.aircraft.push(a);
    });
  }

  /**
   * Tie boats up in the marina, and moor a few larger ones out in the bay so
   * the water isn't empty once you're on it.
   */
  _spawnBoats() {
    this.boats = [];
    const m = this.city.marina;
    if (!m) return;
    const kinds = ['jetski', 'jetski', 'speedboat', 'speedboat', 'launch', 'jetski'];
    m.berths.forEach((b, i) => {
      this.boats.push(new Watercraft(this.city, b.x, b.z, kinds[i % kinds.length], 0));
    });
    // Anchored offshore: something to swim or speed out to.
    const out = this.city.beachOuter + 90;
    this.boats.push(new Watercraft(this.city, 120, out, 'yacht', 0.4));
    this.boats.push(new Watercraft(this.city, -260, out + 70, 'launch', -0.8));
    this.boats.push(new Watercraft(this.city, -out - 60, 140, 'speedboat', 1.2));
  }

  /**
   * Everything loose in the world, and everything that can shove it.
   *
   * Bodies only integrate near the player, so this is a fixed cost wherever
   * you are. The shoving is done by sweeping each vehicle's box through the
   * bodies — momentum comes from the vehicle's own velocity, so a parked car
   * rests against a cone and one at speed puts it over a wall.
   */
  _updateRigid(dt) {
    const g = this.game;
    const r = this.rigid;
    if (!r) return;
    const p = g.player.position;

    // Vehicles: whatever you are driving, plus the traffic close enough to
    // matter. Aircraft and boats push things too.
    const sweep = (v) => {
      // A car that has rolled over is already a body in this same solver;
      // sweeping it as well would have it shoving itself across the map.
      if (!v || !v.alive || v.tumbling) return;
      const s = v.style || v.type;
      if (!s) return;
      const sp = Math.abs(v.speed || 0);
      _rv.set(-Math.sin(v.yaw) * (v.speed || 0), 0, -Math.cos(v.yaw) * (v.speed || 0));
      _rc.set(v.position.x, v.position.y + (s.h || 1.4) * 0.45, v.position.z);
      _rh.set((s.w || 2) * 0.5, (s.h || 1.4) * 0.5, (s.l || 4) * 0.5);
      _rq.setFromAxisAngle(_RY, v.yaw);
      r.sweepBox(_rc, _rh, _rq, _rv, {
        onHit: (body, speed) => {
          if (speed > 6 && g.audio?.impact) g.audio.impact();
          if (v === this.driving && speed > 9) this.wanted?.commit('reckless', 0.1);
        }
      });
      if (sp > 1) r.wakeNear(v.position.x, v.position.z, 6);
    };
    if (this.driving) sweep(this.driving);
    for (const ai of this.traffic.cars) {
      const c = ai.car;
      if (!c || c === this.driving) continue;
      if ((c.position.x - p.x) ** 2 + (c.position.z - p.z) ** 2 > 90 * 90) continue;
      sweep(c);
    }

    // On foot: you nudge things aside rather than launching them.
    if (!this.driving) {
      _rv.copy(g.player.velocity);
      r.pushCapsule(p, 0.42, g.player.height || 1.8, _rv);
    }

    r.step(dt, p);
    this.props?.update();
    this.debris?.update(dt);
    this.ragdolls?.update(dt);
  }

  /** Nearest enterable car within reach of the player, or null. */
  _nearestCar(maxDist = 4.0) {
    const p = this.game.player.position;
    let best = null, bd = maxDist * maxDist;
    const consider = (car, reach) => {
      if (!car.alive || car.driver === 'player') return;
      const d = (car.position.x - p.x) ** 2 + (car.position.z - p.z) ** 2;
      if (d < Math.min(bd, reach * reach)) { bd = d; best = car; }
    };
    for (const c of this.parked) consider(c, maxDist);
    for (const ai of this.traffic.cars) consider(ai.car, maxDist);
    // Aircraft are big, so you can board them from further out — standing on
    // a wingtip and being told there's no vehicle here would be nonsense.
    for (const a of (this.aircraft || [])) consider(a, 9);
    // Boats are boarded from the jetty, so the reach is generous.
    for (const b of (this.boats || [])) consider(b, 7);
    return best;
  }

  enterCar(car) {
    const g = this.game;
    this.driving = car;
    car.driver = 'player';
    // Entry animation: the camera swings from where you're standing round to
    // the driving position over half a second. Snapping straight into the
    // chase camera is disorienting — you lose track of which way the car
    // faces at the exact moment you need to know it.
    this._enterT = 0.55;
    this._enterFrom = g.camera.position.clone();
    // The driver's door opens as you get in and shuts behind you.
    car.flashDoor?.(0, 0.45);
    // Taking one that was moving is theft, and somebody saw it.
    const wasAI = this.traffic.cars.find((a) => a.car === car);
    if (wasAI) {
      this.traffic.cars.splice(this.traffic.cars.indexOf(wasAI), 1);
      this.wanted.commit('stealOccupied');
    }
    this.camYaw = car.yaw;

    // --- The driver's-hands boost -----------------------------------------
    // Seven times the stock top speed and a flat 110 m/s^2 of acceleration,
    // to match the player's own pace on foot. Applied to the style object,
    // not inside drive(), because half the game reads style.topSpeed to work
    // out how fast you are going as a FRACTION of maximum — the chase camera's
    // pull-back, the rev counter, the steering lock that tightens with speed.
    // Boosting the speed without boosting the number it is measured against
    // would peg every one of those at maximum permanently.
    //
    // style is a per-vehicle copy, so this touches only the car you are in,
    // and the originals are restored the moment you step out — otherwise
    // every car you ever abandoned would still be a rocket.
    const rules = g.rules;
    car._stockSpeed = car.style.topSpeed;
    car._stockAccel = car.style.accel;
    car.style.topSpeed = car._stockSpeed * rules.car;
    // REAL leaves the chassis' own acceleration alone; FUN gives every car
    // the same flat figure so the dial actually does something off the line.
    if (rules.carAccel !== null) car.style.accel = rules.carAccel;
    // The health dial covers the car you are in, too: FUN's 7x hull is a 7x
    // chassis, and no single hit may take more than a quarter of it.
    car._stockMaxHealth = car.maxHealth || 100;
    const hmul = rules.health || 1;
    car.maxHealth = car._stockMaxHealth * hmul;
    car.health = Math.min(car.maxHealth, car.health * hmul);
    car.impactCap = rules.id === 'fun' ? 0.25 : 0.5;

    // Chase view by default, for ONE reason: you are driving, and driving
    // needs road. From the seat the dashboard and the bonnet eat the bottom
    // half of the screen and the first thing you see of a corner is when you
    // are already in it. Pulled back and up, the road opens out in front of
    // you and you can actually place the car. C still drops you into the seat
    // when you want to look at the interior.
    this.cockpit = false;
    g.thirdPerson?.setEnabled(false);
    // You're in that seat now — the NPC driver has to go.
    // Riding a bike you are ON it, visibly; in a car the chase camera shows
    // the driver too. Only the cockpit view needs the seat empty, and that
    // is handled per frame in _updateDriving.
    car.setOccupantsVisible?.(car.style?.id === 'bike');
    g.weapons.rig.visible = false;
    if (g.thirdPerson) g.thirdPerson.setEnabled(false);
    g.hud.brToast?.(car.name || car.style.id.toUpperCase(),
      'F out · C view · SHIFT boost · SPACE handbrake');
    if (g.audio && g.audio.pickup) g.audio.pickup();
  }

  /**
   * Bring the car you are in into line with the current ruleset: top speed
   * and acceleration from the speed dial, hull from the health dial. Stock
   * figures are captured the first time, so this is idempotent and can run
   * every frame; exitCar() hands them back.
   */
  _applyCarRules(car) {
    const rules = this.game.rules;
    if (car._stockSpeed === undefined) {
      car._stockSpeed = car.style.topSpeed;
      car._stockAccel = car.style.accel;
    }
    car.style.topSpeed = car._stockSpeed * (rules.car || 1);
    car.style.accel = rules.carAccel !== null && rules.carAccel !== undefined ? rules.carAccel : car._stockAccel;
    if (car._stockMaxHealth === undefined) car._stockMaxHealth = car.maxHealth || 100;
    const want = car._stockMaxHealth * (rules.health || 1);
    if (Math.abs(want - car.maxHealth) > 1e-6) {
      // Keep the same fraction of hull across the switch.
      car.health = car.health * (want / (car.maxHealth || want));
      car.maxHealth = want;
    }
    if ('impactCap' in car) car.impactCap = rules.id === 'fun' ? 0.25 : 0.5;
  }

  exitCar() {
    const g = this.game;
    const car = this.driving;
    if (!car) return;
    // Step out to the left of the car, clear of the body.
    const ox = Math.cos(car.yaw) * (car.style.w * 0.5 + 0.9);
    const oz = -Math.sin(car.yaw) * (car.style.w * 0.5 + 0.9);
    g.player.position.set(car.position.x + ox, car.position.y, car.position.z + oz);
    g.player.velocity.set(0, 0, 0);
    car.driver = null;
    // You were the driver. Leaving must not put a stranger back in the
    // seat — that made every car you had just stepped out of a carjack.
    car.setOccupantsVisible?.(false);
    // Hand the car back its factory figures.
    if (car._stockMaxHealth !== undefined) {
      const hmul = car.maxHealth / car._stockMaxHealth;
      car.health = car.health / (hmul || 1);
      car.maxHealth = car._stockMaxHealth;
      car.impactCap = 0.6;
      car._stockMaxHealth = undefined;
    }
    if (car._stockSpeed !== undefined) {
      car.style.topSpeed = car._stockSpeed;
      car.style.accel = car._stockAccel;
      car._stockSpeed = car._stockAccel = undefined;
    }
    car.speed *= 0.2;
    // And opens again to let you out.
    car.flashDoor?.(0, 0.7);
    this.driving = null;
    if (!this.parked.includes(car)) this.parked.push(car);
    g.weapons.rig.visible = true;
  }

  /**
   * Hatches: standing on one drops you into the complex below, standing on
   * the exit brings you back up.
   *
   * A cooldown guards both directions. Without it you arrive underground
   * standing on the entry point, which is still "on a hatch", and get
   * bounced straight back to the street in a loop.
   */
  _updateHatches(dt) {
    const g = this.game;
    const p = g.player.position;
    this._hatchCd = Math.max(0, (this._hatchCd || 0) - dt);
    if (this._hatchCd > 0 || this.driving) return;

    // Going down: on the surface, standing on a hatch.
    if (p.y > -10) {
      for (const d of this.dungeons) {
        if (Math.hypot(p.x - d.hatch.x, p.z - d.hatch.z) > 5.5) continue;
        this._hatchCd = 1.2;
        this.enterDungeon(d);
        return;
      }
      return;
    }

    // Coming up: back at the room you dropped into.
    //
    // The exit has to be ARMED by walking away first. You arrive standing on
    // the entry point, so a plain proximity test sends you straight back up
    // the moment the cooldown lapses — you can never actually get into the
    // dungeon. Leaving the room arms it; returning then works.
    const d = this.inDungeon;
    if (!d) return;
    const e = d.entryPoint;
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist > 7) this._exitArmed = true;
    if (this._exitArmed && dist < 2.6) {
      this._hatchCd = 1.2;
      this.exitDungeon();
    }
  }

  /**
   * Put the daylight out.
   *
   * The halls were being lit by the CITY'S sun — a directional at intensity 3
   * and a daylight hemisphere at 1.35, with pale blue haze fog on top. Sixty
   * metres of rock overhead made no difference to any of it, so every hall
   * came out flat, beige and evenly lit, and two hundred torches had nothing
   * to push against. No amount of extra masonry fixes that; the lighting was
   * the reason it looked wrong.
   *
   * Underground the sun goes off, the hemisphere drops to a dim cold bounce,
   * and the fog turns near-black and thick, so torches and the chasms become
   * the only real light and the darkness closes in at forty metres.
   */
  _setUnderworldLighting(on) {
    const w = this.game.world;
    if (!w) return;
    if (on) {
      if (this._skyLight) return;                  // already stowed
      this._skyLight = {
        sun: w.sun ? w.sun.intensity : 0,
        hemi: w.hemi ? w.hemi.intensity : 0,
        hemiSky: w.hemi ? w.hemi.color.getHex() : 0,
        hemiGround: w.hemi ? w.hemi.groundColor.getHex() : 0,
        fog: this.game.scene.fog ? this.game.scene.fog.color.getHex() : 0,
        fogDensity: this.game.scene.fog ? this.game.scene.fog.density : 0
      };
      if (w.sun) w.sun.intensity = 0;
      if (w.hemi) {
        w.hemi.intensity = 0.22;
        w.hemi.color.setHex(0x2a3340);
        w.hemi.groundColor.setHex(0x14100c);
      }
      if (this.game.scene.fog) {
        this.game.scene.fog.color.setHex(0x05060a);
        this.game.scene.fog.density = 0.017;
      }
    } else if (this._skyLight) {
      const k = this._skyLight;
      if (w.sun) w.sun.intensity = k.sun;
      if (w.hemi) {
        w.hemi.intensity = k.hemi;
        w.hemi.color.setHex(k.hemiSky);
        w.hemi.groundColor.setHex(k.hemiGround);
      }
      if (this.game.scene.fog) {
        this.game.scene.fog.color.setHex(k.fog);
        this.game.scene.fog.density = k.fogDensity;
      }
      this._skyLight = null;
    }
  }

  /**
   * Real light from the nearest torches.
   *
   * Two hundred torches were emissive cones and nothing else — bright little
   * shapes that lit nothing around them. With the daylight switched off that
   * left the halls evenly dim, which is flat in a different way to being
   * evenly bright. Actual lights are what put a warm pool on the flagstones
   * and throw the balusters' shadows across the floor.
   *
   * You cannot have two hundred of them, so there are six, and they follow
   * whichever torches you are nearest. Six is enough because a torch you are
   * more than fifteen metres from contributes nothing you would notice, and
   * the handover happens behind you as you walk.
   */
  _updateTorchLights() {
    const g = this.game;
    const cave = this.inDungeon;
    // Borrowed from the effects light pool while underground, returned on the
    // way out. Six lights of its own would have sat in every shader in every
    // mode — each scene light is lighting code every pixel runs — and adding
    // them on first use recompiled every shader in the game mid-play.
    if (!cave) {
      if (this._torchPool) {
        for (const l of this._torchPool) g.effects.releaseLight(l);
        this._torchPool = null;
      }
      return;
    }
    if (!this._torchPool) {
      this._torchPool = [];
      // Three, leaving one pool light for muzzle flashes underground.
      for (let i = 0; i < 3; i++) {
        const l = g.effects.reserveLight();
        if (!l) break;
        l.color.setHex(0xff9a3c);
        l.distance = 17;
        l.decay = 2;
        l.intensity = 0;
        this._torchPool.push(l);
      }
    }
    const pool = this._torchPool;
    const p = g.player.position;
    // Nearest few by insertion into a tiny fixed list — cheaper and far less
    // garbage than sorting two hundred every frame.
    const best = [];
    for (const t of cave.torches) {
      const d = t.mesh.position.distanceToSquared(p);
      if (d > 900) continue;                       // 30 m, beyond useful range
      if (best.length < pool.length) { best.push({ t, d }); best.sort((a, b) => a.d - b.d); }
      else if (d < best[best.length - 1].d) {
        best[best.length - 1] = { t, d };
        best.sort((a, b) => a.d - b.d);
      }
    }
    const now = performance.now() * 0.001;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      if (i >= best.length) { l.intensity = 0; continue; }
      const t = best[i].t;
      l.position.copy(t.mesh.position);
      // Flicker in step with the flame it belongs to, so light and shape agree.
      l.intensity = 9 + Math.sin(now * 9 + t.phase) * 2.2 + Math.sin(now * 21 + t.phase * 2) * 1.1;
    }
  }

  enterDungeon(d) {
    const g = this.game;
    this.inDungeon = d;
    this.dungeonKills = 0;
    this._exitArmed = false;
    this._setUnderworldLighting(true);
    const e = d.entryPoint;
    // Move the world floor down before the teleport, or the out-of-world
    // guard fires on the very next frame and drags us back to the street.
    g.player.voidY = -90;
    g.player._lastSafe = null;
    g.player.position.set(e.x, e.y, e.z);
    g.player.velocity.set(0, 0, 0);
    // Garrison the place. Enemies are the campaign frames, reused — they
    // already know how to take cover, flank and shoot back, and writing a
    // second AI for the basement would be pure duplication.
    if (g.enemies) {
      g.enemies.reset();
      const n = Math.max(4, Math.round(d.size * 1.2));
      for (const room of d.rooms) {
        if (room.entry) continue;
        g.enemies.spawnGroup(1, new THREE.Vector3(room.x, room.y + 0.6, room.z), { exact: true, guard: true });
      }
      this._garrison = n;

      // --- The thing at the bottom -----------------------------------------
      // One boss per cave, in the deepest chamber, built from everything the
      // previous ones taught it.
      const deep = d.rooms[d.rooms.length - 1];
      // One thing sending up one body at a time — but each ward grows a
      // different body. The ward decides what this draft IS (city/Answer.js);
      // the memory then decides what it has learned since the last one died.
      const spec = answerFor(d, this.bossMemory.defeated);
      const shaped = this.bossMemory.shape({
        name: spec.name,
        hp: spec.hp + (d.size || 4) * 40,
        damage: 12 * spec.dmg,
        speed: spec.speed,
        preferredRange: spec.range,
        color: spec.color
      });
      // Behind the relic, not on it. The room's centre is where the ward's
      // key sits on its plinth, and the boss used to be spawned exactly there
      // — standing waist-deep in a glowing block. Half a room back, on the far
      // side from the door, it is guarding the thing instead.
      let ox = 1, oz = 0;
      if (deep.entry && typeof deep.entry === 'object' && deep.entry.x !== undefined) {
        const ex = deep.x - deep.entry.x, ez = deep.z - deep.entry.z;
        const el = Math.hypot(ex, ez);
        if (el > 1e-3) { ox = ex / el; oz = ez / el; }
      }
      const back = (deep.radius || 8) * 0.45;
      this.boss = g.enemies.spawnBoss(
        {
          name: shaped.name, color: shaped.color, hp: shaped.hp,
          slam: spec.slam, summon: spec.summon, half: spec.half, enrage: spec.enrage
        },
        new THREE.Vector3(deep.x + ox * back, deep.y + 0.8, deep.z + oz * back)
      );
      if (this.boss) {
        // Carry the learned shaping onto the entity itself.
        this.boss.speed = (this.boss.speed || 3) * shaped.speed;
        this.boss.damageOut *= spec.dmg;
        this.boss.bossShape = shaped;
        this.boss.answer = spec;
        this._bossShell = dressAnswer(this.boss, spec);
        this.bossMemory.beginFight(this.boss);
        const learned = this.bossMemory.describe();
        const hex = '#' + spec.color.toString(16).padStart(6, '0');
        // Name and epithet first, then either what it has learned or the
        // line for this ward — never neither.
        g.hud.brToast?.(spec.title, spec.epithet, hex);
        if (learned) g.hud.brToast?.('IT HAS LEARNED', learned);
        else g.hud.comms?.(spec.enter, spec.title);
      }
    }
    g.hud.brToast?.(d.name, 'Return to this room to get out');
    this.undercity?.onEnter(d);
    if (g.audio?.stormWarn) g.audio.stormWarn();
  }

  exitDungeon() {
    const g = this.game;
    const d = this.inDungeon;
    if (!d) return;
    const x = d.exitPoint;
    g.player.position.set(x.x, x.y, x.z);
    g.player.velocity.set(0, 0, 0);
    g.player.voidY = -40;           // surface rules: the seabed is 28 m down
    g.player._lastSafe = null;
    this.inDungeon = null;
    this._setUnderworldLighting(false);
    if (g.enemies) g.enemies.reset();
    g.hud.brToast?.('BACK ON THE STREET', '');
  }

  /**
   * Vehicles hitting each other.
   *
   * Until now cars only collided with the WORLD — they drove clean through
   * one another, which is the single most obvious thing missing from a city
   * full of traffic. This is a simple impulse solve: overlapping pairs get
   * pushed apart along the line between them, and the speed each was carrying
   * along that line is exchanged, so a heavy van shunts a hatchback rather
   * than bouncing off it.
   *
   * Damage comes from CLOSING speed, not absolute speed. Two cars travelling
   * the same way at 80 that touch should scrape; one at 80 meeting one at 0
   * should hurt.
   */
  _resolveVehicleHits(dt) {
    const all = this._allVehicles();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.alive) continue;

        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distSq = dx * dx + dz * dz;
        const reach = (a.radius + b.radius) * 1.25;
        if (distSq > reach * reach || distSq < 1e-6) continue;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist, nz = dz / dist;
        const overlap = reach - dist;

        // Mass decides who gives way.
        const ma = a.style.mass ?? 1;
        const mb = b.style.mass ?? 1;
        const total = ma + mb;
        a.position.x -= nx * overlap * (mb / total);
        a.position.z -= nz * overlap * (mb / total);
        b.position.x += nx * overlap * (ma / total);
        b.position.z += nz * overlap * (ma / total);

        // Velocity each carries along the contact normal.
        const av = -Math.sin(a.yaw) * a.speed;
        const avz = -Math.cos(a.yaw) * a.speed;
        const bv = -Math.sin(b.yaw) * b.speed;
        const bvz = -Math.cos(b.yaw) * b.speed;
        const closing = (av - bv) * nx + (avz - bvz) * nz;
        if (closing <= 0) continue;          // already separating

        // Exchange momentum along the normal, then bleed speed.
        const impulse = closing * 0.85;
        a.speed -= impulse * (mb / total) * 0.9;
        b.speed += impulse * (ma / total) * 0.9;
        a.lateral = (a.lateral || 0) - nx * impulse * 0.4;
        b.lateral = (b.lateral || 0) + nx * impulse * 0.4;

        this._collisionDamage(a, b, closing);
      }
    }
  }

  /** Every vehicle that can take or deal a hit, in one list. */
  _allVehicles() {
    const out = [];
    for (const c of this.parked) if (c.alive) out.push(c);
    for (const ai of this.traffic.cars) if (ai.car.alive) out.push(ai.car);
    for (const u of this.wanted.units) if (u.car.alive) out.push(u.car);
    return out;
  }

  /**
   * Apply the consequences of one impact: damage, noise, sparks, and heat if
   * the player caused it.
   */
  _collisionDamage(a, b, closing) {
    const g = this.game;
    const now = performance.now();
    // One impact per pair per moment, or a scrape becomes a machine gun.
    const key = a === this.driving || b === this.driving ? 'player' : 'ai';
    if (now - (this._lastHitAt || 0) < 90) return;
    this._lastHitAt = now;

    if (closing < 4) return;                 // gentle nudge, no harm done
    const dmg = Math.min(70, (closing - 3) * 2.6);
    // Through takeDamage, so the per-impact cap and grace window apply.
    a.takeDamage ? a.takeDamage(dmg) : (a.health -= dmg);
    b.takeDamage ? b.takeDamage(dmg) : (b.health -= dmg);
    this._applyDents(a);
    this._applyDents(b);

    _v.set((a.position.x + b.position.x) / 2, 0.9, (a.position.z + b.position.z) / 2);
    if (g.effects?.burst) {
      g.effects.burst(_v, {
        count: Math.min(18, 4 + closing), color: 0xffd9a0,
        speed: 3 + closing * 0.3, life: 0.35
      });
    }
    if (g.audio?.impact) g.audio.impact();
    else if (g.audio?.thud) g.audio.thud();

    // Ramming other people's cars is a crime, and a loud one.
    if (key === 'player' && closing > 9) this.wanted.commit('hitCar', 0.8);
  }

  /**
   * Visible damage. The body darkens and the panels sag as it takes hits, so
   * a wreck looks like a wreck instead of reporting its state only in a
   * number you cannot see.
   */
  _applyDents(car) {
    const t = Math.min(1, (car._dented || 0) / (1.4 * (car.maxHealth || 100)));
    if (!car.group) return;
    // Cars share their materials; scorch only this one's copies.
    car.ownMaterials?.();
    car.group.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.color) return;
      if (o.userData._baseCol === undefined) {
        o.userData._baseCol = o.material.color.getHex();
      }
      // Scorch toward a burnt grey, and rough the paint up.
      const base = new (o.material.color.constructor)(o.userData._baseCol);
      base.lerp(new (o.material.color.constructor)(0x2a2622), t * 0.7);
      o.material.color.copy(base);
      if (o.material.clearcoat !== undefined) o.material.clearcoat = 1 - t * 0.85;
      if (o.material.roughness !== undefined) {
        o.material.roughness = Math.min(1, (o.material.roughness || 0.4) + t * 0.4);
      }
    });
    // Panels settle as it gets beaten up.
    car.group.scale.set(1, 1 - t * 0.06, 1);
  }

  /**
   * Carjacking — taking a car off the person driving it.
   *
   * Three beats over about a second and a half: you haul the door open, the
   * driver is pulled out and dumped on the tarmac, then you get in. It is
   * deliberately slow enough to be interruptible-feeling and to let the
   * street react — the whole point of a stolen car is that somebody saw you
   * take it, and an instant swap gives that moment nowhere to happen.
   *
   * The camera pulls out to the door for the duration, because the action is
   * happening to somebody else and you need to see it.
   */
  _startJack(car) {
    const g = this.game;
    this.jack = { car, t: 0, phase: 'open', ejected: false };
    // Beat one: the door actually comes open before anyone is pulled out.
    car.setDoor?.(0, true);
    // Stand the player at the driver's door.
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    const doorX = car.position.x + c * (car.style.w * 0.5 + 0.7);
    const doorZ = car.position.z - s * (car.style.w * 0.5 + 0.7);
    g.player.position.set(doorX, car.position.y, doorZ);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = Math.atan2(-(car.position.x - doorX), -(car.position.z - doorZ));
    this._jackCam = g.camera.position.clone();
    if (g.audio?.swing) g.audio.swing();
    g.hud.brToast?.('GRAND THEFT AUTO', car.name || '');
  }

  _updateJack(dt) {
    const g = this.game;
    const j = this.jack;
    const car = j.car;
    j.t += dt;

    // Hold the car still while it's being taken.
    car.speed *= Math.pow(0.02, dt);

    // Beat two: the driver comes out and runs.
    if (!j.ejected && j.t > 0.55) {
      j.ejected = true;
      car.setOccupantsVisible?.(false);
      this._ejectDriver(car);
      if (g.audio?.thud) g.audio.thud();
      // Everyone nearby sees it happen.
      for (const p of this.traffic.peds) {
        if (Math.hypot(p.x - car.position.x, p.z - car.position.z) < 26) {
          if (p.brave) p.aggro = Math.max(p.aggro, 8); else p.flee = Math.max(p.flee, 4);
        }
      }
      this.wanted.commit('stealOccupied');
    }

    // Camera swings around the door while it plays out.
    const k = Math.min(1, j.t / 1.5);
    const ang = car.yaw + 1.4 + k * 0.8;
    _v.set(
      car.position.x + Math.sin(ang) * 5.2,
      car.position.y + 2.4,
      car.position.z + Math.cos(ang) * 5.2
    );
    this._smooth.lerp(_v, 1 - Math.exp(-9 * dt));
    g.camera.position.copy(this._smooth);
    g.camera.lookAt(car.position.x, car.position.y + 1.0, car.position.z);

    if (j.t >= 1.5) {
      this.jack = null;
      this._enterCd = 0.4;
      this.enterCar(car);
    }
  }

  /** Dump the ousted driver on the road as a fleeing pedestrian. */
  _ejectDriver(car) {
    const t = this.traffic;
    if (!t || !t.peds.length) return;
    // Recycle the pedestrian furthest from the player — nobody will notice
    // them vanish, and it avoids growing the crowd every time you steal.
    const p = this.game.player.position;
    let far = t.peds[0], fd = -1;
    for (const q of t.peds) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > fd) { fd = d; far = q; }
    }
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    far.x = car.position.x + c * (car.style.w * 0.5 + 1.3);
    far.z = car.position.z - s * (car.style.w * 0.5 + 1.3);
    far.alive = true;
    far.hp = 100;
    far.downT = 0;
    far.flee = 6;
    far.aggro = 0;
    far.from = this.city.nearestNode(far.x, far.z);
    far.to = far.from.links[0] || far.from;
    far.t = 0;
  }

  /**
   * Swimming.
   *
   * Applied as a CORRECTION after the player's normal update rather than as a
   * separate movement mode. The walk code already handles input, look and
   * collision perfectly well; what water changes is only that you float
   * instead of falling, and that you move like someone in water rather than
   * someone on a pavement. Rewriting movement for the wet parts of the map
   * would mean maintaining two of everything.
   *
   * The surface is a target height the body is pulled toward, not a hard
   * clamp — so you bob, you sink a little when you stop, and diving under by
   * holding crouch actually works.
   */
  /**
   * Swimming and diving.
   *
   * The old version floated your FEET 35 cm above the surface — you were
   * standing on the water, not in it — and capped a dive at two metres over a
   * sea that had no bottom. Now the head rides just above the actual wave
   * height at your position, CTRL takes you down to the seabed, SPACE brings
   * you back up, and a held breath is a resource: stay under too long and you
   * start to drown.
   */
  _updateSwimming(dt) {
    const g = this.game;
    const p = g.player;
    const c = this.city;
    const MAX_O2 = 32;
    if (this._o2 === undefined) this._o2 = MAX_O2;

    const water = c.waterHeightAt ? c.waterHeightAt(p.position.x, p.position.z) : (c.seaLevel ?? -0.9);
    const eyeH = p.eyeHeight || 1.6;
    const inWater = c.isWater(p.position.x, p.position.z) && p.position.y + eyeH * 0.55 < water + 0.2;

    if (!inWater) {
      if (this.swimming) {
        this.swimming = false;
        g.hud.brToast?.('OUT OF THE WATER', '');
      }
      this._o2 = Math.min(MAX_O2, this._o2 + dt * 14);
      this._showO2(this._o2 < MAX_O2 - 0.5, this._o2 / MAX_O2);
      return;
    }

    if (!this.swimming) {
      this.swimming = true;
      g.hud.brToast?.('SWIMMING', 'CTRL dive  ·  SPACE surface  ·  WASD swim');
      if (g.audio?.land) g.audio.land(0.5);
    }

    const bed = c.groundAt ? c.groundAt(p.position.x, p.position.z) : water - 30;
    const float = water - eyeH + 0.32;                 // head just clear of the swell
    const floor = bed + 0.05;
    const diving = g.input.keys.has('ControlLeft') || g.input.keys.has('KeyC');
    const rising = g.input.keys.has('Space');

    let y = p.position.y;
    if (diving) y -= 2.6 * dt;
    else if (rising) y += 3.0 * dt;
    else if (y < float - 0.05) y += 0.55 * dt;          // gentle buoyancy
    else y += (float - y) * Math.min(1, dt * 5);        // bob with the surface
    p.position.y = THREE.MathUtils.clamp(y, floor, float);
    p.velocity.y = 0;

    // Water is thick: you move at about a third of running pace, and you don't
    // stop dead when you let go of the stick.
    p.velocity.x *= Math.pow(0.14, dt);
    p.velocity.z *= Math.pow(0.14, dt);
    const fwd = (g.input.keys.has('KeyW') ? 1 : 0) - (g.input.keys.has('KeyS') ? 1 : 0);
    const strafe = (g.input.keys.has('KeyD') ? 1 : 0) - (g.input.keys.has('KeyA') ? 1 : 0);
    const submerged = p.position.y + eyeH < water - 0.05;
    if (fwd || strafe) {
      const SPEED = (submerged ? 3.0 : 3.4) * (g.rules ? g.rules.speed : 1);
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      p.position.x += (-sy * fwd + cy * strafe) * SPEED * dt;
      p.position.z += (-cy * fwd - sy * strafe) * SPEED * dt;
      // Looking down while swimming forward carries you down, like a real dive.
      if (submerged && fwd) p.position.y = Math.max(floor, p.position.y + Math.sin(p.pitch) * fwd * SPEED * dt);
      this._swimPhase = (this._swimPhase || 0) + dt * 4.2;
      if (!submerged) p.position.y += Math.sin(this._swimPhase) * 0.02;
    }

    // Breath.
    if (submerged) {
      this._o2 = Math.max(0, this._o2 - dt);
      if (this._o2 <= 0) {
        this._drownT = (this._drownT || 0) - dt;
        if (this._drownT <= 0) {
          this._drownT = 0.6;
          p.damage?.(6, p.position);
        }
      }
    } else {
      this._o2 = Math.min(MAX_O2, this._o2 + dt * 10);
    }
    this._showO2(submerged || this._o2 < MAX_O2 - 0.5, this._o2 / MAX_O2);
  }

  /** A breath meter under the crosshair while it matters, hidden otherwise. */
  _showO2(show, frac) {
    if (!this._o2El) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);width:220px;height:8px;'
        + 'background:rgba(0,22,32,.55);border:1px solid rgba(130,220,255,.55);display:none;z-index:40;pointer-events:none';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#39c8f5,#c4f3ff);transition:width .1s linear';
      const label = document.createElement('div');
      label.textContent = 'O2';
      label.style.cssText = 'position:absolute;left:-28px;top:-4px;font:600 11px/1 system-ui,sans-serif;color:#c4f3ff;letter-spacing:2px';
      el.appendChild(fill);
      el.appendChild(label);
      document.body.appendChild(el);
      this._o2El = el;
      this._o2Fill = fill;
    }
    const want = show && this.active;
    this._o2El.style.display = want ? 'block' : 'none';
    if (want) {
      this._o2Fill.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
      this._o2Fill.style.background = frac < 0.25
        ? 'linear-gradient(90deg,#ff5a4a,#ffb0a0)' : 'linear-gradient(90deg,#39c8f5,#c4f3ff)';
    }
  }

  /**
   * Under the surface the world has to LOOK underwater, or diving is just
   * walking slowly on the seabed under a clear sky. Thick blue-green fog closes
   * visibility to a few tens of metres and the daylight goes cool and dim.
   * Stored and restored exactly, the same way the caves handle it.
   */
  _updateUnderwaterView() {
    const g = this.game;
    const cam = g.camera.position;
    const c = this.city;
    const under = !this.inDungeon && !!c && !!c.ocean
      && c.isWater(cam.x, cam.z) && cam.y < c.waterHeightAt(cam.x, cam.z) - 0.04;
    const fog = g.scene.fog;
    const hemi = g.world && g.world.hemi;
    if (under && !this._underwater) {
      this._underwater = {
        fog: fog ? fog.color.getHex() : 0, density: fog ? fog.density : 0,
        hemi: hemi ? hemi.intensity : 0, hemiCol: hemi ? hemi.color.getHex() : 0
      };
      if (fog) { fog.color.setHex(0x0d5566); fog.density = 0.042; }
      if (hemi) { hemi.intensity = hemi.intensity * 0.7; hemi.color.setHex(0x6fc4d0); }
    } else if (!under && this._underwater) {
      const k = this._underwater;
      if (fog) { fog.color.setHex(k.fog); fog.density = k.density; }
      if (hemi) { hemi.intensity = k.hemi; hemi.color.setHex(k.hemiCol); }
      this._underwater = null;
    }
  }

  /**
   * Anything on wheels that reaches the player on foot hurts them.
   *
   * Damage scales with the vehicle's speed and its mass, so a bus at 40 km/h
   * is a very different event from a bike clipping you. There's a short
   * immunity window afterwards — without it a car resting against you would
   * deal damage every frame and kill you instantly, which is the same trap
   * the vehicle crash damage fell into.
   */
  _checkRoadkill(dt) {
    const g = this.game;
    this._hitCd = Math.max(0, (this._hitCd || 0) - dt);
    if (this._hitCd > 0) return;
    const p = g.player.position;

    const consider = (car) => {
      if (!car.alive) return false;
      const spd = Math.abs(car.speed);
      if (spd < 4) return false;                     // crawling: just a nudge
      const reach = car.radius + 0.9;
      const dx = car.position.x - p.x, dz = car.position.z - p.z;
      if (dx * dx + dz * dz > reach * reach) return false;

      const mass = car.style.mass ?? 1;
      const dmg = Math.min(92, (spd - 3) * 3.4 * mass);
      this._hitCd = 1.0;
      // Second argument is the SOURCE POSITION, which drives the on-screen
      // damage-direction indicator — not a label.
      g.player.damage?.(dmg, car.position);
      // Thrown clear, in the direction the vehicle was travelling.
      const push = Math.min(14, spd * 0.55);
      g.player.velocity.set(
        -Math.sin(car.yaw) * push, Math.max(3.5, push * 0.35), -Math.cos(car.yaw) * push
      );
      if (g.effects && g.effects.bloodHit) {
        g.effects.bloodHit(_v.copy(p).setY(p.y + 1), _look.set(0, 1, 0), false);
      }
      if (g.audio && g.audio.impact) g.audio.impact();
      g.hud.brToast?.('HIT BY TRAFFIC', `${Math.round(dmg)} damage`);
      return true;
    };

    for (const ai of this.traffic.cars) if (consider(ai.car)) return;
    for (const u of this.wanted.units) if (consider(u.car)) return;
    for (const c of this.parked) if (consider(c)) return;
  }

  /**
   * A bare-handed swing at whoever is in front of you.
   *
   * Deliberately short-ranged and weak: two or three connected punches put
   * someone down. It exists so you always have a way to start trouble, not as
   * a replacement for a gun — and unlike gunfire it only draws a little heat,
   * because a scuffle isn't a shooting.
   */
  punch() {
    const g = this.game;
    const traffic = this.traffic;
    if (!traffic) return false;
    const cam = g.camera;
    cam.getWorldDirection(_look);
    const RANGE = 2.6;
    const ARC = 0.55;            // cos of the half-angle: a forward cone

    let best = null, bestD = RANGE;
    for (const p of traffic.peds) {
      if (!p.alive) continue;
      _v.set(p.x - cam.position.x, 1.05 - cam.position.y, p.z - cam.position.z);
      const d = _v.length();
      if (d > RANGE) continue;
      _v.divideScalar(d);
      if (_v.dot(_look) < ARC) continue;
      if (d < bestD) { bestD = d; best = p; }
    }

    if (g.audio && g.audio.swing) g.audio.swing();
    g.player.addRecoil(0.012, (Math.random() - 0.5) * 0.014);
    if (!best) return false;

    const killed = traffic.hurtPed(best, 34 + Math.random() * 12, false);
    // Shove them away so the blow lands with some weight — but only a little.
    // At 1.4 m they were knocked clean out of the 2.6 m reach, so a standing
    // player could never land a second punch without walking after them.
    const push = killed ? 0 : 0.45;
    best.x += _look.x * push;
    best.z += _look.z * push;
    g.hud.hitmarker?.(false);
    if (g.effects && g.effects.burst) {
      g.effects.burst(_v.set(best.x, 1.2, best.z), { count: 6, color: 0xffd0c0, speed: 3, life: 0.25 });
    }
    return true;
  }

  /** Fired by the weapon system when the player shoots in GTAZ. */
  onPlayerShot() {
    if (!this.active || !this.wanted) return;
    this._threat = 3.0;
    this.wanted.commit('shootInPublic', 0.35);
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const input = g.input;

    this._enterCd = Math.max(0, this._enterCd - dt);
    this._threat = Math.max(0, this._threat - dt);
    // Doors and bonnets swinging on any car in the city.
    tickVehiclePanels(dt);
    // Moored boats bob on the swell; parked aircraft flash their strobes and
    // sweep their beacons. Only for the ones close enough to see — an idle
    // tick for something two kilometres out to sea is a frame spent on
    // nothing at all.
    const _cam = g.camera.position;
    for (const a of (this.aircraft || [])) {
      if (!a.driver && a.alive && _cam.distanceToSquared(a.position) < 360 * 360) a.idle(dt);
    }
    for (const b of (this.boats || [])) {
      if (!b.driver && b.alive && _cam.distanceToSquared(b.position) < 300 * 300) b.idle(dt);
    }
    // The sea: waves, foam, swaying kelp, circling fish.
    if (this.city && this.city.ocean) this.city.ocean.update(dt, g.camera);
    // Grass and beach detail near the camera only; parted where you walk.
    this.city?.updateGround?.(g.camera.position, this.driving ? null : g.player.position);
    if (this.sandFX) {
      if (this.driving) this.sandFX.wheels(this.driving, dt);
      this.sandFX.update(dt);
    }
    this._updateRigid(dt);
    this._updateUnderwaterView();

    // --- Third person on foot ------------------------------------------------
    // The BR mode already has a full over-the-shoulder rig with boom
    // collision and crosshair-convergent firing; reusing it here beats
    // writing a second one that behaves subtly differently.
    if (input.pressed('KeyT') && !this.driving) {
      const tp = g.thirdPerson;
      if (tp) {
        tp.setEnabled(!tp.enabled);
        g.hud.brToast?.(tp.enabled ? 'THIRD PERSON' : 'FIRST PERSON', 'T to switch');
      }
    }
    if (!this.driving && g.thirdPerson?.enabled) g.thirdPerson.update(dt);

    // --- Camera: inside the car, or behind it -------------------------------
    if (input.pressed('KeyC') && this.driving) {
      this.cockpit = !this.cockpit;
      g.hud.brToast?.(this.cockpit ? 'COCKPIT VIEW' : 'CHASE VIEW', 'C to switch');
    }

    // --- Melee: throw a punch, whatever you're holding ----------------------
    this._punchCd = Math.max(0, (this._punchCd || 0) - dt);
    if (input.pressed('KeyV') && !this.driving && this._punchCd <= 0) {
      this._punchCd = 0.45;
      this.punch();
    }

    // --- Bonnet: walk up to a car and lift it ------------------------------
    if (input.pressed('KeyH') && !this.driving && !this.jack) {
      const p = g.player.position;
      let best = null;
      let bd = 5.0;
      for (const c of this._allVehicles()) {
        if (!c.bonnet) continue;
        const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        best.setBonnet(!best.bonnetOpen);
        g.hud.brToast?.(best.bonnetOpen ? 'BONNET UP' : 'BONNET DOWN', (best.name || '') + '  ·  H');
      }
    }

    // --- Carjack in progress: nothing else happens until it finishes --------
    if (this.jack) { this._updateJack(dt); return; }

    // --- Enter / exit -------------------------------------------------------
    if (input.pressed('KeyF') && this._enterCd <= 0) {
      this._enterCd = 0.4;
      if (this.driving) this.exitCar();
      else {
        const car = this._nearestCar();
        if (!car) g.hud.brToast?.('NO VEHICLE', 'Stand closer to a car');
        // An occupied car has to be taken off somebody. An empty one you
        // just get into.
        else if (car.occupants && car.occupants.visible) this._startJack(car);
        else this.enterCar(car);
      }
    }

    // --- Driving ------------------------------------------------------------
    if (this.driving) {
      this._updateDriving(dt);
    }

    // --- Vehicles hitting each other ----------------------------------------
    this._resolveVehicleHits(dt);

    // --- Swimming -----------------------------------------------------------
    if (!this.driving) this._updateSwimming(dt);

    // --- Getting run over ---------------------------------------------------
    // Traffic doesn't brake for you. On foot, anything moving quickly that
    // reaches you does real damage and throws you clear.
    if (!this.driving) this._checkRoadkill(dt);

    // Signals run whether you're driving or walking.
    this.city.updateSignals(dt);
    this._updateHatches(dt);
    this.missions.update(dt);
    // --- Boss: watch how this fight is going ---------------------------------
    if (this.boss) {
      if (this.boss.alive) {
        this.bossMemory.observe(dt, this.boss);
        // Apply what it learned: close the gap, keep away, or jitter.
        this._steerBoss(dt, this.boss);
        // The ward's shell breathes, and breathes faster once it is enraged.
        this._bossShell?.update(dt, this.boss);
      } else {
        const learned = this.bossMemory.endFight();
        const g2 = this.game;
        const spec = this.boss.answer;
        // Its own last line first, then what it passed on.
        g2.hud.brToast?.(spec ? spec.title + ' IS DOWN' : 'WARDEN DOWN',
          (spec ? spec.death + ' ' : '')
          + (learned.length ? 'It told the next one how you did it.' : 'Clean kill.'),
          spec ? '#' + spec.color.toString(16).padStart(6, '0') : undefined);
        this._bossShell = null;
        this.boss = null;
      }
    }

    // Torches only flicker in the cave you are actually standing in.
    if (this.inDungeon && this.inDungeon.update) {
      this.inDungeon.update(dt, performance.now() * 0.001);
    }
    // Shops and cafes: standing inside one opens its counter.
    this.dining.update(dt);

    // --- City life ----------------------------------------------------------
    const pos = this.driving ? this.driving.position : g.player.position;
    const threat = this._threat > 0 || this.wanted.level > 0 ? 1 : 0;
    this.traffic.update(dt, pos, threat);
    this.wanted.update(dt);

    // Running people over is a crime, and it is easy to do by accident.
    if (this.driving && Math.abs(this.driving.speed) > 6) {
      for (const p of this.traffic.peds) {
        const d = Math.hypot(p.x - pos.x, p.z - pos.z);
        if (d < 2.2 && !p._hit) {
          p._hit = 1.5;
          // Being hit by a car actually hurts — this used to only flag the
          // crime and leave the person walking. Damage scales with speed, and
          // routes through hurtPed so it gets the dull vehicle thud rather
          // than the piercing combat hitmarker.
          // The momentum the car is actually carrying, so the ragdoll goes
          // where the car was going at the speed it was doing. A glancing hit
          // to one side spins them; a square one sends them over the bonnet.
          const sp = this.driving.speed;
          const side = ((p.x - pos.x) * Math.cos(this.driving.yaw)
            - (p.z - pos.z) * Math.sin(this.driving.yaw));
          _rv.set(-Math.sin(this.driving.yaw) * sp * 0.62, 2.6 + Math.abs(sp) * 0.10,
            -Math.cos(this.driving.yaw) * sp * 0.62);
          this.traffic.hurtPed(p, 25 + Math.abs(this.driving.speed) * 2.4, false, 'vehicle', {
            impulse: _rv, spin: 1 + Math.min(2, Math.abs(side) * 1.4)
          });
          p.flee = 3;
        }
        if (p._hit) p._hit = Math.max(0, p._hit - dt);
      }
    }

    this._updateVehicleLOD();
    this._updateTorchLights();
    // Standing at an inscription reads it. Only underground, and only once
    // per piece — see Undercity.
    this.undercity?.update(dt, g.player);
    this._updateDistrict(pos);
    this._updateCaveGuide(pos);
    this._updateHud();
  }

  /**
   * Sweep vehicles for level of detail.
   *
   * Spread across frames rather than done all at once: 130 cars is 130
   * distance checks plus, on the frames where a car crosses a threshold, a
   * walk of its 46 trim meshes. Doing a sixth of the list per frame keeps the
   * per-frame cost flat and still re-evaluates everything ten times a second,
   * which is far quicker than anything can travel 80 m.
   */
  _updateVehicleLOD() {
    const cam = this.game.camera.position;
    const all = this._allVehicles ? this._allVehicles() : this.parked;
    if (!all || !all.length) return;
    const stride = 6;
    this._lodCursor = ((this._lodCursor || 0) + 1) % stride;
    for (let i = this._lodCursor; i < all.length; i += stride) {
      const v = all[i];
      if (!v || !v.group || !v.setLOD) continue;
      v.setLOD(cam.distanceTo(v.position));
    }
    // Planes and boats had no LOD at all: a parked plane was fifty-odd draw
    // calls from across the airfield. Merged past 120 m unless crewed.
    for (const v of this.aircraft || []) this._farCraft(v, cam);
    for (const v of this.boats || []) this._farCraft(v, cam);
  }

  _farCraft(v, cam) {
    if (!v || !v.group || !v.position) return;
    if (!v._far) v._far = new FarProxy(v.group);
    v._far.set(!v.driver && cam.distanceTo(v.position) > 120);
  }

  _updateDriving(dt) {
    const g = this.game;
    const car = this.driving;
    const input = g.input;

    // THE RULESET APPLIES LIVE, every frame, to whatever you are driving.
    // It used to be stamped onto the car once, the moment you got in — so a
    // car taken in FUN kept its 7x speed after you switched to REAL, until
    // you stepped out. REAL now always means the factory figures.
    this._applyCarRules(car);

    // Somebody is at the controls in chase view; nobody in the way of the
    // cockpit camera.
    // On a bike the rider IS you in the chase view — but in first person the
    // camera sits inside his helmet, so he goes.
    car.setOccupantsVisible?.(car.style?.id === 'bike'
      ? !(this.cockpit && car.eye)
      : (!this.cockpit || !car.eye));

    // THE GUN IS NOT ON SCREEN WHILE YOU DRIVE.
    //
    // The first-person weapon rig is parented to the camera, so unless it is
    // switched off it rides along and plants a 91-mesh rifle right in the
    // middle of the windscreen — exactly where the road is. enterCar() hides
    // it once, but anything that touches the third-person toggle turns it
    // straight back on, and then it stays on for the rest of the drive.
    // Asserting it here every frame means nothing else can put it back.
    if (g.weapons?.rig) g.weapons.rig.visible = false;

    if (!car.alive) {
      // The car died under you. Get out before it takes you with it.
      this.exitCar();
      g.player.damage?.(35, 'WRECK');
      return;
    }

    const fwd = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
    const turn = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
    const boost = input.keys.has('ShiftLeft') ? 1.35 : 1;
    const handbrake = input.keys.has('Space');

    // --- Boats: throttle and helm, no handbrake -----------------------------
    if (car.isBoat) {
      car.drive(dt, fwd * boost, turn);
      g.player.position.copy(car.position);
      g.player.position.y = car.position.y + 1.0;
      g.player.velocity.set(0, 0, 0);
      if (this.cockpit && car.eye) this._cockpitCamera(dt, car);
      else this._chaseCamera(dt, car, car.type.topSpeed, 12, 4.8);
      return;
    }

    // --- Aircraft take a different control set ------------------------------
    if (car.isAircraft) {
      const pitchIn = (input.keys.has('KeyS') ? 1 : 0) - (input.keys.has('KeyW') ? 1 : 0);
      const throttle = (input.keys.has('ShiftLeft') ? 1 : 0) - (input.keys.has('ControlLeft') ? 1 : 0);
      const lift = input.keys.has('Space') ? 1 : 0;
      car.fly(dt, throttle || 0.35, pitchIn, turn, lift);
      g.player.position.copy(car.position);
      g.player.position.y = car.position.y + 1.2;
      g.player.velocity.set(0, 0, 0);
      this._chaseCamera(dt, car, car.type.topSpeed, 14, 5.5);
      return;
    }

    const before = car.position.clone();
    car.drive(dt, fwd * boost, turn, handbrake);
    this.stats.distance += car.position.distanceTo(before);
    this.stats.topSpeed = Math.max(this.stats.topSpeed, Math.abs(car.speed));

    // Reckless driving near people builds heat slowly.
    if (Math.abs(car.speed) > 26) this.wanted.commit('reckless', dt);

    // The player rides along so weapons, audio and the minimap all still work
    // off a single position. Anything that reads player.position keeps working.
    g.player.position.copy(car.position);
    g.player.position.y = car.position.y + 0.9;
    g.player.velocity.set(0, 0, 0);

    if (this.cockpit && car.eye) this._cockpitCamera(dt, car);
    else this._chaseCamera(dt, car, car.style.topSpeed, this.camDist, 4.6);
  }

  /**
   * Driving from the driver's seat, looking out through the windscreen.
   *
   * The camera is parented to the car's transform by hand rather than being
   * added as a child, because the rest of the engine expects a free camera it
   * can raycast from. Mouse look is free inside the cabin — you can look
   * across at the passenger window or over your shoulder — but it re-centres
   * on the road when you stop moving the mouse, so you never lose the view
   * you're steering by.
   */
  _cockpitCamera(dt, car) {
    const g = this.game;
    const input = g.input;

    // Eye position taken from the MESH transform, not recomputed by hand.
    // A hand-rolled rotation here silently disagreed with the body the moment
    // the model's facing was corrected, and put the camera in the back seat.
    car.group.updateMatrixWorld(true);
    _v.copy(car.eye);
    car.group.localToWorld(_v);
    // No smoothing: the head is bolted to the car, and lag here reads as the
    // whole cabin sloshing around you.
    g.camera.position.copy(_v);

    // Free look, easing back to straight ahead when the mouse is still.
    if (Math.abs(input.mouseDX) < 0.5) {
      let diff = car.yaw - g.player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.player.yaw += diff * Math.min(1, dt * 3.4);
    }
    g.player.pitch = THREE.MathUtils.clamp(g.player.pitch, -0.5, 0.4);
    g.camera.rotation.set(g.player.pitch, g.player.yaw, 0, 'YXZ');

    // A little speed in the FOV, less than the chase camera — from inside,
    // the doorframes already give you the sense of motion.
    const speedT = Math.min(1, Math.abs(car.speed) / Math.max(1, car.style.topSpeed));
    const targetFov = (g.settings.fov || 80) - 6 + speedT * 10;
    g.camera.fov += (targetFov - g.camera.fov) * Math.min(1, dt * 4);
    g.camera.updateProjectionMatrix();
  }

  /**
   * Shared chase camera for anything you can pilot.
   *
   * Mouse look steers the camera; the vehicle steers itself. The camera eases
   * back toward the vehicle's heading when you stop looking around, so it
   * settles behind you without ever fighting the mouse.
   */
  _chaseCamera(dt, veh, topSpeed, baseDist, baseHeight) {
    const g = this.game;
    const input = g.input;

    this.camYaw = g.player.yaw;
    if (Math.abs(input.mouseDX) < 0.5) {
      let diff = veh.yaw - this.camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.player.yaw += diff * Math.min(1, dt * 1.6);
      this.camYaw = g.player.yaw;
    }

    const speedT = Math.min(1, Math.abs(veh.speed) / Math.max(1, topSpeed));
    const dist = baseDist + speedT * 4.5;
    // Looking up with the mouse lifts the boom as well as the aim, so you can
    // crane over the bonnet to read a junction before you reach it.
    const lift = THREE.MathUtils.clamp(-g.player.pitch, -0.35, 0.7) * 5.0;
    const height = baseHeight + speedT * 1.3 + lift;
    _v.set(
      veh.position.x + Math.sin(this.camYaw) * dist,
      veh.position.y + height,
      veh.position.z + Math.cos(this.camYaw) * dist
    );
    // Keep the camera out of walls.
    const dir = _look.copy(_v).sub(veh.position);
    const boomLen = dir.length();
    dir.divideScalar(boomLen);
    const hit = g.physics.raycast(veh.position, dir, boomLen + 0.4);
    if (hit) _v.copy(veh.position).addScaledVector(dir, Math.max(2.2, hit.dist - 0.4));
    if (_v.y < veh.position.y + 1.2) _v.y = veh.position.y + 1.2;

    // Entry animation: for the first half-second the camera flies from where
    // you were standing to the driving position instead of cutting.
    if (this._enterT > 0) {
      this._enterT = Math.max(0, this._enterT - dt);
      const k = 1 - this._enterT / 0.55;
      const eased = k * k * (3 - 2 * k);
      _v.lerpVectors(this._enterFrom, _v, eased);
      this._smooth.copy(_v);
    } else {
      this._smooth.lerp(_v, 1 - Math.exp(-11 * dt));
    }
    g.camera.position.copy(this._smooth);

    // AIM DOWN THE ROAD, NOT AT THE CAR.
    //
    // This is the whole difference between a camera that follows a car and a
    // camera you can drive with. Pointing at the vehicle centres the bodywork
    // and throws away the top of the frame on sky; pointing at a spot well
    // ahead of it drops the car into the lower third and fills everything
    // above it with the road you are about to be on. Same boom, same distance
    // — you just see several more seconds into the future.
    //
    // The look-ahead stretches with speed, because the faster you go the
    // further ahead the decisions are.
    const ahead = 11 + speedT * 16;
    _look.set(
      veh.position.x - Math.sin(veh.yaw) * ahead,
      veh.position.y + 1.1,
      veh.position.z - Math.cos(veh.yaw) * ahead
    );
    // Blend the aim toward wherever the mouse is pointing, so free-look still
    // works and the road view is simply where it rests.
    const camAhead = 20;
    _v.set(
      this._smooth.x - Math.sin(this.camYaw) * camAhead,
      this._smooth.y + Math.sin(g.player.pitch) * camAhead,
      this._smooth.z - Math.cos(this.camYaw) * camAhead
    );
    _look.lerp(_v, 0.42);
    g.camera.lookAt(_look);

    // FOV opens up with speed — the cheapest possible sense of velocity.
    // Anchored to the player's OWN fov setting rather than a magic number, so
    // someone who has pulled their field of view in doesn't get it forced back
    // out the moment they sit in a car.
    const baseFov = g.settings.fov || 80;
    const targetFov = baseFov - 2 + speedT * 12;
    g.camera.fov += (targetFov - g.camera.fov) * Math.min(1, dt * 4);
    g.camera.updateProjectionMatrix();
  }

  /**
   * Nudge the boss according to what it learned.
   *
   * The base enemy AI already chases and shoots; this layers the lesson on
   * top as a positional bias, so a boss that learned you fight at range
   * physically presses in, and one that learned you brawl backs off. That is
   * the whole reason the system reads as adaptation rather than a stat bump —
   * you can SEE it refusing to fight the way you want to.
   */
  _steerBoss(dt, boss) {
    const shape = boss.bossShape;
    if (!shape) return;
    const p = this.game.player.position;
    const d = Math.hypot(boss.position.x - p.x, boss.position.z - p.z);
    const want = Math.max(3, shape.preferredRange);
    const err = d - want;

    // Push toward or away from the player to hold its preferred range.
    if (Math.abs(err) > 2.5) {
      const dir = err > 0 ? 1 : -1;
      const sp = 2.2 * dir * (0.5 + shape.tier * 0.12);
      const ax = (p.x - boss.position.x) / (d || 1);
      const az = (p.z - boss.position.z) / (d || 1);
      boss.position.x += ax * sp * dt;
      boss.position.z += az * sp * dt;
    }

    // Erratic strafing, so headshots stop being free.
    if (shape.jitter > 0.1) {
      this._bossPhase = (this._bossPhase || 0) + dt * (3 + shape.jitter * 5);
      const ax = (p.x - boss.position.x) / (d || 1);
      const az = (p.z - boss.position.z) / (d || 1);
      const sway = Math.sin(this._bossPhase) * shape.jitter * 3.4 * dt;
      boss.position.x += -az * sway;
      boss.position.z += ax * sway;
    }
  }

  /**
   * Point the player at the nearest cave they have not cleared.
   *
   * Without this the caves are five unmarked spots in four square kilometres.
   * The beam is visible from a distance; this closes the last gap by naming
   * the place and counting the metres down as you approach.
   */
  _updateCaveGuide(pos) {
    let near = null, best = Infinity;
    for (const c of (this.dungeons || [])) {
      if (c.cleared) { if (c.beam) c.beam.visible = false; continue; }
      if (c.beam) c.beam.visible = true;
      const d = Math.hypot(pos.x - c.hatch.x, pos.z - c.hatch.z);
      if (d < best) { best = d; near = c; }
    }
    this.nearestCave = near;
    this.nearestCaveDist = near ? best : null;
  }

  _updateDistrict(pos) {
    const d = this.city.district(pos.x, pos.z);
    const id = d ? d.id : null;
    if (id !== this._district) {
      this._district = id;
      if (d) this.game.hud.banner?.(d.name, 'GTAZ');
    }
  }

  _updateHud() {
    const hud = this.game.hud;
    if (!hud.gtaz) return;
    const car = this.driving;
    hud.gtaz({
      cave: this.nearestCave
        ? `${this.nearestCave.name}  ${Math.round(this.nearestCaveDist)}m`
        : null,
      stars: this.wanted.level,
      speed: car ? Math.round(Math.abs(car.speed) * 3.6) : 0,
      inCar: !!car,
      district: this._district
        ? (DISTRICTS.find((x) => x.id === this._district)?.name ?? '')
        : ''
    });
  }

  stop() {
    this.active = false;
    this.sandFX?.dispose();
    this.sandFX = null;
    this.game.hud.setGTAZMode?.(false);
    if (this.driving) this.exitCar();
    if (this.traffic) this.traffic.dispose();
    if (this.wanted) this.wanted.reset();
    if (this.dining) this.dining.stop();
    if (this.missions) this.missions.stop();
    for (const c of this.parked) c.dispose();
    this.parked.length = 0;
    this.traffic = null;
    this.wanted = null;
    this.game.camera.fov = this.game.settings.fov || 80;
    this.game.camera.updateProjectionMatrix();
  }
}
