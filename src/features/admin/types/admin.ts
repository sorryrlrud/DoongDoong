export type AdminMessageStatus =
  | "all"
  | "drifting"
  | "available"
  | "delivered"
  | "kept"
  | "deleted"
  | "reported";

export type AdminResetDirection = "send" | "receive" | "both";

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

export interface AdminAuthInfo {
  userId: string;
  hasGitHubIdentity: boolean;
}

export interface AdminGateway {
  getAuthInfo(): Promise<AdminAuthInfo>;
  beginGitHubLogin(): Promise<void>;
  getDashboard(filters?: AdminDashboardFilters): Promise<AdminDashboard>;
  resetUserLimits(userId: string, direction: AdminResetDirection): Promise<void>;
  makeMessageAvailable(messageId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
}
