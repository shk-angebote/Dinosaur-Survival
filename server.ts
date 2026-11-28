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
  NodeOccupyRequest,
  RealtimeEvent,
  ResourceKey,
  TeleportRequest,
  VolcanoAttackRequest,
  WorldChatMessageDTO,
  WorldDynamicSpawnDTO,
  WorldMarchDTO,
  WorldNodeContestResultDTO,
  WorldNodeOccupantDTO,
  WorldSettlementDTO,
  WorldTradeDTO,
  WorldVolcanoBattleLogDTO,
} from './src/shared/apiTypes.ts';
import { getPublicGameConfig } from './src/shared/gameConfig.ts';
import {
  createStaticWorldGrid,
  findFree2x2Spot,
  getChunkKey,
  resolveAuthoritativeDinoHunt,
  validateBuildingUpgrade,
  validateSettlementPlacement2x2,
} from './src/shared/gameEngine.ts';
import {
  FIREBASE_PROJECT_ID,
  issueGuestSessionToken,
  verifyBearerHeader,
  verifyGuestSessionToken,
} from './src/server/firebaseTokenVerifier.ts';
import { PersistentWorldStore, VOLCANO_GUARDIAN_POWER } from './src/server/worldStore.ts';

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
    const volcanoSync = worldStore.syncVolcanoCycle(nowMs);
    return {
      serverTimeMs: nowMs,
      onlinePlayers: getOnlineCount(),
      settlements: Array.from(worldStore.settlements.values()),
      marches: Array.from(worldStore.activeMarches.values()),
      chat: worldStore.chatHistory.slice(-60),
      trades: worldStore.getRecentTrades(),
      nodeOccupants: Array.from(worldStore.nodeOccupants.values()),
      dynamicSpawns: Array.from(worldStore.dynamicSpawns.values()),
      volcano: volcanoSync.state,
    };
  }

  // Automatische 4-Wochen-Zyklus-Überwachung für die zentrale Vulkan-Zitadelle
  setInterval(() => {
    const nowMs = Date.now();
    const synced = worldStore.syncVolcanoCycle(nowMs);
    if (synced.changed) {
      broadcast({ type: 'world:volcano', payload: synced.state });
      if (synced.announcement) {
        const sysMsg: WorldChatMessageDTO = {
          messageId: `sys_volcano_${nowMs}_${Math.floor(Math.random() * 999)}`,
          uid: 'system_caldera',
          tribeName: 'Caldera-Chronik',
          bonfireLevel: 25,
          text: synced.announcement,
          channel: 'world',
          createdAt: nowMs,
        };
        worldStore.appendChat(sysMsg);
        broadcast({ type: 'chat:message', payload: sysMsg });
      }
    }
  }, 15000);

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

  // 9. Spielerdorf auf der gemeinsamen 1200x1200-Weltkarte registrieren oder atomar teleportieren
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
    let tileX = Math.floor(Number(body.tileX ?? 240));
    let tileY = Math.floor(Number(body.tileY ?? 940));

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
      kind: body.kind === 'hunt' ? 'hunt' : body.kind === 'volcano' ? 'volcano' : 'gather',
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

  // 12. Zweiseitiger Ressourcen-Handel (Beide Teilnehmer müssen bestätigen)
  const VALID_TRADE_RESOURCES: ReadonlySet<string> = new Set(['meat', 'wood', 'stone', 'fur']);

  app.post('/api/v1/world/trade/propose', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }
    const body = (req.body || {}) as Partial<WorldTradeDTO>;
    const toUid = typeof body.toUid === 'string' ? body.toUid.trim() : '';
    if (!isValidId(toUid) || toUid === identity.uid) {
      res.status(400).json({ ok: false, error: 'Ungültiger Handelspartner.' });
      return;
    }
    if (
      typeof body.offerResource !== 'string' ||
      typeof body.requestResource !== 'string' ||
      !VALID_TRADE_RESOURCES.has(body.offerResource) ||
      !VALID_TRADE_RESOURCES.has(body.requestResource) ||
      body.offerResource === body.requestResource
    ) {
      res.status(400).json({ ok: false, error: 'Ungültige Ressourcenauswahl.' });
      return;
    }
    const offerAmount = Math.floor(Number(body.offerAmount || 0));
    const requestAmount = Math.floor(Number(body.requestAmount || 0));
    if (
      !Number.isFinite(offerAmount) ||
      !Number.isFinite(requestAmount) ||
      offerAmount < 1 ||
      offerAmount > 5000 ||
      requestAmount < 1 ||
      requestAmount > 5000
    ) {
      res.status(400).json({ ok: false, error: 'Ungültige Handelsmenge (1–5000).' });
      return;
    }

    const nowMs = Date.now();
    const tradeId = isValidId(body.tradeId)
      ? body.tradeId.slice(0, 96)
      : `trd_${nowMs}_${Math.floor(Math.random() * 99999)}`;

    if (worldStore.trades.has(tradeId)) {
      res.status(409).json({ ok: false, error: 'Tausch-ID existiert bereits.' });
      return;
    }

    const fromTribeName =
      sanitizeText(
        body.fromTribeName || worldStore.settlements.get(identity.uid)?.tribeName || 'Urzeit-Stamm',
        28
      ) || 'Urzeit-Stamm';
    const toTribeName =
      sanitizeText(
        body.toTribeName || worldStore.settlements.get(toUid)?.tribeName || 'Nachbar-Stamm',
        28
      ) || 'Nachbar-Stamm';

    const trade: WorldTradeDTO = {
      tradeId,
      fromUid: identity.uid,
      fromTribeName,
      toUid,
      toTribeName,
      offerResource: body.offerResource as ResourceKey,
      offerAmount,
      requestResource: body.requestResource as ResourceKey,
      requestAmount,
      fromConfirmed: false,
      toConfirmed: false,
      status: 'pending',
      createdAt: nowMs,
      updatedAt: nowMs,
    };

    worldStore.upsertTrade(trade);
    broadcast({ type: 'world:trade', payload: trade });
    res.json({ ok: true, trade, serverTimeMs: nowMs });
  });

  app.post('/api/v1/world/trade/respond', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }
    const body = (req.body || {}) as { tradeId?: string; action?: string };
    if (!isValidId(body.tradeId) || (body.action !== 'confirm' && body.action !== 'cancel')) {
      res.status(400).json({ ok: false, error: 'Ungültige Tausch-Antwort.' });
      return;
    }
    const existing = worldStore.trades.get(body.tradeId);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Tauschangebot nicht gefunden.' });
      return;
    }
    const isSender = existing.fromUid === identity.uid;
    const isRecipient = existing.toUid === identity.uid;
    if (!isSender && !isRecipient) {
      res.status(403).json({ ok: false, error: 'Keine Berechtigung für dieses Tauschangebot.' });
      return;
    }
    if (existing.status !== 'pending') {
      res.status(409).json({
        ok: false,
        error: 'Dieser Tausch ist bereits abgeschlossen oder abgebrochen.',
        trade: existing,
      });
      return;
    }

    const nowMs = Date.now();
    let updated: WorldTradeDTO;
    if (body.action === 'cancel') {
      updated = {
        ...existing,
        status: 'cancelled',
        updatedAt: nowMs,
      };
    } else {
      const nextFromConfirmed = isSender ? true : existing.fromConfirmed;
      const nextToConfirmed = isRecipient ? true : existing.toConfirmed;
      const bothConfirmed = nextFromConfirmed && nextToConfirmed;
      updated = {
        ...existing,
        fromConfirmed: nextFromConfirmed,
        toConfirmed: nextToConfirmed,
        status: bothConfirmed ? 'completed' : 'pending',
        updatedAt: nowMs,
      };
    }

    worldStore.upsertTrade(updated);
    broadcast({ type: 'world:trade', payload: updated });
    res.json({ ok: true, trade: updated, serverTimeMs: nowMs });
  });

  // 13. Sammelstelle besetzen oder besetzte Sammelstelle per PvP angreifen & erobern
  app.post('/api/v1/world/node/occupy', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, occupied: false, occupant: null, error: 'Sitzungstoken erforderlich.', serverTimeMs: Date.now() });
      return;
    }
    const body = (req.body || {}) as Partial<NodeOccupyRequest>;
    if (!isValidId(body.nodeId) || !isValidId(body.marchId)) {
      res.status(400).json({ ok: false, occupied: false, occupant: null, error: 'Ungültige Sammelstellen- oder Marsch-ID.', serverTimeMs: Date.now() });
      return;
    }

    const nowMs = Date.now();
    worldStore.pruneExpiredMarches(nowMs);

    const nodeId = body.nodeId;
    const nodeName = sanitizeText(body.nodeName || nodeId, 64) || nodeId;
    const tribeName = sanitizeText(body.tribeName || 'Urzeit-Stamm', 28) || 'Urzeit-Stamm';
    const resource: ResourceKey =
      body.resource === 'meat' || body.resource === 'stone' || body.resource === 'fur' ? body.resource : 'wood';
    const squadPower = Math.max(10, Math.min(100_000_000, Math.floor(Number(body.squadPower || 50))));
    const gatherSec = Math.max(8, Math.min(1800, Math.floor(Number(body.gatherSec || 45))));
    const targetAmount = Math.max(1, Math.min(10000, Math.floor(Number(body.targetAmount || 50))));
    const heroIds = Array.isArray(body.heroIds)
      ? body.heroIds.filter((h): h is string => typeof h === 'string').slice(0, 3)
      : [];
    const heroNames = Array.isArray(body.heroNames)
      ? body.heroNames.map((n) => sanitizeText(n, 28)).filter(Boolean).slice(0, 3)
      : [];
    const troops = {
      slinger: Math.max(0, Math.floor(Number(body.troops?.slinger || 0))),
      clubman: Math.max(0, Math.floor(Number(body.troops?.clubman || 0))),
      dinorider: Math.max(0, Math.floor(Number(body.troops?.dinorider || 0))),
    };

    const existing = worldStore.nodeOccupants.get(nodeId);
    const attackerOccupant: WorldNodeOccupantDTO = {
      nodeId,
      uid: identity.uid,
      tribeName,
      marchId: body.marchId,
      squadPower,
      heroIds,
      heroNames,
      troops,
      startedAt: nowMs,
      endsAt: nowMs + gatherSec * 1000,
      targetAmount,
      resource,
    };

    // Frei oder eigener Stamm → direkt besetzen
    if (!existing || existing.uid === identity.uid || existing.endsAt <= nowMs) {
      worldStore.nodeOccupants.set(nodeId, attackerOccupant);
      broadcast({ type: 'world:node_occupant', payload: { nodeId, occupant: attackerOccupant } });
      res.json({ ok: true, occupied: true, occupant: attackerOccupant, serverTimeMs: nowMs });
      return;
    }

    // Besetzt durch anderen Spieler → Serverseitiger PvP-Kampf um die Sammelstelle!
    const defenderPower = Math.max(10, existing.squadPower);
    const attackerRoll = 0.88 + Math.random() * 0.24; // ±12% Glücksfaktor
    const defenderRoll = 0.88 + Math.random() * 0.24;
    const effAtk = squadPower * attackerRoll;
    const effDef = defenderPower * defenderRoll;
    const attackerWon = effAtk >= effDef;

    const powerRatio = attackerWon
      ? squadPower / Math.max(1, defenderPower)
      : defenderPower / Math.max(1, squadPower);
    const winnerLossRate = Math.max(0.05, Math.min(0.18, 0.17 - (powerRatio - 1) * 0.08));
    const loserLossRate = Math.max(0.16, Math.min(0.36, 0.22 + (powerRatio - 1) * 0.1));

    const attackerLossRate = attackerWon ? winnerLossRate : loserLossRate;
    const defenderLossRate = attackerWon ? loserLossRate : winnerLossRate;

    const defDurationMs = Math.max(1000, existing.endsAt - existing.startedAt);
    const defProgress = Math.max(0, Math.min(0.95, (nowMs - existing.startedAt) / defDurationMs));
    const defenderCollectedBeforeEviction = attackerWon
      ? Math.max(0, Math.floor(existing.targetAmount * defProgress))
      : 0;

    const contest: WorldNodeContestResultDTO = {
      contestId: `pvp_${nowMs}_${Math.floor(Math.random() * 9999)}`,
      nodeId,
      nodeName,
      resource,
      attackerUid: identity.uid,
      attackerTribeName: tribeName,
      attackerPower: squadPower,
      defenderUid: existing.uid,
      defenderTribeName: existing.tribeName,
      defenderPower,
      attackerWon,
      attackerLossRate: Number(attackerLossRate.toFixed(3)),
      defenderLossRate: Number(defenderLossRate.toFixed(3)),
      defenderCollectedBeforeEviction,
      timestamp: nowMs,
    };

    let finalOccupant: WorldNodeOccupantDTO;
    if (attackerWon) {
      const remainingAfterDef = Math.max(5, targetAmount - defenderCollectedBeforeEviction);
      const survivedTroops = {
        slinger: Math.max(0, troops.slinger - Math.floor(troops.slinger * attackerLossRate)),
        clubman: Math.max(0, troops.clubman - Math.floor(troops.clubman * attackerLossRate)),
        dinorider: Math.max(0, troops.dinorider - Math.floor(troops.dinorider * attackerLossRate)),
      };
      finalOccupant = {
        ...attackerOccupant,
        squadPower: Math.max(10, Math.round(squadPower * (1 - attackerLossRate * 0.45))),
        troops: survivedTroops,
        targetAmount: remainingAfterDef,
      };
      worldStore.nodeOccupants.set(nodeId, finalOccupant);
    } else {
      const defSurvivedTroops = {
        slinger: Math.max(0, existing.troops.slinger - Math.floor(existing.troops.slinger * defenderLossRate)),
        clubman: Math.max(0, existing.troops.clubman - Math.floor(existing.troops.clubman * defenderLossRate)),
        dinorider: Math.max(0, existing.troops.dinorider - Math.floor(existing.troops.dinorider * defenderLossRate)),
      };
      finalOccupant = {
        ...existing,
        squadPower: Math.max(10, Math.round(existing.squadPower * (1 - defenderLossRate * 0.45))),
        troops: defSurvivedTroops,
      };
      worldStore.nodeOccupants.set(nodeId, finalOccupant);
    }

    broadcast({ type: 'world:node_occupant', payload: { nodeId, occupant: finalOccupant } });
    broadcast({ type: 'world:node_contest', payload: contest });
    res.json({
      ok: true,
      occupied: attackerWon,
      occupant: finalOccupant,
      contest,
      serverTimeMs: nowMs,
    });
  });

  // 14. Sammelstelle nach Abschluss oder Rückzug wieder freigeben
  app.post('/api/v1/world/node/release', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }
    const body = (req.body || {}) as { nodeId?: string; marchId?: string };
    if (!isValidId(body.nodeId)) {
      res.status(400).json({ ok: false, error: 'Ungültige Sammelstellen-ID.' });
      return;
    }
    const existing = worldStore.nodeOccupants.get(body.nodeId);
    if (existing && existing.uid === identity.uid && (!body.marchId || existing.marchId === body.marchId)) {
      worldStore.nodeOccupants.delete(body.nodeId);
      broadcast({ type: 'world:node_occupant', payload: { nodeId: body.nodeId, occupant: null } });
    }
    res.json({ ok: true, serverTimeMs: Date.now() });
  });

  // 15. Dynamischer Neu-Spawn für abgebaute Sammelstellen & besiegte Dinos auf der gesamten 1200×1200-Karte
  app.post('/api/v1/world/spawn/relocate', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }
    const body = (req.body || {}) as Partial<WorldDynamicSpawnDTO>;
    const kind = body.kind === 'dino' ? 'dino' : 'node';
    if (!isValidId(body.id)) {
      res.status(400).json({ ok: false, error: 'Ungültige Spawn-ID.' });
      return;
    }
    const nowMs = Date.now();
    const key = `${kind}:${body.id}`;
    const prev = worldStore.dynamicSpawns.get(key);
    const xPct = Math.max(5, Math.min(95, Number(body.xPct || 50)));
    const yPct = Math.max(5, Math.min(95, Number(body.yPct || 50)));
    const level = Math.max(1, Math.min(25, Math.floor(Number(body.level || 1))));
    const dto: WorldDynamicSpawnDTO = {
      key,
      kind,
      id: body.id,
      xPct: Number(xPct.toFixed(2)),
      yPct: Number(yPct.toFixed(2)),
      resource:
        body.resource === 'meat' || body.resource === 'wood' || body.resource === 'stone' || body.resource === 'fur'
          ? body.resource
          : undefined,
      name: body.name ? sanitizeText(body.name, 48) : undefined,
      level,
      capacity: typeof body.capacity === 'number' ? Math.max(20, Math.min(2000, Math.floor(body.capacity))) : undefined,
      remaining: typeof body.remaining === 'number' ? Math.max(0, Math.min(2000, Math.floor(body.remaining))) : undefined,
      speciesId: body.speciesId ? sanitizeText(body.speciesId, 32) : undefined,
      spawnVersion: Math.max((prev?.spawnVersion || 0) + 1, Math.floor(Number(body.spawnVersion || 1))),
      updatedAt: nowMs,
    };

    if (kind === 'node') {
      worldStore.nodeOccupants.delete(body.id);
      broadcast({ type: 'world:node_occupant', payload: { nodeId: body.id, occupant: null } });
    }
    worldStore.upsertDynamicSpawn(dto);
    broadcast({ type: 'world:spawn_update', payload: dto });
    res.json({ ok: true, spawn: dto, serverTimeMs: nowMs });
  });

  // 16. Zentrale Vulkan-Zitadelle: Status & 4-Wochen-Server-Schlacht
  app.get('/api/v1/world/volcano', (_req, res) => {
    const nowMs = Date.now();
    const synced = worldStore.syncVolcanoCycle(nowMs);
    res.json({
      ok: true,
      volcano: synced.state,
      serverTimeMs: nowMs,
    });
  });

  app.post('/api/v1/world/volcano/attack', async (req, res) => {
    const identity = await verifyBearerHeader(req.headers.authorization);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Sitzungstoken erforderlich.' });
      return;
    }

    const nowMs = Date.now();
    const synced = worldStore.syncVolcanoCycle(nowMs);
    const v = synced.state;

    if (v.phase !== 'battle') {
      res.status(409).json({
        ok: false,
        won: false,
        attackerLossRate: 0,
        defenderLossRate: 0,
        defenderName: v.holderTribeName || 'Vulkan-Wächter',
        defenderPower: v.garrisonPower,
        volcano: v,
        serverTimeMs: nowMs,
        error: 'Der Vulkan-Schild ist aktiv! Kämpfe sind erst beim nächsten 4-Wochen-Event wieder möglich.',
      });
      return;
    }

    const body = (req.body || {}) as Partial<VolcanoAttackRequest>;
    const settlement = worldStore.settlements.get(identity.uid);
    const tribeName =
      sanitizeText(body.tribeName || settlement?.tribeName || 'Glutstamm', 28) || 'Glutstamm';
    const rawPower = Math.floor(Number(body.squadPower || 0));
    if (!Number.isFinite(rawPower) || rawPower < 10) {
      res.status(400).json({ ok: false, error: 'Mindestens ein gültiger Kampftrupp erforderlich.' });
      return;
    }
    const squadPower = Math.max(10, Math.min(250000, rawPower));
    const heroIds = Array.isArray(body.heroIds)
      ? body.heroIds
          .slice(0, 3)
          .filter((id): id is string => isValidId(id))
      : [];
    const heroNames = Array.isArray(body.heroNames)
      ? body.heroNames
          .slice(0, 3)
          .map((n) => sanitizeText(n, 28))
          .filter(Boolean)
      : [];
    const troops = {
      slinger: Math.max(0, Math.min(20000, Math.floor(Number(body.troops?.slinger || 0)))),
      clubman: Math.max(0, Math.min(20000, Math.floor(Number(body.troops?.clubman || 0)))),
      dinorider: Math.max(0, Math.min(20000, Math.floor(Number(body.troops?.dinorider || 0)))),
    };

    const computeUnitCasualties = (
      source: { slinger: number; clubman: number; dinorider: number },
      rate: number,
      guaranteeOne: boolean
    ) => {
      const out = { slinger: 0, clubman: 0, dinorider: 0 };
      const clampedRate = Math.max(0, Math.min(0.9, rate));
      if (clampedRate <= 0) return out;
      const keys: Array<'slinger' | 'clubman' | 'dinorider'> = ['slinger', 'clubman', 'dinorider'];
      let totalLost = 0;
      for (const k of keys) {
        const count = Math.max(0, Math.floor(Number(source[k] || 0)));
        if (count <= 0) continue;
        let lost = Math.min(count, Math.round(count * clampedRate));
        if (lost === 0 && clampedRate >= 0.08 && count >= 2) lost = 1;
        out[k] = lost;
        totalLost += lost;
      }
      if (guaranteeOne && totalLost === 0) {
        const largestKey = keys.reduce((best, k) => ((source[k] || 0) > (source[best] || 0) ? k : best), 'slinger' as 'slinger' | 'clubman' | 'dinorider');
        if ((source[largestKey] || 0) > 0) {
          out[largestKey] = 1;
        }
      }
      return out;
    };

    // Bereits Herrscher der Zitadelle → Garnison verstärken (Verstärkung bleibt im Vulkan)
    if (v.holderUid && v.holderUid === identity.uid) {
      const existingHeroIds = Array.isArray(v.garrisonHeroIds) ? [...v.garrisonHeroIds] : [];
      const existingHeroNames = Array.isArray(v.garrisonHeroNames) ? [...v.garrisonHeroNames] : [];
      for (let i = 0; i < heroIds.length; i++) {
        const hId = heroIds[i];
        if (!existingHeroIds.includes(hId) && existingHeroIds.length < 3) {
          existingHeroIds.push(hId);
          const hName = heroNames[i] || hId;
          if (!existingHeroNames.includes(hName)) existingHeroNames.push(hName);
        }
      }
      v.holderTribeName = tribeName;
      v.garrisonPower = Math.min(350000, Math.round((v.garrisonPower || 0) + squadPower));
      v.garrisonHeroIds = existingHeroIds.slice(0, 3);
      if (existingHeroNames.length > 0) {
        v.garrisonHeroNames = existingHeroNames.slice(0, 3);
      } else if (heroNames.length > 0) {
        v.garrisonHeroNames = heroNames.slice(0, 3);
      }
      v.garrisonTroops = {
        slinger: Math.min(30000, (v.garrisonTroops?.slinger || 0) + troops.slinger),
        clubman: Math.min(30000, (v.garrisonTroops?.clubman || 0) + troops.clubman),
        dinorider: Math.min(30000, (v.garrisonTroops?.dinorider || 0) + troops.dinorider),
      };
      v.updatedAt = nowMs;

      const reinforceLog: WorldVolcanoBattleLogDTO = {
        battleId: `volc_${nowMs}_${Math.floor(Math.random() * 9999)}`,
        cycleNumber: v.cycleNumber,
        attackerUid: identity.uid,
        attackerTribeName: tribeName,
        attackerPower: squadPower,
        defenderUid: identity.uid,
        defenderTribeName: tribeName,
        defenderPower: v.garrisonPower,
        attackerWon: true,
        reinforced: true,
        attackerLossRate: 0,
        defenderLossRate: 0,
        timestamp: nowMs,
      };
      v.recentBattles = [reinforceLog, ...(v.recentBattles || [])].slice(0, 24);
      worldStore.setVolcanoState(v);
      broadcast({ type: 'world:volcano', payload: v });
      res.json({
        ok: true,
        won: true,
        reinforced: true,
        attackerLossRate: 0,
        defenderLossRate: 0,
        attackerSurvivingTroops: troops,
        defenderName: tribeName,
        defenderPower: v.garrisonPower,
        battle: reinforceLog,
        volcano: v,
        serverTimeMs: nowMs,
      });
      return;
    }

    // Serverseitige Belagerungsschlacht um die Vulkan-Zitadelle
    const defenderUid = v.holderUid || null;
    const defenderName = v.holderTribeName || 'Vulkan-Wächter';
    const defenderPower = Math.max(80, v.garrisonPower || VOLCANO_GUARDIAN_POWER);
    const prevGarrisonTroops = {
      slinger: Math.max(0, Math.floor(Number(v.garrisonTroops?.slinger || 0))),
      clubman: Math.max(0, Math.floor(Number(v.garrisonTroops?.clubman || 0))),
      dinorider: Math.max(0, Math.floor(Number(v.garrisonTroops?.dinorider || 0))),
    };

    const atkRoll = 0.9 + Math.random() * 0.2; // ±10% Schlachtglück
    const defRoll = 0.9 + Math.random() * 0.2;
    const attackerWon = squadPower * atkRoll >= defenderPower * defRoll;

    const ratio = attackerWon
      ? squadPower / Math.max(1, defenderPower)
      : defenderPower / Math.max(1, squadPower);
    const winnerLossRate = Number(Math.max(0.06, Math.min(0.2, 0.18 - (ratio - 1) * 0.08)).toFixed(3));
    const loserLossRate = Number(Math.max(0.16, Math.min(0.32, 0.24 + (ratio - 1) * 0.08)).toFixed(3));
    const attackerLossRate = attackerWon ? winnerLossRate : loserLossRate;
    const defenderLossRate = attackerWon ? loserLossRate : winnerLossRate;

    const attackerLosses = computeUnitCasualties(troops, attackerLossRate, false);
    const attackerSurvivingTroops = {
      slinger: Math.max(0, troops.slinger - attackerLosses.slinger),
      clubman: Math.max(0, troops.clubman - attackerLosses.clubman),
      dinorider: Math.max(0, troops.dinorider - attackerLosses.dinorider),
    };

    // Bei nicht siegreichen Angriffen wird ein Teil der stationierten Besetzer-Soldaten verletzt
    // und landet im Krankenhaus (Krankenzelt) des Besetzers; bei Eroberung werden Verluste verbucht
    // und die restliche Besetzer-Garnison kehrt nach Hause zurück.
    const defenderWounded = defenderUid
      ? computeUnitCasualties(
          prevGarrisonTroops,
          attackerWon ? defenderLossRate : Math.max(0.08, defenderLossRate * 0.85),
          true
        )
      : { slinger: 0, clubman: 0, dinorider: 0 };

    const battle: WorldVolcanoBattleLogDTO = {
      battleId: `volc_${nowMs}_${Math.floor(Math.random() * 9999)}`,
      cycleNumber: v.cycleNumber,
      attackerUid: identity.uid,
      attackerTribeName: tribeName,
      attackerPower: squadPower,
      defenderUid,
      defenderTribeName: defenderName,
      defenderPower,
      attackerWon,
      evicted: Boolean(attackerWon && defenderUid),
      attackerLossRate,
      defenderLossRate,
      defenderWounded,
      timestamp: nowMs,
    };

    if (attackerWon) {
      // Eroberer-Soldaten & Helden bleiben im Vulkan stationiert, bis ein anderer Stamm sie vertreibt
      v.holderUid = identity.uid;
      v.holderTribeName = tribeName;
      v.holderSince = nowMs;
      v.garrisonPower = Math.max(120, Math.round(squadPower * (1 - attackerLossRate * 0.45)));
      v.garrisonHeroIds = heroIds;
      v.garrisonHeroNames = heroNames.length > 0 ? heroNames : ['Stammes-Garde'];
      v.garrisonTroops = attackerSurvivingTroops;
    } else {
      // Angriff abgewehrt: Verletzte Besetzer-Soldaten verlassen den Vulkan ins Krankenzelt, Rest bleibt stationiert
      const prevTotal = prevGarrisonTroops.slinger + prevGarrisonTroops.clubman + prevGarrisonTroops.dinorider;
      const woundedTotal = defenderWounded.slinger + defenderWounded.clubman + defenderWounded.dinorider;
      const powerScale =
        prevTotal > 0
          ? Math.max(0.55, 1 - (woundedTotal / prevTotal) * 0.55)
          : Math.max(0.65, 1 - defenderLossRate * 0.35);
      v.garrisonPower = Math.max(80, Math.round(defenderPower * powerScale));
      v.garrisonTroops = {
        slinger: Math.max(0, prevGarrisonTroops.slinger - defenderWounded.slinger),
        clubman: Math.max(0, prevGarrisonTroops.clubman - defenderWounded.clubman),
        dinorider: Math.max(0, prevGarrisonTroops.dinorider - defenderWounded.dinorider),
      };
    }

    v.recentBattles = [battle, ...(v.recentBattles || [])].slice(0, 24);
    v.updatedAt = nowMs;
    worldStore.setVolcanoState(v);
    broadcast({ type: 'world:volcano', payload: v });

    // Server-Chronik im Welt-Chat bei Machtwechsel
    if (attackerWon) {
      const chatNotice: WorldChatMessageDTO = {
        messageId: `sys_volc_win_${nowMs}_${Math.floor(Math.random() * 999)}`,
        uid: 'system_caldera',
        tribeName: 'Caldera-Chronik',
        bonfireLevel: 25,
        text: `🌋 Stamm „${tribeName}“ (KK ${squadPower}) hat ${defenderName} besiegt und die zentrale Vulkan-Zitadelle erobert!`,
        channel: 'world',
        createdAt: nowMs,
      };
      worldStore.appendChat(chatNotice);
      broadcast({ type: 'chat:message', payload: chatNotice });
    }

    res.json({
      ok: true,
      won: attackerWon,
      attackerLossRate,
      defenderLossRate,
      attackerSurvivingTroops,
      defenderWounded,
      defenderName,
      defenderPower,
      battle,
      volcano: v,
      serverTimeMs: nowMs,
    });
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
