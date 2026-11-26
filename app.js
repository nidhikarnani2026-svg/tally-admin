'use strict';
// Signs in with Supabase's own login and calls the fixed functions. The database decides everything; this page decides nothing.
// The sign-in lives in memory only: closing or reloading the page signs out.

const AREAS = [['ledgers', 'Ledgers and balances'], ['sales', 'Sales and receivables'], ['purchases', 'Purchases and payables'], ['bank', 'Bank and cash'], ['stock', 'Stock / inventory'], ['production', 'Production / manufacturing'],
  ['tax', 'GST / statutory'], ['salary', 'Payroll / salaries'], ['pnl', 'Profit and loss'], ['balsheet', 'Balance sheet'], ['reports', 'Reports / dashboards'],
  ['expenses', 'Expenses'], ['loans', 'Loans and capital'], ['investments', 'Investments and property'], ['income', 'Other income']];
const LEDGER_AREAS = ['sales', 'purchases', 'bank', 'expenses', 'salary', 'tax', 'loans', 'investments', 'income', 'pnl'];   // a ledger can belong to one of these
const ROLES = { 'Accountant': AREAS.map(a => a[0]), 'Management / owner': ['pnl', 'balsheet', 'reports', 'sales', 'purchases', 'bank', 'production', 'stock'], 'Sales': ['sales', 'stock', 'reports'],
  'Purchase': ['purchases', 'stock', 'reports'], 'Cashier': ['bank'], 'Store / logistics': ['stock', 'production'], 'Production': ['production', 'stock'], 'HR / payroll': ['salary'], 'GST / compliance': ['tax', 'reports'] };
const POWER = { super_admin: 'Super-admin', manager: 'Manager', member: 'Member' };
const $ = id => document.getElementById(id);
let S = null, ME = null, factor = null, BOOKS = [], TABS = {};

