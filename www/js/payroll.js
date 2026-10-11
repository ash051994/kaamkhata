// Wage calculation. Pure functions — easy to test and reason about.
import { daysInMonth } from './util.js';

export const STATUS = {
  P: { label: 'Present', short: 'P', pay: 1 },
  H: { label: 'Half day', short: '½', pay: 0.5 },
  A: { label: 'Absent', short: 'A', pay: 0 },
  PL: { label: 'Paid leave', short: 'PL', pay: 1 },
  UL: { label: 'Unpaid leave', short: 'UL', pay: 0 },
  WO: { label: 'Weekly off', short: 'WO', pay: null }, // depends on settings / wage type
  HO: { label: 'Holiday', short: 'HO', pay: 1 },
};
// Order used when tapping a cell to cycle through statuses.
export const CYCLE = ['P', 'A', 'H', 'PL', 'WO', 'HO', 'UL', ''];

export function countAttendance(records) {
  const c = { P: 0, H: 0, A: 0, PL: 0, UL: 0, WO: 0, HO: 0, ot: 0, marked: 0 };
  for (const r of records) {
    if (r.status && c[r.status] !== undefined) {
      c[r.status]++;
      c.marked++;
    }
    c.ot += Number(r.ot) || 0;
  }
  return c;
}

// Maharashtra Profession Tax slabs (monthly).
export function professionTax(gross, gender, month) {
  const feb = month.endsWith('-02');
  if (gender === 'F') return gross > 25000 ? (feb ? 300 : 200) : 0;
  if (gross <= 7500) return 0;
  if (gross <= 10000) return 175;
  return feb ? 300 : 200;
}

const r2 = (n) => Math.round(n * 100) / 100;

export function calcPay(emp, records, settings, month, extra = {}) {
  const c = countAttendance(records);
  const dim = daysInMonth(month);
  const rate = Number(emp.rate) || 0;
  const monthly = emp.wageType === 'monthly';
  const woPaid = monthly || settings.weeklyOffPaid;

  const payDays = c.P + c.H * 0.5 + c.PL + c.HO + (woPaid ? c.WO : 0);
  const dayRate = monthly ? rate / dim : rate;
  const basic = r2(payDays * dayRate);

  const otBaseDay = monthly ? rate / 26 : rate;
  const otRate = (otBaseDay / (Number(settings.hoursPerDay) || 8)) * (Number(settings.otMultiplier) || 2);
  const otPay = r2(c.ot * otRate);

  const bonus = Number(extra.bonus) || 0;
  const allowance = Number(extra.allowance) || 0;
  const gross = r2(basic + otPay + bonus + allowance);

  let pf = 0, pfEr = 0, pfWage = 0;
  if (emp.pfApplicable) {
    pfWage = Math.min(basic, Number(settings.pfWageCap) || 15000);
    pf = Math.round((pfWage * settings.pfRate) / 100);
    pfEr = Math.round((pfWage * settings.employerPfRate) / 100);
  }

  // ESIC wage excludes bonus. Eligibility is judged on the wage, not on what was earned this month only,
  // but for a small contractor the earned figure is the practical test.
  let esic = 0, esicEr = 0;
  const esicWage = basic + otPay + allowance;
  if (emp.esicApplicable && esicWage > 0 && esicWage <= Number(settings.esicLimit)) {
    esic = Math.ceil((esicWage * settings.esicRate) / 100);
    esicEr = Math.ceil((esicWage * settings.employerEsicRate) / 100);
  }

  const pt = settings.ptEnabled ? professionTax(gross, emp.gender, month) : 0;
  const advanceRecovery = Number(extra.advanceRecovery) || 0;
  const otherDeduction = Number(extra.otherDeduction) || 0;
  const deductions = pf + esic + pt + advanceRecovery + otherDeduction;
  const net = Math.round(gross - deductions);

  return {
    month,
    empId: emp.id,
    counts: c,
    daysInMonth: dim,
    payDays,
    rate,
    wageType: emp.wageType,
    dayRate: r2(dayRate),
    basic,
    otHours: c.ot,
    otRate: r2(otRate),
    otPay,
    bonus,
    allowance,
    gross,
    pfWage,
    pf,
    pfEr,
    esic,
    esicEr,
    pt,
    advanceRecovery,
    otherDeduction,
    deductions,
    net,
  };
}

// Money position for one employee across all time.
export function ledgerFor(empId, payments, payrolls) {
  const pays = payments.filter((p) => p.empId === empId);
  const runs = payrolls.filter((p) => p.empId === empId && p.final);
  const advances = pays.filter((p) => p.type === 'advance').reduce((s, p) => s + Number(p.amount), 0);
  const recovered = runs.reduce((s, p) => s + (Number(p.advanceRecovery) || 0), 0);
  const earned = runs.reduce((s, p) => s + (Number(p.net) || 0), 0);
  const paid = pays.filter((p) => p.type === 'salary').reduce((s, p) => s + Number(p.amount), 0);
  return {
    advanceOutstanding: Math.max(0, advances - recovered),
    advances,
    recovered,
    earned,
    paid,
    due: earned - paid,
  };
}

export function monthPaid(empId, month, payments) {
  return payments
    .filter((p) => p.empId === empId && p.type === 'salary' && p.month === month)
    .reduce((s, p) => s + Number(p.amount), 0);
}

export function payState(net, paid) {
  if (net <= 0) return { key: 'none', label: 'Nothing due' };
  if (paid <= 0) return { key: 'unpaid', label: 'Unpaid' };
  if (paid < net) return { key: 'partial', label: 'Partly paid' };
  if (paid === net) return { key: 'paid', label: 'Paid' };
  return { key: 'over', label: 'Paid extra' };
}
