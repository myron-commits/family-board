import { addDays, dow, fromISO, eventsOn, choresOn, fmtTime, localNowHHMM, localToday, daysBetween } from './shared.js';

// ================== state ==================
const S = {
  key: getKey(),
  data: null,
  view: localStorage.getItem('fb.view') || 'today',
  weekStart: null,
  monthAnchor: null,
  choreTime: 'all',
  rewardKid: null,
  listId: null,
  lastTouch: Date.now(),
  wakeUntil: 0,
  saverIdx: 0,
};
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function getKey() {
  const u = new URL(location.href);
  const k = u.searchParams.get('key');
  if (k) {
    try { localStorage.setItem('fb.key', k); } catch {}
    u.searchParams.delete('key');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    return k;
  }
  try { return localStorage.getItem('fb.key') || ''; } catch { return ''; }
}

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-family-key': S.key },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { showGate(); throw new Error('key'); }
  if (!res.ok || data.ok === false) throw new Error(data.error || data.reply || 'Something went wrong');
  return data;
}


// color tints computed here (older tablet browsers lack CSS color-mix)
function mix(hex, other, t) {
  const h = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const a = h(hex), b = h(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function cv(hex) {
  hex = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#1d2433';
  return `--c:${hex};--ct:${mix(hex, '#ffffff', 0.86)};--cl:${mix(hex, '#ffffff', 0.92)};--cs:${mix(hex, '#ffffff', 0.45)};--cd:${mix(hex, '#000000', 0.28)}`;
}

// ================== data helpers ==================
const tz = () => S.data?.settings?.tz || 'America/Indiana/Indianapolis';
const today = () => localToday(tz());
const person = (id) => S.data.people.find((p) => p.id === id);
const peopleOf = (ev) => { try { return JSON.parse(ev.people || '[]'); } catch { return []; } };
const colorOf = (ev) => { const ids = peopleOf(ev); return ids.length ? person(ids[0])?.color || '#1d2433' : '#1d2433'; };
const kids = () => S.data.people.filter((p) => p.is_kid);
const pts = (id) => S.data.points[id] || 0;
const isDone = (choreId, date) => S.data.done.some((d) => d.chore_id === choreId && d.date === date);
const mealOf = (date, slot) => S.data.meals.find((m) => m.date === date && m.slot === slot);
const prettyDate = (iso) => { const d = fromISO(iso); return `${WDL[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const shortDate = (iso) => { const d = fromISO(iso); return `${MON[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`; };

async function load() {
  try {
    const t = S.data ? today() : localToday();
    const from = addDays(t, -60), to = addDays(t, 120);
    S.data = await api(`state?from=${from}&to=${to}`);
    if (!S.weekStart) S.weekStart = S.data.today;
    if (!S.monthAnchor) S.monthAnchor = S.data.today.slice(0, 8) + '01';
    if (!S.listId && S.data.lists[0]) S.listId = S.data.lists[0].id;
    if (!S.rewardKid && kids()[0]) S.rewardKid = kids()[0].id;
    render();
  } catch (e) {
    if (e.message !== 'key') console.warn(e);
  }
}

// ================== frame ==================
const NAV = [
  ['today', '🏠', 'Today'], ['week', '🗓️', 'Week'], ['month', '📅', 'Month'], ['chores', '✅', 'Chores'],
  ['rewards', '⭐', 'Rewards'], ['lists', '🛒', 'Lists'], ['meals', '🍲', 'Meals'], ['photos', '🖼️', 'Photos'],
];

function render() {
  if (!S.data) return;
  const root = $('#root');
  if (!$('.app', root)) {
    root.innerHTML = `
      <div class="app">
        <nav class="rail" aria-label="Sections"></nav>
        <div class="main">
          <header class="top"></header>
          <section class="view-wrap" id="view"></section>
        </div>
      </div>
      <button class="fab" data-act="quick"><span class="plus">+</span> Add</button>
      <div class="saver" id="saver"></div>
      <div class="night" id="night"></div>`;
  }
  $('.rail').innerHTML = NAV.map(([k, i, l]) => `<button data-nav="${k}" aria-current="${S.view === k}"><span class="ico">${i}</span>${l}</button>`).join('') +
    `<div class="spacer"></div><button data-nav="settings" aria-current="${S.view === 'settings'}"><span class="ico">⚙️</span>Settings</button>`;
  renderTop();
  const v = $('#view');
  const scroll = v.scrollTop;
  v.innerHTML = (VIEWS[S.view] || VIEWS.today)();
  v.scrollTop = scroll;
}

function renderTop() {
  const now = new Date();
  const hm = new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const h = hm.find((p) => p.type === 'hour').value, m = hm.find((p) => p.type === 'minute').value;
  const ap = hm.find((p) => p.type === 'dayPeriod')?.value.toLowerCase() || '';
  const t = today();
  const cd = S.data.countdowns[0];
  const w = S.weather;
  $('.top').innerHTML = `
    <div class="clock">${h}:${m}<small>${ap}</small></div>
    <div class="dateline">${WDL[dow(t)]}<span>${MON[fromISO(t).getUTCMonth()]} ${fromISO(t).getUTCDate()}, ${fromISO(t).getUTCFullYear()}</span></div>
    ${w ? `<div class="weather"><div class="wi">${w.icon}</div><div><b>${w.temp}°</b><span>${esc(w.text)} · ${w.hi}° / ${w.lo}°</span></div></div>` : ''}
    <div class="grow"></div>
    ${cd ? `<button class="countdown-chip" data-act="countdowns"><span style="font-size:1.6rem">${cd.emoji || '🎉'}</span><span class="num">${daysBetween(t, cd.date)}</span><span class="lbl">days to<br>${esc(cd.title)}</span></button>` : `<button class="countdown-chip" data-act="countdowns"><span style="font-size:1.3rem">⏳</span><span class="lbl">Add a countdown</span></button>`}`;
}

// ================== views ==================
const VIEWS = {};

// ---------- TODAY (family lanes) ----------
VIEWS.today = () => {
  const t = today();
  const nowHM = localNowHHMM(tz());
  const evs = eventsOn(S.data.events, t);
  const chores = choresOn(S.data.chores, t);
  const lanes = S.data.people.map((p) => {
    const mine = evs.filter((e) => peopleOf(e).includes(p.id));
    const myChores = chores.filter((c) => c.person_id === p.id);
    const doneCount = myChores.filter((c) => isDone(c.id, t)).length;
    return `
      <div class="lane" style="${cv(p.color)}">
        <div class="lane-head">
          <div class="face" style="${cv(p.color)}">${p.emoji || ''}</div>
          <h3>${esc(p.nickname && !p.is_kid ? p.nickname : p.name)}</h3>
          ${p.is_kid ? `<span class="pts">⭐ ${pts(p.id)}</span>` : ''}
        </div>
        <div class="lane-body">
          ${mine.map((e) => evHTML(e, t, nowHM, p.id)).join('') || (myChores.length ? '' : '<div class="empty">Nothing today</div>')}
          ${myChores.length ? `<div class="lane-sub">Chores · ${doneCount} of ${myChores.length}</div>` + myChores.map((c) => choreHTML(c, t, p.color)).join('') : ''}
          ${myChores.length && doneCount === myChores.length ? `<div class="celebrate">All done! 🎉</div>` : ''}
        </div>
      </div>`;
  });
  const fam = evs.filter((e) => peopleOf(e).length === 0);
  const famLane = `
    <div class="lane family">
      <div class="lane-head"><div class="face" style="${cv('#1d2433')}">🏡</div><h3>Everyone</h3></div>
      <div class="lane-body">${fam.map((e) => evHTML(e, t, nowHM)).join('') || '<div class="empty">Nothing for the whole family</div>'}</div>
    </div>`;
  const dinner = mealOf(t, 'dinner');
  const tmr = eventsOn(S.data.events, addDays(t, 1));
  return `
    <div class="today-grid">
      <div class="lanes">${famLane}${lanes.join('')}</div>
      <div class="dinner-strip">
        <span class="em">🍲</span>
        ${dinner ? `<span>Dinner tonight</span><b>${esc(dinner.title)}</b>` : `<button class="btn" data-act="meal" data-date="${t}" data-slot="dinner">Plan tonight's dinner</button>`}
        <span style="margin-left:auto">${tmr.length ? `Tomorrow: ${tmr.slice(0, 3).map((e) => esc(e.title) + (e.start_time ? ' ' + fmtTime(e.start_time) : '')).join(' · ')}${tmr.length > 3 ? ` +${tmr.length - 3}` : ''}` : 'Nothing on tomorrow yet'}</span>
      </div>
    </div>`;
};

function evHTML(e, date, nowHM, laneId) {
  const ids = peopleOf(e);
  const c = laneId ? person(laneId).color : colorOf(e);
  const others = ids.filter((i) => i !== laneId);
  let cls = '';
  if (date === today() && e.start_time && nowHM) {
    if ((e.end_time || e.start_time) < nowHM) cls = 'past';
    else if (e.start_time <= nowHM) cls = 'now';
  }
  const time = e.start_time ? `${fmtTime(e.start_time)}${e.end_time ? '–' + fmtTime(e.end_time) : ''}` : 'All day';
  return `<button class="ev ${cls}" style="${cv(c)}" data-act="event" data-id="${e.id}" data-date="${date}">
    <div class="t">${esc(e.title)}</div>
    <div class="w">${time}${e.location ? ` · ${esc(e.location)}` : ''}${e.repeat ? ' · 🔁' : ''}
      ${others.length ? `<span class="others">${others.map((i) => `<i class="dot" style="background:${person(i)?.color}"></i>`).join('')}</span>` : ''}</div>
  </button>`;
}

function choreHTML(c, date, color) {
  const done = isDone(c.id, date);
  return `<button class="chore ${done ? 'done' : ''}" style="${cv(color)}" data-act="chore" data-id="${c.id}" data-date="${date}" aria-pressed="${done}">
    <span class="em">${c.emoji || '⭐'}</span>
    <span class="t">${esc(c.title)}${c.points ? `<span class="p">${c.points} points</span>` : ''}</span>
    <span class="tick">${done ? '✓' : ''}</span>
  </button>`;
}

// ---------- WEEK ----------
VIEWS.week = () => {
  const start = S.weekStart;
  const t = today();
  const nowHM = localNowHHMM(tz());
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const label = `${shortDate(days[0])} – ${shortDate(days[6])}`;
  return `
    <div class="cal-nav">
      <h2>${label}</h2>
      <button class="btn round" data-act="wk" data-n="-7" aria-label="Previous week">‹</button>
      <button class="btn" data-act="wk" data-n="0">This week</button>
      <button class="btn round" data-act="wk" data-n="7" aria-label="Next week">›</button>
    </div>
    <div class="week">
      ${days.map((d) => {
        const evs = eventsOn(S.data.events, d);
        const din = mealOf(d, 'dinner');
        return `<div class="wday ${d === t ? 'is-today' : ''}">
          <div class="wday-h"><b>${fromISO(d).getUTCDate()}</b><span>${WD[dow(d)]}</span></div>
          <div class="wday-b">
            ${evs.map((e) => evHTML(e, d, d === t ? nowHM : null)).join('')}
            <button class="add-hit" data-act="new-event" data-date="${d}" aria-label="Add to ${WDL[dow(d)]}"></button>
          </div>
          ${din ? `<div class="meal-mini">🍲 ${esc(din.title)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
};

// ---------- MONTH ----------
VIEWS.month = () => {
  const a = fromISO(S.monthAnchor);
  const first = S.monthAnchor;
  const startPad = dow(first);
  const gridStart = addDays(first, -startPad);
  const t = today();
  const cells = [...Array(42)].map((_, i) => addDays(gridStart, i));
  const maxShow = isPhone() ? 4 : 3;
  return `
    <div class="cal-nav">
      <h2>${MON[a.getUTCMonth()]} ${a.getUTCFullYear()}</h2>
      <button class="btn round" data-act="mo" data-n="-1" aria-label="Previous month">‹</button>
      <button class="btn" data-act="mo" data-n="0">Today</button>
      <button class="btn round" data-act="mo" data-n="1" aria-label="Next month">›</button>
    </div>
    <div class="mhead">${WD.map((d) => `<div>${d}</div>`).join('')}</div>
    <div class="month">
      ${cells.map((d) => {
        const evs = eventsOn(S.data.events, d);
        const out = d.slice(0, 7) !== first.slice(0, 7);
        return `<button class="mcell ${out ? 'out' : ''} ${d === t ? 'is-today' : ''}" data-act="day" data-date="${d}">
          <span class="n">${fromISO(d).getUTCDate()}</span>
          ${evs.slice(0, maxShow).map((e) => `<span class="mev" style="${cv(colorOf(e))}">${e.start_time ? fmtTime(e.start_time) + ' ' : ''}${esc(e.title)}</span>`).join('')}
          ${evs.length > maxShow ? `<span class="more">+${evs.length - maxShow} more</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
};

// ---------- CHORES ----------
VIEWS.chores = () => {
  const t = today();
  const all = choresOn(S.data.chores, t);
  const f = S.choreTime;
  const filtered = f === 'all' ? all : all.filter((c) => c.time_of_day === f || c.time_of_day === 'any');
  const seg = [['all', 'All day'], ['morning', '☀️ Morning'], ['afternoon', '🌤️ Afternoon'], ['evening', '🌙 Evening']];
  return `
    <div class="cal-nav">
      <h2>Today's chores</h2>
      <div class="seg">${seg.map(([k, l]) => `<button data-act="chore-time" data-k="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      <div style="flex:1"></div>
      <button class="btn" data-act="manage-chores">Edit chores</button>
    </div>
    <div class="lanes">
      ${S.data.people.map((p) => {
        const mine = filtered.filter((c) => c.person_id === p.id);
        const allMine = all.filter((c) => c.person_id === p.id);
        const done = allMine.filter((c) => isDone(c.id, t)).length;
        const pct = allMine.length ? Math.round((done / allMine.length) * 100) : 0;
        return `<div class="lane" style="${cv(p.color)}">
          <div class="lane-head">
            <div class="face" style="${cv(p.color)}">${p.emoji || ''}</div>
            <h3>${esc(p.nickname && !p.is_kid ? p.nickname : p.name)}</h3>
            ${p.is_kid ? `<span class="pts">⭐ ${pts(p.id)}</span>` : ''}
          </div>
          ${allMine.length ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
          <div class="lane-body">
            ${mine.map((c) => choreHTML(c, t, p.color)).join('') || '<div class="empty">No chores here</div>'}
            ${allMine.length && done === allMine.length ? `<div class="celebrate">All done today! 🎉</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
};

// ---------- REWARDS ----------
VIEWS.rewards = () => {
  const k = person(S.rewardKid) || kids()[0];
  if (!k) return '<p class="empty">Add a kid in Settings to use rewards.</p>';
  const bal = pts(k.id);
  const ORDER = ['Screen time', 'Privilege', 'Treat', 'Time together', 'Outing', 'Money', 'Big reward'];
  const cats = [...new Set(S.data.rewards.map((r) => r.category || 'Rewards'))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const hist = S.data.log.filter((l) => l.person_id === k.id).slice(0, 12);
  return `
    <div class="rw-layout">
      <div class="kids">
        ${kids().map((p) => `<button class="kid" style="${cv(p.color)}" data-act="reward-kid" data-id="${p.id}" aria-pressed="${p.id === k.id}">
          <div class="face" style="${cv(p.color)}">${p.emoji}</div><div><b>${esc(p.name)}</b><span style="color:var(--slate);font-size:.85rem">tap to shop</span></div>
          <span class="bal">${pts(p.id)}<small>pts</small></span></button>`).join('')}
        <button class="btn" data-act="bonus">⭐ Give or take points</button>
        <button class="btn ghost" data-act="manage-rewards">Edit rewards</button>
        <div class="history">
          <ul>${hist.map((l) => `<li><span>${esc(l.reason || '')}</span><span class="d ${l.delta > 0 ? 'plus' : 'minus'}">${l.delta > 0 ? '+' : ''}${l.delta}</span></li>`).join('') || '<li class="empty">No points yet — do a chore!</li>'}</ul>
        </div>
      </div>
      <div class="shop" style="${cv(k.color)}">
        ${cats.map((cat) => `<h3>${esc(cat)}</h3><div class="rgrid">${S.data.rewards.filter((r) => (r.category || 'Rewards') === cat).map((r) => {
          const can = bal >= r.cost;
          return `<button class="reward ${can ? '' : 'locked'}" data-act="redeem" data-id="${r.id}">
            <span class="em">${r.emoji || '🎁'}</span><span class="t">${esc(r.title)}</span>
            <span class="c">${r.cost} pts</span>
            ${can ? '' : `<span class="meter"><i style="width:${Math.min(100, Math.round((bal / r.cost) * 100))}%"></i></span><span class="need">${r.cost - bal} more to go</span>`}
          </button>`;
        }).join('')}</div>`).join('')}
      </div>
    </div>`;
};

// ---------- LISTS ----------
const qty = (ids) => Object.entries(ids.reduce((m, id) => ((m[id] = (m[id] || 0) + 1), m), {}));
const STORES = {
  amazon: { name: 'Amazon', search: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    cart: (ids) => 'https://www.amazon.com/gp/aws/cart/add.html?' + qty(ids).map(([id, n], i) => `ASIN.${i + 1}=${id}&Quantity.${i + 1}=${n}`).join('&') },
  walmart: { name: 'Walmart', search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
    cart: (ids) => 'https://affil.walmart.com/cart/addToCart?items=' + qty(ids).map(([id, n]) => `${id}|${n}`).join(',') },
};
const storeOf = (list) => (/amazon/i.test(list?.name || '') ? 'amazon' : /walmart/i.test(list?.name || '') ? 'walmart' : null);

VIEWS.lists = () => {
  const list = S.data.lists.find((l) => l.id === S.listId) || S.data.lists[0];
  if (!list) return `<button class="btn ink" data-act="new-list">Make a list</button>`;
  const items = S.data.items.filter((i) => i.list_id === list.id);
  const doneN = items.filter((i) => i.done).length;
  const store = storeOf(list);
  const ready = items.filter((i) => !i.done && i.pid);
  const needLink = items.filter((i) => !i.done && !i.pid).length;
  return `
    <div class="lists-layout">
      <div class="list-tabs">
        ${S.data.lists.map((l) => `<button class="list-tab" data-act="list" data-id="${l.id}" aria-current="${l.id === list.id}">
          <span class="em">${l.emoji || '📝'}</span>${esc(l.name)}<span class="cnt">${S.data.items.filter((i) => i.list_id === l.id && !i.done).length}</span></button>`).join('')}
        <button class="btn ghost" data-act="new-list">+ New list</button>
      </div>
      <div class="list-panel">
        <div class="cal-nav" style="margin-bottom:.3rem"><h2>${list.emoji || ''} ${esc(list.name)}</h2><div style="flex:1"></div>
          ${doneN ? `<button class="btn" data-act="clear-done" data-id="${list.id}">Clear ${doneN} checked</button>` : ''}
          <button class="btn ghost" data-act="edit-list" data-id="${list.id}">Rename</button></div>
        ${store ? `<div class="store-bar">
          <button class="btn ink" data-act="send-cart" data-id="${list.id}" ${ready.length ? '' : 'disabled'}>🛒 Send ${ready.length || ''} to ${STORES[store].name} cart</button>
          <span>${needLink ? `${needLink} item${needLink > 1 ? 's' : ''} still need${needLink > 1 ? '' : 's'} a product picked. Tap 🔗 Link.` : ready.length ? 'Everything is linked and ready.' : 'Add items below.'}</span>
        </div>` : ''}
        <form class="add-row" data-form="add-item" data-id="${list.id}">
          <input class="field" name="text" placeholder="Add to ${esc(list.name)} — separate with commas" autocomplete="off" enterkeyhint="done">
          <button class="btn ink">Add</button>
        </form>
        <ul class="items">
          ${items.map((i) => `<li class="item ${i.done ? 'done' : ''}">
            <button class="box" data-act="item" data-id="${i.id}" aria-label="${i.done ? 'Uncheck' : 'Check'} ${esc(i.text)}">${i.done ? '✓' : ''}</button>
            <button class="txt" data-act="item" data-id="${i.id}">${esc(i.text)}</button>
            ${store && !i.done ? (i.pid ? `<button class="link-chip on" data-act="link-item" data-id="${i.id}">✓ Linked</button>` : `<button class="link-chip" data-act="link-item" data-id="${i.id}">🔗 Link</button>`) : ''}
            <button class="x" data-act="del-item" data-id="${i.id}" aria-label="Remove ${esc(i.text)}">✕</button></li>`).join('') || `<li class="empty">Nothing on this list. Type above, or tell Siri "add milk to ${esc(list.name.toLowerCase())}".</li>`}
        </ul>
      </div>
    </div>`;
};

function linkItem(item) {
  const list = S.data.lists.find((l) => l.id === item.list_id);
  const store = storeOf(list);
  const st = STORES[store];
  const el = sheet(`<h2>Link “${esc(item.text)}”</h2>
    <p style="color:var(--slate);margin-top:0">Pick the exact product once. Next time anyone adds “${esc(item.text)}” to ${st.name}, it links itself.</p>
    <div class="link-steps">
      <div><b>1.</b> <a class="btn" href="${st.search(item.text)}" target="_blank" rel="noopener">🔎 Find it on ${st.name}</a></div>
      <div><b>2.</b> On the product page, tap <b>Share → Copy Link</b>.</div>
      <div><b>3.</b> Come back and paste it here:</div>
    </div>
    <form><input class="field say-big" name="url" placeholder="Paste the ${st.name} link" value="" autocomplete="off" style="width:100%">
      <div class="result err" id="link-err" hidden></div>
      <div class="actions">
        ${item.pid ? '<button type="button" class="btn danger left" data-unlink>Unlink</button>' : ''}
        <button type="button" class="btn" data-x>Cancel</button><button class="btn ink">Save link</button>
      </div></form>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    if (e.target.closest('[data-unlink]')) { await api(`items/${item.id}/link`, { method: 'POST', body: { url: '' } }); closeSheet(); toast('Unlinked'); load(); }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    if (!url) return;
    try {
      await api(`items/${item.id}/link`, { method: 'POST', body: { url } });
      closeSheet(); toast(`Linked to ${st.name}`); load();
    } catch (err) {
      const box = el.querySelector('#link-err'); box.hidden = false; box.textContent = err.message;
    }
  });
}

async function sendToCart(listId) {
  const list = S.data.lists.find((l) => l.id === listId);
  const store = storeOf(list);
  const ready = S.data.items.filter((i) => i.list_id === listId && !i.done && i.pid);
  if (!ready.length) return toast('Link at least one item first');
  window.open(STORES[store].cart(ready.map((i) => i.pid)), '_blank', 'noopener');
  await api('items/mark-done', { method: 'POST', body: { ids: ready.map((i) => i.id) } });
  toast(`Sent ${ready.length} to your ${STORES[store].name} cart. Check out there when you're ready.`);
  load();
}

// ---------- MEALS ----------
VIEWS.meals = () => {
  const start = S.weekStart;
  const t = today();
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const slots = [['breakfast', '🥞 Breakfast'], ['lunch', '🥪 Lunch'], ['dinner', '🍲 Dinner']];
  return `
    <div class="cal-nav">
      <h2>Meal plan</h2>
      <button class="btn round" data-act="wk" data-n="-7" aria-label="Previous week">‹</button>
      <button class="btn" data-act="wk" data-n="0">This week</button>
      <button class="btn round" data-act="wk" data-n="7" aria-label="Next week">›</button>
      <div style="flex:1"></div>
      <button class="btn" data-act="meals-to-groceries">🛒 Add this week's ingredients to Groceries</button>
    </div>
    <div class="meals">
      <div></div>
      ${days.map((d) => `<div class="h ${d === t ? 'is-today' : ''}">${WD[dow(d)]}<span>${shortDate(d)}</span></div>`).join('')}
      ${slots.map(([s, l]) => `<div class="slot">${l}</div>` + days.map((d) => {
        const m = mealOf(d, s);
        let ing = [];
        try { ing = JSON.parse(m?.ingredients || '[]'); } catch {}
        return m ? `<button class="mealcell" data-act="meal" data-date="${d}" data-slot="${s}"><b>${esc(m.title)}</b>${ing.length ? `<span class="ing">${ing.length} ingredient${ing.length > 1 ? 's' : ''}</span>` : ''}</button>`
          : `<button class="mealcell empty-cell" data-act="meal" data-date="${d}" data-slot="${s}" aria-label="Plan ${s} ${shortDate(d)}">+</button>`;
      }).join('')).join('')}
    </div>`;
};

// ---------- PHOTOS ----------
VIEWS.photos = () => `
  <div class="cal-nav"><h2>Family photos</h2><div style="flex:1"></div>
    <label class="btn ink">📷 Add photos<input type="file" accept="image/*" multiple hidden data-act="upload"></label>
    <button class="btn" data-act="saver-now">▶ Play slideshow</button></div>
  <p style="color:var(--slate);margin:0 0 .8rem">Photos play as a slideshow after ${esc(S.data.settings.photo_idle_minutes || 10)} minutes without a touch. Add them from your phone.</p>
  <div class="photos-grid">
    ${S.data.photos.map((p) => `<figure><img loading="lazy" src="${photoURL(p.id)}" alt="${esc(p.caption || 'Family photo')}"><button class="del" data-act="del-photo" data-id="${p.id}" aria-label="Delete photo">✕</button></figure>`).join('') || '<p class="empty">No photos yet.</p>'}
  </div>`;
const photoURL = (id) => `/api/photos/${id}?key=${encodeURIComponent(S.key)}`;

// ---------- SETTINGS ----------
VIEWS.settings = () => {
  const s = S.data.settings;
  const link = `${location.origin}/?key=${encodeURIComponent(S.key)}`;
  return `
    <div class="cal-nav"><h2>Settings</h2></div>
    <div class="list-panel settings-list" style="max-width:46rem">
      <div class="row"><span><b>Family</b><br><span style="color:var(--slate)">Names, colors, and emoji</span></span><button class="btn" data-act="edit-people">Edit people</button></div>
      <div class="row"><span><b>Night mode</b><br><span style="color:var(--slate)">Screen dims ${esc(s.night_start)} – ${esc(s.night_end)}</span></span><button class="btn" data-act="edit-settings">Change</button></div>
      <div class="row"><span><b>Weather</b><br><span style="color:var(--slate)">${esc(s.city || '')}</span></span><button class="btn" data-act="edit-settings">Change</button></div>
      <div class="row"><span><b>Parent PIN</b><br><span style="color:var(--slate)">Needed to spend points and change rewards</span></span><button class="btn" data-act="edit-settings">Change</button></div>
      <div class="row"><span><b>Countdowns</b></span><button class="btn" data-act="countdowns">Manage</button></div>
      <div class="row" style="border:0"><span><b>Phone link</b><br><span style="color:var(--slate);font-size:.85rem;user-select:all;word-break:break-all">${esc(link)}</span></span><button class="btn" data-act="copy-link">Copy</button></div>
      <p style="color:var(--slate);font-size:.85rem">Open the phone link on each phone, then use Share → Add to Home Screen. Siri setup is in the setup guide.</p>
    </div>`;
};

// ================== sheets (modals) ==================
function sheet(html, onMount) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'scrim';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
  document.body.appendChild(el);
  onMount?.(el.firstElementChild);
  const f = el.querySelector('[autofocus]');
  if (f && !isTouchWall()) f.focus();
  return el.firstElementChild;
}
const closeSheet = () => document.querySelectorAll('.scrim').forEach((s) => s.remove());
const isTouchWall = () => !isPhone() && matchMedia('(pointer: coarse)').matches;

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function confetti(emojis = ['⭐', '🎉', '✨', '🌟']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('div');
  c.className = 'confetti';
  c.innerHTML = [...Array(22)].map(() => `<i style="left:${Math.random() * 100}%;animation-delay:${Math.random() * .5}s">${emojis[Math.floor(Math.random() * emojis.length)]}</i>`).join('');
  document.body.appendChild(c);
  setTimeout(() => c.remove(), 2400);
}

// ---------- PIN pad ----------
function askPin(title = 'Parent PIN') {
  return new Promise((resolve) => {
    let pin = '';
    const el = sheet(`<h2 style="text-align:center">${esc(title)}</h2><p style="text-align:center;color:var(--slate);margin:0">Mom or Dad, enter the PIN</p>
      <div class="pindots">${'<i></i>'.repeat(4)}</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((n) => n === '' ? '<span></span>' : `<button data-n="${n}">${n}</button>`).join('')}</div>
      <div class="actions"><button class="btn" data-x>Cancel</button></div>`);
    const dots = () => el.querySelectorAll('.pindots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-x]')) { closeSheet(); resolve(null); return; }
      const b = e.target.closest('[data-n]');
      if (!b) return;
      if (b.dataset.n === '⌫') pin = pin.slice(0, -1); else if (pin.length < 8) pin += b.dataset.n;
      dots();
      if (pin.length >= 4) {
        const r = await api('pin-check', { method: 'POST', body: { pin } }).catch(() => ({ ok: false }));
        if (r.ok) { closeSheet(); resolve(pin); }
        else if (pin.length >= 6) { pin = ''; dots(); toast('Wrong PIN'); }
      }
    });
  });
}

// ---------- Quick add ----------
const EXAMPLES = ['Dentist Thursday 3pm Mom', 'Soccer every Tuesday 5:30 Ian', 'Add milk and eggs to groceries', 'Tacos for dinner Friday',
  'Chore Avalia feed the cat every day 5 points', 'Countdown Christmas Dec 25', "What's on tomorrow"];
function quickAdd() {
  const el = sheet(`<h2>Add anything</h2>
    <form data-form="say"><input class="field say-big" name="text" placeholder="Type it like a text message…" autocomplete="off" autofocus enterkeyhint="send"></form>
    <div class="examples">${EXAMPLES.map((x) => `<button data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div id="say-out"></div>
    <div class="actions">
      <button class="btn left" data-act="new-event">More options: event form</button>
      <button class="btn" data-x>Done</button>
      <button class="btn ink" data-go>Add</button>
    </div>`);
  const input = el.querySelector('input');
  const go = async () => {
    const text = input.value.trim();
    if (!text) return;
    const out = el.querySelector('#say-out');
    try {
      const r = await api('say', { method: 'POST', body: { text } });
      out.innerHTML = `<div class="result ${r.ok ? '' : 'err'}">${r.ok ? '✓' : '!'} ${esc(r.reply)}${r.undo ? `<button class="btn" data-undo='${esc(JSON.stringify(r.undo))}'>Undo</button>` : ''}</div>`;
      if (r.ok) { input.value = ''; load(); }
    } catch (e) { out.innerHTML = `<div class="result err">${esc(e.message)}</div>`; }
  };
  el.addEventListener('submit', (e) => { e.preventDefault(); go(); });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    if (e.target.closest('[data-go]')) return go();
    const ex = e.target.closest('[data-ex]');
    if (ex) { input.value = ex.dataset.ex; input.focus(); }
    const u = e.target.closest('[data-undo]');
    if (u) { await api('undo', { method: 'POST', body: JSON.parse(u.dataset.undo) }); el.querySelector('#say-out').innerHTML = `<div class="result">Undone.</div>`; load(); }
  });
}


// ================== tap pickers (no scrolling wheels) ==================
// Date: quick chips + a small month you tap. Writes YYYY-MM-DD into input[name].
function datePicker(name, value, { chips = true } = {}) {
  return `<div class="dp" data-dp="${name}" data-month="${(value || today()).slice(0, 8)}01">
    <input type="hidden" name="${name}" value="${value || ''}">
    <div class="dp-sel"></div>
    ${chips ? '<div class="dp-chips"></div>' : ''}
    <div class="dp-cal"></div>
  </div>`;
}
function drawDatePicker(root) {
  const t = today();
  const input = root.querySelector('input');
  const val = input.value;
  root.querySelector('.dp-sel').innerHTML = val ? `<b>${prettyDate(val)}</b>${val === t ? ' · today' : val === addDays(t, 1) ? ' · tomorrow' : ''}` : '<span style="color:var(--slate)">Tap a day</span>';
  const chipsEl = root.querySelector('.dp-chips');
  if (chipsEl) {
    const days = [...Array(7)].map((_, i) => addDays(t, i));
    chipsEl.innerHTML = days.map((d, i) => `<button type="button" data-d="${d}" aria-pressed="${d === val}">${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WD[dow(d)] + ' ' + fromISO(d).getUTCDate()}</button>`).join('');
  }
  const first = root.dataset.month;
  const f = fromISO(first);
  const start = addDays(first, -dow(first));
  const cells = [...Array(42)].map((_, i) => addDays(start, i));
  const rows = cells.slice(35).every((d) => d.slice(0, 7) !== first.slice(0, 7)) ? cells.slice(0, 35) : cells;
  root.querySelector('.dp-cal').innerHTML = `
    <div class="dp-head"><button type="button" class="btn round" data-m="-1" aria-label="Previous month">‹</button>
      <b>${MON[f.getUTCMonth()]} ${f.getUTCFullYear()}</b>
      <button type="button" class="btn round" data-m="1" aria-label="Next month">›</button></div>
    <div class="dp-grid">${WD.map((d) => `<span>${d[0]}</span>`).join('')}
      ${rows.map((d) => `<button type="button" data-d="${d}" class="${d.slice(0, 7) !== first.slice(0, 7) ? 'out' : ''} ${d === t ? 'tod' : ''}" aria-pressed="${d === val}">${fromISO(d).getUTCDate()}</button>`).join('')}</div>`;
}
function wireDatePicker(root, onChange) {
  drawDatePicker(root);
  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { const d = fromISO(root.dataset.month); d.setUTCMonth(d.getUTCMonth() + +m.dataset.m); root.dataset.month = d.toISOString().slice(0, 10); drawDatePicker(root); return; }
    const d = e.target.closest('[data-d]');
    if (d) { root.querySelector('input').value = d.dataset.d; root.dataset.month = d.dataset.d.slice(0, 8) + '01'; drawDatePicker(root); onChange?.(d.dataset.d); }
  });
}

// Time: All day, or tap an hour + minutes, then how long.
const HOURS = [['Morning', [5, 6, 7, 8, 9, 10, 11]], ['Afternoon', [12, 13, 14, 15, 16, 17]], ['Evening', [18, 19, 20, 21, 22]]];
const LENGTHS = [[30, '30 min'], [60, '1 hr'], [90, '1½ hr'], [120, '2 hr'], [180, '3 hr'], [240, '4 hr']];
const hh = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => { n = Math.min(n, 23 * 60 + 59); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
function timePicker(start, end) {
  const len = start && end ? Math.max(15, toMin(end) - toMin(start)) : 60;
  return `<div class="tp" data-start="${start || ''}" data-len="${len}">
    <input type="hidden" name="start_time" value="${start || ''}"><input type="hidden" name="end_time" value="${end || ''}">
    <div class="tp-sel"></div>
    <div class="tp-body"></div>
  </div>`;
}
function drawTimePicker(root) {
  const start = root.dataset.start;
  const len = +root.dataset.len;
  const h = start ? +start.split(':')[0] : null, m = start ? +start.split(':')[1] : 0;
  const end = start ? fromMin(toMin(start) + len) : '';
  root.querySelector('[name=start_time]').value = start;
  root.querySelector('[name=end_time]').value = end;
  root.querySelector('.tp-sel').innerHTML = start ? `<b>${fmtTime(start)} – ${fmtTime(end)}</b>` : '<b>All day</b>';
  const odd = start && !HOURS.some(([, hs]) => hs.includes(h));
  root.querySelector('.tp-body').innerHTML = `
    <div class="tp-row"><span class="tp-lab"></span><button type="button" class="wide" data-allday aria-pressed="${!start}">All day</button></div>
    ${HOURS.map(([lab, hs]) => `<div class="tp-row"><span class="tp-lab">${lab}</span>${hs.map((x) => `<button type="button" data-h="${x}" aria-pressed="${x === h}">${hh(x)}</button>`).join('')}</div>`).join('')}
    ${odd ? `<div class="tp-row"><span class="tp-lab">Other</span><button type="button" aria-pressed="true">${hh(h)}</button></div>` : ''}
    ${start ? `
      <div class="tp-row"><span class="tp-lab">Minutes</span>${[0, 15, 30, 45].map((x) => `<button type="button" data-mi="${x}" aria-pressed="${x === m}">:${String(x).padStart(2, '0')}</button>`).join('')}</div>
      <div class="tp-row"><span class="tp-lab">How long</span>${LENGTHS.map(([x, l]) => `<button type="button" data-len="${x}" aria-pressed="${x === len}">${l}</button>`).join('')}</div>` : ''}`;
}
function wireTimePicker(root) {
  drawTimePicker(root);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const cur = root.dataset.start;
    const m = cur ? cur.split(':')[1] : '00';
    if (b.hasAttribute('data-allday')) root.dataset.start = '';
    else if (b.dataset.h) root.dataset.start = `${String(b.dataset.h).padStart(2, '0')}:${m}`;
    else if (b.dataset.mi && cur) root.dataset.start = `${cur.split(':')[0]}:${String(b.dataset.mi).padStart(2, '0')}`;
    else if (b.dataset.len) root.dataset.len = b.dataset.len;
    else return;
    drawTimePicker(root);
  });
}

// ---------- Event editor ----------
function editEvent(ev, date) {
  const isNew = !ev;
  ev = ev || { title: '', start_date: date || today(), start_time: '', end_time: '', people: '[]', repeat: '', location: '', notes: '' };
  let sel = new Set(peopleOf(ev));
  let wk = new Set(ev.weekly_days ? JSON.parse(ev.weekly_days) : []);
  const el = sheet(`<h2>${isNew ? 'New event' : 'Edit event'}</h2>
    <form data-form="event">
      <input class="field say-big" name="title" value="${esc(ev.title)}" placeholder="What's happening?" ${isNew ? 'autofocus' : ''} required>
      <label class="lab">Who</label>
      <div class="who">${S.data.people.map((p) => `<button type="button" style="${cv(p.color)}" data-p="${p.id}" aria-pressed="${sel.has(p.id)}"><span class="face sm" style="${cv(p.color)}">${p.emoji}</span>${esc(p.name)}</button>`).join('')}</div>
      <p style="color:var(--slate);font-size:.82rem;margin:.35rem 0 0">Pick nobody for a whole-family event.</p>
      <div class="pick2">
        <div><label class="lab">Day</label>${datePicker('start_date', ev.start_date)}</div>
        <div><label class="lab">Time</label>${timePicker(ev.start_time, ev.end_time)}</div>
      </div>
      <div class="two">
        <div><label class="lab">Repeats</label><input type="hidden" name="repeat" value="${ev.repeat || ''}"><div class="repeat-chips">
          ${[['', 'No'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly on…'], ['biweekly', 'Every 2 wks'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]
            .map(([v, l]) => `<button type="button" data-rep="${v}" aria-pressed="${(ev.repeat || '') === v}">${l}</button>`).join('')}</div></div>
        <div><label class="lab">Where</label><input class="field" name="location" value="${esc(ev.location || '')}" placeholder="Optional" style="width:100%"></div>
      </div>
      <div id="repopts" class="repopts" ${ev.repeat ? '' : 'hidden'}>
        <div id="wkdays" ${ev.repeat === 'weekly' ? '' : 'hidden'}><label class="lab">On these days</label>
          <div class="repeat-chips">${WD.map((d, i) => `<button type="button" data-wd="${i}" aria-pressed="${wk.has(i)}">${d}</button>`).join('')}</div></div>
        <label class="lab">Repeat until</label>
        <input type="hidden" name="until_mode" value="${ev.repeat_until ? 'date' : 'forever'}">
        <div class="repeat-chips"><button type="button" data-until="forever" aria-pressed="${!ev.repeat_until}">Forever</button><button type="button" data-until="date" aria-pressed="${!!ev.repeat_until}">Until a date</button></div>
        <div id="untilpick" ${ev.repeat_until ? '' : 'hidden'} style="margin-top:.5rem;max-width:22rem">${datePicker('repeat_until', ev.repeat_until || '', { chips: false })}</div>
      </div>
      <label class="lab">Notes</label><textarea class="field" name="notes" rows="2" style="width:100%">${esc(ev.notes || '')}</textarea>
      <div class="actions">
        ${isNew ? '' : ev.repeat ? `<button type="button" class="btn danger left" data-del="one">Delete this day</button><button type="button" class="btn danger" data-del="after">This &amp; all after</button><button type="button" class="btn danger" data-del="all">Delete all</button>` : `<button type="button" class="btn danger left" data-del="all">Delete</button>`}
        <button type="button" class="btn" data-x>Cancel</button>
        <button class="btn ink">${isNew ? 'Add event' : 'Save'}</button>
      </div>
    </form>`);
  el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-p]');
    if (p) { const id = +p.dataset.p; sel.has(id) ? sel.delete(id) : sel.add(id); p.setAttribute('aria-pressed', sel.has(id)); return; }
    const w = e.target.closest('[data-wd]');
    if (w) { const i = +w.dataset.wd; wk.has(i) ? wk.delete(i) : wk.add(i); w.setAttribute('aria-pressed', wk.has(i)); return; }
    const u = e.target.closest('[data-until]');
    if (u) {
      el.querySelector('[name=until_mode]').value = u.dataset.until;
      el.querySelectorAll('[data-until]').forEach((x) => x.setAttribute('aria-pressed', x === u));
      el.querySelector('#untilpick').hidden = u.dataset.until !== 'date';
      return;
    }
    if (e.target.closest('[data-x]')) return closeSheet();
    const d = e.target.closest('[data-del]');
    if (d) {
      const q = d.dataset.del === 'one' ? '?date=' + date : d.dataset.del === 'after' ? '?from=' + date : '';
      await api(`events/${ev.id}${q}`, { method: 'DELETE' });
      closeSheet(); toast('Deleted'); load();
    }
  });
  wireDatePicker(el.querySelector('[data-dp=start_date]'));
  wireDatePicker(el.querySelector('[data-dp=repeat_until]'));
  wireTimePicker(el.querySelector('.tp'));
  el.querySelector('.repeat-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    el.querySelector('[name=repeat]').value = b.dataset.rep;
    el.querySelectorAll('[data-rep]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    el.querySelector('#wkdays').hidden = b.dataset.rep !== 'weekly';
    el.querySelector('#repopts').hidden = !b.dataset.rep;
    if (b.dataset.rep === 'weekly' && !wk.size) {
      // start with the event's own weekday picked
      const d0 = dow(el.querySelector('[name=start_date]').value || today());
      wk.add(d0);
      el.querySelectorAll('[data-wd]').forEach((x) => x.setAttribute('aria-pressed', wk.has(+x.dataset.wd)));
    }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = {
      title: f.title.trim(), start_date: f.start_date, start_time: f.start_time || null,
      end_time: f.start_time ? (f.end_time || null) : null, people: [...sel], repeat: f.repeat || null,
      weekly_days: f.repeat === 'weekly' && wk.size ? [...wk].sort() : null, location: f.location || null, notes: f.notes || null,
      repeat_until: f.repeat && f.until_mode === 'date' && f.repeat_until ? f.repeat_until : null,
    };
    if (body.repeat_until && body.repeat_until < body.start_date) return toast('The end date is before the first day');
    if (body.start_time && !body.end_time) { const [h, m] = body.start_time.split(':').map(Number); body.end_time = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
    await api(isNew ? 'events' : `events/${ev.id}`, { method: isNew ? 'POST' : 'PUT', body });
    closeSheet(); toast(isNew ? 'Event added' : 'Saved'); load();
  });
}

function dayDetail(date) {
  const evs = eventsOn(S.data.events, date);
  const el = sheet(`<h2>${prettyDate(date)}</h2>
    <div style="display:flex;flex-direction:column;gap:.4rem">${evs.map((e) => evHTML(e, date)).join('') || '<p class="empty">Nothing planned.</p>'}</div>
    <div class="actions"><button class="btn" data-x>Close</button><button class="btn ink" data-new>+ Add event</button></div>`);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    if (e.target.closest('[data-new]')) return editEvent(null, date);
    const ev = e.target.closest('[data-act=event]');
    if (ev) editEvent(S.data.events.find((x) => x.id === +ev.dataset.id), date);
  });
}

// ---------- Meal editor ----------
function editMeal(date, slot) {
  const m = mealOf(date, slot);
  let ing = [];
  try { ing = JSON.parse(m?.ingredients || '[]'); } catch {}
  const el = sheet(`<h2>${slot[0].toUpperCase() + slot.slice(1)} · ${prettyDate(date)}</h2>
    <form data-form="meal">
      <input class="field say-big" name="title" value="${esc(m?.title || '')}" placeholder="What are we eating?" autofocus>
      <label class="lab">Ingredients to buy (comma separated)</label>
      <input class="field" name="ing" value="${esc(ing.join(', '))}" placeholder="Tortillas, ground beef, cheese" style="width:100%">
      <div class="actions">
        ${m ? '<button type="button" class="btn danger left" data-clear>Clear</button>' : ''}
        ${ing.length ? '<button type="button" class="btn" data-groc>🛒 Add to Groceries</button>' : ''}
        <button type="button" class="btn" data-x>Cancel</button><button class="btn ink">Save</button>
      </div>
    </form>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    if (e.target.closest('[data-clear]')) { await api('meals', { method: 'PUT', body: { date, slot, title: '' } }); closeSheet(); load(); }
    if (e.target.closest('[data-groc]')) { await addToGroceries(ing); closeSheet(); }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const ingredients = f.ing.split(',').map((s) => s.trim()).filter(Boolean);
    await api('meals', { method: 'PUT', body: { date, slot, title: f.title.trim(), ingredients } });
    closeSheet(); toast('Meal saved'); load();
  });
}
async function addToGroceries(items) {
  const g = S.data.lists.find((l) => /grocer/i.test(l.name)) || S.data.lists[0];
  const have = new Set(S.data.items.filter((i) => i.list_id === g.id && !i.done).map((i) => i.text.toLowerCase()));
  const add = [...new Set(items.map((s) => s.trim()).filter((s) => s && !have.has(s.toLowerCase())).map((s) => s[0].toUpperCase() + s.slice(1)))];
  if (!add.length) return toast('Already on the list');
  await api('items', { method: 'POST', body: { list_id: g.id, items: add } });
  toast(`Added ${add.length} to ${g.name}`); load();
}

// ---------- Chore manager ----------
async function manageChores() {
  const el = sheet(`<h2>Edit chores</h2>
    <div style="display:flex;flex-direction:column;gap:.3rem;max-height:55vh;overflow:auto">
      ${S.data.people.map((p) => {
        const mine = S.data.chores.filter((c) => c.person_id === p.id);
        return `<div style="display:flex;align-items:center;gap:.5rem;margin-top:.6rem"><span class="face sm" style="${cv(p.color)}">${p.emoji}</span><b>${esc(p.name)}</b></div>` +
          mine.map((c) => `<button class="chore" style="${cv(p.color)}" data-edit="${c.id}"><span class="em">${c.emoji || '⭐'}</span><span class="t">${esc(c.title)}<span class="p">${daysLabel(c)} · ${c.points} pts · ${c.time_of_day}</span></span><span>✎</span></button>`).join('');
      }).join('')}
    </div>
    <div class="actions"><button class="btn" data-x>Done</button><button class="btn ink" data-new>+ New chore</button></div>`);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    if (e.target.closest('[data-new]')) return editChore(null);
    const ed = e.target.closest('[data-edit]');
    if (ed) editChore(S.data.chores.find((c) => c.id === +ed.dataset.edit));
  });
}
function daysLabel(c) {
  if (c.one_time_date) return 'once, ' + shortDate(c.one_time_date);
  const d = JSON.parse(c.days || '[]');
  if (d.length === 7) return 'every day';
  if (d.join() === '1,2,3,4,5') return 'weekdays';
  return d.map((i) => WD[i]).join(' ');
}
function editChore(c) {
  const isNew = !c;
  c = c || { title: '', person_id: kids()[0]?.id, points: 5, emoji: '⭐', days: '[0,1,2,3,4,5,6]', time_of_day: 'any' };
  let days = new Set(JSON.parse(c.days || '[]'));
  let who = c.person_id;
  const el = sheet(`<h2>${isNew ? 'New chore' : 'Edit chore'}</h2>
    <form data-form="chore">
      <div class="row"><input class="field" name="emoji" value="${esc(c.emoji || '⭐')}" style="flex:0 0 4rem;text-align:center;font-size:1.5rem"><input class="field say-big" name="title" value="${esc(c.title)}" placeholder="Chore name" required></div>
      <label class="lab">Who</label>
      <div class="who">${S.data.people.map((p) => `<button type="button" style="${cv(p.color)}" data-p="${p.id}" aria-pressed="${who === p.id}"><span class="face sm" style="${cv(p.color)}">${p.emoji}</span>${esc(p.name)}</button>`).join('')}</div>
      <label class="lab">Days</label>
      <div class="daypick">${WD.map((d, i) => `<button type="button" data-wd="${i}" aria-pressed="${days.has(i)}">${d[0]}</button>`).join('')}</div>
      <div class="two">
        <div><label class="lab">Points</label><input class="field" type="number" min="0" name="points" value="${c.points}" style="width:100%"></div>
        <div><label class="lab">When</label><select class="field" name="time_of_day" style="width:100%">${['any', 'morning', 'afternoon', 'evening'].map((t) => `<option ${c.time_of_day === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger left" data-del>Remove chore</button>'}<button type="button" class="btn" data-x>Cancel</button><button class="btn ink">Save</button></div>
    </form>`);
  el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-p]');
    if (p) { who = +p.dataset.p; el.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.p === who)); return; }
    const w = e.target.closest('[data-wd]');
    if (w) { const i = +w.dataset.wd; days.has(i) ? days.delete(i) : days.add(i); w.setAttribute('aria-pressed', days.has(i)); return; }
    if (e.target.closest('[data-x]')) return manageChores();
    if (e.target.closest('[data-del]')) { await api(`chores/${c.id}`, { method: 'DELETE' }); await load(); manageChores(); }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { title: f.title.trim(), emoji: f.emoji, person_id: who, points: +f.points || 0, time_of_day: f.time_of_day, days: [...days].sort(), one_time_date: c.one_time_date || null };
    await api(isNew ? 'chores' : `chores/${c.id}`, { method: isNew ? 'POST' : 'PUT', body });
    await load(); manageChores();
  });
}

// ---------- Rewards ----------
async function redeem(rid) {
  const r = S.data.rewards.find((x) => x.id === rid);
  const k = person(S.rewardKid);
  const bal = pts(k.id);
  if (bal < r.cost) return toast(`${k.name} needs ${r.cost - bal} more points`);
  const el = sheet(`<div style="text-align:center"><div style="font-size:4rem">${r.emoji}</div><h2>${esc(r.title)}?</h2>
    <p style="color:var(--slate)">${esc(k.name)} has ${bal} points. This costs ${r.cost}, leaving ${bal - r.cost}.</p></div>
    <div class="actions" style="justify-content:center"><button class="btn" data-x>Not now</button><button class="btn ink" data-yes>Yes, spend ${r.cost}</button></div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    if (!e.target.closest('[data-yes]')) return;
    const needPin = S.data.settings.redeem_needs_pin === '1';
    const pin = needPin ? await askPin('Approve reward') : '';
    if (needPin && !pin) return;
    try {
      await api(`rewards/${rid}/redeem`, { method: 'POST', body: { person_id: k.id, pin } });
      closeSheet(); confetti([r.emoji || '🎁', '⭐', '🎉']); toast(`${k.name} got ${r.title}!`); load();
    } catch (err) { toast(err.message); }
  });
}
async function bonusPoints() {
  const pin = await askPin('Give or take points');
  if (!pin) return;
  let who = S.rewardKid;
  const el = sheet(`<h2>Give or take points</h2>
    <div class="who">${kids().map((p) => `<button type="button" style="${cv(p.color)}" data-p="${p.id}" aria-pressed="${who === p.id}"><span class="face sm" style="${cv(p.color)}">${p.emoji}</span>${esc(p.name)}</button>`).join('')}</div>
    <label class="lab">Reason</label><input class="field" id="why" placeholder="Helped with groceries" style="width:100%">
    <div class="row" style="margin-top:1rem">${[1, 5, 10, 20].map((n) => `<button class="btn" data-d="${n}">+${n}</button>`).join('')}${[-5, -10].map((n) => `<button class="btn danger" data-d="${n}">${n}</button>`).join('')}</div>
    <div class="actions"><button class="btn" data-x>Done</button></div>`);
  el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-p]');
    if (p) { who = +p.dataset.p; el.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.p === who)); return; }
    if (e.target.closest('[data-x]')) return closeSheet();
    const d = e.target.closest('[data-d]');
    if (d) {
      const delta = +d.dataset.d;
      const reason = $('#why', el).value.trim() || (delta > 0 ? '⭐ Bonus from Mom & Dad' : 'Points taken');
      await api('points', { method: 'POST', body: { pin, person_id: who, delta, reason } });
      if (delta > 0) confetti(); toast(`${delta > 0 ? '+' : ''}${delta} for ${person(who).name}`); load();
    }
  });
}
async function manageRewards() {
  const pin = await askPin('Edit rewards');
  if (!pin) return;
  const draw = () => {
    const el = sheet(`<h2>Edit rewards</h2>
      <div style="max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:.3rem">
      ${S.data.rewards.map((r) => `<div class="row" style="margin:0"><span style="font-size:1.4rem">${r.emoji}</span><span style="flex:1">${esc(r.title)} <span style="color:var(--slate)">· ${esc(r.category || '')}</span></span><b>${r.cost}</b><button class="btn" data-edit="${r.id}">Edit</button></div>`).join('')}
      </div>
      <div class="actions"><button class="btn" data-x>Done</button><button class="btn ink" data-new>+ New reward</button></div>`);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) return closeSheet();
      if (e.target.closest('[data-new]')) return form(null);
      const ed = e.target.closest('[data-edit]');
      if (ed) form(S.data.rewards.find((r) => r.id === +ed.dataset.edit));
    });
  };
  const form = (r) => {
    const isNew = !r;
    r = r || { title: '', cost: 20, emoji: '🎁', category: 'Privilege' };
    const cats = [...new Set(['Screen time', 'Privilege', 'Treat', 'Time together', 'Outing', 'Money', 'Big reward', ...S.data.rewards.map((x) => x.category)])].filter(Boolean);
    const el = sheet(`<h2>${isNew ? 'New reward' : 'Edit reward'}</h2><form>
      <div class="row"><input class="field" name="emoji" value="${esc(r.emoji)}" style="flex:0 0 4rem;text-align:center;font-size:1.5rem"><input class="field say-big" name="title" value="${esc(r.title)}" placeholder="Reward" required></div>
      <div class="two"><div><label class="lab">Cost (points)</label><input class="field" type="number" min="1" name="cost" value="${r.cost}" style="width:100%"></div>
      <div><label class="lab">Group</label><input class="field" name="category" list="cats" value="${esc(r.category || '')}" style="width:100%"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div></div>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn danger left" data-del>Remove</button>'}<button type="button" class="btn" data-x>Back</button><button class="btn ink">Save</button></div></form>`);
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-x]')) return draw();
      if (e.target.closest('[data-del]')) { await api(`rewards/${r.id}?pin=${pin}`, { method: 'DELETE' }); await load(); draw(); }
    });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      await api(isNew ? 'rewards' : `rewards/${r.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...f, cost: +f.cost, pin } });
      await load(); draw();
    });
  };
  draw();
}

// ---------- Countdowns ----------
function manageCountdowns() {
  const t = today();
  const el = sheet(`<h2>Countdowns</h2>
    ${S.data.countdowns.map((c) => `<div class="row"><span style="font-size:1.5rem">${c.emoji || '🎉'}</span><span style="flex:1"><b>${esc(c.title)}</b><br><span style="color:var(--slate)">${prettyDate(c.date)} · ${daysBetween(t, c.date)} days</span></span><button class="btn danger" data-del="${c.id}">Remove</button></div>`).join('') || '<p class="empty">No countdowns yet.</p>'}
    <form style="margin-top:1rem"><label class="lab">New countdown</label>
      <div class="row"><input class="field" name="emoji" value="🎉" style="flex:0 0 3.6rem;text-align:center"><input class="field" name="title" placeholder="Disney trip" required></div>
      ${datePicker('date', '', { chips: false })}
      <div class="actions"><button class="btn ink">Add countdown</button></div></form>
    <div class="actions"><button class="btn" data-x>Done</button></div>`);
  el.addEventListener('click', async (e) => {
    const u = e.target.closest('[data-until]');
    if (u) {
      el.querySelector('[name=until_mode]').value = u.dataset.until;
      el.querySelectorAll('[data-until]').forEach((x) => x.setAttribute('aria-pressed', x === u));
      el.querySelector('#untilpick').hidden = u.dataset.until !== 'date';
      return;
    }
    if (e.target.closest('[data-x]')) return closeSheet();
    const d = e.target.closest('[data-del]');
    if (d) { await api(`countdowns/${d.dataset.del}`, { method: 'DELETE' }); await load(); manageCountdowns(); }
  });
  wireDatePicker(el.querySelector('.dp'));
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.target.date.value) return toast('Tap a day for the countdown');
    await api('countdowns', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    await load(); manageCountdowns();
  });
}

// ---------- Settings & people ----------
async function editSettings() {
  const pin = await askPin('Settings');
  if (!pin) return;
  const s = S.data.settings;
  const el = sheet(`<h2>Settings</h2><form>
    <div class="two"><div><label class="lab">Night mode starts</label><input class="field" type="time" name="night_start" value="${esc(s.night_start)}" style="width:100%"></div>
    <div><label class="lab">Night mode ends</label><input class="field" type="time" name="night_end" value="${esc(s.night_end)}" style="width:100%"></div></div>
    <div class="three"><div><label class="lab">Weather town</label><input class="field" name="city" value="${esc(s.city)}" style="width:100%"></div>
    <div><label class="lab">Latitude</label><input class="field" name="lat" value="${esc(s.lat)}" style="width:100%"></div>
    <div><label class="lab">Longitude</label><input class="field" name="lon" value="${esc(s.lon)}" style="width:100%"></div></div>
    <div class="two"><div><label class="lab">Slideshow after (minutes idle)</label><input class="field" type="number" min="0" name="photo_idle_minutes" value="${esc(s.photo_idle_minutes)}" style="width:100%"></div>
    <div><label class="lab">New parent PIN (4–8 digits)</label><input class="field" name="parent_pin" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="Leave blank to keep" style="width:100%"></div></div>
    <label class="chk" style="margin-top:.8rem"><input type="checkbox" name="redeem_needs_pin" ${s.redeem_needs_pin === '1' ? 'checked' : ''}> Kids need a parent PIN to spend points</label>
    <div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn ink">Save</button></div></form>`);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) closeSheet(); });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.redeem_needs_pin = f.redeem_needs_pin ? '1' : '0';
    if (!f.parent_pin) delete f.parent_pin;
    await api('settings', { method: 'PUT', body: { pin, values: f } });
    closeSheet(); toast('Settings saved'); S.weather = null; await load(); loadWeather();
  });
}
async function editPeople() {
  const pin = await askPin('Edit family');
  if (!pin) return;
  const el = sheet(`<h2>Family</h2><form>
    ${S.data.people.map((p) => `<div class="row" data-id="${p.id}">
      <input class="field" name="emoji" value="${esc(p.emoji)}" style="flex:0 0 3.6rem;text-align:center;font-size:1.3rem">
      <input class="field" name="name" value="${esc(p.name)}" required>
      <input class="field" name="nickname" value="${esc(p.nickname || '')}" placeholder="Nickname (Mom, Dad)" style="flex:0 0 9rem">
      <input type="color" name="color" value="${p.color}" style="width:3rem;height:2.6rem;border:0;background:none">
    </div>`).join('')}
    <p style="color:var(--slate);font-size:.85rem">Siri understands both names and nicknames.</p>
    <div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn ink">Save</button></div></form>`);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) closeSheet(); });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const row of el.querySelectorAll('[data-id]')) {
      const get = (n) => row.querySelector(`[name=${n}]`).value.trim();
      await api(`people/${row.dataset.id}`, { method: 'PUT', body: { pin, emoji: get('emoji'), name: get('name'), nickname: get('nickname') || null, color: get('color') } });
    }
    closeSheet(); toast('Family saved'); load();
  });
}

