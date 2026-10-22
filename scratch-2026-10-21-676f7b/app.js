// Cinematic main menu: a dense Dutch tulip field at golden hour. A low, warm
// sun shines through the petals and stretches soft shadows across the field;
// waves of wind roll through the flowers toward a Zaanse Schans-style village
// and a working windmill. Tap anywhere → the letter opens and focus pulls to
// the lens; minimize it and focus returns to the field.
//
// Rendering: RenderPass → BokehPass (depth of field) → UnrealBloomPass → OutputPass.
//
// How the field stays affordable:
// - It is split into small chunks (InstancedMeshes). Chunks outside the view are
//   culled, and each chunk picks its level of detail by distance every frame.
// - Only the closest tulips use MeshPhysicalMaterial with transmission; the rest
//   use MeshStandardMaterial with the same bump-mapped petal look.
// - Shadows come from very simple invisible stand-ins (no colour, no depth in
//   the main view), swaying with the same wind shader.
// - Quality steps down automatically if frames run slow.
import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ================================================================== CONFIG
const LOW_POWER = (navigator.hardwareConcurrency || 4) <= 4;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_DPR = 1.5;
const FPS_CAP = 60;
const PETAL_BURST = 48;

const SHOTS = {
  menu:  { z: 8,  height: 2.5, lookY: 1.5, fov: 44, pan: 1 },
  focus: { z: -3, height: 2.3, lookY: 1.7, fov: 42, pan: 0.75 },
};

const DOF = {
  field:  { focus: 14,  aperture: 0,      maxblur: 0 },      // letter minimized: everything sharp (pass off)
  letter: { focus: 0.6, aperture: 0.0032, maxblur: 0.016 },  // letter open: focus pulls to the lens
};
const BLOOM = { strength: 0.45, radius: 0.55, threshold: 0.82 };

const FIELD = {
  start: 9,
  end: -46,
  spacing: LOW_POWER ? 0.3 : 0.19,   // ~3× denser than before
  bedPitch: 1.6,
  lodNear: 6,                        // chunk distance for the transmissive, full-detail tulip
  lodMid: 19,                        // …for the bump-mapped mid-detail tulip; beyond: a smooth cup
};

// Rich palette: purples and pinks, plus yellow, orange, white, green and brown beds
const PALETTE = {
  deepViolet: ['#3c096c', '#4a0e8f', '#5a189a'],
  violet:     ['#7b2cbf', '#8e44ad', '#9d4edd'],
  magenta:    ['#b5179e', '#c2185b', '#d0177f'],
  lilac:      ['#c8a2ff', '#d9b8ff', '#b892ff'],
  blush:      ['#ffb3c7', '#ffc2d4', '#f7a1bf'],
  white:      ['#fbf7f4', '#fff3f7', '#f4f1ea'],
  yellow:     ['#ffd60a', '#ffc300', '#ffe066'],
  orange:     ['#ff8c1a', '#ff7a00', '#ffa040'],
  green:      ['#a7d672', '#8cc66a', '#c3e59a'],   // like 'Spring Green' tulips
  brown:      ['#8a5232', '#7b4a2e', '#a0643c'],   // like 'Brown Sugar' / café tulips
};
const BEDS = ['violet', 'yellow', 'blush', 'deepViolet', 'orange', 'lilac', 'white', 'magenta',
  'green', 'violet', 'brown', 'blush', 'yellow', 'deepViolet', 'orange', 'lilac', 'magenta', 'white'];
const BED_COLORS = BEDS.map((b) => new THREE.Color(PALETTE[b][0]));
const ALL_COLORS = Object.values(PALETTE).flat().map((c) => new THREE.Color(c));

// Golden hour: a low sun to the left of the windmill, behind the field
const SUN_DIR = new THREE.Vector3(-0.62, 0.2, -0.76).normalize();
const SUN_TARGET = new THREE.Vector3(0, 0, -28);
const HAZE = '#efd3bf';
const SKY = { zenith: '#3d6db5', mid: '#8bb4e0', horizon: '#ffd7ae', sun: '#ffcf8f', halo: '#ffae6e' };
const WINDMILL = { x: 1.6, z: -54 };

const groundY = (x, z) => 0.38 * Math.sin(x * 0.16 + z * 0.06)
  + 0.26 * Math.sin(z * 0.11 - x * 0.07 + 1.3)
  + 0.12 * Math.sin((x + z) * 0.29);
const curveX = (z) => Math.sin(z * 0.035) * 2.2;

// ================================================================== RENDERER
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch {
  document.documentElement.classList.add('no-webgl');
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(HAZE, 0.0058);

const camera = new THREE.PerspectiveCamera(SHOTS.menu.fov, 1, 0.1, 400);
const shot = { ...SHOTS.menu };
const dof = { ...DOF.field };

if (renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;

const U = {
  time:       { value: 0 },
  gust:       { value: 0 },
  pixelRatio: { value: 1 },
  projScale:  { value: 400 },
  ripplePos:  { value: new THREE.Vector3(0, 0, -1000) },
  rippleTime: { value: -100 },
  burstTime:  { value: -100 },
  sunView:    { value: new THREE.Vector3() },
};

const wind = { gust: 0 };
function scheduleGust() {
  if (REDUCED) return;
  gsap.delayedCall(gsap.utils.random(4, 8), () => {
    gsap.to(wind, {
      gust: gsap.utils.random(0.6, 1), duration: gsap.utils.random(1.4, 2.4), ease: 'sine.inOut',
      yoyo: true, repeat: 1, onComplete: scheduleGust,
    });
  });
}
scheduleGust();

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_GLSL = /* glsl */`
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), s.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), s.x), s.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { sum += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
    return sum;
  }`;

// ================================================================== PROCEDURAL TEXTURES
// Everything is painted once on off-screen canvases. Colour maps are sRGB;
// bump and roughness maps are linear data.
const texRand = mulberry32(5);
function canvasTexture(w, h, draw, { srgb = false, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Smooth fractal value noise, written straight into pixels
function noiseTexture(size, cells, octaves, seed, lo = 0, hi = 255) {
  return canvasTexture(size, size, (g) => {
    const rand = mulberry32(seed);
    const img = g.createImageData(size, size);
    const grids = [];
    for (let o = 0; o < octaves; o++) {
      const n = cells << o;
      grids.push({ n, v: Array.from({ length: n * n }, () => rand()) });
    }
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let amp = 0.5;
        let norm = 0;
        for (const { n, v } of grids) {
          const fx = (x / size) * n;
          const fy = (y / size) * n;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const tx = smooth(fx - ix);
          const ty = smooth(fy - iy);
          const at = (a, b) => v[((b % n) * n) + (a % n)];       // wraps: the texture tiles seamlessly
          const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
          const bot = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
          sum += (top * (1 - ty) + bot * ty) * amp;
          norm += amp;
          amp *= 0.5;
        }
        const val = lo + (hi - lo) * (sum / norm);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

// Weathering for every surface in the village: drives roughness, so nothing looks like plastic
const ROUGHNESS_NOISE = noiseTexture(256, 4, 5, 11, 150, 255);

// Petal micro-texture: fine veins fanning up from the base over a soft organic grain
const PETAL_BUMP = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {                                   // grain
    const v = 100 + texRand() * 56;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(texRand() * w, texRand() * h, 2 + texRand() * 5, 2 + texRand() * 5);
  }
  for (let i = 0; i < 46; i++) {                                     // veins: base (bottom) → tip
    const t = i / 45;
    const x0 = w * (0.5 + (t - 0.5) * 0.18);
    const x1 = w * (0.04 + t * 0.92);
    g.strokeStyle = `rgba(40,40,40,${0.25 + texRand() * 0.35})`;
    g.lineWidth = 1 + texRand() * 2.2;
    g.beginPath();
    g.moveTo(x0, h);
    g.quadraticCurveTo(x0 + (x1 - x0) * 0.2 + (texRand() - 0.5) * 30, h * 0.5, x1 + (texRand() - 0.5) * 12, h * (0.02 + texRand() * 0.12));
    g.stroke();
  }
}, { repeat: false });

// Overlapping clapboards: a bright top edge, a dark shadow under each board, wood grain
const PLANK_BUMP = canvasTexture(256, 256, (g, w, h) => {
  const n = 6;
  for (let k = 0; k < n; k++) {
    const y = (k * h) / n;
    const grad = g.createLinearGradient(0, y, 0, y + h / n);
    grad.addColorStop(0, '#a8a8a8');
    grad.addColorStop(0.85, '#7c7c7c');
    grad.addColorStop(1, '#303030');
    g.fillStyle = grad;
    g.fillRect(0, y, w, h / n);
  }
  for (let i = 0; i < 900; i++) {
    const v = 70 + texRand() * 60;
    g.fillStyle = `rgba(${v},${v},${v},0.25)`;
    g.fillRect(texRand() * w, texRand() * h, 10 + texRand() * 50, 1);
  }
});

// Clay pantiles: rounded tiles in rows, a deep shadow under each row
const TILE_BUMP = canvasTexture(256, 256, (g, w, h) => {
  const rows = 8;
  const tile = 32;
  for (let r = 0; r < rows; r++) {
    const y = (r * h) / rows;
    for (let x = (r % 2) * (tile / 2) - tile; x < w; x += tile) {
      const grad = g.createLinearGradient(x, 0, x + tile, 0);
      grad.addColorStop(0, '#404040');
      grad.addColorStop(0.45, '#d0d0d0');
      grad.addColorStop(1, '#4a4a4a');
      g.fillStyle = grad;
      g.fillRect(x, y, tile, h / rows);
    }
    g.fillStyle = '#101010';
    g.fillRect(0, y + h / rows - 4, w, 4);
  }
});

// Bricks raised above recessed mortar, each with a slightly uneven face
const BRICK_BUMP = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#2a2a2a';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    for (let x = ((y / 16) % 2) * 24 - 48; x < w; x += 48) {
      const v = 150 + texRand() * 60;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x + 1.5, y + 1.5, 45, 13);
    }
  }
});

