import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { auth, database } from "./firebase.js?v=20260302r";

const routes = {
  login: "index.html",
  game: "game.html",
  tutorial: "tutorial.html",
};

const messages = {
  requiredField: "Please fill out this field.",
  saveSuccess: "Registration successful, entering the world of Zephyraen...",
  saveFailed: "Could not save registration details. Please try again.",
};

const difficultyDescriptions = {
  Easy: "Easy: Relaxed enemies and forgiving progression for a chill start.",
  Normal: "Normal: Balanced challenge for standard adventure pacing.",
  Hardcore: "Hardcore: High risk, tougher enemies, and intense progression.",
};

const redirectDelayMs = 1000;
const saveTimeoutMs = 12000;
const fallbackSaveTimeoutMs = 12000;
const databaseRestBaseUrl = "https://zephyraen-9dabd-default-rtdb.asia-southeast1.firebasedatabase.app";

const elements = {
  authCard: document.querySelector(".auth-card"),
  form: document.getElementById("registrationForm"),
  statusMessage: document.getElementById("registrationStatusMessage"),
  name: document.getElementById("regName"),
  age: document.getElementById("regAge"),
  ageNumber: document.getElementById("regAgeNumber"),
  difficultyGrid: document.getElementById("difficultyGrid"),
  difficultyDescription: document.getElementById("regDifficultyDescription"),
  nameMessage: document.getElementById("regNameMessage"),
  ageMessage: document.getElementById("regAgeMessage"),
  difficultyMessage: document.getElementById("regDifficultyMessage"),
};

let activeUser = null;
let selectedDifficulty = "";
let isSubmitting = false;

function getText(node) {
  return node?.value?.trim() ?? "";
}

function setStatusMessage(text, type) {
  if (!elements.statusMessage) {
    return;
  }

  elements.statusMessage.textContent = text;
  elements.statusMessage.classList.remove("show", "success", "error");
  elements.statusMessage.style.display = "";

  if (!text) {
    return;
  }

  elements.statusMessage.classList.add("show");
  elements.statusMessage.style.display = "block";
  if (type) {
    elements.statusMessage.classList.add(type);
  }
}

function setFieldMessage(messageNode, inputNode, text) {
  if (!messageNode || !inputNode) {
    return;
  }

  messageNode.textContent = text;
  messageNode.classList.remove("show", "error");
  inputNode.classList.remove("error");

  if (!text) {
    return;
  }

  messageNode.classList.add("show", "error");
  inputNode.classList.add("error");
}

function setDifficultyMessage(text) {
  if (!elements.difficultyMessage) {
    return;
  }

  elements.difficultyMessage.textContent = text;
  elements.difficultyMessage.classList.remove("show", "error");

  if (!text) {
    return;
  }

  elements.difficultyMessage.classList.add("show", "error");
}

function resetStatusState() {
  setStatusMessage("", null);
  elements.authCard?.classList.remove("success-flash");
}

function clampAge(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (numericValue < 13) {
    return 13;
  }

  if (numericValue > 100) {
    return 100;
  }

  return Math.round(numericValue);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCreationDateTime() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return {
    creationDate: `${day}/${month}/${year}`,
    creationTime: `${hours}:${minutes}`,
  };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const timeoutError = new Error("Database save timed out.");
        timeoutError.code = "database/save-timeout";
        reject(timeoutError);
      }, timeoutMs);
    }),
  ]);
}

