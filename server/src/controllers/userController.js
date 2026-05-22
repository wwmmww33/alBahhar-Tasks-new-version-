// src/controllers/userController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { detectSchema } = require('../utils/vacancyResolver');

async function probeUserRolesSchema(pool) {
    const r = await pool.request().query(`
        SELECT
          CASE WHEN OBJECT_ID('dbo.UserRoles','U')          IS NOT NULL THEN 1 ELSE 0 END AS HasTable,
          CASE WHEN COL_LENGTH('dbo.UserRoles','UserID')     IS NOT NULL THEN 1 ELSE 0 END AS HasUserID,
          CASE WHEN COL_LENGTH('dbo.UserRoles','Role')       IS NOT NULL THEN 1 ELSE 0 END AS HasRole
    `);
    return r.recordset[0] || {};
}

exports.getAllUsers = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) {
        return res.status(503).send({ message: 'Database connection is not available.' });
    }
    try {
        // Users.DepartmentID قد لا يكون موجوداً في المخطط الجديد — نحسبه عبر
        // Assignments → JobVacancies، أو نحاول vw_UserCurrentProfile.
        const schema = await detectSchema(pool);

        let query;
        if (schema.hasUsersDepartmentID) {
            query = `
                SELECT
                    u.UserID,
                    u.FullName,
                    u.DepartmentID,
                    d.Name AS DepartmentName,
                    u.IsActive
                FROM Users u
                LEFT JOIN Departments d ON u.DepartmentID = d.DepartmentID
                ORDER BY u.FullName;
            `;
        } else if (schema.hasAssignments && schema.hasJobVacancies && schema.hasVacancyDepartmentID) {
            query = `
                SELECT
                    u.UserID,
                    u.FullName,
                    v.DepartmentID,
                    d.Name AS DepartmentName,
                    u.IsActive
                FROM Users u
                LEFT JOIN Assignments a ON a.UserID = u.UserID AND a.IsCurrent = 1
                LEFT JOIN JobVacancies v ON v.VacancyID = a.VacancyID
                LEFT JOIN Departments d ON d.DepartmentID = v.DepartmentID
                ORDER BY u.FullName;
            `;
        } else if (schema.hasProfileView) {
            query = `
                SELECT
                    u.UserID,
                    u.FullName,
                    p.DepartmentID,
                    d.Name AS DepartmentName,
                    u.IsActive
                FROM Users u
                LEFT JOIN vw_UserCurrentProfile p ON p.UserID = u.UserID
                LEFT JOIN Departments d ON d.DepartmentID = p.DepartmentID
                ORDER BY u.FullName;
            `;
        } else {
            query = `
                SELECT
                    u.UserID,
                    u.FullName,
                    CAST(NULL AS INT) AS DepartmentID,
                    CAST(NULL AS NVARCHAR(200)) AS DepartmentName,
                    u.IsActive
                FROM Users u
                ORDER BY u.FullName;
            `;
        }

        const result = await pool.request().query(query);

        // دمج أدوار UserRoles مع بيانات المستخدمين
        const rolesMap = new Map();
        try {
            const rp = await probeUserRolesSchema(pool);
            if (rp.HasTable && rp.HasUserID && rp.HasRole) {
                const rolesRes = await pool.request().query(`SELECT UserID, Role FROM dbo.UserRoles`);
                for (const row of rolesRes.recordset) rolesMap.set(row.UserID, row.Role);
            }
        } catch (_) {}

        const usersWithRoles = result.recordset.map(u => ({
            ...u,
            Role: rolesMap.get(u.UserID) ?? 0,
        }));

        console.log(`Found ${usersWithRoles.length} users.`);
        res.status(200).json(usersWithRoles);
    } catch (error) {
        console.error("DATABASE GET USERS ERROR:", error);
        res.status(500).send({ message: 'Error fetching users' });
    }
};

