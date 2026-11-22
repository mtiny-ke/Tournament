// Tournament engine – same rules as the Excel workbook.
// 48 players, 12 groups (A-L) of 4, best-of-3 matches, win = 3 pts.
const GL = 'ABCDEFGHIJKL'.split('');
const PAIRS = [[1, 2], [3, 4], [1, 3], [2, 4], [1, 4], [2, 3]];
const RN = { R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final' };

const validScore = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a <= 2 && b <= 2 && ((a === 2) !== (b === 2));

function compute(players, results, opts = {}) {
  const PTS = opts.pointsPerWin || 3;
  const byId = new Map(players.map(p => [p.id, p]));
  const slot = {}; // "A-1" -> player
  players.forEach(p => { if (p.grp && p.slot) slot[`${p.grp}-${p.slot}`] = p; });
  const res = id => (results[id] && validScore(results[id].f1, results[id].f2)) ? results[id] : null;

  // ---- group matches ----
  const matches = [];
  const stats = new Map(players.map(p => [p.id, { w: 0, l: 0, ff: 0, fa: 0 }]));
  const groupDone = {};
  GL.forEach(g => {
    let valid = 0;
    PAIRS.forEach(([s1, s2], j) => {
      const a = slot[`${g}-${s1}`], b = slot[`${g}-${s2}`];
      const id = `G-${g}-${j + 1}`;
      const r = a && b ? res(id) : null;
      matches.push({ id, round: 'Group ' + g, stage: 'group', p1: a ? a.id : null, p2: b ? b.id : null, result: r });
      if (r) {
        valid++;
        const sa = stats.get(a.id), sb = stats.get(b.id);
        sa.ff += r.f1; sa.fa += r.f2; sb.ff += r.f2; sb.fa += r.f1;
        if (r.f1 > r.f2) { sa.w++; sb.l++; } else { sb.w++; sa.l++; }
      }
    });
    groupDone[g] = [1, 2, 3, 4].every(s => slot[`${g}-${s}`]) && valid === 6;
  });
  const key = p => { const s = stats.get(p.id); return s.w * PTS * 1e6 + (s.ff - s.fa + 20) * 1e4 + s.ff * 100 + s.w * 10 + (p.tiebreak || 0); };
  const tables = GL.map(g => {
    const rows = [1, 2, 3, 4].map(s => slot[`${g}-${s}`]).filter(Boolean).map(p => {
      const s = stats.get(p.id);
      return { id: p.id, name: p.name, slot: p.slot, played: s.w + s.l, won: s.w, lost: s.l, ff: s.ff, fa: s.fa, gd: s.ff - s.fa, pts: s.w * PTS, key: key(p) };
    });
    rows.sort((x, y) => y.key - x.key || x.slot - y.slot);
    rows.forEach((r, i) => { r.pos = i + 1; r.tie = rows.some(o => o !== r && o.key === r.key); });
    return { group: g, complete: groupDone[g], rows };
  });
  const ready = players.length === 48 && GL.every(g => groupDone[g]);

  // ---- qualifiers & draw ----
  let q = null, byMatch = {};
  const ko = [];
  if (ready) {
    const W = {}, R = {}, T = {};
    tables.forEach(t => { W[t.group] = t.rows[0].id; R[t.group] = t.rows[1].id; T[t.group] = t.rows[2]; });
    const thirds = GL.map((g, i) => ({ g, i, row: T[g] }));
    const ranked = [...thirds].sort((a, b) => b.row.key - a.row.key || a.i - b.i);
    const qual = new Set(ranked.slice(0, 8).map(x => x.g));
    const wildcardTie = ranked[7].row.key === ranked[8].row.key;
    const list = thirds.filter(x => qual.has(x.g)); // group order
    let shift = 0;
    for (; shift < 8; shift++) if (list.every((x, i) => Math.floor(((i + shift) % 8) / 2) !== Math.floor(x.i / 3))) break;
    const podThird = {};
    list.forEach((x, i) => { podThird[((i + shift) % 8) + 1] = x.row.id; });
    q = { thirds: ranked.map((x, i) => ({ group: x.g, id: x.row.id, name: x.row.name, pts: x.row.pts, gd: x.row.gd, ff: x.row.ff, qualified: i < 8 })), wildcardTie, shift };
    const gi = g => GL.indexOf(g);
    const gAt = n => GL[n - 1];
    const defs = [];
    for (let f = 1; f <= 4; f++) {
      const a = gAt(3 * f - 2), b = gAt(3 * f - 1), c = gAt(3 * f);
      defs[4 * f - 3] = [W[a], podThird[2 * f - 1], 2 * f - 1];
      defs[4 * f - 2] = [W[b], R[c], 2 * f - 1];
      defs[4 * f - 1] = [W[c], podThird[2 * f], 2 * f];
      defs[4 * f] = [R[a], R[b], 2 * f];
    }
    for (let m = 1; m <= 16; m++) ko.push({ id: `R32-${m}`, stage: 'R32', round: RN.R32, p1: defs[m][0], p2: defs[m][1], pod: defs[m][2] });
  }
  const mk = (id, stage, round, f1, f2) => ({ id, stage, round, f1, f2 });
  if (ready) {
    for (let p = 1; p <= 8; p++) ko.push(mk(`R16-${p}`, 'R16', RN.R16, `R32-${2 * p - 1}`, `R32-${2 * p}`));
    for (let k = 1; k <= 4; k++) ko.push(mk(`QF-${k}`, 'QF', RN.QF, `R16-${2 * k - 1}`, `R16-${2 * k}`));
    for (let s = 1; s <= 2; s++) ko.push(mk(`SF-${s}`, 'SF', RN.SF, `QF-${2 * s - 1}`, `QF-${2 * s}`));
    ko.push(mk('FINAL', 'FINAL', 'Final', 'SF-1', 'SF-2'));
    ko.push(mk('3RD', '3RD', '3rd place playoff', 'SF-1', 'SF-2'));
    ko.forEach(m => {
      if (m.f1) {
        const w = x => byMatch[x] && byMatch[x].winner, l = x => byMatch[x] && byMatch[x].loser;
        const third = m.id === '3RD';
        m.p1 = (third ? l : w)(m.f1) || null; m.p2 = (third ? l : w)(m.f2) || null;
      }
      m.result = (m.p1 && m.p2) ? res(m.id) : null;
      if (m.result) { const a = m.result.f1 > m.result.f2; m.winner = a ? m.p1 : m.p2; m.loser = a ? m.p2 : m.p1; m.loserDiff = -Math.abs(m.result.f1 - m.result.f2); }
      byMatch[m.id] = m;
    });
    ko.forEach(m => matches.push(m));
  }

  // ---- ranking (stage reached first; performance in that stage only) ----
  const inKO = new Set(); ko.filter(m => m.stage === 'R32').forEach(m => { inKO.add(m.p1); inKO.add(m.p2); });
  const loserOf = {}; ko.filter(m => ['R32', 'R16', 'QF', 'SF'].includes(m.stage) && m.loser).forEach(m => { loserOf[m.loser] = m; });
  const F = byMatch.FINAL, TH = byMatch['3RD'];
  const items = players.map(p => {
    let tier = null, perf = 0, label = '', note = '';
    if (!ready) label = 'Group stage in progress';
    else if (!inKO.has(p.id)) {
      tier = 6; label = 'Group stage'; perf = key(p);
      const s = stats.get(p.id); note = `Group ${p.grp}: ${s.w * PTS} pts, frame diff ${s.ff - s.fa >= 0 ? '+' : ''}${s.ff - s.fa}, frames for ${s.ff}`;
    } else if (F && F.winner === p.id) { tier = 1; perf = 100; label = 'Champion'; note = 'Won the final'; }
    else if (F && F.loser === p.id) { tier = 1; perf = 50; label = 'Final (runner-up)'; note = 'Lost the final'; }
    else if (TH && TH.winner === p.id) { tier = 2; perf = 100; label = '3rd place playoff (winner)'; note = 'Won the 3rd place playoff'; }
    else if (TH && TH.loser === p.id) { tier = 2; perf = 50; label = '3rd place playoff (loser)'; note = 'Lost the 3rd place playoff'; }
    else if (F && (F.p1 === p.id || F.p2 === p.id)) { tier = 1; label = 'Final (pending)'; note = 'Final to be played'; }
    else if (loserOf[p.id]) {
      const m = loserOf[p.id]; label = m.round;
      if (m.stage === 'SF') { tier = 2; note = 'Lost semi-final; 3rd place playoff to be played'; }
      else { tier = { QF: 3, R16: 4, R32: 5 }[m.stage]; perf = 10 + m.loserDiff; note = `Lost ${2 + m.loserDiff}–2 in the ${m.round}`; }
    } else label = 'In knockouts';
    return { id: p.id, name: p.name, grp: p.grp, stage: label, tier, perf, note, key: tier ? (7 - tier) * 1e9 + perf : null };
  });
  const alive = items.filter(i => i.key === null && ready).length;
  const keyed = items.filter(i => i.key !== null);
  items.forEach(i => {
    if (i.key === null) return;
    i.rank = keyed.filter(o => o.key > i.key).length + alive + 1;
    const tied = keyed.filter(o => o.key === i.key).length > 1;
    i.label = i.stage === 'Final (pending)' ? '1–2' : (i.tier === 2 && i.stage === 'Semi-final') ? '3–4' : i.rank + (tied ? '=' : '');
    i.status = (alive > 0 || i.stage === 'Final (pending)' || i.stage === 'Semi-final') ? 'Provisional' : 'Confirmed';
  });
  const ranking = keyed.sort((a, b) => b.key - a.key || a.id - b.id);
  return { ready, tables, qualifiers: q, matches, ranking, alive, stats };
}
module.exports = { compute, validScore, GL, PAIRS };
