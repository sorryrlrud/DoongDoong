import { useState } from "react";
import { SeaPicker } from "@/features/ocean/components/sea-picker";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { type OceanSnapshot, type SeaId } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";

interface SettingsScreenProps {
  snapshot: OceanSnapshot;
  reduceMotion: boolean;
  onReduceMotionChange: (value: boolean) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
}

export function SettingsScreen({
  snapshot,
  reduceMotion,
  onReduceMotionChange,
  onSnapshot,
}: SettingsScreenProps) {
  const [error, setError] = useState<string | null>(null);

  const updateSea = async (seaId: SeaId) => {
    setError(null);
    try {
      onSnapshot(await oceanGateway.updateSea(seaId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "바다를 바꾸지 못했어요.");
    }
  };

  return (
    <section className="screen settings-screen">
      <div className="screen-header">
        <PageHeading>설정</PageHeading>
      </div>

      {error ? <div className="alert" role="alert">{error}</div> : null}

      <div className="settings-list">
        <section className="setting-section" aria-labelledby="setting-sea-title">
          <div>
            <h2 id="setting-sea-title">병을 건질 바다</h2>
            {snapshot.activeBottle ? <p>손에 든 병을 먼저 보내세요.</p> : null}
          </div>
          <SeaPicker
            value={snapshot.seaId}
            name="settings-sea"
            label="병을 건질 바다"
            wide
            disabled={Boolean(snapshot.activeBottle)}
            onChange={updateSea}
          />
        </section>

        <section className="setting-section setting-section--row" aria-labelledby="setting-motion-title">
          <div>
            <h2 id="setting-motion-title">움직임 줄이기</h2>
          </div>
          <button
            className={reduceMotion ? "toggle toggle--on" : "toggle"}
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            onClick={() => onReduceMotionChange(!reduceMotion)}
          >
            <span aria-hidden="true" />
            <strong>{reduceMotion ? "켬" : "끔"}</strong>
          </button>
        </section>
      </div>
    </section>
  );
}
