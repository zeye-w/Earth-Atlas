import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { setSplashStage } from "./splash";

// The bundle has arrived: the loading screen moves on to starting the globe.
setSplashStage("globe");

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
