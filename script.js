import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { get, onValue, ref, set } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { auth, database } from "./firebase.js?v=20260302r";

const activities = ["Village", "Combat", "Profile"];
const levelCap = 20;
const statPointsPerLevel = 5;
const baseStatValue = 10;
const realMsPerGameDay = 300_000;
const inGameMinutesPerDay = 24 * 60;
const area1CombatDbKey = "theWreckage";
const area1CombatEnemyOrder = [
  { key: "sodierAnt", displayName: "Soldier Ant" },
  { key: "bombardierBeetle", displayName: "Bombardier Beetle" },
  { key: "rubbleScarab", displayName: "Rubble Scarab" },
  { key: "jumpingSpider", displayName: "Jumping Spider" },
  { key: "IroncrustBeetle", displayName: "Ironcrust Beetle" },
  { key: "goliathAlphaBeetle", displayName: "Goliath Beetle Alpha" },
];

const area1EncounterEnemyOrder = area1CombatEnemyOrder.filter((enemy) => enemy.key !== "goliathAlphaBeetle");
const area1EnemyNameToCombatKey = Object.fromEntries(area1CombatEnemyOrder.map((enemy) => [enemy.displayName, enemy.key]));

const coreStats = [
  {
    key: "strength",
    short: "STR",
    label: "Strength",
    effect: "Attack damage, carry weight",
  },
  {
    key: "agility",
    short: "AGI",
    label: "Agility",
    effect: "Turn order, dodge, stealth",
  },
  {
    key: "vitality",
    short: "VIT",
    label: "Vitality",
    effect: "Max HP, damage resistance",
  },
  {
    key: "intelligence",
    short: "INT",
    label: "Intelligence",
    effect: "Skill power, clue discovery",
  },
  {
    key: "endurance",
    short: "END",
    label: "Endurance",
    effect: "Stamina pool, exploration range",
  },
  {
    key: "perception",
    short: "PER",
    label: "Perception",
    effect: "Enemy detection, clue chance",
  },
];

function getDefaultCoreStats() {
  return {
    strength: baseStatValue,
    agility: baseStatValue,
    vitality: baseStatValue,
    intelligence: baseStatValue,
    endurance: baseStatValue,
    perception: baseStatValue,
  };
}

function getDefaultGameDetailsPayload() {
  const defaultArea1CombatProgress = Object.fromEntries(
    area1CombatEnemyOrder.map((enemy) => [enemy.key, { status: "undiscovered", kills: 0 }])
  );

  return {
    day: 1,
    stats: {
      Level: 1,
      EXP: 0,
      "stat points available": 0,
      str: baseStatValue,
      agi: baseStatValue,
      vit: baseStatValue,
      int: baseStatValue,
      end: baseStatValue,
      per: baseStatValue,
    },
    combat: {
      [area1CombatDbKey]: defaultArea1CombatProgress,
    },
  };
}

function parseKillCount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return Math.floor(numericValue);
}

function normalizeArea1CombatPayload(rawArea1Combat) {
  const incomingArea1Combat = rawArea1Combat && typeof rawArea1Combat === "object" ? rawArea1Combat : {};
  const normalizedArea1 = {};

  area1CombatEnemyOrder.forEach((enemy) => {
    const incomingEnemyData =
      (incomingArea1Combat[enemy.key] && typeof incomingArea1Combat[enemy.key] === "object" && incomingArea1Combat[enemy.key]) ||
      (incomingArea1Combat[enemy.displayName] &&
        typeof incomingArea1Combat[enemy.displayName] === "object" &&
        incomingArea1Combat[enemy.displayName]) ||
      {};
    const kills = parseKillCount(incomingEnemyData.kills);
    normalizedArea1[enemy.key] = {
      status: kills > 0 ? "discovered" : "undiscovered",
      kills,
    };
  });

  return normalizedArea1;
}

function buildArea1EnemyKillsFromCombatPayload(area1CombatPayload) {
  const killsByEnemy = {};
  area1CombatEnemyOrder.forEach((enemy) => {
    const killsFromKey = area1CombatPayload?.[enemy.key]?.kills;
    const killsFromLegacyDisplayName = area1CombatPayload?.[enemy.displayName]?.kills;
    killsByEnemy[enemy.key] = parseKillCount(killsFromKey ?? killsFromLegacyDisplayName);
  });
  return killsByEnemy;
}

function buildArea1EnemyStatusFromCombatPayload(area1CombatPayload) {
  const statusByEnemy = {};
  area1CombatEnemyOrder.forEach((enemy) => {
    const kills = parseKillCount(area1CombatPayload?.[enemy.key]?.kills ?? area1CombatPayload?.[enemy.displayName]?.kills);
    statusByEnemy[enemy.key] = kills > 0 ? "discovered" : "undiscovered";
  });

  return statusByEnemy;
}

function getArea1TotalKillsFromEnemyKills(area1EnemyKills) {
  return area1EncounterEnemyOrder.reduce((total, enemy) => total + parseKillCount(area1EnemyKills?.[enemy.key]), 0);
}

function xpForLevel(level) {
  if (level >= levelCap) {
    return 0;
  }

  return 100 + (level - 1) * 50;
}

function parseStatValue(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(baseStatValue, Math.round(numericValue));
}

