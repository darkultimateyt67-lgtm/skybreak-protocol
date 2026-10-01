import * as THREE from 'three';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Building — harvest materials, place structures.
 *
 * Four piece types on a 5 m grid: WALL, RAMP, FLOOR, CONE. Placement previews
 * a translucent ghost in front of you and snaps it to the grid cell you're
 * looking at, so builds line up into towers and boxes the way they should.
 *
 * Materials come from hitting the world with the harvesting tool: trees give
 * wood, rock gives stone, metal structures give metal. Each material has its
 * own piece HP, so a metal wall soaks far more than a wood one.
 */

export const GRID = 5;          // metres per cell
const WALL_H = 5;
const MAX_PIECES = 420;         // hard cap so a match can't melt the frame time

export const MATERIALS = {
  wood:  { id: 'wood',  name: 'WOOD',  color: 0x9a6f3f, hp: 140, cost: 10, buildTime: 0.55 },
  stone: { id: 'stone', name: 'STONE', color: 0x8d8d88, hp: 280, cost: 10, buildTime: 0.75 },
  metal: { id: 'metal', name: 'METAL', color: 0x6f7a86, hp: 460, cost: 10, buildTime: 0.95 }
};

export const PIECES = ['wall', 'ramp', 'floor', 'cone'];

/** One placed structure. */
class Piece {
  constructor(sys, type, mat, cell, yaw) {
    this.sys = sys;
    this.type = type;
    this.mat = mat;
    this.cell = cell;
    this.yaw = yaw;
    this.maxHp = mat.hp;
    // Pieces start at a fraction of their HP and "build up" over a moment,
    // which is what makes panic-walling feel fair to shoot through.
    this.hp = mat.hp * 0.35;
    this.buildT = 0;
    this.built = false;
    this._build();
  }

  _build() {
    const m = new THREE.MeshStandardMaterial({
      color: this.mat.color, roughness: 0.85, metalness: this.mat.id === 'metal' ? 0.6 : 0.05
    });
    this.material = m;
    let geo;
    const { x, y, z } = this.cell;

    if (this.type === 'wall') {
      geo = new THREE.BoxGeometry(GRID, WALL_H, 0.4);
    } else if (this.type === 'floor') {
      geo = new THREE.BoxGeometry(GRID, 0.4, GRID);
    } else if (this.type === 'ramp') {
      geo = new THREE.BoxGeometry(GRID, 0.4, GRID * 1.42);
    } else {
      geo = new THREE.ConeGeometry(GRID * 0.7, WALL_H * 0.8, 4);
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (this.type === 'wall') mesh.position.set(x, y + WALL_H / 2, z);
    else if (this.type === 'floor') mesh.position.set(x, y, z);
    else if (this.type === 'ramp') {
      mesh.position.set(x, y + WALL_H / 2, z);
      mesh.rotation.x = -Math.atan2(WALL_H, GRID);
    } else {
      mesh.position.set(x, y + WALL_H * 0.4, z);
      mesh.rotation.y = Math.PI / 4;
    }
    mesh.rotation.y += this.yaw;

    this.sys.game.scene.add(mesh);
    this.mesh = mesh;

    // Collider matching the visual.
    const q = new THREE.Quaternion().setFromEuler(mesh.rotation);
    const size = this.type === 'wall' ? new THREE.Vector3(GRID, WALL_H, 0.4)
      : this.type === 'floor' ? new THREE.Vector3(GRID, 0.4, GRID)
        : this.type === 'ramp' ? new THREE.Vector3(GRID, 0.7, GRID * 1.42)
          : new THREE.Vector3(GRID * 1.1, WALL_H * 0.8, GRID * 1.1);
    this.collider = this.sys.game.physics.addBox(mesh.position, size, q, {
      surface: this.mat.id === 'wood' ? 'wood' : this.mat.id === 'stone' ? 'stone' : 'metal'
    });
  }

  update(dt) {
    if (this.built) return;
    this.buildT += dt;
    const k = Math.min(1, this.buildT / this.mat.buildTime);
    this.hp = this.maxHp * (0.35 + 0.65 * k);
    // Rise into place while building.
    this.material.emissive = this.material.emissive || new THREE.Color();
    this.material.opacity = 1;
    if (k >= 1) this.built = true;
  }

  damage(amount) {
    this.hp -= amount;
    // Damage shows as darkening.
    const f = Math.max(0.25, this.hp / this.maxHp);
    this.material.color.setHex(this.mat.color).multiplyScalar(0.45 + f * 0.55);
    if (this.hp <= 0) this.sys.destroy(this);
  }

  dispose() {
    this.sys.game.scene.remove(this.mesh);
    const boxes = this.sys.game.physics.boxes;
    const i = boxes.indexOf(this.collider);
    if (i >= 0) boxes.splice(i, 1);
  }
}

export class Building {
  constructor(game) {
    this.game = game;
    this.pieces = [];
    this.mats = { wood: 0, stone: 0, metal: 0 };
    this.selected = 'wall';
    this.material = 'wood';
    this.enabled = false;
    this._ghost = null;
    this._harvestCd = 0;
  }