// ---------- Photos upload ----------
async function uploadPhotos(files) {
  let n = 0;
  for (const f of files) {
    try {
      const data = await shrink(f, 1600, 0.82);
      await api('photos', { method: 'POST', body: { data } });
      n++;
    } catch (e) { toast(e.message); }
  }
  if (n) toast(`Added ${n} photo${n > 1 ? 's' : ''}`);
  load();
}
function shrink(file, max, q) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => reject(new Error("Couldn't read that photo"));
    img.src = URL.createObjectURL(file);
  });
}

// ================== events ==================
document.addEventListener('click', async (e) => {
  S.lastTouch = Date.now();
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    S.view = nav.dataset.nav;
    try { localStorage.setItem('fb.view', S.view); } catch {}
    render();
    $('#view').scrollTop = 0;
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act, id = +a.dataset.id, date = a.dataset.date;
  switch (act) {
    case 'quick': return quickAdd();
    case 'new-event': return editEvent(null, date || today());
    case 'event': if (!a.closest('.sheet')) editEvent(S.data.events.find((x) => x.id === id), date); return;
    case 'day': return dayDetail(date);
    case 'wk': S.weekStart = +a.dataset.n === 0 ? today() : addDays(S.weekStart, +a.dataset.n); return render();
    case 'mo': {
      if (+a.dataset.n === 0) S.monthAnchor = today().slice(0, 8) + '01';
      else { const d = fromISO(S.monthAnchor); d.setUTCMonth(d.getUTCMonth() + +a.dataset.n); S.monthAnchor = d.toISOString().slice(0, 10); }
      return render();
    }
    case 'chore': {
      const wasDone = isDone(id, date);
      const c = S.data.chores.find((x) => x.id === id);
      // optimistic update for snappy taps
      if (wasDone) S.data.done = S.data.done.filter((d) => !(d.chore_id === id && d.date === date));
      else S.data.done.push({ chore_id: id, date });
      const p = person(c.person_id);
      if (p?.is_kid && c.points) S.data.points[p.id] = pts(p.id) + (wasDone ? -c.points : c.points);
      render();
      if (!wasDone) {
        document.querySelector(`[data-act=chore][data-id="${id}"]`)?.classList.add('pop');
        if (p?.is_kid) {
          const left = choresOn(S.data.chores, date).filter((x) => x.person_id === p.id && !isDone(x.id, date)).length;
          if (!left) { confetti([p.emoji, '⭐', '🎉']); toast(`${p.name} finished every chore! 🎉`); }
          else if (c.points) toast(`+${c.points} for ${p.name} ⭐`);
        }
      }
      api(`chores/${id}/toggle`, { method: 'POST', body: { date } }).then(load).catch((err) => { toast(err.message); load(); });
      return;
    }
    case 'chore-time': S.choreTime = a.dataset.k; return render();
    case 'manage-chores': return manageChores();
    case 'reward-kid': S.rewardKid = id; return render();
    case 'redeem': return redeem(id);
    case 'bonus': return bonusPoints();
    case 'manage-rewards': return manageRewards();
    case 'list': S.listId = id; return render();
    case 'item': {
      const it = S.data.items.find((i) => i.id === id);
      it.done = it.done ? 0 : 1; render();
      api(`items/${id}`, { method: 'PUT', body: { done: it.done } }).then(load);
      return;
    }
    case 'link-item': return linkItem(S.data.items.find((i) => i.id === id));
    case 'send-cart': return sendToCart(id);
    case 'del-item': S.data.items = S.data.items.filter((i) => i.id !== id); render(); api(`items/${id}`, { method: 'DELETE' }).then(load); return;
    case 'clear-done': await api('items/clear-done', { method: 'POST', body: { list_id: id } }); return load();
    case 'new-list': case 'edit-list': {
      const l = S.data.lists.find((x) => x.id === id);
      const el = sheet(`<h2>${l ? 'Rename list' : 'New list'}</h2><form class="row"><input class="field" name="emoji" value="${esc(l?.emoji || '📝')}" style="flex:0 0 3.6rem;text-align:center"><input class="field" name="name" value="${esc(l?.name || '')}" placeholder="Costco" required autofocus></form>
        <div class="actions">${l ? '<button class="btn danger left" data-del>Delete list</button>' : ''}<button class="btn" data-x>Cancel</button><button class="btn ink" data-save>Save</button></div>`);
      const save = async () => {
        const f = Object.fromEntries(new FormData(el.querySelector('form')));
        if (!f.name.trim()) return;
        const r = await api(l ? `lists/${l.id}` : 'lists', { method: l ? 'PUT' : 'POST', body: f });
        if (!l) S.listId = r.id;
        closeSheet(); load();
      };
      el.addEventListener('submit', (ev) => { ev.preventDefault(); save(); });
      el.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-x]')) closeSheet();
        if (ev.target.closest('[data-save]')) save();
        if (ev.target.closest('[data-del]') && confirm(`Delete ${l.name} and everything on it?`)) { await api(`lists/${l.id}`, { method: 'DELETE' }); S.listId = null; closeSheet(); load(); }
      });
      return;
    }
    case 'meal': return editMeal(date, a.dataset.slot);
    case 'meals-to-groceries': {
      const days = [...Array(7)].map((_, i) => addDays(S.weekStart, i));
      const all = S.data.meals.filter((m) => days.includes(m.date)).flatMap((m) => { try { return JSON.parse(m.ingredients || '[]'); } catch { return []; } });
      if (!all.length) return toast('Add ingredients to meals first');
      return addToGroceries(all);
    }
    case 'countdowns': return manageCountdowns();
    case 'del-photo': if (confirm('Delete this photo?')) { await api(`photos/${id}`, { method: 'DELETE' }); load(); } return;
    case 'saver-now': return startSaver();
    case 'edit-settings': return editSettings();
    case 'edit-people': return editPeople();
    case 'copy-link': navigator.clipboard?.writeText(`${location.origin}/?key=${encodeURIComponent(S.key)}`).then(() => toast('Link copied')); return;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-act=upload]')) uploadPhotos([...e.target.files]);
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form=add-item]');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  const items = input.value.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1));
  if (!items.length) return;
  input.value = '';
  await api('items', { method: 'POST', body: { list_id: +f.dataset.id, items } });
  await load();
  $('[data-form=add-item] input')?.focus();
});
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  S.lastTouch = Date.now();
  if ($('#saver')?.classList.contains('on')) stopSaver();
  if ($('#night')?.classList.contains('on')) { S.wakeUntil = Date.now() + 90_000; $('#night').classList.remove('on'); }
}, true));

