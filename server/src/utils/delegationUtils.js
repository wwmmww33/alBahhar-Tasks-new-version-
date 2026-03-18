// src/utils/delegationUtils.js
const sql = require('mssql');

async function detectIdentitySchema(pool) {
  const result = await pool.request().query(`
    SELECT
      CASE WHEN COL_LENGTH('dbo.Tasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasTaskVacancy,
      CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubtaskVacancy,
      CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorVacancyID') IS NOT NULL
             AND COL_LENGTH('dbo.TaskDelegations', 'DelegateVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasDelegationVacancy
  `);

  const row = result.recordset[0] || {};
  const isVacancy = !!(row.HasTaskVacancy || row.HasSubtaskVacancy || row.HasDelegationVacancy);
  return {
    isVacancy,
    taskCreatorCol: isVacancy ? 'CreatedByVacancyID' : 'CreatedBy',
    taskAssignedCol: isVacancy ? null : 'AssignedTo',
    subtaskAssignedCol: isVacancy ? 'AssignedToVacancyID' : 'AssignedTo',
    delegatorCol: isVacancy ? 'DelegatorVacancyID' : 'DelegatorUserID',
    delegateCol: isVacancy ? 'DelegateVacancyID' : 'DelegateUserID',
    identityTable: isVacancy ? 'JobVacancies' : 'Users',
    identityKey: isVacancy ? 'VacancyID' : 'UserID',
    identityName: isVacancy ? 'Name' : 'FullName'
  };
}

async function resolveAccessActorId(pool, rawUserId, schema) {
  const loginId = rawUserId == null ? '' : String(rawUserId).trim();
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

  if (!schema?.isVacancy) {
    const mapped = await pool.request()
      .input('LoginID', sql.NVarChar, loginId)
      .query(`
        SELECT TOP 1 u.UserID
        FROM dbo.Users u
        WHERE ${whereClause}
      `);
    return String(mapped.recordset[0]?.UserID || loginId).trim();
  }

  if (p.HasProfileView) {
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
    if (row.VacancyID !== null && row.VacancyID !== undefined && String(row.VacancyID).trim() !== '') {
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
      if (fallbackVacancyId !== null && fallbackVacancyId !== undefined && String(fallbackVacancyId).trim() !== '') {
        return String(fallbackVacancyId).trim();
      }
    }

    return String(row.UserID || loginId).trim();
  }

  return loginId;
}

async function checkDelegationPermission(pool, delegatorUserId, delegateUserId, permissionType) {
  try {
    const delegatorId = delegatorUserId == null ? '' : String(delegatorUserId).trim();
    const delegateId = delegateUserId == null ? '' : String(delegateUserId).trim();
    if (!delegatorId || !delegateId) return false;

    if (delegatorId === delegateId) {
      return true;
    }

    const request = pool.request();
    request.input('delegatorUserID', sql.NVarChar(50), delegatorId);
    request.input('delegateUserID', sql.NVarChar(50), delegateId);
    request.input('permissionType', sql.NVarChar(50), permissionType);
    
    const result = await request.query(`
      SELECT dbo.fn_CheckTaskDelegationPermission(@delegatorUserID, @delegateUserID, @permissionType) as HasPermission
    `);
    
    return result.recordset[0].HasPermission === 1;
  } catch (error) {
    console.error('Error checking delegation permission:', error);
    return false;
  }
}

