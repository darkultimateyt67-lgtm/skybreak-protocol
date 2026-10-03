/**
 * The loading screen.
 *
 * Before this, loading GTAZ meant clicking DEPLOY and watching the menu freeze
 * solid for many seconds: the whole city is built in one go on the main
 * thread, and while it builds the browser cannot draw a single frame. Nothing
 * moved, nothing said "loading", and a player had every reason to think the
 * game had crashed.
 *
 * Two things fix that, and both are needed:
 *
 *   1. The overlay (index.html) animates using only `transform` and
 *      `opacity`, which the browser runs on its compositor thread — so it keeps
 *      moving even while the main thread is busy.
 *
 *   2. The build is broken into stages with a pause between each (see
 *      `frame()`), so the progress text and bar really do advance. Inside one
 *      long stage the bar is set to glide toward that stage's end over about
 *      the time the stage takes, so it is never sitting still.
 *
 * It finishes on a CLICK TO PLAY button rather than dropping straight in. That
 * is not only ceremony: the browser only lets a page capture the mouse for a
 * few seconds after a click, and the build takes longer than that, so the old
 * flow lost the capture every time and fell back to the slower look mode with
 * a "click to enable precise aim" warning. The click on this button is a
 * fresh one, so the capture always succeeds — and the player gets a moment to
 * read the screen instead of being shoved into it.
 */

/** What each mode says while it loads: a heading, a line, and some tips. */
const INFO = {
  career: {
    mode: 'Career',
    sub: 'The Halcyon station. The VANTAGE-6 crash.',
    tips: [
      ['STORY', 'Nine seconds of silence from HELIOS, and half the station started answering to its voice.'],
      ['TIP', 'Anyone with a gold marker over their head has work for you. Walk up and press E.'],
      ['TIP', 'Hold W beside a wall while you are in the air to run along it. Space to leap off.'],
      ['TIP', 'Dying costs you a fifth of your credits, but never your quest progress.'],
      ['STORY', 'Sgt. Daniel Reyes walked away from the crash with you. Everyone else on that dropship did not.']
    ]
  },
  skirmish: {
    mode: 'Skirmish',
    sub: 'Pick an arena and hold it.',
    tips: [
      ['TIP', 'Sliding (C while sprinting) keeps your speed and makes you harder to hit.'],
      ['TIP', 'Q sends a recon pulse: it damages and marks every enemy on the tac-map.'],
      ['TIP', 'B opens the supply uplink, where credits buy weapons, armour and charges.']
    ]
  },
  battleground: {
    mode: 'Battleground',
    sub: 'Drop in. Loot. Be the last one standing.',
    tips: [
      ['TIP', 'B toggles build mode. Walls go up fast — use them before you need them.'],
      ['TIP', 'H harvests materials from anything that looks like it would break.'],
      ['TIP', 'Watch the storm timer. The circle does not wait for you to finish a fight.']
    ]
  },
  gtaz: {
    mode: 'GTAZ — The City',
    sub: 'Eight districts above. Five halls below.',
    tips: [
      ['TIP', 'Press F next to any car, bike, plane or boat to take it. F again to get out.'],
      ['STORY', 'Under the city are five halls that nobody remembers building. A fixer is paying, per key, for what is at the bottom of each.'],
      ['STORY', 'The wardens who built those halls left their warnings on the walls. Stand at an inscription to read it.'],
      ['STORY', 'Whatever is down there grows a body, sends it up, and watches how it dies. Then it grows a better one.'],
      ['TIP', 'Hit a ramp fast enough and the car leaves the ground. Land badly and it will not stay upright.'],
      ['TIP', 'Hitting people and wrecking cars draws the police. The longer it goes on, the harder they come.']
    ]
  }
};

const el = (id) => document.getElementById(id);

let tipTimer = 0;
let tipIndex = 0;
let readyResolve = null;

