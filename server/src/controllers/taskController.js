// src/controllers/taskController.js
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { getTasksQueryWithDelegation, checkTaskAccess, checkDelegationPermission, hasActiveDelegation } = require('../utils/delegationUtils');
const encryptionConfig = require('../config/encryption.config');
const { detectSchema, resolveVacancyId, ensureVacancyId, resolveActorContext, resolveIndependentDeptGroup } = require('../utils/vacancyResolver');

// مسار ملف debug مؤقت — يُحذف بعد تشخيص المشكلة
const _ACTIVITY_DEBUG_LOG = (() => {
    try {
        const exe = process.execPath;
        return path.join(path.dirname(exe), 'activity-debug.log');
    } catch { return null; }
})();
function _activityLog(msg) {
    try {
        if (_ACTIVITY_DEBUG_LOG) {
            fs.appendFileSync(_ACTIVITY_DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
        }
    } catch (_) {}
    console.log('[ActivityDebug]', msg);
}

// ─── In-memory cache لتقليل استعلامات فحص المخطط المتكررة ──────────
const SCHEMA_TTL = 5 * 60_000; // 5 دقائق — المخطط لا يتغير إلا عند migration
const USER_TTL   =     60_000; // دقيقة واحدة — بيانات المستخدم نادراً ما تتغير
const _tcache = {
  schema:    null, schemaTs:    0,
  schemaN:   null, schemaNTs:   0,
  personal:  null, personalTs:  0,
  actors: new Map(),   // userId → { val, ts }
  depts:  new Map(),   // userId → { val, ts }
};
function _cacheGet(map, key, ttl) {
  const e = map.get ? map.get(key) : (map.key === key ? map : null);
  if (e && Date.now() - e.ts < ttl) return { hit: true, val: e.val };
  return { hit: false };
}
function _cacheSet(map, key, val) { map.set(key, { val, ts: Date.now() }); }

// تسجيل إجراء مهمة في جدول TaskAuditLog (العنوان يُحفظ مشفّراً كما هو في DB)
async function logTaskAction(pool, { taskId, taskTitle, departmentId, action, userId }) {
    try {
        let actorName = '', actorPosition = '', actorDeptId = null;
        if (userId) {
            const ctx = await resolveActorContext(pool, String(userId)).catch(() => null);
            actorName     = ctx?.fullName    || String(userId);
            actorPosition = ctx?.vacancyName || '';
            actorDeptId   = ctx?.departmentId != null ? parseInt(ctx.departmentId, 10) : null;
        }

        // إذا لم يُمرَّر DepartmentID، حاول جلبه من المهمة مباشرة
        let deptId = departmentId || null;
        if ((deptId == null || deptId === 0) && taskId) {
            try {
                const deptRes = await pool.request()
                    .input('TID', sql.Int, taskId)
                    .query('SELECT TOP 1 DepartmentID FROM dbo.Tasks WHERE TaskID = @TID');
                deptId = deptRes.recordset[0]?.DepartmentID || null;
            } catch (_) {}
        }

        await pool.request()
            .input('TaskID',           sql.Int,           taskId        || null)
            .input('TaskTitle',        sql.NVarChar(500),  taskTitle     || null)
            .input('DepartmentID',     sql.Int,           deptId        || null)
            .input('ActorDepartmentID',sql.Int,           actorDeptId   || null)
            .input('Action',           sql.NVarChar(50),   action)
            .input('ActorName',        sql.NVarChar(255),  actorName     || null)
            .input('ActorPosition',    sql.NVarChar(255),  actorPosition || null)
            .query(`INSERT INTO dbo.TaskAuditLog
                      (TaskID, TaskTitle, DepartmentID, ActorDepartmentID, Action, ActorName, ActorPosition)
                    VALUES
                      (@TaskID, @TaskTitle, @DepartmentID, @ActorDepartmentID, @Action, @ActorName, @ActorPosition)`);
    } catch (err) {
        console.error('logTaskAction failed:', err?.message || err);
    }
}

// يحوّل VacancyID رقمي → UserID حقيقي لمقارنة PersonalOwnerUserID
async function resolveUserIDFromActor(pool, rawActorId) {
    const text = String(rawActorId || '').trim();
    if (!text || !/^\d+$/.test(text)) return text; // غير رقمي → هو بالفعل UserID
    try {
        const res = await pool.request()
            .input('VacancyID', sql.Int, parseInt(text, 10))
            .query(`
                IF OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL
                    SELECT TOP 1 LTRIM(RTRIM(UserID)) AS UserID
                    FROM dbo.Assignments
                    WHERE VacancyID = @VacancyID
                    ORDER BY CASE WHEN IsCurrent = 1 THEN 0 ELSE 1 END,
                             ISNULL(StartDate, '1900-01-01') DESC;
            `);
        const uid = res.recordset[0]?.UserID;
        if (uid) return String(uid).trim();
    } catch (_) {}
    return text;
}

async function _resolveEffectiveActorIdCore(pool, loginId) {
    const probe = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS UsesVacancySchema,
          CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
          CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
          CASE WHEN OBJECT_ID('dbo.JobVacancies', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasJobVacancies,
          CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
          CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID
    `);
    const p = probe.recordset[0] || {};
    const usesVacancySchema = !!p.UsesVacancySchema;
    if (usesVacancySchema && p.HasJobVacancies && /^\d+$/.test(loginId)) {
        try {
            // تحقق أولاً: هل هذا الرقم هو UserID في جدول Users؟
            // إذا كان كذلك، لا نُرجعه مباشرةً كـ VacancyID — نسلك المسار الطبيعي (UserID → VacancyID).
            // المشكلة: UserID='19' وVacancyID=19 قد يتصادمان إذا تحققنا من JobVacancies أولاً.
            const userExistCheck = await pool.request()
                .input('LoginIDStr', sql.NVarChar, loginId)
                .query(`SELECT TOP 1 1 AS Found FROM dbo.Users WHERE LTRIM(RTRIM(UserID)) = @LoginIDStr`);
            if (userExistCheck.recordset.length === 0) {
                // ليس UserID → افحص إن كان VacancyID مباشراً
                const vacancyCheck = await pool.request()
                    .input('VacancyID', sql.Int, parseInt(loginId, 10))
                    .query(`SELECT TOP 1 VacancyID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
                if (vacancyCheck.recordset.length > 0) return loginId;
            }
            // إذا كان UserID → اسقط للمسار الطبيعي أدناه
        } catch (_) {}
    }
    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
    if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
    if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);
    const whereClause = whereParts.join(' OR ');
    if (usesVacancySchema && p.HasProfileView) {
        const mapped = await pool.request()
            .input('LoginID', sql.NVarChar, loginId)
            .query(`SELECT TOP 1 u.UserID, p.VacancyID FROM dbo.Users u LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID WHERE ${whereClause}`);
        const row = mapped.recordset[0];
        if (!row) return loginId;
        if (row.VacancyID !== null && row.VacancyID !== undefined && String(row.VacancyID).trim() !== '')
            return String(row.VacancyID).trim();
        if (p.HasAssignmentsTable) {
            const la = await pool.request()
                .input('UserID', sql.NVarChar, String(row.UserID || loginId).trim())
                .query(`SELECT TOP 1 VacancyID FROM dbo.Assignments WHERE UserID = @UserID AND VacancyID IS NOT NULL ORDER BY CASE WHEN IsCurrent = 1 THEN 0 ELSE 1 END, ISNULL(StartDate,'1900-01-01') DESC, AssignmentID DESC`);
            const fv = la.recordset[0]?.VacancyID;
            if (fv !== null && fv !== undefined && String(fv).trim() !== '') return String(fv).trim();
        }
        return String(row.UserID || loginId).trim();
    }
    const mapped = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`SELECT TOP 1 UserID FROM dbo.Users u WHERE ${whereClause}`);
    return String(mapped.recordset[0]?.UserID || loginId).trim();
}
async function resolveEffectiveActorId(pool, rawUserId) {
    const loginId = String(rawUserId || '').trim();
    if (!loginId) return '';
    const cc = _cacheGet(_tcache.actors, loginId, USER_TTL);
    if (cc.hit) return cc.val;
    const val = await _resolveEffectiveActorIdCore(pool, loginId);
    _cacheSet(_tcache.actors, loginId, val);
    return val;
}