function processLevelUps(initialLevel, initialXp) {
  let currentLevel = Math.max(1, Math.round(Number(initialLevel) || 1));
  let currentXp = Math.max(0, Math.round(Number(initialXp) || 0));
  let leveledUp = false;

  while (currentLevel < levelCap) {
    const requiredXp = xpForLevel(currentLevel);
    if (currentXp < requiredXp) {
      break;
    }

    currentXp -= requiredXp;
    currentLevel += 1;
    leveledUp = true;
  }

  if (currentLevel >= levelCap) {
    currentXp = 0;
  }

  return {
    level: currentLevel,
    xp: currentXp,
    leveledUp,
  };
}

function isPayloadEquivalent(rawValue, payload) {
  if (!rawValue || typeof rawValue !== "object") {
    return false;
  }

  return JSON.stringify(rawValue) === JSON.stringify(payload);
}

function normalizeGameDetailsPayload(rawGameDetails) {
  const defaults = getDefaultGameDetailsPayload();
  const incoming = rawGameDetails && typeof rawGameDetails === "object" ? rawGameDetails : {};
  const incomingStats = incoming.stats && typeof incoming.stats === "object" ? incoming.stats : incoming;

  const rawLevel = Number(incomingStats.Level ?? incomingStats.playerLevel ?? incoming.level ?? defaults.stats.Level);
  const rawXp = Number(incomingStats.EXP ?? incomingStats.xp ?? defaults.stats.EXP);
  const resolvedProgression = processLevelUps(rawLevel, rawXp);

  const normalizedStats = {
    Level: resolvedProgression.level,
    EXP: resolvedProgression.xp,
    str: parseStatValue(incomingStats.str ?? incomingStats.strength, defaults.stats.str),
    agi: parseStatValue(incomingStats.agi ?? incomingStats.agility, defaults.stats.agi),
    vit: parseStatValue(incomingStats.vit ?? incomingStats.vitality, defaults.stats.vit),
    int: parseStatValue(incomingStats.int ?? incomingStats.intelligence, defaults.stats.int),
    end: parseStatValue(incomingStats.end ?? incomingStats.endurance, defaults.stats.end),
    per: parseStatValue(incomingStats.per ?? incomingStats.perception, defaults.stats.per),
  };

  const spentPoints =
    (normalizedStats.str - baseStatValue) +
    (normalizedStats.agi - baseStatValue) +
    (normalizedStats.vit - baseStatValue) +
    (normalizedStats.int - baseStatValue) +
    (normalizedStats.end - baseStatValue) +
    (normalizedStats.per - baseStatValue);

  const allocatablePoints = Math.max(0, (normalizedStats.Level - 1) * statPointsPerLevel);
  normalizedStats["stat points available"] = Math.max(0, allocatablePoints - spentPoints);

  const incomingArea1Combat = incoming?.combat?.[area1CombatDbKey] ?? incoming?.combat?.area1;

  const normalized = {
    day: Math.max(1, Math.round(Number(incoming.day ?? defaults.day) || defaults.day)),
    stats: normalizedStats,
    combat: {
      [area1CombatDbKey]: normalizeArea1CombatPayload(incomingArea1Combat),
    },
  };

  return {
    payload: normalized,
    shouldSave: !isPayloadEquivalent(incoming, normalized),
    leveledUpFromOverflowXp: resolvedProgression.leveledUp,
  };
}

const state = {
  page: "Village",
  day: 1,
  level: 1,
  xp: 0,
  xpRequired: xpForLevel(1),
  statPoints: 0,
  coreStats: getDefaultCoreStats(),
  villageLevel: 1,
  log: [],
  uid: null,
  name: "Player",
  email: "",
  gameDetailsPath: "",
  clockAnchorDay: 1,
  clockAnchorRealMs: Date.now(),
  lastClockDay: 1,
  isPersistingDay: false,
  profileView: "overview",
  combat: {
    selectedArea: null,
    area1Kills: 0,
    area1EnemyKills: Object.fromEntries(area1CombatEnemyOrder.map((enemy) => [enemy.key, 0])),
    area1EnemyStatus: Object.fromEntries(area1CombatEnemyOrder.map((enemy) => [enemy.key, "undiscovered"])),
    area1SelectedEnemy: null,
    area1BossExpanded: false,
  },
};

const ui = {
  stats: document.getElementById("stats"),
  activities: document.getElementById("activities"),
  title: document.getElementById("screenTitle"),
  worldClock: document.getElementById("worldClock"),
  clockPhase: document.getElementById("clockPhase"),
  clockTime: document.getElementById("clockTime"),
  contentFrame: document.querySelector(".content-frame"),
  text: document.getElementById("mainText"),
  log: document.getElementById("log"),
  ascii: document.getElementById("asciiAnim"),
};

let frameTicker = null;
let statsUnsubscribe = null;
let clockTicker = null;

function getGameDetailsPayloadFromState() {
  const area1CombatPayload = Object.fromEntries(
    area1CombatEnemyOrder.map((enemy) => {
      const kills = parseKillCount(state.combat.area1EnemyKills[enemy.key]);
      return [
        enemy.key,
        {
          status: kills > 0 ? "discovered" : "undiscovered",
          kills,
        },
      ];
    })
  );

  return {
    day: state.day,
    stats: {
      Level: state.level,
      EXP: state.xp,
      "stat points available": state.statPoints,
      str: state.coreStats.strength,
      agi: state.coreStats.agility,
      vit: state.coreStats.vitality,
      int: state.coreStats.intelligence,
      end: state.coreStats.endurance,
      per: state.coreStats.perception,
    },
    combat: {
      [area1CombatDbKey]: area1CombatPayload,
    },
  };
}

