/**
 * Kryptographische Token-Prüfung für den Dinosaur-Survival-Spielserver:
 * 1) Verifiziert Firebase Auth ID-Tokens (RS256) gegen Googles offizielle X509-Zertifikate
 *    — funktioniert ohne IAM sowohl im AI-Studio Starter-Tier als auch später auf Cloud Run & mit Unity.
 * 2) Erzeugt und prüft signierte Gast-Sitzungstokens (HMAC-SHA256) mit Timing-Safe-Vergleich,
 *    damit Gast-Spieler ihre eigene Siedlung sicher steuern können, ohne fremde UIDs zu überschreiben.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const SESSION_SECRET: Buffer = process.env.GAME_SESSION_SECRET
  ? Buffer.from(process.env.GAME_SESSION_SECRET, 'utf8')
  : crypto.randomBytes(32);

function loadFirebaseProjectId(): string {
  try {
    const cfgPath = path.resolve(__dirname, '../../firebase-applet-config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    return typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
  } catch {
    return '';
  }
}

export const FIREBASE_PROJECT_ID = loadFirebaseProjectId();

let cachedCerts: Record<string, string> = {};
let certsExpiresAtMs = 0;

async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && certsExpiresAtMs > now && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Google X509 Zertifikate konnten nicht geladen werden (${res.status})`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, Math.min(86400, Number(maxAgeMatch[1]))) : 3600;
  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpiresAtMs = now + maxAgeSec * 1000;
  return cachedCerts;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(normalized + pad, 'base64').toString('utf8');
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export interface VerifiedAuthIdentity {
  uid: string;
  isGuest: boolean;
  email: string | null;
  provider: 'firebase' | 'guest';
}

export function issueGuestSessionToken(existingGuestUid?: string): {
  uid: string;
  token: string;
  expiresAtMs: number;
} {
  const cleanExisting =
    typeof existingGuestUid === 'string' && /^guest_[a-zA-Z0-9_-]{6,64}$/.test(existingGuestUid)
      ? existingGuestUid
      : `guest_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  const expiresAtMs = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 Tage
  const payload = Buffer.from(
    JSON.stringify({ uid: cleanExisting, exp: expiresAtMs }),
    'utf8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return {
    uid: cleanExisting,
    token: `guest.${payload}.${sig}`,
    expiresAtMs,
  };
}

export function verifyGuestSessionToken(token: string): VerifiedAuthIdentity | null {
  if (!token.startsWith('guest.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest();
  const actualSig = decodeBase64UrlBuffer(sigB64);
  if (expectedSig.length !== actualSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, actualSig)) return null;

  const payload = decodeBase64UrlJson<{ uid?: string; exp?: number }>(payloadB64);
  if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
  if (!/^guest_[a-zA-Z0-9_-]{6,64}$/.test(payload.uid)) return null;
  if (payload.exp < Date.now()) return null;

  return {
    uid: payload.uid,
    isGuest: true,
    email: null,
    provider: 'guest',
  };
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedAuthIdentity | null> {
  if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID === 'remixed-project-id') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
  }>(payloadB64);

  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 128) {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(payload.sub)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

  let certs = await getGooglePublicCerts(false);
  let pem = certs[header.kid];
  if (!pem) {
    certs = await getGooglePublicCerts(true);
    pem = certs[header.kid];
  }
  if (!pem) return null;

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = decodeBase64UrlBuffer(sigB64);
  const ok = crypto.verify('RSA-SHA256', signingInput, pem, signature);
  if (!ok) return null;

  return {
    uid: payload.sub,
    isGuest: false,
    email: typeof payload.email === 'string' ? payload.email : null,
    provider: 'firebase',
  };
}

export async function verifyBearerHeader(
  authHeader: string | undefined
): Promise<VerifiedAuthIdentity | null> {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  if (token.startsWith('guest.')) {
    return verifyGuestSessionToken(token);
  }
  try {
    return await verifyFirebaseIdToken(token);
  } catch {
    return null;
  }
}
