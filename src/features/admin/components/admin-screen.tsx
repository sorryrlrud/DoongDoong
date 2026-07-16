import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  AdminDashboard,
  AdminAuthInfo,
  AdminGateway,
  AdminMessageStatus,
  AdminResetDirection,
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

interface ActionFeedback {
  kind: "success" | "error";
  message: string;
}

export function AdminScreen({ gateway, onExit }: AdminScreenProps) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [authInfo, setAuthInfo] = useState<AdminAuthInfo | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminMessageStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkingGitHub, setLinkingGitHub] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);

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
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [gateway, loadDashboard]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadDashboard(query, status);
  };

  const beginGitHubLogin = async () => {
    if (!gateway || linkingGitHub) return;
    setLinkingGitHub(true);
    setError(null);
    try {
      await gateway.beginGitHubLogin();
    } catch (caught) {
      setError(getErrorMessage(caught));
      setLinkingGitHub(false);
    }
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
      await refreshDashboard(query, status);
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
      `사용자 ${userId}와 관련된 모든 메시지를 데이터베이스에서 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
    )) return;
    void runAction(
      `delete-${userId}`,
      () => gateway.deleteUser(userId),
      "사용자와 관련 메시지를 완전히 삭제했습니다.",
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
          {authInfo?.hasGitHubIdentity ? (
            <>
              <p>GitHub 계정 연결을 확인했습니다. 이 UID에만 관리자 역할을 부여하면 됩니다.</p>
              <code>{authInfo.userId}</code>
              <pre>{`update public.users set role = 'admin' where id = '${authInfo.userId}';`}</pre>
            </>
          ) : (
            <p>관리자 접근은 GitHub 계정 연결 후에만 승인할 수 있습니다.</p>
          )}
          <div className="admin-access__actions">
            {authInfo?.hasGitHubIdentity ? (
              <button className="button button--primary" type="button" onClick={() => void loadDashboard(query, status)}>
                권한 다시 확인
              </button>
            ) : (
              <button className="button button--primary" type="button" onClick={() => void beginGitHubLogin()} disabled={linkingGitHub}>
                {linkingGitHub ? "GitHub로 이동 중…" : "GitHub로 로그인"}
              </button>
            )}
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
                <thead><tr><th>UID</th><th>상태</th><th>바다</th><th>발송</th><th>작성 메시지</th><th>가입일</th><th>관리</th></tr></thead>
                <tbody>
                  {dashboard.users.map((user) => (
                    <tr className={actionKey?.endsWith(user.id) ? "admin-row--busy" : undefined} key={user.id}>
                      <td><code>{user.id}</code>{user.role === "admin" ? <small>ADMIN</small> : null}</td>
                      <td>{user.status}</td>
                      <td>{user.seaId}</td>
                      <td>{user.dailySendCount}/2</td>
                      <td>{user.authoredMessageCount}</td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            className="button button--ghost button--tiny"
                            type="button"
                            disabled={Boolean(actionKey) || user.status === "deleted"}
                            aria-busy={actionKey === `reset-send-${user.id}`}
                            onClick={() => resetUser(user.id, "send")}
                          >
                            발신 초기화
                          </button>
                          <button
                            className="button button--ghost button--tiny"
                            type="button"
                            disabled={Boolean(actionKey) || user.status === "deleted"}
                            aria-busy={actionKey === `reset-receive-${user.id}`}
                            onClick={() => resetUser(user.id, "receive")}
                          >
                            수신 초기화
                          </button>
                          <button
                            className="button button--danger button--tiny"
                            type="button"
                            disabled={
                              Boolean(actionKey)
                              || user.role === "admin"
                              || user.id === authInfo?.userId
                            }
                            aria-busy={actionKey === `delete-${user.id}`}
                            onClick={() => deleteUser(user.id)}
                          >
                            완전 삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dashboard.users.length === 0 ? <tr><td colSpan={7}>조건에 맞는 사용자가 없습니다.</td></tr> : null}
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
                        disabled={Boolean(actionKey)}
                        aria-busy={actionKey === `available-${message.id}`}
                        onClick={() => makeMessageAvailable(message.id)}
                      >
                        지금 도달 가능하게
                      </button>
                    ) : null}
                    <button
                      className="button button--danger button--small"
                      type="button"
                      disabled={Boolean(actionKey)}
                      aria-busy={actionKey === `delete-message-${message.id}`}
                      onClick={() => deleteMessage(message.id)}
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
