// Voice entry: speech → text (browser Web Speech API, or the native Android plugin inside the app)
// and text → employee fields. Works with English, Hindi and Marathi keywords.
import { ymd } from './util.js';

const DEV_DIGITS = { '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9 };

const WORD_NUM = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9,
  शून्य: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9,
  दोन: 2, सहा: 6, नऊ: 9,
};
const SCALE = { hundred: 100, sau: 100, सौ: 100, शंभर: 100, thousand: 1000, hazar: 1000, hajar: 1000, हजार: 1000, हज़ार: 1000 };

// Field keywords. Longer phrases first so "father name" wins over "name".
const FIELDS = [
  ['fatherName', ["father's name", 'father name', 'fathers name', 'father', 'pita', 'वडिलांचे नाव', 'वडील', 'पिता', 'पिताजी']],
  ['accountNo', ['account number', 'bank account', 'account no', 'account', 'khata number', 'खाता नंबर', 'खाते क्रमांक', 'खाता']],
  ['ifsc', ['ifsc code', 'ifsc', 'आयएफएससी']],
  ['bankName', ['bank name', 'bank', 'बँक', 'बैंक']],
  ['uan', ['uan number', 'uan', 'pf number', 'पीएफ']],
  ['esic', ['esic number', 'esic', 'ईएसआयसी']],
  ['aadhaar', ['aadhaar number', 'aadhar number', 'aadhaar', 'aadhar', 'adhar', 'आधार']],
  ['pan', ['pan card', 'pan number', 'pan', 'पॅन', 'पैन']],
  ['phone', ['mobile number', 'phone number', 'mobile', 'phone', 'contact', 'मोबाईल', 'मोबाइल', 'फोन', 'फ़ोन']],
  ['designation', ['designation', 'work as', 'works as', 'work', 'job', 'post', 'role', 'kaam', 'काम', 'पद', 'हुद्दा']],
  ['rate', ['daily wage', 'wage', 'salary', 'rate', 'pagar', 'mazdoori', 'पगार', 'वेतन', 'मजदूरी', 'मजुरी', 'रोजंदारी']],
  ['org', ['company', 'organisation', 'organization', 'factory', 'कंपनी', 'कारखाना']],
  ['address', ['address', 'pata', 'पत्ता', 'पता', 'राहणार']],
  ['gender', ['gender', 'लिंग']],
  ['joinDate', ['joining date', 'joined on', 'joined', 'date of joining', 'रुजू']],
  ['name', ['full name', 'employee name', 'worker name', 'name is', 'name', 'naam', 'नाव', 'नाम']],
];

const DIGIT_FIELDS = new Set(['phone', 'aadhaar', 'accountNo', 'uan', 'esic']);

function normDigits(s) {
  return s.replace(/[०-९]/g, (d) => DEV_DIGITS[d]);
}

const TENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  das: 10, bees: 20, tees: 30, chalis: 40, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
};

// "nine eight seven six" → "9876" (digit by digit); "six hundred fifty" → "650" (as an amount)
function wordsToNumber(text) {
  const tokens = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const amount = tokens.some((t) => t in SCALE || t in TENS);
  let total = 0, cur = 0, seq = '', seen = false;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) { seen = true; seq += t; cur = amount ? cur + Number(t) : Number(seq); continue; }
    if (t in WORD_NUM) { seen = true; seq += WORD_NUM[t]; cur = amount ? cur + WORD_NUM[t] : Number(seq); continue; }
    if (t in TENS) { seen = true; cur += TENS[t]; continue; }
    if (t in SCALE) {
      seen = true;
      cur = (cur || 1) * SCALE[t];
      if (SCALE[t] >= 1000) { total += cur; cur = 0; }
    }
  }
  if (!seen) return null;
  return amount ? String(total + cur) : seq;
}

function extractDigits(value) {
  const v = normDigits(value);
  const direct = v.replace(/\D/g, '');
  if (direct.length >= 4) return direct;
  const w = wordsToNumber(v);
  return w ? w.replace(/\D/g, '') : direct;
}

