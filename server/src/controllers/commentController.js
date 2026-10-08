// src/controllers/commentController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { hasActiveDelegation, checkTaskAccess } = require('../utils/delegationUtils');
const { setItemDepartmentShares, canManageDepartmentSharingAndBroadcast, resolveAllowedBroadcastChain, isWithinItemBroadcastNarrowingChain } = require('../utils/departmentSharing');
const { resolveActorContext } = require('../utils/vacancyResolver');

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
    const { TaskID, UserID, ActedBy, Content, ShowInCalendar, CalendarDisplayDate, CalendarEndDate, CalendarBroadcastDepartmentID, isAdmin } = req.body;

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
                CASE WHEN COL_LENGTH('dbo.Comments', 'CalendarDisplayDate') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentCalendarDisplayDate,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CalendarEndDate') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentCalendarEndDate,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CalendarBroadcastDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasBroadcastDeptCol,
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

        // تاريخ الإنشاء الفعلي دائماً هو اللحظة الحالية — لا يُسمح بتمريره من العميل (راجع
        // CalendarDisplayDate أدناه لتاريخ الظهور في التقويم، وهو حقل مستقل تماماً).
        const commentCreatedAt = new Date();

        // تاريخ ظهور التعليق في التقويم: يُستخدم فقط عند تفعيل ShowInCalendar، ويُطلَب من
        // المستخدم عبر نافذة اختيار تاريخ/وقت في الواجهة. إن غاب لأي سبب نسقط افتراضياً للحظة
        // الحالية بدلاً من رفض الطلب.
        let calendarDisplayDate = null;
        let calendarEndDate = null;
        if (ShowInCalendar) {
            calendarDisplayDate = CalendarDisplayDate ? new Date(CalendarDisplayDate) : new Date();
            if (isNaN(calendarDisplayDate.getTime())) {
                return res.status(400).json({ message: 'Invalid CalendarDisplayDate date format.' });
            }
            // تاريخ نهاية اختياري — يجعل التعليق يظهر كحدث ممتد (بداية/نهاية) بلا حاجة لإسناده
            // لأي شخص، بنفس فكرة بداية/نهاية المهمة الفرعية.
            if (CalendarEndDate) {
                calendarEndDate = new Date(CalendarEndDate);
                if (isNaN(calendarEndDate.getTime())) {
                    return res.status(400).json({ message: 'Invalid CalendarEndDate date format.' });
                }
                if (calendarEndDate.getTime() < calendarDisplayDate.getTime()) {
                    return res.status(400).json({ message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.' });
                }
            }
        }

        // مستوى بث التعليق في التقويم لا يتجاوز مستوى بث المهمة نفسها — راجع التوضيح في
        // isWithinItemBroadcastNarrowingChain (subtaskController.createSubtask لنفس المنطق).
        let requestedBroadcastDeptId = CalendarBroadcastDepartmentID == null ? null : parseInt(CalendarBroadcastDepartmentID, 10);
        if (requestedBroadcastDeptId != null && ShowInCalendar) {
            const taskRow = await pool.request().input('TaskID', sql.Int, TaskID)
                .query('SELECT DepartmentID, CalendarBroadcastDepartmentID FROM Tasks WHERE TaskID = @TaskID');
            const taskInfo = taskRow.recordset[0];
            const valid = taskInfo && await isWithinItemBroadcastNarrowingChain(
                pool, taskInfo.DepartmentID, taskInfo.CalendarBroadcastDepartmentID, requestedBroadcastDeptId
            );
            if (!valid) {
                return res.status(400).json({ message: 'مستوى البث المطلوب يتجاوز مستوى بث المهمة.' });
            }
        } else {
            requestedBroadcastDeptId = null;
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
            .input('Content', sql.NVarChar(sql.MAX), encryptionConfig.encrypt(Content))
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

        if (schema.HasCommentCalendarDisplayDate) {
            insertRequest.input('CalendarDisplayDate', sql.DateTime, calendarDisplayDate);
            insertColumns.push('CalendarDisplayDate');
            insertValues.push('@CalendarDisplayDate');
        }

        if (schema.HasCommentCalendarEndDate) {
            insertRequest.input('CalendarEndDate', sql.DateTime, calendarEndDate);
            insertColumns.push('CalendarEndDate');
            insertValues.push('@CalendarEndDate');
        }

        if (schema.HasBroadcastDeptCol) {
            insertRequest.input('CalendarBroadcastDepartmentID', sql.Int, requestedBroadcastDeptId);
            insertColumns.push('CalendarBroadcastDepartmentID');
            insertValues.push('@CalendarBroadcastDepartmentID');
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
    const { Content, UserID, ShowInCalendar, CalendarDisplayDate, CalendarEndDate, CalendarBroadcastDepartmentID, isAdmin } = req.body || {};

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
                CASE WHEN COL_LENGTH('dbo.Comments', 'ShowInCalendar') IS NOT NULL THEN 1 ELSE 0 END AS HasShowInCalendar,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CalendarDisplayDate') IS NOT NULL THEN 1 ELSE 0 END AS HasCalendarDisplayDate,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CalendarEndDate') IS NOT NULL THEN 1 ELSE 0 END AS HasCalendarEndDate,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CalendarBroadcastDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasBroadcastDeptCol
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
        const isAdminFlag = isAdmin === true || isAdmin === 'true';
        const actorCandidates = await resolveActorCandidates(pool, actingUserId);
        const ownsComment = hasCommentOwnership(existing, actorCandidates);

        const accessCheck = await checkTaskAccess(pool, existing.TaskID, actingUserId, isAdminFlag, 'edit');
        if (!accessCheck.hasAccess && !ownsComment) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية تعديل هذا التعليق.' });
        }

        // تعديل نص التعليق يبقى حصراً لصاحبه، تماماً كالسابق. إظهار/إخفاء التعليق في التقويم
        // (وتاريخه ومستوى بثه) ليس تعديلاً لمحتوى التعليق — فيُسمح به لصاحب التعليق أو لمدير القسم
        // المستقل (أو المفوَّض له) تحديداً، لا لأي متعاون في المهمة بشكل عام.
        const onlyTogglingCalendar = typeof Content === 'undefined';
        let isDeptManager = false;
        if (!ownsComment && onlyTogglingCalendar) {
            const taskDeptRow = await pool.request().input('TaskID', sql.Int, existing.TaskID)
                .query('SELECT DepartmentID FROM Tasks WHERE TaskID = @TaskID');
            const taskDeptId = taskDeptRow.recordset[0]?.DepartmentID;
            isDeptManager = taskDeptId != null
                ? await canManageDepartmentSharingAndBroadcast(pool, actingUserId, isAdminFlag, taskDeptId)
                : false;
        }
        if (!ownsComment && !isDeptManager) {
            return res.status(403).json({ message: 'إظهار التعليق في التقويم متاح لصاحبه أو لمدير القسم المستقل فقط.' });
        }

        if (typeof ShowInCalendar !== 'undefined' && !schema.HasShowInCalendar) {
            return res.status(400).json({ message: 'ShowInCalendar column is not available in Comments table.' });
        }

        const request = pool.request().input('CommentID', sql.Int, commentId);
        const setClauses = [];

        if (typeof Content !== 'undefined') {
            const encryptedContent = encryptionConfig.encrypt(Content);
            request.input('Content', sql.NVarChar(sql.MAX), encryptedContent);
            setClauses.push('Content = @Content');
        }

        if (typeof ShowInCalendar !== 'undefined') {
            request.input('ShowInCalendar', sql.Bit, ShowInCalendar ? 1 : 0);
            setClauses.push('ShowInCalendar = @ShowInCalendar');

            if (schema.HasCalendarDisplayDate) {
                if (ShowInCalendar) {
                    const parsed = CalendarDisplayDate ? new Date(CalendarDisplayDate) : new Date();
                    if (isNaN(parsed.getTime())) {
                        return res.status(400).json({ message: 'Invalid CalendarDisplayDate date format.' });
                    }
                    request.input('CalendarDisplayDate', sql.DateTime, parsed);
                    setClauses.push('CalendarDisplayDate = @CalendarDisplayDate');

                    if (schema.HasCalendarEndDate) {
                        if (CalendarEndDate) {
                            const parsedEnd = new Date(CalendarEndDate);
                            if (isNaN(parsedEnd.getTime())) {
                                return res.status(400).json({ message: 'Invalid CalendarEndDate date format.' });
                            }
                            if (parsedEnd.getTime() < parsed.getTime()) {
                                return res.status(400).json({ message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.' });
                            }
                            request.input('CalendarEndDate', sql.DateTime, parsedEnd);
                            setClauses.push('CalendarEndDate = @CalendarEndDate');
                        } else {
                            setClauses.push('CalendarEndDate = NULL');
                        }
                    }

                    // مستوى بث التعليق لا يتجاوز مستوى بث المهمة نفسها — راجع التوضيح في
                    // isWithinItemBroadcastNarrowingChain.
                    if (schema.HasBroadcastDeptCol) {
                        let requestedBroadcastDeptId = CalendarBroadcastDepartmentID == null ? null : parseInt(CalendarBroadcastDepartmentID, 10);
                        if (requestedBroadcastDeptId != null) {
                            const taskRow = await pool.request().input('TaskID', sql.Int, existing.TaskID)
                                .query('SELECT DepartmentID, CalendarBroadcastDepartmentID FROM Tasks WHERE TaskID = @TaskID');
                            const taskInfo = taskRow.recordset[0];
                            const valid = taskInfo && await isWithinItemBroadcastNarrowingChain(
                                pool, taskInfo.DepartmentID, taskInfo.CalendarBroadcastDepartmentID, requestedBroadcastDeptId
                            );
                            if (!valid) {
                                return res.status(400).json({ message: 'مستوى البث المطلوب يتجاوز مستوى بث المهمة.' });
                            }
                        }
                        request.input('CalendarBroadcastDepartmentID', sql.Int, requestedBroadcastDeptId);
                        setClauses.push('CalendarBroadcastDepartmentID = @CalendarBroadcastDepartmentID');
                    }
                } else {
                    setClauses.push('CalendarDisplayDate = NULL');
                    if (schema.HasCalendarEndDate) setClauses.push('CalendarEndDate = NULL');
                    if (schema.HasBroadcastDeptCol) setClauses.push('CalendarBroadcastDepartmentID = NULL');
                }
            }
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

// نقل تعليق إلى مهمة أخرى — يقتصر على صاحب التعليق (يعالج حالة التسجيل بالخطأ في مهمة غير صحيحة)
exports.moveComment = async (req, res) => {
    const pool = req.app.locals.db;
    const { commentId } = req.params;
    const { TaskID: newTaskId, UserID, isAdmin } = req.body || {};

    if (!commentId || !UserID) {
        return res.status(400).json({ message: 'commentId and UserID are required.' });
    }
    if (!newTaskId) {
        return res.status(400).json({ message: 'المهمة الوجهة (TaskID) مطلوبة.' });
    }

    try {
        const schemaProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Comments', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByUser,
                CASE WHEN COL_LENGTH('dbo.Comments', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
                CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'TaskID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifTaskID
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
        const isAdminFlag = isAdmin === true || isAdmin === 'true';

        if (!ownsComment && !isAdminFlag) {
            return res.status(403).json({ message: 'فقط صاحب التعليق يمكنه نقله إلى مهمة أخرى.' });
        }

        if (Number(newTaskId) === Number(existing.TaskID)) {
            return res.status(400).json({ message: 'التعليق موجود بالفعل ضمن هذه المهمة.' });
        }

        const accessCheck = await checkTaskAccess(pool, newTaskId, actingUserId, isAdminFlag, 'view');
        if (!accessCheck.hasAccess) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية الوصول إلى المهمة الوجهة.' });
        }

        await pool.request()
            .input('CommentID', sql.Int, commentId)
            .input('NewTaskID', sql.Int, newTaskId)
            .query('UPDATE Comments SET TaskID = @NewTaskID WHERE CommentID = @CommentID');

        if (schema.HasNotifTaskID) {
            await pool.request()
                .input('CommentID', sql.Int, commentId)
                .input('NewTaskID', sql.Int, newTaskId)
                .query('UPDATE CommentNotifications SET TaskID = @NewTaskID WHERE CommentID = @CommentID');
        }

        const updatedResult = await pool.request()
            .input('CommentID', sql.Int, commentId)
            .query('SELECT * FROM Comments WHERE CommentID = @CommentID');

        const updatedComment = updatedResult.recordset[0];
        if (updatedComment && updatedComment.Content) {
            try { updatedComment.Content = encryptionConfig.decrypt(updatedComment.Content); } catch (_) {}
        }

        res.status(200).json(updatedComment);
    } catch (error) {
        console.error('MOVE COMMENT ERROR:', error);
        res.status(500).json({ message: 'Error moving comment', detail: error.message });
    }
};

// PATCH /api/comments/:commentId/department-shares — يحدد منشئ التعليق الجهات المستقلة التي
// يراها هذا التعليق تحديداً (ضمن القنوات المفتوحة على مستوى المهمة فقط). قابل للتعديل دائماً.
exports.setCommentDepartmentShares = async (req, res) => {
    const pool = req.app.locals.db;
    const { commentId } = req.params;
    const { UserID, isAdmin, DepartmentIDs } = req.body || {};

    if (!commentId || !UserID) {
        return res.status(400).json({ message: 'commentId and UserID are required.' });
    }
    if (!Array.isArray(DepartmentIDs)) {
        return res.status(400).json({ message: 'DepartmentIDs must be an array.' });
    }

    try {
        const schemaProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Comments', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByUser,
                CASE WHEN COL_LENGTH('dbo.Comments', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy
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
        const actingUserId = String(UserID);
        const actorCandidates = await resolveActorCandidates(pool, actingUserId);
        const ownsComment = hasCommentOwnership(existing, actorCandidates);
        const isAdminFlag = isAdmin === true || isAdmin === 'true';
        if (!ownsComment && !isAdminFlag) {
            return res.status(403).json({ message: 'فقط صاحب التعليق يمكنه تحديد مشاركته مع جهات أخرى.' });
        }

        const result = await setItemDepartmentShares(pool, {
            kind: 'comment',
            itemId: parseInt(commentId, 10),
            taskId: existing.TaskID,
            departmentIds: DepartmentIDs,
            actorUserId: actingUserId,
        });
        if (!result.ok) {
            return res.status(400).json({ message: result.reason });
        }
        res.status(200).json({ message: 'تم تحديث مشاركة التعليق.' });
    } catch (error) {
        console.error('SET COMMENT DEPARTMENT SHARES ERROR:', error);
        res.status(500).json({ message: 'Error setting comment department shares', detail: error.message });
    }
};

// PATCH /api/comments/:commentId/broadcast-level — رفع بث تعليق معيّن على التقويم لمستوى أعلى من
// مستوى المهمة الافتراضي. يتطلب صلاحية إدارة المشاركة/البث (مدير القسم أو المفوَّض له)، وليس منشئ
// التعليق. DepartmentID=null يُعيد التعليق لاتّباع مستوى المهمة.
exports.setCommentBroadcastLevel = async (req, res) => {
    const pool = req.app.locals.db;
    const { commentId } = req.params;
    const { userId, isAdmin, DepartmentID } = req.body || {};

    if (!commentId || !userId) {
        return res.status(400).json({ message: 'commentId and userId are required.' });
    }

    try {
        const existingResult = await pool.request()
            .input('CommentID', sql.Int, commentId)
            .query(`
                SELECT c.CommentID, c.TaskID, t.DepartmentID AS TaskDepartmentID
                FROM Comments c
                INNER JOIN Tasks t ON t.TaskID = c.TaskID
                WHERE c.CommentID = @CommentID
            `);
        if (!existingResult.recordset.length) {
            return res.status(404).json({ message: 'Comment not found.' });
        }
        const existing = existingResult.recordset[0];
        const allowed = await canManageDepartmentSharingAndBroadcast(pool, userId, isAdmin, existing.TaskDepartmentID);
        if (!allowed) {
            return res.status(403).json({ message: 'هذه الميزة متاحة لمدير القسم المستقل أو المفوَّض له فقط.' });
        }

        const deptId = DepartmentID == null ? null : parseInt(DepartmentID, 10);
        if (deptId != null) {
            const actorCtx = await resolveActorContext(pool, userId).catch(() => null);
            const allowedChain = await resolveAllowedBroadcastChain(pool, existing.TaskDepartmentID, actorCtx?.vacancyId ?? null);
            if (!allowedChain.some(d => d.DepartmentID === deptId)) {
                return res.status(400).json({ message: 'هذا المستوى غير مسموح به لمستوى البث.' });
            }
        }
        await pool.request()
            .input('CommentID', sql.Int, commentId)
            .input('DepartmentID', sql.Int, deptId)
            .query('UPDATE Comments SET CalendarBroadcastDepartmentID = @DepartmentID WHERE CommentID = @CommentID');

        res.status(200).json({ message: 'تم تحديث مستوى بث التعليق في التقويم.', CalendarBroadcastDepartmentID: deptId });
    } catch (error) {
        console.error('SET COMMENT BROADCAST LEVEL ERROR:', error);
        res.status(500).json({ message: 'Error setting comment broadcast level', detail: error.message });
    }
};

// PATCH /api/comments/:commentId/public-broadcast — بث مفتوح: يُظهر هذا التعليق على التقويم العام
// في صفحة الدخول لأي زائر غير مسجّل (بلا كشف هوية صاحب التعليق). مستقل تماماً عن مستوى البث الداخلي.
exports.setCommentPublicBroadcast = async (req, res) => {
    const pool = req.app.locals.db;
    const { commentId } = req.params;
    const { userId, isAdmin, IsPublicBroadcast } = req.body || {};

    if (!commentId || !userId) {
        return res.status(400).json({ message: 'commentId and userId are required.' });
    }
    if (typeof IsPublicBroadcast !== 'boolean') {
        return res.status(400).json({ message: 'IsPublicBroadcast must be a boolean.' });
    }

    try {
        const existingResult = await pool.request()
            .input('CommentID', sql.Int, commentId)
            .query(`
                SELECT c.CommentID, c.TaskID, t.DepartmentID AS TaskDepartmentID
                FROM Comments c
                INNER JOIN Tasks t ON t.TaskID = c.TaskID
                WHERE c.CommentID = @CommentID
            `);
        if (!existingResult.recordset.length) {
            return res.status(404).json({ message: 'Comment not found.' });
        }
        const existing = existingResult.recordset[0];
        const allowed = await canManageDepartmentSharingAndBroadcast(pool, userId, isAdmin, existing.TaskDepartmentID);
        if (!allowed) {
            return res.status(403).json({ message: 'هذه الميزة متاحة لمدير القسم المستقل أو المفوَّض له فقط.' });
        }

        await pool.request()
            .input('CommentID', sql.Int, commentId)
            .input('Value', sql.Bit, IsPublicBroadcast ? 1 : 0)
            .query('UPDATE Comments SET IsPublicBroadcast = @Value WHERE CommentID = @CommentID');

        res.status(200).json({ message: 'تم تحديث البث المفتوح للتعليق.', IsPublicBroadcast });
    } catch (error) {
        console.error('SET COMMENT PUBLIC BROADCAST ERROR:', error);
        res.status(500).json({ message: 'Error setting comment public broadcast', detail: error.message });
    }
};
