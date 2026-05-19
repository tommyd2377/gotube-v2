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
adb shell monkey -p me.thomasdevito.gotube.firetv -c android.intent.category.LAUNCHER 1
```

Optional: if you would rather wrap a deployed frontend instead of bundling static assets, build with:

```bash
GOTUBE_TV_URL="https://your-pages.example.com/tv" npm run build:firetv
```

`GOTUBE_API_BASE_URL` is not a secret. The private sync key is still entered in GoTube Settings and stored only in the app's WebView storage.
