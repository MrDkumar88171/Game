// map.js — builds the open-world battleground out of primitives, using
// InstancedMesh for repeated props (trees/rocks/barrels/crates) so a few
// hundred objects cost only a handful of draw calls. A seeded PRNG keeps the
// layout stable for a given match.

import * as THREE from 'three';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLD_HALF = 95;

export function buildBattleground(scene, seed = 1) {
  const rng = mulberry32(seed);
  const colliders = [];   // solid props used for camera collision
  const half = WORLD_HALF;

  // --- Sky / fog -------------------------------------------------------
  scene.background = new THREE.Color(0x9fc1d6);
  scene.fog = new THREE.Fog(0xaecbdd, 60, 230);

  // --- Lighting ----------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbfd9ec, 0x3a3a28, 0.65);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
  sun.position.set(80, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);

  // --- Ground -------------------------------------------------------------
  const groundGeo = new THREE.PlaneGeometry(half * 2.4, half * 2.4, 64, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (half * 1.2);
    const hill = edge > 0.78 ? (edge - 0.78) * 18 : 0; // raise terrain near the boundary into "mountains"
    pos.setY(i, hill + Math.sin(x * 0.05) * Math.cos(z * 0.05) * 0.4);
  }
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4d7a3a, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Roads (simple crossing strips) -------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x55534d, roughness: 0.95 });
  const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(8, half * 2), roadMat);
  roadNS.rotation.x = -Math.PI / 2;
  roadNS.position.y = 0.02;
  roadNS.receiveShadow = true;
  scene.add(roadNS);
  const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 8), roadMat);
  roadEW.rotation.x = -Math.PI / 2;
  roadEW.position.set(0, 0.02, 30);
  roadEW.receiveShadow = true;
  scene.add(roadEW);

  // --- River ---------------------------------------------------------------
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(14, half * 1.6),
    new THREE.MeshStandardMaterial({ color: 0x2f6f93, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.88 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(-55, 0.05, -10);
  river.rotation.z = 0.18;
  scene.add(river);

  // --- Buildings (houses / warehouse / watchtower / factory) --------------
  function box(w, h, d, color) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  }

  function addHouse(x, z, ry = 0) {
    const g = new THREE.Group();
    const body = box(6, 3.2, 5, 0xb89a6e);
    body.position.y = 1.6; body.castShadow = body.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2, 4), new THREE.MeshStandardMaterial({ color: 0x6e3a30, roughness: 0.9 }));
    roof.position.y = 4.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    g.add(body, roof);
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g); colliders.push(body);
    return g;
  }

  function addWarehouse(x, z, ry = 0) {
    const g = new THREE.Group();
    const body = box(14, 6, 9, 0x788a8f);
    body.position.y = 3; body.castShadow = body.receiveShadow = true;
    const stripe = box(14.2, 0.6, 9.2, 0xc9a227);
    stripe.position.y = 1.4;
    g.add(body, stripe);
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g); colliders.push(body);
    return g;
  }

  function addTower(x, z) {
    const g = new THREE.Group();
    const legs = box(3.2, 9, 3.2, 0x4a4f48);
    legs.position.y = 4.5; legs.castShadow = legs.receiveShadow = true;
    const deck = box(4.4, 0.5, 4.4, 0x33362f);
    deck.position.y = 9.2; deck.castShadow = true;
    const rail = box(4.4, 1, 0.15, 0x222420);
    rail.position.y = 9.9;
    g.add(legs, deck, rail);
    g.position.set(x, 0, z);
    scene.add(g); colliders.push(legs);
    return g;
  }

  function addFactory(x, z) {
    const g = new THREE.Group();
    const body = box(16, 7, 12, 0x5b5d57);
    body.position.y = 3.5; body.castShadow = body.receiveShadow = true;
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 10, 10), new THREE.MeshStandardMaterial({ color: 0x3a3c37 }));
    stack.position.set(-5, 11, -3); stack.castShadow = true;
    g.add(body, stack);
    g.position.set(x, 0, z);
    scene.add(g); colliders.push(body);
    return g;
  }

  addHouse(40, -50, 0.4);
  addHouse(48, -42, 1.1);
  addHouse(-30, 55, -0.6);
  addHouse(-22, 48, 0.2);
  addWarehouse(55, 10, 0.3);
  addFactory(-50, -55, 0.5);
  addTower(0, -70);
  addTower(8, 65);

  // --- Walls (low cover) ---------------------------------------------------
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b6a5e, roughness: 0.95 });
  for (let i = 0; i < 10; i++) {
    const wx = (rng() - 0.5) * half * 1.5;
    const wz = (rng() - 0.5) * half * 1.5;
    if (Math.abs(wx) < 20 && Math.abs(wz) < 20) continue;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4 + rng() * 3, 1.1, 0.4), wallMat);
    wall.position.set(wx, 0.55, wz);
    wall.rotation.y = rng() * Math.PI;
    wall.castShadow = wall.receiveShadow = true;
    scene.add(wall);
    colliders.push(wall);
  }

  // --- Static vehicle silhouettes (non-drivable props) ----------------------
  function addVehicle(x, z, ry) {
    const g = new THREE.Group();
    const body = box(4.2, 1.3, 1.9, 0x4a5d3a);
    body.position.y = 0.9; body.castShadow = body.receiveShadow = true;
    const cab = box(2, 0.9, 1.8, 0x3a4a2c);
    cab.position.set(0.4, 1.7, 0); cab.castShadow = true;
    g.add(body, cab);
    g.position.set(x, 0, z); g.rotation.y = ry;
    scene.add(g); colliders.push(body);
  }
  addVehicle(20, 5, 0.3);
  addVehicle(-15, -35, 1.2);

  // --- Instanced foliage / rocks / barrels / crates -------------------------
  function scatterInstanced(geo, mat, count, opts) {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = true; inst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 6) {
      attempts++;
      const x = (rng() - 0.5) * half * 1.85;
      const z = (rng() - 0.5) * half * 1.85;
      if (Math.abs(x) < 14 && Math.abs(z) < 14) continue; // keep center spawn lanes clearer
      if (opts.avoidRoad && (Math.abs(x) < 6 || Math.abs(z - 30) < 6)) continue;
      const s = (opts.minScale + rng() * (opts.maxScale - opts.minScale));
      dummy.position.set(x, opts.yOffset ? opts.yOffset(s) : 0, z);
      dummy.rotation.y = rng() * Math.PI * 2;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    inst.count = placed;
    scene.add(inst);
    return inst;
  }

  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4226, roughness: 1 });
  scatterInstanced(trunkGeo, trunkMat, 90, { minScale: 0.8, maxScale: 1.6, avoidRoad: true, yOffset: (s) => s * 1 });

  const foliageGeo = new THREE.ConeGeometry(1.4, 3.2, 7);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.95 });
  scatterInstanced(foliageGeo, foliageMat, 90, { minScale: 0.8, maxScale: 1.6, avoidRoad: true, yOffset: (s) => s * 2.6 });

  const rockGeo = new THREE.IcosahedronGeometry(0.6, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x77756c, roughness: 1, flatShading: true });
  scatterInstanced(rockGeo, rockMat, 40, { minScale: 0.5, maxScale: 1.4, yOffset: (s) => s * 0.3 });

  const bushGeo = new THREE.SphereGeometry(0.6, 7, 6);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3f, roughness: 1 });
  scatterInstanced(bushGeo, bushMat, 45, { minScale: 0.6, maxScale: 1.2, yOffset: (s) => s * 0.45 });

  const barrelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a5a23, roughness: 0.7, metalness: 0.3 });
  scatterInstanced(barrelGeo, barrelMat, 26, { minScale: 0.8, maxScale: 1.1, avoidRoad: true, yOffset: (s) => s * 0.45 });

  const crateGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9c7b3f, roughness: 0.9 });
  scatterInstanced(crateGeo, crateMat, 22, { minScale: 0.8, maxScale: 1.2, avoidRoad: true, yOffset: (s) => s * 0.4 });

  return { ground, colliders, worldHalf: half };
}