async function resolveUserDirectorateDepartmentIds(pool, rawUserId) {
    const loginId = String(rawUserId || '').trim();
    if (!loginId) return [];
    const dc = _cacheGet(_tcache.depts, loginId, USER_TTL);
    if (dc.hit) return dc.val;

    const probeResult = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Departments', 'ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDepartmentID,
          CASE WHEN COL_LENGTH('dbo.Departments', 'ParentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
          CASE WHEN COL_LENGTH('dbo.Departments', 'Type') IS NOT NULL THEN 1 ELSE 0 END AS HasDepartmentType,
          CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
          CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
          CASE WHEN COL_LENGTH('dbo.vw_UserCurrentProfile', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileDepartmentID,
          CASE WHEN COL_LENGTH('dbo.vw_UserCurrentProfile', 'VacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileVacancyID,
          CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
          CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
          CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDepartmentID
    `);

    const p = probeResult.recordset[0] || {};
    const parentCol = p.HasParentDepartmentID ? 'ParentDepartmentID' : (p.HasParentID ? 'ParentID' : null);
    if (!parentCol) return [];

    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
    if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
    if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);

    let baseDepartmentId = null;
    const userIdentity = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`
            SELECT TOP 1
              u.UserID,
              ${p.HasUsersDepartmentID ? 'u.DepartmentID' : 'CAST(NULL as int) as DepartmentID'},
              ${(p.HasProfileView && p.HasProfileDepartmentID) ? 'prof.DepartmentID' : 'CAST(NULL as int) as ProfileDepartmentID'},
              ${(p.HasProfileView && p.HasProfileVacancyID) ? 'prof.VacancyID' : 'CAST(NULL as int) as VacancyID'}
            FROM dbo.Users u
            ${p.HasProfileView ? 'LEFT JOIN dbo.vw_UserCurrentProfile prof ON prof.UserID = u.UserID' : ''}
            WHERE ${whereParts.join(' OR ')}
        `);

    const identityRow = userIdentity.recordset[0] || null;
    if (identityRow) {
        // الأولوية 1: vw_UserCurrentProfile — يعكس المنصب الحالي إن كان محدَّثاً
        if (identityRow.ProfileDepartmentID != null) {
            baseDepartmentId = identityRow.ProfileDepartmentID;
        }

        // الأولوية 2: Assignments مع IsCurrent=1 — أوثق مصدر للمنصب الحالي بعد التنقل
        if (baseDepartmentId == null && p.HasAssignmentsTable && p.HasVacancyDepartmentID) {
            const assignmentDept = await pool.request()
                .input('UserID', sql.NVarChar, String(identityRow.UserID || loginId).trim())
                .query(`
                    SELECT TOP 1 jv.DepartmentID
                    FROM dbo.Assignments a
                    INNER JOIN dbo.JobVacancies jv ON jv.VacancyID = a.VacancyID
                    WHERE a.UserID = @UserID
                      AND a.VacancyID IS NOT NULL
                    ORDER BY
                      CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
                      ISNULL(a.StartDate, '1900-01-01') DESC,
                      a.AssignmentID DESC
                `);
            if (assignmentDept.recordset[0]?.DepartmentID != null) {
                baseDepartmentId = assignmentDept.recordset[0].DepartmentID;
            }
        }

        // الأولوية 3: VacancyID من profile view → JobVacancies
        if (baseDepartmentId == null && identityRow.VacancyID != null && p.HasVacancyDepartmentID) {
            const vacancyDept = await pool.request()
                .input('VacancyID', sql.Int, identityRow.VacancyID)
                .query(`SELECT TOP 1 DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
            if (vacancyDept.recordset[0]?.DepartmentID != null) {
                baseDepartmentId = vacancyDept.recordset[0].DepartmentID;
            }
        }

        // الأولوية 4: Users.DepartmentID — قد يكون قديماً بعد تغيير المنصب، يُستخدم كحل أخير
        if (baseDepartmentId == null && identityRow.DepartmentID != null) {
            baseDepartmentId = identityRow.DepartmentID;
        }
    }

    if (baseDepartmentId == null && p.HasVacancyDepartmentID) {
        const actorId = await resolveEffectiveActorId(pool, loginId);
        const numericActor = parseInt(String(actorId || ''), 10);
        if (Number.isInteger(numericActor)) {
            const vacancyDept = await pool.request()
                .input('VacancyID', sql.Int, numericActor)
                .query(`SELECT TOP 1 DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
            if (vacancyDept.recordset[0]?.DepartmentID != null) {
                baseDepartmentId = vacancyDept.recordset[0].DepartmentID;
            }
        }
    }

    if (baseDepartmentId == null) return [];
    baseDepartmentId = String(baseDepartmentId).trim();
    if (!baseDepartmentId || !/^\d+$/.test(baseDepartmentId)) return [];

    let rootDepartmentId = baseDepartmentId;
    if (p.HasDepartmentType) {
        const rootResult = await pool.request()
            .input('DepartmentID', sql.NVarChar, baseDepartmentId)
            .query(`
                ;WITH UpTree AS (
                    SELECT DepartmentID, TRY_CAST(${parentCol} AS INT) AS ParentDepartmentID, 0 AS Depth
                    FROM dbo.Departments
                    WHERE DepartmentID = @DepartmentID
                    UNION ALL
                    SELECT d.DepartmentID, TRY_CAST(d.${parentCol} AS INT) AS ParentDepartmentID, u.Depth + 1
                    FROM dbo.Departments d
                    INNER JOIN UpTree u ON u.ParentDepartmentID IS NOT NULL
                                       AND d.DepartmentID = u.ParentDepartmentID
                    WHERE u.Depth < 3
                )
                SELECT TOP 1 u.DepartmentID
                FROM UpTree u
                INNER JOIN dbo.Departments d ON d.DepartmentID = u.DepartmentID
                WHERE TRY_CAST(d.[Type] AS INT) = 1
                ORDER BY u.Depth ASC
                OPTION (MAXRECURSION 10)
            `);

        if (rootResult.recordset[0]?.DepartmentID != null) {
            rootDepartmentId = String(rootResult.recordset[0].DepartmentID).trim();
        }
    }
    if (!rootDepartmentId || !/^\d+$/.test(String(rootDepartmentId))) return [];

    const typeStopClause = p.HasDepartmentType
        ? `AND (TRY_CAST(d.[Type] AS INT) IS NULL OR TRY_CAST(d.[Type] AS INT) <> 1)`
        : '';

    const deptTreeResult = await pool.request()
        .input('RootDepartmentID', sql.NVarChar, rootDepartmentId)
        .query(`
            ;WITH DeptTree AS (
                SELECT DepartmentID, TRY_CAST(${parentCol} AS INT) AS ParentDepartmentID
                FROM dbo.Departments
                WHERE DepartmentID = @RootDepartmentID
                UNION ALL
                SELECT d.DepartmentID, TRY_CAST(d.${parentCol} AS INT) AS ParentDepartmentID
                FROM dbo.Departments d
                INNER JOIN DeptTree dt ON TRY_CAST(d.${parentCol} AS INT) IS NOT NULL
                                       AND TRY_CAST(d.${parentCol} AS INT) = dt.DepartmentID
                ${typeStopClause}
            )
            SELECT DISTINCT DepartmentID
            FROM DeptTree
            OPTION (MAXRECURSION 300)
        `);

    const deptIds = (deptTreeResult.recordset || [])
        .map(r => String(r.DepartmentID || '').trim())
        .filter(v => /^\d+$/.test(v));
    _cacheSet(_tcache.depts, loginId, deptIds);
    return deptIds;
}

async function canUserViewTaskByListRules(pool, rawUserId, isAdmin, taskId) {
    if (isAdmin === true || isAdmin === 'true') return true;

    const effectiveActorId = await resolveEffectiveActorId(pool, rawUserId);
    if (!effectiveActorId) return false;

    const schema = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskVacancy,
          CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubVacancy,
          CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorVacancyID') IS NOT NULL
                 AND COL_LENGTH('dbo.TaskDelegations', 'DelegateVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasDelegationVacancy,
          CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentVacancy
    `);

    const s = schema.recordset[0] || {};
    const isVacancy = !!(s.HasTaskVacancy || s.HasSubVacancy || s.HasDelegationVacancy);
    const taskCreatorCol = isVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
    const taskAssignedCol = isVacancy ? null : 'AssignedTo';
    const subAssignedCol = isVacancy ? 'AssignedToVacancyID' : 'AssignedTo';
    const delegatorCol = isVacancy ? 'DelegatorVacancyID' : 'DelegatorUserID';
    const delegateCol = isVacancy ? 'DelegateVacancyID' : 'DelegateUserID';
    const commentAuthorCol = s.HasCommentVacancy ? 'CommentedByVacancyID' : 'UserID';

    const accessParts = [
        `t.${taskCreatorCol} = @UserID`,
        `EXISTS (SELECT 1 FROM Subtasks s_inner WHERE s_inner.TaskID = t.TaskID AND s_inner.${subAssignedCol} = @UserID)`,
        `EXISTS (SELECT 1 FROM Comments cm_inner WHERE cm_inner.TaskID = t.TaskID AND cm_inner.${commentAuthorCol} = @UserID)`,
        `EXISTS (
            SELECT 1
            FROM TaskDelegations d
            WHERE d.${delegatorCol} = t.${taskCreatorCol}
              AND d.${delegateCol} = @UserID
              AND d.IsActive = 1
              AND d.StartDate <= GETDATE()
              AND (d.EndDate IS NULL OR d.EndDate >= GETDATE())
        )`
    ];
    if (taskAssignedCol) {
        accessParts.splice(1, 0, `t.${taskAssignedCol} = @UserID`);
    }

    const scopeDepartmentIds = await resolveUserDirectorateDepartmentIds(pool, rawUserId);
    if (scopeDepartmentIds.length > 0) {
        const scopeParams = scopeDepartmentIds.map((_, index) => `@ScopeDepartmentID${index}`).join(', ');
        accessParts.push(`t.DepartmentID IN (${scopeParams})`);
    }

    const request = pool.request()
        .input('TaskID', sql.Int, taskId)
        .input('UserID', sql.NVarChar, effectiveActorId);
    scopeDepartmentIds.forEach((departmentId, index) => {
        request.input(`ScopeDepartmentID${index}`, sql.NVarChar, departmentId);
    });

    const result = await request.query(`
        SELECT TOP 1 1 AS Allowed
        FROM Tasks t
        WHERE t.TaskID = @TaskID
          AND (${accessParts.join(' OR ')})
    `);

    return (result.recordset || []).length > 0;
}

// التراجع عن دفعة نقل (إرجاع الإسناد السابق) - REMOVED
// exports.revertTaskTransferBatch was here

// جلب سجل دفعات النقل للمستخدم (المرسل) - REMOVED
// exports.getUserTransferBatches was here

exports.getAllTasks = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, isAdmin, delegateUserId } = req.query;
    if (!userId) { return res.status(401).json({ message: 'User identification is required.' }); }

    try {
        const effectiveActorId = await resolveEffectiveActorId(pool, userId);
        res.set('X-Effective-Actor-ID', String(effectiveActorId || ''));
        // إذا أُرسل delegateUserId فهذا طلب تفويض — لا تُرجع المهام الشخصية للمفوِّض
        const isDelegationRequest = !!(delegateUserId && String(delegateUserId).trim());
        const personalUserId = isDelegationRequest ? null : await resolveUserIDFromActor(pool, userId);
        const query = await getTasksQueryWithDelegation(pool, effectiveActorId, isAdmin === 'true', personalUserId);
        const request = pool.request()
          .input('UserID', sql.NVarChar, effectiveActorId)
          .input('PersonalUserID', sql.NVarChar, personalUserId ?? '');
        const result = await request.query(query);
        const tasks = result.recordset.map(t => {
            if (t.Description) {
                try { t.Description = encryptionConfig.decrypt(t.Description); } catch (e) {}
            }
            if (t.Title) {
                try { t.Title = encryptionConfig.decrypt(t.Title); } catch (e) {}
            }
            return t;
        });
        res.status(200).json(tasks);

    } catch (error) {
        console.error('DATABASE GET ALL TASKS ERROR:', error);
        res.status(500).send({ message: 'Error fetching tasks' });
    }
};

exports.getTaskActivity = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, isAdmin, page, days } = req.query;

    if (!userId) {
        return res.status(401).json({ message: 'User identification is required.' });
    }

    const pageIndex = Math.max(parseInt(page, 10) || 0, 0);
    const daysCount = Math.max(parseInt(days, 10) || 7, 1);

    try {
        const effectiveActorId = await resolveEffectiveActorId(pool, userId);

        if (isAdmin !== 'true') {
            _activityLog(`getTaskActivity userId=${userId} effectiveActorId=${effectiveActorId} page=${pageIndex}`);
        }

        let schemaProbeRow = _tcache.schema && (Date.now() - _tcache.schemaTs < SCHEMA_TTL) ? _tcache.schema : null;
        if (!schemaProbeRow) {
            const schemaProbe = await pool.request().query(`
                SELECT
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskCreatedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskAssignedToVacancy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskAssignedToUser,
                  CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubCreatedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubAssignedToVacancy,
                  CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorVacancyID') IS NOT NULL
                         AND COL_LENGTH('dbo.TaskDelegations', 'DelegateVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDelegations,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'PersonalOwnerUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasPersonalOwner,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskCreatedBy,
                  CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasSubAssignedTo,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.Subtasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasSubActedBy,
                  CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubLastActedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.Comments', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCmtActedBy,
                  CASE WHEN COL_LENGTH('dbo.Comments', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCmtLastActedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'UpdatedAt') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskUpdatedAt,
                  CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable
            `);
            schemaProbeRow = schemaProbe.recordset[0] || {};
            _tcache.schema = schemaProbeRow; _tcache.schemaTs = Date.now();
        }
        const s = schemaProbeRow;
        const taskCreatedCol = s.HasTaskCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
        const hasTaskAssignedToUser = !!s.HasTaskAssignedToUser;
        const taskAssignedCol = s.HasTaskAssignedToVacancy ? 'AssignedToVacancyID' : (hasTaskAssignedToUser ? 'AssignedTo' : null);
        const subCreatedCol = s.HasSubCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
        const subAssignedCol = s.HasSubAssignedToVacancy ? 'AssignedToVacancyID' : 'AssignedTo';
        const commentActorCol = s.HasCommentedByVacancy ? 'CommentedByVacancyID' : 'UserID';
        const delegatorCol = s.HasVacancyDelegations ? 'DelegatorVacancyID' : 'DelegatorUserID';
        const delegateCol = s.HasVacancyDelegations ? 'DelegateVacancyID' : 'DelegateUserID';
        const identityTable = s.HasTaskCreatedByVacancy ? 'JobVacancies' : 'Users';
        const identityKey = s.HasTaskCreatedByVacancy ? 'VacancyID' : 'UserID';
        const identityName = s.HasTaskCreatedByVacancy ? 'Name' : 'FullName';

        // تعبيرات ActorID الآمنة من الناحية النوعية.
        // COALESCE(NVARCHAR, INT, INT) يجبر SQL على تحويل NVARCHAR→INT → خطأ لقيم مثل 'd1-8013'.
        // الحل: نستخدم COALESCE(INT, INT) أو COALESCE(NVARCHAR, NVARCHAR) دون خلط الأنواع.
        const taskActorExpr = (s.HasLastActedByVacancy && s.HasTaskCreatedByVacancy)
            ? `COALESCE(t.LastActedByVacancyID, t.${taskCreatedCol})`
            : s.HasActedBy
                ? `COALESCE(t.ActedBy, t.${taskCreatedCol})`
                : `t.${taskCreatedCol}`;
        const subActorExpr = (s.HasSubLastActedByVacancy && s.HasSubCreatedByVacancy)
            ? `COALESCE(s.LastActedByVacancyID, s.${subCreatedCol})`
            : s.HasSubActedBy
                ? `COALESCE(s.ActedBy, s.${subCreatedCol})`
                : `s.${subCreatedCol}`;
        const cmtActorExpr = (s.HasCmtLastActedByVacancy && s.HasCommentedByVacancy)
            ? `COALESCE(c.LastActedByVacancyID, c.${commentActorCol})`
            : s.HasCmtActedBy
                ? `COALESCE(c.ActedBy, c.${commentActorCol})`
                : `c.${commentActorCol}`;

        // تعبير التاريخ للمهام: UpdatedAt أولوية على CreatedAt لإظهار المهام المُعدَّلة مؤخراً
        const taskDateExpr = s.HasTaskUpdatedAt
            ? `COALESCE(t.UpdatedAt, t.CreatedAt)`
            : `t.CreatedAt`;

        // المدير: يرى مهام قسمه كاملاً.
        // الموظف: يرى فقط المهام التي أنشأها أو تحتوي على مهمة فرعية مسنَدة له.
        let accessCondition;
        let adminDeptParams = {}; // {paramName: intValue} — تُضاف للـ request بعد إنشائه

        if (isAdmin === 'true') {
            let scopeDepartmentIds = await resolveUserDirectorateDepartmentIds(pool, userId);
            let fallbackDeptId = null;
            if (scopeDepartmentIds.length === 0) {
                try {
                    const actorCtx = await resolveActorContext(pool, userId);
                    if (actorCtx?.departmentId != null) fallbackDeptId = actorCtx.departmentId;
                } catch (_) {}
            }
            if (scopeDepartmentIds.length === 0 && fallbackDeptId == null) {
                return res.json([]);
            }
            scopeDepartmentIds.forEach((dId, i) => {
                adminDeptParams[`ActDeptID${i}`] = parseInt(dId, 10);
            });
            if (fallbackDeptId != null) {
                adminDeptParams['ActFallbackDeptID'] = fallbackDeptId;
            }
            const deptExpr = scopeDepartmentIds.length > 0
                ? `t.DepartmentID IN (${scopeDepartmentIds.map((_, i) => `@ActDeptID${i}`).join(', ')})`
                : `t.DepartmentID = @ActFallbackDeptID`;
            accessCondition = `(${deptExpr})`;
        } else {
            // المنطق: المهام التي أنشأها صاحب المنصب أو أُسنِدت له فيها مهمة فرعية.
            // effectiveActorId = '91' (VacancyID رقمي) → نمرره كـ INT مباشرةً لضمان استخدام الـ index
            // بدلاً من CAST(col AS NVARCHAR) الذي يمنع الـ index seek ويضطر DB لفحص كل الصفوف.

            const actorVacancyId = s.HasTaskCreatedByVacancy && /^\d+$/.test(effectiveActorId)
                ? parseInt(effectiveActorId, 10)
                : null;

            if (actorVacancyId !== null) {
                // مقارنة INT = INT — سريعة وتستخدم الـ index
                adminDeptParams['ActorVacancyID'] = actorVacancyId;
                const creatorCheck = `t.CreatedByVacancyID = @ActorVacancyID${s.HasTaskCreatedBy ? ' OR t.CreatedBy = @RawUserID' : ''}`;
                const subCheck = s.HasSubAssignedToVacancy
                    ? `s_access.AssignedToVacancyID = @ActorVacancyID${s.HasSubAssignedTo ? ' OR s_access.AssignedTo = @RawUserID' : ''}`
                    : `s_access.AssignedTo = @RawUserID`;
                accessCondition = `(
                    (${creatorCheck})
                    OR EXISTS (
                        SELECT 1 FROM Subtasks s_access
                        WHERE s_access.TaskID = t.TaskID AND (${subCheck})
                    )
                )`;
            } else {
                // fallback: effectiveActorId نصي (نظام قديم بدون VacancyID)
                const creatorCheck = s.HasTaskCreatedByVacancy
                    ? `(CAST(t.CreatedByVacancyID AS NVARCHAR(50)) = @UserID${s.HasTaskCreatedBy ? ' OR t.CreatedBy = @RawUserID' : ''})`
                    : `(t.CreatedBy = @RawUserID)`;
                const subCheck = s.HasSubAssignedToVacancy
                    ? `(CAST(s_access.AssignedToVacancyID AS NVARCHAR(50)) = @UserID${s.HasSubAssignedTo ? ' OR s_access.AssignedTo = @RawUserID' : ''})`
                    : `(s_access.AssignedTo = @RawUserID)`;
                accessCondition = `(
                    ${creatorCheck}
                    OR EXISTS (
                        SELECT 1 FROM Subtasks s_access
                        WHERE s_access.TaskID = t.TaskID AND ${subCheck}
                    )
                )`;
            }
        }

        if (isAdmin !== 'true') {
            _activityLog(`accessCondition=${accessCondition.replace(/\s+/g,' ')} hasAssignments=${s.HasAssignmentsTable} hasTaskCreatedByVacancy=${s.HasTaskCreatedByVacancy} hasSubAssignedToVacancy=${s.HasSubAssignedToVacancy}`);
        }

        // المهام الخاصة لا تظهر أبداً في آخر التحديثات — خاصة بصاحبها فقط
        const personalFilterClause = s.HasPersonalOwner ? `AND t.PersonalOwnerUserID IS NULL` : '';

        const taskAssignedIdExpr = taskAssignedCol ? `t.${taskAssignedCol}` : 'CAST(NULL as nvarchar(50))';
        const taskAssignedNameExpr = taskAssignedCol ? `assignee.${identityName}` : 'CAST(NULL as nvarchar(100))';
        const taskAssigneeJoin = taskAssignedCol
            ? `LEFT JOIN ${identityTable} assignee ON t.${taskAssignedCol} = assignee.${identityKey}`
            : '';

        const request = pool.request()
            .input('UserID', sql.NVarChar, effectiveActorId)
            .input('RawUserID', sql.NVarChar, String(userId || '').trim())
            .input('PageIndex', sql.Int, pageIndex)
            .input('DaysCount', sql.Int, daysCount);

        // إضافة معاملات القسم للمدير (إن وجدت)
        Object.entries(adminDeptParams).forEach(([name, val]) => {
            request.input(name, sql.Int, val);
        });

        const query = `
            DECLARE @EndDate DateTime = DATEADD(day, -(@PageIndex * @DaysCount), GETDATE());
            DECLARE @StartDate DateTime = DATEADD(day, -@DaysCount, @EndDate);

            WITH Events AS (
                SELECT
                    'task' as ItemType,
                    t.TaskID,
                    t.Title as TaskTitle,
                    t.Status as TaskStatus,
                    t.CreatedAt as CreatedAt,
                    ${taskActorExpr} as ActorID,
                    creator.${identityName} as ActorName,
                    ${taskAssignedIdExpr} as AssignedToID,
                    ${taskAssignedNameExpr} as AssignedToName,
                    CAST(NULL as int) as SubtaskID,
                    CAST(NULL as nvarchar(max)) as SubtaskTitle,
                    CAST(NULL as int) as CommentID,
                    CAST(NULL as nvarchar(max)) as CommentContent
                FROM Tasks t
                LEFT JOIN ${identityTable} creator ON ${taskActorExpr} = creator.${identityKey}
                ${taskAssigneeJoin}
                WHERE ${accessCondition}
                ${personalFilterClause}
                AND ${taskDateExpr} >= @StartDate AND ${taskDateExpr} <= @EndDate

                UNION ALL

                SELECT
                    'subtask' as ItemType,
                    t.TaskID,
                    t.Title as TaskTitle,
                    t.Status as TaskStatus,
                    s.CreatedAt as CreatedAt,
                    ${subActorExpr} as ActorID,
                    subCreator.${identityName} as ActorName,
                    s.${subAssignedCol} as AssignedToID,
                    subAssignee.${identityName} as AssignedToName,
                    s.SubtaskID as SubtaskID,
                    s.Title as SubtaskTitle,
                    CAST(NULL as int) as CommentID,
                    CAST(NULL as nvarchar(max)) as CommentContent
                FROM Subtasks s
                INNER JOIN Tasks t ON s.TaskID = t.TaskID
                LEFT JOIN ${identityTable} subCreator ON ${subActorExpr} = subCreator.${identityKey}
                LEFT JOIN ${identityTable} subAssignee ON s.${subAssignedCol} = subAssignee.${identityKey}
                WHERE ${accessCondition}
                ${personalFilterClause}
                AND s.CreatedAt >= @StartDate AND s.CreatedAt <= @EndDate

                UNION ALL

                SELECT
                    'comment' as ItemType,
                    t.TaskID,
                    t.Title as TaskTitle,
                    t.Status as TaskStatus,
                    c.CreatedAt as CreatedAt,
                    ${cmtActorExpr} as ActorID,
                    commenter.${identityName} as ActorName,
                    CAST(NULL as nvarchar(50)) as AssignedToID,
                    CAST(NULL as nvarchar(100)) as AssignedToName,
                    CAST(NULL as int) as SubtaskID,
                    CAST(NULL as nvarchar(max)) as SubtaskTitle,
                    c.CommentID as CommentID,
                    c.Content as CommentContent
                FROM Comments c
                INNER JOIN Tasks t ON c.TaskID = t.TaskID
                LEFT JOIN ${identityTable} commenter ON ${cmtActorExpr} = commenter.${identityKey}
                WHERE ${accessCondition}
                ${personalFilterClause}
                AND c.CreatedAt >= @StartDate AND c.CreatedAt <= @EndDate
            )
            SELECT *
            FROM Events
            ORDER BY CreatedAt DESC
        `;

        const result = await request.query(query);
        const items = (result.recordset || []).map(r => {
            try { if (r.TaskTitle) r.TaskTitle = encryptionConfig.decrypt(r.TaskTitle); } catch (_) {}
            try { if (r.SubtaskTitle) r.SubtaskTitle = encryptionConfig.decrypt(r.SubtaskTitle); } catch (_) {}
            try { if (r.CommentContent) r.CommentContent = encryptionConfig.decrypt(r.CommentContent); } catch (_) {}
            return r;
        });

        if (isAdmin !== 'true') {
            _activityLog(`result=${items.length} rows for userId=${userId}`);
        }
        return res.status(200).json(items);
    } catch (error) {
        console.error('DATABASE GET TASK ACTIVITY ERROR:', error);
        return res.status(500).json({ message: 'Error fetching task activity' });
    }
};

