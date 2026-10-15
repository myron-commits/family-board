-- Glick Family Board database
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS chores;
DROP TABLE IF EXISTS chore_done;
DROP TABLE IF EXISTS rewards;
DROP TABLE IF EXISTS points_log;
DROP TABLE IF EXISTS lists;
DROP TABLE IF EXISTS list_items;
DROP TABLE IF EXISTS meals;
DROP TABLE IF EXISTS countdowns;
DROP TABLE IF EXISTS photos;
DROP TABLE IF EXISTS settings;

CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nickname TEXT,            -- "Dad", "Mom" — also understood by Siri
  color TEXT NOT NULL,
  emoji TEXT,
  is_kid INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,     -- YYYY-MM-DD
  start_time TEXT,              -- HH:MM (null = all day)
  end_time TEXT,
  people TEXT DEFAULT '[]',     -- JSON array of person ids ([] = whole family)
  location TEXT,
  notes TEXT,
  repeat TEXT,                  -- null | daily | weekdays | weekly | biweekly | monthly | yearly
  repeat_until TEXT,
  weekly_days TEXT,             -- JSON array of weekdays for 'weekly' (e.g. Mon & Wed)
  skip_dates TEXT DEFAULT '[]', -- JSON array of YYYY-MM-DD for deleted single occurrences
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  person_id INTEGER,            -- null = anyone
  points INTEGER DEFAULT 5,
  emoji TEXT,
  days TEXT DEFAULT '[0,1,2,3,4,5,6]', -- JSON array, 0=Sun
  time_of_day TEXT DEFAULT 'any',      -- morning | afternoon | evening | any
  one_time_date TEXT,                  -- set for a one-off chore
  active INTEGER DEFAULT 1
);

CREATE TABLE chore_done (
  chore_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  person_id INTEGER,
  done_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (chore_id, date)
);

CREATE TABLE rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  cost INTEGER NOT NULL,
  emoji TEXT,
  category TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  chore_id INTEGER,
  chore_date TEXT,
  reward_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT,
  sort INTEGER DEFAULT 0
);

CREATE TABLE list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  person_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE meals (
  date TEXT NOT NULL,
  slot TEXT NOT NULL,           -- breakfast | lunch | dinner | snack
  title TEXT NOT NULL,
  ingredients TEXT DEFAULT '[]',
  PRIMARY KEY (date, slot)
);

CREATE TABLE countdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  emoji TEXT
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,           -- data:image/jpeg;base64,... (resized on upload)
  caption TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ===== Your family =====
INSERT INTO people (name, nickname, color, emoji, is_kid, sort) VALUES
  ('Myron',  'Dad', '#2f6db5', '🚒', 0, 1),
  ('Sharon', 'Mom', '#c2417a', '🌷', 0, 2),
  ('Ian',    NULL,  '#2e9d5b', '🦖', 1, 3),
  ('Avalia', NULL,  '#8a4fd1', '🦄', 1, 4),
  ('Aerie',  NULL,  '#e08a1e', '🐣', 1, 5);

-- ===== Starter chores (edit freely in the app) =====
-- Ian (7)
INSERT INTO chores (title, person_id, points, emoji, days, time_of_day) VALUES
  ('Make bed',              3, 5,  '🛏️', '[0,1,2,3,4,5,6]', 'morning'),
  ('Brush teeth (AM)',      3, 3,  '🪥', '[0,1,2,3,4,5,6]', 'morning'),
  ('Get dressed & ready',   3, 3,  '👕', '[1,2,3,4,5]',     'morning'),
  ('Unpack backpack',       3, 5,  '🎒', '[1,2,3,4,5]',     'afternoon'),
  ('Homework / reading',    3, 10, '📚', '[1,2,3,4]',       'afternoon'),
  ('Help set the table',    3, 5,  '🍽️', '[0,1,2,3,4,5,6]', 'evening'),
  ('Clean up room',         3, 10, '🧸', '[0,3,6]',         'evening'),
  ('Brush teeth (PM)',      3, 3,  '🪥', '[0,1,2,3,4,5,6]', 'evening');
-- Avalia (4)
INSERT INTO chores (title, person_id, points, emoji, days, time_of_day) VALUES
  ('Brush teeth (AM)',      4, 3, '🪥', '[0,1,2,3,4,5,6]', 'morning'),
  ('Get dressed',           4, 3, '👗', '[0,1,2,3,4,5,6]', 'morning'),
  ('Pick up toys',          4, 5, '🧸', '[0,1,2,3,4,5,6]', 'evening'),
  ('Clothes in hamper',     4, 3, '🧺', '[0,1,2,3,4,5,6]', 'evening'),
  ('Help feed / water plants', 4, 3, '🪴', '[2,5]',        'any'),
  ('Brush teeth (PM)',      4, 3, '🪥', '[0,1,2,3,4,5,6]', 'evening');
-- Aerie (2) — simple helper jobs
INSERT INTO chores (title, person_id, points, emoji, days, time_of_day) VALUES
  ('Brush teeth',           5, 2, '🪥', '[0,1,2,3,4,5,6]', 'evening'),
  ('Toys in the bin',       5, 2, '🧸', '[0,1,2,3,4,5,6]', 'evening'),
  ('Shoes by the door',     5, 2, '👟', '[0,1,2,3,4,5,6]', 'any');
-- Grown-ups (no points, just a shared checklist)
INSERT INTO chores (title, person_id, points, emoji, days, time_of_day) VALUES
  ('Trash to the curb',     1, 0, '🗑️', '[2]', 'evening'),
  ('Water plants',          2, 0, '🪴', '[1,4]', 'any');

-- ===== Rewards =====
INSERT INTO rewards (title, cost, emoji, category) VALUES
  ('15 min screen time',        15, '📱', 'Screen time'),
  ('30 min screen time',        25, '📺', 'Screen time'),
  ('Pick the family movie',     40, '🎬', 'Screen time'),
  ('Stay up 15 min late',       30, '🌙', 'Privilege'),
  ('Pick what''s for dinner',   40, '🍕', 'Privilege'),
  ('Front seat / special seat', 20, '💺', 'Privilege'),
  ('Skip one chore',            35, '🎟️', 'Privilege'),
  ('Extra bedtime story',       10, '📖', 'Privilege'),
  ('Ice cream treat',           30, '🍦', 'Treat'),
  ('Pick a candy at the store', 25, '🍬', 'Treat'),
  ('Baking with Mom',           60, '🧁', 'Time together'),
  ('Shop trip with Dad',        60, '🔧', 'Time together'),
  ('Ride on the fire truck',   150, '🚒', 'Time together'),
  ('Park / playground trip',    50, '🛝', 'Outing'),
  ('Choose a family game night',40, '🎲', 'Outing'),
  ('Friend sleepover',         200, '⛺', 'Outing'),
  ('$1 spending money',         20, '💵', 'Money'),
  ('New small toy',            250, '🎁', 'Big reward');

-- ===== Lists =====
INSERT INTO lists (name, emoji, sort) VALUES
  ('Groceries', '🛒', 1),
  ('To-do', '✅', 2),
  ('Hardware store', '🔩', 3);

-- ===== Settings =====
INSERT INTO settings (key, value) VALUES
  ('family_name', 'Our Family'),
  ('parent_pin', '1234'),
  ('lat', '41.6731'),
  ('lon', '-85.5800'),
  ('city', 'Shipshewana'),
  ('night_start', '21:30'),
  ('night_end', '06:00'),
  ('photo_idle_minutes', '10'),
  ('redeem_needs_pin', '1'),
  ('tz', 'America/Indiana/Indianapolis');
