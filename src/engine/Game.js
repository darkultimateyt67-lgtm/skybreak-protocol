import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './Input.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { World } from '../world/World.js';
import { resolveRules } from '../city/Ruleset.js';
import { Footprints } from '../world/Foliage.js';
import { CrashScene } from './CrashScene.js';
import { TouchControls } from './TouchControls.js';
import { Momentum } from './Momentum.js';
import { BattleRoyale } from '../battleground/BattleRoyale.js';
import { Photoreal, QUALITY } from './Photoreal.js';
import { ThirdPerson } from '../player/ThirdPerson.js';
import { FreeRoam } from '../city/FreeRoam.js';
import { Effects } from '../effects/Effects.js';
import { Player, OPERATORS } from '../player/Player.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { Utilities } from '../weapons/Utilities.js';
import { EnemyManager, DIFFICULTIES } from '../ai/EnemyManager.js';
import { QuestManager } from '../quests/QuestManager.js';
import { AudioSys } from '../audio/AudioSys.js';
import { Voice } from '../audio/Voice.js';
import { Music } from '../audio/Music.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { Loading } from '../ui/Loading.js';
import { MAPS } from '../world/maps.js';

/**
 * A first-run quality tier from the graphics chip. Starting everyone on HIGH
 * meant a laptop or phone spent its first minutes as a slideshow before the
 * adaptive tier caught up — and world detail is baked when a map is built, so
 * stepping down mid-game could not take back the heaviest part anyway.
 * Only used when the player has never saved a quality setting.
 */
function guessQuality() {
  try {
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    if (mobile) return 'low';
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) return 'potato';
    if (/Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(gpu)) {
      return (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'medium';
    }
    return 'high';
  } catch {
    return 'medium';
  }
}

/** Map definitions by id, for the loading screen's chapter line. */
const ALL_MAPS_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));

export const State = {
  MENU: 'menu',
  CRASH: 'crash',
  PLAYING: 'playing',
  PAUSED: 'paused',
  SHOP: 'shop',
  DEAD: 'dead'
};

/**
 * Game — owns the renderer, the fixed subsystem graph and the state machine.
 * Subsystems never import each other; they receive this object and talk
 * through its references, which keeps the dependency graph acyclic.
 */
export class Game {
  constructor(container) {
    this.container = container;
    this.state = State.MENU;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.credits = 0;
    this.revealUntil = 0; // recon pulse: minimap shows all enemies until then
    this.settings = this._loadSettings();
    this._menuAngle = 0;
    this._fpsTime = 0;
    this._fpsFrames = 0;
  }

  _loadSettings() {
    const defaults = {
      sensitivity: 1.0, adsSens: 0.8, fov: 80, volume: 0.7,
      map: 'verdant', diff: 'veteran', operator: 'vector', mode: 'career',
      career: { name: 'VECTOR', color: '#2d4a56', accent: '#37e6ff', primary: 'riptide' },
      bob: true, showFps: true, invertY: false, shake: true, voice: true, subtitles: true, music: true,
      // The dropship goes down once. After that every career run starts on
      // the ground beside the wreck.
      crashSeen: false,
      renderScale: 1, shadows: true, bloomOn: true, minimap: true,
      quality: guessQuality(), autoQuality: true,
      // GTAZ only. 'fun' lets the dials below do anything; 'real' ignores
      // them entirely and plays the game at its designed numbers.
      gtazRules: 'fun', funSpeed: 7, funHealth: 7, funPolice: false,
      crosshair: { color: '#37e6ff', size: 9, gap: 6, dot: true }
    };
    try {
      const saved = JSON.parse(localStorage.getItem('skybreak_settings') || '{}');
      return {
        ...defaults, ...saved,
        crosshair: { ...defaults.crosshair, ...(saved.crosshair || {}) },
        career: { ...defaults.career, ...(saved.career || {}) }
      };
    } catch {
      return defaults;
    }
  }

