import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Traversal — supply drops, launch pads and ziplines.
 *
 * Between the storm closing and the map being 1200 m across, a match needs
 * ways to cover ground and reasons to contest a spot. These three cover both:
 *
 *  · SUPPLY DROP  a crate parachutes into the safe zone every couple of
 *    minutes carrying the best loot in the game. It's visible from a long
 *    way off, so it makes a fight happen somewhere specific.
 *  · LAUNCH PAD   steps you into the air with a glider redeploy, for
 *    escaping a closing storm or repositioning off high ground.
 *  · ZIPLINE      strung between the tall landmarks; ride it by walking into
 *    the end post.
 */
export class Traversal {
  constructor(game) {
    this.game = game;
    this.drops = [];
    this.pads = [];
    this.ziplines = [];
    this.riding = null;
    this._dropTimer = 100;
    this._t = 0;
  }

  reset() {
    for (const d of this.drops) this.game.scene.remove(d.group);
    for (const p of this.pads) this.game.scene.remove(p.group);
    for (const z of this.ziplines) this.game.scene.remove(z.group);
    this.drops = [];
    this.pads = [];
    this.ziplines = [];
    this.riding = null;
    this._dropTimer = 100;
  }

  // ------------------------------------------------------------ launch pads

  /** A pad you step on to be thrown into the air with a glider redeploy. */
  addPad(x, y, z) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.3, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.6, metalness: 0.7 })
    );
    frame.position.y = 0.15;
    frame.receiveShadow = true;
    g.add(frame);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a1a10, emissive: 0x4ec95a, emissiveIntensity: 2.2, roughness: 0.4
    });
    const face = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 2.7), mat);
    face.position.y = 0.32;
    g.add(face);
    // Corner posts so it reads from the side.
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.6, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.7, metalness: 0.6 })
      );
      post.position.set(dx, 0.4, dz);
      g.add(post);
    }
    g.position.set(x, y, z);
    this.game.scene.add(g);
    const pad = { pos: new THREE.Vector3(x, y, z), group: g, mat, cooldown: 0 };
    this.pads.push(pad);
    return pad;
  }

  // --------------------------------------------------------------- ziplines

  /** A cable between two points. Walk into either end to ride it. */
  addZipline(a, b) {
    const g = new THREE.Group();
    const from = new THREE.Vector3(a.x, a.y, a.z);
    const to = new THREE.Vector3(b.x, b.y, b.z);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);

    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, len, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.9 })
    );
    cable.position.copy(mid);
    cable.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize()
    );
    g.add(cable);

    // End posts.
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.6, metalness: 0.7 });
    for (const p of [from, to]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), postMat);
      post.position.set(p.x, p.y - 1.2, p.z);
      post.castShadow = true;
      g.add(post);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.14, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x0a1520, emissive: 0x37e6ff, emissiveIntensity: 2.2 })
      );
      lamp.position.set(p.x, p.y + 0.1, p.z);
      g.add(lamp);
    }
    this.game.scene.add(g);
    const zip = { from, to, group: g, len };
    this.ziplines.push(zip);
    return zip;
  }

  // ----------------------------------------------------------- supply drops

  /** Spawn a parachuting crate over a point. */
  spawnDrop(x, z) {
    const island = this.game.world.island;
    const groundY = island ? island.heightAt(x, z) : 0;
    const g = new THREE.Group();

    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.5, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x4a3a1c, roughness: 0.8, metalness: 0.3 })
    );
    crate.castShadow = true;
    g.add(crate);
    // Gold banding so it reads as the good loot.
    const band = new THREE.MeshStandardMaterial({
      color: 0x2a1c06, emissive: 0xf5a524, emissiveIntensity: 1.8, roughness: 0.4
    });
    for (const axis of ['x', 'z']) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(
        axis === 'x' ? 1.9 : 0.16, 1.6, axis === 'x' ? 0.16 : 1.9
      ), band);
      g.add(b);
    }
    const beacon = new THREE.PointLight(0xf5a524, 14, 26, 2);
    beacon.position.y = 1.4;
    g.add(beacon);

    // Parachute canopy.
    const chute = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({
        color: 0xd8443a, roughness: 0.85, side: THREE.DoubleSide
      })
    );
    chute.position.y = 3.4;
    g.add(chute);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x22262c });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 4), lineMat);
      line.position.set(dx * 0.8, 2.1, dz * 0.8);
      g.add(line);
    }

    g.position.set(x, groundY + 140, z);
    this.game.scene.add(g);

    const drop = { group: g, chute, beacon, groundY, landed: false, opened: false, vel: -7.5 };
    this.drops.push(drop);
    this.game.hud.brToast('SUPPLY DROP INBOUND', 'Marked on your map', '#f5a524');
    this.game.audio.stormWarn?.();
    return drop;
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    const g = this.game;
    const br = g.br;
    const player = g.player;
    this._t += dt;

    // --- Supply drop cadence -------------------------------------------
    if (br && br.phase === 'live') {
      this._dropTimer -= dt;
      if (this._dropTimer <= 0) {
        this._dropTimer = 130 + Math.random() * 60;
        // Always inside the current safe zone so it's actually contestable.
        const s = br.storm;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * s.radius * 0.6;
        this.spawnDrop(s.centre.x + Math.cos(a) * r, s.centre.y + Math.sin(a) * r);
      }
    }

    // --- Falling crates ---------------------------------------------------
    for (const d of this.drops) {
      if (!d.landed) {
        d.group.position.y += d.vel * dt;
        d.group.rotation.y += dt * 0.25;
        if (d.group.position.y <= d.groundY) {
          d.group.position.y = d.groundY;
          d.landed = true;
          d.chute.visible = false;      // canopy collapses on touchdown
        }
      }
      d.beacon.intensity = 10 + Math.sin(this._t * 3) * 5;

      // Open on approach.
      if (d.landed && !d.opened) {
        _v.set(d.group.position.x, d.groundY, d.group.position.z);
        if (player.position.distanceTo(_v) < 3.2 && g.input.pressed('KeyE')) {
          d.opened = true;
          d.beacon.intensity = 0;
          // Best loot in the game: two high-rarity weapons plus support.
          br.loot.spawnWeapon(_v.clone().add(new THREE.Vector3(1.2, 0.2, 0)), 2);
          br.loot.spawnWeapon(_v.clone().add(new THREE.Vector3(-1.2, 0.2, 0)), 2);
          br.loot.spawnConsumable(_v.clone().add(new THREE.Vector3(0, 0.2, 1.2)), 'shieldBig');
          br.loot.spawnConsumable(_v.clone().add(new THREE.Vector3(0, 0.2, -1.2)), 'medkit');
          br.loot.spawnMats(_v.clone().add(new THREE.Vector3(1.2, 0.2, 1.2)));
          g.audio.chestOpen?.();
          g.hud.brToast('SUPPLY DROP OPENED', '', '#f5a524');
        }
      }
    }

    // --- Launch pads ------------------------------------------------------
    for (const pad of this.pads) {
      pad.cooldown = Math.max(0, pad.cooldown - dt);
      pad.mat.emissiveIntensity = pad.cooldown > 0 ? 0.5 : 1.8 + Math.sin(this._t * 4) * 0.7;
      if (pad.cooldown > 0) continue;
      const dx = player.position.x - pad.pos.x;
      const dz = player.position.z - pad.pos.z;
      if (dx * dx + dz * dz < 3.2 && Math.abs(player.position.y - pad.pos.y) < 1.6) {
        pad.cooldown = 1.2;
        // Throw them up and forward, then redeploy the glider.
        player.velocity.y = 26;
        player.velocity.x += -Math.sin(player.yaw) * 8;
        player.velocity.z += -Math.cos(player.yaw) * 8;
        player.grounded = false;
        g.effects.burst(pad.pos, { count: 24, color: 0x4ec95a, speed: 7, life: 0.5, gravity: -4 });
        g.audio.gliderDeploy?.();
        g.hud.brToast('LAUNCHED', 'Glider redeploying');
        br.redeployGlider?.();
      }
    }

    // --- Ziplines ----------------------------------------------------------
    if (this.riding) {
      const z = this.riding;
      // Constant ground speed, so a long cross-map line is a real shortcut
      // rather than a minute of hanging still.
      z.t += dt * (48 / z.zip.len);
      if (z.t >= 1) {
        player.position.copy(z.zip[z.reverse ? 'from' : 'to']);
        player.velocity.set(0, 0, 0);
        this.riding = null;
        g.hud.setPrompt(null);
      } else {
        const a = z.reverse ? z.zip.to : z.zip.from;
        const b = z.reverse ? z.zip.from : z.zip.to;
        player.position.lerpVectors(a, b, z.t);
        player.position.y -= 0.9;         // hang below the cable
        player.velocity.set(0, 0, 0);
        // Bail out early.
        if (g.input.pressed('Space')) {
          this.riding = null;
          player.velocity.y = 3;
        }
      }
      return;
    }

    for (const zip of this.ziplines) {
      for (const [end, reverse] of [[zip.from, false], [zip.to, true]]) {
        if (player.position.distanceTo(end) < 2.4) {
          g.hud.setPrompt('[E]  RIDE ZIPLINE', '#37e6ff');
          if (g.input.pressed('KeyE')) {
            this.riding = { zip, t: 0, reverse };
            g.audio.gliderDeploy?.();
          }
          return;
        }
      }
    }
  }
}
