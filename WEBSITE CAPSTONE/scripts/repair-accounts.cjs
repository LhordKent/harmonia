// Default is read-only. --apply creates missing records only, guarded by exists:false.
const { PROJECT, base, ownerClient, unpack, createWrite, list, privateBackup } = require('./firebase-owner.cjs');

async function main() {
  const { db, auth } = await ownerClient();
  const [users, students, coaches, institutions, authUsers] = await Promise.all([
    list(db, 'users'), list(db, 'students'), list(db, 'coaches'), list(db, 'institutions'), auth.listUsers(PROJECT, 1000)
  ]);
  const byUid = new Map(authUsers.map(u => [u.uid, u]));
  const existing = new Set([...students, ...coaches, ...institutions].map(d => d.name));
  const writes = []; const ignored = []; const now = new Date().toISOString();
  const memberships = new Set();
  for (const raw of users) {
    const u = unpack(raw); const identity = byUid.get(u.id);
    if (!identity || u.id.trim() !== u.id) { ignored.push({ reason: 'No matching Auth UID', role: u.role }); continue; }
    if (identity.disabled || u.status !== 'active') continue;
    if (u.institutionId) memberships.add(u.institutionId);
    if (!['coach', 'student'].includes(u.role)) continue;
    const collection = u.role === 'coach' ? 'coaches' : 'students';
    const docPath = `${collection}/${u.id}`;
    if (existing.has(`${base}/${docPath}`)) continue;
    const name = u.name || u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ') || identity.displayName;
    if (!name || !identity.email) throw new Error('A profile lacks name/email; manual reconciliation required.');
    const data = {
      userId: u.id, name, firstName: u.firstName || name.split(' ')[0],
      lastName: u.lastName || name.split(' ').slice(1).join(' '), email: identity.email,
      status: u.status, institutionId: u.institutionId || null, createdAt: now, updatedAt: now
    };
    if (u.role === 'student') Object.assign(data, { fullName: name, studentType: u.institutionId ? 'collaborated' : 'independent', coachId: u.coachId || null, badges: [] });
    writes.push(createWrite(docPath, data));
  }
  for (const institutionId of memberships) {
    if (!/^[\w-]+$/.test(institutionId)) throw new Error('Invalid existing institution identifier.');
    if (!existing.has(`${base}/institutions/${institutionId}`)) {
      writes.push(createWrite(`institutions/${institutionId}`, {
        name: 'Harmonia Vocal Studio', status: 'active', contactEmail: '',
        timeZone: 'Asia/Manila', academicYear: '2026-2027', createdAt: now, updatedAt: now
      }));
    }
  }
  console.log(JSON.stringify({ project: PROJECT, mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', creates: writes.map(w => w.update.name.replace(`${base}/`, '')), ignored }, null, 2));
  if (!process.argv.includes('--apply') || !writes.length) return;
  const backup = privateBackup('account-repair', { users, students, coaches, institutions, proposedWrites: writes });
  await db.post(`/projects/${PROJECT}/databases/(default)/documents:commit`, { writes });
  console.log(`Created ${writes.length} missing documents. Existing documents and Auth accounts unchanged. Backup: ${backup}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
