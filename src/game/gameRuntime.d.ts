export interface VisitSettlementTarget {
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  power: number;
  tileX: number;
  tileY: number;
}

export interface GameRuntimeSnapshot {
  bonfireLevel: number;
  power: number;
  activeTab: string;
  started: boolean;
  homeTile: {
    x: number;
    y: number;
  };
}

export interface GameRuntimeHandle {
  jumpToWorldTile: (tileX: number, tileY: number) => void;
  visitSettlement: (target: VisitSettlementTarget) => void;
  forceSave: () => void;
}

export interface GameRuntimeHooks {
  onSnapshot?: (snapshot: GameRuntimeSnapshot) => void;
}

export function initGameRuntime(hooks?: GameRuntimeHooks): GameRuntimeHandle;
