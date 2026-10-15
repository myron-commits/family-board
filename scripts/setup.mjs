// One-time setup: creates the database on your Cloudflare account, loads it, sets the
// family key, and puts the app online. Run with:  npm run setup
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';

const sh = (cmd, opts = {}) => {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', ...opts });
};
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n=== Family Board setup ===\n');
console.log('Step 1 of 5: sign in to Cloudflare (a browser window will open).');
sh('npx wrangler login');

let toml = readFileSync('wrangler.toml', 'utf8');
if (toml.includes('REPLACE_WITH_YOUR_DATABASE_ID')) {
  console.log('\nStep 2 of 5: creating the database.');
  let out = '';
  try {
    out = sh('npx wrangler d1 create family-board --binding DB --update-config=false', { capture: true });
  } catch (e) {
    out = String(e.stdout || '');
  }
  console.log(out);
  let id = (out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/) || out.match(/"database_id":\s*"([0-9a-f-]{36})"/) || [])[1];
  if (!id) {
    // database may already exist — look it up
    const list = sh('npx wrangler d1 list --json', { capture: true });
    id = (JSON.parse(list).find((d) => d.name === 'family-board') || {}).uuid;
  }
  if (!id) throw new Error('Could not find the database ID. Copy it from the output above into wrangler.toml and run this again.');
  toml = toml.replace('REPLACE_WITH_YOUR_DATABASE_ID', id);
  writeFileSync('wrangler.toml', toml);
  console.log(`Saved database ID ${id} to wrangler.toml`);

  console.log('\nStep 3 of 5: loading your family, chores, and rewards.');
  sh('npx wrangler d1 execute family-board --remote --file=schema.sql --yes');
} else {
  console.log('Database already set up — skipping steps 2 and 3 (your data is safe).');
}

console.log('\nStep 4 of 5: making your family key (like a Wi-Fi password for the board).');
let key;
try { key = (readFileSync('FAMILY-KEY.txt', 'utf8').match(/key: (\S+)/) || [])[1]; } catch {}
if (!key) {
  key = randomBytes(9).toString('base64url');
  writeFileSync('FAMILY-KEY.txt', `Family Board key: ${key}\nKeep this private.\n`);
}
console.log('Saved it to FAMILY-KEY.txt in this folder.');
rl.close();

console.log('\nStep 5 of 5: putting the app online.');
let dep = '';
try {
  dep = sh('npx wrangler deploy', { capture: true });
} catch (e) {
  const out = String(e.stdout || '');
  if (!/workers\.dev subdomain/i.test(out)) throw e;
  console.log('\n*** Cloudflare needs a free web address for your account (one time). ***');
  console.log('*** When asked, answer Y, then type a short name like glickfamily and press Enter. ***\n');
  sh('npx wrangler deploy'); // interactive: lets you pick the workers.dev name
  dep = sh('npx wrangler deploy', { capture: true });
}
console.log(dep);
execSync('npx wrangler secret put FAMILY_KEY', { input: key + '\n', stdio: ['pipe', 'inherit', 'inherit'] });

const url = (dep.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0] || 'https://family-board.<your-subdomain>.workers.dev';
console.log(`
=========================================================
 Done! Your Family Board is live.

 Wall screen & phone link (keep it private):
   ${url}/?key=${key}

 Siri address:   ${url}/api/say
 Siri key:       ${key}

 Default parent PIN is 1234 — change it in Settings.
=========================================================
`);
