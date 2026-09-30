/**
 * 共用材质与程序化贴图。整个工程不依赖任何外部素材,所有纹理都是 canvas 现画的,离线也能跑。
 * 品牌名"锐工 RG215"是虚构的。
 */
import * as THREE from 'three';

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, wrap = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(g, w, h, amp) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

/** 油漆面:浅灰底(乘在材质颜色上),带斑驳污渍、划痕和竖向流痕 */
function grimeTexture(strength = 1) {
  return canvasTex(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, w, h);
      // 大块污斑
      for (let i = 0; i < 90 * strength; i++) {
        const r = 6 + Math.random() * 34;
        const v = 150 + Math.random() * 70;
        g.fillStyle = `rgba(${v},${v * 0.92},${v * 0.8},${0.025 + Math.random() * 0.045 * strength})`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
        g.fill();
      }
      // 流痕
      for (let i = 0; i < 90 * strength; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const len = 20 + Math.random() * 90;
        const gr = g.createLinearGradient(x, y, x, y + len);
        gr.addColorStop(0, 'rgba(90,75,55,0.1)');
        gr.addColorStop(1, 'rgba(90,75,55,0)');
        g.fillStyle = gr;
        g.fillRect(x, y, 1 + Math.random() * 3, len);
      }
      // 划痕露出底漆
      g.strokeStyle = 'rgba(70,60,50,0.35)';
      for (let i = 0; i < 60 * strength; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        g.lineWidth = 0.5 + Math.random();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 12);
        g.stroke();
      }
      noise(g, w, h, 18);
    },
    { repeat: [0.8, 0.8] }
  );
}

/** 铸钢件:暗灰带锈斑和泥 */
function castTexture() {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#6a6a6a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        const r = 3 + Math.random() * 22;
        const rust = Math.random() < 0.4;
        g.fillStyle = rust
          ? `rgba(120,70,35,${0.15 + Math.random() * 0.2})`
          : `rgba(95,80,60,${0.15 + Math.random() * 0.25})`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
        g.fill();
      }
      noise(g, w, h, 40);
    },
    { repeat: [1.5, 1.5] }
  );
}

/** 防滑踏板:菱形凸点 */
function treadPlateTexture() {
  return canvasTex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#5a5d62';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#8b8f96';
      for (let y = 0; y < h; y += 16) {
        for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
          g.save();
          g.translate(x + 4, y + 4);
          g.rotate(((y / 16) % 2 ? 1 : -1) * 0.7);
          g.fillRect(-5, -1.5, 10, 3);
          g.restore();
        }
      }
      noise(g, w, h, 20);
    },
    { repeat: [4, 4] }
  );
}

/** 散热百叶 */
function louverTexture() {
  return canvasTex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#2a2a2a';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        const gr = g.createLinearGradient(0, y, 0, y + 8);
        gr.addColorStop(0, '#d9a01c');
        gr.addColorStop(0.55, '#8a6410');
        gr.addColorStop(1, '#1a1a1a');
        g.fillStyle = gr;
        g.fillRect(4, y + 1, w - 8, 5);
      }
    },
    { repeat: [1, 1] }
  );
}

/** 文字贴花(透明底) */
export function decalTexture(lines, { w = 512, h = 128, color = '#1b1b1b', bg = null, font = 'bold 84px "Arial Black", "Microsoft YaHei", sans-serif', align = 'center' } = {}) {
  return canvasTex(
    w,
    h,
    (g) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
      }
      g.fillStyle = color;
      g.textAlign = align;
      g.textBaseline = 'middle';
      const arr = Array.isArray(lines) ? lines : [lines];
      arr.forEach((ln, i) => {
        g.font = ln.font || font;
        g.fillStyle = ln.color || color;
        const x = align === 'center' ? w / 2 : 10;
        g.fillText(ln.text ?? ln, x, (h * (i + 0.5)) / arr.length);
      });
    },
    { wrap: false }
  );
}

