import type { User } from 'firebase/auth';
import type {
  BuildValidationRequest,
  BuildValidationResponse,
  DinoHuntCombatRequest,
  DinoHuntCombatResponse,
  RealtimeEvent,
  TeleportResponse,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
} from './shared/apiTypes';
import {
  completeMarchInFirestore,
  getFirebaseIdToken,
  loadCloudSave,
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
  postServerPlayerSave,
  postSettlement,
  postValidateBuild,
} from './services/gameApiClient';

const GUEST_UID_KEY = 'glut_basalt_guest_uid_v1';
const TRIBE_NAME_KEY = 'glut_basalt_tribe_name_v1';

export type SyncState = 'connecting' | 'synced' | 'saving' | 'offline';

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
  onCloudStateLoaded?: (cloudState: Record<string, unknown>, tribeName: string) => void;
  getCurrentLocalState?: () => Record<string, unknown> | null;
  getCurrentSettlementMeta?: () => {
    bonfireLevel: number;
    power: number;
    tileX: number;
    tileY: number;
  } | null;
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

  private socket: GameRealtimeSocket | null = null;
  private unsubAuth: (() => void) | null = null;
  private unsubFirestoreWorld: (() => void) | null = null;
  private saveTimer: number | null = null;
  private initialized = false;
  private listeners = new Set<() => void>();

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
    onlinePlayers: number;
  } {
    const now = Date.now() + this.serverOffsetMs;
    const marches = Array.from(this.marchesMap.values()).filter(
      (m) => m.status === 'active' && m.endsAt + 8000 >= now
    );
    const chat = Array.from(this.chatMap.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-60);
    return {
      settlements: Array.from(this.settlementsMap.values()),
      marches,
      chat,
      onlinePlayers: this.onlinePlayers,
    };
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
    if (this.initialized) {
      this.emitSession();
      this.emitWorld();
      this.emitChat();
      return;
    }
    this.initialized = true;

    // 1. Mit Node.js Spielserver verbinden (signierte Gast-Session + dauerhafter Weltzustand + WebSocket)
    this.socket = new GameRealtimeSocket(
      (ev) => this.handleRealtimeEvent(ev),
      (connected) => {
        this.wsConnected = connected;
        this.syncState = connected ? 'synced' : 'offline';
        this.emitSession();
        if (connected) {
          void this.pushCurrentSettlement(true);
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

  private async bootstrapServerState(): Promise<void> {
    try {
      const [world, guestToken] = await Promise.all([
        fetchWorldState(),
        this.firebaseUser ? Promise.resolve(null) : this.ensureGuestToken(),
      ]);
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
    } catch {
      this.syncState = 'offline';
      this.emitSession();
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
      this.emitSession();
      await this.ensureGuestToken();
      await this.pushCurrentSettlement(true);
      return;
    }

    if (user.displayName && this.tribeName.startsWith('Glutstamm ')) {
      const first = user.displayName.split(' ')[0] || 'Stamm';
      this.tribeName = sanitizeTribeName(`${first}s Stamm`, this.tribeName);
      try {
        localStorage.setItem(TRIBE_NAME_KEY, this.tribeName);
      } catch {
        // ignore
      }
    }

    // 1. Bestehende Gast-Siedlung atomar auf dem Spielserver auf die Google-UID migrieren
    const fbToken = await getFirebaseIdToken(true);
    if (fbToken && this.guestBearerToken) {
      try {
        const migrated = await postMigrateGuest(fbToken, this.guestBearerToken);
        if (migrated.removedGuestUid) {
          this.settlementsMap.delete(migrated.removedGuestUid);
        }
        if (migrated.settlement) {
          this.settlementsMap.set(migrated.settlement.uid, migrated.settlement);
        }
      } catch {
        // ignore if server unreachable
      }
    }

    // 2. Echtzeit-Firestore-Listener für gemeinsame Weltkarte, Märsche & Welt-Chat aktivieren
    this.unsubFirestoreWorld = subscribeFirestoreWorld({
      onSettlements: (list) => {
        for (const s of list) {
          const prev = this.settlementsMap.get(s.uid);
          if (!prev || s.updatedAt >= prev.updatedAt) {
            this.settlementsMap.set(s.uid, s);
          }
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
    });

    // 3. Cloud Firestore & Server-Spielstand abgleichen (neuester Stand gewinnt)
    try {
      this.syncState = 'saving';
      this.emitSession();

      const [cloudSave, serverSaveResp] = await Promise.all([
        loadCloudSave(user.uid),
        fbToken ? fetchServerPlayerSave(fbToken).catch(() => null) : Promise.resolve(null),
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
      } else if (localState) {
        await saveCloudState(user.uid, this.tribeName, localState, 1);
        this.cloudSynced = true;
        this.lastCloudSaveAt = Date.now();
        if (fbToken) {
          await this.persistToServer(localState, fbToken);
        }
      }

      this.syncState = 'synced';
      await this.pushCurrentSettlement(true);
    } catch (err) {
      console.error('[Cloud Save Sync]', err);
      this.syncState = this.wsConnected ? 'synced' : 'offline';
    }

    this.emitSession();
  }

  private async persistToServer(
    stateObj: Record<string, unknown>,
    tokenOverride?: string | null
  ): Promise<void> {
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
    try {
      await signInWithGooglePopup();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async signOut(): Promise<void> {
    await signOutFirebase();
    this.firebaseUser = null;
    this.cloudSynced = false;
    this.emitSession();
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
    const token = await this.getActiveBearerToken();
    if (!token) return null;

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
      if (resp.ok && resp.settlement) {
        this.settlementsMap.set(resp.settlement.uid, resp.settlement);
        this.emitWorld();
        if (this.firebaseUser) {
          void syncPublicProfileAndSettlement({
            uid: this.firebaseUser.uid,
            tribeName: session.tribeName,
            bonfireLevel: resp.settlement.bonfireLevel,
            power: resp.settlement.power,
            tileX: resp.settlement.tileX,
            tileY: resp.settlement.tileY,
          }).catch(() => {});
        }
      }
      return resp;
    } catch {
      return null;
    }
  }

  async teleportSettlement(payload: {
    bonfireLevel: number;
    power: number;
    tileX: number;
    tileY: number;
  }): Promise<TeleportResponse> {
    const session = this.getSession();
    const token = await this.getActiveBearerToken();
    if (!token) {
      return { ok: true, serverTimeMs: Date.now() };
    }
    try {
      const resp = await postSettlement(
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
        this.settlementsMap.set(resp.settlement.uid, resp.settlement);
        this.emitWorld();
        if (this.firebaseUser) {
          void syncPublicProfileAndSettlement({
            uid: this.firebaseUser.uid,
            tribeName: session.tribeName,
            bonfireLevel: resp.settlement.bonfireLevel,
            power: resp.settlement.power,
            tileX: resp.settlement.tileX,
            tileY: resp.settlement.tileY,
          }).catch(() => {});
        }
      }
      return resp;
    } catch {
      return { ok: true, serverTimeMs: Date.now() };
    }
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
    const token = await this.getActiveBearerToken();
    const now = Date.now() + this.serverOffsetMs;
    const marchId = sanitizeId(payload.marchId || `m_${now}_${Math.floor(Math.random() * 9999)}`);
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

    const token = await this.getActiveBearerToken();
    if (token) {
      void postMarch({ marchId, status: 'completed' }, token).catch(() => {});
    }
    if (this.firebaseUser) {
      void completeMarchInFirestore(marchId).catch(() => {});
    }
  }

  async validateBuildServer(req: BuildValidationRequest): Promise<BuildValidationResponse | null> {
    try {
      return await postValidateBuild(req);
    } catch {
      return null;
    }
  }

  async resolveDinoHuntServer(req: DinoHuntCombatRequest): Promise<DinoHuntCombatResponse | null> {
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
    const token = await this.getActiveBearerToken();
    if (!token) return { ok: false, error: 'Keine Serververbindung.' };

    const messageId = sanitizeId(`msg_${Date.now()}_${Math.floor(Math.random() * 99999)}`);
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
      }
      if (this.firebaseUser) {
        void publishChatToFirestore({
          messageId,
          uid: this.firebaseUser.uid,
          tribeName: session.tribeName,
          bonfireLevel,
          text: clean,
        }).catch(() => {});
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Senden fehlgeschlagen.' };
    }
  }

  saveToCloud(stateObj: Record<string, unknown>, immediate = false): void {
    const runSave = async () => {
      this.syncState = 'saving';
      this.emitSession();
      try {
        // 1. Immer auf dem Spielserver dauerhaft sichern (für Gäste & Google-Konten)
        await this.persistToServer(stateObj);
        // 2. Bei verknüpftem Google-Konto zusätzlich in Cloud Firestore sichern
        if (this.firebaseUser) {
          await saveCloudState(this.firebaseUser.uid, this.tribeName, stateObj, 1);
          this.cloudSynced = true;
          this.lastCloudSaveAt = Date.now();
        }
        this.syncState = this.wsConnected ? 'synced' : 'offline';
      } catch (err) {
        console.error('[Persistenz-Sync Fehler]', err);
        this.syncState = this.wsConnected ? 'synced' : 'offline';
      }
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
