# Dinosaur Survival — Spielserver-API Dokumentation (v1)

Diese dokumentierte HTTP- & WebSocket-API wird gemeinsam vom **Web-Client (React + TypeScript + Three.js)** und vom zukünftigen **Unity-Client (C#)** genutzt.

- **Basis-URL (Entwicklung / Cloud Run):** `https://<host>` (lokal `http://localhost:3000`)
- **Echtzeit-WebSocket:** `wss://<host>/ws`
- **Authentifizierung:** `Authorization: Bearer <token>`
  - **Google/Firebase-Konto:** Reguläres Firebase Auth ID-Token (`user.getIdToken()` im Web-SDK oder Firebase Unity SDK). Der Server prüft die RS256-Signatur kryptographisch gegen Googles öffentliche Zertifikate (ohne IAM-Abhängigkeit).
  - **Gast-Modus:** Signiertes HMAC-SHA256-Gasttoken über `POST /api/v1/auth/guest` (wird im Client nur im Arbeitsspeicher gehalten).

---

## 1. Gesundheit & Server-Uhr

### `GET /api/v1/health`
Liefert Serverstatus, Serverzeit (`serverTimeMs`), Online-Spielerzahl und Speicherstatus.

## 2. Zentrale Spielkonfiguration (Single Source of Truth)

### `GET /api/v1/config`
Liefert verbindliche Konstanten für Web und Unity:
- `maxLevel` (`25`), `marchQueueUnlockLevels` (`[1, 4, 9, 15, 21]`), `worldGrid` (`48 × 27`), Gebäude-Formeln und die 8 Dinosaurier-Arten inkl. Beute-Tabellen.

## 3. Gast-Sitzung & Konto-Migration

### `POST /api/v1/auth/guest`
Erzeugt oder erneuert eine kryptographisch signierte Gast-Sitzung.
```json
{ "existingGuestUid": "guest_optional" }
```
Antwort:
```json
{ "ok": true, "uid": "guest_...", "token": "guest.<payload>.<sig>", "expiresAtMs": 1798322000000, "serverTimeMs": 1795730000000 }
```

### `POST /api/v1/world/migrate-guest` *(Bearer: Firebase ID-Token erforderlich)*
Überführt eine bisherige Gast-Siedlung und einen Gast-Spielstand atomar auf die verifizierte Firebase-UID und entfernt den alten Gast-Eintrag live von der Weltkarte.
```json
{ "guestToken": "guest.<payload>.<sig>" }
```

## 4. Dauerhafter Spielstand (Server & Cloud Firestore)

### `GET /api/v1/player/save` *(Bearer erforderlich)*
Lädt den dauerhaft auf dem Server gespeicherten Spielstand für die verifizierte UID.

### `POST /api/v1/player/save` *(Bearer erforderlich)*
Speichert den aktuellen Spielstand dauerhaft unter der verifizierten UID (ergänzend zur Cloud-Firestore-Sicherung unter `users/{uid}/private/save`).
```json
{ "schemaVersion": 1, "tribeName": "Glutstamm", "state": { "...": "..." } }
```

## 5. Autoritative Spiellogik

### `POST /api/v1/economy/validate-build`
Prüft Gebäudestufe, Kosten, Signalfeuer-Abhängigkeiten und berechnet autoritative Bauzeit & Endzeitstempel.

### `POST /api/v1/combat/dino-hunt`
Berechnet Dino-Jagdkämpfe serverseitig inkl. Helden-Konterbonus, Runden-Kampflog, Verlusten, Beute und nächstem Dino-Level.

## 6. Gemeinsame Multiplayer-Weltkarte & Welt-Chat

### `GET /api/v1/world/state`
Liefert alle aktiven Spielerdörfer (`settlements`), laufende Märsche (`marches`), aktuelle Welt-Chat-Nachrichten (`chat`) und Online-Zahl (`onlinePlayers`).

### `POST /api/v1/world/settlement` *(Bearer erforderlich)*
Registriert oder teleportiert das eigene 2×2-Dorf atomar auf dem 48×27-Raster. Gibt `409 Conflict` zurück, wenn eine der 4 Kacheln durch Hindernisse oder einen anderen Stamm belegt ist.

### `POST /api/v1/world/march` *(Bearer erforderlich)*
Meldet einen aktiven Sammel- oder Jagdmarsch (`status: "active"`) oder schließt ihn ab (`status: "completed"`).

### `GET /api/v1/chat` & `POST /api/v1/chat` *(POST erfordert Bearer)*
Liest die letzten 60 Welt-Chat-Nachrichten oder sendet eine neue Nachricht (max. 240 Zeichen) an alle verbundenen Spieler.

## 7. WebSocket-Ereignisse (`/ws`)
Alle Ereignisse folgen `{ "type": string, "payload": object }`:
- `world:init` — Vollständiger Start-Snapshot
- `world:settlement` — Neue oder verschobene Spielersiedlung
- `world:settlement_removed` — Entfernte Gast-Siedlung nach Konto-Migration
- `world:march` — Neuer oder abgeschlossener Marsch
- `chat:message` — Neue Welt-Chat-Nachricht
- `world:presence` — Aktualisierte Online-Spielerzahl
