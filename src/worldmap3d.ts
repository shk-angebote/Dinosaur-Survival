import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface WorldMapSettlementItem {
  id: string;
  isOwn: boolean;
  wx: number;
  wy: number;
  bonfireLevel: number;
  tribeName: string;
}

export interface WorldMapNodeItem {
  id: string;
  resource: 'wood' | 'stone' | 'meat' | 'fur' | string;
  level: number;
  wx: number;
  wy: number;
  depleted: boolean;
  activeGather: boolean;
  enemyOccupied: boolean;
}

export interface WorldMapDinoItem {
  id: string;
  speciesId: string;
  level: number;
  accent: string;
  wx: number;
  wy: number;
  respawning: boolean;
  activeHunt: boolean;
}

export interface WorldMapTeleportGhostState {
  active: boolean;
  anchorX: number;
  anchorY: number;
  valid: boolean;
}

export interface WorldMapVolcanoState {
  phase: 'battle' | 'peace';
  holderStatus: 'neutral' | 'own' | 'enemy';
}

export interface WorldMapEntitiesPayload {
  settlements: WorldMapSettlementItem[];
  nodes: WorldMapNodeItem[];
  dinos: WorldMapDinoItem[];
  teleportGhost: WorldMapTeleportGhostState;
  volcano?: WorldMapVolcanoState;
}

export interface WorldMapPickResult {
  kind: 'home' | 'player' | 'node' | 'dino' | 'volcano';
  id: string;
}

export interface WorldMap3DAPI {
  init: (mountEl: HTMLElement) => boolean;
  isReady: () => boolean;
  setVisible: (visible: boolean) => void;
  resize: () => void;
  setCamera: (cx: number, cy: number, zoom: number, vw: number, vh: number) => void;
  syncEntities: (payload: WorldMapEntitiesPayload) => void;
  projectWorld: (wx: number, wy: number, yElev?: number) => { sx: number; sy: number; visible: boolean };
  unprojectScreen: (sx: number, sy: number) => { wx: number; wy: number };
  pickEntityAt: (sx: number, sy: number) => WorldMapPickResult | null;
  getIsoYScale: () => number;
}

declare global {
  interface Window {
    WorldMap3D?: WorldMap3DAPI;
  }
}

const WORLD_GRID_COLS = 1200;
const WORLD_GRID_ROWS = 1200;
const HALF_WORLD = 600;

// Exact same locked isometric viewing direction as village3d.ts
const FIXED_CAM_DIR = new THREE.Vector3(0.0, 1.08, 0.94).normalize();
const CAM_FOV_DEG = 36;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(CAM_FOV_DEG * 0.5));

// Pre-allocated scratch math helpers (zero GC in render loop)
const _vec3 = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

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

function getStaticTileBlocked(gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= WORLD_GRID_COLS || gy >= WORLD_GRID_ROWS) return true;
  const dx = (gx + 0.5 - 600) / 145;
  const dy = (gy + 0.5 - 600) / 145;
  if (dx * dx + dy * dy <= 1.08) return true;
  if (gx >= 525 && gx <= 675 && gy >= 105 && gy <= 235) return true;
  if (gx >= 525 && gx <= 675 && gy >= 965 && gy <= 1095) return true;
  if (gx >= 105 && gx <= 235 && gy >= 525 && gy <= 675) return true;
  if (gx >= 965 && gx <= 1095 && gy >= 525 && gy <= 675) return true;
  if (gx <= 102 && gy <= 102) return true;
  if (gx >= 1098 && gy <= 102) return true;
  if (gx <= 102 && gy >= 1098) return true;
  if (gx >= 1098 && gy >= 1098) return true;
  if (gx >= 225 && gx <= 280 && gy >= 205 && gy <= 260) return true;
  if (gx >= 920 && gx <= 975 && gy >= 205 && gy <= 260) return true;
  if (gx >= 920 && gx <= 975 && gy >= 940 && gy <= 995) return true;
  return false;
}

