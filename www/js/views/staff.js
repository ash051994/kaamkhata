import { app } from '../app.js';
import { db } from '../db.js';
import {
  $, $$, esc, money, num, ym, ymd, monthLabel, dateLabel, toast, confirmBox, validators, digitsOnly,
  maskAadhaar, fmtAadhaar, compressImage,
} from '../util.js';
import { countAttendance, ledgerFor, calcPay } from '../payroll.js';
import { parseEmployeeSpeech, listen, speak, voiceSupport } from '../voice.js';
import { loadCore, avatar, orgOptions, fab, empty, ICONS, DOC_TYPES, docStatus } from './common.js';

// ---------------- list ----------------
export async function list() {
  app.title('Staff', { actions: `<button class="icon-btn" id="voiceAdd" aria-label="Add worker by voice">${ICONS.mic}</button>` });
  const { employees, orgs, orgMap } = await loadCore();
  const filter = app.params.get('f') || 'active';
  const org = app.params.get('org') || '';

  const html = `
    <label class="search">${ICONS.search}<input class="input" id="q" type="search" placeholder="Search name, mobile or code" autocomplete="off" aria-label="Search staff"></label>
    <div class="chips" role="group" aria-label="Filter">
      ${[['active', 'Working'], ['kyc', 'KYC pending'], ['left', 'Left'], ['all', 'All']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
      ${orgs.length > 1 ? orgs.map((o) => `<button class="chip ${org === o.id ? 'on' : ''}" data-org="${o.id}">${esc(o.name)}</button>`).join('') : ''}
    </div>
    <div class="sheet ledger" id="listSheet"></div>`;

  return {
    html,
    bind(root) {
      fab(`<a class="btn" href="#/staff/new">${ICONS.plus} Add worker</a>`);
      $('#voiceAdd').onclick = () => app.go('#/staff/new?voice=1');
      const draw = () => {
        const q = $('#q', root).value.trim().toLowerCase();
        let rows = employees.filter((e) => {
          if (filter === 'active' && e.status === 'left') return false;
          if (filter === 'left' && e.status !== 'left') return false;
          if (filter === 'kyc' && (e.status === 'left' || docStatus(e).key === 'ok')) return false;
          if (org && e.orgId !== org) return false;
          if (!q) return true;
          return [e.name, e.phone, e.code, e.designation].some((v) => String(v || '').toLowerCase().includes(q));
        });
        $('#listSheet', root).innerHTML = rows.length
          ? `<div class="sheet-head"><h2>${rows.length} ${rows.length === 1 ? 'worker' : 'workers'}</h2><span class="aside">Daily rate / salary</span></div>` +
            rows.map((e, i) => `
              <a class="row-item" href="#/staff/${e.id}">
                <span class="lnum">${i + 1}</span>${avatar(e)}
                <div class="main">
                  <div class="t1">${esc(e.name)}</div>
                  <div class="t2">${esc([e.code, e.designation, orgMap[e.orgId]?.name].filter(Boolean).join(' · '))}</div>
                </div>
                <div class="right">
                  <div class="amt">${money(e.rate)}<span class="muted small">/${e.wageType === 'monthly' ? 'mo' : 'day'}</span></div>
                  <span class="tag ${docStatus(e).key}">${esc(docStatus(e).label)}</span>
                </div>
              </a>`).join('')
          : empty(employees.length ? 'No one matches' : 'No workers yet', employees.length ? 'Try another name or filter.' : 'Add the people you supply to the company. You can speak the details instead of typing.',
              employees.length ? '' : `<div class="row" style="justify-content:center"><a class="btn" href="#/staff/new">${ICONS.plus} Add worker</a><a class="btn ghost" href="#/staff/new?voice=1">${ICONS.mic} Say it</a></div>`);
      };
      $('#q', root).addEventListener('input', draw);
      root.addEventListener('click', (e) => {
        const c = e.target.closest('.chip');
        if (!c) return;
        const p = new URLSearchParams(app.params);
        if (c.dataset.f) p.set('f', c.dataset.f);
        if (c.dataset.org !== undefined) (org === c.dataset.org ? p.delete('org') : p.set('org', c.dataset.org));
        app.go('#/staff?' + p.toString());
      });
      draw();
    },
  };
}

