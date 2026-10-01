import * as THREE from 'three';
import { Storm } from './Storm.js';
import { DropPhase } from './DropPhase.js';
import { Loot, RARITY, CONSUMABLES } from './Loot.js';
import { Building, MATERIALS, PIECES } from './Building.js';
import { POIS } from './Island.js';
import { Traversal } from './Traversal.js';

const _v = new THREE.Vector3();

const HANDLES = [
  'Vyper', 'K9_Rush', 'nullByte', 'Bramble', 'HexFox', 'Static', 'Marrow',
  'QuietStorm', 'Pilgrim', 'Dust', 'Ninefold', 'Cobalt', 'Rook', 'Ash',
  'Lark', 'Grit', 'Halcyon', 'Sable', 'Wren', 'Tally', 'Onyx', 'Vex',
  'Pike', 'Slate', 'Juno', 'Rally', 'Mirth', 'Crow', 'Bishop', 'Fenn',
  'Harrow', 'Idle', 'Kestrel', 'Lumen', 'Moth', 'Nomad', 'Orbit', 'Prowl',
  'Quill', 'Rust', 'Sparrow', 'Tinder', 'Umber', 'Vigil', 'Wick', 'Yarrow',
  'Zephyr', 'Bolt', 'Cinder'
];

/**
 * A lightweight AI opponent. These aren't full Enemy instances — 49 of the
 * detailed raider rigs would cost more than the rest of the game combined.
 * Each bot is a simple capsule with a state machine that loots, rotates for
 * the storm, fights whatever it can see (including other bots) and panic-
 * builds when shot. The kill feed makes their fights visible, which is what
 * sells a lobby full of players.
 */
class Bot {
  constructor(br, name, pos) {
    this.br = br;
    this.game = br.game;
    this.name = name;
    this.position = pos.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = 100;
    this.shield = 0;
    this.alive = true;
    this.kills = 0;
    this.skill = 0.35 + Math.random() * 0.5;
    this.state = 'loot';
    this.target = null;
    this._think = Math.random() * 1.2;
    this._fire = 0;
    this._dest = new THREE.Vector3();
    this._pickDestination();
    this._build();
  }

