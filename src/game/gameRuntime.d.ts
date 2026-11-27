export type ResourceKey = 'meat' | 'wood' | 'stone' | 'fur';

export interface ResourceStock {
  meat: number;
  wood: number;
  stone: number;
  fur: number;
}

export interface VisitSettlementTarget {
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  power: number;
  tileX: number;
  tileY: number;
}

export interface NeighborTradeRequest {
  target: VisitSettlementTarget;
  offerResource: ResourceKey;
  offerAmount: number;
  requestResource: ResourceKey;
  requestAmount: number;
}

export interface NeighborActionResult {
  ok: boolean;
  message: string;
}

export type TroopKey = 'slinger' | 'clubman' | 'dinorider';

export interface TroopCounts {
  slinger: number;
  clubman: number;
  dinorider: number;
}

export interface VolcanoMobilizationSnapshot {
  status: 'marching' | 'ready' | 'idle';
  marchPhase?: 'marching_out' | 'attacking' | 'marching_back' | null;
  assignedTroops: TroopCounts;
  availableTroops: TroopCounts;
  totalTroops: TroopCounts;
  assignedTotal: number;
  availableTotal: number;
  assignedHeroes: number;
  assignedHeroNames: string[];
  maxHeroes: number;
  squadPower: number;
}

export interface GameRuntimeSnapshot {
  bonfireLevel: number;
  power: number;
  activeTab: string;
  started: boolean;
  ember: number;
  resources: ResourceStock;
  homeTile: {
    x: number;
    y: number;
  };
  volcanoMobilization?: VolcanoMobilizationSnapshot;
}

export interface GameRuntimeHandle {
  jumpToWorldTile: (tileX: number, tileY: number) => void;
  focusVolcano: () => void;
  openVolcano: () => void;
  adjustVolcanoMobilizationTroop: (troopType: TroopKey, delta: number) => void;
  fillAllVolcanoMobilization: () => void;
  clearVolcanoMobilization: () => void;
  visitSettlement: (target: VisitSettlementTarget) => void;
  tradeResourcesWithNeighbor: (req: NeighborTradeRequest) => NeighborActionResult;
  supportNeighborBonfire: (target: VisitSettlementTarget) => NeighborActionResult;
  forceSave: () => void;
}

export interface GameRuntimeHooks {
  onSnapshot?: (snapshot: GameRuntimeSnapshot) => void;
}

export function initGameRuntime(hooks?: GameRuntimeHooks): GameRuntimeHandle;
