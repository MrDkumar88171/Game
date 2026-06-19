// game.js — orchestrates the two Three.js scenes (lobby preview + live
// battleground) and ties together map.js / player.js / weapon.js /
// camera.js / controls.js / multiplayer.js / ui.js.

import * as THREE from 'three';
import { buildBattleground, WORLD_HALF } from './map.js';
import { createCharacter } from './player.js';
import { WEAPONS, createTracerPool, createImpactPool } from './weapon.js';
import { ThirdPersonCamera } from './camera.js';
import * as controls from './controls.js';
import * as ui from './ui.js';
import * as net from './multiplayer.js';

const clock = new THREE.Clock();

// ---------------------------------------------------------------------------
// One-time input wiring (called once from main.js on app boot, NOT per match,
// so we never stack duplicate touch listeners across repeated matches).
// ---------------------------------------------------------------------------
let activeTPCamera = null;          // set while a battleground match is running
const lobbyOrbit = { yaw: 0.4, pitch: 0.22, distance: 4.4 };

export function initControlsOnce() {
  controls.initJoystick();
  controls.initActionButtons();

  controls.attachSwipeRotate(document.getElementById('game-canvas'), {
    onDrag: (dx, dy) => { if (activeTPCamera) activeTPCamera.addYawPitch(dx * 0.0045, dy * 0.0045); },
  });

  controls.attachSwipeRotate(document.getElementById('lobby-canvas'), {
    onDrag: (dx) => { lobbyOrbit.yaw += dx * 0.006; },
    onPinch: (delta) => { lobbyOrbit.distance = THREE.MathUtils.clamp(lobbyOrbit.distance - delta * 0.01, 2.4, 7); },
  });
}

function resizeRendererToCanvas(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// =============================================================================
// LOBBY PREVIEW SCENE
// =============================================================================
let lobby = null;

export function startLobbyScene() {
  if (lobby) return; // already running
  const canvas = document.getElementById('lobby-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14160f);
  scene.fog = new THREE.Fog(0x14160f, 6, 18);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  const hemi = new THREE.HemisphereLight(0x445533, 0x0c0e08, 0.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffdca8, 1.4);
  key.position.set(3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x2e6fd8, 0.5);
  rim.position.set(-4, 3, -3);
  scene.add(rim);

  // Ground pad + a few camp props for a "military camp" feel
  const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 32), new THREE.MeshStandardMaterial({ color: 0x33361f, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6e5a32, roughness: 0.9 });
  for (const [x, z, ry] of [[-2.4, -1, 0.3], [2.6, -0.6, -0.4], [-1.8, 1.8, 0.8]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), crateMat);
    c.position.set(x, 0.35, z); c.rotation.y = ry; c.castShadow = true; c.receiveShadow = true;
    scene.add(c);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0x7a4a1e }));
  barrel.position.set(2.2, 0.4, 1.6); barrel.castShadow = true;
  scene.add(barrel);

  const character = createCharacter('A', { isLocal: true });
  character.attachWeapon('m416');
  character.setAnim('idle');
  scene.add(character.root);

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    character.update(dt);

    camera.position.set(
      Math.sin(lobbyOrbit.yaw) * Math.cos(lobbyOrbit.pitch) * lobbyOrbit.distance,
      1.1 + Math.sin(lobbyOrbit.pitch) * lobbyOrbit.distance,
      Math.cos(lobbyOrbit.yaw) * Math.cos(lobbyOrbit.pitch) * lobbyOrbit.distance
    );
    camera.lookAt(0, 1.05, 0);

    resizeRendererToCanvas(renderer, camera, canvas);
    renderer.render(scene, camera);
    lobby.raf = requestAnimationFrame(frame);
  }

  lobby = { renderer, scene, camera, character, raf: requestAnimationFrame(frame) };
}

export function stopLobbyScene() {
  if (!lobby) return;
  cancelAnimationFrame(lobby.raf);
  lobby = null;
}

// =============================================================================
// BATTLEGROUND MATCH
// =============================================================================
let bg = null;

const tmpVec = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

