/**
 * Serverseitige, deterministisch überprüfbare Spielregeln (Bauzeiten, Kosten,
 * Weltkarten-2x2-Validierung, Dino-Kampfberechnung).
 * Geteilt zwischen Node.js-Server und Web-Client; Unity ruft diese Regeln über /api/v1/... auf.
 */

import type {
  BuildValidationRequest,
  BuildValidationResponse,
  DinoCombatRoundDTO,
  DinoHuntCombatRequest,
  DinoHuntCombatResponse,
  ResourceKey,
  WorldSettlementDTO
} from './apiTypes.ts';
import {
  BASE_BUILD_SECONDS,
  BUILDING_CONFIGS,
  DINO_SPECIES_CONFIG,
  MARCH_QUEUE_UNLOCK_LEVELS,
  MAX_LEVEL,
  WORLD_CHUNK_SIZE,
  WORLD_GRID_COLS,
  WORLD_GRID_ROWS
} from './gameConfig.ts';

export const TILE_FREE = 0;
export const TILE_BLOCKED = 1;
export const TILE_OCCUPIED = 2;

export function getMaxMarchQueuesForBonfire(bonfireLevel: number): number {
  let count = 1;
  for (let i = 1; i < MARCH_QUEUE_UNLOCK_LEVELS.length; i++) {
    if (bonfireLevel >= MARCH_QUEUE_UNLOCK_LEVELS[i]) count = i + 1;
  }
  return Math.min(5, count);
}

export function getChunkKey(tileX: number, tileY: number): string {
  const cx = Math.floor(tileX / WORLD_CHUNK_SIZE);
  const cy = Math.floor(tileY / WORLD_CHUNK_SIZE);
  return `${cx}_${cy}`;
}

export function getBuildingUpgradeCost(buildingId: string, targetLevel: number): Record<ResourceKey, number> {
  const cfg = BUILDING_CONFIGS[buildingId];
  if (!cfg) return { meat: 0, wood: 0, stone: 0, fur: 0 };
  const lv = Math.max(1, Math.min(MAX_LEVEL, targetLevel));
  const rawMult = lv <= 10
    ? Math.pow(cfg.costScale, lv - 1)
    : Math.pow(cfg.costScale, 9) * Math.pow(1.24, lv - 10);
  return {
    meat: Math.round(cfg.baseCost.meat * rawMult),
    wood: Math.round(cfg.baseCost.wood * rawMult),
    stone: Math.round(cfg.baseCost.stone * rawMult),
    fur: Math.round(cfg.baseCost.fur * rawMult)
  };
}

export function getBuildingDurationSec(buildingId: string, targetLevel: number, techBuildSpeedBonus = 0): number {
  const cfg = BUILDING_CONFIGS[buildingId];
  if (!cfg) return 15;
  const lv = Math.max(1, Math.min(MAX_LEVEL, targetLevel));
  const base = BASE_BUILD_SECONDS[lv] || 15;
  const speedFactor = 1 + Math.max(0, Math.min(2.0, techBuildSpeedBonus));
  return Math.max(5, Math.round((base * cfg.buildTimeMult) / speedFactor));
}

export function validateBuildingUpgrade(req: BuildValidationRequest, serverNowMs: number): BuildValidationResponse {
  const cfg = BUILDING_CONFIGS[req.buildingId];
  const targetLevel = Math.floor(req.currentLevel) + 1;
  if (!cfg) {
    return { allowed: false, reason: 'Unbekanntes Gebäude.', targetLevel, cost: { meat: 0, wood: 0, stone: 0, fur: 0 }, durationSec: 0, serverNowMs, endsAtMs: serverNowMs };
  }
  if (targetLevel > MAX_LEVEL) {
    return { allowed: false, reason: `Maximale Stufe (${MAX_LEVEL}) bereits erreicht.`, targetLevel, cost: { meat: 0, wood: 0, stone: 0, fur: 0 }, durationSec: 0, serverNowMs, endsAtMs: serverNowMs };
  }
  if (req.buildingId !== 'bonfire' && targetLevel > req.bonfireLevel) {
    return {
      allowed: false,
      reason: `Signalfeuer muss mindestens Stufe ${targetLevel} erreichen.`,
      targetLevel,
      cost: getBuildingUpgradeCost(req.buildingId, targetLevel),
      durationSec: 0,
      serverNowMs,
      endsAtMs: serverNowMs
    };
  }
  const cost = getBuildingUpgradeCost(req.buildingId, targetLevel);
  for (const key of ['meat', 'wood', 'stone', 'fur'] as ResourceKey[]) {
    if ((req.resources[key] || 0) < cost[key]) {
      return {
        allowed: false,
        reason: `Nicht genügend Ressourcen (${key} fehlt).`,
        targetLevel,
        cost,
        durationSec: 0,
        serverNowMs,
        endsAtMs: serverNowMs
      };
    }
  }
  const durationSec = getBuildingDurationSec(req.buildingId, targetLevel, req.techBuildSpeedBonus || 0);
  return {
    allowed: true,
    targetLevel,
    cost,
    durationSec,
    serverNowMs,
    endsAtMs: serverNowMs + durationSec * 1000
  };
}

