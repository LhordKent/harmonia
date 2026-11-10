# Harmonia private audio

Deployed project: `ztrnmbtdaruyffjqjejz` (Harmonia Audio), Singapore, LhordKent's Free organization.

Project console: https://supabase.com/dashboard/project/ztrnmbtdaruyffjqjejz

Firebase remains the database and identity provider. Android compressed AAC/M4A practice uploads (and legacy WAV uploads) and web reference-audio uploads go through the `audio` Edge Function. Firestore `appConfig/audio` contains only the public endpoint. Client applications never receive the Supabase service-role key.

The function validates Firebase ID tokens with Google's accounts lookup endpoint, requires an active `users` profile, and reads student documents using the caller's token so current Firestore rules decide access. Student upload paths use the verified account UID. Staff can upload reference audio. Only admins can delete files. Playback URLs expire after five minutes; an already issued link remains usable until expiry.

The `harmonia-audio` bucket is private, with no anonymous or authenticated Storage access policies. Objects are immutable (no upserts). Stable attempt IDs allow a lost-response retry without overwriting a recording. The per-file limit is 8 MiB. Current Android capture supports up to ten minutes and encodes AAC-LC M4A at 64 kbps mono before upload; legacy WAV is still accepted. An oversized file remains local and unsynced. This is a per-file cap, not an account-wide quota.

## Verify

From the workspace root:

```powershell
node --test supabase/tests/audio.test.mjs
```

From `WEBSITE CAPSTONE`:

```powershell
npm test
npm run build
node scripts/live-audio-smoke.mjs https://ztrnmbtdaruyffjqjejz.supabase.co/functions/v1/audio
```

The live smoke test uses the existing Firebase CLI owner login to create isolated temporary accounts/documents. It checks real upload/download bytes, authorization, the actual web audio service, retries and assignment changes. It deletes its temporary audio objects, documents and identities in `finally`. It does not test a physical Android microphone.

## Deploy subsequent changes

Use the connected Supabase integration to apply the migration and deploy both files in `functions/audio`. Alternatively, with an authenticated Supabase CLI, run from the workspace root:

```powershell
supabase db push --linked
supabase functions deploy audio --project-ref ztrnmbtdaruyffjqjejz --no-verify-jwt
```

The database command requires `supabase link --project-ref ztrnmbtdaruyffjqjejz` first. The Edge Function performs Firebase authentication itself, so Supabase JWT verification must be disabled for this function. The hosted runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically; do not put them in either application's configuration.

After deploying the function, run from `WEBSITE CAPSTONE`:

```powershell
node scripts/configure-audio.cjs https://ztrnmbtdaruyffjqjejz.supabase.co/functions/v1/audio
firebase deploy --only firestore:rules,hosting --project harmonia-47c73
```

The configuration script backs up the previous document outside the workspace before changing it. Build the website before deploying Hosting. Keep both checked-in Firestore rule copies identical.

The Free plan has limited storage/bandwidth and may pause a project after low activity. Check project availability and rehearse uploads/playback before the defense. No Firebase billing upgrade is required for this design.
