import type {
  BuildValidationRequest,
  BuildValidationResponse,
  DinoHuntCombatRequest,
  DinoHuntCombatResponse,
  GuestAuthResponse,
  MigrateGuestResponse,
  PlayerSaveDTO,
  RealtimeEvent,
  TeleportRequest,
  TeleportResponse,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldStateResponse,
} from '../shared/apiTypes';

async function fetchJson<T>(url: string, init?: RequestInit, bearerToken?: string | null): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string> | undefined) || {}),
    };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const data = (await res.json()) as T;
    if (!res.ok && res.status !== 409) {
      throw new Error(`API ${url} fehlgeschlagen (${res.status})`);
    }
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchServerHealth(): Promise<{
  ok: boolean;
  firebaseProjectLinked: boolean;
  persistentStoreActive: boolean;
  serverTimeMs: number;
  onlinePlayers: number;
  settlementsCount: number;
  savesCount: number;
}> {
  return fetchJson('/api/v1/health');
}

export async function fetchPublicGameConfig(): Promise<{
  serverTimeMs: number;
  config: Record<string, unknown>;
}> {
  return fetchJson('/api/v1/config');
}

export async function postAuthGuest(existingGuestUid?: string): Promise<GuestAuthResponse> {
  return fetchJson('/api/v1/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ existingGuestUid }),
  });
}

export async function fetchServerPlayerSave(bearerToken: string): Promise<{
  ok: boolean;
  uid: string;
  provider: 'firebase' | 'guest';
  save: PlayerSaveDTO | null;
  serverTimeMs: number;
}> {
  return fetchJson('/api/v1/player/save', { method: 'GET' }, bearerToken);
}

export async function postServerPlayerSave(
  bearerToken: string,
  payload: {
    schemaVersion: number;
    tribeName: string;
    state: Record<string, unknown>;
  }
): Promise<{ ok: boolean; uid: string; updatedAt: number; serverTimeMs: number }> {
  return fetchJson(
    '/api/v1/player/save',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    bearerToken
  );
}

export async function postMigrateGuest(
  firebaseIdToken: string,
  guestToken: string
): Promise<MigrateGuestResponse> {
  return fetchJson(
    '/api/v1/world/migrate-guest',
    {
      method: 'POST',
      body: JSON.stringify({ guestToken }),
    },
    firebaseIdToken
  );
}

export async function fetchWorldState(): Promise<WorldStateResponse> {
  return fetchJson('/api/v1/world/state');
}

export async function postValidateBuild(
  req: BuildValidationRequest
): Promise<BuildValidationResponse> {
  return fetchJson('/api/v1/economy/validate-build', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function postDinoHuntCombat(
  req: DinoHuntCombatRequest
): Promise<DinoHuntCombatResponse> {
  return fetchJson('/api/v1/combat/dino-hunt', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function postSettlement(
  req: Omit<TeleportRequest, 'uid'> & { uid?: string; autoAssignIfOccupied?: boolean },
  bearerToken: string
): Promise<TeleportResponse> {
  return fetchJson(
    '/api/v1/world/settlement',
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    bearerToken
  );
}

export async function postMarch(
  march: Partial<WorldMarchDTO>,
  bearerToken: string
): Promise<{ ok: boolean; march?: WorldMarchDTO; serverTimeMs: number }> {
  return fetchJson(
    '/api/v1/world/march',
    {
      method: 'POST',
      body: JSON.stringify(march),
    },
    bearerToken
  );
}

export async function postChatMessage(
  payload: {
    messageId?: string;
    tribeName: string;
    bonfireLevel: number;
    text: string;
  },
  bearerToken: string
): Promise<{ ok: boolean; message?: WorldChatMessageDTO; serverTimeMs: number }> {
  return fetchJson(
    '/api/v1/chat',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    bearerToken
  );
}

export interface SocketDebugEvent {
  phase: 'connecting' | 'open' | 'close' | 'error';
  url: string;
  code?: number;
  reason?: string;
  attempt: number;
}

export class GameRealtimeSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private closedByClient = false;
  private attempt = 0;
  private onEvent: (ev: RealtimeEvent) => void;
  private onStatusChange: (connected: boolean) => void;
  private onDebug?: (info: SocketDebugEvent) => void;

  constructor(
    onEvent: (ev: RealtimeEvent) => void,
    onStatusChange: (connected: boolean) => void,
    onDebug?: (info: SocketDebugEvent) => void
  ) {
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange;
    this.onDebug = onDebug;
  }

  connect(): void {
    this.closedByClient = false;
    this.openSocket();
  }

  disconnect(): void {
    this.closedByClient = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private openSocket(): void {
    if (this.closedByClient) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    try {
      this.onDebug?.({ phase: 'connecting', url: wsUrl, attempt: this.attempt });
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.attempt = 0;
        this.onDebug?.({ phase: 'open', url: wsUrl, attempt: 0 });
        this.onStatusChange(true);
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as RealtimeEvent;
          if (parsed && typeof parsed.type === 'string') {
            this.onEvent(parsed);
          }
        } catch {
          // ignore malformed messages
        }
      };

      socket.onclose = (ev) => {
        this.ws = null;
        this.onDebug?.({
          phase: 'close',
          url: wsUrl,
          code: ev.code,
          reason: ev.reason || undefined,
          attempt: this.attempt,
        });
        this.onStatusChange(false);
        if (!this.closedByClient) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        this.onDebug?.({ phase: 'error', url: wsUrl, attempt: this.attempt });
        this.onStatusChange(false);
      };
    } catch {
      this.onDebug?.({ phase: 'error', url: wsUrl, attempt: this.attempt });
      this.onStatusChange(false);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(15000, 1200 * Math.pow(1.6, this.attempt));
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}