// الحصول على إشعارات الإسناد للمستخدم
exports.getAssignmentNotifications = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }
    
    try {
        const effectiveActorId = await resolveEffectiveActorId(pool, userId);
        const schema = await pool.request().query(`
            SELECT
              CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToVacancy,
              CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedByVacancy
        `);

        const s = schema.recordset[0] || {};
        const userDeptMatch = s.HasUsersDepartmentID ? ' OR u.DepartmentID = @DepartmentID' : '';
        const assignedToCol = s.HasAssignedToVacancy ? 'AssignedToVacancyID' : 'AssignedToUserID';
        const assignedByCol = s.HasAssignedByVacancy ? 'AssignedByVacancyID' : 'AssignedByUserID';
        const identityTable = s.HasAssignedByVacancy ? 'JobVacancies' : 'Users';
        const identityKey = s.HasAssignedByVacancy ? 'VacancyID' : 'UserID';
        const identityName = s.HasAssignedByVacancy ? 'Name' : 'FullName';

        const result = await pool.request()
            .input('UserID', sql.NVarChar, effectiveActorId)
            .query(`
                SELECT 
                    tan.*,
                    t.Title as TaskTitle,
                    assignedBy.${identityName} as AssignedByName
                FROM TaskAssignmentNotifications tan
                LEFT JOIN Tasks t ON tan.TaskID = t.TaskID
                LEFT JOIN ${identityTable} assignedBy ON tan.${assignedByCol} = assignedBy.${identityKey}
                WHERE tan.${assignedToCol} = @UserID
                AND tan.IsRead = 0
                ORDER BY tan.CreatedAt DESC
            `);
        const notifications = result.recordset.map(n => {
            if (n.TaskTitle) {
                try { n.TaskTitle = encryptionConfig.decrypt(n.TaskTitle); } catch (e) {}
            }
            return n;
        });
        res.status(200).json(notifications);
    } catch (error) {
        console.error('GET ASSIGNMENT NOTIFICATIONS ERROR:', error);
        res.status(500).send({ message: 'Error fetching assignment notifications' });
    }
};

// تحديد إشعار الإسناد كمقروء
exports.markAssignmentNotificationAsRead = async (req, res) => {
    const pool = req.app.locals.db;
    const { notificationId } = req.params;
    
    try {
        await pool.request()
            .input('NotificationID', sql.Int, notificationId)
            .query(`
                UPDATE TaskAssignmentNotifications 
                SET IsRead = 1, ReadAt = GETDATE() 
                WHERE NotificationID = @NotificationID
            `);
        res.status(200).json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('MARK NOTIFICATION AS READ ERROR:', error);
        res.status(500).send({ message: 'Error marking notification as read' });
    }
};

// إسناد المهمة الرئيسية
exports.assignTask = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    const { assignedToUserId, assignedByUserId } = req.body;

    if (assignedToUserId === undefined) {
        return res.status(400).json({ message: 'assignedToUserId field is required.' });
    }

    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const taskResult = await new sql.Request(transaction)
            .input('TaskID', sql.Int, id)
            .query('SELECT AssignedTo FROM Tasks WHERE TaskID = @TaskID');
        
        if (taskResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Task not found' });
        }

        const task = taskResult.recordset[0];
        const previousAssignedTo = task.AssignedTo;

        // 1. تحديث المهمة
        await new sql.Request(transaction)
            .input('TaskID', sql.Int, id)
            .input('AssignedTo', sql.NVarChar, assignedToUserId || null)
            .query('UPDATE Tasks SET AssignedTo = @AssignedTo WHERE TaskID = @TaskID');

        // 2. تسجيل النقل في سجل الدفعات (TaskTransferBatches)
        // نعتبر هذا "دفعة نقل" حتى لو كان عنصراً واحداً
        if (assignedByUserId && (previousAssignedTo !== assignedToUserId)) {
             const batchResult = await new sql.Request(transaction)
                .input('FromUserID', sql.NVarChar, previousAssignedTo || null) // قد يكون null إذا لم تكن مسندة
                .input('ToUserID', sql.NVarChar, assignedToUserId || null)
                .input('CreatedBy', sql.NVarChar, assignedByUserId)
                .query(`
                    INSERT INTO TaskTransferBatches (FromUserID, ToUserID, CreatedBy)
                    OUTPUT INSERTED.BatchID
                    VALUES (@FromUserID, @ToUserID, @CreatedBy)
                `);
            
            const batchId = batchResult.recordset[0].BatchID;

            // 3. تسجيل تفاصيل العنصر المنقول (TaskTransferItems)
            await new sql.Request(transaction)
                .input('BatchID', sql.Int, batchId)
                .input('TableName', sql.NVarChar, 'Tasks')
                .input('RecordID', sql.Int, id)
                .input('ColumnName', sql.NVarChar, 'AssignedTo')
                .input('OldValue', sql.NVarChar, previousAssignedTo ? String(previousAssignedTo) : null)
                .query(`
                    INSERT INTO TaskTransferItems (BatchID, TableName, RecordID, ColumnName, OldValue)
                    VALUES (@BatchID, @TableName, @RecordID, @ColumnName, @OldValue)
                `);
        }

        // 4. إشعار الإسناد (كما كان سابقاً)
        if (assignedToUserId && assignedToUserId !== previousAssignedTo && assignedByUserId) {
            await new sql.Request(transaction)
                .input('TaskID', sql.Int, id)
                .input('AssignedToUserID', sql.NVarChar, assignedToUserId)
                .input('AssignedByUserID', sql.NVarChar, assignedByUserId)
                .query(`
                    INSERT INTO TaskAssignmentNotifications 
                    (TaskID, AssignedToUserID, AssignedByUserID)
                    SELECT @TaskID, @AssignedToUserID, @AssignedByUserID
                    WHERE EXISTS (SELECT 1 FROM Users WHERE UserID = @AssignedByUserID)
                `);
        }

        await transaction.commit();
        res.status(200).json({ message: 'Task assigned successfully' });
    } catch (error) {
        if (transaction._aborted === false) {
             await transaction.rollback();
        }
        console.error('Error assigning task:', error);
        res.status(500).send({ message: 'Error assigning task' });
    }
};

exports.createTask = async (req, res) => {
  // createTask المصحح — يدعم مخطط VacancyID الجديد ومخطط UserID القديم، وكذلك المهام الشخصية
  const { Title, Description, DepartmentID, Priority, DueDate, subtasks, CreatedBy, ActedBy, CategoryID, URL, IsPersonal, PersonalOwnerUserID } = req.body;
  const encryptedDescription = Description ? encryptionConfig.encrypt(Description) : null;
  const encryptedTitle = encryptionConfig.encrypt(Title);
  const isPersonalTask = !!(IsPersonal);

  if (!Title || !DueDate || !CreatedBy) {
    return res.status(400).json({ message: 'Title, DueDate, and CreatedBy are required.' });
  }
  if (!isPersonalTask && !DepartmentID) {
    return res.status(400).json({ message: 'DepartmentID is required for non-personal tasks.' });
  }

  const pool = req.app.locals.db;
  if (!pool) {
    return res.status(503).send({ message: 'Database connection is not available.' });
  }

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    // تحديد الفاعل (actor) إذا كان مفوَّضاً
    let actorUserId = null;
    if (ActedBy && ActedBy !== CreatedBy) {
      try {
        const active = await hasActiveDelegation(pool, CreatedBy, ActedBy);
        if (active) actorUserId = ActedBy;
      } catch (_) { actorUserId = null; }
    }

    // فحص المخطط لاختيار أسماء الأعمدة الصحيحة
    const schema = await detectSchema(pool);

    // حل VacancyID للمنشئ والفاعل (إن وُجد المخطط الجديد)
    let createdByVacancyId = null;
    let actedByVacancyId = null;
    if (schema.hasTasksCreatedByVacancy || schema.hasTasksLastActedByVacancy) {
      createdByVacancyId = await resolveVacancyId(pool, CreatedBy);
      if (actorUserId) actedByVacancyId = await resolveVacancyId(pool, actorUserId);
    }

    // بناء INSERT لجدول Tasks ديناميكياً
    const taskCols = ['Title', 'Description', 'Priority', 'DueDate', 'Status', 'CategoryID', 'URL'];
    const taskVals = ['@Title', '@Description', '@Priority', '@DueDate', '\'open\'', '@CategoryID', '@URL'];

    const taskRequest = new sql.Request(transaction)
      .input('Title', sql.NVarChar, encryptedTitle)
      .input('Description', sql.NVarChar, encryptedDescription)
      .input('Priority', sql.NVarChar, Priority || 'normal')
      .input('DueDate', sql.DateTime, new Date(DueDate))
      .input('CategoryID', sql.Int, CategoryID || null)
      .input('URL', sql.NVarChar, URL ? String(URL).slice(0, 1000) : null);

    // DepartmentID: مطلوب للمهام العادية، NULL للمهام الشخصية
    taskCols.push('DepartmentID');
    taskVals.push('@DepartmentID');
    taskRequest.input('DepartmentID', sql.Int, isPersonalTask ? null : DepartmentID);

    // PersonalOwnerUserID: فقط للمهام الشخصية إذا كان العمود موجوداً
    const personalColProbe = await (new sql.Request(transaction)).query(
      `SELECT COL_LENGTH('dbo.Tasks','PersonalOwnerUserID') AS Len`
    );
    if (personalColProbe.recordset[0]?.Len && isPersonalTask && PersonalOwnerUserID) {
      taskCols.push('PersonalOwnerUserID');
      taskVals.push('@PersonalOwnerUserID');
      taskRequest.input('PersonalOwnerUserID', sql.NVarChar, String(PersonalOwnerUserID).trim());
    }

    // CreatedBy — VacancyID إن توفر، وإلا UserID نصي
    // للمهام الشخصية: نحاول تخزين VacancyID الحالي للمنشئ (للعرض)، لكن لا نوقف الإنشاء إذا لم يُوجد
    if (schema.hasTasksCreatedByVacancy) {
      if (createdByVacancyId == null && !isPersonalTask) {
        await transaction.rollback();
        return res.status(400).json({ message: 'تعذّر تحديد المنصب (VacancyID) للمنشئ. تأكد من وجود إسناد (Assignment) نشط.' });
      }
      if (createdByVacancyId != null) {
        taskCols.push('CreatedByVacancyID');
        taskVals.push('@CreatedByVacancyID');
        taskRequest.input('CreatedByVacancyID', sql.Int, createdByVacancyId);
      }
    } else {
      taskCols.push('CreatedBy');
      taskVals.push('@CreatedBy');
      taskRequest.input('CreatedBy', sql.NVarChar, CreatedBy);
    }

    // ActedBy / LastActedByVacancyID — اختياري (عند وجود تفويض)
    if (schema.hasTasksLastActedByVacancy) {
      taskCols.push('LastActedByVacancyID');
      taskVals.push('@LastActedByVacancyID');
      taskRequest.input('LastActedByVacancyID', sql.Int, actedByVacancyId);
    }
    // عمود ActedBy النصي يبقى للتسجيل التاريخي (UserID الفعلي للفاعل)
    taskCols.push('ActedBy');
    taskVals.push('@ActedBy');
    taskRequest.input('ActedBy', sql.NVarChar, actorUserId);

    const taskInsertSql = `
      INSERT INTO Tasks (${taskCols.join(', ')})
      OUTPUT INSERTED.TaskID
      VALUES (${taskVals.join(', ')});
    `;
    const taskResult = await taskRequest.query(taskInsertSql);
    const newTaskId = taskResult.recordset[0].TaskID;

    // المهام الفرعية
    if (subtasks && subtasks.length > 0) {
      for (const subtaskTitle of subtasks) {
        const encSubtaskTitle = encryptionConfig.encrypt(subtaskTitle);

        const subCols = ['TaskID', 'Title', 'IsCompleted', 'CreatedAt'];
        const subVals = ['@TaskID', '@Title', '0', 'GETDATE()'];

        const subRequest = new sql.Request(transaction)
          .input('TaskID', sql.Int, newTaskId)
          .input('Title', sql.NVarChar, encSubtaskTitle);

        // CreatedBy
        if (schema.hasSubtasksCreatedByVacancy) {
          subCols.push('CreatedByVacancyID');
          subVals.push('@CreatedByVacancyID');
          subRequest.input('CreatedByVacancyID', sql.Int, createdByVacancyId);
        } else {
          subCols.push('CreatedBy');
          subVals.push('@CreatedBy');
          subRequest.input('CreatedBy', sql.NVarChar, CreatedBy);
        }

        // AssignedTo — افتراضياً للمنشئ نفسه
        if (schema.hasSubtasksAssignedToVacancy) {
          subCols.push('AssignedToVacancyID');
          subVals.push('@AssignedToVacancyID');
          subRequest.input('AssignedToVacancyID', sql.Int, createdByVacancyId);
        } else {
          subCols.push('AssignedTo');
          subVals.push('@AssignedTo');
          subRequest.input('AssignedTo', sql.NVarChar, CreatedBy);
        }

        // ActedBy / LastActedByVacancyID
        if (schema.hasSubtasksLastActedByVacancy) {
          subCols.push('LastActedByVacancyID');
          subVals.push('@LastActedByVacancyID');
          subRequest.input('LastActedByVacancyID', sql.Int, actedByVacancyId);
        }
        subCols.push('ActedBy');
        subVals.push('@ActedBy');
        subRequest.input('ActedBy', sql.NVarChar, actorUserId);

        const subInsertSql = `
          INSERT INTO Subtasks (${subCols.join(', ')})
          VALUES (${subVals.join(', ')})
        `;
        await subRequest.query(subInsertSql);
      }
    }

    await transaction.commit();
    res.status(201).json({ message: 'Task and subtasks created successfully!', newTaskId });
  } catch (error) {
    try { await transaction.rollback(); } catch (_) {}
    console.error('CREATE TASK ERROR:', error);
    res.status(500).send({ message: 'Error creating task' });
  }
};