  _build() {
    const g = new THREE.Group();
    const hue = Math.random();
    const suit = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.45, 0.4) });
    const dark = new THREE.MeshLambertMaterial({ color: 0x22262c });
    const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0.08, 0.4, 0.35 + Math.random() * 0.3) });
    const add = (geo, m, x, y, z) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(new THREE.CapsuleGeometry(0.3, 0.6, 3, 8), suit, 0, 1.05, 0);
    add(new THREE.SphereGeometry(0.19, 8, 6), skin, 0, 1.62, 0);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.28), suit, 0, 1.4, 0);
    this.legL = add(new THREE.BoxGeometry(0.15, 0.68, 0.17), dark, -0.14, 0.36, 0);
    this.legR = add(new THREE.BoxGeometry(0.15, 0.68, 0.17), dark, 0.14, 0.36, 0);
    add(new THREE.BoxGeometry(0.08, 0.08, 0.5), dark, 0.24, 1.22, 0.2);
    g.position.copy(this.position);
    this.game.scene.add(g);
    this.group = g;
    this._phase = Math.random() * 10;
  }

  /** Head/body spheres for the player's bullets. */
  raycast(origin, dir, maxDist) {
    if (!this.alive) return null;
    const p = this.position;
    let best = -1, part = null;
    const test = (y, r, tag) => {
      _v.set(p.x, p.y + y, p.z);
      _v.sub(origin);
      const proj = _v.dot(dir);
      if (proj < 0) return;
      const d2 = _v.lengthSq() - proj * proj;
      if (d2 > r * r) return;
      const t = proj - Math.sqrt(r * r - d2);
      if (t > 0 && t < maxDist && (best < 0 || t < best)) { best = t; part = tag; }
    };
    test(1.62, 0.27, 'head');
    test(1.05, 0.45, 'body');
    test(0.5, 0.38, 'body');
    if (best < 0) return null;
    return { enemy: this, part, dist: best, point: origin.clone().addScaledVector(dir, best) };
  }

  damage(amount, head, weaponName, source) {
    if (!this.alive) return;
    const dmg = head ? amount : amount;
    const toShield = Math.min(this.shield, dmg);
    this.shield -= toShield;
    this.hp -= dmg - toShield;
    // Getting shot makes them build and fight back.
    if (this.state !== 'fight') {
      this.state = 'fight';
      this.target = source || this.br.game.player;
    }
    if (Math.random() < 0.4) this.br.botBuild(this);
    if (this.hp <= 0) this.br.killBot(this, source, weaponName, head);
  }

  _pickDestination() {
    // Head for a POI inside the safe zone, biased toward the circle centre.
    const storm = this.br.storm;
    const inside = POIS.filter((p) =>
      !storm || Math.hypot(p.x - storm.centre.x, p.z - storm.centre.y) < storm.radius * 0.8);
    const pool = inside.length ? inside : POIS;
    const poi = pool[Math.floor(Math.random() * pool.length)];
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * poi.r * 0.7;
    this._dest.set(poi.x + Math.cos(a) * r, 0, poi.z + Math.sin(a) * r);
  }

  update(dt) {
    if (!this.alive) return;
    const br = this.br;
    const game = this.game;
    const player = game.player;
    const island = game.world.island;

    this._think -= dt;
    if (this._think <= 0) {
      this._think = 0.5 + Math.random() * 0.7;

      // Storm forces a rotation regardless of what else is happening.
      const storm = br.storm;
      if (storm && storm.isOutside(this.position.x, this.position.z)) {
        this.state = 'rotate';
        const toC = _v.set(storm.centre.x - this.position.x, 0, storm.centre.y - this.position.z);
        if (toC.lengthSq() > 1) toC.normalize();
        this._dest.set(
          storm.centre.x - toC.x * storm.radius * 0.55,
          0,
          storm.centre.y - toC.z * storm.radius * 0.55
        );
      } else {
        // Look for someone to shoot: the player, or another bot.
        let best = null, bestD = 62;
        const pd = this.position.distanceTo(player.position);
        if (player.alive && pd < bestD && br.hasLOS(this.position, player.position)) {
          best = player; bestD = pd;
        }
        for (const b of br.bots) {
          if (b === this || !b.alive) continue;
          const d = this.position.distanceTo(b.position);
          if (d < bestD && br.hasLOS(this.position, b.position)) { best = b; bestD = d; }
        }
        if (best) {
          this.state = 'fight';
          this.target = best;
        } else if (this.state === 'fight') {
          this.state = 'loot';
          this.target = null;
          this._pickDestination();
        } else if (this.position.distanceTo(this._dest) < 8) {
          this._pickDestination();
        }
      }
    }

    // --- Movement --------------------------------------------------------
    let dest = this._dest;
    let speed = this.state === 'rotate' ? 7.4 : this.state === 'fight' ? 4.6 : 5.4;
    if (this.state === 'fight' && this.target && this.target.alive !== false) {
      const d = this.position.distanceTo(this.target.position);
      // Keep a working range: close if far, back off if too close.
      _v.copy(this.target.position).sub(this.position).setY(0);
      if (_v.lengthSq() > 0.01) _v.normalize();
      const want = d > 30 ? 1 : d < 12 ? -1 : 0;
      dest = _v.multiplyScalar(want * 14).add(this.position);
      // Strafe so they aren't stationary targets.
      dest.x += Math.cos(this._phase + performance.now() * 0.0006) * 6;
      dest.z += Math.sin(this._phase + performance.now() * 0.0006) * 6;
    }

    _v.set(dest.x - this.position.x, 0, dest.z - this.position.z);
    const dist = _v.length();
    if (dist > 0.6) {
      _v.divideScalar(dist);
      this.velocity.x += (_v.x * speed - this.velocity.x) * Math.min(1, dt * 6);
      this.velocity.z += (_v.z * speed - this.velocity.z) * Math.min(1, dt * 6);
      this.yaw = Math.atan2(_v.x, _v.z);
    } else {
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }

    // Ground clamp against the island heightfield.
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    const gh = island ? island.heightAt(this.position.x, this.position.z) : 0;
    this.velocity.y -= 24 * dt;
    this.position.y += this.velocity.y * dt;
    if (this.position.y < gh) { this.position.y = gh; this.velocity.y = 0; }

    // Storm damage applies to bots too — that's what thins the lobby.
    const storm = br.storm;
    if (storm && storm.isOutside(this.position.x, this.position.z)) {
      this._stormAcc = (this._stormAcc || 0) + dt;
      if (this._stormAcc >= 1) {
        this._stormAcc = 0;
        this.hp -= storm.dps;
        if (this.hp <= 0) br.killBot(this, null, 'THE STORM', false);
      }
    }

    // --- Shooting ----------------------------------------------------------
    this._fire -= dt;
    if (this.state === 'fight' && this.target && this._fire <= 0) {
      const t = this.target;
      const alive = t === this.game.player ? t.alive : t.alive;
      if (alive) {
        const d = this.position.distanceTo(t.position);
        if (d < 62 && br.hasLOS(this.position, t.position)) {
          this._fire = 0.5 + Math.random() * 0.7;
          br.botShoot(this, t, d);
        }
      }
    }

    // --- Visuals -----------------------------------------------------------
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this._phase += Math.hypot(this.velocity.x, this.velocity.z) * dt * 3;
    const sw = Math.sin(this._phase) * 0.5;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}

