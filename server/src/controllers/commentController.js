// src/controllers/commentController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { hasActiveDelegation, checkTaskAccess } = require('../utils/delegationUtils');

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

        return String(row.UserID || loginId).trim();
    }

    const mapped = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`
            SELECT TOP 1 u.UserID
            FROM dbo.Users u
            WHERE ${whereClause}
        `);

    return String(mapped.recordset[0]?.UserID || loginId).trim();
}

async function resolveActorCandidates(pool, rawUserId) {
    const loginId = String(rawUserId || '').trim();
    const candidates = new Set();
    if (!loginId) return candidates;
    candidates.add(loginId);

    const probe = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
          CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
            CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
            CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable
    `);

    const p = probe.recordset[0] || {};
    const selectCols = ['u.UserID'];
    if (p.HasLegacyUserID) selectCols.push('u.LegacyUserID');
    if (p.HasServiceID) selectCols.push('u.ServiceID');
    if (p.HasProfileView) selectCols.push('p.VacancyID');

    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
    if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
    if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);

    const mapped = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`
            SELECT TOP 1 ${selectCols.join(', ')}
            FROM dbo.Users u
            ${p.HasProfileView ? 'LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID' : ''}
            WHERE (${whereParts.join(' OR ')})
              ${p.HasProfileView ? 'OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT))' : ''}
                            ${p.HasAssignmentsTable ? 'OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Assignments a WHERE a.UserID = u.UserID AND a.VacancyID = TRY_CAST(@LoginID AS INT)))' : ''}
        `);

    const row = mapped.recordset[0] || {};
    for (const value of Object.values(row)) {
        if (value != null && String(value).trim() !== '') {
            candidates.add(String(value).trim());
        }
    }

    const mappedUserId = row.UserID != null ? String(row.UserID).trim() : '';
    if (p.HasAssignmentsTable && mappedUserId) {
        const assignmentRows = await pool.request()
            .input('UserID', sql.NVarChar, mappedUserId)
            .query(`
                SELECT TOP 5 VacancyID
                FROM dbo.Assignments
                WHERE UserID = @UserID
                  AND VacancyID IS NOT NULL
                ORDER BY
                  CASE WHEN IsCurrent = 1 THEN 0 ELSE 1 END,
                  ISNULL(StartDate, '1900-01-01') DESC,
                  AssignmentID DESC
            `);

        for (const assignment of assignmentRows.recordset || []) {
            if (assignment.VacancyID != null && String(assignment.VacancyID).trim() !== '') {
                candidates.add(String(assignment.VacancyID).trim());
            }
        }
    }

    return candidates;
}

function hasCommentOwnership(existingComment, actorCandidates) {
    if (!existingComment || !actorCandidates || actorCandidates.size === 0) return false;

    const ownerFields = [
        existingComment.UserID,
        existingComment.CommentedByVacancyID,
        existingComment.CommentedByUserID,
        existingComment.ActedBy,
        existingComment.LastActedByVacancyID,
    ];

    return ownerFields.some((value) => value != null && actorCandidates.has(String(value).trim()));
}

exports.createComment = async (req, res) => {
    const pool = req.app.locals.db;
    const { TaskID, UserID, ActedBy, Content, CreatedAt, ShowInCalendar, isAdmin } = req.body;

    if (!TaskID || !UserID || !Content) {
        return res.status(400).json({ message: 'TaskID, UserID, and Content are required.' });
    }

    try {
        const schemaProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByUser,
                CASE WHEN COL_LENGTH('dbo.Comments', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentActedBy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentLastActedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'ShowInCalendar') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentShowInCalendar,
                CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyVacancy,
                CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifyUser,
                CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'CommentedByUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifCommentedByUser,
                CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskCreatedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskCreatedByUser
        `);
        const schema = schemaProbe.recordset[0] || {};
        const commentActorCol = schema.HasCommentedByVacancy ? 'CommentedByVacancyID' : (schema.HasCommentedByUser ? 'UserID' : null);
        if (!commentActorCol) {
            return res.status(500).json({ message: 'No supported actor column found in Comments table.' });
        }

        const actorIdForRequest = String(UserID || '').trim();
        if (!actorIdForRequest) {
            return res.status(400).json({ message: 'Unable to resolve user identity for comment creation.' });
        }

        const actorIdForStorage = await resolveActorId(pool, actorIdForRequest, !!schema.HasCommentedByVacancy);
        if (!actorIdForStorage) {
            return res.status(400).json({ message: 'Unable to resolve actor for comment storage.' });
        }

        const accessCheck = await checkTaskAccess(pool, TaskID, actorIdForRequest, isAdmin === true || isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية إضافة تعليق على هذه المهمة.' });
        }

        // استخدام التاريخ المخصص إذا تم تمريره، وإلا استخدام التوقيت الحالي
        const commentCreatedAt = CreatedAt ? new Date(CreatedAt) : new Date();
        
        // التحقق من صحة التاريخ المخصص
        if (CreatedAt && isNaN(commentCreatedAt.getTime())) {
            return res.status(400).json({ message: 'Invalid CreatedAt date format.' });
        }

        let actorUserId = null;
        if (ActedBy && ActedBy !== UserID) {
            try {
                const taskOwnerRes = await pool.request()
                    .input('TaskID', sql.Int, TaskID)
                    .query('SELECT TOP(1) CreatedBy FROM Tasks WHERE TaskID = @TaskID');
                const delegatorId = taskOwnerRes.recordset[0]?.CreatedBy || null;
                if (delegatorId) {
                    const active = await hasActiveDelegation(pool, delegatorId, ActedBy);
                    if (active) {
                        actorUserId = ActedBy;
                    }
                }
            } catch (_) {
                actorUserId = null;
            }
        }

        // إدراج التعليق بدون OUTPUT clause لتجنب تعارض مع trigger
        const insertRequest = pool.request()
            .input('TaskID', sql.Int, TaskID)
            .input('ActorID', sql.NVarChar, actorIdForStorage)
            .input('Content', sql.NVarChar, encryptionConfig.encrypt(Content))
            .input('CreatedAt', sql.DateTime, commentCreatedAt);

        const insertColumns = ['TaskID', commentActorCol, 'Content', 'CreatedAt'];
        const insertValues = ['@TaskID', '@ActorID', '@Content', '@CreatedAt'];

        if (schema.HasCommentActedBy) {
            insertRequest.input('ActedBy', sql.NVarChar, actorUserId);
            insertColumns.push('ActedBy');
            insertValues.push('@ActedBy');
        }

        if (schema.HasCommentLastActedByVacancy) {
            insertRequest.input('LastActedByVacancyID', sql.NVarChar, actorUserId || actorIdForStorage);
            insertColumns.push('LastActedByVacancyID');
            insertValues.push('@LastActedByVacancyID');
        }

        if (schema.HasCommentShowInCalendar) {
            insertRequest.input('ShowInCalendar', sql.Bit, ShowInCalendar ? 1 : 0);
            insertColumns.push('ShowInCalendar');
            insertValues.push('@ShowInCalendar');
        }

        await insertRequest.query(`
            INSERT INTO Comments (${insertColumns.join(', ')})
            VALUES (${insertValues.join(', ')});
        `);
        
        // جلب التعليق المضاف حديثاً
        const result = await pool.request()
            .input('TaskID2', sql.Int, TaskID)
            .input('ActorID2', sql.NVarChar, actorIdForStorage)
            .input('CreatedAt2', sql.DateTime, commentCreatedAt)
            .query(`
                SELECT TOP 1 * FROM Comments 
                WHERE TaskID = @TaskID2 AND ${commentActorCol} = @ActorID2 AND CreatedAt = @CreatedAt2
                ORDER BY CommentID DESC;
            `);
        
        const newComment = result.recordset[0];
        if (!newComment) {
            return res.status(500).json({ message: 'Comment created but retrieval failed. Please refresh and retry.' });
        }
        if (newComment && newComment.Content) {
            try { newComment.Content = encryptionConfig.decrypt(newComment.Content); } catch (e) {}
        }
        // إنشاء إشعار احتياطي بسيط (لمنشئ المهمة) دون كسر حفظ التعليق عند اختلاف schema
        try {
            const notifCommentedByCol = schema.HasNotifCommentedByVacancy ? 'CommentedByVacancyID' : (schema.HasNotifCommentedByUser ? 'CommentedByUserID' : null);
            const notifNotifyCol = schema.HasNotifyVacancy ? 'NotifyVacancyID' : (schema.HasNotifyUser ? 'NotifyUserID' : null);
            const taskCreatorCol = schema.HasTaskCreatedByVacancy ? 'CreatedByVacancyID' : (schema.HasTaskCreatedByUser ? 'CreatedBy' : null);

            if (notifCommentedByCol && notifNotifyCol && taskCreatorCol) {
                const commentedByActorId = newComment[commentActorCol] != null
                    ? String(newComment[commentActorCol]).trim()
                    : actorIdForStorage;

                // إشعار منشئ المهمة
                await pool.request()
                    .input('CommentID', sql.Int, newComment.CommentID)
                    .input('TaskID', sql.Int, newComment.TaskID)
                    .input('CommentedByActorID', sql.NVarChar, commentedByActorId)
                    .input('CreatedAt', sql.DateTime, newComment.CreatedAt)
                    .query(`
                        INSERT INTO CommentNotifications (CommentID, TaskID, ${notifCommentedByCol}, ${notifNotifyCol}, NotificationType, IsRead, CreatedAt)
                        SELECT @CommentID, @TaskID, @CommentedByActorID, t.${taskCreatorCol}, 'task_creator', 0, @CreatedAt
                        FROM Tasks t
                        WHERE t.TaskID = @TaskID
                          AND t.${taskCreatorCol} IS NOT NULL
                          AND LTRIM(RTRIM(CAST(t.${taskCreatorCol} AS NVARCHAR(255)))) <> @CommentedByActorID
                          AND NOT EXISTS (
                              SELECT 1 FROM CommentNotifications cn
                              WHERE cn.CommentID = @CommentID
                                AND LTRIM(RTRIM(CAST(cn.${notifNotifyCol} AS NVARCHAR(255)))) = LTRIM(RTRIM(CAST(t.${taskCreatorCol} AS NVARCHAR(255))))
                          );
                    `);

                // إشعار جميع المسندة إليهم مهام فرعية في هذه المهمة
                const subtaskAssigneeCol = schema.HasNotifyVacancy
                    ? (await pool.request().query(`SELECT CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasV`)).recordset[0]?.HasV
                        ? 'AssignedToVacancyID' : 'AssignedTo'
                    : 'AssignedTo';

                await pool.request()
                    .input('CommentID2', sql.Int, newComment.CommentID)
                    .input('TaskID2', sql.Int, newComment.TaskID)
                    .input('CommentedByActorID2', sql.NVarChar, commentedByActorId)
                    .input('CreatedAt2', sql.DateTime, newComment.CreatedAt)
                    .query(`
                        INSERT INTO CommentNotifications (CommentID, TaskID, ${notifCommentedByCol}, ${notifNotifyCol}, NotificationType, IsRead, CreatedAt)
                        SELECT DISTINCT @CommentID2, @TaskID2, @CommentedByActorID2,
                               CAST(s.${subtaskAssigneeCol} AS NVARCHAR(255)),
                               'subtask_assignee', 0, @CreatedAt2
                        FROM Subtasks s
                        WHERE s.TaskID = @TaskID2
                          AND s.${subtaskAssigneeCol} IS NOT NULL
                          AND LTRIM(RTRIM(CAST(s.${subtaskAssigneeCol} AS NVARCHAR(255)))) <> @CommentedByActorID2
                          AND NOT EXISTS (
                              SELECT 1 FROM CommentNotifications cn
                              WHERE cn.CommentID = @CommentID2
                                AND LTRIM(RTRIM(CAST(cn.${notifNotifyCol} AS NVARCHAR(255)))) = LTRIM(RTRIM(CAST(s.${subtaskAssigneeCol} AS NVARCHAR(255))))
                          );
                    `);
            }
        } catch (notifError) {
            console.warn('Comment notification fallback skipped due to schema/runtime mismatch:', notifError.message || notifError);
        }
        res.status(201).json(newComment);
    } catch (error) {
        console.error("CREATE COMMENT ERROR:", error);
        res.status(500).send({ message: 'Error creating comment' });
    }
};

