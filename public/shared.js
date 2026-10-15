// Shared by the wall display, the phone app, and the server.
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function toISO(d) {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
export function dow(iso) {
  return fromISO(iso).getUTCDay();
}
export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}
export function localToday(tz = 'America/Indiana/Indianapolis', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}
export function localNowHHMM(tz = 'America/Indiana/Indianapolis', now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

// Does a (possibly repeating) event happen on this date?
export function occursOn(ev, iso) {
  if (iso < ev.start_date) return false;
  if (ev.repeat_until && iso > ev.repeat_until) return false;
  const skips = typeof ev.skip_dates === 'string' ? JSON.parse(ev.skip_dates || '[]') : ev.skip_dates || [];
  if (skips.includes(iso)) return false;
  if (!ev.repeat) return iso === ev.start_date;
  const diff = daysBetween(ev.start_date, iso);
  const d = fromISO(iso), s = fromISO(ev.start_date);
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekdays': { const w = d.getUTCDay(); return w >= 1 && w <= 5; }
    case 'weekly': {
      const days = ev.weekly_days ? (typeof ev.weekly_days === 'string' ? JSON.parse(ev.weekly_days) : ev.weekly_days) : null;
      return days && days.length ? days.includes(d.getUTCDay()) : diff % 7 === 0;
    }
    case 'biweekly': return diff % 14 === 0;
    case 'monthly': return d.getUTCDate() === s.getUTCDate();
    case 'yearly': return d.getUTCDate() === s.getUTCDate() && d.getUTCMonth() === s.getUTCMonth();
    default: return iso === ev.start_date;
  }
}

export function eventsOn(events, iso) {
  return events
    .filter((e) => occursOn(e, iso))
    .sort((a, b) => (a.start_time || '00:00').localeCompare(b.start_time || '00:00') || a.title.localeCompare(b.title));
}

export function choresOn(chores, iso) {
  const w = dow(iso);
  return chores.filter((c) => {
    if (!c.active) return false;
    if (c.one_time_date) return c.one_time_date === iso;
    const days = typeof c.days === 'string' ? JSON.parse(c.days) : c.days;
    return days.includes(w);
  }).sort((a, b) => (TOD[a.time_of_day] ?? 2) - (TOD[b.time_of_day] ?? 2) || a.id - b.id);
}
const TOD = { morning: 0, afternoon: 1, any: 2, evening: 3 };

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}
