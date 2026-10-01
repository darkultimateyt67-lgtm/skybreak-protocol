import * as THREE from 'three';

/**
 * Missions — contracts for GTAZ.
 *
 * The city already reacts to you; this gives you a reason to go somewhere
 * specific. Contracts are picked up at a board, run one at a time, and every
 * one ends by paying out, so the economy the shops and cafes already use has
 * something feeding it.
 *
 * Objectives are deliberately a small vocabulary — go there, clear that,
 * fetch this, deliver it, survive — because a handful of verbs recombined
 * across five dungeons and a whole city produces far more variety than a
 * long list of one-off special cases nobody can maintain.
 */

const TYPES = [
  {
    id: 'raid',
    title: 'CRACK THE VAULT',
    brief: (d) => `Get into ${d.name}, take what is in the back room, and get out.`,
    pay: 900,
    steps: ['enterDungeon', 'takeObjective', 'exitDungeon']
  },
  {
    id: 'clear',
    title: 'CLEAR THE NEST',
    brief: (d) => `${d.name} is crawling. Go down and put every one of them on the floor.`,
    pay: 1200,
    steps: ['enterDungeon', 'killAll', 'exitDungeon']
  },
  {
    id: 'courier',
    title: 'RUNNING PACKAGE',
    brief: (d) => `Pick the package up at ${d.name} and drive it across town before anyone catches on.`,
    pay: 750,
    steps: ['enterDungeon', 'takeObjective', 'exitDungeon', 'deliver']
  },
  {
    id: 'grand-theft',
    title: 'ORDERED VEHICLE',
    brief: () => 'A buyer wants a specific car. Take it off whoever is driving it and bring it to the drop.',
    pay: 650,
    steps: ['stealTarget', 'deliverVehicle']
  },
  {
    id: 'heat',
    title: 'MAKE SOME NOISE',
    brief: () => 'Draw the law out and stay ahead of them. Reach three stars, then lose them.',
    pay: 800,
    steps: ['reachStars', 'loseStars']
  }
];

const _v = new THREE.Vector3();

export class Missions {
  constructor(freeRoam) {
    this.fr = freeRoam;
    this.game = freeRoam.game;
    this.city = freeRoam.city;
    this.active = null;
    this.stepIndex = 0;
    this.offers = [];
    this.completed = 0;
    this.board = null;
    this._nearBoard = false;
  }