/**
 * BattleRoyale — the match manager. Owns the storm, the drop, the loot, the
 * building system and the bot lobby, and drives the phase flow from drop to
 * victory screen.
 */
export class BattleRoyale {
  constructor(game) {
    this.game = game;
    this.storm = new Storm(game);
    this.drop = new DropPhase(game);
    this.loot = new Loot(game);
    this.build = new Building(game);
    this.traversal = new Traversal(game);
    this.bots = [];
    this.phase = 'idle';
    this.alivePlayers = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.placement = 0;
    this.matchTime = 0;
    this.inventory = [];
    this.shield = 0;
    this.maxShield = 100;
    this._useT = 0;
    this._using = null;
  }

  get botCount() { return 49; }

  /** Set up a fresh match and start the drop. */
  start() {
    const g = this.game;
    this.phase = 'drop';
    this.kills = 0;
    this.damageDealt = 0;
    this.placement = 0;
    this.matchTime = 0;
    this.shield = 0;
    this.inventory = [];

    for (const b of this.bots) b.dispose();
    this.bots = [];
    this.loot.populate(g.world);
    this.build.reset();
    this.storm.reset();

    // Launch pads and ziplines linking the landmarks.
    this.traversal.reset();
    const island = g.world.island;
    const groundAt = (x, z) => (island ? island.heightAt(x, z) : 0);
    for (const p of POIS) {
      if (p.kind === 'lake') continue;
      const a = Math.random() * Math.PI * 2;
      const px = p.x + Math.cos(a) * p.r * 0.55;
      const pz = p.z + Math.sin(a) * p.r * 0.55;
      this.traversal.addPad(px, groundAt(px, pz), pz);
    }
    // Ziplines between tall, distant landmarks. The doubled island needs more
    // of these than the old one did — crossing it on foot is a long walk, and
    // the storm does not wait.
    const zipPairs = [
      ['cinder', 'ridge'], ['foundry', 'boneyard'], ['harbor', 'chapel'], ['silos', 'motel'],
      ['terminal', 'rustwood'], ['array', 'greenhouse'], ['coolant', 'harbor'],
      ['dunes', 'silos'], ['vault', 'foundry'], ['lagoon', 'ridge']
    ];
    for (const [a, b] of zipPairs) {
      const pa = POIS.find((p) => p.id === a);
      const pb = POIS.find((p) => p.id === b);
      if (!pa || !pb) continue;
      this.traversal.addZipline(
        { x: pa.x, y: groundAt(pa.x, pa.z) + 16, z: pa.z },
        { x: pb.x, y: groundAt(pb.x, pb.z) + 16, z: pb.z }
      );
    }

    // Seed the lobby: bots start scattered across the island's POIs.
    const names = [...HANDLES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < this.botCount; i++) {
      const poi = POIS[i % POIS.length];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * poi.r;
      const x = poi.x + Math.cos(a) * r;
      const z = poi.z + Math.sin(a) * r;
      const y = g.world.island ? g.world.island.heightAt(x, z) : 0;
      this.bots.push(new Bot(this, names[i % names.length], _v.set(x, y, z)));
    }
    this.alivePlayers = this.bots.length + 1;

    g.player.reset(g.world.playerSpawn);
    g.hud.setBRMode(true);
    g.hud.setAlive(this.alivePlayers);
    g.hud.setBRKills(0);
    this.build.enabled = false;
    this.drop.start();
  }

  /**
   * Nearest bot hitbox along a ray. Mirrors EnemyManager.raycast so the
   * weapon system can treat both modes identically.
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const b of this.bots) {
      const hit = b.raycast(origin, dir, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    return best;
  }

  /** Cheap line of sight against world geometry. */
  hasLOS(a, b) {
    _v.set(b.x - a.x, (b.y + 1.2) - (a.y + 1.4), b.z - a.z);
    const d = _v.length();
    if (d < 1) return true;
    _v.divideScalar(d);
    const from = new THREE.Vector3(a.x, a.y + 1.4, a.z);
    const hit = this.game.physics.raycast(from, _v, d - 0.6);
    return !hit;
  }

