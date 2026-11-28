import { useCallback, useRef, useState } from 'react';
import { GameShell } from './components/GameShell';
import { MultiplayerHubDrawer } from './components/MultiplayerHubDrawer';
import { VolcanoStatusWidget } from './components/VolcanoStatusWidget';
import { WorldChatDrawer } from './components/WorldChatDrawer';
import type {
  GameRuntimeHandle,
  GameRuntimeSnapshot,
  NeighborActionResult,
  ResourceStock,
  TroopKey,
  VisitSettlementTarget,
  VolcanoMobilizationSnapshot,
} from './game/gameRuntime';

const DEFAULT_RESOURCES: ResourceStock = { meat: 0, wood: 0, stone: 0, fur: 0 };

function isSameMobilization(
  a: VolcanoMobilizationSnapshot | null,
  b: VolcanoMobilizationSnapshot | undefined
): boolean {
  if (!b) return a === null;
  if (!a) return false;
  const ag = a.garrison;
  const bg = b.garrison;
  const sameGarrison =
    Boolean(ag?.active) === Boolean(bg?.active) &&
    (ag?.totalTroops || 0) === (bg?.totalTroops || 0) &&
    (ag?.squadPower || 0) === (bg?.squadPower || 0) &&
    (ag?.troops?.slinger || 0) === (bg?.troops?.slinger || 0) &&
    (ag?.troops?.clubman || 0) === (bg?.troops?.clubman || 0) &&
    (ag?.troops?.dinorider || 0) === (bg?.troops?.dinorider || 0) &&
    (ag?.heroNames?.length || 0) === (bg?.heroNames?.length || 0) &&
    (ag?.heroNames || []).every((n, i) => n === (bg?.heroNames || [])[i]);
  return (
    sameGarrison &&
    (a.injuredTotal || 0) === (b.injuredTotal || 0) &&
    a.status === b.status &&
    a.marchPhase === b.marchPhase &&
    a.assignedTotal === b.assignedTotal &&
    a.availableTotal === b.availableTotal &&
    a.assignedHeroes === b.assignedHeroes &&
    a.maxHeroes === b.maxHeroes &&
    a.squadPower === b.squadPower &&
    a.assignedTroops.slinger === b.assignedTroops.slinger &&
    a.assignedTroops.clubman === b.assignedTroops.clubman &&
    a.assignedTroops.dinorider === b.assignedTroops.dinorider &&
    a.availableTroops.slinger === b.availableTroops.slinger &&
    a.availableTroops.clubman === b.availableTroops.clubman &&
    a.availableTroops.dinorider === b.availableTroops.dinorider &&
    a.assignedHeroNames.length === b.assignedHeroNames.length &&
    a.assignedHeroNames.every((name, idx) => name === b.assignedHeroNames[idx])
  );
}

export default function App() {
  const [bonfireLevel, setBonfireLevel] = useState<number>(1);
  const [homeTile, setHomeTile] = useState<{ x: number; y: number }>({ x: 240, y: 940 });
  const [resources, setResources] = useState<ResourceStock>(DEFAULT_RESOURCES);
  const [volcanoMobilization, setVolcanoMobilization] = useState<VolcanoMobilizationSnapshot | null>(null);
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
    if (snapshot.volcanoMobilization) {
      const nextMob = snapshot.volcanoMobilization;
      setVolcanoMobilization((prev) => (isSameMobilization(prev, nextMob) ? prev : nextMob));
    }
  }, []);

  const handleRuntimeReady = useCallback((handle: GameRuntimeHandle) => {
    runtimeRef.current = handle;
  }, []);

  const handleJumpToTile = useCallback((tileX: number, tileY: number) => {
    runtimeRef.current?.jumpToWorldTile(tileX, tileY);
  }, []);

  const handleFocusVolcano = useCallback(() => {
    runtimeRef.current?.focusVolcano();
  }, []);

  const handleOpenVolcano = useCallback(() => {
    runtimeRef.current?.openVolcano();
  }, []);

  const handleAdjustVolcanoTroop = useCallback((troopType: TroopKey, delta: number) => {
    runtimeRef.current?.adjustVolcanoMobilizationTroop(troopType, delta);
  }, []);

  const handleFillAllVolcanoTroops = useCallback(() => {
    runtimeRef.current?.fillAllVolcanoMobilization();
  }, []);

  const handleClearVolcanoTroops = useCallback(() => {
    runtimeRef.current?.clearVolcanoMobilization();
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
      <VolcanoStatusWidget
        mobilization={volcanoMobilization}
        onFocusVolcano={handleFocusVolcano}
        onOpenVolcano={handleOpenVolcano}
        onAdjustTroop={handleAdjustVolcanoTroop}
        onFillAllTroops={handleFillAllVolcanoTroops}
        onClearTroops={handleClearVolcanoTroops}
      />
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
