import type { User } from 'firebase/auth';
import type {
  BuildValidationRequest,
  BuildValidationResponse,
  DinoHuntCombatRequest,
  DinoHuntCombatResponse,
  RealtimeEvent,
  ResourceKey,
  TeleportResponse,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
  WorldTradeDTO,
} from './shared/apiTypes';
import {
  cancelTradeInFirestore,
  completeMarchInFirestore,
  confirmTradeInFirestore,
  createTradeInFirestore,
  FIREBASE_DIAGNOSTIC_CONFIG,
  getFirebaseIdToken,
  loadCloudSave,
  probeFirestoreConnection,
  publishChatToFirestore,
  publishMarchToFirestore,
  sanitizeId,
  sanitizeTribeName,
  saveCloudState,
  signInWithGooglePopup,
  signOutFirebase,
  subscribeAuth,
  subscribeFirestoreWorld,
  syncPublicProfileAndSettlement,
} from './services/firebaseClient';
import {
  fetchServerPlayerSave,
  fetchWorldState,
  GameRealtimeSocket,
  postAuthGuest,
  postChatMessage,
  postDinoHuntCombat,
  postMarch,
  postMigrateGuest,
  postProposeTrade,
  postRespondTrade,
  postServerPlayerSave,
  postSettlement,
  postValidateBuild,
  type SocketDebugEvent,
} from './services/gameApiClient';

const GUEST_UID_KEY = 'glut_basalt_guest_uid_v1';
const TRIBE_NAME_KEY = 'glut_basalt_tribe_name_v1';
const SETTLED_TRADES_KEY = 'glut_basalt_settled_trades_v1';

export type SyncState = 'connecting' | 'synced' | 'saving' | 'offline';
export type ChannelHealth = 'idle' | 'connecting' | 'ok' | 'degraded' | 'error' | 'offline';
export type DiagnosticLogLevel = 'info' | 'success' | 'warn' | 'error';
export type DiagnosticLogSource = 'Auth' | 'Firestore' | 'WebSocket' | 'API' | 'Sync' | 'Netzwerk';

export interface DiagnosticLogEntry {
  id: string;
  ts: number;
  level: DiagnosticLogLevel;
  source: DiagnosticLogSource;
  message: string;
  detail?: string;
}

export interface ConnectionDiagnostics {
  browserOnline: boolean;
  hostname: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  authStatus: ChannelHealth;
  authDetail: string;
  firestoreStatus: ChannelHealth;
  firestoreDetail: string;
  firestoreListeners: {
    settlements: ChannelHealth;
    marches: ChannelHealth;
    chat: ChannelHealth;
    trades: ChannelHealth;
  };
  apiStatus: ChannelHealth;
  apiDetail: string;
  wsStatus: ChannelHealth;
  wsDetail: string;
  wsCloseCode: number | null;
  wsAttempts: number;
  lastError: string | null;
  rootCauseHint: string | null;
}

export interface PlayerSession {
  uid: string;
  isGuest: boolean;
  email: string | null;
  displayName: string | null;
  tribeName: string;
  wsConnected: boolean;
  serverAuthenticated: boolean;
  cloudSynced: boolean;
  syncState: SyncState;
  lastServerSaveAt: number | null;
  lastCloudSaveAt: number | null;
  onlinePlayers: number;
  serverOffsetMs: number;
}

export interface BridgeCallbacks {
  onSessionChange?: (session: PlayerSession) => void;
  onWorldUpdate?: (data: {
    settlements: WorldSettlementDTO[];
    marches: WorldMarchDTO[];
    onlinePlayers: number;
  }) => void;
  onChatUpdate?: (messages: WorldChatMessageDTO[]) => void;
  onTradeCompleted?: (trade: WorldTradeDTO, myUid: string) => void;
  onCloudStateLoaded?: (cloudState: Record<string, unknown>, tribeName: string) => void;
  getCurrentLocalState?: () => Record<string, unknown> | null;
  getCurrentSettlementMeta?: () => {
    bonfireLevel: number;
    power: number;
    tileX: number;
    tileY: number;
  } | null;
}

