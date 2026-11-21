const dates = ['2026-10-24', '2026-10-31', '2026-01-10', '2026-01-11', '2026-02-14', '2026-02-07', '2026-03-07', '2026-03-14', '2025-11-29', '2025-12-06', '2026-01-17'];
for (const d of dates) {
  try {
    const t = await (await fetch(`https://www.bbc.co.uk/sport/football/scores-fixtures/${d}`)).text();
    const m = t.match(/window\.__INITIAL_DATA__\s*=\s*("(?:[^"\\]|\\.)*")/);
    const data = JSON.parse(JSON.parse(m[1]));
    const key = Object.keys(data.data).find((k) => k.startsWith('sport-data-scores-fixtures'));
    const evs = data.data[key].data.eventGroups.flatMap((g) => g.secondaryGroups.flatMap((s) => s.events)).filter((e) => /^(FA Cup|Scottish Cup)$/.test(e.tournament?.name));
    const keys = new Set(evs.flatMap((e) => Object.keys(e.home?.runningScores || {})));
    const et = evs.filter((e) => Object.keys(e.home?.runningScores || {}).some((k) => !['halftime', 'fulltime'].includes(k)) || /AET|pen|extra/i.test(JSON.stringify([e.periodLabel, e.statusComment, e.accessibleEventSummary])));
    console.log('D', d, evs.length, [...keys].join('/'), et.slice(0, 2).map((e) => JSON.stringify({ s: e.accessibleEventSummary, ph: e.periodLabel?.value, h: [e.home.score, e.home.runningScores, e.home.penaltyScore], a: [e.away.score, e.away.runningScores], p: e.participants?.map((x) => [x.score, x.fulltimeScore, x.extratimeScore, x.penaltyScore]) })).join(' || '));
  } catch (e) { console.log('D', d, 'ERR', e.message); }
}
