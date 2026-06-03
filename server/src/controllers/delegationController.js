// src/controllers/delegationController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { detectSchema, resolveVacancyId } = require('../utils/vacancyResolver');

// قراءة معرف المستخدم من الهيدر أو البودي
function getCurrentUserId(req) {
  return (req.headers['user-id'] || req.body?.UserID || req.query?.userId || '').toString();
}

// في المخطط الجديد الأعمدة أصبحت DelegatorVacancyID / DelegateVacancyID (int)
// وفي المخطط القديم DelegatorUserID / DelegateUserID (nvarchar).
// هذه الدالة المساعدة تُرجِع الأسماء الصحيحة + نوع الحجة + القيمة المحوَّلة.
async function getDelegationColumns(pool) {
  const schema = await detectSchema(pool);
  if (schema.hasDelegationVacancy) {
    return {
      isVacancy: true,
      delegatorCol: 'DelegatorVacancyID',
      delegateCol: 'DelegateVacancyID',
      sqlType: sql.Int,
      createdByType: sql.Int,
      identityTable: 'JobVacancies',
      identityKey: 'VacancyID',
      identityName: 'Name',
    };
  }
  return {
    isVacancy: false,
    delegatorCol: 'DelegatorUserID',
    delegateCol: 'DelegateUserID',
    sqlType: sql.NVarChar,
    createdByType: sql.NVarChar,
    identityTable: 'Users',
    identityKey: 'UserID',
    identityName: 'FullName',
  };
}

// يحوّل UserID إلى القيمة الصحيحة حسب المخطط (int VacancyID أو UserID نصّي)
async function toDelegationPrincipal(pool, userId, cols) {
  if (!cols.isVacancy) return userId;
  const vid = await resolveVacancyId(pool, userId);
  return vid;
}