/** 警示贴:黄黑斜条纹 */
function hazardTexture() {
  return canvasTex(
    256,
    64,
    (g, w, h) => {
      g.fillStyle = '#f2c200';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#151515';
      for (let x = -h; x < w + h; x += 32) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 16, h);
        g.lineTo(x + 16 + h, 0);
        g.lineTo(x + h, 0);
        g.fill();
      }
    },
    { wrap: false }
  );
}

/** 安全警示牌 */
function warningSignTexture(title, body) {
  return canvasTex(
    256,
    192,
    (g, w, h) => {
      g.fillStyle = '#f7f7f2';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8b400';
      g.fillRect(0, 0, w, 58);
      g.fillStyle = '#111';
      g.font = 'bold 40px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(title, w / 2, 30);
      // 三角警示标
      g.beginPath();
      g.moveTo(48, 80);
      g.lineTo(88, 150);
      g.lineTo(8, 150);
      g.closePath();
      g.fillStyle = '#e8b400';
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#111';
      g.stroke();
      g.fillStyle = '#111';
      g.font = 'bold 44px Arial';
      g.fillText('!', 48, 125);
      g.font = 'bold 22px "Microsoft YaHei", sans-serif';
      g.textAlign = 'left';
      body.forEach((t, i) => g.fillText(t, 100, 96 + i * 30));
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);
    },
    { wrap: false }
  );
}

/** 轮胎胎面 */
function tireTexture() {
  return canvasTex(
    64,
    256,
    (g, w, h) => {
      g.fillStyle = '#1c1c1c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#0c0c0c';
      for (let y = 0; y < h; y += 16) {
        g.save();
        g.translate(w / 2, y);
        g.fillRect(-w / 2, 0, w * 0.42, 6);
        g.fillRect(w * 0.08, 8, w * 0.42, 6);
        g.restore();
      }
      noise(g, w, h, 14);
    },
    { repeat: [1, 6] }
  );
}

