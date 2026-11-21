// Turns the text read from a Flashscore screenshot into matches from this week's list.

const SWAPS = [
  [/\butd\b/g, 'united'],
  [/\bmanchester\b/g, 'man'],
  [/\b(afc|fc|cf|sc)\b/g, ''],
  [/&/g, 'and'],
  [/\bst\.?\b/g, 'st'],
];

export function normalise(s) {
  let t = (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/['’.]/g, '').replace(/[^a-z& ]+/g, ' ');
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function bigrams(s) {
  const t = s.replace(/ /g, '');
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let both = 0, total = 0;
  for (const [g, n] of A) { both += Math.min(n, B.get(g) || 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * both) / total : 0;
}

function aliases(short, full) {
  return [...new Set([short, full].filter(Boolean).map(normalise).filter((x) => x.length >= 3))];
}

const THRESHOLD = 0.8;

// lines: OCR text lines. fixtures: this week's 3pm fixtures.
// Returns [{ fixture, confidence: 'both' | 'one', score }], best first, at most `limit`.
export function matchScreenshot(lines, fixtures, limit = 10) {
  const clean = lines.map(normalise).filter((l) => l.length >= 3);
  const teamScore = (names) => {
    let best = 0;
    for (const line of clean) for (const n of names) {
      // A line can hold extra words (red-card badges, scores): also try the line's first words.
      const words = line.split(' ');
      const cut = words.slice(0, n.split(' ').length).join(' ');
      best = Math.max(best, similarity(line, n), similarity(cut, n));
    }
    return best;
  };
  const found = [];
  for (const f of fixtures) {
    const h = teamScore(aliases(f.home, f.home_full));
    const a = teamScore(aliases(f.away, f.away_full));
    const hit = (h >= THRESHOLD ? 1 : 0) + (a >= THRESHOLD ? 1 : 0);
    if (!hit) continue;
    found.push({ fixture: f, confidence: hit === 2 ? 'both' : 'one', score: h + a });
  }
  found.sort((x, y) => (y.confidence === 'both') - (x.confidence === 'both') || y.score - x.score);
  return found.slice(0, limit);
}
