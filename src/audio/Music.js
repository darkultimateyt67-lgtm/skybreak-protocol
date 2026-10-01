/**
 * Music — an adaptive score with no audio files.
 *
 * Four layers run continuously and are mixed by threat, so the music is
 * always playing but only *arrives* when something is happening:
 *
 *   drone  — always audible; the station breathing
 *   pad    — a minor chord that fades in as danger appears
 *   pulse  — a driving eighth-note bass, the combat engine
 *   lead   — an arpeggio that only shows up when you're deep in a fight
 *
 * Threat is derived from live game state (nearby hostiles, whether they can
 * see you, your health, your adrenaline) and smoothed, so the mix eases in
 * and out instead of snapping between cues.
 */

// A natural-minor scale in Hz, rooted low — sounds tense without trying.
const ROOT = 55; // A1
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const semi = (n) => ROOT * Math.pow(2, n / 12);

export class Music {
  constructor(game) {
    this.game = game;
    this.started = false;
    this.threat = 0;       // smoothed 0..1
    this._targetThreat = 0;
    this._step = 0;
    this._nextStep = 0;
    this._bpm = 92;
  }

  get ctx() { return this.game.audio.ctx; }

  /** Build the four-layer bus. Safe to call more than once. */
  start() {
    const audio = this.game.audio;
    if (this.started || !audio.ctx) return;
    const ctx = audio.ctx;
    this.started = true;

    // One gain per layer, all feeding the master bus.
    const bus = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(audio.master);
      return g;
    };
    this.gDrone = bus(0.05);
    this.gPad = bus(0.0);
    this.gPulse = bus(0.0);
    this.gLead = bus(0.0);

    // ---- Drone: two detuned saws under a low-pass, plus a sub sine -------
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 1.5;
    lp.connect(this.gDrone);
    for (const detune of [0, 5, -7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = semi(0);
      o.detune.value = detune;
      o.connect(lp);
      o.start();
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = semi(-12);
    const subG = ctx.createGain();
    subG.gain.value = 0.6;
    sub.connect(subG); subG.connect(this.gDrone);
    sub.start();
    // Slow filter sweep so the drone never sits still.
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.05;
    const sweepG = ctx.createGain();
    sweepG.gain.value = 90;
    sweep.connect(sweepG); sweepG.connect(lp.frequency);
    sweep.start();

    // ---- Pad: a held minor triad, gently chorused --------------------------
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 1100;
    padLp.connect(this.gPad);
    for (const n of [12, 15, 19, 24]) {         // root, m3, 5th, octave
      for (const d of [-6, 6]) {                 // two voices per note
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = semi(n);
        o.detune.value = d;
        const g = ctx.createGain();
        g.gain.value = 0.22;
        o.connect(g); g.connect(padLp);
        o.start();
      }
    }

    this._ctx = ctx;
    this._nextStep = ctx.currentTime + 0.1;
  }

  /** One plucked note — used by the pulse and lead layers. */
  _note(freq, dur, dest, peak, type = 'square') {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.04);
  }

  /**
   * Read the world and decide how tense the music should be.
   */
  _measureThreat() {
    const g = this.game;
    if (!g.player || !g.player.alive) return 0;
    let near = 0;
    let seen = 0;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(g.player.position);
      if (d < 45) near++;
      if (d < 30 && e.state === 1) seen++;   // COMBAT state
    }
    const crowd = Math.min(1, near / 5);
    const engaged = Math.min(1, seen / 3);
    const hurt = 1 - g.player.health / g.player.maxHealth;
    const flow = g.momentum ? g.momentum.adrenaline : 0;
    const boss = g.quests && g.quests.current && g.quests.current.def.type === 'boss' ? 0.35 : 0;
    return Math.min(1, crowd * 0.35 + engaged * 0.45 + hurt * 0.2 + flow * 0.25 + boss);
  }

  update(dt) {
    if (!this.started || !this._ctx) return;

    // Smooth the threat: rises quickly, falls slowly, so fights feel like
    // they build and then release rather than flicker.
    this._targetThreat = this._measureThreat();
    const rate = this._targetThreat > this.threat ? 1.6 : 0.35;
    this.threat += (this._targetThreat - this.threat) * Math.min(1, dt * rate);
    const T = this.threat;

    // Layer mix. Each layer has its own entry point along the threat curve.
    const vol = (this.game.settings.volume ?? 0.7);
    const ramp = (node, target) => {
      node.gain.setTargetAtTime(target * vol, this._ctx.currentTime, 0.4);
    };
    ramp(this.gDrone, 0.05 + T * 0.03);
    ramp(this.gPad, Math.max(0, (T - 0.1) / 0.9) * 0.09);
    ramp(this.gPulse, Math.max(0, (T - 0.3) / 0.7) * 0.1);
    ramp(this.gLead, Math.max(0, (T - 0.6) / 0.4) * 0.075);

    // Tempo tracks intensity too.
    this._bpm = 92 + T * 38;

    // ---- Sequencer -------------------------------------------------------
    const stepDur = 60 / this._bpm / 2;   // eighth notes
    if (this._ctx.currentTime >= this._nextStep) {
      this._nextStep = this._ctx.currentTime + stepDur;
      const s = this._step++;

      // Pulse: root on the beat, fifth on the off, an octave stab every bar.
      if (T > 0.3) {
        const pat = [0, 0, 7, 0, 0, 5, 7, 0];
        const n = pat[s % pat.length];
        const peak = 0.5 + (s % 8 === 0 ? 0.35 : 0);
        this._note(semi(12 + n), stepDur * 1.5, this.gPulse, peak, 'square');
        if (s % 8 === 0) this._note(semi(0), stepDur * 3, this.gPulse, 0.7, 'sawtooth');
      }

      // Lead: a minor arpeggio that climbs, only at high threat.
      if (T > 0.6 && s % 2 === 0) {
        const idx = Math.floor(s / 2) % MINOR.length;
        const up = MINOR[idx] + 36;
        this._note(semi(up), stepDur * 1.2, this.gLead, 0.4, 'triangle');
      }
    }
  }

  stop() {
    if (!this.started) return;
    for (const g of [this.gPad, this.gPulse, this.gLead]) {
      if (g) g.gain.setTargetAtTime(0, this._ctx.currentTime, 0.3);
    }
    this.threat = 0;
    this._targetThreat = 0;
  }
}
