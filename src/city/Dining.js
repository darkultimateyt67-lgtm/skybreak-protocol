import * as THREE from 'three';

/**
 * Dining — walk into a cafe or diner, order something, eat it.
 *
 * The point of this is not the food. It's that a city with doors you can open
 * and a counter you can stand at stops being scenery you drive past. Ordering
 * is deliberately a two-beat interaction — order, then wait, then eat —
 * because an instant heal pickup would feel like a health crate with a menu
 * bolted on.
 *
 * Eating plays out over a few seconds with the item held up to the camera and
 * bitten down in stages, so it reads as an action you're performing rather
 * than a number changing.
 */

const MENU = {
  cafe: [
    { id: 'coffee', name: 'BLACK COFFEE', price: 4, heal: 8, bites: 3, colour: 0x3a2a1e, tall: true },
    { id: 'croissant', name: 'CROISSANT', price: 6, heal: 16, bites: 4, colour: 0xd9a94e },
    { id: 'toastie', name: 'CHEESE TOASTIE', price: 9, heal: 26, bites: 5, colour: 0xc98a3e }
  ],
  diner: [
    { id: 'burger', name: 'DOUBLE BURGER', price: 14, heal: 42, bites: 6, colour: 0x8a5a30 },
    { id: 'fries', name: 'LOADED FRIES', price: 8, heal: 20, bites: 5, colour: 0xe0b34a },
    { id: 'shake', name: 'MALT SHAKE', price: 7, heal: 18, bites: 4, colour: 0xf0e0d0, tall: true }
  ],
  noodle: [
    { id: 'ramen', name: 'HOUSE RAMEN', price: 13, heal: 40, bites: 6, colour: 0xc4762e },
    { id: 'gyoza', name: 'GYOZA (6)', price: 9, heal: 22, bites: 5, colour: 0xe8d9b8 },
    { id: 'tea', name: 'GREEN TEA', price: 3, heal: 6, bites: 3, colour: 0x7fa85a, tall: true }
  ],
  bakery: [
    { id: 'loaf', name: 'SOURDOUGH', price: 7, heal: 24, bites: 5, colour: 0xd2a562 },
    { id: 'donut', name: 'GLAZED DONUT', price: 4, heal: 12, bites: 3, colour: 0xe8a8c0 },
    { id: 'pie', name: 'STEAK PIE', price: 11, heal: 34, bites: 5, colour: 0xb07a3e }
  ]
};

const _v = new THREE.Vector3();

export class Dining {
  constructor(freeRoam) {
    this.fr = freeRoam;
    this.game = freeRoam.game;
    this.city = freeRoam.city;
    this.venue = null;       // venue you're currently standing in
    this.order = null;       // what's being prepared / eaten
    this.state = 'idle';     // idle | menu | waiting | eating
    this.timer = 0;
    this.bite = 0;
    this._held = null;
  }

  menuFor(venue) {
    return MENU[venue.kind] || MENU.cafe;
  }

  /** The food venue the player is standing inside, or null. */
  _venueAt(p) {
    for (const v of this.city.venues) {
      if (Math.abs(p.x - v.x) < v.w * 0.5 && Math.abs(p.z - v.z) < v.d * 0.5) return v;
    }
    return null;
  }

  update(dt) {
    const g = this.game;
    const fr = this.fr;
    if (fr.driving) { this._close(); return; }
    const p = g.player.position;

    const inside = this._venueAt(p);
    if (inside !== this.venue) {
      this.venue = inside;
      if (inside) {
        g.hud.brToast?.(inside.name, 'Press E at the counter to order');
      } else {
        this._close();
      }
    }

    if (this.state === 'waiting') {
      this.timer -= dt;
      if (this.timer <= 0) this._serve();
      return;
    }
    if (this.state === 'eating') { this._eat(dt); return; }

    if (!this.venue) return;

    // At the counter?
    const c = this.venue.counter;
    const atCounter = Math.hypot(p.x - c.x, p.z - c.z) < 3.2;
    if (atCounter && g.input.pressed('KeyE')) {
      if (this.state === 'menu') this._close();
      else this._open();
    }
    if (this.state === 'menu') {
      // 1-3 pick a dish.
      const menu = this.menuFor(this.venue);
      for (let i = 0; i < menu.length; i++) {
        if (g.input.pressed(`Digit${i + 1}`)) { this._buy(menu[i]); break; }
      }
    }
  }

