// Family Board — Cloudflare Worker (API + static app)
import { parse, friendlyDate, friendlyTime, joinNames } from './parse.js';
import { eventsOn, choresOn, addDays, localToday } from '../public/shared.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    // ---- family key check ----
    const key = request.headers.get('x-family-key') || url.searchParams.get('key') || '';
    if (!env.FAMILY_KEY) return cors(bad('Setup not finished: run npm run setup to set the family key', 503));
    if (key !== env.FAMILY_KEY) return cors(bad('Wrong family key', 401));

    try {
      const res = await route(request, env, url);
      return cors(res);
    } catch (err) {
      console.error(err);
      return cors(bad(String(err.message || err), 500));
    }
  },
};

function cors(res) {
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-headers', 'content-type, x-family-key');
  h.set('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}

async function body(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return (await request.json().catch(() => ({}))) || {};
  if (ct.includes('form')) return Object.fromEntries(await request.formData());
  const txt = await request.text();
  try { return JSON.parse(txt); } catch { return { text: txt }; }
}

// ---------------- data helpers ----------------
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = async (db, sql, ...args) => await db.prepare(sql).bind(...args).first();
const run = async (db, sql, ...args) => await db.prepare(sql).bind(...args).run();

async function settings(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
async function today(db) {
  const s = await settings(db);
  return localToday(s.tz || 'America/Indiana/Indianapolis');
}
async function checkPin(db, pin) {
  const s = await settings(db);
  return String(pin || '') === String(s.parent_pin || '1234');
}
async function balances(db) {
  const rows = await all(db, 'SELECT person_id, COALESCE(SUM(delta),0) AS pts FROM points_log GROUP BY person_id');
  return Object.fromEntries(rows.map((r) => [r.person_id, r.pts]));
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const jsonCols = (o, cols) => {
  for (const c of cols) if (o[c] !== undefined && typeof o[c] !== 'string') o[c] = o[c] === null ? null : JSON.stringify(o[c]);
  return o;
};

async function insert(db, table, data) {
  const keys = Object.keys(data);
  const r = await run(db, `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => data[k]));
  return r.meta.last_row_id;
}
async function update(db, table, id, data, idCol = 'id') {
  const keys = Object.keys(data);
  if (!keys.length) return;
  await run(db, `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${idCol}=?`, ...keys.map((k) => data[k]), id);
}

const EVENT_COLS = ['title', 'start_date', 'start_time', 'end_time', 'people', 'location', 'notes', 'repeat', 'repeat_until', 'weekly_days', 'skip_dates'];
const CHORE_COLS = ['title', 'person_id', 'points', 'emoji', 'days', 'time_of_day', 'one_time_date', 'active'];
const REWARD_COLS = ['title', 'cost', 'emoji', 'category', 'active'];


// ---------- store lists (Amazon / Walmart) ----------
let migrated = false;
async function migrate(db) {
  if (migrated) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS item_links (item_id INTEGER PRIMARY KEY, pid TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS store_products (store TEXT NOT NULL, name TEXT NOT NULL, pid TEXT NOT NULL, PRIMARY KEY (store, name))'),
  ]);
  const seeded = await one(db, "SELECT value FROM settings WHERE key='stores_seeded'");
  if (!seeded) {
    const has = await all(db, 'SELECT name FROM lists');
    if (!has.some((l) => /amazon/i.test(l.name))) await insert(db, 'lists', { name: 'Amazon', emoji: '📦', sort: 4 });
    if (!has.some((l) => /walmart/i.test(l.name))) await insert(db, 'lists', { name: 'Walmart', emoji: '🛍️', sort: 5 });
    await run(db, "INSERT OR REPLACE INTO settings (key, value) VALUES ('stores_seeded','1')");
  }
  migrated = true;
}
const storeOf = (name) => (/amazon/i.test(name || '') ? 'amazon' : /walmart/i.test(name || '') ? 'walmart' : null);
const normName = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
// Pull a product id out of a pasted link (or a bare id)
function productId(store, input) {
  const s = String(input || '').trim();
  if (store === 'amazon') {
    const m = s.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|^)([A-Z0-9]{10})(?=[/?#]|$)/i);
    return m ? m[1].toUpperCase() : null;
  }
  if (store === 'walmart') {
    const m = s.match(/\/ip\/(?:[^/]+\/)?(\d{5,})/) || s.match(/^(\d{5,})$/);
    return m ? m[1] : null;
  }
  return null;
}
// After items are added, attach any product we've linked before with the same name
async function autoLink(db, listId, ids) {
  const list = await one(db, 'SELECT name FROM lists WHERE id=?', listId);
  const store = storeOf(list?.name);
  if (!store) return;
  for (const id of ids) {
    const it = await one(db, 'SELECT text FROM list_items WHERE id=?', id);
    const known = await one(db, 'SELECT pid FROM store_products WHERE store=? AND name=?', store, normName(it.text));
    if (known) await run(db, 'INSERT OR REPLACE INTO item_links (item_id, pid) VALUES (?,?)', id, known.pid);
  }
}

// ---------------- router ----------------
async function route(request, env, url) {
  const db = env.DB;
  const m = request.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [res, id, action] = parts;
  await migrate(db);

  // ===== everything the screen needs, in one call =====
  if (res === 'state' && m === 'GET') {
    const t = await today(db);
    const from = url.searchParams.get('from') || addDays(t, -45);
    const to = url.searchParams.get('to') || addDays(t, 60);
    const [people, events, chores, done, rewards, lists, items, meals, countdowns, photos, s, bal, log] = await Promise.all([
      all(db, 'SELECT * FROM people ORDER BY sort, id'),
      all(db, 'SELECT * FROM events WHERE (repeat IS NULL AND start_date BETWEEN ? AND ?) OR (repeat IS NOT NULL AND start_date <= ? AND (repeat_until IS NULL OR repeat_until >= ?)) ORDER BY start_date, start_time', from, to, to, from),
      all(db, 'SELECT * FROM chores WHERE active=1 ORDER BY person_id, time_of_day, id'),
      all(db, 'SELECT * FROM chore_done WHERE date BETWEEN ? AND ?', addDays(t, -14), addDays(t, 14)),
      all(db, 'SELECT * FROM rewards WHERE active=1 ORDER BY cost'),
      all(db, 'SELECT * FROM lists ORDER BY sort, id'),
      all(db, 'SELECT i.*, l.pid FROM list_items i LEFT JOIN item_links l ON l.item_id = i.id ORDER BY i.done, i.id'),
      all(db, 'SELECT * FROM meals WHERE date BETWEEN ? AND ?', addDays(t, -7), addDays(t, 35)),
      all(db, 'SELECT * FROM countdowns WHERE date >= ? ORDER BY date', t),
      all(db, 'SELECT id, caption FROM photos ORDER BY id DESC LIMIT 200'),
      settings(db),
      balances(db),
      all(db, 'SELECT * FROM points_log ORDER BY id DESC LIMIT 60'),
    ]);
    delete s.parent_pin;
    return json({ ok: true, today: t, people, events, chores, done, rewards, lists, items, meals, countdowns, photos, settings: s, points: bal, log });
  }

  // ===== Siri / quick add =====
  if (res === 'say') {
    const b = m === 'GET' ? { text: url.searchParams.get('text') } : await body(request);
    return json(await say(db, b.text || b.input || ''));
  }
  if (res === 'today' && m === 'GET') {
    const t = await today(db);
    const date = url.searchParams.get('date') === 'tomorrow' ? addDays(t, 1) : t;
    return json({ ok: true, reply: await daySummary(db, date, t) });
  }
  if (res === 'undo' && m === 'POST') {
    const b = await body(request);
    return json(await undo(db, b));
  }

  // ===== events =====
  if (res === 'events') {
    if (m === 'POST') {
      const b = jsonCols(pick(await body(request), EVENT_COLS), ['people', 'weekly_days', 'skip_dates']);
      if (!b.title || !b.start_date) return bad('Title and date are required');
      return json({ ok: true, id: await insert(db, 'events', b) });
    }
    if (m === 'PUT' && id) {
      await update(db, 'events', id, jsonCols(pick(await body(request), EVENT_COLS), ['people', 'weekly_days', 'skip_dates']));
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      // ?date=YYYY-MM-DD deletes just one occurrence of a repeating event
      const only = url.searchParams.get('date');
      const from = url.searchParams.get('from');
      if (from) {
        // delete this day and everything after it: end the series the day before
        const ev = await one(db, 'SELECT start_date FROM events WHERE id=?', id);
        if (!ev || from <= ev.start_date) await run(db, 'DELETE FROM events WHERE id=?', id);
        else await run(db, 'UPDATE events SET repeat_until=? WHERE id=?', addDays(from, -1), id);
      } else if (only) {
        const ev = await one(db, 'SELECT skip_dates FROM events WHERE id=?', id);
        const skips = JSON.parse(ev?.skip_dates || '[]');
        skips.push(only);
        await run(db, 'UPDATE events SET skip_dates=? WHERE id=?', JSON.stringify(skips), id);
      } else await run(db, 'DELETE FROM events WHERE id=?', id);
      return json({ ok: true });
    }
  }

  // ===== chores =====
  if (res === 'chores') {
    if (m === 'POST' && id && action === 'toggle') {
      const b = await body(request);
      const date = b.date || (await today(db));
      const chore = await one(db, 'SELECT * FROM chores WHERE id=?', id);
      if (!chore) return bad('No such chore', 404);
      const done = await one(db, 'SELECT * FROM chore_done WHERE chore_id=? AND date=?', id, date);
      const who = b.person_id || chore.person_id;
      if (chore.points < 0 && !(await checkPin(db, b.pin))) return bad('Parent PIN required', 403);
      if (done) {
        await run(db, 'DELETE FROM chore_done WHERE chore_id=? AND date=?', id, date);
        await run(db, 'DELETE FROM points_log WHERE chore_id=? AND chore_date=?', id, date);
        return json({ ok: true, done: false });
      }
      await run(db, 'INSERT INTO chore_done (chore_id, date, person_id) VALUES (?,?,?)', id, date, who);
      if (who && chore.points !== 0) {
        await insert(db, 'points_log', { person_id: who, delta: chore.points, reason: chore.points < 0 ? `⚠️ ${chore.title}` : chore.title, chore_id: chore.id, chore_date: date });
      }
      return json({ ok: true, done: true, points: chore.points });
    }
    if (m === 'POST') {
      const b = jsonCols(pick(await body(request), CHORE_COLS), ['days']);
      if (!b.title) return bad('Title required');
      return json({ ok: true, id: await insert(db, 'chores', b) });
    }
    if (m === 'PUT' && id) {
      await update(db, 'chores', id, jsonCols(pick(await body(request), CHORE_COLS), ['days']));
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      await run(db, 'UPDATE chores SET active=0 WHERE id=?', id);
      return json({ ok: true });
    }
  }

  // ===== rewards & points =====
  if (res === 'rewards') {
    if (m === 'POST' && id && action === 'redeem') {
      const b = await body(request);
      const s = await settings(db);
      if (s.redeem_needs_pin === '1' && !(await checkPin(db, b.pin))) return bad('Ask Mom or Dad for the PIN', 403);
      const reward = await one(db, 'SELECT * FROM rewards WHERE id=?', id);
      if (!reward) return bad('No such reward', 404);
      const bal = (await balances(db))[b.person_id] || 0;
      if (bal < reward.cost) return bad(`Need ${reward.cost - bal} more points`);
      await insert(db, 'points_log', { person_id: b.person_id, delta: -reward.cost, reason: `${reward.emoji || '🎁'} ${reward.title}`, reward_id: reward.id });
      return json({ ok: true, balance: bal - reward.cost });
    }
    if (m === 'POST') {
      const b = await body(request);
      if (!(await checkPin(db, b.pin))) return bad('Parent PIN required', 403);
      return json({ ok: true, id: await insert(db, 'rewards', pick(b, REWARD_COLS)) });
    }
    if (m === 'PUT' && id) {
      const b = await body(request);
      if (!(await checkPin(db, b.pin))) return bad('Parent PIN required', 403);
      await update(db, 'rewards', id, pick(b, REWARD_COLS));
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      if (!(await checkPin(db, url.searchParams.get('pin')))) return bad('Parent PIN required', 403);
      await run(db, 'UPDATE rewards SET active=0 WHERE id=?', id);
      return json({ ok: true });
    }
  }
  if (res === 'points' && m === 'POST') {
    const b = await body(request);
    if (!(await checkPin(db, b.pin))) return bad('Parent PIN required', 403);
    await insert(db, 'points_log', { person_id: b.person_id, delta: Number(b.delta), reason: b.reason || (b.delta > 0 ? '⭐ Bonus' : 'Adjustment') });
    return json({ ok: true, balance: (await balances(db))[b.person_id] || 0 });
  }

  // ===== lists =====
  if (res === 'lists') {
    if (m === 'POST') {
      const b = await body(request);
      return json({ ok: true, id: await insert(db, 'lists', pick(b, ['name', 'emoji', 'sort'])) });
    }
    if (m === 'PUT' && id) { await update(db, 'lists', id, pick(await body(request), ['name', 'emoji', 'sort'])); return json({ ok: true }); }
    if (m === 'DELETE' && id) {
      await run(db, 'DELETE FROM list_items WHERE list_id=?', id);
      await run(db, 'DELETE FROM lists WHERE id=?', id);
      return json({ ok: true });
    }
  }
  if (res === 'items') {
    if (m === 'POST' && id === 'clear-done') {
      const b = await body(request);
      await run(db, 'DELETE FROM list_items WHERE list_id=? AND done=1', b.list_id);
      return json({ ok: true });
    }
    if (m === 'POST' && id && action === 'link') {
      const b = await body(request);
      const it = await one(db, 'SELECT i.text, l.name FROM list_items i JOIN lists l ON l.id = i.list_id WHERE i.id=?', id);
      if (!it) return bad('No such item', 404);
      const store = storeOf(it.name);
      if (!b.url) { await run(db, 'DELETE FROM item_links WHERE item_id=?', id); await run(db, 'DELETE FROM store_products WHERE store=? AND name=?', store, normName(it.text)); return json({ ok: true }); }
      const pid = productId(store, b.url);
      if (!pid) return bad(store === 'amazon' ? "That doesn't look like an Amazon product link. Open the product on Amazon, tap Share, Copy Link, and paste it here." : "That doesn't look like a Walmart product link. Open the product on Walmart, tap Share, Copy Link, and paste it here.");
      await run(db, 'INSERT OR REPLACE INTO item_links (item_id, pid) VALUES (?,?)', id, pid);
      await run(db, 'INSERT OR REPLACE INTO store_products (store, name, pid) VALUES (?,?,?)', store, normName(it.text), pid);
      return json({ ok: true, pid });
    }
    if (m === 'POST' && id === 'mark-done') {
      const b = await body(request);
      for (const i of b.ids || []) await run(db, 'UPDATE list_items SET done=1 WHERE id=?', i);
      return json({ ok: true });
    }
    if (m === 'POST') {
      const b = await body(request);
      const texts = Array.isArray(b.items) ? b.items : [b.text];
      const ids = [];
      for (const text of texts.filter(Boolean)) ids.push(await insert(db, 'list_items', { list_id: b.list_id, text, person_id: b.person_id ?? null }));
      await autoLink(db, b.list_id, ids);
      return json({ ok: true, ids });
    }
    if (m === 'PUT' && id) { await update(db, 'list_items', id, pick(await body(request), ['text', 'done', 'list_id'])); return json({ ok: true }); }
    if (m === 'DELETE' && id) { await run(db, 'DELETE FROM list_items WHERE id=?', id); await run(db, 'DELETE FROM item_links WHERE item_id=?', id); return json({ ok: true }); }
  }

  // ===== meals =====
  if (res === 'meals') {
    if (m === 'PUT' || m === 'POST') {
      const b = await body(request);
      if (!b.date || !b.slot) return bad('Date and meal required');
      if (!b.title) { await run(db, 'DELETE FROM meals WHERE date=? AND slot=?', b.date, b.slot); return json({ ok: true }); }
      await run(db, 'INSERT INTO meals (date, slot, title, ingredients) VALUES (?,?,?,?) ON CONFLICT(date, slot) DO UPDATE SET title=excluded.title, ingredients=excluded.ingredients',
        b.date, b.slot, b.title, JSON.stringify(b.ingredients || []));
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await run(db, 'DELETE FROM meals WHERE date=? AND slot=?', url.searchParams.get('date'), url.searchParams.get('slot'));
      return json({ ok: true });
    }
  }

  // ===== countdowns =====
  if (res === 'countdowns') {
    if (m === 'POST') { const b = await body(request); return json({ ok: true, id: await insert(db, 'countdowns', pick(b, ['title', 'date', 'emoji'])) }); }
    if (m === 'PUT' && id) { await update(db, 'countdowns', id, pick(await body(request), ['title', 'date', 'emoji'])); return json({ ok: true }); }
    if (m === 'DELETE' && id) { await run(db, 'DELETE FROM countdowns WHERE id=?', id); return json({ ok: true }); }
  }

  // ===== photos =====
  if (res === 'photos') {
    if (m === 'GET' && id) {
      const p = await one(db, 'SELECT data FROM photos WHERE id=?', id);
      if (!p) return bad('No photo', 404);
      const [meta, b64] = p.data.split(',');
      const type = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    if (m === 'POST') {
      const b = await body(request);
      if (!String(b.data || '').startsWith('data:image/')) return bad('Not an image');
      if (b.data.length > 1_400_000) return bad('Photo too large — try a smaller one');
      return json({ ok: true, id: await insert(db, 'photos', { data: b.data, caption: b.caption || null }) });
    }
    if (m === 'DELETE' && id) { await run(db, 'DELETE FROM photos WHERE id=?', id); return json({ ok: true }); }
  }

  // ===== people & settings (parent PIN) =====
  if (res === 'people' && m === 'PUT' && id) {
    const b = await body(request);
    if (!(await checkPin(db, b.pin))) return bad('Parent PIN required', 403);
    await update(db, 'people', id, pick(b, ['name', 'nickname', 'color', 'emoji', 'is_kid', 'sort']));
    return json({ ok: true });
  }
  if (res === 'settings' && m === 'PUT') {
    const b = await body(request);
    if (!(await checkPin(db, b.pin))) return bad('Parent PIN required', 403);
    for (const [k, v] of Object.entries(b.values || {})) {
      await run(db, 'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
    }
    return json({ ok: true });
  }
  if (res === 'pin-check' && m === 'POST') {
    const b = await body(request);
    return json({ ok: await checkPin(db, b.pin) });
  }

  return bad('Not found', 404);
}

// ---------------- Siri / quick add ----------------
async function say(db, text) {
  const t = await today(db);
  const people = await all(db, 'SELECT * FROM people ORDER BY sort');
  const lists = await all(db, 'SELECT * FROM lists ORDER BY sort');
  const p = parse(text, { people, lists, today: t });
  const nameOf = (ids) => joinNames(ids.map((i) => people.find((x) => x.id === i)?.name).filter(Boolean));

  switch (p.kind) {
    case 'event': {
      const row = {
        title: p.title, start_date: p.start_date, start_time: p.start_time, end_time: p.end_time,
        people: JSON.stringify(p.people), location: p.location, repeat: p.repeat,
        weekly_days: p.weekly_days ? JSON.stringify(p.weekly_days) : null,
      };
      const newId = await insert(db, 'events', row);
      const who = p.people.length ? ` for ${nameOf(p.people)}` : '';
      const when = p.repeat
        ? ` ${repeatWords(p)}`
        : ` ${onDate(p.start_date, t)}`;
      const at = p.start_time ? ` at ${friendlyTime(p.start_time)}` : '';
      return { ok: true, kind: 'event', id: newId, undo: { type: 'event', id: newId }, item: { ...row, id: newId },
        reply: `Added ${p.title}${who}${when}${at}.` };
    }
    case 'list': {
      const ids = [];
      for (const it of p.items) ids.push(await insert(db, 'list_items', { list_id: p.list_id, text: it }));
      await autoLink(db, p.list_id, ids);
      return { ok: true, kind: 'list', undo: { type: 'items', ids },
        reply: `Added ${joinNames(p.items.map((x) => x.toLowerCase()))} to ${p.list_name}.` };
    }
    case 'chore': {
      const created = [];
      const targets = [p.person_id, ...(p.extra_people || [])];
      for (const pid of targets) {
        created.push(await insert(db, 'chores', {
          title: p.title, person_id: pid, points: p.points, emoji: p.points < 0 ? '⚠️' : choreEmoji(p.title),
          days: JSON.stringify(p.points < 0 ? [0, 1, 2, 3, 4, 5, 6] : p.days), time_of_day: p.points < 0 ? 'any' : p.time_of_day, one_time_date: p.points < 0 ? null : p.one_time_date,
        }));
      }
      const who = p.person_id ? ` for ${nameOf(targets.filter(Boolean))}` : '';
      const when = p.one_time_date ? ` ${onDate(p.one_time_date, t)}` : p.days.length === 7 ? ' every day' : ` on ${p.days.map((d) => ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][d]).join(', ')}`;
      const pts = p.points ? `, worth ${p.points} points` : '';
      return { ok: true, kind: 'chore', undo: { type: 'chores', ids: created }, reply: p.points < 0 ? `Added behavior ${p.title}${who}: takes away ${-p.points} points.` : `Added chore ${p.title}${who}${when}${pts}.` };
    }
    case 'meal': {
      await run(db, 'INSERT INTO meals (date, slot, title) VALUES (?,?,?) ON CONFLICT(date, slot) DO UPDATE SET title=excluded.title', p.date, p.slot, p.title);
      return { ok: true, kind: 'meal', undo: { type: 'meal', date: p.date, slot: p.slot },
        reply: `${p.title} for ${p.slot} ${onDate(p.date, t)}.` };
    }
    case 'countdown': {
      const newId = await insert(db, 'countdowns', { title: p.title, date: p.date, emoji: '🎉' });
      const days = Math.round((Date.parse(p.date) - Date.parse(t)) / 86400000);
      return { ok: true, kind: 'countdown', undo: { type: 'countdown', id: newId },
        reply: `Counting down to ${p.title} — ${days} day${days === 1 ? '' : 's'} to go.` };
    }
    case 'query': {
      if (p.range === 'week') {
        const lines = [];
        for (let i = 0; i < 7; i++) {
          const d = addDays(t, i);
          const s = await daySummary(db, d, t, true);
          if (s) lines.push(s);
        }
        return { ok: true, kind: 'query', reply: lines.length ? lines.join(' ') : 'Nothing on the calendar this week.' };
      }
      return { ok: true, kind: 'query', reply: await daySummary(db, p.date, t) };
    }
    case 'meal_query': {
      const meal = await one(db, 'SELECT title FROM meals WHERE date=? AND slot=?', p.date, p.slot);
      return { ok: true, kind: 'query', reply: meal ? `${p.slot === 'dinner' ? 'Dinner' : p.slot} ${p.date === t ? 'tonight' : friendlyDate(p.date, t)} is ${meal.title}.` : `Nothing planned for ${p.slot} yet.` };
    }
    case 'points_query': {
      const bal = await balances(db);
      const kids = (p.people.length ? people.filter((x) => p.people.includes(x.id)) : people.filter((x) => x.is_kid));
      return { ok: true, kind: 'query', reply: kids.map((k) => `${k.name} has ${bal[k.id] || 0} points.`).join(' ') };
    }
    default:
      return { ok: false, kind: 'error', reply: p.reply || "Sorry, I didn't understand that." };
  }
}

function onDate(d, t) {
  const f = friendlyDate(d, t);
  return f === 'today' || f === 'tomorrow' ? f : 'on ' + f;
}

function repeatWords(p) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (p.repeat === 'daily') return 'every day';
  if (p.repeat === 'weekdays') return 'every weekday';
  if (p.repeat === 'weekly') {
    const days = p.weekly_days || [new Date(p.start_date + 'T12:00:00Z').getUTCDay()];
    return 'every ' + joinNames(days.map((d) => names[d]));
  }
  if (p.repeat === 'biweekly') return 'every other ' + names[new Date(p.start_date + 'T12:00:00Z').getUTCDay()];
  if (p.repeat === 'monthly') return 'every month';
  if (p.repeat === 'semimonthly') {
    const o = (n) => n === -1 ? 'last day' : n + ([11, 12, 13].includes(n) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
    return `on the ${joinNames(((p.weekly_days || {}).dates || []).map(o))} of every month`;
  }
  if (p.repeat === 'bimonthly') {
    const n = new Date(p.start_date + 'T12:00:00Z').getUTCDate();
    return `every other month on the ${n}${[11, 12, 13].includes(n) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
  }
  if (p.repeat === 'monthly_nth') {
    const r = p.weekly_days || {};
    return `on the ${{ 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' }[r.nth]} ${names[r.day]} of every month`;
  }
  if (p.repeat === 'yearly') return 'every year';
  return '';
}

async function daySummary(db, date, t, compact = false) {
  const events = await all(db, 'SELECT * FROM events WHERE start_date <= ?', date);
  const people = await all(db, 'SELECT * FROM people');
  const list = eventsOn(events, date);
  const meal = await one(db, "SELECT title FROM meals WHERE date=? AND slot='dinner'", date);
  const when = date === t ? 'Today' : date === addDays(t, 1) ? 'Tomorrow' : friendlyDate(date, t);
  if (!list.length && compact) return '';
  let s = list.length
    ? `${when}: ` + list.map((e) => {
        const ids = JSON.parse(e.people || '[]');
        const who = ids.length ? ` for ${joinNames(ids.map((i) => people.find((p) => p.id === i)?.name).filter(Boolean))}` : '';
        return `${e.title}${who}${e.start_time ? ' at ' + friendlyTime(e.start_time) : ''}`;
      }).join(', ') + '.'
    : `Nothing on the calendar ${when.toLowerCase() === 'today' || when.toLowerCase() === 'tomorrow' ? when.toLowerCase() : 'on ' + when}.`;
  if (meal && !compact) s += ` Dinner is ${meal.title}.`;
  return s;
}

async function undo(db, u) {
  if (u.type === 'event') await run(db, 'DELETE FROM events WHERE id=?', u.id);
  else if (u.type === 'items') for (const i of u.ids || []) await run(db, 'DELETE FROM list_items WHERE id=?', i);
  else if (u.type === 'chores') for (const i of u.ids || []) await run(db, 'DELETE FROM chores WHERE id=?', i);
  else if (u.type === 'meal') await run(db, 'DELETE FROM meals WHERE date=? AND slot=?', u.date, u.slot);
  else if (u.type === 'countdown') await run(db, 'DELETE FROM countdowns WHERE id=?', u.id);
  else return { ok: false };
  return { ok: true };
}

function choreEmoji(title) {
  const map = [
    [/bed/i, '🛏️'], [/teeth|brush/i, '🪥'], [/toy/i, '🧸'], [/dish/i, '🍽️'], [/table/i, '🍽️'], [/trash|garbage/i, '🗑️'],
    [/laundry|clothes|hamper/i, '🧺'], [/dog|cat|pet|fish|feed/i, '🐾'], [/plant|water/i, '🪴'], [/read|book|homework/i, '📚'],
    [/vacuum|sweep|clean/i, '🧹'], [/shoe/i, '👟'], [/backpack/i, '🎒'], [/car|truck/i, '🚙'], [/yard|lawn|mow|leaves/i, '🍂'],
  ];
  return (map.find(([re]) => re.test(title)) || [null, '⭐'])[1];
}
