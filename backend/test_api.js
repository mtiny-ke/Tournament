// End-to-end test: referee uploads, super user publishes, public dashboard follows. Compares final ranking with the Excel workbook.
process.env.DB_PATH = ':memory:'; process.env.ADMIN_PHONE = '0711000000'; process.env.ADMIN_PASSWORD = 'secret123';
const app = require('./server'); const data = require('./testdata.json');
const srv = app.listen(0); const base = `http://localhost:${srv.address().port}/api`;
const call = async (m, p, body, tok) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const admin = (await call('POST', '/auth/login', { phone: '0711000000', password: 'secret123' })).j.token;
  const ref = await call('POST', '/auth/register', { name: 'Referee One', phone: '0722000001', password: 'abc12345' });
  const fan = await call('POST', '/auth/register', { name: 'Fan', phone: '0722000002', password: 'abc12345' });
  ok(ref.j.user.role === 'user', 'new accounts start as normal users');
  ok((await call('GET', '/matches', null, fan.j.token)).s === 403, 'normal user cannot open referee screen');
  ok((await call('PATCH', `/admin/users/${ref.j.user.id}`, { role: 'referee' }, ref.j.token)).s === 403, 'referee cannot promote accounts');
  await call('PATCH', `/admin/users/${ref.j.user.id}`, { role: 'referee' }, admin);
  const rt = (await call('POST', '/auth/login', { phone: '0722000001', password: 'abc12345' })).j.token;
  for (const p of data.players) await call('POST', '/admin/players', p, admin);
  const ms = (await call('GET', '/matches', null, rt)).j; ok(ms.length === 72, 'referee sees 72 group matches');
  const byName = id => id; let published = 0;
  async function doMatches() {
    const list = (await call('GET', '/matches', null, rt)).j.filter(m => m.status === 'open');
    for (const m of list) {
      const sc = data.results[m.id]; if (!sc) continue;
      await call('POST', `/matches/${m.id}/result`, { f1: sc[0], f2: sc[1] }, rt);
      if (published === 0) { const d = (await call('GET', '/dashboard')).j; ok(d.groupResults.length === 0, 'submitted result is NOT visible to followers before approval'); }
      await call('POST', `/admin/results/${m.id}/publish`, {}, admin); published++;
    }
    return list.length;
  }
  ok((await call('POST', '/matches/G-A-1/result', { f1: 2, f2: 2 }, rt)).s === 400, 'invalid best-of-3 score rejected');
  let n; do { n = await doMatches(); } while (n > 0);
  const d = (await call('GET', '/dashboard')).j;
  ok(published === 104, `all 104 matches played and published (${published})`);
  ok(d.ready && d.bracket.length === 32, 'draw generated after group stage');
  const exp = data.expected, got = d.ranking;
  const same = exp.every((e, i) => got[i] && String(got[i].rank) === String(e[0]) && got[i].name === e[1] && got[i].stage === e[2]);
  ok(same, 'final ranking identical to the Excel workbook (48 players)');
  ok(got[0].stage === 'Champion' && got[0].status === 'Confirmed', 'champion confirmed: ' + got[0].name);
  const o = data.results['R32-1'], flip = await call('POST', '/admin/results/R32-1/publish', { f1: o[1], f2: o[0] }, admin);
  ok(flip.s === 409, 'flipping a Round of 32 winner after later rounds are published is blocked');
  const same2 = await call('POST', '/admin/results/R32-1/publish', { f1: o[0], f2: o[1] }, admin);
  ok(same2.s === 200, 're-publishing the same score is allowed');
  srv.close();
})();
