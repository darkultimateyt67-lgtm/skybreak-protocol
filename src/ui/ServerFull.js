/**
 * Shown on DEPLOY when every player slot is taken. Retries by itself, since
 * a slot frees the moment anyone closes the game.
 */
export function showServerFull(max, retry) {
  let el = document.getElementById('server-full');
  if (!el) {
    el = document.createElement('div');
    el.id = 'server-full';
    document.body.appendChild(el);
  }
  let left = 20;
  el.innerHTML = `
    <div class="sf-card">
      <div class="sf-title">SERVERS FULL</div>
      <p>All <b>${max}</b> player slots are taken right now.<br>A slot opens the moment someone leaves.</p>
      <p class="sf-count">Trying again in <b>${left}</b>s…</p>
      <div class="sf-row">
        <button class="btn-main small" data-a="retry">TRY NOW</button>
        <button class="btn-main small alt" data-a="back">BACK</button>
      </div>
    </div>`;
  el.classList.remove('hidden');
  const done = () => {
    clearInterval(timer);
    el.classList.add('hidden');
  };
  const timer = setInterval(() => {
    left--;
    const b = el.querySelector('.sf-count b');
    if (b) b.textContent = String(Math.max(0, left));
    if (left <= 0) { done(); retry(); }
  }, 1000);
  el.onclick = (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'retry') { done(); retry(); }
    if (a === 'back') done();
  };
}