exports.getTaskById = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId, isAdmin } = req.query;
  
  // التحقق من وجود معرف المستخدم
  if (!userId) {
    return res.status(401).json({ message: 'User identification is required.' });
  }
  
  try {
    const { id } = req.params;

        const accessCheck = await checkTaskAccess(pool, id, userId, isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            const canViewByListRules = await canUserViewTaskByListRules(pool, userId, isAdmin === 'true', id);
            if (!canViewByListRules) {
                return res.status(403).json({ message: accessCheck.reason });
            }
        }
    
        const schema = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskCreatedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskCreatedByUser,
                CASE WHEN COL_LENGTH('dbo.Tasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskAssignedToVacancy,
                CASE WHEN COL_LENGTH('dbo.Tasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskAssignedToUser
        `);
        const s = schema.recordset[0] || {};
        const createdCol = s.HasTaskCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
        const hasAssignedToUser = !!s.HasTaskAssignedToUser;
        const assignedCol = s.HasTaskAssignedToVacancy ? 'AssignedToVacancyID' : (hasAssignedToUser ? 'AssignedTo' : null);
        const identityTable = s.HasTaskCreatedByVacancy ? 'JobVacancies' : 'Users';
        const identityKey = s.HasTaskCreatedByVacancy ? 'VacancyID' : 'UserID';
        const identityName = s.HasTaskCreatedByVacancy ? 'Name' : 'FullName';

        const assignedSelect = assignedCol
            ? `t.${assignedCol} as AssignedTo, assignee.${identityName} as AssignedToName,`
            : `CAST(NULL as nvarchar(50)) as AssignedTo, CAST(NULL as nvarchar(200)) as AssignedToName,`;
        const assigneeJoin = assignedCol
            ? `LEFT JOIN ${identityTable} assignee ON t.${assignedCol} = assignee.${identityKey}`
            : '';

        // الحصول على تفاصيل المهمة مع معلومات إضافية
        const result = await pool.request().input('TaskID', sql.Int, id).query(`
            SELECT t.*, creator.${identityName} as CreatedByName, acted.${identityName} as ActedByName,
                         ${assignedSelect}
                         c.Name as CategoryName
            FROM Tasks t
            LEFT JOIN ${identityTable} creator ON t.${createdCol} = creator.${identityKey}
            LEFT JOIN ${identityTable} acted ON COALESCE(t.ActedBy, t.LastActedByVacancyID, t.${createdCol}) = acted.${identityKey}
            ${assigneeJoin}
            LEFT JOIN Categories c ON t.CategoryID = c.CategoryID
            WHERE t.TaskID = @TaskID
        `);
    
    if (result.recordset.length === 0) { 
      return res.status(404).json({ message: 'Task not found' }); 
    }
    
    // إضافة معلومات نوصول للاستجابة
    const taskData = {
      ...result.recordset[0],
      accessType: accessCheck.accessType
    };
    // فك التشفير لوصف وعنوان المهمة إن وُجد
    if (taskData.Description) {
      try { taskData.Description = encryptionConfig.decrypt(taskData.Description); } catch (e) {}
    }
    if (taskData.Title) {
      try { taskData.Title = encryptionConfig.decrypt(taskData.Title); } catch (e) {}
    }
    res.status(200).json(taskData);
  } catch (error) { 
    console.error('Error fetching task details:', error);
    res.status(500).send({ message: 'Error fetching task details' }); 
  }
};

exports.getSubtasksForTask = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
    const { userId, isAdmin } = req.query;
  
  // التحقق من وجود معرف المستخدم
  if (!userId) {
    return res.status(401).json({ message: 'User identification is required.' });
  }
  
  try {
        const accessCheck = await checkTaskAccess(pool, id, userId, isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            const canViewByListRules = await canUserViewTaskByListRules(pool, userId, isAdmin === 'true', id);
            if (!canViewByListRules) {
                return res.status(403).json({ message: accessCheck.reason });
            }
        }
    
    // الحصول على المهام الفرعية
        const schema = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubAssignedToVacancy,
                CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubCreatedByVacancy
        `);
        const s = schema.recordset[0] || {};
        const assignedCol = s.HasSubAssignedToVacancy ? 'AssignedToVacancyID' : 'AssignedTo';
        const createdCol = s.HasSubCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
        const identityTable = s.HasSubAssignedToVacancy ? 'JobVacancies' : 'Users';
        const identityKey = s.HasSubAssignedToVacancy ? 'VacancyID' : 'UserID';
        const identityName = s.HasSubAssignedToVacancy ? 'Name' : 'FullName';

        const query = `
      SELECT s.*, 
                         u.${identityName} as AssignedToName,
                         creator.${identityName} as CreatedByName
      FROM Subtasks s 
            LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey} 
            LEFT JOIN ${identityTable} creator ON s.${createdCol} = creator.${identityKey}
      WHERE s.TaskID = @TaskID 
      ORDER BY s.CreatedAt DESC
    `;
    const request = pool.request().input('TaskID', sql.Int, id);
    const result = await request.query(query);
    const subtasks = result.recordset.map(s => {
      if (s.Title) {
        try { s.Title = encryptionConfig.decrypt(s.Title); } catch (_) {}
      }
      return s;
    });
    res.status(200).json(subtasks);
  } catch (error) { 
    console.error('Error fetching subtasks:', error);
    res.status(500).send({ message: 'Error fetching subtasks' }); 
  }
};

exports.getCommentsForTask = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
    const { userId, isAdmin } = req.query;
  
  // التحقق من وجود معرف المستخدم
  if (!userId) {
    return res.status(401).json({ message: 'User identification is required.' });
  }
  
  try {
        const accessCheck = await checkTaskAccess(pool, id, userId, isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            const canViewByListRules = await canUserViewTaskByListRules(pool, userId, isAdmin === 'true', id);
            if (!canViewByListRules) {
                return res.status(403).json({ message: accessCheck.reason });
            }
        }
    
    // الحصول على التعليقات
        const schema = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
                CASE WHEN COL_LENGTH('dbo.Comments', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByUser
        `);
        const s = schema.recordset[0] || {};
        const commentActorCol = s.HasCommentedByVacancy ? 'CommentedByVacancyID' : 'UserID';
        const identityTable = s.HasCommentedByVacancy ? 'JobVacancies' : 'Users';
        const identityKey = s.HasCommentedByVacancy ? 'VacancyID' : 'UserID';
        const identityName = s.HasCommentedByVacancy ? 'Name' : 'FullName';

        const result = await pool.request().input('TaskID', sql.Int, id).query(`
            SELECT c.*, u.${identityName} as UserName 
            FROM Comments c 
            LEFT JOIN ${identityTable} u ON COALESCE(c.ActedBy, c.LastActedByVacancyID, c.${commentActorCol}) = u.${identityKey} 
            WHERE c.TaskID = @TaskID 
            ORDER BY c.CreatedAt DESC
        `);
    const comments = result.recordset.map(c => {
      if (c.Content) {
        try { c.Content = encryptionConfig.decrypt(c.Content); } catch (e) {}
      }
      return c;
    });
    res.status(200).json(comments);
  } catch (error) { 
    console.error('Error fetching comments:', error);
    res.status(500).send({ message: 'Error fetching comments' }); 
  }
};

exports.getUsersByDepartment = async (req, res) => {
  const pool = req.app.locals.db;
  try {
        const { departmentId } = req.params;
        const parsedDepartmentId = parseInt(departmentId, 10);
        if (!Number.isInteger(parsedDepartmentId)) {
            return res.status(400).json({ message: 'departmentId must be an integer' });
        }

        const schema = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS UsesSubtaskVacancy,
                CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
                CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
                CASE WHEN COL_LENGTH('dbo.vw_UserCurrentProfile', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileDepartmentID,
                CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDepartmentID,
                CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
                CASE WHEN COL_LENGTH('dbo.Departments', 'ParentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
                CASE WHEN COL_LENGTH('dbo.Departments', 'ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDepartmentID,
                CASE WHEN COL_LENGTH('dbo.Departments', 'Type') IS NOT NULL THEN 1 ELSE 0 END AS HasDepartmentType
        `);
        const s = schema.recordset[0] || {};

        const parentCol = s.HasParentID ? 'ParentID' : (s.HasParentDepartmentID ? 'ParentDepartmentID' : null);
        // القاعدة الوظيفية: الأقسام ذات Type=0 هي وحدات مستقلة ومنفصلة تمامًا.
        // نصعد في الشجرة متوقفين عند أي قسم أب من نوع Type=0 (لا نعبر حدوده).
        // أعلى سلف نصل إليه قبل الوصول لـ Type=0 أو لقمة الشجرة يكون هو الجذر.
        // عند الهبوط، نستثني الأقسام Type=0 وجميع أبنائها.
        const rootCte = (parentCol && s.HasDepartmentType) ? `
            UpTree AS (
                SELECT DepartmentID, ${parentCol} AS ParentDepartmentID, 0 AS Depth
                FROM dbo.Departments
                WHERE DepartmentID = @DepartmentID
                UNION ALL
                SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID, u.Depth + 1
                FROM dbo.Departments d
                INNER JOIN UpTree u ON d.DepartmentID = u.ParentDepartmentID
                WHERE CAST(d.[Type] AS INT) <> 0 OR d.[Type] IS NULL
            ),
            RootDept AS (
                SELECT TOP 1 DepartmentID AS RootDepartmentID
                FROM UpTree
                ORDER BY Depth DESC
            )
        ` : (parentCol ? `
            UpTree AS (
                SELECT DepartmentID, ${parentCol} AS ParentDepartmentID
                FROM dbo.Departments
                WHERE DepartmentID = @DepartmentID
                UNION ALL
                SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID
                FROM dbo.Departments d
                INNER JOIN UpTree u ON d.DepartmentID = u.ParentDepartmentID
            ),
            RootDept AS (
                SELECT TOP 1 DepartmentID AS RootDepartmentID
                FROM UpTree
                WHERE ParentDepartmentID IS NULL
                ORDER BY DepartmentID
            )
        ` : '');
        // إن لم نجد جذرًا أثناء الصعود نستخدم DepartmentID نفسه كجذر (خطة أمان).
        const deptScopeCte = parentCol ? `
            WITH ${rootCte},
            RootDeptFallback AS (
                SELECT COALESCE((SELECT TOP 1 RootDepartmentID FROM RootDept), @DepartmentID) AS RootDepartmentID
            ),
            DeptTree AS (
                SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID
                FROM dbo.Departments d
                CROSS JOIN RootDeptFallback r
                WHERE d.DepartmentID = r.RootDepartmentID
                UNION ALL
                SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID
                FROM dbo.Departments d
                INNER JOIN DeptTree t ON d.${parentCol} = t.DepartmentID
                ${s.HasDepartmentType ? 'WHERE CAST(d.[Type] AS INT) <> 0 OR d.[Type] IS NULL' : ''}
            )
        ` : '';

        const inDeptProfile = parentCol
            ? `EXISTS (SELECT 1 FROM DeptTree dt WHERE dt.DepartmentID = p.DepartmentID)`
            : `p.DepartmentID = @DepartmentID`;
        const inDeptVacancy = parentCol
            ? `EXISTS (SELECT 1 FROM DeptTree dt WHERE dt.DepartmentID = jv.DepartmentID)`
            : `jv.DepartmentID = @DepartmentID`;
        const inDeptUsers = parentCol
            ? `EXISTS (SELECT 1 FROM DeptTree dt WHERE dt.DepartmentID = u.DepartmentID)`
            : `u.DepartmentID = @DepartmentID`;

        let result = { recordset: [] };

        if (s.UsesSubtaskVacancy) {
            if (s.HasProfileView) {
                const profileDeptPredicate = s.HasProfileDepartmentID ? inDeptProfile : '1=0';
                const usersDeptPredicate = s.HasUsersDepartmentID ? inDeptUsers : '1=0';
                const vacancyDeptPredicate = s.HasVacancyDepartmentID ? inDeptVacancy : '1=0';

                result = await pool.request()
                    .input('DepartmentID', sql.Int, parsedDepartmentId)
                    .query(`
                        ${deptScopeCte}
                        SELECT DISTINCT
                            u.UserID,
                            COALESCE(jv.Name, u.FullName, u.UserID)
                            + CASE
                                    WHEN jv.Name IS NOT NULL AND u.FullName IS NOT NULL AND LTRIM(RTRIM(u.FullName)) <> ''
                                        THEN N' - ' + u.FullName
                                    ELSE N''
                                END AS FullName,
                            p.VacancyID
                        FROM dbo.Users u
                        LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
                        LEFT JOIN dbo.JobVacancies jv ON p.VacancyID = jv.VacancyID
                        WHERE (
                                ${profileDeptPredicate}
                                OR ${vacancyDeptPredicate}
                                OR ${usersDeptPredicate}
                            )
                        ORDER BY FullName
                    `);
            }

            if ((!result.recordset || result.recordset.length === 0) && s.HasVacancyDepartmentID) {
                result = await pool.request()
                    .input('DepartmentID', sql.Int, parsedDepartmentId)
                    .query(`
                        ${deptScopeCte}
                        SELECT DISTINCT
                            CAST(jv.VacancyID AS NVARCHAR(50)) AS UserID,
                            COALESCE(jv.Name, CAST(jv.VacancyID AS NVARCHAR(50))) AS FullName,
                            jv.VacancyID
                        FROM dbo.JobVacancies jv
                        WHERE ${inDeptVacancy}
                        ORDER BY FullName
                    `);
            }

            if ((!result.recordset || result.recordset.length <= 1) && s.HasAssignmentsTable && s.HasVacancyDepartmentID) {
                result = await pool.request()
                    .input('DepartmentID', sql.Int, parsedDepartmentId)
                    .query(`
                        ${deptScopeCte}
                        SELECT DISTINCT
                            u.UserID,
                            COALESCE(jv.Name, u.FullName, u.UserID)
                            + CASE
                                    WHEN jv.Name IS NOT NULL AND u.FullName IS NOT NULL AND LTRIM(RTRIM(u.FullName)) <> ''
                                        THEN N' - ' + u.FullName
                                    ELSE N''
                                END AS FullName,
                            a.VacancyID
                        FROM dbo.Assignments a
                        INNER JOIN dbo.Users u ON a.UserID = u.UserID
                        LEFT JOIN dbo.JobVacancies jv ON a.VacancyID = jv.VacancyID
                        WHERE a.VacancyID IS NOT NULL
                            AND ${inDeptVacancy}
                        ORDER BY FullName
                    `);
            }
        } else if (s.HasUsersDepartmentID) {
            result = await pool.request()
                .input('DepartmentID', sql.Int, parsedDepartmentId)
                .query(`
                    ${deptScopeCte}
                    SELECT DISTINCT
                        u.UserID,
                        u.FullName,
                        NULL AS VacancyID
                    FROM dbo.Users u
                    WHERE ${inDeptUsers}
                    ORDER BY u.FullName
                `);
        }

        res.status(200).json(result.recordset || []);
    } catch (error) {
        console.error('GET USERS BY DEPARTMENT ERROR:', error);
        res.status(500).send({ message: 'Error fetching department users' });
    }
};

exports.updateTaskStatus = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    let { Status } = req.body;
    
    // التحقق من صحة الحالة
    const validStatuses = ['open', 'in-progress', 'completed', 'cancelled'];
    if (!Status || !validStatuses.includes(Status)) {
        return res.status(400).json({ message: 'Valid status is required (open, in-progress, completed, cancelled)' });
    }
    
    try {
        // جلب عنوان المهمة والقسم قبل التحديث (للسجل)
        const taskMeta = await pool.request()
            .input('TaskID', sql.Int, id)
            .query('SELECT TOP 1 Title, DepartmentID FROM dbo.Tasks WHERE TaskID = @TaskID');
        const meta = taskMeta.recordset[0] || {};

        await pool.request()
            .input('TaskID', sql.Int, id)
            .input('Status', sql.NVarChar, Status)
            .query('UPDATE Tasks SET Status = @Status WHERE TaskID = @TaskID');

        // تسجيل في سجل الإجراءات
        const trackedActions = { completed: 'completed', cancelled: 'cancelled', open: 'reopened', 'in-progress': 'reopened' };
        if (trackedActions[Status]) {
            const userId = req.body?.userId || req.body?.UserID || req.query?.userId;
            await logTaskAction(pool, {
                taskId:       parseInt(id, 10),
                taskTitle:    meta.Title    || null,
                departmentId: meta.DepartmentID || null,
                action:       trackedActions[Status],
                userId,
            });
        }

        res.status(200).json({ message: 'Task status updated successfully' });
    } catch (error) {
        console.error('UPDATE TASK STATUS ERROR:', error);
        res.status(500).send({ message: 'Error updating task status' });
    }
};

// الدالة القديمة للأولوية العامة (سيتم الاحتفاظ بها للتوافق مع النسخة السابقة)
exports.updateTaskPriority = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    const { priority } = req.body;
    
    if (!priority || !['normal', 'urgent'].includes(priority)) {
        return res.status(400).json({ message: 'Valid priority is required (normal, urgent)' });
    }
    
    try {
        await pool.request()
            .input('TaskID', sql.Int, id)
            .input('Priority', sql.NVarChar, priority)
            .query('UPDATE Tasks SET Priority = @Priority WHERE TaskID = @TaskID');
        res.status(200).json({ message: 'Task priority updated successfully' });
    } catch (error) {
        console.error('UPDATE TASK PRIORITY ERROR:', error);
        res.status(500).send({ message: 'Error updating task priority' });
    }
};

