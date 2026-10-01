/**
 * AudioSys — fully procedural WebAudio sound. Every effect is synthesized
 * (noise bursts, filtered oscillators, envelopes), so the game ships with
 * zero audio assets and no licensing surface.
 *
 * The AudioContext is created lazily on the first user gesture (browser
 * autoplay policy); every play method is a no-op until then.
 */
export class AudioSys {
  constructor(game) {
    this.game = game;
    this.ctx = null;
  }

  /** Create the context + master chain. Safe to call repeatedly. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.game.settings.volume * 0.6;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // Shared 1s white-noise buffer.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v * 0.6;
  }

  // ------------------------------------------------------------- primitives

  /** Filtered noise burst with exponential decay. */
  _noise({ type = 'bandpass', freq = 1000, q = 0.8, dur = 0.1, peak = 0.4, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Pitched oscillator sweep with exponential decay. */
  _tone({ type = 'sine', from = 440, to = 220, dur = 0.15, peak = 0.3, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ events

  shoot(kind) {
    if (kind === 'ar') {
      this._noise({ freq: 1900, q: 0.6, dur: 0.08, peak: 0.4 });
      this._tone({ type: 'sine', from: 150, to: 52, dur: 0.08, peak: 0.5 });
    } else if (kind === 'sg') {
      this._noise({ freq: 480, q: 0.5, dur: 0.2, peak: 0.7, type: 'lowpass' });
      this._noise({ freq: 2400, q: 0.7, dur: 0.06, peak: 0.35 });
      this._tone({ type: 'sine', from: 110, to: 38, dur: 0.17, peak: 0.8 });
    } else { // dmr
      this._noise({ freq: 1300, q: 0.6, dur: 0.13, peak: 0.55 });
      this._tone({ type: 'sine', from: 190, to: 48, dur: 0.13, peak: 0.6 });
      this._noise({ freq: 700, q: 1, dur: 0.25, peak: 0.12, delay: 0.03 });
    }
  }

  enemyShoot(dist) {
    const v = Math.max(0.05, 0.4 * (1 - dist / 70));
    this._noise({ freq: 900, q: 0.8, dur: 0.09, peak: v });
    this._tone({ type: 'square', from: 320, to: 120, dur: 0.07, peak: v * 0.5 });
  }

  footstep(running) {
    this._noise({ type: 'lowpass', freq: 380 + Math.random() * 120, dur: 0.05, peak: running ? 0.16 : 0.1 });
  }

  jump() { this._tone({ type: 'triangle', from: 200, to: 330, dur: 0.09, peak: 0.14 }); }

  boost() {
    this._noise({ type: 'highpass', freq: 900, dur: 0.25, peak: 0.22 });
    this._tone({ type: 'sawtooth', from: 70, to: 160, dur: 0.22, peak: 0.2 });
  }

  land(intensity) {
    this._noise({ type: 'lowpass', freq: 220, dur: 0.12, peak: 0.1 + intensity * 0.2 });
  }

  slide() { this._noise({ type: 'lowpass', freq: 800, dur: 0.28, peak: 0.12 }); }

  hit(head) {
    if (head) {
      this._tone({ type: 'square', from: 1500, to: 1500, dur: 0.045, peak: 0.22 });
      this._tone({ type: 'square', from: 2200, to: 2200, dur: 0.05, peak: 0.18, delay: 0.03 });
    } else {
      this._tone({ type: 'square', from: 1150, to: 1000, dur: 0.04, peak: 0.16 });
    }
  }

  /**
   * Body against bodywork. Deliberately low and soft: the combat hitmarker
   * (`hit`) is a 1.5-2.2 kHz square wave, which is piercing by design so it
   * cuts through a firefight. Driving through a crowd fired one per person,
   * several a second, and the stack was genuinely painful to listen to.
   */
  thud() {
    this._noise({ type: 'lowpass', freq: 260, dur: 0.14, peak: 0.11 });
    this._tone({ type: 'sine', from: 150, to: 70, dur: 0.16, peak: 0.09 });
  }

  kill() { this._tone({ type: 'sine', from: 880, to: 1320, dur: 0.14, peak: 0.2 }); }

  hurt() { this._tone({ type: 'sawtooth', from: 170, to: 75, dur: 0.18, peak: 0.28 }); }

  /** Staged reload foley: release catch, mag out, mag seated, charge pull. */
  reload(phase) {
    if (phase === 'start') {
      this._noise({ freq: 2600, q: 3, dur: 0.035, peak: 0.2 });
    } else if (phase === 'out') {
      this._noise({ freq: 900, q: 2, dur: 0.06, peak: 0.18 });
      this._tone({ type: 'square', from: 300, to: 180, dur: 0.05, peak: 0.06 });
    } else if (phase === 'in') {
      this._noise({ freq: 1400, q: 2.5, dur: 0.05, peak: 0.22 });
      this._tone({ type: 'square', from: 420, to: 300, dur: 0.04, peak: 0.08 });
    } else { // end — bolt/charge
      this._noise({ freq: 3100, q: 3, dur: 0.03, peak: 0.22 });
      this._noise({ freq: 2000, q: 3, dur: 0.035, peak: 0.18, delay: 0.06 });
      this._tone({ type: 'square', from: 500, to: 400, dur: 0.04, peak: 0.08, delay: 0.08 });
    }
  }

  explosion() {
    this._noise({ type: 'lowpass', freq: 300, dur: 0.5, peak: 0.7 });
    this._tone({ type: 'sine', from: 120, to: 30, dur: 0.45, peak: 0.7 });
    this._noise({ freq: 2000, q: 0.5, dur: 0.12, peak: 0.3 });
  }

  purchase() {
    this._tone({ type: 'sine', from: 660, to: 660, dur: 0.07, peak: 0.16 });
    this._tone({ type: 'sine', from: 990, to: 990, dur: 0.1, peak: 0.16, delay: 0.08 });
  }

  questAccept() {
    this._tone({ type: 'triangle', from: 520, to: 660, dur: 0.12, peak: 0.16 });
    this._tone({ type: 'triangle', from: 660, to: 880, dur: 0.14, peak: 0.14, delay: 0.1 });
  }

  questDone() {
    this._tone({ type: 'sine', from: 523, to: 523, dur: 0.12, peak: 0.16 });
    this._tone({ type: 'sine', from: 659, to: 659, dur: 0.12, peak: 0.16, delay: 0.11 });
    this._tone({ type: 'sine', from: 784, to: 784, dur: 0.2, peak: 0.18, delay: 0.22 });
  }

  /**
   * Forest ambience: a wind-through-leaves bed, a chirping insect layer, and
   * occasional birdsong. Birds are synthesized as short frequency-swept
   * whistles in little phrases, which reads as songbird surprisingly well.
   */
  forestStart() {
    if (!this.ctx || this._forest) return;
    this._forest = true;

    // Leaf rustle: filtered noise with a slow-breathing band.
    const rustle = this.ctx.createBufferSource();
    rustle.buffer = this.noiseBuf;
    rustle.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    const rg = this.ctx.createGain();
    rg.gain.value = 0.028;
    rustle.connect(bp); bp.connect(rg); rg.connect(this.master);
    rustle.start();

    // Gusts sweep the rustle's band and level.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(rg.gain);
    const lfo2 = this.ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2G = this.ctx.createGain();
    lfo2G.gain.value = 900;
    lfo2.connect(lfo2G); lfo2G.connect(bp.frequency);
    lfo.start(); lfo2.start();

    // Insect shimmer: a high, quiet, amplitude-fluttering tone.
    const cicada = this.ctx.createOscillator();
    cicada.type = 'sawtooth';
    cicada.frequency.value = 4200;
    const chp = this.ctx.createBiquadFilter();
    chp.type = 'bandpass';
    chp.frequency.value = 4200;
    chp.Q.value = 8;
    const cg = this.ctx.createGain();
    cg.gain.value = 0.0055;
    const trill = this.ctx.createOscillator();
    trill.frequency.value = 17;
    const trillG = this.ctx.createGain();
    trillG.gain.value = 0.004;
    trill.connect(trillG); trillG.connect(cg.gain);
    cicada.connect(chp); chp.connect(cg); cg.connect(this.master);
    cicada.start(); trill.start();

    this._scheduleBird();
  }

  /** One birdsong phrase, then queue the next at a random interval. */
  _scheduleBird() {
    if (!this._forest || !this.ctx) return;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 1800 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const up = Math.random() > 0.4;
      const f = base * (0.85 + Math.random() * 0.4);
      this._tone({
        type: 'sine',
        from: up ? f : f * 1.35,
        to: up ? f * 1.35 : f * 0.8,
        dur: 0.07 + Math.random() * 0.09,
        peak: 0.022 + Math.random() * 0.016,
        delay: i * (0.1 + Math.random() * 0.1)
      });
    }
    this._birdTimer = setTimeout(() => this._scheduleBird(), 3500 + Math.random() * 9000);
  }

  forestStop() {
    this._forest = false;
    clearTimeout(this._birdTimer);
  }

  /** Dropship engine bed — held under the whole crash sequence. */
  engineStart() {
    if (!this.ctx || this._engine) return;
    const t = this.ctx.currentTime;
    const o1 = this.ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 62;
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 93;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 1.2);
    o1.connect(lp); o2.connect(lp); noise.connect(lp);
    lp.connect(g); g.connect(this.master);
    o1.start(); o2.start(); noise.start();
    this._engine = { o1, o2, noise, g, lp };
  }

  engineStop() {
    if (!this._engine) return;
    const { o1, o2, noise, g } = this._engine;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o1.stop(t + 0.5); o2.stop(t + 0.5); noise.stop(t + 0.5);
    this._engine = null;
  }

  /** Cockpit master caution. */
  alarm() {
    for (let i = 0; i < 6; i++) {
      this._tone({ type: 'square', from: 880, to: 880, dur: 0.16, peak: 0.12, delay: i * 0.42 });
      this._tone({ type: 'square', from: 660, to: 660, dur: 0.16, peak: 0.1, delay: i * 0.42 + 0.2 });
    }
  }

  /** Post-impact ear ring. */
  tinnitus() {
    this._tone({ type: 'sine', from: 4200, to: 3600, dur: 3.2, peak: 0.06 });
    this._tone({ type: 'sine', from: 6300, to: 5800, dur: 2.6, peak: 0.03 });
  }

  /**
   * A human vocalization: a formant-ish pair of filtered tones with a shaped
   * envelope. Not words — the throat sound under a grunt or a cry.
   */
  _vocal({ f0 = 130, sweep = 0.7, dur = 0.3, peak = 0.3, delay = 0, breath = 0.5 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;

    // Vocal cord buzz.
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f0 * sweep, 30), t + dur);

    // Two resonant peaks approximating a vowel tract.
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 620;
    f1.Q.value = 5;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1180;
    f2.Q.value = 7;

    const g = this.ctx.createGain();
    // Fast attack, long release — the shape of an involuntary sound.
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(f1); f1.connect(f2); f2.connect(g); g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);

    // Breath noise riding on top.
    if (breath > 0) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 1600;
      nf.Q.value = 1.2;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(peak * breath * 0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
      n.connect(nf); nf.connect(ng); ng.connect(this.master);
      n.start(t, Math.random());
      n.stop(t + dur + 0.05);
    }
  }

