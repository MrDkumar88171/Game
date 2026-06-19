// ui.js — DOM-facing helpers shared by main.js and game.js
// Keeps all direct DOM manipulation in one place so the gameplay/network
// modules stay framework-agnostic.

const screens = document.querySelectorAll('.screen');

export function showScreen(id) {
  screens.forEach((s) => s.classList.toggle('active', s.id === id));
}

let toastTimer = null;
export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// Lobby modals
// ---------------------------------------------------------------------------
export function initModals() {
  const backdrop = document.getElementById('modal-backdrop');
  document.querySelectorAll('.nav-btn[data-modal]').forEach((btn) => {
    btn.addEventListener('click', () => openModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', closeAllModals);
  });
  backdrop.addEventListener('click', closeAllModals);
}

export function openModal(id) {
  document.getElementById('modal-backdrop').classList.add('show');
  document.getElementById(id).classList.add('show');
}

export function closeAllModals() {
  document.getElementById('modal-backdrop').classList.remove('show');
  document.querySelectorAll('.modal').forEach((m) => m.classList.remove('show'));
}

// ---------------------------------------------------------------------------
// HUD: health / armor / ammo
// ---------------------------------------------------------------------------
export function setHealth(hp) {
  const pct = Math.max(0, Math.min(100, hp));
  document.getElementById('hp-fill').style.width = pct + '%';
  document.getElementById('hp-val').textContent = Math.round(pct);
}

export function setArmor(ar) {
  const pct = Math.max(0, Math.min(100, ar));
  document.getElementById('ar-fill').style.width = pct + '%';
  document.getElementById('ar-val').textContent = Math.round(pct);
}

export function setAmmo(current, reserve, weaponName) {
  document.getElementById('ammo-current').textContent = current;
  document.getElementById('ammo-reserve').textContent = reserve;
  if (weaponName) document.getElementById('weapon-name-display').textContent = weaponName;
}

export function setReloading(active) {
  document.getElementById('reload-spinner').classList.toggle('hidden', !active);
}

export function setScore(a, b) {
  document.getElementById('score-a').textContent = a;
  document.getElementById('score-b').textContent = b;
}

export function setTimer(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  document.getElementById('match-timer').textContent = `${m}:${s}`;
}

let hitMarkerTimer = null;
export function showHitMarker() {
  const el = document.getElementById('hit-marker');
  el.classList.remove('show');
  void el.offsetWidth; // restart animation
  el.classList.add('show');
  clearTimeout(hitMarkerTimer);
  hitMarkerTimer = setTimeout(() => el.classList.remove('show'), 260);
}

let vignetteTimer = null;
export function showDamageVignette() {
  const el = document.getElementById('damage-vignette');
  el.classList.add('show');
  clearTimeout(vignetteTimer);
  vignetteTimer = setTimeout(() => el.classList.remove('show'), 350);
}

let bannerTimer = null;
export function showKillBanner(text) {
  const el = document.getElementById('kill-banner');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

export function addKillFeed(killerName, killerTeam, victimName, victimTeam, weaponName) {
  const feed = document.getElementById('kill-feed');
  const item = document.createElement('div');
  item.className = 'kill-feed-item';
  item.innerHTML = `<span class="kf-killer ${killerTeam.toLowerCase()}">${escapeHtml(killerName)}</span><span style="color:var(--text-faint)">${escapeHtml(weaponName)}</span><span class="kf-victim ${victimTeam.toLowerCase()}">${escapeHtml(victimName)}</span>`;
  feed.appendChild(item);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
  setTimeout(() => item.remove(), 6000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Minimap — top-down dots for self / allies / enemies on a fixed-size canvas
// ---------------------------------------------------------------------------
const mmCanvas = document.getElementById('minimap-canvas');
const mmCtx = mmCanvas ? mmCanvas.getContext('2d') : null;

export function drawMinimap(worldHalf, self, others) {
  if (!mmCtx) return;
  const W = mmCanvas.width, H = mmCanvas.height;
  mmCtx.clearRect(0, 0, W, H);
  mmCtx.fillStyle = 'rgba(20,26,18,0.85)';
  mmCtx.fillRect(0, 0, W, H);

  const toMap = (x, z) => [
    ((x + worldHalf) / (worldHalf * 2)) * W,
    ((z + worldHalf) / (worldHalf * 2)) * H,
  ];

  // grid
  mmCtx.strokeStyle = 'rgba(201,162,39,0.12)';
  for (let i = 1; i < 4; i++) {
    const p = (W / 4) * i;
    mmCtx.beginPath(); mmCtx.moveTo(p, 0); mmCtx.lineTo(p, H); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(0, p); mmCtx.lineTo(W, p); mmCtx.stroke();
  }

  others.forEach((p) => {
    if (!p.alive) return;
    const [x, y] = toMap(p.position.x, p.position.z);
    mmCtx.fillStyle = p.team === 'A' ? '#2e86ff' : '#ff3b30';
    mmCtx.beginPath(); mmCtx.arc(x, y, 3.2, 0, Math.PI * 2); mmCtx.fill();
  });

  if (self) {
    const [x, y] = toMap(self.position.x, self.position.z);
    mmCtx.save();
    mmCtx.translate(x, y);
    mmCtx.rotate(self.rotation);
    mmCtx.fillStyle = '#e8c349';
    mmCtx.beginPath();
    mmCtx.moveTo(0, -6); mmCtx.lineTo(4, 5); mmCtx.lineTo(-4, 5);
    mmCtx.closePath(); mmCtx.fill();
    mmCtx.restore();
  }
}
