/**
 * 教学关卡。顺序是照着真人学挖机的路子排的:
 *   先分别认识四个动作 → 再练复合动作的落点 → 挖满一斗 → 挖出规矩的沟 →
 *   装车(练回转定位)→ 行走 → 平整(最难,要三个动作配合)
 *
 * 每关的 update 返回 { progress, hint },progress 到 1 就算过。
 */
import * as THREE from 'three';
import { BUCKET } from './config.js';
import { makeMarker, makeTrenchGuide } from './world.js';
import { clamp } from './linkage.js';

const TRUCK_POS = { x: 1.5, z: -11.5, rot: Math.PI / 2 };

function avg(a) {
  return a.reduce((s, v) => s + v, 0) / (a.length || 1);
}
function stddev(a) {
  const m = avg(a);
  return Math.sqrt(avg(a.map((v) => (v - m) ** 2)));
}

// ── 1. 认识四个动作 ────────────────────────────────────────────────────
const familiarize = {
  id: 'basics',
  title: '第 1 关 · 认识手柄',
  brief: '挖掘机只有四个基本动作。把每个动作都往两边推到底,感受一下它们各自管什么。',
  tips: [
    '真机的手柄控制的是液压流量,不是位置 —— 推得越多动得越快,松手就停在原地。',
    '注意左下角的手柄示意图,它会跟着你的输入动。',
  ],
  enter(ctx) {
    this.seen = { swing: 0, boom: 0, arm: 0, bucket: 0 };
  },
  update(dt, ctx) {
    const c = ctx.cmds;
    for (const k of ['swing', 'boom', 'arm', 'bucket']) {
      this.seen[k] = Math.max(this.seen[k], Math.min(1, Math.abs(c[k]) / 0.85));
    }
    const names = { swing: '回转', boom: '动臂', arm: '斗杆', bucket: '铲斗' };
    const missing = Object.keys(this.seen)
      .filter((k) => this.seen[k] < 0.95)
      .map((k) => names[k]);
    const progress = avg(Object.values(this.seen));
    return {
      progress,
      hint: missing.length ? `还没试过:${missing.join('、')}` : '四个动作都认全了',
    };
  },
};

// ── 2. 复合动作:让斗齿去点目标 ────────────────────────────────────────
const touchTargets = {
  id: 'touch',
  title: '第 2 关 · 斗齿点位',
  brief: '用斗齿依次点到三个目标圈。这一关练的是"回转 + 动臂 + 斗杆"三个动作配合着走。',
  tips: [
    '别一个动作一个动作地做,试着两个手柄同时推 —— 真正的效率全在复合动作里。',
    '够不到就先把斗杆伸出去,动臂不用抬太高。',
  ],
  enter(ctx) {
    const spots = [
      [7.5, 0],
      [5.5, 5.5],
      [0, 7.2],
    ];
    this.targets = spots.map(([x, z]) => {
      const y = ctx.terrain.heightAt(x, z);
      const m = makeMarker(0x33dd66, 1.0);
      m.position.set(x, y + 0.02, z);
      ctx.markers.add(m);
      return { x, z, mesh: m, hit: false };
    });
  },
  update(dt, ctx) {
    const tip = ctx.machine.ex.getTipWorld();
    for (const t of this.targets) {
      if (t.hit) continue;
      const d = Math.hypot(tip.x - t.x, tip.z - t.z);
      const gy = ctx.terrain.heightAt(t.x, t.z);
      if (d < 0.9 && tip.y < gy + 0.6) {
        t.hit = true;
        t.mesh.traverse((o) => {
          if (o.material) o.material.color.set(0x999999);
        });
      }
    }
    const hit = this.targets.filter((t) => t.hit).length;
    return {
      progress: hit / this.targets.length,
      hint: `已点到 ${hit} / ${this.targets.length} 个`,
    };
  },
};

