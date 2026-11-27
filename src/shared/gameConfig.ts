/**
 * Zentrale Spielkonfiguration (Single Source of Truth für Server, Web-Client & Unity-API).
 * Alle Werte werden über GET /api/v1/config ausgeliefert.
 */

import type { HeroRole, ResourceKey } from './apiTypes.ts';

export const GAME_CONFIG_VERSION = '1.0.0';
export const MAX_LEVEL = 25;
export const FREE_FINISH_SEC = 30;
export const MARCH_QUEUE_UNLOCK_LEVELS = [1, 4, 9, 15, 21] as const;

export const WORLD_GRID_COLS = 1200;
export const WORLD_GRID_ROWS = 1200;
export const WORLD_TILE_SIZE = 30;
export const WORLD_CHUNK_SIZE = 50;

export const BASE_BUILD_SECONDS: readonly number[] = [
  0,
  14, 32, 120, 360, 900,
  1800, 3600, 7200, 14400, 28800,
  43200, 57600, 72000, 86400, 108000,
  129600, 151200, 172800, 201600, 230400,
  259200, 302400, 345600, 388800, 432000
];

export interface BuildingConfig {
  id: string;
  name: string;
  baseCost: Record<ResourceKey, number>;
  costScale: number;
  buildTimeMult: number;
}

export const BUILDING_CONFIGS: Record<string, BuildingConfig> = {
  bonfire: { id: 'bonfire', name: 'Großes Signalfeuer', baseCost: { meat: 35, wood: 55, stone: 40, fur: 15 }, costScale: 1.55, buildTimeMult: 1.2 },
  lumber: { id: 'lumber', name: 'Holzfällerlager', baseCost: { meat: 20, wood: 25, stone: 15, fur: 5 }, costScale: 1.48, buildTimeMult: 0.9 },
  quarry: { id: 'quarry', name: 'Basalt-Steinbruch', baseCost: { meat: 22, wood: 30, stone: 12, fur: 6 }, costScale: 1.5, buildTimeMult: 0.95 },
  hunter: { id: 'hunter', name: 'Jagdlager', baseCost: { meat: 15, wood: 32, stone: 18, fur: 10 }, costScale: 1.48, buildTimeMult: 0.95 },
  hut: { id: 'hut', name: 'Wohnhütte', baseCost: { meat: 25, wood: 35, stone: 20, fur: 14 }, costScale: 1.52, buildTimeMult: 1.0 },
  slinger: { id: 'slinger', name: 'Steinschleuderer-Lager', baseCost: { meat: 30, wood: 38, stone: 30, fur: 12 }, costScale: 1.52, buildTimeMult: 1.05 },
  clubman: { id: 'clubman', name: 'Keulenschwinger-Ring', baseCost: { meat: 34, wood: 42, stone: 26, fur: 14 }, costScale: 1.52, buildTimeMult: 1.05 },
  dinorider: { id: 'dinorider', name: 'Dinoreiter-Koppel', baseCost: { meat: 48, wood: 46, stone: 36, fur: 22 }, costScale: 1.56, buildTimeMult: 1.15 },
  hero_cave: { id: 'hero_cave', name: 'Heldenhöhle', baseCost: { meat: 40, wood: 50, stone: 48, fur: 20 }, costScale: 1.55, buildTimeMult: 1.15 },
  workshop: { id: 'workshop', name: 'Forschungszelt', baseCost: { meat: 35, wood: 45, stone: 42, fur: 20 }, costScale: 1.55, buildTimeMult: 1.1 },
  scout: { id: 'scout', name: 'Späher-Posten', baseCost: { meat: 35, wood: 44, stone: 32, fur: 24 }, costScale: 1.52, buildTimeMult: 1.05 },
  infirmary: { id: 'infirmary', name: 'Krankenzelt', baseCost: { meat: 20, wood: 36, stone: 18, fur: 24 }, costScale: 1.52, buildTimeMult: 1.0 },
  graveyard: { id: 'graveyard', name: 'Friedhof', baseCost: { meat: 15, wood: 30, stone: 38, fur: 14 }, costScale: 1.52, buildTimeMult: 1.05 },
  marketplace: { id: 'marketplace', name: 'Marktplatz', baseCost: { meat: 24, wood: 42, stone: 24, fur: 18 }, costScale: 1.5, buildTimeMult: 1.05 },
  warehouse: { id: 'warehouse', name: 'Lagerhaus', baseCost: { meat: 18, wood: 45, stone: 34, fur: 12 }, costScale: 1.54, buildTimeMult: 1.05 }
};

export interface DinoLootEntry {
  resKey?: ResourceKey;
  itemKey?: string;
  min: number;
  max: number;
  chancePct: number;
}

