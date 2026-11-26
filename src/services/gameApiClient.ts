import type {
  BuildValidationRequest,
  BuildValidationResponse,
  DinoHuntCombatRequest,
  DinoHuntCombatResponse,
  RealtimeEvent,
  TeleportRequest,
  TeleportResponse,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldStateResponse,
} from '../shared/apiTypes';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
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
  serverTimeMs: number;
  onlinePlayers: number;
  settlementsCount: number;
}> {
  return fetchJson('/api/v1/health');
}

export async function fetchPublicGameConfig(): Promise<{
  serverTimeMs: number;
  config: Record<string, unknown>;
}> {
  return fetchJson('/api/v1/config');
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
  req: TeleportRequest & { autoAssignIfOccupied?: boolean }
): Promise<TeleportResponse> {
  return fetchJson('/api/v1/world/settlement', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function postMarch(
  march: Partial<WorldMarchDTO>
): Promise<{ ok: boolean; march?: WorldMarchDTO; serverTimeMs: number }> {
  return fetchJson('/api/v1/world/march', {
    method: 'POST',
    body: JSON.stringify(march),
  });
}

export async function postChatMessage(payload: {
  messageId?: string;
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  text: string;
}): Promise<{ ok: boolean; message?: WorldChatMessageDTO; serverTimeMs: number }> {
  return fetchJson('/api/v1/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export class GameRealtimeSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private closedByClient = false;
  private attempt = 0;
  private onEvent: (ev: RealtimeEvent) => void;
  private onStatusChange: (connected: boolean) => void;

  constructor(
    onEvent: (ev: RealtimeEvent) => void,
    onStatusChange: (connected: boolean) => void
  ) {
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange;
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
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.attempt = 0;
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

      socket.onclose = () => {
        this.ws = null;
        this.onStatusChange(false);
        if (!this.closedByClient) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        this.onStatusChange(false);
      };
    } catch {
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
