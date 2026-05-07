// Fetches the PGA leaderboard via our Vercel proxy and applies updates to bets.

const ENDPOINT = '/api/leaderboard';

export async function fetchESPNLeaderboard() {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status}`);
  const json = await res.json();

  const event = json.events?.[0];
  if (!event) throw new Error('No active event in ESPN feed');

  const tournament = event.name;
  const competitors = event.competitions?.[0]?.competitors || [];

  // Build position lookup. ESPN doesn't always send a position string directly,
  // so we sort by score and assign T-positions based on ties.
  const players = competitors.map(c => {
    const lineScore = c.linescores?.[0];
    const scoreDisplay = lineScore?.displayValue;
    // Most recent period in linescores tells us holes played in current round
    const holes = lineScore?.linescores?.length || 0;
    return {
      name: c.athlete?.fullName,
      shortName: c.athlete?.shortName,
      totalDisplay: c.score, // overall total ('-3', 'E', '+1', etc.)
      todayDisplay: scoreDisplay, // round score so far
      holesPlayed: holes,
      teeTime: lineScore?.statistics?.categories?.[0]?.stats?.find(s => s.displayValue?.includes(':'))?.displayValue || null,
    };
  });

  // Compute positions by sorting on numeric total score
  const parseScore = (s) => {
    if (s === 'E' || s === undefined || s === null) return 0;
    if (s === '-' || s === '') return 999; // not yet started
    return parseFloat(s.replace('+', ''));
  };
  const sorted = [...players].sort((a, b) => parseScore(a.totalDisplay) - parseScore(b.totalDisplay));
  let lastScore = null;
  let lastPos = 0;
  let actualPos = 0;
  const positions = {};
  sorted.forEach((p) => {
    actualPos += 1;
    const score = parseScore(p.totalDisplay);
    if (score === 999) {
      positions[p.name] = '—';
    } else if (score === lastScore) {
      positions[p.name] = `T${lastPos}`;
    } else {
      lastScore = score;
      lastPos = actualPos;
      positions[p.name] = `${lastPos}`;
    }
  });
  // Mark ties properly: any score with multiple players gets a T prefix
  const scoreCounts = {};
  sorted.forEach(p => {
    const s = parseScore(p.totalDisplay);
    if (s !== 999) scoreCounts[s] = (scoreCounts[s] || 0) + 1;
  });
  sorted.forEach(p => {
    const s = parseScore(p.totalDisplay);
    if (s !== 999 && scoreCounts[s] > 1 && !positions[p.name].startsWith('T')) {
      positions[p.name] = `T${positions[p.name]}`;
    }
  });

  return {
    tournament,
    fetchedAt: new Date().toISOString(),
    players: players.map(p => ({
      ...p,
      position: positions[p.name],
      totalScore: p.totalDisplay === 'E' ? 0 : parseScore(p.totalDisplay) === 999 ? null : parseScore(p.totalDisplay),
      todayScore: p.todayDisplay === 'E' ? 0 : p.todayDisplay && p.todayDisplay !== '-' ? parseScore(p.todayDisplay) : null,
    })),
  };
}

// Determine trend by comparing today's score to par. Simple heuristic.
function trendFor(todayScore) {
  if (todayScore === null || todayScore === undefined) return null;
  if (todayScore < 0) return 'improving';
  if (todayScore > 1) return 'fading';
  return 'holding';
}

export function applyLeaderboardToBets(bets, leaderboard, tournamentMatcher) {
  const stamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const playerMap = {};
  leaderboard.players.forEach(p => {
    playerMap[p.name] = p;
  });

  let changed = 0;
  const updated = bets.map(bet => {
    if (bet.status !== 'open') return bet;
    if (tournamentMatcher && !tournamentMatcher(bet.tournament, leaderboard.tournament)) return bet;
    const p = playerMap[bet.player];
    if (!p) return bet;

    changed += 1;
    return {
      ...bet,
      liveData: {
        ...(bet.liveData || {}),
        position: p.position,
        totalScore: p.totalScore,
        todayScore: p.todayScore,
        holesPlayed: p.holesPlayed,
        trend: trendFor(p.todayScore),
        currentRound: 1,
        status: p.totalScore === null ? 'pre-round' : (p.holesPlayed >= 18 ? 'complete' : 'in-round'),
        lastUpdated: `${stamp} ET`,
      },
    };
  });

  return { bets: updated, changed };
}
