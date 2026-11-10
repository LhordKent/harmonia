import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/config";
import { loginUser, logoutUser, resetUserPassword, reauthenticateWithNewPassword } from "../firebase/auth";
import { getUserProfile, updateCoach } from "../firebase/firestore";
import { requireWebProfile, onboardingState } from "../firebase/access";
import { changeAccountPassword, completeAccountOnboarding } from "../firebase/accountsService";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const SCHOOL_KEY = "harmonia.platformAdmin.school";
const readStoredSchool = () => { try { return localStorage.getItem(SCHOOL_KEY) || ""; } catch { return ""; } };

/**
 * Reads the authoritative server profile and derives the onboarding state.
 * A pending account first asks the backend to verify an out-of-band (email) password
 * change, so recovery and interrupted completions resume automatically.
 */
async function loadSession(user) {
  let profile = requireWebProfile(await getUserProfile(user.uid));
  let state = onboardingState(profile);
  if (state === "passwordChangeRequired") {
    try {
      const result = await completeAccountOnboarding();
      if (result?.state && result.state !== state) {
        profile = requireWebProfile(await getUserProfile(user.uid));
        state = onboardingState(profile);
      }
    } catch {
      // Not changed yet (or service unreachable): stay on the setup screen.
    }
  }
  return { profile: { ...profile, uid: user.uid, id: user.uid }, state };
}

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [authState, setAuthState] = useState("signedOut");
  const [loading, setLoading] = useState(true);
  const [selectedSchoolId, setSelectedSchoolIdState] = useState(readStoredSchool);
  const generation = useRef(0);

  const applySession = useCallback((session) => {
    setCurrentUser(session?.profile ?? null);
    setAuthState(session?.state ?? "signedOut");
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const run = ++generation.current;
      if (!user) {
        applySession(null);
        setLoading(false);
        return;
      }
      try {
        const session = await loadSession(user);
        if (run !== generation.current || auth.currentUser?.uid !== user.uid) return;
        applySession(session);
      } catch (err) {
        console.error("Error fetching user profile:", err);
        if (run !== generation.current || auth.currentUser?.uid !== user.uid) return;
        await logoutUser();
        applySession(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [applySession]);

  const refreshProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { applySession(null); return null; }
    const run = ++generation.current;
    const session = await loadSession(user);
    if (run === generation.current) applySession(session);
    return session;
  }, [applySession]);

  const login = async (email, password, rememberMe) => {
    setLoading(true);
    try {
      const user = await loginUser(email, password, rememberMe);
      let session;
      try {
        session = await loadSession(user);
      } catch (error) {
        await logoutUser();
        throw error;
      }
      generation.current++;
      applySession(session);
      return session.profile;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await logoutUser();
      applySession(null);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Changes the Firebase password through the trusted backend, then signs in again with the
   * new password (older sessions are revoked) and reloads the profile before enabling access.
   */
  const changePassword = async (currentPassword, newPassword) => {
    const email = auth.currentUser?.email;
    if (!email) throw new Error("Sign in again before changing your password.");
    try {
      await changeAccountPassword(currentPassword, newPassword);
    } catch (error) {
      if (error.code !== "PROFILE_PENDING") throw error;
      // The new password is active; finish setup with a fresh sign-in.
      await reauthenticateWithNewPassword(email, newPassword);
      try {
        await completeAccountOnboarding();
      } catch {
        throw new Error("Your new password is active, but setup could not be finished. Sign out and sign in with your new password to continue.");
      }
      return refreshProfile();
    }
    await reauthenticateWithNewPassword(email, newPassword);
    return refreshProfile();
  };

  const resetPassword = async (email) => {
    await resetUserPassword(email);
  };

  const updateProfileData = async (data) => {
    if (!currentUser || currentUser.role !== "coach") return;
    const updated = await updateCoach(currentUser.id, data);
    const mergedUser = { ...currentUser, ...updated };
    setCurrentUser(mergedUser);
    return mergedUser;
  };

  const setSelectedSchoolId = (id) => {
    setSelectedSchoolIdState(id || "");
    try { localStorage.setItem(SCHOOL_KEY, id || ""); } catch { /* per-browser convenience only */ }
  };

  const isPlatformAdmin = currentUser?.role === "admin";
  const isSchoolAdmin = currentUser?.role === "institution";

  // Platform administrators work on one selected school at a time; everyone else is fixed to their own.
  const effectiveUser = useMemo(() => {
    if (!currentUser || !isPlatformAdmin) return currentUser;
    return { ...currentUser, homeInstitutionId: currentUser.institutionId ?? null,
      institutionId: selectedSchoolId || currentUser.institutionId || null };
  }, [currentUser, isPlatformAdmin, selectedSchoolId]);

  const value = {
    currentUser: effectiveUser,
    authState,
    loading,
    login,
    logout,
    resetPassword,
    changePassword,
    refreshProfile,
    updateProfileData,
    isAdmin: isPlatformAdmin,
    isPlatformAdmin,
    isSchoolAdmin,
    canManageAccounts: isPlatformAdmin || isSchoolAdmin,
    selectedSchoolId: effectiveUser?.institutionId || "",
    setSelectedSchoolId,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
