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

function renderSettings() {
  ui.text.innerHTML = `Settings:\n\n<div class="settings-grid">\n  <button class="option-btn" data-setting="rules">Gameplay Rules</button>\n  <button class="option-btn" data-setting="login">Login</button>\n  <button class="option-btn" data-setting="signup">Signup</button>\n</div>`;

  ui.text.querySelectorAll(".option-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.setting;

      if (type === "rules") {
        addLog("Gameplay Rules selected.");
      }

      if (type === "login") {
        await signOut(auth);
        window.location.href = "index.html";
        return;
      }

      if (type === "signup") {
        await signOut(auth);
        window.location.href = "signup.html";
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
    const difficultyLevel = accountSnapshot.exists() ? accountSnapshot.val()?.difficultyLevel ?? {} : {};
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
  addLog(`Signed in as ${user.email ?? "player"}.`);
  subscribeToUserStats(user.uid);
  render();
});
