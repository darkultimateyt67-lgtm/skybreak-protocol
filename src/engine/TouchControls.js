/**
 * TouchControls — phone and tablet support.
 *
 * The whole layer is a translator: it never talks to the player or weapons
 * directly, it just synthesizes the same keyboard/mouse state the desktop
 * build produces (input.keys, input.buttons, input.mouseDX/DY). Every system
 * downstream stays untouched.
 *
 * Layout: movement stick bottom-left, look anywhere on the right half,
 * action buttons bottom-right. Fire is a big thumb pad; ADS is hold-to-aim.
 * Multi-touch throughout, so you can run, look and shoot at once.
 */
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.enabled = false;
    this.root = null;

    // Active touch bookkeeping.
    this._stickId = null;
    this._lookId = null;
    this._lookLast = { x: 0, y: 0 };
    this._stickOrigin = { x: 0, y: 0 };
    this._held = new Map(); // touchId -> button element
  }

  /** Coarse pointer + no hover = phone/tablet. */
  static isTouchDevice() {
    return (
      ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  build() {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="t-stick"><div id="t-stick-base"></div><div id="t-stick-knob"></div></div>
      <div id="t-look"></div>
      <div id="t-actions">
        <button class="t-btn t-fire" data-act="fire">FIRE</button>
        <button class="t-btn" data-act="ads">ADS</button>
        <button class="t-btn" data-act="jump">JUMP</button>
        <button class="t-btn" data-act="reload">R</button>
        <button class="t-btn" data-act="crouch">CRCH</button>
        <button class="t-btn t-use" data-act="use">E</button>
      </div>
      <div id="t-util">
        <button class="t-btn t-small" data-act="frag">✸</button>
        <button class="t-btn t-small" data-act="recon">◎</button>
        <button class="t-btn t-small" data-act="swap">⇄</button>
        <button class="t-btn t-small" data-act="shop">B</button>
        <button class="t-btn t-small" data-act="view">👁</button>
        <button class="t-btn t-small" data-act="pause">❚❚</button>
      </div>
      <div id="t-gtaz">
        <button class="t-btn t-car" data-act="car">CAR</button>
        <button class="t-btn" data-act="punch">PUNCH</button>
        <button class="t-btn t-small" data-act="cam">CAM</button>
        <button class="t-btn t-small" data-act="hood">HOOD</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;

    this.stick = root.querySelector('#t-stick');
    this.knob = root.querySelector('#t-stick-knob');
    this.lookPad = root.querySelector('#t-look');

    this._wireStick();
    this._wireLook();
    this._wireButtons();

    // Kill iOS double-tap zoom / long-press callouts over the controls.
    root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  enable(on = true) {
    this.enabled = on;
    if (on) this.build();
    if (this.root) this.root.style.display = on ? '' : 'none';
    if (!on) this._releaseAll();
  }

  /**
   * The city adds its own buttons — get in and out of vehicles, punch, switch
   * the driving camera, lift a bonnet — which mean nothing anywhere else.
   */
  setMode(gtaz) {
    if (this.root) this.root.classList.toggle('gtaz', !!gtaz);
  }

  /** Only visible while actually playing. */
  setVisible(v) {
    if (!this.root) return;
    this.root.style.display = (this.enabled && v) ? '' : 'none';
    if (!v) this._releaseAll();
  }

  _releaseAll() {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ControlLeft', 'Space']) {
      this.input.keys.delete(k);
    }
    this.input.buttons[0] = false;
    this.input.buttons[2] = false;
    this._stickId = null;
    this._lookId = null;
    this._held.clear();
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
  }

  // ------------------------------------------------------------------ stick

  _wireStick() {
    const RADIUS = 56;

    const start = (e) => {
      for (const t of e.changedTouches) {
        if (this._stickId !== null) break;
        this._stickId = t.identifier;
        const r = this.stick.getBoundingClientRect();
        this._stickOrigin.x = r.left + r.width / 2;
        this._stickOrigin.y = r.top + r.height / 2;
        this._moveStick(t);
      }
      e.preventDefault();
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stickId) this._moveStick(t);
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._stickId) continue;
        this._stickId = null;
        this.knob.style.transform = 'translate(-50%, -50%)';
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) this.input.keys.delete(k);
      }
    };

    this.stick.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    this._stickRadius = RADIUS;
  }

  _moveStick(touch) {
    const R = this._stickRadius;
    let dx = touch.clientX - this._stickOrigin.x;
    let dy = touch.clientY - this._stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Deadzone, then map the stick octant onto WASD. Pushing past 80% of the
    // radius forward also engages sprint, so there's no separate run button.
    const nx = dx / R;
    const ny = dy / R;
    const mag = Math.hypot(nx, ny);
    const keys = this.input.keys;
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) keys.delete(k);
    if (mag < 0.22) return;
    if (ny < -0.38) keys.add('KeyW');
    if (ny > 0.38) keys.add('KeyS');
    if (nx < -0.38) keys.add('KeyA');
    if (nx > 0.38) keys.add('KeyD');
    if (ny < -0.38 && mag > 0.8) keys.add('ShiftLeft');
  }

  // ------------------------------------------------------------------- look

  _wireLook() {
    const SENS = 1.35; // touch drag feels better slightly hotter than mouse

    const start = (e) => {
      for (const t of e.changedTouches) {
        if (this._lookId !== null) break;
        this._lookId = t.identifier;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      }
      e.preventDefault();
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookId) continue;
        // Feed the same delta channel the mouse uses.
        this.input.mouseDX += (t.clientX - this._lookLast.x) * SENS;
        this.input.mouseDY += (t.clientY - this._lookLast.y) * SENS;
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookId) this._lookId = null;
      }
    };

    this.lookPad.addEventListener('touchstart', start, { passive: false });
    this.lookPad.addEventListener('touchmove', move, { passive: false });
    this.lookPad.addEventListener('touchend', end);
    this.lookPad.addEventListener('touchcancel', end);
  }

  // ---------------------------------------------------------------- buttons

  _wireButtons() {
    const input = this.input;
    const game = this.game;

    // Held actions map to sustained state; tapped actions fire a one-frame edge.
    // JUMP is held as well as tapped: held Space is the handbrake in a car,
    // lift in a plane and rising in the water, exactly as on a keyboard.
    const HOLD = {
      fire: () => { input.buttons[0] = true; },
      ads: () => { input.buttons[2] = true; },
      crouch: () => { input.keys.add('ControlLeft'); },
      jump: () => { input.keys.add('Space'); }
    };
    const RELEASE = {
      fire: () => { input.buttons[0] = false; },
      ads: () => { input.buttons[2] = false; },
      crouch: () => { input.keys.delete('ControlLeft'); },
      jump: () => { input.keys.delete('Space'); }
    };
    const TAP = {
      jump: () => input.oncePressed.add('Space'),
      reload: () => input.oncePressed.add('KeyR'),
      use: () => input.oncePressed.add('KeyE'),
      frag: () => input.oncePressed.add('KeyG'),
      recon: () => input.oncePressed.add('KeyQ'),
      shop: () => input.oncePressed.add('KeyB'),
      view: () => input.oncePressed.add('KeyT'),
      swap: () => { input.wheel = 1; },
      pause: () => game.pauseFromTouch(),
      car: () => input.oncePressed.add('KeyF'),
      punch: () => input.oncePressed.add('KeyV'),
      cam: () => input.oncePressed.add('KeyC'),
      hood: () => input.oncePressed.add('KeyH')
    };

    for (const btn of this.root.querySelectorAll('.t-btn')) {
      const act = btn.dataset.act;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('down');
        if (HOLD[act]) {
          HOLD[act]();
          for (const t of e.changedTouches) this._held.set(t.identifier, act);
        }
        if (TAP[act]) TAP[act]();
        // Tapping fire also counts as a trigger pull for semi-auto weapons.
        if (act === 'fire') input.onceButtons[0] = true;
      }, { passive: false });

      const up = (e) => {
        btn.classList.remove('down');
        for (const t of e.changedTouches) {
          const held = this._held.get(t.identifier);
          if (held && RELEASE[held]) RELEASE[held]();
          this._held.delete(t.identifier);
        }
      };
      btn.addEventListener('touchend', up);
      btn.addEventListener('touchcancel', up);
    }
  }
}