// جلب التفويضات الخاصة بالمفوض (المستخدم الحالي)
exports.getDelegations = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const cols = await getDelegationColumns(pool);
    const delegatorPrincipal = await toDelegationPrincipal(pool, currentUserId, cols);
    if (cols.isVacancy && delegatorPrincipal == null) {
      return res.status(200).json([]);
    }

    const result = await pool.request()
      .input('Delegator', cols.sqlType, delegatorPrincipal)
      .query(`
        SELECT td.DelegationID,
               td.${cols.delegatorCol} AS DelegatorID,
               du.${cols.identityName} AS DelegatorName,
               td.${cols.delegateCol} AS DelegateID,
               uu.${cols.identityName} AS DelegateName,
               td.StartDate,
               td.EndDate,
               td.IsActive,
               td.CreatedAt
        FROM TaskDelegations td
        INNER JOIN ${cols.identityTable} du ON td.${cols.delegatorCol} = du.${cols.identityKey}
        INNER JOIN ${cols.identityTable} uu ON td.${cols.delegateCol} = uu.${cols.identityKey}
        WHERE td.${cols.delegatorCol} = @Delegator
        ORDER BY td.CreatedAt DESC
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('GET DELEGATIONS ERROR:', err);
    res.status(500).json({ message: 'Error fetching delegations' });
  }
};

// جلب التفويضات حيث المستخدم الحالي مفوَّض إليه
exports.getDelegationsAsDelegate = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const cols = await getDelegationColumns(pool);
    const delegatePrincipal = await toDelegationPrincipal(pool, currentUserId, cols);
    if (cols.isVacancy && delegatePrincipal == null) {
      return res.status(200).json([]);
    }

    const result = await pool.request()
      .input('Delegate', cols.sqlType, delegatePrincipal)
      .query(`
        SELECT td.DelegationID,
               td.${cols.delegatorCol} AS DelegatorID,
               du.${cols.identityName} AS DelegatorName,
               td.${cols.delegateCol} AS DelegateID,
               uu.${cols.identityName} AS DelegateName,
               td.StartDate,
               td.EndDate,
               td.IsActive,
               td.CreatedAt
        FROM TaskDelegations td
        INNER JOIN ${cols.identityTable} du ON td.${cols.delegatorCol} = du.${cols.identityKey}
        INNER JOIN ${cols.identityTable} uu ON td.${cols.delegateCol} = uu.${cols.identityKey}
        WHERE td.${cols.delegateCol} = @Delegate
        ORDER BY td.CreatedAt DESC
      `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('GET DELEGATIONS AS DELEGATE ERROR:', err);
    res.status(500).json({ message: 'Error fetching delegations as delegate' });
  }
};

// إنشاء تفويض جديد
exports.createDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req); // المفوض
  const { DelegateID, StartDate, EndDate, DelegationType = 'full', Reason = null } = req.body || {};

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });
  if (!DelegateID || !StartDate) return res.status(400).json({ message: 'DelegateID and StartDate are required.' });
  if (String(DelegateID) === String(currentUserId)) return res.status(400).json({ message: 'لا يمكن التفويض لنفس المستخدم.' });

  try {
    const cols = await getDelegationColumns(pool);

    // التحقق من صحة التواريخ
    const start = new Date(StartDate);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ message: 'تاريخ البداية غير صالح.' });
    }
    let end = null;
    if (EndDate) {
      const parsedEnd = new Date(EndDate);
      if (isNaN(parsedEnd.getTime())) {
        return res.status(400).json({ message: 'تاريخ النهاية غير صالح.' });
      }
      end = parsedEnd;
      if (end < start) {
        return res.status(400).json({ message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.' });
      }
    }

    let delegatorPrincipal, delegatePrincipal;

    if (cols.isVacancy) {
      // المخطط الجديد: DelegateID القادم من الواجهة هو VacancyID مباشرةً
      // (لأن listByDepartmentScope يُعيد CAST(VacancyID AS NVARCHAR) في حقل UserID)

      // التحقق من وجود المفوِّض في Users
      const delegatorCheck = await pool.request()
        .input('UID', sql.NVarChar, currentUserId)
        .query(`SELECT UserID FROM dbo.Users WHERE UserID = @UID`);
      if (!delegatorCheck.recordset.length)
        return res.status(400).json({ message: 'المفوض غير موجود في قاعدة البيانات.' });

      // تحويل UserID المفوِّض → VacancyID عبر Assignments
      delegatorPrincipal = await resolveVacancyId(pool, currentUserId);
      if (delegatorPrincipal == null)
        return res.status(400).json({ message: 'تعذّر تحديد منصبك. تأكد من وجود إسناد نشط لك.' });

      // DelegateID هو VacancyID — تحقق من وجوده في JobVacancies
      const delegateVid = parseInt(DelegateID, 10);
      if (isNaN(delegateVid))
        return res.status(400).json({ message: 'معرّف المفوَّض إليه غير صالح.' });
      const vacCheck = await pool.request()
        .input('VID', sql.Int, delegateVid)
        .query(`SELECT TOP 1 VacancyID FROM dbo.JobVacancies WHERE VacancyID = @VID`);
      if (!vacCheck.recordset.length)
        return res.status(400).json({ message: 'المفوَّض إليه غير موجود في قاعدة البيانات.' });

      delegatePrincipal = delegateVid;

      // لا تفويض لنفس المنصب
      if (delegatorPrincipal === delegatePrincipal)
        return res.status(400).json({ message: 'لا يمكن التفويض لنفس المنصب.' });

    } else {
      // المخطط القديم: كلا الطرفين بـ UserID
      const usersCheck = await pool.request()
        .input('DelegatorUserID', sql.NVarChar, currentUserId)
        .input('DelegateUserID', sql.NVarChar, DelegateID)
        .query(`SELECT UserID FROM dbo.Users WHERE UserID IN (@DelegatorUserID, @DelegateUserID)`);
      const foundIds = new Set(usersCheck.recordset.map(r => String(r.UserID).trim()));
      if (!foundIds.has(String(currentUserId).trim()))
        return res.status(400).json({ message: 'المفوض غير موجود في قاعدة البيانات.' });
      if (!foundIds.has(String(DelegateID).trim()))
        return res.status(400).json({ message: 'المفوَّض إليه غير موجود في قاعدة البيانات.' });
      delegatorPrincipal = currentUserId;
      delegatePrincipal  = DelegateID;
    }

    // CreatedBy في المخطط الجديد int، في القديم nvarchar
    const createdByValue = cols.isVacancy ? delegatorPrincipal : currentUserId;

    const insertResult = await pool.request()
      .input('Delegator', cols.sqlType, delegatorPrincipal)
      .input('Delegate', cols.sqlType, delegatePrincipal)
      .input('DelegationType', sql.NVarChar, DelegationType)
      .input('StartDate', sql.DateTime, start)
      .input('EndDate', sql.DateTime, end)
      .input('IsActive', sql.Bit, 1)
      .input('Reason', sql.NVarChar, Reason)
      .input('CreatedBy', cols.createdByType, createdByValue)
      .query(`
        INSERT INTO TaskDelegations (${cols.delegatorCol}, ${cols.delegateCol}, DelegationType, StartDate, EndDate, IsActive, Reason, CreatedBy)
        VALUES (@Delegator, @Delegate, @DelegationType, @StartDate, @EndDate, @IsActive, @Reason, @CreatedBy);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS DelegationID;
      `);

    const newId = insertResult?.recordset?.[0]?.DelegationID || null;
    res.status(201).json({ DelegationID: newId, message: 'Delegation created successfully' });
  } catch (err) {
    console.error('CREATE DELEGATION ERROR:', err);
    res.status(500).json({ message: 'Error creating delegation', details: err?.message });
  }
};

// تحديث تفويض
exports.updateDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  const { id } = req.params;
  const { StartDate, EndDate, IsActive, DelegationType, Reason } = req.body || {};

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const cols = await getDelegationColumns(pool);
    const delegatorPrincipal = await toDelegationPrincipal(pool, currentUserId, cols);

    // تحقق أن المستخدم الحالي هو المفوِّض لهذا التفويض
    const check = await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`SELECT ${cols.delegatorCol} AS DelegatorID FROM TaskDelegations WHERE DelegationID = @DelegationID`);
    if (!check.recordset.length) return res.status(404).json({ message: 'Delegation not found' });

    const ownerId = check.recordset[0].DelegatorID;
    const isOwner = cols.isVacancy
      ? parseInt(ownerId, 10) === parseInt(delegatorPrincipal, 10)
      : String(ownerId).trim() === String(currentUserId).trim();
    if (!isOwner) {
      return res.status(403).json({ message: 'لا تملك صلاحية تعديل هذا التفويض' });
    }

    const request = pool.request()
      .input('DelegationID', sql.Int, parseInt(id));
    let setParts = [];

    if (StartDate) {
      request.input('StartDate', sql.DateTime, new Date(StartDate));
      setParts.push('StartDate = @StartDate');
    }
    if (EndDate !== undefined) {
      request.input('EndDate', sql.DateTime, EndDate ? new Date(EndDate) : null);
      setParts.push('EndDate = @EndDate');
    }
    if (typeof IsActive === 'boolean') {
      request.input('IsActive', sql.Bit, IsActive ? 1 : 0);
      setParts.push('IsActive = @IsActive');
    }
    if (DelegationType) {
      request.input('DelegationType', sql.NVarChar, DelegationType);
      setParts.push('DelegationType = @DelegationType');
    }
    if (Reason !== undefined) {
      request.input('Reason', sql.NVarChar, Reason || null);
      setParts.push('Reason = @Reason');
    }

    if (setParts.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const updateSql = `UPDATE TaskDelegations SET ${setParts.join(', ')}, UpdatedAt = GETDATE() WHERE DelegationID = @DelegationID`;
    await request.query(updateSql);

    res.status(200).json({ message: 'Delegation updated successfully' });
  } catch (err) {
    console.error('UPDATE DELEGATION ERROR:', err);
    res.status(500).json({ message: 'Error updating delegation' });
  }
};

// حذف تفويض
exports.deleteDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  const { id } = req.params;

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const cols = await getDelegationColumns(pool);
    const delegatorPrincipal = await toDelegationPrincipal(pool, currentUserId, cols);

    const check = await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`SELECT ${cols.delegatorCol} AS DelegatorID FROM TaskDelegations WHERE DelegationID = @DelegationID`);
    if (!check.recordset.length) return res.status(404).json({ message: 'Delegation not found' });

    const ownerId = check.recordset[0].DelegatorID;
    const isOwner = cols.isVacancy
      ? parseInt(ownerId, 10) === parseInt(delegatorPrincipal, 10)
      : String(ownerId).trim() === String(currentUserId).trim();
    if (!isOwner) {
      return res.status(403).json({ message: 'لا تملك صلاحية حذف هذا التفويض' });
    }

    await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`DELETE FROM TaskDelegations WHERE DelegationID = @DelegationID`);

    res.status(200).json({ message: 'Delegation deleted successfully' });
  } catch (err) {
    console.error('DELETE DELEGATION ERROR:', err);
    res.status(500).json({ message: 'Error deleting delegation' });
  }
};

// تحديث أو حذف الرمز السري الخاص بالتفويض للمستخدم الحالي (يبقى على Users.UserID — لا يتأثر)
exports.updateDelegationSecret = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  const { DelegationPassword } = req.body || {};

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const request = pool.request()
      .input('UserID', sql.NVarChar, currentUserId)
      .input('DelegationPasswordHash', sql.NVarChar, DelegationPassword || null);
    await request.query(`UPDATE Users SET DelegationPasswordHash = @DelegationPasswordHash WHERE UserID = @UserID`);
    res.status(200).json({ message: DelegationPassword ? 'Delegation secret updated' : 'Delegation secret cleared' });
  } catch (err) {
    console.error('UPDATE DELEGATION SECRET ERROR:', err);
    res.status(500).json({ message: 'Error updating delegation secret' });
  }
};

// جلب الرمز السري المخزَّن للمستخدم الحالي من جدول المستخدمين
exports.getDelegationSecret = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const result = await pool.request()
      .input('UserID', sql.NVarChar, currentUserId)
      .query(`SELECT DelegationPasswordHash FROM Users WHERE UserID = @UserID`);
    if (!result.recordset.length) {
      return res.status(404).json({ message: 'User not found' });
    }
    const secret = result.recordset[0].DelegationPasswordHash || null;
    res.status(200).json({ DelegationPasswordHash: secret });
  } catch (err) {
    console.error('GET DELEGATION SECRET ERROR:', err);
    res.status(500).json({ message: 'Error fetching delegation secret' });
  }
};

// تحديث الرمز السري لتفويض محدد (حسب DelegationID)
exports.updateDelegationSecretForDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  const { id } = req.params;
  const { DelegationPassword } = req.body || {};

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const cols = await getDelegationColumns(pool);
    const delegatorPrincipal = await toDelegationPrincipal(pool, currentUserId, cols);

    const check = await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`SELECT ${cols.delegatorCol} AS DelegatorID FROM TaskDelegations WHERE DelegationID = @DelegationID`);
    if (!check.recordset.length) return res.status(404).json({ message: 'Delegation not found' });

    const ownerId = check.recordset[0].DelegatorID;
    const isOwner = cols.isVacancy
      ? parseInt(ownerId, 10) === parseInt(delegatorPrincipal, 10)
      : String(ownerId).trim() === String(currentUserId).trim();
    if (!isOwner) {
      return res.status(403).json({ message: 'لا تملك صلاحية تحديث سر هذا التفويض' });
    }

    const combined = DelegationPassword ? encryptionConfig.hashPassword(DelegationPassword).combined : null;

    await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .input('DelegationSecretHash', sql.NVarChar, combined)
      .query(`UPDATE TaskDelegations SET DelegationSecretHash = @DelegationSecretHash WHERE DelegationID = @DelegationID`);

    res.status(200).json({ message: DelegationPassword ? 'Delegation secret updated for delegation' : 'Delegation secret cleared for delegation' });
  } catch (err) {
    console.error('UPDATE DELEGATION SECRET (BY DELEGATION) ERROR:', err);
    res.status(500).json({ message: 'Error updating delegation secret for delegation' });
  }
};

// جلب حالة/القيمة الحالية لسر تفويض محدد (حسب DelegationID)
exports.getDelegationSecretForDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  const currentUserId = getCurrentUserId(req);
  const { id } = req.params;

  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
  if (!currentUserId) return res.status(400).json({ message: 'user-id header is required.' });

  try {
    const cols = await getDelegationColumns(pool);
    const delegatorPrincipal = await toDelegationPrincipal(pool, currentUserId, cols);

    const check = await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`SELECT ${cols.delegatorCol} AS DelegatorID, DelegationSecretHash FROM TaskDelegations WHERE DelegationID = @DelegationID`);
    if (!check.recordset.length) return res.status(404).json({ message: 'Delegation not found' });

    const ownerId = check.recordset[0].DelegatorID;
    const isOwner = cols.isVacancy
      ? parseInt(ownerId, 10) === parseInt(delegatorPrincipal, 10)
      : String(ownerId).trim() === String(currentUserId).trim();
    if (!isOwner) {
      return res.status(403).json({ message: 'لا تملك صلاحية قراءة سر هذا التفويض' });
    }

    const secret = check.recordset[0].DelegationSecretHash || null;
    res.status(200).json({ DelegationSecretHash: secret, isSet: !!secret });
  } catch (err) {
    console.error('GET DELEGATION SECRET (BY DELEGATION) ERROR:', err);
    res.status(500).json({ message: 'Error fetching delegation secret for delegation' });
  }
};

// ── المناصب الشاغرة ──────────────────────────────────────────────────────────

// جلب المناصب الشاغرة ضمن نطاق القسم (للاختيار عند التكليف)
exports.listVacantPositions = async (req, res) => {
  const pool = req.app.locals.db;
  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });

  const deptId = req.query.departmentId ? parseInt(req.query.departmentId, 10) : null;

  try {
    const probe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Assignments','IsCurrent')            IS NOT NULL THEN 1 ELSE 0 END AS HasIsCurrent,
        CASE WHEN COL_LENGTH('dbo.Departments','ParentDepartmentID')   IS NOT NULL THEN 1 ELSE 0 END AS HasParentDeptID,
        CASE WHEN COL_LENGTH('dbo.Departments','ParentID')             IS NOT NULL THEN 1 ELSE 0 END AS HasParentID
    `);
    const p = probe.recordset[0] || {};
    const isCurrentFilter = p.HasIsCurrent ? 'AND a.IsCurrent = 1' : '';
    const parentCol = p.HasParentDeptID ? 'ParentDepartmentID' : (p.HasParentID ? 'ParentID' : null);

    const request = pool.request();
    let query;

    if (deptId && parentCol) {
      request.input('DeptID', sql.Int, deptId);
      query = `
        WITH DeptTree AS (
          SELECT DepartmentID FROM dbo.Departments WHERE DepartmentID = @DeptID
          UNION ALL
          SELECT d.DepartmentID FROM dbo.Departments d
          INNER JOIN DeptTree t ON d.${parentCol} = t.DepartmentID
        )
        SELECT jv.VacancyID, jv.Name AS VacancyName, dept.Name AS DepartmentName
        FROM dbo.JobVacancies jv
        JOIN DeptTree dt ON jv.DepartmentID = dt.DepartmentID
        LEFT JOIN dbo.Assignments a ON a.VacancyID = jv.VacancyID ${isCurrentFilter}
        LEFT JOIN dbo.Departments dept ON dept.DepartmentID = jv.DepartmentID
        WHERE a.AssignmentID IS NULL
        ORDER BY dept.Name, jv.Name
      `;
    } else if (deptId) {
      request.input('DeptID', sql.Int, deptId);
      query = `
        SELECT jv.VacancyID, jv.Name AS VacancyName, dept.Name AS DepartmentName
        FROM dbo.JobVacancies jv
        LEFT JOIN dbo.Assignments a ON a.VacancyID = jv.VacancyID ${isCurrentFilter}
        LEFT JOIN dbo.Departments dept ON dept.DepartmentID = jv.DepartmentID
        WHERE a.AssignmentID IS NULL AND jv.DepartmentID = @DeptID
        ORDER BY jv.Name
      `;
    } else {
      query = `
        SELECT jv.VacancyID, jv.Name AS VacancyName, dept.Name AS DepartmentName
        FROM dbo.JobVacancies jv
        LEFT JOIN dbo.Assignments a ON a.VacancyID = jv.VacancyID ${isCurrentFilter}
        LEFT JOIN dbo.Departments dept ON dept.DepartmentID = jv.DepartmentID
        WHERE a.AssignmentID IS NULL
        ORDER BY dept.Name, jv.Name
      `;
    }

    const result = await request.query(query);
    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('LIST VACANT POSITIONS ERROR:', err);
    res.status(500).json({ message: 'Error listing vacant positions' });
  }
};