// دالة جديدة للأولوية الشخصية
exports.updateUserTaskPriority = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    const { priority } = req.body;
    const { userId } = req.query;
    
    console.log('UPDATE USER TASK PRIORITY - UserID:', userId, 'TaskID:', id, 'Priority:', priority);
    if (!priority || !['normal', 'urgent', 'starred'].includes(priority)) {
        return res.status(400).json({ message: 'Valid priority is required (normal, urgent, starred)' });
    }
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    try {
        const taskCheck = await pool.request()
            .input('TaskID', sql.Int, id)
            .query('SELECT TaskID FROM Tasks WHERE TaskID = @TaskID');

        if (taskCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'Task not found' });
        }

        const tableCheck = await pool.request()
            .query(`
                SELECT 
                    COUNT(*) as tableExists,
                    CASE WHEN COL_LENGTH('dbo.UserTaskPriorities', 'VacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyID,
                    CASE WHEN COL_LENGTH('dbo.UserTaskPriorities', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME = 'UserTaskPriorities'
            `);

        if (tableCheck.recordset[0].tableExists === 0) {
            return res.status(500).json({
                message: 'UserTaskPriorities table does not exist. Please run database migration first.',
                error: 'TABLE_NOT_EXISTS'
            });
        }

        const hasVacancyID = !!tableCheck.recordset[0].HasVacancyID;
        const hasUserID = !!tableCheck.recordset[0].HasUserID;
        const actorCol = hasVacancyID ? 'VacancyID' : (hasUserID ? 'UserID' : null);
        if (!actorCol) {
            return res.status(500).json({ message: 'No actor column found in UserTaskPriorities table' });
        }

        const effectiveActorId = String(await resolveEffectiveActorId(pool, userId) || '').trim();
        if (!effectiveActorId) {
            return res.status(400).json({ message: 'Unable to resolve user identity for priority update' });
        }

        await pool.request()
            .input('ActorID', sql.NVarChar, effectiveActorId)
            .input('TaskID', sql.Int, id)
            .input('Priority', sql.NVarChar, priority)
            .query(`
                MERGE UserTaskPriorities AS target
                USING (SELECT @ActorID AS ActorID, @TaskID AS TaskID, @Priority AS Priority) AS source
                ON target.${actorCol} = source.ActorID AND target.TaskID = source.TaskID
                WHEN MATCHED THEN
                    UPDATE SET Priority = source.Priority, UpdatedAt = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (${actorCol}, TaskID, Priority, CreatedAt, UpdatedAt)
                    VALUES (source.ActorID, source.TaskID, source.Priority, GETDATE(), GETDATE());
            `);
            
        console.log('SUCCESS: User task priority updated successfully');
        res.status(200).json({ message: 'User task priority updated successfully' });
    } catch (error) {
        console.error('UPDATE USER TASK PRIORITY ERROR:', error.message);
        console.error('Full error:', error);
        res.status(500).json({ 
            message: 'Error updating user task priority',
            error: error.message
        });
    }
};

// دالة للحصول على الأولوية الشخصية للمستخدم
exports.getUserTaskPriority = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
    }
    
    try {
        const tableCheck = await pool.request().query(`
            SELECT 
                COUNT(*) as tableExists,
                CASE WHEN COL_LENGTH('dbo.UserTaskPriorities', 'VacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyID,
                CASE WHEN COL_LENGTH('dbo.UserTaskPriorities', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'UserTaskPriorities'
        `);

        if (tableCheck.recordset[0].tableExists === 0) {
            return res.status(200).json({ priority: 'normal' });
        }

        const hasVacancyID = !!tableCheck.recordset[0].HasVacancyID;
        const hasUserID = !!tableCheck.recordset[0].HasUserID;
        const actorCol = hasVacancyID ? 'VacancyID' : (hasUserID ? 'UserID' : null);
        if (!actorCol) {
            return res.status(200).json({ priority: 'normal' });
        }

        const effectiveActorId = String(await resolveEffectiveActorId(pool, userId) || '').trim();
        if (!effectiveActorId) {
            return res.status(200).json({ priority: 'normal' });
        }

        const result = await pool.request()
            .input('ActorID', sql.NVarChar, effectiveActorId)
            .input('TaskID', sql.Int, id)
            .query(`
                SELECT Priority 
                FROM UserTaskPriorities 
                WHERE ${actorCol} = @ActorID AND TaskID = @TaskID
            `);
            
        if (result.recordset.length === 0) {
            // إذا لم توجد أولوية شخصية، إرجاع الأولوية الافتراضية
            return res.status(200).json({ priority: 'normal' });
        }
        
        res.status(200).json({ priority: result.recordset[0].Priority });
    } catch (error) {
        console.error('GET USER TASK PRIORITY ERROR:', error);
        res.status(500).json({ message: 'Error getting user task priority' });
    }
};

exports.deleteTask = async (req, res) => {
  const pool = req.app.locals.db;
  const { id: taskId } = req.params;
  const { userId, isAdmin } = req.body;

  // تحويل taskId إلى integer
  const taskIdInt = parseInt(taskId, 10);

  if (!userId) {
    return res.status(401).json({ message: 'User identification is required.' });
  }
  
  if (isNaN(taskIdInt)) {
    return res.status(400).json({ message: 'Invalid task ID' });
  }

  const transaction = new sql.Transaction(pool);
  
  try {
    await transaction.begin();
    
    const accessCheck = await checkTaskAccess(pool, taskIdInt, userId, isAdmin === 'true', 'delete');

    if (!accessCheck.hasAccess) {
      await transaction.rollback();
      return res.status(403).json({ message: accessCheck.reason });
    }

    // جلب بيانات المهمة للسجل قبل حذفها
    const taskMetaRes = await new sql.Request(transaction)
      .input('TaskID', sql.Int, taskIdInt)
      .query('SELECT TOP 1 Title, DepartmentID FROM dbo.Tasks WHERE TaskID = @TaskID');
    const taskMeta = taskMetaRes.recordset[0] || {};

    // حذف التعليقات المرتبطة بالمهمة
    await new sql.Request(transaction)
      .input('TaskID', sql.Int, taskIdInt)
      .query('DELETE FROM Comments WHERE TaskID = @TaskID');

    // حذف المهام الفرعية
    await new sql.Request(transaction)
      .input('TaskID', sql.Int, taskIdInt)
      .query('DELETE FROM Subtasks WHERE TaskID = @TaskID');

    // حذف ارتباطات المهمة مع مهام أخرى
    await new sql.Request(transaction)
      .input('TaskID', sql.Int, taskIdInt)
      .query(`IF OBJECT_ID('dbo.TaskRelations','U') IS NOT NULL
                DELETE FROM dbo.TaskRelations WHERE TaskID1 = @TaskID OR TaskID2 = @TaskID`);

    // حذف المهمة الرئيسية
    await new sql.Request(transaction)
      .input('TaskID', sql.Int, taskIdInt)
      .query('DELETE FROM Tasks WHERE TaskID = @TaskID');
    
    await transaction.commit();

    // تسجيل الحذف بعد نجاح العملية
    await logTaskAction(pool, {
      taskId:       taskIdInt,
      taskTitle:    taskMeta.Title        || null,
      departmentId: taskMeta.DepartmentID || null,
      action:       'deleted',
      userId,
    });

    res.status(200).json({ message: 'Task and all related data deleted successfully' });

  } catch (error) {
    await transaction.rollback();
    console.error('DATABASE DELETE TASK ERROR:', error);
    res.status(500).send({ message: 'Error deleting task' });
  }
};

// تحديث آخر مشاهدة للمهمة
exports.updateTaskView = async (req, res) => {
    const pool = req.app.locals.db;
    const { taskId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }
    
    try {
        const schema = await pool.request().query(`
            SELECT
              CASE WHEN COL_LENGTH('dbo.TaskViews', 'ViewedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasViewedByVacancy,
              CASE WHEN COL_LENGTH('dbo.TaskViews', 'UserID') IS NOT NULL THEN 1 ELSE 0 END AS HasUserID
        `);
        const s = schema.recordset[0] || {};
        const actorCol = s.HasViewedByVacancy ? 'ViewedByVacancyID' : (s.HasUserID ? 'UserID' : null);
        if (!actorCol) {
            return res.status(500).json({ message: 'No actor column found in TaskViews table' });
        }

        const effectiveActorId = String(await resolveEffectiveActorId(pool, userId) || '').trim();
        if (!effectiveActorId) {
            return res.status(400).json({ message: 'Unable to resolve user identity for task view update' });
        }

        await pool.request()
            .input('ActorID', sql.NVarChar, effectiveActorId)
            .input('TaskID', sql.Int, taskId)
            .query(`
                MERGE TaskViews AS target
                USING (SELECT @ActorID AS ActorID, @TaskID AS TaskID) AS source
                ON target.${actorCol} = source.ActorID AND target.TaskID = source.TaskID
                WHEN MATCHED THEN
                    UPDATE SET LastViewedAt = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (${actorCol}, TaskID, LastViewedAt)
                    VALUES (source.ActorID, source.TaskID, GETDATE());
            `);
        res.status(200).json({ message: 'Task view updated successfully' });
    } catch (error) {
        console.error('UPDATE TASK VIEW ERROR:', error);
        res.status(500).send({ message: 'Error updating task view' });
    }
};

// تحديث رابط المهمة الخارجي (URL)
exports.updateTaskUrl = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    let { url, Description, userId, isAdmin } = req.body;

    if (!userId) {
        return res.status(401).json({ message: 'User identification is required.' });
    }

    try {
        // التحقق من الصلاحية
        const accessCheck = await checkTaskAccess(pool, id, userId, isAdmin === true || isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية لتعديل هذه المهمة' });
        }
    } catch (error) {
        console.error('ACCESS CHECK ERROR:', error);
        return res.status(500).json({ message: 'Error checking access permissions' });
    }

    // قبول إفراغ الرابط بإرسال قيمة فارغة
    if (url !== undefined && typeof url === 'string') {
        url = url.trim();
        if (url.length === 0) {
            url = null;
        }
    }

    // التحقق الأساسي من المدخلات الخاصة بالرابط
    if (url !== null && url !== undefined && typeof url !== 'string') {
        return res.status(400).json({ message: 'Invalid url type' });
    }
    if (url && url.length > 1000) {
        return res.status(400).json({ message: 'URL is too long (max 1000 chars)' });
    }

    // تجهيز وصف المهمة (اختياري)
    let hasDescription = false;
    let encryptedDescription = null;
    if (typeof Description !== 'undefined') {
        hasDescription = true;
        if (Description && typeof Description === 'string') {
            try {
                encryptedDescription = encryptionConfig.encrypt(Description);
            } catch (e) {
                return res.status(500).json({ message: 'Error encrypting description' });
            }
        } else {
            encryptedDescription = null;
        }
    }

    try {
        const request = pool.request()
            .input('TaskID', sql.Int, id)
            .input('URL', sql.NVarChar, url || null)
            .input('HasDescription', sql.Bit, hasDescription ? 1 : 0)
            .input('Description', sql.NVarChar, encryptedDescription);

        const updateQuery = `
            UPDATE Tasks
            SET
              URL = @URL,
              Description = CASE WHEN @HasDescription = 1 THEN @Description ELSE Description END
            WHERE TaskID = @TaskID
        `;

        await request.query(updateQuery);
        res.status(200).json({ message: 'Task updated successfully' });
    } catch (error) {
        console.error('UPDATE TASK URL ERROR:', error);
        res.status(500).send({ message: 'Error updating task URL/description' });
    }
};

// تحديث عنوان المهمة
exports.updateTaskTitle = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    let { Title, userId, isAdmin } = req.body;

    if (!userId) {
        return res.status(401).json({ message: 'User identification is required.' });
    }

    if (typeof Title !== 'string') {
        return res.status(400).json({ message: 'Title is required and must be a string.' });
    }

    Title = Title.trim();
    if (!Title) {
        return res.status(400).json({ message: 'Title cannot be empty.' });
    }

    try {
        // التحقق من الصلاحية
        const accessCheck = await checkTaskAccess(pool, id, userId, isAdmin === true || isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية لتعديل هذه المهمة' });
        }
    } catch (error) {
        console.error('ACCESS CHECK ERROR:', error);
        return res.status(500).json({ message: 'Error checking access permissions' });
    }

    let encryptedTitle;
    try {
        encryptedTitle = encryptionConfig.encrypt(Title);
    } catch (e) {
        return res.status(500).json({ message: 'Error encrypting title' });
    }

    try {
        await pool.request()
            .input('TaskID', sql.Int, id)
            .input('Title', sql.NVarChar, encryptedTitle)
            .query(`
                UPDATE Tasks
                SET Title = @Title, UpdatedAt = GETDATE()
                WHERE TaskID = @TaskID
            `);
        return res.status(200).json({ message: 'Task title updated successfully' });
    } catch (error) {
        console.error('UPDATE TASK TITLE ERROR:', error);
        return res.status(500).json({ message: 'Error updating task title' });
    }
};

