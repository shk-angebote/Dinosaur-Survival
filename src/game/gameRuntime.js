/* eslint-disable */
// Extrahierte Spiel-Engine aus dem ursprünglichen Monolithen — sauber eingebunden in die React/TypeScript-Struktur.
let runtimeInitialized = false;
let runtimeHandle = {
  jumpToWorldTile() {},
  forceSave() {},
};

export function initGameRuntime(hooks = {}) {
  if (runtimeInitialized) return runtimeHandle;
  runtimeInitialized = true;

  const notifyReact = (snapshot) => {
    if (typeof hooks.onSnapshot === "function") {
      try {
        hooks.onSnapshot(snapshot);
      } catch {
        // ignore callback errors
      }
    }
  };


        /* =====================================================================
           1. KONFIGURATION, REGELN, GEBÄUDE, FORSCHUNG & EXPEDITIONEN
           ===================================================================== */
        const STORAGE_KEY = 'glut_und_basalt_save_v1';
        const MAX_LEVEL = 25;
        const FREE_FINISH_SEC = 30;
        // Marschwarteschlangen nach Signalfeuer-Stufe (max. 5 Warteschlangen bei St. 21..25)
        const MARCH_QUEUE_UNLOCK_LEVELS = [1, 4, 9, 15, 21];

        // Klassisches 4X-Tempo: erst Sekunden -> Minuten -> Stunden -> Tage (Stufe 1..25)
        const BASE_BUILD_SECONDS = [
          0,
          14,       // St. 1
          32,       // St. 2
          120,      // St. 3 (2m)
          360,      // St. 4 (6m)
          900,      // St. 5 (15m)
          1800,     // St. 6 (30m)
          3600,     // St. 7 (1 Std.)
          6300,     // St. 8 (1 Std. 45m)
          10800,    // St. 9 (3 Std.)
          16200,    // St. 10 (4 Std. 30m)
          23400,    // St. 11 (6 Std. 30m)
          32400,    // St. 12 (9 Std.)
          43200,    // St. 13 (12 Std.)
          57600,    // St. 14 (16 Std.)
          72000,    // St. 15 (20 Std.)
          86400,    // St. 16 (1 Tag)
          108000,   // St. 17 (1 T. 6 Std.)
          129600,   // St. 18 (1 T. 12 Std.)
          158400,   // St. 19 (1 T. 20 Std.)
          194400,   // St. 20 (2 T. 6 Std.)
          237600,   // St. 21 (2 T. 18 Std.)
          288000,   // St. 22 (3 T. 8 Std.)
          345600,   // St. 23 (4 Tage)
          432000,   // St. 24 (5 Tage)
          518400    // St. 25 (6 Tage)
        ];

        // Strikte 2-Gebäude-Regel für das Große Signalfeuer (X -> X+1):
        // 1) Pflichtgebäude: Wohnhütte >= X
        // 2) Rotierendes Gebäude: X=1 Jagdhütte, X=2 Holzfäller-Camp, X=3 Steinbruch, X=4 Werkstatt, zyklisch weiter
        const BONFIRE_ROTATION = ['hunter', 'lumber', 'quarry', 'workshop'];

        function getBonfireSecondReq(currentBonfireLevel) {
          const idx = (currentBonfireLevel - 1) % BONFIRE_ROTATION.length;
          return {
            buildingId: BONFIRE_ROTATION[idx],
            minLevel: currentBonfireLevel
          };
        }

        const BUILDINGS = {
          bonfire: {
            id: 'bonfire',
            name: 'Großes Signalfeuer',
            shortName: 'Signalfeuer',
            role: 'Hauptgebäude & Wärmezentrum',
            desc: 'Legt automatisch Holz nach, solange Vorrat besteht. Bestimmt das maximale Stufen-Limit aller Gebäude und lässt sich dauerhaft zwischen Normal- und Überheizmodus umschalten.',
            pos: { x: 50.0, y: 57.3 },
            isMain: true,
            hasWorkers: true,
            workerLabel: 'Feuerhüter',
            workerDesc: 'Jeder Feuerhüter spart 10 % Holzverbrauch und stabilisiert die Glut im Sturm.',
            timeMult: 1.35,
            baseCost: { wood: 50, stone: 24, fur: 14 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : Math.min(6, Math.ceil(lvl * 0.6) + 1))
          },
          lumber: {
            id: 'lumber',
            name: 'Holzfäller-Camp',
            shortName: 'Holzfäller',
            role: 'Holz-Gewinnung',
            desc: 'Liefert Bauholz und laufenden Brennstoff, den das Große Signalfeuer automatisch verfeuert.',
            pos: { x: 20.0, y: 37.2 },
            hasWorkers: true,
            workerLabel: 'Holzfäller',
            workerDesc: 'Produziert stetig Holz für Ausbau und Signalfeuer.',
            timeMult: 1.0,
            baseCost: { wood: 32, stone: 14 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : lvl + 1),
            prodPerWorkerPerMin: (lvl) => 9 + (lvl - 1) * 4.5
          },
          quarry: {
            id: 'quarry',
            name: 'Steinbruch',
            shortName: 'Steinbruch',
            role: 'Stein-Gewinnung',
            desc: 'Bricht Basalt und Feuerstein für massive Bauten, Werkzeuge und Forschungen.',
            pos: { x: 35.8, y: 24.3 },
            hasWorkers: true,
            workerLabel: 'Steinmetze',
            workerDesc: 'Bricht Basaltstein für höhere Ausbaustufen und Werkzeuge.',
            timeMult: 1.05,
            baseCost: { wood: 34, stone: 12 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : lvl + 1),
            prodPerWorkerPerMin: (lvl) => 6.5 + (lvl - 1) * 3.4,
            unlockReq: [{ buildingId: 'lumber', minLevel: 1 }]
          },
          hunter: {
            id: 'hunter',
            name: 'Jagdhütte',
            shortName: 'Jagdhütte',
            role: 'Fleisch & Fell',
            desc: 'Versorgt den Stamm mit Fleisch und liefert warmes Fell für Hütten und Kälteschutz.',
            pos: { x: 56.0, y: 31.7 },
            hasWorkers: true,
            workerLabel: 'Jäger',
            workerDesc: 'Jagt Urzeit-Wild für Fleisch (Nahrung) und Fell (Isolierung).',
            timeMult: 1.0,
            baseCost: { wood: 35, stone: 15, fur: 10 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : lvl + 1),
            meatPerWorkerPerMin: (lvl) => 8.5 + (lvl - 1) * 4.2,
            furPerWorkerPerMin: (lvl) => 3.2 + (lvl - 1) * 1.7
          },
          hut: {
            id: 'hut',
            name: 'Wohnhütte',
            shortName: 'Wohnhütte',
            role: 'Unterkunft & Stamm',
            desc: 'Erhöht das maximale Bewohner-Limit. Solange Nahrung und Glut stabil sind, schließen sich neue Stammesmitglieder an. Pflichtgebäude für jeden Ausbau des Signalfeuers.',
            pos: { x: 79.0, y: 22.9 },
            hasWorkers: false,
            timeMult: 0.95,
            baseCost: { wood: 38, fur: 20 },
            popCap: (lvl) => 5 + lvl * 3
          },
          slinger: {
            id: 'slinger',
            name: 'Steinschleuderer-Lager',
            shortName: 'Steinschleuderer',
            role: 'Fernkampf',
            troopType: 'slinger',
            desc: 'Bildet Fernkampf-Steinschleuderer aus, die deine Stammes-Kampfkraft stärken und Expeditionen sichern.',
            pos: { x: 19.0, y: 60.2 },
            hasWorkers: false,
            timeMult: 1.0,
            baseCost: { wood: 36, stone: 22, fur: 10 }
          },
          clubman: {
            id: 'clubman',
            name: 'Keulenschwinger-Arena',
            shortName: 'Keulenschwinger',
            role: 'Nahkampf',
            troopType: 'clubman',
            desc: 'Trainiert zähe Nahkampf-Keulenschwinger für die Verteidigung des Lagers und Raubzüge.',
            pos: { x: 81.2, y: 67.3 },
            hasWorkers: false,
            timeMult: 1.0,
            baseCost: { wood: 38, stone: 18, fur: 12 }
          },
          dinorider: {
            id: 'dinorider',
            name: 'Dinoreiter-Gehege',
            shortName: 'Dinoreiter',
            role: 'Tank',
            troopType: 'dinorider',
            desc: 'Zähmt gepanzerte Urzeit-Reittiere als schwere Tank-Einheiten mit gewaltiger Kampfkraft.',
            pos: { x: 27.5, y: 85.1 },
            hasWorkers: false,
            timeMult: 1.2,
            baseCost: { meat: 40, wood: 46, stone: 30, fur: 22 }
          },
          hero_cave: {
            id: 'hero_cave',
            name: 'Heldenhöhle',
            shortName: 'Heldenhöhle',
            role: 'Knochen-Beschwörung',
            isHeroCave: true,
            desc: 'Uralte Opferhöhle im Basaltfelsen: Ziehe hier mit Knochen oder Goldenen Knochen mächtige Stammes-Helden — oder birg wertvolle Rohstoff-Funde.',
            pos: { x: 14.8, y: 17.6 },
            hasWorkers: false,
            timeMult: 1.05,
            baseCost: { wood: 42, stone: 32, fur: 16 }
          },
          workshop: {
            id: 'workshop',
            name: 'Werkstatt / Schamanen-Zelt',
            shortName: 'Forschungszelt',
            role: 'Forschungsgebäude',
            desc: 'Eigenständiges Forschungsgebäude der Siedlung: Öffne dieses Gebäude, um den Urzeit-Forschungsbaum zu verwalten, neue Technologien zu starten und Schamanen einzuteilen.',
            pos: { x: 49.5, y: 95.2 },
            hasWorkers: true,
            workerLabel: 'Schamanen',
            workerDesc: 'Jeder Schamane beschleunigt laufende Forschungen um +8 %.',
            timeMult: 1.15,
            baseCost: { wood: 48, stone: 28, fur: 22 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : Math.min(5, Math.ceil(lvl * 0.5) + 1)),
            unlockReq: [{ buildingId: 'bonfire', minLevel: 2 }]
          },
          scout: {
            id: 'scout',
            name: 'Späher-Posten',
            shortName: 'Späher-Posten',
            role: 'Wildnis & Expeditionen',
            desc: 'Rüstet Jäger für freiwillige Expeditionen in die Dino-Wildnis aus und schaltet gefährlichere Beuteziele frei.',
            pos: { x: 73.2, y: 86.0 },
            hasWorkers: true,
            workerLabel: 'Fährtenleser',
            workerDesc: 'Jeder Fährtenleser verkürzt Expeditionszeiten um +6 %.',
            timeMult: 1.1,
            baseCost: { wood: 44, stone: 24, fur: 20 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : Math.min(4, Math.ceil(lvl * 0.5) + 1)),
            unlockReq: [{ buildingId: 'hunter', minLevel: 2 }]
          },
          infirmary: {
            id: 'infirmary',
            name: 'Krankenzelt',
            shortName: 'Krankenzelt',
            role: 'Heilung & Lazarett',
            desc: 'Versorgt im Kampf verletzte Einheiten, damit sie nicht verloren gehen. Höhere Stufen erhöhen die Betten-Kapazität und Heiler beschleunigen die Genesung.',
            pos: { x: 14.0, y: 84.0 },
            hasWorkers: true,
            workerLabel: 'Heiler',
            workerDesc: 'Jeder Heiler beschleunigt die Heilung verletzter Einheiten um +15 %.',
            timeMult: 1.0,
            baseCost: { meat: 20, wood: 36, stone: 18, fur: 24 },
            maxWorkers: (lvl) => (lvl <= 0 ? 0 : Math.min(5, Math.ceil(lvl * 0.5) + 1))
          },
          graveyard: {
            id: 'graveyard',
            name: 'Friedhof',
            shortName: 'Friedhof',
            role: 'Ruhestätte & Wiedererweckung',
            desc: 'Bewahrt gefallene Einheiten aus schweren Gefechten auf. Mit einem Schamanen-Totem kannst du gefallene Krieger wieder ins Leben zurückrufen.',
            pos: { x: 86.0, y: 84.0 },
            hasWorkers: false,
            timeMult: 1.05,
            baseCost: { meat: 15, wood: 30, stone: 38, fur: 14 }
          },
          marketplace: {
            id: 'marketplace',
            name: 'Marktplatz',
            shortName: 'Marktplatz',
            role: 'Handel & Jagd-Ausdauer',
            desc: 'Treffpunkt für Urzeit-Händler: Hole hier alle 12 Stunden kostenlos 300 Ausdauer für die Dinojagd auf der Weltkarte ab.',
            pos: { x: 86.0, y: 28.0 },
            hasWorkers: false,
            timeMult: 1.05,
            baseCost: { meat: 24, wood: 42, stone: 24, fur: 18 }
          },
          warehouse: {
            id: 'warehouse',
            name: 'Lagerhaus',
            shortName: 'Lagerhaus',
            role: 'Ressourcenschutz & Tresor',
            desc: 'Sichert deine wichtigsten Vorräte (Fleisch, Holz, Stein & Fell) mit einer geschützten Safe-Kapazität vor künftigen Multiplayer-Plünderungen.',
            pos: { x: 14.0, y: 26.0 },
            hasWorkers: false,
            timeMult: 1.05,
            baseCost: { meat: 18, wood: 45, stone: 34, fur: 12 }
          }
        };

        const BUILDING_ORDER = [
          'bonfire',
          'lumber',
          'quarry',
          'hunter',
          'hut',
          'slinger',
          'clubman',
          'dinorider',
          'hero_cave',
          'workshop',
          'scout',
          'infirmary',
          'graveyard',
          'marketplace',
          'warehouse'
        ];

        // Zentrales BuildingRegistry-System: verwaltet Errichtungs-Voraussetzungen und UI-Sichtbarkeit aller Gebäude
        const BuildingRegistry = (() => {
          const entries = new Map();

          function normalizeReqs(reqs) {
            if (!Array.isArray(reqs)) return [];
            return reqs
              .filter((r) => r && typeof r.buildingId === 'string' && Number(r.minLevel) > 0)
              .map((r) => ({ buildingId: r.buildingId, minLevel: Math.floor(Number(r.minLevel)) }));
          }

          function register(id, config = {}) {
            if (!id) return;
            entries.set(id, {
              id,
              hideUntilUnlocked: Boolean(config.hideUntilUnlocked),
              requirements: normalizeReqs(config.requirements)
            });
          }

          function get(id) {
            return entries.get(id) || null;
          }

          function getAll() {
            return Array.from(entries.values());
          }

          function getRequirements(id) {
            const entry = entries.get(id);
            if (entry) return entry.requirements;
            const def = BUILDINGS[id];
            return def && Array.isArray(def.unlockReq) ? def.unlockReq : [];
          }

          function areRequirementsMet(id, st = state) {
            const reqs = getRequirements(id);
            if (!reqs.length) return true;
            const bMap = st && st.buildings ? st.buildings : {};
            return reqs.every((req) => ((bMap[req.buildingId] && bMap[req.buildingId].level) || 0) >= req.minLevel);
          }

          function isVisibleInUI(id, st = state) {
            const entry = entries.get(id);
            if (!entry || !entry.hideUntilUnlocked) return true;
            const bMap = st && st.buildings ? st.buildings : {};
            if (((bMap[id] && bMap[id].level) || 0) > 0) return true;
            if (st && st.activeBuild && st.activeBuild.buildingId === id) return true;
            return areRequirementsMet(id, st);
          }

          function getVisibleBuildingIds(st = state) {
            return BUILDING_ORDER.filter((id) => isVisibleInUI(id, st));
          }

          function getMissingRequirements(id, st = state) {
            const reqs = getRequirements(id);
            const bMap = st && st.buildings ? st.buildings : {};
            return reqs
              .map((req) => {
                const cur = (bMap[req.buildingId] && bMap[req.buildingId].level) || 0;
                const rDef = BUILDINGS[req.buildingId];
                return {
                  buildingId: req.buildingId,
                  name: rDef ? rDef.name : req.buildingId,
                  shortName: rDef ? rDef.shortName : req.buildingId,
                  currentLevel: cur,
                  minLevel: req.minLevel,
                  met: cur >= req.minLevel
                };
              })
              .filter((item) => !item.met);
          }

          function getMissingRequirementsText(id, st = state) {
            const missing = getMissingRequirements(id, st);
            if (!missing.length) return '';
            return missing.map((m) => `${m.name} St. ${m.minLevel}`).join(' & ');
          }

          return {
            register,
            get,
            getAll,
            getRequirements,
            areRequirementsMet,
            isVisibleInUI,
            getVisibleBuildingIds,
            getMissingRequirements,
            getMissingRequirementsText
          };
        })();

        for (const id of BUILDING_ORDER) {
          const def = BUILDINGS[id];
          BuildingRegistry.register(id, {
            hideUntilUnlocked: false,
            requirements: (def && def.unlockReq) || []
          });
        }

        // Die 4 neuen Spezialgebäude erscheinen erst im Dorf-UI, sobald ihre Voraussetzungen erfüllt sind
        BuildingRegistry.register('warehouse', {
          hideUntilUnlocked: true,
          requirements: [
            { buildingId: 'lumber', minLevel: 1 },
            { buildingId: 'quarry', minLevel: 1 }
          ]
        });
        BuildingRegistry.register('marketplace', {
          hideUntilUnlocked: true,
          requirements: [
            { buildingId: 'bonfire', minLevel: 2 },
            { buildingId: 'hut', minLevel: 1 }
          ]
        });
        BuildingRegistry.register('infirmary', {
          hideUntilUnlocked: true,
          requirements: [
            { buildingId: 'bonfire', minLevel: 2 },
            { buildingId: 'hunter', minLevel: 1 }
          ]
        });
        BuildingRegistry.register('graveyard', {
          hideUntilUnlocked: true,
          requirements: [{ buildingId: 'infirmary', minLevel: 1 }]
        });
        window.BuildingRegistry = BuildingRegistry;

        const TROOP_DEFS = {
          slinger: {
            id: 'slinger',
            name: 'Steinschleuderer',
            role: 'Fernkampf',
            batchSize: 5,
            powerPerUnit: 14,
            durationSec: 28,
            cost: { meat: 18, wood: 14, stone: 12 }
          },
          clubman: {
            id: 'clubman',
            name: 'Keulenschwinger',
            role: 'Nahkampf',
            batchSize: 5,
            powerPerUnit: 16,
            durationSec: 32,
            cost: { meat: 20, wood: 18, fur: 6 }
          },
          dinorider: {
            id: 'dinorider',
            name: 'Dinoreiter',
            role: 'Tank',
            batchSize: 3,
            powerPerUnit: 42,
            durationSec: 50,
            cost: { meat: 34, wood: 22, stone: 16, fur: 14 }
          }
        };

        const RARITY_META = {
          rare: { label: 'Selten', color: '#60a5fa', basePower: 140 },
          epic: { label: 'Episch', color: '#c084fc', basePower: 260 },
          legendary: { label: 'Legendär', color: '#facc15', basePower: 460 }
        };

        const HEROES_LIST = [
          {
            id: 'rexar',
            name: 'Rexar der Glutreiter',
            rarity: 'legendary',
            role: 'Tank',
            bonusType: 'wood_stone',
            baseBonusPct: 12,
            bonusLabel: (pct) => `+${pct} % Holz- & Stein-Ausbeute in der Siedlung`,
            lore: 'Bändigte einen gepanzerten Triceratops direkt am Rand der Zentralcaldera.'
          },
          {
            id: 'aurelia',
            name: 'Aurelia die Glutschamanin',
            rarity: 'legendary',
            role: 'Fernkampf',
            bonusType: 'fire_research',
            baseBonusPct: 14,
            bonusLabel: (pct) => `-${Math.round(pct * 0.7)} % Signalfeuer-Holz & +${pct} % Forschungstempo`,
            lore: 'Bewahrt die ältesten Obsidian-Runen und zähmt die Flammen im Sturm.'
          },
          {
            id: 'valkor',
            name: 'Valkor Mammutbrecher',
            rarity: 'epic',
            role: 'Tank',
            bonusType: 'stone',
            baseBonusPct: 14,
            bonusLabel: (pct) => `+${pct} % Steinbruch-Ertrag`,
            lore: 'Seine Basaltkeule spaltet Felsen so mühelos wie Knochen.'
          },
          {
            id: 'zara',
            name: 'Zara Raptorjägerin',
            rarity: 'epic',
            role: 'Fernkampf',
            bonusType: 'meat_fur',
            baseBonusPct: 14,
            bonusLabel: (pct) => `+${pct} % Fleisch- & Fell-Ausbeute`,
            lore: 'Kein Raubsaurier entgeht ihren Obsidian-Schleudergeschossen.'
          },
          {
            id: 'brak',
            name: 'Brak Holzspalter',
            rarity: 'epic',
            role: 'Nahkampf',
            bonusType: 'wood',
            baseBonusPct: 14,
            bonusLabel: (pct) => `+${pct} % Holzfäller-Ertrag`,
            lore: 'Führt die schwersten Axt-Trupps durch die verkohlten Aschewälder.'
          },
          {
            id: 'krag',
            name: 'Krag Felsenhauer',
            rarity: 'rare',
            role: 'Nahkampf',
            bonusType: 'stone',
            baseBonusPct: 9,
            bonusLabel: (pct) => `+${pct} % Steinbruch-Ertrag`,
            lore: 'Unermüdlicher Vorarbeiter der tiefen Basaltgruben.'
          },
          {
            id: 'mira',
            name: 'Mira Fährtenleserin',
            rarity: 'rare',
            role: 'Fernkampf',
            bonusType: 'march',
            baseBonusPct: 10,
            bonusLabel: (pct) => `+${pct} % schneller auf Weltkarte & Expeditionen`,
            lore: 'Kennt jeden Schleichweg zwischen den heißen Lavaschluchten.'
          },
          {
            id: 'torv',
            name: 'Torv Stammhüter',
            rarity: 'rare',
            role: 'Nahkampf',
            bonusType: 'wood',
            baseBonusPct: 9,
            bonusLabel: (pct) => `+${pct} % Holzfäller-Ertrag`,
            lore: 'Sorgt dafür, dass der Brennholz-Vorrat niemals abreißt.'
          },
          {
            id: 'sera',
            name: 'Sera Fellgerberin',
            rarity: 'rare',
            role: 'Tank',
            bonusType: 'fur',
            baseBonusPct: 12,
            bonusLabel: (pct) => `+${pct} % Fell-Ertrag der Jagdhütte`,
            lore: 'Verarbeitet dicke Urzeitfelle zu sturmfester Winterkleidung.'
          }
        ];

        const GEAR_ROLE_INFO = {
          melee: { key: 'melee', label: 'Nahkampf', cssClass: 'gear-role-melee' },
          tank: { key: 'tank', label: 'Tank', cssClass: 'gear-role-tank' },
          ranged: { key: 'ranged', label: 'Fernkampf', cssClass: 'gear-role-ranged' }
        };

        const GEAR_ROLE_FROM_LABEL = {
          Nahkampf: 'melee',
          Tank: 'tank',
          Fernkampf: 'ranged'
        };

        const GEAR_SLOTS = [
          { key: 'waffe', title: 'Waffe', short: 'W' },
          { key: 'ruestung', title: 'Rüstung', short: 'R' },
          { key: 'helm', title: 'Helm', short: 'H' },
          { key: 'amulett', title: 'Amulett', short: 'A' }
        ];

        const GEAR_NAMES = {
          melee: {
            waffe: 'Obsidian-Keule',
            ruestung: 'Knochenwams',
            helm: 'Schädelhaube',
            amulett: 'Reißzahn-Kette'
          },
          tank: {
            waffe: 'Hornstoß-Lanze',
            ruestung: 'Schildkrötenpanzer',
            helm: 'Triceratops-Krone',
            amulett: 'Felsbrocken-Totem'
          },
          ranged: {
            waffe: 'Binden-Schleuder',
            ruestung: 'Flugsaurier-Haut',
            helm: 'Späher-Kapuze',
            amulett: 'Bernstein-Linse'
          }
        };

        const GEAR_RARITIES = [
          { key: 'grey', label: 'Gewöhnlich', weight: 45, bonus: 100, xpValue: 15, color: '#a8a29e' },
          { key: 'green', label: 'Ungewöhnlich', weight: 30, bonus: 220, xpValue: 35, color: '#4ade80' },
          { key: 'blue', label: 'Selten', weight: 15, bonus: 420, xpValue: 70, color: '#60a5fa' },
          { key: 'purple', label: 'Episch', weight: 8, bonus: 750, xpValue: 140, color: '#c084fc' },
          { key: 'gold', label: 'Mythisch', weight: 2, bonus: 1300, xpValue: 280, color: '#facc15' }
        ];

        const GEAR_RARITY_MAP = Object.fromEntries(GEAR_RARITIES.map((r) => [r.key, r]));

        const MAX_SKILL_LEVEL = 6;

        // 6 Fähigkeiten pro Held (3x PvP mit PvP-Malerei + 3x Dinojagd & Wildnis mit PvE-Malerei)
        const HERO_SKILLS_MAP = {
          rexar: {
            pvp: [
              { id: 'rx_pvp1', name: 'Horn-Ansturm', desc: (lv) => `Zieht feindliche Angriffe auf sich und blockt ${20 + lv * 5}% Schaden.` },
              { id: 'rx_pvp2', name: 'Glutreiter-Panzer', desc: (lv) => `Erhöht Lebenspunkte aller verbündeten Dinoreiter um +${10 + lv * 4}%.` },
              { id: 'rx_pvp3', name: 'Konterklaue', desc: (lv) => `Reflektiert ${8 + lv * 3}% Nahkampfschaden zurück auf Angreifer.` }
            ],
            pve: [
              { id: 'rx_pve1', name: 'Rudel-Hohn', desc: (lv) => `Zwingt wilde Raubsaurier auf Rexar und senkt ihren Schaden um ${10 + lv * 4}%.` },
              { id: 'rx_pve2', name: 'Caldera-Bollwerk', desc: (lv) => `Erhöht Holz- & Stein-Ausbeute bei Wildnis-Funden um +${8 + lv * 4}%.` },
              { id: 'rx_pve3', name: 'Last-Packtier', desc: (lv) => `Erhöht die Truppen-Traglast auf Weltkarten-Märschen um +${10 + lv * 5}%.` }
            ]
          },
          aurelia: {
            pvp: [
              { id: 'au_pvp1', name: 'Vulkan-Salve', desc: (lv) => `Glühende Asche-Steine bombardieren hintere Reihen für ${180 + lv * 35}% Brandschaden.` },
              { id: 'au_pvp2', name: 'Präzisionsgesang', desc: (lv) => `Erhöht die Krit-Rate aller Steinschleuderer im Kampf um +${8 + lv * 3}%.` },
              { id: 'au_pvp3', name: 'Rauchvorhang', desc: (lv) => `Senkt die Treffsicherheit gegnerischer Fernkämpfer um ${7 + lv * 3}%.` }
            ],
            pve: [
              { id: 'au_pve1', name: 'Schwachstellen-Rune', desc: (lv) => `Fügt gepanzerten Boss-Dinos ${170 + lv * 35}% Extraschaden zu.` },
              { id: 'au_pve2', name: 'Flammen-Weisheit', desc: (lv) => `Verkürzt Expeditionen & Dinojagd-Vorbereitung um ${5 + lv * 2}%.` },
              { id: 'au_pve3', name: 'Rohstoff-Gabe', desc: (lv) => `Erhöht Ressourcenfunde beim Plündern in der Wildnis um +${8 + lv * 4}%.` }
            ]
          },
          valkor: {
            pvp: [
              { id: 'vk_pvp1', name: 'Hornwall', desc: (lv) => `Erzeugt einen Schild über ${15 + lv * 4}% Max-LP für verbündete Nahkämpfer.` },
              { id: 'vk_pvp2', name: 'Bollwerk-Front', desc: (lv) => `Verteidigung der gesamten Frontlinie steigt im PvP um +${8 + lv * 3}%.` },
              { id: 'vk_pvp3', name: 'Basalt-Erschütterung', desc: (lv) => `Senkt den gegnerischen Angriffswert für 3s um ${6 + lv * 3}%.` }
            ],
            pve: [
              { id: 'vk_pve1', name: 'Stampfer-Schutz', desc: (lv) => `Reduziert den Flächenschaden großer Raubsaurier um ${12 + lv * 4}%.` },
              { id: 'vk_pve2', name: 'Großwild-Spur', desc: (lv) => `Verursacht +${10 + lv * 4}% Schaden gegen gepanzerte Urzeit-Saurier.` },
              { id: 'vk_pve3', name: 'Schwere Fracht', desc: (lv) => `Erhöht die Steinbruch-Traglast auf Sammelzügen um +${10 + lv * 4}%.` }
            ]
          },
          zara: {
            pvp: [
              { id: 'zr_pvp1', name: 'Fokus-Schuss', desc: (lv) => `Fügt gegnerischen Kommandanten ${160 + lv * 30}% Schaden zu.` },
              { id: 'zr_pvp2', name: 'Schnellschuss', desc: (lv) => `Erhöht Fernkampf-Angriffstempo der Steinschleuderer um +${6 + lv * 3}%.` },
              { id: 'zr_pvp3', name: 'Ausweichrolle', desc: (lv) => `Chance von ${6 + lv * 2}%, feindlichen Treffern im PvP zu entgehen.` }
            ],
            pve: [
              { id: 'zr_pve1', name: 'Sturzflug-Kiesel', desc: (lv) => `Verursacht ${150 + lv * 28}% Schaden an flinken Raubsauriern.` },
              { id: 'zr_pve2', name: 'Nest-Plünderung', desc: (lv) => `Erhöht Fleisch- & Knochenbeute aus Dino-Nestern um +${10 + lv * 4}%.` },
              { id: 'zr_pve3', name: 'Rückzugs-Eile', desc: (lv) => `Sammel- und Jagdtrupps kehren ${6 + lv * 3}% schneller ins Lager zurück.` }
            ]
          },
          brak: {
            pvp: [
              { id: 'bk_pvp1', name: 'Erdbeben-Schwung', desc: (lv) => `Fügt feindlicher Infanterie ${190 + lv * 32}% Schaden zu und betäubt kurz.` },
              { id: 'bk_pvp2', name: 'Arena-Zorn', desc: (lv) => `Erhöht den Schaden beim Angriff auf fremde Lager um +${8 + lv * 4}%.` },
              { id: 'bk_pvp3', name: 'Stammes-Bollwerk', desc: (lv) => `Reduziert erlittenen Schaden bei eigener Dorf-Verteidigung um ${8 + lv * 3}%.` }
            ],
            pve: [
              { id: 'bk_pve1', name: 'Alpha-Brecher', desc: (lv) => `Unterbricht Sturmangriffe gigantischer Raubsaurier (+${12 + lv * 5}% DMG).` },
              { id: 'bk_pve2', name: 'Beute-Schlächter', desc: (lv) => `Erhöht Fleisch- & Holzbeute bei Wildnis-Expeditionen um +${10 + lv * 4}%.` },
              { id: 'bk_pve3', name: 'Aschepfad-Marsch', desc: (lv) => `Erhöht Marschtempo in der Aschewüste um +${6 + lv * 3}%.` }
            ]
          },
          krag: {
            pvp: [
              { id: 'kg_pvp1', name: 'Felsbrecher-Hieb', desc: (lv) => `Schmettert gegnerische Schilde für ${155 + lv * 26}% Schaden.` },
              { id: 'kg_pvp2', name: 'Eisenfaust', desc: (lv) => `Erhöht den Nahkampf-Angriff aller Keulenschwinger um +${5 + lv * 2}%.` },
              { id: 'kg_pvp3', name: 'Basalthaut', desc: (lv) => `Reduziert erlittenen Nahkampfschaden im PvP um ${5 + lv * 2}%.` }
            ],
            pve: [
              { id: 'kg_pve1', name: 'Knochen-Spalter', desc: (lv) => `Durchdringt harte Saurierpanzer für ${145 + lv * 24}% Schaden.` },
              { id: 'kg_pve2', name: 'Steinbruch-Ernte', desc: (lv) => `Erhöht das Sammeltempo an Basalt-Sammelstellen um +${8 + lv * 4}%.` },
              { id: 'kg_pve3', name: 'Geröll-Träger', desc: (lv) => `Erhöht die Stein-Transportkapazität auf Märschen um +${8 + lv * 4}%.` }
            ]
          },
          mira: {
            pvp: [
              { id: 'mr_pvp1', name: 'Ablenkungsstein', desc: (lv) => `Verlangsamt gegnerische Einheiten für 3s und verursacht ${135 + lv * 22}% Schaden.` },
              { id: 'mr_pvp2', name: 'Flinke Finger', desc: (lv) => `Erhöht die eigene Fernkampf-Schussrate um +${5 + lv * 2}%.` },
              { id: 'mr_pvp3', name: 'Schluchten-Deckung', desc: (lv) => `Reduziert erlittenen Fernkampfschaden um ${5 + lv * 2}%.` }
            ],
            pve: [
              { id: 'mr_pve1', name: 'Kiesel-Hagel', desc: (lv) => `Schwächt Asche-Wölfe und Raptorlinge für ${140 + lv * 24}% Schaden.` },
              { id: 'mr_pve2', name: 'Kundschafter-Spur', desc: (lv) => `Verkürzt Reisezeiten zu Dino-Höhlen und Sammelstellen um ${6 + lv * 3}%.` },
              { id: 'mr_pve3', name: 'Asche-Spurt', desc: (lv) => `Erhöht das allgemeine Sammeltempo auf der Weltkarte um +${8 + lv * 4}%.` }
            ]
          },
          torv: {
            pvp: [
              { id: 'tv_pvp1', name: 'Stumpfer Hieb', desc: (lv) => `Fügt einem Einzelfeind ${145 + lv * 24}% Nahkampfschaden zu.` },
              { id: 'tv_pvp2', name: 'Wächter-Mut', desc: (lv) => `Erhöht den Angriff verbündeter Nahkämpfer um +${5 + lv * 2}%.` },
              { id: 'tv_pvp3', name: 'Dickes Fell', desc: (lv) => `Erlittener Gesamtschaden sinkt im Kampf um ${4 + lv * 2}%.` }
            ],
            pve: [
              { id: 'tv_pve1', name: 'Stamm-Spalter', desc: (lv) => `Durchdringt dicke Baumriesen und Saurierknochen (+${10 + lv * 4}% DMG).` },
              { id: 'tv_pve2', name: 'Rodungs-Eifer', desc: (lv) => `Erhöht das Holz-Sammeltempo in der Wildnis um +${10 + lv * 4}%.` },
              { id: 'tv_pve3', name: 'Lastenbündel', desc: (lv) => `Erhöht die Holz-Transportkapazität aller Trupps um +${8 + lv * 4}%.` }
            ]
          },
          sera: {
            pvp: [
              { id: 'sr_pvp1', name: 'Kollision', desc: (lv) => `Stößt feindliche Nahkämpfer zurück und verursacht ${135 + lv * 22}% Schaden.` },
              { id: 'sr_pvp2', name: 'Zähigkeit', desc: (lv) => `Verteidigung steigt bei niedrigen LP um +${6 + lv * 3}%.` },
              { id: 'sr_pvp3', name: 'Rudel-Geist', desc: (lv) => `Erhöht Moral und Widerstand verbündeter Einheiten um +${5 + lv * 2}%.` }
            ],
            pve: [
              { id: 'sr_pve1', name: 'Echsen-Zähmung', desc: (lv) => `Besänftigt wilde Dinos und senkt erlittenen Wildnis-Schaden um ${8 + lv * 3}%.` },
              { id: 'sr_pve2', name: 'Packtier-Gespann', desc: (lv) => `Erhöht die Truppen-Traglast auf Sammelzügen um +${10 + lv * 4}%.` },
              { id: 'sr_pve3', name: 'Fell-Meisterin', desc: (lv) => `Erhöht Fleisch- & Fell-Ausbeute bei Jagdzügen um +${8 + lv * 4}%.` }
            ]
          }
        };

        const INVENTORY_ITEMS = [
          {
            id: 'gearChest',
            name: 'Ausrüstungskiste',
            category: 'gear',
            accent: '#f59e0b',
            desc: 'Enthält zufällige Klassen-Ausrüstung (Nahkampf, Tank oder Fernkampf) von Gewöhnlich bis Mythisch. Fundort: Wildnis & Heldenhöhle.',
            actionType: 'open_gear_chest'
          },
          {
            id: 'pvpPaint',
            name: 'PvP-Malerei',
            category: 'bones',
            accent: '#f87171',
            desc: 'Kriegsbemalung zum Aufwerten der 3 PvP-Fähigkeiten deiner Helden (bis Lv. 6). Fundort: Heldenhöhle & Wildnis.',
            actionType: 'goto_skills'
          },
          {
            id: 'pvePaint',
            name: 'PvE-Malerei',
            category: 'bones',
            accent: '#34d399',
            desc: 'Jagd- & Naturbemalung zum Aufwerten der 3 Dinojagd- & Wildnis-Fähigkeiten (bis Lv. 6). Fundort: Wildnis & Heldenhöhle.',
            actionType: 'goto_skills'
          },
          {
            id: 'bones',
            name: 'Urzeit-Knochen',
            category: 'bones',
            accent: '#e7e5e4',
            desc: 'Für Standard-Beschwörungen in der Heldenhöhle (Helden oder Ressourcen-Funde).',
            actionType: 'goto_cave'
          },
          {
            id: 'goldenBones',
            name: 'Goldene Knochen',
            category: 'bones',
            accent: '#facc15',
            desc: 'Für Goldene Beschwörungen in der Heldenhöhle mit Chance auf Legendäre Helden.',
            actionType: 'goto_cave'
          },
          {
            id: 'heroXp',
            name: 'Helden-XP',
            category: 'bones',
            accent: '#60a5fa',
            desc: 'Wird im Helden-Reiter eingesetzt, um deine Stammes-Helden im Level aufzuwerten.',
            actionType: 'goto_heroes'
          },
          {
            id: 'crateMeat',
            name: 'Fleisch-Vorratspaket',
            category: 'resources',
            accent: '#fb7185',
            resource: 'meat',
            amount: 120,
            desc: 'Gewährt beim Öffnen sofort +120 Fleisch für dein Lager.',
            actionType: 'open_crate'
          },
          {
            id: 'crateWood',
            name: 'Holz-Bündel',
            category: 'resources',
            accent: '#f59e0b',
            resource: 'wood',
            amount: 120,
            desc: 'Gewährt beim Öffnen sofort +120 Holz für Ausbau & Signalfeuer.',
            actionType: 'open_crate'
          },
          {
            id: 'crateStone',
            name: 'Basalt-Kiste',
            category: 'resources',
            accent: '#cbd5e1',
            resource: 'stone',
            amount: 100,
            desc: 'Gewährt beim Öffnen sofort +100 Stein für massive Bauten.',
            actionType: 'open_crate'
          },
          {
            id: 'crateFur',
            name: 'Fell-Ballen',
            category: 'resources',
            accent: '#d8b4fe',
            resource: 'fur',
            amount: 90,
            desc: 'Gewährt beim Öffnen sofort +90 Fell für Hütten & Ausrüstung.',
            actionType: 'open_crate'
          },
          {
            id: 'speedup5m',
            name: '5-Min.-Beschleuniger',
            category: 'boosts',
            accent: '#34d399',
            seconds: 300,
            desc: 'Verkürzt laufenden Bau, Forschung oder Truppen-Ausbildung um 5 Minuten.',
            actionType: 'speedup'
          },
          {
            id: 'speedup15m',
            name: '15-Min.-Beschleuniger',
            category: 'boosts',
            accent: '#2dd4bf',
            seconds: 900,
            desc: 'Verkürzt laufenden Bau, Forschung oder Truppen-Ausbildung um 15 Minuten.',
            actionType: 'speedup'
          },
          {
            id: 'teleportItem',
            name: 'Siedlungs-Teleport',
            category: 'boosts',
            accent: '#38bdf8',
            desc: 'Versetzt deine 2×2-Siedlung per Ghost-Vorschau auf ein freies Quadrat-Rasterfeld der Weltkarte.',
            actionType: 'teleport'
          },
          {
            id: 'shamanTotem',
            name: 'Schamanen-Totem',
            category: 'bones',
            accent: '#2dd4bf',
            desc: 'Aktives Ritual-Item: Direkt im Inventar oder am Friedhof einsetzbar, um gefallene Einheiten wiederzubeleben.',
            actionType: 'use_shaman_totem'
          }
        ];

        const FREE_BONE_COOLDOWN_MS = 600000; // Alle 10 Min. 1 Gratis-Knochen in der Heldenhöhle
        const MARKET_STAMINA_COOLDOWN_MS = 12 * 60 * 60 * 1000; // Alle 12 Stunden gratis 300 Ausdauer am Marktplatz
        const MARKET_STAMINA_REWARD = 300;
        const DINO_HUNT_STAMINA_COST = 25;
        const STAMINA_REGEN_CAP = 300;
        const STAMINA_HARD_CAP = 900;
        const STAMINA_REGEN_BASE_MS = 120000; // +1 Ausdauer alle 2 Min. passiv bis 300

        const RESEARCH_LIST = [
          {
            id: 'smoking',
            name: 'Räuchern',
            tier: 1,
            reqWorkshop: 1,
            reqTechs: [],
            effect: '-25 % Fleischverbrauch aller Dorfbewohner.',
            detail: 'Über glimmender Vulkan-Asche haltbar gemachtes Fleisch streckt die Vorräte dauerhaft um ein Viertel.',
            cost: { meat: 20, wood: 45, stone: 20 },
            duration: 40
          },
          {
            id: 'tanning',
            name: 'Fell-Gerben',
            tier: 1,
            reqWorkshop: 1,
            reqTechs: [],
            effect: 'Höhere Kälteresistenz: -50 % Moral- & Kältemalus bei sinkender Feuer-Glut.',
            detail: 'Dicht gegerbte Felle isolieren Hütten und Kleidung, sodass Kälteeinbrüche und schwache Glut den Stamm kaum noch schwächen.',
            cost: { wood: 40, fur: 35 },
            duration: 55
          },
          {
            id: 'flint',
            name: 'Feuerstein-Spitzen',
            tier: 2,
            reqWorkshop: 2,
            reqTechs: ['smoking'],
            effect: '+30 % Fleisch- und Fell-Ausbeute der Jäger.',
            detail: 'Scharf geschlagene Obsidian- und Feuersteinspitzen machen jede Jagd deutlich ergiebiger.',
            cost: { wood: 80, stone: 65, fur: 30 },
            duration: 210
          },
          {
            id: 'axes',
            name: 'Steinbeile',
            tier: 2,
            reqWorkshop: 2,
            reqTechs: [],
            effect: '+25 % Holzfäller-Effizienz.',
            detail: 'Schwere gebundene Basaltbeile beschleunigen das Fällen und Spalten von Brennholz.',
            cost: { wood: 90, stone: 70 },
            duration: 240
          },
          {
            id: 'wedges',
            name: 'Schlägel & Keile',
            tier: 3,
            reqWorkshop: 3,
            reqTechs: ['axes'],
            effect: '+25 % Steinbruch-Ertrag.',
            detail: 'Gezielte Keiltechnik sprengt große Basaltblöcke mit geringerem Kraftaufwand.',
            cost: { wood: 160, stone: 145, fur: 45 },
            duration: 960
          },
          {
            id: 'traps',
            name: 'Fallenbau',
            tier: 3,
            reqWorkshop: 3,
            reqTechs: ['flint'],
            effect: 'Passive Fleischproduktion auch mit 1 Arbeiter weniger im Slot (+1 passiver Jagd-Slot).',
            detail: 'Entlang der Wildwechsel gespannte Schlingen sichern stetigen Fleischertrag — selbst wenn Jäger abgezogen werden.',
            cost: { wood: 155, stone: 95, fur: 85 },
            duration: 1320
          },
          {
            id: 'nets',
            name: 'Schlingen & Netze',
            tier: 4,
            reqWorkshop: 4,
            reqTechs: ['traps', 'tanning'],
            effect: '-20 % Expeditionsdauer und halbiertes Verletzungsrisiko.',
            detail: 'Robuste Fangnetze schützen Späher vor schnellen Raubsauriern und beschleunigen das Bergen der Beute.',
            cost: { wood: 260, stone: 180, fur: 170 },
            duration: 4500
          }
        ];

        const EXPEDITIONS = [
          {
            id: 'amber_river',
            name: 'Bernstein-Flussbett',
            desc: 'Treibholz, glatte Flusssteine und verstreute Beute am Rand des Vulkantals.',
            reqScoutLevel: 1,
            scoutsNeeded: 1,
            duration: 90, // 1m 30s
            baseRisk: 0.12,
            riskLabel: 'Gering',
            speciesIds: ['compsognathus', 'velociraptor'],
            loot: { meat: [18, 30], wood: [45, 75], stone: [25, 45], fur: [8, 16] }
          },
          {
            id: 'raptor_nest',
            name: 'Raptor-Gelege',
            desc: 'Gefährliches Brutgebiet kleiner Raubsaurier mit reichen Fleisch- und Fellfunden.',
            reqScoutLevel: 2,
            scoutsNeeded: 2,
            duration: 360, // 6 Min.
            baseRisk: 0.26,
            riskLabel: 'Mittel',
            speciesIds: ['velociraptor', 'dilophosaurus'],
            loot: { meat: [75, 115], wood: [30, 55], stone: [25, 45], fur: [45, 72] }
          },
          {
            id: 'mammoth_grave',
            name: 'Mammut-Friedhof',
            desc: 'Aschebedecktes Knochenfeld voller dichter Felle, Stoßzähne und gewaltiger Vorräte.',
            reqScoutLevel: 3,
            scoutsNeeded: 3,
            duration: 1500, // 25 Min.
            baseRisk: 0.4,
            riskLabel: 'Hoch',
            speciesIds: ['stegosaurus', 'triceratops'],
            loot: { meat: [140, 210], wood: [80, 130], stone: [110, 175], fur: [120, 185] }
          },
          {
            id: 'obsidian_crater',
            name: 'Obsidian-Krater',
            desc: 'Glühende Basaltschlucht am Fuß des Vulkans mit massiven Stein- und Rohstoffvorkommen.',
            reqScoutLevel: 4,
            scoutsNeeded: 4,
            duration: 5400, // 1 Std. 30 Min.
            baseRisk: 0.52,
            riskLabel: 'Sehr hoch',
            speciesIds: ['ankylosaurus', 'spinosaurus', 'tyrannosaurus'],
            loot: { meat: [210, 310], wood: [240, 360], stone: [290, 440], fur: [180, 270] }
          }
        ];

        const RESOURCE_LABELS = {
          meat: 'Fleisch',
          wood: 'Holz',
          stone: 'Stein',
          fur: 'Fell'
        };

        const RESOURCE_COLORS = {
          meat: '#fb7185',
          wood: '#f59e0b',
          stone: '#cbd5e1',
          fur: '#d8b4fe'
        };

        const WORLD_TILE_SIZE = 30;
        const WORLD_GRID_COLS = 1200;
        const WORLD_GRID_ROWS = 1200;
        const WORLD_MAP_WIDTH = WORLD_GRID_COLS * WORLD_TILE_SIZE;   // 36000
        const WORLD_MAP_HEIGHT = WORLD_GRID_ROWS * WORLD_TILE_SIZE;  // 36000
        const TILE_FREE = 0;
        const TILE_BLOCKED = 1;  // Vulkan, Lava, Klippen, Dino-Höhlen (NPC-Festungen)
        const TILE_OCCUPIED = 2; // Sammelstellen & fremde Lager

        const WORLD_CAM_DEFAULT_ZOOM = 2.6; // px pro Kachel (~150×240 sichtbare Kacheln um das Dorf)
        const WORLD_CAM_MAX_ZOOM = 56;      // px pro Kachel (Einzelkachel-Nahansicht & 2×2-Teleport)

        // Standard-Anker (2x2 Kacheln: x..x+1, y..y+1) im fruchtbaren Südwest-Tal
        const DEFAULT_HOME_TILE = { x: 240, y: 940 };

        // Leichtgewichtiges O(1)-Set für Sammelstellen & Dino-Kacheln (statt 1,44 Mio. Byte Array)
        const STATIC_NODE_TILES = new Set();

        // 10 anklickbare Sammelstellen exakt auf den Lagern, Steinbrüchen und Bernsteinfeldern der Weltkarte
        const WORLD_NODES = [
          {
            id: 'wood_south',
            name: 'Holzfäller-Lichtung',
            resource: 'wood',
            level: 1,
            xPct: 36.2,
            yPct: 77.6,
            capacity: 75,
            workersNeeded: 1,
            baseGatherSec: 45,
            respawnSec: 120,
            desc: 'Trockene Urzeit-Stämme und angeschwemmtes Brennholz nahe der eigenen Siedlung.'
          },
          {
            id: 'fur_west',
            name: 'Bernstein-Lager',
            resource: 'fur',
            level: 2,
            xPct: 27.6,
            yPct: 66.8,
            capacity: 60,
            workersNeeded: 1,
            baseGatherSec: 55,
            respawnSec: 150,
            desc: 'Glühende Bernsteinfelsen im Raptor-Streifgebiet — reich an dichten Fellen und Häuten.'
          },
          {
            id: 'meat_west',
            name: 'Urzeit-Jagdgrund',
            resource: 'meat',
            level: 2,
            xPct: 9.2,
            yPct: 36.2,
            capacity: 95,
            workersNeeded: 1,
            baseGatherSec: 65,
            respawnSec: 160,
            desc: 'Rauchendes Jägerlager neben weidenden Pflanzenfressern am westlichen Kraterhang.'
          },
          {
            id: 'stone_nw',
            name: 'Basalt-Steinbruch',
            resource: 'stone',
            level: 3,
            xPct: 27.7,
            yPct: 36.7,
            capacity: 110,
            workersNeeded: 2,
            baseGatherSec: 80,
            respawnSec: 210,
            desc: 'Lava-erleuchteter Geröllbruch mit hochwertigen Basaltblöcken.'
          },
          {
            id: 'wood_nw',
            name: 'Vulkan-Holzschlag',
            resource: 'wood',
            level: 4,
            xPct: 36.2,
            yPct: 27.2,
            capacity: 165,
            workersNeeded: 2,
            baseGatherSec: 105,
            respawnSec: 240,
            desc: 'Dichtes Holzdepot oberhalb des Lavarings mit kräftigem Bau- und Brennholz.'
          },
          {
            id: 'fur_se',
            name: 'Süd-Knochenfeld',
            resource: 'fur',
            level: 4,
            xPct: 63.8,
            yPct: 77.5,
            capacity: 130,
            workersNeeded: 2,
            baseGatherSec: 115,
            respawnSec: 260,
            desc: 'Uralte Lagerstätte zwischen Stegosaurier-Pfaden mit robusten Winterfellen.'
          },
          {
            id: 'wood_north',
            name: 'Nord-Kraterlager',
            resource: 'wood',
            level: 5,
            xPct: 34.4,
            yPct: 12.2,
            capacity: 230,
            workersNeeded: 2,
            baseGatherSec: 150,
            respawnSec: 320,
            desc: 'Hochgelegenes Aschewald-Lager im Norden mit großen Holzreserven.'
          },
          {
            id: 'stone_ne',
            name: 'Asche-Steinbruch',
            resource: 'stone',
            level: 5,
            xPct: 72.5,
            yPct: 36.8,
            capacity: 215,
            workersNeeded: 2,
            baseGatherSec: 160,
            respawnSec: 340,
            desc: 'Ergiebige Vulkanstein-Ader an der Ostflanke der Zentralcaldera.'
          },
          {
            id: 'meat_east',
            name: 'Mammut-Jagdlager',
            resource: 'meat',
            level: 6,
            xPct: 90.4,
            yPct: 36.2,
            capacity: 290,
            workersNeeded: 3,
            baseGatherSec: 205,
            respawnSec: 400,
            desc: 'Fernes Hochland-Lager nahe gewaltiger Herden mit riesigen Fleischvorräten.'
          },
          {
            id: 'stone_se',
            name: 'Obsidian-Kristallader',
            resource: 'stone',
            level: 7,
            xPct: 72.8,
            yPct: 66.8,
            capacity: 340,
            workersNeeded: 3,
            baseGatherSec: 240,
            respawnSec: 460,
            desc: 'Seltene Kristall- und Obsidianformation im Südosten für den späten Siedlungsausbau.'
          }
        ];

        // 8 Urzeit-Saurierarten für Dino-Bestiarium & Weltkarten-Jagd (Stufe 1 bis 25)
        const DINO_SPECIES = [
          {
            id: 'compsognathus',
            name: 'Asche-Compsognathus',
            tier: 'Rudeljäger',
            levelRange: [1, 3],
            accent: '#4ade80',
            powerFactor: 0.85,
            counterRole: 'Nahkampf',
            habitat: 'Bernstein-Flussbett & Südwest-Aschefeld',
            desc: 'Flinke Kleinsaurier, die in Schwärmen durch die warmen Ascheebenen streifen und unachtsame Vorräte plündern.',
            strengths: ['Hohe Schwarm-Beweglichkeit', 'Weicht einzelnen Fernangriffen aus'],
            weaknessTip: 'Effektiv dagegen: Nahkampf-Helden & Keulenschwinger (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 30, max: 55 },
              { label: 'Fell', resKey: 'fur', chancePct: 85, min: 14, max: 28 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 55, min: 1, max: 1 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 35, min: 1, max: 2 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 15, min: 1, max: 1 }
            ]
          },
          {
            id: 'velociraptor',
            name: 'Glutklauen-Raptor',
            tier: 'Raubsaurier',
            levelRange: [3, 6],
            accent: '#fb923c',
            powerFactor: 0.98,
            counterRole: 'Tank',
            habitat: 'Raptor-Gelege & Lavagrat',
            desc: 'Intelligente Jäger mit sichelförmigen Krallen, die Beutetrupps gezielt einkreisen und flankieren.',
            strengths: ['Hoher kritischer Klauenschaden', '+15 % Schaden gegen ungeschützte Fernkämpfer'],
            weaknessTip: 'Effektiv dagegen: Tank-Helden & Dinoreiter brechen Flanken (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 55, max: 95 },
              { label: 'Fell', resKey: 'fur', chancePct: 90, min: 28, max: 50 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 68, min: 1, max: 2 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 45, min: 1, max: 3 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 22, min: 1, max: 1 }
            ]
          },
          {
            id: 'dilophosaurus',
            name: 'Schwefel-Dilophosaurus',
            tier: 'Giftspucker',
            levelRange: [6, 9],
            accent: '#a3e635',
            powerFactor: 1.05,
            counterRole: 'Fernkampf',
            habitat: 'Schwefel-Quellen & Nordwest-Kliff',
            desc: 'Speit brennenden Schwefelschleim aus der Deckung heraus und blendet vorrückende Krieger.',
            strengths: ['Ätzender Distanz-Giftspuck', 'Schwächt feindliche Frontreihen'],
            weaknessTip: 'Effektiv dagegen: Fernkampf-Helden & Steinschleuderer (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 80, max: 135 },
              { label: 'Stein', resKey: 'stone', chancePct: 80, min: 45, max: 80 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 75, min: 1, max: 2 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 52, min: 2, max: 3 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 28, min: 1, max: 1 },
              { label: 'Goldener Knochen', itemKey: 'goldenBones', chancePct: 8, min: 1, max: 1 },
              { label: 'Schamanen-Totem', itemKey: 'shamanTotem', chancePct: 18, min: 1, max: 1 }
            ]
          },
          {
            id: 'stegosaurus',
            name: 'Basalt-Stegosaurus',
            tier: 'Gepanzert',
            levelRange: [9, 13],
            accent: '#38bdf8',
            powerFactor: 1.12,
            counterRole: 'Fernkampf',
            habitat: 'Süd-Knochenfeld & Mammut-Friedhof',
            desc: 'Seine vulkanharten Rückenplatten leiten Hitze ab, während sein Stachelschwanz ganze Formationen zerschmettert.',
            strengths: ['Dicke Rückenplatten-Rüstung', 'Wuchtiger Schwanz-Konter im Nahkampf'],
            weaknessTip: 'Effektiv dagegen: Fernkampf-Helden & Steinschleuderer (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 120, max: 190 },
              { label: 'Fell', resKey: 'fur', chancePct: 95, min: 70, max: 115 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 82, min: 2, max: 3 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 60, min: 2, max: 4 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 35, min: 1, max: 1 },
              { label: 'Goldener Knochen', itemKey: 'goldenBones', chancePct: 12, min: 1, max: 1 },
              { label: 'Schamanen-Totem', itemKey: 'shamanTotem', chancePct: 25, min: 1, max: 1 }
            ]
          },
          {
            id: 'triceratops',
            name: 'Obsidian-Triceratops',
            tier: 'Schwerer Koloss',
            levelRange: [12, 16],
            accent: '#f59e0b',
            powerFactor: 1.2,
            counterRole: 'Nahkampf',
            habitat: 'Ost-Hochland & Mammut-Friedhof',
            desc: 'Ein gewaltiger Dreihorn-Koloss mit massivem Nackenschild, der feindliche Linien im vollen Ansturm durchbricht.',
            strengths: ['Unaufhaltsamer Horn-Ansturm', 'Blockt frontale Fernangriffe ab'],
            weaknessTip: 'Effektiv dagegen: Nahkampf-Helden durchbrechen die Flanke (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 165, max: 260 },
              { label: 'Stein', resKey: 'stone', chancePct: 90, min: 100, max: 160 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 90, min: 2, max: 3 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 68, min: 3, max: 5 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 42, min: 1, max: 2 },
              { label: 'Goldener Knochen', itemKey: 'goldenBones', chancePct: 18, min: 1, max: 1 },
              { label: 'Schamanen-Totem', itemKey: 'shamanTotem', chancePct: 32, min: 1, max: 1 }
            ]
          },
          {
            id: 'ankylosaurus',
            name: 'Magma-Ankylosaurus',
            tier: 'Lebende Festung',
            levelRange: [15, 19],
            accent: '#c084fc',
            powerFactor: 1.28,
            counterRole: 'Fernkampf',
            habitat: 'Obsidian-Krater & Nordost-Basaltgrat',
            desc: 'Von geschmolzenem Basalt verkrustete Panzerplatten machen ihn nahezu unverwundbar gegen stumpfe Keulen.',
            strengths: ['Extreme Panzerung (+30 % Schadensminderung)', 'Schockwellen-Schwanzkeule'],
            weaknessTip: 'Effektiv dagegen: Fernkampf-Helden zielen auf Gelenklücken (+8 % Bonus)',
            lootTable: [
              { label: 'Stein', resKey: 'stone', chancePct: 100, min: 160, max: 260 },
              { label: 'Fleisch', resKey: 'meat', chancePct: 95, min: 180, max: 290 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 95, min: 2, max: 4 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 76, min: 3, max: 6 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 50, min: 1, max: 2 },
              { label: 'Goldener Knochen', itemKey: 'goldenBones', chancePct: 24, min: 1, max: 1 },
              { label: 'Schamanen-Totem', itemKey: 'shamanTotem', chancePct: 40, min: 1, max: 2 }
            ]
          },
          {
            id: 'spinosaurus',
            name: 'Lavastrom-Spinosaurus',
            tier: 'Apex-Räuber',
            levelRange: [18, 22],
            accent: '#f43f5e',
            powerFactor: 1.38,
            counterRole: 'Tank',
            habitat: 'Nord-Caldera-Fluss & Obsidian-Krater',
            desc: 'Sein glühendes Rückensegel strahlt gewaltige Hitze aus. Mit rasiermesserscharfem Kiefer zerreißt er selbst Dinoreiter.',
            strengths: ['Hitzewellen-Brüllen', 'Reißender Doppelangriff auf Front & Mitte'],
            weaknessTip: 'Effektiv dagegen: Tank-Helden + starke PvE-Fähigkeiten (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 250, max: 390 },
              { label: 'Fell', resKey: 'fur', chancePct: 100, min: 160, max: 250 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 100, min: 3, max: 5 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 85, min: 4, max: 7 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 60, min: 1, max: 2 },
              { label: 'Goldener Knochen', itemKey: 'goldenBones', chancePct: 34, min: 1, max: 2 },
              { label: 'Schamanen-Totem', itemKey: 'shamanTotem', chancePct: 52, min: 1, max: 2 }
            ]
          },
          {
            id: 'tyrannosaurus',
            name: 'Caldera-Tyrannosaurus',
            tier: 'Alpha-Bestie',
            levelRange: [22, 25],
            accent: '#ef4444',
            powerFactor: 1.55,
            counterRole: 'Tank',
            habitat: 'Zentralcaldera-Rand (Endgame-Boss)',
            desc: 'Der unangefochtene Herrscher des Vulkantals. Nur voll ausgerüstete Helden aller drei Klassen mit einer starken Armee bezwingen ihn.',
            strengths: ['Zermalmender Kieferbiss', 'Vulkan-Wut (+25 % Angriff)', 'Angst-Brüllen'],
            weaknessTip: 'Empfohlen: Alle 3 Klassen (Nahkampf + Tank + Fernkampf) vereint (+8 % Bonus)',
            lootTable: [
              { label: 'Fleisch', resKey: 'meat', chancePct: 100, min: 360, max: 540 },
              { label: 'Urzeit-Knochen', itemKey: 'bones', chancePct: 100, min: 4, max: 6 },
              { label: 'PvE-Malerei', itemKey: 'pvePaint', chancePct: 100, min: 6, max: 10 },
              { label: 'Ausrüstungskiste', itemKey: 'gearChest', chancePct: 75, min: 2, max: 3 },
              { label: 'Goldener Knochen', itemKey: 'goldenBones', chancePct: 55, min: 1, max: 2 },
              { label: 'PvP-Malerei', itemKey: 'pvpPaint', chancePct: 45, min: 3, max: 5 },
              { label: 'Schamanen-Totem', itemKey: 'shamanTotem', chancePct: 72, min: 2, max: 3 }
            ]
          }
        ];

        // 10 wilde Saurier-Standorte verschiedener Level (St. 1 bis 25) auf der Weltkarte
        const WORLD_DINOS = [
          { id: 'dino_1', speciesId: 'compsognathus', defaultLevel: 1, xPct: 22.8, yPct: 76.2, respawnSec: 65 },
          { id: 'dino_2', speciesId: 'compsognathus', defaultLevel: 3, xPct: 16.5, yPct: 58.0, respawnSec: 75 },
          { id: 'dino_3', speciesId: 'velociraptor', defaultLevel: 4, xPct: 45.2, yPct: 74.8, respawnSec: 85 },
          { id: 'dino_4', speciesId: 'velociraptor', defaultLevel: 6, xPct: 33.4, yPct: 56.5, respawnSec: 95 },
          { id: 'dino_5', speciesId: 'dilophosaurus', defaultLevel: 8, xPct: 20.6, yPct: 23.2, respawnSec: 110 },
          { id: 'dino_6', speciesId: 'stegosaurus', defaultLevel: 11, xPct: 54.5, yPct: 83.2, respawnSec: 125 },
          { id: 'dino_7', speciesId: 'triceratops', defaultLevel: 14, xPct: 68.4, yPct: 56.8, respawnSec: 145 },
          { id: 'dino_8', speciesId: 'ankylosaurus', defaultLevel: 17, xPct: 81.2, yPct: 22.5, respawnSec: 160 },
          { id: 'dino_9', speciesId: 'spinosaurus', defaultLevel: 21, xPct: 62.6, yPct: 16.4, respawnSec: 185 },
          { id: 'dino_10', speciesId: 'tyrannosaurus', defaultLevel: 25, xPct: 50.0, yPct: 31.0, respawnSec: 240 }
        ];

        function getDinoIconSVG(speciesId, size = 20, color = '#fca5a5') {
          switch (speciesId) {
            case 'compsognathus':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c3-1 5-4 8-4 2 0 3-3 5-5l3 1-2 3 1 3-4 1-2 4"/><path d="M9 15v4M13 15l1 4"/></svg>`;
            case 'velociraptor':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 15c4-1 7-4 10-4l4-5 5 1-2 3-3 1 1 4-4 1-2 4"/><path d="M10 14l-1 5M14 14l2 5"/><path d="M17 8l2 1"/></svg>`;
            case 'dilophosaurus':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-1 6-4 9-4l3-6c2-1 4 0 5 2l-3 2-1 4-4 1"/><path d="M12 5l2 2M14 4l1 3"/><path d="M9 16v4M13 16l1 4"/></svg>`;
            case 'stegosaurus':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c2-4 5-6 9-6s7 2 9 6H3Z"/><path d="M6 12 7 8l2 3 2-4 2 3 2-3 2 4"/><path d="M6 16v4M11 16v4M16 16v4"/></svg>`;
            case 'triceratops':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c2-4 5-5 9-5h3l2-3 2 3 2 2-2 4H3Z"/><path d="M17 9l4-2M18 11l4 0"/><path d="M6 16v4M11 16v4M16 16v4"/></svg>`;
            case 'ankylosaurus':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15c1-4 4-6 8-6s6 2 7 6H6Z"/><circle cx="3.5" cy="14.5" r="2"/><path d="M5.5 14.5H7"/><path d="M8 15v4M13 15v4M18 15v4"/></svg>`;
            case 'spinosaurus':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16c3-1 5-3 7-3 1-5 5-7 7-3l4-1 2 2-3 3-4 1-2 4"/><path d="M9 13V8M12 12V6M15 11V8"/><path d="M9 15v4M14 15l1 4"/></svg>`;
            default: // tyrannosaurus
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17c4-1 6-5 9-5l3-6h6l1 3-3 1 2 2-4 1-1 4-3 1"/><path d="M10 15v5M14 15l2 5"/><path d="M16 8h1"/></svg>`;
          }
        }

        function getResourceIconSVG(res, size = 16) {
          switch (res) {
            case 'meat':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${RESOURCE_COLORS.meat}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3.5c3 0 5 2 5 5 0 4-3.5 7.5-8 10.5l-2.5 1.5c-1.5.9-3.4.4-4.3-1.1l-1.2-2c-.9-1.5-.4-3.4 1.1-4.3L8 11.5C11 7 12.5 3.5 15.5 3.5Z"/><circle cx="15" cy="9" r="1.5"/></svg>`;
            case 'wood':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${RESOURCE_COLORS.wood}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15.5 15.5 4a2.8 2.8 0 0 1 4 4L8 19.5a2.8 2.8 0 0 1-4-4Z"/><path d="M13 6.5 17.5 11"/><path d="M8.5 11 13 15.5"/></svg>`;
            case 'stone':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${RESOURCE_COLORS.stone}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 20 8.5 17 20 7 20 4 8.5 12 3"/><path d="M12 3v17"/></svg>`;
            case 'fur':
              return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${RESOURCE_COLORS.fur}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4c2 2 8 2 10 0l2 5-2 3 2 7c-3-1-11-1-14 0l2-7-2-3 2-5Z"/></svg>`;
            default:
              return '';
          }
        }

        /* =====================================================================
           2. PROZEDURALER WEB-AUDIO-SYNTHESIZER (KEINE EXTERNEN DATEIEN)
           ===================================================================== */
        const SoundFX = {
          ctx: null,
          enabled: true,
          ensure() {
            if (!this.enabled) return null;
            if (!this.ctx) {
              const AC = window.AudioContext || window.webkitAudioContext;
              if (!AC) return null;
              this.ctx = new AC();
            }
            if (this.ctx.state === 'suspended') {
              this.ctx.resume().catch(() => {});
            }
            return this.ctx;
          },
          play(type) {
            const ctx = this.ensure();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'tap') {
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(240, now);
              osc.frequency.exponentialRampToValueAtTime(160, now + 0.055);
              gain.gain.setValueAtTime(0.06, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
              osc.start(now);
              osc.stop(now + 0.065);
            } else if (type === 'build') {
              osc.type = 'sine';
              osc.frequency.setValueAtTime(190, now);
              osc.frequency.exponentialRampToValueAtTime(340, now + 0.14);
              gain.gain.setValueAtTime(0.09, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
              osc.start(now);
              osc.stop(now + 0.17);
            } else if (type === 'complete') {
              [330, 440, 554].forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'triangle';
                o.connect(g);
                g.connect(ctx.destination);
                o.frequency.setValueAtTime(freq, now + i * 0.075);
                g.gain.setValueAtTime(0.07, now + i * 0.075);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.075 + 0.22);
                o.start(now + i * 0.075);
                o.stop(now + i * 0.075 + 0.24);
              });
            } else if (type === 'horn') {
              osc.type = 'sawtooth';
              osc.frequency.setValueAtTime(146, now);
              osc.frequency.linearRampToValueAtTime(196, now + 0.28);
              gain.gain.setValueAtTime(0.045, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
              osc.start(now);
              osc.stop(now + 0.44);
            } else if (type === 'stoke') {
              osc.type = 'sine';
              osc.frequency.setValueAtTime(130, now);
              osc.frequency.exponentialRampToValueAtTime(260, now + 0.12);
              gain.gain.setValueAtTime(0.08, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
              osc.start(now);
              osc.stop(now + 0.2);
            } else if (type === 'error') {
              osc.type = 'square';
              osc.frequency.setValueAtTime(150, now);
              osc.frequency.setValueAtTime(115, now + 0.07);
              gain.gain.setValueAtTime(0.04, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
              osc.start(now);
              osc.stop(now + 0.15);
            } else if (type === 'hit') {
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(210, now);
              osc.frequency.exponentialRampToValueAtTime(72, now + 0.09);
              gain.gain.setValueAtTime(0.09, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
              osc.start(now);
              osc.stop(now + 0.11);
            } else if (type === 'crit') {
              osc.type = 'sawtooth';
              osc.frequency.setValueAtTime(340, now);
              osc.frequency.exponentialRampToValueAtTime(590, now + 0.08);
              osc.frequency.exponentialRampToValueAtTime(220, now + 0.16);
              gain.gain.setValueAtTime(0.075, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
              osc.start(now);
              osc.stop(now + 0.19);
            } else if (type === 'roar') {
              osc.type = 'sawtooth';
              osc.frequency.setValueAtTime(128, now);
              osc.frequency.exponentialRampToValueAtTime(64, now + 0.24);
              gain.gain.setValueAtTime(0.065, now);
              gain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
              osc.start(now);
              osc.stop(now + 0.28);
            } else if (type === 'victory') {
              [293, 370, 440, 587].forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'triangle';
                o.connect(g);
                g.connect(ctx.destination);
                o.frequency.setValueAtTime(freq, now + i * 0.085);
                g.gain.setValueAtTime(0.075, now + i * 0.085);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.085 + 0.28);
                o.start(now + i * 0.085);
                o.stop(now + i * 0.085 + 0.3);
              });
            } else if (type === 'defeat') {
              [220, 185, 146].forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sawtooth';
                o.connect(g);
                g.connect(ctx.destination);
                o.frequency.setValueAtTime(freq, now + i * 0.12);
                g.gain.setValueAtTime(0.045, now + i * 0.12);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
                o.start(now + i * 0.12);
                o.stop(now + i * 0.12 + 0.27);
              });
            }
          }
        };

        /* =====================================================================
           3. SPIELZUSTAND & LOCALSTORAGE PERSISTENZ
           ===================================================================== */
        function createEmptyEquipped() {
          return { waffe: null, ruestung: null, helm: null, amulett: null };
        }

        function createInitialHeroSkills() {
          return { pvp: [1, 1, 1], pve: [1, 1, 1] };
        }

        function createInitialHeroes() {
          const map = {};
          for (const h of HEROES_LIST) {
            map[h.id] = {
              unlocked: false,
              level: 1,
              stars: 1,
              shards: 0,
              equipped: createEmptyEquipped(),
              skills: createInitialHeroSkills()
            };
          }
          // Starter-Helden (1 pro Klasse: Nahkampf, Tank, Fernkampf) damit Klassen-Ausrüstung & Fähigkeiten direkt erlebbar sind
          map.torv.unlocked = true;
          map.sera.unlocked = true;
          map.mira.unlocked = true;
          return map;
        }

        function createInitialEquipmentBag() {
          return [
            {
              id: 'gear_init_1',
              slot: 'waffe',
              role: 'melee',
              name: 'Obsidian-Keule (Ungewöhnlich)',
              rarity: 'green',
              bonus: 240,
              stat: '+240 ATK'
            },
            {
              id: 'gear_init_2',
              slot: 'ruestung',
              role: 'melee',
              name: 'Knochenwams (Selten)',
              rarity: 'blue',
              bonus: 380,
              stat: '+380 DEF/LP'
            },
            {
              id: 'gear_init_3',
              slot: 'waffe',
              role: 'tank',
              name: 'Hornstoß-Lanze (Episch)',
              rarity: 'purple',
              bonus: 750,
              stat: '+450 DEF / +1200 LP'
            },
            {
              id: 'gear_init_4',
              slot: 'waffe',
              role: 'ranged',
              name: 'Flugsehnen-Schleuder (Mythisch)',
              rarity: 'gold',
              bonus: 1300,
              stat: '+890 ATK / +12% Krit'
            }
          ];
        }

        function createInitialInventory() {
          return {
            gearChest: 3,
            pvpPaint: 18,
            pvePaint: 22,
            bones: 5,
            goldenBones: 2,
            heroXp: 300,
            crateMeat: 1,
            crateWood: 1,
            crateStone: 1,
            crateFur: 0,
            speedup5m: 2,
            speedup15m: 0,
            teleportItem: 3,
            shamanTotem: 2
          };
        }

        function createInitialState() {
          const now = Date.now();
          return {
            version: 2,
            started: false,
            soundEnabled: true,
            lastTick: now,
            resources: {
              meat: 140,
              wood: 200,
              stone: 110,
              fur: 70
            },
            ember: 92,
            fireMode: 'normal',      // 'normal' | 'overheat' (dauerhaft gespeichert)
            morale: 100,
            pop: {
              total: 5,
              growthProgress: 0,
              injured: 0,
              injuryHealsAt: 0
            },
            buildings: {
              bonfire: { level: 1, workers: 1 },
              lumber: { level: 0, workers: 0 },
              quarry: { level: 0, workers: 0 },
              hunter: { level: 0, workers: 0 },
              hut: { level: 0, workers: 0 },
              slinger: { level: 0, workers: 0 },
              clubman: { level: 0, workers: 0 },
              dinorider: { level: 0, workers: 0 },
              hero_cave: { level: 0, workers: 0 },
              workshop: { level: 0, workers: 0 },
              scout: { level: 0, workers: 0 },
              infirmary: { level: 0, workers: 0 },
              graveyard: { level: 0, workers: 0 },
              marketplace: { level: 0, workers: 0 },
              warehouse: { level: 0, workers: 0 }
            },
            troops: {
              slinger: 5,
              clubman: 5,
              dinorider: 2
            },
            injuredTroops: {
              slinger: 0,
              clubman: 0,
              dinorider: 0
            },
            fallenTroops: {
              slinger: 0,
              clubman: 0,
              dinorider: 0
            },
            activeBuild: null,       // { buildingId, targetLevel, startedAt, endsAt }
            activeResearch: null,    // { techId, startedAt, endsAt }
            activeTraining: null,    // { troopType, count, startedAt, endsAt }
            activeHealing: null,     // { troops, totalCount, startedAt, endsAt }
            completedTechs: [],
            activeExpeditions: [],   // [{ id, targetId, scouts, startedAt, endsAt, completed, loot, injured }]
            worldNodes: createInitialWorldNodes(),
            worldDinos: createInitialWorldDinos(),
            bestiary: createInitialBestiary(),
            huntLogs: [],            // [{ id, timestamp, speciesId, dinoLevel, victory, rounds, ... }]
            worldMarches: [],        // [{ id, kind: 'gather'|'hunt', ... }]
            worldGrid1200: true,
            homeTile: { ...DEFAULT_HOME_TILE },
            heroes: createInitialHeroes(),
            equipmentBag: createInitialEquipmentBag(),
            inventory: createInitialInventory(),
            heroCaveFreeAt: 0,
            stamina: 120,
            staminaRegenAt: now,
            marketClaimAt: 0,
            weather: {
              phase: 'calm',         // 'calm' | 'warning' | 'storm'
              type: 'cold',          // 'cold' | 'ash'
              phaseEndsAt: now + 150000
            }
          };
        }

        const WORLD_NODE_TEMPLATES = {
          wood: [
            { name: 'Holzfäller-Lichtung', desc: 'Trockene Urzeit-Stämme und angeschwemmtes Brennholz.' },
            { name: 'Vulkan-Holzschlag', desc: 'Dichtes Holzdepot mit kräftigem Bau- und Brennholz.' },
            { name: 'Aschewald-Forst', desc: 'Hohe Urzeit-Kiefern mit reichem Harz und Bauholz.' },
            { name: 'Nord-Kraterlager', desc: 'Hochgelegenes Aschewald-Lager mit großen Holzreserven.' }
          ],
          stone: [
            { name: 'Basalt-Steinbruch', desc: 'Lava-erleuchteter Geröllbruch mit hochwertigen Basaltblöcken.' },
            { name: 'Asche-Steinbruch', desc: 'Ergiebige Vulkanstein-Ader an den Hängen der Caldera.' },
            { name: 'Granit-Geröllfeld', desc: 'Massives Felsfeld für starke Siedlungsmauern.' },
            { name: 'Obsidian-Kristallader', desc: 'Seltene Kristall- und Obsidianformation für den späten Ausbau.' }
          ],
          meat: [
            { name: 'Urzeit-Jagdgrund', desc: 'Rauchendes Jägerlager neben weidenden Pflanzenfressern.' },
            { name: 'Mammut-Jagdlager', desc: 'Hochland-Lager nahe gewaltiger Herden mit reichen Fleischvorräten.' },
            { name: 'Weide-Senke', desc: 'Fruchtbare Ebene mit zahlreichen Urzeit-Herden.' },
            { name: 'Saurier-Tränke', desc: 'Lebendige Wasserstelle mit reichlich frischer Jagdbeute.' }
          ],
          fur: [
            { name: 'Bernstein-Lager', desc: 'Glühende Bernsteinfelsen — reich an dichten Fellen und Häuten.' },
            { name: 'Süd-Knochenfeld', desc: 'Uralte Lagerstätte mit robusten Winterfellen.' },
            { name: 'Pelzjäger-Versteck', desc: 'Geschütztes Tal mit warmen Fellen gegen die Eiszeit.' },
            { name: 'Frostgrat-Lager', desc: 'Windumtoste Felsen voller dichter Mammut- und Bärenfelle.' }
          ]
        };

        function buildNodeMetadataForSpot(resource, level) {
          const pool = WORLD_NODE_TEMPLATES[resource] || WORLD_NODE_TEMPLATES.wood;
          const tpl = pool[Math.min(pool.length - 1, Math.floor(((level - 1) / 8) * pool.length))] || pool[0];
          const baseCap = resource === 'fur' ? 55 : resource === 'stone' ? 75 : 80;
          const capacity = Math.round(baseCap + level * 36 + Math.pow(level, 1.35) * 14);
          const workersNeeded = level >= 6 ? 3 : level >= 3 ? 2 : 1;
          const baseGatherSec = Math.round(40 + level * 22);
          return {
            name: tpl.name,
            desc: tpl.desc,
            resource,
            level,
            capacity,
            workersNeeded,
            baseGatherSec,
            respawnSec: 120 + level * 35
          };
        }

        function createInitialWorldNodes() {
          const map = {};
          for (const node of WORLD_NODES) {
            map[node.id] = {
              xPct: node.xPct,
              yPct: node.yPct,
              resource: node.resource,
              name: node.name,
              level: node.level,
              capacity: node.capacity,
              remaining: node.capacity,
              respawnAt: 0,
              spawnVersion: 0,
              updatedAt: 0
            };
          }
          return map;
        }

        function createInitialWorldDinos() {
          const map = {};
          for (const d of WORLD_DINOS) {
            map[d.id] = {
              xPct: d.xPct,
              yPct: d.yPct,
              speciesId: d.speciesId,
              level: d.defaultLevel,
              respawnAt: 0,
              spawnVersion: 0,
              updatedAt: 0
            };
          }
          return map;
        }

        function createInitialBestiary() {
          const map = {};
          for (const sp of DINO_SPECIES) {
            map[sp.id] = { discovered: false, huntedCount: 0, highestLevel: 0, firstSeenAt: 0 };
          }
          return map;
        }

        // O(1)-Terrain-Prüfung für das statische 1200×1200-Hindernisraster (identisch zum Server)
        function getStaticWorldTileState(gx, gy) {
          if (gx < 0 || gy < 0 || gx >= WORLD_GRID_COLS || gy >= WORLD_GRID_ROWS) return TILE_BLOCKED;

          // 1. Zentrale Vulkan-Caldera & Lavaring (Ellipse um 600, 600)
          const dx = (gx + 0.5 - 600) / 145;
          const dy = (gy + 0.5 - 600) / 145;
          if (dx * dx + dy * dy <= 1.0) return TILE_BLOCKED;

          // 2. 4 große Urzeit-Dino-Höhlen rund um die Caldera (Nord, Süd, West, Ost)
          if (gx >= 530 && gx <= 670 && gy >= 110 && gy <= 230) return TILE_BLOCKED;
          if (gx >= 530 && gx <= 670 && gy >= 970 && gy <= 1090) return TILE_BLOCKED;
          if (gx >= 110 && gx <= 230 && gy >= 530 && gy <= 670) return TILE_BLOCKED;
          if (gx >= 970 && gx <= 1090 && gy >= 530 && gy <= 670) return TILE_BLOCKED;

          // 3. Lava-Klippen & Schluchten an den 4 Kartenecken
          if (gx <= 95 && gy <= 95) return TILE_BLOCKED;
          if (gx >= 1104 && gy <= 95) return TILE_BLOCKED;
          if (gx <= 95 && gy >= 1104) return TILE_BLOCKED;
          if (gx >= 1104 && gy >= 1104) return TILE_BLOCKED;

          // 4. Drei fremde befestigte Stammes-Lager (NW, NO, SO)
          if (gx >= 230 && gx <= 275 && gy >= 210 && gy <= 255) return TILE_OCCUPIED;
          if (gx >= 925 && gx <= 970 && gy >= 210 && gy <= 255) return TILE_OCCUPIED;
          if (gx >= 925 && gx <= 970 && gy >= 945 && gy <= 990) return TILE_OCCUPIED;

          return TILE_FREE;
        }

        // Prozedural dichtere Verteilung auf der 1200×1200-Weltkarte (insgesamt 48 Sammelstellen & 40 wilde Dinos)
        function populateDenseWorldSpawns() {
          let seed = 20261127;
          const nextRand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          const placed = [];
          for (const n of WORLD_NODES) {
            placed.push({ gx: (n.xPct / 100) * WORLD_GRID_COLS, gy: (n.yPct / 100) * WORLD_GRID_ROWS });
          }
          for (const d of WORLD_DINOS) {
            placed.push({ gx: (d.xPct / 100) * WORLD_GRID_COLS, gy: (d.yPct / 100) * WORLD_GRID_ROWS });
          }

          const pickSeededFreeSpot = (minSpacing) => {
            for (let attempt = 0; attempt < 220; attempt++) {
              const gx = 62 + Math.floor(nextRand() * (WORLD_GRID_COLS - 124));
              const gy = 62 + Math.floor(nextRand() * (WORLD_GRID_ROWS - 124));
              if (getStaticWorldTileState(gx, gy) !== TILE_FREE) continue;
              if (Math.hypot(gx - DEFAULT_HOME_TILE.x, gy - DEFAULT_HOME_TILE.y) < 34) continue;
              let tooClose = false;
              for (const p of placed) {
                if (Math.hypot(gx - p.gx, gy - p.gy) < minSpacing) {
                  tooClose = true;
                  break;
                }
              }
              if (tooClose) continue;
              placed.push({ gx, gy });
              return {
                gx,
                gy,
                xPct: Number(((gx / WORLD_GRID_COLS) * 100).toFixed(2)),
                yPct: Number(((gy / WORLD_GRID_ROWS) * 100).toFixed(2))
              };
            }
            return null;
          };

          const resOrder = ['wood', 'meat', 'stone', 'fur'];
          for (let i = 11; i <= 48; i++) {
            const spot = pickSeededFreeSpot(44);
            if (!spot) break;
            const distFromCenter = Math.hypot(spot.gx - 600, spot.gy - 600);
            const normCenter = Math.max(0, Math.min(1, 1 - (distFromCenter - 155) / 480));
            const level = Math.max(1, Math.min(8, Math.round(1 + normCenter * 6 + (nextRand() - 0.5) * 2)));
            const res = resOrder[(i - 11) % resOrder.length];
            const meta = buildNodeMetadataForSpot(res, level);
            WORLD_NODES.push({
              id: `node_${i}`,
              ...meta,
              xPct: spot.xPct,
              yPct: spot.yPct
            });
          }

          for (let i = 11; i <= 40; i++) {
            const spot = pickSeededFreeSpot(42);
            if (!spot) break;
            const distFromCenter = Math.hypot(spot.gx - 600, spot.gy - 600);
            const normCenter = Math.max(0, Math.min(1, 1 - (distFromCenter - 155) / 480));
            const spIndex = Math.max(
              0,
              Math.min(DINO_SPECIES.length - 1, Math.floor(normCenter * DINO_SPECIES.length * 0.92 + nextRand() * 1.4))
            );
            const sp = DINO_SPECIES[spIndex];
            const [minL, maxL] = sp.levelRange;
            const defaultLevel = minL + Math.floor(nextRand() * (maxL - minL + 1));
            WORLD_DINOS.push({
              id: `dino_${i}`,
              speciesId: sp.id,
              defaultLevel,
              xPct: spot.xPct,
              yPct: spot.yPct,
              respawnSec: 60 + defaultLevel * 6
            });
          }
        }
        populateDenseWorldSpawns();

        // Markiert die 2x2-Standorte der Sammelstellen & Dinos im kompakten O(1)-Set
        function initWorldStaticGrid(currentState = null) {
          STATIC_NODE_TILES.clear();
          const markOccupied2x2 = (cx, cy) => {
            for (let dy = -1; dy <= 0; dy++) {
              for (let dx = -1; dx <= 0; dx++) {
                const tx = cx + dx;
                const ty = cy + dy;
                if (tx >= 0 && ty >= 0 && tx < WORLD_GRID_COLS && ty < WORLD_GRID_ROWS) {
                  STATIC_NODE_TILES.add(`${tx},${ty}`);
                }
              }
            }
          };
          for (const node of WORLD_NODES) {
            const nSt = currentState && currentState.worldNodes ? currentState.worldNodes[node.id] : null;
            const xPct = nSt && typeof nSt.xPct === 'number' ? nSt.xPct : node.xPct;
            const yPct = nSt && typeof nSt.yPct === 'number' ? nSt.yPct : node.yPct;
            const cx = Math.floor((xPct / 100) * WORLD_GRID_COLS);
            const cy = Math.floor((yPct / 100) * WORLD_GRID_ROWS);
            markOccupied2x2(cx, cy);
          }
          for (const d of WORLD_DINOS) {
            const dSt = currentState && currentState.worldDinos ? currentState.worldDinos[d.id] : null;
            const xPct = dSt && typeof dSt.xPct === 'number' ? dSt.xPct : d.xPct;
            const yPct = dSt && typeof dSt.yPct === 'number' ? dSt.yPct : d.yPct;
            const cx = Math.floor((xPct / 100) * WORLD_GRID_COLS);
            const cy = Math.floor((yPct / 100) * WORLD_GRID_ROWS);
            markOccupied2x2(cx, cy);
          }
        }
        initWorldStaticGrid();

        function getHomePos() {
          const ht = (state && state.homeTile) || DEFAULT_HOME_TILE;
          const tileX = Math.max(0, Math.min(WORLD_GRID_COLS - 2, Math.floor(ht.x)));
          const tileY = Math.max(0, Math.min(WORLD_GRID_ROWS - 2, Math.floor(ht.y)));
          const wx = tileX + 1;
          const wy = tileY + 1;
          const centerPxX = wx * WORLD_TILE_SIZE;
          const centerPxY = wy * WORLD_TILE_SIZE;
          const xPct = (wx / WORLD_GRID_COLS) * 100;
          const yPct = (wy / WORLD_GRID_ROWS) * 100;
          return {
            tileX,
            tileY,
            wx,
            wy,
            pxX: centerPxX,
            pxY: centerPxY,
            xPct,
            yPct,
            coordX: tileX,
            coordY: tileY
          };
        }

        function getWorldTileState(gx, gy) {
          const base = getStaticWorldTileState(gx, gy);
          if (base !== TILE_FREE) return base;
          return STATIC_NODE_TILES.has(`${gx},${gy}`) ? TILE_OCCUPIED : TILE_FREE;
        }

        function findNearestFree2x2Client(prefX, prefY) {
          const bx = Math.max(0, Math.min(WORLD_GRID_COLS - 2, Math.floor(prefX)));
          const by = Math.max(0, Math.min(WORLD_GRID_ROWS - 2, Math.floor(prefY)));
          const is2x2Free = (ax, ay) => {
            if (ax < 0 || ay < 0 || ax > WORLD_GRID_COLS - 2 || ay > WORLD_GRID_ROWS - 2) return false;
            return (
              getWorldTileState(ax, ay) === TILE_FREE &&
              getWorldTileState(ax + 1, ay) === TILE_FREE &&
              getWorldTileState(ax, ay + 1) === TILE_FREE &&
              getWorldTileState(ax + 1, ay + 1) === TILE_FREE
            );
          };
          if (is2x2Free(bx, by)) return { x: bx, y: by };
          for (let r = 1; r <= 120; r++) {
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                if (is2x2Free(bx + dx, by + dy)) return { x: bx + dx, y: by + dy };
              }
            }
          }
          return { ...DEFAULT_HOME_TILE };
        }

        // Gemeinsamer Multiplayer-Weltzustand (aus Node.js WebSocket-Server + Cloud Firestore)
        const mpWorld = {
          session: null,
          settlements: [],
          marches: [],
          nodeOccupants: [],
          dynamicSpawns: [],
          volcano: null,
          chat: [],
          onlinePlayers: 1,
          chatOpen: false,
          unreadChat: 0,
          lastSeenChatId: null
        };

        // Client-seitige Validierung für alle 4 Kacheln des 2x2-Siedlungs-Blocks (inkl. fremder Spielerdörfer)
        function validateGhost2x2(anchorX, anchorY) {
          const cells = [];
          let valid = true;
          let blockedReason = '';
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;

          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const tx = anchorX + dx;
              const ty = anchorY + dy;
              let st = getWorldTileState(tx, ty);
              let otherOwner = null;
              if (st === TILE_FREE && Array.isArray(mpWorld.settlements)) {
                for (const s of mpWorld.settlements) {
                  if (ownUid && s.uid === ownUid) continue;
                  if (tx >= s.tileX && tx <= s.tileX + 1 && ty >= s.tileY && ty <= s.tileY + 1) {
                    st = TILE_OCCUPIED;
                    otherOwner = s.tribeName || 'Fremdstamm';
                    break;
                  }
                }
              }
              const isFree = st === TILE_FREE;
              if (!isFree) {
                valid = false;
                if (!blockedReason) {
                  blockedReason = otherOwner
                    ? `Belegt durch ${otherOwner}`
                    : st === TILE_BLOCKED
                    ? 'Hindernis (Vulkan / Höhle / Klippe)'
                    : 'Belegt (Sammelstelle / Fremdlager)';
                }
              }
              cells.push({ x: tx, y: ty, state: st, free: isFree });
            }
          }

          return { valid, cells, reason: blockedReason };
        }

        let state = createInitialState();
        let activeTab = 'village';
        let openSheet = null; // { type: 'building' | 'research' | 'worldNode' | 'ownSettlement', id: string, subTab?: string }
        let lastWoodEmptyWarned = false;
        let heroFilter = 'all';
        let heroSubTab = 'heroes'; // 'heroes' | 'skills' | 'gear' | 'battles'
        let battleLogFilter = 'all'; // 'all' | 'victory' | 'defeat'
        let selectedGearHeroId = 'torv';
        let gearBagShowAll = false;
        let lastGearDrops = [];
        let invFilter = 'all';
        let lastSummonResults = [];
        let wildernessSubTab = 'expeditions'; // 'expeditions' | 'bestiary'
        let bestiaryFilter = 'all'; // 'all' | 'discovered' | 'hunted'
        let huntDraft = {
          dinoId: null,
          heroIds: [],
          troops: { slinger: 0, clubman: 0, dinorider: 0 }
        };
        let gatherDraft = {
          nodeId: null,
          heroIds: [],
          troops: { slinger: 0, clubman: 0, dinorider: 0 }
        };
        let volcanoDraft = {
          heroIds: [],
          troops: { slinger: 0, clubman: 0, dinorider: 0 }
        };
        const battleAnimState = {
          active: false,
          battleId: null,
          speed: 1,
          timers: [],
          finished: false
        };
        let battleBannerTimer = null;

        // Kamera-Zustand für die zoom- und verschiebbare 1200×1200-Weltkarte
        const worldCam = {
          cx: DEFAULT_HOME_TILE.x + 1,
          cy: DEFAULT_HOME_TILE.y + 1,
          zoom: WORLD_CAM_DEFAULT_ZOOM,
          targetCx: DEFAULT_HOME_TILE.x + 1,
          targetCy: DEFAULT_HOME_TILE.y + 1,
          targetZoom: WORLD_CAM_DEFAULT_ZOOM,
          initialized: false,
          dragging: false,
          moved: false,
          pointerId: null,
          startX: 0,
          startY: 0,
          originCx: DEFAULT_HOME_TILE.x + 1,
          originCy: DEFAULT_HOME_TILE.y + 1,
          activePointers: new Map(),
          pinchActive: false,
          pinchStartDist: 0,
          pinchStartZoom: WORLD_CAM_DEFAULT_ZOOM,
          pinchWorldX: DEFAULT_HOME_TILE.x + 1,
          pinchWorldY: DEFAULT_HOME_TILE.y + 1,
          rafId: 0,
          lastFrameTs: 0
        };

        // Zustand der 2x2 Ghost-Teleport-Vorschau
        const teleportGhost = {
          active: false,
          anchorX: DEFAULT_HOME_TILE.x + 2,
          anchorY: DEFAULT_HOME_TILE.y,
          valid: true,
          validation: null,
          dragging: false,
          pointerId: null,
          offsetTileX: 0,
          offsetTileY: 0
        };

        function isOverheatMode() {
          return state.fireMode === 'overheat';
        }

        function saveState() {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          } catch (e) {
            // Ignoriere Quota-Fehler still
          }
          if (window.DinoMultiplayer) {
            window.DinoMultiplayer.saveToCloud(state, false);
          }
        }

        function loadState() {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !parsed.buildings) return null;
            const fresh = createInitialState();
            const merged = {
              ...fresh,
              ...parsed,
              resources: { ...fresh.resources, ...(parsed.resources || {}) },
              pop: { ...fresh.pop, ...(parsed.pop || {}) },
              weather: { ...fresh.weather, ...(parsed.weather || {}) },
              troops: { ...fresh.troops, ...(parsed.troops || {}) },
              injuredTroops: { ...fresh.injuredTroops, ...(parsed.injuredTroops || {}) },
              fallenTroops: { ...fresh.fallenTroops, ...(parsed.fallenTroops || {}) },
              activeHealing: parsed.activeHealing && typeof parsed.activeHealing === 'object' ? parsed.activeHealing : null,
              stamina: Number.isFinite(Number(parsed.stamina)) ? Math.max(0, Math.min(STAMINA_HARD_CAP, Math.floor(Number(parsed.stamina)))) : fresh.stamina,
              staminaRegenAt: Number(parsed.staminaRegenAt || Date.now()),
              marketClaimAt: Number(parsed.marketClaimAt || 0),
              inventory: { ...fresh.inventory, ...(parsed.inventory || {}) },
              homeTile: (() => {
                if (parsed.homeTile && typeof parsed.homeTile.x === 'number' && typeof parsed.homeTile.y === 'number') {
                  const rx = Math.floor(parsed.homeTile.x);
                  const ry = Math.floor(parsed.homeTile.y);
                  // Einmalige Migration alter 48×27-Spielstände proportional auf das neue 1200×1200-Raster
                  if (!parsed.worldGrid1200 && rx >= 0 && rx <= 47 && ry >= 0 && ry <= 26) {
                    const mappedX = Math.round(((rx + 1) / 48) * WORLD_GRID_COLS) - 1;
                    const mappedY = Math.round(((ry + 1) / 27) * WORLD_GRID_ROWS) - 1;
                    return findNearestFree2x2Client(mappedX, mappedY);
                  }
                  return {
                    x: Math.max(0, Math.min(WORLD_GRID_COLS - 2, rx)),
                    y: Math.max(0, Math.min(WORLD_GRID_ROWS - 2, ry))
                  };
                }
                return { ...DEFAULT_HOME_TILE };
              })(),
              worldGrid1200: true,
              buildings: { ...fresh.buildings },
              heroes: createInitialHeroes(),
              equipmentBag: Array.isArray(parsed.equipmentBag) ? parsed.equipmentBag : createInitialEquipmentBag(),
              worldNodes: createInitialWorldNodes()
            };
            // Migriere älteres overheat-Boolean auf dauerhaften fireMode
            if (parsed.fireMode === 'normal' || parsed.fireMode === 'overheat') {
              merged.fireMode = parsed.fireMode;
            } else {
              merged.fireMode = parsed.overheat ? 'overheat' : 'normal';
            }
            for (const id of BUILDING_ORDER) {
              merged.buildings[id] = {
                ...fresh.buildings[id],
                ...((parsed.buildings && parsed.buildings[id]) || {})
              };
            }
            if (parsed.heroes && typeof parsed.heroes === 'object') {
              for (const h of HEROES_LIST) {
                if (parsed.heroes[h.id]) {
                  const pSkills = parsed.heroes[h.id].skills || {};
                  const normArr = (arr) =>
                    Array.isArray(arr) && arr.length === 3
                      ? arr.map((v) => Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(Number(v) || 1))))
                      : [1, 1, 1];
                  merged.heroes[h.id] = {
                    ...fresh.heroes[h.id],
                    ...parsed.heroes[h.id],
                    equipped: {
                      ...createEmptyEquipped(),
                      ...((parsed.heroes[h.id] && parsed.heroes[h.id].equipped) || {})
                    },
                    skills: {
                      pvp: normArr(pSkills.pvp),
                      pve: normArr(pSkills.pve)
                    }
                  };
                }
              }
            }
            if (parsed.worldNodes && typeof parsed.worldNodes === 'object') {
              for (const node of WORLD_NODES) {
                const saved = parsed.worldNodes[node.id];
                if (saved) {
                  const cap = Math.max(10, Number(saved.capacity || node.capacity));
                  merged.worldNodes[node.id] = {
                    xPct: typeof saved.xPct === 'number' ? saved.xPct : node.xPct,
                    yPct: typeof saved.yPct === 'number' ? saved.yPct : node.yPct,
                    resource: saved.resource && RESOURCE_LABELS[saved.resource] ? saved.resource : node.resource,
                    name: typeof saved.name === 'string' && saved.name ? saved.name : node.name,
                    level: Math.max(1, Math.min(10, Number(saved.level || node.level))),
                    capacity: cap,
                    remaining: Math.max(0, Math.min(cap, Number(saved.remaining ?? cap))),
                    respawnAt: Number(saved.respawnAt || 0),
                    spawnVersion: Number(saved.spawnVersion || 0),
                    updatedAt: Number(saved.updatedAt || 0)
                  };
                }
              }
            }
            if (parsed.worldDinos && typeof parsed.worldDinos === 'object') {
              for (const d of WORLD_DINOS) {
                const saved = parsed.worldDinos[d.id];
                if (saved) {
                  merged.worldDinos[d.id] = {
                    xPct: typeof saved.xPct === 'number' ? saved.xPct : d.xPct,
                    yPct: typeof saved.yPct === 'number' ? saved.yPct : d.yPct,
                    speciesId: saved.speciesId && getDinoSpecies(saved.speciesId) ? saved.speciesId : d.speciesId,
                    level: Math.max(1, Math.min(MAX_LEVEL, Number(saved.level || d.defaultLevel))),
                    respawnAt: Number(saved.respawnAt || 0),
                    spawnVersion: Number(saved.spawnVersion || 0),
                    updatedAt: Number(saved.updatedAt || 0)
                  };
                }
              }
            }
            if (parsed.bestiary && typeof parsed.bestiary === 'object') {
              for (const sp of DINO_SPECIES) {
                if (parsed.bestiary[sp.id]) {
                  merged.bestiary[sp.id] = {
                    discovered: Boolean(parsed.bestiary[sp.id].discovered),
                    huntedCount: Math.max(0, Number(parsed.bestiary[sp.id].huntedCount || 0)),
                    highestLevel: Math.max(0, Number(parsed.bestiary[sp.id].highestLevel || 0)),
                    firstSeenAt: Number(parsed.bestiary[sp.id].firstSeenAt || 0)
                  };
                }
              }
            }
            if (!Array.isArray(merged.completedTechs)) merged.completedTechs = [];
            if (!Array.isArray(merged.activeExpeditions)) merged.activeExpeditions = [];
            if (!Array.isArray(merged.worldMarches)) merged.worldMarches = [];
            if (!Array.isArray(merged.huntLogs)) merged.huntLogs = [];
            merged.huntLogs = merged.huntLogs.slice(0, 20);
            return merged;
          } catch (e) {
            return null;
          }
        }

        /* =====================================================================
           4. SPIELLOGIK: ABHÄNGIGKEITEN, KOSTEN, RATEN & ZEITFORMATE
           ===================================================================== */
        function hasTech(techId) {
          return state.completedTechs.includes(techId);
        }

        function getPopMax() {
          return BUILDINGS.hut.popCap(state.buildings.hut.level);
        }

        function getAssignedWorkersTotal() {
          let sum = 0;
          for (const id of BUILDING_ORDER) {
            sum += state.buildings[id].workers || 0;
          }
          return sum;
        }

        function getScoutsOutCount() {
          return state.activeExpeditions.reduce((acc, exp) => acc + (exp.scouts || 0), 0);
        }

        function getWorldGatherersOutCount() {
          return (state.worldMarches || []).reduce((acc, m) => acc + ((m.kind || 'gather') === 'gather' ? m.workers || 0 : 0), 0);
        }

        function getMaxWorldMarches() {
          const bf = state.buildings.bonfire.level;
          let queues = 1;
          for (let i = 1; i < MARCH_QUEUE_UNLOCK_LEVELS.length; i++) {
            if (bf >= MARCH_QUEUE_UNLOCK_LEVELS[i]) queues = i + 1;
          }
          return Math.min(5, queues);
        }

        function getNextMarchQueueUnlockLevel() {
          const bf = state.buildings.bonfire.level;
          for (const lvl of MARCH_QUEUE_UNLOCK_LEVELS) {
            if (bf < lvl) return lvl;
          }
          return null;
        }

        function getFreePop() {
          const busy = getAssignedWorkersTotal() + getScoutsOutCount() + getWorldGatherersOutCount() + (state.pop.injured || 0);
          return Math.max(0, state.pop.total - busy);
        }

        function getBuildingCost(buildingId, targetLevel) {
          const def = BUILDINGS[buildingId];
          const cost = {};
          const scale =
            targetLevel <= 10
              ? Math.pow(1.62, targetLevel - 1)
              : Math.pow(1.62, 9) * Math.pow(1.26, targetLevel - 10);
          for (const [res, base] of Object.entries(def.baseCost)) {
            cost[res] = Math.round(base * scale);
          }
          // Höhere Stufen ab Stufe 3 benötigen bei vielen Gebäuden zusätzlich Stein/Fell
          if (targetLevel >= 3 && buildingId === 'hut') {
            const s = targetLevel <= 10 ? Math.pow(1.56, targetLevel - 2) : Math.pow(1.56, 8) * Math.pow(1.24, targetLevel - 10);
            cost.stone = Math.round(18 * s);
          }
          if (targetLevel >= 4 && buildingId === 'lumber') {
            const s = targetLevel <= 10 ? Math.pow(1.5, targetLevel - 3) : Math.pow(1.5, 7) * Math.pow(1.22, targetLevel - 10);
            cost.fur = Math.round(16 * s);
          }
          if (targetLevel >= 4 && buildingId === 'quarry') {
            const s = targetLevel <= 10 ? Math.pow(1.5, targetLevel - 3) : Math.pow(1.5, 7) * Math.pow(1.22, targetLevel - 10);
            cost.fur = Math.round(18 * s);
          }
          return cost;
        }

        function getBuildingDuration(buildingId, targetLevel) {
          const def = BUILDINGS[buildingId];
          const base = BASE_BUILD_SECONDS[Math.min(MAX_LEVEL, Math.max(1, targetLevel))] || 60;
          return Math.round(base * (def.timeMult || 1));
        }

        function getResearchDuration(tech) {
          const shamans = state.buildings.workshop.workers || 0;
          const heroBonus = getHeroBonuses();
          const speedMult = 1 + shamans * 0.08 + heroBonus.research;
          return Math.max(10, Math.round(tech.duration / speedMult));
        }

        function getExpeditionDuration(expDef) {
          const trackers = state.buildings.scout.workers || 0;
          const heroBonus = getHeroBonuses();
          let dur = expDef.duration / (1 + trackers * 0.06 + heroBonus.march);
          if (hasTech('nets')) dur *= 0.8; // -20% Expeditionsdauer
          return Math.max(15, Math.round(dur));
        }

        function getExpeditionRisk(expDef) {
          let risk = expDef.baseRisk;
          if (hasTech('nets')) risk *= 0.5;
          return Math.max(0.03, risk);
        }

        function getMaxExpeditions() {
          const lvl = state.buildings.scout.level;
          if (lvl <= 0) return 0;
          if (lvl <= 2) return 1;
          if (lvl <= 5) return 2;
          return 3;
        }

        // Strikte Abhängigkeits-Prüfung für Gebäude-Ausbau (liefert strukturierte Checkliste!)
        function evaluateBuildingRequirements(buildingId) {
          const def = BUILDINGS[buildingId];
          const curLevel = state.buildings[buildingId].level;
          const targetLevel = curLevel + 1;
          const bonfireLvl = state.buildings.bonfire.level;

          if (curLevel >= MAX_LEVEL) {
            return {
              isMax: true,
              targetLevel: MAX_LEVEL,
              checks: [],
              allMet: false,
              nextHint: null
            };
          }

          const checks = [];

          if (buildingId === 'bonfire') {
            // STRIKTE 2-GEBÄUDE-REGEL für Signalfeuer X -> X+1:
            // 1) Pflichtgebäude: Wohnhütte >= X
            const hutLvl = state.buildings.hut.level;
            checks.push({
              label: `Pflichtgebäude: Wohnhütte mind. Stufe ${curLevel}`,
              currentText: `St. ${hutLvl}/${curLevel}`,
              met: hutLvl >= curLevel,
              targetBuildingId: 'hut',
              neededLevel: curLevel
            });

            // 2) Rotierendes zweites Gebäude >= X
            const rot = getBonfireSecondReq(curLevel);
            const rotDef = BUILDINGS[rot.buildingId];
            const rotLvl = state.buildings[rot.buildingId].level;
            checks.push({
              label: `Stufen-Partner: ${rotDef.name} mind. Stufe ${rot.minLevel}`,
              currentText: `St. ${rotLvl}/${rot.minLevel}`,
              met: rotLvl >= rot.minLevel,
              targetBuildingId: rot.buildingId,
              neededLevel: rot.minLevel
            });
          } else {
            // 1) Spezifische Freischalt-Voraussetzungen aus der zentralen BuildingRegistry
            const registryReqs = BuildingRegistry.getRequirements(buildingId);
            if (registryReqs && registryReqs.length > 0) {
              for (const req of registryReqs) {
                const rDef = BUILDINGS[req.buildingId];
                const rLvl = state.buildings[req.buildingId].level;
                checks.push({
                  label: `${rDef.name} mind. Stufe ${req.minLevel}`,
                  currentText: `St. ${rLvl}/${req.minLevel}`,
                  met: rLvl >= req.minLevel,
                  targetBuildingId: req.buildingId,
                  neededLevel: req.minLevel
                });
              }
            }

            // 2) STRIKTES HAUPTGEBÄUDE-LIMIT: Kein Gebäude > Großes Signalfeuer
            // Vermeide doppelte Anzeige wenn unlockReq schon bonfire >= targetLevel prüft
            const alreadyChecksHigherBonfire = checks.some(
              (c) => c.targetBuildingId === 'bonfire' && c.neededLevel >= targetLevel
            );
            if (!alreadyChecksHigherBonfire) {
              checks.push({
                label: `Hauptgebäude-Limit: Signalfeuer mind. Stufe ${targetLevel}`,
                currentText: `St. ${bonfireLvl}/${targetLevel}`,
                met: bonfireLvl >= targetLevel,
                targetBuildingId: 'bonfire',
                neededLevel: targetLevel
              });
            }
          }

          const firstMissing = checks.find((c) => !c.met) || null;
          let nextHint = null;
          if (firstMissing) {
            const targetDef = BUILDINGS[firstMissing.targetBuildingId];
            const curT = state.buildings[firstMissing.targetBuildingId].level;
            const actionVerb = curT === 0 ? 'errichten' : `auf Stufe ${firstMissing.neededLevel} ausbauen`;
            nextHint = {
              text: `Als Nächstes: ${targetDef.name} ${actionVerb}.`,
              buildingId: firstMissing.targetBuildingId,
              buttonLabel: `Zu ${targetDef.shortName}`
            };
          }

          return {
            isMax: false,
            targetLevel,
            checks,
            allMet: checks.every((c) => c.met),
            nextHint
          };
        }

        function canAfford(cost) {
          for (const [res, amt] of Object.entries(cost)) {
            if ((state.resources[res] || 0) < amt) return false;
          }
          return true;
        }

        function payCost(cost) {
          for (const [res, amt] of Object.entries(cost)) {
            state.resources[res] = Math.max(0, (state.resources[res] || 0) - amt);
          }
        }

        function evaluateResearchStatus(tech) {
          if (hasTech(tech.id)) return { status: 'done', label: 'Abgeschlossen', checks: [], canStart: false };
          if (state.activeResearch && state.activeResearch.techId === tech.id) {
            return { status: 'running', label: 'Läuft...', checks: [], canStart: false };
          }
          const checks = [];
          const wsLvl = state.buildings.workshop.level;
          checks.push({
            label: `Werkstatt / Schamanen-Zelt mind. Stufe ${tech.reqWorkshop}`,
            currentText: `St. ${wsLvl}/${tech.reqWorkshop}`,
            met: wsLvl >= tech.reqWorkshop,
            targetBuildingId: 'workshop',
            neededLevel: tech.reqWorkshop
          });
          for (const reqId of tech.reqTechs) {
            const reqTech = RESEARCH_LIST.find((t) => t.id === reqId);
            const done = hasTech(reqId);
            checks.push({
              label: `Forschung „${reqTech.name}“ abgeschlossen`,
              currentText: done ? 'Fertig' : 'Offen',
              met: done,
              targetTechId: reqId
            });
          }
          const allMet = checks.every((c) => c.met);
          return {
            status: allMet ? 'ready' : 'locked',
            label: allMet ? 'Erforschbar' : 'Gesperrt',
            checks,
            canStart: allMet && !state.activeResearch && canAfford(tech.cost)
          };
        }

        /* =====================================================================
           4B. HELDEN-BONI, KAMPFKRAFT, HELDENHÖHLE & INVENTAR-LOGIK
           ===================================================================== */
        function getHeroEffectiveBonusPct(heroDef, hState) {
          if (!hState || !hState.unlocked) return heroDef.baseBonusPct;
          return Math.round(heroDef.baseBonusPct * (1 + (hState.stars - 1) * 0.25 + (hState.level - 1) * 0.03));
        }

        function getHeroRoleKey(roleLabel) {
          return GEAR_ROLE_FROM_LABEL[roleLabel] || 'melee';
        }

        function getHeroGearPower(hState) {
          if (!hState || !hState.equipped) return 0;
          let bonus = 0;
          for (const slot of GEAR_SLOTS) {
            const item = hState.equipped[slot.key];
            if (item) {
              const rDef = GEAR_RARITY_MAP[item.rarity];
              bonus += Number(item.bonus || (rDef ? rDef.bonus : 100));
            }
          }
          return bonus;
        }

        function getHeroEquippedCount(hState) {
          if (!hState || !hState.equipped) return 0;
          let count = 0;
          for (const slot of GEAR_SLOTS) {
            if (hState.equipped[slot.key]) count++;
          }
          return count;
        }

        function ensureHeroSkills(hState) {
          if (!hState.skills || !Array.isArray(hState.skills.pvp) || !Array.isArray(hState.skills.pve)) {
            hState.skills = createInitialHeroSkills();
          }
          return hState.skills;
        }

        function getSkillUpgradeCost(currentLevel) {
          return currentLevel * 2;
        }

        function getHeroSkillTotalLevels(hState) {
          if (!hState || !hState.skills) return 6;
          const pvp = Array.isArray(hState.skills.pvp) ? hState.skills.pvp : [1, 1, 1];
          const pve = Array.isArray(hState.skills.pve) ? hState.skills.pve : [1, 1, 1];
          return [...pvp, ...pve].reduce((acc, lv) => acc + (Number(lv) || 1), 0);
        }

        function getHeroSkillPower(hState) {
          if (!hState || !hState.unlocked) return 0;
          const extraLevels = Math.max(0, getHeroSkillTotalLevels(hState) - 6);
          return extraLevels * 120;
        }

        function getHeroPower(heroDef, hState) {
          if (!hState || !hState.unlocked) return 0;
          const base = RARITY_META[heroDef.rarity].basePower;
          const baseHeroPower = Math.round(base * (1 + (hState.level - 1) * 0.14) * (1 + (hState.stars - 1) * 0.35));
          return baseHeroPower + getHeroGearPower(hState) + getHeroSkillPower(hState);
        }

        function getHeroLevelCost(level) {
          return Math.round(60 * Math.pow(1.22, level - 1));
        }

        function getHeroStarShardCost(stars) {
          return [0, 10, 20, 35, 50][stars] || 999;
        }

        function getHeroBonuses() {
          const out = { wood: 0, stone: 0, meat: 0, fur: 0, fireSave: 0, research: 0, march: 0 };
          for (const def of HEROES_LIST) {
            const hState = state.heroes && state.heroes[def.id];
            if (!hState || !hState.unlocked) continue;
            const pct = getHeroEffectiveBonusPct(def, hState) / 100;
            if (def.bonusType === 'wood') out.wood += pct;
            else if (def.bonusType === 'stone') out.stone += pct;
            else if (def.bonusType === 'fur') out.fur += pct;
            else if (def.bonusType === 'wood_stone') {
              out.wood += pct;
              out.stone += pct;
            } else if (def.bonusType === 'meat_fur') {
              out.meat += pct;
              out.fur += pct;
            } else if (def.bonusType === 'fire_research') {
              out.fireSave += pct * 0.7;
              out.research += pct;
            } else if (def.bonusType === 'march') {
              out.march += pct;
            }
          }
          return out;
        }

        function getTroopTotalPower() {
          let sum = 0;
          for (const key of Object.keys(TROOP_DEFS)) {
            sum += ((state.troops && state.troops[key]) || 0) * TROOP_DEFS[key].powerPerUnit;
          }
          return sum;
        }

        function getTotalTribePower() {
          let heroSum = 0;
          for (const def of HEROES_LIST) {
            heroSum += getHeroPower(def, state.heroes && state.heroes[def.id]);
          }
          return heroSum + getTroopTotalPower();
        }

        function addInventoryItem(itemId, qty) {
          if (!state.inventory) state.inventory = createInitialInventory();
          state.inventory[itemId] = Math.max(0, (state.inventory[itemId] || 0) + qty);
        }

        function levelUpHero(heroId) {
          const def = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!def || !hState || !hState.unlocked) return;
          if (hState.level >= 50) return;
          const cost = getHeroLevelCost(hState.level);
          if ((state.inventory.heroXp || 0) < cost) {
            SoundFX.play('error');
            showToast(`Benötigt ${cost} Helden-XP.`, 'err');
            return;
          }
          state.inventory.heroXp -= cost;
          hState.level += 1;
          SoundFX.play('complete');
          showToast(`${def.name} erreicht Level ${hState.level}!`, 'ok');
          saveState();
          renderAll();
        }

        function ascendHero(heroId) {
          const def = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!def || !hState) return;
          if (!hState.unlocked) {
            if (hState.shards >= 10) {
              hState.shards -= 10;
              hState.unlocked = true;
              SoundFX.play('horn');
              showToast(`${def.name} wurde über Splitter freigeschaltet!`, 'ok');
              saveState();
              renderAll();
            }
            return;
          }
          if (hState.stars >= 5) return;
          const req = getHeroStarShardCost(hState.stars);
          if (hState.shards < req) {
            SoundFX.play('error');
            showToast(`Benötigt ${req} Splitter für Stern ${hState.stars + 1}.`, 'err');
            return;
          }
          hState.shards -= req;
          hState.stars += 1;
          SoundFX.play('horn');
          showToast(`${def.name} steigt auf ${hState.stars}★ auf!`, 'ok');
          saveState();
          renderAll();
        }

        function claimFreeCaveBone() {
          const now = Date.now();
          if (now < (state.heroCaveFreeAt || 0)) return;
          const caveLvl = Math.max(1, state.buildings.hero_cave.level);
          const cooldown = Math.max(240000, FREE_BONE_COOLDOWN_MS - (caveLvl - 1) * 35000);
          state.heroCaveFreeAt = now + cooldown;
          addInventoryItem('bones', 1);
          SoundFX.play('complete');
          showToast('+1 Urzeit-Knochen in der Heldenhöhle geborgen!', 'ok');
          saveState();
          renderAll();
        }

        function summonFromHeroCave(bannerType, count) {
          const itemKey = bannerType === 'golden' ? 'goldenBones' : 'bones';
          const have = (state.inventory && state.inventory[itemKey]) || 0;
          if (have < count) {
            SoundFX.play('error');
            showToast(
              bannerType === 'golden'
                ? `Benötigt ${count} Goldene Knochen.`
                : `Benötigt ${count} Urzeit-Knochen.`,
              'err'
            );
            return;
          }

          state.inventory[itemKey] -= count;
          const caveLvl = Math.max(1, state.buildings.hero_cave.level);
          const resScale = 1 + (caveLvl - 1) * 0.15;
          const results = [];

          const rarePool = HEROES_LIST.filter((h) => h.rarity === 'rare');
          const epicPool = HEROES_LIST.filter((h) => h.rarity === 'epic');
          const legPool = HEROES_LIST.filter((h) => h.rarity === 'legendary');

          for (let i = 0; i < count; i++) {
            const roll = Math.random();
            let chosenHero = null;

            if (bannerType === 'golden') {
              // Goldene Knochen: 25% Legendär, 40% Episch, 35% Nur Ressourcen (Großer Fund)
              if (roll < 0.25) {
                chosenHero = legPool[Math.floor(Math.random() * legPool.length)];
              } else if (roll < 0.65) {
                chosenHero = epicPool[Math.floor(Math.random() * epicPool.length)];
              }
            } else {
              // Standard Knochen: 12% Episch, 33% Selten, 55% Nur Ressourcen
              if (roll < 0.12) {
                chosenHero = epicPool[Math.floor(Math.random() * epicPool.length)];
              } else if (roll < 0.45) {
                chosenHero = rarePool[Math.floor(Math.random() * rarePool.length)];
              }
            }

            if (chosenHero) {
              const hState = state.heroes[chosenHero.id];
              const meta = RARITY_META[chosenHero.rarity];
              if (!hState.unlocked) {
                hState.unlocked = true;
                results.push({
                  kind: 'hero_new',
                  rarity: chosenHero.rarity,
                  color: meta.color,
                  typeLabel: `${meta.label} · NEU`,
                  title: chosenHero.name,
                  sub: `${chosenHero.role} freigeschaltet!`
                });
              } else {
                hState.shards += 10;
                results.push({
                  kind: 'hero_shard',
                  rarity: chosenHero.rarity,
                  color: meta.color,
                  typeLabel: `${meta.label} · Splitter`,
                  title: chosenHero.name,
                  sub: '+10 Helden-Splitter (Stern-Aufstieg)'
                });
              }
            } else {
              // NUR RESSOURCEN / INVENTAR-FUNDE, MALEREI & AUSRÜSTUNGSKISTEN
              const resRoll = Math.random();
              if (resRoll < 0.2) {
                const chestQty = bannerType === 'golden' ? 2 : 1;
                addInventoryItem('gearChest', chestQty);
                results.push({
                  kind: 'resource',
                  color: '#f59e0b',
                  typeLabel: 'Ausrüstungs-Fund',
                  title: `${chestQty}× Ausrüstungskiste`,
                  sub: 'Im Helden-Reiter & Inventar öffnen'
                });
              } else if (resRoll < 0.4) {
                const isPvp = Math.random() < 0.55;
                const paintKey = isPvp ? 'pvpPaint' : 'pvePaint';
                const paintQty = bannerType === 'golden' ? 6 : 3;
                addInventoryItem(paintKey, paintQty);
                results.push({
                  kind: 'resource',
                  color: isPvp ? '#f87171' : '#34d399',
                  typeLabel: 'Fähigkeiten-Malerei',
                  title: `+${paintQty} ${isPvp ? 'PvP-Malerei' : 'PvE-Malerei'}`,
                  sub: 'Für Helden-Fähigkeiten (bis Lv. 6)'
                });
              } else if (bannerType === 'golden' && resRoll < 0.55) {
                addInventoryItem('speedup15m', 1);
                results.push({
                  kind: 'resource',
                  color: '#2dd4bf',
                  typeLabel: 'Ressourcen-Fund',
                  title: '1× 15-Min.-Beschleuniger',
                  sub: 'Im Inventar abgelegt'
                });
              } else if (resRoll < 0.62) {
                const xpGain = Math.round((bannerType === 'golden' ? 220 : 100) * resScale);
                addInventoryItem('heroXp', xpGain);
                results.push({
                  kind: 'resource',
                  color: '#60a5fa',
                  typeLabel: 'Nur Ressourcen',
                  title: `+${xpGain} Helden-XP`,
                  sub: 'Für Helden-Aufwertung'
                });
              } else if (resRoll < 0.8) {
                const crates = ['crateMeat', 'crateWood', 'crateStone', 'crateFur'];
                const picked = crates[Math.floor(Math.random() * crates.length)];
                const itemDef = INVENTORY_ITEMS.find((it) => it.id === picked);
                const qty = bannerType === 'golden' ? 2 : 1;
                addInventoryItem(picked, qty);
                results.push({
                  kind: 'resource',
                  color: itemDef.accent,
                  typeLabel: 'Ressourcen-Kiste',
                  title: `${qty}× ${itemDef.name}`,
                  sub: 'Im Inventar zum Öffnen'
                });
              } else {
                const resKeys = ['meat', 'wood', 'stone', 'fur'];
                const rk = resKeys[Math.floor(Math.random() * resKeys.length)];
                const baseAmt = bannerType === 'golden' ? 145 : 65;
                const amt = Math.round((baseAmt + Math.random() * (bannerType === 'golden' ? 80 : 40)) * resScale);
                state.resources[rk] += amt;
                results.push({
                  kind: 'resource',
                  color: RESOURCE_COLORS[rk],
                  typeLabel: 'Nur Ressourcen',
                  title: `+${amt} ${RESOURCE_LABELS[rk]}`,
                  sub: 'Direkt ins Lager geliefert'
                });
              }
            }
          }

          lastSummonResults = results;
          const gotGreat = results.some((r) => r.rarity === 'legendary' || r.rarity === 'epic');
          SoundFX.play(gotGreat ? 'horn' : 'complete');
          saveState();
          renderAll();
        }

        // =====================================================================
        // AUSRÜSTUNGSKISTEN & KLASSEN-GEAR LOGIK
        // =====================================================================
        function rollRandomGearItem() {
          const roles = ['melee', 'tank', 'ranged'];
          const slots = ['waffe', 'ruestung', 'helm', 'amulett'];
          const pickedRole = roles[Math.floor(Math.random() * roles.length)];
          const pickedSlot = slots[Math.floor(Math.random() * slots.length)];

          const roll = Math.random() * 100;
          let acc = 0;
          let pickedRarity = GEAR_RARITIES[0];
          for (const r of GEAR_RARITIES) {
            acc += r.weight;
            if (roll <= acc) {
              pickedRarity = r;
              break;
            }
          }

          const statType = pickedSlot === 'ruestung' || pickedSlot === 'helm' ? 'DEF/LP' : 'ATK';
          return {
            id: `gear_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            slot: pickedSlot,
            role: pickedRole,
            name: `${GEAR_NAMES[pickedRole][pickedSlot]} (${pickedRarity.label})`,
            rarity: pickedRarity.key,
            bonus: pickedRarity.bonus,
            stat: `+${pickedRarity.bonus} ${statType}`
          };
        }

        function openGearChest(openAll = false) {
          const have = (state.inventory && state.inventory.gearChest) || 0;
          if (have <= 0) {
            SoundFX.play('error');
            showToast('Keine Ausrüstungskisten vorhanden! Finde welche in der Wildnis oder Heldenhöhle.', 'warn');
            return;
          }
          if (!Array.isArray(state.equipmentBag)) state.equipmentBag = [];

          const count = openAll ? Math.min(have, 10) : 1;
          state.inventory.gearChest -= count;
          const dropped = [];
          for (let i = 0; i < count; i++) {
            const item = rollRandomGearItem();
            state.equipmentBag.unshift(item);
            dropped.push(item);
          }

          lastGearDrops = dropped;
          const gotEpicOrBetter = dropped.some((it) => it.rarity === 'purple' || it.rarity === 'gold');
          SoundFX.play(gotEpicOrBetter ? 'horn' : 'complete');

          if (dropped.length === 1) {
            const d = dropped[0];
            const roleLabel = GEAR_ROLE_INFO[d.role].label;
            showToast(`Kiste geöffnet: [${roleLabel}] ${d.name} (${d.stat})`, 'ok');
          } else {
            showToast(`${dropped.length}× Ausrüstungskiste geöffnet! Neue Klassen-Ausrüstung im Rucksack.`, 'ok');
          }

          saveState();
          renderAll();
        }

        function equipGearItem(heroId, itemId) {
          const heroDef = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!heroDef || !hState) return;
          if (!hState.unlocked) {
            SoundFX.play('error');
            showToast(`Schalte ${heroDef.name} zuerst in der Heldenhöhle frei.`, 'warn');
            return;
          }
          if (!Array.isArray(state.equipmentBag)) state.equipmentBag = [];
          const idx = state.equipmentBag.findIndex((it) => String(it.id) === String(itemId));
          if (idx === -1) return;

          const item = state.equipmentBag[idx];
          const heroRoleKey = getHeroRoleKey(heroDef.role);
          if (item.role !== heroRoleKey) {
            SoundFX.play('error');
            showToast(`Nur für ${GEAR_ROLE_INFO[item.role].label}-Helden geeignet!`, 'err');
            return;
          }

          if (!hState.equipped) hState.equipped = createEmptyEquipped();
          if (hState.equipped[item.slot]) {
            state.equipmentBag.push(hState.equipped[item.slot]);
          }
          hState.equipped[item.slot] = item;
          state.equipmentBag.splice(idx, 1);

          SoundFX.play('build');
          showToast(`${item.name} an ${heroDef.name} angelegt (${item.stat}).`, 'ok');
          saveState();
          renderAll();
        }

        function unequipGearItem(heroId, slotKey) {
          const heroDef = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!heroDef || !hState || !hState.equipped || !hState.equipped[slotKey]) return;
          if (!Array.isArray(state.equipmentBag)) state.equipmentBag = [];

          const removed = hState.equipped[slotKey];
          state.equipmentBag.unshift(removed);
          hState.equipped[slotKey] = null;

          SoundFX.play('tap');
          showToast(`${removed.name} abgelegt.`, 'info');
          saveState();
          renderAll();
        }

        function dismantleGearItem(itemId) {
          if (!Array.isArray(state.equipmentBag)) return;
          const idx = state.equipmentBag.findIndex((it) => String(it.id) === String(itemId));
          if (idx === -1) return;

          const item = state.equipmentBag[idx];
          const rMeta = GEAR_RARITY_MAP[item.rarity] || GEAR_RARITIES[0];
          state.equipmentBag.splice(idx, 1);
          addInventoryItem('heroXp', rMeta.xpValue);

          SoundFX.play('stoke');
          showToast(`${item.name} zerlegt: +${rMeta.xpValue} Helden-XP.`, 'ok');
          saveState();
          renderAll();
        }

        function upgradeHeroSkill(heroId, branch, idx) {
          if (branch !== 'pvp' && branch !== 'pve') return;
          const heroDef = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          const skillDefs = HERO_SKILLS_MAP[heroId] && HERO_SKILLS_MAP[heroId][branch];
          if (!heroDef || !hState || !skillDefs || !skillDefs[idx]) return;

          if (!hState.unlocked) {
            SoundFX.play('error');
            showToast(`Schalte ${heroDef.name} zuerst in der Heldenhöhle frei.`, 'warn');
            return;
          }

          const skills = ensureHeroSkills(hState);
          const curLv = skills[branch][idx] || 1;
          if (curLv >= MAX_SKILL_LEVEL) {
            SoundFX.play('tap');
            showToast('Fähigkeit bereits auf Max. Lv. 6!', 'info');
            return;
          }

          const cost = getSkillUpgradeCost(curLv);
          const paintKey = branch === 'pvp' ? 'pvpPaint' : 'pvePaint';
          const paintLabel = branch === 'pvp' ? 'PvP-Malerei' : 'PvE-Malerei';
          const have = (state.inventory && state.inventory[paintKey]) || 0;
          if (have < cost) {
            SoundFX.play('error');
            showToast(`Benötigt ${cost} ${paintLabel} (Quelle: Heldenhöhle & Wildnis).`, 'err');
            return;
          }

          state.inventory[paintKey] -= cost;
          skills[branch][idx] = curLv + 1;
          const skDef = skillDefs[idx];
          SoundFX.play(curLv + 1 >= MAX_SKILL_LEVEL ? 'horn' : 'complete');
          showToast(
            `${branch === 'pvp' ? 'PvP-Fähigkeit' : 'Dino-Fähigkeit'} „${skDef.name}“ auf Lv. ${curLv + 1}/6 erhöht (+120 Macht)!`,
            'ok'
          );
          saveState();
          renderAll();
        }

        function useInventoryItem(itemId, useAll = false) {
          const itemDef = INVENTORY_ITEMS.find((i) => i.id === itemId);
          if (!itemDef) return;
          const have = (state.inventory && state.inventory[itemId]) || 0;
          if (itemDef.actionType === 'open_gear_chest') {
            openGearChest(useAll);
            return;
          }
          if (itemDef.actionType === 'goto_skills') {
            heroSubTab = 'skills';
            switchTab('heroes');
            return;
          }
          if (itemDef.actionType === 'goto_cave') {
            switchTab('village');
            if (window.Village3D) window.Village3D.centerOn('hero_cave');
            openBuildingSheet('hero_cave', state.buildings.hero_cave.level > 0 ? 'summon' : 'building');
            return;
          }
          if (itemDef.actionType === 'use_shaman_totem') {
            const status = ShamanTotemSystem.getStatus(state);
            if (!status.graveyardVisible) {
              const missingText = BuildingRegistry.getMissingRequirementsText('graveyard', state);
              SoundFX.play('error');
              showToast(`Friedhof noch nicht freigeschaltet${missingText ? ` (Benötigt: ${missingText})` : ''}.`, 'warn');
              return;
            }
            if (useAll) {
              ShamanTotemSystem.executeRevival({ mode: status.usableTotemsForAll > 1 ? 'all' : 'auto' });
              return;
            }
            SoundFX.play('tap');
            openShamanTotemSheet();
            return;
          }
          if (itemDef.actionType === 'goto_heroes') {
            heroSubTab = 'heroes';
            switchTab('heroes');
            return;
          }
          if (itemDef.actionType === 'teleport') {
            if (have <= 0) {
              SoundFX.play('error');
              showToast('Kein Siedlungs-Teleport im Inventar.', 'err');
              return;
            }
            switchTab('worldmap');
            enterTeleportGhostMode();
            return;
          }
          if (have <= 0) return;

          if (itemDef.actionType === 'open_crate') {
            const count = useAll ? have : 1;
            state.inventory[itemId] -= count;
            const totalGain = count * itemDef.amount;
            state.resources[itemDef.resource] += totalGain;
            SoundFX.play('complete');
            showToast(`+${totalGain} ${RESOURCE_LABELS[itemDef.resource]} aus ${count}× ${itemDef.name}!`, 'ok');
            saveState();
            renderAll();
          } else if (itemDef.actionType === 'speedup') {
            const ms = itemDef.seconds * 1000;
            let targetLabel = '';
            if (state.activeBuild) {
              state.activeBuild.endsAt -= ms;
              targetLabel = BUILDINGS[state.activeBuild.buildingId].shortName;
            } else if (state.activeResearch) {
              state.activeResearch.endsAt -= ms;
              targetLabel = 'Forschung';
            } else if (state.activeTraining) {
              state.activeTraining.endsAt -= ms;
              targetLabel = TROOP_DEFS[state.activeTraining.troopType].name;
            } else if (state.activeHealing) {
              state.activeHealing.endsAt -= ms;
              targetLabel = 'Krankenzelt-Heilung';
            } else {
              SoundFX.play('error');
              showToast('Kein aktiver Bau, Forschung, Training oder Heilung zum Beschleunigen.', 'warn');
              return;
            }
            state.inventory[itemId] -= 1;
            SoundFX.play('stoke');
            showToast(`${targetLabel} um ${fmtDuration(itemDef.seconds)} beschleunigt!`, 'ok');
            saveState();
            renderAll();
          }
        }

        function startTroopTraining(troopType) {
          const def = TROOP_DEFS[troopType];
          const bLvl = state.buildings[troopType] ? state.buildings[troopType].level : 0;
          if (!def || bLvl <= 0) return;
          if (state.activeTraining) {
            SoundFX.play('error');
            showToast('Es läuft bereits eine Truppen-Ausbildung.', 'warn');
            return;
          }
          if (!canAfford(def.cost)) {
            SoundFX.play('error');
            showToast('Nicht genügend Ressourcen für die Ausbildung.', 'err');
            return;
          }
          payCost(def.cost);
          const count = def.batchSize + Math.floor((bLvl - 1) * 1.5);
          const dur = Math.max(12, Math.round(def.durationSec / (1 + (bLvl - 1) * 0.08)));
          const now = Date.now();
          state.activeTraining = {
            troopType,
            count,
            startedAt: now,
            endsAt: now + dur * 1000
          };
          SoundFX.play('build');
          showToast(`${count}× ${def.name} werden ausgebildet!`, 'ok');
          saveState();
          renderAll();
        }

        function finishActiveTraining() {
          if (!state.activeTraining) return null;
          const { troopType, count } = state.activeTraining;
          if (!state.troops) state.troops = { slinger: 0, clubman: 0, dinorider: 0 };
          state.troops[troopType] = (state.troops[troopType] || 0) + count;
          state.activeTraining = null;
          return { name: TROOP_DEFS[troopType].name, count };
        }

        /* --- KRANKENZELT, FRIEDHOF, MARKTPLATZ & LAGERHAUS LOGIK --- */
        function getInfirmaryCapacity(lvl) {
          const level = typeof lvl === 'number' ? lvl : (state.buildings.infirmary ? state.buildings.infirmary.level : 0);
          if (level <= 0) return 0;
          return 12 + (level - 1) * 8;
        }

        function getTotalInjuredTroops() {
          const inj = state.injuredTroops || {};
          return (inj.slinger || 0) + (inj.clubman || 0) + (inj.dinorider || 0);
        }

        function getTotalFallenTroops() {
          const fal = state.fallenTroops || {};
          return (fal.slinger || 0) + (fal.clubman || 0) + (fal.dinorider || 0);
        }

        function getInfirmaryFreeBeds() {
          const healingCount = state.activeHealing ? state.activeHealing.totalCount || 0 : 0;
          return Math.max(0, getInfirmaryCapacity() - getTotalInjuredTroops() - healingCount);
        }

        function getHealingCostAndDuration() {
          const inj = state.injuredTroops || { slinger: 0, clubman: 0, dinorider: 0 };
          const total = getTotalInjuredTroops();
          const bState = state.buildings.infirmary || { level: 0, workers: 0 };
          const speedMult = 1 + Math.max(0, bState.level - 1) * 0.1 + (bState.workers || 0) * 0.15;
          const cost = {
            meat: Math.max(0, total * 4),
            wood: Math.max(0, total * 2)
          };
          const durationSec = total <= 0 ? 0 : Math.max(8, Math.round((total * 10) / speedMult));
          return { total, troops: { slinger: inj.slinger || 0, clubman: inj.clubman || 0, dinorider: inj.dinorider || 0 }, cost, durationSec };
        }

        function startTroopHealing() {
          const infLvl = state.buildings.infirmary ? state.buildings.infirmary.level : 0;
          if (infLvl <= 0) {
            SoundFX.play('error');
            showToast('Errichte zuerst das Krankenzelt!', 'err');
            return;
          }
          if (state.activeHealing) {
            SoundFX.play('error');
            showToast('Im Krankenzelt läuft bereits eine Heilung.', 'warn');
            return;
          }
          const plan = getHealingCostAndDuration();
          if (plan.total <= 0) {
            SoundFX.play('error');
            showToast('Derzeit gibt es keine verletzten Einheiten.', 'info');
            return;
          }
          if (!canAfford(plan.cost)) {
            SoundFX.play('error');
            showToast('Nicht genügend Ressourcen für die Heilung.', 'err');
            return;
          }
          payCost(plan.cost);
          state.injuredTroops = { slinger: 0, clubman: 0, dinorider: 0 };
          const now = Date.now();
          state.activeHealing = {
            troops: plan.troops,
            totalCount: plan.total,
            startedAt: now,
            endsAt: now + plan.durationSec * 1000
          };
          SoundFX.play('build');
          showToast(`Heilung für ${plan.total} verletzte Einheiten gestartet (${fmtDuration(plan.durationSec)})!`, 'ok');
          saveState();
          renderAll();
          if (openSheet) renderSheet();
        }

        function finishActiveHealing() {
          if (!state.activeHealing) return null;
          const { troops, totalCount } = state.activeHealing;
          if (!state.troops) state.troops = { slinger: 0, clubman: 0, dinorider: 0 };
          for (const key of Object.keys(TROOP_DEFS)) {
            state.troops[key] = (state.troops[key] || 0) + (troops[key] || 0);
          }
          state.activeHealing = null;
          return { totalCount: totalCount || 0 };
        }

        function tryFreeFinishHealing() {
          if (!state.activeHealing) return;
          const rem = Math.ceil((state.activeHealing.endsAt - Date.now()) / 1000);
          if (rem > FREE_FINISH_SEC) return;
          const done = finishActiveHealing();
          if (done) {
            SoundFX.play('complete');
            showToast(`${done.totalCount} Einheiten wurden sofort geheilt und sind wieder einsatzbereit!`, 'ok');
            saveState();
            renderAll();
            if (openSheet) renderSheet();
          }
        }

        function getGraveyardRevivePerTotem(lvl) {
          const level = typeof lvl === 'number' ? lvl : (state.buildings.graveyard ? state.buildings.graveyard.level : 0);
          if (level <= 0) return 0;
          return 5 + level * 3;
        }

        // Aktives SchamanenTotem-System: Wiederbelebung gefallener Einheiten direkt aus dem Inventar oder am Friedhof
        const ShamanTotemSystem = (() => {
          const PRIORITY_ORDER = ['dinorider', 'clubman', 'slinger'];
          const draft = { slinger: 0, clubman: 0, dinorider: 0 };

          function getFallenSnapshot(st = state) {
            const f = (st && st.fallenTroops) || {};
            return {
              slinger: Math.max(0, Math.floor(f.slinger || 0)),
              clubman: Math.max(0, Math.floor(f.clubman || 0)),
              dinorider: Math.max(0, Math.floor(f.dinorider || 0))
            };
          }

          function getStatus(st = state) {
            const graveyardVisible = BuildingRegistry.isVisibleInUI('graveyard', st);
            const graveyardLevel = (st && st.buildings && st.buildings.graveyard && st.buildings.graveyard.level) || 0;
            const graveyardBuilt = graveyardLevel > 0;
            const totems = Math.max(0, Math.floor((st && st.inventory && st.inventory.shamanTotem) || 0));
            const fallen = getFallenSnapshot(st);
            const totalFallen = fallen.slinger + fallen.clubman + fallen.dinorider;
            const revivePerTotem = getGraveyardRevivePerTotem(graveyardLevel);
            const totemsNeededForAll = revivePerTotem > 0 && totalFallen > 0 ? Math.ceil(totalFallen / revivePerTotem) : 0;
            const usableTotemsForAll = Math.min(totems, totemsNeededForAll);
            const canRevive = graveyardBuilt && totems > 0 && totalFallen > 0;

            return {
              graveyardVisible,
              graveyardLevel,
              graveyardBuilt,
              totems,
              fallen,
              totalFallen,
              revivePerTotem,
              totemsNeededForAll,
              usableTotemsForAll,
              canRevive
            };
          }

          function computeAutoSelection(budget, fallen) {
            let rem = Math.max(0, Math.floor(budget || 0));
            const picked = { slinger: 0, clubman: 0, dinorider: 0 };
            for (const key of PRIORITY_ORDER) {
              if (rem <= 0) break;
              const avail = Math.max(0, Math.floor((fallen && fallen[key]) || 0));
              if (avail <= 0) continue;
              const take = Math.min(avail, rem);
              picked[key] = take;
              rem -= take;
            }
            return picked;
          }

          function getDraftTotal() {
            return (draft.slinger || 0) + (draft.clubman || 0) + (draft.dinorider || 0);
          }

          function sanitizeDraft(st = state) {
            const status = getStatus(st);
            let remaining = status.revivePerTotem;
            for (const key of PRIORITY_ORDER) {
              const avail = status.fallen[key] || 0;
              const clamped = Math.min(avail, remaining, Math.max(0, Math.floor(draft[key] || 0)));
              draft[key] = clamped;
              remaining -= clamped;
            }
            return { ...draft };
          }

          function initDraft(st = state) {
            const status = getStatus(st);
            const auto = computeAutoSelection(status.revivePerTotem, status.fallen);
            draft.slinger = auto.slinger;
            draft.clubman = auto.clubman;
            draft.dinorider = auto.dinorider;
            return { ...draft };
          }

          function clearDraft() {
            draft.slinger = 0;
            draft.clubman = 0;
            draft.dinorider = 0;
          }

          function adjustDraft(troopType, delta) {
            if (!TROOP_DEFS[troopType]) return;
            const status = getStatus(state);
            sanitizeDraft(state);
            const avail = status.fallen[troopType] || 0;
            const cur = draft[troopType] || 0;
            const otherTotal = getDraftTotal() - cur;
            const maxAllowed = Math.min(avail, Math.max(0, status.revivePerTotem - otherTotal));
            draft[troopType] = Math.max(0, Math.min(maxAllowed, cur + delta));
          }

          function setDraftMax(troopType) {
            if (!TROOP_DEFS[troopType]) return;
            const status = getStatus(state);
            sanitizeDraft(state);
            const avail = status.fallen[troopType] || 0;
            const cur = draft[troopType] || 0;
            const otherTotal = getDraftTotal() - cur;
            draft[troopType] = Math.min(avail, Math.max(0, status.revivePerTotem - otherTotal));
          }

          function executeRevival({ mode = 'auto', selection = null } = {}) {
            const status = getStatus(state);
            if (!status.graveyardVisible) {
              const missingText = BuildingRegistry.getMissingRequirementsText('graveyard', state);
              SoundFX.play('error');
              showToast(`Friedhof noch nicht freigeschaltet${missingText ? ` (Benötigt: ${missingText})` : ''}.`, 'warn');
              return { ok: false, reason: 'graveyard_locked' };
            }
            if (!status.graveyardBuilt) {
              SoundFX.play('error');
              showToast('Errichte zuerst den Friedhof im Dorf, um das Schamanen-Totem einzusetzen!', 'err');
              return { ok: false, reason: 'no_graveyard' };
            }
            if (status.totalFallen <= 0) {
              SoundFX.play('error');
              showToast('Derzeit ruhen keine gefallenen Einheiten auf dem Friedhof.', 'info');
              return { ok: false, reason: 'no_fallen' };
            }
            if (status.totems <= 0) {
              SoundFX.play('error');
              showToast('Kein Schamanen-Totem im Inventar. Erbeute Totems bei der Dinojagd!', 'err');
              return { ok: false, reason: 'no_totems' };
            }

            let totemsUsed = 1;
            let plan = null;

            if (mode === 'custom') {
              const source = selection || draft;
              let remaining = status.revivePerTotem;
              plan = { slinger: 0, clubman: 0, dinorider: 0 };
              for (const key of PRIORITY_ORDER) {
                const avail = status.fallen[key] || 0;
                const want = Math.max(0, Math.floor((source && source[key]) || 0));
                const take = Math.min(avail, remaining, want);
                plan[key] = take;
                remaining -= take;
              }
              const chosenSum = plan.slinger + plan.clubman + plan.dinorider;
              if (chosenSum <= 0) {
                SoundFX.play('error');
                showToast('Wähle mindestens 1 gefallene Einheit für das Ritual aus.', 'warn');
                return { ok: false, reason: 'empty_selection' };
              }
            } else if (mode === 'all') {
              totemsUsed = Math.max(1, status.usableTotemsForAll);
              plan = computeAutoSelection(totemsUsed * status.revivePerTotem, status.fallen);
            } else {
              totemsUsed = 1;
              plan = computeAutoSelection(status.revivePerTotem, status.fallen);
            }

            if (!state.troops) state.troops = { slinger: 0, clubman: 0, dinorider: 0 };
            if (!state.fallenTroops) state.fallenTroops = { slinger: 0, clubman: 0, dinorider: 0 };

            let revivedTotal = 0;
            const revivedParts = [];
            for (const key of PRIORITY_ORDER) {
              const take = plan[key] || 0;
              if (take <= 0) continue;
              state.fallenTroops[key] = Math.max(0, (state.fallenTroops[key] || 0) - take);
              state.troops[key] = (state.troops[key] || 0) + take;
              revivedTotal += take;
              revivedParts.push(`${take}× ${TROOP_DEFS[key].name}`);
            }

            if (revivedTotal <= 0) return { ok: false, reason: 'none_revived' };

            state.inventory.shamanTotem = Math.max(0, status.totems - totemsUsed);
            initDraft(state);

            SoundFX.play('complete');
            const totemLabel = totemsUsed > 1 ? `${totemsUsed}× Schamanen-Totem` : 'Schamanen-Totem';
            showToast(`${totemLabel} erweckt ${revivedParts.join(', ')} wieder zum Leben!`, 'ok');
            saveState();
            renderAll();
            if (openSheet) renderSheet();

            return {
              ok: true,
              totemsUsed,
              revivedTotal,
              revivedMap: plan,
              revivedParts
            };
          }

          return {
            PRIORITY_ORDER,
            getStatus,
            computeAutoSelection,
            getDraft: () => sanitizeDraft(state),
            getDraftTotal: () => {
              sanitizeDraft(state);
              return getDraftTotal();
            },
            initDraft,
            clearDraft,
            adjustDraft,
            setDraftMax,
            executeRevival
          };
        })();
        window.ShamanTotemSystem = ShamanTotemSystem;

        function reviveFallenTroops(mode = 'auto') {
          return ShamanTotemSystem.executeRevival({ mode });
        }

        function getStaminaRegenIntervalMs() {
          const mLvl = state.buildings.marketplace ? state.buildings.marketplace.level : 0;
          const speedBoost = 1 + Math.max(0, mLvl) * 0.05;
          return Math.max(45000, Math.round(STAMINA_REGEN_BASE_MS / speedBoost));
        }

        function tickStaminaRegen(now) {
          if (typeof state.stamina !== 'number' || !Number.isFinite(state.stamina)) {
            state.stamina = 120;
          }
          if (!state.staminaRegenAt) state.staminaRegenAt = now;
          const interval = getStaminaRegenIntervalMs();
          if (state.stamina >= STAMINA_REGEN_CAP) {
            state.staminaRegenAt = now;
            return;
          }
          const elapsed = now - state.staminaRegenAt;
          if (elapsed >= interval) {
            const ticks = Math.floor(elapsed / interval);
            state.stamina = Math.min(STAMINA_REGEN_CAP, state.stamina + ticks);
            state.staminaRegenAt += ticks * interval;
          }
        }

        function claimMarketStamina() {
          const mLvl = state.buildings.marketplace ? state.buildings.marketplace.level : 0;
          if (mLvl <= 0) {
            SoundFX.play('error');
            showToast('Errichte zuerst den Marktplatz!', 'err');
            return;
          }
          const now = Date.now();
          if ((state.marketClaimAt || 0) > now) {
            SoundFX.play('error');
            showToast('Die nächste kostenlose Ausdauer-Lieferung ist noch nicht bereit.', 'warn');
            return;
          }
          const before = Math.floor(state.stamina || 0);
          state.stamina = Math.min(STAMINA_HARD_CAP, before + MARKET_STAMINA_REWARD);
          const gained = state.stamina - before;
          state.marketClaimAt = now + MARKET_STAMINA_COOLDOWN_MS;
          SoundFX.play('complete');
          showToast(`Marktplatz-Lieferung erhalten: +${gained} Ausdauer für die Dinojagd!`, 'ok');
          saveState();
          renderAll();
          if (openSheet) renderSheet();
        }

        function getWarehouseSafeCaps(lvl) {
          const level = typeof lvl === 'number' ? lvl : (state.buildings.warehouse ? state.buildings.warehouse.level : 0);
          if (level <= 0) return { meat: 0, wood: 0, stone: 0, fur: 0 };
          const scale =
            level <= 10
              ? Math.pow(1.42, level - 1)
              : Math.pow(1.42, 9) * Math.pow(1.22, level - 10);
          return {
            meat: Math.round(500 * scale),
            wood: Math.round(500 * scale),
            stone: Math.round(350 * scale),
            fur: Math.round(250 * scale)
          };
        }

        // Berechnet aktuelle Produktions- & Verbrauchsraten pro Minute
        function computeEconomyRates() {
          const ember = state.ember;
          const coldRes = hasTech('tanning') ? 0.5 : 1.0;
          const overheat = isOverheatMode();
          const hasWoodStock = state.resources.wood > 0.05;
          const overheatEffective = overheat && hasWoodStock;
          const heroBonus = getHeroBonuses();

          // Arbeitsmoral hängt von Feuer-Glut & Fleischversorgung ab
          let targetMorale = 100;
          if (ember < 50) {
            const deficit = (50 - ember) / 50; // 0..1
            targetMorale -= Math.round(deficit * 48 * coldRes);
          }
          if (state.resources.meat <= 0.1) {
            targetMorale -= 25;
          }
          if (state.weather.phase === 'storm' && state.weather.type === 'cold' && !overheatEffective && ember < 70) {
            targetMorale -= Math.round(14 * coldRes);
          }
          targetMorale = Math.max(30, Math.min(100, targetMorale));
          const sovereignProdMult = isOwnTribeVolcanoRuler() ? 1.2 : 1.0;
          const prodMult = (0.5 + (targetMorale / 100) * 0.5) * sovereignProdMult; // 65%..100% (+20% als Vulkan-Herrscher)

          // Jagdhütte (Fleisch & Fell)
          const hLvl = state.buildings.hunter.level;
          const hWorkers = state.buildings.hunter.workers;
          const flintMult = hasTech('flint') ? 1.3 : 1.0;
          // Fallenbau: Passive Fleischproduktion auch mit 1 Arbeiter weniger im Slot (+1 effektiver Jäger für Fleisch)
          const effectiveMeatHunters = hLvl > 0 ? hWorkers + (hasTech('traps') ? 1 : 0) : 0;
          const meatProd = hLvl > 0 ? effectiveMeatHunters * BUILDINGS.hunter.meatPerWorkerPerMin(hLvl) * flintMult * (1 + heroBonus.meat) * prodMult : 0;
          const furProd = hLvl > 0 ? hWorkers * BUILDINGS.hunter.furPerWorkerPerMin(hLvl) * flintMult * (1 + heroBonus.fur) * prodMult : 0;

          // Fleischverbrauch der Bewohner (-25% mit Räuchern)
          const meatPerPop = 1.6 * (hasTech('smoking') ? 0.75 : 1.0);
          const meatCons = state.pop.total * meatPerPop;

          // Holzfäller-Camp (+25% mit Steinbeilen + Helden-Boni)
          const lLvl = state.buildings.lumber.level;
          const lWorkers = state.buildings.lumber.workers;
          const woodProd = lLvl > 0 ? lWorkers * BUILDINGS.lumber.prodPerWorkerPerMin(lLvl) * (hasTech('axes') ? 1.25 : 1.0) * (1 + heroBonus.wood) * prodMult : 0;

          // Signalfeuer automatischer Holzverbrauch (legt stetig automatisch nach, solange Holz da ist)
          const bfLvl = state.buildings.bonfire.level;
          const bfWorkers = state.buildings.bonfire.workers;
          const keeperReduction = Math.max(0.4, 1 - bfWorkers * 0.1 - heroBonus.fireSave);
          let weatherWoodMult = 1.0;
          if (state.weather.phase === 'storm') {
            weatherWoodMult = state.weather.type === 'ash' ? 1.55 : 1.45;
          }
          const heatMult = overheat ? 1.8 : 1.0;
          const woodBurn = (3.4 + (bfLvl - 1) * 1.45) * keeperReduction * weatherWoodMult * heatMult;

          // Steinbruch (+25% mit Schlägel & Keile + Helden-Boni)
          const qLvl = state.buildings.quarry.level;
          const qWorkers = state.buildings.quarry.workers;
          const stoneProd = qLvl > 0 ? qWorkers * BUILDINGS.quarry.prodPerWorkerPerMin(qLvl) * (hasTech('wedges') ? 1.25 : 1.0) * (1 + heroBonus.stone) * prodMult : 0;

          // Automatisches Holz-Nachlegen hält & füllt Feuer-Glut solange Holz im Bestand oder laufend produziert wird
          const autoFeedActive = hasWoodStock || woodProd >= woodBurn;
          let emberDeltaPerMin = 0;
          if (autoFeedActive) {
            let baseGain = overheat ? 24 : 8.5;
            baseGain += bfWorkers * 2.5;
            let stormDrain = 0;
            if (state.weather.phase === 'storm') {
              stormDrain = state.weather.type === 'cold' ? 13.0 : 11.5;
              if (hasTech('tanning')) stormDrain *= 0.82;
            }
            emberDeltaPerMin = baseGain - stormDrain;
          } else {
            // Kein Holz mehr im Bestand: Automatisches Nachlegen pausiert -> Glut sinkt
            emberDeltaPerMin = state.weather.phase === 'storm' ? -22 : -12;
          }

          return {
            targetMorale,
            meatProd,
            meatCons,
            meatNet: meatProd - meatCons,
            woodProd,
            woodBurn,
            woodNet: woodProd - woodBurn,
            stoneNet: stoneProd,
            furNet: furProd,
            emberDeltaPerMin,
            autoFeedActive
          };
        }

        function getEmberStatus(val) {
          if (val >= 75) return { label: 'Lodernd', color: '#fb923c' };
          if (val >= 45) return { label: 'Stabil', color: '#f59e0b' };
          if (val >= 15) return { label: 'Schwach', color: '#fca5a5' };
          return { label: 'Kritisch', color: '#ef4444' };
        }

        /* =====================================================================
           5. FORMATIERUNG & UI-HILFSFUNKTIONEN
           ===================================================================== */
        function fmtNum(n) {
          const v = Math.floor(n);
          if (v >= 1000000) return (v / 1000000).toFixed(1).replace('.', ',') + 'M';
          if (v >= 10000) return (v / 1000).toFixed(1).replace('.', ',') + 'k';
          return String(v);
        }

        function fmtRate(perMin) {
          const rounded = Math.round(perMin);
          if (rounded === 0) return '0/m';
          return (rounded > 0 ? '+' : '') + rounded + '/m';
        }

        function fmtDuration(totalSec) {
          const s = Math.max(0, Math.ceil(totalSec));
          if (s < 60) return `${s} Sek.`;
          const days = Math.floor(s / 86400);
          const hours = Math.floor((s % 86400) / 3600);
          const mins = Math.floor((s % 3600) / 60);
          const secs = s % 60;
          if (days > 0) return hours > 0 ? `${days} T. ${hours} Std.` : `${days} T.`;
          if (hours > 0) return mins > 0 ? `${hours} Std. ${mins} Min.` : `${hours} Std.`;
          return secs > 0 ? `${mins} Min. ${secs} Sek.` : `${mins} Min.`;
        }

        function fmtClock(totalSec) {
          const s = Math.max(0, Math.ceil(totalSec));
          const d = Math.floor(s / 86400);
          const h = Math.floor((s % 86400) / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sec = s % 60;
          const pad = (x) => String(x).padStart(2, '0');
          if (d > 0) return `${d}T ${pad(h)}:${pad(m)}:${pad(sec)}`;
          if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
          return `${pad(m)}:${pad(sec)}`;
        }

        function showToast(message, tone = 'info') {
          const stack = document.getElementById('toastStack');
          if (!stack) return;
          const el = document.createElement('div');
          el.className = `toast-item ${tone}`;
          el.textContent = message;
          stack.appendChild(el);
          setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-6px)';
            el.style.transition = 'opacity 180ms ease, transform 180ms ease';
            setTimeout(() => el.remove(), 200);
          }, 3200);
        }

        /* =====================================================================
           6. GAME-LOOP (1-SEKUNDEN-TICK) & OFFLINE-SIMULATION
           ===================================================================== */
        function advanceWeather(now) {
          let guard = 0;
          while (now >= state.weather.phaseEndsAt && guard < 12) {
            guard++;
            if (state.weather.phase === 'calm') {
              state.weather.phase = 'warning';
              state.weather.type = Math.random() < 0.5 ? 'cold' : 'ash';
              state.weather.phaseEndsAt += 75000; // 75s Vorwarnung
              if (guard === 1) {
                const label = state.weather.type === 'cold' ? 'Kälteeinbruch' : 'Aschesturm';
                showToast(`Vorwarnung: ${label} zieht auf! Prüfe Holz und Glut.`, 'warn');
              }
            } else if (state.weather.phase === 'warning') {
              state.weather.phase = 'storm';
              state.weather.phaseEndsAt += 105000; // 1m 45s Sturm
              if (guard === 1) {
                const label = state.weather.type === 'cold' ? 'Kälteeinbruch' : 'Aschesturm';
                showToast(`${label} hat die Siedlung erreicht!`, 'warn');
              }
            } else {
              state.weather.phase = 'calm';
              state.weather.phaseEndsAt += 165000 + Math.floor(Math.random() * 45000);
              if (guard === 1) {
                showToast('Der Sturm zieht ab — die vulkanische Nacht beruhigt sich.', 'ok');
              }
            }
          }
          if (now >= state.weather.phaseEndsAt) {
            state.weather.phase = 'calm';
            state.weather.phaseEndsAt = now + 180000;
          }
        }

        function finishActiveBuild() {
          if (!state.activeBuild) return null;
          const visibleBefore = new Set(BuildingRegistry.getVisibleBuildingIds(state));
          const bId = state.activeBuild.buildingId;
          const target = state.activeBuild.targetLevel;
          state.buildings[bId].level = target;
          state.activeBuild = null;
          // Belohnung für Ausbau: Knochen & bei Signalfeuer Goldener Knochen + Beschleuniger
          addInventoryItem('bones', 1);
          if (bId === 'bonfire') {
            addInventoryItem('goldenBones', 1);
            addInventoryItem('speedup5m', 1);
          }
          const newlyUnlocked = BuildingRegistry.getVisibleBuildingIds(state)
            .filter((id) => !visibleBefore.has(id))
            .map((id) => BUILDINGS[id].name);
          return { name: BUILDINGS[bId].name, level: target, newlyUnlocked };
        }

        function finishActiveResearch() {
          if (!state.activeResearch) return null;
          const techId = state.activeResearch.techId;
          if (!state.completedTechs.includes(techId)) {
            state.completedTechs.push(techId);
          }
          state.activeResearch = null;
          addInventoryItem('bones', 1);
          addInventoryItem('heroXp', 120);
          const tech = RESEARCH_LIST.find((t) => t.id === techId);
          return tech ? tech.name : techId;
        }

        function rollExpeditionOutcome(exp) {
          const def = EXPEDITIONS.find((e) => e.id === exp.targetId);
          if (!def) return;
          const loot = {};
          for (const [res, range] of Object.entries(def.loot)) {
            const [min, max] = range;
            loot[res] = Math.round(min + Math.random() * (max - min));
          }
          const risk = getExpeditionRisk(def);
          const injured = Math.random() < risk ? 1 : 0;
          exp.completed = true;
          exp.loot = loot;
          exp.injured = injured;
        }

        /* =====================================================================
           5B. WELTKARTE: SAMMELTRUPPS, LAUFZEITEN & REGENERATION
           ===================================================================== */
        function getWorldNodeDef(nodeId) {
          return WORLD_NODES.find((n) => n.id === nodeId) || null;
        }

        function getWorldNodeState(nodeId) {
          if (!state.worldNodes) state.worldNodes = createInitialWorldNodes();
          const def = getWorldNodeDef(nodeId);
          if (!state.worldNodes[nodeId] && def) {
            state.worldNodes[nodeId] = {
              xPct: def.xPct,
              yPct: def.yPct,
              resource: def.resource,
              name: def.name,
              level: def.level,
              capacity: def.capacity,
              remaining: def.capacity,
              respawnAt: 0,
              spawnVersion: 0,
              updatedAt: 0
            };
          }
          const st = state.worldNodes[nodeId];
          if (st && def) {
            if (typeof st.xPct !== 'number') st.xPct = def.xPct;
            if (typeof st.yPct !== 'number') st.yPct = def.yPct;
            if (!st.resource) st.resource = def.resource;
            if (!st.name) st.name = def.name;
            if (!st.level) st.level = def.level;
            if (!st.capacity) st.capacity = def.capacity;
          }
          return st;
        }

        function getWorldNodeInfo(nodeId) {
          const def = getWorldNodeDef(nodeId);
          if (!def) return null;
          const nState = getWorldNodeState(nodeId);
          const meta = buildNodeMetadataForSpot(nState.resource || def.resource, nState.level || def.level);
          return {
            ...def,
            ...meta,
            id: def.id,
            name: nState.name || meta.name || def.name,
            resource: nState.resource || def.resource,
            level: nState.level || def.level,
            capacity: nState.capacity || def.capacity,
            xPct: typeof nState.xPct === 'number' ? nState.xPct : def.xPct,
            yPct: typeof nState.yPct === 'number' ? nState.yPct : def.yPct
          };
        }

        function getNodePos(nodeId) {
          const info = getWorldNodeInfo(nodeId);
          if (!info) return null;
          const wx = (info.xPct / 100) * WORLD_GRID_COLS;
          const wy = (info.yPct / 100) * WORLD_GRID_ROWS;
          return {
            xPct: info.xPct,
            yPct: info.yPct,
            wx,
            wy,
            coordX: Math.round(wx),
            coordY: Math.round(wy)
          };
        }

        function getWorldMarchTravelSec(targetPos) {
          const home = getHomePos();
          const tx = typeof targetPos?.xPct === 'number' ? targetPos.xPct : home.xPct;
          const ty = typeof targetPos?.yPct === 'number' ? targetPos.yPct : home.yPct;
          const dx = (tx - home.xPct) * 1.6;
          const dy = ty - home.yPct;
          const dist = Math.hypot(dx, dy);
          const heroBonus = getHeroBonuses();
          let sec = Math.max(10, Math.round((7 + dist * 0.42) / (1 + heroBonus.march)));
          if (hasTech('nets')) sec = Math.max(8, Math.round(sec * 0.8));
          return sec;
        }

        function getWorldGatherSpeedMult(resource) {
          let mult = 1;
          if (resource === 'wood' && hasTech('axes')) mult += 0.25;
          if (resource === 'stone' && hasTech('wedges')) mult += 0.25;
          if ((resource === 'meat' || resource === 'fur') && hasTech('flint')) mult += 0.3;
          return mult;
        }

        function getGatherSquadSpeedMult(resource, heroIds = [], troops = null) {
          let mult = getWorldGatherSpeedMult(resource);
          const hCnt = Array.isArray(heroIds) ? heroIds.length : 0;
          const soldCnt = troops ? (troops.slinger || 0) + (troops.clubman || 0) + (troops.dinorider || 0) : 0;
          mult += hCnt * 0.1;
          mult += Math.min(0.65, soldCnt * 0.015);
          return mult;
        }

        function getWorldGatherDurationSec(nodeInfo, amount, heroIds = [], troops = null) {
          const cap = Math.max(1, nodeInfo.capacity || 60);
          const ratio = Math.max(0.15, amount / cap);
          const speed = getGatherSquadSpeedMult(nodeInfo.resource, heroIds, troops);
          return Math.max(10, Math.round((nodeInfo.baseGatherSec * ratio) / speed));
        }

        function getActiveMarchForNode(nodeId) {
          return (state.worldMarches || []).find((m) => (m.kind || 'gather') === 'gather' && m.nodeId === nodeId) || null;
        }

        function getEnemyNodeOccupant(nodeId) {
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;
          const now = Date.now();
          for (const occ of mpWorld.nodeOccupants || []) {
            if (!occ || occ.nodeId !== nodeId) continue;
            if (ownUid && occ.uid === ownUid) continue;
            if (occ.gatherEndsAt && occ.gatherEndsAt <= now) continue;
            return occ;
          }
          return null;
        }

        function getDinoSpecies(speciesId) {
          return DINO_SPECIES.find((s) => s.id === speciesId) || null;
        }

        function getWorldDinoDef(dinoId) {
          return WORLD_DINOS.find((d) => d.id === dinoId) || null;
        }

        function getWorldDinoState(dinoId) {
          if (!state.worldDinos) state.worldDinos = createInitialWorldDinos();
          const def = getWorldDinoDef(dinoId);
          if (!state.worldDinos[dinoId] && def) {
            state.worldDinos[dinoId] = {
              xPct: def.xPct,
              yPct: def.yPct,
              speciesId: def.speciesId,
              level: def.defaultLevel,
              respawnAt: 0,
              spawnVersion: 0,
              updatedAt: 0
            };
          }
          const st = state.worldDinos[dinoId];
          if (st && def) {
            if (typeof st.xPct !== 'number') st.xPct = def.xPct;
            if (typeof st.yPct !== 'number') st.yPct = def.yPct;
            if (!st.speciesId) st.speciesId = def.speciesId;
            if (!st.level) st.level = def.defaultLevel;
          }
          return st;
        }

        function getDinoPos(dinoId) {
          const def = getWorldDinoDef(dinoId);
          if (!def) return null;
          const dState = getWorldDinoState(dinoId);
          const xPct = typeof dState.xPct === 'number' ? dState.xPct : def.xPct;
          const yPct = typeof dState.yPct === 'number' ? dState.yPct : def.yPct;
          const wx = (xPct / 100) * WORLD_GRID_COLS;
          const wy = (yPct / 100) * WORLD_GRID_ROWS;
          return {
            xPct,
            yPct,
            wx,
            wy,
            coordX: Math.round(wx),
            coordY: Math.round(wy)
          };
        }

        function pickFreeWorldSpawnSpot(excludeId = null) {
          const home = getHomePos();
          const occupiedPts = [{ gx: home.wx, gy: home.wy, minDist: 28 }];
          for (const pl of mpWorld.settlements || []) {
            occupiedPts.push({ gx: Number(pl.tileX) + 1, gy: Number(pl.tileY) + 1, minDist: 24 });
          }
          for (const n of WORLD_NODES) {
            if (n.id === excludeId) continue;
            const st = getWorldNodeState(n.id);
            if (!st) continue;
            occupiedPts.push({ gx: (st.xPct / 100) * WORLD_GRID_COLS, gy: (st.yPct / 100) * WORLD_GRID_ROWS, minDist: 22 });
          }
          for (const d of WORLD_DINOS) {
            if (d.id === excludeId) continue;
            const st = getWorldDinoState(d.id);
            if (!st) continue;
            occupiedPts.push({ gx: (st.xPct / 100) * WORLD_GRID_COLS, gy: (st.yPct / 100) * WORLD_GRID_ROWS, minDist: 22 });
          }

          for (let attempt = 0; attempt < 180; attempt++) {
            const gx = 65 + Math.floor(Math.random() * (WORLD_GRID_COLS - 130));
            const gy = 65 + Math.floor(Math.random() * (WORLD_GRID_ROWS - 130));
            if (getStaticWorldTileState(gx, gy) !== TILE_FREE) continue;
            let blocked = false;
            for (const pt of occupiedPts) {
              if (Math.hypot(gx - pt.gx, gy - pt.gy) < pt.minDist) {
                blocked = true;
                break;
              }
            }
            if (blocked) continue;
            return {
              gx,
              gy,
              xPct: Number(((gx / WORLD_GRID_COLS) * 100).toFixed(2)),
              yPct: Number(((gy / WORLD_GRID_ROWS) * 100).toFixed(2))
            };
          }
          // Fallback auf freien Ring
          const angle = Math.random() * Math.PI * 2;
          const r = 240 + Math.random() * 260;
          const gx = Math.max(100, Math.min(WORLD_GRID_COLS - 100, Math.round(600 + Math.cos(angle) * r)));
          const gy = Math.max(100, Math.min(WORLD_GRID_ROWS - 100, Math.round(600 + Math.sin(angle) * r)));
          return {
            gx,
            gy,
            xPct: Number(((gx / WORLD_GRID_COLS) * 100).toFixed(2)),
            yPct: Number(((gy / WORLD_GRID_ROWS) * 100).toFixed(2))
          };
        }

        function relocateWorldNode(nodeId, broadcast = true) {
          const def = getWorldNodeDef(nodeId);
          const nState = getWorldNodeState(nodeId);
          if (!def || !nState) return;
          const spot = pickFreeWorldSpawnSpot(nodeId);
          const distFromCenter = Math.hypot(spot.gx - 600, spot.gy - 600);
          const normCenter = Math.max(0, Math.min(1, 1 - (distFromCenter - 155) / 480));
          const resources = ['wood', 'meat', 'stone', 'fur'];
          const nextRes = resources[Math.floor(Math.random() * resources.length)];
          const nextLevel = Math.max(1, Math.min(8, Math.round(1 + normCenter * 6 + (Math.random() - 0.5) * 2)));
          const meta = buildNodeMetadataForSpot(nextRes, nextLevel);
          const now = Date.now();

          nState.xPct = spot.xPct;
          nState.yPct = spot.yPct;
          nState.resource = meta.resource;
          nState.name = meta.name;
          nState.level = meta.level;
          nState.capacity = meta.capacity;
          nState.remaining = meta.capacity;
          nState.respawnAt = 0;
          nState.spawnVersion = (nState.spawnVersion || 0) + 1;
          nState.updatedAt = now;

          initWorldStaticGrid(state);
          if (openSheet && openSheet.type === 'worldNode' && openSheet.id === nodeId) {
            closeSheet();
          }

          if (broadcast && window.DinoMultiplayer && typeof window.DinoMultiplayer.relocateWorldSpawn === 'function') {
            void window.DinoMultiplayer.relocateWorldSpawn({
              id: nodeId,
              kind: 'node',
              xPct: nState.xPct,
              yPct: nState.yPct,
              resource: nState.resource,
              level: nState.level,
              capacity: nState.capacity,
              remaining: nState.remaining
            });
          }
        }

        function relocateWorldDino(dinoId, broadcast = true) {
          const def = getWorldDinoDef(dinoId);
          const dState = getWorldDinoState(dinoId);
          if (!def || !dState) return;
          const spot = pickFreeWorldSpawnSpot(dinoId);
          const distFromCenter = Math.hypot(spot.gx - 600, spot.gy - 600);
          const normCenter = Math.max(0, Math.min(1, 1 - (distFromCenter - 155) / 480));
          const spIndex = Math.max(
            0,
            Math.min(DINO_SPECIES.length - 1, Math.floor(normCenter * DINO_SPECIES.length * 0.92 + Math.random() * 1.4))
          );
          const sp = DINO_SPECIES[spIndex] || getDinoSpecies(dState.speciesId) || DINO_SPECIES[0];
          const [minL, maxL] = sp.levelRange;
          const nextLevel = minL + Math.floor(Math.random() * (maxL - minL + 1));
          const now = Date.now();

          dState.xPct = spot.xPct;
          dState.yPct = spot.yPct;
          dState.speciesId = sp.id;
          dState.level = nextLevel;
          dState.respawnAt = 0;
          dState.spawnVersion = (dState.spawnVersion || 0) + 1;
          dState.updatedAt = now;

          initWorldStaticGrid(state);
          if (openSheet && openSheet.type === 'worldDino' && openSheet.id === dinoId) {
            closeSheet();
          }

          if (broadcast && window.DinoMultiplayer && typeof window.DinoMultiplayer.relocateWorldSpawn === 'function') {
            void window.DinoMultiplayer.relocateWorldSpawn({
              id: dinoId,
              kind: 'dino',
              xPct: dState.xPct,
              yPct: dState.yPct,
              speciesId: dState.speciesId,
              level: dState.level
            });
          }
        }

        function applyRemoteDynamicSpawns(dynamicSpawns) {
          if (!Array.isArray(dynamicSpawns) || dynamicSpawns.length === 0) return;
          let changed = false;
          for (const sp of dynamicSpawns) {
            if (!sp || !sp.id) continue;
            if (sp.kind === 'node') {
              const nState = getWorldNodeState(sp.id);
              if (!nState) continue;
              if ((sp.updatedAt || 0) <= (nState.updatedAt || 0)) continue;
              const nextRes = sp.resource && RESOURCE_LABELS[sp.resource] ? sp.resource : nState.resource;
              const nextLvl = Math.max(1, Math.min(10, Number(sp.level || nState.level || 1)));
              const meta = buildNodeMetadataForSpot(nextRes, nextLvl);
              nState.xPct = Number(sp.xPct);
              nState.yPct = Number(sp.yPct);
              nState.resource = nextRes;
              nState.name = meta.name;
              nState.level = nextLvl;
              nState.capacity = Number(sp.capacity || meta.capacity);
              nState.remaining = Number(sp.remaining ?? nState.capacity);
              nState.respawnAt = 0;
              nState.updatedAt = Number(sp.updatedAt || Date.now());
              changed = true;
            } else if (sp.kind === 'dino') {
              const dState = getWorldDinoState(sp.id);
              if (!dState) continue;
              if ((sp.updatedAt || 0) <= (dState.updatedAt || 0)) continue;
              dState.xPct = Number(sp.xPct);
              dState.yPct = Number(sp.yPct);
              if (sp.speciesId && getDinoSpecies(sp.speciesId)) {
                dState.speciesId = sp.speciesId;
              }
              if (sp.level) {
                dState.level = Math.max(1, Math.min(MAX_LEVEL, Number(sp.level)));
              }
              dState.respawnAt = 0;
              dState.updatedAt = Number(sp.updatedAt || Date.now());
              changed = true;
            }
          }
          if (changed) {
            initWorldStaticGrid(state);
          }
        }

        function getBestiaryEntry(speciesId) {
          if (!state.bestiary) state.bestiary = createInitialBestiary();
          if (!state.bestiary[speciesId]) {
            state.bestiary[speciesId] = { discovered: false, huntedCount: 0, highestLevel: 0, firstSeenAt: 0 };
          }
          return state.bestiary[speciesId];
        }

        function recordBestiaryDiscovery(speciesId) {
          const entry = getBestiaryEntry(speciesId);
          if (!entry.discovered) {
            entry.discovered = true;
            entry.firstSeenAt = Date.now();
            return true;
          }
          return false;
        }

        function recordBestiaryHunt(speciesId, level) {
          const entry = getBestiaryEntry(speciesId);
          const newlyDiscovered = !entry.discovered;
          entry.discovered = true;
          if (!entry.firstSeenAt) entry.firstSeenAt = Date.now();
          entry.huntedCount = (entry.huntedCount || 0) + 1;
          entry.highestLevel = Math.max(entry.highestLevel || 0, level);
          return newlyDiscovered;
        }

        function getDinoCombatPower(species, level) {
          if (!species) return 500;
          return Math.round((240 + level * 145 + Math.pow(level, 1.85) * 42) * species.powerFactor);
        }

        function getDeployedHeroIds() {
          const set = new Set();
          for (const m of state.worldMarches || []) {
            if ((m.kind === 'hunt' || m.kind === 'volcano' || (m.kind || 'gather') === 'gather') && Array.isArray(m.heroes)) {
              for (const hId of m.heroes) set.add(hId);
            }
          }
          return set;
        }

        function getDeployedTroops() {
          const out = { slinger: 0, clubman: 0, dinorider: 0 };
          for (const m of state.worldMarches || []) {
            if ((m.kind === 'hunt' || m.kind === 'volcano' || (m.kind || 'gather') === 'gather') && m.troops) {
              out.slinger += m.troops.slinger || 0;
              out.clubman += m.troops.clubman || 0;
              out.dinorider += m.troops.dinorider || 0;
            }
          }
          return out;
        }

        function getAvailableTroopCount(troopType) {
          const total = (state.troops && state.troops[troopType]) || 0;
          const busy = getDeployedTroops()[troopType] || 0;
          return Math.max(0, total - busy);
        }

        function getActiveMarchForDino(dinoId) {
          return (state.worldMarches || []).find((m) => m.kind === 'hunt' && m.dinoId === dinoId) || null;
        }

        function computeHuntSquadPower(heroIds, troops, species) {
          let heroBase = 0;
          let pveBonusPct = 0;
          let counterBonusPct = 0;
          const roles = new Set();

          for (const hId of heroIds || []) {
            const def = HEROES_LIST.find((h) => h.id === hId);
            const hState = state.heroes && state.heroes[hId];
            if (!def || !hState || !hState.unlocked) continue;
            heroBase += getHeroPower(def, hState);
            roles.add(def.role);
            const pveSkills = (hState.skills && hState.skills.pve) || [1, 1, 1];
            for (const lv of pveSkills) {
              pveBonusPct += Math.max(0, lv - 1) * 4;
            }
            if (species && def.role === species.counterRole) {
              counterBonusPct = 8;
            }
          }
          if (species && species.id === 'tyrannosaurus' && roles.size === 3) {
            counterBonusPct = 12;
          }

          let troopBase = 0;
          for (const key of Object.keys(TROOP_DEFS)) {
            troopBase += ((troops && troops[key]) || 0) * TROOP_DEFS[key].powerPerUnit;
          }

          const mult = 1 + (pveBonusPct + counterBonusPct) / 100;
          const total = Math.round((heroBase + troopBase) * mult);
          return { total, heroBase, troopBase, pveBonusPct, counterBonusPct };
        }

        function initHuntDraft(dinoId) {
          const busyHeroes = getDeployedHeroIds();
          const pickedByRole = {};
          const picked = [];
          // Automatisch je 1 stärksten freien Held pro Klasse (Nahkampf, Tank, Fernkampf — max. 3) vorauswählen
          const unlocked = HEROES_LIST.filter((h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked && !busyHeroes.has(h.id))
            .sort((a, b) => getHeroPower(b, state.heroes[b.id]) - getHeroPower(a, state.heroes[a.id]));
          for (const h of unlocked) {
            if (picked.length >= 3) break;
            if (!pickedByRole[h.role]) {
              pickedByRole[h.role] = h.id;
              picked.push(h.id);
            }
          }
          huntDraft = {
            dinoId,
            heroIds: picked,
            troops: {
              slinger: getAvailableTroopCount('slinger'),
              clubman: getAvailableTroopCount('clubman'),
              dinorider: getAvailableTroopCount('dinorider')
            }
          };
        }

        function toggleHuntDraftHero(heroId) {
          const def = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!def || !hState || !hState.unlocked) return;
          if (getDeployedHeroIds().has(heroId)) {
            SoundFX.play('error');
            showToast(`${def.name} ist bereits auf einem anderen Jagdmarsch.`, 'warn');
            return;
          }
          const idx = huntDraft.heroIds.indexOf(heroId);
          if (idx >= 0) {
            huntDraft.heroIds.splice(idx, 1);
            SoundFX.play('tap');
            renderSheet();
            return;
          }
          // Strikte Regel: Nur 1 Held jeder Art (Nahkampf / Tank / Fernkampf) und maximal 3 Helden
          const sameRoleIdx = huntDraft.heroIds.findIndex((id) => {
            const existing = HEROES_LIST.find((h) => h.id === id);
            return existing && existing.role === def.role;
          });
          if (sameRoleIdx >= 0) {
            huntDraft.heroIds.splice(sameRoleIdx, 1, heroId);
            SoundFX.play('tap');
            showToast(`${def.role}-Platz mit ${def.name} getauscht (max. 1 Held pro Art).`, 'info');
          } else {
            if (huntDraft.heroIds.length >= 3) {
              SoundFX.play('error');
              showToast('Maximal 3 Helden pro Jagdtrupp möglich.', 'warn');
              return;
            }
            huntDraft.heroIds.push(heroId);
            SoundFX.play('tap');
          }
          renderSheet();
        }

        function adjustHuntDraftTroop(troopType, delta) {
          if (!TROOP_DEFS[troopType]) return;
          const avail = getAvailableTroopCount(troopType);
          const cur = huntDraft.troops[troopType] || 0;
          huntDraft.troops[troopType] = Math.max(0, Math.min(avail, cur + delta));
          SoundFX.play('tap');
          renderSheet();
        }

        function setHuntDraftTroopMax(troopType) {
          if (!TROOP_DEFS[troopType]) return;
          huntDraft.troops[troopType] = getAvailableTroopCount(troopType);
          SoundFX.play('tap');
          renderSheet();
        }

        function fillHuntDraftAllTroops() {
          for (const key of Object.keys(TROOP_DEFS)) {
            huntDraft.troops[key] = getAvailableTroopCount(key);
          }
          SoundFX.play('tap');
          renderSheet();
        }

        function clearHuntDraftTroops() {
          for (const key of Object.keys(TROOP_DEFS)) {
            huntDraft.troops[key] = 0;
          }
          SoundFX.play('tap');
          renderSheet();
        }

        function launchDinoHunt(dinoId) {
          const def = getWorldDinoDef(dinoId);
          if (!def) return;
          const dState = getWorldDinoState(dinoId);
          const species = getDinoSpecies(dState.speciesId);
          if (!species) return;
          const now = Date.now();

          if (dState.respawnAt > now) {
            SoundFX.play('error');
            showToast('Dieser Saurier wurde kürzlich erlegt und kehrt bald zurück.', 'warn');
            return;
          }
          if (getActiveMarchForDino(dinoId)) {
            SoundFX.play('error');
            showToast('Auf diesen Saurier marschiert bereits ein Jagdtrupp.', 'warn');
            return;
          }
          if ((state.worldMarches || []).length >= getMaxWorldMarches()) {
            SoundFX.play('error');
            showToast(`Alle ${getMaxWorldMarches()} Marschwarteschlange(n) belegt. Baue das Signalfeuer aus für mehr Plätze!`, 'warn');
            return;
          }

          // Validierung: Max 3 Helden, streng 1 pro Art, keine doppelt entsendeten Helden
          const busyHeroes = getDeployedHeroIds();
          const validHeroes = [];
          const usedRoles = new Set();
          for (const hId of huntDraft.heroIds || []) {
            const hDef = HEROES_LIST.find((h) => h.id === hId);
            const hSt = state.heroes && state.heroes[hId];
            if (!hDef || !hSt || !hSt.unlocked || busyHeroes.has(hId)) continue;
            if (usedRoles.has(hDef.role)) continue;
            if (validHeroes.length >= 3) break;
            usedRoles.add(hDef.role);
            validHeroes.push(hId);
          }

          const sendTroops = {
            slinger: Math.min(getAvailableTroopCount('slinger'), Math.max(0, Math.floor(huntDraft.troops.slinger || 0))),
            clubman: Math.min(getAvailableTroopCount('clubman'), Math.max(0, Math.floor(huntDraft.troops.clubman || 0))),
            dinorider: Math.min(getAvailableTroopCount('dinorider'), Math.max(0, Math.floor(huntDraft.troops.dinorider || 0)))
          };
          const totalSoldiers = sendTroops.slinger + sendTroops.clubman + sendTroops.dinorider;
          if (totalSoldiers <= 0) {
            SoundFX.play('error');
            showToast('Wähle mindestens 1 ausgebildeten Soldaten für die Dinojagd aus.', 'err');
            return;
          }
          tickStaminaRegen(now);
          if ((state.stamina || 0) < DINO_HUNT_STAMINA_COST) {
            SoundFX.play('error');
            showToast(`Zu wenig Ausdauer (${Math.floor(state.stamina || 0)}/${DINO_HUNT_STAMINA_COST}). Hole am Marktplatz alle 12 Std. kostenlos 300 Ausdauer ab!`, 'err');
            return;
          }
          state.stamina = Math.max(0, Math.floor(state.stamina || 0) - DINO_HUNT_STAMINA_COST);

          const dinoPos = getDinoPos(def.id) || def;
          const travelSec = getWorldMarchTravelSec(dinoPos);
          const powerInfo = computeHuntSquadPower(validHeroes, sendTroops, species);

          const huntMarchObj = {
            id: `hunt_${now}_${Math.floor(Math.random() * 999)}`,
            kind: 'hunt',
            dinoId: def.id,
            speciesId: species.id,
            dinoLevel: dState.level,
            targetX: dinoPos.xPct,
            targetY: dinoPos.yPct,
            heroes: validHeroes,
            troops: sendTroops,
            squadPower: powerInfo.total,
            phase: 'marching_out',
            startedAt: now,
            phaseEndsAt: now + travelSec * 1000,
            travelSec,
            outcome: null,
            serverCombat: null
          };
          state.worldMarches.push(huntMarchObj);

          // Multiplayer: Marsch auf gemeinsamer Weltkarte senden + autoritative Server-Kampfberechnung anfordern
          if (window.DinoMultiplayer) {
            const home = getHomePos();
            window.DinoMultiplayer.broadcastMarch({
              marchId: huntMarchObj.id,
              kind: 'hunt',
              fromX: home.xPct,
              fromY: home.yPct,
              toX: dinoPos.xPct,
              toY: dinoPos.yPct,
              targetLabel: `${species.name} St.${dState.level}`,
              durationMs: travelSec * 1000
            });
            const heroPayload = validHeroes
              .map((hId) => {
                const hDef = HEROES_LIST.find((h) => h.id === hId);
                const hSt = state.heroes && state.heroes[hId];
                if (!hDef) return null;
                return {
                  id: hDef.id,
                  name: hDef.name,
                  shortName: hDef.shortName || hDef.name.split(' ')[0],
                  role: hDef.role,
                  rarity: hDef.rarity,
                  color: hDef.color || '#f59e0b',
                  level: (hSt && hSt.level) || 1,
                  skillName: (hDef.skills && hDef.skills[0] && hDef.skills[0].name) || 'Sturmangriff'
                };
              })
              .filter(Boolean);
            window.DinoMultiplayer.resolveDinoHuntServer({
              dinoId: def.id,
              speciesId: species.id,
              dinoLevel: dState.level,
              squadPower: powerInfo.total,
              heroes: heroPayload,
              troops: { ...sendTroops }
            }).then((srvRes) => {
              if (srvRes && typeof srvRes.victory === 'boolean') {
                huntMarchObj.serverCombat = srvRes;
              }
            });
          }

          SoundFX.play('horn');
          showToast(`Jagdtrupp (${validHeroes.length} Helden, ${totalSoldiers} Soldaten) marschiert gegen ${species.name} St. ${dState.level}!`, 'ok');
          saveState();
          closeSheet();
          renderAll();
        }

        function buildDinoBattleLog({
          march,
          arriveTs,
          species,
          dinoPower,
          ratio,
          victory,
          troopsSent,
          troopsLost,
          lostTotal,
          resources,
          items,
          xp,
          newlyDiscovered
        }) {
          const heroEntries = (march.heroes || [])
            .map((hId) => {
              const def = HEROES_LIST.find((h) => h.id === hId);
              const hs = state.heroes && state.heroes[hId];
              if (!def || !hs) return null;
              const rMeta = RARITY_META[def.rarity] || RARITY_META.rare;
              const pveDefs = (HERO_SKILLS_MAP[def.id] && HERO_SKILLS_MAP[def.id].pve) || [];
              const skillName = (pveDefs[0] && pveDefs[0].name) || 'Urzeit-Angriff';
              return {
                id: def.id,
                name: def.name,
                shortName: def.name.split(' ')[0],
                role: def.role,
                rarity: def.rarity,
                color: rMeta.color,
                level: hs.level || 1,
                skillName
              };
            })
            .filter(Boolean);

          const counterMatched = heroEntries.some((h) => h.role === species.counterRole);
          const totalSent = (troopsSent.slinger || 0) + (troopsSent.clubman || 0) + (troopsSent.dinorider || 0);
          const squadHpMax = Math.max(400, Math.round(march.squadPower * 1.15));
          const dinoHpMax = Math.max(360, Math.round(dinoPower * 1.2));

          // End-HP realistisch anhand Ausgang und Verhältnis berechnen
          const targetSquadEndPct = victory
            ? Math.max(24, Math.min(96, Math.round(92 - Math.min(0.68, Math.max(0, 1.45 - ratio) * 0.72) * 100 - lostTotal * 2)))
            : Math.max(8, Math.min(20, 16 - Math.min(8, lostTotal)));
          const targetDinoEndPct = victory ? 0 : Math.max(18, Math.min(62, Math.round((1 - Math.min(0.82, ratio * 0.85)) * 100)));

          const totalRounds = victory ? (ratio >= 1.45 ? 4 : 5) : 5;
          const squadAttackCount = Math.ceil(totalRounds / 2);
          const dinoAttackCount = Math.floor(totalRounds / 2);

          const totalDinoDmg = Math.round(((100 - targetDinoEndPct) / 100) * dinoHpMax);
          const totalSquadDmg = Math.round(((100 - targetSquadEndPct) / 100) * squadHpMax);

          const rounds = [];
          let curSquadHp = squadHpMax;
          let curDinoHp = dinoHpMax;
          let squadHitsDone = 0;
          let dinoHitsDone = 0;
          const dinoStrengths = Array.isArray(species.strengths) && species.strengths.length ? species.strengths : ['Prankenhieb', 'Urzeit-Brüllen'];
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

              const isCrit = Boolean(
                (hero && hero.role === species.counterRole) ||
                  (isLastSquadHit && victory) ||
                  Math.random() < 0.34
              );
              const actorName = hero ? hero.name : 'Jagdtrupp';
              const actorRole = hero ? hero.role : 'Truppe';
              const actionName = hero
                ? squadHitsDone === 1 || isCrit
                  ? hero.skillName
                  : `${hero.role}-Vorstoß`
                : 'Soldaten-Salve';
              const counterNote = hero && hero.role === species.counterRole ? ' (Konter-Bonus!)' : '';
              const logText =
                victory && r === totalRounds
                  ? `${actorName} setzt „${actionName}“ ein und bezwingt ${species.name} mit ${fmtNum(dmg)} Schaden!${counterNote}`
                  : `${actorName} trifft mit „${actionName}“ für ${fmtNum(dmg)} Schaden${isCrit ? ' — Kritischer Treffer!' : '.'}${counterNote}`;

              rounds.push({
                round: r,
                actorSide: 'squad',
                heroId: hero ? hero.id : null,
                actorName,
                actorRole,
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

              const dinoMove = dinoStrengths[(dinoHitsDone - 1) % dinoStrengths.length];
              const shieldText = isShield && tankHero ? ` ${tankHero.shortName} fängt den Stoß ab!` : '';
              const logText = `${species.name} greift mit „${dinoMove}“ an (${fmtNum(Math.max(0, dmg))} Schaden).${shieldText}`;

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

          return {
            id: `battle_${arriveTs}_${Math.floor(Math.random() * 9999)}`,
            timestamp: arriveTs,
            dinoId: march.dinoId,
            speciesId: species.id,
            speciesName: species.name,
            speciesAccent: species.accent,
            weaknessTip: species.weaknessTip || '',
            dinoLevel: march.dinoLevel,
            dinoPower,
            squadPower: march.squadPower,
            counterMatched,
            victory,
            heroes: heroEntries,
            troopsSent,
            troopsLost,
            totalSent,
            lostTotal,
            squadHpMax,
            dinoHpMax,
            rounds,
            resources,
            items,
            xp,
            newlyDiscovered,
            read: false
          };
        }

        function resolveDinoHuntCombat(march, arriveTs) {
          const def = getWorldDinoDef(march.dinoId);
          const dState = getWorldDinoState(march.dinoId);
          const species = getDinoSpecies(march.speciesId);
          if (!def || !dState || !species) {
            return { victory: false, resources: {}, items: {}, xp: 0, lostTotal: 0, newlyDiscovered: false, battleId: null };
          }

          const srv = march.serverCombat;
          const dinoPower = srv ? srv.dinoPower : getDinoCombatPower(species, march.dinoLevel);
          const ratio = march.squadPower / Math.max(1, dinoPower);
          const winChance = ratio >= 1.0 ? 1.0 : ratio >= 0.72 ? (ratio - 0.65) / 0.35 : 0.08;
          const victory = srv ? srv.victory : Math.random() <= winChance;

          const newlyDiscovered = victory
            ? recordBestiaryHunt(species.id, march.dinoLevel)
            : recordBestiaryDiscovery(species.id);

          const resources = {};
          const items = {};
          let xp = 0;
          let lostTotal = 0;
          const troopsSent = {
            slinger: (march.troops && march.troops.slinger) || 0,
            clubman: (march.troops && march.troops.clubman) || 0,
            dinorider: (march.troops && march.troops.dinorider) || 0
          };
          const troopsLost = { slinger: 0, clubman: 0, dinorider: 0 };
          let injuredTotal = 0;
          let fallenTotal = 0;

          if (!state.injuredTroops) state.injuredTroops = { slinger: 0, clubman: 0, dinorider: 0 };
          if (!state.fallenTroops) state.fallenTroops = { slinger: 0, clubman: 0, dinorider: 0 };

          const routeCasualties = (key, lost) => {
            if (lost <= 0) return;
            const freeBeds = getInfirmaryFreeBeds();
            const toInfirmary = Math.min(lost, freeBeds);
            const toGraveyard = lost - toInfirmary;
            if (toInfirmary > 0) {
              state.injuredTroops[key] = (state.injuredTroops[key] || 0) + toInfirmary;
              injuredTotal += toInfirmary;
            }
            if (toGraveyard > 0) {
              state.fallenTroops[key] = (state.fallenTroops[key] || 0) + toGraveyard;
              fallenTotal += toGraveyard;
            }
          };

          if (srv && srv.troopsLost) {
            for (const key of Object.keys(TROOP_DEFS)) {
              const sent = (march.troops && march.troops[key]) || 0;
              const lost = Math.min(sent, Math.max(0, Math.floor(srv.troopsLost[key] || 0)));
              if (lost > 0) {
                march.troops[key] = sent - lost;
                state.troops[key] = Math.max(0, (state.troops[key] || 0) - lost);
                troopsLost[key] = lost;
                lostTotal += lost;
                routeCasualties(key, lost);
              }
            }
          } else {
            // Lokaler Fallback falls Server offline
            const lossRate = victory ? (ratio >= 1.35 ? 0 : Math.min(0.22, (1.35 - ratio) * 0.32)) : 0.25;
            if (lossRate > 0 && march.troops) {
              for (const key of Object.keys(TROOP_DEFS)) {
                const sent = march.troops[key] || 0;
                if (sent <= 0) continue;
                const lost = Math.min(sent, Math.floor(sent * lossRate));
                if (lost > 0) {
                  march.troops[key] = sent - lost;
                  state.troops[key] = Math.max(0, (state.troops[key] || 0) - lost);
                  troopsLost[key] = lost;
                  lostTotal += lost;
                  routeCasualties(key, lost);
                }
              }
            }
          }

          if (victory) {
            if (srv && srv.resources && srv.items) {
              Object.assign(resources, srv.resources);
              Object.assign(items, srv.items);
              xp = srv.xp || march.dinoLevel * 35;
            } else {
              const lvlScale = 1 + (march.dinoLevel - species.levelRange[0]) * 0.14;
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
              xp = march.dinoLevel * 35;
            }
            // Erlegter Dino verschwindet sofort und spawnt an einer neuen freien Position auf der 1200×1200-Karte
            relocateWorldDino(march.dinoId, true);
          }

          const battleLog = buildDinoBattleLog({
            march,
            arriveTs,
            species,
            dinoPower,
            ratio,
            victory,
            troopsSent,
            troopsLost,
            lostTotal,
            resources,
            items,
            xp,
            newlyDiscovered
          });
          if (srv && Array.isArray(srv.rounds) && srv.rounds.length > 0) {
            battleLog.rounds = srv.rounds;
            battleLog.squadHpMax = srv.squadHpMax || battleLog.squadHpMax;
            battleLog.dinoHpMax = srv.dinoHpMax || battleLog.dinoHpMax;
            battleLog.serverAuthoritative = true;
          }
          if (!Array.isArray(state.huntLogs)) state.huntLogs = [];
          state.huntLogs.unshift(battleLog);
          if (state.huntLogs.length > 20) state.huntLogs.length = 20;

          return { victory, resources, items, xp, lostTotal, injuredTotal, fallenTotal, newlyDiscovered, battleId: battleLog.id };
        }

        function computeGatherSquadPower(heroIds, troops, fallbackWorkers = 0) {
          let heroBase = 0;
          let pvpBonusPct = 0;
          for (const hId of heroIds || []) {
            const def = HEROES_LIST.find((h) => h.id === hId);
            const hState = state.heroes && state.heroes[hId];
            if (!def || !hState || !hState.unlocked) continue;
            heroBase += getHeroPower(def, hState);
            const pvpSkills = (hState.skills && hState.skills.pvp) || [1, 1, 1];
            for (const lv of pvpSkills) {
              pvpBonusPct += Math.max(0, lv - 1) * 5;
            }
          }
          let troopBase = 0;
          for (const [key, tDef] of Object.entries(TROOP_DEFS)) {
            const count = (troops && troops[key]) || 0;
            troopBase += count * tDef.powerPerUnit;
          }
          const militiaBase = heroBase === 0 && troopBase === 0 ? Math.max(1, fallbackWorkers) * 18 : 0;
          const sovereignCombatMult = isOwnTribeVolcanoRuler() ? 1.15 : 1.0;
          const mult = (1 + pvpBonusPct / 100) * sovereignCombatMult;
          const total = Math.round((heroBase + troopBase + militiaBase) * mult);
          return { total, heroBase, troopBase, pvpBonusPct };
        }

        function computeGatherCarryCapacity(nodeInfo, heroIds, troops) {
          const hCnt = Array.isArray(heroIds) ? heroIds.length : 0;
          const s = (troops && troops.slinger) || 0;
          const c = (troops && troops.clubman) || 0;
          const d = (troops && troops.dinorider) || 0;
          const squadCarry = hCnt * 55 + s * 8 + c * 11 + d * 18;
          if (hCnt === 0 && s + c + d === 0) {
            return nodeInfo ? nodeInfo.capacity : 80;
          }
          return Math.max(nodeInfo ? Math.min(nodeInfo.capacity, 60) : 60, squadCarry);
        }

        function initGatherDraft(nodeId) {
          const busyHeroes = getDeployedHeroIds();
          const unlocked = HEROES_LIST.filter(
            (h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked && !busyHeroes.has(h.id)
          ).sort((a, b) => getHeroPower(b, state.heroes[b.id]) - getHeroPower(a, state.heroes[a.id]));
          const picked = [];
          const usedRoles = new Set();
          for (const h of unlocked) {
            if (picked.length >= 3) break;
            if (!usedRoles.has(h.role)) {
              usedRoles.add(h.role);
              picked.push(h.id);
            }
          }
          for (const h of unlocked) {
            if (picked.length >= 3) break;
            if (!picked.includes(h.id)) picked.push(h.id);
          }
          gatherDraft = {
            nodeId,
            heroIds: picked,
            troops: {
              slinger: getAvailableTroopCount('slinger'),
              clubman: getAvailableTroopCount('clubman'),
              dinorider: getAvailableTroopCount('dinorider')
            }
          };
        }

        function toggleGatherDraftHero(heroId) {
          const def = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!def || !hState || !hState.unlocked) return;
          if (getDeployedHeroIds().has(heroId)) {
            SoundFX.play('error');
            showToast(`${def.name} ist bereits auf einem anderen Marsch im Einsatz.`, 'warn');
            return;
          }
          const idx = gatherDraft.heroIds.indexOf(heroId);
          if (idx >= 0) {
            gatherDraft.heroIds.splice(idx, 1);
            SoundFX.play('tap');
            renderSheet();
            return;
          }
          if (gatherDraft.heroIds.length >= 3) {
            SoundFX.play('error');
            showToast('Maximal 3 Helden pro Sammeltrupp möglich.', 'warn');
            return;
          }
          gatherDraft.heroIds.push(heroId);
          SoundFX.play('tap');
          renderSheet();
        }

        function adjustGatherDraftTroop(troopType, delta) {
          if (!TROOP_DEFS[troopType]) return;
          const avail = getAvailableTroopCount(troopType);
          const cur = gatherDraft.troops[troopType] || 0;
          gatherDraft.troops[troopType] = Math.max(0, Math.min(avail, cur + delta));
          SoundFX.play('tap');
          renderSheet();
        }

        function setGatherDraftTroopMax(troopType) {
          if (!TROOP_DEFS[troopType]) return;
          gatherDraft.troops[troopType] = getAvailableTroopCount(troopType);
          SoundFX.play('tap');
          renderSheet();
        }

        function fillGatherDraftAllTroops() {
          for (const key of Object.keys(TROOP_DEFS)) {
            gatherDraft.troops[key] = getAvailableTroopCount(key);
          }
          SoundFX.play('tap');
          renderSheet();
        }

        function clearGatherDraftTroops() {
          for (const key of Object.keys(TROOP_DEFS)) {
            gatherDraft.troops[key] = 0;
          }
          SoundFX.play('tap');
          renderSheet();
        }

        function applyPvpCasualtiesToMarch(march, lossRate) {
          const result = { lostTotal: 0, injuredTotal: 0, fallenTotal: 0 };
          if (!march || !march.troops || !lossRate || lossRate <= 0) return result;
          if (!state.injuredTroops) state.injuredTroops = { slinger: 0, clubman: 0, dinorider: 0 };
          if (!state.fallenTroops) state.fallenTroops = { slinger: 0, clubman: 0, dinorider: 0 };

          const totalSent = Object.keys(TROOP_DEFS).reduce((sum, k) => sum + (march.troops[k] || 0), 0);
          if (totalSent <= 0) return result;

          for (const key of Object.keys(TROOP_DEFS)) {
            const sent = march.troops[key] || 0;
            if (sent <= 0) continue;
            let lost = Math.min(sent, Math.round(sent * lossRate));
            if (lost === 0 && lossRate >= 0.1 && sent >= 2) lost = 1;
            if (lost <= 0) continue;
            march.troops[key] = Math.max(0, sent - lost);
            state.troops[key] = Math.max(0, (state.troops[key] || 0) - lost);
            result.lostTotal += lost;

            const freeBeds = getInfirmaryFreeBeds();
            const toInfirmary = Math.min(lost, freeBeds);
            const toGraveyard = lost - toInfirmary;
            if (toInfirmary > 0) {
              state.injuredTroops[key] = (state.injuredTroops[key] || 0) + toInfirmary;
              result.injuredTotal += toInfirmary;
            }
            if (toGraveyard > 0) {
              state.fallenTroops[key] = (state.fallenTroops[key] || 0) + toGraveyard;
              result.fallenTotal += toGraveyard;
            }
          }
          return result;
        }

        function formatCasualtyNote(cas) {
          if (!cas || cas.lostTotal <= 0) return '';
          const parts = [];
          if (cas.injuredTotal > 0) parts.push(`${cas.injuredTotal} verletzt`);
          if (cas.fallenTotal > 0) parts.push(`${cas.fallenTotal} gefallen`);
          return parts.length ? ` (${parts.join(', ')})` : ` (${cas.lostTotal} Verluste)`;
        }

        function launchWorldMarch(nodeId) {
          const info = getWorldNodeInfo(nodeId);
          if (!info) return;
          const nState = getWorldNodeState(nodeId);
          if (nState.remaining <= 0) {
            SoundFX.play('error');
            showToast('Diese Sammelstelle ist bereits erschöpft.', 'warn');
            return;
          }
          if (getActiveMarchForNode(nodeId)) {
            SoundFX.play('error');
            showToast('Hier ist bereits ein eigener Sammeltrupp unterwegs.', 'warn');
            return;
          }
          if (state.worldMarches.length >= getMaxWorldMarches()) {
            SoundFX.play('error');
            showToast(`Alle ${getMaxWorldMarches()} Marschwarteschlange(n) belegt. Baue das Signalfeuer aus für mehr Plätze!`, 'warn');
            return;
          }

          // Validierung: bis zu 3 freie Helden + freie Soldaten (oder Dorfbewohner als Fallback)
          const busyHeroes = getDeployedHeroIds();
          const validHeroes = [];
          for (const hId of gatherDraft.heroIds || []) {
            const hDef = HEROES_LIST.find((h) => h.id === hId);
            const hSt = state.heroes && state.heroes[hId];
            if (!hDef || !hSt || !hSt.unlocked || busyHeroes.has(hId)) continue;
            if (validHeroes.includes(hId)) continue;
            if (validHeroes.length >= 3) break;
            validHeroes.push(hId);
          }

          const sendTroops = {
            slinger: Math.min(getAvailableTroopCount('slinger'), Math.max(0, Math.floor(gatherDraft.troops.slinger || 0))),
            clubman: Math.min(getAvailableTroopCount('clubman'), Math.max(0, Math.floor(gatherDraft.troops.clubman || 0))),
            dinorider: Math.min(getAvailableTroopCount('dinorider'), Math.max(0, Math.floor(gatherDraft.troops.dinorider || 0)))
          };
          const totalSoldiers = sendTroops.slinger + sendTroops.clubman + sendTroops.dinorider;
          const usingCombatSquad = validHeroes.length > 0 || totalSoldiers > 0;
          const workersNeeded = usingCombatSquad ? 0 : info.workersNeeded;

          if (!usingCombatSquad && getFreePop() < workersNeeded) {
            SoundFX.play('error');
            showToast(`Wähle Helden/Soldaten oder stelle ${workersNeeded} freie Dorfbewohner bereit.`, 'err');
            return;
          }

          const enemyOcc = getEnemyNodeOccupant(nodeId);
          if (enemyOcc && !usingCombatSquad) {
            SoundFX.play('error');
            showToast(`„${info.name}“ ist von ${enemyOcc.tribeName} besetzt! Wähle Helden oder Soldaten zum Angreifen.`, 'err');
            return;
          }

          const now = Date.now();
          const nodePos = getNodePos(nodeId) || info;
          const travelSec = getWorldMarchTravelSec(nodePos);
          const carryCap = computeGatherCarryCapacity(info, validHeroes, sendTroops);
          const targetAmount = Math.min(nState.remaining, carryCap);
          const gatherSec = getWorldGatherDurationSec(info, targetAmount, validHeroes, sendTroops);
          const powerInfo = computeGatherSquadPower(validHeroes, sendTroops, workersNeeded);

          const gatherId = `wm_${now}_${Math.floor(Math.random() * 999)}`;
          state.worldMarches.push({
            id: gatherId,
            kind: 'gather',
            nodeId: info.id,
            targetName: info.name,
            targetResource: info.resource,
            targetLevel: info.level,
            targetX: nodePos.xPct,
            targetY: nodePos.yPct,
            workers: workersNeeded,
            heroes: validHeroes,
            troops: sendTroops,
            squadPower: powerInfo.total,
            phase: 'marching_out',
            startedAt: now,
            phaseEndsAt: now + travelSec * 1000,
            travelSec,
            gatherSec,
            targetAmount,
            carriedAmount: 0,
            arrivalPending: false
          });

          if (window.DinoMultiplayer) {
            const home = getHomePos();
            window.DinoMultiplayer.broadcastMarch({
              marchId: gatherId,
              kind: 'gather',
              fromX: home.xPct,
              fromY: home.yPct,
              toX: nodePos.xPct,
              toY: nodePos.yPct,
              targetLabel: enemyOcc ? `⚔ Angriff: ${info.name}` : info.name,
              durationMs: (travelSec * 2 + gatherSec) * 1000
            });
          }

          SoundFX.play('horn');
          if (enemyOcc) {
            showToast(
              `⚔ Kampftrupp (${validHeroes.length} Helden · ${totalSoldiers} Soldaten · ${fmtNum(powerInfo.total)} KK) greift ${enemyOcc.tribeName} bei „${info.name}“ an!`,
              'warn'
            );
          } else if (usingCombatSquad) {
            showToast(
              `Sammeltrupp (${validHeroes.length} Helden · ${totalSoldiers} Soldaten) marschiert zu „${info.name}“!`,
              'ok'
            );
          } else {
            showToast(`${workersNeeded} Sammler marschieren zu „${info.name}“!`, 'ok');
          }
          saveState();
          renderAll();
        }

        async function resolveGatherNodeArrival(march) {
          if (!march || march.arrivalPending) return;
          march.arrivalPending = true;
          march.phase = 'occupying';
          const nodeName = march.targetName || (getWorldNodeInfo(march.nodeId)?.name || 'Sammelstelle');

          try {
            if (window.DinoMultiplayer && typeof window.DinoMultiplayer.occupyResourceNode === 'function') {
              const resp = await window.DinoMultiplayer.occupyResourceNode({
                nodeId: march.nodeId,
                marchId: march.id,
                targetAmount: march.targetAmount,
                gatherSec: march.gatherSec,
                squadPower: march.squadPower || 50,
                heroIds: march.heroes || [],
                troops: march.troops || { slinger: 0, clubman: 0, dinorider: 0 }
              });

              const now = Date.now();
              if (resp && resp.contest) {
                const cas = applyPvpCasualtiesToMarch(march, resp.contest.attackerLossRate || 0);
                const casNote = formatCasualtyNote(cas);
                if (resp.contest.attackerWon) {
                  const nState = getWorldNodeState(march.nodeId);
                  if (nState && resp.contest.defenderCollectedBeforeEviction > 0) {
                    nState.remaining = Math.max(1, nState.remaining - resp.contest.defenderCollectedBeforeEviction);
                    march.targetAmount = Math.min(march.targetAmount, nState.remaining);
                  }
                  march.phase = 'gathering';
                  march.startedAt = now;
                  march.phaseEndsAt = now + march.gatherSec * 1000;
                  SoundFX.play('upgrade');
                  showToast(
                    `⚔ Sieg bei „${nodeName}“! ${resp.contest.defenderTribeName} vertrieben — dein Trupp sammelt jetzt!${casNote}`,
                    'ok'
                  );
                } else {
                  march.carriedAmount = 0;
                  march.phase = 'marching_back';
                  march.startedAt = now;
                  march.phaseEndsAt = now + march.travelSec * 1000;
                  SoundFX.play('error');
                  showToast(
                    `⚔ Angriff auf „${nodeName}“ abgewehrt! ${resp.contest.defenderTribeName} war stärker.${casNote}`,
                    'warn'
                  );
                }
              } else {
                march.phase = 'gathering';
                march.startedAt = now;
                march.phaseEndsAt = now + march.gatherSec * 1000;
              }
            } else {
              const now = Date.now();
              march.phase = 'gathering';
              march.startedAt = now;
              march.phaseEndsAt = now + march.gatherSec * 1000;
            }
          } catch {
            const now = Date.now();
            march.phase = 'gathering';
            march.startedAt = now;
            march.phaseEndsAt = now + march.gatherSec * 1000;
          } finally {
            march.arrivalPending = false;
            saveState();
            renderAll();
          }
        }

        /* =====================================================================
           ZENTRALER VULKAN ("VULKAN-ZITADELLE") — 4-WOCHEN-SERVERKAMPF
           ===================================================================== */
        const VOLCANO_POS = { xPct: 50, yPct: 50, wx: 600, wy: 600, coordX: 600, coordY: 600 };
        const VOLCANO_CYCLE_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000;
        const VOLCANO_BATTLE_DURATION_MS = 6 * 60 * 60 * 1000;

        function getVolcanoState() {
          const now = Date.now();
          const srv = mpWorld.volcano;
          if (srv) {
            let phase = srv.phase;
            let battleEndsAt = Number(srv.battleEndsAt) || now + VOLCANO_BATTLE_DURATION_MS;
            let nextBattleAt = Number(srv.nextBattleStartAt || srv.nextBattleAt) || now + VOLCANO_CYCLE_INTERVAL_MS;
            if (phase === 'battle' && now >= battleEndsAt) {
              phase = 'peace';
            } else if (phase === 'peace' && now >= nextBattleAt) {
              phase = 'battle';
              battleEndsAt = nextBattleAt + VOLCANO_BATTLE_DURATION_MS;
            }
            return { ...srv, phase, battleEndsAt, nextBattleAt, nextBattleStartAt: nextBattleAt };
          }
          return {
            cycleNumber: 1,
            cycleIntervalMs: VOLCANO_CYCLE_INTERVAL_MS,
            battleDurationMs: VOLCANO_BATTLE_DURATION_MS,
            phase: 'battle',
            cycleStartedAt: now,
            battleEndsAt: now + VOLCANO_BATTLE_DURATION_MS,
            nextBattleAt: now + VOLCANO_CYCLE_INTERVAL_MS,
            nextBattleStartAt: now + VOLCANO_CYCLE_INTERVAL_MS,
            holderUid: null,
            holderTribeName: null,
            garrisonPower: 380,
            garrisonHeroNames: ['Vulkan-Wächter'],
            garrisonTroops: { slinger: 0, clubman: 0, dinorider: 0 },
            holderSince: null,
            recentBattles: [],
            updatedAt: now
          };
        }

        function isOwnTribeVolcanoRuler() {
          const v = mpWorld.volcano;
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;
          return Boolean(v && ownUid && v.holderUid && v.holderUid === ownUid);
        }

        function getVolcanoHolderStatus(v) {
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;
          if (!v || !v.holderUid) return 'neutral';
          if (ownUid && v.holderUid === ownUid) return 'own';
          return 'enemy';
        }

        function fmtVolcanoCountdown(ms) {
          const totalSec = Math.max(0, Math.floor(ms / 1000));
          const days = Math.floor(totalSec / 86400);
          const hours = Math.floor((totalSec % 86400) / 3600);
          const mins = Math.floor((totalSec % 3600) / 60);
          const secs = totalSec % 60;
          if (days > 0) {
            return `${days}T ${String(hours).padStart(2, '0')}Std ${String(mins).padStart(2, '0')}Min`;
          }
          return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        function getActiveMarchForVolcano() {
          return (state.worldMarches || []).find((m) => m.kind === 'volcano') || null;
        }

        function ensureVolcanoMobilizationState() {
          if (!state.volcanoMobilization || typeof state.volcanoMobilization !== 'object') {
            state.volcanoMobilization = {
              configured: false,
              heroIds: [],
              troops: { slinger: 0, clubman: 0, dinorider: 0 }
            };
          }
          if (!Array.isArray(state.volcanoMobilization.heroIds)) {
            state.volcanoMobilization.heroIds = [];
          }
          if (!state.volcanoMobilization.troops || typeof state.volcanoMobilization.troops !== 'object') {
            state.volcanoMobilization.troops = { slinger: 0, clubman: 0, dinorider: 0 };
          }
          for (const key of Object.keys(TROOP_DEFS)) {
            state.volcanoMobilization.troops[key] = Math.max(0, Math.floor(Number(state.volcanoMobilization.troops[key] || 0)));
          }
          return state.volcanoMobilization;
        }

        function syncVolcanoDraftToState() {
          const mob = ensureVolcanoMobilizationState();
          mob.configured = true;
          mob.heroIds = Array.isArray(volcanoDraft.heroIds) ? volcanoDraft.heroIds.slice(0, 3) : [];
          mob.troops = {
            slinger: Math.max(0, Math.floor(Number(volcanoDraft.troops?.slinger || 0))),
            clubman: Math.max(0, Math.floor(Number(volcanoDraft.troops?.clubman || 0))),
            dinorider: Math.max(0, Math.floor(Number(volcanoDraft.troops?.dinorider || 0)))
          };
          saveState();
          if (typeof emitSnapshot === 'function') emitSnapshot();
        }

        function getAutoPickedVolcanoHeroes() {
          const busyHeroes = getDeployedHeroIds();
          const unlocked = HEROES_LIST.filter(
            (h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked && !busyHeroes.has(h.id)
          ).sort((a, b) => getHeroPower(b, state.heroes[b.id]) - getHeroPower(a, state.heroes[a.id]));
          const picked = [];
          const usedRoles = new Set();
          for (const h of unlocked) {
            if (picked.length >= 3) break;
            if (!usedRoles.has(h.role)) {
              usedRoles.add(h.role);
              picked.push(h.id);
            }
          }
          for (const h of unlocked) {
            if (picked.length >= 3) break;
            if (!picked.includes(h.id)) picked.push(h.id);
          }
          return picked;
        }

        function getVolcanoMobilizationSnapshot() {
          const totalTroops = {
            slinger: Math.max(0, Math.floor(Number(state?.troops?.slinger || 0))),
            clubman: Math.max(0, Math.floor(Number(state?.troops?.clubman || 0))),
            dinorider: Math.max(0, Math.floor(Number(state?.troops?.dinorider || 0)))
          };
          const availableTroops = {
            slinger: getAvailableTroopCount('slinger'),
            clubman: getAvailableTroopCount('clubman'),
            dinorider: getAvailableTroopCount('dinorider')
          };
          const availableTotal = availableTroops.slinger + availableTroops.clubman + availableTroops.dinorider;

          const activeMarch = getActiveMarchForVolcano();
          if (activeMarch) {
            const mTroops = {
              slinger: Math.max(0, Math.floor(Number(activeMarch.troops?.slinger || 0))),
              clubman: Math.max(0, Math.floor(Number(activeMarch.troops?.clubman || 0))),
              dinorider: Math.max(0, Math.floor(Number(activeMarch.troops?.dinorider || 0)))
            };
            const mTotal = mTroops.slinger + mTroops.clubman + mTroops.dinorider;
            const mHeroNames = Array.isArray(activeMarch.heroNames) && activeMarch.heroNames.length
              ? activeMarch.heroNames.slice(0, 3)
              : (activeMarch.heroes || [])
                  .map((hId) => HEROES_LIST.find((h) => h.id === hId)?.name || hId)
                  .slice(0, 3);
            return {
              status: 'marching',
              marchPhase: activeMarch.phase || 'marching_out',
              assignedTroops: mTroops,
              availableTroops,
              totalTroops,
              assignedTotal: mTotal,
              availableTotal: availableTotal + mTotal,
              assignedHeroes: mHeroNames.length,
              assignedHeroNames: mHeroNames,
              maxHeroes: 3,
              squadPower: Math.max(0, Math.round(Number(activeMarch.squadPower || 0)))
            };
          }

          const mob = ensureVolcanoMobilizationState();
          const busyHeroes = getDeployedHeroIds();
          const validHeroes = (mob.heroIds || [])
            .filter((hId) => !busyHeroes.has(hId) && state.heroes && state.heroes[hId] && state.heroes[hId].unlocked)
            .slice(0, 3);
          const assignedTroops = {
            slinger: Math.min(availableTroops.slinger, Math.max(0, mob.troops.slinger || 0)),
            clubman: Math.min(availableTroops.clubman, Math.max(0, mob.troops.clubman || 0)),
            dinorider: Math.min(availableTroops.dinorider, Math.max(0, mob.troops.dinorider || 0))
          };
          const assignedTotal = assignedTroops.slinger + assignedTroops.clubman + assignedTroops.dinorider;
          const assignedHeroNames = validHeroes
            .map((hId) => HEROES_LIST.find((h) => h.id === hId)?.name || hId)
            .slice(0, 3);
          const squadPower =
            validHeroes.length > 0 || assignedTotal > 0
              ? computeGatherSquadPower(validHeroes, assignedTroops, 0).total
              : 0;

          return {
            status: assignedTotal > 0 || validHeroes.length > 0 ? 'ready' : 'idle',
            marchPhase: null,
            assignedTroops,
            availableTroops,
            totalTroops,
            assignedTotal,
            availableTotal,
            assignedHeroes: validHeroes.length,
            assignedHeroNames,
            maxHeroes: 3,
            squadPower
          };
        }

        function initVolcanoDraft() {
          const mob = ensureVolcanoMobilizationState();
          const busyHeroes = getDeployedHeroIds();
          if (mob.configured) {
            const validHeroes = (mob.heroIds || [])
              .filter((hId) => !busyHeroes.has(hId) && state.heroes && state.heroes[hId] && state.heroes[hId].unlocked)
              .slice(0, 3);
            volcanoDraft = {
              heroIds: validHeroes,
              troops: {
                slinger: Math.min(getAvailableTroopCount('slinger'), mob.troops.slinger || 0),
                clubman: Math.min(getAvailableTroopCount('clubman'), mob.troops.clubman || 0),
                dinorider: Math.min(getAvailableTroopCount('dinorider'), mob.troops.dinorider || 0)
              }
            };
            return;
          }
          const picked = getAutoPickedVolcanoHeroes();
          volcanoDraft = {
            heroIds: picked,
            troops: {
              slinger: getAvailableTroopCount('slinger'),
              clubman: getAvailableTroopCount('clubman'),
              dinorider: getAvailableTroopCount('dinorider')
            }
          };
          syncVolcanoDraftToState();
        }

        function toggleVolcanoDraftHero(heroId) {
          const def = HEROES_LIST.find((h) => h.id === heroId);
          const hState = state.heroes && state.heroes[heroId];
          if (!def || !hState || !hState.unlocked) return;
          if (getDeployedHeroIds().has(heroId)) {
            SoundFX.play('error');
            showToast(`${def.name} ist bereits auf einem anderen Marsch im Einsatz.`, 'warn');
            return;
          }
          const idx = volcanoDraft.heroIds.indexOf(heroId);
          if (idx >= 0) {
            volcanoDraft.heroIds.splice(idx, 1);
            syncVolcanoDraftToState();
            SoundFX.play('tap');
            renderSheet();
            return;
          }
          if (volcanoDraft.heroIds.length >= 3) {
            SoundFX.play('error');
            showToast('Maximal 3 Helden für den Vulkan-Sturmangriff möglich.', 'warn');
            return;
          }
          volcanoDraft.heroIds.push(heroId);
          syncVolcanoDraftToState();
          SoundFX.play('tap');
          renderSheet();
        }

        function hydrateVolcanoDraftFromState() {
          const mob = ensureVolcanoMobilizationState();
          if (mob.configured) {
            const busyHeroes = getDeployedHeroIds();
            volcanoDraft.heroIds = (mob.heroIds || [])
              .filter((hId) => !busyHeroes.has(hId) && state.heroes && state.heroes[hId] && state.heroes[hId].unlocked)
              .slice(0, 3);
            volcanoDraft.troops = {
              slinger: Math.min(getAvailableTroopCount('slinger'), mob.troops.slinger || 0),
              clubman: Math.min(getAvailableTroopCount('clubman'), mob.troops.clubman || 0),
              dinorider: Math.min(getAvailableTroopCount('dinorider'), mob.troops.dinorider || 0)
            };
          } else if (!volcanoDraft.heroIds || volcanoDraft.heroIds.length === 0) {
            volcanoDraft.heroIds = getAutoPickedVolcanoHeroes();
          }
        }

        function adjustVolcanoDraftTroop(troopType, delta) {
          if (!TROOP_DEFS[troopType]) return;
          hydrateVolcanoDraftFromState();
          const avail = getAvailableTroopCount(troopType);
          const cur = volcanoDraft.troops[troopType] || 0;
          volcanoDraft.troops[troopType] = Math.max(0, Math.min(avail, cur + delta));
          syncVolcanoDraftToState();
          SoundFX.play('tap');
          if (openSheet && openSheet.type === 'volcano') renderSheet();
        }

        function setVolcanoDraftTroopMax(troopType) {
          if (!TROOP_DEFS[troopType]) return;
          hydrateVolcanoDraftFromState();
          volcanoDraft.troops[troopType] = getAvailableTroopCount(troopType);
          syncVolcanoDraftToState();
          SoundFX.play('tap');
          if (openSheet && openSheet.type === 'volcano') renderSheet();
        }

        function fillVolcanoDraftAllTroops() {
          hydrateVolcanoDraftFromState();
          if (!volcanoDraft.heroIds || volcanoDraft.heroIds.length === 0) {
            volcanoDraft.heroIds = getAutoPickedVolcanoHeroes();
          }
          for (const key of Object.keys(TROOP_DEFS)) {
            volcanoDraft.troops[key] = getAvailableTroopCount(key);
          }
          syncVolcanoDraftToState();
          SoundFX.play('tap');
          if (openSheet && openSheet.type === 'volcano') renderSheet();
        }

        function clearVolcanoDraftTroops() {
          hydrateVolcanoDraftFromState();
          for (const key of Object.keys(TROOP_DEFS)) {
            volcanoDraft.troops[key] = 0;
          }
          syncVolcanoDraftToState();
          SoundFX.play('tap');
          if (openSheet && openSheet.type === 'volcano') renderSheet();
        }

        function launchVolcanoMarch() {
          const v = getVolcanoState();
          if (v.phase !== 'battle') {
            SoundFX.play('error');
            showToast(`Der Kaldera-Schild ist aktiv! Nächster Server-Kampf in ${fmtVolcanoCountdown(v.nextBattleAt - Date.now())}.`, 'warn');
            return;
          }
          if (getActiveMarchForVolcano()) {
            SoundFX.play('error');
            showToast('Es ist bereits ein eigener Sturmtrupp auf dem Weg zur Vulkan-Zitadelle.', 'warn');
            return;
          }
          if (state.worldMarches.length >= getMaxWorldMarches()) {
            SoundFX.play('error');
            showToast(`Alle ${getMaxWorldMarches()} Marschwarteschlange(n) belegt.`, 'warn');
            return;
          }

          const busyHeroes = getDeployedHeroIds();
          const validHeroes = [];
          for (const hId of volcanoDraft.heroIds || []) {
            const hDef = HEROES_LIST.find((h) => h.id === hId);
            const hSt = state.heroes && state.heroes[hId];
            if (!hDef || !hSt || !hSt.unlocked || busyHeroes.has(hId)) continue;
            if (validHeroes.includes(hId)) continue;
            if (validHeroes.length >= 3) break;
            validHeroes.push(hId);
          }
          const sendTroops = {
            slinger: Math.min(getAvailableTroopCount('slinger'), Math.max(0, Math.floor(volcanoDraft.troops.slinger || 0))),
            clubman: Math.min(getAvailableTroopCount('clubman'), Math.max(0, Math.floor(volcanoDraft.troops.clubman || 0))),
            dinorider: Math.min(getAvailableTroopCount('dinorider'), Math.max(0, Math.floor(volcanoDraft.troops.dinorider || 0)))
          };
          const totalSoldiers = sendTroops.slinger + sendTroops.clubman + sendTroops.dinorider;
          if (validHeroes.length === 0 && totalSoldiers === 0) {
            SoundFX.play('error');
            showToast('Wähle mindestens einen Helden oder Soldaten für den Marsch zur Vulkan-Zitadelle!', 'err');
            return;
          }

          const now = Date.now();
          const travelSec = Math.max(8, Math.min(28, getWorldMarchTravelSec(VOLCANO_POS)));
          const powerInfo = computeGatherSquadPower(validHeroes, sendTroops, 0);
          const heroNames = validHeroes
            .map((hId) => HEROES_LIST.find((h) => h.id === hId)?.name || hId)
            .slice(0, 3);
          const isReinforce = getVolcanoHolderStatus(v) === 'own';

          const marchId = `vm_${now}_${Math.floor(Math.random() * 999)}`;
          state.worldMarches.push({
            id: marchId,
            kind: 'volcano',
            targetName: 'Vulkan-Zitadelle',
            targetX: VOLCANO_POS.xPct,
            targetY: VOLCANO_POS.yPct,
            heroes: validHeroes,
            heroNames,
            troops: sendTroops,
            squadPower: powerInfo.total,
            isReinforce,
            phase: 'marching_out',
            startedAt: now,
            phaseEndsAt: now + travelSec * 1000,
            travelSec,
            arrivalPending: false
          });

          if (window.DinoMultiplayer) {
            const home = getHomePos();
            window.DinoMultiplayer.broadcastMarch({
              marchId,
              kind: 'volcano',
              fromX: home.xPct,
              fromY: home.yPct,
              toX: VOLCANO_POS.xPct,
              toY: VOLCANO_POS.yPct,
              targetLabel: isReinforce ? '🛡 Vulkan-Garnison verstärken' : '🌋 Sturm auf Vulkan-Zitadelle',
              durationMs: travelSec * 2 * 1000
            });
          }

          SoundFX.play('horn');
          showToast(
            isReinforce
              ? `🛡 Verstärkung (${validHeroes.length} Helden · ${totalSoldiers} Soldaten · ${fmtNum(powerInfo.total)} KK) marschiert zur Vulkan-Zitadelle!`
              : `🌋 Sturmtrupp (${validHeroes.length} Helden · ${totalSoldiers} Soldaten · ${fmtNum(powerInfo.total)} KK) greift die Vulkan-Zitadelle an!`,
            'warn'
          );
          saveState();
          renderAll();
          if (openSheet && openSheet.type === 'volcano') renderVolcanoSheet();
        }

        async function resolveVolcanoArrival(march) {
          if (!march || march.arrivalPending) return;
          march.arrivalPending = true;
          march.phase = 'attacking';

          try {
            if (window.DinoMultiplayer && typeof window.DinoMultiplayer.attackVolcano === 'function') {
              const resp = await window.DinoMultiplayer.attackVolcano({
                squadPower: march.squadPower || 50,
                heroIds: march.heroes || [],
                heroNames: march.heroNames || [],
                troops: march.troops || { slinger: 0, clubman: 0, dinorider: 0 }
              });
              const now = Date.now();
              if (resp && resp.volcano) {
                mpWorld.volcano = resp.volcano;
              }
              if (resp && resp.ok) {
                const cas = applyPvpCasualtiesToMarch(march, resp.attackerLossRate || 0);
                const casNote = formatCasualtyNote(cas);
                if (resp.reinforced) {
                  SoundFX.play('complete');
                  showToast(`🛡 Vulkan-Garnison verstärkt! Neue Verteidigung: KK ${fmtNum(resp.defenderPower || 0)}.`, 'ok');
                } else if (resp.won) {
                  addInventoryItem('goldenBones', 3);
                  addInventoryItem('heroXp', 450);
                  state.resources.meat += 350;
                  state.resources.wood += 350;
                  state.resources.stone += 350;
                  SoundFX.play('horn');
                  showToast(
                    `👑 SIEG! Dein Stamm hat ${resp.defenderName || 'die Vulkan-Wächter'} bezwungen und beherrscht die Vulkan-Zitadelle! (+3 Goldene Knochen, +450 XP, +350 Rohstoffe)${casNote}`,
                    'ok'
                  );
                } else {
                  SoundFX.play('error');
                  showToast(
                    `⚔ Sturm auf die Vulkan-Zitadelle von ${resp.defenderName || 'den Vulkan-Wächtern'} abgewehrt.${casNote}`,
                    'warn'
                  );
                }
              } else {
                SoundFX.play('error');
                showToast((resp && resp.error) || 'Der Kaldera-Schild blockiert den Angriff.', 'warn');
              }
              march.phase = 'marching_back';
              march.startedAt = now;
              march.phaseEndsAt = now + march.travelSec * 1000;
            } else {
              const now = Date.now();
              march.phase = 'marching_back';
              march.startedAt = now;
              march.phaseEndsAt = now + march.travelSec * 1000;
              showToast('Keine Serververbindung für den Vulkan-Kampf.', 'warn');
            }
          } catch {
            const now = Date.now();
            march.phase = 'marching_back';
            march.startedAt = now;
            march.phaseEndsAt = now + march.travelSec * 1000;
          } finally {
            march.arrivalPending = false;
            saveState();
            renderAll();
            if (openSheet && openSheet.type === 'volcano') renderVolcanoSheet();
          }
        }

        function recallWorldMarch(marchId) {
          const march = state.worldMarches.find((m) => m.id === marchId);
          if (!march || march.phase === 'marching_back') return;
          const now = Date.now();

          if (march.kind === 'volcano') {
            if (march.phase === 'attacking') return;
            const elapsedMs = Math.max(1500, now - march.startedAt);
            const returnMs = Math.min(march.travelSec * 1000, elapsedMs);
            march.phase = 'marching_back';
            march.startedAt = now;
            march.phaseEndsAt = now + returnMs;
            SoundFX.play('tap');
            showToast('Vulkan-Sturmtrupp kehrt zur Siedlung zurück.', 'info');
            saveState();
            renderAll();
            return;
          }

          if (march.kind === 'hunt') {
            const elapsedMs = Math.max(1500, now - march.startedAt);
            const returnMs = Math.min(march.travelSec * 1000, elapsedMs);
            march.phase = 'marching_back';
            march.startedAt = now;
            march.phaseEndsAt = now + returnMs;
            march.outcome = null;
            SoundFX.play('tap');
            showToast('Jagdtrupp kehrt zur Siedlung zurück.', 'info');
            saveState();
            renderAll();
            return;
          }

          const info = getWorldNodeInfo(march.nodeId);
          const nState = getWorldNodeState(march.nodeId);
          const resKey = march.targetResource || (info ? info.resource : 'wood');

          if (march.phase === 'marching_out' || march.phase === 'occupying') {
            const elapsedMs = Math.max(1500, now - march.startedAt);
            const returnMs = Math.min(march.travelSec * 1000, elapsedMs);
            march.phase = 'marching_back';
            march.startedAt = now;
            march.phaseEndsAt = now + returnMs;
            march.carriedAmount = 0;
          } else if (march.phase === 'gathering') {
            const totalMs = Math.max(1000, march.phaseEndsAt - march.startedAt);
            const ratio = Math.min(1, Math.max(0, (now - march.startedAt) / totalMs));
            const collected = Math.min(nState ? nState.remaining : march.targetAmount, Math.floor(march.targetAmount * ratio));
            if (nState) {
              nState.remaining = Math.max(0, nState.remaining - collected);
              if (nState.remaining <= 0) {
                relocateWorldNode(march.nodeId, true);
              }
            }
            march.carriedAmount = collected;
            march.phase = 'marching_back';
            march.startedAt = now;
            march.phaseEndsAt = now + march.travelSec * 1000;
            if (window.DinoMultiplayer && typeof window.DinoMultiplayer.releaseResourceNode === 'function') {
              void window.DinoMultiplayer.releaseResourceNode(march.nodeId, march.id);
            }
          }

          SoundFX.play('tap');
          showToast(
            march.carriedAmount > 0
              ? `Trupp kehrt mit ${march.carriedAmount} ${RESOURCE_LABELS[resKey]} zurück.`
              : 'Sammeltrupp zurückgerufen.',
            'info'
          );
          saveState();
          renderAll();
        }

        function processWorldMapTick(now, silentReport = null) {
          // 1. Falls alte Saves erschöpfte Sammelstellen oder Respawn-Timer haben, sofort an neuen Ort versetzen
          for (const def of WORLD_NODES) {
            const nState = getWorldNodeState(def.id);
            if (nState.remaining <= 0) {
              relocateWorldNode(def.id, false);
            }
          }
          for (const def of WORLD_DINOS) {
            const dState = getWorldDinoState(def.id);
            if (dState.respawnAt > 0 && now >= dState.respawnAt) {
              dState.respawnAt = 0;
            }
          }

          // 2. Laufende Sammel- & Jagdmärsche fortschreiben
          const remainingMarches = [];
          let deliveredAny = false;
          let freshLiveBattleId = null;

          for (const march of state.worldMarches || []) {
            if (march.kind === 'volcano') {
              if (march.phase === 'attacking') {
                remainingMarches.push(march);
                continue;
              }
              let completed = false;
              if (now >= march.phaseEndsAt) {
                if (march.phase === 'marching_out') {
                  if (!silentReport) {
                    void resolveVolcanoArrival(march);
                  } else {
                    march.phase = 'marching_back';
                    march.startedAt = march.phaseEndsAt;
                    march.phaseEndsAt = march.startedAt + march.travelSec * 1000;
                  }
                } else if (march.phase === 'marching_back') {
                  completed = true;
                  if (window.DinoMultiplayer && march.id) {
                    window.DinoMultiplayer.completeMarch(march.id);
                  }
                }
              }
              if (!completed) remainingMarches.push(march);
              continue;
            }

            if (march.kind === 'hunt') {
              const species = getDinoSpecies(march.speciesId);
              let guard = 0;
              let completed = false;
              while (now >= march.phaseEndsAt && guard < 4) {
                guard++;
                if (march.phase === 'marching_out') {
                  const startT = march.phaseEndsAt;
                  march.outcome = resolveDinoHuntCombat(march, startT);
                  march.battleId = march.outcome && march.outcome.battleId ? march.outcome.battleId : null;
                  if (!silentReport && march.battleId) {
                    freshLiveBattleId = march.battleId;
                  }
                  march.phase = 'marching_back';
                  march.startedAt = startT;
                  march.phaseEndsAt = startT + march.travelSec * 1000;
                } else if (march.phase === 'marching_back') {
                  if (march.outcome) {
                    const out = march.outcome;
                    const parts = [];
                    for (const [rk, rv] of Object.entries(out.resources || {})) {
                      state.resources[rk] = (state.resources[rk] || 0) + rv;
                      parts.push(`+${rv} ${RESOURCE_LABELS[rk]}`);
                      if (silentReport) silentReport.gained[rk] = (silentReport.gained[rk] || 0) + rv;
                    }
                    for (const [ik, iv] of Object.entries(out.items || {})) {
                      addInventoryItem(ik, iv);
                      const itDef = INVENTORY_ITEMS.find((x) => x.id === ik);
                      parts.push(`+${iv} ${itDef ? itDef.name : ik}`);
                    }
                    if (out.xp > 0) {
                      addInventoryItem('heroXp', out.xp);
                    }
                    if (silentReport) {
                      silentReport.worldDeliveries = (silentReport.worldDeliveries || 0) + 1;
                    } else {
                      deliveredAny = true;
                      const spName = species ? species.name : 'Saurier';
                      if (out.victory) {
                        const bestNote = out.newlyDiscovered ? ' · Neu im Bestiarium!' : '';
                        const casParts = [];
                        if (out.injuredTotal > 0) casParts.push(`${out.injuredTotal} verletzt`);
                        if (out.fallenTotal > 0) casParts.push(`${out.fallenTotal} gefallen`);
                        const lossNote = casParts.length ? ` (${casParts.join(', ')})` : out.lostTotal > 0 ? ` (${out.lostTotal} Verluste)` : '';
                        showToast(`Sieg über ${spName} St. ${march.dinoLevel}! Beute: ${parts.join(', ')}${lossNote}${bestNote}`, 'ok');
                      } else {
                        const bestNote = out.newlyDiscovered ? ' · Eintrag im Dino-Bestiarium freigeschaltet!' : '';
                        const casParts = [];
                        if (out.injuredTotal > 0) casParts.push(`${out.injuredTotal} verletzt`);
                        if (out.fallenTotal > 0) casParts.push(`${out.fallenTotal} gefallen`);
                        const lossText = casParts.length ? casParts.join(', ') : `${out.lostTotal} Verluste`;
                        showToast(`Jagd gegen ${spName} St. ${march.dinoLevel} fehlgeschlagen (${lossText}).${bestNote}`, 'warn');
                      }
                    }
                  }
                  completed = true;
                  if (window.DinoMultiplayer && march.id) {
                    window.DinoMultiplayer.completeMarch(march.id);
                  }
                  break;
                }
              }
              if (!completed) remainingMarches.push(march);
              continue;
            }

            // Standard- & Kampf-Sammelmarsch
            const def = getWorldNodeDef(march.nodeId);
            if (!def) continue;
            const nState = getWorldNodeState(def.id);
            const resKey = march.targetResource || nState.resource || def.resource;
            const nodeLabel = march.targetName || nState.name || def.name;
            const nodeLvl = march.targetLevel || nState.level || def.level;

            if (march.phase === 'occupying') {
              remainingMarches.push(march);
              continue;
            }

            let guard = 0;
            let completed = false;
            while (now >= march.phaseEndsAt && guard < 4) {
              guard++;
              if (march.phase === 'marching_out') {
                if (!silentReport && window.DinoMultiplayer && typeof window.DinoMultiplayer.occupyResourceNode === 'function') {
                  void resolveGatherNodeArrival(march);
                  break;
                }
                const startT = march.phaseEndsAt;
                march.phase = 'gathering';
                march.startedAt = startT;
                march.phaseEndsAt = startT + march.gatherSec * 1000;
              } else if (march.phase === 'gathering') {
                const startT = march.phaseEndsAt;
                const collected = Math.min(nState.remaining, march.targetAmount);
                nState.remaining = Math.max(0, nState.remaining - collected);
                if (window.DinoMultiplayer && typeof window.DinoMultiplayer.releaseResourceNode === 'function') {
                  void window.DinoMultiplayer.releaseResourceNode(march.nodeId, march.id);
                }
                if (nState.remaining <= 0) {
                  // Abgebaute Sammelstelle verschwindet sofort und spawnt an neuem zufälligen Ort
                  relocateWorldNode(def.id, !silentReport);
                }
                march.carriedAmount = collected;
                march.phase = 'marching_back';
                march.startedAt = startT;
                march.phaseEndsAt = startT + march.travelSec * 1000;
              } else if (march.phase === 'marching_back') {
                const amt = march.carriedAmount || 0;
                if (amt > 0) {
                  state.resources[resKey] = (state.resources[resKey] || 0) + amt;
                  let bonusBoneText = '';
                  if (Math.random() < 0.45) {
                    addInventoryItem('bones', 1);
                    bonusBoneText = ' (+1 Knochen!)';
                  }
                  if (nodeLvl >= 5 && Math.random() < 0.18) {
                    addInventoryItem('goldenBones', 1);
                    bonusBoneText += ' (+1 Goldener Knochen!)';
                  }
                  addInventoryItem('heroXp', nodeLvl * 15);
                  if (silentReport) {
                    silentReport.gained[resKey] = (silentReport.gained[resKey] || 0) + amt;
                    silentReport.worldDeliveries = (silentReport.worldDeliveries || 0) + 1;
                  } else {
                    deliveredAny = true;
                    showToast(`Weltkarte: +${amt} ${RESOURCE_LABELS[resKey]} aus „${nodeLabel}“ geliefert!${bonusBoneText}`, 'ok');
                  }
                }
                completed = true;
                if (window.DinoMultiplayer && march.id) {
                  window.DinoMultiplayer.completeMarch(march.id);
                }
                break;
              }
            }

            if (!completed) remainingMarches.push(march);
          }

          state.worldMarches = remainingMarches;
          if (deliveredAny) {
            SoundFX.play('complete');
          }
          if (freshLiveBattleId && !silentReport) {
            const bLog = getBattleLogById(freshLiveBattleId);
            if (bLog) handleLiveDinoBattleTriggered(bLog);
          }
        }

        function runOfflineSimulation(savedState) {
          const now = Date.now();
          const elapsedSec = Math.min(604800, Math.max(0, Math.floor((now - savedState.lastTick) / 1000)));
          state = savedState;
          SoundFX.enabled = state.soundEnabled !== false;
          if (elapsedSec < 5) {
            state.lastTick = now;
            return null;
          }

          const report = {
            elapsedSec,
            gained: { meat: 0, wood: 0, stone: 0, fur: 0 },
            completedBuilds: [],
            completedResearch: [],
            finishedExpeditions: 0,
            worldDeliveries: 0,
            newVillagers: 0
          };

          // 1. Bau, Forschung, Training & Expeditionen nach echtem Zeitstempel abschließen
          if (state.activeBuild && now >= state.activeBuild.endsAt) {
            const res = finishActiveBuild();
            if (res) report.completedBuilds.push(`${res.name} (St. ${res.level})`);
          }
          if (state.activeResearch && now >= state.activeResearch.endsAt) {
            const name = finishActiveResearch();
            if (name) report.completedResearch.push(name);
          }
          if (state.activeTraining && now >= state.activeTraining.endsAt) {
            finishActiveTraining();
          }
          if (state.activeHealing && now >= state.activeHealing.endsAt) {
            finishActiveHealing();
          }
          tickStaminaRegen(now);
          for (const exp of state.activeExpeditions) {
            if (!exp.completed && now >= exp.endsAt) {
              rollExpeditionOutcome(exp);
              report.finishedExpeditions++;
            }
          }
          if (state.pop.injured > 0 && now >= state.pop.injuryHealsAt) {
            state.pop.injured = 0;
            state.pop.injuryHealsAt = 0;
          }

          // 2. Ressourcen-Fortschritt über verstrichene Minuten (mit Offline-Schutz vor Totalverlust)
          const mins = elapsedSec / 60;
          const rates = computeEconomyRates();
          const before = { ...state.resources };

          state.resources.meat = Math.max(0, state.resources.meat + rates.meatNet * mins);
          state.resources.wood = Math.max(0, state.resources.wood + rates.woodNet * mins);
          state.resources.stone = Math.max(0, state.resources.stone + rates.stoneNet * mins);
          state.resources.fur = Math.max(0, state.resources.fur + rates.furNet * mins);

          for (const k of ['meat', 'wood', 'stone', 'fur']) {
            report.gained[k] = Math.round(state.resources[k] - before[k]);
          }

          // 2b. Weltkarten-Sammeltrupps offline abschließen & liefern
          processWorldMapTick(now, report);

          // Nachtwache schützt Offline-Glut bei mindestens 28%; gewählter fireMode bleibt dauerhaft erhalten!
          state.ember = Math.max(28, Math.min(100, state.ember + rates.emberDeltaPerMin * Math.min(mins, 12)));

          // Bevölkerungswachstum offline
          const popMax = getPopMax();
          if (state.pop.total < popMax && state.resources.meat > 10) {
            const possibleNew = Math.floor(elapsedSec / 95);
            const added = Math.min(popMax - state.pop.total, possibleNew);
            if (added > 0) {
              state.pop.total += added;
              report.newVillagers = added;
            }
          }

          advanceWeather(now);
          state.lastTick = now;
          saveState();
          return elapsedSec >= 30 ? report : null;
        }

        let tickCounter = 0;
        function gameTick() {
          const now = Date.now();
          const dtSec = Math.min(5, Math.max(0.5, (now - state.lastTick) / 1000));
          const dtMin = dtSec / 60;
          state.lastTick = now;

          // Wetter weiterführen
          advanceWeather(now);

          // Wirtschaft berechnen & anwenden (Signalfeuer legt automatisch Holz nach, solange Bestand > 0)
          const rates = computeEconomyRates();
          state.morale = rates.targetMorale;

          state.resources.meat = Math.max(0, state.resources.meat + rates.meatNet * dtMin);
          state.resources.wood = Math.max(0, state.resources.wood + rates.woodNet * dtMin);
          state.resources.stone = Math.max(0, state.resources.stone + rates.stoneNet * dtMin);
          state.resources.fur = Math.max(0, state.resources.fur + rates.furNet * dtMin);

          // Hinweis bei leerem Holzbestand (Modus bleibt dauerhaft gespeichert!)
          if (!rates.autoFeedActive && !lastWoodEmptyWarned) {
            lastWoodEmptyWarned = true;
            showToast('Holzbestand leer — Signalfeuer kann nicht automatisch nachlegen!', 'err');
          } else if (rates.autoFeedActive && lastWoodEmptyWarned) {
            lastWoodEmptyWarned = false;
            showToast('Holz verfügbar — Signalfeuer legt wieder automatisch nach.', 'ok');
          }

          state.ember = Math.max(0, Math.min(100, state.ember + rates.emberDeltaPerMin * dtMin));

          // Bewohner-Wachstum bei freiem Hüttenplatz, Nahrung & Glut >= 40%
          const popMax = getPopMax();
          if (state.pop.total < popMax && state.resources.meat >= 12 && state.ember >= 40) {
            state.pop.growthProgress += dtSec;
            if (state.pop.growthProgress >= 55) {
              state.pop.growthProgress = 0;
              state.pop.total += 1;
              SoundFX.play('complete');
              showToast('Ein neuer Stammesbewohner ist am Signalfeuer eingetroffen!', 'ok');
            }
          }

          // Verletzte Späher heilen
          if (state.pop.injured > 0 && now >= state.pop.injuryHealsAt) {
            state.pop.injured = 0;
            state.pop.injuryHealsAt = 0;
            showToast('Verletzte Späher sind wieder einsatzbereit.', 'ok');
          }

          // Aktiver Bauauftrag fertig?
          if (state.activeBuild && now >= state.activeBuild.endsAt) {
            const done = finishActiveBuild();
            if (done) {
              SoundFX.play('complete');
              showToast(`${done.name} erreicht Stufe ${done.level}! (+1 Knochen)`, 'ok');
              if (done.newlyUnlocked && done.newlyUnlocked.length > 0) {
                showToast(`Neu im Dorf freigeschaltet: ${done.newlyUnlocked.join(', ')}!`, 'ok');
              }
              if (openSheet && openSheet.type === 'building') renderSheet();
            }
          }

          // Aktive Forschung fertig?
          if (state.activeResearch && now >= state.activeResearch.endsAt) {
            const name = finishActiveResearch();
            if (name) {
              SoundFX.play('complete');
              showToast(`Forschung „${name}“ abgeschlossen! (+1 Knochen)`, 'ok');
              if (openSheet && openSheet.type === 'research') renderSheet();
            }
          }

          // Aktive Truppen-Ausbildung fertig?
          if (state.activeTraining && now >= state.activeTraining.endsAt) {
            const tr = finishActiveTraining();
            if (tr) {
              SoundFX.play('horn');
              showToast(`Ausbildung fertig: +${tr.count} ${tr.name}!`, 'ok');
              if (openSheet && openSheet.type === 'building') renderSheet();
            }
          }

          // Aktive Krankenzelt-Heilung fertig?
          if (state.activeHealing && now >= state.activeHealing.endsAt) {
            const hl = finishActiveHealing();
            if (hl) {
              SoundFX.play('complete');
              showToast(`Krankenzelt: ${hl.totalCount} Einheiten vollständig genesen!`, 'ok');
              if (openSheet && openSheet.type === 'building') renderSheet();
            }
          }

          // Passive Jagd-Ausdauer regenerieren
          tickStaminaRegen(now);

          // Expeditionen abgeschlossen?
          let expFinishedNow = false;
          for (const exp of state.activeExpeditions) {
            if (!exp.completed && now >= exp.endsAt) {
              rollExpeditionOutcome(exp);
              expFinishedNow = true;
            }
          }
          if (expFinishedNow) {
            SoundFX.play('horn');
            showToast('Eine Expedition ist zurückgekehrt! Beute wartet in der Wildnis.', 'ok');
          }

          // Weltkarten-Sammeltrupps & Regeneration aktualisieren
          processWorldMapTick(now);

          tickCounter++;
          if (tickCounter % 5 === 0) saveState();

          renderAll();
        }

        /* =====================================================================
           7. SPIELER-AKTIONEN
           ===================================================================== */
        function adjustWorker(buildingId, delta) {
          const def = BUILDINGS[buildingId];
          const bState = state.buildings[buildingId];
          if (!def.hasWorkers || bState.level <= 0) return;

          const maxW = def.maxWorkers(bState.level);
          if (delta > 0) {
            if (bState.workers >= maxW) return;
            if (getFreePop() <= 0) {
              SoundFX.play('error');
              showToast('Keine freien Bewohner verfügbar. Ziehe Arbeiter ab oder baue die Wohnhütte aus.', 'warn');
              return;
            }
            bState.workers += 1;
          } else if (delta < 0) {
            if (bState.workers <= 0) return;
            bState.workers -= 1;
          }
          SoundFX.play('tap');
          saveState();
          renderAll();
          if (openSheet) renderSheet();
        }

        function startUpgrade(buildingId) {
          if (state.activeBuild) {
            SoundFX.play('error');
            showToast('Es läuft bereits ein Bauauftrag. Warte bis zum Abschluss.', 'warn');
            return;
          }
          const evalReq = evaluateBuildingRequirements(buildingId);
          if (evalReq.isMax || !evalReq.allMet) {
            SoundFX.play('error');
            showToast('Noch nicht alle Gebäude-Voraussetzungen erfüllt.', 'err');
            return;
          }
          const cost = getBuildingCost(buildingId, evalReq.targetLevel);
          if (!canAfford(cost)) {
            SoundFX.play('error');
            showToast('Nicht genügend Ressourcen für diesen Ausbau.', 'err');
            return;
          }
          payCost(cost);
          const dur = getBuildingDuration(buildingId, evalReq.targetLevel);
          const now = Date.now();
          state.activeBuild = {
            buildingId,
            targetLevel: evalReq.targetLevel,
            startedAt: now,
            endsAt: now + dur * 1000
          };
          SoundFX.play('build');
          saveState();
          showToast(`${BUILDINGS[buildingId].name} (Stufe ${evalReq.targetLevel}) wird errichtet.`, 'ok');
          renderAll();
          if (openSheet) renderSheet();
        }

        function tryFreeFinishBuild() {
          if (!state.activeBuild) return;
          const rem = Math.ceil((state.activeBuild.endsAt - Date.now()) / 1000);
          if (rem > FREE_FINISH_SEC) return;
          const done = finishActiveBuild();
          if (done) {
            SoundFX.play('complete');
            showToast(`${done.name} sofort auf Stufe ${done.level} fertiggestellt!`, 'ok');
            if (done.newlyUnlocked && done.newlyUnlocked.length > 0) {
              showToast(`Neu im Dorf freigeschaltet: ${done.newlyUnlocked.join(', ')}!`, 'ok');
            }
            saveState();
            renderAll();
            if (openSheet) renderSheet();
          }
        }

        function startResearch(techId) {
          if (state.activeResearch) {
            SoundFX.play('error');
            showToast('Es läuft bereits eine Forschung.', 'warn');
            return;
          }
          const tech = RESEARCH_LIST.find((t) => t.id === techId);
          if (!tech) return;
          const info = evaluateResearchStatus(tech);
          if (info.status !== 'ready' || !canAfford(tech.cost)) {
            SoundFX.play('error');
            showToast('Voraussetzungen oder Ressourcen fehlen.', 'err');
            return;
          }
          payCost(tech.cost);
          const dur = getResearchDuration(tech);
          const now = Date.now();
          state.activeResearch = {
            techId,
            startedAt: now,
            endsAt: now + dur * 1000
          };
          SoundFX.play('build');
          saveState();
          showToast(`Forschung „${tech.name}“ gestartet.`, 'ok');
          renderAll();
          if (openSheet) renderSheet();
        }

        function tryFreeFinishResearch() {
          if (!state.activeResearch) return;
          const rem = Math.ceil((state.activeResearch.endsAt - Date.now()) / 1000);
          if (rem > FREE_FINISH_SEC) return;
          const name = finishActiveResearch();
          if (name) {
            SoundFX.play('complete');
            showToast(`Forschung „${name}“ abgeschlossen!`, 'ok');
            saveState();
            renderAll();
            if (openSheet) renderSheet();
          }
        }

        function launchExpedition(targetId) {
          const def = EXPEDITIONS.find((e) => e.id === targetId);
          if (!def) return;
          if (state.buildings.scout.level < def.reqScoutLevel) {
            SoundFX.play('error');
            showToast(`Erfordert Späher-Posten Stufe ${def.reqScoutLevel}.`, 'err');
            return;
          }
          if (state.activeExpeditions.length >= getMaxExpeditions()) {
            SoundFX.play('error');
            showToast('Maximale Anzahl gleichzeitiger Expeditionen erreicht.', 'warn');
            return;
          }
          if (getFreePop() < def.scoutsNeeded) {
            SoundFX.play('error');
            showToast(`Benötigt ${def.scoutsNeeded} freie Bewohner als Späher.`, 'warn');
            return;
          }
          const dur = getExpeditionDuration(def);
          const now = Date.now();
          state.activeExpeditions.push({
            id: 'exp_' + now + '_' + Math.floor(Math.random() * 999),
            targetId: def.id,
            scouts: def.scoutsNeeded,
            startedAt: now,
            endsAt: now + dur * 1000,
            completed: false,
            loot: null,
            injured: 0
          });
          SoundFX.play('horn');
          saveState();
          showToast(`Expedition zum Ziel „${def.name}“ aufgebrochen!`, 'ok');
          renderAll();
        }

        function collectExpedition(expId) {
          const idx = state.activeExpeditions.findIndex((e) => e.id === expId);
          if (idx === -1) return;
          const exp = state.activeExpeditions[idx];
          if (!exp.completed) return;

          const parts = [];
          for (const [res, amt] of Object.entries(exp.loot || {})) {
            state.resources[res] += amt;
            parts.push(`+${amt} ${RESOURCE_LABELS[res]}`);
          }
          // Expeditionen liefern zusätzlich Urzeit-Knochen, Ausrüstungskisten, Malerei & Goldene Knochen
          const expDef = EXPEDITIONS.find((e) => e.id === exp.targetId);
          const boneDrop = expDef ? Math.max(1, expDef.reqScoutLevel) : 1;
          addInventoryItem('bones', boneDrop);
          parts.push(`+${boneDrop} Knochen`);
          const chestDrop = expDef && expDef.reqScoutLevel >= 3 ? 2 : 1;
          addInventoryItem('gearChest', chestDrop);
          parts.push(`+${chestDrop} Ausrüstungskiste${chestDrop > 1 ? 'n' : ''}`);
          const pvePaintDrop = 2 + (expDef ? expDef.reqScoutLevel : 1);
          addInventoryItem('pvePaint', pvePaintDrop);
          parts.push(`+${pvePaintDrop} PvE-Malerei`);
          if (expDef && expDef.reqScoutLevel >= 2) {
            const pvpPaintDrop = expDef.reqScoutLevel;
            addInventoryItem('pvpPaint', pvpPaintDrop);
            parts.push(`+${pvpPaintDrop} PvP-Malerei`);
          }
          if (expDef && expDef.reqScoutLevel >= 3) {
            addInventoryItem('goldenBones', 1);
            parts.push('+1 Goldener Knochen');
          }
          addInventoryItem('heroXp', 80 * boneDrop);

          // Wildnis-Expeditionen können regionale Saurierarten für das Dino-Bestiarium entdecken
          let bestiaryMsg = '';
          if (expDef && Array.isArray(expDef.speciesIds) && expDef.speciesIds.length > 0) {
            const pickSpId = expDef.speciesIds[Math.floor(Math.random() * expDef.speciesIds.length)];
            if (recordBestiaryDiscovery(pickSpId)) {
              const sp = getDinoSpecies(pickSpId);
              if (sp) bestiaryMsg = ` · Bestiarium: ${sp.name} entdeckt!`;
            }
          }

          if (exp.injured > 0) {
            state.pop.injured += exp.injured;
            state.pop.injuryHealsAt = Date.now() + 90000; // 90s Erholung
          }
          state.activeExpeditions.splice(idx, 1);
          SoundFX.play('complete');
          saveState();
          const injMsg = exp.injured > 0 ? ' (1 Späher erholt sich 90 Sek.)' : '';
          showToast(`Beute geborgen: ${parts.join(', ')}${injMsg}${bestiaryMsg}`, 'ok');
          renderAll();
        }

        function setFireMode(mode) {
          if (mode !== 'normal' && mode !== 'overheat') return;
          if (state.fireMode === mode) return;
          state.fireMode = mode;
          SoundFX.play('stoke');
          saveState();
          showToast(
            mode === 'overheat'
              ? 'Überheizmodus dauerhaft aktiv (1,8× Holzverbrauch · voller Kälteschutz).'
              : 'Normalmodus dauerhaft aktiv (Standard-Holzverbrauch).',
            mode === 'overheat' ? 'warn' : 'info'
          );
          renderAll();
          if (openSheet && openSheet.id === 'bonfire') renderSheet();
        }

        /* =====================================================================
           8. BESPOKE 2.5D ISOMETRISCHE SVG-GRAFIKEN FÜR ALLE 7 GEBÄUDE
           ===================================================================== */
        function getBuildingSVG(id, level, isLocked) {
          const lit = level > 0;
          const stroke = lit ? '#e9dfd2' : '#78716c';
          const accent = lit ? '#f97316' : '#57534e';
          const warm = lit ? '#fbbf24' : '#6b645c';
          const dash = lit ? '' : 'stroke-dasharray="3 3"';
          const overheat = isOverheatMode() && state.resources.wood > 0.05;

          switch (id) {
            case 'bonfire':
              return `<svg viewBox="0 0 104 86" width="104" height="86">
                <!-- 2.5D Isometric Octagonal Stone Hearth Pedestal -->
                <ellipse cx="52" cy="68" rx="42" ry="15" fill="rgba(5,4,4,0.62)"/>
                <!-- Extruded 3D Stone Wall Sides -->
                <polygon points="16,58 34,69 70,69 88,58 88,66 70,77 34,77 16,66" fill="#2c241e" stroke="#6f6256" stroke-width="1.2"/>
                <polygon points="16,58 34,69 34,77 16,66" fill="#201a16"/>
                <polygon points="70,69 88,58 88,66 70,77" fill="#3b2d22"/>
                <!-- Top Isometric Hearth Deck -->
                <polygon points="16,58 34,47 70,47 88,58 70,69 34,69" fill="#3a3028" stroke="#938475" stroke-width="1.2"/>
                <!-- Glowing Coal Pit -->
                <ellipse cx="52" cy="57" rx="22" ry="9" fill="${state.ember > 5 ? '#9a3412' : '#1c1917'}"/>
                <!-- Crisscrossed 2.5D Charred Logs -->
                <path d="M34,60 L70,53 M35,53 L69,60" stroke="#78350f" stroke-width="4.5" stroke-linecap="round"/>
                <path d="M38,59 L66,54" stroke="#b45309" stroke-width="1.8" stroke-linecap="round"/>
                <!-- 3D Layered Flames (larger & brighter in Überheizen mode) -->
                <g class="${overheat ? 'bonfire-flame-overheat' : 'bonfire-flame-anim'}" opacity="${state.ember > 5 ? 1 : 0.2}">
                  <path d="M52,${overheat ? 4 : 11} C65,24 72,36 68,51 C65,58 58,61 52,61 C46,61 39,58 36,51 C32,36 39,24 52,${overheat ? 4 : 11} Z" fill="${overheat ? '#f97316' : '#ea580c'}"/>
                  <path d="M52,${overheat ? 15 : 22} C60,32 64,40 61,51 C59,56 56,58 52,58 C48,58 45,56 43,51 C40,40 44,32 52,${overheat ? 15 : 22} Z" fill="#fbbf24"/>
                  <ellipse cx="52" cy="51" rx="6.5" ry="7.5" fill="#fef3c7"/>
                </g>
              </svg>`;

            case 'lumber':
              return `<svg viewBox="0 0 84 68" width="84" height="68">
                <ellipse cx="42" cy="56" rx="33" ry="11" fill="rgba(6,5,5,0.58)"/>
                <!-- 2.5D Isometric Timber Cabin: Left Shaded Wall + Right Warm Lit Wall + Pitched Roof -->
                <polygon points="16,44 38,56 38,38 16,28" fill="${lit ? '#2b2017' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <polygon points="38,56 60,44 60,28 38,38" fill="${lit ? '#422e1f' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <!-- Pitched Isometric Bark Roof -->
                <polygon points="12,30 38,14 64,29 38,40" fill="${lit ? '#573b24' : 'none'}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
                <polygon points="12,30 38,40 38,14" fill="${lit ? '#3e2919' : 'none'}" opacity="0.6"/>
                <!-- Warm Doorway on Right Wall -->
                <polygon points="45,52 53,48 53,38 45,42" fill="${lit ? '#1c120b' : 'none'}" stroke="${warm}" stroke-width="1.1"/>
                <!-- 2.5D Stacked Log Pile beside Cabin -->
                <path d="M58,52 L72,45 M59,48 L73,41 M61,44 L73,38" stroke="${lit ? '#b45309' : '#57534e'}" stroke-width="4" stroke-linecap="round"/>
                <circle cx="58" cy="52" r="2.2" fill="${lit ? '#f59e0b' : '#57534e'}"/>
                <circle cx="59" cy="48" r="2.2" fill="${lit ? '#f59e0b' : '#57534e'}"/>
              </svg>`;

            case 'quarry':
              return `<svg viewBox="0 0 84 68" width="84" height="68">
                <ellipse cx="42" cy="56" rx="34" ry="11" fill="rgba(6,5,5,0.58)"/>
                <!-- 2.5D Stepped Isometric Basalt Cliff Block -->
                <polygon points="14,48 40,60 40,34 14,22" fill="${lit ? '#262321' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <polygon points="40,60 68,46 68,24 40,34" fill="${lit ? '#3d3733' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <polygon points="14,22 42,12 68,24 40,34" fill="${lit ? '#524b46' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <!-- Carved Lower Quarry Step -->
                <polygon points="24,52 40,60 56,52 40,45" fill="${lit ? '#1c1917' : 'none'}" stroke="${lit ? '#a8a29e' : '#57534e'}" stroke-width="1.2"/>
                <!-- Isometric Wooden Pulley Crane -->
                <path d="M46,31 L46,16 L58,21 M56,20 L56,34" stroke="${warm}" stroke-width="1.8" stroke-linecap="round" fill="none"/>
                <polygon points="52,34 60,34 58,40 50,40" fill="${lit ? '#78716c' : 'none'}" stroke="${stroke}" stroke-width="1"/>
              </svg>`;

            case 'hunter':
              return `<svg viewBox="0 0 84 68" width="84" height="68">
                <ellipse cx="42" cy="56" rx="33" ry="11" fill="rgba(6,5,5,0.58)"/>
                <!-- 2.5D Isometric Hide Lodge -->
                <polygon points="16,46 40,58 40,36 22,26" fill="${lit ? '#3b241c' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <polygon points="40,58 62,46 56,26 40,36" fill="${lit ? '#593729' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <polygon points="22,26 40,14 56,26 40,36" fill="${lit ? '#6e4534' : 'none'}" stroke="${stroke}" stroke-width="1.4" ${dash}/>
                <!-- Curved Dino-Tusk Entrance Arch -->
                <path d="M44,55 Q46,42 52,38 Q56,40 57,49" fill="${lit ? '#1c110d' : 'none'}" stroke="#f5efe6" stroke-width="2" stroke-linecap="round" opacity="${lit ? 0.92 : 0.45}"/>
                <!-- Side Pelt Drying Rack -->
                <path d="M12,48 L12,34 L22,39 L22,52" stroke="${warm}" stroke-width="1.5" fill="none"/>
                <polygon points="14,37 20,40 20,47 14,44" fill="${lit ? '#c27d52' : 'none'}" opacity="0.85"/>
              </svg>`;

            case 'hut':
              return `<svg viewBox="0 0 84 68" width="84" height="68">
                <ellipse cx="42" cy="56" rx="33" ry="11" fill="rgba(6,5,5,0.58)"/>
                <!-- 2.5D Isometric Mammoth-Hide Dome Longhouse -->
                <path d="M14,47 C14,26 27,15 42,15 C57,15 70,26 70,47 L42,60 Z" fill="${lit ? '#3d2c20' : 'none'}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
                <!-- Right Firelit Half Shading -->
                <path d="M42,15 C57,15 70,26 70,47 L42,60 Z" fill="${lit ? '#573f2d' : 'none'}" opacity="0.72"/>
                <!-- Rib Arches wrapping 2.5D Dome -->
                <path d="M23,28 Q42,35 61,28 M18,38 Q42,46 66,38" stroke="#c8b095" stroke-width="1.4" fill="none" opacity="${lit ? 0.65 : 0.3}"/>
                <!-- Warm Glowing Doorway facing Fire (Left-Front) -->
                <path d="M24,51 C24,42 28,39 33,41 C37,43 37,51 37,56 L24,51 Z" fill="${lit ? '#f59e0b' : 'none'}" stroke="${stroke}" stroke-width="1.2" opacity="${lit ? 0.9 : 0.4}"/>
              </svg>`;

            case 'workshop': {
              const researching = Boolean(state.activeResearch);
              return `<svg viewBox="0 0 84 68" width="84" height="68">
                <ellipse cx="42" cy="56" rx="34" ry="11" fill="rgba(6,5,5,0.6)"/>
                <!-- 2.5D Raised Ritual Plinth -->
                <polygon points="14,49 42,62 70,49 42,37" fill="${lit ? '#292228' : 'none'}" stroke="${stroke}" stroke-width="1.3" ${dash}/>
                <!-- 2.5D Tall Shamanic Research Pyramid Pavilion -->
                <polygon points="19,48 42,10 42,58" fill="${lit ? '#2f2230' : 'none'}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
                <polygon points="42,10 65,48 42,58" fill="${lit ? '#4c3448' : 'none'}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
                <!-- Crossed Shaman Totem Poles at Apex -->
                <path d="M35,15 L49,15 M42,6 L42,18" stroke="${warm}" stroke-width="2" stroke-linecap="round" opacity="${isLocked ? 0.35 : 0.95}"/>
                <!-- Glowing Amber Research Brazier / Rune Crystal -->
                <polygon points="49,47 54,39 59,47 54,53" fill="${researching ? '#fbbf24' : lit ? '#ea580c' : 'none'}" stroke="${warm}" stroke-width="1.3" opacity="${lit ? 0.95 : 0.4}"/>
                ${researching ? `<circle cx="54" cy="45" r="10" fill="#fbbf24" opacity="0.22"/>` : ''}
              </svg>`;
            }

            case 'scout':
              return `<svg viewBox="0 0 84 68" width="84" height="68">
                <ellipse cx="42" cy="56" rx="30" ry="10" fill="rgba(6,5,5,0.58)"/>
                <!-- 2.5D Isometric Watchtower 4 Stilts -->
                <path d="M26,51 L31,26 M42,58 L42,32 M58,51 L53,26 M29,39 L42,45 L55,39" stroke="${stroke}" stroke-width="2" fill="none" stroke-linecap="round" ${dash}/>
                <!-- Elevated 2.5D Timber Platform -->
                <polygon points="22,25 42,16 62,25 42,34" fill="${lit ? '#573c28' : 'none'}" stroke="${stroke}" stroke-width="1.5" ${dash}/>
                <polygon points="22,25 42,34 42,39 22,30" fill="${lit ? '#332317' : 'none'}" stroke="${stroke}" stroke-width="1.2" ${dash}/>
                <polygon points="42,34 62,25 62,30 42,39" fill="${lit ? '#473020' : 'none'}" stroke="${stroke}" stroke-width="1.2" ${dash}/>
                <!-- Bone Signal Flag -->
                <path d="M48,22 L48,7 L64,12 L48,17" fill="${lit ? '#ea580c' : 'none'}" stroke="${accent}" stroke-width="1.5"/>
              </svg>`;

            default:
              return '';
          }
        }

        function getTechIconSVG(id) {
          switch (id) {
            case 'smoking':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 19c0-2 2-3 2-5s-2-3-2-5"/><path d="M14 19c0-2 2-3 2-5s-2-3-2-5"/><path d="M4 21h16"/></svg>`;
            case 'tanning':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 4c2 2 8 2 10 0l2 5-2 3 2 7c-3-1-11-1-14 0l2-7-2-3 2-5Z"/></svg>`;
            case 'flint':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 19 15 12 21 5 15 12 3"/><path d="M12 3v18"/></svg>`;
            case 'axes':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20 18 8"/><path d="M13 5c3 0 6 3 6 6l-5 2-3-3 2-5Z"/></svg>`;
            case 'wedges':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 19 12 4 19 19 5 19"/><path d="M9 14h6"/></svg>`;
            case 'traps':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="13" r="7"/><path d="M8 10l2 3-2 3M16 10l-2 3 2 3"/></svg>`;
            case 'nets':
              return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/></svg>`;
            default:
              return '';
          }
        }

        /* =====================================================================
           9. RENDERING: HUD, 2D-LAGERKARTE, FORSCHUNG, WILDNIS & SHEETS
           ===================================================================== */
        function getHeroCaveSVG() {
          return `
            <svg width="74" height="56" viewBox="0 0 88 66" fill="none" aria-hidden="true">
              <defs>
                <radialGradient id="caveGlowGrad" cx="50%" cy="62%" r="52%">
                  <stop offset="0%" stop-color="#fde047" stop-opacity="0.95"/>
                  <stop offset="48%" stop-color="#f97316" stop-opacity="0.72"/>
                  <stop offset="100%" stop-color="#1c1410" stop-opacity="0"/>
                </radialGradient>
                <linearGradient id="caveRockGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="#5c4b41"/>
                  <stop offset="55%" stop-color="#362b26"/>
                  <stop offset="100%" stop-color="#1e1714"/>
                </linearGradient>
              </defs>
              <ellipse cx="44" cy="57" rx="37" ry="8" fill="#0b0807" opacity="0.65"/>
              <path d="M9 55 L15 28 L29 14 L46 10 L62 15 L74 29 L79 55 Z" fill="url(#caveRockGrad)" stroke="#8c6d56" stroke-width="1.5"/>
              <path d="M23 55 C23 31 32 21 44 21 C56 21 65 31 65 55 Z" fill="#160f0c"/>
              <ellipse cx="44" cy="44" rx="20" ry="15" fill="url(#caveGlowGrad)"/>
              <path d="M20 53 C21 31 30 19 44 19 C58 19 67 31 68 53" stroke="#efe5d5" stroke-width="3.2" stroke-linecap="round"/>
              <path d="M26 30 L19 25 M33 22 L29 15 M55 22 L59 15 M62 30 L69 25" stroke="#e5d5be" stroke-width="2.6" stroke-linecap="round"/>
              <path d="M38 49 L50 49 L47 41 L41 41 Z" fill="#47352b" stroke="#f59e0b" stroke-width="1.1"/>
              <circle cx="44" cy="36" r="4.2" fill="#fde047" opacity="0.95"/>
              <path d="M39 36 L49 36" stroke="#fffbeb" stroke-width="1.8" stroke-linecap="round"/>
              <circle cx="38.5" cy="36" r="1.7" fill="#fef08a"/>
              <circle cx="49.5" cy="36" r="1.7" fill="#fef08a"/>
              <line x1="16" y1="43" x2="16" y2="54" stroke="#785134" stroke-width="2"/>
              <circle cx="16" cy="41" r="3" fill="#fb923c"/>
              <line x1="72" y1="43" x2="72" y2="54" stroke="#785134" stroke-width="2"/>
              <circle cx="72" cy="41" r="3" fill="#fb923c"/>
            </svg>
          `;
        }

        function getHeroRoleIconSVG(role, color) {
          if (role === 'Tank') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9.5 4.5-1 8-4.5 8-9.5V6l-8-3Z"/><path d="M9 11h6M12 8v7"/></svg>`;
          }
          if (role === 'Fernkampf') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
          }
          return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5 19.5 9.5 10 19l-5.5 1.5L6 15l8.5-10.5Z"/><path d="m12 7 5 5"/></svg>`;
        }

        function getInventoryIconSVG(itemId, color) {
          if (itemId === 'gearChest') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 12h18"/><path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><rect x="10" y="10" width="4" height="4" rx="1"/></svg>`;
          }
          if (itemId === 'pvpPaint') {
            return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><path d="M9.5 14.5 14.5 9.5"/></svg>`;
          }
          if (itemId === 'pvePaint') {
            return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
          }
          if (itemId === 'bones' || itemId === 'goldenBones') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 10c.7-.7 1.7-1 2.5-.5a2.2 2.2 0 0 1 .4 3.5c-.6.6-.6 1.4 0 2a2.2 2.2 0 0 1-3.1 3.1c-.6-.6-1.4-.6-2 0a2.2 2.2 0 0 1-3.5-.4c-.5-.8-.2-1.8.5-2.5L9.8 13.2c-.7.7-1.7 1-2.5.5a2.2 2.2 0 0 1-.4-3.5c.6-.6.6-1.4 0-2A2.2 2.2 0 0 1 10 5.1c.6.6 1.4.6 2 0a2.2 2.2 0 0 1 3.5.4c.5.8.2 1.8-.5 2.5L17 10Z"/></svg>`;
          }
          if (itemId === 'heroXp') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.7 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/></svg>`;
          }
          if (itemId === 'teleportItem') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
          }
          if (itemId === 'shamanTotem') {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M7 6h10l-1.5 4h-7L7 6Z"/><path d="M6 12h12"/><path d="M8 16h8l-1 4H9l-1-4Z"/><circle cx="10" cy="8" r="0.8" fill="${color}"/><circle cx="14" cy="8" r="0.8" fill="${color}"/></svg>`;
          }
          if (itemId.startsWith('speedup')) {
            return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
          }
          return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>`;
        }

        function renderHUD() {
          const rates = computeEconomyRates();

          document.getElementById('hud-meat').textContent = fmtNum(state.resources.meat);
          document.getElementById('hud-wood').textContent = fmtNum(state.resources.wood);
          document.getElementById('hud-stone').textContent = fmtNum(state.resources.stone);
          document.getElementById('hud-fur').textContent = fmtNum(state.resources.fur);
          document.getElementById('hud-pop').textContent = `${getFreePop()}/${state.pop.total}`;

          const setRate = (id, val) => {
            const el = document.getElementById(id);
            el.textContent = fmtRate(val);
            el.className = 'res-rate ' + (val > 0.4 ? 'pos' : val < -0.4 ? 'neg' : '');
          };
          setRate('rate-meat', rates.meatNet);
          setRate('rate-wood', rates.woodNet);
          setRate('rate-stone', rates.stoneNet);
          setRate('rate-fur', rates.furNet);

          const mEl = document.getElementById('rate-morale');
          mEl.textContent = `Moral ${state.morale}%`;
          mEl.className = 'res-rate ' + (state.morale >= 85 ? 'pos' : state.morale < 65 ? 'neg' : '');

          const setTabDot = (id, count) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (count > 0) {
              el.textContent = count > 99 ? '99+' : String(count);
              el.classList.add('visible');
            } else {
              el.textContent = '';
              el.classList.remove('visible');
            }
          };

          const activeM = (state.worldMarches || []).length;
          setTabDot('navWorldHint', activeM);

          const inv = state.inventory || {};
          let heroActionCount = (inv.gearChest || 0) + getUnreadBattleCount();
          for (const h of HEROES_LIST) {
            const hs = state.heroes && state.heroes[h.id];
            if (!hs) continue;
            if (!hs.unlocked && hs.shards >= 10) heroActionCount++;
            else if (hs.unlocked && hs.stars < 5 && hs.shards >= getHeroStarShardCost(hs.stars)) heroActionCount++;
          }
          setTabDot('navHeroesHint', heroActionCount);

          const usableInvCount =
            (inv.gearChest || 0) +
            (inv.bones || 0) +
            (inv.goldenBones || 0) +
            (inv.crateMeat || 0) +
            (inv.crateWood || 0) +
            (inv.crateStone || 0) +
            (inv.crateFur || 0);
          setTabDot('navInvHint', usableInvCount);

          const readyExps = state.activeExpeditions.filter((e) => e.completed).length;
          setTabDot('navWildHint', readyExps > 0 ? readyExps : state.activeExpeditions.length);
        }

        function renderVillageMap() {
          const now = Date.now();
          const rates = computeEconomyRates();
          const emberPct = Math.round(state.ember);
          const emberSt = getEmberStatus(emberPct);
          const overheat = isOverheatMode();

          document.getElementById('emberLabel').textContent = `Glut ${emberPct}%`;
          document.getElementById('emberMiniFill').style.width = `${emberPct}%`;
          const stEl = document.getElementById('emberStateText');
          if (!rates.autoFeedActive) {
            stEl.textContent = 'Kein Holz!';
            stEl.style.color = '#ef4444';
          } else {
            stEl.textContent = overheat ? 'Auto · Überheizt' : `Auto · ${emberSt.label}`;
            stEl.style.color = overheat ? '#fb923c' : emberSt.color;
          }

          // Dauerhafter Normal / Überheizen Umschalter
          document.getElementById('btnModeNormal').className = 'mode-switch-btn' + (!overheat ? ' active-normal' : '');
          document.getElementById('btnModeOverheat').className = 'mode-switch-btn' + (overheat ? ' active-overheat' : '');

          // Wetter-Banner & Vignetten
          const wEl = document.getElementById('weatherBannerText');
          const wRem = Math.max(0, Math.ceil((state.weather.phaseEndsAt - now) / 1000));
          const frostVig = document.getElementById('frostVignette');
          const ashVig = document.getElementById('ashVignette');

          if (state.weather.phase === 'calm') {
            wEl.textContent = `Ruhige Asche-Nacht · Wechsel in ${fmtClock(wRem)}`;
            wEl.className = 'weather-line';
            frostVig.classList.remove('active');
            ashVig.classList.remove('active');
          } else if (state.weather.phase === 'warning') {
            const name = state.weather.type === 'cold' ? 'Kälteeinbruch' : 'Aschesturm';
            wEl.textContent = `Vorwarnung: ${name} in ${fmtClock(wRem)} · Holz prüfen`;
            wEl.className = 'weather-line warn';
            frostVig.classList.remove('active');
            ashVig.classList.remove('active');
          } else {
            const isCold = state.weather.type === 'cold';
            const name = isCold ? 'Kälteeinbruch aktiv' : 'Aschesturm aktiv';
            const extra = isCold ? 'Holz +45 %' : 'Holz +55 %';
            wEl.textContent = `${name} (${fmtClock(wRem)}) · ${extra}`;
            wEl.className = 'weather-line ' + (isCold ? 'cold' : 'ash');
            frostVig.classList.toggle('active', isCold);
            ashVig.classList.toggle('active', !isCold);
          }

          // Alle 15 Gebäude-Zustände an die animierte 3D-Dorfszene synchronisieren
          const inv = state.inventory || {};
          const freeBoneReady = now >= (state.heroCaveFreeAt || 0);
          const marketClaimReady = now >= (state.marketClaimAt || 0);
          const injuredCountTotal = getTotalInjuredTroops();
          const fallenCountTotal = getTotalFallenTroops();
          const buildingSnapshots = [];

          for (const id of BUILDING_ORDER) {
            const def = BUILDINGS[id];
            const bState = state.buildings[id];
            const isVisibleInUI = BuildingRegistry.isVisibleInUI(id, state);
            const isBuilding = Boolean(state.activeBuild && state.activeBuild.buildingId === id);
            const isResearchingHere = id === 'workshop' && Boolean(state.activeResearch);
            const isTrainingHere = Boolean(def.troopType && state.activeTraining && state.activeTraining.troopType === def.troopType);
            const isHealingHere = id === 'infirmary' && Boolean(state.activeHealing);
            const evalReq = evaluateBuildingRequirements(id);
            const nextCost = evalReq.isMax ? null : getBuildingCost(id, evalReq.targetLevel);
            const canUpgradeNow = !state.activeBuild && !evalReq.isMax && evalReq.allMet && canAfford(nextCost);
            const isLockedUnbuilt = bState.level === 0 && !evalReq.allMet;

            let metaText = '';
            let metaClass = '';
            let progressPct = null;

            if (isBuilding) {
              const total = Math.max(1, (state.activeBuild.endsAt - state.activeBuild.startedAt) / 1000);
              const rem = Math.max(0, (state.activeBuild.endsAt - now) / 1000);
              progressPct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
              metaText = `Bau ${fmtClock(rem)}`;
              metaClass = 'is-building';
            } else if (isResearchingHere) {
              const total = Math.max(1, (state.activeResearch.endsAt - state.activeResearch.startedAt) / 1000);
              const rem = Math.max(0, (state.activeResearch.endsAt - now) / 1000);
              progressPct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
              metaText = `Forschen ${fmtClock(rem)}`;
              metaClass = 'is-building';
            } else if (isTrainingHere) {
              const total = Math.max(1, (state.activeTraining.endsAt - state.activeTraining.startedAt) / 1000);
              const rem = Math.max(0, (state.activeTraining.endsAt - now) / 1000);
              progressPct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
              metaText = `Ausb. ${fmtClock(rem)}`;
              metaClass = 'is-building';
            } else if (isHealingHere) {
              const total = Math.max(1, (state.activeHealing.endsAt - state.activeHealing.startedAt) / 1000);
              const rem = Math.max(0, (state.activeHealing.endsAt - now) / 1000);
              progressPct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
              metaText = `Heilt ${fmtClock(rem)}`;
              metaClass = 'is-building';
            } else if (bState.level === 0) {
              metaText = isLockedUnbuilt ? 'Gesperrt' : 'Baubar';
              metaClass = isLockedUnbuilt ? 'is-locked' : 'can-up';
            } else if (def.isHeroCave) {
              const bCnt = inv.bones || 0;
              const gCnt = inv.goldenBones || 0;
              if (freeBoneReady) {
                metaText = 'Gratis Knochen!';
                metaClass = 'can-up';
              } else {
                metaText = `${bCnt} Kn · ${gCnt} Gold`;
                metaClass = gCnt > 0 ? 'is-gold' : '';
              }
            } else if (id === 'infirmary') {
              const cap = getInfirmaryCapacity(bState.level);
              metaText = injuredCountTotal > 0 ? `St. ${bState.level} · ${injuredCountTotal}/${cap} verl.` : `St. ${bState.level} · 0/${cap}`;
              metaClass = injuredCountTotal > 0 ? 'is-gold' : canUpgradeNow ? 'can-up' : '';
            } else if (id === 'graveyard') {
              metaText = fallenCountTotal > 0 ? `St. ${bState.level} · ${fallenCountTotal} Gef.` : `St. ${bState.level} · Ruhig`;
              metaClass = fallenCountTotal > 0 ? 'is-gold' : canUpgradeNow ? 'can-up' : '';
            } else if (id === 'marketplace') {
              if (marketClaimReady) {
                metaText = '+300 Ausdauer!';
                metaClass = 'can-up';
              } else {
                const remSec = Math.max(0, Math.ceil((state.marketClaimAt - now) / 1000));
                metaText = `St. ${bState.level} · ${fmtClock(remSec)}`;
                if (canUpgradeNow) metaClass = 'can-up';
              }
            } else if (id === 'warehouse') {
              const caps = getWarehouseSafeCaps(bState.level);
              metaText = `St. ${bState.level} · Safe ${fmtNum(caps.wood)}`;
              if (canUpgradeNow) metaClass = 'can-up';
            } else if (def.troopType) {
              const cnt = (state.troops && state.troops[def.troopType]) || 0;
              metaText = `St. ${bState.level} · ${def.role} (${cnt})`;
              if (canUpgradeNow) metaClass = 'can-up';
            } else if (id === 'hut') {
              metaText = `St. ${bState.level} · ${state.pop.total}/${getPopMax()}`;
              if (canUpgradeNow) metaClass = 'can-up';
            } else {
              const workerStr = def.hasWorkers ? ` · ${bState.workers}/${def.maxWorkers(bState.level)}` : '';
              metaText = `St. ${bState.level}${workerStr}`;
              if (canUpgradeNow) metaClass = 'can-up';
            }

            buildingSnapshots.push({
              id,
              shortName: def.shortName,
              name: def.name,
              level: bState.level,
              isMain: Boolean(def.isMain),
              isHeroCave: Boolean(def.isHeroCave),
              isBuilding,
              isResearching: isResearchingHere,
              isTraining: isTrainingHere,
              isHealing: isHealingHere,
              isVisible: isVisibleInUI,
              isLocked: isLockedUnbuilt,
              canUpgrade: canUpgradeNow,
              metaText,
              metaClass,
              progressPct,
              workers: bState.workers || 0,
              freeBoneReady: def.isHeroCave ? freeBoneReady : false,
              hasMarketClaim: id === 'marketplace' && bState.level > 0 ? marketClaimReady : false,
              fallenCount: id === 'graveyard' ? fallenCountTotal : 0,
              injuredCount: id === 'infirmary' ? injuredCountTotal : 0
            });
          }

          if (window.Village3D) {
            window.Village3D.syncState({
              ember: state.ember,
              overheat,
              autoFeedActive: rates.autoFeedActive,
              weatherPhase: state.weather.phase,
              weatherType: state.weather.type,
              popTotal: state.pop.total,
              buildings: buildingSnapshots
            });
          }

          // Bau- oder Ausbildungs-Fortschrittsleiste am unteren Rand der Karte
          const qBar = document.getElementById('villageQueueBar');
          const freeBtn = document.getElementById('btnQueueFreeFinish');
          if (state.activeBuild) {
            const bDef = BUILDINGS[state.activeBuild.buildingId];
            const total = Math.max(1, (state.activeBuild.endsAt - state.activeBuild.startedAt) / 1000);
            const rem = Math.max(0, (state.activeBuild.endsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
            qBar.classList.add('visible');
            document.getElementById('queueBuildName').textContent = `${bDef.shortName} → St. ${state.activeBuild.targetLevel}`;
            document.getElementById('queueBuildTime').textContent = fmtClock(rem);
            document.getElementById('queueBuildFill').style.width = `${pct.toFixed(1)}%`;
            freeBtn.style.display = rem <= FREE_FINISH_SEC ? 'inline-flex' : 'none';
          } else if (state.activeTraining) {
            const tDef = TROOP_DEFS[state.activeTraining.troopType];
            const total = Math.max(1, (state.activeTraining.endsAt - state.activeTraining.startedAt) / 1000);
            const rem = Math.max(0, (state.activeTraining.endsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
            qBar.classList.add('visible');
            document.getElementById('queueBuildName').textContent = `Ausbildung: ${state.activeTraining.count}× ${tDef.name}`;
            document.getElementById('queueBuildTime').textContent = fmtClock(rem);
            document.getElementById('queueBuildFill').style.width = `${pct.toFixed(1)}%`;
            freeBtn.style.display = 'none';
          } else {
            qBar.classList.remove('visible');
          }
        }

        function renderHeroesTab() {
          const container = document.getElementById('heroesContainer');
          if (!container) return;

          const unlockedCount = HEROES_LIST.filter((h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked).length;
          const totalPower = getTotalTribePower();
          const troopPower = getTroopTotalPower();
          const heroXp = (state.inventory && state.inventory.heroXp) || 0;
          const bones = (state.inventory && state.inventory.bones) || 0;
          const goldenBones = (state.inventory && state.inventory.goldenBones) || 0;
          const gearChests = (state.inventory && state.inventory.gearChest) || 0;
          const bag = Array.isArray(state.equipmentBag) ? state.equipmentBag : [];

          let html = `
            <div class="section-head">
              <h2 class="section-title">Stammes-Helden & Klassen-Gear</h2>
              <p class="section-sub">Rekrutiere Helden, öffne Ausrüstungskisten und rüste Nahkampf-, Tank- und Fernkampf-Helden klassenspezifisch aus.</p>
            </div>

            <div class="gear-chest-bar">
              <div class="gear-chest-info">
                <div class="gear-chest-icon">${getInventoryIconSVG('gearChest', '#fbbf24')}</div>
                <div>
                  <div class="gear-chest-title">Ausrüstungskisten: <strong>${gearChests}</strong></div>
                  <div class="gear-chest-sub">Wildnis-Beute & Heldenhöhle · ${bag.length} Teile im Rucksack</div>
                </div>
              </div>
              <div class="gear-chest-actions">
                <button class="gear-open-btn" data-open-gear-chest="1" ${gearChests > 0 ? '' : 'disabled'}>Öffnen</button>
                ${gearChests > 1 ? `<button class="gear-open-btn all" data-open-gear-chest="all">Alle (${Math.min(gearChests, 10)})</button>` : ''}
              </div>
            </div>
          `;

          if (lastGearDrops && lastGearDrops.length > 0) {
            html += `
              <div class="gear-reveal-box">
                <div class="gear-reveal-head">
                  <span>Neu aus Ausrüstungskiste (${lastGearDrops.length}×)</span>
                  <button class="jump-btn" data-dismiss-gear-drop="1">Schließen</button>
                </div>
                <div class="gear-reveal-list">
                  ${lastGearDrops
                    .slice(0, 5)
                    .map((d) => {
                      const roleInfo = GEAR_ROLE_INFO[d.role] || GEAR_ROLE_INFO.melee;
                      const slotObj = GEAR_SLOTS.find((s) => s.key === d.slot);
                      return `
                        <div class="gear-bag-item gear-rarity-${d.rarity}">
                          <div class="gear-bag-meta">
                            <div class="gear-bag-name">${d.name}</div>
                            <div class="gear-bag-sub">
                              <span class="gear-role-tag ${roleInfo.cssClass}">${roleInfo.label}</span>
                              <span>${slotObj ? slotObj.title : d.slot}</span>
                              <span class="mono" style="color:#fde68a;">${d.stat}</span>
                            </div>
                          </div>
                          <button class="gear-slot-btn" data-hero-subtab="gear">Ansehen</button>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </div>
            `;
          }

          const pvpPaint = (state.inventory && state.inventory.pvpPaint) || 0;
          const pvePaint = (state.inventory && state.inventory.pvePaint) || 0;
          const huntLogs = Array.isArray(state.huntLogs) ? state.huntLogs : [];
          const unreadBattles = getUnreadBattleCount();
          const activeHuntMarches = (state.worldMarches || []).filter((m) => m.kind === 'hunt');
          const newestBattle = huntLogs[0] || null;

          // Live-Jagdtrupp- oder Kampf-Banner im Helden-Reiter
          if (activeHuntMarches.length > 0) {
            const m = activeHuntMarches[0];
            const sp = getDinoSpecies(m.speciesId);
            const rem = Math.max(0, (m.phaseEndsAt - Date.now()) / 1000);
            const hasBattle = Boolean(m.battleId);
            html += `
              <div class="hero-hunt-banner ${m.outcome && m.outcome.victory ? 'victory' : ''}">
                <div class="hero-hunt-banner-info">
                  <div class="hero-hunt-banner-title">
                    ${hasBattle ? (m.outcome && m.outcome.victory ? `Sieg über ${sp ? sp.name : 'Saurier'} St. ${m.dinoLevel}!` : `Rückzug von ${sp ? sp.name : 'Saurier'} St. ${m.dinoLevel}`) : `Jagdtrupp unterwegs: ${sp ? sp.name : 'Saurier'} St. ${m.dinoLevel}`}
                  </div>
                  <div class="hero-hunt-banner-sub">
                    ${hasBattle ? `Heimkehr in ${fmtClock(rem)} · Kampfbericht bereit` : `Eintreffen in ${fmtClock(rem)} · ${(m.heroes || []).length} Helden`}
                  </div>
                </div>
                ${
                  hasBattle
                    ? `<button class="battle-watch-btn" data-open-battle="${m.battleId}">Kampf ansehen</button>`
                    : `<button class="jump-btn" data-goto-world-dino="${m.dinoId}">Auf Karte</button>`
                }
              </div>
            `;
          } else if (newestBattle && !newestBattle.read) {
            html += `
              <div class="hero-hunt-banner ${newestBattle.victory ? 'victory' : ''}">
                <div class="hero-hunt-banner-info">
                  <div class="hero-hunt-banner-title">
                    Neues Gefecht: ${newestBattle.speciesName} St. ${newestBattle.dinoLevel} (${newestBattle.victory ? 'Sieg' : 'Niederlage'})
                  </div>
                  <div class="hero-hunt-banner-sub">
                    ${newestBattle.heroes.map((h) => h.shortName).join(', ') || 'Jagdtrupp'} · ${newestBattle.rounds.length} Runden
                  </div>
                </div>
                <button class="battle-watch-btn" data-open-battle="${newestBattle.id}">Abspielen</button>
              </div>
            `;
          }

          html += `
            <div class="gear-subtabs" role="tablist">
              <button class="gear-subtab-btn ${heroSubTab === 'heroes' ? 'active' : ''}" data-hero-subtab="heroes">
                Helden (${unlockedCount})
              </button>
              <button class="gear-subtab-btn ${heroSubTab === 'skills' ? 'active' : ''}" data-hero-subtab="skills">
                Skills
              </button>
              <button class="gear-subtab-btn ${heroSubTab === 'gear' ? 'active' : ''}" data-hero-subtab="gear">
                Gear (${bag.length})
              </button>
              <button class="gear-subtab-btn ${heroSubTab === 'battles' ? 'active' : ''}" data-hero-subtab="battles">
                <span>Kämpfe</span>
                ${unreadBattles > 0 ? `<span class="subtab-unread">${unreadBattles}</span>` : huntLogs.length > 0 ? `<span class="mono" style="opacity:0.75;">(${huntLogs.length})</span>` : ''}
              </button>
            </div>
          `;

          if (heroSubTab === 'battles') {
            html += buildHeroBattleLogSubTabHTML(huntLogs, activeHuntMarches);
            container.innerHTML = html;
            return;
          }

          if (heroSubTab === 'skills') {
            const sortedHeroes = [...HEROES_LIST].sort((a, b) => {
              const ha = (state.heroes && state.heroes[a.id]) || { unlocked: false };
              const hb = (state.heroes && state.heroes[b.id]) || { unlocked: false };
              if (ha.unlocked !== hb.unlocked) return ha.unlocked ? -1 : 1;
              return 0;
            });
            if (!HEROES_LIST.some((h) => h.id === selectedGearHeroId)) {
              selectedGearHeroId = sortedHeroes[0].id;
            }
            const activeHero = HEROES_LIST.find((h) => h.id === selectedGearHeroId) || sortedHeroes[0];
            const activeState = (state.heroes && state.heroes[activeHero.id]) || {
              unlocked: false,
              level: 1,
              stars: 1,
              shards: 0,
              equipped: createEmptyEquipped(),
              skills: createInitialHeroSkills()
            };
            const skillsState = ensureHeroSkills(activeState);
            const activeRoleInfo = GEAR_ROLE_INFO[getHeroRoleKey(activeHero.role)];
            const activeRarity = RARITY_META[activeHero.rarity];
            const heroTotalPower = getHeroPower(activeHero, activeState);
            const skillPowerBonus = getHeroSkillPower(activeState);
            const totalSkLv = getHeroSkillTotalLevels(activeState);
            const heroSkillDefs = HERO_SKILLS_MAP[activeHero.id] || { pvp: [], pve: [] };

            html += `
              <div class="paint-bar">
                <div class="paint-card pvp">
                  <div class="paint-left">
                    <div class="paint-icon">${getInventoryIconSVG('pvpPaint', '#f87171')}</div>
                    <div>
                      <div class="paint-label">PvP-Malerei</div>
                      <div class="paint-val">${fmtNum(pvpPaint)}</div>
                    </div>
                  </div>
                  <button class="paint-src-btn" data-goto-cave="1">Höhle</button>
                </div>
                <div class="paint-card pve">
                  <div class="paint-left">
                    <div class="paint-icon">${getInventoryIconSVG('pvePaint', '#34d399')}</div>
                    <div>
                      <div class="paint-label">PvE-Malerei</div>
                      <div class="paint-val">${fmtNum(pvePaint)}</div>
                    </div>
                  </div>
                  <button class="paint-src-btn" data-goto-wilderness="1">Wildnis</button>
                </div>
              </div>
            `;

            html += `<div class="gear-hero-strip" role="tablist">`;
            for (const h of sortedHeroes) {
              const hs = (state.heroes && state.heroes[h.id]) || { unlocked: false, skills: createInitialHeroSkills() };
              const skSum = getHeroSkillTotalLevels(hs);
              const shortName = h.name.split(' ')[0];
              html += `
                <button
                  class="gear-hero-pill ${h.id === activeHero.id ? 'active' : ''} ${hs.unlocked ? '' : 'locked'}"
                  data-gear-select-hero="${h.id}"
                >
                  <span class="gear-hero-pill-name">${shortName}${hs.unlocked ? '' : ' 🔒'}</span>
                  <span class="gear-hero-pill-sub">${h.role} · Lv.${skSum}/36</span>
                </button>
              `;
            }
            html += `</div>`;

            html += `
              <div class="hero-card" style="--rarity-col:${activeRarity.color}; margin-bottom:10px;">
                <div class="hero-top">
                  <div class="hero-avatar">${getHeroRoleIconSVG(activeHero.role, activeRarity.color)}</div>
                  <div class="hero-info">
                    <div class="hero-name-row">
                      <span class="hero-name">${activeHero.name}</span>
                      <span class="gear-role-tag ${activeRoleInfo.cssClass}">${activeRoleInfo.label}</span>
                    </div>
                    <div class="hero-bonus-text" style="margin-top:3px;">
                      ${
                        activeState.unlocked
                          ? `Macht: <strong class="mono" style="color:#fbbf24;">${fmtNum(heroTotalPower)}</strong> <span class="mono" style="color:#4ade80;">(Skills +${fmtNum(skillPowerBonus)} · ${totalSkLv}/36)</span>`
                          : '<span style="color:#fca5a5;">Noch nicht freigeschaltet — in der Heldenhöhle ziehen</span>'
                      }
                    </div>
                  </div>
                </div>
              </div>
            `;

            const renderBranchHTML = (branch, title, reqLabel, paintHave, paintName) => {
              const list = heroSkillDefs[branch] || [];
              return `
                <div class="skill-section ${branch}">
                  <div class="skill-section-head">
                    <span class="skill-section-title">${title}</span>
                    <span class="skill-section-req">${reqLabel}</span>
                  </div>
                  <div class="skill-list">
                    ${list
                      .map((sk, idx) => {
                        const lv = (skillsState[branch] && skillsState[branch][idx]) || 1;
                        const isMax = lv >= MAX_SKILL_LEVEL;
                        const cost = getSkillUpgradeCost(lv);
                        const canUp = activeState.unlocked && !isMax && paintHave >= cost;
                        return `
                          <div class="skill-row">
                            <div class="skill-meta">
                              <div class="skill-row-head">
                                <span class="skill-name">${sk.name}</span>
                                <span class="skill-lvl-badge ${isMax ? 'max' : ''}">Lv. ${lv}/${MAX_SKILL_LEVEL}</span>
                              </div>
                              <div class="skill-desc">${sk.desc(lv)}</div>
                              <div class="skill-source">Quelle: Heldenhöhle & Wildnis</div>
                            </div>
                            ${
                              isMax
                                ? `<span class="skill-max-tag">MAX</span>`
                                : `<button class="skill-up-btn ${branch}" data-upgrade-skill="${activeHero.id}|${branch}|${idx}" ${canUp ? '' : 'disabled'}>
                                    <span>${activeState.unlocked ? 'Aufwerten' : 'Gesperrt'}</span>
                                    <span>${cost} ${paintName}</span>
                                  </button>`
                            }
                          </div>
                        `;
                      })
                      .join('')}
                  </div>
                </div>
              `;
            };

            html += `
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;padding:0 2px;">
                <span style="font-size:11.5px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#fde68a;">6 Fähigkeiten (Max. Lv. 6)</span>
                <span style="font-size:10px;color:var(--text-muted);">+120 Macht pro Stufe</span>
              </div>
            `;
            html += renderBranchHTML('pvp', '3× PvP-Fähigkeiten', 'Bedarf: PvP-Malerei', pvpPaint, 'PvP-Malerei');
            html += renderBranchHTML('pve', '3× Dinojagd & Wildnis', 'Bedarf: PvE-Malerei', pvePaint, 'PvE-Malerei');

            container.innerHTML = html;
            return;
          }

          if (heroSubTab === 'gear') {
            // Sicherstellen, dass ein gültiger Held ausgewählt ist
            const sortedHeroes = [...HEROES_LIST].sort((a, b) => {
              const ha = (state.heroes && state.heroes[a.id]) || { unlocked: false };
              const hb = (state.heroes && state.heroes[b.id]) || { unlocked: false };
              if (ha.unlocked !== hb.unlocked) return ha.unlocked ? -1 : 1;
              return 0;
            });
            if (!HEROES_LIST.some((h) => h.id === selectedGearHeroId)) {
              selectedGearHeroId = sortedHeroes[0].id;
            }
            const activeHero = HEROES_LIST.find((h) => h.id === selectedGearHeroId) || sortedHeroes[0];
            const activeState = (state.heroes && state.heroes[activeHero.id]) || {
              unlocked: false,
              level: 1,
              stars: 1,
              shards: 0,
              equipped: createEmptyEquipped()
            };
            const activeRoleKey = getHeroRoleKey(activeHero.role);
            const activeRoleInfo = GEAR_ROLE_INFO[activeRoleKey];
            const activeRarity = RARITY_META[activeHero.rarity];
            const heroTotalPower = getHeroPower(activeHero, activeState);
            const heroGearBonus = getHeroGearPower(activeState);

            html += `<div class="gear-hero-strip" role="tablist">`;
            for (const h of sortedHeroes) {
              const hs = (state.heroes && state.heroes[h.id]) || { unlocked: false, equipped: createEmptyEquipped() };
              const eqCount = getHeroEquippedCount(hs);
              const shortName = h.name.split(' ')[0];
              html += `
                <button
                  class="gear-hero-pill ${h.id === activeHero.id ? 'active' : ''} ${hs.unlocked ? '' : 'locked'}"
                  data-gear-select-hero="${h.id}"
                >
                  <span class="gear-hero-pill-name">${shortName}${hs.unlocked ? '' : ' 🔒'}</span>
                  <span class="gear-hero-pill-sub">${h.role} · ${eqCount}/4</span>
                </button>
              `;
            }
            html += `</div>`;

            // Ausgewählter Held + 2x2 Ausrüstungs-Slots
            html += `
              <div class="hero-card" style="--rarity-col:${activeRarity.color}; margin-bottom:10px;">
                <div class="hero-top">
                  <div class="hero-avatar">${getHeroRoleIconSVG(activeHero.role, activeRarity.color)}</div>
                  <div class="hero-info">
                    <div class="hero-name-row">
                      <span class="hero-name">${activeHero.name}</span>
                      <span class="gear-role-tag ${activeRoleInfo.cssClass}">${activeRoleInfo.label}</span>
                    </div>
                    <div class="hero-bonus-text" style="margin-top:3px;">
                      ${
                        activeState.unlocked
                          ? `Gesamtmacht: <strong class="mono" style="color:#fbbf24;">${fmtNum(heroTotalPower)}</strong> <span class="mono" style="color:#4ade80;">(Gear +${fmtNum(heroGearBonus)})</span>`
                          : '<span style="color:#fca5a5;">Noch nicht freigeschaltet — in der Heldenhöhle ziehen</span>'
                      }
                    </div>
                  </div>
                </div>

                <div style="font-size:11.5px; font-weight:700; color:#fdba74;">Angelegte ${activeRoleInfo.label}-Ausrüstung (4 Slots):</div>
                <div class="gear-equip-grid">
            `;

            for (const slot of GEAR_SLOTS) {
              const eq = activeState.equipped ? activeState.equipped[slot.key] : null;
              if (eq) {
                const rInfo = GEAR_RARITY_MAP[eq.rarity] || GEAR_RARITIES[0];
                html += `
                  <div class="gear-slot filled gear-rarity-${eq.rarity}">
                    <div>
                      <div class="gear-slot-head">
                        <span>${slot.title}</span>
                        <span style="color:${rInfo.color};">${rInfo.label}</span>
                      </div>
                      <div class="gear-slot-name">${eq.name.replace(/\s*\([^)]*\)$/, '')}</div>
                      <div class="gear-slot-stat">${eq.stat}</div>
                    </div>
                    <button class="gear-slot-btn unequip" data-gear-unequip="${activeHero.id}|${slot.key}">Ablegen</button>
                  </div>
                `;
              } else {
                html += `
                  <div class="gear-slot">
                    <div class="gear-slot-head">
                      <span>${slot.title}</span>
                      <span>Leer</span>
                    </div>
                    <div style="font-size:10.5px; color:var(--text-muted);">Klasse: ${activeRoleInfo.label}</div>
                  </div>
                `;
              }
            }

            html += `</div></div>`;

            // Verfügbares Gear-Inventar (gefiltert nach Helden-Klasse oder alle)
            const rarityRank = { gold: 0, purple: 1, blue: 2, green: 3, grey: 4 };
            const matchingBag = bag
              .filter((it) => gearBagShowAll || it.role === activeRoleKey)
              .sort((a, b) => (rarityRank[a.rarity] ?? 5) - (rarityRank[b.rarity] ?? 5) || (b.bonus || 0) - (a.bonus || 0));

            html += `
              <div class="hero-card" style="--rarity-col:rgba(214,158,92,0.55);">
                <div class="hero-name-row" style="margin-bottom:2px;">
                  <span style="font-size:12.5px; font-weight:700; color:#fde68a;">
                    ${gearBagShowAll ? `Gesamter Ausrüstungs-Rucksack (${matchingBag.length})` : `Verfügbar für ${activeRoleInfo.label} (${matchingBag.length})`}
                  </span>
                  <button class="jump-btn" data-gear-toggle-all="1">
                    ${gearBagShowAll ? `Nur ${activeRoleInfo.label}` : `Alle Klassen (${bag.length})`}
                  </button>
                </div>
                <div class="gear-bag-list">
            `;

            if (matchingBag.length === 0) {
              html += `
                <div style="font-size:11.5px; color:var(--text-muted); padding:6px 2px; line-height:1.4;">
                  Keine ungenutzte ${activeRoleInfo.label}-Ausrüstung im Rucksack. Öffne Ausrüstungskisten oder sende Späher in die Wildnis!
                </div>
              `;
            } else {
              for (const item of matchingBag) {
                const roleInfo = GEAR_ROLE_INFO[item.role] || GEAR_ROLE_INFO.melee;
                const slotObj = GEAR_SLOTS.find((s) => s.key === item.slot);
                const rMeta = GEAR_RARITY_MAP[item.rarity] || GEAR_RARITIES[0];
                const matchesHero = item.role === activeRoleKey && activeState.unlocked;
                html += `
                  <div class="gear-bag-item gear-rarity-${item.rarity}">
                    <div class="gear-bag-meta">
                      <div class="gear-bag-name">${item.name}</div>
                      <div class="gear-bag-sub">
                        <span class="gear-role-tag ${roleInfo.cssClass}">${roleInfo.label}</span>
                        <span>${slotObj ? slotObj.title : item.slot}</span>
                        <span class="mono" style="color:#fde68a;">${item.stat}</span>
                      </div>
                    </div>
                    <div class="gear-bag-btns">
                      <button
                        class="gear-slot-btn"
                        data-gear-equip="${activeHero.id}|${item.id}"
                        ${matchesHero ? '' : 'disabled'}
                      >
                        ${!activeState.unlocked ? 'Gesperrt' : item.role === activeRoleKey ? 'Anlegen' : roleInfo.label}
                      </button>
                      <button class="gear-slot-btn dismantle" data-gear-dismantle="${item.id}">
                        +${rMeta.xpValue} XP
                      </button>
                    </div>
                  </div>
                `;
              }
            }

            html += `</div></div>`;
            container.innerHTML = html;
            return;
          }

          // Standard-Ansicht: Helden-Übersicht & Aufwertung
          const filters = [
            { id: 'all', label: `Alle (${HEROES_LIST.length})` },
            { id: 'unlocked', label: `Aktiv (${unlockedCount})` },
            { id: 'Tank', label: 'Tank' },
            { id: 'Fernkampf', label: 'Fernkampf' },
            { id: 'Nahkampf', label: 'Nahkampf' }
          ];

          html += `
            <div class="stat-grid" style="margin-bottom:10px;">
              <div class="stat-box">
                <div class="stat-label">Stammes-Macht (Helden + Gear + Truppen)</div>
                <div class="stat-value" style="color:#fbbf24;">${fmtNum(totalPower)} <span style="font-size:10.5px;color:var(--text-muted);font-weight:500;">(Truppen ${fmtNum(troopPower)})</span></div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Verfügbare Helden-XP</div>
                <div class="stat-value" style="color:#60a5fa;">${fmtNum(heroXp)} XP</div>
              </div>
            </div>
            <button class="btn-primary" style="margin-bottom:12px;" data-goto-cave="1">
              Heldenhöhle öffnen · ${bones} Knochen · ${goldenBones} Gold
            </button>
            <div class="filter-row" role="tablist">
              ${filters
                .map((f) => `<button class="filter-btn ${heroFilter === f.id ? 'active' : ''}" data-hero-filter="${f.id}">${f.label}</button>`)
                .join('')}
            </div>
            <div class="card-list">
          `;

          const rarityOrder = { legendary: 0, epic: 1, rare: 2 };
          const filtered = HEROES_LIST.filter((h) => {
            const hs = state.heroes && state.heroes[h.id];
            if (heroFilter === 'unlocked') return hs && hs.unlocked;
            if (heroFilter === 'Tank' || heroFilter === 'Fernkampf' || heroFilter === 'Nahkampf') return h.role === heroFilter;
            return true;
          }).sort((a, b) => {
            const ha = (state.heroes && state.heroes[a.id]) || { unlocked: false };
            const hb = (state.heroes && state.heroes[b.id]) || { unlocked: false };
            if (ha.unlocked !== hb.unlocked) return ha.unlocked ? -1 : 1;
            return rarityOrder[a.rarity] - rarityOrder[b.rarity];
          });

          if (!filtered.length) {
            html += `<div class="stat-box"><p class="info-line">Keine Helden in dieser Kategorie.</p></div>`;
          }

          for (const hero of filtered) {
            const hs = (state.heroes && state.heroes[hero.id]) || {
              unlocked: false,
              level: 1,
              stars: 1,
              shards: 0,
              equipped: createEmptyEquipped()
            };
            const rMeta = RARITY_META[hero.rarity];
            const bonusPct = getHeroEffectiveBonusPct(hero, hs);
            const power = getHeroPower(hero, hs);
            const gearCount = getHeroEquippedCount(hs);
            const starsStr = hs.unlocked ? '★'.repeat(hs.stars) + '☆'.repeat(5 - hs.stars) : 'Noch nicht rekrutiert';
            const lvlCost = getHeroLevelCost(hs.level);
            const shardReq = hs.unlocked ? getHeroStarShardCost(hs.stars) : 10;

            const pipsHtml = hs.unlocked
              ? `<div class="hero-gear-pips">
                  ${GEAR_SLOTS.map((s) => {
                    const eq = hs.equipped && hs.equipped[s.key];
                    return `<span class="hero-gear-pip ${eq ? `filled gear-rarity-${eq.rarity}` : ''}" title="${s.title}">${s.short}</span>`;
                  }).join('')}
                  <span style="font-size:10px;color:var(--text-muted);margin-left:2px;">Gear ${gearCount}/4</span>
                </div>`
              : '';

            const skillSum = getHeroSkillTotalLevels(hs);
            let actionsHtml = '';
            if (hs.unlocked) {
              const canLvl = hs.level < 50 && heroXp >= lvlCost;
              const canAsc = hs.stars < 5 && hs.shards >= shardReq;
              actionsHtml = `
                <button class="btn-primary" data-hero-levelup="${hero.id}" ${canLvl ? '' : 'disabled'}>
                  ${hs.level >= 50 ? 'Max Level' : `Level +1 (${lvlCost} XP)`}
                </button>
                <button class="btn-secondary" data-hero-ascend="${hero.id}" ${canAsc ? '' : 'disabled'}>
                  ${hs.stars >= 5 ? '5★ Max' : `Stern +1 (${hs.shards}/${shardReq})`}
                </button>
                <button class="btn-secondary" data-hero-open-skills="${hero.id}">
                  Fähigkeiten (${skillSum}/36)
                </button>
                <button class="btn-secondary" data-hero-open-gear="${hero.id}">
                  Ausrüstung (${gearCount}/4)
                </button>
              `;
            } else if (hs.shards >= 10) {
              actionsHtml = `
                <button class="btn-primary" data-hero-ascend="${hero.id}">
                  Mit 10 Splittern freischalten!
                </button>
              `;
            } else {
              actionsHtml = `
                <button class="btn-secondary" data-goto-cave="1">
                  In Heldenhöhle ziehen (${hs.shards}/10 Splitter)
                </button>
              `;
            }

            html += `
              <div class="hero-card ${hs.unlocked ? '' : 'locked'}" style="--rarity-col:${rMeta.color};">
                <div class="hero-top">
                  <div class="hero-avatar">${getHeroRoleIconSVG(hero.role, rMeta.color)}</div>
                  <div class="hero-info">
                    <div class="hero-name-row">
                      <span class="hero-name">${hero.name}</span>
                      <span class="hero-rarity-tag">${rMeta.label} · ${hero.role}</span>
                    </div>
                    <div class="hero-stars">${starsStr}${hs.unlocked ? ` · <span class="mono" style="color:var(--text-secondary);">Lv.${hs.level} · Macht ${fmtNum(power)}</span>` : ''}</div>
                    <div class="hero-bonus-text" style="margin-top:3px; color:#fde68a;">${hero.bonusLabel(bonusPct)}</div>
                    ${pipsHtml}
                  </div>
                </div>
                <div class="hero-bonus-text">${hero.lore}</div>
                <div class="hero-actions">${actionsHtml}</div>
              </div>
            `;
          }

          html += `</div>`;
          container.innerHTML = html;
        }

        function renderInventoryTab() {
          const container = document.getElementById('inventoryContainer');
          if (!container) return;

          const inv = state.inventory || {};
          const bag = Array.isArray(state.equipmentBag) ? state.equipmentBag : [];
          const filters = [
            { id: 'all', label: 'Alle' },
            { id: 'gear', label: `Ausrüstung (${(inv.gearChest || 0) + bag.length})` },
            { id: 'bones', label: 'Knochen & Totems' },
            { id: 'resources', label: 'Ressourcen' },
            { id: 'boosts', label: 'Beschleuniger' }
          ];

          const totalCrates = (inv.crateMeat || 0) + (inv.crateWood || 0) + (inv.crateStone || 0) + (inv.crateFur || 0);
          const totalBoosts = (inv.speedup5m || 0) + (inv.speedup15m || 0);

          let html = `
            <div class="section-head">
              <h2 class="section-title">Stammes-Inventar</h2>
              <p class="section-sub">Öffne Ausrüstungskisten, nutze Schamanen-Totems zur Wiederbelebung gefallener Krieger und verwalte Pakete sowie Beschleuniger.</p>
            </div>
            <div class="summary-strip">
              <span>Kisten: <strong class="mono" style="color:#fbbf24;">${inv.gearChest || 0}</strong> · Gear: <strong class="mono" style="color:#86efac;">${bag.length}</strong> · Totems: <strong class="mono" style="color:#2dd4bf;">${inv.shamanTotem || 0}</strong></span>
              <span>Knochen: <strong class="mono" style="color:#fde68a;">${inv.bones || 0}</strong> · Pakete: <strong class="mono">${totalCrates}</strong> · Boosts: <strong class="mono">${totalBoosts}</strong></span>
            </div>
            <div class="filter-row" role="tablist">
              ${filters
                .map((f) => `<button class="filter-btn ${invFilter === f.id ? 'active' : ''}" data-inv-filter="${f.id}">${f.label}</button>`)
                .join('')}
            </div>
            <div class="inv-grid">
          `;

          const list = INVENTORY_ITEMS.filter((it) => invFilter === 'all' || it.category === invFilter);

          for (const item of list) {
            const qty = inv[item.id] || 0;
            let btnHtml = '';
            let extraMetaHtml = '';
            if (item.actionType === 'open_gear_chest') {
              btnHtml = `
                <button class="inv-use-btn" data-inv-use="${item.id}" ${qty > 0 ? '' : 'disabled'}>Öffnen</button>
                ${qty > 1 ? `<button class="inv-use-btn secondary" data-inv-use-all="${item.id}">Alle (${Math.min(qty, 10)})</button>` : ''}
              `;
            } else if (item.actionType === 'open_crate') {
              btnHtml = `
                <button class="inv-use-btn" data-inv-use="${item.id}" ${qty > 0 ? '' : 'disabled'}>Öffnen</button>
                ${qty > 1 ? `<button class="inv-use-btn secondary" data-inv-use-all="${item.id}">Alle (${qty})</button>` : ''}
              `;
            } else if (item.actionType === 'speedup') {
              const hasActiveTimer = Boolean(state.activeBuild || state.activeResearch || state.activeTraining || state.activeHealing);
              btnHtml = `
                <button class="inv-use-btn" data-inv-use="${item.id}" ${qty > 0 && hasActiveTimer ? '' : 'disabled'}>
                  ${hasActiveTimer ? 'Einsetzen' : 'Kein Timer'}
                </button>
              `;
            } else if (item.actionType === 'teleport') {
              btnHtml = `<button class="inv-use-btn" data-inv-use="${item.id}" ${qty > 0 ? '' : 'disabled'}>Weltkarte</button>`;
            } else if (item.actionType === 'goto_skills') {
              btnHtml = `<button class="inv-use-btn" data-inv-use="${item.id}">Fähigkeiten</button>`;
            } else if (item.actionType === 'goto_cave') {
              btnHtml = `<button class="inv-use-btn" data-inv-use="${item.id}">Heldenhöhle</button>`;
            } else if (item.actionType === 'use_shaman_totem') {
              const totemStatus = ShamanTotemSystem.getStatus(state);
              if (!totemStatus.graveyardVisible) {
                const missingText = BuildingRegistry.getMissingRequirementsText('graveyard', state);
                extraMetaHtml = `<div class="inv-desc" style="color:#fbbf24; margin-top:3px;">Friedhof gesperrt · Benötigt: ${missingText}</div>`;
                btnHtml = `<button class="inv-use-btn secondary" data-inv-use="${item.id}" title="Benötigt: ${missingText}">Gesperrt</button>`;
              } else if (!totemStatus.graveyardBuilt) {
                extraMetaHtml = `<div class="inv-desc" style="color:#fbbf24; margin-top:3px;">Friedhof noch nicht errichtet${totemStatus.totalFallen > 0 ? ` · ${totemStatus.totalFallen} Gefallene warten` : ''}</div>`;
                btnHtml = `<button class="inv-use-btn secondary" data-inv-use="${item.id}">Friedhof bauen</button>`;
              } else {
                extraMetaHtml = `<div class="inv-desc" style="color:${totemStatus.totalFallen > 0 ? '#5eead4' : 'var(--text-muted)'}; margin-top:3px;">Friedhof St. ${totemStatus.graveyardLevel} · ${totemStatus.totalFallen} Gefallene · 1 Totem → bis ${totemStatus.revivePerTotem} Einh.</div>`;
                if (totemStatus.canRevive) {
                  btnHtml = `
                    <button class="inv-use-btn" data-inv-use="${item.id}">Einsetzen</button>
                    <button class="inv-use-btn secondary" data-inv-use-all="${item.id}">
                      ${totemStatus.usableTotemsForAll > 1 ? `Alle (${totemStatus.usableTotemsForAll}×)` : 'Sofort (1×)'}
                    </button>
                  `;
                } else if (totemStatus.totems <= 0) {
                  btnHtml = `<button class="inv-use-btn" data-inv-use="${item.id}" disabled>Kein Totem</button>`;
                } else {
                  btnHtml = `<button class="inv-use-btn" data-inv-use="${item.id}" disabled>0 Gefallene</button>`;
                }
              }
            } else if (item.actionType === 'goto_heroes') {
              btnHtml = `<button class="inv-use-btn secondary" data-inv-use="${item.id}">Zu Helden</button>`;
            }

            html += `
              <div class="inv-card">
                <div class="inv-icon-box" style="--inv-accent:${item.accent};">
                  ${getInventoryIconSVG(item.id, item.accent)}
                  <span class="inv-qty">${fmtNum(qty)}</span>
                </div>
                <div class="inv-meta">
                  <div class="inv-name">${item.name}</div>
                  <div class="inv-desc">${item.desc}</div>
                  ${extraMetaHtml}
                </div>
                <div class="inv-btn-col">${btnHtml}</div>
              </div>
            `;
          }

          if (invFilter === 'all' || invFilter === 'gear') {
            html += `
              <div class="inv-card" style="flex-direction:column; align-items:stretch; gap:8px;">
                <div class="hero-name-row">
                  <div class="inv-name">Ausrüstungs-Rucksack (${bag.length} Teile)</div>
                  <button class="inv-use-btn secondary" data-goto-gear="1">An Helden anlegen</button>
                </div>
                ${
                  bag.length === 0
                    ? `<div class="inv-desc">Noch keine ungenutzte Klassen-Ausrüstung im Rucksack. Öffne oben eine Ausrüstungskiste!</div>`
                    : `<div class="gear-bag-list">
                        ${bag
                          .slice(0, 8)
                          .map((g) => {
                            const rInfo = GEAR_ROLE_INFO[g.role] || GEAR_ROLE_INFO.melee;
                            const sInfo = GEAR_SLOTS.find((s) => s.key === g.slot);
                            return `
                              <div class="gear-bag-item gear-rarity-${g.rarity}">
                                <div class="gear-bag-meta">
                                  <div class="gear-bag-name">${g.name}</div>
                                  <div class="gear-bag-sub">
                                    <span class="gear-role-tag ${rInfo.cssClass}">${rInfo.label}</span>
                                    <span>${sInfo ? sInfo.title : g.slot}</span>
                                    <span class="mono" style="color:#fde68a;">${g.stat}</span>
                                  </div>
                                </div>
                                <button class="gear-slot-btn" data-goto-gear="1">Ausrüsten</button>
                              </div>
                            `;
                          })
                          .join('')}
                        ${bag.length > 8 ? `<div class="inv-desc" style="text-align:center;">+ ${bag.length - 8} weitere Teile im Helden-Reiter</div>` : ''}
                      </div>`
                }
              </div>
            `;
          }

          html += `</div>`;
          container.innerHTML = html;
        }

        function buildHeroCaveSummonHTML() {
          const inv = state.inventory || {};
          const bones = inv.bones || 0;
          const golden = inv.goldenBones || 0;
          const rawLvl = state.buildings.hero_cave.level;
          if (rawLvl <= 0) {
            return `
              <div class="gate-notice" style="margin-bottom:0;">
                <p class="gate-notice-title">Heldenhöhle noch nicht errichtet</p>
                <p class="gate-notice-desc">Wechsle oben auf „Gebäude &amp; Ausbau“, um die Heldenhöhle zuerst zu errichten.</p>
              </div>
            `;
          }
          const caveLvl = Math.max(1, rawLvl);
          const now = Date.now();
          const freeRem = Math.max(0, Math.ceil(((state.heroCaveFreeAt || 0) - now) / 1000));
          const freeReady = freeRem <= 0;

          let html = `
            <p class="info-line">Opfere Urzeit-Knochen oder Goldene Knochen am Altar der Heldenhöhle (Stufe ${caveLvl}). Du kannst Helden, Helden-Splitter, <strong>Ausrüstungskisten</strong> oder reine Ressourcen-Funde erhalten.</p>
            <div class="stat-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div class="stat-label">Gratis-Knochenfund (Höhle St. ${caveLvl})</div>
                <div class="stat-value" style="font-size:12.5px;color:${freeReady ? '#4ade80' : 'var(--text-secondary)'};">
                  ${freeReady ? 'Bereit zum Einsammeln (+1 Knochen)' : `Nächster Fund in ${fmtClock(freeRem)}`}
                </div>
              </div>
              <button class="inv-use-btn" data-claim-free-bone="1" ${freeReady ? '' : 'disabled'}>${freeReady ? 'Abholen' : 'Lädt...'}</button>
            </div>

            <div class="summon-banner" style="--banner-accent:rgba(214, 158, 92, 0.55);">
              <div class="summon-head">
                <span class="summon-title">
                  ${getInventoryIconSVG('bones', '#e7e5e4')}
                  <span>Knochen-Beschwörung</span>
                </span>
                <span class="summon-stock">${bones} Knochen</span>
              </div>
              <div class="summon-odds">
                Chancen: <strong>55 % Ressourcen & Ausrüstungskisten</strong> · 33 % Seltener Held · 12 % Epischer Held.
              </div>
              <div class="summon-btn-row">
                <button class="btn-secondary" data-summon-banner="normal" data-summon-count="1" ${bones >= 1 ? '' : 'disabled'}>1× Ziehen (1 Kn.)</button>
                <button class="btn-primary" data-summon-banner="normal" data-summon-count="5" ${bones >= 5 ? '' : 'disabled'}>5× Ziehen (5 Kn.)</button>
              </div>
            </div>

            <div class="summon-banner golden">
              <div class="summon-head">
                <span class="summon-title" style="color:#fef08a;">
                  ${getInventoryIconSVG('goldenBones', '#facc15')}
                  <span>Goldene Beschwörung</span>
                </span>
                <span class="summon-stock" style="color:#facc15;">${golden} Gold</span>
              </div>
              <div class="summon-odds">
                Chancen: <strong>35 % Große Funde</strong> (2× Ausrüstungskisten, Pakete, Boosts) · 40 % Epischer Held · <strong style="color:#fde047;">25 % Legendärer Held</strong>.
              </div>
              <div class="summon-btn-row">
                <button class="btn-secondary" data-summon-banner="golden" data-summon-count="1" ${golden >= 1 ? '' : 'disabled'}>1× Ziehen (1 Gold)</button>
                <button class="btn-primary" data-summon-banner="golden" data-summon-count="5" ${golden >= 5 ? '' : 'disabled'}>5× Ziehen (5 Gold)</button>
              </div>
            </div>
          `;

          if (lastSummonResults && lastSummonResults.length > 0) {
            html += `
              <div class="summon-results-box">
                <div class="summon-head">
                  <span style="font-size:12.5px;font-weight:700;color:#fde68a;">Letzte Ziehung (${lastSummonResults.length}×)</span>
                  <button class="jump-btn" data-clear-summon="1">Ausblenden</button>
                </div>
                <div class="summon-result-grid">
                  ${lastSummonResults
                    .map(
                      (r) => `
                    <div class="pull-card" style="--pull-col:${r.color};">
                      <span class="pull-card-type">${r.typeLabel}</span>
                      <span class="pull-card-title">${r.title}</span>
                      <span class="pull-card-sub">${r.sub}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>
            `;
          }

          return html;
        }

        function buildBarracksTrainHTML(troopType) {
          const def = TROOP_DEFS[troopType];
          const bState = state.buildings[troopType];
          const count = (state.troops && state.troops[troopType]) || 0;
          const bLvl = bState ? bState.level : 0;
          const batch = def.batchSize + Math.floor(Math.max(0, bLvl - 1) * 1.5);
          const dur = Math.max(12, Math.round(def.durationSec / (1 + Math.max(0, bLvl - 1) * 0.08)));
          const now = Date.now();
          const isThisTraining = state.activeTraining && state.activeTraining.troopType === troopType;

          let html = `
            <p class="info-line">${BUILDINGS[troopType].desc}</p>
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Ausgebildete ${def.name}</div>
                <div class="stat-value">${fmtNum(count)} (${def.role})</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Kampfkraft dieser Einheit</div>
                <div class="stat-value" style="color:#fbbf24;">${fmtNum(count * def.powerPerUnit)} (${def.powerPerUnit}/Einh.)</div>
              </div>
            </div>
            <div>
              <p class="sheet-section-title">Ausbildungskosten für ${batch}× ${def.name} (${fmtDuration(dur)})</p>
              <div class="cost-grid">
                ${Object.entries(def.cost)
                  .map(([res, amt]) => {
                    const have = Math.floor(state.resources[res] || 0);
                    return `
                      <div class="cost-item ${have >= amt ? 'enough' : 'short'}">
                        <span>${RESOURCE_LABELS[res]}</span>
                        <span class="cost-nums">${fmtNum(have)} / ${fmtNum(amt)}</span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `;

          if (isThisTraining) {
            const total = Math.max(1, (state.activeTraining.endsAt - state.activeTraining.startedAt) / 1000);
            const rem = Math.max(0, (state.activeTraining.endsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
            html += `
              <div>
                <div class="queue-title"><span>Ausbildung (${state.activeTraining.count}× ${def.name}) läuft...</span><span class="mono">${fmtClock(rem)}</span></div>
                <div class="prog-bar"><div class="prog-fill" style="width:${pct.toFixed(1)}%"></div></div>
              </div>
            `;
          } else {
            const busyOther = Boolean(state.activeTraining);
            const affordable = canAfford(def.cost);
            const enabled = bLvl > 0 && !busyOther && affordable;
            const btnLabel =
              bLvl <= 0
                ? 'Gebäude zuerst errichten'
                : busyOther
                ? 'Andere Ausbildung aktiv'
                : !affordable
                ? 'Ressourcen fehlen'
                : `${batch}× ${def.name} ausbilden (${fmtDuration(dur)})`;
            html += `<button class="btn-primary" data-train-troop="${troopType}" ${enabled ? '' : 'disabled'}>${btnLabel}</button>`;
          }

          return html;
        }

        function buildInfirmaryHTML() {
          const bState = state.buildings.infirmary;
          const lvl = bState ? bState.level : 0;
          if (lvl <= 0) {
            return `
              <div class="gate-notice" style="margin-bottom:0;">
                <p class="gate-notice-title">Krankenzelt noch nicht errichtet</p>
                <p class="gate-notice-desc">Wechsle oben auf „Gebäude &amp; Ausbau“, um das Krankenzelt zu errichten und verletzte Einheiten vor dem Tod zu bewahren.</p>
              </div>
            `;
          }
          const now = Date.now();
          const cap = getInfirmaryCapacity(lvl);
          const injured = state.injuredTroops || { slinger: 0, clubman: 0, dinorider: 0 };
          const plan = getHealingCostAndDuration();
          const healingCnt = state.activeHealing ? state.activeHealing.totalCount || 0 : 0;
          const usedBeds = plan.total + healingCnt;
          const speedBonusPct = Math.round((lvl - 1) * 10 + (bState.workers || 0) * 15);

          let html = `
            <p class="info-line">Verletzte Einheiten aus Dinojagden und Gefechten werden automatisch im Krankenzelt aufgenommen, solange freie Betten vorhanden sind. Einheiten über dem Limit landen auf dem Friedhof.</p>
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Belegte Betten</div>
                <div class="stat-value mono" style="color:${usedBeds >= cap ? '#f87171' : usedBeds > 0 ? '#fbbf24' : '#4ade80'};">${usedBeds} / ${cap}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Heiltempo-Bonus</div>
                <div class="stat-value mono" style="color:#4ade80;">+${speedBonusPct} % (${bState.workers || 0} Heiler)</div>
              </div>
            </div>
          `;

          if (state.activeHealing) {
            const total = Math.max(1, (state.activeHealing.endsAt - state.activeHealing.startedAt) / 1000);
            const rem = Math.max(0, (state.activeHealing.endsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
            html += `
              <div class="stat-box">
                <div class="queue-title"><span>Heilung von ${state.activeHealing.totalCount} Einheiten läuft...</span><span class="mono">${fmtClock(rem)}</span></div>
                <div class="prog-bar"><div class="prog-fill done" style="width:${pct.toFixed(1)}%"></div></div>
                ${
                  rem <= FREE_FINISH_SEC
                    ? `<button class="btn-primary" style="margin-top:10px; background:var(--state-ok); color:#052e16;" data-free-heal="1">Gratis sofort heilen</button>`
                    : ''
                }
              </div>
            `;
          }

          html += `
            <div>
              <p class="sheet-section-title">Verletzte Einheiten im Lazarett (${plan.total})</p>
              <div class="hunt-troop-list">
                ${Object.values(TROOP_DEFS)
                  .map((td) => {
                    const cnt = injured[td.id] || 0;
                    return `
                      <div class="hunt-troop-row">
                        <div>
                          <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${td.name}</div>
                          <div style="font-size:10.5px; color:var(--text-muted);">${td.role}</div>
                        </div>
                        <span class="mono" style="font-size:12.5px; font-weight:700; color:${cnt > 0 ? '#fbbf24' : 'var(--text-muted)'};">${cnt} verletzt</span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `;

          if (!state.activeHealing) {
            if (plan.total > 0) {
              html += `
                <div>
                  <p class="sheet-section-title">Heilkosten &amp; Dauer (${fmtDuration(plan.durationSec)})</p>
                  <div class="cost-grid">
                    ${Object.entries(plan.cost)
                      .map(([res, amt]) => {
                        const have = Math.floor(state.resources[res] || 0);
                        return `
                          <div class="cost-item ${have >= amt ? 'enough' : 'short'}">
                            <span>${RESOURCE_LABELS[res]}</span>
                            <span class="cost-nums">${fmtNum(have)} / ${fmtNum(amt)}</span>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>
                </div>
                <button class="btn-primary" data-start-heal="1" ${canAfford(plan.cost) ? '' : 'disabled'}>
                  ${canAfford(plan.cost) ? `Alle ${plan.total} Einheiten heilen (${fmtDuration(plan.durationSec)})` : 'Ressourcen fehlen'}
                </button>
              `;
            } else {
              html += `<div class="req-row met"><div class="req-main"><span class="req-mark">✓</span><span>Alle Einheiten sind wohlauf — keine Verletzten im Krankenzelt.</span></div></div>`;
            }
          }

          return html;
        }

        function buildGraveyardHTML() {
          const bState = state.buildings.graveyard;
          const lvl = bState ? bState.level : 0;
          if (lvl <= 0) {
            return `
              <div class="gate-notice" style="margin-bottom:0;">
                <p class="gate-notice-title">Friedhof noch nicht errichtet</p>
                <p class="gate-notice-desc">Wechsle oben auf „Gebäude &amp; Ausbau“, um den Friedhof zu errichten und gefallene Krieger mit einem Schamanen-Totem wiederzuerwecken.</p>
              </div>
            `;
          }
          const status = ShamanTotemSystem.getStatus(state);
          const fallen = status.fallen;
          const totalFallen = status.totalFallen;
          const totems = status.totems;
          const reviveCap = status.revivePerTotem;
          const canRevive = status.canRevive;

          return `
            <p class="info-line">Gefallene Einheiten, die nicht mehr im Krankenzelt aufgenommen werden konnten, finden hier ihre Ruhe. Opfere ein <strong>Schamanen-Totem</strong>, um bis zu <strong>${reviveCap} gefallene Krieger</strong> sofort wiederzuerwecken.</p>
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Gefallene Krieger</div>
                <div class="stat-value mono" style="color:${totalFallen > 0 ? '#f87171' : '#4ade80'};">${totalFallen} Einheiten</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Schamanen-Totems</div>
                <div class="stat-value mono" style="color:#2dd4bf;">${totems} verfügbar</div>
              </div>
            </div>
            <div>
              <p class="sheet-section-title">Gefallene Einheiten auf dem Friedhof</p>
              <div class="hunt-troop-list">
                ${Object.values(TROOP_DEFS)
                  .map((td) => {
                    const cnt = fallen[td.id] || 0;
                    return `
                      <div class="hunt-troop-row">
                        <div>
                          <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${td.name}</div>
                          <div style="font-size:10.5px; color:var(--text-muted);">${td.role}</div>
                        </div>
                        <span class="mono" style="font-size:12.5px; font-weight:700; color:${cnt > 0 ? '#f87171' : 'var(--text-muted)'};">${cnt} gefallen</span>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
            <div class="summon-banner" style="--banner-accent:rgba(45, 212, 191, 0.5);">
              <div class="summon-head">
                <span class="summon-title" style="color:#5eead4;">
                  ${getInventoryIconSVG('shamanTotem', '#2dd4bf')}
                  <span>Ritual der Wiedererweckung</span>
                </span>
                <span class="summon-stock" style="color:#2dd4bf;">1 Totem → bis ${reviveCap} Einh.</span>
              </div>
              <div class="summon-odds">
                Stärkste Einheiten (Dinoreiter → Keulenschwinger → Steinschleuderer) werden zuerst erweckt — oder wähle gezielt über das Totem-Ritual. Schamanen-Totems findest du als Beute bei der Dinojagd und kannst sie direkt im Inventar einsetzen.
              </div>
              <button class="btn-primary" style="margin-top:8px;" data-revive-fallen="1" ${canRevive ? '' : 'disabled'}>
                ${totalFallen <= 0 ? 'Keine gefallenen Einheiten' : totems <= 0 ? 'Kein Schamanen-Totem vorhanden' : `Mit 1× Schamanen-Totem wiedererwecken (bis ${Math.min(totalFallen, reviveCap)})`}
              </button>
              ${
                canRevive
                  ? `<div class="btn-row" style="margin-top:6px;">
                      <button class="btn-secondary" data-open-totem-ritual="1">Gezielt wählen</button>
                      ${
                        status.usableTotemsForAll > 1
                          ? `<button class="btn-secondary" data-totem-cast-all="1">Alle erwecken (${status.usableTotemsForAll}× Totems)</button>`
                          : ''
                      }
                    </div>`
                  : ''
              }
            </div>
          `;
        }

        function buildMarketplaceHTML() {
          const bState = state.buildings.marketplace;
          const lvl = bState ? bState.level : 0;
          if (lvl <= 0) {
            return `
              <div class="gate-notice" style="margin-bottom:0;">
                <p class="gate-notice-title">Marktplatz noch nicht errichtet</p>
                <p class="gate-notice-desc">Wechsle oben auf „Gebäude &amp; Ausbau“, um den Marktplatz zu errichten und alle 12 Stunden kostenlos 300 Ausdauer abzuholen.</p>
              </div>
            `;
          }
          const now = Date.now();
          tickStaminaRegen(now);
          const remSec = Math.max(0, Math.ceil(((state.marketClaimAt || 0) - now) / 1000));
          const claimReady = remSec <= 0;
          const curStamina = Math.floor(state.stamina || 0);
          const regenSec = Math.round(getStaminaRegenIntervalMs() / 1000);

          return `
            <p class="info-line">Die Stammes-Händler versorgen deine Jäger alle <strong>12 Stunden</strong> mit <strong>${MARKET_STAMINA_REWARD} kostenloser Ausdauer</strong> für Weltkarten-Dinojagden (${DINO_HUNT_STAMINA_COST} Ausdauer pro Jagd).</p>
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Aktuelle Jagd-Ausdauer</div>
                <div class="stat-value mono" style="color:#fbbf24;">${curStamina} / ${STAMINA_REGEN_CAP} <span style="font-size:10px; color:var(--text-muted);">(Max ${STAMINA_HARD_CAP})</span></div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Passive Regeneration</div>
                <div class="stat-value mono" style="color:#4ade80;">+1 alle ${fmtDuration(regenSec)}</div>
              </div>
            </div>
            <div class="summon-banner" style="--banner-accent:rgba(245, 158, 11, 0.55);">
              <div class="summon-head">
                <span class="summon-title" style="color:#fde68a;">
                  <span>⚡ Gratis-Ausdauer-Lieferung</span>
                </span>
                <span class="summon-stock" style="color:${claimReady ? '#4ade80' : '#fbbf24'};">${claimReady ? 'Bereit!' : fmtClock(remSec)}</span>
              </div>
              <div class="summon-odds">
                Gewährt alle 12 Stunden kostenlos <strong>+${MARKET_STAMINA_REWARD} Ausdauer</strong> (entspricht ${Math.floor(MARKET_STAMINA_REWARD / DINO_HUNT_STAMINA_COST)} Dinojagden auf der Weltkarte).
              </div>
              <button class="btn-primary" style="margin-top:8px;" data-claim-market-stamina="1" ${claimReady ? '' : 'disabled'}>
                ${claimReady ? `Kostenlos +${MARKET_STAMINA_REWARD} Ausdauer abholen` : `Nächste Lieferung in ${fmtClock(remSec)}`}
              </button>
            </div>
          `;
        }

        function buildWarehouseHTML() {
          const bState = state.buildings.warehouse;
          const lvl = bState ? bState.level : 0;
          if (lvl <= 0) {
            return `
              <div class="gate-notice" style="margin-bottom:0;">
                <p class="gate-notice-title">Lagerhaus noch nicht errichtet</p>
                <p class="gate-notice-desc">Wechsle oben auf „Gebäude &amp; Ausbau“, um das Lagerhaus zu errichten und deine Vorräte vor Plünderungen zu schützen.</p>
              </div>
            `;
          }
          const caps = getWarehouseSafeCaps(lvl);
          const nextCaps = lvl < MAX_LEVEL ? getWarehouseSafeCaps(lvl + 1) : null;
          const resKeys = ['meat', 'wood', 'stone', 'fur'];

          return `
            <p class="info-line">Das verstärkte Basalt-Lagerhaus (Stufe ${lvl}) schützt deine Vorräte mit einer festen <strong>Safe-Kapazität</strong>. Geschützte Mengen können bei künftigen Multiplayer-Angriffen <strong>nicht geplündert</strong> werden.</p>
            <div class="hunt-troop-list">
              ${resKeys
                .map((rk) => {
                  const stock = Math.floor(state.resources[rk] || 0);
                  const safeCap = caps[rk];
                  const protectedAmt = Math.min(stock, safeCap);
                  const exposedAmt = Math.max(0, stock - safeCap);
                  const pct = safeCap > 0 ? Math.min(100, (protectedAmt / safeCap) * 100) : 0;
                  const nextNote = nextCaps ? ` → St. ${lvl + 1}: ${fmtNum(nextCaps[rk])}` : '';
                  return `
                    <div class="stat-box" style="display:flex; flex-direction:column; gap:5px;">
                      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="font-size:12px; font-weight:700; color:${RESOURCE_COLORS[rk]};">${RESOURCE_LABELS[rk]}</span>
                        <span class="mono" style="font-size:11px; color:${exposedAmt > 0 ? '#fbbf24' : '#4ade80'}; font-weight:700;">
                          ${exposedAmt > 0 ? `${fmtNum(exposedAmt)} plünderbar` : '100 % geschützt'}
                        </span>
                      </div>
                      <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-secondary);">
                        <span>Geschützt: <strong class="mono" style="color:var(--text-primary);">${fmtNum(protectedAmt)} / ${fmtNum(safeCap)}</strong></span>
                        <span class="mono" style="color:var(--text-muted);">Vorrat: ${fmtNum(stock)}${nextNote}</span>
                      </div>
                      <div class="prog-bar"><div class="prog-fill done" style="width:${pct.toFixed(1)}%"></div></div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          `;
        }

        function buildResearchTreeHTML() {
          const wsLvl = state.buildings.workshop.level;
          const shamans = state.buildings.workshop.workers;
          const heroResPct = Math.round(getHeroBonuses().research * 100);
          const now = Date.now();

          let html = `
            <p class="info-line" style="font-size:12px;">Werkstatt St. ${wsLvl} · Tempo: +${shamans * 8 + heroResPct} %${heroResPct > 0 ? ' (inkl. Helden)' : ''} · ${state.completedTechs.length}/${RESEARCH_LIST.length} erforscht</p>
          `;

          if (wsLvl === 0) {
            html += `
              <div class="gate-notice" style="margin-bottom:0;">
                <p class="gate-notice-title">Forschungszelt noch nicht errichtet</p>
                <p class="gate-notice-desc">Wechsle oben auf „Gebäude &amp; Ausbau“, um die Werkstatt / das Schamanen-Zelt zu errichten (erfordert Großes Signalfeuer Stufe 2).</p>
              </div>
            `;
          }

          if (state.activeResearch) {
            const rTech = RESEARCH_LIST.find((t) => t.id === state.activeResearch.techId);
            const total = Math.max(1, (state.activeResearch.endsAt - state.activeResearch.startedAt) / 1000);
            const rem = Math.max(0, (state.activeResearch.endsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
            html += `
              <div class="game-card state-running">
                <div class="card-top-row">
                  <div>
                    <p class="card-title">Läuft: ${rTech.name}</p>
                    <p class="card-effect">${rTech.effect}</p>
                  </div>
                  <span class="status-text running mono">${fmtClock(rem)}</span>
                </div>
                <div class="prog-bar"><div class="prog-fill" style="width:${pct.toFixed(1)}%"></div></div>
                ${
                  rem <= FREE_FINISH_SEC
                    ? `<div style="margin-top:10px;"><button class="free-finish-btn" data-action="free-research">Gratis fertigstellen</button></div>`
                    : ''
                }
              </div>
            `;
          }

          const tiers = [1, 2, 3, 4];
          for (const tier of tiers) {
            const techs = RESEARCH_LIST.filter((t) => t.tier === tier);
            const unlockedTier = wsLvl >= tier;
            html += `
              <div class="tier-block" style="margin-bottom:4px;">
                <div class="tier-label">
                  <span>Stufe ${tier} · Forschungszelt St. ${tier}</span>
                  <span style="color:${unlockedTier ? 'var(--state-ok)' : 'var(--text-muted)'}">${unlockedTier ? '✓ Freigeschaltet' : 'Gesperrt'}</span>
                </div>
                <div class="card-list">
            `;

            for (const tech of techs) {
              const info = evaluateResearchStatus(tech);
              const dur = getResearchDuration(tech);
              const costSummary = Object.entries(tech.cost)
                .map(([r, a]) => `${a} ${RESOURCE_LABELS[r]}`)
                .join(' · ');

              let progHtml = '';
              if (info.status === 'running' && state.activeResearch) {
                const total = Math.max(1, (state.activeResearch.endsAt - state.activeResearch.startedAt) / 1000);
                const rem = Math.max(0, (state.activeResearch.endsAt - now) / 1000);
                const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
                progHtml = `<div class="prog-bar"><div class="prog-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
              } else if (info.status === 'done') {
                progHtml = `<div class="prog-bar"><div class="prog-fill done" style="width:100%"></div></div>`;
              }

              html += `
                <button class="game-card state-${info.status}" data-tech="${tech.id}">
                  <div class="card-top-row">
                    <div class="card-title-wrap">
                      <div class="card-icon-box">${getTechIconSVG(tech.id)}</div>
                      <div>
                        <p class="card-title">${tech.name}</p>
                        <p class="card-effect">${tech.effect}</p>
                      </div>
                    </div>
                    <span class="status-text ${info.status}">${info.label}</span>
                  </div>
                  ${progHtml}
                  <div class="card-meta-row">
                    <span>${info.status === 'done' ? 'Dauerhafter Bonus aktiv' : costSummary}</span>
                    <span class="mono">${info.status === 'done' ? '✓ Aktiv' : fmtDuration(dur)}</span>
                  </div>
                </button>
              `;
            }

            html += `</div></div>`;
          }

          return html;
        }

        function renderWildernessTab() {
          const container = document.getElementById('wildernessContainer');
          const scoutLvl = state.buildings.scout.level;
          const maxExp = getMaxExpeditions();
          const freePop = getFreePop();
          const now = Date.now();

          const discoveredCount = DINO_SPECIES.filter((sp) => getBestiaryEntry(sp.id).discovered).length;
          const totalHunted = DINO_SPECIES.reduce((acc, sp) => acc + (getBestiaryEntry(sp.id).huntedCount || 0), 0);

          let html = `
            <div class="section-head">
              <h2 class="section-title">Wildnis &amp; Bestiarium</h2>
              <p class="section-sub">Expeditionen in die Dino-Wildnis &amp; Nachschlagewerk aller entdeckten Saurier</p>
            </div>
            <div class="sheet-tabs" role="tablist">
              <button class="sheet-tab-btn ${wildernessSubTab === 'expeditions' ? 'active' : ''}" data-wild-subtab="expeditions">
                Expeditionen (${state.activeExpeditions.length})
              </button>
              <button class="sheet-tab-btn ${wildernessSubTab === 'bestiary' ? 'active' : ''}" data-wild-subtab="bestiary">
                Dino-Bestiarium (${discoveredCount}/${DINO_SPECIES.length})
              </button>
            </div>
          `;

          if (wildernessSubTab === 'bestiary') {
            html += buildBestiarySubTabHTML(discoveredCount, totalHunted);
            container.innerHTML = html;
            return;
          }

          if (scoutLvl === 0) {
            html += `
              <div class="gate-notice">
                <p class="gate-notice-title">Späher-Posten erforderlich</p>
                <p class="gate-notice-desc">Errichte den Späher-Posten im Dorf (erfordert Jagdhütte Stufe 2), um Jäger auf Expeditionen auszurüsten.</p>
                <button class="btn-secondary" data-jump-building="scout">Zum Späher-Posten im Dorf</button>
              </div>
            `;
          } else {
            const healStr =
              state.pop.injured > 0
                ? ` · ${state.pop.injured} verletzt (${fmtClock((state.pop.injuryHealsAt - now) / 1000)})`
                : '';
            html += `
              <div class="summary-strip">
                <span>Späher-Posten St. ${scoutLvl} · Plätze: <strong class="mono">${state.activeExpeditions.length}/${maxExp}</strong></span>
                <span>Frei: <strong class="mono">${freePop}</strong>${healStr}</span>
              </div>
            `;
          }

          // Aktive Expeditionen
          if (state.activeExpeditions.length > 0) {
            html += `<div class="tier-block"><div class="tier-label"><span>Laufende &amp; abgeschlossene Expeditionen</span></div><div class="card-list">`;
            for (const exp of state.activeExpeditions) {
              const def = EXPEDITIONS.find((e) => e.id === exp.targetId);
              const total = Math.max(1, (exp.endsAt - exp.startedAt) / 1000);
              const rem = Math.max(0, (exp.endsAt - now) / 1000);
              const pct = exp.completed ? 100 : Math.min(100, Math.max(0, ((total - rem) / total) * 100));

              html += `
                <div class="game-card ${exp.completed ? 'state-done' : 'state-running'}">
                  <div class="card-top-row">
                    <div>
                      <p class="card-title">${def.name}</p>
                      <p class="card-effect">${exp.scouts} Späher unterwegs${exp.completed ? ' · Zurück im Lager' : ''}</p>
                    </div>
                    <span class="status-text ${exp.completed ? 'done' : 'running'} mono">${exp.completed ? 'Beute bereit' : fmtClock(rem)}</span>
                  </div>
                  <div class="prog-bar"><div class="prog-fill ${exp.completed ? 'done' : ''}" style="width:${pct.toFixed(1)}%"></div></div>
                  ${
                    exp.completed
                      ? `<div style="margin-top:11px;"><button class="btn-primary" data-collect-exp="${exp.id}">Beute einsammeln</button></div>`
                      : ''
                  }
                </div>
              `;
            }
            html += `</div></div>`;
          }

          // Verfügbare Ziele
          html += `<div class="tier-block"><div class="tier-label"><span>Expeditionsziele</span><span>${hasTech('nets') ? 'Schlingen & Netze aktiv (-20% Zeit)' : ''}</span></div><div class="card-list">`;

          for (const def of EXPEDITIONS) {
            const unlocked = scoutLvl >= def.reqScoutLevel;
            const dur = getExpeditionDuration(def);
            const riskPct = Math.round(getExpeditionRisk(def) * 100);
            const canSend = unlocked && state.activeExpeditions.length < maxExp && freePop >= def.scoutsNeeded;
            const lootPreview = Object.entries(def.loot)
              .map(([r, rng]) => `${RESOURCE_LABELS[r]} ${rng[0]}–${rng[1]}`)
              .join(' · ');

            html += `
              <div class="game-card ${unlocked ? '' : 'state-locked'}">
                <div class="card-top-row">
                  <div>
                    <p class="card-title">${def.name}</p>
                    <p class="card-effect">${def.desc}</p>
                  </div>
                  <span class="status-text ${unlocked ? 'ready' : 'locked'}">${unlocked ? fmtDuration(dur) : `Späher St. ${def.reqScoutLevel}`}</span>
                </div>
                <div class="exp-loot-line">${lootPreview}</div>
                <div class="exp-actions-row">
                  <span style="font-size:11.5px; color:var(--text-muted);">
                    ${def.scoutsNeeded} Späher · Risiko: <strong class="mono">${riskPct}%</strong> (${def.riskLabel})
                  </span>
                  ${
                    unlocked
                      ? `<button class="btn-secondary" data-send-exp="${def.id}" ${canSend ? '' : 'disabled'}>Entsenden</button>`
                      : `<button class="jump-btn" data-jump-building="scout">Späher St. ${def.reqScoutLevel}</button>`
                  }
                </div>
              </div>
            `;
          }

          html += `</div></div>`;
          container.innerHTML = html;
        }

        function buildBestiarySubTabHTML(discoveredCount, totalHunted) {
          const huntedSpeciesCount = DINO_SPECIES.filter((sp) => (getBestiaryEntry(sp.id).huntedCount || 0) > 0).length;
          let html = `
            <div class="summary-strip">
              <span>Entdeckt: <strong class="mono">${discoveredCount}/${DINO_SPECIES.length}</strong> · Erjagt: <strong class="mono">${totalHunted}×</strong></span>
              <button class="jump-btn" data-goto-worldmap="1">Auf Weltkarte jagen</button>
            </div>
            <div class="filter-row">
              <button class="filter-chip ${bestiaryFilter === 'all' ? 'active' : ''}" data-bestiary-filter="all">Alle (${DINO_SPECIES.length})</button>
              <button class="filter-chip ${bestiaryFilter === 'discovered' ? 'active' : ''}" data-bestiary-filter="discovered">Entdeckt (${discoveredCount})</button>
              <button class="filter-chip ${bestiaryFilter === 'hunted' ? 'active' : ''}" data-bestiary-filter="hunted">Erjagt (${huntedSpeciesCount})</button>
            </div>
            <div class="card-list">
          `;

          const filtered = DINO_SPECIES.filter((sp) => {
            const e = getBestiaryEntry(sp.id);
            if (bestiaryFilter === 'discovered') return e.discovered;
            if (bestiaryFilter === 'hunted') return (e.huntedCount || 0) > 0;
            return true;
          });

          if (filtered.length === 0) {
            html += `
              <div class="gate-notice">
                <p class="gate-notice-title">Noch keine Saurier in dieser Kategorie</p>
                <p class="gate-notice-desc">Entsende Jagdtrupps mit Helden und Soldaten auf der Weltkarte oder schließe Wildnis-Expeditionen ab, um Saurierarten zu entdecken und zu erjagen.</p>
                <button class="btn-primary" data-goto-worldmap="1">Zur Weltkarte</button>
              </div>
            `;
          }

          for (const sp of filtered) {
            const entry = getBestiaryEntry(sp.id);
            const isDisc = entry.discovered;
            const isHunted = (entry.huntedCount || 0) > 0;
            const matchingSpawn = WORLD_DINOS.find((d) => (getWorldDinoState(d.id)?.speciesId || d.speciesId) === sp.id);
            const samplePower = getDinoCombatPower(sp, sp.levelRange[0]);
            const maxPower = getDinoCombatPower(sp, sp.levelRange[1]);

            if (!isDisc) {
              html += `
                <div class="bestiary-card is-undiscovered" style="--dino-accent:${sp.accent};">
                  <div class="bestiary-head">
                    <div class="bestiary-icon" style="border-color:rgba(168,162,158,0.32);">
                      ${getDinoIconSVG(sp.id, 26, '#78716c')}
                    </div>
                    <div style="flex:1; min-width:0;">
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                        <p class="card-title" style="color:var(--text-secondary);">Unbekannter Saurier (???)</p>
                        <span class="status-text locked mono">St. ${sp.levelRange[0]}–${sp.levelRange[1]}</span>
                      </div>
                      <p class="card-effect">Lebensraum: ${sp.habitat}</p>
                    </div>
                  </div>
                  <div class="exp-actions-row">
                    <span style="font-size:11px; color:var(--text-muted);">Auf Weltkarte angreifen oder Expedition abschließen zum Entdecken</span>
                    ${
                      matchingSpawn
                        ? `<button class="jump-btn" data-goto-world-dino="${matchingSpawn.id}">Auf Karte suchen</button>`
                        : ''
                    }
                  </div>
                </div>
              `;
              continue;
            }

            const statusBadge = isHunted
              ? `<span class="status-text done mono">${entry.huntedCount}× erjagt · Rekord St. ${entry.highestLevel}</span>`
              : `<span class="status-text running">Entdeckt · Noch nicht erlegt</span>`;

            html += `
              <div class="bestiary-card ${isHunted ? 'is-hunted' : ''}" style="--dino-accent:${sp.accent};">
                <div class="bestiary-head">
                  <div class="bestiary-icon">
                    ${getDinoIconSVG(sp.id, 28, sp.accent)}
                  </div>
                  <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                      <p class="card-title">${sp.name}</p>
                      ${statusBadge}
                    </div>
                    <p class="card-effect">${sp.tier} · St. ${sp.levelRange[0]}–${sp.levelRange[1]} · KK ${fmtNum(samplePower)}–${fmtNum(maxPower)}</p>
                  </div>
                </div>
                <p style="font-size:12px; color:var(--text-secondary); line-height:1.45;">${sp.desc}</p>
                <div>
                  <div style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:5px;">Stärken</div>
                  <div class="bestiary-strength-list">
                    ${sp.strengths.map((st) => `<span class="bestiary-strength-chip">${st}</span>`).join('')}
                  </div>
                </div>
                <div class="bestiary-counter-box">${sp.weaknessTip}</div>
                <div>
                  <div style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:5px;">Beute-Chancen bei Jagdsieg</div>
                  <div class="bestiary-loot-grid">
                    ${sp.lootTable
                      .map(
                        (lt) => `
                        <div class="bestiary-loot-row">
                          <span style="color:var(--text-primary); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lt.label} (${lt.min === lt.max ? lt.min : `${lt.min}–${lt.max}`})</span>
                          <span class="mono" style="color:${lt.chancePct >= 80 ? '#4ade80' : lt.chancePct >= 40 ? '#fbbf24' : '#f472b6'}; font-weight:700;">${lt.chancePct}%</span>
                        </div>
                      `
                      )
                      .join('')}
                  </div>
                </div>
                <div class="exp-actions-row">
                  <span style="font-size:11px; color:var(--text-muted);">Gebiet: ${sp.habitat}</span>
                  ${
                    matchingSpawn
                      ? `<button class="jump-btn" data-goto-world-dino="${matchingSpawn.id}">Jagen gehen</button>`
                      : ''
                  }
                </div>
              </div>
            `;
          }

          html += `</div>`;
          return html;
        }

        /* =====================================================================
           9B. WELTKARTE RENDERING (1200×1200 CANVAS, SMOOTH ZOOM, MINIMAP & MÄRSCHE)
           ===================================================================== */
        const worldMapBgImage = new Image();
        worldMapBgImage.referrerPolicy = 'no-referrer';
        worldMapBgImage.src = '/assets/aistudio/image_aa58bba1.png';
        worldMapBgImage.onload = () => {
          if (activeTab === 'worldmap') {
            applyWorldCamera(worldCam.cx, worldCam.cy, worldCam.zoom);
          }
        };

        function getWorldViewportSize() {
          const vp = document.getElementById('worldMapViewport');
          const vw = vp ? vp.clientWidth || 380 : 380;
          const vh = vp ? vp.clientHeight || 600 : 600;
          return { vp, vw, vh };
        }

        function getWorldMinZoom(vw, vh) {
          return Math.max(0.24, Math.min(vw, vh) / WORLD_GRID_COLS);
        }

        function isWorldMap3DReady() {
          return Boolean(window.WorldMap3D && window.WorldMap3D.isReady());
        }

        function getWorldIsoYScale() {
          return isWorldMap3DReady() ? window.WorldMap3D.getIsoYScale() : 1;
        }

        function clampWorldCameraState(cx, cy, zoom) {
          const { vw, vh } = getWorldViewportSize();
          const minZoom = getWorldMinZoom(vw, vh);
          const z = Math.max(minZoom, Math.min(WORLD_CAM_MAX_ZOOM, Number(zoom) || WORLD_CAM_DEFAULT_ZOOM));
          const isoY = getWorldIsoYScale();
          const halfW = vw / (2 * z);
          const halfH = vh / (2 * z * isoY);
          let nextCx = cx;
          let nextCy = cy;
          if (WORLD_GRID_COLS * z <= vw) {
            nextCx = WORLD_GRID_COLS / 2;
          } else {
            nextCx = Math.max(halfW, Math.min(WORLD_GRID_COLS - halfW, cx));
          }
          if (WORLD_GRID_ROWS * z * isoY <= vh) {
            nextCy = WORLD_GRID_ROWS / 2;
          } else {
            nextCy = Math.max(halfH, Math.min(WORLD_GRID_ROWS - halfH, cy));
          }
          return { cx: nextCx, cy: nextCy, zoom: z, minZoom, vw, vh };
        }

        function worldToScreen(wx, wy, vw, vh) {
          if (isWorldMap3DReady()) {
            const pt = window.WorldMap3D.projectWorld(wx, wy, 0);
            return { sx: pt.sx, sy: pt.sy };
          }
          return {
            sx: vw / 2 + (wx - worldCam.cx) * worldCam.zoom,
            sy: vh / 2 + (wy - worldCam.cy) * worldCam.zoom
          };
        }

        function screenToWorld(sx, sy, vw, vh) {
          if (isWorldMap3DReady()) {
            return window.WorldMap3D.unprojectScreen(sx, sy);
          }
          return {
            wx: worldCam.cx + (sx - vw / 2) / worldCam.zoom,
            wy: worldCam.cy + (sy - vh / 2) / worldCam.zoom
          };
        }

        function stopWorldCamAnimation() {
          if (worldCam.rafId) {
            cancelAnimationFrame(worldCam.rafId);
            worldCam.rafId = 0;
          }
        }

        function scheduleWorldCamAnimation() {
          if (worldCam.rafId) return;
          worldCam.lastFrameTs = performance.now();
          const step = (ts) => {
            worldCam.rafId = 0;
            if (activeTab !== 'worldmap') return;
            const dt = Math.min(0.05, Math.max(0.001, (ts - worldCam.lastFrameTs) / 1000));
            worldCam.lastFrameTs = ts;
            const alpha = 1 - Math.exp(-14 * dt);
            const nextZoom = worldCam.zoom + (worldCam.targetZoom - worldCam.zoom) * alpha;
            const nextCx = worldCam.cx + (worldCam.targetCx - worldCam.cx) * alpha;
            const nextCy = worldCam.cy + (worldCam.targetCy - worldCam.cy) * alpha;
            const done =
              Math.abs(worldCam.targetZoom - nextZoom) < 0.004 &&
              Math.abs(worldCam.targetCx - nextCx) < 0.03 &&
              Math.abs(worldCam.targetCy - nextCy) < 0.03;
            if (done) {
              applyWorldCamera(worldCam.targetCx, worldCam.targetCy, worldCam.targetZoom);
            } else {
              applyWorldCamera(nextCx, nextCy, nextZoom);
              worldCam.rafId = requestAnimationFrame(step);
            }
          };
          worldCam.rafId = requestAnimationFrame(step);
        }

        function setWorldCameraTarget(cx, cy, zoom, animate = true) {
          const clamped = clampWorldCameraState(cx, cy, zoom);
          worldCam.targetCx = clamped.cx;
          worldCam.targetCy = clamped.cy;
          worldCam.targetZoom = clamped.zoom;
          if (!animate) {
            stopWorldCamAnimation();
            applyWorldCamera(clamped.cx, clamped.cy, clamped.zoom);
          } else {
            scheduleWorldCamAnimation();
          }
        }

        function zoomWorldMapAt(factor, focalSx, focalSy, animate = true) {
          const { vw, vh } = getWorldViewportSize();
          const fx = typeof focalSx === 'number' ? focalSx : vw / 2;
          const fy = typeof focalSy === 'number' ? focalSy : vh / 2;
          const isoY = getWorldIsoYScale();
          const baseZoom = animate ? worldCam.targetZoom : worldCam.zoom;
          const baseCx = animate ? worldCam.targetCx : worldCam.cx;
          const baseCy = animate ? worldCam.targetCy : worldCam.cy;
          const worldX = baseCx + (fx - vw / 2) / baseZoom;
          const worldY = baseCy + (fy - vh / 2) / (baseZoom * isoY);
          const minZoom = getWorldMinZoom(vw, vh);
          const nextZoom = Math.max(minZoom, Math.min(WORLD_CAM_MAX_ZOOM, baseZoom * factor));
          const nextCx = worldX - (fx - vw / 2) / nextZoom;
          const nextCy = worldY - (fy - vh / 2) / (nextZoom * isoY);
          setWorldCameraTarget(nextCx, nextCy, nextZoom, animate);
        }

        function drawWorldMapCanvas(vw, vh) {
          const canvas = document.getElementById('worldMapCanvas');
          if (isWorldMap3DReady()) {
            if (canvas && canvas.style.display !== 'none') canvas.style.display = 'none';
            window.WorldMap3D.setCamera(worldCam.cx, worldCam.cy, worldCam.zoom, vw, vh);
            return;
          }
          if (!canvas) return;
          if (canvas.style.display === 'none') canvas.style.display = 'block';
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const targetW = Math.max(1, Math.round(vw * dpr));
          const targetH = Math.max(1, Math.round(vh * dpr));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = '#110e0d';
          ctx.fillRect(0, 0, vw, vh);

          const zoom = worldCam.zoom;
          const mapLeft = vw / 2 - worldCam.cx * zoom;
          const mapTop = vh / 2 - worldCam.cy * zoom;
          const mapW = WORLD_GRID_COLS * zoom;
          const mapH = WORLD_GRID_ROWS * zoom;

          // 1. Vulkanischer Weltkarten-Hintergrund (1200×1200 Kontinent)
          if (worldMapBgImage.complete && worldMapBgImage.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(worldMapBgImage, mapLeft, mapTop, mapW, mapH);
          } else {
            const grad = ctx.createRadialGradient(
              mapLeft + mapW * 0.5,
              mapTop + mapH * 0.5,
              mapW * 0.04,
              mapLeft + mapW * 0.5,
              mapTop + mapH * 0.5,
              mapW * 0.65
            );
            grad.addColorStop(0, '#431407');
            grad.addColorStop(0.35, '#291c15');
            grad.addColorStop(1, '#141110');
            ctx.fillStyle = grad;
            ctx.fillRect(mapLeft, mapTop, mapW, mapH);
          }

          // Sichtbarer Kachelbereich für O(sichtbare Kacheln)-Rendering
          const visMinX = Math.max(0, Math.floor(worldCam.cx - vw / (2 * zoom)) - 1);
          const visMaxX = Math.min(WORLD_GRID_COLS, Math.ceil(worldCam.cx + vw / (2 * zoom)) + 1);
          const visMinY = Math.max(0, Math.floor(worldCam.cy - vh / (2 * zoom)) - 1);
          const visMaxY = Math.min(WORLD_GRID_ROWS, Math.ceil(worldCam.cy + vh / (2 * zoom)) + 1);

          // 2. Teleport-Hindernis-Overlay (nur sichtbare Kacheln oder Zonenformen bei Weitwinkel)
          if (teleportGhost.active) {
            if (zoom >= 6) {
              const ownUid = mpWorld.session ? mpWorld.session.uid : null;
              const startX = Math.max(0, visMinX);
              const endX = Math.min(WORLD_GRID_COLS - 1, visMaxX);
              const startY = Math.max(0, visMinY);
              const endY = Math.min(WORLD_GRID_ROWS - 1, visMaxY);

              for (let gy = startY; gy <= endY; gy++) {
                const sy = mapTop + gy * zoom;
                for (let gx = startX; gx <= endX; gx++) {
                  const st = getWorldTileState(gx, gy);
                  if (st === TILE_BLOCKED) {
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
                    ctx.fillRect(mapLeft + gx * zoom, sy, zoom, zoom);
                  } else if (st === TILE_OCCUPIED) {
                    ctx.fillStyle = 'rgba(245, 158, 11, 0.26)';
                    ctx.fillRect(mapLeft + gx * zoom, sy, zoom, zoom);
                  }
                }
              }

              // Belegte 2×2-Flächen anderer Spieler einzeichnen
              ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
              for (const s of mpWorld.settlements || []) {
                if (ownUid && s.uid === ownUid) continue;
                if (s.tileX + 2 < startX || s.tileX > endX || s.tileY + 2 < startY || s.tileY > endY) continue;
                ctx.fillRect(mapLeft + s.tileX * zoom, mapTop + s.tileY * zoom, zoom * 2, zoom * 2);
              }
            } else {
              // Übersichts-Zonen bei Herauszoomen im Teleport-Modus
              ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
              ctx.beginPath();
              ctx.ellipse(mapLeft + 600 * zoom, mapTop + 600 * zoom, 145 * zoom, 145 * zoom, 0, 0, Math.PI * 2);
              ctx.fill();
              const blockedRects = [
                [530, 110, 140, 120],
                [530, 970, 140, 120],
                [110, 530, 120, 140],
                [970, 530, 120, 140],
                [0, 0, 96, 96],
                [1104, 0, 96, 96],
                [0, 1104, 96, 96],
                [1104, 1104, 96, 96]
              ];
              for (const [rx, ry, rw, rh] of blockedRects) {
                ctx.fillRect(mapLeft + rx * zoom, mapTop + ry * zoom, rw * zoom, rh * zoom);
              }
              ctx.fillStyle = 'rgba(245, 158, 11, 0.26)';
              const npcRects = [
                [230, 210, 46, 46],
                [925, 210, 46, 46],
                [925, 945, 46, 46]
              ];
              for (const [rx, ry, rw, rh] of npcRects) {
                ctx.fillRect(mapLeft + rx * zoom, mapTop + ry * zoom, rw * zoom, rh * zoom);
              }
            }
          }

          // 3. Adaptives Raster (50er Sektoren -> 10er Blöcke -> 1×1 Einzelkacheln je nach Zoom)
          const drawGridLines = (step, strokeStyle, lineWidth) => {
            ctx.beginPath();
            const firstX = Math.max(0, Math.floor(visMinX / step) * step);
            const lastX = Math.min(WORLD_GRID_COLS, Math.ceil(visMaxX / step) * step);
            const firstY = Math.max(0, Math.floor(visMinY / step) * step);
            const lastY = Math.min(WORLD_GRID_ROWS, Math.ceil(visMaxY / step) * step);
            const yTop = Math.max(0, mapTop);
            const yBot = Math.min(vh, mapTop + mapH);
            const xLeft = Math.max(0, mapLeft);
            const xRight = Math.min(vw, mapLeft + mapW);
            for (let gx = firstX; gx <= lastX; gx += step) {
              const x = Math.round(mapLeft + gx * zoom) + 0.5;
              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBot);
            }
            for (let gy = firstY; gy <= lastY; gy += step) {
              const y = Math.round(mapTop + gy * zoom) + 0.5;
              ctx.moveTo(xLeft, y);
              ctx.lineTo(xRight, y);
            }
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
          };

          if (zoom >= 8 || (teleportGhost.active && zoom >= 6)) {
            const tileAlpha = teleportGhost.active ? 0.22 : Math.min(0.18, (zoom - 7) * 0.015);
            drawGridLines(1, `rgba(245, 239, 230, ${tileAlpha.toFixed(3)})`, 1);
            drawGridLines(10, 'rgba(245, 158, 11, 0.24)', 1);
          } else if (zoom >= 1.8) {
            drawGridLines(10, 'rgba(245, 239, 230, 0.08)', 1);
            drawGridLines(50, 'rgba(245, 158, 11, 0.16)', 1);
          } else {
            drawGridLines(50, 'rgba(245, 239, 230, 0.09)', 1);
            drawGridLines(200, 'rgba(245, 158, 11, 0.18)', 1);
          }

          // 4. Dezente Sektor-Koordinaten im Nahzoom
          if (zoom >= 14) {
            ctx.fillStyle = 'rgba(253, 230, 138, 0.55)';
            ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
            const stepLbl = zoom >= 26 ? 5 : 10;
            const firstX = Math.max(0, Math.floor(visMinX / stepLbl) * stepLbl);
            const firstY = Math.max(0, Math.floor(visMinY / stepLbl) * stepLbl);
            for (let gy = firstY; gy <= visMaxY; gy += stepLbl) {
              for (let gx = firstX; gx <= visMaxX; gx += stepLbl) {
                const sx = mapLeft + gx * zoom + 4;
                const sy = mapTop + gy * zoom + 12;
                if (sx > 8 && sx < vw - 52 && sy > 70 && sy < vh - 40) {
                  ctx.fillText(`${gx},${gy}`, sx, sy);
                }
              }
            }
          }

          // 5. Äußerer Rahmen der 1200×1200-Weltkarte
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.42)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(mapLeft + 0.5, mapTop + 0.5, mapW - 1, mapH - 1);
        }

        function updateProjectedWorldMarkers(vw, vh) {
          const markersEl = document.getElementById('worldMapMarkers');
          if (!markersEl) return;
          const is3d = isWorldMap3DReady();
          markersEl.classList.toggle('wm-zoom-far', worldCam.zoom < WORLD_CAM_DEFAULT_ZOOM * 0.72);
          const scale = Math.max(
            0.78,
            Math.min(1.06, 0.84 + Math.log2(Math.max(0.25, worldCam.zoom) / 0.65) * 0.055)
          );
          const margin = 96;
          const nodes = markersEl.children;
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const wx = Number(el.dataset.wx);
            const wy = Number(el.dataset.wy);
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
            const { sx, sy } = worldToScreen(wx, wy, vw, vh);
            if (sx < -margin || sx > vw + margin || sy < -margin || sy > vh + margin) {
              if (el.style.display !== 'none') el.style.display = 'none';
            } else {
              if (el.style.display === 'none') el.style.display = '';
              // In 3D mode anchor the Village-style plaque neatly below each 3D miniature's base
              const yOffsetPx = is3d ? Number(el.dataset.yOff || 8) : 0;
              const yAnchor = is3d ? `${yOffsetPx}px` : '-50%';
              el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, ${yAnchor}) scale(${scale.toFixed(3)})`;
            }
          }
        }

        function renderWorldMarchSvg(vw, vh) {
          const svgEl = document.getElementById('worldMarchSvg');
          if (!svgEl) return;
          svgEl.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
          const now = Date.now();
          const home = getHomePos();
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;
          const homePt = worldToScreen(home.wx, home.wy, vw, vh);
          let svgHtml = '';

          for (const march of state.worldMarches || []) {
            const isHunt = march.kind === 'hunt';
            const isVolcano = march.kind === 'volcano';
            const livePos = isVolcano ? VOLCANO_POS : isHunt ? getDinoPos(march.dinoId) : getNodePos(march.nodeId);
            const txPct = typeof march.targetX === 'number' ? march.targetX : livePos ? livePos.xPct : null;
            const tyPct = typeof march.targetY === 'number' ? march.targetY : livePos ? livePos.yPct : null;
            if (txPct === null || tyPct === null) continue;
            const tPt = worldToScreen((txPct / 100) * WORLD_GRID_COLS, (tyPct / 100) * WORLD_GRID_ROWS, vw, vh);
            const total = Math.max(1000, march.phaseEndsAt - march.startedAt);
            const prog = Math.min(1, Math.max(0, (now - march.startedAt) / total));

            if (march.phase === 'marching_out') {
              const mx = homePt.sx + (tPt.sx - homePt.sx) * prog;
              const my = homePt.sy + (tPt.sy - homePt.sy) * prog;
              const strokeCol = isVolcano ? '#f97316' : isHunt ? '#f87171' : '#fbbf24';
              const lineCls = isVolcano ? 'volcano-out' : isHunt ? 'hunt-out' : 'out';
              svgHtml += `<line class="wm-march-line ${lineCls}" x1="${homePt.sx.toFixed(1)}" y1="${homePt.sy.toFixed(1)}" x2="${tPt.sx.toFixed(1)}" y2="${tPt.sy.toFixed(1)}" />`;
              svgHtml += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="8" fill="#171412" stroke="${strokeCol}" stroke-width="2.4" />`;
              svgHtml += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.4" fill="${strokeCol}" />`;
            } else if (march.phase === 'gathering' || march.phase === 'occupying' || march.phase === 'attacking') {
              svgHtml += `<line class="wm-march-line gather" x1="${homePt.sx.toFixed(1)}" y1="${homePt.sy.toFixed(1)}" x2="${tPt.sx.toFixed(1)}" y2="${tPt.sy.toFixed(1)}" />`;
            } else if (march.phase === 'marching_back') {
              const mx = tPt.sx + (homePt.sx - tPt.sx) * prog;
              const my = tPt.sy + (homePt.sy - tPt.sy) * prog;
              svgHtml += `<line class="wm-march-line ${isHunt ? 'hunt-back' : 'back'}" x1="${tPt.sx.toFixed(1)}" y1="${tPt.sy.toFixed(1)}" x2="${homePt.sx.toFixed(1)}" y2="${homePt.sy.toFixed(1)}" />`;
              svgHtml += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="8" fill="#171412" stroke="#4ade80" stroke-width="2.4" />`;
              svgHtml += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.4" fill="#4ade80" />`;
            }
          }

          // Fremde Spielermärsche auf der gemeinsamen Weltkarte einzeichnen
          for (const om of mpWorld.marches || []) {
            if (ownUid && om.uid === ownUid) continue;
            if (om.status !== 'active') continue;
            const p1 = worldToScreen((om.fromX / 100) * WORLD_GRID_COLS, (om.fromY / 100) * WORLD_GRID_ROWS, vw, vh);
            const p2 = worldToScreen((om.toX / 100) * WORLD_GRID_COLS, (om.toY / 100) * WORLD_GRID_ROWS, vw, vh);
            const dur = Math.max(1000, (om.endsAt || now + 10000) - (om.startedAt || now));
            const p = Math.min(1, Math.max(0, (now - (om.startedAt || now)) / dur));
            const cx = p1.sx + (p2.sx - p1.sx) * p;
            const cy = p1.sy + (p2.sy - p1.sy) * p;
            svgHtml += `<line class="wm-march-line other-player" x1="${p1.sx.toFixed(1)}" y1="${p1.sy.toFixed(1)}" x2="${p2.sx.toFixed(1)}" y2="${p2.sy.toFixed(1)}" />`;
            svgHtml += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6.5" fill="#0f172a" stroke="#38bdf8" stroke-width="2" />`;
          }
          svgEl.innerHTML = svgHtml;
        }

        function positionTeleportGhostElement(vw, vh) {
          const preview = document.getElementById('wmGhostPreview');
          if (!preview) return;
          const isoY = getWorldIsoYScale();
          const sizePx = Math.max(38, 2 * worldCam.zoom);
          const heightPx = Math.max(30, sizePx * isoY);
          const centerPt = worldToScreen(teleportGhost.anchorX + 1, teleportGhost.anchorY + 1, vw, vh);
          preview.style.left = `${(centerPt.sx - sizePx / 2).toFixed(1)}px`;
          preview.style.top = `${(centerPt.sy - heightPx / 2).toFixed(1)}px`;
          preview.style.width = `${sizePx.toFixed(1)}px`;
          preview.style.height = `${heightPx.toFixed(1)}px`;
        }

        function applyWorldCamera(cx, cy, zoom = worldCam.zoom) {
          const clamped = clampWorldCameraState(cx, cy, zoom);
          worldCam.cx = clamped.cx;
          worldCam.cy = clamped.cy;
          worldCam.zoom = clamped.zoom;

          const readout = document.getElementById('wmCoordReadout');
          if (readout) {
            const tileX = Math.max(0, Math.min(WORLD_GRID_COLS - 1, Math.round(worldCam.cx)));
            const tileY = Math.max(0, Math.min(WORLD_GRID_ROWS - 1, Math.round(worldCam.cy)));
            readout.textContent = `[X: ${tileX}, Y: ${tileY}]`;
          }

          const zoomReadout = document.getElementById('wmZoomReadout');
          if (zoomReadout) {
            const ratio = worldCam.zoom / WORLD_CAM_DEFAULT_ZOOM;
            zoomReadout.textContent = ratio >= 9.95 ? `${ratio.toFixed(0)}×` : `${Math.round(ratio * 100)}%`;
          }

          drawWorldMapCanvas(clamped.vw, clamped.vh);
          updateProjectedWorldMarkers(clamped.vw, clamped.vh);
          renderWorldMarchSvg(clamped.vw, clamped.vh);
          renderWorldMinimapViewport(clamped.vw, clamped.vh);
          if (teleportGhost.active) {
            positionTeleportGhostElement(clamped.vw, clamped.vh);
          }
        }

        function centerWorldMapOn(xPct, yPct, opts = {}) {
          const wx = (Number(xPct) / 100) * WORLD_GRID_COLS;
          const wy = (Number(yPct) / 100) * WORLD_GRID_ROWS;
          const targetZoom =
            typeof opts.zoom === 'number'
              ? opts.zoom
              : typeof opts.minZoom === 'number'
              ? Math.max(worldCam.zoom, opts.minZoom)
              : worldCam.zoom;
          setWorldCameraTarget(wx, wy, targetZoom, opts.animate !== false);
        }

        function renderWorldMinimapViewport(vw, vh) {
          const rect = document.getElementById('wmMiniViewportRect');
          if (!rect) return;
          const topLeft = screenToWorld(0, 0, vw, vh);
          const bottomRight = screenToWorld(vw, vh, vw, vh);
          const leftTile = Math.min(topLeft.wx, bottomRight.wx);
          const topTile = Math.min(topLeft.wy, bottomRight.wy);
          const visW = Math.max(1, Math.abs(bottomRight.wx - topLeft.wx));
          const visH = Math.max(1, Math.abs(bottomRight.wy - topLeft.wy));
          const scale = 120 / WORLD_GRID_COLS;
          const rx = Math.max(0, Math.min(120, leftTile * scale));
          const ry = Math.max(0, Math.min(120, topTile * scale));
          const rw = Math.max(4, Math.min(120 - rx, visW * scale));
          const rh = Math.max(4, Math.min(120 - ry, visH * scale));
          rect.setAttribute('x', rx.toFixed(1));
          rect.setAttribute('y', ry.toFixed(1));
          rect.setAttribute('width', rw.toFixed(1));
          rect.setAttribute('height', rh.toFixed(1));
        }

        function setGhostAnchor(rawX, rawY) {
          const ax = Math.max(0, Math.min(WORLD_GRID_COLS - 2, Math.round(rawX)));
          const ay = Math.max(0, Math.min(WORLD_GRID_ROWS - 2, Math.round(rawY)));
          teleportGhost.anchorX = ax;
          teleportGhost.anchorY = ay;
          teleportGhost.validation = validateGhost2x2(ax, ay);
          teleportGhost.valid = teleportGhost.validation.valid;
          renderTeleportGhostUI();
        }

        function enterTeleportGhostMode() {
          const home = getHomePos();
          teleportGhost.active = true;
          const startX = worldCam.initialized ? Math.floor(worldCam.cx) - 1 : home.tileX + 2;
          const startY = worldCam.initialized ? Math.floor(worldCam.cy) - 1 : home.tileY;
          setGhostAnchor(startX, startY);
          // Zoome angenehm nah an das 1×1-Kachelraster heran, damit 2×2-Platzierung präzise ist
          const comfortableZoom = Math.max(worldCam.zoom, 22);
          setWorldCameraTarget(teleportGhost.anchorX + 1, teleportGhost.anchorY + 1, comfortableZoom, true);
          SoundFX.play('tap');
          renderWorldMap();
        }

        function exitTeleportGhostMode() {
          teleportGhost.active = false;
          teleportGhost.dragging = false;
          renderWorldMap();
        }

        async function confirmTeleportGhost() {
          if (!teleportGhost.active) return;
          const targetX = teleportGhost.anchorX;
          const targetY = teleportGhost.anchorY;
          const check = validateGhost2x2(targetX, targetY);
          if (!check.valid) {
            SoundFX.play('error');
            showToast(`Ungültige Position: ${check.reason}`, 'err');
            return;
          }
          const tpItems = (state.inventory && state.inventory.teleportItem) || 0;
          if (tpItems <= 0) {
            SoundFX.play('error');
            showToast('Kein Siedlungs-Teleport-Item mehr im Inventar.', 'err');
            return;
          }

          // Serverseitige atomare 2x2-Prüfung gegen andere Spielerdörfer
          if (window.DinoMultiplayer) {
            const srvResp = await window.DinoMultiplayer.teleportSettlement({
              bonfireLevel: state.buildings.bonfire.level,
              power: computeVillagePowerMp(),
              tileX: targetX,
              tileY: targetY
            });
            if (srvResp && !srvResp.ok) {
              SoundFX.play('error');
              showToast(srvResp.reason || 'Diese 2×2-Fläche wurde gerade belegt.', 'err');
              renderWorldMap();
              return;
            }
          }

          state.inventory.teleportItem -= 1;
          state.homeTile = { x: targetX, y: targetY };
          teleportGhost.active = false;
          teleportGhost.dragging = false;
          const home = getHomePos();
          SoundFX.play('horn');
          showToast(`Siedlung nach [X: ${home.coordX}, Y: ${home.coordY}] teleportiert!`, 'ok');
          saveState();
          renderAll();
          centerWorldMapOn(home.xPct, home.yPct, { animate: true });
        }

        function syncWorldMap3DEntities() {
          if (!isWorldMap3DReady()) return;
          const now = Date.now();
          const home = getHomePos();
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;
          const settlements = [
            {
              id: 'home',
              isOwn: true,
              wx: home.wx,
              wy: home.wy,
              bonfireLevel: state.buildings.bonfire.level,
              tribeName: (mpWorld.session && mpWorld.session.tribeName) || 'Meine Siedlung'
            }
          ];
          for (const pl of mpWorld.settlements || []) {
            if (ownUid && pl.uid === ownUid) continue;
            settlements.push({
              id: String(pl.uid),
              isOwn: false,
              wx: Number(pl.tileX) + 1,
              wy: Number(pl.tileY) + 1,
              bonfireLevel: Number(pl.bonfireLevel) || 1,
              tribeName: pl.tribeName || 'Fremdstamm'
            });
          }

          const nodes = [];
          for (const def of WORLD_NODES) {
            const info = getWorldNodeInfo(def.id);
            const nState = getWorldNodeState(def.id);
            const pos = getNodePos(def.id);
            if (!info || !pos) continue;
            const march = getActiveMarchForNode(def.id);
            const enemyOcc = getEnemyNodeOccupant(def.id);
            nodes.push({
              id: def.id,
              resource: info.resource,
              level: info.level,
              wx: pos.wx,
              wy: pos.wy,
              depleted: nState.remaining <= 0 && !march,
              activeGather: Boolean(march),
              enemyOccupied: Boolean(enemyOcc && !march)
            });
          }

          const dinos = [];
          for (const dDef of WORLD_DINOS) {
            const dState = getWorldDinoState(dDef.id);
            const sp = getDinoSpecies(dState.speciesId);
            const pos = getDinoPos(dDef.id);
            if (!sp || !pos) continue;
            const march = getActiveMarchForDino(dDef.id);
            dinos.push({
              id: dDef.id,
              speciesId: sp.id,
              level: dState.level,
              accent: sp.accent,
              wx: pos.wx,
              wy: pos.wy,
              respawning: dState.respawnAt > now && !march,
              activeHunt: Boolean(march)
            });
          }

          const volcanoState = getVolcanoState();
          window.WorldMap3D.syncEntities({
            settlements,
            nodes,
            dinos,
            volcano: {
              phase: volcanoState.phase,
              holderStatus: getVolcanoHolderStatus(volcanoState)
            },
            teleportGhost: {
              active: Boolean(teleportGhost.active),
              anchorX: teleportGhost.anchorX,
              anchorY: teleportGhost.anchorY,
              valid: Boolean(teleportGhost.valid)
            }
          });
        }

        function renderTeleportGhostUI() {
          const ghostLayer = document.getElementById('wmGhostLayer');
          const tpBar = document.getElementById('wmTeleportBar');
          const tpBtn = document.getElementById('btnWmTeleportMode');
          const tpBtnLabel = document.getElementById('wmTpBtnLabel');
          const tpCount = (state.inventory && state.inventory.teleportItem) || 0;

          if (tpBtn) tpBtn.classList.toggle('active', teleportGhost.active);
          if (tpBtnLabel) tpBtnLabel.textContent = teleportGhost.active ? 'Aktiv' : `Teleport (${tpCount})`;

          syncWorldMap3DEntities();

          if (!teleportGhost.active) {
            if (ghostLayer) ghostLayer.innerHTML = '';
            if (tpBar) tpBar.classList.remove('visible');
            return;
          }

          if (tpBar) tpBar.classList.add('visible');

          const { vw, vh } = getWorldViewportSize();
          const isoY = getWorldIsoYScale();
          const v = teleportGhost.validation || validateGhost2x2(teleportGhost.anchorX, teleportGhost.anchorY);
          const coordX = teleportGhost.anchorX;
          const coordY = teleportGhost.anchorY;
          const freeCount = v.cells.filter((c) => c.free).length;
          const strokeCol = v.valid ? '#86efac' : '#fca5a5';
          const fillCol = v.valid ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.42)';
          const sizePx = Math.max(38, 2 * worldCam.zoom);
          const heightPx = Math.max(30, sizePx * isoY);
          const centerPt = worldToScreen(teleportGhost.anchorX + 1, teleportGhost.anchorY + 1, vw, vh);
          const leftPx = centerPt.sx - sizePx / 2;
          const topPx = centerPt.sy - heightPx / 2;

          const cellsHtml = v.cells
            .map((c) => `<div class="wm-ghost-cell ${c.free ? 'cell-free' : 'cell-blocked'}"></div>`)
            .join('');

          if (ghostLayer) {
            ghostLayer.innerHTML = `
              <div
                class="wm-ghost-2x2 ${v.valid ? 'is-valid' : 'is-invalid'} ${teleportGhost.dragging ? 'dragging' : ''}"
                id="wmGhostPreview"
                style="left:${leftPx.toFixed(1)}px; top:${topPx.toFixed(1)}px; width:${sizePx.toFixed(1)}px; height:${heightPx.toFixed(1)}px;"
              >
                ${cellsHtml}
                <div class="wm-ghost-silhouette">
                  <svg width="42" height="42" viewBox="0 0 56 56" fill="none" aria-hidden="true">
                    <rect x="6" y="10" width="44" height="36" rx="6" fill="${fillCol}" stroke="${strokeCol}" stroke-width="2" stroke-dasharray="4 2"/>
                    <path d="M15 36 L22 22 L29 36 Z" fill="${strokeCol}" opacity="0.85"/>
                    <path d="M29 36 L36 24 L42 36 Z" fill="${strokeCol}" opacity="0.7"/>
                    <path d="M28 14 C31 18 33 21 33 25 A5 5 0 1 1 23 25 C23 21 25 18 28 14 Z" fill="${v.valid ? '#fde047' : '#f87171'}" />
                  </svg>
                </div>
                <span class="wm-ghost-badge">${v.valid ? `✓ Frei [${coordX}, ${coordY}]` : `✕ Belegt (${freeCount}/4)`}</span>
                <span class="wm-ghost-drag-hint">2×2 Ziehen</span>
              </div>
            `;
          }

          const statusEl = document.getElementById('wmTpStatusText');
          const coordEl = document.getElementById('wmTpCoordText');
          const helpEl = document.getElementById('wmTpHelpText');
          const confirmBtn = document.getElementById('btnWmTpConfirm');

          if (statusEl) {
            statusEl.className = 'wm-tp-status-pill ' + (v.valid ? 'valid' : 'invalid');
            statusEl.textContent = v.valid
              ? `✓ Alle 4 Kacheln frei (2×2 gültig)`
              : `✕ Blockiert (${freeCount}/4 frei · ${v.reason})`;
          }
          if (coordEl) {
            coordEl.textContent = `Raster [${coordX}, ${coordY}] / 1200×1200`;
          }
          if (helpEl) {
            helpEl.textContent =
              tpCount > 0
                ? `Ziehe die 2×2-Vorschau über das Raster oder tippe ein Ziel an · ${tpCount}× Teleport-Item verfügbar.`
                : 'Kein Siedlungs-Teleport mehr vorhanden — Vorschau nur zur Ansicht.';
          }
          if (confirmBtn) {
            confirmBtn.disabled = !v.valid || tpCount <= 0;
            confirmBtn.textContent =
              tpCount <= 0
                ? 'Kein Teleport-Item'
                : v.valid
                ? `Hierhin teleportieren (-1 Item)`
                : 'Ungültige Position (Rot)';
          }
        }

        function renderWorldMap() {
          const now = Date.now();
          const { vp, vw, vh } = getWorldViewportSize();
          if (!vp) return;
          const home = getHomePos();

          // 0. Marschwarteschlangen-Anzeige im Weltkarten-HUD
          const qPill = document.getElementById('wmQueuePill');
          if (qPill) {
            const activeQ = (state.worldMarches || []).length;
            const maxQ = getMaxWorldMarches();
            const nextUnlock = getNextMarchQueueUnlockLevel();
            qPill.innerHTML = `
              <span>Marschwarteschlangen <strong class="mono">${activeQ}/${maxQ}</strong></span>
              <span class="wm-q-sub">${nextUnlock ? `Nächste ab Feuer St. ${nextUnlock}` : 'Max. 5 erreicht'}</span>
            `;
          }

          // 0b. 3D-Weltkarten-Modelle (Siedlungen, 48 Sammelstellen, 40 Dinos & 2×2 Teleport-Pad) synchronisieren
          syncWorldMap3DEntities();

          // 1. Dorf-Plaketten (.wm-caption) unter jedem 3D-Modell für klare Lesbarkeit & Klickbarkeit
          const markersEl = document.getElementById('worldMapMarkers');
          const bfLvl = state.buildings.bonfire.level;
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;
          const ownTribeLabel = escapeHtmlMp((mpWorld.session && mpWorld.session.tribeName) || 'Meine Siedlung');
          const volcanoState = getVolcanoState();
          const vHolderStatus = getVolcanoHolderStatus(volcanoState);
          const vIsBattle = volcanoState.phase === 'battle';
          const vCountdown = vIsBattle
            ? fmtVolcanoCountdown(volcanoState.battleEndsAt - now)
            : fmtVolcanoCountdown(volcanoState.nextBattleAt - now);
          const vRulerLabel = volcanoState.holderTribeName
            ? `👑 ${escapeHtmlMp(volcanoState.holderTribeName)}`
            : 'Vulkan-Wächter';
          let markersHtml = `
            <button
              class="wm-node is-volcano ${vIsBattle ? 'is-battle' : 'is-peace'} ${vHolderStatus === 'own' ? 'is-own' : vHolderStatus === 'enemy' ? 'is-enemy' : ''}"
              data-wm-volcano="1"
              data-wx="600"
              data-wy="600"
              data-y-off="24"
              aria-label="Vulkan-Zitadelle Zentrum [600, 600]"
            >
              <div class="wm-caption">
                <div class="wm-cap-row">
                  <span class="wm-cap-lvl">${vIsBattle ? '⚔ KAMPF' : '🛡 SCHILD'}</span>
                  <span class="wm-cap-name">Vulkan-Zitadelle</span>
                </div>
                <span class="wm-cap-meta">${vRulerLabel} · ${vIsBattle ? `Endet ${vCountdown}` : `In ${vCountdown}`}</span>
              </div>
            </button>
            <button
              class="wm-node own-settlement"
              data-wm-home="1"
              data-wx="${home.wx}"
              data-wy="${home.wy}"
              data-y-off="14"
              aria-label="${ownTribeLabel} Stufe ${bfLvl}"
            >
              <div class="wm-caption">
                <div class="wm-cap-row">
                  <span class="wm-cap-lvl">St.${bfLvl}</span>
                  <span class="wm-cap-name">${ownTribeLabel}</span>
                </div>
                <span class="wm-cap-meta">Signalfeuer · [${home.coordX}, ${home.coordY}]</span>
              </div>
            </button>
          `;

          // Andere echte Spielerdörfer auf der gemeinsamen 1200×1200-Weltkarte
          for (const pl of mpWorld.settlements || []) {
            if (ownUid && pl.uid === ownUid) continue;
            const wx = Number(pl.tileX) + 1;
            const wy = Number(pl.tileY) + 1;
            const safeName = escapeHtmlMp(pl.tribeName || 'Fremdstamm');
            markersHtml += `
              <button
                class="wm-node other-settlement"
                data-wm-player="${escapeHtmlMp(pl.uid)}"
                data-wx="${wx}"
                data-wy="${wy}"
                data-y-off="13"
                aria-label="Spielerstamm ${safeName} Stufe ${pl.bonfireLevel}"
              >
                <div class="wm-caption">
                  <div class="wm-cap-row">
                    <span class="wm-cap-lvl">St.${pl.bonfireLevel}</span>
                    <span class="wm-cap-name">${safeName}</span>
                  </div>
                </div>
              </button>
            `;
          }

          for (const def of WORLD_NODES) {
            const info = getWorldNodeInfo(def.id);
            const nState = getWorldNodeState(def.id);
            const pos = getNodePos(def.id);
            if (!info || !pos) continue;
            const march = getActiveMarchForNode(def.id);
            const enemyOcc = getEnemyNodeOccupant(def.id);
            const depleted = nState.remaining <= 0 && !march;
            const accent = RESOURCE_COLORS[info.resource] || '#f59e0b';
            const wx = pos.wx.toFixed(2);
            const wy = pos.wy.toFixed(2);
            let progHtml = '';
            if (march) {
              const total = Math.max(1000, march.phaseEndsAt - march.startedAt);
              const pct = Math.min(100, Math.max(4, ((now - march.startedAt) / total) * 100));
              progHtml = `<div class="wm-mini-prog"><div class="wm-mini-prog-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
            }
            const subLabel = march
              ? march.phase === 'marching_out'
                ? 'Hinmarsch'
                : march.phase === 'occupying'
                ? 'Gefecht...'
                : march.phase === 'gathering'
                ? 'Sammelt...'
                : 'Rückmarsch'
              : enemyOcc
              ? `⚔ ${escapeHtmlMp(enemyOcc.tribeName || 'Feind')}`
              : `${nState.remaining} ${RESOURCE_LABELS[info.resource]}`;

            markersHtml += `
              <button
                class="wm-node is-resource ${depleted ? 'depleted' : ''} ${march ? 'active-gather' : ''} ${enemyOcc && !march ? 'occupied-enemy' : ''}"
                data-wm-node="${def.id}"
                data-wx="${wx}"
                data-wy="${wy}"
                data-y-off="7"
                style="--node-accent:${accent};"
                aria-label="${info.name} Stufe ${info.level}${enemyOcc ? ` · Besetzt von ${escapeHtmlMp(enemyOcc.tribeName)}` : ''}"
              >
                <div class="wm-caption">
                  <div class="wm-cap-row">
                    <span class="wm-cap-dot"></span>
                    <span class="wm-cap-lvl">${info.level}</span>
                    <span class="wm-cap-name">${subLabel}</span>
                  </div>
                  ${progHtml}
                </div>
              </button>
            `;
          }

          for (const dDef of WORLD_DINOS) {
            const dState = getWorldDinoState(dDef.id);
            const sp = getDinoSpecies(dState.speciesId);
            const pos = getDinoPos(dDef.id);
            if (!sp || !pos) continue;
            const march = getActiveMarchForDino(dDef.id);
            const respawning = dState.respawnAt > now && !march;
            const wx = pos.wx.toFixed(2);
            const wy = pos.wy.toFixed(2);
            let progHtml = '';
            if (march) {
              const total = Math.max(1000, march.phaseEndsAt - march.startedAt);
              const pct = Math.min(100, Math.max(4, ((now - march.startedAt) / total) * 100));
              progHtml = `<div class="wm-mini-prog"><div class="wm-mini-prog-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
            }
            const shortDino = sp.name.split('-').pop();
            const subLabel = respawning
              ? `Respawn ${fmtClock(Math.max(0, (dState.respawnAt - now) / 1000))}`
              : march
              ? march.phase === 'marching_out'
                ? 'Jagd...'
                : 'Rückmarsch'
              : shortDino;

            markersHtml += `
              <button
                class="wm-node is-dino ${respawning ? 'depleted' : ''} ${march ? 'active-hunt' : ''}"
                data-wm-dino="${dDef.id}"
                data-wx="${wx}"
                data-wy="${wy}"
                data-y-off="8"
                style="--node-accent:${sp.accent};"
                aria-label="${sp.name} Stufe ${dState.level}"
              >
                <div class="wm-caption">
                  <div class="wm-cap-row">
                    <span class="wm-cap-dot"></span>
                    <span class="wm-cap-lvl">${dState.level}</span>
                    <span class="wm-cap-name">${subLabel}</span>
                  </div>
                  ${progHtml}
                </div>
              </button>
            `;
          }
          markersEl.innerHTML = markersHtml;

          // 2. Interaktive quadratische 1:1 Minimap (1200×1200 -> 120×120)
          const miniSvg = document.getElementById('wmMinimapSvg');
          const mScale = 120 / WORLD_GRID_COLS;
          const vMiniRingColor = vIsBattle
            ? '#f97316'
            : vHolderStatus === 'own'
            ? '#4ade80'
            : '#38bdf8';
          let miniHtml = `
            <rect width="120" height="120" fill="#181412" />
            <circle cx="60" cy="60" r="15" fill="${vIsBattle ? 'rgba(249,115,22,0.34)' : 'rgba(56,189,248,0.18)'}" stroke="${vMiniRingColor}" stroke-width="1" />
            <circle cx="60" cy="60" r="6.5" fill="${vHolderStatus === 'own' ? '#22c55e' : '#ea580c'}" />
          `;
          for (const march of state.worldMarches || []) {
            const isHunt = march.kind === 'hunt';
            const isVolcano = march.kind === 'volcano';
            const livePos = isVolcano ? VOLCANO_POS : isHunt ? getDinoPos(march.dinoId) : getNodePos(march.nodeId);
            const tx = typeof march.targetX === 'number' ? march.targetX : livePos ? livePos.xPct : null;
            const ty = typeof march.targetY === 'number' ? march.targetY : livePos ? livePos.yPct : null;
            if (tx === null || ty === null) continue;
            const col = march.phase === 'marching_back' ? '#4ade80' : isVolcano ? '#f97316' : isHunt ? '#f87171' : '#fbbf24';
            miniHtml += `<line x1="${(home.wx * mScale).toFixed(1)}" y1="${(home.wy * mScale).toFixed(1)}" x2="${(tx * 1.2).toFixed(1)}" y2="${(ty * 1.2).toFixed(1)}" stroke="${col}" stroke-width="1.2" opacity="0.88" />`;
          }
          for (const def of WORLD_NODES) {
            const info = getWorldNodeInfo(def.id);
            const nState = getWorldNodeState(def.id);
            const enemyOcc = getEnemyNodeOccupant(def.id);
            if (!info) continue;
            const col = enemyOcc ? '#ef4444' : nState.remaining > 0 ? RESOURCE_COLORS[info.resource] : '#57534e';
            miniHtml += `<circle cx="${(info.xPct * 1.2).toFixed(1)}" cy="${(info.yPct * 1.2).toFixed(1)}" r="${enemyOcc ? '1.8' : '1.25'}" fill="${col}" />`;
          }
          for (const dDef of WORLD_DINOS) {
            const dState = getWorldDinoState(dDef.id);
            const col = dState.respawnAt > now ? '#57534e' : '#f87171';
            miniHtml += `<circle cx="${(dState.xPct * 1.2).toFixed(1)}" cy="${(dState.yPct * 1.2).toFixed(1)}" r="1.25" fill="${col}" />`;
          }
          for (const pl of mpWorld.settlements || []) {
            if (ownUid && pl.uid === ownUid) continue;
            const mx = (Number(pl.tileX) + 1) * mScale;
            const my = (Number(pl.tileY) + 1) * mScale;
            miniHtml += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="2.8" fill="#38bdf8" stroke="#082f49" stroke-width="0.9" />`;
          }
          miniHtml += `<circle cx="${(home.wx * mScale).toFixed(1)}" cy="${(home.wy * mScale).toFixed(1)}" r="3.4" fill="#4ade80" stroke="#052e16" stroke-width="1" />`;
          miniHtml += `<rect id="wmMiniViewportRect" x="0" y="0" width="24" height="24" fill="rgba(245,239,230,0.1)" stroke="#f5efe6" stroke-width="1.2" rx="1.5" />`;
          miniSvg.innerHTML = miniHtml;

          // 3. Kamera anwenden (zeichnet Canvas, projiziert Marker, Marsch-SVG & Minimap-Rechteck)
          if (!worldCam.initialized && vp.clientWidth > 0) {
            worldCam.initialized = true;
            setWorldCameraTarget(home.wx, home.wy, WORLD_CAM_DEFAULT_ZOOM, false);
          } else {
            applyWorldCamera(worldCam.cx, worldCam.cy, worldCam.zoom);
          }

          // 4. Ghost-Teleport-Modus oder Marsch-Warteschlange
          renderTeleportGhostUI();

          const marchBar = document.getElementById('wmMarchBar');
          const hintStrip = document.getElementById('wmHintStrip');
          const marches = state.worldMarches || [];
          if (teleportGhost.active) {
            marchBar.classList.remove('visible');
            hintStrip.style.display = 'none';
          } else if (marches.length === 0) {
            marchBar.classList.remove('visible');
            marchBar.innerHTML = '';
            hintStrip.style.display = 'block';
          } else {
            hintStrip.style.display = 'none';
            marchBar.classList.add('visible');
            marchBar.innerHTML = marches
              .map((m) => {
                const rem = Math.max(0, (m.phaseEndsAt - now) / 1000);
                if (m.kind === 'volcano') {
                  const soldCnt = (m.troops?.slinger || 0) + (m.troops?.clubman || 0) + (m.troops?.dinorider || 0);
                  const hCnt = (m.heroes || []).length;
                  const phaseText =
                    m.phase === 'marching_out'
                      ? `${m.isReinforce ? 'Verstärkung' : 'Sturmangriff'} (${hCnt} Helden · ${soldCnt} Soldaten)`
                      : m.phase === 'attacking'
                      ? 'Gefecht um die Vulkan-Zitadelle...'
                      : `Rückmarsch (${hCnt} Helden · ${soldCnt} Soldaten)`;
                  return `
                    <div class="wm-march-card is-volcano" data-wm-focus-volcano="1">
                      <div class="wm-march-meta">
                        <div class="wm-march-title">
                          <span style="color:#fed7aa;">🌋 Vulkan-Zitadelle [600, 600]</span>
                          <span class="mono">${fmtClock(rem)}</span>
                        </div>
                        <div class="wm-march-phase">${phaseText}</div>
                      </div>
                      ${
                        m.phase === 'marching_out'
                          ? `<button class="wm-recall-btn" data-wm-recall="${m.id}">Zurück</button>`
                          : `<span class="mono" style="font-size:11px; color:var(--state-ok); font-weight:700;">${m.phase === 'attacking' ? 'Kampf' : 'Heimweg'}</span>`
                      }
                    </div>
                  `;
                }
                if (m.kind === 'hunt') {
                  const sp = getDinoSpecies(m.speciesId);
                  const dDef = getWorldDinoDef(m.dinoId);
                  if (!sp || !dDef) return '';
                  const soldCnt = (m.troops?.slinger || 0) + (m.troops?.clubman || 0) + (m.troops?.dinorider || 0);
                  const hCnt = (m.heroes || []).length;
                  const phaseText =
                    m.phase === 'marching_out'
                      ? `Jagd-Hinmarsch (${hCnt} Helden · ${soldCnt} Soldaten)`
                      : m.outcome && m.outcome.victory
                      ? `Rückmarsch mit Beute (Sieg!)`
                      : m.outcome
                      ? `Rückzug zur Siedlung`
                      : `Rückmarsch (${hCnt} Helden · ${soldCnt} Soldaten)`;
                  return `
                    <div class="wm-march-card is-hunt" data-wm-focus-dino="${dDef.id}">
                      <div class="wm-march-meta">
                        <div class="wm-march-title">
                          <span style="color:#fecaca;">Jagd: ${sp.name} (St. ${m.dinoLevel})</span>
                          <span class="mono">${fmtClock(rem)}</span>
                        </div>
                        <div class="wm-march-phase">${phaseText}</div>
                      </div>
                      ${
                        m.phase !== 'marching_back'
                          ? `<button class="wm-recall-btn" data-wm-recall="${m.id}">Zurück</button>`
                          : m.battleId
                          ? `<button class="battle-watch-btn" data-open-battle="${m.battleId}">Kampf-Log</button>`
                          : `<span class="mono" style="font-size:11px; color:var(--state-ok); font-weight:700;">Heimweg</span>`
                      }
                    </div>
                  `;
                }

                const info = getWorldNodeInfo(m.nodeId);
                const nodeTitle = m.targetName || (info ? info.name : 'Sammelstelle');
                const nodeLvl = m.targetLevel || (info ? info.level : 1);
                const resKey = m.targetResource || (info ? info.resource : 'wood');
                const hCnt = (m.heroes || []).length;
                const soldCnt = (m.troops?.slinger || 0) + (m.troops?.clubman || 0) + (m.troops?.dinorider || 0);
                const squadLabel =
                  hCnt > 0 || soldCnt > 0
                    ? `${hCnt} Helden · ${soldCnt} Soldaten`
                    : `${m.workers || 1} Sammler`;
                const phaseText =
                  m.phase === 'marching_out'
                    ? `Hinmarsch (${squadLabel})`
                    : m.phase === 'occupying'
                    ? `Sammelstelle sichern / PvP...`
                    : m.phase === 'gathering'
                    ? `Sammelt ${RESOURCE_LABELS[resKey]} (${squadLabel})`
                    : `Rückmarsch (+${m.carriedAmount} ${RESOURCE_LABELS[resKey]})`;
                return `
                  <div class="wm-march-card" data-wm-focus-node="${m.nodeId}">
                    <div class="wm-march-meta">
                      <div class="wm-march-title">
                        <span>${nodeTitle} (St. ${nodeLvl})</span>
                        <span class="mono">${fmtClock(rem)}</span>
                      </div>
                      <div class="wm-march-phase">${phaseText}</div>
                    </div>
                    ${
                      m.phase !== 'marching_back'
                        ? `<button class="wm-recall-btn" data-wm-recall="${m.id}">Zurück</button>`
                        : `<span class="mono" style="font-size:11px; color:var(--state-ok); font-weight:700;">Heimweg</span>`
                    }
                  </div>
                `;
              })
              .join('');
          }
        }

        /* =====================================================================
           10. DETAIL-POPUPS (GEBÄUDE, FORSCHUNG & WELTKARTE)
           ===================================================================== */
        function openBuildingSheet(buildingId, preferredSubTab) {
          const def = BUILDINGS[buildingId];
          if (!def) return;
          if (!BuildingRegistry.isVisibleInUI(buildingId, state)) {
            const missingText = BuildingRegistry.getMissingRequirementsText(buildingId, state);
            SoundFX.play('error');
            showToast(
              `${def.name} noch nicht freigeschaltet${missingText ? ` (Benötigt: ${missingText})` : ''}.`,
              'warn'
            );
            return;
          }
          let defaultSub = preferredSubTab || 'building';
          if (!preferredSubTab) {
            if (buildingId === 'workshop') {
              defaultSub = state.buildings.workshop.level > 0 ? 'tree' : 'building';
            } else if (buildingId === 'hero_cave') {
              defaultSub = state.buildings.hero_cave.level > 0 ? 'summon' : 'building';
            } else if (buildingId === 'infirmary') {
              defaultSub = state.buildings.infirmary.level > 0 ? 'heal' : 'building';
            } else if (buildingId === 'graveyard') {
              defaultSub = state.buildings.graveyard.level > 0 ? 'revive' : 'building';
            } else if (buildingId === 'marketplace') {
              defaultSub = state.buildings.marketplace.level > 0 ? 'market' : 'building';
            } else if (buildingId === 'warehouse') {
              defaultSub = state.buildings.warehouse.level > 0 ? 'vault' : 'building';
            } else if (def && def.troopType) {
              defaultSub = state.buildings[buildingId].level > 0 ? 'train' : 'building';
            }
          }
          openSheet = { type: 'building', id: buildingId, subTab: defaultSub };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
        }

        function openResearchSheet(techId) {
          openSheet = { type: 'research', id: techId };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
        }

        function openWorldNodeSheet(nodeId) {
          initGatherDraft(nodeId);
          openSheet = { type: 'worldNode', id: nodeId };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
        }

        function openWorldDinoSheet(dinoId) {
          initHuntDraft(dinoId);
          openSheet = { type: 'worldDino', id: dinoId };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
        }

        function openOwnSettlementSheet() {
          openSheet = { type: 'ownSettlement', id: 'home' };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
        }

        function openVolcanoSheet() {
          initVolcanoDraft();
          openSheet = { type: 'volcano', id: 'central_volcano' };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
          if (window.DinoMultiplayer && typeof window.DinoMultiplayer.refreshVolcanoState === 'function') {
            void window.DinoMultiplayer.refreshVolcanoState().then((fresh) => {
              if (fresh) {
                mpWorld.volcano = fresh;
                if (openSheet && openSheet.type === 'volcano') renderVolcanoSheet();
              }
            });
          }
        }

        function renderVolcanoSheet() {
          const v = getVolcanoState();
          const now = Date.now();
          const isBattle = v.phase === 'battle';
          const holderStatus = getVolcanoHolderStatus(v);
          const activeMarch = getActiveMarchForVolcano();
          const travelSec = Math.max(8, Math.min(28, getWorldMarchTravelSec(VOLCANO_POS)));

          document.getElementById('sheetTitle').textContent = 'Vulkan-Zitadelle';
          document.getElementById('sheetSub').textContent = `Server-Weltwunder · Zyklus #${v.cycleNumber} (alle 4 Wochen) · [X: 600, Y: 600]`;

          // Bereinige volcanoDraft
          const busyHeroes = getDeployedHeroIds();
          volcanoDraft.heroIds = (volcanoDraft.heroIds || [])
            .filter((id) => !busyHeroes.has(id) && state.heroes && state.heroes[id] && state.heroes[id].unlocked)
            .slice(0, 3);
          for (const tk of Object.keys(TROOP_DEFS)) {
            volcanoDraft.troops[tk] = Math.min(getAvailableTroopCount(tk), Math.max(0, volcanoDraft.troops[tk] || 0));
          }

          const totalSelectedSoldiers = Object.keys(TROOP_DEFS).reduce((s, k) => s + (volcanoDraft.troops[k] || 0), 0);
          const selectedHeroCount = volcanoDraft.heroIds.length;
          const squadInfo = computeGatherSquadPower(volcanoDraft.heroIds, volcanoDraft.troops, 0);
          const garrisonPower = Math.max(1, Number(v.garrisonPower) || 380);
          const countdownText = isBattle
            ? fmtVolcanoCountdown(v.battleEndsAt - now)
            : fmtVolcanoCountdown(v.nextBattleAt - now);
          const rulerName = v.holderTribeName ? escapeHtmlMp(v.holderTribeName) : 'Vulkan-Wächter (Neutral)';
          const garrisonHeroNames = Array.isArray(v.garrisonHeroNames) && v.garrisonHeroNames.length
            ? v.garrisonHeroNames.map((n) => escapeHtmlMp(n)).join(', ')
            : 'Kaldera-Wache';

          const ratio = squadInfo.total / garrisonPower;
          const oddsLabel =
            holderStatus === 'own'
              ? 'Verstärkt eigene Garnison'
              : selectedHeroCount === 0 && totalSelectedSoldiers === 0
              ? 'Trupp auswählen'
              : ratio >= 1.2
              ? 'Hohe Eroberungschance'
              : ratio >= 0.95
              ? 'Offener Großkampf (±10%)'
              : 'Garnison aktuell stärker';
          const oddsColor =
            holderStatus === 'own'
              ? '#4ade80'
              : ratio >= 1.2
              ? '#4ade80'
              : ratio >= 0.95
              ? '#fbbf24'
              : '#f87171';

          let html = `
            <div class="volcano-hero-banner ${isBattle ? '' : 'is-peace'} ${holderStatus === 'own' ? 'is-own' : ''}">
              <div class="volcano-banner-head">
                <span class="volcano-phase-badge ${isBattle ? 'is-battle' : 'is-peace'}">
                  ${isBattle ? '⚔ Server-Kampf Aktiv' : '🛡 4-Wochen Kaldera-Schild'}
                </span>
                <span class="mono" style="font-size:11px; color:#fde68a; font-weight:700;">Zyklus #${v.cycleNumber}</span>
              </div>
              <div class="volcano-countdown-box">
                <div>
                  <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">
                    ${isBattle ? 'Kampf-Fenster schließt in' : 'Nächster 4-Wochen-Kampf in'}
                  </div>
                  <div style="font-size:11.5px; color:var(--text-secondary); margin-top:2px;">
                    ${isBattle ? 'Alle Stämme können die Zitadelle jetzt angreifen & erobern!' : 'Der Herrscher regiert unter dem Schutzschild bis zum nächsten Zyklus.'}
                  </div>
                </div>
                <div class="mono" style="font-size:15px; font-weight:800; color:${isBattle ? '#fb923c' : '#7dd3fc'}; white-space:nowrap;">
                  ${countdownText}
                </div>
              </div>
              <div class="stat-grid">
                <div class="stat-box">
                  <div class="stat-label">Herrscher der Kaldera</div>
                  <div class="stat-value" style="color:${holderStatus === 'own' ? '#4ade80' : v.holderUid ? '#fca5a5' : '#fde68a'};">
                    ${v.holderUid ? `👑 ${rulerName}` : rulerName}
                  </div>
                </div>
                <div class="stat-box">
                  <div class="stat-label">Garnison-Kampfkraft</div>
                  <div class="stat-value mono" style="color:#fb923c;">KK ${fmtNum(garrisonPower)}</div>
                </div>
              </div>
              <div style="font-size:11px; color:var(--text-secondary);">
                Verteidiger: <strong style="color:var(--text-primary);">${garrisonHeroNames}</strong> · Marschzeit: <span class="mono">${fmtDuration(travelSec)}</span>
              </div>
            </div>

            <div>
              <p class="sheet-section-title">Herrscher-Segen der Vulkan-Zitadelle ${holderStatus === 'own' ? '(AKTIV FÜR DEINEN STAMM!)' : '(Für den siegreichen Stamm)'}</p>
              <div class="volcano-buff-grid">
                <div class="volcano-buff-chip">
                  <div class="volcano-buff-val">+20%</div>
                  <div class="volcano-buff-lbl">Dorf-Produktion</div>
                </div>
                <div class="volcano-buff-chip">
                  <div class="volcano-buff-val">+15%</div>
                  <div class="volcano-buff-lbl">Trupp-Kampfkraft</div>
                </div>
                <div class="volcano-buff-chip">
                  <div class="volcano-buff-val">+3 🦴</div>
                  <div class="volcano-buff-lbl">Gold-Knochen / Sieg</div>
                </div>
              </div>
            </div>
          `;

          if (activeMarch) {
            const total = Math.max(1000, activeMarch.phaseEndsAt - activeMarch.startedAt);
            const rem = Math.max(0, (activeMarch.phaseEndsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((now - activeMarch.startedAt) / total) * 100));
            const phaseLabel =
              activeMarch.phase === 'marching_out'
                ? activeMarch.isReinforce
                  ? 'Verstärkung marschiert zur Vulkan-Zitadelle'
                  : 'Sturmtrupp marschiert zur Vulkan-Zitadelle'
                : activeMarch.phase === 'attacking'
                ? 'Entscheidungsschlacht an der Kaldera...'
                : 'Sturmtrupp auf dem Rückweg';
            html += `
              <div class="stat-box">
                <div class="queue-title"><span>${phaseLabel}</span><span class="mono">${fmtClock(rem)}</span></div>
                <div class="prog-bar"><div class="prog-fill ${activeMarch.phase === 'marching_back' ? 'done' : ''}" style="width:${pct.toFixed(1)}%"></div></div>
                <div style="margin-top:6px; font-size:11px; color:var(--text-secondary);">
                  Kampfkraft: <strong class="mono">KK ${fmtNum(activeMarch.squadPower || 0)}</strong>
                </div>
              </div>
            `;
            if (activeMarch.phase === 'marching_out') {
              html += `<button class="btn-secondary" data-wm-recall="${activeMarch.id}">Sturmtrupp zurückrufen</button>`;
            }
          } else if (isBattle) {
            const unlockedHeroes = HEROES_LIST.filter((h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked);
            html += `
              <div>
                <p class="sheet-section-title">Helden für den Vulkan-Kampf wählen (${selectedHeroCount} / 3)</p>
                <div class="hunt-hero-grid">
                  ${unlockedHeroes
                    .map((h) => {
                      const hSt = state.heroes[h.id];
                      const busy = busyHeroes.has(h.id);
                      const sel = volcanoDraft.heroIds.includes(h.id);
                      const pwr = getHeroPower(h, hSt);
                      return `
                        <button class="hunt-hero-btn ${sel ? 'selected' : ''}" data-volcano-toggle-hero="${h.id}" ${busy ? 'disabled' : ''}>
                          <div style="display:flex; width:100%; justify-content:space-between; align-items:center; gap:4px;">
                            <span style="font-size:11.5px; font-weight:700; color:var(--text-primary);">${h.name.split(' ')[0]}</span>
                            <span class="mono" style="font-size:10px; color:${busy ? '#f87171' : sel ? '#fbbf24' : 'var(--text-muted)'};">${busy ? 'Im Einsatz' : `KK ${fmtNum(pwr)}`}</span>
                          </div>
                          <span style="font-size:10px; color:var(--text-secondary);">St. ${hSt.level} · ${h.role}</span>
                        </button>
                      `;
                    })
                    .join('')}
                </div>
              </div>
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
                  <p class="sheet-section-title" style="margin:0;">Soldaten für den Sturmangriff</p>
                  <div style="display:inline-flex; gap:5px;">
                    <button class="hunt-mini-btn" data-volcano-fill-all="1">Alle</button>
                    <button class="hunt-mini-btn" data-volcano-clear="1">0</button>
                  </div>
                </div>
                <div class="hunt-troop-list">
                  ${Object.entries(TROOP_DEFS)
                    .map(([tk, td]) => {
                      const avail = getAvailableTroopCount(tk);
                      const chosen = volcanoDraft.troops[tk] || 0;
                      return `
                        <div class="hunt-troop-row">
                          <div>
                            <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${td.name}</div>
                            <div class="mono" style="font-size:10.5px; color:var(--text-secondary);">Gewählt: ${chosen} / ${avail} frei</div>
                          </div>
                          <div class="hunt-troop-controls">
                            <button class="hunt-mini-btn" data-volcano-troop-delta="${tk}|-10" ${chosen <= 0 ? 'disabled' : ''}>-10</button>
                            <button class="hunt-mini-btn" data-volcano-troop-delta="${tk}|-1" ${chosen <= 0 ? 'disabled' : ''}>−</button>
                            <button class="hunt-mini-btn" data-volcano-troop-delta="${tk}|1" ${chosen >= avail ? 'disabled' : ''}>+</button>
                            <button class="hunt-mini-btn" data-volcano-troop-max="${tk}" ${chosen >= avail ? 'disabled' : ''}>Max</button>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </div>
              <div class="stat-box" style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:11.5px; color:var(--text-secondary);">Sturmtrupp-KK: <strong class="mono" style="color:var(--text-primary);">${fmtNum(squadInfo.total)}</strong></span>
                <span style="font-size:11.5px; font-weight:700; color:${oddsColor};">${oddsLabel}</span>
              </div>
              <button
                class="btn-primary"
                data-volcano-launch="1"
                ${(selectedHeroCount === 0 && totalSelectedSoldiers === 0) || state.worldMarches.length >= getMaxWorldMarches() ? 'disabled' : ''}
              >
                ${
                  state.worldMarches.length >= getMaxWorldMarches()
                    ? `Alle ${getMaxWorldMarches()} Marschwarteschlangen belegt`
                    : holderStatus === 'own'
                    ? `🛡 Vulkan-Garnison verstärken (KK ${fmtNum(squadInfo.total)})`
                    : `🌋 Vulkan-Zitadelle angreifen (KK ${fmtNum(squadInfo.total)})`
                }
              </button>
            `;
          } else {
            html += `
              <div class="stat-box" style="text-align:center; padding:12px;">
                <div style="font-size:12.5px; font-weight:700; color:#7dd3fc;">🛡 Kaldera-Schild aktiv</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:4px; line-height:1.45;">
                  Die Vulkan-Zitadelle wird alle <strong>4 Wochen</strong> für 6 Stunden vom gesamten Server umkämpft. Rüste deine Helden & Kasernen aus, bis der Schild in <strong class="mono" style="color:#fde68a;">${countdownText}</strong> fällt!
                </div>
              </div>
            `;
          }

          const logs = Array.isArray(v.recentBattles) ? v.recentBattles : [];
          html += `
            <div>
              <p class="sheet-section-title">Kaldera-Chronik (Letzte Kämpfe)</p>
              <div class="volcano-log-list">
                ${
                  logs.length === 0
                    ? `<div class="volcano-log-row">Noch keine Kämpfe in diesem Server-Zyklus aufgezeichnet. Sei der erste Stamm, der die Zitadelle stürmt!</div>`
                    : logs
                        .slice(0, 6)
                        .map((b) => {
                          const atk = escapeHtmlMp(b.attackerTribeName || 'Stamm');
                          const def = escapeHtmlMp(b.defenderTribeName || 'Vulkan-Wächter');
                          const ts = new Date(b.timestamp || now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                          const isReinforce = Boolean(b.reinforced);
                          const isConquest = Boolean(b.attackerWon && !isReinforce);
                          const label = isReinforce
                            ? `🛡 Verstärkt: ${atk}`
                            : isConquest
                            ? `👑 Eroberung: ${atk} besiegt ${def}`
                            : `🛡 Abgewehrt: ${atk} vs. ${def}`;
                          return `
                            <div class="volcano-log-row ${isConquest ? 'is-conquest' : ''}">
                              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:2px;">
                                <strong style="color:${isConquest ? '#fed7aa' : 'var(--text-primary)'};">
                                  ${label}
                                </strong>
                                <span class="mono" style="font-size:10px; color:var(--text-muted);">${ts}</span>
                              </div>
                              <div class="mono" style="font-size:10px; color:var(--text-muted);">
                                Angriff KK ${fmtNum(b.attackerPower || 0)} · Verteidigung KK ${fmtNum(b.defenderPower || 0)} · Zyklus #${b.cycleNumber || v.cycleNumber}
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                }
              </div>
            </div>
          `;

          document.getElementById('sheetBody').innerHTML = html;
        }

        function openShamanTotemSheet() {
          ShamanTotemSystem.initDraft(state);
          openSheet = { type: 'shamanTotem', id: 'shamanTotem' };
          document.getElementById('detailBackdrop').classList.add('open');
          renderSheet();
        }

        function renderShamanTotemSheet() {
          const status = ShamanTotemSystem.getStatus(state);
          document.getElementById('sheetTitle').textContent = 'Schamanen-Totem';
          document.getElementById('sheetSub').textContent = status.graveyardBuilt
            ? `Aktives Ritual-Item · Friedhof St. ${status.graveyardLevel} · ${status.totems}× verfügbar`
            : `Aktives Ritual-Item · ${status.totems}× im Inventar`;

          if (!status.graveyardBuilt) {
            const missingText = BuildingRegistry.getMissingRequirementsText('graveyard', state);
            document.getElementById('sheetBody').innerHTML = `
              <div class="summon-banner" style="--banner-accent:rgba(45, 212, 191, 0.5);">
                <div class="summon-head">
                  <span class="summon-title" style="color:#5eead4;">
                    ${getInventoryIconSVG('shamanTotem', '#2dd4bf')}
                    <span>Friedhof erforderlich</span>
                  </span>
                  <span class="summon-stock" style="color:#2dd4bf;">${status.totems}× Totem</span>
                </div>
                <div class="summon-odds">
                  Um gefallene Krieger mit einem <strong>Schamanen-Totem</strong> wiederzubeleben, muss der <strong>Friedhof</strong> im Dorf errichtet sein.
                  ${status.totalFallen > 0 ? `<br/>Aktuell warten <strong>${status.totalFallen} gefallene Krieger</strong> auf ihre Wiedererweckung.` : ''}
                </div>
                ${
                  status.graveyardVisible
                    ? `<button class="btn-primary" style="margin-top:8px;" data-jump-building="graveyard" data-jump-subtab="building">Friedhof errichten →</button>`
                    : `<div class="req-row missing" style="margin-top:8px;">
                        <div class="req-main"><span class="req-mark">✕</span><span>Voraussetzung: ${missingText || 'Krankenzelt St. 1'}</span></div>
                      </div>`
                }
              </div>
            `;
            return;
          }

          const draft = ShamanTotemSystem.getDraft();
          const selectedTotal = ShamanTotemSystem.getDraftTotal();
          const budget = status.revivePerTotem;
          const remainingSlots = Math.max(0, budget - selectedTotal);
          const canCastCustom = status.canRevive && selectedTotal > 0;

          const troopRows = ShamanTotemSystem.PRIORITY_ORDER.map((key) => {
            const td = TROOP_DEFS[key];
            const avail = status.fallen[key] || 0;
            const chosen = draft[key] || 0;
            const maxForThis = Math.min(avail, chosen + remainingSlots);
            return `
              <div class="hunt-troop-row">
                <div>
                  <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${td.name} <span style="font-size:10.5px; color:var(--text-muted);">(${td.role})</span></div>
                  <div class="mono" style="font-size:10.5px; color:${avail > 0 ? '#fca5a5' : 'var(--text-muted)'};">Gewählt: ${chosen} / ${avail} gefallen</div>
                </div>
                <div class="hunt-troop-controls">
                  <button class="hunt-mini-btn" data-totem-delta="${key}|-5" ${chosen <= 0 ? 'disabled' : ''}>-5</button>
                  <button class="hunt-mini-btn" data-totem-delta="${key}|-1" ${chosen <= 0 ? 'disabled' : ''}>−</button>
                  <button class="hunt-mini-btn" data-totem-delta="${key}|1" ${chosen >= maxForThis ? 'disabled' : ''}>+</button>
                  <button class="hunt-mini-btn" data-totem-max="${key}" ${chosen >= maxForThis ? 'disabled' : ''}>Max</button>
                </div>
              </div>
            `;
          }).join('');

          document.getElementById('sheetBody').innerHTML = `
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Schamanen-Totems</div>
                <div class="stat-value mono" style="color:#2dd4bf;">${status.totems} verfügbar</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Gefallene (Friedhof St. ${status.graveyardLevel})</div>
                <div class="stat-value mono" style="color:${status.totalFallen > 0 ? '#f87171' : '#4ade80'};">${status.totalFallen} Einheiten</div>
              </div>
            </div>
            <div>
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
                <p class="sheet-section-title" style="margin:0;">Einheiten wählen (${selectedTotal} / ${budget} pro Totem)</p>
                <div style="display:inline-flex; gap:5px;">
                  <button class="hunt-mini-btn" data-totem-auto="1" ${status.totalFallen <= 0 ? 'disabled' : ''}>Auto</button>
                  <button class="hunt-mini-btn" data-totem-clear="1" ${selectedTotal <= 0 ? 'disabled' : ''}>0</button>
                </div>
              </div>
              <div class="hunt-troop-list">${troopRows}</div>
            </div>
            <div class="summon-banner" style="--banner-accent:rgba(45, 212, 191, 0.5);">
              <div class="summon-head">
                <span class="summon-title" style="color:#5eead4;">
                  ${getInventoryIconSVG('shamanTotem', '#2dd4bf')}
                  <span>Wiederbelebung auslösen</span>
                </span>
                <span class="summon-stock" style="color:#2dd4bf;">1 Totem → bis ${budget} Einh.</span>
              </div>
              <div class="summon-odds">
                Wiederbelebte Krieger kehren sofort kampfbereit in dein Stammesheer zurück. Ein Ausbau des Friedhofs erhöht die Kapazität pro Totem (+3 Einheiten/Stufe).
              </div>
              <button class="btn-primary" style="margin-top:8px;" data-totem-cast-custom="1" ${canCastCustom ? '' : 'disabled'}>
                ${
                  status.totalFallen <= 0
                    ? 'Keine gefallenen Einheiten'
                    : status.totems <= 0
                    ? 'Kein Schamanen-Totem vorhanden'
                    : selectedTotal <= 0
                    ? 'Einheiten auswählen'
                    : `1× Schamanen-Totem einsetzen (${selectedTotal} Einh. wiederbeleben)`
                }
              </button>
              ${
                status.canRevive && status.usableTotemsForAll > 1
                  ? `<button class="btn-secondary" style="margin-top:6px; width:100%;" data-totem-cast-all="1">Alle mit ${status.usableTotemsForAll}× Schamanen-Totems wiederbeleben</button>`
                  : ''
              }
            </div>
          `;
        }

        function closeSheet() {
          openSheet = null;
          document.getElementById('detailBackdrop').classList.remove('open');
        }

        function renderSheet() {
          if (!openSheet) return;
          if (openSheet.type === 'building') {
            renderBuildingSheet(openSheet.id, openSheet.subTab || 'building');
          } else if (openSheet.type === 'research') {
            renderResearchSheet(openSheet.id);
          } else if (openSheet.type === 'worldNode') {
            renderWorldNodeSheet(openSheet.id);
          } else if (openSheet.type === 'worldDino') {
            renderWorldDinoSheet(openSheet.id);
          } else if (openSheet.type === 'ownSettlement') {
            renderOwnSettlementSheet();
          } else if (openSheet.type === 'volcano') {
            renderVolcanoSheet();
          } else if (openSheet.type === 'shamanTotem') {
            renderShamanTotemSheet();
          }
        }

        function renderWorldDinoSheet(dinoId) {
          const def = getWorldDinoDef(dinoId);
          if (!def) return;
          const dState = getWorldDinoState(dinoId);
          const sp = getDinoSpecies(dState.speciesId);
          if (!sp) return;
          const now = Date.now();
          const march = getActiveMarchForDino(dinoId);
          const bestEntry = getBestiaryEntry(sp.id);
          const dinoPos = getDinoPos(dinoId) || def;
          const dinoPower = getDinoCombatPower(sp, dState.level);
          const travelSec = getWorldMarchTravelSec(dinoPos);
          const activeMarches = (state.worldMarches || []).length;
          const maxMarches = getMaxWorldMarches();
          const coordX = dinoPos.coordX ?? Math.round((dinoPos.xPct / 100) * WORLD_GRID_COLS);
          const coordY = dinoPos.coordY ?? Math.round((dinoPos.yPct / 100) * WORLD_GRID_ROWS);

          document.getElementById('sheetTitle').textContent = `${sp.name} · St. ${dState.level}`;
          document.getElementById('sheetSub').textContent = `${sp.tier} · Empf. KK ${fmtNum(dinoPower)} · [X: ${coordX}, Y: ${coordY}]`;

          let html = `
            <div class="bestiary-head" style="padding:10px; border-radius:12px; background:rgba(16,13,11,0.85); border:1px solid var(--border-subtle);">
              <div class="bestiary-icon" style="--dino-accent:${sp.accent};">
                ${getDinoIconSVG(sp.id, 28, sp.accent)}
              </div>
              <div style="flex:1; min-width:0;">
                <div style="font-size:12px; color:var(--text-secondary); line-height:1.4;">${sp.desc}</div>
                <div style="margin-top:4px; font-size:11px; color:${bestEntry.huntedCount > 0 ? '#4ade80' : '#fbbf24'}; font-weight:600;">
                  ${bestEntry.huntedCount > 0 ? `Im Bestiarium · ${bestEntry.huntedCount}× erjagt` : bestEntry.discovered ? 'Im Bestiarium entdeckt' : 'Unentdeckte Art — Jagd schaltet Bestiarium frei!'}
                </div>
              </div>
            </div>
            <div class="bestiary-strength-list">
              ${sp.strengths.map((s) => `<span class="bestiary-strength-chip">${s}</span>`).join('')}
            </div>
            <div class="bestiary-counter-box">${sp.weaknessTip}</div>
            <div class="bestiary-loot-grid">
              ${sp.lootTable
                .map(
                  (lt) => `
                  <div class="bestiary-loot-row">
                    <span style="color:var(--text-primary); font-weight:600;">${lt.label}</span>
                    <span class="mono" style="color:${lt.chancePct >= 80 ? '#4ade80' : '#fbbf24'}; font-weight:700;">${lt.chancePct}%</span>
                  </div>
                `
                )
                .join('')}
            </div>
          `;

          if (march) {
            const total = Math.max(1000, march.phaseEndsAt - march.startedAt);
            const rem = Math.max(0, (march.phaseEndsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((now - march.startedAt) / total) * 100));
            const phaseLabel =
              march.phase === 'marching_out'
                ? 'Jagdtrupp auf dem Hinmarsch'
                : march.outcome && march.outcome.victory
                ? 'Sieg! Trupp kehrt mit Beute zurück'
                : 'Trupp kehrt zur Siedlung zurück';
            html += `
              <div class="stat-box">
                <div class="queue-title"><span>${phaseLabel}</span><span class="mono">${fmtClock(rem)}</span></div>
                <div class="prog-bar"><div class="prog-fill ${march.phase === 'marching_back' ? 'done' : ''}" style="width:${pct.toFixed(1)}%"></div></div>
              </div>
            `;
            if (march.phase !== 'marching_back') {
              html += `<button class="btn-secondary" data-wm-recall="${march.id}">Jagdtrupp zurückrufen</button>`;
            }
            document.getElementById('sheetBody').innerHTML = html;
            return;
          }

          if (dState.respawnAt > now) {
            const respRem = Math.max(0, (dState.respawnAt - now) / 1000);
            html += `
              <div class="req-row missing">
                <div class="req-main"><span class="req-mark">✕</span><span>Saurier wurde erlegt · Neuer Saurier erscheint in <strong class="mono">${fmtClock(respRem)}</strong></span></div>
              </div>
            `;
            document.getElementById('sheetBody').innerHTML = html;
            return;
          }

          // Bereinige Entwurf von inzwischen beschäftigten Helden / Truppen
          const busyHeroes = getDeployedHeroIds();
          huntDraft.heroIds = (huntDraft.heroIds || []).filter((id) => !busyHeroes.has(id) && state.heroes && state.heroes[id] && state.heroes[id].unlocked);
          for (const tk of Object.keys(TROOP_DEFS)) {
            huntDraft.troops[tk] = Math.min(getAvailableTroopCount(tk), Math.max(0, huntDraft.troops[tk] || 0));
          }

          // 3 Helden-Klassen-Slots (streng max. 1 pro Art: Nahkampf, Tank, Fernkampf)
          const roleSlots = ['Nahkampf', 'Tank', 'Fernkampf'].map((role) => {
            const hId = huntDraft.heroIds.find((id) => {
              const hd = HEROES_LIST.find((h) => h.id === id);
              return hd && hd.role === role;
            });
            const hd = hId ? HEROES_LIST.find((h) => h.id === hId) : null;
            return `
              <div class="hunt-slot-box ${hd ? 'filled' : ''}">
                <div class="hunt-slot-role">${role}</div>
                <div class="hunt-slot-name">${hd ? hd.name.split(' ')[0] : 'Leer'}</div>
              </div>
            `;
          });

          const unlockedHeroes = HEROES_LIST.filter((h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked);

          html += `
            <div>
              <p class="sheet-section-title">Helden wählen (Max. 3 · nur 1 Held pro Art)</p>
              <div class="hunt-class-slots">${roleSlots.join('')}</div>
              <div class="hunt-hero-grid" style="margin-top:8px;">
                ${unlockedHeroes
                  .map((h) => {
                    const hSt = state.heroes[h.id];
                    const busy = busyHeroes.has(h.id);
                    const sel = huntDraft.heroIds.includes(h.id);
                    const pwr = getHeroPower(h, hSt);
                    return `
                      <button class="hunt-hero-btn ${sel ? 'selected' : ''}" data-hunt-toggle-hero="${h.id}" ${busy ? 'disabled' : ''}>
                        <div style="display:flex; width:100%; justify-content:space-between; align-items:center; gap:4px;">
                          <span style="font-size:11.5px; font-weight:700; color:var(--text-primary);">${h.name.split(' ')[0]}</span>
                          <span class="mono" style="font-size:10px; color:${busy ? '#f87171' : sel ? '#fbbf24' : 'var(--text-muted)'};">${busy ? 'Im Einsatz' : `KK ${fmtNum(pwr)}`}</span>
                        </div>
                        <span style="font-size:10px; color:var(--text-secondary);">${h.role} · St. ${hSt.level}</span>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `;

          // Ausgebildete Soldaten auswählen
          const totalAvailSoldiers = Object.keys(TROOP_DEFS).reduce((s, k) => s + getAvailableTroopCount(k), 0);
          const totalSelectedSoldiers = Object.keys(TROOP_DEFS).reduce((s, k) => s + (huntDraft.troops[k] || 0), 0);

          html += `
            <div>
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
                <p class="sheet-section-title" style="margin:0;">Ausgebildete Soldaten (${totalSelectedSoldiers} gewählt)</p>
                <div style="display:inline-flex; gap:5px;">
                  <button class="hunt-mini-btn" data-hunt-fill-all="1" ${totalAvailSoldiers <= 0 ? 'disabled' : ''}>Alle</button>
                  <button class="hunt-mini-btn" data-hunt-clear="1" ${totalSelectedSoldiers <= 0 ? 'disabled' : ''}>0</button>
                </div>
              </div>
              <div class="hunt-troop-list">
                ${Object.values(TROOP_DEFS)
                  .map((td) => {
                    const avail = getAvailableTroopCount(td.id);
                    const chosen = huntDraft.troops[td.id] || 0;
                    return `
                      <div class="hunt-troop-row">
                        <div>
                          <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${td.name} <span style="font-size:10.5px; color:var(--text-muted);">(${td.role})</span></div>
                          <div class="mono" style="font-size:10.5px; color:var(--text-secondary);">Gewählt: ${chosen} / ${avail} frei · ${td.powerPerUnit} KK</div>
                        </div>
                        <div class="hunt-troop-controls">
                          <button class="hunt-mini-btn" data-hunt-troop-delta="${td.id}|-5" ${chosen <= 0 ? 'disabled' : ''}>-5</button>
                          <button class="hunt-mini-btn" data-hunt-troop-delta="${td.id}|-1" ${chosen <= 0 ? 'disabled' : ''}>−</button>
                          <button class="hunt-mini-btn" data-hunt-troop-delta="${td.id}|1" ${chosen >= avail ? 'disabled' : ''}>+</button>
                          <button class="hunt-mini-btn" data-hunt-troop-max="${td.id}" ${chosen >= avail ? 'disabled' : ''}>Max</button>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `;

          const squadInfo = computeHuntSquadPower(huntDraft.heroIds, huntDraft.troops, sp);
          const ratio = squadInfo.total / Math.max(1, dinoPower);
          const verdict =
            totalSelectedSoldiers <= 0
              ? { label: 'Soldaten wählen', color: '#f87171' }
              : ratio >= 1.3
              ? { label: 'Sicherer Sieg (0 Verluste)', color: '#4ade80' }
              : ratio >= 1.0
              ? { label: 'Hohe Siegchance', color: '#86efac' }
              : ratio >= 0.78
              ? { label: 'Knappes Gefecht', color: '#fbbf24' }
              : { label: 'Sehr riskant', color: '#f87171' };

          tickStaminaRegen(now);
          const curStamina = Math.floor(state.stamina || 0);
          const hasStamina = curStamina >= DINO_HUNT_STAMINA_COST;
          const hasQueueSlot = activeMarches < maxMarches;
          const canLaunch = hasQueueSlot && totalSelectedSoldiers > 0 && hasStamina;
          const bonusNotes = [];
          if (squadInfo.pveBonusPct > 0) bonusNotes.push(`PvE-Skills +${squadInfo.pveBonusPct}%`);
          if (squadInfo.counterBonusPct > 0) bonusNotes.push(`Klassen-Konter +${squadInfo.counterBonusPct}%`);

          html += `
            <div class="hunt-power-bar">
              <div>
                <div style="font-size:10.5px; color:var(--text-muted);">Trupp-Kampfkraft vs. Dino</div>
                <div class="mono" style="font-size:13px; font-weight:700; color:var(--text-primary);">${fmtNum(squadInfo.total)} <span style="color:var(--text-muted);">/</span> ${fmtNum(dinoPower)}</div>
                ${bonusNotes.length ? `<div style="font-size:10px; color:#86efac;">${bonusNotes.join(' · ')}</div>` : ''}
              </div>
              <span style="font-size:11.5px; font-weight:700; color:${verdict.color}; text-align:right;">${verdict.label}</span>
            </div>
            <div class="req-list">
              <div class="req-row ${hasStamina ? 'met' : 'missing'}">
                <div class="req-main"><span class="req-mark">${hasStamina ? '✓' : '✕'}</span><span>Jagd-Ausdauer (${curStamina} / ${DINO_HUNT_STAMINA_COST} benötigt)</span></div>
                ${
                  !hasStamina
                    ? BuildingRegistry.isVisibleInUI('marketplace', state)
                      ? `<button class="jump-btn" data-jump-building="marketplace" data-jump-subtab="${state.buildings.marketplace.level > 0 ? 'market' : 'building'}">Marktplatz →</button>`
                      : `<span style="font-size:10px; color:var(--text-muted); text-align:right;">Marktplatz: ${BuildingRegistry.getMissingRequirementsText('marketplace', state)}</span>`
                    : ''
                }
              </div>
              <div class="req-row ${hasQueueSlot ? 'met' : 'missing'}">
                <div class="req-main"><span class="req-mark">${hasQueueSlot ? '✓' : '✕'}</span><span>Marschwarteschlange frei (${activeMarches}/${maxMarches} · Marsch ${fmtDuration(travelSec)})</span></div>
              </div>
              <div class="req-row ${totalSelectedSoldiers > 0 ? 'met' : 'missing'}">
                <div class="req-main"><span class="req-mark">${totalSelectedSoldiers > 0 ? '✓' : '✕'}</span><span>Mindestens 1 ausgebildeter Soldat ausgewählt (${totalSelectedSoldiers} gewählt)</span></div>
              </div>
            </div>
            <div class="btn-row">
              <button class="btn-secondary" data-goto-bestiary="1">Bestiarium</button>
              <button class="btn-primary" data-hunt-launch="${def.id}" ${canLaunch ? '' : 'disabled'}>
                ${!hasStamina ? 'Ausdauer fehlt' : !hasQueueSlot ? 'Warteschlangen voll' : totalSelectedSoldiers <= 0 ? 'Soldaten nötig' : `Jagdtrupp entsenden (-${DINO_HUNT_STAMINA_COST} Ausd.)`}
              </button>
            </div>
          `;

          document.getElementById('sheetBody').innerHTML = html;
        }

        function renderOwnSettlementSheet() {
          const bfLvl = state.buildings.bonfire.level;
          const rates = computeEconomyRates();
          const emberPct = Math.round(state.ember);
          const overheat = isOverheatMode();
          const activeMarches = (state.worldMarches || []).length;
          const maxMarches = getMaxWorldMarches();
          const nextQueueLvl = getNextMarchQueueUnlockLevel();
          const home = getHomePos();
          const tpItems = (state.inventory && state.inventory.teleportItem) || 0;

          document.getElementById('sheetTitle').textContent = 'Meine Siedlung';
          document.getElementById('sheetSub').textContent = `Signalfeuer Stufe ${bfLvl} / ${MAX_LEVEL} · [X: ${home.coordX}, Y: ${home.coordY}]`;

          const html = `
            <p class="sheet-desc">Dein befestigtes 2×2-Urzeit-Lager auf der Weltkarte. Von hier aus entsendest du Sammeltrupps und Dino-Jagdtrupps über deine Marschwarteschlangen.</p>
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Bewohner (Frei / Gesamt)</div>
                <div class="stat-value mono">${getFreePop()} / ${state.pop.total} (Max ${getPopMax()})</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Marschwarteschlangen</div>
                <div class="stat-value mono">${activeMarches} / ${maxMarches}${nextQueueLvl ? ` (nächste St. ${nextQueueLvl})` : ' (Max)'}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Signalfeuer &amp; Modus</div>
                <div class="stat-value">${emberPct}% · ${overheat ? 'Überheizen' : 'Normal'}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Siedlungs-Teleports</div>
                <div class="stat-value mono" style="color:#38bdf8;">${tpItems} verfügbar</div>
              </div>
            </div>
            <div class="btn-row">
              <button class="btn-secondary" data-start-teleport="1">Siedlung teleportieren (2×2)</button>
              <button class="btn-primary" data-enter-village="1">Dorf betreten</button>
            </div>
          `;
          document.getElementById('sheetBody').innerHTML = html;
        }

        function renderWorldNodeSheet(nodeId) {
          const info = getWorldNodeInfo(nodeId);
          if (!info) return;
          const nState = getWorldNodeState(nodeId);
          const pos = getNodePos(nodeId);
          const march = getActiveMarchForNode(nodeId);
          const enemyOcc = getEnemyNodeOccupant(nodeId);
          const now = Date.now();
          const freePop = getFreePop();
          const activeMarches = (state.worldMarches || []).length;
          const maxMarches = getMaxWorldMarches();
          const travelSec = getWorldMarchTravelSec(pos || info);
          const coordX = pos ? pos.coordX : Math.round((info.xPct / 100) * WORLD_GRID_COLS);
          const coordY = pos ? pos.coordY : Math.round((info.yPct / 100) * WORLD_GRID_ROWS);

          document.getElementById('sheetTitle').textContent = info.name;
          document.getElementById('sheetSub').textContent = `Stufe ${info.level} · ${RESOURCE_LABELS[info.resource]} · [X: ${coordX}, Y: ${coordY}]`;

          let html = `<p class="sheet-desc">${info.desc}</p>`;

          // Bereinige gatherDraft von inzwischen beschäftigten Helden / Truppen
          const busyHeroes = getDeployedHeroIds();
          gatherDraft.heroIds = (gatherDraft.heroIds || [])
            .filter((id) => !busyHeroes.has(id) && state.heroes && state.heroes[id] && state.heroes[id].unlocked)
            .slice(0, 3);
          for (const tk of Object.keys(TROOP_DEFS)) {
            gatherDraft.troops[tk] = Math.min(getAvailableTroopCount(tk), Math.max(0, gatherDraft.troops[tk] || 0));
          }

          const totalAvailSoldiers = Object.keys(TROOP_DEFS).reduce((s, k) => s + getAvailableTroopCount(k), 0);
          const totalSelectedSoldiers = Object.keys(TROOP_DEFS).reduce((s, k) => s + (gatherDraft.troops[k] || 0), 0);
          const selectedHeroCount = gatherDraft.heroIds.length;
          const usingCombatSquad = selectedHeroCount > 0 || totalSelectedSoldiers > 0;
          const carryCap = computeGatherCarryCapacity(info, gatherDraft.heroIds, gatherDraft.troops);
          const plannedAmount = Math.min(nState.remaining, carryCap);
          const gatherSec = getWorldGatherDurationSec(info, Math.max(1, plannedAmount), gatherDraft.heroIds, gatherDraft.troops);
          const speedMult = getGatherSquadSpeedMult(info.resource, gatherDraft.heroIds, gatherDraft.troops);
          const squadInfo = computeGatherSquadPower(gatherDraft.heroIds, gatherDraft.troops, usingCombatSquad ? 0 : info.workersNeeded);

          if (enemyOcc && !march) {
            const enemySoldiers =
              (enemyOcc.troops?.slinger || 0) + (enemyOcc.troops?.clubman || 0) + (enemyOcc.troops?.dinorider || 0);
            const enemyHeroes = (enemyOcc.heroIds || []).length;
            const remOccSec = Math.max(0, (enemyOcc.gatherEndsAt - now) / 1000);
            const ratio = squadInfo.total / Math.max(1, enemyOcc.squadPower || 50);
            const oddsLabel =
              !usingCombatSquad
                ? 'Helden/Soldaten nötig'
                : ratio >= 1.25
                ? 'Sehr hohe Siegchance'
                : ratio >= 1.02
                ? 'Vorteil (Glücksfaktor ±12%)'
                : ratio >= 0.84
                ? 'Knappes PvP-Gefecht (±12% Glück)'
                : 'Gegner deutlich stärker';
            const oddsColor =
              !usingCombatSquad
                ? '#f87171'
                : ratio >= 1.25
                ? '#4ade80'
                : ratio >= 1.02
                ? '#86efac'
                : ratio >= 0.84
                ? '#fbbf24'
                : '#f87171';

            html += `
              <div class="gather-pvp-banner">
                <div class="gather-pvp-banner-head">
                  <span>⚔ Besetzt von ${escapeHtmlMp(enemyOcc.tribeName || 'Fremdstamm')} (Feuer St. ${enemyOcc.bonfireLevel || 1})</span>
                  <span class="mono">KK ${fmtNum(enemyOcc.squadPower || 50)}</span>
                </div>
                <div class="gather-pvp-banner-sub">
                  Trupp vor Ort: <strong>${enemyHeroes} Helden · ${enemySoldiers} Soldaten</strong> · Sammelt noch <span class="mono">${fmtClock(remOccSec)}</span>.<br/>
                  Schicke bis zu 3 Helden + Soldaten hinein, um den Spieler anzugreifen — bist du stärker (mit etwas Kampfglück), vertreibst du ihn und übernimmst die Sammelstelle!
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; margin-top:2px;">
                  <span style="color:var(--text-secondary);">Deine PvP-KK: <strong class="mono">${fmtNum(squadInfo.total)}</strong></span>
                  <span style="font-weight:700; color:${oddsColor};">${oddsLabel}</span>
                </div>
              </div>
            `;
          }

          html += `
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-label">Verbleibender Vorrat</div>
                <div class="stat-value mono" style="color:${RESOURCE_COLORS[info.resource]}">${nState.remaining} / ${info.capacity} ${RESOURCE_LABELS[info.resource]}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Traglast / Beute</div>
                <div class="stat-value mono">${plannedAmount} ${RESOURCE_LABELS[info.resource]} (Max ${carryCap})</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Marschzeit (einfach)</div>
                <div class="stat-value mono">${fmtDuration(travelSec)}${hasTech('nets') ? ' (-20%)' : ''}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Sammeldauer</div>
                <div class="stat-value mono">${fmtDuration(gatherSec)}${speedMult > 1 ? ` (+${Math.round((speedMult - 1) * 100)}%)` : ''}</div>
              </div>
            </div>
          `;

          if (march) {
            const total = Math.max(1000, march.phaseEndsAt - march.startedAt);
            const rem = Math.max(0, (march.phaseEndsAt - now) / 1000);
            const pct = Math.min(100, Math.max(0, ((now - march.startedAt) / total) * 100));
            const mRes = march.targetResource || info.resource;
            const mHeroNames = (march.heroes || [])
              .map((hId) => HEROES_LIST.find((h) => h.id === hId)?.name.split(' ')[0])
              .filter(Boolean);
            const mSoldCnt = (march.troops?.slinger || 0) + (march.troops?.clubman || 0) + (march.troops?.dinorider || 0);
            const phaseLabel =
              march.phase === 'marching_out'
                ? 'Trupp auf dem Hinmarsch'
                : march.phase === 'occupying'
                ? 'Sichert Sammelstelle (PvP)...'
                : march.phase === 'gathering'
                ? `Sammelt ${RESOURCE_LABELS[mRes]} (wird gegen Angriffe verteidigt)`
                : `Auf dem Rückweg mit +${march.carriedAmount} ${RESOURCE_LABELS[mRes]}`;

            html += `
              <div class="stat-box">
                <div class="queue-title"><span>${phaseLabel}</span><span class="mono">${fmtClock(rem)}</span></div>
                <div class="prog-bar"><div class="prog-fill ${march.phase === 'marching_back' ? 'done' : ''}" style="width:${pct.toFixed(1)}%"></div></div>
                <div style="margin-top:6px; font-size:11px; color:var(--text-secondary);">
                  Trupp: ${mHeroNames.length ? mHeroNames.join(', ') : `${march.workers || 0} Dorfbewohner`} · ${mSoldCnt} Soldaten · <strong class="mono">KK ${fmtNum(march.squadPower || 0)}</strong>
                </div>
              </div>
            `;
            if (march.phase !== 'marching_back') {
              html += `<button class="btn-secondary" data-wm-recall="${march.id}">Trupp zurückrufen${march.phase === 'gathering' ? ' (bisherige Beute behalten)' : ''}</button>`;
            }
          } else {
            // 3-Helden-Auswahl für die Sammelstelle
            const unlockedHeroes = HEROES_LIST.filter((h) => state.heroes && state.heroes[h.id] && state.heroes[h.id].unlocked);
            html += `
              <div>
                <p class="sheet-section-title">Helden für Sammelstelle wählen (${selectedHeroCount} / 3)</p>
                <div class="hunt-hero-grid">
                  ${unlockedHeroes
                    .map((h) => {
                      const hSt = state.heroes[h.id];
                      const busy = busyHeroes.has(h.id);
                      const sel = gatherDraft.heroIds.includes(h.id);
                      const pwr = getHeroPower(h, hSt);
                      return `
                        <button class="hunt-hero-btn ${sel ? 'selected' : ''}" data-gather-toggle-hero="${h.id}" ${busy ? 'disabled' : ''}>
                          <div style="display:flex; width:100%; justify-content:space-between; align-items:center; gap:4px;">
                            <span style="font-size:11.5px; font-weight:700; color:var(--text-primary);">${h.name.split(' ')[0]}</span>
                            <span class="mono" style="font-size:10px; color:${busy ? '#f87171' : sel ? '#fbbf24' : 'var(--text-muted)'};">${busy ? 'Im Einsatz' : `KK ${fmtNum(pwr)}`}</span>
                          </div>
                          <span style="font-size:10px; color:var(--text-secondary);">${h.role} · St. ${hSt.level}</span>
                        </button>
                      `;
                    })
                    .join('')}
                </div>
              </div>
            `;

            // Ausgebildete Soldaten auswählen
            html += `
              <div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
                  <p class="sheet-section-title" style="margin:0;">Soldaten mitschicken (${totalSelectedSoldiers} gewählt)</p>
                  <div style="display:inline-flex; gap:5px;">
                    <button class="hunt-mini-btn" data-gather-fill-all="1" ${totalAvailSoldiers <= 0 ? 'disabled' : ''}>Alle</button>
                    <button class="hunt-mini-btn" data-gather-clear="1" ${totalSelectedSoldiers <= 0 ? 'disabled' : ''}>0</button>
                  </div>
                </div>
                <div class="hunt-troop-list">
                  ${Object.values(TROOP_DEFS)
                    .map((td) => {
                      const avail = getAvailableTroopCount(td.id);
                      const chosen = gatherDraft.troops[td.id] || 0;
                      return `
                        <div class="hunt-troop-row">
                          <div>
                            <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${td.name} <span style="font-size:10.5px; color:var(--text-muted);">(${td.role})</span></div>
                            <div class="mono" style="font-size:10.5px; color:var(--text-secondary);">Gewählt: ${chosen} / ${avail} frei · ${td.powerPerUnit} KK</div>
                          </div>
                          <div class="hunt-troop-controls">
                            <button class="hunt-mini-btn" data-gather-troop-delta="${td.id}|-5" ${chosen <= 0 ? 'disabled' : ''}>-5</button>
                            <button class="hunt-mini-btn" data-gather-troop-delta="${td.id}|-1" ${chosen <= 0 ? 'disabled' : ''}>−</button>
                            <button class="hunt-mini-btn" data-gather-troop-delta="${td.id}|1" ${chosen >= avail ? 'disabled' : ''}>+</button>
                            <button class="hunt-mini-btn" data-gather-troop-max="${td.id}" ${chosen >= avail ? 'disabled' : ''}>Max</button>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              </div>
            `;

            const hasSlot = activeMarches < maxMarches;
            const hasForce = enemyOcc ? usingCombatSquad : usingCombatSquad || freePop >= info.workersNeeded;
            const canSend = hasSlot && hasForce && nState.remaining > 0;

            html += `
              <div class="hunt-power-bar">
                <div>
                  <div style="font-size:10.5px; color:var(--text-muted);">Sammeltrupp-Kampfkraft (PvP-Schutz)</div>
                  <div class="mono" style="font-size:13px; font-weight:700; color:var(--text-primary);">KK ${fmtNum(squadInfo.total)}${squadInfo.pvpBonusPct > 0 ? ` <span style="font-size:10px; color:#86efac;">(PvP-Skills +${squadInfo.pvpBonusPct}%)</span>` : ''}</div>
                </div>
                <span style="font-size:11px; font-weight:700; color:${usingCombatSquad ? '#4ade80' : '#fbbf24'}; text-align:right;">
                  ${usingCombatSquad ? `${selectedHeroCount} Helden · ${totalSelectedSoldiers} Soldaten` : `Fallback: ${info.workersNeeded} Dorfbewohner`}
                </span>
              </div>
              <div class="req-list">
                <div class="req-row ${hasSlot ? 'met' : 'missing'}">
                  <div class="req-main"><span class="req-mark">${hasSlot ? '✓' : '✕'}</span><span>Freier Marschwarteschlangen-Slot (${activeMarches}/${maxMarches} aktiv)</span></div>
                </div>
                <div class="req-row ${hasForce ? 'met' : 'missing'}">
                  <div class="req-main"><span class="req-mark">${hasForce ? '✓' : '✕'}</span><span>${
                    enemyOcc
                      ? 'Mindestens 1 Held oder Soldat für PvP-Angriff nötig'
                      : usingCombatSquad
                      ? `Kampf-Sammeltrupp bereit (kein Dorfbewohner nötig)`
                      : `${info.workersNeeded} freie Dorfbewohner oder Helden/Soldaten (${freePop} Bewohner frei)`
                  }</span></div>
                </div>
              </div>
              <button class="btn-primary" data-wm-send="${info.id}" ${canSend ? '' : 'disabled'}>
                ${
                  !hasSlot
                    ? 'Alle Marschwarteschlangen belegt'
                    : !hasForce
                    ? enemyOcc
                      ? 'Helden oder Soldaten zum Angreifen wählen'
                      : 'Helden/Soldaten oder freie Bewohner nötig'
                    : enemyOcc
                    ? `⚔ Sammelstelle angreifen & erobern (KK ${fmtNum(squadInfo.total)})`
                    : `Sammeltrupp entsenden (${plannedAmount} ${RESOURCE_LABELS[info.resource]})`
                }
              </button>
            `;
          }

          document.getElementById('sheetBody').innerHTML = html;
        }

        function renderBuildingSheet(buildingId, subTab = 'building') {
          const def = BUILDINGS[buildingId];
          const bState = state.buildings[buildingId];
          const bonfireLvl = state.buildings.bonfire.level;
          const evalReq = evaluateBuildingRequirements(buildingId);
          const rates = computeEconomyRates();
          const now = Date.now();
          const isBuildingThis = state.activeBuild && state.activeBuild.buildingId === buildingId;

          document.getElementById('sheetTitle').textContent = def.name;
          const capText = def.isMain
            ? `Stufe ${bState.level} / ${MAX_LEVEL} · Setzt globales Stufen-Limit`
            : `Stufe ${bState.level} / ${MAX_LEVEL} · Aktuelles Cap: Stufe ${bonfireLvl} (Signalfeuer)`;
          document.getElementById('sheetSub').textContent = capText;

          let html = '';

          // Für das Forschungsgebäude (Werkstatt / Schamanen-Zelt): Umschalter Forschungsbaum <-> Gebäude & Ausbau
          if (buildingId === 'workshop') {
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'tree' ? 'active' : ''}" data-workshop-tab="tree">Forschungsbaum (${state.completedTechs.length}/${RESEARCH_LIST.length})</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-workshop-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'tree') {
              html += buildResearchTreeHTML();
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          // Für die Heldenhöhle: Umschalter Knochen-Beschwörung <-> Gebäude & Ausbau
          if (buildingId === 'hero_cave') {
            const inv = state.inventory || {};
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'summon' ? 'active' : ''}" data-cave-tab="summon">Beschwörung (${inv.bones || 0} / ${inv.goldenBones || 0})</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-cave-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'summon') {
              html += buildHeroCaveSummonHTML();
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          // Für Kasernen (Steinschleuderer, Keulenschwinger, Dinoreiter): Ausbildung <-> Gebäude & Ausbau
          if (def.troopType) {
            const tCount = (state.troops && state.troops[def.troopType]) || 0;
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'train' ? 'active' : ''}" data-barracks-tab="train">Ausbildung (${tCount})</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-barracks-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'train') {
              html += buildBarracksTrainHTML(def.troopType);
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          // Für Krankenzelt: Heilung <-> Gebäude & Ausbau
          if (buildingId === 'infirmary') {
            const injCnt = getTotalInjuredTroops();
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'heal' ? 'active' : ''}" data-infirmary-tab="heal">Lazarett (${injCnt})</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-infirmary-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'heal') {
              html += buildInfirmaryHTML();
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          // Für Friedhof: Wiedererweckung <-> Gebäude & Ausbau
          if (buildingId === 'graveyard') {
            const falCnt = getTotalFallenTroops();
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'revive' ? 'active' : ''}" data-graveyard-tab="revive">Friedhof (${falCnt})</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-graveyard-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'revive') {
              html += buildGraveyardHTML();
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          // Für Marktplatz: Gratis-Ausdauer <-> Gebäude & Ausbau
          if (buildingId === 'marketplace') {
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'market' ? 'active' : ''}" data-marketplace-tab="market">Ausdauer (+${MARKET_STAMINA_REWARD})</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-marketplace-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'market') {
              html += buildMarketplaceHTML();
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          // Für Lagerhaus: Ressourcenschutz <-> Gebäude & Ausbau
          if (buildingId === 'warehouse') {
            html += `
              <div class="sheet-tabs" role="tablist">
                <button class="sheet-tab-btn ${subTab === 'vault' ? 'active' : ''}" data-warehouse-tab="vault">Safe-Kapazität</button>
                <button class="sheet-tab-btn ${subTab === 'building' ? 'active' : ''}" data-warehouse-tab="building">Gebäude &amp; Ausbau</button>
              </div>
            `;
            if (subTab === 'vault') {
              html += buildWarehouseHTML();
              document.getElementById('sheetBody').innerHTML = html;
              return;
            }
          }

          html += `<p class="info-line">${def.desc}</p>`;

          // Leistungs-Übersicht
          if (buildingId === 'bonfire') {
            const eSt = getEmberStatus(state.ember);
            const overheat = isOverheatMode();
            const curQueues = getMaxWorldMarches();
            const nextQueueLvl = getNextMarchQueueUnlockLevel();
            html += `
              <div>
                <p class="sheet-section-title">Signalfeuer, Marschwarteschlangen &amp; Heizmodus</p>
                <div class="stat-grid">
                  <div class="stat-box">
                    <div class="stat-label">Feuer-Glut · Holz-Zufuhr</div>
                    <div class="stat-value" style="color:${rates.autoFeedActive ? eSt.color : '#ef4444'}">${Math.round(state.ember)}% · ${rates.autoFeedActive ? 'Auto aktiv' : 'Holz leer'}</div>
                  </div>
                  <div class="stat-box">
                    <div class="stat-label">Auto-Verbrauch</div>
                    <div class="stat-value">-${Math.round(rates.woodBurn)} Holz/Min.</div>
                  </div>
                  <div class="stat-box">
                    <div class="stat-label">Marschwarteschlangen (Max 5)</div>
                    <div class="stat-value mono" style="color:#fde68a;">${(state.worldMarches || []).length} / ${curQueues} aktiv</div>
                  </div>
                  <div class="stat-box">
                    <div class="stat-label">Nächste Warteschlange</div>
                    <div class="stat-value mono">${nextQueueLvl ? `Ab Signalfeuer St. ${nextQueueLvl}` : 'Alle 5 freigeschaltet'}</div>
                  </div>
                </div>
                <div class="mode-switch-lg" style="margin-top:10px;" role="group" aria-label="Dauerhafter Signalfeuer-Modus">
                  <button class="mode-lg-btn ${!overheat ? 'active-normal' : ''}" data-set-fire-mode="normal">
                    <span>Normalmodus</span>
                    <span class="mode-lg-sub">Standard-Holz · Basiswärme</span>
                  </button>
                  <button class="mode-lg-btn ${overheat ? 'active-overheat' : ''}" data-set-fire-mode="overheat">
                    <span>Überheizmodus</span>
                    <span class="mode-lg-sub">1,8× Holz · Voller Sturmschutz</span>
                  </button>
                </div>
                <p class="info-line" style="font-size:11.5px; color:var(--text-muted); margin-top:7px;">
                  Der gewählte Modus bleibt dauerhaft aktiv. Marschwarteschlangen steigen mit dem Signalfeuer (St. 1/4/9/15/21 → bis 5 Märsche, Max-Stufe ${MAX_LEVEL}).
                </p>
              </div>
            `;
          } else if (buildingId === 'hut') {
            html += `
              <div class="stat-grid">
                <div class="stat-box">
                  <div class="stat-label">Aktuelles Bewohner-Limit</div>
                  <div class="stat-value">${state.pop.total} / ${getPopMax()} Bewohner</div>
                </div>
                <div class="stat-box">
                  <div class="stat-label">Nächste Stufe</div>
                  <div class="stat-value">${evalReq.isMax ? 'Maximal' : `Max. ${def.popCap(bState.level + 1)} Bewohner`}</div>
                </div>
              </div>
            `;
          } else if (bState.level > 0) {
            let stat1Label = 'Aktuelle Leistung';
            let stat1Val = '—';
            let stat2Label = 'Nächste Stufe';
            let stat2Val = evalReq.isMax ? 'Maximal' : `+${def.maxWorkers ? def.maxWorkers(bState.level + 1) - def.maxWorkers(bState.level) : 0} Slot`;

            if (buildingId === 'hunter') {
              stat1Label = 'Ertrag (aktuell)';
              stat1Val = `+${Math.round(rates.meatProd)} Fleisch · +${Math.round(rates.furNet)} Fell/m`;
              stat2Label = 'Fallenbau-Bonus';
              stat2Val = hasTech('traps') ? 'Aktiv (+1 passiver Slot)' : 'Nicht erforscht';
            } else if (buildingId === 'lumber') {
              stat1Label = 'Holz-Ausbeute';
              stat1Val = `+${Math.round(rates.woodProd)} Holz/Min.`;
              stat2Label = 'Steinbeile-Bonus';
              stat2Val = hasTech('axes') ? '+25 % aktiv' : 'Nicht erforscht';
            } else if (buildingId === 'quarry') {
              stat1Label = 'Stein-Ausbeute';
              stat1Val = `+${Math.round(rates.stoneNet)} Stein/Min.`;
              stat2Label = 'Schlägel & Keile';
              stat2Val = hasTech('wedges') ? '+25 % aktiv' : 'Nicht erforscht';
            } else if (buildingId === 'workshop') {
              stat1Label = 'Forschungstempo';
              stat1Val = `+${bState.workers * 8 + Math.round(getHeroBonuses().research * 100)} % Bonus`;
              stat2Label = 'Forschungsstufen';
              stat2Val = `Bis Stufe ${Math.min(4, bState.level)} offen`;
            } else if (buildingId === 'scout') {
              stat1Label = 'Expeditions-Plätze';
              stat1Val = `${state.activeExpeditions.length} / ${getMaxExpeditions()} aktiv`;
              stat2Label = 'Fährtenleser-Tempo';
              stat2Val = `+${bState.workers * 6} % schneller`;
            } else if (buildingId === 'hero_cave') {
              const cdSec = Math.round(Math.max(240000, FREE_BONE_COOLDOWN_MS - (bState.level - 1) * 35000) / 1000);
              stat1Label = 'Ressourcen-Fund-Bonus';
              stat1Val = `+${(bState.level - 1) * 15} % Beute`;
              stat2Label = 'Gratis-Knochen Intervall';
              stat2Val = fmtDuration(cdSec);
            } else if (buildingId === 'infirmary') {
              stat1Label = 'Betten-Kapazität';
              stat1Val = `${getTotalInjuredTroops()} / ${getInfirmaryCapacity(bState.level)} Betten`;
              stat2Label = 'Heiltempo-Bonus';
              stat2Val = `+${Math.round((bState.level - 1) * 10 + (bState.workers || 0) * 15)} % schneller`;
            } else if (buildingId === 'graveyard') {
              stat1Label = 'Gefallene Einheiten';
              stat1Val = `${getTotalFallenTroops()} auf dem Friedhof`;
              stat2Label = 'Wiedererweckung / Totem';
              stat2Val = `Bis zu ${getGraveyardRevivePerTotem(bState.level)} Einheiten`;
            } else if (buildingId === 'marketplace') {
              const remSec = Math.max(0, Math.ceil(((state.marketClaimAt || 0) - now) / 1000));
              stat1Label = 'Gratis-Ausdauer (12h)';
              stat1Val = remSec <= 0 ? `+${MARKET_STAMINA_REWARD} abholbereit!` : `In ${fmtClock(remSec)}`;
              stat2Label = 'Ausdauer-Regen-Bonus';
              stat2Val = `+${bState.level * 5} % Tempo`;
            } else if (buildingId === 'warehouse') {
              const caps = getWarehouseSafeCaps(bState.level);
              stat1Label = 'Safe-Schutz (Fleisch/Holz)';
              stat1Val = `je ${fmtNum(caps.wood)} geschützt`;
              stat2Label = 'Safe-Schutz (Stein/Fell)';
              stat2Val = `${fmtNum(caps.stone)} / ${fmtNum(caps.fur)}`;
            } else if (def.troopType) {
              const tDef = TROOP_DEFS[def.troopType];
              const cnt = (state.troops && state.troops[def.troopType]) || 0;
              stat1Label = `Bestand (${tDef.role})`;
              stat1Val = `${fmtNum(cnt)} Einheiten`;
              stat2Label = 'Ausbildungs-Losgröße';
              stat2Val = `${tDef.batchSize + Math.floor((bState.level - 1) * 1.5)}× pro Auftrag`;
            }

            html += `
              <div class="stat-grid">
                <div class="stat-box"><div class="stat-label">${stat1Label}</div><div class="stat-value">${stat1Val}</div></div>
                <div class="stat-box"><div class="stat-label">${stat2Label}</div><div class="stat-value">${stat2Val}</div></div>
              </div>
            `;
          }

          // Arbeiter-Zuweisung direkt im Detailfenster ([-], [+])
          if (def.hasWorkers && bState.level > 0) {
            const maxW = def.maxWorkers(bState.level);
            const free = getFreePop();
            html += `
              <div>
                <p class="sheet-section-title">Arbeitsplatz-Zuweisung (${def.workerLabel} · ${free} Bewohner frei)</p>
                <div class="worker-control-row">
                  <div style="font-size:12px; color:var(--text-secondary);">${def.workerDesc}</div>
                  <div class="worker-stepper">
                    <button class="step-btn" data-worker-id="${buildingId}" data-worker-delta="-1" ${bState.workers <= 0 ? 'disabled' : ''} aria-label="Arbeiter entfernen">−</button>
                    <span class="worker-count-display">${bState.workers}/${maxW}</span>
                    <button class="step-btn" data-worker-id="${buildingId}" data-worker-delta="1" ${bState.workers >= maxW || free <= 0 ? 'disabled' : ''} aria-label="Arbeiter hinzufügen">+</button>
                  </div>
                </div>
              </div>
            `;
          }

          // Ausbau-Bereich & STRIKTE ABHÄNGIGKEITS-CHECKLISTE
          if (!evalReq.isMax) {
            const target = evalReq.targetLevel;
            const cost = getBuildingCost(buildingId, target);
            const dur = getBuildingDuration(buildingId, target);

            html += `<div><p class="sheet-section-title">Voraussetzungen für Stufe ${target}</p><div class="req-list">`;
            for (const chk of evalReq.checks) {
              html += `
                <div class="req-row ${chk.met ? 'met' : 'missing'}">
                  <div class="req-main">
                    <span class="req-mark">${chk.met ? '✓' : '✕'}</span>
                    <span>${chk.label}</span>
                  </div>
                  <span class="req-status-tag mono">${chk.met ? 'Erfüllt' : `Fehlt (${chk.currentText})`}</span>
                </div>
              `;
            }
            html += `</div>`;

            if (evalReq.nextHint) {
              html += `
                <div class="next-step-hint">
                  <span>${evalReq.nextHint.text}</span>
                  <button class="jump-btn" data-jump-building="${evalReq.nextHint.buildingId}">${evalReq.nextHint.buttonLabel} →</button>
                </div>
              `;
            }
            html += `</div>`;

            // Kosten & Bauzeit
            html += `<div><p class="sheet-section-title">Kosten &amp; Bauzeit (Dauer: ${fmtDuration(dur)})</p><div class="cost-grid">`;
            for (const [res, amt] of Object.entries(cost)) {
              const have = Math.floor(state.resources[res] || 0);
              const ok = have >= amt;
              html += `
                <div class="cost-item ${ok ? 'enough' : 'short'}">
                  <span>${RESOURCE_LABELS[res]}</span>
                  <span class="cost-nums">${fmtNum(have)} / ${fmtNum(amt)}</span>
                </div>
              `;
            }
            html += `</div></div>`;

            // Ausbau-Button oder laufender Fortschritt
            if (isBuildingThis) {
              const total = Math.max(1, (state.activeBuild.endsAt - state.activeBuild.startedAt) / 1000);
              const rem = Math.max(0, (state.activeBuild.endsAt - now) / 1000);
              const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
              html += `
                <div>
                  <div class="queue-title"><span>Ausbau auf Stufe ${target} läuft...</span><span class="mono">${fmtClock(rem)}</span></div>
                  <div class="prog-bar"><div class="prog-fill" style="width:${pct.toFixed(1)}%"></div></div>
                  ${
                    rem <= FREE_FINISH_SEC
                      ? `<button class="btn-primary" style="margin-top:10px; background:var(--state-ok); color:#052e16;" data-action="free-build">Gratis sofort fertigstellen</button>`
                      : ''
                  }
                </div>
              `;
            } else {
              const busyOther = Boolean(state.activeBuild);
              const affordable = canAfford(cost);
              const enabled = evalReq.allMet && affordable && !busyOther;
              let btnText = bState.level === 0 ? `Errichten (Stufe 1)` : `Ausbauen auf Stufe ${target}`;
              if (busyOther) btnText = `Anderer Bauauftrag aktiv`;
              else if (!evalReq.allMet) btnText = `Voraussetzungen fehlen`;
              else if (!affordable) btnText = `Ressourcen fehlen`;

              html += `<button class="btn-primary" data-upgrade-building="${buildingId}" ${enabled ? '' : 'disabled'}>${btnText}</button>`;
            }
          } else {
            html += `<div class="req-row met"><div class="req-main"><span class="req-mark">✓</span><span>Maximale Ausbaustufe (${MAX_LEVEL}) erreicht.</span></div></div>`;
          }

          document.getElementById('sheetBody').innerHTML = html;
        }

        function renderResearchSheet(techId) {
          const tech = RESEARCH_LIST.find((t) => t.id === techId);
          if (!tech) return;
          const info = evaluateResearchStatus(tech);
          const dur = getResearchDuration(tech);
          const now = Date.now();

          document.getElementById('sheetTitle').textContent = tech.name;
          document.getElementById('sheetSub').textContent = `Urzeit-Forschung · Status: ${info.label}`;

          let html = `
            <button class="back-inline-btn" data-back-research-tree="1">← Zurück zum Forschungsbaum</button>
            <p class="info-line">${tech.detail}</p>
            <div class="stat-box">
              <div class="stat-label">Dauerhafter Effekt</div>
              <div class="stat-value" style="font-family:var(--font-body); font-size:13.5px; color:var(--accent-amber);">${tech.effect}</div>
            </div>
          `;

          if (info.status !== 'done') {
            html += `<div><p class="sheet-section-title">Voraussetzungen</p><div class="req-list">`;
            for (const chk of info.checks) {
              html += `
                <div class="req-row ${chk.met ? 'met' : 'missing'}">
                  <div class="req-main">
                    <span class="req-mark">${chk.met ? '✓' : '✕'}</span>
                    <span>${chk.label}</span>
                  </div>
                  <span class="req-status-tag mono">${chk.met ? 'Erfüllt' : `Fehlt (${chk.currentText})`}</span>
                </div>
              `;
            }
            html += `</div>`;

            const missingWs = info.checks.find((c) => !c.met && c.targetBuildingId);
            if (missingWs) {
              html += `
                <div class="next-step-hint">
                  <span>Als Nächstes: Werkstatt / Schamanen-Zelt auf Stufe ${missingWs.neededLevel} ausbauen.</span>
                  <button class="jump-btn" data-jump-building="workshop" data-jump-subtab="building">Gebäude ausbauen →</button>
                </div>
              `;
            }
            html += `</div>`;

            html += `<div><p class="sheet-section-title">Forschungskosten &amp; Dauer (${fmtDuration(dur)})</p><div class="cost-grid">`;
            for (const [res, amt] of Object.entries(tech.cost)) {
              const have = Math.floor(state.resources[res] || 0);
              const ok = have >= amt;
              html += `
                <div class="cost-item ${ok ? 'enough' : 'short'}">
                  <span>${RESOURCE_LABELS[res]}</span>
                  <span class="cost-nums">${fmtNum(have)} / ${fmtNum(amt)}</span>
                </div>
              `;
            }
            html += `</div></div>`;

            if (info.status === 'running' && state.activeResearch) {
              const total = Math.max(1, (state.activeResearch.endsAt - state.activeResearch.startedAt) / 1000);
              const rem = Math.max(0, (state.activeResearch.endsAt - now) / 1000);
              const pct = Math.min(100, Math.max(0, ((total - rem) / total) * 100));
              html += `
                <div>
                  <div class="queue-title"><span>Forschung läuft...</span><span class="mono">${fmtClock(rem)}</span></div>
                  <div class="prog-bar"><div class="prog-fill" style="width:${pct.toFixed(1)}%"></div></div>
                  ${
                    rem <= FREE_FINISH_SEC
                      ? `<button class="btn-primary" style="margin-top:10px; background:var(--state-ok); color:#052e16;" data-action="free-research">Gratis sofort abschließen</button>`
                      : ''
                  }
                </div>
              `;
            } else {
              const busyOther = Boolean(state.activeResearch);
              const label = busyOther
                ? 'Andere Forschung aktiv'
                : info.status === 'locked'
                ? 'Voraussetzungen fehlen'
                : !canAfford(tech.cost)
                ? 'Ressourcen fehlen'
                : `Forschung starten (${fmtDuration(dur)})`;
              html += `<button class="btn-primary" data-start-tech="${tech.id}" ${info.canStart ? '' : 'disabled'}>${label}</button>`;
            }
          } else {
            html += `<div class="req-row met"><div class="req-main"><span class="req-mark">✓</span><span>Diese Urzeit-Technologie ist vollständig erforscht und dauerhaft aktiv.</span></div></div>`;
          }

          document.getElementById('sheetBody').innerHTML = html;
        }

        function renderAll() {
          renderHUD();
          if (activeTab === 'village') renderVillageMap();
          else if (activeTab === 'worldmap') renderWorldMap();
          else if (activeTab === 'heroes') renderHeroesTab();
          else if (activeTab === 'inventory') renderInventoryTab();
          else if (activeTab === 'wilderness') renderWildernessTab();

          if (openSheet) renderSheet();
        }

        function switchTab(tabName) {
          const valid = ['village', 'worldmap', 'heroes', 'inventory', 'wilderness'];
          if (!valid.includes(tabName)) tabName = 'village';
          activeTab = tabName;
          document.querySelectorAll('.tab-view').forEach((v) => v.classList.remove('active'));
          document.getElementById(`tab-${tabName}`).classList.add('active');
          document.querySelectorAll('.tab-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === tabName);
          });
          SoundFX.play('tap');
          if (window.Village3D) {
            window.Village3D.setVisible(tabName === 'village');
          }
          if (window.WorldMap3D) {
            window.WorldMap3D.setVisible(tabName === 'worldmap');
          }
          if (tabName === 'village') resizeVillageScene();
          if (tabName === 'worldmap' && window.WorldMap3D) window.WorldMap3D.resize();
          renderAll();
        }

        /* =====================================================================
           11. ZENTRALE MODALE (RÜCKKEHR-BERICHT & EINSTELLUNGEN / RESET)
           ===================================================================== */
        function openCenterModal(html) {
          const backdrop = document.getElementById('centerModalBackdrop');
          document.getElementById('centerModalContent').innerHTML = html;
          backdrop.classList.add('open');
        }

        function closeCenterModal() {
          document.getElementById('centerModalBackdrop').classList.remove('open');
        }

        /* =====================================================================
           11B. KAMPF-ANIMATIONEN & KAMPF-LOG-POPUPS (HELDEN-REITER & DINOJAGD)
           ===================================================================== */
        function getBattleLogById(battleId) {
          if (!battleId || !Array.isArray(state.huntLogs)) return null;
          return state.huntLogs.find((b) => b.id === battleId) || null;
        }

        function getUnreadBattleCount() {
          if (!Array.isArray(state.huntLogs)) return 0;
          return state.huntLogs.filter((b) => !b.read).length;
        }

        function markAllBattlesRead() {
          if (!Array.isArray(state.huntLogs)) return;
          let changed = false;
          for (const b of state.huntLogs) {
            if (!b.read) {
              b.read = true;
              changed = true;
            }
          }
          if (changed) {
            saveState();
            renderHUD();
            if (activeTab === 'heroes') renderHeroesTab();
          }
        }

        function fmtBattleTimeAgo(ts) {
          const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
          if (diffSec < 60) return `vor ${diffSec}s`;
          if (diffSec < 3600) return `vor ${Math.floor(diffSec / 60)}m`;
          if (diffSec < 86400) return `vor ${Math.floor(diffSec / 3600)} Std.`;
          return `vor ${Math.floor(diffSec / 86400)} Tg.`;
        }

        function formatBattleLootSummary(battle) {
          const parts = [];
          for (const [rk, rv] of Object.entries(battle.resources || {})) {
            if (rv > 0) parts.push(`+${fmtNum(rv)} ${RESOURCE_LABELS[rk] || rk}`);
          }
          for (const [ik, iv] of Object.entries(battle.items || {})) {
            if (iv > 0) {
              const itDef = INVENTORY_ITEMS.find((x) => x.id === ik);
              parts.push(`+${iv} ${itDef ? itDef.name : ik}`);
            }
          }
          if (battle.xp > 0) parts.push(`+${fmtNum(battle.xp)} Helden-XP`);
          return parts;
        }

        function buildHeroBattleLogSubTabHTML(huntLogs, activeHuntMarches) {
          const wins = huntLogs.filter((b) => b.victory).length;
          const losses = huntLogs.length - wins;
          const totalXp = huntLogs.reduce((acc, b) => acc + (b.xp || 0), 0);
          const unreadCount = getUnreadBattleCount();

          let html = `
            <div class="summary-strip" style="margin-bottom:10px;">
              <span>Siege: <strong class="mono" style="color:#86efac;">${wins}</strong> · Niederlagen: <strong class="mono" style="color:#fca5a5;">${losses}</strong></span>
              <span>XP-Beute: <strong class="mono" style="color:#60a5fa;">+${fmtNum(totalXp)}</strong></span>
            </div>
          `;

          if (activeHuntMarches.length > 0) {
            html += `<div class="card-list" style="margin-bottom:10px;">`;
            const now = Date.now();
            for (const m of activeHuntMarches) {
              const sp = getDinoSpecies(m.speciesId);
              const rem = Math.max(0, (m.phaseEndsAt - now) / 1000);
              const soldCnt = (m.troops?.slinger || 0) + (m.troops?.clubman || 0) + (m.troops?.dinorider || 0);
              const heroNames = (m.heroes || [])
                .map((id) => {
                  const hd = HEROES_LIST.find((x) => x.id === id);
                  return hd ? hd.name.split(' ')[0] : id;
                })
                .join(', ');
              html += `
                <div class="battle-log-card is-unread">
                  <div class="battle-log-head">
                    <div class="battle-log-dino">
                      <div class="battle-log-dino-icon">${sp ? getDinoIconSVG(sp.id, 24, sp.accent) : ''}</div>
                      <div style="min-width:0;">
                        <div class="battle-log-title">${sp ? sp.name : 'Saurier'} (St. ${m.dinoLevel})</div>
                        <div class="battle-log-meta-line">
                          ${m.phase === 'marching_out' ? `Hinmarsch · Kampf in ${fmtClock(rem)}` : `Rückmarsch · Ankunft in ${fmtClock(rem)}`}
                        </div>
                      </div>
                    </div>
                    ${
                      m.battleId
                        ? `<button class="battle-watch-btn" data-open-battle="${m.battleId}">Kampf abspielen</button>`
                        : `<button class="jump-btn" data-goto-world-dino="${m.dinoId}">Karte</button>`
                    }
                  </div>
                  <div class="battle-log-squad-line">
                    <span>Helden: ${heroNames || 'Keine'}</span>
                    <span class="mono">${soldCnt} Soldaten · Macht ${fmtNum(m.squadPower || 0)}</span>
                  </div>
                </div>
              `;
            }
            html += `</div>`;
          }

          html += `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
              <div class="filter-row" role="tablist" style="margin-bottom:0;flex:1;">
                <button class="filter-btn ${battleLogFilter === 'all' ? 'active' : ''}" data-battle-filter="all">Alle (${huntLogs.length})</button>
                <button class="filter-btn ${battleLogFilter === 'victory' ? 'active' : ''}" data-battle-filter="victory">Siege (${wins})</button>
                <button class="filter-btn ${battleLogFilter === 'defeat' ? 'active' : ''}" data-battle-filter="defeat">Niederlagen (${losses})</button>
              </div>
              ${unreadCount > 0 ? `<button class="jump-btn" data-mark-battles-read="1">Alle gelesen</button>` : ''}
            </div>
          `;

          const filtered = huntLogs.filter((b) => {
            if (battleLogFilter === 'victory') return b.victory;
            if (battleLogFilter === 'defeat') return !b.victory;
            return true;
          });

          if (filtered.length === 0) {
            html += `
              <div class="stat-box" style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
                <div style="font-size:13px;font-weight:700;color:var(--text-primary);">
                  ${huntLogs.length === 0 ? 'Noch keine Dino-Gefechte aufgezeichnet' : 'Keine Gefechte in diesem Filter'}
                </div>
                <p class="info-line" style="margin:0;">
                  Entsende auf der Weltkarte einen Jagdtrupp (bis zu 3 Helden + Soldaten) gegen einen wilden Dino, um hier die animierten Kampfberichte abzuspielen.
                </p>
                <button class="btn-primary" data-goto-worldmap="1">Zur Weltkarte (Dinos jagen)</button>
              </div>
            `;
            return html;
          }

          html += `<div class="card-list">`;
          for (const b of filtered) {
            const lootParts = formatBattleLootSummary(b);
            const heroNames = b.heroes.length ? b.heroes.map((h) => h.shortName).join(', ') : 'Nur Soldaten';
            html += `
              <div class="battle-log-card ${b.read ? '' : 'is-unread'}">
                <div class="battle-log-head">
                  <div class="battle-log-dino">
                    <div class="battle-log-dino-icon">${getDinoIconSVG(b.speciesId, 24, b.speciesAccent || '#fca5a5')}</div>
                    <div style="min-width:0;">
                      <div class="battle-log-title">${b.speciesName} · St. ${b.dinoLevel}</div>
                      <div class="battle-log-meta-line">
                        ${fmtBattleTimeAgo(b.timestamp)} · ${b.rounds.length} Runden · Macht ${fmtNum(b.squadPower)} vs ${fmtNum(b.dinoPower)}
                      </div>
                    </div>
                  </div>
                  <span class="battle-outcome-label ${b.victory ? 'victory' : 'defeat'}">
                    ${b.victory ? 'SIEG' : 'NIEDERLAGE'}
                  </span>
                </div>
                <div class="battle-log-squad-line">
                  <span>Helden: ${heroNames}</span>
                  <span class="mono">${b.totalSent} Soldaten${b.lostTotal > 0 ? ` (−${b.lostTotal})` : ' (0 Verluste)'}</span>
                </div>
                <div class="battle-log-loot-line">
                  ${
                    b.victory
                      ? `Beute: ${lootParts.length ? lootParts.join(' · ') : 'Keine Beute'}${b.newlyDiscovered ? ' · Neu im Bestiarium!' : ''}`
                      : `<span style="color:#fca5a5;">Rückzug nach hartem Gefecht${b.weaknessTip ? ` · Tipp: ${b.weaknessTip}` : ''}</span>`
                  }
                </div>
                <div class="battle-log-actions">
                  <button class="btn-primary" style="min-height:38px;font-size:12px;" data-open-battle="${b.id}">Kampf abspielen</button>
                  <button class="btn-secondary" style="min-height:38px;font-size:12px;" data-open-battle-instant="${b.id}">Kampf-Log</button>
                </div>
              </div>
            `;
          }
          html += `</div>`;
          return html;
        }

        function hideBattleAlertBanner() {
          const banner = document.getElementById('battleAlertBanner');
          if (banner) {
            banner.classList.remove('visible');
            banner.innerHTML = '';
          }
          if (battleBannerTimer) {
            clearTimeout(battleBannerTimer);
            battleBannerTimer = null;
          }
        }

        function showBattleAlertBanner(battle) {
          const banner = document.getElementById('battleAlertBanner');
          if (!banner || !battle) return;
          if (battleBannerTimer) clearTimeout(battleBannerTimer);

          banner.className = `battle-alert-banner visible ${battle.victory ? 'victory' : ''}`;
          banner.innerHTML = `
            <div class="battle-alert-meta">
              <div class="battle-alert-icon">${getDinoIconSVG(battle.speciesId, 22, battle.speciesAccent || '#fca5a5')}</div>
              <div class="battle-alert-text">
                <div class="battle-alert-title">
                  Gefecht: ${battle.speciesName} St. ${battle.dinoLevel} (${battle.victory ? 'Sieg!' : 'Rückzug'})
                </div>
                <div class="battle-alert-sub">
                  ${battle.heroes.map((h) => h.shortName).join(', ') || 'Jagdtrupp'} · ${battle.rounds.length} Runden
                </div>
              </div>
            </div>
            <div class="battle-alert-actions">
              <button class="battle-watch-btn" data-open-battle="${battle.id}">Ansehen</button>
              <button class="battle-dismiss-btn" data-dismiss-battle-banner="1" aria-label="Hinweis schließen">×</button>
            </div>
          `;

          battleBannerTimer = setTimeout(() => {
            hideBattleAlertBanner();
          }, 9500);
        }

        function handleLiveDinoBattleTriggered(battle) {
          if (!battle) return;
          const centerOpen = document.getElementById('centerModalBackdrop').classList.contains('open');
          if (activeTab === 'heroes' && !centerOpen && !battleAnimState.active) {
            openBattleReplayModal(battle.id, { animate: true });
          } else {
            showBattleAlertBanner(battle);
          }
          renderHUD();
          if (activeTab === 'heroes') renderHeroesTab();
        }

        function clearBattleAnimTimers() {
          for (const t of battleAnimState.timers) clearTimeout(t);
          battleAnimState.timers = [];
        }

        function closeBattleModal() {
          clearBattleAnimTimers();
          battleAnimState.active = false;
          battleAnimState.battleId = null;
          battleAnimState.finished = false;
          const backdrop = document.getElementById('battleModalBackdrop');
          if (backdrop) backdrop.classList.remove('open');
        }

        function renderBattleLogEntryHTML(round) {
          const isSquad = round.actorSide === 'squad';
          const dmgLabel = round.isShield
            ? `−${fmtNum(round.damage)} GEBLOCKT`
            : round.isCrit
            ? `−${fmtNum(round.damage)} KRIT!`
            : `−${fmtNum(round.damage)}`;
          const dmgCol = isSquad ? (round.isCrit ? '#fb923c' : '#fde047') : round.isShield ? '#93c5fd' : '#fca5a5';
          return `
            <div class="battle-log-entry ${isSquad ? 'squad' : 'dino'}">
              <div class="battle-log-entry-head">
                <span class="battle-log-actor">R${round.round} · ${round.actorName} (${round.actionName})</span>
                <span class="battle-log-dmg" style="color:${dmgCol};">${dmgLabel}</span>
              </div>
              <div>${round.logText}</div>
            </div>
          `;
        }

        function buildBattleOutcomeHTML(battle) {
          const lootParts = formatBattleLootSummary(battle);
          const lossText =
            battle.lostTotal > 0
              ? `Truppenverluste: ${battle.lostTotal} von ${battle.totalSent} Soldaten`
              : `Verlustfrei (${battle.totalSent}/${battle.totalSent} Soldaten unverletzt)`;
          return `
            <div class="battle-result-card ${battle.victory ? 'victory' : 'defeat'}">
              <div class="battle-result-title">
                <span>${battle.victory ? 'SIEG ÜBER DEN SAURIER!' : 'JAGDTRUPP IM RÜCKZUG'}</span>
                <span class="mono" style="font-size:11px;">${battle.rounds.length} Runden</span>
              </div>
              <div style="font-size:11px;color:var(--text-secondary);">
                ${lossText}${battle.counterMatched ? ' · Klassen-Konter aktiv (+15%)' : ''}
              </div>
              ${
                battle.victory
                  ? `
                    <div class="battle-loot-grid">
                      ${
                        lootParts.length
                          ? lootParts.map((p) => `<span class="battle-loot-entry">${p}</span>`).join('')
                          : `<span class="battle-loot-entry">Erfahrung gesammelt</span>`
                      }
                      ${battle.newlyDiscovered ? `<span class="battle-loot-entry" style="border-color:rgba(251,191,36,0.55);color:#fde047;">Neu im Bestiarium!</span>` : ''}
                    </div>
                  `
                  : `
                    <div style="font-size:11px;color:#fecaca;line-height:1.4;">
                      ${battle.weaknessTip ? `Taktik-Hinweis: ${battle.weaknessTip}` : 'Stärke deine Helden mit Gear oder trainiere mehr Soldaten für den nächsten Versuch.'}
                    </div>
                  `
              }
            </div>
          `;
        }

        function updateBattleArenaHP(battle, squadHp, dinoHp) {
          const sqPct = Math.max(0, Math.min(100, Math.round((squadHp / Math.max(1, battle.squadHpMax)) * 100)));
          const dnPct = Math.max(0, Math.min(100, Math.round((dinoHp / Math.max(1, battle.dinoHpMax)) * 100)));
          const sqFill = document.getElementById('battleSquadHpFill');
          const dnFill = document.getElementById('battleDinoHpFill');
          const sqTxt = document.getElementById('battleSquadHpText');
          const dnTxt = document.getElementById('battleDinoHpText');
          if (sqFill) sqFill.style.transform = `scaleX(${(sqPct / 100).toFixed(3)})`;
          if (dnFill) dnFill.style.transform = `scaleX(${(dnPct / 100).toFixed(3)})`;
          if (sqTxt) sqTxt.textContent = `${fmtNum(squadHp)}/${fmtNum(battle.squadHpMax)} (${sqPct}%)`;
          if (dnTxt) dnTxt.textContent = `${fmtNum(dinoHp)}/${fmtNum(battle.dinoHpMax)} (${dnPct}%)`;
        }

        function spawnBattleFx(round) {
          const fxLayer = document.getElementById('battleFxLayer');
          if (!fxLayer || prefersReducedMotion) return;
          const isSquad = round.actorSide === 'squad';

          // Projektil / Ansturm-Spur
          const proj = document.createElement('div');
          proj.className = `battle-proj ${isSquad ? 'to-dino' : 'to-squad'}`;
          fxLayer.appendChild(proj);

          // Treffer-Hieb SVG
          const slash = document.createElement('div');
          slash.className = `battle-slash ${isSquad ? 'on-dino' : 'on-squad'}`;
          const strokeCol = isSquad ? (round.isCrit ? '#fb923c' : '#fde047') : round.isShield ? '#60a5fa' : '#f87171';
          slash.innerHTML = `<svg viewBox="0 0 64 64" width="56" height="56" fill="none"><path d="M12 52 L52 12 M18 40 L44 14 M24 50 L50 24" stroke="${strokeCol}" stroke-width="4" stroke-linecap="round"/></svg>`;
          fxLayer.appendChild(slash);

          // Schwebender Schadenswert
          const dmgEl = document.createElement('div');
          dmgEl.className = `battle-dmg-float ${isSquad ? 'on-dino' : 'on-squad'} ${round.isCrit ? 'crit' : ''} ${round.isShield ? 'shield' : ''}`;
          dmgEl.textContent = round.isShield
            ? `BLOCK −${fmtNum(round.damage)}`
            : round.isCrit
            ? `−${fmtNum(round.damage)} KRIT!`
            : `−${fmtNum(round.damage)}`;
          fxLayer.appendChild(dmgEl);

          const cleanupTimer = setTimeout(() => {
            proj.remove();
            slash.remove();
            dmgEl.remove();
          }, 760);
          battleAnimState.timers.push(cleanupTimer);
        }

        function finishBattlePresentation(battle, silentSound = false) {
          clearBattleAnimTimers();
          battleAnimState.finished = true;

          const lastRound = battle.rounds[battle.rounds.length - 1];
          if (lastRound) {
            updateBattleArenaHP(battle, lastRound.squadHp, lastRound.dinoHp);
          }

          const roundInd = document.getElementById('battleRoundIndicator');
          if (roundInd) {
            roundInd.textContent = battle.victory ? 'GEFECHT BEENDET · SIEG' : 'GEFECHT BEENDET · RÜCKZUG';
          }

          const dinoStage = document.getElementById('battleDinoStage');
          if (dinoStage && battle.victory) {
            dinoStage.classList.add('is-defeated');
          }

          const feed = document.getElementById('battleLogFeed');
          if (feed) {
            feed.innerHTML = battle.rounds.map((r) => renderBattleLogEntryHTML(r)).join('');
            feed.scrollTop = feed.scrollHeight;
          }

          const outcomeSlot = document.getElementById('battleOutcomeSlot');
          if (outcomeSlot) {
            outcomeSlot.innerHTML = buildBattleOutcomeHTML(battle);
          }

          const skipBtn = document.getElementById('btnBattleSkip');
          if (skipBtn) skipBtn.style.display = 'none';
          const replayBtn = document.getElementById('btnBattleReplay');
          if (replayBtn) replayBtn.style.display = 'inline-flex';

          if (!silentSound) {
            SoundFX.play(battle.victory ? 'victory' : 'defeat');
          }
        }

        function playBattleRoundStep(battle, idx) {
          if (!battleAnimState.active || battleAnimState.battleId !== battle.id) return;
          if (idx >= battle.rounds.length) {
            finishBattlePresentation(battle, false);
            return;
          }

          const round = battle.rounds[idx];
          const isSquad = round.actorSide === 'squad';
          const arena = document.getElementById('battleArena');
          const dinoStage = document.getElementById('battleDinoStage');
          const roundInd = document.getElementById('battleRoundIndicator');
          const heroTokens = Array.from(document.querySelectorAll('.battle-hero-token'));

          if (roundInd) {
            roundInd.textContent = `Runde ${round.round} / ${battle.rounds.length}`;
          }

          // Vorherige Animationsklassen entfernen
          if (arena) arena.classList.remove('shake');
          if (dinoStage) dinoStage.classList.remove('is-attacking', 'is-hit');
          heroTokens.forEach((el) => el.classList.remove('is-attacking', 'is-hit', 'is-shield'));

          // Force reflow für sauberen Neustart der Keyframes
          if (arena) void arena.offsetWidth;

          if (isSquad) {
            const actingToken =
              heroTokens.find((el) => el.dataset.battleHeroId === round.heroId) || heroTokens[0];
            if (actingToken) actingToken.classList.add('is-attacking');
            if (dinoStage) dinoStage.classList.add('is-hit');
            if (round.isCrit && arena) arena.classList.add('shake');
            SoundFX.play(round.isCrit ? 'crit' : 'hit');
          } else {
            if (dinoStage) dinoStage.classList.add('is-attacking');
            heroTokens.forEach((el) => {
              if (round.isShield && el.dataset.battleHeroId === round.heroId) {
                el.classList.add('is-shield');
              } else {
                el.classList.add('is-hit');
              }
            });
            if (arena) arena.classList.add('shake');
            SoundFX.play('roar');
          }

          spawnBattleFx(round);
          updateBattleArenaHP(battle, round.squadHp, round.dinoHp);

          const feed = document.getElementById('battleLogFeed');
          if (feed) {
            feed.insertAdjacentHTML('beforeend', renderBattleLogEntryHTML(round));
            feed.scrollTop = feed.scrollHeight;
          }

          const stepDelay = battleAnimState.speed === 2 ? 430 : 820;
          const nextTimer = setTimeout(() => playBattleRoundStep(battle, idx + 1), stepDelay);
          battleAnimState.timers.push(nextTimer);
        }

        function openBattleReplayModal(battleId, opts = { animate: true }) {
          const battle = getBattleLogById(battleId);
          if (!battle) return;

          hideBattleAlertBanner();
          clearBattleAnimTimers();

          if (!battle.read) {
            battle.read = true;
            saveState();
            renderHUD();
            if (activeTab === 'heroes') renderHeroesTab();
          }

          battleAnimState.active = true;
          battleAnimState.battleId = battle.id;
          battleAnimState.finished = false;

          const shouldAnimate = Boolean(opts && opts.animate !== false) && !prefersReducedMotion;
          const heroTokensHtml = battle.heroes.length
            ? battle.heroes
                .map(
                  (h) => `
                    <div class="battle-hero-token" data-battle-hero-id="${h.id}" style="--hero-col:${h.color};">
                      <div class="battle-hero-icon">${getHeroRoleIconSVG(h.role, h.color)}</div>
                      <div class="battle-hero-label">
                        <div class="battle-hero-name">${h.shortName}</div>
                        <div class="battle-hero-role">${h.role} · Lv.${h.level}</div>
                      </div>
                    </div>
                  `
                )
                .join('')
            : `
                <div class="battle-hero-token" data-battle-hero-id="squad">
                  <div class="battle-hero-label">
                    <div class="battle-hero-name">Stammes-Trupp</div>
                    <div class="battle-hero-role">${battle.totalSent} Soldaten</div>
                  </div>
                </div>
              `;

          const troopsNote = [];
          if (battle.troopsSent.slinger > 0) troopsNote.push(`${battle.troopsSent.slinger} Schleud.`);
          if (battle.troopsSent.clubman > 0) troopsNote.push(`${battle.troopsSent.clubman} Keulen`);
          if (battle.troopsSent.dinorider > 0) troopsNote.push(`${battle.troopsSent.dinorider} Reiter`);

          const content = document.getElementById('battleModalContent');
          content.innerHTML = `
            <div class="battle-modal-head">
              <div style="min-width:0;">
                <h3 class="battle-modal-title">Jagd-Gefecht · ${battle.speciesName}</h3>
                <div class="battle-modal-sub">St. ${battle.dinoLevel} · Macht ${fmtNum(battle.squadPower)} vs ${fmtNum(battle.dinoPower)}</div>
              </div>
              <div class="battle-head-controls">
                <button class="battle-speed-btn" data-battle-speed="1">${battleAnimState.speed}×</button>
                <button class="close-btn" data-battle-close="1" aria-label="Kampfbericht schließen">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            <div class="battle-modal-body">
              <div class="battle-arena" id="battleArena">
                <div class="battle-round-bar">
                  <span class="battle-round-indicator" id="battleRoundIndicator">
                    ${shouldAnimate ? 'Gefecht beginnt...' : battle.victory ? 'GEFECHT BEENDET · SIEG' : 'GEFECHT BEENDET · RÜCKZUG'}
                  </span>
                  <span>${battle.counterMatched ? 'Konter +15%' : 'Standard-Formation'}</span>
                </div>
                <div class="battle-stage-grid">
                  <div class="battle-side">
                    <div class="battle-hero-stack">${heroTokensHtml}</div>
                    <div class="battle-troop-footnote">${troopsNote.join(' · ') || `${battle.totalSent} Soldaten`}</div>
                  </div>
                  <div class="battle-vs-center">
                    <span class="battle-vs-mark">VS</span>
                  </div>
                  <div class="battle-side">
                    <div class="battle-dino-stage" id="battleDinoStage">
                      ${getDinoIconSVG(battle.speciesId, 52, battle.speciesAccent || '#fca5a5')}
                      <div class="battle-dino-name">${battle.speciesName}</div>
                      <div class="battle-dino-pwr">St. ${battle.dinoLevel} · ${fmtNum(battle.dinoPower)}</div>
                    </div>
                  </div>
                  <div class="battle-fx-layer" id="battleFxLayer"></div>
                </div>
                <div class="battle-hp-row">
                  <div class="battle-hp-box">
                    <div class="battle-hp-meta">
                      <span>Jagdtrupp</span>
                      <span class="mono" id="battleSquadHpText">${fmtNum(battle.squadHpMax)}/${fmtNum(battle.squadHpMax)} (100%)</span>
                    </div>
                    <div class="battle-hp-track">
                      <div class="battle-hp-fill squad" id="battleSquadHpFill"></div>
                    </div>
                  </div>
                  <div class="battle-hp-box">
                    <div class="battle-hp-meta">
                      <span>Saurier</span>
                      <span class="mono" id="battleDinoHpText">${fmtNum(battle.dinoHpMax)}/${fmtNum(battle.dinoHpMax)} (100%)</span>
                    </div>
                    <div class="battle-hp-track">
                      <div class="battle-hp-fill dino" id="battleDinoHpFill"></div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="battle-log-feed" id="battleLogFeed" aria-live="polite"></div>
              <div id="battleOutcomeSlot"></div>

              <div class="battle-modal-footer">
                <button class="btn-secondary" id="btnBattleSkip" data-battle-skip="1" style="${shouldAnimate ? '' : 'display:none;'}">Überspringen</button>
                <button class="btn-secondary" id="btnBattleReplay" data-battle-replay="${battle.id}" style="${shouldAnimate ? 'display:none;' : ''}">Nochmal</button>
                ${
                  activeTab !== 'heroes' || heroSubTab !== 'battles'
                    ? `<button class="btn-secondary" data-battle-goto-log="1">Kampf-Log</button>`
                    : ''
                }
                <button class="btn-primary" data-battle-close="1">Schließen</button>
              </div>
            </div>
          `;

          document.getElementById('battleModalBackdrop').classList.add('open');

          if (shouldAnimate) {
            updateBattleArenaHP(battle, battle.squadHpMax, battle.dinoHpMax);
            const startTimer = setTimeout(() => playBattleRoundStep(battle, 0), 260);
            battleAnimState.timers.push(startTimer);
          } else {
            finishBattlePresentation(battle, true);
          }
        }

        function showOfflineReport(report) {
          const gains = Object.entries(report.gained)
            .filter(([, v]) => v !== 0)
            .map(([r, v]) => `${v > 0 ? '+' : ''}${v} ${RESOURCE_LABELS[r]}`)
            .join(' · ');

          const events = [];
          if (report.completedBuilds.length) events.push(`Abgeschlossen: ${report.completedBuilds.join(', ')}`);
          if (report.completedResearch.length) events.push(`Erforscht: ${report.completedResearch.join(', ')}`);
          if (report.finishedExpeditions > 0) events.push(`${report.finishedExpeditions} Expedition(en) zurückgekehrt`);
          if (report.worldDeliveries > 0) events.push(`${report.worldDeliveries} Sammeltrupp(s) von der Weltkarte geliefert`);
          if (report.newVillagers > 0) events.push(`+${report.newVillagers} neue(r) Bewohner`);

          openCenterModal(`
            <h3>Willkommen zurück am Feuer</h3>
            <p class="info-line">Du warst <strong class="mono">${fmtDuration(report.elapsedSec)}</strong> abwesend. Dein Stamm hat weitergearbeitet:</p>
            <div class="stat-box">
              <div class="stat-label">Ressourcen-Veränderung</div>
              <div class="stat-value" style="font-size:12.5px; margin-top:4px;">${gains || 'Ausgeglichen'}</div>
            </div>
            ${
              events.length
                ? `<div class="stat-box"><div class="stat-label">Ereignisse</div><div style="font-size:12.5px; color:var(--text-primary); margin-top:4px;">${events.join('<br>')}</div></div>`
                : ''
            }
            <button class="btn-primary" id="btnCloseCenterModal">Weiterführen</button>
          `);
        }

        function escapeHtmlMp(str) {
          return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function computeVillagePowerMp() {
          let total = 0;
          for (const id of BUILDING_ORDER) {
            const b = state.buildings && state.buildings[id];
            if (b) total += (b.level || 1) * (id === 'bonfire' ? 180 : 65);
          }
          if (state.troops) {
            total += (state.troops.slinger || 0) * 14;
            total += (state.troops.clubman || 0) * 20;
            total += (state.troops.dinorider || 0) * 34;
          }
          if (state.heroes) {
            for (const h of Object.values(state.heroes)) {
              if (h && h.unlocked) total += (h.level || 1) * 45 + (h.stars || 1) * 90;
            }
          }
          return Math.max(100, Math.round(total));
        }

        function renderWorldChatUI() {
          const listEl = document.getElementById('mpChatList');
          const onlineEl = document.getElementById('mpChatOnlineLabel');
          const badgeEl = document.getElementById('mpChatUnreadBadge');
          const ownUid = mpWorld.session ? mpWorld.session.uid : null;

          if (onlineEl) {
            const count = Math.max(1, mpWorld.onlinePlayers || 1);
            onlineEl.textContent = `${count} ${count === 1 ? 'Stamm' : 'Stämme'} online`;
          }
          if (badgeEl) {
            if (mpWorld.unreadChat > 0 && !mpWorld.chatOpen) {
              badgeEl.style.display = 'inline-flex';
              badgeEl.textContent = mpWorld.unreadChat > 99 ? '99+' : String(mpWorld.unreadChat);
            } else {
              badgeEl.style.display = 'none';
            }
          }
          if (!listEl) return;
          const msgs = mpWorld.chat || [];
          if (msgs.length === 0) {
            listEl.innerHTML = '<div style="font-size:12px;color:#a8a29e;text-align:center;margin-top:24px;">Noch keine Nachrichten im Welt-Chat.</div>';
            return;
          }
          listEl.innerHTML = msgs
            .map((m) => {
              const isMine = ownUid && m.uid === ownUid;
              const d = new Date(m.createdAt || Date.now());
              const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              return `
                <div class="mp-chat-msg ${isMine ? 'is-mine' : ''}">
                  <div class="mp-chat-msg-meta">
                    <span class="mp-chat-sender">${escapeHtmlMp(m.tribeName || 'Stamm')} <span class="mp-chat-lvl">· Feuer St.${m.bonfireLevel || 1}</span></span>
                    <span class="mp-chat-lvl mono">${timeStr}</span>
                  </div>
                  <div>${escapeHtmlMp(m.text)}</div>
                </div>
              `;
            })
            .join('');
          listEl.scrollTop = listEl.scrollHeight;
        }

        function toggleWorldChatDrawer(forceOpen) {
          const drawer = document.getElementById('worldChatDrawer');
          if (!drawer) return;
          mpWorld.chatOpen = typeof forceOpen === 'boolean' ? forceOpen : !mpWorld.chatOpen;
          drawer.classList.toggle('open', mpWorld.chatOpen);
          if (mpWorld.chatOpen) {
            mpWorld.unreadChat = 0;
            if (mpWorld.chat.length > 0) {
              mpWorld.lastSeenChatId = mpWorld.chat[mpWorld.chat.length - 1].messageId;
            }
            renderWorldChatUI();
          }
        }

        function openSettingsModal() {
          const nextRot = getBonfireSecondReq(state.buildings.bonfire.level);
          const rotName = BUILDINGS[nextRot.buildingId].name;
          const sess = (window.DinoMultiplayer && window.DinoMultiplayer.getSession()) || {
            isGuest: true,
            email: null,
            tribeName: 'Glutstamm',
            cloudSynced: false,
            onlinePlayers: 1
          };
          const safeTribe = escapeHtmlMp(sess.tribeName || 'Glutstamm');
          const accountHtml = sess.isGuest
            ? `
              <div class="mp-account-box">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <strong style="font-size:12.5px;color:#fde68a;">Konto &amp; Cloud-Sicherung</strong>
                  <span style="font-size:11px;color:#fbbf24;">Gast-Modus</span>
                </div>
                <div style="font-size:11.5px;color:var(--text-secondary);">
                  Du spielst sofort online als Gast. Verknüpfe dein Google-Konto, um dein Dorf dauerhaft in der Cloud (und für die spätere Unity-Version) zu sichern.
                </div>
                <div class="mp-tribe-row">
                  <input class="mp-tribe-input" id="mpTribeNameInput" type="text" maxlength="28" value="${safeTribe}" placeholder="Stammesname" />
                  <button class="btn-secondary" id="btnMpSaveTribeName" style="min-height:36px;padding:0 12px;">Name</button>
                </div>
                <button class="btn-primary" id="btnMpGoogleSignIn" style="min-height:40px;">Mit Google-Konto verknüpfen &amp; sichern</button>
              </div>
            `
            : `
              <div class="mp-account-box">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <strong style="font-size:12.5px;color:#86efac;">Cloud-Konto aktiv</strong>
                  <span style="font-size:11px;color:#86efac;">${escapeHtmlMp(sess.email || 'Google verknüpft')}</span>
                </div>
                <div style="font-size:11.5px;color:var(--text-secondary);">
                  Dein Spielstand wird automatisch in Cloud Firestore gesichert und steht geräteübergreifend sowie später in Unity bereit.
                </div>
                <div class="mp-tribe-row">
                  <input class="mp-tribe-input" id="mpTribeNameInput" type="text" maxlength="28" value="${safeTribe}" placeholder="Stammesname" />
                  <button class="btn-secondary" id="btnMpSaveTribeName" style="min-height:36px;padding:0 12px;">Name</button>
                </div>
                <div class="btn-row">
                  <button class="btn-secondary" id="btnMpForceCloudSave">Jetzt sichern</button>
                  <button class="btn-secondary" id="btnMpSignOut">Abmelden</button>
                </div>
              </div>
            `;

          openCenterModal(`
            <h3>Lager-Einstellungen</h3>
            ${accountHtml}
            <div class="stat-box">
              <div class="stat-label">Nächste Signalfeuer-Regel (St. ${state.buildings.bonfire.level} → ${Math.min(MAX_LEVEL, state.buildings.bonfire.level + 1)})</div>
              <div style="font-size:12.5px; color:var(--text-primary); margin-top:4px;">
                ${
                  state.buildings.bonfire.level >= MAX_LEVEL
                    ? 'Maximale Stufe erreicht.'
                    : `Wohnhütte ≥ St. ${state.buildings.bonfire.level} und ${rotName} ≥ St. ${state.buildings.bonfire.level}`
                }
              </div>
            </div>
            <div class="btn-row">
              <button class="btn-secondary" id="btnToggleSound">Ton: ${state.soundEnabled ? 'AN' : 'AUS'}</button>
              <button class="btn-secondary" id="btnShowTitle">Titelbild</button>
            </div>
            <button class="btn-danger" id="btnConfirmResetAsk">Neues Spiel starten (Reset)</button>
            <button class="btn-primary" id="btnCloseCenterModal">Zurück ins Lager</button>
          `);
        }

        function openResetConfirmModal() {
          openCenterModal(`
            <h3>Siedlung wirklich zurücksetzen?</h3>
            <p class="info-line">Alle Gebäudestufen, Forschungen, Ressourcen und Expeditionen werden unwiderruflich gelöscht.</p>
            <div class="btn-row">
              <button class="btn-secondary" id="btnCancelReset">Abbrechen</button>
              <button class="btn-danger" id="btnExecuteReset">Endgültig löschen</button>
            </div>
          `);
        }

        /* =====================================================================
           12. PARTIKEL-CANVAS (FUNKEN, ASCHESTURM & KÄLTE-KRISTALLE)
           ===================================================================== */
        const canvas = document.getElementById('particleCanvas');
        const ctx = canvas.getContext('2d');
        const particles = [];
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function resizeVillageScene() {
          if (window.Village3D) window.Village3D.resize();
        }

        function resizeCanvas() {
          resizeVillageScene();
          if (window.WorldMap3D) {
            window.WorldMap3D.resize();
            if (activeTab === 'worldmap') {
              applyWorldCamera(worldCam.cx, worldCam.cy, worldCam.zoom);
            }
          }
          const stage = document.getElementById('villageStage');
          if (!stage) return;
          const rect = stage.getBoundingClientRect();
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.max(1, Math.floor(rect.width * dpr));
          canvas.height = Math.max(1, Math.floor(rect.height * dpr));
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        let lastFrameTs = performance.now();
        function animateParticles(ts) {
          const dt = Math.min(0.05, (ts - lastFrameTs) / 1000);
          lastFrameTs = ts;

          const w = canvas.clientWidth || 380;
          const h = canvas.clientHeight || 620;
          ctx.clearRect(0, 0, w, h);

          if (!prefersReducedMotion && activeTab === 'village') {
            // Wetter-Partikel (Asche oder Frost) über der 3D-Szene; Signalfeuer-Funken laufen direkt in 3D!
            const isStorm = state.weather.phase === 'storm';
            const isWarn = state.weather.phase === 'warning';
            const weatherChance = isStorm ? 0.8 : isWarn ? 0.22 : 0.07;
            if (Math.random() < weatherChance && particles.length < 110) {
              const isCold = (isStorm || isWarn) && state.weather.type === 'cold';
              particles.push({
                kind: isCold ? 'frost' : 'ash',
                x: Math.random() * (w + 60) - 30,
                y: -8,
                vx: isStorm ? (isCold ? -38 : -54) + Math.random() * 18 : -10 + Math.random() * 8,
                vy: isStorm ? 65 + Math.random() * 55 : 18 + Math.random() * 22,
                life: 5.5,
                age: 0,
                size: isCold ? 1.8 + Math.random() * 2.2 : 1.5 + Math.random() * 2.4
              });
            }

            for (let i = particles.length - 1; i >= 0; i--) {
              const p = particles[i];
              p.age += dt;
              p.x += p.vx * dt;
              p.y += p.vy * dt;
              if (p.kind === 'spark') {
                p.vx += Math.sin(ts * 0.004 + i) * 6 * dt;
              }
              const alpha = Math.max(0, 1 - p.age / p.life);
              if (alpha <= 0 || p.y > h + 15 || p.y < -25 || p.x < -40 || p.x > w + 40) {
                particles.splice(i, 1);
                continue;
              }
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
              if (p.kind === 'spark') {
                ctx.fillStyle = `rgba(251, 146, 60, ${(alpha * 0.85).toFixed(2)})`;
              } else if (p.kind === 'frost') {
                ctx.fillStyle = `rgba(186, 230, 253, ${(alpha * 0.65).toFixed(2)})`;
              } else {
                ctx.fillStyle = `rgba(180, 170, 160, ${(alpha * 0.45).toFixed(2)})`;
              }
              ctx.fill();
            }
          }

          requestAnimationFrame(animateParticles);
        }

        /* =====================================================================
           13. EVENT-DELEGATION & INITIALISIERUNG
           ===================================================================== */
        function bindEvents() {
          // Titelbildschirm starten
          document.getElementById('btnStartGame').addEventListener('click', () => {
            state.started = true;
            SoundFX.play('horn');
            document.getElementById('titleScreen').classList.add('hidden');
            saveState();
            renderAll();
          });

          // Tastatur-Start auf Titelbildschirm + Escape schließt Sheet
          window.addEventListener('keydown', (e) => {
            const title = document.getElementById('titleScreen');
            if (!title.classList.contains('hidden') && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              document.getElementById('btnStartGame').click();
            } else if (e.key === 'Escape') {
              closeSheet();
              closeCenterModal();
            }
          });

          // Bottom Tabs
          document.querySelectorAll('.tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
          });

          // Dauerhafter Signalfeuer-Modus im Dorf-Banner
          document.getElementById('btnModeNormal').addEventListener('click', () => setFireMode('normal'));
          document.getElementById('btnModeOverheat').addEventListener('click', () => setFireMode('overheat'));
          document.getElementById('btnQueueFreeFinish').addEventListener('click', tryFreeFinishBuild);
          document.getElementById('btnSettings').addEventListener('click', () => {
            SoundFX.play('tap');
            openSettingsModal();
          });

          // 3D-Dorf auf Signalfeuer zentrieren
          const btnVillageCenter = document.getElementById('btnVillageCenter');
          if (btnVillageCenter) {
            btnVillageCenter.addEventListener('click', () => {
              SoundFX.play('tap');
              if (window.Village3D) window.Village3D.centerOn('bonfire');
            });
          }

          // Gebäude-Plaketten auf der 3D-Karte anklicken
          document.getElementById('mapNodes').addEventListener('click', (e) => {
            if (window.Village3D && window.Village3D.isDragging()) return;
            const node = e.target.closest('[data-building]');
            if (!node) return;
            SoundFX.play('tap');
            openBuildingSheet(node.dataset.building);
          });

          // Weltkarte: Ziehen (Pan), Mausrad-Zoom, 2-Finger-Pinch-Zoom, Doppelklick-Zoom & 2x2 Ghost-Ziehen
          const wmViewport = document.getElementById('worldMapViewport');
          const clientToWorldTile = (clientX, clientY) => {
            const rect = wmViewport.getBoundingClientRect();
            const sx = clientX - rect.left;
            const sy = clientY - rect.top;
            const pt = screenToWorld(sx, sy, rect.width || 380, rect.height || 600);
            return { wx: pt.wx, wy: pt.wy, sx, sy, rect };
          };

          const getTwoPointerInfo = () => {
            const pts = Array.from(worldCam.activePointers.values());
            if (pts.length < 2) return null;
            const a = pts[0];
            const b = pts[1];
            return {
              dist: Math.max(12, Math.hypot(b.x - a.x, b.y - a.y)),
              midX: (a.x + b.x) / 2,
              midY: (a.y + b.y) / 2
            };
          };

          // Mausrad-Zoom um die Cursor-Position (analog zum 3D-Dorf)
          wmViewport.addEventListener(
            'wheel',
            (e) => {
              if (e.target.closest('.wm-march-bar') || e.target.closest('.wm-teleport-bar')) return;
              e.preventDefault();
              const rect = wmViewport.getBoundingClientRect();
              const fx = e.clientX - rect.left;
              const fy = e.clientY - rect.top;
              const delta = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
              const factor = Math.exp(-delta * 0.0018);
              zoomWorldMapAt(factor, fx, fy, true);
            },
            { passive: false }
          );

          // Doppelklick auf freie Weltkarte zoomt geschmeidig hinein
          wmViewport.addEventListener('dblclick', (e) => {
            if (
              e.target.closest('.wm-top-bar') ||
              e.target.closest('.wm-march-bar') ||
              e.target.closest('.wm-teleport-bar') ||
              e.target.closest('.wm-node')
            ) {
              return;
            }
            const rect = wmViewport.getBoundingClientRect();
            zoomWorldMapAt(2.1, e.clientX - rect.left, e.clientY - rect.top, true);
          });

          wmViewport.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.wm-top-bar') || e.target.closest('.wm-march-bar') || e.target.closest('.wm-teleport-bar')) return;

            // Direktes Ziehen der 2x2-Ghost-Vorschau über das 1200×1200-Raster
            const ghostEl = e.target.closest('#wmGhostPreview');
            if (teleportGhost.active && ghostEl) {
              e.stopPropagation();
              const pt = clientToWorldTile(e.clientX, e.clientY);
              teleportGhost.dragging = true;
              teleportGhost.pointerId = e.pointerId;
              teleportGhost.offsetTileX = pt.wx - teleportGhost.anchorX;
              teleportGhost.offsetTileY = pt.wy - teleportGhost.anchorY;
              try {
                wmViewport.setPointerCapture(e.pointerId);
              } catch (_) {}
              renderTeleportGhostUI();
              return;
            }

            stopWorldCamAnimation();
            worldCam.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (worldCam.activePointers.size >= 2) {
              const info = getTwoPointerInfo();
              if (info) {
                const rect = wmViewport.getBoundingClientRect();
                const midSx = info.midX - rect.left;
                const midSy = info.midY - rect.top;
                const wPt = screenToWorld(midSx, midSy, rect.width || 380, rect.height || 600);
                worldCam.pinchActive = true;
                worldCam.dragging = false;
                worldCam.moved = true;
                worldCam.pinchStartDist = info.dist;
                worldCam.pinchStartZoom = worldCam.zoom;
                worldCam.pinchWorldX = wPt.wx;
                worldCam.pinchWorldY = wPt.wy;
                wmViewport.classList.add('dragging');
              }
              return;
            }

            worldCam.pinchActive = false;
            worldCam.dragging = true;
            worldCam.moved = false;
            worldCam.pointerId = e.pointerId;
            worldCam.startX = e.clientX;
            worldCam.startY = e.clientY;
            worldCam.originCx = worldCam.cx;
            worldCam.originCy = worldCam.cy;
          });

          wmViewport.addEventListener('pointermove', (e) => {
            if (teleportGhost.active && teleportGhost.dragging && e.pointerId === teleportGhost.pointerId) {
              const pt = clientToWorldTile(e.clientX, e.clientY);
              const nextAx = Math.round(pt.wx - teleportGhost.offsetTileX);
              const nextAy = Math.round(pt.wy - teleportGhost.offsetTileY);
              if (nextAx !== teleportGhost.anchorX || nextAy !== teleportGhost.anchorY) {
                setGhostAnchor(nextAx, nextAy);
              }
              return;
            }

            if (worldCam.activePointers.has(e.pointerId)) {
              worldCam.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }

            // 2-Finger-Pinch-Zoom + gleichzeitiges Verschieben um den Finger-Mittelpunkt
            if (worldCam.pinchActive && worldCam.activePointers.size >= 2) {
              const info = getTwoPointerInfo();
              if (info) {
                const rect = wmViewport.getBoundingClientRect();
                const vw = rect.width || 380;
                const vh = rect.height || 600;
                const isoY = getWorldIsoYScale();
                const minZoom = getWorldMinZoom(vw, vh);
                const ratio = info.dist / Math.max(12, worldCam.pinchStartDist);
                const nextZoom = Math.max(minZoom, Math.min(WORLD_CAM_MAX_ZOOM, worldCam.pinchStartZoom * ratio));
                const midSx = info.midX - rect.left;
                const midSy = info.midY - rect.top;
                const nextCx = worldCam.pinchWorldX - (midSx - vw / 2) / nextZoom;
                const nextCy = worldCam.pinchWorldY - (midSy - vh / 2) / (nextZoom * isoY);
                setWorldCameraTarget(nextCx, nextCy, nextZoom, false);
              }
              return;
            }

            if (!worldCam.dragging || e.pointerId !== worldCam.pointerId) return;
            const dx = e.clientX - worldCam.startX;
            const dy = e.clientY - worldCam.startY;
            if (!worldCam.moved && Math.hypot(dx, dy) > 6) {
              worldCam.moved = true;
              wmViewport.classList.add('dragging');
              try {
                wmViewport.setPointerCapture(e.pointerId);
              } catch (_) {}
            }
            if (worldCam.moved) {
              const isoY = getWorldIsoYScale();
              const nextCx = worldCam.originCx - dx / worldCam.zoom;
              const nextCy = worldCam.originCy - dy / (worldCam.zoom * isoY);
              setWorldCameraTarget(nextCx, nextCy, worldCam.zoom, false);
            }
          });

          const endWorldDrag = (e) => {
            if (teleportGhost.dragging && e.pointerId === teleportGhost.pointerId) {
              teleportGhost.dragging = false;
              try {
                if (wmViewport.hasPointerCapture(e.pointerId)) wmViewport.releasePointerCapture(e.pointerId);
              } catch (_) {}
              renderTeleportGhostUI();
              return;
            }

            worldCam.activePointers.delete(e.pointerId);

            if (worldCam.pinchActive) {
              if (worldCam.activePointers.size < 2) {
                worldCam.pinchActive = false;
                if (worldCam.activePointers.size === 1) {
                  const [remId, remPt] = Array.from(worldCam.activePointers.entries())[0];
                  worldCam.dragging = true;
                  worldCam.pointerId = remId;
                  worldCam.startX = remPt.x;
                  worldCam.startY = remPt.y;
                  worldCam.originCx = worldCam.cx;
                  worldCam.originCy = worldCam.cy;
                } else {
                  wmViewport.classList.remove('dragging');
                  setTimeout(() => {
                    worldCam.moved = false;
                  }, 0);
                }
              }
              return;
            }

            if (!worldCam.dragging || e.pointerId !== worldCam.pointerId) return;
            const wasMoved = worldCam.moved;
            worldCam.dragging = false;
            wmViewport.classList.remove('dragging');
            try {
              if (wmViewport.hasPointerCapture(e.pointerId)) wmViewport.releasePointerCapture(e.pointerId);
            } catch (_) {}

            // Tippen auf die Weltkarte im Teleport-Modus snappt die 2x2-Vorschau direkt dorthin
            if (!wasMoved && teleportGhost.active && !e.target.closest('.wm-top-bar') && !e.target.closest('.wm-teleport-bar')) {
              const pt = clientToWorldTile(e.clientX, e.clientY);
              const targetAx = Math.floor(pt.wx - 0.5);
              const targetAy = Math.floor(pt.wy - 0.5);
              SoundFX.play('tap');
              setGhostAnchor(targetAx, targetAy);
            } else if (
              !wasMoved &&
              !teleportGhost.active &&
              isWorldMap3DReady() &&
              !e.target.closest('.wm-node') &&
              !e.target.closest('.wm-top-bar') &&
              !e.target.closest('.wm-march-bar') &&
              !e.target.closest('.wm-teleport-bar')
            ) {
              // Direktes Antippen auf ein 3D-Modell (Siedlung, Sammelstelle oder Dino) per Raycast
              const rect = wmViewport.getBoundingClientRect();
              const pick = window.WorldMap3D.pickEntityAt(e.clientX - rect.left, e.clientY - rect.top);
              if (pick) {
                SoundFX.play('tap');
                if (pick.kind === 'volcano') {
                  openVolcanoSheet();
                } else if (pick.kind === 'home') {
                  openOwnSettlementSheet();
                } else if (pick.kind === 'player') {
                  const pl = (mpWorld.settlements || []).find((s) => String(s.uid) === String(pick.id));
                  if (pl) {
                    showToast(`${pl.tribeName} · Signalfeuer St. ${pl.bonfireLevel} · Macht ${pl.power} · Grid [${pl.tileX}, ${pl.tileY}]`, 'info');
                  }
                } else if (pick.kind === 'node') {
                  openWorldNodeSheet(pick.id);
                } else if (pick.kind === 'dino') {
                  openWorldDinoSheet(pick.id);
                }
              }
            }

            if (wasMoved) {
              setTimeout(() => {
                worldCam.moved = false;
              }, 0);
            }
          };
          wmViewport.addEventListener('pointerup', endWorldDrag);
          wmViewport.addEventListener('pointercancel', endWorldDrag);

          document.getElementById('worldMapMarkers').addEventListener('click', (e) => {
            if (teleportGhost.active) return;
            if (worldCam.moved) {
              worldCam.moved = false;
              return;
            }
            const volcanoBtn = e.target.closest('[data-wm-volcano]');
            if (volcanoBtn) {
              SoundFX.play('tap');
              openVolcanoSheet();
              return;
            }
            const homeBtn = e.target.closest('[data-wm-home]');
            if (homeBtn) {
              SoundFX.play('tap');
              openOwnSettlementSheet();
              return;
            }
            const playerBtn = e.target.closest('[data-wm-player]');
            if (playerBtn) {
              const pl = (mpWorld.settlements || []).find((s) => s.uid === playerBtn.dataset.wmPlayer);
              if (pl) {
                SoundFX.play('tap');
                showToast(`${pl.tribeName} · Signalfeuer St. ${pl.bonfireLevel} · Macht ${pl.power} · Grid [${pl.tileX}, ${pl.tileY}]`, 'info');
              }
              return;
            }
            const nodeBtn = e.target.closest('[data-wm-node]');
            if (nodeBtn) {
              SoundFX.play('tap');
              openWorldNodeSheet(nodeBtn.dataset.wmNode);
              return;
            }
            const dinoBtn = e.target.closest('[data-wm-dino]');
            if (dinoBtn) {
              SoundFX.play('tap');
              openWorldDinoSheet(dinoBtn.dataset.wmDino);
            }
          });

          document.getElementById('btnWmCenterHome').addEventListener('click', () => {
            SoundFX.play('tap');
            const home = getHomePos();
            centerWorldMapOn(home.xPct, home.yPct, { minZoom: WORLD_CAM_DEFAULT_ZOOM, animate: true });
          });

          const btnWmZoomIn = document.getElementById('btnWmZoomIn');
          if (btnWmZoomIn) {
            btnWmZoomIn.addEventListener('click', () => {
              SoundFX.play('tap');
              zoomWorldMapAt(1.65, undefined, undefined, true);
            });
          }

          const btnWmZoomOut = document.getElementById('btnWmZoomOut');
          if (btnWmZoomOut) {
            btnWmZoomOut.addEventListener('click', () => {
              SoundFX.play('tap');
              zoomWorldMapAt(1 / 1.65, undefined, undefined, true);
            });
          }

          const btnWmZoomFit = document.getElementById('btnWmZoomFit');
          if (btnWmZoomFit) {
            btnWmZoomFit.addEventListener('click', () => {
              SoundFX.play('tap');
              const { vw, vh } = getWorldViewportSize();
              const fitZoom = getWorldMinZoom(vw, vh);
              if (Math.abs(worldCam.zoom - fitZoom) < 0.08) {
                const home = getHomePos();
                setWorldCameraTarget(home.wx, home.wy, WORLD_CAM_DEFAULT_ZOOM, true);
              } else {
                setWorldCameraTarget(WORLD_GRID_COLS / 2, WORLD_GRID_ROWS / 2, fitZoom, true);
              }
            });
          }

          document.getElementById('btnWmTeleportMode').addEventListener('click', () => {
            if (teleportGhost.active) {
              SoundFX.play('tap');
              exitTeleportGhostMode();
            } else {
              enterTeleportGhostMode();
            }
          });

          document.getElementById('btnWmTpCancel').addEventListener('click', () => {
            SoundFX.play('tap');
            exitTeleportGhostMode();
          });

          document.getElementById('btnWmTpConfirm').addEventListener('click', confirmTeleportGhost);

          document.getElementById('wmMinimap').addEventListener('click', (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            SoundFX.play('tap');
            centerWorldMapOn(rx * 100, ry * 100, { animate: true });
          });

          document.getElementById('wmMarchBar').addEventListener('click', (e) => {
            const openBattleBtn = e.target.closest('[data-open-battle]');
            if (openBattleBtn) {
              e.stopPropagation();
              SoundFX.play('tap');
              openBattleReplayModal(openBattleBtn.dataset.openBattle, { animate: true });
              return;
            }
            const recallBtn = e.target.closest('[data-wm-recall]');
            if (recallBtn) {
              e.stopPropagation();
              recallWorldMarch(recallBtn.dataset.wmRecall);
              return;
            }
            const focusCard = e.target.closest('[data-wm-focus-node]');
            if (focusCard) {
              const nodeId = focusCard.dataset.wmFocusNode;
              const pos = getNodePos(nodeId);
              if (pos) {
                SoundFX.play('tap');
                centerWorldMapOn(pos.xPct, pos.yPct);
                openWorldNodeSheet(nodeId);
              }
              return;
            }
            const focusVolcano = e.target.closest('[data-wm-focus-volcano]');
            if (focusVolcano) {
              SoundFX.play('tap');
              centerWorldMapOn(VOLCANO_POS.xPct, VOLCANO_POS.yPct);
              openVolcanoSheet();
              return;
            }
            const focusDino = e.target.closest('[data-wm-focus-dino]');
            if (focusDino) {
              const dinoId = focusDino.dataset.wmFocusDino;
              const pos = getDinoPos(dinoId);
              if (pos) {
                SoundFX.play('tap');
                centerWorldMapOn(pos.xPct, pos.yPct);
                openWorldDinoSheet(dinoId);
              }
            }
          });

          // Helden-Tab Klicks
          document.getElementById('heroesContainer').addEventListener('click', (e) => {
            const openBattleBtn = e.target.closest('[data-open-battle]');
            if (openBattleBtn) {
              SoundFX.play('tap');
              openBattleReplayModal(openBattleBtn.dataset.openBattle, { animate: true });
              return;
            }
            const openBattleInstantBtn = e.target.closest('[data-open-battle-instant]');
            if (openBattleInstantBtn) {
              SoundFX.play('tap');
              openBattleReplayModal(openBattleInstantBtn.dataset.openBattleInstant, { animate: false });
              return;
            }
            const battleFilterBtn = e.target.closest('[data-battle-filter]');
            if (battleFilterBtn) {
              SoundFX.play('tap');
              battleLogFilter = battleFilterBtn.dataset.battleFilter;
              renderHeroesTab();
              return;
            }
            const markReadBtn = e.target.closest('[data-mark-battles-read]');
            if (markReadBtn) {
              SoundFX.play('tap');
              markAllBattlesRead();
              return;
            }
            const gotoWmDino = e.target.closest('[data-goto-world-dino]');
            if (gotoWmDino) {
              const dinoId = gotoWmDino.dataset.gotoWorldDino;
              const pos = getDinoPos(dinoId);
              SoundFX.play('tap');
              switchTab('worldmap');
              if (pos) {
                centerWorldMapOn(pos.xPct, pos.yPct);
                openWorldDinoSheet(dinoId);
              }
              return;
            }
            const gotoWm = e.target.closest('[data-goto-worldmap]');
            if (gotoWm) {
              SoundFX.play('tap');
              switchTab('worldmap');
              return;
            }
            const chestBtn = e.target.closest('[data-open-gear-chest]');
            if (chestBtn) {
              openGearChest(chestBtn.dataset.openGearChest === 'all');
              return;
            }
            const dismissDrop = e.target.closest('[data-dismiss-gear-drop]');
            if (dismissDrop) {
              SoundFX.play('tap');
              lastGearDrops = [];
              renderHeroesTab();
              return;
            }
            const subTabBtn = e.target.closest('[data-hero-subtab]');
            if (subTabBtn) {
              SoundFX.play('tap');
              heroSubTab = subTabBtn.dataset.heroSubtab;
              renderHeroesTab();
              return;
            }
            const openHeroSkills = e.target.closest('[data-hero-open-skills]');
            if (openHeroSkills) {
              SoundFX.play('tap');
              selectedGearHeroId = openHeroSkills.dataset.heroOpenSkills;
              heroSubTab = 'skills';
              renderHeroesTab();
              return;
            }
            const upgradeSkillBtn = e.target.closest('[data-upgrade-skill]');
            if (upgradeSkillBtn) {
              const [hId, branch, idxStr] = upgradeSkillBtn.dataset.upgradeSkill.split('|');
              upgradeHeroSkill(hId, branch, Number(idxStr));
              return;
            }
            const gotoWilderness = e.target.closest('[data-goto-wilderness]');
            if (gotoWilderness) {
              SoundFX.play('tap');
              switchTab('wilderness');
              return;
            }
            const openHeroGear = e.target.closest('[data-hero-open-gear]');
            if (openHeroGear) {
              SoundFX.play('tap');
              selectedGearHeroId = openHeroGear.dataset.heroOpenGear;
              heroSubTab = 'gear';
              renderHeroesTab();
              return;
            }
            const selectGearHero = e.target.closest('[data-gear-select-hero]');
            if (selectGearHero) {
              SoundFX.play('tap');
              selectedGearHeroId = selectGearHero.dataset.gearSelectHero;
              renderHeroesTab();
              return;
            }
            const equipBtn = e.target.closest('[data-gear-equip]');
            if (equipBtn) {
              const [hId, itemId] = equipBtn.dataset.gearEquip.split('|');
              equipGearItem(hId, itemId);
              return;
            }
            const unequipBtn = e.target.closest('[data-gear-unequip]');
            if (unequipBtn) {
              const [hId, slotKey] = unequipBtn.dataset.gearUnequip.split('|');
              unequipGearItem(hId, slotKey);
              return;
            }
            const dismantleBtn = e.target.closest('[data-gear-dismantle]');
            if (dismantleBtn) {
              dismantleGearItem(dismantleBtn.dataset.gearDismantle);
              return;
            }
            const toggleAllBtn = e.target.closest('[data-gear-toggle-all]');
            if (toggleAllBtn) {
              SoundFX.play('tap');
              gearBagShowAll = !gearBagShowAll;
              renderHeroesTab();
              return;
            }
            const filterBtn = e.target.closest('[data-hero-filter]');
            if (filterBtn) {
              SoundFX.play('tap');
              heroFilter = filterBtn.dataset.heroFilter;
              renderHeroesTab();
              return;
            }
            const lvlBtn = e.target.closest('[data-hero-levelup]');
            if (lvlBtn) {
              levelUpHero(lvlBtn.dataset.heroLevelup);
              return;
            }
            const ascBtn = e.target.closest('[data-hero-ascend]');
            if (ascBtn) {
              ascendHero(ascBtn.dataset.heroAscend);
              return;
            }
            const caveBtn = e.target.closest('[data-goto-cave]');
            if (caveBtn) {
              SoundFX.play('tap');
              switchTab('village');
              openBuildingSheet('hero_cave', 'summon');
            }
          });

          // Inventar-Tab Klicks
          document.getElementById('inventoryContainer').addEventListener('click', (e) => {
            const gotoGear = e.target.closest('[data-goto-gear]');
            if (gotoGear) {
              SoundFX.play('tap');
              heroSubTab = 'gear';
              switchTab('heroes');
              return;
            }
            const filterBtn = e.target.closest('[data-inv-filter]');
            if (filterBtn) {
              SoundFX.play('tap');
              invFilter = filterBtn.dataset.invFilter;
              renderInventoryTab();
              return;
            }
            const useAllBtn = e.target.closest('[data-inv-use-all]');
            if (useAllBtn) {
              useInventoryItem(useAllBtn.dataset.invUseAll, true);
              return;
            }
            const useBtn = e.target.closest('[data-inv-use]');
            if (useBtn) {
              useInventoryItem(useBtn.dataset.invUse, false);
            }
          });

          // Wildnis-Tab Klicks (Expeditionen & Dino-Bestiarium)
          document.getElementById('wildernessContainer').addEventListener('click', (e) => {
            const subTabBtn = e.target.closest('[data-wild-subtab]');
            if (subTabBtn) {
              SoundFX.play('tap');
              wildernessSubTab = subTabBtn.dataset.wildSubtab;
              renderWildernessTab();
              return;
            }
            const bestFilterBtn = e.target.closest('[data-bestiary-filter]');
            if (bestFilterBtn) {
              SoundFX.play('tap');
              bestiaryFilter = bestFilterBtn.dataset.bestiaryFilter;
              renderWildernessTab();
              return;
            }
            const gotoWmDino = e.target.closest('[data-goto-world-dino]');
            if (gotoWmDino) {
              const dinoId = gotoWmDino.dataset.gotoWorldDino;
              const pos = getDinoPos(dinoId);
              SoundFX.play('tap');
              switchTab('worldmap');
              if (pos) {
                centerWorldMapOn(pos.xPct, pos.yPct);
                openWorldDinoSheet(dinoId);
              }
              return;
            }
            const gotoWm = e.target.closest('[data-goto-worldmap]');
            if (gotoWm) {
              SoundFX.play('tap');
              switchTab('worldmap');
              return;
            }
            const collectBtn = e.target.closest('[data-collect-exp]');
            if (collectBtn) {
              collectExpedition(collectBtn.dataset.collectExp);
              return;
            }
            const sendBtn = e.target.closest('[data-send-exp]');
            if (sendBtn) {
              launchExpedition(sendBtn.dataset.sendExp);
              return;
            }
            const jump = e.target.closest('[data-jump-building]');
            if (jump) {
              const targetId = jump.dataset.jumpBuilding;
              if (!BuildingRegistry.isVisibleInUI(targetId, state)) {
                openBuildingSheet(targetId, 'building');
                return;
              }
              switchTab('village');
              openBuildingSheet(targetId, 'building');
            }
          });

          // Detail-Sheet Schließen & Aktionen
          document.getElementById('btnCloseSheet').addEventListener('click', closeSheet);
          document.getElementById('detailBackdrop').addEventListener('click', (e) => {
            if (e.target.id === 'detailBackdrop') closeSheet();
          });

          document.getElementById('sheetBody').addEventListener('click', (e) => {
            const huntHeroBtn = e.target.closest('[data-hunt-toggle-hero]');
            if (huntHeroBtn) {
              toggleHuntDraftHero(huntHeroBtn.dataset.huntToggleHero);
              return;
            }
            const huntDeltaBtn = e.target.closest('[data-hunt-troop-delta]');
            if (huntDeltaBtn) {
              const [tKey, dStr] = huntDeltaBtn.dataset.huntTroopDelta.split('|');
              adjustHuntDraftTroop(tKey, Number(dStr));
              return;
            }
            const huntMaxBtn = e.target.closest('[data-hunt-troop-max]');
            if (huntMaxBtn) {
              setHuntDraftTroopMax(huntMaxBtn.dataset.huntTroopMax);
              return;
            }
            const huntFillBtn = e.target.closest('[data-hunt-fill-all]');
            if (huntFillBtn) {
              fillHuntDraftAllTroops();
              return;
            }
            const huntClearBtn = e.target.closest('[data-hunt-clear]');
            if (huntClearBtn) {
              clearHuntDraftTroops();
              return;
            }
            const huntLaunchBtn = e.target.closest('[data-hunt-launch]');
            if (huntLaunchBtn) {
              launchDinoHunt(huntLaunchBtn.dataset.huntLaunch);
              return;
            }
            const gotoBestiaryBtn = e.target.closest('[data-goto-bestiary]');
            if (gotoBestiaryBtn) {
              SoundFX.play('tap');
              closeSheet();
              wildernessSubTab = 'bestiary';
              switchTab('wilderness');
              return;
            }
            const startTpBtn = e.target.closest('[data-start-teleport]');
            if (startTpBtn) {
              closeSheet();
              if (activeTab !== 'worldmap') switchTab('worldmap');
              enterTeleportGhostMode();
              return;
            }
            const enterVillageBtn = e.target.closest('[data-enter-village]');
            if (enterVillageBtn) {
              closeSheet();
              switchTab('village');
              return;
            }
            const gatherHeroBtn = e.target.closest('[data-gather-toggle-hero]');
            if (gatherHeroBtn) {
              toggleGatherDraftHero(gatherHeroBtn.dataset.gatherToggleHero);
              return;
            }
            const gatherDeltaBtn = e.target.closest('[data-gather-troop-delta]');
            if (gatherDeltaBtn) {
              const [tKey, dStr] = gatherDeltaBtn.dataset.gatherTroopDelta.split('|');
              adjustGatherDraftTroop(tKey, Number(dStr));
              return;
            }
            const gatherMaxBtn = e.target.closest('[data-gather-troop-max]');
            if (gatherMaxBtn) {
              setGatherDraftTroopMax(gatherMaxBtn.dataset.gatherTroopMax);
              return;
            }
            const gatherFillBtn = e.target.closest('[data-gather-fill-all]');
            if (gatherFillBtn) {
              fillGatherDraftAllTroops();
              return;
            }
            const gatherClearBtn = e.target.closest('[data-gather-clear]');
            if (gatherClearBtn) {
              clearGatherDraftTroops();
              return;
            }
            const wmSendBtn = e.target.closest('[data-wm-send]');
            if (wmSendBtn) {
              launchWorldMarch(wmSendBtn.dataset.wmSend);
              return;
            }
            const volHeroBtn = e.target.closest('[data-volcano-toggle-hero]');
            if (volHeroBtn) {
              toggleVolcanoDraftHero(volHeroBtn.dataset.volcanoToggleHero);
              return;
            }
            const volTroopDeltaBtn = e.target.closest('[data-volcano-troop-delta]');
            if (volTroopDeltaBtn) {
              const [tKey, dStr] = volTroopDeltaBtn.dataset.volcanoTroopDelta.split('|');
              adjustVolcanoDraftTroop(tKey, Number(dStr));
              return;
            }
            const volTroopMaxBtn = e.target.closest('[data-volcano-troop-max]');
            if (volTroopMaxBtn) {
              setVolcanoDraftTroopMax(volTroopMaxBtn.dataset.volcanoTroopMax);
              return;
            }
            const volFillBtn = e.target.closest('[data-volcano-fill-all]');
            if (volFillBtn) {
              fillVolcanoDraftAllTroops();
              return;
            }
            const volClearBtn = e.target.closest('[data-volcano-clear]');
            if (volClearBtn) {
              clearVolcanoDraftTroops();
              return;
            }
            const volLaunchBtn = e.target.closest('[data-volcano-launch]');
            if (volLaunchBtn) {
              launchVolcanoMarch();
              return;
            }
            const wmRecallBtn = e.target.closest('[data-wm-recall]');
            if (wmRecallBtn) {
              recallWorldMarch(wmRecallBtn.dataset.wmRecall);
              return;
            }
            const wsTabBtn = e.target.closest('[data-workshop-tab]');
            if (wsTabBtn && openSheet && openSheet.type === 'building' && openSheet.id === 'workshop') {
              SoundFX.play('tap');
              openSheet.subTab = wsTabBtn.dataset.workshopTab;
              renderSheet();
              return;
            }
            const caveTabBtn = e.target.closest('[data-cave-tab]');
            if (caveTabBtn && openSheet && openSheet.type === 'building' && openSheet.id === 'hero_cave') {
              SoundFX.play('tap');
              openSheet.subTab = caveTabBtn.dataset.caveTab;
              renderSheet();
              return;
            }
            const barracksTabBtn = e.target.closest('[data-barracks-tab]');
            if (barracksTabBtn && openSheet && openSheet.type === 'building') {
              SoundFX.play('tap');
              openSheet.subTab = barracksTabBtn.dataset.barracksTab;
              renderSheet();
              return;
            }
            const infTabBtn = e.target.closest('[data-infirmary-tab]');
            if (infTabBtn && openSheet && openSheet.type === 'building' && openSheet.id === 'infirmary') {
              SoundFX.play('tap');
              openSheet.subTab = infTabBtn.dataset.infirmaryTab;
              renderSheet();
              return;
            }
            const gyTabBtn = e.target.closest('[data-graveyard-tab]');
            if (gyTabBtn && openSheet && openSheet.type === 'building' && openSheet.id === 'graveyard') {
              SoundFX.play('tap');
              openSheet.subTab = gyTabBtn.dataset.graveyardTab;
              renderSheet();
              return;
            }
            const mktTabBtn = e.target.closest('[data-marketplace-tab]');
            if (mktTabBtn && openSheet && openSheet.type === 'building' && openSheet.id === 'marketplace') {
              SoundFX.play('tap');
              openSheet.subTab = mktTabBtn.dataset.marketplaceTab;
              renderSheet();
              return;
            }
            const whTabBtn = e.target.closest('[data-warehouse-tab]');
            if (whTabBtn && openSheet && openSheet.type === 'building' && openSheet.id === 'warehouse') {
              SoundFX.play('tap');
              openSheet.subTab = whTabBtn.dataset.warehouseTab;
              renderSheet();
              return;
            }
            const startHealBtn = e.target.closest('[data-start-heal]');
            if (startHealBtn) {
              startTroopHealing();
              return;
            }
            const freeHealBtn = e.target.closest('[data-free-heal]');
            if (freeHealBtn) {
              tryFreeFinishHealing();
              return;
            }
            const reviveFallenBtn = e.target.closest('[data-revive-fallen]');
            if (reviveFallenBtn) {
              reviveFallenTroops('auto');
              return;
            }
            const openTotemRitualBtn = e.target.closest('[data-open-totem-ritual]');
            if (openTotemRitualBtn) {
              SoundFX.play('tap');
              openShamanTotemSheet();
              return;
            }
            const totemDeltaBtn = e.target.closest('[data-totem-delta]');
            if (totemDeltaBtn) {
              const [tk, dStr] = totemDeltaBtn.dataset.totemDelta.split('|');
              SoundFX.play('tap');
              ShamanTotemSystem.adjustDraft(tk, Number(dStr || 0));
              renderSheet();
              return;
            }
            const totemMaxBtn = e.target.closest('[data-totem-max]');
            if (totemMaxBtn) {
              SoundFX.play('tap');
              ShamanTotemSystem.setDraftMax(totemMaxBtn.dataset.totemMax);
              renderSheet();
              return;
            }
            const totemAutoBtn = e.target.closest('[data-totem-auto]');
            if (totemAutoBtn) {
              SoundFX.play('tap');
              ShamanTotemSystem.initDraft(state);
              renderSheet();
              return;
            }
            const totemClearBtn = e.target.closest('[data-totem-clear]');
            if (totemClearBtn) {
              SoundFX.play('tap');
              ShamanTotemSystem.clearDraft();
              renderSheet();
              return;
            }
            const totemCastCustomBtn = e.target.closest('[data-totem-cast-custom]');
            if (totemCastCustomBtn) {
              ShamanTotemSystem.executeRevival({ mode: 'custom', selection: ShamanTotemSystem.getDraft() });
              return;
            }
            const totemCastAllBtn = e.target.closest('[data-totem-cast-all]');
            if (totemCastAllBtn) {
              ShamanTotemSystem.executeRevival({ mode: 'all' });
              return;
            }
            const claimMarketBtn = e.target.closest('[data-claim-market-stamina]');
            if (claimMarketBtn) {
              claimMarketStamina();
              return;
            }
            const freeBoneBtn = e.target.closest('[data-claim-free-bone]');
            if (freeBoneBtn) {
              claimFreeCaveBone();
              return;
            }
            const summonBtn = e.target.closest('[data-summon-banner]');
            if (summonBtn) {
              summonFromHeroCave(summonBtn.dataset.summonBanner, Number(summonBtn.dataset.summonCount || 1));
              return;
            }
            const clearSummonBtn = e.target.closest('[data-clear-summon]');
            if (clearSummonBtn) {
              lastSummonResults = [];
              renderSheet();
              return;
            }
            const trainBtn = e.target.closest('[data-train-troop]');
            if (trainBtn) {
              startTroopTraining(trainBtn.dataset.trainTroop);
              return;
            }
            const backTreeBtn = e.target.closest('[data-back-research-tree]');
            if (backTreeBtn) {
              SoundFX.play('tap');
              openBuildingSheet('workshop', 'tree');
              return;
            }
            const techCard = e.target.closest('[data-tech]');
            if (techCard) {
              SoundFX.play('tap');
              openResearchSheet(techCard.dataset.tech);
              return;
            }
            const modeBtn = e.target.closest('[data-set-fire-mode]');
            if (modeBtn) {
              setFireMode(modeBtn.dataset.setFireMode);
              return;
            }
            const workerBtn = e.target.closest('[data-worker-id]');
            if (workerBtn) {
              adjustWorker(workerBtn.dataset.workerId, Number(workerBtn.dataset.workerDelta));
              return;
            }
            const upBtn = e.target.closest('[data-upgrade-building]');
            if (upBtn) {
              startUpgrade(upBtn.dataset.upgradeBuilding);
              return;
            }
            const techBtn = e.target.closest('[data-start-tech]');
            if (techBtn) {
              startResearch(techBtn.dataset.startTech);
              return;
            }
            const jumpBtn = e.target.closest('[data-jump-building]');
            if (jumpBtn) {
              const targetId = jumpBtn.dataset.jumpBuilding;
              const subTab = jumpBtn.dataset.jumpSubtab || 'building';
              if (!BuildingRegistry.isVisibleInUI(targetId, state)) {
                openBuildingSheet(targetId, subTab);
                return;
              }
              SoundFX.play('tap');
              if (activeTab !== 'village') switchTab('village');
              if (window.Village3D) window.Village3D.centerOn(targetId);
              openBuildingSheet(targetId, subTab);
              return;
            }
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
              const act = actionBtn.dataset.action;
              if (act === 'free-build') tryFreeFinishBuild();
              else if (act === 'free-research') tryFreeFinishResearch();
            }
          });

          // Center Modal Events
          document.getElementById('centerModalBackdrop').addEventListener('click', async (e) => {
            if (e.target.id === 'centerModalBackdrop' || e.target.id === 'btnCloseCenterModal' || e.target.id === 'btnCancelReset') {
              closeCenterModal();
              return;
            }
            if (e.target.id === 'btnMpSaveTribeName') {
              const inp = document.getElementById('mpTribeNameInput');
              if (inp && window.DinoMultiplayer) {
                const updated = window.DinoMultiplayer.setTribeName(inp.value);
                SoundFX.play('tap');
                showToast(`Stammesname geändert zu „${updated}“.`, 'ok');
                renderWorldMap();
              }
              return;
            }
            if (e.target.id === 'btnMpGoogleSignIn') {
              if (!window.DinoMultiplayer) return;
              SoundFX.play('tap');
              const res = await window.DinoMultiplayer.signInWithGoogle();
              if (res.ok) {
                showToast('Google-Konto verknüpft! Spielstand wird in der Cloud gesichert.', 'ok');
                openSettingsModal();
              } else {
                showToast('Anmeldung abgebrochen oder fehlgeschlagen.', 'warn');
              }
              return;
            }
            if (e.target.id === 'btnMpForceCloudSave') {
              if (window.DinoMultiplayer) {
                window.DinoMultiplayer.saveToCloud(state, true);
                SoundFX.play('tap');
                showToast('Spielstand wurde in Cloud Firestore gesichert.', 'ok');
              }
              return;
            }
            if (e.target.id === 'btnMpSignOut') {
              if (window.DinoMultiplayer) {
                await window.DinoMultiplayer.signOut();
                SoundFX.play('tap');
                showToast('Abgemeldet. Du spielst im Gast-Modus weiter.', 'info');
                openSettingsModal();
              }
              return;
            }
            if (e.target.id === 'btnToggleSound') {
              state.soundEnabled = !state.soundEnabled;
              SoundFX.enabled = state.soundEnabled;
              saveState();
              openSettingsModal();
              return;
            }
            if (e.target.id === 'btnShowTitle') {
              closeCenterModal();
              document.getElementById('titleScreen').classList.remove('hidden');
              return;
            }
            if (e.target.id === 'btnConfirmResetAsk') {
              openResetConfirmModal();
              return;
            }
            if (e.target.id === 'btnExecuteReset') {
              localStorage.removeItem(STORAGE_KEY);
              state = createInitialState();
              state.started = true;
              worldCam.initialized = false;
              saveState();
              closeCenterModal();
              closeBattleModal();
              closeSheet();
              switchTab('village');
              showToast('Neuer Stamm am Großen Signalfeuer gegründet.', 'ok');
            }
          });

          // Live-Gefecht Banner Events
          document.getElementById('battleAlertBanner').addEventListener('click', (e) => {
            const openBtn = e.target.closest('[data-open-battle]');
            if (openBtn) {
              SoundFX.play('tap');
              openBattleReplayModal(openBtn.dataset.openBattle, { animate: true });
              return;
            }
            if (e.target.closest('[data-dismiss-battle-banner]')) {
              SoundFX.play('tap');
              hideBattleAlertBanner();
            }
          });

          // Kampf-Animation & Kampf-Log Modal Events
          document.getElementById('battleModalBackdrop').addEventListener('click', (e) => {
            if (e.target.id === 'battleModalBackdrop' || e.target.closest('[data-battle-close]')) {
              SoundFX.play('tap');
              closeBattleModal();
              return;
            }
            const speedBtn = e.target.closest('[data-battle-speed]');
            if (speedBtn) {
              SoundFX.play('tap');
              battleAnimState.speed = battleAnimState.speed === 1 ? 2 : 1;
              speedBtn.textContent = `${battleAnimState.speed}×`;
              return;
            }
            if (e.target.closest('[data-battle-skip]')) {
              const battle = getBattleLogById(battleAnimState.battleId);
              if (battle) {
                SoundFX.play('tap');
                finishBattlePresentation(battle, false);
              }
              return;
            }
            const replayBtn = e.target.closest('[data-battle-replay]');
            if (replayBtn) {
              SoundFX.play('tap');
              openBattleReplayModal(replayBtn.dataset.battleReplay, { animate: true });
              return;
            }
            if (e.target.closest('[data-battle-goto-log]')) {
              SoundFX.play('tap');
              closeBattleModal();
              heroSubTab = 'battles';
              switchTab('heroes');
            }
          });

          // Welt-Chat Events
          const chatFab = document.getElementById('btnWorldChatFab');
          if (chatFab) {
            chatFab.addEventListener('click', () => {
              SoundFX.play('tap');
              toggleWorldChatDrawer();
            });
          }
          const chatClose = document.getElementById('btnCloseWorldChat');
          if (chatClose) {
            chatClose.addEventListener('click', () => {
              SoundFX.play('tap');
              toggleWorldChatDrawer(false);
            });
          }
          const chatForm = document.getElementById('mpChatForm');
          if (chatForm) {
            chatForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              const inp = document.getElementById('mpChatInput');
              if (!inp || !window.DinoMultiplayer) return;
              const text = inp.value.trim();
              if (!text) return;
              inp.value = '';
              const res = await window.DinoMultiplayer.sendChat(text, state.buildings.bonfire.level);
              if (!res.ok) {
                showToast(res.error || 'Nachricht konnte nicht gesendet werden.', 'err');
              }
            });
          }

          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && battleAnimState.active) {
              closeBattleModal();
            } else if (e.key === 'Escape' && mpWorld.chatOpen) {
              toggleWorldChatDrawer(false);
            }
          });

          window.addEventListener('resize', () => {
            resizeCanvas();
            if (activeTab === 'worldmap') applyWorldCamera(worldCam.cx, worldCam.cy, worldCam.zoom);
          });
          window.addEventListener('beforeunload', saveState);
        }

        function bootstrapMultiplayer() {
          if (!window.DinoMultiplayer) return;
          window.DinoMultiplayer.init({
            onSessionChange: (session) => {
              mpWorld.session = session;
              mpWorld.onlinePlayers = session.onlinePlayers || 1;
              renderWorldChatUI();
            },
            onWorldUpdate: ({ settlements, marches, nodeOccupants, dynamicSpawns, volcano, onlinePlayers }) => {
              mpWorld.settlements = settlements || [];
              mpWorld.marches = marches || [];
              mpWorld.nodeOccupants = nodeOccupants || [];
              mpWorld.dynamicSpawns = dynamicSpawns || [];
              if (volcano) {
                mpWorld.volcano = volcano;
              }
              mpWorld.onlinePlayers = onlinePlayers || 1;
              applyRemoteDynamicSpawns(mpWorld.dynamicSpawns);
              if (activeTab === 'worldmap') {
                renderWorldMap();
              }
              if (openSheet && openSheet.type === 'worldNode') {
                renderWorldNodeSheet(openSheet.id);
              } else if (openSheet && openSheet.type === 'volcano') {
                renderVolcanoSheet();
              }
              renderWorldChatUI();
            },
            onNodeContest: (contest, myUid) => {
              try {
                if (!contest || !myUid) return;
                if (contest.defenderUid !== myUid) return;
                const march = (state.worldMarches || []).find(
                  (m) => (m.kind || 'gather') === 'gather' && m.nodeId === contest.nodeId && (m.phase === 'gathering' || m.phase === 'occupying')
                );
                const info = getWorldNodeInfo(contest.nodeId);
                const nodeName = (march && march.targetName) || (info ? info.name : 'Sammelstelle');
                const resKey = (march && march.targetResource) || (info ? info.resource : 'wood');
                const cas = march ? applyPvpCasualtiesToMarch(march, contest.defenderLossRate || 0) : { lostTotal: 0, injuredTotal: 0, fallenTotal: 0 };
                const casNote = formatCasualtyNote(cas);

                if (contest.attackerWon) {
                  if (march) {
                    const now = Date.now();
                    const kept = Math.max(0, Number(contest.defenderCollectedBeforeEviction || 0));
                    const nState = getWorldNodeState(contest.nodeId);
                    if (nState && kept > 0) {
                      nState.remaining = Math.max(0, nState.remaining - kept);
                    }
                    march.carriedAmount = kept;
                    march.phase = 'marching_back';
                    march.startedAt = now;
                    march.phaseEndsAt = now + march.travelSec * 1000;
                  }
                  SoundFX.play('error');
                  showToast(
                    `⚔ Überfall auf „${nodeName}“! ${contest.attackerTribeName} hat deinen Trupp vertrieben${
                      march && march.carriedAmount > 0 ? ` (Rückzug mit ${march.carriedAmount} ${RESOURCE_LABELS[resKey]})` : ''
                    }.${casNote}`,
                    'err'
                  );
                } else {
                  SoundFX.play('complete');
                  showToast(
                    `🛡 Sammelstelle „${nodeName}“ gegen ${contest.attackerTribeName} erfolgreich verteidigt!${casNote}`,
                    'ok'
                  );
                }
                saveState();
                renderAll();
              } catch {
                // ignore non-fatal pvp event sync error
              }
            },
            onChatUpdate: (messages) => {
              const prevLen = mpWorld.chat.length;
              mpWorld.chat = messages || [];
              const newest = mpWorld.chat.length > 0 ? mpWorld.chat[mpWorld.chat.length - 1] : null;
              if (!mpWorld.chatOpen && newest && newest.messageId !== mpWorld.lastSeenChatId && prevLen > 0) {
                mpWorld.unreadChat += 1;
              }
              if (mpWorld.chatOpen && newest) {
                mpWorld.lastSeenChatId = newest.messageId;
              }
              renderWorldChatUI();
            },
            onTradeCompleted: (trade, myUid) => {
              try {
                if (!trade || trade.status !== 'completed' || !trade.fromConfirmed || !trade.toConfirmed) return;
                const validKeys = ['meat', 'wood', 'stone', 'fur'];
                const isSender = trade.fromUid === myUid;
                const isRecipient = trade.toUid === myUid;
                if (!isSender && !isRecipient) return;
                const giveRes = isSender ? trade.offerResource : trade.requestResource;
                const giveAmt = Math.max(1, Math.floor(Number(isSender ? trade.offerAmount : trade.requestAmount) || 0));
                const getRes = isSender ? trade.requestResource : trade.offerResource;
                const getAmt = Math.max(1, Math.floor(Number(isSender ? trade.requestAmount : trade.offerAmount) || 0));
                if (!validKeys.includes(giveRes) || !validKeys.includes(getRes) || giveRes === getRes) return;

                state.resources[giveRes] = Math.max(0, Number(state.resources[giveRes] || 0) - giveAmt);
                state.resources[getRes] = Number(state.resources[getRes] || 0) + getAmt;

                if (typeof SoundFX !== 'undefined' && typeof SoundFX.play === 'function') {
                  SoundFX.play('upgrade');
                }
                if (typeof saveState === 'function') saveState();
                if (typeof renderAll === 'function') renderAll();
                if (typeof emitSnapshot === 'function') emitSnapshot();

                const partnerName = isSender ? trade.toTribeName : trade.fromTribeName;
                const partnerUid = isSender ? trade.toUid : trade.fromUid;
                const giveLabel = RESOURCE_LABELS[giveRes] || giveRes;
                const getLabel = RESOURCE_LABELS[getRes] || getRes;
                if (typeof showToast === 'function') {
                  showToast(
                    `Handel mit ${partnerName} beidseitig bestätigt: -${giveAmt} ${giveLabel} → +${getAmt} ${getLabel}`,
                    'ok'
                  );
                }

                const partnerSettlement = (mpWorld.settlements || []).find((s) => s.uid === partnerUid);
                if (partnerSettlement && typeof broadcastNeighborCaravan === 'function') {
                  broadcastNeighborCaravan(partnerSettlement, `Handel: ${partnerName}`);
                }
                if (isSender && window.DinoMultiplayer) {
                  void window.DinoMultiplayer.sendChat(
                    `🤝 Handel mit ${partnerName} beidseitig bestätigt: ${giveAmt} ${giveLabel} ↔ ${getAmt} ${getLabel}.`,
                    state?.buildings?.bonfire?.level || 1
                  ).catch(() => {});
                }
              } catch {
                // ignore non-fatal trade settlement error
              }
            },
            onCloudStateLoaded: (cloudState, tribeName) => {
              if (cloudState && typeof cloudState === 'object' && cloudState.buildings) {
                try {
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudState));
                  const merged = loadState();
                  if (merged) {
                    state = merged;
                    renderAll();
                    showToast(`Cloud-Spielstand für „${tribeName}“ geladen!`, 'ok');
                  }
                } catch {
                  // ignore
                }
              }
            },
            getCurrentLocalState: () => state,
            getCurrentSettlementMeta: () => ({
              bonfireLevel: state.buildings.bonfire.level,
              power: computeVillagePowerMp(),
              tileX: state.homeTile.x,
              tileY: state.homeTile.y
            })
          });

          // Alle 25 Sekunden Siedlungsstatus (Stufe/Macht/Position) auf gemeinsamer Weltkarte synchronisieren
          setInterval(() => {
            if (!window.DinoMultiplayer) return;
            window.DinoMultiplayer.syncSettlement({
              bonfireLevel: state.buildings.bonfire.level,
              power: computeVillagePowerMp(),
              tileX: state.homeTile.x,
              tileY: state.homeTile.y,
              autoAssignIfOccupied: true
            });
          }, 25000);
        }

        function bootstrapVillage3D() {
          const mount = document.getElementById('village3dMount');
          const nodes = document.getElementById('mapNodes');
          if (!mount || !nodes || !window.Village3D) return;
          window.Village3D.init(mount, nodes, {
            onSelectBuilding: (id) => {
              SoundFX.play('tap');
              openBuildingSheet(id);
            }
          });
          window.Village3D.setVisible(activeTab === 'village');
          renderVillageMap();
        }

        function bootstrapWorldMap3D() {
          const mount = document.getElementById('worldMap3dMount');
          if (!mount || !window.WorldMap3D) return;
          const ok = window.WorldMap3D.init(mount);
          if (!ok) return;
          window.WorldMap3D.setVisible(activeTab === 'worldmap');
          syncWorldMap3DEntities();
          if (activeTab === 'worldmap') {
            renderWorldMap();
          }
        }

        function init() {
          const loaded = loadState();
          let offlineReport = null;
          if (loaded) {
            offlineReport = runOfflineSimulation(loaded);
            const note = document.getElementById('titleSaveNote');
            note.textContent = `Gespeichertes Lager · Signalfeuer Stufe ${state.buildings.bonfire.level} · ${state.pop.total} Bewohner`;
            document.getElementById('btnStartGame').textContent = 'Lager fortsetzen';
          }

          bindEvents();
          bootstrapVillage3D();
          bootstrapWorldMap3D();
          window.addEventListener('village3d-ready', bootstrapVillage3D, { once: true });
          window.addEventListener('worldmap3d-ready', bootstrapWorldMap3D, { once: true });
          // Multiplayer-Bridge direkt oder nach Modul-Ladung initialisieren
          if (window.DinoMultiplayer) {
            bootstrapMultiplayer();
          } else {
            window.addEventListener('load', bootstrapMultiplayer, { once: true });
          }
          resizeCanvas();
          renderAll();
          requestAnimationFrame(animateParticles);

          // 1-Sekunden-Game-Loop
          setInterval(gameTick, 1000);

          if (offlineReport) {
            // Zeige Rückkehr-Bericht direkt sobald der Spieler fortsetzt oder wenn bereits aktiv
            document.getElementById('btnStartGame').addEventListener(
              'click',
              () => {
                setTimeout(() => showOfflineReport(offlineReport), 220);
              },
              { once: true }
            );
          }
        }

        
  // Starte das Spiel im gemounteten React-DOM
  init();

  // Synchronisiere aktuelle Kerndaten (Signalfeuer-Stufe, Macht, Tab, Ressourcen, Glut, Heimat-Kachel) regelmäßig mit React-Komponenten
  const emitSnapshot = () => {
    notifyReact({
      bonfireLevel: state?.buildings?.bonfire?.level || 1,
      power: typeof computeVillagePowerMp === "function" ? computeVillagePowerMp() : 100,
      activeTab: typeof activeTab === "string" ? activeTab : "village",
      started: Boolean(state?.started),
      ember: Math.round(Number(state?.ember || 0)),
      resources: {
        meat: Math.floor(Number(state?.resources?.meat || 0)),
        wood: Math.floor(Number(state?.resources?.wood || 0)),
        stone: Math.floor(Number(state?.resources?.stone || 0)),
        fur: Math.floor(Number(state?.resources?.fur || 0))
      },
      homeTile: {
        x: typeof state?.homeTile?.x === "number" ? state.homeTile.x : DEFAULT_HOME_TILE.x,
        y: typeof state?.homeTile?.y === "number" ? state.homeTile.y : DEFAULT_HOME_TILE.y
      },
      volcanoMobilization:
        typeof getVolcanoMobilizationSnapshot === "function" ? getVolcanoMobilizationSnapshot() : undefined
    });
  };
  emitSnapshot();
  setInterval(emitSnapshot, 1000);

  const broadcastNeighborCaravan = (target, label) => {
    try {
      if (!window.DinoMultiplayer || !target) return;
      const homeX = typeof state?.homeTile?.x === "number" ? state.homeTile.x : DEFAULT_HOME_TILE.x;
      const homeY = typeof state?.homeTile?.y === "number" ? state.homeTile.y : DEFAULT_HOME_TILE.y;
      const fromX = ((homeX + 1) / WORLD_GRID_COLS) * 100;
      const fromY = ((homeY + 1) / WORLD_GRID_ROWS) * 100;
      const toX = ((Number(target.tileX) + 1) / WORLD_GRID_COLS) * 100;
      const toY = ((Number(target.tileY) + 1) / WORLD_GRID_ROWS) * 100;
      const marchId = `ally_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
      void window.DinoMultiplayer.broadcastMarch({
        marchId,
        kind: "gather",
        fromX,
        fromY,
        toX,
        toY,
        targetLabel: label,
        durationMs: 12000
      });
      setTimeout(() => {
        if (window.DinoMultiplayer) {
          void window.DinoMultiplayer.completeMarch(marchId);
        }
      }, 12500);
    } catch {
      // ignore non-fatal multiplayer caravan broadcast error
    }
  };

  runtimeHandle = {
    jumpToWorldTile(tileX, tileY) {
      try {
        if (typeof switchTab === "function") switchTab("worldmap");
        const xPct = ((Number(tileX) + 1) / WORLD_GRID_COLS) * 100;
        const yPct = ((Number(tileY) + 1) / WORLD_GRID_ROWS) * 100;
        if (typeof centerWorldMapOn === "function") {
          setTimeout(() => centerWorldMapOn(xPct, yPct, { minZoom: 6, animate: true }), 60);
        }
      } catch {
        // ignore
      }
    },
    focusVolcano() {
      try {
        if (typeof SoundFX !== "undefined" && typeof SoundFX.play === "function") {
          SoundFX.play("tap");
        }
        if (typeof switchTab === "function") switchTab("worldmap");
        if (typeof centerWorldMapOn === "function") {
          setTimeout(() => centerWorldMapOn(VOLCANO_POS.xPct, VOLCANO_POS.yPct, { minZoom: 6, animate: true }), 60);
        }
      } catch {
        // ignore
      }
    },
    openVolcano() {
      try {
        if (typeof SoundFX !== "undefined" && typeof SoundFX.play === "function") {
          SoundFX.play("tap");
        }
        if (typeof switchTab === "function") switchTab("worldmap");
        if (typeof centerWorldMapOn === "function") {
          setTimeout(() => centerWorldMapOn(VOLCANO_POS.xPct, VOLCANO_POS.yPct, { minZoom: 6, animate: true }), 60);
        }
        if (typeof openVolcanoSheet === "function") {
          setTimeout(() => openVolcanoSheet(), 90);
        }
      } catch {
        // ignore
      }
    },
    adjustVolcanoMobilizationTroop(troopType, delta) {
      try {
        if (typeof getActiveMarchForVolcano === "function" && getActiveMarchForVolcano()) return;
        if (typeof adjustVolcanoDraftTroop === "function") {
          adjustVolcanoDraftTroop(troopType, Number(delta || 0));
        }
      } catch {
        // ignore
      }
    },
    fillAllVolcanoMobilization() {
      try {
        if (typeof getActiveMarchForVolcano === "function" && getActiveMarchForVolcano()) return;
        if (typeof fillVolcanoDraftAllTroops === "function") {
          fillVolcanoDraftAllTroops();
        }
      } catch {
        // ignore
      }
    },
    clearVolcanoMobilization() {
      try {
        if (typeof getActiveMarchForVolcano === "function" && getActiveMarchForVolcano()) return;
        if (typeof clearVolcanoDraftTroops === "function") {
          clearVolcanoDraftTroops();
        }
      } catch {
        // ignore
      }
    },
    visitSettlement(target) {
      try {
        if (!target) return;
        if (typeof SoundFX !== "undefined" && typeof SoundFX.play === "function") {
          SoundFX.play("tap");
        }
        if (typeof switchTab === "function") switchTab("worldmap");
        if (typeof renderWorldMap === "function") renderWorldMap();
        const xPct = ((Number(target.tileX) + 1) / WORLD_GRID_COLS) * 100;
        const yPct = ((Number(target.tileY) + 1) / WORLD_GRID_ROWS) * 100;
        setTimeout(() => {
          if (typeof centerWorldMapOn === "function") {
            centerWorldMapOn(xPct, yPct, { minZoom: 6, animate: true });
          }
          const marker = document.querySelector(
            `.wm-node.other-settlement[data-wm-player="${CSS.escape(String(target.uid || ""))}"]`
          );
          if (marker) {
            marker.classList.remove("is-visited-pulse");
            void marker.offsetWidth;
            marker.classList.add("is-visited-pulse");
            setTimeout(() => marker.classList.remove("is-visited-pulse"), 2600);
          }
          if (typeof showToast === "function") {
            showToast(
              `Besuche ${target.tribeName} · Signalfeuer St. ${target.bonfireLevel} · Macht ${target.power} · Grid [${target.tileX}, ${target.tileY}]`,
              "info"
            );
          }
        }, 70);
      } catch {
        // ignore
      }
    },
    tradeResourcesWithNeighbor(req) {
      try {
        const validKeys = ["meat", "wood", "stone", "fur"];
        if (
          !req ||
          !req.target ||
          !validKeys.includes(req.offerResource) ||
          !validKeys.includes(req.requestResource) ||
          req.offerResource === req.requestResource
        ) {
          return { ok: false, message: "Ungültige Handelsauswahl." };
        }
        const offerAmt = Math.max(1, Math.floor(Number(req.offerAmount || 0)));
        const reqAmt = Math.max(1, Math.floor(Number(req.requestAmount || 0)));
        const currentStock = Math.floor(Number(state?.resources?.[req.offerResource] || 0));
        if (currentStock < offerAmt) {
          return {
            ok: false,
            message: `Zu wenig ${RESOURCE_LABELS[req.offerResource]} (${currentStock}/${offerAmt}).`
          };
        }

        state.resources[req.offerResource] = Math.max(0, state.resources[req.offerResource] - offerAmt);
        state.resources[req.requestResource] = (state.resources[req.requestResource] || 0) + reqAmt;

        if (typeof SoundFX !== "undefined" && typeof SoundFX.play === "function") {
          SoundFX.play("upgrade");
        }
        if (typeof saveState === "function") saveState();
        if (typeof renderAll === "function") renderAll();
        emitSnapshot();

        const offerLabel = RESOURCE_LABELS[req.offerResource] || req.offerResource;
        const reqLabel = RESOURCE_LABELS[req.requestResource] || req.requestResource;
        const msg = `Handel mit ${req.target.tribeName}: -${offerAmt} ${offerLabel} → +${reqAmt} ${reqLabel}`;
        if (typeof showToast === "function") showToast(msg, "ok");

        broadcastNeighborCaravan(req.target, `Handel: ${req.target.tribeName}`);
        if (window.DinoMultiplayer) {
          void window.DinoMultiplayer.sendChat(
            `🤝 Karawane an ${req.target.tribeName}: ${offerAmt} ${offerLabel} gegen ${reqAmt} ${reqLabel} getauscht.`,
            state?.buildings?.bonfire?.level || 1
          ).catch(() => {});
        }
        return { ok: true, message: msg };
      } catch {
        return { ok: false, message: "Handel konnte nicht abgeschlossen werden." };
      }
    },
    supportNeighborBonfire(target) {
      try {
        if (!target) return { ok: false, message: "Kein Zielstamm gewählt." };
        const woodCost = 20;
        const currentWood = Math.floor(Number(state?.resources?.wood || 0));
        if (currentWood < woodCost) {
          return {
            ok: false,
            message: `Benötigt ${woodCost} Holz für Signalfeuer-Unterstützung (vorhanden: ${currentWood}).`
          };
        }

        state.resources.wood = Math.max(0, state.resources.wood - woodCost);
        state.ember = Math.min(100, Number(state.ember || 0) + 8);
        state.morale = Math.min(100, Number(state.morale || 100) + 3);

        if (typeof SoundFX !== "undefined" && typeof SoundFX.play === "function") {
          SoundFX.play("upgrade");
        }
        if (typeof saveState === "function") saveState();
        if (typeof renderAll === "function") renderAll();
        emitSnapshot();

        const msg = `Signalfeuer von ${target.tribeName} mit ${woodCost} Holz unterstützt (+8% eigene Glut, +3 Moral).`;
        if (typeof showToast === "function") showToast(msg, "ok");

        broadcastNeighborCaravan(target, `Feuerhilfe: ${target.tribeName}`);
        if (window.DinoMultiplayer) {
          void window.DinoMultiplayer.sendChat(
            `🔥 Unterstützt das Signalfeuer von ${target.tribeName} mit ${woodCost} Feuerholz!`,
            state?.buildings?.bonfire?.level || 1
          ).catch(() => {});
        }
        return { ok: true, message: msg };
      } catch {
        return { ok: false, message: "Signalfeuer-Unterstützung fehlgeschlagen." };
      }
    },
    getBuildingRegistry() {
      return BuildingRegistry;
    },
    getShamanTotemSystem() {
      return ShamanTotemSystem;
    },
    forceSave() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // ignore
      }
      if (window.DinoMultiplayer) {
        window.DinoMultiplayer.saveToCloud(state, true);
        window.DinoMultiplayer.syncSettlement({
          bonfireLevel: state.buildings.bonfire.level,
          power: computeVillagePowerMp(),
          tileX: state.homeTile.x,
          tileY: state.homeTile.y,
          autoAssignIfOccupied: true
        });
      }
    }
  };
  return runtimeHandle;
}
