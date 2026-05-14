import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { RefreshCw, Plus, X, Download, ChevronRight, TrendingUp, TrendingDown, Minus, Edit2, Trash2, Check, AlertCircle, Share2 } from 'lucide-react';
import { storage } from './storage.js';
import { fetchESPNLeaderboard, applyLeaderboardToBets } from './espn.js';

// === Kalshi-inspired theme ===
const theme = {
  bg: '#0a0a0a',
  bgCard: '#141414',
  bgElevated: '#1a1a1a',
  bgHover: '#1f1f1f',
  border: '#262626',
  borderLight: '#333333',
  text: '#ffffff',
  textMuted: '#a3a3a3',
  textDim: '#737373',
  teal: '#00d4aa',
  tealDim: '#00a886',
  green: '#00e676',
  red: '#ff5252',
  yellow: '#ffb74d',
};

const fontStack = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
const tabularStyle = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' };

// === Storage helpers ===
const STORAGE_KEYS = {
  bets: 'pga:bets',
  partners: 'pga:partners',
  payments: 'pga:payments',
  settings: 'pga:settings',
};

async function loadData(key, fallback) {
  try {
    const r = await storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}

async function saveData(key, value) {
  try {
    await storage.set(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Save failed:', key, e);
    return false;
  }
}

// === Utility ===
const fmt = (n, opts = {}) => {
  const { sign = false, dollars = true } = opts;
  if (n === null || n === undefined || isNaN(n)) return dollars ? '$0.00' : '0';
  const abs = Math.abs(n);
  const str = dollars ? `$${abs.toFixed(2)}` : abs.toFixed(2);
  if (sign && n > 0) return `+${str}`;
  if (n < 0) return `-${str}`;
  return str;
};

const fmtCents = (c) => {
  if (c === null || c === undefined) return '—';
  return `${c}¢`;
};

const today = () => new Date().toISOString().split('T')[0];

// Compute realized P&L for a closed bet (total, before split)
function totalPnL(bet) {
  if (bet.status !== 'closed') return 0;
  if (bet.outcome === 'won') return (bet.maxPayout || 0) - (bet.totalCost || 0);
  if (bet.outcome === 'lost') return -(bet.totalCost || 0);
  if (bet.outcome === 'sold') {
    // sold at price per contract (cents) * contracts / 100
    const proceeds = ((bet.sellPrice || 0) * (bet.contracts || 0)) / 100;
    return proceeds - (bet.totalCost || 0);
  }
  return 0;
}

// My share of P&L
function myPnL(bet) {
  const split = bet.splits?.find(s => s.name === 'Me')?.pct ?? 100;
  return totalPnL(bet) * (split / 100);
}

// My cost basis
function myCost(bet) {
  const split = bet.splits?.find(s => s.name === 'Me')?.pct ?? 100;
  return (bet.totalCost || 0) * (split / 100);
}

// Partner share
function partnerPnL(bet, partnerName) {
  const split = bet.splits?.find(s => s.name === partnerName)?.pct ?? 0;
  return totalPnL(bet) * (split / 100);
}

function partnerCost(bet, partnerName) {
  const split = bet.splits?.find(s => s.name === partnerName)?.pct ?? 0;
  return (bet.totalCost || 0) * (split / 100);
}

// === Main App ===
export default function App() {
  const [bets, setBets] = useState([]);
  const [partners, setPartners] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settings, setSettings] = useState({ bankroll: 0, defaultSplits: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('live');
  const [drillDown, setDrillDown] = useState(null); // { title, bets }

  useEffect(() => {
    (async () => {
      let [b, p, pay, s] = await Promise.all([
        loadData(STORAGE_KEYS.bets, []),
        loadData(STORAGE_KEYS.partners, []),
        loadData(STORAGE_KEYS.payments, []),
        loadData(STORAGE_KEYS.settings, { bankroll: 0, defaultSplits: [] }),
      ]);

      // === Helper: does a bet for (tournament, player) already exist? ===
      const hasBet = (tournament, player) =>
        b.some(x => x.tournament === tournament && x.player === player);

      const split5050 = [{ name: 'Me', pct: 50 }, { name: 'Bird', pct: 50 }];
      let dirty = false;

      // Ensure Bird exists as a partner
      if (!p.some(x => x.name === 'Bird')) {
        p = [...p, { name: 'Bird' }];
        dirty = true;
      }

      // === Masters 2026 (closed) ===
      const mastersBets = [
        { player: 'Rory McIlroy',     totalCost: 25.00, maxPayout: 360.00, outcome: 'won' },
        { player: 'Tyrrell Hatton',   totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Shane Lowry',      totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Matt Fitzpatrick', totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Cameron Young',    totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Min Woo Lee',      totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Jason Day',        totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Jacob Bridgeman',  totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
      ];
      mastersBets.forEach((x, i) => {
        if (hasBet('Masters 2026', x.player)) return;
        b.push({
          id: `bet-masters2026-${i}`,
          player: x.player,
          tournament: 'Masters 2026',
          marketType: 'Outright',
          entryPrice: null,
          contracts: null,
          totalCost: x.totalCost,
          maxPayout: x.maxPayout,
          splits: split5050,
          status: 'closed',
          outcome: x.outcome,
          sellPrice: null,
          entryDate: '2026-04-12',
          closedDate: '2026-04-12',
          notes: '',
        });
        dirty = true;
      });

      // === Cadillac Championship 2026 (closed) ===
      const cadillacBets = [
        { player: 'Akshay Bhatia',    totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Keegan Bradley',   totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Tommy Fleetwood',  totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Kurt Kitayama',    totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Hideki Matsuyama', totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Collin Morikawa',  totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Justin Rose',      totalCost: 25.00, maxPayout: 0,      outcome: 'lost' },
        { player: 'Cameron Young',    totalCost: 25.00, maxPayout: 325.91, outcome: 'won' },
      ];
      cadillacBets.forEach((x, i) => {
        if (hasBet('Cadillac Championship 2026', x.player)) return;
        b.push({
          id: `bet-cadillac2026-${i}`,
          player: x.player,
          tournament: 'Cadillac Championship 2026',
          marketType: 'Outright',
          entryPrice: null,
          contracts: null,
          totalCost: x.totalCost,
          maxPayout: x.maxPayout,
          splits: split5050,
          status: 'closed',
          outcome: x.outcome,
          sellPrice: null,
          entryDate: '2026-05-03',
          closedDate: '2026-05-03',
          notes: '',
        });
        dirty = true;
      });

      // === Truist Championship 2026 (open) ===
      const truistBets = [
        { player: 'Sam Burns',        totalCost: 25.00, maxPayout: 1063.25, teeTime: '4:39 PM UTC' },
        { player: 'Patrick Cantlay',  totalCost: 25.00, maxPayout: 1169.75, teeTime: '4:39 PM UTC' },
        { player: 'Corey Conners',    totalCost: 25.00, maxPayout: 2922.05, teeTime: '3:22 PM UTC' },
        { player: 'Ben Griffin',      totalCost: 25.00, maxPayout: 1164.90, teeTime: '4:28 PM UTC' },
        { player: 'Viktor Hovland',   totalCost: 25.00, maxPayout: 1204.02, teeTime: '3:44 PM UTC' },
        { player: 'Robert MacIntyre', totalCost: 25.00, maxPayout: 1113.70, teeTime: '4:50 PM UTC' },
        { player: 'Hideki Matsuyama', totalCost: 25.00, maxPayout: 1169.75, teeTime: '4:28 PM UTC' },
        { player: 'Rory McIlroy',     totalCost: 25.00, maxPayout: 200.04 , teeTime: '3:33 PM UTC' },
      ];
      truistBets.forEach((x, i) => {
        if (hasBet('Truist Championship 2026', x.player)) return;
        b.push({
          id: `bet-truist2026-${i}`,
          player: x.player,
          tournament: 'Truist Championship 2026',
          marketType: 'Outright',
          entryPrice: null,
          contracts: null,
          totalCost: x.totalCost,
          maxPayout: x.maxPayout,
          splits: split5050,
          status: 'open',
          outcome: null,
          sellPrice: null,
          entryDate: '2026-05-07',
          closedDate: null,
          notes: '',
          liveData: {
            position: '—',
            totalScore: null,
            currentRound: 1,
            holesPlayed: 0,
            todayScore: null,
            trend: null,
            teeTime: x.teeTime,
            status: 'pre-round',
            lastUpdated: null,
          },
          roundResults: [],
        });
        dirty = true;
      });

      // === Truist R1 Leader market (open) — $5 capital, 50/50 with Bird ===
      const truistR1LeaderBets = [
        { player: 'Sam Burns',         maxPayout: 195.00 },
        { player: 'Patrick Cantlay',   maxPayout: 203.06 },
        { player: 'Tommy Fleetwood',   maxPayout: 173.03 },
        { player: 'Kurt Kitayama',     maxPayout: 212.45 },
        { player: 'Hideki Matsuyama',  maxPayout: 195.00 },
        { player: 'Rory McIlroy',      maxPayout: 72.12  },
        { player: 'Taylor Pendrith',   maxPayout: 311.22 },
        { player: 'Xander Schauffele', maxPayout: 101.70 },
        { player: 'J.J. Spaun',        maxPayout: 233.95 },
        { player: 'Justin Thomas',     maxPayout: 222.38 },
      ];
      truistR1LeaderBets.forEach((x, i) => {
        if (b.some(bet => bet.tournament === 'Truist Championship 2026' && bet.player === x.player && bet.marketType === 'R1 Leader')) return;
        b.push({
          id: `bet-truist2026-r1leader-${i}`,
          player: x.player,
          tournament: 'Truist Championship 2026',
          marketType: 'R1 Leader',
          entryPrice: null,
          contracts: null,
          totalCost: 5.00,
          maxPayout: x.maxPayout,
          splits: split5050,
          status: 'open',
          outcome: null,
          sellPrice: null,
          entryDate: '2026-05-07',
          closedDate: null,
          notes: '',
          liveData: {
            position: '—',
            totalScore: null,
            currentRound: 1,
            holesPlayed: 0,
            todayScore: null,
            trend: null,
            teeTime: null,
            status: 'pre-round',
            lastUpdated: null,
          },
          roundResults: [],
        });
        dirty = true;
      });

      // === Truist R1 Leader: solo bets ===
      const truistR1LeaderSolo = [
        { player: 'Nick Taylor', totalCost: 12.00, maxPayout: 1122.22 },
      ];
      truistR1LeaderSolo.forEach((x, i) => {
        if (b.some(bet => bet.tournament === 'Truist Championship 2026' && bet.player === x.player && bet.marketType === 'R1 Leader')) return;
        b.push({
          id: `bet-truist2026-r1leader-solo-${i}`,
          player: x.player,
          tournament: 'Truist Championship 2026',
          marketType: 'R1 Leader',
          entryPrice: null,
          contracts: null,
          totalCost: x.totalCost,
          maxPayout: x.maxPayout,
          splits: [{ name: 'Me', pct: 100 }],
          status: 'open',
          outcome: null,
          sellPrice: null,
          entryDate: '2026-05-07',
          closedDate: null,
          notes: '',
          liveData: {
            position: '—',
            totalScore: null,
            currentRound: 1,
            holesPlayed: 0,
            todayScore: null,
            trend: null,
            teeTime: null,
            status: 'pre-round',
            lastUpdated: null,
          },
          roundResults: [],
        });
        dirty = true;
      });

      // === Seed payments with Bird ===
      const seedPayments = [
        { id: 'pay-bird-2026-04-09', date: '2026-04-09', direction: 'from', amount: 100.00, note: 'Masters capital contribution' },
        { id: 'pay-bird-2026-04-13', date: '2026-04-13', direction: 'to',   amount: 180.00, note: 'Masters: $100 capital return + $80 winnings' },
        { id: 'pay-bird-2026-04-29', date: '2026-04-29', direction: 'from', amount: 100.00, note: 'Cadillac capital contribution' },
        { id: 'pay-bird-2026-05-06a', date: '2026-05-06', direction: 'to',   amount: 62.50,  note: 'Cadillac winnings (capital rolled to Truist)' },
        { id: 'pay-bird-2026-05-06b', date: '2026-05-06', direction: 'from', amount: 25.00,  note: 'Truist R1 Leader capital contribution' },
      ];
      seedPayments.forEach(sp => {
        if (pay.some(p => p.id === sp.id)) return;
        pay.push({ ...sp, partner: 'Bird' });
        dirty = true;
      });

      // === Truist R1 live update v3 (ESPN feed, May 7 ~6:30 PM ET) — captures completed R1 into roundResults ===
      const targetStampV3 = '2026-05-07 18:30 ET';
      const r1UpdateV3 = {
        'Sam Burns':         { position: 'T20', totalScore: -1, holesPlayed: 14, todayScore: -1, trend: 'fading' },
        'Patrick Cantlay':   { position: 'T29', totalScore: 0,  holesPlayed: 14, todayScore: 0,  trend: 'holding' },
        'Corey Conners':     { position: 'T16', totalScore: -2, holesPlayed: 10, todayScore: -2, trend: 'improving' },
        'Ben Griffin':       { position: 'T2',  totalScore: -3, holesPlayed: 14, todayScore: -3, trend: 'improving' },
        'Viktor Hovland':    { position: 'T29', totalScore: 0,  holesPlayed: 17, todayScore: 0,  trend: 'holding' },
        'Robert MacIntyre':  { position: 'T29', totalScore: 0,  holesPlayed: 13, todayScore: 0,  trend: 'holding' },
        'Hideki Matsuyama':  { position: 'T29', totalScore: 0,  holesPlayed: 6,  todayScore: 0,  trend: 'holding' },
        'Rory McIlroy':      { position: 'T29', totalScore: 0,  holesPlayed: 18, todayScore: 0,  trend: 'holding' },
        'Tommy Fleetwood':   { position: 'T2',  totalScore: -2, holesPlayed: 18, todayScore: -2, trend: 'holding' },
        'Kurt Kitayama':     { position: 'T29', totalScore: 0,  holesPlayed: 7,  todayScore: 0,  trend: 'holding' },
        'Taylor Pendrith':   { position: 'T20', totalScore: -1, holesPlayed: 18, todayScore: -1, trend: 'holding' },
        'Xander Schauffele': { position: '—',   totalScore: null, holesPlayed: 0, todayScore: null, trend: null },
        'J.J. Spaun':        { position: 'T29', totalScore: 0,  holesPlayed: 13, todayScore: 0,  trend: 'holding' },
        'Justin Thomas':     { position: 'T29', totalScore: 0,  holesPlayed: 6,  todayScore: 0,  trend: 'holding' },
        'Justin Rose':       { position: 'T20', totalScore: -1, holesPlayed: 18, todayScore: -1, trend: 'holding' },
        'Nick Taylor':       { position: 'T2',  totalScore: -2, holesPlayed: 18, todayScore: -2, trend: 'holding' },
      };
      b = b.map(bet => {
        if (bet.tournament !== 'Truist Championship 2026' || bet.status !== 'open') return bet;
        if (bet.liveData?.lastUpdated === targetStampV3) return bet;
        const u = r1UpdateV3[bet.player];
        if (!u) return bet;
        dirty = true;

        // If R1 is complete (18 holes), capture into roundResults
        const existingRounds = bet.roundResults || [];
        const hasR1 = existingRounds.some(r => r.round === 1);
        const roundResults = (u.holesPlayed === 18 && !hasR1)
          ? [...existingRounds, { round: 1, score: u.totalScore, position: u.position }].sort((a, b) => a.round - b.round)
          : existingRounds;

        let status;
        if (u.totalScore === null) status = 'pre-round';
        else if (u.holesPlayed === 18) status = 'between-rounds';
        else status = 'in-round';

        return {
          ...bet,
          liveData: {
            ...(bet.liveData || {}),
            ...u,
            currentRound: u.holesPlayed === 18 ? 2 : 1,
            status,
            lastUpdated: targetStampV3,
          },
          roundResults,
        };
      });

      // === One-time cost normalization: all OUTRIGHT bets through Truist 2026 are $25 capital ===
      // Fixes bets that were logged earlier with market values instead of cost basis.
      const normalizeFlag = await loadData('pga:normalize:25dollar:v1', false);
      if (!normalizeFlag) {
        const targetTournaments = new Set(['Masters 2026', 'Cadillac Championship 2026', 'Truist Championship 2026']);
        b = b.map(bet => {
          if (!targetTournaments.has(bet.tournament)) return bet;
          if (bet.marketType !== 'Outright') return bet;
          if (bet.totalCost === 25.00) return bet;
          dirty = true;
          return { ...bet, totalCost: 25.00 };
        });
        await saveData('pga:normalize:25dollar:v1', true);
      }

      // Auto-register any partner names that appear in bet splits but aren't in partners list
      const existingPartnerNames = new Set(p.map(x => x.name.toLowerCase()));
      existingPartnerNames.add('me');
      const partnersFromBets = new Set();
      b.forEach(bet => {
        (bet.splits || []).forEach(s => {
          if (s.name && !existingPartnerNames.has(s.name.toLowerCase())) {
            partnersFromBets.add(s.name);
          }
        });
      });
      if (partnersFromBets.size > 0) {
        partnersFromBets.forEach(name => p.push({ name, defaultSplit: null }));
        dirty = true;
      }

      // Immediate persist if anything was added/updated, before relying on render-cycle saves
      if (dirty) {
        await saveData(STORAGE_KEYS.bets, b);
        await saveData(STORAGE_KEYS.partners, p);
        await saveData(STORAGE_KEYS.payments, pay);
      }

      setBets(b);
      setPartners(p);
      setPayments(pay);
      setSettings(s);
      setLoading(false);
    })();
  }, []);

  // Persist on change
  useEffect(() => { if (!loading) saveData(STORAGE_KEYS.bets, bets); }, [bets, loading]);
  useEffect(() => { if (!loading) saveData(STORAGE_KEYS.partners, partners); }, [partners, loading]);
  useEffect(() => { if (!loading) saveData(STORAGE_KEYS.payments, payments); }, [payments, loading]);
  useEffect(() => { if (!loading) saveData(STORAGE_KEYS.settings, settings); }, [settings, loading]);

  // === Header metrics ===
  const closedBets = bets.filter(b => b.status === 'closed');
  const openBets = bets.filter(b => b.status === 'open');

  const lifetimePnL = closedBets.reduce((sum, b) => sum + myPnL(b), 0);
  const openExposure = openBets.reduce((sum, b) => sum + myCost(b), 0);
  const todayPnL = closedBets
    .filter(b => b.closedDate === today())
    .reduce((sum, b) => sum + myPnL(b), 0);

  // Partner balances: realized P&L for partner + their capital out on open bets, minus payments
  const partnerBalances = partners.map(p => {
    const realizedShare = closedBets.reduce((sum, b) => sum + partnerPnL(b, p.name), 0);
    const capitalOut = closedBets.reduce((sum, b) => sum + partnerCost(b, p.name), 0);
    const partnerPayments = payments.filter(pay => pay.partner === p.name);
    const paidToPartner = partnerPayments.reduce((s, x) => s + (x.direction === 'to' ? x.amount : 0), 0);
    const paidFromPartner = partnerPayments.reduce((s, x) => s + (x.direction === 'from' ? x.amount : 0), 0);
    // Net: partner's profit - payments already made to settle
    const netRealized = realizedShare - paidToPartner + paidFromPartner;
    return { name: p.name, balance: netRealized, realized: realizedShare };
  });

  const owedToMe = partnerBalances.filter(p => p.balance < 0).reduce((s, p) => s + Math.abs(p.balance), 0);
  const iOwe = partnerBalances.filter(p => p.balance > 0).reduce((s, p) => s + p.balance, 0);

  // === Drill helpers ===
  const drillTo = (title, betList) => setDrillDown({ title, bets: betList });

  // === Auto-register any new partner names found in a bet's splits ===
  const addBetWithPartners = (bet) => {
    const existingNames = new Set(partners.map(p => p.name.toLowerCase()));
    existingNames.add('me'); // "Me" is the owner, not a partner
    const newPartnerNames = (bet.splits || [])
      .map(s => s.name)
      .filter(name => name && !existingNames.has(name.toLowerCase()));
    if (newPartnerNames.length > 0) {
      const newPartners = newPartnerNames.map(name => ({ name, defaultSplit: null }));
      setPartners([...partners, ...newPartners]);
    }
    setBets([...bets, bet]);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: fontStack, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: theme.textMuted }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: fontStack, fontSize: 14 }}>
      <Header
        lifetimePnL={lifetimePnL}
        openExposure={openExposure}
        todayPnL={todayPnL}
        owedToMe={owedToMe}
        iOwe={iOwe}
        bets={bets}
        setBets={setBets}
        partners={partners}
        partnerBalances={partnerBalances}
        payments={payments}
        onAddBet={addBetWithPartners}
        onDrill={drillTo}
      />

      <Tabs active={activeTab} onChange={setActiveTab} closedCount={closedBets.length} />

      <div style={{ padding: '16px', maxWidth: 1400, margin: '0 auto' }}>
        {activeTab === 'live' && (
          <LiveTab
            bets={bets}
            setBets={setBets}
            partners={partners}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTab
            bets={bets}
            setBets={setBets}
            onDrill={drillTo}
          />
        )}
        {activeTab === 'analytics' && (
          <AnalyticsTab
            bets={bets}
            onDrill={drillTo}
          />
        )}
        {activeTab === 'partners' && (
          <PartnersTab
            bets={bets}
            partners={partners}
            payments={payments}
            setPayments={setPayments}
            partnerBalances={partnerBalances}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            partners={partners}
            setPartners={setPartners}
            bets={bets}
            setBets={setBets}
            payments={payments}
            setPayments={setPayments}
          />
        )}
      </div>

      {drillDown && (
        <DrillModal
          title={drillDown.title}
          bets={drillDown.bets}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

// === Header ===
function Header({ lifetimePnL, openExposure, todayPnL, owedToMe, iOwe, bets, setBets, partners, partnerBalances, payments, onAddBet, onDrill }) {
  const [showAdd, setShowAdd] = useState(false);
  const closedBets = bets.filter(b => b.status === 'closed');
  const openBets = bets.filter(b => b.status === 'open');
  const todayBets = closedBets.filter(b => b.closedDate === today());

  // === Per-person metrics ===
  // "Me" row uses myPnL/myCost helpers (split where Me appears)
  const meRow = {
    name: 'Me',
    color: theme.teal,
    lifetimePnL: lifetimePnL,
    openExposure: openExposure,
    todayPnL: todayPnL,
    // For Me, "Balance" = net partner exposure: positive means I owe net, negative means net owed to me
    balance: iOwe - owedToMe,
    closedBets: closedBets.filter(b => b.splits?.some(s => s.name === 'Me')),
    openBets: openBets.filter(b => b.splits?.some(s => s.name === 'Me')),
    todayBets: todayBets.filter(b => b.splits?.some(s => s.name === 'Me')),
  };

  // For each partner: their share metrics + balance with Me
  const partnerRows = partners
    .map(p => {
      const partnerClosed = closedBets.filter(b => b.splits?.some(s => s.name === p.name));
      const partnerOpen = openBets.filter(b => b.splits?.some(s => s.name === p.name));
      const partnerTodayBets = todayBets.filter(b => b.splits?.some(s => s.name === p.name));
      const lifetime = partnerClosed.reduce((sum, b) => sum + partnerPnL(b, p.name), 0);
      const exposure = partnerOpen.reduce((sum, b) => sum + partnerCost(b, p.name), 0);
      const today_ = partnerTodayBets.reduce((sum, b) => sum + partnerPnL(b, p.name), 0);
      const balRecord = partnerBalances.find(pb => pb.name === p.name);
      // Their balance flips sign vs how we display "I owe" — if their balance is positive (Me owes them), show positive
      const balance = balRecord ? balRecord.balance : 0;
      return {
        name: p.name,
        color: PARTNER_COLORS[p.name] || theme.teal,
        lifetimePnL: lifetime,
        openExposure: exposure,
        todayPnL: today_,
        balance,
        closedBets: partnerClosed,
        openBets: partnerOpen,
        todayBets: partnerTodayBets,
      };
    })
    .filter(r => r.closedBets.length > 0 || r.openBets.length > 0); // hide partners with no activity

  const rows = [meRow, ...partnerRows];

  const Cell = ({ label, value, color = theme.text, onClick, sub }) => (
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        padding: '6px 8px',
        flex: '1 1 0',
        minWidth: 0,
        borderRight: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 8, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color, ...tabularStyle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 1, ...tabularStyle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{
      background: theme.bgCard,
      borderBottom: `1px solid ${theme.border}`,
    }}>
      {/* Top bar: logo + actions */}
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.teal }} />
          <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.3 }}>PGA TRACKER</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={async () => {
              try {
                const lb = await fetchESPNLeaderboard();
                const matcher = (betTourn, espnTourn) => {
                  if (!betTourn || !espnTourn) return false;
                  const norm = (s) => s.toLowerCase().replace(/\s+/g, '').replace(/championship/, '');
                  return norm(betTourn).includes(norm(espnTourn).slice(0, 6)) ||
                         norm(espnTourn).includes(norm(betTourn).slice(0, 6));
                };
                const { bets: updated, changed } = applyLeaderboardToBets(bets, lb, matcher);
                if (changed > 0) {
                  setBets(updated);
                  alert(`Updated ${changed} positions from ${lb.tournament}.`);
                } else {
                  alert(`No matching open bets for ${lb.tournament}.`);
                }
              } catch (err) {
                alert(`Refresh failed: ${err.message}`);
              }
            }}
            style={btnSecondary()}
            title="Refresh leaderboard from ESPN"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowAdd(true)} style={btnPrimary()}>
            <Plus size={14} /> Add bet
          </button>
        </div>
      </div>

      {/* Per-person rows */}
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {rows.map((r, idx) => {
          const isLast = idx === rows.length - 1;
          const balanceColor = r.name === 'Me'
            ? (r.balance > 0 ? theme.yellow : r.balance < 0 ? theme.green : theme.text)
            : (r.balance > 0 ? theme.yellow : r.balance < 0 ? theme.green : theme.text);
          const balanceSub = r.name === 'Me'
            ? (r.balance > 0 ? `I owe partners` : r.balance < 0 ? `Partners owe me` : 'Settled')
            : (r.balance > 0 ? `I owe ${r.name}` : r.balance < 0 ? `${r.name} owes me` : 'Settled');
          return (
            <div
              key={r.name}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                borderBottom: isLast ? 'none' : `1px solid ${theme.border}`,
              }}
            >
              {/* Name pill — fixed width so all rows align */}
              <div style={{
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                borderRight: `1px solid ${theme.border}`,
                flexShrink: 0,
                width: 70,
                boxSizing: 'border-box',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: r.color, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.name}
                </div>
              </div>
              {/* Metrics — 4 in a row, fit available width */}
              <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                <Cell
                  label="P&L"
                  value={fmt(r.lifetimePnL, { sign: true })}
                  color={r.lifetimePnL >= 0 ? theme.green : theme.red}
                  onClick={() => r.closedBets.length > 0 && onDrill(`${r.name} — Lifetime P&L`, r.closedBets)}
                />
                <Cell
                  label="Open"
                  value={fmt(r.openExposure)}
                  onClick={() => r.openBets.length > 0 && onDrill(`${r.name} — Open Positions`, r.openBets)}
                />
                <Cell
                  label="Today"
                  value={fmt(r.todayPnL, { sign: true })}
                  color={r.todayPnL > 0 ? theme.green : r.todayPnL < 0 ? theme.red : theme.text}
                  onClick={() => r.todayBets.length > 0 && onDrill(`${r.name} — Today's Settled`, r.todayBets)}
                />
                <Cell
                  label="Bal"
                  value={fmt(Math.abs(r.balance))}
                  color={balanceColor}
                />
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <AddBetModal
          partners={partners}
          onClose={() => setShowAdd(false)}
          onSave={(bet) => { onAddBet(bet); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

// === Tabs ===
function Tabs({ active, onChange, closedCount }) {
  const tabs = [
    { id: 'live', label: 'Live' },
    { id: 'history', label: 'History' },
    { id: 'analytics', label: closedCount >= 10 ? 'Analytics' : `Analytics (${closedCount}/10)` },
    { id: 'partners', label: 'Partners' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <div style={{ background: theme.bgCard, borderBottom: `1px solid ${theme.border}`, position: 'sticky', top: 0, zIndex: 20, paddingTop: 'env(safe-area-inset-top, 0)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', padding: '0 12px' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: active === t.id ? `2px solid ${theme.teal}` : '2px solid transparent',
              color: active === t.id ? theme.text : theme.textMuted,
              fontSize: 13,
              fontWeight: active === t.id ? 600 : 500,
              cursor: 'pointer',
              fontFamily: fontStack,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// === Live Tab ===
function LiveTab({ bets, setBets, partners }) {
  const openBets = bets.filter(b => b.status === 'open');

  const closeBet = (id, outcome, sellPrice = null) => {
    setBets(bets.map(b => b.id === id ? {
      ...b,
      status: 'closed',
      outcome,
      sellPrice,
      closedDate: today(),
    } : b));
  };

  // Derive last-refresh from the freshest liveData timestamp across open bets
  const lastRefresh = useMemo(() => {
    const stamps = openBets.map(b => b.liveData?.lastUpdated).filter(Boolean);
    if (stamps.length === 0) return null;
    return stamps.sort().reverse()[0];
  }, [openBets]);

  // Sort: in-round/complete cards first by position; pre-round cards by tee time
  const sorted = useMemo(() => {
    const arr = [...openBets];
    arr.sort((a, b) => {
      const aPre = !a.liveData || a.liveData.status === 'pre-round';
      const bPre = !b.liveData || b.liveData.status === 'pre-round';
      if (aPre && !bPre) return 1;
      if (!aPre && bPre) return -1;
      if (aPre && bPre) {
        return (a.liveData?.teeTime || '').localeCompare(b.liveData?.teeTime || '');
      }
      // Both in-round: sort by position (parse numeric)
      const parsePos = (p) => {
        if (!p || p === '—') return 999;
        const m = String(p).match(/(\d+)/);
        return m ? parseInt(m[1]) : 999;
      };
      return parsePos(a.liveData?.position) - parsePos(b.liveData?.position);
    });
    return arr;
  }, [openBets]);

  if (openBets.length === 0) {
    return (
      <div style={{
        padding: '60px 20px',
        textAlign: 'center',
        color: theme.textMuted,
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
      }}>
        <div style={{ fontSize: 16, color: theme.text, marginBottom: 6 }}>No open positions</div>
        <div style={{ fontSize: 13 }}>Add a bet from the header, or share a Kalshi screenshot in chat.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: theme.textMuted }}>
          {openBets.length} open position{openBets.length !== 1 ? 's' : ''}
        </div>
        <div style={{ fontSize: 12, color: theme.textDim }}>
          {lastRefresh ? `Last refresh: ${lastRefresh}` : 'No leaderboard fetch yet — say "refresh" in chat'}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {sorted.map(b => (
          <LivePositionCard key={b.id} bet={b} onClose={closeBet} />
        ))}
      </div>
    </div>
  );
}

function LivePositionCard({ bet, onClose }) {
  const [showClose, setShowClose] = useState(false);
  const [sellPrice, setSellPrice] = useState('');
  const splitText = bet.splits?.length > 1
    ? bet.splits.map(s => `${s.name} ${s.pct}%`).join(' / ')
    : 'Solo';

  const live = bet.liveData || {};
  const rounds = bet.roundResults || [];
  const isPreRound = live.status === 'pre-round' || (!live.totalScore && live.totalScore !== 0 && rounds.length === 0);
  const isComplete = live.status === 'complete';
  const isBetweenRounds = live.status === 'between-rounds';
  const roundFinished = isComplete || isBetweenRounds;

  const fmtScore = (s) => {
    if (s === null || s === undefined) return '—';
    if (s === 0) return 'E';
    return s > 0 ? `+${s}` : `${s}`;
  };

  const scoreColor = (s) => {
    if (s === null || s === undefined) return theme.textMuted;
    if (s < 0) return theme.green;
    if (s > 0) return theme.red;
    return theme.text;
  };

  const trendIcon = () => {
    if (live.trend === 'improving') return <TrendingUp size={14} style={{ color: theme.green }} />;
    if (live.trend === 'fading') return <TrendingDown size={14} style={{ color: theme.red }} />;
    if (live.trend === 'holding') return <Minus size={14} style={{ color: theme.textMuted }} />;
    return null;
  };

  return (
    <div style={{
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: 16,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bet.player}</span>
            {trendIcon()}
          </div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bet.tournament}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: '50%' }}>
          {bet.splits?.filter(s => s.name !== 'Me').map(s => (
            <PartnerPill key={s.name} name={s.name} />
          ))}
          <Pill label={bet.marketType} />
        </div>
      </div>

      {/* Live status hero block */}
      <div style={{
        background: theme.bgElevated,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
      }}>
        {isPreRound ? (
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <div style={{ fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
              Pre-Round
            </div>
            <div style={{ fontSize: 14, color: theme.text, ...tabularStyle }}>
              Tees off {live.teeTime || 'TBD'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Pos</div>
              <div style={{ fontSize: 20, fontWeight: 700, ...tabularStyle }}>{live.position || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 700, ...tabularStyle, color: scoreColor(live.totalScore) }}>
                {fmtScore(live.totalScore)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                {roundFinished ? 'Final' : 'Thru'}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, ...tabularStyle }}>
                {roundFinished ? 'F' : (live.holesPlayed != null ? live.holesPlayed : '—')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Round-by-round grid — always shown to keep card heights consistent */}
      <div style={{ marginBottom: 10, fontSize: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          {[1, 2, 3, 4].map(r => <div key={r} style={{ textAlign: 'center' }}>R{r}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {[1, 2, 3, 4].map(r => {
            const round = rounds.find(x => x.round === r);
            const isCurrent = bet.liveData?.currentRound === r && bet.liveData?.status === 'in-round';
            return (
              <div key={r} style={{
                background: round || isCurrent ? theme.bgElevated : 'transparent',
                border: `1px solid ${round || isCurrent ? theme.border : theme.border + '40'}`,
                borderRadius: 6,
                padding: '6px 4px',
                textAlign: 'center',
                ...tabularStyle,
              }}>
                {round ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, color: scoreColor(round.score) }}>
                      {fmtScore(round.score)}
                    </div>
                    <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                      F
                    </div>
                  </>
                ) : isCurrent ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, color: scoreColor(bet.liveData?.todayScore) }}>
                      {fmtScore(bet.liveData?.todayScore)}
                    </div>
                    <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                      thru {bet.liveData?.holesPlayed || 0}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: theme.textDim }}>—</div>
                    <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>&nbsp;</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bet details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <KV label="Cost basis" value={fmt(bet.totalCost)} />
        <KV label="Max payout" value={fmt(bet.maxPayout)} />
        <KV label="My cost" value={fmt(myCost(bet))} />
        <KV label="My max" value={fmt(bet.maxPayout * (bet.splits?.find(s => s.name === 'Me')?.pct ?? 100) / 100)} />
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.border}`, fontSize: 11, color: theme.textMuted, display: 'flex', justifyContent: 'space-between' }}>
        <span>Stake: {splitText}</span>
        {live.lastUpdated && <span style={{ color: theme.textDim }} title={live.lastUpdated}>upd: {live.lastUpdated.split(' ')[1] || live.lastUpdated.slice(0, 10)}</span>}
      </div>

      {/* Action buttons */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        {!showClose ? (
          <>
            <button onClick={() => onClose(bet.id, 'won')} style={{ ...btnSecondary(), flex: 1, color: theme.green, borderColor: theme.green }}>
              Won
            </button>
            <button onClick={() => onClose(bet.id, 'lost')} style={{ ...btnSecondary(), flex: 1, color: theme.red, borderColor: theme.red }}>
              Lost
            </button>
            <button onClick={() => setShowClose(true)} style={{ ...btnSecondary(), flex: 1 }}>
              Sold
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <input
              type="number"
              placeholder="Sell ¢"
              value={sellPrice}
              onChange={e => setSellPrice(e.target.value)}
              style={inputStyle()}
              autoFocus
            />
            <button
              onClick={() => { if (sellPrice) { onClose(bet.id, 'sold', parseFloat(sellPrice)); setShowClose(false); }}}
              style={btnPrimary()}
            >
              <Check size={14} />
            </button>
            <button onClick={() => setShowClose(false)} style={btnSecondary()}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// === History Tab ===
function HistoryTab({ bets, setBets, onDrill }) {
  const closed = bets.filter(b => b.status === 'closed');
  const [sortBy, setSortBy] = useState('closedDate');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState({ player: '', tournament: '', marketType: '', outcome: '', partner: '' });

  const filtered = useMemo(() => {
    return closed.filter(b => {
      if (filter.player && !b.player?.toLowerCase().includes(filter.player.toLowerCase())) return false;
      if (filter.tournament && !b.tournament?.toLowerCase().includes(filter.tournament.toLowerCase())) return false;
      if (filter.marketType && b.marketType !== filter.marketType) return false;
      if (filter.outcome && b.outcome !== filter.outcome) return false;
      if (filter.partner && !b.splits?.some(s => s.name === filter.partner)) return false;
      return true;
    });
  }, [closed, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av, bv;
      if (sortBy === 'pnl') { av = myPnL(a); bv = myPnL(b); }
      else if (sortBy === 'cost') { av = myCost(a); bv = myCost(b); }
      else { av = a[sortBy] || ''; bv = b[sortBy] || ''; }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const exportCSV = () => {
    const headers = ['Tournament', 'Player', 'Market', 'Date', 'Outcome', 'Cost', 'Payout', 'Total P&L', 'My P&L', 'Splits'];
    const rows = sorted.map(b => [
      b.tournament,
      b.player,
      b.marketType,
      b.closedDate,
      b.outcome,
      (b.totalCost || 0).toFixed(2),
      (b.maxPayout || 0).toFixed(2),
      totalPnL(b).toFixed(2),
      myPnL(b).toFixed(2),
      b.splits?.map(s => `${s.name}:${s.pct}`).join('|') || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pga-bets-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSheets = () => {
    const headers = ['Tournament', 'Player', 'Market', 'Date', 'Outcome', 'Cost', 'Payout', 'Total P&L', 'My P&L', 'Splits'];
    const rows = sorted.map(b => [
      b.tournament, b.player, b.marketType, b.closedDate, b.outcome,
      (b.totalCost || 0).toFixed(2), (b.maxPayout || 0).toFixed(2),
      totalPnL(b).toFixed(2), myPnL(b).toFixed(2),
      b.splits?.map(s => `${s.name}:${s.pct}`).join('|') || '',
    ]);
    const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv);
    alert('Copied to clipboard as TSV. Paste directly into Google Sheets.');
  };

  if (closed.length === 0) {
    return (
      <div style={emptyStateStyle()}>
        <div style={{ fontSize: 16, color: theme.text, marginBottom: 6 }}>No settled bets yet</div>
        <div style={{ fontSize: 13 }}>Closed bets will appear here.</div>
      </div>
    );
  }

  const uniqueMarkets = [...new Set(closed.map(b => b.marketType).filter(Boolean))];
  const uniquePartners = [...new Set(closed.flatMap(b => b.splits?.map(s => s.name) || []).filter(n => n !== 'Me'))];

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input placeholder="Filter player…" value={filter.player} onChange={e => setFilter({ ...filter, player: e.target.value })} style={inputStyle()} />
        <input placeholder="Filter tournament…" value={filter.tournament} onChange={e => setFilter({ ...filter, tournament: e.target.value })} style={inputStyle()} />
        <select value={filter.marketType} onChange={e => setFilter({ ...filter, marketType: e.target.value })} style={inputStyle()}>
          <option value="">All markets</option>
          {uniqueMarkets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filter.outcome} onChange={e => setFilter({ ...filter, outcome: e.target.value })} style={inputStyle()}>
          <option value="">All outcomes</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="sold">Sold</option>
        </select>
        {uniquePartners.length > 0 && (
          <select value={filter.partner} onChange={e => setFilter({ ...filter, partner: e.target.value })} style={inputStyle()}>
            <option value="">All partners</option>
            {uniquePartners.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportCSV} style={btnSecondary()}><Download size={14} /> CSV</button>
          <button onClick={exportSheets} style={btnSecondary()}><Download size={14} /> Sheets</button>
        </div>
      </div>

      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 800 }}>
          <thead>
            <tr style={{ background: theme.bgElevated, borderBottom: `1px solid ${theme.border}` }}>
              {[
                ['closedDate', 'Date'],
                ['tournament', 'Tournament'],
                ['player', 'Player'],
                ['marketType', 'Market'],
                ['outcome', 'Outcome'],
                ['cost', 'My Cost'],
                ['pnl', 'My P&L'],
                [null, 'Actions'],
              ].map(([key, label]) => (
                <th key={label} onClick={() => key && toggleSort(key)} style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: theme.textMuted,
                  cursor: key ? 'pointer' : 'default',
                  fontWeight: 600,
                }}>
                  {label} {key && sortBy === key && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(b => {
              const pnl = myPnL(b);
              const reopenBet = (e) => {
                e.stopPropagation();
                if (!confirm(`Reopen this bet? It will move back to the Live tab.`)) return;
                setBets(bets.map(x => x.id === b.id ? {
                  ...x,
                  status: 'open',
                  outcome: null,
                  sellPrice: null,
                  closedDate: null,
                } : x));
              };
              const changeOutcome = (e) => {
                e.stopPropagation();
                const choice = prompt(`Change outcome for ${b.player}.\n\nType: won, lost, or sold\n(Currently: ${b.outcome})`, b.outcome || '');
                if (!choice) return;
                const normalized = choice.toLowerCase().trim();
                if (!['won', 'lost', 'sold'].includes(normalized)) {
                  alert('Invalid outcome. Must be won, lost, or sold.');
                  return;
                }
                let sellPrice = b.sellPrice;
                if (normalized === 'sold') {
                  const price = prompt('Sell price in cents per contract (e.g. 67):', b.sellPrice || '');
                  if (price === null) return;
                  sellPrice = parseFloat(price);
                  if (isNaN(sellPrice)) { alert('Invalid price'); return; }
                } else {
                  sellPrice = null;
                }
                setBets(bets.map(x => x.id === b.id ? {
                  ...x,
                  outcome: normalized,
                  sellPrice,
                } : x));
              };
              const deleteBet = (e) => {
                e.stopPropagation();
                if (!confirm(`Delete this bet permanently?\n\n${b.player} — ${b.tournament}\n\nThis cannot be undone.`)) return;
                setBets(bets.filter(x => x.id !== b.id));
              };
              return (
                <tr
                  key={b.id}
                  onClick={() => onDrill(`${b.player} — ${b.tournament}`, [b])}
                  style={{
                    borderBottom: `1px solid ${theme.border}`,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={tdStyle()}>{b.closedDate}</td>
                  <td style={tdStyle()}>{b.tournament}</td>
                  <td style={{ ...tdStyle(), fontWeight: 500 }}>{b.player}</td>
                  <td style={tdStyle()}><Pill label={b.marketType} small /></td>
                  <td style={tdStyle()}>
                    <OutcomePill outcome={b.outcome} sellPrice={b.sellPrice} />
                  </td>
                  <td style={{ ...tdStyle(), ...tabularStyle }}>{fmt(myCost(b))}</td>
                  <td style={{ ...tdStyle(), ...tabularStyle, color: pnl >= 0 ? theme.green : theme.red, fontWeight: 600 }}>
                    {fmt(pnl, { sign: true })}
                  </td>
                  <td style={tdStyle()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={reopenBet} title="Reopen bet (back to Live)" style={iconBtnStyle(theme.teal)}>↻</button>
                      <button onClick={changeOutcome} title="Change outcome" style={iconBtnStyle(theme.textMuted)}>✎</button>
                      <button onClick={deleteBet} title="Delete bet" style={iconBtnStyle(theme.red)}>×</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {sorted.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: theme.textMuted }}>
            No bets match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

// === Analytics Tab ===
function AnalyticsTab({ bets, onDrill }) {
  const closed = bets.filter(b => b.status === 'closed');

  if (closed.length < 10) {
    return (
      <div style={emptyStateStyle()}>
        <div style={{ fontSize: 16, color: theme.text, marginBottom: 6 }}>Analytics unlock after 10 settled bets</div>
        <div style={{ fontSize: 13 }}>Currently at {closed.length}.</div>
      </div>
    );
  }

  // P&L curve
  const sorted = [...closed].sort((a, b) => (a.closedDate || '').localeCompare(b.closedDate || ''));
  let running = 0;
  const curve = sorted.map(b => {
    running += myPnL(b);
    return { date: b.closedDate, pnl: running };
  });

  // ROI by market type
  const byMarket = {};
  closed.forEach(b => {
    const m = b.marketType || 'Unknown';
    if (!byMarket[m]) byMarket[m] = { cost: 0, pnl: 0, count: 0 };
    byMarket[m].cost += myCost(b);
    byMarket[m].pnl += myPnL(b);
    byMarket[m].count += 1;
  });
  const marketData = Object.entries(byMarket).map(([m, v]) => ({
    market: m,
    roi: v.cost > 0 ? (v.pnl / v.cost) * 100 : 0,
    count: v.count,
    pnl: v.pnl,
  }));

  // ROI by player
  const byPlayer = {};
  closed.forEach(b => {
    const p = b.player || 'Unknown';
    if (!byPlayer[p]) byPlayer[p] = { cost: 0, pnl: 0, count: 0 };
    byPlayer[p].cost += myCost(b);
    byPlayer[p].pnl += myPnL(b);
    byPlayer[p].count += 1;
  });
  const playerData = Object.entries(byPlayer)
    .map(([p, v]) => ({ player: p, roi: v.cost > 0 ? (v.pnl / v.cost) * 100 : 0, count: v.count, pnl: v.pnl, cost: v.cost }))
    .sort((a, b) => b.pnl - a.pnl);

  // Win rate vs implied probability buckets
  const buckets = [
    { range: '0-10¢', min: 0, max: 10, hits: 0, total: 0, expected: 0 },
    { range: '10-25¢', min: 10, max: 25, hits: 0, total: 0, expected: 0 },
    { range: '25-50¢', min: 25, max: 50, hits: 0, total: 0, expected: 0 },
    { range: '50-75¢', min: 50, max: 75, hits: 0, total: 0, expected: 0 },
    { range: '75-100¢', min: 75, max: 100, hits: 0, total: 0, expected: 0 },
  ];
  closed.forEach(b => {
    if (!b.entryPrice) return;
    const bk = buckets.find(x => b.entryPrice >= x.min && b.entryPrice < x.max);
    if (!bk) return;
    bk.total += 1;
    bk.expected += b.entryPrice;
    if (b.outcome === 'won') bk.hits += 1;
  });
  const probData = buckets.filter(b => b.total > 0).map(b => ({
    range: b.range,
    actual: (b.hits / b.total) * 100,
    implied: (b.expected / b.total),
    n: b.total,
  }));

  // Tournament summaries
  const byTournament = {};
  closed.forEach(b => {
    const t = b.tournament || 'Unknown';
    if (!byTournament[t]) byTournament[t] = { cost: 0, pnl: 0, count: 0, wins: 0 };
    byTournament[t].cost += myCost(b);
    byTournament[t].pnl += myPnL(b);
    byTournament[t].count += 1;
    if (b.outcome === 'won') byTournament[t].wins += 1;
  });
  const tournamentData = Object.entries(byTournament)
    .map(([t, v]) => ({ tournament: t, ...v }))
    .sort((a, b) => b.pnl - a.pnl);

  const bestBet = [...closed].sort((a, b) => myPnL(b) - myPnL(a))[0];
  const worstBet = [...closed].sort((a, b) => myPnL(a) - myPnL(b))[0];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="Lifetime P&L Curve (My Share)">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={curve}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
            <XAxis dataKey="date" stroke={theme.textMuted} fontSize={11} />
            <YAxis stroke={theme.textMuted} fontSize={11} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: theme.bgElevated, border: `1px solid ${theme.border}`, borderRadius: 6 }}
              labelStyle={{ color: theme.text }}
              formatter={(v) => [fmt(v, { sign: true }), 'Cumulative']}
            />
            <ReferenceLine y={0} stroke={theme.borderLight} />
            <Line type="monotone" dataKey="pnl" stroke={theme.teal} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
        <Card title="ROI by Market Type">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={marketData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
              <XAxis dataKey="market" stroke={theme.textMuted} fontSize={11} />
              <YAxis stroke={theme.textMuted} fontSize={11} tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: theme.bgElevated, border: `1px solid ${theme.border}`, borderRadius: 6 }}
                formatter={(v) => `${v.toFixed(1)}%`}
              />
              <Bar dataKey="roi" fill={theme.teal} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Win Rate vs Implied Probability">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={probData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
              <XAxis dataKey="range" stroke={theme.textMuted} fontSize={11} />
              <YAxis stroke={theme.textMuted} fontSize={11} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: theme.bgElevated, border: `1px solid ${theme.border}`, borderRadius: 6 }} />
              <Bar dataKey="implied" fill={theme.textDim} name="Implied" />
              <Bar dataKey="actual" fill={theme.teal} name="Actual" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="ROI by Player">
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                <th style={thStyle()}>Player</th>
                <th style={thStyle()}>Bets</th>
                <th style={thStyle()}>Cost</th>
                <th style={thStyle()}>P&L</th>
                <th style={thStyle()}>ROI</th>
              </tr>
            </thead>
            <tbody>
              {playerData.map(p => (
                <tr
                  key={p.player}
                  onClick={() => onDrill(`${p.player} — all bets`, closed.filter(b => b.player === p.player))}
                  style={{ borderBottom: `1px solid ${theme.border}`, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={tdStyle()}>{p.player}</td>
                  <td style={{ ...tdStyle(), ...tabularStyle }}>{p.count}</td>
                  <td style={{ ...tdStyle(), ...tabularStyle }}>{fmt(p.cost)}</td>
                  <td style={{ ...tdStyle(), ...tabularStyle, color: p.pnl >= 0 ? theme.green : theme.red }}>
                    {fmt(p.pnl, { sign: true })}
                  </td>
                  <td style={{ ...tdStyle(), ...tabularStyle, color: p.roi >= 0 ? theme.green : theme.red }}>
                    {p.roi.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Tournament Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {tournamentData.map(t => (
            <div
              key={t.tournament}
              onClick={() => onDrill(t.tournament, closed.filter(b => b.tournament === t.tournament))}
              style={{
                background: theme.bgElevated,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                padding: 12,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t.tournament}</div>
              <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>{t.count} bets · {t.wins} wins</div>
              <div style={{ fontSize: 16, fontWeight: 600, ...tabularStyle, color: t.pnl >= 0 ? theme.green : theme.red }}>
                {fmt(t.pnl, { sign: true })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <Card title="Best Bet">
          <div style={{ fontSize: 16, fontWeight: 600 }}>{bestBet.player}</div>
          <div style={{ fontSize: 12, color: theme.textMuted }}>{bestBet.tournament} · {bestBet.marketType}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: theme.green, ...tabularStyle, marginTop: 8 }}>
            {fmt(myPnL(bestBet), { sign: true })}
          </div>
        </Card>
        <Card title="Worst Bet">
          <div style={{ fontSize: 16, fontWeight: 600 }}>{worstBet.player}</div>
          <div style={{ fontSize: 12, color: theme.textMuted }}>{worstBet.tournament} · {worstBet.marketType}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: theme.red, ...tabularStyle, marginTop: 8 }}>
            {fmt(myPnL(worstBet), { sign: true })}
          </div>
        </Card>
      </div>
    </div>
  );
}

// === Partners Tab ===
function PartnersTab({ bets, partners, payments, setPayments, partnerBalances }) {
  const [selected, setSelected] = useState(partners[0]?.name || null);
  const [showLogPayment, setShowLogPayment] = useState(false);

  useEffect(() => {
    if (!selected && partners.length > 0) setSelected(partners[0].name);
  }, [partners, selected]);

  if (partners.length === 0) {
    return (
      <div style={emptyStateStyle()}>
        <div style={{ fontSize: 16, color: theme.text, marginBottom: 6 }}>No partners yet</div>
        <div style={{ fontSize: 13 }}>Add partners in Settings, or include them in bet splits.</div>
      </div>
    );
  }

  const partner = partners.find(p => p.name === selected);
  const partnerBets = bets.filter(b => b.splits?.some(s => s.name === selected));
  const closedPartnerBets = partnerBets.filter(b => b.status === 'closed');
  const openPartnerBets = partnerBets.filter(b => b.status === 'open');

  const capitalContributed = partnerBets.reduce((s, b) => s + partnerCost(b, selected), 0);
  const capitalOnOpen = openPartnerBets.reduce((s, b) => s + partnerCost(b, selected), 0);
  const realizedPnL = closedPartnerBets.reduce((s, b) => s + partnerPnL(b, selected), 0);

  const partnerPayments = payments.filter(p => p.partner === selected);
  const totalPaidTo = partnerPayments.filter(p => p.direction === 'to').reduce((s, p) => s + p.amount, 0);
  const totalPaidFrom = partnerPayments.filter(p => p.direction === 'from').reduce((s, p) => s + p.amount, 0);

  // Current balance: realized P&L owed to partner, minus what I've already paid them, plus what they've paid me
  const balance = realizedPnL - totalPaidTo + totalPaidFrom;

  const settle = () => {
    if (Math.abs(balance) < 0.01) {
      alert('Nothing to settle.');
      return;
    }
    const direction = balance > 0 ? 'to' : 'from';
    const amount = Math.abs(balance);
    setPayments([...payments, {
      id: `pay-${Date.now()}`,
      partner: selected,
      amount,
      direction,
      date: today(),
      note: 'Settle realized balance',
    }]);
  };

  const exportStatement = () => {
    const lines = [
      `STATEMENT — ${selected}`,
      `Generated: ${today()}`,
      ``,
      `Capital contributed (lifetime): ${fmt(capitalContributed)}`,
      `Capital currently at risk (open): ${fmt(capitalOnOpen)}`,
      `Realized P&L share: ${fmt(realizedPnL, { sign: true })}`,
      `Payments I've made to ${selected}: ${fmt(totalPaidTo)}`,
      `Payments ${selected} made to me: ${fmt(totalPaidFrom)}`,
      `Current balance: ${fmt(balance, { sign: true })} ${balance > 0 ? `(I owe ${selected})` : balance < 0 ? `(${selected} owes me)` : '(settled)'}`,
      ``,
      `--- BET HISTORY ---`,
      ...closedPartnerBets.map(b => {
        const split = b.splits.find(s => s.name === selected)?.pct || 0;
        return `${b.closedDate} · ${b.tournament} · ${b.player} (${b.marketType}) · ${split}% · ${fmt(partnerPnL(b, selected), { sign: true })}`;
      }),
      ``,
      `--- PAYMENT HISTORY ---`,
      ...partnerPayments.map(p => `${p.date} · ${p.direction === 'to' ? 'Paid to' : 'Received from'} ${selected}: ${fmt(p.amount)}${p.note ? ' · ' + p.note : ''}`),
    ];
    const txt = lines.join('\n');
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${selected}-${today()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selected || ''} onChange={e => setSelected(e.target.value)} style={inputStyle()}>
          {partners.map(p => {
            const bal = partnerBalances.find(b => b.name === p.name)?.balance || 0;
            return <option key={p.name} value={p.name}>{p.name} ({fmt(bal, { sign: true })})</option>;
          })}
        </select>
        <button onClick={settle} style={btnPrimary()}>Mark Settled</button>
        <button onClick={() => setShowLogPayment(true)} style={btnSecondary()}>+ Log Payment</button>
        <button onClick={exportStatement} style={btnSecondary()}><Download size={14} /> Export Statement</button>
        <button
          onClick={() => {
            const url = `${window.location.origin}/share/${encodeURIComponent(selected)}`;
            navigator.clipboard.writeText(url);
            alert(`Share link copied:\n${url}\n\nSend this to ${selected} — they'll see a read-only view of their ledger.`);
          }}
          style={btnSecondary()}
        >
          <Share2 size={14} /> Copy Share Link
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <SummaryCard label="Capital Contributed" value={fmt(capitalContributed)} />
        <SummaryCard label="Capital On Open Bets" value={fmt(capitalOnOpen)} />
        <SummaryCard label="Realized P&L" value={fmt(realizedPnL, { sign: true })} color={realizedPnL >= 0 ? theme.green : theme.red} />
        <SummaryCard
          label="Current Balance"
          value={fmt(balance, { sign: true })}
          color={balance > 0 ? theme.yellow : balance < 0 ? theme.green : theme.text}
          sub={balance > 0 ? `I owe ${selected}` : balance < 0 ? `${selected} owes me` : 'Settled'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Bet History with {selected}
          </div>
          {partnerBets.length === 0 ? (
            <div style={{ padding: 24, color: theme.textMuted, fontSize: 13 }}>No bets with {selected} yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ background: theme.bgElevated }}>
                  <th style={thStyle()}>Date</th>
                  <th style={thStyle()}>Tournament</th>
                  <th style={thStyle()}>Player</th>
                  <th style={thStyle()}>Split</th>
                  <th style={thStyle()}>Status</th>
                  <th style={thStyle()}>P&L (theirs)</th>
                </tr>
              </thead>
              <tbody>
                {partnerBets.map(b => {
                  const split = b.splits.find(s => s.name === selected)?.pct || 0;
                  const pnl = partnerPnL(b, selected);
                  return (
                    <tr key={b.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
                      <td style={tdStyle()}>{b.closedDate || b.entryDate || '—'}</td>
                      <td style={tdStyle()}>{b.tournament}</td>
                      <td style={tdStyle()}>{b.player}</td>
                      <td style={{ ...tdStyle(), ...tabularStyle }}>{split}%</td>
                      <td style={tdStyle()}>
                        {b.status === 'closed'
                          ? <OutcomePill outcome={b.outcome} sellPrice={b.sellPrice} />
                          : <Pill label="OPEN" small />}
                      </td>
                      <td style={{ ...tdStyle(), ...tabularStyle, color: pnl >= 0 ? theme.green : theme.red }}>
                        {b.status === 'closed' ? fmt(pnl, { sign: true }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Payment History
          </div>
          {partnerPayments.length === 0 ? (
            <div style={{ padding: 24, color: theme.textMuted, fontSize: 13 }}>No payments logged.</div>
          ) : (
            <div>
              {partnerPayments.slice().reverse().map(p => (
                <div key={p.id} style={{ padding: '10px 16px', borderBottom: `1px solid ${theme.border}`, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: theme.textMuted }}>{p.date}</span>
                    <span style={{ fontWeight: 600, color: p.direction === 'to' ? theme.red : theme.green, ...tabularStyle }}>
                      {p.direction === 'to' ? '−' : '+'}{fmt(p.amount)}
                    </span>
                  </div>
                  <div style={{ color: theme.textDim, fontSize: 11, marginTop: 2 }}>
                    {p.direction === 'to' ? `Paid to ${selected}` : `Received from ${selected}`}{p.note ? ` — ${p.note}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLogPayment && (
        <LogPaymentModal
          partner={selected}
          onClose={() => setShowLogPayment(false)}
          onSave={(payment) => {
            setPayments([...payments, payment]);
            setShowLogPayment(false);
          }}
        />
      )}
    </div>
  );
}

function LogPaymentModal({ partner, onClose, onSave }) {
  const [direction, setDirection] = useState('to');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');

  const submit = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { alert('Enter a positive amount.'); return; }
    onSave({
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      partner,
      amount: amt,
      direction,
      date,
      note: note.trim(),
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12,
        padding: 20, maxWidth: 440, width: '100%',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Log Payment — {partner}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Direction">
            <select value={direction} onChange={e => setDirection(e.target.value)} style={inputStyle()}>
              <option value="to">I paid {partner}</option>
              <option value="from">{partner} paid me</option>
            </select>
          </FormField>
          <FormField label="Amount ($)">
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={inputStyle()} placeholder="0.00" autoFocus />
          </FormField>
          <FormField label="Date">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle()} />
          </FormField>
          <FormField label="Note (optional)">
            <input value={note} onChange={e => setNote(e.target.value)} style={inputStyle()} placeholder="e.g. Venmo, Cadillac winnings, capital for Truist" />
          </FormField>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} style={btnSecondary()}>Cancel</button>
            <button onClick={submit} style={btnPrimary()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// === Settings Tab ===
function SettingsTab({ settings, setSettings, partners, setPartners, bets, setBets, payments, setPayments }) {
  const [newPartner, setNewPartner] = useState('');
  const [newSplit, setNewSplit] = useState('');
  const [showAddBet, setShowAddBet] = useState(false);

  const addPartner = () => {
    if (!newPartner.trim()) return;
    if (partners.some(p => p.name === newPartner.trim())) { alert('Already exists'); return; }
    setPartners([...partners, { name: newPartner.trim() }]);
    setNewPartner('');
  };

  const removePartner = (name) => {
    if (bets.some(b => b.splits?.some(s => s.name === name))) {
      if (!confirm(`${name} appears in bet history. Remove anyway? (Bets remain unchanged.)`)) return;
    }
    setPartners(partners.filter(p => p.name !== name));
  };

  const addSplit = () => {
    if (!newSplit.trim()) return;
    setSettings({ ...settings, defaultSplits: [...(settings.defaultSplits || []), newSplit.trim()] });
    setNewSplit('');
  };

  const exportAll = () => {
    const data = { bets, partners, payments, settings, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pga-tracker-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAll = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!confirm(`Restore ${data.bets?.length || 0} bets, ${data.partners?.length || 0} partners, ${data.payments?.length || 0} payments? Current data will be replaced.`)) return;
        if (data.bets) setBets(data.bets);
        if (data.partners) setPartners(data.partners);
        if (data.payments) setPayments(data.payments);
        if (data.settings) setSettings(data.settings);
        alert('Restored.');
      } catch (err) {
        alert('Invalid backup file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
      <Card title="Bankroll">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: theme.textMuted }}>$</span>
          <input
            type="number"
            value={settings.bankroll || ''}
            onChange={e => setSettings({ ...settings, bankroll: parseFloat(e.target.value) || 0 })}
            style={{ ...inputStyle(), flex: 1 }}
            placeholder="Total bankroll"
          />
        </div>
      </Card>

      <Card title="Partners">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            placeholder="Add partner name…"
            value={newPartner}
            onChange={e => setNewPartner(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPartner()}
            style={{ ...inputStyle(), flex: 1 }}
          />
          <button onClick={addPartner} style={btnPrimary()}>Add</button>
        </div>
        {partners.length === 0 ? (
          <div style={{ color: theme.textMuted, fontSize: 13 }}>No partners yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {partners.map(p => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: theme.bgElevated, borderRadius: 6 }}>
                <span>{p.name}</span>
                <button onClick={() => removePartner(p.name)} style={{ ...btnSecondary(), padding: '4px 8px', color: theme.red }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Default Split Presets">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            placeholder='e.g. "Me 60 / Alex 40"'
            value={newSplit}
            onChange={e => setNewSplit(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSplit()}
            style={{ ...inputStyle(), flex: 1 }}
          />
          <button onClick={addSplit} style={btnPrimary()}>Add</button>
        </div>
        {(settings.defaultSplits || []).length === 0 ? (
          <div style={{ color: theme.textMuted, fontSize: 13 }}>No presets yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(settings.defaultSplits || []).map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: theme.bgElevated, borderRadius: 6 }}>
                <span style={{ fontSize: 13 }}>{s}</span>
                <button onClick={() => setSettings({ ...settings, defaultSplits: settings.defaultSplits.filter((_, j) => j !== i) })} style={{ ...btnSecondary(), padding: '4px 8px', color: theme.red }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Google Sheets Export">
        <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.5 }}>
          Use the "Sheets" button on the History tab to copy bets as TSV, then paste directly into a Google Sheet. (Direct API integration would require a connector.)
        </div>
      </Card>

      <Card title="Manual Bet Entry">
        <button onClick={() => setShowAddBet(true)} style={{ ...btnPrimary(), width: '100%' }}>
          <Plus size={14} /> Add bet manually
        </button>
        {showAddBet && (
          <AddBetModal
            partners={partners}
            onClose={() => setShowAddBet(false)}
            onSave={(bet) => {
              const existingNames = new Set(partners.map(p => p.name.toLowerCase()));
              existingNames.add('me');
              const newPartnerNames = (bet.splits || [])
                .map(s => s.name)
                .filter(name => name && !existingNames.has(name.toLowerCase()));
              if (newPartnerNames.length > 0) {
                setPartners([...partners, ...newPartnerNames.map(name => ({ name, defaultSplit: null }))]);
              }
              setBets([...bets, bet]);
              setShowAddBet(false);
            }}
          />
        )}
      </Card>

      <Card title="Backup & Restore">
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <button onClick={exportAll} style={btnSecondary()}>
            <Download size={14} /> Export Full Backup (JSON)
          </button>
          <label style={{ ...btnSecondary(), cursor: 'pointer', display: 'inline-flex', justifyContent: 'center' }}>
            <input type="file" accept=".json" onChange={importAll} style={{ display: 'none' }} />
            Restore from Backup
          </label>
          <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4, lineHeight: 1.4 }}>
            ⚠ Storage in this artifact isn't a true backup. Export at the end of every tournament.
          </div>
        </div>
      </Card>
    </div>
  );
}

// === Add Bet Modal ===
function FormField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Card({ title, children, style = {} }) {
  return (
    <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16, ...style }}>
      <div style={{ fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function AddBetModal({ partners, onClose, onSave, initial = null }) {  const [form, setForm] = useState(initial || {
    player: '',
    tournament: '',
    marketType: 'Outright',
    entryPrice: '',
    contracts: '',
    totalCost: '',
    maxPayout: '',
    splits: [{ name: 'Me', pct: 100 }],
    status: 'open',
    outcome: 'won',
    sellPrice: '',
    closedDate: today(),
    entryDate: today(),
    notes: '',
  });

  const [splitText, setSplitText] = useState(
    initial?.splits?.map(s => `${s.name} ${s.pct}`).join(' / ') || 'Me 100'
  );

  const parseSplits = (text) => {
    // Accept /, comma, or " and " as separators between split entries
    const parts = text
      .split(/\s*[/,]\s*|\s+and\s+/i)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    // Try to parse each entry as "Name N" or "Name N%" first
    const parsed = parts.map(p => {
      const m = p.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*%?$/);
      if (m) return { name: m[1].trim(), pct: parseFloat(m[2]), hasPct: true };
      // No number — just a name
      if (p.length > 0) return { name: p.trim(), pct: null, hasPct: false };
      return null;
    }).filter(Boolean);

    if (parsed.length === 0) return null;

    const allHavePct = parsed.every(p => p.hasPct);
    const nonHavePct = parsed.every(p => !p.hasPct);

    if (nonHavePct) {
      // Pure name list — distribute evenly. Round to integers, give remainder to first.
      const base = Math.floor(100 / parsed.length);
      const remainder = 100 - base * parsed.length;
      const splits = parsed.map((p, i) => ({ name: p.name, pct: base + (i === 0 ? remainder : 0) }));
      return { splits };
    }

    if (!allHavePct) {
      return { error: 'Either give percentages for everyone (e.g. "Me 50 / Bird 50") or just names to auto-split evenly (e.g. "Me, Bird, Joey C").' };
    }

    const splits = parsed.map(p => ({ name: p.name, pct: p.pct }));
    const total = splits.reduce((s, x) => s + x.pct, 0);
    if (Math.abs(total - 100) > 0.1) return { error: `Splits total ${total}%, must equal 100%.` };
    return { splits };
  };

  const submit = () => {
    const parsed = parseSplits(splitText);
    if (!parsed) { alert('Splits format unrecognized.\n\nExamples that work:\n  Me 100\n  Me 50 / Bird 50\n  Me 33, Bird 33, Joey C 34\n  Me 33 and Bird 33 and Joey C 34'); return; }
    if (parsed.error) { alert(parsed.error); return; }
    const splits = parsed.splits;
    if (!form.player || !form.tournament || !form.totalCost) { alert('Player, tournament, and cost required.'); return; }
    onSave({
      ...form,
      id: initial?.id || `bet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      splits,
      entryPrice: parseFloat(form.entryPrice) || null,
      contracts: parseInt(form.contracts) || null,
      totalCost: parseFloat(form.totalCost) || 0,
      maxPayout: parseFloat(form.maxPayout) || 0,
      sellPrice: form.outcome === 'sold' ? parseFloat(form.sellPrice) || 0 : null,
    });
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: 24,
        maxWidth: 560,
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Add Bet</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <FormField label="Player"><input value={form.player} onChange={e => setForm({ ...form, player: e.target.value })} style={inputStyle()} /></FormField>
          <FormField label="Tournament"><input value={form.tournament} onChange={e => setForm({ ...form, tournament: e.target.value })} style={inputStyle()} /></FormField>
          <FormField label="Market type">
            <input
              list="market-type-options"
              value={form.marketType}
              onChange={e => setForm({ ...form, marketType: e.target.value })}
              style={inputStyle()}
              placeholder="e.g. Outright, Top 10, H2H"
            />
            <datalist id="market-type-options">
              <option value="Outright" />
              <option value="Top 3" />
              <option value="Top 5" />
              <option value="Top 10" />
              <option value="Top 20" />
              <option value="R1 Leader" />
              <option value="R2 Leader" />
              <option value="R3 Leader" />
              <option value="R4 Leader" />
              <option value="36-Hole Leader" />
              <option value="54-Hole Leader" />
              <option value="Make Cut" />
              <option value="Miss Cut" />
              <option value="H2H" />
              <option value="3-Ball" />
              <option value="Nationality" />
              <option value="First-Round 6-shooter" />
            </datalist>
          </FormField>
          <FormField label="Status">
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inputStyle()}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </FormField>
          <FormField label="Entry price (¢)"><input type="number" value={form.entryPrice} onChange={e => setForm({ ...form, entryPrice: e.target.value })} style={inputStyle()} /></FormField>
          <FormField label="# contracts"><input type="number" value={form.contracts} onChange={e => setForm({ ...form, contracts: e.target.value })} style={inputStyle()} /></FormField>
          <FormField label="Total cost ($)"><input type="number" step="0.01" value={form.totalCost} onChange={e => setForm({ ...form, totalCost: e.target.value })} style={inputStyle()} /></FormField>
          <FormField label="Max payout ($)"><input type="number" step="0.01" value={form.maxPayout} onChange={e => setForm({ ...form, maxPayout: e.target.value })} style={inputStyle()} /></FormField>
          <FormField label="Splits">
            <input value={splitText} onChange={e => setSplitText(e.target.value)} style={inputStyle()} placeholder="Me, Bird, Joey C  (auto-even)  OR  Me 50 / Bird 50" />
          </FormField>
          <FormField label="Entry date"><input type="date" value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} style={inputStyle()} /></FormField>
          {form.status === 'closed' && (
            <>
              <FormField label="Outcome">
                <select value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })} style={inputStyle()}>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="sold">Sold early</option>
                </select>
              </FormField>
              <FormField label="Closed date"><input type="date" value={form.closedDate} onChange={e => setForm({ ...form, closedDate: e.target.value })} style={inputStyle()} /></FormField>
              {form.outcome === 'sold' && (
                <FormField label="Sell price (¢)"><input type="number" value={form.sellPrice} onChange={e => setForm({ ...form, sellPrice: e.target.value })} style={inputStyle()} /></FormField>
              )}
            </>
          )}
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnSecondary()}>Cancel</button>
          <button onClick={submit} style={btnPrimary()}>Save Bet</button>
        </div>
      </div>
    </div>
  );
}

// === Drill-down modal ===
function DrillModal({ title, bets, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderRadius: 12, padding: 24, maxWidth: 720, width: '100%',
        maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {bets.length === 0 ? (
          <div style={{ color: theme.textMuted }}>No bets.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bets.map(b => {
              const pnl = myPnL(b);
              return (
                <div key={b.id} style={{ background: theme.bgElevated, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{b.player}</div>
                      <div style={{ fontSize: 12, color: theme.textMuted }}>{b.tournament} · {b.marketType} · {b.closedDate || b.entryDate}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {b.status === 'closed' ? (
                        <div style={{ fontSize: 16, fontWeight: 600, color: pnl >= 0 ? theme.green : theme.red, ...tabularStyle }}>
                          {fmt(pnl, { sign: true })}
                        </div>
                      ) : (
                        <Pill label="OPEN" small />
                      )}
                      <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>cost {fmt(myCost(b))}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: theme.textMuted }}>
                    Entry {fmtCents(b.entryPrice)} · {b.contracts || '?'} contracts · {b.splits?.map(s => `${s.name} ${s.pct}%`).join(' / ')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// === Small components / styles ===
function Pill({ label, small }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '1px 5px' : '2px 6px',
      background: theme.bgElevated,
      border: `1px solid ${theme.border}`,
      borderRadius: 4,
      fontSize: small ? 9 : 10,
      color: theme.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// Per-partner color mapping. Add new partners here as needed.
const PARTNER_COLORS = {
  Bird: theme.yellow,
};

function PartnerPill({ name }) {
  const color = PARTNER_COLORS[name] || theme.teal;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 6px',
      background: 'transparent',
      border: `1px solid ${color}`,
      borderRadius: 4,
      fontSize: 10,
      color: color,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>{name}</span>
  );
}

function OutcomePill({ outcome, sellPrice }) {
  const map = {
    won: { label: 'WON', color: theme.green },
    lost: { label: 'LOST', color: theme.red },
    sold: { label: sellPrice ? `SOLD ${sellPrice}¢` : 'SOLD', color: theme.yellow },
  };
  const o = map[outcome] || { label: outcome?.toUpperCase() || '—', color: theme.textMuted };
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 8px',
      background: 'transparent',
      border: `1px solid ${o.color}`,
      borderRadius: 4,
      fontSize: 10,
      color: o.color,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontWeight: 600,
    }}>{o.label}</span>
  );
}

function KV({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, ...tabularStyle, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, color = theme.text, sub }) {
  return (
    <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, ...tabularStyle }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const btnPrimary = () => ({
  background: theme.teal,
  color: '#000',
  border: 'none',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: fontStack,
});

const btnSecondary = () => ({
  background: 'transparent',
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: fontStack,
});

const iconBtnStyle = (color = '#fff') => ({
  background: 'transparent',
  color,
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  padding: '2px 8px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: fontStack,
  lineHeight: 1.2,
  minWidth: 28,
});

const inputStyle = () => ({
  background: theme.bgElevated,
  color: theme.text,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: fontStack,
  outline: 'none',
});

const thStyle = () => ({
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: theme.textMuted,
  fontWeight: 600,
});

const tdStyle = () => ({
  padding: '10px 12px',
  fontSize: 13,
});

const emptyStateStyle = () => ({
  padding: '60px 20px',
  textAlign: 'center',
  color: theme.textMuted,
  background: theme.bgCard,
  border: `1px solid ${theme.border}`,
  borderRadius: 12,
});