// ── 3. 挖满一斗 ────────────────────────────────────────────────────────
const firstBucket = {
  id: 'dig',
  title: '第 3 关 · 挖满一斗',
  brief: '在前方挖一斗土出来,装到八成以上。',
  tips: [
    '标准动作:斗杆伸出去 → 斗齿插进土里 → **同时**收斗杆和收铲斗,让斗齿沿着一条平缓的弧线刮过去。',
    '光把斗子按在土里不动是装不满的 —— 得让斗齿真的走起来削土。',
    '斗齿插太深会憋住,插太浅又刮不到土。看着深度尺,一刀 20~30 公分最顺。',
  ],
  enter(ctx) {
    const m = makeMarker(0xffbb22, 1.6);
    const y = ctx.terrain.heightAt(7, 0);
    m.position.set(7, y + 0.02, 0);
    ctx.markers.add(m);
    this.best = 0;
  },
  update(dt, ctx) {
    this.best = Math.max(this.best, ctx.machine.bucketLoad);
    const f = this.best / BUCKET.capacity;
    return {
      progress: clamp(f / 0.8, 0, 1),
      hint: `最满装到 ${(f * 100).toFixed(0)}%(目标 80%)`,
    };
  },
};

// ── 4. 挖沟 ────────────────────────────────────────────────────────────
const trench = {
  id: 'trench',
  title: '第 4 关 · 挖一条沟',
  brief: '沿放好的线挖一条沟,挖到 1.5 米深,而且沟底要平。',
  tips: [
    '一层一层往下挖,别想一口气挖到底。每层刮平了再挖下一层。',
    '沟底平不平,靠的是动臂和斗杆配合:斗杆往回收的同时,动臂要慢慢往下压,才能走出直线。',
    '挖出来的土往旁边甩,别堆在沟边上挡着。',
  ],
  target: 1.5,
  enter(ctx) {
    this.cx = 7.0;
    this.cz = 0;
    this.halfX = 3.2;
    this.halfZ = 0.9;
    this.guide = makeTrenchGuide(this.cx, this.cz, this.halfX, this.halfZ);
    ctx.markers.add(this.guide);
    this.baseline = avg(ctx.terrain.sampleRegion(this.cx, this.cz, this.halfX, this.halfZ));
  },
  update(dt, ctx) {
    const hs = ctx.terrain.sampleRegion(this.cx, this.cz, this.halfX, this.halfZ);
    const depth = this.baseline - avg(hs);
    const flat = stddev(hs);
    const depthOk = clamp(depth / this.target, 0, 1);
    // 沟底起伏超过 25cm 就不算合格
    const flatOk = clamp(1 - (flat - 0.12) / 0.25, 0, 1);
    return {
      progress: depthOk >= 0.98 ? Math.min(1, flatOk) : depthOk * 0.9,
      hint: `平均深度 ${depth.toFixed(2)} / ${this.target} m,沟底起伏 ±${flat.toFixed(2)} m${
        depthOk >= 0.98 && flatOk < 1 ? ' —— 深度够了,再把沟底刮平' : ''
      }`,
    };
  },
};

// ── 5. 装车 ────────────────────────────────────────────────────────────
const loadTruck = {
  id: 'load',
  title: '第 5 关 · 装车',
  brief: '把土装进自卸车,装到八成。撒在车外的不算。',
  tips: [
    '回转要提前松手 —— 上车十几吨重,松了手还得滑十几度才停,等对准了才松就已经过了。',
    '斗子举过车厢板再卸,别怕高。卸的时候把铲斗打开就行,不用抬动臂。',
    '装车讲究"就近":车停得离工作面越近,一个循环越快。',
  ],
  enter(ctx) {
    ctx.truck.reset();
    ctx.truck.setPosition(TRUCK_POS.x, TRUCK_POS.z, TRUCK_POS.rot);
    ctx.truck.group.visible = true;
    this.spilled = 0;
  },
  update(dt, ctx) {
    const f = ctx.truck.load / ctx.truck.capacity;
    return {
      progress: clamp(f / 0.8, 0, 1),
      hint: `车斗 ${(f * 100).toFixed(0)}%(目标 80%)· 撒在外面 ${this.spilled.toFixed(2)} m³`,
    };
  },
  exit(ctx) {
    ctx.truck.group.visible = false;
  },
};

