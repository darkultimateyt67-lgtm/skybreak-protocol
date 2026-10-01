import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _step = new THREE.Vector3();
const _v = new THREE.Vector3();

const GRAVITY = 18;

/**
 * Utilities — throwable equipment.
 *
 *   G — FRAG CHARGE: heavy blast, 130 damage in 7 m.
 *   Q — RECON PULSE: 60 damage in 6 m, and pings every SENTINEL on the
 *       minimap for 8 seconds (they glow through the map's clutter).
 *
 * Projectiles fly a simple ballistic arc and stick where they first land;
 * both are restocked at the supply uplink (B).
 */
export class Utilities {
  constructor(game) {
    this.game = game;
    this.frags = 2;
    this.recons = 1;
    this.maxFrags = 4;
    this.maxRecons = 3;
    this.live = [];

    this._geo = new THREE.SphereGeometry(0.12, 10, 8);
    this._matFrag = new THREE.MeshStandardMaterial({ color: 0x20242e, emissive: 0xff3b30, emissiveIntensity: 1.5 });
    this._matRecon = new THREE.MeshStandardMaterial({ color: 0x20242e, emissive: 0x37e6ff, emissiveIntensity: 1.5 });
  }

  reset() {
    this.frags = 2;
    this.recons = 1;
    for (const p of this.live) this.game.scene.remove(p.mesh);
    this.live = [];
    this._pushHUD();
  }

  throwFrag() { this._throw('frag'); }
  throwRecon() { this._throw('recon'); }

  _throw(type) {
    if (type === 'frag' ? this.frags <= 0 : this.recons <= 0) {
      this.game.audio.reload('out'); // dry click
      return;
    }
    if (type === 'frag') this.frags--; else this.recons--;

    const cam = this.game.camera;
    cam.getWorldDirection(_dir);
    const mesh = new THREE.Mesh(this._geo, type === 'frag' ? this._matFrag : this._matRecon);
    mesh.position.copy(cam.position).addScaledVector(_dir, 0.6);
    this.game.scene.add(mesh);

    this.live.push({
      type,
      mesh,
      vel: _dir.clone().multiplyScalar(16).add(_v.set(0, 3.5, 0)),
      fuse: 1.4,
      landed: false
    });
    this.game.audio.jump(); // whip/toss
    this._pushHUD();
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.fuse -= dt;

      if (!p.landed) {
        p.vel.y -= GRAVITY * dt;
        _step.copy(p.vel).multiplyScalar(dt);
        const dist = _step.length();
        if (dist > 1e-6) {
          _dir.copy(_step).divideScalar(dist);
          const hit = this.game.physics.raycast(p.mesh.position, _dir, dist + 0.12);
          if (hit) {
            p.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.12);
            p.landed = true;
          } else {
            p.mesh.position.add(_step);
          }
        }
        p.mesh.rotation.x += dt * 9;
      }

      // Blink faster as the fuse runs down.
      p.mesh.material.emissiveIntensity = 1.5 + Math.sin(p.fuse * 25) * 1.2;

      if (p.fuse <= 0) {
        this._explode(p);
        this.game.scene.remove(p.mesh);
        this.live.splice(i, 1);
      }
    }
  }

  _explode(p) {
    const game = this.game;
    const pos = p.mesh.position;
    const isFrag = p.type === 'frag';
    const radius = isFrag ? 7 : 6;
    const baseDmg = isFrag ? 130 : 60;

    game.effects.explosion(pos, isFrag ? 0xff7a3d : 0x37e6ff);
    game.audio.explosion();

    for (const e of game.enemies.list) {
      if (!e.alive) continue;
      _v.set(e.position.x, e.position.y + 1, e.position.z);
      const d = _v.distanceTo(pos);
      if (d < radius) {
        e.damage(baseDmg * (1 - (d / radius) * 0.7), false, isFrag ? 'FRAG CHARGE' : 'RECON PULSE');
      }
    }

    // Player is not immune to their own frags.
    const pd = game.player.position.distanceTo(pos);
    if (isFrag && pd < radius * 0.8) {
      game.player.damage(60 * (1 - pd / (radius * 0.8)), pos);
    }

    if (!isFrag) {
      game.revealUntil = performance.now() * 0.001 + 8;
      game.hud.comms('Recon pulse live — hostile positions marked for 8 seconds.', 'TACNET');
    }
    this._pushHUD();
  }

  /** Shop restock. */
  addFrag() {
    if (this.frags >= this.maxFrags) return false;
    this.frags++;
    this._pushHUD();
    return true;
  }

  addRecon() {
    if (this.recons >= this.maxRecons) return false;
    this.recons++;
    this._pushHUD();
    return true;
  }

  _pushHUD() {
    this.game.hud.setUtilities(this.frags, this.recons);
  }
}