export function startBattleground(matchData, { onMatchEnd } = {}) {
  stopBattleground();

  const canvas = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  const mapInfo = buildBattleground(scene, matchData.mapSeed);
  const tpCamera = new ThirdPersonCamera(camera, mapInfo.colliders);
  activeTPCamera = tpCamera;
  tpCamera.yaw = lobbyOrbit.yaw; // start facing roughly where the lobby preview left off

  const tracerPool = createTracerPool(scene);
  const impactPool = createImpactPool(scene);

  const localId = net.myId();
  const players = new Map();   // id -> entry
  const hitboxMeshes = [];

  let localTeam = 'A';

  matchData.players.forEach((p) => {
    const isLocal = p.id === localId;
    if (isLocal) localTeam = p.team;
    const char = createCharacter(p.team, { isLocal, isBot: p.isBot });
    char.attachWeapon(p.weapon || 'm416');
    char.root.position.set(p.position.x, p.position.y, p.position.z);
    char.root.rotation.y = p.rotation || 0;
    scene.add(char.root);

    let hitbox = null;
    if (!isLocal) {
      hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 8, 8),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitbox.position.set(0, 1.25, 0);
      hitbox.userData.playerId = p.id;
      char.root.add(hitbox);
      hitboxMeshes.push(hitbox);
    }

    players.set(p.id, {
      id: p.id, char, hitbox, team: p.team, isBot: !!p.isBot, username: p.username,
      isLocal, alive: true,
      targetPos: char.root.position.clone(), targetRotY: char.root.rotation.y,
    });
  });

  const localEntry = players.get(localId);

  // ---- Local player state -------------------------------------------------
  const move = { velocityY: 0, grounded: true, crouching: false, dead: false };
  const loadout = {
    primary: 'm416', secondary: 'deagle', current: 'primary',
    reloading: false, lastShotAt: 0,
    ammo: {
      m416: { mag: WEAPONS.m416.mag, reserve: WEAPONS.m416.reserve },
      deagle: { mag: WEAPONS.deagle.mag, reserve: WEAPONS.deagle.reserve },
    },
  };
  const stats = { kills: 0, deaths: 0, assists: 0, shotsFired: 0, shotsHit: 0 };

  ui.setHealth(100); ui.setArmor(100); ui.setScore(0, 0); ui.setTimer(matchData.duration);
  ui.setAmmo(loadout.ammo.m416.mag, loadout.ammo.m416.reserve, WEAPONS.m416.name);

  let netTimer = 0;

  // ---- Movement -------------------------------------------------------------
  function updateLocalPlayer(dt) {
    if (!localEntry) return;
    const root = localEntry.char.root;

    if (move.dead) { localEntry.char.update(dt); return; }

    const yaw = tpCamera.yaw;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    const ix = controls.InputState.moveX, iy = controls.InputState.moveY;
    const dir = forward.multiplyScalar(-iy).add(right.multiplyScalar(ix));
    const mag = Math.min(1, dir.length());
    if (mag > 0.001) dir.normalize();

    const crouching = controls.InputState.crouching;
    move.crouching = crouching;
    const baseSpeed = crouching ? 2.0 : (mag > 0.6 ? 7.4 : 4.2);
    const speed = baseSpeed * Math.max(0.3, mag);

    if (mag > 0.04) {
      root.position.addScaledVector(dir, speed * dt);
      root.rotation.y = controls.InputState.aiming
        ? Math.atan2(-forward.x, -forward.z) + Math.PI
        : Math.atan2(dir.x, dir.z);
    } else if (controls.InputState.aiming) {
      root.rotation.y = Math.atan2(-forward.x, -forward.z) + Math.PI;
    }

    const bound = WORLD_HALF - 3;
    root.position.x = THREE.MathUtils.clamp(root.position.x, -bound, bound);
    root.position.z = THREE.MathUtils.clamp(root.position.z, -bound, bound);

    // Jump / gravity (flat-ground simplification: ground plane = y0)
    if (controls.consumeJump() && move.grounded) {
      move.velocityY = 6.2;
      move.grounded = false;
    }
    move.velocityY -= 18 * dt;
    root.position.y += move.velocityY * dt;
    if (root.position.y <= 0) { root.position.y = 0; move.velocityY = 0; move.grounded = true; }

    const animState = !move.grounded ? 'jump' : (mag > 0.6 ? 'run' : (mag > 0.04 ? 'walk' : 'idle'));
    localEntry.char.setAnim(animState);
    localEntry.char.setAiming(controls.InputState.aiming);
    localEntry.char.update(dt);

    netTimer += dt;
    if (netTimer > 0.08) {
      netTimer = 0;
      net.sendPlayerUpdate(
        { x: root.position.x, y: root.position.y, z: root.position.z },
        root.rotation.y, animState
      );
    }
  }

  // ---- Weapon handling --------------------------------------------------
  function currentWeaponId() { return loadout[loadout.current]; }

  function fire() {
    const def = WEAPONS[currentWeaponId()];
    const ammo = loadout.ammo[currentWeaponId()];
    loadout.lastShotAt = performance.now();
    ammo.mag -= 1;
    stats.shotsFired += 1;
    localEntry.char.playRecoil();
    localEntry.char.flashMuzzle();
    net.sendShoot();

    localEntry.char.root.updateMatrixWorld(true);
    const origin = localEntry.char.getMuzzleWorldPosition(tmpVec.clone());
    let direction;
    if (controls.InputState.aiming) {
      camera.getWorldDirection(tmpDir);
      direction = tmpDir.clone();
    } else {
      const ry = localEntry.char.root.rotation.y;
      direction = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    }
    direction.normalize();

    const raycaster = new THREE.Raycaster(origin, direction, 0, def.range);
    const hits = raycaster.intersectObjects(hitboxMeshes, false)
      .filter((h) => players.get(h.object.userData.playerId)?.alive);

    if (hits.length) {
      const hit = hits[0];
      const targetId = hit.object.userData.playerId;
      net.reportHit(targetId);
      stats.shotsHit += 1;
      ui.showHitMarker();
      impactPool.burst(hit.point, direction.clone().negate());
      tracerPool.fire(origin, hit.point);
    } else {
      tracerPool.fire(origin, origin.clone().addScaledVector(direction, def.range));
    }

    ui.setAmmo(ammo.mag, ammo.reserve, def.name);
    if (ammo.mag <= 0) setTimeout(startReload, 250);
  }

  function startReload() {
    const id = currentWeaponId();
    const def = WEAPONS[id];
    const ammo = loadout.ammo[id];
    if (loadout.reloading || ammo.mag >= def.mag || ammo.reserve <= 0) return;
    loadout.reloading = true;
    ui.setReloading(true);
    localEntry.char.startReload(def.reloadMs);
    setTimeout(() => {
      const need = def.mag - ammo.mag;
      const take = Math.min(need, ammo.reserve);
      ammo.mag += take; ammo.reserve -= take;
      loadout.reloading = false;
      ui.setReloading(false);
      ui.setAmmo(ammo.mag, ammo.reserve, def.name);
    }, def.reloadMs);
  }

  function switchWeapon() {
    loadout.current = loadout.current === 'primary' ? 'secondary' : 'primary';
    const id = currentWeaponId();
    localEntry.char.attachWeapon(id);
    net.switchWeapon(id);
    const ammo = loadout.ammo[id];
    ui.setAmmo(ammo.mag, ammo.reserve, WEAPONS[id].name);
  }

  function throwGrenade() {
    ui.toast('Grenade thrown');
    const ry = localEntry.char.root.rotation.y;
    const dir = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    const landing = localEntry.char.root.position.clone().addScaledVector(dir, 10);
    setTimeout(() => {
      impactPool.burst(landing.clone().setY(0.3), new THREE.Vector3(0, 1, 0));
      impactPool.burst(landing.clone().setY(0.3), new THREE.Vector3(0, 1, 0));
      players.forEach((entry) => {
        if (entry.isLocal || !entry.alive || entry.team === localTeam) return;
        if (entry.char.root.position.distanceTo(landing) < 6) net.reportGrenadeHit(entry.id);
      });
    }, 900);
  }

  function handleWeaponInput(dt) {
    if (move.dead) return;
    if (controls.consumeWeaponSwitch()) switchWeapon();
    if (controls.consumeReload()) startReload();
    if (controls.consumeGrenade()) throwGrenade();
    if (controls.consumeMedkit()) net.useMedkit();

    const def = WEAPONS[currentWeaponId()];
    const ammo = loadout.ammo[currentWeaponId()];
    if (controls.InputState.firing && !loadout.reloading && ammo.mag > 0 &&
        performance.now() - loadout.lastShotAt >= def.fireRateMs) {
      fire();
    }
  }

  // ---- Remote player interpolation ------------------------------------
  function updateRemotePlayers(dt) {
    players.forEach((entry) => {
      if (entry.isLocal) return;
      const root = entry.char.root;
      const lerpFactor = Math.min(1, dt * 10);
      root.position.lerp(entry.targetPos, lerpFactor);
      root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, entry.targetRotY, lerpFactor);
      entry.char.update(dt);
    });
  }

  // ---- Networking event wiring -----------------------------------------
  const unsubs = [];
  unsubs.push(net.on('player_state', (data) => {
    if (data.id === localId) return;
    const entry = players.get(data.id);
    if (!entry) return;
    entry.targetPos.set(data.position.x, data.position.y, data.position.z);
    entry.targetRotY = data.rotation;
    entry.alive = data.alive;
    if (data.alive) entry.char.setAnim(data.animState);
  }));

  unsubs.push(net.on('player_weapon', (data) => {
    const entry = players.get(data.id);
    if (entry && !entry.isLocal) entry.char.attachWeapon(data.weapon);
  }));

  unsubs.push(net.on('player_damaged', (data) => {
    if (data.id === localId) {
      ui.setHealth(data.health);
      ui.setArmor(data.armor);
      ui.showDamageVignette();
    }
  }));

  unsubs.push(net.on('player_down', (data) => {
    const victim = players.get(data.id);
    const killer = players.get(data.killerId);
    addKillFeedSafe(killer, victim, data);
    ui.setScore(data.scoreA, data.scoreB);

    if (victim) { victim.alive = false; victim.char.playDeath(); }
    if (data.id === localId) {
      move.dead = true;
      stats.deaths += 1;
      ui.setHealth(0);
      ui.toast(`Eliminated by ${data.killerName}`);
    }
    if (data.killerId === localId) {
      stats.kills += 1;
      ui.showKillBanner(`ELIMINATED ${data.victimName.toUpperCase()}`);
    }
  }));

  unsubs.push(net.on('player_respawn', (data) => {
    const entry = players.get(data.id);
    if (!entry) return;
    entry.alive = true;
    entry.char.reset();
    entry.char.root.position.set(data.position.x, data.position.y, data.position.z);
    entry.targetPos.copy(entry.char.root.position);
    if (data.id === localId) {
      move.dead = false;
      ui.setHealth(100);
      ui.setArmor(100);
      ui.toast('Respawned');
    }
  }));

  unsubs.push(net.on('player_left', (data) => {
    const entry = players.get(data.id);
    if (!entry) return;
    scene.remove(entry.char.root);
    const idx = hitboxMeshes.indexOf(entry.hitbox);
    if (idx !== -1) hitboxMeshes.splice(idx, 1);
    players.delete(data.id);
  }));

  unsubs.push(net.on('remote_shot', (data) => {
    const entry = players.get(data.shooterId);
    if (!entry) return;
    entry.char.playRecoil();
    entry.char.flashMuzzle();
    const origin = entry.char.getMuzzleWorldPosition(new THREE.Vector3());
    const ry = entry.char.root.rotation.y;
    const dir = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    tracerPool.fire(origin, origin.clone().addScaledVector(dir, 25));
  }));

  unsubs.push(net.on('match_timer', (data) => {
    ui.setTimer(data.remaining);
    ui.setScore(data.scoreA, data.scoreB);
  }));

  unsubs.push(net.on('match_end', (data) => {
    if (onMatchEnd) onMatchEnd(data, stats, localTeam);
    stopBattleground();
  }));

  function addKillFeedSafe(killer, victim, data) {
    const killerName = killer ? killer.username : data.killerName;
    const victimName = victim ? victim.username : data.victimName;
    const killerTeam = killer ? killer.team : (data.killerId === localId ? localTeam : (localTeam === 'A' ? 'B' : 'A'));
    const victimTeam = victim ? victim.team : 'A';
    ui.addKillFeed(killerName, killerTeam, victimName, victimTeam, WEAPONS[data.weapon]?.name || 'Weapon');
  }

  // ---- Main loop -----------------------------------------------------------
  let raf = null;
  function tick() {
    const dt = Math.min(0.05, clock.getDelta());

    updateLocalPlayer(dt);
    handleWeaponInput(dt);
    updateRemotePlayers(dt);

    tpCamera.setAiming(controls.InputState.aiming);
    if (localEntry) tpCamera.update(localEntry.char.root, dt);

    tracerPool.update(dt);
    impactPool.update(dt);

    resizeRendererToCanvas(renderer, camera, canvas);
    renderer.render(scene, camera);

    if (localEntry) {
      const others = [...players.values()].filter((p) => !p.isLocal).map((p) => ({
        position: p.char.root.position, team: p.team, alive: p.alive,
      }));
      ui.drawMinimap(WORLD_HALF, { position: localEntry.char.root.position, rotation: localEntry.char.root.rotation.y }, others);
    }

    raf = requestAnimationFrame(tick);
  }
  clock.getDelta();
  raf = requestAnimationFrame(tick);

  bg = { renderer, scene, raf, unsubs };
}

export function stopBattleground() {
  if (!bg) { activeTPCamera = null; return; }
  cancelAnimationFrame(bg.raf);
  bg.unsubs.forEach((u) => u());
  activeTPCamera = null;
  bg = null;
}
