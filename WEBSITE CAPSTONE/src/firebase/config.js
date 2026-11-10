import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const emulatorProject = globalThis.process?.env?.HARMONIA_EMULATOR_PROJECT;
if (emulatorProject && !emulatorProject.startsWith("demo-")) throw new Error("Tests require a demo- emulator project.");
const firebaseConfig = {
  apiKey: "AIzaSyCS6m4JybNezRKUk-Dnsv0NOR9vHCXPlMM",
  authDomain: "harmonia-47c73.firebaseapp.com",
  projectId: emulatorProject || "harmonia-47c73",
  storageBucket: "harmonia-47c73.firebasestorage.app",
  messagingSenderId: "1012094118095",
  appId: "1:1012094118095:web:53adb8d8e15fa1446e2fba",
  measurementId: "G-KK72S03LQ1"
};

// Primary App for normal user authentication and data access
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// Secondary App explicitly for Admin-side user creation to prevent session hijacking
const secondaryApp = getApps().find(a => a.name === "Secondary") || initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);
if (emulatorProject) {
  const env = globalThis.process.env;
  if (!env.FIREBASE_AUTH_EMULATOR_HOST || !env.FIRESTORE_EMULATOR_HOST) throw new Error("Emulator endpoints must be explicit.");
  connectAuthEmulator(auth, `http://${env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  connectAuthEmulator(secondaryAuth, `http://${env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const [host, port] = env.FIRESTORE_EMULATOR_HOST.split(":");
  connectFirestoreEmulator(db, host, Number(port));
}

let analytics = null;
if (!emulatorProject) isSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
  }
});

export { app, auth, secondaryAuth, db, analytics };
export const isFirebaseConfigured = !!app;
