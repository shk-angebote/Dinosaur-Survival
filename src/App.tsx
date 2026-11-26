import { useCallback, useState } from 'react';
import { GameShell } from './components/GameShell';
import { WorldChatDrawer } from './components/WorldChatDrawer';
import type { GameRuntimeSnapshot } from './game/gameRuntime';

export default function App() {
  const [bonfireLevel, setBonfireLevel] = useState<number>(1);

  const handleSnapshot = useCallback((snapshot: GameRuntimeSnapshot) => {
    setBonfireLevel((prev) => (prev === snapshot.bonfireLevel ? prev : snapshot.bonfireLevel));
  }, []);

  return (
    <>
      <GameShell onSnapshot={handleSnapshot} />
      <WorldChatDrawer bonfireLevel={bonfireLevel} />
    </>
  );
}
