import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type BuildingId =
  | 'bonfire'
  | 'lumber'
  | 'quarry'
  | 'hunter'
  | 'hut'
  | 'slinger'
  | 'clubman'
  | 'dinorider'
  | 'hero_cave'
  | 'workshop'
  | 'scout'
  | 'infirmary'
  | 'graveyard'
  | 'marketplace'
  | 'warehouse';

export interface BuildingSnapshot {
  id: BuildingId;
  shortName: string;
  name: string;
  level: number;
  isMain?: boolean;
  isHeroCave?: boolean;
  isBuilding: boolean;
  isResearching: boolean;
  isTraining: boolean;
  isHealing?: boolean;
  isVisible?: boolean;
  isLocked: boolean;
  canUpgrade: boolean;
  metaText: string;
  metaClass: string;
  progressPct: number | null;
  workers: number;
  freeBoneReady?: boolean;
  hasMarketClaim?: boolean;
  fallenCount?: number;
  injuredCount?: number;
  volcanoInjuredCount?: number;
}

export interface VillageSnapshot {
  ember: number;
  overheat: boolean;
  autoFeedActive: boolean;
  weatherPhase: 'calm' | 'warning' | 'storm';
  weatherType: 'cold' | 'ash' | string;
  popTotal: number;
  buildings: BuildingSnapshot[];
}

export interface Village3DAPI {
  init: (
    mountEl: HTMLElement,
    labelLayerEl: HTMLElement,
    callbacks: { onSelectBuilding: (id: BuildingId) => void }
  ) => void;
  syncState: (snapshot: VillageSnapshot) => void;
  setVisible: (visible: boolean) => void;
  centerOn: (id?: BuildingId) => void;
  resize: () => void;
  isDragging: () => boolean;
}

declare global {
  interface Window {
    Village3D?: Village3DAPI;
  }
}

interface BuildingLayout {
  x: number;
  z: number;
  radius: number;
  hitHeight: number;
  labelOffsetY: number;
  labelOffsetZ: number;
}

const BUILDING_LAYOUTS: Record<BuildingId, BuildingLayout> = {
  bonfire: { x: 0.0, z: 0.0, radius: 2.55, hitHeight: 3.4, labelOffsetY: 0.25, labelOffsetZ: 2.35 },
  hero_cave: { x: -0.2, z: -9.4, radius: 2.6, hitHeight: 3.2, labelOffsetY: 0.25, labelOffsetZ: 2.2 },
  quarry: { x: -4.9, z: -5.6, radius: 2.35, hitHeight: 2.6, labelOffsetY: 0.2, labelOffsetZ: 2.15 },
  hut: { x: 5.2, z: -4.8, radius: 2.75, hitHeight: 2.7, labelOffsetY: 0.2, labelOffsetZ: 2.35 },
  lumber: { x: -7.2, z: -1.1, radius: 2.25, hitHeight: 2.3, labelOffsetY: 0.2, labelOffsetZ: 2.0 },
  hunter: { x: 7.0, z: -0.2, radius: 2.25, hitHeight: 2.3, labelOffsetY: 0.2, labelOffsetZ: 2.0 },
  slinger: { x: -7.0, z: 3.9, radius: 2.35, hitHeight: 2.2, labelOffsetY: 0.2, labelOffsetZ: 2.1 },
  clubman: { x: 6.7, z: 3.9, radius: 2.4, hitHeight: 2.2, labelOffsetY: 0.2, labelOffsetZ: 2.15 },
  dinorider: { x: -4.7, z: 8.6, radius: 2.75, hitHeight: 2.4, labelOffsetY: 0.2, labelOffsetZ: 2.45 },
  scout: { x: 4.8, z: 8.4, radius: 2.05, hitHeight: 3.8, labelOffsetY: 0.2, labelOffsetZ: 1.95 },
  workshop: { x: 0.0, z: 10.6, radius: 2.15, hitHeight: 3.1, labelOffsetY: 0.2, labelOffsetZ: 1.95 },
  warehouse: { x: -9.6, z: -5.6, radius: 2.35, hitHeight: 2.7, labelOffsetY: 0.2, labelOffsetZ: 2.15 },
  marketplace: { x: 9.8, z: -4.6, radius: 2.35, hitHeight: 2.7, labelOffsetY: 0.2, labelOffsetZ: 2.15 },
  infirmary: { x: -9.4, z: 8.6, radius: 2.35, hitHeight: 2.5, labelOffsetY: 0.2, labelOffsetZ: 2.15 },
  graveyard: { x: 9.5, z: 8.4, radius: 2.35, hitHeight: 2.7, labelOffsetY: 0.2, labelOffsetZ: 2.15 }
};

const BUILDING_IDS = Object.keys(BUILDING_LAYOUTS) as BuildingId[];

// Pre-allocated scratch math objects (zero GC in render loop)
const _vec3 = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();
const _dummy = new THREE.Object3D();

// Fixed isometric viewing direction (strictly locked — never orbits/rotates)
const FIXED_CAM_DIR = new THREE.Vector3(0.0, 1.08, 0.94).normalize();
const PAN_BOUNDS = { minX: -10.2, maxX: 10.2, minZ: -9.8, maxZ: 11.4 };
const ZOOM_BOUNDS = { min: 15.0, max: 33.5 };

interface BuildingRig {
  id: BuildingId;
  root: THREE.Group;
  builtGroup: THREE.Group;
  unbuiltGroup: THREE.Group;
  scaffoldGroup: THREE.Group;
  hitMesh: THREE.Mesh;
  labelAnchor: THREE.Vector3;
  baseScale: number;
  hoverAmount: number;
  animate: (t: number, dt: number, snap: BuildingSnapshot | undefined, globalSnap: VillageSnapshot) => void;
}

interface VillagerAgent {
  group: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  from: THREE.Vector2;
  to: THREE.Vector2;
  progress: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
}

interface EmberMote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '');
    const isSoft = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) loseExt.loseContext();
    return isSoft;
  } catch {
    return false;
  }
}

