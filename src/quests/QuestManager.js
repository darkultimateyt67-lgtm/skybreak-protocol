import * as THREE from 'three';
import { buildHead, animateHead } from '../fx/Anatomy.js';

const _v1 = new THREE.Vector3();
const _world = new THREE.Vector3();

/** Procedural human survivor: jacket color per NPC, simple idle life. */
class NPC {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.position = new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]);
    this._phase = Math.random() * 10;
    this._build();
  }

  _build() {
    const g = new THREE.Group();
    const seed = Math.abs(this.def.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    const skinTones = [0xd9a077, 0xb5825e, 0x8c5f42, 0xe8b98f, 0x6e4a32];
    const hairTones = [0x241a12, 0x0e0c0a, 0x4a3826, 0x6b6560, 0x2e1608];
    const skin = new THREE.MeshStandardMaterial({ color: skinTones[seed % skinTones.length], roughness: 0.8 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairTones[seed % hairTones.length], roughness: 0.95 });
    const jacket = new THREE.MeshStandardMaterial({ color: this.def.color, roughness: 0.75, metalness: 0.1 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x1e222b, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.85 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.9 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4 });

    const add = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // Legs: thigh, shin, boot with a heel.
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.15, 0.38, 0.19), pants, 0.12 * side, 0.55, 0);
      add(new THREE.BoxGeometry(0.13, 0.34, 0.16), pants, 0.12 * side, 0.2, 0.01);
      add(new THREE.BoxGeometry(0.15, 0.09, 0.26), boots, 0.12 * side, 0.045, 0.03);
    }
    add(new THREE.BoxGeometry(0.4, 0.08, 0.24), boots, 0, 0.76, 0); // belt
    add(new THREE.BoxGeometry(0.07, 0.06, 0.1), vest, 0.17, 0.76, 0.12); // holster pouch

    // Torso: jacket + tactical vest with chest pouches.
    this.torso = new THREE.Group();
    this.torso.position.y = 1.06;
    g.add(this.torso);
    add(new THREE.BoxGeometry(0.44, 0.56, 0.25), jacket, 0, 0, 0, this.torso);
    add(new THREE.BoxGeometry(0.4, 0.42, 0.3), vest, 0, 0.04, 0, this.torso);
    add(new THREE.BoxGeometry(0.1, 0.12, 0.05), vest, -0.1, 0.08, 0.16, this.torso);
    add(new THREE.BoxGeometry(0.1, 0.12, 0.05), vest, 0.1, 0.08, 0.16, this.torso);
    add(new THREE.BoxGeometry(0.08, 0.08, 0.04), jacket, 0, -0.14, 0.17, this.torso);
    // Shoulder patches in the survivor's color.
    add(new THREE.BoxGeometry(0.14, 0.1, 0.2), jacket, -0.28, 0.22, 0, this.torso);
    add(new THREE.BoxGeometry(0.14, 0.1, 0.2), jacket, 0.28, 0.22, 0, this.torso);

    // Arms: upper (jacket), forearm (rolled sleeve = skin), hand.
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.3 * side, 0.18, 0);
      this.torso.add(arm);
      add(new THREE.BoxGeometry(0.11, 0.3, 0.13), jacket, 0, -0.15, 0, arm);
      add(new THREE.BoxGeometry(0.09, 0.26, 0.1), skin, 0, -0.4, 0.02, arm);
      add(new THREE.BoxGeometry(0.09, 0.09, 0.1), skin, 0, -0.55, 0.03, arm);
      this.arms.push(arm);
    }

    // Full head: cranium, jaw, nose, ears, brows, eyes with lids, moving
    // mouth, and physically simulated hair. Every survivor differs.
    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 1.56;
    g.add(this.headGroup);
    const styles = ['short', 'crop', 'tied', 'buzz', 'long'];
    this.head = buildHead(this.headGroup, {
      skin: skinTones[seed % skinTones.length],
      hairColor: hairTones[seed % hairTones.length],
      eyeColor: [0x4a3a26, 0x2f4a52, 0x3a5a34, 0x5a4a3a][seed % 4],
      hair: styles[seed % styles.length],
      beard: seed % 3 === 0,
      guides: 12,
      strands: 900
    });

    // Quest marker: glowing diamond, shown when this NPC has work for you.
    this.marker = add(
      new THREE.OctahedronGeometry(0.14),
      new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffd24a, emissiveIntensity: 3 }),
      0, 2.1, 0
    );
    this.marker.castShadow = false;

    g.position.copy(this.position);
    this.group = g;
    this.game.scene.add(g);
  }

  update(dt, t, hasQuest) {
    // Idle life: breathing, arm sway, occasional glance; marker spin.
    this.torso.position.y = 1.06 + Math.sin(t * 1.8 + this._phase) * 0.012;
    this.arms[0].rotation.x = Math.sin(t * 1.1 + this._phase) * 0.06;
    this.arms[1].rotation.x = Math.sin(t * 1.1 + this._phase + 1.7) * 0.06;
    this.marker.visible = hasQuest;
    this.marker.rotation.y = t * 2.5;
    this.marker.position.y = 2.1 + Math.sin(t * 3) * 0.06;

    _v1.subVectors(this.game.player.position, this.position);
    const dist = Math.hypot(_v1.x, _v1.z);
    if (dist < 9) {
      // Face the player; the head leads and the body follows.
      const targetYaw = Math.atan2(_v1.x, _v1.z);
      let dy = targetYaw - this.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.headGroup.rotation.y = THREE.MathUtils.clamp(dy, -0.6, 0.6);
      this.group.rotation.y += dy * Math.min(1, dt * 4);
    } else {
      // Idle glance around.
      this.headGroup.rotation.y = Math.sin(t * 0.4 + this._phase) * 0.4;
    }

    // Face. The mouth is driven by the voice engine: while this survivor's
    // line is actually playing, their jaw works. The timer is only a fallback
    // for when speech synthesis is unavailable or switched off.
    this._talk = Math.max(0, (this._talk || 0) - dt);
    const voice = this.game.voice;
    const voicing = voice && voice.speakingWho === this.def.name;
    const talking = voicing || (this._talk > 0 && !(voice && voice.supported && this.game.settings.voice));
    this.headGroup.getWorldPosition(_world);
    animateHead(this.head, dt, t + this._phase, talking ? 'talk' : 'idle', _world);
    return dist;
  }

  /** Fallback mouth timer for when spoken dialogue is off. */
  speak(seconds = 3.5) { this._talk = seconds; }

  dispose() {
    this.game.scene.remove(this.group);
  }
}

