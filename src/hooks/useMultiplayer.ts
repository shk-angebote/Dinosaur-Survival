import { useCallback, useEffect, useState } from 'react';
import bridge, { type PlayerSession } from '../multiplayerBridge';
import type {
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
} from '../shared/apiTypes';

export interface MultiplayerSnapshot {
  session: PlayerSession;
  settlements: WorldSettlementDTO[];
  marches: WorldMarchDTO[];
  chat: WorldChatMessageDTO[];
  onlinePlayers: number;
}

function readSnapshot(): MultiplayerSnapshot {
  const session = bridge.getSession();
  const world = bridge.getWorldData();
  return {
    session,
    settlements: world.settlements,
    marches: world.marches,
    chat: world.chat,
    onlinePlayers: world.onlinePlayers,
  };
}

export function useMultiplayer() {
  const [snapshot, setSnapshot] = useState<MultiplayerSnapshot>(readSnapshot);

  useEffect(() => {
    const sync = () => setSnapshot(readSnapshot());
    sync();
    return bridge.subscribe(sync);
  }, []);

  const sendChat = useCallback(async (text: string, bonfireLevel: number) => {
    return bridge.sendChat(text, bonfireLevel);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    return bridge.signInWithGoogle();
  }, []);

  const signOut = useCallback(async () => {
    return bridge.signOut();
  }, []);

  const setTribeName = useCallback((name: string) => {
    return bridge.setTribeName(name);
  }, []);

  return {
    ...snapshot,
    sendChat,
    signInWithGoogle,
    signOut,
    setTribeName,
  };
}