async function savePlayerDetails(uid, payload) {
  const playerRef = ref(database, `players/${uid}/accountDetails`);

  try {
    await withTimeout(set(playerRef, payload), saveTimeoutMs);
    return;
  } catch (sdkError) {
    if (sdkError?.code !== "database/save-timeout") {
      throw sdkError;
    }
  }

  try {
    await withTimeout(set(playerRef, payload), saveTimeoutMs);
    return;
  } catch (retryError) {
    if (retryError?.code !== "database/save-timeout") {
      throw retryError;
    }
  }

  if (!activeUser) {
    const authStateError = new Error("No active authenticated user for fallback save.");
    authStateError.code = "auth/no-current-user";
    throw authStateError;
  }

  const idToken = await activeUser.getIdToken();
  const response = await withTimeout(
    fetch(`${databaseRestBaseUrl}/players/${uid}/accountDetails.json?auth=${encodeURIComponent(idToken)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    fallbackSaveTimeoutMs
  );

  if (!response.ok) {
    const responseText = await response.text();
    const restError = new Error(responseText || `HTTP ${response.status}`);
    restError.code = `database/rest-http-${response.status}`;
    throw restError;
  }
}

function formatSaveError(error) {
  const errorCode = error?.code ? String(error.code) : "unknown";
  const errorMessage = error?.message ? String(error.message) : "No additional details.";
  return `${messages.saveFailed} (${errorCode}) ${errorMessage}`;
}

function showSuccessState(message) {
  setStatusMessage(message, "success");
  elements.authCard?.classList.add("success-flash");
}

function syncAgeInputs(source) {
  if (!elements.age || !elements.ageNumber) {
    return;
  }

  const sourceValue = source === "number" ? elements.ageNumber.value : elements.age.value;
  const clamped = clampAge(sourceValue);

  if (clamped === null) {
    return;
  }

  elements.age.value = String(clamped);
  elements.ageNumber.value = String(clamped);
}

function selectDifficulty(difficulty) {
  selectedDifficulty = difficulty;

  elements.difficultyGrid?.querySelectorAll(".difficulty-card").forEach((button) => {
    const isSelected = button.dataset.difficulty === difficulty;
    button.classList.toggle("active", isSelected);
  });

  const description = difficultyDescriptions[difficulty] ?? "Select a difficulty to see its description.";
  if (elements.difficultyDescription) {
    elements.difficultyDescription.textContent = description;
  }

  setDifficultyMessage("");
}

function setupDifficultySelection() {
  if (!elements.difficultyGrid) {
    return;
  }

  const difficultyButtons = elements.difficultyGrid.querySelectorAll(".difficulty-card");

  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const difficulty = button.dataset.difficulty ?? "";
      selectDifficulty(difficulty);
    });
  });

  elements.difficultyGrid.addEventListener("click", (event) => {
    const rawTarget = event.target;
    const clickedButton = rawTarget instanceof Element ? rawTarget.closest(".difficulty-card") : null;
    if (!clickedButton) {
      return;
    }

    const difficulty = clickedButton.dataset.difficulty ?? "";
    selectDifficulty(difficulty);
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  if (!activeUser) {
    window.location.href = routes.login;
    return;
  }

  isSubmitting = true;
  const submitButton = elements.form?.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
  }

  resetStatusState();

  const name = getText(elements.name);
  const ageInput = elements.ageNumber?.value ?? elements.age?.value ?? "18";
  const age = clampAge(ageInput) ?? 18;

  setFieldMessage(elements.nameMessage, elements.name, "");
  setFieldMessage(elements.ageMessage, elements.age, "");
  setDifficultyMessage("");

  let hasErrors = false;

  if (!name) {
    setFieldMessage(elements.nameMessage, elements.name, messages.requiredField);
    hasErrors = true;
  }

  if (!selectedDifficulty) {
    setDifficultyMessage(messages.requiredField);
    hasErrors = true;
  }

  if (hasErrors) {
    isSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
    }
    return;
  }

  const normalizedDifficulty = selectedDifficulty.toLowerCase();

  const creationInfo = getCreationDateTime();

  const payload = {
    name,
    email: activeUser.email ?? "",
    age,
    creationDate: creationInfo.creationDate,
    creationTime: creationInfo.creationTime,
    difficultyLevel: {
      easy: {
        gameDetails: normalizedDifficulty === "easy" ? { stats: { playerLevel: 1, xp: 0 } } : {},
      },
      normal: {
        gameDetails: normalizedDifficulty === "normal" ? { stats: { playerLevel: 1, xp: 0 } } : {},
      },
      hardcore: {
        gameDetails: normalizedDifficulty === "hardcore" ? { stats: { playerLevel: 1, xp: 0 } } : {},
      },
    },
  };

  try {
    setStatusMessage("Saving registration details...", null);
    await savePlayerDetails(activeUser.uid, payload);
    isSubmitting = false;
    showSuccessState(messages.saveSuccess);
    window.setTimeout(() => {
      window.location.replace(`${routes.tutorial}?v=20260302o`);
    }, redirectDelayMs);
  } catch (error) {
    console.error("Registration save failed:", error);
    resetStatusState();
    isSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
    }
    setStatusMessage(formatSaveError(error), "error");
  }
}

function initializeRegistrationPage() {
  if (!elements.form) {
    return;
  }

  elements.form.noValidate = true;
  elements.form.addEventListener("submit", handleFormSubmit);

  if (elements.age) {
    elements.age.addEventListener("input", () => {
      syncAgeInputs("range");
    });
    elements.age.addEventListener("change", () => {
      syncAgeInputs("range");
    });
  }

  if (elements.ageNumber) {
    elements.ageNumber.addEventListener("input", () => {
      syncAgeInputs("number");
    });
    elements.ageNumber.addEventListener("change", () => {
      syncAgeInputs("number");
    });
    elements.ageNumber.addEventListener("blur", () => {
      const clamped = clampAge(elements.ageNumber.value);
      elements.ageNumber.value = String(clamped ?? 18);
      syncAgeInputs("number");
    });
  }

  syncAgeInputs("range");

  setupDifficultySelection();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = routes.login;
      return;
    }

    activeUser = user;
    if (!getText(elements.name) && user.email) {
      elements.name.value = user.email.split("@")[0] ?? "";
    }
  });
}

initializeRegistrationPage();
