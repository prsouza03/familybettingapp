// Reads 3pm fixtures and scores from BBC Sport's public scores page, for the leagues
// ESPN no longer covers (Scottish League One and Two, NIFL Premiership).
// Used by the scheduled job only: browsers can't read the BBC page from another site.
import { BBC_NAMES } from './leagues.js';

export function mapBbcStatus(s = '') {
  const t = s.toLowerCase();
  if (t.includes('postpone')) return 'postponed';
  if (t.includes('abandon')) return 'abandoned';
  if (t.includes('cancel')) return 'cancelled';
  if (t === 'postevent') return 'ft';
  if (t === 'midevent' || t === 'suspended') return 'live';
  return 'scheduled';
}

// Pull the page's embedded data (window.__INITIAL_DATA__ = "<json string>").
export function extractEventGroups(html) {
  const m = html.match(/window\.__INITIAL_DATA__\s*=\s*("(?:[^"\\]|\\.)*")/);
  if (!m) throw new Error('BBC page layout changed: no data found');
  const data = JSON.parse(JSON.parse(m[1]));
  const key = Object.keys(data.data || {}).find((k) => k.startsWith('sport-data-scores-fixtures'));
  const groups = key && data.data[key]?.data?.eventGroups;
  if (!Array.isArray(groups)) throw new Error('BBC page layout changed: no fixtures list');
  return groups;
}

export function parseBbc(groups, day) {
  const out = [];
  for (const g of groups) {
    for (const sg of g.secondaryGroups || []) {
      for (const ev of sg.events || []) {
        const league = BBC_NAMES[ev.tournament?.name];
        if (!league) continue;
        if (ev.date?.isoDate !== day || ev.time?.displayTimeUK !== '15:00') continue;
        const status = mapBbcStatus(ev.status);
        const score = (side) => (status === 'scheduled' || side?.score == null || side.score === '' ? null : Number(side.score));
        out.push({
          id: `bbc-${ev.id}`,
          week_id: day,
          league,
          kickoff: ev.startDateTime,
          home: ev.home?.shortName || ev.home?.fullName,
          away: ev.away?.shortName || ev.away?.fullName,
          home_full: ev.home?.fullName || null,
          away_full: ev.away?.fullName || null,
          home_score: score(ev.home),
          away_score: score(ev.away),
          status,
          clock: ev.periodLabel?.value || null,
        });
      }
    }
  }
  return out;
}

export async function fetchBbcSaturday(day, fetchImpl = fetch) {
  const res = await fetchImpl(`https://www.bbc.co.uk/sport/football/scores-fixtures/${day}`);
  if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
  return parseBbc(extractEventGroups(await res.text()), day);
}
