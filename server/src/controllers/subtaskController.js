// src/controllers/subtaskController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { checkTaskAccess } = require('../utils/delegationUtils');

const resolveActingUserId = (req) => {
  return String(
    req.body?.UserID ||
    req.body?.userId ||
    req.body?.assignedByUserId ||
    req.query?.userId ||
    req.headers['user-id'] ||
    ''
  ).trim();
};

const resolveIsAdmin = (req) => req.body?.isAdmin === true || req.body?.isAdmin === 'true' || req.query?.isAdmin === 'true';

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
    const directVacancyMatch = await pool.request()
      .input('LoginID', sql.NVarChar, loginId)
      .query(`
        SELECT TOP 1 1 AS HasMatch
        FROM dbo.Users u
        LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
        WHERE TRY_CAST(@LoginID AS INT) IS NOT NULL
          AND (
            p.VacancyID = TRY_CAST(@LoginID AS INT)
            ${p.HasAssignmentsTable ? 'OR EXISTS (SELECT 1 FROM dbo.Assignments a WHERE a.UserID = u.UserID AND a.VacancyID = TRY_CAST(@LoginID AS INT))' : ''}
          )
      `);

    if ((directVacancyMatch.recordset || []).length > 0) {
      return loginId;
    }

    const assignmentExistsExpr = p.HasAssignmentsTable
      ? '(TRY_CAST(@LoginID AS INT) IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Assignments a WHERE a.UserID = u.UserID AND a.VacancyID = TRY_CAST(@LoginID AS INT)))'
      : '1=0';

    const mapped = await pool.request()
      .input('LoginID', sql.NVarChar, loginId)
      .query(`
        SELECT TOP 1 u.UserID, p.VacancyID
        FROM dbo.Users u
        LEFT JOIN dbo.vw_UserCurrentProfile p ON p.UserID = u.UserID
        WHERE (${whereClause})
          OR (TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT))
          OR ${assignmentExistsExpr}
        ORDER BY
          CASE
            WHEN TRY_CAST(@LoginID AS INT) IS NOT NULL AND p.VacancyID = TRY_CAST(@LoginID AS INT) THEN 0
            WHEN ${whereClause} THEN 1
            WHEN ${assignmentExistsExpr} THEN 2
            ELSE 3
          END,
          u.UserID
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

async function resolveStrictActorCandidates(pool, rawUserId) {
  const loginId = String(rawUserId || '').trim();
  const candidates = new Set();
  if (!loginId) return candidates;
  candidates.add(loginId);

  try {
    const asUser = await resolveActorId(pool, loginId, false);
    if (asUser) candidates.add(String(asUser).trim());
  } catch (_) {}

  try {
    const asVacancy = await resolveActorId(pool, loginId, true);
    if (asVacancy) candidates.add(String(asVacancy).trim());
  } catch (_) {}

  return candidates;
}

function hasSubtaskOwnership(existingSubtask, actorCandidates) {
  if (!existingSubtask || !actorCandidates || actorCandidates.size === 0) return false;
  const ownerFields = [
    existingSubtask.CreatedBy,
    existingSubtask.CreatedByVacancyID,
    existingSubtask.ActedBy,
    existingSubtask.LastActedByVacancyID,
  ];
  return ownerFields.some((value) => value != null && actorCandidates.has(String(value).trim()));
}

function isSubtaskAssignedToActor(existingSubtask, actorCandidates) {
  if (!existingSubtask || !actorCandidates || actorCandidates.size === 0) return false;
  const assignmentFields = [
    existingSubtask.AssignedTo,
    existingSubtask.AssignedToVacancyID,
  ];
  return assignmentFields.some((value) => value != null && actorCandidates.has(String(value).trim()));
}

const normalizedId = (value) => String(value ?? '').trim();

async function isActorSubtaskCreator(pool, subtaskRow, rawUserId) {
  if (!subtaskRow) return false;
  const createdByVacancy = normalizedId(subtaskRow.CreatedByVacancyID);
  const createdByUser = normalizedId(subtaskRow.CreatedBy);

  if (createdByVacancy) {
    const vacancyActor = normalizedId(await resolveActorId(pool, rawUserId, true));
    return !!vacancyActor && vacancyActor === createdByVacancy;
  }

  if (createdByUser) {
    const userActor = normalizedId(await resolveActorId(pool, rawUserId, false));
    return !!userActor && userActor === createdByUser;
  }

  return false;
}

async function isActorSubtaskAssignee(pool, subtaskRow, rawUserId) {
  if (!subtaskRow) return false;
  const assignedVacancy = normalizedId(subtaskRow.AssignedToVacancyID);
  const assignedUser = normalizedId(subtaskRow.AssignedTo);

  if (assignedVacancy) {
    const vacancyActor = normalizedId(await resolveActorId(pool, rawUserId, true));
    return !!vacancyActor && vacancyActor === assignedVacancy;
  }

  if (assignedUser) {
    const userActor = normalizedId(await resolveActorId(pool, rawUserId, false));
    return !!userActor && userActor === assignedUser;
  }

  return false;
}

exports.getAllSubtasks = async (req, res) => {
  const pool = req.app.locals.db;
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: 'User identification is required' });
  }

  try {
    const result = await pool.request()
      .input('UserId', sql.NVarChar, userId)
      .query(`
        SELECT 
          s.SubtaskID,
          s.TaskID,
          s.Title,
          s.CreatedBy,
          s.AssignedTo,
          s.IsCompleted,
          s.DueDate,
          s.ShowInCalendar,
          s.CreatedAt,
          t.Priority
        FROM Subtasks s
        INNER JOIN Tasks t ON s.TaskID = t.TaskID
        WHERE s.AssignedTo = @UserId
        ORDER BY s.CreatedAt DESC
      `);

    const subtasks = result.recordset.map(s => {
      if (s.Title) {
        try { s.Title = encryptionConfig.decrypt(s.Title); } catch (_) {}
      }
      return s;
    });

    res.json(subtasks);
  } catch (error) {
    console.error('Error fetching subtasks:', error);
    res.status(500).json({ message: 'Error fetching subtasks' });
  }
};

exports.createSubtask = async (req, res) => {
  const pool = req.app.locals.db;
  // --- تأكد من أننا نستقبل كل هذه الحقول ---
  const { TaskID, Title, CreatedBy, ActedBy, DueDate, EndDate, AssignedTo, ShowInCalendar } = req.body;
  
  if (!TaskID || !Title || !CreatedBy) {
    return res.status(400).json({ message: 'TaskID, Title, and CreatedBy are required.' });
  }

  const finalAssignedTo = AssignedTo || CreatedBy;
  let actorUserId = null;
  if (ActedBy && ActedBy !== CreatedBy) {
    try {
      const { hasActiveDelegation } = require('../utils/delegationUtils');
      const active = await hasActiveDelegation(pool, CreatedBy, ActedBy);
      if (active) {
        actorUserId = ActedBy;
      }
    } catch (_) {
      actorUserId = null;
    }
  }
  const encryptedTitle = encryptionConfig.encrypt(Title);

  try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'DueDate') IS NOT NULL THEN 1 ELSE 0 END AS HasDueDate,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'EndDate') IS NOT NULL THEN 1 ELSE 0 END AS HasEndDate,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ShowInCalendar') IS NOT NULL THEN 1 ELSE 0 END AS HasShowInCalendar,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'IsCompleted') IS NOT NULL THEN 1 ELSE 0 END AS HasIsCompleted,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedAt') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedAt,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifAssignedToUser,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifAssignedByVacancy,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedByUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifAssignedByUser
    `);
    const schema = schemaProbe.recordset[0] || {};
    const createdByCol = schema.HasCreatedByVacancy ? 'CreatedByVacancyID' : (schema.HasCreatedByUser ? 'CreatedBy' : null);
    const assignedToCol = schema.HasAssignedToVacancy ? 'AssignedToVacancyID' : (schema.HasAssignedToUser ? 'AssignedTo' : null);
    if (!createdByCol || !assignedToCol) {
      return res.status(500).json({ message: 'Subtasks schema is missing required actor columns.' });
    }

    const actingUserId = resolveActingUserId(req) || String(CreatedBy);
    const accessCheck = await checkTaskAccess(pool, TaskID, actingUserId, resolveIsAdmin(req), 'view');
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية إنشاء مهمة فرعية.' });
    }

    const createdByActorForStorage = await resolveActorId(pool, CreatedBy, !!schema.HasCreatedByVacancy);
    const assignedToActorForStorage = await resolveActorId(pool, finalAssignedTo, !!schema.HasAssignedToVacancy);
    const actedByActorForStorage = actorUserId
      ? await resolveActorId(pool, actorUserId, !!schema.HasCreatedByVacancy)
      : '';

    // تطبيع DueDate وEndDate إلى تاريخ محلي فقط لتجنب انحراف المنطقة الزمنية
    let dueDateNormalized = null;
    if (DueDate) {
      const d = new Date(DueDate);
      dueDateNormalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    let endDateNormalized = null;
    if (EndDate) {
      const d = new Date(EndDate);
      endDateNormalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const createReq = pool.request()
      .input('TaskID', sql.Int, TaskID)
      .input('Title', sql.NVarChar, encryptedTitle)
      .input('CreatedByActor', sql.NVarChar, createdByActorForStorage)
      .input('AssignedToActor', sql.NVarChar, assignedToActorForStorage);

    const insertColumns = ['TaskID', 'Title', createdByCol, assignedToCol];
    const insertValues = ['@TaskID', '@Title', '@CreatedByActor', '@AssignedToActor'];

    if (schema.HasActedBy) {
      createReq.input('ActedBy', sql.NVarChar, actorUserId);
      insertColumns.push('ActedBy');
      insertValues.push('@ActedBy');
    }
    if (schema.HasLastActedByVacancy) {
      createReq.input('LastActedByVacancyID', sql.NVarChar, actedByActorForStorage || createdByActorForStorage);
      insertColumns.push('LastActedByVacancyID');
      insertValues.push('@LastActedByVacancyID');
    }
    if (schema.HasIsCompleted) {
      insertColumns.push('IsCompleted');
      insertValues.push('0');
    }
    if (schema.HasDueDate) {
      createReq.input('DueDate', sql.Date, dueDateNormalized);
      insertColumns.push('DueDate');
      insertValues.push('@DueDate');
    }
    if (schema.HasEndDate) {
      createReq.input('EndDate', sql.Date, endDateNormalized);
      insertColumns.push('EndDate');
      insertValues.push('@EndDate');
    }
    if (schema.HasCreatedAt) {
      insertColumns.push('CreatedAt');
      insertValues.push('GETDATE()');
    }
    if (schema.HasShowInCalendar) {
      createReq.input('ShowInCalendar', sql.Bit, ShowInCalendar === true ? 1 : 0);
      insertColumns.push('ShowInCalendar');
      insertValues.push('@ShowInCalendar');
    }

    const result = await createReq.query(`
      INSERT INTO Subtasks (${insertColumns.join(', ')})
      OUTPUT INSERTED.*
      VALUES (${insertValues.join(', ')});
    `);

    const newSubtask = result.recordset[0];

    if (finalAssignedTo && String(assignedToActorForStorage).trim() !== String(createdByActorForStorage).trim()) {
      try {
        const notifAssignedToCol = schema.HasNotifAssignedToVacancy ? 'AssignedToVacancyID' : (schema.HasNotifAssignedToUser ? 'AssignedToUserID' : null);
        const notifAssignedByCol = schema.HasNotifAssignedByVacancy ? 'AssignedByVacancyID' : (schema.HasNotifAssignedByUser ? 'AssignedByUserID' : null);
        if (notifAssignedToCol && notifAssignedByCol) {
          const assignedToNotifActor = await resolveActorId(pool, finalAssignedTo, !!schema.HasNotifAssignedToVacancy);
          const assignedByNotifActor = await resolveActorId(pool, CreatedBy, !!schema.HasNotifAssignedByVacancy);
          await pool.request()
            .input('TaskID', sql.Int, TaskID)
            .input('AssignedToActorID', sql.NVarChar, assignedToNotifActor)
            .input('AssignedByActorID', sql.NVarChar, assignedByNotifActor)
            .query(`
              INSERT INTO TaskAssignmentNotifications (TaskID, ${notifAssignedToCol}, ${notifAssignedByCol})
              VALUES (@TaskID, @AssignedToActorID, @AssignedByActorID)
            `);
        }
      } catch (notifErr) {
        console.warn('Subtask assignment notification skipped:', notifErr.message || notifErr);
      }
    }

    // فك تشفير العنوان قبل الإرجاع
    if (newSubtask && newSubtask.Title) {
      try { newSubtask.Title = encryptionConfig.decrypt(newSubtask.Title); } catch (_) {}
    }

    res.status(201).json(newSubtask);
  } catch (error) {
    console.error("DATABASE CREATE SUBTASK ERROR:", error);
    res.status(500).send({ message: 'Error creating subtask' });
  }
};

