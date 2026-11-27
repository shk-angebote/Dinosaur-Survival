import { useCallback, useRef, useState } from 'react';
import { GameShell } from './components/GameShell';
import { MultiplayerHubDrawer } from './components/MultiplayerHubDrawer';
import { WorldChatDrawer } from './components/WorldChatDrawer';
import type {
  GameRuntimeHandle,
  GameRuntimeSnapshot,
  VisitSettlementTarget,
} from './game/gameRuntime';

export default function App() {
  const [bonfireLevel, setBonfireLevel] = useState<number>(1);
  const [homeTile, setHomeTile] = useState<{ x: number; y: number }>({ x: 23, y: 13 });
  const runtimeRef = useRef<GameRuntimeHandle | null>(null);

  const handleSnapshot = useCallback((snapshot: GameRuntimeSnapshot) => {
    setBonfireLevel((prev) => (prev === snapshot.bonfireLevel ? prev : snapshot.bonfireLevel));
    if (snapshot.homeTile) {
      setHomeTile((prev) =>
        prev.x === snapshot.homeTile.x && prev.y === snapshot.homeTile.y ? prev : snapshot.homeTile
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

  const handleForceSave = useCallback(() => {
    runtimeRef.current?.forceSave();
  }, []);

  return (
    <>
      <GameShell onSnapshot={handleSnapshot} onRuntimeReady={handleRuntimeReady} />
      <MultiplayerHubDrawer
        homeTile={homeTile}
        onJumpToTile={handleJumpToTile}
        onVisitSettlement={handleVisitSettlement}
        onForceSave={handleForceSave}
      />
      <WorldChatDrawer bonfireLevel={bonfireLevel} />
    </>
  );
}