  /** Distance falloff shared by all world-positioned sounds. */
  _falloff(dist, max = 45) {
    return Math.max(0, 1 - dist / max);
  }

  /** Raider takes a round. */
  enemyHurt(dist) {
    const v = this._falloff(dist) * 0.5;
    if (v <= 0.02) return;
    this._vocal({
      f0: 150 + Math.random() * 70, sweep: 0.55,
      dur: 0.22 + Math.random() * 0.12, peak: v, breath: 0.7
    });
  }

  /** Raider goes down — longer, falling, ending in breath. */
  enemyDeath(dist) {
    const v = this._falloff(dist) * 0.55;
    if (v <= 0.02) return;
    this._vocal({
      f0: 165 + Math.random() * 60, sweep: 0.35,
      dur: 0.62 + Math.random() * 0.25, peak: v, breath: 0.9
    });
    this._noise({ type: 'lowpass', freq: 420, dur: 0.28, peak: v * 0.45, delay: 0.4 });
  }

  /** Your own pain — closer, drier, no distance falloff. */
  playerHurt(severity = 0.5) {
    this._vocal({
      f0: 125 + Math.random() * 40, sweep: 0.5,
      dur: 0.18 + severity * 0.2, peak: 0.16 + severity * 0.22, breath: 0.85
    });
  }

