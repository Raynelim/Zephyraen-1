import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { get, onValue, ref, set } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { auth, database } from "./firebase.js?v=20260302r";

const activities = ["Village", "Settings"];

const state = {
  page: "Village",
  day: 1,
  level: 1,
  xp: 0,
  villageLevel: 1,
  log: ["Zephyraen initialized in minimal mode."],
  uid: null,
  name: "Player",
  email: "",
};

const ui = {
  stats: document.getElementById("stats"),
  activities: document.getElementById("activities"),
  title: document.getElementById("screenTitle"),
  text: document.getElementById("mainText"),
  log: document.getElementById("log"),
  ascii: document.getElementById("asciiAnim"),
};

let frameTicker = null;
let statsUnsubscribe = null;

function addLog(message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 30);
}

function renderStats() {
  const stats = [
    ["Day", state.day],
    ["Level", state.level],
    ["XP", state.xp],
    ["Village Level", state.villageLevel],
  ];

  ui.stats.innerHTML = stats
    .map(([name, value]) => `<li><span>${name}</span><strong>${value}</strong></li>`)
    .join("");
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
      render();
    });
  });
}

function renderLog() {
  ui.log.innerHTML = state.log.map((entry) => `<li>${entry}</li>`).join("");
}

function animateAscii() {
  if (frameTicker) {
    clearInterval(frameTicker);
    frameTicker = null;
  }

  ui.ascii.textContent = "";
}

function renderVillage() {
  ui.text.textContent = "Village tab is currently empty.\n\n(Planned village gameplay will be added next.)";
}

function deriveNameFromEmail(email) {
  if (!email || !email.includes("@")) {
    return "Player";
  }

  const localPart = email.split("@")[0]?.trim();
  return localPart || "Player";
}

function renderSettings() {
  const displayName = state.name || deriveNameFromEmail(state.email);
  const displayEmail = state.email || "player@unknown";
  ui.text.innerHTML = `Settings:\n\n<div class="settings-grid">\n  <div class="settings-account">\n    <p class="inline-tag">LOGGED IN AS : <strong class="settings-name">${displayName}</strong></p>\n    <p class="settings-email">${displayEmail}</p>\n  </div>\n  <button class="option-btn" data-setting="tutorial">Tutorial Guide</button>\n  <button class="option-btn" data-setting="logout">Log out</button>\n</div>`;

  ui.text.querySelectorAll(".option-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.setting;

      if (type === "rules") {
        addLog("Gameplay Rules selected.");
      }

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

  renderStats();
  renderActivities();

  if (state.page === "Village") {
    renderVillage();
  } else {
    renderSettings();
  }

  renderLog();
  animateAscii();
}

function subscribeToUserStats(uid) {
  if (statsUnsubscribe) {
    statsUnsubscribe();
    statsUnsubscribe = null;
  }

  const accountDetailsRef = ref(database, `players/${uid}/accountDetails`);

  get(accountDetailsRef).then((accountSnapshot) => {
    const accountDetails = accountSnapshot.exists() ? accountSnapshot.val() ?? {} : {};
    const accountEmail = typeof accountDetails?.email === "string" ? accountDetails.email.trim() : "";
    const accountName = typeof accountDetails?.name === "string" ? accountDetails.name.trim() : "";
    if (accountEmail) {
      state.email = accountEmail;
    }
    state.name = accountName || deriveNameFromEmail(state.email);

    const difficultyLevel = accountDetails?.difficultyLevel ?? {};
    const hasEasyStats = Boolean(difficultyLevel?.easy?.gameDetails?.stats);
    const hasNormalStats = Boolean(difficultyLevel?.normal?.gameDetails?.stats);
    const hasHardcoreStats = Boolean(difficultyLevel?.hardcore?.gameDetails?.stats);

    let normalizedDifficulty = "normal";
    if (hasEasyStats) {
      normalizedDifficulty = "easy";
    } else if (hasNormalStats) {
      normalizedDifficulty = "normal";
    } else if (hasHardcoreStats) {
      normalizedDifficulty = "hardcore";
    }

    const statsRef = ref(database, `players/${uid}/accountDetails/difficultyLevel/${normalizedDifficulty}/gameDetails/stats`);

    statsUnsubscribe = onValue(statsRef, async (snapshot) => {
      if (!snapshot.exists()) {
        await set(statsRef, {
          playerLevel: 1,
          xp: 0,
        });
        return;
      }

      const stats = snapshot.val();
      state.day = Number(stats.day ?? 1);
      state.level = Number(stats.playerLevel ?? stats.level ?? 1);
      state.xp = Number(stats.xp ?? 0);
      state.villageLevel = Number(stats.villageLevel ?? 1);
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
  addLog(`Signed in as ${user.email ?? "player"}.`);
  subscribeToUserStats(user.uid);
  render();
});
