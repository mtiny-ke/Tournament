import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, RefreshControl, Alert, StyleSheet, SafeAreaView, ActivityIndicator, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

const GREEN = '#0a7a22', DARK = '#033b10', YELLOW = '#ffe600';
let TOKEN = null;
async function api(path, method = 'GET', body) {
  const r = await fetch(API_URL + path, { method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')');
  return j;
}
const fail = e => Alert.alert('Error', e.message);

const Btn = ({ title, onPress, kind, small }) => (
  <TouchableOpacity onPress={onPress} style={[s.btn, kind === 'ghost' && s.btnGhost, kind === 'red' && s.btnRed, small && { paddingVertical: 6, paddingHorizontal: 12 }]}>
    <Text style={[s.btnTxt, kind === 'ghost' && { color: DARK }]}>{title}</Text>
  </TouchableOpacity>
);
const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;
const H = ({ children }) => <Text style={s.h}>{children}</Text>;
const Input = props => <TextInput placeholderTextColor="#888" autoCapitalize="none" {...props} style={[s.input, props.style]} />;

function useLoad(path, auto) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setData(await api(path)); } catch (e) { fail(e); } setBusy(false); }, [path]);
  useEffect(() => { load(); if (auto) { const t = setInterval(load, auto); return () => clearInterval(t); } }, [load]);
  return [data, load, busy];
}
const Page = ({ children, busy, reload }) => (
  <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={!!busy} onRefresh={reload} />}>{children}</ScrollView>
);

// ---------- Followers: results ----------
function Results() {
  const [d, load, busy] = useLoad('/dashboard', 30000);
  if (!d) return <ActivityIndicator style={{ marginTop: 40 }} color={GREEN} />;
  const rounds = [...new Set(d.bracket.map(m => m.round))];
  return (
    <Page busy={busy} reload={load}>
      <Card style={{ backgroundColor: DARK }}>
        <Text style={{ color: YELLOW, fontSize: 20, fontWeight: '800' }}>{d.tournament.name}</Text>
        <Text style={{ color: '#fff' }}>{[d.tournament.venue, d.tournament.dates].filter(Boolean).join(' • ')}</Text>
        <Text style={{ color: '#cfe' }}>Players registered: {d.registered}/48</Text>
      </Card>
      {d.latest.length > 0 && <><H>Latest results</H>{d.latest.map(m => <MatchRow key={m.id} m={m} />)}</>}
      {d.bracket.length > 0 && rounds.slice().reverse().map(r => (
        <View key={r}><H>{r}</H>{d.bracket.filter(m => m.round === r).map(m => <MatchRow key={m.id} m={{ ...m, f1: m.result?.f1, f2: m.result?.f2 }} />)}</View>
      ))}
      <H>Group tables</H>
      {d.tables.filter(t => t.rows.length).map(t => (
        <Card key={t.group}>
          <Text style={s.bold}>Group {t.group}{t.complete ? ' ✓' : ''}</Text>
          <View style={s.row}><Text style={[s.th, { flex: 1 }]}>Player</Text>{['P', 'W', 'GD', 'Pts'].map(c => <Text key={c} style={s.thn}>{c}</Text>)}</View>
          {t.rows.map(r => (
            <View key={r.id} style={s.row}><Text style={{ flex: 1 }}>{r.pos}. {r.name}</Text>
              <Text style={s.thn}>{r.played}</Text><Text style={s.thn}>{r.won}</Text><Text style={s.thn}>{r.gd > 0 ? '+' : ''}{r.gd}</Text><Text style={[s.thn, s.bold]}>{r.pts}</Text></View>
          ))}
        </Card>
      ))}
    </Page>
  );
}
const MatchRow = ({ m }) => (
  <Card style={{ paddingVertical: 8 }}>
    {m.round ? <Text style={s.small}>{m.round}</Text> : null}
    <View style={s.row}>
      <Text style={[{ flex: 1 }, m.f1 > m.f2 && s.bold]}>{m.p1 || 'TBD'}</Text>
      <Text style={s.score}>{m.f1 != null ? `${m.f1} – ${m.f2}` : 'vs'}</Text>
      <Text style={[{ flex: 1, textAlign: 'right' }, m.f2 > m.f1 && s.bold]}>{m.p2 || 'TBD'}</Text>
    </View>
  </Card>
);