exports.updateSubtaskStatus = async (req, res) => {
  const pool = req.app.locals.db;
  const { subtaskId } = req.params;
  const { isCompleted } = req.body;

  if (typeof isCompleted !== 'boolean') {
    return res.status(400).json({ message: 'isCompleted field must be a boolean.' });
  }

  try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToUser
    `);
    const schema = schemaProbe.recordset[0] || {};

    const subtaskResult = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query(`
        SELECT TOP 1
          TaskID,
          ${schema.HasAssignedToUser ? 'AssignedTo' : 'CAST(NULL AS NVARCHAR(255)) AS AssignedTo'},
          ${schema.HasAssignedToVacancy ? 'AssignedToVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS AssignedToVacancyID'}
        FROM Subtasks
        WHERE SubtaskID = @SubtaskID
      `);

    if (!subtaskResult.recordset.length) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    const actingUserId = resolveActingUserId(req);
    const isAssignee = await isActorSubtaskAssignee(pool, subtaskResult.recordset[0], actingUserId);
    if (!isAssignee) {
      return res.status(403).json({ message: 'فقط الشخص المسندت له المهمة الفرعية يمكنه تغيير حالة الإكمال.' });
    }

    await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .input('IsCompleted', sql.Bit, isCompleted)
      .query('UPDATE Subtasks SET IsCompleted = @IsCompleted WHERE SubtaskID = @SubtaskID');
    res.status(200).json({ message: 'Subtask status updated successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Error updating subtask status' });
  }
};

exports.assignSubtask = async (req, res) => {
  const pool = req.app.locals.db;
  const { subtaskId } = req.params;
  const { assignedToUserId, assignedByUserId } = req.body;

  if (assignedToUserId === undefined) {
    return res.status(400).json({ message: 'assignedToUserId field is required.' });
  }

  try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedTo') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToUser
    `);
    const schema = schemaProbe.recordset[0] || {};

    // الحصول على معلومات المهمة الفرعية والمهمة الرئيسية
    const subtaskResult = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query(`
        SELECT TOP 1
          TaskID,
          ${schema.HasAssignedToUser ? 'AssignedTo' : 'CAST(NULL AS NVARCHAR(255)) AS AssignedTo'},
          ${schema.HasAssignedToVacancy ? 'AssignedToVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS AssignedToVacancyID'},
          ${schema.HasCreatedByUser ? 'CreatedBy' : 'CAST(NULL AS NVARCHAR(255)) AS CreatedBy'},
          ${schema.HasCreatedByVacancy ? 'CreatedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS CreatedByVacancyID'},
          ${schema.HasActedBy ? 'ActedBy' : 'CAST(NULL AS NVARCHAR(255)) AS ActedBy'},
          ${schema.HasLastActedByVacancy ? 'LastActedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS LastActedByVacancyID'}
        FROM Subtasks
        WHERE SubtaskID = @SubtaskID
      `);
    
    if (subtaskResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    const subtask = subtaskResult.recordset[0];
    const actingUserId = resolveActingUserId(req);
    const isCreator = await isActorSubtaskCreator(pool, subtask, actingUserId);
    if (!isCreator) {
      return res.status(403).json({ message: 'فقط منشئ المهمة الفرعية يمكنه تغيير الإسناد.' });
    }

    const previousAssignedTo = String(subtask.AssignedToVacancyID ?? subtask.AssignedTo ?? '').trim();
    const nextAssignedTo = assignedToUserId
      ? await resolveActorId(pool, assignedToUserId, !!schema.HasAssignedToVacancy)
      : null;

    // تحديث إسناد المهمة الفرعية
    await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .input('AssignedToActor', sql.NVarChar, nextAssignedTo)
      .query(`
        UPDATE Subtasks
        SET
          ${schema.HasAssignedToUser ? 'AssignedTo = @AssignedToActor' : 'TaskID = TaskID'},
          ${schema.HasAssignedToVacancy ? 'AssignedToVacancyID = @AssignedToActor' : 'TaskID = TaskID'}
        WHERE SubtaskID = @SubtaskID
      `);

    if (nextAssignedTo && String(nextAssignedTo).trim() !== previousAssignedTo && assignedByUserId) {
      try {
        // التحقق من وجود المستخدم المسند
        const userCheck = await pool.request()
          .input('AssignedByUserID', sql.NVarChar, assignedByUserId)
          .query('SELECT UserID FROM Users WHERE UserID = @AssignedByUserID');

        if (userCheck.recordset.length > 0) {
          await pool.request()
            .input('TaskID', sql.Int, subtask.TaskID)
            .input('AssignedToUserID', sql.NVarChar, assignedToUserId)
            .input('AssignedByUserID', sql.NVarChar, assignedByUserId)
            .query(`
              INSERT INTO TaskAssignmentNotifications
              (TaskID, AssignedToUserID, AssignedByUserID)
              VALUES (@TaskID, @AssignedToUserID, @AssignedByUserID)
            `);
        }
      } catch (notifError) {
        console.warn('Subtask assign notification skipped:', notifError.message || notifError);
      }
    }

    res.status(200).json({ message: 'Subtask assigned successfully' });
  } catch (error) {
    console.error('Error assigning subtask:', error);
    res.status(500).send({ message: 'Error assigning subtask' });
  }
};

