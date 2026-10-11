import { app } from '../app.js';
import { db, uid, saveSettings, DEFAULT_SETTINGS } from '../db.js';
import { $, esc, toast, confirmBox, saveFile, parseCSV, toCSV, sha256, ymd, digitsOnly, validators } from '../util.js';
import { loadCore, empty, fab, ICONS } from './common.js';
import { loadDemo } from '../demo.js';

export async function menu() {
  app.title('More');
  const items = [
    ['#/payments', ICONS.cash, 'Payments', 'Wages paid and advances given'],
    ['#/reports', ICONS.report, 'Reports', 'PDF and Excel for staff, attendance, wages, PF/ESIC'],
    ['#/leaves', ICONS.leave, 'Leaves', 'Record paid and unpaid leave'],
    ['#/orgs', ICONS.building, 'Companies', 'Where your workers are placed'],
    ['#/settings', ICONS.gear, 'Settings', 'Firm details, PF/ESIC rates, PIN lock, voice'],
    ['#/backup', ICONS.save, 'Backup and import', 'Save your data, move to a new phone, import from Excel'],
  ];
  return `
    <div class="sheet menu">${items.map(([h, i, t, d]) => `<a href="${h}">${i}<span class="main">${t}<small>${d}</small></span>${ICONS.right}</a>`).join('')}</div>
    <p class="small muted center">KaamKhata 1.0 · your data stays on this phone</p>`;
}