  /** A bot takes a shot at something. */
  botShoot(bot, target, dist) {
    const g = this.game;
    const from = new THREE.Vector3(bot.position.x, bot.position.y + 1.35, bot.position.z);
    const to = target === g.player
      ? new THREE.Vector3(target.position.x, target.position.y + target.eyeHeight * 0.8, target.position.z)
      : new THREE.Vector3(target.position.x, target.position.y + 1.1, target.position.z);
    _v.copy(to).sub(from).normalize();

    g.effects.tracer(from, to, 0xffd27d);
    g.effects.flash(from, 0xffb060, 8, 0.04);
    g.audio.enemyShoot(dist);

    // Skill and range decide the hit.
    const chance = bot.skill * (1 - Math.min(0.75, dist / 90));
    if (Math.random() < chance) {
      const dmg = 9 + Math.random() * 9;
      if (target === g.player) {
        this.playerTakeDamage(dmg, bot);
      } else {
        target.damage(dmg, false, 'RIFLE', bot);
      }
    } else if (target === g.player) {
      g.audio.whizz(0.6 + Math.random() * 2.2);
    }
  }

  /** Damage routed through the player's shield first. */
  playerTakeDamage(amount, source) {
    const g = this.game;
    const toShield = Math.min(this.shield, amount);
    this.shield -= toShield;
    g.hud.setShield(this.shield, this.maxShield);
    const rest = amount - toShield;
    if (rest > 0) g.player.damage(rest, source ? source.position : null);
    else {
      g.hud.damageFlash();
      g.audio.hit(false);
    }
  }

