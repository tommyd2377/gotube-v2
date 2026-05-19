# GoTube Agent Instructions

You are working on GoTube, a private one-user YouTube client with a Fire TV APK wrapper.

## Fire TV Update Rule

- For Fire TV APK updates, always update in place with `npm run install:firetv` or `adb install -r apps/firetv/build/outputs/gotube-firetv-debug.apk`.
- Never run `adb uninstall me.thomasdevito.gotube.firetv`, `adb shell pm clear me.thomasdevito.gotube.firetv`, or any equivalent app-storage-clearing command unless Thomas explicitly asks for that exact destructive action.
- Do not clear Fire TV WebView storage, app data, or local storage during normal testing or updates. The private sync key is stored there, and clearing it forces painful re-entry on the TV.

## General Project Rules

- Keep changes narrowly scoped to the requested goal.
- Do not modify secrets, keys, tokens, billing settings, auth providers, production env vars, or deployment configs unless explicitly requested.
- Prefer safe, reversible changes and minimal diffs.
