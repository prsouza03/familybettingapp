const B = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
for (const c of ['sco.3', 'sco.4', 'nir.1', 'sco.2']) {
  for (const q of ['?dates=20261121', '']) {
    try {
      const r = await fetch(`${B}/${c}/scoreboard${q}`); const j = await r.json();
      console.log(c, q, r.status, j.leagues?.[0]?.name, (j.events || []).length, (j.events || []).slice(0, 2).map((e) => e.date + ' ' + e.name).join(' | '));
    } catch (e) { console.log(c, q, 'ERR', e.message); }
  }
}
try {
  const r = await fetch('https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=1000'); const j = await r.json();
  const refs = (j.items || []).map((i) => i.$ref.match(/leagues\/([^?]+)/)?.[1]).filter(Boolean);
  console.log('LEAGUES', refs.filter((s) => /^(sco|nir|eng)/.test(s)).join(','));
} catch (e) { console.log('leagues ERR', e.message); }
try {
  const r = await fetch('https://www.bbc.co.uk/sport/football/scores-fixtures/2026-11-21', { headers: { 'user-agent': 'Mozilla/5.0' } });
  const t = await r.text();
  console.log('BBC', r.status, t.length, ['Irish Premiership', 'Scottish League Two', 'Scottish League One', 'Linfield', 'Stranraer', 'Elgin'].map((k) => k + ':' + t.includes(k)).join(' '));
} catch (e) { console.log('BBC ERR', e.message); }