  reset() {
    for (const p of this.pieces) p.dispose();
    this.pieces = [];
    this.mats = { wood: 0, stone: 0, metal: 0 };
    this.selected = 'wall';
    this.material = 'wood';
    this._ensureGhost();
    this._ghost.visible = false;
  }

  add(kind, n) {
    this.mats[kind] = Math.min(999, (this.mats[kind] || 0) + n);
    this.game.hud.setMaterials?.(this.mats);
  }

  _ensureGhost() {
    if (this._ghost) return;
    const m = new THREE.MeshBasicMaterial({
      color: 0x6ee7ff, transparent: true, opacity: 0.32,
      depthWrite: false, side: THREE.DoubleSide
    });
    const g = new THREE.Mesh(new THREE.BoxGeometry(GRID, WALL_H, 0.4), m);
    g.visible = false;
    this.game.scene.add(g);
    this._ghost = g;
    this._ghostMat = m;
  }

  /** Snap a world position to the build grid. */
  _snap(p, type) {
    const gx = Math.round(p.x / GRID) * GRID;
    const gz = Math.round(p.z / GRID) * GRID;
    // Floors snap to whole storeys; walls sit on the storey below.
    const gy = Math.round(p.y / WALL_H) * WALL_H;
    return { x: gx, y: gy, z: gz };
  }

  /** Where the piece would go, based on where you're looking. */
  _target() {
    const g = this.game;
    const cam = g.camera;
    cam.getWorldDirection(_dir);
    _v.copy(cam.position).addScaledVector(_dir, 6.5);
    // Drop the aim point onto the ground if it's floating over terrain.
    const island = g.world.island;
    if (island) {
      const gh = island.heightAt(_v.x, _v.z);
      if (_v.y < gh) _v.y = gh;
    }
    const cell = this._snap(_v, this.selected);
    // Face walls along the axis you're looking down.
    const yaw = Math.round(g.player.yaw / (Math.PI / 2)) * (Math.PI / 2);
    return { cell, yaw };
  }

  canAfford() {
    return (this.mats[this.material] || 0) >= MATERIALS[this.material].cost;
  }

  place() {
    if (this.pieces.length >= MAX_PIECES) return false;
    if (!this.canAfford()) {
      this.game.hud.brToast('NO MATERIALS', `Harvest ${MATERIALS[this.material].name.toLowerCase()}`);
      return false;
    }
    const { cell, yaw } = this._target();
    // One piece per cell per type.
    const dup = this.pieces.some((p) =>
      p.type === this.selected && p.cell.x === cell.x && p.cell.y === cell.y && p.cell.z === cell.z);
    if (dup) return false;

    this.mats[this.material] -= MATERIALS[this.material].cost;
    this.game.hud.setMaterials?.(this.mats);
    const piece = new Piece(this, this.selected, MATERIALS[this.material], cell, yaw);
    this.pieces.push(piece);
    this.game.audio.buildPlace?.();
    return true;
  }

