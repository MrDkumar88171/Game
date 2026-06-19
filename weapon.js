// weapon.js — weapon stats table + low-poly weapon meshes + tracer/muzzle FX.
// Geometry is built from primitives (no external model files), grouped so it
// reads as a silhouette appropriate to its class at gameplay distance.

import * as THREE from 'three';

export const WEAPONS = {
  m416:    { name: 'M416',         class: 'Assault Rifle', damage: 24, fireRateMs: 100, mag: 30, reserve: 90, reloadMs: 1800, range: 80,  recoil: 0.018, bodyColor: 0x4a4f44 },
  akstyle: { name: 'AK Style',     class: 'Assault Rifle', damage: 29, fireRateMs: 120, mag: 30, reserve: 90, reloadMs: 2000, range: 75,  recoil: 0.026, bodyColor: 0x5a3d24 },
  scar:    { name: 'SCAR Style',   class: 'Assault Rifle', damage: 26, fireRateMs: 105, mag: 28, reserve: 84, reloadMs: 1900, range: 80,  recoil: 0.02,  bodyColor: 0x36392f },
  ump:     { name: 'UMP Style',    class: 'SMG',            damage: 18, fireRateMs: 75,  mag: 35, reserve: 105,reloadMs: 1700, range: 40,  recoil: 0.014, bodyColor: 0x2f2f2f },
  vector:  { name: 'Vector Style', class: 'SMG',            damage: 16, fireRateMs: 55,  mag: 33, reserve: 99, reloadMs: 1500, range: 35,  recoil: 0.01,  bodyColor: 0x3a3a3a },
  awm:     { name: 'AWM Style',    class: 'Sniper',         damage: 95, fireRateMs: 1500,mag: 5,  reserve: 15, reloadMs: 2600, range: 200, recoil: 0.06,  bodyColor: 0x223322 },
  shotgun: { name: 'Auto Shotgun', class: 'Shotgun',        damage: 70, fireRateMs: 650, mag: 8,  reserve: 24, reloadMs: 2200, range: 15,  recoil: 0.045, bodyColor: 0x40342a },
  deagle:  { name: 'Desert Eagle', class: 'Pistol',         damage: 35, fireRateMs: 280, mag: 7,  reserve: 21, reloadMs: 1300, range: 30,  recoil: 0.022, bodyColor: 0x9a9a9a },
};

export const WEAPON_ORDER = ['m416', 'akstyle', 'scar', 'ump', 'vector', 'awm', 'shotgun', 'deagle'];

export function buildWeaponMesh(weaponId) {
  const def = WEAPONS[weaponId] || WEAPONS.m416;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: def.bodyColor, roughness: 0.55, metalness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.3 });

  const isLong = def.class === 'Assault Rifle' || def.class === 'Sniper' || def.class === 'SMG';
  const bodyLen = def.class === 'Sniper' ? 0.85 : def.class === 'Pistol' ? 0.22 : def.class === 'Shotgun' ? 0.6 : 0.55;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, bodyLen), bodyMat);
  group.add(body);

  if (isLong) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.32, 8), darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -bodyLen / 2 - 0.16);
    group.add(barrel);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.22), bodyMat);
    stock.position.set(0, -0.01, bodyLen / 2 + 0.1);
    group.add(stock);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.05), darkMat);
    mag.position.set(0, -0.12, -0.05);
    mag.rotation.x = 0.15;
    group.add(mag);
  } else {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.14, 8), darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -bodyLen / 2 - 0.07);
    group.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.05), darkMat);
    grip.position.set(0, -0.09, 0.05);
    group.add(grip);
  }

  // Muzzle flash sprite, hidden by default
  const flashMat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.22, 0.22, 0.22);
  flash.position.set(0, 0.01, -bodyLen / 2 - (isLong ? 0.34 : 0.16));
  group.add(flash);
  group.userData.muzzleFlash = flash;
  group.userData.muzzleTip = flash.position.clone();
  group.userData.weaponId = weaponId;

  return group;
}

export function flashMuzzle(weaponGroup) {
  const flash = weaponGroup.userData.muzzleFlash;
  if (!flash) return;
  flash.material.opacity = 1;
  flash.scale.set(0.3, 0.3, 0.3);
  setTimeout(() => { flash.material.opacity = 0; }, 45);
}

// ---------------------------------------------------------------------------
// Bullet tracer pool — avoids allocating a new mesh per shot
// ---------------------------------------------------------------------------
const TRACER_POOL_SIZE = 24;
export function createTracerPool(scene) {
  const pool = [];
  const geo = new THREE.CylinderGeometry(0.01, 0.01, 1, 4);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, -0.5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff2c2, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, life: 0 });
  }
  let cursor = 0;
  return {
    fire(origin, target) {
      const t = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      t.mesh.position.copy(origin);
      t.mesh.lookAt(target);
      const dist = origin.distanceTo(target);
      t.mesh.scale.z = dist;
      t.mesh.visible = true;
      t.mesh.material.opacity = 0.9;
      t.life = 0.08;
    },
    update(dt) {
      for (const t of pool) {
        if (t.life > 0) {
          t.life -= dt;
          t.mesh.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
          if (t.life <= 0) t.mesh.visible = false;
        }
      }
    },
  };
}

// Simple expanding-ring impact effect, also pooled.
export function createImpactPool(scene, count = 12) {
  const pool = [];
  const geo = new THREE.RingGeometry(0.05, 0.09, 10);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, life: 0 });
  }
  let cursor = 0;
  return {
    burst(position, normal) {
      const im = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      im.mesh.position.copy(position);
      im.mesh.lookAt(position.clone().add(normal));
      im.mesh.visible = true;
      im.mesh.scale.setScalar(1);
      im.mesh.material.opacity = 0.85;
      im.life = 0.25;
    },
    update(dt) {
      for (const im of pool) {
        if (im.life > 0) {
          im.life -= dt;
          const k = 1 - im.life / 0.25;
          im.mesh.scale.setScalar(1 + k * 3);
          im.mesh.material.opacity = Math.max(0, 0.85 * (im.life / 0.25));
          if (im.life <= 0) im.mesh.visible = false;
        }
      }
    },
  };
}