// ---------- Followers: ranking ----------
function Ranking() {
  const [d, load, busy] = useLoad('/dashboard', 30000);
  if (!d) return <ActivityIndicator style={{ marginTop: 40 }} color={GREEN} />;
  const prizes = d.tournament.prizes;
  return (
    <Page busy={busy} reload={load}>
      <H>Player ranking</H>
      {d.ranking.length === 0 && <Text>Ranking will appear once the group stage is complete.</Text>}
      {d.ranking.map(r => (
        <Card key={r.position} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: r.position <= 4 ? '#fff8cc' : '#fff' }}>
          <Text style={s.rank}>{r.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.bold}>{r.name} <Text style={s.small}>(Group {r.group})</Text></Text>
            <Text style={s.small}>{r.stage} — {r.note}</Text>
            {r.status === 'Provisional' && <Text style={{ color: '#9a6b00', fontSize: 11 }}>Provisional</Text>}
          </View>
          {r.position <= 4 && prizes[r.position - 1] > 0 && r.status === 'Confirmed' && <Text style={s.bold}>KSh {prizes[r.position - 1].toLocaleString()}</Text>}
        </Card>
      ))}
    </Page>
  );
}

// ---------- Referee ----------
function Referee() {
  const [list, load, busy] = useLoad('/matches');
  const [open, setOpen] = useState(null), [f1, setF1] = useState(null), [f2, setF2] = useState(null);
  const submit = async () => {
    try { await api(`/matches/${open.id}/result`, 'POST', { f1, f2 }); Alert.alert('Sent', 'Result sent to the super user for approval.'); setOpen(null); setF1(null); setF2(null); load(); } catch (e) { fail(e); }
  };
  if (!list) return <ActivityIndicator style={{ marginTop: 40 }} color={GREEN} />;
  const todo = list.filter(m => m.status === 'open' || m.status === 'rejected'), waiting = list.filter(m => m.status === 'submitted');
  const Pick = ({ v, set }) => <View style={s.row}>{[0, 1, 2].map(n => <TouchableOpacity key={n} onPress={() => set(n)} style={[s.pick, v === n && s.pickOn]}><Text style={[s.pickTxt, v === n && { color: '#fff' }]}>{n}</Text></TouchableOpacity>)}</View>;
  if (open) return (
    <Page>
      <H>{open.round}</H>
      <Card><Text style={s.bold}>{open.p1}</Text><Pick v={f1} set={setF1} /></Card>
      <Card><Text style={s.bold}>{open.p2}</Text><Pick v={f2} set={setF2} /></Card>
      <Text style={s.small}>Best of 3 frames: enter frames won (2-0, 2-1, 0-2 or 1-2).</Text>
      <View style={{ height: 10 }} /><Btn title="Submit result" onPress={submit} /><View style={{ height: 8 }} /><Btn kind="ghost" title="Cancel" onPress={() => setOpen(null)} />
    </Page>
  );
  return (
    <Page busy={busy} reload={load}>
      <H>Matches to record</H>
      {todo.length === 0 && <Text>No matches waiting. Pull down to refresh.</Text>}
      {todo.map(m => (
        <TouchableOpacity key={m.id} onPress={() => { setOpen(m); setF1(null); setF2(null); }}>
          <Card><Text style={s.small}>{m.round}{m.status === 'rejected' ? ' — REJECTED: ' + (m.note || '') : ''}</Text><Text style={s.bold}>{m.p1}  vs  {m.p2}</Text></Card>
        </TouchableOpacity>
      ))}
      {waiting.length > 0 && <H>Awaiting approval</H>}
      {waiting.map(m => <Card key={m.id}><Text style={s.small}>{m.round}</Text><Text>{m.p1} {m.f1} – {m.f2} {m.p2}</Text></Card>)}
    </Page>
  );
}

