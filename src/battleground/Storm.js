import * as THREE from 'three';
import { ISLAND_SIZE } from './Island.js';

/**
 * Storm — the shrinking safe zone.
 *
 * Eight phases. Each has a WAIT window (next circle is drawn on the map but
 * the wall hasn't moved) followed by a CLOSE window (the wall travels to the
 * new circle). Damage outside escalates every phase, so an early-game storm
 * is survivable and a late-game one kills you in seconds.
 *
 * The next circle is always chosen inside the current one, so the safe zone
 * is guaranteed reachable — no unwinnable rotations.
 */

// [waitSeconds, closeSeconds, radiusMultiplier, damagePerSecond]
//
// Close windows are timed against the WALL'S SPEED, not the clock. Each phase
// eats a fixed fraction of the current radius, so on the 2400 m island every
// phase moves twice as far as it used to. Left at the old durations the first
// wall would travel ~11.9 m/s against an 8 m/s sprint — caught at the rim, you
// simply could not get out, no matter how well you played. These keep the
// worst phase at ~6.6 m/s, inside sprint speed with room for a mistake.
// Each phase eats a fixed FRACTION of the current radius, so the early close
// windows are exactly doubled — that is what holds the wall at its original
// speed rather than merely a survivable one. Late circles are small enough
// that their travel is short either way, so they tighten up again. Waits are
// trimmed to keep the whole match near sixteen minutes.
const PHASES = [
  [100, 120, 0.62, 1],
  [84, 110, 0.58, 2],
  [68, 100, 0.55, 5],
  [48, 90, 0.52, 8],
  [42, 63, 0.50, 10],
  [32, 54, 0.48, 12],
  [26, 40, 0.45, 15],
  [20, 36, 0.00, 20]   // final circle collapses to a point
];

export class Storm {
  constructor(game) {
    this.game = game;
    this.reset();
    this._build();
  }

  reset() {
    this.phase = -1;
    this.state = 'idle';      // idle | wait | close | done
    this.timer = 0;
    this.centre = new THREE.Vector2(0, 0);
    this.radius = ISLAND_SIZE * 0.78;
    this.fromCentre = this.centre.clone();
    this.fromRadius = this.radius;
    this.toCentre = this.centre.clone();
    this.toRadius = this.radius;
    this.dps = 0;
    this._tickAcc = 0;
    if (this.wall) this.wall.visible = false;
  }

  /** The violet wall: a tall open cylinder with a scrolling shimmer. */
  _build() {
    const geo = new THREE.CylinderGeometry(1, 1, 420, 96, 1, true);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x9b6bff) } },
      vertexShader: `
        varying vec2 vUv;
        varying float vY;
        void main() {
          vUv = uv;
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vY;
        // Cheap value noise for the drifting energy bands.
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float n(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
        }
        void main() {
          // Vertical bands scrolling upward, plus a soft horizontal ripple.
          float bands = n(vec2(vUv.x * 46.0, vY * 0.05 - uTime * 0.55));
          float fine  = n(vec2(vUv.x * 130.0, vY * 0.12 + uTime * 0.9));
          float a = 0.30 + bands * 0.34 + fine * 0.16;
          // Denser near the ground where it matters, thinning with altitude.
          a *= smoothstep(190.0, -30.0, vY) * 0.9 + 0.12;
          gl_FragColor = vec4(uColor * (0.75 + bands * 0.6), a);
        }`
    });
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.game.scene.add(this.wall);
    this._mat = mat;
  }

  /** Kick off phase 0. */
  start() {
    this.reset();
    this.wall.visible = true;
    this._advance();
  }

  /** Move to the next phase: pick a new circle inside the current one. */
  _advance() {
    this.phase++;
    if (this.phase >= PHASES.length) {
      this.state = 'done';
      return;
    }
    const [wait, , mult, dps] = PHASES[this.phase];
    this.fromCentre.copy(this.centre);
    this.fromRadius = this.radius;
    this.toRadius = this.radius * mult;
    this.dps = dps;

    // New centre must keep the next circle fully inside the current one.
    const slack = Math.max(0, this.radius - this.toRadius);
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * slack * 0.82;
    this.toCentre.set(
      this.centre.x + Math.cos(a) * d,
      this.centre.y + Math.sin(a) * d
    );

    this.state = 'wait';
    this.timer = wait;
    const g = this.game;
    if (g.hud.stormPhase) g.hud.stormPhase(this.phase + 1, PHASES.length, 'wait');
    if (this.phase === 0) {
      g.hud.brToast('THE STORM IS FORMING', 'Get inside the white circle');
    } else {
      g.hud.brToast(`STORM PHASE ${this.phase + 1}`, `${dps} damage per second outside`);
    }
    if (g.audio.stormWarn) g.audio.stormWarn();
  }

  /** Distance from a world position to the safe-zone edge (negative = safe). */
  distanceOutside(x, z) {
    return Math.hypot(x - this.centre.x, z - this.centre.y) - this.radius;
  }

  isOutside(x, z) { return this.distanceOutside(x, z) > 0; }

  /** Where a bot should run to when it's caught out. */
  safeTarget(out = new THREE.Vector3()) {
    return out.set(this.centre.x, 0, this.centre.y);
  }

  update(dt) {
    if (this.state === 'idle' || this.state === 'done') return;
    this._mat.uniforms.uTime.value += dt;

    this.timer -= dt;
    if (this.state === 'wait') {
      if (this.timer <= 0) {
        this.state = 'close';
        this.timer = PHASES[this.phase][1];
        this._closeDur = this.timer;
        if (this.game.hud.stormPhase) this.game.hud.stormPhase(this.phase + 1, PHASES.length, 'close');
        this.game.hud.brToast('THE STORM IS CLOSING', 'Move to the safe zone');
        if (this.game.audio.stormClose) this.game.audio.stormClose();
      }
    } else if (this.state === 'close') {
      const t = 1 - Math.max(0, this.timer) / this._closeDur;
      const k = t * t * (3 - 2 * t);                 // ease so it isn't linear
      this.radius = this.fromRadius + (this.toRadius - this.fromRadius) * k;
      this.centre.lerpVectors(this.fromCentre, this.toCentre, k);
      if (this.timer <= 0) {
        this.radius = this.toRadius;
        this.centre.copy(this.toCentre);
        this._advance();
      }
    }

    // Wall follows the live circle.
    this.wall.position.set(this.centre.x, 60, this.centre.y);
    this.wall.scale.set(Math.max(this.radius, 0.5), 1, Math.max(this.radius, 0.5));

    // Damage ticks once a second so the numbers read cleanly.
    const p = this.game.player;
    if (p && p.alive && this.isOutside(p.position.x, p.position.z)) {
      this._tickAcc += dt;
      if (this._tickAcc >= 1) {
        this._tickAcc = 0;
        p.damage(this.dps, null);
        this.game.hud.stormHurt();
      }
    } else {
      this._tickAcc = 0;
    }
  }

  /** Seconds until the current window ends, for the HUD clock. */
  get clock() {
    return Math.max(0, Math.ceil(this.timer));
  }

  dispose() {
    if (this.wall) this.game.scene.remove(this.wall);
  }
}