function createGroundTexture(maxAniso: number): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  // Base dark volcanic earth gradient
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.48, 30, size * 0.5, size * 0.5, size * 0.52);
  grad.addColorStop(0, '#4c3a2d');
  grad.addColorStop(0.32, '#3a2d24');
  grad.addColorStop(0.66, '#28201b');
  grad.addColorStop(1, '#1a1512');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#707070';
  bCtx.fillRect(0, 0, size, size);

  // Organic volcanic soil & ash grain
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 4200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1 + rand() * 5.5;
    const shade = Math.floor(24 + rand() * 36);
    ctx.fillStyle = `rgba(${shade + 14}, ${shade + 6}, ${shade}, ${0.09 + rand() * 0.14})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    const bVal = Math.floor(90 + rand() * 75);
    bCtx.fillStyle = `rgba(${bVal}, ${bVal}, ${bVal}, 0.16)`;
    bCtx.beginPath();
    bCtx.arc(x, y, r, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Convert world coordinates (-26..26) to UV pixel coords
  const toPx = (wx: number, wz: number): [number, number] => [
    ((wx + 26) / 52) * size,
    ((wz + 26) / 52) * size
  ];

  // Packed dirt clearings around each building
  for (const id of BUILDING_IDS) {
    const lay = BUILDING_LAYOUTS[id];
    const [px, py] = toPx(lay.x, lay.z);
    const pr = (lay.radius * 1.48 / 52) * size;
    const cGrad = ctx.createRadialGradient(px, py, pr * 0.15, px, py, pr);
    cGrad.addColorStop(0, id === 'bonfire' ? 'rgba(94, 67, 46, 0.72)' : 'rgba(84, 64, 48, 0.56)');
    cGrad.addColorStop(0.7, 'rgba(66, 51, 39, 0.28)');
    cGrad.addColorStop(1, 'rgba(42, 33, 26, 0)');
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cobblestone stone paths radiating from central Bonfire to every building
  const [cx, cy] = toPx(0, 0);
  for (const id of BUILDING_IDS) {
    if (id === 'bonfire') continue;
    const lay = BUILDING_LAYOUTS[id];
    const [tx, ty] = toPx(lay.x, lay.z);

    // Dirt footpath base
    ctx.strokeStyle = 'rgba(72, 57, 45, 0.52)';
    ctx.lineWidth = 17;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const midX = (cx + tx) * 0.5 + (rand() - 0.5) * 18;
    const midY = (cy + ty) * 0.5 + (rand() - 0.5) * 18;
    ctx.quadraticCurveTo(midX, midY, tx, ty);
    ctx.stroke();

    // Individual flat volcanic stepping stones
    const steps = 11;
    for (let s = 2; s < steps - 1; s++) {
      const u = s / steps;
      const omt = 1 - u;
      const sx = omt * omt * cx + 2 * omt * u * midX + u * u * tx + (rand() - 0.5) * 4;
      const sy = omt * omt * cy + 2 * omt * u * midY + u * u * ty + (rand() - 0.5) * 4;
      const rw = 4.5 + rand() * 4.5;
      const rh = 3.2 + rand() * 3.2;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rand() * Math.PI);
      ctx.fillStyle = rand() > 0.4 ? '#6d625a' : '#584e47';
      ctx.strokeStyle = 'rgba(20, 15, 12, 0.65)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.roundRect(-rw * 0.5, -rh * 0.5, rw, rh, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      bCtx.fillStyle = '#cfcfcf';
      bCtx.beginPath();
      bCtx.arc(sx, sy, rw * 0.55, 0, Math.PI * 2);
      bCtx.fill();
    }
  }

  // Central stone ring around Signalfeuer
  ctx.strokeStyle = 'rgba(116, 102, 92, 0.55)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, (2.65 / 52) * size, 0, Math.PI * 2);
  ctx.stroke();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAniso;

  return { map, bumpMap };
}

function createThatchTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9b6e42';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 480; i++) {
    const x = (i * 37) % 256;
    const y = (i * 71) % 256;
    ctx.strokeStyle = i % 3 === 0 ? '#b78552' : i % 3 === 1 ? '#7c532e' : '#c69963';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + ((i % 5) - 2) * 3, y + 26);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.anisotropy = maxAniso;
  return tex;
}

function createWoodTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#6c492f';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    ctx.fillStyle = y % 16 === 0 ? 'rgba(35, 20, 10, 0.35)' : 'rgba(145, 100, 62, 0.18)';
    ctx.fillRect(0, y, 256, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function createRockTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#47403c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 360; i++) {
    const x = (i * 53) % 256;
    const y = (i * 89) % 256;
    const r = 4 + (i % 14);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(26, 22, 20, 0.32)' : 'rgba(105, 96, 90, 0.24)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function createShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(6, 4, 3, 0.62)');
  g.addColorStop(0.55, 'rgba(6, 4, 3, 0.30)');
  g.addColorStop(1, 'rgba(6, 4, 3, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createTargetTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e7dec8';
  ctx.fillRect(0, 0, 128, 128);
  const rings: [number, string][] = [
    [58, '#b91c1c'],
    [42, '#f5efe6'],
    [27, '#b91c1c'],
    [13, '#f59e0b']
  ];
  for (const [r, col] of rings) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(64, 64, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createTipiTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#cbb694';
  ctx.fillRect(0, 0, 256, 256);
  // Decorative tribal bands
  ctx.fillStyle = '#8b361a';
  ctx.fillRect(0, 162, 256, 22);
  ctx.fillStyle = '#3a2b22';
  ctx.fillRect(0, 186, 256, 8);
  ctx.fillStyle = '#d97706';
  for (let x = 8; x < 256; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 160);
    ctx.lineTo(x + 10, 140);
    ctx.lineTo(x + 20, 160);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

interface SharedMaterials {
  basalt: THREE.MeshStandardMaterial;
  basaltDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  thatch: THREE.MeshStandardMaterial;
  hide: THREE.MeshStandardMaterial;
  tipi: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  lava: THREE.MeshStandardMaterial;
  flameOuter: THREE.MeshStandardMaterial;
  flameInner: THREE.MeshStandardMaterial;
  amberGlow: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  target: THREE.MeshStandardMaterial;
  dinoGreen: THREE.MeshStandardMaterial;
  dinoTeal: THREE.MeshStandardMaterial;
  clothRed: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  tunicA: THREE.MeshStandardMaterial;
  tunicB: THREE.MeshStandardMaterial;
  shadowDisc: THREE.MeshBasicMaterial;
  dirtPad: THREE.MeshStandardMaterial;
  smoke: THREE.MeshStandardMaterial;
  runeGlow: THREE.MeshStandardMaterial;
  paleHide: THREE.MeshStandardMaterial;
  herbGlow: THREE.MeshStandardMaterial;
  spiritGlow: THREE.MeshStandardMaterial;
  awningGold: THREE.MeshStandardMaterial;
  clayPot: THREE.MeshStandardMaterial;
  mossStone: THREE.MeshStandardMaterial;
  hitMat: THREE.MeshBasicMaterial;
}

function createSharedMaterials(maxAniso: number): SharedMaterials {
  const rockTex = createRockTexture(maxAniso);
  const woodTex = createWoodTexture(maxAniso);
  const thatchTex = createThatchTexture(maxAniso);
  const targetTex = createTargetTexture(maxAniso);
  const tipiTex = createTipiTexture(maxAniso);
  const shadowTex = createShadowTexture();

  return {
    basalt: new THREE.MeshStandardMaterial({ map: rockTex, color: 0x625852, roughness: 0.9, metalness: 0.05 }),
    basaltDark: new THREE.MeshStandardMaterial({ map: rockTex, color: 0x3a332f, roughness: 0.92, metalness: 0.08 }),
    stoneLight: new THREE.MeshStandardMaterial({ map: rockTex, color: 0x857a71, roughness: 0.86, metalness: 0.04 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8b603d, roughness: 0.84, metalness: 0.02 }),
    woodDark: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x573a24, roughness: 0.88, metalness: 0.02 }),
    thatch: new THREE.MeshStandardMaterial({ map: thatchTex, color: 0xc89a64, roughness: 0.94, metalness: 0.0 }),
    hide: new THREE.MeshStandardMaterial({ color: 0xb7966e, roughness: 0.88, metalness: 0.0 }),
    tipi: new THREE.MeshStandardMaterial({ map: tipiTex, color: 0xead8be, roughness: 0.85, metalness: 0.0 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe6dcc8, roughness: 0.56, metalness: 0.04 }),
    lava: new THREE.MeshStandardMaterial({
      color: 0xff5a12,
      emissive: 0xff4d0a,
      emissiveIntensity: 2.1,
      roughness: 0.32,
      metalness: 0.1
    }),
    flameOuter: new THREE.MeshStandardMaterial({
      color: 0xff6b1a,
      emissive: 0xf97316,
      emissiveIntensity: 2.4,
      roughness: 0.25,
      transparent: true,
      opacity: 0.92
    }),
    flameInner: new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfbbf24,
      emissiveIntensity: 2.8,
      roughness: 0.2
    }),
    amberGlow: new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.9,
      roughness: 0.22,
      metalness: 0.35
    }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xa47144, roughness: 0.38, metalness: 0.65 }),
    target: new THREE.MeshStandardMaterial({ map: targetTex, roughness: 0.78, metalness: 0.02 }),
    dinoGreen: new THREE.MeshStandardMaterial({ color: 0x7c8a48, roughness: 0.68, metalness: 0.04 }),
    dinoTeal: new THREE.MeshStandardMaterial({ color: 0x567a6e, roughness: 0.64, metalness: 0.06 }),
    clothRed: new THREE.MeshStandardMaterial({ color: 0xb93c23, roughness: 0.85, side: THREE.DoubleSide }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc9936b, roughness: 0.78 }),
    tunicA: new THREE.MeshStandardMaterial({ color: 0x7c4a2b, roughness: 0.88 }),
    tunicB: new THREE.MeshStandardMaterial({ color: 0x55473c, roughness: 0.88 }),
    shadowDisc: new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1
    }),
    dirtPad: new THREE.MeshStandardMaterial({ color: 0x544132, roughness: 0.94, metalness: 0.0 }),
    smoke: new THREE.MeshStandardMaterial({
      color: 0xc7c0b8,
      roughness: 1.0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    }),
    runeGlow: new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.8,
      roughness: 0.25,
      metalness: 0.35
    }),
    paleHide: new THREE.MeshStandardMaterial({ color: 0xe6dbc6, roughness: 0.88, metalness: 0.0 }),
    herbGlow: new THREE.MeshStandardMaterial({
      color: 0x4ade80,
      emissive: 0x22c55e,
      emissiveIntensity: 1.6,
      roughness: 0.28,
      metalness: 0.1
    }),
    spiritGlow: new THREE.MeshStandardMaterial({
      color: 0x5eead4,
      emissive: 0x14b8a6,
      emissiveIntensity: 1.9,
      roughness: 0.2,
      metalness: 0.2,
      transparent: true,
      opacity: 0.92
    }),
    awningGold: new THREE.MeshStandardMaterial({ color: 0xd98a2b, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide }),
    clayPot: new THREE.MeshStandardMaterial({ color: 0xa65a3a, roughness: 0.76, metalness: 0.04 }),
    mossStone: new THREE.MeshStandardMaterial({ map: rockTex, color: 0x4f5c50, roughness: 0.92, metalness: 0.04 }),
    hitMat: new THREE.MeshBasicMaterial({ visible: false })
  };
}

function addContactShadow(parent: THREE.Object3D, radius: number, mats: SharedMaterials): THREE.Mesh {
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.1, radius * 2.1), mats.shadowDisc);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.025;
  parent.add(disc);
  return disc;
}

function addTerracePad(
  parent: THREE.Object3D,
  w: number,
  d: number,
  mats: SharedMaterials,
  beveledStone = true
): void {
  const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), mats.dirtPad);
  pad.position.y = 0.08;
  pad.receiveShadow = true;
  parent.add(pad);

  if (beveledStone) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.22, 0.12, d + 0.22), mats.basalt);
    rim.position.y = 0.06;
    rim.receiveShadow = true;
    parent.add(rim);
  }
}

function createTribalFigure(
  mats: SharedMaterials,
  tunicMat: THREE.Material,
  withClub = false
): { group: THREE.Group; armR: THREE.Group; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh } {
  const group = new THREE.Group();
  const legGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.28, 6);
  const leftLeg = new THREE.Mesh(legGeo, mats.skin);
  leftLeg.position.set(-0.08, 0.14, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, mats.skin);
  rightLeg.position.set(0.08, 0.14, 0);
  group.add(rightLeg);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.38, 7), tunicMat);
  torso.position.y = 0.44;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), mats.skin);
  head.position.y = 0.73;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.138, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), mats.woodDark);
  hair.position.set(0, 0.75, -0.01);
  group.add(hair);

  const armR = new THREE.Group();
  armR.position.set(0.19, 0.56, 0);
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.28, 6), mats.skin);
  armMesh.position.y = -0.1;
  armR.add(armMesh);

  if (withClub) {
    const club = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.032, 0.48, 6), mats.wood);
    club.position.set(0, -0.24, 0.16);
    club.rotation.x = Math.PI * 0.42;
    club.castShadow = true;
    armR.add(club);
  }
  group.add(armR);

  return { group, armR, leftLeg, rightLeg };
}

function createUnbuiltPlot(radius: number, mats: SharedMaterials): THREE.Group {
  const g = new THREE.Group();
  addTerracePad(g, radius * 1.45, radius * 1.35, mats, true);

  // Corner wooden construction stakes
  const halfX = radius * 0.62;
  const halfZ = radius * 0.56;
  const stakeGeo = new THREE.CylinderGeometry(0.06, 0.075, 0.7, 6);
  const corners: [number, number][] = [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [halfX, halfZ],
    [-halfX, halfZ]
  ];
  for (const [cx, cz] of corners) {
    const stake = new THREE.Mesh(stakeGeo, mats.wood);
    stake.position.set(cx, 0.45, cz);
    stake.castShadow = true;
    g.add(stake);
  }

  // Scattered foundation stones
  for (let i = 0; i < 4; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24 + (i % 2) * 0.1, 0), mats.basalt);
    rock.position.set(Math.cos(i * 1.7) * 0.6, 0.24, Math.sin(i * 1.7) * 0.5);
    rock.scale.set(1.2, 0.7, 1.0);
    rock.castShadow = true;
    g.add(rock);
  }

  return g;
}

function createScaffoldOverlay(radius: number, mats: SharedMaterials): {
  group: THREE.Group;
  hammerPivot: THREE.Group;
} {
  const group = new THREE.Group();
  const half = radius * 0.82;
  const poleGeo = new THREE.CylinderGeometry(0.055, 0.065, 2.2, 6);
  const beamGeo = new THREE.BoxGeometry(half * 2.05, 0.09, 0.1);

  const posts: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half]
  ];
  for (const [px, pz] of posts) {
    const p = new THREE.Mesh(poleGeo, mats.wood);
    p.position.set(px, 1.1, pz);
    p.castShadow = true;
    group.add(p);
  }

  // Cross rails on front and sides
  for (const y of [0.95, 1.75]) {
    const bFront = new THREE.Mesh(beamGeo, mats.woodDark);
    bFront.position.set(0, y, half);
    group.add(bFront);
    const bRight = new THREE.Mesh(beamGeo, mats.woodDark);
    bRight.position.set(half, y, 0);
    bRight.rotation.y = Math.PI / 2;
    group.add(bRight);
  }

  // Animated wooden mallet hammering at the front corner
  const hammerPivot = new THREE.Group();
  hammerPivot.position.set(half * 0.65, 1.55, half + 0.15);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 6), mats.wood);
  handle.position.y = 0.25;
  hammerPivot.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.18), mats.stoneLight);
  head.position.y = 0.56;
  hammerPivot.add(head);
  group.add(hammerPivot);

  group.visible = false;
  return { group, hammerPivot };
}

function buildBonfire(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();

  // Wide octagonal volcanic plinth
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.55, 0.34, 8), mats.basalt);
  base.position.y = 0.17;
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  // Carved stone steps on 4 sides
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.26, 0.62), mats.stoneLight);
    step.position.set(Math.sin(a) * 2.15, 0.13, Math.cos(a) * 2.15);
    step.rotation.y = a;
    step.receiveShadow = true;
    step.castShadow = true;
    group.add(step);
  }

  // Central jagged volcanic hearth cone
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.68, 1.75, 7), mats.basaltDark);
  cone.position.y = 1.12;
  cone.castShadow = true;
  cone.receiveShadow = true;
  group.add(cone);

  // Glowing furnace arches on 4 sides + magma veins
  const magmaParts: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.72, 0.45), mats.lava);
    arch.position.set(Math.sin(a) * 1.15, 0.72, Math.cos(a) * 1.15);
    arch.rotation.y = a;
    group.add(arch);
    magmaParts.push(arch);
  }

  // Crater lava bowl
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.65, 0.22, 8), mats.lava);
  bowl.position.y = 1.92;
  group.add(bowl);

  // Multi-layered animated 3D flames
  const flameGroup = new THREE.Group();
  flameGroup.position.y = 2.02;
  group.add(flameGroup);

  const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.76, 1.85, 7), mats.flameOuter);
  flameOuter.position.y = 0.78;
  flameGroup.add(flameOuter);

  const flameMidL = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 6), mats.flameOuter);
  flameMidL.position.set(-0.32, 0.56, 0.12);
  flameMidL.rotation.z = 0.18;
  flameGroup.add(flameMidL);

  const flameMidR = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.18, 6), mats.flameOuter);
  flameMidR.position.set(0.3, 0.52, -0.14);
  flameMidR.rotation.z = -0.2;
  flameGroup.add(flameMidR);

  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.15, 6), mats.flameInner);
  flameCore.position.y = 0.54;
  flameGroup.add(flameCore);

  // 4 corner stone torches / braziers
  const brazierFlames: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const bx = Math.sin(a) * 2.05;
    const bz = Math.cos(a) * 2.05;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.18, 6), mats.basalt);
    stand.position.set(bx, 0.75, bz);
    stand.castShadow = true;
    group.add(stand);

    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.12, 0.22, 6), mats.bronze);
    cup.position.set(bx, 1.38, bz);
    group.add(cup);

    const bf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.44, 5), mats.flameInner);
    bf.position.set(bx, 1.66, bz);
    group.add(bf);
    brazierFlames.push(bf);
  }

  return {
    group,
    update: (t, _dt, _snap, g) => {
      const emberNorm = Math.max(0.08, g.ember / 100);
      const hotBoost = g.overheat && g.autoFeedActive ? 1.38 : g.autoFeedActive ? 1.0 : 0.42;
      const flicker = 0.92 + Math.sin(t * 11.3) * 0.08 + Math.sin(t * 17.9) * 0.06;
      const sXZ = (0.7 + emberNorm * 0.35) * (g.overheat && g.autoFeedActive ? 1.18 : 1.0);
      const sY = emberNorm * hotBoost * flicker;

      flameGroup.scale.set(sXZ, Math.max(0.2, sY), sXZ);
      flameOuter.rotation.y = t * 1.4;
      flameCore.rotation.y = -t * 2.1;
      flameMidL.rotation.z = 0.18 + Math.sin(t * 8.4) * 0.12;
      flameMidR.rotation.z = -0.2 + Math.cos(t * 7.6) * 0.12;

      mats.flameOuter.emissiveIntensity = (1.6 + emberNorm * 1.2) * hotBoost;
      mats.flameInner.emissiveIntensity = (2.0 + emberNorm * 1.2) * hotBoost;
      mats.lava.emissiveIntensity = 1.4 + Math.sin(t * 2.6) * 0.35 + (g.overheat && g.autoFeedActive ? 0.8 : 0);

      for (let i = 0; i < brazierFlames.length; i++) {
        const bf = brazierFlames[i];
        const f = 0.82 + Math.sin(t * 10 + i * 1.9) * 0.18;
        bf.scale.set(1, Math.max(0.25, f * emberNorm * (hotBoost > 1 ? 1.2 : 1)), 1);
      }
      for (let i = 0; i < magmaParts.length; i++) {
        magmaParts[i].scale.y = 0.95 + Math.sin(t * 3.1 + i) * 0.05;
      }
    }
  };
}

function buildHutCluster(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.9, 4.2, mats, true);

  const smokePuffs: { mesh: THREE.Mesh; basePos: THREE.Vector3; phase: number }[] = [];

  const addSingleHut = (hx: number, hz: number, scale: number, rotY: number) => {
    const hg = new THREE.Group();
    hg.position.set(hx, 0.16, hz);
    hg.rotation.y = rotY;
    hg.scale.setScalar(scale);

    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.04, 0.88, 10), mats.hide);
    wall.position.y = 0.44;
    wall.castShadow = true;
    wall.receiveShadow = true;
    hg.add(wall);

    // Timber posts around wall
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.92, 5), mats.woodDark);
      post.position.set(Math.sin(a) * 0.98, 0.45, Math.cos(a) * 0.98);
      hg.add(post);
    }

    // Domed thatched roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.26, 0.92, 10), mats.thatch);
    roof.position.y = 1.26;
    roof.castShadow = true;
    hg.add(roof);

    // Crossed roof ridge bones/sticks
    for (const r of [-0.45, 0.45]) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.55, 5), mats.bone);
      stick.position.set(0, 1.72, 0);
      stick.rotation.z = r;
      hg.add(stick);
    }

    // Warm glowing doorway
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.2), mats.woodDark);
    doorFrame.position.set(0, 0.28, 0.96);
    hg.add(doorFrame);

    const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.23), mats.amberGlow);
    doorGlow.position.set(0, 0.25, 0.97);
    hg.add(doorGlow);

    // Chimney pipe
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.42, 6), mats.basalt);
    chimney.position.set(0.38, 1.56, -0.2);
    hg.add(chimney);

    group.add(hg);

    // 3 rising smoke puffs per hut
    for (let p = 0; p < 3; p++) {
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), mats.smoke);
      const basePos = new THREE.Vector3(hx + 0.38 * scale, 0.16 + 1.85 * scale, hz - 0.2 * scale);
      puff.position.copy(basePos);
      group.add(puff);
      smokePuffs.push({ mesh: puff, basePos, phase: p * 0.33 + hx * 0.2 });
    }
  };

  addSingleHut(-1.05, -0.75, 1.0, 0.22);
  addSingleHut(1.15, -0.45, 0.94, -0.35);
  addSingleHut(0.05, 0.98, 0.86, 0.1);

  // Small shared campfire in courtyard
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.1, 7), mats.basalt);
  pit.position.set(0.92, 0.21, 0.88);
  group.add(pit);
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 5), mats.flameOuter);
  fire.position.set(0.92, 0.42, 0.88);
  group.add(fire);

  return {
    group,
    update: (t) => {
      fire.scale.y = 0.85 + Math.sin(t * 9.5) * 0.22;
      for (const s of smokePuffs) {
        const u = (t * 0.28 + s.phase) % 1;
        s.mesh.position.set(
          s.basePos.x + Math.sin(u * 4 + s.phase * 6) * 0.22 + u * 0.35,
          s.basePos.y + u * 1.45,
          s.basePos.z - u * 0.15
        );
        const sc = 0.65 + u * 1.35;
        s.mesh.scale.setScalar(sc);
      }
    }
  };
}

function buildQuarry(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.1, 3.7, mats, true);

  // Recessed dark pit illusion
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.95, 0.08, 9), mats.basaltDark);
  pit.position.set(0.15, 0.17, 0.25);
  group.add(pit);

  // Jagged stepped basalt rock face at rear
  const boulders: [number, number, number, number][] = [
    [-0.9, 0.65, -0.85, 0.72],
    [-0.1, 0.82, -1.05, 0.85],
    [0.85, 0.72, -0.85, 0.76],
    [1.35, 0.52, -0.2, 0.58],
    [1.15, 0.42, 0.55, 0.46]
  ];
  for (const [bx, by, bz, bs] of boulders) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(bs, 0), mats.stoneLight);
    rock.position.set(bx, by, bz);
    rock.scale.set(1.1, 0.95, 0.9);
    rock.rotation.set(bx * 0.7, bz * 1.1, 0.3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // Minecart with stone chunks
  const cart = new THREE.Group();
  cart.position.set(0.65, 0.32, 0.82);
  cart.rotation.y = -0.35;
  const cartBody = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.34, 0.46), mats.woodDark);
  cartBody.castShadow = true;
  cart.add(cartBody);
  const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), mats.stoneLight);
  ore.position.y = 0.22;
  cart.add(ore);
  group.add(cart);

  // Animated wooden hoisting crane
  const cranePivot = new THREE.Group();
  cranePivot.position.set(-1.15, 0.16, 0.15);
  group.add(cranePivot);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.05, 6), mats.wood);
  mast.position.y = 1.02;
  mast.castShadow = true;
  cranePivot.add(mast);

  const boom = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.12), mats.wood);
  boom.position.set(0.65, 1.92, 0);
  boom.rotation.z = 0.18;
  boom.castShadow = true;
  cranePivot.add(boom);

  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.08), mats.woodDark);
  strut.position.set(0.35, 1.55, 0);
  strut.rotation.z = 0.65;
  cranePivot.add(strut);

  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), mats.bone);
  rope.position.set(1.22, 1.55, 0);
  cranePivot.add(rope);

  const block = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.44), mats.stoneLight);
  block.position.set(1.22, 1.0, 0);
  block.castShadow = true;
  cranePivot.add(block);

  return {
    group,
    update: (t) => {
      cranePivot.rotation.y = Math.sin(t * 0.55) * 0.52;
      const hoist = 0.5 + Math.sin(t * 1.1) * 0.45; // 0.05..0.95
      const ropeLen = 0.45 + hoist * 0.85;
      rope.scale.y = ropeLen;
      rope.position.y = 2.02 - ropeLen * 0.5;
      block.position.y = 2.02 - ropeLen - 0.18;
      block.rotation.y = t * 0.4;
    }
  };
}

function buildLumber(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 3.9, 3.4, mats, true);

  // Sloped timber shelter shed
  const posts: [number, number, number][] = [
    [-1.15, 1.28, -0.95],
    [0.55, 1.28, -0.95],
    [-1.15, 0.96, 0.25],
    [0.55, 0.96, 0.25]
  ];
  for (const [px, ph, pz] of posts) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, ph, 6), mats.woodDark);
    p.position.set(px, 0.16 + ph * 0.5, pz);
    p.castShadow = true;
    group.add(p);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.14, 1.65), mats.wood);
  roof.position.set(-0.3, 1.34, -0.35);
  roof.rotation.x = 0.26;
  roof.castShadow = true;
  group.add(roof);

  // Stacked timber log pile
  const logGeo = new THREE.CylinderGeometry(0.14, 0.15, 1.45, 7);
  logGeo.rotateZ(Math.PI / 2);
  const logPositions: [number, number, number][] = [
    [-0.78, 0.3, 0.62],
    [-0.78, 0.3, 0.94],
    [-0.78, 0.54, 0.78],
    [-0.3, 0.3, -0.4],
    [-0.3, 0.55, -0.4]
  ];
  for (const [lx, ly, lz] of logPositions) {
    const log = new THREE.Mesh(logGeo, mats.wood);
    log.position.set(lx, ly, lz);
    log.castShadow = true;
    group.add(log);
  }

  // Chopping stump + animated lumberjack swinging axe
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.42, 8), mats.woodDark);
  stump.position.set(0.88, 0.37, 0.42);
  stump.castShadow = true;
  group.add(stump);

  const worker = createTribalFigure(mats, mats.tunicA, false);
  worker.group.position.set(1.22, 0.16, 0.65);
  worker.group.rotation.y = -2.1;
  // Axe attached to worker arm
  const axeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.55, 5), mats.wood);
  axeHandle.position.set(0, -0.22, 0.18);
  axeHandle.rotation.x = Math.PI * 0.42;
  worker.armR.add(axeHandle);
  const axeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.18), mats.stoneLight);
  axeBlade.position.set(0, -0.28, 0.42);
  worker.armR.add(axeBlade);
  group.add(worker.group);

  return {
    group,
    update: (t) => {
      const swing = Math.pow(Math.abs(Math.sin(t * 2.8)), 1.6);
      worker.armR.rotation.x = -1.35 + swing * 1.45;
      worker.group.position.y = 0.16 + Math.max(0, Math.sin(t * 5.6)) * 0.04;
    }
  };
}

function buildHunter(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 3.8, 3.4, mats, true);

  // Hide-covered hunting lodge A-frame
  const lodge = new THREE.Mesh(new THREE.ConeGeometry(1.18, 1.52, 4), mats.hide);
  lodge.position.set(-0.55, 0.92, -0.35);
  lodge.rotation.y = Math.PI / 4;
  lodge.castShadow = true;
  group.add(lodge);

  const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.52, 0.15), mats.amberGlow);
  doorGlow.position.set(-0.55, 0.42, 0.35);
  group.add(doorGlow);

  // Antler/bone trophy over entrance
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 0.55, 5), mats.bone);
    horn.position.set(-0.55 + side * 0.25, 1.56, -0.1);
    horn.rotation.z = side * -0.65;
    group.add(horn);
  }

  // Drying meat rack with gently swaying hides
  const rack = new THREE.Group();
  rack.position.set(0.95, 0.16, 0.18);
  group.add(rack);
  for (const sx of [-0.55, 0.55]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 6), mats.woodDark);
    p.position.set(sx, 0.65, 0);
    p.castShadow = true;
    rack.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6), mats.wood);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 1.24;
  rack.add(bar);

  const hangings: THREE.Mesh[] = [];
  for (const hx of [-0.28, 0.02, 0.32]) {
    const pelt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.48, 0.06), hx === 0.02 ? mats.clothRed : mats.hide);
    pelt.position.set(hx, 0.96, 0);
    pelt.castShadow = true;
    rack.add(pelt);
    hangings.push(pelt);
  }

  // Small campfire in front
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 5), mats.flameOuter);
  fire.position.set(0.18, 0.36, 0.92);
  group.add(fire);

  return {
    group,
    update: (t) => {
      fire.scale.y = 0.8 + Math.sin(t * 10.2) * 0.22;
      for (let i = 0; i < hangings.length; i++) {
        hangings[i].rotation.x = Math.sin(t * 2.1 + i * 0.9) * 0.16;
      }
    }
  };
}

function buildSlinger(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.2, 3.6, mats, true);

  // Small supply tent on left
  const tent = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.15, 5), mats.hide);
  tent.position.set(-1.28, 0.73, 0.45);
  tent.castShadow = true;
  group.add(tent);

  // Wooden fence rail behind targets
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.09), mats.wood);
  rail.position.set(0.3, 0.72, -1.22);
  group.add(rail);

  // 2 Painted round archery/sling targets that recoil on hit
  const targets: THREE.Group[] = [];
  for (const tx of [-0.45, 0.65]) {
    const tg = new THREE.Group();
    tg.position.set(tx, 0.16, -0.82);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.82, 5), mats.woodDark);
    post.position.y = 0.41;
    tg.add(post);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.09, 14), mats.target);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(0, 0.82, 0.05);
    disc.castShadow = true;
    tg.add(disc);
    group.add(tg);
    targets.push(tg);
  }

  // Training slinger figure
  const slinger = createTribalFigure(mats, mats.tunicB, false);
  slinger.group.position.set(0.08, 0.16, 0.98);
  slinger.group.rotation.y = Math.PI;
  group.add(slinger.group);

  // Flying stone pebble arcing from slinger to targets
  const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), mats.stoneLight);
  group.add(pebble);

  return {
    group,
    update: (t, _dt, snap) => {
      const rate = snap?.isTraining ? 1.6 : 0.95;
      const cycle = (t * rate) % 2;
      const targetIdx = cycle < 1 ? 0 : 1;
      const u = cycle % 1;

      if (u < 0.35) {
        // Wind-up spin
        slinger.armR.rotation.x = -Math.PI * 0.8 + Math.sin(u * 28) * 0.5;
        pebble.visible = false;
      } else {
        // Release & parabolic arc to target
        slinger.armR.rotation.x = -0.3;
        pebble.visible = true;
        const flightU = (u - 0.35) / 0.65;
        const tx = targetIdx === 0 ? -0.45 : 0.65;
        pebble.position.set(
          THREE.MathUtils.lerp(0.08, tx, flightU),
          0.75 + Math.sin(flightU * Math.PI) * 0.85,
          THREE.MathUtils.lerp(0.85, -0.76, flightU)
        );
      }

      // Target rock-back upon impact
      for (let i = 0; i < targets.length; i++) {
        const hitPhase = i === targetIdx && u > 0.92 ? (1 - u) * 12.5 : 0;
        targets[i].rotation.x = -hitPhase * 0.28;
      }
    }
  };
}

function buildClubman(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.3, 3.7, mats, true);

  // Sparring ring corner posts & rope perimeter
  const ringHalfX = 1.45;
  const ringHalfZ = 1.15;
  const ringPosts: [number, number][] = [
    [-ringHalfX, -ringHalfZ],
    [ringHalfX, -ringHalfZ],
    [ringHalfX, ringHalfZ],
    [-ringHalfX, ringHalfZ]
  ];
  for (const [rx, rz] of ringPosts) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.95, 6), mats.woodDark);
    p.position.set(rx, 0.62, rz);
    p.castShadow = true;
    group.add(p);
  }
  // Ropes
  const ropeH = new THREE.BoxGeometry(ringHalfX * 2, 0.045, 0.045);
  const ropeV = new THREE.BoxGeometry(0.045, 0.045, ringHalfZ * 2);
  for (const y of [0.55, 0.88]) {
    for (const rz of [-ringHalfZ, ringHalfZ]) {
      const r = new THREE.Mesh(ropeH, mats.hide);
      r.position.set(0, y, rz);
      group.add(r);
    }
    for (const rx of [-ringHalfX, ringHalfX]) {
      const r = new THREE.Mesh(ropeV, mats.hide);
      r.position.set(rx, y, 0);
      group.add(r);
    }
  }

  // Weapon rack along back edge
  for (let i = 0; i < 4; i++) {
    const club = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.038, 0.72, 6), mats.wood);
    club.position.set(-0.9 + i * 0.55, 0.55, -1.38);
    club.rotation.x = 0.2;
    group.add(club);
  }

  // Two animated sparring clubmen facing each other
  const fighterA = createTribalFigure(mats, mats.tunicA, true);
  fighterA.group.position.set(-0.62, 0.16, 0.08);
  fighterA.group.rotation.y = Math.PI * 0.5;
  group.add(fighterA.group);

  const fighterB = createTribalFigure(mats, mats.tunicB, true);
  fighterB.group.position.set(0.62, 0.16, -0.08);
  fighterB.group.rotation.y = -Math.PI * 0.5;
  group.add(fighterB.group);

  return {
    group,
    update: (t, _dt, snap) => {
      const spd = snap?.isTraining ? 4.4 : 2.7;
      fighterA.armR.rotation.x = -0.6 + Math.sin(t * spd) * 0.95;
      fighterB.armR.rotation.x = -0.6 + Math.cos(t * spd) * 0.95;
      fighterA.group.position.x = -0.56 + Math.sin(t * spd * 0.5) * 0.16;
      fighterB.group.position.x = 0.56 - Math.sin(t * spd * 0.5) * 0.16;
      fighterA.group.position.y = 0.16 + Math.abs(Math.sin(t * spd)) * 0.05;
      fighterB.group.position.y = 0.16 + Math.abs(Math.cos(t * spd)) * 0.05;
    }
  };
}

function buildDinorider(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.9, 4.1, mats, true);

  // Wooden palisade fence enclosing paddock
  const stakeGeo = new THREE.ConeGeometry(0.08, 0.92, 5);
  const addFenceLine = (x1: number, z1: number, x2: number, z2: number, count: number, skipMid = false) => {
    for (let i = 0; i <= count; i++) {
      if (skipMid && i >= Math.floor(count * 0.38) && i <= Math.ceil(count * 0.62)) continue;
      const u = i / count;
      const s = new THREE.Mesh(stakeGeo, mats.wood);
      s.position.set(THREE.MathUtils.lerp(x1, x2, u), 0.56, THREE.MathUtils.lerp(z1, z2, u));
      s.castShadow = true;
      group.add(s);
    }
  };
  addFenceLine(-2.25, -1.85, 2.25, -1.85, 14);
  addFenceLine(-2.25, 1.85, 2.25, 1.85, 14, true);
  addFenceLine(-2.25, -1.85, -2.25, 1.85, 12);
  addFenceLine(2.25, -1.85, 2.25, 1.85, 12);

  // Shade canopy in back-left corner
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.25), mats.hide);
  canopy.position.set(-1.25, 1.38, -0.95);
  canopy.rotation.z = -0.14;
  canopy.castShadow = true;
  group.add(canopy);
  for (const [px, pz] of [
    [-1.95, -1.45],
    [-0.55, -1.45],
    [-1.95, -0.45],
    [-0.55, -0.45]
  ]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 1.25, 5), mats.woodDark);
    p.position.set(px, 0.75, pz);
    group.add(p);
  }

  // Procedural 3D Triceratops
  const trike = new THREE.Group();
  trike.position.set(-0.95, 0.16, 0.25);
  trike.rotation.y = 0.72;
  const tBody = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.62, 1.18), mats.dinoGreen);
  tBody.position.y = 0.56;
  tBody.castShadow = true;
  trike.add(tBody);

  for (const [lx, lz] of [
    [-0.28, -0.36],
    [0.28, -0.36],
    [-0.28, 0.36],
    [0.28, 0.36]
  ]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.38, 6), mats.dinoGreen);
    leg.position.set(lx, 0.19, lz);
    trike.add(leg);
  }

  const tHeadPivot = new THREE.Group();
  tHeadPivot.position.set(0, 0.62, 0.62);
  const tFrill = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.44, 0.12, 8), mats.dinoGreen);
  tFrill.rotation.x = Math.PI * 0.42;
  tFrill.position.set(0, 0.15, 0.04);
  tHeadPivot.add(tFrill);
  const tSnout = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.52), mats.dinoGreen);
  tSnout.position.set(0, -0.02, 0.26);
  tHeadPivot.add(tSnout);
  for (const hx of [-0.15, 0.15]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42, 5), mats.bone);
    horn.rotation.x = Math.PI * 0.44;
    horn.position.set(hx, 0.14, 0.38);
    tHeadPivot.add(horn);
  }
  const noseHorn = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.22, 5), mats.bone);
  noseHorn.rotation.x = Math.PI * 0.28;
  noseHorn.position.set(0, 0.14, 0.46);
  tHeadPivot.add(noseHorn);
  trike.add(tHeadPivot);

  const tTail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.78, 6), mats.dinoGreen);
  tTail.rotation.x = -Math.PI * 0.45;
  tTail.position.set(0, 0.48, -0.82);
  trike.add(tTail);
  group.add(trike);

  // Procedural 3D Agile Raptor patrolling paddock
  const raptor = new THREE.Group();
  raptor.position.set(0.95, 0.16, 0.2);
  const rBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.85), mats.dinoTeal);
  rBody.position.y = 0.62;
  rBody.rotation.x = -0.18;
  rBody.castShadow = true;
  raptor.add(rBody);

  for (const lx of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.54, 6), mats.dinoTeal);
    leg.position.set(lx, 0.28, -0.04);
    raptor.add(leg);
  }
  const rHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.46), mats.dinoTeal);
  rHead.position.set(0, 0.94, 0.5);
  rHead.castShadow = true;
  raptor.add(rHead);
  const rTail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.95, 5), mats.dinoTeal);
  rTail.rotation.x = -Math.PI * 0.48;
  rTail.position.set(0, 0.65, -0.78);
  raptor.add(rTail);
  group.add(raptor);

  return {
    group,
    update: (t, _dt, snap) => {
      const spd = snap?.isTraining ? 1.55 : 1.0;
      tHeadPivot.rotation.x = Math.sin(t * 1.4 * spd) * 0.16;
      tHeadPivot.rotation.y = Math.sin(t * 0.85 * spd) * 0.22;
      tTail.rotation.z = Math.sin(t * 2.2 * spd) * 0.2;

      // Raptor patrols gently in a figure-8 arc inside right half of enclosure
      const a = t * 0.72 * spd;
      const rx = 0.85 + Math.cos(a) * 0.68;
      const rz = 0.15 + Math.sin(a * 1.3) * 0.65;
      const dx = -Math.sin(a) * 0.68;
      const dz = Math.cos(a * 1.3) * 0.65 * 1.3;
      raptor.position.set(rx, 0.16 + Math.abs(Math.sin(t * 5.2 * spd)) * 0.07, rz);
      raptor.rotation.y = Math.atan2(dx, dz);
      rHead.position.y = 0.94 + Math.sin(t * 5.2 * spd) * 0.05;
      rTail.rotation.z = Math.sin(t * 4.2 * spd) * 0.22;
    }
  };
}

function buildHeroCave(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.6, 3.8, mats, true);

  // Volcanic rock cavern dome
  const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(1.75, 1), mats.basaltDark);
  mound.position.set(0, 1.15, -0.35);
  mound.scale.set(1.22, 0.95, 0.95);
  mound.castShadow = true;
  mound.receiveShadow = true;
  group.add(mound);

  // Glowing cavern mouth recess
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.96, 0.55, 8, 1, false, 0, Math.PI), mats.lava);
  mouth.rotation.x = Math.PI / 2;
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, 0.86, 0.92);
  group.add(mouth);

  // Giant curved prehistoric ribcage bones framing entrance
  const ribGeo = new THREE.TorusGeometry(1.25, 0.1, 6, 12, Math.PI * 0.72);
  for (let i = 0; i < 3; i++) {
    const zOff = 0.68 + i * 0.34;
    const ribL = new THREE.Mesh(ribGeo, mats.bone);
    ribL.position.set(-0.22, 0.25, zOff);
    ribL.rotation.z = 0.35;
    ribL.castShadow = true;
    group.add(ribL);

    const ribR = new THREE.Mesh(ribGeo, mats.bone);
    ribR.position.set(0.22, 0.25, zOff);
    ribR.rotation.y = Math.PI;
    ribR.rotation.z = 0.35;
    ribR.castShadow = true;
    group.add(ribR);
  }

  // Skull totem mounted above cave arch
  const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), mats.bone);
  skull.position.set(0, 2.25, 0.88);
  skull.scale.set(1.15, 0.95, 0.9);
  skull.castShadow = true;
  group.add(skull);

  // Mystical levitating golden crystal above altar
  const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 0.42, 6), mats.basalt);
  altar.position.set(0, 0.36, 1.38);
  group.add(altar);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), mats.amberGlow);
  crystal.position.set(0, 1.25, 1.38);
  crystal.scale.set(0.75, 1.35, 0.75);
  group.add(crystal);

  return {
    group,
    update: (t, _dt, snap) => {
      const readyBoost = snap?.freeBoneReady ? 1.55 : 1.0;
      crystal.rotation.y = t * 1.35 * readyBoost;
      crystal.position.y = 1.22 + Math.sin(t * 2.4 * readyBoost) * 0.16;
      const sc = snap?.freeBoneReady ? 1.0 + Math.sin(t * 4.5) * 0.12 : 1.0;
      crystal.scale.set(0.75 * sc, 1.35 * sc, 0.75 * sc);
    }
  };
}

function buildWorkshop(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 3.6, 3.3, mats, true);

  // Shamanic painted hide tipi
  const tipi = new THREE.Mesh(new THREE.ConeGeometry(1.18, 2.15, 10), mats.tipi);
  tipi.position.y = 1.23;
  tipi.castShadow = true;
  tipi.receiveShadow = true;
  group.add(tipi);

  // Protruding wooden tipi poles at spire
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 0.85, 5), mats.woodDark);
    pole.position.set(Math.sin(a) * 0.12, 2.38, Math.cos(a) * 0.12);
    pole.rotation.set(Math.cos(a) * 0.32, 0, -Math.sin(a) * 0.32);
    group.add(pole);
  }

  // Tent entrance glow
  const flap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.78, 3), mats.amberGlow);
  flap.position.set(0, 0.54, 0.84);
  group.add(flap);

  // Orbiting obsidian/amber rune stones around the spire
  const runeOrbit = new THREE.Group();
  runeOrbit.position.y = 1.95;
  group.add(runeOrbit);

  const runes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), mats.runeGlow);
    rune.position.set(Math.cos(a) * 0.92, 0, Math.sin(a) * 0.92);
    rune.scale.set(0.75, 1.3, 0.75);
    runeOrbit.add(rune);
    runes.push(rune);
  }

  return {
    group,
    update: (t, _dt, snap) => {
      const active = Boolean(snap?.isResearching);
      runeOrbit.rotation.y = t * (active ? 2.4 : 0.85);
      for (let i = 0; i < runes.length; i++) {
        runes[i].position.y = Math.sin(t * (active ? 4.2 : 1.9) + i * 2.1) * 0.18;
        runes[i].rotation.x = t * 1.4 + i;
      }
      mats.runeGlow.emissiveIntensity = active ? 2.4 + Math.sin(t * 5.0) * 0.5 : 1.35;
    }
  };
}

function buildScout(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 3.2, 3.0, mats, true);

  // 4 Tall angled corner watchtower legs
  const legGeo = new THREE.CylinderGeometry(0.08, 0.11, 2.5, 6);
  const corners: [number, number][] = [
    [-0.58, -0.58],
    [0.58, -0.58],
    [0.58, 0.58],
    [-0.58, 0.58]
  ];
  for (const [cx, cz] of corners) {
    const leg = new THREE.Mesh(legGeo, mats.woodDark);
    leg.position.set(cx * 0.85, 1.38, cz * 0.85);
    leg.rotation.z = cx > 0 ? 0.1 : -0.1;
    leg.rotation.x = cz > 0 ? -0.1 : 0.1;
    leg.castShadow = true;
    group.add(leg);
  }

  // Lookout deck platform & railings
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.14, 1.42), mats.wood);
  deck.position.y = 2.45;
  deck.castShadow = true;
  group.add(deck);

  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.1, 0.08), mats.woodDark);
    rail.position.set(Math.sin(a) * 0.66, 2.86, Math.cos(a) * 0.66);
    rail.rotation.y = a;
    group.add(rail);
  }

  // Thatched roof canopy
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.06, 0.72, 4), mats.thatch);
  roof.position.y = 3.62;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  // Sweeping signal flame lantern on lookout
  const beaconPivot = new THREE.Group();
  beaconPivot.position.y = 2.75;
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), mats.flameInner);
  lantern.position.set(0.45, 0.15, 0);
  beaconPivot.add(lantern);
  group.add(beaconPivot);

  // Fluttering tribal banner hanging off tower side
  const bannerPivot = new THREE.Group();
  bannerPivot.position.set(0.75, 2.38, 0.45);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.85, 1, 3), mats.clothRed);
  banner.position.y = -0.42;
  bannerPivot.add(banner);
  group.add(bannerPivot);

  return {
    group,
    update: (t) => {
      beaconPivot.rotation.y = t * 1.15;
      bannerPivot.rotation.z = Math.sin(t * 3.4) * 0.16;
      bannerPivot.rotation.x = Math.cos(t * 2.6) * 0.1;
    }
  };
}

function buildInfirmary(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.2, 3.6, mats, true);

  // Vaulted pale-hide medical pavilion roof (half-cylinder ridge)
  const tentRoof = new THREE.Mesh(
    new THREE.CylinderGeometry(1.18, 1.24, 2.35, 10, 1, false, 0, Math.PI),
    mats.paleHide
  );
  tentRoof.rotation.z = Math.PI / 2;
  tentRoof.rotation.y = Math.PI / 2;
  tentRoof.position.set(-0.2, 0.88, -0.25);
  tentRoof.scale.set(1.0, 1.05, 1.12);
  tentRoof.castShadow = true;
  tentRoof.receiveShadow = true;
  group.add(tentRoof);

  // Side lower hide walls & timber support poles
  for (const sx of [-1.28, 0.88]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 2.25), mats.hide);
    wall.position.set(sx, 0.56, -0.25);
    wall.castShadow = true;
    group.add(wall);
    for (const sz of [-1.3, 0.82]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.068, 1.38, 6), mats.woodDark);
      pole.position.set(sx, 0.82, sz);
      pole.castShadow = true;
      group.add(pole);
    }
  }

  // Red-ochre healer's cross emblem above front arch
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.56, 0.08), mats.clothRed);
  crossV.position.set(-0.2, 1.68, 0.96);
  group.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.08), mats.clothRed);
  crossH.position.set(-0.2, 1.68, 0.96);
  group.add(crossH);

  // Two woven recovery cots inside pavilion
  for (const cx of [-0.68, 0.28]) {
    const cotFrame = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 1.18), mats.wood);
    cotFrame.position.set(cx, 0.34, -0.15);
    cotFrame.castShadow = true;
    group.add(cotFrame);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.78), mats.tunicA);
    blanket.position.set(cx, 0.44, -0.25);
    group.add(blanket);
  }

  // Herbal healing cauldron outside right side with glowing brew & rising steam
  const cauldron = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.28, 0.44, 8), mats.basaltDark);
  cauldron.position.set(1.42, 0.38, 0.45);
  cauldron.castShadow = true;
  group.add(cauldron);

  const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), mats.herbGlow);
  brew.position.set(1.42, 0.58, 0.45);
  group.add(brew);

  // Herbal drying rack behind cauldron
  const rackL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.18, 5), mats.woodDark);
  rackL.position.set(1.18, 0.72, -0.78);
  group.add(rackL);
  const rackR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.18, 5), mats.woodDark);
  rackR.position.set(1.78, 0.72, -0.78);
  group.add(rackR);
  const rackBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.74, 5), mats.wood);
  rackBar.rotation.z = Math.PI / 2;
  rackBar.position.set(1.48, 1.24, -0.78);
  group.add(rackBar);
  for (let i = 0; i < 3; i++) {
    const herb = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 5), mats.dinoGreen);
    herb.position.set(1.3 + i * 0.18, 1.02, -0.78);
    herb.rotation.z = Math.PI;
    group.add(herb);
  }

  const steamPuffs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14 + i * 0.03, 0), mats.smoke);
    puff.position.set(1.42, 0.75 + i * 0.34, 0.45);
    group.add(puff);
    steamPuffs.push(puff);
  }

  // Soft herbal-emerald healing aura ring around the pavilion floor (visible while healing is active)
  const healAuraMat = new THREE.MeshBasicMaterial({
    color: 0x4ade80,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const healAuraRing = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.92, 24), healAuraMat);
  healAuraRing.rotation.x = -Math.PI / 2;
  healAuraRing.position.set(0, 0.21, 0);
  healAuraRing.visible = false;
  group.add(healAuraRing);

  // Rising emerald healing motes floating above the recovery cots & pavilion during active healing
  const healMoteMat = new THREE.MeshBasicMaterial({
    color: 0x6ee7b7,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const healMotes: { mesh: THREE.Mesh; baseX: number; baseZ: number; phase: number }[] = [];
  const moteCoords: [number, number][] = [
    [-0.72, -0.1],
    [0.24, -0.2],
    [-0.22, 0.32],
    [0.72, 0.28],
    [1.36, 0.42],
    [-0.18, -0.58]
  ];
  for (let i = 0; i < moteCoords.length; i++) {
    const [mx, mz] = moteCoords[i];
    const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), healMoteMat);
    mote.position.set(mx, 0.65, mz);
    mote.visible = false;
    group.add(mote);
    healMotes.push({ mesh: mote, baseX: mx, baseZ: mz, phase: i / moteCoords.length });
  }

  // Rising volcanic ash-ember flecks dissipating off the tent when volcano-wounded soldiers are treated
  const volcAshMat = new THREE.MeshBasicMaterial({
    color: 0xfb923c,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const volcEmbers: { mesh: THREE.Mesh; baseX: number; baseZ: number; phase: number }[] = [];
  const emberCoords: [number, number][] = [
    [-0.6, 0.15],
    [0.25, -0.05],
    [-0.15, 0.45]
  ];
  for (let i = 0; i < emberCoords.length; i++) {
    const [ex, ez] = emberCoords[i];
    const ember = new THREE.Mesh(new THREE.DodecahedronGeometry(0.065, 0), volcAshMat);
    ember.position.set(ex, 0.9, ez);
    ember.visible = false;
    group.add(ember);
    volcEmbers.push({ mesh: ember, baseX: ex, baseZ: ez, phase: i * 0.34 });
  }

  return {
    group,
    update: (t, _dt, snap) => {
      const isActiveHeal = Boolean(snap?.isHealing);
      const hasWaiting = (snap?.injuredCount || 0) > 0;
      const hasVolcanoWounded = (snap?.volcanoInjuredCount || 0) > 0;
      const healing = isActiveHeal || hasWaiting;
      const speed = isActiveHeal ? 1.85 : hasWaiting ? 1.25 : 0.72;

      for (let i = 0; i < steamPuffs.length; i++) {
        const u = (t * 0.55 * speed + i * 0.33) % 1;
        steamPuffs[i].position.y = 0.68 + u * 1.15;
        steamPuffs[i].position.x = 1.42 + Math.sin(t * 2.1 + i * 1.9) * 0.1;
        steamPuffs[i].scale.setScalar(0.55 + u * 0.75);
      }
      mats.herbGlow.emissiveIntensity = isActiveHeal
        ? 2.6 + Math.sin(t * 5.2) * 0.55
        : hasWaiting
        ? 1.8 + Math.sin(t * 3.2) * 0.35
        : 1.15;

      healAuraRing.visible = isActiveHeal;
      if (isActiveHeal) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
        healAuraMat.opacity = 0.16 + pulse * 0.2;
        const s = 0.96 + pulse * 0.08;
        healAuraRing.scale.set(s, s, 1);
      }

      for (let i = 0; i < healMotes.length; i++) {
        const item = healMotes[i];
        item.mesh.visible = isActiveHeal;
        if (isActiveHeal) {
          const u = (t * 0.42 + item.phase) % 1;
          item.mesh.position.y = 0.65 + u * 2.05;
          item.mesh.position.x = item.baseX + Math.sin(t * 2.6 + i * 1.5) * 0.14;
          item.mesh.position.z = item.baseZ + Math.cos(t * 2.1 + i * 1.3) * 0.12;
          item.mesh.rotation.y = t * 2.2 + i;
          const sc = Math.sin(u * Math.PI) * 1.15;
          item.mesh.scale.setScalar(Math.max(0.01, sc));
        }
      }

      const showVolcAsh = isActiveHeal && hasVolcanoWounded;
      for (let i = 0; i < volcEmbers.length; i++) {
        const item = volcEmbers[i];
        item.mesh.visible = showVolcAsh;
        if (showVolcAsh) {
          const u = (t * 0.55 + item.phase) % 1;
          item.mesh.position.y = 0.95 + u * 1.85;
          item.mesh.position.x = item.baseX + Math.cos(t * 3.1 + i * 2.1) * 0.18;
          item.mesh.position.z = item.baseZ + Math.sin(t * 2.5 + i * 1.7) * 0.14;
          const sc = (1 - u) * 1.1;
          item.mesh.scale.setScalar(Math.max(0.01, sc));
        }
      }
    }
  };
}

function buildGraveyard(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.2, 3.7, mats, true);

  // Basalt entrance pillars & prehistoric curved rib-bone archway
  for (const px of [-0.95, 0.95]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.32, 0.36), mats.basaltDark);
    pillar.position.set(px, 0.78, 1.18);
    pillar.castShadow = true;
    group.add(pillar);
  }
  const boneArch = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.085, 6, 12, Math.PI), mats.bone);
  boneArch.position.set(0, 1.36, 1.18);
  boneArch.castShadow = true;
  group.add(boneArch);

  // Weathered memorial basalt headstones & stone cairns in crescent
  const graveSpecs: [number, number, number, number][] = [
    [-1.25, -0.35, 0.88, 0.12],
    [-0.78, -1.12, 1.02, -0.08],
    [0.82, -1.08, 0.96, 0.1],
    [1.28, -0.28, 0.84, -0.14]
  ];
  for (const [gx, gz, gh, rotZ] of graveSpecs) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.42, gh, 0.18), mats.mossStone);
    slab.position.set(gx, 0.16 + gh * 0.5, gz);
    slab.rotation.y = Math.atan2(-gx, -gz);
    slab.rotation.z = rotZ;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.16, 6), mats.dirtPad);
    mound.position.set(gx * 0.86, 0.2, gz + 0.36);
    group.add(mound);
  }

  // Central carved Schamanen-Totem altar
  const altarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.68, 0.28, 8), mats.basalt);
  altarBase.position.set(0, 0.26, -0.18);
  altarBase.castShadow = true;
  group.add(altarBase);

  const totemPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.85, 7), mats.woodDark);
  totemPole.position.set(0, 1.28, -0.18);
  totemPole.castShadow = true;
  group.add(totemPole);

  const totemWings = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 0.14), mats.bone);
  totemWings.position.set(0, 1.72, -0.18);
  totemWings.castShadow = true;
  group.add(totemWings);

  const totemSkull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), mats.bone);
  totemSkull.position.set(0, 2.26, -0.18);
  totemSkull.castShadow = true;
  group.add(totemSkull);

  // Floating spirit-jade wisps orbiting the Shaman Totem
  const wispOrbit = new THREE.Group();
  wispOrbit.position.set(0, 1.62, -0.18);
  group.add(wispOrbit);

  const wisps: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const wisp = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), mats.spiritGlow);
    wisp.position.set(Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78);
    wispOrbit.add(wisp);
    wisps.push(wisp);
  }

  return {
    group,
    update: (t, _dt, snap) => {
      const hasFallen = (snap?.fallenCount || 0) > 0;
      wispOrbit.rotation.y = t * (hasFallen ? 1.5 : 0.72);
      for (let i = 0; i < wisps.length; i++) {
        wisps[i].position.y = Math.sin(t * (hasFallen ? 3.2 : 1.7) + i * 2.1) * 0.22;
        wisps[i].scale.setScalar(hasFallen ? 1.15 + Math.sin(t * 4.0 + i) * 0.18 : 0.82);
      }
      mats.spiritGlow.emissiveIntensity = hasFallen ? 2.4 + Math.sin(t * 3.8) * 0.5 : 1.3;
    }
  };
}

function buildMarketplace(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.4, 3.7, mats, true);

  // 4 Timber pavilion corner posts
  for (const [px, pz] of [
    [-1.45, -1.05],
    [1.45, -1.05],
    [1.45, 0.92],
    [-1.45, 0.92]
  ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 1.72, 6), mats.woodDark);
    post.position.set(px, 0.98, pz);
    post.castShadow = true;
    group.add(post);
  }

  // Striped ochre & crimson pitched market awning panels
  for (let i = 0; i < 5; i++) {
    const stripeMat = i % 2 === 0 ? mats.awningGold : mats.clothRed;
    const x = -1.24 + i * 0.62;
    const panelF = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 1.28), stripeMat);
    panelF.position.set(x, 1.88, 0.5);
    panelF.rotation.x = 0.26;
    panelF.castShadow = true;
    group.add(panelF);

    const panelB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 1.28), stripeMat);
    panelB.position.set(x, 1.88, -0.58);
    panelB.rotation.x = -0.26;
    panelB.castShadow = true;
    group.add(panelB);
  }

  // Two stocked wooden barter tables & trade wares (amphorae, crates, fur rolls)
  for (const tx of [-0.72, 0.72]) {
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.56, 0.64), mats.wood);
    counter.position.set(tx, 0.44, 0.15);
    counter.castShadow = true;
    group.add(counter);
  }
  const pot1 = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.34, 8), mats.clayPot);
  pot1.position.set(-0.98, 0.88, 0.12);
  pot1.castShadow = true;
  group.add(pot1);
  const pot2 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.28, 8), mats.clayPot);
  pot2.position.set(-0.66, 0.85, 0.22);
  group.add(pot2);

  const furRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.46, 7), mats.paleHide);
  furRoll.rotation.z = Math.PI / 2;
  furRoll.position.set(0.62, 0.84, 0.12);
  group.add(furRoll);

  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.42), mats.woodDark);
  crate.position.set(1.02, 0.88, 0.16);
  group.add(crate);

  // Tall fluttering trade banner pole
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.75, 6), mats.woodDark);
  flagPole.position.set(-1.68, 1.5, 0.96);
  flagPole.castShadow = true;
  group.add(flagPole);

  const bannerPivot = new THREE.Group();
  bannerPivot.position.set(-1.68, 2.58, 0.96);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.42, 2, 1), mats.awningGold);
  banner.position.set(0.36, -0.05, 0);
  bannerPivot.add(banner);
  group.add(bannerPivot);

  // Glowing stamina brazier lantern at front center
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), mats.amberGlow);
  lantern.position.set(0, 1.55, 0.95);
  group.add(lantern);

  return {
    group,
    update: (t, _dt, snap) => {
      const ready = Boolean(snap?.hasMarketClaim);
      bannerPivot.rotation.y = Math.sin(t * 2.8) * 0.28;
      lantern.rotation.y = t * (ready ? 2.4 : 0.9);
      const pulse = ready ? 1.18 + Math.sin(t * 5.2) * 0.18 : 0.85;
      lantern.scale.setScalar(pulse);
    }
  };
}

function buildWarehouse(mats: SharedMaterials): {
  group: THREE.Group;
  update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
} {
  const group = new THREE.Group();
  addTerracePad(group, 4.4, 3.8, mats, true);

  // Heavy reinforced basalt vault structure
  const vaultBody = new THREE.Mesh(new THREE.BoxGeometry(2.55, 1.38, 2.05), mats.basalt);
  vaultBody.position.set(0, 0.85, -0.2);
  vaultBody.castShadow = true;
  vaultBody.receiveShadow = true;
  group.add(vaultBody);

  // Corner basalt buttresses for fortified safe-storage silhouette
  for (const [bx, bz] of [
    [-1.32, -1.24],
    [1.32, -1.24],
    [-1.32, 0.84],
    [1.32, 0.84]
  ]) {
    const buttress = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.46, 5), mats.basaltDark);
    buttress.position.set(bx, 0.88, bz);
    buttress.castShadow = true;
    group.add(buttress);
  }

  // Steep pitched timber & thatch roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, 1.15, 4), mats.thatch);
  roof.position.set(0, 2.08, -0.2);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.12, 1.0, 0.96);
  roof.castShadow = true;
  group.add(roof);

  // Heavy bronze-banded double vault door
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.02, 0.14), mats.woodDark);
  doorFrame.position.set(0, 0.67, 0.84);
  group.add(doorFrame);

  for (const yOff of [0.46, 0.88]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.09, 0.18), mats.bronze);
    band.position.set(0, yOff, 0.86);
    group.add(band);
  }
  const lockEmblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), mats.bronze);
  lockEmblem.position.set(0, 0.68, 0.96);
  lockEmblem.scale.set(1.0, 1.15, 0.55);
  group.add(lockEmblem);

  // Exterior stacked supply crates & barrels
  const crateA = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.44, 0.48), mats.wood);
  crateA.position.set(-1.32, 0.38, 1.24);
  crateA.castShadow = true;
  group.add(crateA);
  const barrelA = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.52, 8), mats.woodDark);
  barrelA.position.set(1.26, 0.42, 1.2);
  barrelA.castShadow = true;
  group.add(barrelA);
  const barrelBand = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.08, 8), mats.bronze);
  barrelBand.position.set(1.26, 0.46, 1.2);
  group.add(barrelBand);

  return {
    group,
    update: (t) => {
      // Subtle metallic glint oscillation on vault lock emblem
      lockEmblem.rotation.z = Math.sin(t * 1.1) * 0.05;
    }
  };
}

function buildVolcanicEnvironment(
  scene: THREE.Scene,
  mats: SharedMaterials,
  maxAniso: number
): { lavaPools: THREE.Mesh[]; villagers: VillagerAgent[] } {
  // Extended volcanic ground plane (extends far into horizon fog so no edges ever show)
  const { map, bumpMap } = createGroundTexture(maxAniso);
  const innerGround = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    new THREE.MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: 0.16,
      roughness: 0.94,
      metalness: 0.04
    })
  );
  innerGround.rotation.x = -Math.PI / 2;
  innerGround.receiveShadow = true;
  scene.add(innerGround);

  // Infinite outer volcanic apron seamlessly blending into fog
  const outerApron = new THREE.Mesh(
    new THREE.RingGeometry(25.2, 95, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.96, metalness: 0.02 })
  );
  outerApron.rotation.x = -Math.PI / 2;
  outerApron.position.y = -0.02;
  scene.add(outerApron);

  // Glowing volcanic lava fissures & magma pools ringing the outer rim (matches reference art)
  const lavaPools: THREE.Mesh[] = [];
  const fissureSpecs: [number, number, number, number, number][] = [
    [-14.2, -13.2, 4.4, 0.92, 0.45],
    [14.0, -12.6, 4.0, 0.85, -0.55],
    [-14.6, 1.5, 3.6, 0.72, 1.15],
    [14.8, 2.2, 3.4, 0.7, -1.2],
    [-12.2, 15.2, 4.8, 1.05, 0.25],
    [1.8, 15.8, 5.2, 1.15, -0.15],
    [12.8, 14.8, 4.5, 0.98, -0.38],
    [-6.2, -14.8, 4.4, 0.82, 0.18],
    [6.6, -14.6, 4.2, 0.85, -0.22]
  ];
  for (const [fx, fz, fw, fd, rot] of fissureSpecs) {
    const fissure = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), mats.lava);
    fissure.rotation.x = -Math.PI / 2;
    fissure.rotation.z = rot;
    fissure.position.set(fx, 0.03, fz);
    scene.add(fissure);
    lavaPools.push(fissure);
  }

  // Instanced jagged obsidian cliff rocks around perimeter
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x413935, roughness: 0.92, metalness: 0.06 });
  const rockCount = 72;
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockInst.castShadow = true;
  rockInst.receiveShadow = true;

  let seed = 4201;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + (rand() - 0.5) * 0.14;
    const distX = 14.6 + rand() * 7.5;
    const distZ = 15.2 + rand() * 6.5;
    const rx = Math.cos(angle) * distX;
    const rz = Math.sin(angle) * distZ;
    const sx = 1.1 + rand() * 2.2;
    const sy = 0.8 + rand() * 2.1;
    const sz = 1.1 + rand() * 2.0;
    _dummy.position.set(rx, sy * 0.38, rz);
    _dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    rockInst.setMatrixAt(i, _dummy.matrix);
    _colorA.setRGB(0.24 + rand() * 0.14, 0.21 + rand() * 0.12, 0.19 + rand() * 0.11);
    rockInst.setColorAt(i, _colorA);
  }
  rockInst.instanceMatrix.needsUpdate = true;
  if (rockInst.instanceColor) rockInst.instanceColor.needsUpdate = true;
  scene.add(rockInst);

  // Decorative wooden fence segments & stacked firewood near central paths
  const fenceLocations: [number, number, number][] = [
    [-3.1, -1.7, 0.35],
    [3.8, 1.3, -0.45],
    [9.2, 6.2, 0.52]
  ];
  for (const [fx, fz, rot] of fenceLocations) {
    const fg = new THREE.Group();
    fg.position.set(fx, 0, fz);
    fg.rotation.y = rot;
    for (const px of [-0.7, 0, 0.7]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.75, 5), mats.woodDark);
      post.position.set(px, 0.37, 0);
      post.castShadow = true;
      fg.add(post);
    }
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.07), mats.wood);
    bar1.position.y = 0.56;
    fg.add(bar1);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.07), mats.wood);
    bar2.position.y = 0.3;
    fg.add(bar2);
    scene.add(fg);
  }

  // Instanced charred volcanic dead trees framing the valley rim
  const treeCount = 26;
  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.16, 1.85, 5);
  const trunkInst = new THREE.InstancedMesh(trunkGeo, mats.woodDark, treeCount);
  trunkInst.castShadow = true;
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2 + 0.25;
    const rx = Math.cos(a) * (13.6 + rand() * 5.2);
    const rz = Math.sin(a) * (14.4 + rand() * 4.5);
    const sc = 0.8 + rand() * 0.8;
    _dummy.position.set(rx, 0.85 * sc, rz);
    _dummy.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25);
    _dummy.scale.set(sc, sc, sc);
    _dummy.updateMatrix();
    trunkInst.setMatrixAt(i, _dummy.matrix);
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  scene.add(trunkInst);

  // Animated tribal villagers strolling between the central bonfire & workplaces
  const routes: [THREE.Vector2, THREE.Vector2][] = [
    [new THREE.Vector2(-1.6, 1.8), new THREE.Vector2(3.6, -3.2)],
    [new THREE.Vector2(1.8, 1.4), new THREE.Vector2(-4.8, -1.2)],
    [new THREE.Vector2(-2.2, 0.6), new THREE.Vector2(-4.5, 4.2)],
    [new THREE.Vector2(2.4, 0.2), new THREE.Vector2(4.8, 3.6)],
    [new THREE.Vector2(0.4, 2.4), new THREE.Vector2(-2.8, 6.8)],
    [new THREE.Vector2(-0.8, -2.5), new THREE.Vector2(-3.2, -4.8)],
    [new THREE.Vector2(1.4, -2.4), new THREE.Vector2(4.8, -1.0)],
    [new THREE.Vector2(0.0, 2.8), new THREE.Vector2(2.6, 7.2)]
  ];

  const villagers: VillagerAgent[] = [];
  for (let i = 0; i < routes.length; i++) {
    const fig = createTribalFigure(mats, i % 2 === 0 ? mats.tunicA : mats.tunicB, false);
    fig.group.scale.setScalar(0.86);
    scene.add(fig.group);
    villagers.push({
      group: fig.group,
      leftLeg: fig.leftLeg,
      rightLeg: fig.rightLeg,
      from: routes[i][0],
      to: routes[i][1],
      progress: (i * 0.27) % 1,
      speed: 0.11 + (i % 3) * 0.025,
      dir: i % 2 === 0 ? 1 : -1,
      phase: i * 1.4
    });
  }

  return { lavaPools, villagers };
}

class Village3DController implements Village3DAPI {
  private mountEl: HTMLElement | null = null;
  private labelLayerEl: HTMLElement | null = null;
  private onSelectBuilding: ((id: BuildingId) => void) | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private isSoftGl = false;
  private visible = true;
  private initialized = false;
  private rafHandle = 0;
  private lastTime = 0;
  private elapsed = 0;

  private rigs = new Map<BuildingId, BuildingRig>();
  private labelEls = new Map<BuildingId, HTMLButtonElement>();
  private hitMeshes: THREE.Mesh[] = [];
  private hoveredId: BuildingId | null = null;

  private lavaPools: THREE.Mesh[] = [];
  private villagers: VillagerAgent[] = [];
  private bonfireLight: THREE.PointLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private fog: THREE.FogExp2 | null = null;

  // 3D Bonfire rising ember particles
  private emberInst: THREE.InstancedMesh | null = null;
  private emberMotes: EmberMote[] = [];

  // Camera pan & zoom state (direction strictly locked!)
  private panX = 0;
  private panZ = 0.6;
  private targetPanX = 0;
  private targetPanZ = 0.6;
  private zoomDist = 22.8;
  private targetZoomDist = 22.8;

  // Pointer drag / pinch state
  private activePointers = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private dragMoved = false;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginPanX = 0;
  private dragOriginPanZ = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 22.8;

  private lastSnapshot: VillageSnapshot = {
    ember: 100,
    overheat: false,
    autoFeedActive: true,
    weatherPhase: 'calm',
    weatherType: 'cold',
    popTotal: 10,
    buildings: []
  };
  private snapMap = new Map<BuildingId, BuildingSnapshot>();

  public init(
    mountEl: HTMLElement,
    labelLayerEl: HTMLElement,
    callbacks: { onSelectBuilding: (id: BuildingId) => void }
  ): void {
    if (this.initialized) return;
    this.mountEl = mountEl;
    this.labelLayerEl = labelLayerEl;
    this.onSelectBuilding = callbacks.onSelectBuilding;
    this.isSoftGl = detectSoftwareWebGL();

    const width = Math.max(1, mountEl.clientWidth || 380);
    const height = Math.max(1, mountEl.clientHeight || 620);

    const renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftGl,
      powerPreference: 'high-performance',
      alpha: false
    });
    renderer.setPixelRatio(this.isSoftGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !this.isSoftGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    mountEl.innerHTML = '';
    mountEl.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16110e);
    this.fog = new THREE.FogExp2(0x18120e, 0.0155);
    scene.fog = this.fog;
    this.scene = scene;

    // Mandatory PMREM RoomEnvironment for rich PBR specular response on all devices
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.62;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.5, 160);
    camera.layers.enable(0);
    this.camera = camera;

    // Warm-cool 3-point volcanic twilight lighting
    const hemi = new THREE.HemisphereLight(0x9fb8d8, 0x3b2618, 0.72);
    scene.add(hemi);
    this.hemiLight = hemi;

    const key = new THREE.DirectionalLight(0xffd7b0, 1.48);
    key.position.set(14, 24, 15);
    key.castShadow = !this.isSoftGl;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 65;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.025;
    scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x88b4e6, 0.45);
    rim.position.set(-15, 12, -16);
    scene.add(rim);

    // Central Signalfeuer flickering warm PointLight
    const fireLight = new THREE.PointLight(0xff7a22, 16, 20, 1.55);
    fireLight.position.set(0, 3.2, 0);
    scene.add(fireLight);
    this.bonfireLight = fireLight;

    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mats = createSharedMaterials(maxAniso);

    // Build terrain, lava fissures, perimeter cliffs, dead trees, and strolling villagers
    const env = buildVolcanicEnvironment(scene, mats, maxAniso);
    this.lavaPools = env.lavaPools;
    this.villagers = env.villagers;

    // Build all 11 animated composite 3D buildings
    this.buildAllBuildings(scene, mats);

    // 3D rising bonfire embers via InstancedMesh
    this.initEmberParticles(scene);

    // Adjust initial zoom for narrow portrait vs wider viewport
    const initialZoom = width < 440 ? 23.6 : 20.5;
    this.zoomDist = initialZoom;
    this.targetZoomDist = initialZoom;
    this.applyCameraTransform();

    this.bindInputEvents(renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mountEl);

    this.initialized = true;
    this.lastTime = performance.now();
    this.syncState(this.lastSnapshot);
    this.scheduleNextFrame();
  }

  private buildAllBuildings(scene: THREE.Scene, mats: SharedMaterials): void {
    const builders: Record<
      BuildingId,
      () => {
        group: THREE.Group;
        update: (t: number, dt: number, snap: BuildingSnapshot | undefined, g: VillageSnapshot) => void;
      }
    > = {
      bonfire: () => buildBonfire(mats),
      hut: () => buildHutCluster(mats),
      quarry: () => buildQuarry(mats),
      lumber: () => buildLumber(mats),
      hunter: () => buildHunter(mats),
      slinger: () => buildSlinger(mats),
      clubman: () => buildClubman(mats),
      dinorider: () => buildDinorider(mats),
      hero_cave: () => buildHeroCave(mats),
      workshop: () => buildWorkshop(mats),
      scout: () => buildScout(mats),
      infirmary: () => buildInfirmary(mats),
      graveyard: () => buildGraveyard(mats),
      marketplace: () => buildMarketplace(mats),
      warehouse: () => buildWarehouse(mats)
    };

    for (const id of BUILDING_IDS) {
      const lay = BUILDING_LAYOUTS[id];
      const root = new THREE.Group();
      root.position.set(lay.x, 0, lay.z);

      addContactShadow(root, lay.radius, mats);

      const built = builders[id]();
      root.add(built.group);

      const unbuilt = createUnbuiltPlot(lay.radius, mats);
      unbuilt.visible = false;
      root.add(unbuilt);

      const scaffold = createScaffoldOverlay(lay.radius, mats);
      root.add(scaffold.group);

      // Dedicated raycast hit cylinder on Layer 1 so raycasts never touch visual submeshes
      const hitMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(lay.radius * 0.92, lay.radius * 1.0, lay.hitHeight, 8),
        mats.hitMat
      );
      hitMesh.position.y = lay.hitHeight * 0.5;
      hitMesh.layers.set(1);
      hitMesh.userData.buildingId = id;
      root.add(hitMesh);
      this.hitMeshes.push(hitMesh);

      scene.add(root);

      const rig: BuildingRig = {
        id,
        root,
        builtGroup: built.group,
        unbuiltGroup: unbuilt,
        scaffoldGroup: scaffold.group,
        hitMesh,
        labelAnchor: new THREE.Vector3(lay.x, lay.labelOffsetY, lay.z + lay.labelOffsetZ),
        baseScale: 1,
        hoverAmount: 0,
        animate: (t, dt, snap, g) => {
          if (snap && snap.level > 0) {
            built.update(t, dt, snap, g);
          }
          if (scaffold.group.visible) {
            scaffold.hammerPivot.rotation.z = -0.3 + Math.sin(t * 7.2) * 0.55;
          }
        }
      };

      this.rigs.set(id, rig);
    }
  }

  private initEmberParticles(scene: THREE.Scene): void {
    const count = 42;
    const geo = new THREE.OctahedronGeometry(0.06, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa642 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    scene.add(inst);
    this.emberInst = inst;

    for (let i = 0; i < count; i++) {
      this.emberMotes.push({
        x: (Math.random() - 0.5) * 1.4,
        y: 2.0 + Math.random() * 4.5,
        z: (Math.random() - 0.5) * 1.4,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.9 + Math.random() * 1.4,
        vz: (Math.random() - 0.5) * 0.5,
        age: Math.random() * 2.5,
        life: 1.8 + Math.random() * 1.8,
        size: 0.65 + Math.random() * 0.85
      });
    }
  }

  public syncState(snapshot: VillageSnapshot): void {
    this.lastSnapshot = snapshot;
    this.snapMap.clear();
    for (const b of snapshot.buildings) {
      this.snapMap.set(b.id, b);
    }

    if (!this.initialized || !this.labelLayerEl) return;

    // Update 3D building visibility & state (hidden until unlocked, built vs unbuilt plot, scaffolding, subtle level scale)
    for (const b of snapshot.buildings) {
      const rig = this.rigs.get(b.id);
      if (!rig) continue;
      const isVisibleInUi = b.isVisible !== false;
      const isBuilt = b.level > 0;

      rig.root.visible = isVisibleInUi;
      rig.hitMesh.visible = isVisibleInUi;
      rig.builtGroup.visible = isVisibleInUi && isBuilt;
      rig.unbuiltGroup.visible = isVisibleInUi && !isBuilt;
      rig.scaffoldGroup.visible = isVisibleInUi && b.isBuilding;
      rig.baseScale = isBuilt ? Math.min(1.12, 1.0 + Math.max(0, b.level - 1) * 0.018) : 1.0;

      let btn = this.labelEls.get(b.id);
      if (!isVisibleInUi) {
        if (this.hoveredId === b.id) this.hoveredId = null;
        if (btn) {
          btn.style.display = 'none';
          btn.style.opacity = '0';
          btn.style.pointerEvents = 'none';
          btn.setAttribute('aria-hidden', 'true');
        }
        continue;
      }

      // Create or update floating HTML label plate without destroying DOM node
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.building = b.id;
        btn.className = 'b-node b-node-3d';
        this.labelLayerEl.appendChild(btn);
        this.labelEls.set(b.id, btn);
      }
      btn.style.display = '';
      btn.removeAttribute('aria-hidden');

      const classes = [
        'b-node',
        'b-node-3d',
        b.isMain ? 'is-bonfire' : '',
        b.isHeroCave ? 'is-hero-cave' : '',
        b.level === 0 ? 'unbuilt' : '',
        b.isLocked ? 'locked-node' : ''
      ]
        .filter(Boolean)
        .join(' ');
      if (btn.className !== classes) btn.className = classes;
      btn.setAttribute('aria-label', `${b.name}, Stufe ${b.level}`);

      const lockBadge = b.isLocked
        ? `<span class="b-lock-badge" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>`
        : '';

      const progBar =
        b.progressPct !== null
          ? `<div class="b-mini-progress"><div class="b-mini-progress-fill" style="width:${b.progressPct.toFixed(1)}%"></div></div>`
          : '';

      const nextHtml = `<div class="b-caption">${lockBadge}<span class="b-name">${b.shortName}</span><span class="b-meta ${b.metaClass}">${b.metaText}</span>${progBar}</div>`;
      if (btn.innerHTML !== nextHtml) {
        btn.innerHTML = nextHtml;
      }
    }

    this.updateLabelPositions();
  }

  public setVisible(visible: boolean): void {
    const wasVisible = this.visible;
    this.visible = visible;
    if (visible && !wasVisible && this.initialized) {
      this.resize();
      this.lastTime = performance.now();
      this.scheduleNextFrame();
    }
  }

  public centerOn(id?: BuildingId): void {
    if (id && BUILDING_LAYOUTS[id]) {
      this.targetPanX = THREE.MathUtils.clamp(BUILDING_LAYOUTS[id].x, PAN_BOUNDS.minX, PAN_BOUNDS.maxX);
      this.targetPanZ = THREE.MathUtils.clamp(BUILDING_LAYOUTS[id].z + 0.5, PAN_BOUNDS.minZ, PAN_BOUNDS.maxZ);
    } else {
      this.targetPanX = 0;
      this.targetPanZ = 0.6;
    }
  }

  public isDragging(): boolean {
    return this.dragMoved;
  }

  public resize(): void {
    if (!this.renderer || !this.camera || !this.mountEl) return;
    const width = Math.max(1, this.mountEl.clientWidth);
    const height = Math.max(1, this.mountEl.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.updateLabelPositions();
  }

  private bindInputEvents(canvas: HTMLCanvasElement): void {
    const stageEl = this.mountEl?.parentElement || canvas;

    const isHudTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest('.village-status-strip') ||
          target.closest('.village-queue-bar') ||
          target.closest('.village-center-btn')
      );
    };

    stageEl.addEventListener('pointerdown', (e) => {
      if (isHudTarget(e.target)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pinchStartZoom = this.targetZoomDist;
        this.dragging = false;
        this.dragMoved = true;
        return;
      }

      if (this.activePointers.size === 1) {
        this.dragging = true;
        this.dragMoved = false;
        this.dragPointerId = e.pointerId;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragOriginPanX = this.targetPanX;
        this.dragOriginPanZ = this.targetPanZ;
      }
    });

    stageEl.addEventListener('pointermove', (e) => {
      if (this.activePointers.has(e.pointerId)) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Two-finger pinch zoom (strictly along fixed camera viewing direction)
      if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinchStartDist > 10) {
          const ratio = this.pinchStartDist / Math.max(10, dist);
          this.targetZoomDist = THREE.MathUtils.clamp(
            this.pinchStartZoom * ratio,
            ZOOM_BOUNDS.min,
            ZOOM_BOUNDS.max
          );
        }
        return;
      }

      if (this.dragging && e.pointerId === this.dragPointerId) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        if (!this.dragMoved && Math.hypot(dx, dy) > 6) {
          this.dragMoved = true;
          this.mountEl?.classList.add('is-dragging');
          try {
            stageEl.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }
        if (this.dragMoved && this.mountEl) {
          // Convert pixel drag into accurate ground-plane world pan matching camera FOV & distance
          const viewH = Math.max(240, this.mountEl.clientHeight);
          const worldPerPx = (2 * this.zoomDist * Math.tan(THREE.MathUtils.degToRad(18))) / viewH;
          const worldPerPxZ = worldPerPx * 1.32;
          this.targetPanX = THREE.MathUtils.clamp(
            this.dragOriginPanX - dx * worldPerPx,
            PAN_BOUNDS.minX,
            PAN_BOUNDS.maxX
          );
          this.targetPanZ = THREE.MathUtils.clamp(
            this.dragOriginPanZ - dy * worldPerPxZ,
            PAN_BOUNDS.minZ,
            PAN_BOUNDS.maxZ
          );
        }
        return;
      }

      // Desktop hover raycast for subtle highlight + cursor
      if (e.pointerType === 'mouse' && !this.dragging && !isHudTarget(e.target)) {
        const hit = this.pickBuilding(e.clientX, e.clientY);
        this.hoveredId = hit;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    });

    const endPointer = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (e.pointerId === this.dragPointerId) {
        const wasMoved = this.dragMoved;
        this.dragging = false;
        this.dragPointerId = null;
        this.mountEl?.classList.remove('is-dragging');
        try {
          if (stageEl.hasPointerCapture(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        const clickedLabel = e.target instanceof Element && Boolean(e.target.closest('[data-building]'));
        if (!wasMoved && !clickedLabel && !isHudTarget(e.target)) {
          const hit = this.pickBuilding(e.clientX, e.clientY);
          if (hit && this.onSelectBuilding) {
            this.onSelectBuilding(hit);
          }
        } else if (wasMoved) {
          window.setTimeout(() => {
            this.dragMoved = false;
          }, 0);
        }
      }
      if (this.activePointers.size === 0) {
        this.dragging = false;
      }
    };

    stageEl.addEventListener('pointerup', endPointer);
    stageEl.addEventListener('pointercancel', endPointer);
    stageEl.addEventListener('pointerleave', () => {
      this.hoveredId = null;
    });

    // Mouse wheel subtle zoom along the exact fixed viewing direction
    stageEl.addEventListener(
      'wheel',
      (e) => {
        if (isHudTarget(e.target)) return;
        e.preventDefault();
        const delta = Math.sign(e.deltaY) * 1.6;
        this.targetZoomDist = THREE.MathUtils.clamp(
          this.targetZoomDist + delta,
          ZOOM_BOUNDS.min,
          ZOOM_BOUNDS.max
        );
      },
      { passive: false }
    );
  }

  private pickBuilding(clientX: number, clientY: number): BuildingId | null {
    if (!this.camera || !this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    _raycaster.setFromCamera(_pointer, this.camera);
    _raycaster.layers.set(1);
    const hits = _raycaster.intersectObjects(this.hitMeshes, false);
    for (const hit of hits) {
      const id = hit.object.userData.buildingId as BuildingId | undefined;
      if (!id) continue;
      const bSnap = this.snapMap.get(id);
      if (bSnap && bSnap.isVisible === false) continue;
      const rig = this.rigs.get(id);
      if (rig && !rig.root.visible) continue;
      return id;
    }
    return null;
  }

  private applyCameraTransform(): void {
    if (!this.camera) return;
    this.camera.position.set(
      this.panX + FIXED_CAM_DIR.x * this.zoomDist,
      FIXED_CAM_DIR.y * this.zoomDist,
      this.panZ + FIXED_CAM_DIR.z * this.zoomDist
    );
    this.camera.lookAt(this.panX, 0, this.panZ);
  }

  private updateLabelPositions(): void {
    if (!this.camera || !this.mountEl) return;
    const width = this.mountEl.clientWidth;
    const height = this.mountEl.clientHeight;
    if (width <= 0 || height <= 0) return;

    this.camera.updateMatrixWorld();

    for (const [id, rig] of this.rigs) {
      const btn = this.labelEls.get(id);
      if (!btn) continue;
      const bSnap = this.snapMap.get(id);
      if (!rig.root.visible || (bSnap && bSnap.isVisible === false)) {
        btn.style.display = 'none';
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
        continue;
      }
      btn.style.display = '';

      _vec3.copy(rig.labelAnchor).project(this.camera);
      const sx = (_vec3.x * 0.5 + 0.5) * width;
      const sy = (-_vec3.y * 0.5 + 0.5) * height;
      const onScreen = _vec3.z < 1 && sx > -70 && sx < width + 70 && sy > 36 && sy < height + 30;

      if (!onScreen) {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
      } else {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -35%)`;
        btn.style.zIndex = String(Math.round(sy));
      }
    }
  }

  private scheduleNextFrame(): void {
    if (!this.visible || !this.renderer) return;
    if (this.isSoftGl) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const tick = () => this.renderFrame();
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) {
          gl.flush();
          const poll = () => {
            if (!this.visible) {
              gl.deleteSync(sync);
              return;
            }
            const status = gl.clientWaitSync(sync, 0, 0);
            if (status === gl.TIMEOUT_EXPIRED) {
              window.setTimeout(poll, 16);
              return;
            }
            gl.deleteSync(sync);
            window.setTimeout(() => {
              if (this.visible) this.rafHandle = requestAnimationFrame(tick);
            }, 80);
          };
          poll();
          return;
        }
      }
      window.setTimeout(() => {
        if (this.visible) this.rafHandle = requestAnimationFrame(tick);
      }, 95);
    } else {
      this.rafHandle = requestAnimationFrame(() => this.renderFrame());
    }
  }

  private renderFrame(): void {
    if (!this.visible || !this.renderer || !this.scene || !this.camera) return;

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;
    const t = this.elapsed;

    // Smooth camera pan & zoom damping (fixed viewing direction preserved)
    this.panX = THREE.MathUtils.damp(this.panX, this.targetPanX, 9.5, dt);
    this.panZ = THREE.MathUtils.damp(this.panZ, this.targetPanZ, 9.5, dt);
    this.zoomDist = THREE.MathUtils.damp(this.zoomDist, this.targetZoomDist, 9.0, dt);
    this.applyCameraTransform();

    // Update dynamic weather atmosphere & bonfire PointLight
    const snap = this.lastSnapshot;
    const emberNorm = Math.max(0.08, snap.ember / 100);
    const overheatActive = snap.overheat && snap.autoFeedActive;

    if (this.bonfireLight) {
      const baseInt = (overheatActive ? 26 : 15) * emberNorm * (snap.autoFeedActive ? 1 : 0.35);
      this.bonfireLight.intensity = baseInt * (0.9 + Math.sin(t * 10.7) * 0.1 + Math.sin(t * 16.3) * 0.06);
      this.bonfireLight.distance = overheatActive ? 25 : 19;
    }

    // Weather-driven fog & hemisphere light tinting
    const isStorm = snap.weatherPhase === 'storm';
    const isColdStorm = isStorm && snap.weatherType === 'cold';
    const isAshStorm = isStorm && snap.weatherType !== 'cold';

    if (this.fog && this.scene.background instanceof THREE.Color) {
      _colorA.setHex(isColdStorm ? 0x15202b : isAshStorm ? 0x241913 : 0x18120e);
      this.fog.color.lerp(_colorA, Math.min(1, dt * 2.2));
      this.scene.background.copy(this.fog.color);
      const targetDensity = isAshStorm ? 0.022 : isColdStorm ? 0.0185 : 0.0145;
      this.fog.density = THREE.MathUtils.damp(this.fog.density, targetDensity, 2.5, dt);
    }

    if (this.hemiLight && this.keyLight) {
      _colorB.setHex(isColdStorm ? 0x7cb8e8 : isAshStorm ? 0xc28a62 : 0x9fb8d8);
      this.hemiLight.color.lerp(_colorB, Math.min(1, dt * 2.2));
      this.keyLight.intensity = THREE.MathUtils.damp(this.keyLight.intensity, isAshStorm ? 1.15 : 1.48, 2.5, dt);
    }

    // Animate visible buildings + hover polish
    for (const [id, rig] of this.rigs) {
      if (!rig.root.visible) continue;
      const bSnap = this.snapMap.get(id);
      rig.animate(t, dt, bSnap, snap);
      const targetHover = this.hoveredId === id ? 1 : 0;
      rig.hoverAmount = THREE.MathUtils.damp(rig.hoverAmount, targetHover, 12, dt);
      const s = rig.baseScale * (1 + rig.hoverAmount * 0.038);
      rig.root.scale.setScalar(s);
    }

    // Animate strolling tribal villagers (scales with constructed village buildings)
    let builtCount = 0;
    for (const b of snap.buildings) {
      if (b.level > 0) builtCount++;
    }
    for (let i = 0; i < this.villagers.length; i++) {
      const v = this.villagers[i];
      const showVillager = i < 2 || i < builtCount;
      v.group.visible = showVillager;
      if (!showVillager) continue;
      v.progress += v.speed * dt * v.dir;
      if (v.progress >= 1) {
        v.progress = 1;
        v.dir = -1;
      } else if (v.progress <= 0) {
        v.progress = 0;
        v.dir = 1;
      }
      const x = THREE.MathUtils.lerp(v.from.x, v.to.x, v.progress);
      const z = THREE.MathUtils.lerp(v.from.y, v.to.y, v.progress);
      const dx = (v.to.x - v.from.x) * v.dir;
      const dz = (v.to.y - v.from.y) * v.dir;
      const walk = t * 9.0 + v.phase;
      v.group.position.set(x, Math.abs(Math.sin(walk)) * 0.05, z);
      v.group.rotation.y = Math.atan2(dx, dz);
      v.leftLeg.rotation.x = Math.sin(walk) * 0.45;
      v.rightLeg.rotation.x = -Math.sin(walk) * 0.45;
    }

    // Animate 3D bonfire rising ember sparks
    if (this.emberInst) {
      const speedMul = overheatActive ? 1.55 : snap.autoFeedActive ? 1.0 : 0.4;
      for (let i = 0; i < this.emberMotes.length; i++) {
        const m = this.emberMotes[i];
        m.age += dt * speedMul;
        if (m.age >= m.life) {
          m.age = 0;
          m.x = (Math.random() - 0.5) * 1.1;
          m.y = 2.0 + Math.random() * 0.35;
          m.z = (Math.random() - 0.5) * 1.1;
        } else {
          m.x += (m.vx + Math.sin(t * 2.5 + i) * 0.32) * dt;
          m.y += m.vy * speedMul * dt;
          m.z += (m.vz + Math.cos(t * 2.1 + i) * 0.28) * dt;
        }
        const fade = Math.max(0, 1 - m.age / m.life);
        const s = m.size * fade * (overheatActive ? 1.25 : 0.9) * emberNorm;
        _dummy.position.set(m.x, m.y, m.z);
        _dummy.rotation.set(t + i, t * 1.3, 0);
        _dummy.scale.setScalar(Math.max(0.001, s));
        _dummy.updateMatrix();
        this.emberInst.setMatrixAt(i, _dummy.matrix);
      }
      this.emberInst.instanceMatrix.needsUpdate = true;
    }

    // Subtle lava fissure pulse
    for (let i = 0; i < this.lavaPools.length; i++) {
      this.lavaPools[i].position.y = 0.025 + Math.sin(t * 1.8 + i) * 0.008;
    }

    this.renderer.render(this.scene, this.camera);
    this.updateLabelPositions();
    this.scheduleNextFrame();
  }
}

const village3d = new Village3DController();
window.Village3D = village3d;
window.dispatchEvent(new CustomEvent('village3d-ready'));
