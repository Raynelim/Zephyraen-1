import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkXPIgvj_XSzVMgwP1JYJTEusRI8zWGF0",
  authDomain: "zephyraen-9dabd.firebaseapp.com",
  projectId: "zephyraen-9dabd",
  databaseURL: "https://zephyraen-9dabd-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "zephyraen-9dabd.firebasestorage.app",
  messagingSenderId: "170168925603",
  appId: "1:170168925603:web:0283e074433c15e399ae16",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app, firebaseConfig.databaseURL);

export { app, auth, database };