// ---------------- detail ----------------
export async function detail(id) {
  const emp = await db.get('employees', id);
  if (!emp) throw new Error('This worker was deleted.');
  const { orgMap } = await loadCore();
  app.title(emp.name, { back: true, actions: `<a class="icon-btn" href="#/staff/${id}/edit" aria-label="Edit">${ICONS.edit}</a>` });
  const month = ym();
  const [att, payments, payroll] = await Promise.all([db.by('attendance', 'empId', id), db.all('payments'), db.all('payroll')]);
  const monthAtt = att.filter((a) => a.month === month);
  const c = countAttendance(monthAtt);
  const est = calcPay(emp, monthAtt, app.settings, month, {});
  const led = ledgerFor(id, payments, payroll);
  const pays = payments.filter((p) => p.empId === id).sort((a, b) => b.date.localeCompare(a.date));
  const ds = docStatus(emp);

  const info = [
    ['Code', emp.code],
    ['Mobile', emp.phone ? `<a href="tel:${esc(emp.phone)}">${esc(emp.phone)}</a>` : ''],
    ['Company', esc(orgMap[emp.orgId]?.name || '')],
    ['Work', esc([emp.designation, emp.skill].filter(Boolean).join(', '))],
    ['Wage', `${money(emp.rate)} per ${emp.wageType === 'monthly' ? 'month' : 'day'}`],
    ['Joined', esc(dateLabel(emp.joinDate))],
    ['Aadhaar', esc(maskAadhaar(emp.aadhaar))],
    ['UAN (PF)', esc(emp.uan || (emp.pfApplicable ? 'Not added' : 'PF not applicable'))],
    ['ESIC', esc(emp.esic || (emp.esicApplicable ? 'Not added' : 'Not applicable'))],
    ['Bank', esc([emp.bankName, emp.accountNo ? '••' + String(emp.accountNo).slice(-4) : '', emp.ifsc].filter(Boolean).join(' · '))],
    ['Father', esc(emp.fatherName || '')],
    ['Address', esc(emp.address || '')],
  ].filter(([, v]) => v);

  return {
    html: `
      <div class="sheet">
        <div class="sheet-body row" style="gap:14px">
          ${avatar(emp, 'lg')}
          <div class="grow">
            <h2 style="font-size:1.2rem">${esc(emp.name)}</h2>
            <div class="muted">${esc(emp.designation || 'Worker')}${emp.status === 'left' ? ' · <span class="tag off">Left</span>' : ''}</div>
            <a class="tag ${ds.key}" href="#/staff/${id}/docs" style="margin-top:6px;text-decoration:none">${esc(ds.label)}</a>
          </div>
        </div>
        <div class="figures">
          <div><div class="k">Wages due</div><div class="v ${led.due > 0 ? 'bad' : ''}">${money(led.due)}</div></div>
          <div><div class="k">Advance to recover</div><div class="v">${money(led.advanceOutstanding)}</div></div>
          <div><div class="k">${esc(monthLabel(month))} days</div><div class="v">${num(est.payDays)}</div></div>
          <div><div class="k">Earned so far</div><div class="v">${money(est.gross)}</div></div>
        </div>
        <div class="sheet-body row">
          <a class="btn sm grow" href="#/payments?new=salary&emp=${id}">${ICONS.cash} Pay</a>
          <a class="btn sm ghost grow" href="#/payments?new=advance&emp=${id}">Advance</a>
          <a class="btn sm ghost grow" href="#/wages/${id}/${month}">Payslip</a>
        </div>
      </div>

      <div class="sheet ledger">
        <div class="sheet-head"><h2>This month</h2><a class="aside" href="#/attendance/month">Register</a></div>
        <div class="sheet-body row" style="gap:6px">
          ${[['P', c.P], ['H', c.H], ['A', c.A], ['PL', c.PL], ['UL', c.UL], ['WO', c.WO], ['HO', c.HO]].map(([k, v]) => `<span class="mark ${k}" title="${k}">${k === 'H' ? '½' : k} ${v}</span>`).join('')}
          ${c.ot ? `<span class="att-ot">OT ${num(c.ot)} h</span>` : ''}
        </div>
      </div>

      <div class="sheet ledger">
        <div class="sheet-head"><h2>Payments</h2><span class="aside">${pays.length}</span></div>
        ${pays.length ? pays.slice(0, 12).map((p, i) => `
          <div class="row-item">
            <span class="lnum">${i + 1}</span>
            <div class="main"><div class="t1">${p.type === 'advance' ? 'Advance' : `Wages for ${esc(monthLabel(p.month))}`}</div><div class="t2">${esc(dateLabel(p.date))} · ${esc(p.mode || 'Cash')}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
            <div class="right amt" style="color:${p.type === 'advance' ? 'var(--warn)' : 'var(--ok)'}">${money(p.amount)}</div>
          </div>`).join('') : `<div class="sheet-body muted">No money given yet.</div>`}
      </div>

      <div class="sheet ledger">
        <div class="sheet-head"><h2>Details</h2></div>
        <div class="sheet-body">
          ${info.map(([k, v]) => `<div class="wage-line"><span class="muted">${k}</span><span class="amt">${v}</span></div>`).join('')}
        </div>
      </div>
      <div class="row">
        <a class="btn ghost grow" href="#/staff/${id}/docs">${ICONS.doc} Documents</a>
        <a class="btn quiet grow" href="#/staff/${id}/edit">${ICONS.edit} Edit</a>
      </div>`,
  };
}

