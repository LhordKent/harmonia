import { auth } from "./config.js";

/** Public endpoint of the trusted accounts Edge Function. It holds no secrets; the caller's Firebase token authorizes each call. */
export const ACCOUNTS_ENDPOINT = globalThis.process?.env?.HARMONIA_ACCOUNTS_ENDPOINT
  || import.meta.env?.VITE_ACCOUNTS_ENDPOINT
  || "https://ztrnmbtdaruyffjqjejz.supabase.co/functions/v1/accounts";

export class AccountsError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

export async function callAccounts(action, body = {}, user = auth.currentUser) {
  if (!user) throw new AccountsError("Sign in first.", "UNAUTHENTICATED", 401);
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(ACCOUNTS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, action }),
    });
  } catch {
    throw new AccountsError("The account service could not be reached. Check your connection and retry.", "NETWORK", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountsError(data.error || "The account service is temporarily unavailable.", data.code, response.status);
  return data;
}

/** Retry-safe identifier so a repeated "create school" request cannot create a second school. */
export const newRequestId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

export const createSchool = (school) => callAccounts("createSchool", school);
export const setSchoolBasePassword = (schoolId, basePassword) => callAccounts("setBasePassword", { schoolId, basePassword });
export const createSchoolAccount = (account) => callAccounts("createAccount", account);
export const changeAccountPassword = (currentPassword, newPassword) => callAccounts("changePassword", { currentPassword, newPassword });
export const completeAccountOnboarding = () => callAccounts("completeOnboarding");

/**
 * Right after the backend clears the requirement, Firestore can briefly still refuse protected reads.
 * Retry a permission denial a few times (about 4 s in total) before reporting it.
 */
export async function waitForProtectedAccess(probe, attempts = 6) {
  for (let i = 0; ; i++) {
    try {
      return await probe();
    } catch (error) {
      if (!/permission/i.test(error?.code || error?.message || "") || i >= attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (i + 1)));
    }
  }
}

export function validateNewPassword({ currentPassword, newPassword, confirmPassword }) {
  if (!currentPassword) return "Enter your current password.";
  if (!newPassword || newPassword.length < 8) return "Your new password must have at least 8 characters.";
  if (newPassword !== confirmPassword) return "The new password and confirmation do not match.";
  if (newPassword === currentPassword) return "Your new password must be different from your current password.";
  return null;
}
