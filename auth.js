import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { get, ref, set } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { auth, database } from "./firebase.js";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const goSignupBtn = document.getElementById("goSignupBtn");
const goLoginBtn = document.getElementById("goLoginBtn");

if (goSignupBtn) {
  goSignupBtn.addEventListener("click", () => {
    window.location.href = "signup.html";
  });
}

if (goLoginBtn) {
  goLoginBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("loginEmail")?.value?.trim() ?? "";
    const password = document.getElementById("loginPassword")?.value ?? "";

    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = "game.html";
    } catch (error) {
      window.alert(error?.message ?? "Login failed.");
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("signupEmail")?.value?.trim() ?? "";
    const password = document.getElementById("signupPassword")?.value ?? "";
    const confirmPassword = document.getElementById("signupConfirmPassword")?.value ?? "";

    if (password !== confirmPassword) {
      window.alert("Passwords do not match.");
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = credential.user.uid;
      const userRef = ref(database, `users/${uid}`);
      const existingUser = await get(userRef);

      if (!existingUser.exists()) {
        await set(userRef, {
          profile: {
            email,
            createdAt: Date.now(),
          },
          stats: {
            day: 1,
            level: 1,
            xp: 0,
            villageLevel: 1,
          },
        });
      }

      window.location.href = "game.html";
    } catch (error) {
      window.alert(error?.message ?? "Signup failed.");
    }
  });
}
