// player.js — builds a stylized rigged humanoid from Three.js primitives and
// animates it procedurally (no external character/animation assets needed).
// Each limb is a small hierarchy of pivot Groups so rotating a pivot bends
// the limb at the right joint, the same way a real skeletal rig would.

import * as THREE from 'three';
import { buildWeaponMesh, flashMuzzle } from './weapon.js';

const TEAM_COLORS = { A: 0x2e6fd8, B: 0xc23a30 };
const SKIN = 0xd8a878;

function segment(length, radiusTop, radiusBottom, color, dir = -1) {
  const pivot = new THREE.Group();
  const geo = new THREE.CapsuleGeometry((radiusTop + radiusBottom) / 2, length * 0.6, 4, 8);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 }));
  mesh.position.y = dir * length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  const end = new THREE.Group();
  end.position.y = dir * length;
  pivot.add(end);
  return { pivot, end, mesh };
}

export function createCharacter(team = 'A', { isLocal = false, isBot = false } = {}) {
  const armor = TEAM_COLORS[team] || TEAM_COLORS.A;
  const pants = 0x2b2e26;

  const root = new THREE.Group();
  root.name = isLocal ? 'localPlayer' : 'player';

  // Hips is the master pivot; world Y of root + hipsPivot.position.y = standing hip height.
  const hipHeight = 0.86;
  const hipsPivot = new THREE.Group();
  hipsPivot.position.y = hipHeight;
  root.add(hipsPivot);

  const hipsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.2), new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 }));
  hipsMesh.castShadow = true;
  hipsPivot.add(hipsMesh);

  // Torso / spine
  const torso = segment(0.46, 0.17, 0.15, armor, 1);
  hipsPivot.add(torso.pivot);

  // Head
  const headPivot = new THREE.Group();
  headPivot.position.copy(torso.end.position);
  torso.pivot.add(headPivot);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 }));
  head.position.y = 0.13;
  head.castShadow = true;
  headPivot.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x2c2f27, roughness: 0.5 }));
  helmet.position.y = 0.16;
  headPivot.add(helmet);

  // Shoulders sit near the top of the torso
  const shoulderY = 0.38;

  function buildArm(side) {
    const sign = side === 'L' ? 1 : -1;
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(sign * 0.22, shoulderY, 0);
    torso.pivot.add(shoulderPivot);
    const upper = segment(0.27, 0.06, 0.055, armor, -1);
    shoulderPivot.add(upper.pivot);
    const lower = segment(0.25, 0.055, 0.05, SKIN, -1);
    upper.end.add(lower.pivot);
    const hand = new THREE.Group();
    hand.position.y = -0.25;
    lower.end.add(hand);
    return { shoulderPivot, upper, lower, hand };
  }

  function buildLeg(side) {
    const sign = side === 'L' ? 1 : -1;
    const hipPivot = new THREE.Group();
    hipPivot.position.set(sign * 0.1, -0.04, 0);
    hipsPivot.add(hipPivot);
    const upper = segment(0.42, 0.09, 0.08, pants, -1);
    hipPivot.add(upper.pivot);
    const lower = segment(0.4, 0.075, 0.06, 0x1c1e19, -1);
    upper.end.add(lower.pivot);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
    foot.position.set(0, -0.03, 0.05);
    foot.castShadow = true;
    lower.end.add(foot);
    return { hipPivot, upper, lower };
  }

  const armL = buildArm('L');
  const armR = buildArm('R');
  const legL = buildLeg('L');
  const legR = buildLeg('R');

  // Weapon socket on the right hand
  let weaponGroup = null;
  function attachWeapon(weaponId) {
    if (weaponGroup) armR.hand.remove(weaponGroup);
    weaponGroup = buildWeaponMesh(weaponId);
    weaponGroup.rotation.set(0, Math.PI / 2, 0);
    weaponGroup.position.set(0, -0.02, 0.06);
    armR.hand.add(weaponGroup);
    return weaponGroup;
  }

  // Simple team-tinted name marker above remote players (skipped for local).
  let nameSprite = null;

  // -------------------------------------------------------------------
  // Animation state machine
  // -------------------------------------------------------------------
  const state = {
    clock: Math.random() * 10,
    anim: 'idle',          // idle | walk | run | jump | death
    aiming: false,
    recoilT: 0,
    reloadT: 0,
    reloadDuration: 0,
    deathT: 0,
    dead: false,
  };

  function setAnim(name) { if (!state.dead) state.anim = name; }
  function setAiming(v) { state.aiming = v; }

  function playRecoil() { state.recoilT = 1; }

  function startReload(durationMs) {
    state.reloadT = 0.0001;
    state.reloadDuration = durationMs / 1000;
  }

  function playDeath() {
    state.dead = true;
    state.anim = 'death';
    state.deathT = 0;
  }

  function reset() {
    state.dead = false;
    state.anim = 'idle';
    state.deathT = 0;
    root.rotation.set(0, root.rotation.y, 0);
    root.position.y = 0;
  }

  function update(dt) {
    state.clock += dt;
    const t = state.clock;

    if (state.dead) {
      state.deathT = Math.min(1, state.deathT + dt / 0.6);
      const k = easeOutCubic(state.deathT);
      root.rotation.x = -k * Math.PI * 0.48;
      root.position.y = -k * 0.15;
      return;
    }

    const isMoving = state.anim === 'walk' || state.anim === 'run';
    const speedFreq = state.anim === 'run' ? 9 : 5.2;
    const ampLeg = state.anim === 'run' ? 0.85 : 0.5;
    const ampArm = state.anim === 'run' ? 0.55 : 0.32;

    // Idle breathing always applied as a base layer
    const breathe = Math.sin(t * 1.3) * 0.02;
    torso.pivot.rotation.x = breathe * 0.6;
    headPivot.rotation.x = -breathe * 0.4;

    if (isMoving) {
      const swing = Math.sin(t * speedFreq);
      legL.hipPivot.rotation.x = swing * ampLeg;
      legR.hipPivot.rotation.x = -swing * ampLeg;
      legL.lower.pivot.rotation.x = Math.max(0, -swing) * ampLeg * 1.4;
      legR.lower.pivot.rotation.x = Math.max(0, swing) * ampLeg * 1.4;
      hipsPivot.position.y = 0.86 + Math.abs(Math.cos(t * speedFreq)) * 0.035;
      root.rotation.x = state.anim === 'run' ? 0.06 : 0.02;

      if (!state.aiming) {
        armL.shoulderPivot.rotation.x = -swing * ampArm;
        armR.shoulderPivot.rotation.x = swing * ampArm;
      }
    } else if (state.anim === 'jump') {
      legL.hipPivot.rotation.x = -0.5;
      legR.hipPivot.rotation.x = -0.3;
      legL.lower.pivot.rotation.x = 0.9;
      legR.lower.pivot.rotation.x = 0.7;
      root.rotation.x = -0.08;
    } else {
      // idle
      legL.hipPivot.rotation.x = 0;
      legR.hipPivot.rotation.x = 0;
      legL.lower.pivot.rotation.x = 0;
      legR.lower.pivot.rotation.x = 0;
      hipsPivot.position.y = 0.86;
      root.rotation.x = 0;
      if (!state.aiming) {
        armL.shoulderPivot.rotation.x = breathe * 1.5 - 0.15;
        armR.shoulderPivot.rotation.x = breathe * 1.2 - 0.1;
      }
    }

    // Aiming pose overrides arm rotation toward forward-raised position
    if (state.aiming) {
      armR.shoulderPivot.rotation.x = THREE.MathUtils.lerp(armR.shoulderPivot.rotation.x, -1.35, 0.3);
      armR.lower.pivot.rotation.x = THREE.MathUtils.lerp(armR.lower.pivot.rotation.x, -0.3, 0.3);
      armL.shoulderPivot.rotation.x = THREE.MathUtils.lerp(armL.shoulderPivot.rotation.x, -1.2, 0.3);
      armL.lower.pivot.rotation.x = THREE.MathUtils.lerp(armL.lower.pivot.rotation.x, -0.55, 0.3);
      torso.pivot.rotation.x = THREE.MathUtils.lerp(torso.pivot.rotation.x, -0.08, 0.3);
    }

    // Recoil pulse (brief, decays quickly, layers on top of aim pose)
    if (state.recoilT > 0) {
      const k = state.recoilT;
      armR.shoulderPivot.rotation.x -= 0.18 * k;
      torso.pivot.rotation.x -= 0.05 * k;
      headPivot.rotation.x -= 0.04 * k;
      if (weaponGroup) weaponGroup.position.z = 0.06 + 0.05 * k;
      state.recoilT = Math.max(0, state.recoilT - dt * 9);
    } else if (weaponGroup) {
      weaponGroup.position.z = 0.06;
    }

    // Reload dip: right hand drops toward hip and back over reloadDuration
    if (state.reloadT > 0) {
      state.reloadT += dt;
      const p = Math.min(1, state.reloadT / state.reloadDuration);
      const dip = Math.sin(p * Math.PI);
      armR.shoulderPivot.rotation.x += dip * 0.6;
      armR.lower.pivot.rotation.x += dip * 0.7;
      if (p >= 1) state.reloadT = 0;
    }
  }

  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  return {
    root, hipsPivot, headPivot, armR, weaponGroup: () => weaponGroup,
    attachWeapon, setAnim, setAiming, playRecoil, startReload, playDeath, reset, update,
    getMuzzleWorldPosition(out) {
      if (!weaponGroup) return out.copy(root.position);
      weaponGroup.userData.muzzleFlash.getWorldPosition(out);
      return out;
    },
    flashMuzzle: () => weaponGroup && flashMuzzle(weaponGroup),
  };
}
