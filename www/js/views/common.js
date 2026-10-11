import { db } from '../db.js';
import { esc } from '../util.js';

export const ICONS = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V9l6-3v15M10 21V4l10 4v13M3 21h18M14 11h2M14 15h2"/></svg>',
  report: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M10 20V4M15 20v-7M20 20V8"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  cash: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  leave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/></svg>',
};

export async function loadCore() {
  const [employees, orgs] = await Promise.all([db.all('employees'), db.all('orgs')]);
  employees.sort((a, b) => a.name.localeCompare(b.name));
  orgs.sort((a, b) => a.name.localeCompare(b.name));
  const orgMap = Object.fromEntries(orgs.map((o) => [o.id, o]));
  return { employees, orgs, orgMap, active: employees.filter((e) => e.status !== 'left') };
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatar(emp, cls = '') {
  return `<span class="avatar ${cls}" aria-hidden="true">${emp.photo ? `<img src="${emp.photo}" alt="">` : esc(initials(emp.name))}</span>`;
}

export function orgOptions(orgs, selected, { all = false } = {}) {
  return (all ? `<option value="">All companies</option>` : '') +
    orgs.map((o) => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
}

export function fab(html) {
  const el = document.createElement('div');
  el.className = 'fab';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

export function empty(title, text, action = '') {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

export const DOC_TYPES = [
  ['aadhaar', 'Aadhaar card'],
  ['pan', 'PAN card'],
  ['bank', 'Bank passbook / cheque'],
  ['photo', 'Passport photo'],
  ['uan', 'PF (UAN) card'],
  ['esic', 'ESIC card'],
  ['police', 'Police verification'],
  ['medical', 'Medical fitness'],
  ['other', 'Other'],
];
export const REQUIRED_DOCS = ['aadhaar', 'bank', 'photo'];

// Simple completeness check for an employee's KYC.
export function docStatus(emp) {
  const docs = emp.docs || [];
  const verified = REQUIRED_DOCS.filter((t) => docs.some((d) => d.type === t && d.status === 'verified')).length;
  const rejected = docs.some((d) => d.status === 'rejected');
  if (rejected) return { key: 'bad', label: 'Document rejected' };
  if (verified === REQUIRED_DOCS.length) return { key: 'ok', label: 'KYC done' };
  return { key: 'warn', label: `KYC ${verified}/${REQUIRED_DOCS.length}` };
}
