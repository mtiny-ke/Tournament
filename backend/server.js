// Tournament backend: accounts, roles, referee result upload, super-user approval, public dashboard.
const express = require('express'), cors = require('cors'), Database = require('better-sqlite3');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const { compute, validScore, GL } = require('./engine');

const SECRET = process.env.JWT_SECRET || 'CHANGE-ME-in-production';
const db = new Database(process.env.DB_PATH || 'tournament.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, phone TEXT, ward TEXT, grp TEXT, slot INTEGER, tiebreak INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS results(match_id TEXT PRIMARY KEY, f1 INTEGER, f2 INTEGER, p1 INTEGER, p2 INTEGER, status TEXT, submitted_by INTEGER, submitted_at TEXT, decided_by INTEGER, decided_at TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);
// First super user (created once, from environment variables)
if (!db.prepare('SELECT 1 FROM users').get()) {
  const phone = process.env.ADMIN_PHONE || '0700000000', pw = process.env.ADMIN_PASSWORD || 'admin1234';
  db.prepare("INSERT INTO users(name,phone,pass,role) VALUES(?,?,?,'superuser')").run(process.env.ADMIN_NAME || 'Super User', phone, bcrypt.hashSync(pw, 10));
  console.log(`Super user created: ${phone}. Change the password / set ADMIN_PHONE & ADMIN_PASSWORD.`);
}
const app = express(); app.use(cors()); app.use(express.json());
const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); } };
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '30d' });
const auth = (...roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  try {
    const t = jwt.verify(h.replace('Bearer ', ''), SECRET);
    const u = db.prepare('SELECT id,name,phone,role FROM users WHERE id=?').get(t.id);
    if (!u) return res.status(401).json({ error: 'Account not found' });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Not allowed for your role' });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Please log in' }); }
};
const setting = (k, d = '') => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || { value: d }).value;
const players = () => db.prepare('SELECT * FROM players ORDER BY id').all();
const published = () => { const o = {}; db.prepare("SELECT * FROM results WHERE status='published'").all().forEach(r => { o[r.match_id] = r; }); return o; };
const state = (overrides) => compute(players(), { ...published(), ...(overrides || {}) });
const nameOf = (st, id, ps) => { const p = ps.find(x => x.id === id); return p ? p.name : null; };

