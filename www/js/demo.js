// Sample data so a new user (or a Play Store reviewer) can explore the app.
import { db, uid, saveSettings, getSettings } from './db.js';
import { ymd, ym, addMonths, monthDates, parseYmd } from './util.js';
import { calcPay } from './payroll.js';

const FIRST = ['Ramesh', 'Suresh', 'Ganesh', 'Sunil', 'Vijay', 'Santosh', 'Anil', 'Prakash', 'Mahesh', 'Dnyaneshwar', 'Rahul', 'Amol',
  'Sachin', 'Nitin', 'Vikas', 'Rupesh', 'Sanjay', 'Manoj', 'Pooja', 'Sunita', 'Kavita', 'Asha', 'Rekha', 'Shobha'];
const LAST = ['Patil', 'Jadhav', 'Pawar', 'Shinde', 'More', 'Gaikwad', 'Kale', 'Chavan', 'Yadav', 'Kamble', 'Bhosale', 'Wagh', 'Thakur', 'Salunkhe'];
const WORK = [['Helper', 520], ['Loader', 540], ['Machine operator', 680], ['Welder', 750], ['Fitter', 720], ['Packer', 520], ['Electrician', 800], ['Housekeeping', 500]];
const BANKS = [['Bank of Maharashtra', 'MAHB0000'], ['State Bank of India', 'SBIN0001'], ['Bank of Baroda', 'BARB0CHA'], ['Union Bank of India', 'UBIN0558']];

// Verhoeff tables for making valid-looking (made-up) Aadhaar numbers
const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
function verhoeffDigit(num) {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = d[c][p[(i + 1) % 8][digits[i]]];
  return inv[c];
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

export async function loadDemo() {
  seed = 42;
  await db.importAll({ app: 'kaamkhata', data: {} });
  const s = await getSettings();
  await saveSettings({ ...s, firmName: 'Shree Samarth Manpower Services', ownerName: 'Sample Contractor', phone: '9800000000' });

  const orgs = [
    { id: uid(), name: 'Sunrise Auto Components', address: 'Plot D-12, Chakan MIDC, Pune', contact: 'HR — Mr. Kulkarni' },
    { id: uid(), name: 'Deccan Packaging Pvt Ltd', address: 'Taloja MIDC, Navi Mumbai', contact: 'Admin office' },
  ];
  await db.putMany('orgs', orgs);

  const thisMonth = ym();
  const lastMonth = addMonths(thisMonth, -1);
  const emps = FIRST.map((first, i) => {
    const [work, rate] = WORK[i % WORK.length];
    const [bank, ifscP] = pick(BANKS);
    const a11 = String(2 + Math.floor(rnd() * 7)) + digits(10);
    const female = i >= 18;
    const docs = [];
    if (i % 5 !== 3) docs.push({ type: 'aadhaar', status: i % 7 === 2 ? 'pending' : 'verified' });
    if (i % 4 !== 1) docs.push({ type: 'bank', status: 'verified' });
    if (i % 6 !== 5) docs.push({ type: 'photo', status: 'verified' });
    if (i === 11) docs.push({ type: 'pan', status: 'rejected', note: 'Name does not match Aadhaar' });
    return {
      id: uid(),
      code: 'W' + String(i + 1).padStart(3, '0'),
      name: `${first} ${LAST[i % LAST.length]}`,
      fatherName: `${pick(['Dattatray', 'Baban', 'Shankar', 'Maruti', 'Vitthal', 'Raghunath'])} ${LAST[i % LAST.length]}`,
      gender: female ? 'F' : 'M',
      phone: pick(['9', '8', '7']) + digits(9),
      orgId: orgs[i < 15 ? 0 : 1].id,
      designation: work,
      skill: rate > 650 ? 'Skilled' : rate > 530 ? 'Semi-skilled' : 'Unskilled',
      wageType: i === 0 ? 'monthly' : 'daily',
      rate: i === 0 ? 21000 : rate,
      joinDate: i === 23 ? `${thisMonth}-03` : `${2023 + (i % 3)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
      aadhaar: a11 + verhoeffDigit(a11),
      uan: '10' + digits(10),
      esic: i % 3 ? '31' + digits(8) : '',
      bankName: bank,
      accountNo: digits(11 + (i % 4)),
      ifsc: ifscP + digits(11 - ifscP.length),
      pfApplicable: true,
      esicApplicable: true,
      address: pick(['Chakan, Pune', 'Mhalunge, Pune', 'Talegaon', 'Kharghar, Navi Mumbai', 'Panvel']),
      status: 'active',
      docs,
    };
  });
  emps[0].designation = 'Supervisor';
  emps[0].skill = 'Highly skilled';
  await db.putMany('employees', emps);

  const today = ymd();
  const att = [];
  for (const m of [lastMonth, thisMonth]) {
    for (const date of monthDates(m)) {
      if (date > today) break;
      const sunday = parseYmd(date).getDay() === 0;
      for (const e of emps) {
        if (e.joinDate > date) continue;
        let status = 'P';
        const r = rnd();
        if (sunday) status = 'WO';
        else if (r < 0.06) status = 'A';
        else if (r < 0.09) status = 'H';
        else if (r < 0.11) status = 'PL';
        const ot = status === 'P' && rnd() < 0.18 ? pick([1, 2, 2, 3, 4]) : 0;
        att.push({ id: `${e.id}|${date}`, empId: e.id, date, month: m, status, ot });
      }
    }
  }
  // leave today's last few unmarked so the attendance screen has work to do
  const todays = att.filter((a) => a.date === today);
  todays.slice(-5).forEach((a) => (a.status = ''));
  await db.putMany('attendance', att.filter((a) => a.status));

  // Advances given early last month
  const pays = [];
  [2, 5, 9, 14, 20].forEach((i, k) => pays.push({ id: uid(), empId: emps[i].id, type: 'advance', amount: [2000, 1500, 3000, 1000, 2500][k], date: `${lastMonth}-0${k + 3}`, mode: 'Cash', note: pick(['Medical', 'Village visit', 'School fees', '']) }));
  await db.putMany('payments', pays);

  // Finalise last month with some advance recovery, then pay most of it
  const settings = await getSettings();
  const runs = emps.map((e) => {
    const recs = att.filter((a) => a.empId === e.id && a.month === lastMonth && a.status);
    const adv = pays.find((x) => x.empId === e.id);
    const extras = adv ? { advanceRecovery: Math.min(adv.amount, 1000) } : {};
    if (e.code === 'W004') extras.bonus = 500;
    return { ...calcPay(e, recs, settings, lastMonth, extras), id: `${lastMonth}|${e.id}`, extras, final: true, finalisedAt: new Date().toISOString(), empName: e.name };
  });
  await db.putMany('payroll', runs);
  const paid = [];
  runs.forEach((r, i) => {
    if (r.net <= 0) return;
    if (i % 6 === 4) return; // unpaid
    const amount = i % 5 === 1 ? Math.round(r.net / 2 / 100) * 100 : r.net; // some partly paid
    paid.push({ id: uid(), empId: r.empId, type: 'salary', month: lastMonth, amount, date: `${thisMonth}-0${1 + (i % 7)}`, mode: i % 3 ? 'Bank transfer' : 'Cash', note: '' });
  });
  await db.putMany('payments', paid.filter((x) => x.date <= today));
}