function createContinentGroundTextures(maxAniso: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  // Exact volcanic earth color language matching village3d.ts
  const baseGrad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.05, size * 0.5, size * 0.5, size * 0.62);
  baseGrad.addColorStop(0.0, '#4f2414');
  baseGrad.addColorStop(0.16, '#463327');
  baseGrad.addColorStop(0.42, '#3a2d24');
  baseGrad.addColorStop(0.75, '#2b221c');
  baseGrad.addColorStop(1.0, '#1c1613');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#747474';
  bCtx.fillRect(0, 0, size, size);

  let seed = 90210;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Biome patches: packed volcanic soil, ash meadows, mossy prehistoric glades, basalt plateaus
  for (let i = 0; i < 240; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 58;
    const distCenter = Math.hypot(x - size * 0.5, y - size * 0.5) / (size * 0.5);
    const patchGrad = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    if (distCenter < 0.34) {
      patchGrad.addColorStop(0, 'rgba(92, 49, 28, 0.38)');
    } else if (i % 4 === 0) {
      // Subtle prehistoric olive-ash valley tint
      patchGrad.addColorStop(0, 'rgba(66, 74, 48, 0.24)');
    } else if (i % 3 === 0) {
      // Warm packed volcanic dirt (matching village clearings)
      patchGrad.addColorStop(0, 'rgba(84, 64, 48, 0.34)');
    } else {
      patchGrad.addColorStop(0, 'rgba(34, 27, 23, 0.32)');
    }
    patchGrad.addColorStop(1, 'rgba(26, 21, 18, 0)');
    ctx.fillStyle = patchGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Organic volcanic soil & ash pebbles grain
  for (let i = 0; i < 6500; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.9 + rand() * 3.8;
    const shade = Math.floor(24 + rand() * 38);
    ctx.fillStyle = `rgba(${shade + 15}, ${shade + 7}, ${shade}, ${0.09 + rand() * 0.14})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    const bVal = Math.floor(86 + rand() * 82);
    bCtx.fillStyle = `rgba(${bVal}, ${bVal}, ${bVal}, 0.18)`;
    bCtx.beginPath();
    bCtx.arc(x, y, r, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Faint ancient volcanic trail network connecting outer valleys around the caldera
  ctx.save();
  ctx.strokeStyle = 'rgba(96, 74, 54, 0.32)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(84, 64, 48, 0.24)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.39, 0, Math.PI * 2);
  ctx.stroke();

  // Radial ancient stone paths
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + 0.32;
    ctx.beginPath();
    ctx.moveTo(size * 0.5 + Math.cos(ang) * size * 0.14, size * 0.5 + Math.sin(ang) * size * 0.14);
    ctx.lineTo(size * 0.5 + Math.cos(ang) * size * 0.45, size * 0.5 + Math.sin(ang) * size * 0.45);
    ctx.stroke();
  }
  ctx.restore();

  // Glowing magma veins radiating slightly out from the central volcanic caldera
  const drawMagmaCrack = (x0: number, y0: number, ang: number, len: number) => {
    ctx.save();
    let cx = x0;
    let cy = y0;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 1; s <= 6; s++) {
      const step = len / 6;
      const jitter = (rand() - 0.5) * 0.42;
      cx += Math.cos(ang + jitter) * step;
      cy += Math.sin(ang + jitter) * step;
      ctx.lineTo(cx, cy);
    }
    ctx.strokeStyle = 'rgba(234, 88, 12, 0.48)';
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  };

  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + rand() * 0.25;
    const r0 = size * 0.085;
    drawMagmaCrack(size * 0.5 + Math.cos(ang) * r0, size * 0.5 + Math.sin(ang) * r0, ang, size * (0.06 + rand() * 0.07));
  }

  // Darkened crater floor under central caldera
  const calderaGrad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.02, size * 0.5, size * 0.5, size * 0.13);
  calderaGrad.addColorStop(0, '#ff6b1a');
  calderaGrad.addColorStop(0.42, '#9a280b');
  calderaGrad.addColorStop(0.76, '#2b1a14');
  calderaGrad.addColorStop(1, 'rgba(30, 22, 18, 0)');
  ctx.fillStyle = calderaGrad;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.13, 0, Math.PI * 2);
  ctx.fill();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAniso;

  return { map, bumpMap };
}

function createShadowDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(6, 4, 3, 0.62)');
  g.addColorStop(0.58, 'rgba(6, 4, 3, 0.28)');
  g.addColorStop(1, 'rgba(6, 4, 3, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createLavaTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 12, 128, 128, 128);
  g.addColorStop(0, '#fde047');
  g.addColorStop(0.32, '#f97316');
  g.addColorStop(0.68, '#b91c1c');
  g.addColorStop(1, '#3b1008');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  // Dark cooled crust plates floating on molten magma
  ctx.fillStyle = 'rgba(28, 16, 12, 0.45)';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rad = 30 + (i % 5) * 18;
    const px = 128 + Math.cos(a * 1.7) * rad;
    const py = 128 + Math.sin(a * 1.3) * rad;
    ctx.beginPath();
    ctx.ellipse(px, py, 12 + (i % 7) * 2.5, 6 + (i % 4) * 2, a, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

interface WorldMats {
  basalt: THREE.MeshStandardMaterial;
  basaltDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  thatch: THREE.MeshStandardMaterial;
  hide: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  foliageDark: THREE.MeshStandardMaterial;
  foliageOlive: THREE.MeshStandardMaterial;
  lava: THREE.MeshStandardMaterial;
  flameOuter: THREE.MeshStandardMaterial;
  flameInner: THREE.MeshStandardMaterial;
  ownBanner: THREE.MeshStandardMaterial;
  otherBanner: THREE.MeshStandardMaterial;
  pvpBanner: THREE.MeshStandardMaterial;
  pvpRing: THREE.MeshBasicMaterial;
  ownRing: THREE.MeshBasicMaterial;
  otherRing: THREE.MeshBasicMaterial;
  gatherRing: THREE.MeshBasicMaterial;
  shadowDisc: THREE.MeshBasicMaterial;
  hitMat: THREE.MeshBasicMaterial;
}

function createWorldMaterials(maxAniso: number): WorldMats {
  const lavaTex = createLavaTexture(maxAniso);
  const shadowTex = createShadowDiscTexture();
  return {
    basalt: new THREE.MeshStandardMaterial({ color: 0x4b433e, roughness: 0.92, metalness: 0.05 }),
    basaltDark: new THREE.MeshStandardMaterial({ color: 0x2c2522, roughness: 0.95, metalness: 0.06 }),
    stoneLight: new THREE.MeshStandardMaterial({ color: 0x7b7168, roughness: 0.86, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 0.88, metalness: 0.04 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x4a311f, roughness: 0.92, metalness: 0.04 }),
    thatch: new THREE.MeshStandardMaterial({ color: 0xb78852, roughness: 0.92, metalness: 0.02 }),
    hide: new THREE.MeshStandardMaterial({ color: 0x9b6b43, roughness: 0.88, metalness: 0.02 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe6dcc8, roughness: 0.72, metalness: 0.04 }),
    amber: new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.55,
      roughness: 0.28,
      metalness: 0.12
    }),
    foliageDark: new THREE.MeshStandardMaterial({ color: 0x2f432b, roughness: 0.92, metalness: 0.02 }),
    foliageOlive: new THREE.MeshStandardMaterial({ color: 0x455834, roughness: 0.9, metalness: 0.02 }),
    lava: new THREE.MeshStandardMaterial({
      map: lavaTex,
      emissive: 0xff5a12,
      emissiveMap: lavaTex,
      emissiveIntensity: 1.55,
      roughness: 0.35,
      metalness: 0.05
    }),
    flameOuter: new THREE.MeshStandardMaterial({
      color: 0xff7315,
      emissive: 0xff5a0a,
      emissiveIntensity: 1.9,
      roughness: 0.35
    }),
    flameInner: new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffba24,
      emissiveIntensity: 2.2,
      roughness: 0.25
    }),
    ownBanner: new THREE.MeshStandardMaterial({
      color: 0x4ade80,
      emissive: 0x16a34a,
      emissiveIntensity: 0.45,
      roughness: 0.65
    }),
    otherBanner: new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      roughness: 0.65
    }),
    pvpBanner: new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.8,
      roughness: 0.5
    }),
    pvpRing: new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false
    }),
    ownRing: new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
      depthWrite: false
    }),
    otherRing: new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false
    }),
    gatherRing: new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    }),
    shadowDisc: new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    }),
    hitMat: new THREE.MeshBasicMaterial({ visible: false })
  };
}

function addShadowDisc(parent: THREE.Group, radius: number, mats: WorldMats): void {
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.2, radius * 2.2), mats.shadowDisc);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.04;
  parent.add(disc);
}

// Composite 3D miniature settlement matching the Village Signalfeuer + Huts + Palisade design
function buildSettlementModel(isOwn: boolean, mats: WorldMats): { group: THREE.Group; flame: THREE.Group } {
  const g = new THREE.Group();
  addShadowDisc(g, 1.5, mats);

  // Packed dirt & stone settlement base pad
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.48, 0.14, 12), mats.basaltDark);
  pad.position.y = 0.07;
  g.add(pad);

  // Outer territory ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.48, 1.72, 24), isOwn ? mats.ownRing : mats.otherRing);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  g.add(ring);

  // Central Signalfeuer (stone hearth + wood pile + flickering flame)
  const hearth = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.09, 6, 10), mats.stoneLight);
  hearth.rotation.x = Math.PI / 2;
  hearth.position.y = 0.18;
  g.add(hearth);

  const flame = new THREE.Group();
  flame.position.y = 0.22;
  const fOut = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.78, 7), mats.flameOuter);
  fOut.position.y = 0.36;
  flame.add(fOut);
  const fIn = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.52, 6), mats.flameInner);
  fIn.position.y = 0.28;
  flame.add(fIn);
  g.add(flame);

  // 3 miniature Village thatch huts orbiting the Signalfeuer
  const hutAngles = [0.4, 2.5, 4.55];
  for (const ang of hutAngles) {
    const hx = Math.cos(ang) * 0.82;
    const hz = Math.sin(ang) * 0.82;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.34, 7), mats.wood);
    wall.position.set(hx, 0.3, hz);
    g.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.38, 7), mats.thatch);
    roof.position.set(hx, 0.62, hz);
    g.add(roof);
  }

  // Wooden palisade stakes around back arc
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.44, 5), mats.woodDark);
    stake.position.set(Math.cos(a) * 1.25, 0.26, Math.sin(a) * 1.25);
    g.add(stake);
  }

  // Tribal banner pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.65, 6), mats.woodDark);
  pole.position.set(0.68, 0.88, -0.58);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.04), isOwn ? mats.ownBanner : mats.otherBanner);
  flag.position.set(0.96, 1.46, -0.58);
  g.add(flag);

  return { group: g, flame };
}

// Composite 3D miniature resource nodes mirroring Village Lumber, Quarry, Hunter, and Amber camps
function buildResourceNodeModel(
  resource: string,
  mats: WorldMats
): { group: THREE.Group; pvpOverlay: THREE.Group; activeRing: THREE.Mesh } {
  const g = new THREE.Group();
  addShadowDisc(g, 0.92, mats);

  if (resource === 'wood') {
    // Timber logs + chopping stump + 2 dark volcanic pines
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.72, 6), mats.wood);
      log.rotation.z = Math.PI / 2;
      log.position.set(-0.18, 0.12 + (i === 2 ? 0.16 : 0), -0.15 + (i % 2) * 0.22);
      g.add(log);
    }
    const pineOffsets: [number, number, number][] = [
      [0.34, 0.18, 1.0],
      [-0.36, 0.28, 0.78]
    ];
    for (const [px, pz, sc] of pineOffsets) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * sc, 0.1 * sc, 0.45 * sc, 5), mats.woodDark);
      trunk.position.set(px, 0.22 * sc, pz);
      g.add(trunk);
      const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.36 * sc, 0.65 * sc, 6), mats.foliageDark);
      cone1.position.set(px, 0.68 * sc, pz);
      g.add(cone1);
      const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.26 * sc, 0.5 * sc, 6), mats.foliageOlive);
      cone2.position.set(px, 1.02 * sc, pz);
      g.add(cone2);
    }
  } else if (resource === 'stone') {
    // Basalt quarry boulders + crystal vein + timber hoist frame
    const r1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.46, 0), mats.basalt);
    r1.scale.set(1.15, 0.85, 1.0);
    r1.position.set(-0.14, 0.34, -0.08);
    g.add(r1);
    const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), mats.stoneLight);
    r2.position.set(0.34, 0.24, 0.16);
    g.add(r2);
    const r3 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), mats.basaltDark);
    r3.position.set(-0.34, 0.18, 0.28);
    g.add(r3);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.85, 0.09), mats.woodDark);
    beam.position.set(0.18, 0.44, -0.28);
    beam.rotation.z = 0.28;
    g.add(beam);
  } else if (resource === 'meat') {
    // Hunter hide tent + bone rack + glowing campfire
    const tent = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.78, 5), mats.hide);
    tent.position.set(-0.18, 0.39, -0.1);
    g.add(tent);
    const rackL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.56, 5), mats.woodDark);
    rackL.position.set(0.24, 0.28, 0.18);
    g.add(rackL);
    const rackR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.56, 5), mats.woodDark);
    rackR.position.set(0.54, 0.28, -0.02);
    g.add(rackR);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.46, 5), mats.bone);
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = 0.58;
    bar.position.set(0.39, 0.48, 0.08);
    g.add(bar);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 5), mats.flameOuter);
    fire.position.set(0.08, 0.16, 0.34);
    g.add(fire);
  } else {
    // Fur & Amber outcrop (glowing amber shards + bone & hide rack)
    const shard1 = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), mats.amber);
    shard1.scale.set(0.75, 1.45, 0.75);
    shard1.position.set(-0.1, 0.42, -0.08);
    shard1.rotation.z = 0.18;
    g.add(shard1);
    const shard2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), mats.amber);
    shard2.scale.set(0.7, 1.35, 0.7);
    shard2.position.set(0.28, 0.3, 0.16);
    shard2.rotation.z = -0.24;
    g.add(shard2);
    const hideCanopy = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.38), mats.hide);
    hideCanopy.position.set(-0.28, 0.44, 0.24);
    hideCanopy.rotation.x = 0.25;
    g.add(hideCanopy);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), mats.basaltDark);
    rock.position.set(0.1, 0.16, -0.26);
    g.add(rock);
  }

  // Own active gather golden ring
  const activeRing = new THREE.Mesh(new THREE.RingGeometry(0.84, 1.02, 20), mats.gatherRing);
  activeRing.rotation.x = -Math.PI / 2;
  activeRing.position.y = 0.07;
  activeRing.visible = false;
  g.add(activeRing);

  // Enemy PvP occupation banner + crimson ring
  const pvpOverlay = new THREE.Group();
  const pvpRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.08, 20), mats.pvpRing);
  pvpRing.rotation.x = -Math.PI / 2;
  pvpRing.position.y = 0.08;
  pvpOverlay.add(pvpRing);

  const warPole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.35, 5), mats.woodDark);
  warPole.position.set(0.55, 0.68, -0.35);
  pvpOverlay.add(warPole);
  const warFlag = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.04), mats.pvpBanner);
  warFlag.position.set(0.78, 1.18, -0.35);
  pvpOverlay.add(warFlag);
  pvpOverlay.visible = false;
  g.add(pvpOverlay);

  return { group: g, pvpOverlay, activeRing };
}

// Composite 3D miniature wild dinosaur silhouette tinted by species
function buildWildDinoModel(accentHex: string, speciesId: string, mats: WorldMats): THREE.Group {
  const g = new THREE.Group();
  addShadowDisc(g, 0.9, mats);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex).lerp(new THREE.Color(0x3a2d24), 0.35),
    roughness: 0.78,
    metalness: 0.05
  });
  const crestMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.24,
    roughness: 0.55,
    metalness: 0.06
  });

  const isHeavy =
    speciesId === 'stegosaurus' ||
    speciesId === 'triceratops' ||
    speciesId === 'ankylosaurus';
  const isApex = speciesId === 'tyrannosaurus' || speciesId === 'spinosaurus';
  const bodyScale = isApex ? 1.24 : isHeavy ? 1.12 : 0.92;

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78 * bodyScale, 0.42 * bodyScale, 0.44 * bodyScale), bodyMat);
  torso.position.set(0, 0.48 * bodyScale, 0);
  g.add(torso);

  // Tail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16 * bodyScale, 0.75 * bodyScale, 5), bodyMat);
  tail.rotation.z = Math.PI / 2 + 0.15;
  tail.position.set(-0.62 * bodyScale, 0.46 * bodyScale, 0);
  g.add(tail);

  // Neck + Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42 * bodyScale, 0.26 * bodyScale, 0.28 * bodyScale), bodyMat);
  head.position.set(0.56 * bodyScale, (isHeavy ? 0.56 : 0.78) * bodyScale, 0);
  g.add(head);

  // Distinctive crest / sail / dorsal plates / horns
  if (speciesId === 'spinosaurus') {
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.62 * bodyScale, 0.42 * bodyScale, 0.08 * bodyScale), crestMat);
    sail.position.set(-0.04, 0.82 * bodyScale, 0);
    g.add(sail);
  } else if (speciesId === 'stegosaurus' || speciesId === 'ankylosaurus') {
    for (let i = -1; i <= 1; i++) {
      const plate = new THREE.Mesh(new THREE.ConeGeometry(0.12 * bodyScale, 0.3 * bodyScale, 4), crestMat);
      plate.position.set(i * 0.22 * bodyScale, 0.78 * bodyScale, 0);
      g.add(plate);
    }
  } else if (speciesId === 'triceratops') {
    const frill = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * bodyScale, 0.28 * bodyScale, 0.08 * bodyScale, 6), crestMat);
    frill.rotation.z = Math.PI / 2;
    frill.position.set(0.36 * bodyScale, 0.66 * bodyScale, 0);
    g.add(frill);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06 * bodyScale, 0.3 * bodyScale, 4), mats.bone);
    horn.rotation.z = -Math.PI / 2;
    horn.position.set(0.84 * bodyScale, 0.64 * bodyScale, 0);
    g.add(horn);
  } else {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.1 * bodyScale, 0.24 * bodyScale, 4), crestMat);
    crest.position.set(0.54 * bodyScale, 0.96 * bodyScale, 0);
    g.add(crest);
  }

  // Legs
  const legOffsets: [number, number][] = isHeavy
    ? [
        [-0.24, -0.18],
        [-0.24, 0.18],
        [0.24, -0.18],
        [0.24, 0.18]
      ]
    : [
        [-0.08, -0.18],
        [-0.08, 0.18]
      ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * bodyScale, 0.09 * bodyScale, 0.38 * bodyScale, 5), bodyMat);
    leg.position.set(lx * bodyScale, 0.19 * bodyScale, lz * bodyScale);
    g.add(leg);
  }

  return g;
}

interface SettlementEntry {
  key: string;
  isOwn: boolean;
  root: THREE.Group;
  flame: THREE.Group;
  hitMesh: THREE.Mesh;
  baseScale: number;
}

interface NodeEntry {
  id: string;
  resource: string;
  root: THREE.Group;
  pvpOverlay: THREE.Group;
  activeRing: THREE.Mesh;
  hitMesh: THREE.Mesh;
}

interface DinoEntry {
  id: string;
  speciesId: string;
  root: THREE.Group;
  hitMesh: THREE.Mesh;
  phase: number;
}

class WorldMap3DController implements WorldMap3DAPI {
  private mountEl: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private mats: WorldMats | null = null;
  private calderaLight: THREE.PointLight | null = null;
  private calderaLavaMesh: THREE.Mesh | null = null;
  private volcanoMainFlame: THREE.Group | null = null;
  private volcanoPylonFlames: THREE.Mesh[] = [];
  private volcanoLavaFallMat: THREE.MeshStandardMaterial | null = null;
  private volcanoBannerMat: THREE.MeshStandardMaterial | null = null;
  private volcanoRingMat: THREE.MeshBasicMaterial | null = null;
  private volcanoShieldDome: THREE.Mesh | null = null;
  private volcanoBattleBeam: THREE.Mesh | null = null;
  private volcanoHitMesh: THREE.Mesh | null = null;
  private volcanoPhase: 'battle' | 'peace' = 'battle';
  private emberInst: THREE.InstancedMesh | null = null;
  private emberData: { x: number; y: number; z: number; vy: number; phase: number; size: number }[] = [];
  private gridLineMajor: THREE.LineSegments | null = null;
  private gridLineMinor: THREE.LineSegments | null = null;
  private ghostGroup: THREE.Group | null = null;
  private ghostFillMat: THREE.MeshBasicMaterial | null = null;
  private ghostBorderMat: THREE.LineBasicMaterial | null = null;

  private settlementEntries = new Map<string, SettlementEntry>();
  private nodeEntries = new Map<string, NodeEntry>();
  private dinoEntries = new Map<string, DinoEntry>();
  private hitMeshes: THREE.Mesh[] = [];

  private initialized = false;
  private visible = false;
  private isSoftGl = false;
  private frameId = 0;
  private lastTime = 0;
  private width = 380;
  private height = 600;
  private camCx = 240;
  private camCy = 940;
  private camZoom = 1.65;

  public init(mountEl: HTMLElement): boolean {
    if (this.initialized) return true;
    try {
      this.mountEl = mountEl;
      this.isSoftGl = detectSoftwareWebGL();
      this.width = Math.max(1, mountEl.clientWidth || 380);
      this.height = Math.max(1, mountEl.clientHeight || 600);

      const renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftGl,
        powerPreference: 'high-performance',
        alpha: false
      });
      renderer.setPixelRatio(this.isSoftGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(this.width, this.height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = false;
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.pointerEvents = 'none';
      mountEl.innerHTML = '';
      mountEl.appendChild(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x16110e);
      scene.fog = new THREE.FogExp2(0x18120e, 0.00052);
      this.scene = scene;

      // Mandatory PMREM RoomEnvironment (matching village3d.ts)
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.62;
      pmrem.dispose();

      const camera = new THREE.PerspectiveCamera(CAM_FOV_DEG, this.width / this.height, 2, 4200);
      camera.layers.enable(0);
      this.camera = camera;

      // Exact same warm-cool volcanic twilight lighting rig as village3d.ts
      const hemi = new THREE.HemisphereLight(0x9fb8d8, 0x3b2618, 0.78);
      scene.add(hemi);

      const key = new THREE.DirectionalLight(0xffd7b0, 1.48);
      key.position.set(420, 680, 440);
      scene.add(key);

      const rim = new THREE.DirectionalLight(0x88b4e6, 0.45);
      rim.position.set(-460, 340, -480);
      scene.add(rim);

      const calderaLight = new THREE.PointLight(0xff6b1a, 5400, 560, 1.4);
      calderaLight.position.set(0, 88, 0);
      scene.add(calderaLight);
      this.calderaLight = calderaLight;

      const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const mats = createWorldMaterials(maxAniso);
      this.mats = mats;

      this.buildContinentTerrain(scene, mats, maxAniso);
      this.buildVolcanicLandmarks(scene, mats);
      this.buildInstancedNature(scene, mats);
      this.buildTacticalGrid(scene);
      this.buildTeleportGhost3D(scene);
      this.initCalderaEmbers(scene);

      renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
      });

      this.initialized = true;
      this.updateCameraTransform();
      this.lastTime = performance.now();
      return true;
    } catch {
      return false;
    }
  }

  public isReady(): boolean {
    return this.initialized && Boolean(this.renderer && this.scene && this.camera);
  }

  public getIsoYScale(): number {
    return FIXED_CAM_DIR.y;
  }

  private buildContinentTerrain(scene: THREE.Scene, mats: WorldMats, maxAniso: number): void {
    // Extended volcanic horizon apron beyond 1200×1200 so there is never an abrupt void cutoff
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(3400, 3400),
      new THREE.MeshStandardMaterial({ color: 0x16110e, roughness: 0.98, metalness: 0.02 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.8;
    scene.add(apron);

    // Main 1200×1200 continent ground with subtle volcanic ridge height relief
    const { map, bumpMap } = createContinentGroundTextures(maxAniso);
    const geo = new THREE.PlaneGeometry(WORLD_GRID_COLS, WORLD_GRID_ROWS, 96, 96);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.hypot(x, z);
      let y = 0;
      // Central caldera rim elevation
      if (dist > 82 && dist < 168) {
        const ridge = Math.sin(((dist - 82) / 86) * Math.PI);
        y += ridge * 16 + Math.sin(x * 0.09 + z * 0.07) * 2.5 * ridge;
      } else if (dist <= 82) {
        y -= (1 - dist / 82) * 3.5;
      }
      // Subtle corner lava cliff hills
      const cornerDist = Math.min(
        Math.hypot(x + 560, z + 560),
        Math.hypot(x - 560, z + 560),
        Math.hypot(x + 560, z - 560),
        Math.hypot(x - 560, z - 560)
      );
      if (cornerDist < 135) {
        y += ((135 - cornerDist) / 135) * 18;
      }
      pos.setY(i, y);
    }
    geo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: 1.6,
      roughness: 0.93,
      metalness: 0.03
    });
    const groundMesh = new THREE.Mesh(geo, groundMat);
    scene.add(groundMesh);

    // Subtle warm volcanic border outline around the 1200×1200 continent
    const borderPts = [
      new THREE.Vector3(-HALF_WORLD, 0.3, -HALF_WORLD),
      new THREE.Vector3(HALF_WORLD, 0.3, -HALF_WORLD),
      new THREE.Vector3(HALF_WORLD, 0.3, HALF_WORLD),
      new THREE.Vector3(-HALF_WORLD, 0.3, HALF_WORLD),
      new THREE.Vector3(-HALF_WORLD, 0.3, -HALF_WORLD)
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const borderLine = new THREE.Line(
      borderGeo,
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.42 })
    );
    scene.add(borderLine);

    // Glowing molten magma moat ringing the base of the central Obsidian Volcano
    const moatMesh = new THREE.Mesh(new THREE.RingGeometry(126, 144, 42), mats.lava);
    moatMesh.rotation.x = -Math.PI / 2;
    moatMesh.position.y = 0.65;
    scene.add(moatMesh);
  }

  private buildVolcanicLandmarks(scene: THREE.Scene, mats: WorldMats): void {
    // 1. EPIC CENTRAL VOLCANO & CLICKABLE OBSIDIAN CITADEL ("Vulkan-Zitadelle")
    const volcanoGroup = new THREE.Group();
    volcanoGroup.position.set(0, 0, 0);

    const obsidianMat = new THREE.MeshStandardMaterial({
      color: 0x241d19,
      roughness: 0.9,
      metalness: 0.14,
      flatShading: true
    });
    const obsidianTrimMat = new THREE.MeshStandardMaterial({
      color: 0x382c25,
      roughness: 0.82,
      metalness: 0.22,
      flatShading: true
    });
    const bronzeMat = new THREE.MeshStandardMaterial({
      color: 0xb97a3d,
      roughness: 0.42,
      metalness: 0.68
    });
    const lavaFallMat = new THREE.MeshStandardMaterial({
      color: 0xff5a12,
      emissive: 0xff4500,
      emissiveIntensity: 1.55,
      roughness: 0.3,
      metalness: 0.05
    });
    this.volcanoLavaFallMat = lavaFallMat;

    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.45,
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    this.volcanoBannerMat = bannerMat;

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.volcanoRingMat = ringMat;

    // Terraced 3-tier Stratovolcano Mountain (rising dramatically to y = 58)
    const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(96, 134, 22, 14, 1), obsidianMat);
    tier1.position.y = 11;
    volcanoGroup.add(tier1);

    const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(72, 99, 21, 14, 1), obsidianTrimMat);
    tier2.position.y = 31;
    tier2.rotation.y = Math.PI / 14;
    volcanoGroup.add(tier2);

    const tier3 = new THREE.Mesh(new THREE.CylinderGeometry(58, 76, 17, 12, 1), obsidianMat);
    tier3.position.y = 48.5;
    volcanoGroup.add(tier3);

    // 18 Sculpted Jagged Basalt Buttress Ridges flanking the lower volcano slopes
    const ridgeGeo = new THREE.ConeGeometry(16, 48, 5);
    const ridgeInst = new THREE.InstancedMesh(ridgeGeo, mats.basaltDark, 18);
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      const rad = 104 + (i % 3) * 10;
      const sc = 0.85 + ((i * 13) % 7) * 0.08;
      _dummy.position.set(Math.cos(ang) * rad, 17 * sc, Math.sin(ang) * rad);
      _dummy.rotation.set(Math.sin(ang) * 0.24, ang, -Math.cos(ang) * 0.24);
      _dummy.scale.set(sc * 1.15, sc * 1.12, sc * 0.9);
      _dummy.updateMatrix();
      ridgeInst.setMatrixAt(i, _dummy.matrix);
    }
    ridgeInst.instanceMatrix.needsUpdate = true;
    ridgeInst.computeBoundingSphere();
    volcanoGroup.add(ridgeInst);

    // 16 Towering Jagged Obsidian Crown Teeth framing the summit caldera rim
    const toothGeo = new THREE.ConeGeometry(11, 30, 5);
    const toothInst = new THREE.InstancedMesh(toothGeo, obsidianMat, 16);
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + 0.19;
      const rad = 61 + (i % 2) * 5;
      const sc = 0.8 + ((i * 7) % 5) * 0.14;
      _dummy.position.set(Math.cos(ang) * rad, 54 + 7 * sc, Math.sin(ang) * rad);
      _dummy.rotation.set(Math.sin(ang) * 0.16, ang + i, -Math.cos(ang) * 0.16);
      _dummy.scale.set(sc, sc * 1.15, sc * 0.85);
      _dummy.updateMatrix();
      toothInst.setMatrixAt(i, _dummy.matrix);
    }
    toothInst.instanceMatrix.needsUpdate = true;
    toothInst.computeBoundingSphere();
    volcanoGroup.add(toothInst);

    // 6 Glowing Cascading Lava Falls flowing from crater lip down into the molten moat
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const fallGroup = new THREE.Group();
      fallGroup.rotation.y = ang;
      const stream = new THREE.Mesh(new THREE.BoxGeometry(6.5 + (i % 2) * 2.2, 68, 3.2), lavaFallMat);
      stream.position.set(0, 29, 92);
      stream.rotation.x = -0.66;
      fallGroup.add(stream);

      const pool = new THREE.Mesh(new THREE.CircleGeometry(13, 12), mats.lava);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0.9, 130);
      fallGroup.add(pool);
      volcanoGroup.add(fallGroup);
    }

    // Churning Elevated Summit Magma Vortex Lake inside the Caldera
    const lavaLake = new THREE.Mesh(new THREE.CircleGeometry(56, 36), mats.lava);
    lavaLake.rotation.x = -Math.PI / 2;
    lavaLake.position.y = 53.2;
    volcanoGroup.add(lavaLake);
    this.calderaLavaMesh = lavaLake;

    // 4 Cardinal Obsidian-Bronze Gate Pylons + Suspended Causeway Bridges + Blazing Braziers
    this.volcanoPylonFlames = [];
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const arm = new THREE.Group();
      arm.rotation.y = ang;

      // Suspended causeway bridge from outer rim to central Sovereign Island
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 44), obsidianTrimMat);
      bridge.position.set(0, 55.2, 39);
      arm.add(bridge);

      const bridgeRailL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 44), bronzeMat);
      bridgeRailL.position.set(-5.2, 57.2, 39);
      arm.add(bridgeRailL);

      const bridgeRailR = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 44), bronzeMat);
      bridgeRailR.position.set(5.2, 57.2, 39);
      arm.add(bridgeRailR);

      // Colossal Carved Gate Pylon on the rim
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 8.2, 24, 6), obsidianMat);
      pylon.position.set(0, 66, 61);
      arm.add(pylon);

      const runeBand = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 3.2, 6), lavaFallMat);
      runeBand.position.set(0, 68, 61);
      arm.add(runeBand);

      const bronzeCap = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 5.4, 3.2, 6), bronzeMat);
      bronzeCap.position.set(0, 78.5, 61);
      arm.add(bronzeCap);

      // Blazing Brazier Flame atop each Pylon
      const pFlame = new THREE.Mesh(new THREE.ConeGeometry(4.6, 13, 6), mats.flameOuter);
      pFlame.position.set(0, 86, 61);
      arm.add(pFlame);
      this.volcanoPylonFlames.push(pFlame);

      // Hanging Sovereign War Banner on each outer Pylon
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 16), bannerMat);
      flag.position.set(0, 63, 68.5);
      arm.add(flag);

      volcanoGroup.add(arm);
    }

    // Central Sovereign Citadel Spire & Forged Bronze Crown Altar
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(23, 27, 8, 8), obsidianTrimMat);
    dais.position.y = 56;
    volcanoGroup.add(dais);

    const crownTorus = new THREE.Mesh(new THREE.TorusGeometry(21, 2.1, 8, 24), bronzeMat);
    crownTorus.rotation.x = Math.PI / 2;
    crownTorus.position.y = 60.5;
    volcanoGroup.add(crownTorus);

    const citadelKeep = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 17, 19, 8), obsidianMat);
    citadelKeep.position.y = 69;
    volcanoGroup.add(citadelKeep);

    const citadelCollar = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 13.5, 3.4, 8), bronzeMat);
    citadelCollar.position.y = 77.5;
    volcanoGroup.add(citadelCollar);

    const brazierBowl = new THREE.Mesh(new THREE.CylinderGeometry(12, 8.5, 5.5, 8), obsidianTrimMat);
    brazierBowl.position.y = 81.5;
    volcanoGroup.add(brazierBowl);

    // Colossal Roaring Multi-Layer Summit Beacon Flame
    const mainFlameGroup = new THREE.Group();
    mainFlameGroup.position.set(0, 83.5, 0);
    const fOuter = new THREE.Mesh(new THREE.ConeGeometry(10.5, 28, 7), mats.flameOuter);
    fOuter.position.y = 14;
    mainFlameGroup.add(fOuter);
    const fMid = new THREE.Mesh(new THREE.ConeGeometry(7.2, 22, 6), mats.flameInner);
    fMid.position.y = 11.5;
    fMid.rotation.y = 0.5;
    mainFlameGroup.add(fMid);
    const fCore = new THREE.Mesh(
      new THREE.ConeGeometry(4.2, 14, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 })
    );
    fCore.position.y = 8;
    mainFlameGroup.add(fCore);
    volcanoGroup.add(mainFlameGroup);
    this.volcanoMainFlame = mainFlameGroup;

    // Ground Sovereignty Territory Ring around the entire Volcano Monument
    const territoryRing = new THREE.Mesh(new THREE.RingGeometry(147, 155, 48), ringMat);
    territoryRing.rotation.x = -Math.PI / 2;
    territoryRing.position.y = 1.05;
    volcanoGroup.add(territoryRing);

    const summitHalo = new THREE.Mesh(new THREE.RingGeometry(63, 68, 36), ringMat);
    summitHalo.rotation.x = -Math.PI / 2;
    summitHalo.position.y = 56.5;
    volcanoGroup.add(summitHalo);

    // 4-Week Peace Phase Translucent Runic Shield Dome
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const shieldDome = new THREE.Mesh(
      new THREE.SphereGeometry(96, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52),
      shieldMat
    );
    shieldDome.position.y = 40;
    shieldDome.visible = false;
    volcanoGroup.add(shieldDome);
    this.volcanoShieldDome = shieldDome;

    // Active 4-Week Battle Phase Sky-Piercing Molten Beacon Pillar
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const battleBeam = new THREE.Mesh(new THREE.CylinderGeometry(6, 20, 180, 14, 1, true), beamMat);
    battleBeam.position.y = 152;
    battleBeam.visible = true;
    volcanoGroup.add(battleBeam);
    this.volcanoBattleBeam = battleBeam;

    // Clickable Raycast Hitbox covering the entire Volcano Mountain & Citadel (Layer 1)
    const volcanoHit = new THREE.Mesh(new THREE.CylinderGeometry(68, 134, 92, 12), mats.hitMat);
    volcanoHit.position.y = 46;
    volcanoHit.layers.set(1);
    volcanoHit.userData.pickKind = 'volcano';
    volcanoHit.userData.pickId = 'central_volcano';
    volcanoGroup.add(volcanoHit);
    this.volcanoHitMesh = volcanoHit;

    scene.add(volcanoGroup);

    // 2. 4 Ancient Dino Caves (North, South, West, East)
    const caveCoords: [number, number][] = [
      [0, -430],
      [0, 430],
      [-430, 0],
      [430, 0]
    ];
    for (const [cx, cz] of caveCoords) {
      const caveGroup = new THREE.Group();
      caveGroup.position.set(cx, 0, cz);
      const arch = new THREE.Mesh(new THREE.DodecahedronGeometry(46, 0), mats.basaltDark);
      arch.scale.set(1.35, 0.72, 1.1);
      arch.position.y = 14;
      caveGroup.add(arch);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(24, 16), mats.lava);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.5, 22);
      caveGroup.add(glow);
      scene.add(caveGroup);
    }

    // 3. 4 Corner obsidian cliff clusters
    const corners: [number, number][] = [
      [-550, -550],
      [550, -550],
      [-550, 550],
      [550, 550]
    ];
    for (const [cx, cz] of corners) {
      for (let j = 0; j < 4; j++) {
        const rock = new THREE.Mesh(new THREE.ConeGeometry(28 + j * 4, 52 + (j % 2) * 18, 6), mats.basaltDark);
        rock.position.set(cx + (j - 1.5) * 18, 22, cz + ((j % 2) - 0.5) * 24);
        scene.add(rock);
      }
    }

    // 4. 3 Fortified NPC Tribal Camps (NW, NE, SE)
    const npcCoords: [number, number][] = [
      [252 - HALF_WORLD, 232 - HALF_WORLD],
      [947 - HALF_WORLD, 232 - HALF_WORLD],
      [947 - HALF_WORLD, 967 - HALF_WORLD]
    ];
    for (const [nx, nz] of npcCoords) {
      const camp = new THREE.Group();
      camp.position.set(nx, 0, nz);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(18, 20, 2, 10), mats.basalt);
      base.position.y = 1;
      camp.add(base);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 18, 6), mats.woodDark);
      tower.position.set(0, 10, 0);
      camp.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(9.5, 8, 6), mats.thatch);
      roof.position.set(0, 22, 0);
      camp.add(roof);
      scene.add(camp);
    }
  }

  private buildInstancedNature(scene: THREE.Scene, mats: WorldMats): void {
    let seed = 424242;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const treePositions: { x: number; z: number; sc: number; rot: number }[] = [];
    for (let i = 0; i < 650 && treePositions.length < 380; i++) {
      const gx = 30 + rand() * (WORLD_GRID_COLS - 60);
      const gy = 30 + rand() * (WORLD_GRID_ROWS - 60);
      if (getStaticTileBlocked(gx, gy)) continue;
      treePositions.push({
        x: gx - HALF_WORLD,
        z: gy - HALF_WORLD,
        sc: 0.72 + rand() * 0.78,
        rot: rand() * Math.PI * 2
      });
    }

    const trunkGeo = new THREE.CylinderGeometry(0.65, 1.0, 4.4, 5);
    const crownLowGeo = new THREE.ConeGeometry(3.8, 7.6, 6);
    const crownHighGeo = new THREE.ConeGeometry(2.6, 5.8, 6);

    const trunks = new THREE.InstancedMesh(trunkGeo, mats.woodDark, treePositions.length);
    const crownsLow = new THREE.InstancedMesh(crownLowGeo, mats.foliageDark, treePositions.length);
    const crownsHigh = new THREE.InstancedMesh(crownHighGeo, mats.foliageOlive, treePositions.length);

    for (let i = 0; i < treePositions.length; i++) {
      const t = treePositions[i];
      _dummy.position.set(t.x, 2.2 * t.sc, t.z);
      _dummy.rotation.set(0, t.rot, 0);
      _dummy.scale.set(t.sc, t.sc, t.sc);
      _dummy.updateMatrix();
      trunks.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(t.x, 6.2 * t.sc, t.z);
      _dummy.updateMatrix();
      crownsLow.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(t.x, 9.8 * t.sc, t.z);
      _dummy.updateMatrix();
      crownsHigh.setMatrixAt(i, _dummy.matrix);

      const tint = 0.85 + (i % 5) * 0.07;
      _color.setRGB(0.2 * tint, 0.28 * tint, 0.18 * tint);
      crownsLow.setColorAt(i, _color);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crownsLow.instanceMatrix.needsUpdate = true;
    crownsHigh.instanceMatrix.needsUpdate = true;
    if (crownsLow.instanceColor) crownsLow.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    crownsLow.computeBoundingSphere();
    crownsHigh.computeBoundingSphere();
    scene.add(trunks, crownsLow, crownsHigh);

    // Instanced basalt boulders scattered across volcanic plains
    const rockPositions: { x: number; z: number; sx: number; sy: number; sz: number; rot: number }[] = [];
    for (let i = 0; i < 420 && rockPositions.length < 260; i++) {
      const gx = 25 + rand() * (WORLD_GRID_COLS - 50);
      const gy = 25 + rand() * (WORLD_GRID_ROWS - 50);
      if (getStaticTileBlocked(gx, gy)) continue;
      const base = 1.6 + rand() * 3.4;
      rockPositions.push({
        x: gx - HALF_WORLD,
        z: gy - HALF_WORLD,
        sx: base * (0.8 + rand() * 0.5),
        sy: base * (0.55 + rand() * 0.45),
        sz: base * (0.8 + rand() * 0.5),
        rot: rand() * Math.PI * 2
      });
    }
    const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, mats.basalt, rockPositions.length);
    for (let i = 0; i < rockPositions.length; i++) {
      const r = rockPositions[i];
      _dummy.position.set(r.x, r.sy * 0.45, r.z);
      _dummy.rotation.set(0.2 * (i % 3), r.rot, 0.15 * (i % 2));
      _dummy.scale.set(r.sx, r.sy, r.sz);
      _dummy.updateMatrix();
      rocks.setMatrixAt(i, _dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.computeBoundingSphere();
    scene.add(rocks);
  }

  private buildTacticalGrid(scene: THREE.Scene): void {
    // 50-tile sector grid (subtle volcanic gold lines)
    const majorPts: number[] = [];
    for (let i = 0; i <= WORLD_GRID_COLS; i += 50) {
      const p = i - HALF_WORLD;
      majorPts.push(p, 0.35, -HALF_WORLD, p, 0.35, HALF_WORLD);
      majorPts.push(-HALF_WORLD, 0.35, p, HALF_WORLD, 0.35, p);
    }
    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
    const majorMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.11 });
    this.gridLineMajor = new THREE.LineSegments(majorGeo, majorMat);
    scene.add(this.gridLineMajor);

    // 10-tile tactical block grid (fades in smoothly when zooming closer)
    const minorPts: number[] = [];
    for (let i = 0; i <= WORLD_GRID_COLS; i += 10) {
      if (i % 50 === 0) continue;
      const p = i - HALF_WORLD;
      minorPts.push(p, 0.32, -HALF_WORLD, p, 0.32, HALF_WORLD);
      minorPts.push(-HALF_WORLD, 0.32, p, HALF_WORLD, 0.32, p);
    }
    const minorGeo = new THREE.BufferGeometry();
    minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorPts, 3));
    const minorMat = new THREE.LineBasicMaterial({ color: 0xf5efe6, transparent: true, opacity: 0.0 });
    this.gridLineMinor = new THREE.LineSegments(minorGeo, minorMat);
    scene.add(this.gridLineMinor);
  }

  private buildTeleportGhost3D(scene: THREE.Scene): void {
    const g = new THREE.Group();
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fillMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.5;
    g.add(pad);

    const bPts = [
      new THREE.Vector3(-1, 0.55, -1),
      new THREE.Vector3(1, 0.55, -1),
      new THREE.Vector3(1, 0.55, 1),
      new THREE.Vector3(-1, 0.55, 1),
      new THREE.Vector3(-1, 0.55, -1)
    ];
    const borderMat = new THREE.LineBasicMaterial({ color: 0x4ade80 });
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bPts), borderMat));
    g.visible = false;
    scene.add(g);

    this.ghostGroup = g;
    this.ghostFillMat = fillMat;
    this.ghostBorderMat = borderMat;
  }

  private initCalderaEmbers(scene: THREE.Scene): void {
    const count = 72;
    const geo = new THREE.OctahedronGeometry(1.75, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    scene.add(inst);
    this.emberInst = inst;
    this.emberData = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 54;
      this.emberData.push({
        x: Math.cos(ang) * rad,
        y: 52 + Math.random() * 94,
        z: Math.sin(ang) * rad,
        vy: 8 + Math.random() * 14,
        phase: Math.random() * Math.PI * 2,
        size: 0.75 + Math.random() * 1.15
      });
    }
  }

  private computeEntityScale(): { settle: number; node: number; dino: number } {
    // Smooth strategy-map scaling: compact & crisp at close zoom, clear miniatures when zoomed out
    const settle = THREE.MathUtils.clamp(Math.pow(10 / Math.max(0.25, this.camZoom), 0.62) * 1.45, 1.35, 14.5);
    const node = settle * 0.56;
    const dino = settle * 0.62;
    return { settle, node, dino };
  }

  private applyEntityScales(): void {
    const { settle, node, dino } = this.computeEntityScale();
    for (const entry of this.settlementEntries.values()) {
      const s = settle * entry.baseScale;
      entry.root.scale.set(s, s, s);
    }
    for (const entry of this.nodeEntries.values()) {
      entry.root.scale.set(node, node, node);
    }
    for (const entry of this.dinoEntries.values()) {
      entry.root.scale.set(dino, dino, dino);
    }
  }

  private updateCameraTransform(): void {
    if (!this.camera) return;
    const targetX = this.camCx - HALF_WORLD;
    const targetZ = this.camCy - HALF_WORLD;

    // Exact screen-space horizontal calibration: 1 tile at screen center === camZoom pixels
    const dist = THREE.MathUtils.clamp(this.height / (2 * TAN_HALF_FOV * Math.max(0.2, this.camZoom)), 24, 2900);

    this.camera.aspect = this.width / Math.max(1, this.height);
    this.camera.position.set(
      targetX + FIXED_CAM_DIR.x * dist,
      FIXED_CAM_DIR.y * dist,
      targetZ + FIXED_CAM_DIR.z * dist
    );
    this.camera.lookAt(targetX, 0, targetZ);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    // Update grid visibility smoothly by zoom
    if (this.gridLineMinor) {
      const mat = this.gridLineMinor.material as THREE.LineBasicMaterial;
      const op = this.camZoom >= 2.2 ? Math.min(0.14, (this.camZoom - 2.2) * 0.025) : 0;
      mat.opacity = op;
      this.gridLineMinor.visible = op > 0.005;
    }
    if (this.gridLineMajor) {
      const mat = this.gridLineMajor.material as THREE.LineBasicMaterial;
      mat.opacity = this.camZoom >= 1.5 ? 0.15 : 0.09;
    }

    // Adapt fog slightly with altitude so continent overview stays clear and atmospheric
    if (this.scene && this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = THREE.MathUtils.clamp(0.14 / Math.max(120, dist), 0.00018, 0.0012);
    }

    this.applyEntityScales();
  }

  public setCamera(cx: number, cy: number, zoom: number, vw: number, vh: number): void {
    this.camCx = cx;
    this.camCy = cy;
    this.camZoom = zoom;
    if (vw > 0 && vh > 0 && (vw !== this.width || vh !== this.height)) {
      this.width = vw;
      this.height = vh;
      if (this.renderer) {
        this.renderer.setSize(vw, vh, false);
      }
    }
    this.updateCameraTransform();
    if (this.visible && this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public syncEntities(payload: WorldMapEntitiesPayload): void {
    if (!this.scene || !this.mats) return;
    const scene = this.scene;
    const mats = this.mats;

    // 1. Sync settlements (own + multiplayer)
    const activeSettleKeys = new Set<string>();
    for (const s of payload.settlements) {
      const key = s.isOwn ? 'home' : `pl:${s.id}`;
      activeSettleKeys.add(key);
      let entry = this.settlementEntries.get(key);
      if (!entry) {
        const built = buildSettlementModel(s.isOwn, mats);
        const hitMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 2.2, 8), mats.hitMat);
        hitMesh.position.y = 1.1;
        hitMesh.layers.set(1);
        hitMesh.userData.pickKind = s.isOwn ? 'home' : 'player';
        hitMesh.userData.pickId = s.id;
        built.group.add(hitMesh);
        scene.add(built.group);
        entry = {
          key,
          isOwn: s.isOwn,
          root: built.group,
          flame: built.flame,
          hitMesh,
          baseScale: 1
        };
        this.settlementEntries.set(key, entry);
      }
      entry.root.position.set(s.wx - HALF_WORLD, 0, s.wy - HALF_WORLD);
      entry.baseScale = Math.min(1.22, 1 + Math.max(0, (s.bonfireLevel || 1) - 1) * 0.015);
    }
    for (const [key, entry] of this.settlementEntries.entries()) {
      if (!activeSettleKeys.has(key)) {
        scene.remove(entry.root);
        this.settlementEntries.delete(key);
      }
    }

    // 2. Sync 48 resource nodes (with dynamic relocation & PvP enemy occupation state)
    const activeNodeIds = new Set<string>();
    for (const n of payload.nodes) {
      activeNodeIds.add(n.id);
      let entry = this.nodeEntries.get(n.id);
      if (entry && entry.resource !== n.resource) {
        scene.remove(entry.root);
        this.nodeEntries.delete(n.id);
        entry = undefined;
      }
      if (!entry) {
        const built = buildResourceNodeModel(n.resource, mats);
        const hitMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 1.8, 8), mats.hitMat);
        hitMesh.position.y = 0.9;
        hitMesh.layers.set(1);
        hitMesh.userData.pickKind = 'node';
        hitMesh.userData.pickId = n.id;
        built.group.add(hitMesh);
        scene.add(built.group);
        entry = {
          id: n.id,
          resource: n.resource,
          root: built.group,
          pvpOverlay: built.pvpOverlay,
          activeRing: built.activeRing,
          hitMesh
        };
        this.nodeEntries.set(n.id, entry);
      }
      entry.root.position.set(n.wx - HALF_WORLD, 0, n.wy - HALF_WORLD);
      entry.root.visible = !n.depleted;
      entry.hitMesh.visible = !n.depleted;
      entry.activeRing.visible = n.activeGather;
      entry.pvpOverlay.visible = n.enemyOccupied && !n.activeGather;
    }
    for (const [id, entry] of this.nodeEntries.entries()) {
      if (!activeNodeIds.has(id)) {
        scene.remove(entry.root);
        this.nodeEntries.delete(id);
      }
    }

    // 3. Sync 40 wild dinosaurs (with dynamic species & relocation)
    const activeDinoIds = new Set<string>();
    for (const d of payload.dinos) {
      activeDinoIds.add(d.id);
      let entry = this.dinoEntries.get(d.id);
      if (entry && entry.speciesId !== d.speciesId) {
        scene.remove(entry.root);
        this.dinoEntries.delete(d.id);
        entry = undefined;
      }
      if (!entry) {
        const model = buildWildDinoModel(d.accent || '#ef4444', d.speciesId, mats);
        const hitMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 1.7, 8), mats.hitMat);
        hitMesh.position.y = 0.85;
        hitMesh.layers.set(1);
        hitMesh.userData.pickKind = 'dino';
        hitMesh.userData.pickId = d.id;
        model.add(hitMesh);
        scene.add(model);
        entry = {
          id: d.id,
          speciesId: d.speciesId,
          root: model,
          hitMesh,
          phase: Math.random() * Math.PI * 2
        };
        this.dinoEntries.set(d.id, entry);
      }
      entry.root.position.set(d.wx - HALF_WORLD, 0, d.wy - HALF_WORLD);
      entry.root.visible = !d.respawning;
      entry.hitMesh.visible = !d.respawning;
    }
    for (const [id, entry] of this.dinoEntries.entries()) {
      if (!activeDinoIds.has(id)) {
        scene.remove(entry.root);
        this.dinoEntries.delete(id);
      }
    }

    // 4. Sync 3D 2×2 teleport ghost preview pad
    if (this.ghostGroup && this.ghostFillMat && this.ghostBorderMat) {
      const tg = payload.teleportGhost;
      this.ghostGroup.visible = Boolean(tg && tg.active);
      if (tg && tg.active) {
        this.ghostGroup.position.set(tg.anchorX + 1 - HALF_WORLD, 0, tg.anchorY + 1 - HALF_WORLD);
        this.ghostFillMat.color.setHex(tg.valid ? 0x22c55e : 0xef4444);
        this.ghostBorderMat.color.setHex(tg.valid ? 0x4ade80 : 0xf87171);
      }
    }

    // 5. Sync Epic Central Volcano Citadel phase (battle vs 4-week peace shield) & ruler colors
    if (payload.volcano) {
      this.volcanoPhase = payload.volcano.phase;
      const isBattle = payload.volcano.phase === 'battle';
      const status = payload.volcano.holderStatus;
      const accentHex = status === 'own' ? 0x22c55e : status === 'enemy' ? 0x38bdf8 : 0xf59e0b;
      const emissiveHex = status === 'own' ? 0x15803d : status === 'enemy' ? 0x0284c7 : 0xd97706;
      if (this.volcanoBannerMat) {
        this.volcanoBannerMat.color.setHex(accentHex);
        this.volcanoBannerMat.emissive.setHex(emissiveHex);
      }
      if (this.volcanoRingMat) {
        this.volcanoRingMat.color.setHex(isBattle && status === 'neutral' ? 0xef4444 : accentHex);
      }
      if (this.volcanoShieldDome) {
        this.volcanoShieldDome.visible = !isBattle;
        (this.volcanoShieldDome.material as THREE.MeshBasicMaterial).color.setHex(accentHex);
      }
      if (this.volcanoBattleBeam) {
        this.volcanoBattleBeam.visible = isBattle;
        (this.volcanoBattleBeam.material as THREE.MeshBasicMaterial).color.setHex(
          status === 'own' ? 0x4ade80 : status === 'enemy' ? 0x38bdf8 : 0xff5a1f
        );
      }
    }

    // Rebuild flat hitMesh array for O(fast) raycasting on tap (entities first, volcano monument fallback)
    this.hitMeshes = [];
    for (const e of this.settlementEntries.values()) this.hitMeshes.push(e.hitMesh);
    for (const e of this.nodeEntries.values()) if (e.hitMesh.visible) this.hitMeshes.push(e.hitMesh);
    for (const e of this.dinoEntries.values()) if (e.hitMesh.visible) this.hitMeshes.push(e.hitMesh);
    if (this.volcanoHitMesh) this.hitMeshes.push(this.volcanoHitMesh);

    this.applyEntityScales();
  }

  public projectWorld(wx: number, wy: number, yElev = 0): { sx: number; sy: number; visible: boolean } {
    if (!this.camera) {
      return {
        sx: this.width / 2 + (wx - this.camCx) * this.camZoom,
        sy: this.height / 2 + (wy - this.camCy) * this.camZoom,
        visible: true
      };
    }
    _vec3.set(wx - HALF_WORLD, yElev, wy - HALF_WORLD);
    _vec3.project(this.camera);
    const visible = _vec3.z >= -1 && _vec3.z <= 1;
    const sx = (_vec3.x * 0.5 + 0.5) * this.width;
    const sy = (-_vec3.y * 0.5 + 0.5) * this.height;
    return { sx, sy, visible };
  }

  public unprojectScreen(sx: number, sy: number): { wx: number; wy: number } {
    if (!this.camera) {
      return {
        wx: this.camCx + (sx - this.width / 2) / this.camZoom,
        wy: this.camCy + (sy - this.height / 2) / this.camZoom
      };
    }
    _pointer.set((sx / Math.max(1, this.width)) * 2 - 1, -(sy / Math.max(1, this.height)) * 2 + 1);
    _raycaster.setFromCamera(_pointer, this.camera);
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _vec3B);
    if (!hit) {
      return { wx: this.camCx, wy: this.camCy };
    }
    return {
      wx: hit.x + HALF_WORLD,
      wy: hit.z + HALF_WORLD
    };
  }

  public pickEntityAt(sx: number, sy: number): WorldMapPickResult | null {
    if (!this.camera || this.hitMeshes.length === 0) return null;
    _pointer.set((sx / Math.max(1, this.width)) * 2 - 1, -(sy / Math.max(1, this.height)) * 2 + 1);
    _raycaster.layers.set(1);
    _raycaster.setFromCamera(_pointer, this.camera);
    const hits = _raycaster.intersectObjects(this.hitMeshes, false);
    if (hits.length === 0) return null;
    const ud = hits[0].object.userData;
    if (!ud || !ud.pickKind || !ud.pickId) return null;
    return { kind: ud.pickKind, id: String(ud.pickId) };
  }

  public setVisible(visible: boolean): void {
    const wasVisible = this.visible;
    this.visible = visible;
    if (visible && !wasVisible && this.initialized) {
      this.resize();
      this.lastTime = performance.now();
      this.scheduleNextFrame();
    } else if (!visible && this.frameId) {
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameId);
      this.frameId = 0;
    }
  }

  public resize(): void {
    if (!this.mountEl || !this.renderer || !this.camera) return;
    const w = Math.max(1, this.mountEl.clientWidth || 380);
    const h = Math.max(1, this.mountEl.clientHeight || 600);
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h, false);
      this.updateCameraTransform();
    }
  }

  private scheduleNextFrame(): void {
    if (!this.visible || !this.initialized) return;
    if (this.isSoftGl && this.renderer) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (!this.visible) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const st = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (st === gl.UNSIGNALED) {
            this.frameId = window.setTimeout(poll, 8);
          } else {
            if (sync) gl.deleteSync(sync);
            this.frameId = window.setTimeout(() => this.tick(), 80);
          }
        };
        this.frameId = window.setTimeout(poll, 8);
        return;
      }
      this.frameId = window.setTimeout(() => this.tick(), 80);
      return;
    }
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (!this.visible || !this.renderer || !this.scene || !this.camera) return;
    const now = performance.now();
    const dt = Math.min(0.08, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const t = now * 0.001;

    // Flickering bonfire flames on every 3D settlement
    let idx = 0;
    for (const entry of this.settlementEntries.values()) {
      const flick = 0.9 + Math.sin(t * 9.5 + idx * 1.7) * 0.12 + Math.cos(t * 15.2 + idx) * 0.06;
      entry.flame.scale.set(1, flick, 1);
      entry.flame.rotation.y = t * 1.4 + idx;
      idx++;
    }

    // Gentle living sway on wild 3D dinosaurs
    for (const d of this.dinoEntries.values()) {
      if (!d.root.visible) continue;
      d.root.rotation.y = Math.sin(t * 0.7 + d.phase) * 0.35;
    }

    // Pulsing central volcanic caldera magma glow, roaring Citadel flames, lava falls & erupting embers
    const isBattle = this.volcanoPhase === 'battle';
    if (this.calderaLight) {
      this.calderaLight.intensity = (isBattle ? 5800 : 4200) + Math.sin(t * 3.1) * 750;
    }
    if (this.calderaLavaMesh) {
      this.calderaLavaMesh.rotation.z = t * (isBattle ? 0.05 : 0.025);
    }
    if (this.volcanoMainFlame) {
      const fScaleY = (isBattle ? 1.16 : 0.92) + Math.sin(t * 7.8) * 0.14 + Math.cos(t * 13.4) * 0.07;
      const fScaleXZ = 1 + Math.sin(t * 5.2) * 0.06;
      this.volcanoMainFlame.scale.set(fScaleXZ, fScaleY, fScaleXZ);
      this.volcanoMainFlame.rotation.y = t * 1.1;
    }
    for (let i = 0; i < this.volcanoPylonFlames.length; i++) {
      const pf = this.volcanoPylonFlames[i];
      const f = 0.88 + Math.sin(t * 8.5 + i * 1.6) * 0.16;
      pf.scale.set(1, f, 1);
      pf.rotation.y = t * 1.3 + i;
    }
    if (this.volcanoLavaFallMat) {
      this.volcanoLavaFallMat.emissiveIntensity = (isBattle ? 1.75 : 1.25) + Math.sin(t * 2.4) * 0.28;
    }
    if (this.volcanoBattleBeam && this.volcanoBattleBeam.visible) {
      const bm = this.volcanoBattleBeam.material as THREE.MeshBasicMaterial;
      bm.opacity = 0.18 + Math.sin(t * 3.2) * 0.08;
      this.volcanoBattleBeam.rotation.y = t * 0.35;
    }
    if (this.volcanoShieldDome && this.volcanoShieldDome.visible) {
      const sm = this.volcanoShieldDome.material as THREE.MeshBasicMaterial;
      sm.opacity = 0.14 + Math.sin(t * 1.8) * 0.04;
      this.volcanoShieldDome.rotation.y = t * 0.08;
    }
    if (this.emberInst) {
      for (let i = 0; i < this.emberData.length; i++) {
        const m = this.emberData[i];
        m.y += m.vy * (isBattle ? 1.35 : 0.85) * dt;
        if (m.y > 148) m.y = 52;
        const spread = 1 + ((m.y - 52) / 96) * 0.55;
        const swayX = Math.sin(t * 1.7 + m.phase) * 4.5;
        const swayZ = Math.cos(t * 1.5 + m.phase) * 4.5;
        const fade = 1 - (m.y - 52) / 98;
        const sc = Math.max(0.18, m.size * fade);
        _dummy.position.set(m.x * spread + swayX, m.y, m.z * spread + swayZ);
        _dummy.rotation.set(t * 1.2 + m.phase, t * 0.9, 0);
        _dummy.scale.set(sc, sc, sc);
        _dummy.updateMatrix();
        this.emberInst.setMatrixAt(i, _dummy.matrix);
      }
      this.emberInst.instanceMatrix.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  }
}

window.WorldMap3D = new WorldMap3DController();
