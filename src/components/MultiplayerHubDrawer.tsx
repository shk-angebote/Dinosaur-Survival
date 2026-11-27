import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMultiplayer } from '../hooks/useMultiplayer';
import type { VisitSettlementTarget } from '../game/gameRuntime';
import type { WorldMarchDTO, WorldSettlementDTO } from '../shared/apiTypes';
import bridge, {
  type ChannelHealth,
  type DiagnosticLogLevel,
} from '../multiplayerBridge';

interface MultiplayerHubDrawerProps {
  homeTile?: { x: number; y: number };
  onJumpToTile?: (tileX: number, tileY: number) => void;
  onVisitSettlement?: (target: VisitSettlementTarget) => void;
  onForceSave?: () => void;
}

function fmtSaveTime(ts: number | null): string {
  if (!ts) return 'Noch nicht synchronisiert';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`;
}

function fmtLogTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function healthColor(h: ChannelHealth): string {
  switch (h) {
    case 'ok':
      return '#4ade80';
    case 'connecting':
    case 'degraded':
      return '#fbbf24';
    case 'error':
    case 'offline':
      return '#f87171';
    default:
      return '#78716c';
  }
}

function healthLabel(h: ChannelHealth): string {
  switch (h) {
    case 'ok':
      return 'OK';
    case 'connecting':
      return 'Prüft…';
    case 'degraded':
      return 'Eingeschränkt';
    case 'error':
      return 'Fehler';
    case 'offline':
      return 'Offline';
    default:
      return 'Inaktiv';
  }
}

function logLevelColor(level: DiagnosticLogLevel): string {
  switch (level) {
    case 'success':
      return '#4ade80';
    case 'warn':
      return '#fbbf24';
    case 'error':
      return '#f87171';
    default:
      return '#93c5fd';
  }
}

function getSettlementTier(bonfireLevel: number): string {
  if (bonfireLevel >= 10) return 'Urzeit-Zitadelle';
  if (bonfireLevel >= 6) return 'Basalt-Festung';
  if (bonfireLevel >= 3) return 'Klan-Siedlung';
  return 'Lagerfeuer';
}

function getSettlementStatusMeta(
  settlement: WorldSettlementDTO,
  activeMarch: WorldMarchDTO | undefined,
  nowMs: number
): { label: string; color: string; bg: string } {
  if (activeMarch) {
    return {
      label: activeMarch.kind === 'hunt' ? 'Auf Dino-Jagd' : 'Sammelt',
      color: '#38bdf8',
      bg: 'rgba(14, 116, 144, 0.25)',
    };
  }
  const ageMs = Math.max(0, nowMs - (settlement.updatedAt || 0));
  if (ageMs <= 5 * 60 * 1000) {
    return {
      label: 'Aktiv',
      color: '#4ade80',
      bg: 'rgba(22, 101, 52, 0.28)',
    };
  }
  if (ageMs <= 30 * 60 * 1000) {
    return {
      label: 'Vor Kurzem',
      color: '#fbbf24',
      bg: 'rgba(146, 64, 14, 0.28)',
    };
  }
  return {
    label: 'Ruhend',
    color: '#a8a29e',
    bg: 'rgba(68, 64, 60, 0.35)',
  };
}

const NEARBY_RADIUS_TILES = 15;

export const MultiplayerHubDrawer: React.FC<MultiplayerHubDrawerProps> = ({
  homeTile,
  onJumpToTile,
  onVisitSettlement,
  onForceSave,
}) => {
  const {
    session,
    settlements,
    marches,
    onlinePlayers,
    diagnostics,
    logs,
    signInWithGoogle,
    signOut,
    setTribeName,
    runDiagnostics,
    clearLogs,
  } = useMultiplayer();
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState(session.tribeName);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyAuth, setBusyAuth] = useState(false);
  const [busyProbe, setBusyProbe] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [onlyCloseNeighbors, setOnlyCloseNeighbors] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const logListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setNameInput(session.tribeName);
  }, [session.tribeName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open && logsExpanded && logListRef.current) {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [open, logsExpanded, logs.length]);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = setTribeName(nameInput);
    setFeedback(`Stammesname gespeichert: ${updated}`);
  };

  const handleGoogleSignIn = async () => {
    setBusyAuth(true);
    setFeedback(null);
    const res = await signInWithGoogle();
    setBusyAuth(false);
    if (res.ok) {
      setFeedback('Google-Konto verknüpft! Dorf, Weltkarte & Chat sind jetzt live über Cloud Firestore verbunden.');
    } else if (res.error?.includes('auth/unauthorized-domain')) {
      setFeedback(
        `Domain "${window.location.hostname}" muss in der Firebase Console unter Authentication → Settings → Authorized domains freigegeben werden.`
      );
    } else {
      setFeedback(`Anmeldung fehlgeschlagen: ${res.error || 'Abgebrochen oder Popup blockiert.'}`);
    }
  };

  const handleSignOut = async () => {
    setBusyAuth(true);
    await signOut();
    setBusyAuth(false);
    setFeedback('Abgemeldet. Du spielst als Gast weiter.');
  };

  const handleManualSave = () => {
    if (onForceSave) {
      onForceSave();
      setFeedback(
        session.isGuest
          ? 'Spielstand auf dem Spielserver gesichert.'
          : 'Spielstand auf Spielserver & in Cloud Firestore gesichert.'
      );
    } else {
      const world = bridge.getWorldData();
      setFeedback(`Synchronisiert (${world.settlements.length} Stämme aktiv).`);
    }
  };

  const handleRunProbe = async () => {
    setBusyProbe(true);
    setLogsExpanded(true);
    await runDiagnostics();
    setBusyProbe(false);
  };

  const handleCopyLogs = async () => {
    const header = [
      `=== Dinosaur Survival Diagnose ===`,
      `Host: ${diagnostics.hostname} | Browser Online: ${diagnostics.browserOnline}`,
      `Auth: ${diagnostics.authStatus} (${diagnostics.authDetail}) | isGuest=${session.isGuest} | uid=${session.uid}`,
      `Firestore: ${diagnostics.firestoreStatus} (${diagnostics.firestoreDetail}) | cloudSynced=${session.cloudSynced}`,
      `Listener: settlements=${diagnostics.firestoreListeners.settlements}, marches=${diagnostics.firestoreListeners.marches}, chat=${diagnostics.firestoreListeners.chat}`,
      `API: ${diagnostics.apiStatus} (${diagnostics.apiDetail}) | WS: ${diagnostics.wsStatus} (${diagnostics.wsDetail})`,
      `Projekt: ${diagnostics.firebaseProjectId} | DB: ${diagnostics.firestoreDatabaseId}`,
      diagnostics.rootCauseHint ? `Diagnose: ${diagnostics.rootCauseHint}` : '',
      `--- Log (${logs.length}) ---`,
    ].filter(Boolean);
    const lines = logs.map(
      (l) =>
        `[${fmtLogTime(l.ts)}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${
          l.detail ? ` | ${l.detail}` : ''
        }`
    );
    const payload = [...header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(payload);
      setCopyNotice('Kopiert');
      window.setTimeout(() => setCopyNotice(null), 1800);
    } catch {
      setCopyNotice('Fehler');
      window.setTimeout(() => setCopyNotice(null), 1800);
    }
  };

  const sortedSettlements = useMemo(
    () => [...settlements].sort((a, b) => b.bonfireLevel - a.bonfireLevel || b.power - a.power),
    [settlements]
  );

  const ownOrigin = useMemo(() => {
    const own = settlements.find((s) => s.uid === session.uid);
    if (own) return { x: own.tileX, y: own.tileY };
    if (homeTile) return homeTile;
    return { x: 23, y: 13 };
  }, [settlements, session.uid, homeTile]);

  const nearbyPlayers = useMemo(() => {
    const nowMs = Date.now();
    const activeMarchByUid = new Map<string, WorldMarchDTO>();
    for (const m of marches) {
      if (m.status === 'active' && !activeMarchByUid.has(m.uid)) {
        activeMarchByUid.set(m.uid, m);
      }
    }
    return settlements
      .filter((s) => s.uid !== session.uid)
      .map((s) => {
        const distance = Math.hypot(s.tileX - ownOrigin.x, s.tileY - ownOrigin.y);
        const activeMarch = activeMarchByUid.get(s.uid);
        return {
          settlement: s,
          distance,
          isClose: distance <= NEARBY_RADIUS_TILES,
          tier: getSettlementTier(s.bonfireLevel),
          status: getSettlementStatusMeta(s, activeMarch, nowMs),
        };
      })
      .sort((a, b) => a.distance - b.distance);
  }, [settlements, marches, session.uid, ownOrigin.x, ownOrigin.y]);

  const visibleNearbyPlayers = useMemo(
    () => (onlyCloseNeighbors ? nearbyPlayers.filter((p) => p.isClose) : nearbyPlayers),
    [nearbyPlayers, onlyCloseNeighbors]
  );

  const closeNeighborCount = useMemo(
    () => nearbyPlayers.filter((p) => p.isClose).length,
    [nearbyPlayers]
  );

  const handleVisit = (s: WorldSettlementDTO) => {
    if (onVisitSettlement) {
      onVisitSettlement({
        uid: s.uid,
        tribeName: s.tribeName,
        bonfireLevel: s.bonfireLevel,
        power: s.power,
        tileX: s.tileX,
        tileY: s.tileY,
      });
    } else {
      onJumpToTile?.(s.tileX, s.tileY);
    }
    setOpen(false);
  };

  const isCloudLive = !session.isGuest && session.cloudSynced;
  const isLive = session.wsConnected || isCloudLive;
  const authOfflineIssue = !session.isGuest && !isCloudLive;

  const statusColor = isCloudLive
    ? '#4ade80'
    : session.wsConnected
    ? '#fbbf24'
    : '#f87171';

  const statusLabel = isCloudLive
    ? 'Cloud'
    : session.wsConnected
    ? 'Online'
    : !session.isGuest
    ? 'Offline'
    : 'Lokal';

  const errorCount = logs.filter((l) => l.level === 'error').length;

  return (
    <>
      <button
        type="button"
        className="mp-hub-fab"
        aria-label="Multiplayer und Cloud-Speicherung öffnen"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}`,
            flexShrink: 0,
          }}
        />
        <span>{statusLabel}</span>
        <span className="mono" style={{ color: '#c9bfb2', fontSize: 11 }}>
          · {Math.max(1, onlinePlayers)}
        </span>
      </button>

      <aside
        className={`mp-hub-drawer${open ? ' open' : ''}`}
        aria-label="Multiplayer-Welt und Cloud-Sicherung"
      >
        <div className="mp-chat-head">
          <div>
            <span className="mp-chat-title">Welt &amp; Cloud-Speicher</span>
            <span className="mp-chat-online">
              {Math.max(1, onlinePlayers)} online · {settlements.length} Stämme
            </span>
          </div>
          <button
            type="button"
            className="close-btn"
            aria-label="Schließen"
            style={{ width: 28, height: 28 }}
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
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mp-hub-body">
          <div className="mp-account-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12.5, color: session.isGuest ? '#fde68a' : '#86efac' }}>
                {!session.isGuest
                  ? 'Google Cloud-Konto aktiv'
                  : session.wsConnected
                  ? 'Gast-Sitzung (Server-gesichert)'
                  : 'Lokaler Gast-Modus'}
              </strong>
              <span style={{ fontSize: 10.5, color: '#a8a29e' }}>
                {session.syncState === 'saving'
                  ? 'Speichert...'
                  : isLive
                  ? session.wsConnected
                    ? 'Verbunden'
                    : 'Cloud aktiv'
                  : !session.isGuest
                  ? 'Cloud offline'
                  : 'Kein Spielserver'}
              </span>
            </div>

            <div style={{ fontSize: 11.5, color: '#c9bfb2', lineHeight: 1.4 }}>
              {session.isGuest ? (
                session.wsConnected ? (
                  <>
                    Dein Dorf ist auf dem Spielserver gespeichert. Verknüpfe ein Google-Konto für
                    dauerhafte <strong>Cloud-Firestore-Sicherung</strong> über alle Geräte &amp; Unity.
                  </>
                ) : (
                  <>
                    Auf dieser statischen Seite läuft kein eigener Node-Server. Melde dich mit{' '}
                    <strong>Google</strong> an, um Cloud-Speicherung, Welt-Chat und andere Spieler
                    direkt über Firebase live zu verbinden.
                  </>
                )
              ) : (
                <>
                  Angemeldet als <strong>{session.email || session.displayName}</strong>.
                  <br />
                  Cloud-Stand: <span className="mono">{fmtSaveTime(session.lastCloudSaveAt)}</span>
                </>
              )}
            </div>

            {session.isGuest && session.lastServerSaveAt && (
              <div style={{ fontSize: 10.5, color: '#a8a29e' }}>
                Letzte Server-Sicherung:{' '}
                <span className="mono">{fmtSaveTime(session.lastServerSaveAt)}</span>
              </div>
            )}

            <form className="mp-tribe-row" onSubmit={handleSaveName}>
              <input
                className="mp-tribe-input"
                type="text"
                maxLength={28}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Stammesname"
              />
              <button
                type="submit"
                className="btn-secondary"
                style={{ minHeight: 36, padding: '0 12px', fontSize: 12 }}
              >
                Speichern
              </button>
            </form>

            {session.isGuest ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1, minHeight: 38, fontSize: 12 }}
                  disabled={busyAuth}
                  onClick={handleGoogleSignIn}
                >
                  {busyAuth ? 'Verbindet...' : 'Mit Google sichern'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 38, padding: '0 10px', fontSize: 11.5 }}
                  onClick={handleManualSave}
                >
                  Sync
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ flex: 1, minHeight: 36, fontSize: 12 }}
                  onClick={handleManualSave}
                >
                  Jetzt in Cloud sichern
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 36, padding: '0 12px', fontSize: 12 }}
                  disabled={busyAuth}
                  onClick={handleSignOut}
                >
                  Abmelden
                </button>
              </div>
            )}

            {feedback && (
              <div style={{ fontSize: 11, color: '#86efac', lineHeight: 1.35 }}>{feedback}</div>
            )}
          </div>

          {/* Verbindungs-Status-Indikator & Diagnose */}
          <div className="mp-diag-box">
            <div className="mp-diag-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className="mp-diag-dot"
                  style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
                />
                <span className="mp-diag-title">Verbindungs-Status</span>
              </div>
              <button
                type="button"
                className="mp-diag-btn"
                disabled={busyProbe}
                onClick={handleRunProbe}
              >
                {busyProbe ? 'Teste…' : 'Verbindung testen'}
              </button>
            </div>

            <div className="mp-diag-grid">
              <div className="mp-diag-row">
                <span className="mp-diag-label">
                  <span
                    className="mp-diag-dot"
                    style={{ background: healthColor(diagnostics.authStatus) }}
                  />
                  Firebase Auth
                </span>
                <span className="mp-diag-val mono" title={diagnostics.authDetail}>
                  {healthLabel(diagnostics.authStatus)} · {diagnostics.authDetail}
                </span>
              </div>

              <div className="mp-diag-row">
                <span className="mp-diag-label">
                  <span
                    className="mp-diag-dot"
                    style={{ background: healthColor(diagnostics.firestoreStatus) }}
                  />
                  Cloud Firestore
                </span>
                <span className="mp-diag-val mono" title={diagnostics.firestoreDetail}>
                  {healthLabel(diagnostics.firestoreStatus)} · {diagnostics.firestoreDetail}
                </span>
              </div>

              <div className="mp-diag-listeners">
                <span className="mp-diag-chip">
                  <span
                    className="mp-diag-dot"
                    style={{ background: healthColor(diagnostics.firestoreListeners.settlements) }}
                  />
                  Dörfer
                </span>
                <span className="mp-diag-chip">
                  <span
                    className="mp-diag-dot"
                    style={{ background: healthColor(diagnostics.firestoreListeners.marches) }}
                  />
                  Märsche
                </span>
                <span className="mp-diag-chip">
                  <span
                    className="mp-diag-dot"
                    style={{ background: healthColor(diagnostics.firestoreListeners.chat) }}
                  />
                  Chat
                </span>
                <span className="mp-diag-chip mono" title={`DB: ${diagnostics.firestoreDatabaseId}`}>
                  Sync: {session.cloudSynced ? 'Ja' : 'Nein'}
                </span>
              </div>

              <div className="mp-diag-row">
                <span className="mp-diag-label">
                  <span
                    className="mp-diag-dot"
                    style={{ background: healthColor(diagnostics.apiStatus) }}
                  />
                  Node API / WS
                </span>
                <span className="mp-diag-val mono" title={`${diagnostics.apiDetail} | ${diagnostics.wsDetail}`}>
                  API: {healthLabel(diagnostics.apiStatus)} · WS: {healthLabel(diagnostics.wsStatus)}
                  {diagnostics.wsCloseCode ? ` (${diagnostics.wsCloseCode})` : ''}
                </span>
              </div>

              <div className="mp-diag-row">
                <span className="mp-diag-label">
                  <span
                    className="mp-diag-dot"
                    style={{ background: diagnostics.browserOnline ? '#4ade80' : '#f87171' }}
                  />
                  Netzwerk / Host
                </span>
                <span className="mp-diag-val mono">
                  {diagnostics.browserOnline ? 'Online' : 'Offline'} · {diagnostics.hostname}
                </span>
              </div>
            </div>

            {diagnostics.rootCauseHint && (
              <div className={`mp-diag-hint${authOfflineIssue || errorCount > 0 ? ' is-error' : ''}`}>
                <strong>Diagnose:</strong> {diagnostics.rootCauseHint}
              </div>
            )}

            {/* Detaillierte Log-Anzeige */}
            <div className="mp-log-section">
              <div className="mp-log-bar">
                <button
                  type="button"
                  className="mp-log-toggle"
                  onClick={() => setLogsExpanded((v) => !v)}
                >
                  <span>{logsExpanded ? '▾' : '▸'} Diagnose-Log ({logs.length})</span>
                  {errorCount > 0 && (
                    <span className="mp-log-err-count">{errorCount} Fehler</span>
                  )}
                </button>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="mp-diag-btn" onClick={handleCopyLogs}>
                    {copyNotice || 'Kopieren'}
                  </button>
                  <button type="button" className="mp-diag-btn" onClick={clearLogs}>
                    Leeren
                  </button>
                </div>
              </div>

              {logsExpanded && (
                <div className="mp-log-list mono" ref={logListRef}>
                  {logs.length === 0 ? (
                    <div className="mp-log-empty">Noch keine Verbindungs-Logs aufgezeichnet.</div>
                  ) : (
                    logs.map((entry) => (
                      <div key={entry.id} className={`mp-log-entry level-${entry.level}`}>
                        <div className="mp-log-line">
                          <span className="mp-log-ts">{fmtLogTime(entry.ts)}</span>
                          <span
                            className="mp-log-src"
                            style={{ color: logLevelColor(entry.level) }}
                          >
                            [{entry.source}]
                          </span>
                          <span className="mp-log-msg">{entry.message}</span>
                        </div>
                        {entry.detail && <div className="mp-log-detail">{entry.detail}</div>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Spieler in der Nähe (nach Distanz sortiert inkl. Siedlungsstatus & Besuchen-Button) */}
          <div className="mp-nearby-wrap">
            <div className="mp-world-list-head">
              <span>
                Spieler in der Nähe ({visibleNearbyPlayers.length}
                {onlyCloseNeighbors ? `/${nearbyPlayers.length}` : ''})
              </span>
              <button
                type="button"
                className={`mp-diag-btn${onlyCloseNeighbors ? ' is-active' : ''}`}
                onClick={() => setOnlyCloseNeighbors((v) => !v)}
              >
                {onlyCloseNeighbors
                  ? `≤${NEARBY_RADIUS_TILES} Felder (${closeNeighborCount})`
                  : `Alle · ≤${NEARBY_RADIUS_TILES}: ${closeNeighborCount}`}
              </button>
            </div>

            {visibleNearbyPlayers.length === 0 ? (
              <div className="mp-nearby-empty">
                {nearbyPlayers.length > 0 ? (
                  <>
                    Keine Spieler im {NEARBY_RADIUS_TILES}-Felder-Umkreis. Schalte auf{' '}
                    <strong>Alle</strong> um, um {nearbyPlayers.length} weiter entfernte Stämme zu
                    sehen.
                  </>
                ) : isLive ? (
                  <>
                    Aktuell befinden sich noch keine anderen Spieler auf der Weltkarte. Sobald ein
                    weiterer Stamm beitritt, erscheint er hier nach Entfernung sortiert.
                  </>
                ) : (
                  <>
                    Melde dich oben mit <strong>Google</strong> an, um benachbarte Spieler aus der
                    Cloud-Weltkarte live zu sehen und zu besuchen.
                  </>
                )}
              </div>
            ) : (
              <div className="mp-nearby-list">
                {visibleNearbyPlayers.slice(0, 15).map(({ settlement: s, distance, isClose, tier, status }) => (
                  <div key={s.uid} className={`mp-nearby-card${isClose ? ' is-close' : ''}`}>
                    <div className="mp-nearby-info">
                      <div className="mp-nearby-top">
                        <span className="mp-world-row-name">{s.tribeName}</span>
                        <span
                          className="mp-status-badge"
                          style={{ color: status.color, background: status.bg }}
                        >
                          <span
                            className="mp-diag-dot"
                            style={{ background: status.color, width: 6, height: 6 }}
                          />
                          {status.label}
                        </span>
                      </div>
                      <div className="mp-nearby-meta mono">
                        <span>{tier} (St.{s.bonfireLevel})</span>
                        <span>·</span>
                        <span>Macht {s.power}</span>
                      </div>
                      <div className="mp-nearby-dist mono">
                        {distance < 1 ? '< 1 Feld' : `${distance.toFixed(1)} Felder`}
                        {isClose ? ' · Nachbar' : ''} · Grid [{s.tileX},{s.tileY}]
                      </div>
                    </div>
                    <button
                      type="button"
                      className="mp-visit-btn"
                      aria-label={`${s.tribeName} besuchen`}
                      onClick={() => handleVisit(s)}
                    >
                      Besuchen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mp-world-list-wrap">
            <div className="mp-world-list-head">
              <span>Alle Stämme auf der Weltkarte ({sortedSettlements.length})</span>
              <span className="mono" style={{ color: '#fbbf24' }}>
                {marches.length} Märsche aktiv
              </span>
            </div>

            {sortedSettlements.length === 0 ? (
              <div style={{ fontSize: 12, color: '#a8a29e', padding: '10px 4px' }}>
                Siedlung wird auf der Weltkarte registriert...
              </div>
            ) : (
              <div className="mp-world-list">
                {sortedSettlements.slice(0, 25).map((s) => {
                  const isOwn = s.uid === session.uid;
                  return (
                    <button
                      key={s.uid}
                      type="button"
                      className={`mp-world-row${isOwn ? ' is-own' : ''}`}
                      onClick={() => {
                        onJumpToTile?.(s.tileX, s.tileY);
                        setOpen(false);
                      }}
                    >
                      <div style={{ textAlign: 'left', minWidth: 0 }}>
                        <div className="mp-world-row-name">
                          {s.tribeName} {isOwn && <span style={{ color: '#86efac' }}>(Du)</span>}
                        </div>
                        <div className="mp-world-row-sub mono">
                          Feuer St.{s.bonfireLevel} · Macht {s.power} · Grid [{s.tileX},{s.tileY}]
                        </div>
                      </div>
                      <span className="mp-world-jump">Karte →</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
