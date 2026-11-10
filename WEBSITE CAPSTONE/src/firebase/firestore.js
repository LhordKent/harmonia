import { db, auth } from "./config.js";
import { normalizeSession, reviewFields } from './sessionModel.js';
import { exerciseFields } from './exerciseModel.js';
import { requireValidCoach } from "./access.js";
import { 
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp, writeBatch, getDocFromServer 
} from "firebase/firestore";

// ============================================
// USERS (Admin / Base Profiles)
// ============================================

export const getUserProfile = async (uid) => {
  const docRef = doc(db, "users", uid);
  const snap = await getDocFromServer(docRef);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }
  return null;
};

/**
 * Loads the signed-in user's profile document.
 *
 * Profiles are NEVER created from the browser. An admin creates every
 * profile and assigns its role (see createCoach / createStudent). If no
 * profile exists this returns null and the login is refused.
 */
export const ensureUserProfile = async (user) => {
  if (!user || !user.uid) return null;

  try {
    const snap = await getDocFromServer(doc(db, "users", user.uid));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }
  } catch (err) {
    console.error("ensureUserProfile failed:", err);
  }

  return null;
};


// ============================================
// COACHES
// ============================================

export const getCoaches = async (institutionId, viewer) => {
  if (viewer?.role === "coach") {
    const own = await getCoachById(viewer.id);
    return own ? [own] : [];
  }
  const q = query(collection(db, "coaches"), where("institutionId", "==", institutionId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getCoachById = async (coachId) => {
  const snap = await getDoc(doc(db, "coaches", coachId));
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  return null;
};

export const createCoach = async (coachData) => {
  // Assume coachData includes a predefined userId from Firebase Auth creation
  const { userId, ...rest } = coachData;
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  
  // 1. Create base user profile
  batch.set(doc(db, "users", userId), {
    firstName: rest.firstName || rest.name.split(" ")[0] || "",
    lastName: rest.lastName || rest.name.split(" ").slice(1).join(" ") || "",
    email: rest.email,
    role: "coach",
    institutionId: rest.institutionId,
    status: rest.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  // 2. Create coach specific profile
  const coachDoc = {
    userId,
    name: rest.name, // for backwards compatibility with UI
    firstName: rest.firstName || rest.name.split(" ")[0] || "",
    lastName: rest.lastName || rest.name.split(" ").slice(1).join(" ") || "",
    email: rest.email,
    institutionId: rest.institutionId,
    status: rest.status || "active",
    mustChangePassword: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  batch.set(doc(db, "coaches", userId), coachDoc);
  await batch.commit();
  return { id: userId, ...coachDoc };
};

export const updateCoach = async (coachId, updates) => {
  const docRef = doc(db, "coaches", coachId);
  updates = { ...updates, updatedAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.update(docRef, updates);

  // Sync to users collection if applicable
  const userUpdates = {};
  if (updates.status) userUpdates.status = updates.status;
  if (updates.email) userUpdates.email = updates.email;
  if (updates.name) {
    userUpdates.firstName = updates.name.split(" ")[0] || "";
    userUpdates.lastName = updates.name.split(" ").slice(1).join(" ") || "";
  }
  
  if (Object.keys(userUpdates).length > 0) {
    userUpdates.updatedAt = serverTimestamp();
    batch.update(doc(db, "users", coachId), userUpdates);
  }

  await batch.commit();
  return { id: coachId, ...updates };
};

export const deactivateCoach = async (coachId) => {
  return updateCoach(coachId, { status: "inactive" });
};

export const deleteCoach = async (coachId) => {
  return updateCoach(coachId, { status: "inactive" });
};

// ============================================
// STUDENTS
// ============================================

export const getStudents = async (institutionId, viewer) => {
  if (viewer?.role === "coach") return getStudentsByCoach(viewer.id, institutionId);
  const q = query(collection(db, "students"), where("institutionId", "==", institutionId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getStudentsByCoach = async (coachId, institutionId) => {
  const filters = [where("coachId", "==", coachId)];
  if (institutionId) filters.push(where("institutionId", "==", institutionId));
  const q = query(collection(db, "students"), ...filters);
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getIndependentStudents = async () => {
  const snapshot = await getDocs(query(collection(db, "students"), where("institutionId", "==", null)));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const createStudent = async (studentData) => {
  const { userId, ...rest } = studentData;
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  if (rest.coachId) requireValidCoach(await getCoachById(rest.coachId), rest.institutionId);

  // 1. Create base user profile
  batch.set(doc(db, "users", userId), {
    firstName: rest.firstName || rest.name.split(" ")[0] || "",
    lastName: rest.lastName || rest.name.split(" ").slice(1).join(" ") || "",
    email: rest.email,
    role: "student",
    institutionId: rest.institutionId,
    status: rest.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  // 2. Create student profile
  const studentDoc = {
    userId,
    name: rest.name, // compatibility
    firstName: rest.firstName || rest.name.split(" ")[0] || "",
    lastName: rest.lastName || rest.name.split(" ").slice(1).join(" ") || "",
    email: rest.email,
    institutionId: rest.institutionId,
    coachId: rest.coachId || null,
    status: rest.status || "active",
    mustChangePassword: true,
    badges: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  batch.set(doc(db, "students", userId), studentDoc);
  await batch.commit();
  return { id: userId, ...studentDoc };
};

export const updateStudent = async (studentId, updates) => {
  if (updates.coachId) {
    const current = await getDoc(doc(db, "students", studentId));
    requireValidCoach(await getCoachById(updates.coachId), updates.institutionId || current.data()?.institutionId);
  }
  const docRef = doc(db, "students", studentId);
  updates = { ...updates, updatedAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.update(docRef, updates);

  // Sync to users collection if applicable
  const userUpdates = {};
  if (updates.status) userUpdates.status = updates.status;
  if ("institutionId" in updates) userUpdates.institutionId = updates.institutionId;
  if (updates.name) {
    userUpdates.firstName = updates.name.split(" ")[0];
    userUpdates.lastName = updates.name.split(" ").slice(1).join(" ");
  }
  if (updates.email) userUpdates.email = updates.email;
  
  if (Object.keys(userUpdates).length > 0) {
    userUpdates.updatedAt = serverTimestamp();
    batch.update(doc(db, "users", studentId), userUpdates);
  }

  await batch.commit();
  return { id: studentId, ...updates };
};

export const assignStudentToCoach = async (studentId, coachId) => {
  return updateStudent(studentId, { coachId: coachId || null });
};

export const enrollStudent = async (studentId, institutionId, coachId = null) => {
  if (!institutionId) throw new Error("An institution is required for enrollment.");
  return updateStudent(studentId, { institutionId, coachId, studentType: "collaborated" });
};

export const deleteStudent = async (studentId) => {
  // Preserve identity and history; a deleted account cannot self-enroll again.
  return updateStudent(studentId, { status: "deleted" });
};

// ============================================
// EXERCISES
// ============================================

export const getExercises = async (institutionId) => {
  const q = query(collection(db, "exercises"), where("institutionId", "==", institutionId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getExercisesByCoach = async (coachId) => {
  const q = query(collection(db, "exercises"), where("coachId", "==", coachId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const createExercise = async (exerciseData) => {
  const docRef = doc(collection(db, "exercises"));
  const timestamp = serverTimestamp();
  const data = {
    ...exerciseFields(exerciseData),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await setDoc(docRef, data);
  return { id: docRef.id, ...data };
};

export const updateExercise = async (exerciseId, updates) => {
  const docRef = doc(db, "exercises", exerciseId);
  const data = { ...exerciseFields(updates), updatedAt: serverTimestamp() };
  await updateDoc(docRef, data);
  return { id: exerciseId, ...data };
};

export const deleteExercise = async (exerciseId) => {
  await deleteDoc(doc(db, "exercises", exerciseId));
};

// ============================================
// PRACTICE SESSIONS
// ============================================

export const getSessions = async (institutionId, viewer) => {
  if (viewer?.role === "coach") {
    const students = await getStudentsByCoach(viewer.id, institutionId);
    const snapshots = await Promise.all(students.map(student => getDocs(query(
      collection(db, "practiceSessions"), where("studentId", "==", student.id)
    ))));
    return snapshots.flatMap(snapshot => snapshot.docs.map(d => normalizeSession({ id: d.id, ...d.data() })));
  }
  const q = query(collection(db, "practiceSessions"), where("institutionId", "==", institutionId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => normalizeSession({ id: doc.id, ...doc.data() }));
};

export const updateSession = async (sessionId, data) => {
  if (!auth.currentUser) throw new Error('Sign in before reviewing a session.');
  const review = { ...reviewFields(data), reviewedBy: auth.currentUser.uid, reviewedAt: serverTimestamp() };
  const docRef = doc(db, "practiceSessions", sessionId);
  await updateDoc(docRef, review);
  return { id: sessionId, ...review };
};

// ============================================
// NOTIFICATIONS / REMINDERS
// ============================================

export const getBadges = async () => {
  const snapshot = await getDocs(collection(db, "badges"));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const createPracticeReminder = async (reminderData) => {
  const docRef = doc(collection(db, "notifications"));
  const data = {
    ...reminderData,
    type: "reminder",
    createdAt: serverTimestamp(),
    isRead: false
  };
  await setDoc(docRef, data);
  return { id: docRef.id, ...data };
};

// ==== NEW FIRESTORE HELPERS ====

export const getAnnouncements = async (institutionId) => {
  const q = institutionId ? query(collection(db, "announcements"), where("institutionId", "==", institutionId)) : collection(db, "announcements");
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addAnnouncement = async (announcement) => {
  const docRef = doc(collection(db, "announcements"));
  const data = { ...announcement, createdAt: serverTimestamp() };
  await setDoc(docRef, data);
  return { id: docRef.id, ...data };
};

export const DEFAULT_INSTITUTION_ID = "institution_001";

export const getInstitution = async (institutionId = DEFAULT_INSTITUTION_ID) => {
  const docRef = doc(db, "institutions", institutionId);
  const snap = await getDoc(docRef);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  return null;
};

export const updateInstitution = async (institutionId, updates) => {
  const docRef = doc(db, "institutions", institutionId);
  await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  return { id: institutionId, ...updates };
};

export const saveBadge = async (badge) => {
  if (badge.id) {
    const docRef = doc(db, "badges", badge.id);
    await updateDoc(docRef, { ...badge, updatedAt: serverTimestamp() });
    return { id: badge.id, ...badge };
  } else {
    const docRef = doc(collection(db, "badges"));
    const data = { ...badge, createdAt: serverTimestamp() };
    await setDoc(docRef, data);
    return { id: docRef.id, ...data };
  }
};

// ============================================
// ADMIN — DASHBOARD STATISTICS
// ============================================

export const getDashboardStatistics = async (institutionId) => {
  const [coachSnap, studentSnap, exerciseSnap, sessionSnap] = await Promise.all([
    getDocs(query(collection(db, "coaches"), where("institutionId", "==", institutionId))),
    getDocs(query(collection(db, "students"), where("institutionId", "==", institutionId))),
    getDocs(query(collection(db, "exercises"), where("institutionId", "==", institutionId))),
    getDocs(query(collection(db, "practiceSessions"), where("institutionId", "==", institutionId))),
  ]);

  const coaches = coachSnap.docs.map(d => d.data());
  const students = studentSnap.docs.map(d => d.data());
  const sessions = sessionSnap.docs.map(d => d.data());

  return {
    totalCoaches: coaches.length,
    activeCoaches: coaches.filter(c => c.status === "active").length,
    totalStudents: students.length,
    activeStudents: students.filter(s => s.status === "active").length,
    totalExercises: exerciseSnap.size,
    totalSessions: sessions.length,
  };
};

// ============================================
// STUDENTS — ADDITIONAL HELPERS
// ============================================

/** Reassign a student to a new coach (explicit alias for clarity). */
export const reassignStudentToCoach = async (studentId, newCoachId) => {
  return assignStudentToCoach(studentId, newCoachId);
};

/** Soft-deactivate a student without deleting data. */
export const deactivateStudent = async (studentId) => {
  return updateStudent(studentId, { status: "inactive" });
};

/** Aggregate practice progress for a single student. */
export const getStudentPracticeProgress = async (studentId) => {
  const q = query(
    collection(db, "practiceSessions"),
    where("studentId", "==", studentId)
  );
  const snap = await getDocs(q);
  const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (sessions.length === 0) {
    return { sessions: [], totalSessions: 0, avgPitch: 0, avgTone: 0, completionRate: 0 };
  }

  const completed = sessions.filter(s => s.status === "completed" || !s.status);
  const avgPitch = Math.round(sessions.reduce((sum, s) => sum + (s.pitchAccuracy || 0), 0) / sessions.length);
  const avgTone  = Math.round(sessions.reduce((sum, s) => sum + (s.toneAccuracy  || 0), 0) / sessions.length);

  return {
    sessions,
    totalSessions: sessions.length,
    completedSessions: completed.length,
    avgPitch,
    avgTone,
    completionRate: Math.round((completed.length / sessions.length) * 100),
  };
};

