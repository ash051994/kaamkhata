import { app } from '../app.js';
import { db } from '../db.js';
import { $, esc, money, num, ym, monthLabel, monthDates, dateLabel, toCSV, saveFile, toast, maskAadhaar, parseYmd } from '../util.js';
import { STATUS, ledgerFor } from '../payroll.js';
import { Doc } from '../pdf.js';
import { loadCore, docStatus, DOC_TYPES, ICONS } from './common.js';
import { monthRuns } from './wages.js';

const REPORTS = [
  ['staff', 'Worker list', 'Everyone with contact, wage, IDs and bank details'],
  ['attendance', 'Attendance register', 'Day-by-day marks for the month, with paid days'],
  ['wages', 'Wage register', 'Days, earnings, PF, ESIC, deductions and net for the month'],
  ['payslips', 'Payslips', 'One payslip per worker for the month, ready to hand out'],
  ['statutory', 'PF and ESIC', 'Employee and employer shares to deposit for the month'],
  ['dues', 'Dues and advances', 'Who is owed wages and who has advance to recover'],
  ['kyc', 'Document check', 'Which documents are verified, pending or missing'],
];
const MONTHLY = new Set(['attendance', 'wages', 'payslips', 'statutory']);

function header(s) {
  return [s.firmName || 'KaamKhata', s.ownerName, s.phone].filter(Boolean).join(' · ');
}

export async function render() {
  app.title('Reports', { back: true });
  const { orgs } = await loadCore();
  const r = app.params.get('r') || 'staff';
  const m = app.params.get('m') || ym();
  return {
    html: `
      <form class="sheet" id="rf">
        <div class="sheet-body">
          <label class="field"><span>Report</span><select class="input" name="r">${REPORTS.map(([k, l]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <small class="hint" id="rdesc"></small></label>
          <div class="grid2">
            <label class="field" id="mField"><span>Month</span><input class="input" type="month" name="m" value="${m}"></label>
            <label class="field"><span>Company</span><select class="input" name="org"><option value="">All companies</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
          </div>
          <div class="row">
            <button class="btn grow" data-kind="pdf">${ICONS.doc} PDF</button>
            <button class="btn ghost grow" data-kind="csv">${ICONS.grid} Excel (CSV)</button>
          </div>
        </div>
      </form>
      <p class="small muted">PDF is for printing and WhatsApp. CSV opens in Excel or Google Sheets.</p>`,
    bind(root) {
      const f = $('#rf', root);
      const sync = () => {
        $('#rdesc', root).textContent = REPORTS.find(([k]) => k === f.r.value)[2];
        $('#mField', root).style.visibility = MONTHLY.has(f.r.value) ? 'visible' : 'hidden';
        $('[data-kind="csv"]', root).disabled = f.r.value === 'payslips';
      };
      f.r.addEventListener('change', sync);
      sync();
      f.addEventListener('click', async (e) => {
        const kind = e.target.closest('[data-kind]')?.dataset.kind;
        if (!kind) return;
        e.preventDefault();
        const btn = e.target.closest('button');
        btn.disabled = true;
        try {
          await build(f.r.value, f.m.value || ym(), f.org.value, kind);
        } catch (err) {
          console.error(err);
          toast('Could not make the report: ' + err.message, 'bad');
        } finally {
          btn.disabled = false;
        }
      });
    },
  };
}