function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function parseEmployeeSpeech(raw, orgs = []) {
  let text = ' ' + normDigits(raw).replace(/[,.;:।]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  const lower = text.toLowerCase();

  // Find keyword positions (non-overlapping, earliest-longest wins)
  const hits = [];
  for (const [field, words] of FIELDS) {
    for (const w of words) {
      const re = new RegExp('(^|[\\s])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s])', 'gi');
      let m;
      while ((m = re.exec(lower))) {
        const start = m.index + m[1].length;
        hits.push({ field, start, end: start + w.length });
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen = [];
  for (const h of hits) {
    if (chosen.length && h.start < chosen[chosen.length - 1].end) continue;
    if (chosen.some((c) => c.field === h.field)) continue;
    chosen.push(h);
  }

  const out = {};
  chosen.forEach((h, i) => {
    const next = chosen[i + 1];
    let value = text.slice(h.end, next ? next.start : text.length).trim();
    value = value.replace(/^(is|hai|आहे|है|:|-)\s+/i, '').replace(/\s+(is|hai|आहे|है)$/i, '').trim();
    if (!value) return;
    out[h.field] = value;
  });

  const result = {};
  for (const [k, v] of Object.entries(out)) {
    if (DIGIT_FIELDS.has(k)) {
      const d = extractDigits(v);
      if (d) result[k] = k === 'phone' ? d.replace(/^91(?=\d{10}$)/, '').slice(-10) : d;
    } else if (k === 'rate') {
      const lv = v.toLowerCase();
      const n = extractDigits(lv.replace(/(rupees?|rs|रुपये|रुपए|₹)/g, ' '));
      if (n) result.rate = Number(n);
      if (/(month|mahina|महिना|महीना|monthly)/.test(lv)) result.wageType = 'monthly';
      else if (/(day|daily|roj|din|दिवस|दिन|रोज)/.test(lv)) result.wageType = 'daily';
    } else if (k === 'pan' || k === 'ifsc') {
      result[k] = v.replace(/\s+/g, '').toUpperCase();
    } else if (k === 'gender') {
      const lv = v.toLowerCase();
      if (/(female|woman|lady|mahila|महिला|स्त्री)/.test(lv)) result.gender = 'F';
      else if (/(male|man|purush|पुरुष)/.test(lv)) result.gender = 'M';
    } else if (k === 'joinDate') {
      const lv = v.toLowerCase();
      const d = new Date();
      if (/(today|aaj|आज)/.test(lv)) result.joinDate = ymd(d);
      else if (/(yesterday|kal|काल)/.test(lv)) { d.setDate(d.getDate() - 1); result.joinDate = ymd(d); }
    } else if (k === 'org') {
      const lv = v.toLowerCase();
      const match = orgs.find((o) => lv.includes(o.name.toLowerCase()) || o.name.toLowerCase().includes(lv));
      if (match) result.orgId = match.id;
      result.orgName = titleCase(v);
    } else {
      result[k] = /[a-z]/i.test(v) ? titleCase(v.toLowerCase()) : v.trim();
    }
  }
  // Standalone gender words without a keyword
  if (!result.gender) {
    if (/\b(female|woman|lady)\b|महिला/.test(lower)) result.gender = 'F';
    else if (/\b(male)\b|पुरुष/.test(lower)) result.gender = 'M';
  }
  return result;
}

// ---------- speech recognition ----------
export function voiceSupport() {
  const native = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.SpeechRecognition;
  const web = window.SpeechRecognition || window.webkitSpeechRecognition;
  return native ? 'native' : web ? 'web' : '';
}

// Returns a controller { stop() }. onText(fullTranscript, isFinal)
export function listen({ lang = 'en-IN', onText, onEnd, onError }) {
  const kind = voiceSupport();
  if (kind === 'native') {
    const SR = window.Capacitor.Plugins.SpeechRecognition;
    let handle;
    (async () => {
      try {
        const perm = await SR.requestPermissions();
        if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') throw new Error('Microphone permission was denied.');
        handle = await SR.addListener('partialResults', (d) => d.matches && d.matches[0] && onText(d.matches[0], false));
        const res = await SR.start({ language: lang, maxResults: 1, partialResults: true, popup: false });
        if (res && res.matches && res.matches[0]) onText(res.matches[0], true);
      } catch (e) {
        onError && onError(e.message || String(e));
      } finally {
        handle && handle.remove && handle.remove();
      }
    })();
    return {
      stop: async () => {
        try { await SR.stop(); } catch (_) { /* already stopped */ }
        onEnd && onEnd();
      },
    };
  }
  if (kind === 'web') {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      onText((finalText + interim).trim(), !interim);
    };
    rec.onerror = (e) => onError && onError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Voice input stopped: ' + e.error);
    rec.onend = () => onEnd && onEnd();
    rec.start();
    return { stop: () => rec.stop() };
  }
  onError && onError('Voice input is not available on this device. Type the details instead.');
  return { stop() {} };
}

export function speak(text, lang = 'en-IN') {
  try {
    const tts = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.TextToSpeech;
    if (tts) {
      tts.speak({ text, lang, rate: 1.0 }).catch(() => {});
      return;
    }
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* speaking back is a nicety; ignore failures */
  }
}