// إنشاء تكليف لمنصب شاغر (بواسطة المدير أو مدير النظام)
exports.createVacantPositionDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });

  const { vacancyId, delegateUserId, startDate, endDate } = req.body || {};
  if (!vacancyId || !delegateUserId || !startDate)
    return res.status(400).json({ message: 'vacancyId و delegateUserId و startDate مطلوبة.' });

  try {
    const cols = await getDelegationColumns(pool);

    // تحقق من وجود المنصب
    const vacCheck = await pool.request()
      .input('VID', sql.Int, parseInt(vacancyId))
      .query(`SELECT TOP 1 VacancyID FROM dbo.JobVacancies WHERE VacancyID = @VID`);
    if (!vacCheck.recordset.length)
      return res.status(404).json({ message: 'المنصب غير موجود.' });

    // التحقق من التواريخ
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return res.status(400).json({ message: 'تاريخ البداية غير صالح.' });
    let end = null;
    if (endDate) {
      end = new Date(endDate);
      if (isNaN(end.getTime())) return res.status(400).json({ message: 'تاريخ النهاية غير صالح.' });
      if (end < start) return res.status(400).json({ message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.' });
    }

    // تحديد معرّف المفوَّض إليه
    let delegatePrincipal;
    if (cols.isVacancy) {
      delegatePrincipal = await resolveVacancyId(pool, delegateUserId);
      if (delegatePrincipal == null)
        return res.status(400).json({ message: 'تعذّر تحديد منصب الموظف المكلَّف. تأكد من وجود إسناد نشط له.' });
    } else {
      delegatePrincipal = delegateUserId;
    }

    const delegatorPrincipal = cols.isVacancy ? parseInt(vacancyId) : String(vacancyId);

    const insertResult = await pool.request()
      .input('Delegator', cols.sqlType, delegatorPrincipal)
      .input('Delegate', cols.sqlType, delegatePrincipal)
      .input('StartDate', sql.DateTime, start)
      .input('EndDate', sql.DateTime, end)
      .input('CreatedBy', cols.createdByType, delegatorPrincipal)
      .query(`
        INSERT INTO dbo.TaskDelegations
          (${cols.delegatorCol}, ${cols.delegateCol}, DelegationType, StartDate, EndDate, IsActive, CreatedBy)
        VALUES (@Delegator, @Delegate, 'full', @StartDate, @EndDate, 1, @CreatedBy);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS DelegationID;
      `);

    const newId = insertResult?.recordset?.[0]?.DelegationID || null;
    res.status(201).json({ DelegationID: newId, message: 'تم إنشاء التكليف بنجاح' });
  } catch (err) {
    console.error('CREATE VACANT POSITION DELEGATION ERROR:', err);
    res.status(500).json({ message: 'Error creating vacant position delegation', detail: err.message });
  }
};

// حذف تكليف منصب شاغر (بواسطة المدير أو مدير النظام — لا يشترط أن يكون المستخدم هو المفوِّض)
exports.deleteVacantPositionDelegation = async (req, res) => {
  const pool = req.app.locals.db;
  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });

  const { id } = req.params;
  try {
    const check = await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`SELECT DelegationID FROM dbo.TaskDelegations WHERE DelegationID = @DelegationID`);
    if (!check.recordset.length)
      return res.status(404).json({ message: 'التكليف غير موجود.' });

    await pool.request()
      .input('DelegationID', sql.Int, parseInt(id))
      .query(`DELETE FROM dbo.TaskDelegations WHERE DelegationID = @DelegationID`);

    res.status(200).json({ message: 'تم حذف التكليف بنجاح.' });
  } catch (err) {
    console.error('DELETE VACANT POSITION DELEGATION ERROR:', err);
    res.status(500).json({ message: 'Error deleting vacant position delegation' });
  }
};

