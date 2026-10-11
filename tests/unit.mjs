// Unit tests for the parts that handle money and IDs. Run: node tests/unit.mjs
import assert from 'node:assert/strict';
import { validators, verhoeffValid, daysInMonth } from '../www/js/util.js';
import { calcPay, professionTax, ledgerFor, payState } from '../www/js/payroll.js';
import { parseEmployeeSpeech } from '../www/js/voice.js';

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('ok -', name); } catch (e) { console.error('FAIL -', name, '\n ', e.message); process.exitCode = 1; }
};

const S = { pfWageCap: 15000, pfRate: 12, employerPfRate: 13, esicLimit: 21000, esicRate: 0.75, employerEsicRate: 3.25, ptEnabled: true, otMultiplier: 2, hoursPerDay: 8, weeklyOffPaid: false };
const days = (n, status, extra = {}) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, status, ot: 0, ...extra }));

t('Aadhaar checksum (Verhoeff)', () => {
  assert.equal(verhoeffValid('234567890124'), true);
  assert.equal(verhoeffValid('234567890123'), false);
  assert.match(validators.aadhaar('1234 5678 9012'), /never starts/);
  assert.equal(validators.aadhaar('2345 6789 0124'), '');
});

t('PAN, IFSC, mobile, UAN formats', () => {
  assert.equal(validators.pan('abcpe1234f'), '');
  assert.notEqual(validators.pan('ABCDE1234F'), ''); // 4th letter D is not a valid holder type
  assert.equal(validators.ifsc('SBIN0001234'), '');
  assert.notEqual(validators.ifsc('SBIN1001234'), '');
  assert.equal(validators.phone('+91 98765 43210'), '');
  assert.notEqual(validators.phone('5876543210'), '');
  assert.notEqual(validators.uan('12345'), '');
});

t('daily wage: 26 present days with overtime', () => {
  const emp = { id: 'e', rate: 600, wageType: 'daily', pfApplicable: true, esicApplicable: true, gender: 'M' };
  const recs = [...days(26, 'P'), { date: '2026-09-27', status: 'WO', ot: 4 }];
  const p = calcPay(emp, recs, S, '2026-09');
  assert.equal(p.payDays, 26); // weekly off unpaid for daily wagers by default
  assert.equal(p.basic, 15600);
  assert.equal(p.otPay, 600); // 600/8*2*4
  assert.equal(p.gross, 16200);
  assert.equal(p.pf, 1800); // 12% of capped 15000
  assert.equal(p.esic, Math.ceil(16200 * 0.0075));
  assert.equal(p.pt, 200);
  assert.equal(p.net, Math.round(16200 - 1800 - p.esic - 200));
});

t('monthly salary pays weekly offs and prorates absences', () => {
  const emp = { id: 'e', rate: 30000, wageType: 'monthly', pfApplicable: true, esicApplicable: true, gender: 'F' };
  const recs = [...days(24, 'P'), ...days(4, 'WO').map((r, i) => ({ ...r, date: `2026-09-${25 + i}` })), { date: '2026-09-29', status: 'A' }, { date: '2026-09-30', status: 'A' }];
  const p = calcPay(emp, recs, S, '2026-09');
  assert.equal(daysInMonth('2026-09'), 30);
  assert.equal(p.payDays, 28);
  assert.equal(p.basic, 28000);
  assert.equal(p.esic, 0); // above ESIC limit
  assert.equal(p.pt, 200); // woman above 25,000
});

t('half days, leave and advance recovery', () => {
  const emp = { id: 'e', rate: 500, wageType: 'daily', pfApplicable: false, esicApplicable: false, gender: 'M' };
  const recs = [...days(10, 'P'), { date: '2026-09-11', status: 'H' }, { date: '2026-09-12', status: 'PL' }, { date: '2026-09-13', status: 'UL' }];
  const p = calcPay(emp, recs, S, '2026-09', { advanceRecovery: 1000, bonus: 250 });
  assert.equal(p.payDays, 11.5);
  assert.equal(p.gross, 5750 + 250);
  assert.equal(p.pt, 0);
  assert.equal(p.net, 5000);
});

t('Maharashtra profession tax slabs', () => {
  assert.equal(professionTax(7500, 'M', '2026-09'), 0);
  assert.equal(professionTax(9000, 'M', '2026-09'), 175);
  assert.equal(professionTax(12000, 'M', '2027-02'), 300);
  assert.equal(professionTax(20000, 'F', '2026-09'), 0);
});

t('ledger: advances, recovery, partial payment', () => {
  const pays = [
    { empId: 'e', type: 'advance', amount: 3000 },
    { empId: 'e', type: 'salary', amount: 4000, month: '2026-09' },
  ];
  const runs = [{ empId: 'e', final: true, net: 9000, advanceRecovery: 1000 }, { empId: 'e', final: false, net: 99999 }];
  const l = ledgerFor('e', pays, runs);
  assert.equal(l.advanceOutstanding, 2000);
  assert.equal(l.due, 5000);
  assert.equal(payState(9000, 4000).key, 'partial');
  assert.equal(payState(9000, 9000).key, 'paid');
});

t('voice: English sentence', () => {
  const r = parseEmployeeSpeech('Name Ramesh Patil, mobile 98765 43210, work welder, wage 650 per day, aadhaar 2345 6789 0124, IFSC sbin0001234', [{ id: 'o1', name: 'Sunrise Auto' }]);
  assert.equal(r.name, 'Ramesh Patil');
  assert.equal(r.phone, '9876543210');
  assert.equal(r.designation, 'Welder');
  assert.equal(r.rate, 650);
  assert.equal(r.wageType, 'daily');
  assert.equal(r.aadhaar, '234567890124');
  assert.equal(r.ifsc, 'SBIN0001234');
});

t('voice: Marathi with Devanagari digits', () => {
  const r = parseEmployeeSpeech('नाव सुनील जाधव मोबाईल ९८७६५४३२१० पगार १८००० महिना कंपनी sunrise auto', [{ id: 'o1', name: 'Sunrise Auto' }]);
  assert.equal(r.name, 'सुनील जाधव');
  assert.equal(r.phone, '9876543210');
  assert.equal(r.rate, 18000);
  assert.equal(r.wageType, 'monthly');
  assert.equal(r.orgId, 'o1');
});

t('voice: spoken digit words', () => {
  const r = parseEmployeeSpeech("name Anil Kale father's name Baban Kale mobile nine eight seven six five four three two one zero wage six hundred fifty");
  assert.equal(r.fatherName, 'Baban Kale');
  assert.equal(r.phone, '9876543210');
  assert.equal(r.rate, 650);
});

console.log(`\n${passed} unit tests passed${process.exitCode ? ', some failed' : ''}.`);
