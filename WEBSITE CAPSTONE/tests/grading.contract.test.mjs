import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseFields, validatePrerequisite, DIFFICULTY } from '../src/firebase/exerciseModel.js';
import { normalizeSession, reviewFields, averageScore, scoreVerdict } from '../src/firebase/sessionModel.js';
const base = { title: 'Practice', tier: 'Beginner', duration: 3, targetPitchData: 440 };

test('all difficulty policies match the client rubric', () => {
  assert.deepEqual(Object.values(DIFFICULTY).map(p => [p.toleranceCents, p.passMark]), [[50, 60], [35, 70], [25, 80]]);
});
test('full-song targets require approval and valid ordered notes', () => {
  const song = { ...base, duration: 600, exerciseType: 'song', targetNotes: [{ startSeconds: 0, endSeconds: 600, frequencyHz: 261.63 }], targetApproved: true };
  assert.equal(exerciseFields(song).durationSeconds, 600);
  assert.throws(() => exerciseFields({ ...song, targetApproved: false }));
  assert.throws(() => exerciseFields({ ...song, duration: 601 }));
  assert.throws(() => exerciseFields({ ...song, targetNotes: [{ startSeconds: 0, endSeconds: 3, frequencyHz: 440 }, { startSeconds: 2, endSeconds: 4, frequencyHz: 220 }] }));
});
test('prerequisite cycles and missing prerequisites are rejected', () => {
  assert.throws(() => validatePrerequisite('a', 'b', [{ id: 'b', prerequisiteId: 'a' }]));
  assert.throws(() => validatePrerequisite('a', 'missing', []));
  validatePrerequisite('a', 'b', [{ id: 'b', prerequisiteId: null }]);
});
test('withheld scores remain unavailable and do not lower averages', () => {
  const s = normalizeSession({ accuracyScore: 0, toneScore: 0, gradingEvidence: { status: 'needsRecording', pitchScore: null, toneScore: null } });
  assert.equal(s.pitchAccuracy, null); assert.equal(s.toneAccuracy, null);
  assert.equal(averageScore([s, { pitchAccuracy: 80 }], 'pitchAccuracy'), 80);
  assert.equal(averageScore([s], 'pitchAccuracy'), null);
});
test('coach scores and advancement stay distinct from original evidence', () => {
  const s = normalizeSession({ gradingEvidence: { status: 'scored', pitchScore: 60, toneScore: 80, automaticPassed: true }, coachPitchScore: 75, coachToneScore: 85 });
  assert.equal(s.accuracyScore, 60); assert.equal(s.pitchAccuracy, 75);
  assert.equal(reviewFields({ coachVerdict: 'Good stability', advancementDecision: 'approved' }).advancementDecision, 'approved');
  assert.throws(() => reviewFields({ coachVerdict: 'Good stability', advancementDecision: 'self-approved' }));
});

test('coach correction labels respect the stored difficulty passing mark', () => {
  assert.equal(scoreVerdict(65, 65, 60), 'Good stability');
  assert.equal(scoreVerdict(65, 65, 70), 'Requires improvement');
  assert.equal(scoreVerdict(75, 75, 80), 'Requires improvement');
});
