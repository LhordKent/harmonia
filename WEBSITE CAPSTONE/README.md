# Harmonia staff portal

React/Vite website for active coaches, institution managers and administrators. Students use Android. See [the repository quick start](../README.md) and [the plain-language defense guide](../output/pdf/harmonia-defense-cheatsheet.pdf).

## Start

Install Node.js 24 LTS, then `npm ci` and `npm run dev` here. Or run `setup.ps1 -StartWeb` from the repository root. Firebase client configuration is already included; no environment file or cloud owner session is needed to run the client. Sign in with your own authorized application account.

## Current architecture

Firebase Authentication identifies users; Firestore holds shared exercises, assignments and review records. Private audio goes through the Supabase audio function, not Firebase Storage. ONNX Runtime Web 1.23.2 runs the same pinned SwiftF0 pitch model as Android to propose timed reference notes; coaches must review and approve scale/song targets. No browser training or paid inference API is used.

Coaches can listen to assigned students' attempts and save corrections. Explicit advancement approval is separate from confirming a score or writing a general assessment. Missing grades remain unavailable; experimental tone indicators are not a validated artistic assessment.

## Checks

`npm run build`, `npm run lint`, and `npm test`. Emulator tests require Java and an installed Firebase CLI. Browser/native/live checks have additional dependencies documented in `../HarmoniaAppMobile/docs/ai-validation.md`. Live administrative scripts require separately authorized Firebase owner access and must be invoked deliberately.

## Hosting

Build first, then an authorized maintainer can run `firebase deploy --only firestore:rules,hosting --project harmonia-47c73`. Keep the Firestore rules copy in the mobile directory identical. The storage rules file is retained as configuration history, not a claim that Firebase Storage handles current audio.
