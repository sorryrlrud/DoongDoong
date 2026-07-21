import { useEffect } from "react";
import { unlockOceanAudio } from "@/features/ocean/services/ocean-audio";

export function OceanSoundscape() {
  useEffect(() => {
    const unlockAudio = () => {
      unlockOceanAudio();
    };

    // Browsers cannot reliably start ambience before a user gesture. Deferring
    // the four audio downloads also keeps the login/LCP network path clear.
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
