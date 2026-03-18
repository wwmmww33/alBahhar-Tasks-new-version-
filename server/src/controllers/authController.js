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
                CASE WHEN COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasUsersDepartmentID,
                CASE WHEN OBJECT_ID('dbo.vw_UserCurrentProfile', 'V') IS NOT NULL THEN 1 ELSE 0 END AS HasProfileView,
                CASE WHEN COL_LENGTH('dbo.Users', 'LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
                CASE WHEN COL_LENGTH('dbo.Users', 'ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID
        `);

        const hasUsersDepartmentID = !!(schemaProbe.recordset[0] && schemaProbe.recordset[0].HasUsersDepartmentID);
        const hasProfileView = !!(schemaProbe.recordset[0] && schemaProbe.recordset[0].HasProfileView);
        const hasLegacyUserID = !!(schemaProbe.recordset[0] && schemaProbe.recordset[0].HasLegacyUserID);
        const hasServiceID = !!(schemaProbe.recordset[0] && schemaProbe.recordset[0].HasServiceID);

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
        
        const { PasswordHash, ...userWithoutPassword } = user;
        res.status(200).json({ message: 'Login successful', user: userWithoutPassword });

    } catch (error) {
        console.error("LOGIN ERROR:", error);
        res.status(500).send({ message: 'Server error during login' });
    }
};
exports.registerRequest = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId, password, fullName, departmentId } = req.body;
    try {
        const hashed = encryptionConfig.hashPassword(password).combined;
        await pool.request()
            .input('UserID', sql.NVarChar, userId)
            .input('PasswordHash', sql.NVarChar, hashed)
            .input('FullName', sql.NVarChar, fullName)
            .input('DepartmentID', sql.Int, departmentId)
            .query('INSERT INTO RegistrationRequests (UserID, PasswordHash, FullName, DepartmentID) VALUES (@UserID, @PasswordHash, @FullName, @DepartmentID)');
        res.status(201).json({ message: 'Registration request submitted successfully. Waiting for admin approval.' });
    } catch (error) { res.status(500).send({ message: 'Failed to submit registration request' }); }
};
