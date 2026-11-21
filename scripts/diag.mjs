const r = await fetch('https://www.bbc.co.uk/sport/football/scores-fixtures/2026-11-21', { headers: { 'user-agent': 'Mozilla/5.0' } });
const t = await r.text();
const show = (k, n = 2, w = 700) => { let i = -1; for (let c = 0; c < n; c++) { i = t.indexOf(k, i + 1); if (i < 0) break; console.log('CTX', k, '>>', t.slice(Math.max(0, i - 300), i + w).replace(/\s+/g, ' ')); } };
show('Stranraer', 2, 900);
show('Linfield', 1, 600);
const apis = [...new Set(t.match(/https?:\/\/[a-z0-9.-]*api\.bbc[a-z.]*\/[^"'\s\\]{0,200}/g) || [])].slice(0, 15);
console.log('APIS', apis.join('\nAPIS '));
const m = t.match(/window\.__INITIAL_DATA__\s*=\s*/); console.log('INITIAL_DATA', !!m);
const idx = t.indexOf('tournament-collection'); console.log('TC', idx, t.slice(idx - 200, idx + 300).replace(/\s+/g, ' '));
