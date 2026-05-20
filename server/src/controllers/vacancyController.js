// src/controllers/vacancyController.js
// إدارة المناصب/الوظائف (JobVacancies) وإسناد المستخدمين إليها (Assignments).
// كل العمليات دفاعية: تفحص وجود الجداول والأعمدة الاختيارية قبل استخدامها.

const sql = require('mssql');

// ---- فحص دفعي لوجود الأعمدة/الجداول المهمّة ----
async function probeVacancySchema(pool) {
    const r = await pool.request().query(`
        SELECT
          CASE WHEN OBJECT_ID('dbo.JobVacancies', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancies,
          CASE WHEN OBJECT_ID('dbo.Assignments',  'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'Name')         IS NOT NULL THEN 1 ELSE 0 END AS HasVacName,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'IsActive')     IS NOT NULL THEN 1 ELSE 0 END AS HasVacIsActive,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacDept,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'CreatedAt')    IS NOT NULL THEN 1 ELSE 0 END AS HasVacCreatedAt,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'Type')         IS NOT NULL THEN 1 ELSE 0 END AS HasVacType,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'Rank')         IS NOT NULL THEN 1 ELSE 0 END AS HasVacRank,
          CASE WHEN COL_LENGTH('dbo.JobVacancies', 'Notes')        IS NOT NULL THEN 1 ELSE 0 END AS HasVacNotes,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'IsCurrent')         IS NOT NULL THEN 1 ELSE 0 END AS HasAssIsCurrent,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'StartDate')         IS NOT NULL THEN 1 ELSE 0 END AS HasAssStartDate,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'EndDate')           IS NOT NULL THEN 1 ELSE 0 END AS HasAssEndDate,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'CreatedAt')         IS NOT NULL THEN 1 ELSE 0 END AS HasAssCreatedAt,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'UpdatedAt')         IS NOT NULL THEN 1 ELSE 0 END AS HasAssUpdatedAt,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'AssignedByUserID')  IS NOT NULL THEN 1 ELSE 0 END AS HasAssAssignedBy,
          CASE WHEN COL_LENGTH('dbo.Assignments',  'VacancyNameSnapshot') IS NOT NULL THEN 1 ELSE 0 END AS HasAssVacNameSnap,
          CASE WHEN COL_LENGTH('dbo.Users',        'FullName')     IS NOT NULL THEN 1 ELSE 0 END AS HasUserFullName,
          CASE WHEN COL_LENGTH('dbo.Users',        'IsActive')     IS NOT NULL THEN 1 ELSE 0 END AS HasUserIsActive
    `);
    return r.recordset[0] || {};
}

