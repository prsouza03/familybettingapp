import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from './config.js';
import { LEAGUES, LEAGUE_BY_CODE, espnLeagues } from './leagues.js';
import { fetchSaturday, currentSaturday, deadlineFor, londonDateTime } from './espn.js';
import {
  PICKS_PER_WEEK, MAX_POINTS, ENTRY_FEE, isOff, matchPoints, sortFixtures, resolvePicks, weekStandings, seasonStats,
} from './rules.js';
import { matchScreenshot } from './match.js';
import { readScreenshot } from './ocr.js';

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
const $who = document.getElementById('who');

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`;
const dayLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const leagueShort = (code) => { const l = LEAGUE_BY_CODE[code]; return l ? `${{ England: 'ENG', Scotland: 'SCO', 'Northern Ireland': 'NIR' }[l.country]} ${l.name}` : code; };
const names = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
const plural = (n, w, suffix = 's') => `${n} ${w}${n === 1 ? '' : suffix}`;

function toast(msg, ms = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function scoreText(f) {
  if (!f) return '';
  if (isOff(f)) return f.status === 'abandoned' ? 'ABD' : 'P-P';
  if (f.status === 'scheduled') return timeLabel(f.kickoff);
  return `${f.home_score ?? 0} - ${f.away_score ?? 0}`;
}
function statusChip(f) {
  if (!f) return '';
  if (f.status === 'live') return `<span class="chip live">${esc(f.clock || 'LIVE')}</span>`;
  if (f.status === 'ft') return '<span class="chip">FT</span>';
  if (isOff(f)) return `<span class="chip off">${esc(f.status)}</span>`;
  return '';
}
const pointsChip = (f) => { const p = matchPoints(f); return `<span class="pts p${p}">${p}</span>`; };

// ---------- setup ----------
if (SUPABASE_URL.includes('YOUR-PROJECT')) {
  $app.innerHTML = `<section class="card"><h2>Almost there</h2>
    <p>This app isn't connected to its database yet. Put the Supabase project URL and anon key in <code>js/config.js</code>.
    The steps are in the README.</p></section>`;
  throw new Error('Not configured');
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const state = {
  session: null,
  me: null,
  players: [],
  week: currentSaturday(),
  draft: null, // { playerId, ids: [] , found: Map(id -> 'both'|'one') }
  liveTimer: null,
};

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function loadPlayers() {
  const { data, error } = await sb.from('players').select('*').order('name');
  if (error) throw error;
  state.players = data;
  state.me = data.find((p) => p.user_id === state.session.user.id) || null;
}

async function loadWeek(day) {
  const [fx, pk, en] = await Promise.all([
    sb.from('fixtures').select('*').eq('week_id', day),
    sb.from('picks').select('*').eq('week_id', day),
    sb.rpc('week_entries', { week: day }),
  ]);
  for (const r of [fx, pk, en]) if (r.error) throw r.error;
  const off = await sb.from('weeks_off').select('*').eq('week_id', day);
  return { fixtures: sortFixtures(fx.data), picks: pk.data, entries: en.data || [], off: off.data?.[0] || null };
}

const picksByPlayer = (picks) => {
  const m = new Map();
  for (const p of picks) { if (!m.has(p.player_id)) m.set(p.player_id, []); m.get(p.player_id).push(p); }
  return m;
};

// ---------- live scores (straight from the feed, every 2 minutes on Saturday afternoon) ----------
const liveOverlay = new Map();
function withLive(fixtures) {
  return fixtures.map((f) => {
    const l = liveOverlay.get(f.id);
    if (!l) return f;
    return { ...f, home_score: l.home_score, away_score: l.away_score, clock: l.clock, status: f.manual_status ? f.status : l.status };
  });
}
async function pullLive(day, save = false) {
  const { fixtures, errors } = await fetchSaturday(day);
  if (!fixtures.length && errors.length) throw new Error('Could not reach the results feed from this device.');
  for (const f of fixtures) liveOverlay.set(f.id, f);
  if (save) {
    const failed = new Set(errors.map((e) => e.split(':')[0]));
    const leagues = espnLeagues().map((l) => l.code).filter((c) => !failed.has(c));
    const { error } = await sb.rpc('sync_fixtures', { week: day, rows: fixtures, leagues, source: 'admin' });
    if (error) throw error;
  }
  return fixtures.length;
}
function isMatchWindow(day) {
  const now = londonDateTime(new Date().toISOString());
  return now.date === day && now.time >= '14:55' && now.time <= '18:30';
}

// ---------- views ----------
async function viewWeek(day, { current }) {
  clearInterval(state.liveTimer);
  const data = await loadWeek(day);
  const fixtures = withLive(data.fixtures);
  const deadline = deadlineFor(day);
  const locked = Date.now() >= Date.parse(deadline);
  let html = `<section class="hero"><div class="muted">${current ? 'This Saturday' : 'Saturday'}</div><h1>${dayLabel(day)}</h1>`;
  if (data.off) {
    $app.innerHTML = html + `</section><section class="card center"><h3>🌍 No game this Saturday</h3><p>${esc(data.off.reason || 'International break')}. See you next week!</p></section>`;
    return;
  }

  if (!fixtures.length) {
    html += `</section><section class="card"><p>The 3pm fixtures aren't loaded yet. They load automatically on Sunday morning and again on Friday evening.</p>
      ${state.me?.is_admin ? '<button class="btn" data-act="sync">Load fixtures now</button>' : ''}</section>`;
    $app.innerHTML = html;
    return;
  }

  if (!locked) {
    const complete = data.entries.filter((e) => e.picks >= PICKS_PER_WEEK);
    html += `<div class="pot">Pot so far ${money(complete.length * ENTRY_FEE)}</div>
      <div class="muted">Picks close at 3pm</div></section>
      <section class="card"><h3>Who's in</h3><ul class="plain">`;
    for (const p of state.players) {
      const e = data.entries.find((x) => x.player_id === p.id);
      const n = e?.picks || 0;
      html += `<li class="row"><span>${esc(p.name)}</span><span class="${n >= PICKS_PER_WEEK ? 'ok' : 'muted'}">${n >= PICKS_PER_WEEK ? '✓ in' : n ? `${n}/10 picked` : 'not yet'}</span></li>`;
    }
    html += `</ul><a class="btn" href="#/picks">${data.picks.some((p) => p.player_id === state.me?.id) ? 'Change my picks' : 'Make my picks'}</a></section>`;
    $app.innerHTML = html;
    return;
  }

  const st = weekStandings(state.players, picksByPlayer(data.picks), fixtures);
  const live = fixtures.some((f) => f.status === 'live');
  html += `<div class="pot">Pot ${money(st.pot)} · ${plural(st.rows.length, 'player')}</div>`;
  if (st.finished && st.winners.length) {
    const w = st.winners.map((p) => p.name);
    html += `<div class="winner">🏆 ${esc(names(w))} ${w.length === 1 ? `wins ${money(st.pot)}` : `share the pot, ${money(st.share)} each`}</div>`;
  } else {
    html += `<div class="muted">${live ? '<span class="chip live">LIVE</span> ' : ''}${st.finished ? '' : 'Results so far'}</div>`;
  }
  html += `</section>`;
  if (current) {
    html += `<div class="center"><button class="btn small ghost" data-act="${state.me?.is_admin ? 'sync' : 'live'}">↻ Refresh scores</button>
      <div class="muted tiny" id="updated"></div></div>`;
  }
  html += '<section class="board">';
  for (const r of st.rows) {
    const needs = r.resolved.some((x) => x.how === 'needs-pick');
    html += `<details class="card entry ${r.isWinner && st.finished ? 'win' : ''}">
      <summary><span class="pos">${r.position}</span><span class="name">${esc(r.player.name)}${needs ? ' <span class="chip off">needs a swap</span>' : ''}</span>
      <span class="score">${r.points}<small>/${MAX_POINTS}</small></span>${st.finished && r.winnings ? `<span class="won">${money(r.winnings)}</span>` : ''}</summary>
      <ul class="matches">${r.resolved.map((x) => matchLine(x)).join('')}</ul></details>`;
  }
  html += '</section>';
  $app.innerHTML = html;
  showUpdated(fixtures);

  if (current && isMatchWindow(day)) {
    state.liveTimer = setInterval(async () => {
      try { await pullLive(day); if (location.hash === '' || location.hash === '#/') route(); } catch { /* keep stored scores */ }
    }, 120000);
  }
}