async function build(r, m, org, kind) {
  const s = app.settings;
  const { employees, orgMap } = await loadCore();
  const inOrg = (e) => !org || e.orgId === org;
  const orgName = org ? orgMap[org]?.name : 'All companies';
  const label = REPORTS.find(([k]) => k === r)[1];
  const fname = `${r}-${MONTHLY.has(r) ? m : new Date().toISOString().slice(0, 10)}${org ? '-' + orgMap[org].name.replace(/\W+/g, '-').toLowerCase() : ''}`;
  let cols, rows, totals, landscape = false, subtitle;

  if (r === 'staff') {
    const list = employees.filter(inOrg);
    subtitle = `${orgName} · ${list.filter((e) => e.status !== 'left').length} working, ${list.filter((e) => e.status === 'left').length} left`;
    landscape = true;
    cols = [['Code', 0.7], ['Name', 2], ['Father', 1.6], ['Mobile', 1.2], ['Company', 1.6], ['Work', 1.3], ['Rate', 1, 'right'], ['Joined', 1.1], ['Aadhaar', 1.3], ['UAN', 1.3], ['ESIC', 1.1], ['Bank A/c', 1.4], ['IFSC', 1.1], ['Status', 0.8]];
    rows = list.map((e) => [e.code, e.name, e.fatherName, e.phone, orgMap[e.orgId]?.name, e.designation, `${money(e.rate)}/${e.wageType === 'monthly' ? 'mo' : 'day'}`, dateLabel(e.joinDate), kind === 'pdf' ? maskAadhaar(e.aadhaar) : e.aadhaar, e.uan, e.esic, e.accountNo, e.ifsc, e.status === 'left' ? 'Left' : 'Working']);
  }

  if (r === 'attendance') {
    landscape = true;
    const dates = monthDates(m);
    const runs = (await monthRuns(m)).filter((x) => inOrg(x.emp));
    const att = await db.by('attendance', 'month', m);
    const map = {};
    att.forEach((a) => ((map[a.empId] ||= {})[a.date] = a));
    subtitle = `${monthLabel(m)} · ${orgName}`;
    cols = [['Name', 3.4], ...dates.map((d) => [String(Number(d.slice(8))), 0.62, 'center']), ['P', 0.7, 'center'], ['A', 0.7, 'center'], ['OT', 0.8, 'center'], ['Days', 0.9, 'center']];
    const colour = { P: '#1d7a49', A: '#b3261e', H: '#9a5b00', PL: '#6a3fb0', UL: '#6a3fb0' };
    rows = runs.map(({ emp, pay }) => [
      emp.name,
      ...dates.map((d) => {
        const st = map[emp.id]?.[d]?.status || '';
        return kind === 'pdf' ? { text: st ? STATUS[st].short : (parseYmd(d).getDay() === 0 ? '·' : ''), color: colour[st] } : st;
      }),
      num(pay.counts.P), num(pay.counts.A), num(pay.otHours), num(pay.payDays),
    ]);
  }

  if (r === 'wages' || r === 'statutory' || r === 'payslips') {
    const runs = (await monthRuns(m)).filter((x) => inOrg(x.emp));
    if (!runs.length) throw new Error(`no wages found for ${monthLabel(m)}`);
    const draft = runs.some((x) => !x.final);
    subtitle = `${monthLabel(m)} · ${orgName}${draft ? ' · DRAFT (month not finalised)' : ''}`;
    if (r === 'payslips') {
      const bytes = await payslipPdf(runs, m);
      return saveFile(fname + '.pdf', bytes, 'application/pdf');
    }
    const sum = (f) => runs.reduce((a, x) => a + (Number(f(x)) || 0), 0);
    if (r === 'wages') {
      landscape = true;
      cols = [['Code', 0.7], ['Name', 2.2], ['Rate', 1, 'right'], ['Days', 0.7, 'right'], ['OT h', 0.6, 'right'], ['Wages', 1, 'right'], ['OT', 0.9, 'right'], ['Bonus+Allow', 1.1, 'right'], ['Gross', 1.1, 'right'], ['PF', 0.8, 'right'], ['ESIC', 0.8, 'right'], ['PT', 0.6, 'right'], ['Advance', 0.9, 'right'], ['Other', 0.8, 'right'], ['Net', 1.1, 'right'], ['Paid', 1, 'right'], ['Balance', 1, 'right']];
      const f = kind === 'pdf' ? money : (n) => Math.round(Number(n) || 0);
      rows = runs.map(({ emp, pay, paid }) => [emp.code, emp.name, f(emp.rate), num(pay.payDays), num(pay.otHours), f(pay.basic), f(pay.otPay), f(pay.bonus + pay.allowance), f(pay.gross), f(pay.pf), f(pay.esic), f(pay.pt), f(pay.advanceRecovery), f(pay.otherDeduction), f(pay.net), f(paid), f(pay.net - paid)]);
      totals = ['', 'Total', '', num(sum((x) => x.pay.payDays)), num(sum((x) => x.pay.otHours)), f(sum((x) => x.pay.basic)), f(sum((x) => x.pay.otPay)), f(sum((x) => x.pay.bonus + x.pay.allowance)), f(sum((x) => x.pay.gross)), f(sum((x) => x.pay.pf)), f(sum((x) => x.pay.esic)), f(sum((x) => x.pay.pt)), f(sum((x) => x.pay.advanceRecovery)), f(sum((x) => x.pay.otherDeduction)), f(sum((x) => x.pay.net)), f(sum((x) => x.paid)), f(sum((x) => x.pay.net - x.paid))];
    } else {
      const f = kind === 'pdf' ? money : (n) => Math.round(Number(n) || 0);
      cols = [['Name', 2.2], ['UAN', 1.4], ['PF wage', 1.1, 'right'], ['PF emp', 1, 'right'], ['PF empr', 1, 'right'], ['ESIC no.', 1.3], ['ESIC wage', 1.1, 'right'], ['ESIC emp', 1, 'right'], ['ESIC empr', 1, 'right']];
      rows = runs.filter((x) => x.pay.pf || x.pay.esic).map(({ emp, pay }) => [emp.name, emp.uan || '—', f(pay.pfWage), f(pay.pf), f(pay.pfEr), emp.esic || '—', f(pay.esic ? pay.basic + pay.otPay + pay.allowance : 0), f(pay.esic), f(pay.esicEr)]);
      totals = ['Total', '', f(sum((x) => x.pay.pfWage)), f(sum((x) => x.pay.pf)), f(sum((x) => x.pay.pfEr)), '', f(sum((x) => (x.pay.esic ? x.pay.basic + x.pay.otPay + x.pay.allowance : 0))), f(sum((x) => x.pay.esic)), f(sum((x) => x.pay.esicEr))];
      subtitle += ` · PF to deposit ${money(sum((x) => x.pay.pf + x.pay.pfEr))} · ESIC to deposit ${money(sum((x) => x.pay.esic + x.pay.esicEr))}`;
    }
  }

  if (r === 'dues') {
    const [payments, payroll] = await Promise.all([db.all('payments'), db.all('payroll')]);
    const list = employees.filter(inOrg).map((e) => ({ e, l: ledgerFor(e.id, payments, payroll) })).filter((x) => x.l.due || x.l.advanceOutstanding || x.l.earned);
    const f = kind === 'pdf' ? money : (n) => Math.round(Number(n) || 0);
    subtitle = `As on ${dateLabel(new Date().toISOString().slice(0, 10))} · ${orgName} · finalised months only`;
    cols = [['Code', 0.7], ['Name', 2.2], ['Mobile', 1.2], ['Wages earned', 1.2, 'right'], ['Wages paid', 1.2, 'right'], ['Wages due', 1.2, 'right'], ['Advance given', 1.2, 'right'], ['Recovered', 1.1, 'right'], ['Advance pending', 1.3, 'right']];
    rows = list.map(({ e, l }) => [e.code, e.name, e.phone, f(l.earned), f(l.paid), f(l.due), f(l.advances), f(l.recovered), f(l.advanceOutstanding)]);
    const sum = (k) => list.reduce((a, x) => a + x.l[k], 0);
    totals = ['', 'Total', '', f(sum('earned')), f(sum('paid')), f(sum('due')), f(sum('advances')), f(sum('recovered')), f(sum('advanceOutstanding'))];
    landscape = true;
  }

  if (r === 'kyc') {
    const list = employees.filter((e) => inOrg(e) && e.status !== 'left');
    subtitle = `${orgName} · ${list.filter((e) => docStatus(e).key === 'ok').length} of ${list.length} complete`;
    landscape = true;
    const types = DOC_TYPES.filter(([t]) => t !== 'other');
    cols = [['Code', 0.7], ['Name', 2.2], ...types.map(([, l]) => [l.replace(/ card| \/ cheque/i, ''), 1.1, 'center']), ['Overall', 1.2]];
    const lab = { verified: 'OK', pending: 'Check', rejected: 'Rejected' };
    rows = list.map((e) => [e.code, e.name, ...types.map(([t]) => {
      const d = (e.docs || []).find((x) => x.type === t);
      const txt = d ? lab[d.status] : '—';
      return kind === 'pdf' ? { text: txt, color: d?.status === 'verified' ? '#1d7a49' : d?.status === 'rejected' ? '#b3261e' : d ? '#9a5b00' : '#94a3b8' } : txt;
    }), docStatus(e).label]);
  }

  if (!rows.length) throw new Error('there is nothing to put in this report yet');

  if (kind === 'csv') {
    const flat = (v) => (v && typeof v === 'object' ? v.text : v);
    const csv = toCSV([[label], [subtitle], [], cols.map((c) => c[0]), ...rows.map((rw) => rw.map(flat)), ...(totals ? [totals.map(flat)] : [])]);
    return saveFile(fname + '.csv', '﻿' + csv, 'text/csv');
  }
  const doc = new Doc({ landscape, title: `${label} — ${s.firmName || 'KaamKhata'}`, subtitle, footer: header(s) });
  doc.table(cols.map(([l, w, a]) => ({ label: l, width: w, align: a })), rows, { totals, size: r === 'attendance' ? 7 : landscape ? 7.5 : 8.5 });
  return saveFile(fname + '.pdf', await doc.toBytes(), 'application/pdf');
}

