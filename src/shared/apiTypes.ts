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

export interface WorldNodeOccupantDTO {
  nodeId: string;
  uid: string;
  tribeName: string;
  marchId: string;
  squadPower: number;
  heroIds: string[];
  heroNames: string[];
  troops: Record<TroopKey, number>;
  startedAt: number;
  endsAt: number;
  targetAmount: number;
  resource: ResourceKey;
}

export interface WorldNodeContestResultDTO {
  contestId: string;
  nodeId: string;
  nodeName: string;
  resource: ResourceKey;
  attackerUid: string;
  attackerTribeName: string;
  attackerPower: number;
  defenderUid: string;
  defenderTribeName: string;
  defenderPower: number;
  attackerWon: boolean;
  attackerLossRate: number;
  defenderLossRate: number;
  defenderCollectedBeforeEviction: number;
  timestamp: number;
}

export interface WorldDynamicSpawnDTO {
  key: string;
  kind: 'node' | 'dino';
  id: string;
  xPct: number;
  yPct: number;
  resource?: ResourceKey;
  name?: string;
  level: number;
  capacity?: number;
  remaining?: number;
  speciesId?: string;
  spawnVersion: number;
  updatedAt: number;
}

export interface NodeOccupyRequest {
  nodeId: string;
  nodeName: string;
  marchId: string;
  tribeName: string;
  squadPower: number;
  heroIds: string[];
  heroNames: string[];
  troops: Record<TroopKey, number>;
  gatherSec: number;
  targetAmount: number;
  resource: ResourceKey;
}

export interface NodeOccupyResponse {
  ok: boolean;
  occupied: boolean;
  occupant: WorldNodeOccupantDTO | null;
  contest?: WorldNodeContestResultDTO;
  serverTimeMs: number;
  error?: string;
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
  nodeOccupants?: WorldNodeOccupantDTO[];
  dynamicSpawns?: WorldDynamicSpawnDTO[];
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
  | { type: 'world:node_occupant'; payload: { nodeId: string; occupant: WorldNodeOccupantDTO | null } }
  | { type: 'world:node_contest'; payload: WorldNodeContestResultDTO }
  | { type: 'world:spawn_update'; payload: WorldDynamicSpawnDTO }
  | { type: 'chat:message'; payload: WorldChatMessageDTO }
  | { type: 'world:presence'; payload: { onlinePlayers: number; serverTimeMs: number } };