  /** Heavy breathing when badly hurt. */
  playerGasp() {
    this._noise({ type: 'bandpass', freq: 900, q: 0.9, dur: 0.4, peak: 0.11 });
    this._vocal({ f0: 105, sweep: 0.85, dur: 0.35, peak: 0.05, breath: 1 });
  }

  /**
   * Supersonic crack of a round passing close by, then the muzzle report
   * arriving late from the shooter's position.
   */
  whizz(missDist) {
    const close = Math.max(0, 1 - missDist / 3.5);
    if (close <= 0.05) return;
    this._noise({ type: 'bandpass', freq: 2600 + Math.random() * 1800, q: 2.2, dur: 0.045, peak: 0.26 * close });
    this._tone({ type: 'sawtooth', from: 1900, to: 480, dur: 0.05, peak: 0.1 * close });
  }

  /** Comms squelch that tops and tails radio dialogue. */
  radioClick() {
    this._noise({ type: 'bandpass', freq: 2000, q: 3, dur: 0.035, peak: 0.07 });
    this._tone({ type: 'square', from: 1200, to: 900, dur: 0.02, peak: 0.03, delay: 0.02 });
  }

  /**
   * Faint firefights elsewhere on the deck: irregular bursts, low-passed and
   * quiet so they read as distance. Keeps the map feeling occupied.
   */
  distantBattleStart() {
    if (!this.ctx || this._distant) return;
    this._distant = true;
    const fire = () => {
      if (!this._distant) return;
      const shots = 2 + Math.floor(Math.random() * 6);
      const v = 0.02 + Math.random() * 0.03;
      for (let i = 0; i < shots; i++) {
        this._noise({
          type: 'lowpass', freq: 380 + Math.random() * 200,
          dur: 0.09, peak: v, delay: i * (0.07 + Math.random() * 0.06)
        });
      }
      this._distantTimer = setTimeout(fire, 6000 + Math.random() * 16000);
    };
    this._distantTimer = setTimeout(fire, 4000 + Math.random() * 8000);
  }

