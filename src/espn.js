// Fetches the PGA leaderboard via our Vercel proxy and applies updates to bets.

const ENDPOINT = '/api/leaderboard';

function parseRelative(s) {
  if (s === 'E' || s === undefined || s === null) return 0;
  if (s === '-' || s === '') return null;
  const n = parseFloat(String(s).replace('+', ''));
  return isNaN(n) ? null : n;
}

export async function fetchESPNLeaderboard() {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status}`);
  const json = await res.json();

  const event = json.events?.[0];
  if (!event) throw new Error('No active event in ESPN feed');

  const tournament = event.name;
  const competitors = event.competitions?.[0]?.competitors || [];

  const players = competitors.map(c => {
    const allRounds = c.linescores || [];

    const roundResults = [];
    let currentRound = 1;
    let currentRoundHoles = 0;
    let currentRoundScore = null;

    allRounds.forEach((rd, idx) => {
      const roundNum = rd.period || idx + 1;
      const holes = rd.linescores?.length || 0;
      const score = parseRelative(rd.displayValue);

      if (holes >= 18) {
        roundResults.push({ round: roundNum, score, position: null });
      } else if (holes > 0) {
        currentRound = roundNum;
        currentRoundHoles = holes;
        currentRoundScore = score;
      }
    });

    if (currentRoundHoles === 0 && roundResults.length > 0) {
      currentRound = Math.min(4, roundResults.length + 1);
    }

    return {
      name: c.athlete?.fullName,
      shortName: c.athlete?.shortName,
      totalDisplay: c.score,
      todayScore: currentRoundHoles > 0 ? currentRoundScore : null,
      holesPlayed: currentRoundHoles,
      currentRound,
      roundResults,
    };
  });

  const parseTotal = (s) => {
    if (s === 'E' || s === undefined || s === null) return 0;
    if (s === '-' || s === '') return 999;
    const n = parseFloat(String(s).replace('+', ''));
    return isNaN(n) ? 999 : n;
  };
  const sorted = [...players].sort((a, b) => parseTotal(a.totalDisplay) - parseTotal(b.totalDisplay));
  const positions = {};
  let actualPos = 0;
  let prevScore = null;
  let prevDisplayPos = 0;
  sorted.forEach(p => {
    actualPos += 1;
    const score = parseTotal(p.totalDisplay);
    if (score === 999) {
      positions[p.name] = '—';
      return;
    }
    if (score === prevScore) {
      positions[p.name] = `${prevDisplayPos}`;
    } else {
      prevScore = score;
      prevDisplayPos = actualPos;
      positions[p.name] = `${actualPos}`;
    }
  });
  const counts = {};
  sorted.forEach(p => {
    const s = parseTotal(p.totalDisplay);
    if (s !== 999) counts[s] = (counts[s] || 0) + 1;
  });
  sorted.forEach(p => {
    const s = parseTotal(p.totalDisplay);
    if (s !== 999 && counts[s] > 1 && positions[p.name] && !positions[p.name].startsWith('T')) {
      positions[p.name] = `T${positions[p.name]}`;
    }
  });

  return {
    tournament,
    fetchedAt: new Date().toISOString(),
    players: players.map(p => ({
      ...p,
      position: positions[p.name],
      totalScore: parseTotal(p.totalDisplay) === 999 ? null : parseRelative(p.totalDisplay),
    })),
  };
}

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

    const seenRounds = new Set();
    const mergedRoundResults = [];
    p.roundResults.forEach(rr => {
      mergedRoundResults.push({ ...rr, position: rr.position || p.position });
      seenRounds.add(rr.round);
    });
    (bet.roundResults || []).forEach(rr => {
      if (!seenRounds.has(rr.round)) mergedRoundResults.push(rr);
    });
    mergedRoundResults.sort((a, b) => a.round - b.round);

    let liveStatus;
    if (p.totalScore === null) liveStatus = 'pre-round';
    else if (p.holesPlayed === 0 && p.roundResults.length > 0) liveStatus = 'between-rounds';
    else if (p.holesPlayed >= 18) liveStatus = 'complete';
    else liveStatus = 'in-round';

    return {
      ...bet,
      liveData: {
        ...(bet.liveData || {}),
        position: p.position,
        totalScore: p.totalScore,
        todayScore: p.todayScore,
        holesPlayed: p.holesPlayed,
        trend: trendFor(p.todayScore),
        currentRound: p.currentRound,
        status: liveStatus,
        lastUpdated: `${stamp} ET`,
      },
      roundResults: mergedRoundResults,
    };
  });

  return { bets: updated, changed };
}
