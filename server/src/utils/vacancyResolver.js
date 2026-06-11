// src/utils/vacancyResolver.js
// أدوات مشتركة لتحويل UserID إلى VacancyID وحلّ بيانات المستخدم الحالية.
// يُستخدم في: middleware/auth.js, taskController, procedureController,
// delegationController, categoryController, userController, profileController.
//
// تم تصميمه ليكون دفاعياً: يتحقق من وجود الأعمدة/الجداول/الـ view قبل الاعتماد عليها
// وبالتالي يعمل سواء على المخطط القديم (UserID) أو الجديد (VacancyID).

const sql = require('mssql');

// ---- في الذاكرة (in-memory cache) لنتائج فحص المخطط ----
// المخطط لا يتغير إلا عند migration، فلا داعي لاستعلامه في كل طلب.
let _schemaCache = null;
let _schemaCacheTs = 0;
const SCHEMA_CACHE_TTL_MS = 60 * 1000; // دقيقة واحدة

async function detectSchema(pool) {
  const now = Date.now();
  if (_schemaCache && (now - _schemaCacheTs) < SCHEMA_CACHE_TTL_MS) {
    return _schemaCache;
  }

  const result = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
      CASE WHEN OBJECT_ID('dbo.JobVacancies', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasJobVacanciesTable,
      CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
      CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
      CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
      CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
      CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDepartmentID,
      CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTasksCreatedByVacancy,
      CASE WHEN COL_LENGTH('dbo.Tasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTasksLastActedByVacancy,
      CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubtasksCreatedByVacancy,
      CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubtasksAssignedToVacancy,
      CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubtasksLastActedByVacancy,
      CASE WHEN COL_LENGTH('dbo.Procedures', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasProceduresCreatedByVacancy,
      CASE WHEN COL_LENGTH('dbo.Procedures', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasProceduresCreatedBy,
      CASE WHEN COL_LENGTH('dbo.Categories', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCategoriesCreatedBy,
      CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorVacancyID') IS NOT NULL
             AND COL_LENGTH('dbo.TaskDelegations', 'DelegateVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasDelegationVacancy,
      CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasDelegationUserID
  `);

  const row = result.recordset[0] || {};
  const isVacancy = !!(row.HasTasksCreatedByVacancy || row.HasSubtasksAssignedToVacancy || row.HasDelegationVacancy);

  _schemaCache = {
    // علَم عام
    isVacancy,

    // وجود الجداول والـ view
    hasAssignments: !!row.HasAssignmentsTable,
    hasJobVacancies: !!row.HasJobVacanciesTable,
    hasProfileView: !!row.HasProfileView,
    hasUsersDepartmentID: !!row.HasUsersDepartmentID,
    hasLegacyUserID: !!row.HasLegacyUserID,
    hasServiceID: !!row.HasServiceID,
    hasVacancyDepartmentID: !!row.HasVacancyDepartmentID,

    // أعمدة Tasks
    tasksCreatedByCol: row.HasTasksCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy',
    tasksLastActedByCol: row.HasTasksLastActedByVacancy ? 'LastActedByVacancyID' : 'ActedBy',
    hasTasksCreatedByVacancy: !!row.HasTasksCreatedByVacancy,
    hasTasksLastActedByVacancy: !!row.HasTasksLastActedByVacancy,

    // أعمدة Subtasks
    subtasksCreatedByCol: row.HasSubtasksCreatedByVacancy ? 'CreatedByVacancyID' : 'CreatedBy',
    subtasksAssignedToCol: row.HasSubtasksAssignedToVacancy ? 'AssignedToVacancyID' : 'AssignedTo',
    subtasksLastActedByCol: row.HasSubtasksLastActedByVacancy ? 'LastActedByVacancyID' : 'ActedBy',
    hasSubtasksCreatedByVacancy: !!row.HasSubtasksCreatedByVacancy,
    hasSubtasksAssignedToVacancy: !!row.HasSubtasksAssignedToVacancy,
    hasSubtasksLastActedByVacancy: !!row.HasSubtasksLastActedByVacancy,

    // أعمدة Procedures و Categories
    hasProceduresCreatedByVacancy: !!row.HasProceduresCreatedByVacancy,
    hasProceduresCreatedBy: !!row.HasProceduresCreatedBy,
    hasCategoriesCreatedBy: !!row.HasCategoriesCreatedBy,

    // أعمدة TaskDelegations
    hasDelegationVacancy: !!row.HasDelegationVacancy,
    hasDelegationUserID: !!row.HasDelegationUserID,
    delegatorCol: row.HasDelegationVacancy ? 'DelegatorVacancyID' : 'DelegatorUserID',
    delegateCol: row.HasDelegationVacancy ? 'DelegateVacancyID' : 'DelegateUserID',

    // جدول الهوية المرجعي للانضمام للأسماء
    identityTable: isVacancy ? 'JobVacancies' : 'Users',
    identityKey: isVacancy ? 'VacancyID' : 'UserID',
    identityName: isVacancy ? 'Name' : 'FullName',
  };
  _schemaCacheTs = now;
  return _schemaCache;
}

function invalidateSchemaCache() {
  _schemaCache = null;
  _schemaCacheTs = 0;
}

// ---- أدوات تطبيع المدخلات ----
function normalizeUserId(userId) {
  if (userId == null) return '';
  return String(userId).trim();
}

function isNumericInt(val) {
  if (val == null) return false;
  const s = String(val).trim();
  return /^-?\d+$/.test(s);
}

// ---- حلّ VacancyID الحالي من UserID ----
// يُرجع عدداً صحيحاً (int) أو null إذا لم يُعثر عليه.
async function resolveVacancyId(pool, userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return null;

  try {
    const schema = await detectSchema(pool);

    // إذا كان المخطط لا يزال قديماً (بدون Assignments/VacancyID) فلا يوجد VacancyID لنُرجعه.
    if (!schema.hasAssignments) return null;

    // إذا كان uid رقماً صحيحاً وكان المخطط يستخدم VacancyID، نتحقق هل هو VacancyID مباشر.
    // يحدث هذا عندما يُرسل العميل VacancyID (لا UserID) كـ CreatedBy عند إنشاء المهمة.
    if (schema.hasJobVacancies && /^\d+$/.test(uid)) {
      const vacancyCheck = await pool.request()
        .input('VacancyID', sql.Int, parseInt(uid, 10))
        .query(`SELECT TOP 1 VacancyID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
      if (vacancyCheck.recordset.length > 0) {
        return parseInt(uid, 10); // القيمة VacancyID صالح — نُعيدها مباشرةً
      }
    }

    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @UserID`];
    if (schema.hasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @UserID`);
    if (schema.hasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @UserID`);
    const userWhere = whereParts.join(' OR ');

    const result = await pool.request()
      .input('UserID', sql.NVarChar(50), uid)
      .query(`
        SELECT TOP 1 a.VacancyID
        FROM dbo.Users u
        INNER JOIN dbo.Assignments a ON a.UserID = u.UserID
        WHERE (${userWhere})
          AND a.VacancyID IS NOT NULL
        ORDER BY
          CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
          ISNULL(a.StartDate, '1900-01-01') DESC,
          a.AssignmentID DESC
      `);

    const vid = result.recordset[0]?.VacancyID;
    if (vid == null) return null;
    const n = parseInt(vid, 10);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    console.error('resolveVacancyId error:', err);
    return null;
  }
}

// ---- حلّ بيانات سياق الفاعل (actor) الكاملة ----
// يُرجع كائناً { userId, vacancyId, assignmentId, departmentId, fullName, vacancyName, isAdmin, isActive }
// أو null إذا لم يتم العثور على المستخدم.
async function resolveActorContext(pool, rawUserId) {
  const uid = normalizeUserId(rawUserId);
  if (!uid) return null;

  try {
    const schema = await detectSchema(pool);

    // إذا كان المدخل رقماً (VacancyID محتمل)، نحل UserID الحقيقي أولاً عبر Assignments
    // هذا يتفادى مشكلة LEFT JOIN + IsCurrent حيث يكون a.VacancyID = NULL
    let effectiveUid = uid;
    if (isNumericInt(uid) && schema.hasAssignments && schema.hasJobVacancies) {
      try {
        const r = await pool.request()
          .input('VacancyID', sql.Int, parseInt(uid, 10))
          .query(`
            SELECT TOP 1 a.UserID
            FROM dbo.Assignments a
            WHERE a.VacancyID = @VacancyID
            ORDER BY
              CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
              a.AssignmentID DESC
          `);
        if (r.recordset[0]?.UserID) {
          effectiveUid = String(r.recordset[0].UserID).trim();
        }
      } catch (_) {}
    }

    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @UserID`];
    if (schema.hasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @UserID`);
    if (schema.hasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @UserID`);
    const userWhere = whereParts.join(' OR ');

    // نبني الاستعلام حسب وجود الجداول/الـ view
    const selectParts = [
      'u.UserID', 'u.FullName', 'u.IsAdmin', 'u.IsActive',
    ];
    const joinParts = [];

    if (schema.hasAssignments && schema.hasJobVacancies) {
      selectParts.push('a.AssignmentID', 'a.VacancyID', 'v.Name AS VacancyName');
      joinParts.push('LEFT JOIN dbo.Assignments a ON a.UserID = u.UserID AND a.IsCurrent = 1');
      joinParts.push('LEFT JOIN dbo.JobVacancies v ON v.VacancyID = a.VacancyID');

      if (schema.hasVacancyDepartmentID) {
        selectParts.push('v.DepartmentID AS VacancyDepartmentID');
      }
    }

    if (schema.hasUsersDepartmentID) {
      selectParts.push('u.DepartmentID AS UsersDepartmentID');
    } else if (schema.hasProfileView) {
      selectParts.push('p.DepartmentID AS ProfileDepartmentID');
      joinParts.push('LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID');
    }

    const query = `
      SELECT TOP 1 ${selectParts.join(', ')}
      FROM dbo.Users u
      ${joinParts.join('\n      ')}
      WHERE (${userWhere})
        AND u.IsActive = 1
    `;

    const request = pool.request().input('UserID', sql.NVarChar(50), effectiveUid);
    const result = await request.query(query);

    const row = result.recordset[0];
    if (!row) return null;

    // DepartmentID — أولوية: Users.DepartmentID > JobVacancies.DepartmentID عبر Assignments > vw_UserCurrentProfile
    const departmentId =
      row.UsersDepartmentID != null ? row.UsersDepartmentID :
      row.VacancyDepartmentID != null ? row.VacancyDepartmentID :
      row.ProfileDepartmentID != null ? row.ProfileDepartmentID :
      null;

    return {
      userId: String(row.UserID).trim(),
      vacancyId: row.VacancyID != null ? parseInt(row.VacancyID, 10) : null,
      assignmentId: row.AssignmentID != null ? parseInt(row.AssignmentID, 10) : null,
      departmentId: departmentId != null ? parseInt(departmentId, 10) : null,
      fullName: row.FullName || null,
      vacancyName: row.VacancyName || null,
      isAdmin: !!row.IsAdmin,
      isActive: !!row.IsActive,
    };
  } catch (err) {
    console.error('resolveActorContext error:', err);
    return null;
  }
}

// ---- اختصار لاستخدامه داخل الـ controllers ----
// يأخذ req.user (الذي حشاه auth middleware) ويضمن وجود vacancyId فيه.
// مفيد في الحالات التي تحتاج vacancyId لكن لا تريد لمس req.user نفسه.
async function ensureVacancyId(pool, reqUser) {
  if (!reqUser) return null;
  if (reqUser.vacancyId != null) {
    const n = parseInt(reqUser.vacancyId, 10);
    return Number.isFinite(n) ? n : null;
  }
  // fallback: احسبها الآن
  return await resolveVacancyId(pool, reqUser.userId);
}

// ---------------------------------------------------------------------------
// resolveIndependentDeptGroup
// ---------------------------------------------------------------------------
// دالة عامة: تأخذ رقم القسم وتعيد جميع أرقام الأقسام الفرعية للقسم المستقل
// الأب (أو القسم نفسه إذا كان مستقلاً).
//
// الخوارزمية:
//   1. إذا كان القسم type=1 (مستقل) → اجلب جميع أقسامه الدنيا.
//   2. إذا لم يكن type=1 → اصعد في الشجرة حتى تجد الأب المستقل (type=1)
//      ثم اجلب جميع أقسامه الدنيا.
//   3. إذا لم يُعثر على أب مستقل → استخدم القسم الحالي كجذر.
//
// fallback: إذا لم يكن هناك عمود أب في جدول الأقسام → يُعيد [deptId] فقط.
// ---------------------------------------------------------------------------
async function resolveIndependentDeptGroup(pool, deptId) {
  const deptIdInt = parseInt(String(deptId || '').trim(), 10);
  if (!deptIdInt || isNaN(deptIdInt)) return [];

  try {
    const probe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Departments','ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDeptID,
        CASE WHEN COL_LENGTH('dbo.Departments','ParentID')           IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
        CASE WHEN COL_LENGTH('dbo.Departments','Type')               IS NOT NULL THEN 1 ELSE 0 END AS HasType
    `);
    const p = probe.recordset[0] || {};
    const parentCol = p.HasParentDeptID ? 'ParentDepartmentID'
                    : p.HasParentID     ? 'ParentID'
                    : null;

    if (!parentCol) {
      // لا يوجد هيكل شجري — نعيد القسم نفسه
      return [deptIdInt];
    }

    let rootId = deptIdInt;

    if (p.HasType) {
      // اصعد في الشجرة للعثور على أقرب قسم مستقل (Type=1)، قد يكون القسم نفسه
      const upRes = await pool.request()
        .input('DeptID', sql.Int, deptIdInt)
        .query(`
          ;WITH UpTree AS (
            SELECT DepartmentID,
                   TRY_CAST(${parentCol} AS INT)  AS ParentDeptID,
                   TRY_CAST([Type] AS INT)         AS DeptType,
                   0 AS Depth
            FROM dbo.Departments
            WHERE DepartmentID = @DeptID
            UNION ALL
            SELECT d.DepartmentID,
                   TRY_CAST(d.${parentCol} AS INT),
                   TRY_CAST(d.[Type] AS INT),
                   u.Depth + 1
            FROM dbo.Departments d
            INNER JOIN UpTree u
                    ON u.ParentDeptID IS NOT NULL
                   AND d.DepartmentID = u.ParentDeptID
          )
          SELECT TOP 1 DepartmentID
          FROM UpTree
          WHERE DeptType = 1
          ORDER BY Depth ASC
          OPTION (MAXRECURSION 100)
        `);
      if (upRes.recordset[0]?.DepartmentID != null) {
        rootId = parseInt(upRes.recordset[0].DepartmentID, 10);
      }
      // إذا لم يُعثر على أب مستقل → rootId يبقى = deptIdInt (القسم نفسه كجذر)
    }

    // انزل من الجذر لجلب جميع الأقسام الفرعية (الجذر + أبناؤه + أحفاده...)
    const downRes = await pool.request()
      .input('RootID', sql.Int, rootId)
      .query(`
        ;WITH DeptTree AS (
          SELECT DepartmentID
          FROM dbo.Departments
          WHERE DepartmentID = @RootID
          UNION ALL
          SELECT d.DepartmentID
          FROM dbo.Departments d
          INNER JOIN DeptTree dt
                  ON TRY_CAST(d.${parentCol} AS INT) IS NOT NULL
                 AND TRY_CAST(d.${parentCol} AS INT) = dt.DepartmentID
        )
        SELECT DISTINCT DepartmentID FROM DeptTree
        OPTION (MAXRECURSION 300)
      `);

    const ids = downRes.recordset
      .map(r => parseInt(r.DepartmentID, 10))
      .filter(v => !isNaN(v) && v > 0);

    return ids.length > 0 ? ids : [deptIdInt];

  } catch (err) {
    console.error('resolveIndependentDeptGroup error:', err?.message || err);
    return [deptIdInt];
  }
}

// ---------------------------------------------------------------------------
// resolveIndependentDeptGroupByVacancy
// ---------------------------------------------------------------------------
// مثل resolveIndependentDeptGroup لكنّ المدخل رقم منصب (VacancyID).
// يجلب DepartmentID للمنصب ثم يستدعي resolveIndependentDeptGroup.
// ---------------------------------------------------------------------------
async function resolveIndependentDeptGroupByVacancy(pool, vacancyId) {
  const vid = parseInt(String(vacancyId || '').trim(), 10);
  if (!vid || isNaN(vid)) return [];
  try {
    const hasCol = await pool.request().query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='JobVacancies' AND COLUMN_NAME='DepartmentID'
    `);
    if (!hasCol.recordset[0]?.cnt) return [];
    const res = await pool.request()
      .input('VID', sql.Int, vid)
      .query('SELECT TOP 1 DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @VID');
    const deptId = res.recordset[0]?.DepartmentID;
    if (deptId == null) return [];
    return resolveIndependentDeptGroup(pool, deptId);
  } catch (err) {
    console.error('resolveIndependentDeptGroupByVacancy error:', err?.message || err);
    return [];
  }
}

module.exports = {
  detectSchema,
  invalidateSchemaCache,
  resolveVacancyId,
  resolveActorContext,
  ensureVacancyId,
  normalizeUserId,
  isNumericInt,
  resolveIndependentDeptGroup,
  resolveIndependentDeptGroupByVacancy,
};
