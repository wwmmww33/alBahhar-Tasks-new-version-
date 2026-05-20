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

    // تحقق من أن المستخدمين موجودون (بـ UserID حتى قبل أي تحويل)
    const usersCheck = await pool.request()
      .input('DelegatorUserID', sql.NVarChar, currentUserId)
      .input('DelegateUserID', sql.NVarChar, DelegateID)
      .query(`SELECT UserID FROM Users WHERE UserID IN (@DelegatorUserID, @DelegateUserID)`);
    const foundIds = new Set(usersCheck.recordset.map(r => String(r.UserID).trim()));
    if (!foundIds.has(String(currentUserId).trim())) {
      return res.status(400).json({ message: 'المفوض غير موجود في قاعدة البيانات.' });
    }
    if (!foundIds.has(String(DelegateID).trim())) {
      return res.status(400).json({ message: 'المفوَّض إليه غير موجود في قاعدة البيانات.' });
    }

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

    // تحويل إلى VacancyID إن لزم
    const delegatorPrincipal = await toDelegationPrincipal(pool, currentUserId, cols);
    const delegatePrincipal = await toDelegationPrincipal(pool, DelegateID, cols);

    if (cols.isVacancy && (delegatorPrincipal == null || delegatePrincipal == null)) {
      return res.status(400).json({ message: 'تعذّر تحديد المنصب (VacancyID) لأحد الطرفين. تأكد من وجود إسناد نشط.' });
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
