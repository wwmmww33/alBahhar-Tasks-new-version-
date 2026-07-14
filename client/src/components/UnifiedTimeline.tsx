// src/components/UnifiedTimeline.tsx
import { Check, Square, Trash2, UserPlus, Calendar, Clock, MessageCircle, CheckSquare, Users, Bell } from 'lucide-react';
import React, { useState, useMemo, useCallback, useRef } from 'react';
import type { Subtask, User, CurrentUser } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { getActiveUserId, getActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId, resolveUserActorId } from '../utils/actorIdentity';

// قائمتا اختيار الساعة (00-23) والدقيقة (00-59) بنظام 24 ساعة مستقل عن الـ locale
const renderTimeSelects = (
  dateTimeValue: string,
  setDateTimeValue: (v: string) => void,
  className = ''
) => {
  const parts = (dateTimeValue.split('T')[1] || '00:00').split(':');
  const currentH = parseInt(parts[0] || '0', 10);
  const currentM = parseInt(parts[1] || '0', 10);
  const datePart = dateTimeValue.split('T')[0];
  return (
    <span className={`flex items-center gap-0.5 ${className}`}>
      <select
        value={String(currentH).padStart(2, '0')}
        onChange={(e) => setDateTimeValue(datePart + 'T' + e.target.value + ':' + String(currentM).padStart(2, '0'))}
        title="الساعة (00-23)"
        className="p-1 border rounded bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm text-center w-14"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
      <span className="text-sm font-mono select-none px-0.5">:</span>
      <select
        value={String(currentM).padStart(2, '0')}
        onChange={(e) => setDateTimeValue(datePart + 'T' + String(currentH).padStart(2, '0') + ':' + e.target.value)}
        title="الدقيقة"
        className="p-1 border rounded bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm text-center w-14"
      >
        {Array.from({ length: 60 }, (_, i) => (
          <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
    </span>
  );
};

type Comment = {
  CommentID: number;
  Content: string;
  UserID: string;
  CommentedByVacancyID?: number | string | null;
  UserName?: string;
  CreatedAt: string;
  ActedBy?: string;
  ActedByName?: string;
  ShowInCalendar?: boolean;
};

type TimelineItem = {
  id: string;
  type: 'subtask' | 'comment';
  createdAt: string;
  sortDate: string;
  data: Subtask | Comment;
};

type UnifiedTimelineProps = {
  taskId: string;
  subtasks: Subtask[];
  comments: Comment[];
  users: User[];
  currentUser: CurrentUser;
  task: any;
  onSubtaskUpdate: () => void;
  onCommentSubmit: (commentData: string | { content: string; customDateTime: string | null; showInCalendar?: boolean }) => Promise<void>;
  isSubmittingComment: boolean;
  onCommentsUpdate: () => void;
};

const UnifiedTimeline = ({
  taskId,
  subtasks,
  comments,
  users,
  currentUser,
  task,
  onSubtaskUpdate,
  onCommentSubmit,
  isSubmittingComment,
  onCommentsUpdate
}: UnifiedTimelineProps) => {
  const { refreshTasks, refreshNotifications } = useNotification();
  const safeUsers = Array.isArray(users) ? users : [];
  const MD_COLORS: Record<string, string> = {
    red:'#ef4444', green:'#16a34a', blue:'#2563eb', orange:'#ea580c',
    purple:'#9333ea', pink:'#db2777', teal:'#0d9488', gray:'#6b7280', yellow:'#ca8a04'
  };

  const renderMarkdown = (raw: string): string => {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
          html += `<tr style="background:${ri%2===0?'transparent':'rgba(0,0,0,0.03)'}">`;
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
  };

  const getUserNameById = (id?: string) => {
    if (!id) return '';
    return safeUsers.find(u => resolveUserActorId(u) === id || u.UserID === id)?.FullName || id;
  };
  const getTodayString = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };
  const formatToDateTimeLocal = (d: Date) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da}T${h}:${mi}`;
  };
  const formatDateTimeDisplay = (dateStr: string) => {
    const d = new Date(dateStr);
    const dateLabel = d.toLocaleDateString('ar-EG-u-nu-latn');
    const h = d.getHours();
    const mi = d.getMinutes();
    if (h === 0 && mi === 0) return dateLabel;
    return `${dateLabel} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  };
  const getCurrentDateTime = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };
  
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskDueDate, setNewSubtaskDueDate] = useState(getTodayString());
  const [newSubtaskEndDate, setNewSubtaskEndDate] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [showInCalendar, setShowInCalendar] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState(15);
  const [newComment, setNewComment] = useState('');
  const [showCommentPreview, setShowCommentPreview] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [useCustomDateTime, setUseCustomDateTime] = useState(false);
  const [customDateTime, setCustomDateTime] = useState(getCurrentDateTime());
  const [showCommentInCalendar, setShowCommentInCalendar] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);

  // حالات التحرير داخل عناصر الجدول الزمني
  const [editingTitleSubtaskId, setEditingTitleSubtaskId] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [editingDueSubtaskId, setEditingDueSubtaskId] = useState<number | null>(null);
  const [editingDueValue, setEditingDueValue] = useState<string>('');
  const [editingEndSubtaskId, setEditingEndSubtaskId] = useState<number | null>(null);
  const [editingEndValue, setEditingEndValue] = useState<string>('');
  const [editingReminderSubtaskId, setEditingReminderSubtaskId] = useState<number | null>(null);
  const [editingReminderEnabled, setEditingReminderEnabled] = useState(false);
  const [editingReminderMinutes, setEditingReminderMinutes] = useState(15);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentValue, setEditingCommentValue] = useState('');

  // Bulk Assign State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [selectedSubtaskForBulk, setSelectedSubtaskForBulk] = useState<Subtask | null>(null);
  const [bulkSelectedUsers, setBulkSelectedUsers] = useState<string[]>([]);

  // New Task Bulk State
  const [isNewTaskBulkModalOpen, setIsNewTaskBulkModalOpen] = useState(false);
  const [newSubtaskBulkUsers, setNewSubtaskBulkUsers] = useState<string[]>([]);

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const editingCommentRef = useRef<HTMLTextAreaElement>(null);

  const insertMarkdownSyntax = (prefix: string, suffix: string, placeholder: string) => {
    const el = newCommentRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = newComment.slice(start, end) || placeholder;
    const before = newComment.slice(0, start);
    const after = newComment.slice(end);
    const inserted = prefix + selected + suffix;
    const next = before + inserted + after;
    setNewComment(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + prefix.length + selected.length;
      el.setSelectionRange(cursor, cursor);
      autoResize(el);
    });
  };

  const insertTableTemplate = () => {
    const tpl = '\n| العمود 1 | العمود 2 | العمود 3 |\n| --- | --- | --- |\n| بيانات | بيانات | بيانات |\n';
    const el = newCommentRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? newComment.length;
    const next = newComment.slice(0, pos) + tpl + newComment.slice(pos);
    setNewComment(next);
    requestAnimationFrame(() => { el.focus(); autoResize(el); });
  };

  const insertColor = (colorKey: string) => {
    setShowColorPicker(false);
    insertMarkdownSyntax(`[c=${colorKey}]`, '[/c]', 'نص ملوّن');
  };

  const htmlTableToMarkdown = (html: string): string | null => {
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
    } catch { return null; }
  };

  const handleCommentPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    if (html && html.toLowerCase().includes('<table')) {
      const md = htmlTableToMarkdown(html);
      if (md) {
        e.preventDefault();
        const el = e.currentTarget;
        const s = el.selectionStart ?? 0;
        const en = el.selectionEnd ?? 0;
        const next = newComment.slice(0, s) + md + newComment.slice(en);
        setNewComment(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(s + md.length, s + md.length);
          autoResize(el);
        });
        return;
      }
    }
    setTimeout(() => autoResize(e.currentTarget), 0);
  };

  const actingUserId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  const userActorId = (user: User) => String(resolveUserActorId(user) || user.UserID);
  const subtaskAssignedId = (subtask: Subtask) => String(subtask.AssignedToVacancyID ?? subtask.AssignedTo ?? '');

  // في وضع التفويض: actingUserId = معرّف المفوِّض (مالك المهمة)
  // ActedBy يجب أن يحمل معرّف المفوَّض له (currentUser = User B المسجَّل فعلياً)
  const _delegationAccount = getActiveAccount();
  const _isDelegationMode = _delegationAccount?.mode === 'delegation';
  // نُرسل VacancyID المفوَّض له إن وُجد، وإلا UserID — الخادم يحتاج لمطابقة التفويض
  const _delegateUserId = _isDelegationMode
    ? (resolveCurrentActorId(currentUser) || String(currentUser.UserID || '').trim())
    : null;
  const actedByValue = _isDelegationMode ? _delegateUserId : actingUserId;

  const actorIdCandidates = useMemo(() => {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      const normalized = String(value ?? '').trim();
      if (normalized) ids.add(normalized);
    };
    add(actingUserId);
    add(currentUser.UserID);
    add(resolveCurrentActorId(currentUser));
    add((currentUser as any).CurrentVacancyID);
    add((currentUser as any).ActiveVacancyID);
    add((currentUser as any).VacancyID);

    const currentUserFromDepartment = safeUsers.find(
      user => String(user.UserID ?? '').trim() === String(currentUser.UserID ?? '').trim()
    );
    if (currentUserFromDepartment) {
      add(currentUserFromDepartment.UserID);
      add(resolveUserActorId(currentUserFromDepartment));
      add((currentUserFromDepartment as any).CurrentVacancyID);
      add((currentUserFromDepartment as any).ActiveVacancyID);
      add((currentUserFromDepartment as any).VacancyID);
    }

    return ids;
  }, [actingUserId, currentUser, safeUsers]);

  const isActorMatch = (value: unknown) => {
    const normalized = String(value ?? '').trim();
    return !!normalized && actorIdCandidates.has(normalized);
  };

  const isSubtaskAssignedToActor = (subtask: Subtask) => {
    return isActorMatch(subtask.AssignedToVacancyID) || isActorMatch(subtask.AssignedTo);
  };

  const isSubtaskCreatorActor = (subtask: Subtask) => {
    return isActorMatch(subtask.CreatedByVacancyID) || isActorMatch(subtask.CreatedBy);
  };

  const isCommentOwner = (comment: Comment) => {
    return isActorMatch(comment.CommentedByVacancyID) || isActorMatch(comment.UserID);
  };

  const canAddSubtasks = Boolean(task);

  // دمج المهام الفرعية والتعليقات وترتيبها حسب تاريخ الاستحقاق (الأحدث أولاً)
  const timelineItems: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];

    // إضافة المهام الفرعية — تُرتب بتاريخ الاستحقاق، وبدون تاريخ تذهب للأسفل
    subtasks.forEach(subtask => {
      items.push({
        id: `subtask-${subtask.SubtaskID}`,
        type: 'subtask',
        createdAt: subtask.CreatedAt,
        sortDate: (subtask as any).DueDate || '',
        data: subtask
      });
    });

    // إضافة التعليقات — تُرتب بتاريخ إنشائها
    comments.forEach(comment => {
      items.push({
        id: `comment-${comment.CommentID}`,
        type: 'comment',
        createdAt: comment.CreatedAt,
        sortDate: comment.CreatedAt,
        data: comment
      });
    });

    // ترتيب من الأحدث إلى الأقدم (عناصر بلا تاريخ تنزل للأسفل)
    return items.sort((a, b) => {
      const aTime = a.sortDate ? new Date(a.sortDate).getTime() : 0;
      const bTime = b.sortDate ? new Date(b.sortDate).getTime() : 0;
      return bTime - aTime;
    });
  }, [subtasks, comments]);

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;

    if (assignTo === 'bulk') {
        if (newSubtaskBulkUsers.length === 0) {
            alert("الرجاء اختيار مستخدم واحد على الأقل");
            return;
        }

        let successCount = 0;
        const errors: string[] = [];

        for (const userId of newSubtaskBulkUsers) {
            try {
                const resp = await fetch('/api/subtasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        TaskID: taskId, Title: newSubtaskTitle, CreatedBy: actingUserId, ActedBy: actedByValue,
                        DueDate: newSubtaskDueDate || null, EndDate: newSubtaskEndDate || null, AssignedTo: userId,
                        ShowInCalendar: showInCalendar,
                        ReminderEnabled: reminderEnabled,
                        ReminderMinutes: reminderEnabled ? reminderMinutes : null,
                        UserID: actingUserId, isAdmin: currentUser.IsAdmin
                    }),
                });
                if (resp.ok) {
                    successCount++;
                } else {
                    const text = await resp.text().catch(() => '');
                    let errMsg = '';
                    try { errMsg = JSON.parse(text)?.message || text; } catch { errMsg = text; }
                    const userName = safeUsers.find(u => userActorId(u) === userId)?.FullName || userId;
                    errors.push(`${userName}: خطأ ${resp.status} — ${errMsg}`);
                }
            } catch (err: any) {
                const userName = safeUsers.find(u => userActorId(u) === userId)?.FullName || userId;
                errors.push(`${userName}: خطأ في الاتصال — ${err?.message || err}`);
            }
        }

        setNewSubtaskTitle(''); setNewSubtaskDueDate(getTodayString()); setNewSubtaskEndDate(''); setAssignTo(''); setShowInCalendar(false);
        setReminderEnabled(false); setReminderMinutes(15);
        setNewSubtaskBulkUsers([]);

        if (successCount > 0) {
            window.dispatchEvent(new CustomEvent('calendar:subtask:created', { detail: { ShowInCalendar: showInCalendar, DueDate: newSubtaskDueDate } }));
            onSubtaskUpdate();
            refreshTasks();
            refreshNotifications();
        }

        if (errors.length > 0) {
            alert(`تم إنشاء ${successCount} مهمة فرعية بنجاح.\nفشل إنشاء ${errors.length}:\n${errors.join('\n')}`);
        }
        return;
    }

    const resp = await fetch('/api/subtasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TaskID: taskId,
        Title: newSubtaskTitle,
        CreatedBy: actingUserId,
        ActedBy: actedByValue,
        DueDate: newSubtaskDueDate || null,
        EndDate: newSubtaskEndDate || null,
        AssignedTo: assignTo || actingUserId,
        ShowInCalendar: showInCalendar,
        ReminderEnabled: reminderEnabled,
        ReminderMinutes: reminderEnabled ? reminderMinutes : null,
        UserID: actingUserId,
        isAdmin: currentUser.IsAdmin
      }),
    });
    setNewSubtaskTitle('');
    setNewSubtaskDueDate(getTodayString());
    setNewSubtaskEndDate('');
    setAssignTo('');
    setShowInCalendar(false);
    setReminderEnabled(false);
    setReminderMinutes(15);
    onSubtaskUpdate();
    if (resp.ok) {
      window.dispatchEvent(new CustomEvent('calendar:subtask:created', { detail: { ShowInCalendar: showInCalendar, DueDate: newSubtaskDueDate } }));
    }
    // تحديث قائمة المهام وربما الإشعارات فورًا
    refreshTasks();
    refreshNotifications();
  };

  const handleToggleStatus = async (subtask: Subtask) => {
    const isPersonalOwner = !!(task?.PersonalOwnerUserID) &&
      String(task.PersonalOwnerUserID).trim() === String(currentUser.UserID).trim();
    if (!isSubtaskAssignedToActor(subtask) && !isPersonalOwner) {
      alert('فقط الشخص المسند له المهمة الفرعية يمكنه تغيير حالة الإكمال.');
      return;
    }

    try {
      const resp = await fetch(`/api/subtasks/${subtask.SubtaskID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !subtask.IsCompleted, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
      });

      if (!resp.ok) {
        if (resp.status === 403) {
          alert('ليس لديك الصلاحية لتغيير حالة هذه المهمة.');
          return;
        }
        const text = await resp.text().catch(() => '');
        alert(`فشل تحديث حالة المهمة الفرعية (${resp.status}). ${text}`);
        return;
      }

      onSubtaskUpdate();
      refreshTasks();
    } catch (error) {
      console.error('Failed to toggle subtask status:', error);
      alert('تعذر الاتصال بالخادم أثناء تحديث حالة المهمة الفرعية.');
    }
  };

  const handleAssign = async (subtask: Subtask, assignedTo: string) => {
    if (!isSubtaskCreatorActor(subtask) && !currentUser.IsAdmin) {
      alert('فقط منشئ المهمة الفرعية يمكنه تغيير الإسناد.');
      return;
    }

    if (assignedTo === 'bulk') {
        setSelectedSubtaskForBulk(subtask);
        setBulkSelectedUsers(subtaskAssignedId(subtask) ? [subtaskAssignedId(subtask)] : []);
        setIsBulkModalOpen(true);
        return;
    }

    await fetch(`/api/subtasks/${subtask.SubtaskID}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedToUserId: assignedTo || null, assignedByUserId: actingUserId, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
    });
    onSubtaskUpdate();
    refreshTasks();
    refreshNotifications();
  };

  const submitBulkAssign = async () => {
      if (!selectedSubtaskForBulk) return;
      if (!isSubtaskCreatorActor(selectedSubtaskForBulk) && !currentUser.IsAdmin) {
        alert('فقط منشئ المهمة الفرعية يمكنه تغيير الإسناد.');
        return;
      }
      if (bulkSelectedUsers.length === 0) {
          alert("الرجاء اختيار مستخدم واحد على الأقل");
          return;
      }
      
      try {
        const resp = await fetch(`/api/subtasks/${selectedSubtaskForBulk.SubtaskID}/bulk-assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignedToUserIds: bulkSelectedUsers, assignedByUserId: actingUserId, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
        });
        
        if (resp.ok) {
            onSubtaskUpdate();
            refreshTasks();
            refreshNotifications();
            setIsBulkModalOpen(false);
            setSelectedSubtaskForBulk(null);
            setBulkSelectedUsers([]);
        } else {
            alert("حدث خطأ أثناء الإسناد المتعدد");
        }
      } catch (e) {
          console.error(e);
          alert("حدث خطأ في الاتصال");
      }
  };

  const toggleUserSelection = (userId: string) => {
      setBulkSelectedUsers(prev => 
        prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
      );
  };

  // حفظ تفاصيل المهمة الفرعية (العنوان / تاريخ الاستحقاق)
  const saveSubtaskDetails = async (subtaskId: number, payload: Partial<Pick<Subtask, 'Title' | 'DueDate' | 'EndDate' | 'ReminderEnabled' | 'ReminderMinutes'>>) => {
    try {
      const resp = await fetch(`/api/subtasks/${subtaskId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حفظ التغييرات (${resp.status}). ${text}`);
        return false;
      }
      // أي تعديل يؤثر على موعد التذكير (الاستحقاق أو إعدادات التذكير نفسها) يُعيد تفعيله
      // حتى لو سبق إظهار النافذة المنبثقة لهذه المهمة من قبل
      if ('DueDate' in payload || 'ReminderEnabled' in payload || 'ReminderMinutes' in payload) {
        window.dispatchEvent(new CustomEvent('subtask:reminder:edited', { detail: { subtaskId } }));
      }
      onSubtaskUpdate();
      refreshTasks();
      return true;
    } catch (err) {
      console.error('Network error while saving subtask details:', err);
      alert('تعذر الاتصال بالخادم أثناء الحفظ. تأكد من تشغيل الخادم وأن البروكسي مفعل.');
      return false;
    }
  };

  // تبديل إظهار المهمة الفرعية الحالية في التقويم
  const handleToggleCalendar = async (subtask: Subtask, nextShow: boolean) => {
    try {
      const url = `/api/subtasks/${subtask.SubtaskID}/calendar`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ShowInCalendar: nextShow, UserID: actingUserId, isAdmin: currentUser.IsAdmin })
      });
      if (resp.ok) {
        window.dispatchEvent(new CustomEvent('calendar:subtask:updated', { detail: { SubtaskID: subtask.SubtaskID, ShowInCalendar: nextShow } }));
        onSubtaskUpdate();
        refreshTasks();
        refreshNotifications();
      } else {
        const text = await resp.text().catch(() => '');
        if (resp.status === 404) {
          alert('لم يتم العثور على المهمة الفرعية (404). قد تكون محذوفة أو رقم المعرف غير صحيح.');
        } else {
          alert(`فشل تحديث التبديل في التقويم (${resp.status}). ${text}`);
        }
      }
    } catch (err) {
      console.error('Network error while toggling calendar flag:', err);
      alert('تعذر الاتصال بالخادم. تأكد من أن الخادم يعمل على المنفذ 5001 وأن البروكسي مفعل.');
    }
  };

  const handleDeleteSubtask = async (subtask: Subtask) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه المهمة الفرعية؟')) return;
    try {
      const resp = await fetch(`/api/subtasks/${subtask.SubtaskID}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: actingUserId, isAdmin: currentUser.IsAdmin })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(data.message || `فشل حذف المهمة الفرعية (${resp.status})`);
        return;
      }

      onSubtaskUpdate();
      refreshTasks();
      refreshNotifications();
    } catch (err) {
      console.error('Network error while deleting subtask:', err);
      alert('تعذر الاتصال بالخادم أثناء حذف المهمة الفرعية. تأكد من تشغيل الخادم.');
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmittingComment) return;
    
    if (useCustomDateTime) {
      const selectedDate = new Date(customDateTime);
      if (isNaN(selectedDate.getTime())) {
        alert('يرجى إدخال تاريخ ووقت صحيح');
        return;
      }
    }
    
    // تمرير التاريخ المخصص إذا تم تفعيله
    const hadCalendar = showCommentInCalendar;
    const commentData = {
      content: newComment,
      customDateTime: useCustomDateTime ? customDateTime : null,
      showInCalendar: hadCalendar
    };

    await onCommentSubmit(commentData);
    setNewComment('');
    setCustomDateTime(getCurrentDateTime());
    setShowCommentInCalendar(false);
    if (hadCalendar) {
      window.dispatchEvent(new CustomEvent('calendar:comment:created', { detail: { ShowInCalendar: true } }));
    }
  };

  const saveComment = async (commentId: number, content: string) => {
    try {
      const resp = await fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Content: content,
          UserID: actingUserId,
          isAdmin: currentUser.IsAdmin,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حفظ التعديل على التعليق (${resp.status}). ${text}`);
        return false;
      }
      onCommentsUpdate();
      refreshNotifications();
      return true;
    } catch (err) {
      console.error('Network error while saving comment:', err);
      alert('تعذر الاتصال بالخادم أثناء حفظ التعليق. تأكد من تشغيل الخادم.');
      return false;
    }
  };

  const handleDeleteComment = async (comment: Comment) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا التعليق؟')) return;
    try {
      const resp = await fetch(`/api/comments/${comment.CommentID}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حذف التعليق (${resp.status}). ${text}`);
        return;
      }
      onCommentsUpdate();
      refreshNotifications();
    } catch (err) {
      console.error('Network error while deleting comment:', err);
      alert('تعذر الاتصال بالخادم أثناء حذف التعليق. تأكد من تشغيل الخادم.');
    }
  };

  const renderSubtaskItem = (subtask: Subtask) => {
    const canDelete = isSubtaskCreatorActor(subtask);
    const canEditTitle = true;
    const canEditDue = true;
    // في المهام الشخصية: صاحب المهمة يستطيع إكمال مهامه الفرعية حتى لو غيّر منصبه
    const isPersonalOwner = !!(task?.PersonalOwnerUserID) &&
      String(task.PersonalOwnerUserID).trim() === String(currentUser.UserID).trim();
    const canToggleStatus = isSubtaskAssignedToActor(subtask) || isPersonalOwner;
    const canManageAssignments = isSubtaskCreatorActor(subtask) || isPersonalOwner || !!currentUser.IsAdmin;
    const assignedId = subtaskAssignedId(subtask);
    const assignedInUsersList = !!safeUsers.find(user => userActorId(user) === assignedId);
    const assignedFallbackLabel = subtask.AssignedToName || (assignedId ? `منصب #${assignedId}` : '');

    return (
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-1">
          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-grow">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-3 mb-2">
              <div
                onClick={() => {
                  if (!canToggleStatus) return;
                  handleToggleStatus(subtask);
                }}
                className={canToggleStatus ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}
                title={canToggleStatus ? 'تغيير حالة الإكمال' : 'فقط الشخص المسندت له المهمة يمكنه تغيير الحالة'}
              >
                {subtask.IsCompleted ? (
                  <Check className="text-green-500 w-5 h-5" />
                ) : (
                  <Square className="text-content-secondary w-5 h-5" />
                )}
              </div>
              {editingTitleSubtaskId === subtask.SubtaskID ? (
                <input
                  type="text"
                  autoFocus
                  value={editingTitleValue}
                  onChange={(e) => setEditingTitleValue(e.target.value)}
                  onBlur={async () => {
                    const trimmed = editingTitleValue.trim();
                    if (trimmed && trimmed !== subtask.Title) {
                      await saveSubtaskDetails(subtask.SubtaskID, { Title: trimmed });
                    }
                    setEditingTitleSubtaskId(null);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const trimmed = editingTitleValue.trim();
                      if (trimmed && trimmed !== subtask.Title) {
                        await saveSubtaskDetails(subtask.SubtaskID, { Title: trimmed });
                      }
                      setEditingTitleSubtaskId(null);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTitleSubtaskId(null);
                    }
                  }}
                  className={`font-medium w-full bg-bkg border border-content/20 rounded px-2 py-1 ${subtask.IsCompleted ? 'line-through text-gray-500 dark:text-gray-400' : 'text-content'}`}
                />
              ) : (
                <span
                  className={`font-medium ${subtask.IsCompleted ? 'line-through text-gray-500 dark:text-gray-400' : 'text-content'} ${canEditTitle ? 'cursor-text' : ''}`}
                  onClick={() => {
                    if (!canEditTitle) return;
                    setEditingTitleSubtaskId(subtask.SubtaskID);
                    setEditingTitleValue(subtask.Title || '');
                  }}
                  onDoubleClick={() => {
                    if (!canEditTitle) return;
                    setEditingTitleSubtaskId(subtask.SubtaskID);
                    setEditingTitleValue(subtask.Title || '');
                  }}
                  title={canEditTitle ? 'انقر للتحرير' : undefined}
                >
                  {subtask.Title}
                </span>
              )}
              <span className="text-xs text-content-secondary font-mono ml-2">#{subtask.SubtaskID}</span>
              {(subtask as any).Notes && (
                <div className="flex flex-col gap-0.5 mr-1">
                  {String((subtask as any).Notes).split('\n').map((line: string, i: number) => (
                    <span key={i} className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                      {line}
                    </span>
                  ))}
                </div>
              )}
              {canDelete && (
                <button
                  onClick={() => handleDeleteSubtask(subtask)}
                  className="text-red-500 hover:text-red-700 ml-auto"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            
            <div className="flex flex-col gap-2 text-xs text-content-secondary">
              <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <UserPlus size={14} />
                {isPersonalOwner ? (
                  <span className="text-xs text-content-secondary">مسندة إليك</span>
                ) : (
                  <>
                    <select
                      value={assignedId}
                      onChange={(e) => handleAssign(subtask, e.target.value)}
                      disabled={!canManageAssignments}
                      className="bg-transparent text-xs focus:outline-none disabled:opacity-70 dark:text-gray-300 max-w-[120px]"
                    >
                      <option value="">غير مسندة</option>
                      <option value="bulk" className="font-bold text-primary">👥 إسناد متعدد...</option>
                      {assignedId && !assignedInUsersList && (
                        <option value={assignedId}>{assignedFallbackLabel}</option>
                      )}
                      {safeUsers.map(user => (
                        <option key={userActorId(user)} value={userActorId(user)}>{user.FullName}</option>
                      ))}
                    </select>
                    {canManageAssignments && (
                      <button
                        onClick={() => {
                          setSelectedSubtaskForBulk(subtask);
                          setBulkSelectedUsers(subtaskAssignedId(subtask) ? [subtaskAssignedId(subtask)] : []);
                          setIsBulkModalOpen(true);
                        }}
                        className="p-1 hover:bg-primary/10 rounded-full text-primary transition-colors"
                        title="إسناد متعدد / تكرار المهمة"
                      >
                        <Users size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
              
              {(subtask.CreatedByName || subtask.CreatedBy) && (
                <div className="flex items-center gap-1">
                  <span>
                    المنشيء: {subtask.CreatedByName || subtask.CreatedBy}
                    {subtask.ActedBy ? ` بواسطة (${subtask.ActedByName || getUserNameById(subtask.ActedBy)})` : ''}
                  </span>
                </div>
              )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <Calendar size={14} />
                  {editingDueSubtaskId === subtask.SubtaskID ? (
                    <span
                      className="flex items-center gap-1"
                      onBlur={async (e) => {
                        // إذا انتقل التركيز لعنصر داخل نفس الحاوية لا نغلق
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        const next = editingDueValue || '';
                        const original = subtask.DueDate ? formatToDateTimeLocal(new Date(subtask.DueDate)) : '';
                        if (next !== original) {
                          await saveSubtaskDetails(subtask.SubtaskID, { DueDate: next || null as any });
                        }
                        setEditingDueSubtaskId(null);
                      }}
                    >
                      <input
                        type="date"
                        autoFocus
                        value={editingDueValue.split('T')[0]}
                        onChange={(e) => setEditingDueValue(e.target.value + 'T' + (editingDueValue.split('T')[1] || '00:00'))}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const next = editingDueValue || '';
                            const original = subtask.DueDate ? formatToDateTimeLocal(new Date(subtask.DueDate)) : '';
                            if (next !== original) {
                              await saveSubtaskDetails(subtask.SubtaskID, { DueDate: next || null as any });
                            }
                            setEditingDueSubtaskId(null);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingDueSubtaskId(null);
                          }
                        }}
                        className="text-xs bg-bkg border border-content/20 rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                      />
                      {renderTimeSelects(editingDueValue, setEditingDueValue, 'text-xs')}
                    </span>
                  ) : (
                    <span
                      className="cursor-text"
                      onClick={() => {
                        if (!canEditDue) return;
                        setEditingDueSubtaskId(subtask.SubtaskID);
                        setEditingDueValue(subtask.DueDate ? formatToDateTimeLocal(new Date(subtask.DueDate)) : getTodayString());
                      }}
                      onDoubleClick={() => {
                        if (!canEditDue) return;
                        setEditingDueSubtaskId(subtask.SubtaskID);
                        setEditingDueValue(subtask.DueDate ? formatToDateTimeLocal(new Date(subtask.DueDate)) : getTodayString());
                      }}
                      title={canEditDue ? 'انقر لتعديل تاريخ الاستحقاق' : undefined}
                    >
                      الاستحقاق: {subtask.DueDate ? formatDateTimeDisplay(subtask.DueDate) : '—'}
                    </span>
                  )}
                  {editingEndSubtaskId === subtask.SubtaskID ? (
                    <input
                      type="date"
                      autoFocus
                      value={editingEndValue}
                      onChange={(e) => setEditingEndValue(e.target.value)}
                      onBlur={async () => {
                        const next = editingEndValue || '';
                        const original = subtask.EndDate ? new Date(subtask.EndDate).toISOString().slice(0, 10) : '';
                        if (next !== original) {
                          await saveSubtaskDetails(subtask.SubtaskID, { EndDate: (next || null) as any });
                        }
                        setEditingEndSubtaskId(null);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const next = editingEndValue || '';
                          const original = subtask.EndDate ? new Date(subtask.EndDate).toISOString().slice(0, 10) : '';
                          if (next !== original) {
                            await saveSubtaskDetails(subtask.SubtaskID, { EndDate: (next || null) as any });
                          }
                          setEditingEndSubtaskId(null);
                        } else if (e.key === 'Escape') {
                          setEditingEndSubtaskId(null);
                        }
                      }}
                      className="text-xs bg-bkg border border-content/20 rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                    />
                  ) : (
                    <span
                      className={`cursor-text ${subtask.EndDate ? '' : 'opacity-40'}`}
                      onClick={() => {
                        setEditingEndSubtaskId(subtask.SubtaskID);
                        setEditingEndValue(subtask.EndDate ? new Date(subtask.EndDate).toISOString().slice(0, 10) : '');
                      }}
                      onDoubleClick={() => {
                        setEditingEndSubtaskId(subtask.SubtaskID);
                        setEditingEndValue(subtask.EndDate ? new Date(subtask.EndDate).toISOString().slice(0, 10) : '');
                      }}
                      title="انقر لتعديل تاريخ الانتهاء"
                    >
                      {subtask.EndDate
                        ? `— نهاية: ${new Date(subtask.EndDate).toLocaleDateString('ar-EG-u-nu-latn')}`
                        : '— (انتهاء)'}
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!(subtask as any).ShowInCalendar}
                    onChange={(e) => handleToggleCalendar(subtask, e.target.checked)}
                  />
                  <span>إظهار في التقويم</span>
                </label>
                {editingReminderSubtaskId === subtask.SubtaskID ? (
                  <span
                    className="flex items-center gap-1.5"
                    onBlur={async (e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      const origEnabled = !!subtask.ReminderEnabled;
                      const origMinutes = subtask.ReminderMinutes ?? 15;
                      if (editingReminderEnabled !== origEnabled || (editingReminderEnabled && editingReminderMinutes !== origMinutes)) {
                        await saveSubtaskDetails(subtask.SubtaskID, {
                          ReminderEnabled: editingReminderEnabled,
                          ReminderMinutes: editingReminderEnabled ? editingReminderMinutes : null,
                        });
                      }
                      setEditingReminderSubtaskId(null);
                    }}
                  >
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        autoFocus
                        checked={editingReminderEnabled}
                        onChange={(e) => setEditingReminderEnabled(e.target.checked)}
                      />
                      <span>تذكير</span>
                    </label>
                    {editingReminderEnabled && (
                      <>
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={editingReminderMinutes}
                          onChange={(e) => setEditingReminderMinutes(Math.max(1, parseInt(e.target.value) || 15))}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              await saveSubtaskDetails(subtask.SubtaskID, {
                                ReminderEnabled: editingReminderEnabled,
                                ReminderMinutes: editingReminderMinutes,
                              });
                              setEditingReminderSubtaskId(null);
                            } else if (e.key === 'Escape') {
                              setEditingReminderSubtaskId(null);
                            }
                          }}
                          className="w-14 text-xs bg-bkg border border-content/20 rounded px-1 py-0.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-center"
                        />
                        <span className="text-xs">د قبل</span>
                      </>
                    )}
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1 cursor-pointer"
                    onClick={() => {
                      setEditingReminderSubtaskId(subtask.SubtaskID);
                      setEditingReminderEnabled(!!subtask.ReminderEnabled);
                      setEditingReminderMinutes(subtask.ReminderMinutes ?? 15);
                    }}
                    title="انقر لتعديل التذكير"
                  >
                    <Bell size={14} className={subtask.ReminderEnabled ? 'text-orange-500' : 'opacity-40'} />
                    {subtask.ReminderEnabled
                      ? `تذكير قبل ${subtask.ReminderMinutes ?? 15} د`
                      : <span className="opacity-40">بلا تذكير</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-2 text-xs text-content-secondary">
            <Clock size={12} />
            <span>
              تم الإنشاء: {new Date(subtask.CreatedAt).toLocaleString('ar-EG-u-nu-latn', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Muscat'
              })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderCommentItem = (comment: Comment) => {
    const canManage = isCommentOwner(comment);
    const isEditing = editingCommentId === comment.CommentID;
    const handleToggleCommentCalendar = async (next: boolean) => {
      try {
        const resp = await fetch(`/api/comments/${comment.CommentID}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            UserID: actingUserId,
            ShowInCalendar: next,
            isAdmin: currentUser.IsAdmin,
          }),
        });
        if (resp.ok) {
          onCommentsUpdate();
          window.dispatchEvent(new CustomEvent('calendar:comment:updated', { detail: { CommentID: comment.CommentID, ShowInCalendar: next } }));
        } else {
          const text = await resp.text().catch(() => '');
          alert(`فشل تحديث إظهار التعليق في التقويم (${resp.status}). ${text}`);
        }
      } catch (err) {
        console.error('Network error while toggling comment calendar flag:', err);
        alert('تعذر الاتصال بالخادم أثناء تحديث إظهار التعليق في التقويم.');
      }
    };

    return (
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mt-1">
          <MessageCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-grow">
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
            {isEditing ? (
              <textarea
                autoFocus
                ref={(el) => { (editingCommentRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; autoResize(el); }}
                value={editingCommentValue}
                onChange={(e) => { setEditingCommentValue(e.target.value); autoResize(e.target); }}
                onPaste={(e) => { setTimeout(() => autoResize(e.target as HTMLTextAreaElement), 0); }}
                onBlur={async () => {
                  const trimmed = editingCommentValue.trim();
                  if (trimmed && trimmed !== comment.Content) {
                    await saveComment(comment.CommentID, trimmed);
                  }
                  setEditingCommentId(null);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const trimmed = editingCommentValue.trim();
                    if (trimmed && trimmed !== comment.Content) {
                      await saveComment(comment.CommentID, trimmed);
                    }
                    setEditingCommentId(null);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingCommentId(null);
                  }
                }}
                className="w-full p-2 border border-content/20 rounded bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm mb-2 resize-none overflow-hidden"
                rows={3}
              />
            ) : (
              <>
                <div
                  className={`text-content mb-2 text-sm ${canManage ? 'cursor-text' : ''}`}
                  onClick={() => {
                    if (!canManage) return;
                    setEditingCommentId(comment.CommentID);
                    setEditingCommentValue(comment.Content || '');
                  }}
                  onDoubleClick={() => {
                    if (!canManage) return;
                    setEditingCommentId(comment.CommentID);
                    setEditingCommentValue(comment.Content || '');
                  }}
                  title={canManage ? 'انقر لتعديل هذا التعليق' : undefined}
                  dir="auto"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.Content || '') }}
                />
                {!!comment.ShowInCalendar && comment.CreatedAt && (() => {
                  const d = new Date(comment.CreatedAt);
                  const y = d.getFullYear();
                  const m = d.getMonth() + 1;
                  const day = d.getDate();
                  const h = String(d.getHours()).padStart(2, '0');
                  const min = String(d.getMinutes()).padStart(2, '0');
                  return (
                    <p className="text-xs text-purple-600 dark:text-purple-400 mb-2">
                      📅 {y}/{m}/{day} {h}:{min}
                    </p>
                  );
                })()}
              </>
            )}
            <div className="flex justify-between items-center">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-content-secondary">
                  المنشيء: {comment.UserName || comment.UserID}
                  {comment.ActedBy ? ` بواسطة (${comment.ActedByName || getUserNameById(comment.ActedBy)})` : ''}
                </p>
                {canManage && (
                  <label className="flex items-center gap-2 text-xs text-content-secondary">
                    <input
                      type="checkbox"
                      checked={!!comment.ShowInCalendar}
                      onChange={(e) => handleToggleCommentCalendar(e.target.checked)}
                    />
                    <span>إظهار هذا التعليق في التقويم</span>
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    onClick={() => handleDeleteComment(comment)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <p className="text-xs text-content-secondary font-mono">#{comment.CommentID}</p>
                {(comment as any).Notes && (
                  <div className="flex flex-col gap-0.5">
                    {String((comment as any).Notes).split('\n').map((line: string, i: number) => (
                      <span key={i} className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                        {line}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 text-xs text-content-secondary">
            <Clock size={12} />
            <span>
              تاريخ الإدراج: {new Date(comment.CreatedAt).toLocaleString('ar-EG-u-nu-latn', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Muscat'
              })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-8">
      {/* Bulk Assign Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bkg p-6 rounded-lg shadow-lg w-96 max-w-full">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Users size={20} />
              إسناد متعدد / تكرار المهمة
            </h3>
            <p className="text-sm text-content-secondary mb-4">
              اختر الموظفين الذين تريد إسناد المهمة لهم. سيتم تكرار المهمة لكل موظف إضافي.
            </p>
            <div className="max-h-60 overflow-y-auto space-y-2 mb-4 border border-content/10 p-2 rounded">
              {safeUsers.map(user => (
                <label key={userActorId(user)} className="flex items-center gap-2 cursor-pointer hover:bg-content/5 p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={bulkSelectedUsers.includes(userActorId(user))}
                    onChange={() => toggleUserSelection(userActorId(user))}
                    className="w-4 h-4 text-primary rounded focus:ring-primary"
                  />
                  <span className="text-sm">{user.FullName}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsBulkModalOpen(false)} className="px-4 py-2 text-content-secondary hover:bg-content/10 rounded">إلغاء</button>
              <button type="button" onClick={submitBulkAssign} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark shadow-sm">حفظ وتكرار</button>
            </div>
          </div>
        </div>
      )}

      {/* New Task Bulk Modal */}
      {isNewTaskBulkModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-bkg p-6 rounded-lg shadow-lg w-96 max-w-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Users size={20} />
                      إسناد متعدد (مهمة جديدة)
                  </h3>
                  <p className="text-sm text-content-secondary mb-4">
                      اختر الموظفين الذين تريد إسناد المهمة لهم. سيتم إنشاء مهمة فرعية لكل موظف.
                  </p>
                  <div className="max-h-60 overflow-y-auto space-y-2 mb-4 border border-content/10 p-2 rounded">
                        {safeUsers.map(user => (
                          <label key={userActorId(user)} className="flex items-center gap-2 cursor-pointer hover:bg-content/5 p-2 rounded transition-colors">
                              <input 
                                type="checkbox" 
                                checked={newSubtaskBulkUsers.includes(userActorId(user))} 
                                onChange={() => setNewSubtaskBulkUsers(prev => prev.includes(userActorId(user)) ? prev.filter(id => id !== userActorId(user)) : [...prev, userActorId(user)])}
                                className="w-4 h-4 text-primary rounded focus:ring-primary"
                              />
                              <span className="text-sm">{user.FullName}</span>
                          </label>
                      ))}
                  </div>
                  <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setIsNewTaskBulkModalOpen(false); setAssignTo(''); setNewSubtaskBulkUsers([]); }} className="px-4 py-2 text-content-secondary hover:bg-content/10 rounded">إلغاء</button>
                  <button type="button" onClick={() => { setIsNewTaskBulkModalOpen(false); setAssignTo('bulk'); }} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark shadow-sm">تأكيد الاختيار ({newSubtaskBulkUsers.length})</button>
              </div>
              </div>
          </div>
      )}

      {/* نموذج إضافة مهمة فرعية */}
      {canAddSubtasks && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div 
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowSubtaskForm(!showSubtaskForm)}
          >
            <h4 className="font-semibold text-content">إضافة مهمة فرعية جديدة</h4>
            <svg 
              className={`w-5 h-5 text-content transition-transform duration-200 ${showSubtaskForm ? 'rotate-180' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {showSubtaskForm && (
          <form onSubmit={handleAddSubtask} className="mt-3 space-y-2">
            {/* السطر الأول: العنوان + الإسناد */}
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder="عنوان المهمة الفرعية..."
                required
                className="flex-1 min-w-[180px] p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
              <div className="flex gap-1 items-center">
                <select
                  value={assignTo}
                  onChange={e => {
                    if (e.target.value === 'bulk') {
                      setIsNewTaskBulkModalOpen(true);
                      setAssignTo('bulk');
                    } else {
                      setAssignTo(e.target.value);
                    }
                  }}
                  className="p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                >
                  <option value="">إسناد لـ: (نفسي)</option>
                  <option value="bulk" className="font-bold text-primary">👥 إسناد متعدد...</option>
                  {safeUsers.map(user => (
                    <option key={userActorId(user)} value={userActorId(user)}>{user.FullName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setIsNewTaskBulkModalOpen(true); setAssignTo('bulk'); }}
                  className="p-2 bg-primary/10 hover:bg-primary/20 rounded-md text-primary transition-colors flex-shrink-0"
                  title="إسناد متعدد"
                >
                  <Users size={20} />
                </button>
              </div>
            </div>
            {/* السطر الثاني: التواريخ + الوقت + التقويم + الإضافة */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex items-center gap-1">
                <span className="text-xs text-content-secondary whitespace-nowrap">الاستحقاق:</span>
                <input
                  type="date"
                  value={newSubtaskDueDate.split('T')[0]}
                  onChange={(e) => setNewSubtaskDueDate(e.target.value + 'T' + (newSubtaskDueDate.split('T')[1] || '00:00'))}
                  className="p-1.5 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
                />
                {renderTimeSelects(newSubtaskDueDate, setNewSubtaskDueDate)}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-content-secondary whitespace-nowrap opacity-70">الانتهاء:</span>
                <input
                  type="date"
                  value={newSubtaskEndDate}
                  onChange={(e) => setNewSubtaskEndDate(e.target.value)}
                  title="تاريخ الانتهاء (اختياري)"
                  className="p-1.5 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm opacity-70"
                />
              </div>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showInCalendar}
                  onChange={(e) => setShowInCalendar(e.target.checked)}
                />
                إظهار في التقويم
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => setReminderEnabled(e.target.checked)}
                />
                تذكير
              </label>
              {reminderEnabled && (
                <div className="flex items-center gap-1 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={reminderMinutes}
                    onChange={(e) => setReminderMinutes(Math.max(1, parseInt(e.target.value) || 15))}
                    className="w-16 p-1.5 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-center text-sm"
                  />
                  <span className="text-xs text-content-secondary whitespace-nowrap">دقيقة قبل</span>
                </div>
              )}
              <button
                type="submit"
                className="bg-primary text-white px-5 py-1.5 rounded-md hover:bg-primary-dark text-sm"
              >
                إضافة
              </button>
            </div>
          </form>
          )}
        </div>
      )}
      
      {/* نموذج إضافة تعليق */}
      <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
        <div 
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setShowCommentForm(!showCommentForm)}
        >
          <h4 className="font-semibold text-content">إضافة تعليق جديد</h4>
          <svg 
            className={`w-5 h-5 text-content transition-transform duration-200 ${showCommentForm ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        
        {showCommentForm && (
        <form onSubmit={handleCommentSubmit}>
          <div className="mb-3">
            {/* شريط أدوات Markdown */}
            <div className="flex items-center gap-1 mb-1 flex-wrap">
              <button type="button" title="عريض (Bold)" onClick={() => insertMarkdownSyntax('**','**','نص عريض')}
                className="px-2 py-0.5 text-sm font-bold border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">B</button>
              <button type="button" title="مائل (Italic)" onClick={() => insertMarkdownSyntax('*','*','نص مائل')}
                className="px-2 py-0.5 text-sm italic border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">I</button>
              {/* زر تلوين النص */}
              <div className="relative">
                <button type="button" title="تلوين النص"
                  onClick={() => setShowColorPicker(v => !v)}
                  className="px-2 py-0.5 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20 flex items-center gap-1">
                  <span style={{background:'linear-gradient(135deg,#ef4444,#2563eb,#16a34a)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',fontWeight:700}}>A</span>
                  <span className="text-[9px] opacity-60">▼</span>
                </button>
                {showColorPicker && (
                  <div className="absolute top-full right-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-content/20 rounded-lg shadow-lg p-2 flex flex-wrap gap-1.5" style={{width:160}}>
                    {Object.entries(MD_COLORS).map(([key, hex]) => (
                      <button key={key} type="button" title={key}
                        onMouseDown={(e) => { e.preventDefault(); insertColor(key); }}
                        style={{background: hex, width:24, height:24, borderRadius:4, border:'2px solid transparent'}}
                        className="hover:scale-110 transition-transform hover:border-white"
                      />
                    ))}
                    <div className="w-full text-[10px] text-center text-content/50 mt-0.5">اختر لون النص</div>
                  </div>
                )}
              </div>
              <button type="button" title="قائمة نقطية" onClick={() => insertMarkdownSyntax('\n- ','','عنصر')}
                className="px-2 py-0.5 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">• قائمة</button>
              <button type="button" title="إدراج جدول" onClick={insertTableTemplate}
                className="px-2 py-0.5 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">⊞ جدول</button>
              <div className="flex-1" />
              <button type="button" onClick={() => setShowCommentPreview(v => !v)}
                className={`px-2 py-0.5 text-xs border rounded border-content/20 ${showCommentPreview ? 'bg-primary text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                {showCommentPreview ? 'تعديل' : 'معاينة'}
              </button>
            </div>
            {showCommentPreview ? (
              <div
                className="w-full min-h-[80px] p-2 border rounded-md bg-white dark:bg-gray-900 border-content/20 text-content text-sm"
                dir="auto"
                dangerouslySetInnerHTML={{ __html: newComment.trim() ? renderMarkdown(newComment) : '<span style="opacity:0.4">لا يوجد محتوى للمعاينة</span>' }}
              />
            ) : (
              <textarea
                ref={newCommentRef}
                value={newComment}
                onChange={(e) => { setNewComment(e.target.value); autoResize(e.target); }}
                onPaste={handleCommentPaste}
                onFocus={() => setShowColorPicker(false)}
                placeholder="أضف تعليقاً... (يدعم **عريض** *مائل* - قائمة | جدول | — الصق جدول Excel مباشرة)"
                rows={3}
                required
                className="w-full p-2 border rounded-md bg-bkg border-content/20 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 resize-none overflow-hidden font-mono text-sm"
              />
            )}
          </div>
          
          {/* خيار تحديد التاريخ والوقت المخصص مع زر الإرسال */}
          <div className="flex flex-col md:flex-row gap-3 items-start">
            <div className="flex-1 p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="useCustomDateTime"
                  checked={useCustomDateTime}
                  onChange={(e) => setUseCustomDateTime(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="useCustomDateTime" className="text-sm font-medium text-content">
                  تحديد تاريخ ووقت مخصص للتعليق
                </label>
              </div>
              
              {useCustomDateTime && (
                <div className="mt-2">
                  <label className="block text-xs text-content-secondary mb-1">
                    التاريخ والوقت (نظام 24 ساعة):
                  </label>
                  <input
                    type="datetime-local"
                    value={customDateTime}
                    onChange={(e) => setCustomDateTime(e.target.value)}
                    className="w-full p-2 border rounded-md bg-bkg border-content/20 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                  />
                  <p className="text-xs text-content-secondary mt-1">
                    💡 يمكنك اختيار تاريخ سابق لترتيب التعليقات حسب التسلسل الزمني الصحيح
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="checkbox"
                  id="showCommentInCalendar"
                  checked={showCommentInCalendar}
                  onChange={(e) => setShowCommentInCalendar(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="showCommentInCalendar" className="text-sm font-medium text-content">
                  إظهار هذا التعليق في التقويم
                </label>
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isSubmittingComment}
              className="bg-primary text-white px-6 py-2 rounded-md hover:bg-primary-dark disabled:opacity-50 self-start md:self-center h-fit"
            >
              {isSubmittingComment ? 'جاري الإرسال...' : 'إرسال التعليق'}
            </button>
          </div>
        </form>
        )}
      </div>
      
      {/* الجدول الزمني الموحد */}
      <div className="space-y-6">
        {timelineItems.length > 0 ? (
          timelineItems.map((item) => (
            <div key={item.id} className="relative">
              {item.type === 'subtask'
                ? renderSubtaskItem(item.data as Subtask)
                : renderCommentItem(item.data as Comment)
              }
            </div>
          ))
        ) : (
          <p className="text-center text-content-secondary py-8">
            لا توجد مهام فرعية أو تعليقات بعد.
          </p>
        )}
      </div>
    </div>
  );
};

export default UnifiedTimeline;
