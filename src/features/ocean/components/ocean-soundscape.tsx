import { useEffect } from "react";
import { startOceanAmbience, unlockOceanAudio } from "@/features/ocean/services/ocean-audio";

export function OceanSoundscape() {
  useEffect(() => {
    const unlockAudio = () => {
      unlockOceanAudio();
    };

    startOceanAmbience();
    window.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });
    window.addEventListener("touchstart", unlockAudio, { capture: true, passive: true });
    window.addEventListener("keydown", unlockAudio, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio, { capture: true });
      window.removeEventListener("touchstart", unlockAudio, { capture: true });
      window.removeEventListener("keydown", unlockAudio, { capture: true });
    };
  }, []);

  return null;
}
