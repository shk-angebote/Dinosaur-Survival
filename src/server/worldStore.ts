/**
 * Dauerhafte, atomare Server-Speicherung für die gemeinsame Dinosaurier-Weltkarte,
 * den Welt-Chat und serverseitige Spieler-Spielstände (überlebt Server-Neustarts).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
} from '../shared/apiTypes.js';

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
}

export class PersistentWorldStore {
  readonly settlements = new Map<string, WorldSettlementDTO>();
  readonly activeMarches = new Map<string, WorldMarchDTO>();
  readonly chatHistory: WorldChatMessageDTO[] = [];
  readonly playerSaves = new Map<string, PersistedPlayerSave>();

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

      const payload: PersistedWorldSnapshot = {
        version: 1,
        savedAt: Date.now(),
        settlements: Array.from(this.settlements.values()),
        chatHistory: this.chatHistory.slice(-100),
        playerSaves: savesObj,
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
