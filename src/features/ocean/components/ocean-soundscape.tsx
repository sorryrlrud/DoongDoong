import { useEffect } from "react";
import { startOceanAmbience } from "@/features/ocean/services/ocean-audio";

export function OceanSoundscape() {
  useEffect(() => {
    const unlockAudio = () => {
      void startOceanAmbience();
    };

    void startOceanAmbience();
    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  return null;
}
