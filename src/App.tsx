import { useCallback, useRef, useState } from 'react';
import { GameShell } from './components/GameShell';
import { MultiplayerHubDrawer } from './components/MultiplayerHubDrawer';
import { WorldChatDrawer } from './components/WorldChatDrawer';
import type {
  GameRuntimeHandle,
  GameRuntimeSnapshot,
  NeighborActionResult,
  ResourceStock,
  VisitSettlementTarget,
} from './game/gameRuntime';

const DEFAULT_RESOURCES: ResourceStock = { meat: 0, wood: 0, stone: 0, fur: 0 };

export default function App() {
  const [bonfireLevel, setBonfireLevel] = useState<number>(1);
  const [homeTile, setHomeTile] = useState<{ x: number; y: number }>({ x: 240, y: 940 });
  const [resources, setResources] = useState<ResourceStock>(DEFAULT_RESOURCES);
  const runtimeRef = useRef<GameRuntimeHandle | null>(null);

  const handleSnapshot = useCallback((snapshot: GameRuntimeSnapshot) => {
    setBonfireLevel((prev) => (prev === snapshot.bonfireLevel ? prev : snapshot.bonfireLevel));
    if (snapshot.homeTile) {
      setHomeTile((prev) =>
        prev.x === snapshot.homeTile.x && prev.y === snapshot.homeTile.y ? prev : snapshot.homeTile
      );
    }
    if (snapshot.resources) {
      setResources((prev) =>
        prev.meat === snapshot.resources.meat &&
        prev.wood === snapshot.resources.wood &&
        prev.stone === snapshot.resources.stone &&
        prev.fur === snapshot.resources.fur
          ? prev
          : snapshot.resources
      );
    }
  }, []);

  const handleRuntimeReady = useCallback((handle: GameRuntimeHandle) => {
    runtimeRef.current = handle;
  }, []);

  const handleJumpToTile = useCallback((tileX: number, tileY: number) => {
    runtimeRef.current?.jumpToWorldTile(tileX, tileY);
  }, []);

  const handleVisitSettlement = useCallback((target: VisitSettlementTarget) => {
    runtimeRef.current?.visitSettlement(target);
  }, []);

  const handleSupportBonfire = useCallback((target: VisitSettlementTarget): NeighborActionResult => {
    if (!runtimeRef.current) {
      return { ok: false, message: 'Spiel-Runtime noch nicht bereit.' };
    }
    return runtimeRef.current.supportNeighborBonfire(target);
  }, []);

  const handleForceSave = useCallback(() => {
    runtimeRef.current?.forceSave();
  }, []);

  return (
    <>
      <GameShell onSnapshot={handleSnapshot} onRuntimeReady={handleRuntimeReady} />
      <MultiplayerHubDrawer
        homeTile={homeTile}
        resources={resources}
        onJumpToTile={handleJumpToTile}
        onVisitSettlement={handleVisitSettlement}
        onSupportBonfire={handleSupportBonfire}
        onForceSave={handleForceSave}
      />
      <WorldChatDrawer bonfireLevel={bonfireLevel} />
    </>
  );
}