export function createMaterials() {
  const M = {};
  const grime = grimeTexture();
  const grimeHeavy = grimeTexture(2.2);
  const cast = castTexture();

  // 机身黄。挖掘机的黄是偏橙的"工程黄",不是柠檬黄。
  M.body = new THREE.MeshStandardMaterial({ color: 0xf2a814, map: grime, roughness: 0.5, metalness: 0.1 });
  M.bodyDark = new THREE.MeshStandardMaterial({ color: 0xd99410, map: grime, roughness: 0.56, metalness: 0.1 });
  // 工作装置更旧更脏
  M.boom = new THREE.MeshStandardMaterial({ color: 0xeea214, map: grimeHeavy, roughness: 0.58, metalness: 0.12 });
  // 配重、底护板等黑色喷涂件
  M.black = new THREE.MeshStandardMaterial({ color: 0x2e3033, map: grime, roughness: 0.6, metalness: 0.2 });
  M.blackGloss = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.3, metalness: 0.3 });

  // 结构钢件、履带架
  M.steel = new THREE.MeshStandardMaterial({ color: 0x4a4d52, map: grime, roughness: 0.6, metalness: 0.6 });
  M.steelDark = new THREE.MeshStandardMaterial({ color: 0x4a4c51, map: cast, roughness: 0.72, metalness: 0.3 });
  M.cast = new THREE.MeshStandardMaterial({ color: 0x5a5856, map: cast, roughness: 0.75, metalness: 0.35 });
  // 履带板:磨亮的履刺、泥
  M.shoe = new THREE.MeshStandardMaterial({ color: 0x5e5a55, map: cast, roughness: 0.66, metalness: 0.4 });
  M.link = new THREE.MeshStandardMaterial({ color: 0x77736d, map: cast, roughness: 0.45, metalness: 0.6 });

  // 油缸筒:发黑的厚壁钢管;活塞杆:镀铬,必须锃亮 —— 这是挖掘机最显眼的高光
  M.barrel = new THREE.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.4, metalness: 0.7 });
  M.rod = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.06, metalness: 1.0 });
  M.pin = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.42, metalness: 0.9 });
  M.grease = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.3, metalness: 0.2 });

  // 斗齿:磨损后的亮钢;斗体内壁被土磨得发亮
  M.tooth = new THREE.MeshStandardMaterial({ color: 0x8c8f94, map: cast, roughness: 0.35, metalness: 0.9 });
  M.bucketIn = new THREE.MeshStandardMaterial({ color: 0x8a847b, map: cast, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });

  M.hose = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.72, metalness: 0.05 });
  M.pipe = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.35, metalness: 0.8 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.1, metalness: 1.0 });

  // 玻璃:不用 transmission(太贵),用带反射的半透明
  M.glass = new THREE.MeshStandardMaterial({
    color: 0x6f8ea0,
    roughness: 0.05,
    metalness: 0.4,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  M.glassDark = new THREE.MeshStandardMaterial({
    color: 0x1d2a33,
    roughness: 0.1,
    metalness: 0.5,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  M.rubber = new THREE.MeshStandardMaterial({ color: 0x19191b, roughness: 0.92, metalness: 0 });
  M.seat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.95, metalness: 0 });
  M.seatFabric = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 1.0, metalness: 0 });
  M.plastic = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.05 });
  M.plasticLight = new THREE.MeshStandardMaterial({ color: 0x8e9299, roughness: 0.65, metalness: 0.05 });
  M.plasticRed = new THREE.MeshStandardMaterial({ color: 0xc0231c, roughness: 0.5, metalness: 0.05 });
  M.floorMat = new THREE.MeshStandardMaterial({ color: 0x1f2124, map: treadPlateTexture(), roughness: 0.95 });
  M.tread = new THREE.MeshStandardMaterial({ color: 0x8a8d92, map: treadPlateTexture(), roughness: 0.55, metalness: 0.7 });
  M.louver = new THREE.MeshStandardMaterial({ map: louverTexture(), roughness: 0.6, metalness: 0.2 });
  M.mirror = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.02, metalness: 1.0 });

  M.lightLens = new THREE.MeshStandardMaterial({ color: 0xf4f4ea, emissive: 0x000000, roughness: 0.1, metalness: 0.2 });
  M.beacon = new THREE.MeshStandardMaterial({
    color: 0xff9a1a,
    emissive: 0x000000,
    transparent: true,
    opacity: 0.85,
    roughness: 0.2,
  });
  M.tailLight = new THREE.MeshStandardMaterial({ color: 0xa3100c, emissive: 0x220000, roughness: 0.3 });
  M.reflector = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.3, metalness: 0.2 });

  M.soil = new THREE.MeshStandardMaterial({ color: 0x6e5436, roughness: 1.0, metalness: 0, flatShading: true });
  M.mud = new THREE.MeshStandardMaterial({ color: 0x5a4630, map: cast, roughness: 1.0, metalness: 0 });

  // 贴花
  const decalMat = (tex) =>
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  M.decalModel = decalMat(decalTexture('RG215', { color: '#151515' }));
  M.decalBrand = decalMat(
    decalTexture([{ text: '锐工重工', font: 'bold 76px "Microsoft YaHei", sans-serif' }], { color: '#151515' })
  );
  M.decalBrandWhite = decalMat(
    decalTexture([{ text: 'RUIGONG', font: 'bold 92px "Arial Black", sans-serif' }], { color: '#161616' })
  );
  M.decalHazard = decalMat(hazardTexture());
  M.decalWarn = decalMat(warningSignTexture('危 险', ['回转半径内', '严禁站人']));
  M.decalWarn2 = decalMat(warningSignTexture('注 意', ['离开驾驶室前', '锁定先导杆']));
  M.decalNumber = decalMat(decalTexture('20', { color: '#151515', w: 256, h: 128 }));

  M.tire = new THREE.MeshStandardMaterial({ color: 0x222222, map: tireTexture(), roughness: 0.92, metalness: 0 });

  return M;
}
