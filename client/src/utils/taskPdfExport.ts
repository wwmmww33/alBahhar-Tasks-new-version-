export interface PdfSubtask {
  SubtaskID: number;
  Title: string;
  IsCompleted: boolean;
  AssignedToName?: string | null;
  EndDate?: string | null;
  CreatedAt?: string;
}

export interface PdfComment {
  CommentID?: number;
  Content: string;
  UserName?: string | null;
  UserID?: string;
  CreatedAt: string;
}

export interface TaskForPdf {
  TaskID: number;
  Title: string;
  Description?: string;
  Status: string;
  Priority: string;
  CreatedByName?: string | null;
  CreatedBy?: string;
  AssignedToName?: string | null;
  DueDate?: string | null;
  CategoryName?: string | null;
  URL?: string | null;
  subtasks?: PdfSubtask[];
  comments?: PdfComment[];
}

const STATUS_LABEL: Record<string, string> = {
  'open': 'مفتوحة',
  'in-progress': 'قيد التنفيذ',
  'completed': 'مكتملة',
  'cancelled': 'ملغاة',
};

const PRIORITY_LABEL: Record<string, string> = {
  'normal': 'عادية',
  'urgent': 'عاجلة',
  'starred': 'مميزة',
};

const STATUS_COLOR: Record<string, string> = {
  'open':        '#6b7280',
  'in-progress': '#d97706',
  'completed':   '#059669',
  'cancelled':   '#dc2626',
};

const PRIORITY_COLOR: Record<string, string> = {
  'urgent':  '#dc2626',
  'starred': '#d97706',
  'normal':  '#2563eb',
};

