import * as THREE from 'three';

/**
 * Anatomy — heads and hair for every human in the game.
 *
 * HAIR
 * Built the way film and AAA games build it: a small set of *guide strands*
 * get real spring physics on the CPU, and a much larger cloud of *rendered
 * strands* is instanced around them, each inheriting its guide's motion plus
 * its own offset and stiffness. Simulating every rendered strand separately
 * would mean tens of thousands of spring integrations per character per
 * frame, which no browser can do at 60 FPS — guide interpolation is the
 * standard answer and it looks the same in motion.
 *
 * FACE
 * Brow ridge, nose bridge + tip + nostrils, ears with lobes and inner bowl,
 * jaw, lips and a mouth that actually moves: it opens for shouted lines,
 * tightens in combat, and rests neutral otherwise.
 */

const HAIR_STYLES = {
  short: { rows: 5, len: 0.10, spread: 0.95, back: 0.4, stiff: 0.85 },
  crop: { rows: 4, len: 0.06, spread: 1.0, back: 0.2, stiff: 0.95 },
  tied: { rows: 6, len: 0.30, spread: 0.8, back: 1.5, stiff: 0.45 },
  buzz: { rows: 3, len: 0.03, spread: 1.0, back: 0.1, stiff: 1.0 },
  long: { rows: 7, len: 0.34, spread: 1.05, back: 1.1, stiff: 0.35 }
};

/**
 * A head of hair: `guides` spring-simulated roots driving `strands` instanced
 * cards. Call update() with the head's world motion each frame.
 */