  /**
   * The active character. Skirmish uses a preset operator; career builds one
   * from the player's customization (callsign, colors, chosen primary).
   */
  get operator() {
    if (this.settings.mode === 'career') {
      const c = this.settings.career;
      return {
        id: 'career', label: (c.name || 'VECTOR').toUpperCase(),
        desc: 'Custom ARC operative',
        health: 100, armor: 60, speed: 1.02, energy: 1.15,
        color: parseInt((c.color || '#2d4a56').slice(1), 16),
        accent: parseInt((c.accent || '#37e6ff').slice(1), 16),
        loadout: [c.primary || 'riptide', 'wasp'],
        weaponNote: ''
      };
    }
    return OPERATORS[this.settings.operator] || OPERATORS.vector;
  }

  saveSettings() {
    localStorage.setItem('skybreak_settings', JSON.stringify(this.settings));
  }

  // ------------------------------------------------------------ career saves

  /**
   * Career progress lives in its own slot so settings changes never wipe it.
   * Written after every quest completion and purchase.
   */
  saveCareer() {
    if (this.settings.mode !== 'career' || !this.quests) return;
    const save = {
      v: 1,
      at: Date.now(),
      map: this.settings.map,
      diff: this.settings.diff,
      questIndex: this.quests.index,
      chapterDone: this.quests.chapterDone,
      credits: this.credits,
      score: this.score,
      kills: this.kills,
      headshots: this.headshots,
      maxArmor: this.player.maxArmor,
      owned: this.weapons.weapons.filter((w) => w.owned).map((w) => w.def.id),
      current: this.weapons.current.def.id,
      reserves: Object.fromEntries(
        this.weapons.weapons.filter((w) => w.owned).map((w) => [w.def.id, w.reserve])
      ),
      frags: this.utilities.frags,
      recons: this.utilities.recons,
      salvaged: this.world.salvagePoints.map((s) => (s.taken ? 1 : 0))
    };
    try {
      localStorage.setItem('skybreak_career', JSON.stringify(save));
      this._career = save;
    } catch { /* storage full or blocked — play on regardless */ }
  }

  /** The saved run, or null. */
  loadCareer() {
    try {
      const raw = localStorage.getItem('skybreak_career');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.v === 1 ? s : null;
    } catch {
      return null;
    }
  }

  clearCareer() {
    localStorage.removeItem('skybreak_career');
    this._career = null;
  }

  /** Human-readable summary for the CONTINUE button. */
  careerSummary() {
    const s = this.loadCareer();
    if (!s) return null;
    const total = (this.world && this.world.def.quests) ? this.world.def.quests.length : 0;
    return {
      questIndex: s.questIndex,
      total,
      credits: s.credits,
      when: new Date(s.at).toLocaleDateString()
    };
  }

  /** Resume a saved career: skip the crash, restore everything, drop in. */
  async continueCareer(useLock = true) {
    // Resuming only makes sense in career. If any other mode is selected, the
    // player asked for that mode — honour it rather than silently switching
    // them to the campaign. This guard lives here, not just on the button,
    // because the button is the thing most likely to be stale: a cached menu
    // can still offer CONTINUE in the wrong mode, and this makes that
    // harmless instead of confusing.
    if (this.settings.mode !== 'career') return this.start(useLock);
    const s = this.loadCareer();
    if (!s) return this.start(useLock);
    this.settings.mode = 'career';
    if (s.map) this.settings.map = s.map;
    if (s.diff) this.settings.diff = s.diff;
    this.saveSettings();
    this._skipCrash = true;
    this._resume = s;
    await this.start(useLock);
  }

  /** Apply a save on top of a freshly-started run. */
  _applyResume(s) {
    this.credits = s.credits ?? 300;
    this.score = s.score ?? 0;
    this.kills = s.kills ?? 0;
    this.headshots = s.headshots ?? 0;
    if (s.maxArmor) {
      this.player.maxArmor = s.maxArmor;
      this.player.armor = s.maxArmor;
    }
    // Weapons: ownership, reserves, and what you were holding.
    for (const w of this.weapons.weapons) {
      const owned = (s.owned || []).includes(w.def.id);
      w.owned = owned || w.owned;
      if (owned && s.reserves && s.reserves[w.def.id] != null) w.reserve = s.reserves[w.def.id];
      w.model.visible = false;
    }
    const idx = this.weapons.weapons.findIndex((w) => w.def.id === s.current && w.owned);
    this.weapons.index = idx >= 0 ? idx : Math.max(0, this.weapons.weapons.findIndex((w) => w.owned));
    this.weapons.weapons[this.weapons.index].model.visible = true;
    this.weapons._pushHUD();

    this.utilities.frags = s.frags ?? this.utilities.frags;
    this.utilities.recons = s.recons ?? this.utilities.recons;
    this.utilities._pushHUD();

    // Quest chain position.
    this.quests.index = Math.min(s.questIndex ?? 0, this.quests.quests.length);
    this.quests.chapterDone = !!s.chapterDone;
    this.quests._refreshHUD();

    // Salvage already looted stays looted.
    if (s.salvaged) {
      this.world.salvagePoints.forEach((p, i) => {
        if (s.salvaged[i]) {
          p.taken = true;
          p.lid.visible = false;
          p.box.material = this.world.mats.structureDark;
        }
      });
    }

    this.hud.setCredits(this.credits);
    this.hud.setScore(this.score);
  }

