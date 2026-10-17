# GoTube Fire TV

This is a small native Android wrapper for the existing GoTube `/tv` route. It packages the Vite build into the APK, serves it inside an Android WebView at `https://gotube.local/tv`, and maps Fire TV remote keys to the TV UI's existing keyboard navigation.

Build a sideloadable debug APK:

```bash
GOTUBE_API_BASE_URL="https://your-worker.example.com/api" npm run build:firetv
```

The APK is written to:

```text
apps/firetv/build/outputs/gotube-firetv-debug.apk
```

Install it on a Fire TV with ADB debugging enabled:

```bash
adb connect <fire-tv-ip>:5555
npm run install:firetv
adb shell monkey -p me.thomasdevito.gotube.firetv27 -c android.intent.category.LAUNCHER 1
```

Optional: if you would rather wrap a deployed frontend instead of bundling static assets, build with:

```bash
GOTUBE_TV_URL="https://your-pages.example.com/tv" npm run build:firetv
```

`GOTUBE_API_BASE_URL` is not a secret. The private sync key is still entered in GoTube Settings and stored only in the app's WebView storage.

## Playback compatibility

On Toshiba/Fire TV model `AFTHA004`, the wrapper excludes AV1 capability inside
YouTube embed frames. This addresses reproduced stalls and dropped frames despite
healthy network buffers. YouTube still chooses quality automatically among its
remaining formats; no resolution cap is imposed. An AV1-only format would no
longer be offered on this model.

The rule uses AndroidX WebKit's supported document-start API and is feature gated.
If the installed WebView does not support it, playback continues normally and
`GoTubePlayer` logs that the rule is unavailable. Registration and actual injection
are logged separately. App data, cookies, and the sync key are not cleared.

The APK build downloads checksum-pinned WebKit 1.9.0 and Annotation 1.2.0 artifacts
from Google's Maven repository. Only the document-start API is used; the unused
WebKit asset-loader API (which depends on AndroidX Core) is not used by this wrapper.

Run the compatibility checks with:

```bash
node --test apps/firetv/test/youtube-codec-compat.test.mjs
```

On-device verification must confirm a VP9/AVC stream at Auto quality, low frame
drops, and no repeated buffering on the same video that previously stalled.
