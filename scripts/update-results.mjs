// Fetches this Saturday's 3pm fixtures and scores and saves them to Supabase.
// Run by GitHub Actions on a schedule. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY.
// Usage: node scripts/update-results.mjs [YYYY-MM-DD]
import { fetchSaturday, currentSaturday } from '../js/espn.js';
import { LEAGUES } from '../js/leagues.js';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (add them as GitHub repository secrets).');
  process.exit(1);
}

const day = process.argv[2] || currentSaturday();
console.log(`Updating 3pm fixtures for Saturday ${day}`);

const { fixtures, errors } = await fetchSaturday(day);
for (const e of errors) console.warn(`Could not fetch ${e}`);
const failed = new Set(errors.map((e) => e.split(':')[0]));
const okLeagues = LEAGUES.map((l) => l.code).filter((c) => !failed.has(c));

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