// ---------- Auth ----------
app.post('/api/auth/register', wrap((req, res) => {
  const { name, phone, password } = req.body || {};
  if (!name || !phone || !password || password.length < 6) return res.status(400).json({ error: 'Name, phone and a password of at least 6 characters are required' });
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) return res.status(409).json({ error: 'Phone already registered' });
  const id = db.prepare("INSERT INTO users(name,phone,pass,role) VALUES(?,?,?,'user')").run(name.trim(), phone.trim(), bcrypt.hashSync(password, 10)).lastInsertRowid;
  const u = { id, name, phone, role: 'user' }; res.json({ token: sign(u), user: u });
}));
app.post('/api/auth/login', wrap((req, res) => {
  const { phone, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE phone=?').get(phone || '');
  if (!u || !bcrypt.compareSync(password || '', u.pass)) return res.status(401).json({ error: 'Wrong phone or password' });
  res.json({ token: sign(u), user: { id: u.id, name: u.name, phone: u.phone, role: u.role } });
}));
app.get('/api/me', auth(), (req, res) => res.json(req.user));

// ---------- Public dashboard (published results only) ----------
app.get('/api/dashboard', wrap((req, res) => {
  const ps = players(), st = state(), nm = id => nameOf(st, id, ps);
  const pub = db.prepare("SELECT * FROM results WHERE status='published' ORDER BY decided_at DESC, rowid DESC LIMIT 15").all();
  res.json({
    tournament: { name: setting('name', 'Pool Tournament'), venue: setting('venue'), dates: setting('dates'), prizes: [1, 2, 3, 4].map(i => Number(setting('prize' + i, 0)) || 0) },
    ready: st.ready, registered: ps.length,
    tables: st.tables.map(t => ({ group: t.group, complete: t.complete, rows: t.rows })),
    wildcardTie: st.qualifiers ? st.qualifiers.wildcardTie : false,
    thirds: st.qualifiers ? st.qualifiers.thirds : [],
    bracket: st.matches.filter(m => m.stage !== 'group').map(m => ({ id: m.id, round: m.round, p1: nm(m.p1), p2: nm(m.p2), result: m.result ? { f1: m.result.f1, f2: m.result.f2 } : null, winner: nm(m.winner) })),
    groupResults: st.matches.filter(m => m.stage === 'group' && m.result).map(m => ({ id: m.id, round: m.round, p1: nm(m.p1), p2: nm(m.p2), f1: m.result.f1, f2: m.result.f2 })),
    ranking: st.ranking.map(r => ({ position: 0, rank: r.label, name: r.name, group: r.grp, stage: r.stage, note: r.note, status: r.status })).map((r, i) => ({ ...r, position: i + 1 })),
    latest: pub.map(r => { const m = st.matches.find(x => x.id === r.match_id); return m ? { id: m.id, round: m.round, p1: nm(m.p1), p2: nm(m.p2), f1: r.f1, f2: r.f2, at: r.decided_at } : null; }).filter(Boolean)
  });
}));

// ---------- Matches (referees & super user) ----------
app.get('/api/matches', auth('referee', 'superuser'), wrap((req, res) => {
  const ps = players(), st = state();
  const rows = {}; db.prepare('SELECT * FROM results').all().forEach(r => { rows[r.match_id] = r; });
  res.json(st.matches.filter(m => m.p1 && m.p2).map(m => {
    const r = rows[m.id];
    return { id: m.id, round: m.round, p1: nameOf(st, m.p1, ps), p2: nameOf(st, m.p2, ps), status: r ? r.status : 'open', f1: r ? r.f1 : null, f2: r ? r.f2 : null, note: r ? r.note : null };
  }));
}));
app.post('/api/matches/:id/result', auth('referee', 'superuser'), wrap((req, res) => {
  const { f1, f2 } = req.body || {}; const id = req.params.id;
  if (!validScore(f1, f2)) return res.status(400).json({ error: 'Invalid score. Best of 3: use 2-0, 2-1, 0-2 or 1-2.' });
  const m = state().matches.find(x => x.id === id);
  if (!m || !m.p1 || !m.p2) return res.status(404).json({ error: 'Match not available yet' });
  const cur = db.prepare('SELECT * FROM results WHERE match_id=?').get(id);
  if (cur && cur.status === 'published') return res.status(409).json({ error: 'Result already published. Ask the super user to correct it.' });
  db.prepare(`INSERT INTO results(match_id,f1,f2,p1,p2,status,submitted_by,submitted_at) VALUES(?,?,?,?,?,'submitted',?,datetime('now'))
    ON CONFLICT(match_id) DO UPDATE SET f1=excluded.f1,f2=excluded.f2,p1=excluded.p1,p2=excluded.p2,status='submitted',submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at,note=NULL`).run(id, f1, f2, m.p1, m.p2, req.user.id);
  res.json({ ok: true, status: 'submitted' });
}));

// ---------- Super user: approve / reject / correct ----------
app.get('/api/admin/pending', auth('superuser'), wrap((req, res) => {
  const ps = players(), st = state();
  res.json(db.prepare(`SELECT r.*, u.name AS referee FROM results r LEFT JOIN users u ON u.id=r.submitted_by WHERE r.status='submitted' ORDER BY r.submitted_at`).all().map(r => {
    const m = st.matches.find(x => x.id === r.match_id);
    return { id: r.match_id, round: m ? m.round : '', p1: nameOf(st, r.p1, ps), p2: nameOf(st, r.p2, ps), f1: r.f1, f2: r.f2, referee: r.referee, at: r.submitted_at };
  }));
}));
// A change is accepted only if every published result still belongs to the same two players afterwards.
function consistent(overrides, removeId) {
  const pub = { ...published(), ...(overrides || {}) }; if (removeId) delete pub[removeId];
  const st = compute(players(), pub);
  return Object.entries(pub).every(([id, r]) => { const m = st.matches.find(x => x.id === id); return m && m.p1 === r.p1 && m.p2 === r.p2; });
}
app.post('/api/admin/results/:id/publish', auth('superuser'), wrap((req, res) => {
  const id = req.params.id, cur = db.prepare('SELECT * FROM results WHERE match_id=?').get(id);
  let { f1, f2 } = req.body || {}; if (f1 === undefined) { f1 = cur && cur.f1; f2 = cur && cur.f2; }
  if (!validScore(f1, f2)) return res.status(400).json({ error: 'Invalid score' });
  const m = state().matches.find(x => x.id === id);
  if (!m || !m.p1 || !m.p2) return res.status(404).json({ error: 'Match not available' });
  if (!consistent({ [id]: { f1, f2, p1: m.p1, p2: m.p2 } })) return res.status(409).json({ error: 'This change would alter later published matches. Remove those results first.' });
  db.prepare(`INSERT INTO results(match_id,f1,f2,p1,p2,status,decided_by,decided_at) VALUES(?,?,?,?,?,'published',?,datetime('now'))
    ON CONFLICT(match_id) DO UPDATE SET f1=excluded.f1,f2=excluded.f2,p1=excluded.p1,p2=excluded.p2,status='published',decided_by=excluded.decided_by,decided_at=excluded.decided_at,note=NULL`).run(id, f1, f2, m.p1, m.p2, req.user.id);
  res.json({ ok: true });
}));
app.post('/api/admin/results/:id/reject', auth('superuser'), wrap((req, res) => {
  const r = db.prepare("UPDATE results SET status='rejected',note=?,decided_by=?,decided_at=datetime('now') WHERE match_id=? AND status='submitted'").run((req.body && req.body.note) || 'Rejected – please re-check', req.user.id, req.params.id);
  res.json({ ok: r.changes > 0 });
}));
app.delete('/api/admin/results/:id', auth('superuser'), wrap((req, res) => {
  if (!consistent(null, req.params.id)) return res.status(409).json({ error: 'Later published matches depend on this result. Remove those first.' });
  db.prepare('DELETE FROM results WHERE match_id=?').run(req.params.id); res.json({ ok: true });
}));

// ---------- Super user: players, users, settings ----------
app.get('/api/admin/players', auth('superuser'), (req, res) => res.json(players()));
app.post('/api/admin/players', auth('superuser'), wrap((req, res) => {
  const { name, phone, ward, grp } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  let slot = null;
  if (grp) {
    if (!GL.includes(grp)) return res.status(400).json({ error: 'Group must be A–L' });
    const used = db.prepare('SELECT slot FROM players WHERE grp=?').all(grp).map(r => r.slot);
    slot = [1, 2, 3, 4].find(s => !used.includes(s)); if (!slot) return res.status(409).json({ error: `Group ${grp} is full` });
  }
  if (players().length >= 48) return res.status(409).json({ error: 'Maximum of 48 players' });
  try { const id = db.prepare('INSERT INTO players(name,phone,ward,grp,slot) VALUES(?,?,?,?,?)').run(name.trim(), phone || '', ward || '', grp || null, slot).lastInsertRowid; res.json({ id, slot }); }
  catch { res.status(409).json({ error: 'Player name already registered' }); }
}));
app.delete('/api/admin/players/:id', auth('superuser'), wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM results').get()) return res.status(409).json({ error: 'Results exist – players can no longer be removed' });
  db.prepare('DELETE FROM players WHERE id=?').run(req.params.id); res.json({ ok: true });
}));
app.patch('/api/admin/players/:id/tiebreak', auth('superuser'), wrap((req, res) => {
  const t = Number(req.body.tiebreak); if (!(t >= 0 && t <= 9)) return res.status(400).json({ error: '0–9' });
  db.prepare('UPDATE players SET tiebreak=? WHERE id=?').run(t, req.params.id); res.json({ ok: true });
}));
app.get('/api/admin/users', auth('superuser'), (req, res) => res.json(db.prepare('SELECT id,name,phone,role,created_at FROM users ORDER BY id').all()));
app.patch('/api/admin/users/:id', auth('superuser'), wrap((req, res) => {
  const { role } = req.body || {}; if (!['user', 'referee', 'superuser'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (Number(req.params.id) === req.user.id && role !== 'superuser') return res.status(400).json({ error: 'You cannot demote yourself' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id); res.json({ ok: true });
}));
app.put('/api/admin/settings', auth('superuser'), wrap((req, res) => {
  const ok = ['name', 'venue', 'dates', 'prize1', 'prize2', 'prize3', 'prize4'];
  Object.entries(req.body || {}).filter(([k]) => ok.includes(k)).forEach(([k, v]) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)));
  res.json({ ok: true });
}));

app.get('/', (req, res) => res.send('Tournament API running'));
const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log('API on port ' + PORT));
module.exports = app;