function recalculateDerivedState() {
  const spentPoints = coreStats.reduce((total, stat) => total + (state.coreStats[stat.key] - baseStatValue), 0);
  const allocatablePoints = Math.max(0, (state.level - 1) * statPointsPerLevel);
  state.statPoints = Math.max(0, allocatablePoints - spentPoints);
  state.xpRequired = xpForLevel(state.level);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function setClockAnchor(day) {
  state.clockAnchorDay = Math.max(1, Math.round(Number(day) || 1));
  state.clockAnchorRealMs = Date.now();
  state.lastClockDay = state.clockAnchorDay;
}

function getWorldClockSnapshot(now = Date.now()) {
  const elapsedMs = Math.max(0, now - state.clockAnchorRealMs);
  const dayOffset = Math.floor(elapsedMs / realMsPerGameDay);
  const currentDay = state.clockAnchorDay + dayOffset;
  const dayProgress = (elapsedMs % realMsPerGameDay) / realMsPerGameDay;
  const totalMinutes = Math.floor(dayProgress * inGameMinutesPerDay);
  const snappedTotalMinutes = Math.floor(totalMinutes / 30) * 30;
  const hour = Math.floor(snappedTotalMinutes / 60) % 24;
  const minute = snappedTotalMinutes % 60;
  const isDaytime = hour >= 6 && hour < 18;

  return {
    day: currentDay,
    hour,
    minute,
    phaseLabel: isDaytime ? "DAY" : "NIGHT",
    phaseIcon: isDaytime ? "☀" : "☾",
    timeText: `${pad2(hour)}:${pad2(minute)}`,
  };
}

function renderWorldClock() {
  const snapshot = getWorldClockSnapshot();
  if (ui.clockPhase) {
    ui.clockPhase.textContent = `${snapshot.phaseIcon} ${snapshot.phaseLabel}`;
  }
  if (ui.clockTime) {
    ui.clockTime.textContent = `Day ${snapshot.day} || ${snapshot.timeText}`;
  }
  if (ui.worldClock) {
    ui.worldClock.classList.toggle("night", snapshot.phaseLabel === "NIGHT");
  }

  if (snapshot.day !== state.day) {
    state.day = snapshot.day;
  }

  return snapshot;
}

async function syncDayIfChanged(snapshot) {
  if (!snapshot || snapshot.day === state.lastClockDay || state.isPersistingDay) {
    return;
  }

  state.lastClockDay = snapshot.day;

  if (!state.gameDetailsPath) {
    return;
  }

  state.isPersistingDay = true;
  try {
    await persistStats();
    addLog(`Day advanced to ${snapshot.day}.`);
    renderLog();
  } catch (error) {
    console.error("Failed to persist day progression:", error);
    addLog("Sync warning: day progression could not be saved.");
    renderLog();
  } finally {
    state.isPersistingDay = false;
  }
}

function startWorldClock() {
  if (clockTicker) {
    clearInterval(clockTicker);
  }

  const tick = async () => {
    const snapshot = renderWorldClock();
    await syncDayIfChanged(snapshot);
  };

  void tick();
  clockTicker = setInterval(() => {
    void tick();
  }, 1000);
}

function addLog(message) {
  const snapshot = getWorldClockSnapshot();
  state.log.unshift({
    message,
    day: snapshot.day,
    time: snapshot.timeText,
    phaseIcon: snapshot.phaseIcon,
    phaseLabel: snapshot.phaseLabel,
  });
  state.log = state.log.slice(0, 30);
}

async function persistStats() {
  if (!state.gameDetailsPath) {
    return;
  }

  const gameDetailsRef = ref(database, state.gameDetailsPath);
  await set(gameDetailsRef, getGameDetailsPayloadFromState());
}

function renderStats() {
  const summaryStats = [
    ["Level", state.level],
    ["Stat Points", state.statPoints],
    ["Village Level", state.villageLevel],
  ];

  const xpLabel = state.xpRequired > 0 ? `${state.xp}/${state.xpRequired}` : "MAX";
  const xpPercent = state.xpRequired > 0 ? Math.min(100, Math.round((state.xp / state.xpRequired) * 100)) : 100;

  const coreRows = coreStats
    .map(
      (stat) =>
        `<li><span><strong class="stat-short">${stat.short}</strong> ${stat.label}</span><strong>${state.coreStats[stat.key]}</strong></li>`
    )
    .join("");

  ui.stats.innerHTML = summaryStats
    .map(([name, value]) => `<li><span>${name}</span><strong>${value}</strong></li>`)
    .join("")
    .concat(
      `<li class="xp-row"><div class="xp-head"><span>EXP ${xpLabel}</span></div><div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${xpPercent}"><span class="xp-fill" style="width: ${xpPercent}%"></span></div></li>${coreRows}`
    );
}

function renderActivities() {
  ui.activities.innerHTML = activities
    .map(
      (activity) =>
        `<button class="activity-btn ${state.page === activity ? "active" : ""}" data-activity="${activity}">${activity}</button>`
    )
    .join("");

  ui.activities.querySelectorAll(".activity-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.activity;
      if (state.page === "Profile") {
        state.profileView = "overview";
      }
      render();
    });
  });
}