// الحصول على المهام مع معلومات الإشعارات
exports.getTasksWithNotifications = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, isAdmin, delegateUserId } = req.query;

    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }
    // إذا أُرسل delegateUserId فهذا طلب تفويض — لا تُرجع المهام الشخصية للمفوِّض
    const isDelegationRequest = !!(delegateUserId && String(delegateUserId).trim());

    try {
        const effectiveActorId = await resolveEffectiveActorId(pool, userId);
        res.set('X-Effective-Actor-ID', String(effectiveActorId || ''));
        let sN = _tcache.schemaN && (Date.now() - _tcache.schemaNTs < SCHEMA_TTL) ? _tcache.schemaN : null;
        if (!sN) {
            const schemaRes = await pool.request().query(`
                SELECT
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskVacancy,
                  CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubVacancy,
                  CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorVacancyID') IS NOT NULL
                         AND COL_LENGTH('dbo.TaskDelegations', 'DelegateVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasDelegationVacancy,
                  CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignNotifVacancy,
                  CASE WHEN COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentNotifVacancy,
                  CASE WHEN COL_LENGTH('dbo.TaskViews', 'ViewedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskViewsVacancy,
                  CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentVacancy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
                  CASE WHEN COL_LENGTH('dbo.Tasks', 'PersonalOwnerUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasPersonalOwner
            `);
            sN = schemaRes.recordset[0] || {};
            _tcache.schemaN = sN; _tcache.schemaNTs = Date.now();
        }
        const s = sN;
        const isVacancy = !!(s.HasTaskVacancy || s.HasSubVacancy || s.HasDelegationVacancy);

        const taskCreatorCol = isVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
        const taskAssignedCol = isVacancy ? null : 'AssignedTo';
        const subAssignedCol = isVacancy ? 'AssignedToVacancyID' : 'AssignedTo';
        const delegatorCol = isVacancy ? 'DelegatorVacancyID' : 'DelegatorUserID';
        const delegateCol = isVacancy ? 'DelegateVacancyID' : 'DelegateUserID';
        const assignNotifCol = s.HasAssignNotifVacancy ? 'AssignedToVacancyID' : 'AssignedToUserID';
        const commentNotifCol = s.HasCommentNotifVacancy ? 'NotifyVacancyID' : 'NotifyUserID';
        const taskViewCol = s.HasTaskViewsVacancy ? 'ViewedByVacancyID' : 'UserID';
        const identityTable = isVacancy ? 'JobVacancies' : 'Users';
        const identityKey = isVacancy ? 'VacancyID' : 'UserID';
        const identityName = isVacancy ? 'Name' : 'FullName';
        const commentAuthorCol = s.HasCommentVacancy ? 'CommentedByVacancyID' : 'UserID';
        // بناء عمود "آخر من تصرف" — لا نخلط أعمدة INT مع NVARCHAR في COALESCE
        const actedByCoalesce = (() => {
            if (isVacancy) {
                // المخطط الجديد: أعمدة INT فقط
                return s.HasLastActedByVacancy
                    ? `COALESCE(t.LastActedByVacancyID, t.${taskCreatorCol})`
                    : `t.${taskCreatorCol}`;
            } else {
                // المخطط القديم: أعمدة NVARCHAR فقط
                return s.HasActedBy
                    ? `COALESCE(t.ActedBy, t.${taskCreatorCol})`
                    : `t.${taskCreatorCol}`;
            }
        })();

        const scopeDepartmentIds = isAdmin === 'true' ? [] : await resolveUserDirectorateDepartmentIds(pool, userId);

        // دعم المهام الشخصية — القيمة متوفرة من الـ probe المُخزَّن
        const hasPersonalColN = !!s.HasPersonalOwner;
        const personalUserIdN = isDelegationRequest ? null : await resolveUserIDFromActor(pool, userId);

        const delegationAccessExpr = hasPersonalColN
            ? `(t.PersonalOwnerUserID IS NULL AND EXISTS (
                SELECT 1
                FROM TaskDelegations d
                WHERE d.${delegatorCol} = t.${taskCreatorCol}
                  AND d.${delegateCol} = @UserID
                  AND d.IsActive = 1
                  AND d.StartDate <= GETDATE()
                  AND (d.EndDate IS NULL OR d.EndDate >= GETDATE())
            ))`
            : `EXISTS (
                SELECT 1
                FROM TaskDelegations d
                WHERE d.${delegatorCol} = t.${taskCreatorCol}
                  AND d.${delegateCol} = @UserID
                  AND d.IsActive = 1
                  AND d.StartDate <= GETDATE()
                  AND (d.EndDate IS NULL OR d.EndDate >= GETDATE())
            )`;

        const accessParts = [
            `t.${taskCreatorCol} = @UserID`,
            `EXISTS (SELECT 1 FROM Subtasks s_inner WHERE s_inner.TaskID = t.TaskID AND s_inner.${subAssignedCol} = @UserID)`,
            `EXISTS (SELECT 1 FROM Comments cm_inner WHERE cm_inner.TaskID = t.TaskID AND cm_inner.${commentAuthorCol} = @UserID)`,
            delegationAccessExpr
        ];
        if (taskAssignedCol) {
            accessParts.splice(1, 0, `t.${taskAssignedCol} = @UserID`);
        }
        if (scopeDepartmentIds.length > 0) {
            const scopeParams = scopeDepartmentIds.map((_, index) => `@ScopeDepartmentID${index}`).join(', ');
            accessParts.push(`t.DepartmentID IN (${scopeParams})`);
        }
        if (hasPersonalColN && personalUserIdN) {
            accessParts.push(`t.PersonalOwnerUserID = @PersonalUserID`);
        }

        const assigneeSelect = taskAssignedCol
            ? `t.${taskAssignedCol} as AssignedTo, assignee.${identityName} as AssignedToName,`
            : `CAST(NULL as nvarchar(50)) as AssignedTo, CAST(NULL as nvarchar(200)) as AssignedToName,`;

        const assigneeJoin = taskAssignedCol
            ? `LEFT JOIN ${identityTable} assignee ON t.${taskAssignedCol} = assignee.${identityKey}`
            : '';

        const query = `
            SELECT DISTINCT
                t.*,
                creator.${identityName} as CreatedByName,
                acted.${identityName} as ActedByName,
                ${assigneeSelect}
                c.Name as CategoryName,
                CASE WHEN t.DepartmentID IS NULL THEN 1 ELSE 0 END AS IsPersonalTask,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM Subtasks s
                        WHERE s.TaskID = t.TaskID
                    ) THEN 1
                    ELSE 0
                END as HasNewSubtasks,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM TaskAssignmentNotifications tan
                        WHERE tan.TaskID = t.TaskID
                          AND tan.${assignNotifCol} = @UserID
                          AND tan.IsRead = 0
                          AND tan.CreatedAt > ISNULL(tv.LastViewedAt, '1900-01-01')
                    ) THEN 1
                    ELSE 0
                END as HasAssignmentNotifications,
                (
                    SELECT COUNT(*)
                    FROM CommentNotifications cn
                    WHERE cn.TaskID = t.TaskID
                      AND cn.${commentNotifCol} = @UserID
                      AND cn.IsRead = 0
                      AND cn.CreatedAt > ISNULL(tv.LastViewedAt, '1900-01-01')
                ) as HasCommentNotifications
            FROM Tasks t
            LEFT JOIN ${identityTable} creator ON t.${taskCreatorCol} = creator.${identityKey}
            LEFT JOIN ${identityTable} acted ON ${actedByCoalesce} = acted.${identityKey}
            ${assigneeJoin}
            LEFT JOIN Categories c ON t.CategoryID = c.CategoryID
            LEFT JOIN TaskViews tv ON tv.TaskID = t.TaskID AND tv.${taskViewCol} = @UserID
            WHERE t.Status NOT IN ('completed', 'cancelled')
              AND (${isAdmin === 'true' ? '1=1' : accessParts.join(' OR ')})
              ${hasPersonalColN ? `AND (t.PersonalOwnerUserID IS NULL OR t.PersonalOwnerUserID = @PersonalUserID)` : ''}
            ORDER BY t.CreatedAt DESC
        `;

        const request = pool.request().input('UserID', sql.NVarChar, effectiveActorId);
        if (hasPersonalColN) {
            request.input('PersonalUserID', sql.NVarChar, personalUserIdN ?? null);
        }
        scopeDepartmentIds.forEach((departmentId, index) => {
            request.input(`ScopeDepartmentID${index}`, sql.NVarChar, departmentId);
        });
        const result = await request.query(query);
        const tasks = result.recordset.map(t => {
            if (t.Description) {
                try { t.Description = encryptionConfig.decrypt(t.Description); } catch (e) {}
            }
            if (t.Title) {
                try { t.Title = encryptionConfig.decrypt(t.Title); } catch (e) {}
            }
            return t;
        });
        res.status(200).json(tasks);
    } catch (error) {
        console.error('GET TASKS WITH NOTIFICATIONS ERROR:', error);
        res.status(500).send({ message: 'Error fetching tasks with notifications' });
    }
};

// تحديث تصنيف المهمة
exports.updateTaskCategory = async (req, res) => {
    const pool = req.app.locals.db;
    const { taskId } = req.params;
    const { CategoryID, userId, isAdmin } = req.body;
    
    if (!userId) {
        return res.status(401).json({ message: 'User identification is required.' });
    }

    try {
        // التحقق من الصلاحية
        const accessCheck = await checkTaskAccess(pool, taskId, userId, isAdmin === true || isAdmin === 'true', 'view');
        if (!accessCheck.hasAccess) {
            return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية لتعديل هذه المهمة' });
        }

        const request = pool.request();
        request.input('TaskID', sql.Int, taskId);
        request.input('CategoryID', sql.Int, CategoryID);
        
        const updateQuery = `
            UPDATE Tasks 
            SET CategoryID = @CategoryID, UpdatedAt = GETDATE()
            WHERE TaskID = @TaskID
        `;
        
        await request.query(updateQuery);
        res.status(200).json({ message: 'تم تحديث تصنيف المهمة بنجاح' });
    } catch (error) {
        console.error('UPDATE TASK CATEGORY ERROR:', error);
        res.status(500).json({ message: 'خطأ في تحديث تصنيف المهمة' });
    }
};

// الحصول على المهام المكتملة للمستخدم (عند الحاجة فقط، مع دعم التصفح على دفعات)
// ===== أدوات مساعدة مشتركة للمهام المكتملة / البحث =====
// تبني أسماء أعمدة وJOINات صحيحة حسب المخطط (VacancyID جديد / UserID قديم).
async function buildCompletedTasksContext(pool) {
    const schema = await detectSchema(pool);
    const idTable = schema.isVacancy ? 'JobVacancies' : 'Users';
    const idKey   = schema.isVacancy ? 'VacancyID'    : 'UserID';
    const idName  = schema.isVacancy ? 'Name'         : 'FullName';

    return {
        schema,
        // أعمدة Tasks
        taskCreatedCol:   schema.tasksCreatedByCol,      // CreatedByVacancyID أو CreatedBy
        taskActedCol:     schema.tasksLastActedByCol,    // LastActedByVacancyID أو ActedBy
        // أعمدة Subtasks
        subAssignedCol:   schema.subtasksAssignedToCol,  // AssignedToVacancyID أو AssignedTo
        subCreatedCol:    schema.subtasksCreatedByCol,
        // أعمدة Comments
        commentAuthorCol: schema.isVacancy ? 'CommentedByVacancyID' : 'UserID',
        // جدول الهوية والانضمام
        idTable, idKey, idName,
        // SQL type للمعرّف أثناء الربط
        sqlIdType: schema.isVacancy ? sql.Int : sql.NVarChar,
    };
}

// يُرجِع قيمة @UserID (إما VacancyID int أو UserID نصّي) المناسبة للاستعلامات.
// في مخطط VacancyID نحتاج VacancyID الحالية للمستخدم؛ في المخطط القديم نستخدم UserID.
async function resolvePrincipalForCompletedSearch(pool, rawUserId, ctx) {
    if (ctx.schema.isVacancy) {
        const vid = await resolveVacancyId(pool, rawUserId);
        return vid; // قد تكون null — سيُعالَج من المستدعي
    }
    return String(rawUserId || '').trim();
}

exports.getCompletedTasks = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, isAdmin } = req.query;
    if (!userId) {
        return res.status(401).json({ message: 'User identification is required.' });
    }

    // إعداد معلومات التصفح
    let { page = 1, pageSize = 10 } = req.query;
    page = parseInt(page, 10) || 1;
    pageSize = parseInt(pageSize, 10) || 10;
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 10;
    if (pageSize > 100) pageSize = 100;
    const offset = (page - 1) * pageSize;

    try {
        const ctx = await buildCompletedTasksContext(pool);
        const isAdminFlag = isAdmin === 'true' || isAdmin === true;

        // دعم المهام الشخصية
        const personalColProbeC = await pool.request().query(`SELECT COL_LENGTH('dbo.Tasks','PersonalOwnerUserID') AS Len`);
        const hasPersonalColC = !!(personalColProbeC.recordset[0]?.Len);
        const personalUserIdC = await resolveUserIDFromActor(pool, userId);

        const scopeDepartmentIds = isAdminFlag ? [] : await resolveUserDirectorateDepartmentIds(pool, userId);
        const deptScopeClause = scopeDepartmentIds.length > 0
            ? ` OR t.DepartmentID IN (${scopeDepartmentIds.map((_, i) => `@ScopeDepartmentID${i}`).join(', ')})`
            : '';

        const principal = isAdminFlag ? null : await resolvePrincipalForCompletedSearch(pool, userId, ctx);
        // إذا كان الموظف عادياً لكن لم نستطع تحويله إلى VacancyID وليس لديه نطاق قسم،
        // لا نزال نُرجع المهام الشخصية إن وُجدت
        if (!isAdminFlag && principal == null && scopeDepartmentIds.length === 0 && !hasPersonalColC) {
            return res.status(200).json([]);
        }

        let query;
        if (isAdminFlag) {
            // المدير يرى جميع المهام المكتملة/الملغاة (لكن ليس المهام الشخصية لغيره)
            const adminPersonalFilter = hasPersonalColC
                ? `AND (t.PersonalOwnerUserID IS NULL OR t.PersonalOwnerUserID = @PersonalUserID)`
                : '';
            query = `
                SELECT t.*,
                       creator.${ctx.idName} AS CreatedByName,
                       acted.${ctx.idName}   AS ActedByName,
                       cat.Name              AS CategoryName
                FROM Tasks t
                LEFT JOIN ${ctx.idTable} creator ON t.${ctx.taskCreatedCol} = creator.${ctx.idKey}
                LEFT JOIN ${ctx.idTable} acted   ON t.${ctx.taskActedCol}   = acted.${ctx.idKey}
                LEFT JOIN Categories cat         ON t.CategoryID            = cat.CategoryID
                WHERE t.Status IN ('completed', 'cancelled')
                ${adminPersonalFilter}
                ORDER BY t.CreatedAt DESC
                OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
            `;
        } else {
            // مستخدم عادي: يرى المهام التي أنشأها، أو أُسنِد له فيها مهمة فرعية،
            // أو علّق عليها — مع توسيع النطاق عبر أقسام المديرية + المهام الشخصية.
            const principalClauses = [];
            if (principal != null) {
                principalClauses.push(`t.${ctx.taskCreatedCol} = @UserID`);
                principalClauses.push(`EXISTS (SELECT 1 FROM Subtasks s WHERE s.TaskID = t.TaskID AND s.${ctx.subAssignedCol} = @UserID)`);
                principalClauses.push(`EXISTS (SELECT 1 FROM Comments cm WHERE cm.TaskID = t.TaskID AND cm.${ctx.commentAuthorCol} = @UserID)`);
            }
            if (scopeDepartmentIds.length > 0) {
                principalClauses.push(`t.DepartmentID IN (${scopeDepartmentIds.map((_, i) => `@ScopeDepartmentID${i}`).join(', ')})`);
            }
            if (hasPersonalColC) {
                principalClauses.push(`t.PersonalOwnerUserID = @PersonalUserID`);
            }
            const accessWhere = principalClauses.length > 0
                ? `(${principalClauses.join(' OR ')})`
                : '1 = 0';

            query = `
                SELECT DISTINCT t.*,
                       creator.${ctx.idName} AS CreatedByName,
                       acted.${ctx.idName}   AS ActedByName,
                       cat.Name              AS CategoryName
                FROM Tasks t
                LEFT JOIN ${ctx.idTable} creator ON t.${ctx.taskCreatedCol} = creator.${ctx.idKey}
                LEFT JOIN ${ctx.idTable} acted   ON t.${ctx.taskActedCol}   = acted.${ctx.idKey}
                LEFT JOIN Categories cat         ON t.CategoryID            = cat.CategoryID
                WHERE t.Status IN ('completed', 'cancelled')
                  AND ${accessWhere}
                ORDER BY t.CreatedAt DESC
                OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
            `;
        }

        const request = pool.request()
            .input('Offset', sql.Int, offset)
            .input('PageSize', sql.Int, pageSize);
        if (!isAdminFlag && principal != null) {
            request.input('UserID', ctx.sqlIdType, principal);
        }
        if (hasPersonalColC) {
            request.input('PersonalUserID', sql.NVarChar, personalUserIdC);
        }
        scopeDepartmentIds.forEach((departmentId, i) => {
            request.input(`ScopeDepartmentID${i}`, sql.Int, parseInt(departmentId, 10));
        });

        const result = await request.query(query);
        const tasks = result.recordset.map(t => {
            if (t.Description) { try { t.Description = encryptionConfig.decrypt(t.Description); } catch (e) {} }
            if (t.Title)       { try { t.Title       = encryptionConfig.decrypt(t.Title);       } catch (e) {} }
            return t;
        });

        res.status(200).json(tasks);
    } catch (error) {
        console.error('DATABASE GET COMPLETED TASKS ERROR:', error);
        res.status(500).send({ message: 'Error fetching completed tasks' });
    }
};

// الحصول على سجل تنقلات المهمة - REMOVED
// exports.getTaskTransferHistory was here