// ---------- Super user: approvals ----------
function Approvals() {
  const [list, load, busy] = useLoad('/admin/pending', 20000);
  const act = async (id, kind) => { try { await api(`/admin/results/${id}/${kind}`, 'POST', {}); load(); } catch (e) { fail(e); } };
  if (!list) return <ActivityIndicator style={{ marginTop: 40 }} color={GREEN} />;
  return (
    <Page busy={busy} reload={load}>
      <H>Results waiting for approval ({list.length})</H>
      {list.map(r => (
        <Card key={r.id}>
          <Text style={s.small}>{r.round} • sent by {r.referee}</Text>
          <Text style={s.bold}>{r.p1}  {r.f1} – {r.f2}  {r.p2}</Text>
          <View style={[s.row, { marginTop: 8 }]}><Btn small title="Approve & publish" onPress={() => act(r.id, 'publish')} /><Btn small kind="red" title="Reject" onPress={() => act(r.id, 'reject')} /></View>
        </Card>
      ))}
    </Page>
  );
}

// ---------- Super user: manage ----------
function Manage() {
  const [players, loadP] = useLoad('/admin/players');
  const [users, loadU] = useLoad('/admin/users');
  const [f, setF] = useState({ name: '', phone: '', ward: '', grp: '' });
  const [cfg, setCfg] = useState({ name: '', venue: '', dates: '', prize1: '', prize2: '', prize3: '', prize4: '' });
  const add = async () => { try { await api('/admin/players', 'POST', { ...f, grp: f.grp.toUpperCase() }); setF({ name: '', phone: '', ward: '', grp: '' }); loadP(); } catch (e) { fail(e); } };
  const role = async (id, r) => { try { await api('/admin/users/' + id, 'PATCH', { role: r }); loadU(); } catch (e) { fail(e); } };
  const save = async () => { try { await api('/admin/settings', 'PUT', Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== ''))); Alert.alert('Saved'); } catch (e) { fail(e); } };
  return (
    <Page>
      <H>Tournament settings</H>
      <Card>
        {[['name', 'Tournament name'], ['venue', 'Venue'], ['dates', 'Dates'], ['prize1', '1st prize (KSh)'], ['prize2', '2nd prize'], ['prize3', '3rd prize'], ['prize4', '4th prize']].map(([k, p]) =>
          <Input key={k} placeholder={p} value={cfg[k]} onChangeText={v => setCfg({ ...cfg, [k]: v })} keyboardType={k.startsWith('prize') ? 'numeric' : 'default'} />)}
        <Btn title="Save settings" onPress={save} />
      </Card>
      <H>Add player ({players ? players.length : 0}/48)</H>
      <Card>
        <Input placeholder="Full name" value={f.name} onChangeText={v => setF({ ...f, name: v })} autoCapitalize="words" />
        <Input placeholder="Phone" value={f.phone} onChangeText={v => setF({ ...f, phone: v })} keyboardType="phone-pad" />
        <Input placeholder="Ward / location" value={f.ward} onChangeText={v => setF({ ...f, ward: v })} />
        <Input placeholder="Group (A–L)" value={f.grp} onChangeText={v => setF({ ...f, grp: v })} maxLength={1} autoCapitalize="characters" />
        <Btn title="Add player" onPress={add} />
      </Card>
      {players && players.map(p => <Text key={p.id} style={{ paddingVertical: 2 }}>{p.grp ? `${p.grp}${p.slot}` : '--'}  {p.name}</Text>)}
      <H>Accounts</H>
      {users && users.map(u => (
        <Card key={u.id}><Text style={s.bold}>{u.name} <Text style={s.small}>{u.phone}</Text></Text>
          <View style={[s.row, { marginTop: 6 }]}>{['user', 'referee', 'superuser'].map(r => <Btn key={r} small kind={u.role === r ? undefined : 'ghost'} title={r} onPress={() => role(u.id, r)} />)}</View></Card>
      ))}
    </Page>
  );
}

