export function parseClockValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (numbers.length === 3) {
    return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  }
  return numbers[0] * 60 + numbers[1];
}

export function clockFromComment(
  comment: string | null | undefined,
): number | null {
  if (!comment) return null;
  const match = comment.match(
    /\[%clk\s+((?:\d+:)?\d{1,3}:\d{2}(?:\.\d+)?)\]/i,
  );
  return match ? parseClockValue(match[1]) : null;
}

/**
 * Return the initial seconds for the common PGN TimeControl forms:
 * sudden death (`600`), increment (`600+5`), staged (`40/7200:3600`),
 * sandclock (`*180`), and Chess.com daily (`1 in 3 days`).
 */
export function initialTimeControlSeconds(
  value: string | null | undefined,
): number | null {
  if (!value || value === "?" || value === "-") return null;
  const normalized = value.trim().toLowerCase();
  const daily = normalized.match(/\bin\s+(\d+)\s+days?\b/);
  if (daily) return Number(daily[1]) * 86_400;

  const firstPeriod = normalized.split(":")[0];
  const sandclock = firstPeriod.match(/^\*(\d+)$/);
  if (sandclock) return Number(sandclock[1]);
  const staged = firstPeriod.match(/^\d+\/(\d+)(?:\+\d+)?$/);
  if (staged) return Number(staged[1]);
  const suddenDeath = firstPeriod.match(/^(\d+)(?:\+\d+)?$/);
  return suddenDeath ? Number(suddenDeath[1]) : null;
}

export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "--:--";
  const total = Math.max(0, Math.ceil(seconds));
  if (total >= 86_400) return `${Math.ceil(total / 86_400)}d`;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}
