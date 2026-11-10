# Piece 2 plan: working accounts, enrollment, and Firebase permissions

Prepared 10 November 2026. This document is a plan; application code, account data, and deployed configuration were not changed while preparing it.

## Outcome

An existing authorized admin can sign into the web dashboard, manage a coach/student roster, assign a student to a coach, and have that student sign into Android with the same Firebase UID and institution. An unrelated or inactive account cannot gain access through another query or a restored session. Independent student registration creates consistent profiles without granting institution membership.

Planning allowance: about one focused working day, with a second day available if administrative credentials, incomplete account records, Storage initialization, or emulator setup needs extra work. This is an estimate rather than a completion guarantee.

## Evidence and immediate dependencies

Read-only inspection of project harmonia-47c73 found:

- Five users documents: two admin, one coach, two student; each has status active.
- Zero documents in institutions, coaches, and students in the default Firestore database.
- Deployed Firestore rules include an institution role missing from the local rule copies.
- Deployed users creation rules do not permit student self-registration.
- No firebase.storage rules release was returned by the release lookup. This does not establish that a bucket is absent; Storage needs a separate bucket/configuration check before upload claims.

User documents are not proof that matching Firebase Authentication accounts exist or that passwords are available. Inspect Auth/profile UID alignment before repairing or creating accounts. New Android login correctly requires both active user and student documents, so the missing student records must be addressed for a live student login.

## Decisions to use for the demo

- Keep users/{uid} as the authority for role and account status. Firebase Auth remains the authority for login identity/email.
- Keep students/{uid} and coaches/{uid} as the corresponding application profiles; IDs must equal Auth UIDs.
- Use one confirmed institution for the visible demo. Choose its identifier only after inspecting the existing users' institution links; do not silently assign every account to the code's institution_001 default.
- Preserve the deployed institution role. Creating a new institution-management portal is outside this piece; platform admin and coach are the visible web demo roles.
- Student self-registration creates a student role with null institution and no assigned coach. Staff grants membership and coach assignment. A "collaborated" selection may express intent but cannot authorize membership; update UI wording accordingly.
- Repair and reuse existing authorized demo identities where suitable. Do not reset passwords, promote arbitrary accounts, or duplicate email accounts as part of automatic reconciliation.
- Keep the current local/offline practice behavior after successful login. Cross-restart offline session restoration remains separate.

## Step 1: capture the live baseline and make account repair reviewable

1. Save timestamped deployed Firestore rule source, release ID/hash, available Storage rules, and indexes as rollback evidence.
2. Compare Auth UIDs with users, students, coaches, institution links, and status fields. Collect only the fields needed for reconciliation; keep credentials and unrelated student information out of reports.
3. Produce a dry-run repair manifest: existing record, missing record, proposed fields, and reason. Missing institution assignments or contradictory roles are unresolved data, not permission to invent membership.
4. Confirm the Email/Password provider, existing bucket name/access, and trusted administrative provisioning capability. Firebase CLI project visibility does not prove Firebase Admin SDK credentials are configured.
5. Keep client configuration separate from trusted administration. No downloaded service-account key belongs in React assets, Android resources, or the repository.

Deliverable: a small reconciliation manifest with explicit target project/UIDs and no live writes yet. A privileged provisioning tool must support dry-run, validate its target project, be idempotent, and refuse conflicting existing roles or memberships.

## Step 2: define and enforce the account contract

| Record | Required contract |
| --- | --- |
| Firebase Auth user | UID, actual login email, enabled/disabled state |
| users/{uid} | firstName, lastName, email mirror, role, status, institutionId, timestamps |
| students/{uid} | userId matching UID, name, firstName, lastName, email mirror, status, institutionId, coachId, timestamps |
| coaches/{uid} | userId matching UID, name, firstName, lastName, email mirror, status, institutionId, timestamps |
| institutions/{id} | name, status, contactEmail, timeZone, academicYear, timestamps |

Student names should remain compatible with existing mobile fullName records while new writes use the agreed fields. Do not silently change the Auth email when only a displayed profile email changes.

Create user/profile pairs atomically in Firestore. Assignments must verify an active coach in the same institution. Staff edits to account status or institution must update the authoritative role record and dependent profile consistently. Authentication creation and Firestore writes span services, so provisioning needs explicit partial-failure detection and recovery rather than pretending one Firestore batch makes all services atomic.

Deliverable: shared contract documentation, batched profile writers, and a safe repair/provisioning path for the existing records.

## Step 3: reconcile account and roster permissions

Start with deployed rules so the existing institution role survives. Treat the website deployment path as the canonical source, generate or synchronize the Android copy, and add a check that the copies match.

| Actor | Intended account/roster permissions |
| --- | --- |
| Signed out | No private profiles or roster access |
| Active student | Read own account/profile; edit permitted personal fields; no role/status/membership/coach changes |
| New independent student | Create own consistent student account/profile pair; no institution membership or staff role |
| Active coach | Read own account/profile and assigned students in own institution; no self-promotion or independent reassignment |
| Active institution manager | Manage permitted coach/student records in own institution; no platform-admin creation or cross-institution changes |
| Active platform admin | Perform trusted institution/staff/student administration |
| Inactive/deleted account | Read only the minimum own account status needed to explain denied access; no protected work or roster access |

For self-registration, validate an explicit field allowlist, UID/email consistency, initial role/status, null institution/coach linkage, and both matching documents after the batch. Do not permit a student to recreate a deleted profile to escape the authoritative deleted users record. Registration retries must not rewrite existing staff decisions.

