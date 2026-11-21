import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPoints, resolvePicks, weekStandings, seasonStats, sortFixtures } from '../js/rules.js';

let n = 0;
const fx = (league, home, away, hs, as, status = 'ft') => ({
  id: `f${++n}`, league, home, away, home_score: hs, away_score: as, status,
});

// Patrick's League Two example (3pm games, A to Z by home team).
const l2 = [
  fx('eng.4', 'Barnet', 'Port Vale', 2, 1),
  fx('eng.4', 'Accrington', 'Salford', 1, 1),
  fx('eng.4', 'Cheltenham', 'Bristol Rovers', 0, 3),
  fx('eng.4', 'Chesterfield', 'Shrewsbury', 4, 1),
  fx('eng.4', 'Tranmere', 'Walsall', 0, 0),
];
const nl = [fx('eng.5', 'Aldershot', 'Boston', 1, 0), fx('eng.5', 'York', 'Yeovil', 2, 2)];
const all = [...l2, ...nl];
const byHome = (h) => all.find((f) => f.home === h);

test('points: 0, 1 or 2 per match', () => {
  assert.equal(matchPoints(byHome('Barnet')), 2);
  assert.equal(matchPoints(byHome('Cheltenham')), 1);
  assert.equal(matchPoints(byHome('Tranmere')), 0);
  assert.equal(matchPoints({ ...byHome('Barnet'), status: 'scheduled' }), 0);
  assert.equal(matchPoints({ ...byHome('Barnet'), status: 'live' }), 2);
});

test('fixtures sort in Flashscore order', () => {
  assert.deepEqual(sortFixtures(all).map((f) => f.home),
    ['Accrington', 'Barnet', 'Cheltenham', 'Chesterfield', 'Tranmere', 'Aldershot', 'York']);
});

test('postponed pick rolls to the match on the line below', () => {
  const fixtures = all.map((f) => (f.home === 'Barnet' ? { ...f, status: 'postponed' } : f));
  const [r] = resolvePicks([{ fixture_id: byHome('Barnet').id, slot: 1 }], fixtures);
  assert.equal(r.how, 'rolled');
  assert.equal(r.effective.home, 'Cheltenham');
});

test('rolls past matches that are also off or already picked', () => {
  const fixtures = all.map((f) => (['Barnet', 'Chesterfield'].includes(f.home) ? { ...f, status: 'postponed' } : f));
  const picks = [
    { fixture_id: byHome('Barnet').id, slot: 1 },
    { fixture_id: byHome('Cheltenham').id, slot: 2 },
  ];
  const [r] = resolvePicks(picks, fixtures);
  assert.equal(r.effective.home, 'Tranmere');
});

test('last match in a league rolls to the first match of the league below', () => {
  const fixtures = all.map((f) => (f.home === 'Tranmere' ? { ...f, status: 'abandoned' } : f));
  const [r] = resolvePicks([{ fixture_id: byHome('Tranmere').id, slot: 1 }], fixtures);
  assert.equal(r.effective.home, 'Aldershot');
});

test('bottom of the chain needs a manual pick, and a manual pick is used', () => {
  const fixtures = all.map((f) => (f.home === 'York' ? { ...f, status: 'postponed' } : f));
  const [r] = resolvePicks([{ fixture_id: byHome('York').id, slot: 1 }], fixtures);
  assert.equal(r.how, 'needs-pick');
  assert.equal(r.effective, null);
  const [m] = resolvePicks([{ fixture_id: byHome('York').id, slot: 1, replacement_fixture_id: byHome('Barnet').id }], fixtures);
  assert.equal(m.how, 'manual');
  assert.equal(m.effective.home, 'Barnet');
});

function tenGames(points) {
  // Build 10 finished matches that give exactly `points` in total.
  const out = [];
  for (let i = 0; i < 10; i++) {
    const p = Math.max(0, Math.min(2, points - i * 2));
    out.push(fx('eng.1', `H${String(i).padStart(2, '0')}-${n}`, `A${i}`, p >= 1 ? 1 : 0, p >= 2 ? 1 : 0));
  }
  return out;
}

test('weekly winner and a tie splits the pot', () => {
  const a = tenGames(20), b = tenGames(20), c = tenGames(7);
  const fixtures = [...a, ...b, ...c];
  const players = [{ id: 'p1', name: 'Patrick' }, { id: 'p2', name: 'Ana' }, { id: 'p3', name: 'Leo' }, { id: 'p4', name: 'Late' }];
  const picks = new Map([
    ['p1', a.map((f, i) => ({ fixture_id: f.id, slot: i + 1 }))],
    ['p2', b.map((f, i) => ({ fixture_id: f.id, slot: i + 1 }))],
    ['p3', c.map((f, i) => ({ fixture_id: f.id, slot: i + 1 }))],
    ['p4', c.slice(0, 4).map((f, i) => ({ fixture_id: f.id, slot: i + 1 }))], // incomplete: not in the game
  ]);
  const s = weekStandings(players, picks, fixtures);
  assert.equal(s.rows.length, 3);
  assert.equal(s.pot, 30);
  assert.equal(s.finished, true);
  assert.deepEqual(s.winners.map((p) => p.name).sort(), ['Ana', 'Patrick']);
  assert.equal(s.share, 15);
  assert.deepEqual(s.rows.map((r) => r.position), [1, 1, 3]);
  assert.equal(s.rows[2].points, 7);

  const stats = seasonStats([{ week_id: '2026-11-21', standings: s }]);
  assert.equal(stats.twenties.length, 2);
  assert.equal(stats.record.points, 20);
  const leo = stats.table.find((r) => r.player.name === 'Leo');
  assert.equal(leo.profit, -10);
  assert.equal(stats.table[0].profit, 5);
});

test('week is not finished while a match is still live', () => {
  const a = tenGames(10);
  a[0] = { ...a[0], status: 'live' };
  const s = weekStandings([{ id: 'p1', name: 'P' }], new Map([['p1', a.map((f, i) => ({ fixture_id: f.id, slot: i + 1 }))]]), a);
  assert.equal(s.finished, false);
  assert.equal(s.rows[0].winnings, 0);
});

test('a postponed cup tie rolls to the next tie in the same cup, never into a league', () => {
  const cup = [fx('eng.facup', 'Barnet', 'Wrexham', 0, 0, 'postponed'), fx('eng.facup', 'York', 'Bolton', 1, 1)];
  const fixtures = [...cup, fx('eng.5', 'Aldershot', 'Boston', 1, 1)];
  assert.equal(resolvePicks([{ fixture_id: cup[0].id, slot: 1 }], fixtures)[0].effective.home, 'York');
  const last = [fx('eng.facup', 'York', 'Bolton', 0, 0, 'postponed'), fx('eng.1', 'Arsenal', 'Spurs', 1, 1)];
  assert.equal(resolvePicks([{ fixture_id: last[0].id, slot: 1 }], last)[0].how, 'needs-pick');
});

test('cups sit after their country\'s leagues in the list', () => {
  const list = [fx('sco.cup', 'A', 'B', 0, 0), fx('eng.facup', 'C', 'D', 0, 0), fx('sco.4', 'E', 'F', 0, 0), fx('eng.5', 'G', 'H', 0, 0), fx('nir.1', 'I', 'J', 0, 0)];
  assert.deepEqual(sortFixtures(list).map((f) => f.league), ['eng.5', 'eng.facup', 'sco.4', 'sco.cup', 'nir.1']);
});
