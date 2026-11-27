import React, { useEffect, useMemo, useState } from 'react';
import { useMultiplayer } from '../hooks/useMultiplayer';
import type { TroopKey, VolcanoMobilizationSnapshot } from '../game/gameRuntime';
import type { WorldVolcanoStateDTO } from '../shared/apiTypes';

interface VolcanoStatusWidgetProps {
  mobilization: VolcanoMobilizationSnapshot | null;
  onFocusVolcano: () => void;
  onOpenVolcano: () => void;
  onAdjustTroop: (troopType: TroopKey, delta: number) => void;
  onFillAllTroops: () => void;
  onClearTroops: () => void;
}

type PanelTab = 'control' | 'rewards';

const UNIT_ROWS: Array<{ key: TroopKey; label: string }> = [
  { key: 'slinger', label: 'Steinschleuderer' },
  { key: 'clubman', label: 'Keulenkämpfer' },
  { key: 'dinorider', label: 'Dino-Reiter' },
];

const DEFAULT_MOBILIZATION: VolcanoMobilizationSnapshot = {
  status: 'idle',
  marchPhase: null,
  assignedTroops: { slinger: 0, clubman: 0, dinorider: 0 },
  availableTroops: { slinger: 0, clubman: 0, dinorider: 0 },
  totalTroops: { slinger: 0, clubman: 0, dinorider: 0 },
  assignedTotal: 0,
  availableTotal: 0,
  assignedHeroes: 0,
  assignedHeroNames: [],
  maxHeroes: 3,
  squadPower: 0,
};

function formatMarchPhaseDe(phase: VolcanoMobilizationSnapshot['marchPhase']): string {
  if (phase === 'marching_out') return 'Hinmarsch zur Zitadelle';
  if (phase === 'attacking') return 'Im Gefecht am Vulkan';
  if (phase === 'marching_back') return 'Rückmarsch ins Dorf';
  return 'Trupp im Einsatz';
}

const CYCLE_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000;
const BATTLE_DURATION_MS = 6 * 60 * 60 * 1000;

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  compact: string;
}

function splitCountdown(ms: number): CountdownParts {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const compact = days > 0 ? `${days}T ${hh}Std` : `${hh}:${mm}:${ss}`;
  return { days, hours, minutes, seconds, compact };
}

function formatNumberDe(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('de-DE');
}

