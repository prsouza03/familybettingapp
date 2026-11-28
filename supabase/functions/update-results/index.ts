// Supabase Edge Function: fetches this Saturday's 3pm fixtures and scores from ESPN and BBC Sport
// and saves them. Called by the app's Refresh button and every few minutes on Saturday by pg_cron.
// It reuses the app's own code, loaded from the live website.
import { fetchSaturday, currentSaturday } from 'https://prsouza03.github.io/familybettingapp/js/espn.js';
import { fetchBbcSaturday } from 'https://prsouza03.github.io/familybettingapp/js/bbc.js';
import { LEAGUES, espnLeagues } from 'https://prsouza03.github.io/familybettingapp/js/leagues.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  let body: { day?: string; source?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day || '') ? body.day! : currentSaturday();
  const source = body.source === 'cron' ? 'cron' : 'refresh';

  // Don't hammer the sources: if an update ran in the last 45 seconds, just say so.
  const recent = await fetch(`${url}/rest/v1/sync_log?select=ran_at&order=ran_at.desc&limit=1`, { headers });
  const last = (await recent.json())?.[0]?.ran_at;
  if (last && Date.now() - Date.parse(last) < 45_000) return reply({ skipped: true, last });

  const espn = await fetchSaturday(day);
  const failed = new Set(espn.errors.map((e) => String(e).split(':')[0]));
  const leagues = espnLeagues().map((l: { code: string }) => l.code).filter((c: string) => !failed.has(c));
  const fixtures = [...espn.fixtures];
  const errors: string[] = espn.errors.map(String);
  try {
    fixtures.push(...await fetchBbcSaturday(day));
    leagues.push(...LEAGUES.filter((l: { source?: string }) => l.source === 'bbc').map((l: { code: string }) => l.code));
  } catch (e) {
    errors.push(`bbc: ${(e as Error).message}`);
  }
  if (!leagues.length) return reply({ error: 'Every source failed', errors }, 502);

  const res = await fetch(`${url}/rest/v1/rpc/sync_fixtures`, {
    method: 'POST', headers, body: JSON.stringify({ week: day, rows: fixtures, leagues, source }),
  });
  if (!res.ok) return reply({ error: await res.text() }, 500);
  return reply({ day, saved: fixtures.length, errors });
});
