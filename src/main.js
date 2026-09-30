/**
 * 入口:装配全部模块 + 主循环。
 */
import * as THREE from 'three';
import { createMaterials } from './model/materials.js';
import { createScene, buildSite } from './world.js';
import { Terrain } from './terrain.js';
import { Excavator } from './excavator.js';
import { Machine } from './machine.js';
import { DumpTruck } from './truck.js';
import { Fx } from './fx.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { CameraRig } from './camera.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { clamp } from './linkage.js';

// ── 渲染器 ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: import.meta.env.DEV });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const { scene, sun } = createScene(renderer);
const M = createMaterials();
const terrain = new Terrain();
scene.add(terrain.mesh);
buildSite(scene, M, terrain.size);

const ex = new Excavator(M);
scene.add(ex.root);
const machine = new Machine(ex, terrain);
const truck = new DumpTruck(M);
truck.kind = 'truck';
scene.add(truck.group);

const input = new Input();
const sound = new Sound();
const rig = new CameraRig(canvas, ex, machine);

let game;
const fx = new Fx(scene, {
  surface: (p) => (truck.accepts(p) ? { y: truck.surfaceAt(p), target: 'truck' } : { y: terrain.heightAt(p.x, p.z), target: 'ground' }),
  onLand: (p, vol, target, fallH) => game.onSoilLand(p, vol, target, fallH),
});
machine.onSpill = (p, vol, vel) => fx.spill(p, vol, vel);

// ── 应用控制 ───────────────────────────────────────────────────────────
const app = {
  camera: rig.camera,
  sound,
  get game() {
    return game;
  },
  start(sc) {
    sound.start();
    ui.closeModal();
    ui.hideMenu();
    game.load(sc);
    rig.pipOn = game.settings.pip;
    ui.hud.setCamera(rig.modeName);
    ui.hud.setPattern(input.pattern);
    canvas.focus();
  },
  resume() {
    ui.closeModal();
    game.paused = false;
  },
  toMenu(keep = false) {
    game.exit();
    machine.placeAt(0, 0, 0, 0);
    machine.bucketLoad = 0;
    truck.group.visible = false;
    truck.state = 'hidden';
    ui.closeModal();
    if (!keep) ui.showMenu('main');
    menuT = 0;
  },
  setSetting(k, v) {
    game.settings[k] = v;
    game.saveSettings();
    applySettings();
  },
  action(a) {
    handleAction(a);
  },
};

const ui = new UI(app);
game = new Game({ scene, terrain, ex, m: machine, truck, fx, sound, input, rig, ui });

function applySettings() {
  const s = game.settings;
  input.pattern = s.pattern;
  ui.hud.setPattern(s.pattern);
  sound.setVolume(s.volume);
  const low = s.quality === 'low';
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  const size = low ? 2048 : 4096;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  resize();
}

// ── 输入事件 ───────────────────────────────────────────────────────────
function handleAction(a) {
  const inGame = game.running && !game.paused && !ui.modalOpen;
  switch (a) {
    case 'pause':
      if (ui.modalOpen && game.running) app.resume();
      else if (game.running) {
        game.paused = true;
        ui.showPause();
      }
      return;
    case 'help':
      if (game.running) {
        game.paused = true;
        ui.showHelp();
      }
      return;
  }
  if (!inGame) return;
  switch (a) {
    case 'lock':
      machine.toggleLock();
      break;
    case 'travelSpeed':
      machine.toggleTravelSpeed();
      ui.hud.toast(machine.travelHi ? '行走:兔子档(高速)' : '行走:乌龟档(低速)');
      break;
    case 'mode':
      machine.cycleMode();
      ui.hud.toast(`作业模式:${machine.mode}`, 'info', { P: 'P 重载模式:全功率,挖掘装车用。', E: 'E 经济模式:流量约 85%,省油,一般作业用。', L: 'L 精细模式:流量约 55%,动作慢而稳,平地、吊装、对位用。' }[machine.mode]);
      break;
    case 'autoIdle':
      machine.toggleAutoIdle();
      ui.hud.toast(machine.autoIdle ? '自动怠速:开(手柄回中 4 秒后降速省油)' : '自动怠速:关');
      break;
    case 'lights':
      machine.toggleLights();
      break;
    case 'throttleUp':
      machine.setThrottle(machine.throttle + 1);
      break;
    case 'throttleDown':
      machine.setThrottle(machine.throttle - 1);
      break;
    case 'camera':
      rig.next();
      ui.hud.setCamera(rig.modeName);
      break;
    case 'pip':
      rig.pipOn = !rig.pipOn;
      break;
    case 'resetPose':
      if (game.sc?.allowReset) machine.resetPose();
      break;
    case 'confirm':
      game.custom.onConfirm?.();
      break;
  }
}
for (const a of ['lock', 'travelSpeed', 'mode', 'autoIdle', 'lights', 'throttleUp', 'throttleDown', 'camera', 'pip', 'help', 'pause', 'resetPose', 'confirm']) {
  input.on(a, () => handleAction(a));
}
input.on('pattern', (p) => {
  game.settings.pattern = p;
  game.saveSettings();
  ui.hud.setPattern(p);
  ui.hud.toast(`已切换到 ${p} 手法`);
});
// 钥匙:OFF 时按一下 → ON;ON 且没着车时按住 → START;运转时按一下 → OFF
input.on('keyDown', () => {
  if (!game.running || game.paused) return;
  if (machine.key === 'off') machine.keyToggle();
  else if (machine.running) machine.keyToggle();
  else machine.keyStart(true);
});
input.on('keyUp', () => machine.keyStart(false));

