export interface GameRuntimeSnapshot {
  bonfireLevel: number;
  power: number;
  activeTab: string;
  started: boolean;
}

export interface GameRuntimeHooks {
  onSnapshot?: (snapshot: GameRuntimeSnapshot) => void;
}

export function initGameRuntime(hooks?: GameRuntimeHooks): void;
