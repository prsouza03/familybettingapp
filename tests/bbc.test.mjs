import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEventGroups, parseBbc } from '../js/bbc.js';

const ev = (id, tournament, home, away, hs, as, status, time = '15:00', isoDate = '2026-11-21') => ({
  id, status, startDateTime: `${isoDate}T${time}:00Z`, date: { isoDate }, time: { displayTimeUK: time },
  periodLabel: { value: status === 'PostEvent' ? 'FT' : "65'" }, tournament: { name: tournament },
  home: { shortName: home, fullName: `${home} Athletic`, score: hs }, away: { shortName: away, fullName: `${away} FC`, score: as },
});
const groups = [
  { displayLabel: 'Scottish League Two', secondaryGroups: [{ events: [
    ev('a', 'Scottish League Two', 'Annan', 'Forfar', '1', '1', 'PostEvent'),
    ev('b', 'Scottish League Two', 'Stranraer', 'Elgin', '3', '0', 'MidEvent'),
    ev('c', 'Scottish League Two', 'Clyde', 'Spartans', '', '', 'Postponed'),
    ev('d', 'Scottish League Two', 'Early', 'Kick', '1', '0', 'PostEvent', '12:30'),
  ] }] },
  { displayLabel: 'Irish Premiership', secondaryGroups: [{ events: [ev('e', 'Irish Premiership', 'Linfield', 'Larne', '5', '0', 'PostEvent')] }] },
  { displayLabel: 'Premier League', secondaryGroups: [{ events: [ev('f', 'Premier League', 'Arsenal', 'Chelsea', '1', '0', 'PostEvent')] }] },
];

test('reads the page data and keeps only 3pm games in the BBC-covered leagues', () => {
  const html = `<script>window.__INITIAL_DATA__=${JSON.stringify(JSON.stringify({ data: { 'sport-data-scores-fixtures?x=1': { data: { eventGroups: groups } } } }))};</script>`;
  const rows = parseBbc(extractEventGroups(html), '2026-11-21');
  assert.deepEqual(rows.map((r) => [r.id, r.league, r.home, r.status, r.home_score, r.away_score]), [
    ['bbc-a', 'sco.4', 'Annan', 'ft', 1, 1],
    ['bbc-b', 'sco.4', 'Stranraer', 'live', 3, 0],
    ['bbc-c', 'sco.4', 'Clyde', 'postponed', null, null],
    ['bbc-e', 'nir.1', 'Linfield', 'ft', 5, 0],
  ]);
});

test('a changed page layout is reported clearly', () => {
  assert.throws(() => extractEventGroups('<html></html>'), /layout changed/);
});

test('FA Cup and Scottish Cup 3pm ties are included; the Women\'s FA Cup is not', () => {
  const g = [{ displayLabel: 'Cups', secondaryGroups: [{ events: [
    ev('x1', 'FA Cup', 'Chesterfield', 'Cheltenham', '', '', 'PreEvent'),
    ev('x2', 'Scottish Cup', 'Annan', 'Morton', '2', '2', 'PostEvent'),
    ev('x3', "Women's FA Cup", 'Lewes', 'Rugby', '1', '0', 'PostEvent'),
    ev('x4', 'FA Cup', 'Late', 'Kick', '', '', 'PreEvent', '17:15'),
  ] }] }];
  assert.deepEqual(parseBbc(g, '2026-11-21').map((r) => [r.league, r.home]), [['eng.facup', 'Chesterfield'], ['sco.cup', 'Annan']]);
});

test('extra-time goals do not count: the 90-minute score is used', () => {
  // Real example: Brora Rangers 3-1 Cowdenbeath after extra time, 1-1 after 90 minutes.
  const e = ev('y1', 'Scottish Cup', 'Brora', 'Cowdenbeath', '3', '1', 'PostEvent');
  e.home.runningScores = { halftime: '0', fulltime: '1', extratime: '3' };
  e.away.runningScores = { halftime: '0', fulltime: '1', extratime: '1' };
  const [r] = parseBbc([{ secondaryGroups: [{ events: [e] }] }], '2026-11-21');
  assert.deepEqual([r.home_score, r.away_score], [1, 1]);
});
