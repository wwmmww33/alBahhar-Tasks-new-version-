// myNotificationsController.js
// Unified endpoint: merges CommentNotifications + TaskAssignmentNotifications

const sql = require('mssql');
const dbConfig = require('../config/db.config');
const encryptionConfig = require('../config/encryption.config');

function getActorId(req, hasVacancy) {
    if (hasVacancy && req.user.vacancyId != null && String(req.user.vacancyId).trim() !== '') {
        return String(req.user.vacancyId).trim();
    }
    return String(req.user.userId).trim();
}

async function probeSchema(pool) {
    const res = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.CommentNotifications','NotifyVacancyID')              IS NOT NULL THEN 1 ELSE 0 END AS HasCN_Vacancy,
          CASE WHEN COL_LENGTH('dbo.CommentNotifications','CommentedByVacancyID')          IS NOT NULL THEN 1 ELSE 0 END AS HasCN_ByVacancy,
          CASE WHEN OBJECT_ID('dbo.TaskAssignmentNotifications','U')                       IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_Table,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedToVacancyID')    IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_ToVacancy,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedToUserID')       IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_ToUser,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedByVacancyID')    IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_ByVacancy,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedByUserID')       IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_ByUser,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','IsRead')                 IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_IsRead,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','CreatedAt')              IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_CreatedAt,
          CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','NotificationID')         IS NOT NULL THEN 1 ELSE 0 END AS HasTAN_NotifID
    `);
    return res.recordset[0] || {};
}

// GET /api/my-notifications/unread-count
const getUnreadCount = async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const s = await probeSchema(pool);

        const cnCol     = s.HasCN_Vacancy   ? 'NotifyVacancyID'     : 'NotifyUserID';
        const cnActor   = getActorId(req, !!s.HasCN_Vacancy);

        const cnRes = await pool.request()
            .input('a', sql.NVarChar, cnActor)
            .query(`SELECT COUNT(*) as cnt FROM CommentNotifications WHERE ${cnCol} = @a AND IsRead = 0`);
        let total = cnRes.recordset[0]?.cnt || 0;

        if (s.HasTAN_Table && s.HasTAN_IsRead) {
            const tanCol   = s.HasTAN_ToVacancy ? 'AssignedToVacancyID' : (s.HasTAN_ToUser ? 'AssignedToUserID' : null);
            if (tanCol) {
                const tanActor = getActorId(req, !!s.HasTAN_ToVacancy);
                const tanRes = await pool.request()
                    .input('a', sql.NVarChar, tanActor)
                    .query(`SELECT COUNT(*) as cnt FROM TaskAssignmentNotifications WHERE ${tanCol} = @a AND IsRead = 0`);
                total += tanRes.recordset[0]?.cnt || 0;
            }
        }

        res.json({ success: true, unreadCount: total });
    } catch (err) {
        console.error('getUnreadCount error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب عدد الإشعارات' });
    }
};

// GET /api/my-notifications?unreadOnly=true|false
const getNotifications = async (req, res) => {
    try {
        const onlyUnread = req.query.unreadOnly === 'true';
        const pool = await sql.connect(dbConfig);
        const s = await probeSchema(pool);

        const notifications = [];

        // ── 1. Comment notifications ──────────────────────────────────────────
        const cnNotifyCol   = s.HasCN_Vacancy   ? 'NotifyVacancyID'    : 'NotifyUserID';
        const cnByCol       = s.HasCN_ByVacancy ? 'CommentedByVacancyID' : 'CommentedByUserID';
        const cnIdTable     = s.HasCN_ByVacancy ? 'JobVacancies'       : 'Users';
        const cnIdKey       = s.HasCN_ByVacancy ? 'VacancyID'          : 'UserID';
        const cnIdName      = s.HasCN_ByVacancy ? 'Name'               : 'FullName';
        const cnActor       = getActorId(req, !!s.HasCN_Vacancy);

        const cnRows = await pool.request()
            .input('a', sql.NVarChar, cnActor)
            .query(`
                SELECT cn.NotificationID, cn.TaskID, cn.IsRead, cn.CreatedAt,
                       cn.${cnByCol} as ByID,
                       c.Content as CommentContent,
                       t.Title   as TaskTitle,
                       COALESCE(u.${cnIdName}, CAST(cn.${cnByCol} AS NVARCHAR(100))) as ActorName
                FROM   CommentNotifications cn
                INNER JOIN Comments c ON cn.CommentID = c.CommentID
                INNER JOIN Tasks    t ON cn.TaskID    = t.TaskID
                LEFT  JOIN ${cnIdTable} u ON cn.${cnByCol} = u.${cnIdKey}
                WHERE  cn.${cnNotifyCol} = @a
                ${onlyUnread ? 'AND cn.IsRead = 0' : ''}
                ORDER BY cn.CreatedAt DESC
            `);

        for (const r of cnRows.recordset) {
            let title   = r.TaskTitle;
            let content = r.CommentContent;
            try { title   = encryptionConfig.decrypt(title);   } catch {}
            try { content = encryptionConfig.decrypt(content); } catch {}
            notifications.push({
                NotificationID: `cn_${r.NotificationID}`,
                Type: 'comment',
                TaskID: r.TaskID,
                TaskTitle: title || `مهمة #${r.TaskID}`,
                ActorName: r.ActorName || '—',
                Content: content || '',
                IsRead: !!r.IsRead,
                CreatedAt: r.CreatedAt,
            });
        }

        // ── 2. Subtask assignment notifications ───────────────────────────────
        if (s.HasTAN_Table && s.HasTAN_IsRead) {
            const tanToCol  = s.HasTAN_ToVacancy ? 'AssignedToVacancyID'  : (s.HasTAN_ToUser ? 'AssignedToUserID'  : null);
            const tanByCol  = s.HasTAN_ByVacancy ? 'AssignedByVacancyID'  : (s.HasTAN_ByUser ? 'AssignedByUserID'  : null);
            const tanByTbl  = s.HasTAN_ByVacancy ? 'JobVacancies'         : 'Users';
            const tanByKey  = s.HasTAN_ByVacancy ? 'VacancyID'            : 'UserID';
            const tanByName = s.HasTAN_ByVacancy ? 'Name'                 : 'FullName';
            const tanIdCol  = s.HasTAN_NotifID   ? 'tan.NotificationID'   : 'CAST(tan.TaskID AS NVARCHAR(50))';
            const tanDateCol= s.HasTAN_CreatedAt  ? 'tan.CreatedAt'        : 'GETDATE()';

            if (tanToCol) {
                const tanActor = getActorId(req, !!s.HasTAN_ToVacancy);

                const tanRows = await pool.request()
                    .input('a', sql.NVarChar, tanActor)
                    .query(`
                        SELECT ${tanIdCol} as NotifID,
                               tan.TaskID,
                               tan.IsRead,
                               ${tanDateCol} as CreatedAt,
                               t.Title as TaskTitle,
                               ${tanByCol
                                   ? `COALESCE(u.${tanByName}, CAST(tan.${tanByCol} AS NVARCHAR(100)))`
                                   : `N'غير معروف'`
                               } as ActorName
                        FROM   TaskAssignmentNotifications tan
                        INNER JOIN Tasks t ON tan.TaskID = t.TaskID
                        ${tanByCol ? `LEFT JOIN ${tanByTbl} u ON tan.${tanByCol} = u.${tanByKey}` : ''}
                        WHERE  tan.${tanToCol} = @a
                        ${onlyUnread ? 'AND tan.IsRead = 0' : ''}
                        ORDER BY ${tanDateCol} DESC
                    `);

                for (const r of tanRows.recordset) {
                    let title = r.TaskTitle;
                    try { title = encryptionConfig.decrypt(title); } catch {}
                    notifications.push({
                        NotificationID: `ta_${r.NotifID}`,
                        Type: 'subtask_assignment',
                        TaskID: r.TaskID,
                        TaskTitle: title || `مهمة #${r.TaskID}`,
                        ActorName: r.ActorName || '—',
                        Content: '',
                        IsRead: !!r.IsRead,
                        CreatedAt: r.CreatedAt,
                    });
                }
            }
        }

        // Sort merged list by CreatedAt desc
        notifications.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

        res.json({ success: true, notifications: notifications.slice(0, 50) });
    } catch (err) {
        console.error('getNotifications error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب الإشعارات' });
    }
};