// ---------------- form ----------------
const FIELD_CHECKS = { phone: 'phone', aadhaar: 'aadhaar', pan: 'pan', ifsc: 'ifsc', uan: 'uan', esic: 'esic', accountNo: 'account', emergencyPhone: 'phone' };

export async function form(id) {
  const editing = !!id;
  const { orgs, employees } = await loadCore();
  let emp = editing ? await db.get('employees', id) : null;
  if (editing && !emp) throw new Error('This worker was deleted.');
  if (!emp) {
    emp = {
      wageType: 'daily', status: 'active', gender: 'M', skill: 'Unskilled', pfApplicable: true, esicApplicable: true,
      joinDate: ymd(), orgId: app.params.get('org') || orgs[0]?.id || '', rate: '',
    };
  }
  app.title(editing ? 'Edit worker' : 'New worker', {
    back: true,
    actions: `<button class="icon-btn" id="voiceBtn" aria-label="Fill by voice">${ICONS.mic}</button>`,
  });

  const f = (name, label, { type = 'text', hint = '', attrs = '', value } = {}) => `
    <label class="field" data-f="${name}"><span>${label}</span>
      <input name="${name}" type="${type}" value="${esc(value ?? emp[name] ?? '')}" ${attrs}>
      ${hint ? `<small class="hint">${hint}</small>` : ''}<small class="msg" aria-live="polite"></small>
    </label>`;

  const html = `
    <form id="empForm" class="sheet" novalidate autocomplete="off">
      <div class="form-section">
        <div class="row" style="gap:14px;margin-bottom:14px">
          <label class="avatar lg" id="photoPick" style="cursor:pointer" title="Add photo">
            ${emp.photo ? `<img src="${emp.photo}" alt="">` : ICONS.camera}
            <input type="file" accept="image/*" capture="user" id="photoIn" hidden>
          </label>
          <div class="grow muted small">Tap the circle to take the worker's photo.</div>
        </div>
        ${f('name', 'Full name', { attrs: 'required autocapitalize="words"' })}
        ${f('fatherName', "Father's / husband's name", { attrs: 'autocapitalize="words"' })}
        <div class="grid2">
          ${f('phone', 'Mobile', { type: 'tel', attrs: 'inputmode="numeric" maxlength="14"' })}
          <label class="field"><span>Gender</span>
            <select name="gender">${[['M', 'Male'], ['F', 'Female'], ['O', 'Other']].map(([v, l]) => `<option value="${v}" ${emp.gender === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
        </div>
        <div class="grid2">
          ${f('dob', 'Date of birth', { type: 'date' })}
          ${f('emergencyPhone', 'Emergency contact', { type: 'tel', attrs: 'inputmode="numeric"' })}
        </div>
        <label class="field"><span>Address</span><textarea name="address" rows="2">${esc(emp.address || '')}</textarea></label>
      </div>

      <fieldset class="form-section"><legend>Work</legend>
        <label class="field"><span>Company</span>
          ${orgs.length ? `<select name="orgId">${orgOptions(orgs, emp.orgId)}</select>` : `<a class="btn ghost block" href="#/orgs?new=1">${ICONS.plus} Add company first</a>`}
        </label>
        <div class="grid2">
          ${f('designation', 'Work / post', { attrs: 'list="desigList" placeholder="Helper, Welder…"' })}
          <label class="field"><span>Skill</span>
            <select name="skill">${['Unskilled', 'Semi-skilled', 'Skilled', 'Highly skilled'].map((v) => `<option ${emp.skill === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          </label>
        </div>
        <datalist id="desigList">${['Helper', 'Loader', 'Welder', 'Fitter', 'Machine operator', 'Electrician', 'Housekeeping', 'Security guard', 'Packer', 'Forklift driver', 'Supervisor'].map((d) => `<option value="${d}">`).join('')}</datalist>
        <div class="field"><span style="display:block;font-size:.85rem;font-weight:600;color:var(--ink-2);margin-bottom:4px">Paid</span>
          <div class="seg" role="radiogroup" aria-label="Wage type">
            <label><input type="radio" name="wageType" value="daily" ${emp.wageType !== 'monthly' ? 'checked' : ''}><span>Per day</span></label>
            <label><input type="radio" name="wageType" value="monthly" ${emp.wageType === 'monthly' ? 'checked' : ''}><span>Per month</span></label>
          </div>
        </div>
        <div class="grid2">
          ${f('rate', 'Rate (₹)', { type: 'number', attrs: 'inputmode="decimal" min="0" required' })}
          ${f('joinDate', 'Joined on', { type: 'date' })}
        </div>
        ${editing ? `<div class="grid2">
          <label class="field"><span>Status</span><select name="status"><option value="active" ${emp.status !== 'left' ? 'selected' : ''}>Working</option><option value="left" ${emp.status === 'left' ? 'selected' : ''}>Left</option></select></label>
          ${f('exitDate', 'Left on', { type: 'date' })}
        </div>` : ''}
      </fieldset>

      <fieldset class="form-section"><legend>ID and statutory</legend>
        ${f('aadhaar', 'Aadhaar number', { type: 'text', attrs: 'inputmode="numeric" maxlength="14"', value: fmtAadhaar(emp.aadhaar) })}
        <div class="grid2">
          ${f('pan', 'PAN', { attrs: 'maxlength="10" style="text-transform:uppercase"' })}
          ${f('uan', 'UAN (PF)', { attrs: 'inputmode="numeric" maxlength="12"' })}
        </div>
        ${f('esic', 'ESIC IP number', { attrs: 'inputmode="numeric" maxlength="17"' })}
        <label class="check"><input type="checkbox" name="pfApplicable" ${emp.pfApplicable ? 'checked' : ''}> Deduct PF</label>
        <label class="check"><input type="checkbox" name="esicApplicable" ${emp.esicApplicable ? 'checked' : ''}> Deduct ESIC</label>
      </fieldset>

      <fieldset class="form-section"><legend>Bank</legend>
        ${f('bankName', 'Bank name')}
        <div class="grid2">
          ${f('accountNo', 'Account number', { attrs: 'inputmode="numeric"' })}
          ${f('ifsc', 'IFSC', { attrs: 'maxlength="11" style="text-transform:uppercase"' })}
        </div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(emp.notes || '')}</textarea></label>
      </fieldset>

      <div class="form-section row">
        ${editing ? `<button type="button" class="btn quiet" id="delBtn">${ICONS.trash} Delete</button>` : ''}
        <button class="btn grow" type="submit">${ICONS.check} ${editing ? 'Save changes' : 'Save worker'}</button>
      </div>
    </form>`;

  return {
    html,
    bind(root) {
      const formEl = $('#empForm', root);
      let photo = emp.photo || '';

      const check = (name) => {
        const fld = $(`.field[data-f="${name}"]`, root);
        const input = formEl.elements[name];
        if (!fld || !input) return '';
        let msg = FIELD_CHECKS[name] ? validators[FIELD_CHECKS[name]](input.value) : '';
        if (!msg && (name === 'aadhaar' || name === 'phone')) {
          const v = digitsOnly(input.value).slice(-10 - (name === 'aadhaar' ? 2 : 0));
          const dup = v && employees.find((e) => e.id !== emp.id && digitsOnly(e[name]).endsWith(v));
          if (dup) msg = `Already used by ${dup.name} (${dup.code}).`;
        }
        if (name === 'name' && !input.value.trim()) msg = 'Name is needed.';
        if (name === 'rate' && !(Number(input.value) > 0)) msg = 'Enter the daily rate or monthly salary.';
        fld.classList.toggle('err', !!msg);
        const m = $('.msg', fld);
        m.textContent = msg;
        m.classList.remove('okmsg');
        if (!msg && name === 'aadhaar' && digitsOnly(input.value).length === 12) {
          m.textContent = 'Aadhaar number format is valid.';
          m.classList.add('okmsg');
        }
        return msg;
      };
      formEl.addEventListener('focusout', (e) => e.target.name && check(e.target.name));
      formEl.elements.aadhaar.addEventListener('input', (e) => {
        const pos = e.target.value.length;
        e.target.value = fmtAadhaar(e.target.value).slice(0, 14);
        if (pos === e.target.value.length) e.target.setSelectionRange(pos, pos);
      });

      $('#photoIn', root).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        photo = await compressImage(file, 360, 0.75);
        $('#photoPick', root).querySelector('img, svg')?.remove();
        $('#photoPick', root).insertAdjacentHTML('afterbegin', `<img src="${photo}" alt="">`);
      });

      const fill = (data) => {
        const map = { ...data };
        if (map.aadhaar) map.aadhaar = fmtAadhaar(map.aadhaar);
        for (const [k, v] of Object.entries(map)) {
          const el = formEl.elements[k];
          if (!el || v === undefined || v === '') continue;
          if (el instanceof RadioNodeList) {
            [...el].forEach((r) => (r.checked = r.value === v));
          } else el.value = v;
          if (FIELD_CHECKS[k] || k === 'name' || k === 'rate') check(k);
        }
        if (data.orgName && !data.orgId) toast(`Company "${data.orgName}" is not in your list. Pick it from the list.`);
      };
      $('#voiceBtn').onclick = () => openVoice({ orgs, onApply: fill });
      if (app.params.get('voice') === '1') openVoice({ orgs, onApply: fill });

      $('#delBtn', root)?.addEventListener('click', async () => {
        if (!(await confirmBox(`Delete ${emp.name} with all attendance and payments? Mark them as "Left" instead if they only stopped working.`, 'Delete everything'))) return;
        const [att, pays, runs] = await Promise.all([db.by('attendance', 'empId', id), db.by('payments', 'empId', id), db.by('payroll', 'empId', id)]);
        await db.delMany('attendance', att.map((a) => a.id));
        await db.delMany('payments', pays.map((a) => a.id));
        await db.delMany('payroll', runs.map((a) => a.id));
        await db.del('employees', id);
        toast('Worker deleted.');
        app.go('#/staff');
      });

      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const names = ['name', 'rate', ...Object.keys(FIELD_CHECKS)];
        const errors = names.map(check).filter(Boolean);
        if (errors.length) {
          const first = $('.field.err input', root);
          first && first.focus();
          toast('Fix the highlighted fields first.', 'bad');
          return;
        }
        const fd = new FormData(formEl);
        const data = Object.fromEntries(fd.entries());
        const rec = {
          ...emp,
          ...data,
          name: data.name.trim().replace(/\s+/g, ' '),
          phone: digitsOnly(data.phone).replace(/^91(?=\d{10}$)/, ''),
          aadhaar: digitsOnly(data.aadhaar),
          pan: (data.pan || '').toUpperCase().trim(),
          ifsc: (data.ifsc || '').toUpperCase().trim(),
          uan: digitsOnly(data.uan),
          esic: digitsOnly(data.esic),
          accountNo: digitsOnly(data.accountNo),
          rate: Number(data.rate),
          pfApplicable: !!fd.get('pfApplicable'),
          esicApplicable: !!fd.get('esicApplicable'),
          photo,
          status: data.status || emp.status || 'active',
          docs: emp.docs || [],
        };
        if (!rec.code) {
          const max = employees.reduce((m, x) => Math.max(m, Number(String(x.code || '').replace(/\D/g, '')) || 0), 0);
          rec.code = 'W' + String(max + 1).padStart(3, '0');
        }
        const saved = await db.put('employees', rec);
        toast(editing ? 'Changes saved.' : `${saved.name} added as ${saved.code}.`);
        if (app.settings.speakBack && !editing) speak(`${saved.name} saved`, app.settings.voiceLang);
        app.go(editing ? `#/staff/${saved.id}` : `#/staff/${saved.id}/docs`);
      });
    },
  };
}

