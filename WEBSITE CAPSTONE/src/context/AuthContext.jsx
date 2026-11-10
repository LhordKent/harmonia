import React, { createContext, useContext, useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/config";
import { loginUser, logoutUser, resetUserPassword } from "../firebase/auth";
import { getUserProfile, ensureUserProfile, updateCoach } from "../firebase/firestore";
import { requireWebProfile } from "../firebase/access";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          let userProfile = await getUserProfile(user.uid);
          if (!userProfile) {
            userProfile = await ensureUserProfile(user);
          }
          
          if (auth.currentUser?.uid !== user.uid) return;
          if (userProfile) {
            userProfile = requireWebProfile(userProfile);
            setCurrentUser({
              ...userProfile,
              uid: user.uid,
              id: user.uid // Ensure id exists for compatibility
            });
          } else {
            console.warn("User profile not found in Firestore.");
            await logoutUser();
            setCurrentUser(null);
          }
        } catch (err) {
          console.error("Error fetching user profile:", err);
          if (auth.currentUser?.uid !== user.uid) return;
          await logoutUser();
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });
    
    return unsubscribe;
  }, []);

  const login = async (email, password, rememberMe) => {
    setLoading(true);
    try {
      const user = await loginUser(email, password, rememberMe);
      let userProfile = await getUserProfile(user.uid);
      if (!userProfile) {
        userProfile = await ensureUserProfile(user);
      }
      
      if (!userProfile) {
        await logoutUser();
        throw new Error("User profile not found in the database.");
      }
      
      try {
        userProfile = requireWebProfile(userProfile);
      } catch (error) {
        await logoutUser();
        throw error;
      }


      const mergedUser = {
        ...userProfile,
        uid: user.uid,
        id: user.uid
      };
      
      setCurrentUser(mergedUser);
      return mergedUser;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await logoutUser();
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
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

  const isAdmin = currentUser?.role === "admin";
  const canManageAccounts = isAdmin || currentUser?.role === "institution";

  const value = {
    currentUser,
    loading,
    login,
    logout,
    resetPassword,
    updateProfileData,
    isAdmin,
    canManageAccounts
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