function fmt(d?: string | null, withTime = false): string {
  if (!d) return 'غير محدد';
  const date = new Date(d);
  if (withTime) {
    return date.toLocaleString('ar-EG-u-nu-latn', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return date.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type TimelineItem =
  | { kind: 'subtask'; date: number; data: PdfSubtask }
  | { kind: 'comment'; date: number; data: PdfComment };

function renderSubtaskItem(s: PdfSubtask, index: number): string {
  const statusIcon  = s.IsCompleted ? '✅' : '⏳';
  const statusText  = s.IsCompleted ? 'مكتملة' : 'جارية';
  const borderColor = s.IsCompleted ? '#059669' : '#2563eb';
  const bgColor     = s.IsCompleted ? '#f0fdf4' : '#eff6ff';
  const badgeColor  = s.IsCompleted ? '#059669' : '#2563eb';
  return `
    <div class="timeline-item" style="border-right-color:${borderColor};background:${bgColor}">
      <div class="tl-header">
        <span class="tl-badge" style="background:${badgeColor}">مهمة فرعية #${index}</span>
        <span class="tl-date">${fmt(s.CreatedAt, true)}</span>
      </div>
      <div class="tl-title">${statusIcon} ${esc(s.Title)}</div>
      <div class="tl-meta">
        <span>الحالة: <strong>${statusText}</strong></span>
        ${s.AssignedToName ? `<span>المسؤول: <strong>${esc(s.AssignedToName)}</strong></span>` : ''}
        ${s.EndDate ? `<span>تاريخ الانتهاء: <strong>${fmt(s.EndDate)}</strong></span>` : ''}
      </div>
    </div>`;
}

function renderCommentItem(c: PdfComment, index: number): string {
  return `
    <div class="timeline-item" style="border-right-color:#7c3aed;background:#faf5ff">
      <div class="tl-header">
        <span class="tl-badge" style="background:#7c3aed">تعليق #${index}</span>
        <span class="tl-author">${esc(c.UserName || c.UserID || 'مجهول')}</span>
        <span class="tl-date">${fmt(c.CreatedAt, true)}</span>
      </div>
      <div class="tl-body">${esc(c.Content).replace(/\n/g, '<br>')}</div>
    </div>`;
}

export function exportTaskToPdf(task: TaskForPdf): void {
  const subtasks = task.subtasks || [];
  const comments = task.comments || [];
  const doneCnt  = subtasks.filter(s => s.IsCompleted).length;
  const statusColor   = STATUS_COLOR[task.Status]    || '#6b7280';
  const priorityColor = PRIORITY_COLOR[task.Priority] || '#2563eb';

  // دمج المهام الفرعية والتعليقات وترتيبها زمنياً من الأقدم إلى الأحدث
  const subtaskCounters: Record<number, number> = {};
  const commentCounters: Record<number, number> = {};
  let si = 0, ci = 0;

  const timeline: TimelineItem[] = [
    ...subtasks.map(s => ({ kind: 'subtask' as const, date: new Date(s.CreatedAt || 0).getTime(), data: s })),
    ...comments.map(c => ({ kind: 'comment' as const, date: new Date(c.CreatedAt).getTime(), data: c })),
  ].sort((a, b) => a.date - b.date);

  const timelineHtml = timeline.length > 0 ? `
    <div class="section">
      <h2>
        السجل الزمني
        <span class="count">${subtasks.length} مهمة فرعية (${doneCnt} مكتملة)</span>
        <span class="count" style="background:#ede9fe;color:#5b21b6">${comments.length} تعليق</span>
      </h2>
      ${timeline.map(item => {
        if (item.kind === 'subtask') {
          subtaskCounters[item.data.SubtaskID] = ++si;
          return renderSubtaskItem(item.data, si);
        } else {
          const id = item.data.CommentID ?? ci;
          commentCounters[id] = ++ci;
          return renderCommentItem(item.data, ci);
        }
      }).join('')}
    </div>` : '';

  const descSection = task.Description ? `
    <div class="section">
      <h2>الوصف</h2>
      <div class="description">${esc(task.Description).replace(/\n/g, '<br>')}</div>
    </div>` : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>مهمة #${task.TaskID} — ${esc(task.Title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;color:#111;background:#fff;padding:24px;font-size:13px;line-height:1.65}
.header{border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:20px}
.task-id{color:#6b7280;font-size:11px;margin-bottom:6px;letter-spacing:.05em}
h1{font-size:21px;font-weight:700;margin-bottom:10px;color:#0f172a}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;color:#fff}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:20px}
.meta-item{display:flex;flex-direction:column;gap:3px}
.meta-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.meta-value{font-weight:600;color:#0f172a;font-size:13px;word-break:break-word}
.section{margin-bottom:22px}
h2{font-size:14px;color:#2563eb;border-bottom:1px solid #dbeafe;padding-bottom:6px;margin-bottom:14px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.count{background:#dbeafe;color:#1e40af;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:600}
.description{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;white-space:pre-wrap;font-size:13px}
/* timeline */
.timeline-item{border-right:4px solid #6b7280;border-radius:6px;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid}
.tl-header{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.tl-badge{padding:2px 10px;border-radius:99px;font-size:10px;font-weight:700;color:#fff;flex-shrink:0}
.tl-author{font-weight:700;color:#111;font-size:12px}
.tl-date{color:#64748b;font-size:11px;margin-right:auto}
.tl-title{font-weight:600;font-size:13px;margin-bottom:4px}
.tl-meta{display:flex;gap:14px;font-size:11px;color:#475569;flex-wrap:wrap}
.tl-body{white-space:pre-wrap;font-size:13px;color:#1e293b}
.footer{margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center}
@media print{body{padding:12px}@page{margin:1.5cm;size:A4}.timeline-item{page-break-inside:avoid}}
</style>
</head>
<body>
<div class="header">
  <div class="task-id">مهمة #${task.TaskID} &nbsp;•&nbsp; طُبع: ${fmt(new Date().toISOString())}</div>
  <h1>${esc(task.Title)}</h1>
  <div class="badges">
    <span class="badge" style="background:${statusColor}">${STATUS_LABEL[task.Status] || task.Status}</span>
    <span class="badge" style="background:${priorityColor}">${PRIORITY_LABEL[task.Priority] || task.Priority}</span>
    ${task.CategoryName ? `<span class="badge" style="background:#0891b2">${esc(task.CategoryName)}</span>` : ''}
  </div>
</div>

<div class="meta">
  <div class="meta-item"><span class="meta-label">المنشئ</span><span class="meta-value">${esc(task.CreatedByName || task.CreatedBy || 'غير محدد')}</span></div>
  <div class="meta-item"><span class="meta-label">المسؤول</span><span class="meta-value">${esc(task.AssignedToName || 'غير محدد')}</span></div>
  <div class="meta-item"><span class="meta-label">تاريخ الاستحقاق</span><span class="meta-value">${fmt(task.DueDate)}</span></div>
  ${task.URL ? `<div class="meta-item"><span class="meta-label">الرابط</span><span class="meta-value">${esc(task.URL)}</span></div>` : ''}
</div>

${descSection}
${timelineHtml}

<div class="footer">نظام إدارة المهام &nbsp;•&nbsp; ${new Date().toLocaleString('ar-EG-u-nu-latn')}</div>
<script>window.onload=function(){window.print()}</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