// ---------------- voice dialog ----------------
const LABELS = {
  name: 'Name', fatherName: "Father's name", phone: 'Mobile', aadhaar: 'Aadhaar', pan: 'PAN', uan: 'UAN', esic: 'ESIC',
  designation: 'Work', rate: 'Rate', wageType: 'Paid', accountNo: 'Account', ifsc: 'IFSC', bankName: 'Bank',
  address: 'Address', gender: 'Gender', joinDate: 'Joined', orgName: 'Company',
};

export function openVoice({ orgs, onApply }) {
  const lang = app.settings.voiceLang || 'en-IN';
  const support = voiceSupport();
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet-dialog';
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Fill by voice</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
    <div class="dlg-body">
      <p class="say-example">Say the field name, then its value. For example:<br>
      <b>“Name Ramesh Patil, mobile 98765 43210, work welder, wage 650 per day, aadhaar …”</b><br>
      Hindi and Marathi words work too: <b>नाव, मोबाईल, पगार, आधार</b>.</p>
      <button class="mic" id="micBtn" aria-label="Start speaking" ${support ? '' : 'disabled'}>${ICONS.mic}</button>
      <p class="center muted small" id="micState">${support ? 'Tap the microphone and speak' : 'This phone cannot listen here. Type the sentence below instead.'}</p>
      <label class="field"><span>What was heard (you can correct it)</span>
        <textarea id="heard" class="transcript" rows="3" placeholder="Name … mobile … wage …"></textarea>
      </label>
      <div class="parsed" id="parsed"></div>
      <div class="row" style="margin-top:14px"><button class="btn grow" id="applyBtn" disabled>${ICONS.check} Put into form</button></div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const heard = $('#heard', dlg);
  const micBtn = $('#micBtn', dlg);
  let ctrl = null;
  let parsed = {};

  const show = () => {
    parsed = parseEmployeeSpeech(heard.value, orgs);
    const entries = Object.entries(parsed).filter(([k]) => LABELS[k]);
    $('#parsed', dlg).innerHTML = entries.length
      ? entries.map(([k, v]) => {
          let val = v;
          if (k === 'wageType') val = v === 'monthly' ? 'Per month' : 'Per day';
          if (k === 'gender') val = v === 'F' ? 'Female' : 'Male';
          if (k === 'rate') val = money(v);
          if (k === 'orgName') val = parsed.orgId ? v : `${v} (not found)`;
          return `<div class="kv"><span>${LABELS[k]}</span><span>${esc(val)}</span></div>`;
        }).join('')
      : '';
    $('#applyBtn', dlg).disabled = !entries.length;
  };
  heard.addEventListener('input', show);

  const stop = () => {
    ctrl && ctrl.stop();
    ctrl = null;
    micBtn.classList.remove('live');
    micBtn.setAttribute('aria-label', 'Start speaking');
    $('#micState', dlg).textContent = 'Tap the microphone to speak again';
  };
  micBtn.addEventListener('click', () => {
    if (ctrl) return stop();
    const before = heard.value.trim();
    micBtn.classList.add('live');
    micBtn.setAttribute('aria-label', 'Stop');
    $('#micState', dlg).textContent = 'Listening… tap again when done';
    ctrl = listen({
      lang,
      onText: (t) => {
        heard.value = (before ? before + ' ' : '') + t;
        show();
      },
      onEnd: () => ctrl && stop(),
      onError: (m) => {
        toast(m, 'bad');
        stop();
      },
    });
  });
  const close = () => {
    stop();
    dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === dlg) close();
  });
  $('#applyBtn', dlg).addEventListener('click', () => {
    onApply(parsed);
    const n = Object.keys(parsed).length;
    if (app.settings.speakBack) speak(parsed.name ? `Got details for ${parsed.name}. Please check and save.` : 'Details filled. Please check and save.', lang);
    toast(`${n} ${n === 1 ? 'detail' : 'details'} filled. Check and save.`);
    close();
  });
}

