// src/controllers/profileController.js
const sql = require('mssql');
const crypto = require('crypto');
const encryptionConfig = require('../config/encryption.config');
const { detectSchema } = require('../utils/vacancyResolver');

function buildProfileSelectSQL(schema) {
    if (schema.hasUsersDepartmentID) {
        return `
            SELECT u.UserID, u.FullName, u.DepartmentID, d.Name AS DepartmentName, u.IsAdmin, u.IsActive
            FROM Users u
            LEFT JOIN Departments d ON u.DepartmentID = d.DepartmentID
            WHERE u.UserID = @UserID
        `;
    }
    if (schema.hasAssignments && schema.hasJobVacancies && schema.hasVacancyDepartmentID) {
        return `
            SELECT u.UserID, u.FullName, v.DepartmentID, d.Name AS DepartmentName, u.IsAdmin, u.IsActive
            FROM Users u
            LEFT JOIN Assignments a ON a.UserID = u.UserID AND a.IsCurrent = 1
            LEFT JOIN JobVacancies v ON v.VacancyID = a.VacancyID
            LEFT JOIN Departments d ON d.DepartmentID = v.DepartmentID
            WHERE u.UserID = @UserID
        `;
    }
    if (schema.hasProfileView) {
        return `
            SELECT u.UserID, u.FullName, p.DepartmentID, d.Name AS DepartmentName, u.IsAdmin, u.IsActive
            FROM Users u
            LEFT JOIN vw_UserCurrentProfile p ON p.UserID = u.UserID
            LEFT JOIN Departments d ON d.DepartmentID = p.DepartmentID
            WHERE u.UserID = @UserID
        `;
    }
    return `
        SELECT u.UserID, u.FullName,
               CAST(NULL AS INT) AS DepartmentID,
               CAST(NULL AS NVARCHAR(200)) AS DepartmentName,
               u.IsAdmin, u.IsActive
        FROM Users u
        WHERE u.UserID = @UserID
    `;
}

exports.updateProfile = async (req, res) => {
    const pool = req.app.locals.db;
    const { UserID, FullName, PasswordHash, CurrentPassword } = req.body;

    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });
    if (!UserID || !FullName) return res.status(400).json({ message: 'UserID and FullName are required.' });

    try {
        const schema = await detectSchema(pool);

        if (PasswordHash) {
            if (!CurrentPassword) return res.status(400).json({ message: 'Current password is required to change password.' });

            const currentUserResult = await pool.request()
                .input('UserID', sql.NVarChar, UserID)
                .query('SELECT PasswordHash FROM Users WHERE UserID = @UserID');

            const currentUser = currentUserResult.recordset[0];
            if (!currentUser) return res.status(404).json({ message: 'User not found.' });

            const isValidCurrent = encryptionConfig.verifyPassword(CurrentPassword, currentUser.PasswordHash);
            if (!isValidCurrent) return res.status(401).json({ message: 'Current password is incorrect.' });
        }

        // DepartmentID تعديل القسم ممنوع — لا يُلامَس
        const setParts = ['FullName = @FullName'];
        const request = pool.request()
            .input('UserID', sql.NVarChar, UserID)
            .input('FullName', sql.NVarChar, FullName);

        if (PasswordHash) {
            const hashed = encryptionConfig.hashPassword(PasswordHash).combined;
            setParts.push('PasswordHash = @PasswordHash');
            request.input('PasswordHash', sql.NVarChar, hashed);
        }

        await request.query(`UPDATE Users SET ${setParts.join(', ')} WHERE UserID = @UserID`);

        const updatedUserResult = await pool.request()
            .input('UserID', sql.NVarChar, UserID)
            .query(buildProfileSelectSQL(schema));

        const updatedUser = updatedUserResult.recordset[0];
        if (!updatedUser) return res.status(404).json({ message: 'User not found after update.' });

        res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });

    } catch (error) {
        console.error('UPDATE PROFILE ERROR:', error);
        res.status(500).send({ message: 'Error updating profile' });
    }
};

