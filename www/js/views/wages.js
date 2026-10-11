import { app } from '../app.js';
import { db, uid } from '../db.js';
import { $, esc, money, num, ym, ymd, addMonths, monthLabel, dateLabel, toast, confirmBox, saveFile } from '../util.js';
import { calcPay, ledgerFor, monthPaid, payState } from '../payroll.js';
import { loadCore, avatar, empty, fab, ICONS } from './common.js';
import { payslipPdf } from './reports.js';

const runId = (month, empId) => `${month}|${empId}`;

// Work out every worker's wages for a month. Final runs are frozen; others are live drafts.
export async function monthRuns(month) {
  const { employees, orgMap } = await loadCore();
  const [att, runs, payments] = await Promise.all([db.by('attendance', 'month', month), db.by('payroll', 'month', month), db.all('payments')]);
  const allRuns = await db.all('payroll');
  const runMap = Object.fromEntries(runs.map((r) => [r.empId, r]));
  const byEmp = {};
  att.forEach((r) => (byEmp[r.empId] ||= []).push(r));
  const first = month + '-01';
  const out = [];
  for (const e of employees) {
    const recs = byEmp[e.id] || [];
    const run = runMap[e.id];
    const leftBefore = e.status === 'left' && e.exitDate && e.exitDate < first;
    if (!run && !recs.length && (leftBefore || (e.joinDate && e.joinDate.slice(0, 7) > month) || e.status === 'left')) continue;
    const extras = run?.extras || {};
    const pay = run?.final ? run : calcPay(e, recs, app.settings, month, extras);
    const paid = monthPaid(e.id, month, payments);
    const led = ledgerFor(e.id, payments, allRuns);
    out.push({ emp: e, org: orgMap[e.orgId], pay, run, final: !!run?.final, extras, paid, led });
  }
  return out;
}

