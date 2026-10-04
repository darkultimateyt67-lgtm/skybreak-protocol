import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  getDatabase, ref, onValue, get, set, remove, query, orderByChild, limitToLast, serverTimestamp, update
} from 'firebase/database';
import { FIREBASE_CONFIG, DEFAULT_MAX_PLAYERS } from '../online/config.js';

/**
 * The creators' and admins' dashboard: who is playing, for how long, on what,
 * and how well it runs for them. Creators can also change the player limit,
 * grant roles and remove saved models. Admins see everything read-only.
 * The database rules enforce all of that; this page only mirrors it.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toLocaleString());

function dur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function when(ts) {
  return ts ? new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
const dev = (d) => (d ? `${esc(d.type)} · ${esc(d.os)} · ${esc(d.browser)}` : '—');
const MODES = { career: 'Career', skirmish: 'Skirmish', battleground: 'Battleground', gtaz: 'GTAZ' };

/** Returns true if the table was redrawn (so handlers need re-binding). */
function table(el, head, rows, empty) {
  const html = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="muted">${empty}</td></tr>`}</tbody>`;
  // Untouched when nothing changed: the 5-second refresh would otherwise
  // close a dropdown someone is in the middle of using.
  if (el._html === html) return false;
  el._html = html;
  el.innerHTML = html;
  return true;
}

// ---------------------------------------------------------------------------

if (!FIREBASE_CONFIG) {
  $('gate').innerHTML = `<h2>Not set up yet</h2><p class="muted">The online features need a Firebase project. Once its settings are in
    <code>src/online/config.js</code>, this page comes alive.</p>`;
} else {
  start();
}

