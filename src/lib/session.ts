/**
 * CME trading-session calendar.
 *
 * The exchange day for CME equity-index futures runs 18:00 ET → 17:00 ET the next day, with a
 * 60-minute break at 17:00. The Sunday 18:00 open belongs to Monday's trading day. Every daily,
 * weekly and 4H boundary in this app is anchored to that, so candles line up with what a chart
 * platform shows rather than with midnight UTC.
 *
 * Timezone handling uses Intl rather than a dependency, so DST transitions are handled by the
 * platform's own tz database.
 */

const ET = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

/** Wall-clock time in New York for a given UTC instant. */
export function etParts(ms: number): EtParts {
  const p = partsFmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    year,
    month,
    day,
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Offset in minutes that New York is behind UTC at this instant (300 for EST, 240 for EDT). */
export function etOffsetMinutes(ms: number): number {
  const p = etParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((ms - asUtc) / 60000);
}

/** UTC instant for a given New York wall-clock time. */
export function etToUtc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the DST edge cases.
  let ms = guess + etOffsetMinutes(guess) * 60000;
  ms = guess + etOffsetMinutes(ms) * 60000;
  return ms;
}

const DAY = 86400000;

/**
 * The trading day a timestamp belongs to, as YYYY-MM-DD.
 * Anything at or after 18:00 ET counts as the following calendar day's session.
 */
export function tradingDay(ms: number): string {
  const p = etParts(ms);
  let y = p.year,
    m = p.month,
    d = p.day;
  if (p.hour >= 18) {
    const next = new Date(Date.UTC(y, m - 1, d) + DAY);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** UTC instant of the 18:00 ET open that starts the given trading day (YYYY-MM-DD). */
export function sessionOpen(tradingDayStr: string): number {
  const [y, m, d] = tradingDayStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - DAY);
  return etToUtc(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 18, 0);
}

/** True during the daily 17:00–18:00 ET maintenance break, or across the weekend closure. */
export function isClosed(ms: number): boolean {
  const p = etParts(ms);
  const minutes = p.hour * 60 + p.minute;
  if (minutes >= 17 * 60 && minutes < 18 * 60) return true; // daily break
  if (p.weekday === 6) return true; // Saturday
  if (p.weekday === 5 && minutes >= 17 * 60) return true; // after Friday close
  if (p.weekday === 0 && minutes < 18 * 60) return true; // before Sunday open
  return false;
}

/** The Sunday-18:00-ET open that starts the week containing this instant. */
export function weekOpen(ms: number): number {
  const day = tradingDay(ms);
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // trading-day weekday, Mon..Fri
  const back = dow === 0 ? 0 : dow - 1; // walk back to Monday's trading day
  const monday = new Date(Date.UTC(y, m - 1, d) - back * DAY);
  const mondayStr = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  return sessionOpen(mondayStr); // = Sunday 18:00 ET
}

/**
 * 4H blocks run from the 18:00 ET open: 18, 22, 02, 06, 10, 14 ET.
 * The final block is three hours because the session closes at 17:00.
 */
export function fourHourOpen(ms: number): number {
  const open = sessionOpen(tradingDay(ms));
  const elapsed = ms - open;
  const block = Math.floor(elapsed / (4 * 3600000));
  return open + Math.min(block, 5) * 4 * 3600000;
}

/** Session windows used by the session high/low tools, in ET minutes from midnight. */
export const SESSIONS = {
  asia: { label: "Asia", start: 18 * 60, end: 27 * 60 }, // 18:00 → 03:00 ET
  london: { label: "London", start: 3 * 60, end: 8 * 60 + 30 },
  nyAm: { label: "NY AM", start: 8 * 60 + 30, end: 12 * 60 },
  nyPm: { label: "NY PM", start: 13 * 60, end: 17 * 60 },
} as const;

/**
 * The UTC instant of a journalled trade. Times typed into the journal are treated as New York
 * time, because that is the clock the strategy's sessions are defined in. Without a time, the
 * trade is anchored to 12:00 ET so day-scale charts still centre sensibly.
 */
export function tradeInstant(date: string, time: string | null): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!time) return etToUtc(y, m, d, 12, 0);
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return etToUtc(y, m, d, 12, 0);
  return etToUtc(y, m, d, Number(match[1]), Number(match[2]));
}

/** An instant as New York date and time, for writing journal entries from replay. */
export function etDateTime(ms: number): { date: string; time: string } {
  const p = etParts(ms);
  return {
    date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
  };
}
