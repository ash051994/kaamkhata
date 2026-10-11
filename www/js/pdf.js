// Tiny PDF maker. Pages are drawn on a canvas (so Devanagari and any script render with the
// phone's own fonts) and embedded as JPEG images. No libraries, works offline.

const PT = { w: 595.28, h: 841.89 }; // A4 in points
const SCALE = 2.2; // canvas pixels per point (~160 dpi)
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif';

export class Doc {
  constructor({ landscape = false, margin = 32, title = '', subtitle = '', footer = '' } = {}) {
    this.W = landscape ? PT.h : PT.w;
    this.H = landscape ? PT.w : PT.h;
    this.m = margin;
    this.title = title;
    this.subtitle = subtitle;
    this.footer = footer;
    this.pages = [];
    this.newPage();
  }

  newPage() {
    const c = document.createElement('canvas');
    c.width = Math.round(this.W * SCALE);
    c.height = Math.round(this.H * SCALE);
    const g = c.getContext('2d');
    g.scale(SCALE, SCALE);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.W, this.H);
    g.textBaseline = 'alphabetic';
    this.c = c;
    this.g = g;
    this.pages.push(c);
    this.y = this.m;
    if (this.title) {
      this.text(this.title, this.m, this.y + 14, { size: 15, bold: true });
      this.y += 20;
      if (this.subtitle) {
        this.text(this.subtitle, this.m, this.y + 10, { size: 9, color: '#475569' });
        this.y += 14;
      }
      this.g.strokeStyle = '#B3261E';
      this.g.lineWidth = 1.2;
      this.line(this.m, this.y + 4, this.W - this.m, this.y + 4);
      this.y += 14;
    }
    return this;
  }

  font(size = 9, bold = false) {
    this.g.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
  }

  measure(str, size = 9, bold = false) {
    this.font(size, bold);
    return this.g.measureText(String(str)).width;
  }

  fit(str, width, size, bold) {
    let s = String(str ?? '');
    if (this.measure(s, size, bold) <= width) return s;
    while (s.length > 1 && this.measure(s + '…', size, bold) > width) s = s.slice(0, -1);
    return s + '…';
  }

  text(str, x, y, { size = 9, bold = false, color = '#111827', align = 'left', width } = {}) {
    this.font(size, bold);
    this.g.fillStyle = color;
    const s = width ? this.fit(str, width, size, bold) : String(str ?? '');
    let tx = x;
    if (align === 'right') tx = x + (width || 0) - this.g.measureText(s).width;
    else if (align === 'center') tx = x + ((width || 0) - this.g.measureText(s).width) / 2;
    this.g.fillText(s, tx, y);
  }

  line(x1, y1, x2, y2, color, w) {
    const g = this.g;
    if (color) g.strokeStyle = color;
    if (w) g.lineWidth = w;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }

  rect(x, y, w, h, fill) {
    this.g.fillStyle = fill;
    this.g.fillRect(x, y, w, h);
  }

  space(h) {
    this.y += h;
  }

  ensure(h) {
    if (this.y + h > this.H - this.m - 14) this.newPage();
  }

  para(str, { size = 9, bold = false, color = '#111827' } = {}) {
    this.ensure(size + 6);
    this.text(str, this.m, this.y + size, { size, bold, color, width: this.W - this.m * 2 });
    this.y += size + 6;
  }

  // Key/value pairs in two columns
  pairs(list, { size = 9 } = {}) {
    const colW = (this.W - this.m * 2) / 2;
    for (let i = 0; i < list.length; i += 2) {
      this.ensure(size + 7);
      [list[i], list[i + 1]].forEach((p, j) => {
        if (!p) return;
        const x = this.m + j * colW;
        this.text(p[0], x, this.y + size, { size, color: '#475569', width: colW * 0.42 });
        this.text(p[1], x + colW * 0.42, this.y + size, { size, bold: true, width: colW * 0.56 });
      });
      this.y += size + 7;
    }
  }

  // columns: [{ label, width (relative), align }]; rows: arrays of strings
  table(columns, rows, { size = 8, rowH, totals, zebra = true } = {}) {
    const avail = this.W - this.m * 2;
    const sum = columns.reduce((s, c) => s + (c.width || 1), 0);
    const cols = columns.map((c) => ({ ...c, w: ((c.width || 1) / sum) * avail }));
    const rh = rowH || size + 7;
    const pad = 3;
    const header = () => {
      this.ensure(rh * 2);
      this.rect(this.m, this.y, avail, rh + 2, '#1C2A3A');
      let x = this.m;
      cols.forEach((c) => {
        this.text(c.label, x + pad, this.y + rh - 2, { size, bold: true, color: '#fff', width: c.w - pad * 2, align: c.align || 'left' });
        x += c.w;
      });
      this.y += rh + 2;
    };
    const drawRow = (r, i, bold) => {
      if (this.y + rh > this.H - this.m - 14) {
        this.newPage();
        header();
      }
      if (bold) this.rect(this.m, this.y, avail, rh, '#E2E8F0');
      else if (zebra && i % 2) this.rect(this.m, this.y, avail, rh, '#F1F5F9');
      let x = this.m;
      cols.forEach((c, j) => {
        const v = r[j];
        const color = typeof v === 'object' && v ? v.color : undefined;
        const val = typeof v === 'object' && v ? v.text : v;
        this.text(val ?? '', x + pad, this.y + rh - 4, { size, bold, color: color || '#111827', width: c.w - pad * 2, align: c.align || 'left' });
        x += c.w;
      });
      this.y += rh;
    };
    header();
    rows.forEach((r, i) => drawRow(r, i, false));
    if (totals) drawRow(totals, 0, true);
    this.line(this.m, this.y, this.m + avail, this.y, '#94A3B8', 0.6);
    this.y += 8;
  }

  async toBytes() {
    const total = this.pages.length;
    this.pages.forEach((c, i) => {
      const g = c.getContext('2d');
      g.save();
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      g.font = `400 7px ${FONT}`;
      g.fillStyle = '#64748B';
      g.fillText(this.footer || 'KaamKhata', this.m, this.H - this.m / 2);
      const pg = `Page ${i + 1} of ${total}`;
      g.fillText(pg, this.W - this.m - g.measureText(pg).width, this.H - this.m / 2);
      g.restore();
    });
    return buildPdf(this.pages.map((c) => ({ jpeg: dataUrlBytes(c.toDataURL('image/jpeg', 0.82)), pxW: c.width, pxH: c.height })), this.W, this.H);
  }
}

function dataUrlBytes(url) {
  const bin = atob(url.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildPdf(images, W, H) {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (part) => {
    const b = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(b);
    length += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // 1: catalog, 2: pages, then per page: page, content, image
  const n = images.length;
  const pageIds = images.map((_, i) => 3 + i * 3);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => id + ' 0 R').join(' ')}] /Count ${n} >>`));
  const w = W.toFixed(2), h = H.toFixed(2);
  images.forEach((img, i) => {
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
    obj(pid, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`)
    );
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(cid, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(iid, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
      push(img.jpeg);
      push('\nendstream');
    });
  });
  const count = 3 + n * 3;
  const xref = length;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  chunks.forEach((c) => {
    out.set(c, o);
    o += c.length;
  });
  return out;
}