  /** No board in town any more — each cave carries its own contract. */
  build(rand) {
    const w = this.fr.city.world;
    const bx = 40, bz = 70;
    const post = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7, metalness: 0.5 });
    const face = new THREE.MeshStandardMaterial({
      color: 0x0a1418, emissive: 0x37e6ff, emissiveIntensity: 1.1, roughness: 0.5
    });
    w._block(0.35, 2.6, 0.35, bx - 1.6, 0, bz, post, { surface: 'metal' });
    w._block(0.35, 2.6, 0.35, bx + 1.6, 0, bz, post, { surface: 'metal' });
    w._block(4.0, 2.2, 0.22, bx, 1.4, bz, post, { surface: 'metal' });
    w._block(3.4, 1.7, 0.1, bx, 1.6, bz - 0.14, face, { collide: false });
    this.board = { x: bx, z: bz };
    this.reroll(rand);
    return this;
  }

  /**
   * Contracts come from the CAVES themselves, one each, rather than being
   * rolled from a table. A cave you have not run is a job you have not done,
   * which means the map itself is the quest log — walk up to a mouth and the
   * contract is right there.
   */
  reroll() {
    const caves = this.fr.dungeons || [];
    this.offers = caves.filter((c) => !c.cleared).map((c) => ({
      cave: c,
      type: {
        id: 'delve',
        title: c.mission.title,
        brief: () => this.fr.undercity?.brief(c) || c.mission.brief,
        steps: ['enterDungeon', 'takeObjective', 'exitDungeon']
      },
      dungeon: c,
      drop: { x: c.hatch.x, z: c.hatch.z },
      targetChassis: 'sport',
      pay: c.mission.pay
    }));
  }

  _randomDrop(rand) {
    const n = this.city.nodes[(rand() * this.city.nodes.length) | 0];
    return { x: n.x, z: n.z };
  }

  accept(offer) {
    const g = this.game;
    this.active = {
      ...offer,
      steps: offer.type.steps.slice(),
      killTarget: offer.dungeon ? Math.max(4, Math.round(offer.dungeon.size * 1.2)) : 0,
      killed: 0
    };
    this.stepIndex = 0;
    if (offer.dungeon) offer.dungeon.objective.taken = false;
    g.hud.showMenuBoard?.(null);
    g.hud.brToast?.(offer.type.title, offer.type.brief(offer.dungeon || {}));
    this._announceStep();
  }

  abandon() {
    if (!this.active) return;
    this.game.hud.brToast?.('CONTRACT DROPPED', '');
    this.active = null;
    this.stepIndex = 0;
  }

  get currentStep() {
    return this.active ? this.active.steps[this.stepIndex] : null;
  }

  _announceStep() {
    const g = this.game;
    const a = this.active;
    if (!a) return;
    const d = a.dungeon;
    const text = {
      enterDungeon: d ? `Get down into ${d.name}` : 'Get underground',
      takeObjective: 'Find the back room and take it',
      killAll: `Clear them out — ${a.killTarget - a.killed} left`,
      exitDungeon: 'Get back to the surface',
      deliver: 'Drive it to the drop',
      stealTarget: `Steal a ${a.targetChassis.toUpperCase()} off its driver`,
      deliverVehicle: 'Bring it to the drop',
      reachStars: 'Get to three stars',
      loseStars: 'Now lose them'
    }[this.currentStep] || '';
    g.hud.setObjective?.(a.type.title, text);
  }

  _advance() {
    const g = this.game;
    this.stepIndex++;
    if (this.stepIndex >= this.active.steps.length) {
      const pay = this.active.pay;
      g.credits = (g.credits || 0) + pay;
      g.hud.setCredits?.(g.credits);
      g.hud.brToast?.('CONTRACT COMPLETE', `+${pay} credits`);
      if (g.audio?.questDone) g.audio.questDone();
      if (this.active.cave) this.active.cave.cleared = true;
      this.completed++;
      this.active = null;
      this.stepIndex = 0;
      g.hud.setObjective?.(null);
      this.reroll();
      return;
    }
    if (g.audio?.questAccept) g.audio.questAccept();
    this._announceStep();
  }

  update(dt) {
    const g = this.game;
    const fr = this.fr;
    const p = g.player.position;

    // --- Take the job at the mouth of the cave ------------------------------
    // The caves ARE the quest log. Walk up to one you have not run and the
    // contract is right there, which beats trekking back to a board in town
    // every time you finish something.
    if (!this.active) {
      let near = null;
      for (const c of (this.fr.dungeons || [])) {
        if (c.cleared) continue;
        if (Math.hypot(p.x - c.hatch.x, p.z - c.hatch.z) < 16) { near = c; break; }
      }
      if (near !== this._nearCave) {
        this._nearCave = near;
        if (near) g.hud.brToast?.(near.name, `E to accept  ·  ${near.mission.pay} credits`);
      }
      if (near && g.input.pressed('KeyE')) {
        const offer = this.offers.find((o) => o.cave === near);
        if (offer) this.accept(offer);
      }
    }

    if (!this.active) return;
    const a = this.active;
    const step = this.currentStep;
    const d = a.dungeon;

    switch (step) {
      case 'enterDungeon':
        if (d && p.y < -30) this._advance();
        break;

      case 'takeObjective':
        if (d && !d.objective.taken) {
          const dist = Math.hypot(p.x - d.objective.x, p.z - d.objective.z);
          if (dist < 3 && Math.abs(p.y - d.objective.y) < 4) {
            d.objective.taken = true;
            // A key out of its ward: the lock turns one notch.
            this.fr.undercity?.onKey(d);
            g.hud.brToast?.('SECURED', 'Now get out');
            if (g.audio?.chestOpen) g.audio.chestOpen();
            this._advance();
          }
        }
        break;

      case 'killAll':
        a.killed = fr.dungeonKills || 0;
        if (a.killed >= a.killTarget) this._advance();
        else this._announceStep();
        break;

      case 'exitDungeon':
        if (p.y > -10) this._advance();
        break;

      case 'deliver':
      case 'deliverVehicle': {
        const dist = Math.hypot(p.x - a.drop.x, p.z - a.drop.z);
        const needsCar = step === 'deliverVehicle';
        if (dist < 12 && (!needsCar || (fr.driving && fr.driving.style.id === a.targetChassis))) {
          this._advance();
        }
        break;
      }

      case 'stealTarget':
        if (fr.driving && fr.driving.style.id === a.targetChassis) this._advance();
        break;

      case 'reachStars':
        if (fr.wanted.level >= 3) this._advance();
        break;

      case 'loseStars':
        if (fr.wanted.level === 0) this._advance();
        break;
    }

    // A live waypoint for whatever the current step points at.
    this._marker(step, a, d);
  }

  /** Where the objective arrow should point. */
  _marker(step, a, d) {
    let target = null;
    if (step === 'enterDungeon' && d) target = { x: d.hatch.x, z: d.hatch.z };
    else if (step === 'takeObjective' && d) target = { x: d.objective.x, z: d.objective.z };
    else if (step === 'exitDungeon' && d) target = { x: d.hatch.x, z: d.hatch.z };
    else if (step === 'deliver' || step === 'deliverVehicle') target = a.drop;
    this.marker = target;
  }

  stop() {
    this.active = null;
    this.game.hud.setObjective?.(null);
    this.game.hud.showMenuBoard?.(null);
  }
}

export { TYPES as MISSION_TYPES };
