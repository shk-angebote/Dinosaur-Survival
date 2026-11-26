# Dinosaur Survival — Dokumentierte Game-Server API (v1)

Diese Schnittstelle trennt Spieloberfläche und Spiellogik vollständig. Sowohl der aktuelle **Web-Client (React + TypeScript + Three.js)** als auch ein zukünftiger **Unity-Client (C#)** sprechen exakt dieselben Endpunkte an und teilen sich dieselbe Spielwelt.

---

## Basis-URL & Authentifizierung
- **HTTP Basis-Pfad:** `/api/v1`
- **Echtzeit-WebSocket:** `ws://<host>/ws` (bzw. `wss://<host>/ws` auf Cloud Run)
- **Authentifizierung:** Spieler melden sich über **Firebase Authentication** (Gast oder Google-Konto) an und übergeben ihre Spieler-ID (`uid`) bzw. das Firebase ID-Token im Header `Authorization: Bearer <ID_TOKEN>`.

---

## 1. Server-Status & Zeit-Synchronisation
`GET /api/v1/health`

Liefert den Serverzustand und die autoritative Server-Uhr (`serverTimeMs`), damit Bauzeiten und Märsche auf allen Geräten synchron laufen.

```json
{
  "ok": true,
  "service": "dinosaur-survival-server",
  "apiVersion": "v1",
  "serverTimeMs": 1795600000000,
  "onlinePlayers": 12,
  "settlementsCount": 8
}
```

---

## 2. Zentrale Spielkonfiguration (Single Source of Truth)
`GET /api/v1/config`

Liefert alle verbindlichen Spieltabellen (Max-Stufe 25, Marschwarteschlangen-Stufen `[1,4,9,15,21]`, Gebäudekosten, Dino-Arten, Beute-Chancen und Weltkarten-Raster `48×27`). Unity lädt diese Tabelle beim Start, sodass Web und Unity niemals unterschiedliche Werte verwenden.

---

## 3. Serverseitige Bau- & Zeitprüfung
`POST /api/v1/economy/validate-build`

Prüft Gebäudekosten, Signalfeuer-Abhängigkeit und berechnet das verbindliche Bauende (`endsAtMs`) anhand der Server-Uhr.

**Request:**
```json
{
  "buildingId": "quarry",
  "currentLevel": 3,
  "bonfireLevel": 4,
  "resources": { "meat": 400, "wood": 600, "stone": 250, "fur": 120 },
  "techBuildSpeedBonus": 0.1
}
```

---

## 4. Serverseitige Dino-Jagd Kampfberechnung
`POST /api/v1/combat/dino-hunt`

Berechnet Sieg/Niederlage, Truppenverluste, Beute, XP und das komplette Runden-Kampfprotokoll fälschungssicher auf dem Server. Web und Unity spielen das zurückgelieferte `rounds`-Array visuell ab.

**Response-Auszug:**
```json
{
  "battleId": "battle_1795600000000_421",
  "victory": true,
  "dinoPower": 780,
  "squadPower": 1420,
  "counterMatched": true,
  "lostTotal": 0,
  "resources": { "meat": 130, "fur": 42 },
  "items": { "bones": 1 },
  "xp": 70,
  "rounds": [
    { "round": 1, "actorSide": "squad", "actorName": "Torv", "damage": 310, "isCrit": true }
  ]
}
```

---

## 5. Gemeinsame Multiplayer-Weltkarte
- `GET /api/v1/world/state` — Liefert alle aktiven Spielerdörfer (`settlements`), laufende Märsche (`marches`) und die letzten 60 Welt-Chat-Nachrichten (`chat`).
- `POST /api/v1/world/settlement` — Registriert oder teleportiert eine `2×2`-Spielersiedlung atomar. Prüft serverseitig Hindernisse und andere Spielerdörfer (Antwort `409 Conflict`, falls eine der 4 Kacheln belegt ist).
- `POST /api/v1/world/march` — Meldet einen laufenden Sammel- oder Jagdmarsch an und verteilt ihn per WebSocket an alle Spieler.

---

## 6. Globaler Welt-Chat
- `GET /api/v1/chat` — Aktuelle Nachrichten abrufen.
- `POST /api/v1/chat` — Neue Nachricht senden (`text` max. 240 Zeichen); wird sofort per WebSocket (`chat:message`) an alle verbundenen Clients verteilt.

---

## 7. WebSocket Echtzeit-Ereignisse (`/ws`)
Alle Ereignisse folgen dem Schema `{ "type": "...", "payload": ... }`:
- `world:init` — Vollständiger Startzustand direkt nach dem Verbinden.
- `world:settlement` — Ein Spieler hat sein Dorf gegründet, ausgebaut oder teleportiert.
- `world:march` — Ein neuer Sammel- oder Jagdmarsch wurde gestartet.
- `chat:message` — Neue Nachricht im Welt-Chat.
- `world:presence` — Aktualisierte Anzahl gleichzeitig verbundener Spieler.