// ---- GET /api/vacancies/department/:departmentId/scope ----
// قائمة المناصب مع الحامل الحالي لكامل هرمية القسم (حدود Type=0).
// تُستخدم في قائمة الإسناد للمهام الفرعية.
// يُرجع { UserID, FullName:"منصب (اسم)", VacancyID, CurrentUserID, CurrentUserFullName }
exports.listByDepartmentScope = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const departmentId = parseInt(req.params.departmentId, 10);
    if (!Number.isInteger(departmentId)) {
        return res.status(400).json({ message: 'departmentId must be an integer.' });
    }

    let builtQuery = '';
    try {
        const sr = await pool.request().query(`
            SELECT
                CASE WHEN OBJECT_ID('dbo.JobVacancies','U') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancies,
                CASE WHEN OBJECT_ID('dbo.Assignments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasVacDept,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','Name')         IS NOT NULL THEN 1 ELSE 0 END AS HasVacName,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','IsActive')     IS NOT NULL THEN 1 ELSE 0 END AS HasVacIsActive,
                CASE WHEN COL_LENGTH('dbo.Assignments', 'IsCurrent')    IS NOT NULL THEN 1 ELSE 0 END AS HasAssIsCurrent,
                CASE WHEN COL_LENGTH('dbo.Departments', 'ParentID')           IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
                CASE WHEN COL_LENGTH('dbo.Departments', 'ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDeptID,
                CASE WHEN COL_LENGTH('dbo.Departments', 'Type')               IS NOT NULL THEN 1 ELSE 0 END AS HasDeptType
        `);
        const s = sr.recordset[0] || {};

        if (!s.HasVacancies || !s.HasVacDept) {
            return res.status(200).json([]);
        }

        const parentCol = s.HasParentID ? 'ParentID' : (s.HasParentDeptID ? 'ParentDepartmentID' : null);
        const nameExpr = s.HasVacName ? 'jv.Name' : 'CAST(jv.VacancyID AS NVARCHAR(50))';
        const isActiveFilter = s.HasVacIsActive ? 'AND (jv.IsActive = 1 OR jv.IsActive IS NULL)' : '';

        // TRY_CAST يعمل بأمان مع INT و NVARCHAR — يُرجع NULL إذا فشل التحويل (يُعامَل كـ non-zero)
        const typeNotZero = s.HasDeptType
            ? `(d.[Type] IS NULL OR TRY_CAST(d.[Type] AS INT) IS NULL OR TRY_CAST(d.[Type] AS INT) <> 0)`
            : null;

        // CTE لهرمية الأقسام
        // المنطق: نصعد وندرج حتى أقرب قسم Type=0 (نتوقف بعد إضافته)،
        //          ثم نهبط من ذلك الجذر مستثنين أقسام Type=0 الفرعية.
        let withCte = '';
        let deptFilter = '';

        if (parentCol) {
            // فلتر الهبوط: يستثني أقسام Type=0 عند النزول (هي وحدات منفصلة مستقلة)
            const downWhere = `WHERE d.[Type] IS NULL OR TRY_CAST(d.[Type] AS INT) IS NULL OR TRY_CAST(d.[Type] AS INT) <> 0`;

            if (s.HasDeptType) {
                // المنطق:
                // 1) نصعد بلا قيود حتى قمة الشجرة لنجمع كل الأسلاف.
                // 2) الجذر = أقرب قسم Type=0 في السلسلة (بما فيه القسم نفسه إن كان Type=0).
                //    → إن وُجد Type=0 فوق القسم يصبح هو حدّ الوحدة الفاصل.
                // 3) إن لم يُوجد أي Type=0 نصعد مستوى واحداً فقط (الأب المباشر)
                //    لنضمن ظهور الأقسام المجاورة في نفس الوحدة.
                // 4) عند الهبوط نستثني الفروع ذات Type=0 (وحدات منفصلة مستقلة).
                withCte = `
                    WITH UpTree AS (
                        SELECT DepartmentID, ${parentCol} AS PID, 0 AS Lvl,
                               TRY_CAST([Type] AS INT) AS DType
                        FROM dbo.Departments
                        WHERE DepartmentID = @DepartmentID
                        UNION ALL
                        SELECT d.DepartmentID, d.${parentCol} AS PID, u.Lvl + 1,
                               TRY_CAST(d.[Type] AS INT) AS DType
                        FROM dbo.Departments d
                        INNER JOIN UpTree u ON d.DepartmentID = u.PID
                    ),
                    RootID AS (
                        SELECT COALESCE(
                            (SELECT TOP 1 DepartmentID FROM UpTree WHERE DType = 0 ORDER BY Lvl ASC),
                            (SELECT TOP 1 DepartmentID FROM UpTree WHERE Lvl = 1),
                            @DepartmentID
                        ) AS RootDeptID
                    ),
                    DeptScope AS (
                        SELECT d.DepartmentID
                        FROM dbo.Departments d CROSS JOIN RootID r
                        WHERE d.DepartmentID = r.RootDeptID
                        UNION ALL
                        SELECT d.DepartmentID
                        FROM dbo.Departments d
                        INNER JOIN DeptScope t ON d.${parentCol} = t.DepartmentID
                        ${downWhere}
                    )
                `;
            } else {
                // لا يوجد عمود Type — نشمل القسم الأب وجميع أقسامه الفرعية
                withCte = `
                    WITH ParentID AS (
                        SELECT COALESCE(
                            (SELECT TOP 1 ${parentCol} FROM dbo.Departments WHERE DepartmentID = @DepartmentID AND ${parentCol} IS NOT NULL),
                            @DepartmentID
                        ) AS RootDeptID
                    ),
                    DeptScope AS (
                        SELECT d.DepartmentID FROM dbo.Departments d CROSS JOIN ParentID p WHERE d.DepartmentID = p.RootDeptID
                        UNION ALL
                        SELECT d.DepartmentID
                        FROM dbo.Departments d
                        INNER JOIN DeptScope t ON d.${parentCol} = t.DepartmentID
                    )
                `;
            }
            deptFilter = 'EXISTS (SELECT 1 FROM DeptScope sc WHERE sc.DepartmentID = jv.DepartmentID)';
        } else {
            deptFilter = 'jv.DepartmentID = @DepartmentID';
        }

        // جلب الحامل الحالي بـ LEFT JOIN بسيط (بدون OUTER APPLY)
        const assJoin = s.HasAssignments
            ? `LEFT JOIN dbo.Assignments ca ON ca.VacancyID = jv.VacancyID ${s.HasAssIsCurrent ? 'AND ca.IsCurrent = 1' : ''}
               LEFT JOIN dbo.Users u ON u.UserID = ca.UserID`
            : '';

        const personName = s.HasAssignments ? 'u.FullName' : 'CAST(NULL AS NVARCHAR(200))';
        const personId   = s.HasAssignments ? 'ca.UserID'  : 'CAST(NULL AS NVARCHAR(50))';

        const mainSql = `
            SELECT DISTINCT
                CAST(jv.VacancyID AS NVARCHAR(50)) AS UserID,
                ISNULL(${nameExpr}, CAST(jv.VacancyID AS NVARCHAR(50)))
                + CASE
                    WHEN ${nameExpr} IS NOT NULL AND ${personName} IS NOT NULL AND LTRIM(RTRIM(${personName})) <> ''
                        THEN N' (' + ${personName} + N')'
                    ELSE N''
                  END AS FullName,
                jv.VacancyID,
                ${personId}   AS CurrentUserID,
                ${personName} AS CurrentUserFullName
            FROM dbo.JobVacancies jv
            ${assJoin}
            WHERE ${deptFilter}
            ${isActiveFilter}
            ORDER BY FullName
            OPTION (MAXRECURSION 100)
        `;

        builtQuery = withCte ? `${withCte}\n${mainSql}` : mainSql;

        const result = await pool.request()
            .input('DepartmentID', sql.Int, departmentId)
            .query(builtQuery);

        res.status(200).json(result.recordset || []);
    } catch (err) {
        console.error('LIST VACANCIES BY DEPT SCOPE ERROR:', err.message);
        console.error('SQL used:\n', builtQuery);
        res.status(500).send({ message: 'Error fetching assignable users', detail: err.message });
    }
};

