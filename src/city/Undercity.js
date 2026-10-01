/**
 * The Undercity — the story under GTAZ, and how it gets told.
 *
 * The halls were already good to look at and had nothing to say. A dungeon
 * with a one-line brief is a shooting gallery with a theme; what makes one
 * worth going back into is finding out what the place WAS, in the place
 * itself, at the pace you walk.
 *
 * THE PREMISE ties itself to a mechanic that was already in the game. Bosses
 * here learn from how the last one died (see BossMemory). That is not five
 * monsters — that is one thing revising a draft. So: the halls are not a lair
 * and not a tomb. They are a LOCK, five wards deep, built by people who could
 * not kill what they found and settled for keeping it. Each ward holds one
 * key. A drilling crew broke in forty years ago and took what they could
 * carry. Now a fixer upstairs is paying you, per key, to finish the job — and
 * every key you bring up is one turn of the lock.
 *
 * THREE VOICES, so the place argues with itself:
 *
 *   WARDENS — carved into the stone. Practical, tired, unsentimental people
 *   writing instructions for whoever comes next. They are not mystics; they
 *   are staff.
 *
 *   THE DIG — the crew who broke in, on boards and paper they left behind.
 *   Cheerful, then unnerved, then gone. They are you, forty years early.
 *
 *   THE FIXER — the radio in your ear, who has read none of it and would
 *   rather you did not either.
 *
 * Nothing here is delivered by a cutscene. Inscriptions and notes are objects
 * in the room; you read one by standing at it. The briefs shift as you take
 * keys, and the last ward opens only when you have taken the other four.
 */

