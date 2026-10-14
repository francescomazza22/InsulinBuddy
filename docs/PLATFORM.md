# Platform layer

Everything the app needs from the device that differs between a web page and a real iOS app lives behind one object, `platform` (`js/core/platform.js`). The rest of the code never touches `navigator` or a plugin directly for these jobs, so a native build swaps one object.

| Port | Web (today) | Native iOS (planned) |
|---|---|---|
| `files.save` | temporary download link | share sheet / Files (Capacitor Filesystem + Share) |
| `clipboard.copy` | Clipboard API, old-style fallback | Capacitor Clipboard |
| `notifications.schedule/cancel` | unsupported (calendar file is used) | UNUserNotificationCenter local notifications (@capacitor/local-notifications) — fires with the app closed |
| `health.*` | unsupported | HealthKit: write insulin delivery + carbohydrates, read glucose (a Capacitor HealthKit plugin or a small Swift plugin) |
| `biometrics.available` | WebAuthn platform authenticator | LocalAuthentication (Face ID) |
| `haptics.tap` | `navigator.vibrate` where present | UIImpactFeedbackGenerator (@capacitor/haptics) |
| `openLink` | `window.open` | SFSafariViewController / Browser |

Rules: a port never throws; what a platform can't do answers `{ ok:false, reason:"unsupported" }` (or `false`). `capabilities()` says what works so the UI can hide or explain things.

## Using it
- The app builds `platform` once (`createWebPlatform(window)`); a native shell can set `window.__ibPlatform` before the app loads to provide its own.
- Today wired: file export (`downloadText`), copy (`copyText`), and after-meal reminders (scheduled when the platform supports it; no-op on the web, where the calendar file remains the route).
- `createMemoryPlatform({ health:true, notifications:true })` is a recording test double; it also lets you try native behaviour in tests.

## Apple Health as a destination
`js/core/health-target.js` is a `SyncTarget` over `platform.health`, so it plugs into the same offline-safe `Outbox` as Nightscout: meals/corrections become "bolus" insulin samples plus carbohydrate samples, basal doses become "basal" samples; edits replace and deletes remove. It is **not registered on the web** (there `health.available()` is false). To enable it in the native build: create an `Outbox` with `healthTarget(platform)` and add it to `entryTargets` when `platform.health.available()` is true.

## Not done yet (needs the native shell)
Real notifications, HealthKit, Face ID, haptics. These need a Mac, Xcode and an Apple Developer account; the layer above means they are plugin work, not app rewrites.
