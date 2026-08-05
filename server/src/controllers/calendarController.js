// src/controllers/calendarController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');

// يحوّل VacancyID رقمي → UserID حقيقي لمقارنة PersonalOwnerUserID
async function resolveUserIDFromActor(pool, rawActorId) {
  const text = String(rawActorId || '').trim();
  if (!text || !/^\d+$/.test(text)) return text;
  try {
    const res = await pool.request()
      .input('VacancyID', sql.Int, parseInt(text, 10))
      .query(`
        IF OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL
          SELECT TOP 1 LTRIM(RTRIM(UserID)) AS UserID
          FROM dbo.Assignments
          WHERE VacancyID = @VacancyID AND IsCurrent = 1;
      `);
    const uid = res.recordset[0]?.UserID;
    if (uid) return String(uid).trim();
  } catch (_) {}
  return text;
}

async function resolveDirectorateScopeByDepartment(pool, baseDepartmentId) {
  const normalizedBaseDepartmentId = String(baseDepartmentId || '').trim();
  if (!normalizedBaseDepartmentId || !/^\d+$/.test(normalizedBaseDepartmentId)) return [];

  const schema = await pool.request().query(`
    SELECT
      CASE WHEN COL_LENGTH('dbo.Departments', 'ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDepartmentID,
      CASE WHEN COL_LENGTH('dbo.Departments', 'ParentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
      CASE WHEN COL_LENGTH('dbo.Departments', 'Type') IS NOT NULL THEN 1 ELSE 0 END AS HasDepartmentType
  `);
  const s = schema.recordset[0] || {};
  const parentCol = s.HasParentDepartmentID ? 'ParentDepartmentID' : (s.HasParentID ? 'ParentID' : null);
  if (!parentCol) return [normalizedBaseDepartmentId];

  let rootDepartmentId = normalizedBaseDepartmentId;
  if (s.HasDepartmentType) {
    // نقيّد الصعود بـ 3 مستويات لمنع الوصول إلى جذر مشترك يخترق عزل الجهات المستقلة
    const root = await pool.request()
      .input('DepartmentID', sql.NVarChar, normalizedBaseDepartmentId)
      .query(`
        ;WITH UpTree AS (
          SELECT DepartmentID, ${parentCol} AS ParentDepartmentID, 0 AS Depth
          FROM dbo.Departments
          WHERE DepartmentID = @DepartmentID
          UNION ALL
          SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID, u.Depth + 1
          FROM dbo.Departments d
          INNER JOIN UpTree u ON d.DepartmentID = u.ParentDepartmentID
          WHERE u.Depth < 3
        )
        SELECT TOP 1 u.DepartmentID
        FROM UpTree u
        INNER JOIN dbo.Departments d ON d.DepartmentID = u.DepartmentID
        WHERE TRY_CAST(d.[Type] AS INT) = 1 OR LTRIM(RTRIM(CAST(d.[Type] AS NVARCHAR(50)))) = N'1'
        ORDER BY u.Depth ASC
        OPTION (MAXRECURSION 10)
      `);
    if (root.recordset[0]?.DepartmentID != null) {
        rootDepartmentId = String(root.recordset[0].DepartmentID).trim();
    }
  }
  if (!rootDepartmentId || !/^\d+$/.test(String(rootDepartmentId))) return [normalizedBaseDepartmentId];

  // When Type info exists, stop expanding into sub-departments that are themselves Type=1
  // (they are independent groups and must not bleed into each other's scope)
  const typeStopClause = s.HasDepartmentType
    ? `AND (TRY_CAST(d.[Type] AS INT) IS NULL OR TRY_CAST(d.[Type] AS INT) <> 1)`
    : '';

  const tree = await pool.request()
      .input('RootDepartmentID', sql.NVarChar, rootDepartmentId)
    .query(`
      ;WITH DeptTree AS (
        SELECT DepartmentID, ${parentCol} AS ParentDepartmentID
        FROM dbo.Departments
        WHERE DepartmentID = @RootDepartmentID
        UNION ALL
        SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID
        FROM dbo.Departments d
        INNER JOIN DeptTree dt ON d.${parentCol} = dt.DepartmentID
        ${typeStopClause}
      )
      SELECT DISTINCT DepartmentID
      FROM DeptTree
      OPTION (MAXRECURSION 300)
    `);

  const ids = (tree.recordset || [])
    .map(r => String(r.DepartmentID || '').trim())
    .filter(v => /^\d+$/.test(v));

  return ids.length > 0 ? ids : [normalizedBaseDepartmentId];
}