  distantBattleStop() {
    this._distant = false;
    clearTimeout(this._distantTimer);
  }

  /** Streak milestone: rising fanfare, bigger tiers get more voices. */
  streak(tier) {
    const root = 392 * Math.pow(1.06, tier); // creeps up with each tier
    const chord = [1, 1.26, 1.5, 2];
    for (let i = 0; i <= Math.min(tier + 1, 3); i++) {
      this._tone({
        type: 'triangle', from: root * chord[i], to: root * chord[i],
        dur: 0.26, peak: 0.12 - i * 0.015, delay: i * 0.055
      });
    }
    this._noise({ type: 'highpass', freq: 3800, dur: 0.14, peak: 0.06 });
  }

  /** Round striking metal: a bright ricochet whine over a hard tick. */
  impactMetal() {
    this._noise({ freq: 3400 + Math.random() * 1600, q: 4, dur: 0.05, peak: 0.12 });
    this._tone({ type: 'triangle', from: 2400 + Math.random() * 900, to: 700, dur: 0.11, peak: 0.07 });
  }

  /** Round into a tree: a dull woody knock, no ring. */
  impactWood() {
    this._noise({ type: 'bandpass', freq: 700 + Math.random() * 300, q: 1.6, dur: 0.08, peak: 0.14 });
    this._tone({ type: 'sine', from: 260, to: 130, dur: 0.07, peak: 0.09 });
  }

