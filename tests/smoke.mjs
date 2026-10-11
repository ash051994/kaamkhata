// End-to-end smoke test: opens every screen on a phone-sized browser, adds a worker,
// marks attendance, finalises wages, records a payment and exports reports.
// Run: npm run serve (in one terminal), then: node tests/smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, colorScheme: process.env.DARK ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.accept());

const go = async (hash) => {
  await page.goto(`${BASE}/index.html${hash}`);
  await page.waitForTimeout(350);
  const broken = await page.locator('text=Could not open this screen').count();
  if (broken) errors.push(`${hash}: ` + (await page.locator('#view').innerText()));
};
const shot = async (name) => { if (!SHOTS) return; await page.evaluate(() => document.getElementById('toast')?.remove()); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const ok = (cond, msg) => { if (!cond) errors.push('FAIL: ' + msg); else console.log('ok -', msg); };

// 1. Fresh app
await go('#/');
ok(await page.locator('text=Set up your register').count(), 'first-run setup steps show');
await shot('00-setup');

// 2. Company
await go('#/orgs');
await page.fill('input[name=name]', 'Test Plant Chakan');
await page.click('#of button.btn.grow');
await page.waitForTimeout(300);
ok(await page.locator('text=Test Plant Chakan').count(), 'company added');

// 3. Worker via voice text parser
await go('#/staff/new?voice=1');
await page.fill('#heard', 'name Ramesh Patil mobile 98765 43210 work welder wage 650 per day aadhaar 2345 6789 0124 bank account 12345678901 ifsc SBIN0001234');
await page.waitForTimeout(150);
ok((await page.locator('#parsed .kv').count()) >= 6, 'voice parser found fields');
await shot('01-voice');
await page.click('#applyBtn');
ok((await page.inputValue('input[name=name]')) === 'Ramesh Patil', 'voice filled name');
ok((await page.inputValue('input[name=rate]')) === '650', 'voice filled rate');
await page.fill('input[name=aadhaar]', '2345 6789 0123');
await page.locator('input[name=pan]').click();
ok(await page.locator('.field[data-f=aadhaar].err').count(), 'bad Aadhaar checksum is flagged');
await page.fill('input[name=aadhaar]', '');
await page.click('#empForm button[type=submit]');
await page.waitForTimeout(400);
ok(page.url().includes('/docs'), 'worker saved, documents screen opens');
await shot('02-docs');

// 4. Attendance
await go('#/attendance');
await page.click('#allP');
await page.waitForTimeout(250);
ok(await page.locator('.att-picks button.P.on').count(), 'mark everyone present');

// 5. Sample data for remaining screens
await go('#/backup');
await page.click('#demo');
await page.locator('dialog.confirm button[value=yes]').click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);
await go('#/');
ok(await page.locator('.today').count(), 'dashboard with sample data');
await shot('10-home');
for (const [hash, name] of [
  ['#/staff', '11-staff'], ['#/attendance', '12-attendance'], ['#/attendance/month', '13-register'],
  ['#/wages', '14-wages'], ['#/payments', '16-payments'], ['#/leaves', '17-leaves'], ['#/more', '18-more'],
  ['#/orgs', '19-orgs'], ['#/settings', '20-settings'], ['#/reports', '21-reports'], ['#/staff/new', '22-form'],
]) {
  await go(hash);
  await shot(name);
}
// staff detail + payslip
await go('#/staff');
await page.locator('.row-item').nth(2).click();
await page.waitForTimeout(400);
await shot('15-worker');
const empUrl = page.url();
const empId = empUrl.split('/staff/')[1];
const prev = await page.evaluate(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
await go(`#/wages/${empId}/${prev}`);
ok(await page.locator('text=Net pay').count(), 'payslip renders');
await shot('15b-payslip');

// 6. Finalise current month and pay one worker
await go('#/wages');
await page.click('#finalise');
await page.locator('dialog.confirm button[value=yes]').click();
await page.waitForTimeout(600);
ok(await page.locator('#reopen').count(), 'month finalised');
await go(`#/payments?new=salary&emp=${empId}`);
await page.waitForTimeout(400);
const amt = await page.inputValue('input[name=amount]');
ok(Number(amt) > 0, 'payment amount prefilled with due: ' + amt);
await page.fill('input[name=amount]', String(Math.round(Number(amt) / 2)));
await page.click('#pf button.btn.grow');
await page.waitForTimeout(500);
await go(`#/wages/${empId}/${(await page.evaluate(() => new Date().toISOString().slice(0, 7)))}`);
ok(await page.locator('text=Partly paid').count(), 'partial payment shows as partly paid');

// 7. Reports download
await go('#/reports');
for (const r of ['staff', 'attendance', 'wages', 'statutory', 'dues', 'kyc', 'payslips']) {
  await go('#/reports'); // fresh page: Chromium throttles many downloads from one page
  await page.selectOption('select[name=r]', r);
  for (const kind of r === 'payslips' ? ['pdf'] : ['pdf', 'csv']) {
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.click(`[data-kind=${kind}]`);
    const file = await dl.catch(() => null);
    if (!file) { errors.push(`${r} ${kind}: ` + (await page.locator('#toast').innerText().catch(() => ''))); }
    ok(file && /\.(pdf|csv)$/.test(file.suggestedFilename()), `${r} ${kind} report downloads`);
    if (file && SHOTS && kind === 'pdf' && ['wages', 'payslips'].includes(r)) await file.saveAs(`${SHOTS}/${r}.pdf`);
  }
}

// 8. Backup round-trip
await go('#/backup');
const dl = page.waitForEvent('download');
await page.click('#exp');
const backup = await dl;
ok(backup.suggestedFilename().endsWith('.json'), 'backup file downloads');

await browser.close();
if (errors.length) {
  console.error('\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nAll checks passed.');
