import { useCallback, useRef, useState } from 'react';
import { GameShell } from './components/GameShell';
import { MultiplayerHubDrawer } from './components/MultiplayerHubDrawer';
import { WorldChatDrawer } from './components/WorldChatDrawer';
import type { GameRuntimeHandle, GameRuntimeSnapshot } from './game/gameRuntime';

export default function App() {
  const [bonfireLevel, setBonfireLevel] = useState<number>(1);
  const runtimeRef = useRef<GameRuntimeHandle | null>(null);

  const handleSnapshot = useCallback((snapshot: GameRuntimeSnapshot) => {
    setBonfireLevel((prev) => (prev === snapshot.bonfireLevel ? prev : snapshot.bonfireLevel));
  }, []);

  const handleRuntimeReady = useCallback((handle: GameRuntimeHandle) => {
    runtimeRef.current = handle;
  }, []);

  const handleJumpToTile = useCallback((tileX: number, tileY: number) => {
    runtimeRef.current?.jumpToWorldTile(tileX, tileY);
  }, []);

  const handleForceSave = useCallback(() => {
    runtimeRef.current?.forceSave();
  }, []);

  return (
    <>
      <GameShell onSnapshot={handleSnapshot} onRuntimeReady={handleRuntimeReady} />
      <MultiplayerHubDrawer onJumpToTile={handleJumpToTile} onForceSave={handleForceSave} />
      <WorldChatDrawer bonfireLevel={bonfireLevel} />
    </>
  );
}