// تعيين أول مدير عام — يعمل فقط حين لا يوجد أي مدير عام في UserRoles
exports.bootstrapAdmin = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'Database connection unavailable.' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required.' });
    try {
        const s = await probeUserRolesSchema(pool);
        if (!s.HasTable) return res.status(400).json({ message: 'UserRoles table does not exist.' });

        const adminCheck = await pool.request()
            .query(`SELECT COUNT(*) AS cnt FROM dbo.UserRoles WHERE Role = 1`);
        if (adminCheck.recordset[0].cnt > 0) {
            return res.status(403).json({ message: 'يوجد مدير عام بالفعل. لا يمكن استخدام هذه الوظيفة.' });
        }

        const existing = await pool.request()
            .input('UserID', sql.NVarChar, String(userId).trim())
            .query(`SELECT TOP 1 UserID FROM dbo.UserRoles WHERE UserID = @UserID`);
        if (existing.recordset[0]) {
            await pool.request()
                .input('UserID', sql.NVarChar, String(userId).trim())
                .query(`UPDATE dbo.UserRoles SET Role = 1 WHERE UserID = @UserID`);
        } else {
            await pool.request()
                .input('UserID', sql.NVarChar, String(userId).trim())
                .query(`INSERT INTO dbo.UserRoles (UserID, Role) VALUES (@UserID, 1)`);
        }
        return res.status(200).json({ message: 'تم تعيين المدير العام بنجاح.' });
    } catch (err) {
        console.error('BOOTSTRAP ADMIN ERROR:', err);
        return res.status(500).json({ message: 'Error setting admin', detail: err.message });
    }
};

// تعيين دور مستخدم في UserRoles (0=عادي، 1=مدير عام، 2=مدير قسم)
exports.setUserRole = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'Database connection is not available.' });
    const { id } = req.params;
    const roleNum = parseInt(req.body?.role ?? req.body?.Role, 10);
    if (![0, 1, 2].includes(roleNum)) return res.status(400).json({ message: 'Role must be 0, 1, or 2.' });
    try {
        const s = await probeUserRolesSchema(pool);
        if (!s.HasTable) return res.status(400).json({ message: 'UserRoles table does not exist.' });
        if (roleNum === 0) {
            await pool.request().input('UserID', sql.NVarChar, id)
                .query(`DELETE FROM dbo.UserRoles WHERE UserID = @UserID`);
        } else {
            const existing = await pool.request().input('UserID', sql.NVarChar, id)
                .query(`SELECT TOP 1 UserID FROM dbo.UserRoles WHERE UserID = @UserID`);
            if (existing.recordset[0]) {
                await pool.request()
                    .input('UserID', sql.NVarChar, id).input('Role', sql.Int, roleNum)
                    .query(`UPDATE dbo.UserRoles SET Role = @Role WHERE UserID = @UserID`);
            } else {
                await pool.request()
                    .input('UserID', sql.NVarChar, id).input('Role', sql.Int, roleNum)
                    .query(`INSERT INTO dbo.UserRoles (UserID, Role) VALUES (@UserID, @Role)`);
            }
        }
        res.status(200).json({ message: 'Role updated successfully.' });
    } catch (err) {
        console.error('SET USER ROLE ERROR:', err);
        res.status(500).json({ message: 'Error setting role', detail: err.message });
    }
};