// ---------------- month wages ----------------
export async function month() {
  const m = app.params.get('m') || ym();
  app.title('Wages', { actions: `<a class="icon-btn" href="#/payments" aria-label="Payments">${ICONS.cash}</a>` });
  const rows = await monthRuns(m);
  const q = (mm) => '#/wages?m=' + mm;
  const finalCount = rows.filter((r) => r.final).length;
  const t = rows.reduce((a, r) => {
    a.gross += r.pay.gross; a.net += r.pay.net; a.pf += r.pay.pf + r.pay.pfEr; a.esic += r.pay.esic + r.pay.esicEr; a.paid += r.paid;
    return a;
  }, { gross: 0, net: 0, pf: 0, esic: 0, paid: 0 });

  return {
    html: `
      <div class="daynav">
        <a class="icon-btn" href="${q(addMonths(m, -1))}" aria-label="Previous month">${ICONS.left}</a>
        <div class="label">${esc(monthLabel(m))}<small>${finalCount === rows.length && rows.length ? 'Finalised' : finalCount ? `${finalCount} of ${rows.length} finalised` : 'Draft — changes with attendance'}</small></div>
        <a class="icon-btn" href="${q(addMonths(m, 1))}" aria-label="Next month">${ICONS.right}</a>
      </div>
      <div class="sheet">
        <div class="figures">
          <div><div class="k">Gross wages</div><div class="v">${money(t.gross)}</div></div>
          <div><div class="k">Net to pay</div><div class="v">${money(t.net)}</div></div>
          <div><div class="k">PF (both shares)</div><div class="v">${money(t.pf)}</div></div>
          <div><div class="k">ESIC (both shares)</div><div class="v">${money(t.esic)}</div></div>
        </div>
        <div class="sheet-body row between">
          <div><div class="muted small">Paid so far</div><b class="amt">${money(t.paid)}</b> <span class="muted small">of ${money(t.net)}</span></div>
          ${rows.length ? (finalCount === rows.length
            ? `<button class="btn ghost sm" id="reopen">Reopen month</button>`
            : `<button class="btn sm" id="finalise">${ICONS.check} Finalise month</button>`) : ''}
        </div>
      </div>
      <div class="sheet ledger">
        ${rows.length ? `<div class="sheet-head"><h2>Payslips</h2><span class="aside">Net · status</span></div>` + rows.map((r, i) => {
          const ps = payState(r.pay.net, r.paid);
          const tag = { none: 'off', unpaid: 'bad', partial: 'warn', paid: 'ok', over: 'warn' }[ps.key];
          return `<a class="row-item" href="#/wages/${r.emp.id}/${m}">
            <span class="lnum">${i + 1}</span>${avatar(r.emp)}
            <div class="main"><div class="t1">${esc(r.emp.name)}</div><div class="t2">${num(r.pay.payDays)} days${r.pay.otHours ? ` · ${num(r.pay.otHours)}h OT` : ''}${r.final ? '' : ' · draft'}</div></div>
            <div class="right"><div class="amt">${money(r.pay.net)}</div>${r.final ? `<span class="tag ${tag}">${ps.label}</span>` : ''}</div>
          </a>`;
        }).join('') : empty('No wages for this month', 'Mark attendance and the wages work themselves out here.', '<a class="btn" href="#/attendance">Mark attendance</a>')}
      </div>
      ${rows.length ? `<a class="btn ghost block" href="#/reports?r=wages&m=${m}">${ICONS.share} Wage register PDF / Excel</a>` : ''}
      <p class="small muted">Finalising freezes the payslips so wages owed and advances recovered show up in each worker's account. Pay after finalising.</p>`,
    bind(root) {
      $('#finalise', root)?.addEventListener('click', async () => {
        const todo = rows.filter((r) => !r.final);
        if (!(await confirmBox(`Finalise ${todo.length} payslips for ${monthLabel(m)}? Attendance changes after this will not change these payslips until you reopen.`, 'Finalise'))) return;
        await db.putMany('payroll', todo.map((r) => ({ ...r.pay, id: runId(m, r.emp.id), extras: r.extras, final: true, finalisedAt: new Date().toISOString(), empName: r.emp.name })));
        toast(`${monthLabel(m)} finalised. You can pay now.`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      $('#reopen', root)?.addEventListener('click', async () => {
        if (!(await confirmBox('Reopen this month? Payslips will recalculate from attendance. Payments already made stay recorded.', 'Reopen'))) return;
        await db.putMany('payroll', rows.map((r) => ({ id: runId(m, r.emp.id), month: m, empId: r.emp.id, extras: r.extras, final: false })));
        toast('Month reopened.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}

// ---------------- one payslip ----------------
export async function slip(empId, m) {
  const rows = await monthRuns(m);
  let r = rows.find((x) => x.emp.id === empId);
  if (!r) {
    const emp = await db.get('employees', empId);
    if (!emp) throw new Error('This worker was deleted.');
    r = { emp, pay: calcPay(emp, [], app.settings, m, {}), extras: {}, final: false, paid: 0, led: ledgerFor(empId, [], []) };
  }
  const { emp, pay, final } = r;
  app.title(`Payslip · ${monthLabel(m)}`, { back: true });
  const ps = payState(pay.net, r.paid);
  const line = (k, v, cls = '') => `<div class="wage-line ${cls}"><span>${k}</span><span class="amt">${v}</span></div>`;
  const ex = r.extras;
  const advLeft = r.led.advanceOutstanding;

  return {
    html: `
      <div class="sheet"><div class="sheet-body row" style="gap:12px">${avatar(emp)}<div class="grow"><b>${esc(emp.name)}</b><div class="muted small">${esc(emp.code)} · ${money(emp.rate)} per ${emp.wageType === 'monthly' ? 'month' : 'day'}</div></div>${final ? '<span class="tag ok">Final</span>' : '<span class="tag warn">Draft</span>'}</div></div>

      <div class="sheet ledger">
        <div class="sheet-head"><h2>Days</h2><span class="aside">${pay.daysInMonth} in month</span></div>
        <div class="sheet-body">
          ${line('Present', num(pay.counts.P))}
          ${pay.counts.H ? line('Half days', num(pay.counts.H)) : ''}
          ${pay.counts.PL ? line('Paid leave', num(pay.counts.PL)) : ''}
          ${pay.counts.HO ? line('Holidays', num(pay.counts.HO)) : ''}
          ${pay.counts.WO ? line(`Weekly off${emp.wageType === 'monthly' || app.settings.weeklyOffPaid ? '' : ' (unpaid)'}`, num(pay.counts.WO)) : ''}
          ${pay.counts.A + pay.counts.UL ? line('Absent / unpaid leave', num(pay.counts.A + pay.counts.UL)) : ''}
          ${line('Paid days', num(pay.payDays), 'total')}
        </div>
      </div>

      <div class="sheet ledger">
        <div class="sheet-head"><h2>Earnings</h2></div>
        <div class="sheet-body">
          ${line(`Wages (${num(pay.payDays)} × ${money(pay.dayRate)})`, money(pay.basic))}
          ${pay.otPay ? line(`Overtime (${num(pay.otHours)} h × ${money(pay.otRate)})`, money(pay.otPay)) : ''}
          ${pay.allowance ? line('Allowance', money(pay.allowance)) : ''}
          ${pay.bonus ? line('Bonus', money(pay.bonus)) : ''}
          ${line('Gross', money(pay.gross), 'total')}
        </div>
      </div>

      <div class="sheet ledger">
        <div class="sheet-head"><h2>Deductions</h2></div>
        <div class="sheet-body">
          ${line(`PF ${app.settings.pfRate}%`, '− ' + money(pay.pf), 'minus')}
          ${line(`ESIC ${app.settings.esicRate}%`, '− ' + money(pay.esic), 'minus')}
          ${pay.pt ? line('Profession tax', '− ' + money(pay.pt), 'minus') : ''}
          ${pay.advanceRecovery ? line('Advance recovered', '− ' + money(pay.advanceRecovery), 'minus') : ''}
          ${pay.otherDeduction ? line('Other deduction', '− ' + money(pay.otherDeduction), 'minus') : ''}
          ${line('Net pay', money(pay.net), 'total')}
          <p class="small muted" style="margin-top:8px">Employer also pays PF ${money(pay.pfEr)} and ESIC ${money(pay.esicEr)}.</p>
        </div>
      </div>

      ${final ? '' : `
      <form class="sheet" id="extras">
        <div class="sheet-head"><h2>Add to this payslip</h2></div>
        <div class="sheet-body">
          <div class="grid2">
            <label class="field"><span>Bonus (₹)</span><input class="input" type="number" inputmode="decimal" min="0" name="bonus" value="${ex.bonus || ''}"></label>
            <label class="field"><span>Allowance (₹)</span><input class="input" type="number" inputmode="decimal" min="0" name="allowance" value="${ex.allowance || ''}"></label>
            <label class="field"><span>Recover advance (₹)</span><input class="input" type="number" inputmode="decimal" min="0" name="advanceRecovery" value="${ex.advanceRecovery || ''}">
              <small class="hint">${advLeft ? `${money(advLeft)} advance still pending` : 'No advance pending'}</small></label>
            <label class="field"><span>Other deduction (₹)</span><input class="input" type="number" inputmode="decimal" min="0" name="otherDeduction" value="${ex.otherDeduction || ''}"></label>
          </div>
          <button class="btn block">${ICONS.check} Update payslip</button>
        </div>
      </form>`}

      <div class="sheet ledger">
        <div class="sheet-head"><h2>Paid for ${esc(monthLabel(m))}</h2><span class="aside">${final ? esc(ps.label) : ''}</span></div>
        <div class="sheet-body">
          ${line('Net pay', money(pay.net))}
          ${line('Paid', money(r.paid))}
          ${line(pay.net - r.paid >= 0 ? 'Still to pay' : 'Paid extra', money(Math.abs(pay.net - r.paid)), 'total')}
        </div>
        <div class="sheet-body row" style="padding-top:0">
          ${final ? `<a class="btn grow" href="#/payments?new=salary&emp=${emp.id}&m=${m}">${ICONS.cash} Record payment</a>` : '<p class="small muted">Finalise the month on the Wages screen before paying.</p>'}
          <button class="btn ghost grow" id="pdf">${ICONS.share} Payslip PDF</button>
        </div>
      </div>`,
    bind(root) {
      $('#extras', root)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target).entries());
        const extras = Object.fromEntries(Object.entries(fd).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
        if (extras.advanceRecovery > advLeft) return toast(`Only ${money(advLeft)} advance is pending.`, 'bad');
        await db.put('payroll', { id: runId(m, emp.id), month: m, empId: emp.id, extras, final: false });
        toast('Payslip updated.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      $('#pdf', root).addEventListener('click', async () => {
        const bytes = await payslipPdf([r], m);
        await saveFile(`payslip-${emp.code}-${m}.pdf`, bytes, 'application/pdf');
      });
    },
  };
}

// ---------------- payments ----------------
export async function payments() {
  app.title('Payments', { back: true });
  const { employees, active } = await loadCore();
  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
  const all = (await db.all('payments')).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const filter = app.params.get('t') || 'all';
  const newType = app.params.get('new');
  const preEmp = app.params.get('emp') || '';
  const preMonth = app.params.get('m') || '';
  const list = all.filter((p) => filter === 'all' || p.type === filter);

  return {
    html: `
      <div class="sheet" id="payBox" ${newType ? '' : 'hidden'}>
        <form class="sheet-body" id="pf">
          <div class="field"><div class="seg" role="radiogroup" aria-label="Payment type">
            <label><input type="radio" name="type" value="salary" ${newType !== 'advance' ? 'checked' : ''}><span>Wages</span></label>
            <label><input type="radio" name="type" value="advance" ${newType === 'advance' ? 'checked' : ''}><span>Advance</span></label>
          </div></div>
          <label class="field"><span>Worker</span><select class="input" name="empId" required>
            <option value="">Choose worker</option>${active.map((e) => `<option value="${e.id}" ${e.id === preEmp ? 'selected' : ''}>${esc(e.name)} (${esc(e.code)})</option>`).join('')}</select></label>
          <label class="field" id="monthField"><span>Wages for month</span><input class="input" type="month" name="month" value="${preMonth || ym()}"></label>
          <div id="dueHint" class="small muted" style="margin:-8px 0 12px"></div>
          <div class="grid2">
            <label class="field"><span>Amount (₹)</span><input class="input" type="number" inputmode="decimal" min="1" name="amount" required></label>
            <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${ymd()}" required></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Paid by</span><select class="input" name="mode">${['Cash', 'UPI', 'Bank transfer', 'Cheque'].map((x) => `<option>${x}</option>`).join('')}</select></label>
            <label class="field"><span>Note</span><input class="input" name="note" placeholder="Ref no., reason…"></label>
          </div>
          <div class="row"><button type="button" class="btn quiet" id="cancelPay">Cancel</button><button class="btn grow">${ICONS.check} Save payment</button></div>
        </form>
      </div>
      <div class="chips">${[['all', 'All'], ['salary', 'Wages'], ['advance', 'Advances']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="sheet ledger">
        ${list.length ? `<div class="sheet-head"><h2>${list.length} entries</h2><span class="aside">${money(list.reduce((s, p) => s + Number(p.amount), 0))}</span></div>` + list.map((p, i) => `
          <div class="row-item"><span class="lnum">${i + 1}</span>
            <div class="main"><div class="t1">${esc(empMap[p.empId]?.name || 'Removed worker')}</div>
            <div class="t2">${p.type === 'advance' ? 'Advance' : 'Wages ' + esc(monthLabel(p.month))} · ${esc(dateLabel(p.date))} · ${esc(p.mode)}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
            <div class="right amt" style="color:${p.type === 'advance' ? 'var(--warn)' : 'var(--ok)'}">${money(p.amount)}</div>
            <button class="icon-btn" data-del="${p.id}" aria-label="Delete payment" style="color:var(--ink-3)">${ICONS.trash}</button>
          </div>`).join('') : empty('No payments yet', 'Wages paid and advances given are listed here, newest first.')}
      </div>`,
    bind(root) {
      if (!newType) fab(`<button class="btn" id="newPay">${ICONS.plus} New payment</button>`);
      const box = $('#payBox', root);
      const formEl = $('#pf', root);
      $('#newPay')?.addEventListener('click', () => { box.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' }); });
      $('#cancelPay', root).onclick = () => { box.hidden = true; if (newType) history.back(); };

      const runsCache = {};
      const refreshHint = async () => {
        const type = formEl.type.value;
        $('#monthField', root).hidden = type !== 'salary';
        const empId = formEl.empId.value;
        const hint = $('#dueHint', root);
        hint.textContent = '';
        if (!empId) return;
        const pays = await db.by('payments', 'empId', empId);
        if (type === 'advance') {
          const led = ledgerFor(empId, pays, await db.by('payroll', 'empId', empId));
          hint.textContent = led.advanceOutstanding ? `${money(led.advanceOutstanding)} earlier advance is still pending.` : 'No pending advance.';
          return;
        }
        const m = formEl.month.value;
        const run = (runsCache[m + empId] ||= await db.get('payroll', `${m}|${empId}`));
        if (!run?.final) { hint.innerHTML = `Wages for ${esc(monthLabel(m))} are not finalised yet. <a href="#/wages?m=${m}">Finalise first</a>.`; return; }
        const left = run.net - monthPaid(empId, m, pays);
        hint.textContent = left > 0 ? `${money(left)} still to pay for ${monthLabel(m)} (net ${money(run.net)}).` : `Fully paid for ${monthLabel(m)}.`;
        if (left > 0 && !formEl.amount.value) formEl.amount.value = Math.round(left);
      };
      formEl.addEventListener('change', (e) => { if (e.target.name !== 'amount') { if (e.target.name !== 'date' && e.target.name !== 'mode') formEl.amount.value = ''; refreshHint(); } });
      refreshHint();

      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(formEl).entries());
        if (!d.empId) return toast('Choose the worker.', 'bad');
        const amount = Number(d.amount);
        if (!(amount > 0)) return toast('Enter the amount.', 'bad');
        if (d.type === 'salary') {
          const run = await db.get('payroll', `${d.month}|${d.empId}`);
          if (!run?.final) return toast(`Finalise ${monthLabel(d.month)} wages first.`, 'bad');
          const left = run.net - monthPaid(d.empId, d.month, await db.by('payments', 'empId', d.empId));
          if (amount > left && !(await confirmBox(`This is ${money(amount - left)} more than what is due. Save anyway?`, 'Save anyway'))) return;
        } else delete d.month;
        await db.put('payments', { id: uid(), ...d, amount });
        const who = empMap[d.empId].name;
        toast(`${money(amount)} ${d.type === 'advance' ? 'advance' : 'wages'} recorded for ${who}.`);
        app.go(newType && preEmp ? `#/staff/${preEmp}` : '#/payments');
        if (!newType) window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      root.addEventListener('click', async (e) => {
        const chip = e.target.closest('[data-t]');
        if (chip) return app.go('#/payments?t=' + chip.dataset.t);
        const id = e.target.closest('[data-del]')?.dataset.del;
        if (!id) return;
        if (!(await confirmBox('Delete this payment entry?'))) return;
        await db.del('payments', id);
        toast('Payment deleted.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}