exports.updateComment = async (req, res) => {
    const pool = req.app.locals.db;
    const { commentId } = req.params;
    const { Content, UserID, ShowInCalendar, isAdmin } = req.body || {};

    if (!commentId || !UserID) {
        return res.status(400).json({ message: 'commentId and UserID are required.' });
    }

    if (typeof Content === 'undefined' && typeof ShowInCalendar === 'undefined') {
        return res.status(400).json({ message: 'Nothing to update. Provide Content and/or ShowInCalendar.' });
    }

    try {
        const schemaProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Comments', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByUser,
                CASE WHEN COL_LENGTH('dbo.Comments', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'ShowInCalendar') IS NOT NULL THEN 1 ELSE 0 END AS HasShowInCalendar
        `);
        const schema = schemaProbe.recordset[0] || {};

        const existingResult = await pool.request()
            .input('CommentID', sql.Int, commentId)
            .query(`
                SELECT TOP 1
                    CommentID,
                    TaskID,
                    ${schema.HasUserID ? 'UserID' : 'CAST(NULL AS NVARCHAR(255)) AS UserID'},
                    ActedBy,
                    ${schema.HasCommentedByVacancy ? 'CommentedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS CommentedByVacancyID'},
                    ${schema.HasCommentedByUser ? 'CommentedByUserID' : 'CAST(NULL AS NVARCHAR(255)) AS CommentedByUserID'},
                    ${schema.HasLastActedByVacancy ? 'LastActedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS LastActedByVacancyID'}
                FROM Comments
                WHERE CommentID = @CommentID
            `);

        if (!existingResult.recordset.length) {
            return res.status(404).json({ message: 'Comment not found.' });
        }

        const existing = existingResult.recordset[0];
        const actingUserId = UserID.toString();
        const actorCandidates = await resolveActorCandidates(pool, actingUserId);
        const ownsComment = hasCommentOwnership(existing, actorCandidates);

        const accessCheck = await checkTaskAccess(pool, existing.TaskID, actingUserId, isAdmin === true || isAdmin === 'true', 'edit');
        if (!accessCheck.hasAccess && !ownsComment) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية تعديل هذا التعليق.' });
        }

        if (!ownsComment) {
            return res.status(403).json({ message: 'لا تملك صلاحية تعديل هذا التعليق.' });
        }

        if (typeof ShowInCalendar !== 'undefined' && !schema.HasShowInCalendar) {
            return res.status(400).json({ message: 'ShowInCalendar column is not available in Comments table.' });
        }

        const request = pool.request().input('CommentID', sql.Int, commentId);
        const setClauses = [];

        if (typeof Content !== 'undefined') {
            const encryptedContent = encryptionConfig.encrypt(Content);
            request.input('Content', sql.NVarChar, encryptedContent);
            setClauses.push('Content = @Content');
        }

        if (typeof ShowInCalendar !== 'undefined') {
            request.input('ShowInCalendar', sql.Bit, ShowInCalendar ? 1 : 0);
            setClauses.push('ShowInCalendar = @ShowInCalendar');
        }

        const setSql = setClauses.join(', ');

        await request.query(`UPDATE Comments SET ${setSql} WHERE CommentID = @CommentID`);

        const updatedResult = await pool.request()
            .input('CommentID', sql.Int, commentId)
            .query('SELECT * FROM Comments WHERE CommentID = @CommentID');

        if (!updatedResult.recordset.length) {
            return res.status(404).json({ message: 'Comment not found after update.' });
        }

        const updatedComment = updatedResult.recordset[0];
        if (updatedComment.Content) {
            try { updatedComment.Content = encryptionConfig.decrypt(updatedComment.Content); } catch (e) {}
        }

        res.status(200).json(updatedComment);
    } catch (error) {
        console.error('UPDATE COMMENT ERROR:', error);
        res.status(500).send({ message: 'Error updating comment' });
    }
};

exports.deleteComment = async (req, res) => {
    const pool = req.app.locals.db;
    const { commentId } = req.params;
    const { UserID, isAdmin } = req.body || {};

    if (!commentId || !UserID) {
        return res.status(400).json({ message: 'commentId and UserID are required.' });
    }

    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const schemaProbe = await new sql.Request(transaction).query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Comments', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByUser,
                CASE WHEN COL_LENGTH('dbo.Comments', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy
        `);
        const schema = schemaProbe.recordset[0] || {};

        const existingResult = await new sql.Request(transaction)
            .input('CommentID', sql.Int, commentId)
            .query(`
                SELECT TOP 1
                    CommentID,
                    TaskID,
                    ${schema.HasUserID ? 'UserID' : 'CAST(NULL AS NVARCHAR(255)) AS UserID'},
                    ActedBy,
                    ${schema.HasCommentedByVacancy ? 'CommentedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS CommentedByVacancyID'},
                    ${schema.HasCommentedByUser ? 'CommentedByUserID' : 'CAST(NULL AS NVARCHAR(255)) AS CommentedByUserID'},
                    ${schema.HasLastActedByVacancy ? 'LastActedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS LastActedByVacancyID'}
                FROM Comments
                WHERE CommentID = @CommentID
            `);

        if (!existingResult.recordset.length) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Comment not found.' });
        }

        const existing = existingResult.recordset[0];
        const actingUserId = UserID.toString();
        const actorCandidates = await resolveActorCandidates(pool, actingUserId);
        const ownsComment = hasCommentOwnership(existing, actorCandidates);

        const accessCheck = await checkTaskAccess(pool, existing.TaskID, actingUserId, isAdmin === true || isAdmin === 'true', 'edit');
        if (!accessCheck.hasAccess && !ownsComment) {
            await transaction.rollback();
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية حذف هذا التعليق.' });
        }

        if (!ownsComment) {
            await transaction.rollback();
            return res.status(403).json({ message: 'لا تملك صلاحية حذف هذا التعليق.' });
        }

        await new sql.Request(transaction)
            .input('CommentID', sql.Int, commentId)
            .query('DELETE FROM CommentNotifications WHERE CommentID = @CommentID');

        await new sql.Request(transaction)
            .input('CommentID', sql.Int, commentId)
            .query('DELETE FROM Comments WHERE CommentID = @CommentID');

        await transaction.commit();

        res.status(200).json({ message: 'Comment deleted successfully' });
    } catch (error) {
        try { await transaction.rollback(); } catch (_) {}
        console.error('DELETE COMMENT ERROR:', error);
        res.status(500).send({ message: 'Error deleting comment' });
    }
};