/**
 * O(1)-Terrain-Prüfung für das statische 1200×1200-Hindernisraster der Caldera-Weltkarte
 * (0 Byte Speicher, identisch auf Server & Client).
 */
export function getStaticWorldTileState(gx: number, gy: number): number {
  if (gx < 0 || gy < 0 || gx >= WORLD_GRID_COLS || gy >= WORLD_GRID_ROWS) {
    return TILE_BLOCKED;
  }

  // Zentrale Vulkan-Caldera (Ellipse um 600, 600)
  const dx = (gx + 0.5 - 600) / 145;
  const dy = (gy + 0.5 - 600) / 145;
  if (dx * dx + dy * dy <= 1.0) return TILE_BLOCKED;

  // 4 große Urzeit-Dino-Höhlen (Nord, Süd, West, Ost)
  if (gx >= 530 && gx <= 670 && gy >= 110 && gy <= 230) return TILE_BLOCKED;
  if (gx >= 530 && gx <= 670 && gy >= 970 && gy <= 1090) return TILE_BLOCKED;
  if (gx >= 110 && gx <= 230 && gy >= 530 && gy <= 670) return TILE_BLOCKED;
  if (gx >= 970 && gx <= 1090 && gy >= 530 && gy <= 670) return TILE_BLOCKED;

  // Lava-Klippen an den 4 Kartenecken
  if (gx <= 95 && gy <= 95) return TILE_BLOCKED;
  if (gx >= 1104 && gy <= 95) return TILE_BLOCKED;
  if (gx <= 95 && gy >= 1104) return TILE_BLOCKED;
  if (gx >= 1104 && gy >= 1104) return TILE_BLOCKED;

  // 3 befestigte NPC-Stammeslager
  if (gx >= 230 && gx <= 275 && gy >= 210 && gy <= 255) return TILE_OCCUPIED;
  if (gx >= 925 && gx <= 970 && gy >= 210 && gy <= 255) return TILE_OCCUPIED;
  if (gx >= 925 && gx <= 970 && gy >= 945 && gy <= 990) return TILE_OCCUPIED;

  return TILE_FREE;
}

/**
 * Leichtgewichtiger Kompatibilitäts-Stub (Terrain wird O(1) über getStaticWorldTileState ausgewertet).
 */
export function createStaticWorldGrid(): Uint8Array {
  return new Uint8Array(0);
}

export function validateSettlementPlacement2x2(
  _staticGrid: Uint8Array,
  settlements: Iterable<WorldSettlementDTO>,
  requesterUid: string,
  tileX: number,
  tileY: number
): { valid: boolean; reason?: string } {
  const ax = Math.floor(tileX);
  const ay = Math.floor(tileY);
  if (ax < 0 || ay < 0 || ax > WORLD_GRID_COLS - 2 || ay > WORLD_GRID_ROWS - 2) {
    return { valid: false, reason: 'Koordinaten liegen außerhalb der 1200×1200 Weltkarte.' };
  }

  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const st = getStaticWorldTileState(ax + dx, ay + dy);
      if (st !== TILE_FREE) {
        return {
          valid: false,
          reason: st === TILE_BLOCKED ? 'Hindernis blockiert diese 2×2-Fläche.' : 'Feld ist durch ein Lager oder eine Ressource belegt.'
        };
      }
    }
  }

  for (const s of settlements) {
    if (s.uid === requesterUid) continue;
    const overlapX = ax < s.tileX + 2 && ax + 2 > s.tileX;
    const overlapY = ay < s.tileY + 2 && ay + 2 > s.tileY;
    if (overlapX && overlapY) {
      return { valid: false, reason: `Fläche ist bereits von „${s.tribeName}“ besetzt.` };
    }
  }

  return { valid: true };
}

