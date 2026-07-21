import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/app";
import { OceanSoundscape } from "@/features/ocean/components/ocean-soundscape";
import "@/styles/globals.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: "none",
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OceanSoundscape />
    <App />
  </StrictMode>,
);
