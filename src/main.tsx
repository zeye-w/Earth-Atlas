import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { setSplashStage } from "./splash";
import { startAnalytics } from "./analytics";
import { RECORDING } from "./recording";

// The bundle has arrived: the loading screen moves on to starting the globe.
setSplashStage("globe");

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");
// Anonymous usage statistics (src/analytics.ts); after the first frame, off the critical path.
requestAnimationFrame(() => startAnalytics(RECORDING));
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