// جلب تكليفات المناصب الشاغرة (ضمن نطاق القسم)
exports.listVacantPositionDelegations = async (req, res) => {
  const pool = req.app.locals.db;
  if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });

  const deptId = req.query.departmentId ? parseInt(req.query.departmentId, 10) : null;

  try {
    const cols = await getDelegationColumns(pool);
    if (!cols.isVacancy) return res.status(200).json([]); // مخطط قديم — غير مدعوم

    const probe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Assignments','IsCurrent')          IS NOT NULL THEN 1 ELSE 0 END AS HasIsCurrent,
        CASE WHEN COL_LENGTH('dbo.Departments','ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDeptID,
        CASE WHEN COL_LENGTH('dbo.Departments','ParentID')           IS NOT NULL THEN 1 ELSE 0 END AS HasParentID
    `);
    const p = probe.recordset[0] || {};
    const isCurrentFilter = p.HasIsCurrent ? 'AND a.IsCurrent = 1' : '';
    const parentCol = p.HasParentDeptID ? 'ParentDepartmentID' : (p.HasParentID ? 'ParentID' : null);

    const request = pool.request();
    let query;

    const selectCols = `
      td.DelegationID,
      td.DelegatorVacancyID AS DelegatorPositionID,
      jvSrc.Name AS DelegatorPositionName,
      deptSrc.Name AS DepartmentName,
      td.DelegateVacancyID AS DelegatePositionID,
      jvDst.Name AS DelegateName,
      td.StartDate, td.EndDate, td.IsActive, td.CreatedAt
    `;

    const joins = `
      FROM dbo.TaskDelegations td
      JOIN dbo.JobVacancies jvSrc ON jvSrc.VacancyID = td.DelegatorVacancyID
      LEFT JOIN dbo.Assignments a ON a.VacancyID = td.DelegatorVacancyID ${isCurrentFilter}
      LEFT JOIN dbo.Departments deptSrc ON deptSrc.DepartmentID = jvSrc.DepartmentID
      JOIN dbo.JobVacancies jvDst ON jvDst.VacancyID = td.DelegateVacancyID
    `;

    if (deptId && parentCol) {
      request.input('DeptID', sql.Int, deptId);
      query = `
        WITH DeptTree AS (
          SELECT DepartmentID FROM dbo.Departments WHERE DepartmentID = @DeptID
          UNION ALL
          SELECT d.DepartmentID FROM dbo.Departments d
          INNER JOIN DeptTree t ON d.${parentCol} = t.DepartmentID
        )
        SELECT ${selectCols}
        ${joins}
        JOIN DeptTree dt ON jvSrc.DepartmentID = dt.DepartmentID
        WHERE a.AssignmentID IS NULL
        ORDER BY td.CreatedAt DESC
      `;
    } else if (deptId) {
      request.input('DeptID', sql.Int, deptId);
      query = `
        SELECT ${selectCols} ${joins}
        WHERE a.AssignmentID IS NULL AND jvSrc.DepartmentID = @DeptID
        ORDER BY td.CreatedAt DESC
      `;
    } else {
      query = `
        SELECT ${selectCols} ${joins}
        WHERE a.AssignmentID IS NULL
        ORDER BY td.CreatedAt DESC
      `;
    }

    const result = await request.query(query);
    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('LIST VACANT POSITION DELEGATIONS ERROR:', err);
    res.status(500).json({ message: 'Error listing vacant position delegations' });
  }
};