/** Let the browser paint at least one frame. Works in a background tab too. */
function frame() {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    // Two rAFs is the reliable "the last change is now on screen". The timer
    // is there because rAF never fires in a hidden tab.
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 60);
  });
}

function setBar(frac, glideMs = 0, toFrac = frac) {
  const fill = el('ld-fill');
  if (!fill) return;
  // Snap to where this stage starts...
  fill.style.transition = 'none';
  fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac))})`;
  void fill.offsetWidth;
  // ...then glide toward where it ends, on the compositor, so the bar keeps
  // creeping forward even while the stage is blocking the main thread.
  if (glideMs > 0 && toFrac > frac) {
    fill.style.transition = `transform ${glideMs}ms cubic-bezier(.25,.6,.4,1)`;
    fill.style.transform = `scaleX(${Math.min(1, toFrac)})`;
  }
  const pct = el('ld-pct');
  if (pct) pct.textContent = Math.round(Math.max(frac, 0.03) * 100) + '%';
}

function showTip(info) {
  const box = el('ld-tip');
  if (!box || !info || !info.tips.length) return;
  const [kind, text] = info.tips[tipIndex % info.tips.length];
  tipIndex++;
  box.style.opacity = '0';
  setTimeout(() => {
    box.innerHTML = `<small>${kind === 'STORY' ? 'THE STORY SO FAR' : 'TIP'}</small>${text}`;
    box.style.opacity = '1';
  }, 180);
}

export const Loading = {
  frame,

  /**
   * Bring the screen up for a mode. `sub` overrides the mode's own line — the
   * campaign uses it for the chapter name.
   */
  show(modeId, sub) {
    const root = el('loading');
    if (!root) return;
    const info = INFO[modeId] || INFO.career;
    root.classList.remove('hidden', 'gone', 'ready');
    el('ld-mode').textContent = info.mode;
    el('ld-sub').textContent = sub || info.sub;
    el('ld-step').textContent = 'Getting ready';
    setBar(0.03);
    tipIndex = Math.floor(Math.random() * info.tips.length);
    showTip(info);
    clearInterval(tipTimer);
    tipTimer = setInterval(() => showTip(info), 5200);
  },

  /**
   * Enter a stage of the load.
   * @param label   what is happening, in words a player understands
   * @param from    bar position this stage starts at (0..1)
   * @param to      where it ends
   * @param estMs   about how long it takes — the bar glides over that time
   */
  step(label, from, to = from, estMs = 0) {
    const s = el('ld-step');
    if (s) s.textContent = label;
    setBar(from, estMs, to);
  },

  /**
   * Loading is finished. On a computer, wait for a click (which is also what
   * lets the game capture the mouse). On a touch screen there is no mouse to
   * capture, so go straight in.
   */
  ready(touch = false) {
    const root = el('loading');
    if (!root) return Promise.resolve();
    setBar(1);
    el('ld-step').textContent = 'Ready';
    if (touch) return Promise.resolve();
    root.classList.add('ready');
    const btn = el('ld-go');
    btn.textContent = 'CLICK TO PLAY';
    return new Promise((resolve) => {
      readyResolve = resolve;
      // The whole screen is the button: nobody should have to aim for it.
      const go = (e) => {
        if (e) e.preventDefault();
        root.removeEventListener('pointerdown', go);
        window.removeEventListener('keydown', key);
        readyResolve = null;
        resolve();
      };
      const key = (e) => { if (e.code === 'Space' || e.code === 'Enter') go(e); };
      root.addEventListener('pointerdown', go);
      window.addEventListener('keydown', key);
    });
  },

  hide() {
    const root = el('loading');
    if (!root) return;
    clearInterval(tipTimer);
    root.classList.add('gone');
    root.classList.remove('ready');
    setTimeout(() => { if (root.classList.contains('gone')) root.classList.add('hidden'); }, 650);
  },

  isOpen() {
    const root = el('loading');
    return !!root && !root.classList.contains('hidden') && !root.classList.contains('gone');
  }
};
