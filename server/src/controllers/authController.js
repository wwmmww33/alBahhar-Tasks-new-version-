// src/controllers/authController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');

// في authController.js

// في authController.js

exports.login = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, password } = req.body;

    // --- تحقق إضافي ---
    if (!pool) {
        return res.status(503).send({ message: 'Database connection is not available.' });
    }

    if (!userId || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const normalizedUserId = String(userId).trim();

        const schemaProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID')       IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
                CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V')   IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
                CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID')       IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
                CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID')          IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID,
                CASE WHEN OBJECT_ID('dbo.Assignments','U')              IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
                CASE WHEN OBJECT_ID('dbo.JobVacancies','U')             IS NOT NULL THEN 1 ELSE 0 END AS HasJobVacancies
        `);

        const sp = schemaProbe.recordset[0] || {};
        const hasUsersDepartmentID = !!sp.HasUsersDepartmentID;
        const hasProfileView       = !!sp.HasProfileView;
        const hasLegacyUserID      = !!sp.HasLegacyUserID;
        const hasServiceID         = !!sp.HasServiceID;
        const hasAssignments       = !!sp.HasAssignments;
        const hasJobVacancies      = !!sp.HasJobVacancies;

        const loginWhereParts = [
            `LTRIM(RTRIM(u.UserID)) = @LoginID`
        ];
        if (hasLegacyUserID) {
            loginWhereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
        }
        if (hasServiceID) {
            loginWhereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);
        }
        const loginWhere = loginWhereParts.join(' OR ');

        let userQuery;
        if (hasUsersDepartmentID) {
            userQuery = `
                SELECT u.*, d.Name as DepartmentName
                FROM Users u
                LEFT JOIN Departments d ON u.DepartmentID = d.DepartmentID
                WHERE ${loginWhere}
            `;
        } else if (hasProfileView) {
            userQuery = `
                SELECT
                    u.*, 
                    p.DepartmentID,
                    p.DepartmentName,
                    p.VacancyID,
                    p.VacancyName,
                    p.VacancyType,
                    p.AssignmentID,
                    p.AssignmentStartDate
                FROM Users u
                LEFT JOIN vw_UserCurrentProfile p ON p.UserID = u.UserID
                WHERE ${loginWhere}
            `;
        } else if (hasAssignments && hasJobVacancies) {
            userQuery = `
                SELECT u.*,
                       v.DepartmentID,
                       d.Name  AS DepartmentName,
                       v.VacancyID,
                       v.Name  AS VacancyName
                FROM Users u
                LEFT JOIN Assignments  a  ON a.UserID    = u.UserID AND a.IsCurrent = 1
                LEFT JOIN JobVacancies v  ON v.VacancyID = a.VacancyID
                LEFT JOIN Departments  d  ON d.DepartmentID = v.DepartmentID
                WHERE ${loginWhere}
            `;
        } else {
            userQuery = `
                SELECT u.*
                FROM Users u
                WHERE ${loginWhere}
            `;
        }

        const result = await pool.request()
            .input('LoginID', sql.NVarChar, normalizedUserId)
            .query(userQuery);

        const user = result.recordset[0];

        if (!user) { return res.status(404).json({ message: 'المستخدم غير موجود.' }); }
        if (!user.IsActive) { return res.status(403).json({ message: 'هذا الحساب موقوف.' }); }

        const isValidPassword = encryptionConfig.verifyPassword(password, user.PasswordHash);
        if (!isValidPassword) { return res.status(401).json({ message: 'كلمة المرور غير صحيحة.' }); }

        // جلب الدور من UserRoles (دفاعي)
        let userRole = 0;
        try {
            const hasRolesTable = await pool.request().query(
                `SELECT CASE WHEN OBJECT_ID('dbo.UserRoles','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTable`
            );
            if (hasRolesTable.recordset[0]?.HasTable) {
                const roleRes = await pool.request()
                    .input('UserID', sql.NVarChar, user.UserID)
                    .query(`SELECT TOP 1 Role FROM dbo.UserRoles WHERE UserID = @UserID`);
                userRole = roleRes.recordset[0]?.Role ?? 0;
            }
        } catch (_) {}

        const { PasswordHash, ...userWithoutPassword } = user;
        res.status(200).json({
            message: 'Login successful',
            user: { ...userWithoutPassword, Role: userRole, IsAdmin: userRole === 1 },
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);
        res.status(500).send({ message: 'Server error during login' });
    }
};
exports.registerRequest = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, password, fullName, departmentId, vacancyName, rank } = req.body;
    try {
        const hashed = encryptionConfig.hashPassword(password).combined;

        const probe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.RegistrationRequests','VacancyName') IS NOT NULL THEN 1 ELSE 0 END AS HasVacancyName,
                CASE WHEN COL_LENGTH('dbo.RegistrationRequests','Rank')        IS NOT NULL THEN 1 ELSE 0 END AS HasRank,
                ISNULL(
                    (SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_NAME='RegistrationRequests' AND COLUMN_NAME='Rank'),
                    ''
                ) AS RankDataType
        `);
        const s = probe.recordset[0] || {};
        const rankColIsNumeric = ['int','bigint','smallint','tinyint','numeric','decimal'].includes(
            (s.RankDataType || '').toLowerCase()
        );

        const cols = ['UserID', 'PasswordHash', 'FullName', 'DepartmentID'];
        const vals = ['@UserID', '@PasswordHash', '@FullName', '@DepartmentID'];
        const reqq = pool.request()
            .input('UserID', sql.NVarChar, userId)
            .input('PasswordHash', sql.NVarChar, hashed)
            .input('FullName', sql.NVarChar, fullName)
            .input('DepartmentID', sql.Int, departmentId);

        if (s.HasVacancyName && vacancyName && String(vacancyName).trim()) {
            cols.push('VacancyName');
            vals.push('@VacancyName');
            reqq.input('VacancyName', sql.NVarChar, String(vacancyName).trim());
        }
        if (s.HasRank && rank && String(rank).trim()) {
            if (rankColIsNumeric) {
                // نبحث عن RankID من جدول Ranks بالاسم
                const rankLookup = await pool.request()
                    .input('RankLabel', sql.NVarChar, String(rank).trim())
                    .query(`SELECT TOP 1 RankID FROM dbo.Ranks
                            WHERE Name = @RankLabel OR RankName = @RankLabel`).catch(() => null);
                const rankId = rankLookup?.recordset[0]?.RankID ?? null;
                if (rankId != null) {
                    cols.push('Rank');
                    vals.push('@Rank');
                    reqq.input('Rank', sql.Int, rankId);
                }
            } else {
                cols.push('Rank');
                vals.push('@Rank');
                reqq.input('Rank', sql.NVarChar, String(rank).trim());
            }
        }

        await reqq.query(`INSERT INTO RegistrationRequests (${cols.join(',')}) VALUES (${vals.join(',')})`);
        res.status(201).json({ message: 'Registration request submitted successfully. Waiting for admin approval.' });
    } catch (error) {
        console.error('REGISTER ERROR:', error);
        res.status(500).send({ message: 'Failed to submit registration request' });
    }
};