/** The five wards, in the order the wardens cut them. */
export const WARDS = {
  hollow: {
    order: 1,
    epigraph: 'FIRST WARD. THE SHALLOW ONE. WE LEARNED HERE.',
    fixer: 'Easy one to start. Old dig, old rock, something living in it. '
      + 'Bring up the stone in the back room and I will make you rich slowly.',
    onKey: 'FIRST LOCK OPEN',
    lore: [
      { kind: 'warden', title: 'CUT INTO THE LINTEL', text: 'We did not build this to live in. We built it to keep. Read the rest before you touch anything.' },
      { kind: 'warden', title: 'THE FIRST RULE', text: 'It speaks in the voice of whoever it heard last. If you hear yourself down here, you are already answering it.' },
      { kind: 'warden', title: 'ON THE WATER', text: 'The weeping is only rain, ninety years late. Let it in. Wet stone is quieter than dry, and quiet is the whole of the work.' },
      { kind: 'dig', title: 'SURVEY NOTE 3 — HALLORAN', text: 'Broke through at sixty-one metres. Dressed stone. DRESSED. Somebody cut every block down here by hand and nobody in the city has a record of it. Call the office. Call everybody.' },
      { kind: 'dig', title: 'SURVEY NOTE 9 — HALLORAN', text: 'The lads have stopped whistling. Not a rule, nobody told them. They just stopped.' },
      { kind: 'warden', title: 'ON THE KEY', text: 'The stone in the back room is not treasure. It is a weight on a door. Whoever takes it up the stairs has opened something and should say so out loud, to somebody, before they spend the money.' }
    ]
  },
  marrow: {
    order: 2,
    epigraph: 'SECOND WARD. WE WENT DEEPER THAN WE MEANT TO, AS YOU WILL.',
    fixer: 'The old dig hit something here and the company buried the paperwork. '
      + 'Bring up the core sample. Whatever is guarding it can stay where it is.',
    onKey: 'SECOND LOCK OPEN',
    lore: [
      { kind: 'warden', title: 'ON DIGGING', text: 'Do not open new ways. Every gallery we cut, it used. We stopped cutting. That is not cowardice; it is the only lesson we paid full price for.' },
      { kind: 'dig', title: 'SHIFT LOG — 14 MARCH', text: 'Bore head came back polished. Not worn. Polished, like something cleaned it. Foreman says keep drilling. Foreman is not down here.' },
      { kind: 'dig', title: 'SHIFT LOG — 2 APRIL', text: 'Lost Pike on the night shift. Not a collapse. He walked off down a gallery answering somebody. We all heard the somebody. It was Pike.' },
      { kind: 'warden', title: 'ON ANSWERS', text: 'It grows a body, sends it up, and watches it die. Then it grows a better one. We have buried eleven. The eleventh knew our names.' },
      { kind: 'dig', title: 'COMPANY MEMO — CARREL DEEP WORKS', text: 'Seam is exhausted. Shaft to be capped and grouted. All survey material returns to head office. No further statements to the city.' },
      { kind: 'warden', title: 'ON THE COMPANY THAT WILL COME', text: 'Someone will come for the metal. They will take the keys because they are the only loose things down here. Tell them. They will not listen. Tell them anyway.' }
    ]
  },
  emberfall: {
    order: 3,
    epigraph: 'THIRD WARD. WE BURNED THE PASSAGE. IT IS STILL WARM.',
    fixer: 'Heat is coming up through the floor and so is everything living in it. '
      + 'Grab the ember heart and get out before it works out you are in there.',
    onKey: 'THIRD LOCK OPEN',
    lore: [
      { kind: 'warden', title: 'ON FIRE', text: 'We filled the lower gallery with fire for eleven days. It did not kill it. It made the way in narrow, and narrow is worth eleven days.' },
      { kind: 'warden', title: 'THE COST', text: 'Nineteen of us went down to light it and four came back. We do not write their names on the wall. We write them on the inside of the door, where it has to read them every time it tries.' },
      { kind: 'dig', title: 'SHIFT LOG — 30 JUNE', text: 'Forty-one degrees at the face. Drills seizing. Rock is warm to the hand and there is no magma within a mile of this coast. Something down there is running hot.' },
      { kind: 'warden', title: 'ON PATIENCE', text: 'It is not hunting you. It is waiting for the building to stop. Stone does not last. It knows this better than we do.' },
      { kind: 'dig', title: 'PINNED NOTE, NO SIGNATURE', text: 'If you are reading this and the lamps are out, do not relight them. It comes to the light. That is not superstition, I have watched it.' }
    ]
  },
  saltmaw: {
    order: 4,
    epigraph: 'FOURTH WARD. WE LET THE SEA IN. THAT WAS THE PLAN.',
    fixer: 'Sea caves under the strip. The tide brought something in with it. '
      + 'Retrieve the drowned cache. Do not open it, do not look in it, bring it up.',
    onKey: 'FOURTH LOCK OPEN',
    lore: [
      { kind: 'warden', title: 'ON THE FLOOD', text: 'We cut through to the sea and drowned the eastern gallery on purpose. Salt water is a wall it cannot think its way past quickly. Do not pump it out. Ever.' },
      { kind: 'dig', title: 'SHIFT LOG — 8 AUGUST', text: 'Pumped the east gallery dry today. Two days of work, and the lads found the cache sitting on a plinth like it was set out for us. Overtime paid. Good day.' },
      { kind: 'dig', title: 'SHIFT LOG — 9 AUGUST', text: 'Water is back. We did not stop pumping. It is back anyway, and it is warm.' },
      { kind: 'warden', title: 'ON THE DROWNED THING', text: 'The cache is a lung. While it is underwater, the thing below breathes slowly. Dry it and you will hear the difference in a day.' },
      { kind: 'warden', title: 'ON LEAVING', text: 'Every one of us meant to go up and live somewhere with a window. Read the tombs in the fifth ward and count how many managed it.' }
    ]
  },
  gravemouth: {
    order: 5,
    epigraph: 'FIFTH WARD. WE STAYED. SOMEBODY HAD TO.',
    fixer: 'Deepest one. Nobody who has gone in has come back up. '
      + 'The crown is the last piece the buyer wants. Then we are square, and I mean that.',
    onKey: 'THE LOCK IS OPEN',
    lore: [
      { kind: 'warden', title: 'THE LAST INSCRIPTION — MARA OKONKWO, WARDEN', text: 'I am the last one who can still cut stone. When this line ends, the work ends with it, and the rest is down to whoever reads this.' },
      { kind: 'warden', title: 'ON THE CROWN', text: 'It is not a crown. It is the last weight. We shaped it like a crown so that anyone greedy enough to take it would at least be remembered as a fool.' },
      { kind: 'warden', title: 'ON WHAT IT IS', text: 'We never named it. Naming is answering. It is patient, it is awake, and it has been down there longer than the coastline. That is the whole of what we know after four generations.' },
      { kind: 'dig', title: 'LAST PAGE OF THE DIG BOOK', text: 'Told the office the fifth chamber is flooded and impassable. It is neither. I am not sending anyone else down there. Cap the shaft. — R. HALLORAN, FOREMAN' },
      { kind: 'warden', title: 'FOR WHOEVER TAKES THE FIFTH', text: 'You will have carried four of these up already and told yourself they were rocks. This is the one that matters. Put it down. Walk out. We are not asking for ourselves.' }
    ]
  }
};

/** What the thing sends up, one draft at a time. */
const ANSWER_ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];

/** Said on the way in, once the player has started unlocking things. */
const PROGRESS_LINES = [
  null,
  'One key up. The halls below are quieter than they were.',
  'Two keys up. Something in the rock has started counting.',
  'Three keys up. The wardens wrote about this part.',
  'Four keys up. One ward left, and it knows it.'
];

export class Undercity {
  // Built by the City (the halls are dressed during the city build, long
  // before FreeRoam exists), then FreeRoam attaches itself as `fr`.
  constructor(game) {
    this.game = game;
    this.fr = null;
    /** Lore anchors in the world: { x, y, z, ward, index, read }. */
    this.anchors = [];
    this.read = new Set();
    this.keys = new Set();
    this._cool = 0;
    this._last = null;
  }

