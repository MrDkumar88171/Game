// camera.js — third-person camera: smooth follow, yaw/pitch orbit driven by
// swipe input, raycast collision so it never clips through scene geometry,
// and an aim-zoom FOV/offset change.

import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(camera, collidables) {
    this.camera = camera;
    this.collidables = collidables; // array of THREE.Object3D to raycast against
    this.target = new THREE.Vector3();
    this.yaw = 0;       // radians, controlled by swipe
    this.pitch = 0.28;  // radians above horizontal
    this.distance = 4.2;
    this.aimDistance = 2.0;
    this.height = 1.5;
    this.aiming = false;
    this.baseFov = 60;
    this.aimFov = 38;
    this.camera.fov = this.baseFov;
    this._raycaster = new THREE.Raycaster();
    this._desired = new THREE.Vector3();
    this._smoothPos = new THREE.Vector3();
    this._initialized = false;
  }

  setAiming(v) { this.aiming = v; }

  addYawPitch(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -0.25, 0.95);
  }

  update(followObject, dt) {
    this.target.copy(followObject.position);
    this.target.y += this.height;

    const dist = this.aiming ? this.aimDistance : this.distance;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).multiplyScalar(dist);

    this._desired.copy(this.target).add(offset);

    // Collision: pull camera toward target if something blocks the view
    const dir = this._desired.clone().sub(this.target).normalize();
    const fullDist = this._desired.distanceTo(this.target);
    this._raycaster.set(this.target, dir);
    this._raycaster.far = fullDist;
    const hits = this._raycaster.intersectObjects(this.collidables, true);
    let finalDist = fullDist;
    if (hits.length) finalDist = Math.max(0.6, hits[0].distance - 0.2);
    this._desired.copy(this.target).add(dir.multiplyScalar(finalDist));

    if (!this._initialized) {
      this._smoothPos.copy(this._desired);
      this._initialized = true;
    } else {
      const smoothing = 1 - Math.pow(0.0001, dt);
      this._smoothPos.lerp(this._desired, Math.min(1, smoothing * 1.4));
    }

    this.camera.position.copy(this._smoothPos);
    this.camera.lookAt(this.target);

    const targetFov = this.aiming ? this.aimFov : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
  }
}
