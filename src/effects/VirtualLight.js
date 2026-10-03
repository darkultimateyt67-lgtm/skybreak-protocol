import * as THREE from 'three';

/**
 * A point light the renderer does not pay for until it is one of the nearest.
 *
 * Every real light in the scene is lighting code that every lit pixel runs,
 * whether the light is near, far or switched off — and adding or removing one
 * recompiles every shader. A battleground match placed one light per chest:
 * 63 lights on every pixel. A VirtualLight is an ordinary Object3D carrying
 * light settings; each frame Effects hands its small fixed pool of real lights
 * to whichever virtual ones are nearest the camera (see Effects._updateVirtual).
 *
 * Drop-in for the fields the game used on PointLight: color, intensity,
 * distance, decay, position.
 */
export class VirtualLight extends THREE.Object3D {
  constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super();
    this.isVirtualLight = true;
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    VirtualLight.all.add(this);
  }

  dispose() {
    VirtualLight.all.delete(this);
  }
}

VirtualLight.all = new Set();