function showUpdated(fixtures) {
  const el = document.getElementById('updated');
  if (!el) return;
  const last = fixtures.map((f) => f.updated_at).filter(Boolean).sort().at(-1);
  el.textContent = liveOverlay.size ? `Live scores at ${timeLabel(new Date().toISOString())}` : last ? `Updated ${timeLabel(last)}` : '';
}

function matchLine(x) {
  const f = x.effective;
  let note = '';
  if (x.how === 'rolled') note = `<div class="note">${esc(x.original.home)} v ${esc(x.original.away)} ${esc(x.original.status)}: moved to the next match down</div>`;
  if (x.how === 'manual') note = `<div class="note">${esc(x.original?.home)} v ${esc(x.original?.away)} ${esc(x.original?.status || '')}: replacement chosen</div>`;
  if (x.how === 'needs-pick') {
    return `<li class="m off"><div class="teams"><span class="tag">${esc(leagueShort(x.original.league))}</span>${esc(x.original.home)} v ${esc(x.original.away)}</div>
      <div class="note">${esc(x.original.status)}, and there's no match below it. Choose a replacement on My picks.</div></li>`;
  }
  return `<li class="m"><div class="teams"><span class="tag">${esc(leagueShort(f.league))}</span>
    <span class="${f.home_score > 0 ? 'scored' : ''}">${esc(f.home)}</span> <b>${scoreText(f)}</b> <span class="${f.away_score > 0 ? 'scored' : ''}">${esc(f.away)}</span> ${statusChip(f)}</div>
    ${pointsChip(f)}${note}</li>`;
}

