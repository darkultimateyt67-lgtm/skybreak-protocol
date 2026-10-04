import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

/**
 * 3D models staff drop into the world from a link (.glb / .gltf).
 *
 * A creator's model is saved to the database and loaded into the map for
 * every player from then on. An admin's model exists only in their own game
 * and is gone when they reload. Either way it is added to the current world's
 * group, so it is cleaned up with the world like everything else.
 */
export class PlacedModels {
  constructor(game) {
    this.game = game;
    this.items = [];     // { id, data, obj, saved }
    this._world = null;
    this._loadedFor = null;
  }

  /** Forget everything when the world has been rebuilt underneath us. */
  _sync() {
    if (this._world !== this.game.world) {
      this._world = this.game.world;
      this.items = [];
      this._loadedFor = null;
    }
  }

  /** Load the creator-saved models for the current map, once per world. */
  async loadSaved() {
    this._sync();
    const online = this.game.online;
    const mapId = this.game.world.mapId;
    if (!online || !online.enabled || this._loadedFor === mapId) return;
    this._loadedFor = mapId;
    let list = [];
    try {
      list = await online.worldModels(mapId);
    } catch (e) {
      console.warn('[models] could not read saved models:', e);
    }
    for (const m of list) {
      this._add(m, true, m.id).catch((e) => console.warn('[models] skipped', m.url, e));
    }
  }

  /**
   * Put a model in front of the player. `save` writes it into the game for
   * everyone (creators only).
   */
  async placeInFront({ url, scale = 1, solid = true, name = '' }, save) {
    this._sync();
    const p = this.game.player;
    const yaw = p.yaw;
    const data = {
      url: String(url).trim(),
      name: name || String(url).split('/').pop().split('?')[0].slice(0, 40),
      x: +(p.position.x - Math.sin(yaw) * 8).toFixed(2),
      y: +(p.position.y - 0).toFixed(2),
      z: +(p.position.z - Math.cos(yaw) * 8).toFixed(2),
      rotY: +yaw.toFixed(3),
      scale: Math.max(0.01, Math.min(500, +scale || 1)),
      solid: !!solid
    };
    let id = 'local-' + Math.random().toString(36).slice(2, 9);
    // Load first: a bad link should fail before anything is saved.
    const item = await this._add(data, false, id);
    if (save) {
      id = await this.game.online.saveWorldModel(this.game.world.mapId, data);
      item.id = id;
      item.saved = true;
    }
    return item;
  }

  async remove(item) {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    if (item.saved) await this.game.online.deleteWorldModel(this.game.world.mapId, item.id);
    this.items.splice(i, 1);
    item.obj.parent?.remove(item.obj);
    // Its collider stays until the world is rebuilt; harmless, and the
    // physics world has no per-box removal.
  }

  async _add(data, saved, id) {
    const gltf = await loader.loadAsync(data.url);
    const root = gltf.scene;
    // Sit it on the ground, centred on its own footprint.
    _box.setFromObject(root);
    _box.getCenter(_centre);
    root.position.set(-_centre.x, -_box.min.y, -_centre.z);
    root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    const obj = new THREE.Group();
    obj.add(root);
    obj.scale.setScalar(data.scale || 1);
    obj.rotation.y = data.rotY || 0;
    obj.position.set(data.x, data.y, data.z);
    obj.userData.dynamic = true;
    this.game.world.group.add(obj);
    obj.updateMatrixWorld(true);
    if (data.solid !== false) {
      _box.setFromObject(obj);
      _box.getSize(_size);
      _box.getCenter(_centre);
      if (_size.x > 0.2 && _size.y > 0.2 && _size.z > 0.2) {
        this.game.physics.addBox(_centre.clone(), _size.clone(), null, { surface: 'metal' });
      }
    }
    const item = { id, data, obj, saved };
    this.items.push(item);
    return item;
  }
}
