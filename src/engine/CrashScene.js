import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * CrashScene — the opening. You are strapped into the VANTAGE-6 troop bay on
 * final approach when HELIOS puts a rail slug through the portside engine.
 *
 * It plays from inside the dropship: you see the bay walls, the jump seats,
 * Daniel across from you, the door light, and the forest coming up through
 * the ruptured hull. Camera is bolted to the airframe, so every shudder,
 * spin and impact is felt rather than described. Total run ~17 s, skippable
 * with SPACE.
 *
 * Beats (seconds):
 *   0.0  cruising, engine hum, Daniel talking
 *   3.0  hit — alarms, spin starts, sparks
 *   7.5  hull breach, treetops visible, debris tearing loose
 *  12.5  ground impact — whiteout, hard stop
 *  14.0  black, ringing, Daniel calling your name
 *  16.5  hand off to gameplay at the wreck
 */
export class CrashScene {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.t = 0;
    this.duration = 17;
    this.group = null;
    this._shake = new THREE.Vector3();
    this._spin = 0;
  }

  /** Build the troop bay interior. Torn down again in dispose(). */
  _build() {
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.65, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.7, metalness: 0.5 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e2a30, roughness: 0.85 });
    const warn = new THREE.MeshStandardMaterial({
      color: 0x2b0a06, emissive: 0xff3b30, emissiveIntensity: 2.2, roughness: 0.5
    });

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      g.add(m);
      return m;
    };

    // Bay shell: floor, ceiling, two walls, forward bulkhead.
    add(new THREE.BoxGeometry(3.2, 0.16, 8), dark, 0, -0.9, 0);
    add(new THREE.BoxGeometry(3.2, 0.16, 8), hull, 0, 1.9, 0);
    add(new THREE.BoxGeometry(0.16, 2.8, 8), hull, -1.6, 0.5, 0);
    add(new THREE.BoxGeometry(0.16, 2.8, 8), hull, 1.6, 0.5, 0);
    add(new THREE.BoxGeometry(3.2, 2.8, 0.16), hull, 0, 0.5, -4);

    // Ribs down both walls.
    for (let i = -3; i <= 3; i++) {
      add(new THREE.BoxGeometry(0.1, 2.7, 0.22), dark, -1.5, 0.5, i * 1.1);
      add(new THREE.BoxGeometry(0.1, 2.7, 0.22), dark, 1.5, 0.5, i * 1.1);
    }

    // Jump seats along both walls, plus Daniel in the one opposite you.
    for (let i = -2; i <= 2; i++) {
      add(new THREE.BoxGeometry(0.5, 0.1, 0.5), seatMat, -1.15, -0.35, i * 1.3);
      add(new THREE.BoxGeometry(0.5, 0.7, 0.1), seatMat, -1.32, 0.02, i * 1.3);
      add(new THREE.BoxGeometry(0.5, 0.1, 0.5), seatMat, 1.15, -0.35, i * 1.3);
      add(new THREE.BoxGeometry(0.5, 0.7, 0.1), seatMat, 1.32, 0.02, i * 1.3);
    }

    // Daniel, strapped in across the bay.
    const dan = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb5825e, roughness: 0.85 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.85 });
    const dAdd = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      dan.add(m);
      return m;
    };
    dAdd(new THREE.BoxGeometry(0.46, 0.6, 0.28), jacket, 0, 0.05, 0);
    dAdd(new THREE.BoxGeometry(0.42, 0.42, 0.33), gear, 0, 0.08, 0);
    dAdd(new THREE.BoxGeometry(0.14, 0.34, 0.18), jacket, -0.3, 0.02, 0.06);
    dAdd(new THREE.BoxGeometry(0.14, 0.34, 0.18), jacket, 0.3, 0.02, 0.06);
    dAdd(new THREE.BoxGeometry(0.18, 0.42, 0.2), gear, -0.13, -0.42, 0.14);
    dAdd(new THREE.BoxGeometry(0.18, 0.42, 0.2), gear, 0.13, -0.42, 0.14);
    this._danHead = dAdd(new THREE.SphereGeometry(0.17, 14, 12), skin, 0, 0.5, 0.02);
    dAdd(new THREE.BoxGeometry(0.3, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.95 }), 0, 0.62, 0);
    dan.position.set(1.05, 0.05, -0.6);
    dan.rotation.y = -Math.PI / 2;
    g.add(dan);
    this._daniel = dan;

    // Overhead strip lights + the red jump light that trips when we're hit.
    for (let i = -2; i <= 2; i++) {
      add(new THREE.BoxGeometry(0.5, 0.05, 0.12), new THREE.MeshStandardMaterial({
        color: 0x0a1014, emissive: 0xbcd8e8, emissiveIntensity: 1.4
      }), 0, 1.78, i * 1.5);
    }
    this._warnLight = add(new THREE.BoxGeometry(0.3, 0.12, 0.12), warn, 0, 1.5, -3.9);
    this._warnLight.material = warn.clone();
    this._warnLight.material.emissiveIntensity = 0;

    // The rear ramp — it tears away at the breach and becomes your window.
    this._ramp = add(new THREE.BoxGeometry(3.0, 2.6, 0.14), hull, 0, 0.4, 4);

    // Interior fill light so the bay isn't a black box. Both are borrowed
    // from the effects pool rather than added: a light added here and
    // removed at touchdown changed the scene's light count twice, and each
    // change recompiles every shader — a freeze just as control is handed over.
    const fx = this.game.effects;
    const lamp = fx.reserveLight() || new THREE.PointLight();
    lamp.color.setHex(0xbcd8e8); lamp.intensity = 12; lamp.distance = 12; lamp.decay = 2;
    this._lamp = lamp;
    const red = fx.reserveLight() || new THREE.PointLight();
    red.color.setHex(0xff3b30); red.intensity = 0; red.distance = 10; red.decay = 2;
    this._redLamp = red;
    this._lampAt = [new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1.4, -2)];

    this.game.scene.add(g);
    this.group = g;
  }

  start() {
    this.active = true;
    this.t = 0;
    this._spin = 0;
    this._impacted = false;
    this._beat = 0;
    this._build();
    this.game.audio.ensure();
    this.game.audio.engineStart();
    this.game.hud.showHUD(false);
    this.game.hud.setSkipHint(true);
  }

  dispose() {
    if (this._lamp) { this.game.effects.releaseLight(this._lamp); this._lamp = null; }
    if (this._redLamp) { this.game.effects.releaseLight(this._redLamp); this._redLamp = null; }
    if (this.group) {
      this.game.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        }
      });
      this.group = null;
    }
    this.active = false;
    this.game.audio.engineStop();
    this.game.hud.setSkipHint(false);
  }

  /** Advance the sequence. Returns true when it's finished. */
  update(dt) {
    if (!this.active) return true;
    this.t += dt;
    const t = this.t;
    const game = this.game;
    // The borrowed lamps are not children of the bay, so carry them with it.
    if (this.group && this._lamp) {
      this.group.updateMatrixWorld();
      this._lamp.position.copy(this._lampAt[0]).applyMatrix4(this.group.matrixWorld);
      this._redLamp.position.copy(this._lampAt[1]).applyMatrix4(this.group.matrixWorld);
    }
    const cam = game.camera;
    const fade = document.getElementById('fade');

    // ---- scripted beats -------------------------------------------------
    const beat = (n, at, fn) => {
      if (this._beat < n && t >= at) { this._beat = n; fn(); }
    };
    beat(1, 0.6, () => game.hud.comms('Two minutes to the drop. Stay loose, Vector — in and out.', 'DANIEL'));
    beat(2, 3.0, () => {
      // The hit.
      game.audio.explosion();
      game.audio.alarm();
      this._warnLight.material.emissiveIntensity = 3;
      game.hud.comms('WE’RE HIT! Portside engine — HELIOS has a rail battery on the ridge!', 'DANIEL');
      for (let i = 0; i < 3; i++) {
        _v.set((Math.random() - 0.5) * 2, 1.2, -3 + Math.random() * 2);
        game.effects.burst(_v, { count: 14, color: 0xffc873, speed: 6, life: 0.6 });
      }
    });
    beat(3, 5.2, () => game.hud.comms('Hydraulics are gone! Brace — BRACE!', 'DANIEL'));
    beat(4, 7.5, () => {
      // Hull breach: the ramp tears off.
      game.audio.explosion();
      this._rampGone = true;
      game.hud.comms('Ramp’s gone! Hold onto something!', 'DANIEL');
    });
    beat(5, 10.5, () => game.hud.comms('Trees! TREES — hang on!!', 'DANIEL'));
    beat(6, 12.5, () => {
      // Ground impact.
      this._impacted = true;
      game.audio.explosion();
      game.audio.engineStop();
      fade.style.transition = 'opacity 0.12s linear';
      fade.style.opacity = '1';
    });
    beat(7, 14.2, () => {
      game.audio.tinnitus();
      game.hud.comms('…Vector. VECTOR! Get up — the fuel line’s cooking off!', 'DANIEL');
    });
    beat(8, 15.6, () => {
      fade.style.transition = 'opacity 2.4s ease';
      fade.style.opacity = '0';
    });

    // ---- airframe motion --------------------------------------------------
    const bay = this.group;
    if (!this._impacted) {
      // Descent: cruise → violent spin as control is lost.
      const sev = t < 3 ? 0.06 : Math.min((t - 3) / 6, 1);
      this._spin += dt * sev * 2.4;
      bay.position.y = Math.max(0, 40 - Math.pow(Math.max(0, t - 3) / 9.5, 2) * 42);
      bay.rotation.z = Math.sin(this._spin * 1.7) * 0.5 * sev;
      bay.rotation.x = -0.12 - sev * 0.55 + Math.sin(this._spin * 2.3) * 0.18 * sev;
      bay.rotation.y = this._spin * 0.55 * sev;

      // Shake amplitude ramps with severity.
      const amp = 0.012 + sev * 0.10;
      this._shake.set(
        (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp * 0.6
      );

      // Sparks and smoke pouring through the bay as it comes apart.
      if (t > 3 && Math.random() < sev * 0.7) {
        _v.set(
          bay.position.x + (Math.random() - 0.5) * 2.6,
          bay.position.y + Math.random() * 2,
          bay.position.z - 3 + Math.random() * 7
        );
        game.effects.burst(_v, {
          count: 3, color: Math.random() < 0.5 ? 0xffc873 : 0x3a3d42,
          speed: 4, life: 0.5, gravity: -2
        });
      }
      if (this._rampGone && this._ramp.parent) bay.remove(this._ramp);

      // Warning light strobes, cabin light browns out.
      if (t > 3) {
        const strobe = (Math.sin(t * 14) * 0.5 + 0.5);
        this._warnLight.material.emissiveIntensity = 1 + strobe * 4;
        this._redLamp.intensity = 6 + strobe * 14;
        this._lamp.intensity = 12 * (1 - sev * 0.7) * (Math.random() > 0.08 ? 1 : 0.2);
      }
      // Daniel braces harder as it gets worse.
      this._daniel.rotation.x = -sev * 0.5;
      this._danHead.position.y = 0.5 - sev * 0.12;
    } else {
      // Post-impact: everything stops dead, wreck settles.
      const s = t - 12.5;
      bay.position.y = 0;
      bay.rotation.z = 0.62;
      bay.rotation.x = 0.3;
      const settle = Math.max(0, 1 - s * 2);
      this._shake.set(
        (Math.random() - 0.5) * 0.25 * settle,
        (Math.random() - 0.5) * 0.25 * settle,
        0
      );
      this._lamp.intensity = 2 + Math.sin(s * 30) * (Math.random() > 0.6 ? 1.5 : 0);
      this._redLamp.intensity = 3;
    }

    // Camera rides in the seat, taking every bit of the airframe's motion.
    const seat = _v.set(-0.95, 0.45, 0.4).applyEuler(bay.rotation).add(bay.position);
    cam.position.copy(seat).add(this._shake);
    cam.rotation.set(
      bay.rotation.x * 0.85 + this._shake.y * 2.2,
      bay.rotation.y * 0.85 + Math.PI * 0.5 + this._shake.x * 2.2,
      bay.rotation.z * 0.7 + this._shake.x * 1.4
    );

    // Skip.
    if (game.input.pressed('Space') || game.input.pressed('Enter')) this.t = this.duration;

    return this.t >= this.duration;
  }
}
