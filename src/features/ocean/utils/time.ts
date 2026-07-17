import type { Translate } from "@/i18n/i18n";

export const formatCountdown = (target: number | null, now: number, t: Translate): string => {
  if (!target || target <= now) return t("time.now");

  const remainingMinutes = Math.max(1, Math.ceil((target - now) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours === 0) return t("time.minutes", { minutes });
  if (minutes === 0) return t("time.hours", { hours });
  return t("time.hoursMinutes", { hours, minutes });
};

export const formatExpiry = (expiresAt: number, now: number, t: Translate): string => {
  const remainingDays = Math.min(30, Math.max(0, Math.ceil((expiresAt - now) / 86_400_000)));
  return remainingDays <= 1 ? t("time.tomorrow") : t("time.days", { days: remainingDays });
};
