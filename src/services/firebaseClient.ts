import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  ResourceKey,
  WorldChatMessageDTO,
  WorldMarchDTO,
  WorldSettlementDTO,
  WorldTradeDTO,
} from '../shared/apiTypes';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const app: FirebaseApp = initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth = getAuth(app);

export const FIREBASE_DIAGNOSTIC_CONFIG = {
  projectId: firebaseConfig.projectId || 'unbekannt',
  authDomain: firebaseConfig.authDomain || 'unbekannt',
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || '(default)',
} as const;

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface FirestoreProbeResult {
  reachable: boolean;
  code: string;
  message: string;
  latencyMs: number;
}

export async function probeFirestoreConnection(): Promise<FirestoreProbeResult> {
  const started = performance.now();
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return {
      reachable: true,
      code: 'ok',
      message: 'Firestore-Server erreichbar',
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const errObj = error as { code?: string; message?: string };
    const code = String(errObj?.code || 'unknown');
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return {
        reachable: false,
        code: code === 'unknown' ? 'unavailable/offline' : code,
        message: msg,
        latencyMs,
      };
    }
    // permission-denied auf test/connection beweist, dass der Firestore-Server aktiv geantwortet hat
    if (code === 'permission-denied' || msg.toLowerCase().includes('missing or insufficient permissions')) {
      return {
        reachable: true,
        code: 'permission-denied (server-ping ok)',
        message: 'Firestore-Server erreichbar (Security Rules aktiv)',
        latencyMs,
      };
    }
    return {
      reachable: false,
      code,
      message: msg,
      latencyMs,
    };
  }
}

async function testConnection(): Promise<void> {
  await probeFirestoreConnection();
}
void testConnection();

// --- Defensive sanitization aligned with firebase-blueprint.json & firestore.rules ---

export function sanitizeTribeName(raw: string, fallback = 'Glutstamm'): string {
  const cleaned = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return cleaned.length >= 2 ? cleaned : fallback;
}

export function clampInt(val: number, min: number, max: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function computeChunkKey(tileX: number, tileY: number): string {
  const cx = Math.floor(clampInt(tileX, 0, 46) / 12);
  const cy = Math.floor(clampInt(tileY, 0, 25) / 9);
  return `${cx}_${cy}`;
}

export function sanitizeId(raw: string): string {
  return String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 96);
}

// --- Auth helpers (Google Popup; Guest play handled gracefully without requiring Anonymous Auth) ---

