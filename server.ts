/**
 * Dinosaur Survival (Glut & Basalt) — Zentraler Spielserver (Node.js + Express + WebSockets)
 * Einheitliche, dokumentierte API (/api/v1/...) für Web-Client (React/Three.js) und späteren Unity-Client.
 * Läuft auf Port 3000 (Entwicklung mit Vite-Middleware, Produktion mit statischem dist/-Build auf Cloud Run).
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
  WorldSettlementDTO
} from './src/shared/apiTypes.js';
import { getPublicGameConfig } from './src/shared/gameConfig.js';
import {
  createStaticWorldGrid,
  findFree2x2Spot,
  getChunkKey,
  resolveAuthoritativeDinoHunt,
  validateBuildingUpgrade,
  validateSettlementPlacement2x2
} from './src/shared/gameEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

// Serverseitiger, autoritativer Multiplayer-Weltzustand (in Cloud Run später zusätzlich via Firestore/RTDB gespiegelt)
const staticWorldGrid = createStaticWorldGrid();
const settlements = new Map<string, WorldSettlementDTO>();
const activeMarches = new Map<string, WorldMarchDTO>();
const chatHistory: WorldChatMessageDTO[] = [];

// Initiale Begrüßungsnachricht im Welt-Chat
chatHistory.push({
  messageId: 'sys_welcome_1',
  uid: 'system_caldera',
  tribeName: 'Caldera-Chronik',
  bonfireLevel: 25,
  text: 'Willkommen in der gemeinsamen Dinosaurierwelt! Baue dein Signalfeuer aus, jage wilde Saurier und tausche dich hier mit anderen Stämmen aus.',
  channel: 'world',
  createdAt: Date.now()
});

function sanitizeText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function isValidUid(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 2 && raw.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(raw);
}

function pruneExpiredMarches(nowMs: number) {
  for (const [id, m] of activeMarches.entries()) {
    if (m.endsAt + 15000 < nowMs) {
      activeMarches.delete(id);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

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
    pruneExpiredMarches(nowMs);
    return {
      serverTimeMs: nowMs,
      onlinePlayers: getOnlineCount(),
      settlements: Array.from(settlements.values()),
      marches: Array.from(activeMarches.values()),
      chat: chatHistory.slice(-60)
    };
  }

  wss.on('connection', (ws) => {
    // Initialen Weltzustand senden
    const initEvent: RealtimeEvent = { type: 'world:init', payload: buildWorldSnapshot() };
    ws.send(JSON.stringify(initEvent));
    broadcast({ type: 'world:presence', payload: { onlinePlayers: getOnlineCount(), serverTimeMs: Date.now() } });

    ws.on('close', () => {
      broadcast({ type: 'world:presence', payload: { onlinePlayers: getOnlineCount(), serverTimeMs: Date.now() } });
    });
  });

  // ==================== DOKUMENTIERTE SPIEL-API (/api/v1/...) ====================

  // 1. Server-Status & autoritative Server-Uhr (für Web & Unity Zeit-Synchronisation)
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'dinosaur-survival-server',
      apiVersion: 'v1',
      serverTimeMs: Date.now(),
      onlinePlayers: getOnlineCount(),
      settlementsCount: settlements.size
    });
  });

  // 2. Zentrale Spielkonfiguration (Single Source of Truth für Browser & Unity)
  app.get('/api/v1/config', (_req, res) => {
    res.json({
      serverTimeMs: Date.now(),
      config: getPublicGameConfig()
    });
  });

  // 3. Serverseitige Bauzeit- & Kostenprüfung
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
        techBuildSpeedBonus: Number(body.techBuildSpeedBonus || 0)
      },
      Date.now()
    );
    res.json(result);
  });

  // 4. Serverseitige Dino-Jagd Kampfberechnung (Anti-Cheat, Runden-Log + Beute)
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
        troops: body.troops || { slinger: 0, clubman: 0, dinorider: 0 }
      },
      Date.now()
    );
    res.json(result);
  });

  // 5. Gemeinsamer Multiplayer-Weltkarten-Zustand
  app.get('/api/v1/world/state', (_req, res) => {
    res.json(buildWorldSnapshot());
  });

  // 6. Spielerdorf auf der gemeinsamen 48x27-Weltkarte registrieren oder atomar teleportieren
  app.post('/api/v1/world/settlement', (req, res) => {
    const body = req.body as Partial<TeleportRequest> & { autoAssignIfOccupied?: boolean };
    if (!isValidUid(body?.uid)) {
      res.status(400).json({ ok: false, reason: 'Ungültige Spieler-ID.', serverTimeMs: Date.now() });
      return;
    }
    const tribeName = sanitizeText(body.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm';
    const bonfireLevel = Math.max(1, Math.min(25, Math.floor(Number(body.bonfireLevel || 1))));
    const power = Math.max(0, Math.min(100_000_000, Math.floor(Number(body.power || 0))));
    let tileX = Math.floor(Number(body.tileX ?? 10));
    let tileY = Math.floor(Number(body.tileY ?? 20));

    const check = validateSettlementPlacement2x2(staticWorldGrid, settlements.values(), body.uid, tileX, tileY);
    if (!check.valid) {
      if (body.autoAssignIfOccupied) {
        const spot = findFree2x2Spot(staticWorldGrid, settlements.values(), body.uid, tileX, tileY);
        tileX = spot.tileX;
        tileY = spot.tileY;
      } else {
        res.status(409).json({ ok: false, reason: check.reason, serverTimeMs: Date.now() });
        return;
      }
    }

    const dto: WorldSettlementDTO = {
      uid: body.uid,
      tribeName,
      bonfireLevel,
      power,
      tileX,
      tileY,
      chunkKey: getChunkKey(tileX, tileY),
      updatedAt: Date.now()
    };
    settlements.set(dto.uid, dto);
    broadcast({ type: 'world:settlement', payload: dto });
    res.json({ ok: true, settlement: dto, serverTimeMs: dto.updatedAt });
  });

  // 7. Aktiven Marsch für alle Spieler auf der Weltkarte sichtbar machen
  app.post('/api/v1/world/march', (req, res) => {
    const body = req.body as Partial<WorldMarchDTO>;
    if (!isValidUid(body?.uid) || !isValidUid(body?.marchId)) {
      res.status(400).json({ ok: false, error: 'Ungültige Marsch-Daten.' });
      return;
    }
    const nowMs = Date.now();
    const dto: WorldMarchDTO = {
      marchId: body.marchId,
      uid: body.uid,
      tribeName: sanitizeText(body.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm',
      kind: body.kind === 'hunt' ? 'hunt' : 'gather',
      fromX: Math.max(0, Math.min(100, Number(body.fromX || 0))),
      fromY: Math.max(0, Math.min(100, Number(body.fromY || 0))),
      toX: Math.max(0, Math.min(100, Number(body.toX || 0))),
      toY: Math.max(0, Math.min(100, Number(body.toY || 0))),
      targetLabel: sanitizeText(body.targetLabel || 'Ziel', 64) || 'Ziel',
      startedAt: Number(body.startedAt || nowMs),
      endsAt: Number(body.endsAt || nowMs + 15000),
      status: body.status === 'completed' ? 'completed' : 'active'
    };
    activeMarches.set(dto.marchId, dto);
    broadcast({ type: 'world:march', payload: dto });
    res.json({ ok: true, march: dto, serverTimeMs: nowMs });
  });

  // 8. Globaler Welt-Chat (Lesen & Senden)
  app.get('/api/v1/chat', (_req, res) => {
    res.json({ serverTimeMs: Date.now(), messages: chatHistory.slice(-60) });
  });

  app.post('/api/v1/chat', (req, res) => {
    const body = req.body as Partial<WorldChatMessageDTO>;
    if (!isValidUid(body?.uid)) {
      res.status(400).json({ ok: false, error: 'Ungültige Spieler-ID.' });
      return;
    }
    const text = sanitizeText(body.text, 240);
    if (!text) {
      res.status(400).json({ ok: false, error: 'Nachricht darf nicht leer sein.' });
      return;
    }
    const nowMs = Date.now();
    const msg: WorldChatMessageDTO = {
      messageId: isValidUid(body.messageId) ? body.messageId : `msg_${nowMs}_${Math.floor(Math.random() * 9999)}`,
      uid: body.uid,
      tribeName: sanitizeText(body.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm',
      bonfireLevel: Math.max(1, Math.min(25, Math.floor(Number(body.bonfireLevel || 1)))),
      text,
      channel: 'world',
      createdAt: nowMs
    };
    if (!chatHistory.some((m) => m.messageId === msg.messageId)) {
      chatHistory.push(msg);
      if (chatHistory.length > 100) chatHistory.shift();
    }
    broadcast({ type: 'chat:message', payload: msg });
    res.json({ ok: true, message: msg, serverTimeMs: nowMs });
  });

  // ==================== FRONTEND AUSLIEFERUNG (VITE DEV ODER PROD DIST) ====================
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
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
    console.log(`[Dinosaur Survival Server] Läuft auf http://0.0.0.0:${PORT} (API v1 + WebSocket /ws)`);
  });
}

startServer().catch((err) => {
  console.error('[Server Start Error]', err);
  process.exit(1);
});
