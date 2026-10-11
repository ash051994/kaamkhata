// Small helpers: escaping, formatting, dates, validators, file export.

export const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const money = (n) => '₹' + inr.format(Math.round(Number(n) || 0));
export const moneyPlain = (n) => 'Rs. ' + inr.format(Math.round(Number(n) || 0));
export const num = (n, d = 1) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(d);
};

// ---------- dates (local time, YYYY-MM-DD strings) ----------
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
export const monthDates = (month) => {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
};
export const addMonths = (month, k) => {
  const [y, m] = month.split('-').map(Number);
  return ym(new Date(y, m - 1 + k, 1));
};
export const addDays = (date, k) => {
  const d = parseYmd(date);
  d.setDate(d.getDate() + k);
  return ymd(d);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const dateLabel = (date) => {
  if (!date) return '';
  const d = parseYmd(date);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const dayName = (date) => DAYS[parseYmd(date).getDay()];
export const datesBetween = (from, to) => {
  const out = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard++ < 400) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
};

// ---------- validators ----------
// Verhoeff checksum, used by Aadhaar's last digit.
const vD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const vP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeffValid(numStr) {
  let c = 0;
  const digits = numStr.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = vD[c][vP[i % 8][digits[i]]];
  return c === 0;
}

export const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

// Each validator returns '' when valid/empty, else a message.
export const validators = {
  phone(v) {
    const d = digitsOnly(v).replace(/^91(?=\d{10}$)/, '');
    if (!d) return '';
    return /^[6-9]\d{9}$/.test(d) ? '' : 'Mobile number should be 10 digits starting with 6, 7, 8 or 9.';
  },
  aadhaar(v) {
    const d = digitsOnly(v);
    if (!d) return '';
    if (d.length !== 12) return 'Aadhaar should be 12 digits.';
    if (/^[01]/.test(d)) return 'Aadhaar never starts with 0 or 1. Check the number.';
    if (!verhoeffValid(d)) return 'Aadhaar check digit does not match. One digit is probably wrong.';
    return '';
  },
  pan(v) {
    const s = String(v || '').trim().toUpperCase();
    if (!s) return '';
    return /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/.test(s) ? '' : 'PAN should look like ABCPE1234F (5 letters, 4 digits, 1 letter).';
  },
  ifsc(v) {
    const s = String(v || '').trim().toUpperCase();
    if (!s) return '';
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) ? '' : 'IFSC should be 11 characters like SBIN0001234 (5th character is 0).';
  },
  uan(v) {
    const d = digitsOnly(v);
    if (!d) return '';
    return d.length === 12 ? '' : 'UAN (PF number) should be 12 digits.';
  },
  esic(v) {
    const d = digitsOnly(v);
    if (!d) return '';
    return d.length === 10 || d.length === 17 ? '' : 'ESIC IP number should be 10 digits.';
  },
  account(v) {
    const d = digitsOnly(v);
    if (!d) return '';
    return d.length >= 9 && d.length <= 18 ? '' : 'Bank account number should be 9 to 18 digits.';
  },
};

export const maskAadhaar = (v) => {
  const d = digitsOnly(v);
  return d.length === 12 ? 'XXXX XXXX ' + d.slice(8) : d;
};
export const fmtAadhaar = (v) => digitsOnly(v).replace(/(\d{4})(?=\d)/g, '$1 ');

// ---------- UI feedback ----------
let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

export function confirmBox(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    dlg.innerHTML = `<p>${esc(message)}</p><div class="row end"><button class="btn ghost" value="no">Cancel</button><button class="btn danger" value="yes">${esc(okLabel)}</button></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      const v = e.target.value;
      if (v) {
        dlg.close();
        dlg.remove();
        resolve(v === 'yes');
      }
    });
    dlg.showModal();
  });
}

// ---------- images ----------
export function compressImage(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- files: download in browser, share sheet on Android ----------
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function toBase64(data) {
  if (data instanceof Uint8Array) {
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  return btoa(unescape(encodeURIComponent(data)));
}

export async function saveFile(filename, data, mime) {
  if (isNative()) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    if (Filesystem && Share) {
      const res = await Filesystem.writeFile({ path: filename, data: toBase64(data), directory: 'CACHE' });
      await Share.share({ title: filename, url: res.uri, dialogTitle: 'Send or save ' + filename });
      return;
    }
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toCSV(rows) {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? '');
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(',')
    )
    .join('\r\n');
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
