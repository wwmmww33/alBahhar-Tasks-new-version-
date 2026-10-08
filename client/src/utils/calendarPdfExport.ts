type DisplayItem = {
  SubtaskID: number;
  SubtaskTitle: string;
  TaskTitle: string;
  DueDate: string;
  EndDate?: string | null;
  AssignedToName?: string;
};
type PersonalItem = {
  SubtaskID?: number;
  TaskID?: number;
  SubtaskTitle?: string;
  TaskTitle?: string;
  EventID?: number;
  Title?: string;
  DueDate?: string;
};
type CommentItem = { CommentID: number; Content: string; TaskTitle: string; CreatedAt: string; CalendarEndDate?: string | null };

export type CalendarPdfParams = {
  monthLabel: string;
  dateRange: { key: string; date: Date }[];
  displayItems: DisplayItem[];
  personalByDay: Record<string, PersonalItem[]>;
  // قائمة التعليقات المسطّحة (غير مُقسَّمة على الأيام) — يبني هذا الملف تقسيمها وامتدادها
  // (CalendarEndDate) داخلياً بنفس أسلوب displayItems/EndDate الخاص بالمهام الفرعية.
  comments: CommentItem[];
  viewMode?: 'month' | 'week' | 'day' | 'year';
  viewLayout?: 'grid' | 'list';
  filteredListRange?: { key: string; date: Date; label: string }[];
  deptName?: string | null;
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
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ar-EG-u-nu-latn', { year:'numeric', month:'long', day:'numeric' });
}
function fmtTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return '';
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} `;
}

type SpanEntry = { item: DisplayItem; isStart: boolean };
type CommentSpanEntry = { item: CommentItem; isStart: boolean };

// يدمج المهام الفرعية (بداية امتداد + مفردة) والمهام الشخصية والتعليقات (بداية امتداد + مفردة)
// في قائمة واحدة مرتبة زمنياً من الأقدم للأحدث، بدل عرضها في أقسام منفصلة غير مرتبة ببعضها.
function buildMergedDayHTML(
  startSpans: SpanEntry[],
  singles: DisplayItem[],
  personal: PersonalItem[],
  commentStartSpans: CommentSpanEntry[],
  commentSingles: CommentItem[],
  startClass: string,
  otherClass: string,
): string {
  const entries: { time: number; html: string }[] = [];

  for (const { item } of startSpans) {
    const c = spanColor(item.SubtaskID);
    const p = item.AssignedToName ? ` (${esc(item.AssignedToName)})` : '';
    entries.push({
      time: new Date(item.DueDate).getTime(),
      html: `<div class="${startClass}" style="color:${c};">${fmtTime(item.DueDate)}${item.SubtaskID}◀ ${esc(item.SubtaskTitle)}${p} (ضمن: ${esc(item.TaskTitle)})</div>`,
    });
  }
  for (const it of singles) {
    const c = spanColor(it.SubtaskID);
    const p = it.AssignedToName ? ` (${esc(it.AssignedToName)})` : '';
    entries.push({
      time: new Date(it.DueDate).getTime(),
      html: `<div class="${otherClass}" style="color:${c};">${fmtTime(it.DueDate)}${it.SubtaskID}◀ ${esc(it.SubtaskTitle)}${p} (ضمن: ${esc(it.TaskTitle)})</div>`,
    });
  }
  for (const ev of personal) {
    const id = ev.SubtaskID ?? ev.TaskID ?? ev.EventID ?? '';
    const lbl = ev.SubtaskTitle ?? ev.TaskTitle ?? ev.Title ?? '';
    entries.push({
      time: ev.DueDate ? new Date(ev.DueDate).getTime() : 0,
      html: `<div class="${otherClass}" style="color:#059669;">${fmtTime(ev.DueDate)}${id}★ ${esc(String(lbl))}</div>`,
    });
  }
  for (const { item } of commentStartSpans) {
    const c = spanColor(item.CommentID);
    entries.push({
      time: new Date(item.CreatedAt).getTime(),
      html: `<div class="${startClass}" style="color:${c};">${fmtTime(item.CreatedAt)}${item.CommentID}◀ ${esc(item.Content)} (ضمن: ${esc(item.TaskTitle)})</div>`,
    });
  }
  for (const cm of commentSingles) {
    entries.push({
      time: new Date(cm.CreatedAt).getTime(),
      html: `<div class="${otherClass}" style="color:#7c3aed;">${fmtTime(cm.CreatedAt)}${cm.CommentID}💬 ${esc(cm.Content)} (ضمن: ${esc(cm.TaskTitle)})</div>`,
    });
  }

  return entries.sort((a, b) => a.time - b.time).map(e => e.html).join('');
}

// ─── indexing helpers ────────────────────────────────────────────────────────

function buildSingleByDay(displayItems: DisplayItem[]) {
  const map: Record<string, DisplayItem[]> = {};
  for (const it of displayItems.filter(it => !it.EndDate)) {
    const key = toYMD(norm(new Date(it.DueDate)));
    (map[key] = map[key] || []).push(it);
  }
  return map;
}

function buildSpanByDay(displayItems: DisplayItem[], dateRange: { key: string; date: Date }[]) {
  const map: Record<string, SpanEntry[]> = {};
  if (!dateRange.length) return map;
  const rangeStart = norm(dateRange[0].date);
  const rangeEnd   = norm(dateRange[dateRange.length - 1].date);
  for (const it of displayItems.filter(it => !!it.EndDate)) {
    const dueD = norm(new Date(it.DueDate));
    const endD = norm(new Date(it.EndDate!));
    const cur  = new Date(Math.max(dueD.getTime(), rangeStart.getTime()));
    const stop = new Date(Math.min(endD.getTime(), rangeEnd.getTime()));
    while (cur <= stop) {
      const key = toYMD(cur);
      (map[key] = map[key] || []).push({ item: it, isStart: cur.getTime() === dueD.getTime() });
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

// نفس buildSingleByDay/buildSpanByDay أعلاه لكن للتعليقات — تعليق له CalendarEndDate (ينتهي في
// يوم مختلف عن CreatedAt) يُعامَل كامتداد تماماً كالمهمة الفرعية ذات EndDate.
function buildCommentSingleByDay(comments: CommentItem[]) {
  const map: Record<string, CommentItem[]> = {};
  for (const c of comments) {
    const start = norm(new Date(c.CreatedAt));
    const end = c.CalendarEndDate ? norm(new Date(c.CalendarEndDate)) : null;
    if (end && end.getTime() !== start.getTime()) continue; // ممتد فعلياً — يُعالَج في buildCommentSpanByDay
    const key = toYMD(start);
    (map[key] = map[key] || []).push(c);
  }
  return map;
}

function buildCommentSpanByDay(comments: CommentItem[], dateRange: { key: string; date: Date }[]) {
  const map: Record<string, CommentSpanEntry[]> = {};
  if (!dateRange.length) return map;
  const rangeStart = norm(dateRange[0].date);
  const rangeEnd   = norm(dateRange[dateRange.length - 1].date);
  for (const c of comments) {
    if (!c.CalendarEndDate) continue;
    const dueD = norm(new Date(c.CreatedAt));
    const endD = norm(new Date(c.CalendarEndDate));
    if (endD.getTime() === dueD.getTime()) continue;
    const cur  = new Date(Math.max(dueD.getTime(), rangeStart.getTime()));
    const stop = new Date(Math.min(endD.getTime(), rangeEnd.getTime()));
    while (cur <= stop) {
      const key = toYMD(cur);
      (map[key] = map[key] || []).push({ item: c, isStart: cur.getTime() === dueD.getTime() });
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

// شريط رأسي موحَّد (مهام فرعية + تعليقات معاً في مسار ممرّات واحد مشترك) لعرض القائمة.
type VBar = { kind: 'subtask' | 'comment'; id: number; title: string; startKey: string; endKey: string; lane: number };
function buildVerticalBars(displayItems: DisplayItem[], comments: CommentItem[], days: { key: string }[]): VBar[] {
  if (!days.length) return [];
  const rangeStartKey = days[0].key;
  const rangeEndKey   = days[days.length - 1].key;
  const bars: VBar[] = [];

  type Cand = { kind: 'subtask' | 'comment'; id: number; title: string; due: string; end: string };
  const candidates: Cand[] = [
    ...displayItems.filter(it => !!it.EndDate).map(it => ({ kind: 'subtask' as const, id: it.SubtaskID, title: it.SubtaskTitle, due: it.DueDate, end: it.EndDate! })),
    ...comments.filter(c => !!c.CalendarEndDate).map(c => ({ kind: 'comment' as const, id: c.CommentID, title: c.Content, due: c.CreatedAt, end: c.CalendarEndDate! })),
  ];

  for (const cand of candidates) {
    const dueD = norm(new Date(cand.due));
    const endD = norm(new Date(cand.end));
    if (endD.getTime() === dueD.getTime()) continue;
    const dueKey = toYMD(dueD);
    const endKey = toYMD(endD);
    if (dueKey > rangeEndKey || endKey < rangeStartKey) continue;
    const startKey = dueKey < rangeStartKey ? rangeStartKey : dueKey;
    const endKeyC  = endKey > rangeEndKey   ? rangeEndKey   : endKey;
    let lane = 0;
    while (bars.some(b => b.lane === lane && !(b.endKey < startKey || b.startKey > endKeyC))) lane++;
    bars.push({ kind: cand.kind, id: cand.id, title: cand.title, startKey, endKey: endKeyC, lane });
  }
  return bars;
}

function buildPriorSpans(displayItems: DisplayItem[], rangeStart: Date) {
  return displayItems.filter(it => {
    if (!it.EndDate) return false;
    return norm(new Date(it.DueDate)) < rangeStart && norm(new Date(it.EndDate)) >= rangeStart;
  });
}

function buildCommentPriorSpans(comments: CommentItem[], rangeStart: Date) {
  return comments.filter(c => {
    if (!c.CalendarEndDate) return false;
    return norm(new Date(c.CreatedAt)) < rangeStart && norm(new Date(c.CalendarEndDate)) >= rangeStart;
  });
}

// ─── grid month renderer ──────────────────────────────────────────────────────

function renderMonthGrid(
  days: { key: string; date: Date }[],
  singleByDay: Record<string, DisplayItem[]>,
  spanByDay: Record<string, SpanEntry[]>,
  personalByDay: Record<string, PersonalItem[]>,
  commentSingleByDay: Record<string, CommentItem[]>,
  commentSpanByDay: Record<string, CommentSpanEntry[]>,
  today: string,
): string {
  if (!days.length) return '';
  const startOffset = days[0].date.getDay();
  const cells: ({ key: string; date: Date } | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (const d of days) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const DAYS_AR = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const header = DAYS_AR.map((d, i) =>
    `<div class="hdr-cell${i===5||i===6?' wk':''}">${d}</div>`
  ).join('');

  const weeksHTML = weeks.map(week => {
    const dayCells = week.map((cell, ci) => {
      const wk = ci === 5 || ci === 6;
      if (!cell) return `<div class="day-cell${wk?' wk':''}"></div>`;
      const { key, date } = cell;
      const isToday    = key === today;
      const spans      = spanByDay[key] || [];
      const singles    = singleByDay[key] || [];
      const personal   = personalByDay[key] || [];
      const commentSpans   = commentSpanByDay[key] || [];
      const commentSingles = commentSingleByDay[key] || [];
      const contSpans  = spans.filter(s=>!s.isStart).sort((a,b)=>new Date(a.item.DueDate).getTime()-new Date(b.item.DueDate).getTime());
      const startSpans = spans.filter(s=>s.isStart).sort((a,b)=>new Date(a.item.DueDate).getTime()-new Date(b.item.DueDate).getTime());
      const sorted     = [...singles].sort((a,b)=>new Date(a.DueDate).getTime()-new Date(b.DueDate).getTime());
      const commentContSpans  = commentSpans.filter(s=>!s.isStart).sort((a,b)=>new Date(a.item.CreatedAt).getTime()-new Date(b.item.CreatedAt).getTime());
      const commentStartSpans = commentSpans.filter(s=>s.isStart).sort((a,b)=>new Date(a.item.CreatedAt).getTime()-new Date(b.item.CreatedAt).getTime());

      const contBadges = [
        ...contSpans.map(({item})=>`<span style="color:${spanColor(item.SubtaskID)};">${item.SubtaskID}</span>`),
        ...commentContSpans.map(({item})=>`<span style="color:${spanColor(item.CommentID)};">${item.CommentID}</span>`),
      ];
      const contHTML = contBadges.length ? `<div class="span-cont">${contBadges.join('<span class="sep">|</span>')}</div>` : '';
      // نُدمج بداية الامتدادات والمهام المفردة والشخصية والتعليقات في قائمة واحدة مرتبة زمنياً من الأقدم للأحدث
      const mergedHTML = buildMergedDayHTML(startSpans, sorted, personal, commentStartSpans, commentSingles, 'span-start', 'item-row');

      let cls = 'day-cell'; if (wk) cls+=' wk'; if (isToday) cls+=' today';
      return `<div class="${cls}">
        <div class="day-num${isToday?' today-num':''}">${date.getDate()}</div>
        ${contHTML}${mergedHTML}
      </div>`;
    }).join('');
    return `<div class="week-row">${dayCells}</div>`;
  }).join('');

  return `<div class="cal"><div class="cal-header">${header}</div>${weeksHTML}</div>`;
}

// ─── list renderer with vertical span bars ───────────────────────────────────

function renderListHTML(
  listDays: { key: string; date: Date; label: string }[],
  displayItems: DisplayItem[],
  comments: CommentItem[],
  singleByDay: Record<string, DisplayItem[]>,
  spanByDay: Record<string, SpanEntry[]>,
  personalByDay: Record<string, PersonalItem[]>,
  commentSingleByDay: Record<string, CommentItem[]>,
  commentSpanByDay: Record<string, CommentSpanEntry[]>,
  today: string,
): string {
  if (!listDays.length) return '<div class="no-events">لا توجد أحداث للعرض.</div>';

  const vBars  = buildVerticalBars(displayItems, comments, listDays);
  const maxLane = vBars.length > 0 ? Math.max(...vBars.map(b => b.lane)) : -1;
  // width of bars column: 9px per lane + 3px gap between lanes
  const barsColW = maxLane >= 0 ? (maxLane + 1) * 9 + maxLane * 3 + 4 : 0;

  let html = '';
  let lastMonth = '';

  for (const d of listDays) {
    const spans    = spanByDay[d.key] || [];
    const singles  = singleByDay[d.key] || [];
    const personal = personalByDay[d.key] || [];
    const commentSpans   = commentSpanByDay[d.key] || [];
    const commentSingles = commentSingleByDay[d.key] || [];

    const contSpans  = spans.filter(s=>!s.isStart).sort((a,b)=>new Date(a.item.DueDate).getTime()-new Date(b.item.DueDate).getTime());
    const startSpans = spans.filter(s=>s.isStart).sort((a,b)=>new Date(a.item.DueDate).getTime()-new Date(b.item.DueDate).getTime());
    const sorted     = [...singles].sort((a,b)=>new Date(a.DueDate).getTime()-new Date(b.DueDate).getTime());
    const commentContSpans  = commentSpans.filter(s=>!s.isStart).sort((a,b)=>new Date(a.item.CreatedAt).getTime()-new Date(b.item.CreatedAt).getTime());
    const commentStartSpans = commentSpans.filter(s=>s.isStart).sort((a,b)=>new Date(a.item.CreatedAt).getTime()-new Date(b.item.CreatedAt).getTime());

    // month separator
    const monthKey = d.date.toLocaleDateString('ar-EG-u-nu-latn', { month:'long', year:'numeric' });
    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      html += `<div class="month-sep" style="grid-column: 1 / -1;">${monthKey}</div>`;
    }

    const isToday = d.key === today;

    // vertical bar cell
    let barCellHTML = '';
    if (maxLane >= 0) {
      const dayBars = vBars.filter(b => b.startKey <= d.key && b.endKey >= d.key);
      const laneHTML = Array.from({ length: maxLane + 1 }, (_, lane) => {
        const bar = dayBars.find(b => b.lane === lane);
        if (!bar) return `<div style="width:9px;flex-shrink:0;"></div>`;
        const c       = spanColor(bar.id);
        const isStart = bar.startKey === d.key;
        const isEnd   = bar.endKey   === d.key;
        const radius  = isStart && isEnd ? '4px' : isStart ? '4px 4px 0 0' : isEnd ? '0 0 4px 4px' : '0';
        const topSp   = isStart ? `<div style="height:5px;flex-shrink:0;"></div>` : '';
        const botSp   = isEnd   ? `<div style="height:5px;flex-shrink:0;"></div>` : '';
        return `<div style="width:9px;flex-shrink:0;display:flex;flex-direction:column;">
          ${topSp}
          <div title="${esc(bar.title)}" style="flex:1;background:${c};border-radius:${radius};min-height:4px;"></div>
          ${botSp}
        </div>`;
      }).join('');
      barCellHTML = `<div class="vbars-cell">${laneHTML}</div>`;
    }

    // events content — نُدمج جميع الأنواع في قائمة واحدة مرتبة زمنياً من الأقدم للأحدث
    const contBadges = [
      ...contSpans.map(({item})=>`<span style="color:${spanColor(item.SubtaskID)};">${item.SubtaskID}</span>`),
      ...commentContSpans.map(({item})=>`<span style="color:${spanColor(item.CommentID)};">${item.CommentID}</span>`),
    ];
    const contHTML   = contBadges.length ? `<div class="list-cont">${contBadges.join('<span class="sep">|</span>')}</div>` : '';
    const mergedHTML = buildMergedDayHTML(startSpans, sorted, personal, commentStartSpans, commentSingles, 'list-item', 'list-item');
    const eventsHTML = contHTML + mergedHTML;
    const hasEvents  = !!eventsHTML;

    html += `${barCellHTML}<div class="day-content${isToday?' day-content-today':''}${!hasEvents?' day-content-empty':''}">
      <div class="day-label${isToday?' day-label-today':''}">${esc(d.label)}</div>
      <div class="day-events">${eventsHTML || '<span class="no-ev">لا توجد أحداث</span>'}</div>
    </div>`;
  }

  const gridCols = maxLane >= 0
    ? `${barsColW}px 1fr`
    : '1fr';

  return `<div class="list-grid" style="grid-template-columns:${gridCols};">${html}</div>`;
}

// ─── main export ─────────────────────────────────────────────────────────────

export function exportCalendarToPdf(p: CalendarPdfParams): void {
  const {
    monthLabel, dateRange, displayItems, personalByDay, comments,
    viewMode = 'month', viewLayout = 'grid',
    filteredListRange, deptName,
  } = p;
  if (!dateRange.length) return;

  const today       = toYMD(new Date());
  const printed     = new Date().toLocaleString('ar-EG-u-nu-latn');
  const singleByDay = buildSingleByDay(displayItems);
  const spanByDay   = buildSpanByDay(displayItems, dateRange);
  const commentSingleByDay = buildCommentSingleByDay(comments);
  const commentSpanByDay   = buildCommentSpanByDay(comments, dateRange);
  const rangeStart  = norm(dateRange[0].date);
  const priorSpans  = buildPriorSpans(displayItems, rangeStart);
  const priorCommentSpans = buildCommentPriorSpans(comments, rangeStart);

  const modeLabel   = viewMode === 'year' ? 'سنوي' : viewMode === 'month' ? 'شهري' : viewMode === 'week' ? 'أسبوعي' : 'يومي';
  const layoutLabel = viewLayout === 'grid' ? 'شبكة مربعات' : 'قائمة';

  type PriorRow = { id: number; date: string; label: string };
  const priorRows: PriorRow[] = [
    ...priorSpans.map(it => ({ id: it.SubtaskID, date: it.DueDate, label: `${esc(it.SubtaskTitle)}${it.AssignedToName ? ` (${esc(it.AssignedToName)})` : ''}` })),
    ...priorCommentSpans.map(c => ({ id: c.CommentID, date: c.CreatedAt, label: esc(c.Content) })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const priorSectionHTML = priorRows.length ? `
    <div class="prior-section">
      <div class="prior-title">أحداث بدأت قبل هذه الفترة وتمتد خلالها</div>
      ${priorRows.map(row => {
        const c = spanColor(row.id);
        return `<div class="prior-row">
          <span class="prior-id" style="color:${c};">#${row.id}</span>
          <span class="prior-date">${fmtDate(row.date)}</span>
          <span class="prior-name">${row.label}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  // ── content ───────────────────────────────────────────────────────────────────
  let contentHTML = '';

  if (viewLayout === 'list') {
    const listDays = (filteredListRange ?? dateRange.map(d => ({
      key: d.key, date: d.date,
      label: d.date.toLocaleDateString('ar-EG-u-nu-latn', { weekday:'long', day:'numeric', month:'long' }),
    })));
    contentHTML = renderListHTML(listDays, displayItems, comments, singleByDay, spanByDay, personalByDay, commentSingleByDay, commentSpanByDay, today);

  } else if (viewMode === 'year') {
    const year = dateRange[0].date.getFullYear();
    for (let m = 0; m < 12; m++) {
      const monthDays = dateRange.filter(d => d.date.getMonth() === m);
      if (!monthDays.length) continue;
      const monthSpanByDay = buildSpanByDay(displayItems, monthDays);
      const monthCommentSpanByDay = buildCommentSpanByDay(comments, monthDays);
      const monthName = new Date(year, m, 1).toLocaleDateString('ar-EG-u-nu-latn', { month: 'long' });
      contentHTML += `<div class="month-section">
        <div class="month-header">${monthName}</div>
        ${renderMonthGrid(monthDays, singleByDay, monthSpanByDay, personalByDay, commentSingleByDay, monthCommentSpanByDay, today)}
      </div>`;
    }

  } else {
    contentHTML = renderMonthGrid(dateRange, singleByDay, spanByDay, personalByDay, commentSingleByDay, commentSpanByDay, today);
  }

  // ── page ──────────────────────────────────────────────────────────────────────
  const isLandscape = viewLayout === 'grid' && viewMode !== 'year';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>تقويم — ${esc(monthLabel)}${deptName ? ` — ${esc(deptName)}` : ''}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0;
    -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; direction:rtl;
       color:#111; background:#fff; padding:10px; }
h1  { font-size:15px; font-weight:700; margin-bottom:2px; color:#0f172a; }
.sub{ font-size:9px; color:#64748b; margin-bottom:8px; }

/* grid */
.cal         { border:1px solid #d1d5db; border-radius:6px; overflow:hidden; margin-bottom:4px; }
.cal-header  { display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr 0.55fr 0.55fr; border-bottom:2px solid #d1d5db; }
.hdr-cell    { padding:5px 3px; text-align:center; font-size:10px; font-weight:700; color:#374151; background:#f8fafc; border-right:1px solid #e5e7eb; }
.hdr-cell:last-child { border-right:none; }
.hdr-cell.wk{ color:#9ca3af; background:#f3f4f6; }
.week-row    { display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr 0.55fr 0.55fr; border-bottom:1px solid #e5e7eb; }
.week-row:last-child { border-bottom:none; }
.day-cell    { min-height:68px; padding:4px 3px; border-right:1px solid #e5e7eb; background:#fff; overflow:hidden; }
.day-cell:last-child { border-right:none; }
.day-cell.wk   { background:#f3f4f6; }
.day-cell.today{ background:#eff6ff; }
.day-num     { font-size:11px; font-weight:700; color:#374151; margin-bottom:3px; }
.today-num   { display:inline-block; background:#2563eb; color:#fff; border-radius:50%; width:18px; height:18px; line-height:18px; text-align:center; font-size:10px; }
.span-start  { display:block; margin-bottom:2px; font-size:9px; font-weight:700; word-break:break-word; }
.span-cont   { font-size:9px; font-weight:700; margin-bottom:2px; word-break:break-all; line-height:1.4; }
.sep         { color:#9ca3af; margin:0 1px; }
.item-row    { font-size:8px; font-weight:600; word-break:break-word; margin-bottom:1px; }

/* year grid month sections */
.month-section { margin-bottom:18px; page-break-inside:avoid; }
.month-header  { font-size:13px; font-weight:700; color:#1e40af; padding:4px 6px; background:#eff6ff; border-radius:4px 4px 0 0; border:1px solid #bfdbfe; border-bottom:none; }
.month-section .cal { border-radius:0 0 6px 6px; }

/* list */
.list-grid   { display:grid; row-gap:0; }
.vbars-cell  { align-self:stretch; display:flex; gap:3px; padding-left:4px; }
.day-content { padding:5px 4px; border-bottom:1px solid #e5e7eb; }
.day-content:last-of-type { border-bottom:none; }
.day-content-today { background:#eff6ff; }
.day-content-empty { opacity:.55; }
.day-label   { font-size:10px; font-weight:700; color:#374151; margin-bottom:3px; }
.day-label-today { color:#2563eb; }
.day-events  { font-size:9px; }
.list-cont   { font-weight:700; margin-bottom:2px; word-break:break-all; }
.list-item   { font-weight:600; word-break:break-word; margin-bottom:2px; }
.no-ev       { color:#94a3b8; font-style:italic; }
.month-sep   { font-size:12px; font-weight:700; color:#1e40af; background:#eff6ff; padding:5px 8px; margin:10px 0 4px; border-radius:4px; border-right:4px solid #3b82f6; }

/* prior */
.prior-section { border:1px solid #e5e7eb; border-radius:6px; padding:8px 10px; margin-bottom:10px; background:#fafafa; }
.prior-title   { font-size:10px; font-weight:700; color:#6b7280; margin-bottom:6px; border-bottom:1px solid #e5e7eb; padding-bottom:4px; }
.prior-row     { display:flex; align-items:baseline; gap:8px; font-size:10px; padding:2px 0; border-bottom:1px dashed #f0f0f0; }
.prior-row:last-child { border-bottom:none; }
.prior-id   { font-weight:700; flex-shrink:0; font-size:11px; }
.prior-date { color:#6b7280; flex-shrink:0; font-size:9px; }
.prior-name { font-weight:600; color:#374151; }
.no-events  { text-align:center; color:#94a3b8; padding:30px; font-size:12px; }

.footer { margin-top:10px; font-size:10px; color:#94a3b8; text-align:center; border-top:1px solid #e5e7eb; padding-top:7px; }

@media print {
  body { padding:6px; }
  @page { margin:.8cm; size:A4 ${isLandscape ? 'landscape' : 'portrait'}; }
  .month-section { page-break-inside:avoid; }
}
</style>
</head>
<body>
<h1>📅 تقويم — ${esc(monthLabel)}${deptName ? ` — ${esc(deptName)}` : ''}</h1>
<div class="sub">${modeLabel} · ${layoutLabel}${deptName ? ` · ${esc(deptName)}` : ''} · طُبع: ${printed}</div>
${priorSectionHTML}
${contentHTML}
<div class="footer">نظام إدارة المهام &nbsp;•&nbsp; ${printed}</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}
