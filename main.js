// main.js — top-level app flow: splash -> auth -> lobby -> matchmaking ->
// battleground -> result. Talks to the REST auth endpoints directly and
// delegates all rendering/networking to game.js / multiplayer.js.

import * as ui from './ui.js';
import * as net from './multiplayer.js';
import * as game from './game.js';
import { WEAPONS, WEAPON_ORDER } from './weapon.js';

const state = {
  token: null,
  user: null,           // { username, email, level, coins, diamonds, rank }
  forgotEmail: null,
  careerStats: { kills: 0, deaths: 0, wins: 0, matches: 0 },
};

const TOKEN_KEY = 'bl4v4_token';
const USER_KEY = 'bl4v4_user';

async function api(path, body) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---------------------------------------------------------------------------
// Splash sequence
// ---------------------------------------------------------------------------
function runSplash() {
  const bar = document.getElementById('splash-bar');
  const status = document.getElementById('splash-status');
  const messages = ['INITIALIZING ARSENAL…', 'DEPLOYING TERRAIN…', 'CALIBRATING OPTICS…', 'LOADING SQUAD DATA…', 'READY.'];
  let pct = 0;
  const totalMs = 3600;
  const start = performance.now();

  function step(now) {
    pct = Math.min(100, ((now - start) / totalMs) * 100);
    bar.style.width = pct + '%';
    status.textContent = messages[Math.min(messages.length - 1, Math.floor((pct / 100) * messages.length))];
    if (pct < 100) {
      requestAnimationFrame(step);
    } else {
      setTimeout(afterSplash, 250);
    }
  }
  requestAnimationFrame(step);
}

function afterSplash() {
  const savedToken = localStorage.getItem(TOKEN_KEY);
  const savedUser = localStorage.getItem(USER_KEY);
  if (savedToken && savedUser) {
    state.token = savedToken;
    state.user = JSON.parse(savedUser);
    enterLobby();
  } else {
    ui.showScreen('screen-login');
  }
}