exports.getDepartmentCalendarSubtasks = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId, limit, startDate, days, includePast, includeAllSubtasks } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }

  try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasSubAssignedToUser
    `);
    const probe = schemaProbe.recordset[0] || {};
    const usesVacancySchema = !!probe.HasSubAssignedToVacancy;

    const assignedCol = usesVacancySchema ? 'AssignedToVacancyID' : 'AssignedTo';
    const hasLegacyAssignedCol = usesVacancySchema && !!probe.HasSubAssignedToUser;
    const identityTable = usesVacancySchema ? 'JobVacancies' : 'Users';
    const identityKey = usesVacancySchema ? 'VacancyID' : 'UserID';
    const identityName = usesVacancySchema ? 'Name' : 'FullName';

    // الحصول على قسم المستخدم ومعرّف الهوية التشغيلي الحالي
    const profileProbe = await pool.request().query(`
      SELECT
        CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
        CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
        CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
        CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID
    `);
    const pp = profileProbe.recordset[0] || {};

    let profileRes = { recordset: [] };
    if (pp.HasProfileView) {
      const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
      if (pp.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
      if (pp.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);

      profileRes = await pool.request()
        .input('LoginID', sql.NVarChar, String(userId).trim())
        .query(`
          SELECT TOP 1
            p.DepartmentID AS ProfileDepartmentID,
            ${pp.HasUsersDepartmentID ? 'u.DepartmentID AS UserDepartmentID,' : 'CAST(NULL as int) AS UserDepartmentID,'}
            p.VacancyID,
            u.UserID
          FROM dbo.Users u
          LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
          WHERE (${whereParts.join(' OR ')})
             OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT))
          ORDER BY
            CASE WHEN LTRIM(RTRIM(u.UserID)) = @LoginID THEN 0 ELSE 1 END ASC,
            CASE WHEN p.VacancyID IS NOT NULL THEN 0 ELSE 1 END ASC
        `);
    }

    const currentProfile = profileRes.recordset[0] || null;
    const currentLegacyUserId = currentProfile && currentProfile.UserID != null
      ? String(currentProfile.UserID).trim()
      : String(userId).trim();

    const toNumericDepartmentId = (value) => {
      const text = String(value ?? '').trim();
      if (!/^\d+$/.test(text)) return null;
      const parsed = parseInt(text, 10);
      return Number.isInteger(parsed) ? parsed : null;
    };

    let resolvedVacancyId = currentProfile && currentProfile.VacancyID != null
      ? String(currentProfile.VacancyID).trim()
      : '';
    let resolvedDepartmentId = currentProfile
      ? (toNumericDepartmentId(currentProfile.ProfileDepartmentID) ?? toNumericDepartmentId(currentProfile.UserDepartmentID))
      : null;

    if (usesVacancySchema && (!resolvedVacancyId || resolvedDepartmentId == null)) {
      const assignmentIdentity = await pool.request().query(`
        SELECT
          CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDepartmentID
      `);
      const ai = assignmentIdentity.recordset[0] || {};

      if (ai.HasAssignmentsTable) {
        const assignmentRes = await pool.request()
          .input('UserID', sql.NVarChar, currentLegacyUserId)
          .query(`
            SELECT TOP 1
              a.VacancyID,
              ${ai.HasVacancyDepartmentID ? 'jv.DepartmentID' : 'CAST(NULL as int) as DepartmentID'}
            FROM dbo.Assignments a
            ${ai.HasVacancyDepartmentID ? 'LEFT JOIN dbo.JobVacancies jv ON jv.VacancyID = a.VacancyID' : ''}
            WHERE a.UserID = @UserID
              AND a.VacancyID IS NOT NULL
            ORDER BY
              CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
              ISNULL(a.StartDate, '1900-01-01') DESC,
              a.AssignmentID DESC
          `);

        const assignmentRow = assignmentRes.recordset[0] || null;
        if (assignmentRow) {
          if (!resolvedVacancyId && assignmentRow.VacancyID != null) {
            resolvedVacancyId = String(assignmentRow.VacancyID).trim();
          }
          if (resolvedDepartmentId == null && assignmentRow.DepartmentID != null) {
            resolvedDepartmentId = toNumericDepartmentId(assignmentRow.DepartmentID);
          }
        }
      }
    }

    const currentActorIdRaw = usesVacancySchema
      ? (resolvedVacancyId || currentLegacyUserId || String(userId).trim())
      : (currentLegacyUserId || String(userId).trim());
    const currentActorId = currentActorIdRaw != null ? String(currentActorIdRaw).trim() : null;
    const actorMatchCondition = hasLegacyAssignedCol
      ? `(s.${assignedCol} = @ActorID OR (s.${assignedCol} IS NULL AND LTRIM(RTRIM(CAST(s.AssignedTo AS NVARCHAR(255)))) = @LegacyUserID))`
      : `s.${assignedCol} = @ActorID`;
    const legacyUserJoinParts = [`LTRIM(RTRIM(CAST(s.AssignedTo AS NVARCHAR(255)))) = LTRIM(RTRIM(legacyUser.UserID))`];
    if (pp.HasLegacyUserID) legacyUserJoinParts.push(`LTRIM(RTRIM(CAST(s.AssignedTo AS NVARCHAR(255)))) = LTRIM(RTRIM(legacyUser.LegacyUserID))`);
    if (pp.HasServiceID) legacyUserJoinParts.push(`LTRIM(RTRIM(CAST(s.AssignedTo AS NVARCHAR(255)))) = LTRIM(RTRIM(legacyUser.ServiceID))`);
    const assignedNameSelect = hasLegacyAssignedCol
      ? (pp.HasProfileView
        ? `COALESCE(u.${identityName}, legacyVac.Name, legacyUser.FullName) as AssignedToName`
        : `COALESCE(u.${identityName}, legacyUser.FullName) as AssignedToName`)
      : `u.${identityName} as AssignedToName`;
    const assignedNameJoins = hasLegacyAssignedCol
      ? (pp.HasProfileView
        ? `
          LEFT JOIN dbo.Users legacyUser ON s.${assignedCol} IS NULL AND (${legacyUserJoinParts.join(' OR ')})
          LEFT JOIN dbo.vw_UserCurrentProfile legacyProfile ON legacyUser.UserID = legacyProfile.UserID
          LEFT JOIN dbo.JobVacancies legacyVac ON legacyProfile.VacancyID = legacyVac.VacancyID`
        : `
          LEFT JOIN dbo.Users legacyUser ON s.${assignedCol} IS NULL AND (${legacyUserJoinParts.join(' OR ')})`)
      : '';

    let fallbackDepartmentId = null;
    if (resolvedDepartmentId == null && usesVacancySchema) {
      const vacancyDeptRes = await pool.request()
        .input('VacancyID', sql.Int, parseInt(String(resolvedVacancyId || userId), 10))
        .query(`
          SELECT TOP 1 DepartmentID
          FROM dbo.JobVacancies
          WHERE VacancyID = @VacancyID
        `);
      if (vacancyDeptRes.recordset[0] && vacancyDeptRes.recordset[0].DepartmentID != null) {
        fallbackDepartmentId = vacancyDeptRes.recordset[0].DepartmentID;
      }
    }

    const userHasDept = !!(resolvedDepartmentId != null || fallbackDepartmentId != null);
    const departmentId = resolvedDepartmentId != null
      ? resolvedDepartmentId
      : fallbackDepartmentId;
    const parsedLimit = Number.isInteger(parseInt(limit)) ? parseInt(limit) : 20;
    const safeLimit = Math.min(Math.max(parsedLimit, 1), 500);
    const includePastFlag = typeof includePast === 'string' && includePast.toLowerCase() === 'true';
    const includeAllFlag = typeof includeAllSubtasks === 'string' && includeAllSubtasks.toLowerCase() === 'true';

    let useRange = false;
    let startDateParam = null;
    let endDateParam = null;
    const daysInt = Number.isInteger(parseInt(days)) ? parseInt(days) : 0;
    if (startDate || daysInt > 0) {
      useRange = true;
      const base = startDate ? new Date(startDate) : new Date();
      startDateParam = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const endBase = new Date(startDateParam);
      endBase.setDate(endBase.getDate() + (daysInt > 0 ? daysInt : 30));
      endDateParam = endBase;
      if (!includePastFlag) {
        const today = new Date();
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        if (startDateParam < currentMonthStart) {
          startDateParam = currentMonthStart;
        }
      }
    }

    // التحقق من وجود الأعمدة قبل الاستعلام
    const colCheck = await pool.request().query(`
      SELECT
        COL_LENGTH('dbo.Subtasks', 'ShowInCalendar') AS Len,
        COL_LENGTH('dbo.Subtasks', 'EndDate') AS EndDateLen
    `);
    if (!colCheck.recordset[0].Len) {
      return res.status(200).json([]);
    }
    const hasEndDate = !!colCheck.recordset[0].EndDateLen;
    const endDateSelect = hasEndDate ? 'CAST(s.EndDate AS DATE) AS EndDate,' : '';

    // فحص وجود عمود المهام الشخصية وإعداد شرط OR لإدراجها في التقويم
    const personalTaskColCheck = await pool.request().query(
      `SELECT COL_LENGTH('dbo.Tasks','PersonalOwnerUserID') AS Len`
    );
    const hasPersonalCol = !!(personalTaskColCheck.recordset[0]?.Len);
    // حلّ UserID الأصلي (userId قد يكون VacancyID رقمياً)
    const personalUserId = await resolveUserIDFromActor(pool, userId);
    const personalOrClause = hasPersonalCol
      ? `OR (t.PersonalOwnerUserID IS NOT NULL AND t.PersonalOwnerUserID = @PersonalUserID)`
      : '';
    // يمنع مهام الآخرين الشخصية من الظهور لمستخدم آخر حتى لو كانا في نفس القسم
    const personalScopeFilter = hasPersonalCol
      ? `AND (t.PersonalOwnerUserID IS NULL OR t.PersonalOwnerUserID = @PersonalUserID)`
      : '';

    // شرط النطاق: يشمل الأحداث الممتدة التي تتداخل مع الفترة المرئية
    const dateRangeWhere = hasEndDate
      ? `CAST(s.DueDate AS DATE) < @EndDate
            AND (
              (CAST(s.EndDate AS DATE) IS NOT NULL AND CAST(s.EndDate AS DATE) >= @StartDate)
              OR (CAST(s.EndDate AS DATE) IS NULL AND CAST(s.DueDate AS DATE) >= @StartDate)
            )`
      : `CAST(s.DueDate AS DATE) >= @StartDate
            AND CAST(s.DueDate AS DATE) < @EndDate`;

    // بناء استعلام حسب القسم إن وجد، وإلا السقوط الاحتياطي لعناصر المستخدم نفسه
    let items = [];
    if (userHasDept) {
      const scopeDepartmentIds = await resolveDirectorateScopeByDepartment(pool, departmentId);
      const scopeParams = scopeDepartmentIds.map((_, index) => `@ScopeDepartmentID${index}`).join(', ');
      const departmentScopeCondition = scopeDepartmentIds.length > 0
        ? `t.DepartmentID IN (${scopeParams})`
        : `t.DepartmentID = @DepartmentID`;

      const request = pool.request().input('DepartmentID', sql.NVarChar, String(departmentId || '').trim()).input('Limit', sql.Int, safeLimit).input('IncludeAllSubtasks', sql.Bit, includeAllFlag ? 1 : 0).input('PersonalUserID', sql.NVarChar, personalUserId);
      scopeDepartmentIds.forEach((deptId, index) => {
        request.input(`ScopeDepartmentID${index}`, sql.NVarChar, deptId);
      });
      let query;
      if (useRange) {
        request.input('StartDate', sql.Date, startDateParam)
               .input('EndDate', sql.Date, endDateParam);
        query = `
          SELECT
            s.SubtaskID,
            s.TaskID,
            s.Title as SubtaskTitle,
            s.DueDate,
            s.IsCompleted,
            ${endDateSelect}
            t.Title as TaskTitle,
            t.DepartmentID,
            t.PersonalOwnerUserID,
            s.${assignedCol} as AssignedToID,
            ${assignedNameSelect}
          FROM Subtasks s
          INNER JOIN Tasks t ON s.TaskID = t.TaskID
          LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey}
          ${assignedNameJoins}
          WHERE (@IncludeAllSubtasks = 1 OR s.ShowInCalendar = 1)
            AND s.DueDate IS NOT NULL
            AND ${dateRangeWhere}
            AND (${departmentScopeCondition} ${personalOrClause})
            ${personalScopeFilter}
          ORDER BY s.DueDate ASC
        `;
      } else {
        query = `
          SELECT TOP(@Limit)
            s.SubtaskID,
            s.TaskID,
            s.Title as SubtaskTitle,
            s.DueDate,
            s.IsCompleted,
            ${endDateSelect}
            t.Title as TaskTitle,
            t.DepartmentID,
            t.PersonalOwnerUserID,
            s.${assignedCol} as AssignedToID,
            ${assignedNameSelect}
          FROM Subtasks s
          INNER JOIN Tasks t ON s.TaskID = t.TaskID
          LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey}
          ${assignedNameJoins}
          WHERE (@IncludeAllSubtasks = 1 OR s.ShowInCalendar = 1)
            AND s.DueDate IS NOT NULL
            AND CAST(s.DueDate AS DATE) >= CAST(GETDATE() AS DATE)
            AND (${departmentScopeCondition} ${personalOrClause})
            ${personalScopeFilter}
          ORDER BY s.DueDate ASC
        `;
      }

      const result = await request.query(query);
      items = result.recordset;

      // إذا لم نجد عناصر للقسم، نسقط تلقائياً لعناصر المستخدم نفسه
      if (!items || items.length === 0) {
        if (currentActorId == null) {
          return res.status(200).json([]);
        }

        const fallbackReq = pool.request()
          .input('ActorID', sql.NVarChar, currentActorId)
          .input('Limit', sql.Int, safeLimit)
          .input('IncludeAllSubtasks', sql.Bit, includeAllFlag ? 1 : 0)
          .input('PersonalUserID', sql.NVarChar, personalUserId);
        if (hasLegacyAssignedCol) {
          fallbackReq.input('LegacyUserID', sql.NVarChar, currentLegacyUserId);
        }
        if (useRange) {
          fallbackReq.input('StartDate', sql.Date, startDateParam)
                     .input('EndDate', sql.Date, endDateParam);
        }
        const fallbackQuery = useRange ? `
          SELECT
            s.SubtaskID,
            s.TaskID,
            s.Title as SubtaskTitle,
            s.DueDate,
            s.IsCompleted,
            ${endDateSelect}
            t.Title as TaskTitle,
            t.DepartmentID,
            t.PersonalOwnerUserID,
            s.${assignedCol} as AssignedToID,
            ${assignedNameSelect}
          FROM Subtasks s
          INNER JOIN Tasks t ON s.TaskID = t.TaskID
          LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey}
          ${assignedNameJoins}
          WHERE (@IncludeAllSubtasks = 1 OR s.ShowInCalendar = 1)
            AND s.DueDate IS NOT NULL
            AND ${dateRangeWhere}
            AND (${actorMatchCondition} ${personalOrClause})
            ${personalScopeFilter}
          ORDER BY s.DueDate ASC
        ` : `
          SELECT TOP(@Limit)
            s.SubtaskID,
            s.TaskID,
            s.Title as SubtaskTitle,
            s.DueDate,
            s.IsCompleted,
            ${endDateSelect}
            t.Title as TaskTitle,
            t.DepartmentID,
            t.PersonalOwnerUserID,
            s.${assignedCol} as AssignedToID,
            ${assignedNameSelect}
          FROM Subtasks s
          INNER JOIN Tasks t ON s.TaskID = t.TaskID
          LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey}
          ${assignedNameJoins}
          WHERE (@IncludeAllSubtasks = 1 OR s.ShowInCalendar = 1)
            AND s.DueDate IS NOT NULL
            AND CAST(s.DueDate AS DATE) >= CAST(GETDATE() AS DATE)
            AND (${actorMatchCondition} ${personalOrClause})
            ${personalScopeFilter}
          ORDER BY s.DueDate ASC
        `;
        const fbResult = await fallbackReq.query(fallbackQuery);
        items = fbResult.recordset;
      }
    } else {
      // لا يوجد قسم للمستخدم، نرجع عناصر المستخدم نفسه مباشرةً
      if (currentActorId == null) {
        return res.status(200).json([]);
      }

      const request = pool.request()
        .input('ActorID', sql.NVarChar, currentActorId)
        .input('Limit', sql.Int, safeLimit)
        .input('IncludeAllSubtasks', sql.Bit, includeAllFlag ? 1 : 0)
        .input('PersonalUserID', sql.NVarChar, personalUserId);
      if (hasLegacyAssignedCol) {
        request.input('LegacyUserID', sql.NVarChar, currentLegacyUserId);
      }
      if (useRange) {
        request.input('StartDate', sql.Date, startDateParam)
               .input('EndDate', sql.Date, endDateParam);
      }
      const query = useRange ? `
        SELECT
          s.SubtaskID,
          s.TaskID,
          s.Title as SubtaskTitle,
          s.DueDate,
          s.IsCompleted,
          ${endDateSelect}
          t.Title as TaskTitle,
          t.DepartmentID,
          s.${assignedCol} as AssignedToID,
          ${assignedNameSelect}
        FROM Subtasks s
        INNER JOIN Tasks t ON s.TaskID = t.TaskID
        LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey}
        ${assignedNameJoins}
        WHERE (@IncludeAllSubtasks = 1 OR s.ShowInCalendar = 1)
          AND s.DueDate IS NOT NULL
          AND ${dateRangeWhere}
          AND (${actorMatchCondition} ${personalOrClause})
          ${personalScopeFilter}
        ORDER BY s.DueDate ASC
      ` : `
        SELECT TOP(@Limit)
          s.SubtaskID,
          s.TaskID,
          s.Title as SubtaskTitle,
          s.DueDate,
          s.IsCompleted,
          ${endDateSelect}
          t.Title as TaskTitle,
          t.DepartmentID,
          s.${assignedCol} as AssignedToID,
          ${assignedNameSelect}
        FROM Subtasks s
        INNER JOIN Tasks t ON s.TaskID = t.TaskID
        LEFT JOIN ${identityTable} u ON s.${assignedCol} = u.${identityKey}
        ${assignedNameJoins}
        WHERE (@IncludeAllSubtasks = 1 OR s.ShowInCalendar = 1)
          AND s.DueDate IS NOT NULL
          AND CAST(s.DueDate AS DATE) >= CAST(GETDATE() AS DATE)
          AND (${actorMatchCondition} ${personalOrClause})
          ${personalScopeFilter}
        ORDER BY s.DueDate ASC
      `;
      const result = await request.query(query);
      items = result.recordset;
    }
    const decrypted = items.map(r => {
      try { if (r.SubtaskTitle) r.SubtaskTitle = encryptionConfig.decrypt(r.SubtaskTitle); } catch (_) {}
      try { if (r.TaskTitle) r.TaskTitle = encryptionConfig.decrypt(r.TaskTitle); } catch (_) {}
      return r;
    });

    res.status(200).json(decrypted);
  } catch (error) {
    console.error('Error fetching calendar subtasks:', error);
    res.status(500).json({ message: 'Error fetching calendar subtasks', detail: error.message, stack: error.stack });
  }
};

exports.getPersonalEvents = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId, startDate, days, includePast } = req.query;
  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }
  try {
    let useRange = false;
    let startDateParam = null;
    let endDateParam = null;
    const daysInt = Number.isInteger(parseInt(days)) ? parseInt(days) : 0;
    const includePastFlag = typeof includePast === 'string' && includePast.toLowerCase() === 'true';
    if (startDate || daysInt > 0) {
      useRange = true;
      const base = startDate ? new Date(startDate) : new Date();
      startDateParam = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const endBase = new Date(startDateParam);
      endBase.setDate(endBase.getDate() + (daysInt > 0 ? daysInt : 30));
      endDateParam = endBase;
      if (!includePastFlag) {
        const today = new Date();
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        if (startDateParam < currentMonthStart) {
          startDateParam = currentMonthStart;
        }
      }
    }

    // التحقق من وجود الجدول
    const tableCheck = await pool.request().query(`
      SELECT COUNT(*) as tableExists 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'PersonalCalendarEvents'
    `);
    if (tableCheck.recordset[0].tableExists === 0) {
      return res.status(200).json([]);
    }

    const request = pool.request().input('UserID', sql.NVarChar, userId);
    let query;
    if (useRange) {
      request.input('StartDate', sql.Date, startDateParam)
             .input('EndDate', sql.Date, endDateParam);
      query = `
        SELECT EventID, UserID, Title, EventDate, CreatedAt
        FROM PersonalCalendarEvents
        WHERE UserID = @UserID
          AND EventDate >= @StartDate
          AND EventDate < @EndDate
        ORDER BY EventDate ASC, EventID ASC
      `;
    } else {
      query = `
        SELECT EventID, UserID, Title, EventDate, CreatedAt
        FROM PersonalCalendarEvents
        WHERE UserID = @UserID
          AND EventDate >= CAST(GETDATE() AS DATE)
        ORDER BY EventDate ASC, EventID ASC
      `;
    }
    const result = await request.query(query);
    const decrypted = result.recordset.map(r => {
      try { if (r.Title) r.Title = encryptionConfig.decrypt(r.Title); } catch (_) {}
      return r;
    });
    return res.status(200).json(decrypted);
  } catch (err) {
    console.error('Error fetching personal events:', err);
    return res.status(500).json({ message: 'Error fetching personal events' });
  }
};

exports.createPersonalEvent = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId, title, eventDate } = req.body;
  if (!userId || !title || !eventDate) {
    return res.status(400).json({ message: 'userId, title, and eventDate are required' });
  }
  try {
    // تطبيع التاريخ إلى تاريخ فقط
    const d = new Date(eventDate);
    const normalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const encTitle = encryptionConfig.encrypt(title);

    // التحقق من وجود الجدول
    const tableCheck = await pool.request().query(`
      SELECT COUNT(*) as tableExists 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'PersonalCalendarEvents'
    `);
    if (tableCheck.recordset[0].tableExists === 0) {
      return res.status(500).json({ message: 'PersonalCalendarEvents table not found. Migration not applied.' });
    }

    const result = await pool.request()
      .input('UserID', sql.NVarChar, userId)
      .input('Title', sql.NVarChar, encTitle)
      .input('EventDate', sql.Date, normalized)
      .query(`
        INSERT INTO PersonalCalendarEvents (UserID, Title, EventDate, CreatedAt)
        OUTPUT INSERTED.EventID, INSERTED.UserID, INSERTED.Title, INSERTED.EventDate, INSERTED.CreatedAt
        VALUES (@UserID, @Title, @EventDate, GETDATE());
      `);
    const created = result.recordset[0];
    try { if (created && created.Title) created.Title = encryptionConfig.decrypt(created.Title); } catch (_) {}
    return res.status(201).json(created);
  } catch (err) {
    console.error('Error creating personal event:', err);
    return res.status(500).json({ message: 'Error creating personal event' });
  }
};

exports.updatePersonalEvent = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
  const { userId, title, eventDate } = req.body;
  if (!id || !userId) {
    return res.status(400).json({ message: 'id and userId are required' });
  }
  if (!title && !eventDate) {
    return res.status(400).json({ message: 'Nothing to update' });
  }
  try {
    const request = pool.request()
      .input('EventID', sql.Int, parseInt(id, 10))
      .input('UserID', sql.NVarChar, userId);

    let encTitle = null;
    let normalizedDate = null;
    const hasTitle = typeof title === 'string';
    const hasDate = typeof eventDate === 'string' && eventDate.length > 0;

    if (hasTitle) {
      encTitle = encryptionConfig.encrypt(title);
      request.input('Title', sql.NVarChar, encTitle);
    }
    if (hasDate) {
      const d = new Date(eventDate);
      normalizedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      request.input('EventDate', sql.Date, normalizedDate);
    }

    let setParts = [];
    if (hasTitle) setParts.push('Title = @Title');
    if (hasDate) setParts.push('EventDate = @EventDate');
    const setClause = setParts.join(', ');

    const result = await request.query(`
      UPDATE PersonalCalendarEvents
      SET ${setClause}
      WHERE EventID = @EventID AND UserID = @UserID;

      SELECT TOP 1 EventID, UserID, Title, EventDate, CreatedAt
      FROM PersonalCalendarEvents
      WHERE EventID = @EventID AND UserID = @UserID;
    `);

    const rows = result.recordset || [];
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }
    const updated = rows[rows.length - 1];
    try { if (updated.Title) updated.Title = encryptionConfig.decrypt(updated.Title); } catch (_) {}
    return res.status(200).json(updated);
  } catch (err) {
    console.error('Error updating personal event:', err);
    return res.status(500).json({ message: 'Error updating personal event' });
  }
};

exports.deletePersonalEvent = async (req, res) => {
  const pool = req.app.locals.db;
  const { id } = req.params;
  const { userId } = req.query;
  if (!id || !userId) {
    return res.status(400).json({ message: 'id and userId are required' });
  }
  try {
    const result = await pool.request()
      .input('EventID', sql.Int, parseInt(id, 10))
      .input('UserID', sql.NVarChar, userId)
      .query(`
        DELETE FROM PersonalCalendarEvents
        WHERE EventID = @EventID AND UserID = @UserID;

        SELECT @@ROWCOUNT as affected;
      `);
    const affectedRow = result.recordset && result.recordset[0] ? result.recordset[0].affected : 0;
    if (!affectedRow) {
      return res.status(404).json({ message: 'Event not found' });
    }
    return res.status(200).json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error('Error deleting personal event:', err);
    return res.status(500).json({ message: 'Error deleting personal event' });
  }
};

exports.getCalendarComments = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId, startDate, days, includePast, includeAllComments } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }

  try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Comments', 'CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCommentedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Comments', 'ShowInCalendar') IS NOT NULL THEN 1 ELSE 0 END AS HasShowInCalendar,
        CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
        CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
        CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
        CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
        CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
        CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDepartmentID
    `);
    const probe = schemaProbe.recordset[0] || {};

    if (!probe.HasShowInCalendar) {
      return res.status(200).json([]);
    }

    const usesVacancySchema = !!probe.HasCommentedByVacancy;
    const commentActorCol = usesVacancySchema ? 'CommentedByVacancyID' : 'UserID';

    // Resolve user's department (same pattern as getDepartmentCalendarSubtasks)
    const toNumericDepartmentId = (value) => {
      const text = String(value ?? '').trim();
      if (!/^\d+$/.test(text)) return null;
      const parsed = parseInt(text, 10);
      return Number.isInteger(parsed) ? parsed : null;
    };

    const loginId = String(userId).trim();
    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
    if (probe.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
    if (probe.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);

    let resolvedDepartmentId = null;
    let currentProfile = null;

    if (probe.HasProfileView) {
      const profileRes = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`
          SELECT TOP 1
            p.DepartmentID AS ProfileDepartmentID,
            ${probe.HasUsersDepartmentID ? 'u.DepartmentID AS UserDepartmentID,' : 'CAST(NULL AS INT) AS UserDepartmentID,'}
            p.VacancyID,
            u.UserID
          FROM dbo.Users u
          LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
          WHERE (${whereParts.join(' OR ')})
             OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT))
          ORDER BY
            CASE WHEN LTRIM(RTRIM(u.UserID)) = @LoginID THEN 0 ELSE 1 END ASC,
            CASE WHEN p.VacancyID IS NOT NULL THEN 0 ELSE 1 END ASC
        `);
      currentProfile = profileRes.recordset[0] || null;
      if (currentProfile) {
        resolvedDepartmentId =
          toNumericDepartmentId(currentProfile.ProfileDepartmentID) ??
          toNumericDepartmentId(currentProfile.UserDepartmentID);
      }
    }

    if (resolvedDepartmentId == null && probe.HasAssignmentsTable) {
      const legacyUserId = currentProfile?.UserID ? String(currentProfile.UserID).trim() : loginId;
      const assignRes = await pool.request()
        .input('UserID', sql.NVarChar, legacyUserId)
        .query(`
          SELECT TOP 1
            ${probe.HasVacancyDepartmentID ? 'jv.DepartmentID' : 'CAST(NULL AS INT) AS DepartmentID'}
          FROM dbo.Assignments a
          ${probe.HasVacancyDepartmentID ? 'LEFT JOIN dbo.JobVacancies jv ON jv.VacancyID = a.VacancyID' : ''}
          WHERE a.UserID = @UserID AND a.VacancyID IS NOT NULL
          ORDER BY CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
                   ISNULL(a.StartDate, '1900-01-01') DESC,
                   a.AssignmentID DESC
        `);
      if (assignRes.recordset[0]?.DepartmentID != null) {
        resolvedDepartmentId = toNumericDepartmentId(assignRes.recordset[0].DepartmentID);
      }
    }

    // Date range setup
    let useRange = false;
    let startDateParam = null;
    let endDateParam = null;
    const daysInt = Number.isInteger(parseInt(days)) ? parseInt(days) : 0;
    const includePastFlag = typeof includePast === 'string' && includePast.toLowerCase() === 'true';
    if (startDate || daysInt > 0) {
      useRange = true;
      const base = startDate ? new Date(startDate) : new Date();
      startDateParam = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const endBase = new Date(startDateParam);
      endBase.setDate(endBase.getDate() + (daysInt > 0 ? daysInt : 30));
      endDateParam = endBase;
      if (!includePastFlag) {
        const today = new Date();
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        if (startDateParam < currentMonthStart) startDateParam = currentMonthStart;
      }
    }

    const includeAllFlag = typeof includeAllComments === 'string' && includeAllComments.toLowerCase() === 'true';

    // دعم التعليقات على المهام الشخصية
    const commentPersonalProbe = await pool.request().query(`SELECT COL_LENGTH('dbo.Tasks','PersonalOwnerUserID') AS Len`);
    const hasPersonalColCmt = !!(commentPersonalProbe.recordset[0]?.Len);
    const personalUserIdCmt = await resolveUserIDFromActor(pool, userId);
    const commentPersonalOrClause = hasPersonalColCmt
      ? `OR (t.PersonalOwnerUserID IS NOT NULL AND t.PersonalOwnerUserID = @PersonalUserID)`
      : '';
    const commentPersonalScopeFilter = hasPersonalColCmt
      ? `AND (t.PersonalOwnerUserID IS NULL OR t.PersonalOwnerUserID = @PersonalUserID)`
      : '';

    let items = [];

    if (resolvedDepartmentId != null) {
      const scopeDepartmentIds = await resolveDirectorateScopeByDepartment(pool, resolvedDepartmentId);
      const scopeParams = scopeDepartmentIds.map((_, i) => `@ScopeDepartmentID${i}`).join(', ');
      const departmentScopeCondition = scopeDepartmentIds.length > 0
        ? `t.DepartmentID IN (${scopeParams})`
        : `t.DepartmentID = @DepartmentID`;

      const request = pool.request()
        .input('DepartmentID', sql.NVarChar, String(resolvedDepartmentId))
        .input('IncludeAllComments', sql.Bit, includeAllFlag ? 1 : 0);
      if (hasPersonalColCmt) request.input('PersonalUserID', sql.NVarChar, personalUserIdCmt);
      scopeDepartmentIds.forEach((deptId, i) => {
        request.input(`ScopeDepartmentID${i}`, sql.NVarChar, deptId);
      });
      if (useRange) {
        request.input('StartDate', sql.Date, startDateParam).input('EndDate', sql.Date, endDateParam);
      }

      const dateFilter = useRange
        ? `AND CAST(c.CreatedAt AS DATE) >= @StartDate AND CAST(c.CreatedAt AS DATE) < @EndDate`
        : `AND CAST(c.CreatedAt AS DATE) >= CAST(GETDATE() AS DATE)`;

      const result = await request.query(`
        SELECT
          c.CommentID,
          c.TaskID,
          c.${commentActorCol} as UserID,
          c.Content,
          c.CreatedAt,
          t.Title as TaskTitle,
          t.PersonalOwnerUserID
        FROM Comments c
        INNER JOIN Tasks t ON c.TaskID = t.TaskID
        WHERE (@IncludeAllComments = 1 OR c.ShowInCalendar = 1)
          ${dateFilter}
          AND (${departmentScopeCondition} ${commentPersonalOrClause})
          ${commentPersonalScopeFilter}
        ORDER BY c.CreatedAt ASC, c.CommentID ASC
      `);
      items = result.recordset;
    } else {
      let actorId = loginId;
      if (usesVacancySchema && currentProfile?.VacancyID != null) {
        actorId = String(currentProfile.VacancyID).trim();
      }
      if (!actorId && !hasPersonalColCmt) return res.status(200).json([]);

      const request = pool.request()
        .input('IncludeAllComments', sql.Bit, includeAllFlag ? 1 : 0);
      if (actorId) request.input('ActorID', sql.NVarChar, actorId);
      if (hasPersonalColCmt) request.input('PersonalUserID', sql.NVarChar, personalUserIdCmt);
      if (useRange) {
        request.input('StartDate', sql.Date, startDateParam).input('EndDate', sql.Date, endDateParam);
      }

      const dateFilter = useRange
        ? `AND CAST(c.CreatedAt AS DATE) >= @StartDate AND CAST(c.CreatedAt AS DATE) < @EndDate`
        : `AND CAST(c.CreatedAt AS DATE) >= CAST(GETDATE() AS DATE)`;

      const actorClause = actorId ? `c.${commentActorCol} = @ActorID` : '1=0';
      const result = await request.query(`
        SELECT
          c.CommentID,
          c.TaskID,
          c.${commentActorCol} as UserID,
          c.Content,
          c.CreatedAt,
          t.Title as TaskTitle,
          t.PersonalOwnerUserID
        FROM Comments c
        INNER JOIN Tasks t ON c.TaskID = t.TaskID
        WHERE (@IncludeAllComments = 1 OR c.ShowInCalendar = 1)
          AND (${actorClause} ${commentPersonalOrClause})
          ${commentPersonalScopeFilter}
          ${dateFilter}
        ORDER BY c.CreatedAt ASC, c.CommentID ASC
      `);
      items = result.recordset;
    }

    const decrypted = items.map((r) => {
      try { if (r.Content) r.Content = encryptionConfig.decrypt(r.Content); } catch (_) {}
      try { if (r.TaskTitle) r.TaskTitle = encryptionConfig.decrypt(r.TaskTitle); } catch (_) {}
      return r;
    });

    return res.status(200).json(decrypted);
  } catch (err) {
    console.error('Error fetching calendar comments:', err);
    return res.status(500).json({ message: 'Error fetching calendar comments' });
  }
};