export function findFree2x2Spot(
  staticGrid: Uint8Array,
  settlements: Iterable<WorldSettlementDTO>,
  uid: string,
  preferredX = 240,
  preferredY = 940
): { tileX: number; tileY: number } {
  const baseX = Math.max(0, Math.min(WORLD_GRID_COLS - 2, Math.floor(preferredX)));
  const baseY = Math.max(0, Math.min(WORLD_GRID_ROWS - 2, Math.floor(preferredY)));
  if (validateSettlementPlacement2x2(staticGrid, settlements, uid, baseX, baseY).valid) {
    return { tileX: baseX, tileY: baseY };
  }
  for (let r = 1; r <= 160; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = baseX + dx;
        const ty = baseY + dy;
        if (validateSettlementPlacement2x2(staticGrid, settlements, uid, tx, ty).valid) {
          return { tileX: tx, tileY: ty };
        }
      }
    }
  }
  return { tileX: 240, tileY: 940 };
}

export function resolveAuthoritativeDinoHunt(req: DinoHuntCombatRequest, serverTimeMs: number): DinoHuntCombatResponse {
  const species = DINO_SPECIES_CONFIG.find((s) => s.id === req.speciesId) || DINO_SPECIES_CONFIG[0];
  const dinoLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(req.dinoLevel || species.levelRange[0])));
  const dinoPower = Math.round(species.basePower + Math.max(0, dinoLevel - species.levelRange[0]) * species.powerPerLevel);
  const squadPower = Math.max(1, Math.round(req.squadPower || 1));
  const ratio = squadPower / Math.max(1, dinoPower);
  const winChance = ratio >= 1.0 ? 1.0 : ratio >= 0.72 ? (ratio - 0.65) / 0.35 : 0.08;
  const victory = Math.random() <= winChance;

  const troopsSent = {
    slinger: Math.max(0, Math.floor(req.troops?.slinger || 0)),
    clubman: Math.max(0, Math.floor(req.troops?.clubman || 0)),
    dinorider: Math.max(0, Math.floor(req.troops?.dinorider || 0))
  };
  const troopsLost = { slinger: 0, clubman: 0, dinorider: 0 };
  let lostTotal = 0;

  const lossRate = victory ? (ratio >= 1.35 ? 0 : Math.min(0.22, (1.35 - ratio) * 0.32)) : 0.25;
  if (lossRate > 0) {
    for (const k of ['slinger', 'clubman', 'dinorider'] as const) {
      const lost = Math.min(troopsSent[k], Math.floor(troopsSent[k] * lossRate));
      troopsLost[k] = lost;
      lostTotal += lost;
    }
  }

  const resources: Partial<Record<ResourceKey, number>> = {};
  const items: Record<string, number> = {};
  let xp = 0;
  if (victory) {
    const lvlScale = 1 + (dinoLevel - species.levelRange[0]) * 0.14;
    for (const entry of species.lootTable) {
      if (Math.random() * 100 <= entry.chancePct) {
        const rawQty = entry.min + Math.random() * (entry.max - entry.min);
        const qty = Math.max(1, Math.round(entry.resKey ? rawQty * lvlScale : rawQty));
        if (entry.resKey) {
          resources[entry.resKey] = (resources[entry.resKey] || 0) + qty;
        } else if (entry.itemKey) {
          items[entry.itemKey] = (items[entry.itemKey] || 0) + qty;
        }
      }
    }
    xp = dinoLevel * 35;
  }

  const heroEntries = Array.isArray(req.heroes) ? req.heroes.slice(0, 3) : [];
  const counterMatched = heroEntries.some((h) => h.role === species.counterRole);
  const squadHpMax = Math.max(400, Math.round(squadPower * 1.15));
  const dinoHpMax = Math.max(360, Math.round(dinoPower * 1.2));

  const targetSquadEndPct = victory
    ? Math.max(24, Math.min(96, Math.round(92 - Math.min(0.68, Math.max(0, 1.45 - ratio) * 0.72) * 100 - lostTotal * 2)))
    : Math.max(8, Math.min(20, 16 - Math.min(8, lostTotal)));
  const targetDinoEndPct = victory ? 0 : Math.max(18, Math.min(62, Math.round((1 - Math.min(0.82, ratio * 0.85)) * 100)));

  const totalRounds = victory ? (ratio >= 1.45 ? 4 : 5) : 5;
  const squadAttackCount = Math.ceil(totalRounds / 2);
  const dinoAttackCount = Math.floor(totalRounds / 2);
  const totalDinoDmg = Math.round(((100 - targetDinoEndPct) / 100) * dinoHpMax);
  const totalSquadDmg = Math.round(((100 - targetSquadEndPct) / 100) * squadHpMax);

  const rounds: DinoCombatRoundDTO[] = [];
  let curSquadHp = squadHpMax;
  let curDinoHp = dinoHpMax;
  let squadHitsDone = 0;
  let dinoHitsDone = 0;
  const tankHero = heroEntries.find((h) => h.role === 'Tank');

  for (let r = 1; r <= totalRounds; r++) {
    const isSquadTurn = r % 2 === 1 || (victory && r === totalRounds);
    if (isSquadTurn) {
      squadHitsDone++;
      const isLastSquadHit = squadHitsDone >= squadAttackCount || (victory && r === totalRounds);
      const hero = heroEntries.length ? heroEntries[(squadHitsDone - 1) % heroEntries.length] : null;
      const share = isLastSquadHit
        ? Math.max(40, curDinoHp - Math.round((targetDinoEndPct / 100) * dinoHpMax))
        : Math.max(45, Math.round((totalDinoDmg / Math.max(1, squadAttackCount)) * (0.85 + Math.random() * 0.35)));
      const dmg = Math.min(curDinoHp, share);
      curDinoHp = Math.max(0, curDinoHp - dmg);
      if (victory && r === totalRounds) curDinoHp = 0;

      const isCrit = Boolean((hero && hero.role === species.counterRole) || (isLastSquadHit && victory) || Math.random() < 0.34);
      const actorName = hero ? hero.name : 'Jagdtrupp';
      const actionName = hero ? (squadHitsDone === 1 || isCrit ? hero.skillName : `${hero.role}-Vorstoß`) : 'Soldaten-Salve';
      const counterNote = hero && hero.role === species.counterRole ? ' (Konter-Bonus!)' : '';
      const logText =
        victory && r === totalRounds
          ? `${actorName} setzt „${actionName}“ ein und bezwingt ${species.name} mit ${dmg.toLocaleString('de-DE')} Schaden!${counterNote}`
          : `${actorName} trifft mit „${actionName}“ für ${dmg.toLocaleString('de-DE')} Schaden${isCrit ? ' — Kritischer Treffer!' : '.'}${counterNote}`;

      rounds.push({
        round: r,
        actorSide: 'squad',
        heroId: hero ? hero.id : null,
        actorName,
        actorRole: hero ? hero.role : 'Truppe',
        actionName,
        damage: dmg,
        isCrit,
        isShield: false,
        squadHp: curSquadHp,
        dinoHp: curDinoHp,
        squadHpPct: Math.max(0, Math.round((curSquadHp / squadHpMax) * 100)),
        dinoHpPct: Math.max(0, Math.round((curDinoHp / dinoHpMax) * 100)),
        logText
      });
    } else {
      dinoHitsDone++;
      const isLastDinoHit = dinoHitsDone >= dinoAttackCount;
      const targetFloorHp = Math.round((targetSquadEndPct / 100) * squadHpMax);
      const rawShare = isLastDinoHit
        ? Math.max(25, curSquadHp - targetFloorHp)
        : Math.max(30, Math.round((totalSquadDmg / Math.max(1, dinoAttackCount)) * (0.82 + Math.random() * 0.34)));
      const isShield = Boolean(tankHero && (dinoHitsDone === 1 || Math.random() < 0.55));
      const dmg = Math.min(Math.max(15, curSquadHp - targetFloorHp), isShield ? Math.round(rawShare * 0.82) : rawShare);
      curSquadHp = Math.max(targetFloorHp, curSquadHp - Math.max(0, dmg));

      const dinoMove = species.strengths[(dinoHitsDone - 1) % species.strengths.length] || 'Prankenhieb';
      const shieldText = isShield && tankHero ? ` ${tankHero.shortName} fängt den Stoß ab!` : '';
      const logText = `${species.name} greift mit „${dinoMove}“ an (${Math.max(0, dmg).toLocaleString('de-DE')} Schaden).${shieldText}`;

      rounds.push({
        round: r,
        actorSide: 'dino',
        heroId: isShield && tankHero ? tankHero.id : null,
        actorName: species.name,
        actorRole: 'Dino',
        actionName: dinoMove,
        damage: Math.max(0, dmg),
        isCrit: !isShield && !victory,
        isShield,
        squadHp: curSquadHp,
        dinoHp: curDinoHp,
        squadHpPct: Math.max(0, Math.round((curSquadHp / squadHpMax) * 100)),
        dinoHpPct: Math.max(0, Math.round((curDinoHp / dinoHpMax) * 100)),
        logText
      });
    }
  }

  const [minL, maxL] = species.levelRange;
  const nextDinoLevel = minL + Math.floor(Math.random() * (maxL - minL + 1));

  return {
    battleId: `battle_${serverTimeMs}_${Math.floor(Math.random() * 9999)}`,
    serverTimeMs,
    victory,
    dinoPower,
    squadPower,
    counterMatched,
    squadHpMax,
    dinoHpMax,
    troopsSent,
    troopsLost,
    lostTotal,
    resources,
    items,
    xp,
    nextDinoLevel,
    rounds
  };
}
