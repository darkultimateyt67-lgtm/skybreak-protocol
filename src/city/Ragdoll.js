import * as THREE from 'three';
import { Body } from '../physics/Rigid.js';

/**
 * People, after.
 *
 * A pedestrian who was hit by a car used to play the same two-second
 * animation every time: rotate ninety degrees about X, slide the head and the
 * limbs down by fixed amounts, lie flat. It did not matter what hit them, how
 * fast it was going, or which direction it came from — a bus at fifty and a
 * shove at walking pace produced the identical, axis-aligned corpse, always
 * facing the same way, always exactly where the person had been standing.
 *
 * This replaces it with six rigid bodies held together by distance joints:
 * torso, head, two legs, two arms. They are thrown with the momentum of
 * whatever hit them, and from that moment on they are simply more objects in
 * the same solver as the cones and the wreckage. They tumble, skid on the
 * road, fold over a kerb, come to rest against a wall, and get picked up
 * again by the next explosion.
 *
 * WHY A POOL. The bodies and the joints are built once and reused. A ragdoll
 * costs six bodies and five joints while it is active and nothing at all when
 * it is not, so the limit is on how many people can be down AT ONCE rather
 * than on how many can die — and the pool hands back its oldest ragdoll when
 * it runs out, which is the behaviour you want during a rampage.
 *
 * The joints are deliberately loose. Real ragdolls limit how far a joint can
 * bend; these do not, so a limb can end up somewhere an anatomist would
 * object to. At the distance a pedestrian is ever actually looked at, limbs
 * that stay attached and swing with real weight read as a body, and the cost
 * of the alternative — a full constrained skeleton — is not worth paying for
 * forty background characters.
 */

const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();

/** Half-extents, masses and rest offsets of one person, in metres. */
const PLAN = {
  torso: { half: [0.21, 0.31, 0.12], mass: 34, at: [0, 1.06, 0] },
  head: { half: [0.115, 0.13, 0.115], mass: 5, at: [0, 1.50, 0] },
  legL: { half: [0.08, 0.40, 0.09], mass: 12, at: [0.11, 0.40, 0] },
  legR: { half: [0.08, 0.40, 0.09], mass: 12, at: [-0.11, 0.40, 0] },
  armL: { half: [0.065, 0.29, 0.075], mass: 4, at: [0.30, 1.06, 0] },
  armR: { half: [0.065, 0.29, 0.075], mass: 4, at: [-0.30, 1.06, 0] }
};

// Each joint: which two parts, and the anchor on each in its own frame.
const LINKS = [
  ['torso', 'head', [0, 0.31, 0], [0, -0.13, 0]],
  ['torso', 'legL', [0.11, -0.31, 0], [0, 0.40, 0]],
  ['torso', 'legR', [-0.11, -0.31, 0], [0, 0.40, 0]],
  ['torso', 'armL', [0.21, 0.24, 0], [0, 0.29, 0]],
  ['torso', 'armR', [-0.21, 0.24, 0], [0, 0.29, 0]]
];

const NAMES = Object.keys(PLAN);

export class RagdollPool {
  constructor(rigid, count = 7) {
    this.rigid = rigid;
    this.dolls = [];
    for (let i = 0; i < count; i++) this.dolls.push(this._build(i));
    this._next = 0;
  }

  _build(index) {
    const parts = {};
    for (const name of NAMES) {
      const p = PLAN[name];
      const b = new Body({
        half: new THREE.Vector3(p.half[0], p.half[1], p.half[2]),
        mass: p.mass,
        // A person is not bouncy and does not slide far.
        restitution: 0.04,
        friction: 0.85,
        drag: 0.3,
        angDrag: 0.8,
        // One group per ragdoll. Now that bodies are solid against each other,
        // a shoulder would otherwise be solid against the arm hanging off it
        // and the pair would fight the joint holding them together until one
        // of them won. Different ragdolls DO collide, so a pile of people is
        // a pile.
        group: `rag${index}`
      });
      b.alive = false;
      b.sleeping = true;
      // Tells the solver to push the mesh after the joints have run, not
      // only after the contacts.
      b.joined = true;
      b.pos.set(0, -9999, 0);
      this.rigid.add(b);
      parts[name] = b;
    }
    for (const [a, c, ra, rb] of LINKS) {
      this.rigid.addJoint(
        parts[a], parts[c],
        new THREE.Vector3(ra[0], ra[1], ra[2]),
        new THREE.Vector3(rb[0], rb[1], rb[2]),
        0
      );
    }
    return { parts, live: false, age: 0 };
  }