function loadSettledTradeIds(): string[] {
  try {
    const raw = localStorage.getItem(SETTLED_TRADES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(-200) : [];
  } catch {
    return [];
  }
}

function saveSettledTradeIds(ids: Set<string>): void {
  try {
    localStorage.setItem(SETTLED_TRADES_KEY, JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    // ignore storage quota errors
  }
}

function getOrCreateGuestUid(): string {
  try {
    const existing = localStorage.getItem(GUEST_UID_KEY);
    if (existing && /^guest_[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
    const created = `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(GUEST_UID_KEY, created);
    return created;
  } catch {
    return `guest_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getOrCreateTribeName(): string {
  try {
    const existing = localStorage.getItem(TRIBE_NAME_KEY);
    if (existing && existing.trim().length >= 2) return sanitizeTribeName(existing);
    const num = Math.floor(100 + Math.random() * 899);
    const fallback = `Glutstamm ${num}`;
    localStorage.setItem(TRIBE_NAME_KEY, fallback);
    return fallback;
  } catch {
    return 'Glutstamm';
  }
}

class DinoMultiplayerBridge {
  private callbacks: BridgeCallbacks = {};
  private firebaseUser: User | null = null;
  private guestUid: string = getOrCreateGuestUid();
  // Signiertes Gast-Token bleibt ausschließlich im Arbeitsspeicher (niemals in localStorage)
  private guestBearerToken: string | null = null;
  private guestTokenPromise: Promise<string | null> | null = null;

  private tribeName: string = getOrCreateTribeName();
  private serverAvailable = false;
  private wsConnected = false;
  private cloudSynced = false;
  private syncState: SyncState = 'connecting';
  private lastServerSaveAt: number | null = null;
  private lastCloudSaveAt: number | null = null;
  private onlinePlayers = 1;
  private serverOffsetMs = 0;

  private settlementsMap = new Map<string, WorldSettlementDTO>();
  private marchesMap = new Map<string, WorldMarchDTO>();
  private chatMap = new Map<string, WorldChatMessageDTO>();
  private tradesMap = new Map<string, WorldTradeDTO>();
  private settledTradeIds = new Set<string>(loadSettledTradeIds());

  private socket: GameRealtimeSocket | null = null;
  private unsubAuth: (() => void) | null = null;
  private unsubFirestoreWorld: (() => void) | null = null;
  private saveTimer: number | null = null;
  private initialized = false;
  private listeners = new Set<() => void>();

  private logSeq = 0;
  private logs: DiagnosticLogEntry[] = [];
  private diagnostics: ConnectionDiagnostics = {
    browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    hostname: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
    firebaseProjectId: FIREBASE_DIAGNOSTIC_CONFIG.projectId,
    firestoreDatabaseId: FIREBASE_DIAGNOSTIC_CONFIG.firestoreDatabaseId,
    authStatus: 'connecting',
    authDetail: 'Warte auf Firebase Auth...',
    firestoreStatus: 'idle',
    firestoreDetail: 'Noch nicht verbunden',
    firestoreListeners: {
      settlements: 'idle',
      marches: 'idle',
      chat: 'idle',
      trades: 'idle',
    },
    apiStatus: 'connecting',
    apiDetail: 'Prüfe /api/v1/world/state...',
    wsStatus: 'idle',
    wsDetail: 'Warte auf Backend-Check',
    wsCloseCode: null,
    wsAttempts: 0,
    lastError: null,
    rootCauseHint: null,
  };

  private formatErrorDetail(err: unknown): string {
    if (err instanceof Error) {
      const msg = err.message || String(err);
      try {
        const parsed = JSON.parse(msg) as {
          error?: string;
          operationType?: string;
          path?: string;
          authInfo?: { userId?: string | null; email?: string | null };
        };
        if (parsed && typeof parsed === 'object' && parsed.error) {
          const op = parsed.operationType ? `${parsed.operationType.toUpperCase()} ` : '';
          const path = parsed.path ? `${parsed.path} — ` : '';
          const uid = parsed.authInfo?.userId ? ` (uid: ${parsed.authInfo.userId.slice(0, 8)}…)` : ' (kein Auth-User)';
          return `${op}${path}${parsed.error}${uid}`;
        }
      } catch {
        // plain error message
      }
      return msg;
    }
    return String(err);
  }

  private pushLog(
    level: DiagnosticLogLevel,
    source: DiagnosticLogSource,
    message: string,
    detail?: string
  ): void {
    this.logSeq += 1;
    const entry: DiagnosticLogEntry = {
      id: `log_${this.logSeq}`,
      ts: Date.now(),
      level,
      source,
      message,
      detail: detail ? detail.slice(0, 420) : undefined,
    };
    this.logs = [...this.logs.slice(-79), entry];
    if (level === 'error') {
      this.diagnostics.lastError = `[${source}] ${message}${detail ? `: ${detail.slice(0, 180)}` : ''}`;
    }
    this.refreshRootCauseHint();
    this.notifyListeners();
  }

  private refreshRootCauseHint(): void {
    const d = this.diagnostics;
    if (!d.browserOnline) {
      d.rootCauseHint = 'Browser meldet keine Internetverbindung (navigator.onLine = false).';
      return;
    }
    if (this.firebaseUser && !this.cloudSynced) {
      if (d.firestoreStatus === 'error') {
        d.rootCauseHint = `Authentifiziert als ${this.firebaseUser.email || this.firebaseUser.uid.slice(0, 8)}, aber Cloud Firestore schlägt fehl: ${d.firestoreDetail}`;
      } else if (
        d.firestoreListeners.settlements === 'error' ||
        d.firestoreListeners.marches === 'error' ||
        d.firestoreListeners.chat === 'error' ||
        d.firestoreListeners.trades === 'error'
      ) {
        d.rootCauseHint = `Authentifiziert, aber ein Firestore-Echtzeit-Listener wurde blockiert (${d.lastError || 'Details im Log'}).`;
      } else if (d.firestoreStatus === 'offline') {
        d.rootCauseHint = 'Authentifiziert, aber der Firestore-Client ist offline (Adblocker, Firewall oder ungültige DB-ID blockiert firestore.googleapis.com).';
      } else {
        d.rootCauseHint = 'Authentifiziert, warte auf erste Server-Antwort von Cloud Firestore (Synchronisation noch ausstehend).';
      }
      return;
    }
    if (!this.firebaseUser && !this.wsConnected) {
      d.rootCauseHint =
        d.apiStatus === 'offline' || d.apiStatus === 'error'
          ? `Kein Node.js-Spielserver auf "${d.hostname}" erreichbar (statisches Hosting) und nicht mit Google angemeldet.`
          : 'WebSocket-Verbindung zum Spielserver unterbrochen und nicht mit Google angemeldet.';
      return;
    }
    if (this.firebaseUser && this.cloudSynced && !this.wsConnected) {
      d.rootCauseHint = `Live über Cloud Firestore verbunden (statisches Hosting ohne Node-WebSocket auf "${d.hostname}").`;
      return;
    }
    d.rootCauseHint = null;
  }

  getDiagnostics(): ConnectionDiagnostics {
    return {
      ...this.diagnostics,
      firestoreListeners: { ...this.diagnostics.firestoreListeners },
    };
  }

  getLogs(): DiagnosticLogEntry[] {
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];
    this.notifyListeners();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore listener errors
      }
    });
  }

  getSession(): PlayerSession {
    return {
      uid: this.firebaseUser ? this.firebaseUser.uid : this.guestUid,
      isGuest: !this.firebaseUser,
      email: this.firebaseUser?.email ?? null,
      displayName: this.firebaseUser?.displayName ?? null,
      tribeName: this.tribeName,
      wsConnected: this.wsConnected,
      serverAuthenticated: Boolean(this.firebaseUser || this.guestBearerToken),
      cloudSynced: this.cloudSynced,
      syncState: this.syncState,
      lastServerSaveAt: this.lastServerSaveAt,
      lastCloudSaveAt: this.lastCloudSaveAt,
      onlinePlayers: this.onlinePlayers,
      serverOffsetMs: this.serverOffsetMs,
    };
  }

  getWorldData(): {
    settlements: WorldSettlementDTO[];
    marches: WorldMarchDTO[];
    chat: WorldChatMessageDTO[];
    trades: WorldTradeDTO[];
    onlinePlayers: number;
  } {
    const now = Date.now() + this.serverOffsetMs;
    const myUid = this.getSession().uid;
    const marches = Array.from(this.marchesMap.values()).filter(
      (m) => m.status === 'active' && m.endsAt + 8000 >= now
    );
    const chat = Array.from(this.chatMap.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-60);
    const trades = Array.from(this.tradesMap.values())
      .filter((t) => t.fromUid === myUid || t.toUid === myUid)
      .sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      })
      .slice(0, 30);
    return {
      settlements: Array.from(this.settlementsMap.values()),
      marches,
      chat,
      trades,
      onlinePlayers: this.onlinePlayers,
    };
  }

  private upsertTradeAndCheckSettlement(trade: WorldTradeDTO): void {
    const prev = this.tradesMap.get(trade.tradeId);
    if (
      !prev ||
      trade.updatedAt >= prev.updatedAt ||
      (prev.status === 'pending' && trade.status !== 'pending')
    ) {
      this.tradesMap.set(trade.tradeId, trade);
    }
    const latest = this.tradesMap.get(trade.tradeId);
    if (latest) {
      this.trySettleCompletedTrade(latest);
    }
  }

  private trySettleCompletedTrade(trade: WorldTradeDTO): void {
    if (trade.status !== 'completed' || !trade.fromConfirmed || !trade.toConfirmed) return;
    if (!this.callbacks.onTradeCompleted) return;
    const myUid = this.getSession().uid;
    if (trade.fromUid !== myUid && trade.toUid !== myUid) return;
    if (this.settledTradeIds.has(trade.tradeId)) return;

    this.settledTradeIds.add(trade.tradeId);
    saveSettledTradeIds(this.settledTradeIds);
    try {
      this.callbacks.onTradeCompleted(trade, myUid);
    } catch (err) {
      console.error('[Trade Settlement Error]', err);
    }
  }

  private sweepPendingSettlements(): void {
    this.tradesMap.forEach((trade) => {
      this.trySettleCompletedTrade(trade);
    });
  }

  private async ensureGuestToken(): Promise<string | null> {
    if (this.guestBearerToken) return this.guestBearerToken;
    if (this.guestTokenPromise) return this.guestTokenPromise;

    this.guestTokenPromise = (async () => {
      try {
        const res = await postAuthGuest(this.guestUid);
        if (res.ok && res.token && res.uid) {
          this.guestUid = res.uid;
          this.guestBearerToken = res.token;
          try {
            localStorage.setItem(GUEST_UID_KEY, res.uid);
          } catch {
            // ignore
          }
          this.emitSession();
          return res.token;
        }
      } catch {
        // Server offline — fallback gracefully
      } finally {
        this.guestTokenPromise = null;
      }
      return null;
    })();
    return this.guestTokenPromise;
  }

  private async getActiveBearerToken(forceRefreshFirebase = false): Promise<string | null> {
    if (this.firebaseUser) {
      const fbToken = await getFirebaseIdToken(forceRefreshFirebase);
      if (fbToken) return fbToken;
    }
    return this.ensureGuestToken();
  }

  init(callbacks: BridgeCallbacks): void {
    this.callbacks = callbacks;
    queueMicrotask(() => this.sweepPendingSettlements());
    if (this.initialized) {
      this.emitSession();
      this.emitWorld();
      this.emitChat();
      return;
    }
    this.initialized = true;
    this.pushLog(
      'info',
      'Netzwerk',
      `Multiplayer-Bridge gestartet (${this.diagnostics.hostname})`,
      `Projekt: ${FIREBASE_DIAGNOSTIC_CONFIG.projectId} · DB: ${FIREBASE_DIAGNOSTIC_CONFIG.firestoreDatabaseId}`
    );

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.diagnostics.browserOnline = true;
        this.pushLog('success', 'Netzwerk', 'Browser-Netzwerk wieder online');
        void this.runConnectionDiagnostics();
      });
      window.addEventListener('offline', () => {
        this.diagnostics.browserOnline = false;
        this.pushLog('warn', 'Netzwerk', 'Browser meldet Offline-Status (navigator.onLine = false)');
      });
    }

    // 1. Mit Node.js Spielserver verbinden (signierte Gast-Session + dauerhafter Weltzustand + WebSocket)
    this.socket = new GameRealtimeSocket(
      (ev) => this.handleRealtimeEvent(ev),
      (connected) => {
        this.wsConnected = connected;
        this.syncState = connected || this.isCloudLive() ? 'synced' : 'offline';
        this.emitSession();
        if (connected) {
          void this.pushCurrentSettlement(true);
        }
      },
      (dbg: SocketDebugEvent) => {
        this.diagnostics.wsAttempts = dbg.attempt;
        if (dbg.phase === 'connecting') {
          this.diagnostics.wsStatus = 'connecting';
          this.diagnostics.wsDetail = `Verbinde mit ${dbg.url} (Versuch ${dbg.attempt + 1})`;
          this.pushLog('info', 'WebSocket', 'Verbindungsaufbau gestartet', dbg.url);
        } else if (dbg.phase === 'open') {
          this.diagnostics.wsStatus = 'ok';
          this.diagnostics.wsCloseCode = null;
          this.diagnostics.wsDetail = `Verbunden (${dbg.url})`;
          this.pushLog('success', 'WebSocket', 'Echtzeit-WebSocket verbunden', dbg.url);
        } else if (dbg.phase === 'close') {
          this.diagnostics.wsStatus = 'offline';
          this.diagnostics.wsCloseCode = dbg.code ?? null;
          this.diagnostics.wsDetail = `Geschlossen (Code ${dbg.code ?? '?'}${dbg.reason ? `: ${dbg.reason}` : ''})`;
          this.pushLog('warn', 'WebSocket', `Verbindung geschlossen (Code ${dbg.code ?? '?'})`, dbg.reason || dbg.url);
        } else if (dbg.phase === 'error') {
          this.diagnostics.wsStatus = 'error';
          this.diagnostics.wsDetail = `Socket-Fehler (${dbg.url})`;
          this.pushLog('error', 'WebSocket', 'WebSocket-Verbindungsfehler', dbg.url);
        }
      }
    );
    void this.bootstrapServerState();

    // 2. Firebase Authentication abonnieren (Google-Konto + Cloud Firestore Persistenz)
    this.unsubAuth = subscribeAuth((user) => {
      void this.handleAuthChanged(user);
    });

    this.emitSession();
  }

  private isCloudLive(): boolean {
    return Boolean(this.firebaseUser && this.cloudSynced);
  }

  private async bootstrapServerState(): Promise<void> {
    this.diagnostics.apiStatus = 'connecting';
    this.diagnostics.apiDetail = 'Frage /api/v1/world/state ab...';
    this.notifyListeners();
    try {
      const [world, guestToken] = await Promise.all([
        fetchWorldState(),
        this.firebaseUser ? Promise.resolve(null) : this.ensureGuestToken(),
      ]);
      this.serverAvailable = true;
      this.diagnostics.apiStatus = 'ok';
      this.diagnostics.apiDetail = `API erreichbar (${world.settlements?.length || 0} Stämme)`;
      this.pushLog(
        'success',
        'API',
        'Node.js-Spielserver erreichbar',
        `${world.settlements?.length || 0} Stämme · ${world.onlinePlayers || 1} online`
      );
      // WebSocket nur verbinden, wenn ein aktiver Spielserver antwortet (verhindert Konsolenfehler auf statischem GitHub Pages)
      this.socket?.connect();
      this.serverOffsetMs = world.serverTimeMs - Date.now();
      this.onlinePlayers = Math.max(1, world.onlinePlayers || 1);
      for (const s of world.settlements || []) {
        this.settlementsMap.set(s.uid, s);
      }
      for (const m of world.marches || []) {
        this.marchesMap.set(m.marchId, m);
      }
      for (const c of world.chat || []) {
        this.chatMap.set(c.messageId, c);
      }
      for (const t of world.trades || []) {
        this.upsertTradeAndCheckSettlement(t);
      }
      this.syncState = 'synced';
      this.emitSession();
      this.emitWorld();
      this.emitChat();

      // Wenn Gast-Spieler einen neueren Server-Spielstand hat (z. B. nach Browser-Reset), wiederherstellen
      if (!this.firebaseUser && guestToken) {
        try {
          const srvSave = await fetchServerPlayerSave(guestToken);
          const localState = this.callbacks.getCurrentLocalState?.();
          const localLastTick = Number((localState as { lastTick?: number } | null)?.lastTick || 0);
          if (
            srvSave.ok &&
            srvSave.save &&
            srvSave.save.state &&
            srvSave.save.updatedAt > localLastTick + 5000
          ) {
            this.tribeName = sanitizeTribeName(srvSave.save.tribeName, this.tribeName);
            this.lastServerSaveAt = srvSave.save.updatedAt;
            this.callbacks.onCloudStateLoaded?.(srvSave.save.state, this.tribeName);
          } else if (localState) {
            await this.persistToServer(localState, guestToken);
          }
        } catch {
          // ignore non-fatal guest save check
        }
      }

      await this.pushCurrentSettlement(true);
    } catch (err) {
      this.serverAvailable = false;
      const errMsg = this.formatErrorDetail(err);
      this.diagnostics.apiStatus = 'offline';
      this.diagnostics.apiDetail = 'Kein Node-Backend erreichbar (statisches Hosting / 404)';
      this.diagnostics.wsStatus = 'offline';
      this.diagnostics.wsDetail = 'Übersprungen (kein Backend-Server)';
      this.pushLog(
        'warn',
        'API',
        'Backend /api/v1/world/state nicht erreichbar — wechsle auf Cloud-Firestore/Lokal',
        errMsg
      );
      if (!this.isCloudLive()) {
        this.syncState = 'offline';
        this.emitSession();
      }
    }
  }

  private handleRealtimeEvent(ev: RealtimeEvent): void {
    if (ev.type === 'world:init') {
      const w = ev.payload;
      this.serverOffsetMs = w.serverTimeMs - Date.now();
      this.onlinePlayers = Math.max(1, w.onlinePlayers || 1);
      for (const s of w.settlements || []) {
        this.settlementsMap.set(s.uid, s);
      }
      for (const m of w.marches || []) {
        this.marchesMap.set(m.marchId, m);
      }
      for (const c of w.chat || []) {
        this.chatMap.set(c.messageId, c);
      }
      for (const t of w.trades || []) {
        this.upsertTradeAndCheckSettlement(t);
      }
      this.emitSession();
      this.emitWorld();
      this.emitChat();
    } else if (ev.type === 'world:settlement') {
      this.settlementsMap.set(ev.payload.uid, ev.payload);
      this.emitWorld();
    } else if (ev.type === 'world:settlement_removed') {
      this.settlementsMap.delete(ev.payload.uid);
      this.emitWorld();
    } else if (ev.type === 'world:march') {
      if (ev.payload.status === 'completed') {
        this.marchesMap.delete(ev.payload.marchId);
      } else {
        this.marchesMap.set(ev.payload.marchId, ev.payload);
      }
      this.emitWorld();
    } else if (ev.type === 'world:trade') {
      this.upsertTradeAndCheckSettlement(ev.payload);
      this.notifyListeners();
    } else if (ev.type === 'chat:message') {
      this.chatMap.set(ev.payload.messageId, ev.payload);
      this.emitChat();
    } else if (ev.type === 'world:presence') {
      this.onlinePlayers = Math.max(1, ev.payload.onlinePlayers || 1);
      this.serverOffsetMs = ev.payload.serverTimeMs - Date.now();
      this.emitSession();
      this.emitWorld();
    }
  }

  private async handleAuthChanged(user: User | null): Promise<void> {
    this.firebaseUser = user;
    if (this.unsubFirestoreWorld) {
      this.unsubFirestoreWorld();
      this.unsubFirestoreWorld = null;
    }

    if (!user) {
      this.cloudSynced = false;
      this.diagnostics.authStatus = 'idle';
      this.diagnostics.authDetail = 'Gast-Modus (nicht mit Google angemeldet)';
      this.diagnostics.firestoreStatus = 'idle';
      this.diagnostics.firestoreDetail = 'Inaktiv (Google-Login erforderlich)';
      this.diagnostics.firestoreListeners = {
        settlements: 'idle',
        marches: 'idle',
        chat: 'idle',
        trades: 'idle',
      };
      this.pushLog('info', 'Auth', 'Kein Google-Konto angemeldet — Gast-Modus aktiv', `guestUid: ${this.guestUid}`);
      this.emitSession();
      await this.ensureGuestToken();
      await this.pushCurrentSettlement(true);
      return;
    }

    this.diagnostics.authStatus = 'ok';
    this.diagnostics.authDetail = `Google (${user.email || user.uid.slice(0, 10)})`;
    this.diagnostics.firestoreStatus = 'connecting';
    this.diagnostics.firestoreDetail = 'Verbinde Cloud Firestore...';
    this.diagnostics.firestoreListeners = {
      settlements: 'connecting',
      marches: 'connecting',
      chat: 'connecting',
      trades: 'connecting',
    };
    this.pushLog(
      'success',
      'Auth',
      `Authentifiziert: ${user.email || user.displayName || user.uid}`,
      `uid=${user.uid} · verified=${String(user.emailVerified)}`
    );

    if (user.displayName && this.tribeName.startsWith('Glutstamm ')) {
      const first = user.displayName.split(' ')[0] || 'Stamm';
      this.tribeName = sanitizeTribeName(`${first}s Stamm`, this.tribeName);
      try {
        localStorage.setItem(TRIBE_NAME_KEY, this.tribeName);
      } catch {
        // ignore
      }
    }

    // 1. Firebase ID-Token prüfen & ggf. Gast-Siedlung auf Node-Server migrieren
    const fbToken = await getFirebaseIdToken(true);
    if (!fbToken) {
      this.diagnostics.authStatus = 'degraded';
      this.pushLog('warn', 'Auth', 'getIdToken(true) lieferte kein Token zurück');
    } else {
      this.pushLog('info', 'Auth', 'Firebase ID-Token erfolgreich erneuert');
    }

    if (fbToken && this.guestBearerToken && (this.serverAvailable || this.wsConnected)) {
      try {
        const migrated = await postMigrateGuest(fbToken, this.guestBearerToken);
        if (migrated.removedGuestUid) {
          this.settlementsMap.delete(migrated.removedGuestUid);
        }
        if (migrated.settlement) {
          this.settlementsMap.set(migrated.settlement.uid, migrated.settlement);
        }
        this.pushLog('info', 'Sync', 'Gast-Siedlung auf Google-UID migriert');
      } catch (err) {
        this.pushLog('warn', 'API', 'Gast-Migration auf Server übersprungen', this.formatErrorDetail(err));
      }
    }

    // 1b. Direkt-Ping an Firestore-Server (erkennt sofort "client is offline" oder Konfigurationsfehler)
    const probe = await probeFirestoreConnection();
    if (probe.reachable) {
      this.pushLog(
        'success',
        'Firestore',
        `Server-Ping OK (${probe.latencyMs} ms)`,
        `${probe.code} — ${probe.message}`
      );
    } else {
      this.diagnostics.firestoreStatus = 'offline';
      this.diagnostics.firestoreDetail = `${probe.code}: ${probe.message}`;
      this.pushLog(
        'error',
        'Firestore',
        `Server-Ping fehlgeschlagen (${probe.latencyMs} ms)`,
        `${probe.code}: ${probe.message}`
      );
    }

    // 2. Echtzeit-Firestore-Listener für gemeinsame Weltkarte, Märsche & Welt-Chat aktivieren
    this.unsubFirestoreWorld = subscribeFirestoreWorld({
      onListenerStatus: (channel, status, detail) => {
        this.diagnostics.firestoreListeners[channel] = status === 'ok' ? 'ok' : 'error';
        if (status === 'error') {
          this.diagnostics.firestoreStatus = 'error';
          this.diagnostics.firestoreDetail = `${channel}: ${detail}`;
          this.pushLog('error', 'Firestore', `Listener "${channel}" fehlgeschlagen`, detail);
        } else {
          if (this.diagnostics.firestoreStatus !== 'error') {
            this.diagnostics.firestoreStatus = 'ok';
            this.diagnostics.firestoreDetail = `Live (${detail})`;
          }
          this.pushLog('info', 'Firestore', `Listener "${channel}" aktiv`, detail);
        }
      },
      onSettlements: (list) => {
        for (const s of list) {
          const prev = this.settlementsMap.get(s.uid);
          if (!prev || s.updatedAt >= prev.updatedAt) {
            this.settlementsMap.set(s.uid, s);
          }
        }
        if (!this.wsConnected) {
          const recentCutoff = Date.now() - 15 * 60 * 1000;
          const recentCount = Array.from(this.settlementsMap.values()).filter(
            (s) => s.updatedAt >= recentCutoff
          ).length;
          this.onlinePlayers = Math.max(1, recentCount);
        }
        if (!this.cloudSynced) {
          this.cloudSynced = true;
          this.syncState = 'synced';
          this.emitSession();
        }
        this.emitWorld();
      },
      onMarches: (list) => {
        for (const m of list) {
          if (m.status === 'active') {
            this.marchesMap.set(m.marchId, m);
          }
        }
        this.emitWorld();
      },
      onChat: (list) => {
        for (const c of list) {
          this.chatMap.set(c.messageId, c);
        }
        this.emitChat();
      },
      onTrades: (list) => {
        for (const t of list) {
          this.upsertTradeAndCheckSettlement(t);
        }
        this.notifyListeners();
      },
    });

    // 3. Cloud Firestore & Server-Spielstand abgleichen (neuester Stand gewinnt)
    try {
      this.syncState = 'saving';
      this.emitSession();
      this.pushLog('info', 'Sync', 'Lade Cloud-Spielstand aus Firestore...', `users/${user.uid}/private/save`);

      const [cloudSave, serverSaveResp] = await Promise.all([
        loadCloudSave(user.uid),
        fbToken && (this.serverAvailable || this.wsConnected)
          ? fetchServerPlayerSave(fbToken).catch(() => null)
          : Promise.resolve(null),
      ]);

      const localState = this.callbacks.getCurrentLocalState?.() || null;
      const localTs = Number((localState as { lastTick?: number } | null)?.lastTick || 0);
      const cloudTs = cloudSave?.updatedAt || 0;
      const serverTs = serverSaveResp?.save?.updatedAt || 0;

      if (cloudSave && cloudTs >= serverTs && cloudTs > localTs + 3000) {
        this.tribeName = sanitizeTribeName(cloudSave.tribeName, this.tribeName);
        try {
          localStorage.setItem(TRIBE_NAME_KEY, this.tribeName);
        } catch {
          // ignore
        }
        this.cloudSynced = true;
        this.lastCloudSaveAt = cloudSave.updatedAt;
        this.callbacks.onCloudStateLoaded?.(cloudSave.state, this.tribeName);
        this.pushLog('success', 'Sync', 'Neuerer Cloud-Spielstand aus Firestore geladen');
        if (fbToken) {
          await this.persistToServer(cloudSave.state, fbToken);
        }
      } else if (serverSaveResp?.save && serverTs > cloudTs && serverTs > localTs + 3000) {
        this.tribeName = sanitizeTribeName(serverSaveResp.save.tribeName, this.tribeName);
        this.lastServerSaveAt = serverSaveResp.save.updatedAt;
        this.callbacks.onCloudStateLoaded?.(serverSaveResp.save.state, this.tribeName);
        await saveCloudState(user.uid, this.tribeName, serverSaveResp.save.state, 1);
        this.cloudSynced = true;
        this.lastCloudSaveAt = Date.now();
        this.pushLog('success', 'Sync', 'Server-Spielstand geladen & in Firestore gespiegelt');
      } else if (localState) {
        await saveCloudState(user.uid, this.tribeName, localState, 1);
        this.cloudSynced = true;
        this.lastCloudSaveAt = Date.now();
        this.pushLog('success', 'Sync', 'Lokaler Spielstand erfolgreich in Cloud Firestore gespeichert');
        if (fbToken) {
          await this.persistToServer(localState, fbToken);
        }
      } else {
        // Firestore-Lesezugriff erfolgreich, lokaler Runtime-Zustand noch im Aufbau
        this.cloudSynced = probe.reachable;
        this.pushLog(
          'info',
          'Sync',
          cloudSave ? 'Cloud-Spielstand geprüft (aktuell)' : 'Kein bestehender Cloud-Spielstand — warte auf erste Speicherung'
        );
      }

      if (this.getDiagnostics().firestoreStatus !== 'error') {
        this.diagnostics.firestoreStatus = 'ok';
        this.diagnostics.firestoreDetail = 'Cloud Firestore synchronisiert';
      }
      this.syncState = 'synced';
      await this.pushCurrentSettlement(true);
    } catch (err) {
      const detail = this.formatErrorDetail(err);
      console.error('[Cloud Save Sync]', err);
      this.diagnostics.firestoreStatus = detail.toLowerCase().includes('offline') ? 'offline' : 'error';
      this.diagnostics.firestoreDetail = detail;
      this.pushLog('error', 'Sync', 'Cloud-Save-Sync fehlgeschlagen', detail);
      this.syncState = this.wsConnected ? 'synced' : 'offline';
    }

    this.refreshRootCauseHint();
    this.emitSession();
  }

  private async persistToServer(
    stateObj: Record<string, unknown>,
    tokenOverride?: string | null
  ): Promise<void> {
    if (!this.serverAvailable && !this.wsConnected) return;
    const token = tokenOverride ?? (await this.getActiveBearerToken());
    if (!token) return;
    try {
      const res = await postServerPlayerSave(token, {
        schemaVersion: 1,
        tribeName: this.tribeName,
        state: stateObj,
      });
      if (res.ok) {
        this.lastServerSaveAt = res.updatedAt;
      }
    } catch {
      // ignore offline server backup errors
    }
  }

  async signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
    this.pushLog('info', 'Auth', 'Starte Google-Popup-Anmeldung...', `Host: ${this.diagnostics.hostname}`);
    try {
      await signInWithGooglePopup();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.diagnostics.authStatus = 'error';
      this.diagnostics.authDetail = msg.slice(0, 120);
      this.pushLog('error', 'Auth', 'Google-Anmeldung fehlgeschlagen', msg);
      return { ok: false, error: msg };
    }
  }

  async signOut(): Promise<void> {
    this.pushLog('info', 'Auth', 'Benutzer meldet sich ab...');
    await signOutFirebase();
    this.firebaseUser = null;
    this.cloudSynced = false;
    this.emitSession();
  }

  async runConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
    this.diagnostics.browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.pushLog(
      'info',
      'Netzwerk',
      `Diagnose gestartet (Browser: ${this.diagnostics.browserOnline ? 'online' : 'offline'})`,
      `Host: ${this.diagnostics.hostname} · Projekt: ${this.diagnostics.firebaseProjectId}`
    );

    if (this.firebaseUser) {
      const token = await getFirebaseIdToken(true);
      if (token) {
        this.diagnostics.authStatus = 'ok';
        this.diagnostics.authDetail = `Google (${this.firebaseUser.email || this.firebaseUser.uid.slice(0, 10)})`;
        this.pushLog('success', 'Auth', 'ID-Token-Prüfung erfolgreich', `uid=${this.firebaseUser.uid}`);
      } else {
        this.diagnostics.authStatus = 'error';
        this.diagnostics.authDetail = 'ID-Token konnte nicht abgerufen werden';
        this.pushLog('error', 'Auth', 'ID-Token-Prüfung fehlgeschlagen');
      }
    } else {
      this.pushLog('warn', 'Auth', 'Kein authentifizierter Firebase-Benutzer aktiv (Gast-Modus)');
    }

    const probe = await probeFirestoreConnection();
    if (probe.reachable) {
      if (this.firebaseUser) {
        this.diagnostics.firestoreStatus = 'ok';
        this.diagnostics.firestoreDetail = `Erreichbar (${probe.latencyMs} ms)`;
      }
      this.pushLog(
        'success',
        'Firestore',
        `Diagnose-Ping OK (${probe.latencyMs} ms)`,
        `${probe.code} — ${probe.message}`
      );
    } else {
      this.diagnostics.firestoreStatus = probe.message.includes('offline') ? 'offline' : 'error';
      this.diagnostics.firestoreDetail = `${probe.code}: ${probe.message}`;
      this.pushLog(
        'error',
        'Firestore',
        `Diagnose-Ping fehlgeschlagen (${probe.latencyMs} ms)`,
        `${probe.code}: ${probe.message}`
      );
    }

    if (this.firebaseUser) {
      await this.pushCurrentSettlement(true);
    }
    await this.bootstrapServerState();
    this.refreshRootCauseHint();
    this.emitSession();
    return this.getDiagnostics();
  }

  setTribeName(name: string): string {
    const clean = sanitizeTribeName(name, this.tribeName);
    this.tribeName = clean;
    try {
      localStorage.setItem(TRIBE_NAME_KEY, clean);
    } catch {
      // ignore
    }
    this.emitSession();
    void this.pushCurrentSettlement(false);
    return clean;
  }

  private async pushCurrentSettlement(autoAssignIfOccupied: boolean): Promise<void> {
    const meta = this.callbacks.getCurrentSettlementMeta?.();
    if (!meta) return;
    await this.syncSettlement({
      bonfireLevel: meta.bonfireLevel,
      power: meta.power,
      tileX: meta.tileX,
      tileY: meta.tileY,
      autoAssignIfOccupied,
    });
  }

  async syncSettlement(payload: {
    bonfireLevel: number;
    power: number;
    tileX: number;
    tileY: number;
    autoAssignIfOccupied?: boolean;
  }): Promise<TeleportResponse | null> {
    const session = this.getSession();
    let finalTileX = payload.tileX;
    let finalTileY = payload.tileY;
    let finalBonfire = payload.bonfireLevel;
    let finalPower = payload.power;
    let serverResp: TeleportResponse | null = null;

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          const resp = await postSettlement(
            {
              tribeName: session.tribeName,
              bonfireLevel: payload.bonfireLevel,
              power: payload.power,
              tileX: payload.tileX,
              tileY: payload.tileY,
              autoAssignIfOccupied: payload.autoAssignIfOccupied ?? true,
            },
            token
          );
          serverResp = resp;
          if (resp.ok && resp.settlement) {
            finalTileX = resp.settlement.tileX;
            finalTileY = resp.settlement.tileY;
            finalBonfire = resp.settlement.bonfireLevel;
            finalPower = resp.settlement.power;
            this.settlementsMap.set(resp.settlement.uid, resp.settlement);
            this.emitWorld();
          }
        } catch {
          // Node-Server nicht erreichbar (z. B. statisches GitHub Pages) — Cloud Firestore übernimmt
        }
      }
    }

    if (this.firebaseUser) {
      const fbUid = this.firebaseUser.uid;
      const localDto: WorldSettlementDTO = {
        uid: fbUid,
        tribeName: session.tribeName,
        bonfireLevel: finalBonfire,
        power: finalPower,
        tileX: finalTileX,
        tileY: finalTileY,
        chunkKey: `${Math.floor(finalTileX / 12)}_${Math.floor(finalTileY / 9)}`,
        updatedAt: Date.now(),
      };
      this.settlementsMap.set(fbUid, localDto);
      this.emitWorld();
      try {
        await syncPublicProfileAndSettlement({
          uid: fbUid,
          tribeName: session.tribeName,
          bonfireLevel: finalBonfire,
          power: finalPower,
          tileX: finalTileX,
          tileY: finalTileY,
        });
        this.cloudSynced = true;
        this.syncState = 'synced';
        this.diagnostics.firestoreStatus = 'ok';
        this.diagnostics.firestoreDetail = `Siedlung synchronisiert [${finalTileX},${finalTileY}]`;
        this.pushLog(
          'success',
          'Firestore',
          `Siedlung in world_settlements gespeichert [${finalTileX},${finalTileY}]`,
          `Stamm: ${session.tribeName} · Feuer St.${finalBonfire}`
        );
        this.emitSession();
      } catch (err) {
        const detail = this.formatErrorDetail(err);
        this.diagnostics.firestoreStatus = detail.toLowerCase().includes('offline') ? 'offline' : 'error';
        this.diagnostics.firestoreDetail = detail;
        this.pushLog('error', 'Firestore', 'Siedlungs-Sync fehlgeschlagen', detail);
      }
    }

    return serverResp;
  }

  async teleportSettlement(payload: {
    bonfireLevel: number;
    power: number;
    tileX: number;
    tileY: number;
  }): Promise<TeleportResponse> {
    const session = this.getSession();
    let finalTileX = payload.tileX;
    let finalTileY = payload.tileY;
    let finalBonfire = payload.bonfireLevel;
    let finalPower = payload.power;
    let resp: TeleportResponse = { ok: true, serverTimeMs: Date.now() };

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          resp = await postSettlement(
            {
              tribeName: session.tribeName,
              bonfireLevel: payload.bonfireLevel,
              power: payload.power,
              tileX: payload.tileX,
              tileY: payload.tileY,
              autoAssignIfOccupied: false,
            },
            token
          );
          if (resp.ok && resp.settlement) {
            finalTileX = resp.settlement.tileX;
            finalTileY = resp.settlement.tileY;
            finalBonfire = resp.settlement.bonfireLevel;
            finalPower = resp.settlement.power;
            this.settlementsMap.set(resp.settlement.uid, resp.settlement);
            this.emitWorld();
          }
        } catch {
          resp = { ok: true, serverTimeMs: Date.now() };
        }
      }
    }

    if (resp.ok && this.firebaseUser) {
      const fbUid = this.firebaseUser.uid;
      this.settlementsMap.set(fbUid, {
        uid: fbUid,
        tribeName: session.tribeName,
        bonfireLevel: finalBonfire,
        power: finalPower,
        tileX: finalTileX,
        tileY: finalTileY,
        chunkKey: `${Math.floor(finalTileX / 12)}_${Math.floor(finalTileY / 9)}`,
        updatedAt: Date.now(),
      });
      this.emitWorld();
      void syncPublicProfileAndSettlement({
        uid: fbUid,
        tribeName: session.tribeName,
        bonfireLevel: finalBonfire,
        power: finalPower,
        tileX: finalTileX,
        tileY: finalTileY,
      }).catch(() => {});
    }

    return resp;
  }

  async broadcastMarch(payload: {
    marchId: string;
    kind: 'gather' | 'hunt';
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    targetLabel: string;
    durationMs: number;
  }): Promise<void> {
    const session = this.getSession();
    const now = Date.now() + this.serverOffsetMs;
    const marchId = sanitizeId(payload.marchId || `m_${now}_${Math.floor(Math.random() * 9999)}`);
    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          await postMarch(
            {
              marchId,
              tribeName: session.tribeName,
              kind: payload.kind,
              fromX: payload.fromX,
              fromY: payload.fromY,
              toX: payload.toX,
              toY: payload.toY,
              targetLabel: payload.targetLabel,
              startedAt: now,
              endsAt: now + Math.max(4000, payload.durationMs),
              status: 'active',
            },
            token
          );
        } catch {
          // ignore offline broadcast errors
        }
      }
    }
    if (this.firebaseUser) {
      void publishMarchToFirestore({
        marchId,
        uid: this.firebaseUser.uid,
        tribeName: session.tribeName,
        kind: payload.kind,
        fromX: payload.fromX,
        fromY: payload.fromY,
        toX: payload.toX,
        toY: payload.toY,
        targetLabel: payload.targetLabel,
      }).catch(() => {});
    }
  }

  async completeMarch(marchIdRaw: string): Promise<void> {
    const marchId = sanitizeId(marchIdRaw);
    if (marchId.length < 3) return;
    this.marchesMap.delete(marchId);
    this.emitWorld();

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        void postMarch({ marchId, status: 'completed' }, token).catch(() => {});
      }
    }
    if (this.firebaseUser) {
      void completeMarchInFirestore(marchId).catch(() => {});
    }
  }

  async validateBuildServer(req: BuildValidationRequest): Promise<BuildValidationResponse | null> {
    if (!this.serverAvailable && !this.wsConnected) return null;
    try {
      return await postValidateBuild(req);
    } catch {
      return null;
    }
  }

  async resolveDinoHuntServer(req: DinoHuntCombatRequest): Promise<DinoHuntCombatResponse | null> {
    if (!this.serverAvailable && !this.wsConnected) return null;
    try {
      return await postDinoHuntCombat(req);
    } catch {
      return null;
    }
  }

  async sendChat(text: string, bonfireLevel: number): Promise<{ ok: boolean; error?: string }> {
    const clean = String(text || '').trim().slice(0, 240);
    if (!clean) return { ok: false, error: 'Nachricht ist leer.' };
    const session = this.getSession();
    const messageId = sanitizeId(`msg_${Date.now()}_${Math.floor(Math.random() * 99999)}`);
    let sent = false;

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          const resp = await postChatMessage(
            {
              messageId,
              tribeName: session.tribeName,
              bonfireLevel,
              text: clean,
            },
            token
          );
          if (resp.ok && resp.message) {
            this.chatMap.set(resp.message.messageId, resp.message);
            this.emitChat();
            sent = true;
          }
        } catch {
          // Node-Server nicht erreichbar — Cloud Firestore versuchen
        }
      }
    }

    if (this.firebaseUser) {
      try {
        await publishChatToFirestore({
          messageId,
          uid: this.firebaseUser.uid,
          tribeName: session.tribeName,
          bonfireLevel,
          text: clean,
        });
        if (!sent) {
          this.chatMap.set(messageId, {
            messageId,
            uid: this.firebaseUser.uid,
            tribeName: session.tribeName,
            bonfireLevel,
            text: clean,
            channel: 'world',
            createdAt: Date.now(),
          });
          this.emitChat();
        }
        sent = true;
      } catch (err) {
        const detail = this.formatErrorDetail(err);
        this.pushLog('error', 'Firestore', 'Welt-Chat-Nachricht fehlgeschlagen', detail);
        if (!sent) {
          return {
            ok: false,
            error: detail || 'Cloud-Chat fehlgeschlagen.',
          };
        }
      }
    }

    if (sent) return { ok: true };
    return {
      ok: false,
      error: 'Bitte unten links mit Google anmelden, um den Live-Welt-Chat zu nutzen.',
    };
  }

  async proposeTrade(req: {
    toUid: string;
    toTribeName: string;
    offerResource: ResourceKey;
    offerAmount: number;
    requestResource: ResourceKey;
    requestAmount: number;
  }): Promise<{ ok: boolean; trade?: WorldTradeDTO; error?: string }> {
    const session = this.getSession();
    if (!req.toUid || req.toUid === session.uid) {
      return { ok: false, error: 'Ungültiger Handelspartner.' };
    }
    if (req.offerResource === req.requestResource) {
      return { ok: false, error: 'Bitte zwei unterschiedliche Ressourcen wählen.' };
    }
    const offerAmount = Math.max(1, Math.min(5000, Math.floor(Number(req.offerAmount || 0))));
    const requestAmount = Math.max(1, Math.min(5000, Math.floor(Number(req.requestAmount || 0))));
    const tradeId = sanitizeId(`trd_${Date.now()}_${Math.floor(Math.random() * 99999)}`);
    const now = Date.now();
    let created: WorldTradeDTO | undefined;
    let lastError: string | undefined;

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          const resp = await postProposeTrade(
            {
              tradeId,
              fromTribeName: session.tribeName,
              toUid: req.toUid,
              toTribeName: sanitizeTribeName(req.toTribeName, 'Nachbar'),
              offerResource: req.offerResource,
              offerAmount,
              requestResource: req.requestResource,
              requestAmount,
            },
            token
          );
          if (resp.ok && resp.trade) {
            created = resp.trade;
            this.upsertTradeAndCheckSettlement(resp.trade);
            this.notifyListeners();
          } else if (resp.error) {
            lastError = resp.error;
          }
        } catch (err) {
          lastError = this.formatErrorDetail(err);
        }
      }
    }

    if (this.firebaseUser) {
      try {
        await createTradeInFirestore({
          tradeId,
          fromUid: this.firebaseUser.uid,
          fromTribeName: session.tribeName,
          toUid: req.toUid,
          toTribeName: sanitizeTribeName(req.toTribeName, 'Nachbar'),
          offerResource: req.offerResource,
          offerAmount,
          requestResource: req.requestResource,
          requestAmount,
        });
        if (!created) {
          created = {
            tradeId,
            fromUid: this.firebaseUser.uid,
            fromTribeName: session.tribeName,
            toUid: req.toUid,
            toTribeName: sanitizeTribeName(req.toTribeName, 'Nachbar'),
            offerResource: req.offerResource,
            offerAmount,
            requestResource: req.requestResource,
            requestAmount,
            fromConfirmed: false,
            toConfirmed: false,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          };
          this.upsertTradeAndCheckSettlement(created);
          this.notifyListeners();
        }
        this.pushLog('info', 'Firestore', `Tauschangebot an ${req.toTribeName} gesendet`, tradeId);
      } catch (err) {
        const detail = this.formatErrorDetail(err);
        this.pushLog('error', 'Firestore', 'Tauschangebot fehlgeschlagen', detail);
        if (!created) {
          return { ok: false, error: detail || 'Tauschangebot konnte nicht gespeichert werden.' };
        }
      }
    }

    if (created) {
      return { ok: true, trade: created };
    }
    return {
      ok: false,
      error:
        lastError ||
        'Bitte mit Google anmelden oder Online-Verbindung herstellen, um ein zweiseitiges Tauschangebot zu senden.',
    };
  }

  async confirmTrade(tradeIdRaw: string): Promise<{ ok: boolean; trade?: WorldTradeDTO; error?: string }> {
    const tradeId = sanitizeId(tradeIdRaw);
    if (tradeId.length < 3) return { ok: false, error: 'Ungültige Tausch-ID.' };
    let updated: WorldTradeDTO | undefined;
    let lastError: string | undefined;

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          const resp = await postRespondTrade({ tradeId, action: 'confirm' }, token);
          if (resp.ok && resp.trade) {
            updated = resp.trade;
            this.upsertTradeAndCheckSettlement(resp.trade);
            this.notifyListeners();
          } else if (resp.error) {
            lastError = resp.error;
          }
        } catch (err) {
          lastError = this.formatErrorDetail(err);
        }
      }
    }

    if (this.firebaseUser) {
      try {
        const fsTrade = await confirmTradeInFirestore(tradeId);
        if (fsTrade) {
          updated = fsTrade;
          this.upsertTradeAndCheckSettlement(fsTrade);
          this.notifyListeners();
          this.pushLog(
            'success',
            'Firestore',
            fsTrade.status === 'completed'
              ? `Tausch ${tradeId} beidseitig bestätigt!`
              : `Eigene Bestätigung für Tausch ${tradeId} gespeichert`
          );
        }
      } catch (err) {
        const detail = this.formatErrorDetail(err);
        this.pushLog('error', 'Firestore', 'Tausch-Bestätigung fehlgeschlagen', detail);
        if (!updated) {
          return { ok: false, error: detail || 'Tausch konnte nicht bestätigt werden.' };
        }
      }
    }

    if (updated) return { ok: true, trade: updated };
    return { ok: false, error: lastError || 'Tausch konnte nicht bestätigt werden.' };
  }

  async cancelTrade(tradeIdRaw: string): Promise<{ ok: boolean; error?: string }> {
    const tradeId = sanitizeId(tradeIdRaw);
    if (tradeId.length < 3) return { ok: false, error: 'Ungültige Tausch-ID.' };
    let cancelled = false;
    let lastError: string | undefined;

    if (this.serverAvailable || this.wsConnected) {
      const token = await this.getActiveBearerToken();
      if (token) {
        try {
          const resp = await postRespondTrade({ tradeId, action: 'cancel' }, token);
          if (resp.ok && resp.trade) {
            this.upsertTradeAndCheckSettlement(resp.trade);
            this.notifyListeners();
            cancelled = true;
          } else if (resp.error) {
            lastError = resp.error;
          }
        } catch (err) {
          lastError = this.formatErrorDetail(err);
        }
      }
    }

    if (this.firebaseUser) {
      try {
        await cancelTradeInFirestore(tradeId);
        const existing = this.tradesMap.get(tradeId);
        if (existing) {
          this.tradesMap.set(tradeId, {
            ...existing,
            status: 'cancelled',
            updatedAt: Date.now(),
          });
          this.notifyListeners();
        }
        cancelled = true;
      } catch (err) {
        const detail = this.formatErrorDetail(err);
        this.pushLog('error', 'Firestore', 'Tausch-Abbruch fehlgeschlagen', detail);
        if (!cancelled) {
          return { ok: false, error: detail || 'Tausch konnte nicht abgebrochen werden.' };
        }
      }
    }

    if (cancelled) return { ok: true };
    return { ok: false, error: lastError || 'Tausch konnte nicht abgebrochen werden.' };
  }

  saveToCloud(stateObj: Record<string, unknown>, immediate = false): void {
    const runSave = async () => {
      this.syncState = 'saving';
      this.emitSession();
      try {
        // 1. Auf dem Spielserver sichern (sofern aktiver Backend-Server erreichbar)
        await this.persistToServer(stateObj);
        // 2. Bei verknüpftem Google-Konto direkt in Cloud Firestore sichern (funktioniert auch auf GitHub Pages)
        if (this.firebaseUser) {
          await saveCloudState(this.firebaseUser.uid, this.tribeName, stateObj, 1);
          this.cloudSynced = true;
          this.lastCloudSaveAt = Date.now();
          this.diagnostics.firestoreStatus = 'ok';
          this.pushLog('success', 'Sync', 'Cloud-Spielstand gespeichert', `users/${this.firebaseUser.uid}/private/save`);
        }
        this.syncState = this.wsConnected || this.isCloudLive() ? 'synced' : 'offline';
      } catch (err) {
        const detail = this.formatErrorDetail(err);
        console.error('[Persistenz-Sync Fehler]', err);
        this.diagnostics.firestoreStatus = detail.toLowerCase().includes('offline') ? 'offline' : 'error';
        this.diagnostics.firestoreDetail = detail;
        this.pushLog('error', 'Sync', 'Cloud-Speicherung fehlgeschlagen', detail);
        this.syncState = this.wsConnected || this.isCloudLive() ? 'synced' : 'offline';
      }
      this.refreshRootCauseHint();
      this.emitSession();
    };

    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (immediate) {
      void runSave();
    } else {
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        void runSave();
      }, 2200);
    }
  }

  private emitSession(): void {
    this.callbacks.onSessionChange?.(this.getSession());
    this.notifyListeners();
  }

  private emitWorld(): void {
    const w = this.getWorldData();
    this.callbacks.onWorldUpdate?.({
      settlements: w.settlements,
      marches: w.marches,
      onlinePlayers: w.onlinePlayers,
    });
    this.notifyListeners();
  }

  private emitChat(): void {
    const w = this.getWorldData();
    this.callbacks.onChatUpdate?.(w.chat);
    this.notifyListeners();
  }
}

const bridge = new DinoMultiplayerBridge();

declare global {
  interface Window {
    DinoMultiplayer?: DinoMultiplayerBridge;
  }
}

window.DinoMultiplayer = bridge;
export default bridge;
