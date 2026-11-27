/**
 * Einheitliche API-Verträge (v1) für Web-Client (React + Three.js),
 * Node.js-Spielserver (Cloud Run) und zukünftigen Unity-Client (C#).
 */

export type ResourceKey = 'meat' | 'wood' | 'stone' | 'fur';
export type TroopKey = 'slinger' | 'clubman' | 'dinorider';
export type HeroRole = 'Nahkampf' | 'Tank' | 'Fernkampf';

export interface WorldSettlementDTO {
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  power: number;
  tileX: number;
  tileY: number;
  chunkKey: string;
  updatedAt: number;
}

export interface WorldMarchDTO {
  marchId: string;
  uid: string;
  tribeName: string;
  kind: 'gather' | 'hunt';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  targetLabel: string;
  startedAt: number;
  endsAt: number;
  status: 'active' | 'completed';
}

export interface WorldChatMessageDTO {
  messageId: string;
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  text: string;
  channel: 'world';
  createdAt: number;
}

export type WorldTradeStatus = 'pending' | 'completed' | 'cancelled';

export interface WorldTradeDTO {
  tradeId: string;
  fromUid: string;
  fromTribeName: string;
  toUid: string;
  toTribeName: string;
  offerResource: ResourceKey;
  offerAmount: number;
  requestResource: ResourceKey;
  requestAmount: number;
  fromConfirmed: boolean;
  toConfirmed: boolean;
  status: WorldTradeStatus;
  createdAt: number;
  updatedAt: number;
}

export interface BuildValidationRequest {
  buildingId: string;
  currentLevel: number;
  bonfireLevel: number;
  resources: Record<ResourceKey, number>;
  techBuildSpeedBonus?: number;
}

export interface BuildValidationResponse {
  allowed: boolean;
  reason?: string;
  targetLevel: number;
  cost: Record<ResourceKey, number>;
  durationSec: number;
  serverNowMs: number;
  endsAtMs: number;
}

export interface DinoHuntHeroInput {
  id: string;
  name: string;
  shortName: string;
  role: HeroRole;
  rarity: string;
  color: string;
  level: number;
  skillName: string;
}

export interface DinoHuntCombatRequest {
  dinoId: string;
  speciesId: string;
  dinoLevel: number;
  squadPower: number;
  heroes: DinoHuntHeroInput[];
  troops: Record<TroopKey, number>;
}

export interface DinoCombatRoundDTO {
  round: number;
  actorSide: 'squad' | 'dino';
  heroId: string | null;
  actorName: string;
  actorRole: string;
  actionName: string;
  damage: number;
  isCrit: boolean;
  isShield: boolean;
  squadHp: number;
  dinoHp: number;
  squadHpPct: number;
  dinoHpPct: number;
  logText: string;
}

export interface DinoHuntCombatResponse {
  battleId: string;
  serverTimeMs: number;
  victory: boolean;
  dinoPower: number;
  squadPower: number;
  counterMatched: boolean;
  squadHpMax: number;
  dinoHpMax: number;
  troopsSent: Record<TroopKey, number>;
  troopsLost: Record<TroopKey, number>;
  lostTotal: number;
  resources: Partial<Record<ResourceKey, number>>;
  items: Record<string, number>;
  xp: number;
  nextDinoLevel: number;
  rounds: DinoCombatRoundDTO[];
}

export interface WorldStateResponse {
  serverTimeMs: number;
  onlinePlayers: number;
  settlements: WorldSettlementDTO[];
  marches: WorldMarchDTO[];
  chat: WorldChatMessageDTO[];
  trades?: WorldTradeDTO[];
}

export interface TeleportRequest {
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  power: number;
  tileX: number;
  tileY: number;
}

export interface TeleportResponse {
  ok: boolean;
  reason?: string;
  settlement?: WorldSettlementDTO;
  serverTimeMs: number;
}

export interface GuestAuthResponse {
  ok: boolean;
  uid: string;
  token: string;
  expiresAtMs: number;
  serverTimeMs: number;
}

export interface PlayerSaveDTO {
  uid: string;
  schemaVersion: number;
  tribeName: string;
  state: Record<string, unknown>;
  updatedAt: number;
}

export interface MigrateGuestResponse {
  ok: boolean;
  removedGuestUid: string | null;
  settlement: WorldSettlementDTO | null;
  serverTimeMs: number;
}

export type RealtimeEvent =
  | { type: 'world:init'; payload: WorldStateResponse }
  | { type: 'world:settlement'; payload: WorldSettlementDTO }
  | { type: 'world:settlement_removed'; payload: { uid: string } }
  | { type: 'world:march'; payload: WorldMarchDTO }
  | { type: 'world:trade'; payload: WorldTradeDTO }
  | { type: 'chat:message'; payload: WorldChatMessageDTO }
  | { type: 'world:presence'; payload: { onlinePlayers: number; serverTimeMs: number } };

