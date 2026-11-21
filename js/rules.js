// The family rules, as plain functions with no network or DOM access, so the
// app and the tests share exactly the same logic.
import { LEAGUE_BY_CODE } from './leagues.js';

export const ENTRY_FEE = 10; // pounds
export const PICKS_PER_WEEK = 10;
export const MAX_POINTS = PICKS_PER_WEEK * 2;

const OFF = new Set(['postponed', 'abandoned', 'cancelled']);
export const isOff = (f) => !!f && OFF.has(f.status);
const STARTED = new Set(['live', 'ft']);

// 1 point per team that scores: 0, 1 or 2.
export function matchPoints(f) {
  if (!f || !STARTED.has(f.status)) return 0;
  return (f.home_score > 0 ? 1 : 0) + (f.away_score > 0 ? 1 : 0);
}

// Flashscore order: league order, then home team A to Z (all are 3pm kick-offs).
export function sortFixtures(fixtures) {
  return [...fixtures].sort((a, b) => {
    const la = LEAGUE_BY_CODE[a.league]?.rank ?? 99;
    const lb = LEAGUE_BY_CODE[b.league]?.rank ?? 99;
    if (la !== lb) return la - lb;
    return a.home.localeCompare(b.home, 'en-GB', { sensitivity: 'base' });
  });
}

// The matches a postponed pick can roll to, in order: the rest of its own
// league below it, then each league further down the chain from the top.
export function rollCandidates(fixture, fixtures) {
  const sorted = sortFixtures(fixtures);
  const out = [];
  const sameLeague = sorted.filter((f) => f.league === fixture.league);
  const idx = sameLeague.findIndex((f) => f.id === fixture.id);
  out.push(...sameLeague.slice(idx + 1));
  let next = LEAGUE_BY_CODE[fixture.league]?.next;
  while (next) {
    out.push(...sorted.filter((f) => f.league === next));
    next = LEAGUE_BY_CODE[next]?.next;
  }
  return out;
}

// Work out which match each of a player's picks really counts as.
// picks: [{ fixture_id, slot, replacement_fixture_id }]
// Returns one entry per pick with { pick, original, effective, how }
//   how: 'as-picked' | 'rolled' | 'manual' | 'needs-pick'
export function resolvePicks(picks, fixtures) {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const ordered = [...picks].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  // A replacement can never be a match the player already picked.
  const used = new Set(ordered.map((p) => p.fixture_id));
  for (const p of ordered) if (p.replacement_fixture_id) used.add(p.replacement_fixture_id);

  return ordered.map((pick) => {
    const original = byId.get(pick.fixture_id) || null;
    if (pick.replacement_fixture_id) {
      return { pick, original, effective: byId.get(pick.replacement_fixture_id) || null, how: 'manual' };
    }
    if (!isOff(original)) return { pick, original, effective: original, how: 'as-picked' };
    const next = rollCandidates(original, fixtures).find((f) => !isOff(f) && !used.has(f.id));
    if (!next) return { pick, original, effective: null, how: 'needs-pick' };
    used.add(next.id);
    return { pick, original, effective: next, how: 'rolled' };
  });
}

// Is every match that matters this week finished (or off)?
export function weekIsFinished(fixtures) {
  return fixtures.length > 0 && fixtures.every((f) => f.status === 'ft' || isOff(f));
}

// players: [{ id, name }]; picksByPlayer: Map(playerId -> picks[])
// Only players who entered 10 picks are in the game (and paid the £10).
export function weekStandings(players, picksByPlayer, fixtures) {
  const rows = [];
  for (const player of players) {
    const picks = picksByPlayer.get(player.id) || [];
    if (picks.length < PICKS_PER_WEEK) continue;
    const resolved = resolvePicks(picks, fixtures);
    const points = resolved.reduce((s, r) => s + matchPoints(r.effective), 0);
    const bothScored = resolved.filter((r) => matchPoints(r.effective) === 2).length;
    const blanks = resolved.filter((r) => r.effective && r.effective.status === 'ft' && matchPoints(r.effective) === 0).length;
    rows.push({ player, resolved, points, bothScored, blanks });
  }
  rows.sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name));

  const pot = rows.length * ENTRY_FEE;
  const finished = weekIsFinished(fixtures) && rows.every((r) => r.resolved.every((x) => x.how !== 'needs-pick'));
  const top = rows.length ? rows[0].points : 0;
  const winners = rows.length ? rows.filter((r) => r.points === top) : [];
  const share = winners.length ? Math.round((pot / winners.length) * 100) / 100 : 0;
  rows.forEach((r, i) => {
    r.position = i > 0 && rows[i - 1].points === r.points ? rows[i - 1].position : i + 1;
    r.isWinner = winners.includes(r);
    r.winnings = finished && r.isWinner ? share : 0;
  });
  return { rows, pot, finished, winners: winners.map((w) => w.player), share };
}

// weeks: [{ week_id, standings }] for finished weeks, oldest first.
export function seasonStats(weeks) {
  const byPlayer = new Map();
  const get = (p) => {
    if (!byPlayer.has(p.id)) {
      byPlayer.set(p.id, {
        player: p, played: 0, wins: 0, soleWins: 0, won: 0, points: 0, best: 0,
        twenties: 0, bothScored: 0, blanks: 0, streak: 0, bestStreak: 0,
      });
    }
    return byPlayer.get(p.id);
  };
  const twenties = [];
  let record = null;
  const teamPoints = new Map(); // playerId -> Map(team -> points)

  for (const { week_id, standings } of weeks) {
    if (!standings.finished) continue;
    for (const r of standings.rows) {
      const s = get(r.player);
      s.played += 1;
      s.points += r.points;
      s.best = Math.max(s.best, r.points);
      s.bothScored += r.bothScored;
      s.blanks += r.blanks;
      s.won += r.winnings;
      if (r.isWinner) {
        s.wins += 1;
        if (standings.winners.length === 1) s.soleWins += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
      } else {
        s.streak = 0;
      }
      if (r.points === MAX_POINTS) twenties.push({ player: r.player, week_id });
      if (!record || r.points > record.points) record = { player: r.player, points: r.points, week_id };

      if (!teamPoints.has(r.player.id)) teamPoints.set(r.player.id, new Map());
      const tp = teamPoints.get(r.player.id);
      for (const x of r.resolved) {
        if (!x.effective) continue;
        const f = x.effective;
        if (f.home_score > 0) tp.set(f.home, (tp.get(f.home) || 0) + 1);
        if (f.away_score > 0) tp.set(f.away, (tp.get(f.away) || 0) + 1);
      }
    }
  }

  const table = [...byPlayer.values()].map((s) => {
    const tp = teamPoints.get(s.player.id) || new Map();
    let luckyTeam = null;
    for (const [team, pts] of tp) if (!luckyTeam || pts > luckyTeam.points) luckyTeam = { team, points: pts };
    return {
      ...s,
      paid: s.played * ENTRY_FEE,
      profit: Math.round((s.won - s.played * ENTRY_FEE) * 100) / 100,
      average: s.played ? Math.round((s.points / s.played) * 10) / 10 : 0,
      luckyTeam,
    };
  });
  table.sort((a, b) => b.profit - a.profit || b.wins - a.wins || b.points - a.points);
  return { table, twenties, record };
}