// ---- تغيير قسم المستخدم عبر Assignments (المخطط الجديد) ----
// يعيد { changed, newAssignmentId, newVacancyId } أو يرمي خطأ.
// المدخلات: transaction (sql.Transaction نشطة), userId, targetDepartmentId (int)
async function moveUserToDepartmentViaAssignments(transaction, pool, userId, targetDepartmentId) {
    const tdId = parseInt(targetDepartmentId, 10);
    if (!Number.isInteger(tdId)) throw new Error('Invalid target DepartmentID.');

    // فحص وجود الأعمدة الخاصة بـ Assignments (StartDate/EndDate/IsCurrent) — لنكون دفاعيين
    const probe = await new sql.Request(transaction).query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Assignments', 'IsCurrent')  IS NOT NULL THEN 1 ELSE 0 END AS HasIsCurrent,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'StartDate')  IS NOT NULL THEN 1 ELSE 0 END AS HasStartDate,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'EndDate')    IS NOT NULL THEN 1 ELSE 0 END AS HasEndDate,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'CreatedAt')  IS NOT NULL THEN 1 ELSE 0 END AS HasAssCreatedAt,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'UpdatedAt')  IS NOT NULL THEN 1 ELSE 0 END AS HasAssUpdatedAt,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'Name')      IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyName,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'IsActive')  IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyIsActive,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'CreatedAt') IS NOT NULL THEN 1 ELSE 0 END AS HasVacCreatedAt
    `);
    const p = probe.recordset[0] || {};

    // 1) حدّد Vacancy الحالية للمستخدم (إن وُجدت) والقسم الحالي
    const currentRes = await new sql.Request(transaction)
        .input('UserID', sql.NVarChar, userId)
        .query(`
            SELECT TOP 1 a.AssignmentID, a.VacancyID, jv.DepartmentID AS CurrentDepartmentID
            FROM dbo.Assignments a
            LEFT JOIN dbo.JobVacancies jv ON jv.VacancyID = a.VacancyID
            WHERE a.UserID = @UserID
              ${p.HasIsCurrent ? 'AND a.IsCurrent = 1' : ''}
            ORDER BY
              ${p.HasIsCurrent ? 'CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,' : ''}
              ${p.HasStartDate ? `ISNULL(a.StartDate, '1900-01-01') DESC,` : ''}
              a.AssignmentID DESC
        `);
    const current = currentRes.recordset[0];

    // إن كان المستخدم بالفعل في القسم المطلوب، لا شيء نفعله
    if (current && parseInt(current.CurrentDepartmentID, 10) === tdId) {
        return { changed: false, newAssignmentId: current.AssignmentID, newVacancyId: current.VacancyID };
    }

    // 2) اختر VacancyID مناسبة في القسم المستهدف: نفضّل شاغرة (غير مسنَدة حالياً)
    const vacancySelect = await new sql.Request(transaction)
        .input('DepartmentID', sql.Int, tdId)
        .query(`
            SELECT TOP 1 jv.VacancyID, jv.Name
            FROM dbo.JobVacancies jv
            ${p.HasIsCurrent ? `
            LEFT JOIN dbo.Assignments a ON a.VacancyID = jv.VacancyID AND a.IsCurrent = 1
            ` : ''}
            WHERE jv.DepartmentID = @DepartmentID
              ${p.HasVacancyIsActive ? 'AND (jv.IsActive = 1 OR jv.IsActive IS NULL)' : ''}
              ${p.HasIsCurrent ? 'AND a.AssignmentID IS NULL' : ''}
            ORDER BY jv.VacancyID ASC
        `);

    let targetVacancyId = vacancySelect.recordset[0]?.VacancyID;

    // 3) إن لم نجد شاغرة متاحة — أنشئ واحدة جديدة في القسم المستهدف
    if (targetVacancyId == null) {
        const deptRow = await new sql.Request(transaction)
            .input('DepartmentID', sql.Int, tdId)
            .query(`SELECT TOP 1 Name FROM dbo.Departments WHERE DepartmentID = @DepartmentID`);
        const deptName = deptRow.recordset[0]?.Name || `Dept ${tdId}`;
        const proposedName = `موظف - ${deptName}`;

        const createReq = new sql.Request(transaction)
            .input('DepartmentID', sql.Int, tdId);
        const cols = ['DepartmentID'];
        const vals = ['@DepartmentID'];
        if (p.HasVacancyName) {
            cols.push('Name');
            vals.push('@Name');
            createReq.input('Name', sql.NVarChar(200), proposedName);
        }
        if (p.HasVacancyIsActive) {
            cols.push('IsActive');
            vals.push('1');
        }
        // CreatedAt — NOT NULL بلا قيمة افتراضية في المخطط؛ نُدرجها دائماً
        cols.push('CreatedAt');
        vals.push('GETDATE()');
        const created = await createReq.query(
            `INSERT INTO dbo.JobVacancies (${cols.join(', ')})
             OUTPUT INSERTED.VacancyID
             VALUES (${vals.join(', ')})`
        );
        targetVacancyId = created.recordset[0]?.VacancyID;
        if (targetVacancyId == null) {
            throw new Error('Failed to create JobVacancy for target department.');
        }
    }

    // 4) أغلق الإسنادات الحالية (IsCurrent=0, EndDate=GETDATE() إن أمكن)
    if (p.HasIsCurrent) {
        const closeParts = ['IsCurrent = 0'];
        if (p.HasEndDate)       closeParts.push('EndDate = GETDATE()');
        if (p.HasAssUpdatedAt)  closeParts.push('UpdatedAt = GETDATE()');
        await new sql.Request(transaction)
            .input('UserID', sql.NVarChar(50), userId)
            .query(`UPDATE dbo.Assignments SET ${closeParts.join(', ')} WHERE UserID = @UserID AND IsCurrent = 1`);
    }

    // 5) أدخل إسناد جديد — نملأ كل الأعمدة المطلوبة NOT NULL
    const insertCols = ['UserID', 'VacancyID'];
    const insertVals = ['@UserID', '@VacancyID'];
    const insertReq = new sql.Request(transaction)
        .input('UserID', sql.NVarChar(50), userId)
        .input('VacancyID', sql.Int, parseInt(targetVacancyId, 10));
    if (p.HasIsCurrent)     { insertCols.push('IsCurrent');  insertVals.push('1'); }
    if (p.HasStartDate)     { insertCols.push('StartDate');  insertVals.push('GETDATE()'); }
    // CreatedAt — NOT NULL بلا قيمة افتراضية؛ نُدرجها دائماً
    insertCols.push('CreatedAt');
    insertVals.push('GETDATE()');
    if (p.HasAssUpdatedAt)  { insertCols.push('UpdatedAt');  insertVals.push('GETDATE()'); }

    const inserted = await insertReq.query(
        `INSERT INTO dbo.Assignments (${insertCols.join(', ')})
         OUTPUT INSERTED.AssignmentID
         VALUES (${insertVals.join(', ')})`
    );
    const newAssignmentId = inserted.recordset[0]?.AssignmentID;

    return { changed: true, newAssignmentId, newVacancyId: parseInt(targetVacancyId, 10) };
}

// نسخة مطوّرة تقبل اسم المنصب عند الإنشاء
async function moveUserToDepartmentViaAssignmentsWithName(transaction, pool, userId, targetDepartmentId, vacancyName) {
    const tdId = parseInt(targetDepartmentId, 10);
    if (!Number.isInteger(tdId)) throw new Error('Invalid target DepartmentID.');

    const probe = await new sql.Request(transaction).query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Assignments', 'IsCurrent')  IS NOT NULL THEN 1 ELSE 0 END AS HasIsCurrent,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'StartDate')  IS NOT NULL THEN 1 ELSE 0 END AS HasStartDate,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'EndDate')    IS NOT NULL THEN 1 ELSE 0 END AS HasEndDate,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'CreatedAt')  IS NOT NULL THEN 1 ELSE 0 END AS HasAssCreatedAt,
          CASE WHEN COL_LENGTH('dbo.Assignments', 'UpdatedAt')  IS NOT NULL THEN 1 ELSE 0 END AS HasAssUpdatedAt,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'Name')      IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyName,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'IsActive')  IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyIsActive,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'CreatedAt') IS NOT NULL THEN 1 ELSE 0 END AS HasVacCreatedAt
    `);
    const p = probe.recordset[0] || {};

    // إن طُلب اسم منصب محدد: نبحث عنه في القسم أولاً وإلا ننشئه
    let targetVacancyId = null;
    if (vacancyName && p.HasVacancyName) {
        const existing = await new sql.Request(transaction)
            .input('DepartmentID', sql.Int, tdId)
            .input('Name', sql.NVarChar, vacancyName.trim())
            .query(`SELECT TOP 1 VacancyID FROM dbo.JobVacancies
                    WHERE DepartmentID = @DepartmentID AND Name = @Name`);
        targetVacancyId = existing.recordset[0]?.VacancyID ?? null;
    }

    if (targetVacancyId == null) {
        const deptRow = await new sql.Request(transaction)
            .input('DepartmentID', sql.Int, tdId)
            .query(`SELECT TOP 1 Name FROM dbo.Departments WHERE DepartmentID = @DepartmentID`);
        const proposedName = vacancyName
            ? vacancyName.trim()
            : `موظف - ${deptRow.recordset[0]?.Name || `Dept ${tdId}`}`;

        const createReq = new sql.Request(transaction).input('DepartmentID', sql.Int, tdId);
        const cols = ['DepartmentID'];
        const vals = ['@DepartmentID'];
        if (p.HasVacancyName) { cols.push('Name'); vals.push('@Name'); createReq.input('Name', sql.NVarChar(200), proposedName); }
        if (p.HasVacancyIsActive) { cols.push('IsActive'); vals.push('1'); }
        cols.push('CreatedAt'); vals.push('GETDATE()');
        const created = await createReq.query(
            `INSERT INTO dbo.JobVacancies (${cols.join(', ')}) OUTPUT INSERTED.VacancyID VALUES (${vals.join(', ')})`
        );
        targetVacancyId = created.recordset[0]?.VacancyID;
        if (targetVacancyId == null) throw new Error('Failed to create JobVacancy.');
    }

    if (p.HasIsCurrent) {
        const closeParts = ['IsCurrent = 0'];
        if (p.HasEndDate)      closeParts.push('EndDate = GETDATE()');
        if (p.HasAssUpdatedAt) closeParts.push('UpdatedAt = GETDATE()');
        await new sql.Request(transaction)
            .input('UserID', sql.NVarChar(50), userId)
            .query(`UPDATE dbo.Assignments SET ${closeParts.join(', ')} WHERE UserID = @UserID AND IsCurrent = 1`);
    }

    const insertCols = ['UserID', 'VacancyID'];
    const insertVals = ['@UserID', '@VacancyID'];
    const insertReq = new sql.Request(transaction)
        .input('UserID', sql.NVarChar(50), userId)
        .input('VacancyID', sql.Int, parseInt(targetVacancyId, 10));
    if (p.HasIsCurrent)    { insertCols.push('IsCurrent'); insertVals.push('1'); }
    if (p.HasStartDate)    { insertCols.push('StartDate'); insertVals.push('GETDATE()'); }
    insertCols.push('CreatedAt'); insertVals.push('GETDATE()');
    if (p.HasAssUpdatedAt) { insertCols.push('UpdatedAt'); insertVals.push('GETDATE()'); }

    const inserted = await insertReq.query(
        `INSERT INTO dbo.Assignments (${insertCols.join(', ')}) OUTPUT INSERTED.AssignmentID VALUES (${insertVals.join(', ')})`
    );
    return { changed: true, newAssignmentId: inserted.recordset[0]?.AssignmentID, newVacancyId: parseInt(targetVacancyId, 10) };
}

