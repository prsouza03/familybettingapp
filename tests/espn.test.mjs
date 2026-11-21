import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreboard, currentSaturday, deadlineFor, fetchSaturday } from '../js/espn.js';

const ev = (id, date, home, away, hs, as, type) => ({
  id, date,
  status: { type, displayClock: "90'+4'" },
  competitions: [{ competitors: [
    { homeAway: 'home', score: hs, team: { displayName: `${home} Town`, shortDisplayName: home } },
    { homeAway: 'away', score: as, team: { displayName: `${away} FC`, shortDisplayName: away } },
  ] }],
});
const FT = { name: 'STATUS_FULL_TIME', state: 'post', completed: true };
const LIVE = { name: 'STATUS_SECOND_HALF', state: 'in', completed: false };
const PP = { name: 'STATUS_POSTPONED', state: 'post', completed: false };
const PRE = { name: 'STATUS_SCHEDULED', state: 'pre', completed: false };

test('keeps only 3pm UK kick-offs and maps statuses', () => {
  const json = { events: [
    ev('1', '2026-11-21T15:00Z', 'Barnet', 'Port Vale', '2', '1', FT),
    ev('2', '2026-11-21T12:30Z', 'Gillingham', 'Crewe', '3', '3', FT), // early kick-off: not in the game
    ev('3', '2026-11-21T15:00Z', 'Cheltenham', 'Bristol Rovers', '0', '0', PP),
    ev('4', '2026-11-21T15:00Z', 'Grimsby', 'Rotherham', '0', '1', LIVE),
    ev('5', '2026-11-21T15:00Z', 'Oldham', 'Exeter', '0', '0', PRE),
  ] };
  const rows = parseScoreboard(json, 'eng.4', '2026-11-21');
  assert.deepEqual(rows.map((r) => [r.home, r.status, r.home_score, r.away_score]), [
    ['Barnet', 'ft', 2, 1],
    ['Cheltenham', 'postponed', 0, 0],
    ['Grimsby', 'live', 0, 1],
    ['Oldham', 'scheduled', null, null],
  ]);
  assert.equal(rows[0].id, 'espn-1');
});

test('summer time: 3pm UK is 14:00 UTC', () => {
  const rows = parseScoreboard({ events: [ev('9', '2026-08-15T14:00Z', 'A', 'B', '1', '1', FT)] }, 'eng.1', '2026-08-15');
  assert.equal(rows.length, 1);
  assert.equal(deadlineFor('2026-08-15'), '2026-08-15T14:00:00Z');
  assert.equal(deadlineFor('2026-11-21'), '2026-11-21T15:00:00Z');
});

test('current Saturday', () => {
  assert.equal(currentSaturday(new Date('2026-11-21T20:00:00Z')), '2026-11-21'); // Saturday night
  assert.equal(currentSaturday(new Date('2026-11-22T10:00:00Z')), '2026-11-28'); // Sunday
  assert.equal(currentSaturday(new Date('2026-11-26T10:00:00Z')), '2026-11-28'); // Thursday
});

test('a failing league is reported, not fatal', async () => {
  const fake = async (url) => (url.includes('eng.1')
    ? { ok: false, status: 500 }
    : { ok: true, json: async () => ({ events: [ev('7', '2026-11-21T15:00Z', 'X', 'Y', '1', '0', FT)] }) });
  const { fixtures, errors } = await fetchSaturday('2026-11-21', fake);
  assert.equal(errors.length, 1);
  assert.equal(fixtures.length, 6); // 7 ESPN leagues, one failed
});
