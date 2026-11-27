import { useCallback, useEffect, useState } from 'react';
import bridge, {
  type ConnectionDiagnostics,
  type DiagnosticLogEntry,
  type PlayerSession,
} from '../multiplayerBridge';
import type {
  ResourceKey,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
  WorldTradeDTO,
} from '../shared/apiTypes';

export interface MultiplayerSnapshot {
  session: PlayerSession;
  settlements: WorldSettlementDTO[];
  marches: WorldMarchDTO[];
  chat: WorldChatMessageDTO[];
  trades: WorldTradeDTO[];
  onlinePlayers: number;
  diagnostics: ConnectionDiagnostics;
  logs: DiagnosticLogEntry[];
}

function readSnapshot(): MultiplayerSnapshot {
  const session = bridge.getSession();
  const world = bridge.getWorldData();
  return {
    session,
    settlements: world.settlements,
    marches: world.marches,
    chat: world.chat,
    trades: world.trades,
    onlinePlayers: world.onlinePlayers,
    diagnostics: bridge.getDiagnostics(),
    logs: bridge.getLogs(),
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

  const runDiagnostics = useCallback(async () => {
    return bridge.runConnectionDiagnostics();
  }, []);

  const clearLogs = useCallback(() => {
    bridge.clearLogs();
  }, []);

  const proposeTrade = useCallback(
    async (req: {
      toUid: string;
      toTribeName: string;
      offerResource: ResourceKey;
      offerAmount: number;
      requestResource: ResourceKey;
      requestAmount: number;
    }) => bridge.proposeTrade(req),
    []
  );

  const confirmTrade = useCallback(async (tradeId: string) => {
    return bridge.confirmTrade(tradeId);
  }, []);

  const cancelTrade = useCallback(async (tradeId: string) => {
    return bridge.cancelTrade(tradeId);
  }, []);

  return {
    ...snapshot,
    sendChat,
    signInWithGoogle,
    signOut,
    setTribeName,
    runDiagnostics,
    clearLogs,
    proposeTrade,
    confirmTrade,
    cancelTrade,
  };
}
