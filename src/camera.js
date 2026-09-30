/**
 * 相机:
 *   驾驶室 —— 真机视角,相机挂在操作员眼睛上,跟着回转和车身晃。鼠标拖动 = 转头,滚轮 = 视野
 *   环视   —— 绕机器转(鼠标拖动 / 滚轮缩放)
 *   跟随   —— 在底盘正后方
 *   侧视   —— 正对工作平面,看斗齿轨迹最清楚
 *   俯视   —— 从上往下看斗子,挖沟平地时对线用
 * 另有一个画中画侧视(Tab 开关):在驾驶室视角下弥补屏幕没有纵深感的问题 ——
 * 真人坐在驾驶室里靠双眼判断距离,屏幕上只能靠这个。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from './config.js';
import { clamp } from './linkage.js';

export const CAM_MODES = [
  { id: 'cab', name: '驾驶室' },
  { id: 'orbit', name: '环视' },
  { id: 'chase', name: '跟随' },
  { id: 'side', name: '侧视' },
  { id: 'top', name: '俯视' },
];

export class CameraRig {
  constructor(canvas, excavator, machine) {
    this.canvas = canvas;
    this.ex = excavator;
    this.m = machine;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, CAMERA.near, CAMERA.far);
    this.pip = new THREE.PerspectiveCamera(38, 4 / 3, 0.2, 400);
    this.pipOn = false;
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 60;
    this.orbit.enabled = false;
    this.mode = 'cab';
    this.look = { yaw: 0, pitch: -0.18, fov: CAMERA.fov };
    this._drag = null;
    this._pos = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._t = new THREE.Vector3();
    this._t2 = new THREE.Vector3();

    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'cab') return;
      this._drag = { x: e.clientX, y: e.clientY, yaw: this.look.yaw, pitch: this.look.pitch };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const k = 0.0045 * (this.look.fov / 60);
      this.look.yaw = clamp(this._drag.yaw - (e.clientX - this._drag.x) * k, -2.6, 2.6);
      this.look.pitch = clamp(this._drag.pitch - (e.clientY - this._drag.y) * k, -1.2, 0.7);
    });
    const end = () => (this._drag = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', () => {
      if (this.mode === 'cab') Object.assign(this.look, { yaw: 0, pitch: -0.18 });
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'cab') return;
        this.look.fov = clamp(this.look.fov + Math.sign(e.deltaY) * 4, 30, 80);
        e.preventDefault();
      },
      { passive: false }
    );
  }

  get modeName() {
    return CAM_MODES.find((c) => c.id === this.mode).name;
  }

  setMode(id) {
    this.mode = id;
    this.orbit.enabled = id === 'orbit';
    this.ex.setOperatorVisible(id !== 'cab');
    this.camera.near = id === 'cab' ? 0.05 : 0.2;
    if (id !== 'cab') this.camera.fov = CAMERA.fov;
    if (id === 'orbit') {
      const p = this.ex.root.position;
      this.orbit.target.set(p.x, p.y + 2, p.z);
      const h = this.m.heading;
      this.camera.position.set(p.x - Math.cos(h - 0.8) * 13, p.y + 8, p.z + Math.sin(h - 0.8) * 13);
    }
    this.camera.updateProjectionMatrix();
    this._snap = true;
  }

  next() {
    const i = CAM_MODES.findIndex((c) => c.id === this.mode);
    this.setMode(CAM_MODES[(i + 1) % CAM_MODES.length].id);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    const cam = this.camera;
    const root = this.ex.root.position;
    const k = this._snap ? 1 : Math.min(1, dt * 3);
    this._snap = false;
    const tip = this.ex.getTipWorld(this._t2);
    const a = this.m.heading + this.m.pose.swing;
    switch (this.mode) {
      case 'cab': {
        this.ex.getEye(this._pos, this._q);
        cam.position.copy(this._pos);
        cam.quaternion.copy(this._q);
        cam.rotateY(-Math.PI / 2 + this.look.yaw);
        cam.rotateX(this.look.pitch);
        if (Math.abs(cam.fov - this.look.fov) > 0.01) {
          cam.fov = this.look.fov;
          cam.updateProjectionMatrix();
        }
        break;
      }
      case 'orbit':
        this.orbit.target.lerp(this._t.set(root.x, root.y + 2.2, root.z), Math.min(1, dt * 4));
        this.orbit.update();
        break;
      case 'chase': {
        const h = this.m.heading;
        this._t.set(root.x - Math.cos(h) * 12, root.y + 7, root.z + Math.sin(h) * 12);
        cam.position.lerp(this._t, k);
        cam.lookAt(root.x + Math.cos(h) * 4, root.y + 1.5, root.z - Math.sin(h) * 4);
        break;
      }
      case 'side': {
        const mid = this._t.set(root.x + Math.cos(a) * 4.5, root.y + 2.2, root.z - Math.sin(a) * 4.5);
        const pos = new THREE.Vector3(mid.x + Math.sin(a) * 17, mid.y + 3, mid.z + Math.cos(a) * 17);
        cam.position.lerp(pos, k);
        cam.lookAt(mid);
        break;
      }
      case 'top': {
        const c = this._t.set((root.x + tip.x * 2) / 3, 0, (root.z + tip.z * 2) / 3);
        const pos = new THREE.Vector3(c.x - Math.cos(a) * 2, root.y + 17, c.z + Math.sin(a) * 2);
        cam.position.lerp(pos, k);
        cam.up.set(Math.cos(a), 0, -Math.sin(a));
        cam.lookAt(c.x, root.y, c.z);
        cam.up.set(0, 1, 0);
        break;
      }
    }
    // 画中画:正对工作平面的侧视
    if (this.pipOn) {
      const mid = new THREE.Vector3(root.x + Math.cos(a) * 5, root.y + 1.8, root.z - Math.sin(a) * 5);
      this.pip.position.set(mid.x + Math.sin(a) * 15, mid.y + 1.2, mid.z + Math.cos(a) * 15);
      this.pip.lookAt(mid);
    }
  }

  /** 画中画视口(像素) */
  pipRect(w, h) {
    const pw = Math.round(Math.min(360, w * 0.3));
    const ph = Math.round(pw * 0.66);
    return { x: w - pw - 16, y: 16 + 44, w: pw, h: ph };
  }
}
