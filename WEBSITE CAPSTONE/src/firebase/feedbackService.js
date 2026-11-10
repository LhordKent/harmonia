/**
 * feedbackService.js
 * ─────────────────────────────────────────────────────────────
 * Centralized Firebase service for the Coach Feedback &
 * Final Verdict system.
 *
 * Collections:
 *   coachFeedback/    — free-text feedback per student per coach
 *   coachAssessments/ — structured assessment + final verdict
 * ─────────────────────────────────────────────────────────────
 */

import { db, auth } from "./config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  serverTimestamp,
  orderBy,
  limit,
} from "firebase/firestore";

// ============================================================
// VERDICT OPTIONS — used in UI dropdowns + Firestore values
// ============================================================
export const VERDICT_OPTIONS = [
  { value: "approved",               label: "✅ Approved",                description: "Student has met the required standard." },
  { value: "needs_improvement",      label: "📈 Needs Improvement",       description: "Student shows potential but needs more practice." },
  { value: "repeat_exercise",        label: "🔁 Repeat Exercise",         description: "Student should redo this exercise before advancing." },
  { value: "ready_for_next_exercise",label: "⏭️ Ready for Next Exercise", description: "Student can move on to the next exercise." },
];

// ============================================================
// AI FEEDBACK — Deterministic rule-based generator
// ============================================================

/**
 * Generate advisory AI feedback based on a student's practice data.
 * This is rule-based (no external AI API required).
 * Always clearly labeled as AI-generated in the UI.
 *
 * @param {object} student
 * @param {Array}  sessions  — practice session records for this student
 * @param {Array}  exercises — all available exercises
 * @returns {string} AI feedback text
 */
export const generateAIFeedback = (student, sessions, exercises = []) => {
  if (!sessions || sessions.length === 0) {
    return `No practice session data is currently available for ${student?.name || "this student"}. AI feedback will be generated once the student completes their first practice session.`;
  }

  const name = student?.name || "This student";
  sessions = sessions.filter(s => typeof s.pitchAccuracy === 'number' && Number.isFinite(s.pitchAccuracy) && typeof s.toneAccuracy === 'number' && Number.isFinite(s.toneAccuracy));
  if (!sessions.length) return 'No scored practice is available yet. Review the recordings and any retry guidance before assessing progress.';
  const total = sessions.length;
  const completed = sessions.filter(s => s.status === "completed" || !s.status).length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const avgPitch = total > 0
    ? Math.round(sessions.reduce((sum, s) => sum + (s.pitchAccuracy || 0), 0) / total)
    : 0;
  const avgTone = total > 0
    ? Math.round(sessions.reduce((sum, s) => sum + (s.toneAccuracy || 0), 0) / total)
    : 0;

  // Sort sessions by date to detect trend
  const sorted = [...sessions].sort((a, b) => {
    const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
    const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
    return aTime - bTime;
  });

  let trendText = "";
  if (sorted.length >= 3) {
    const oldAvg = (sorted[0].pitchAccuracy + sorted[0].toneAccuracy) / 2;
    const newAvg = (sorted[sorted.length - 1].pitchAccuracy + sorted[sorted.length - 1].toneAccuracy) / 2;
    const delta = newAvg - oldAvg;
    if (delta > 10) trendText = "The available data indicates a clear upward trend in accuracy scores.";
    else if (delta > 0) trendText = "The available data suggests a modest improvement in accuracy over time.";
    else if (delta < -10) trendText = "Recent sessions show a slight decline in accuracy scores compared to earlier sessions.";
    else trendText = "Accuracy scores have remained relatively consistent across recent sessions.";
  }

  // Determine overall performance level
  const combined = (avgPitch + avgTone) / 2;
  let performanceText = "";
  if (combined >= 85) {
    performanceText = `${name} is demonstrating strong performance with an average combined accuracy of ${combined}%. Both pitch (${avgPitch}%) and tone (${avgTone}%) are within the high-performance range.`;
  } else if (combined >= 70) {
    performanceText = `${name} is showing moderate performance with an average combined accuracy of ${combined}%. Pitch accuracy is ${avgPitch}% and tone accuracy is ${avgTone}%. There is room for focused improvement.`;
  } else {
    performanceText = `${name} is currently showing lower accuracy scores, with an average of ${combined}%. Pitch: ${avgPitch}%, Tone: ${avgTone}%. Consistent practice and targeted exercises are recommended.`;
  }

  let consistencyText = "";
  if (completionRate >= 80) {
    consistencyText = `${name} has demonstrated excellent consistency, completing ${completed} out of ${total} sessions (${completionRate}% completion rate).`;
  } else if (completionRate >= 50) {
    consistencyText = `${name} has completed ${completed} out of ${total} sessions (${completionRate}% completion rate). Encouraging more regular practice sessions could improve outcomes.`;
  } else {
    consistencyText = `${name} has a low session completion rate of ${completionRate}% (${completed}/${total} sessions). Increased engagement and practice frequency is strongly recommended.`;
  }

  return [
    performanceText,
    consistencyText,
    trendText,
    "Note: This feedback is generated from available practice data and is intended as an advisory tool for the Vocal Coach's review.",
  ]
    .filter(Boolean)
    .join(" ");
};