// Long wood grain for trim, doors, the gallery and sail frames
const GRAIN_BUMP = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const v = 50 + texRand() * 140;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(texRand() * w, texRand() * h, 30 + texRand() * 120, 1 + texRand() * 1.5);
  }
});

// Leaf clusters: overlapping bright and dark leaf blobs
const LEAF_BUMP = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#606060';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = 40 + texRand() * 200;
    g.fillStyle = `rgba(${v},${v},${v},0.7)`;
    g.beginPath();
    g.ellipse(texRand() * w, texRand() * h, 3 + texRand() * 6, 2 + texRand() * 3, texRand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
});

// Bark: deep vertical fissures
const BARK_BUMP = canvasTexture(128, 256, (g, w, h) => {
  g.fillStyle = '#909090';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(20,20,20,${0.3 + texRand() * 0.5})`;
    g.fillRect(texRand() * w, texRand() * h, 1 + texRand() * 3, 20 + texRand() * 90);
  }
});

// ================================================================== SKY (golden hour)
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(300, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: U.time,
      uZenith: { value: new THREE.Color(SKY.zenith) },
      uMid: { value: new THREE.Color(SKY.mid) },
      uHorizon: { value: new THREE.Color(SKY.horizon) },
      uSunColor: { value: new THREE.Color(SKY.sun) },
      uHalo: { value: new THREE.Color(SKY.halo) },
      uSunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uZenith, uMid, uHorizon, uSunColor, uHalo, uSunDir;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float s = max(dot(d, uSunDir), 0.0);
        vec3 horizon = mix(uHorizon, uHalo, pow(s, 3.0) * 0.7);   // warmer toward the sun
        vec3 col = mix(horizon, uMid, smoothstep(0.0, 0.3, h));
        col = mix(col, uZenith, smoothstep(0.25, 0.9, h));
        col = mix(col, horizon, smoothstep(0.0, -0.05, h));
        col += uSunColor * (pow(s, 900.0) * 9.0 + pow(s, 40.0) * 0.8 + pow(s, 6.0) * 0.25);
        vec2 cp = d.xz / max(h + 0.1, 0.05) * 0.9 + vec2(uTime * 0.008, 0.0);
        float c = fbm(cp * 0.75);
        float c2 = fbm(cp * 2.1 + 3.0);
        float cover = smoothstep(0.5, 0.76, c * 0.72 + c2 * 0.38);
        cover *= smoothstep(0.015, 0.1, h) * (1.0 - smoothstep(0.55, 0.9, h));
        float lit = smoothstep(0.35, 0.85, c2);
        vec3 cloud = mix(vec3(0.62, 0.62, 0.74), vec3(1.08, 0.98, 0.9), lit);
        cloud += uHalo * pow(s, 4.0) * 0.9 * (0.4 + lit);              // sun-gilded edges
        col = mix(col, cloud, cover * 0.88);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
));

// ================================================================== LIGHTS + SHADOWS
scene.add(new THREE.HemisphereLight('#a9c4ea', '#5c4a38', 1.0));
// Soft bounce light from the camera side, so the backlit house fronts keep their colour
const bounce = new THREE.DirectionalLight('#ffe6cc', 0.9);
bounce.position.set(4, 6, 20);
scene.add(bounce);
const sun = new THREE.DirectionalLight('#ffd3a0', 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

// Fit the shadow camera tightly around the field and village, from the sun's point of view
function fitShadow() {
  sun.target.position.copy(SUN_TARGET);
  sun.position.copy(SUN_TARGET).addScaledVector(SUN_DIR, 140);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorld.clone().invert();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [-30, 30]) for (const y of [-1, 11]) for (const z of [11, -70]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
    min.min(p);
    max.max(p);
  }
  Object.assign(cam, { left: min.x, right: max.x, bottom: min.y, top: max.y, near: -max.z - 5, far: -min.z + 5 });
  cam.updateProjectionMatrix();
}
fitShadow();

// ================================================================== GROUND
// MeshStandardMaterial (so it receives the sun's shadows) with the beds painted
// in by the shader: leaves and colour flecks up close, ribbons of colour far away.
function buildGround() {
  const geo = new THREE.PlaneGeometry(260, 170, 130, 85);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -50);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundY(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uBeds: { value: BED_COLORS },
      uPitch: { value: FIELD.bedPitch },
      uFieldEnd: { value: 50 },
      uLeaf: { value: new THREE.Color('#3f6a33') },
      uPath: { value: new THREE.Color('#5a4631') },
      uGrass: { value: new THREE.Color('#6f9f45') },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldP = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP;
        uniform vec3 uBeds[${BED_COLORS.length}];
        uniform float uPitch, uFieldEnd;
        uniform vec3 uLeaf, uPath, uGrass;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dist = length(vViewPosition);
        float n = fbm(vWorldP.xz * vec2(2.0, 1.2));
        float row = vWorldP.x - sin(vWorldP.z * 0.035) * 2.2 + (fbm(vWorldP.xz * 0.7) - 0.5) * 0.9;
        float idx = floor(row / uPitch);
        vec3 bed = uBeds[int(mod(idx, ${BED_COLORS.length}.0))];
        float inBed = fract(row / uPitch);
        float path = smoothstep(0.76, 0.82, inBed) * (1.0 - smoothstep(0.96, 1.0, inBed));
        vec3 col = mix(uLeaf, bed * 0.8, smoothstep(0.4, 0.62, n) * 0.85);
        col = mix(col, bed * (0.8 + 0.35 * n), smoothstep(6.0, 24.0, dist));
        col = mix(col, uPath * (0.8 + 0.4 * n), path * (1.0 - smoothstep(30.0, 70.0, dist) * 0.6));
        float halfW = 7.6 + max(0.0, 8.0 - vWorldP.z) * 0.24;        // where the planted field ends
        if (-vWorldP.z > uFieldEnd || vWorldP.z > 10.0 || abs(vWorldP.x) > halfW) {
          col = uGrass * (0.78 + 0.35 * n);
          col = mix(col, col * 0.82, smoothstep(0.55, 0.75, fbm(vWorldP.xz * 0.35)));
        }
        diffuseColor.rgb = col;`);
  };
  mat.customProgramCacheKey = () => 'ground-beds';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
const groundMesh = buildGround();

// ================================================================== TULIP GEOMETRY
// Smooth bezier petals: the radius and width of each petal follow cubic
// curves, so the cup swells, narrows at the lip and curls out at the edges.
// uv drives the vein bump map; aPetal drives the petal colouring shader.
const STEM_H = 0.5;
const bez = (t, a, b, c, d) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};

function gridIndex(segU, segV) {
  const idx = [];
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i;
      const b = a + segU + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return idx;
}

function petalGeometry({ H, W, rBase, rMax, flare, ruffle, segU, segV }) {
  const pos = [];
  const col = [];
  const uv = [];
  const pet = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const r = bez(v, rBase, rMax * 1.3, rMax * 1.08, rMax * 0.84) + flare * v ** 4;
    const w = W * Math.max(bez(v, 0.32, 1.25, 1.1, 0.0), 0);
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * 2 - 1;
      let rr = r + flare * 0.8 * u * u * v * v;
      rr += ruffle * Math.sin(u * 9 + v * 5) * u * u * v ** 3;
      rr -= rMax * 0.04 * (1 - u * u) * Math.sin(Math.PI * v);
      const theta = (u * w) / Math.max(r, 0.004);
      pos.push(rr * Math.sin(theta), v * H, rr * Math.cos(theta));
      uv.push((u + 1) / 2, v);
      pet.push(u, v);
      const s = 0.35 + 0.85 * THREE.MathUtils.smoothstep(v, 0, 1);
      col.push(s, s, s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPetal', new THREE.Float32BufferAttribute(pet, 2));
  g.setIndex(gridIndex(segU, segV));
  g.computeVertexNormals();
  return g;
}

function leafGeometry({ length, width, lean, segU, segV }) {
  const pos = [];
  const col = [];
  const dark = new THREE.Color('#2a5a3a');
  const light = new THREE.Color('#6fae74');
  const c = new THREE.Color();
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const sx = v * lean;
    const sy = v * length - v * v * length * 0.32;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(v * 1.05, 1)), 0.7);
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * 2 - 1;
      const fold = Math.abs(u) * w * 0.5;
      pos.push(sx + fold * 0.4, sy + fold, u * w);
      c.copy(dark).lerp(light, 0.3 + 0.7 * (1 - Math.abs(u)) * v);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(gridIndex(segU, segV));
  g.computeVertexNormals();
  return g;
}

function paint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Flattens tulip parts into one non-indexed geometry with aPart, aPetal and uv
function mergeTulip(parts) {
  const out = { position: [], normal: [], color: [], uv: [], aPetal: [], aPart: [] };
  parts.forEach(({ geo, flower }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const a = g.attributes;
    for (let i = 0; i < a.position.count; i++) {
      out.position.push(a.position.getX(i), a.position.getY(i), a.position.getZ(i));
      out.normal.push(a.normal.getX(i), a.normal.getY(i), a.normal.getZ(i));
      out.color.push(a.color.getX(i), a.color.getY(i), a.color.getZ(i));
      out.uv.push(a.uv ? a.uv.getX(i) : 0, a.uv ? a.uv.getY(i) : 0);
      out.aPetal.push(a.aPetal ? a.aPetal.getX(i) : 0, a.aPetal ? a.aPetal.getY(i) : 0);
      out.aPart.push(flower ? 1 : 0);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.color, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setAttribute('aPetal', new THREE.Float32BufferAttribute(out.aPetal, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(out.aPart, 1));
  return g;
}

function bloomParts(segU, segV) {
  const parts = [];
  for (let k = 0; k < 6; k++) {
    const inner = k % 2 === 1;
    const g = petalGeometry(inner
      ? { H: 0.22, W: 0.062, rBase: 0.008, rMax: 0.05, flare: 0.012, ruffle: 0.003, segU, segV }
      : { H: 0.24, W: 0.072, rBase: 0.01, rMax: 0.06, flare: 0.024, ruffle: 0.004, segU, segV });
    g.rotateX(inner ? 0.03 : 0.1);
    g.rotateY((k / 6) * Math.PI * 2);
    g.translate(0, STEM_H - 0.01, 0);
    parts.push({ geo: g, flower: true });
  }
  return parts;
}

const STEM_GREEN = new THREE.Color('#3f7a4e');
const stemTube = (radial) => paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.012, STEM_H * 0.5, 0.006), new THREE.Vector3(0, STEM_H, 0),
]), 4, 0.0075, radial), STEM_GREEN);