  _open() {
    this.state = 'menu';
    const menu = this.menuFor(this.venue);
    this.game.hud.showMenuBoard?.(this.venue.name, menu, this.game.credits);
  }

  _close() {
    if (this.state === 'menu') this.game.hud.showMenuBoard?.(null);
    if (this.state !== 'eating') this.state = 'idle';
  }

  _buy(item) {
    const g = this.game;
    if (g.credits < item.price) {
      g.hud.brToast?.('NOT ENOUGH CREDITS', `${item.name} costs ${item.price}`);
      return;
    }
    g.credits -= item.price;
    g.hud.setCredits?.(g.credits);
    g.hud.showMenuBoard?.(null);
    this.order = item;
    this.state = 'waiting';
    // Kitchens take a moment. Instant service would feel like a vending machine.
    this.timer = 1.6 + Math.random() * 1.4;
    g.hud.brToast?.('ORDER PLACED', `${item.name} — coming up`);
    if (g.audio?.purchase) g.audio.purchase();
  }

  _serve() {
    const g = this.game;
    this.state = 'eating';
    this.bite = 0;
    this.timer = 0;
    this._buildHeld(this.order);
    g.hud.brToast?.(this.order.name, 'Enjoy');
  }

  /** Build the item in the player's hand, in front of the camera. */
  _buildHeld(item) {
    this._disposeHeld();
    const g = this.game;
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: item.colour, roughness: 0.72 });
    const plate = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.4 });

    if (item.tall) {
      // Cup: body, rim and a handle.
      grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.12, 14), plate));
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 14), mat);
      fill.position.y = 0.045;
      grp.add(fill);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 12), plate);
      handle.position.set(0.058, 0, 0);
      handle.rotation.y = Math.PI / 2;
      grp.add(handle);
    } else {
      // Plate with the item stacked on it.
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.014, 18), plate);
      grp.add(dish);
      const food = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.055, 0.09), mat);
      food.position.y = 0.035;
      grp.add(food);
      this._foodMesh = food;
    }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this._held = grp;
    g.scene.add(grp);
  }

  _disposeHeld() {
    if (!this._held) return;
    this.game.scene.remove(this._held);
    this._held.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this._held = null;
    this._foodMesh = null;
  }

  /**
   * Eating animation: the item rises to the mouth, a bite is taken, it drops
   * back down. Each bite shrinks what's left and restores a share of health,
   * so the healing arrives over the meal rather than all at once.
   */
  _eat(dt) {
    const g = this.game;
    const item = this.order;
    this.timer += dt;
    const BITE_TIME = 0.85;
    const t = (this.timer % BITE_TIME) / BITE_TIME;

    if (this._held) {
      const cam = g.camera;
      cam.updateMatrixWorld(true);
      // Park it low-right of the view, then swing it up to the mouth.
      const lift = Math.sin(Math.min(1, t * 1.6) * Math.PI);
      _v.set(0.26 - lift * 0.2, -0.24 + lift * 0.2, -0.55 + lift * 0.16);
      _v.applyMatrix4(cam.matrixWorld);
      this._held.position.copy(_v);
      this._held.quaternion.copy(cam.quaternion);
      this._held.rotateX(-0.5 + lift * 0.6);
      if (this._foodMesh) {
        const left = 1 - this.bite / item.bites;
        this._foodMesh.scale.set(Math.max(0.05, left), Math.max(0.12, left), Math.max(0.05, left));
      }
    }

    // One bite per cycle.
    if (this.timer >= BITE_TIME * (this.bite + 1)) {
      this.bite++;
      const perBite = item.heal / item.bites;
      if (g.player) {
        g.player.health = Math.min(g.player.maxHealth ?? 100, (g.player.health ?? 100) + perBite);
      }
      if (g.audio?.footstep) g.audio.footstep(false);
      if (g.effects?.burst) {
        g.effects.burst(_v.copy(g.camera.position), { count: 2, color: item.colour, speed: 0.6, life: 0.2 });
      }
      if (this.bite >= item.bites) {
        this._disposeHeld();
        this.state = 'idle';
        this.order = null;
        g.hud.brToast?.('FINISHED', `+${Math.round(item.heal)} health`);
      }
    }
  }

  stop() {
    this._disposeHeld();
    this.state = 'idle';
    this.venue = null;
    this.game.hud.showMenuBoard?.(null);
  }
}

export { MENU };