  /** The next free ragdoll, or the oldest live one if they are all busy. */
  _take() {
    let oldest = this.dolls[0], oldestAge = -1;
    for (const d of this.dolls) {
      if (!d.live) return d;
      if (d.age > oldestAge) { oldestAge = d.age; oldest = d; }
    }
    this.release(oldest);
    return oldest;
  }

  /**
   * Knock someone down.
   *
   * @param x,y,z   where they were standing (y is the ground under them)
   * @param vel     the momentum they are given, usually the thing that hit them
   * @param yaw     which way they were facing
   * @param opts.spin extra tumble, for a glancing hit
   */
  spawn(x, y, z, vel, yaw = 0, opts = {}) {
    const d = this._take();
    const q = new THREE.Quaternion().setFromAxisAngle(_axis.set(0, 1, 0), yaw);
    for (const name of NAMES) {
      const p = PLAN[name];
      const b = d.parts[name];
      _v.set(p.at[0], p.at[1], p.at[2]).applyQuaternion(q);
      b.pos.set(x + _v.x, y + _v.y, z + _v.z);
      b.quat.copy(q);
      // Every part leaves with the same velocity as the blow, plus a little
      // scatter: identical velocities make the ragdoll fly like a statue.
      b.vel.set(
        vel.x + (Math.random() - 0.5) * 1.6,
        vel.y + (Math.random() - 0.5) * 1.6,
        vel.z + (Math.random() - 0.5) * 1.6
      );
      // Extremities take more of the spin, which is what makes a ragdoll read
      // as limp rather than as a thrown mannequin.
      const limb = name !== 'torso' ? 1.9 : 1;
      const spin = opts.spin ?? 1;
      b.ang.set(
        (Math.random() - 0.5) * 5 * limb * spin,
        (Math.random() - 0.5) * 4 * limb * spin,
        (Math.random() - 0.5) * 5 * limb * spin
      );
      b.alive = true;
      b.sleeping = false;
      b._still = 0;
      b._stuck = 0;
    }
    // The head gets a lift, so the body pivots over rather than sliding flat.
    d.parts.head.vel.y += 2.4;
    d.live = true;
    d.age = 0;
    d.still = 0;
    d.asleep = false;
    return d;
  }

  /** Put a ragdoll away. */
  release(d) {
    if (!d || !d.live) return;
    for (const name of NAMES) {
      const b = d.parts[name];
      b.alive = false;
      b.sleeping = true;
      b.vel.set(0, 0, 0);
      b.ang.set(0, 0, 0);
      b.pos.set(0, -9999, 0);
    }
    d.live = false;
  }

  /**
   * Age the live ragdolls, and put settled ones to sleep as a whole.
   *
   * Sleeping each body on its own does not work here. Six boxes tied together
   * by five joints never all go still at the same instant: the joint solver
   * keeps trading tiny impulses between them, each part stays a hair above
   * the threshold, and a corpse lying motionless in the road goes on being
   * simulated for as long as it exists. Islands sleep together or not at all,
   * so the test is over the whole body, with a looser threshold than a lone
   * box needs — nothing about a ragdoll at rest is worth a millimetre.
   */
  update(dt) {
    for (const d of this.dolls) {
      if (!d.live) continue;
      d.age += dt;

      let maxV = 0, maxA = 0, anyAwake = false;
      for (const name of NAMES) {
        const b = d.parts[name];
        if (!b.sleeping) anyAwake = true;
        maxV = Math.max(maxV, b.vel.lengthSq());
        maxA = Math.max(maxA, b.ang.lengthSq());
      }

      // Something hit it — a blast, a car, a second body. All of it wakes.
      if (d.asleep && anyAwake) {
        for (const name of NAMES) d.parts[name].wake();
        d.asleep = false;
        d.still = 0;
        continue;
      }
      if (d.asleep) continue;

      // A hard stop as well as a soft one.
      //
      // Most ragdolls go quiet within a couple of seconds and the threshold
      // below catches them. A few never quite do: a limb wedged against a
      // kerb keeps trading a little energy between its contact and its joint,
      // and it can twitch at a tenth of a metre a second indefinitely. That
      // is both visible and a cost that never ends, so after a few seconds on
      // the ground a body that is no longer going anywhere is simply frozen
      // where it lies. Nothing about the picture changes; it just stops.
      const settled = maxV < 0.36 * 0.36 && maxA < 1.25 * 1.25;
      if (settled || (d.age > 5 && maxV < 1.5 * 1.5)) {
        d.still = (d.still || 0) + dt;
        if (d.still > (settled ? 0.7 : 0.25)) {
          for (const name of NAMES) {
            const b = d.parts[name];
            b.vel.set(0, 0, 0);
            b.ang.set(0, 0, 0);
            b.sleeping = true;
          }
          d.asleep = true;
        }
      } else {
        d.still = 0;
      }
    }
  }
}
