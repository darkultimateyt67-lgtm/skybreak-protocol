import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * ModelLibrary — drop-in artist-made models.
 *
 * Everything in this project is generated in code, which has a hard ceiling:
 * procedural geometry can get proportions and detail right, but it can't
 * replace a human sculpting a car body by eye against reference photos. This
 * is the escape hatch. Put a .glb in public/models/ with the right name and
 * it replaces the generated version; leave the folder empty and nothing
 * changes.
 *
 * FAILING SOFT IS THE WHOLE POINT. A missing file, a bad download or a model
 * that won't parse must never break the game — it just falls back to the
 * procedural body, because a city where half the cars are missing is worse
 * than one where they're all simple.
 *
 * Naming: the file is looked up by chassis id, so `sport.glb` replaces every
 * sport-chassis car, `jet.glb` every jet, and so on.
 */

const BASE = '/models/';

export class ModelLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();       // id -> THREE.Object3D template (or null)
    this.ready = false;
    this.found = [];
    this.missing = [];
  }

  /**
   * Try to load every named model once, up front. Resolves regardless of how
   * many actually existed — callers check `has()` afterwards.
   */
  async preload(ids) {
    await Promise.all(ids.map((id) => this._tryLoad(id)));
    this.ready = true;
    return { found: this.found.slice(), missing: this.missing.slice() };
  }

  _tryLoad(id) {
    return new Promise((resolve) => {
      this.loader.load(
        `${BASE}${id}.glb`,
        (gltf) => {
          const root = gltf.scene;
          // Normalise: sit the model on the ground, centred, nose toward +Z,
          // so a downloaded asset lines up with the rest of the game without
          // anyone having to re-export it.
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          const centre = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(centre);
          root.position.set(-centre.x, -box.min.y, -centre.z);
          const wrap = new THREE.Group();
          wrap.add(root);
          wrap.userData.nativeSize = size.clone();
          root.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
          });
          this.cache.set(id, wrap);
          this.found.push(id);
          resolve();
        },
        undefined,
        () => {
          // No file, or it wouldn't parse. Perfectly normal — fall back.
          this.cache.set(id, null);
          this.missing.push(id);
          resolve();
        }
      );
    });
  }

  has(id) { return !!this.cache.get(id); }

  /**
   * A fresh instance, scaled to the length the game expects for that vehicle.
   *
   * Downloaded models arrive at wildly different scales — some in metres,
   * some in centimetres, some in whatever the artist felt like. Scaling to a
   * known length means a dropped-in car is the size of the car it replaces,
   * so physics, cameras and doorways all keep working.
   */
  instance(id, targetLength) {
    const tpl = this.cache.get(id);
    if (!tpl) return null;
    const clone = tpl.clone(true);
    const native = tpl.userData.nativeSize;
    if (native && targetLength) {
      const longest = Math.max(native.x, native.z) || 1;
      const s = targetLength / longest;
      clone.scale.setScalar(s);
      // If the model was authored nose-along-X, turn it to face +Z.
      if (native.x > native.z) clone.rotation.y = Math.PI / 2;
    }
    return clone;
  }
}

/** One shared library for the whole session. */
export const models = new ModelLibrary();