exports.getProfile = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId } = req.params;

    if (!pool) return res.status(503).send({ message: 'Database connection is not available.' });

    try {
        const schema = await detectSchema(pool);
        const baseSql = buildProfileSelectSQL(schema);
        const finalSql = baseSql + ' AND u.IsActive = 1';

        const result = await pool.request()
            .input('UserID', sql.NVarChar, userId)
            .query(finalSql);

        const user = result.recordset[0];
        if (!user) return res.status(404).json({ message: 'User not found.' });

        res.status(200).json(user);
    } catch (error) {
        console.error('GET PROFILE ERROR:', error);
        res.status(500).send({ message: 'Error fetching profile' });
    }
};

// ---- نقل بيانات المنصب إلى منصب آخر ----
exports.transferVacancy = async (req, res) => {
    const pool = req.app.locals.db;
    const { UserID, ToVacancyID } = req.body;

    if (!pool) return res.status(503).json({ message: 'Database not available.' });
    if (!UserID || !ToVacancyID) return res.status(400).json({ message: 'UserID and ToVacancyID are required.' });

    try {
        const schema = await detectSchema(pool);

        // تحديد fromActorID من UserID
        // نستخدم Assignments مباشرةً بدلاً من resolveVacancyId لأن resolveVacancyId
        // قد تُعيد رقم المستخدم نفسه كـ VacancyID إذا اتفق مع رقم منصب موجود.
        let fromActorID;
        if (schema.isVacancy) {
            const assResult = await pool.request()
                .input('UID', sql.NVarChar(50), String(UserID).trim())
                .query(`
                    SELECT TOP 1 a.VacancyID
                    FROM dbo.Users u
                    INNER JOIN dbo.Assignments a ON a.UserID = u.UserID
                    WHERE u.UserID = @UID
                      AND a.VacancyID IS NOT NULL
                    ORDER BY
                        CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
                        ISNULL(a.StartDate, '1900-01-01') DESC,
                        a.AssignmentID DESC
                `);
            const vid = assResult.recordset[0]?.VacancyID;
            if (!vid) return res.status(404).json({ message: 'لم يتم العثور على منصب حالي للمستخدم.' });
            fromActorID = String(parseInt(vid, 10));
        } else {
            fromActorID = String(UserID).trim();
        }

        const toActorID = String(ToVacancyID).trim();

        if (fromActorID === toActorID) {
            return res.status(400).json({ message: 'لا يمكن النقل إلى نفس المنصب.' });
        }

        // التحقق من أن المنصبين ينتميان لنفس القسم المستقل (Type=1)
        if (schema.isVacancy && schema.hasJobVacancies && schema.hasVacancyDepartmentID) {
            const deptCheck = await pool.request()
                .input('FromID', sql.Int, parseInt(fromActorID))
                .input('ToID',   sql.Int, parseInt(toActorID))
                .query(`
                    SELECT
                        (SELECT DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @FromID) AS FromDept,
                        (SELECT DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @ToID)   AS ToDept
                `);
            const deptRow = deptCheck.recordset[0] || {};
            if (!deptRow.ToDept) return res.status(404).json({ message: 'المنصب المستهدف غير موجود.' });

            // فحص وجود عمود Type وعمود الأب في الأقسام
            const deptSchemaProbe = await pool.request().query(`
                SELECT
                    CASE WHEN COL_LENGTH('dbo.Departments','Type')               IS NOT NULL THEN 1 ELSE 0 END AS HasType,
                    CASE WHEN COL_LENGTH('dbo.Departments','ParentID')           IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
                    CASE WHEN COL_LENGTH('dbo.Departments','ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDeptID
            `);
            const ds = deptSchemaProbe.recordset[0] || {};
            const parentCol = ds.HasParentID ? 'ParentID' : (ds.HasParentDeptID ? 'ParentDepartmentID' : null);

            if (ds.HasType && parentCol) {
                // نجد جذر Type=1 لمنصب المصدر، ثم نتحقق أن قسم المنصب الهدف
                // يقع ضمن النطاق الهابط من ذلك الجذر (يشمل الأقسام الفرعية المتداخلة).
                const scopeCheck = await pool.request()
                    .input('FromDept', sql.Int, deptRow.FromDept)
                    .input('ToDept',   sql.Int, deptRow.ToDept)
                    .query(`
                        WITH FromAnc AS (
                            SELECT DepartmentID, TRY_CAST(${parentCol} AS INT) AS PID, TRY_CAST([Type] AS INT) AS DType
                            FROM dbo.Departments WHERE DepartmentID = @FromDept
                            UNION ALL
                            SELECT d.DepartmentID, TRY_CAST(d.${parentCol} AS INT), TRY_CAST(d.[Type] AS INT)
                            FROM dbo.Departments d INNER JOIN FromAnc a ON a.PID IS NOT NULL AND d.DepartmentID = a.PID
                            WHERE a.DType IS NULL OR a.DType <> 1
                        ),
                        FromRoot AS (
                            SELECT COALESCE(
                                (SELECT TOP 1 DepartmentID FROM FromAnc WHERE DType = 1),
                                @FromDept
                            ) AS RootDeptID
                        ),
                        DeptScope AS (
                            SELECT d.DepartmentID
                            FROM dbo.Departments d CROSS JOIN FromRoot r
                            WHERE d.DepartmentID = r.RootDeptID
                            UNION ALL
                            SELECT d.DepartmentID
                            FROM dbo.Departments d
                            INNER JOIN DeptScope t ON TRY_CAST(d.${parentCol} AS INT) IS NOT NULL
                                                   AND TRY_CAST(d.${parentCol} AS INT) = t.DepartmentID
                            WHERE TRY_CAST(d.[Type] AS INT) IS NULL OR TRY_CAST(d.[Type] AS INT) <> 1
                        )
                        SELECT
                            (SELECT RootDeptID FROM FromRoot) AS FromRoot,
                            CASE WHEN EXISTS(SELECT 1 FROM DeptScope WHERE DepartmentID = @ToDept)
                                 THEN 1 ELSE 0 END AS IsInScope
                        OPTION (MAXRECURSION 200)
                    `);
                const sc = scopeCheck.recordset[0] || {};
                if (!sc.IsInScope) {
                    return res.status(400).json({ message: 'المنصب المستهدف لا ينتمي لنفس القسم المستقل.' });
                }
            } else {
                // لا يوجد Type أو عمود أب — نقارن القسم المباشر
                if (String(deptRow.FromDept) !== String(deptRow.ToDept)) {
                    return res.status(400).json({ message: 'يجب أن يكون المنصبان في نفس القسم.' });
                }
            }
        }

        // إنشاء جدول السجل إن لم يكن موجوداً
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT 1 FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VacancyTransferLog'
            )
            CREATE TABLE dbo.VacancyTransferLog (
                LogID             INT           IDENTITY(1,1) PRIMARY KEY,
                TransferID        NVARCHAR(50)  NOT NULL,
                RequestedByUserID NVARCHAR(50)  NOT NULL,
                FromActorID       NVARCHAR(50)  NOT NULL,
                ToActorID         NVARCHAR(50)  NOT NULL,
                TablesAffected    NVARCHAR(MAX) NOT NULL,
                TotalAffected     INT           NOT NULL DEFAULT 0,
                IsUndone          BIT           NOT NULL DEFAULT 0,
                CreatedAt         DATETIME      NOT NULL DEFAULT GETDATE()
            )
        `);

        // فحص الأعمدة الموجودة دفعةً واحدة
        const sp = (await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Tasks','CreatedByVacancyID')   IS NOT NULL THEN 1 ELSE 0 END AS T_CrVac,
                CASE WHEN COL_LENGTH('dbo.Tasks','AssignedToVacancyID')  IS NOT NULL THEN 1 ELSE 0 END AS T_AsVac,
                CASE WHEN COL_LENGTH('dbo.Tasks','LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS T_LaVac,
                CASE WHEN COL_LENGTH('dbo.Tasks','CreatedBy')            IS NOT NULL THEN 1 ELSE 0 END AS T_Cr,
                CASE WHEN COL_LENGTH('dbo.Tasks','AssignedTo')           IS NOT NULL THEN 1 ELSE 0 END AS T_As,
                CASE WHEN COL_LENGTH('dbo.Subtasks','CreatedByVacancyID')   IS NOT NULL THEN 1 ELSE 0 END AS S_CrVac,
                CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedToVacancyID')  IS NOT NULL THEN 1 ELSE 0 END AS S_AsVac,
                CASE WHEN COL_LENGTH('dbo.Subtasks','LastActedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS S_LaVac,
                CASE WHEN COL_LENGTH('dbo.Subtasks','CreatedBy')            IS NOT NULL THEN 1 ELSE 0 END AS S_Cr,
                CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedTo')           IS NOT NULL THEN 1 ELSE 0 END AS S_As,
                CASE WHEN COL_LENGTH('dbo.Comments','CommentedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS C_CmVac,
                CASE WHEN COL_LENGTH('dbo.Comments','UserID')               IS NOT NULL THEN 1 ELSE 0 END AS C_UID,
                CASE WHEN OBJECT_ID('dbo.TaskAssignmentNotifications','U')  IS NOT NULL THEN 1 ELSE 0 END AS HasNotifs,
                CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS N_ToVac,
                CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedByVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS N_ByVac,
                CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedToUserID')    IS NOT NULL THEN 1 ELSE 0 END AS N_ToUsr,
                CASE WHEN COL_LENGTH('dbo.TaskAssignmentNotifications','AssignedByUserID')    IS NOT NULL THEN 1 ELSE 0 END AS N_ByUsr,
                CASE WHEN OBJECT_ID('dbo.TaskDelegations','U')              IS NOT NULL THEN 1 ELSE 0 END AS HasDeleg,
                CASE WHEN COL_LENGTH('dbo.TaskDelegations','DelegatorVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS D_OrVac,
                CASE WHEN COL_LENGTH('dbo.TaskDelegations','DelegateVacancyID')  IS NOT NULL THEN 1 ELSE 0 END AS D_EeVac,
                CASE WHEN COL_LENGTH('dbo.TaskDelegations','DelegatorUserID')    IS NOT NULL THEN 1 ELSE 0 END AS D_OrUsr,
                CASE WHEN COL_LENGTH('dbo.TaskDelegations','DelegateUserID')     IS NOT NULL THEN 1 ELSE 0 END AS D_EeUsr
        `)).recordset[0] || {};

        const isVac = schema.isVacancy;

        const targets = [];
        if (isVac) {
            if (sp.T_CrVac) targets.push(['Tasks',   'CreatedByVacancyID']);
            if (sp.T_AsVac) targets.push(['Tasks',   'AssignedToVacancyID']);
            if (sp.T_LaVac) targets.push(['Tasks',   'LastActedByVacancyID']);
            if (sp.S_CrVac) targets.push(['Subtasks','CreatedByVacancyID']);
            if (sp.S_AsVac) targets.push(['Subtasks','AssignedToVacancyID']);
            if (sp.S_LaVac) targets.push(['Subtasks','LastActedByVacancyID']);
            if (sp.C_CmVac) targets.push(['Comments','CommentedByVacancyID']);
            if (sp.HasNotifs && sp.N_ToVac) targets.push(['TaskAssignmentNotifications','AssignedToVacancyID']);
            if (sp.HasNotifs && sp.N_ByVac) targets.push(['TaskAssignmentNotifications','AssignedByVacancyID']);
            if (sp.HasDeleg  && sp.D_OrVac) targets.push(['TaskDelegations','DelegatorVacancyID']);
            if (sp.HasDeleg  && sp.D_EeVac) targets.push(['TaskDelegations','DelegateVacancyID']);
        } else {
            if (sp.T_Cr) targets.push(['Tasks',   'CreatedBy']);
            if (sp.T_As) targets.push(['Tasks',   'AssignedTo']);
            if (sp.S_Cr) targets.push(['Subtasks','CreatedBy']);
            if (sp.S_As) targets.push(['Subtasks','AssignedTo']);
            if (sp.C_UID) targets.push(['Comments','UserID']);
            if (sp.HasNotifs && sp.N_ToUsr) targets.push(['TaskAssignmentNotifications','AssignedToUserID']);
            if (sp.HasNotifs && sp.N_ByUsr) targets.push(['TaskAssignmentNotifications','AssignedByUserID']);
            if (sp.HasDeleg  && sp.D_OrUsr) targets.push(['TaskDelegations','DelegatorUserID']);
            if (sp.HasDeleg  && sp.D_EeUsr) targets.push(['TaskDelegations','DelegateUserID']);
        }

        const affectedCounts = {};
        let totalAffected = 0;

        for (const [table, col] of targets) {
            const r = pool.request();
            if (isVac) {
                r.input('From', sql.Int, parseInt(fromActorID));
                r.input('To',   sql.Int, parseInt(toActorID));
            } else {
                r.input('From', sql.NVarChar(50), fromActorID);
                r.input('To',   sql.NVarChar(50), toActorID);
            }
            const upd = await r.query(`UPDATE dbo.${table} SET ${col} = @To WHERE ${col} = @From`);
            const cnt = upd.rowsAffected?.[0] || 0;
            if (cnt > 0) {
                affectedCounts[`${table}.${col}`] = cnt;
                totalAffected += cnt;
            }
        }

        const transferId = crypto.randomUUID();

        await pool.request()
            .input('TransferID', sql.NVarChar(50), transferId)
            .input('UserID',     sql.NVarChar(50), UserID)
            .input('From',       sql.NVarChar(50), fromActorID)
            .input('To',         sql.NVarChar(50), toActorID)
            .input('Tables',     sql.NVarChar(sql.MAX), JSON.stringify(affectedCounts))
            .input('Total',      sql.Int, totalAffected)
            .query(`
                INSERT INTO dbo.VacancyTransferLog
                    (TransferID, RequestedByUserID, FromActorID, ToActorID, TablesAffected, TotalAffected)
                VALUES (@TransferID, @UserID, @From, @To, @Tables, @Total)
            `);

        res.status(200).json({
            message: 'تم نقل البيانات بنجاح',
            transferId,
            fromActorID,
            toActorID,
            affectedCounts,
            totalAffected,
        });

    } catch (error) {
        console.error('TRANSFER VACANCY ERROR:', error);
        res.status(500).json({ message: 'حدث خطأ أثناء نقل البيانات.' });
    }
};