// ---- GET /api/vacancies/department/:departmentId ----
// يُرجِع قائمة المناصب مع بيانات المُسنَد الحالي (إن وُجد)
exports.listByDepartment = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const departmentId = parseInt(req.params.departmentId, 10);
    if (!Number.isInteger(departmentId)) {
        return res.status(400).json({ message: 'departmentId must be an integer.' });
    }

    try {
        const s = await probeVacancySchema(pool);
        if (!s.HasVacancies) {
            return res.status(200).json([]);
        }

        const nameCol     = s.HasVacName ? 'jv.Name' : `CAST(jv.VacancyID AS NVARCHAR(50))`;
        const isActiveCol = s.HasVacIsActive ? 'jv.IsActive' : 'CAST(1 AS BIT)';
        const deptFilter  = s.HasVacDept ? 'jv.DepartmentID = @DepartmentID' : '1 = 0';

        const assignJoin = s.HasAssignments ? `
            OUTER APPLY (
                SELECT TOP 1 a.AssignmentID, a.UserID, a.VacancyID
                  ${s.HasAssStartDate ? ', a.StartDate' : ''}
                  ${s.HasAssEndDate   ? ', a.EndDate'   : ''}
                FROM dbo.Assignments a
                WHERE a.VacancyID = jv.VacancyID
                  ${s.HasAssIsCurrent ? 'AND a.IsCurrent = 1' : ''}
                ORDER BY
                  ${s.HasAssIsCurrent ? 'CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,' : ''}
                  ${s.HasAssStartDate ? `ISNULL(a.StartDate, '1900-01-01') DESC,` : ''}
                  a.AssignmentID DESC
            ) ca
            LEFT JOIN dbo.Users u ON u.UserID = ca.UserID
        ` : '';

        const selectUser = s.HasAssignments ? `,
                ca.AssignmentID AS CurrentAssignmentID,
                ca.UserID       AS CurrentUserID,
                ${s.HasUserFullName ? 'u.FullName' : 'CAST(NULL AS NVARCHAR(200))'} AS CurrentUserFullName,
                ${s.HasUserIsActive ? 'u.IsActive' : 'CAST(1 AS BIT)'}              AS CurrentUserIsActive
                ${s.HasAssStartDate ? ', ca.StartDate AS AssignmentStartDate' : ''}
        ` : '';

        const result = await pool.request()
            .input('DepartmentID', sql.Int, departmentId)
            .query(`
                SELECT
                    jv.VacancyID,
                    ${nameCol}     AS Name,
                    ${isActiveCol} AS IsActive,
                    ${s.HasVacDept ? 'jv.DepartmentID' : 'CAST(NULL AS INT) AS DepartmentID'}
                    ${selectUser}
                FROM dbo.JobVacancies jv
                ${assignJoin}
                WHERE ${deptFilter}
                ORDER BY ${s.HasVacName ? 'jv.Name' : 'jv.VacancyID'}
            `);

        res.status(200).json(result.recordset || []);
    } catch (err) {
        console.error('LIST VACANCIES BY DEPARTMENT ERROR:', err);
        res.status(500).send({ message: 'Error fetching vacancies', detail: err.message });
    }
};

