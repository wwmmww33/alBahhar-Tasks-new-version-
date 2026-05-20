const sql = require('mssql');
const dbConfig = require('../config/db.config');
const encryptionConfig = require('../config/encryption.config');
const { detectSchema, resolveVacancyId, ensureVacancyId } = require('../utils/vacancyResolver');

// أفضّل استخدام pool المُجمَّع من req.app.locals.db، وإلا نقع على sql.connect(dbConfig)
async function getPool(req) {
    if (req && req.app && req.app.locals && req.app.locals.db) {
        return req.app.locals.db;
    }
    return await sql.connect(dbConfig);
}

// بناء JOIN لعمود CreatedBy (Users في المخطط القديم، JobVacancies في الجديد)
function identityJoinForCreatedBy(schema, cteAlias, column) {
    if (schema.isVacancy) {
        return `LEFT JOIN JobVacancies jv_${cteAlias} ON ${cteAlias}.${column} = jv_${cteAlias}.VacancyID`;
    }
    return `LEFT JOIN Users u_${cteAlias} ON ${cteAlias}.${column} = u_${cteAlias}.UserID`;
}
function identityNameForCreatedBy(schema, cteAlias) {
    return schema.isVacancy
        ? `jv_${cteAlias}.Name`
        : `u_${cteAlias}.FullName`;
}

// حلّ قيمة CreatedBy المستخدمة حسب المخطط (int VacancyID أو nvarchar UserID)
async function resolveCreatedByValue(pool, req, bodyCreatedBy, schema) {
    const rawUserId = (req && req.user && req.user.userId) || bodyCreatedBy || 'admin';
    if (!schema.isVacancy) {
        return { value: rawUserId, type: sql.NVarChar(50), isVacancy: false };
    }
    // إن كان لدينا req.user.vacancyId جاهز من middleware استخدمه مباشرة
    let vid = (req && req.user && req.user.vacancyId) || null;
    if (vid == null) {
        vid = await resolveVacancyId(pool, rawUserId);
    }
    return { value: vid, type: sql.Int, isVacancy: true };
}

