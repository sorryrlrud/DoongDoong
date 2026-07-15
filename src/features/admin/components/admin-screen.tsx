import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  AdminDashboard,
  AdminAuthInfo,
  AdminGateway,
  AdminMessageStatus,
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

export function AdminScreen({ gateway, onExit }: AdminScreenProps) {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [authInfo, setAuthInfo] = useState<AdminAuthInfo | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminMessageStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkingGitHub, setLinkingGitHub] = useState(false);

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
          <p>사용자와 병편지를 읽기 전용으로 확인합니다.</p>
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
            <article className="admin-stat--alert"><span>신고 격리</span><strong>{dashboard.stats.quarantinedMessages.toLocaleString()}</strong></article>
            <article><span>누적 신고</span><strong>{dashboard.stats.totalReports.toLocaleString()}</strong></article>
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
                <option value="reserved">수신 예약</option>
                <option value="kept">보관 중</option>
                <option value="quarantined">신고 격리</option>
                <option value="discarded">폐기</option>
              </select>
            </label>
            <button className="button button--primary button--small" type="submit" disabled={loading}>
              {loading ? "조회 중…" : "조회"}
            </button>
          </form>

          <section className="admin-section">
            <div className="admin-section__heading">
              <h2>사용자</h2>
              <span>{dashboard.users.length}명 표시</span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>UID</th><th>상태</th><th>바다</th><th>발송</th><th>작성 메시지</th><th>가입일</th></tr></thead>
                <tbody>
                  {dashboard.users.map((user) => (
                    <tr key={user.id}>
                      <td><code>{user.id}</code>{user.role === "admin" ? <small>ADMIN</small> : null}</td>
                      <td>{user.status}</td>
                      <td>{user.seaId}</td>
                      <td>{user.dailySendCount}/2</td>
                      <td>{user.authoredMessageCount}</td>
                      <td>{formatDate(user.createdAt)}</td>
                    </tr>
                  ))}
                  {dashboard.users.length === 0 ? <tr><td colSpan={6}>조건에 맞는 사용자가 없습니다.</td></tr> : null}
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
                <article className={message.status === "quarantined" ? "admin-message admin-message--alert" : "admin-message"} key={message.id}>
                  <header>
                    <span className={`admin-badge admin-badge--${message.status}`}>{message.status}</span>
                    <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    {message.reportCount > 0 ? <strong>신고 {message.reportCount}</strong> : null}
                  </header>
                  <p>{message.body}</p>
                  {message.signature ? <blockquote>서명: {message.signature}</blockquote> : null}
                  <dl>
                    <div><dt>메시지 ID</dt><dd><code>{message.id}</code></dd></div>
                    <div><dt>발신 UID</dt><dd><code>{message.authorUid}</code></dd></div>
                    <div><dt>수신 UID</dt><dd><code>{message.recipientUid ?? "-"}</code></dd></div>
                    <div><dt>바다</dt><dd>{message.seaId}</dd></div>
                  </dl>
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