// ---- POST /api/vacancies ----
// Body: { DepartmentID, Name, IsActive?, Type?, Rank?, Notes? }
exports.createVacancy = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const { DepartmentID, Name, IsActive, Type, Rank, Notes } = req.body || {};
    const departmentId = parseInt(DepartmentID, 10);
    if (!Number.isInteger(departmentId)) {
        return res.status(400).json({ message: 'DepartmentID is required (integer).' });
    }
    const nm = String(Name || '').trim();
    if (!nm) return res.status(400).json({ message: 'Name is required.' });

    try {
        const s = await probeVacancySchema(pool);
        console.log('[createVacancy] probeVacancySchema result:', JSON.stringify(s));
        if (!s.HasVacancies || !s.HasVacDept) {
            return res.status(400).json({ message: 'JobVacancies/DepartmentID schema is not available.' });
        }

        // تأكد أن القسم موجود قبل الإدراج (لمنع خطأ FK غامض)
        const depExists = await pool.request()
            .input('DepartmentID', sql.Int, departmentId)
            .query('SELECT TOP 1 DepartmentID FROM dbo.Departments WHERE DepartmentID = @DepartmentID');
        if (!depExists.recordset[0]) {
            return res.status(404).json({ message: 'القسم المحدَّد غير موجود.' });
        }

        const cols = ['DepartmentID'];
        const vals = ['@DepartmentID'];
        const reqq = pool.request().input('DepartmentID', sql.Int, departmentId);

        if (s.HasVacName) {
            cols.push('Name');
            vals.push('@Name');
            reqq.input('Name', sql.NVarChar(200), nm);
        }
        if (s.HasVacIsActive) {
            cols.push('IsActive');
            vals.push('@IsActive');
            reqq.input('IsActive', sql.Bit, typeof IsActive === 'boolean' ? IsActive : true);
        }
        // CreatedAt — NOT NULL بلا قيمة افتراضية في المخطط
        // نُدرجها دائماً بشكل غير مشروط لأن المخطط يتطلّبها (تأكدنا من رسالة الخطأ)
        // حتى لو فشل الـ probe في اكتشافها لأي سبب، الإدراج هنا آمن عبر IF COL_LENGTH
        cols.push('CreatedAt');
        vals.push('GETDATE()');
        // أعمدة اختيارية إن أُرسِلت
        if (s.HasVacType && typeof Type === 'string' && Type.trim().length > 0) {
            cols.push('Type');
            vals.push('@Type');
            reqq.input('Type', sql.NVarChar(100), Type.trim());
        }
        if (s.HasVacRank && Rank != null) {
            const r = parseInt(Rank, 10);
            if (Number.isInteger(r)) {
                cols.push('Rank');
                vals.push('@Rank');
                reqq.input('Rank', sql.Int, r);
            }
        }
        if (s.HasVacNotes && typeof Notes === 'string' && Notes.trim().length > 0) {
            cols.push('Notes');
            vals.push('@Notes');
            reqq.input('Notes', sql.NVarChar(sql.MAX), Notes.trim());
        }

        const inserted = await reqq.query(
            `INSERT INTO dbo.JobVacancies (${cols.join(', ')})
             OUTPUT INSERTED.*
             VALUES (${vals.join(', ')})`
        );
        res.status(201).json(inserted.recordset[0] || null);
    } catch (err) {
        console.error('CREATE VACANCY ERROR:', err);
        res.status(500).send({ message: 'Error creating vacancy', detail: err.message });
    }
};

// ---- PUT /api/vacancies/:id ----
// Body: { Name?, IsActive?, DepartmentID? }
exports.updateVacancy = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) {
        return res.status(400).json({ message: 'id must be an integer.' });
    }
    const { Name, IsActive, DepartmentID } = req.body || {};

    try {
        const s = await probeVacancySchema(pool);
        if (!s.HasVacancies) {
            return res.status(400).json({ message: 'JobVacancies not available.' });
        }

        const setParts = [];
        const reqq = pool.request().input('VacancyID', sql.Int, vacancyId);

        if (s.HasVacName && typeof Name === 'string' && Name.trim().length > 0) {
            setParts.push('Name = @Name');
            reqq.input('Name', sql.NVarChar, Name.trim());
        }
        if (s.HasVacIsActive && typeof IsActive === 'boolean') {
            setParts.push('IsActive = @IsActive');
            reqq.input('IsActive', sql.Bit, IsActive);
        }
        if (s.HasVacDept && DepartmentID != null) {
            const d = parseInt(DepartmentID, 10);
            if (Number.isInteger(d)) {
                setParts.push('DepartmentID = @DepartmentID');
                reqq.input('DepartmentID', sql.Int, d);
            }
        }

        if (setParts.length === 0) {
            return res.status(400).json({ message: 'No updatable fields provided.' });
        }

        await reqq.query(`UPDATE dbo.JobVacancies SET ${setParts.join(', ')} WHERE VacancyID = @VacancyID`);
        res.status(200).json({ message: 'Vacancy updated successfully' });
    } catch (err) {
        console.error('UPDATE VACANCY ERROR:', err);
        res.status(500).send({ message: 'Error updating vacancy', detail: err.message });
    }
};