// A smooth cup from a CylinderGeometry, reshaped along a bezier profile with three tips
function cupGeometry(radial, rows) {
  const cup = new THREE.CylinderGeometry(1, 1, 1, radial, rows, true);
  const p = cup.attributes.position;
  const shade = [];
  const pet = [];
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;                               // 0 base … 1 lip
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const r = bez(t, 0.012, 0.075, 0.066, 0.05);
    const tip = t > 0.95 ? 0.045 * Math.max(Math.cos(a * 3), 0) ** 2 : 0;
    p.setXYZ(i, Math.cos(a) * r, STEM_H + t * 0.23 + tip, Math.sin(a) * r);
    const s = 0.35 + 0.85 * t;
    shade.push(s, s, s);
    pet.push(Math.sin(a * 3), t);
  }
  cup.setAttribute('color', new THREE.Float32BufferAttribute(shade, 3));
  cup.setAttribute('aPetal', new THREE.Float32BufferAttribute(pet, 2));
  cup.computeVertexNormals();
  return cup;
}

const TULIP_GEO = {
  near: mergeTulip([
    ...bloomParts(6, 10),
    { geo: stemTube(6), flower: false },
    { geo: leafGeometry({ length: 0.34, width: 0.036, lean: 0.12, segU: 2, segV: 6 }), flower: false },
    { geo: leafGeometry({ length: 0.27, width: 0.032, lean: 0.1, segU: 2, segV: 6 }).rotateY(2.6), flower: false },
  ]),
  mid: mergeTulip([
    ...bloomParts(3, 5),
    { geo: stemTube(4), flower: false },
    { geo: leafGeometry({ length: 0.3, width: 0.034, lean: 0.11, segU: 1, segV: 3 }), flower: false },
  ]),
  far: mergeTulip([
    { geo: cupGeometry(10, 3), flower: true },
    { geo: paint(new THREE.PlaneGeometry(0.014, STEM_H).translate(0, STEM_H / 2, 0), STEM_GREEN), flower: false },
  ]),
  // shadow-only stand-in: just enough shape to cast a tulip's shadow
  shadow: mergeTulip([
    { geo: cupGeometry(5, 1), flower: true },
    { geo: paint(new THREE.PlaneGeometry(0.02, STEM_H).translate(0, STEM_H / 2, 0), STEM_GREEN), flower: false },
  ]),
};

// ================================================================== TULIP SHADERS
// The wind, shared by the colour materials and the shadow depth material, so
// shadows sway with their flowers. Tops sway, roots stay put. Big swells roll
// across the field like waves on the sea, with each flower's own rocking on top.
const WIND_GLSL = /* glsl */`
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float h = clamp(position.y / 0.74, 0.0, 1.0);
  float bend = h * h;
  float phase = dot(ip.xz, vec2(0.7, 0.4));
  float swell = sin(dot(ip.xz, vec2(0.26, 0.34)) - uTime * 1.25) * 0.5 + 0.5;          // rolling waves
  float swell2 = sin(dot(ip.xz, vec2(-0.17, 0.42)) * 0.8 - uTime * 0.85) * 0.5 + 0.5;
  float lean = (0.25 + 0.75 * swell) * (0.55 + 0.45 * swell2) * (0.8 + 1.1 * uGust);
  vec2 windDir = vec2(0.55, 0.83);
  vec2 sway = windDir * lean
    + vec2(sin(uTime * 1.3 + phase) * 0.35 + sin(uTime * 2.9 + phase * 1.7) * 0.12,
           cos(uTime * 1.05 + phase * 1.3) * 0.3);
  vec2 windOff = sway * 0.06 * bend;
  float windDip = dot(windOff, windOff) * 1.6;
  windOff += aPart * vec2(sin(uTime * 6.0 + phase * 3.0 + position.y * 40.0),
                           cos(uTime * 5.3 + phase * 2.0)) * 0.0025 * (1.0 + uGust * 2.0);
  transformed.xz *= 1.0 + aPart * 0.04 * sin(uTime * 0.8 + phase * 2.0) * smoothstep(0.5, 0.74, position.y);`;

const WIND_PROJECT = /* glsl */`
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition.xz += windOff;      // world space: the whole field leans together
  mvPosition.y -= windDip;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`;

const TRANSMISSION = !LOW_POWER;

// near: MeshPhysicalMaterial, transmission + thickness (sunlight bleeds through
//       the thin petals), sheen, vein bump map
// mid:  MeshStandardMaterial with the same bump map and colouring
// far:  MeshStandardMaterial, colouring only
function tulipMaterial(kind, transmission = TRANSMISSION) {
  const mat = kind === 'near'
    ? new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0, side: THREE.DoubleSide,
      transmission: transmission ? 0.32 : 0, thickness: 0.12, ior: 1.34,
      attenuationColor: new THREE.Color('#ff9fd0'), attenuationDistance: 0.3,
      sheen: 1, sheenColor: new THREE.Color('#ffd0f0'), sheenRoughness: 0.5,
      bumpMap: PETAL_BUMP, bumpScale: 1.6,
    })
    : new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
      bumpMap: kind === 'mid' ? PETAL_BUMP : null, bumpScale: 1.2,
    });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: U.time,
      uGust: U.gust,
      uRipplePos: U.ripplePos,
      uRippleTime: U.rippleTime,
      uSunView: U.sunView,
      uRimColor: { value: new THREE.Color('#ffb0d8') },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart;
        attribute vec2 aPetal;
        varying float vPart;
        varying float vRing;
        varying float vSeed;
        varying vec2 vPetal;
        uniform float uTime, uGust, uRippleTime;
        uniform vec3 uRipplePos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${WIND_GLSL}
        vSeed = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vPetal = aPetal;
        float age = uTime - uRippleTime;
        float rd = distance(ip.xz, uRipplePos.xz);
        float ring = age > 0.0 ? exp(-pow((rd - age * 5.0) * 1.1, 2.0)) * exp(-age * 0.55) : 0.0;
        transformed.xz *= 1.0 + ring * 0.7 * aPart;
        transformed.y += ring * 0.1 * bend;
        vRing = ring;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor = mix(color, instanceColor * color, aPart);
        #endif
        vPart = aPart;`)
      .replace('#include <project_vertex>', WIND_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vPart;
        varying float vRing;
        varying float vSeed;
        varying vec2 vPetal;
        uniform vec3 uSunView, uRimColor;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pu = vPetal.x;
        float pv = vPetal.y;
        float detailVein = 0.0;
        if (vPart > 0.5) {
          float n = fbm(vec2(pu * 2.6 + vSeed * 17.0, pv * 4.2));
          float fan = pu * (0.5 + 0.5 * pv);
          float lines = abs(sin(fan * 30.0 + n * 3.2 + vnoise(vec2(pu * 9.0, pv * 2.0)) * 1.5));
          float strength = vnoise(vec2(pu * 14.0 + vSeed * 9.0, 0.5)) * 0.7 + 0.3;
          detailVein = (1.0 - smoothstep(0.0, 0.14, lines)) * strength
            * smoothstep(0.04, 0.3, pv) * (1.0 - smoothstep(0.55, 0.95, pv));
          float rib = (1.0 - smoothstep(0.0, 0.07, abs(pu))) * smoothstep(0.05, 0.5, pv) * (1.0 - smoothstep(0.82, 1.0, pv));
          vec3 col = diffuseColor.rgb;
          col *= 0.84 + 0.32 * n;
          col = mix(col, col * 1.4 + vec3(0.04, 0.0, 0.06), detailVein * 0.3);
          col = mix(col, col * 1.35, rib * 0.4);
          // a darker blotch at the base and pale, sun-bleached edges, in each flower's own hue
          float flame = 1.0 - smoothstep(0.0, 0.34, pv + (n - 0.5) * 0.2);
          col = mix(col, col * 0.3, flame * 0.75);
          vec3 pale = mix(col, vec3(1.0, 0.97, 0.94), 0.5);
          float edge = smoothstep(0.7, 1.0, abs(pu)) * smoothstep(0.25, 0.95, pv);
          col = mix(col, pale, edge * 0.5);
          col = mix(col, pale, smoothstep(0.8, 1.0, pv) * 0.35);
          diffuseColor.rgb = col;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 Vd = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(normal, Vd)), 2.4);
        float back = pow(max(dot(Vd, -uSunView), 0.0), 2.5);     // looking toward the low sun
        vec3 petal = diffuseColor.rgb;
        totalEmissiveRadiance += vPart * (
          petal * 0.16 * (1.0 - pv)
          + mix(uRimColor, petal * 1.4, 0.65) * fres * 0.16    // rim light in the flower's own colour
          + petal * back * (0.25 + 0.9 * fres) * vec3(1.15, 0.95, 0.85)   // golden light through the edges
          + petal * vRing * 1.6 + vec3(1.0, 0.85, 0.95) * vRing * 0.35);
        totalEmissiveRadiance += vec3(0.75, 0.9, 0.5) * fres * back * (1.0 - vPart) * 0.15;`);
  };
  mat.customProgramCacheKey = () => `tulip-${kind}-${mat.transmission > 0 ? 't' : 'o'}`;
  return mat;
}
const tulipMats = { near: tulipMaterial('near'), mid: tulipMaterial('mid'), far: tulipMaterial('far') };

