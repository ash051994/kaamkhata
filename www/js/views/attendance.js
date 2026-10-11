import { app } from '../app.js';
import { db, uid } from '../db.js';
import {
  $, esc, num, ymd, ym, addDays, addMonths, dateLabel, dayName, monthLabel, monthDates, datesBetween, parseYmd, toast, confirmBox,
} from '../util.js';
import { STATUS, CYCLE, countAttendance, calcPay } from '../payroll.js';
import { loadCore, avatar, empty, ICONS, fab } from './common.js';

const recId = (empId, date) => `${empId}|${date}`;

async function setMark(empId, date, patch) {
  const id = recId(empId, date);
  const cur = (await db.get('attendance', id)) || { id, empId, date, month: date.slice(0, 7), status: '', ot: 0 };
  const next = { ...cur, ...patch };
  if (!next.status && !Number(next.ot) && !next.note) {
    await db.del('attendance', id);
    return null;
  }
  return db.put('attendance', next);
}

function orgChips(orgs, current) {
  if (orgs.length < 2) return '';
  return `<div class="chips">${[{ id: '', name: 'All' }, ...orgs].map((o) => `<button class="chip ${current === o.id ? 'on' : ''}" data-org="${o.id}">${esc(o.name)}</button>`).join('')}</div>`;
}