export function subscribeAuth(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  if (!auth.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

// --- Private Cloud Save & Public Profile ---

export interface CloudSaveRecord {
  uid: string;
  schemaVersion: number;
  tribeName: string;
  state: Record<string, unknown>;
  updatedAt: number;
}

export async function loadCloudSave(uid: string): Promise<CloudSaveRecord | null> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
  const path = `users/${uid}/private/save`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'save'));
    if (!snap.exists()) return null;
    const data = snap.data();
    const updatedAt =
      typeof data.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : Date.now();
    return {
      uid: String(data.uid || uid),
      schemaVersion: Number(data.schemaVersion || 1),
      tribeName: sanitizeTribeName(String(data.tribeName || 'Glutstamm')),
      state: (data.state && typeof data.state === 'object' ? data.state : {}) as Record<
        string,
        unknown
      >,
      updatedAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveCloudState(
  uid: string,
  tribeName: string,
  stateObj: Record<string, unknown>,
  schemaVersion = 1
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}/private/save`;
  const safeName = sanitizeTribeName(tribeName);
  // Clone safely to strip any undefined values before Firestore serialization
  const cleanState = JSON.parse(JSON.stringify(stateObj)) as Record<string, unknown>;
  try {
    await setDoc(doc(db, 'users', uid, 'private', 'save'), {
      uid,
      schemaVersion: clampInt(schemaVersion, 1, 50),
      tribeName: safeName,
      state: cleanState,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncPublicProfileAndSettlement(payload: {
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  power: number;
  tileX: number;
  tileY: number;
}): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== payload.uid) return;
  const safeName = sanitizeTribeName(payload.tribeName);
  const bonfireLevel = clampInt(payload.bonfireLevel, 1, 25);
  const power = clampInt(payload.power, 0, 100000000);
  const tileX = clampInt(payload.tileX, 0, 46);
  const tileY = clampInt(payload.tileY, 0, 25);
  const chunkKey = computeChunkKey(tileX, tileY);

  const profilePath = `users/${payload.uid}/public/profile`;
  try {
    await setDoc(doc(db, 'users', payload.uid, 'public', 'profile'), {
      uid: payload.uid,
      tribeName: safeName,
      bonfireLevel,
      power,
      tileX,
      tileY,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }

  const settlementPath = `world_settlements/${payload.uid}`;
  try {
    await setDoc(doc(db, 'world_settlements', payload.uid), {
      uid: payload.uid,
      tribeName: safeName,
      bonfireLevel,
      power,
      tileX,
      tileY,
      chunkKey,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, settlementPath);
  }
}

export async function publishMarchToFirestore(march: {
  marchId: string;
  uid: string;
  tribeName: string;
  kind: 'gather' | 'hunt';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  targetLabel: string;
}): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== march.uid) return;
  const marchId = sanitizeId(march.marchId);
  if (marchId.length < 3) return;
  const path = `world_marches/${marchId}`;
  try {
    await setDoc(doc(db, 'world_marches', marchId), {
      marchId,
      uid: march.uid,
      tribeName: sanitizeTribeName(march.tribeName),
      kind: march.kind === 'hunt' ? 'hunt' : 'gather',
      fromX: Math.max(0, Math.min(100, Number(march.fromX) || 0)),
      fromY: Math.max(0, Math.min(100, Number(march.fromY) || 0)),
      toX: Math.max(0, Math.min(100, Number(march.toX) || 0)),
      toY: Math.max(0, Math.min(100, Number(march.toY) || 0)),
      targetLabel: String(march.targetLabel || 'Ziel').trim().slice(0, 64) || 'Ziel',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function completeMarchInFirestore(marchIdRaw: string): Promise<void> {
  if (!auth.currentUser) return;
  const marchId = sanitizeId(marchIdRaw);
  if (marchId.length < 3) return;
  const path = `world_marches/${marchId}`;
  try {
    await updateDoc(doc(db, 'world_marches', marchId), {
      status: 'completed',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Ignoriere not-found falls der Marsch nur lokal/auf dem Server existierte
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('No document to update') || msg.includes('not-found')) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function publishChatToFirestore(msg: {
  messageId: string;
  uid: string;
  tribeName: string;
  bonfireLevel: number;
  text: string;
}): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== msg.uid) return;
  const messageId = sanitizeId(msg.messageId);
  const text = String(msg.text || '').trim().slice(0, 240);
  if (messageId.length < 3 || !text) return;
  const path = `world_chat/${messageId}`;
  try {
    await setDoc(doc(db, 'world_chat', messageId), {
      messageId,
      uid: msg.uid,
      tribeName: sanitizeTribeName(msg.tribeName),
      bonfireLevel: clampInt(msg.bonfireLevel, 1, 25),
      text,
      channel: 'world',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

function normalizeTradeResource(raw: unknown): ResourceKey {
  if (raw === 'meat' || raw === 'wood' || raw === 'stone' || raw === 'fur') return raw;
  return 'wood';
}

function parseTradeDoc(id: string, d: Record<string, unknown>): WorldTradeDTO {
  const createdAt =
    typeof (d.createdAt as { toMillis?: () => number } | undefined)?.toMillis === 'function'
      ? (d.createdAt as { toMillis: () => number }).toMillis()
      : Date.now();
  const updatedAt =
    typeof (d.updatedAt as { toMillis?: () => number } | undefined)?.toMillis === 'function'
      ? (d.updatedAt as { toMillis: () => number }).toMillis()
      : createdAt;
  const status =
    d.status === 'completed' || d.status === 'cancelled' ? d.status : 'pending';
  return {
    tradeId: String(d.tradeId || id),
    fromUid: String(d.fromUid || ''),
    fromTribeName: sanitizeTribeName(String(d.fromTribeName || 'Stamm')),
    toUid: String(d.toUid || ''),
    toTribeName: sanitizeTribeName(String(d.toTribeName || 'Nachbar')),
    offerResource: normalizeTradeResource(d.offerResource),
    offerAmount: clampInt(Number(d.offerAmount || 1), 1, 5000),
    requestResource: normalizeTradeResource(d.requestResource),
    requestAmount: clampInt(Number(d.requestAmount || 1), 1, 5000),
    fromConfirmed: Boolean(d.fromConfirmed),
    toConfirmed: Boolean(d.toConfirmed),
    status,
    createdAt,
    updatedAt,
  };
}

export async function createTradeInFirestore(trade: {
  tradeId: string;
  fromUid: string;
  fromTribeName: string;
  toUid: string;
  toTribeName: string;
  offerResource: ResourceKey;
  offerAmount: number;
  requestResource: ResourceKey;
  requestAmount: number;
}): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== trade.fromUid) return;
  const tradeId = sanitizeId(trade.tradeId);
  const toUid = sanitizeId(trade.toUid);
  if (tradeId.length < 3 || !toUid || toUid === trade.fromUid) return;
  const path = `world_trades/${tradeId}`;
  try {
    await setDoc(doc(db, 'world_trades', tradeId), {
      tradeId,
      fromUid: trade.fromUid,
      fromTribeName: sanitizeTribeName(trade.fromTribeName),
      toUid,
      toTribeName: sanitizeTribeName(trade.toTribeName),
      offerResource: normalizeTradeResource(trade.offerResource),
      offerAmount: clampInt(trade.offerAmount, 1, 5000),
      requestResource: normalizeTradeResource(trade.requestResource),
      requestAmount: clampInt(trade.requestAmount, 1, 5000),
      fromConfirmed: false,
      toConfirmed: false,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function confirmTradeInFirestore(tradeIdRaw: string): Promise<WorldTradeDTO | null> {
  const myUid = auth.currentUser?.uid;
  if (!myUid) return null;
  const tradeId = sanitizeId(tradeIdRaw);
  if (tradeId.length < 3) return null;
  const path = `world_trades/${tradeId}`;
  const ref = doc(db, 'world_trades', tradeId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const current = parseTradeDoc(snap.id, snap.data() as Record<string, unknown>);
      if (current.status !== 'pending') return current;

      const isSender = current.fromUid === myUid;
      const isRecipient = current.toUid === myUid;
      if (!isSender && !isRecipient) return null;

      if (isSender) {
        if (current.fromConfirmed) return current;
        const willComplete = current.toConfirmed;
        tx.update(
          ref,
          willComplete
            ? { fromConfirmed: true, status: 'completed', updatedAt: serverTimestamp() }
            : { fromConfirmed: true, updatedAt: serverTimestamp() }
        );
        return {
          ...current,
          fromConfirmed: true,
          status: willComplete ? 'completed' : 'pending',
          updatedAt: Date.now(),
        };
      } else {
        if (current.toConfirmed) return current;
        const willComplete = current.fromConfirmed;
        tx.update(
          ref,
          willComplete
            ? { toConfirmed: true, status: 'completed', updatedAt: serverTimestamp() }
            : { toConfirmed: true, updatedAt: serverTimestamp() }
        );
        return {
          ...current,
          toConfirmed: true,
          status: willComplete ? 'completed' : 'pending',
          updatedAt: Date.now(),
        };
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cancelTradeInFirestore(tradeIdRaw: string): Promise<void> {
  if (!auth.currentUser) return;
  const tradeId = sanitizeId(tradeIdRaw);
  if (tradeId.length < 3) return;
  const path = `world_trades/${tradeId}`;
  try {
    await updateDoc(doc(db, 'world_trades', tradeId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('No document to update') || msg.includes('not-found')) return;
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Real-time Firestore World Listeners (ONLY attach when authenticated!) ---

export function subscribeFirestoreWorld(handlers: {
  onSettlements: (list: WorldSettlementDTO[]) => void;
  onMarches: (list: WorldMarchDTO[]) => void;
  onChat: (list: WorldChatMessageDTO[]) => void;
  onTrades?: (list: WorldTradeDTO[]) => void;
  onListenerStatus?: (
    channel: 'settlements' | 'marches' | 'chat' | 'trades',
    status: 'ok' | 'error',
    detail: string
  ) => void;
}): Unsubscribe {
  if (!auth.currentUser) {
    return () => {};
  }

  const currentUid = auth.currentUser.uid;
  const unsubs: Unsubscribe[] = [];

  const settlementsPath = 'world_settlements';
  const settlementsQuery = query(collection(db, settlementsPath), limit(80));
  unsubs.push(
    onSnapshot(
      settlementsQuery,
      (snap) => {
        const items: WorldSettlementDTO[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          items.push({
            uid: String(d.uid || docSnap.id),
            tribeName: sanitizeTribeName(String(d.tribeName || 'Stamm')),
            bonfireLevel: clampInt(Number(d.bonfireLevel || 1), 1, 25),
            power: clampInt(Number(d.power || 0), 0, 100000000),
            tileX: clampInt(Number(d.tileX || 23), 0, 46),
            tileY: clampInt(Number(d.tileY || 13), 0, 25),
            chunkKey: String(d.chunkKey || '1_1'),
            updatedAt:
              typeof d.updatedAt?.toMillis === 'function' ? d.updatedAt.toMillis() : Date.now(),
          });
        });
        const src = snap.metadata.fromCache ? 'Cache' : 'Server';
        handlers.onListenerStatus?.(
          'settlements',
          'ok',
          `${items.length} Stämme (${src}${snap.metadata.hasPendingWrites ? ', ausstehend' : ''})`
        );
        handlers.onSettlements(items);
      },
      (error) => {
        const errObj = error as { code?: string; message?: string };
        handlers.onListenerStatus?.(
          'settlements',
          'error',
          `${errObj?.code || 'error'}: ${errObj?.message || String(error)}`
        );
        handleFirestoreError(error, OperationType.LIST, settlementsPath);
      }
    )
  );

  const marchesPath = 'world_marches';
  const marchesQuery = query(
    collection(db, marchesPath),
    where('status', '==', 'active'),
    limit(40)
  );
  unsubs.push(
    onSnapshot(
      marchesQuery,
      (snap) => {
        const now = Date.now();
        const items: WorldMarchDTO[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const startedAt =
            typeof d.createdAt?.toMillis === 'function' ? d.createdAt.toMillis() : now;
          items.push({
            marchId: String(d.marchId || docSnap.id),
            uid: String(d.uid || ''),
            tribeName: sanitizeTribeName(String(d.tribeName || 'Stamm')),
            kind: d.kind === 'hunt' ? 'hunt' : 'gather',
            fromX: Number(d.fromX || 50),
            fromY: Number(d.fromY || 50),
            toX: Number(d.toX || 50),
            toY: Number(d.toY || 50),
            targetLabel: String(d.targetLabel || 'Ziel'),
            startedAt,
            endsAt: startedAt + 14000,
            status: d.status === 'completed' ? 'completed' : 'active',
          });
        });
        const src = snap.metadata.fromCache ? 'Cache' : 'Server';
        handlers.onListenerStatus?.('marches', 'ok', `${items.length} Märsche (${src})`);
        handlers.onMarches(items);
      },
      (error) => {
        const errObj = error as { code?: string; message?: string };
        handlers.onListenerStatus?.(
          'marches',
          'error',
          `${errObj?.code || 'error'}: ${errObj?.message || String(error)}`
        );
        handleFirestoreError(error, OperationType.LIST, marchesPath);
      }
    )
  );

  const chatPath = 'world_chat';
  const chatQuery = query(
    collection(db, chatPath),
    orderBy('createdAt', 'desc'),
    limit(40)
  );
  unsubs.push(
    onSnapshot(
      chatQuery,
      (snap) => {
        const items: WorldChatMessageDTO[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          items.push({
            messageId: String(d.messageId || docSnap.id),
            uid: String(d.uid || ''),
            tribeName: sanitizeTribeName(String(d.tribeName || 'Stamm')),
            bonfireLevel: clampInt(Number(d.bonfireLevel || 1), 1, 25),
            text: String(d.text || ''),
            channel: 'world',
            createdAt:
              typeof d.createdAt?.toMillis === 'function' ? d.createdAt.toMillis() : Date.now(),
          });
        });
        items.reverse();
        const src = snap.metadata.fromCache ? 'Cache' : 'Server';
        handlers.onListenerStatus?.('chat', 'ok', `${items.length} Nachrichten (${src})`);
        handlers.onChat(items);
      },
      (error) => {
        const errObj = error as { code?: string; message?: string };
        handlers.onListenerStatus?.(
          'chat',
          'error',
          `${errObj?.code || 'error'}: ${errObj?.message || String(error)}`
        );
        handleFirestoreError(error, OperationType.LIST, chatPath);
      }
    )
  );

  // Zwei getrennte participant-scoped Queries für world_trades (kein Composite-Index nötig, 100% Rule-konform)
  const tradesPath = 'world_trades';
  const outgoingTrades = new Map<string, WorldTradeDTO>();
  const incomingTrades = new Map<string, WorldTradeDTO>();
  const emitMergedTrades = (src: string) => {
    const merged = new Map<string, WorldTradeDTO>();
    outgoingTrades.forEach((t, id) => merged.set(id, t));
    incomingTrades.forEach((t, id) => merged.set(id, t));
    const list = Array.from(merged.values());
    handlers.onListenerStatus?.('trades', 'ok', `${list.length} Tauschangebote (${src})`);
    handlers.onTrades?.(list);
  };

  const outgoingQuery = query(
    collection(db, tradesPath),
    where('fromUid', '==', currentUid),
    limit(25)
  );
  unsubs.push(
    onSnapshot(
      outgoingQuery,
      (snap) => {
        outgoingTrades.clear();
        snap.forEach((docSnap) => {
          outgoingTrades.set(docSnap.id, parseTradeDoc(docSnap.id, docSnap.data() as Record<string, unknown>));
        });
        emitMergedTrades(snap.metadata.fromCache ? 'Cache' : 'Server');
      },
      (error) => {
        const errObj = error as { code?: string; message?: string };
        handlers.onListenerStatus?.(
          'trades',
          'error',
          `${errObj?.code || 'error'}: ${errObj?.message || String(error)}`
        );
        handleFirestoreError(error, OperationType.LIST, tradesPath);
      }
    )
  );

  const incomingQuery = query(
    collection(db, tradesPath),
    where('toUid', '==', currentUid),
    limit(25)
  );
  unsubs.push(
    onSnapshot(
      incomingQuery,
      (snap) => {
        incomingTrades.clear();
        snap.forEach((docSnap) => {
          incomingTrades.set(docSnap.id, parseTradeDoc(docSnap.id, docSnap.data() as Record<string, unknown>));
        });
        emitMergedTrades(snap.metadata.fromCache ? 'Cache' : 'Server');
      },
      (error) => {
        const errObj = error as { code?: string; message?: string };
        handlers.onListenerStatus?.(
          'trades',
          'error',
          `${errObj?.code || 'error'}: ${errObj?.message || String(error)}`
        );
        handleFirestoreError(error, OperationType.LIST, tradesPath);
      }
    )
  );

  return () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        // ignore unsubscribe cleanup errors
      }
    }
  };
}