// البحث في المهام المكتملة في قاعدة البيانات (العنوان، التفاصيل، المهام الفرعية، التعليقات)
// قواعد الوصول للمستخدم غير الإداري:
//   1. أنشأ المهمة بنفسه (Tasks.CreatedBy* = principal)
//   2. أُسنِد له مهمة فرعية فيها (Subtasks.AssignedTo* = principal)
//   3. علّق عليها (Comments.Author* = principal)
//   4. المهمة تتبع قسماً من أقسام مديريته (اختياري حسب resolveUserDirectorateDepartmentIds)
exports.searchCompletedTasks = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, isAdmin, q, maxScan } = req.query;

    if (!userId) {
        return res.status(401).json({ message: 'User identification is required.' });
    }
    if (!q || !q.trim()) {
        return res.status(400).json({ message: 'Search query (q) is required.' });
    }

    const searchTerm = q.toLowerCase();
    const maxTasksToScan = Math.min(Math.max(parseInt(maxScan, 10) || 600, 50), 3000);

    try {
        const ctx = await buildCompletedTasksContext(pool);
        const isAdminFlag = isAdmin === 'true' || isAdmin === true;

        const scopeDepartmentIds = isAdminFlag ? [] : await resolveUserDirectorateDepartmentIds(pool, userId);
        const principal = isAdminFlag ? null : await resolvePrincipalForCompletedSearch(pool, userId, ctx);

        // لو كان الموظف عادياً ولم نتمكن من تحديد هويته في المخطط الحالي
        // ولا لديه نطاق أقسام يستطيع تصفّحه — أرجع قائمة فارغة بدل 500.
        if (!isAdminFlag && principal == null && scopeDepartmentIds.length === 0) {
            return res.status(200).json([]);
        }

        let tasksQuery;

        if (isAdminFlag) {
            tasksQuery = `
                SELECT TOP (@MaxScan) t.*,
                       creator.${ctx.idName} AS CreatedByName,
                       acted.${ctx.idName}   AS ActedByName,
                       cat.Name              AS CategoryName
                FROM Tasks t
                LEFT JOIN ${ctx.idTable} creator ON t.${ctx.taskCreatedCol} = creator.${ctx.idKey}
                LEFT JOIN ${ctx.idTable} acted   ON t.${ctx.taskActedCol}   = acted.${ctx.idKey}
                LEFT JOIN Categories cat         ON t.CategoryID            = cat.CategoryID
                WHERE t.Status IN ('completed', 'cancelled')
                ORDER BY t.CreatedAt DESC
            `;
        } else {
            // بناء شرط الوصول ديناميكياً
            const principalClauses = [];
            if (principal != null) {
                principalClauses.push(`t.${ctx.taskCreatedCol} = @UserID`);
                principalClauses.push(`EXISTS (SELECT 1 FROM Subtasks s WHERE s.TaskID = t.TaskID AND s.${ctx.subAssignedCol} = @UserID)`);
                principalClauses.push(`EXISTS (SELECT 1 FROM Comments cm WHERE cm.TaskID = t.TaskID AND cm.${ctx.commentAuthorCol} = @UserID)`);
            }
            if (scopeDepartmentIds.length > 0) {
                principalClauses.push(`t.DepartmentID IN (${scopeDepartmentIds.map((_, index) => `@ScopeDepartmentID${index}`).join(', ')})`);
            }
            const accessWhere = principalClauses.length > 0
                ? `(${principalClauses.join(' OR ')})`
                : '1 = 0';

            tasksQuery = `
                SELECT DISTINCT TOP (@MaxScan) t.*,
                       creator.${ctx.idName} AS CreatedByName,
                       acted.${ctx.idName}   AS ActedByName,
                       cat.Name              AS CategoryName
                FROM Tasks t
                LEFT JOIN ${ctx.idTable} creator ON t.${ctx.taskCreatedCol} = creator.${ctx.idKey}
                LEFT JOIN ${ctx.idTable} acted   ON t.${ctx.taskActedCol}   = acted.${ctx.idKey}
                LEFT JOIN Categories cat         ON t.CategoryID            = cat.CategoryID
                WHERE t.Status IN ('completed', 'cancelled')
                  AND ${accessWhere}
                ORDER BY t.CreatedAt DESC
            `;
        }

        const request = pool.request().input('MaxScan', sql.Int, maxTasksToScan);
        if (!isAdminFlag && principal != null) {
            request.input('UserID', ctx.sqlIdType, principal);
        }
        scopeDepartmentIds.forEach((departmentId, index) => {
            request.input(`ScopeDepartmentID${index}`, sql.Int, parseInt(departmentId, 10));
        });

        const tasksResult = await request.query(tasksQuery);
        let tasks = tasksResult.recordset.map(t => {
            if (t.Description) {
                try { t.Description = encryptionConfig.decrypt(t.Description); } catch (e) {}
            }
            if (t.Title) {
                try { t.Title = encryptionConfig.decrypt(t.Title); } catch (e) {}
            }
            return t;
        });

        if (tasks.length === 0) {
            return res.status(200).json([]);
        }

        // المرحلة الأولى: مطابقة حقول المهمة نفسها فقط (أسرع)
        const taskFieldMatches = new Set();
        for (const t of tasks) {
            const matchesTaskFields =
                (t.Title && t.Title.toLowerCase().includes(searchTerm)) ||
                (t.Description && t.Description.toLowerCase().includes(searchTerm)) ||
                (t.CreatedByName && t.CreatedByName.toLowerCase().includes(searchTerm)) ||
                (t.ActedByName && t.ActedByName.toLowerCase().includes(searchTerm));
            if (matchesTaskFields) {
                taskFieldMatches.add(t.TaskID);
            }
        }

        // المرحلة الثانية: نبحث داخل المهام الفرعية/التعليقات فقط للمهام غير المطابقة أولياً
        const unresolvedTaskIds = tasks
            .map(t => Number(t.TaskID))
            .filter(id => Number.isFinite(id) && !taskFieldMatches.has(id));

        let subtasksByTaskId = {};
        let commentsByTaskId = {};

        if (unresolvedTaskIds.length > 0) {
            const unresolvedIdsList = unresolvedTaskIds.join(',');

            const subtasksResult = await pool.request()
                .input('TaskIDs', sql.NVarChar(sql.MAX), unresolvedIdsList)
                .query(`
                SELECT s.*,
                       assignee.${ctx.idName} AS AssignedToName,
                       creator.${ctx.idName}  AS CreatedByName
                FROM Subtasks s
                LEFT JOIN ${ctx.idTable} assignee ON s.${ctx.subAssignedCol} = assignee.${ctx.idKey}
                LEFT JOIN ${ctx.idTable} creator  ON s.${ctx.subCreatedCol}  = creator.${ctx.idKey}
                WHERE s.TaskID IN (
                    SELECT TRY_CAST(value AS INT)
                    FROM STRING_SPLIT(@TaskIDs, ',')
                    WHERE TRY_CAST(value AS INT) IS NOT NULL
                )
                ORDER BY s.CreatedAt DESC
            `);
            subtasksByTaskId = subtasksResult.recordset.reduce((acc, s) => {
                if (s.Title) {
                    try { s.Title = encryptionConfig.decrypt(s.Title); } catch (_) {}
                }
                if (!acc[s.TaskID]) acc[s.TaskID] = [];
                acc[s.TaskID].push(s);
                return acc;
            }, {});

            const commentsResult = await pool.request()
                .input('TaskIDs', sql.NVarChar(sql.MAX), unresolvedIdsList)
                .query(`
                SELECT c.*, author.${ctx.idName} AS UserName
                FROM Comments c
                LEFT JOIN ${ctx.idTable} author ON c.${ctx.commentAuthorCol} = author.${ctx.idKey}
                WHERE c.TaskID IN (
                    SELECT TRY_CAST(value AS INT)
                    FROM STRING_SPLIT(@TaskIDs, ',')
                    WHERE TRY_CAST(value AS INT) IS NOT NULL
                )
                ORDER BY c.CreatedAt DESC
            `);
            commentsByTaskId = commentsResult.recordset.reduce((acc, c) => {
                if (c.Content) {
                    try { c.Content = encryptionConfig.decrypt(c.Content); } catch (e) {}
                }
                if (!acc[c.TaskID]) acc[c.TaskID] = [];
                acc[c.TaskID].push(c);
                return acc;
            }, {});
        }

        const filteredTasks = tasks
            .map(t => {
                const taskSubtasks = subtasksByTaskId[t.TaskID] || [];
                const taskComments = commentsByTaskId[t.TaskID] || [];

                const matchesSearch =
                    taskFieldMatches.has(t.TaskID) ||
                    (taskSubtasks.length > 0 &&
                        taskSubtasks.some(st => st.Title && st.Title.toLowerCase().includes(searchTerm))) ||
                    (taskComments.length > 0 &&
                        taskComments.some(c => c.Content && c.Content.toLowerCase().includes(searchTerm)));

                if (!matchesSearch) {
                    return null;
                }

                return {
                    ...t,
                    subtasks: taskSubtasks,
                    comments: taskComments
                };
            })
            .filter(t => t !== null);

        res.status(200).json(filteredTasks);
    } catch (error) {
        console.error('DATABASE SEARCH COMPLETED TASKS ERROR:', error);
        res.status(500).send({ message: 'Error searching completed tasks' });
    }
};

// GET /api/tasks/search?q=...&userId=...&isAdmin=...&excludeTaskId=...
// بحث في جميع المهام (نشطة + مكتملة): العنوان + الوصف + المهام الفرعية + التعليقات
exports.searchActiveTasks = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, isAdmin, q, excludeTaskId, personalOnly, originalUserId, deptId } = req.query;
    if (!userId) return res.status(401).json({ message: 'User identification is required.' });

    // وضع البحث في المهام الخاصة — يشمل مهام المستخدم الشخصية + أي مهمة قام بإنشائها
    if (personalOnly === 'true') {
        try {
            const ownerUserId = String(originalUserId || userId).trim();
            if (!ownerUserId) return res.json([]);

            const excludeId = excludeTaskId ? parseInt(excludeTaskId, 10) : null;
            const trimmedQ2 = (q || '').trim();

            // لا نستخدم LIKE على العناوين المشفرة — نجلب الكل ونفلتر بعد فك التشفير في JS
            const req2 = pool.request().input('OwnerUID', sql.NVarChar, ownerUserId);
            if (excludeId) req2.input('ExcludeID', sql.Int, excludeId);
            const excludeClause = excludeId ? `AND t.TaskID <> @ExcludeID` : '';

            const qStr = `
                SELECT TOP 200 t.TaskID, t.Title, t.Description, t.Status, t.Priority, t.DueDate, t.CreatedAt, t.PersonalOwnerUserID
                FROM dbo.Tasks t
                WHERE t.PersonalOwnerUserID = @OwnerUID
                  ${excludeClause}
                ORDER BY t.CreatedAt DESC`;

            const pRes = await req2.query(qStr);
            let rows = pRes.recordset.map(r => {
                if (r.Title)       try { r.Title       = encryptionConfig.decrypt(r.Title);       } catch (_) {}
                if (r.Description) try { r.Description = encryptionConfig.decrypt(r.Description); } catch (_) {}
                return r;
            });

            // فلترة نصية بعد فك التشفير
            if (trimmedQ2.length >= 2) {
                const kw = trimmedQ2.toLowerCase();
                rows = rows.filter(r =>
                    (r.Title       && r.Title.toLowerCase().includes(kw)) ||
                    (r.Description && r.Description.toLowerCase().includes(kw)) ||
                    String(r.TaskID) === trimmedQ2
                );
            }

            return res.json(rows.slice(0, 50));
        } catch (err) {
            console.error('personalOnly search error:', err.message);
            return res.json([]);
        }
    }

    const trimmedQ = (q || '').trim();
    // السماح بالبحث برقم المعرف (رقم واحد) أو بنص بطول 2+
    const isNumericQuery = /^\d+$/.test(trimmedQ);
    if (!trimmedQ || (!isNumericQuery && trimmedQ.length < 2)) return res.json([]);

    try {
        const ctx = await buildCompletedTasksContext(pool);
        const isAdminBool = isAdmin === 'true' || isAdmin === true;
        const excludeId = excludeTaskId ? parseInt(excludeTaskId, 10) : null;
        const term = trimmedQ.toLowerCase();

        // --- استعلام مشترك لجميع المهام (نشطة + مكتملة) ---
        let allTasksQuery;
        const request = pool.request();

        // إذا كان البحث برقم معرف مباشر — أضف شرط TaskID صراحةً
        if (isNumericQuery) {
            request.input('SearchTaskID', sql.Int, parseInt(term, 10));
        }

        // إذا أرسل العميل deptId — وسّعه لكل أقسام المجموعة المستقلة
        const directDeptId = deptId && /^\d+$/.test(String(deptId)) ? parseInt(String(deptId), 10) : null;
        if (directDeptId != null) {
            const groupDeptIds = await resolveIndependentDeptGroup(pool, directDeptId);
            const resolvedIds = groupDeptIds.length > 0 ? groupDeptIds : [directDeptId];
            resolvedIds.forEach((dId, i) => {
                request.input(`GrpDept${i}`, sql.Int, parseInt(dId, 10));
            });
            const inClause = resolvedIds.map((_, i) => `@GrpDept${i}`).join(',');
            allTasksQuery = isNumericQuery
                ? `SELECT DISTINCT TOP (800) t.TaskID, t.Title, t.Description, t.Status, t.Priority, t.DueDate, t.CreatedAt
                   FROM dbo.Tasks t
                   WHERE (t.TaskID = @SearchTaskID OR t.DepartmentID IN (${inClause}))
                   ORDER BY t.CreatedAt DESC`
                : `SELECT DISTINCT TOP (800) t.TaskID, t.Title, t.Description, t.Status, t.Priority, t.DueDate, t.CreatedAt
                   FROM dbo.Tasks t
                   WHERE t.DepartmentID IN (${inClause})
                   ORDER BY t.CreatedAt DESC`;
        } else if (isAdminBool) {
            allTasksQuery = isNumericQuery
                ? `SELECT TOP (800) t.TaskID, t.Title, t.Description, t.Status, t.Priority, t.DueDate, t.CreatedAt
                   FROM dbo.Tasks t
                   WHERE t.TaskID = @SearchTaskID
                   ORDER BY t.CreatedAt DESC`
                : `SELECT TOP (800) t.TaskID, t.Title, t.Description, t.Status, t.Priority, t.DueDate, t.CreatedAt
                   FROM dbo.Tasks t
                   ORDER BY t.CreatedAt DESC`;
        } else {

            const principal = await resolvePrincipalForCompletedSearch(pool, userId, ctx);
            const scopeDepartmentIds = await resolveUserDirectorateDepartmentIds(pool, userId);

            // Fallback: إذا لم يُعثر على أقسام المديرية، استخدم القسم المباشر للمستخدم
            let fallbackDeptId = null;
            if (scopeDepartmentIds.length === 0) {
                try {
                    const actorCtx = await resolveActorContext(pool, userId);
                    if (actorCtx?.departmentId != null) {
                        fallbackDeptId = actorCtx.departmentId;
                    }
                } catch (_) {}
            }

            if (principal == null && scopeDepartmentIds.length === 0 && fallbackDeptId == null) {
                return res.json([]);
            }

            // نطاق القسم هو الفلتر الوحيد لضمان عدم ظهور مهام أقسام مستقلة أخرى.
            // شروط المنشئ/المُسند تُستخدم فقط كحل أخير عند غياب نطاق القسم كلياً.
            const accessClauses = [];
            if (scopeDepartmentIds.length > 0) {
                scopeDepartmentIds.forEach((dId, i) => {
                    request.input(`DeptID${i}`, sql.Int, parseInt(dId, 10));
                });
                accessClauses.push(`t.DepartmentID IN (${scopeDepartmentIds.map((_, i) => `@DeptID${i}`).join(',')})`);
            } else if (fallbackDeptId != null) {
                request.input('FallbackDeptID', sql.Int, fallbackDeptId);
                accessClauses.push(`t.DepartmentID = @FallbackDeptID`);
            } else if (principal != null) {
                // لا نطاق قسم متاح — استخدام شروط المنشئ/المُسند كحل أخير فقط
                request.input('UserID', ctx.sqlIdType, principal);
                accessClauses.push(`t.${ctx.taskCreatedCol} = @UserID`);
                accessClauses.push(`EXISTS (SELECT 1 FROM dbo.Subtasks s WHERE s.TaskID = t.TaskID AND s.${ctx.subAssignedCol} = @UserID)`);
                accessClauses.push(`EXISTS (SELECT 1 FROM dbo.Comments c WHERE c.TaskID = t.TaskID AND c.${ctx.commentAuthorCol} = @UserID)`);
            }

            if (accessClauses.length === 0) {
                return res.json([]);
            }

            const whereClause = isNumericQuery
                ? `(t.TaskID = @SearchTaskID OR (${accessClauses.join(' OR ')}))`
                : `(${accessClauses.join(' OR ')})`;

            allTasksQuery = `
                SELECT DISTINCT TOP (800) t.TaskID, t.Title, t.Description, t.Status, t.Priority, t.DueDate, t.CreatedAt
                FROM dbo.Tasks t
                WHERE ${whereClause}
                ORDER BY t.CreatedAt DESC
            `;
        }

        const rawResult = await request.query(allTasksQuery);

        // فك تشفير العنوان والوصف وتصفية المستثنى
        const tasks = rawResult.recordset
            .filter(t => !excludeId || t.TaskID !== excludeId)
            .map(t => {
                if (t.Title)       { try { t.Title       = encryptionConfig.decrypt(t.Title);       } catch (_) {} }
                if (t.Description) { try { t.Description = encryptionConfig.decrypt(t.Description); } catch (_) {} }
                return t;
            });

        // المرحلة الأولى: مطابقة العنوان والوصف
        const taskFieldMatches = new Set();
        for (const t of tasks) {
            if (
                (t.Title       && t.Title.toLowerCase().includes(term)) ||
                (t.Description && t.Description.toLowerCase().includes(term))
            ) {
                taskFieldMatches.add(t.TaskID);
            }
        }

        // المرحلة الثانية: بحث في المهام الفرعية والتعليقات للمهام غير المطابقة
        const unresolvedIds = tasks
            .map(t => Number(t.TaskID))
            .filter(id => Number.isFinite(id) && !taskFieldMatches.has(id));

        const subtaskHits = new Set();
        const commentHits = new Set();

        if (unresolvedIds.length > 0) {
            const idList = unresolvedIds.join(',');

            const subResult = await pool.request()
                .input('TaskIDs', sql.NVarChar(sql.MAX), idList)
                .query(`
                    SELECT TaskID, Title FROM dbo.Subtasks
                    WHERE TaskID IN (
                        SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@TaskIDs, ',')
                        WHERE TRY_CAST(value AS INT) IS NOT NULL
                    )
                `);
            for (const s of subResult.recordset) {
                let txt = s.Title || '';
                try { txt = encryptionConfig.decrypt(txt); } catch (_) {}
                if (txt.toLowerCase().includes(term)) subtaskHits.add(s.TaskID);
            }

            const cmtResult = await pool.request()
                .input('TaskIDs', sql.NVarChar(sql.MAX), idList)
                .query(`
                    SELECT TaskID, Content FROM dbo.Comments
                    WHERE TaskID IN (
                        SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@TaskIDs, ',')
                        WHERE TRY_CAST(value AS INT) IS NOT NULL
                    )
                `);
            for (const c of cmtResult.recordset) {
                let txt = c.Content || '';
                try { txt = encryptionConfig.decrypt(txt); } catch (_) {}
                if (txt.toLowerCase().includes(term)) commentHits.add(c.TaskID);
            }
        }

        // البحث الرقمي: أعد المهام التى طابقها SQL مباشرة بدون فلتر نصي
        const matched = tasks
            .filter(t => isNumericQuery || taskFieldMatches.has(t.TaskID) || subtaskHits.has(t.TaskID) || commentHits.has(t.TaskID))
            .slice(0, 20)
            .map(t => ({
                TaskID:      t.TaskID,
                Title:       t.Title       || '',
                Description: t.Description || '',
                Status:      t.Status      || '',
                Priority:    t.Priority    || '',
                DueDate:     t.DueDate     || null
            }));

        res.json(matched);
    } catch (err) {
        console.error('searchActiveTasks error:', err.message, err.stack);
        res.status(500).json({ message: err.message || 'خطأ في البحث' });
    }
};