// ---- التراجع عن نقل المنصب ----
exports.undoTransfer = async (req, res) => {
    const pool = req.app.locals.db;
    const { transferId, UserID } = req.body;

    if (!pool) return res.status(503).json({ message: 'Database not available.' });
    if (!transferId || !UserID) return res.status(400).json({ message: 'transferId and UserID are required.' });

    try {
        const tableCheck = await pool.request().query(`
            SELECT CASE WHEN OBJECT_ID('dbo.VacancyTransferLog','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTable
        `);
        if (!tableCheck.recordset[0]?.HasTable) {
            return res.status(404).json({ message: 'لا يوجد سجل نقل.' });
        }

        const logResult = await pool.request()
            .input('TransferID', sql.NVarChar(50), transferId)
            .input('UserID',     sql.NVarChar(50), UserID)
            .query(`
                SELECT * FROM dbo.VacancyTransferLog
                WHERE TransferID = @TransferID
                  AND RequestedByUserID = @UserID
                  AND IsUndone = 0
            `);

        const log = logResult.recordset[0];
        if (!log) return res.status(404).json({ message: 'لم يتم العثور على سجل النقل أو تم التراجع مسبقاً.' });

        const { FromActorID, ToActorID, TablesAffected } = log;
        let affectedMap = {};
        try { affectedMap = JSON.parse(TablesAffected); } catch { /* ignore */ }

        const schema = await detectSchema(pool);
        const isVac = schema.isVacancy;

        const restoredCounts = {};
        for (const tableCol of Object.keys(affectedMap)) {
            const dotIdx = tableCol.indexOf('.');
            const table  = tableCol.substring(0, dotIdx);
            const col    = tableCol.substring(dotIdx + 1);
            const r = pool.request();
            // مُعكَّس: من ToActorID → FromActorID
            if (isVac) {
                r.input('From', sql.Int, parseInt(ToActorID));
                r.input('To',   sql.Int, parseInt(FromActorID));
            } else {
                r.input('From', sql.NVarChar(50), ToActorID);
                r.input('To',   sql.NVarChar(50), FromActorID);
            }
            const upd = await r.query(`UPDATE dbo.${table} SET ${col} = @To WHERE ${col} = @From`);
            const cnt = upd.rowsAffected?.[0] || 0;
            if (cnt > 0) restoredCounts[tableCol] = cnt;
        }

        await pool.request()
            .input('TransferID', sql.NVarChar(50), transferId)
            .query(`UPDATE dbo.VacancyTransferLog SET IsUndone = 1 WHERE TransferID = @TransferID`);

        res.status(200).json({
            message: 'تم التراجع بنجاح',
            restoredCounts,
            totalRestored: Object.values(restoredCounts).reduce((a, b) => a + b, 0),
        });

    } catch (error) {
        console.error('UNDO TRANSFER ERROR:', error);
        res.status(500).json({ message: 'حدث خطأ أثناء التراجع.' });
    }
};
