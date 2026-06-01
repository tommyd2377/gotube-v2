import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const rootElement = document.getElementById("root") as HTMLElement;
const splashStartedAt = performance.now();
const minimumSplashMs = 1000;
const isNativeFireTvShell = new URLSearchParams(window.location.search).get("nativeShell") === "firetv";

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const splash = document.getElementById("boot-splash");
if (isNativeFireTvShell) {
  splash?.remove();
} else {
  requestAnimationFrame(() => {
    const remainingSplashMs = Math.max(0, minimumSplashMs - (performance.now() - splashStartedAt));
    window.setTimeout(() => {
      splash?.classList.add("bootSplashHidden");
      window.setTimeout(() => splash?.remove(), 280);
    }, remainingSplashMs);
  });
}
