export const SESSION_VERDICTS = ['Excellent accuracy', 'Good stability', 'Requires improvement'];
export const scoreVerdict = (pitch, tone, passMark = 70) => pitch >= 85 && tone >= 85 ? SESSION_VERDICTS[0]
  : pitch >= passMark && tone >= passMark ? SESSION_VERDICTS[1] : SESSION_VERDICTS[2];
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
export function normalizeSession(session) {
  const evidence = session.gradingEvidence;
  const originalPitch = evidence ? (score(evidence.pitchScore) ? evidence.pitchScore : null) : score(session.accuracyScore) ? session.accuracyScore : score(session.pitchAccuracy) ? session.pitchAccuracy : 0;
  const originalTone = evidence ? (score(evidence.toneScore) ? evidence.toneScore : null) : score(session.toneScore) ? session.toneScore : score(session.toneAccuracy) ? session.toneAccuracy : 0;
  const time = session.timestamp ?? session.createdAt;
  const millis = typeof time?.toMillis === 'function' ? time.toMillis() : time;
  const date = millis == null ? null : new Date(millis);
  return { ...session, accuracyScore: originalPitch, toneScore: originalTone,
    pitchAccuracy: score(session.coachPitchScore) ? session.coachPitchScore : originalPitch,
    toneAccuracy: score(session.coachToneScore) ? session.coachToneScore : originalTone,
    audioStorageRef: session.audioStorageRef || session.audioStoragePath,
    timestamp: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    aiVerdict: evidence ? (evidence.status !== 'scored' ? 'No automatic pass recommendation' : evidence.automaticPassed ? 'Good stability' : 'Requires improvement') : session.aiVerdict || scoreVerdict(originalPitch, originalTone),
  };
}
export function reviewFields(data) {
  if (!SESSION_VERDICTS.includes(data.coachVerdict)) throw new Error('Choose a valid coach verdict.');
  const pitch = data.coachPitchScore ?? null, tone = data.coachToneScore ?? null;
  if ((pitch !== null || tone !== null) && (!score(pitch) || !score(tone))) throw new Error('Both corrected scores must be between 0 and 100.');
  const feedback = data.coachFeedback ?? '';
  if (typeof feedback !== 'string' || feedback.length > 4000) throw new Error('Coach feedback must be at most 4000 characters.');
  if (data.advancementDecision != null && !['approved', 'repeat'].includes(data.advancementDecision)) throw new Error('Choose approve advancement or request repeat.');
  return { coachVerdict: data.coachVerdict, coachFeedback: feedback, coachPitchScore: pitch, coachToneScore: tone, verdictStatus: 'reviewed',
    ...(data.advancementDecision != null ? { advancementDecision: data.advancementDecision } : {}) };
}

export function averageScore(sessions, field) {
  const values = sessions.map(s => s[field]).filter(v => typeof v === 'number' && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
export const hasBothScores = s => typeof s.pitchAccuracy === 'number' && Number.isFinite(s.pitchAccuracy) && typeof s.toneAccuracy === 'number' && Number.isFinite(s.toneAccuracy);