// تخزين رتبة منصب في VacancyRanks (دفاعي)
async function saveVacancyRank(pool, vacancyId, rankVal) {
    try {
        const probe = await pool.request().query(`
            SELECT
              CASE WHEN OBJECT_ID('dbo.VacancyRanks','U')            IS NOT NULL THEN 1 ELSE 0 END AS HasTable,
              CASE WHEN COL_LENGTH('dbo.VacancyRanks','VacancyID')    IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyID,
              CASE WHEN COL_LENGTH('dbo.VacancyRanks','Rank')         IS NOT NULL THEN 1 ELSE 0 END AS HasRankCol,
              CASE WHEN COL_LENGTH('dbo.VacancyRanks','Name')         IS NOT NULL THEN 1 ELSE 0 END AS HasNameCol
        `);
        const s = probe.recordset[0] || {};
        if (!s.HasTable || !s.HasVacancyID) return;
        const rankCol = s.HasRankCol ? 'Rank' : (s.HasNameCol ? 'Name' : null);
        if (!rankCol) return;

        const existing = await pool.request()
            .input('VacancyID', sql.Int, vacancyId)
            .query(`SELECT TOP 1 VacancyRankID FROM dbo.VacancyRanks WHERE VacancyID = @VacancyID`);
        if (existing.recordset[0]) {
            await pool.request()
                .input('VacancyID', sql.Int, vacancyId)
                .input('RankVal', sql.NVarChar(200), rankVal)
                .query(`UPDATE dbo.VacancyRanks SET ${rankCol} = @RankVal WHERE VacancyID = @VacancyID`);
        } else {
            await pool.request()
                .input('VacancyID', sql.Int, vacancyId)
                .input('RankVal', sql.NVarChar(200), rankVal)
                .query(`INSERT INTO dbo.VacancyRanks (VacancyID, ${rankCol}) VALUES (@VacancyID, @RankVal)`);
        }
    } catch (err) {
        console.error('SAVE VACANCY RANK ERROR (non-fatal):', err.message);
    }
}