// ---- DELETE /api/vacancies/:id ----
// يُرفض الحذف إن كان المنصب مرجَعاً من Tasks/Subtasks/Comments/Assignments نشطة.
exports.deleteVacancy = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) {
        return res.status(400).json({ message: 'id must be an integer.' });
    }

    try {
        await pool.request()
            .input('VacancyID', sql.Int, vacancyId)
            .query(`DELETE FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
        res.status(200).json({ message: 'Vacancy deleted successfully' });
    } catch (err) {
        console.error('DELETE VACANCY ERROR:', err);
        if (err.number === 547) {
            return res.status(400).send({
                message: 'لا يمكن حذف المنصب لأنه مرتبط بإسنادات أو مهام.',
                detail: err.message,
            });
        }
        res.status(500).send({ message: 'Error deleting vacancy', detail: err.message });
    }
};

// ---- POST /api/vacancies/:id/assign ----
// Body: { UserID }
// ينقل المستخدم إلى المنصب المستهدف: يُغلق إسناداته الحالية ويُغلق حامل المنصب الحالي (إن وُجد)،
// ثم يُنشئ Assignment جديد IsCurrent=1.
exports.assignUser = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) {
        return res.status(400).json({ message: 'id must be an integer.' });
    }
    const userId = String((req.body && req.body.UserID) || '').trim();
    if (!userId) {
        return res.status(400).json({ message: 'UserID is required.' });
    }

    const transaction = new sql.Transaction(pool);
    try {
        const s = await probeVacancySchema(pool);
        console.log('[assignUser] probeVacancySchema result:', JSON.stringify(s));
        if (!s.HasVacancies || !s.HasAssignments) {
            return res.status(400).json({ message: 'JobVacancies/Assignments are not available.' });
        }

        await transaction.begin();

        // 1) تأكد أن المنصب موجود
        const vacancyExists = await new sql.Request(transaction)
            .input('VacancyID', sql.Int, vacancyId)
            .query(`SELECT TOP 1 VacancyID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
        if (!vacancyExists.recordset[0]) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Vacancy not found.' });
        }

        // 2) تأكد أن المستخدم موجود
        const userExists = await new sql.Request(transaction)
            .input('UserID', sql.NVarChar, userId)
            .query(`SELECT TOP 1 UserID FROM dbo.Users WHERE UserID = @UserID`);
        if (!userExists.recordset[0]) {
            await transaction.rollback();
            return res.status(404).json({ message: 'User not found.' });
        }

        // 3) إذا كان المستخدم يحمل هذا المنصب بالفعل بإسناد نشط — لا شيء
        if (s.HasAssIsCurrent) {
            const alreadyHolds = await new sql.Request(transaction)
                .input('UserID', sql.NVarChar, userId)
                .input('VacancyID', sql.Int, vacancyId)
                .query(`SELECT TOP 1 AssignmentID FROM dbo.Assignments
                        WHERE UserID = @UserID AND VacancyID = @VacancyID AND IsCurrent = 1`);
            if (alreadyHolds.recordset[0]) {
                await transaction.commit();
                return res.status(200).json({
                    message: 'User already holds this vacancy.',
                    changed: false,
                    assignmentId: alreadyHolds.recordset[0].AssignmentID,
                });
            }

            // 4a) أغلق الإسنادات الحالية للمستخدم (قد يكون في منصب آخر)
            const closeUser = ['IsCurrent = 0'];
            if (s.HasAssEndDate)   closeUser.push('EndDate = GETDATE()');
            if (s.HasAssUpdatedAt) closeUser.push('UpdatedAt = GETDATE()');
            await new sql.Request(transaction)
                .input('UserID', sql.NVarChar, userId)
                .query(`UPDATE dbo.Assignments SET ${closeUser.join(', ')}
                        WHERE UserID = @UserID AND IsCurrent = 1`);

            // 4b) أغلق حامل هذا المنصب الحالي (إن كان شخصاً آخر)
            const closeVac = ['IsCurrent = 0'];
            if (s.HasAssEndDate)   closeVac.push('EndDate = GETDATE()');
            if (s.HasAssUpdatedAt) closeVac.push('UpdatedAt = GETDATE()');
            await new sql.Request(transaction)
                .input('VacancyID', sql.Int, vacancyId)
                .query(`UPDATE dbo.Assignments SET ${closeVac.join(', ')}
                        WHERE VacancyID = @VacancyID AND IsCurrent = 1`);
        }

        // 5) أنشئ إسناداً جديداً — نملأ كل الأعمدة المطلوبة NOT NULL + الاختيارية المتاحة
        const cols = ['UserID', 'VacancyID'];
        const vals = ['@UserID', '@VacancyID'];
        const insReq = new sql.Request(transaction)
            .input('UserID', sql.NVarChar(50), userId)
            .input('VacancyID', sql.Int, vacancyId);

        if (s.HasAssIsCurrent)   { cols.push('IsCurrent');  vals.push('1'); }
        if (s.HasAssStartDate)   { cols.push('StartDate');  vals.push('GETDATE()'); }
        // CreatedAt — NOT NULL بلا قيمة افتراضية؛ نُدرجها بشكل غير مشروط
        cols.push('CreatedAt');
        vals.push('GETDATE()');
        if (s.HasAssUpdatedAt)   { cols.push('UpdatedAt');  vals.push('GETDATE()'); }

        // لقطة اسم المنصب (اختياري) — مفيد لتتبّع التاريخ لو تغيّر اسم المنصب لاحقاً
        if (s.HasAssVacNameSnap && s.HasVacName) {
            cols.push('VacancyNameSnapshot');
            vals.push('(SELECT TOP 1 Name FROM dbo.JobVacancies WHERE VacancyID = @VacancyID)');
        }

        // من أسند (إن كان موجوداً في req.user أو req.body.AssignedByUserID)
        const assignedBy = (req.user && req.user.UserID) || (req.body && req.body.AssignedByUserID);
        if (s.HasAssAssignedBy && assignedBy) {
            cols.push('AssignedByUserID');
            vals.push('@AssignedByUserID');
            insReq.input('AssignedByUserID', sql.NVarChar(50), String(assignedBy));
        }

        const inserted = await insReq.query(
            `INSERT INTO dbo.Assignments (${cols.join(', ')})
             OUTPUT INSERTED.AssignmentID
             VALUES (${vals.join(', ')})`
        );
        const newId = inserted.recordset[0]?.AssignmentID;

        await transaction.commit();
        res.status(200).json({
            message: 'User assigned to vacancy successfully.',
            changed: true,
            assignmentId: newId,
        });
    } catch (err) {
        try { await transaction.rollback(); } catch (_) {}
        console.error('ASSIGN USER TO VACANCY ERROR:', err);
        res.status(500).send({ message: 'Error assigning user', detail: err.message });
    }
};

