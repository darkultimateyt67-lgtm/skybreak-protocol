/**
 * Minimap — top-right tactical view, rotating with the player.
 *
 * Marks: SENTINELs (red — within 30 m, or all of them while a recon pulse
 * is live), survivors (cyan), the active quest objective (gold diamond),
 * jump pads (orange) and the player arrow at the center.
 */
export class Minimap {
  constructor(game) {
    this.game = game;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.size = this.canvas.width;   // square canvas
    this.range = 52;                  // meters shown edge-to-edge / 2
  }

  update() {
    const game = this.game;
    const ctx = this.ctx;
    const s = this.size;
    const c = s / 2;
    const player = game.player;
    const yaw = player.yaw;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const scale = c / this.range;
    const now = performance.now() * 0.001;
    const revealed = (game.revealUntil || 0) > now;

    ctx.clearRect(0, 0, s, s);

    // Background + subtle rings.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(6, 12, 18, 0.78)';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(55, 230, 255, 0.12)';
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(c, c, c * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // World → screen: rotate around the player so "up" is where you look.
    const toScreen = (wx, wz) => {
      const dx = wx - player.position.x;
      const dz = wz - player.position.z;
      return [c + (dx * cosY - dz * sinY) * scale, c + (dx * sinY + dz * cosY) * scale];
    };

    // Jump pads.
    ctx.fillStyle = 'rgba(255, 179, 71, 0.9)';
    for (const pad of game.world.jumpPads) {
      const [x, y] = toScreen(pad.pos.x, pad.pos.z);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Unclaimed salvage caches.
    ctx.fillStyle = 'rgba(255, 210, 74, 0.85)';
    for (const s of game.world.salvagePoints) {
      if (s.taken) continue;
      const [x, y] = toScreen(s.pos.x, s.pos.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // Survivors.
    ctx.fillStyle = '#37e6ff';
    for (const npc of game.quests.npcs) {
      const [x, y] = toScreen(npc.position.x, npc.position.z);
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }

    // SENTINELs: nearby always; all of them while a recon pulse is live.
    for (const e of game.enemies.list) {
      if (!e.alive) continue;
      const dx = e.position.x - player.position.x;
      const dz = e.position.z - player.position.z;
      const near = dx * dx + dz * dz < 900; // 30 m
      if (!near && !revealed) continue;
      const [x, y] = toScreen(e.position.x, e.position.z);
      ctx.fillStyle = revealed && !near ? '#ff8873' : '#ff3b4d';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Quest objective: gold diamond, clamped to the rim when off-range.
    const marker = game.quests.markerPos;
    if (marker) {
      let [x, y] = toScreen(marker.x, marker.z);
      const ox = x - c, oy = y - c;
      const d = Math.hypot(ox, oy);
      if (d > c - 8) {
        x = c + (ox / d) * (c - 8);
        y = c + (oy / d) * (c - 8);
      }
      ctx.fillStyle = '#ffd24a';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
      ctx.restore();
    }

    // Player arrow, always centered pointing up.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c, c - 6);
    ctx.lineTo(c - 4.5, c + 5);
    ctx.lineTo(c, c + 2.5);
    ctx.lineTo(c + 4.5, c + 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Rim.
    ctx.strokeStyle = revealed ? 'rgba(55, 230, 255, 0.9)' : 'rgba(55, 230, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
