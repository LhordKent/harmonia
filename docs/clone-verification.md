# Fresh-clone verification

Verified 11 November 2026 using a new clone from `https://github.com/LhordKent/harmonia.git`.

- `setup.ps1 -Android`: npm dependencies installed from the lockfile; Android SDK detected from package metadata; ignored local SDK path generated; clean Android APK build passed (43 tasks executed).
- `npm run build`: passed in the fresh clone.
- Vite startup and real Firebase administrator sign-in: dashboard opened in headless Edge with no browser runtime errors. Credentials were read from outside the repository and were not committed.
- Private audio unit checks: 14 passed, zero failures.
- Both bundled model copies match their pinned SHA-256. Firebase client config, Gradle wrapper and npm lockfile are tracked; build outputs and private credentials are excluded.
- All 18 PDF pages were rendered and visually inspected. Editable source and generator are committed.

This check used installed Node 24, Android Studio Java, SDK Platform 37.0 and available internet/backend services. It does not assert that Git installs operating-system toolchains, that cloud services work offline, or that real-singer accuracy has been established.
