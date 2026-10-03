/**
 * Input — keyboard/mouse state with pointer-lock mouse deltas.
 *
 * Continuous state is queried with key()/button(); edge-triggered presses
 * are queried with pressed()/buttonPressed() and are valid for one frame.
 * Game.loop() calls endFrame() after all systems have updated.
 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.oncePressed = new Set();
    this.buttons = [false, false, false];
    this.onceButtons = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;

    // Fallback look: some browsers/embeds refuse real Pointer Lock (blocked
    // iframe, missing user-activation, corporate policy). When enabled, look
    // is driven by raw client-coordinate deltas instead of movementX/Y so
    // the camera never goes permanently dead just because lock failed.
    this.lookFallback = false;
    this._lastX = null;
    this._lastY = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.oncePressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousedown', (e) => {
      // A click that is capturing the mouse (or pressing CLICK TO PLAY) is not
      // a shot. Only count presses once the pointer is ours, or in the
      // fallback mode where the browser refused to lock it at all.
      if (!this.locked && !this.lookFallback) return;
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.onceButtons[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        return;
      }
      if (!this.lookFallback) return;
      // First sample after (re)enabling: record a baseline, no delta yet,
      // so the camera doesn't snap toward wherever the cursor happens to be.
      if (this._lastX !== null) {
        this.mouseDX += e.clientX - this._lastX;
        this.mouseDY += e.clientY - this._lastY;
      }
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement != null;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.fill(false);
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  /** Request pointer lock on an element; resolves false if the browser refuses. */
  async lock(element) {
    try {
      await element.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Enable/disable the raw-delta look fallback used when Pointer Lock is unavailable. */
  setLookFallback(enabled) {
    this.lookFallback = enabled;
    this._lastX = null;
    this._lastY = null;
  }

  key(code) { return this.keys.has(code); }
  pressed(code) { return this.oncePressed.has(code); }
  button(i) { return this.buttons[i]; }
  buttonPressed(i) { return this.onceButtons[i]; }

  /** Clear one-frame edges and mouse deltas. Called once per frame by the game loop. */
  endFrame() {
    this.oncePressed.clear();
    this.onceButtons.fill(false);
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
