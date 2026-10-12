// src/utils/markdown.ts
// صيغة Markdown المبسّطة المستخدَمة في تعليقات المهام (جدول، قائمة نقطية، عريض/مائل، تلوين نص،
// عناوين) — مُستخرَجة هنا لتكون قابلة لإعادة الاستخدام في أي مربع نص آخر يحتاج الدعم نفسه
// (راجع components/MarkdownEditor.tsx).

export const MD_COLORS: Record<string, string> = {
  red: '#ef4444', green: '#16a34a', blue: '#2563eb', orange: '#ea580c',
  purple: '#9333ea', pink: '#db2777', teal: '#0d9488', gray: '#6b7280', yellow: '#ca8a04',
};

export function renderMarkdown(raw: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string): string => {
    const e = esc(s);
    return e
      .replace(/\[c=([a-z]+|#[0-9a-fA-F]{3,6})\](.+?)\[\/c\]/g, (_m, col, txt) => {
        const hex = MD_COLORS[col] ?? (col.startsWith('#') ? col : null);
        return hex ? `<span style="color:${hex}">${txt}</span>` : txt;
      })
      .replace(/(https?:\/\/[^\s<&]+)/g, '<a href="$1" target="_blank" rel="noreferrer" style="color:var(--color-primary,#0ea5e9);word-break:break-all">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  };
  const lines = raw.split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s\-|:]+\|[\s\-|:]*$/.test(lines[i + 1])) {
      const parseCells = (l: string) => l.split('|')
        .filter((_, idx, arr) => !(idx === 0 && arr[0].trim() === '') && !(idx === arr.length - 1 && arr[arr.length - 1].trim() === ''))
        .map(c => c.trim());
      const headers = parseCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseCells(lines[i])); i++; }
      html += '<div style="overflow-x:auto;margin:6px 0"><table style="border-collapse:collapse;font-size:0.85em;min-width:100%">';
      html += '<thead><tr>';
      headers.forEach(h => { html += `<th style="border:1px solid #d1d5db;padding:4px 10px;text-align:right;background:rgba(0,0,0,0.05);font-weight:600">${inline(h)}</th>`; });
      html += '</tr></thead><tbody>';
      rows.forEach((row, ri) => {
        html += `<tr style="background:${ri % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)'}">`;
        row.forEach(cell => { html += `<td style="border:1px solid #d1d5db;padding:4px 10px;text-align:right">${inline(cell)}</td>`; });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      html += '<ul style="margin:4px 0 4px 1.4em;padding:0;list-style:disc">';
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        html += `<li style="margin:1px 0">${inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      const sz = hm[1].length === 1 ? '1.1em' : hm[1].length === 2 ? '1em' : '0.95em';
      html += `<p style="font-weight:700;font-size:${sz};margin:6px 0 2px">${inline(hm[2])}</p>`;
      i++; continue;
    }
    if (!line.trim()) { html += '<div style="height:5px"></div>'; i++; continue; }
    html += `<p style="margin:1px 0;line-height:1.55">${inline(line)}</p>`;
    i++;
  }
  return html;
}

// يحوّل جدول HTML ملصوقاً (مثل جدول من Excel) إلى صيغة Markdown المدعومة أعلاه. يُعيد null إن
// لم يحتوِ الـ HTML الملصوق على جدول فعلي.
export function htmlTableToMarkdown(html: string): string | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return null;
    const toText = (cell: Element) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
    const grid = rows
      .map(r => Array.from(r.querySelectorAll('td,th')).map(toText))
      .filter(r => r.length > 0);
    if (!grid.length) return null;
    const cols = Math.max(...grid.map(r => r.length));
    const pad = (r: string[]) => { while (r.length < cols) r.push(''); return r; };
    const fmtRow = (r: string[]) => '| ' + r.join(' | ') + ' |';
    const header = pad(grid[0]);
    const sep = header.map(() => '---');
    const body = grid.slice(1).map(r => fmtRow(pad(r)));
    return '\n' + [fmtRow(header), fmtRow(sep), ...body].join('\n') + '\n';
  } catch {
    return null;
  }
}
