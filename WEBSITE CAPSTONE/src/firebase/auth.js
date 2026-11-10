import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "firebase/auth";
import { auth } from "./config.js";

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
 * After a password change older sessions are revoked; sign in again with the new password,
 * keeping the persistence the user chose at login.
 */
export const reauthenticateWithNewPassword = async (email, password) => {
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
 * Send a password reset email to the given address. Recovery is email-only.
 */
export const resetUserPassword = async (email) => {
  await sendPasswordResetEmail(auth, email);
};