function renderLog() {
  ui.log.innerHTML = state.log
    .map((entry) => {
      const normalized =
        typeof entry === "string"
          ? { message: entry, day: state.day, time: "--:--", phaseIcon: "●", phaseLabel: "LOG" }
          : entry;

      return `<li><div class="log-meta"><span class="log-phase">${normalized.phaseIcon} ${normalized.phaseLabel}</span><span class="log-stamp">D${normalized.day} // ${normalized.time}</span></div><p class="log-message">${normalized.message}</p></li>`;
    })
    .join("");
}

function animateAscii() {
  if (frameTicker) {
    clearInterval(frameTicker);
    frameTicker = null;
  }

  ui.ascii.textContent = "";
}

function renderVillage() {
  ui.text.innerHTML = "Village systems online.";
}

const combatArea1 = {
  id: "area1",
  title: "AREA 1 // THE WRECKAGE",
  setting: "Facility ruins, collapsed suburbs, cracked roads, rusted vehicles",
  recommendedLevel: "1 - 20",
  bossUnlock: "Per-enemy kill requirements",
  bossUnlockRequirements: [
    { key: "sodierAnt", label: "Sodier Ant", requiredKills: 50 },
    { key: "bombardierBeetle", label: "Bombardier Beetle", requiredKills: 35 },
    { key: "rubbleScarab", label: "Rubble Scarab", requiredKills: 25 },
    { key: "jumpingSpider", label: "Jumping Spider", requiredKills: 15 },
    { key: "IroncrustBeetle", label: "Ironcrust Beetle", requiredKills: 10 },
  ],
  boss: "Goliath Beetle Alpha",
  summary:
    "The remains of the research district. The first place the player sets foot outside the facility. Familiar enough to be unsettling. The insects here are aggressive but disorganised — they have not yet learned to coordinate.",
  enemies: [
    {
      code: "E1.1",
      name: "Soldier Ant",
      role: "Standard",
      hp: 120,
      atk: 18,
      def: 8,
      agi: 12,
      detail:
        "A basic mutant ant. Fast, aggressive, attacks in coordinated pairs. The most common spawn in the Wreckage. Low individual threat — dangerous in groups.",
      special: "None",
      drops: "Biomass Fragment [Common], Scrap Metal [Common], Chitin Shard [Uncommon]",
    },
    {
      code: "E1.2",
      name: "Bombardier Beetle",
      role: "Ranged",
      hp: 95,
      atk: 22,
      def: 6,
      agi: 9,
      detail: "Hangs back and spits acid at range. Slower but hits harder than the Soldier Ant.",
      special: "Each attack applies CORRODE (reduces player DEF by 2 per stack for 3 turns, up to 3 stacks).",
      drops: "Acid Gland [Common], Biomass Fragment [Common], Corrosive Residue [Uncommon], Beetle Carapace Chip [Rare]",
    },
    {
      code: "E1.3",
      name: "Rubble Scarab",
      role: "Tank",
      hp: 280,
      atk: 14,
      def: 22,
      agi: 5,
      detail: "Slow, heavily armoured, difficult to kill quickly. Low damage but absorbs punishment. A war of attrition.",
      special: "None",
      drops: "Hardened Shell Fragment [Common], Scrap Metal [Common], Dense Chitin Plate [Uncommon], Reinforced Exo-Shard [Rare]",
    },
    {
      code: "E1.4",
      name: "Jumping Spider",
      role: "Fast",
      hp: 80,
      atk: 28,
      def: 5,
      agi: 22,
      detail: "Extremely fast. Acts first in almost every combat. Glass cannon — high damage, low health.",
      special: "35% chance to act twice in the same turn (double strike). Each hit applies independently.",
      drops: "Spider Silk Thread [Common], Biomass Fragment [Common], Venom Trace [Uncommon], Arachnid Fang [Rare]",
    },
    {
      code: "E1.5",
      name: "Ironcrust Beetle",
      role: "Rare Variant",
      hp: 350,
      atk: 32,
      def: 28,
      agi: 8,
      detail: "A larger, stronger variant of the Rubble Scarab. Significantly higher stats across the board. Worth hunting for its loot table.",
      special: "Spawn chance ~1 in 8 encounters. When HP drops below 50%, ATK increases by 30% for the remainder of combat.",
      drops:
        "Dense Chitin Plate [1/2], Reinforced Exo-Shard [1/5], Ironcrust Fragment [1/60], Fused Shell Core [1/100], Carapace Shard [1/500]",
    },
  ],
  bossDetails: {
    hp: 4500,
    atk: 65,
    def: 45,
    agi: 7,
    phases: 2,
    description:
      "The same creature that destroyed the facility in the prologue. Van-sized. Matte-black plating. Mandibles longer than the player is tall.",
    drops: [
      { item: "Clue Fragment", chance: "Guaranteed" },
      { item: "Carapace Shard", chance: "Rare" },
    ],
  },
};

function parseDropEntries(dropText) {
  return dropText
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const bracketStart = entry.lastIndexOf("[");
      const itemName = bracketStart > 0 ? entry.slice(0, bracketStart).trim() : entry;
      const rate = bracketStart > 0 ? entry.slice(bracketStart + 1, -1).trim() : "Unknown";

      return {
        itemName,
        rate,
      };
    });
}

function renderKnownValue(isKnown, knownText, unknownClass = "") {
  if (isKnown) {
    return knownText;
  }

  if (unknownClass) {
    return `<span class="${unknownClass}">???</span>`;
  }

  return "???";
}