  /** Remove the piece you're looking at, refunding nothing (as in the genre). */
  removeAimed() {
    const g = this.game;
    g.camera.getWorldDirection(_dir);
    let best = null;
    let bestD = 8;
    for (const p of this.pieces) {
      const d = p.mesh.position.distanceTo(g.camera.position);
      if (d > bestD) continue;
      _v.copy(p.mesh.position).sub(g.camera.position).normalize();
      if (_v.dot(_dir) > 0.93) { best = p; bestD = d; }
    }
    if (best) { this.destroy(best); return true; }
    return false;
  }

  destroy(piece) {
    const i = this.pieces.indexOf(piece);
    if (i >= 0) this.pieces.splice(i, 1);
    // Debris burst in the piece's colour.
    this.game.effects.burst(piece.mesh.position, {
      count: 16, color: piece.mat.color, speed: 4.5, life: 0.7, gravity: 16
    });
    this.game.audio.buildBreak?.();
    piece.dispose();
  }

  /** Called when a bullet hits a build piece collider. */
  damageCollider(collider, amount) {
    const piece = this.pieces.find((p) => p.collider === collider);
    if (piece) { piece.damage(amount); return true; }
    return false;
  }

  /**
   * Swing the harvesting tool. Returns what was gathered so the caller can
   * play feedback.
   */
  harvest() {
    const g = this.game;
    if (this._harvestCd > 0) return null;
    this._harvestCd = 0.45;
    g.camera.getWorldDirection(_dir);
    const hit = g.physics.raycast(g.camera.position, _dir, 4.2);
    if (!hit) return null;

    const surf = hit.box.surface || 'metal';
    let kind = null;
    if (surf === 'wood') kind = 'wood';
    else if (surf === 'stone' || surf === 'soil') kind = 'stone';
    else kind = 'metal';

    // Chewing on your own build pieces just breaks them.
    if (this.damageCollider(hit.box, 60)) {
      g.effects.impact(hit.point, hit.normal, 0xffc873, surf);
      return { kind: null, broke: true };
    }

    const amount = 14 + Math.floor(Math.random() * 10);
    this.add(kind, amount);
    g.effects.impact(hit.point, hit.normal, 0xffc873, surf);
    g.effects.burst(hit.point, {
      count: 8, color: MATERIALS[kind].color, speed: 3.6, life: 0.5, gravity: 12, dir: hit.normal, spread: 0.9
    });
    g.audio.harvest?.(kind);
    return { kind, amount };
  }

  update(dt) {
    this._harvestCd = Math.max(0, this._harvestCd - dt);
    for (const p of this.pieces) p.update(dt);

    // Ghost preview only while build mode is on.
    this._ensureGhost();
    if (!this.enabled) { this._ghost.visible = false; return; }

    const { cell, yaw } = this._target();
    const gh = this._ghost;
    gh.visible = true;
    const affordable = this.canAfford();
    this._ghostMat.color.setHex(affordable ? 0x6ee7ff : 0xff5a5a);

    // Reshape the ghost to the selected piece.
    const want = this.selected;
    if (gh.userData.shape !== want) {
      gh.geometry.dispose();
      gh.geometry = want === 'wall' ? new THREE.BoxGeometry(GRID, WALL_H, 0.4)
        : want === 'floor' ? new THREE.BoxGeometry(GRID, 0.4, GRID)
          : want === 'ramp' ? new THREE.BoxGeometry(GRID, 0.4, GRID * 1.42)
            : new THREE.ConeGeometry(GRID * 0.7, WALL_H * 0.8, 4);
      gh.userData.shape = want;
    }
    gh.rotation.set(0, yaw, 0);
    if (want === 'wall') gh.position.set(cell.x, cell.y + WALL_H / 2, cell.z);
    else if (want === 'floor') gh.position.set(cell.x, cell.y, cell.z);
    else if (want === 'ramp') {
      gh.position.set(cell.x, cell.y + WALL_H / 2, cell.z);
      gh.rotation.x = -Math.atan2(WALL_H, GRID);
    } else {
      gh.position.set(cell.x, cell.y + WALL_H * 0.4, cell.z);
      gh.rotation.y += Math.PI / 4;
    }
  }
}
