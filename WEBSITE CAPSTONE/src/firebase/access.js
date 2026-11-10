export function requireWebProfile(profile) {
  if (!profile) throw new Error("Your account profile is missing. Please contact the administrator.");
  if (profile.status !== "active") throw new Error("This account is inactive. Please contact the administrator.");
  if (!["admin", "institution", "coach"].includes(profile.role)) {
    throw new Error("Students must use the Harmonia mobile application.");
  }
  return {
    ...profile,
    name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Staff member"
  };
}

/**
 * Same state machine as the accounts service: the server profile decides, never a client flag.
 * signedOut | inactive | passwordChangeRequired | enrollmentRequired | ready
 */
export function onboardingState(profile) {
  if (!profile) return "signedOut";
  if (profile.status !== "active") return "inactive";
  if (profile.mustChangePassword === true) return "passwordChangeRequired";
  if (["student", "coach", "institution"].includes(profile.role) && !profile.institutionId) return "enrollmentRequired";
  return "ready";
}

export function requireValidCoach(coach, institutionId) {
  if (!coach || coach.status !== "active" || coach.institutionId !== institutionId) {
    throw new Error("Select an active coach from this institution.");
  }
}