function resetContentLayout() {
  ui.contentFrame?.classList.remove("combat-layout");
  ui.ascii?.classList.remove("combat-sidebar");
  ui.text?.classList.remove("combat-main");
  ui.text?.classList.remove("profile-main");
}

function renderCombatAreaSelect() {
  ui.ascii.innerHTML = `
    <div class="combat-sidebar-grid">
      <section class="combat-card combat-intel-preview">
        <h3>Combat Feature</h3>
        <p>Turn-based encounters where each action matters.</p>
        <p>Build stats, defeat enemies, and progress through escalating combat zones.</p>
      </section>
    </div>
  `;

  ui.text.innerHTML = `
    <div class="combat-detail-stack">
      <section class="combat-detail-block">
        <h3>Combat</h3>
        <p>Beyond the safety of the village, every encounter is a calculated risk. Combat is turn-based and unforgiving — each decision, stat investment, and timing choice can decide whether you survive the next wave.</p>
        <p>Defeat hostile creatures to earn EXP, salvage resources, and growth materials. With every victory, your build sharpens, your power rises, and you push one step deeper into the ruins.</p>
      </section>

      <section class="combat-detail-block">
        <div class="combat-area-box">
          <button class="action-btn" data-revamp-area="area1">AREA 1 // THE WRECKAGE <span class="combat-area-level-tag">Reccomended level: lvl 1-20</span></button>
        </div>
      </section>
    </div>
  `;

  ui.text.querySelector("[data-revamp-area='area1']")?.addEventListener("click", () => {
    state.combat.selectedArea = "area1";
    render();
  });
}

