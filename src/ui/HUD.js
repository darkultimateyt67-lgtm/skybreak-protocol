import * as THREE from 'three';
import { MAPS, ARENA_MAPS } from '../world/maps.js';
import { DIFFICULTIES } from '../ai/EnemyManager.js';
import { OPERATORS } from '../player/Player.js';
import { WEAPON_DEFS, buildViewmodel } from '../weapons/WeaponSystem.js';
import { RULESETS, MAX_MULT } from '../city/Ruleset.js';
import { ARSENAL } from '../weapons/Arsenal.js';

/**
 * Render a portrait of one operator to a data URL: a small armored figure in
 * the operator's colors, posed on a transparent background. One throwaway
 * renderer serves all portraits, then frees its GL context.
 */
function renderPortraits(ops) {
  const W = 150, H = 190;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 20);
  camera.position.set(0.85, 1.45, 2.6);
  camera.lookAt(0, 0.95, 0);
  const urls = {};

  for (const op of ops) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbdd8ee, 0x222833, 2.2));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.5);
    key.position.set(2, 3, 2);
    scene.add(key);
    const rim = new THREE.PointLight(op.accent, 30, 8);
    rim.position.set(-1.4, 1.6, -1);
    scene.add(rim);

    const suit = new THREE.MeshStandardMaterial({ color: op.color, roughness: 0.6, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.7, metalness: 0.5 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: op.accent, emissiveIntensity: 2.5 });
    const add = (geo, mat, x, y, z, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      scene.add(m);
      return m;
    };

    // Armored figure: legs, chest rig, arms, helmet with glowing visor.
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.16, 0.42, 0.2), dark, 0.12 * side, 0.5, 0);
      add(new THREE.BoxGeometry(0.14, 0.34, 0.17), suit, 0.12 * side, 0.16, 0.01);
      add(new THREE.BoxGeometry(0.16, 0.08, 0.26), dark, 0.12 * side, 0.0, 0.03);
      add(new THREE.BoxGeometry(0.13, 0.5, 0.15), suit, 0.34 * side, 0.98, 0, -0.12 * side);
      add(new THREE.BoxGeometry(0.15, 0.14, 0.22), dark, 0.33 * side, 1.28, 0, -0.25 * side);
    }
    add(new THREE.BoxGeometry(0.5, 0.62, 0.3), suit, 0, 1.02, 0);
    add(new THREE.BoxGeometry(0.42, 0.44, 0.34), dark, 0, 1.06, 0);
    add(new THREE.BoxGeometry(0.1, 0.14, 0.06), glowMat, 0, 1.12, 0.19); // core
    add(new THREE.BoxGeometry(0.44, 0.1, 0.28), suit, 0, 0.74, 0);       // belt
    add(new THREE.SphereGeometry(0.2, 16, 12), suit, 0, 1.56, 0);        // helmet
    add(new THREE.BoxGeometry(0.28, 0.07, 0.1), glowMat, 0, 1.57, 0.15); // visor

    renderer.render(scene, camera);
    urls[op.id] = renderer.domElement.toDataURL('image/png');
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  renderer.dispose();
  return urls;
}

const CROSSHAIR_COLORS = ['#37e6ff', '#7dffb8', '#ff3b4d', '#ffffff', '#ffd24a', '#ff8ad8'];

/**
 * HUD — binds the DOM overlay (crosshair, bars, ammo, quest tracker, shop,
 * banners, menus) to game state. Values are polled with change detection so
 * DOM writes only happen when something actually changed.
 */