// ---- DELETE /api/vacancies/:id/assign ----
// يُغلق الإسناد الحالي لهذا المنصب (يجعل المنصب شاغراً).
exports.unassignCurrent = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) {
        return res.status(400).json({ message: 'id must be an integer.' });
    }

    try {
        const s = await probeVacancySchema(pool);
        if (!s.HasAssignments) {
            return res.status(400).json({ message: 'Assignments table is not available.' });
        }
        if (!s.HasAssIsCurrent) {
            return res.status(400).json({ message: 'Assignments.IsCurrent column is not available.' });
        }

        const setParts = ['IsCurrent = 0'];
        if (s.HasAssEndDate) setParts.push('EndDate = GETDATE()');

        const result = await pool.request()
            .input('VacancyID', sql.Int, vacancyId)
            .query(`UPDATE dbo.Assignments SET ${setParts.join(', ')}
                    OUTPUT DELETED.AssignmentID
                    WHERE VacancyID = @VacancyID AND IsCurrent = 1`);

        res.status(200).json({
            message: 'Vacancy is now unassigned.',
            closedAssignments: (result.recordset || []).length,
        });
    } catch (err) {
        console.error('UNASSIGN VACANCY ERROR:', err);
        res.status(500).send({ message: 'Error unassigning vacancy', detail: err.message });
    }
};

// ---- VacancyRanks helpers ----
async function probeRanksSchema(pool) {
    const r = await pool.request().query(`
        SELECT
          CASE WHEN OBJECT_ID('dbo.VacancyRanks','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTable,
          CASE WHEN COL_LENGTH('dbo.VacancyRanks','VacancyRankID') IS NOT NULL THEN 1 ELSE 0 END AS HasVRID,
          CASE WHEN COL_LENGTH('dbo.VacancyRanks','RankID')        IS NOT NULL THEN 1 ELSE 0 END AS HasRankID,
          CASE WHEN COL_LENGTH('dbo.VacancyRanks','VacancyID')     IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyID,
          CASE WHEN COL_LENGTH('dbo.VacancyRanks','Rank')          IS NOT NULL THEN 1 ELSE 0 END AS HasRankCol,
          CASE WHEN COL_LENGTH('dbo.VacancyRanks','Name')          IS NOT NULL THEN 1 ELSE 0 END AS HasNameCol
    `);
    const s = r.recordset[0] || {};
    return {
        ...s,
        pkCol: s.HasVRID ? 'VacancyRankID' : (s.HasRankID ? 'RankID' : null),
        rankValueCol: s.HasRankCol ? 'Rank' : (s.HasNameCol ? 'Name' : null),
    };
}