/**
 * QuestManager — drives the campaign chain for the current map.
 *
 * Quests come from maps.js as data and run in order: the next quest's giver
 * shows a glowing marker; walk up, press E, do the work, get paid. Kill
 * quests count any SENTINEL destroyed; reach/multi quests place a beacon
 * and trigger ambush defenders on arrival; defend quests hold a circle.
 * Every completion pays credits and advances the chapter's story.
 */
export class QuestManager {
  constructor(game) {
    this.game = game;
    this.npcs = [];
    this.quests = [];
    this.index = 0;        // next quest in the chain
    this.current = null;   // active quest state, or null
    this.chapterDone = false;
    this._beacon = null;
    this._promptText = '';
  }

  reset() {
    for (const n of this.npcs) n.dispose();
    this.npcs = (this.game.world.def.npcs || []).map((d) => new NPC(this.game, d));
    this.quests = this.game.world.def.quests || [];
    this.index = 0;
    this.current = null;
    this.chapterDone = false;
    this._buildBeacon();
    this._setBeacon(null);
    this.game.hud.setQuest(null);
    this.game.hud.setBoss(null);
  }

  _buildBeacon() {
    if (this._beacon) this.game.scene.remove(this._beacon);
    const b = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55),
      new THREE.MeshStandardMaterial({ color: 0x1a1500, emissive: 0xffd24a, emissiveIntensity: 2.6 })
    );
    b.visible = false;
    this.game.scene.add(b);
    this._beacon = b;
  }

  _setBeacon(pos) {
    if (!pos) {
      this._beacon.visible = false;
      return;
    }
    this._beacon.visible = true;
    this._beacon.position.set(pos[0], (pos[1] || 0) + 1.6, pos[2]);
  }

  /** World position the minimap should mark, or null. */
  get markerPos() {
    if (this.current && this.current.def.type === 'boss' && this.current.boss && this.current.boss.alive) {
      return this.current.boss.position;
    }
    if (this._beacon && this._beacon.visible) return this._beacon.position;
    // No active objective: point at the next quest giver.
    const giver = this._nextGiver();
    return giver ? giver.position : null;
  }

  _nextGiver() {
    if (this.current || this.index >= this.quests.length) return null;
    const giverId = this.quests[this.index].giver;
    return this.npcs.find((n) => n.def.id === giverId) || null;
  }

  /** Called by the enemy director on every SENTINEL kill. */
  notifyKill(enemy) {
    const q = this.current;
    if (!q) return;
    if (q.def.type === 'boss') {
      if (enemy && enemy.isBoss) {
        this.game.hud.setBoss(null);
        this._complete();
      }
      return;
    }
    if (q.def.type === 'kill' || q.def.type === 'reach' || q.def.type === 'multi') {
      if (q.progress < q.goal) q.progress++;
      this._checkSite();
      this._refreshHUD();
    }
  }

  /**
   * Reach/multi sites are garrisoned the moment the job is accepted; a site
   * counts as secured once you've set foot on it AND the garrison is down.
   */
  _checkSite() {
    const q = this.current;
    if (!q) return;
    const d = q.def;
    if (d.type === 'kill') {
      if (q.progress >= q.goal) this._complete();
      return;
    }
    if ((d.type !== 'reach' && d.type !== 'multi') || !q.visited || q.progress < q.goal) return;
    if (d.type === 'multi' && q.pointIndex < d.points.length - 1) {
      // Site secured — garrison the next one and move the marker.
      q.pointIndex++;
      q.phase = 'travel';
      q.progress = 0;
      q.visited = false;
      const p = d.points[q.pointIndex];
      this._setBeacon(p);
      this.game.enemies.spawnGroup(q.goal, new THREE.Vector3(p[0], 0, p[2]), { exact: true, guard: true });
      this.game.hud.banner('SITE SECURED', 'NEXT POINT MARKED');
    } else {
      this._complete();
    }
  }

  _accept() {
    const def = this.quests[this.index];
    const q = { def, progress: 0, goal: 0, phase: 'travel', pointIndex: 0, timer: 0, warned: false, visited: false };
    const enemies = this.game.enemies;

    if (def.type === 'kill') {
      q.goal = def.count;
      q.phase = 'ambush'; // kills count immediately
      enemies.spawnGroup(Math.min(def.count + 1, 8), null);
      this._setBeacon(null);
    } else if (def.type === 'reach' || def.type === 'multi') {
      // The site is garrisoned NOW — they hold it until you show up.
      q.goal = (def.type === 'reach' ? def.ambush : def.defendersPer) || 0;
      const p = def.points[0];
      this._setBeacon(p);
      enemies.spawnGroup(q.goal, new THREE.Vector3(p[0], 0, p[2]), { exact: true, guard: true });
    } else if (def.type === 'defend') {
      q.timer = def.duration;
      this._setBeacon([def.point[0], def.point[1], def.point[2]]);
      enemies.spawnGroup(2, new THREE.Vector3(def.point[0], 0, def.point[2]), { exact: true, guard: true });
    } else if (def.type === 'boss') {
      q.boss = this.game.enemies.spawnBoss(
        def.boss,
        new THREE.Vector3(def.point[0], 0.1, def.point[2])
      );
      this._setBeacon(null); // the tac-map tracks the boss itself
    }

    this.current = q;
    this.game.audio.questAccept();
    this.game.hud.banner(def.title, 'NEW OBJECTIVE');
    this.game.hud.comms(def.brief);
    this._refreshHUD();
  }

  _complete() {
    const def = this.current.def;
    this.current = null;
    this._setBeacon(null);
    this.game.addCredits(def.reward);
    this.game.addScore(def.reward);
    this.game.audio.questDone();
    this.game.hud.banner('QUEST COMPLETE', `+${def.reward} CREDITS`);
    setTimeout(() => this.game.hud.comms(def.done), 2600);
    this.index++;
    this.game.saveCareer(); // progress is banked the moment a job is done

    if (this.index >= this.quests.length) {
      this.chapterDone = true;
      const bonus = 1000;
      this.game.addCredits(bonus);
      setTimeout(() => {
        this.game.hud.banner('CHAPTER COMPLETE', `${this.game.world.def.chapter} · +${bonus} BONUS`);
      }, 5200);
    }
    this._refreshHUD();
  }

  _refreshHUD() {
    const hud = this.game.hud;
    if (this.chapterDone) {
      hud.setQuest({ title: 'CHAPTER COMPLETE', text: 'Select the next mission from the menu (ESC).' });
      return;
    }
    const q = this.current;
    if (!q) {
      const giver = this._nextGiver();
      hud.setQuest(giver ? { title: 'FIND WORK', text: `Talk to ${giver.def.name} [E]` } : null);
      return;
    }
    const d = q.def;
    let text = '';
    if (d.type === 'kill') text = `Raiders down: ${q.progress} / ${q.goal}`;
    else if (d.type === 'reach') {
      text = `Garrison down: ${q.progress} / ${q.goal}${q.visited ? '' : ' · reach the marker'}`;
    } else if (d.type === 'multi') {
      text = `Point ${q.pointIndex + 1}/${d.points.length} — garrison: ${q.progress} / ${q.goal}${q.visited ? '' : ' · reach the marker'}`;
    } else if (d.type === 'defend') {
      text = q.phase === 'travel' ? 'Reach the hold point' : `HOLD — ${Math.ceil(q.timer)}s`;
    } else if (d.type === 'boss') {
      text = `Destroy ${d.boss.name}`;
    }
    hud.setQuest({ title: d.title, text });
  }

  update(dt) {
    const game = this.game;
    const t = performance.now() * 0.001;
    const player = game.player;

    // Beacon bob.
    if (this._beacon.visible) this._beacon.rotation.y = t * 1.6;

    // NPCs: idle, facing, interaction prompt.
    const nextGiver = this._nextGiver();
    let prompt = null;
    for (const npc of this.npcs) {
      const dist = npc.update(dt, t, npc === nextGiver);
      if (dist < 3 && !prompt) {
        if (npc === nextGiver) {
          prompt = `[E]  ${npc.def.name} — ACCEPT QUEST`;
          if (game.input.pressed('KeyE')) { npc.speak(6); this._accept(); }
        } else {
          prompt = `[E]  TALK TO ${npc.def.name}`;
          if (game.input.pressed('KeyE')) {
            const barks = npc.def.barks || [];
            if (barks.length) game.hud.comms(barks[Math.floor(Math.random() * barks.length)], npc.def.name);
            npc.speak(4);
            game.audio.npcTalk();
          }
        }
      }
    }
    // Salvage caches: exploration pays.
    if (!prompt) {
      for (const s of game.world.salvagePoints) {
        if (s.taken) continue;
        const dx = player.position.x - s.pos.x;
        const dz = player.position.z - s.pos.z;
        if (dx * dx + dz * dz < 6.5) {
          prompt = '[E]  CRACK SALVAGE CACHE';
          if (game.input.pressed('KeyE')) {
            s.taken = true;
            s.lid.visible = false;
            s.box.material = game.world.mats.structureDark;
            const credits = 60 + Math.floor(Math.random() * 90);
            game.addCredits(credits);
            game.addScore(50);
            game.audio.purchase();
            game.hud.banner('SALVAGE', `+${credits} CREDITS`);
            game.saveCareer();
          }
          break;
        }
      }
    }
    game.hud.setPrompt(prompt);

    // Active quest logic.
    const q = this.current;
    if (!q) return;
    const d = q.def;

    // Boss health bar tracks the fight.
    if (d.type === 'boss' && q.boss) {
      game.hud.setBoss(q.boss.alive
        ? { name: d.boss.name, frac: Math.max(0, q.boss.hp / q.boss.maxHp) }
        : null);
    }

    if ((d.type === 'reach' || d.type === 'multi') && !q.visited) {
      const p = d.points[q.pointIndex];
      const dx = player.position.x - p[0];
      const dz = player.position.z - p[2];
      if (dx * dx + dz * dz < 16) {
        q.visited = true;
        game.audio.wave();
        game.hud.banner('SITE REACHED', q.progress >= q.goal ? 'SECURED' : 'CLEAR THE GARRISON');
        this._checkSite();
        this._refreshHUD();
      }
    } else if (d.type === 'defend') {
      const p = d.point;
      const dx = player.position.x - p[0];
      const dz = player.position.z - p[2];
      const inside = dx * dx + dz * dz < 100; // 10 m radius
      if (q.phase === 'travel') {
        if (inside) {
          q.phase = 'hold';
          game.enemies.setPressure(true);
          game.audio.wave();
          game.hud.banner('HOLD THE POSITION', `${Math.ceil(q.timer)} SECONDS`);
        }
      } else {
        if (inside) {
          q.timer -= dt;
          q.warned = false;
          if (q.timer <= 0) {
            game.enemies.setPressure(false);
            this._complete();
            return;
          }
        } else if (!q.warned) {
          q.warned = true;
          game.hud.comms('You’re off the point — the timer is paused. Get back in there!');
        }
        this._refreshHUD();
      }
    }
  }
}
