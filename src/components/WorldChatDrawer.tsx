import React, { useEffect, useRef, useState } from 'react';
import { useMultiplayer } from '../hooks/useMultiplayer';

interface WorldChatDrawerProps {
  bonfireLevel: number;
}

export const WorldChatDrawer: React.FC<WorldChatDrawerProps> = ({ bonfireLevel }) => {
  const { session, chat, onlinePlayers, sendChat } = useMultiplayer();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const lastSeenIdRef = useRef<string | null>(null);
  const initializedCountRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const newest = chat.length > 0 ? chat[chat.length - 1] : null;
    if (!newest) return;

    if (!initializedCountRef.current) {
      initializedCountRef.current = true;
      lastSeenIdRef.current = newest.messageId;
      return;
    }

    if (open) {
      lastSeenIdRef.current = newest.messageId;
      setUnreadCount(0);
    } else if (newest.messageId !== lastSeenIdRef.current) {
      setUnreadCount((prev) => prev + 1);
      lastSeenIdRef.current = newest.messageId;
    }
  }, [chat, open]);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, chat.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
        if (chat.length > 0) {
          lastSeenIdRef.current = chat[chat.length - 1].messageId;
        }
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    setDraft('');
    setErrorText(null);
    const res = await sendChat(clean, bonfireLevel);
    if (!res.ok) {
      setErrorText(res.error || 'Nachricht konnte nicht gesendet werden.');
    }
  };

  const onlineCount = Math.max(1, onlinePlayers || 1);

  return (
    <>
      <button
        type="button"
        className="mp-chat-fab"
        aria-label="Welt-Chat öffnen"
        onClick={handleToggle}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>Welt-Chat</span>
        {!open && unreadCount > 0 && (
          <span className="mp-chat-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      <aside
        className={`mp-chat-drawer${open ? ' open' : ''}`}
        aria-label="Gemeinsamer Welt-Chat"
      >
        <div className="mp-chat-head">
          <div>
            <span className="mp-chat-title">Welt-Chat</span>
            <span className="mp-chat-online">
              {onlineCount} {onlineCount === 1 ? 'Stamm' : 'Stämme'} online
            </span>
          </div>
          <button
            type="button"
            className="close-btn"
            aria-label="Welt-Chat schließen"
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

        <div className="mp-chat-list" ref={listRef}>
          {chat.length === 0 ? (
            <div style={{ fontSize: 12, color: '#a8a29e', textAlign: 'center', marginTop: 24 }}>
              Noch keine Nachrichten im Welt-Chat.
            </div>
          ) : (
            chat.map((m) => {
              const isMine = session.uid === m.uid;
              const dt = new Date(m.createdAt || Date.now());
              const timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(
                dt.getMinutes()
              ).padStart(2, '0')}`;
              return (
                <div key={m.messageId} className={`mp-chat-msg${isMine ? ' is-mine' : ''}`}>
                  <div className="mp-chat-msg-meta">
                    <span className="mp-chat-sender">
                      {m.tribeName || 'Stamm'}{' '}
                      <span className="mp-chat-lvl">· Feuer St.{m.bonfireLevel || 1}</span>
                    </span>
                    <span className="mp-chat-lvl mono">{timeStr}</span>
                  </div>
                  <div>{m.text}</div>
                </div>
              );
            })
          )}
        </div>

        {errorText && (
          <div style={{ padding: '4px 10px', fontSize: 11, color: '#fca5a5' }}>{errorText}</div>
        )}

        <form className="mp-chat-form" onSubmit={handleSubmit} autoComplete="off">
          <input
            className="mp-chat-input"
            type="text"
            maxLength={240}
            placeholder="Nachricht an alle Stämme..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="mp-chat-send" type="submit">
            Senden
          </button>
        </form>
      </aside>
    </>
  );
};
