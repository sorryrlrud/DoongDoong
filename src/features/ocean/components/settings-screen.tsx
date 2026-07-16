import { useState } from "react";
import { SeaPicker } from "@/features/ocean/components/sea-picker";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { type OceanSnapshot, type SeaId } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";

interface SettingsScreenProps {
  snapshot: OceanSnapshot;
  reduceMotion: boolean;
  onReduceMotionChange: (value: boolean) => void;
  defaultSignature: string;
  autoIncludeDate: boolean;
  onWritingDefaultsChange: (value: {
    defaultSignature: string;
    autoIncludeDate: boolean;
  }) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
}

export function SettingsScreen({
  snapshot,
  reduceMotion,
  onReduceMotionChange,
  defaultSignature,
  autoIncludeDate,
  onWritingDefaultsChange,
  onSnapshot,
}: SettingsScreenProps) {
  const [error, setError] = useState<string | null>(null);

  const updateSea = async (seaId: SeaId) => {
    setError(null);
    try {
      onSnapshot(await oceanGateway.updateSea(seaId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기본 바다를 바꾸지 못했어요.");
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
            <h2 id="setting-sea-title">병을 띄울 기본 바다</h2>
            <p>새 편지를 쓸 때 먼저 선택되는 바다예요. 병은 모든 바다에서 도착해요.</p>
          </div>
          <SeaPicker
            value={snapshot.seaId}
            name="settings-sea"
            label="병을 띄울 기본 바다"
            wide
            onChange={updateSea}
          />
        </section>

        <section className="setting-section" aria-labelledby="setting-writing-title">
          <div>
            <h2 id="setting-writing-title">편지 작성 기본값</h2>
            <p>새 편지를 열 때 자동으로 채울 내용을 정해요.</p>
          </div>
          <div className="writing-defaults">
            <label>
              <span>기본 서명 <small>선택</small></span>
              <input
                type="text"
                value={defaultSignature}
                maxLength={20}
                placeholder="예: 어느 밤의 여행자"
                onChange={(event) => onWritingDefaultsChange({
                  defaultSignature: event.target.value,
                  autoIncludeDate,
                })}
              />
            </label>
            <div className="writing-defaults__date">
              <span>오늘 날짜 자동 입력</span>
              <button
                className={autoIncludeDate ? "toggle toggle--on" : "toggle"}
                type="button"
                role="switch"
                aria-checked={autoIncludeDate}
                onClick={() => onWritingDefaultsChange({
                  defaultSignature,
                  autoIncludeDate: !autoIncludeDate,
                })}
              >
                <span aria-hidden="true" />
                <strong>{autoIncludeDate ? "켬" : "끔"}</strong>
              </button>
            </div>
          </div>
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
