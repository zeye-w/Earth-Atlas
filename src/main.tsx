import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { introState, setSplashStage } from "./splash";
import { startAnalytics, track } from "./analytics";
import { RECORDING } from "./recording";

// The bundle has arrived: the loading screen moves on to starting the globe.
setSplashStage("globe");

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");
// Anonymous usage statistics (src/analytics.ts); after the first frame, off the critical path.
requestAnimationFrame(() => {
  startAnalytics(RECORDING);
  // What happened on the intro (video, skip, enter…) before and after the app loaded.
  for (const name of introState()?.events ?? []) track("intro", name);
  window.addEventListener("terrascope:intro", (event) => track("intro", (event as CustomEvent<string>).detail));
});
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
