import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const rootElement = document.getElementById("root") as HTMLElement;
const splashStartedAt = performance.now();
const minimumSplashMs = 1000;

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

requestAnimationFrame(() => {
  const splash = document.getElementById("boot-splash");
  const remainingSplashMs = Math.max(0, minimumSplashMs - (performance.now() - splashStartedAt));
  window.setTimeout(() => {
    splash?.classList.add("bootSplashHidden");
    window.setTimeout(() => splash?.remove(), 280);
  }, remainingSplashMs);
});
