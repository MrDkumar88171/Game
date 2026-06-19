/**
 * Battle Legends 4v4 - Server
 * Express serves the client; Socket.io drives matchmaking + real-time sync.
 *
 * AUTH NOTE: Accounts and OTPs live in-memory (Map) for this demo so it runs
 * with zero external services. Swap `users`/`otpStore` for a real DB and wire
 * `sendOtpEmail()` to a provider (e.g. nodemailer) for production. The OTP is
 * logged to the server console and echoed in the dev response so you can test
 * the flow without an email account.
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// In-memory "database"
// ---------------------------------------------------------------------------
const users = new Map();      // email -> user record
const sessions = new Map();   // token -> email
const otpStore = new Map();   // email -> { code, expiresAt }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash));
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function publicUser(u) {
  return {
    username: u.username,
    email: u.email,
    level: u.level,
    coins: u.coins,
    diamonds: u.diamonds,
    rank: u.rank,
  };
}

// ---------------------------------------------------------------------------
// Auth REST API
// ---------------------------------------------------------------------------
app.post('/api/register', (req, res) => {
  const { username, email, password, confirmPassword } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (users.has(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  const { hash, salt } = hashPassword(password);
  const user = {
    username, email, passwordHash: hash, salt,
    level: 1, coins: 500, diamonds: 20, rank: 'Bronze IV',
    createdAt: Date.now(),
  };
  users.set(email, user);
  const token = makeToken();
  sessions.set(token, email);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = makeToken();
  sessions.set(token, email);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!users.has(email)) {
    return res.status(404).json({ error: 'No account found with this email.' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(email, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  console.log(`[OTP] ${email} -> ${code} (valid 5 min)`);
  // devCode is only returned because no email provider is configured in this demo.
  res.json({ message: 'OTP sent to your email.', devCode: code });
});

app.post('/api/verify-otp', (req, res) => {
  const { email, code } = req.body || {};
  const entry = otpStore.get(email);
  if (!entry || entry.code !== code || Date.now() > entry.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }
  entry.verified = true;
  res.json({ message: 'Code verified.' });
});

app.post('/api/reset-password', (req, res) => {
  const { email, password } = req.body || {};
  const entry = otpStore.get(email);
  if (!entry || !entry.verified) {
    return res.status(400).json({ error: 'Please verify your OTP first.' });
  }
  const user = users.get(email);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  const { hash, salt } = hashPassword(password);
  user.passwordHash = hash;
  user.salt = salt;
  otpStore.delete(email);
  res.json({ message: 'Password reset successfully.' });
});

// ---------------------------------------------------------------------------
// Match constants
// ---------------------------------------------------------------------------
const TEAM_SIZE = 4;
const MATCH_DURATION_S = 480;     // 8 minute matches
const BOT_FILL_DELAY_MS = 8000;   // wait this long for real players before filling with bots
const WORLD_HALF = 95;            // playable bounds (matches map.js terrain size)
const WEAPON_STATS = {
  m416:   { name: 'M416',         class: 'AR',      damage: 24, fireRate: 100, mag: 30, range: 80 },
  akstyle:{ name: 'AK Style',     class: 'AR',      damage: 29, fireRate: 120, mag: 30, range: 75 },
  scar:   { name: 'SCAR Style',   class: 'AR',      damage: 26, fireRate: 105, mag: 28, range: 80 },
  ump:    { name: 'UMP Style',    class: 'SMG',      damage: 18, fireRate: 75,  mag: 35, range: 40 },
  vector: { name: 'Vector Style', class: 'SMG',      damage: 16, fireRate: 55,  mag: 33, range: 35 },
  awm:    { name: 'AWM Style',    class: 'Sniper',   damage: 95, fireRate: 1500, mag: 5,  range: 200 },
  shotgun:{ name: 'Auto Shotgun', class: 'Shotgun',  damage: 70, fireRate: 650, mag: 8,  range: 15 },
  deagle: { name: 'Desert Eagle', class: 'Pistol',   damage: 35, fireRate: 280, mag: 7,  range: 30 },
};

const queue = [];        // [{socketId, username}]
const rooms = new Map(); // roomId -> room state
let roomCounter = 1;

function randomSpawn(team) {
  // Team A spawns south side, Team B spawns north side
  const x = (Math.random() - 0.5) * 40;
  const z = team === 'A' ? WORLD_HALF - 15 + Math.random() * 8 : -(WORLD_HALF - 15) - Math.random() * 8;
  return { x, y: 0, z };
}

function createBot(team, idx) {
  const id = `bot_${team}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
  const names = ['Viper', 'Reaper', 'Ghost', 'Falcon', 'Nomad', 'Raptor', 'Specter', 'Wolf'];
  return {
    id, username: `${names[Math.floor(Math.random() * names.length)]}-${id.slice(-3)}`,
    isBot: true, team,
    position: randomSpawn(team), rotation: 0,
    health: 100, armor: 100, alive: true,
    kills: 0, deaths: 0, assists: 0,
    weapon: 'm416', animState: 'idle',
    nextActionAt: 0,
  };
}

function broadcastRoom(room, event, data) {
  io.to(room.id).emit(event, data);
}

function startBotLoop(room) {
  room.botInterval = setInterval(() => {
    if (room.status !== 'active') return;
    const bots = [...room.players.values()].filter(p => p.isBot && p.alive);
    const targets = [...room.players.values()];
    const now = Date.now();
    for (const bot of bots) {
      if (now < bot.nextActionAt) continue;
      bot.nextActionAt = now + 700 + Math.random() * 900;
      // Wander
      bot.position.x += (Math.random() - 0.5) * 6;
      bot.position.z += (Math.random() - 0.5) * 6;
      bot.position.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, bot.position.x));
      bot.position.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, bot.position.z));
      bot.rotation = Math.random() * Math.PI * 2;
      bot.animState = 'run';

      // Occasionally engage a random living enemy "in range"
      const enemies = targets.filter(p => p.team !== bot.team && p.alive);
      if (enemies.length && Math.random() < 0.4) {
        const enemy = enemies[Math.floor(Math.random() * enemies.length)];
        const dx = enemy.position.x - bot.position.x;
        const dz = enemy.position.z - bot.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const stats = WEAPON_STATS[bot.weapon];
        if (dist < stats.range) {
          const hitChance = 0.45;
          if (Math.random() < hitChance) {
            applyDamage(room, enemy, Math.round(stats.damage * (0.6 + Math.random() * 0.5)), bot);
          }
          broadcastRoom(room, 'remote_shot', { shooterId: bot.id, weapon: bot.weapon });
        }
      }
      broadcastRoom(room, 'player_state', publicPlayer(bot));
    }
  }, 800);
}

function applyDamage(room, victim, amount, attacker) {
  if (!victim.alive) return;
  let dmg = amount;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, dmg * 0.5);
    victim.armor -= absorbed;
    dmg -= absorbed;
  }
  victim.health = Math.max(0, victim.health - dmg);
  broadcastRoom(room, 'player_damaged', { id: victim.id, health: victim.health, armor: victim.armor, byId: attacker.id });

  if (victim.health <= 0) {
    victim.alive = false;
    victim.deaths += 1;
    attacker.kills += 1;
    if (victim.team === 'A') room.scoreB += 1; else room.scoreA += 1;
    broadcastRoom(room, 'player_down', {
      id: victim.id, killerId: attacker.id,
      killerName: attacker.username, victimName: victim.username,
      weapon: attacker.weapon,
      scoreA: room.scoreA, scoreB: room.scoreB,
    });
    setTimeout(() => respawn(room, victim), 4000);
  }
}

function respawn(room, p) {
  if (room.status !== 'active') return;
  p.health = 100;
  p.armor = 100;
  p.alive = true;
  p.position = randomSpawn(p.team);
  broadcastRoom(room, 'player_respawn', publicPlayer(p));
}

function publicPlayer(p) {
  return {
    id: p.id, username: p.username, team: p.team, isBot: !!p.isBot,
    position: p.position, rotation: p.rotation, health: p.health, armor: p.armor,
    alive: p.alive, weapon: p.weapon, animState: p.animState,
    kills: p.kills, deaths: p.deaths, assists: p.assists,
  };
}

function endMatch(room) {
  if (room.status === 'ended') return;
  room.status = 'ended';
  clearInterval(room.botInterval);
  clearInterval(room.timerInterval);
  const players = [...room.players.values()];
  const winner = room.scoreA === room.scoreB ? 'draw' : (room.scoreA > room.scoreB ? 'A' : 'B');
  const mvp = players.reduce((a, b) => (b.kills > (a?.kills ?? -1) ? b : a), null);
  broadcastRoom(room, 'match_end', {
    winner, scoreA: room.scoreA, scoreB: room.scoreB,
    mvp: mvp ? { username: mvp.username, kills: mvp.kills } : null,
    players: players.filter(p => !p.isBot).map(p => ({
      id: p.id, username: p.username, team: p.team,
      kills: p.kills, deaths: p.deaths, assists: p.assists,
    })),
  });
  setTimeout(() => rooms.delete(room.id), 30000);
}

function startMatch(room) {
  room.status = 'active';
  room.scoreA = 0;
  room.scoreB = 0;
  room.endsAt = Date.now() + MATCH_DURATION_S * 1000;
  broadcastRoom(room, 'match_start', {
    roomId: room.id,
    mapSeed: room.mapSeed,
    players: [...room.players.values()].map(publicPlayer),
    duration: MATCH_DURATION_S,
  });
  room.timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.round((room.endsAt - Date.now()) / 1000));
    broadcastRoom(room, 'match_timer', { remaining, scoreA: room.scoreA, scoreB: room.scoreB });
    if (remaining <= 0) endMatch(room);
  }, 1000);
  startBotLoop(room);
}

function tryFormMatch() {
  if (queue.length === 0) return;
  // Pull up to 8 from queue immediately if available; otherwise create a
  // partial room and fill with bots after BOT_FILL_DELAY_MS.
  const grouped = queue.splice(0, Math.min(8, queue.length));
  const roomId = `room_${roomCounter++}`;
  const room = {
    id: roomId, players: new Map(), scoreA: 0, scoreB: 0,
    status: 'forming', mapSeed: Math.floor(Math.random() * 1e6),
  };
  rooms.set(roomId, room);

  grouped.forEach((entry, i) => {
    const team = i % 2 === 0 ? 'A' : 'B';
    const player = {
      id: entry.socketId, username: entry.username, isBot: false, team,
      position: randomSpawn(team), rotation: 0,
      health: 100, armor: 100, alive: true,
      kills: 0, deaths: 0, assists: 0, weapon: 'm416', animState: 'idle',
    };
    room.players.set(entry.socketId, player);
    const sock = io.sockets.sockets.get(entry.socketId);
    if (sock) sock.join(roomId);
  });

  broadcastRoom(room, 'matchmaking_status', { status: 'found_players', count: grouped.length });

  setTimeout(() => {
    if (room.status !== 'forming') return;
    // Fill remaining slots with bots split evenly across teams
    let teamACount = [...room.players.values()].filter(p => p.team === 'A').length;
    let teamBCount = [...room.players.values()].filter(p => p.team === 'B').length;
    let botIdx = 0;
    while (teamACount < TEAM_SIZE || teamBCount < TEAM_SIZE) {
      const team = teamACount <= teamBCount ? 'A' : 'B';
      const bot = createBot(team, botIdx++);
      room.players.set(bot.id, bot);
      if (team === 'A') teamACount++; else teamBCount++;
    }
    startMatch(room);
  }, BOT_FILL_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Socket.io realtime
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.roomId = null;

  socket.on('find_match', ({ username }) => {
    queue.push({ socketId: socket.id, username: username || `Soldier${Math.floor(Math.random() * 9999)}` });
    socket.emit('matchmaking_status', { status: 'searching', queuePosition: queue.length });
    tryFormMatch();
  });

  socket.on('cancel_search', () => {
    const idx = queue.findIndex(q => q.socketId === socket.id);
    if (idx !== -1) queue.splice(idx, 1);
  });

  socket.on('player_update', (data) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.status !== 'active') return;
    const p = room.players.get(socket.id);
    if (!p.alive) return;
    p.position = data.position;
    p.rotation = data.rotation;
    p.animState = data.animState;
    socket.data.roomId = room.id;
    socket.to(room.id).emit('player_state', publicPlayer(p));
  });

  socket.on('weapon_switch', ({ weapon }) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p && WEAPON_STATS[weapon]) {
      p.weapon = weapon;
      socket.to(room.id).emit('player_weapon', { id: p.id, weapon });
    }
  });

  socket.on('shoot', ({ originId }) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.status !== 'active') return;
    const p = room.players.get(socket.id);
    if (!p || !p.alive) return;
    socket.to(room.id).emit('remote_shot', { shooterId: p.id, weapon: p.weapon });
  });

  // Client-authoritative hit report, server validates + applies damage so all
  // clients agree on health/kills.
  socket.on('report_hit', ({ targetId }) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.status !== 'active') return;
    const attacker = room.players.get(socket.id);
    const victim = room.players.get(targetId);
    if (!attacker || !victim || !attacker.alive || victim.team === attacker.team) return;
    const stats = WEAPON_STATS[attacker.weapon] || WEAPON_STATS.m416;
    applyDamage(room, victim, stats.damage, attacker);
  });

  // Grenade damage is resolved client-side for the blast radius (cosmetic
  // explosion + hit detection against local hitboxes) then reported here so
  // the server stays authoritative over health/kills, same as bullet hits.
  socket.on('report_grenade_hit', ({ targetId }) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.status !== 'active') return;
    const attacker = room.players.get(socket.id);
    const victim = room.players.get(targetId);
    if (!attacker || !victim || !attacker.alive || victim.team === attacker.team) return;
    applyDamage(room, victim, 60, attacker);
  });

  socket.on('use_medkit', () => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p && p.alive) {
      p.health = Math.min(100, p.health + 50);
      broadcastRoom(room, 'player_state', publicPlayer(p));
    }
  });

  socket.on('disconnect', () => {
    const qIdx = queue.findIndex(q => q.socketId === socket.id);
    if (qIdx !== -1) queue.splice(qIdx, 1);
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (room) {
      room.players.delete(socket.id);
      broadcastRoom(room, 'player_left', { id: socket.id });
      const humans = [...room.players.values()].filter(p => !p.isBot);
      if (humans.length === 0) endMatch(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Battle Legends 4v4 server running on http://localhost:${PORT}`);
});
