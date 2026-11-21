// Fetches this Saturday's 3pm fixtures and scores and saves them to Supabase.
// Run by GitHub Actions on a schedule. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY.
// Usage: node scripts/update-results.mjs [YYYY-MM-DD]
import { fetchSaturday, currentSaturday } from '../js/espn.js';
import { fetchBbcSaturday } from '../js/bbc.js';
import { LEAGUES, espnLeagues } from '../js/leagues.js';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (add them as GitHub repository secrets).');
  process.exit(1);
}

const day = process.argv[2] || currentSaturday();
console.log(`Updating 3pm fixtures for Saturday ${day}`);

// ESPN: most leagues.
const espn = await fetchSaturday(day);
for (const e of espn.errors) console.warn(`Could not fetch ${e}`);
const failed = new Set(espn.errors.map((e) => e.split(':')[0]));
const okLeagues = espnLeagues().map((l) => l.code).filter((c) => !failed.has(c));
const fixtures = [...espn.fixtures];

// BBC Sport: Scottish League One/Two and NIFL Premiership.
try {
  fixtures.push(...await fetchBbcSaturday(day));
  okLeagues.push(...LEAGUES.filter((l) => l.source === 'bbc').map((l) => l.code));
} catch (e) {
  console.warn(`Could not fetch BBC Sport: ${e.message}`);
}

if (okLeagues.length === 0) {
  console.error('Every league failed to load. Nothing saved.');
  process.exit(1);
}

const headers = { apikey: key, 'Content-Type': 'application/json' };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // older JWT-style keys

const res = await fetch(`${url}/rest/v1/rpc/sync_fixtures`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ week: day, rows: fixtures, leagues: okLeagues, source: 'job' }),
});
if (!res.ok) {
  console.error(`Supabase said ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const count = (s) => fixtures.filter((f) => f.status === s).length;
console.log(`Saved ${fixtures.length} matches: ${count('ft')} finished, ${count('live')} live, ` +
  `${count('scheduled')} not started, ${count('postponed') + count('abandoned') + count('cancelled')} off.`);
for (const l of LEAGUES) console.log(`  ${l.code} ${l.country} ${l.name}: ${fixtures.filter((f) => f.league === l.code).length}`);