// ---- GET /api/vacancies/ranks ----
exports.listRanks = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'DB unavailable' });
    try {
        const s = await probeRanksSchema(pool);
        if (!s.HasTable || !s.rankValueCol) return res.status(200).json([]);
        const result = await pool.request().query(
            `SELECT * FROM dbo.VacancyRanks ORDER BY ${s.pkCol || '(SELECT NULL)'}`
        );
        res.status(200).json(result.recordset || []);
    } catch (err) {
        console.error('LIST RANKS ERROR:', err);
        res.status(500).json({ message: 'Error fetching ranks', detail: err.message });
    }
};

// ---- GET /api/vacancies/:id/rank ----
exports.getVacancyRank = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'DB unavailable' });
    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) return res.status(400).json({ message: 'id must be integer' });
    try {
        const s = await probeRanksSchema(pool);
        if (!s.HasTable || !s.HasVacancyID) return res.status(200).json(null);
        const result = await pool.request()
            .input('VacancyID', sql.Int, vacancyId)
            .query(`SELECT TOP 1 * FROM dbo.VacancyRanks WHERE VacancyID = @VacancyID`);
        res.status(200).json(result.recordset[0] || null);
    } catch (err) {
        console.error('GET VACANCY RANK ERROR:', err);
        res.status(500).json({ message: 'Error fetching rank', detail: err.message });
    }
};

// ---- PUT /api/vacancies/:id/rank ----
// Body: { Rank: string }
exports.setVacancyRank = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'DB unavailable' });
    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) return res.status(400).json({ message: 'id must be integer' });
    const rankVal = String((req.body && req.body.Rank) || '').trim();
    if (!rankVal) return res.status(400).json({ message: 'Rank is required' });
    try {
        const s = await probeRanksSchema(pool);
        if (!s.HasTable || !s.rankValueCol) {
            return res.status(200).json({ message: 'VacancyRanks not available, rank not stored' });
        }
        if (s.HasVacancyID) {
            const existing = await pool.request()
                .input('VacancyID', sql.Int, vacancyId)
                .query(`SELECT TOP 1 ${s.pkCol} FROM dbo.VacancyRanks WHERE VacancyID = @VacancyID`);
            if (existing.recordset[0]) {
                await pool.request()
                    .input('VacancyID', sql.Int, vacancyId)
                    .input('RankVal', sql.NVarChar(200), rankVal)
                    .query(`UPDATE dbo.VacancyRanks SET ${s.rankValueCol} = @RankVal WHERE VacancyID = @VacancyID`);
            } else {
                await pool.request()
                    .input('VacancyID', sql.Int, vacancyId)
                    .input('RankVal', sql.NVarChar(200), rankVal)
                    .query(`INSERT INTO dbo.VacancyRanks (VacancyID, ${s.rankValueCol}) VALUES (@VacancyID, @RankVal)`);
            }
        } else {
            return res.status(200).json({ message: 'VacancyRanks has no VacancyID column, rank not linked' });
        }
        res.status(200).json({ message: 'Rank saved' });
    } catch (err) {
        console.error('SET VACANCY RANK ERROR:', err);
        res.status(500).json({ message: 'Error saving rank', detail: err.message });
    }
};

// ---- DELETE /api/vacancies/:id/rank ----
exports.deleteVacancyRank = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).json({ message: 'DB unavailable' });
    const vacancyId = parseInt(req.params.id, 10);
    if (!Number.isInteger(vacancyId)) return res.status(400).json({ message: 'id must be integer' });
    try {
        const s = await probeRanksSchema(pool);
        if (!s.HasTable || !s.HasVacancyID) return res.status(200).json({ message: 'Nothing to delete' });
        await pool.request()
            .input('VacancyID', sql.Int, vacancyId)
            .query(`DELETE FROM dbo.VacancyRanks WHERE VacancyID = @VacancyID`);
        res.status(200).json({ message: 'Rank deleted' });
    } catch (err) {
        console.error('DELETE VACANCY RANK ERROR:', err);
        res.status(500).json({ message: 'Error deleting rank', detail: err.message });
    }
};