// ---------------- companies ----------------
export async function orgs() {
  app.title('Companies', { back: true });
  const { orgs: list, employees } = await loadCore();
  const editId = app.params.get('edit');
  const editing = list.find((o) => o.id === editId);
  const showForm = app.params.get('new') === '1' || editing || !list.length;
  const o = editing || {};
  return {
    html: `
      <form class="sheet" id="of" ${showForm ? '' : 'hidden'}>
        <div class="sheet-head"><h2>${editing ? 'Edit company' : 'Add company'}</h2></div>
        <div class="sheet-body">
          <label class="field"><span>Company / unit name</span><input class="input" name="name" required value="${esc(o.name || '')}" placeholder="e.g. Sunrise Auto Parts, Plot D-12"></label>
          <label class="field"><span>Location</span><input class="input" name="address" value="${esc(o.address || '')}" placeholder="MIDC area, city"></label>
          <div class="grid2">
            <label class="field"><span>Contact person</span><input class="input" name="contact" value="${esc(o.contact || '')}"></label>
            <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" inputmode="numeric" value="${esc(o.phone || '')}"></label>
          </div>
          <div class="row">${editing ? `<button type="button" class="btn quiet" id="delOrg">${ICONS.trash}</button>` : ''}<button class="btn grow">${ICONS.check} ${editing ? 'Save changes' : 'Save company'}</button></div>
        </div>
      </form>
      <div class="sheet ledger">
        ${list.length ? `<div class="sheet-head"><h2>${list.length} ${list.length === 1 ? 'company' : 'companies'}</h2></div>` + list.map((x, i) => {
          const n = employees.filter((e) => e.orgId === x.id && e.status !== 'left').length;
          return `<a class="row-item" href="#/orgs?edit=${x.id}"><span class="lnum">${i + 1}</span><div class="main"><div class="t1">${esc(x.name)}</div><div class="t2">${esc([x.address, x.contact].filter(Boolean).join(' · '))}</div></div><div class="right muted small">${n} workers</div></a>`;
        }).join('') : empty('No companies yet', 'Add the factory or unit your workers go to.')}
      </div>`,
    bind(root) {
      if (!showForm) fab(`<a class="btn" href="#/orgs?new=1">${ICONS.plus} Add company</a>`);
      $('#of', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        d.name = d.name.trim();
        if (!d.name) return toast('Enter the company name.', 'bad');
        await db.put('orgs', { ...o, ...d });
        toast(editing ? 'Company saved.' : `${d.name} added.`);
        app.go('#/orgs');
        if (!app.params.get('new') && !editing) window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      $('#delOrg', root)?.addEventListener('click', async () => {
        if (employees.some((e) => e.orgId === editId)) return toast('Move its workers to another company first.', 'bad');
        if (!(await confirmBox(`Delete ${o.name}?`))) return;
        await db.del('orgs', editId);
        app.go('#/orgs');
      });
    },
  };
}

// ---------------- settings ----------------
export async function settings() {
  app.title('Settings', { back: true });
  const s = await app.refreshSettings();
  const n = (name, label, hint = '', step = 'any') => `<label class="field"><span>${label}</span><input class="input" type="number" step="${step}" inputmode="decimal" name="${name}" value="${esc(s[name])}">${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
  const theme = (() => { try { return localStorage.getItem('theme') || ''; } catch (_) { return ''; } })();
  return {
    html: `
      <form id="sf">
        <div class="sheet"><div class="sheet-head"><h2>Your firm</h2></div><div class="sheet-body">
          <label class="field"><span>Firm name</span><input class="input" name="firmName" value="${esc(s.firmName)}" placeholder="e.g. Shree Ganesh Labour Contractors"></label>
          <div class="grid2">
            <label class="field"><span>Your name</span><input class="input" name="ownerName" value="${esc(s.ownerName)}"></label>
            <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(s.phone)}"></label>
          </div>
        </div></div>

        <div class="sheet"><div class="sheet-head"><h2>Wage rules</h2></div><div class="sheet-body">
          <div class="grid2">
            ${n('pfRate', 'PF worker %')}${n('employerPfRate', 'PF employer %', 'Includes admin and EDLI')}
            ${n('pfWageCap', 'PF wage limit (₹)', 'PF is worked on wages up to this', '1')}${n('esicLimit', 'ESIC wage limit (₹)', 'No ESIC above this monthly wage', '1')}
            ${n('esicRate', 'ESIC worker %')}${n('employerEsicRate', 'ESIC employer %')}
            ${n('hoursPerDay', 'Hours in a shift', '', '0.5')}${n('otMultiplier', 'Overtime rate ×', 'Factories Act: 2× ordinary rate', '0.5')}
          </div>
          <label class="check"><input type="checkbox" name="ptEnabled" ${s.ptEnabled ? 'checked' : ''}> Deduct Maharashtra profession tax</label>
          <label class="check"><input type="checkbox" name="weeklyOffPaid" ${s.weeklyOffPaid ? 'checked' : ''}> Pay daily-wage workers for weekly off</label>
          <p class="small muted">Rates change from time to time. Check the latest PF/ESIC notifications and minimum wages for your zone.</p>
        </div></div>

        <div class="sheet"><div class="sheet-head"><h2>Voice</h2></div><div class="sheet-body">
          <label class="field"><span>Language you speak in</span><select class="input" name="voiceLang">
            ${[['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['mr-IN', 'Marathi']].map(([v, l]) => `<option value="${v}" ${s.voiceLang === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <label class="check"><input type="checkbox" name="speakBack" ${s.speakBack ? 'checked' : ''}> Read out confirmations</label>
        </div></div>

        <div class="sheet"><div class="sheet-head"><h2>Look</h2></div><div class="sheet-body">
          <div class="seg" role="radiogroup" aria-label="Theme">
            ${[['', 'Phone setting'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          </div>
        </div></div>
        <button class="btn block" style="margin-bottom:14px">${ICONS.check} Save settings</button>
      </form>

      <div class="sheet"><div class="sheet-head"><h2>PIN lock</h2><span class="aside">${s.pinHash ? 'On' : 'Off'}</span></div><div class="sheet-body">
        <p class="small muted">Ask for a 4-digit PIN when the app opens. If you forget it, you will need to clear the app's data, so keep a backup.</p>
        <div class="row">
          <input class="input grow" id="pin" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="New 4-digit PIN" style="max-width:200px" aria-label="New PIN">
          <button class="btn ghost" id="setPin">${s.pinHash ? 'Change PIN' : 'Turn on'}</button>
          ${s.pinHash ? '<button class="btn quiet" id="offPin">Turn off</button>' : ''}
        </div>
      </div></div>`,
    bind(root) {
      const f = $('#sf', root);
      f.addEventListener('change', (e) => {
        if (e.target.name !== 'theme') return;
        const v = e.target.value;
        try { v ? localStorage.setItem('theme', v) : localStorage.removeItem('theme'); } catch (_) { /* storage blocked */ }
        v ? document.documentElement.setAttribute('data-theme', v) : document.documentElement.removeAttribute('data-theme');
      });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        const next = { ...s };
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (k === 'id' || k === 'pinHash') continue;
          if (typeof DEFAULT_SETTINGS[k] === 'boolean') next[k] = !!fd.get(k);
          else if (typeof DEFAULT_SETTINGS[k] === 'number') next[k] = Number(fd.get(k)) || 0;
          else if (fd.has(k)) next[k] = String(fd.get(k)).trim();
        }
        await saveSettings(next);
        await app.refreshSettings();
        toast('Settings saved.');
      });
      $('#setPin', root).addEventListener('click', async () => {
        const v = $('#pin', root).value;
        if (!/^\d{4}$/.test(v)) return toast('PIN must be 4 digits.', 'bad');
        await saveSettings({ ...(await app.refreshSettings()), pinHash: await sha256('kk:' + v) });
        await app.refreshSettings();
        toast('PIN lock is on.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      $('#offPin', root)?.addEventListener('click', async () => {
        await saveSettings({ ...(await app.refreshSettings()), pinHash: '' });
        await app.refreshSettings();
        toast('PIN lock is off.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}

// ---------------- backup ----------------
const IMPORT_COLS = ['name', 'fatherName', 'phone', 'gender', 'designation', 'wageType', 'rate', 'joinDate', 'aadhaar', 'pan', 'uan', 'esic', 'bankName', 'accountNo', 'ifsc', 'address', 'company'];

export async function backup() {
  app.title('Backup and import', { back: true });
  const { employees } = await loadCore();
  let last = '';
  try { last = localStorage.getItem('lastBackup') || ''; } catch (_) { /* ignore */ }
  return {
    html: `
      <div class="sheet"><div class="sheet-head"><h2>Backup</h2><span class="aside">${last ? 'Last: ' + esc(last) : 'Never taken'}</span></div><div class="sheet-body stack">
        <p class="small muted">Your register lives only on this phone. Take a backup every week and send it to yourself on WhatsApp, email or Google Drive.</p>
        <button class="btn block" id="exp">${ICONS.save} Save backup file</button>
        <label class="btn ghost block" style="cursor:pointer">Restore from backup<input type="file" accept=".json,application/json" id="imp" hidden></label>
      </div></div>

      <div class="sheet"><div class="sheet-head"><h2>Import workers from Excel</h2></div><div class="sheet-body stack">
        <p class="small muted">Download the template, fill one worker per row in Excel or Google Sheets, save as CSV and import it here. Companies are created if they don't exist.</p>
        <button class="btn ghost block" id="tpl">${ICONS.grid} Download template</button>
        <label class="btn ghost block" style="cursor:pointer">Import CSV<input type="file" accept=".csv,text/csv" id="csvIn" hidden></label>
        <div id="importResult" class="small"></div>
      </div></div>

      <div class="sheet"><div class="sheet-head"><h2>Try with sample data</h2></div><div class="sheet-body stack">
        <p class="small muted">Fills the app with 24 made-up workers, two companies, two months of attendance and some payments, so you can explore. ${employees.length ? 'This replaces what is in the app now.' : ''}</p>
        <button class="btn quiet block" id="demo">Load sample data</button>
        <button class="btn quiet block" id="wipe" style="color:var(--bad)">${ICONS.trash} Erase everything</button>
      </div></div>`,
    bind(root) {
      $('#exp', root).addEventListener('click', async () => {
        const data = await db.exportAll();
        await saveFile(`kaamkhata-backup-${ymd()}.json`, JSON.stringify(data), 'application/json');
        try { localStorage.setItem('lastBackup', ymd()); } catch (_) { /* ignore */ }
        toast('Backup file ready.');
      });
      $('#imp', root).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const json = JSON.parse(await file.text());
          const n = json?.data?.employees?.length ?? 0;
          if (!(await confirmBox(`Replace everything in the app with this backup (${n} workers)?`, 'Restore'))) return;
          await db.importAll(json);
          await app.refreshSettings();
          toast('Backup restored.');
          app.go('#/');
        } catch (err) {
          toast(err.message.includes('JSON') ? 'That file is not a KaamKhata backup.' : err.message, 'bad');
        }
      });
      $('#tpl', root).addEventListener('click', () =>
        saveFile('kaamkhata-workers-template.csv', '﻿' + toCSV([IMPORT_COLS, ['Ramesh Patil', 'Sopan Patil', '9876543210', 'M', 'Welder', 'daily', '650', ymd(), '', '', '', '', 'Bank of Maharashtra', '', '', 'Chakan, Pune', 'Sunrise Auto Parts']]), 'text/csv'));
      $('#csvIn', root).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const res = await importCSV(await file.text());
        $('#importResult', root).innerHTML = `<b>${res.added} workers added.</b>${res.problems.length ? `<br><span style="color:var(--warn)">Check these rows:</span><br>${res.problems.map(esc).join('<br>')}` : ''}`;
        toast(`${res.added} workers imported.`);
      });
      $('#demo', root).addEventListener('click', async () => {
        if (employees.length && !(await confirmBox('Replace all your data with sample data?', 'Replace'))) return;
        await loadDemo();
        await app.refreshSettings();
        toast('Sample data loaded.');
        app.go('#/');
      });
      $('#wipe', root).addEventListener('click', async () => {
        if (!(await confirmBox('Erase all workers, attendance, payments and settings from this phone? Take a backup first.', 'Erase'))) return;
        await db.importAll({ app: 'kaamkhata', data: {} });
        await app.refreshSettings();
        toast('Everything erased.');
        app.go('#/');
      });
    },
  };
}

async function importCSV(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  const head = rows.shift().map((h) => h.trim());
  const { orgs, employees } = await loadCore();
  const orgByName = Object.fromEntries(orgs.map((o) => [o.name.toLowerCase(), o]));
  let maxCode = employees.reduce((m, x) => Math.max(m, Number(String(x.code || '').replace(/\D/g, '')) || 0), 0);
  const problems = [];
  const out = [];
  for (const [i, r] of rows.entries()) {
    const o = Object.fromEntries(head.map((h, j) => [h, (r[j] || '').trim()]));
    if (!o.name) { problems.push(`Row ${i + 2}: name missing, skipped.`); continue; }
    let orgId = '';
    if (o.company) {
      let org = orgByName[o.company.toLowerCase()];
      if (!org) { org = await db.put('orgs', { id: uid(), name: o.company }); orgByName[o.company.toLowerCase()] = org; }
      orgId = org.id;
    }
    const emp = {
      id: uid(), code: 'W' + String(++maxCode).padStart(3, '0'), name: o.name, fatherName: o.fatherName || '',
      phone: digitsOnly(o.phone).slice(-10), gender: /^f/i.test(o.gender) ? 'F' : 'M', designation: o.designation || '',
      wageType: /month/i.test(o.wageType) ? 'monthly' : 'daily', rate: Number(o.rate) || 0, joinDate: /^\d{4}-\d{2}-\d{2}$/.test(o.joinDate) ? o.joinDate : ymd(),
      aadhaar: digitsOnly(o.aadhaar), pan: (o.pan || '').toUpperCase(), uan: digitsOnly(o.uan), esic: digitsOnly(o.esic),
      bankName: o.bankName || '', accountNo: digitsOnly(o.accountNo), ifsc: (o.ifsc || '').toUpperCase(), address: o.address || '',
      orgId, status: 'active', skill: 'Unskilled', pfApplicable: true, esicApplicable: true, docs: [],
    };
    const issues = [['phone', 'phone'], ['aadhaar', 'aadhaar'], ['pan', 'pan'], ['ifsc', 'ifsc'], ['uan', 'uan']].map(([k, v]) => validators[v](emp[k])).filter(Boolean);
    if (!emp.rate) issues.push('rate missing');
    if (issues.length) problems.push(`Row ${i + 2} (${emp.name}): ${issues.join(' ')}`);
    out.push(emp);
  }
  if (out.length) await db.putMany('employees', out);
  return { added: out.length, problems };
}
