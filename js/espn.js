// Reads fixtures and scores from ESPN's free public scoreboard feed.
// Works in Node 20+ (the scheduled job) and in the browser (the refresh button).
import { LEAGUES } from './leagues.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Saturday as 'YYYY-MM-DD' -> 'YYYYMMDD'
const compact = (day) => day.replaceAll('-', '');

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function londonDateTime(iso) {
  const p = Object.fromEntries(londonParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function mapStatus(type = {}) {
  const name = (type.name || '').toUpperCase();
  if (name.includes('POSTPONED')) return 'postponed';
  if (name.includes('ABANDON')) return 'abandoned';
  if (name.includes('CANCEL')) return 'cancelled';
  if (type.state === 'post' || type.completed) return 'ft';
  if (type.state === 'in') return 'live';
  return 'scheduled';
}

// Turn one league's scoreboard JSON into our fixture rows (3pm kick-offs on `day` only).
export function parseScoreboard(json, leagueCode, day) {
  const out = [];
  for (const ev of json?.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const when = londonDateTime(ev.date || comp.date);
    if (when.date !== day || when.time !== '15:00') continue;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const status = mapStatus(ev.status?.type || comp.status?.type);
    const score = (c) => (status === 'scheduled' || c.score === undefined || c.score === '' ? null : Number(c.score));
    out.push({
      id: `espn-${ev.id}`,
      week_id: day,
      league: leagueCode,
      kickoff: new Date(ev.date || comp.date).toISOString(),
      home: home.team?.shortDisplayName || home.team?.displayName,
      away: away.team?.shortDisplayName || away.team?.displayName,
      home_full: home.team?.displayName || null,
      away_full: away.team?.displayName || null,
      home_score: score(home),
      away_score: score(away),
      status,
      clock: ev.status?.displayClock || null,
    });
  }
  return out;
}

// Fetch every league for one Saturday. Returns { fixtures, errors }.
export async function fetchSaturday(day, fetchImpl = fetch) {
  const results = await Promise.all(LEAGUES.map(async (l) => {
    try {
      const res = await fetchImpl(`${BASE}/${l.code}/scoreboard?dates=${compact(day)}&limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { fixtures: parseScoreboard(await res.json(), l.code, day) };
    } catch (e) {
      return { fixtures: [], error: `${l.code}: ${e.message}` };
    }
  }));
  return {
    fixtures: results.flatMap((r) => r.fixtures),
    errors: results.filter((r) => r.error).map((r) => r.error),
  };
}

// The Saturday this week's game is about: today if Saturday, otherwise the next one.
// (On Sunday to Friday the app is looking ahead to the coming Saturday.)
export function currentSaturday(now = new Date()) {
  const { date } = londonDateTime(now.toISOString());
  const d = new Date(`${date}T12:00:00Z`);
  const add = (6 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

// Picks lock at 3pm UK time on the Saturday.
export function deadlineFor(day) {
  // 15:00 London is 15:00Z in winter and 14:00Z in summer.
  for (const utcHour of [15, 14]) {
    const iso = `${day}T${String(utcHour).padStart(2, '0')}:00:00Z`;
    if (londonDateTime(iso).time === '15:00') return iso;
  }
  return `${day}T15:00:00Z`;
}