// ── 6. 行走 ────────────────────────────────────────────────────────────
const travel = {
  id: 'travel',
  title: '第 6 关 · 行走转场',
  brief: '开着机器走到目标圈里停下。R/F 管左履带,T/G 管右履带。',
  tips: [
    '两根杆同时推 = 直行;只推一根 = 绕着另一条履带转;一推一拉 = 原地打转。',
    '行走前先把工作装置收拢、动臂放低 —— 真机这么做是为了降重心,坡上尤其重要。',
    '注意:回转平台转过之后,操纵杆的方向和车走的方向就对不上了。真机上老手会先看履带在哪边。',
  ],
  enter(ctx) {
    this.x = -12;
    this.z = 9;
    const y = ctx.terrain.heightAt(this.x, this.z);
    this.mesh = makeMarker(0x33aaff, 2.0);
    this.mesh.position.set(this.x, y + 0.02, this.z);
    ctx.markers.add(this.mesh);
    this.held = 0;
  },
  update(dt, ctx) {
    const p = ctx.machine.position;
    const d = Math.hypot(p.x - this.x, p.z - this.z);
    const stopped = Math.abs(ctx.machine.trackVel[0]) < 0.05 && Math.abs(ctx.machine.trackVel[1]) < 0.05;
    if (d < 2.0 && stopped) this.held += dt;
    else this.held = 0;
    return {
      progress: d < 2.0 ? clamp(this.held / 1.5, 0, 1) : clamp(1 - (d - 2) / 22, 0, 0.9),
      hint: d < 2.0 ? (stopped ? '停稳中…' : '到位了,停下来') : `距离目标 ${d.toFixed(1)} m`,
    };
  },
};

// ── 7. 平整 ────────────────────────────────────────────────────────────
const grading = {
  id: 'grade',
  title: '第 7 关 · 平整场地',
  brief: '把标出来的方块区域刮平,起伏控制在 ±8 厘米以内。这是挖机手最难的基本功。',
  tips: [
    '平地是"拉"出来的不是"推"出来的:斗子放平贴住地面,斗杆往回收,同时动臂配合上下微调。',
    '把铲斗底面当成刮板,保持它一直贴着地。',
    '慢比快强。这一关油门可以调小(按 - 键),动作更好控制。',
  ],
  enter(ctx) {
    this.cx = 7.5;
    this.cz = 0;
    this.half = 2.6;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.half * 2, this.half * 2),
      new THREE.MeshBasicMaterial({
        color: 0x44ffcc,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.target = avg(ctx.terrain.sampleRegion(this.cx, this.cz, this.half, this.half));
    this.mesh.position.set(this.cx, this.target + 0.01, this.cz);
    ctx.markers.add(this.mesh);
  },
  update(dt, ctx) {
    const hs = ctx.terrain.sampleRegion(this.cx, this.cz, this.half, this.half);
    const err = Math.sqrt(avg(hs.map((h) => (h - this.target) ** 2)));
    return {
      progress: clamp(1 - (err - 0.08) / 0.3, 0, 1),
      hint: `相对设计标高的起伏 ±${(err * 100).toFixed(1)} cm(目标 ±8 cm)`,
    };
  },
};

export const TASKS = [familiarize, touchTargets, firstBucket, trench, loadTruck, travel, grading];

/** 关卡管理:负责切换、清理标志物、以及把"过关"这件事报出去 */
export class TaskRunner {
  constructor(ctx) {
    this.ctx = ctx;
    this.index = -1;
    this.state = { progress: 0, hint: '' };
    this.completed = false;
    this.onChange = null;
    this.go(0);
  }

  go(i) {
    const t = this.current;
    if (t && t.exit) t.exit(this.ctx);
    // 清掉上一关的所有标志物
    const g = this.ctx.markers;
    while (g.children.length) g.remove(g.children[0]);

    this.index = clamp(i, 0, TASKS.length - 1);
    this.completed = false;
    this.state = { progress: 0, hint: '' };
    const n = this.current;
    if (n && n.enter) n.enter(this.ctx);
    if (this.onChange) this.onChange(n, this.index);
  }

  next() {
    if (this.index < TASKS.length - 1) this.go(this.index + 1);
  }

  get current() {
    return TASKS[this.index];
  }

  update(dt) {
    const t = this.current;
    if (!t) return;
    this.state = t.update(dt, this.ctx) || this.state;
    if (!this.completed && this.state.progress >= 1) {
      this.completed = true;
      if (this.onComplete) this.onComplete(t, this.index);
    }
  }
}