  /** True while a battle-royale match is running. */
  get isBR() {
    return this.settings.mode === 'battleground';
  }

  /** True while the GTAZ open-city sandbox is running. */
  get isGTAZ() {
    return this.settings.mode === 'gtaz';
  }

  /**
   * The active ruleset — FUN's multipliers or REAL's stock numbers.
   *
   * Resolved on every read rather than cached, so switching mode in the menu
   * applies on the next frame and can never leave half the game boosted.
   * Always STOCK outside GTAZ.
   */
  get rules() {
    return resolveRules(this);
  }

  /** The second line on the loading screen: the chapter, in the campaign. */
  _loadingLine() {
    if (this.settings.mode !== 'career') return null;
    const def = ALL_MAPS_BY_ID[this.settings.map];
    return def ? `${def.chapter}  ·  ${def.name}` : null;
  }

  /** Active difficulty preset (multipliers used by the enemy director). */
  get difficulty() {
    return DIFFICULTIES[this.settings.diff] || DIFFICULTIES.veteran;
  }

  init() {
    // --- Renderer -----------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.08, 1600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Image-based reflections: metals and armor pick up a believable sheen.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // Stronger image-based lighting: metals and armour pick up more of the
    // surrounding environment, which is a large part of looking "shot" and
    // not "rendered".
    this.scene.environmentIntensity = 0.62;
    pmrem.dispose();

    // --- Post-processing: ambient occlusion, AA and a filmic grade ---------
    this.photoreal = new Photoreal(this);
    this.photoreal.build(this.settings.quality || 'high');

    // --- Subsystems ------------------------------------------------------------
    this.input = new Input();
    this.physics = new PhysicsWorld();
    this.audio = new AudioSys(this);
    this.voice = new Voice(this);
    this.music = new Music(this);
    this.world = new World(this, this.settings.map);
    this.effects = new Effects(this);
    this.footprints = new Footprints(this, 30);
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.utilities = new Utilities(this);
    this.enemies = new EnemyManager(this);
    this.quests = new QuestManager(this);
    this.hud = new HUD(this);
    this.minimap = new Minimap(this);
    this.momentum = new Momentum(this);
    this.br = new BattleRoyale(this);
    this.thirdPerson = new ThirdPerson(this);
    this.freeRoam = new FreeRoam(this);
    this.crash = new CrashScene(this);

    // Phones and tablets get on-screen controls and skip pointer lock.
    this.touch = new TouchControls(this);
    this.isTouch = TouchControls.isTouchDevice();
    if (this.isTouch) {
      this.touch.enable(true);
      this.touch.setVisible(false);
    }

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.input.setLookFallback(false);
        this.hud.showLockHint(false);
      }
      // Touch devices never hold a pointer lock, so losing one means nothing.
      if (!locked && this.state === State.PLAYING && !this._debugNoLock && !this.isTouch) {
        this.state = State.PAUSED;
        this.hud.showLockHint(false);
        this.hud.showPause(true);
      }
    };

    // Clicking the game view while playing retries a real pointer lock.
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === State.PLAYING && !this._debugNoLock && !this.isTouch && !this.input.locked) {
        this._acquireLook();
      }
    });

    window.addEventListener('resize', () => this._onResize());

    this.applyGraphics();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
  }

  /** Apply graphics-related settings; safe to call live from the menu. */
  applyGraphics() {
    const s = this.settings;
    // Quality tier owns pixel ratio, AO, AA and shadow resolution.
    if (this.photoreal) {
      this.photoreal.build(s.quality || 'high');
      this.photoreal.onWorldBuilt();
    }
    this._onResize();
    if (this.bloom) this.bloom.enabled = s.bloomOn;
    if (this.world && this.world.sun) this.world.sun.castShadow = s.shadows;
    document.getElementById('minimap-wrap').style.display = s.minimap ? '' : 'none';
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.photoreal) this.photoreal.setSize(w, h);
    else if (this.composer) this.composer.setSize(w, h);
  }

  // ------------------------------------------------------------------- economy

  addCredits(c) {
    this.credits += c;
    this.hud.setCredits(this.credits);
  }

  spendCredits(c) {
    if (this.credits < c) return false;
    this.credits -= c;
    this.hud.setCredits(this.credits);
    return true;
  }

  addScore(points) {
    this.score += points;
    this.hud.setScore(this.score);
  }

  // -------------------------------------------------------------- state changes

  /** Begin a fresh campaign run from the menu. */
  async start(useLock = true) {
    this.voice.stop(); // clear any leftover dialogue from a previous run
    // Rebuild the world when the map changes OR when the quality tier now
    // wants a different amount of scenery. The scenery budget is baked in at
    // construction, so without the second check, switching to POTATO would
    // dim the effects while still carrying a full world's worth of geometry —
    // which is the part that was actually costing the frame.
    const wantDetail = this.photoreal?.q?.content ?? 1;
    const rebuild = this.world.mapId !== this.settings.map || this.world.detail !== wantDetail;

    // --- Loading screen ------------------------------------------------------
    // Anything that has to build a world, or bring the city to life, puts the
    // loading screen up FIRST and lets it paint before the heavy work starts.
    // Without this the menu simply froze for the whole build.
    const heavy = rebuild || this.isGTAZ;
    if (heavy) {
      this._loading = true;
      Loading.show(this.settings.mode, this._loadingLine());
      await Loading.frame();
    }
    if (rebuild) {
      // The GTAZ city is by far the largest single build in the game.
      Loading.step(this.isGTAZ ? 'Building the city' : 'Building the world',
        0.06, this.isGTAZ ? 0.55 : 0.8, this.isGTAZ ? 14000 : 2500);
      await Loading.frame();
      this.world.dispose();
      this.world = new World(this, this.settings.map);
      // The new world has a new sun — reapply shadow quality to it.
      if (this.photoreal) this.photoreal.onWorldBuilt();
    }
    this.audio.ensure();
    this.audio.ambientStart();
    this.audio.forestStart();
    this.audio.distantBattleStart();
    if (this.settings.music !== false) this.music.start();
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.credits = 300;
    this.revealUntil = 0;
    this.player.maxArmor = 100; // shop upgrades reset per run
    this.player.reset(this.world.playerSpawn);
    this.weapons.reset();
    this.utilities.reset();
    this.enemies.reset();
    this.quests.reset();
    this.effects.clear();
    this.footprints.clear();
    this.momentum.reset();
    this.hud.showMenu(false);
    this.hud.showDeath(false);
    this.hud.showPause(false);
    this.hud.showShop(false);
    this.hud.showHUD(true);
    this.hud.setScore(0);
    this.hud.setCredits(this.credits);

    // Resuming a saved career restores progress over the fresh state.
    if (this._resume) {
      this._applyResume(this._resume);
      this._resume = null;
    }

    this._debugNoLock = !useLock;

    // GTAZ: bring the city to life BEFORE asking for the click, so the whole
    // wait sits behind the loading screen rather than after it.
    if (this.isGTAZ) {
      // Any drop-in .glb models are fetched before the first car is built, so
      // a downloaded body is in the cache when it's needed. Nothing here can
      // fail the launch — missing files just mean the generated shapes.
      Loading.step('Checking for custom models', 0.56, 0.58, 300);
      await this.freeRoam.preloadModels();
      await this.freeRoam.start(Loading);
    }

    if (heavy) {
      // Ends on a click: that fresh click is what lets the game capture the
      // mouse. The build always takes longer than the few seconds a browser
      // allows after the DEPLOY click, which is why the old flow kept falling
      // back to "click to enable precise aim". Touch screens go straight in.
      await Loading.ready(this.isTouch || !useLock);
      this._loading = false;
      Loading.hide();
    }
    if (useLock) await this._acquireLook();

    // GTAZ: hand the city over to the free-roam manager and get out of the way.
    if (this.isGTAZ) {
      this.state = State.PLAYING;
      this.touch.setVisible(true);
      this.hud.showHUD(true);
      this.thirdPerson.setEnabled(false);
      return;
    }

    // Battle royale runs its own match flow: drop, storm, loot, last standing.
    if (this.isBR) {
      this.state = State.PLAYING;
      this.touch.setVisible(true);
      this.hud.showHUD(true);
      this.br.start();
      // Restore the player's preferred view; body matches the operator.
      this.thirdPerson.refresh();
      this.thirdPerson.setEnabled(!!this.settings.thirdPerson);
      return;
    }
    this.hud.setBRMode(false);
    // First person everywhere outside battle royale.
    this.thirdPerson.setEnabled(false);

    // Career opens with the crash — but only the first time you ever play it.
    // Once you've survived it, every later run starts beside the wreck.
    const playCrash = this.settings.mode === 'career' &&
      !this._skipCrash &&
      !this.settings.crashSeen;
    if (playCrash) {
      this.settings.crashSeen = true;
      this.saveSettings();
      this.state = State.CRASH;
      this.hud.showHUD(false);
      this.crash.start();
      return;
    }

    this.state = State.PLAYING;

    // Cinematic fade up from black.
    const fade = document.getElementById('fade');
    fade.style.transition = 'none';
    fade.style.opacity = '1';
    void fade.offsetWidth;
    fade.style.transition = 'opacity 2.2s ease';
    fade.style.opacity = '0';

    // Opening beats: scripted crash/arrival chatter in career, quick brief in skirmish.
    (this._introTimers || []).forEach(clearTimeout);
    this._introTimers = [setTimeout(() => this.hud.banner(this.world.def.chapter, this.world.def.name), 700)];
    const intro = this.settings.mode === 'career' ? this.world.def.intro : null;
    if (intro) {
      for (const line of intro) {
        this._introTimers.push(setTimeout(() => {
          if (this.state === State.PLAYING) this.hud.comms(line.text, line.who);
        }, line.t * 1000));
      }
    } else {
      this._introTimers.push(setTimeout(() => {
        const giver = this.quests.npcs[0];
        if (giver) this.hud.comms('Over here, operative. Look for the gold markers when you want work.', giver.def.name);
      }, 2000));
    }
  }

  /** Crash cinematic finished — you come to at the wreck, Daniel shouting. */
  _afterCrash() {
    this.player.reset(this.world.playerSpawn);
    const fade = document.getElementById('fade');
    fade.style.transition = 'opacity 2.4s ease';
    fade.style.opacity = '0';
    (this._introTimers || []).forEach(clearTimeout);
    this._introTimers = [
      setTimeout(() => this.hud.banner(this.world.def.chapter, this.world.def.name), 600),
      setTimeout(() => this.hud.comms(
        'On your feet, partner. Whole squad went down with her — just you and me now.', 'DANIEL'
      ), 2600),
      setTimeout(() => this.hud.comms(
        'Survivors are dug in past the treeline. Find the gold markers — they’ll have work for us.', 'DANIEL'
      ), 9000)
    ];
  }

  /** Death is a setback, not a reset: quest progress and gear survive. */
  async respawn() {
    this._skipCrash = true; // you only survive that crash once
    this.credits = Math.floor(this.credits * 0.8);
    this.hud.setCredits(this.credits);
    this.player.reset(this.world.playerSpawn);
    this.enemies.reset();
    this.effects.clear();
    this.hud.showDeath(false);
    this.hud.showHUD(true);
    this.state = State.PLAYING;
    this.touch.setVisible(true);
    if (!this._debugNoLock) await this._acquireLook();
  }

  async resume() {
    this.hud.showPause(false);
    this.state = State.PLAYING;
    this.touch.setVisible(true);
    if (!this._debugNoLock) await this._acquireLook();
  }

  toMenu() {
    if (this.crash && this.crash.active) this.crash.dispose();
    // Clear the per-run override; whether the crash plays is decided by the
    // persisted crashSeen flag, so it stays skipped once you've seen it.
    this._skipCrash = false;
    this.state = State.MENU;
    this.touch.setVisible(false);
    this.voice.stop();
    this.input.unlock();
    this.hud.showPause(false);
    this.hud.showShop(false);
    this.hud.showDeath(false);
    this.hud.showHUD(false);
    this.hud.showMenu(true);
  }

  openShop() {
    this.state = State.SHOP;
    this.touch.setVisible(false);
    this.input.unlock();
    this.hud.showShop(true);
  }

  async closeShop() {
    this.saveCareer(); // bank purchases on the way out
    this.hud.showShop(false);
    this.state = State.PLAYING;
    this.touch.setVisible(true);
    if (!this._debugNoLock) await this._acquireLook();
  }

  /** Try real Pointer Lock; fall back to raw-delta look if it's refused. */
  async _acquireLook() {
    // Touch devices steer with the on-screen look pad — no lock, no hint.
    if (this.isTouch) {
      this.input.setLookFallback(false);
      this.hud.showLockHint(false);
      return true;
    }
    const ok = await this.input.lock(this.renderer.domElement);
    this.input.setLookFallback(!ok);
    this.hud.showLockHint(!ok);
    return ok;
  }

  /**
   * Battle-royale-only inputs: interact, build mode, piece and material
   * selection, harvesting, and consumables.
   */
  _brInput() {
    const input = this.input;
    const br = this.br;
    if (br.drop.active) return;

    if (input.pressed('KeyE')) br.interact();
    if (input.pressed('KeyX')) br.useConsumable();
    // Third-person is a battle-royale convention; T swaps the view.
    if (input.pressed('KeyT')) {
      this.thirdPerson.toggle();
      this.settings.thirdPerson = this.thirdPerson.enabled;
      this.saveSettings();
    }

    // Toggle build mode. In build mode the mouse places/removes instead of
    // firing, so the two never fight over the same button.
    if (input.pressed('KeyB') || input.pressed('KeyV')) {
      br.build.enabled = !br.build.enabled;
      this.hud.setBuildMode(br.build.enabled, br.build);
    }

    if (br.build.enabled) {
      const map = { KeyQ: 'wall', KeyR: 'ramp', KeyF: 'floor', KeyC: 'cone' };
      for (const [key, piece] of Object.entries(map)) {
        if (input.pressed(key)) {
          br.build.selected = piece;
          this.hud.setBuildMode(true, br.build);
        }
      }
      if (input.pressed('Digit1')) { br.build.material = 'wood'; this.hud.setBuildMode(true, br.build); }
      if (input.pressed('Digit2')) { br.build.material = 'stone'; this.hud.setBuildMode(true, br.build); }
      if (input.pressed('Digit3')) { br.build.material = 'metal'; this.hud.setBuildMode(true, br.build); }
      if (input.buttonPressed(0)) br.build.place();
      if (input.buttonPressed(2)) br.build.removeAimed();
    } else if (input.key('KeyH')) {
      // Harvest with the tool while held.
      br.build.harvest();
    }
  }

  /** Pause button on the touch HUD. */
  pauseFromTouch() {
    if (this.state !== State.PLAYING) return;
    this.state = State.PAUSED;
    this.touch.setVisible(false);
    this.hud.showPause(true);
  }

  onPlayerDeath() {
    // In a BR match the placement screen replaces the normal death screen.
    if (this.isBR) {
      this.state = State.DEAD;
      this.touch.setVisible(false);
      this.input.unlock();
      this.voice.stop();
      this.br.onPlayerDeath();
      return;
    }
    this.state = State.DEAD;
    this.touch.setVisible(false);
    this.voice.stop();
    this.audio.death();
    this.input.unlock();
    this.input.setLookFallback(false);
    this.hud.showLockHint(false);
    this.hud.setPrompt(null);
    this.hud.showDeath(true, {
      quests: this.quests.index,
      score: this.score,
      credits: this.credits,
      kills: this.kills,
      headshots: this.headshots,
      map: this.world.def.name,
      diff: this.difficulty.label
    });
  }

  // ----------------------------------------------------------------------- loop

  _loop() {
    // Behind the loading screen nothing needs simulating or drawing, and a
    // half-built city is the last thing that should be stepped.
    if (this._loading) { this.clock.getDelta(); return; }
    let dt = Math.min(this.clock.getDelta(), 1 / 20);

    if (this.state === State.CRASH) {
      // Opening cinematic owns the camera until it hands off.
      this.effects.update(dt);
      this.world.update(dt);
      if (this.crash.update(dt)) {
        this.crash.dispose();
        this.state = State.PLAYING;
        this.hud.showHUD(true);
        this.touch.setVisible(true);
        this._afterCrash();
      }
      this.input.endFrame();
      this.composer.render();
      return;
    }

    if (this.state === State.PLAYING && this.isBR) {
      // Battle royale has its own input map — no shop, B is build mode.
      this.momentum.update(dt);
      this.music.update(dt);
      dt *= this.momentum.timeScale;
      this._brInput();
      // The drop phase drives the camera itself; skip normal movement.
      if (!this.br.drop.active) {
        this.player.update(dt);
        // The camera must be at its final position BEFORE weapons fire —
        // third-person aiming casts from the camera, so a stale transform
        // would send rounds off toward wherever the view used to be.
        this.thirdPerson.update(dt);
        this.weapons.update(dt);
        this.utilities.update(dt);
      }
      this.br.update(dt);
      this.effects.update(dt);
      this.world.update(dt);
      this.hud.tick(dt);
      this.footprints.update();
      if (this.settings.minimap) this.minimap.update();
      this.input.endFrame();
      this.composer.render();
      this._fpsTick(dt);
      return;
    }

    if (this.state === State.PLAYING && this.isGTAZ) {
      // Free roam: no enemy director, no quests, no shop. The city itself is
      // the content, and FreeRoam owns the camera whenever the player drives.
      this.music.update(dt);
      this.freeRoam.update(dt);
      // A carjack owns the camera for its full second and a half. Letting the
      // player update during it re-ran _updateCamera and snapped the view
      // straight back to first person on the very next line — the animation
      // played every time and was never once visible.
      const cinematic = !!this.freeRoam.jack;
      if (!this.freeRoam.driving && !cinematic) {
        this.player.update(dt);
        this.weapons.update(dt);
        this.utilities.update(dt);
      }
      // Hostiles only exist underground. Running the director on the street
      // would fill a civilian city with soldiers; running it in a dungeon is
      // the whole point of going down there.
      if (this.freeRoam.inDungeon) this.enemies.update(dt);
      this.effects.update(dt);
      this.world.update(dt);
      this.hud.tick(dt);
      this.footprints.update();
      if (this.settings.minimap) this.minimap.update();
      this.input.endFrame();
      this.composer.render();
      this._fpsTick(dt);
      return;
    }

    if (this.state === State.PLAYING) {
      // Utility keys before subsystem updates so edges aren't missed.
      if (this.input.pressed('KeyG')) this.utilities.throwFrag();
      if (this.input.pressed('KeyQ')) this.utilities.throwRecon();
      if (this.input.pressed('KeyB')) {
        this.openShop();
      } else {
        // Adrenaline dilates time — the world slows, you don't.
        this.momentum.update(dt);
        this.music.update(dt);
        dt *= this.momentum.timeScale;
        this.player.update(dt);
        this.weapons.update(dt);
        this.utilities.update(dt);
        this.enemies.update(dt);
        this.quests.update(dt);
        this.effects.update(dt);
        this.footprints.update();
        this.world.update(dt);
        this.hud.tick(dt);
        if (this.settings.minimap) this.minimap.update();
      }
    } else if (this.state === State.SHOP) {
      if (this.input.pressed('KeyB') || this.input.pressed('Escape')) this.closeShop();
      this.effects.update(dt);
      this.world.update(dt);
    } else if (this.state === State.MENU) {
      // Slow cinematic orbit over the arena while in the menu.
      this._menuAngle += dt * 0.06;
      const r = 52;
      this.camera.position.set(Math.sin(this._menuAngle) * r, 18, Math.cos(this._menuAngle) * r);
      this.camera.lookAt(0, 4, 0);
      this.effects.update(dt);
      this.world.update(dt);
    }

    this.input.endFrame();
    this.photoreal.update(dt);
    this.composer.render();
    this._fpsTick(dt);
  }

  /** Rolling FPS meter, updated twice a second. */
  _fpsTick(dt) {
    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.hud.setFPS(Math.round(this._fpsFrames / this._fpsTime));
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }
  }
}
