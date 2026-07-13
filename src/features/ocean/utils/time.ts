const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });

export const formatCountdown = (target: number | null, now: number): string => {
  if (!target || target <= now) {
    return "지금";
  }

  const remainingMinutes = Math.max(1, Math.ceil((target - now) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours === 0) {
    return `${minutes}분 뒤`;
  }

  if (minutes === 0) {
    return `${hours}시간 뒤`;
  }

  return `${hours}시간 ${minutes}분 뒤`;
};

export const formatExpiry = (expiresAt: number, now: number): string => {
  const remainingDays = Math.max(0, Math.ceil((expiresAt - now) / 86_400_000));
  if (remainingDays <= 1) {
    return "내일 사라져요";
  }

  return RELATIVE_TIME_FORMATTER.format(remainingDays, "day").replace("후", "뒤 사라져요");
};