export class Hair {
  constructor(parent, opts = {}) {
    const style = HAIR_STYLES[opts.style] || HAIR_STYLES.short;
    this.style = style;
    this.guideCount = opts.guides ?? 12;
    this.strandCount = opts.strands ?? 900;
    this.color = new THREE.Color(opts.color ?? 0x241a12);
    this.radius = opts.radius ?? 0.175;

    // Guide state: each is a root direction plus a spring-damped tip offset.
    this.guides = [];
    for (let i = 0; i < this.guideCount; i++) {
      const a = (i / this.guideCount) * Math.PI * 2;
      const tilt = 0.35 + (i % 3) * 0.28;
      this.guides.push({
        dir: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
        off: new THREE.Vector3(),
        vel: new THREE.Vector3()
      });
    }

    // One instanced card per rendered strand.
    const geo = this._strandGeometry(style.len);
    const mat = new THREE.MeshLambertMaterial({
      color: this.color, side: THREE.DoubleSide, transparent: true, opacity: 0.96
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.strandCount);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    parent.add(this.mesh);

    // Bind every rendered strand to a guide, with its own root + jitter.
    this.bind = new Array(this.strandCount);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.strandCount; i++) {
      // Scalp placement: rows from crown down to the hairline.
      const row = Math.floor((i / this.strandCount) * style.rows);
      const rowT = row / Math.max(1, style.rows - 1);
      const tilt = 0.15 + rowT * 1.15 * style.spread;
      const a = (i * 2.399963) % (Math.PI * 2); // golden angle scatter
      const dir = new THREE.Vector3(
        Math.cos(a) * Math.sin(tilt),
        Math.cos(tilt),
        Math.sin(a) * Math.sin(tilt) - style.back * 0.12 * rowT
      ).normalize();
      // Nearest guide by direction.
      let best = 0, bestDot = -2;
      for (let gI = 0; gI < this.guides.length; gI++) {
        const d = this.guides[gI].dir.dot(dir);
        if (d > bestDot) { bestDot = d; best = gI; }
      }
      this.bind[i] = {
        guide: best,
        root: dir.clone().multiplyScalar(this.radius),
        dir,
        jitter: 0.55 + Math.random() * 0.9,
        len: 0.7 + Math.random() * 0.6
      };
      pos.copy(this.bind[i].root);
      q.setFromUnitVectors(up, dir);
      scl.set(1, this.bind[i].len, 1);
      m4.compose(pos, q, scl);
      this.mesh.setMatrixAt(i, m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this._m4 = m4;
    this._q = q;
    this._pos = pos;
    this._scl = scl;
    this._up = up;
    this._tmpDir = new THREE.Vector3();
    this._prevWorld = new THREE.Vector3();
    this._first = true;

    // Motion scratch. Everything the solver does happens in the head's own
    // frame, so world quantities get rotated in before they're used.
    this._wq = new THREE.Quaternion();
    this._prevQ = new THREE.Quaternion();
    this._dq = new THREE.Quaternion();
    this._wqInv = new THREE.Quaternion();
    this._vel = new THREE.Vector3();
    this._omega = new THREE.Vector3();
    this._grav = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._force = new THREE.Vector3();
  }

  _strandGeometry(len) {
    const g = new THREE.BufferGeometry();
    const w = 0.0075;
    // Tapered ribbon, wide at the root, pointed at the tip.
    const verts = new Float32Array([
      -w, 0, 0, w, 0, 0, -w * 0.6, len * 0.55, 0,
      w, 0, 0, w * 0.6, len * 0.55, 0, -w * 0.6, len * 0.55, 0,
      -w * 0.6, len * 0.55, 0, w * 0.6, len * 0.55, 0, 0, len, 0
    ]);
    const norms = new Float32Array(verts.length);
    for (let i = 0; i < norms.length; i += 3) norms[i + 2] = 1;
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    return g;
  }

  /**
   * @param dt seconds
   * @param worldPos head's world position (drives inertia)
   * @param wind ambient sway strength
   *
   * Guide offsets live in the head's LOCAL frame, so every world-space
   * quantity — travel velocity, gravity — is rotated into that frame before
   * it's applied. Skipping that step makes hair blow east regardless of which
   * way the character is facing.
   *
   * Turning the head is handled separately. It produces no change in world
   * position at all, so linear drag alone leaves the hair welded in place
   * through a full spin. What actually throws it is angular velocity: each
   * guide tip sits some distance out from the neck axis, so it sweeps through
   * air at omega x r, and that is the force the solver needs.
   */
  update(dt, worldPos, wind = 1) {
    const parent = this.mesh.parent;
    if (parent) parent.getWorldQuaternion(this._wq); else this._wq.identity();

    if (this._first) {
      this._prevWorld.copy(worldPos);
      this._prevQ.copy(this._wq);
      this._first = false;
    }
    const inv = Math.min(1 / Math.max(dt, 1e-4), 240); // clamp: tab-switch spikes
    this._wqInv.copy(this._wq).conjugate();

    // Travel velocity, brought into the head's frame.
    this._vel.subVectors(worldPos, this._prevWorld).multiplyScalar(inv);
    this._prevWorld.copy(worldPos);
    this._vel.applyQuaternion(this._wqInv);

    // Angular velocity, already local: prev^-1 * current is the turn expressed
    // in the frame the hair actually hangs in.
    this._dq.copy(this._prevQ).conjugate().multiply(this._wq);
    this._prevQ.copy(this._wq);
    if (this._dq.w < 0) {           // shortest arc
      this._dq.set(-this._dq.x, -this._dq.y, -this._dq.z, -this._dq.w);
    }
    const sinHalf = Math.sqrt(this._dq.x ** 2 + this._dq.y ** 2 + this._dq.z ** 2);
    if (sinHalf > 1e-6) {
      const angle = 2 * Math.atan2(sinHalf, this._dq.w);
      this._omega.set(this._dq.x, this._dq.y, this._dq.z)
        .multiplyScalar((angle * inv) / sinHalf);
    } else {
      this._omega.set(0, 0, 0);
    }

    // Gravity, likewise in the head's frame, so a tilted head still drops hair
    // straight down instead of sideways.
    this._grav.set(0, -1, 0).applyQuaternion(this._wqInv);

    const t = performance.now() * 0.001;
    const stiffness = 46 * this.style.stiff;
    const damping = 7.5;
    // Long hair has more leverage and catches more air than a crop.
    const heft = 0.5 + this.style.len * 2.4;
    const armLen = this.radius + this.style.len * 0.6;

    for (let i = 0; i < this.guides.length; i++) {
      const gd = this.guides[i];

      // Air speed past this guide's tip: travel plus its own sweep. The sweep
      // is weighted up because a head turn is the motion you actually watch
      // hair for, and it covers far less ground than a sprint does.
      this._tan.crossVectors(this._omega, gd.dir).multiplyScalar(armLen);
      this._force.copy(this._vel).addScaledVector(this._tan, 1.8).multiplyScalar(-0.34 * heft);

      const breeze = Math.sin(t * 1.7 + i * 1.3) * 0.006 * wind * heft;
      this._force.x += breeze;
      this._force.z += breeze * 0.7;
      this._force.addScaledVector(this._grav, 0.9);

      gd.vel.x += (-gd.off.x * stiffness - gd.vel.x * damping + this._force.x) * dt;
      gd.vel.y += (-gd.off.y * stiffness - gd.vel.y * damping + this._force.y) * dt;
      gd.vel.z += (-gd.off.z * stiffness - gd.vel.z * damping + this._force.z) * dt;
      gd.off.addScaledVector(gd.vel, dt);
      const cap = this.style.len * 0.9;
      gd.off.clampLength(0, cap);
    }

    // Rendered strands inherit their guide's displacement, scaled by their
    // own jitter so the mass moves together without moving identically.
    for (let i = 0; i < this.strandCount; i++) {
      const b = this.bind[i];
      const gd = this.guides[b.guide];
      this._tmpDir.copy(b.dir)
        .addScaledVector(gd.off, b.jitter * 6)
        .normalize();
      this._pos.copy(b.root);
      this._q.setFromUnitVectors(this._up, this._tmpDir);
      this._scl.set(1, b.len, 1);
      this._m4.compose(this._pos, this._q, this._scl);
      this.mesh.setMatrixAt(i, this._m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

/**
 * Build a detailed head onto `parent`. Returns handles for animation:
 * { jaw, mouth, lipTop, brows, eyes, lids, hair }.
 */
export function buildHead(parent, opts = {}) {
  const skinHex = opts.skin ?? 0xd9a077;
  const hairHex = opts.hairColor ?? 0x241a12;
  const skin = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.82 });
  const skinDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(skinHex).multiplyScalar(0.86), roughness: 0.85
  });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a1a1c, roughness: 0.6 });
  const lipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(skinHex).lerp(new THREE.Color(0x8a4a44), 0.45), roughness: 0.7
  });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.35 });
  const iris = new THREE.MeshStandardMaterial({ color: opts.eyeColor ?? 0x4a3a26, roughness: 0.3 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.95 });

  const R = 0.175;
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, p = parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    p.add(m);
    return m;
  };

  // --- Cranium + jaw ------------------------------------------------------
  const skull = add(new THREE.SphereGeometry(R, 18, 16), skin, 0, 0, 0);
  skull.scale.set(0.94, 1.06, 1.0);

  // Jaw is a separate group so the mouth can actually open.
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.055, 0.012);
  parent.add(jaw);
  const chin = add(new THREE.BoxGeometry(0.15, 0.1, 0.15), skin, 0, -0.055, 0.035, 0, 0, 0, jaw);
  chin.scale.set(1, 1, 1);
  add(new THREE.BoxGeometry(0.185, 0.07, 0.12), skinDark, 0, -0.03, -0.01, 0, 0, 0, jaw); // jawline

  // --- Nose: bridge, tip, nostril wings ------------------------------------
  const bridge = add(new THREE.BoxGeometry(0.032, 0.075, 0.045), skin, 0, 0.012, R * 0.86, -0.18);
  bridge.scale.set(1, 1, 1);
  const tip = add(new THREE.SphereGeometry(0.026, 10, 8), skin, 0, -0.037, R * 0.95);
  tip.scale.set(1.05, 0.85, 1.1);
  add(new THREE.SphereGeometry(0.016, 8, 6), skinDark, -0.026, -0.043, R * 0.88);
  add(new THREE.SphereGeometry(0.016, 8, 6), skinDark, 0.026, -0.043, R * 0.88);
  // Nostrils.
  add(new THREE.SphereGeometry(0.007, 6, 5), mouthMat, -0.017, -0.052, R * 0.9);
  add(new THREE.SphereGeometry(0.007, 6, 5), mouthMat, 0.017, -0.052, R * 0.9);

  // --- Ears: helix, lobe, inner bowl ---------------------------------------
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * R * 0.93, -0.005, -0.012);
    ear.rotation.y = side * 0.28;
    parent.add(ear);
    const helix = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.011, 6, 12, Math.PI * 1.45), skin);
    helix.rotation.set(Math.PI / 2, side * Math.PI / 2, 0.5);
    helix.castShadow = true;
    ear.add(helix);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), skinDark);
    bowl.scale.set(0.4, 1, 0.75);
    bowl.position.set(side * 0.004, 0, 0);
    ear.add(bowl);
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), skin);
    lobe.position.set(0, -0.038, 0.004);
    lobe.scale.set(0.7, 1, 0.8);
    lobe.castShadow = true;
    ear.add(lobe);
    ears.push(ear);
  }

  // --- Brows + eyes ---------------------------------------------------------
  const brows = [];
  const eyes = [];
  const lids = [];
  for (const side of [-1, 1]) {
    // Brow ridge above the socket.
    add(new THREE.BoxGeometry(0.062, 0.018, 0.03), skinDark, side * 0.062, 0.052, R * 0.82, -0.15);
    const brow = add(new THREE.BoxGeometry(0.056, 0.013, 0.016), hairMat, side * 0.062, 0.062, R * 0.84, -0.12);
    brows.push(brow);
    // Eyeball set into the socket.
    const eye = add(new THREE.SphereGeometry(0.021, 12, 10), eyeWhite, side * 0.058, 0.021, R * 0.78);
    const pupil = add(new THREE.SphereGeometry(0.0105, 10, 8), iris, side * 0.058, 0.021, R * 0.795);
    eyes.push({ eye, pupil });
    // Upper lid for blinking.
    const lid = add(new THREE.SphereGeometry(0.0225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), skin,
      side * 0.058, 0.021, R * 0.78);
    lids.push(lid);
  }

  // --- Mouth: lips + an opening that widens when shouting -------------------
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, -0.075, R * 0.83);
  jaw.add(mouthGroup);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), mouthMat);
  mouth.scale.set(1, 0.22, 0.5);
  mouthGroup.add(mouth);
  const lipTop = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.011, 0.02), lipMat);
  lipTop.position.set(0, 0.013, 0.008);
  mouthGroup.add(lipTop);
  const lipBot = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.013, 0.02), lipMat);
  lipBot.position.set(0, -0.015, 0.006);
  mouthGroup.add(lipBot);

  // --- Hair -----------------------------------------------------------------
  const style = opts.hair || 'short';
  let hair = null;
  if (style !== 'bald') {
    // Scalp cap under the strands so no skin shows through the parting.
    const cap = add(new THREE.SphereGeometry(R * 1.01, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat, 0, 0.004, -0.004);
    if (style === 'tied' || style === 'long') {
      add(new THREE.BoxGeometry(0.09, 0.16, 0.08), hairMat, 0, -0.03, -R * 0.95); // bun / fall
    }
    hair = new Hair(parent, {
      style,
      color: hairHex,
      radius: R * 1.02,
      guides: opts.guides ?? 12,
      strands: opts.strands ?? 900
    });
  }

  // Facial hair.
  if (opts.beard) {
    const beard = add(new THREE.BoxGeometry(0.16, 0.09, 0.13), hairMat, 0, -0.072, 0.03, 0, 0, 0, jaw);
    beard.scale.set(1, 1, 1);
    add(new THREE.BoxGeometry(0.048, 0.016, 0.02), hairMat, 0, -0.052, R * 0.86, 0, 0, 0, jaw); // moustache
  }

  return { skull, jaw, mouth, mouthGroup, lipTop, lipBot, brows, eyes, lids, ears, hair };
}