// Depth material for the shadow stand-ins: same wind, so the shadows sway too
const windDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
windDepth.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = U.time;
  shader.uniforms.uGust = U.gust;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aPart;\nuniform float uTime, uGust;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_GLSL}`)
    .replace('#include <project_vertex>', WIND_PROJECT);
};
windDepth.customProgramCacheKey = () => 'tulip-shadow-depth';
const hiddenMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// ================================================================== TULIP FIELD
// Wild and dense: positions are scattered with heavy jitter rather than set in
// rows. The beds still give the field its colour bands, but their edges wander,
// strays grow in the paths, and every bed mixes a few shades.
const fieldRand = mulberry32(42);
const rnd = (a, b) => a + (b - a) * fieldRand();
const wobble = (x, z) => Math.sin(x * 0.7 + z * 0.4) * 0.5 + Math.sin(x * 1.9 - z * 1.3) * 0.25 + Math.sin(z * 2.7 + x * 0.3) * 0.15;

const chunks = [];
function buildField() {
  const cells = new Map();
  for (let z = FIELD.start; z > FIELD.end;) {
    const d = Math.max(0, SHOTS.menu.z - z);
    const s = FIELD.spacing * (1 + d * 0.06);
    const half = 7 + d * 0.24;
    for (let x = -half; x < half; x += s * 0.92) {
      const jx = x + rnd(-0.75, 0.75) * s;
      const jz = z + rnd(-0.85, 0.85) * s;
      const row = jx - curveX(jz) + wobble(jx, jz) * 0.45;
      const bed = Math.floor(row / FIELD.bedPitch);
      const inBed = row / FIELD.bedPitch - bed;
      if (inBed > 0.8 && fieldRand() < 0.85) continue;       // the paths between beds (a few strays grow there)
      if (wobble(jx * 1.7, jz * 1.7) > 0.72 && fieldRand() < 0.6) continue;   // natural thin patches
      const cellSize = jz > -8 ? 3 : 6;
      const key = `${Math.floor(jx / cellSize)}:${Math.floor(jz / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([jx, jz, bed]);
    }
    z -= s * 0.92;
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const whites = PALETTE.white.map((h) => new THREE.Color(h));

  cells.forEach((list) => {
    const n = list.length;
    const matrices = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    const colors = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const center = new THREE.Vector3();
    list.forEach(([x, z, bed], i) => {
      const shades = PALETTE[BEDS[((bed % BEDS.length) + BEDS.length) % BEDS.length]];
      const roll = fieldRand();
      if (roll < 0.03) c.copy(whites[(fieldRand() * whites.length) | 0]);          // a striking white
      else if (roll < 0.09) c.copy(ALL_COLORS[(fieldRand() * ALL_COLORS.length) | 0]);   // a stray from another bed
      else c.set(shades[(fieldRand() * shades.length) | 0]);
      c.offsetHSL(rnd(-0.012, 0.012), rnd(-0.06, 0.03), rnd(-0.05, 0.05));
      colors.setXYZ(i, c.r, c.g, c.b);
      const s = rnd(0.8, 1.18);
      e.set(rnd(-0.12, 0.12), rnd(0, Math.PI * 2), rnd(-0.12, 0.12));
      m.compose(v.set(x, groundY(x, z) - 0.02, z), q.setFromEuler(e), sc.set(s, s * rnd(0.85, 1.2), s));
      m.toArray(matrices.array, i * 16);
      center.x += x / n;
      center.z += z / n;
    });
    center.y = groundY(center.x, center.z) + 0.4;
    const nearOK = center.z > -16;                           // close enough to ever be seen up close
    const farOK = center.z < 2;
    const make = (geo, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.instanceMatrix = matrices;
      mesh.instanceColor = colors;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 0.6;                     // room for the wind sway
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };
    const chunk = {
      center,
      near: nearOK ? make(TULIP_GEO.near, tulipMats.near) : null,
      mid: make(TULIP_GEO.mid, tulipMats.mid),
      far: farOK ? make(TULIP_GEO.far, tulipMats.far) : null,
    };
    // The shadow stand-in: casts the chunk's shadows; in the main view its material
    // writes neither colour nor depth, so it costs a few vertices and no pixels
    const shadow = make(TULIP_GEO.shadow, hiddenMat);
    shadow.receiveShadow = false;
    shadow.castShadow = true;
    shadow.customDepthMaterial = windDepth;
    chunks.push(chunk);
  });
}
buildField();

// Each chunk shows exactly one level of detail, picked by distance to the camera
function updateLods() {
  chunks.forEach((ch) => {
    const d = camera.position.distanceTo(ch.center);
    let level = d < FIELD.lodNear ? 'near' : d < FIELD.lodMid ? 'mid' : 'far';
    if (!ch[level]) level = ch.mid ? 'mid' : 'far';
    if (ch.near) ch.near.visible = level === 'near';
    ch.mid.visible = level === 'mid';
    if (ch.far) ch.far.visible = level === 'far';
  });
}

// ================================================================== VILLAGE MATERIALS
// Colour maps are painted textures; every surface also gets a bump map
// (planks, tiles, bricks, grain, leaves, bark) and a noise roughness map so
// light breaks up across it like weathered wood, clay and foliage.
function clapboard(color) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const n = 6;
    for (let k = 0; k < n; k++) {
      const y = (k * h) / n;
      const grad = g.createLinearGradient(0, y, 0, y + h / n);
      grad.addColorStop(0, 'rgba(255,255,255,0.12)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = grad;
      g.fillRect(0, y, w, h / n);
    }
    for (let i = 0; i < 700; i++) {                         // weathering: grain, scuffs, faded patches
      g.fillStyle = texRand() < 0.5 ? `rgba(0,0,0,${texRand() * 0.07})` : `rgba(255,255,255,${texRand() * 0.05})`;
      g.fillRect(texRand() * w, texRand() * h, 8 + texRand() * 40, 1 + texRand() * 2);
    }
  }, { srgb: true });
}

function roofTiles(color) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const rows = 8;
    const tile = 32;
    const base = new THREE.Color(color);
    for (let r = 0; r < rows; r++) {
      const y = (r * h) / rows;
      for (let x = (r % 2) * (tile / 2) - tile; x < w; x += tile) {
        const c = base.clone().offsetHSL(0, (texRand() - 0.5) * 0.1, (texRand() - 0.5) * 0.1);
        if (texRand() < 0.15) c.lerp(new THREE.Color('#5c6b3a'), 0.35);   // a little moss
        const grad = g.createLinearGradient(x, 0, x + tile, 0);
        grad.addColorStop(0, `#${c.clone().multiplyScalar(0.7).getHexString()}`);
        grad.addColorStop(0.4, `#${c.clone().multiplyScalar(1.15).getHexString()}`);
        grad.addColorStop(1, `#${c.clone().multiplyScalar(0.75).getHexString()}`);
        g.fillStyle = grad;
        g.fillRect(x + 1, y, tile - 2, h / rows);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + h / rows - 4, w, 4);
    }
  }, { srgb: true });
}

function bricks(color) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b8ad9f';
    g.fillRect(0, 0, w, h);
    const base = new THREE.Color(color);
    for (let y = 0; y < h; y += 16) {
      for (let x = ((y / 16) % 2) * 24 - 48; x < w; x += 48) {
        g.fillStyle = `#${base.clone().offsetHSL(0, 0, (texRand() - 0.5) * 0.14).getHexString()}`;
        g.fillRect(x + 1.5, y + 1.5, 45, 13);
      }
    }
  }, { srgb: true });
}

const windowTex = canvasTexture(128, 160, (g, w, h) => {
  g.fillStyle = '#f2eee4';
  g.fillRect(0, 0, w, h);
  const glass = g.createLinearGradient(0, 0, w, h);          // the warm sky reflected in old glass
  glass.addColorStop(0, '#ffd9b0');
  glass.addColorStop(0.4, '#6f88a8');
  glass.addColorStop(1, '#1d2a3d');
  const m = 12;
  const pw = (w - m * 3) / 2;
  const ph = (h - m * 4) / 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      g.fillStyle = glass;
      g.fillRect(m + c * (pw + m), m + r * (ph + m), pw, ph);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(m + c * (pw + m) + 4, m + r * (ph + m) + 4, pw * 0.3, 3);
    }
  }
}, { srgb: true, repeat: false });

const doorTex = canvasTexture(96, 192, (g, w, h) => {
  g.fillStyle = '#f2eee4';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f4f3a';
  g.fillRect(8, 8, w - 16, h - 8);
  for (let x = 8; x < w - 8; x += 14) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, 8, 2, h - 8);
  }
  g.fillStyle = '#d9b45a';
  g.fillRect(w - 26, h * 0.55, 6, 6);
}, { srgb: true, repeat: false });

const matCache = new Map();
const cached = (key, make) => {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
};
const weathered = (opts) => new THREE.MeshStandardMaterial({ roughnessMap: ROUGHNESS_NOISE, metalness: 0, ...opts });
const wallMat = (c) => cached(`wall${c}`, () => weathered({ map: clapboard(c), bumpMap: PLANK_BUMP, bumpScale: 3, roughness: 0.92 }));
const roofMat = (c) => cached(`roof${c}`, () => weathered({ map: roofTiles(c), bumpMap: TILE_BUMP, bumpScale: 4, roughness: 0.85 }));
const brickMat = (c) => cached(`brick${c}`, () => weathered({ map: bricks(c), bumpMap: BRICK_BUMP, bumpScale: 3, roughness: 0.95 }));
const trimMat = cached('trim', () => weathered({ color: '#f2eee4', bumpMap: GRAIN_BUMP, bumpScale: 1.5, roughness: 0.7 }));
const plinthMat = cached('plinth', () => weathered({ color: '#2e2a28', bumpMap: GRAIN_BUMP, bumpScale: 2, roughness: 0.9 }));
const windowMat = cached('window', () => new THREE.MeshStandardMaterial({ map: windowTex, roughness: 0.18, metalness: 0.15 }));
const doorMat = cached('door', () => weathered({ map: doorTex, bumpMap: GRAIN_BUMP, bumpScale: 2, roughness: 0.75 }));
const woodMat = cached('wood', () => weathered({ color: '#6b4a32', bumpMap: GRAIN_BUMP, bumpScale: 2.5, roughness: 0.85 }));
const treeMat = cached('tree', () => weathered({ vertexColors: true, bumpMap: LEAF_BUMP, bumpScale: 4, roughness: 0.95 }));
const barkMat = cached('bark', () => weathered({ color: '#5a4232', bumpMap: BARK_BUMP, bumpScale: 4, roughness: 1 }));

