/**
 * GTAZ rulesets — FUN and REAL.
 *
 * The 7x speed and the boosted health are a laugh, but they are also a cheat,
 * and a game where the cheat is permanently on has no difficulty curve left:
 * nothing on the street can catch you, nothing underground can corner you, and
 * the police chase stops being a chase. So they become a MODE you pick rather
 * than a constant baked into the movement code.
 *
 * REAL is the game as designed. Stock speed, stock health, stock cars. Every
 * number the rest of the codebase was originally tuned against.
 *
 * FUN is the sandbox. Speed and health are dials you set yourself, anywhere
 * from stock up to seven times, and your car gets the same multiplier with a
 * flat 110 m/s^2 of acceleration so it can actually use it.
 *
 * WHY THIS IS ONE MODULE. The multipliers reach into player movement, vehicle
 * performance, police pursuit speed, footstep cadence, camera bob and the
 * physics substep budget. Scattering `* 7` through all of those is how you end
 * up with a half-applied cheat — a 7x sprint that still triggers footsteps at
 * the walking stride, which is exactly the bug this started as. One resolver,
 * read live, means switching modes can never leave half the game boosted.
 *
 * Only GTAZ has these. Skirmish, career and the battleground are always REAL;
 * they are balanced experiences and a speed dial would wreck them.
 */

/** Nothing boosted. Also what every non-GTAZ mode gets, unconditionally. */
export const STOCK = Object.freeze({
  id: 'real',
  speed: 1,
  health: 1,
  car: 1,
  carAccel: null,      // null = leave the chassis' own figure alone
  police: true,
  label: 'REAL'
});

/** Hard ceiling on the dials. Seven is where the user asked them to stop. */
export const MAX_MULT = 7;

/** Acceleration a boosted car gets, m/s^2, regardless of chassis. */
export const FUN_CAR_ACCEL = 110;

/**
 * Resolve the active ruleset from a game.
 *
 * Reads live rather than being cached at launch, so flipping the mode in the
 * menu takes effect on the next frame without a world rebuild.
 */
export function resolveRules(game) {
  if (!game || !game.isGTAZ) return STOCK;
  const s = game.settings || {};
  if (s.gtazRules !== 'fun') return STOCK;
  const clamp = (v, d) => {
    const n = Number.isFinite(v) ? v : d;
    return Math.min(MAX_MULT, Math.max(1, n));
  };
  const speed = clamp(s.funSpeed, MAX_MULT);
  return {
    id: 'fun',
    speed,
    health: clamp(s.funHealth, MAX_MULT),
    // The car rides the same dial as your legs. Being able to outrun your own
    // car on foot is the kind of detail that makes a sandbox feel unfinished.
    car: speed,
    carAccel: FUN_CAR_ACCEL,
    // Off unless asked for. FUN is the sandbox; the law is opt-in there.
    police: s.funPolice === true,
    label: 'FUN'
  };
}

export const RULESETS = [
  {
    id: 'real',
    name: 'REAL',
    blurb: 'The game as designed. Stock speed, stock health, stock cars. '
      + 'The police can catch you and the caves can kill you.'
  },
  {
    id: 'fun',
    name: 'FUN',
    blurb: 'Sandbox. Set your own speed and health, up to seven times stock, '
      + 'and your car matches. Nothing out there can keep up.'
  }
];
