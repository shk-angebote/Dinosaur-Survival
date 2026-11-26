import React, { useEffect, useState } from 'react';
import { useMultiplayer } from '../hooks/useMultiplayer';
import bridge from '../multiplayerBridge';

interface MultiplayerHubDrawerProps {
  onJumpToTile?: (tileX: number, tileY: number) => void;
  onForceSave?: () => void;
}

function fmtSaveTime(ts: number | null): string {
  if (!ts) return 'Noch nicht synchronisiert';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`;
}

export const MultiplayerHubDrawer: React.FC<MultiplayerHubDrawerProps> = ({
  onJumpToTile,
  onForceSave,
}) => {
  const { session, settlements, marches, onlinePlayers, signInWithGoogle, signOut, setTribeName } =
    useMultiplayer();
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState(session.tribeName);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyAuth, setBusyAuth] = useState(false);

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
      setFeedback('Anmeldung abgebrochen oder Popup blockiert.');
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

  const sortedSettlements = [...settlements].sort(
    (a, b) => b.bonfireLevel - a.bonfireLevel || b.power - a.power
  );

  const isCloudLive = !session.isGuest && session.cloudSynced;
  const isLive = session.wsConnected || isCloudLive;

  const statusColor = isCloudLive
    ? '#4ade80'
    : session.wsConnected
    ? '#fbbf24'
    : '#f87171';

  const statusLabel = isCloudLive
    ? 'Cloud'
    : session.wsConnected
    ? 'Online'
    : 'Lokal';

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

          <div className="mp-world-list-wrap">
            <div className="mp-world-list-head">
              <span>Stämme auf der Weltkarte ({sortedSettlements.length})</span>
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
