import { 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  deleteUser,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "firebase/auth";
import { auth, secondaryAuth } from "./config.js";

/**
 * Log in a user with the primary auth instance.
 */
export const loginUser = async (email, password, rememberMe = true) => {
  const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
  await setPersistence(auth, persistence);
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

/**
 * Log out the current user from the primary auth instance.
 */
export const logoutUser = async () => {
  await signOut(auth);
};

/**
 * Create a new authentication account without signing out the current admin.
 * Uses the secondary auth instance.
 */
export const createAccountAuth = async (email, password, saveProfile) => {
  if (password.length < 6) throw new Error("Use a password with at least 6 characters.");
  if (typeof saveProfile !== "function") throw new Error("An account profile is required.");
  const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  try {
    await saveProfile(userCredential.user);
    return userCredential.user;
  } catch (error) {
    try {
      await deleteUser(userCredential.user);
    } catch {
      throw new Error("Account profile setup failed and the sign-in account could not be removed. Contact the administrator before retrying.", { cause: error });
    }
    throw error;
  } finally {
    await signOut(secondaryAuth);
  }
};

/**
 * Send a password reset email to the given address.
 */
export const resetUserPassword = async (email) => {
  await sendPasswordResetEmail(auth, email);
};