// ---- GET /api/vacancies/candidates ----
// قائمة بكل المستخدمين النشطين (مع سياقهم: القسم الحالي/المنصب الحالي)
// يستطيع المدير اختيار أي مستخدم بغض النظر عن قسمه.
// الحقول الإضافية (مثل CurrentVacancyName/CurrentDepartmentName/CurrentDepartmentID) اختيارية
// بحسب المخطط المتاح، لتُعرض كسياق في الواجهة.
exports.listCandidates = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    try {
        const s = await probeVacancySchema(pool);

        // نبني SELECT دفاعي بحسب الأعمدة المتاحة
        const fullNameExpr = s.HasUserFullName ? 'u.FullName' : 'u.UserID';

        // قيّد النتائج للمستخدمين النشطين إن كان العمود موجوداً
        const whereActive = s.HasUserIsActive ? 'WHERE u.IsActive = 1' : '';

        // إن وُجِد نظام الإسنادات، نُرفق المنصب الحالي وقسمه (LEFT JOIN)
        const hasAssignmentContext = !!s.HasAssignments;
        const isCurrentClause = s.HasAssIsCurrent ? 'AND a.IsCurrent = 1' : '';

        const selectContextCols = hasAssignmentContext
            ? `,
                a.AssignmentID         AS CurrentAssignmentID,
                a.VacancyID            AS CurrentVacancyID,
                ${s.HasVacName ? 'jv.Name' : 'CAST(NULL AS NVARCHAR(200))'} AS CurrentVacancyName,
                ${s.HasVacDept ? 'jv.DepartmentID' : 'CAST(NULL AS INT)'}  AS CurrentDepartmentID,
                d.Name                 AS CurrentDepartmentName`
            : `,
                CAST(NULL AS INT)              AS CurrentAssignmentID,
                CAST(NULL AS INT)              AS CurrentVacancyID,
                CAST(NULL AS NVARCHAR(200))    AS CurrentVacancyName,
                CAST(NULL AS INT)              AS CurrentDepartmentID,
                CAST(NULL AS NVARCHAR(200))    AS CurrentDepartmentName`;

        const fromJoins = hasAssignmentContext
            ? `
                LEFT JOIN dbo.Assignments   a  ON a.UserID = u.UserID ${isCurrentClause}
                LEFT JOIN dbo.JobVacancies  jv ON jv.VacancyID = a.VacancyID
                LEFT JOIN dbo.Departments   d  ON d.DepartmentID = ${s.HasVacDept ? 'jv.DepartmentID' : 'NULL'}`
            : '';

        const query = `
            SELECT
                u.UserID,
                ${fullNameExpr} AS FullName
                ${selectContextCols}
            FROM dbo.Users u
            ${fromJoins}
            ${whereActive}
            ORDER BY ${s.HasUserFullName ? 'u.FullName' : 'u.UserID'}
        `;

        const result = await pool.request().query(query);
        res.status(200).json(result.recordset || []);
    } catch (err) {
        console.error('LIST CANDIDATES ERROR:', err);
        res.status(500).send({ message: 'Error fetching candidates', detail: err.message });
    }
};

// ---- GET /api/vacancies/unassigned-users ----
// قائمة بالمستخدمين الذين لا يحملون أي منصب حالياً (IsCurrent=1)
// مفيد لواجهة "تعيين مستخدم في منصب" كي يختار المدير بسهولة.
exports.listUnassignedUsers = async (req, res) => {
    const pool = req.app.locals.db;
    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    try {
        const s = await probeVacancySchema(pool);

        let query;
        if (s.HasAssignments && s.HasAssIsCurrent) {
            query = `
                SELECT u.UserID, ${s.HasUserFullName ? 'u.FullName' : 'u.UserID AS FullName'}
                FROM dbo.Users u
                WHERE ${s.HasUserIsActive ? 'u.IsActive = 1 AND' : ''}
                      NOT EXISTS (
                          SELECT 1 FROM dbo.Assignments a
                          WHERE a.UserID = u.UserID AND a.IsCurrent = 1
                      )
                ORDER BY ${s.HasUserFullName ? 'u.FullName' : 'u.UserID'}
            `;
        } else {
            // لا يوجد نظام إسنادات — نُرجع كل المستخدمين النشطين
            query = `
                SELECT u.UserID, ${s.HasUserFullName ? 'u.FullName' : 'u.UserID AS FullName'}
                FROM dbo.Users u
                ${s.HasUserIsActive ? 'WHERE u.IsActive = 1' : ''}
                ORDER BY ${s.HasUserFullName ? 'u.FullName' : 'u.UserID'}
            `;
        }

        const result = await pool.request().query(query);
        res.status(200).json(result.recordset || []);
    } catch (err) {
        console.error('LIST UNASSIGNED USERS ERROR:', err);
        res.status(500).send({ message: 'Error fetching unassigned users', detail: err.message });
    }
};