async function hasActiveDelegation(pool, delegatorUserId, delegateUserId) {
  try {
    const delegatorId = delegatorUserId == null ? '' : String(delegatorUserId).trim();
    const delegateId = delegateUserId == null ? '' : String(delegateUserId).trim();
    if (!delegatorId || !delegateId) return false;
    if (delegatorId === delegateId) return true;

    const schema = await detectIdentitySchema(pool);
    const request = pool.request();
    request.input('delegatorUserID', sql.NVarChar(50), delegatorId);
    request.input('delegateUserID', sql.NVarChar(50), delegateId);
    const result = await request.query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TaskDelegations
      WHERE ${schema.delegatorCol} = @delegatorUserID
        AND ${schema.delegateCol} = @delegateUserID
        AND IsActive = 1
        AND StartDate <= GETDATE()
        AND (EndDate IS NULL OR EndDate >= GETDATE())
    `);
    return (result.recordset?.[0]?.Cnt || 0) > 0;
  } catch (error) {
    console.error('Error checking active delegation:', error);
    return false;
  }
}

async function getDelegatorsForUser(pool, delegateUserId) {
  try {
    const schema = await detectIdentitySchema(pool);
    const request = pool.request();
    request.input('delegateUserID', sql.NVarChar(50), delegateUserId);
    
    const result = await request.query(`
      SELECT DISTINCT 
        d.${schema.delegatorCol} as DelegatorUserID,
        u.${schema.identityName} as DelegatorName,
        d.DelegationType,
        d.StartDate,
        d.EndDate
      FROM TaskDelegations d
      INNER JOIN ${schema.identityTable} u ON d.${schema.delegatorCol} = u.${schema.identityKey}
      WHERE d.${schema.delegateCol} = @delegateUserID
      AND d.IsActive = 1
      AND d.StartDate <= GETDATE()
      AND (d.EndDate IS NULL OR d.EndDate >= GETDATE())
    `);
    
    return result.recordset;
  } catch (error) {
    console.error('Error getting delegators for user:', error);
    return [];
  }
}

async function getDelegatesForUser(pool, delegatorUserId) {
  try {
    const schema = await detectIdentitySchema(pool);
    const request = pool.request();
    request.input('delegatorUserID', sql.NVarChar(50), delegatorUserId);
    
    const result = await request.query(`
      SELECT DISTINCT 
        d.${schema.delegateCol} as DelegateUserID,
        u.${schema.identityName} as DelegateName,
        d.DelegationType,
        d.StartDate,
        d.EndDate
      FROM TaskDelegations d
      INNER JOIN ${schema.identityTable} u ON d.${schema.delegateCol} = u.${schema.identityKey}
      WHERE d.${schema.delegatorCol} = @delegatorUserID
      AND d.IsActive = 1
      AND d.StartDate <= GETDATE()
      AND (d.EndDate IS NULL OR d.EndDate >= GETDATE())
    `);
    
    return result.recordset;
  } catch (error) {
    console.error('Error getting delegates for user:', error);
    return [];
  }
}

async function getTasksQueryWithDelegation(pool, userId, isAdmin) {
  try {
    const schema = await detectIdentitySchema(pool);
    const ownerExpr = `t.${schema.taskCreatorCol} = @UserID`;
    const subtaskExpr = `EXISTS (SELECT 1 FROM Subtasks s_inner WHERE s_inner.TaskID = t.TaskID AND s_inner.${schema.subtaskAssignedCol} = @UserID)`;
    const delegationExpr = `EXISTS (
                 SELECT 1
                 FROM TaskDelegations d_acc
                 WHERE d_acc.${schema.delegatorCol} = t.${schema.taskCreatorCol}
                   AND d_acc.${schema.delegateCol} = @UserID
                   AND d_acc.IsActive = 1
                   AND d_acc.StartDate <= GETDATE()
                   AND (d_acc.EndDate IS NULL OR d_acc.EndDate >= GETDATE())
               )`;

    const accessParts = [ownerExpr, subtaskExpr, delegationExpr];
    if (schema.taskAssignedCol) {
      accessParts.splice(1, 0, `t.${schema.taskAssignedCol} = @UserID`);
    }
    const accessWhere = accessParts.join('\n          OR ');

    const assigneeSelect = schema.taskAssignedCol ? `
               t.${schema.taskAssignedCol} as AssignedTo,
               assignee.${schema.identityName} as AssignedToName,` : `
               CAST(NULL as nvarchar(50)) as AssignedTo,
               CAST(NULL as nvarchar(200)) as AssignedToName,`;

    const assigneeJoin = schema.taskAssignedCol
      ? `LEFT JOIN ${schema.identityTable} assignee ON t.${schema.taskAssignedCol} = assignee.${schema.identityKey}`
      : '';

    if (isAdmin) {
      return `
        SELECT t.*,
               creator.${schema.identityName} as CreatedByName,
               acted.${schema.identityName} as ActedByName,${assigneeSelect}
               c.Name as CategoryName,
               CASE WHEN ${ownerExpr} THEN 'owner' ELSE 'admin' END as AccessType
        FROM Tasks t
        LEFT JOIN ${schema.identityTable} creator ON t.${schema.taskCreatorCol} = creator.${schema.identityKey}
        LEFT JOIN ${schema.identityTable} acted ON COALESCE(t.ActedBy, t.LastActedByVacancyID, t.${schema.taskCreatorCol}) = acted.${schema.identityKey}
        ${assigneeJoin}
        LEFT JOIN Categories c ON t.CategoryID = c.CategoryID
        WHERE t.Status NOT IN ('completed', 'cancelled')
        ORDER BY t.CreatedAt DESC
      `;
    }

    return `
      SELECT DISTINCT t.*, creator.${schema.identityName} as CreatedByName, acted.${schema.identityName} as ActedByName,${assigneeSelect}
             c.Name as CategoryName,
             CASE 
               WHEN ${ownerExpr} THEN 'owner'
               WHEN ${delegationExpr} THEN 'delegated'
               ELSE 'assigned'
             END as AccessType
      FROM Tasks t
      LEFT JOIN ${schema.identityTable} creator ON t.${schema.taskCreatorCol} = creator.${schema.identityKey}
      LEFT JOIN ${schema.identityTable} acted ON COALESCE(t.ActedBy, t.LastActedByVacancyID, t.${schema.taskCreatorCol}) = acted.${schema.identityKey}
      ${assigneeJoin}
      LEFT JOIN Categories c ON t.CategoryID = c.CategoryID
      WHERE t.Status NOT IN ('completed', 'cancelled')
        AND (
          ${accessWhere}
        )
      ORDER BY t.CreatedAt DESC
    `;
  } catch (error) {
    console.error('Error building tasks query with delegation:', error);
    // في حالة الخطأ، إرجاع الاستعلام الأساسي
    return `
      SELECT DISTINCT t.*, creator.FullName as CreatedByName, acted.FullName as ActedByName, c.Name as CategoryName,
             'owner' as AccessType
      FROM Tasks t
      LEFT JOIN Users creator ON t.CreatedBy = creator.UserID
      LEFT JOIN Users acted ON t.ActedBy = acted.UserID
      LEFT JOIN Categories c ON t.CategoryID = c.CategoryID
      WHERE t.Status NOT IN ('completed', 'cancelled')
        AND (
          t.CreatedBy = @UserID
          OR t.AssignedTo = @UserID
          OR EXISTS (SELECT 1 FROM Subtasks s_inner WHERE s_inner.TaskID = t.TaskID AND s_inner.AssignedTo = @UserID)
        )
      ORDER BY t.CreatedAt DESC
    `;
  }
}

async function hasDirectorateAccessByTaskDepartment(pool, effectiveActorId, taskDepartmentId, schema) {
  try {
    const targetDepartmentId = String(taskDepartmentId || '').trim();
    if (!targetDepartmentId || !/^\d+$/.test(targetDepartmentId)) return false;

  const probe = await pool.request().query(`
    SELECT
      CASE WHEN COL_LENGTH('dbo.Departments', 'ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDepartmentID,
      CASE WHEN COL_LENGTH('dbo.Departments', 'ParentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
      CASE WHEN COL_LENGTH('dbo.Departments', 'Type') IS NOT NULL THEN 1 ELSE 0 END AS HasDepartmentType,
      CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
      CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
      CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
      CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
      CASE WHEN COL_LENGTH('dbo.vw_UserCurrentProfile', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileDepartmentID,
      CASE WHEN COL_LENGTH('dbo.vw_UserCurrentProfile', 'VacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileVacancyID,
      CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignmentsTable,
      CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyDepartmentID
  `);
  const p = probe.recordset[0] || {};
  const parentCol = p.HasParentDepartmentID ? 'ParentDepartmentID' : (p.HasParentID ? 'ParentID' : null);
  if (!parentCol) return false;

  let actorDepartmentId = null;
  const actorText = String(effectiveActorId || '').trim();
  const actorNumeric = parseInt(actorText, 10);

  if (schema?.isVacancy && p.HasVacancyDepartmentID && Number.isInteger(actorNumeric)) {
    const vacancyDept = await pool.request()
      .input('VacancyID', sql.Int, actorNumeric)
      .query(`SELECT TOP 1 DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
    if (vacancyDept.recordset[0]?.DepartmentID != null) {
      actorDepartmentId = String(vacancyDept.recordset[0].DepartmentID).trim();
    }
  }

  const userMatchParts = [`LTRIM(RTRIM(u.UserID)) = @ActorID`];
  if (p.HasLegacyUserID) userMatchParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @ActorID`);
  if (p.HasServiceID) userMatchParts.push(`LTRIM(RTRIM(u.ServiceID)) = @ActorID`);

  if (actorDepartmentId == null && p.HasProfileView && p.HasProfileDepartmentID) {
    if (p.HasProfileVacancyID && Number.isInteger(actorNumeric)) {
      const profileByVacancy = await pool.request()
        .input('VacancyID', sql.Int, actorNumeric)
        .query(`
          SELECT TOP 1 DepartmentID
          FROM dbo.vw_UserCurrentProfile
          WHERE VacancyID = @VacancyID
            AND DepartmentID IS NOT NULL
        `);
      if (profileByVacancy.recordset[0]?.DepartmentID != null) {
        actorDepartmentId = String(profileByVacancy.recordset[0].DepartmentID).trim();
      }
    }

    if (actorDepartmentId == null) {
      const profileByUser = await pool.request()
        .input('ActorID', sql.NVarChar, actorText)
        .query(`
          SELECT TOP 1 p.DepartmentID
          FROM dbo.Users u
          INNER JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
          WHERE ${userMatchParts.join(' OR ')}
            AND p.DepartmentID IS NOT NULL
        `);
      if (profileByUser.recordset[0]?.DepartmentID != null) {
        actorDepartmentId = String(profileByUser.recordset[0].DepartmentID).trim();
      }
    }
  }

  if (actorDepartmentId == null && p.HasUsersDepartmentID) {
    const userDept = await pool.request()
      .input('ActorID', sql.NVarChar, actorText)
      .query(`
        SELECT TOP 1 u.DepartmentID, u.UserID
        FROM dbo.Users u
        WHERE ${userMatchParts.join(' OR ')}
      `);
    if (userDept.recordset[0]?.DepartmentID != null) {
      actorDepartmentId = String(userDept.recordset[0].DepartmentID).trim();
    }
  }

  if (actorDepartmentId == null && p.HasAssignmentsTable && p.HasVacancyDepartmentID) {
    const assignmentDept = await pool.request()
      .input('ActorID', sql.NVarChar, actorText)
      .query(`
        SELECT TOP 1 jv.DepartmentID
        FROM dbo.Assignments a
        INNER JOIN dbo.JobVacancies jv ON jv.VacancyID = a.VacancyID
        INNER JOIN dbo.Users u ON u.UserID = a.UserID
        WHERE ${userMatchParts.join(' OR ')}
          AND a.VacancyID IS NOT NULL
        ORDER BY
          CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
          ISNULL(a.StartDate, '1900-01-01') DESC,
          a.AssignmentID DESC
      `);
    if (assignmentDept.recordset[0]?.DepartmentID != null) {
      actorDepartmentId = String(assignmentDept.recordset[0].DepartmentID).trim();
    }
  }

  if (!actorDepartmentId || !/^\d+$/.test(String(actorDepartmentId))) return false;

  const rootOrSelfResult = await pool.request()
    .input('DepartmentID', sql.Int, parseInt(String(actorDepartmentId), 10))
    .query(`
      ;WITH UpTree AS (
        SELECT DepartmentID, ${parentCol} AS ParentDepartmentID, 0 AS Depth
        FROM dbo.Departments
        WHERE DepartmentID = @DepartmentID
        UNION ALL
        SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID, u.Depth + 1
        FROM dbo.Departments d
        INNER JOIN UpTree u ON d.DepartmentID = u.ParentDepartmentID
      )
      SELECT TOP 1 DepartmentID
      FROM (
        SELECT u.DepartmentID, u.Depth
        FROM UpTree u
        INNER JOIN dbo.Departments d ON d.DepartmentID = u.DepartmentID
        WHERE ${p.HasDepartmentType ? 'd.[Type] = 1' : '1=0'}
      ) x
      ORDER BY x.Depth ASC
      OPTION (MAXRECURSION 100)
    `);

  const rootDepartmentId = String(rootOrSelfResult.recordset[0]?.DepartmentID || actorDepartmentId).trim();
  if (!rootDepartmentId || !/^\d+$/.test(rootDepartmentId)) return false;

    const checkResult = await pool.request()
      .input('RootDepartmentID', sql.Int, parseInt(rootDepartmentId, 10))
      .input('TargetDepartmentID', sql.Int, parseInt(targetDepartmentId, 10))
      .query(`
      ;WITH DeptTree AS (
        SELECT DepartmentID, ${parentCol} AS ParentDepartmentID
        FROM dbo.Departments
        WHERE DepartmentID = @RootDepartmentID
        UNION ALL
        SELECT d.DepartmentID, d.${parentCol} AS ParentDepartmentID
        FROM dbo.Departments d
        INNER JOIN DeptTree dt ON d.${parentCol} = dt.DepartmentID
      )
      SELECT TOP 1 1 AS InScope
      FROM DeptTree
      WHERE DepartmentID = @TargetDepartmentID
      OPTION (MAXRECURSION 300)
    `);

    return (checkResult.recordset || []).length > 0;
  } catch (_) {
    return false;
  }
}

async function checkTaskAccess(pool, taskId, userId, isAdmin, requiredPermission = 'view') {
  try {
    const normalizedUserId = userId == null ? '' : String(userId).trim();
    const schema = await detectIdentitySchema(pool);
    const effectiveActorId = await resolveAccessActorId(pool, normalizedUserId, schema);
    const taskRequest = pool.request();
    taskRequest.input('taskId', sql.Int, taskId);
    
    const taskResult = await taskRequest.query(`
      SELECT TaskID, ${schema.taskCreatorCol} as CreatedBy, Title, DepartmentID${schema.taskAssignedCol ? `, ${schema.taskAssignedCol} as AssignedTo` : ''}
      FROM Tasks
      WHERE TaskID = @taskId
    `);
    
    if (taskResult.recordset.length === 0) {
      return { hasAccess: false, reason: 'المهمة غير موجودة' };
    }
    
    const task = taskResult.recordset[0];
    
    if (isAdmin) {
      return { hasAccess: true, accessType: 'admin', task };
    }
    
    if (String(task.CreatedBy) === effectiveActorId) {
      return { hasAccess: true, accessType: 'owner', task };
    }

    if (schema.taskAssignedCol && String(task.AssignedTo) === effectiveActorId) {
      if (requiredPermission === 'view' || requiredPermission === 'edit') {
        return { hasAccess: true, accessType: 'assigned', task };
      }
      return { hasAccess: false, reason: 'صلاحية محدودة - عرض وتعديل فقط' };
    }

    const hasDirectorateAccess = await hasDirectorateAccessByTaskDepartment(pool, effectiveActorId, task.DepartmentID, schema);
    if (hasDirectorateAccess) {
      if (requiredPermission === 'view' || requiredPermission === 'edit') {
        return { hasAccess: true, accessType: 'department', task };
      }
      return { hasAccess: false, reason: 'صلاحية محدودة - عرض وتعديل فقط' };
    }

    const assignmentNotifSchema = await pool.request().query(`
      SELECT
        CASE WHEN OBJECT_ID('dbo.TaskAssignmentNotifications', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasTable,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToUser
    `);

    const an = assignmentNotifSchema.recordset[0] || {};
    if (an.HasTable) {
      const assignedToNotifCol = an.HasAssignedToVacancy ? 'AssignedToVacancyID' : (an.HasAssignedToUser ? 'AssignedToUserID' : null);
      if (assignedToNotifCol) {
        const assignmentNotifResult = await pool.request()
          .input('taskId', sql.Int, taskId)
          .input('userId', sql.NVarChar(50), effectiveActorId)
          .query(`
            SELECT COUNT(*) as AssignedByNotification
            FROM TaskAssignmentNotifications
            WHERE TaskID = @taskId
              AND ${assignedToNotifCol} = @userId
          `);

        if ((assignmentNotifResult.recordset?.[0]?.AssignedByNotification || 0) > 0) {
          if (requiredPermission === 'view' || requiredPermission === 'edit') {
            return { hasAccess: true, accessType: 'assigned', task };
          }
          return { hasAccess: false, reason: 'صلاحية محدودة - عرض وتعديل فقط' };
        }
      }
    }
    
    const hasDelegationPermission = await checkDelegationPermission(pool, task.CreatedBy, effectiveActorId, requiredPermission);
    if (hasDelegationPermission) {
      return { hasAccess: true, accessType: 'delegated', task };
    }
    
    const subtaskRequest = pool.request();
    subtaskRequest.input('taskId', sql.Int, taskId);
    subtaskRequest.input('userId', sql.NVarChar(50), effectiveActorId);
    
    const subtaskResult = await subtaskRequest.query(`
      SELECT COUNT(*) as AssignedSubtasks
      FROM Subtasks
      WHERE TaskID = @taskId AND ${schema.subtaskAssignedCol} = @userId
    `);
    
    if (subtaskResult.recordset[0].AssignedSubtasks > 0) {
      // المستخدم مُسند إليه مهام فرعية
      if (requiredPermission === 'view' || requiredPermission === 'edit') {
        return { hasAccess: true, accessType: 'assigned', task };
      } else {
        return { hasAccess: false, reason: 'صلاحية محدودة - عرض وتعديل فقط' };
      }
    }
    
    return { hasAccess: false, reason: 'ليس لديك صلاحية للوصول لهذه المهمة' };
  } catch (error) {
    console.error('Error checking task access:', error);
    return { hasAccess: false, reason: 'خطأ في التحقق من الصلاحية' };
  }
}

module.exports = {
  checkDelegationPermission,
  hasActiveDelegation,
  getDelegatorsForUser,
  getDelegatesForUser,
  getTasksQueryWithDelegation,
  checkTaskAccess
};