exports.bulkAssignSubtask = async (req, res) => {
  const pool = req.app.locals.db;
  const { subtaskId } = req.params;
  const { assignedToUserIds, assignedByUserId } = req.body;

  if (!Array.isArray(assignedToUserIds) || assignedToUserIds.length === 0) {
    return res.status(400).json({ message: 'assignedToUserIds array is required.' });
  }

  try {
    // 0. فحص المخطط — نفس طريقة createSubtask
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedBy')           IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'AssignedTo')          IS NOT NULL THEN 1 ELSE 0 END AS HasAssignedToUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ActedBy')             IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'EndDate')             IS NOT NULL THEN 1 ELSE 0 END AS HasEndDate,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ShowInCalendar')      IS NOT NULL THEN 1 ELSE 0 END AS HasShowInCalendar,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifToVacancy,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToUserID')    IS NOT NULL THEN 1 ELSE 0 END AS HasNotifToUser,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasNotifByVacancy,
        CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedByUserID')    IS NOT NULL THEN 1 ELSE 0 END AS HasNotifByUser
    `);
    const schema = schemaProbe.recordset[0] || {};

    const assignedToCol  = schema.HasAssignedToVacancy ? 'AssignedToVacancyID' : 'AssignedTo';
    const createdByCol   = schema.HasCreatedByVacancy  ? 'CreatedByVacancyID'  : 'CreatedBy';
    const prefersVacancy = !!schema.HasAssignedToVacancy;
    const notifToCol     = schema.HasNotifToVacancy ? 'AssignedToVacancyID' : (schema.HasNotifToUser ? 'AssignedToUserID' : null);
    const notifByCol     = schema.HasNotifByVacancy ? 'AssignedByVacancyID' : (schema.HasNotifByUser ? 'AssignedByUserID' : null);

    // 1. جلب المهمة الفرعية الأصلية
    const subtaskResult = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query('SELECT * FROM Subtasks WHERE SubtaskID = @SubtaskID');

    if (subtaskResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    const originalSubtask = subtaskResult.recordset[0];
    const actingUserId = resolveActingUserId(req);
    const isCreator = await isActorSubtaskCreator(pool, originalSubtask, actingUserId);
    if (!isCreator) {
      return res.status(403).json({ message: 'فقط منشئ المهمة الفرعية يمكنه تغيير الإسناد.' });
    }

    // مساعد: إدراج إشعار (غير حرج — يتجاهل الأخطاء)
    const assignedByResolved = assignedByUserId
      ? await resolveActorId(pool, assignedByUserId, prefersVacancy)
      : null;

    const insertNotification = async (assignedToResolved) => {
      if (!assignedToResolved || !assignedByResolved || !notifToCol || !notifByCol) return;
      try {
        await pool.request()
          .input('TaskID',          sql.Int,     originalSubtask.TaskID)
          .input('AssignedToActor', sql.NVarChar, assignedToResolved)
          .input('AssignedByActor', sql.NVarChar, assignedByResolved)
          .query(`INSERT INTO TaskAssignmentNotifications (TaskID, ${notifToCol}, ${notifByCol}) VALUES (@TaskID, @AssignedToActor, @AssignedByActor)`);
      } catch (_) { /* الإشعارات غير حرجة */ }
    };

    const firstUserId  = assignedToUserIds[0];
    const otherUserIds = assignedToUserIds.slice(1);

    // 2. إسناد المهمة الأصلية للمستخدم الأول
    const firstResolved = await resolveActorId(pool, firstUserId, prefersVacancy);
    await pool.request()
      .input('SubtaskID',       sql.Int,     subtaskId)
      .input('AssignedToActor', sql.NVarChar, firstResolved)
      .query(`UPDATE Subtasks SET ${assignedToCol} = @AssignedToActor WHERE SubtaskID = @SubtaskID`);
    await insertNotification(firstResolved);

    // 3. إنشاء نسخ للمستخدمين الآخرين (نفس أسلوب createSubtask)
    const originalCreatedBy = schema.HasCreatedByVacancy
      ? String(originalSubtask.CreatedByVacancyID ?? '').trim()
      : String(originalSubtask.CreatedBy ?? '').trim();

    for (const userId of otherUserIds) {
      const userResolved = await resolveActorId(pool, userId, prefersVacancy);
      if (!userResolved) continue;

      const insertCols = ['TaskID', 'Title', createdByCol, assignedToCol, 'IsCompleted', 'CreatedAt'];
      const insertVals = ['@cp_TaskID', '@cp_Title', '@cp_CreatedBy', '@cp_AssignedTo', '0', 'GETDATE()'];

      const copyReq = pool.request()
        .input('cp_TaskID',     sql.Int,     originalSubtask.TaskID)
        .input('cp_Title',      sql.NVarChar, originalSubtask.Title)  // مشفَّر بالفعل
        .input('cp_CreatedBy',  sql.NVarChar, originalCreatedBy)
        .input('cp_AssignedTo', sql.NVarChar, userResolved);

      if (schema.HasActedBy) {
        copyReq.input('cp_ActedBy', sql.NVarChar, originalSubtask.ActedBy || null);
        insertCols.push('ActedBy'); insertVals.push('@cp_ActedBy');
      }
      if (schema.HasLastActedByVacancy && originalSubtask.LastActedByVacancyID != null) {
        copyReq.input('cp_LastActedBy', sql.NVarChar, String(originalSubtask.LastActedByVacancyID));
        insertCols.push('LastActedByVacancyID'); insertVals.push('@cp_LastActedBy');
      }
      if (originalSubtask.DueDate) {
        copyReq.input('cp_DueDate', sql.Date, originalSubtask.DueDate);
        insertCols.push('DueDate'); insertVals.push('@cp_DueDate');
      }
      if (schema.HasEndDate && originalSubtask.EndDate) {
        copyReq.input('cp_EndDate', sql.Date, originalSubtask.EndDate);
        insertCols.push('EndDate'); insertVals.push('@cp_EndDate');
      }
      if (schema.HasShowInCalendar) {
        copyReq.input('cp_ShowInCalendar', sql.Bit, originalSubtask.ShowInCalendar || 0);
        insertCols.push('ShowInCalendar'); insertVals.push('@cp_ShowInCalendar');
      }

      await copyReq.query(`INSERT INTO Subtasks (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`);
      await insertNotification(userResolved);
    }

    res.status(200).json({ message: 'Subtasks assigned/duplicated successfully' });

  } catch (error) {
    console.error('Error in bulk assignment:', error);
    res.status(500).send({ message: 'Error in bulk assignment', detail: error.message });
  }
};

exports.deleteSubtask = async (req, res) => {
    const pool = req.app.locals.db;
    const { subtaskId } = req.params;
    try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy
    `);
    const schema = schemaProbe.recordset[0] || {};

    const subtaskResult = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query(`
        SELECT TOP 1
          TaskID,
          ${schema.HasCreatedByUser ? 'CreatedBy' : 'CAST(NULL AS NVARCHAR(255)) AS CreatedBy'},
          ${schema.HasCreatedByVacancy ? 'CreatedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS CreatedByVacancyID'},
          ${schema.HasActedBy ? 'ActedBy' : 'CAST(NULL AS NVARCHAR(255)) AS ActedBy'},
          ${schema.HasLastActedByVacancy ? 'LastActedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS LastActedByVacancyID'}
        FROM Subtasks
        WHERE SubtaskID = @SubtaskID
      `);

    if (!subtaskResult.recordset.length) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    const actingUserId = resolveActingUserId(req);
    const existing = subtaskResult.recordset[0];
    const accessCheck = await checkTaskAccess(pool, existing.TaskID, actingUserId, resolveIsAdmin(req), 'edit');
    if (!accessCheck.hasAccess) {
      const actorCandidates = await resolveActorCandidates(pool, actingUserId);
      if (!hasSubtaskOwnership(existing, actorCandidates)) {
        return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية حذف المهمة الفرعية.' });
      }
    }

        await pool.request()
            .input('SubtaskID', sql.Int, subtaskId)
            .query('DELETE FROM Subtasks WHERE SubtaskID = @SubtaskID');
        res.status(200).json({ message: 'Subtask deleted successfully' });
    } catch (error) {
        res.status(500).send({ message: 'Error deleting subtask' });
    }
};

