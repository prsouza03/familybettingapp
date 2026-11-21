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