// ================================================================== VILLAGE BUILDERS
// Everything is collected per material and merged: a handful of draw calls.
const buckets = new Map();
function collect(geo, material, matrix) {
  let g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(matrix);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (material.vertexColors && !g.attributes.color) g = paint(g, new THREE.Color('#ffffff'));
  if (!buckets.has(material)) buckets.set(material, []);
  buckets.get(material).push(g);
}

// Box-style UVs in world units, so planks, tiles and leaves are the same size everywhere
function worldUV(geo, scale = 1) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) * scale, p.getZ(i) * scale);
    else if (ax >= az) uv.setXY(i, p.getZ(i) * scale, p.getY(i) * scale);
    else uv.setXY(i, p.getX(i) * scale, p.getY(i) * scale);
  }
  return geo;
}

const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S1 = new THREE.Vector3(1, 1, 1);
const local = (x, y, z, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.clone().setFromEuler(E.set(rx, ry, rz)), S1);

function house({ x, z, w, d, h, wall, roof, rot = 0, chimney = true }) {
  const roofH = w * 0.62;
  const ov = 0.28;
  const base = new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(x, z) - 0.05, z), Q.clone().setFromEuler(E.set(0, rot, 0)), S1);
  const put = (geo, mat, m) => collect(geo, mat, base.clone().multiply(m));

  put(worldUV(new THREE.BoxGeometry(w + 0.12, 0.3, d + 0.12)), plinthMat, local(0, 0.15, 0));
  put(worldUV(new THREE.BoxGeometry(w, h, d)), wallMat(wall), local(0, h / 2 + 0.05, 0));
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, roofH)]);
  put(new THREE.ShapeGeometry(tri), wallMat(wall), local(0, h + 0.05, d / 2));
  put(new THREE.ShapeGeometry(tri), wallMat(wall), local(0, h + 0.05, -d / 2, 0, Math.PI, 0));

  const angle = Math.atan2(roofH, w / 2);
  const slope = Math.hypot(w / 2, roofH) + ov;
  [-1, 1].forEach((side) => {
    const slab = new THREE.BoxGeometry(slope, 0.1, d + ov * 2);
    const uv = slab.attributes.uv;
    const sp = slab.attributes.position;
    for (let i = 0; i < sp.count; i++) uv.setXY(i, sp.getZ(i), sp.getX(i) * 1.4);
    const cx = side * (w / 4 + Math.cos(angle) * ov * 0.25);
    const cy = h + 0.05 + roofH / 2 - Math.sin(angle) * ov * 0.5 + 0.06;
    put(slab, roofMat(roof), local(cx, cy, 0, 0, 0, -side * angle));
    put(worldUV(new THREE.BoxGeometry(slope, 0.16, 0.07), 2), trimMat, local(cx, cy - 0.02, d / 2 + ov - 0.02, 0, 0, -side * angle));
  });
  put(worldUV(new THREE.BoxGeometry(0.18, 0.14, d + ov * 2 + 0.05), 2), trimMat, local(0, h + 0.05 + roofH + 0.08, 0));
  [-1, 1].forEach((side) => put(worldUV(new THREE.BoxGeometry(0.1, h, 0.1), 2), trimMat, local(side * (w / 2), h / 2 + 0.05, d / 2 + 0.01)));
  put(worldUV(new THREE.BoxGeometry(w + 0.08, 0.1, 0.08), 2), trimMat, local(0, h + 0.05, d / 2 + 0.02));

  const winW = 0.55;
  const winH = 0.75;
  const n = w > 3 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const wx = (k - (n - 1) / 2) * (w / n);
    if (k === n - 1 && n === 3) put(new THREE.PlaneGeometry(0.7, 1.35), doorMat, local(wx, 0.975, d / 2 + 0.02));
    else put(new THREE.PlaneGeometry(winW, winH), windowMat, local(wx, h * 0.52 + 0.05, d / 2 + 0.02));
  }
  put(new THREE.PlaneGeometry(0.42, 0.55), windowMat, local(0, h + roofH * 0.32, d / 2 + 0.02));
  [-1, 1].forEach((side) => {
    for (let k = 0; k < 2; k++) {
      put(new THREE.PlaneGeometry(winW, winH), windowMat, local(side * (w / 2 + 0.02), h * 0.52 + 0.05, (k - 0.5) * d * 0.5, 0, side * Math.PI / 2, 0));
    }
  });
  if (chimney) {
    put(worldUV(new THREE.BoxGeometry(0.4, 1.1, 0.4), 2), brickMat('#9a4a36'), local(w * 0.18, h + roofH * 0.62, -d * 0.2));
    put(worldUV(new THREE.BoxGeometry(0.5, 0.08, 0.5), 2), plinthMat, local(w * 0.18, h + roofH * 0.62 + 0.58, -d * 0.2));
  }
}

// Leafy trees: noisy, welded spheres (smooth shading) with light tops and shaded
// undersides, box-mapped UVs so the leaf bump map wraps around them
const treeRand = mulberry32(17);
function canopy(r, color, sy = 1) {
  const ico = new THREE.IcosahedronGeometry(r, 3);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  const p = g.attributes.position;
  const cols = [];
  const base = new THREE.Color(color);
  const c = new THREE.Color();
  const seed = treeRand() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / r;
    const y = p.getY(i) / r;
    const z = p.getZ(i) / r;
    const k = 1 + 0.17 * (Math.sin(3.1 * x + 1.7 * y + seed) + Math.sin(2.3 * z + 3.7 * x) + Math.sin(4.1 * y + 2.2 * z + seed)) / 3
      + 0.05 * Math.sin(11 * x + 7 * z + seed);                  // smaller leaf clumps on the surface
    p.setXYZ(i, x * r * k, y * r * k * sy, z * r * k);
    c.copy(base).multiplyScalar(0.55 + 0.6 * (y * 0.5 + 0.5)).offsetHSL((treeRand() - 0.5) * 0.02, 0, (treeRand() - 0.5) * 0.06);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return worldUV(g, 1.6);
}

function tree({ x, z, kind, s }) {
  const base = new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(x, z) - 0.05, z), Q.clone().setFromEuler(E.set(0, treeRand() * 6, 0)), new THREE.Vector3(s, s, s));
  const trunk = new THREE.CylinderGeometry(0.1, 0.18, 2.0, 8);
  const tuv = trunk.attributes.uv;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * 2);
  collect(trunk, barkMat, base.clone().multiply(local(0, 1.0, 0)));
  const blobs = {
    round: [['#4f8a3a', 1.1, 0, 2.5, 0], ['#5a9640', 0.85, -0.75, 2.1, 0.2], ['#4a8236', 0.85, 0.75, 2.2, -0.2], ['#68a64a', 0.75, 0.1, 3.1, 0.1], ['#4f8a3a', 0.7, 0, 2.0, 0.65]],
    poplar: [['#3f7a34', 0.55, 0, 1.9, 0, 1.9], ['#4a8a3c', 0.5, 0, 3.0, 0, 2.0], ['#3a7031', 0.4, 0, 4.0, 0, 1.8]],
    willow: [['#a7c14a', 1.25, 0, 2.4, 0, 0.9], ['#97b443', 0.85, -0.95, 1.7, 0.2, 1.3], ['#a2bd48', 0.85, 0.95, 1.75, -0.2, 1.3], ['#b3cb55', 0.7, 0.1, 3.1, 0, 0.9]],
    blossom: [['#f2a7c9', 1.0, 0, 2.4, 0], ['#f7c3db', 0.8, -0.7, 2.1, 0.2], ['#ee98bf', 0.8, 0.7, 2.2, -0.2], ['#fbd6e6', 0.65, 0.1, 3.0, 0.1]],
  }[kind];
  blobs.forEach(([color, r, bx, by, bz, sy = 1]) => collect(canopy(r, color, sy), treeMat, base.clone().multiply(local(bx, by, bz))));
}

