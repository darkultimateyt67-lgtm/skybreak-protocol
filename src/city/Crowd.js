import * as THREE from 'three';

/**
 * The people.
 *
 * A pedestrian used to be five boxes: a torso, a sphere for a head, two legs
 * and a pair of arms, all sliding back and forth along the facing axis. From
 * across the street it read as a person-shaped object; from the pavement it
 * read as five boxes. Nothing bent. There were no knees, no elbows, no
 * shoulders, no shoes, no hair — a head was a bare sphere the colour of skin,
 * which at close range is a mannequin, and a city full of mannequins is the
 * fastest way to make a street stop feeling like a street.
 *
 * WHAT THIS IS. A proper little skeleton — pelvis, chest, neck, head, and
 * jointed arms and legs — posed by forward kinematics and drawn entirely with
 * instanced meshes, so forty people still cost about a dozen draw calls. Every
 * part is a separate instanced mesh with a per-instance colour, which is what
 * lets one crowd contain different skin tones, different clothes, different
 * hair and different builds without a single unique material.
 *
 * WHAT IT BUYS. Knees and elbows that actually bend through the stride, a
 * torso that bobs and counter-rotates against the hips, a head that stays
 * level while the body moves under it, shoes, hair, and a bag on about a third
 * of people. Walk, run and flee are the same cycle at different gains, so a
 * frightened crowd reads as frightened rather than as the same walk played
 * faster.
 *
 * WHAT IT DOES NOT DO. No faces. At the distance a civilian is ever actually
 * seen, a face is two pixels, and the cost of putting one on forty people
 * every frame buys nothing. The head carries hair and a jaw, and that is the
 * silhouette that matters.
 *
 * RAGDOLLS. When someone goes down the pose comes from the six rigid bodies in
 * the solver instead of the walk cycle, and the parts that have no body of
 * their own — shins, shoes, forearms, hands, hair, the bag — are hung off
 * whichever body they belong to. See `poseFromRagdoll`.
 */

const SKIN = [0xc08a63, 0x8d5a3b, 0x5f3a24, 0xe0b48c, 0x9a6b48, 0x3f2716, 0xd2a074, 0x6f4526];
const HAIR = [0x1b1410, 0x2e1f14, 0x4a3320, 0x6b4a2a, 0x8a7355, 0x141414, 0x5a5652, 0x8e8b86];
const SHIRT = [0x2f3d52, 0x6b3a3a, 0x3f5340, 0x54506a, 0x7a6a4a, 0x2b2b31, 0x8a5a2f,
  0x35566b, 0x7d4f63, 0x46613f, 0xa8a49c, 0x3c3f4a];
const TROUSER = [0x24282f, 0x3a3226, 0x2e3b4a, 0x4a4139, 0x1e2026, 0x5a5142, 0x33353c];
const SHOE = [0x14120f, 0x201a14, 0x2b2b2f, 0x3a2a1e];
const BAG = [0x33302b, 0x5a2f2a, 0x2a3a44, 0x4a4436];

const _m4 = new THREE.Matrix4();
const _mp = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * The parts, in draw order. `n` is how many instances each PERSON needs, so a
 * pair of arms is 2 and a head is 1. `tint` says which palette an instance's
 * colour is rolled from; parts without one are a fixed colour.
 */