// ---------------- documents ----------------
export async function docs(id) {
  const emp = await db.get('employees', id);
  if (!emp) throw new Error('This worker was deleted.');
  app.title('Documents', { back: true });
  emp.docs = emp.docs || [];
  const numberFor = { aadhaar: emp.aadhaar ? fmtAadhaar(emp.aadhaar) : '', pan: emp.pan, bank: emp.accountNo ? `${emp.bankName || ''} ${emp.accountNo} ${emp.ifsc || ''}`.trim() : '', uan: emp.uan, esic: emp.esic };
  const checks = { aadhaar: validators.aadhaar(emp.aadhaar), pan: validators.pan(emp.pan), bank: validators.account(emp.accountNo) || validators.ifsc(emp.ifsc), uan: validators.uan(emp.uan), esic: validators.esic(emp.esic) };

  const rows = DOC_TYPES.map(([type, label]) => {
    const d = emp.docs.find((x) => x.type === type);
    const numTxt = numberFor[type];
    const fmtProblem = numTxt ? checks[type] : '';
    const statusTag = d
      ? d.status === 'verified' ? '<span class="tag ok">Verified</span>' : d.status === 'rejected' ? '<span class="tag bad">Rejected</span>' : '<span class="tag warn">To check</span>'
      : '<span class="tag off">Not added</span>';
    return `
      <div class="doc-row" data-type="${type}">
        <button class="doc-thumb" data-view="${type}" aria-label="${d?.image ? 'View ' + label : 'Add photo of ' + label}">${d?.image ? `<img src="${d.image}" alt="">` : ICONS.camera}</button>
        <div class="main">
          <div class="t1" style="font-weight:620">${esc(label)}</div>
          <div class="muted small">${numTxt ? esc(type === 'aadhaar' ? maskAadhaar(emp.aadhaar) : numTxt) : 'No number entered'}</div>
          ${fmtProblem ? `<div class="small" style="color:var(--bad)">${esc(fmtProblem)}</div>` : ''}
          ${d?.note ? `<div class="small muted">Note: ${esc(d.note)}</div>` : ''}
          <div style="margin-top:4px">${statusTag}</div>
        </div>
        <label class="btn sm ghost" style="cursor:pointer">${d?.image ? 'Retake' : 'Add'}<input type="file" accept="image/*" capture="environment" data-up="${type}" hidden></label>
      </div>`;
  }).join('');

  return {
    html: `
      <div class="sheet"><div class="sheet-body row" style="gap:12px">${avatar(emp)}<div class="grow"><b>${esc(emp.name)}</b><div class="muted small">Aadhaar, bank proof and photo are needed for KYC.</div></div><span class="tag ${docStatus(emp).key}">${esc(docStatus(emp).label)}</span></div></div>
      <div class="sheet ledger">${rows}</div>
      <a class="btn block" href="#/staff/${id}">Done</a>`,
    bind(root) {
      root.addEventListener('change', async (e) => {
        const type = e.target.dataset.up;
        if (!type || !e.target.files[0]) return;
        try {
          const image = await compressImage(e.target.files[0]);
          const existing = emp.docs.find((d) => d.type === type);
          if (existing) Object.assign(existing, { image, status: 'pending', addedAt: new Date().toISOString() });
          else emp.docs.push({ type, image, status: 'pending', addedAt: new Date().toISOString() });
          if (type === 'photo' && !emp.photo) emp.photo = await compressImage(e.target.files[0], 360, 0.75);
          await db.put('employees', emp);
          toast('Photo saved. Now check it and mark verified.');
          viewDoc(emp, type);
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-view]')?.dataset.view;
        if (!t) return;
        if (emp.docs.find((d) => d.type === t)?.image) viewDoc(emp, t);
        else $(`input[data-up="${t}"]`, root).click();
      });
    },
  };
}