  /** Total lore in the game, and how much of it the player has found. */
  get total() {
    return Object.values(WARDS).reduce((n, w) => n + w.lore.length, 0);
  }

  /**
   * Register a readable object. Dungeon.js calls this as it places steles and
   * notice boards, so the text and the geometry can never drift apart: the
   * hall asks for the next piece of its ward's story and gets it.
   */
  claim(wardId, x, y, z) {
    const w = WARDS[wardId];
    if (!w) return null;
    const used = this.anchors.filter((a) => a.ward === wardId).length;
    if (used >= w.lore.length) return null;
    const piece = w.lore[used];
    const a = { x, y, z, ward: wardId, index: used, piece };
    this.anchors.push(a);
    return a;
  }

  /** The next piece this ward will hand out, without taking it. */
  peek(wardId) {
    const w = WARDS[wardId];
    if (!w) return null;
    const used = this.anchors.filter((a) => a.ward === wardId).length;
    return used < w.lore.length ? w.lore[used] : null;
  }

  /** How many pieces a ward has left to place (for laying them out evenly). */
  remaining(wardId) {
    const w = WARDS[wardId];
    if (!w) return 0;
    return w.lore.length - this.anchors.filter((a) => a.ward === wardId).length;
  }

  /** Walking up to an inscription reads it, once. */
  update(dt, player) {
    this._cool = Math.max(0, this._cool - dt);
    if (!this.fr || !this.fr.inDungeon || this._cool > 0) return;
    const p = player.position;
    let best = null, bd = 3.6 * 3.6;
    for (const a of this.anchors) {
      if (this.read.has(a.ward + ':' + a.index)) continue;
      if (Math.abs(a.y - p.y) > 4) continue;
      const d = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return;
    this.read.add(best.ward + ':' + best.index);
    this._cool = 1.2;
    const g = this.game;
    const tag = best.piece.kind === 'warden' ? 'WARDEN' : 'THE DIG';
    g.hud.brToast?.(tag + ' · ' + best.piece.title, best.piece.text,
      best.piece.kind === 'warden' ? '#d8c89a' : '#9fd8ff');
    if (g.audio?.pickup) g.audio.pickup();
  }

  /**
   * The contract brief, in the fixer's voice — and the fixer gets less
   * comfortable the more of these you bring up, because he has worked out
   * that you have started reading the walls.
   */
  brief(cave) {
    const w = WARDS[cave.def?.id || cave.id];
    if (!w) return cave.mission?.brief || '';
    const n = this.keys.size;
    const tail = n < 2 ? ''
      : n === 2 ? ' And do not stop to read the walls down there. It slows people down.'
        : n === 3 ? ' Whatever you have been reading is forty years old and it is not your problem.'
          : ' One left after this. Then you never have to go under this city again.';
    return w.fixer + tail;
  }

  /** The line that plays as you drop into a hall. */
  onEnter(cave) {
    const w = WARDS[cave.def.id];
    const g = this.game;
    if (!w) return;
    const line = PROGRESS_LINES[Math.min(PROGRESS_LINES.length - 1, this.keys.size)];
    setTimeout(() => {
      g.hud.brToast?.(w.epigraph, line || w.fixer, '#d8c89a');
    }, 2200);
  }

  /** Taking a key turns the lock — and the last one opens the floor. */
  onKey(cave) {
    const w = WARDS[cave.def.id];
    const g = this.game;
    if (!w || this.keys.has(cave.def.id)) return;
    this.keys.add(cave.def.id);
    const left = 5 - this.keys.size;
    g.hud.brToast?.(w.onKey,
      left > 0
        ? `${left} ward${left === 1 ? '' : 's'} still holding. The wardens counted these.`
        : 'Every ward is open. Whatever they were keeping down here is no longer kept.',
      '#ffb35a');
    if (this.keys.size === 5) this.opened = true;
  }

  /**
   * What is waiting at the bottom. It is one thing, not five — so it is
   * numbered by how many of its bodies you have put down, which is exactly
   * what the boss memory already counts.
   */
  bossName(cave, defeated) {
    const n = Math.min(ANSWER_ORDINALS.length - 1, defeated || 0);
    const ord = ANSWER_ORDINALS[n];
    if (this.opened) return 'THE LAST ANSWER';
    return `THE ${ord} ANSWER`;
  }

  /** A line for the moment the boss stands up, sharper each time. */
  bossLine(defeated) {
    if (!defeated) return 'It has never had to try before.';
    if (defeated === 1) return 'It has had one death to think about.';
    if (defeated < 4) return `It has ${defeated} deaths to think about, and it is not in a hurry.`;
    return 'It stopped experimenting a while ago. This is the version that works.';
  }

  /** Progress readout for the HUD or pause screen. */
  status() {
    return {
      lore: this.read.size,
      loreTotal: this.total,
      keys: this.keys.size,
      opened: !!this.opened
    };
  }
}
