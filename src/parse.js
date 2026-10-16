// Plain-English parser for Siri and the quick-add box.
// "Dentist Thursday 3pm Mom"            -> event
// "add milk and eggs to groceries"      -> list items
// "chore Ian feed the cat every day 5 points" -> chore
// "tacos for dinner Friday"             -> meal
// "countdown Disney trip June 5"        -> countdown
// "what's on tomorrow"                  -> query

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_SHORT = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_SHORT = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, a: 1, an: 1 };

const wdRe = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const monRe = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function wdIndex(s) {
  s = s.toLowerCase();
  const full = WEEKDAYS.indexOf(s);
  if (full >= 0) return full;
  return WD_SHORT[s] ?? WD_SHORT[s.slice(0, 3)];
}
function monIndex(s) {
  s = s.toLowerCase();
  const full = MONTHS.indexOf(s);
  if (full >= 0) return full;
  return MON_SHORT[s] ?? MON_SHORT[s.slice(0, 3)];
}

// ---- date helpers (all dates are plain YYYY-MM-DD strings) ----
export function toISO(d) {
  return d.toISOString().slice(0, 10);
}
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
export function dow(iso) {
  return fromISO(iso).getUTCDay();
}
function nextWeekday(today, wd, forceNext) {
  let diff = (wd - dow(today) + 7) % 7;
  if (forceNext && diff === 0) diff = 7;
  return addDays(today, diff);
}

function clean(s) {
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s,.\-:;]+|[\s,.\-:;]+$/g, '').trim();
}
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---- pull a date out of the text ----
function extractDate(text, today) {
  let t = ' ' + text + ' ';
  let date = null;
  const rules = [
    [/\b(?:on\s+)?the\s+day\s+after\s+tomorrow\b/i, () => addDays(today, 2)],
    [/\b(?:on\s+)?day\s+after\s+tomorrow\b/i, () => addDays(today, 2)],
    [/\btomorrow(?:\s+(?:morning|afternoon|night|evening))?\b/i, () => addDays(today, 1)],
    [/\b(?:today|tonight|this\s+(?:morning|afternoon|evening))\b/i, () => today],
    [/\bin\s+(\d+|\w+)\s+(day|days|week|weeks)\b/i, (m) => {
      const n = Number(m[1]) || NUMWORDS[m[1].toLowerCase()] || 1;
      return addDays(today, /week/i.test(m[2]) ? n * 7 : n);
    }],
    [/\bnext\s+week\b/i, () => nextWeekday(today, 1, true)],
    [new RegExp('\\b(?:on\\s+)?next\\s+' + wdRe + '\\b', 'i'), (m) => {
      // "next Friday" = the Friday of next week if it's already this week
      const d = nextWeekday(today, wdIndex(m[1]), true);
      return d;
    }],
    [new RegExp('\\b(?:on\\s+)?(?:this\\s+(?:coming\\s+)?)?' + wdRe + '\\b', 'i'), (m) => nextWeekday(today, wdIndex(m[1]), false)],
    [new RegExp('\\b(?:on\\s+)?' + monRe + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b', 'i'), (m) => monthDay(today, monIndex(m[1]), +m[2], m[3])],
    [new RegExp('\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + monRe + '(?:,?\\s*(\\d{4}))?\\b', 'i'), (m) => monthDay(today, monIndex(m[2]), +m[1], m[3])],
    [/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => monthDay(today, +m[1] - 1, +m[2], m[3])],
    [/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
      const t0 = fromISO(today);
      let d = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), +m[1]));
      if (toISO(d) < today) d = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + 1, +m[1]));
      return toISO(d);
    }],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (m) {
      const val = fn(m);
      if (val) {
        date = val;
        t = t.replace(m[0], ' ');
        break;
      }
    }
  }
  return { date, rest: t };
}

function monthDay(today, mon, day, year) {
  if (mon == null || mon < 0 || mon > 11 || !day || day > 31) return null;
  const ty = fromISO(today).getUTCFullYear();
  let y = year ? (year.length === 2 ? 2000 + +year : +year) : ty;
  let d = toISO(new Date(Date.UTC(y, mon, day)));
  if (!year && d < today) d = toISO(new Date(Date.UTC(y + 1, mon, day)));
  return d;
}