/**
 * Drive a head built by buildHead(). `mood` shifts the expression:
 *  'idle'  neutral, occasional blink
 *  'talk'  mouth working, brows lively
 *  'alert' jaw set, brows down
 *  'shout' mouth wide open
 */
export function animateHead(h, dt, t, mood = 'idle', worldPos = null) {
  if (!h) return;

  // Blink: quick, irregular, both lids together.
  h._blink = (h._blink ?? 2) - dt;
  if (h._blink <= 0) h._blink = 1.8 + Math.random() * 3.4;
  const blinking = h._blink < 0.13;
  const lidY = blinking ? 0.0 : 0.021;
  for (const lid of h.lids) {
    lid.position.y += ((blinking ? 0.012 : 0.028) - lid.position.y) * Math.min(1, dt * 26);
    lid.scale.y = blinking ? 1.6 : 1;
  }

  // Mouth + jaw per mood.
  let openTarget = 0.02;
  let browTarget = 0;
  if (mood === 'talk') {
    // Viseme-driven lip sync. Rather than a smooth sine — which reads as
    // chewing — the mouth snaps between shapes at roughly syllable rate:
    // open vowels, near-closed consonants, and the occasional pause for
    // breath. That irregular alternation is what actually looks like speech.
    h._visemeAt = (h._visemeAt ?? 0) - dt;
    if (h._visemeAt <= 0) {
      const r = Math.random();
      if (r < 0.10) {
        // Brief closure — a plosive or a gap between words.
        h._viseme = 0.004;
        h._visemeAt = 0.07 + Math.random() * 0.1;
      } else if (r < 0.62) {
        // Vowel: wide.
        h._viseme = 0.042 + Math.random() * 0.038;
        h._visemeAt = 0.07 + Math.random() * 0.07;
      } else {
        // Consonant: barely parted.
        h._viseme = 0.008 + Math.random() * 0.018;
        h._visemeAt = 0.05 + Math.random() * 0.05;
      }
    }
    openTarget = h._viseme ?? 0.02;
    browTarget = Math.sin(t * 3.1) * 0.06;
  } else if (mood === 'shout') {
    openTarget = 0.085 + Math.sin(t * 9) * 0.015;
    browTarget = -0.11;
  } else if (mood === 'alert') {
    openTarget = 0.008;
    browTarget = -0.08;
  } else {
    openTarget = 0.014 + Math.sin(t * 0.7) * 0.004;
    browTarget = Math.sin(t * 0.5) * 0.015;
  }
  // Jaw chases the viseme fast enough to hit consonants, but not so fast it
  // looks mechanical.
  const chase = mood === 'talk' ? 30 : 16;
  h._open = (h._open ?? 0) + (openTarget - (h._open ?? 0)) * Math.min(1, dt * chase);
  h.jaw.rotation.x = h._open * 3.4;
  h.jaw.position.y = -0.055 - h._open * 0.5;
  h.mouth.scale.y = 0.22 + h._open * 7;
  h.lipTop.position.y = 0.013 + h._open * 0.25;
  h.lipBot.position.y = -0.015 - h._open * 0.3;
  for (let i = 0; i < h.brows.length; i++) {
    const target = 0.062 + browTarget + Math.sin(t * 2 + i * 2.1) * 0.004;
    h.brows[i].position.y += (target - h.brows[i].position.y) * Math.min(1, dt * 10);
    h.brows[i].rotation.z = (i === 0 ? 1 : -1) * (browTarget * 0.9);
  }

  // Eyes drift so they aren't dead.
  for (let i = 0; i < h.eyes.length; i++) {
    const e = h.eyes[i];
    const dx = Math.sin(t * 0.9 + i) * 0.0035;
    const dy = Math.cos(t * 0.7) * 0.002;
    e.pupil.position.x = (i === 0 ? -0.058 : 0.058) + dx;
    e.pupil.position.y = 0.021 + dy;
  }

  if (h.hair && worldPos) h.hair.update(dt, worldPos, 1);
}

/**
 * Articulated body motion. Instead of one rigid mesh, limbs are chained
 * groups (hip→knee→ankle, shoulder→elbow→wrist, pelvis→spine→chest→neck) and
 * each joint carries a damped spring, so a footfall travels up the leg into
 * the torso and settles a beat later — the secondary motion real bodies have.
 */
export class BodyRig {
  constructor(joints) {
    // joints: { name: Object3D }
    this.joints = joints;
    this.springs = {};
    for (const k of Object.keys(joints)) {
      this.springs[k] = { value: 0, vel: 0 };
    }
  }

  /** Push a joint away from rest; the spring brings it back with overshoot. */
  impulse(name, amount) {
    const s = this.springs[name];
    if (s) s.vel += amount;
  }

  /** @param targets { jointName: targetAngleRadians } */
  update(dt, targets, stiffness = 120, damping = 13) {
    for (const name of Object.keys(this.springs)) {
      const s = this.springs[name];
      const target = targets[name] ?? 0;
      s.vel += (-(s.value - target) * stiffness - s.vel * damping) * dt;
      s.value += s.vel * dt;
      const j = this.joints[name];
      if (j) j.rotation.x = s.value;
    }
  }
}
