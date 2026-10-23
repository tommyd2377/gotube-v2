import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const rootElement = document.getElementById("root") as HTMLElement;
const splashStartedAt = performance.now();
const minimumSplashMs = 1000;
const isNativeFireTvShell = new URLSearchParams(window.location.search).get("nativeShell") === "firetv";

const splash = document.getElementById("boot-splash");
if (isNativeFireTvShell) {
  splash?.remove();
} else {
  let closing = false;
  const dismissSplash = () => {
    if (closing) return;
    closing = true;
    window.clearTimeout(fallback);
    window.removeEventListener("gotube:app-ready", dismissSplash);
    const remainingSplashMs = Math.max(0, minimumSplashMs - (performance.now() - splashStartedAt));
    window.setTimeout(() => {
      splash?.classList.add("bootSplashHidden");
      window.setTimeout(() => splash?.remove(), 280);
    }, remainingSplashMs);
  };
  const fallback = window.setTimeout(dismissSplash, 6000);
  window.addEventListener("gotube:app-ready", dismissSplash, { once: true });
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