// The windmill: brick base, gallery with railing, green clapboard smock body,
// boat-shaped cap, lattice sails with red and white cloth
const windmillSails = new THREE.Group();
function windmill({ x, z }) {
  const gy = groundY(x, z) - 0.05;
  const base = new THREE.Matrix4().makeTranslation(x, gy, z);
  const put = (geo, mat, m) => collect(geo, mat, base.clone().multiply(m));
  const scaleUV = (geo, su, sv) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return geo;
  };
  put(scaleUV(new THREE.CylinderGeometry(2.1, 2.4, 1.6, 16), 14, 3.2), brickMat('#8e4a3a'), local(0, 0.8, 0));
  put(scaleUV(new THREE.CylinderGeometry(2.95, 2.95, 0.12, 32), 6, 1), woodMat, local(0, 1.66, 0));
  put(new THREE.TorusGeometry(2.88, 0.035, 6, 48), trimMat, local(0, 2.25, 0, Math.PI / 2));
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    put(new THREE.BoxGeometry(0.05, 0.6, 0.05), trimMat, local(Math.cos(a) * 2.88, 1.95, Math.sin(a) * 2.88));
  }
  put(scaleUV(new THREE.CylinderGeometry(1.0, 1.7, 5.6, 8), 9, 5.6), wallMat('#2f6d52'), local(0, 4.4, 0));
  const tilt = Math.atan2(0.7, 5.6);
  put(new THREE.PlaneGeometry(0.42, 0.56), windowMat, local(0, 4.6, 1.33, -tilt));
  put(new THREE.PlaneGeometry(0.36, 0.48), windowMat, local(0, 6.2, 1.12, -tilt));
  put(new THREE.PlaneGeometry(0.8, 1.3), doorMat, local(0, 0.75, 2.33, -0.18));
  const cap = new THREE.CylinderGeometry(1.15, 1.15, 2.5, 24, 1, false, -Math.PI / 2, Math.PI);
  cap.rotateX(-Math.PI / 2);
  put(scaleUV(cap, 3, 2), roofMat('#3f3a36'), local(0, 7.2, 0));

  windmillSails.position.set(x, gy + 7.55, z + 1.4);
  const sailParts = new Map();
  const add = (geo, mat, m) => {
    let g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!sailParts.has(mat)) sailParts.set(mat, []);
    sailParts.get(mat).push(g);
  };
  const clothBump = noiseTexture(128, 8, 3, 77, 90, 170);
  const redCloth = cached('cloth-red', () => weathered({ color: '#b8352a', bumpMap: clothBump, bumpScale: 2, roughness: 0.9, side: THREE.DoubleSide }));
  const whiteCloth = cached('cloth-white', () => weathered({ color: '#ebe4d8', bumpMap: clothBump, bumpScale: 2, roughness: 0.9, side: THREE.DoubleSide }));
  add(new THREE.CylinderGeometry(0.32, 0.32, 0.4, 16), woodMat, local(0, 0, 0, Math.PI / 2));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const arm = (lx, ly, lz) => new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(lx, ly, lz));
    add(worldUV(new THREE.BoxGeometry(0.16, 6.9, 0.16), 2), woodMat, arm(0, 3.45, 0));
    add(worldUV(new THREE.BoxGeometry(0.06, 5.6, 0.06), 2), trimMat, arm(0.16, 3.8, 0.05));
    add(worldUV(new THREE.BoxGeometry(0.06, 5.6, 0.06), 2), trimMat, arm(1.2, 3.8, 0.05));
    for (let r = 1.0; r <= 6.6; r += 0.32) add(worldUV(new THREE.BoxGeometry(1.1, 0.045, 0.04), 2), trimMat, arm(0.68, r, 0.05));
    if (k % 2 === 0) add(new THREE.PlaneGeometry(1.0, 5.4), redCloth, arm(0.68, 3.8, -0.02));
    else add(new THREE.PlaneGeometry(1.0, 2.8), whiteCloth, arm(0.68, 5.1, -0.02));
  }
  sailParts.forEach((list, mat) => {
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    windmillSails.add(mesh);
  });
  scene.add(windmillSails);
}

const WALLS = { green: '#2f7a5a', green2: '#3a8a64', blue: '#2c5d86', cream: '#e6dcc3', dark: '#24493d' };
const ROOFS = { red: '#9a4030', orange: '#b5552f', slate: '#46505c' };
[
  { x: -5.8, z: -56, w: 3.2, d: 4.6, h: 2.2, wall: WALLS.green, roof: ROOFS.red, rot: 0.08 },
  { x: -9.8, z: -58.5, w: 2.8, d: 4.0, h: 2.6, wall: WALLS.blue, roof: ROOFS.slate, rot: -0.12 },
  { x: -2.4, z: -61, w: 2.6, d: 3.6, h: 2.0, wall: WALLS.green2, roof: ROOFS.orange, rot: 0.15 },
  { x: 5.6, z: -57, w: 3.4, d: 4.6, h: 2.3, wall: WALLS.green, roof: ROOFS.red, rot: -0.06 },
  { x: 9.4, z: -59.5, w: 2.7, d: 4.0, h: 2.7, wall: WALLS.cream, roof: ROOFS.slate, rot: 0.1 },
  { x: 12.8, z: -56.5, w: 3.0, d: 4.2, h: 2.1, wall: WALLS.blue, roof: ROOFS.orange, rot: -0.15 },
  { x: -13.6, z: -56, w: 3.1, d: 4.4, h: 2.0, wall: WALLS.green2, roof: ROOFS.red, rot: 0.2 },
  { x: 16.6, z: -60, w: 2.8, d: 4.0, h: 2.4, wall: WALLS.dark, roof: ROOFS.red, rot: -0.1 },
  { x: 0.6, z: -65, w: 3.2, d: 4.6, h: 2.4, wall: WALLS.blue, roof: ROOFS.red, rot: 0.05 },
  { x: -17.5, z: -61, w: 2.9, d: 4.0, h: 2.3, wall: WALLS.green, roof: ROOFS.slate, rot: 0.25 },
  { x: 20.5, z: -57, w: 3.0, d: 4.2, h: 2.1, wall: WALLS.green2, roof: ROOFS.orange, rot: -0.2 },
].forEach(house);
[
  { x: -7.8, z: -53.8, kind: 'round', s: 1.15 }, { x: 3.4, z: -55.2, kind: 'blossom', s: 1.0 },
  { x: 8.0, z: -54.6, kind: 'willow', s: 1.1 }, { x: -11.8, z: -61, kind: 'poplar', s: 1.3 },
  { x: 14.9, z: -59, kind: 'round', s: 1.3 }, { x: -1.0, z: -58.6, kind: 'round', s: 0.85 },
  { x: -16, z: -57.6, kind: 'willow', s: 1.2 }, { x: 19, z: -60.5, kind: 'poplar', s: 1.2 },
  { x: -4.5, z: -66, kind: 'round', s: 1.5 }, { x: 6.2, z: -64, kind: 'poplar', s: 1.4 },
  { x: 11, z: -63, kind: 'round', s: 1.4 }, { x: -21, z: -59, kind: 'round', s: 1.3 },
].forEach(tree);
windmill(WINDMILL);

// ================================================================== SWISS CHALETS (the field's flanks)
// Alpine chalets line the meadows on both sides: a white plaster ground floor,
// a dark timber upper storey, a shallow roof with deep eaves, a wooden balcony
// with geranium boxes, and shuttered windows. Spruces stand between them.
const plasterMat = cached('plaster', () => weathered({ color: '#ece6da', bumpMap: noiseTexture(128, 16, 3, 23, 80, 180), bumpScale: 2.5, roughness: 0.95 }));
const shutterMat = (c) => cached(`shutter${c}`, () => weathered({ color: c, bumpMap: GRAIN_BUMP, bumpScale: 2, roughness: 0.8 }));
const chaletRand = mulberry32(99);
const CR = (a, b) => a + (b - a) * chaletRand();

function chalet({ x, z, w, d, rot }) {
  const h1 = 1.5;                                    // plaster ground floor
  const h2 = 1.7;                                    // timber upper floor
  const roofH = w * 0.3;                             // shallow alpine pitch
  const ov = 0.8;                                    // deep eaves
  const timber = ['#6e4428', '#5f3a22', '#7a4a2a'][(chaletRand() * 3) | 0];
  const shutter = shutterMat(chaletRand() < 0.5 ? '#3e6b3a' : '#8f2d27');
  const base = new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(x, z) - 0.05, z), Q.clone().setFromEuler(E.set(0, rot, 0)), S1);
  const put = (geo, mat, m) => collect(geo, mat, base.clone().multiply(m));

  put(worldUV(new THREE.BoxGeometry(w, h1, d)), plasterMat, local(0, h1 / 2, 0));
  put(worldUV(new THREE.BoxGeometry(w + 0.06, h2, d + 0.06)), wallMat(timber), local(0, h1 + h2 / 2, 0));
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.03, 0), new THREE.Vector2(w / 2 + 0.03, 0), new THREE.Vector2(0, roofH)]);
  put(new THREE.ShapeGeometry(tri), wallMat(timber), local(0, h1 + h2, d / 2 + 0.03));
  put(new THREE.ShapeGeometry(tri), wallMat(timber), local(0, h1 + h2, -d / 2 - 0.03, 0, Math.PI, 0));

  const angle = Math.atan2(roofH, w / 2);
  const slope = Math.hypot(w / 2, roofH) + ov;
  [-1, 1].forEach((side) => {
    const slab = new THREE.BoxGeometry(slope, 0.14, d + ov * 2);
    const uv = slab.attributes.uv;
    const sp = slab.attributes.position;
    for (let i = 0; i < sp.count; i++) uv.setXY(i, sp.getZ(i), sp.getX(i) * 1.4);
    const cx = side * (w / 4 + Math.cos(angle) * ov * 0.3);
    const cy = h1 + h2 + roofH / 2 - Math.sin(angle) * ov * 0.5 + 0.08;
    put(slab, roofMat('#5b4a3e'), local(cx, cy, 0, 0, 0, -side * angle));
    put(worldUV(new THREE.BoxGeometry(slope, 0.2, 0.08), 2), woodMat, local(cx, cy - 0.03, d / 2 + ov - 0.03, 0, 0, -side * angle));
  });

  // Balcony across the front of the upper floor, with slatted railing and geraniums
  const by = h1 + 0.05;
  put(worldUV(new THREE.BoxGeometry(w + 0.5, 0.1, 0.75), 2), woodMat, local(0, by, d / 2 + 0.37));
  put(worldUV(new THREE.BoxGeometry(w + 0.5, 0.07, 0.07), 2), woodMat, local(0, by + 0.75, d / 2 + 0.72));
  for (let sx = -w / 2 - 0.2; sx <= w / 2 + 0.2; sx += 0.17) {
    put(worldUV(new THREE.BoxGeometry(0.1, 0.7, 0.03), 2), woodMat, local(sx, by + 0.4, d / 2 + 0.72));
  }
  put(worldUV(new THREE.BoxGeometry(w * 0.85, 0.16, 0.16), 2), woodMat, local(0, by + 0.86, d / 2 + 0.78));
  for (let fx = -w * 0.38; fx <= w * 0.38; fx += w * 0.12) {
    collect(canopy(0.13, chaletRand() < 0.7 ? '#d8333f' : '#ff6f8f'), treeMat, base.clone().multiply(local(fx, by + 0.98, d / 2 + 0.78)));
    collect(canopy(0.1, '#3f7a34'), treeMat, base.clone().multiply(local(fx + 0.06, by + 0.92, d / 2 + 0.86)));
  }

  // Shuttered windows on both floors, a door, a gable window
  const win = (wx, wy, ww, wh) => {
    put(new THREE.PlaneGeometry(ww, wh), windowMat, local(wx, wy, d / 2 + 0.05));
    put(worldUV(new THREE.BoxGeometry(ww * 0.5, wh, 0.03), 3), shutter, local(wx - ww * 0.78, wy, d / 2 + 0.06));
    put(worldUV(new THREE.BoxGeometry(ww * 0.5, wh, 0.03), 3), shutter, local(wx + ww * 0.78, wy, d / 2 + 0.06));
  };
  win(-w * 0.27, h1 * 0.55, 0.5, 0.65);
  put(new THREE.PlaneGeometry(0.75, 1.25), doorMat, local(w * 0.25, 0.63, d / 2 + 0.02));
  win(-w * 0.25, h1 + h2 * 0.55, 0.5, 0.65);
  win(w * 0.25, h1 + h2 * 0.55, 0.5, 0.65);
  put(new THREE.PlaneGeometry(0.4, 0.5), windowMat, local(0, h1 + h2 + roofH * 0.35, d / 2 + 0.05));
  put(worldUV(new THREE.BoxGeometry(0.45, 1.0, 0.45), 2), brickMat('#7d7268'), local(-w * 0.2, h1 + h2 + roofH * 0.7, -d * 0.15));
}