export async function payslipPdf(runs, m) {
  const s = app.settings;
  const doc = new Doc({ footer: header(s) });
  runs.forEach(({ emp, org, pay, paid, final }, i) => {
    if (i > 0) doc.newPage();
    doc.text(s.firmName || 'KaamKhata', doc.m, doc.y + 16, { size: 16, bold: true });
    doc.text(`Payslip for ${monthLabel(m)}${final ? '' : ' (draft)'}`, doc.m, doc.y + 32, { size: 10, color: '#475569' });
    doc.text([s.ownerName, s.phone].filter(Boolean).join(' · '), doc.W - doc.m - 200, doc.y + 16, { size: 9, align: 'right', width: 200, color: '#475569' });
    doc.y += 44;
    doc.line(doc.m, doc.y, doc.W - doc.m, doc.y, '#B3261E', 1.2);
    doc.y += 10;
    doc.pairs([
      ['Name', emp.name], ['Code', emp.code],
      ['Work', emp.designation || '—'], ['Company', org?.name || '—'],
      ['UAN (PF)', emp.uan || '—'], ['ESIC', emp.esic || '—'],
      ['Bank A/c', emp.accountNo ? '••••' + String(emp.accountNo).slice(-4) : '—'], ['Rate', `${money(emp.rate)} per ${emp.wageType === 'monthly' ? 'month' : 'day'}`],
      ['Paid days', `${num(pay.payDays)} of ${pay.daysInMonth}`], ['Overtime', `${num(pay.otHours)} hours`],
    ]);
    doc.space(6);
    const earn = [['Wages', money(pay.basic)], ['Overtime', money(pay.otPay)], ['Allowance', money(pay.allowance)], ['Bonus', money(pay.bonus)]];
    const ded = [['PF', money(pay.pf)], ['ESIC', money(pay.esic)], ['Profession tax', money(pay.pt)], ['Advance recovered', money(pay.advanceRecovery)], ['Other', money(pay.otherDeduction)]];
    const n = Math.max(earn.length, ded.length);
    doc.table(
      [{ label: 'Earnings', width: 2 }, { label: 'Amount', width: 1, align: 'right' }, { label: 'Deductions', width: 2 }, { label: 'Amount', width: 1, align: 'right' }],
      Array.from({ length: n }, (_, k) => [earn[k]?.[0] || '', earn[k]?.[1] || '', ded[k]?.[0] || '', ded[k]?.[1] || '']),
      { size: 9.5, rowH: 18, totals: ['Gross', money(pay.gross), 'Total deductions', money(pay.deductions)] }
    );
    doc.ensure(70);
    doc.rect(doc.m, doc.y, doc.W - doc.m * 2, 34, '#1C2A3A');
    doc.text('Net pay', doc.m + 12, doc.y + 22, { size: 12, bold: true, color: '#fff' });
    doc.text(money(pay.net), doc.m, doc.y + 23, { size: 15, bold: true, color: '#fff', align: 'right', width: doc.W - doc.m * 2 - 12 });
    doc.y += 46;
    doc.para(`Paid so far: ${money(paid)}   ·   Balance: ${money(pay.net - paid)}`, { size: 9.5, color: '#475569' });
    doc.para(`Employer contribution — PF ${money(pay.pfEr)}, ESIC ${money(pay.esicEr)}`, { size: 8.5, color: '#64748B' });
    doc.space(40);
    doc.line(doc.m, doc.y, doc.m + 160, doc.y, '#94A3B8', 0.6);
    doc.line(doc.W - doc.m - 160, doc.y, doc.W - doc.m, doc.y, '#94A3B8', 0.6);
    doc.text('Worker signature / thumb', doc.m, doc.y + 12, { size: 8, color: '#64748B' });
    doc.text('Contractor signature', doc.W - doc.m - 160, doc.y + 12, { size: 8, color: '#64748B', align: 'right', width: 160 });
  });
  return doc.toBytes();
}