  /** Round into dirt: a low soft thud that swallows the shot. */
  impactSoil() {
    this._noise({ type: 'lowpass', freq: 330, dur: 0.11, peak: 0.13 });
    this._tone({ type: 'sine', from: 150, to: 70, dur: 0.09, peak: 0.06 });
  }

  /** Round clipping leaves: a papery rustle. */
  impactFoliage() {
    this._noise({ type: 'bandpass', freq: 2900, q: 0.8, dur: 0.1, peak: 0.09 });
  }

  // ---------------------------------------------------- battle royale cues

  /** Storm phase warning: a low two-tone klaxon. */
  stormWarn() {
    this._tone({ type: 'sawtooth', from: 220, to: 220, dur: 0.4, peak: 0.14 });
    this._tone({ type: 'sawtooth', from: 165, to: 165, dur: 0.5, peak: 0.14, delay: 0.42 });
  }

  /** Storm starts moving: a rising swell. */
  stormClose() {
    this._tone({ type: 'sawtooth', from: 110, to: 260, dur: 1.1, peak: 0.16 });
    this._noise({ type: 'bandpass', freq: 700, q: 0.6, dur: 1.2, peak: 0.1 });
  }

  /** Chest lid popping open. */
  chestOpen() {
    this._noise({ freq: 2200, q: 2, dur: 0.06, peak: 0.16 });
    this._tone({ type: 'sine', from: 660, to: 990, dur: 0.14, peak: 0.14, delay: 0.05 });
    this._tone({ type: 'sine', from: 990, to: 1320, dur: 0.2, peak: 0.12, delay: 0.16 });
  }

  /** Build piece snapping into place. */
  buildPlace() {
    this._noise({ type: 'lowpass', freq: 900, dur: 0.09, peak: 0.16 });
    this._tone({ type: 'square', from: 420, to: 300, dur: 0.07, peak: 0.08 });
  }

  /** Build piece shattering. */
  buildBreak() {
    this._noise({ type: 'bandpass', freq: 1100, q: 0.7, dur: 0.22, peak: 0.2 });
    this._tone({ type: 'sine', from: 200, to: 70, dur: 0.2, peak: 0.14 });
  }

  /** Harvesting tool bite — timbre depends on the material. */
  harvest(kind) {
    if (kind === 'wood') {
      this._noise({ type: 'bandpass', freq: 800, q: 1.4, dur: 0.1, peak: 0.16 });
      this._tone({ type: 'sine', from: 300, to: 160, dur: 0.08, peak: 0.1 });
    } else if (kind === 'stone') {
      this._noise({ type: 'bandpass', freq: 1500, q: 2, dur: 0.08, peak: 0.17 });
      this._tone({ type: 'triangle', from: 520, to: 260, dur: 0.09, peak: 0.09 });
    } else {
      this._noise({ freq: 3000, q: 3, dur: 0.07, peak: 0.15 });
      this._tone({ type: 'triangle', from: 1400, to: 700, dur: 0.11, peak: 0.09 });
    }
  }