async function start() {
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getDatabase(app);
  await auth.authStateReady();

  const gate = (html) => {
    $('dash').classList.add('hidden');
    $('gate').classList.remove('hidden');
    $('gate').innerHTML = html;
  };

  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    gate(`<h2>Staff sign-in</h2><p class="muted">Sign in with the Google account a creator gave a role to.</p>
      <button id="signin">Sign in with Google</button><p id="gate-msg" class="muted"></p>`);
    $('signin').onclick = async () => {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        location.reload();
      } catch (e) {
        $('gate-msg').textContent = e.message;
      }
    };
    return;
  }

  $('who').innerHTML = `${esc(user.displayName || user.email)} · <a href="#" id="signout">sign out</a>`;
  $('signout').onclick = async (e) => { e.preventDefault(); await signOut(auth); location.reload(); };

  // Role, with the same first-creator rule the game uses.
  let role = (await get(ref(db, 'roles/' + user.uid))).val();
  if (!role && !(await get(ref(db, 'roles'))).exists()) {
    await set(ref(db, 'roles/' + user.uid), 'creator');
    role = 'creator';
  }
  await update(ref(db, 'users/' + user.uid), {
    name: user.displayName || '', email: user.email || '', lastSeen: serverTimestamp()
  });
  if (role !== 'creator' && role !== 'admin') {
    gate(`<h2>No access yet</h2><p class="muted">You are signed in as <b>${esc(user.email)}</b>, but this account has no staff role.
      Ask a creator to open this page and grant you one under <b>Staff</b>.</p>`);
    return;
  }

  const creator = role === 'creator';
  document.body.classList.toggle('is-creator', creator);
  $('gate').classList.add('hidden');
  $('dash').classList.remove('hidden');
  $('who').insertAdjacentHTML('afterbegin', `<span class="role">${role}</span> `);

  // ---- live state ----------------------------------------------------------
  const data = { live: {}, slots: {}, config: {}, players: {}, sessions: {}, users: {}, roles: {}, world: {} };
  const watch = (path, key, q) => onValue(q || ref(db, path), (s) => { data[key] = s.val() || {}; render(); },
    (err) => console.warn(path, err.message));
  watch('live', 'live');
  watch('slots', 'slots');
  watch('config', 'config');
  watch('players', 'players');
  watch('sessions', 'sessions', query(ref(db, 'sessions'), orderByChild('start'), limitToLast(400)));
  watch('roles', 'roles');
  watch('world', 'world');
  if (creator) watch('users', 'users');
  setInterval(render, 5000);   // keep "playing for" and "ago" ticking

  if (creator) {
    $('max-save').onclick = async () => {
      const n = Math.max(1, Math.min(1000, parseInt($('max-input').value, 10) || DEFAULT_MAX_PLAYERS));
      await update(ref(db, 'config'), { maxPlayers: n });
      $('limit-msg').textContent = `Saved. New players are now limited to ${n} at once.`;
    };
    $('free-slots').onclick = async () => {
      const live = new Set(Object.keys(data.live));
      const stuck = Object.entries(data.slots).filter(([, uid]) => uid && !live.has(uid));
      await Promise.all(stuck.map(([i]) => remove(ref(db, 'slots/' + i))));
      $('limit-msg').textContent = stuck.length ? `Freed ${stuck.length} stuck slot(s).` : 'No stuck slots.';
    };
  }

  let maxTyped = false;
  $('max-input').addEventListener('input', () => { maxTyped = true; });

  function render() {
    const max = data.config.maxPlayers || DEFAULT_MAX_PLAYERS;
    const live = Object.entries(data.live);
    const online = live.length;
    $('online-now').textContent = online;
    $('online-max').textContent = max;
    if (!maxTyped) $('max-input').value = max;
    const frac = Math.min(1, online / max);
    const fill = $('meter-fill');
    fill.style.width = (frac * 100).toFixed(1) + '%';
    fill.className = frac >= 1 ? 'full' : frac >= 0.8 ? 'warn' : '';

    // Tiles
    const players = Object.entries(data.players);
    const sessions = Object.values(data.sessions);
    const totalSec = players.reduce((a, [, p]) => a + (p.totalSeconds || 0), 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaySessions = sessions.filter((s) => s.start >= today.getTime()).length;
    const lens = sessions.map((s) => s.seconds || (s.end && s.start ? (s.end - s.start) / 1000 : 0)).filter((x) => x > 0);
    const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const phones = players.filter(([, p]) => p.device && p.device.type !== 'computer').length;
    const fpsVals = players.map(([, p]) => p.lastFps).filter((f) => f > 0);
    const avgFps = fpsVals.length ? fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length : 0;
    const tiles = [
      ['Players ever', compact(players.length)],
      ['Total play time', dur(totalSec)],
      ['Sessions today', compact(todaySessions)],
      ['Average session', dur(avgLen)],
      ['On phones or tablets', players.length ? Math.round((phones / players.length) * 100) + '%' : '—'],
      ['Average frame rate', avgFps ? Math.round(avgFps) + ' fps' : '—']
    ];
    $('tiles').innerHTML = tiles.map(([l, v]) => `<div class="tile"><div class="tile-label">${l}</div><div class="tile-value">${v}</div></div>`).join('');

    // Live
    const now = Date.now();
    table($('live-table'),
      ['Callsign', 'Role', 'Playing', 'For', 'FPS', 'Score', 'Kills', 'Device', 'Graphics'],
      live.sort((a, b) => (a[1].startedAt || 0) - (b[1].startedAt || 0)).map(([, p]) => `<tr>
        <td><b>${esc(p.callsign)}</b></td><td>${esc(p.role)}</td>
        <td>${esc(MODES[p.mode] || p.mode)} · ${esc(p.map)}</td>
        <td class="num">${dur((now - (p.startedAt || now)) / 1000)}</td>
        <td class="num">${p.fps || '—'}</td><td class="num">${compact(p.score || 0)}</td><td class="num">${p.kills || 0}</td>
        <td>${dev(p.device)}</td><td>${esc(p.device && p.device.gpu)} <span class="muted">${esc(p.quality)}</span></td></tr>`),
      'Nobody is playing right now.');

    // Players
    const q = ($('player-search').value || '').toLowerCase();
    const prow = players
      .filter(([, p]) => !q || JSON.stringify([p.callsign, p.device]).toLowerCase().includes(q))
      .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
      .slice(0, 500)
      .map(([uid, p]) => `<tr>
        <td><b>${esc(p.callsign)}</b>${data.live[uid] ? ' <span class="dot" title="online now"></span>' : ''}</td>
        <td>${ago(p.firstSeen)}</td><td>${ago(p.lastSeen)}</td>
        <td class="num">${p.sessions || 0}</td><td class="num">${dur(p.totalSeconds)}</td>
        <td class="num">${compact(p.bestScore || 0)}</td><td>${esc(MODES[p.lastMode] || p.lastMode)}</td>
        <td>${dev(p.device)}</td><td>${esc(p.device && p.device.gpu)}</td>
        <td class="num">${p.lastFps || '—'}</td>
        <td class="muted small">${esc(p.device ? `${p.device.screen} · ${p.device.cores} cores · ${p.device.memoryGB || '?'} GB · ${p.device.language} · ${p.device.timezone}` : '')}</td></tr>`);
    table($('players-table'),
      ['Callsign', 'First seen', 'Last seen', 'Sessions', 'Total time', 'Best score', 'Last mode', 'Device', 'Graphics', 'FPS', 'Details'],
      prow, q ? 'No player matches.' : 'No one has played yet.');

    // Sessions
    table($('sessions-table'),
      ['Callsign', 'Started', 'Length', 'Playing', 'Score', 'Kills', 'FPS', 'Device'],
      sessions.sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, 200).map((s) => `<tr>
        <td><b>${esc(s.callsign)}</b></td><td>${when(s.start)}</td>
        <td class="num">${s.end ? dur((s.end - s.start) / 1000) : '<span class="live">live</span>'}</td>
        <td>${esc(MODES[s.mode] || s.mode)} · ${esc(s.map)}</td>
        <td class="num">${compact(s.score || 0)}</td><td class="num">${s.kills || 0}</td>
        <td class="num">${s.fps || '—'}</td><td>${dev(s.device)}</td></tr>`),
      'No sessions yet.');

    // Performance by GPU
    const byGpu = new Map();
    for (const [, p] of players) {
      if (!p.lastFps || !p.device) continue;
      const k = p.device.gpu || 'Unknown';
      const e = byGpu.get(k) || { n: 0, fps: 0 };
      e.n++; e.fps += p.lastFps;
      byGpu.set(k, e);
    }
    table($('gpu-table'), ['Graphics chip', 'Players', 'Average FPS'],
      [...byGpu].sort((a, b) => a[1].fps / a[1].n - b[1].fps / b[1].n).map(([k, e]) =>
        `<tr><td>${esc(k)}</td><td class="num">${e.n}</td><td class="num ${e.fps / e.n < 30 ? 'bad' : ''}">${Math.round(e.fps / e.n)}</td></tr>`),
      'No frame-rate reports yet.');

    // Staff
    if (creator) {
      const rows = Object.entries(data.users).sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0)).map(([uid, u]) => {
        const r = data.roles[uid] || '';
        return `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${ago(u.lastSeen)}</td>
          <td><select data-uid="${esc(uid)}">
            <option value="" ${r === '' ? 'selected' : ''}>No role</option>
            <option value="admin" ${r === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="creator" ${r === 'creator' ? 'selected' : ''}>Creator</option>
          </select></td></tr>`;
      });
      if (table($('staff-table'), ['Name', 'Google account', 'Last seen', 'Role'], rows, 'Nobody has signed in yet.'))
      for (const sel of $('staff-table').querySelectorAll('select')) {
        sel.onchange = async () => {
          const uid = sel.dataset.uid;
          if (uid === user.uid && sel.value !== 'creator' &&
              !confirm('Remove your own creator role? You will lose access to these controls.')) {
            sel.value = 'creator';
            return;
          }
          if (sel.value) await set(ref(db, 'roles/' + uid), sel.value);
          else await remove(ref(db, 'roles/' + uid));
        };
      }
    }

    // Saved models
    const models = [];
    for (const [map, list] of Object.entries(data.world)) {
      for (const [id, m] of Object.entries(list || {})) models.push({ map, id, ...m });
    }
    const redrawn = table($('models-table'), creator ? ['Map', 'Model', 'Placed by', 'When', ''] : ['Map', 'Model', 'Placed by', 'When'],
      models.sort((a, b) => (b.at || 0) - (a.at || 0)).map((m) => `<tr><td>${esc(m.map)}</td>
        <td>${/^https?:\/\//i.test(m.url || '') ? `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.name || 'model')}</a>` : esc(m.name || 'model')}</td>
        <td>${esc(m.by)}</td><td>${ago(m.at)}</td>
        ${creator ? `<td><button class="ghost" data-map="${esc(m.map)}" data-id="${esc(m.id)}">Remove</button></td>` : ''}</tr>`),
      'No models saved yet.');
    if (creator && redrawn) {
      for (const b of $('models-table').querySelectorAll('button[data-id]')) {
        b.onclick = () => remove(ref(db, `world/${b.dataset.map}/${b.dataset.id}`));
      }
    }
  }
  $('player-search').addEventListener('input', render);
  render();
}