// الحصول على جميع التصنيفات لوحدة معين (جميع الأقسام التابعة لها)
const getCategoriesByDepartment = async (req, res) => {
    try {
        const { departmentId } = req.params;
        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const deptProbe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Departments', 'ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDepartmentID,
                CASE WHEN COL_LENGTH('dbo.Departments', 'ParentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentID,
                CASE WHEN COL_LENGTH('dbo.Departments', 'Type') IS NOT NULL THEN 1 ELSE 0 END AS HasDeptType
        `);
        const dp = deptProbe.recordset[0] || {};
        const parentCol = dp.HasParentDepartmentID ? 'ParentDepartmentID' : (dp.HasParentID ? 'ParentID' : null);

        const createdByJoin = identityJoinForCreatedBy(schema, 'c', 'CreatedBy');
        const createdByName = identityNameForCreatedBy(schema, 'c');

        const request = pool.request().input('DepartmentID', sql.Int, parseInt(departmentId, 10));
        let query;

        if (parentCol) {
            const typeGuard = dp.HasDeptType
                ? `AND (TRY_CAST(d.[Type] AS INT) <> 0 OR d.[Type] IS NULL)`
                : '';
            query = `
                WITH UpTree AS (
                    SELECT DepartmentID, ${parentCol} AS PID, 0 AS Depth
                    FROM dbo.Departments WHERE DepartmentID = @DepartmentID
                    UNION ALL
                    SELECT d.DepartmentID, d.${parentCol}, u.Depth + 1
                    FROM dbo.Departments d
                    INNER JOIN UpTree u ON d.DepartmentID = u.PID
                    WHERE TRY_CAST(d.[Type] AS INT) <> 0 OR d.[Type] IS NULL
                ),
                RootDept AS (
                    SELECT TOP 1 DepartmentID AS RootDepartmentID
                    FROM UpTree ORDER BY Depth DESC
                ),
                DeptScope AS (
                    SELECT d.DepartmentID
                    FROM dbo.Departments d CROSS JOIN RootDept r
                    WHERE d.DepartmentID = r.RootDepartmentID
                    UNION ALL
                    SELECT d.DepartmentID
                    FROM dbo.Departments d
                    INNER JOIN DeptScope ds ON d.${parentCol} = ds.DepartmentID
                    ${typeGuard}
                )
                SELECT
                    c.CategoryID, c.Name, c.Description, c.DepartmentID,
                    c.CreatedBy, c.CreatedAt, c.UpdatedAt, c.IsActive,
                    ${createdByName} as CreatedByName,
                    dep.Name as DepartmentName
                FROM Categories c
                ${createdByJoin}
                LEFT JOIN Departments dep ON c.DepartmentID = dep.DepartmentID
                WHERE c.DepartmentID IN (SELECT DepartmentID FROM DeptScope)
                    AND c.IsActive = 1
                ORDER BY c.Name
                OPTION (MAXRECURSION 100)
            `;
        } else {
            query = `
                SELECT
                    c.CategoryID, c.Name, c.Description, c.DepartmentID,
                    c.CreatedBy, c.CreatedAt, c.UpdatedAt, c.IsActive,
                    ${createdByName} as CreatedByName,
                    dep.Name as DepartmentName
                FROM Categories c
                ${createdByJoin}
                LEFT JOIN Departments dep ON c.DepartmentID = dep.DepartmentID
                WHERE c.DepartmentID = @DepartmentID AND c.IsActive = 1
                ORDER BY c.Name
            `;
        }

        const result = await request.query(query);
        const categories = result.recordset.map(c => {
            if (c.Description) { try { c.Description = encryptionConfig.decrypt(c.Description); } catch (e) {} }
            return c;
        });
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'خطأ في جلب التصنيفات' });
    }
};

// الحصول على تصنيف واحد مع معلوماته
const getCategoryById = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const catJoin = identityJoinForCreatedBy(schema, 'c', 'CreatedBy');
        const catName = identityNameForCreatedBy(schema, 'c');
        const infoJoin = identityJoinForCreatedBy(schema, 'ci', 'CreatedBy');
        const infoName = identityNameForCreatedBy(schema, 'ci');

        const categoryResult = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query(`
                SELECT
                    c.CategoryID,
                    c.Name,
                    c.Description,
                    c.DepartmentID,
                    c.CreatedBy,
                    c.CreatedAt,
                    c.UpdatedAt,
                    c.IsActive,
                    ${catName} as CreatedByName,
                    d.Name as DepartmentName
                FROM Categories c
                ${catJoin}
                LEFT JOIN Departments d ON c.DepartmentID = d.DepartmentID
                WHERE c.CategoryID = @CategoryID AND c.IsActive = 1
            `);

        if (categoryResult.recordset.length === 0) {
            return res.status(404).json({ error: 'التصنيف غير موجود' });
        }

        const infoResult = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query(`
                SELECT
                    ci.InfoID,
                    ci.CategoryID,
                    ci.Title,
                    ci.Content,
                    ci.OrderIndex,
                    ci.CreatedBy,
                    ci.CreatedAt,
                    ci.UpdatedAt,
                    ci.IsActive,
                    ${infoName} as CreatedByName
                FROM CategoryInformation ci
                ${infoJoin}
                WHERE ci.CategoryID = @CategoryID AND ci.IsActive = 1
                ORDER BY ci.OrderIndex, ci.CreatedAt
            `);

        const category = categoryResult.recordset[0];
        if (category.Description) { try { category.Description = encryptionConfig.decrypt(category.Description); } catch (e) {} }
        category.information = infoResult.recordset.map(i => {
            if (i.Content) { try { i.Content = encryptionConfig.decrypt(i.Content); } catch (e) {} }
            return i;
        });

        res.json(category);
    } catch (error) {
        console.error('Error fetching category:', error);
        res.status(500).json({ error: 'خطأ في جلب التصنيف' });
    }
};

// إنشاء تصنيف جديد
const createCategory = async (req, res) => {
    try {
        const { name, description, departmentId, createdBy: createdByBody } = req.body;

        if (!name || !departmentId) {
            return res.status(400).json({ error: 'اسم التصنيف والقسم مطلوبان' });
        }

        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const createdByRes = await resolveCreatedByValue(pool, req, createdByBody, schema);
        if (schema.isVacancy && createdByRes.value == null) {
            return res.status(400).json({ error: 'تعذّر تحديد المنصب (VacancyID) للمنشئ.' });
        }

        // التحقق من عدم وجود تصنيف بنفس الاسم في نفس القسم
        const existingCategory = await pool.request()
            .input('Name', sql.NVarChar(100), name)
            .input('DepartmentID', sql.Int, departmentId)
            .query(`
                SELECT CategoryID FROM Categories
                WHERE Name = @Name AND DepartmentID = @DepartmentID AND IsActive = 1
            `);

        if (existingCategory.recordset.length > 0) {
            return res.status(400).json({ error: 'يوجد تصنيف بنفس الاسم في هذا القسم' });
        }

        const encryptedDescription = description ? encryptionConfig.encrypt(description) : null;
        const result = await pool.request()
            .input('Name', sql.NVarChar(100), name)
            .input('Description', sql.NVarChar(sql.MAX), encryptedDescription)
            .input('DepartmentID', sql.Int, departmentId)
            .input('CreatedBy', createdByRes.type, createdByRes.value)
            .query(`
                INSERT INTO Categories (Name, Description, DepartmentID, CreatedBy, IsActive, CreatedAt)
                OUTPUT INSERTED.CategoryID
                VALUES (@Name, @Description, @DepartmentID, @CreatedBy, 1, GETDATE())
            `);

        const categoryId = result.recordset[0].CategoryID;

        const catJoin = identityJoinForCreatedBy(schema, 'c', 'CreatedBy');
        const catName = identityNameForCreatedBy(schema, 'c');

        const newCategory = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query(`
                SELECT
                    c.CategoryID, c.Name, c.Description, c.DepartmentID,
                    c.CreatedBy, c.CreatedAt, c.UpdatedAt, c.IsActive,
                    ${catName} as CreatedByName,
                    d.Name as DepartmentName
                FROM Categories c
                ${catJoin}
                LEFT JOIN Departments d ON c.DepartmentID = d.DepartmentID
                WHERE c.CategoryID = @CategoryID
            `);
        const createdCat = newCategory.recordset[0];
        if (createdCat.Description) { try { createdCat.Description = encryptionConfig.decrypt(createdCat.Description); } catch (e) {} }
        res.status(201).json(createdCat);
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ error: 'خطأ في إنشاء التصنيف' });
    }
};

// تحديث تصنيف
const updateCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'اسم التصنيف مطلوب' });
        }

        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        // التحقق من وجود التصنيف
        const existingCategory = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('SELECT CategoryID, DepartmentID, CreatedBy FROM Categories WHERE CategoryID = @CategoryID AND IsActive = 1');

        if (existingCategory.recordset.length === 0) {
            return res.status(404).json({ error: 'التصنيف غير موجود' });
        }

        // التحقق من عدم وجود تصنيف آخر بنفس الاسم في نفس القسم
        const duplicateCategory = await pool.request()
            .input('Name', sql.NVarChar(100), name)
            .input('DepartmentID', sql.Int, existingCategory.recordset[0].DepartmentID)
            .input('CategoryID', sql.Int, categoryId)
            .query(`
                SELECT CategoryID FROM Categories
                WHERE Name = @Name AND DepartmentID = @DepartmentID AND CategoryID != @CategoryID AND IsActive = 1
            `);

        if (duplicateCategory.recordset.length > 0) {
            return res.status(400).json({ error: 'يوجد تصنيف بنفس الاسم في هذا القسم' });
        }

        await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .input('Name', sql.NVarChar(100), name)
            .input('Description', sql.NVarChar(sql.MAX), description ? encryptionConfig.encrypt(description) : null)
            .query(`
                UPDATE Categories
                SET Name = @Name, Description = @Description, UpdatedAt = GETDATE()
                WHERE CategoryID = @CategoryID
            `);

        const catJoin = identityJoinForCreatedBy(schema, 'c', 'CreatedBy');
        const catName = identityNameForCreatedBy(schema, 'c');

        const updatedCategory = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query(`
                SELECT
                    c.CategoryID, c.Name, c.Description, c.DepartmentID,
                    c.CreatedBy, c.CreatedAt, c.UpdatedAt, c.IsActive,
                    ${catName} as CreatedByName,
                    d.Name as DepartmentName
                FROM Categories c
                ${catJoin}
                LEFT JOIN Departments d ON c.DepartmentID = d.DepartmentID
                WHERE c.CategoryID = @CategoryID
            `);
        const updatedCat = updatedCategory.recordset[0];
        if (updatedCat.Description) { try { updatedCat.Description = encryptionConfig.decrypt(updatedCat.Description); } catch (e) {} }
        res.json(updatedCat);
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ error: 'خطأ في تحديث التصنيف' });
    }
};

// حذف تصنيف (حذف منطقي) مع دعم إعادة تعيين المهام أو جعلها بلا تصنيف
const deleteCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { createdBy, action, newCategoryId } = req.body || {};

        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const existingCategory = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('SELECT CategoryID, CreatedBy, DepartmentID FROM Categories WHERE CategoryID = @CategoryID AND IsActive = 1');

        if (existingCategory.recordset.length === 0) {
            return res.status(404).json({ error: 'التصنيف غير موجود' });
        }

        const createdByRes = await resolveCreatedByValue(pool, req, createdBy, schema);
        const ownerDb = existingCategory.recordset[0].CreatedBy;
        const isOwner = schema.isVacancy
            ? parseInt(ownerDb, 10) === parseInt(createdByRes.value, 10)
            : String(ownerDb).trim() === String(createdByRes.value).trim();

        if (!isOwner) {
            return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا التصنيف' });
        }

        const linkedTasks = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('SELECT COUNT(*) as TaskCount FROM Tasks WHERE CategoryID = @CategoryID');

        const taskCount = linkedTasks.recordset[0].TaskCount;
        if (taskCount > 0) {
            if (action === 'reassign') {
                if (!newCategoryId) {
                    return res.status(400).json({ error: 'معرّف التصنيف الجديد مطلوب لإعادة التعيين', taskCount });
                }
                const targetCat = await pool.request()
                    .input('NewCategoryID', sql.Int, newCategoryId)
                    .query('SELECT CategoryID, DepartmentID FROM Categories WHERE CategoryID = @NewCategoryID AND IsActive = 1');
                if (targetCat.recordset.length === 0) {
                    return res.status(404).json({ error: 'التصنيف الهدف غير موجود', taskCount });
                }
                const sourceDept = existingCategory.recordset[0].DepartmentID;
                const targetDept = targetCat.recordset[0].DepartmentID;
                if (sourceDept !== targetDept) {
                    return res.status(400).json({ error: 'يجب أن يكون التصنيف الهدف ضمن نفس القسم', taskCount });
                }
                await pool.request()
                    .input('OldCategoryID', sql.Int, categoryId)
                    .input('NewCategoryID', sql.Int, newCategoryId)
                    .query('UPDATE Tasks SET CategoryID = @NewCategoryID WHERE CategoryID = @OldCategoryID');
            } else if (action === 'uncategorize') {
                await pool.request()
                    .input('OldCategoryID', sql.Int, categoryId)
                    .query('UPDATE Tasks SET CategoryID = NULL WHERE CategoryID = @OldCategoryID');
            } else {
                return res.status(409).json({ error: 'يوجد مهام مرتبطة بهذا التصنيف. اختر إعادة تعيين أو جعله بلا تصنيف.', taskCount });
            }
        }

        await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('UPDATE Categories SET IsActive = 0, UpdatedAt = GETDATE() WHERE CategoryID = @CategoryID');

        await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('UPDATE CategoryInformation SET IsActive = 0, UpdatedAt = GETDATE() WHERE CategoryID = @CategoryID');

        res.json({ message: 'تم حذف التصنيف بنجاح', reassignedTasks: taskCount });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ error: 'خطأ في حذف التصنيف' });
    }
};

// عدد المهام المرتبطة بتصنيف
const getLinkedTaskCount = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const pool = await getPool(req);
        const result = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('SELECT COUNT(*) as TaskCount FROM Tasks WHERE CategoryID = @CategoryID');
        const count = result.recordset[0]?.TaskCount || 0;
        res.json({ taskCount: count });
    } catch (error) {
        console.error('Error fetching linked task count:', error);
        res.status(500).json({ error: 'خطأ في جلب عدد المهام المرتبطة' });
    }
};

// إضافة معلومة جديدة لتصنيف
const addCategoryInformation = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { title, content, orderIndex, createdBy } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'المحتوى مطلوب' });
        }

        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const createdByRes = await resolveCreatedByValue(pool, req, createdBy, schema);
        if (schema.isVacancy && createdByRes.value == null) {
            return res.status(400).json({ error: 'تعذّر تحديد المنصب (VacancyID) للمنشئ.' });
        }

        const existingCategory = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query('SELECT CategoryID FROM Categories WHERE CategoryID = @CategoryID AND IsActive = 1');

        if (existingCategory.recordset.length === 0) {
            return res.status(404).json({ error: 'التصنيف غير موجود' });
        }

        const encryptedContent = content ? encryptionConfig.encrypt(content) : null;
        const result = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .input('Title', sql.NVarChar(200), title)
            .input('Content', sql.NVarChar(sql.MAX), encryptedContent)
            .input('OrderIndex', sql.Int, orderIndex || 0)
            .input('CreatedBy', createdByRes.type, createdByRes.value)
            .query(`
                INSERT INTO CategoryInformation (CategoryID, Title, Content, OrderIndex, CreatedBy, IsActive, CreatedAt)
                OUTPUT INSERTED.InfoID
                VALUES (@CategoryID, @Title, @Content, @OrderIndex, @CreatedBy, 1, GETDATE())
            `);

        const infoId = result.recordset[0].InfoID;
        const infoJoin = identityJoinForCreatedBy(schema, 'ci', 'CreatedBy');
        const infoName = identityNameForCreatedBy(schema, 'ci');

        const newInfo = await pool.request()
            .input('InfoID', sql.Int, infoId)
            .query(`
                SELECT
                    ci.InfoID, ci.CategoryID, ci.Title, ci.Content, ci.OrderIndex,
                    ci.CreatedBy, ci.CreatedAt, ci.UpdatedAt, ci.IsActive,
                    ${infoName} as CreatedByName
                FROM CategoryInformation ci
                ${infoJoin}
                WHERE ci.InfoID = @InfoID
            `);
        const info = newInfo.recordset[0];
        if (info && info.Content) { try { info.Content = encryptionConfig.decrypt(info.Content); } catch (e) {} }
        res.status(201).json(info);
    } catch (error) {
        console.error('Error adding category information:', error);
        res.status(500).json({ error: 'خطأ في إضافة معلومة التصنيف' });
    }
};

// تحديث معلومة تصنيف
const updateCategoryInformation = async (req, res) => {
    try {
        const { infoId } = req.params;
        const { title, content, orderIndex } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'المحتوى مطلوب' });
        }

        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const existingInfo = await pool.request()
            .input('InfoID', sql.Int, infoId)
            .query(`
                SELECT ci.InfoID, ci.CategoryID
                FROM CategoryInformation ci
                JOIN Categories c ON ci.CategoryID = c.CategoryID
                WHERE ci.InfoID = @InfoID AND ci.IsActive = 1 AND c.IsActive = 1
            `);

        if (existingInfo.recordset.length === 0) {
            return res.status(404).json({ error: 'المعلومة غير موجودة' });
        }

        const encryptedUpdateContent = content ? encryptionConfig.encrypt(content) : null;
        await pool.request()
            .input('InfoID', sql.Int, infoId)
            .input('Title', sql.NVarChar(200), title)
            .input('Content', sql.NVarChar(sql.MAX), encryptedUpdateContent)
            .input('OrderIndex', sql.Int, orderIndex || 0)
            .query(`
                UPDATE CategoryInformation
                SET Title = @Title, Content = @Content, OrderIndex = @OrderIndex, UpdatedAt = GETDATE()
                WHERE InfoID = @InfoID
            `);

        const infoJoin = identityJoinForCreatedBy(schema, 'ci', 'CreatedBy');
        const infoName = identityNameForCreatedBy(schema, 'ci');

        const updatedInfo = await pool.request()
            .input('InfoID', sql.Int, infoId)
            .query(`
                SELECT
                    ci.InfoID, ci.CategoryID, ci.Title, ci.Content, ci.OrderIndex,
                    ci.CreatedBy, ci.CreatedAt, ci.UpdatedAt, ci.IsActive,
                    ${infoName} as CreatedByName
                FROM CategoryInformation ci
                ${infoJoin}
                WHERE ci.InfoID = @InfoID
            `);
        const updated = updatedInfo.recordset[0];
        if (updated && updated.Content) { try { updated.Content = encryptionConfig.decrypt(updated.Content); } catch (e) {} }
        res.json(updated);
    } catch (error) {
        console.error('Error updating category information:', error);
        res.status(500).json({ error: 'خطأ في تحديث معلومة التصنيف' });
    }
};

// حذف معلومة تصنيف (يُسمح فقط لمن أنشأها)
const deleteCategoryInformation = async (req, res) => {
    try {
        const { infoId } = req.params;
        const { createdBy } = req.body || {};
        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const existingInfo = await pool.request()
            .input('InfoID', sql.Int, infoId)
            .query('SELECT InfoID, CreatedBy FROM CategoryInformation WHERE InfoID = @InfoID AND IsActive = 1');

        if (existingInfo.recordset.length === 0) {
            return res.status(404).json({ error: 'المعلومة غير موجودة' });
        }

        const createdByRes = await resolveCreatedByValue(pool, req, createdBy, schema);
        const ownerDb = existingInfo.recordset[0].CreatedBy;
        const isOwner = schema.isVacancy
            ? parseInt(ownerDb, 10) === parseInt(createdByRes.value, 10)
            : String(ownerDb).trim() === String(createdByRes.value).trim();

        if (!isOwner) {
            return res.status(403).json({ error: 'لا يمكنك حذف معلومة أضافها شخص آخر' });
        }

        await pool.request()
            .input('InfoID', sql.Int, infoId)
            .query('UPDATE CategoryInformation SET IsActive = 0, UpdatedAt = GETDATE() WHERE InfoID = @InfoID');

        res.json({ message: 'تم حذف المعلومة بنجاح' });
    } catch (error) {
        console.error('Error deleting category information:', error);
        res.status(500).json({ error: 'خطأ في حذف معلومة التصنيف' });
    }
};

// الحصول على معلومات التصنيف فقط
const getCategoryInformation = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const pool = await getPool(req);
        const schema = await detectSchema(pool);

        const infoJoin = identityJoinForCreatedBy(schema, 'ci', 'CreatedBy');
        const infoName = identityNameForCreatedBy(schema, 'ci');

        const infoResult = await pool.request()
            .input('CategoryID', sql.Int, categoryId)
            .query(`
                SELECT
                    ci.InfoID, ci.CategoryID, ci.Title, ci.Content, ci.OrderIndex,
                    ci.CreatedBy, ci.CreatedAt, ci.UpdatedAt, ci.IsActive,
                    ${infoName} as CreatedByName
                FROM CategoryInformation ci
                ${infoJoin}
                WHERE ci.CategoryID = @CategoryID AND ci.IsActive = 1
                ORDER BY ci.OrderIndex, ci.CreatedAt
            `);
        const infos = infoResult.recordset.map(i => {
            if (i.Content) { try { i.Content = encryptionConfig.decrypt(i.Content); } catch (e) {} }
            return i;
        });
        res.json(infos);
    } catch (error) {
        console.error('Error fetching category information:', error);
        res.status(500).json({ error: 'خطأ في جلب معلومات التصنيف' });
    }
};

module.exports = {
    getCategoriesByDepartment,
    getCategoryById,
    getCategoryInformation,
    createCategory,
    updateCategory,
    deleteCategory,
    addCategoryInformation,
    updateCategoryInformation,
    deleteCategoryInformation,
    getLinkedTaskCount
};
