import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  AdminDashboard,
  AdminAuthInfo,
  AdminGateway,
  AdminMessageStatus,
  AdminReportPage,
  AdminReportReason,
  AdminReportResolution,
  AdminResetDirection,
  AdminUserStatus,
  AdminUsageMetric,
} from "@/features/admin/types/admin";
import { PageHeading } from "@/shared/page-heading";

interface AdminScreenProps {
  gateway: AdminGateway | null;
  onExit: () => void;
}

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatReceiveCooldown = (nextCatchAt: string | null, now: number): string => {
  if (!nextCatchAt) return "수신 가능";

  const remainingMilliseconds = new Date(nextCatchAt).getTime() - now;
  if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0) return "수신 가능";

  const remainingMinutes = Math.ceil(remainingMilliseconds / 60_000);
  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) return `${days}일 ${hours}시간 남음`;
  if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
  return `${minutes}분 남음`;
};

const isPermissionError = (message: string): boolean =>
  message.includes("ADMIN_REQUIRED") || message.includes("관리자 권한");

const getErrorMessage = (caught: unknown): string => {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "object" && caught && "message" in caught) {
    const message = (caught as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "관리자 데이터를 불러오지 못했습니다.";
};

const STATUS_LABELS: Record<Exclude<AdminMessageStatus, "all">, string> = {
  drifting: "표류중",
  available: "도달 가능",
  delivered: "도달함",
  kept: "보관중",
  deleted: "삭제됨",
  reported: "신고됨",
};

const REPORT_REASON_LABELS: Record<AdminReportReason, string> = {
  personal_info: "개인정보",
  sexual: "성적 콘텐츠",
  hate: "혐오 표현",
  harassment: "괴롭힘",
  self_harm: "자해·자살 위험",
  spam: "스팸",
  other: "기타",
};

const REPORT_RESOLUTION_LABELS: Record<AdminReportResolution, string> = {
  dismiss_and_redrift: "신고 기각 후 재표류",
  remove_message: "메시지 삭제",
  remove_and_suspend_author: "메시지 삭제 및 작성자 정지",
  remove_and_ban_author: "메시지 삭제 및 작성자 차단",
};

const USER_STATUS_LABELS: Record<AdminUserStatus, string> = {
  active: "활성화",
  suspended: "정지",
  banned: "차단",
};

const REPORT_PAGE_SIZE = 50;

const formatUsageValue = (value: number, unit: AdminUsageMetric["unit"]): string => {
  if (unit === "bytes") {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }
  if (unit === "characters") return `${value.toLocaleString()}자`;
  return value.toLocaleString();
};

const usagePercent = ({ used, limit }: AdminUsageMetric): number =>
  limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;

interface UsageCardProps {
  label: string;
  metric: AdminUsageMetric;
  note: string;
}

function UsageCard({ label, metric, note }: UsageCardProps) {
  const percent = usagePercent(metric);
  const remaining = Math.max(0, metric.limit - metric.used);

  return (
    <article className="admin-usage-card">
      <header>
        <span>{label}</span>
        <strong>{percent.toFixed(percent < 1 && percent > 0 ? 1 : 0)}%</strong>
      </header>
      <div
        className="admin-usage-card__meter"
        role="progressbar"
        aria-label={`${label} 사용률`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl>
        <div><dt>사용</dt><dd>{formatUsageValue(metric.used, metric.unit)}</dd></div>
        <div><dt>남음</dt><dd>{formatUsageValue(remaining, metric.unit)}</dd></div>
        <div><dt>무료 한도</dt><dd>{formatUsageValue(metric.limit, metric.unit)}</dd></div>
      </dl>
      <p>{note}</p>
    </article>
  );
}

interface ActionFeedback {
  kind: "success" | "error";
  message: string;
}

export function AdminScreen({ gateway, onExit }: AdminScreenProps) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [reportPage, setReportPage] = useState<AdminReportPage | null>(null);
  const [authInfo, setAuthInfo] = useState<AdminAuthInfo | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminMessageStatus>("all");
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsLoadingMore, setReportsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsMoreError, setReportsMoreError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const loadDashboard = useCallback(async (
    nextQuery: string,
    nextStatus: AdminMessageStatus,
  ) => {
    if (!gateway) {
      setError("관리자 페이지는 Supabase 운영 환경에서만 사용할 수 있습니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await gateway.getDashboard({ query: nextQuery, status: nextStatus });
      setDashboard(result);
    } catch (caught) {
      setDashboard(null);
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  const refreshDashboard = useCallback(async (
    nextQuery: string,
    nextStatus: AdminMessageStatus,
  ) => {
    if (!gateway) throw new Error("관리자 페이지는 Supabase 운영 환경에서만 사용할 수 있습니다.");
    const result = await gateway.getDashboard({ query: nextQuery, status: nextStatus });
    setDashboard(result);
  }, [gateway]);

  const loadReports = useCallback(async () => {
    if (!gateway) {
      setReportPage(null);
      setReportsError("관리자 페이지는 Supabase 운영 환경에서만 사용할 수 있습니다.");
      setReportsLoading(false);
      setReportsLoadingMore(false);
      return;
    }

    setReportsLoading(true);
    setReportsError(null);
    setReportsMoreError(null);
    try {
      setReportPage(await gateway.listReports({ status: "open", limit: REPORT_PAGE_SIZE }));
    } catch (caught) {
      setReportPage(null);
      setReportsError(getErrorMessage(caught));
    } finally {
      setReportsLoading(false);
    }
  }, [gateway]);

  const refreshReports = useCallback(async () => {
    if (!gateway) throw new Error("관리자 페이지는 Supabase 운영 환경에서만 사용할 수 있습니다.");
    setReportPage(await gateway.listReports({ status: "open", limit: REPORT_PAGE_SIZE }));
    setReportsError(null);
    setReportsMoreError(null);
  }, [gateway]);

  const loadMoreReports = useCallback(async () => {
    const cursor = reportPage?.nextCursor;
    if (!gateway || !cursor || reportsLoadingMore) return;

    setReportsLoadingMore(true);
    setReportsMoreError(null);
    try {
      const nextPage = await gateway.listReports({
        status: "open",
        limit: REPORT_PAGE_SIZE,
        cursor,
      });
      setReportPage((current) => {
        if (!current || current.nextCursor !== cursor) return current;
        const reportIds = new Set(current.reports.map((report) => report.reportId));
        return {
          reports: [
            ...current.reports,
            ...nextPage.reports.filter((report) => !reportIds.has(report.reportId)),
          ],
          nextCursor: nextPage.nextCursor,
        };
      });
    } catch (caught) {
      setReportsMoreError(getErrorMessage(caught));
    } finally {
      setReportsLoadingMore(false);
    }
  }, [gateway, reportPage?.nextCursor, reportsLoadingMore]);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      if (gateway) {
        try {
          const nextAuthInfo = await gateway.getAuthInfo();
          if (active) setAuthInfo(nextAuthInfo);
        } catch {
          // The dashboard request below provides the actionable error state.
        }
      }
      if (active) await loadDashboard("", "all");
      if (active) void loadReports();
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [gateway, loadDashboard, loadReports]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadDashboard(query, status);
  };

  const runAction = async (
    key: string,
    action: () => Promise<void>,
    successMessage: string,
  ) => {
    if (actionKey) return;
    setActionKey(key);
    setActionFeedback(null);
    try {
      await action();
      // Keep the current table mounted while refreshing after a row action.
      // Reusing loadDashboard here used to toggle the page-level loading state,
      // which made adjacent controls flicker or disappear during a reset.
      await Promise.all([
        refreshDashboard(query, status),
        refreshReports(),
      ]);
      setActionFeedback({ kind: "success", message: successMessage });
    } catch (caught) {
      setActionFeedback({ kind: "error", message: getErrorMessage(caught) });
    } finally {
      setActionKey(null);
    }
  };

  const resetUser = (
    userId: string,
    direction: AdminResetDirection,
  ) => {
    if (!gateway) return;
    if (direction === "receive" && !window.confirm(
      "수신 제한을 초기화하면 현재 도달한 병은 다시 도달 가능한 상태가 됩니다. 계속할까요?",
    )) return;
    const label = direction === "send" ? "발신" : "수신";
    void runAction(
      `reset-${direction}-${userId}`,
      () => gateway.resetUserLimits(userId, direction),
      `${label} 제한을 초기화했습니다.`,
    );
  };

  const deleteUser = (userId: string) => {
    if (!gateway || !window.confirm(
      `사용자 ${userId}의 계정·프로필·기기 구독·차단 관계를 삭제할까요? 유통 중인 편지의 본문과 번역은 다른 이용자의 경험을 위해 남을 수 있지만, 작성자 연결 정보·국가·서명·날짜 표시는 제거됩니다. 이 작업은 되돌릴 수 없습니다.`,
    )) return;
    void runAction(
      `delete-${userId}`,
      () => gateway.deleteUser(userId),
      "계정 개인정보를 삭제하고 유통 중인 편지를 비식별화했습니다.",
    );
  };

  const updateUserStatus = (userId: string, nextStatus: AdminUserStatus) => {
    if (!gateway) return;
    const actionLabel = USER_STATUS_LABELS[nextStatus];
    const reason = window.prompt(`${actionLabel} 사유를 기록하세요. 비워 두면 사유 없이 감사 로그에 남습니다.`, "");
    if (reason === null || !window.confirm(
      `사용자 ${userId}를 ${actionLabel} 상태로 변경할까요?`,
    )) return;
    void runAction(
      `status-${nextStatus}-${userId}`,
      () => gateway.updateUserStatus(userId, nextStatus, reason),
      `사용자 상태를 ${actionLabel}했습니다.`,
    );
  };

  const resolveReport = (reportId: string, resolution: AdminReportResolution) => {
    if (!gateway) return;
    const actionLabel = REPORT_RESOLUTION_LABELS[resolution];
    const note = window.prompt(`${actionLabel} 처리 메모를 기록하세요. 비워 둘 수 있습니다.`, "");
    if (note === null || !window.confirm(
      `이 신고를 “${actionLabel}”로 처리할까요? 이 작업은 신고 기록과 감사 로그에 남습니다.`,
    )) return;
    void runAction(
      `report-${resolution}-${reportId}`,
      () => gateway.resolveReport(reportId, resolution, note),
      `신고를 ${actionLabel}로 처리했습니다.`,
    );
  };

  const makeMessageAvailable = (messageId: string) => {
    if (!gateway) return;
    void runAction(
      `available-${messageId}`,
      () => gateway.makeMessageAvailable(messageId),
      "메시지를 지금 도달 가능한 상태로 변경했습니다.",
    );
  };

  const deleteMessage = (messageId: string) => {
    if (!gateway || !window.confirm(
      `메시지 ${messageId}를 데이터베이스에서 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
    )) return;
    void runAction(
      `delete-message-${messageId}`,
      () => gateway.deleteMessage(messageId),
      "메시지를 완전히 삭제했습니다.",
    );
  };

  if (error && isPermissionError(error)) {
    return (
      <main className="admin-access">
        <section className="admin-access__card">
          <p className="admin-kicker">DOONGDOONG ADMIN</p>
          <PageHeading>관리자 권한이 필요합니다</PageHeading>
          {authInfo ? (
            <>
              <p>소셜 로그인을 확인했습니다. 이 UID에 관리자 역할을 부여하면 됩니다.</p>
              <code>{authInfo.userId}</code>
              <pre>{`insert into public.users (id, role)
values ('${authInfo.userId}', 'admin')
on conflict (id) do update
set role = 'admin', status = 'active', deleted_at = null;`}</pre>
            </>
          ) : (
            <p>로그인 정보를 확인한 뒤 다시 시도해 주세요.</p>
          )}
          <div className="admin-access__actions">
            <button className="button button--primary" type="button" onClick={() => void loadDashboard(query, status)}>
              권한 다시 확인
            </button>
            <button className="button button--ghost" type="button" onClick={onExit}>
              바다로 돌아가기
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="admin-kicker">DOONGDOONG ADMIN</p>
          <PageHeading>운영 현황</PageHeading>
          <p>사용자와 병편지 상태를 확인하고 운영 작업을 수행합니다.</p>
        </div>
        <button className="button button--ghost button--small" type="button" onClick={onExit}>
          바다로 돌아가기
        </button>
      </header>

      {loading && !dashboard ? <p className="admin-state">관리자 데이터를 불러오는 중…</p> : null}
      {error && !isPermissionError(error) ? (
        <section className="admin-state admin-state--error">
          <strong>데이터를 불러오지 못했습니다.</strong>
          <p>{error}</p>
          <button className="button button--small" type="button" onClick={() => void loadDashboard(query, status)}>
            다시 시도
          </button>
        </section>
      ) : null}

      {dashboard ? (
        <>
          <section className="admin-stats" aria-label="서비스 통계">
            <article><span>전체 사용자</span><strong>{dashboard.stats.totalUsers.toLocaleString()}</strong></article>
            <article><span>전체 메시지</span><strong>{dashboard.stats.totalMessages.toLocaleString()}</strong></article>
            <article><span>오늘 메시지</span><strong>{dashboard.stats.messagesToday.toLocaleString()}</strong></article>
            <article><span>표류 중</span><strong>{dashboard.stats.driftingMessages.toLocaleString()}</strong></article>
            <article><span>도달 가능</span><strong>{dashboard.stats.availableMessages.toLocaleString()}</strong></article>
            <article><span>도달함</span><strong>{dashboard.stats.deliveredMessages.toLocaleString()}</strong></article>
            <article className="admin-stat--alert"><span>신고됨</span><strong>{dashboard.stats.reportedMessages.toLocaleString()}</strong></article>
            <article><span>삭제 사용자</span><strong>{dashboard.stats.deletedUsers.toLocaleString()}</strong></article>
          </section>

          <section className="admin-section" aria-labelledby="admin-reports-title">
            <div className="admin-section__heading">
              <div>
                <h2 id="admin-reports-title">신고 검토</h2>
                <span>열린 신고를 검토하고 편지·작성자 조치를 한 번에 기록합니다.</span>
              </div>
              <span>{reportPage?.reports.length ?? 0}건 표시</span>
            </div>
            {reportsLoading ? <p className="admin-state" role="status">신고 목록을 불러오는 중…</p> : null}
            {reportsError ? (
              <section className="admin-state admin-state--error" role="alert">
                <strong>신고 목록을 불러오지 못했습니다.</strong>
                <p>{reportsError}</p>
                <button className="button button--small" type="button" onClick={() => void loadReports()}>
                  다시 시도
                </button>
              </section>
            ) : null}
            {reportPage && !reportsLoading ? (
              <div className="admin-message-list">
                {reportPage.reports.map((report) => (
                  <article className="admin-message admin-message--alert" key={report.reportId}>
                    <header>
                      <span className="admin-badge admin-badge--reported">신고 검토</span>
                      <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
                      <strong>{REPORT_REASON_LABELS[report.reason]}</strong>
                    </header>
                    <p>{report.message.body}</p>
                    {report.message.signature ? <blockquote>서명: {report.message.signature}</blockquote> : null}
                    <dl>
                      <div><dt>신고 ID</dt><dd><code>{report.reportId}</code></dd></div>
                      <div><dt>메시지 ID</dt><dd><code>{report.messageId}</code></dd></div>
                      <div><dt>신고자 UID</dt><dd><code>{report.reporterId ?? "-"}</code></dd></div>
                      <div><dt>작성자 UID</dt><dd><code>{report.authorId ?? "-"}</code></dd></div>
                      <div><dt>메시지 상태</dt><dd>{STATUS_LABELS[report.message.status]}</dd></div>
                      <div>
                        <dt>누적 사유</dt>
                        <dd>{Object.entries(report.reasonCounts)
                          .map(([reason, count]) => `${REPORT_REASON_LABELS[reason as AdminReportReason] ?? reason} ${count}`)
                          .join(" · ") || "-"}
                        </dd>
                      </div>
                    </dl>
                    <div className="admin-message__actions">
                      <button
                        className="button button--ghost button--small"
                        type="button"
                        disabled={actionKey !== null || reportsLoadingMore}
                        onClick={() => resolveReport(report.reportId, "dismiss_and_redrift")}
                      >
                        기각·재표류
                      </button>
                      <button
                        className="button button--danger button--small"
                        type="button"
                        disabled={actionKey !== null || reportsLoadingMore}
                        onClick={() => resolveReport(report.reportId, "remove_message")}
                      >
                        메시지 삭제
                      </button>
                      <button
                        className="button button--danger button--small"
                        type="button"
                        disabled={actionKey !== null || reportsLoadingMore || report.authorId === null}
                        onClick={() => resolveReport(report.reportId, "remove_and_suspend_author")}
                      >
                        삭제·정지
                      </button>
                      <button
                        className="button button--danger button--small"
                        type="button"
                        disabled={actionKey !== null || reportsLoadingMore || report.authorId === null}
                        onClick={() => resolveReport(report.reportId, "remove_and_ban_author")}
                      >
                        삭제·차단
                      </button>
                    </div>
                  </article>
                ))}
                {reportPage.reports.length === 0 ? <p className="admin-empty">열린 신고가 없습니다.</p> : null}
                {reportsMoreError ? (
                  <div className="admin-state admin-state--error" role="alert">
                    <strong>다음 신고 목록을 불러오지 못했습니다.</strong>
                    <p>{reportsMoreError}</p>
                    <button
                      className="button button--small"
                      type="button"
                      disabled={actionKey !== null || reportsLoadingMore}
                      onClick={() => void loadMoreReports()}
                    >
                      더 보기 다시 시도
                    </button>
                  </div>
                ) : null}
                {reportPage.nextCursor && !reportsMoreError ? (
                  <div className="admin-message__actions">
                    <button
                      className="button button--ghost button--small"
                      type="button"
                      disabled={actionKey !== null || reportsLoadingMore}
                      onClick={() => void loadMoreReports()}
                    >
                      {reportsLoadingMore ? "신고를 더 불러오는 중…" : "신고 더 보기"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="admin-usage" aria-labelledby="admin-usage-title">
            <div className="admin-section__heading">
              <div>
                <h2 id="admin-usage-title">무료 티어 사용량</h2>
                <p>측정 시각 {formatDate(dashboard.usage.measuredAt)}</p>
              </div>
              <span>월간 항목은 매월 1일(UTC) 초기화</span>
            </div>
            <div className="admin-usage__group">
              <h3>Supabase</h3>
              <div className="admin-usage__grid">
                <UsageCard label="Database" metric={dashboard.usage.supabase.databaseSize} note="현재 PostgreSQL 전체 크기" />
                <UsageCard label="월간 활성 사용자" metric={dashboard.usage.supabase.monthlyActiveUsers} note="이번 달 로그인 기록 기준 추정치" />
                <UsageCard label="Storage" metric={dashboard.usage.supabase.storageSize} note="Storage 객체 메타데이터 합계" />
                <UsageCard label="Edge Function" metric={dashboard.usage.supabase.edgeFunctionInvocations} note="앱에서 추적한 번역 함수 호출" />
              </div>
            </div>
            <div className="admin-usage__group">
              <h3>Azure Translator</h3>
              <div className="admin-usage__grid admin-usage__grid--azure">
                <UsageCard label="번역 문자" metric={dashboard.usage.azureTranslator.translatedCharacters} note="성공한 API 요청의 원문 문자 합계" />
              </div>
            </div>
          </section>

          <form className="admin-filters" onSubmit={submitSearch}>
            <label>
              UID 또는 메시지 ID
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="UUID 전체 또는 일부"
              />
            </label>
            <label>
              메시지 상태
              <select
                value={status}
                onChange={(event) => {
                  const nextStatus = event.target.value as AdminMessageStatus;
                  setStatus(nextStatus);
                  void loadDashboard(query, nextStatus);
                }}
              >
                <option value="all">전체</option>
                <option value="drifting">표류 중</option>
                <option value="available">도달 가능</option>
                <option value="delivered">도달함</option>
                <option value="kept">보관 중</option>
                <option value="deleted">삭제됨</option>
                <option value="reported">신고됨</option>
              </select>
            </label>
            <button className="button button--primary button--small" type="submit" disabled={loading}>
              {loading ? "조회 중…" : "조회"}
            </button>
          </form>

          {actionFeedback ? (
            <div
              className={`admin-action-feedback admin-action-feedback--${actionFeedback.kind}`}
              role={actionFeedback.kind === "error" ? "alert" : "status"}
            >
              {actionFeedback.message}
            </div>
          ) : null}

          <section className="admin-section">
            <div className="admin-section__heading">
              <h2>사용자</h2>
              <span>{dashboard.users.length}명 표시</span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>UID</th><th>상태</th><th>국가</th><th>기본 서명</th><th>발송</th><th>수신 가능 쿨타임</th><th>작성 메시지</th><th>가입일</th><th>관리</th></tr></thead>
                <tbody>
                  {dashboard.users.map((user) => (
                    <tr key={user.id}>
                      <td><code>{user.id}</code>{user.role === "admin" ? <small>ADMIN</small> : null}</td>
                      <td>{user.status}</td>
                      <td>{user.countryCode ?? "-"}</td>
                      <td>{user.defaultSignature ?? "-"}</td>
                      <td>{user.dailySendCount}/2</td>
                      <td title={user.nextCatchAt ? formatDate(user.nextCatchAt) : undefined}>
                        {formatReceiveCooldown(user.nextCatchAt, currentTime)}
                      </td>
                      <td>{user.authoredMessageCount}</td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            className="button button--ghost button--tiny"
                            type="button"
                            disabled={user.status === "deleted" || actionKey !== null}
                            onClick={(event) => {
                              event.currentTarget.blur();
                              resetUser(user.id, "send");
                            }}
                          >
                            발신 초기화
                          </button>
                          <button
                            className="button button--ghost button--tiny"
                            type="button"
                            disabled={user.status === "deleted" || actionKey !== null}
                            onClick={(event) => {
                              event.currentTarget.blur();
                              resetUser(user.id, "receive");
                            }}
                          >
                            수신 초기화
                          </button>
                          {user.status !== "active" ? (
                            <button
                              className="button button--ghost button--tiny"
                              type="button"
                              disabled={
                                actionKey !== null
                                || user.role === "admin"
                                || user.id === authInfo?.userId
                              }
                              onClick={(event) => {
                                event.currentTarget.blur();
                                updateUserStatus(user.id, "active");
                              }}
                            >
                              활성화
                            </button>
                          ) : null}
                          {user.status !== "suspended" ? (
                            <button
                              className="button button--ghost button--tiny"
                              type="button"
                              disabled={
                                actionKey !== null
                                || user.role === "admin"
                                || user.id === authInfo?.userId
                              }
                              onClick={(event) => {
                                event.currentTarget.blur();
                                updateUserStatus(user.id, "suspended");
                              }}
                            >
                              정지
                            </button>
                          ) : null}
                          {user.status !== "banned" ? (
                            <button
                              className="button button--danger button--tiny"
                              type="button"
                              disabled={
                                actionKey !== null
                                || user.role === "admin"
                                || user.id === authInfo?.userId
                              }
                              onClick={(event) => {
                                event.currentTarget.blur();
                                updateUserStatus(user.id, "banned");
                              }}
                            >
                              차단
                            </button>
                          ) : null}
                          <button
                            className="button button--danger button--tiny"
                            type="button"
                            disabled={
                              actionKey !== null
                              || user.status === "deleted"
                              || user.role === "admin"
                              || user.id === authInfo?.userId
                            }
                            onClick={(event) => {
                              event.currentTarget.blur();
                              deleteUser(user.id);
                            }}
                          >
                            완전 삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dashboard.users.length === 0 ? <tr><td colSpan={9}>조건에 맞는 사용자가 없습니다.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-section">
            <div className="admin-section__heading">
              <h2>메시지</h2>
              <span>{dashboard.messages.length}개 표시 · 최근순</span>
            </div>
            <div className="admin-message-list">
              {dashboard.messages.map((message) => (
                <article className={message.status === "reported" ? "admin-message admin-message--alert" : "admin-message"} key={message.id}>
                  <header>
                    <span className={`admin-badge admin-badge--${message.status}`}>
                      {STATUS_LABELS[message.status as Exclude<AdminMessageStatus, "all">] ?? message.status}
                    </span>
                    <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    {message.reportCount > 0 ? <strong>신고 {message.reportCount}</strong> : null}
                  </header>
                  <p>{message.body}</p>
                  {message.signature ? <blockquote>서명: {message.signature}</blockquote> : null}
                  <dl>
                    <div><dt>메시지 ID</dt><dd><code>{message.id}</code></dd></div>
                    <div><dt>발신 UID</dt><dd><code>{message.authorUid}</code></dd></div>
                    <div><dt>수신 UID</dt><dd><code>{message.recipientUid ?? "-"}</code></dd></div>
                    <div><dt>마지막 띄운 UID</dt><dd><code>{message.lastDriftedByUid ?? "-"}</code></dd></div>
                    <div><dt>바다</dt><dd>{message.seaId}</dd></div>
                    {message.status === "drifting" && message.availableAt ? (
                      <div><dt>다음 도착 가능</dt><dd>{formatDate(message.availableAt)}</dd></div>
                    ) : null}
                  </dl>
                  <div className="admin-message__actions">
                    {message.status === "drifting" ? (
                      <button
                        className="button button--primary button--small"
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          makeMessageAvailable(message.id);
                        }}
                      >
                        지금 도달 가능하게
                      </button>
                    ) : null}
                    <button
                      className="button button--danger button--small"
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.blur();
                        deleteMessage(message.id);
                      }}
                    >
                      메시지 완전 삭제
                    </button>
                  </div>
                </article>
              ))}
              {dashboard.messages.length === 0 ? <p className="admin-empty">조건에 맞는 메시지가 없습니다.</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