exports.updateUser = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) {
        return res.status(503).send({ message: 'Database connection is not available.' });
    }
    const { id } = req.params; // UserID
    const { FullName, DepartmentID, PasswordHash, IsActive } = req.body;

    if (typeof IsActive !== 'boolean') {
        return res.status(400).json({ message: 'IsActive must be a boolean.' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        const schema = await detectSchema(pool);
        await transaction.begin();

        // (1) تحديث حقول Users (FullName, IsActive, PasswordHash, DepartmentID إن وُجد)
        const setParts = ['FullName = @FullName', 'IsActive = @IsActive'];
        const userReq = new sql.Request(transaction)
            .input('UserID', sql.NVarChar, id)
            .input('FullName', sql.NVarChar, FullName)
            .input('IsActive', sql.Bit, IsActive);

        if (schema.hasUsersDepartmentID && DepartmentID != null) {
            setParts.push('DepartmentID = @DepartmentID');
            userReq.input('DepartmentID', sql.Int, parseInt(DepartmentID, 10));
        }

        if (PasswordHash && PasswordHash.length > 0) {
            const hashed = encryptionConfig.hashPassword(PasswordHash).combined;
            setParts.push('PasswordHash = @PasswordHash');
            userReq.input('PasswordHash', sql.NVarChar, hashed);
        }

        await userReq.query(`UPDATE Users SET ${setParts.join(', ')} WHERE UserID = @UserID`);

        // (2) تغيير القسم في المخطط الجديد عبر Assignments → JobVacancies
        //     يتم هذا فقط إن لم يكن Users.DepartmentID متوفراً وطُلب تغيير القسم
        let departmentChanged = false;
        let newAssignmentInfo = null;
        if (!schema.hasUsersDepartmentID
            && schema.hasAssignments
            && schema.hasJobVacancies
            && schema.hasVacancyDepartmentID
            && DepartmentID != null) {
            const info = await moveUserToDepartmentViaAssignments(transaction, pool, id, parseInt(DepartmentID, 10));
            departmentChanged = !!info.changed;
            newAssignmentInfo = info;
        }

        await transaction.commit();

        res.status(200).json({
            message: 'User updated successfully',
            departmentChanged,
            assignment: newAssignmentInfo,
        });
    } catch (error) {
        try { await transaction.rollback(); } catch (_) {}
        console.error("UPDATE USER ERROR:", error);
        res.status(500).send({ message: 'Error updating user', detail: error.message });
    }
};

// تشفير كلمات المرور غير المشفرة الموجودة في قاعدة البيانات
exports.encryptExistingPasswords = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'Database connection unavailable.' });
    try {
        const result = await pool.request().query(`SELECT UserID, PasswordHash FROM Users WHERE PasswordHash IS NOT NULL`);
        let encrypted = 0, skipped = 0;
        for (const row of result.recordset) {
            const hash = String(row.PasswordHash || '').trim();
            // السجلات المشفرة بالفعل تبدأ بـ "v1|"
            if (hash.startsWith('v1|')) { skipped++; continue; }
            const newHash = encryptionConfig.hashPassword(hash).combined;
            await pool.request()
                .input('UserID', sql.NVarChar, row.UserID)
                .input('PasswordHash', sql.NVarChar, newHash)
                .query(`UPDATE Users SET PasswordHash = @PasswordHash WHERE UserID = @UserID`);
            encrypted++;
        }
        res.status(200).json({ message: 'Done', encrypted, skipped });
    } catch (error) {
        console.error('ENCRYPT PASSWORDS ERROR:', error);
        res.status(500).json({ message: 'Error encrypting passwords', detail: error.message });
    }
};

