/**
 * All date logic runs in the team's timezone (Adelaide), not the server's or the
 * viewer's. Without this, a task due "today" flips to overdue at 9:30am local
 * time because Vercel runs in UTC.
 */
export const TEAM_TZ = "Australia/Adelaide";

/** Today in the team timezone, as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Whole days from today to `date` (negative = in the past). */
export function daysFromToday(date: string): number {
  return dayDiff(today(), date);
}

function toUTC(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function addDays(ymd: string, days: number): string {
  const t = new Date(toUTC(ymd) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Clamp to the last valid day so 31 Jan + 1 month lands on 28/29 Feb.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export type DueTone = "overdue" | "today" | "soon" | "later";

export type DueInfo = { label: string; tone: DueTone; days: number };

/** Human label for a due date, e.g. "3 days overdue", "Today", "Fri 14 Mar". */
export function describeDue(date: string): DueInfo {
  const days = daysFromToday(date);

  if (days < 0) {
    const n = Math.abs(days);
    return {
      label: n === 1 ? "1 day overdue" : `${n} days overdue`,
      tone: "overdue",
      days,
    };
  }
  if (days === 0) return { label: "Today", tone: "today", days };
  if (days === 1) return { label: "Tomorrow", tone: "soon", days };
  if (days <= 6) {
    return { label: weekday(date), tone: "soon", days };
  }
  return { label: shortDate(date), tone: "later", days };
}

/*
 * Names are spelled out rather than produced by Intl.
 *
 * These strings are rendered on the server and then hydrated in the browser,
 * and the two runtimes don't agree: Node's ICU build formats the en-AU short
 * month as "July" where browsers give "Jul". That mismatch throws away the
 * server-rendered tree. Fixed tables are identical everywhere.
 */
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAYS_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function weekday(ymd: string): string {
  return WEEKDAYS_LONG[new Date(toUTC(ymd)).getUTCDay()];
}

/** "Mon", "Tue", … for a YYYY-MM-DD string. */
export function weekdayShort(ymd: string): string {
  return WEEKDAYS_SHORT[new Date(toUTC(ymd)).getUTCDay()];
}

/** Day of the month as a number, e.g. 28. */
export function dayOfMonth(ymd: string): number {
  return new Date(toUTC(ymd)).getUTCDate();
}

export function monthShort(ymd: string): string {
  return MONTHS_SHORT[new Date(toUTC(ymd)).getUTCMonth()];
}

export function shortDate(ymd: string): string {
  return `${dayOfMonth(ymd)} ${monthShort(ymd)}`;
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "July 2026" — the heading above a calendar. */
export function monthLabel(ymd: string): string {
  const date = new Date(toUTC(ymd));
  return `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The Monday of the week containing `ymd`. Australia starts weeks on Monday. */
export function startOfWeek(ymd: string): string {
  const day = new Date(toUTC(ymd)).getUTCDay();
  return addDays(ymd, -((day + 6) % 7));
}

export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Every date to draw for a month view: whole weeks, Monday-first, padded with
 * the tail of the previous month and the head of the next so the grid is square.
 */
export function monthGrid(anchor: string): string[] {
  const first = startOfMonth(anchor);
  const start = startOfWeek(first);

  // Last day of the anchor month, then round out to the end of its week.
  const nextMonth = addMonths(first, 1);
  const last = addDays(nextMonth, -1);
  const end = addDays(startOfWeek(last), 6);

  const total = dayDiff(start, end) + 1;
  return Array.from({ length: total }, (_, i) => addDays(start, i));
}

export function weekGrid(anchor: string): string[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Relative time for comments and notifications, e.g. "4m", "2h", "3d". */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(new Date(iso).toISOString().slice(0, 10));
}