function viewDoc(emp, type) {
  const d = emp.docs.find((x) => x.type === type);
  const label = DOC_TYPES.find(([t]) => t === type)[1];
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet-dialog';
  dlg.innerHTML = `
    <div class="dlg-head"><h2>${esc(label)}</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
    <div class="dlg-body stack">
      <img class="photo-view" src="${d.image}" alt="${esc(label)} of ${esc(emp.name)}">
      <p class="small muted">Check the name and photo match ${esc(emp.name)}, the number matches what you entered, and the card is not cut or blurred.</p>
      <label class="field"><span>Note (reason if rejected)</span><input class="input" id="docNote" value="${esc(d.note || '')}"></label>
      <div class="row">
        <button class="btn quiet" data-act="remove">${ICONS.trash}</button>
        <button class="btn danger grow" data-act="rejected">Reject</button>
        <button class="btn grow" data-act="verified">${ICONS.check} Verified</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { dlg.close(); dlg.remove(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'remove') emp.docs = emp.docs.filter((x) => x.type !== type);
    else Object.assign(d, { status: act, note: $('#docNote', dlg).value.trim(), checkedAt: new Date().toISOString() });
    await db.put('employees', emp);
    dlg.close();
    dlg.remove();
    toast(act === 'remove' ? 'Document removed.' : act === 'verified' ? 'Marked verified.' : 'Marked rejected.');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