// Spruce: stacked cones, darker toward the bottom, with the leaf bump map
function spruce({ x, z, s }) {
  const base = new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(x, z) - 0.05, z), Q.clone(), new THREE.Vector3(s, s, s));
  const trunk = new THREE.CylinderGeometry(0.08, 0.14, 1.2, 7);
  collect(trunk, barkMat, base.clone().multiply(local(0, 0.6, 0)));
  const tiers = [[1.25, 1.8, 1.4], [1.0, 1.6, 2.4], [0.78, 1.4, 3.3], [0.52, 1.2, 4.1], [0.28, 0.9, 4.75]];
  tiers.forEach(([r, h, y], k) => {
    const cone = new THREE.ConeGeometry(r, h, 14, 3);
    const c = new THREE.Color('#2b4d30').offsetHSL(0, 0, 0.02 * k + (chaletRand() - 0.5) * 0.03);
    collect(worldUV(paint(cone, c), 1.6), treeMat, base.clone().multiply(local(0, y, 0, 0, chaletRand() * 6, 0)));
  });
}

[-1, 1].forEach((side) => {
  for (let z = 7; z > -44; z -= CR(6.5, 8.5)) {
    const edge = 7.6 + Math.max(0, 8 - z) * 0.24;
    const face = side < 0 ? Math.PI / 2 - 0.45 : -(Math.PI / 2 - 0.45);   // face the field, angled toward the camera
    chalet({ x: side * (edge + CR(3.4, 4.4)), z: z + CR(-1, 1), w: CR(3.4, 4.2), d: CR(3.6, 4.4), rot: face + CR(-0.2, 0.2) });
    if (chaletRand() < 0.8) {
      chalet({ x: side * (edge + CR(10, 13)), z: z - CR(2.5, 4.5), w: CR(3.4, 4.2), d: CR(3.6, 4.4), rot: face + CR(-0.25, 0.25) });
    }
    spruce({ x: side * (edge + CR(0.9, 1.8)), z: z - CR(2.5, 4.2), s: CR(0.8, 1.15) });
    if (chaletRand() < 0.6) spruce({ x: side * (edge + CR(6.5, 8.5)), z: z - CR(0, 3), s: CR(1.0, 1.4) });
  }
});

for (let fx = -24; fx <= 26; fx += 1.25) {
  const fz = -51.8;
  const y = groundY(fx, fz);
  collect(worldUV(new THREE.BoxGeometry(0.09, 0.9, 0.09), 2), plinthMat, local(fx, y + 0.42, fz));
  collect(worldUV(new THREE.BoxGeometry(1.25, 0.07, 0.05), 2), plinthMat, local(fx + 0.62, y + 0.72, fz));
  collect(worldUV(new THREE.BoxGeometry(1.25, 0.07, 0.05), 2), plinthMat, local(fx + 0.62, y + 0.38, fz));
}

buckets.forEach((list, material) => {
  const mesh = new THREE.Mesh(mergeGeometries(list), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
});

// ================================================================== DISTANT BACKDROP
(() => {
  const W = LOW_POWER ? 1024 : 2048;
  const H = W / 8;
  const worldW = 220;
  const u = W / worldW;
  const r = mulberry32(31);
  const R = (a, b) => a + (b - a) * r();
  const shapes = [];
  for (let x = 0; x < W; x += R(0.5, 1.4) * u) {
    const p = new Path2D();
    const h = R(2.5, 5.5) * u;
    for (let k = 0; k < 6; k++) {
      const bx = x + R(-0.8, 0.8) * u;
      const by = H - h * R(0.45, 0.85);
      const br = h * R(0.18, 0.32);
      p.moveTo(bx + br, by);
      p.arc(bx, by, br, 0, Math.PI * 2);
    }
    p.rect(x - 1.2 * u, H - h * 0.5, 2.4 * u, h * 0.5);
    shapes.push(p);
  }
  for (let k = 0; k < 14; k++) {
    const x = R(0, W);
    const w = R(2, 3.2) * u;
    const h = R(1.4, 2.2) * u;
    const p = new Path2D();
    p.rect(x, H - h, w, h);
    p.moveTo(x - 0.1 * u, H - h);
    p.lineTo(x + w / 2, H - h - w * 0.6);
    p.lineTo(x + w + 0.1 * u, H - h);
    p.closePath();
    shapes.push(p);
  }
  const sx = W * 0.62;
  const spire = new Path2D();
  spire.rect(sx, H - 7 * u, 1.3 * u, 7 * u);
  spire.moveTo(sx, H - 7 * u);
  spire.lineTo(sx + 0.65 * u, H - 12 * u);
  spire.lineTo(sx + 1.3 * u, H - 7 * u);
  spire.closePath();
  shapes.push(spire);
  const tex = canvasTexture(W, H, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#c7b3b0');
    grad.addColorStop(1, '#8d9172');
    g.fillStyle = grad;
    shapes.forEach((p) => g.fill(p));
  }, { srgb: true, repeat: false });
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldW / 8),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }),
  );
  plane.position.set(0, worldW / 16 - 0.6, -96);
  scene.add(plane);
})();