  /** Transport engine bed during the ride. */
  dropshipBed(on) {
    if (!this.ctx) return;
    if (on && !this._dropBed) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 62;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      const g = this.ctx.createGain();
      g.gain.value = 0.09;
      o.connect(lp); lp.connect(g); g.connect(this.master);
      o.start();
      this._dropBed = { o, g };
    } else if (!on && this._dropBed) {
      this._dropBed.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      const bed = this._dropBed;
      setTimeout(() => { try { bed.o.stop(); } catch { /* already stopped */ } }, 1400);
      this._dropBed = null;
    }
  }

  /** Wind roar during free fall. */
  windRush(on) {
    if (!this.ctx) return;
    if (on && !this._wind) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.5);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start();
      this._wind = { src, g };
    } else if (!on && this._wind) {
      this._wind.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      const w = this._wind;
      setTimeout(() => { try { w.src.stop(); } catch { /* already stopped */ } }, 1200);
      this._wind = null;
    }
  }

  gliderDeploy() {
    this._noise({ type: 'bandpass', freq: 500, q: 0.6, dur: 0.5, peak: 0.22 });
    this._tone({ type: 'sine', from: 180, to: 90, dur: 0.4, peak: 0.1 });
  }

  /** Victory fanfare. */
  victory() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this._tone({ type: 'triangle', from: f, to: f, dur: 0.34, peak: 0.17, delay: i * 0.16 });
    });
    this._tone({ type: 'sine', from: 1047, to: 1047, dur: 0.9, peak: 0.14, delay: 0.66 });
  }

  /** Brass hitting the deck. */
  casing() {
    this._tone({ type: 'triangle', from: 2600 + Math.random() * 1400, to: 1500, dur: 0.045, peak: 0.045 });
    this._noise({ freq: 5200, q: 6, dur: 0.03, peak: 0.03 });
  }

  /** Blade whoosh. */
  swing() {
    this._noise({ type: 'bandpass', freq: 1600, q: 1.2, dur: 0.14, peak: 0.22 });
    this._tone({ type: 'sine', from: 900, to: 300, dur: 0.12, peak: 0.06 });
  }

  /** Boss telegraph: a low mechanical bellow. */
  roar() {
    this._tone({ type: 'sawtooth', from: 70, to: 45, dur: 0.7, peak: 0.4 });
    this._tone({ type: 'square', from: 110, to: 60, dur: 0.5, peak: 0.2, delay: 0.08 });
    this._noise({ type: 'lowpass', freq: 260, dur: 0.6, peak: 0.3 });
  }

  npcTalk() {
    this._tone({ type: 'square', from: 340, to: 300, dur: 0.05, peak: 0.06 });
    this._tone({ type: 'square', from: 380, to: 340, dur: 0.05, peak: 0.05, delay: 0.07 });
  }

  wave() {
    this._tone({ type: 'sawtooth', from: 196, to: 196, dur: 0.7, peak: 0.13 });
    this._tone({ type: 'sawtooth', from: 247, to: 247, dur: 0.7, peak: 0.1, delay: 0.05 });
  }

  death() { this._tone({ type: 'sawtooth', from: 420, to: 50, dur: 1.1, peak: 0.35 }); }

  /** Low ambient hum + wind bed; started once per session. */
  ambientStart() {
    if (!this.ctx || this._ambient) return;
    this._ambient = true;

    const hum = this.ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 55;
    const hum2 = this.ctx.createOscillator();
    hum2.type = 'sawtooth';
    hum2.frequency.value = 55.6;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 190;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.035;
    hum.connect(lp); hum2.connect(lp); lp.connect(hg); hg.connect(this.master);
    hum.start(); hum2.start();

    const wind = this.ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    const wg = this.ctx.createGain();
    wg.gain.value = 0.018;
    wind.connect(wf); wf.connect(wg); wg.connect(this.master);
    wind.start();

    // Slow LFO breathing on the wind.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.01;
    lfo.connect(lfoG); lfoG.connect(wg.gain);
    lfo.start();
  }
}
