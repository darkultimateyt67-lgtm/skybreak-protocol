import * as THREE from 'three';
import { ISLAND_SIZE } from './Island.js';

const _v = new THREE.Vector3();

/**
 * DropPhase — the opening of every match.
 *
 *   RIDE    you're aboard a transport flying a random line across the island.
 *           SPACE to jump. Auto-ejects near the end of the line.
 *   FALL    steerable free-fall. WASD tilts your dive, SHIFT dives harder,
 *           CTRL flares. Terminal velocity ~85 m/s head-down, ~45 flat.
 *   GLIDE   deploys automatically at 120 m above ground. Slow descent, wide
 *           horizontal control, so you pick your exact landing spot.
 *   DONE    handed back to normal movement the instant you touch down.
 *
 * The transport, the glider and the altimeter are all built here; nothing
 * leaks into the normal player controller except a `dropActive` flag.
 */
export class DropPhase {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.active = false;
    this._build();
  }

  _build() {
    // --- Transport: a blunt cargo lifter with engine nacelles -------------
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x3d434e, roughness: 0.6, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.7, metalness: 0.6 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0x120a02, emissive: 0xff6a2a, emissiveIntensity: 3 });

    const box = (w, h, d, x, y, z, m, ry = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      g.add(mesh);
      return mesh;
    };
    box(9, 7, 34, 0, 0, 0, hull);                 // fuselage
    box(7.4, 5, 10, 0, 0.6, -20, hull);           // nose
    box(6, 3.6, 6, 0, 1.2, -25, dark);            // cockpit
    box(38, 1.1, 8, 0, 2.4, 2, hull);             // wing
    box(9, 5.5, 5, 0, 4.2, 15, hull);             // tail fin
    box(16, 0.9, 4, 0, 4.6, 16, hull);            // stabiliser
    for (const sx of [-13, 13]) {
      box(4.6, 4.6, 11, sx, 1.4, 2, dark);        // nacelles
      const glow = box(3.4, 3.4, 1.2, sx, 1.4, 8, lamp);
      glow.userData.engine = true;
    }
    box(8.6, 4.6, 1, 0, -0.6, 17.4, dark);        // open ramp
    for (let i = 0; i < 6; i++) box(0.8, 0.4, 0.8, -3.5 + i * 1.4, -2.6, 17, lamp);
    g.visible = false;
    this.game.scene.add(g);
    this.transport = g;

    // --- Glider: a delta wing on risers ------------------------------------
    const gl = new THREE.Group();
    const canopy = new THREE.MeshStandardMaterial({
      color: 0x2f7fd0, roughness: 0.55, side: THREE.DoubleSide
    });
    const wing = new THREE.Mesh(new THREE.BufferGeometry(), canopy);
    const verts = new Float32Array([
      0, 0, -2.4, -3.6, -0.5, 1.4, 0, -0.15, 1.0,
      0, 0, -2.4, 0, -0.15, 1.0, 3.6, -0.5, 1.4
    ]);
    wing.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    wing.geometry.computeVertexNormals();
    gl.add(wing);
    const riser = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.9 });
    for (const sx of [-1.5, 1.5]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), riser);
      r.position.set(sx, -1.2, 0.3);
      r.rotation.z = sx > 0 ? -0.25 : 0.25;
      gl.add(r);
    }
    gl.visible = false;
    this.game.scene.add(gl);
    this.glider = gl;
  }

  /** Begin the ride. Picks a random flight line straight across the island. */
  start() {
    const g = this.game;
    const R = ISLAND_SIZE * 0.78;
    const a = Math.random() * Math.PI * 2;
    this.lineStart = new THREE.Vector3(Math.cos(a) * R, 260, Math.sin(a) * R);
    this.lineEnd = new THREE.Vector3(Math.cos(a + Math.PI) * R, 260, Math.sin(a + Math.PI) * R);
    this.lineDir = this.lineEnd.clone().sub(this.lineStart).normalize();
    this.lineLen = this.lineStart.distanceTo(this.lineEnd);
    this.rideT = 0;
    this.rideSpeed = 118;

    this.state = 'ride';
    this.active = true;
    this.transport.visible = true;
    this.glider.visible = false;
    this.vel = new THREE.Vector3();

    // Park the player inside the hold; the ride drives the camera directly.
    g.player.velocity.set(0, 0, 0);
    g.player.alive = true;

    g.hud.brToast('DROP ZONE', 'SPACE to jump  ·  W/A/S/D to steer  ·  SHIFT to dive');
    if (g.audio.dropshipBed) g.audio.dropshipBed(true);
  }

  _deployGlider() {
    this.state = 'glide';
    this.glider.visible = true;
    this.game.hud.brToast('GLIDER DEPLOYED', '');
    if (this.game.audio.gliderDeploy) this.game.audio.gliderDeploy();
  }

  _land() {
    this.state = 'done';
    this.active = false;
    this.transport.visible = false;
    this.glider.visible = false;
    const g = this.game;
    g.player.velocity.set(0, 0, 0);
    g.hud.setAltimeter(null);
    if (g.audio.dropshipBed) g.audio.dropshipBed(false);
    if (g.audio.land) g.audio.land(0.5);
    g.hud.brToast('LANDED', 'Find a weapon');
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const input = g.input;
    const p = g.player;
    const ground = g.world.island ? g.world.island.heightAt(p.position.x, p.position.z) : 0;

    if (this.state === 'ride') {
      // Fly the transport along its line.
      this.rideT += this.rideSpeed * dt;
      const t = Math.min(1, this.rideT / this.lineLen);
      _v.copy(this.lineStart).addScaledVector(this.lineDir, this.rideT);
      this.transport.position.copy(_v);
      this.transport.rotation.y = Math.atan2(this.lineDir.x, this.lineDir.z);

      // Rider sits at the open ramp looking out.
      p.position.set(_v.x, _v.y - 4, _v.z);
      p.velocity.set(0, 0, 0);

      const jump = input.pressed('Space') || input.pressed('KeyF');
      if (jump || t > 0.94) {
        this.state = 'fall';
        this.vel.copy(this.lineDir).multiplyScalar(this.rideSpeed * 0.35);
        this.vel.y = -6;
        g.hud.brToast('FREE FALL', 'SHIFT to dive  ·  glider opens automatically');
        if (g.audio.windRush) g.audio.windRush(true);
      }
      g.hud.setAltimeter(Math.round(p.position.y - ground));
      return;
    }

    if (this.state === 'fall' || this.state === 'glide') {
      const gliding = this.state === 'glide';
      // Steering: camera-relative, same as normal movement.
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const wish = new THREE.Vector3();
      if (input.key('KeyW')) wish.add(fwd);
      if (input.key('KeyS')) wish.sub(fwd);
      if (input.key('KeyD')) wish.add(right);
      if (input.key('KeyA')) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize();

      if (gliding) {
        // Glider: gentle sink, strong horizontal authority.
        const accel = 26;
        this.vel.x += wish.x * accel * dt;
        this.vel.z += wish.z * accel * dt;
        const h = Math.hypot(this.vel.x, this.vel.z);
        const cap = 26;
        if (h > cap) { this.vel.x *= cap / h; this.vel.z *= cap / h; }
        const sink = input.key('ShiftLeft') ? -18 : -9.5;
        this.vel.y += (sink - this.vel.y) * Math.min(1, dt * 3);
      } else {
        // Free fall: dive to go faster, flare to slow down.
        const diving = input.key('ShiftLeft');
        const flaring = input.key('ControlLeft') || input.key('KeyC');
        const term = diving ? -85 : flaring ? -32 : -52;
        this.vel.y += (term - this.vel.y) * Math.min(1, dt * 0.9);
        const accel = diving ? 34 : 22;
        this.vel.x += wish.x * accel * dt;
        this.vel.z += wish.z * accel * dt;
        const h = Math.hypot(this.vel.x, this.vel.z);
        const cap = diving ? 62 : 40;
        if (h > cap) { this.vel.x *= cap / h; this.vel.z *= cap / h; }
      }

      p.position.addScaledVector(this.vel, dt);

      const alt = p.position.y - ground;
      g.hud.setAltimeter(Math.round(alt));

      // Auto-deploy, then land.
      if (!gliding && alt < 120) this._deployGlider();
      if (alt <= 0.4) {
        p.position.y = ground;
        this._land();
        if (g.audio.windRush) g.audio.windRush(false);
        return;
      }

      // Glider rides above and banks into turns.
      if (gliding) {
        this.glider.position.set(p.position.x, p.position.y + 3.2, p.position.z);
        this.glider.rotation.y = p.yaw;
        const lateral = this.vel.x * Math.cos(p.yaw) - this.vel.z * Math.sin(p.yaw);
        this.glider.rotation.z = THREE.MathUtils.clamp(-lateral * 0.02, -0.5, 0.5);
      }

      // Keep the camera glued to the falling body.
      g.camera.position.set(p.position.x, p.position.y + p.eyeHeight, p.position.z);
      g.camera.rotation.set(p.pitch, p.yaw, 0);
    }
  }

  /** Look control still runs during the drop. */
  updateLook(dt) {
    const g = this.game;
    const input = g.input;
    const p = g.player;
    const sens = 0.0022 * g.settings.sensitivity;
    p.yaw -= input.mouseDX * sens;
    p.pitch -= input.mouseDY * sens * (g.settings.invertY ? -1 : 1);
    p.pitch = THREE.MathUtils.clamp(p.pitch, -1.45, 1.45);
    g.camera.position.set(p.position.x, p.position.y + p.eyeHeight, p.position.z);
    g.camera.rotation.set(p.pitch, p.yaw, 0);
  }

  dispose() {
    this.game.scene.remove(this.transport);
    this.game.scene.remove(this.glider);
  }
}
