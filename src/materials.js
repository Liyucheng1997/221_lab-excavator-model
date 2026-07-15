/**
 * 共用材质与程序化贴图。整个工程不依赖任何外部素材,所有纹理都是 canvas 现画的,
 * 这样离线也能跑,不用管资源路径。
 */
import * as THREE from 'three';

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/** 泥土地面:低频斑块 + 细颗粒,避免大面积纯色露馅 */
export function makeGroundTexture() {
  return canvasTexture(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#8a7355';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const r = 18 + Math.random() * 70;
        g.fillStyle = `rgba(${100 + Math.random() * 50},${82 + Math.random() * 40},${
          58 + Math.random() * 30
        },0.18)`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
        g.fill();
      }
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 26;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
    },
    [26, 26]
  );
}

/** 履带板:钢板底色 + 磨亮的履刺 */
export function makeShoeTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#3a3d42';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(${20 + Math.random() * 60},${20 + Math.random() * 55},${
        20 + Math.random() * 50
      },0.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }
  });
}

export function createMaterials() {
  const M = {};

  // 机身黄。挖掘机的黄是偏橙的,不是柠檬黄。
  M.body = new THREE.MeshStandardMaterial({ color: 0xf0a81c, roughness: 0.62, metalness: 0.15 });
  M.bodyDark = new THREE.MeshStandardMaterial({ color: 0xd18f10, roughness: 0.66, metalness: 0.15 });

  // 工作装置比机身略深一点,而且更旧
  M.boom = new THREE.MeshStandardMaterial({ color: 0xe8a018, roughness: 0.7, metalness: 0.2 });

  // 结构钢件、履带架、配重
  M.steel = new THREE.MeshStandardMaterial({ color: 0x40444a, roughness: 0.72, metalness: 0.55 });
  M.steelDark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.8, metalness: 0.4 });

  // 油缸筒:发黑的厚壁钢管
  M.barrel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.8 });
  // 活塞杆:镀铬,必须锃亮 —— 这是挖掘机最显眼的高光
  M.rod = new THREE.MeshStandardMaterial({ color: 0xdcdfe4, roughness: 0.12, metalness: 1.0 });

  // 销轴
  M.pin = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.5, metalness: 0.9 });

  // 斗齿:磨损后的亮钢
  M.tooth = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, roughness: 0.4, metalness: 0.85 });
  // 斗体内壁被土磨得发亮
  M.bucketIn = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.35, metalness: 0.8 });

  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0xa8c8d8,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.82,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });

  M.rubber = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.95, metalness: 0 });
  M.seat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9, metalness: 0 });

  const shoeTex = makeShoeTexture();
  M.shoe = new THREE.MeshStandardMaterial({
    map: shoeTex,
    color: 0x555a61,
    roughness: 0.6,
    metalness: 0.75,
  });

  M.soil = new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 0.98, metalness: 0 });

  return M;
}