// جلب كل طلبات التسجيل المعلقة
exports.getRegistrationRequests = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });
    try {
        // فحص الأعمدة الاختيارية في RegistrationRequests
        const colProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.RegistrationRequests','VacancyName') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyName,
                CASE WHEN COL_LENGTH('dbo.RegistrationRequests','Rank')        IS NOT NULL THEN 1 ELSE 0 END AS HasRank,
                CASE WHEN COL_LENGTH('dbo.RegistrationRequests','RequestDate') IS NOT NULL THEN 1 ELSE 0 END AS HasRequestDate
        `);
        const cp = colProbe.recordset[0] || {};

        const vacancyNameSel = cp.HasVacancyName
            ? 'r.VacancyName'
            : "CAST(NULL AS NVARCHAR(200)) AS VacancyName";
        const rankSel = cp.HasRank
            ? 'r.Rank'
            : "CAST(NULL AS NVARCHAR(200)) AS Rank";
        const orderBy = cp.HasRequestDate ? 'r.RequestDate DESC' : 'r.RequestID DESC';

        const result = await pool.request().query(`
            SELECT r.RequestID, r.UserID, r.FullName, r.DepartmentID, d.Name as DepartmentName,
                   ${vacancyNameSel}, ${rankSel}
            FROM RegistrationRequests r
            JOIN Departments d ON r.DepartmentID = d.DepartmentID
            WHERE r.Status = 'Pending'
            ORDER BY ${orderBy}
        `);
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error('GET REGISTRATION REQUESTS ERROR:', error);
        res.status(500).send({ message: 'Error fetching registration requests' });
    }
};

// حذف طلب تسجيل
exports.deleteRegistrationRequest = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });
    const { id } = req.params;
    try {
        await pool.request()
            .input('RequestID', sql.Int, id)
            .query(`DELETE FROM RegistrationRequests WHERE RequestID = @RequestID`);
        res.status(200).json({ message: 'Request deleted successfully.' });
    } catch (error) {
        console.error('DELETE REGISTRATION REQUEST ERROR:', error);
        res.status(500).send({ message: 'Error deleting registration request' });
    }
};

// الموافقة على طلب تسجيل
// ملاحظة: في المخطط الجديد جدول Users لا يحتوي على DepartmentID، ولذلك لا نُدخله.
// القسم يُربَط لاحقاً بإنشاء إسناد (Assignment) بشكل منفصل.
exports.approveRegistrationRequest = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) {
        return res.status(503).send({ message: 'Database connection is not available.' });
    }
    const { id } = req.params; // RequestID
    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();
        const schema = await detectSchema(pool);

        const requestResult = await new sql.Request(transaction)
            .input('RequestID', sql.Int, id)
            .query('SELECT * FROM RegistrationRequests WHERE RequestID = @RequestID AND Status = \'Pending\'');
        const requestData = requestResult.recordset[0];
        if (!requestData) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Request not found or already processed.' });
        }

        // بناء INSERT لجدول Users حسب المخطط
        const userCols = ['UserID', 'PasswordHash', 'FullName', 'IsActive'];
        const userVals = ['@UserID', '@PasswordHash', '@FullName', '1'];
        const insertReq = new sql.Request(transaction)
            .input('UserID', sql.NVarChar, requestData.UserID)
            .input('PasswordHash', sql.NVarChar, requestData.PasswordHash)
            .input('FullName', sql.NVarChar, requestData.FullName);

        if (schema.hasUsersDepartmentID) {
            userCols.push('DepartmentID');
            userVals.push('@DepartmentID');
            insertReq.input('DepartmentID', sql.Int, requestData.DepartmentID);
        }

        await insertReq.query(`INSERT INTO Users (${userCols.join(', ')}) VALUES (${userVals.join(', ')})`);

        // في المخطط الجديد ننشئ إسناداً (Assignment) للمستخدم بحيث يحصل على VacancyID في القسم المطلوب.
        if (!schema.hasUsersDepartmentID
            && schema.hasAssignments
            && schema.hasJobVacancies
            && schema.hasVacancyDepartmentID
            && requestData.DepartmentID != null) {
            try {
                const vacancyName = requestData.VacancyName || null;
                const rankVal    = requestData.Rank ? String(requestData.Rank).trim() : null;
                const assignInfo = await moveUserToDepartmentViaAssignmentsWithName(
                    transaction, pool,
                    requestData.UserID,
                    parseInt(requestData.DepartmentID, 10),
                    vacancyName
                );
                // خزّن الرتبة في VacancyRanks إن وُجدت
                if (rankVal && assignInfo.newVacancyId) {
                    await saveVacancyRank(pool, assignInfo.newVacancyId, rankVal);
                }
            } catch (assignErr) {
                console.error('APPROVE REGISTRATION ASSIGNMENT ERROR:', assignErr);
                await transaction.rollback();
                return res.status(500).send({
                    message: 'User account was staged but assignment creation failed.',
                    detail: assignErr.message,
                });
            }
        }

        await new sql.Request(transaction)
            .input('RequestID', sql.Int, id)
            .query("UPDATE RegistrationRequests SET Status = 'Approved' WHERE RequestID = @RequestID");

        await transaction.commit();
        res.status(200).json({ message: 'User approved and created successfully.' });
    } catch (error) {
        try { await transaction.rollback(); } catch (_) {}
        console.error('APPROVE REGISTRATION ERROR:', error);
        if (error.number === 2627) {
            return res.status(409).send({ message: 'User with this ID already exists.' });
        }
        res.status(500).send({ message: 'Failed to approve request.' });
    }
};