// POST /api/tasks/:id/merge
// دمج مهمة مصدر (ب) مع مهمة هدف (أ): ينقل المهام الفرعية والتعليقات ويُلحق بيانات (ب) بوصف (أ) ثم يُغلق (ب)
exports.mergeTasks = async (req, res) => {
    const pool = req.app.locals.db;
    const targetTaskId = parseInt(req.params.id, 10);
    const { sourceTaskId, userId } = req.body;
    const srcId = parseInt(sourceTaskId, 10);

    if (!targetTaskId || !srcId || targetTaskId === srcId) {
        return res.status(400).json({ message: 'معرّفا المهمتين غير صالحين أو متطابقان.' });
    }

    try {
        const schema = await detectSchema(pool);
        const createdByCol = schema.hasTasksCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy';
        const identityTable = schema.isVacancy ? 'JobVacancies' : 'Users';
        const identityKey  = schema.isVacancy ? 'VacancyID' : 'UserID';
        const identityName = schema.isVacancy ? 'Name' : 'FullName';

        // --- جلب بيانات المنفّذ (الاسم + المنصب + الرتبة) ---
        let actorName = '', actorPosition = '', actorRank = '';
        try {
            const actorCtx = await resolveActorContext(pool, userId);
            // الاسم = fullName (اسم الشخص الحقيقي)، المنصب = vacancyName (اسم الوظيفة)
            actorName     = actorCtx?.fullName    || String(userId || '');
            actorPosition = actorCtx?.vacancyName || '';

            // الرتبة — جلب من Ranks عبر JobVacancies.Rank إن وُجد
            if (actorCtx?.vacancyId) {
                const rankProbe = await pool.request().query(`
                    SELECT
                      CASE WHEN COL_LENGTH('dbo.JobVacancies','Rank') IS NOT NULL THEN 1 ELSE 0 END AS HasRank,
                      CASE WHEN OBJECT_ID('dbo.Ranks','U')            IS NOT NULL THEN 1 ELSE 0 END AS HasRanks,
                      CASE WHEN COL_LENGTH('dbo.Ranks','Name')        IS NOT NULL THEN 1 ELSE 0 END AS HasRankName,
                      CASE WHEN COL_LENGTH('dbo.Ranks','RankName')    IS NOT NULL THEN 1 ELSE 0 END AS HasRankRankName
                `);
                const rp = rankProbe.recordset[0] || {};
                const rankNameCol = rp.HasRankName ? 'rk.Name' : (rp.HasRankRankName ? 'rk.RankName' : null);

                if (rp.HasRank && rp.HasRanks && rankNameCol) {
                    const posRes = await pool.request()
                        .input('VID', sql.Int, actorCtx.vacancyId)
                        .query(`SELECT ${rankNameCol} AS RankName
                                FROM dbo.JobVacancies jv
                                LEFT JOIN dbo.Ranks rk ON rk.RankID = jv.Rank
                                WHERE jv.VacancyID = @VID`);
                    actorRank = posRes.recordset[0]?.RankName || '';
                }
            }
        } catch (_) {}

        const actionDateStr = new Date().toLocaleDateString('ar-EG-u-nu-latn', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // دالة لبناء نص ملاحظة الدمج (الحقول مفصولة بـ |)
        const buildNote = (action) => {
            const parts = [action];
            if (actorName)     parts.push(`المنفّذ: ${actorName}`);
            if (actorPosition) parts.push(`المنصب: ${actorPosition}`);
            parts.push(`التاريخ: ${actionDateStr}`);
            return parts.join(' | ');
        };

        // دالة لإلحاق ملاحظة جديدة بقيمة Notes موجودة (مفصولة بـ |)
        // كل ملاحظة في سطر مستقل — بينما | تفصل حقول الملاحظة الواحدة
        const appendNote = (existing, newNote) =>
            existing ? `${existing}\n${newNote}` : newNote;

        // --- 1. جلب بيانات المهمة المصدر (ب) ---
        const srcRes = await pool.request()
            .input('SrcID', sql.Int, srcId)
            .query(`
                SELECT t.TaskID, t.Title, t.Description, t.CreatedAt, t.${createdByCol} AS CreatorKey,
                       idt.${identityName} AS CreatorName
                FROM dbo.Tasks t
                LEFT JOIN dbo.${identityTable} idt ON idt.${identityKey} = t.${createdByCol}
                WHERE t.TaskID = @SrcID
            `);
        const src = srcRes.recordset[0];
        if (!src) return res.status(404).json({ message: 'المهمة المصدر غير موجودة.' });

        let srcTitle = src.Title || '';
        let srcDesc  = src.Description || '';
        try { srcTitle = encryptionConfig.decrypt(srcTitle); } catch (_) {}
        try { srcDesc  = encryptionConfig.decrypt(srcDesc);  } catch (_) {}

        const srcCreatedAt = src.CreatedAt
            ? new Date(src.CreatedAt).toLocaleDateString('ar-EG-u-nu-latn', { year:'numeric', month:'short', day:'numeric' })
            : '';
        const creatorName = src.CreatorName || String(src.CreatorKey || '');

        // --- 2. تحديث وصف المهمة الهدف (أ) ---
        const tgtRes = await pool.request()
            .input('TgtID', sql.Int, targetTaskId)
            .query(`SELECT Description, Title, DepartmentID FROM dbo.Tasks WHERE TaskID = @TgtID`);
        const tgt = tgtRes.recordset[0];
        if (!tgt) return res.status(404).json({ message: 'المهمة الهدف غير موجودة.' });

        let tgtDesc = tgt.Description || '';
        try { tgtDesc = encryptionConfig.decrypt(tgtDesc); } catch (_) {}

        const mergeBlock = [
            '',
            '---',
            `مدمجة من مهمة #${srcId}`,
            `العنوان: ${srcTitle}`,
            `المنشئ: ${creatorName}`,
            `تاريخ الإنشاء: ${srcCreatedAt}`,
            srcDesc ? `التفاصيل:\n${srcDesc}` : '',
        ].filter(Boolean).join('\n');

        await pool.request()
            .input('TgtID', sql.Int, targetTaskId)
            .input('NewDesc', sql.NVarChar(sql.MAX), encryptionConfig.encrypt((tgtDesc + mergeBlock).trim()))
            .query(`UPDATE dbo.Tasks SET Description = @NewDesc WHERE TaskID = @TgtID`);

        const mergeNote    = buildNote(`مدمجة من مهمة #${srcId}`);
        const mergeNoteSrc = buildNote(`تم دمجها مع مهمة #${targetTaskId}`);

        // --- 3. نقل المهام الفرعية ---
        const stRes = await pool.request()
            .input('SrcID', sql.Int, srcId)
            .query(`SELECT SubtaskID, Notes FROM dbo.Subtasks WHERE TaskID = @SrcID`);

        for (const st of stRes.recordset) {
            await pool.request()
                .input('SubID', sql.Int, st.SubtaskID)
                .input('TgtID', sql.Int, targetTaskId)
                .input('Note', sql.NVarChar(sql.MAX), appendNote(st.Notes || '', mergeNote))
                .query(`UPDATE dbo.Subtasks SET TaskID = @TgtID, Notes = @Note WHERE SubtaskID = @SubID`);
        }

        // --- 4. نقل التعليقات ---
        const cmtRes = await pool.request()
            .input('SrcID', sql.Int, srcId)
            .query(`SELECT CommentID, Notes FROM dbo.Comments WHERE TaskID = @SrcID`);

        for (const c of cmtRes.recordset) {
            await pool.request()
                .input('CmtID', sql.Int, c.CommentID)
                .input('TgtID', sql.Int, targetTaskId)
                .input('Note', sql.NVarChar(sql.MAX), appendNote(c.Notes || '', mergeNote))
                .query(`UPDATE dbo.Comments SET TaskID = @TgtID, Notes = @Note WHERE CommentID = @CmtID`);
        }

        // --- 4.5 نقل ارتباطات المصدر إلى الهدف ---
        await pool.request()
            .input('SrcID', sql.Int, srcId)
            .input('TgtID', sql.Int, targetTaskId)
            .query(`
                IF OBJECT_ID('dbo.TaskRelations','U') IS NOT NULL BEGIN
                    -- ارتباطات يكون SrcID فيها هو TaskID1 (SrcID < الطرف الآخر)
                    INSERT INTO dbo.TaskRelations (TaskID1, TaskID2, CreatedBy)
                    SELECT
                        IIF(r.TaskID2 < @TgtID, r.TaskID2, @TgtID),
                        IIF(r.TaskID2 < @TgtID, @TgtID, r.TaskID2),
                        r.CreatedBy
                    FROM dbo.TaskRelations r
                    WHERE r.TaskID1 = @SrcID AND r.TaskID2 <> @TgtID
                      AND NOT EXISTS (
                        SELECT 1 FROM dbo.TaskRelations x
                        WHERE x.TaskID1 = IIF(r.TaskID2 < @TgtID, r.TaskID2, @TgtID)
                          AND x.TaskID2 = IIF(r.TaskID2 < @TgtID, @TgtID, r.TaskID2)
                      );
                    -- ارتباطات يكون SrcID فيها هو TaskID2 (الطرف الآخر < SrcID)
                    INSERT INTO dbo.TaskRelations (TaskID1, TaskID2, CreatedBy)
                    SELECT
                        IIF(r.TaskID1 < @TgtID, r.TaskID1, @TgtID),
                        IIF(r.TaskID1 < @TgtID, @TgtID, r.TaskID1),
                        r.CreatedBy
                    FROM dbo.TaskRelations r
                    WHERE r.TaskID2 = @SrcID AND r.TaskID1 <> @TgtID
                      AND NOT EXISTS (
                        SELECT 1 FROM dbo.TaskRelations x
                        WHERE x.TaskID1 = IIF(r.TaskID1 < @TgtID, r.TaskID1, @TgtID)
                          AND x.TaskID2 = IIF(r.TaskID1 < @TgtID, @TgtID, r.TaskID1)
                      );
                    -- حذف ارتباطات المصدر القديمة
                    DELETE FROM dbo.TaskRelations WHERE TaskID1 = @SrcID OR TaskID2 = @SrcID;
                END
            `);

        // --- 5. إغلاق المهمة المصدر (ب) ---
        const srcNotesRes = await pool.request()
            .input('SrcID', sql.Int, srcId)
            .query(`SELECT Notes FROM dbo.Tasks WHERE TaskID = @SrcID`);
        const existingSrcNotes = srcNotesRes.recordset[0]?.Notes || '';

        await pool.request()
            .input('SrcID', sql.Int, srcId)
            .input('Note', sql.NVarChar(sql.MAX), appendNote(existingSrcNotes, mergeNoteSrc))
            .query(`UPDATE dbo.Tasks SET Status = 'cancelled', Notes = @Note WHERE TaskID = @SrcID`);

        // تسجيل إجراء الدمج في سجل الإجراءات (العنوان مشفّر كما هو في DB)
        await logTaskAction(pool, {
            taskId:       targetTaskId,
            taskTitle:    tgt?.Title     || null,
            departmentId: tgt?.DepartmentID || null,
            action:       'merged',
            userId,
        });
        await logTaskAction(pool, {
            taskId:       srcId,
            taskTitle:    src?.Title     || null,
            departmentId: tgt?.DepartmentID || null,
            action:       'merged_into',
            userId,
        });

        return res.json({ success: true, mergedSubtasks: stRes.recordset.length, mergedComments: cmtRes.recordset.length });
    } catch (err) {
        console.error('mergeTasks error:', err);
        return res.status(500).json({ message: err.message || 'خطأ في عملية الدمج' });
    }
};

// سجل إجراءات المهام — الإتمام / الإلغاء / الحذف / الدمج
// يستخدم OFFSET pagination ويعرض جميع إجراءات القسم المستقل الواحد لجميع موظفيه
exports.getTaskAuditLog = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, page = 0 } = req.query;
    const pageNum   = parseInt(page, 10) || 0;
    const PAGE_SIZE = 50;
    const rowOffset = pageNum * PAGE_SIZE;

    try {
        // تحقق من وجود الجدول
        const tableCheck = await pool.request().query(`
            SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TaskAuditLog'
        `);
        if (!tableCheck.recordset[0]?.cnt) return res.json([]);

        // 1. جلب قسم المستخدم الحالي من ملفه الشخصي
        const ctx = await resolveActorContext(pool, userId).catch(() => null);
        const userDeptId = ctx?.departmentId != null ? parseInt(ctx.departmentId, 10) : null;
        if (!userDeptId) return res.json([]);

        // 2. جلب جميع أقسام المجموعة المستقلة (القسم المستقل الأب + جميع أقسامه الدنيا)
        const deptIds = await resolveIndependentDeptGroup(pool, userDeptId);
        if (deptIds.length === 0) return res.json([]);

        // 3. تحقق من وجود عمود ActorDepartmentID
        const colCheck = await pool.request().query(`
            SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TaskAuditLog' AND COLUMN_NAME='ActorDepartmentID'
        `);
        const hasActorDeptCol = !!colCheck.recordset[0]?.cnt;

        // 4. بناء الاستعلام مع قائمة الأقسام
        const req2 = pool.request();
        const deptParams = deptIds.map((id, i) => {
            req2.input(`DID${i}`, sql.Int, id);
            return `@DID${i}`;
        }).join(', ');
        req2.input('RowOffset', sql.Int, rowOffset);
        req2.input('PageSize',  sql.Int, PAGE_SIZE);

        // الفلتر:
        //  أ) قسم المهمة ضمن قائمة أقسام المجموعة المستقلة
        //  ب) قسم المنفّذ ضمن القائمة (يشمل المهام المحذوفة حيث DepartmentID=NULL)
        //  ج) سجلات قسمها NULL لكن المهمة لا تزال موجودة وتتبع قسماً في القائمة
        const actorDeptClause = hasActorDeptCol
            ? `OR (al.ActorDepartmentID IN (${deptParams}) AND al.DepartmentID IS NOT NULL)`
            : '';

        const result = await req2.query(`
            SELECT al.LogID, al.TaskID, al.TaskTitle, al.DepartmentID,
                   al.Action, al.ActorName, al.ActorPosition, al.CreatedAt
            FROM dbo.TaskAuditLog al
            WHERE (
                al.DepartmentID IN (${deptParams})
                ${actorDeptClause}
                OR (al.DepartmentID IS NULL AND al.TaskID IS NOT NULL AND EXISTS (
                    SELECT 1 FROM dbo.Tasks t
                    WHERE t.TaskID = al.TaskID AND t.DepartmentID IN (${deptParams})
                ))
            )
            AND NOT EXISTS (
                SELECT 1 FROM dbo.Tasks t
                WHERE t.TaskID = al.TaskID AND t.PersonalOwnerUserID IS NOT NULL
            )
            ORDER BY al.CreatedAt DESC
            OFFSET @RowOffset ROWS FETCH NEXT @PageSize ROWS ONLY
        `);

        // فك تشفير العنوان قبل الإرسال للواجهة
        const rows = result.recordset.map(r => {
            if (r.TaskTitle) {
                try { r.TaskTitle = encryptionConfig.decrypt(r.TaskTitle); } catch (_) {}
            }
            return r;
        });

        res.json(rows);
    } catch (err) {
        console.error('getTaskAuditLog error:', err);
        res.status(500).json({ message: err.message });
    }
};
