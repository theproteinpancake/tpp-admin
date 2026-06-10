// Melbourne-local date/time helpers — DST-SAFE (AEST +10 / AEDT +11 Oct–Apr).
// Use these instead of manual `+10:00` / `Date.now() + 10h` offsets, which are wrong half the
// year and silently shift day boundaries by an hour (orders 11pm–midnight land on the wrong day).
const TZ = 'Australia/Melbourne';

// Pure calendar-space day arithmetic on a YYYY-MM-DD string (no TZ involvement → exact).
export function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
}

// YYYY-MM-DD of (today + offsetDays) in Melbourne local time.
export function melbDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return offsetDays ? addDays(today, offsetDays) : today;
}

// Melbourne local hour-of-day (0–23) right now.
export function melbHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

// Day-of-week of a YYYY-MM-DD (Mon=0 … Sun=6) — calendar-space, no TZ involvement.
export function dowMon0(dateStr: string): number {
  return (new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

// The UTC instant (ISO) of local MIDNIGHT in Melbourne on the given YYYY-MM-DD — DST-aware.
// Starts from a +10 guess and corrects by however far that lands from true local midnight.
export function melbMidnightUtc(dateStr: string): string {
  let t = Date.parse(`${dateStr}T00:00:00+10:00`);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(t));
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
    const localIso = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`;
    const diff = Date.parse(localIso) - Date.parse(`${dateStr}T00:00:00Z`);
    if (!diff) break;
    t -= diff;
  }
  return new Date(t).toISOString();
}

// Pretty Melbourne-local date strings for briefs.
export function melbLongDate(): string {
  return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
}
