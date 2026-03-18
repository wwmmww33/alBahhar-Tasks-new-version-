const sql = require('mssql');
const dbConfig = require('../config/db.config');
const encryptionConfig = require('../config/encryption.config');

async function resolveActorId(pool, rawUserId, prefersVacancy) {
    const loginId = String(rawUserId || '').trim();
    if (!loginId) return '';

    const probe = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
          CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
            CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
            CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable
    `);

    const p = probe.recordset[0] || {};
    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
    if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
    if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);
    const whereClause = whereParts.join(' OR ');

    if (prefersVacancy && p.HasProfileView) {
        const mapped = await pool.request()
            .input('LoginID', sql.NVarChar, loginId)
            .query(`
                SELECT TOP 1 u.UserID, p.VacancyID
                FROM dbo.Users u
                LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
                WHERE ${whereClause}
            `);
        const row = mapped.recordset[0];
        if (!row) return loginId;
        if (row.VacancyID != null && String(row.VacancyID).trim() !== '') {
            return String(row.VacancyID).trim();
        }

        if (p.HasAssignmentsTable) {
            const latestAssignment = await pool.request()
                .input('UserID', sql.NVarChar, String(row.UserID || loginId).trim())
                .query(`
                    SELECT TOP 1 VacancyID
                    FROM dbo.Assignments
                    WHERE UserID = @UserID
                      AND VacancyID IS NOT NULL
                    ORDER BY
                      CASE WHEN IsCurrent = 1 THEN 0 ELSE 1 END,
                      ISNULL(StartDate, '1900-01-01') DESC,
                      AssignmentID DESC
                `);

            const fallbackVacancyId = latestAssignment.recordset[0]?.VacancyID;
            if (fallbackVacancyId != null && String(fallbackVacancyId).trim() !== '') {
                return String(fallbackVacancyId).trim();
            }
        }

        return String(row.UserID).trim();
    }

    const mapped = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`SELECT TOP 1 u.UserID FROM dbo.Users u WHERE ${whereClause}`);
    return String(mapped.recordset[0]?.UserID || loginId).trim();
}

// جلب إشعارات التعليقات للمستخدم
const getCommentNotifications = async (req, res) => {
    try {
        const { userId } = req.params;
        const { unreadOnly = false } = req.query;
        
        const pool = await sql.connect(dbConfig);
        const schema = await pool.request().query(`
            SELECT
              CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyVacancy,
              CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy
        `);
        const s = schema.recordset[0] || {};
        const notifyCol = s.HasNotifyVacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const commentedByCol = s.HasCommentedByVacancy ? 'CommentedByVacancyID' : 'CommentedByUserID';
        const identityTable = s.HasCommentedByVacancy ? 'JobVacancies' : 'Users';
        const identityKey = s.HasCommentedByVacancy ? 'VacancyID' : 'UserID';
        const identityName = s.HasCommentedByVacancy ? 'Name' : 'FullName';
        const actorId = await resolveActorId(pool, userId, !!s.HasNotifyVacancy);
        
        let query = `
            SELECT 
                cn.NotificationID,
                cn.CommentID,
                cn.TaskID,
                cn.${commentedByCol} as CommentedByUserID,
                cn.${notifyCol} as NotifyUserID,
                cn.NotificationType,
                cn.IsRead,
                cn.CreatedAt,
                cn.ReadAt,
                c.Content as CommentContent,
                t.Title as TaskTitle,
                COALESCE(u.${identityName}, CAST(cn.${commentedByCol} AS NVARCHAR(50))) as CommentedByUsername
            FROM CommentNotifications cn
            INNER JOIN Comments c ON cn.CommentID = c.CommentID
            INNER JOIN Tasks t ON cn.TaskID = t.TaskID
            LEFT JOIN ${identityTable} u ON cn.${commentedByCol} = u.${identityKey}
            WHERE cn.${notifyCol} = @userId
        `;
        
        if (unreadOnly === 'true') {
            query += ' AND cn.IsRead = 0';
        }
        
        query += ' ORDER BY cn.CreatedAt DESC';
        
        const request = pool.request();
        request.input('userId', sql.NVarChar, actorId);
        
        const result = await request.query(query);
        const notifications = result.recordset.map(n => {
            if (n.TaskTitle) {
                try { n.TaskTitle = encryptionConfig.decrypt(n.TaskTitle); } catch (e) {}
            }
            if (n.CommentContent) {
                try { n.CommentContent = encryptionConfig.decrypt(n.CommentContent); } catch (e) {}
            }
            return n;
        });
        
        res.json({
            success: true,
            notifications
        });
        
    } catch (error) {
        console.error('خطأ في جلب إشعارات التعليقات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب إشعارات التعليقات',
            error: error.message
        });
    }
};

// عدد الإشعارات غير المقروءة
const getUnreadNotificationsCount = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const pool = await sql.connect(dbConfig);
        const schema = await pool.request().query(`
            SELECT CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyVacancy
        `);
        const notifyCol = schema.recordset[0]?.HasNotifyVacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const actorId = await resolveActorId(pool, userId, !!schema.recordset[0]?.HasNotifyVacancy);
        const request = pool.request();
        request.input('userId', sql.NVarChar, actorId);
        
        const result = await request.query(`
            SELECT COUNT(*) as UnreadCount
            FROM CommentNotifications
            WHERE ${notifyCol} = @userId AND IsRead = 0
        `);
        
        res.json({
            success: true,
            unreadCount: result.recordset[0].UnreadCount
        });
        
    } catch (error) {
        console.error('خطأ في جلب عدد الإشعارات غير المقروءة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب عدد الإشعارات غير المقروءة',
            error: error.message
        });
    }
};

// تحديد الإشعار كمقروء
const markNotificationAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        const pool = await sql.connect(dbConfig);
        const request = pool.request();
        request.input('notificationId', sql.Int, notificationId);
        
        await request.query(`
            UPDATE CommentNotifications 
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE NotificationID = @notificationId
        `);
        
        res.json({
            success: true,
            message: 'تم تحديد الإشعار كمقروء'
        });
        
    } catch (error) {
        console.error('خطأ في تحديد الإشعار كمقروء:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تحديد الإشعار كمقروء',
            error: error.message
        });
    }
};

// تحديد جميع الإشعارات كمقروءة
const markAllNotificationsAsRead = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const pool = await sql.connect(dbConfig);
        const schema = await pool.request().query(`
            SELECT CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyVacancy
        `);
        const notifyCol = schema.recordset[0]?.HasNotifyVacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const actorId = await resolveActorId(pool, userId, !!schema.recordset[0]?.HasNotifyVacancy);
        const request = pool.request();
        request.input('userId', sql.NVarChar, actorId);
        
        await request.query(`
            UPDATE CommentNotifications 
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE ${notifyCol} = @userId AND IsRead = 0
        `);
        
        res.json({
            success: true,
            message: 'تم تحديد جميع الإشعارات كمقروءة'
        });
        
    } catch (error) {
        console.error('خطأ في تحديد جميع الإشعارات كمقروءة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تحديد جميع الإشعارات كمقروءة',
            error: error.message
        });
    }
};

// عدد الإشعارات غير المقروءة لمهمة معينة
const getUnreadNotificationsCountForTask = async (req, res) => {
    try {
        const { taskId, userId } = req.params;
        
        const pool = await sql.connect(dbConfig);
        const schema = await pool.request().query(`
            SELECT CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyVacancy
        `);
        const notifyCol = schema.recordset[0]?.HasNotifyVacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const actorId = await resolveActorId(pool, userId, !!schema.recordset[0]?.HasNotifyVacancy);
        const request = pool.request();
        request.input('taskId', sql.Int, taskId);
        request.input('userId', sql.NVarChar, actorId);
        
        const result = await request.query(`
            SELECT COUNT(*) as count
            FROM CommentNotifications
            WHERE TaskID = @taskId AND ${notifyCol} = @userId AND IsRead = 0
        `);
        
        res.json({
            success: true,
            count: result.recordset[0].count
        });
        
    } catch (error) {
        console.error('خطأ في جلب عدد إشعارات التعليقات للمهمة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب عدد إشعارات التعليقات للمهمة',
            error: error.message
        });
    }
};

// تحديد جميع إشعارات التعليقات كمقروءة لمهمة معينة ومستخدم معين
const markTaskCommentNotificationsAsRead = async (req, res) => {
    try {
        const { taskId, userId } = req.params;
        
        const pool = await sql.connect(dbConfig);
        const schema = await pool.request().query(`
            SELECT CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyVacancy
        `);
        const notifyCol = schema.recordset[0]?.HasNotifyVacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const actorId = await resolveActorId(pool, userId, !!schema.recordset[0]?.HasNotifyVacancy);
        const request = pool.request();
        request.input('taskId', sql.Int, taskId);
        request.input('userId', sql.NVarChar, actorId);
        
        const result = await request.query(`
            UPDATE CommentNotifications 
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE TaskID = @taskId AND ${notifyCol} = @userId AND IsRead = 0
        `);
        
        res.json({
            success: true,
            message: 'تم تحديث إشعارات التعليقات كمقروءة بنجاح',
            updatedCount: result.rowsAffected[0]
        });
        
    } catch (error) {
        console.error('خطأ في تحديث إشعارات التعليقات للمهمة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تحديث إشعارات التعليقات للمهمة',
            error: error.message
        });
    }
};

module.exports = {
    getCommentNotifications,
    getUnreadNotificationsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    getUnreadNotificationsCountForTask,
    markTaskCommentNotificationsAsRead
};
