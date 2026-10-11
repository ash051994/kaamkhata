import { app } from '../app.js';
import { db } from '../db.js';
import { esc, money, ymd, ym, dateLabel, dayName, monthLabel } from '../util.js';
import { ledgerFor } from '../payroll.js';
import { loadCore, docStatus, ICONS, avatar } from './common.js';

export async function render() {
  const s = app.settings;
  app.title(s.firmName || 'KaamKhata');
  const { active, orgs } = await loadCore();
  const today = ymd();

  if (!orgs.length || !active.length) {
    const steps = [
      [!!s.firmName, 'Add your firm name', 'It goes on payslips and reports.', '#/settings'],
      [orgs.length > 0, 'Add the company your workers go to', 'For example the MIDC unit or plant name.', '#/orgs'],
      [active.length > 0, 'Add your first worker', 'Type the details, or say them out loud.', '#/staff/new'],
    ];
    return `
      <div class="sheet ledger">
        <div class="sheet-head"><h2>Set up your register</h2><span class="aside">3 steps</span></div>
        ${steps.map(([done, t, d, href], i) => `
          <a class="row-item" href="${href}">
            <span class="lnum">${i + 1}</span>
            <div class="main"><div class="t1">${esc(t)}</div><div class="t2">${esc(d)}</div></div>
            <span class="tag ${done ? 'ok' : 'off'}">${done ? 'Done' : 'To do'}</span>
          </a>`).join('')}
      </div>
      <p class="muted small center">Everything is saved on this phone only. Take a backup from More → Backup.</p>`;
  }

  const [att, payments, payroll] = await Promise.all([db.by('attendance', 'date', today), db.all('payments'), db.all('payroll')]);
  const activeIds = new Set(active.map((e) => e.id));
  const todays = att.filter((a) => activeIds.has(a.empId));
  const present = todays.filter((a) => a.status === 'P' || a.status === 'H').length;
  const absent = todays.filter((a) => a.status === 'A').length;
  const onLeave = todays.filter((a) => a.status === 'PL' || a.status === 'UL').length;
  const unmarked = active.length - todays.filter((a) => a.status).length;

  let due = 0, adv = 0;
  const withDue = [];
  for (const e of active) {
    const l = ledgerFor(e.id, payments, payroll);
    if (l.due > 0) { due += l.due; withDue.push([e, l.due]); }
    adv += l.advanceOutstanding;
  }
  withDue.sort((a, b) => b[1] - a[1]);
  const kycPending = active.filter((e) => docStatus(e).key !== 'ok');
  const month = ym();
  const finalized = payroll.filter((p) => p.month === month && p.final);

  return `
    <div class="today">
      <div>
        <div class="date">${esc(dayName(today))}, ${esc(dateLabel(today))}</div>
        <div class="big">${present} <span style="font-size:1rem;font-weight:500">of ${active.length} at work</span></div>
        <div class="date">${absent} absent · ${onLeave} on leave · ${unmarked} not marked</div>
      </div>
      <a class="btn" href="#/attendance">${unmarked ? 'Mark' : 'View'}</a>
    </div>

    <div class="sheet">
      <div class="figures">
        <div><div class="k">Wages due</div><div class="v ${due > 0 ? 'bad' : ''}">${money(due)}</div></div>
        <div><div class="k">Advances to recover</div><div class="v">${money(adv)}</div></div>
        <div><div class="k">Workers</div><div class="v">${active.length}</div></div>
        <div><div class="k">${esc(monthLabel(month))} wages</div><div class="v" style="font-size:1rem;padding-top:6px">${finalized.length ? `${finalized.length} finalised` : '<a href="#/wages">Calculate</a>'}</div></div>
      </div>
    </div>

    ${withDue.length ? `
    <div class="sheet ledger">
      <div class="sheet-head"><h2>Waiting for payment</h2><a class="aside" href="#/payments">All payments</a></div>
      ${withDue.slice(0, 5).map(([e, amt], i) => `
        <a class="row-item" href="#/staff/${e.id}">
          <span class="lnum">${i + 1}</span>${avatar(e)}
          <div class="main"><div class="t1">${esc(e.name)}</div><div class="t2">${esc(e.designation || '')}</div></div>
          <div class="right amt" style="color:var(--bad)">${money(amt)}</div>
        </a>`).join('')}
    </div>` : ''}

    ${kycPending.length ? `
    <div class="sheet ledger">
      <div class="sheet-head"><h2>Documents to check</h2><span class="aside">${kycPending.length} workers</span></div>
      ${kycPending.slice(0, 5).map((e, i) => `
        <a class="row-item" href="#/staff/${e.id}/docs">
          <span class="lnum">${i + 1}</span>${avatar(e)}
          <div class="main"><div class="t1">${esc(e.name)}</div><div class="t2">${esc(e.designation || '')}</div></div>
          <span class="tag ${docStatus(e).key}">${esc(docStatus(e).label)}</span>
        </a>`).join('')}
    </div>` : ''}

    <div class="row" style="margin-top:4px">
      <a class="btn ghost grow" href="#/staff/new?voice=1">${ICONS.mic} Add by voice</a>
      <a class="btn ghost grow" href="#/payments?new=advance">${ICONS.cash} Give advance</a>
    </div>`;
}
