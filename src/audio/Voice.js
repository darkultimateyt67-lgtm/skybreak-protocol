/**
 * Voice — spoken dialogue through the browser's built-in speech engine.
 *
 * No audio files ship with the game: every line is synthesized at runtime.
 * Each character gets a voice profile (a preferred system voice plus a pitch
 * and rate offset) so Daniel, the survivors and the raiders all sound like
 * different people rather than one narrator.
 *
 * Story lines queue so they never talk over each other. Combat barks are
 * "interrupt-if-busy, otherwise drop" — a raider yelling CONTACT should never
 * delay a plot beat, and stale callouts are worse than no callout.
 */

const PROFILES = {
  // Gravelly, steady — your surviving squadmate.
  DANIEL: { pitch: 0.72, rate: 0.97, prefer: ['male', 'david', 'guy', 'daniel', 'alex'], gender: 'male' },
  'SGT. DANIEL REYES': { pitch: 0.72, rate: 0.97, prefer: ['male', 'david', 'guy', 'daniel', 'alex'], gender: 'male' },

  // Survivors.
  'DR. IVY OKONKWO': { pitch: 1.18, rate: 1.0, prefer: ['female', 'zira', 'aria', 'jenny', 'samantha'], gender: 'female' },
  'WARDEN PIKE': { pitch: 0.82, rate: 0.9, prefer: ['male', 'mark', 'george', 'fred'], gender: 'male' },
  'DR. MAREN SOL': { pitch: 1.25, rate: 1.04, prefer: ['female', 'zira', 'aria', 'hazel'], gender: 'female' },
  'CHIEF ODUYA': { pitch: 0.68, rate: 0.88, prefer: ['male', 'george', 'mark'], gender: 'male' },
  'FOREMAN RIGGS': { pitch: 0.75, rate: 0.93, prefer: ['male', 'mark', 'david'], gender: 'male' },
  'SPC. TANAKA': { pitch: 1.1, rate: 1.08, prefer: ['female', 'zira', 'jenny'], gender: 'female' },
  'CAPT. IDRIS': { pitch: 1.05, rate: 0.95, prefer: ['female', 'zira', 'aria'], gender: 'female' },
  'ENSIGN VALE': { pitch: 1.3, rate: 1.1, prefer: ['female', 'jenny', 'hazel'], gender: 'female' },

  // Systems and hostiles.
  TACNET: { pitch: 1.4, rate: 1.16, prefer: ['zira', 'female', 'microsoft'], robotic: true },
  HELIOS: { pitch: 0.5, rate: 0.82, prefer: ['male', 'david'], robotic: true },
  COMMS: { pitch: 1.0, rate: 1.02, prefer: ['male', 'david'] },
  RAIDER: { pitch: 0.88, rate: 1.14, prefer: ['male', 'mark', 'george'], gender: 'male' }
};

export class Voice {
  constructor(game) {
    this.game = game;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.synth = this.supported ? window.speechSynthesis : null;
    this.voices = [];
    this.enabled = true;
    this._queue = [];
    this._speaking = false;
    this._assigned = new Map();
    this._lastBark = 0;
    /** Who is talking right now, so their face can move. */
    this.speakingWho = null;

    if (!this.supported) return;
    this._loadVoices();
    // Chrome populates the list asynchronously.
    this.synth.addEventListener?.('voiceschanged', () => this._loadVoices());
  }

  _loadVoices() {
    const all = this.synth.getVoices() || [];
    // Prefer local voices — remote ones stall on first use.
    this.voices = all.filter((v) => v.lang && v.lang.startsWith('en'));
    if (!this.voices.length) this.voices = all;
    this._assigned.clear();
  }

  /** Pick (and remember) the best system voice for a speaker. */
  _voiceFor(who) {
    if (this._assigned.has(who)) return this._assigned.get(who);
    const p = PROFILES[who] || PROFILES.COMMS;
    let best = null;
    let bestScore = -1;
    for (const v of this.voices) {
      const name = (v.name || '').toLowerCase();
      let score = 0;
      for (let i = 0; i < (p.prefer || []).length; i++) {
        if (name.includes(p.prefer[i])) score += (p.prefer.length - i) * 2;
      }
      if (v.localService) score += 3;
      // Spread characters across whatever voices exist so two people who
      // score identically don't end up sounding the same.
      if ([...this._assigned.values()].includes(v)) score -= 4;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    this._assigned.set(who, best);
    return best;
  }

  /** Master volume follows the game's audio slider. */
  get _volume() {
    return Math.min(1, (this.game.settings.volume ?? 0.7) * 1.35);
  }

  /**
   * Speak a story line. These queue: nothing gets talked over.
   * @param {string} text  what to say
   * @param {string} who   speaker key, matched against PROFILES
   */
  say(text, who = 'COMMS') {
    if (!this.supported || !this.enabled || !this.game.settings.voice) return;
    if (this._volume <= 0) return;
    this._queue.push({ text, who });
    if (!this._speaking) this._next();
  }

  /**
   * Combat callout. Never queues — if someone's already talking it's dropped,
   * because a bark that arrives three seconds late is just noise.
   */
  bark(text, who = 'RAIDER', minGap = 1.6) {
    if (!this.supported || !this.enabled || !this.game.settings.voice) return;
    if (this._speaking || this._queue.length) return;
    const now = performance.now() * 0.001;
    if (now - this._lastBark < minGap) return;
    this._lastBark = now;
    this._speak({ text, who, bark: true });
  }

  _next() {
    const item = this._queue.shift();
    if (!item) { this._speaking = false; return; }
    this._speak(item);
  }

  _speak(item) {
    const p = PROFILES[item.who] || PROFILES.COMMS;
    // Strip the typographic quotes/ellipses TTS reads badly.
    const clean = String(item.text)
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '')
      .replace(/…/g, '...')
      .replace(/[▸·—]/g, ',');

    const u = new SpeechSynthesisUtterance(clean);
    const v = this._voiceFor(item.who);
    if (v) u.voice = v;
    u.pitch = Math.max(0, Math.min(2, p.pitch ?? 1));
    u.rate = Math.max(0.1, Math.min(2, (p.rate ?? 1) * (item.bark ? 1.15 : 1)));
    u.volume = this._volume * (item.bark ? 0.85 : 1);

    this._speaking = true;
    this.speakingWho = item.who;
    const done = () => {
      this.speakingWho = null;
      if (item.bark) { this._speaking = false; return; }
      this._next();
    };
    u.onend = done;
    u.onerror = done;

    // Some engines never fire onend reliably; estimate the duration from the
    // text so a mouth can't get stuck open if the event is dropped.
    const est = Math.max(700, (clean.length / 14) * 1000 / u.rate);
    clearTimeout(this._failsafe);
    this._failsafe = setTimeout(() => {
      if (this.speakingWho === item.who) this.speakingWho = null;
    }, est + 1200);

    // Radio squelch under anything coming over comms.
    if (!item.bark && this.game.audio && p.robotic !== undefined) {
      this.game.audio.radioClick();
    }

    try {
      this.synth.speak(u);
    } catch {
      this._speaking = false;
    }
  }

  /** Kill everything in flight — used on death, pause and menu returns. */
  stop() {
    this._queue.length = 0;
    this._speaking = false;
    this.speakingWho = null;
    clearTimeout(this._failsafe);
    if (this.supported) {
      try { this.synth.cancel(); } catch { /* already idle */ }
    }
  }
}
