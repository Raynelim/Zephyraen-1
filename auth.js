import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { get, ref, set } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { auth, database } from "./firebase.js?v=20260302r";

const elements = {
  authCard: document.querySelector(".auth-card"),
  authStatusMessage: document.getElementById("authStatusMessage"),
  loginForm: document.getElementById("loginForm"),
  signupForm: document.getElementById("signupForm"),
  goSignupBtn: document.getElementById("goSignupBtn"),
  goLoginBtn: document.getElementById("goLoginBtn"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginEmailMessage: document.getElementById("loginEmailMessage"),
  loginPasswordMessage: document.getElementById("loginPasswordMessage"),
  signupEmail: document.getElementById("signupEmail"),
  signupPassword: document.getElementById("signupPassword"),
  signupConfirmPassword: document.getElementById("signupConfirmPassword"),
  signupEmailMessage: document.getElementById("signupEmailMessage"),
  signupPasswordMessage: document.getElementById("signupPasswordMessage"),
  signupConfirmPasswordMessage: document.getElementById("signupConfirmPasswordMessage"),
};

const routes = {
  login: "index.html",
  signup: "signup.html",
  registration: "registration.html?v=20260302q",
  game: "game.html",
};

const messages = {
  requiredField: "Please fill out this field.",
  emailFormat: "Email must include @ and .com.",
  emailMissing: "Account does not exist.",
  emailInUse: "Account exists, please login.",
  wrongPassword: "Password error, please provide correct password.",
  passwordLength: "Password must have at least 6 characters.",
  passwordDigit: "Password must have at least 1 digit.",
  passwordMatch: "Passwords must match.",
  loginSuccess: "Login successful! Entering the world of Zephyraen....",
  signupSuccess: "Signup successful! Processing to registration....",
  verifyFailed: "Unable to verify email right now. Please try again.",
  loginFailed: "Login failed. Please try again.",
  signupFailed: "Signup failed. Please try again.",
};

const redirectDelayMs = 1000;

function isValidEmail(email) {
  return email.includes("@") && email.includes(".com");
}

function setAuthMessage(node, text, type, inputNode) {
  if (!node || !inputNode) {
    return;
  }

  node.textContent = text;
  node.classList.remove("error", "success", "show");
  inputNode.classList.remove("error", "success");

  if (!text) {
    return;
  }

  node.classList.add("show");

  if (type) {
    node.classList.add(type);
    inputNode.classList.add(type);
  }
}

function applyFieldErrors(errorMap) {
  Object.values(errorMap).forEach(({ messageNode, inputNode, text }) => {
    setAuthMessage(messageNode, text, text ? "error" : null, inputNode);
  });
}

function hasAnyFieldErrors(errorMap) {
  return Object.values(errorMap).some(({ text }) => Boolean(text));
}

function setStatusMessage(text, type) {
  if (!elements.authStatusMessage) {
    return;
  }

  elements.authStatusMessage.textContent = text;
  elements.authStatusMessage.classList.remove("show", "success", "error");

  if (!text) {
    return;
  }

  elements.authStatusMessage.classList.add("show");
  if (type) {
    elements.authStatusMessage.classList.add(type);
  }
}

function clearStatusState() {
  setStatusMessage("", null);
  elements.authCard?.classList.remove("success-flash");
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function showSuccessThenRedirect(message, destination) {
  setStatusMessage(message, "success");
  if (elements.authStatusMessage) {
    elements.authStatusMessage.style.display = "block";
  }
  elements.authCard?.classList.add("success-flash");
  void elements.authCard?.offsetHeight;
  await wait(30);
  await wait(redirectDelayMs);
  window.location.replace(destination);
}

function getFieldValue(node) {
  return node?.value?.trim() ?? "";
}

function getPasswordValue(node) {
  return node?.value ?? "";
}

function requireValue(value) {
  return Boolean(value);
}

function requirePasswordDigit(password) {
  return /\d/.test(password);
}

async function accountExistsInAuth(email) {
  const signInMethods = await fetchSignInMethodsForEmail(auth, email);
  return signInMethods.length > 0;
}

function deriveNameFromEmail(email) {
  if (!email.includes("@")) {
    return "Player";
  }

  const localPart = email.split("@")[0].trim();
  return localPart || "Player";
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

async function ensureUserDataInDatabase(user, emailFallback = "", nameFallback = "") {
  if (!user?.uid) {
    return;
  }

  const resolvedEmail = user.email ?? emailFallback;
  const resolvedName = nameFallback || deriveNameFromEmail(resolvedEmail);
  const creationInfo = getCreationDateTime();

  const accountDetailsRef = ref(database, `players/${user.uid}/accountDetails`);
  const accountDetailsSnapshot = await get(accountDetailsRef);
  const existingAccountDetails = accountDetailsSnapshot.exists() ? accountDetailsSnapshot.val() : {};
  const existingDifficultyLevel = existingAccountDetails?.difficultyLevel ?? {};

  await set(accountDetailsRef, {
    name: existingAccountDetails?.name || resolvedName,
    email: existingAccountDetails?.email || resolvedEmail,
    age: existingAccountDetails?.age ?? null,
    creationDate: existingAccountDetails?.creationDate || creationInfo.creationDate,
    creationTime: existingAccountDetails?.creationTime || creationInfo.creationTime,
    difficultyLevel: {
      easy: {
        gameDetails: existingDifficultyLevel?.easy?.gameDetails ?? {},
      },
      normal: {
        gameDetails: existingDifficultyLevel?.normal?.gameDetails ?? {},
      },
      hardcore: {
        gameDetails: existingDifficultyLevel?.hardcore?.gameDetails ?? {},
      },
    },
  });
}

function setupNavigation() {
  if (elements.goSignupBtn) {
    elements.goSignupBtn.addEventListener("click", () => {
      window.location.href = routes.signup;
    });
  }

  if (elements.goLoginBtn) {
    elements.goLoginBtn.addEventListener("click", () => {
      window.location.href = routes.login;
    });
  }
}

function suppressNativeValidation(formNode) {
  if (!formNode) {
    return;
  }

  formNode.noValidate = true;
  formNode.addEventListener(
    "invalid",
    (event) => {
      event.preventDefault();
    },
    true
  );
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  clearStatusState();

  const email = getFieldValue(elements.loginEmail);
  const password = getPasswordValue(elements.loginPassword);

  const loginErrors = {
    email: {
      messageNode: elements.loginEmailMessage,
      inputNode: elements.loginEmail,
      text: "",
    },
    password: {
      messageNode: elements.loginPasswordMessage,
      inputNode: elements.loginPassword,
      text: "",
    },
  };

  if (!requireValue(email)) {
    loginErrors.email.text = messages.requiredField;
  } else if (!isValidEmail(email)) {
    loginErrors.email.text = messages.emailFormat;
  }

  if (!requireValue(password)) {
    loginErrors.password.text = messages.requiredField;
  }

  applyFieldErrors(loginErrors);
  if (hasAnyFieldErrors(loginErrors)) {
    return;
  }

  let loginAccountExists = null;
  try {
    loginAccountExists = await accountExistsInAuth(email);
    if (!loginAccountExists) {
      loginErrors.email.text = messages.emailMissing;
      applyFieldErrors(loginErrors);
      return;
    }
  } catch {
    loginAccountExists = null;
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    ensureUserDataInDatabase(credential.user, email).catch(() => {
    });
    setAuthMessage(elements.loginPasswordMessage, messages.loginSuccess, "success", elements.loginPassword);
    await showSuccessThenRedirect(messages.loginSuccess, routes.game);
  } catch (error) {
    const code = error?.code ?? "";

    if (code === "auth/wrong-password") {
      loginErrors.password.text = messages.wrongPassword;
      applyFieldErrors(loginErrors);
      return;
    }

    if (code === "auth/user-not-found") {
      loginErrors.email.text = messages.emailMissing;
      applyFieldErrors(loginErrors);
      return;
    }

    if (code === "auth/invalid-credential") {
      if (loginAccountExists === false) {
        loginErrors.email.text = messages.emailMissing;
      } else if (loginAccountExists === true) {
        loginErrors.password.text = messages.wrongPassword;
      } else {
        loginErrors.password.text = messages.loginFailed;
      }

      applyFieldErrors(loginErrors);
      return;
    }

    loginErrors.password.text = messages.loginFailed;
    applyFieldErrors(loginErrors);
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  clearStatusState();

  const email = getFieldValue(elements.signupEmail);
  const password = getPasswordValue(elements.signupPassword);
  const confirmPassword = getPasswordValue(elements.signupConfirmPassword);

  const signupErrors = {
    email: {
      messageNode: elements.signupEmailMessage,
      inputNode: elements.signupEmail,
      text: "",
    },
    password: {
      messageNode: elements.signupPasswordMessage,
      inputNode: elements.signupPassword,
      text: "",
    },
    confirmPassword: {
      messageNode: elements.signupConfirmPasswordMessage,
      inputNode: elements.signupConfirmPassword,
      text: "",
    },
  };

  if (!requireValue(email)) {
    signupErrors.email.text = messages.requiredField;
  } else if (!isValidEmail(email)) {
    signupErrors.email.text = messages.emailFormat;
  }

  if (!requireValue(password)) {
    signupErrors.password.text = messages.requiredField;
  } else {
    const passwordIssues = [];
    if (password.length < 6) {
      passwordIssues.push(messages.passwordLength);
    }
    if (!requirePasswordDigit(password)) {
      passwordIssues.push(messages.passwordDigit);
    }
    if (passwordIssues.length > 0) {
      signupErrors.password.text = passwordIssues.join(" ");
    }
  }

  if (!requireValue(confirmPassword)) {
    signupErrors.confirmPassword.text = messages.requiredField;
  } else if (requireValue(password) && password !== confirmPassword) {
    signupErrors.confirmPassword.text = messages.passwordMatch;
  }

  applyFieldErrors(signupErrors);
  if (hasAnyFieldErrors(signupErrors)) {
    return;
  }

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    ensureUserDataInDatabase(credential.user, email).catch(() => {
    });

    setAuthMessage(elements.signupConfirmPasswordMessage, messages.signupSuccess, "success", elements.signupConfirmPassword);
    await showSuccessThenRedirect(messages.signupSuccess, routes.registration);
  } catch (error) {
    const code = error?.code ?? "";

    if (code === "auth/email-already-in-use") {
      setAuthMessage(elements.signupEmailMessage, messages.emailInUse, "error", elements.signupEmail);
      return;
    }

    if (code === "auth/network-request-failed") {
      setAuthMessage(elements.signupEmailMessage, messages.verifyFailed, "error", elements.signupEmail);
      return;
    }

    setAuthMessage(elements.signupConfirmPasswordMessage, messages.signupFailed, "error", elements.signupConfirmPassword);
  }
}

function setupLoginForm() {
  if (!elements.loginForm) {
    return;
  }

  suppressNativeValidation(elements.loginForm);
  elements.loginForm.addEventListener("submit", handleLoginSubmit);
}

function setupSignupForm() {
  if (!elements.signupForm) {
    return;
  }

  suppressNativeValidation(elements.signupForm);
  elements.signupForm.addEventListener("submit", handleSignupSubmit);
}

function initializeAuthPages() {
  setupNavigation();
  setupLoginForm();
  setupSignupForm();
}

initializeAuthPages();
