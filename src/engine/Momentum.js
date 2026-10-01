/**
 * Momentum — the feedback loop that makes a firefight feel good.
 *
 * Kills inside a short window chain into a streak. Streaks pay escalating
 * credit bonuses, announce themselves, and build ADRENALINE. Adrenaline is
 * the reward: while it's up, time dilates slightly, you move faster and you
 * reload faster — so playing aggressively literally makes you better, and
 * the game gets more fun the harder you push it.
 *
 * Let the chain lapse and adrenaline bleeds away, so it has to be earned
 * again rather than hoarded.
 */

const STREAKS = [
  { n: 2, name: 'DOUBLE', bonus: 40 },
  { n: 3, name: 'TRIPLE KILL', bonus: 90 },
  { n: 4, name: 'RAMPAGE', bonus: 160 },
  { n: 5, name: 'UNSTOPPABLE', bonus: 260 },
  { n: 7, name: 'BLOODBATH', bonus: 450 },
  { n: 10, name: 'LEGENDARY', bonus: 900 },
  { n: 15, name: 'GODLIKE', bonus: 2000 }
];

/** How long after a kill the chain stays open. */
const CHAIN_WINDOW = 4.0;

export class Momentum {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.streak = 0;
    this.best = 0;
    this.chainTimer = 0;
    this.adrenaline = 0;      // 0..1
    this.timeScale = 1;
    this._lastTier = 0;
    this._flowTime = 0;
  }

  /** True while adrenaline is high enough to grant its perks. */
  get inFlow() {
    return this.adrenaline > 0.45;
  }

  /** Movement multiplier granted by adrenaline. */
  get speedBonus() {
    return 1 + this.adrenaline * 0.16;
  }

  /** Reload/handling speed multiplier. */
  get handlingBonus() {
    return 1 + this.adrenaline * 0.3;
  }

  /**
   * Register a kill. Returns the streak tier reached, if any.
   */
  onKill(enemy, head) {
    const game = this.game;
    this.chainTimer = CHAIN_WINDOW;
    this.streak++;
    this.best = Math.max(this.best, this.streak);

    // Adrenaline builds per kill, faster on headshots and against big targets.
    const gain = 0.22 + (head ? 0.12 : 0) + (enemy && enemy.isBoss ? 0.4 : 0);
    this.adrenaline = Math.min(1, this.adrenaline + gain);

    // Announce whichever tier this kill just hit.
    const tier = STREAKS.filter((s) => s.n === this.streak)[0];
    if (tier) {
      this._lastTier = this.streak;
      game.addCredits(tier.bonus);
      game.addScore(tier.bonus);
      game.hud.streak(tier.name, tier.bonus, this.streak);
      game.audio.streak(STREAKS.indexOf(tier));
      // The big ones get called out loud.
      if (this.streak >= 5) game.voice.bark(tier.name.replace('_', ' '), 'TACNET', 0.2);
    } else {
      game.hud.streakTick(this.streak);
    }
    return tier;
  }

  /** Taking damage costs you momentum — pressure works both ways. */
  onPlayerHit(amount) {
    this.adrenaline = Math.max(0, this.adrenaline - amount * 0.012);
    if (this.adrenaline < 0.2) this.streak = 0;
  }

  update(dt) {
    // Chain window closes.
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) {
        if (this.streak >= 2) this.game.hud.streakEnd(this.streak);
        this.streak = 0;
        this._lastTier = 0;
      }
    }

    // Adrenaline decays; the higher it is the slower it drains, so a big run
    // keeps paying out for a while.
    const drain = this.adrenaline > 0.7 ? 0.11 : 0.19;
    this.adrenaline = Math.max(0, this.adrenaline - drain * dt);

    // Time dilation while in flow — subtle, just enough to feel superhuman.
    const target = this.inFlow ? 1 - (this.adrenaline - 0.45) * 0.22 : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * 4);

    // Flow-state visuals: warm edge glow that pulses with your heartbeat.
    if (this.inFlow) this._flowTime += dt;
    this.game.hud.setAdrenaline(this.adrenaline, this.inFlow, this._flowTime);
  }
}
