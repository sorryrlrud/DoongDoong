const isUsableTimeZone = (timeZone: unknown): timeZone is string =>
  typeof timeZone === "string"
  && timeZone.length > 0
  && timeZone.length <= 128
  && timeZone.trim() === timeZone;

/**
 * Reads the browser-provided IANA zone without assuming Intl is available.
 * The API is deliberately best effort; the database remains the final
 * authority for validating the value.
 */
export const getBrowserTimeZone = (
  readTimeZone: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null => {
  try {
    const timeZone = readTimeZone();
    return isUsableTimeZone(timeZone) ? timeZone : null;
  } catch {
    return null;
  }
};
