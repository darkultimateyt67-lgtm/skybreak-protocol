import * as THREE from 'three';

/**
 * What a car does that isn't going forwards.
 *
 * Until now a vehicle was a box that slid along the ground on a fixed yaw:
 * `syncMesh` set `rotation.y` and nothing else. It could not lean into a
 * corner, dip its nose under the brakes, squat under power, tilt as it
 * crossed a kerb, ride up a ramp, leave the ground, land, or turn over. The
 * car and the road were two separate things that happened to be drawn near
 * each other.
 *
 * This is the layer in between. It does three jobs.
 *
 * GROUND FOLLOWING. Four points are sampled under the car every frame, one
 * at each wheel. Their average is the height the body sits at; the front/rear
 * difference is its pitch and the left/right difference is its roll. The part
 * of each wheel that does NOT fit that plane is the suspension travel, so the
 * wheel rides up into its arch over a kerb while the body stays level — which
 * is the whole visual point of having suspension at all.
 *
 * WEIGHT TRANSFER. Braking, accelerating and cornering move load around, and
 * the springs answer by compressing. Both are run as a damped second-order
 * spring rather than a direct offset, so the body keeps moving for a moment
 * after the input stops: the nose rebounds after a stop, the car rolls onto
 * its outside wheels through a bend and settles back on the exit. Getting
 * this wrong in either direction is instantly obvious — too stiff and the car
 * is a brick, too soft and it is a boat.
 *
 * AIR. The body's height is integrated separately from the ground it is
 * over. Climbing a ramp the ground pushes the body up and the body takes the
 * ground's own vertical speed with it; at the crest the ground falls away,
 * the body keeps the speed it had, and the car is flying. Gravity brings it
 * back and the landing is a real impact: the springs bottom out, the tyres
 * bite, and a bad one turns the car over.
 *
 * It is deliberately NOT a full rigid-body car. The handling model above it
 * is an arcade one and should stay that way — this only decides how the
 * chassis sits on top of wherever that model has put it.
 */

const G = -19.6;                 // matches the rest of the game's gravity
const MAX_TRAVEL = 0.13;         // how far a wheel can move in its arch
const LAND_HARD = 7.0;           // m/s of impact that starts to hurt
const FLIP_ROLL = 1.15;          // rad of roll past which the car goes over

const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _p = new THREE.Vector3();

/** A damped spring, run once per frame. Used for pitch, roll and heave. */
function spring(state, target, stiffness, damping, dt) {
  state.v += ((target - state.x) * stiffness - state.v * damping) * dt;
  state.x += state.v * dt;
  return state.x;
}

export class Chassis {
  /** @param {object} vehicle the Vehicle this belongs to */
  constructor(vehicle) {
    const s = vehicle.style;
    this.v = vehicle;

    // Where the wheels are, in the body's own frame. Taken from the same
    // numbers the wheel meshes were built from so the two cannot drift apart.
    this.track = s.w * 0.44;
    this.base = s.l * 0.31;

    this.pitch = { x: 0, v: 0 };
    this.roll = { x: 0, v: 0 };
    this.heave = { x: 0, v: 0 };   // body bob, independent of the ground

    // Air state. `y` is where the body actually is; `support` is where the
    // ground under it is. They are the same thing until you jump something.
    this.y = null;
    this.vy = 0;
    this.support = 0;
    this.prevSupport = null;
    this.airborne = false;
    this.airTime = 0;
    this.landing = 0;              // decays after a landing; drives the squat

    this.prevSpeed = 0;
    this.prevYaw = vehicle.yaw;
    this.groundPitch = 0;
    this.groundRoll = 0;

    // Wheel travel, one per wheel, in the order the vehicle built them.
    this.travel = new Float32Array(8);
    this._wy = new Float32Array(8);       // this frame's ground under each wheel
    // Remember each wheel's rest pose. Travel is applied to it rather than
    // accumulated onto whatever the wheel happened to be at last frame, and
    // the local x/z are read off the mesh so a three-axle truck samples its
    // middle wheels where they actually are.
    for (const w of vehicle.wheels || []) {
      if (w.restY === undefined) w.restY = w.mesh.position.y;
      if (w.lx === undefined) { w.lx = w.mesh.position.x; w.lz = w.mesh.position.z; }
    }
  }

  /** Ground height under a point in the body's frame. */
  _sampleAt(sx, sz) {
    const v = this.v;
    _p.set(
      v.position.x + _side.x * sx + _fwd.x * sz,
      0,
      v.position.z + _side.z * sx + _fwd.z * sz
    );
    const c = v.city;
    const h = c && c.surfaceAt ? c.surfaceAt(_p.x, _p.z) : 0;
    // Out past the map edge surfaceAt can report the void; a wheel hanging
    // over nothing should follow the body, not drag it to the centre of the
    // earth.
    return h > -1e6 ? h : this.support;
  }