// ---------------- daily marking ----------------
export async function day() {
  const date = app.params.get('d') || ymd();
  const org = app.params.get('org') || '';
  app.title('Attendance', {
    actions: `<a class="icon-btn" href="#/attendance/month?m=${date.slice(0, 7)}" aria-label="Month register">${ICONS.grid}</a><a class="icon-btn" href="#/leaves" aria-label="Leaves">${ICONS.leave}</a>`,
  });
  const { active, orgs } = await loadCore();
  const staff = active.filter((e) => (!org || e.orgId === org) && (!e.joinDate || e.joinDate <= date));
  const recs = Object.fromEntries((await db.by('attendance', 'date', date)).map((r) => [r.empId, r]));
  const q = (d) => { const p = new URLSearchParams(app.params); p.set('d', d); return '#/attendance?' + p; };
  const future = date > ymd();

  const rowHtml = (e, i) => {
    const r = recs[e.id] || {};
    const st = r.status || '';
    const other = st && !['P', 'A', 'H'].includes(st);
    return `
      <div class="att-row" data-emp="${e.id}">
        <span class="lnum" style="position:absolute;left:-40px;width:28px;text-align:right;color:var(--ink-3);font-size:.75rem">${i + 1}</span>
        ${avatar(e)}
        <div class="main">
          <div style="font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.name)}</div>
          <div class="muted small">${esc(e.designation || '')}${Number(r.ot) ? ` <span class="att-ot">+${num(r.ot)}h OT</span>` : ''}</div>
        </div>
        <div class="att-picks" role="group" aria-label="Mark ${esc(e.name)}">
          ${['P', 'A', 'H'].map((k) => `<button class="${k} ${st === k ? 'on' : ''}" data-st="${k}" aria-pressed="${st === k}" aria-label="${STATUS[k].label}">${STATUS[k].short}</button>`).join('')}
        </div>
        <button class="att-more ${other ? 'has' : ''}" data-more aria-label="Leave, off, overtime">${other ? st : '⋯'}</button>
      </div>`;
  };

  const counts = () => {
    const c = countAttendance(Object.values(recs).filter((r) => staff.some((e) => e.id === r.empId)));
    return `${c.P + c.H} at work · ${c.A} absent · ${staff.length - c.marked} not marked`;
  };

  return {
    html: `
      <div class="daynav">
        <a class="icon-btn" href="${q(addDays(date, -1))}" aria-label="Previous day">${ICONS.left}</a>
        <label class="label" style="cursor:pointer">${esc(dayName(date))}, ${esc(dateLabel(date))}<small id="dayCounts">${counts()}</small>
          <input type="date" id="pickDate" value="${date}" style="position:absolute;opacity:0;pointer-events:none;width:1px">
        </label>
        <a class="icon-btn" href="${q(addDays(date, 1))}" aria-label="Next day">${ICONS.right}</a>
      </div>
      ${orgChips(orgs, org)}
      ${future ? '<p class="small" style="color:var(--warn)">This date is in the future.</p>' : ''}
      <div class="sheet ledger">
        ${staff.length ? `<div class="sheet-head"><h2>${staff.length} workers</h2><button class="btn sm ghost" id="allP">Mark rest present</button></div>${staff.map(rowHtml).join('')}`
          : empty('No workers to mark', 'Add workers first, or pick another company.', '<a class="btn" href="#/staff/new">Add worker</a>')}
      </div>
      <p class="small muted center">P present · A absent · ½ half day · ⋯ for leave, weekly off, holiday or overtime</p>`,
    bind(root) {
      const picker = $('#pickDate', root);
      root.querySelector('.daynav .label').addEventListener('click', () => (picker.showPicker ? picker.showPicker() : picker.click()));
      picker.addEventListener('change', () => picker.value && app.go(q(picker.value)));
      const redrawRow = (empId) => {
        const i = staff.findIndex((e) => e.id === empId);
        const old = root.querySelector(`.att-row[data-emp="${empId}"]`);
        old.outerHTML = rowHtml(staff[i], i);
        $('#dayCounts', root).textContent = counts();
      };
      root.addEventListener('click', async (e) => {
        const chip = e.target.closest('[data-org]');
        if (chip) { const p = new URLSearchParams(app.params); chip.dataset.org ? p.set('org', chip.dataset.org) : p.delete('org'); return app.go('#/attendance?' + p); }
        const row = e.target.closest('.att-row');
        if (row) {
          const empId = row.dataset.emp;
          const stBtn = e.target.closest('[data-st]');
          if (stBtn) {
            const cur = recs[empId]?.status;
            const st = cur === stBtn.dataset.st ? '' : stBtn.dataset.st;
            const saved = await setMark(empId, date, { status: st });
            if (saved) recs[empId] = saved; else delete recs[empId];
            redrawRow(empId);
            if (navigator.vibrate) navigator.vibrate(12);
          } else if (e.target.closest('[data-more]')) {
            const emp = staff.find((x) => x.id === empId);
            const saved = await moreDialog(emp, date, recs[empId] || {});
            if (saved !== undefined) { if (saved) recs[empId] = saved; else delete recs[empId]; redrawRow(empId); }
          }
          return;
        }
        if (e.target.closest('#allP')) {
          const todo = staff.filter((x) => !recs[x.id]?.status);
          if (!todo.length) return toast('Everyone is already marked.');
          const saved = await db.putMany('attendance', todo.map((x) => ({ ...(recs[x.id] || {}), id: recId(x.id, date), empId: x.id, date, month: date.slice(0, 7), status: 'P', ot: recs[x.id]?.ot || 0 })));
          saved.forEach((r) => (recs[r.empId] = r));
          todo.forEach((x) => redrawRow(x.id));
          toast(`${todo.length} marked present.`);
        }
      });
    },
  };
}