function renderCombatArea1Details() {
  const area = combatArea1;
  const villageLevelRequired = 10;
  const isVillageConditionMet = state.villageLevel >= villageLevelRequired;
  const villageConditionRow = `<li class="combat-unlock-item ${isVillageConditionMet ? "complete" : ""}"><span>Village Level</span><strong>${state.villageLevel}/${villageLevelRequired}</strong></li>`;

  const completedEnemyUnlockRequirements = area.bossUnlockRequirements.filter(
    (condition) => parseKillCount(state.combat.area1EnemyKills[condition.key]) >= condition.requiredKills
  ).length;

  const unlockRequirementRows = area.bossUnlockRequirements
    .map((condition) => {
      const currentKills = parseKillCount(state.combat.area1EnemyKills[condition.key]);
      const isComplete = currentKills >= condition.requiredKills;
      const isDiscovered = state.combat.area1EnemyStatus[condition.key] === "discovered";
      const displayLabel = renderKnownValue(isDiscovered, condition.label);
      return `<li class="combat-unlock-item ${isComplete ? "complete" : ""}"><span>${displayLabel}</span><strong>${currentKills}/${condition.requiredKills}</strong></li>`;
    })
    .join("");

  const completedUnlockRequirements = completedEnemyUnlockRequirements + (isVillageConditionMet ? 1 : 0);
  const totalUnlockRequirements = area.bossUnlockRequirements.length + 1;
  const isBossUnlocked = completedUnlockRequirements >= totalUnlockRequirements;
  const isBossDiscovered = state.combat.area1EnemyStatus.goliathAlphaBeetle === "discovered";

  const enemyBoxes = area.enemies
    .map((enemy, index) => {
      const enemyCombatKey = area1EnemyNameToCombatKey[enemy.name];
      const isDiscovered = enemyCombatKey ? state.combat.area1EnemyStatus[enemyCombatKey] === "discovered" : false;
      const label = renderKnownValue(isDiscovered, enemy.name);
      const isExpanded = index === state.combat.area1SelectedEnemy;

      const lootRows = enemy.drops
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const bracketStart = entry.lastIndexOf("[");
          const itemName = bracketStart > 0 ? entry.slice(0, bracketStart).trim() : entry;
          const rate = bracketStart > 0 ? entry.slice(bracketStart + 1, -1).trim() : "Unknown";
          const displayName = renderKnownValue(isDiscovered, itemName);
          const displayRate = renderKnownValue(isDiscovered, rate);

          return `<tr><td>${displayName}</td><td>${displayRate}</td></tr>`;
        })
        .join("");

      const expandedContent = isExpanded
        ? `
          <div class="combat-enemy-expand">
            <p><strong>Name:</strong> ${renderKnownValue(isDiscovered, enemy.name)}</p>
            <p><strong>Description:</strong> ${renderKnownValue(isDiscovered, enemy.detail)}</p>
            <p class="combat-loot-title">Drop Table</p>
            <table class="combat-loot-table">
              <thead>
                <tr><th>Name</th><th>Drop Chance</th></tr>
              </thead>
              <tbody>${lootRows}</tbody>
            </table>
          </div>
        `
        : "";

      return `
        <div class="combat-enemy-card ${isExpanded ? "active" : ""}">
          <button class="combat-enemy-entry ${isExpanded ? "active" : ""}" data-area1-enemy-index="${index}">${label}</button>
          ${expandedContent}
        </div>
      `;
    })
    .join("");

  const bossIndexRows = area.bossDetails.drops
    .map((drop) => {
      const itemName = renderKnownValue(isBossDiscovered, drop.item, "unknown-mark");
      const itemChance = renderKnownValue(isBossDiscovered, drop.chance, "unknown-mark");
      return `<tr><td>${itemName}</td><td>${itemChance}</td></tr>`;
    })
    .join("");

  const isBossIndexExpanded = state.combat.area1BossExpanded;
  const bossIndexLabel = renderKnownValue(isBossDiscovered, area.boss, "unknown-mark");
  const bossIndexDescription = renderKnownValue(isBossDiscovered, area.bossDetails.description, "unknown-mark");
  const bossExpandedContent = isBossIndexExpanded
    ? `
      <div class="combat-enemy-expand combat-enemy-expand-boss">
        <p><strong>Name:</strong> ${bossIndexLabel}</p>
        <p><strong>Description:</strong> ${bossIndexDescription}</p>
        <p class="combat-loot-title">Drop Table</p>
        <table class="combat-loot-table">
          <thead>
            <tr><th>Name</th><th>Drop Chance</th></tr>
          </thead>
          <tbody>${bossIndexRows}</tbody>
        </table>
      </div>
    `
    : "";
  const bossIndexBox = `
    <div class="combat-enemy-card combat-enemy-card-boss ${isBossIndexExpanded ? "active" : ""}">
      <button class="combat-enemy-entry combat-enemy-entry-boss ${isBossIndexExpanded ? "active" : ""}" data-area1-boss-toggle="true">BOSS</button>
      ${bossExpandedContent}
    </div>
  `;

  ui.ascii.innerHTML = `
    <div class="combat-sidebar-grid">
      <section class="combat-card combat-map-card">
        <h3 class="combat-area-title">${area.title} <span class="combat-area-level-tag">Reccomended level: lvl ${area.recommendedLevel}</span></h3>
        <p><strong>Setting:</strong> ${area.setting}</p>
        <p><strong>Recommended Level:</strong> ${area.recommendedLevel}</p>
        <p><strong>Area Kills:</strong> ${state.combat.area1Kills}</p>
        <p><strong>Boss Unlock Progress:</strong> ${completedUnlockRequirements}/${totalUnlockRequirements} conditions met</p>
      </section>
      <section class="combat-card combat-intel-preview">
        <h3>Area Brief</h3>
        <p>${area.summary}</p>
      </section>
    </div>
  `;

  ui.text.innerHTML = `
    <div class="combat-detail-stack">
      <section class="combat-detail-block">
        <div class="combat-area-header-actions">
          <button class="action-btn" data-combat-back-areas="true">← Back to Areas</button>
          <button class="action-btn" data-combat-proceed="area1">Proceed to Area</button>
        </div>
      </section>

      <section class="combat-detail-block combat-area-brief-box">
        <h3 class="combat-area-title">${area.title} <span class="combat-area-level-tag">Reccomended level: lvl ${area.recommendedLevel}</span></h3>
        <div class="combat-area-description-box">
          <p class="combat-area-description">${area.summary}</p>
        </div>
        <div class="combat-boss-conditions">
          <p class="combat-loot-title">Boss Unlock Conditions</p>
          <ul class="combat-unlock-list">${villageConditionRow}${unlockRequirementRows}</ul>
          <div class="combat-boss-preview">
            <p class="combat-loot-title">Boss</p>
            <button
              class="combat-boss-box combat-boss-box-btn ${isBossUnlocked ? "unlocked" : "locked"}"
              data-boss-fight="area1"
              aria-label="${isBossUnlocked ? "Boss unlocked" : "Boss locked"}"
            >${isBossUnlocked ? "Fight" : '<span class="combat-boss-lock-icon" aria-hidden="true"></span>'}</button>
          </div>
        </div>
      </section>

      <section class="combat-detail-block">
        <div class="combat-discovery-grid">
          <div class="combat-enemy-list">
            <p class="combat-index-title">Combat index</p>
            ${enemyBoxes}
            ${bossIndexBox}
          </div>
        </div>
      </section>
    </div>
  `;

  ui.text.querySelector("[data-combat-back-areas='true']")?.addEventListener("click", () => {
    state.combat.selectedArea = null;
    render();
  });

  ui.text.querySelector("[data-combat-proceed='area1']")?.addEventListener("click", async () => {
    const encounterEnemy = area.enemies[Math.floor(Math.random() * area.enemies.length)];
    const encounterEnemyIndex = area.enemies.findIndex((enemy) => enemy.name === encounterEnemy.name);
    const encounterEnemyKey = area1EnemyNameToCombatKey[encounterEnemy.name];
    const previousKills = encounterEnemyKey ? parseKillCount(state.combat.area1EnemyKills[encounterEnemyKey]) : 0;
    if (encounterEnemyKey) {
      state.combat.area1EnemyKills[encounterEnemyKey] = previousKills + 1;
    }
    state.combat.area1Kills = getArea1TotalKillsFromEnemyKills(state.combat.area1EnemyKills);
    state.combat.area1SelectedEnemy = encounterEnemyIndex >= 0 ? encounterEnemyIndex : state.combat.area1SelectedEnemy;
    const isFirstEnemyDiscovery = previousKills === 0;

    if (isFirstEnemyDiscovery) {
      addLog(`${encounterEnemy.name} is added to combat log!`);

      parseDropEntries(encounterEnemy.drops).forEach((drop) => {
        addLog(`${drop.itemName} is added to combat log!`);
      });
    }

    try {
      await persistStats();
    } catch (error) {
      console.error("Failed to persist combat progression:", error);
      addLog("Sync warning: combat progression could not be saved.");
    }

    render();
  });

  ui.text.querySelector("[data-boss-fight='area1']")?.addEventListener("click", () => {
    if (!isBossUnlocked) {
      addLog("boss unlock conditions have not been met.");
      renderLog();
      return;
    }

    addLog("Boss fight entry selected. Encounter implementation is next.");
    renderLog();
  });

  ui.text.querySelectorAll("[data-area1-enemy-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextIndex = Number(button.dataset.area1EnemyIndex);
      if (Number.isNaN(nextIndex)) {
        return;
      }

      state.combat.area1SelectedEnemy = state.combat.area1SelectedEnemy === nextIndex ? null : nextIndex;
      state.combat.area1BossExpanded = false;
      render();
    });
  });

  ui.text.querySelector("[data-area1-boss-toggle='true']")?.addEventListener("click", () => {
    state.combat.area1BossExpanded = !state.combat.area1BossExpanded;
    if (state.combat.area1BossExpanded) {
      state.combat.area1SelectedEnemy = null;
    }
    render();
  });
}