const PARTS = [
  { id: 'pelvis', n: 1, tint: 'trouser', box: [0.30, 0.18, 0.20] },
  { id: 'chest', n: 1, tint: 'shirt', box: [0.36, 0.40, 0.22] },
  { id: 'collar', n: 1, tint: 'shirt', box: [0.32, 0.10, 0.20] },
  { id: 'neck', n: 1, tint: 'skin', box: [0.10, 0.08, 0.10] },
  { id: 'head', n: 1, tint: 'skin', box: [0.17, 0.21, 0.19] },
  { id: 'jaw', n: 1, tint: 'skin', box: [0.14, 0.07, 0.15] },
  { id: 'hair', n: 1, tint: 'hair', box: [0.185, 0.13, 0.205] },
  { id: 'thigh', n: 2, tint: 'trouser', box: [0.14, 0.40, 0.16] },
  { id: 'shin', n: 2, tint: 'trouser', box: [0.12, 0.38, 0.14] },
  { id: 'shoe', n: 2, tint: 'shoe', box: [0.13, 0.09, 0.26] },
  { id: 'upperArm', n: 2, tint: 'shirt', box: [0.11, 0.30, 0.13] },
  { id: 'foreArm', n: 2, tint: 'skin', box: [0.09, 0.28, 0.11] },
  { id: 'hand', n: 2, tint: 'skin', box: [0.08, 0.10, 0.09] },
  { id: 'bag', n: 1, tint: 'bag', box: [0.26, 0.30, 0.13] }
];

function pick(list) { return list[(Math.random() * list.length) | 0]; }

/** A per-person wardrobe roll, kept so the ragdoll keeps the same clothes. */
export function rollLook() {
  const tall = 0.92 + Math.random() * 0.17;
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt: pick(SHIRT),
    trouser: pick(TROUSER),
    shoe: pick(SHOE),
    bag: pick(BAG),
    hasBag: Math.random() < 0.34,
    // Build: height scales the whole rig, width only the torso and limbs, so
    // a crowd has heavy people and slight people rather than big and small
    // copies of one person.
    height: tall,
    girth: 0.88 + Math.random() * 0.34,
    // Hair sits differently on different people; a few are shaved.
    hairLift: Math.random() < 0.12 ? 0 : 0.03 + Math.random() * 0.05
  };
}

