import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * WeaponTraits — the runtime for weapon special features.
 *
 * These are deliberately real: an explosive round genuinely splashes nearby
 * targets, a ricochet actually reflects off the surface normal and keeps
 * travelling, a chain arc searches for a second body and hits it. Nothing
 * here is a particle effect standing in for a mechanic.
 *
 * Everything works against anything that exposes `position`, `alive` and
 * `damage()`, so campaign enemies and battle-royale bots are both valid
 * targets without special-casing.
 */
export class WeaponTraits {
  constructor(game) {
    this.game = game;
    this.burning = new Map();   // target -> { until, dps, source }
    this.chilled = new Map();   // target -> { until, slow }
    this.charge = 0;            // 0..1 for charge-shot weapons
    this.heat = 0;              // 0..1 for overcharge ramping
  }

  reset() {
    this.burning.clear();
    this.chilled.clear();
    this.charge = 0;
    this.heat = 0;
  }

  /** Everything alive that a trait could hit, from whichever mode is running. */
  _targets() {
    const g = this.game;
    if (g.isBR && g.br && g.br.bots) return g.br.bots;
    return g.enemies ? g.enemies.list : [];
  }

  /** Nearest live target to a point, excluding some, within range. */
  _nearest(point, range, exclude = null) {
    let best = null;
    let bestD = range * range;
    for (const t of this._targets()) {
      if (!t.alive || t === exclude) continue;
      _v.set(t.position.x, t.position.y + 1.0, t.position.z);
      const d = _v.distanceToSquared(point);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /** Damage everything inside a sphere, falling off toward the rim. */
  _splash(point, radius, damage, weaponName, source) {
    const g = this.game;
    let hits = 0;
    for (const t of this._targets()) {
      if (!t.alive) continue;
      _v.set(t.position.x, t.position.y + 1.0, t.position.z);
      const d = _v.distanceTo(point);
      if (d > radius) continue;
      const falloff = 1 - (d / radius) * 0.7;
      t.damage(damage * falloff, false, weaponName, source);
      hits++;
    }
    // The player is not immune to their own explosives.
    const pd = g.player.position.distanceTo(point);
    if (pd < radius * 0.85 && g.player.alive) {
      g.player.damage(damage * 0.4 * (1 - pd / (radius * 0.85)), point);
    }
    return hits;
  }

  // ------------------------------------------------------- shot modifiers

  /**
   * Adjust the outgoing direction before the ray is cast.
   * Used by seeker rounds.
   */
  aimAssist(def, origin, dir) {
    const trait = def.trait;
    if (!trait || trait.id !== 'homing') return dir;
    // Find a target roughly in front and bend toward it.
    let best = null;
    let bestDot = 1 - (trait.cone ?? 0.22);
    for (const t of this._targets()) {
      if (!t.alive) continue;
      _v.set(t.position.x, t.position.y + 1.05, t.position.z).sub(origin);
      const dist = _v.length();
      if (dist > 90 || dist < 1) continue;
      _v.divideScalar(dist);
      const dot = _v.dot(dir);
      if (dot > bestDot) { bestDot = dot; best = _v.clone(); }
    }
    if (best) dir.lerp(best, 0.65).normalize();
    return dir;
  }

  /** Damage multiplier applied before the shot lands. */
  damageMultiplier(def) {
    const trait = def.trait;
    if (!trait) return 1;
    if (trait.id === 'charge') {
      // Charge scales damage from 1x up to the trait's max.
      return 1 + this.charge * ((trait.max ?? 3) - 1);
    }
    if (trait.id === 'overcharge') {
      return 1 + Math.min(this.heat * (trait.ramp ?? 0.045) * 10, (trait.cap ?? 1.8) - 1);
    }
    return 1;
  }

  /** Recoil multiplier — siege weapons brace hard when aiming. */
  recoilMultiplier(def, adsT) {
    const trait = def.trait;
    if (trait && trait.id === 'siege') {
      return 1 - adsT * (1 - (trait.adsRecoil ?? 0.15));
    }
    return 1;
  }

  // ------------------------------------------------------- impact effects

  /**
   * Called when a shot connects with a target.
   * @returns {number} extra targets consumed (for piercing bookkeeping)
   */
  onHitTarget(def, target, point, dir, damageDealt, head) {
    const trait = def.trait;
    const g = this.game;
    if (!trait || trait.id === 'none') return 0;

    switch (trait.id) {
      case 'explosive': {
        this._splash(point, trait.radius ?? 3.2, damageDealt * (trait.splash ?? 0.55), def.name, g.player);
        g.effects.explosion(point, trait.color);
        g.audio.explosion?.();
        break;
      }
      case 'cluster': {
        // Submunitions scatter and detonate around the impact.
        const n = trait.bomblets ?? 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random();
          _v.set(point.x + Math.cos(a) * 2.2, point.y + 0.4, point.z + Math.sin(a) * 2.2);
          this._splash(_v, trait.radius ?? 2.4, damageDealt * 0.32, def.name, g.player);
          g.effects.burst(_v, { count: 10, color: trait.color, speed: 5, life: 0.4, gravity: 14 });
        }
        g.audio.explosion?.();
        break;
      }
      case 'chain': {
        // Arc to a nearby second body.
        let from = target;
        let dmg = damageDealt * (trait.falloff ?? 0.55);
        for (let j = 0; j < (trait.jumps ?? 1); j++) {
          _v.set(from.position.x, from.position.y + 1.0, from.position.z);
          const next = this._nearest(_v, trait.range ?? 9, from);
          if (!next) break;
          _v2.set(next.position.x, next.position.y + 1.0, next.position.z);
          g.effects.tracer(_v, _v2, trait.color);
          g.effects.burst(_v2, { count: 10, color: trait.color, speed: 4, life: 0.3 });
          next.damage(dmg, false, def.name, g.player);
          from = next;
          dmg *= trait.falloff ?? 0.55;
        }
        break;
      }
      case 'incendiary': {
        this.burning.set(target, {
          until: performance.now() * 0.001 + (trait.time ?? 3),
          dps: trait.dot ?? 22,
          name: def.name
        });
        g.effects.burst(point, { count: 10, color: trait.color, speed: 2.4, life: 0.6, gravity: -3 });
        break;
      }
      case 'cryo': {
        this.chilled.set(target, {
          until: performance.now() * 0.001 + (trait.time ?? 2.5),
          slow: trait.slow ?? 0.45
        });
        g.effects.burst(point, { count: 12, color: trait.color, speed: 3, life: 0.5, gravity: 3 });
        break;
      }
      case 'shock': {
        // Strips shields hard. BR bots and the player both carry shields.
        if (target.shield != null && target.shield > 0) {
          const extra = damageDealt * ((trait.shieldMul ?? 2.4) - 1);
          target.shield = Math.max(0, target.shield - extra);
        }
        g.effects.burst(point, { count: 14, color: trait.color, speed: 6, life: 0.3 });
        break;
      }
      case 'vamp': {
        const heal = damageDealt * (trait.leech ?? 0.16);
        const p = g.player;
        if (p.alive && p.health < p.maxHealth) {
          p.health = Math.min(p.maxHealth, p.health + heal);
          g.effects.burst(point, { count: 6, color: trait.color, speed: 2, life: 0.5, gravity: -4 });
        }
        break;
      }
      case 'flechette': {
        // Needles cause a short bleed on top of the pellet damage.
        this.burning.set(target, {
          until: performance.now() * 0.001 + 2,
          dps: trait.bleed ?? 10,
          name: def.name
        });
        break;
      }
      default:
        break;
    }
    return 0;
  }

  /**
   * Called when a shot hits world geometry. Returns a follow-up ray for
   * ricochet weapons, or null.
   */
  onHitWorld(def, point, normal, dir, bounceCount) {
    const trait = def.trait;
    const g = this.game;
    if (!trait) return null;

    if (trait.id === 'explosive' || trait.id === 'cluster') {
      this._splash(point, trait.radius ?? 3.0, def.damage * 0.5, def.name, g.player);
      g.effects.explosion(point, trait.color);
      g.audio.explosion?.();
      return null;
    }

    if (trait.id === 'ricochet' && bounceCount < (trait.bounces ?? 2)) {
      // Reflect around the surface normal and keep going.
      const reflected = dir.clone().reflect(normal).normalize();
      // Nudge off the surface so the next cast doesn't re-hit it.
      const from = point.clone().addScaledVector(normal, 0.06);
      g.effects.burst(point, { count: 6, color: trait.color, speed: 4, life: 0.25, dir: normal, spread: 0.8 });
      return { origin: from, dir: reflected };
    }
    return null;
  }

  // ------------------------------------------------------------ per-frame

  update(dt, firing, def) {
    const g = this.game;
    const now = performance.now() * 0.001;

    // Charge builds while the trigger is held on a charge weapon.
    if (def && def.trait && def.trait.id === 'charge') {
      if (firing) this.charge = Math.min(1, this.charge + dt / (def.trait.time ?? 0.9));
      // Charge is spent by the shot itself (see consumeCharge).
    } else {
      this.charge = 0;
    }

    // Overcharge heat ramps while firing, vents when you stop.
    if (def && def.trait && def.trait.id === 'overcharge') {
      this.heat = firing
        ? Math.min(1, this.heat + dt * 0.9)
        : Math.max(0, this.heat - dt * 1.4);
    } else {
      this.heat = 0;
    }

    // Burning targets tick damage.
    for (const [target, b] of this.burning) {
      if (!target.alive || now > b.until) { this.burning.delete(target); continue; }
      target.damage(b.dps * dt, false, b.name, g.player);
      if (Math.random() < dt * 8) {
        _v.set(target.position.x, target.position.y + 1.0 + Math.random(), target.position.z);
        g.effects.burst(_v, { count: 1, color: 0xff7a3d, speed: 0.6, life: 0.5, gravity: -3 });
      }
    }

    // Chilled targets expire.
    for (const [target, c] of this.chilled) {
      if (!target.alive || now > c.until) this.chilled.delete(target);
    }
  }

  /** Movement multiplier applied to a chilled target by the AI. */
  slowFactor(target) {
    const c = this.chilled.get(target);
    return c ? 1 - c.slow : 1;
  }

  /** Spend the stored charge when a charge weapon fires. */
  consumeCharge() {
    const c = this.charge;
    this.charge = 0;
    return c;
  }
}
