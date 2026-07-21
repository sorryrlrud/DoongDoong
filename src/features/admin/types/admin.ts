export type AdminMessageStatus =
  | "all"
  | "drifting"
  | "available"
  | "delivered"
  | "kept"
  | "deleted"
  | "reported";

export type AdminResetDirection = "send" | "receive" | "both";

export type AdminUserStatus = "active" | "suspended" | "banned";

export const ADMIN_REPORT_REASONS = [
  "personal_info",
  "sexual",
  "hate",
  "harassment",
  "self_harm",
  "spam",
  "other",
] as const;

export type AdminReportReason = (typeof ADMIN_REPORT_REASONS)[number];
export type AdminReportStatus = "open" | "resolved";
export type AdminReportResolution =
  | "dismiss_and_redrift"
  | "remove_message"
  | "remove_and_suspend_author"
  | "remove_and_ban_author";
export type AdminReportMessageStatus = Exclude<AdminMessageStatus, "all">;

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  bannedUsers: number;
  deletedUsers: number;
  totalMessages: number;
  messagesToday: number;
  driftingMessages: number;
  availableMessages: number;
  deliveredMessages: number;
  reportedMessages: number;
  totalReports: number;
}

export type AdminUsageUnit = "bytes" | "count" | "characters";

export interface AdminUsageMetric {
  used: number;
  limit: number;
  unit: AdminUsageUnit;
}

export interface AdminServiceUsage {
  periodStart: string;
  measuredAt: string;
  supabase: {
    databaseSize: AdminUsageMetric;
    monthlyActiveUsers: AdminUsageMetric;
    storageSize: AdminUsageMetric;
    edgeFunctionInvocations: AdminUsageMetric;
  };
  azureTranslator: {
    translatedCharacters: AdminUsageMetric;
  };
}

export interface AdminUserRow {
  id: string;
  countryCode: string | null;
  defaultSignature: string | null;
  locale: string;
  status: string;
  role: string;
  dailySendCount: number;
  nextCatchAt: string | null;
  authoredMessageCount: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface AdminMessageRow {
  id: string;
  authorUid: string;
  recipientUid: string | null;
  lastDriftedByUid?: string | null;
  body: string;
  signature: string | null;
  seaId: string;
  status: string;
  reportCount: number;
  createdAt: string;
  availableAt?: string;
}

export interface AdminDashboard {
  stats: AdminStats;
  usage: AdminServiceUsage;
  users: AdminUserRow[];
  messages: AdminMessageRow[];
}

export interface AdminDashboardFilters {
  query?: string;
  status?: AdminMessageStatus;
}

export interface AdminReportMessage {
  body: string;
  signature: string | null;
  status: AdminReportMessageStatus;
  authorCountryCode: string | null;
}

export interface AdminReportRow {
  reportId: string;
  messageId: string;
  reporterId: string | null;
  authorId: string | null;
  reason: AdminReportReason;
  status: AdminReportStatus;
  createdAt: string;
  message: AdminReportMessage;
  reasonCounts: Partial<Record<AdminReportReason, number>>;
}

export interface AdminReportPage {
  reports: AdminReportRow[];
  nextCursor: string | null;
}

export interface AdminReportListOptions {
  status?: AdminReportStatus;
  limit?: number;
  cursor?: string | null;
}

export interface AdminAuthInfo {
  userId: string;
}

export interface AdminGateway {
  getAuthInfo(): Promise<AdminAuthInfo>;
  getDashboard(filters?: AdminDashboardFilters): Promise<AdminDashboard>;
  listReports(options?: AdminReportListOptions): Promise<AdminReportPage>;
  resolveReport(reportId: string, resolution: AdminReportResolution, note?: string): Promise<void>;
  updateUserStatus(userId: string, status: AdminUserStatus, reason?: string): Promise<void>;
  resetUserLimits(userId: string, direction: AdminResetDirection): Promise<void>;
  makeMessageAvailable(messageId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
}
