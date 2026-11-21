// The leagues the family can pick from, in the order Flashscore lists them.
// `source`: where results come from (ESPN unless marked 'bbc', because ESPN stopped
// updating Scottish League One/Two and the NIFL in 2025).
// `next` is the league a postponed pick rolls down to when it is the last
// 3pm match in its own league. `null` means the player picks a match by hand.
export const LEAGUES = [
  { code: 'eng.1', name: 'Premier League', country: 'England', next: 'eng.2' },
  { code: 'eng.2', name: 'Championship', country: 'England', next: 'eng.3' },
  { code: 'eng.3', name: 'League One', country: 'England', next: 'eng.4' },
  { code: 'eng.4', name: 'League Two', country: 'England', next: 'eng.5' },
  { code: 'eng.5', name: 'National League', country: 'England', next: null },
  { code: 'sco.1', name: 'Premiership', country: 'Scotland', next: 'sco.2' },
  { code: 'sco.2', name: 'Championship', country: 'Scotland', next: 'sco.3' },
  { code: 'sco.3', name: 'League One', country: 'Scotland', next: 'sco.4', source: 'bbc' },
  { code: 'sco.4', name: 'League Two', country: 'Scotland', next: null, source: 'bbc' },
  { code: 'nir.1', name: 'NIFL Premiership', country: 'Northern Ireland', next: null, source: 'bbc' },
];

export const LEAGUE_BY_CODE = Object.fromEntries(LEAGUES.map((l, i) => [l.code, { ...l, rank: i }]));

export function leagueLabel(code) {
  const l = LEAGUE_BY_CODE[code];
  return l ? `${l.country}: ${l.name}` : code;
}

export const BBC_NAMES = { 'Scottish League One': 'sco.3', 'Scottish League Two': 'sco.4', 'Irish Premiership': 'nir.1' };
export const espnLeagues = () => LEAGUES.filter((l) => l.source !== 'bbc');