function renderCombatPage() {
  ui.contentFrame?.classList.add("combat-layout");
  ui.ascii?.classList.add("combat-sidebar");
  ui.text?.classList.add("combat-main");

  if (state.combat.selectedArea === "area1") {
    ui.title.textContent = "Combat // Area 1";
    renderCombatArea1Details();
    return;
  }

  ui.title.textContent = "Combat";
  renderCombatAreaSelect();
}

async function assignStatPoint(statKey) {
  if (state.statPoints <= 0) {
    addLog("No available stat points.");
    render();
    return;
  }

  if (!(statKey in state.coreStats)) {
    return;
  }

  state.coreStats[statKey] += 1;
  recalculateDerivedState();
  addLog(`+ assigned to ${statKey.toUpperCase()}.`);

  try {
    await persistStats();
  } catch (error) {
    console.error("Failed to persist stat assignment:", error);
    addLog("Sync warning: stat allocation could not be saved.");
  }

  render();
}

function deriveNameFromEmail(email) {
  if (!email || !email.includes("@")) {
    return "Player";
  }

  const localPart = email.split("@")[0]?.trim();
  return localPart || "Player";
}

function renderProfilePage() {
  ui.text?.classList.add("profile-main");

  const displayName = state.name || deriveNameFromEmail(state.email);
  const displayEmail = state.email || "player@unknown";
  const xpLine = state.xpRequired > 0 ? `${state.xp}/${state.xpRequired} XP` : "MAX";
  const isPreEvolution = state.level <= levelCap;

  const renderBranchNode = (stat, branchPosition) =>
    `<article class="profile-tree-node profile-tree-node-${branchPosition}" data-tree-node="${stat.key}"><div class="profile-tree-node-head"><p class="profile-tree-node-title">${stat.label}</p><div class="profile-tree-node-controls"><strong>${state.coreStats[stat.key]}</strong><button class="action-btn" data-profile-stat-plus="${stat.key}" ${state.statPoints <= 0 || !isPreEvolution ? "disabled" : ""}>+</button></div></div><p class="inline-tag">${stat.effect}</p></article>`;

  const topBranchRows = coreStats.slice(0, 3).map((stat) => renderBranchNode(stat, "top")).join("");
  const bottomBranchRows = coreStats.slice(3, 6).map((stat) => renderBranchNode(stat, "bottom")).join("");

  if (state.profileView === "skilltree") {
    ui.text.innerHTML = `
      <div class="profile-grid profile-grid-skilltree">
        <section class="profile-card profile-skilltree">
          <div class="profile-skilltree-top">
            <button class="option-btn" data-profile-back="overview">← Back to Profile</button>
          </div>
          <h3>Skill Tree</h3>
          <p class="inline-tag profile-skilltree-subline">LEVEL 1-20 BRANCHES : 6 MAIN STATS</p>
          <div class="profile-tree-layout profile-tree-diagram">
            <div class="profile-tree-row profile-tree-row-top">${topBranchRows}</div>

            <div class="profile-tree-rail profile-tree-rail-top">
              <span class="profile-tree-rail-line"></span>
              <span class="profile-tree-rail-stem profile-tree-rail-stem-left"></span>
              <span class="profile-tree-rail-stem profile-tree-rail-stem-center"></span>
              <span class="profile-tree-rail-stem profile-tree-rail-stem-right"></span>
            </div>

            <div class="profile-tree-root-wrap">
              <div class="profile-tree-root">Core Growth</div>
            </div>

            <div class="profile-tree-rail profile-tree-rail-bottom">
              <span class="profile-tree-rail-line"></span>
              <span class="profile-tree-rail-stem profile-tree-rail-stem-left"></span>
              <span class="profile-tree-rail-stem profile-tree-rail-stem-center"></span>
              <span class="profile-tree-rail-stem profile-tree-rail-stem-right"></span>
            </div>

            <div class="profile-tree-row profile-tree-row-bottom">${bottomBranchRows}</div>
          </div>
        </section>

        <section class="profile-card profile-skills">
          <h3>Skills</h3>
          <div class="profile-skills-empty"></div>
        </section>
      </div>
    `;

    ui.text.querySelectorAll("[data-profile-stat-plus]").forEach((button) => {
      button.addEventListener("click", async () => {
        const statKey = button.dataset.profileStatPlus;
        await assignStatPoint(statKey);
      });
    });

    ui.text.querySelector("[data-profile-back='overview']")?.addEventListener("click", () => {
      state.profileView = "overview";
      render();
    });

    return;
  }

  ui.text.innerHTML = `
    <div class="profile-grid">
      <section class="profile-card profile-overview">
        <h3>Character Profile</h3>
        <p class="inline-tag">NAME : <strong class="settings-name">${displayName}</strong></p>
        <p class="settings-email">${displayEmail}</p>
        <div class="profile-meta-grid">
          <p class="inline-tag">LEVEL : <strong>${state.level}</strong></p>
          <p class="inline-tag">EXP : <strong>${xpLine}</strong></p>
          <p class="inline-tag">AVAILABLE STAT POINTS : <strong>${state.statPoints}</strong></p>
          <p class="inline-tag">EVOLUTION : <strong>Unknown</strong></p>
        </div>
      </section>

      <section class="profile-card profile-actions">
        <button class="option-btn" data-profile-open="skilltree">Skill Tree</button>
        <button class="option-btn" data-profile-action="tutorial">Tutorial Guide</button>
        <button class="option-btn" data-profile-action="logout">Log out</button>
      </section>
    </div>
  `;

  ui.text.querySelector("[data-profile-open='skilltree']")?.addEventListener("click", () => {
    state.profileView = "skilltree";
    render();
  });

  ui.text.querySelectorAll("[data-profile-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.profileAction;

      if (type === "tutorial") {
        window.location.href = "tutorial.html";
        return;
      }

      if (type === "logout") {
        await signOut(auth);
        window.location.href = "index.html";
        return;
      }

      render();
    });
  });
}

