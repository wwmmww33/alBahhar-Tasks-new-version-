// src/controllers/publicController.js
// نقاط وصول عامة بلا مصادقة إطلاقاً — التقويم العام في صفحة الدخول. تعرض فقط العناصر التي
// حدَّدها مدير القسم المستقل (أو المفوَّض له) صراحة كـ"بث مفتوح" (IsPublicBroadcast)، وهو علم
// مستقل تماماً عن مستوى البث الداخلي بين الأقسام. لا تُكشف هوية المُسنَد إليه أو صاحب التعليق
// أبداً هنا — العنوان/المحتوى والتوقيت فقط.
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { getPublicCalendarSettings } = require('../utils/departmentSharing');

const MAX_EVENTS = 300;

// GET /api/public/calendar — بلا مصادقة. يُرجع { enabled, title, events } دوماً؛ events=[] إذا
// كان التقويم العام موقوفاً من المدير العام، حتى لو وُجدت عناصر عليها بث مفتوح.
exports.getPublicCalendar = async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { enabled, title } = await getPublicCalendarSettings(pool);
    if (!enabled) {
      return res.status(200).json({ enabled: false, title, events: [] });
    }

    const colProbe = await pool.request().query(`
      SELECT
        COL_LENGTH('dbo.Subtasks','IsPublicBroadcast') AS SubtaskLen,
        COL_LENGTH('dbo.Comments','IsPublicBroadcast') AS CommentLen,
        COL_LENGTH('dbo.Comments','CalendarDisplayDate') AS CalDisplayDateLen
    `);
    const p = colProbe.recordset[0] || {};

    const events = [];

    if (p.SubtaskLen) {
      const subtaskResult = await pool.request().query(`
        SELECT TOP (${MAX_EVENTS}) s.SubtaskID, s.Title, s.DueDate, s.EndDate, t.Title AS TaskTitle
        FROM dbo.Subtasks s
        INNER JOIN dbo.Tasks t ON t.TaskID = s.TaskID
        WHERE s.ShowInCalendar = 1 AND s.IsPublicBroadcast = 1 AND t.PersonalOwnerUserID IS NULL
        ORDER BY s.DueDate ASC
      `);
      for (const row of subtaskResult.recordset) {
        let title = row.Title;
        let taskTitle = row.TaskTitle;
        try { title = encryptionConfig.decrypt(title); } catch (_) {}
        try { taskTitle = encryptionConfig.decrypt(taskTitle); } catch (_) {}
        events.push({
          type: 'subtask',
          id: row.SubtaskID,
          title,
          taskTitle,
          startDate: row.DueDate,
          endDate: row.EndDate,
        });
      }
    }

    if (p.CommentLen) {
      const commentDateExpr = p.CalDisplayDateLen ? 'COALESCE(c.CalendarDisplayDate, c.CreatedAt)' : 'c.CreatedAt';
      const commentResult = await pool.request().query(`
        SELECT TOP (${MAX_EVENTS}) c.CommentID, c.Content, ${commentDateExpr} AS EventDate, t.Title AS TaskTitle
        FROM dbo.Comments c
        INNER JOIN dbo.Tasks t ON t.TaskID = c.TaskID
        WHERE c.ShowInCalendar = 1 AND c.IsPublicBroadcast = 1 AND t.PersonalOwnerUserID IS NULL
        ORDER BY ${commentDateExpr} ASC
      `);
      for (const row of commentResult.recordset) {
        let content = row.Content;
        let taskTitle = row.TaskTitle;
        try { content = encryptionConfig.decrypt(content); } catch (_) {}
        try { taskTitle = encryptionConfig.decrypt(taskTitle); } catch (_) {}
        events.push({
          type: 'comment',
          id: row.CommentID,
          title: content,
          taskTitle,
          startDate: row.EventDate,
          endDate: null,
        });
      }
    }

    events.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    res.status(200).json({ enabled: true, title, events: events.slice(0, MAX_EVENTS) });
  } catch (err) {
    console.error('GET PUBLIC CALENDAR ERROR:', err);
    // دفاعياً: لا نكشف تفاصيل الخطأ لزائر غير مسجّل، ونعيد تقويماً فارغاً بدل خطأ 500 ظاهر
    res.status(200).json({ enabled: false, title: 'التقويم العام', events: [] });
  }
};