// ------------------------------------------------------------ small helpers
function el(tag, props = {}, ...kids) {           // text only, never HTML from data
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : k in e ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...kids.filter(x => x !== null && x !== undefined));
  return e;
}
function say(text, good = false) { const m = $('msg'); m.textContent = text || ''; m.className = good ? 'good' : ''; m.hidden = !text; if (text) m.scrollIntoView({ block: 'nearest' }); }
function show(id) { for (const x of ['signIn', 'codeForm', 'enrol', 'app']) $(x).hidden = x !== id; $('who').hidden = id === 'signIn'; if (id === 'app') $('tabs').after($('msg')); else document.querySelector('main').prepend($('msg')); }
function table(heads, rows) {
  if (!rows.length) return el('p', { className: 'hint' }, 'Nothing to show.');
  return el('div', { className: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...heads.map(h => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', {}, c === null || c === undefined ? '' : c)))))));
}
async function busy(button, work) {
  say(''); if (button) button.disabled = true;
  try { return await work(); } catch (e) { say(e.message || 'Something went wrong.'); } finally { if (button) button.disabled = false; }
}

// ------------------------------------------------------------ talking to Supabase
async function http(path, { method = 'POST', body, token } = {}) {
  let r;
  try {
    r = await fetch(CFG.url + path, { method, headers: { apikey: CFG.key, 'Content-Type': 'application/json', 'x-client-info': 'Admin page', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error('Cannot reach Supabase. Check the internet.'); }
  const t = await r.text(); let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { /* not JSON */ }
  if (!r.ok) { const e = new Error((j && (j.msg || j.message || j.error_description)) || 'Request refused (' + r.status + ').'); e.status = r.status; if (j && j.error && !j.msg && !j.message) e.message = String(j.error); throw e; }
  return j;
}
function keep(s) { S = { access: s.access_token, refresh: s.refresh_token, until: Date.now() + (s.expires_in - 60) * 1000, user: s.user || (S && S.user) }; }
async function token() {
  if (!S) throw new Error('Please sign in.');
  if (Date.now() > S.until) {
    try { keep(await http('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: S.refresh } })); }
    catch { leave(); throw new Error('You were signed out. Please sign in again.'); }
  }
  return S.access;
}
const auth = async (path, o = {}) => http('/auth/v1' + path, { ...o, token: await token() });
async function ask(fn, args = {}) {
  const r = await http('/rest/v1/rpc/' + fn, { body: args, token: await token() });
  if (!r || !r.ok) throw new Error((r && r.error) || 'No answer.');
  return r.rows;
}
const manage = (action, details = {}) => ask('manage_people', { action, details });
async function server(action, details) {              // makes logins and passwords; the database allows or refuses each one
  const r = await http('/functions/v1/people', { body: { action, details }, token: await token() });
  if (!r || !r.ok) throw new Error((r && r.error) || 'No answer.');
  return r;
}
function leave() { S = ME = factor = null; BOOKS = []; $('view').replaceChildren(); $('tabs').replaceChildren(); $('password').value = $('code').value = $('enrolCode').value = ''; $('qr').removeAttribute('src'); $('totpKey').textContent = ''; show('signIn'); }

// ------------------------------------------------------------ signing in
function loginOf(v) { v = v.trim().toLowerCase(); return v.includes('@') ? v : v + '@people.tallydata.invalid'; }     // a short name works too
$('signIn').addEventListener('submit', ev => { ev.preventDefault(); busy(ev.submitter, async () => {
  const pw = $('password').value; $('password').value = '';
  keep(await http('/auth/v1/token?grant_type=password', { body: { email: loginOf($('email').value), password: pw } }));
  $('whoName').textContent = S.user.email.replace('@people.tallydata.invalid', '');
  await afterPassword();
}); });
async function afterPassword() {
  const u = await auth('/user', { method: 'GET' });
  factor = (u.factors || []).find(f => f.factor_type === 'totp' && f.status === 'verified') || null;
  if (factor) { show('codeForm'); $('code').focus(); return; }
  try { await enter(); } catch (e) { if (/two-step/i.test(e.message)) await startEnrol(false); else { leave(); throw e; } }
}
async function verify(id, code) {
  const c = await auth('/factors/' + encodeURIComponent(id) + '/challenge', { body: {} });
  keep(await auth('/factors/' + encodeURIComponent(id) + '/verify', { body: { challenge_id: c.id, code } }));
}
$('codeForm').addEventListener('submit', ev => { ev.preventDefault(); busy(ev.submitter, async () => {
  const code = $('code').value; $('code').value = ''; await verify(factor.id, code);
  try { await enter(); } catch (e) { leave(); throw e; }
}); });
async function startEnrol(optional) {
  const u = await auth('/user', { method: 'GET' });
  for (const f of (u.factors || []).filter(f => f.status !== 'verified')) await auth('/factors/' + encodeURIComponent(f.id), { method: 'DELETE' });
  const f = await auth('/factors', { body: { factor_type: 'totp', friendly_name: 'phone' } });
  factor = { id: f.id };
  const q = f.totp.qr_code;
  $('qr').src = q.startsWith('data:') ? q : 'data:image/svg+xml;utf8,' + encodeURIComponent(q);
  $('totpKey').textContent = f.totp.secret; $('enrolSkip').hidden = !optional; show('enrol'); $('enrolCode').focus();
}
$('enrol').addEventListener('submit', ev => { ev.preventDefault(); busy(ev.submitter, async () => {
  const code = $('enrolCode').value; $('enrolCode').value = ''; await verify(factor.id, code);
  $('qr').removeAttribute('src'); $('totpKey').textContent = '';
  await enter(); say('Two-step sign-in is on.', true);
}); });
$('enrolSkip').addEventListener('click', () => busy(null, async () => { $('qr').removeAttribute('src'); $('totpKey').textContent = ''; await enter(); }));
$('signOut').addEventListener('click', () => busy(null, async () => { try { await auth('/logout', { body: {} }); } finally { leave(); } }));

async function enter() {
  ME = (await ask('ask_my_access'))[0];
  BOOKS = (await ask('ask_books')).map(b => b.book).filter(b => !b.startsWith('ZZ '));     // practice books are not offered
  $('whoName').textContent = 'Signed in as ' + ME.name + ' · ' + POWER[ME.power].toLowerCase();
  const boss = ME.power === 'super_admin', tabs = ME.power === 'member' ? [] : [['Add a person', viewAdd], ['People', viewPeople]];
  if (boss) tabs.push(['Usage log', viewLog], ['Unsorted ledgers', viewUnsorted]);
  tabs.push(['My access', viewMine]);
  TABS = Object.fromEntries(tabs);
  $('tabs').replaceChildren(...tabs.map(([name]) => el('button', { role: 'tab', onclick: () => open(name) }, name)));
  show('app'); await open(tabs[0][0]);
}
async function open(name) {
  for (const b of $('tabs').children) b.setAttribute('aria-selected', b.textContent === name);
  say(''); $('view').replaceChildren(el('p', { className: 'hint' }, 'Loading…'));
  await busy(null, async () => { $('view').replaceChildren(el('div', { className: name === 'People' ? 'plain' : 'card' }, ...await TABS[name]())); });
}
function alone(...kids) { $('view').replaceChildren(el('div', { className: 'card pop' }, ...kids)); }      // one screen at a time
function question(text, yes, back) {
  alone(el('h2', {}, text), el('div', { className: 'acts' },
    el('button', { className: 'main', onclick: ev => busy(ev.target, yes) }, 'Yes'), el('button', { onclick: () => open(back) }, 'Cancel')));
}

// ------------------------------------------------------------ the form used by Add and Edit
function accessForm(p, boss) {
  const name = el('input', { maxLength: 60, value: p.name || '', placeholder: 'Rahul Kumar' });
  const power = el('select', {}, ...Object.entries(POWER).filter(([k]) => boss || k === 'member').map(([k, t]) => el('option', { value: k }, t)));
  power.value = p.power || 'member';
  const email = el('input', { type: 'email', maxLength: 120, value: p.email || '', placeholder: 'rahul@example.com' });
  const phone = el('input', { maxLength: 20, inputMode: 'tel', value: p.phone || '', placeholder: '9198XXXXXXXX' });
  const mine = new Set(ME.areas), offered = AREAS.filter(a => boss || mine.has(a[0]));   // ME.areas holds area keys
  const books = new Set(p.books || []), areas = new Set(p.areas || ROLES[p.job_role || 'Accountant']);
  const role = el('select', {}, ...Object.keys(ROLES).map(r => el('option', { value: r }, r)));
  role.value = p.job_role && ROLES[p.job_role] ? p.job_role : 'Accountant';
  const bookHead = el('span'), bookNote = el('div'), bookBox = el('div', { className: 'books' }), areaHead = el('div', { className: 'hint', style: 'margin:8px 0 4px' }), areaBox = el('div', { className: 'ticks' });
  const tick = (set, v, text, after) => { const i = el('input', { type: 'checkbox', checked: set.has(v), onchange: () => { i.checked ? set.add(v) : set.delete(v); after(); } }); const l = el('label', {}, i, text); l.classList.toggle('on', set.has(v)); return l; };
  const drawBooks = () => {
    bookHead.textContent = 'Companies this person can see · ' + books.size + ' of ' + BOOKS.length;
    bookBox.replaceChildren(...BOOKS.map(b => tick(books, b, b, drawBooks)));
    bookNote.className = books.size ? 'hint' : 'err'; bookNote.textContent = books.size ? 'This person can see only: ' + BOOKS.filter(b => books.has(b)).join(', ') : 'No company ticked yet. This person would see nothing.';
  };
  const drawAreas = () => {
    const n = offered.filter(a => areas.has(a[0])).length;
    areaHead.textContent = 'Data this person can see in those companies · ' + n + ' of ' + AREAS.length;
    areaBox.replaceChildren(...offered.map(([k, t]) => tick(areas, k, t, drawAreas)));
  };
  const preset = () => { areas.clear(); for (const a of ROLES[role.value]) areas.add(a); drawAreas(); };
  role.addEventListener('change', preset); drawBooks(); drawAreas();
  const part = el('div', {}, el('div', { className: 'box' }, el('div', { className: 'split' }, bookHead, el('span', { className: 'acts' },
      el('button', { type: 'button', onclick: () => { BOOKS.forEach(b => books.add(b)); drawBooks(); } }, 'Select all'), el('button', { type: 'button', onclick: () => { books.clear(); drawBooks(); } }, 'Clear'))), bookBox, bookNote),
    el('div', { className: 'box' }, el('div', { className: 'split' }, el('label', { style: 'width:240px;margin:0' }, 'Job role (preset)', role), el('button', { type: 'button', onclick: preset }, 'Reset to role')), areaHead, areaBox));
  const note = el('p', { className: 'hint' }, 'A super-admin sees all companies and everything, so there is nothing to tick.');
  const sync = () => { const all = power.value === 'super_admin'; part.hidden = all; note.hidden = !all; };
  power.addEventListener('change', sync); sync();
  return { name, power, email, phone, part, note,
    read: () => {
      const all = power.value === 'super_admin', b = BOOKS.filter(x => books.has(x)), a = offered.map(x => x[0]).filter(x => areas.has(x));
      if (!all && !b.length) throw new Error('Tick at least one company.');
      if (!all && !a.length) throw new Error('Tick at least one data area.');
      return { name: name.value.trim(), power: power.value, email: email.value.trim(), phone: phone.value.trim(), job_role: all ? '' : role.value, books: all ? [] : b, areas: all ? [] : a };
    } };
}

// ------------------------------------------------------------ the password, shown once
const LINK = CFG.url + '/functions/v1/tally';            // one link for everyone; the sign-in decides who sees what
function steps(short, pw) { return 'Connector link: ' + LINK + '\nShort name: ' + short + '\nPassword: ' + pw + '\n\nSteps:\n1) Open Claude > Settings > Connectors.\n2) Press Add custom connector. Name it Tally Data Access, paste the link, press Add. Leave Advanced settings empty.\n3) Press Connect. A sign-in page opens.\n4) Enter the short name and password on that page, not in Claude. Press Sign in, then Connect.\n5) Ask in Claude: "Using Tally Data Access, which companies can I see?"'; }
function inviteText(short, pw) { return 'Hi, here is your access to the Tally data.\n\n' + steps(short, pw) + '\n\nKeep this password private.'; }
function showInvite(title, short, pw, email, phone) {
  const msg = inviteText(short, pw), done = t => say(t, true);
  const copy = (text, t) => busy(null, async () => { try { await navigator.clipboard.writeText(text); done(t); } catch { throw new Error('Copy is not allowed here. Select the text and copy it.'); } });
  const mail = el('a', { className: 'btn', href: 'mailto:' + encodeURIComponent(email || '') + '?subject=' + encodeURIComponent('Your Tally data access') + '&body=' + encodeURIComponent(msg) }, 'Send by email');
  const wa = el('a', { className: 'btn', target: '_blank', rel: 'noopener noreferrer', href: 'https://wa.me/' + (phone || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(msg) }, 'Send on WhatsApp');
  const line = (t, v) => el('div', {}, el('div', { className: 'hint', style: 'margin:10px 0 0' }, t), el('div', { className: 'pw small' }, v));
  alone(el('h2', {}, title), el('p', { className: 'hint', style: 'margin:0' }, 'For ' + short + '. The password is shown only now; it cannot be looked up later, only reset.'),
    line('Connector link (same for everyone)', LINK), line('Short name', short), line('Password', pw),
    el('ol', {}, ...['Claude > Settings > Connectors', 'Add custom connector, paste the link, press Add. Leave Advanced settings empty', 'Press Connect, the sign-in page opens', 'Short name and password on that page, not in Claude. Sign in, then Connect'].map(t => el('li', {}, t))),
    el('div', { className: 'acts' }, mail, wa, el('button', { onclick: () => copy(msg, 'Everything copied. Paste it anywhere.') }, 'Copy everything')),
    el('p', { className: 'hint' }, 'All three carry the same message. Email and WhatsApp open with it ready; you press Send yourself.'),
    el('button', { className: 'main', onclick: () => open('People') }, 'Done'));
}
// ------------------------------------------------------------ screens
async function viewAdd() {
  const boss = ME.power === 'super_admin', f = accessForm({}, boss);
  const short = el('input', { required: true, maxLength: 24, placeholder: 'rahul', autocapitalize: 'none', autocomplete: 'off' });
  return [el('h2', {}, 'Add a person'), el('form', { noValidate: true, onsubmit: ev => { ev.preventDefault(); busy(ev.submitter, async () => {
    const s = short.value.trim().toLowerCase(); if (!s) throw new Error('Enter a short name.');
    const d = { short_name: s, ...f.read() };
    const r = await server('add', d);
    showInvite('Account created, send the invite', s, r.password, d.email, d.phone);
  }); } },
    el('div', { className: 'row' }, el('label', {}, 'Short name', short), el('label', {}, 'Full name', f.name), el('label', {}, 'Power', f.power)),
    el('div', { className: 'row' }, el('label', {}, 'Email (optional, for the invite)', f.email), el('label', {}, 'Phone (optional, for WhatsApp, with country code)', f.phone)),
    f.part, f.note, el('button', { className: 'main' }, 'Add and make password'),
    el('p', { className: 'hint' }, 'Power = can they manage users. Job role fills the checklist, then tick or untick any area for this person.'))];
}
async function viewPeople() {
  const people = await manage('list'), login = ((S.user && S.user.email) || '').toLowerCase();
  const go = (t, cls, fn) => el('button', { className: cls, onclick: fn }, t);
  const cards = people.map(p => {
    const all = p.power === 'super_admin', n = p.areas.length, b = p.books.length, who = p.short_name || p.name;
    const me = (p.by_short_name ? p.short_name + '@people.tallydata.invalid' : p.email || '').toLowerCase() === login;
    const sees = all ? 'All companies, everything' : (p.job_role || 'Custom') + ' · ' + (n === AREAS.length ? 'all ' + n : n + ' of ' + AREAS.length) + ' data areas';
    const top = el('div', { className: 'split' }, el('div', { className: 'who' }, el('span', { className: 'av', 'aria-hidden': 'true' }, (who[0] || '?').toUpperCase()),
      el('div', {}, el('strong', {}, who), ' ', p.name && p.name.toLowerCase() !== who.toLowerCase() ? el('span', { className: 'soft' }, p.name + ' ') : null,
        el('span', { className: 'pill' + (all ? ' boss' : '') }, POWER[p.power]), me ? el('span', { className: 'pill you' }, 'You') : null, el('div', { className: 'soft' }, sees))));
    const edit = go('Edit', '', () => viewEdit(p));
    if (me) { top.append(edit); return el('div', { className: 'person' }, top); }            // nobody switches off or removes themselves by mistake
    top.append(el('div', { className: 'onoff' }, el('span', {}, p.active ? 'On' : 'Off'), el('button', { className: 'sw' + (p.active ? ' on' : ''), role: 'switch', 'aria-checked': String(p.active), 'aria-label': 'Access of ' + who,
      onclick: ev => busy(ev.currentTarget, async () => { await manage('active', { short_name: p.short_name, active: !p.active }); await open('People'); say(p.short_name + (p.active ? ' is switched off.' : ' is switched on.'), true); }) }, el('i'))));
    const list = el('div', { className: 'chips', hidden: true }, ...p.books.map(x => el('span', { className: 'pill' }, x))), label = () => b + (b === 1 ? ' company, ' : ' companies, ') + (list.hidden ? 'show' : 'hide');
    const toggle = all ? el('span', { className: 'soft' }, 'All companies') : !b ? el('span', { className: 'pill off' }, 'No company') : el('button', { className: 'link', 'aria-expanded': 'false',
      onclick: ev => { list.hidden = !list.hidden; ev.currentTarget.textContent = label(); ev.currentTarget.setAttribute('aria-expanded', String(!list.hidden)); } }, label());
    return el('div', { className: 'person' + (p.active ? '' : ' dim') }, top, el('div', { className: 'split foot' }, toggle, el('div', { className: 'acts' }, edit,
      go('Invite', '', () => newPassword(p, 'Make a new password and invite ' + p.short_name + '? The old password stops working.', 'Send the invite')),
      go('Reset pw', '', () => newPassword(p, 'Reset the password of ' + p.short_name + '? The old password stops working.', 'Password reset')),
      go('Remove', 'bad', () => question('Remove ' + p.short_name + '? Access stops at once.', async () => { await server('remove', { short_name: p.short_name }); await open('People'); say(p.short_name + ' is removed.', true); }, 'People')))), list);
  });
  return [el('div', { className: 'split head' }, el('h2', {}, 'People ', el('span', { className: 'soft' }, String(people.length))), el('div', { className: 'acts' }, el('button', { onclick: () => open('People') }, 'Refresh'), el('button', { className: 'main', onclick: () => open('Add a person') }, 'Add a person'))), ...cards];
}
function newPassword(p, text, title) { question(text, async () => { const r = await server('reset', { short_name: p.short_name }); showInvite(title, p.by_short_name ? p.short_name : p.email || p.short_name, r.password, p.email, p.phone); if (r.warn) say(r.warn); }, 'People'); }
function viewEdit(p) {
  const f = accessForm(p, ME.power === 'super_admin');
  say(''); alone(el('h2', {}, 'Edit ' + p.short_name), el('form', { noValidate: true, onsubmit: ev => { ev.preventDefault(); busy(ev.submitter, async () => {
    await manage('edit', { short_name: p.short_name, ...f.read() }); await open('People'); say(p.short_name + ' is saved.', true); }); } },
    el('div', { className: 'row' }, el('label', {}, 'Full name', f.name), el('label', {}, 'Power', f.power)),
    el('div', { className: 'row' }, el('label', {}, 'Email', f.email), el('label', {}, 'Phone', f.phone)), f.part, f.note,
    el('div', { className: 'acts' }, el('button', { className: 'main' }, 'Save'), el('button', { type: 'button', onclick: () => open('People') }, 'Cancel'))));
}
async function viewUnsorted() {
  const all = await manage('unsorted');
  const pick = el('select', {}, el('option', { value: '' }, 'All companies'), ...[...new Set(all.map(x => x.book))].map(b => el('option', { value: b }, b)));
  const body = el('div');
  const draw = () => {
    const rows = all.filter(x => !x.done && (!pick.value || x.book === pick.value));
    body.replaceChildren(el('p', { className: 'hint' }, rows.length + ' ledgers are hidden from everyone but super-admins until you choose an area.'), table(['Company', 'Ledger', 'Tally group', 'Area'], rows.slice(0, 200).map(x => {
      const sel = el('select', { onchange: ev => busy(ev.target, async () => { await manage('sort_ledger', { book: x.book, ledger: x.ledger, area: sel.value }); x.done = true; draw(); say(x.ledger + ' is sorted.', true); }) },
        el('option', { value: '' }, 'Choose…'), ...LEDGER_AREAS.map(k => el('option', { value: k }, Object.fromEntries(AREAS)[k])));
      return [x.book, x.ledger, x.group, sel];
    })));
  };
  pick.addEventListener('change', draw); draw();
  return [el('h2', {}, 'Unsorted ledgers'), el('label', { style: 'max-width:420px' }, 'Company', pick), body];
}
async function viewLog() {
  const rows = await manage('log', { limit: 200 });
  return [el('div', { className: 'split' }, el('h2', {}, 'Usage log'), el('button', { onclick: () => open('Usage log') }, 'Refresh')), table(['Time', 'Name', 'Status', 'Asked', 'Rows', 'ms', 'Computer', 'Detail'], rows.map(r => [
    new Date(r.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), r.name || 'unknown', el('span', { className: 'pill' + (r.ok ? '' : ' off') }, r.ok ? 'ok' : 'refused'),
    r.question.replace('manage:', 'admin: '), r.rows, r.ms, r.computer || '',
    r.note || Object.entries(r.params || {}).filter(([k, v]) => v !== '' && v !== null && !['email', 'phone', 'limit', 'user_id'].includes(k)).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('; ')]))];
}
async function viewMine() {
  const u = await auth('/user', { method: 'GET' });
  const on = (u.factors || []).some(f => f.status === 'verified');
  const pw = el('input', { type: 'password', autocomplete: 'new-password', minLength: 12, required: true });
  return [el('h2', {}, 'My access'), el('p', {}, el('span', { className: 'pill' }, POWER[ME.power])),
    el('p', {}, 'Companies: ' + (ME.power === 'super_admin' ? 'all ' + BOOKS.length : ME.books.join(', ') || 'none')), el('p', {}, 'Data: ' + (ME.power === 'super_admin' ? 'everything' : ME.areas.join(', ') || 'none')),
    el('form', { onsubmit: ev => { ev.preventDefault(); busy(ev.submitter, async () => {
      const v = pw.value; pw.value = ''; await auth('/user', { method: 'PUT', body: { password: v } }); say('Your password is changed.', true); }); } },
      el('label', { style: 'max-width:360px;margin-top:14px' }, 'New password (12 characters or more)', pw), el('button', {}, 'Change password')),
    el('p', { style: 'margin-top:16px' }, 'Two-step sign-in (optional) is ' + (on ? 'on.' : 'off.')), on ? null : el('button', { onclick: ev => busy(ev.target, () => startEnrol(true)) }, 'Set up two-step sign-in'),
    el('p', { className: 'hint' }, 'The database checks who you are on every action. This page holds only the public key.')].filter(Boolean);
}

if (typeof CFG === 'undefined' || !CFG.url) say('The page is not set up: config.js is missing.'); else show('signIn');