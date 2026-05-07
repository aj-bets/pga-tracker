// Vercel serverless function: GET /api/leaderboard
// Proxies ESPN's PGA scoreboard API to avoid CORS issues in the browser.

export default async function handler(req, res) {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    if (!response.ok) {
      return res.status(response.status).json({ error: 'ESPN fetch failed' });
    }
    const data = await response.json();
    // Cache for 60 seconds at the edge — ESPN updates roughly that often anyway
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