// ---------------------------------------------------------------------------
// Auth: login / register / forgot password
// ---------------------------------------------------------------------------
function wireAuth() {
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => ui.showScreen(btn.dataset.goto));
  });

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const data = await api('/login', { email, password });
      onAuthed(data);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('register-error');
    errEl.textContent = '';
    try {
      const username = document.getElementById('reg-username').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirmPassword = document.getElementById('reg-confirm').value;
      const data = await api('/register', { username, email, password, confirmPassword });
      onAuthed(data);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Forgot password — 3 steps
  document.getElementById('form-forgot-email').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('forgot-email-error');
    errEl.textContent = '';
    try {
      const email = document.getElementById('forgot-email').value.trim();
      const data = await api('/forgot-password', { email });
      state.forgotEmail = email;
      document.getElementById('forgot-otp-hint').textContent =
        data.devCode ? `Dev mode (no email service configured): your code is ${data.devCode}` : '';
      switchForgotStep('forgot-step-otp');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('form-forgot-otp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('forgot-otp-error');
    errEl.textContent = '';
    try {
      const code = document.getElementById('forgot-otp').value.trim();
      await api('/verify-otp', { email: state.forgotEmail, code });
      switchForgotStep('forgot-step-reset');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('form-forgot-reset').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('forgot-reset-error');
    errEl.textContent = '';
    try {
      const password = document.getElementById('forgot-new-password').value;
      await api('/reset-password', { email: state.forgotEmail, password });
      ui.toast('Password reset. Please sign in.');
      switchForgotStep('forgot-step-email');
      ui.showScreen('screen-login');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function switchForgotStep(activeId) {
  document.querySelectorAll('.forgot-step').forEach((el) => el.classList.toggle('hidden', el.id !== activeId));
}

function onAuthed(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem(TOKEN_KEY, state.token);
  localStorage.setItem(USER_KEY, JSON.stringify(state.user));
  enterLobby();
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  state.token = null;
  state.user = null;
  game.stopLobbyScene();
  ui.showScreen('screen-login');
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
function enterLobby() {
  document.getElementById('lobby-avatar-initial').textContent = state.user.username[0].toUpperCase();
  document.getElementById('lobby-username').textContent = state.user.username;
  document.getElementById('lobby-level').textContent = state.user.level;
  document.getElementById('lobby-rank').textContent = state.user.rank;
  document.getElementById('lobby-coins').textContent = state.user.coins;
  document.getElementById('lobby-diamonds').textContent = state.user.diamonds;

  ui.showScreen('screen-lobby');
  game.startLobbyScene();
  populateModals();
}

function populateModals() {
  const inv = document.getElementById('inventory-grid');
  inv.innerHTML = WEAPON_ORDER.map((id) => {
    const w = WEAPONS[id];
    return `<div class="weapon-card">
      <div class="wc-name">${w.name}</div>
      <div class="wc-class">${w.class}</div>
      <div class="stat-bar-row">DMG<div class="stat-track"><div class="stat-fill" style="width:${w.damage}%"></div></div></div>
      <div class="stat-bar-row">RANGE<div class="stat-track"><div class="stat-fill" style="width:${Math.min(100, w.range / 2)}%"></div></div></div>
    </div>`;
  }).join('');

  const shop = document.getElementById('shop-grid');
  const shopItems = [
    { name: 'Gold Camo Skin', desc: 'M416 cosmetic', price: 800, currency: 'coin' },
    { name: 'Battle Pass', desc: 'Season rewards track', price: 60, currency: 'diamond' },
    { name: 'Recon Drone Charm', desc: 'Weapon charm', price: 300, currency: 'coin' },
    { name: 'Elite Crate', desc: 'Random cosmetic', price: 25, currency: 'diamond' },
  ];
  shop.innerHTML = shopItems.map((it) => `
    <div class="shop-card">
      <div class="sc-name">${it.name}</div>
      <div class="sc-desc">${it.desc}</div>
      <div class="sc-price">${it.price} ${it.currency === 'coin' ? '🪙' : '💎'}</div>
    </div>`).join('');
  shop.querySelectorAll('.shop-card').forEach((card, i) => {
    card.addEventListener('click', () => ui.toast(`${shopItems[i].name} — coming soon`));
  });

  const lb = document.getElementById('leaderboard-list');
  const fakeBoard = [
    { name: 'Phantom_Six', score: 4820 }, { name: 'NightOwl', score: 4510 },
    { name: 'IronCobra', score: 4290 }, { name: state.user.username, score: 3120 },
    { name: 'DustyTrail', score: 2990 }, { name: 'ZeroPulse', score: 2740 },
  ].sort((a, b) => b.score - a.score);
  lb.innerHTML = fakeBoard.map((row, i) => `
    <div class="lb-row"><span class="lb-rank">${i + 1}</span><span class="lb-name">${row.name}</span><span class="lb-score">${row.score}</span></div>`).join('');

  renderProfile();
}

function renderProfile() {
  const el = document.getElementById('profile-stats');
  const cs = state.careerStats;
  const winRate = cs.matches ? Math.round((cs.wins / cs.matches) * 100) : 0;
  el.innerHTML = `
    <div class="pstat"><b>${cs.kills}</b><span>Total Kills</span></div>
    <div class="pstat"><b>${cs.deaths}</b><span>Total Deaths</span></div>
    <div class="pstat"><b>${cs.matches}</b><span>Matches Played</span></div>
    <div class="pstat"><b>${winRate}%</b><span>Win Rate</span></div>`;
}

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------
let mmUnsub = null;
let mmStartUnsub = null;

function startMatchmaking() {
  game.stopLobbyScene();
  ui.showScreen('screen-matchmaking');
  document.getElementById('mm-title').textContent = 'SEARCHING FOR PLAYERS';
  document.getElementById('mm-wait').textContent = '~8s';
  renderSlots(0);

  mmUnsub = net.on('matchmaking_status', (data) => {
    if (data.status === 'found_players') {
      document.getElementById('mm-title').textContent = 'PLAYERS FOUND';
      renderSlots(data.count);
    }
  });

  mmStartUnsub = net.on('match_start', (data) => {
    cleanupMatchmakingListeners();
    ui.showScreen('screen-game');
    game.startBattleground(data, { onMatchEnd: handleMatchEnd });
  });

  net.findMatch(state.user.username);
}

function renderSlots(filledCount) {
  const a = document.getElementById('mm-slots-a');
  const b = document.getElementById('mm-slots-b');
  a.innerHTML = ''; b.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const slotA = document.createElement('div');
    slotA.className = 'mm-slot' + (i < Math.ceil(filledCount / 2) ? ' filled' : '');
    slotA.textContent = i < Math.ceil(filledCount / 2) ? '●' : '';
    a.appendChild(slotA);
    const slotB = document.createElement('div');
    slotB.className = 'mm-slot' + (i < Math.floor(filledCount / 2) ? ' filled' : '');
    slotB.textContent = i < Math.floor(filledCount / 2) ? '●' : '';
    b.appendChild(slotB);
  }
}

function cleanupMatchmakingListeners() {
  if (mmUnsub) { mmUnsub(); mmUnsub = null; }
  if (mmStartUnsub) { mmStartUnsub(); mmStartUnsub = null; }
}

function cancelMatchmaking() {
  net.cancelSearch();
  cleanupMatchmakingListeners();
  ui.showScreen('screen-lobby');
  game.startLobbyScene();
}

// ---------------------------------------------------------------------------
// Result screen
// ---------------------------------------------------------------------------
function handleMatchEnd(data, stats, localTeam) {
  const won = data.winner === localTeam;
  const draw = data.winner === 'draw';
  const banner = document.getElementById('result-banner');
  banner.textContent = draw ? 'DRAW' : (won ? 'VICTORY' : 'DEFEAT');
  banner.classList.toggle('defeat', !won && !draw);

  document.getElementById('result-mvp').textContent = data.mvp ? `MVP: ${data.mvp.username} (${data.mvp.kills} kills)` : 'MVP: —';
  document.getElementById('rs-kills').textContent = stats.kills;
  document.getElementById('rs-deaths').textContent = stats.deaths;
  document.getElementById('rs-assists').textContent = stats.assists;
  const acc = stats.shotsFired ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
  document.getElementById('rs-accuracy').textContent = acc + '%';

  const xp = stats.kills * 50 + stats.assists * 20 + (won ? 300 : draw ? 150 : 100);
  const coins = stats.kills * 20 + (won ? 150 : draw ? 90 : 60);
  document.getElementById('rs-xp').textContent = xp;
  document.getElementById('rs-coins').textContent = coins;

  // Client-side career/wallet update (demo only — wire to a real backend write for production).
  state.careerStats.kills += stats.kills;
  state.careerStats.deaths += stats.deaths;
  state.careerStats.matches += 1;
  if (won) state.careerStats.wins += 1;
  state.user.coins += coins;
  localStorage.setItem(USER_KEY, JSON.stringify(state.user));
  document.getElementById('lobby-coins').textContent = state.user.coins;

  ui.showScreen('screen-result');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function wireLobbyAndResult() {
  ui.initModals();
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-start-match').addEventListener('click', startMatchmaking);
  document.getElementById('btn-cancel-search').addEventListener('click', cancelMatchmaking);
  document.getElementById('btn-play-again').addEventListener('click', startMatchmaking);
  document.getElementById('btn-return-lobby').addEventListener('click', () => { ui.showScreen('screen-lobby'); game.startLobbyScene(); });
}

window.addEventListener('DOMContentLoaded', () => {
  wireAuth();
  wireLobbyAndResult();
  game.initControlsOnce();
  net.connectSocket();
  runSplash();
});