function render() {
  ui.title.textContent = state.page;
  renderWorldClock();
  resetContentLayout();

  renderStats();
  renderActivities();

  if (state.page === "Village") {
    renderVillage();
  } else if (state.page === "Combat") {
    renderCombatPage();
  } else if (state.page === "Profile") {
    renderProfilePage();
  } else {
    renderVillage();
  }

  renderLog();
  animateAscii();
}

function subscribeToUserStats(uid) {
  if (statsUnsubscribe) {
    statsUnsubscribe();
    statsUnsubscribe = null;
  }

  const accountDetailsRef = ref(database, `players/${uid}/account details`);
  const legacyAccountDetailsRef = ref(database, `players/${uid}/accountDetails`);

  get(accountDetailsRef).then(async (accountSnapshot) => {
    const resolvedSnapshot = accountSnapshot.exists() ? accountSnapshot : await get(legacyAccountDetailsRef);
    const accountDetails = resolvedSnapshot.exists() ? resolvedSnapshot.val() ?? {} : {};
    const accountEmail = typeof accountDetails?.email === "string" ? accountDetails.email.trim() : "";
    const accountName = typeof accountDetails?.username === "string" ? accountDetails.username.trim() : "";
    if (accountEmail) {
      state.email = accountEmail;
    }
    state.name = accountName || deriveNameFromEmail(state.email);

    const difficultyLevel = accountDetails?.DifficultyLevel ?? accountDetails?.difficultyLevel ?? {};
    const preferredOrder = ["easy", "normal", "hardcore"];
    const firstValid = preferredOrder.find((level) => Boolean(difficultyLevel?.[level]?.gameDetails));
    const normalizedDifficulty = firstValid || "normal";

    const gameDetailsRef = ref(database, `players/${uid}/account details/DifficultyLevel/${normalizedDifficulty}/gameDetails`);
    state.gameDetailsPath = `players/${uid}/account details/DifficultyLevel/${normalizedDifficulty}/gameDetails`;

    statsUnsubscribe = onValue(gameDetailsRef, async (snapshot) => {
      if (!snapshot.exists()) {
        await set(gameDetailsRef, getDefaultGameDetailsPayload());
        return;
      }

      const rawGameDetails = snapshot.val();
      const { payload, shouldSave, leveledUpFromOverflowXp } = normalizeGameDetailsPayload(rawGameDetails);

      state.day = payload.day;
      state.level = payload.stats.Level;
      state.xp = payload.stats.EXP;
      state.statPoints = payload.stats["stat points available"];
      state.coreStats = {
        strength: payload.stats.str,
        agility: payload.stats.agi,
        vitality: payload.stats.vit,
        intelligence: payload.stats.int,
        endurance: payload.stats.end,
        perception: payload.stats.per,
      };
      state.combat.area1EnemyKills = buildArea1EnemyKillsFromCombatPayload(payload.combat?.[area1CombatDbKey]);
      state.combat.area1EnemyStatus = buildArea1EnemyStatusFromCombatPayload(payload.combat?.[area1CombatDbKey]);
      state.combat.area1Kills = getArea1TotalKillsFromEnemyKills(state.combat.area1EnemyKills);
      recalculateDerivedState();
      setClockAnchor(state.day);

      if (leveledUpFromOverflowXp) {
        addLog("Overflow EXP converted into level progression.");
      }

      if (shouldSave) {
        try {
          await set(gameDetailsRef, payload);
        } catch (error) {
          console.error("Failed to normalize player stats:", error);
          addLog("Sync warning: normalized stats could not be saved.");
        }
      }

      render();
    });
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  state.uid = user.uid;
  state.email = user.email ?? "";
  state.name = deriveNameFromEmail(state.email);
  setClockAnchor(state.day);
  startWorldClock();
  addLog(`Signed in as ${user.email ?? "player"}.`);
  subscribeToUserStats(user.uid);
  render();
});