// PUT /api/my-notifications/mark-all-read
const markAllAsRead = async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const s = await probeSchema(pool);

        // Comment notifications
        const cnCol   = s.HasCN_Vacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const cnActor = getActorId(req, !!s.HasCN_Vacancy);
        await pool.request()
            .input('a', sql.NVarChar, cnActor)
            .query(`UPDATE CommentNotifications SET IsRead = 1, ReadAt = GETDATE() WHERE ${cnCol} = @a AND IsRead = 0`);

        // Task assignment notifications
        if (s.HasTAN_Table && s.HasTAN_IsRead) {
            const tanCol   = s.HasTAN_ToVacancy ? 'AssignedToVacancyID' : (s.HasTAN_ToUser ? 'AssignedToUserID' : null);
            if (tanCol) {
                const tanActor = getActorId(req, !!s.HasTAN_ToVacancy);
                await pool.request()
                    .input('a', sql.NVarChar, tanActor)
                    .query(`UPDATE TaskAssignmentNotifications SET IsRead = 1 WHERE ${tanCol} = @a AND IsRead = 0`);
            }
        }

        res.json({ success: true, message: 'تم تعليم جميع الإشعارات كمقروءة' });
    } catch (err) {
        console.error('markAllAsRead error:', err);
        res.status(500).json({ success: false, message: 'خطأ في تحديث الإشعارات' });
    }
};

// PUT /api/my-notifications/:id/read   (id: "cn_123" | "ta_456")
const markOneAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const pool   = await sql.connect(dbConfig);

        if (id.startsWith('cn_')) {
            const rawId = parseInt(id.slice(3), 10);
            await pool.request()
                .input('id', sql.Int, rawId)
                .query(`UPDATE CommentNotifications SET IsRead = 1, ReadAt = GETDATE() WHERE NotificationID = @id`);
        } else if (id.startsWith('ta_')) {
            const rawId = id.slice(3);
            const s = await probeSchema(pool);
            if (s.HasTAN_IsRead && s.HasTAN_NotifID) {
                await pool.request()
                    .input('id', sql.Int, parseInt(rawId, 10))
                    .query(`UPDATE TaskAssignmentNotifications SET IsRead = 1 WHERE NotificationID = @id`);
            } else if (s.HasTAN_IsRead) {
                // Fallback: mark by TaskID for this user
                const tanCol   = s.HasTAN_ToVacancy ? 'AssignedToVacancyID' : 'AssignedToUserID';
                const tanActor = getActorId(req, !!s.HasTAN_ToVacancy);
                await pool.request()
                    .input('taskId', sql.Int, parseInt(rawId, 10))
                    .input('a', sql.NVarChar, tanActor)
                    .query(`UPDATE TaskAssignmentNotifications SET IsRead = 1 WHERE TaskID = @taskId AND ${tanCol} = @a AND IsRead = 0`);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('markOneAsRead error:', err);
        res.status(500).json({ success: false, message: 'خطأ في تحديث الإشعار' });
    }
};

module.exports = { getUnreadCount, getNotifications, markAllAsRead, markOneAsRead };
