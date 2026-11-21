for (const d of ['2026-10-31', '2026-11-01', '2026-11-28', '2026-11-29', '2026-10-24', '2026-12-05']) {
  try {
    const t = await (await fetch(`https://www.bbc.co.uk/sport/football/scores-fixtures/${d}`)).text();
    const m = t.match(/window\.__INITIAL_DATA__\s*=\s*("(?:[^"\\]|\\.)*")/);
    const data = JSON.parse(JSON.parse(m[1]));
    const key = Object.keys(data.data).find((k) => k.startsWith('sport-data-scores-fixtures'));
    const groups = data.data[key].data.eventGroups;
    const cup = groups.flatMap((g) => g.secondaryGroups.flatMap((s) => s.events)).filter((e) => /Cup/.test(e.tournament?.name || ''));
    const names = {};
    for (const e of cup) { const k = `${e.tournament.name}@${e.time?.displayTimeUK}`; names[k] = (names[k] || 0) + 1; }
    console.log('BBC', d, JSON.stringify(names), cup.slice(0, 1).map((e) => `${e.home.fullName} v ${e.away.fullName} ${e.status} ${e.home.score}-${e.away.score}`).join());
  } catch (e) { console.log('BBC', d, 'ERR', e.message); }
}
for (const c of ['eng.fa', 'sco.tennents']) for (const d of ['20261031', '20261101', '20261128', '20261129']) {
  try { const j = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${c}/scoreboard?dates=${d}`)).json();
    console.log('ESPN', c, d, (j.events || []).length, (j.events || []).slice(0, 1).map((e) => e.date + ' ' + e.name + ' ' + e.status?.type?.name).join()); } catch (e) { console.log('ESPN', c, d, 'ERR', e.message); }
}
