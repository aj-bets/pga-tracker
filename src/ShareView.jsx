import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { storage } from './storage.js';

const theme = {
  bg: '#0a0a0a',
  bgCard: '#141414',
  bgElevated: '#1a1a1a',
  border: '#262626',
  text: '#ffffff',
  textMuted: '#a3a3a3',
  textDim: '#737373',
  teal: '#00d4aa',
  green: '#00e676',
  red: '#ff5252',
  yellow: '#ffb74d',
};
const fontStack = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
const tabularStyle = { fontVariantNumeric: 'tabular-nums' };

const fmt = (n, opts = {}) => {
  const { sign = false } = opts;
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  const abs = Math.abs(n);
  const str = `$${abs.toFixed(2)}`;
  if (sign && n > 0) return `+${str}`;
  if (n < 0) return `-${str}`;
  return str;
};

function totalPnL(bet) {
  if (bet.status !== 'closed') return 0;
  if (bet.outcome === 'won') return (bet.maxPayout || 0) - (bet.totalCost || 0);
  if (bet.outcome === 'lost') return -(bet.totalCost || 0);
  if (bet.outcome === 'sold') {
    const proceeds = ((bet.sellPrice || 0) * (bet.contracts || 0)) / 100;
    return proceeds - (bet.totalCost || 0);
  }
  return 0;
}

async function loadJson(key) {
  try {
    const r = await storage.get(key);
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}

export default function ShareView() {
  const { partnerName } = useParams();
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    (async () => {
      const [b, p] = await Promise.all([
        loadJson('pga:bets'),
        loadJson('pga:payments'),
      ]);
      setBets(b || []);
      setPayments(p || []);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: fontStack, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: theme.textMuted }}>Loading…</div>
      </div>
    );
  }

  const partnerBets = bets.filter(b => b.splits?.some(s => s.name.toLowerCase() === partnerName.toLowerCase()));
  const partnerPayments = payments.filter(p => p.partner?.toLowerCase() === partnerName.toLowerCase());
  const matchedName = partnerBets[0]?.splits.find(s => s.name.toLowerCase() === partnerName.toLowerCase())?.name || partnerName;

  const closedBets = partnerBets.filter(b => b.status === 'closed');
  const openBets = partnerBets.filter(b => b.status === 'open');

  const pctFor = (bet) => bet.splits.find(s => s.name === matchedName)?.pct || 0;
  const partnerPnL = (bet) => totalPnL(bet) * pctFor(bet) / 100;
  const partnerCost = (bet) => (bet.totalCost || 0) * pctFor(bet) / 100;

  const realizedPnL = closedBets.reduce((s, b) => s + partnerPnL(b), 0);
  const capitalOnOpen = openBets.reduce((s, b) => s + partnerCost(b), 0);
  const totalPaidTo = partnerPayments.filter(p => p.direction === 'to').reduce((s, p) => s + p.amount, 0);
  const totalPaidFrom = partnerPayments.filter(p => p.direction === 'from').reduce((s, p) => s + p.amount, 0);
  const balance = realizedPnL - totalPaidTo + totalPaidFrom;

  const Cell = ({ label, value, color = theme.text, sub }) => (
    <div style={{ flex: 1, padding: '14px 16px', borderRight: `1px solid ${theme.border}`, minWidth: 140 }}>
      <div style={{ fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color, ...tabularStyle }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: fontStack, fontSize: 14 }}>
      <div style={{ background: theme.bgCard, borderBottom: `1px solid ${theme.border}`, padding: '12px 16px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.yellow }} />
          <div style={{ fontWeight: 700, letterSpacing: 0.3 }}>{matchedName.toUpperCase()} — STATEMENT</div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: theme.textDim }}>READ ONLY · view from owner</div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
        <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, display: 'flex', flexWrap: 'wrap', marginBottom: 16 }}>
          <Cell label="Realized P&L" value={fmt(realizedPnL, { sign: true })} color={realizedPnL >= 0 ? theme.green : theme.red} />
          <Cell label="Capital on Open Bets" value={fmt(capitalOnOpen)} sub={`${openBets.length} open`} />
          <Cell label="Current Balance" value={fmt(Math.abs(balance))}
                color={balance > 0 ? theme.yellow : balance < 0 ? theme.green : theme.text}
                sub={balance > 0 ? `Owner owes ${matchedName}` : balance < 0 ? `${matchedName} owes owner` : 'Settled'} />
        </div>

        <Section title="Bet History">
          {partnerBets.length === 0 ? (
            <div style={{ padding: 20, color: theme.textMuted }}>No bets yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: theme.bgElevated, borderBottom: `1px solid ${theme.border}` }}>
                  {['Date', 'Tournament', 'Player', 'Market', 'Split', 'Status', 'Their P&L'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partnerBets.slice().reverse().map(b => {
                  const pnl = partnerPnL(b);
                  return (
                    <tr key={b.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
                      <td style={{ padding: '10px 12px' }}>{b.closedDate || b.entryDate || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{b.tournament}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{b.player}</td>
                      <td style={{ padding: '10px 12px' }}>{b.marketType}</td>
                      <td style={{ padding: '10px 12px', ...tabularStyle }}>{pctFor(b)}%</td>
                      <td style={{ padding: '10px 12px' }}>
                        {b.status === 'open' ? 'Open' : (b.outcome || '').toUpperCase()}
                      </td>
                      <td style={{ padding: '10px 12px', ...tabularStyle, color: pnl >= 0 ? theme.green : theme.red, fontWeight: 600 }}>
                        {b.status === 'closed' ? fmt(pnl, { sign: true }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        <div style={{ height: 12 }} />

        <Section title="Payment History">
          {partnerPayments.length === 0 ? (
            <div style={{ padding: 20, color: theme.textMuted }}>No payments logged.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: theme.bgElevated, borderBottom: `1px solid ${theme.border}` }}>
                  {['Date', 'Direction', 'Amount', 'Note'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partnerPayments.slice().reverse().map(p => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
                    <td style={{ padding: '10px 12px' }}>{p.date}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {p.direction === 'to' ? `Owner → ${matchedName}` : `${matchedName} → Owner`}
                    </td>
                    <td style={{ padding: '10px 12px', ...tabularStyle, color: p.direction === 'to' ? theme.green : theme.red, fontWeight: 600 }}>
                      {fmt(p.amount)}
                    </td>
                    <td style={{ padding: '10px 12px', color: theme.textMuted }}>{p.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</div>
      {children}
    </div>
  );
}