function moreDialog(emp, date, rec) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet-dialog';
    const opts = ['PL', 'UL', 'WO', 'HO', 'H', 'P', 'A'];
    dlg.innerHTML = `
      <div class="dlg-head"><h2>${esc(emp.name)} · ${esc(dateLabel(date))}</h2><button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
      <div class="dlg-body">
        <div class="chips" style="flex-wrap:wrap">${opts.map((k) => `<button class="chip ${rec.status === k ? 'on' : ''}" data-s="${k}">${STATUS[k].label}</button>`).join('')}</div>
        <div class="grid2">
          <label class="field"><span>Overtime hours</span><input class="input" id="ot" type="number" inputmode="decimal" min="0" max="16" step="0.5" value="${rec.ot || ''}"></label>
          <label class="field"><span>Note</span><input class="input" id="note" value="${esc(rec.note || '')}"></label>
        </div>
        <div class="row"><button class="btn quiet" data-clear>Clear day</button><button class="btn grow" data-save>${ICONS.check} Save</button></div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    let status = rec.status || '';
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return done(undefined);
      const s = e.target.closest('[data-s]');
      if (s) {
        status = status === s.dataset.s ? '' : s.dataset.s;
        dlg.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === status));
      }
      if (e.target.closest('[data-clear]')) { await db.del('attendance', recId(emp.id, date)); return done(null); }
      if (e.target.closest('[data-save]')) {
        const ot = Math.max(0, Number($('#ot', dlg).value) || 0);
        done(await setMark(emp.id, date, { status, ot, note: $('#note', dlg).value.trim() }));
      }
    });
  });
}

// ---------------- month register ----------------
export async function month() {
  const m = app.params.get('m') || ym();
  const org = app.params.get('org') || '';
  app.title('Register', { back: true });
  const { active, employees, orgs } = await loadCore();
  const dates = monthDates(m);
  const first = dates[0], last = dates[dates.length - 1];
  const staff = employees.filter((e) => (!org || e.orgId === org) && (!e.joinDate || e.joinDate <= last) && (e.status !== 'left' || (e.exitDate && e.exitDate >= first)));
  const all = await db.by('attendance', 'month', m);
  const map = {};
  all.forEach((r) => ((map[r.empId] ||= {})[r.date] = r));
  const q = (mm) => { const p = new URLSearchParams(app.params); p.set('m', mm); return '#/attendance/month?' + p; };

  const totalFor = (e) => calcPay(e, Object.values(map[e.id] || {}), app.settings, m).payDays;
  const cell = (e, d) => {
    const r = map[e.id]?.[d];
    const st = r?.status || '';
    return `<td class="${st}" data-e="${e.id}" data-d="${d}"><button aria-label="${esc(e.name)} ${d}: ${st ? STATUS[st].label : 'not marked'}">${st ? STATUS[st].short : ''}${Number(r?.ot) ? '<sup>+</sup>' : ''}</button></td>`;
  };

  return {
    html: `
      <div class="daynav">
        <a class="icon-btn" href="${q(addMonths(m, -1))}" aria-label="Previous month">${ICONS.left}</a>
        <div class="label">${esc(monthLabel(m))}<small>Tap a box to change it</small></div>
        <a class="icon-btn" href="${q(addMonths(m, 1))}" aria-label="Next month">${ICONS.right}</a>
      </div>
      ${orgChips(orgs, org)}
      <div class="sheet">
        ${staff.length ? `<div class="reg-wrap"><table class="reg">
          <thead><tr><th class="name">Worker</th>${dates.map((d) => { const wd = parseYmd(d).getDay(); return `<th class="${wd === 0 ? 'we' : ''}">${Number(d.slice(8))}<br><small>${'SMTWTFS'[wd]}</small></th>`; }).join('')}<th>Days</th></tr></thead>
          <tbody>${staff.map((e) => `<tr><td class="name">${esc(e.name)}</td>${dates.map((d) => cell(e, d)).join('')}<td class="tot" data-tot="${e.id}">${num(totalFor(e))}</td></tr>`).join('')}</tbody>
        </table></div>` : empty('Nobody in this month', 'Workers appear here from their joining date.')}
      </div>
      <p class="small muted">P present · A absent · ½ half · PL paid leave · UL unpaid leave · WO weekly off · HO holiday · <sup>+</sup> overtime. “Days” are paid days.</p>
      <a class="btn ghost block" href="#/reports?r=attendance&m=${m}">${ICONS.share} Export register</a>`,
    bind(root) {
      root.addEventListener('click', async (e) => {
        const chip = e.target.closest('[data-org]');
        if (chip) { const p = new URLSearchParams(app.params); chip.dataset.org ? p.set('org', chip.dataset.org) : p.delete('org'); return app.go('#/attendance/month?' + p); }
        const td = e.target.closest('td[data-e]');
        if (!td) return;
        const { e: empId, d } = td.dataset;
        const cur = map[empId]?.[d]?.status || '';
        const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
        const saved = await setMark(empId, d, { status: next });
        (map[empId] ||= {})[d] = saved || undefined;
        if (!saved) delete map[empId][d];
        const emp = staff.find((x) => x.id === empId);
        td.outerHTML = cell(emp, d);
        root.querySelector(`[data-tot="${empId}"]`).textContent = num(totalFor(emp));
      });
    },
  };
}

// ---------------- leaves ----------------
export async function leaves() {
  app.title('Leaves', { back: true });
  const { active, employees } = await loadCore();
  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
  const list = (await db.all('leaves')).sort((a, b) => b.from.localeCompare(a.from));

  return {
    html: `
      <div class="sheet" id="leaveForm" hidden>
        <form class="sheet-body" id="lf">
          <label class="field"><span>Worker</span><select class="input" name="empId" required>${active.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.code)})</option>`).join('')}</select></label>
          <div class="grid2">
            <label class="field"><span>From</span><input class="input" type="date" name="from" value="${ymd()}" required></label>
            <label class="field"><span>To</span><input class="input" type="date" name="to" value="${ymd()}" required></label>
          </div>
          <div class="field"><div class="seg">
            <label><input type="radio" name="type" value="PL" checked><span>Paid leave</span></label>
            <label><input type="radio" name="type" value="UL"><span>Unpaid leave</span></label>
          </div></div>
          <label class="field"><span>Reason</span><input class="input" name="reason" placeholder="Sick, village, function…"></label>
          <div class="row"><button type="button" class="btn quiet" id="cancelLeave">Cancel</button><button class="btn grow">${ICONS.check} Save leave</button></div>
        </form>
      </div>
      <div class="sheet ledger">
        ${list.length ? `<div class="sheet-head"><h2>Leave record</h2><span class="aside">${list.length}</span></div>` + list.map((l, i) => {
          const days = datesBetween(l.from, l.to).length;
          return `<div class="row-item"><span class="lnum">${i + 1}</span>
            <div class="main"><div class="t1">${esc(empMap[l.empId]?.name || 'Removed worker')}</div><div class="t2">${esc(dateLabel(l.from))}${l.to !== l.from ? ' – ' + esc(dateLabel(l.to)) : ''} · ${days} ${days === 1 ? 'day' : 'days'}${l.reason ? ' · ' + esc(l.reason) : ''}</div></div>
            <span class="mark ${l.type}">${l.type}</span>
            <button class="icon-btn" data-del="${l.id}" aria-label="Delete leave" style="color:var(--ink-3)">${ICONS.trash}</button></div>`;
        }).join('') : empty('No leaves recorded', 'Leaves you add here are marked in attendance automatically.')}
      </div>`,
    bind(root) {
      fab(`<button class="btn" id="addLeave">${ICONS.plus} Add leave</button>`);
      const box = $('#leaveForm', root);
      $('#addLeave').onclick = () => { box.hidden = false; box.scrollIntoView({ behavior: 'smooth' }); };
      $('#cancelLeave', root).onclick = () => (box.hidden = true);
      $('#lf', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        if (d.to < d.from) return toast('"To" date is before "From" date.', 'bad');
        const dates = datesBetween(d.from, d.to);
        if (dates.length > 90) return toast('Leave longer than 90 days? Mark the worker as Left instead.', 'bad');
        await db.put('leaves', { id: uid(), ...d });
        const existing = Object.fromEntries((await db.by('attendance', 'empId', d.empId)).map((r) => [r.date, r]));
        await db.putMany('attendance', dates.map((dt) => ({ ...(existing[dt] || {}), id: recId(d.empId, dt), empId: d.empId, date: dt, month: dt.slice(0, 7), status: d.type, ot: existing[dt]?.ot || 0 })));
        toast(`Leave saved and ${dates.length} ${dates.length === 1 ? 'day' : 'days'} marked.`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      root.addEventListener('click', async (e) => {
        const id = e.target.closest('[data-del]')?.dataset.del;
        if (!id) return;
        if (!(await confirmBox('Delete this leave? Those days will be cleared in attendance.'))) return;
        const l = list.find((x) => x.id === id);
        const ids = datesBetween(l.from, l.to).map((dt) => recId(l.empId, dt));
        const recs = await Promise.all(ids.map((rid) => db.get('attendance', rid)));
        await db.delMany('attendance', recs.filter((r) => r && r.status === l.type).map((r) => r.id));
        await db.del('leaves', id);
        toast('Leave deleted.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}