// تحديث نص المهمة الفرعية وتاريخ الاستحقاق
exports.updateSubtaskDetails = async (req, res) => {
  const pool = req.app.locals.db;
  const { subtaskId } = req.params;
  const { Title, DueDate, EndDate } = req.body;

  if (typeof Title === 'undefined' && typeof DueDate === 'undefined' && typeof EndDate === 'undefined') {
    return res.status(400).json({ message: 'Provide Title and/or DueDate and/or EndDate to update.' });
  }

  try {
    const schemaProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByVacancy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'CreatedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasCreatedByUser,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'ActedBy') IS NOT NULL THEN 1 ELSE 0 END AS HasActedBy,
        CASE WHEN COL_LENGTH('dbo.Subtasks', 'LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasLastActedByVacancy
    `);
    const schema = schemaProbe.recordset[0] || {};

    const subtaskResult = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query(`
        SELECT TOP 1
          TaskID,
          ${schema.HasCreatedByUser ? 'CreatedBy' : 'CAST(NULL AS NVARCHAR(255)) AS CreatedBy'},
          ${schema.HasCreatedByVacancy ? 'CreatedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS CreatedByVacancyID'},
          ${schema.HasActedBy ? 'ActedBy' : 'CAST(NULL AS NVARCHAR(255)) AS ActedBy'},
          ${schema.HasLastActedByVacancy ? 'LastActedByVacancyID' : 'CAST(NULL AS NVARCHAR(255)) AS LastActedByVacancyID'}
        FROM Subtasks
        WHERE SubtaskID = @SubtaskID
      `);

    if (!subtaskResult.recordset.length) {
      return res.status(404).json({ message: 'Subtask not found' });
    }

    const actingUserId = resolveActingUserId(req);
    const existing = subtaskResult.recordset[0];
    const accessCheck = await checkTaskAccess(pool, existing.TaskID, actingUserId, resolveIsAdmin(req), 'edit');
    if (!accessCheck.hasAccess) {
      const actorCandidates = await resolveActorCandidates(pool, actingUserId);
      if (!hasSubtaskOwnership(existing, actorCandidates)) {
        return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية تعديل بيانات المهمة الفرعية.' });
      }
    }

    // تجهيز القيم
    const hasTitle = typeof Title !== 'undefined';
    const hasDue = typeof DueDate !== 'undefined';
    const hasEnd = typeof EndDate !== 'undefined';
    const encryptedTitle = hasTitle ? encryptionConfig.encrypt(Title) : null;
    let dueDateNormalized = null;
    if (hasDue && DueDate) {
      const d = new Date(DueDate);
      dueDateNormalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    let endDateNormalized = null;
    if (hasEnd && EndDate) {
      const d = new Date(EndDate);
      endDateNormalized = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .input('HasTitle', sql.Bit, hasTitle ? 1 : 0)
      .input('Title', sql.NVarChar, encryptedTitle)
      .input('HasDue', sql.Bit, hasDue ? 1 : 0)
      .input('DueDate', sql.Date, dueDateNormalized)
      .input('HasEnd', sql.Bit, hasEnd ? 1 : 0)
      .input('EndDate', sql.Date, endDateNormalized)
      .query(`
        UPDATE Subtasks
        SET
          Title = CASE WHEN @HasTitle = 1 THEN @Title ELSE Title END,
          DueDate = CASE WHEN @HasDue = 1 THEN @DueDate ELSE DueDate END
        WHERE SubtaskID = @SubtaskID;

        IF COL_LENGTH('dbo.Subtasks','EndDate') IS NOT NULL AND @HasEnd = 1
          UPDATE Subtasks SET EndDate = @EndDate WHERE SubtaskID = @SubtaskID;
      `);

    const result = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query('SELECT TOP(1) * FROM Subtasks WHERE SubtaskID = @SubtaskID');
    const updated = result.recordset[0];
    if (!updated) {
      return res.status(404).json({ message: 'Subtask not found' });
    }
    if (updated.Title) {
      try { updated.Title = encryptionConfig.decrypt(updated.Title); } catch (_) {}
    }
    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating subtask details:', error);
    return res.status(500).json({ message: 'Error updating subtask details' });
  }
};

// تحديث علم إظهار المهمة الفرعية في التقويم
exports.updateSubtaskCalendarFlag = async (req, res) => {
  const pool = req.app.locals.db;
  const { subtaskId } = req.params;
  const { ShowInCalendar } = req.body;

  if (!subtaskId) {
    return res.status(400).json({ message: 'subtaskId is required.' });
  }
  if (typeof ShowInCalendar === 'undefined') {
    return res.status(400).json({ message: 'ShowInCalendar field is required.' });
  }

  try {
    // التأكد من وجود المهمة الفرعية
    const check = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query('SELECT TOP(1) * FROM Subtasks WHERE SubtaskID = @SubtaskID');

    if (check.recordset.length === 0) {
      return res.status(404).json({ message: 'Subtask not found.' });
    }

    const accessCheck = await checkTaskAccess(pool, check.recordset[0].TaskID, resolveActingUserId(req), resolveIsAdmin(req), 'edit');
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية تعديل عرض المهمة الفرعية في التقويم.' });
    }

    // تحديث العلم
    await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .input('ShowInCalendar', sql.Bit, ShowInCalendar ? 1 : 0)
      .query('UPDATE Subtasks SET ShowInCalendar = @ShowInCalendar WHERE SubtaskID = @SubtaskID');

    // إعادة إرجاع السجل المحدث
    const result = await pool.request()
      .input('SubtaskID', sql.Int, subtaskId)
      .query('SELECT TOP(1) * FROM Subtasks WHERE SubtaskID = @SubtaskID');

    const updated = result.recordset[0];
    if (updated && updated.Title) {
      try { updated.Title = encryptionConfig.decrypt(updated.Title); } catch (_) {}
    }
    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error updating subtask calendar flag:', error);
    return res.status(500).json({ message: 'Error updating subtask calendar flag.' });
  }
};
