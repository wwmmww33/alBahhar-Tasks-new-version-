// src/controllers/profileController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { detectSchema } = require('../utils/vacancyResolver');

// بناء جملة SELECT للملف الشخصي حسب المخطط الحالي.
// يعيد الاستعلام بدون شرط إضافي على IsActive — يضاف من المستدعي إن لزم.
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

// تحديث الملف الشخصي للمستخدم
exports.updateProfile = async (req, res) => {
    const pool = req.app.locals.db;
    const { UserID, FullName, DepartmentID, PasswordHash, CurrentPassword } = req.body;

    if (!pool) {
        return res.status(503).send({ message: 'Database connection is not available.' });
    }

    if (!UserID || !FullName) {
        return res.status(400).json({ message: 'UserID and FullName are required.' });
    }

    try {
        const schema = await detectSchema(pool);

        // إذا كان المستخدم يريد تغيير كلمة المرور، نتحقق من كلمة المرور الحالية
        if (PasswordHash) {
            if (!CurrentPassword) {
                return res.status(400).json({ message: 'Current password is required to change password.' });
            }

            const currentUserResult = await pool.request()
                .input('UserID', sql.NVarChar, UserID)
                .query('SELECT PasswordHash FROM Users WHERE UserID = @UserID');

            const currentUser = currentUserResult.recordset[0];
            if (!currentUser) {
                return res.status(404).json({ message: 'User not found.' });
            }

            const isValidCurrent = encryptionConfig.verifyPassword(CurrentPassword, currentUser.PasswordHash);
            if (!isValidCurrent) {
                return res.status(401).json({ message: 'Current password is incorrect.' });
            }
        }

        // بناء UPDATE ديناميكياً — لا نُلامس DepartmentID إذا كان غير موجود في المخطط
        const setParts = ['FullName = @FullName'];
        const request = pool.request()
            .input('UserID', sql.NVarChar, UserID)
            .input('FullName', sql.NVarChar, FullName);

        if (schema.hasUsersDepartmentID && DepartmentID != null) {
            setParts.push('DepartmentID = @DepartmentID');
            request.input('DepartmentID', sql.Int, DepartmentID);
        }

        if (PasswordHash) {
            const hashed = encryptionConfig.hashPassword(PasswordHash).combined;
            setParts.push('PasswordHash = @PasswordHash');
            request.input('PasswordHash', sql.NVarChar, hashed);
        }

        const updateSql = `UPDATE Users SET ${setParts.join(', ')} WHERE UserID = @UserID`;
        await request.query(updateSql);

        // جلب البيانات المحدّثة مع اسم القسم عبر القالب الملائم للمخطط
        const updatedUserResult = await pool.request()
            .input('UserID', sql.NVarChar, UserID)
            .query(buildProfileSelectSQL(schema));

        const updatedUser = updatedUserResult.recordset[0];
        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found after update.' });
        }

        res.status(200).json({
            message: 'Profile updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('UPDATE PROFILE ERROR:', error);
        res.status(500).send({ message: 'Error updating profile' });
    }
};

// جلب معلومات الملف الشخصي
exports.getProfile = async (req, res) => {
    const pool = req.app.locals.db;
    const { userId } = req.params;

    if (!pool) {
        return res.status(503).send({ message: 'Database connection is not available.' });
    }

    try {
        const schema = await detectSchema(pool);
        const baseSql = buildProfileSelectSQL(schema);
        const finalSql = baseSql + ' AND u.IsActive = 1';

        const result = await pool.request()
            .input('UserID', sql.NVarChar, userId)
            .query(finalSql);

        const user = result.recordset[0];
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.status(200).json(user);

    } catch (error) {
        console.error('GET PROFILE ERROR:', error);
        res.status(500).send({ message: 'Error fetching profile' });
    }
};