export interface DinoSpeciesConfig {
  id: string;
  name: string;
  tier: string;
  levelRange: [number, number];
  basePower: number;
  powerPerLevel: number;
  counterRole: HeroRole;
  strengths: string[];
  weaknessTip: string;
  accent: string;
  lootTable: DinoLootEntry[];
}

export const DINO_SPECIES_CONFIG: readonly DinoSpeciesConfig[] = [
  {
    id: 'compys',
    name: 'Asche-Compsognathus',
    tier: 'Beutejäger',
    levelRange: [1, 3],
    basePower: 420,
    powerPerLevel: 140,
    counterRole: 'Fernkampf',
    strengths: ['Flinkes Rudel', 'Schneller Flankenangriff'],
    weaknessTip: 'Fernkampf-Helden und Steinschleuderer dezimieren das Rudel aus sicherer Distanz.',
    accent: '#86efac',
    lootTable: [
      { resKey: 'meat', min: 55, max: 95, chancePct: 100 },
      { resKey: 'fur', min: 18, max: 32, chancePct: 80 },
      { itemKey: 'bones', min: 1, max: 1, chancePct: 45 },
      { itemKey: 'pvePaint', min: 1, max: 1, chancePct: 30 }
    ]
  },
  {
    id: 'raptor',
    name: 'Glutklauen-Raptor',
    tier: 'Raubsaurier',
    levelRange: [2, 6],
    basePower: 780,
    powerPerLevel: 210,
    counterRole: 'Tank',
    strengths: ['Scharfe Sprungklauen', 'Hohe Krit-Treffer'],
    weaknessTip: 'Ein Tank-Held mit Dinoreitern fängt den tödlichen Sprungangriff ab.',
    accent: '#fb923c',
    lootTable: [
      { resKey: 'meat', min: 95, max: 160, chancePct: 100 },
      { resKey: 'fur', min: 30, max: 52, chancePct: 85 },
      { itemKey: 'bones', min: 1, max: 2, chancePct: 55 },
      { itemKey: 'pvePaint', min: 1, max: 2, chancePct: 40 },
      { itemKey: 'gearChest', min: 1, max: 1, chancePct: 22 }
    ]
  },
  {
    id: 'dilopho',
    name: 'Schwefel-Dilophosaurus',
    tier: 'Spucker',
    levelRange: [4, 9],
    basePower: 1350,
    powerPerLevel: 290,
    counterRole: 'Nahkampf',
    strengths: ['Ätzender Schwefel-Speichel', 'Fernkampf-Störung'],
    weaknessTip: 'Schnelle Nahkampf-Helden und Keulenschwinger unterbrechen seine Angriffe.',
    accent: '#a3e635',
    lootTable: [
      { resKey: 'meat', min: 140, max: 220, chancePct: 100 },
      { resKey: 'wood', min: 65, max: 110, chancePct: 75 },
      { itemKey: 'bones', min: 1, max: 2, chancePct: 60 },
      { itemKey: 'pvePaint', min: 2, max: 3, chancePct: 50 },
      { itemKey: 'gearChest', min: 1, max: 1, chancePct: 28 },
      { itemKey: 'shamanTotem', min: 1, max: 1, chancePct: 18 }
    ]
  },
  {
    id: 'stego',
    name: 'Basalt-Stegosaurus',
    tier: 'Gepanzert',
    levelRange: [6, 12],
    basePower: 2200,
    powerPerLevel: 410,
    counterRole: 'Fernkampf',
    strengths: ['Obsidian-Rückenplatten', 'Schwerer Stachelschwanz'],
    weaknessTip: 'Fernkämpfer umgehen die tödliche Reichweite seines Stachelschwanzes.',
    accent: '#fbbf24',
    lootTable: [
      { resKey: 'meat', min: 210, max: 320, chancePct: 100 },
      { resKey: 'stone', min: 110, max: 185, chancePct: 90 },
      { itemKey: 'bones', min: 2, max: 3, chancePct: 65 },
      { itemKey: 'gearChest', min: 1, max: 2, chancePct: 36 },
      { itemKey: 'goldenBones', min: 1, max: 1, chancePct: 14 },
      { itemKey: 'shamanTotem', min: 1, max: 1, chancePct: 25 }
    ]
  },
  {
    id: 'tricera',
    name: 'Obsidian-Triceratops',
    tier: 'Bollwerk',
    levelRange: [9, 15],
    basePower: 3400,
    powerPerLevel: 540,
    counterRole: 'Nahkampf',
    strengths: ['Dreifach-Hornsturm', 'Massiver Nackenschild'],
    weaknessTip: 'Nahkampf-Flankenangriffe durchbrechen den schweren Frontschild.',
    accent: '#60a5fa',
    lootTable: [
      { resKey: 'meat', min: 300, max: 460, chancePct: 100 },
      { resKey: 'stone', min: 165, max: 260, chancePct: 90 },
      { resKey: 'fur', min: 95, max: 155, chancePct: 80 },
      { itemKey: 'bones', min: 2, max: 3, chancePct: 72 },
      { itemKey: 'gearChest', min: 1, max: 2, chancePct: 44 },
      { itemKey: 'goldenBones', min: 1, max: 1, chancePct: 20 },
      { itemKey: 'shamanTotem', min: 1, max: 1, chancePct: 32 }
    ]
  },
  {
    id: 'ankylo',
    name: 'Magma-Ankylosaurus',
    tier: 'Festung',
    levelRange: [12, 18],
    basePower: 4900,
    powerPerLevel: 680,
    counterRole: 'Fernkampf',
    strengths: ['Vulkangestein-Panzer', 'Erdbeben-Keulenschwanz'],
    weaknessTip: 'Präzise Fernkampf-Salven treffen die ungeschützten Gelenke.',
    accent: '#f59e0b',
    lootTable: [
      { resKey: 'stone', min: 260, max: 410, chancePct: 100 },
      { resKey: 'meat', min: 340, max: 520, chancePct: 95 },
      { itemKey: 'pvePaint', min: 3, max: 5, chancePct: 70 },
      { itemKey: 'gearChest', min: 2, max: 2, chancePct: 52 },
      { itemKey: 'goldenBones', min: 1, max: 1, chancePct: 28 },
      { itemKey: 'shamanTotem', min: 1, max: 2, chancePct: 40 }
    ]
  },
  {
    id: 'spino',
    name: 'Lavastrom-Spinosaurus',
    tier: 'Apex-Jäger',
    levelRange: [16, 22],
    basePower: 7100,
    powerPerLevel: 880,
    counterRole: 'Tank',
    strengths: ['Glühendes Rückensegel', 'Reißende Kiefer-Kombo'],
    weaknessTip: 'Ein starker Tank mit vollem 3-Helden-Trupp hält seinem Dauerangriff stand.',
    accent: '#f87171',
    lootTable: [
      { resKey: 'meat', min: 520, max: 780, chancePct: 100 },
      { resKey: 'fur', min: 220, max: 340, chancePct: 95 },
      { itemKey: 'bones', min: 3, max: 5, chancePct: 85 },
      { itemKey: 'gearChest', min: 2, max: 3, chancePct: 65 },
      { itemKey: 'goldenBones', min: 1, max: 2, chancePct: 40 },
      { itemKey: 'shamanTotem', min: 1, max: 2, chancePct: 52 }
    ]
  },
  {
    id: 'trex',
    name: 'Caldera-Tyrannosaurus',
    tier: 'Urzeit-König',
    levelRange: [20, 25],
    basePower: 10500,
    powerPerLevel: 1200,
    counterRole: 'Tank',
    strengths: ['Königs-Brüllen', 'Knochenbrecher-Biss', 'Unbändige Ausdauer'],
    weaknessTip: 'Nur ein komplett gerüsteter 3-Klassen-Trupp (Tank + Nahkampf + Fernkampf) bezwingt den Urzeit-König.',
    accent: '#ef4444',
    lootTable: [
      { resKey: 'meat', min: 850, max: 1300, chancePct: 100 },
      { resKey: 'stone', min: 420, max: 660, chancePct: 100 },
      { itemKey: 'bones', min: 4, max: 6, chancePct: 95 },
      { itemKey: 'pvePaint', min: 5, max: 8, chancePct: 85 },
      { itemKey: 'gearChest', min: 3, max: 4, chancePct: 80 },
      { itemKey: 'goldenBones', min: 1, max: 2, chancePct: 62 },
      { itemKey: 'shamanTotem', min: 2, max: 3, chancePct: 72 }
    ]
  }
];

export function getPublicGameConfig() {
  return {
    version: GAME_CONFIG_VERSION,
    maxLevel: MAX_LEVEL,
    freeFinishSec: FREE_FINISH_SEC,
    marchQueueUnlockLevels: [...MARCH_QUEUE_UNLOCK_LEVELS],
    world: {
      cols: WORLD_GRID_COLS,
      rows: WORLD_GRID_ROWS,
      tileSize: WORLD_TILE_SIZE,
      chunkSize: WORLD_CHUNK_SIZE
    },
    buildings: BUILDING_CONFIGS,
    dinoSpecies: DINO_SPECIES_CONFIG
  };
}
