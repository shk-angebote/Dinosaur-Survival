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
  fetchWorldState,
  GameRealtimeSocket,
  postChatMessage,
  postDinoHuntCombat,
  postMarch,
  postSettlement,
  postValidateBuild,
} from './services/gameApiClient';

const GUEST_UID_KEY = 'glut_basalt_guest_uid_v1';
const TRIBE_NAME_KEY = 'glut_basalt_tribe_name_v1';

export interface PlayerSession {
  uid: string;
  isGuest: boolean;
  email: string | null;
  displayName: string | null;
  tribeName: string;
  wsConnected: boolean;
  cloudSynced: boolean;
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
    if (existing && /^[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
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
  private tribeName: string = getOrCreateTribeName();
  private wsConnected = false;
  private cloudSynced = false;
  private lastCloudSaveAt: number | null = null;
  private onlinePlayers = 1;
  private serverOffsetMs = 0;

  private settlementsMap = new Map<string, WorldSettlementDTO>();
  private marchesMap = new Map<string, WorldMarchDTO>();
  private chatMap = new Map<string, WorldChatMessageDTO>();

  private socket: GameRealtimeSocket | null = null;
  private unsubAuth: (() => void) | null = null;
  private unsubFirestoreWorld: (() => void) | null = null;
  private cloudSaveTimer: number | null = null;
  private initialized = false;

  getSession(): PlayerSession {
    return {
      uid: this.firebaseUser ? this.firebaseUser.uid : this.guestUid,
      isGuest: !this.firebaseUser,
      email: this.firebaseUser?.email ?? null,
      displayName: this.firebaseUser?.displayName ?? null,
      tribeName: this.tribeName,
      wsConnected: this.wsConnected,
      cloudSynced: this.cloudSynced,
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

  init(callbacks: BridgeCallbacks): void {
    this.callbacks = callbacks;
    if (this.initialized) {
      this.emitSession();
      this.emitWorld();
      this.emitChat();
      return;
    }
    this.initialized = true;

    // 1. Connect to Node.js Game Server REST + WebSocket (works immediately for Guests & Signed-In)
    void this.bootstrapServerState();
    this.socket = new GameRealtimeSocket(
      (ev) => this.handleRealtimeEvent(ev),
      (connected) => {
        this.wsConnected = connected;
        this.emitSession();
        if (connected) {
          this.pushCurrentSettlement(true);
        }
      }
    );
    this.socket.connect();

    // 2. Listen to Firebase Authentication (Google Account linking / Cloud Save)
    this.unsubAuth = subscribeAuth((user) => {
      void this.handleAuthChanged(user);
    });

    this.emitSession();
  }

  private async bootstrapServerState(): Promise<void> {
    try {
      const world = await fetchWorldState();
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
      this.emitSession();
      this.emitWorld();
      this.emitChat();
      this.pushCurrentSettlement(true);
    } catch {
      // Offline or starting up — WebSocket reconnect will catch up
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
    } else if (ev.type === 'world:march') {
      this.marchesMap.set(ev.payload.marchId, ev.payload);
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
      return;
    }

    // If user still has default guest tribe name and Google gives a first name, keep theirs unless empty
    if (user.displayName && this.tribeName.startsWith('Glutstamm ')) {
      const first = user.displayName.split(' ')[0] || 'Stamm';
      this.setTribeName(`${first}s Stamm`);
    }

    // Attach Firestore real-time multiplayer world listeners (authenticated only!)
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
          this.marchesMap.set(m.marchId, m);
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

    // Load Cloud Save or migrate local Guest save to Cloud Firestore!
    try {
      const existingCloud = await loadCloudSave(user.uid);
      if (existingCloud && existingCloud.state && Object.keys(existingCloud.state).length > 0) {
        this.tribeName = sanitizeTribeName(existingCloud.tribeName, this.tribeName);
        try {
          localStorage.setItem(TRIBE_NAME_KEY, this.tribeName);
        } catch {
          // ignore
        }
        this.cloudSynced = true;
        this.lastCloudSaveAt = existingCloud.updatedAt;
        this.callbacks.onCloudStateLoaded?.(existingCloud.state, this.tribeName);
      } else {
        const localState = this.callbacks.getCurrentLocalState?.();
        if (localState) {
          await saveCloudState(user.uid, this.tribeName, localState, 1);
          this.cloudSynced = true;
          this.lastCloudSaveAt = Date.now();
        }
      }
      this.pushCurrentSettlement(true);
    } catch (err) {
      console.error('[Cloud Save Sync]', err);
    }

    this.emitSession();
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
    this.pushCurrentSettlement(false);
    return clean;
  }

  private pushCurrentSettlement(autoAssignIfOccupied: boolean): void {
    const meta = this.callbacks.getCurrentSettlementMeta?.();
    if (!meta) return;
    void this.syncSettlement({
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
    try {
      const resp = await postSettlement({
        uid: session.uid,
        tribeName: session.tribeName,
        bonfireLevel: payload.bonfireLevel,
        power: payload.power,
        tileX: payload.tileX,
        tileY: payload.tileY,
        autoAssignIfOccupied: payload.autoAssignIfOccupied ?? true,
      });
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
    try {
      const resp = await postSettlement({
        uid: session.uid,
        tribeName: session.tribeName,
        bonfireLevel: payload.bonfireLevel,
        power: payload.power,
        tileX: payload.tileX,
        tileY: payload.tileY,
        autoAssignIfOccupied: false,
      });
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
      // Fallback if offline so local gameplay still works smoothly
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
    const now = Date.now() + this.serverOffsetMs;
    const marchId = sanitizeId(payload.marchId || `m_${now}_${Math.floor(Math.random() * 9999)}`);
    try {
      await postMarch({
        marchId,
        uid: session.uid,
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
      });
    } catch {
      // ignore offline broadcast errors
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
    const messageId = sanitizeId(`msg_${Date.now()}_${Math.floor(Math.random() * 99999)}`);

    try {
      const resp = await postChatMessage({
        messageId,
        uid: session.uid,
        tribeName: session.tribeName,
        bonfireLevel,
        text: clean,
      });
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
    if (!this.firebaseUser) return;
    const uid = this.firebaseUser.uid;
    const runSave = async () => {
      try {
        await saveCloudState(uid, this.tribeName, stateObj, 1);
        this.cloudSynced = true;
        this.lastCloudSaveAt = Date.now();
        this.emitSession();
      } catch (err) {
        console.error('[Cloud Save Fehler]', err);
      }
    };

    if (this.cloudSaveTimer !== null) {
      window.clearTimeout(this.cloudSaveTimer);
      this.cloudSaveTimer = null;
    }

    if (immediate) {
      void runSave();
    } else {
      this.cloudSaveTimer = window.setTimeout(() => {
        this.cloudSaveTimer = null;
        void runSave();
      }, 2500);
    }
  }

  private emitSession(): void {
    this.callbacks.onSessionChange?.(this.getSession());
  }

  private emitWorld(): void {
    const w = this.getWorldData();
    this.callbacks.onWorldUpdate?.({
      settlements: w.settlements,
      marches: w.marches,
      onlinePlayers: w.onlinePlayers,
    });
  }

  private emitChat(): void {
    const w = this.getWorldData();
    this.callbacks.onChatUpdate?.(w.chat);
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
