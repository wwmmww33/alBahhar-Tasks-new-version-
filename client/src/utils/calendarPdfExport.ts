type DisplayItem = {
  SubtaskID: number;
  SubtaskTitle: string;
  TaskTitle: string;
  DueDate: string;
  EndDate?: string | null;
  AssignedToName?: string;
};

type PersonalItem = { EventID: number; Title: string };
type CommentItem  = { CommentID: number; Content: string; TaskTitle: string };

export type CalendarPdfParams = {
  monthLabel: string;
  dateRange: { key: string; date: Date }[];
  displayItems: DisplayItem[];
  personalByDay: Record<string, PersonalItem[]>;
  commentsByDay: Record<string, CommentItem[]>;
};

const SPAN_COLORS = [
  '#3b82f6','#22c55e','#a855f7','#f97316',
  '#ec4899','#14b8a6','#ef4444','#eab308',
];
const spanColor = (id: number) => SPAN_COLORS[id % SPAN_COLORS.length];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function norm(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export function exportCalendarToPdf(p: CalendarPdfParams): void {
  const { monthLabel, dateRange, displayItems, personalByDay, commentsByDay } = p;
  if (!dateRange.length) return;

  // pre-index single-day items
  const singleByDay: Record<string, DisplayItem[]> = {};
  for (const it of displayItems.filter(it => !it.EndDate)) {
    const key = toYMD(norm(new Date(it.DueDate)));
    (singleByDay[key] = singleByDay[key] || []).push(it);
  }

  // index spanning items by every day they cover (within dateRange)
  type SpanEntry = { item: DisplayItem; isStart: boolean };
  const spanByDay: Record<string, SpanEntry[]> = {};
  for (const it of displayItems.filter(it => !!it.EndDate)) {
    const dueD = norm(new Date(it.DueDate));
    const endD = norm(new Date(it.EndDate!));
    const rangeStart = norm(dateRange[0].date);
    const rangeEnd   = norm(dateRange[dateRange.length - 1].date);
    const cur = new Date(Math.max(dueD.getTime(), rangeStart.getTime()));
    const stop = new Date(Math.min(endD.getTime(), rangeEnd.getTime()));
    while (cur <= stop) {
      const key = toYMD(cur);
      (spanByDay[key] = spanByDay[key] || []).push({
        item: it,
        isStart: cur.getTime() === dueD.getTime(),
      });
      cur.setDate(cur.getDate() + 1);
    }
  }

  // tasks that started BEFORE this month but overlap with it
  const rangeStart = norm(dateRange[0].date);
  const priorSpans = displayItems.filter(it => {
    if (!it.EndDate) return false;
    const dueD = norm(new Date(it.DueDate));
    const endD = norm(new Date(it.EndDate));
    return dueD < rangeStart && endD >= rangeStart;
  });

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' });
  }

  const priorSectionHTML = priorSpans.length ? `
    <div class="prior-section">
      <div class="prior-title">مهام بدأت قبل هذا الشهر وتمتد خلاله</div>
      ${priorSpans.map(it => {
        const c = spanColor(it.SubtaskID);
        const person = it.AssignedToName ? ` (${esc(it.AssignedToName)})` : '';
        return `<div class="prior-row">
          <span class="prior-id" style="color:${c};">#${it.SubtaskID}</span>
          <span class="prior-date">${fmtDate(it.DueDate)}</span>
          <span class="prior-name">${esc(it.SubtaskTitle)}${person}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const today = toYMD(new Date());
  const DAYS_AR = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

  // build padded cells
  const startOffset = dateRange[0].date.getDay();
  const cells: ({ key: string; date: Date } | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (const d of dateRange) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const DAYS_AR_HEADER = DAYS_AR.map((d, i) => {
    const wk = i === 5 || i === 6;
    return `<div class="hdr-cell${wk ? ' wk' : ''}">${d}</div>`;
  }).join('');

  const weeksHTML = weeks.map(week => {
    const dayCellsHTML = week.map((cell, ci) => {
      const wk = ci === 5 || ci === 6;
      if (!cell) return `<div class="day-cell${wk ? ' wk' : ''}"></div>`;

      const { key, date } = cell;
      const isToday  = key === today;
      const spans    = spanByDay[key] || [];
      const singles  = singleByDay[key] || [];
      const personal = personalByDay[key] || [];
      const comments = commentsByDay[key] || [];

      const dayNumHTML = `<div class="day-num${isToday ? ' today-num' : ''}">${date.getDate()}</div>`;

      const byDue = (a: SpanEntry, b: SpanEntry) =>
        new Date(a.item.DueDate).getTime() - new Date(b.item.DueDate).getTime();

      // continuation spans → one line, sorted oldest first
      const contSpans  = spans.filter(s => !s.isStart).sort(byDue);
      // start spans → full title, sorted oldest first
      const startSpans = spans.filter(s => s.isStart).sort(byDue);
      // single-day items sorted oldest first
      const sortedSingles = [...singles].sort(
        (a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime()
      );

      const contHTML = contSpans.length ? `<div class="span-cont">${
        contSpans.map(({ item }) =>
          `<span style="color:${spanColor(item.SubtaskID)};">${item.SubtaskID}</span>`
        ).join('<span class="sep">|</span>')
      }</div>` : '';

      const startHTML = startSpans.map(({ item }) => {
        const c      = spanColor(item.SubtaskID);
        const person = item.AssignedToName ? ` (${esc(item.AssignedToName)})` : '';
        const task   = ` (ضمن: ${esc(item.TaskTitle)})`;
        return `<div class="span-start" style="color:${c};">${item.SubtaskID}◀ ${esc(item.SubtaskTitle)}${person}${task}</div>`;
      }).join('');

      const spansHTML = contHTML + startHTML;

      const singlesHTML = sortedSingles.map(it => {
        const c = spanColor(it.SubtaskID);
        const person = it.AssignedToName ? ` (${esc(it.AssignedToName)})` : '';
        const task   = ` (ضمن: ${esc(it.TaskTitle)})`;
        return `<div class="item-row" style="color:${c};">${it.SubtaskID}◀ ${esc(it.SubtaskTitle)}${person}${task}</div>`;
      }).join('');

      const personalHTML = personal.map(ev =>
        `<div class="item-row" style="color:#059669;">${ev.EventID}★ ${esc(ev.Title)}</div>`
      ).join('');

      const commentsHTML = comments.map(cm =>
        `<div class="item-row" style="color:#7c3aed;">${cm.CommentID}💬 ${esc(cm.Content)}</div>`
      ).join('');

      let cls = 'day-cell';
      if (wk) cls += ' wk';
      if (isToday) cls += ' today';

      return `<div class="${cls}">
        ${dayNumHTML}
        ${spansHTML}${singlesHTML}${personalHTML}${commentsHTML}
      </div>`;
    }).join('');

    return `<div class="week-row">${dayCellsHTML}</div>`;
  }).join('');

  const printed = new Date().toLocaleString('ar-EG');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>تقويم — ${monthLabel}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0;
    -webkit-print-color-adjust:exact !important;
    print-color-adjust:exact !important; }
body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; direction:rtl;
       color:#111; background:#fff; padding:10px; }
h1  { font-size:15px; font-weight:700; margin-bottom:2px; color:#0f172a; }
.sub{ font-size:9px; color:#64748b; margin-bottom:8px; }

/* calendar grid */
.cal         { border:1px solid #d1d5db; border-radius:6px; overflow:hidden; }
.cal-header  { display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr 0.55fr 0.55fr;
               border-bottom:2px solid #d1d5db; }
.hdr-cell    { padding:5px 3px; text-align:center; font-size:10px; font-weight:700;
               color:#374151; background:#f8fafc;
               border-right:1px solid #e5e7eb; }
.hdr-cell:last-child { border-right:none; }
.hdr-cell.wk{ color:#9ca3af; background:#f3f4f6; }

.week-row    { display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr 0.55fr 0.55fr;
               border-bottom:1px solid #e5e7eb; }
.week-row:last-child { border-bottom:none; }

.day-cell    { min-height:68px; padding:4px 3px; border-right:1px solid #e5e7eb;
               background:#fff; overflow:hidden; }
.day-cell:last-child { border-right:none; }
.day-cell.wk   { background:#f3f4f6; }
.day-cell.today{ background:#eff6ff; }

/* day number */
.day-num     { font-size:11px; font-weight:700; color:#374151; margin-bottom:3px; }
.today-num   { display:inline-block; background:#2563eb; color:#fff;
               border-radius:50%; width:18px; height:18px;
               line-height:18px; text-align:center; font-size:10px; }

/* spanning item — start day */
.span-start  { display:block; margin-bottom:2px; font-size:9px;
               font-weight:700; word-break:break-word; }

/* spanning item — continuation days (all IDs on one line) */
.span-cont   { font-size:9px; font-weight:700; margin-bottom:2px;
               word-break:break-all; line-height:1.4; }
.sep         { color:#9ca3af; margin:0 1px; }

/* prior-month spanning tasks section */
.prior-section { border:1px solid #e5e7eb; border-radius:6px; padding:8px 10px;
                 margin-bottom:10px; background:#fafafa; }
.prior-title   { font-size:10px; font-weight:700; color:#6b7280;
                 margin-bottom:6px; border-bottom:1px solid #e5e7eb; padding-bottom:4px; }
.prior-row     { display:flex; align-items:baseline; gap:8px;
                 font-size:10px; padding:2px 0; border-bottom:1px dashed #f0f0f0; }
.prior-row:last-child { border-bottom:none; }
.prior-id      { font-weight:700; flex-shrink:0; font-size:11px; }
.prior-date    { color:#6b7280; flex-shrink:0; font-size:9px; }
.prior-name    { font-weight:600; color:#374151; }

/* single / personal / comment */
.item-row    { font-size:8px; font-weight:600; word-break:break-word; margin-bottom:1px; }
.item-more   { font-size:8px; color:#94a3b8; margin-top:1px; }

/* legend */
.legend      { display:flex; gap:14px; flex-wrap:wrap; margin-top:10px;
               font-size:10px; color:#475569; align-items:center; }
.legend-item { display:flex; align-items:center; gap:4px; }
.swatch      { display:inline-block; border:1px solid #e5e7eb; border-radius:2px; }

.footer      { margin-top:10px; font-size:10px; color:#94a3b8;
               text-align:center; border-top:1px solid #e5e7eb; padding-top:7px; }

@media print {
  body { padding:6px; }
  @page { margin:.8cm; size:A4 landscape; }
}
</style>
</head>
<body>
<h1>📅 تقويم ${esc(monthLabel)}</h1>
<div class="sub">طُبع: ${printed}</div>
${priorSectionHTML}
<div class="cal">
  <div class="cal-header">${DAYS_AR_HEADER}</div>
  ${weeksHTML}
</div>
<div class="footer">نظام إدارة المهام &nbsp;•&nbsp; ${printed}</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}