// GET /api/calendar/assigned?userId=...
// يُرجع المهام الفرعية المسندة للمستخدم (غير منجزة) للإضافة
exports.getAssignedSubtasks = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: 'userId is required' });

  try {
    const probe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedTo')          IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyAssigned,
        CASE WHEN COL_LENGTH('dbo.Subtasks','IsCompleted')         IS NOT NULL THEN 1 ELSE 0 END AS HasIsCompleted,
        CASE WHEN COL_LENGTH('dbo.Subtasks','CreatedAt')           IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedAt,
        CASE WHEN COL_LENGTH('dbo.Tasks','PersonalOwnerUserID')    IS NOT NULL THEN 1 ELSE 0 END AS HasPersonalCol,
        CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile','V')       IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
        CASE WHEN OBJECT_ID('dbo.Assignments','U')                 IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
        CASE WHEN COL_LENGTH('dbo.Users','LegacyUserID')           IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
        CASE WHEN COL_LENGTH('dbo.Users','ServiceID')              IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID
    `);
    const p = probe.recordset[0] || {};
    const usesVacancy = !!p.HasVacancy;
    const assignedCol = usesVacancy ? 'AssignedToVacancyID' : 'AssignedTo';

    const loginId = String(userId).trim();
    let actorId = loginId;
    let legacyUserId = loginId;

    if (p.HasProfileView) {
      const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
      if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
      if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);
      const profileRes = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`
          SELECT TOP 1 p.VacancyID, u.UserID
          FROM dbo.Users u
          LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
          WHERE (${whereParts.join(' OR ')})
             OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT))
          ORDER BY
            CASE WHEN LTRIM(RTRIM(u.UserID)) = @LoginID THEN 0 ELSE 1 END ASC,
            CASE WHEN p.VacancyID IS NOT NULL THEN 0 ELSE 1 END ASC
        `);
      const row = profileRes.recordset[0];
      if (row) {
        if (row.UserID) legacyUserId = String(row.UserID).trim();
        actorId = usesVacancy
          ? (row.VacancyID != null ? String(row.VacancyID) : (row.UserID ? String(row.UserID) : loginId))
          : (row.UserID ? String(row.UserID) : loginId);
      }
    } else if (usesVacancy && p.HasAssignments) {
      const assignRes = await pool.request()
        .input('UserID', sql.NVarChar, loginId)
        .query(`
          SELECT TOP 1 VacancyID FROM dbo.Assignments
          WHERE UserID = @UserID AND VacancyID IS NOT NULL
          ORDER BY CASE WHEN IsCurrent=1 THEN 0 ELSE 1 END,
                   ISNULL(StartDate,'1900-01-01') DESC, AssignmentID DESC
        `);
      if (assignRes.recordset[0]?.VacancyID != null) {
        actorId = String(assignRes.recordset[0].VacancyID);
      }
    }

    const completedFilter = p.HasIsCompleted ? `AND (s.IsCompleted = 0 OR s.IsCompleted IS NULL)` : '';
    const personalFilter  = p.HasPersonalCol  ? `AND t.PersonalOwnerUserID IS NULL` : '';
    const assignMatch = (usesVacancy && p.HasLegacyAssigned)
      ? `(s.${assignedCol} = @ActorID OR (s.${assignedCol} IS NULL AND LTRIM(RTRIM(CAST(s.AssignedTo AS NVARCHAR(255)))) = @LegacyUserID))`
      : `s.${assignedCol} = @ActorID`;
    const createdAtCol = p.HasCreatedAt ? `s.CreatedAt,` : `NULL AS CreatedAt,`;

    const result = await pool.request()
      .input('ActorID', sql.NVarChar, actorId)
      .input('LegacyUserID', sql.NVarChar, legacyUserId)
      .query(`
        SELECT TOP 50
          s.SubtaskID,
          s.TaskID,
          s.Title   AS SubtaskTitle,
          s.DueDate,
          ${createdAtCol}
          t.Title   AS TaskTitle
        FROM dbo.Subtasks s
        INNER JOIN dbo.Tasks t ON s.TaskID = t.TaskID
        WHERE ${assignMatch}
          ${completedFilter}
          ${personalFilter}
        ORDER BY s.SubtaskID DESC
      `);

    const decrypted = result.recordset.map(r => {
      try { if (r.SubtaskTitle) r.SubtaskTitle = encryptionConfig.decrypt(r.SubtaskTitle); } catch (_) {}
      try { if (r.TaskTitle)    r.TaskTitle    = encryptionConfig.decrypt(r.TaskTitle);    } catch (_) {}
      return r;
    });

    return res.status(200).json(decrypted);
  } catch (err) {
    console.error('Error fetching assigned subtasks:', err);
    return res.status(500).json({ message: 'Error fetching assigned subtasks', detail: err.message });
  }
};

// GET /api/calendar/reminders?userId=...
// يُرجع المهام الفرعية غير المنجزة الخاصة بالمنصب والمستحقة اليوم (للتذكيرات)
exports.getSubtaskReminders = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: 'userId is required' });

  try {
    // فحص المخطط
    const probe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedTo')          IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyAssigned,
        CASE WHEN COL_LENGTH('dbo.Subtasks','IsCompleted')         IS NOT NULL THEN 1 ELSE 0 END AS HasIsCompleted,
        CASE WHEN COL_LENGTH('dbo.Subtasks','ReminderEnabled')     IS NOT NULL THEN 1 ELSE 0 END AS HasReminderEnabled,
        CASE WHEN COL_LENGTH('dbo.Subtasks','ReminderMinutes')     IS NOT NULL THEN 1 ELSE 0 END AS HasReminderMinutes,
        CASE WHEN COL_LENGTH('dbo.Tasks','PersonalOwnerUserID')    IS NOT NULL THEN 1 ELSE 0 END AS HasPersonalCol,
        CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile','V')       IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
        CASE WHEN OBJECT_ID('dbo.Assignments','U')                 IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
        CASE WHEN COL_LENGTH('dbo.Users','LegacyUserID')           IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
        CASE WHEN COL_LENGTH('dbo.Users','ServiceID')              IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID
    `);
    const p = probe.recordset[0] || {};
    const usesVacancy = !!p.HasVacancy;
    const assignedCol = usesVacancy ? 'AssignedToVacancyID' : 'AssignedTo';

    // حلّ هوية الممثل (VacancyID أو UserID) + هوية المستخدم القديمة (Legacy UserID) للمطابقة الاحتياطية
    const loginId = String(userId).trim();
    let actorId = loginId;
    let legacyUserId = loginId;

    if (p.HasProfileView) {
      const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
      if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
      if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);
      const profileRes = await pool.request()
        .input('LoginID', sql.NVarChar, loginId)
        .query(`
          SELECT TOP 1
            p.VacancyID,
            u.UserID
          FROM dbo.Users u
          LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
          WHERE (${whereParts.join(' OR ')})
             OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT))
          ORDER BY
            CASE WHEN LTRIM(RTRIM(u.UserID)) = @LoginID THEN 0 ELSE 1 END ASC,
            CASE WHEN p.VacancyID IS NOT NULL THEN 0 ELSE 1 END ASC
        `);
      const row = profileRes.recordset[0];
      if (row) {
        if (row.UserID) legacyUserId = String(row.UserID).trim();
        actorId = usesVacancy
          ? (row.VacancyID != null ? String(row.VacancyID) : (row.UserID ? String(row.UserID) : loginId))
          : (row.UserID ? String(row.UserID) : loginId);
      }
    } else if (usesVacancy && p.HasAssignments) {
      const assignRes = await pool.request()
        .input('UserID', sql.NVarChar, loginId)
        .query(`
          SELECT TOP 1 VacancyID FROM dbo.Assignments
          WHERE UserID = @UserID AND VacancyID IS NOT NULL
          ORDER BY CASE WHEN IsCurrent=1 THEN 0 ELSE 1 END,
                   ISNULL(StartDate,'1900-01-01') DESC, AssignmentID DESC
        `);
      if (assignRes.recordset[0]?.VacancyID != null) {
        actorId = String(assignRes.recordset[0].VacancyID);
      }
    }

    const completedFilter = p.HasIsCompleted ? `AND (s.IsCompleted = 0 OR s.IsCompleted IS NULL)` : '';
    const personalFilter  = p.HasPersonalCol  ? `AND t.PersonalOwnerUserID IS NULL` : '';
    // المطابقة الاحتياطية يجب أن تقارن AssignedTo (UserID قديم) بـ LegacyUserID وليس بـ VacancyID
    const assignMatch = (usesVacancy && p.HasLegacyAssigned)
      ? `(s.${assignedCol} = @ActorID OR (s.${assignedCol} IS NULL AND LTRIM(RTRIM(CAST(s.AssignedTo AS NVARCHAR(255)))) = @LegacyUserID))`
      : `s.${assignedCol} = @ActorID`;
    const reminderEnabledSelect = p.HasReminderEnabled
      ? `ISNULL(s.ReminderEnabled, 0) AS ReminderEnabled,`
      : `CAST(0 AS BIT) AS ReminderEnabled,`;
    const reminderMinutesSelect = p.HasReminderMinutes
      ? `ISNULL(s.ReminderMinutes, 15) AS ReminderMinutes`
      : `CAST(15 AS INT) AS ReminderMinutes`;

    const result = await pool.request()
      .input('ActorID', sql.NVarChar, actorId)
      .input('LegacyUserID', sql.NVarChar, legacyUserId)
      .query(`
        SELECT
          s.SubtaskID,
          s.TaskID,
          s.Title       AS SubtaskTitle,
          s.DueDate,
          t.Title       AS TaskTitle,
          ${reminderEnabledSelect}
          ${reminderMinutesSelect}
        FROM dbo.Subtasks s
        INNER JOIN dbo.Tasks t ON s.TaskID = t.TaskID
        WHERE ${assignMatch}
          AND s.DueDate IS NOT NULL
          AND CAST(s.DueDate AS DATE) = CAST(GETDATE() AS DATE)
          ${completedFilter}
          ${personalFilter}
        ORDER BY s.DueDate ASC
      `);

    const decrypted = result.recordset.map(r => {
      try { if (r.SubtaskTitle) r.SubtaskTitle = encryptionConfig.decrypt(r.SubtaskTitle); } catch (_) {}
      try { if (r.TaskTitle)    r.TaskTitle    = encryptionConfig.decrypt(r.TaskTitle);    } catch (_) {}
      return r;
    });

    return res.status(200).json(decrypted);
  } catch (err) {
    console.error('Error fetching subtask reminders:', err);
    return res.status(500).json({ message: 'Error fetching reminders', detail: err.message });
  }
};