  /** A bot panics and throws up a wall between it and its attacker. */
  botBuild(bot) {
    // Purely cosmetic for bots — a quick cover block that decays.
    const g = this.game;
    const mat = MATERIALS.wood;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 4.6, 0.4),
      new THREE.MeshLambertMaterial({ color: mat.color })
    );
    _v.copy(bot.position);
    const face = bot.target ? bot.target.position : g.player.position;
    const a = Math.atan2(face.x - _v.x, face.z - _v.z);
    m.position.set(_v.x + Math.sin(a) * 1.8, _v.y + 2.3, _v.z + Math.cos(a) * 1.8);
    m.rotation.y = a;
    m.castShadow = true;
    g.scene.add(m);
    const col = g.physics.addBox(m.position, new THREE.Vector3(4.6, 4.6, 0.4),
      new THREE.Quaternion().setFromEuler(m.rotation), { surface: 'wood' });
    setTimeout(() => {
      g.scene.remove(m);
      const i = g.physics.boxes.indexOf(col);
      if (i >= 0) g.physics.boxes.splice(i, 1);
    }, 22000);
  }

  killBot(bot, killer, weaponName, head) {
    if (!bot.alive) return;
    bot.alive = false;
    const g = this.game;
    _v.copy(bot.position).setY(bot.position.y + 1.1);
    g.effects.burst(_v, { count: 20, color: 0x8e1220, speed: 3.4, life: 0.6, gravity: 15 });
    g.effects.bloodDecal(_v.setY(bot.position.y + 0.02), true);
    g.audio.enemyDeath(bot.position.distanceTo(g.player.position));

    // Drop their loot where they fell.
    const dropPos = new THREE.Vector3(bot.position.x, bot.position.y + 0.2, bot.position.z);
    this.loot.spawnWeapon(dropPos, 0.4);
    if (Math.random() < 0.5) this.loot.spawnConsumable(dropPos.clone().add(new THREE.Vector3(0.9, 0, 0.4)));
    this.loot.spawnMats(dropPos.clone().add(new THREE.Vector3(-0.9, 0, -0.4)));

    setTimeout(() => bot.dispose(), 2000);

    this.alivePlayers--;
    g.hud.setAlive(this.alivePlayers);

    const killerName = killer === g.player ? 'YOU' : (killer ? killer.name : weaponName || 'THE STORM');
    g.hud.brFeed(killerName, bot.name, weaponName, head);

    if (killer === g.player) {
      this.kills++;
      g.hud.setBRKills(this.kills);
      g.momentum.onKill({ isBoss: false }, head);
      g.hud.hitmarker(head);
    }

    this._checkVictory();
  }

  _checkVictory() {
    if (this.phase === 'over') return;
    const anyBots = this.bots.some((b) => b.alive);
    if (!anyBots && this.game.player.alive) {
      this.phase = 'over';
      this.placement = 1;
      this.game.hud.brVictory({
        place: 1, total: this.botCount + 1,
        kills: this.kills, damage: Math.round(this.damageDealt),
        time: this.matchTime
      });
      this.game.audio.victory?.();
      this.game.voice.say('Last one standing. Nice work out there.', 'TACNET');
    }
  }

  /** Called by Game when the player dies during a BR match. */
  onPlayerDeath() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.placement = this.alivePlayers;
    this.game.hud.brDefeat({
      place: this.placement, total: this.botCount + 1,
      kills: this.kills, damage: Math.round(this.damageDealt),
      time: this.matchTime
    });
  }

  // ------------------------------------------------------------ interaction

  /** Pick up whatever's under the crosshair prompt. */
  interact() {
    const g = this.game;
    const near = this.loot.nearest(g.player.position, 2.8);
    if (!near) return false;

    if (near.type === 'chest') {
      near.item.open();
      g.hud.brToast('CHEST OPENED', '');
      return true;
    }

    const p = near.item;
    if (p.kind === 'weapon') {
      this.equipWeapon(p.payload, p.rarity);
      g.hud.brToast(`${p.rarity.name} ${p.payload.name}`, 'Equipped', p.rarity.hex);
    } else if (p.kind === 'consumable') {
      this.inventory.push(p.payload);
      g.hud.brToast(p.payload.name, 'Picked up  ·  press 5 to use');
    } else if (p.kind === 'ammo') {
      g.weapons.refillReserve(0.5);
      g.hud.brToast('AMMO', '+ reserves');
    } else {
      const kinds = ['wood', 'stone', 'metal'];
      const k = kinds[Math.floor(Math.random() * 3)];
      this.build.add(k, p.payload.amount);
      g.hud.brToast('MATERIALS', `+${p.payload.amount} ${k}`);
    }
    p.take();
    g.audio.purchase?.();
    return true;
  }

  /** Launch pads put you back in the air with a fresh glider. */
  redeployGlider() {
    const d = this.drop;
    d.state = 'fall';
    d.active = true;
    d.vel = this.game.player.velocity.clone();
    this.game.audio.windRush?.(true);
  }

  /** Give the player a looted weapon at a rarity. */
  equipWeapon(def, rarity) {
    const g = this.game;
    const inst = g.weapons.weapons.find((w) => w.def.id === def.id);
    if (!inst) return;
    inst.owned = true;
    inst.rarity = rarity;
    inst.reserve = Math.max(inst.reserve, Math.round(def.reserve * 0.6));
    inst.mag = def.mag;
    const idx = g.weapons.weapons.indexOf(inst);
    g.weapons._switchTo(idx);
    g.weapons._pushHUD();
  }

  /** Start consuming the first item in the bag. */
  useConsumable() {
    if (this._using) return;
    const item = this.inventory[0];
    if (!item) {
      this.game.hud.brToast('NOTHING TO USE', '');
      return;
    }
    this._using = item;
    this._useT = item.time;
    this.game.hud.setUseBar(0, item.name);
  }

  _finishConsumable() {
    const g = this.game;
    const item = this._using;
    this.inventory.shift();
    if (item.kind === 'shield') {
      this.shield = Math.min(item.cap, this.shield + item.amount);
      g.hud.setShield(this.shield, this.maxShield);
    } else {
      g.player.health = Math.min(item.cap, g.player.health + item.amount);
    }
    g.hud.brToast(item.name, 'Used');
    g.audio.purchase?.();
    this._using = null;
    g.hud.setUseBar(null);
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    const g = this.game;
    this.matchTime += dt;

    // Drop phase owns movement until you land.
    if (this.drop.active) {
      this.drop.updateLook(dt);
      this.drop.update(dt);
      this.loot.update(dt);
      if (!this.drop.active) {
        this.phase = 'live';
        this.storm.start();
      }
      return;
    }

    this.storm.update(dt);
    this.loot.update(dt);
    this.build.update(dt);
    this.traversal.update(dt);
    for (const b of this.bots) b.update(dt);

    // Consumable channel — interrupted by taking damage is handled in HUD.
    if (this._using) {
      this._useT -= dt;
      const k = 1 - this._useT / this._using.time;
      g.hud.setUseBar(k, this._using.name);
      if (this._useT <= 0) this._finishConsumable();
    }

    // Interaction prompt. Traversal claims the prompt when you're at a
    // zipline post, so don't overwrite it here.
    if (this.traversal.riding) return;
    const near = this.loot.nearest(g.player.position, 2.8);
    if (near) {
      const label = near.type === 'chest' ? 'OPEN CHEST' : near.item.label;
      const col = near.type === 'chest' ? '#f5a524' : near.item.labelColor;
      g.hud.setPrompt(`[E]  ${label}`, col);
    } else {
      g.hud.setPrompt(null);
    }

    g.hud.setStorm(this.storm);
  }

  dispose() {
    for (const b of this.bots) b.dispose();
    this.bots = [];
    this.storm.dispose();
    this.drop.dispose();
    this.loot.clear();
  }
}
