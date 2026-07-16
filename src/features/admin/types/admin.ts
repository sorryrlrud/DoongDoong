export type AdminMessageStatus =
  | "all"
  | "drifting"
  | "reserved"
  | "kept"
  | "discarded"
  | "quarantined";

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  bannedUsers: number;
  totalMessages: number;
  messagesToday: number;
  driftingMessages: number;
  quarantinedMessages: number;
  totalReports: number;
}

export interface AdminUserRow {
  id: string;
  seaId: string;
  locale: string;
  status: string;
  role: string;
  dailySendCount: number;
  authoredMessageCount: number;
  createdAt: string;
}

export interface AdminMessageRow {
  id: string;
  authorUid: string;
  recipientUid: string | null;
  body: string;
  signature: string | null;
  seaId: string;
  status: string;
  reportCount: number;
  createdAt: string;
}

export interface AdminDashboard {
  stats: AdminStats;
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
  seedDemoMessages(): Promise<number>;
  getDashboard(filters?: AdminDashboardFilters): Promise<AdminDashboard>;
}