// ============================================================
// COACH FEEDBACK — Free-text observations
// ============================================================

/**
 * Retrieve the latest coach feedback record for a student.
 */
export const getCoachFeedback = async (studentId, coachId) => {
  try {
    const q = query(
      collection(db, "coachFeedback"),
      where("studentId", "==", studentId),
      where("coachId", "==", coachId),
      orderBy("updatedAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (err) {
    console.error("getCoachFeedback error:", err);
    return null;
  }
};

/**
 * Save (create or update) coach feedback for a student.
 * If a feedback document already exists for this coach/student pair,
 * it will be updated. Otherwise a new document is created.
 */
export const saveCoachFeedback = async ({ studentId, coachId, coachName, feedbackText, institutionId }) => {
  // Check for existing document
  const q = query(
    collection(db, "coachFeedback"),
    where("studentId", "==", studentId),
    where("coachId", "==", coachId),
    limit(1)
  );
  const snap = await getDocs(q);

  const data = {
    studentId,
    coachId,
    coachName: coachName || "",
    feedbackText,
    institutionId,
    updatedAt: serverTimestamp(),
  };

  if (!snap.empty) {
    const existingRef = doc(db, "coachFeedback", snap.docs[0].id);
    await updateDoc(existingRef, data);
    return { id: snap.docs[0].id, ...data };
  } else {
    data.createdAt = serverTimestamp();
    const newRef = await addDoc(collection(db, "coachFeedback"), data);
    return { id: newRef.id, ...data };
  }
};

// ============================================================
// COACH ASSESSMENTS — Structured assessment + final verdict
// ============================================================

/**
 * Get the latest coach assessment for a student.
 */
const assessmentCoachScope = async (coachId) => {
  if (coachId !== undefined) return coachId;
  if (!auth.currentUser) throw new Error("Sign in before loading assessments.");
  const profile = await getDoc(doc(db, "users", auth.currentUser.uid));
  return profile.data()?.role === "coach" ? auth.currentUser.uid : null;
};

export const getCoachAssessment = async (studentId, coachId) => {
  coachId = await assessmentCoachScope(coachId);
  try {
    const q = query(
      collection(db, "coachAssessments"),
      where("studentId", "==", studentId),
      ...(coachId ? [where("coachId", "==", coachId)] : []),
      orderBy("updatedAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (err) {
    // Fallback without ordering in case index is creating
    try {
      const qFallback = query(
        collection(db, "coachAssessments"),
        where("studentId", "==", studentId),
        ...(coachId ? [where("coachId", "==", coachId)] : [])
      );
      const snap = await getDocs(qFallback);
      if (snap.empty) return null;
      const sorted = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
        const tA = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
        const tB = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
        return tB - tA;
      });
      return sorted[0];
    } catch (e) {
      console.error("getCoachAssessment error:", e);
      return null;
    }
  }
};

/**
 * Get all past assessments for a student to display evaluation history.
 */
export const getCoachAssessmentHistory = async (studentId, coachId) => {
  coachId = await assessmentCoachScope(coachId);
  try {
    const q = query(
      collection(db, "coachAssessments"),
      where("studentId", "==", studentId),
      ...(coachId ? [where("coachId", "==", coachId)] : [])
    );
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return docs.sort((a, b) => {
      const tA = a.finalizedAt?.seconds || a.updatedAt?.seconds || a.createdAt?.seconds || 0;
      const tB = b.finalizedAt?.seconds || b.updatedAt?.seconds || b.createdAt?.seconds || 0;
      return tB - tA;
    });
  } catch (err) {
    console.error("getCoachAssessmentHistory error:", err);
    return [];
  }
};

/**
 * Save or update a coach assessment.
 * Handles AI agreement/override, coach notes, additional observations, and final verdict.
 */
export const saveCoachAssessment = async ({
  studentId,
  coachId,
  coachName,
  institutionId,
  exerciseId = null,
  aiFeedback,
  aiAlignment = "neutral", // "agree" | "override" | "neutral"
  coachFeedback,
  additionalObservations = "",
  finalVerdict = null,
  status = "draft", // "draft" | "finalized"
}) => {
  if (status === 'finalized' && !VERDICT_OPTIONS.some(option => option.value === finalVerdict)) {
    throw new Error('Choose a final verdict before submitting the assessment.');
  }
  const q = query(
    collection(db, "coachAssessments"),
    where("studentId", "==", studentId),
    where("coachId", "==", coachId),
    where("status", "==", "draft"),
    limit(1)
  );
  const snap = await getDocs(q);

  const data = {
    studentId,
    coachId,
    coachName: coachName || "",
    institutionId,
    exerciseId,
    aiFeedback: aiFeedback || "",
    aiAlignment,
    coachFeedback: coachFeedback || "",
    additionalObservations: additionalObservations || "",
    finalVerdict: finalVerdict || null,
    status,
    finalizedAt: status === "finalized" ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  };

  if (!snap.empty) {
    const existingRef = doc(db, "coachAssessments", snap.docs[0].id);
    await updateDoc(existingRef, data);
    return { id: snap.docs[0].id, ...data };
  } else {
    data.createdAt = serverTimestamp();
    const newRef = await addDoc(collection(db, "coachAssessments"), data);
    return { id: newRef.id, ...data };
  }
};

/**
 * Save ONLY the final verdict on an existing assessment document.
 */
export const saveFinalCoachVerdict = async (assessmentId, verdict, coachId) => {
  if (!assessmentId) {
    throw new Error("Assessment ID is required to save a final verdict.");
  }
  const docRef = doc(db, "coachAssessments", assessmentId);
  await updateDoc(docRef, {
    finalVerdict: verdict,
    finalVerdictBy: coachId,
    finalVerdictAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/**
 * Finalize an assessment so it becomes the official evaluation for the mobile app.
 */
export const finalizeCoachAssessment = async (assessmentId, coachId) => {
  if (!assessmentId) {
    throw new Error("Assessment ID is required to finalize.");
  }
  const docRef = doc(db, "coachAssessments", assessmentId);
  await updateDoc(docRef, {
    status: "finalized",
    finalizedBy: coachId,
    finalizedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/**
 * Get the final coach verdict for a student (most recent assessment).
 */
export const getFinalCoachVerdict = async (studentId) => {
  const assessment = await getCoachAssessment(studentId);
  return assessment?.finalVerdict || null;
};