  /**
   * @param dt seconds
   * @param throttle -1..1, as handed to drive()
   * @param handbrake boolean
   */
  update(dt, throttle, handbrake) {
    const v = this.v;
    const s = v.style;
    if (dt <= 0) return;

    // The body's own axes in world space. Local +Z is the nose (the model is
    // built facing +Z), local +X is the car's left.
    _fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    _side.set(-Math.cos(v.yaw), 0, Math.sin(v.yaw));

    // --- The ground under each wheel -----------------------------------------
    // One sample per wheel, and everything else is derived from those. It
    // used to sample four assumed corners AND then every wheel again, which
    // is twice the work for the same answer, and wrong for a three-axle
    // truck whose middle wheels are nowhere near a corner.
    const t = this.track, b = this.base;
    const wheels = v.wheels || [];
    const n = wheels.length;
    let sum = 0, sumF = 0, cF = 0, sumR = 0, cR = 0, sumL = 0, cL = 0, sumRt = 0, cRt = 0;
    if (n) {
      for (let i = 0; i < n && i < this.travel.length; i++) {
        const w = wheels[i];
        const h = this._sampleAt(w.lx, w.lz);
        this._wy[i] = h;
        sum += h;
        if (w.lz > 0) { sumF += h; cF++; } else { sumR += h; cR++; }
        if (w.lx > 0) { sumL += h; cL++; } else { sumRt += h; cRt++; }
      }
    } else {
      // No wheels (a swapped-in model shell): fall back to four corners.
      sum = this._sampleAt(t, b) + this._sampleAt(-t, b)
        + this._sampleAt(t, -b) + this._sampleAt(-t, -b);
    }
    const count = n || 4;
    const plane = sum / count;
    const front = cF ? sumF / cF : plane, rear = cR ? sumR / cR : plane;
    const left = cL ? sumL / cL : plane, right = cRt ? sumRt / cRt : plane;

    // Rotating +X about the local X axis dips the nose, so following a rise
    // under the front wheels is a NEGATIVE pitch.
    const gPitch = -Math.atan2(front - rear, b * 2);
    const gRoll = Math.atan2(left - right, t * 2);
    // Filtered: raw samples off a kerb step are a staircase, and a body that
    // snaps to them reads as a glitch rather than a suspension.
    const k = Math.min(1, dt * 11);
    this.groundPitch += (gPitch - this.groundPitch) * k;
    this.groundRoll += (gRoll - this.groundRoll) * k;

    // --- Height, and whether the car is on the ground ------------------------
    this.support = plane;
    if (this.y === null) { this.y = plane; this.prevSupport = plane; }
    // The ground's own vertical speed. Going up a ramp this is what the body
    // is given; at the crest the ramp stops climbing, the body does not, and
    // that is the jump.
    const climb = THREE.MathUtils.clamp((this.support - this.prevSupport) / dt, -30, 30);
    this.prevSupport = this.support;

    let impact = 0;
    if (this.airborne) {
      this.vy += G * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= this.support) {
        impact = -this.vy;
        this.y = this.support;
        this.vy = 0;
        this.airborne = false;
        this.airTime = 0;
      }
    } else {
      this.y = this.support;
      // Fast enough up a crest and the car takes off. The threshold is a real
      // one: a kerb produces a climb of a metre or two a second and should
      // never launch anything, a jump ramp produces ten and should.
      this.vy = climb;
      if (climb > 3.2 && Math.abs(v.speed) > 6) {
        this.airborne = true;
        this.vy = Math.min(climb, 14);
      }
    }

    // --- Weight transfer -----------------------------------------------------
    const accel = (v.speed - this.prevSpeed) / dt;
    this.prevSpeed = v.speed;
    let dYaw = v.yaw - this.prevYaw;
    // Wrap, so a car crossing the -pi/pi seam does not snap onto its roof.
    if (dYaw > Math.PI) dYaw -= Math.PI * 2; else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.prevYaw = v.yaw;
    const yawRate = dYaw / dt;
    const lateral = THREE.MathUtils.clamp(v.speed * yawRate, -28, 28);

    // A heavy, tall vehicle leans more and takes longer to settle. The ratio
    // is what tells a bus from a sports car without any extra data.
    const soft = THREE.MathUtils.clamp(s.h / 1.3, 0.75, 2.2) * THREE.MathUtils.clamp(s.mass, 0.7, 2.0);
    const stiff = 150 / soft;
    const damp = 17 / Math.sqrt(soft);

