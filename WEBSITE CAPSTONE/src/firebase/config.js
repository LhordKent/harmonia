import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

// Node tests set HARMONIA_EMULATOR_PROJECT; the local browser check (npm run dev:emulators) sets the
// VITE_ equivalents. Production builds set neither and always use the live project.
const viteEnv = import.meta.env ?? {};
const nodeEnv = globalThis.process?.env ?? {};
const emulatorEnv = nodeEnv.HARMONIA_EMULATOR_PROJECT ? nodeEnv : {
  HARMONIA_EMULATOR_PROJECT: viteEnv.VITE_EMULATOR_PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: viteEnv.VITE_AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST: viteEnv.VITE_FIRESTORE_EMULATOR_HOST,
};
const emulatorProject = emulatorEnv.HARMONIA_EMULATOR_PROJECT;
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

if (emulatorProject) {
  const env = emulatorEnv;
  if (!env.FIREBASE_AUTH_EMULATOR_HOST || !env.FIRESTORE_EMULATOR_HOST) throw new Error("Emulator endpoints must be explicit.");
  connectAuthEmulator(auth, `http://${env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const [host, port] = env.FIRESTORE_EMULATOR_HOST.split(":");
  connectFirestoreEmulator(db, host, Number(port));
}

let analytics = null;
if (!emulatorProject) isSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
  }
});

export { app, auth, db, analytics };
export const isFirebaseConfigured = !!app;
