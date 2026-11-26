import React, { useEffect, useRef } from 'react';
import { GAME_SHELL_HTML } from '../game/gameShellMarkup';
import { initGameRuntime, type GameRuntimeSnapshot } from '../game/gameRuntime';

interface GameShellProps {
  onSnapshot?: (snapshot: GameRuntimeSnapshot) => void;
}

/**
 * Bindet die bestehende, vollständige Spieloberfläche (3D-Dorf, Weltkarte, Bestiarium,
 * Marschwarteschlangen, Helden & Kampf-Animationen) sauber in den React-Lebenszyklus ein.
 * Memoized mit eigenem ref-Container, damit React-Re-Renders das aktive 3D-Canvas und
 * DOM-Bindings niemals zurücksetzen.
 */
export const GameShell: React.FC<GameShellProps> = React.memo(({ onSnapshot }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!el.dataset.shellMounted) {
      el.innerHTML = GAME_SHELL_HTML;
      el.dataset.shellMounted = '1';
    }

    initGameRuntime({
      onSnapshot: (snap) => {
        onSnapshotRef.current?.(snap);
      },
    });
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
});

GameShell.displayName = 'GameShell';
