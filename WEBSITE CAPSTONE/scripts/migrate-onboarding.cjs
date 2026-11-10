// Marks existing student, coach and school-administrator accounts as requiring a password change.
//
// Default is a read-only preview. --apply first writes a private backup (outside the repository),
// then updates only the onboarding fields of users/{uid}. Identities, passwords, history, scores and
// assignments are untouched. Platform administrators are left as they are. Re-running is safe:
// accounts that already carry an onboarding baseline are skipped.
const { PROJECT, base, ownerClient, unpack, list, privateBackup } = require('./firebase-owner.cjs');

const ROLES = new Set(['student', 'coach', 'institution']);
const mask = email => (email ? email.replace(/^(.).*(@.*)$/, '$1***$2') : '(no email)');

function plan(users, students, authUsers) {
  const byUid = new Map(authUsers.map(u => [u.uid || u.localId, u]));
  const studentById = new Map(students.map(s => [s.id, s]));
  const updates = []; const preview = [];
  for (const u of users) {
    const identity = byUid.get(u.id);
    const row = { uid: u.id, email: mask(u.email || identity?.email), role: u.role, status: u.status, school: u.institutionId || null };
    if (u.role === 'admin') { preview.push({ ...row, action: 'keep: platform administrator' }); continue; }
    if (!ROLES.has(u.role)) { preview.push({ ...row, action: 'skip: unknown role' }); continue; }
    if (!identity) { preview.push({ ...row, action: 'skip: no Firebase sign-in identity' }); continue; }
    if ('passwordUpdatedAtBaseline' in u || 'mustChangePassword' in u) { preview.push({ ...row, action: 'skip: already migrated' }); continue; }
    const baseline = Number(identity.passwordUpdatedAt || 0);
    const notes = [];
    if (!identity.email) notes.push('no email: recovery impossible until an email is set');
    if (u.role === 'student' && !(u.institutionId || studentById.get(u.id)?.institutionId)) notes.push('unassigned: needs school enrollment by the platform administrator');
    if (u.status !== 'active') notes.push(`status ${u.status}: requirement recorded, access still blocked by status`);
    preview.push({ ...row, action: 'require password change', baseline, notes });
    updates.push({ uid: u.id, baseline });
  }
  return { updates, preview };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { db, auth } = await ownerClient();
  const [usersRaw, studentsRaw, coachesRaw, institutionsRaw, authUsers] = await Promise.all([
    list(db, 'users'), list(db, 'students'), list(db, 'coaches'), list(db, 'institutions'), auth.listUsers(PROJECT, 1000),
  ]);
  const users = usersRaw.map(unpack);
  const { updates, preview } = plan(users, studentsRaw.map(unpack), authUsers);
  console.log(JSON.stringify({ project: PROJECT, mode: apply ? 'apply' : 'preview', accounts: preview,
    summary: { requirePasswordChange: updates.length, untouched: preview.length - updates.length } }, null, 2));
  if (!apply || !updates.length) return;

  const backup = privateBackup('onboarding-migration', {
    users: usersRaw, students: studentsRaw, coaches: coachesRaw, institutions: institutionsRaw,
    authPasswordUpdatedAt: authUsers.map(u => ({ uid: u.uid || u.localId, passwordUpdatedAt: u.passwordUpdatedAt ?? null })),
    plannedUpdates: updates,
  });
  const now = new Date().toISOString();
  const writes = updates.map(({ uid, baseline }) => ({
    update: { name: `${base}/users/${uid}`, fields: {
      mustChangePassword: { booleanValue: true },
      passwordChangeRequiredAt: { timestampValue: now },
      passwordUpdatedAtBaseline: { integerValue: String(baseline) },
      passwordChangedAt: { nullValue: null },
    } },
    updateMask: { fieldPaths: ['mustChangePassword', 'passwordChangeRequiredAt', 'passwordUpdatedAtBaseline', 'passwordChangedAt'] },
    currentDocument: { exists: true },
  }));
  for (let i = 0; i < writes.length; i += 400) {
    await db.post(`/projects/${PROJECT}/databases/(default)/documents:commit`, { writes: writes.slice(i, i + 400) });
  }
  console.log(`Marked ${writes.length} accounts as requiring a password change. Nothing else changed. Backup: ${backup}`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { plan };
