/**
 * Dinosaur Survival (Glut & Basalt) — Zentraler Spielserver (Node.js + Express + WebSockets)
 * Einheitliche, dokumentierte API (/api/v1/...) für Web-Client (React/Three.js) und späteren Unity-Client.
 * Verbindet kryptographisch geprüfte Firebase Auth ID-Tokens, signierte Gast-Sessions,
 * dauerhafte Welt-Speicherung und Echtzeit-WebSockets auf Port 3000.
 */

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  BuildValidationRequest,
  DinoHuntCombatRequest,
  RealtimeEvent,
  TeleportRequest,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
} from './src/shared/apiTypes.js';
import { getPublicGameConfig } from './src/shared/gameConfig.js';
import {
  createStaticWorldGrid,
  findFree2x2Spot,
  getChunkKey,
  resolveAuthoritativeDinoHunt,
  validateBuildingUpgrade,
  validateSettlementPlacement2x2,
} from './src/shared/gameEngine.js';
import {
  FIREBASE_PROJECT_ID,
  issueGuestSessionToken,
  verifyBearerHeader,
  verifyGuestSessionToken,
} from './src/server/firebaseTokenVerifier.js';
import { PersistentWorldStore } from './src/server/worldStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

// Dauerhafter, autoritativer Multiplayer-Weltzustand (überlebt Server-Neustarts)
const staticWorldGrid = createStaticWorldGrid();
const worldStore = new PersistentWorldStore();

function sanitizeText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function isValidId(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length >= 2 &&
    raw.length <= 128 &&
    /^[a-zA-Z0-9_\-]+$/.test(raw)
  );
}

process.on('SIGTERM', () => {
  worldStore.flushSync();
  process.exit(0);
});

