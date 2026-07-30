import { raceYearKey, raceMonthKey, raceMonthLabel, raceDayKey, formatRaceDate } from "./ispFormat";

// Generic Year → Month → Day → Meeting tree builder, extracted from
// IspRacesScreen.tsx (its original, IspRace-specific buildRaceHierarchy) so
// any screen grouping dated, meeting-scoped items the same way — the full
// Industry SP race list there, or a saved filter's live day-by-day rollup on
// SavedResultDetailScreen — shares one implementation instead of a second,
// silently-drifting copy of the same Map-based grouping.
export interface MeetingNode<T> {
  meetingId: string;
  label: string;
  items: T[];
}
export interface DayNode<T> {
  key: string;
  label: string;
  items: T[];
  meetings: MeetingNode<T>[];
}
export interface MonthNode<T> {
  key: string;
  label: string;
  items: T[];
  days: DayNode<T>[];
}
export interface YearNode<T> {
  key: string;
  items: T[];
  months: MonthNode<T>[];
}

export interface HierarchyKeys<T> {
  // A full ISO-ish date/datetime string — used for the Europe/London year/
  // month/day grouping keys (see ispFormat.ts's raceYearKey/etc). A bare
  // "YYYY-MM-DD" date string works fine here too.
  dateTime: (item: T) => string;
  meetingId: (item: T) => string;
  meetingLabel: (item: T) => string;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

// Uses Map (not plain objects) at every level — year keys like "2015" are
// numeric-looking strings, and JS reorders integer-like object keys
// ascending regardless of insertion order, which would silently break a
// "Last → First" sort toggle at the year level.
export function buildHierarchy<T>(items: T[], keys: HierarchyKeys<T>): YearNode<T>[] {
  const years = new Map<
    string,
    {
      items: T[];
      months: Map<
        string,
        { label: string; items: T[]; days: Map<string, { label: string; items: T[]; meetings: Map<string, MeetingNode<T>> }> }
      >;
    }
  >();

  for (const item of items) {
    const dateTime = keys.dateTime(item);
    const yearKey = raceYearKey(dateTime);
    const monthKey = raceMonthKey(dateTime);
    const dayKey = raceDayKey(dateTime);

    const year = getOrCreate(years, yearKey, () => ({ items: [], months: new Map() }));
    year.items.push(item);

    const month = getOrCreate(year.months, monthKey, () => ({ label: raceMonthLabel(dateTime), items: [], days: new Map() }));
    month.items.push(item);

    const day = getOrCreate(month.days, dayKey, () => ({ label: formatRaceDate(dateTime), items: [], meetings: new Map() }));
    day.items.push(item);

    const meetingId = keys.meetingId(item);
    const meeting = getOrCreate(day.meetings, meetingId, () => ({ meetingId, label: keys.meetingLabel(item), items: [] }));
    meeting.items.push(item);
  }

  return Array.from(years.entries()).map(([yearKey, year]) => ({
    key: yearKey,
    items: year.items,
    months: Array.from(year.months.entries()).map(([monthKey, month]) => ({
      key: monthKey,
      label: month.label,
      items: month.items,
      days: Array.from(month.days.entries()).map(([dayKey, day]) => ({
        key: dayKey,
        label: day.label,
        items: day.items,
        meetings: Array.from(day.meetings.values()),
      })),
    })),
  }));
}

export function collectHierarchyNodeKeys<T>(years: YearNode<T>[]): string[] {
  const keys: string[] = [];
  for (const year of years) {
    keys.push(`year:${year.key}`);
    for (const month of year.months) {
      keys.push(`month:${month.key}`);
      for (const day of month.days) {
        keys.push(`day:${day.key}`);
        for (const meeting of day.meetings) {
          keys.push(`meeting:${meeting.meetingId}`);
        }
      }
    }
  }
  return keys;
}
