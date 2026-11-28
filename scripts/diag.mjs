const t = await (await fetch('https://www.bbc.co.uk/sport/football/scores-fixtures/2026-11-28')).text();
const m = t.match(/window\.__INITIAL_DATA__\s*=\s*("(?:[^"\\]|\\.)*")/);
const data = JSON.parse(JSON.parse(m[1]));
const key = Object.keys(data.data).find((k) => k.startsWith('sport-data-scores-fixtures'));
const evs = data.data[key].data.eventGroups.flatMap((g) => g.secondaryGroups.flatMap((s) => s.events)).filter((e) => /Irish Premiership|Scottish Cup/.test(e.tournament?.name));
for (const e of evs) console.log('EV', e.tournament.name, '|', e.home.fullName, e.home.score, '-', e.away.score, e.away.fullName, '|', e.status, e.periodLabel?.value, e.statusComment?.value);
console.log('NOW', new Date().toISOString(), 'cache-control/age:', JSON.stringify(Object.keys(data.data).filter((k) => k.startsWith('sport-data')).length));