function formatDateTimeDe(ts: number): string {
  try {
    return new Date(ts).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatTimeDe(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const VolcanoStatusWidget: React.FC<VolcanoStatusWidgetProps> = ({
  mobilization,
  onFocusVolcano,
  onOpenVolcano,
  onAdjustTroop,
  onFillAllTroops,
  onClearTroops,
}) => {
  const { session, volcano, refreshVolcanoState } = useMultiplayer();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('control');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // Live 1-Sekunden-Takt für präzisen Countdown
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Beim Öffnen aktuellen Serverstatus nachladen
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRefreshing(true);
    void refreshVolcanoState().finally(() => {
      if (!cancelled) setRefreshing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, refreshVolcanoState]);

  // Escape schließt das Panel
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const effective: WorldVolcanoStateDTO = useMemo(() => {
    if (volcano) {
      let phase = volcano.phase;
      let battleEndsAt = Number(volcano.battleEndsAt) || nowMs + BATTLE_DURATION_MS;
      const nextBattleStartAt = Number(volcano.nextBattleStartAt) || nowMs + CYCLE_INTERVAL_MS;
      if (phase === 'battle' && nowMs >= battleEndsAt) {
        phase = 'peace';
      } else if (phase === 'peace' && nowMs >= nextBattleStartAt) {
        phase = 'battle';
        battleEndsAt = nextBattleStartAt + BATTLE_DURATION_MS;
      }
      return {
        ...volcano,
        phase,
        battleEndsAt,
        nextBattleStartAt,
      };
    }
    return {
      cycleNumber: 1,
      cycleIntervalMs: CYCLE_INTERVAL_MS,
      battleDurationMs: BATTLE_DURATION_MS,
      phase: 'battle',
      cycleStartedAt: nowMs,
      battleEndsAt: nowMs + BATTLE_DURATION_MS,
      nextBattleStartAt: nowMs + CYCLE_INTERVAL_MS,
      holderUid: null,
      holderTribeName: null,
      holderSince: null,
      garrisonPower: 380,
      garrisonHeroNames: ['Vulkan-Wächter'],
      garrisonTroops: { slinger: 20, clubman: 24, dinorider: 10 },
      reignCount: 0,
      recentBattles: [],
      updatedAt: nowMs,
    };
  }, [volcano, nowMs]);

  const isBattle = effective.phase === 'battle';
  const targetTimestamp = isBattle ? effective.battleEndsAt : effective.nextBattleStartAt;
  const remainingMs = Math.max(0, targetTimestamp - nowMs);
  const countdown = splitCountdown(remainingMs);

  const cycleTotalMs = isBattle
    ? Math.max(1000, effective.battleDurationMs || BATTLE_DURATION_MS)
    : Math.max(1000, (effective.cycleIntervalMs || CYCLE_INTERVAL_MS) - (effective.battleDurationMs || BATTLE_DURATION_MS));
  const progressPct = Math.min(100, Math.max(2, ((cycleTotalMs - remainingMs) / cycleTotalMs) * 100));

  const isOwnRuler = Boolean(effective.holderUid && session.uid && effective.holderUid === session.uid);
  const hasRuler = Boolean(effective.holderUid && effective.holderTribeName);
  const controlLabel = isOwnRuler
    ? 'Eigener Stamm regiert'
    : hasRuler
    ? 'Fremder Stamm regiert'
    : 'Unbesetzt (Neutral)';
  const rulerDisplay = effective.holderTribeName || 'Vulkan-Wächter';

  const troops = effective.garrisonTroops || { slinger: 0, clubman: 0, dinorider: 0 };
  const totalGarrisonTroops = (troops.slinger || 0) + (troops.clubman || 0) + (troops.dinorider || 0);
  const recentBattles = Array.isArray(effective.recentBattles) ? effective.recentBattles : [];

  const mob = mobilization ?? DEFAULT_MOBILIZATION;
  const isMobilizationMarching = mob.status === 'marching';
  const isMobilizationReady = mob.status === 'ready';
  const mobStatusLabel = isMobilizationMarching
    ? 'Im Einsatz'
    : isMobilizationReady
    ? 'Einsatzbereit'
    : 'Nicht zugewiesen';
  const mobFillPct = isMobilizationMarching
    ? 100
    : mob.availableTotal > 0
    ? Math.min(100, Math.max(0, (mob.assignedTotal / mob.availableTotal) * 100))
    : 0;
  const canFillAll = !isMobilizationMarching && mob.availableTotal > 0 && mob.assignedTotal < mob.availableTotal;
  const canClearAll = !isMobilizationMarching && mob.assignedTotal > 0;

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshVolcanoState();
    } finally {
      setRefreshing(false);
    }
  };

  const handleFocusClick = () => {
    setOpen(false);
    onFocusVolcano();
  };

  const handleOpenCitadelClick = () => {
    setOpen(false);
    onOpenVolcano();
  };

  return (
    <>
      <button
        type="button"
        className={`volc-hud-trigger${isBattle ? ' is-battle' : ' is-peace'}${isOwnRuler ? ' is-own' : ''}`}
        aria-expanded={open}
        aria-controls="volcano-status-panel"
        aria-label={`Vulkan-Status: ${isBattle ? 'Kampf aktiv' : 'Kaldera-Schild'}, verbleibend ${countdown.compact}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke={isOwnRuler ? '#4ade80' : isBattle ? '#fb923c' : '#7dd3fc'}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {isBattle ? (
            <path d="M12 2c.9 3.2 4 5.2 4 9a4 4 0 0 1-8 0c0-1.9.9-3.6 2-5-.2 1.8.8 2.8 2 3 .4-2.2-.2-4.6 0-7ZM4 20l4.5-9h7L20 20H4Z" />
          ) : (
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          )}
        </svg>
        <span className="volc-hud-trigger-label">
          {isBattle ? 'Vulkan-Kampf' : 'Vulkan-Schild'}
        </span>
        <span className="volc-hud-trigger-sep" aria-hidden="true">
          ·
        </span>
        <span className="volc-hud-trigger-time mono">{countdown.compact}</span>
      </button>

      <aside
        id="volcano-status-panel"
        className={`volc-hud-panel${open ? ' open' : ''}`}
        aria-label="Status der Vulkan-Zitadelle"
      >
        <div className="volc-hud-header">
          <div className="volc-hud-heading-block">
            <h2 className="volc-hud-title">Vulkan-Zitadelle</h2>
            <p className="volc-hud-meta">
              <span>Zyklus {effective.cycleNumber}</span>
              <span aria-hidden="true">·</span>
              <span>Zentrum 600, 600</span>
              <span aria-hidden="true">·</span>
              <span>Alle 4 Wochen</span>
            </p>
          </div>
          <div className="volc-hud-head-actions">
            <button
              type="button"
              className="volc-hud-icon-btn"
              aria-label="Vulkan-Status aktualisieren"
              onClick={handleManualRefresh}
              disabled={refreshing}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshing ? 'volc-spin' : undefined}
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            <button
              type="button"
              className="volc-hud-icon-btn"
              aria-label="Vulkan-Status schließen"
              onClick={() => setOpen(false)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="volc-hud-body">
          {/* Phase & Live-Countdown */}
          <section className="volc-hud-section" aria-label="Kampf-Countdown">
            <div className="volc-phase-row">
              <span className={`volc-phase-text${isBattle ? ' is-battle' : ' is-peace'}`}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {isBattle ? (
                    <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
                  ) : (
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                  )}
                </svg>
                <span>{isBattle ? 'Server-Kampf aktiv' : 'Kaldera-Schild aktiv'}</span>
              </span>
              <span className="volc-phase-date mono">
                {isBattle ? `Endet ${formatDateTimeDe(effective.battleEndsAt)}` : `Start ${formatDateTimeDe(effective.nextBattleStartAt)}`}
              </span>
            </div>

            <div className="volc-countdown-grid" role="timer" aria-live="off">
              <div className="volc-cd-cell">
                <span className="volc-cd-num mono">{String(countdown.days).padStart(2, '0')}</span>
                <span className="volc-cd-unit">Tage</span>
              </div>
              <div className="volc-cd-cell">
                <span className="volc-cd-num mono">{String(countdown.hours).padStart(2, '0')}</span>
                <span className="volc-cd-unit">Std</span>
              </div>
              <div className="volc-cd-cell">
                <span className="volc-cd-num mono">{String(countdown.minutes).padStart(2, '0')}</span>
                <span className="volc-cd-unit">Min</span>
              </div>
              <div className="volc-cd-cell">
                <span className="volc-cd-num mono">{String(countdown.seconds).padStart(2, '0')}</span>
                <span className="volc-cd-unit">Sek</span>
              </div>
            </div>

            <div className="volc-progress-track" aria-hidden="true">
              <div
                className={`volc-progress-fill${isBattle ? ' is-battle' : ' is-peace'}`}
                style={{ width: `${progressPct.toFixed(1)}%` }}
              />
            </div>

            <p className="volc-phase-note">
              {isBattle
                ? 'Das 6-Stunden-Kampffenster ist geöffnet. Stämme können die Zitadelle jetzt angreifen oder ihre Garnison verstärken.'
                : 'Der Vulkan steht unter Schutz. Bis zum nächsten 4-Wochen-Kampf erhält der Herrscher-Stamm alle Zitadellen-Segen.'}
            </p>
          </section>

          {/* Segmented Switcher */}
          <div className="volc-tabs" role="tablist" aria-label="Vulkan-Details">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'control'}
              className={`volc-tab-btn${activeTab === 'control' ? ' active' : ''}`}
              onClick={() => setActiveTab('control')}
            >
              Kontrolle &amp; Segen
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'rewards'}
              className={`volc-tab-btn${activeTab === 'rewards' ? ' active' : ''}`}
              onClick={() => setActiveTab('rewards')}
            >
              Belohnungen &amp; Chronik
            </button>
          </div>

          {activeTab === 'control' ? (
            <div className="volc-tab-content" role="tabpanel">
              {/* Kontroll-Status */}
              <section className="volc-hud-section">
                <h3 className="volc-section-heading">Kontroll-Status</h3>
                <div className="volc-control-summary">
                  <div className="volc-control-main">
                    <span className={`volc-ruler-name${isOwnRuler ? ' is-own' : hasRuler ? ' is-enemy' : ''}`}>
                      {rulerDisplay}
                    </span>
                    <span className="volc-control-sub">
                      <span>{controlLabel}</span>
                      {effective.holderSince ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Seit {formatDateTimeDe(effective.holderSince)}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div className="volc-power-readout">
                    <span className="volc-power-label">Garnison</span>
                    <span className="volc-power-value mono">
                      {formatNumberDe(effective.garrisonPower)} KK
                    </span>
                  </div>
                </div>

                <dl className="volc-detail-list">
                  <div className="volc-detail-row">
                    <dt>Verteidigende Helden</dt>
                    <dd>
                      {effective.garrisonHeroNames && effective.garrisonHeroNames.length > 0
                        ? effective.garrisonHeroNames.join(', ')
                        : 'Kaldera-Wache'}
                    </dd>
                  </div>
                  <div className="volc-detail-row">
                    <dt>Garnison-Truppen</dt>
                    <dd className="mono">
                      {formatNumberDe(totalGarrisonTroops)} gesamt ({troops.slinger || 0} S · {troops.clubman || 0} K · {troops.dinorider || 0} R)
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Mobilisierungs-Status */}
              <section className="volc-hud-section" aria-label="Mobilisierungs-Status">
                <div className="volc-section-head-inline">
                  <h3 className="volc-section-heading">Mobilisierungs-Status</h3>
                  <span
                    className={`volc-mob-state${
                      isMobilizationMarching ? ' is-marching' : isMobilizationReady ? ' is-ready' : ''
                    }`}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {isMobilizationMarching ? (
                        <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
                      ) : isMobilizationReady ? (
                        <path d="M20 6 9 17l-5-5" />
                      ) : (
                        <path d="M12 8v4m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
                      )}
                    </svg>
                    <span>{mobStatusLabel}</span>
                  </span>
                </div>

                <div className="volc-mob-summary">
                  <div className="volc-mob-main">
                    <span className="volc-mob-count mono">
                      {isMobilizationMarching
                        ? `${formatNumberDe(mob.assignedTotal)} Einheiten im Einsatz`
                        : `${formatNumberDe(mob.assignedTotal)} / ${formatNumberDe(mob.availableTotal)} Einheiten zugewiesen`}
                    </span>
                    <span className="volc-mob-meta">
                      {isMobilizationMarching ? (
                        <>
                          <span>{formatMarchPhaseDe(mob.marchPhase)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="mono">
                            {mob.assignedHeroes}/{mob.maxHeroes} Helden
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="mono">
                            {mob.assignedHeroes}/{mob.maxHeroes} Helden
                          </span>
                          {mob.assignedHeroNames.length > 0 ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="volc-mob-heroes">
                                {mob.assignedHeroNames.join(', ')}
                              </span>
                            </>
                          ) : null}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="volc-power-readout">
                    <span className="volc-power-label">Truppstärke</span>
                    <span className="volc-mob-power mono">{formatNumberDe(mob.squadPower)} KK</span>
                  </div>
                </div>

                <div
                  className="volc-progress-track"
                  role="progressbar"
                  aria-label="Zugewiesene Einheiten für den Vulkan-Kampf"
                  aria-valuenow={Math.round(mobFillPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`volc-progress-fill${
                      isMobilizationMarching ? ' is-battle' : ' is-mob'
                    }`}
                    style={{ width: `${mobFillPct.toFixed(1)}%` }}
                  />
                </div>

                {mob.availableTotal === 0 && mob.assignedTotal === 0 ? (
                  <p className="volc-empty-note">
                    Noch keine Soldaten verfügbar — rekrutiere Einheiten in den Kasernen, um sie für den nächsten Vulkan-Kampf zuzuweisen.
                  </p>
                ) : (
                  <>
                    <ul className="volc-mob-unit-list">
                      {UNIT_ROWS.map((unit) => {
                        const assigned = mob.assignedTroops[unit.key] || 0;
                        const available = mob.availableTroops[unit.key] || 0;
                        const canDec = !isMobilizationMarching && assigned > 0;
                        const canInc = !isMobilizationMarching && assigned < available;
                        return (
                          <li key={unit.key} className="volc-mob-unit-row">
                            <span className="volc-mob-unit-name">{unit.label}</span>
                            <div className="volc-mob-unit-right">
                              <span className="volc-mob-unit-count mono">
                                {isMobilizationMarching
                                  ? formatNumberDe(assigned)
                                  : `${formatNumberDe(assigned)} / ${formatNumberDe(available)}`}
                              </span>
                              {!isMobilizationMarching ? (
                                <div className="volc-mob-stepper">
                                  <button
                                    type="button"
                                    className="volc-mob-step-btn"
                                    aria-label={`${unit.label} verringern`}
                                    disabled={!canDec}
                                    onClick={() => onAdjustTroop(unit.key, -1)}
                                  >
                                    −
                                  </button>
                                  <button
                                    type="button"
                                    className="volc-mob-step-btn"
                                    aria-label={`${unit.label} erhöhen`}
                                    disabled={!canInc}
                                    onClick={() => onAdjustTroop(unit.key, 1)}
                                  >
                                    +
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {!isMobilizationMarching ? (
                      <div className="volc-mob-actions">
                        <button
                          type="button"
                          className="volc-mob-quick-btn"
                          disabled={!canFillAll}
                          onClick={onFillAllTroops}
                        >
                          Alle zuweisen
                        </button>
                        <button
                          type="button"
                          className="volc-mob-quick-btn"
                          disabled={!canClearAll}
                          onClick={onClearTroops}
                        >
                          Leeren
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              {/* Aktive Herrscher-Segen */}
              <section className="volc-hud-section">
                <div className="volc-section-head-inline">
                  <h3 className="volc-section-heading">Herrscher-Segen</h3>
                  <span className={`volc-buff-state${isOwnRuler ? ' is-active' : ''}`}>
                    {isOwnRuler ? 'Aktiv für deinen Stamm' : 'Für den siegreichen Stamm'}
                  </span>
                </div>
                <ul className="volc-reward-list">
                  <li className="volc-reward-row">
                    <div>
                      <div className="volc-reward-name">Dorf-Ressourcenproduktion</div>
                      <div className="volc-reward-desc">Fleisch, Holz, Stein &amp; Fell im gesamten Dorf</div>
                    </div>
                    <span className={`volc-reward-val mono${isOwnRuler ? ' is-active' : ''}`}>+20 %</span>
                  </li>
                  <li className="volc-reward-row">
                    <div>
                      <div className="volc-reward-name">Trupp-Kampfkraft</div>
                      <div className="volc-reward-desc">Verstärkt alle Weltkarten- &amp; PvP-Trupps</div>
                    </div>
                    <span className={`volc-reward-val mono${isOwnRuler ? ' is-active' : ''}`}>+15 %</span>
                  </li>
                  <li className="volc-reward-row">
                    <div>
                      <div className="volc-reward-name">Herrschafts-Zyklus</div>
                      <div className="volc-reward-desc">Souveränität unter dem Kaldera-Schild</div>
                    </div>
                    <span className="volc-reward-val mono">4 Wochen</span>
                  </li>
                </ul>
              </section>
            </div>
          ) : (
            <div className="volc-tab-content" role="tabpanel">
              {/* Eroberungs-Belohnungen */}
              <section className="volc-hud-section">
                <h3 className="volc-section-heading">Eroberungs-Belohnungen</h3>
                <ul className="volc-reward-list">
                  <li className="volc-reward-row">
                    <div>
                      <div className="volc-reward-name">Goldene Knochen</div>
                      <div className="volc-reward-desc">Für legendäre Helden-Beschwörungen</div>
                    </div>
                    <span className="volc-reward-val mono">+3</span>
                  </li>
                  <li className="volc-reward-row">
                    <div>
                      <div className="volc-reward-name">Helden-Erfahrung</div>
                      <div className="volc-reward-desc">Direkt ins Stammes-Inventar</div>
                    </div>
                    <span className="volc-reward-val mono">+450 XP</span>
                  </li>
                  <li className="volc-reward-row">
                    <div>
                      <div className="volc-reward-name">Kriegsbeute-Vorrat</div>
                      <div className="volc-reward-desc">Fleisch, Holz &amp; Stein je +350</div>
                    </div>
                    <span className="volc-reward-val mono">+1.050</span>
                  </li>
                </ul>
              </section>

              {/* Letzte Server-Gefechte */}
              <section className="volc-hud-section">
                <h3 className="volc-section-heading">Letzte Kämpfe</h3>
                {recentBattles.length === 0 ? (
                  <p className="volc-empty-note">
                    Noch keine Gefechte in Zyklus {effective.cycleNumber} aufgezeichnet.
                  </p>
                ) : (
                  <ul className="volc-chronicle-list">
                    {recentBattles.slice(0, 5).map((entry) => {
                      const isReinforce = Boolean(entry.reinforced);
                      const isConquest = Boolean(entry.attackerWon && !isReinforce);
                      const outcome = isReinforce
                        ? 'Verstärkt'
                        : isConquest
                        ? 'Erobert'
                        : 'Abgewehrt';
                      return (
                        <li key={entry.battleId} className="volc-chronicle-row">
                          <div className="volc-chronicle-top">
                            <span className={`volc-chronicle-outcome${isConquest ? ' is-conquest' : ''}`}>
                              {outcome}: {entry.attackerTribeName}
                              {!isReinforce ? ` vs. ${entry.defenderTribeName}` : ''}
                            </span>
                            <span className="volc-chronicle-time mono">
                              {formatTimeDe(entry.timestamp)}
                            </span>
                          </div>
                          <div className="volc-chronicle-meta mono">
                            Angriff {formatNumberDe(entry.attackerPower)} KK · Verteidigung{' '}
                            {formatNumberDe(entry.defenderPower)} KK
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="volc-hud-footer">
          <button
            type="button"
            className="volc-btn-primary"
            onClick={handleOpenCitadelClick}
          >
            {isBattle ? 'Kampfmenü öffnen' : 'Zitadelle öffnen'}
          </button>
          <button
            type="button"
            className="volc-btn-secondary"
            onClick={handleFocusClick}
          >
            Auf Karte zeigen
          </button>
        </div>
      </aside>
    </>
  );
};