export class HUD {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);

    this.el = {
      hud: $('hud'),
      menu: $('menu'),
      death: $('death'),
      pause: $('pause'),
      shop: $('shop'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      vignette: $('damage-vignette'),
      credits: $('hud-credits'),
      enemies: $('hud-enemies'),
      score: $('hud-score'),
      barHealth: $('bar-health'),
      barArmor: $('bar-armor'),
      barEnergy: $('bar-energy'),
      txtHealth: $('txt-health'),
      txtArmor: $('txt-armor'),
      txtEnergy: $('txt-energy'),
      weapon: $('hud-weapon'),
      ammo: $('hud-ammo'),
      ammoMag: $('ammo-mag'),
      ammoReserve: $('ammo-reserve'),
      slots: $('hud-slots'),
      utilFrag: $('util-frag'),
      utilRecon: $('util-recon'),
      killfeed: $('killfeed'),
      banner: $('wave-banner'),
      bannerMain: $('banner-main'),
      bannerSub: $('banner-sub'),
      fps: $('hud-fps'),
      deathStats: $('death-stats'),
      lockHint: $('lock-hint'),
      comms: $('comms'),
      prompt: $('prompt'),
      questPanel: $('quest-panel'),
      questTitle: $('quest-title'),
      questText: $('quest-text'),
      shopCredits: $('shop-credits').querySelector('b'),
      shopWeapons: $('shop-weapons'),
      shopItems: $('shop-items')
    };

    this._last = { h: -1, a: -1, e: -1 };
    this._bannerTimer = null;
    this._vignetteTimer = null;
    this._commsTimer = null;
    this._lastPrompt = null;

    this._wireMenu();
    this._wireChips();
    this._wireModes();
    this._wireCareer();
    this._wireCrosshair();
    this._buildShop();
    this.applyCrosshair();
    this.refreshContinue();
  }

  /** Skirmish (preset operators) vs Career (build your own + story intros). */
  _wireModes() {
    const game = this.game;
    const container = document.getElementById('mode-chips');
    const blurb = document.getElementById('mode-blurb');
    const modes = [
      { id: 'career', label: 'CAREER', desc: 'The story of the VANTAGE-6 crash. Build your own operative.' },
      { id: 'skirmish', label: 'SKIRMISH', desc: 'Straight combat. Pick a preset operator and deploy.' },
      { id: 'battleground', label: 'BATTLEGROUND', desc: '50 fighters, one 2400-metre island, a shrinking storm. Drop in, loot up, build, and be the last one standing.' },
      { id: 'gtaz', label: 'GTAZ', desc: 'An open city of eight districts, with five built halls under it. Take any car, drive anywhere, take a contract underground, and try not to attract the law.' }
    ];
    const chips = new Map();
    // Modes that own their own map and hide the map picker entirely.
    const FIXED_MAP = { battleground: 'battleground', gtaz: 'gtaz' };
    const applyMode = (id) => {
      document.getElementById('skirmish-panel').classList.toggle('hidden', id !== 'skirmish');
      document.getElementById('career-panel').classList.toggle('hidden', id !== 'career');
      blurb.textContent = modes.find((m) => m.id === id).desc;
      // BATTLEGROUND and GTAZ each lock to their own map; the rest use the
      // campaign deck.
      if (FIXED_MAP[id]) {
        game.settings.map = FIXED_MAP[id];
      } else if (FIXED_MAP[game.settings.map]) {
        game.settings.map = 'verdant';
      }
      game.saveSettings();
      // Hide ONLY the arena picker. This used to reach for
      // map-chips.parentElement, which is #mission-block — the container
      // holding the mode chips, the operator cards and the armory. Selecting
      // BATTLEGROUND or GTAZ therefore erased the entire menu down to the
      // DEPLOY button, with no way left to change mode.
      const mapBlock = document.getElementById('map-block');
      if (mapBlock) mapBlock.style.display = FIXED_MAP[id] ? 'none' : '';
      // The ruleset dials belong to GTAZ alone. Every other mode is a balanced
      // experience and a speed dial would wreck it, so there is nothing to
      // show and nothing to switch off.
      const rulesBlock = document.getElementById('rules-block');
      if (rulesBlock) rulesBlock.style.display = id === 'gtaz' ? '' : 'none';
      // CONTINUE is career-only, so the primary buttons have to be rebuilt on
      // every mode change — not just at menu open.
      this.refreshContinue();
    };
    for (const m of modes) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = m.label;
      chip.addEventListener('click', () => {
        game.settings.mode = m.id;
        game.saveSettings();
        for (const [id, el] of chips) el.classList.toggle('on', id === m.id);
        applyMode(m.id);
      });
      container.appendChild(chip);
      chips.set(m.id, chip);
    }
    this._wireRules();
    // Restore whichever mode was last played, not just career/skirmish.
    const cur = chips.has(game.settings.mode) ? game.settings.mode : 'career';
    chips.get(cur).classList.add('on');
    applyMode(cur);
  }

  /**
   * GTAZ's FUN / REAL picker and its two dials.
   *
   * The dials are hidden outright in REAL rather than disabled: a greyed-out
   * slider still reads as "something I could change here", and the whole point
   * of REAL is that there is nothing to change. Values are written straight to
   * settings and saved on release, and Game.rules reads them live, so a change
   * takes effect on the next frame without a world rebuild.
   */
  _wireRules() {
    const game = this.game;
    const $ = (id) => document.getElementById(id);
    const chipBox = $('rules-chips');
    const blurb = $('rules-blurb');
    const dials = $('rules-dials');
    const note = $('dial-note');
    if (!chipBox || chipBox.dataset.wired) return;
    chipBox.dataset.wired = '1';

    const speed = $('dial-speed');
    const health = $('dial-health');
    const speedVal = $('dial-speed-val');
    const healthVal = $('dial-health-val');

    const chipMap = new Map();
    const paint = () => {
      const fun = game.settings.gtazRules === 'fun';
      for (const [id, el] of chipMap) el.classList.toggle('on', id === game.settings.gtazRules);
      const def = RULESETS.find((r) => r.id === game.settings.gtazRules) || RULESETS[0];
      if (blurb) blurb.textContent = def.blurb;
      if (dials) dials.classList.toggle('off', !fun);
      const s = Number(game.settings.funSpeed) || 1;
      const h = Number(game.settings.funHealth) || 1;
      if (speedVal) speedVal.innerHTML = s.toFixed(1) + '&times;';
      if (healthVal) healthVal.innerHTML = h.toFixed(1) + '&times;';
      if (note) {
        // Say what the dials actually mean in the units you see in game,
        // rather than leaving "7x" to be guessed at.
        note.textContent = fun
          ? `Sprint ${Math.round(8.4 * s * 3.6)} km/h · ${Math.round(100 * h)} hull · cars ${s.toFixed(1)}x · `
            + (game.settings.funPolice ? 'police ON' : 'no police')
          : '';
      }
    };

    for (const r of RULESETS) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = r.name;
      chip.addEventListener('click', () => {
        game.settings.gtazRules = r.id;
        game.saveSettings();
        paint();
      });
      chipBox.appendChild(chip);
      chipMap.set(r.id, chip);
    }

    const bind = (el, key) => {
      if (!el) return;
      el.value = String(game.settings[key] ?? MAX_MULT);
      el.addEventListener('input', () => {
        game.settings[key] = Number(el.value);
        paint();
      });
      el.addEventListener('change', () => game.saveSettings());
    };
    bind(speed, 'funSpeed');
    bind(health, 'funHealth');

    // Police toggle, FUN only.
    const policeBox = $('police-chips');
    if (policeBox) {
      const opts = [['OFF', false], ['ON', true]];
      const els = [];
      const paintPolice = () => {
        for (const [el, v] of els) el.classList.toggle('on', !!game.settings.funPolice === v);
      };
      for (const [label, v] of opts) {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = label;
        chip.addEventListener('click', () => {
          game.settings.funPolice = v;
          game.saveSettings();
          paintPolice();
          paint();
        });
        policeBox.appendChild(chip);
        els.push([chip, v]);
      }
      paintPolice();
    }
    paint();
  }

  /** Career editor: callsign, skin, hair, colors, primary — live portrait. */
  _wireCareer() {
    const game = this.game;
    const c = game.settings.career;
    const $ = (id) => document.getElementById(id);
    const save = () => { game.saveSettings(); this._renderCareerPortrait(); };

    const name = $('career-name');
    name.value = c.name || 'VECTOR';
    name.addEventListener('input', () => { c.name = name.value.trim() || 'VECTOR'; game.saveSettings(); });

    const swatchRow = (elId, colors, key) => {
      const row = $(elId);
      const els = [];
      for (const color of colors) {
        const sw = document.createElement('div');
        sw.className = 'swatch' + (c[key] === color ? ' on' : '');
        sw.style.background = color;
        sw.addEventListener('click', () => {
          c[key] = color;
          els.forEach((e) => e.classList.toggle('on', e === sw));
          save();
        });
        row.appendChild(sw);
        els.push(sw);
      }
      if (!colors.includes(c[key])) { c[key] = colors[0]; els[0].classList.add('on'); }
    };
    swatchRow('career-skins', ['#d9a077', '#b5825e', '#8c5f42', '#e8b98f', '#6e4a32'], 'skin');
    swatchRow('career-haircolors', ['#241a12', '#0e0c0a', '#4a3826', '#6b6560', '#8a7a5a'], 'hairColor');
    swatchRow('career-colors', ['#2d4a56', '#5c3a22', '#2f4a30', '#3a3a4a', '#4a3226', '#54452e'], 'color');
    swatchRow('career-accents', ['#37e6ff', '#ff9b3d', '#7dffb8', '#b08cff', '#ff3b4d', '#ffd24a'], 'accent');

    const chipRow = (elId, items, key) => {
      const row = $(elId);
      const els = new Map();
      for (const it of items) {
        const chip = document.createElement('button');
        chip.className = 'chip' + (c[key] === it.id ? ' on' : '');
        chip.textContent = it.label;
        chip.addEventListener('click', () => {
          c[key] = it.id;
          for (const [id, el] of els) el.classList.toggle('on', id === it.id);
          save();
        });
        row.appendChild(chip);
        els.set(it.id, chip);
      }
      if (![...els.keys()].includes(c[key])) { c[key] = items[0].id; els.get(c[key]).classList.add('on'); }
    };
    chipRow('career-hair', [
      { id: 'short', label: 'SHORT' }, { id: 'crop', label: 'CROP' },
      { id: 'tied', label: 'TIED' }, { id: 'buzz', label: 'BUZZ' }
    ], 'hair');
    chipRow('career-primary', [
      { id: 'riptide', label: 'RIFLE' }, { id: 'kestrel', label: 'SMG' }, { id: 'mauler', label: 'SHOTGUN' }
    ], 'primary');

    this._renderCareerPortrait();
  }

  /** Render the customized human operative to the career preview image. */
  _renderCareerPortrait() {
    const c = this.game.settings.career;
    try {
      const W = 170, H = 230;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(W, H);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 20);
      camera.position.set(0.8, 1.4, 2.7);
      camera.lookAt(0, 0.92, 0);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xcfdbe8, 0x2a2e33, 2.4));
      const key = new THREE.DirectionalLight(0xfff0dd, 2.6);
      key.position.set(2, 3, 2);
      scene.add(key);
      const rim = new THREE.PointLight(new THREE.Color(c.accent), 26, 8);
      rim.position.set(-1.4, 1.7, -1);
      scene.add(rim);

      const hex = (s) => parseInt(s.slice(1), 16);
      const skin = new THREE.MeshStandardMaterial({ color: hex(c.skin || '#d9a077'), roughness: 0.85 });
      const hair = new THREE.MeshStandardMaterial({ color: hex(c.hairColor || '#241a12'), roughness: 0.95 });
      const jacket = new THREE.MeshStandardMaterial({ color: hex(c.color || '#2d4a56'), roughness: 0.75 });
      const gear = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.8 });
      const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
      const boots = new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.95 });
      const glow = new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: new THREE.Color(c.accent), emissiveIntensity: 2 });
      const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        scene.add(m);
        return m;
      };
      for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(0.17, 0.4, 0.2), pants, 0.13 * s, 0.5, 0);
        add(new THREE.BoxGeometry(0.14, 0.34, 0.17), pants, 0.13 * s, 0.16, 0.01);
        add(new THREE.BoxGeometry(0.16, 0.1, 0.28), boots, 0.13 * s, 0.0, 0.04);
        add(new THREE.BoxGeometry(0.13, 0.3, 0.15), jacket, 0.31 * s, 0.98, 0);
        add(new THREE.BoxGeometry(0.1, 0.28, 0.12), skin, 0.31 * s, 0.68, 0.03);
      }
      add(new THREE.BoxGeometry(0.46, 0.58, 0.27), jacket, 0, 1.08, 0);
      add(new THREE.BoxGeometry(0.4, 0.4, 0.32), gear, 0, 1.12, 0);
      add(new THREE.BoxGeometry(0.06, 0.06, 0.05), glow, 0, 1.24, 0.18);
      add(new THREE.BoxGeometry(0.42, 0.09, 0.26), gear, 0, 0.76, 0);
      const headG = new THREE.Group();
      headG.position.y = 1.58;
      scene.add(headG);
      const addH = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); headG.add(m); return m; };
      addH(new THREE.SphereGeometry(0.175, 14, 12), skin, 0, 0, 0);
      addH(new THREE.BoxGeometry(0.035, 0.018, 0.02), gear, -0.06, 0.02, 0.16);
      addH(new THREE.BoxGeometry(0.035, 0.018, 0.02), gear, 0.06, 0.02, 0.16);
      addH(new THREE.BoxGeometry(0.03, 0.05, 0.04), skin, 0, -0.02, 0.175);
      const style = c.hair || 'short';
      if (style === 'short') addH(new THREE.BoxGeometry(0.3, 0.1, 0.3), hair, 0, 0.14, -0.02);
      else if (style === 'crop') addH(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.03, -0.01);
      else if (style === 'tied') {
        addH(new THREE.BoxGeometry(0.28, 0.08, 0.28), hair, 0, 0.14, -0.03);
        addH(new THREE.BoxGeometry(0.1, 0.14, 0.1), hair, 0, 0.02, -0.18);
      } else addH(new THREE.BoxGeometry(0.24, 0.05, 0.26), hair, 0, 0.15, -0.04);
      headG.rotation.y = 0.25;

      renderer.render(scene, camera);
      document.getElementById('career-portrait').src = renderer.domElement.toDataURL('image/png');
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      renderer.dispose();
    } catch { /* preview is optional */ }
  }

  // ----------------------------------------------------------------- menus

  _wireMenu() {
    const game = this.game;
    const $ = (id) => document.getElementById(id);

    $('btn-start').addEventListener('click', () => game.start());
    $('btn-staff').addEventListener('click', () => game.staffPanel.show());
    $('btn-continue').addEventListener('click', () => game.continueCareer());
    $('btn-br-again').addEventListener('click', () => {
      document.getElementById('br-result').classList.add('hidden');
      game.start();
    });
    $('btn-br-menu').addEventListener('click', () => {
      document.getElementById('br-result').classList.add('hidden');
      game.toMenu();
    });
    $('btn-replay-intro').addEventListener('click', (e) => {
      game.settings.crashSeenMaps = [];
      game.saveSettings();
      e.target.textContent = 'INTRO WILL REPLAY ON NEXT RUN';
      setTimeout(() => { e.target.textContent = 'REPLAY CRASH INTRO'; }, 2600);
    });
    $('btn-newrun').addEventListener('click', () => {
      game.clearCareer();
      this.refreshContinue();
    });
    $('btn-restart').addEventListener('click', () => game.respawn());
    $('btn-resume').addEventListener('click', () => game.resume());
    $('btn-tomenu').addEventListener('click', () => game.toMenu());
    $('btn-shop-close').addEventListener('click', () => game.closeShop());

    const bindSlider = (inputId, labelId, key, fmt, apply) => {
      const input = $(inputId);
      const label = $(labelId);
      input.value = key === 'volume' ? game.settings[key] * 100 : game.settings[key];
      label.textContent = fmt(input.value);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        game.settings[key] = key === 'volume' ? v / 100 : v;
        label.textContent = fmt(input.value);
        game.saveSettings();
        if (apply) apply(game.settings[key]);
      });
    };
    bindSlider('set-sens', 'val-sens', 'sensitivity', (v) => Number(v).toFixed(2));
    bindSlider('set-adssens', 'val-adssens', 'adsSens', (v) => Number(v).toFixed(2));
    bindSlider('set-fov', 'val-fov', 'fov', (v) => String(Math.round(v)));
    bindSlider('set-vol', 'val-vol', 'volume', (v) => String(Math.round(v)), (v) => game.audio.setVolume(v));
    bindSlider('set-rscale', 'val-rscale', 'renderScale', (v) => Number(v).toFixed(2), () => game.applyGraphics());

    const bindCheck = (inputId, key, apply) => {
      const input = $(inputId);
      input.checked = !!game.settings[key];
      input.addEventListener('change', () => {
        game.settings[key] = input.checked;
        game.saveSettings();
        if (apply) apply(input.checked);
      });
    };
    bindCheck('set-bob', 'bob');
    bindCheck('set-shake', 'shake');
    bindCheck('set-inverty', 'invertY');
    bindCheck('set-shadows', 'shadows', () => game.applyGraphics());
    bindCheck('set-bloom', 'bloomOn', () => game.applyGraphics());
    bindCheck('set-minimap', 'minimap', () => game.applyGraphics());
    // Render quality tier — drives AO, anti-aliasing, shadows and resolution.
    const qRow = $('quality-chips');
    const qChips = new Map();
    // POTATO is for machines that can't hold a frame rate at LOW. It drops
    // shadows and post-processing entirely and builds about an eighth of the
    // world's scenery. Changing tier rebuilds the world, because the scenery
    // budget is decided at build time — hence the warning on the chip.
    for (const id of ['potato', 'low', 'medium', 'high', 'ultra']) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = id.toUpperCase();
      if (id === 'potato') chip.title = 'Fastest. Minimal scenery, no shadows.';
      chip.addEventListener('click', () => {
        game.settings.quality = id;
        game.saveSettings();
        for (const [k, el] of qChips) el.classList.toggle('on', k === id);
        game.applyGraphics();
      });
      qRow.appendChild(chip);
      qChips.set(id, chip);
    }
    (qChips.get(game.settings.quality) || qChips.get('high')).classList.add('on');
    // Adaptive quality changes the tier at runtime; keep the chips honest.
    this.syncQualityChips = (tier) => {
      for (const [k, el] of qChips) el.classList.toggle('on', k === tier);
    };

    bindCheck('set-music', 'music', (v) => { if (v) game.music.start(); else game.music.stop(); });
    bindCheck('set-voice', 'voice', (v) => { if (!v) game.voice.stop(); });
    bindCheck('set-subs', 'subtitles');
    bindCheck('set-fps', 'showFps', (v) => { this.el.fps.style.display = v ? '' : 'none'; });
    this.el.fps.style.display = game.settings.showFps ? '' : 'none';
  }

  /** Mission / threat / operator chip rows, persisted like other settings. */
  _wireChips() {
    const game = this.game;
    const $ = (id) => document.getElementById(id);

    const buildChips = (container, items, settingKey, onSelect) => {
      const chips = new Map();
      for (const item of items) {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = item.label;
        chip.addEventListener('click', () => {
          game.settings[settingKey] = item.id;
          game.saveSettings();
          for (const [id, el] of chips) el.classList.toggle('on', id === item.id);
          onSelect(item);
        });
        container.appendChild(chip);
        chips.set(item.id, chip);
      }
      const current = items.find((i) => i.id === game.settings[settingKey]) || items[0];
      chips.get(current.id).classList.add('on');
      onSelect(current);
    };

    buildChips(
      $('map-chips'),
      ARENA_MAPS.map((m) => ({ id: m.id, label: m.name, chapter: m.chapter, blurb: m.blurb })),
      'map',
      (m) => { $('map-blurb').innerHTML = `<b>${m.chapter}</b> &nbsp;·&nbsp; ${m.blurb}`; }
    );
    buildChips(
      $('diff-chips'),
      Object.values(DIFFICULTIES).map((d) => ({ id: d.id, label: d.label, desc: d.desc })),
      'diff',
      (d) => { $('diff-blurb').textContent = d.desc; }
    );
    this._buildOperatorCards();
    this._buildArmory();
  }

  /**
   * Armory: browse all 123 weapons, filter by class, see the special feature
   * and stat profile, and equip one as your Skirmish primary.
   */
  _buildArmory() {
    const game = this.game;
    const $ = (id) => document.getElementById(id);
    const grid = $('armory-grid');
    const filters = $('armory-filters');
    $('armory-count').textContent = `· ${ARSENAL.length} WEAPONS`;

    const families = ['ALL', ...new Set(ARSENAL.map((w) => w.familyLabel))];
    let activeFilter = 'ALL';
    let selected = ARSENAL.find((w) => w.id === game.settings.skirmishGun) || ARSENAL[0];

    const statBar = (label, v, max) =>
      `<div class="astat"><span>${label}</span><i><b style="width:${Math.min(100, (v / max) * 100)}%"></b></i></div>`;

    const showDetail = (w) => {
      selected = w;
      $('armory-name').textContent = w.name;
      $('armory-class').textContent = `${w.frameLabel.toUpperCase()} ${w.familyLabel}`;
      const t = $('armory-trait');
      t.textContent = w.trait.label.toUpperCase();
      t.style.color = '#' + w.trait.color.toString(16).padStart(6, '0');
      $('armory-traitdesc').textContent = w.trait.desc;
      $('armory-stats').innerHTML =
        statBar('DAMAGE', w.damage, 130) +
        statBar('RATE', w.rpm, 1000) +
        statBar('MAG', w.mag, 80) +
        statBar('CONTROL', 4 - Math.min(3.9, w.recoil), 4) +
        statBar('RANGE', w.falloff[1], 220);
      $('armory-shot').src = this._gunPortrait(w);
      for (const el of grid.children) el.classList.toggle('on', el.dataset.id === w.id);
    };

    const render = () => {
      grid.innerHTML = '';
      const list = activeFilter === 'ALL'
        ? ARSENAL
        : ARSENAL.filter((w) => w.familyLabel === activeFilter);
      for (const w of list) {
        const el = document.createElement('div');
        el.className = 'gun' + (w.id === selected.id ? ' on' : '');
        el.dataset.id = w.id;
        el.style.borderLeftColor = '#' + w.trait.color.toString(16).padStart(6, '0');
        el.innerHTML = `<b>${w.name}</b><span>${w.frameLabel} · ${w.trait.label}</span>`;
        el.addEventListener('click', () => showDetail(w));
        grid.appendChild(el);
      }
    };

    for (const f of families) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (f === 'ALL' ? ' on' : '');
      chip.textContent = f;
      chip.addEventListener('click', () => {
        activeFilter = f;
        for (const c of filters.children) c.classList.toggle('on', c === chip);
        render();
      });
      filters.appendChild(chip);
    }

    $('btn-equip').addEventListener('click', (e) => {
      game.settings.skirmishGun = selected.id;
      game.saveSettings();
      e.target.textContent = `EQUIPPED — ${selected.name}`;
      setTimeout(() => { e.target.textContent = 'EQUIP AS PRIMARY'; }, 2200);
    });

    render();
    showDetail(selected);
  }

  /** Render a small 3D portrait of a weapon for the armory panel. */
  _gunPortrait(def) {
    this._portraitCache = this._portraitCache || new Map();
    if (this._portraitCache.has(def.id)) return this._portraitCache.get(def.id);
    let url = '';
    try {
      const W = 220, H = 92;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(W, H);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x2a2e33, 2.6));
      const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
      key.position.set(2, 3, 2);
      scene.add(key);
      const rim = new THREE.PointLight(def.accent, 22, 6);
      rim.position.set(-1.6, 0.8, -1.2);
      scene.add(rim);

      const model = buildViewmodel(def).group;
      // Hide the hands — this is a catalogue shot of the weapon itself.
      model.traverse((o) => {
        if (o.isMesh && o.material && o.material.color &&
            (o.material === undefined)) o.visible = false;
      });
      model.rotation.set(0.12, -0.72, 0.04);
      scene.add(model);

      const camera = new THREE.PerspectiveCamera(34, W / H, 0.05, 20);
      camera.position.set(0.1, 0.16, 1.05);
      camera.lookAt(0, -0.02, -0.2);
      renderer.render(scene, camera);
      url = renderer.domElement.toDataURL('image/png');
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      renderer.dispose();
    } catch { /* portrait is optional */ }
    this._portraitCache.set(def.id, url);
    return url;
  }

  /** Character select: portrait cards with stats and starting loadout. */
  _buildOperatorCards() {
    const game = this.game;
    const container = document.getElementById('op-cards');
    const ops = Object.values(OPERATORS);
    let portraits = {};
    try {
      portraits = renderPortraits(ops);
    } catch { /* WebGL hiccup: cards render without portraits */ }

    const cards = new Map();
    for (const op of ops) {
      const card = document.createElement('div');
      card.className = 'op-card';
      const statBar = (label, val, max) =>
        `<div class="op-stat"><span>${label}</span><div class="op-track"><div style="width:${Math.round((val / max) * 100)}%"></div></div></div>`;
      card.innerHTML =
        (portraits[op.id] ? `<img class="op-portrait" src="${portraits[op.id]}" alt="${op.label}" />` : '') +
        `<div class="op-name" style="color:#${op.accent.toString(16).padStart(6, '0')}">${op.label}</div>` +
        `<div class="op-desc">${op.desc}</div>` +
        statBar('HULL', op.health, 120) +
        statBar('PLATE', op.armor, 85) +
        statBar('SPEED', op.speed * 100, 108) +
        `<div class="op-loadout">${op.weaponNote}</div>`;
      card.addEventListener('click', () => {
        game.settings.operator = op.id;
        game.saveSettings();
        for (const [id, el] of cards) el.classList.toggle('on', id === op.id);
      });
      container.appendChild(card);
      cards.set(op.id, card);
    }
    const current = OPERATORS[game.settings.operator] ? game.settings.operator : 'vector';
    cards.get(current).classList.add('on');
  }

  _wireCrosshair() {
    const game = this.game;
    const $ = (id) => document.getElementById(id);
    const ch = game.settings.crosshair;

    const swatches = $('ch-swatches');
    const els = [];
    for (const color of CROSSHAIR_COLORS) {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (ch.color === color ? ' on' : '');
      sw.style.background = color;
      sw.addEventListener('click', () => {
        ch.color = color;
        els.forEach((e) => e.classList.toggle('on', e === sw));
        game.saveSettings();
        this.applyCrosshair();
      });
      swatches.appendChild(sw);
      els.push(sw);
    }

    const size = $('set-chsize'), sizeVal = $('val-chsize');
    size.value = ch.size;
    sizeVal.textContent = ch.size;
    size.addEventListener('input', () => {
      ch.size = parseInt(size.value, 10);
      sizeVal.textContent = size.value;
      game.saveSettings();
      this.applyCrosshair();
    });

    const gap = $('set-chgap'), gapVal = $('val-chgap');
    gap.value = ch.gap;
    gapVal.textContent = ch.gap;
    gap.addEventListener('input', () => {
      ch.gap = parseInt(gap.value, 10);
      gapVal.textContent = gap.value;
      game.saveSettings();
      this.applyCrosshair();
    });

    const dot = $('set-chdot');
    dot.checked = ch.dot;
    dot.addEventListener('change', () => {
      ch.dot = dot.checked;
      game.saveSettings();
      this.applyCrosshair();
    });
  }

  /** Push crosshair settings into CSS. */
  applyCrosshair() {
    const ch = this.game.settings.crosshair;
    const el = this.el.crosshair;
    el.style.setProperty('--ch-color', ch.color);
    el.style.setProperty('--ch-len', `${ch.size}px`);
    el.querySelector('.ch-dot').style.display = ch.dot ? '' : 'none';
  }

  // ------------------------------------------------------------------ shop

  _buildShop() {
    const game = this.game;

    // Weapons.
    this._shopWeaponEls = new Map();
    for (const def of WEAPON_DEFS.filter((d) => d.price > 0)) {
      const item = document.createElement('div');
      item.className = 'shop-item';
      item.innerHTML =
        `<div class="si-name">${def.name}</div>` +
        `<div class="si-desc">${def.desc}</div>`;
      const btn = document.createElement('button');
      btn.textContent = `BUY — ${def.price} CR`;
      btn.addEventListener('click', () => {
        if (game.weapons.buy(def.id)) this.refreshShop();
      });
      item.appendChild(btn);
      this.el.shopWeapons.appendChild(item);
      this._shopWeaponEls.set(def.id, { item, btn, def });
    }

    // Equipment & support.
    const items = [
      {
        name: 'FRAG CHARGE', desc: 'One throwable frag (max 4). 130 damage, 7 m.', price: 100,
        buy: () => game.utilities.addFrag()
      },
      {
        name: 'RECON PULSE', desc: 'One recon charge (max 3). Damages and pings all SENTINELs for 8 s.', price: 150,
        buy: () => game.utilities.addRecon()
      },
      {
        name: 'NANOMED', desc: 'Full hull repair, right now.', price: 150,
        buy: () => {
          if (game.player.health >= game.player.maxHealth) return false;
          game.player.health = game.player.maxHealth;
          return true;
        }
      },
      {
        name: 'PLATE KIT', desc: 'Armor plates restored to maximum.', price: 200,
        buy: () => {
          if (game.player.armor >= game.player.maxArmor) return false;
          game.player.armor = game.player.maxArmor;
          return true;
        }
      },
      {
        name: 'AMMO CACHE', desc: 'Refill reserves on every owned weapon.', price: 200,
        buy: () => { game.weapons.refillReserve(1); return true; }
      },
      {
        name: 'PLATE UPGRADE', desc: '+25 maximum armor (up to 150).', price: 500,
        buy: () => {
          if (game.player.maxArmor >= 150) return false;
          game.player.maxArmor += 25;
          game.player.armor = Math.min(game.player.armor + 25, game.player.maxArmor);
          return true;
        }
      }
    ];
    this._shopItemEls = [];
    for (const it of items) {
      const item = document.createElement('div');
      item.className = 'shop-item';
      item.innerHTML =
        `<div class="si-name">${it.name}</div>` +
        `<div class="si-desc">${it.desc}</div>`;
      const btn = document.createElement('button');
      btn.textContent = `BUY — ${it.price} CR`;
      btn.addEventListener('click', () => {
        if (game.credits < it.price) return;
        if (it.buy()) {
          game.spendCredits(it.price);
          game.audio.purchase();
        }
        this.refreshShop();
      });
      item.appendChild(btn);
      this.el.shopItems.appendChild(item);
      this._shopItemEls.push({ btn, it });
    }
  }

  refreshShop() {
    const game = this.game;
    this.el.shopCredits.textContent = String(game.credits);
    for (const [id, { item, btn, def }] of this._shopWeaponEls) {
      const owned = game.weapons.weapons.find((w) => w.def.id === id).owned;
      item.classList.toggle('owned', owned);
      btn.disabled = owned || game.credits < def.price;
      btn.textContent = owned ? 'OWNED' : `BUY — ${def.price} CR`;
    }
    for (const { btn, it } of this._shopItemEls) {
      btn.disabled = game.credits < it.price;
    }
  }

  // ------------------------------------------------------------- visibility

  showMenu(v = true) {
    this.el.menu.classList.toggle('hidden', !v);
    if (v) this.refreshContinue();
  }

  /**
   * Show CONTINUE only when there's a career worth resuming AND career is the
   * selected mode.
   *
   * The mode check is not cosmetic. continueCareer() force-sets settings.mode
   * to 'career', so leaving this button on screen in another mode gives the
   * player a prominent button that silently discards the mode they just
   * picked — select GTAZ, press CONTINUE, land in the campaign. It has to
   * disappear whenever it wouldn't do what the screen implies.
   */
  refreshContinue() {
    const s = this.game.careerSummary();
    const cont = document.getElementById('btn-continue');
    const fresh = document.getElementById('btn-newrun');
    const start = document.getElementById('btn-start');
    const inCareer = this.game.settings.mode === 'career';
    const has = !!s && s.questIndex > 0 && inCareer;
    cont.classList.toggle('hidden', !has);
    fresh.classList.toggle('hidden', !has);
    if (has) {
      document.getElementById('continue-sub').textContent =
        `  ·  ${s.questIndex}/${s.total || '?'} JOBS DONE  ·  ${s.credits} CR`;
      start.textContent = 'NEW RUN';
    } else {
      start.textContent = 'DEPLOY';
    }
  }
  showHUD(v = true) { this.el.hud.classList.toggle('hidden', !v); }
  showPause(v = true) { this.el.pause.classList.toggle('hidden', !v); }

  showShop(v = true) {
    this.el.shop.classList.toggle('hidden', !v);
    if (v) this.refreshShop();
  }

  showDeath(v = true, stats = null) {
    this.el.death.classList.toggle('hidden', !v);
    if (v && stats) {
      this.el.deathStats.innerHTML =
        `${stats.map} · ${stats.diff}<br>` +
        `QUESTS COMPLETE ${stats.quests}<br>` +
        `SCORE ${stats.score} · ${stats.credits} CR<br>` +
        `${stats.kills} KILLS · ${stats.headshots} HEADSHOTS`;
    }
  }

  // ---------------------------------------------------------------- setters

  setCredits(c) { this.el.credits.textContent = String(c); }

  setEnemies(n) {
    if (this._lastEnemies !== n) {
      this._lastEnemies = n;
      this.el.enemies.textContent = String(n);
    }
  }

  setScore(s) { this.el.score.textContent = String(s); }

  setQuest(q) {
    if (!q) {
      this.el.questPanel.classList.add('hidden');
      return;
    }
    this.el.questPanel.classList.remove('hidden');
    this.el.questTitle.textContent = q.title;
    this.el.questText.textContent = q.text;
  }

  setPrompt(text, color = null) {
    if (text === this._lastPrompt && color === this._lastPromptColor) return;
    this._lastPrompt = text;
    this._lastPromptColor = color;
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) {
      this.el.prompt.textContent = text;
      this.el.prompt.style.color = color || '';
      this.el.prompt.style.borderColor = color ? color : '';
    }
  }

  setUtilities(frags, recons) {
    this.el.utilFrag.textContent = String(frags);
    this.el.utilRecon.textContent = String(recons);
  }

  setAmmo(name, mag, reserve, slotIdx, slotNames) {
    this.el.weapon.textContent = name;
    this.el.ammoMag.textContent = Number.isFinite(mag) ? String(mag) : '∞';
    this.el.ammoReserve.textContent = Number.isFinite(reserve) ? String(reserve) : '∞';
    this.el.ammo.classList.toggle('low', Number.isFinite(mag) && mag <= 5);
    if (slotNames) {
      // Rebuild slot chips only when the loadout changes shape.
      const key = slotNames.join('|') + '#' + slotIdx;
      if (key !== this._slotKey) {
        this._slotKey = key;
        this.el.slots.innerHTML = '';
        slotNames.forEach((n, i) => {
          const s = document.createElement('span');
          s.textContent = String(i + 1);
          s.title = n;
          if (i === slotIdx) s.classList.add('on');
          this.el.slots.appendChild(s);
        });
      }
    }
  }

  setCrosshair(spreadPx, adsT) {
    const base = this.game.settings.crosshair.gap;
    this.el.crosshair.style.setProperty('--gap', `${(base + spreadPx).toFixed(1)}px`);
    this.el.crosshair.style.opacity = String(1 - adsT * 0.55);
  }

  setFPS(n) { this.el.fps.textContent = `${n} FPS`; }

  // ------------------------------------------------------- battle royale

  setBRMode(on) {
    document.getElementById('br').classList.toggle('hidden', !on);
    // The campaign panels have no meaning in a match.
    this.el.questPanel.classList.add('hidden');
    document.getElementById('hud-top').style.display = on ? 'none' : '';
    document.getElementById('br-result').classList.add('hidden');
    if (on) {
      this.setShield(0, 100);
      this.setMaterials({ wood: 0, stone: 0, metal: 0 });
      this.setBuildMode(false);
      this.setUseBar(null);
      document.getElementById('br-feed').innerHTML = '';
    }
  }

  /** Show or hide the free-roam readout. */
  setGTAZMode(on) {
    document.getElementById('gtaz').classList.toggle('hidden', !on);
    // CREDITS / HOSTILES / SCORE are campaign readouts and mean nothing in a
    // free-roam city. This line previously read `on ? '' : ''` — the same
    // value on both branches, so it never hid anything and the campaign HUD
    // sat on screen through the whole mode.
    document.getElementById('hud-top').style.display = on ? 'none' : '';
    if (on) this.el.questPanel.classList.add('hidden');
  }

  /**
   * Free-roam readout: wanted stars, speed, district. Called every frame, so
   * each field is diffed before touching the DOM — writing textContent on
   * every frame forces layout for no reason.
   */
  gtaz(s) {
    if (this._gz === undefined) this._gz = { stars: -1, speed: -1, inCar: null, district: null, cave: undefined };
    const prev = this._gz;
    if (s.stars !== prev.stars) {
      const el = document.getElementById('gtaz-stars');
      el.textContent = s.stars > 0 ? '★'.repeat(s.stars) + '☆'.repeat(5 - s.stars) : '';
      el.classList.toggle('hot', s.stars >= 3);
      prev.stars = s.stars;
    }
    if (s.inCar !== prev.inCar) {
      document.getElementById('gtaz-speedo').classList.toggle('hidden', !s.inCar);
      prev.inCar = s.inCar;
    }
    if (s.inCar && s.speed !== prev.speed) {
      document.getElementById('gtaz-kmh').textContent = String(s.speed);
      prev.speed = s.speed;
    }
    if (s.cave !== prev.cave) {
      const el = document.getElementById('gtaz-cave');
      if (el) {
        el.textContent = s.cave || '';
        el.classList.toggle('hidden', !s.cave);
      }
      prev.cave = s.cave;
    }
    if (s.district !== prev.district) {
      document.getElementById('gtaz-district').textContent = s.district || '';
      prev.district = s.district;
    }
  }

  /**
   * Cafe / diner menu. Pass null to close it.
   *
   * Items you can't afford are still listed, with the price in red — a menu
   * that hides what you can't buy tells you nothing about what to save for.
   */
  showMenuBoard(title, items, credits) {
    const el = document.getElementById('menu-board');
    if (!el) return;
    if (!title) { el.classList.add('hidden'); return; }
    const rows = items.map((it, i) => {
      const cant = credits < it.price ? ' cant' : '';
      return `<div class="mb-row${cant}">
        <span class="mb-key">${i + 1}</span>
        <span class="mb-name">${it.name}</span>
        <span class="mb-heal">+${it.heal}</span>
        <span class="mb-price">${it.price}</span>
      </div>`;
    }).join('');
    el.innerHTML = `<h3>${title}</h3>
      <div class="mb-sub">${credits} CREDITS</div>
      ${rows}
      <div class="mb-foot">1-3 TO ORDER · E TO LEAVE</div>`;
    el.classList.remove('hidden');
  }

  /**
   * Active contract, top-left under the stars. Pass null to clear it.
   * Diffed before writing, because this is called every frame.
   */
  setObjective(title, step) {
    const el = document.getElementById('objective');
    if (!el) return;
    if (!title) {
      el.classList.add('hidden');
      this._objKey = null;
      return;
    }
    const key = title + '|' + (step || '');
    if (key !== this._objKey) {
      this._objKey = key;
      el.querySelector('b').textContent = title;
      el.querySelector('span').textContent = step || '';
    }
    el.classList.remove('hidden');
  }

  setAlive(n) { document.getElementById('br-alive').textContent = String(n); }
  setBRKills(n) { document.getElementById('br-kills').textContent = String(n); }

  setShield(v, max) {
    document.getElementById('br-shield-fill').style.width = `${(v / max) * 100}%`;
  }

  setMaterials(m) {
    document.getElementById('mat-wood').textContent = String(m.wood | 0);
    document.getElementById('mat-stone').textContent = String(m.stone | 0);
    document.getElementById('mat-metal').textContent = String(m.metal | 0);
  }

  /** Storm clock + phase label, read straight off the Storm each frame. */
  setStorm(storm) {
    const el = document.getElementById('br-storm');
    const label = document.getElementById('br-storm-label');
    const box = el.parentElement;
    if (!storm || storm.state === 'idle' || storm.state === 'done') {
      el.textContent = '--';
      label.textContent = 'STORM';
      box.classList.remove('closing');
      document.getElementById('br-storm-warn').style.opacity = '0';
      return;
    }
    const s = storm.clock;
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const closing = storm.state === 'close';
    label.textContent = closing ? 'CLOSING' : 'NEXT ZONE';
    box.classList.toggle('closing', closing);
    // Purple vignette while you're standing in it.
    const p = this.game.player;
    const outside = p && storm.isOutside(p.position.x, p.position.z);
    document.getElementById('br-storm-warn').style.opacity = outside ? '1' : '0';
  }

  stormHurt() {
    this.damageFlash();
  }

  stormPhase() { /* clock already reflects it; hook kept for future cues */ }

  setAltimeter(m) {
    const el = document.getElementById('br-alt');
    if (m === null || m === undefined) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('b').textContent = String(Math.max(0, m));
  }

  /** Big centre-screen message. */
  brToast(title, sub = '', color = null) {
    const el = document.getElementById('br-toast');
    el.classList.remove('hidden');
    const b = el.querySelector('b');
    b.textContent = title;
    b.style.color = color || '#fff';
    el.querySelector('span').textContent = sub;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._brToastT);
    this._brToastT = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /** Elimination feed entry. */
  brFeed(killer, victim, weapon, head) {
    const feed = document.getElementById('br-feed');
    const div = document.createElement('div');
    const mine = killer === 'YOU';
    div.className = 'bf' + (mine ? ' you' : '');
    div.textContent = `${killer} ▸ ${victim}${head ? ' ⦿' : ''}`;
    feed.appendChild(div);
    while (feed.children.length > 6) feed.firstChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  /** Build mode bar. */
  setBuildMode(on, build = null) {
    const bar = document.getElementById('br-build');
    bar.classList.toggle('hidden', !on);
    if (!on || !build) return;
    for (const el of bar.querySelectorAll('.bp')) {
      el.classList.toggle('on', el.dataset.p === build.selected);
    }
    const mm = document.getElementById('br-buildmat');
    const colors = { wood: '#9a6f3f', stone: '#8d8d88', metal: '#6f7a86' };
    mm.textContent = build.material.toUpperCase();
    mm.style.color = colors[build.material];
  }

  /** Consumable channel bar; pass null to hide. */
  setUseBar(k, name = '') {
    const el = document.getElementById('br-use');
    if (k === null || k === undefined) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    document.getElementById('br-use-fill').style.width = `${Math.round(k * 100)}%`;
    el.querySelector('span').textContent = name;
  }

  _brResult(place, total, stats, won) {
    const el = document.getElementById('br-result');
    el.classList.remove('hidden');
    const p = document.getElementById('br-place');
    p.textContent = won ? '#1' : `#${place}`;
    p.classList.toggle('lost', !won);
    document.getElementById('br-place-sub').textContent =
      won ? 'LAST ONE STANDING' : `OF ${total} FIGHTERS`;
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60);
    document.getElementById('br-result-stats').innerHTML =
      `${stats.kills} ELIMINATION${stats.kills === 1 ? '' : 'S'}<br>` +
      `SURVIVED ${mins}:${String(secs).padStart(2, '0')}`;
  }

  brVictory(stats) { this._brResult(1, stats.total, stats, true); }
  brDefeat(stats) { this._brResult(stats.place, stats.total, stats, false); }

  /** Streak milestone callout. */
  streak(name, bonus, count) {
    const el = document.getElementById('streak');
    el.classList.remove('hidden');
    const nameEl = document.getElementById('streak-name');
    nameEl.textContent = name;
    document.getElementById('streak-sub').textContent = `${count} KILLS  ·  +${bonus} CR`;
    // Restart the pop animation.
    nameEl.style.animation = 'none';
    void nameEl.offsetWidth;
    nameEl.style.animation = '';
    clearTimeout(this._streakTimer);
    this._streakTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  /** Running counter for kills that didn't hit a milestone. */
  streakTick(count) {
    const el = document.getElementById('streak-count');
    if (count < 2) return;
    el.classList.remove('hidden');
    el.textContent = `×${count}`;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._tickTimer);
    this._tickTimer = setTimeout(() => el.classList.add('hidden'), 4200);
  }

  streakEnd() {
    document.getElementById('streak-count').classList.add('hidden');
  }

  /** Adrenaline glow — brighter and faster-pulsing the deeper you're in. */
  setAdrenaline(level, inFlow, t) {
    const el = document.getElementById('adrenaline');
    if (!inFlow) {
      if (el.style.opacity !== '0') el.style.opacity = '0';
      return;
    }
    const pulse = 0.72 + Math.sin(t * 7) * 0.28;
    el.style.opacity = String((level - 0.45) * 1.5 * pulse);
  }

  /** Boss health bar; pass null to hide, or { name, frac }. */
  setBoss(data) {
    const bar = document.getElementById('boss-bar');
    if (!data) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    document.getElementById('boss-name').textContent = data.name;
    document.getElementById('boss-fill').style.width = `${Math.round(data.frac * 100)}%`;
  }

  /** Reload progress under the crosshair; pass null to hide. */
  setReload(rt) {
    const bar = document.getElementById('reload-bar');
    if (rt === null) {
      if (!bar.classList.contains('hidden')) bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    document.getElementById('reload-fill').style.width = `${Math.round(rt * 100)}%`;
  }

  showLockHint(v) { this.el.lockHint.classList.toggle('hidden', !v); }

  /** "SPACE to skip" prompt during the opening cinematic. */
  setSkipHint(v) {
    let el = document.getElementById('skip-hint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'skip-hint';
      el.textContent = 'SPACE — SKIP';
      document.body.appendChild(el);
    }
    el.style.display = v ? '' : 'none';
  }

  hitmarker(head) {
    const el = this.el.hitmarker;
    el.classList.remove('pop', 'head');
    void el.offsetWidth;
    if (head) el.classList.add('head');
    el.classList.add('pop');
  }

  damageFlash() {
    this.el.vignette.style.opacity = '1';
    clearTimeout(this._vignetteTimer);
    this._vignetteTimer = setTimeout(() => {
      this.el.vignette.style.opacity = '0';
    }, 130);
  }

  killfeed(text, head) {
    const div = document.createElement('div');
    div.className = head ? 'kf head' : 'kf';
    div.textContent = head ? `${text} ⦿` : text;
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
    setTimeout(() => div.remove(), 4200);
  }

  banner(main, sub = '') {
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.remove('hidden');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.add('hidden'), 2400);
  }

  /**
   * Radio transmission: shows the subtitle and speaks the line aloud.
   * The caption hangs around long enough to read even after the voice ends.
   */
  comms(text, who = 'COMMS') {
    if (this.game.settings.subtitles !== false) {
      this.el.comms.innerHTML = `<span class="who">${who} ▸</span>${text}`;
      this.el.comms.classList.add('show');
      clearTimeout(this._commsTimer);
      // Longer lines stay up longer — roughly reading speed.
      const dwell = Math.max(5000, Math.min(14000, text.length * 62));
      this._commsTimer = setTimeout(() => this.el.comms.classList.remove('show'), dwell);
    }
    if (this.game.voice) this.game.voice.say(text, who);
  }

  /** Per-frame poll of continuously-changing values (bars). */
  tick() {
    const p = this.game.player;
    const h = Math.ceil(p.health);
    const a = Math.ceil(p.armor);
    const e = Math.round(p.energy);
    if (h !== this._last.h) {
      this._last.h = h;
      this.el.barHealth.style.width = `${(h / p.maxHealth) * 100}%`;
      this.el.txtHealth.textContent = String(h);
    }
    if (a !== this._last.a) {
      this._last.a = a;
      this.el.barArmor.style.width = `${(a / p.maxArmor) * 100}%`;
      this.el.txtArmor.textContent = String(a);
    }
    if (e !== this._last.e) {
      this._last.e = e;
      this.el.barEnergy.style.width = `${e}%`;
      this.el.txtEnergy.textContent = String(e);
    }
  }
}