// ── 菜单背景:机器自己演示挖掘动作,相机慢慢绕 ─────────────────────────
let menuT = 0;
function menuDemo(dt) {
  menuT += dt;
  const t = menuT * 0.35;
  machine.pose.swing = Math.sin(t * 0.7) * 0.9;
  machine.pose.boom = 0.2 + Math.sin(t) * 0.35;
  machine.pose.arm = -1.5 + Math.sin(t + 1) * 0.5;
  machine.pose.bucket = -0.9 + Math.sin(t + 2) * 0.6;
  ex.setPose(machine.pose);
  const a = menuT * 0.06 + 2.2;
  const p = ex.root.position;
  const cam = rig.camera;
  cam.position.set(p.x + Math.cos(a) * 16, p.y + 5.5, p.z + Math.sin(a) * 16);
  cam.lookAt(p.x + 2, p.y + 2.2, p.z);
  // 机器放在画面右侧,左边留给菜单
  cam.rotateY(0.28 * Math.min(1, cam.aspect / 1.3));
}

// ── 主循环 ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
const exhaust = new THREE.Vector3();
let w = 0;
let hgt = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt);
}

function step(dt) {
  const playing = game.running && !game.paused && !ui.modalOpen;
  if (playing) {
    input.enabled = true;
    input.update(dt);
    machine.setHorn(input.hornPressed);
    machine.update(dt, input.commands());
    game.update(dt);
  } else {
    input.enabled = false;
    input.update(dt);
    machine.setHorn(false);
  }
  truck.update(game.paused ? 0 : dt, terrain);
  if (!game.running && ui.menuOpen) menuDemo(dt);

  ex.setControls({
    left: { x: input.raw.leftX, y: input.raw.leftY },
    right: { x: input.raw.rightX, y: input.raw.rightY },
    trackL: input.raw.trackL,
    trackR: input.raw.trackR,
    locked: machine.locked,
    throttle: machine.throttle,
    key: machine.key,
  });
  ex.updateFx(dt, machine.status());
  fx.update(game.paused ? 0 : dt);
  fx.exhaust(dt, ex.exhaustWorld(exhaust), machine.rpm, machine.load, machine.running);

  if (game.running) rig.update(dt);

  // 太阳跟着机器走,保证阴影贴图罩得住
  const p = ex.root.position;
  sun.position.set(p.x + 30, p.y + 40, p.z - 22);
  sun.target.position.copy(p);
  sun.target.updateMatrixWorld();

  if (game.running) {
    ui.hud.update(game);
    ui.hotspots.update(w, hgt);
  }

  const c = machine.cmds;
  sound.update(dt, {
    rpm: machine.rpm,
    load: machine.load,
    hyd: clamp(Math.abs(c.boom) + Math.abs(c.arm) + Math.abs(c.bucket) + Math.abs(c.swing), 0, 1),
    relief: machine.relief,
    travel: clamp((Math.abs(machine.trackVel[0]) + Math.abs(machine.trackVel[1])) / 2, 0, 1),
    crank: machine.engine === 'crank',
    running: machine.running,
    horn: machine.horn,
    travelAlarm: machine.travelling,
    truckReversing: truck.state === 'reversing',
    warn: machine.tilt.kind === 'tip',
  });

  render();
}

function render() {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, hgt);
  renderer.render(scene, rig.camera);
  if (game.running && rig.pipOn && rig.mode !== 'side') {
    const r = rig.pipRect(w, hgt);
    const y = hgt - r.y - r.h;
    rig.pip.aspect = r.w / r.h;
    rig.pip.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setScissor(r.x, y, r.w, r.h);
    renderer.setViewport(r.x, y, r.w, r.h);
    ex.setOperatorVisible(true);
    renderer.render(scene, rig.pip);
    ex.setOperatorVisible(rig.mode !== 'cab');
    renderer.setScissorTest(false);
  }
  document.body.classList.toggle('pip-on', game.running && rig.pipOn && rig.mode !== 'side');
}

function resize() {
  w = innerWidth || canvas.clientWidth || 1280;
  hgt = innerHeight || canvas.clientHeight || 720;
  rig.resize(w, hgt);
  renderer.setSize(w, hgt, false);
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.body);

applySettings();
ex.setOperatorVisible(true);
machine.startEngineNow();
ui.showMenu('main');
frame();

if (import.meta.env.DEV) {
  window.__sim = { renderer, scene, ex, machine, terrain, truck, input, game, rig, ui, fx, THREE, step, app };
}
