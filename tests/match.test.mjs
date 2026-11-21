import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScreenshot } from '../js/match.js';

const f = (id, home, away, home_full, away_full) => ({ id, home, away, home_full, away_full });
const fixtures = [
  f('1', 'Barnet', 'Port Vale', 'Barnet', 'Port Vale'),
  f('2', 'Cheltenham', 'Bristol Rovers', 'Cheltenham Town', 'Bristol Rovers'),
  f('3', 'Chesterfield', 'Shrewsbury', 'Chesterfield', 'Shrewsbury Town'),
  f('4', 'Man United', 'Arsenal', 'Manchester United', 'Arsenal'),
  f('5', 'Doncaster', 'Bristol City', 'Doncaster Rovers', 'Bristol City'),
  f('6', 'Queen\'s Park', 'Dunfermline', "Queen's Park", 'Dunfermline Athletic'),
];

test('reads Flashscore-style lines, including scores and red-card badges', () => {
  // Roughly what OCR gives back for a favourites screenshot.
  const lines = ['Football v', 'Barnet 2', 'Port Vale 1 1', 'Cheltenham 1 0', 'Bristol Rovers 3',
    'Man Utd 1', 'Arsenal 1', 'Queens Park 0', 'Dunfermline 2', 'Chesterfeld 4'];
  const got = matchScreenshot(lines, fixtures);
  const ids = got.map((g) => g.fixture.id);
  assert.deepEqual(ids.slice(0, 4).sort(), ['1', '2', '4', '6']);
  assert.ok(got.slice(0, 4).every((g) => g.confidence === 'both'));
  // Chesterfield (misread) found from the home team only; Bristol Rovers must not pull in Bristol City.
  assert.ok(ids.includes('3'));
  assert.ok(!ids.includes('5'));
});
