/**
 * Dauerhafte, atomare Server-Speicherung für die gemeinsame Dinosaurier-Weltkarte,
 * den Welt-Chat und serverseitige Spieler-Spielstände (überlebt Server-Neustarts).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  WorldChatMessageDTO,
  WorldDynamicSpawnDTO,
  WorldMarchDTO,
  WorldNodeOccupantDTO,
  WorldSettlementDTO,
  WorldTradeDTO,
  WorldVolcanoStateDTO,
} from '../shared/apiTypes.ts';

export const VOLCANO_CYCLE_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000; // Exakt 4 Wochen (28 Tage)
export const VOLCANO_BATTLE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 Stunden epische Server-Vulkanschlacht pro Zyklus
export const VOLCANO_GUARDIAN_POWER = 380;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const STATE_FILE = path.resolve(DATA_DIR, 'world-state.json');
const TEMP_FILE = path.resolve(DATA_DIR, 'world-state.json.tmp');

// Sicherheitsprüfung: Alle Dateipfade müssen strikt innerhalb von DATA_DIR liegen
if (
  !STATE_FILE.startsWith(DATA_DIR + path.sep) ||
  !TEMP_FILE.startsWith(DATA_DIR + path.sep)
) {
  throw new Error('Ungültiger Datenverzeichnis-Pfad für WorldStore.');
}

export interface PersistedPlayerSave {
  uid: string;
  schemaVersion: number;
  tribeName: string;
  state: Record<string, unknown>;
  updatedAt: number;
}

interface PersistedWorldSnapshot {
  version: number;
  savedAt: number;
  settlements: WorldSettlementDTO[];
  chatHistory: WorldChatMessageDTO[];
  playerSaves: Record<string, PersistedPlayerSave>;
  trades?: WorldTradeDTO[];
  dynamicSpawns?: WorldDynamicSpawnDTO[];
  volcanoState?: WorldVolcanoStateDTO;
}

function createInitialVolcanoState(nowMs: number): WorldVolcanoStateDTO {
  return {
    cycleNumber: 1,
    cycleIntervalMs: VOLCANO_CYCLE_INTERVAL_MS,
    battleDurationMs: VOLCANO_BATTLE_DURATION_MS,
    phase: 'battle',
    cycleStartedAt: nowMs,
    battleEndsAt: nowMs + VOLCANO_BATTLE_DURATION_MS,
    nextBattleStartAt: nowMs + VOLCANO_CYCLE_INTERVAL_MS,
    holderUid: null,
    holderTribeName: null,
    holderSince: null,
    garrisonPower: VOLCANO_GUARDIAN_POWER,
    garrisonHeroNames: ['Vulkan-Wächter'],
    garrisonTroops: { slinger: 20, clubman: 24, dinorider: 10 },
    reignCount: 0,
    recentBattles: [],
    updatedAt: nowMs,
  };
}

export class PersistentWorldStore {
  readonly settlements = new Map<string, WorldSettlementDTO>();
  readonly activeMarches = new Map<string, WorldMarchDTO>();
  readonly nodeOccupants = new Map<string, WorldNodeOccupantDTO>();
  readonly dynamicSpawns = new Map<string, WorldDynamicSpawnDTO>();
  readonly trades = new Map<string, WorldTradeDTO>();
  readonly chatHistory: WorldChatMessageDTO[] = [];
  readonly playerSaves = new Map<string, PersistedPlayerSave>();
  volcanoState: WorldVolcanoStateDTO = createInitialVolcanoState(Date.now());

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor() {
    this.loadFromDisk();
    if (this.chatHistory.length === 0) {
      this.chatHistory.push({
        messageId: 'sys_welcome_1',
        uid: 'system_caldera',
        tribeName: 'Caldera-Chronik',
        bonfireLevel: 25,
        text: 'Willkommen in der gemeinsamen Dinosaurierwelt! Baue dein Signalfeuer aus, jage wilde Saurier und tausche dich hier mit anderen Stämmen aus.',
        channel: 'world',
        createdAt: Date.now(),
      });
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<PersistedWorldSnapshot>;

      if (Array.isArray(parsed.settlements)) {
        for (const s of parsed.settlements) {
          if (s && typeof s.uid === 'string' && typeof s.tileX === 'number' && typeof s.tileY === 'number') {
            this.settlements.set(s.uid, s);
          }
        }
      }
      if (Array.isArray(parsed.chatHistory)) {
        for (const msg of parsed.chatHistory.slice(-100)) {
          if (msg && typeof msg.messageId === 'string' && typeof msg.text === 'string') {
            this.chatHistory.push(msg);
          }
        }
      }
      if (parsed.playerSaves && typeof parsed.playerSaves === 'object') {
        for (const [uid, save] of Object.entries(parsed.playerSaves)) {
          if (save && typeof save === 'object' && save.state && typeof save.state === 'object') {
            this.playerSaves.set(uid, save);
          }
        }
      }
      if (Array.isArray(parsed.trades)) {
        for (const t of parsed.trades.slice(-200)) {
          if (t && typeof t.tradeId === 'string' && typeof t.fromUid === 'string' && typeof t.toUid === 'string') {
            this.trades.set(t.tradeId, t);
          }
        }
      }
      if (Array.isArray(parsed.dynamicSpawns)) {
        for (const sp of parsed.dynamicSpawns.slice(-200)) {
          if (sp && typeof sp.key === 'string' && typeof sp.id === 'string' && typeof sp.xPct === 'number') {
            this.dynamicSpawns.set(sp.key, sp);
          }
        }
      }
      if (parsed.volcanoState && typeof parsed.volcanoState === 'object' && typeof parsed.volcanoState.cycleNumber === 'number') {
        const vs = parsed.volcanoState;
        this.volcanoState = {
          ...createInitialVolcanoState(Date.now()),
          ...vs,
          cycleIntervalMs: VOLCANO_CYCLE_INTERVAL_MS,
          battleDurationMs: VOLCANO_BATTLE_DURATION_MS,
          recentBattles: Array.isArray(vs.recentBattles) ? vs.recentBattles.slice(0, 16) : [],
        };
      }
    } catch (err) {
      console.error('[WorldStore] Laden fehlgeschlagen, starte mit leerem Weltstand:', err);
    }
  }

  schedulePersist(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushSync();
    }, 800);
  }

  flushSync(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const savesObj: Record<string, PersistedPlayerSave> = {};
      // Begrenze gespeicherte Spielerstände auf 500 aktivste Einträge
      const sortedSaves = Array.from(this.playerSaves.entries())
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
        .slice(0, 500);
      for (const [uid, save] of sortedSaves) {
        savesObj[uid] = save;
      }

      const recentTrades = Array.from(this.trades.values())
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 200);

      const payload: PersistedWorldSnapshot = {
        version: 1,
        savedAt: Date.now(),
        settlements: Array.from(this.settlements.values()),
        chatHistory: this.chatHistory.slice(-100),
        playerSaves: savesObj,
        trades: recentTrades,
        dynamicSpawns: Array.from(this.dynamicSpawns.values()),
        volcanoState: this.volcanoState,
      };
      fs.writeFileSync(TEMP_FILE, JSON.stringify(payload), 'utf8');
      fs.renameSync(TEMP_FILE, STATE_FILE);
    } catch (err) {
      console.error('[WorldStore] Speichern fehlgeschlagen:', err);
    }
  }

  upsertSettlement(dto: WorldSettlementDTO): void {
    this.settlements.set(dto.uid, dto);
    this.schedulePersist();
  }

  upsertMarch(dto: WorldMarchDTO): void {
    if (dto.status === 'completed') {
      this.activeMarches.delete(dto.marchId);
    } else {
      this.activeMarches.set(dto.marchId, dto);
    }
  }

  pruneExpiredMarches(nowMs: number): void {
    for (const [id, m] of this.activeMarches.entries()) {
      if (m.status === 'completed' || m.endsAt + 12000 < nowMs) {
        this.activeMarches.delete(id);
      }
    }
    for (const [nodeId, occ] of this.nodeOccupants.entries()) {
      if (occ.endsAt + 10000 < nowMs) {
        this.nodeOccupants.delete(nodeId);
      }
    }
  }

  upsertDynamicSpawn(dto: WorldDynamicSpawnDTO): void {
    this.dynamicSpawns.set(dto.key, dto);
    this.schedulePersist();
  }

  /**
   * Synchronisiert den server-autoritativen 4-Wochen-Zyklus der zentralen Vulkan-Zitadelle.
   * Öffnet alle 28 Tage automatisch das 6-stündige Server-Schlachtfenster und schützt
   * den Sieger anschließend für die nächsten 4 Wochen unter dem Kaldera-Schild.
   */
  syncVolcanoCycle(nowMs: number): {
    state: WorldVolcanoStateDTO;
    changed: boolean;
    announcement?: string;
  } {
    const v = this.volcanoState;
    let changed = false;
    let announcement: string | undefined;

    // Vorlauf über eventuell verpasste 4-Wochen-Zyklen (z. B. nach längerer Server-Pause)
    let guard = 0;
    while (guard < 24) {
      guard++;
      if (v.phase === 'battle' && nowMs >= v.battleEndsAt) {
        v.phase = 'peace';
        v.nextBattleStartAt = v.cycleStartedAt + VOLCANO_CYCLE_INTERVAL_MS;
        if (v.nextBattleStartAt <= v.battleEndsAt) {
          v.nextBattleStartAt = v.battleEndsAt + VOLCANO_CYCLE_INTERVAL_MS;
        }
        if (v.holderUid) {
          v.reignCount = (v.reignCount || 0) + 1;
        }
        v.updatedAt = nowMs;
        changed = true;
        announcement = v.holderTribeName
          ? `🌋 Die Vulkanschlacht (Zyklus #${v.cycleNumber}) ist beendet! Stamm „${v.holderTribeName}“ herrscht für die nächsten 4 Wochen über die Vulkan-Zitadelle!`
          : `🌋 Die Vulkanschlacht (Zyklus #${v.cycleNumber}) ist beendet. Die Vulkan-Wächter halten die Zitadelle bis in 4 Wochen.`;
      } else if (v.phase === 'peace' && nowMs >= v.nextBattleStartAt) {
        v.cycleNumber = (v.cycleNumber || 1) + 1;
        v.phase = 'battle';
        v.cycleStartedAt = v.nextBattleStartAt;
        v.battleEndsAt = v.cycleStartedAt + VOLCANO_BATTLE_DURATION_MS;
        v.nextBattleStartAt = v.cycleStartedAt + VOLCANO_CYCLE_INTERVAL_MS;
        v.updatedAt = nowMs;
        changed = true;
        announcement = `🌋 ALARM IN DER KALDERA! Der 4-Wochen-Schild der Vulkan-Zitadelle (Zyklus #${v.cycleNumber}) ist gefallen — alle Stämme können jetzt um die Herrschaft kämpfen!`;
      } else {
        break;
      }
    }

    if (changed) {
      this.schedulePersist();
    }
    return { state: v, changed, announcement };
  }

  setVolcanoState(next: WorldVolcanoStateDTO): void {
    this.volcanoState = next;
    this.schedulePersist();
  }

  upsertTrade(dto: WorldTradeDTO): void {
    this.trades.set(dto.tradeId, dto);
    if (this.trades.size > 240) {
      const oldest = Array.from(this.trades.values())
        .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
        .slice(0, this.trades.size - 200);
      for (const old of oldest) {
        this.trades.delete(old.tradeId);
      }
    }
    this.schedulePersist();
  }

  getRecentTrades(): WorldTradeDTO[] {
    return Array.from(this.trades.values())
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 120);
  }

  appendChat(msg: WorldChatMessageDTO): boolean {
    if (this.chatHistory.some((m) => m.messageId === msg.messageId)) {
      return false;
    }
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 100) {
      this.chatHistory.shift();
    }
    this.schedulePersist();
    return true;
  }

  getPlayerSave(uid: string): PersistedPlayerSave | null {
    return this.playerSaves.get(uid) || null;
  }

  upsertPlayerSave(save: PersistedPlayerSave): void {
    this.playerSaves.set(save.uid, save);
    this.schedulePersist();
  }

  /**
   * Überführt eine bestehende Gast-Siedlung und einen Gast-Spielstand atomar auf die
   * dauerhafte Firebase-UID, sobald der Spieler sein Google-Konto verknüpft.
   */
  migrateGuestToVerifiedUid(
    guestUid: string,
    verifiedUid: string
  ): { removedGuestUid: string | null; migratedSettlement: WorldSettlementDTO | null } {
    let removedGuestUid: string | null = null;
    let migratedSettlement: WorldSettlementDTO | null = null;

    const guestSettlement = this.settlements.get(guestUid);
    if (guestSettlement) {
      this.settlements.delete(guestUid);
      removedGuestUid = guestUid;
      if (!this.settlements.has(verifiedUid)) {
        migratedSettlement = {
          ...guestSettlement,
          uid: verifiedUid,
          updatedAt: Date.now(),
        };
        this.settlements.set(verifiedUid, migratedSettlement);
      }
    }

    const guestSave = this.playerSaves.get(guestUid);
    if (guestSave) {
      if (!this.playerSaves.has(verifiedUid)) {
        this.playerSaves.set(verifiedUid, {
          ...guestSave,
          uid: verifiedUid,
          updatedAt: Date.now(),
        });
      }
      this.playerSaves.delete(guestUid);
    }

    if (removedGuestUid || guestSave) {
      this.schedulePersist();
    }
    return { removedGuestUid, migratedSettlement };
  }
}
