/**
 * 入口:装配全部模块 + 相机 + 主循环。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from './config.js';
import { createMaterials } from './materials.js';
import { createScene, DumpTruck, makeCone } from './world.js';
import { Terrain } from './terrain.js';
import { Excavator } from './excavator.js';
import { Machine } from './machine.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { TaskRunner, TASKS } from './tasks.js';
import { EngineAudio } from './audio.js';
import { clamp } from './linkage.js';

// ── 基础设施 ───────────────────────────────────────────────────────────
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const mats = createMaterials();
const { scene, sun } = createScene(mats, renderer);

const terrain = new Terrain(mats);
scene.add(terrain.mesh);

const excavator = new Excavator(mats);
scene.add(excavator.root);

const machine = new Machine(excavator, terrain);

const truck = new DumpTruck(mats);
truck.group.visible = false;
scene.add(truck.group);

const markers = new THREE.Group();
scene.add(markers);

// 摆几个路锥当参照物 —— 没有参照物就完全没有距离感
for (const [x, z] of [
  [13, -6],
  [13, 6],
  [-10, -12],
  [16, 0],
]) {
  const c = makeCone();
  c.position.set(x, terrain.heightAt(x, z), z);
  scene.add(c);
}

const input = new Input();
const hud = new Hud();
const audio = new EngineAudio();

// ── 卸料:落点在车斗内腔上方就进车,否则撒在地上 ──
machine.onSpill = (point, volume) => {
  if (truck.group.visible && truck.accepts(point)) truck.add(volume);
  else {
    terrain.deposit(point.x, point.z, volume);
    const t = runner.current;
    if (t && t.id === 'load') t.spilled += volume;
  }
};

// ── 关卡 ───────────────────────────────────────────────────────────────
const runner = new TaskRunner({ machine, terrain, truck, markers, cmds: input.commands() });
runner.onChange = (task, i) => hud.setTask(task, i, TASKS.length);
runner.onComplete = (task) => hud.toast(`✓ ${task.title} 完成 —— 按 N 进入下一关`);
hud.setTask(runner.current, runner.index, TASKS.length);

document.getElementById('next-task').onclick = () => runner.next();
document.getElementById('prev-task').onclick = () => runner.go(runner.index - 1);
input.on('nextTask', () => runner.next());
input.on('resetPose', () => machine.resetPose());

// ── 相机 ───────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  innerWidth / innerHeight,
  CAMERA.near,
  CAMERA.far
);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.49;
orbit.minDistance = 5;
orbit.maxDistance = 70;
camera.position.set(-11, 9, 13);

// 驾驶室视点:挂在驾驶室里,所以会跟着回转一起转 —— 这正是真机视角迷人的地方
const eye = new THREE.Object3D();
eye.position.set(0.28, 1.28, 0);
excavator.cab.add(eye);

const CAMS = ['环视', '驾驶室', '跟随', '侧视'];
let camMode = 0;
hud.setCamera(CAMS[0]);
input.on('camera', () => {
  camMode = (camMode + 1) % CAMS.length;
  orbit.enabled = camMode === 0;
  hud.setCamera(CAMS[camMode]);
});
input.on('help', () => hud.toggleHelp());
input.on('pattern', (p) => {
  hud.setPattern(p);
  hud.toast(`已切换到 ${p} 手法`);
});

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const tmp = new THREE.Vector3();

function updateCamera(dt) {
  const root = excavator.root.position;
  switch (camMode) {
    case 0: // 环视:轨道中心跟着机器走
      orbit.target.lerp(tmp.set(root.x, root.y + 2.2, root.z), Math.min(1, dt * 4));
      orbit.update();
      break;
    case 1: {
      // 驾驶室:直接用视点的世界变换,连回转的惯性都能感觉到
      eye.getWorldPosition(camPos);
      camera.position.copy(camPos);
      excavator.cab.getWorldQuaternion(camera.quaternion);
      camera.rotateY(-Math.PI / 2); // 驾驶室朝 +X,相机默认看 -Z
      break;
    }
    case 2: {
      // 跟随:始终在底盘正后方
      const h = machine.heading;
      camTarget.set(root.x - Math.cos(h) * 11, root.y + 6.5, root.z + Math.sin(h) * 11);
      camera.position.lerp(camTarget, Math.min(1, dt * 2.5));
      camera.lookAt(root.x + Math.cos(h) * 3, root.y + 2, root.z - Math.sin(h) * 3);
      break;
    }
    case 3: {
      // 侧视:正对工作平面。看油缸怎么伸缩、斗齿走什么轨迹,这个视角最清楚。
      const a = machine.heading + machine.pose.swing;
      camTarget.set(root.x - Math.sin(a) * 15, root.y + 5, root.z - Math.cos(a) * 15);
      camera.position.lerp(camTarget, Math.min(1, dt * 2.5));
      camera.lookAt(root.x + Math.cos(a) * 3.5, root.y + 2.2, root.z - Math.sin(a) * 3.5);
      break;
    }
  }
}

// ── 开机 ───────────────────────────────────────────────────────────────
const splash = document.getElementById('splash');
for (const b of document.querySelectorAll('.pick')) {
  b.onclick = () => {
    document.querySelectorAll('.pick').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    input.pattern = b.dataset.pattern;
    hud.setPattern(input.pattern);
  };
}
hud.setPattern(input.pattern);
document.getElementById('start').onclick = () => {
  splash.classList.add('hidden');
  audio.start();
  canvas.focus();
};

// ── 主循环 ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
const tipWorld = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); // 卡一下也不要让物理跳过去

  input.update(dt);
  const cmds = input.commands();

  machine.update(dt, cmds, input.throttle);
  excavator.setStickVisual(...input.stickVisual());

  runner.ctx.cmds = cmds;
  runner.update(dt);

  // 太阳跟着机器走,保证阴影贴图始终罩得住
  const p = excavator.root.position;
  sun.position.set(p.x + 28, p.y + 40, p.z + 18);
  sun.target.position.copy(p);
  sun.target.updateMatrixWorld();

  updateCamera(dt);

  // HUD
  hud.setSticks(input.raw);
  hud.setTaskState(runner.state, runner.completed);
  excavator.getTipWorld(tipWorld);
  hud.setGauges(machine, input.throttle, tipWorld.y, terrain.heightAt(tipWorld.x, tipWorld.z));

  const hydAmt = clamp(
    Math.abs(cmds.boom) + Math.abs(cmds.arm) + Math.abs(cmds.bucket) + Math.abs(cmds.swing),
    0,
    1
  );
  const travelAmt = clamp(Math.abs(cmds.trackL) + Math.abs(cmds.trackR), 0, 1);
  audio.update(machine.rpm, machine.load, hydAmt, travelAmt);

  renderer.render(scene, camera);
}

function resize() {
  // 有些内嵌容器在首帧时还没有布局尺寸,取到 0 会让画布变成 0×0 再也回不来
  const w = innerWidth || canvas.clientWidth || 1280;
  const h = innerHeight || canvas.clientHeight || 720;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
addEventListener('resize', resize);
// 靠 ResizeObserver 补上 window resize 事件覆盖不到的情况(内嵌、分栏被拖动等)
new ResizeObserver(resize).observe(document.body);
resize();
frame();

// 开发期钩子:无头环境里没有 rAF,得能手动驱动一帧出来核对模型
if (import.meta.env.DEV) {
  window.__sim = { renderer, scene, camera, excavator, machine, terrain, truck, input, runner, THREE };
}
