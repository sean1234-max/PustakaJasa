// A Shipment Date the salesman types after NOT CONFIRM (approve.ts, Sean 2026-11-27) → the days it can mean,
// the likeliest first; the bot asks "Is it <day>?" YES / NO down this list.
//   "28" / "28hb" / "28号"   → the next 28th: this month's, or next month's once this month's has passed
//   "today" / "hari ini" / "今天", "tomorrow" / "esok" / "明天", "lusa" / "后天"
//   "2/12/2026", "12/2", "2-12", "2.12.26" → day/month AND month/day; the nearer day from today first (an
//      order doesn't ship months away), the Malaysian day/month first when both are as near
//   "2 Dec", "2 Disember 2026", "Dec 2", "12月2号"
// Days before today are left out. Plain, no imports — shipDate.test.ts.

const DAY_MS = 86_400_000;
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12,
};
const RELATIVE: [RegExp, number][] = [
  [/^(today|hari ?ini|harini|今天|今日)$/, 0],
  [/^(tomorrow|esok|besok|明天|明日)$/, 1],
  [/^(lusa|后天|後天)$/, 2],
];

const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return m >= 1 && m <= 12 && d >= 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : '';
};
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

// That day and month in the year given, else the first one from today on (this year's, else next year's)
function dayMonth(d: number, m: number, year: number | null, today: string) {
  if (year) return iso(year, m, d);
  const y = Number(today.slice(0, 4));
  const thisYear = iso(y, m, d);
  return thisYear && thisYear >= today ? thisYear : iso(y + 1, m, d);
}

// The next "d"th from today: this month's, else the first month after that has it
function nextDayOfMonth(d: number, today: string) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 3; i++) {
    const day = iso(y, m, d);
    if (day && day >= today) return day;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return '';
}

export function shipmentDayOptions(text: string, today: string): string[] {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return [];
  for (const [re, days] of RELATIVE) if (re.test(t)) return [shift(today, days)];

  let m;
  let days: string[] = [];
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) days = [iso(+m[1], +m[2], +m[3])];
  else if ((m = /^(\d{1,2})\s*(?:hb|haribulan|号|號|日|th|st|nd|rd)?$/.exec(t))) days = [nextDayOfMonth(+m[1], today)];
  else if ((m = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[号號日]?$/.exec(t))) days = [dayMonth(+m[3], +m[2], m[1] ? +m[1] : null, today)];
  else if ((m = /^(\d{1,2})[/.\- ](\d{1,2})(?:[/.\- ](\d{2}|\d{4}))?$/.exec(t))) {
    const year = m[3] ? fullYear(m[3]) : null;
    const a = +m[1];
    const b = +m[2];
    days = [dayMonth(a, b, year, today), ...(a !== b ? [dayMonth(b, a, year, today)] : [])];
  } else if ((m = /^(\d{1,2})(?:hb)?\s+([a-z]+)\.?(?:,?\s+(\d{4}))?$/.exec(t)) && MONTHS[m[2]]) {
    days = [dayMonth(+m[1], MONTHS[m[2]], m[3] ? +m[3] : null, today)];
  } else if ((m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(t)) && MONTHS[m[1]]) {
    days = [dayMonth(+m[2], MONTHS[m[1]], m[3] ? +m[3] : null, today)];
  }
  const fromToday = [...new Set(days.filter((d) => d && d >= today))];
  // the nearer day first; as near: the order typed (day/month)
  return fromToday.map((d, i) => ({ d, i })).sort((x, y) => (Date.parse(x.d) - Date.parse(y.d)) || (x.i - y.i)).map((x) => x.d);
}
