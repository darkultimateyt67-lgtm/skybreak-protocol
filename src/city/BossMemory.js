/**
 * BossMemory — bosses that learn from the one you killed last.
 *
 * The idea is not "the next boss has more health". That is a difficulty
 * slider and players see through it immediately. This watches HOW you win and
 * counters the specific thing that worked:
 *
 *   You killed it from range          -> the next one closes distance and
 *                                        refuses to sit still at range
 *   You killed it up close            -> the next one keeps its distance and
 *                                        shoots rather than brawls
 *   You landed a lot of headshots     -> the next one moves erratically, so a
 *                                        head is a harder thing to track
 *   You killed it very fast           -> the next one is tougher and armoured
 *   You never took a scratch          -> the next one hits harder
 *   You hid behind cover              -> the next one flushes you out
 *
 * Each lesson is stored as a named counter with a strength that grows every
 * time the same tactic beats a boss again. Beat three in a row at long range
 * and the fourth will be in your face from the first second.
 *
 * The memory persists across a session, so the arc is visible: the first boss
 * is a plain fight and the fifth is built specifically against you.
 */

const LESSONS = {
  closeTheGap: {
    label: 'CLOSES THE GAP',
    note: 'It has watched you win from range. It will not let you.'
  },
  keepAway: {
    label: 'KEEPS ITS DISTANCE',
    note: 'It has watched you win up close. It will not come near.'
  },
  evasive: {
    label: 'EVASIVE',
    note: 'It has seen too many headshots. It will not hold still.'
  },
  armoured: {
    label: 'ARMOURED',
    note: 'You ended the last one quickly. This one is built to last.'
  },
  hitsHarder: {
    label: 'HITS HARDER',
    note: 'You walked away clean last time. Not this time.'
  },
  flushesCover: {
    label: 'FLUSHES COVER',
    note: 'It knows where you like to hide.'
  }
};

export class BossMemory {
  constructor(game) {
    this.game = game;
    this.defeated = 0;
    // lesson id -> strength (0..1, grows each time the tactic works again)
    this.lessons = new Map();
    this._fight = null;
  }

  /** Begin watching a fight. Called when a boss spawns. */
  beginFight(boss) {
    this._fight = {
      boss,
      started: performance.now(),
      shots: 0,
      headshots: 0,
      rangeSum: 0,
      rangeSamples: 0,
      playerStartHealth: this.game.player?.health ?? 100,
      damageTaken: 0,
      framesInCover: 0,
      frames: 0
    };
  }

  /** Called every frame while a boss is alive. */
  observe(dt, boss) {
    const f = this._fight;
    if (!f || !boss || !boss.alive) return;
    const p = this.game.player;
    if (!p) return;
    f.frames++;

    // Engagement range, sampled a few times a second rather than every frame.
    if (f.frames % 10 === 0) {
      f.rangeSum += boss.position.distanceTo(p.position);
      f.rangeSamples++;
      // Cover: no clear line from the boss to the player.
      const hit = this.game.physics.raycast(
        boss.position.clone().setY(boss.position.y + 1.2),
        p.position.clone().sub(boss.position).normalize(),
        boss.position.distanceTo(p.position)
      );
      if (hit) f.framesInCover++;
    }
  }

  /** Record a hit the player landed on the boss. */
  recordHit(head) {
    const f = this._fight;
    if (!f) return;
    f.shots++;
    if (head) f.headshots++;
  }

  /** Record damage the boss dealt to the player. */
  recordPlayerDamage(amount) {
    const f = this._fight;
    if (f) f.damageTaken += amount;
  }

  /**
   * The boss died. Work out what beat it and file the lesson.
   * Returns the list of lessons learned this fight, for the toast.
   */
  endFight() {
    const f = this._fight;
    this._fight = null;
    if (!f) return [];
    this.defeated++;

    const seconds = (performance.now() - f.started) / 1000;
    const avgRange = f.rangeSamples ? f.rangeSum / f.rangeSamples : 20;
    const headRatio = f.shots ? f.headshots / f.shots : 0;
    const coverRatio = f.rangeSamples ? f.framesInCover / f.rangeSamples : 0;

    const learned = [];
    const learn = (id, amount) => {
      const cur = this.lessons.get(id) || 0;
      this.lessons.set(id, Math.min(1, cur + amount));
      learned.push(id);
    };

    // Range is the biggest tell, so it always produces a lesson one way or
    // the other — there is no neutral distance to fight at.
    if (avgRange > 22) learn('closeTheGap', 0.34);
    else if (avgRange < 10) learn('keepAway', 0.34);

    if (headRatio > 0.3) learn('evasive', 0.3);
    if (seconds < 25) learn('armoured', 0.3);
    if (f.damageTaken < 20) learn('hitsHarder', 0.3);
    if (coverRatio > 0.45) learn('flushesCover', 0.3);

    return learned;
  }

  /**
   * Build the stat block for the next boss, from everything learned so far.
   * `base` is the unmodified profile.
   */
  shape(base) {
    const L = (id) => this.lessons.get(id) || 0;
    const tier = this.defeated;

    const out = {
      ...base,
      // A baseline climb, so later bosses are harder even if you keep varying
      // your tactics and teach it nothing specific.
      hp: Math.round(base.hp * (1 + tier * 0.18 + L('armoured') * 0.55)),
      damage: base.damage * (1 + L('hitsHarder') * 0.6),
      speed: base.speed * (1 + L('closeTheGap') * 0.45 + L('evasive') * 0.2),
      // How close it wants to be. Both lessons pull in opposite directions,
      // which is the point: it moves to wherever you are not comfortable.
      preferredRange: base.preferredRange
        * (1 - L('closeTheGap') * 0.7)
        * (1 + L('keepAway') * 1.8),
      // Erratic strafing, so a tracked head is a moving target.
      jitter: L('evasive'),
      // Will it push you out of cover rather than trading shots?
      pushesCover: L('flushesCover') > 0.3,
      tier
    };
    out.traits = [...this.lessons.entries()]
      .filter(([, v]) => v > 0.15)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => ({ id, strength: v, ...LESSONS[id] }));
    return out;
  }

  /** A short line describing what the next boss has learned. */
  describe() {
    const traits = [...this.lessons.entries()]
      .filter(([, v]) => v > 0.15)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => LESSONS[id].label);
    if (!traits.length) return null;
    return traits.join(' · ');
  }

  reset() {
    this.defeated = 0;
    this.lessons.clear();
    this._fight = null;
  }
}

export { LESSONS };