Use document data to constrain both get and list access. Update the relevant client queries in the same change: a broad query followed by JavaScript filtering is insufficient when rules restrict the possible results. Firebase documents this in [secure queries](https://firebase.google.com/docs/firestore/security/rules-query).

Limit this piece's permission rewrite to identity, enrollment, and roster dependencies. Read-only snapshots cover the whole ruleset, but session schema/coach-verdict/storage-write redesign belongs in the next integration piece. Any extra permission needed merely to render the existing dashboard must be solved with a scoped query or an appropriate restricted component, not by broadening staff access.

## Step 4: make web/mobile auth agree with those permissions

1. Apply the same allowed-role/status checks to explicit web login and onAuthStateChanged session restoration. The current restore path does not reject student roles the way explicit login does.
2. Remove the browser first-admin bootstrap from the normal login experience. First-admin setup is a trusted administrative operation, not a public role-creation path.
3. Adapt coach/student queries to the caller. Some current pages request every coach and every session in an institution even for a coach. Avoid making a valid coach dashboard fail because an unrelated secondary collection is forbidden.
4. Keep account-management UI permissions consistent with server rules. Preserve institution-role compatibility without adding its full portal in this piece.
5. Remove the default password 123 from coach/student creation. Use valid account setup inputs and a clear recovery process. Never display a success message unless both identity and required profile setup succeeded.
6. Align signup wording with pending institution assignment. Show an actionable incomplete-profile or inactive-account message; do not turn either condition into a local login.
7. Verify the current registration rollback/cancellation cases against real SDK behavior in emulators. Record incomplete setup for repair if a cancelled request may have committed remotely.

The mobile forgot-password link currently only displays a sent-message dialog. Either connect it to the actual Firebase reset request and truthful result handling in this piece, or remove the false success statement until implemented. Sending a request is distinct from guaranteeing email delivery.

Deliverable: coherent login, enrollment, and account-management behavior with permission errors visible rather than swallowed as empty datasets.

## Step 5: test the policy before applying it to real accounts

Use a dedicated demo-prefixed emulator project, explicit rules loading, seeded fixture data, and @firebase/rules-unit-testing. Use client identities for permission assertions: privileged Admin SDK writes bypass Firestore rules and cannot prove that student/coach rules work. Setup writes may bypass rules only to seed fixtures. See [Firebase emulator testing](https://firebase.google.com/docs/firestore/security/test-rules-emulator).

Required cases:

- Independent signup with matching user/student documents succeeds; arbitrary extra privileged fields, wrong UID, staff role, or self-selected institution fails.
- Partial and conflicting profile creation is rejected; duplicate signup does not overwrite an account.
- A student reads their own records but cannot list another student's private records or change role/status/coach/institution.
- Assigned coach queries succeed; unrelated coach, cross-institution queries, and broad unrestricted queries fail.
- Institution manager administration stays inside its own institution and cannot create admins.
- Deactivation/deletion blocks protected access, including an already authenticated client attempting fresh protected operations.
- Auth/profile missing, stale-cache, wrong-role, and wrong-password paths deny login honestly.
- Web session restoration enforces the same role rules as direct login.
- Provisioning reruns create no duplicates and preserve existing unrelated fields/roles; injected partial failure produces a recoverable report.
- Existing Android auth/progression/reminder tests and web production build still pass.

Deliverable: repeatable emulator command and a concise pass/fail result. Emulator-only tests are not a live login/device verification.

## Step 6: apply the reviewed changes and prove the demo login flow

Only after local implementation and tests are complete:

1. Re-fetch the deployed rule release and the exact target account documents. If they changed since the baseline, merge those changes before applying anything.
2. Repair the confirmed institution/profile links using the dry-run manifest and existing Auth UIDs. Snapshot each existing document before modification; record exactly which documents this operation created or changed.
3. Deploy only the tested account-rule/index changes to the explicitly targeted Harmonia project. Do not bundle Hosting or unrelated Storage changes into this deployment.
4. Use the real web/mobile clients with authorized demo credentials to demonstrate admin login, assigned coach roster, and student mobile login.
5. Test a separate unassigned student and inactive fixture, then restore the fixture to the intended demo state. Avoid modifying unrelated existing accounts.
6. Record release ID, APK/build version, accounts used by role, and observed results. Keep passwords and tokens out of the progress report.

Rollback should restore the previous rules release and only the specific touched account documents. Remove only explicitly created test fixtures; do not delete pre-existing Auth accounts or whole collections. Preserve any legitimate writes made after the change when preparing rollback.

## Definition of done

- Existing authorized admin signs into the web app.
- The confirmed demo institution exists and agrees with account/profile links.
- At least one coach and two student fixtures have matching Auth/user/profile UIDs.
- The assigned student appears in the coach roster, and the unrelated student does not.
- The assigned student signs into Android and obtains the correct name/institution.
- Self-registration either completes as the defined independent flow or reports a specific genuine service error; there are no fake offline accounts.
- Wrong-password, missing-profile, inactive-account, privilege-escalation, and cross-scope tests pass.
- Rule copies agree, emulator tests pass, Android builds, and the web build passes.
- The live smoke-test outcome is recorded separately from automated local tests.

Completion of this piece establishes identity and enrollment. The following piece owns the recording -> upload -> dashboard -> coach correction -> mobile result loop, including session/exercise field normalization, Storage setup/upload paths, retry-safe sync, and owner isolation. Model changes remain outside the login/enrollment critical path.
