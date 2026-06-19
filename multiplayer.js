// multiplayer.js — thin wrapper around the Socket.io client.
// Keeps the rest of the app decoupled from raw socket event names.

let socket = null;
const listeners = new Map(); // event -> Set<callback>

export function connectSocket() {
  if (socket && socket.connected) return socket;
  // `io` is provided globally by /socket.io/socket.io.js (loaded in index.html)
  socket = window.io();
  socket.on('connect', () => emitLocal('connected', { id: socket.id }));
  socket.on('disconnect', () => emitLocal('disconnected', {}));

  [
    'matchmaking_status', 'match_start', 'match_timer', 'player_state',
    'player_damaged', 'player_down', 'player_respawn', 'player_left',
    'remote_shot', 'match_end', 'player_weapon',
  ].forEach((evt) => socket.on(evt, (data) => emitLocal(evt, data)));

  return socket;
}

function emitLocal(event, data) {
  (listeners.get(event) || []).forEach((cb) => cb(data));
}

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event).delete(cb);
}

export function findMatch(username) {
  connectSocket();
  socket.emit('find_match', { username });
}

export function cancelSearch() {
  if (socket) socket.emit('cancel_search');
}

export function sendPlayerUpdate(position, rotation, animState) {
  if (socket && socket.connected) socket.emit('player_update', { position, rotation, animState });
}

export function sendShoot() {
  if (socket && socket.connected) socket.emit('shoot', {});
}

export function reportHit(targetId) {
  if (socket && socket.connected) socket.emit('report_hit', { targetId });
}

export function reportGrenadeHit(targetId) {
  if (socket && socket.connected) socket.emit('report_grenade_hit', { targetId });
}


export function switchWeapon(weapon) {
  if (socket && socket.connected) socket.emit('weapon_switch', { weapon });
}

export function useMedkit() {
  if (socket && socket.connected) socket.emit('use_medkit');
}

export function myId() {
  return socket ? socket.id : null;
}
