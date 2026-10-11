// IndexedDB storage — everything stays on the phone. No server, no domain.
const DB_NAME = 'kaamkhata';
const DB_VERSION = 1;
export const STORES = ['orgs', 'employees', 'attendance', 'leaves', 'payments', 'payroll', 'meta'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const mk = (name, indexes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, { keyPath: 'id' });
        indexes.forEach((i) => s.createIndex(i, i));
      };
      mk('orgs');
      mk('employees', ['orgId', 'status']);
      mk('attendance', ['empId', 'date', 'month']);
      mk('leaves', ['empId']);
      mk('payments', ['empId', 'month']);
      mk('payroll', ['empId', 'month']);
      mk('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const db = {
  async all(name) {
    return wrap((await store(name)).getAll());
  },
  async get(name, id) {
    return wrap((await store(name)).get(id));
  },
  async by(name, index, value) {
    return wrap((await store(name)).index(index).getAll(value));
  },
  async put(name, obj) {
    if (!obj.id) obj.id = uid();
    obj.updatedAt = new Date().toISOString();
    if (!obj.createdAt) obj.createdAt = obj.updatedAt;
    await wrap((await store(name, 'readwrite')).put(obj));
    return obj;
  },
  async putMany(name, list) {
    const d = await open();
    const tx = d.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    const now = new Date().toISOString();
    list.forEach((o) => {
      if (!o.id) o.id = uid();
      o.updatedAt = now;
      if (!o.createdAt) o.createdAt = now;
      s.put(o);
    });
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(list);
      tx.onerror = () => rej(tx.error);
    });
  },
  async del(name, id) {
    return wrap((await store(name, 'readwrite')).delete(id));
  },
  async delMany(name, ids) {
    const d = await open();
    const tx = d.transaction(name, 'readwrite');
    ids.forEach((id) => tx.objectStore(name).delete(id));
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  async clear(name) {
    return wrap((await store(name, 'readwrite')).clear());
  },
  async exportAll() {
    const out = { app: 'kaamkhata', version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
    for (const s of STORES) out.data[s] = await this.all(s);
    return out;
  },
  async importAll(json) {
    if (!json || json.app !== 'kaamkhata' || !json.data) throw new Error('This file is not a KaamKhata backup.');
    for (const s of STORES) {
      await this.clear(s);
      if (Array.isArray(json.data[s]) && json.data[s].length) await this.putMany(s, json.data[s]);
    }
  },
};

export const DEFAULT_SETTINGS = {
  id: 'settings',
  firmName: '',
  ownerName: '',
  phone: '',
  pfWageCap: 15000,
  pfRate: 12,
  employerPfRate: 13,
  esicLimit: 21000,
  esicRate: 0.75,
  employerEsicRate: 3.25,
  ptEnabled: true,
  otMultiplier: 2,
  hoursPerDay: 8,
  weeklyOffPaid: false,
  voiceLang: 'en-IN',
  speakBack: true,
  pinHash: '',
};

export async function getSettings() {
  const s = await db.get('meta', 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function saveSettings(s) {
  return db.put('meta', { ...s, id: 'settings' });
}