// ================================================================== PETAL BURST
const petalOrigin = (() => {
  const offset = new Float32Array(PETAL_BURST * 3);
  const vel = new Float32Array(PETAL_BURST * 3);
  const seed = new Float32Array(PETAL_BURST);
  const col = new Float32Array(PETAL_BURST * 3);
  const palette = ['#ffb3c7', '#d0177f', '#d9b8ff', '#9d4edd', '#fbf7f4', '#ffd60a', '#ff8c1a'].map((c) => new THREE.Color(c));
  for (let i = 0; i < PETAL_BURST; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.25;
    offset.set([Math.cos(a) * r, 0.55 + Math.random() * 0.2, Math.sin(a) * r], i * 3);
    const out = 0.4 + Math.random() * 1.2;
    vel.set([Math.cos(a) * out, 1.4 + Math.random() * 1.8, Math.sin(a) * out], i * 3);
    seed[i] = Math.random();
    const c = palette[(Math.random() * palette.length) | 0];
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(offset, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: U.time, uStart: U.burstTime, uOrigin: { value: new THREE.Vector3() }, uPixelRatio: U.pixelRatio, uProjScale: U.projScale },
    vertexShader: /* glsl */`
      attribute vec3 aVel; attribute float aSeed; attribute vec3 aColor;
      uniform float uTime, uStart, uPixelRatio, uProjScale;
      uniform vec3 uOrigin;
      varying vec3 vColor; varying float vAlpha; varying float vSpin;
      void main() {
        float age = uTime - uStart;
        float life = 2.6;
        vec3 v = aVel * (1.0 - exp(-age * 2.2)) / 2.2;
        vec3 p = uOrigin + position + v - vec3(0.0, 0.55 * age * age, 0.0);
        p.x += sin(age * 5.0 + aSeed * 20.0) * 0.08 * age;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vAlpha = (age > 0.0 && age < life) ? 1.0 - smoothstep(life * 0.55, life, age) : 0.0;
        vSpin = age * (4.0 + aSeed * 6.0) + aSeed * 10.0;
        vColor = aColor;
        gl_PointSize = vAlpha > 0.0 ? (0.06 + aSeed * 0.05) * uProjScale * uPixelRatio / max(-mv.z, 0.1) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vAlpha; varying float vSpin;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vSpin), s = sin(vSpin);
        q = mat2(c, -s, s, c) * q;
        q.x *= 1.0 + 0.8 * abs(sin(vSpin * 0.7));
        float d = length(q * vec2(2.4, 1.3));
        if (d > 1.0) discard;
        gl_FragColor = vec4(vColor * (1.15 - d * 0.35), vAlpha * (1.0 - smoothstep(0.7, 1.0, d)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  scene.add(pts);
  return m.uniforms.uOrigin.value;
})();

// ================================================================== POST-PROCESSING
let composer;
let bokeh;
let bloom;
if (renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: LOW_POWER ? 0 : 2 });
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  bokeh = new BokehPass(scene, camera, { focus: dof.focus, aperture: dof.aperture, maxblur: dof.maxblur });
  composer.addPass(bokeh);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

function applyDof() {
  bokeh.uniforms.focus.value = dof.focus;
  bokeh.uniforms.aperture.value = dof.aperture;
  bokeh.uniforms.maxblur.value = dof.maxblur;
  bokeh.enabled = dof.aperture > 0.00002;
}

// ================================================================== CAMERA
const look = new THREE.Vector3();
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
const view = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 };
const drag = { down: false, active: false, id: null, x: 0, y: 0, lastX: 0, lastY: 0 };

function updateCamera(t) {
  if (!drag.active) {
    view.yaw += view.vYaw;
    view.pitch += view.vPitch;
    view.vYaw *= 0.92;
    view.vPitch *= 0.92;
    if (Math.abs(view.vYaw) + Math.abs(view.vPitch) < 0.0004) {
      view.yaw *= 0.997;
      view.pitch *= 0.997;
    }
  }
  view.yaw = THREE.MathUtils.clamp(view.yaw, -0.55, 0.55);
  view.pitch = THREE.MathUtils.clamp(view.pitch, -0.25, 0.2);

  const pan = REDUCED ? 0.15 : shot.pan;
  const x = (Math.sin(t * 0.035 + 1.2) * 4.6 + Math.sin(t * 0.013) * 1.4) * pan + pointer.x * 0.5;
  const z = shot.z + Math.sin(t * 0.021) * 0.9 * pan;
  const y = shot.height + groundY(x, z) * 0.6 + Math.sin(t * 0.07 + 0.5) * 0.12 * pan - pointer.y * 0.2;
  camera.position.set(x, y, z);
  look.set(
    x * 0.32 + Math.sin(t * 0.045) * 0.8 * pan + Math.tan(view.yaw) * 40,
    shot.lookY + Math.tan(view.pitch) * 40,
    z - 40,
  );
  camera.lookAt(look);
  camera.rotateZ(Math.sin(t * 0.05 + 0.7) * 0.01 * pan);
  if (camera.fov !== shot.fov) {
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
    updateProjScale();
  }
  camera.updateMatrixWorld();
  U.sunView.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
}

// ================================================================== RESIZE
let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

function updateProjScale() {
  U.projScale.value = canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

function resize() {
  if (!renderer) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  U.pixelRatio.value = dpr;
  updateProjScale();
}
new ResizeObserver(resize).observe(canvas);
resize();

// Quality ladder, cheapest loss first: pixel ratio → MSAA → petal transmission
// → bloom → shadow resolution → shadows → pixel ratio again
function stepDownQuality() {
  let step = '';
  if (dpr > 1) {
    dpr = Math.max(1, dpr - 0.25);
    resize();
    step = `pixel ratio ${dpr}`;
  } else if (composer.renderTarget1.samples > 0) {
    [composer.renderTarget1, composer.renderTarget2].forEach((rt) => { rt.samples = 0; rt.dispose(); });
    step = 'MSAA off';
  } else if (tulipMats.near.transmission > 0) {
    tulipMats.near.transmission = 0;
    tulipMats.near.needsUpdate = true;
    step = 'petal transmission off';
  } else if (bloom.enabled) {
    bloom.enabled = false;
    step = 'bloom off';
  } else if (sun.shadow.mapSize.x > 1024) {
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    step = 'shadow map 1024';
  } else if (renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = false;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    step = 'shadows off';
  } else if (dpr > 0.75) {
    dpr = 0.75;
    resize();
    step = 'pixel ratio 0.75';
  }
  if (step) console.info(`[quality] frames running slow → ${step}`);
}

// ================================================================== LOOP
const clock = new THREE.Clock();
const frameMs = 1000 / FPS_CAP;
const millBoost = { value: 1 };
let lastFrame = 0;
let lastT = 0;
let slowFrames = 0;
let sampled = 0;

function frame(now) {
  if (now - lastFrame < frameMs - 2) return;
  const delta = now - lastFrame;
  lastFrame = now;

  if (delta < 1000 && ++sampled > 20) {
    slowFrames = delta > 22 ? slowFrames + 1 : Math.max(slowFrames - 1, 0);
    if (slowFrames > 30) {
      slowFrames = 0;
      stepDownQuality();
    }
  }

  const t = clock.getElapsedTime();
  const dt = Math.min(t - lastT, 0.1);
  lastT = t;
  U.time.value = t;
  U.gust.value = wind.gust;

  pointer.x += (pointer.tx - pointer.x) * 0.02;
  pointer.y += (pointer.ty - pointer.y) * 0.02;

  if (!REDUCED) windmillSails.rotation.z += dt * (0.3 + wind.gust * 0.35) * millBoost.value;

  updateCamera(t);
  updateLods();
  applyDof();
  composer.render(dt);
}

if (renderer) {
  renderer.compile(scene, camera);
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange', () => {
    renderer.setAnimationLoop(document.hidden ? null : frame);
  });
}

// ================================================================== TOUCHING THE SCENE
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const millParts = new Set(windmillSails.children);

function touchScene(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects([...windmillSails.children, groundMesh], false)[0];
  if (!hit) return;
  if (millParts.has(hit.object)) {
    gsap.fromTo(millBoost, { value: 9 }, { value: 1, duration: 4, ease: 'power2.out', overwrite: true });
    return;
  }
  U.ripplePos.value.copy(hit.point);
  U.rippleTime.value = U.time.value;
  petalOrigin.copy(hit.point);
  U.burstTime.value = U.time.value;
  try { navigator.vibrate?.(8); } catch { /* iOS: no vibration */ }
}

// ================================================================== MENU, LETTER, FOCUS
const title = document.getElementById('title');
const prompt = document.getElementById('prompt');
const meta = document.getElementById('meta');
const corners = document.querySelectorAll('.corner');
const modal = document.getElementById('modal');
const minimizeBtn = document.getElementById('modal-min');
const openBtn = document.getElementById('open-msg');
const hint = document.getElementById('hint');
const lines = modal.querySelectorAll('.modal__body > *');

const intro = gsap.timeline({ delay: 0.2 });
intro
  .from(canvas, { opacity: 0, duration: 2.6, ease: 'power2.out' })
  .to(corners, { opacity: 1, duration: 1, stagger: 0.08 }, 0.8)
  .fromTo(title, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 1.6, ease: 'power3.out' }, 1)
  .to(meta, { opacity: 1, duration: 1 }, 1.6)
  .to(prompt, { opacity: 1, duration: 1 }, 2);

function focusOn(target, duration = 1.6) {
  gsap.to(dof, { ...DOF[target], duration: REDUCED ? 0.01 : duration, ease: 'power2.inOut', overwrite: true });
}

let letterOpen = false;
let hintShown = false;

function openLetter() {
  if (letterOpen) return;
  letterOpen = true;
  modal.style.visibility = 'visible';
  modal.setAttribute('aria-hidden', 'false');
  gsap.to(openBtn, { opacity: 0, y: 12, duration: 0.3, ease: 'power2.in', onComplete: () => { openBtn.style.visibility = 'hidden'; } });
  gsap.to(modal, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', overwrite: 'auto' });
  focusOn('letter');
}

function minimizeLetter() {
  if (!letterOpen) return;
  letterOpen = false;
  gsap.to(modal, {
    y: () => modal.offsetHeight + 60,
    duration: 0.65,
    ease: 'power3.inOut',
    overwrite: 'auto',
    onComplete: () => { modal.style.visibility = 'hidden'; modal.setAttribute('aria-hidden', 'true'); },
  });
  openBtn.style.visibility = 'visible';
  gsap.fromTo(openBtn, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.35, ease: 'power3.out' });
  focusOn('field');
  if (!hintShown) {
    hintShown = true;
    gsap.timeline().to(hint, { opacity: 1, duration: 0.8 }, 0.6).to(hint, { opacity: 0, duration: 0.8 }, 5.5);
  }
}

minimizeBtn.addEventListener('click', minimizeLetter);
openBtn.addEventListener('click', openLetter);

let started = false;

function start() {
  if (started) return;
  started = true;
  try { navigator.vibrate?.(10); } catch { /* iOS: no vibration */ }
  intro.progress(1);

  gsap.timeline()
    .to(prompt, { opacity: 0, duration: 0.18, ease: 'power2.out' })
    .to([title, meta], { opacity: 0, y: -6, duration: 0.5, ease: 'power2.out' }, 0)
    .to(corners, { opacity: 0.4, duration: 0.6 }, 0)
    .to(shot, { ...SHOTS.focus, duration: REDUCED ? 0.01 : 7, ease: 'power2.inOut' }, 0)
    .add(() => {
      letterOpen = true;
      modal.style.visibility = 'visible';
      modal.setAttribute('aria-hidden', 'false');
      focusOn('letter', 1.8);
    }, 0.25)
    .fromTo(modal, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.25)
    .fromTo(lines, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.09 }, 0.35);
}

// ================================================================== INPUT
const onUi = (el) => el.closest && el.closest('.modal, .open-msg');

window.addEventListener('pointerdown', (e) => {
  if (onUi(e.target)) return;
  drag.down = true;
  drag.active = false;
  drag.id = e.pointerId;
  drag.x = drag.lastX = e.clientX;
  drag.y = drag.lastY = e.clientY;
  view.vYaw = view.vPitch = 0;
}, { passive: true });

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && !drag.down) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (!drag.down || e.pointerId !== drag.id) return;
  if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) {
    drag.active = true;
    if (started) minimizeLetter();
  }
  if (drag.active) {
    const k = 1.8 / window.innerWidth;
    view.vYaw = -(e.clientX - drag.lastX) * k;
    view.vPitch = (e.clientY - drag.lastY) * k * 0.8;
    view.yaw += view.vYaw;
    view.pitch += view.vPitch;
  }
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
}, { passive: true });

window.addEventListener('pointerup', (e) => {
  if (!drag.down || e.pointerId !== drag.id) return;
  drag.down = false;
  if (!drag.active) {
    if (!started) start();
    else touchScene(e.clientX, e.clientY);
  }
  drag.active = false;
});
window.addEventListener('pointercancel', () => { drag.down = false; drag.active = false; });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') start();
  if (e.key === 'Escape') (letterOpen ? minimizeLetter : openLetter)();
});