process.on('SIGINT', () => {
  worldStore.flushSync();
  process.exit(0);
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  function getOnlineCount(): number {
    let count = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) count++;
    });
    return Math.max(1, count);
  }

  function broadcast(event: RealtimeEvent) {
    const raw = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    });
  }

  function buildWorldSnapshot() {
    const nowMs = Date.now();
    worldStore.pruneExpiredMarches(nowMs);
    return {
      serverTimeMs: nowMs,
      onlinePlayers: getOnlineCount(),
      settlements: Array.from(worldStore.settlements.values()),
      marches: Array.from(worldStore.activeMarches.values()),
      chat: worldStore.chatHistory.slice(-60),
    };
  }

  wss.on('connection', (ws) => {
    const initEvent: RealtimeEvent = { type: 'world:init', payload: buildWorldSnapshot() };
    ws.send(JSON.stringify(initEvent));
    broadcast({
      type: 'world:presence',
      payload: { onlinePlayers: getOnlineCount(), serverTimeMs: Date.now() },
    });

    ws.on('close', () => {
      broadcast({
        type: 'world:presence',
        payload: { onlinePlayers: getOnlineCount(), serverTimeMs: Date.now() },
      });
    });
  });

  // ==================== DOKUMENTIERTE SPIEL-API (/api/v1/...) ====================

  // 1. Server-Status & autoritative Server-Uhr
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'dinosaur-survival-server',
      apiVersion: 'v1',
      firebaseProjectLinked: Boolean(FIREBASE_PROJECT_ID),
      persistentStoreActive: true,
      serverTimeMs: Date.now(),
      onlinePlayers: getOnlineCount(),
      settlementsCount: worldStore.settlements.size,
      savesCount: worldStore.playerSaves.size,
    });
  });

  // 2. Zentrale Spielkonfiguration (Single Source of Truth für Browser & Unity)
  app.get('/api/v1/config', (_req, res) => {
    res.json({
      serverTimeMs: Date.now(),
      config: getPublicGameConfig(),
    });
  });

  // 3. Signierte Gast-Sitzung anfordern (sofort online spielbar ohne Account-Zwang)
  app.post('/api/v1/auth/guest', (req, res) => {
    const body = (req.body || {}) as { existingGuestUid?: string };
    const issued = issueGuestSessionToken(body.existingGuestUid);
    res.json({
      ok: true,
      uid: issued.uid,
      token: issued.token,
      expiresAtMs: issued.expiresAtMs,
      serverTimeMs: Date.now(),
    });
  });

  // 4. Serverseitiger Spielstand (Lesen & Speichern — geschützt durch Firebase ID-Token oder Gast-Token)
  app.get('/api/v1/player/save', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Authentifizierung erforderlich.' });
      return;
    }
    const save = worldStore.getPlayerSave(identity.uid);
    res.json({
      ok: true,
      uid: identity.uid,
      provider: identity.provider,
      save,
      serverTimeMs: Date.now(),
    });
  });

  app.post('/api/v1/player/save', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Authentifizierung erforderlich.' });
      return;
    }
    const body = (req.body || {}) as {
      schemaVersion?: number;
      tribeName?: string;
      state?: unknown;
    };
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
      res.status(400).json({ ok: false, error: 'Ungültiger Spielstand.' });
      return;
    }
    const schemaVersion = Math.max(1, Math.min(50, Math.floor(Number(body.schemaVersion || 1))));
    const tribeName = sanitizeText(body.tribeName || 'Glutstamm', 28) || 'Glutstamm';
    const nowMs = Date.now();
    const record = {
      uid: identity.uid,
      schemaVersion,
      tribeName,
      state: body.state as Record<string, unknown>,
      updatedAt: nowMs,
    };
    worldStore.upsertPlayerSave(record);
    res.json({
      ok: true,
      uid: identity.uid,
      updatedAt: nowMs,
      serverTimeMs: nowMs,
    });
  });

  // 5. Gast-Siedlung & Spielstand atomar auf verifiziertes Google/Firebase-Konto übertragen
  app.post('/api/v1/world/migrate-guest', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity || identity.provider !== 'firebase') {
      res.status(401).json({ ok: false, error: 'Verifiziertes Firebase-Konto erforderlich.' });
      return;
    }
    const body = (req.body || {}) as { guestToken?: string };
    const guestIdentity =
      typeof body.guestToken === 'string' ? verifyGuestSessionToken(body.guestToken) : null;
    if (!guestIdentity) {
      res.json({
        ok: true,
        removedGuestUid: null,
        settlement: worldStore.settlements.get(identity.uid) || null,
        serverTimeMs: Date.now(),
      });
      return;
    }

    const migrated = worldStore.migrateGuestToVerifiedUid(guestIdentity.uid, identity.uid);
    if (migrated.removedGuestUid) {
      broadcast({ type: 'world:settlement_removed', payload: { uid: migrated.removedGuestUid } });
    }
    if (migrated.migratedSettlement) {
      broadcast({ type: 'world:settlement', payload: migrated.migratedSettlement });
    }
    res.json({
      ok: true,
      removedGuestUid: migrated.removedGuestUid,
      settlement: migrated.migratedSettlement || worldStore.settlements.get(identity.uid) || null,
      serverTimeMs: Date.now(),
    });
  });

  // 6. Serverseitige Bauzeit- & Kostenprüfung
  app.post('/api/v1/economy/validate-build', (req, res) => {
    const body = req.body as Partial<BuildValidationRequest>;
    if (!body || typeof body.buildingId !== 'string' || typeof body.currentLevel !== 'number') {
      res.status(400).json({ ok: false, error: 'Ungültige Bauanfrage.' });
      return;
    }
    const result = validateBuildingUpgrade(
      {
        buildingId: body.buildingId,
        currentLevel: body.currentLevel,
        bonfireLevel: Number(body.bonfireLevel || 1),
        resources: body.resources || { meat: 0, wood: 0, stone: 0, fur: 0 },
        techBuildSpeedBonus: Number(body.techBuildSpeedBonus || 0),
      },
      Date.now()
    );
    res.json(result);
  });

  // 7. Serverseitige Dino-Jagd Kampfberechnung (Anti-Cheat, Runden-Log + Beute)
  app.post('/api/v1/combat/dino-hunt', (req, res) => {
    const body = req.body as Partial<DinoHuntCombatRequest>;
    if (!body || typeof body.speciesId !== 'string' || typeof body.squadPower !== 'number') {
      res.status(400).json({ ok: false, error: 'Ungültige Kampfanfrage.' });
      return;
    }
    const result = resolveAuthoritativeDinoHunt(
      {
        dinoId: sanitizeText(body.dinoId || 'dino_unknown', 64),
        speciesId: sanitizeText(body.speciesId, 32),
        dinoLevel: Number(body.dinoLevel || 1),
        squadPower: Number(body.squadPower || 1),
        heroes: Array.isArray(body.heroes) ? body.heroes.slice(0, 3) : [],
        troops: body.troops || { slinger: 0, clubman: 0, dinorider: 0 },
      },
      Date.now()
    );
    res.json(result);
  });

  // 8. Gemeinsamer Multiplayer-Weltkarten-Zustand
  app.get('/api/v1/world/state', (_req, res) => {
    res.json(buildWorldSnapshot());
  });

  // 9. Spielerdorf auf der gemeinsamen 48x27-Weltkarte registrieren oder atomar teleportieren
  app.post('/api/v1/world/settlement', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res
        .status(401)
        .json({ ok: false, reason: 'Sitzungstoken erforderlich.', serverTimeMs: Date.now() });
      return;
    }

    const body = (req.body || {}) as Partial<TeleportRequest> & { autoAssignIfOccupied?: boolean };
    const verifiedUid = identity.uid;
    const tribeName = sanitizeText(body.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm';
    const bonfireLevel = Math.max(1, Math.min(25, Math.floor(Number(body.bonfireLevel || 1))));
    const power = Math.max(0, Math.min(100_000_000, Math.floor(Number(body.power || 0))));
    let tileX = Math.floor(Number(body.tileX ?? 10));
    let tileY = Math.floor(Number(body.tileY ?? 20));

    const check = validateSettlementPlacement2x2(
      staticWorldGrid,
      worldStore.settlements.values(),
      verifiedUid,
      tileX,
      tileY
    );
    if (!check.valid) {
      if (body.autoAssignIfOccupied) {
        const spot = findFree2x2Spot(
          staticWorldGrid,
          worldStore.settlements.values(),
          verifiedUid,
          tileX,
          tileY
        );
        tileX = spot.tileX;
        tileY = spot.tileY;
      } else {
        res.status(409).json({ ok: false, reason: check.reason, serverTimeMs: Date.now() });
        return;
      }
    }

    const dto: WorldSettlementDTO = {
      uid: verifiedUid,
      tribeName,
      bonfireLevel,
      power,
      tileX,
      tileY,
      chunkKey: getChunkKey(tileX, tileY),
      updatedAt: Date.now(),
    };
    worldStore.upsertSettlement(dto);
    broadcast({ type: 'world:settlement', payload: dto });
    res.json({ ok: true, settlement: dto, serverTimeMs: dto.updatedAt });
  });

  // 10. Aktiven Marsch für alle Spieler auf der Weltkarte sichtbar machen / beenden
  app.post('/api/v1/world/march', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }
    const body = (req.body || {}) as Partial<WorldMarchDTO>;
    if (!isValidId(body.marchId)) {
      res.status(400).json({ ok: false, error: 'Ungültige Marsch-ID.' });
      return;
    }
    const existing = worldStore.activeMarches.get(body.marchId);
    if (existing && existing.uid !== identity.uid) {
      res.status(403).json({ ok: false, error: 'Keine Berechtigung für diesen Marsch.' });
      return;
    }

    const nowMs = Date.now();
    const dto: WorldMarchDTO = {
      marchId: body.marchId,
      uid: identity.uid,
      tribeName: sanitizeText(body.tribeName || existing?.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm',
      kind: body.kind === 'hunt' ? 'hunt' : 'gather',
      fromX: Math.max(0, Math.min(100, Number(body.fromX ?? existing?.fromX ?? 0))),
      fromY: Math.max(0, Math.min(100, Number(body.fromY ?? existing?.fromY ?? 0))),
      toX: Math.max(0, Math.min(100, Number(body.toX ?? existing?.toX ?? 0))),
      toY: Math.max(0, Math.min(100, Number(body.toY ?? existing?.toY ?? 0))),
      targetLabel: sanitizeText(body.targetLabel || existing?.targetLabel || 'Ziel', 64) || 'Ziel',
      startedAt: Number(body.startedAt || existing?.startedAt || nowMs),
      endsAt: Number(body.endsAt || existing?.endsAt || nowMs + 15000),
      status: body.status === 'completed' ? 'completed' : 'active',
    };
    worldStore.upsertMarch(dto);
    broadcast({ type: 'world:march', payload: dto });
    res.json({ ok: true, march: dto, serverTimeMs: nowMs });
  });

  // 11. Globaler Welt-Chat (Lesen & authentifiziertes Senden)
  app.get('/api/v1/chat', (_req, res) => {
    res.json({ serverTimeMs: Date.now(), messages: worldStore.chatHistory.slice(-60) });
  });

  app.post('/api/v1/chat', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }
    const body = (req.body || {}) as Partial<WorldChatMessageDTO>;
    const text = sanitizeText(body.text, 240);
    if (!text) {
      res.status(400).json({ ok: false, error: 'Nachricht darf nicht leer sein.' });
      return;
    }
    const nowMs = Date.now();
    const msg: WorldChatMessageDTO = {
      messageId: isValidId(body.messageId)
        ? body.messageId
        : `msg_${nowMs}_${Math.floor(Math.random() * 9999)}`,
      uid: identity.uid,
      tribeName: sanitizeText(body.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm',
      bonfireLevel: Math.max(1, Math.min(25, Math.floor(Number(body.bonfireLevel || 1)))),
      text,
      channel: 'world',
      createdAt: nowMs,
    };
    worldStore.appendChat(msg);
    broadcast({ type: 'chat:message', payload: msg });
    res.json({ ok: true, message: msg, serverTimeMs: nowMs });
  });

  // ==================== FRONTEND AUSLIEFERUNG (VITE DEV ODER PROD DIST) ====================
  if (!isProd) {
    process.env.DISABLE_HMR = 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });

    // Im Preview-Modus (HMR deaktiviert) verhindert dieser leichtgewichtige @vite/client-Stub
    // fehlerhafte WebSocket-Verbindungsversuche zu Port 24678, während CSS-Imports weiter funktionieren.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {}
  };
}
export function injectQuery(url) { return url; }
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Dinosaur Survival Server] Läuft auf http://0.0.0.0:${PORT} (API v1 + WebSocket /ws + Persistent Store)`
    );
  });
}

startServer().catch((err) => {
  console.error('[Server Start Error]', err);
  process.exit(1);
});
