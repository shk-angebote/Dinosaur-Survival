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
}

export interface GameRuntimeHandle {
  jumpToWorldTile: (tileX: number, tileY: number) => void;
  visitSettlement: (target: VisitSettlementTarget) => void;
  tradeResourcesWithNeighbor: (req: NeighborTradeRequest) => NeighborActionResult;
  supportNeighborBonfire: (target: VisitSettlementTarget) => NeighborActionResult;
  forceSave: () => void;
}

export interface GameRuntimeHooks {
  onSnapshot?: (snapshot: GameRuntimeSnapshot) => void;
}

export function initGameRuntime(hooks?: GameRuntimeHooks): GameRuntimeHandle;