// ================== weather (Open-Meteo, no key needed) ==================
const WMO = (c) => c === 0 ? ['☀️', 'Clear'] : c <= 2 ? ['🌤️', 'Partly cloudy'] : c === 3 ? ['☁️', 'Cloudy'] : c <= 48 ? ['🌫️', 'Fog'] : c <= 57 ? ['🌦️', 'Drizzle'] :
  c <= 67 ? ['🌧️', 'Rain'] : c <= 77 ? ['🌨️', 'Snow'] : c <= 82 ? ['🌧️', 'Showers'] : c <= 86 ? ['🌨️', 'Snow showers'] : ['⛈️', 'Storms'];
async function loadWeather() {
  try {
    const s = S.data?.settings || {};
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat || 41.6731}&longitude=${s.lon || -85.58}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
    const w = await (await fetch(u)).json();
    const [icon, text] = WMO(w.current.weather_code);
    S.weather = { icon, text, temp: Math.round(w.current.temperature_2m), hi: Math.round(w.daily.temperature_2m_max[0]), lo: Math.round(w.daily.temperature_2m_min[0]) };
    if (S.data) renderTop();
  } catch (e) { console.warn('weather', e); }
}

// ================== screensaver & night ==================
function startSaver() {
  if (!S.data.photos.length) return toast('Add photos first');
  const el = $('#saver');
  el.classList.add('on');
  showSlide();
}
function stopSaver() { $('#saver').classList.remove('on'); $('#saver').innerHTML = ''; S.lastTouch = Date.now(); }
function showSlide() {
  const el = $('#saver');
  if (!el.classList.contains('on')) return;
  const ph = S.data.photos;
  const p = ph[S.saverIdx++ % ph.length];
  const t = today();
  const evs = eventsOn(S.data.events, t);
  const src = photoURL(p.id);
  el.innerHTML = `<img class="bg show" src="${src}" alt=""><img class="fg" src="${src}" alt="">
    <div class="over"><div class="clock">${new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date())}</div>
    <p>${WDL[dow(t)]} · ${evs.length ? evs.slice(0, 3).map((e) => esc(e.title) + (e.start_time ? ' ' + fmtTime(e.start_time) : '')).join(' · ') : 'Nothing on the calendar today'}</p></div>`;
  const fg = el.querySelector('.fg');
  fg.onload = () => fg.classList.add('show');
  clearTimeout(S.saverT);
  S.saverT = setTimeout(showSlide, 12000);
}
function inNight() {
  const s = S.data?.settings;
  if (!s?.night_start || !s?.night_end) return false;
  const now = localNowHHMM(tz());
  return s.night_start > s.night_end ? now >= s.night_start || now < s.night_end : now >= s.night_start && now < s.night_end;
}
function tick() {
  if (!S.data) return;
  renderTop();
  const night = !isPhone() && inNight() && Date.now() > S.wakeUntil;
  const n = $('#night');
  if (night && !n.classList.contains('on')) {
    stopSaver();
    n.classList.add('on');
  }
  if (night) {
    const t = today();
    const tmr = eventsOn(S.data.events, addDays(t, 1));
    n.innerHTML = `<div><div class="clock">${new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date())}</div>
      <p>${tmr.length ? 'Tomorrow: ' + tmr.slice(0, 3).map((e) => esc(e.title)).join(' · ') : 'Sleep tight'}</p></div>`;
  } else n.classList.remove('on');
  const idleMin = +(S.data.settings.photo_idle_minutes || 0);
  if (!isPhone() && !night && idleMin && S.data.photos.length && Date.now() - S.lastTouch > idleMin * 60000 && !$('.scrim') && !$('#saver').classList.contains('on')) startSaver();
  // after midnight, jump back to today
  if (S.lastDay && S.lastDay !== today()) { S.weekStart = today(); S.monthAnchor = today().slice(0, 8) + '01'; load(); }
  S.lastDay = today();
}

// ================== key gate ==================
function showGate() {
  $('#root').innerHTML = `<div class="gate"><div class="sheet">
    <h2>Family key</h2>
    <p style="color:var(--slate)">Enter the family key you chose during setup. You only need to do this once on each device.</p>
    <form class="row"><input class="field say-big" name="k" autocomplete="off" autofocus placeholder="Family key"><button class="btn ink">Open</button></form>
  </div></div>`;
  $('#root form').addEventListener('submit', (e) => {
    e.preventDefault();
    S.key = e.target.k.value.trim();
    try { localStorage.setItem('fb.key', S.key); } catch {}
    $('#root').innerHTML = '';
    load().then(loadWeather);
  });
}

// ================== keep the screen awake (wall screen) ==================
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !document.hidden && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not supported or not allowed yet; retried on next tap */ }
}
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('pointerdown', keepAwake, { once: false, passive: true });
// Wall screen: go full screen on the first tap (browsers only allow it after a tap)
function goFullscreen() {
  if (isPhone() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
document.addEventListener('pointerdown', goFullscreen, { passive: true });

// ================== start ==================
load().then(loadWeather);
keepAwake();
setInterval(tick, 15000);
setInterval(load, 30000);
setInterval(loadWeather, 20 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
