/**
 * Date ranges for the admin Overview (ATS-340). Every day is a Cairo calendar day, written
 * `YYYY-MM-DD`, the same keys the daily summaries `storeStats/{day}` use
 * (functions/src/stats/store-stats.ts). Pure: no Angular, no Firestore.
 */

export const STORE_TIME_ZONE = 'Africa/Cairo';

export type OverviewRangeId = 'today' | 'week' | 'd14' | 'month' | 'm3' | 'custom';

export interface OverviewRangeOption {
  readonly id: OverviewRangeId;
  readonly label: string;
}

export const OVERVIEW_RANGES: readonly OverviewRangeOption[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'd14', label: 'Last 14 days' },
  { id: 'month', label: 'This month' },
  { id: 'm3', label: 'Last 3 months' },
  { id: 'custom', label: 'Custom' },
];

/** Longest custom range, in days (a year). */
export const MAX_RANGE_DAYS = 366;

/** The week starts on Saturday, the usual Egyptian work week (0 = Sunday … 6 = Saturday). */
export const WEEK_START_DAY = 6;

export interface DayRange {
  /** First day, inclusive. */
  readonly from: string;
  /** Last day, inclusive. */
  readonly to: string;
}

export interface OverviewPeriod {
  readonly current: DayRange;
  /** The same number of days just before `current`, for the comparison. */
  readonly previous: DayRange;
  readonly days: number;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's Cairo date as `YYYY-MM-DD`. */
export function cairoToday(now: Date): string {
  return dayKeyFormat.format(now);
}

export function isDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** A day key as a UTC midnight (calendar math only; never shown as a time). */
function toUtc(day: string): number {
  const match = DAY_KEY.exec(day);
  if (!match) throw new Error(`Not a day: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY_MS);
}

/** Days from `from` to `to`, both counted. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Every day key of a range, oldest first. */
export function daysOf(range: DayRange): string[] {
  const out: string[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** The current range and the one before it, for a range button (custom uses `custom`). */
export function overviewPeriod(id: OverviewRangeId, today: string, custom?: DayRange | null): OverviewPeriod {
  const current = currentRange(id, today, custom);
  const days = daysBetween(current.from, current.to);
  const previousTo = addDays(current.from, -1);
  return { current, previous: { from: addDays(previousTo, -(days - 1)), to: previousTo }, days };
}

function currentRange(id: OverviewRangeId, today: string, custom?: DayRange | null): DayRange {
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const weekday = new Date(toUtc(today)).getUTCDay();
      const back = (weekday - WEEK_START_DAY + 7) % 7;
      return { from: addDays(today, -back), to: today };
    }
    case 'd14':
      return { from: addDays(today, -13), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'm3': {
      const date = new Date(toUtc(today));
      const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 3, date.getUTCDate() + 1));
      // 31 May minus 3 months lands past the end of February; keep it to the day after the 3-month mark.
      return { from: fromUtc(Math.min(start.getTime(), toUtc(today))), to: today };
    }
    case 'custom':
      return customRange(custom ?? null, today);
  }
}

/** A typed custom range made safe: real days, in order, not after today, at most a year. */
export function customRange(custom: DayRange | null, today: string): DayRange {
  let from = custom && isDayKey(custom.from) ? custom.from : addDays(today, -29);
  let to = custom && isDayKey(custom.to) ? custom.to : today;
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to };
}

const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** `13 Nov` */
export function shortDayLabel(day: string): string {
  return shortDay.format(new Date(toUtc(day)));
}

/** `Thursday 26 Nov` */
function longDayLabel(day: string): string {
  return longDay.format(new Date(toUtc(day)));
}

function rangeLabel(range: DayRange): string {
  if (range.from === range.to) return longDayLabel(range.from);
  const year = range.to.slice(0, 4) !== range.from.slice(0, 4) ? ` ${range.from.slice(0, 4)}` : '';
  return `${shortDayLabel(range.from)}${year} to ${shortDayLabel(range.to)} ${range.to.slice(0, 4)}`;
}

/** `13 Nov to 26 Nov 2026, compared with 30 Oct to 12 Nov 2026` */
export function periodLabel(period: OverviewPeriod): string {
  return `${rangeLabel(period.current)}, compared with ${rangeLabel(period.previous)}`;
}
