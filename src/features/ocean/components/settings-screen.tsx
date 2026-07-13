import { useState } from "react";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { SEA_OPTIONS, type OceanSnapshot, type SeaId } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";

interface SettingsScreenProps {
  snapshot: OceanSnapshot;
  reduceMotion: boolean;
  onReduceMotionChange: (value: boolean) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onNotice: (message: string) => void;
}

export function SettingsScreen({
  snapshot,
  reduceMotion,
  onReduceMotionChange,
  onSnapshot,
  onNotice,
}: SettingsScreenProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSea = async (seaId: SeaId) => {
    setError(null);
    try {
      onSnapshot(await oceanGateway.updateSea(seaId));
      onNotice(`${SEA_OPTIONS.find((sea) => sea.id === seaId)?.name ?? "새 바다"}에서 병을 건져요.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "바다를 바꾸지 못했어요.");
    }
  };

  const resetDemo = async () => {
    onSnapshot(await oceanGateway.resetDemo());
    setConfirmReset(false);
    onNotice("데모 상태를 처음으로 돌렸어요.");
  };

  return (
    <section className="screen settings-screen">
      <div className="screen-header">
        <p className="eyebrow">내 기기에서만 기억해요</p>
        <PageHeading>설정</PageHeading>
        <p>위치 권한이나 프로필 없이, 어떤 바다에서 건질지만 고를 수 있어요.</p>
      </div>

      {error ? <div className="alert" role="alert">{error}</div> : null}

      <div className="settings-list">
        <section className="setting-section" aria-labelledby="setting-sea-title">
          <div>
            <h2 id="setting-sea-title">병을 건질 바다</h2>
            <p>실제 위치와는 상관없어요. 손에 든 병이 없을 때 바꿀 수 있습니다.</p>
          </div>
          <div className="sea-picker sea-picker--wide" role="radiogroup" aria-labelledby="setting-sea-title">
            {SEA_OPTIONS.map((sea) => (
              <button
                key={sea.id}
                className={snapshot.seaId === sea.id ? "sea-chip sea-chip--selected" : "sea-chip"}
                type="button"
                role="radio"
                aria-checked={snapshot.seaId === sea.id}
                onClick={() => updateSea(sea.id)}
              >
                {sea.name}
              </button>
            ))}
          </div>
        </section>

        <section className="setting-section setting-section--row" aria-labelledby="setting-motion-title">
          <div>
            <h2 id="setting-motion-title">움직임 줄이기</h2>
            <p>잔물결처럼 움직이는 효과를 멈춥니다.</p>
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

        <section className="setting-section setting-section--demo" aria-labelledby="setting-demo-title">
          <div>
            <p className="demo-stamp">DEMO</p>
            <h2 id="setting-demo-title">체험 상태 초기화</h2>
            <p>12시간 기다리지 않고 처음부터 흐름을 다시 확인할 수 있어요.</p>
          </div>
          {confirmReset ? (
            <div className="inline-confirm" role="alertdialog" aria-label="데모 초기화 확인">
              <p>보관 중인 병과 오늘의 이용 상태가 모두 초기화돼요.</p>
              <div>
                <button className="button button--small button--ghost" type="button" onClick={() => setConfirmReset(false)}>
                  취소
                </button>
                <button className="button button--small button--danger" type="button" onClick={resetDemo}>
                  초기화
                </button>
              </div>
            </div>
          ) : (
            <button className="button button--ghost" type="button" onClick={() => setConfirmReset(true)}>
              처음부터 체험하기
            </button>
          )}
        </section>
      </div>
    </section>
  );
}
