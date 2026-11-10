export const DIFFICULTY = { Beginner: { toleranceCents: 50, passMark: 60 }, Intermediate: { toleranceCents: 35, passMark: 70 }, Advanced: { toleranceCents: 25, passMark: 80 } };
export function exerciseFields(data) {
  const seconds = Number(data.durationSeconds ?? data.duration);
  const type = data.exerciseType ?? 'single';
  const frequency = Number(data.targetFrequencyHz ?? data.targetPitchData ?? 440);
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 600) throw new Error('Exercise duration must be a whole number from 3 to 600 seconds.');
  if (!['single', 'scale', 'song', 'free'].includes(type)) throw new Error('Choose a valid practice type.');
  if (!Number.isFinite(frequency) || frequency < 65 || frequency > 1050) throw new Error('Target pitch must be between 65 and 1050 Hz.');
  if (!data.title?.trim()) throw new Error('An exercise title is required.');
  const difficulty = { Beginner: 'Foundations', Intermediate: 'Pitch Training', Advanced: 'Advanced' }[data.tier];
  if (!difficulty) throw new Error('Choose a valid exercise tier.');
  const notes = data.targetNotes ?? [];
  if (!Array.isArray(notes) || notes.length > 3000) throw new Error('Target melody has too many notes.');
  let end = 0;
  for (const n of notes) {
    if (![n.startSeconds, n.endSeconds, n.frequencyHz].every(Number.isFinite) || n.startSeconds < end ||
      n.endSeconds <= n.startSeconds || n.endSeconds > seconds || n.frequencyHz < 65 || n.frequencyHz > 1050)
      throw new Error('Target notes must be ordered, non-overlapping, inside the duration, and between 65 and 1050 Hz.');
    end = n.endSeconds;
  }
  if (['scale', 'song'].includes(type) && (!notes.length || data.targetApproved !== true)) throw new Error('Review and approve the target melody before publishing.');
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const note = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  return { ...data, title: data.title.trim(), duration: seconds, durationSeconds: seconds,
    exerciseType: type, targetNotes: notes, targetVersion: String(data.targetVersion ?? '1'),
    prerequisiteId: data.prerequisiteId || null, ...DIFFICULTY[data.tier],
    targetPitchData: frequency, targetFrequencyHz: frequency, targetNote: note, difficultyLevel: difficulty };
}
export function validatePrerequisite(exerciseId, prerequisiteId, exercises) {
  const byId = new Map(exercises.map(e => [e.id, e]));
  const seen = new Set([exerciseId]); let current = prerequisiteId;
  while (current) {
    if (seen.has(current)) throw new Error('Prerequisites cannot form a loop.');
    seen.add(current);
    if (!byId.has(current)) throw new Error('The selected prerequisite is unavailable. Refresh the exercise list.');
    current = byId.get(current).prerequisiteId;
  }
}