// ---- pull times out ----
function to24(h, min, ampm) {
  h = +h;
  min = +(min || 0);
  if (ampm) {
    ampm = ampm.toLowerCase().replace(/\./g, '');
    if (ampm.startsWith('p') && h < 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;
  } else if (h >= 1 && h <= 7) {
    h += 12; // "at 3" in a family calendar almost always means 3 PM
  }
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  let total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function extractTime(text) {
  let t = text;
  let start = null, end = null;
  const ap = '(a\\.?m\\.?|p\\.?m\\.?)';
  // range: 3-5pm, from 3 to 5 pm, 3:30pm to 4:15pm
  let m = t.match(new RegExp('\\b(?:from\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*' + ap + '?\\s*(?:-|–|to|until|till)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*' + ap + '?(?=\\s|$|,)', 'i'));
  if (m && (m[3] || m[6] || m[2] || /from|to/i.test(m[0]))) {
    const endAp = m[6];
    const startAp = m[3] || (endAp && +m[1] <= +m[4] ? endAp : null);
    start = to24(m[1], m[2], startAp);
    end = to24(m[4], m[5], endAp || startAp);
    if (start && end) t = t.replace(m[0], ' ');
    else start = end = null;
  }
  if (!start) {
    const rules = [
      [/\b(?:at\s+)?noon\b/i, () => '12:00'],
      [/\b(?:at\s+)?midnight\b/i, () => '23:59'],
      [new RegExp('\\b(?:at\\s+|@\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*' + ap + '(?=\\s|$|,|\\.)', 'i'), (m) => to24(m[1], m[2], m[3])],
      [/\b(?:at\s+|@\s*)(\d{1,2}):(\d{2})\b/i, (m) => to24(m[1], m[2], null)],
      [/\b(\d{1,2}):(\d{2})\b/, (m) => to24(m[1], m[2], null)],
      [/\b(?:at|@)\s*(\d{1,2})\b(?!\s*(?:points?|pts|days?|weeks?|minutes?|mins?|hours?|hrs?))/i, (m) => to24(m[1], 0, null)],
    ];
    for (const [re, fn] of rules) {
      const mm = t.match(re);
      if (mm) {
        const v = fn(mm);
        if (v) {
          start = v;
          t = t.replace(mm[0], ' ');
          break;
        }
      }
    }
  }
  // duration: for 2 hours / for 30 minutes / for an hour / for 1.5 hours
  const dm = t.match(/\bfor\s+(\d+(?:\.\d+)?|an?|one|two|three|four|half\s+an?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (dm) {
    let n = /half/i.test(dm[1]) ? 0.5 : Number(dm[1]) || NUMWORDS[dm[1].toLowerCase()] || 1;
    const mins = /h/i.test(dm[2]) ? n * 60 : n;
    if (start) end = addMinutes(start, Math.round(mins));
    t = t.replace(dm[0], ' ');
  }
  if (start && !end) end = addMinutes(start, 60);
  return { start, end, rest: t };
}

// ---- repeats ----
function nextSemi(today, dates) {
  const t = new Date(today + 'T12:00:00Z');
  for (let i = 0; i < 40; i++) {
    const d = new Date(t.getTime() + i * 86400000);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (dates.some((x) => (x === -1 ? last : Math.min(x, last)) === d.getUTCDate())) return d.toISOString().slice(0, 10);
  }
  return today;
}
function nextNth(today, n, w) {
  const t = new Date(today + 'T12:00:00Z');
  for (let i = 0; i < 70; i++) {
    const d = new Date(t.getTime() + i * 86400000);
    if (d.getUTCDay() !== w) continue;
    const dt = d.getUTCDate(), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (n === -1 ? dt + 7 > last : Math.ceil(dt / 7) === n) return d.toISOString().slice(0, 10);
  }
  return today;
}
function extractRepeat(text, today) {
  let t = text;
  let repeat = null, days = null, date = null;
  const ORD = '(first|1st|second|2nd|third|3rd|fourth|4th|last)';
  const ordN = (w) => ({ first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, last: -1 })[w.toLowerCase()];
  const nthRule = (n, w) => { repeat = 'monthly_nth'; days = { nth: n, day: w }; date = nextNth(today, n, w); };
  const rules = [
    [/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*(?:,|and|&)\s*(?:the\s+)?(\d{1,2}(?:st|nd|rd|th)?|last(?:\s+day)?)(?:\s+day)?\s+of\s+(?:every|each|the|a)\s+month\b/i, (m) => {
      const a = +m[1], b = /last/i.test(m[2]) ? -1 : parseInt(m[2], 10);
      if (a < 1 || a > 31 || (b !== -1 && (b < 1 || b > 31))) return;
      repeat = 'semimonthly'; days = { dates: [a, b].sort((x, y) => (x === -1 ? 99 : x) - (y === -1 ? 99 : y)) };
      date = nextSemi(today, days.dates);
    }],
    [/\btwice\s+(?:a|per|each|every)\s+month\b|\bsemi-?monthly\b/i, () => { repeat = 'semimonthly'; days = { dates: [1, 15] }; date = nextSemi(today, [1, 15]); }],
    [new RegExp('\\b(?:on\\s+)?(?:the\\s+|every\\s+|each\\s+)?' + ORD + '\\s+' + wdRe + '\\s+(?:of\\s+)?(?:every|each|the|a)\\s+month\\b', 'i'), (m) => nthRule(ordN(m[1]), wdIndex(m[2]))],
    [new RegExp('\\b(?:every|each)\\s+' + ORD + '\\s+' + wdRe + '\\b', 'i'), (m) => nthRule(ordN(m[1]), wdIndex(m[2]))],
    [/\bevery\s*day\b|\bdaily\b|\beach\s+day\b/i, () => { repeat = 'daily'; days = [0, 1, 2, 3, 4, 5, 6]; }],
    [/\b(?:every\s+)?weekdays?\b|\bmonday\s+(?:through|thru|to)\s+friday\b/i, () => { repeat = 'weekdays'; days = [1, 2, 3, 4, 5]; }],
    [/\bevery\s+weekend\b|\bon\s+weekends\b/i, () => { repeat = 'weekly'; days = [0, 6]; }],
    [new RegExp('\\bevery\\s+other\\s+' + wdRe + '\\b', 'i'), (m) => { repeat = 'biweekly'; const w = wdIndex(m[1]); days = [w]; date = nextWeekday(today, w, false); }],
    [new RegExp('\\b(?:every|each)\\s+' + wdRe + '(?:s)?\\b(?:\\s*(?:,|and|&)\\s*' + wdRe + '(?:s)?\\b)*', 'i'), (m) => {
      const found = [...m[0].matchAll(new RegExp(wdRe, 'ig'))].map((x) => wdIndex(x[1]));
      days = [...new Set(found)].sort();
      repeat = 'weekly';
      date = days.map((w) => nextWeekday(today, w, false)).sort()[0];
    }],
    [/\bevery\s+week\b|\bweekly\b/i, () => { repeat = 'weekly'; }],
    [/\bevery\s+other\s+week\b|\bbiweekly\b/i, () => { repeat = 'biweekly'; }],
    [/\bevery\s+(?:other|2|two|second)\s+months?\b|\bbi-?monthly\b/i, () => { repeat = 'bimonthly'; }],
    [/\bevery\s+month\b|\bmonthly\b/i, () => { repeat = 'monthly'; }],
    [/\bevery\s+year\b|\byearly\b|\bannually\b/i, () => { repeat = 'yearly'; }],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (m) {
      fn(m);
      t = t.replace(m[0], ' ');
      break;
    }
  }
  return { repeat, days, date, rest: t };
}

// ---- people ----
function extractPeople(text, people) {
  let t = ' ' + text + ' ';
  const ids = new Set();
  let everyone = false;
  const kids = people.filter((p) => p.is_kid);
  if (/\b(?:the\s+)?(?:whole\s+)?(?:family|everyone|everybody|all of us)\b/i.test(t)) {
    everyone = true;
    t = t.replace(/\b(?:for|with)?\s*(?:the\s+)?(?:whole\s+)?(?:family|everyone|everybody|all of us)\b/i, ' ');
  }
  if (/\b(?:the\s+)?kids\b/i.test(t)) {
    kids.forEach((k) => ids.add(k.id));
    t = t.replace(/\b(?:for|with)?\s*(?:the\s+)?kids'?s?\b/i, ' ');
  }
  if (/\b(?:the\s+)?girls\b/i.test(t)) {
    people.filter((p) => p.is_kid && ['Avalia', 'Aerie'].includes(p.name)).forEach((k) => ids.add(k.id));
    t = t.replace(/\b(?:for|with)?\s*(?:the\s+)?girls'?s?\b/i, ' ');
  }
  if (/\b(?:mom\s+and\s+dad|dad\s+and\s+mom|parents)\b/i.test(t)) {
    people.filter((p) => !p.is_kid).forEach((k) => ids.add(k.id));
    t = t.replace(/\b(?:for|with)?\s*(?:mom\s+and\s+dad|dad\s+and\s+mom|(?:the\s+)?parents)\b/i, ' ');
  }
  for (const p of people) {
    const names = [p.name, p.nickname].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    for (const n of names) {
      const poss = new RegExp("\\b" + n + "(?:'s|s')(?=[\\s,.!?]|$)", 'i');
      if (poss.test(t)) {
        ids.add(p.id); // keep "Ian's" in the title
        continue;
      }
      const re = new RegExp("\\b(?:(?:for|with|and|&)\\s+)?" + n + "(?=[\\s,.!?]|$)", 'i');
      if (re.test(t)) {
        ids.add(p.id);
        t = t.replace(re, ' ');
      }
    }
  }
  t = t.replace(/\s+(?:and|&)\s*$/i, ' ').replace(/^\s*(?:and|&)\s+/i, ' ');
  return { ids: everyone ? [] : [...ids], everyone, rest: t };
}

function extractPoints(text) {
  const neg = text.match(/\b(?:minus|negative|lose|loses|take away|takes away)\s*(\d+)\s*(?:points?|pts|stars?)?|(?:^|\s)-\s*(\d+)\s*(?:points?|pts|stars?)\b/i);
  if (neg) return { points: -Number(neg[1] || neg[2]), rest: text.replace(neg[0], ' ') };
  const m = text.match(/\b(?:for\s+|worth\s+)?(\d+|\w+)\s*(?:points?|pts|stars?)\b/i);
  if (!m) return { points: null, rest: text };
  const n = Number(m[1]) || NUMWORDS[m[1].toLowerCase()];
  if (!n) return { points: null, rest: text };
  return { points: n, rest: text.replace(m[0], ' ') };
}

const FILLER_START = /^(?:hey\s+)?(?:please\s+)?(?:can you\s+)?(?:add|put|schedule|create|make|set up|book|remind (?:me|us)(?: to| about)?|new|an?\s+event(?:\s+for)?|event|appointment\s*:)\s+/i;
const FILLER_END = /\s+(?:to|on|in)\s+(?:the\s+)?(?:family\s+)?(?:calendar|schedule)\s*$/i;

function stripFiller(s) {
  let prev;
  s = clean(s);
  do {
    prev = s;
    s = s.replace(FILLER_START, '').replace(FILLER_END, '');
    s = s.replace(/\s+(?:on|at|for|from|by)\s*$/i, '').replace(/^(?:on|at|for|from|by|a|an)\s+/i, '');
    s = clean(s);
  } while (s !== prev);
  return s;
}

// ======================= main =======================
export function parse(input, ctx) {
  const { people = [], lists = [], today } = ctx;
  const text = clean(String(input || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
  if (!text) return { kind: 'error', reply: "I didn't catch that." };
  const lower = text.toLowerCase();

  // ---- questions ----
  if (/^(?:what'?s|what is)\s+for\s+(breakfast|lunch|dinner|supper)/i.test(lower)) {
    const { date } = extractDate(text, today);
    const slot = lower.match(/breakfast|lunch|dinner|supper/)[0].replace('supper', 'dinner');
    return { kind: 'meal_query', slot, date: date || today };
  }
  if (/^(?:what(?:'s| is| do we have| have we got)?|whats|what's happening|anything|do we have anything|read me)\b/i.test(lower) &&
      /\b(on|happening|going on|planned|scheduled|today|tomorrow|tonight|week|have|calendar|schedule|up)\b/i.test(lower)) {
    if (/\b(?:week)\b/i.test(lower)) return { kind: 'query', range: 'week', date: today };
    const { date } = extractDate(text, today);
    return { kind: 'query', range: 'day', date: date || today };
  }
  if (/^how many (?:points|stars)/i.test(lower)) {
    const { ids } = extractPeople(text, people);
    return { kind: 'points_query', people: ids };
  }

  // ---- countdown ----
  let m = text.match(/^(?:add\s+(?:a\s+)?)?count\s*down\s+(?:to|for|until)?\s*(.+)$/i);
  if (m) {
    const { date, rest } = extractDate(m[1], today);
    const title = cap(stripFiller(rest.replace(/\b(?:on|is)\s*$/i, '')));
    if (!date) return { kind: 'error', reply: `What date is ${title || 'that'}?` };
    return { kind: 'countdown', title: title || 'Big day', date };
  }

  // ---- list items ----
  const listNames = lists.map((l) => l.name.toLowerCase());
  const listAlias = (n) => {
    n = n.toLowerCase().replace(/\s+list$/, '').trim();
    if (/^(?:grocery|groceries|shopping|store|food)$/.test(n)) n = 'groceries';
    if (/^(?:todo|to do|to-do|honey ?do)$/.test(n)) n = 'to-do';
    const exact = lists.find((l) => l.name.toLowerCase() === n);
    if (exact) return exact;
    return lists.find((l) => l.name.toLowerCase().startsWith(n) || n.startsWith(l.name.toLowerCase().split(' ')[0]));
  };
  m = text.match(/^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on|onto)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+list)?$/i);
  if (m && !/\b(?:calendar|schedule)\b/i.test(m[2])) {
    const list = listAlias(m[2]);
    if (list) return listItems(m[1], list);
  }
  m = text.match(/^(grocery|groceries|shopping|to-?do|todo|hardware(?:\s+store)?)(?:\s+list)?\s*[:,-]?\s+(.+)$/i);
  if (m) {
    const list = listAlias(m[1]);
    if (list) return listItems(m[2], list);
  }
  m = text.match(/^(?:we\s+need|we're\s+out\s+of|we\s+are\s+out\s+of|out\s+of|buy|pick\s+up|get)\s+(?:some\s+|more\s+)?(.+)$/i);
  if (m && !extractTime(m[1]).start) {
    const list = listAlias('groceries') || lists[0];
    if (list) return listItems(m[1], list);
  }

  // ---- meals ----
  m = text.match(/\b(breakfast|lunch|dinner|supper|snack)\b/i);
  if (m && (/^(?:breakfast|lunch|dinner|supper|snack)\b/i.test(text) || /\bfor\s+(?:breakfast|lunch|dinner|supper|snack)\b/i.test(text) || /^meal\b/i.test(text)) &&
      !/\b(?:at|with)\s+[A-Z][a-z]+'?s?\b.*\b(?:house|place)\b/.test(text) && !extractTime(text).start) {
    const slot = m[1].toLowerCase().replace('supper', 'dinner');
    let rest = text.replace(/^meal\s*[:,-]?\s*/i, '').replace(new RegExp('\\b(?:for\\s+)?' + m[1] + '\\b\\s*(?:is|will be|[:,-])?', 'i'), ' ');
    const d = extractDate(rest, today);
    const title = cap(stripFiller(d.rest.replace(/\b(?:we're having|we are having|having|make|eat|is)\b/gi, ' ')));
    if (title) return { kind: 'meal', slot, date: d.date || today, title };
  }

  // ---- chores ----
  if (/\bchores?\b/i.test(text)) {
    let rest = text.replace(/^(?:add|new|make|create)?\s*(?:a\s+)?(?:new\s+)?chores?\s*(?:for)?\s*[:,-]?\s*/i, '').replace(/\bchores?\b/i, ' ');
    const pts = extractPoints(rest);
    rest = pts.rest;
    const pp = extractPeople(rest, people);
    rest = pp.rest;
    const rp = extractRepeat(rest, today);
    rest = rp.rest;
    let one_time_date = null, days = rp.repeat === 'monthly_nth' ? [rp.days.day] : rp.repeat === 'semimonthly' ? null : rp.days;
    if (!rp.repeat) {
      const d = extractDate(rest, today);
      rest = d.rest;
      if (d.date) one_time_date = d.date;
      else days = [0, 1, 2, 3, 4, 5, 6];
    }
    if (!days) days = rp.repeat === 'weekly' && rp.date ? [dow(rp.date)] : [0, 1, 2, 3, 4, 5, 6];
    let time_of_day = 'any';
    const tod = rest.match(/\b(?:in the\s+|every\s+|each\s+)?(morning|afternoon|evening|night|bedtime|after school|before school)\b/i);
    if (tod) {
      const v = tod[1].toLowerCase();
      time_of_day = /morning|before/.test(v) ? 'morning' : /afternoon|after school/.test(v) ? 'afternoon' : 'evening';
      rest = rest.replace(tod[0], ' ');
    }
    const title = cap(stripFiller(rest.replace(/^\s*(?:to|needs to|has to|should|must)\s+/i, '')));
    if (!title) return { kind: 'error', reply: 'What is the chore?' };
    const person = pp.ids[0] ?? null;
    return {
      kind: 'chore', title, person_id: person, extra_people: pp.ids.slice(1),
      points: pts.points ?? (person && people.find((p) => p.id === person)?.is_kid ? 5 : 0),
      days, one_time_date, time_of_day,
    };
  }

  // ---- event (default) ----
  let rest = text;
  const rp = extractRepeat(rest, today);
  rest = rp.rest;
  const dt = extractDate(rest, today);
  rest = dt.rest;
  const tm = extractTime(rest);
  rest = tm.rest;
  const pp = extractPeople(rest, people);
  rest = pp.rest;
  rest = rest.replace(/\ball[\s-]day\b/i, ' ');
  let location = null;
  const lm = rest.match(/\s(?:at|@)\s+((?:the\s+)?[A-Za-z0-9'][\w'&.\- ]{1,40})$/i);
  if (lm) {
    location = clean(lm[1]);
    rest = rest.replace(lm[0], ' ');
  }
  let title = cap(stripFiller(rest));
  if (!title) return { kind: 'error', reply: "I didn't catch what the event is." };
  let date = dt.date || rp.date;
  if (!date && rp.repeat === 'weekly' && rp.days) date = rp.days.map((w) => nextWeekday(today, w, false)).sort()[0];
  if (!date) {
    date = today;
    // a time that already passed today with no date probably means tomorrow
  }
  return {
    kind: 'event',
    title,
    start_date: date,
    start_time: tm.start,
    end_time: tm.start ? tm.end : null,
    people: pp.ids,
    location,
    repeat: rp.repeat,
    weekly_days: rp.repeat === 'monthly_nth' || rp.repeat === 'semimonthly' ? rp.days : rp.repeat === 'weekly' && rp.days && rp.days.length > 1 ? rp.days : null,
    guessed_date: !dt.date && !rp.date,
  };

  function listItems(str, list) {
    const items = str
      .split(/\s*(?:,|\band\b|&|\+|;)\s*/i)
      .map((s) => clean(s.replace(/^(?:some|more|a|an|the)\s+/i, '')))
      .filter(Boolean)
      .map(cap);
    if (!items.length) return { kind: 'error', reply: 'What should I add?' };
    return { kind: 'list', list_id: list.id, list_name: list.name, items };
  }
}

// ---- friendly descriptions for Siri replies ----
export function friendlyDate(iso, today) {
  if (iso === today) return 'today';
  if (iso === addDays(today, 1)) return 'tomorrow';
  const d = fromISO(iso);
  const diff = (d - fromISO(today)) / 86400000;
  const wd = WEEKDAYS[d.getUTCDay()];
  const md = cap(MONTHS[d.getUTCMonth()]) + ' ' + d.getUTCDate();
  if (diff > 0 && diff < 7) return cap(wd) + ', ' + md;
  return cap(wd) + ', ' + md;
}
export function friendlyTime(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
}
export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
