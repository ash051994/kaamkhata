import { getSettings, db } from './db.js';
import { $, esc, sha256, toast } from './util.js';
import * as home from './views/home.js';
import * as staff from './views/staff.js';
import * as attendance from './views/attendance.js';
import * as wages from './views/wages.js';
import * as more from './views/more.js';
import * as reports from './views/reports.js';

const routes = [
  [/^\/$/, home.render, 'home'],
  [/^\/staff$/, staff.list, 'staff'],
  [/^\/staff\/new$/, staff.form, 'staff'],
  [/^\/staff\/([\w-]+)\/edit$/, staff.form, 'staff'],
  [/^\/staff\/([\w-]+)\/docs$/, staff.docs, 'staff'],
  [/^\/staff\/([\w-]+)$/, staff.detail, 'staff'],
  [/^\/attendance$/, attendance.day, 'attendance'],
  [/^\/attendance\/month$/, attendance.month, 'attendance'],
  [/^\/leaves$/, attendance.leaves, 'attendance'],
  [/^\/wages$/, wages.month, 'wages'],
  [/^\/wages\/([\w-]+)\/([\d-]+)$/, wages.slip, 'wages'],
  [/^\/payments$/, wages.payments, 'wages'],
  [/^\/more$/, more.menu, 'more'],
  [/^\/orgs$/, more.orgs, 'more'],
  [/^\/settings$/, more.settings, 'more'],
  [/^\/backup$/, more.backup, 'more'],
  [/^\/reports$/, reports.render, 'more'],
];

export const app = {
  settings: null,
  params: new URLSearchParams(),
  title(text, { back = false, actions = '' } = {}) {
    $('#pageTitle').textContent = text;
    document.title = text === 'KaamKhata' ? text : `${text} · KaamKhata`;
    $('#backBtn').hidden = !back;
    $('#topActions').innerHTML = actions;
  },
  go(hash) {
    location.hash = hash;
  },
  async refreshSettings() {
    this.settings = await getSettings();
    return this.settings;
  },
};

let renderSeq = 0;
async function router() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  app.params = new URLSearchParams(query);
  const view = $('#view');
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  const seq = ++renderSeq;
  for (const [re, fn, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    document.querySelectorAll('.fab').forEach((f) => f.remove());
    try {
      const out = await fn(...m.slice(1));
      if (seq !== renderSeq) return; // a newer navigation happened
      // Views return either an HTML string or { html, bind(root) }.
      const fresh = view.cloneNode(false); // drop old listeners
      view.replaceWith(fresh);
      fresh.innerHTML = typeof out === 'string' ? out : out.html;
      if (out && out.bind) await out.bind(fresh);
    } catch (e) {
      console.error(e);
      $('#view').innerHTML = `<div class="sheet"><div class="empty"><h3>Could not open this screen</h3><p>${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div></div>`;
    }
    window.scrollTo(0, 0);
    return;
  }
  $('#view').innerHTML = `<div class="sheet"><div class="empty"><h3>Page not found</h3><a class="btn" href="#/">Go home</a></div></div>`;
}

$('#backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else app.go('#/');
});

// ---------- PIN lock ----------
async function lockIfNeeded() {
  const s = app.settings;
  if (!s.pinHash) return;
  const el = $('#lock');
  let pin = '';
  const draw = (err = '') => {
    el.innerHTML = `<div class="box">
      <h2>${esc(s.firmName || 'KaamKhata')}</h2>
      <p>Enter your 4-digit PIN</p>
      <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join('')}</div>
      <p class="err" role="alert">${esc(err)}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => (k === '' ? '<span></span>' : `<button data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>`)).join('')}</div>
    </div>`;
  };
  el.hidden = false;
  draw();
  return new Promise((resolve) => {
    el.addEventListener('click', async function onKey(e) {
      const k = e.target.closest('button')?.dataset.k;
      if (k === undefined) return;
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += k;
      draw();
      if (pin.length === 4) {
        if ((await sha256('kk:' + pin)) === s.pinHash) {
          el.hidden = true;
          el.innerHTML = '';
          el.removeEventListener('click', onKey);
          resolve();
        } else {
          pin = '';
          draw('Wrong PIN. Try again.');
        }
      }
    });
  });
}

async function start() {
  await app.refreshSettings();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await lockIfNeeded();
  window.addEventListener('hashchange', router);
  router();
  // First run: nudge towards adding the organisation.
  const orgs = await db.all('orgs');
  if (!orgs.length && !location.hash) toast('Start by adding the company your workers go to.');
}

if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