// ---------- picks ----------
async function viewPicks() {
  clearInterval(state.liveTimer);
  const day = state.week;
  const data = await loadWeek(day);
  const fixtures = withLive(data.fixtures);
  const admin = !!state.me?.is_admin;
  const targetId = state.draft?.playerId || state.me?.id;
  const target = state.players.find((p) => p.id === targetId);
  const locked = Date.now() >= Date.parse(deadlineFor(day));
  const mine = data.picks.filter((p) => p.player_id === targetId);

  let html = `<section class="hero"><div class="muted">Picks for</div><h1>${dayLabel(day)}</h1>
    <div class="muted">${locked ? 'Picks are closed' : `Close at 3pm · pick ${PICKS_PER_WEEK} matches`}</div></section>`;
  if (admin) {
    html += `<section class="card"><label>Entering picks for <select id="who-for">${state.players.map((p) => `<option value="${p.id}" ${p.id === targetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      ${locked ? '<p class="muted tiny">Picks are closed, but as admin you can still change them.</p>' : ''}</section>`;
  }
  if (data.off && !admin) {
    $app.innerHTML = html + `<section class="card"><p>No game this Saturday (${esc(data.off.reason || 'international break')}).</p></section>`;
    return;
  }
  if (!fixtures.length) {
    $app.innerHTML = html + '<section class="card"><p>The 3pm fixtures load by Sunday morning (and are refreshed on Friday evening). Check back then.</p></section>';
    return;
  }

  // After 3pm: show the picks and let the player choose replacements for matches that are off.
  if (locked && mine.length) {
    const resolved = resolvePicks(mine, fixtures);
    const used = new Set([...mine.map((p) => p.fixture_id), ...mine.map((p) => p.replacement_fixture_id).filter(Boolean)]);
    html += '<section class="card"><ul class="matches">';
    for (const x of resolved) {
      html += x.how === 'needs-pick' || x.effective ? matchLine(x) : '';
      if (isOff(x.original)) {
        const opts = fixtures.filter((f) => !isOff(f) && (!used.has(f.id) || f.id === x.pick.replacement_fixture_id));
        html += `<li class="replace"><label>Replacement for ${esc(x.original.home)} v ${esc(x.original.away)}
          <select data-replace="${x.pick.id}"><option value="">${x.how === 'needs-pick' ? 'Choose a match…' : 'Automatic: next match down'}</option>
          ${opts.map((f) => `<option value="${esc(f.id)}" ${f.id === x.pick.replacement_fixture_id ? 'selected' : ''}>${esc(leagueShort(f.league))}: ${esc(f.home)} v ${esc(f.away)}</option>`).join('')}
          </select></label></li>`;
      }
    }
    html += '</ul></section>';
    if (!admin) { $app.innerHTML = html; return; }
  } else if (locked && !admin) {
    $app.innerHTML = html + '<section class="card"><p>You didn\'t enter picks this week.</p></section>';
    return;
  }

  if (!state.draft || state.draft.playerId !== targetId || state.draft.day !== day) {
    state.draft = { playerId: targetId, day, ids: [...mine].sort((a, b) => a.slot - b.slot).map((p) => p.fixture_id), found: new Map() };
  }
  const chosen = new Set(state.draft.ids);
  html += `<section class="card"><h3>Read my Flashscore screenshot</h3>
    <p class="muted tiny">Take a screenshot of your Favourites in Flashscore, then choose it here. The app picks out the matches. Check them below before saving.</p>
    <label class="btn ghost file">📷 Choose screenshot<input type="file" accept="image/*" id="shot" hidden></label>
    <div id="ocr-status" class="muted tiny"></div></section>`;

  for (const l of LEAGUES) {
    const list = fixtures.filter((f) => f.league === l.code);
    if (!list.length) continue;
    html += `<section class="card league"><h4>${esc(l.country)}: ${esc(l.name)}</h4><ul class="pick-list">`;
    for (const f of list) {
      const on = chosen.has(f.id);
      const how = state.draft.found.get(f.id);
      html += `<li><button class="pick ${on ? 'on' : ''} ${isOff(f) ? 'off' : ''}" data-fx="${esc(f.id)}" ${isOff(f) ? 'disabled' : ''}>
        <span class="tick">${on ? '✓' : ''}</span><span class="teams">${esc(f.home)} v ${esc(f.away)}</span>
        ${how === 'one' ? '<span class="chip">check</span>' : ''}${isOff(f) ? `<span class="chip off">${esc(f.status)}</span>` : ''}</button></li>`;
    }
    html += '</ul></section>';
  }
  html += `<div class="savebar"><span><b id="count">${chosen.size}</b>/${PICKS_PER_WEEK} picked${target && target.id !== state.me?.id ? ` for ${esc(target.name)}` : ''}</span>
    <button class="btn" data-act="save-picks">Save picks</button></div>`;
  $app.innerHTML = html;
}

async function savePicks() {
  const { playerId, day, ids } = state.draft;
  if (ids.length > PICKS_PER_WEEK) return toast(`Pick ${PICKS_PER_WEEK} matches, not ${ids.length}.`);
  if (ids.length < PICKS_PER_WEEK && !confirmPartial(ids.length)) return;
  const del = await sb.from('picks').delete().eq('week_id', day).eq('player_id', playerId);
  if (del.error) return toast(del.error.message);
  if (ids.length) {
    const rows = ids.map((fixture_id, i) => ({ week_id: day, player_id: playerId, fixture_id, slot: i + 1 }));
    const ins = await sb.from('picks').insert(rows);
    if (ins.error) return toast(`Not saved: ${ins.error.message}`);
  }
  toast(ids.length === PICKS_PER_WEEK ? 'Saved. You\'re in! ✅' : `Saved ${ids.length} so far. You need ${PICKS_PER_WEEK} to be in.`);
  state.draft = null;
  route();
}
function confirmPartial(n) {
  const btn = document.querySelector('[data-act="save-picks"]');
  if (btn.dataset.sure) return true;
  btn.dataset.sure = '1';
  btn.textContent = `Save only ${n}?`;
  toast(`You've picked ${n}. You need ${PICKS_PER_WEEK} to be in. Tap again to save anyway.`);
  return false;
}

// ---------- history ----------
const seasonOf = (day) => { const [y, m] = day.split('-').map(Number); return m >= 7 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`; };

async function viewHistory(season) {
  clearInterval(state.liveTimer);
  const [fixtures, picks, offRes] = await Promise.all([
    fetchAll(() => sb.from('fixtures').select('*').order('id')),
    fetchAll(() => sb.from('picks').select('*').order('id')),
    sb.from('weeks_off').select('week_id'),
  ]);
  const offDays = new Set((offRes.data || []).map((o) => o.week_id));
  const days = [...new Set(picks.map((p) => p.week_id))].filter((d) => !offDays.has(d)).sort();
  const weeks = days.map((d) => ({
    week_id: d,
    standings: weekStandings(state.players, picksByPlayer(picks.filter((p) => p.week_id === d)), fixtures.filter((f) => f.week_id === d)),
  })).filter((w) => w.standings.finished);
  const seasons = [...new Set(weeks.map((w) => seasonOf(w.week_id)))].reverse();
  const chosen = season ?? seasons[0] ?? 'all';
  const inSeason = weeks.filter((w) => chosen === 'all' || seasonOf(w.week_id) === chosen);
  const s = seasonStats(inSeason);

  let html = `<section class="hero"><h1>History</h1>
    <select id="season"><option value="all" ${chosen === 'all' ? 'selected' : ''}>All time</option>
    ${seasons.map((x) => `<option ${x === chosen ? 'selected' : ''}>${x}</option>`).join('')}</select></section>`;
  if (!inSeason.length) {
    html += '<section class="card"><p>No finished Saturdays yet. The table fills up after the first week.</p></section>';
  } else {
    html += `<section class="card"><h3>Money table</h3><div class="scroll"><table><thead><tr>
      <th>Player</th><th>Wks</th><th>Wins</th><th>Won</th><th>Profit</th><th>Avg</th><th>Best</th><th>20s</th></tr></thead><tbody>
      ${s.table.map((r) => `<tr><td>${esc(r.player.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${money(r.won)}</td>
        <td class="${r.profit >= 0 ? 'ok' : 'bad'}">${r.profit < 0 ? '-' : ''}${money(Math.abs(r.profit))}</td><td>${r.average}</td><td>${r.best}</td><td>${r.twenties}</td></tr>`).join('')}
      </tbody></table></div></section>`;

    const top = (key, fn = (r) => r[key]) => [...s.table].sort((a, b) => fn(b) - fn(a))[0];
    const most = (label, r, value, n = 1) => (r && n > 0 ? `<li class="row"><span>${label}</span><span><b>${esc(r.player.name)}</b> ${value}</span></li>` : '');
    const rich = top('won'), both = top('bothScored'), blanks = top('blanks'), streak = top('bestStreak'), avg = top('average'), sole = top('soleWins');
    html += `<section class="card"><h3>Hall of fame</h3><ul class="plain">
      ${s.record ? most('🔝 Highest score', s.record, `${s.record.points} on ${dayLabel(s.record.week_id)}`) : ''}
      ${most('💰 Biggest winner', rich, money(rich.won), rich.won)}
      ${most('🔥 Longest winning run', streak, plural(streak.bestStreak, 'week'), streak.bestStreak)}
      ${most('🎯 Best average', avg, `${avg.average} a week`)}
      ${most('👑 Most outright wins', sole, plural(sole.soleWins, 'win'), sole.soleWins)}
      ${most('⚽⚽ Most "both teams scored"', both, plural(both.bothScored, 'match', 'es'), both.bothScored)}
      ${most('🥶 Most 0-0 picks', blanks, plural(blanks.blanks, 'blank'), blanks.blanks)}
      </ul></section>`;

    html += `<section class="card"><h3>⭐ 20-point club</h3>${s.twenties.length
      ? `<ul class="plain">${s.twenties.map((t) => `<li class="row"><span>${esc(t.player.name)}</span><a href="#/week/${t.week_id}">${dayLabel(t.week_id)}</a></li>`).join('')}</ul>`
      : '<p class="muted">Nobody yet. It needs both teams to score in all 10 matches.</p>'}</section>`;

    html += `<section class="card"><h3>🍀 Lucky teams</h3><ul class="plain">${s.table.filter((r) => r.luckyTeam).map((r) =>
      `<li class="row"><span>${esc(r.player.name)}</span><span>${esc(r.luckyTeam.team)} · ${plural(r.luckyTeam.points, 'point')}</span></li>`).join('')}</ul></section>`;

    html += `<section class="card"><h3>Past Saturdays</h3><ul class="plain">${[...inSeason].reverse().map((w) =>
      `<li><a class="row" href="#/week/${w.week_id}"><span>${dayLabel(w.week_id)}</span>
      <span>${esc(names(w.standings.winners.map((p) => p.name)))} · ${w.standings.rows[0]?.points ?? 0} pts · ${money(w.standings.pot)}</span></a></li>`).join('')}</ul></section>`;
  }

  html += `<section class="card"><h3>Your account</h3>
    <label>Your name <input id="my-name" value="${esc(state.me?.name || '')}" maxlength="30"></label>
    <label>New password <input id="my-pass" type="password" minlength="6" autocomplete="new-password" placeholder="Leave empty to keep it"></label>
    <p class="muted tiny">You sign in with the name you signed up with. Changing your name here changes how it shows in the app, not your sign-in name.</p>
    <div class="btns"><button class="btn small" data-act="rename">Save</button><button class="btn small ghost" data-act="signout">Sign out</button></div></section>`;
  $app.innerHTML = html;
}

// ---------- admin ----------
async function viewAdmin() {
  clearInterval(state.liveTimer);
  if (!state.me?.is_admin) { location.hash = '#/'; return; }
  const day = state.week;
  const [{ fixtures }, log, offRes] = await Promise.all([loadWeek(day), sb.from('sync_log').select('*').order('ran_at', { ascending: false }).limit(6),
    sb.from('weeks_off').select('*').gte('week_id', new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).order('week_id')]);
  const offs = offRes.data || [];
  const thisOff = offs.find((o) => o.week_id === day);
  let html = `<section class="hero"><h1>Admin</h1><div class="muted">${dayLabel(day)}</div></section>
    <section class="card"><h3>🌍 International break</h3>
      <p class="tiny">${thisOff ? `<b>No game on ${dayLabel(day)}.</b>` : `The game is on for ${dayLabel(day)}.`}</p>
      <button class="btn small ${thisOff ? '' : 'ghost'}" data-act="${thisOff ? 'week-on' : 'week-off'}" data-day="${day}">${thisOff ? 'Turn the game back on' : 'No game this Saturday'}</button>
      ${offs.filter((o) => o.week_id !== day).length ? `<p class="muted tiny">Also off: ${offs.filter((o) => o.week_id !== day).map((o) => `${dayLabel(o.week_id)} <a href="#" data-act="week-on" data-day="${o.week_id}">undo</a>`).join(' · ')}</p>` : ''}
      <p class="muted tiny">To mark a later Saturday, choose its date under "A different Saturday" below.</p>
    </section>
    <section class="card"><h3>Results</h3>
      <p class="muted tiny">Results update by themselves on Saturday at about 3:50pm and 5pm, plus 4:30pm and 5:30pm. Fixtures load on Sunday morning and are refreshed on Wednesday, Friday evening and Saturday morning. The button below updates every league except Scottish League One/Two and the NIFL, which only the scheduled update can read (from BBC Sport).</p>
      <button class="btn" data-act="sync">↻ Update fixtures and scores now</button>
      <h4 style="margin-top:16px">A different Saturday</h4>
      <p class="muted tiny">Pick a date to load its matches and results early (for example next week), re-check a past week, or mark it as an international break.</p>
      <input type="date" id="other-day">
      <div class="btns"><button class="btn small ghost" data-act="sync-other">Load its matches</button><button class="btn small ghost" data-act="week-off-other">No game that Saturday</button></div>
      <ul class="plain tiny">${(log.data || []).map((l) => `<li class="row"><span>${new Date(l.ran_at).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span><span>${esc(l.source)} · ${l.fixtures} matches${l.errors ? ` · ${esc(l.errors)}` : ''}</span></li>`).join('')}</ul>
    </section>
    <section class="card"><h3>Players</h3><ul class="plain">
      ${state.players.map((p) => `<li class="row"><input data-rename="${p.id}" value="${esc(p.name)}" maxlength="30"><span class="muted tiny">${p.user_id ? (p.is_admin ? 'admin' : `<button class="btn small ghost" data-reset="${p.id}">Reset password</button>`) : 'no account'}</span></li>`).join('')}
    </ul>
    <p class="muted tiny">Add someone who doesn't use the app (for example, picks on paper). Then enter their picks on My picks.</p>
    <div class="btns"><input id="new-player" placeholder="Name" maxlength="30"><button class="btn small" data-act="add-player">Add player</button></div></section>
    <section class="card"><h3>Scores and postponements</h3>
      <p class="muted tiny">Fix a score or set a match as postponed if the feed is slow. "Auto" goes back to the feed for the status.</p><ul class="plain">`;
  for (const f of fixtures) {
    html += `<li class="row"><span class="tiny">${esc(leagueShort(f.league))}: ${esc(f.home)} v ${esc(f.away)} <b>${scoreText(f)}</b></span>
      <span class="btns"><input class="sc" type="number" min="0" inputmode="numeric" data-score="${esc(f.id)}" data-side="home_score" value="${f.home_score ?? ''}" aria-label="Home score">
      <input class="sc" type="number" min="0" inputmode="numeric" data-score="${esc(f.id)}" data-side="away_score" value="${f.away_score ?? ''}" aria-label="Away score"></span>
      <select data-status="${esc(f.id)}"><option value="">Auto${f.manual_status ? '' : ` (${f.status})`}</option>
      ${['scheduled', 'live', 'ft', 'postponed', 'abandoned'].map((s) => `<option value="${s}" ${f.manual_status && f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></li>`;
  }
  html += `</ul></section>
    <section class="card"><h3>Invite the family</h3><p class="tiny">Send them this link. On iPhone or iPad, open it in Safari, tap Share, then "Add to Home Screen". On Android, open it in Chrome, tap ⋮, then "Add to Home screen".</p>
    <input readonly value="${esc(location.origin + location.pathname)}"></section>`;
  $app.innerHTML = html;
}

// ---------- sign in (name + password, no email needed) ----------
// Supabase needs an email-shaped login, so each name becomes a private login id
// like "patrick@<LOGIN_DOMAIN>". No email is ever sent to it.
export const loginId = (name) => {
  const slug = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug.length >= 2 ? `${slug}@${LOGIN_DOMAIN}` : null;
};

function viewAuth(mode = 'in') {
  $tabs.hidden = true;
  $who.textContent = '';
  $app.innerHTML = `<section class="hero"><h1>${mode === 'up' ? 'Join the family game' : 'Welcome back'}</h1></section>
  <form class="card" id="auth" data-mode="${mode}">
    <label>Your name <input name="name" required maxlength="30" autocomplete="username" autocapitalize="words"></label>
    <label>Password <input name="password" type="password" required minlength="6" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}"></label>
    ${mode === 'up' ? '<p class="muted tiny">Use the name the family knows you by. You\'ll sign in with this name and password.</p>' : ''}
    <button class="btn" type="submit">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
    ${mode === 'in'
    ? '<p class="center"><a href="#" data-mode="up">New here? Create an account</a><br><span class="muted tiny">Forgot your password? Ask the admin to reset it.</span></p>'
    : '<p class="center"><a href="#" data-mode="in">Back to sign in</a></p>'}
  </form>`;
}

async function submitAuth(form) {
  const mode = form.dataset.mode;
  const v = Object.fromEntries(new FormData(form));
  const name = v.name.trim().replace(/\s+/g, ' ');
  const email = loginId(name);
  if (!email) return toast('Please use a name with at least 2 letters.');
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    let r;
    if (mode === 'in') {
      r = await sb.auth.signInWithPassword({ email, password: v.password });
      if (r.error && /invalid/i.test(r.error.message)) return toast('That name and password don\'t match. Check the spelling of your name.', 6000);
    } else {
      r = await sb.auth.signUp({ email, password: v.password, options: { data: { name } } });
      if (r.error && /already/i.test(r.error.message)) return toast(`Someone has already signed up as "${name}". Sign in instead, or add an initial.`, 7000);
      if (!r.error && !r.data.session) return toast('Account made, but Supabase wants email confirmation. Turn off "Confirm email" in Supabase.', 9000);
    }
    if (r?.error) toast(r.error.message, 6000);
  } finally { btn.disabled = false; }
}

// ---------- routing and events ----------
async function route() {
  if (!state.session) return viewAuth();
  const hash = location.hash.replace(/^#\/?/, '');
  const [tab, arg] = hash.split('/');
  for (const a of $tabs.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === (tab === 'week' ? 'history' : tab));
  try {
    if (tab === 'picks') await viewPicks();
    else if (tab === 'history') await viewHistory(state.season);
    else if (tab === 'admin') await viewAdmin();
    else if (tab === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(arg)) await viewWeek(arg, { current: arg === state.week });
    else await viewWeek(state.week, { current: true });
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<section class="card"><p>Something went wrong: ${esc(e.message)}</p><button class="btn" data-act="reload">Try again</button></section>`;
  }
}

async function syncDay(day) {
  toast('Fetching results…');
  try {
    const n = await pullLive(day, true);
    toast(`Updated ${plural(n, 'match', 'es')}.`);
  } catch (e) {
    toast(`${e.message} The scheduled update still runs.`, 6000);
  }
  route();
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act],[data-fx],[data-mode],[data-reset]');
  if (!t) return;
  if (t.dataset.mode && t.tagName === 'A') { ev.preventDefault(); return viewAuth(t.dataset.mode); }
  if (t.dataset.fx) {
    const ids = state.draft.ids;
    const i = ids.indexOf(t.dataset.fx);
    if (i >= 0) ids.splice(i, 1);
    else if (ids.length >= PICKS_PER_WEEK) return toast(`You already have ${PICKS_PER_WEEK}. Untick one first.`);
    else ids.push(t.dataset.fx);
    t.classList.toggle('on', i < 0);
    t.querySelector('.tick').textContent = i < 0 ? '✓' : '';
    document.getElementById('count').textContent = ids.length;
    const save = document.querySelector('[data-act="save-picks"]');
    delete save.dataset.sure;
    save.textContent = 'Save picks';
    return;
  }
  if (t.dataset.reset) {
    const box = t.parentElement;
    box.innerHTML = `<span class="btns"><input type="text" placeholder="New password" minlength="6" id="np-${t.dataset.reset}"><button class="btn small" data-act="do-reset" data-player="${t.dataset.reset}">Set</button></span>`;
    return;
  }
  const act = t.dataset.act;
  if (act === 'do-reset') {
    const pw = document.getElementById(`np-${t.dataset.player}`).value;
    if (pw.length < 6) return toast('Passwords need at least 6 characters.');
    const { error } = await sb.rpc('admin_reset_password', { player: t.dataset.player, new_password: pw });
    return toast(error ? error.message : 'Password reset. Tell them their new password.', 6000);
  }
  if (act === 'save-picks') return savePicks();
  if (act === 'sync') return syncDay(state.week);
  if (act === 'sync-other') { const d = document.getElementById('other-day').value; return d ? syncDay(d) : toast('Choose a date first.'); }
  if (act === 'live') {
    try { await pullLive(state.week); } catch (e) { toast(e.message); }
    return route();
  }
  if (act === 'reload') return route();
  if (act === 'week-off' || act === 'week-off-other') {
    ev.preventDefault();
    const day = act === 'week-off' ? t.dataset.day : document.getElementById('other-day').value;
    if (!day) return toast('Choose a date first.');
    if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 6) return toast('That date isn\'t a Saturday.');
    const { error } = await sb.from('weeks_off').upsert({ week_id: day, reason: 'International break' });
    toast(error ? (/weeks_off/.test(error.message) ? 'Re-run supabase/schema.sql in Supabase first.' : error.message) : `No game on ${dayLabel(day)}.`);
    return route();
  }
  if (act === 'week-on') {
    ev.preventDefault();
    const { error } = await sb.from('weeks_off').delete().eq('week_id', t.dataset.day);
    toast(error ? error.message : `The game is back on for ${dayLabel(t.dataset.day)}.`);
    return route();
  }
  if (act === 'signout') { await sb.auth.signOut(); return; }
  if (act === 'rename') {
    const name = document.getElementById('my-name').value.trim();
    const pass = document.getElementById('my-pass').value;
    if (pass) {
      if (pass.length < 6) return toast('Passwords need at least 6 characters.');
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) return toast(error.message);
      document.getElementById('my-pass').value = '';
      toast('Password changed.');
    }
    if (!name || name === state.me.name) return;
    const { error } = await sb.from('players').update({ name }).eq('id', state.me.id);
    if (error) return toast(error.message);
    await loadPlayers(); renderWho(); toast('Name saved.');
  }
  if (act === 'add-player') {
    const name = document.getElementById('new-player').value.trim();
    if (!name) return;
    const { error } = await sb.from('players').insert({ name });
    if (error) return toast(error.message);
    await loadPlayers(); toast(`${name} added.`); route();
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.id === 'who-for') { state.draft = { playerId: t.value, day: null }; return route(); }
  if (t.id === 'season') { state.season = t.value; return route(); }
  if (t.dataset.replace) {
    const { error } = await sb.from('picks').update({ replacement_fixture_id: t.value || null }).eq('id', t.dataset.replace);
    toast(error ? error.message : 'Replacement saved.');
    return route();
  }
  if (t.dataset.status !== undefined && t.matches('select')) {
    const v = t.value;
    const patch = v ? { status: v, manual_status: true, updated_at: new Date().toISOString() } : { manual_status: false };
    const { error } = await sb.from('fixtures').update(patch).eq('id', t.dataset.status);
    toast(error ? error.message : v ? `Marked ${v}.` : 'Back to automatic. The next update will set it.');
    return;
  }
  if (t.dataset.score) {
    const v = t.value === '' ? null : Math.max(0, parseInt(t.value, 10));
    const { error } = await sb.from('fixtures').update({ [t.dataset.side]: v, updated_at: new Date().toISOString() }).eq('id', t.dataset.score);
    toast(error ? error.message : 'Score saved. Set the status to "ft" when it has finished.');
    return;
  }
  if (t.dataset.rename) {
    const { error } = await sb.from('players').update({ name: t.value.trim() }).eq('id', t.dataset.rename);
    toast(error ? error.message : 'Name saved.');
    await loadPlayers();
    return;
  }
  if (t.id === 'shot' && t.files[0]) {
    const status = document.getElementById('ocr-status');
    try {
      status.textContent = 'Reading screenshot…';
      const lines = await readScreenshot(t.files[0], (p) => { status.textContent = `Reading screenshot… ${p}%`; });
      const { fixtures } = await loadWeek(state.week);
      const found = matchScreenshot(lines, fixtures.filter((f) => !isOff(f)));
      if (!found.length) { status.textContent = 'No matches recognised. Tick your matches below instead.'; return; }
      state.draft.ids = found.map((x) => x.fixture.id);
      state.draft.found = new Map(found.map((x) => [x.fixture.id, x.confidence]));
      await route();
      const unsure = found.filter((x) => x.confidence === 'one').length;
      toast(`Found ${plural(found.length, 'match', 'es')}.${unsure ? ` Check the ${unsure} marked "check".` : ''} Then tap Save.`, 7000);
    } catch (e) {
      status.textContent = e.message;
    }
  }
});

document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'auth') { ev.preventDefault(); submitAuth(ev.target); }
});
window.addEventListener('hashchange', route);

function renderWho() {
  $who.textContent = state.me ? state.me.name : '';
  document.getElementById('admin-tab').hidden = !state.me?.is_admin;
}

async function start() {
  if (!state.session) return route();
  $tabs.hidden = false;
  try { await loadPlayers(); } catch (e) { toast(e.message); }
  renderWho();
  route();
}

sb.auth.onAuthStateChange((event, session) => {
  const changed = (session?.user?.id || null) !== (state.session?.user?.id || null);
  state.session = session;
  if (event === 'INITIAL_SESSION' || changed) setTimeout(start, 0);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