// ---------- Auth ----------
function Auth({ onAuth }) {
  const [reg, setReg] = useState(false), [f, setF] = useState({ name: '', phone: '', password: '' }), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await api(reg ? '/auth/register' : '/auth/login', 'POST', f); onAuth(r.token, r.user); } catch (e) { fail(e); }
    setBusy(false);
  };
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: DARK }}>
      <Text style={{ color: YELLOW, fontSize: 28, fontWeight: '900', textAlign: 'center', marginBottom: 20 }}>Pool Tournament</Text>
      <Card>
        {reg && <Input placeholder="Your name" value={f.name} onChangeText={v => setF({ ...f, name: v })} autoCapitalize="words" />}
        <Input placeholder="Phone number" value={f.phone} onChangeText={v => setF({ ...f, phone: v })} keyboardType="phone-pad" />
        <Input placeholder="Password" value={f.password} onChangeText={v => setF({ ...f, password: v })} secureTextEntry />
        {busy ? <ActivityIndicator color={GREEN} /> : <Btn title={reg ? 'Create account' : 'Log in'} onPress={go} />}
        <TouchableOpacity onPress={() => setReg(!reg)}><Text style={{ textAlign: 'center', marginTop: 12, color: GREEN }}>{reg ? 'I already have an account' : 'New here? Create an account'}</Text></TouchableOpacity>
      </Card>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false), [tab, setTab] = useState('results');
  useEffect(() => { (async () => {
    try { const t = await SecureStore.getItemAsync('token'); if (t) { TOKEN = t; setUser(await api('/me')); } } catch { TOKEN = null; }
    setReady(true);
  })(); }, []);
  const onAuth = async (t, u) => { TOKEN = t; await SecureStore.setItemAsync('token', t); setUser(u); setTab('results'); };
  const logout = async () => { TOKEN = null; await SecureStore.deleteItemAsync('token'); setUser(null); };
  if (!ready) return <ActivityIndicator style={{ flex: 1 }} color={GREEN} />;
  if (!user) return <><StatusBar style="light" /><Auth onAuth={onAuth} /></>;
  const tabs = [['results', 'Results'], ['ranking', 'Ranking']];
  if (user.role === 'referee' || user.role === 'superuser') tabs.push(['referee', 'Referee']);
  if (user.role === 'superuser') tabs.push(['approvals', 'Approvals'], ['manage', 'Manage']);
  tabs.push(['me', 'Account']);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f7f4', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === 'results' && <Results />}{tab === 'ranking' && <Ranking />}{tab === 'referee' && <Referee />}
        {tab === 'approvals' && <Approvals />}{tab === 'manage' && <Manage />}
        {tab === 'me' && <Page><Card><Text style={s.bold}>{user.name}</Text><Text>{user.phone}</Text><Text style={s.small}>Role: {user.role}</Text><View style={{ height: 10 }} /><Btn title="Log out" kind="red" onPress={logout} /></Card></Page>}
      </View>
      <ScrollView horizontal style={s.tabs} showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-around' }}>
        {tabs.map(([k, t]) => <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}><Text style={[s.tabTxt, tab === k && { color: DARK }]}>{t}</Text></TouchableOpacity>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#dde6dd' },
  h: { fontSize: 16, fontWeight: '800', color: DARK, marginTop: 12, marginBottom: 6 },
  bold: { fontWeight: '700' }, small: { fontSize: 12, color: '#666' }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  th: { fontWeight: '700', color: '#555', fontSize: 12 }, thn: { width: 34, textAlign: 'center' },
  score: { fontWeight: '800', fontSize: 16, color: DARK, paddingHorizontal: 8 },
  rank: { width: 44, fontSize: 18, fontWeight: '900', color: GREEN },
  btn: { backgroundColor: GREEN, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center' },
  btnGhost: { backgroundColor: '#e8f1e8' }, btnRed: { backgroundColor: '#b3261e' }, btnTxt: { color: '#fff', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ccd6cc', borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: '#fff' },
  pick: { flex: 1, borderWidth: 2, borderColor: GREEN, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  pickOn: { backgroundColor: GREEN }, pickTxt: { fontSize: 22, fontWeight: '800', color: GREEN },
  tabs: { flexGrow: 0, backgroundColor: DARK }, tab: { paddingVertical: 14, paddingHorizontal: 16 }, tabOn: { backgroundColor: YELLOW }, tabTxt: { color: '#fff', fontWeight: '700' },
});
