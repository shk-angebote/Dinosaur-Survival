export interface GameRuntimeSnapshot {
  bonfireLevel: number;
  power: number;
  activeTab: string;
  started: boolean;
}

export interface GameRuntimeHandle {
  jumpToWorldTile: (tileX: number, tileY: number) => void;
  forceSave: () => void;
}

export interface GameRuntimeHooks {
  onSnapshot?: (snapshot: GameRuntimeSnapshot) => void;
}

export function initGameRuntime(hooks?: GameRuntimeHooks): GameRuntimeHandle;