export class Crowd {
  /**
   * @param scene   where the meshes go
   * @param count   how many people the pool holds
   */
  constructor(scene, count) {
    this.count = count;
    this.mesh = {};
    this.looks = [];
    /** part id -> instances per person, for the index arithmetic in _put. */
    this._slot = {};
    for (const part of PARTS) this._slot[part.id] = part.n;
    const col = new THREE.Color();

    for (const part of PARTS) {
      const geo = new THREE.BoxGeometry(part.box[0], part.box[1], part.box[2]);
      const mat = new THREE.MeshStandardMaterial({
        roughness: part.id === 'shoe' ? 0.6 : part.id === 'hair' ? 0.95 : 0.86,
        metalness: 0
      });
      const m = new THREE.InstancedMesh(geo, mat, count * part.n);
      m.castShadow = true;
      m.receiveShadow = part.id === 'shoe';
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * part.n * 3).fill(1), 3
      );
      scene.add(m);
      this.mesh[part.id] = m;
    }

    // Everyone's wardrobe, written into the instance colours once.
    for (let i = 0; i < count; i++) {
      const look = rollLook();
      this.looks.push(look);
      for (const part of PARTS) {
        const m = this.mesh[part.id];
        const hex = part.tint ? look[part.tint] : 0x808080;
        for (let k = 0; k < part.n; k++) {
          // A little per-limb variation stops a person reading as one solid
          // colour cut into rectangles.
          const j = 0.9 + Math.random() * 0.2;
          col.setHex(hex);
          m.setColorAt(i * part.n + k, col.multiplyScalar(j));
        }
      }
    }
    for (const part of PARTS) this.mesh[part.id].instanceColor.needsUpdate = true;
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  /** Write one part's matrix. `k` is 0 or 1 for the paired parts. */
  _put(id, i, k, pos, quat, scale) {
    // `_slot` is a lookup table rather than a PARTS.find: this runs twenty
    // times per person per frame and a linear scan of fourteen entries inside
    // it is eleven thousand comparisons a frame for nothing.
    _m4.compose(pos, quat, scale || _one);
    this.mesh[id].setMatrixAt(i * this._slot[id] + k, _m4);
  }

  /**
   * One person, standing or walking.
   *
   * The chain is built the way a body is: the pelvis is placed in the world,
   * everything else hangs off it, and each joint's rotation is applied in the
   * PARENT's frame. Doing it any other way — offsetting each part along the
   * facing axis, as this used to — produces limbs that slide rather than
   * swing, which is the single thing that most makes a walk look wrong.
   *
   * @param i      which person
   * @param p      their state: x, z, yaw, phase, and a 0..1 `gait` for how
   *               hard they are moving (0 standing, 1 sprinting)
   * @param ground the height under their feet
   */
  pose(i, p, ground = 0) {
    const look = this.looks[i];
    const h = look.height;
    const w = look.girth;
    const gait = Math.min(1, p.gait ?? 0.5);
    const ph = p.phase;

    // The stride. Hips and shoulders swing in opposition; the amplitude and
    // the knee bend both grow with speed, which is the difference between a
    // stroll and a run without needing a second animation.
    const swing = Math.sin(ph) * (0.36 + gait * 0.52);
    const swingB = Math.sin(ph + Math.PI) * (0.36 + gait * 0.52);
    // Knees only bend on the recovery half of the stride, never backwards.
    const kneeA = Math.max(0, -Math.sin(ph - 0.9)) * (0.5 + gait * 0.85);
    const kneeB = Math.max(0, -Math.sin(ph + Math.PI - 0.9)) * (0.5 + gait * 0.85);
    // Two bobs per stride — the body drops onto each foot.
    const bob = Math.abs(Math.cos(ph)) * (0.015 + gait * 0.035);
    // Hips rotate one way, shoulders the other.
    const hipTwist = Math.sin(ph) * (0.06 + gait * 0.1);
    const lean = 0.03 + gait * 0.20;

    const hipY = ground + (0.92 - bob) * h;
    _qa.setFromAxisAngle(_AXIS_Y, p.yaw);

    // --- Pelvis ---------------------------------------------------------------
    _q.copy(_qa).multiply(_qy(hipTwist));
    _v.set(p.x, hipY, p.z);
    this._put('pelvis', i, 0, _v, _q, _sc(w, h, w));
    const pelvisQ = _q.clone();
    const pelvisP = _v.clone();

    // --- Chest and up ---------------------------------------------------------
    // The chest counter-twists against the hips and leans into the walk.
    const chestQ = _qa.clone().multiply(_qy(-hipTwist * 1.15)).multiply(_qx(lean));
    const chestP = _local(pelvisP, pelvisQ, 0, 0.30 * h, 0);
    this._put('chest', i, 0, chestP, chestQ, _sc(w, h, w));
    this._put('collar', i, 0, _local(chestP, chestQ, 0, 0.24 * h, 0), chestQ, _sc(w, h, w));

    // The head stays level while everything under it moves — that is what
    // makes a walk cycle read as a person rather than a puppet.
    const headQ = _qa.clone().multiply(_qy(Math.sin(ph * 0.5) * 0.07));
    const neckP = _local(chestP, chestQ, 0, 0.30 * h, 0);
    this._put('neck', i, 0, neckP, headQ, _sc(1, h, 1));
    const headP = _local(neckP, headQ, 0, 0.13 * h, 0);
    this._put('head', i, 0, headP, headQ, _sc(1, h, 1));
    this._put('jaw', i, 0, _local(headP, headQ, 0, -0.09 * h, 0.02), headQ, _sc(1, h, 1));
    if (look.hairLift > 0) {
      this._put('hair', i, 0, _local(headP, headQ, 0, look.hairLift + 0.05 * h, -0.005), headQ, _sc(1, 1, 1));
    } else {
      this.mesh.hair.setMatrixAt(i, this._hidden);
    }

    // --- Legs -----------------------------------------------------------------
    const leg = (k, sw, knee) => {
      const side = k === 0 ? 1 : -1;
      const hipP = _local(pelvisP, pelvisQ, side * 0.105 * w, -0.06 * h, 0);
      const thighQ = _qa.clone().multiply(_qy(hipTwist)).multiply(_qx(sw * 0.72));
      this._put('thigh', i, k, _local(hipP, thighQ, 0, -0.20 * h, 0), thighQ, _sc(w, h, w));
      const kneeP = _local(hipP, thighQ, 0, -0.40 * h, 0);
      const shinQ = thighQ.clone().multiply(_qx(-knee));
      this._put('shin', i, k, _local(kneeP, shinQ, 0, -0.19 * h, 0), shinQ, _sc(w, h, w));
      const ankleP = _local(kneeP, shinQ, 0, -0.38 * h, 0);
      // The foot flattens out as it takes weight and points as it leaves.
      const footQ = _qa.clone().multiply(_qx(Math.max(-0.35, Math.min(0.5, sw * 0.5 - knee * 0.35))));
      this._put('shoe', i, k, _local(ankleP, footQ, 0, -0.045 * h, 0.05), footQ, _sc(w, 1, h));
    };
    leg(0, swing, kneeA);
    leg(1, swingB, kneeB);

    // --- Arms -----------------------------------------------------------------
    // Opposite the leg on the same side, and the elbow only ever folds in.
    const arm = (k, sw) => {
      const side = k === 0 ? 1 : -1;
      const shoulderP = _local(chestP, chestQ, side * 0.235 * w, 0.20 * h, 0);
      const upQ = chestQ.clone().multiply(_qx(sw * 0.62)).multiply(_qz(side * -0.08));
      this._put('upperArm', i, k, _local(shoulderP, upQ, 0, -0.15 * h, 0), upQ, _sc(w, h, w));
      const elbowP = _local(shoulderP, upQ, 0, -0.30 * h, 0);
      const bend = 0.22 + Math.max(0, sw) * 0.75 + gait * 0.5;
      const foreQ = upQ.clone().multiply(_qx(-bend));
      this._put('foreArm', i, k, _local(elbowP, foreQ, 0, -0.14 * h, 0), foreQ, _sc(w, h, w));
      const wristP = _local(elbowP, foreQ, 0, -0.28 * h, 0);
      this._put('hand', i, k, _local(wristP, foreQ, 0, -0.05 * h, 0), foreQ, _sc(1, h, 1));
    };
    arm(0, swingB);
    arm(1, swing);

    // --- Bag ------------------------------------------------------------------
    if (look.hasBag) {
      this._put('bag', i, 0, _local(chestP, chestQ, 0.04, -0.02 * h, -0.19), chestQ, _sc(1, h, 1));
    } else {
      this.mesh.bag.setMatrixAt(i, this._hidden);
    }
  }

  /**
   * One person, down.
   *
   * The solver only carries six boxes for a body — torso, head and four limbs
   * — because that is all a ragdoll needs to behave. The visual rig has
   * fourteen parts, so the ten with no body of their own are hung off the one
   * they belong to: the shin and the shoe follow the leg, the forearm and the
   * hand follow the arm, the hair follows the head. They stop articulating,
   * which is exactly right for someone who has stopped.
   *
   * @param parts the ragdoll's bodies, keyed torso/head/legL/legR/armL/armR
   */
  poseFromRagdoll(i, parts) {
    const look = this.looks[i];
    const h = look.height, w = look.girth;
    const T = parts.torso, H = parts.head;

    this._put('chest', i, 0, T.pos, T.quat, _sc(w, h, w));
    this._put('collar', i, 0, _local(T.pos, T.quat, 0, 0.24 * h, 0), T.quat, _sc(w, h, w));
    this._put('pelvis', i, 0, _local(T.pos, T.quat, 0, -0.30 * h, 0), T.quat, _sc(w, h, w));
    this._put('neck', i, 0, _local(T.pos, T.quat, 0, 0.32 * h, 0), T.quat, _sc(1, h, 1));
    this._put('head', i, 0, H.pos, H.quat, _sc(1, h, 1));
    this._put('jaw', i, 0, _local(H.pos, H.quat, 0, -0.09 * h, 0.02), H.quat, _sc(1, h, 1));
    if (look.hairLift > 0) {
      this._put('hair', i, 0, _local(H.pos, H.quat, 0, look.hairLift + 0.05 * h, -0.005), H.quat, _sc(1, 1, 1));
    } else {
      this.mesh.hair.setMatrixAt(i, this._hidden);
    }

    const limb = (body, k) => {
      // The rigid leg is one box from hip to ankle; the thigh is its top half
      // and the shin its bottom half, with the shoe on the end of it.
      this._put('thigh', i, k, _local(body.pos, body.quat, 0, 0.19 * h, 0), body.quat, _sc(w, h, w));
      this._put('shin', i, k, _local(body.pos, body.quat, 0, -0.19 * h, 0), body.quat, _sc(w, h, w));
      this._put('shoe', i, k, _local(body.pos, body.quat, 0, -0.43 * h, 0.04), body.quat, _sc(w, 1, h));
    };
    limb(parts.legL, 0);
    limb(parts.legR, 1);

    const armPart = (body, k) => {
      this._put('upperArm', i, k, _local(body.pos, body.quat, 0, 0.14 * h, 0), body.quat, _sc(w, h, w));
      this._put('foreArm', i, k, _local(body.pos, body.quat, 0, -0.14 * h, 0), body.quat, _sc(w, h, w));
      this._put('hand', i, k, _local(body.pos, body.quat, 0, -0.32 * h, 0), body.quat, _sc(1, h, 1));
    };
    armPart(parts.armL, 0);
    armPart(parts.armR, 1);

    if (look.hasBag) {
      this._put('bag', i, 0, _local(T.pos, T.quat, 0.04, -0.02 * h, -0.19), T.quat, _sc(1, h, 1));
    } else {
      this.mesh.bag.setMatrixAt(i, this._hidden);
    }
  }

  /** Take someone off screen entirely. */
  hide(i) {
    for (const part of PARTS) {
      for (let k = 0; k < part.n; k++) {
        this.mesh[part.id].setMatrixAt(i * part.n + k, this._hidden);
      }
    }
  }

  flush() {
    for (const part of PARTS) this.mesh[part.id].instanceMatrix.needsUpdate = true;
  }

  dispose(scene) {
    for (const part of PARTS) {
      const m = this.mesh[part.id];
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

// --- Small helpers ----------------------------------------------------------
// These allocate, which is normally the wrong answer in a per-frame path. They
// are kept because the alternative — threading a dozen module-level scratch
// quaternions through a chain where a parent's rotation is still needed after
// the child has been computed — produced exactly the kind of aliasing bug that
// is invisible until one limb starts following another. Forty people a frame
// is a few hundred small objects; the generational collector eats that without
// noticing, and the code stays readable.

const _scv = new THREE.Vector3();
function _sc(x, y, z) { return _scv.set(x, y, z); }

function _qx(a) { return new THREE.Quaternion().setFromAxisAngle(_AXIS_X, a); }
function _qy(a) { return new THREE.Quaternion().setFromAxisAngle(_AXIS_Y, a); }
function _qz(a) { return new THREE.Quaternion().setFromAxisAngle(_AXIS_Z, a); }

/**
 * A point offset from `origin` in `quat`'s frame.
 *
 * This returns a NEW vector rather than a shared scratch one, and it has to:
 * the chain reads like `const kneeP = _local(hipP, ...)` where `hipP` was
 * itself the last thing this function returned, and a shared vector would be
 * setting the offset into the very object it is about to add — so the knee
 * would come out at twice the offset and none of the position. That is the
 * aliasing bug the note above is about.
 */
function _local(origin, quat, x, y, z) {
  return new THREE.Vector3(x, y, z).applyQuaternion(quat).add(origin);
}