    let pitchT = 0, rollT = 0, heaveT = 0;
    if (!this.airborne) {
      // Positive rotation.x dips the nose and positive rotation.z lifts the
      // car's left, so accelerating (nose UP) is a negative pitch, and
      // turning right — which leans the car onto its LEFT, outer wheels — is
      // a negative roll. Both were the wrong way round: the car dived under
      // power and leaned into its corners like a motorcycle.
      //
      // The clamps are the real numbers rather than generous ones. A car
      // dives and rolls two or three degrees, not seven. Over a 4.5 m body
      // 2.6 degrees still drops the nose a clear 10 cm, and staying inside
      // what the suspension can actually travel is what stops the wheels
      // pulling out of their arches mid-corner.
      pitchT = THREE.MathUtils.clamp(-accel * 0.0045 * soft, -0.045, 0.045);
      rollT = THREE.MathUtils.clamp(lateral * 0.0042 * soft, -0.055, 0.055);
      if (handbrake && Math.abs(v.speed) > 4) pitchT -= 0.012;
      // The landing squat, decaying away.
      this.landing = Math.max(0, this.landing - dt * 2.6);
      heaveT = -this.landing * 0.09;
    } else {
      // In the air the springs hang at full droop and the body floats.
      heaveT = 0.035;
      pitchT = THREE.MathUtils.clamp(this.vy * 0.010, -0.10, 0.10);
    }

    if (impact > 0.6) {
      // A landing: drive the spring rather than teleporting the body, so the
      // compression and the rebound both happen.
      const f = Math.min(1, impact / 16);
      this.heave.v -= 5.5 * f;
      this.pitch.v += (Math.random() - 0.5) * 1.2 * f;
      this.roll.v += (Math.random() - 0.5) * 1.8 * f;
      this.landing = f * 1.6;
      if (v.onLanding) v.onLanding(impact, f);
    }

    spring(this.pitch, pitchT, stiff, damp, dt);
    spring(this.roll, rollT, stiff, damp, dt);
    spring(this.heave, heaveT, stiff * 0.8, damp * 0.9, dt);
    // Hard limits: springs have stops, and a body that passes through its own
    // wheels looks worse than one that runs out of travel.
    this.heave.x = THREE.MathUtils.clamp(this.heave.x, -0.13, 0.09);

    // --- Result --------------------------------------------------------------
    const pitch = this.groundPitch + this.pitch.x;
    const roll = this.groundRoll + this.roll.x;
    this.outPitch = pitch;
    this.outRoll = roll;
    this.outY = this.y + this.heave.x;

    // --- Per-wheel travel ----------------------------------------------------
    // Whatever each corner's ground does that the body's plane did not: the
    // twist. This is the articulation you see when one wheel drops into a
    // gutter and the car does not follow it down.
    // The two tangents are constant across the wheels, so they come out of
    // the loop: eight transcendental calls per car per frame, times every car
    // in sight, is not a rounding error.
    const tanP = Math.tan(-pitch), tanR = Math.tan(roll);
    for (let i = 0; i < n && i < this.travel.length; i++) {
      const w = wheels[i];
      const c = this._wy[i];
      const planeY = plane + tanP * w.lz + tanR * w.lx;
      let d = THREE.MathUtils.clamp(c - planeY, -MAX_TRAVEL, MAX_TRAVEL);
      if (this.airborne) d = -MAX_TRAVEL * 0.7;        // wheels hang in the air
      this.travel[i] += (d - this.travel[i]) * Math.min(1, dt * 14);
      w.mesh.position.y = (w.restY ?? w.mesh.position.y) + this.travel[i] - this.heave.x;
    }

    // --- Over you go ---------------------------------------------------------
    // Land badly sideways, or be tipped past the point of no return, and the
    // car stops being a car and becomes a rigid body until it stops moving.
    if (v.canTumble && Math.abs(roll) > FLIP_ROLL && !this.airborne) {
      v.tumble(Math.sign(roll) * (2 + Math.abs(v.speed) * 0.25));
    } else if (impact > LAND_HARD * 2.1 && Math.abs(roll) > 0.5 && v.canTumble) {
      v.tumble(Math.sign(roll) * impact * 0.28);
    }
    if (impact > LAND_HARD && v.onHardLanding) v.onHardLanding(impact);
  }

  /** Feed the computed attitude into the vehicle's group. */
  apply(group, yaw) {
    group.rotation.order = 'YXZ';
    group.rotation.set(this.outPitch || 0, yaw + Math.PI, this.outRoll || 0);
    if (this.outY !== undefined) group.position.y = this.outY;
  }
}
