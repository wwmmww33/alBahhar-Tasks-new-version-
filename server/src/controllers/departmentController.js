const sql = require('mssql');

let _deptColsCache = null;
const resolveDeptColumns = async (pool) => {
    if (_deptColsCache) return _deptColsCache;
    const q = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Departments'";
    const result = await pool.request().query(q);
    const names = new Set(result.recordset.map(r => r.COLUMN_NAME));
    const parentCol = names.has('ParentID') ? 'ParentID' : (names.has('ParentDepartmentID') ? 'ParentDepartmentID' : null);
    const activeCol = names.has('IsActive') ? 'IsActive' : (names.has('Active') ? 'Active' : null);
    const hasTypeCol = names.has('Type');
    _deptColsCache = { parentCol, activeCol, hasTypeCol };
    return _deptColsCache;
};

exports.getAllDepartments = async (req, res) => {
    const pool = req.app.locals.db;
    try {
        const result = await pool.request().query('SELECT * FROM Departments ORDER BY Name');
        res.status(200).json(result.recordset);
    } catch (error) { res.status(500).send({ message: 'Error fetching departments' }); }
};
exports.createDepartment = async (req, res) => {
    const pool = req.app.locals.db;
    const { Name } = req.body;
    try {
        const cols = await resolveDeptColumns(pool);
        const parent = req.body.ParentID ?? req.body.ParentDepartmentID ?? null;
        const activeVal = req.body.IsActive ?? req.body.Active;
        const active = typeof activeVal === 'boolean' ? activeVal : (typeof activeVal === 'number' ? activeVal !== 0 : null);
        const typeVal = req.body.Type != null ? String(req.body.Type) : null;

        const reqq = pool.request().input('Name', sql.NVarChar, Name);
        if (cols.parentCol) reqq.input('Parent', sql.Int, parent);
        if (cols.activeCol) reqq.input('Active', sql.Bit, active === null ? true : active);
        if (cols.hasTypeCol) reqq.input('Type', sql.NVarChar, typeVal);

        let query = 'INSERT INTO Departments (Name';
        let values = 'VALUES (@Name';
        if (cols.parentCol) { query += `, ${cols.parentCol}`; values += ', @Parent'; }
        if (cols.activeCol) { query += `, ${cols.activeCol}`; values += ', @Active'; }
        if (cols.hasTypeCol) { query += `, Type`; values += ', @Type'; }
        query += `) OUTPUT INSERTED.* ${values})`;

        const result = await reqq.query(query);
        res.status(201).json(result.recordset[0]);
    } catch (error) { res.status(500).send({ message: 'Error creating department' }); }
};
exports.updateDepartment = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    const { Name } = req.body;
    try {
        const cols = await resolveDeptColumns(pool);
        const parent = req.body.ParentID ?? req.body.ParentDepartmentID ?? null;
        const activeVal = req.body.IsActive ?? req.body.Active;
        const active = typeof activeVal === 'boolean' ? activeVal : (typeof activeVal === 'number' ? activeVal !== 0 : null);
        const typeVal = req.body.Type != null ? String(req.body.Type) : null;

        const reqq = pool.request().input('DepartmentID', sql.Int, id).input('Name', sql.NVarChar, Name);
        if (cols.parentCol) reqq.input('Parent', sql.Int, parent);
        if (cols.activeCol) reqq.input('Active', sql.Bit, active === null ? true : active);
        if (cols.hasTypeCol) reqq.input('Type', sql.NVarChar, typeVal);

        let setParts = ['Name = @Name'];
        if (cols.parentCol) setParts.push(`${cols.parentCol} = @Parent`);
        if (cols.activeCol) setParts.push(`${cols.activeCol} = @Active`);
        if (cols.hasTypeCol) setParts.push('Type = @Type');
        const query = `UPDATE Departments SET ${setParts.join(', ')} WHERE DepartmentID = @DepartmentID`;
        await reqq.query(query);
        // مسح الكاش لإعادة قراءة الأعمدة عند الحاجة
        _deptColsCache = null;
        res.status(200).json({ message: 'Department updated successfully' });
    } catch (error) { res.status(500).send({ message: 'Error updating department' }); }
};
exports.deleteDepartment = async (req, res) => {
    const pool = req.app.locals.db;
    const { id } = req.params;
    try {
        await pool.request().input('DepartmentID', sql.Int, id).query('DELETE FROM Departments WHERE DepartmentID = @DepartmentID');
        res.status(200).json({ message: 'Department deleted successfully' });
    } catch (error) {
        if (error.number === 547) { return res.status(400).send({ message: 'Cannot delete department. It is assigned to users.' }); }
        res.status(500).send({ message: 'Error deleting department' });
    }
};

// ---- GET /api/departments/:id/usage ----
exports.checkDepartmentUsage = async (req, res) => {
    const pool = req.app.locals.db;
    const deptId = parseInt(req.params.id, 10);
    if (!Number.isInteger(deptId)) return res.status(400).json({ message: 'id must be integer' });
    try {
        const cols = await resolveDeptColumns(pool);
        const parentCol = cols.parentCol || 'ParentID';

        // أقسام فرعية
        const childRes = await pool.request().input('DID', sql.Int, deptId)
            .query(`SELECT COUNT(*) AS cnt FROM dbo.Departments WHERE ${parentCol} = @DID`);
        const childDepts = childRes.recordset[0]?.cnt || 0;

        // مناصب في القسم
        let vacancies = 0, tasks = 0, subtasks = 0, assignments = 0;
        const probe = await pool.request().query(`
            SELECT
                CASE WHEN OBJECT_ID('dbo.JobVacancies','U')                IS NOT NULL THEN 1 ELSE 0 END AS HasVac,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','DepartmentID')    IS NOT NULL THEN 1 ELSE 0 END AS HasVacDept,
                CASE WHEN COL_LENGTH('dbo.Tasks','DepartmentID')           IS NOT NULL THEN 1 ELSE 0 END AS HasTasksDept,
                CASE WHEN COL_LENGTH('dbo.Tasks','AssignedToVacancyID')    IS NOT NULL THEN 1 ELSE 0 END AS HasTasksVacID,
                CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubsVacID,
                CASE WHEN OBJECT_ID('dbo.Assignments','U')                 IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
                CASE WHEN COL_LENGTH('dbo.Assignments','IsCurrent')        IS NOT NULL THEN 1 ELSE 0 END AS HasAssIsCurrent
        `);
        const p = probe.recordset[0] || {};

        if (p.HasVac && p.HasVacDept) {
            const r = await pool.request().input('DID', sql.Int, deptId)
                .query(`SELECT COUNT(*) AS cnt FROM dbo.JobVacancies WHERE DepartmentID = @DID`);
            vacancies = r.recordset[0]?.cnt || 0;
        }
        if (p.HasTasksDept) {
            const r = await pool.request().input('DID', sql.Int, deptId)
                .query(`SELECT COUNT(*) AS cnt FROM dbo.Tasks WHERE DepartmentID = @DID`);
            tasks = r.recordset[0]?.cnt || 0;
        }
        if (p.HasVac && p.HasVacDept && p.HasSubsVacID) {
            const r = await pool.request().input('DID', sql.Int, deptId)
                .query(`SELECT COUNT(*) AS cnt FROM dbo.Subtasks s
                        JOIN dbo.JobVacancies v ON v.VacancyID = s.AssignedToVacancyID
                        WHERE v.DepartmentID = @DID`);
            subtasks = r.recordset[0]?.cnt || 0;
        }
        if (p.HasAssignments) {
            const w = p.HasAssIsCurrent ? 'AND a.IsCurrent = 1' : '';
            const r = await pool.request().input('DID', sql.Int, deptId)
                .query(`SELECT COUNT(*) AS cnt FROM dbo.Assignments a
                        JOIN dbo.JobVacancies v ON v.VacancyID = a.VacancyID
                        WHERE v.DepartmentID = @DID ${w}`);
            assignments = r.recordset[0]?.cnt || 0;
        }

        const canDelete = childDepts === 0 && tasks === 0 && subtasks === 0 && assignments === 0 && vacancies === 0;
        res.status(200).json({ childDepts, vacancies, tasks, subtasks, assignments, canDelete });
    } catch (err) {
        console.error('CHECK DEPT USAGE ERROR:', err);
        res.status(500).json({ message: 'Error checking department usage', detail: err.message });
    }
};

// ---- POST /api/departments/:id/transfer-and-delete ----
// Body: { targetVacancyId: number } — ينقل المهام إلى منصب آخر ثم يحذف القسم وكل مناصبه
exports.transferAndDeleteDepartment = async (req, res) => {
    const pool = req.app.locals.db;
    const deptId  = parseInt(req.params.id, 10);
    const targetId = parseInt(req.body?.targetVacancyId, 10);
    if (!Number.isInteger(deptId) || !Number.isInteger(targetId))
        return res.status(400).json({ message: 'deptId and targetVacancyId must be integers' });

    const transaction = new sql.Transaction(pool);
    try {
        const probe = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('dbo.Tasks','DepartmentID')           IS NOT NULL THEN 1 ELSE 0 END AS HasTasksDept,
                CASE WHEN COL_LENGTH('dbo.Tasks','AssignedToVacancyID')    IS NOT NULL THEN 1 ELSE 0 END AS HasTasksVacID,
                CASE WHEN COL_LENGTH('dbo.Subtasks','AssignedToVacancyID') IS NOT NULL THEN 1 ELSE 0 END AS HasSubsVacID,
                CASE WHEN OBJECT_ID('dbo.Assignments','U')                 IS NOT NULL THEN 1 ELSE 0 END AS HasAssignments,
                CASE WHEN COL_LENGTH('dbo.Assignments','IsCurrent')        IS NOT NULL THEN 1 ELSE 0 END AS HasAssIsCurrent,
                CASE WHEN OBJECT_ID('dbo.VacancyRanks','U')                IS NOT NULL THEN 1 ELSE 0 END AS HasVacRanks,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','DepartmentID')    IS NOT NULL THEN 1 ELSE 0 END AS HasVacDept
        `);
        const p = probe.recordset[0] || {};

        // احصل على DepartmentID الخاص بالمنصب الهدف لتحديث DepartmentID في Tasks
        let targetDeptId = deptId;
        if (p.HasVacDept) {
            const tdRes = await pool.request().input('TGT', sql.Int, targetId)
                .query(`SELECT TOP 1 DepartmentID FROM dbo.JobVacancies WHERE VacancyID = @TGT`);
            targetDeptId = tdRes.recordset[0]?.DepartmentID ?? deptId;
        }

        await transaction.begin();

        // نقل المهام المسندة إلى مناصب هذا القسم
        if (p.HasTasksVacID && p.HasVacDept) {
            await new sql.Request(transaction)
                .input('DID', sql.Int, deptId).input('TGT', sql.Int, targetId)
                .query(`UPDATE dbo.Tasks SET AssignedToVacancyID = @TGT
                        WHERE AssignedToVacancyID IN (SELECT VacancyID FROM dbo.JobVacancies WHERE DepartmentID = @DID)`);
        }
        // تحديث DepartmentID للمهام
        if (p.HasTasksDept) {
            await new sql.Request(transaction)
                .input('DID', sql.Int, deptId).input('TDID', sql.Int, targetDeptId)
                .query(`UPDATE dbo.Tasks SET DepartmentID = @TDID WHERE DepartmentID = @DID`);
        }
        // نقل المهام الفرعية
        if (p.HasSubsVacID && p.HasVacDept) {
            await new sql.Request(transaction)
                .input('DID', sql.Int, deptId).input('TGT', sql.Int, targetId)
                .query(`UPDATE dbo.Subtasks SET AssignedToVacancyID = @TGT
                        WHERE AssignedToVacancyID IN (SELECT VacancyID FROM dbo.JobVacancies WHERE DepartmentID = @DID)`);
        }
        // إغلاق الإسنادات
        if (p.HasAssignments && p.HasAssIsCurrent && p.HasVacDept) {
            await new sql.Request(transaction).input('DID', sql.Int, deptId)
                .query(`UPDATE dbo.Assignments SET IsCurrent = 0
                        WHERE IsCurrent = 1 AND VacancyID IN (SELECT VacancyID FROM dbo.JobVacancies WHERE DepartmentID = @DID)`);
        }
        // حذف VacancyRanks
        if (p.HasVacRanks && p.HasVacDept) {
            await new sql.Request(transaction).input('DID', sql.Int, deptId)
                .query(`DELETE FROM dbo.VacancyRanks WHERE VacancyID IN (SELECT VacancyID FROM dbo.JobVacancies WHERE DepartmentID = @DID)`);
        }
        // حذف Assignments
        if (p.HasAssignments && p.HasVacDept) {
            await new sql.Request(transaction).input('DID', sql.Int, deptId)
                .query(`DELETE FROM dbo.Assignments WHERE VacancyID IN (SELECT VacancyID FROM dbo.JobVacancies WHERE DepartmentID = @DID)`);
        }
        // حذف JobVacancies
        if (p.HasVacDept) {
            await new sql.Request(transaction).input('DID', sql.Int, deptId)
                .query(`DELETE FROM dbo.JobVacancies WHERE DepartmentID = @DID`);
        }
        // حذف القسم
        await new sql.Request(transaction).input('DID', sql.Int, deptId)
            .query(`DELETE FROM dbo.Departments WHERE DepartmentID = @DID`);

        await transaction.commit();
        res.status(200).json({ message: 'Department transferred and deleted successfully' });
    } catch (err) {
        try { await transaction.rollback(); } catch (_) {}
        console.error('TRANSFER AND DELETE DEPT ERROR:', err);
        res.status(500).json({ message: 'Error during transfer', detail: err.message });
    }
};

// ---- POST /api/departments/:id/import-excel ----
// Body JSON: { fileBase64: string }
// يستورد الأقسام والمناصب من ملف إكسل ويُلحقها بالقسم المحدد
exports.importDepartmentsFromExcel = async (req, res) => {
    const pool = req.app.locals.db;
    const parentDeptId = parseInt(req.params.id, 10);
    if (!Number.isInteger(parentDeptId)) return res.status(400).json({ message: 'id must be integer' });

    const { rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: 'rows array is required and must not be empty' });

    try {

        // ---- 2. تطبيع أسماء الأعمدة (تجاهل فروق المسافات والحالة) ----
        function findCol(row, ...candidates) {
            const keys = Object.keys(row);
            for (const c of candidates) {
                const found = keys.find(k => k.trim().toLowerCase() === c.trim().toLowerCase());
                if (found !== undefined) return found;
            }
            return null;
        }
        const sample = rows[0];
        const COL_POS_ID     = findCol(sample, 'PositionID',        'Position_ID',  'ID');
        const COL_PARENT_ID  = findCol(sample, 'Parent_PositionID', 'ParentID',     'Parent_ID');
        const COL_DEPT_AR    = findCol(sample, 'Department_Ar',     'DepartmentAr', 'الاسم', 'Name');
        const COL_TYPE       = findCol(sample, 'Type',              'النوع');
        const COL_POS_AR     = findCol(sample, 'Position_Ar',       'PositionAr',   'المسمى');
        const COL_RANK       = findCol(sample, 'Postion_Rnk',       'Position_Rnk', 'Rank', 'الرتبة');

        if (!COL_POS_ID || !COL_DEPT_AR) {
            return res.status(400).json({ message: 'لم يتم العثور على أعمدة PositionID و Department_Ar في الملف.' });
        }

        // ---- 3. بناء خريطة PositionID في الإكسل ----
        const posIdSet = new Set(rows.map(r => String(r[COL_POS_ID] || '').trim()).filter(Boolean));

        // ---- 4. الترتيب التوبولوجي (الآباء قبل الأبناء) ----
        const nodeMap = new Map(rows.map(r => [String(r[COL_POS_ID] || '').trim(), r]));
        const visited = new Set();
        const insertOrder = [];

        function visit(posId) {
            if (!posId || visited.has(posId)) return;
            visited.add(posId);
            const row = nodeMap.get(posId);
            if (!row) return;
            const parentExcelId = COL_PARENT_ID ? String(row[COL_PARENT_ID] || '').trim() : '';
            // إن كان الأب موجوداً في الملف نعالجه أولاً
            if (parentExcelId && posIdSet.has(parentExcelId)) visit(parentExcelId);
            insertOrder.push(row);
        }
        rows.forEach(r => visit(String(r[COL_POS_ID] || '').trim()));

        // ---- 5. فحص المخطط ----
        const cols = await resolveDeptColumns(pool);

        const vacProbe = await pool.request().query(`
            SELECT
                CASE WHEN OBJECT_ID('dbo.JobVacancies','U')             IS NOT NULL THEN 1 ELSE 0 END AS HasJV,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','Name')         IS NOT NULL THEN 1 ELSE 0 END AS HasJVName,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','DepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasJVDept,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','IsActive')     IS NOT NULL THEN 1 ELSE 0 END AS HasJVActive,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','CreatedAt')    IS NOT NULL THEN 1 ELSE 0 END AS HasJVCreatedAt,
                CASE WHEN COL_LENGTH('dbo.JobVacancies','Rank')         IS NOT NULL THEN 1 ELSE 0 END AS HasJVRank,
                CASE WHEN OBJECT_ID('dbo.Ranks','U')                    IS NOT NULL THEN 1 ELSE 0 END AS HasRanks
        `);
        const vp = vacProbe.recordset[0] || {};

        // فحص نوع بيانات عمود Rank في JobVacancies (INT أم NVarChar)
        let jvRankIsInt = false;
        if (vp.HasJVRank) {
            const rankTypeRes = await pool.request().query(`
                SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME='JobVacancies' AND COLUMN_NAME='Rank'
            `).catch(() => ({ recordset: [] }));
            const dt = (rankTypeRes.recordset[0]?.DATA_TYPE || '').toLowerCase();
            jvRankIsInt = ['int','bigint','smallint','tinyint'].includes(dt);
        }

        // تحميل جدول الرتب للبحث بالاسم → { id, name }
        const ranksLookup = new Map();
        if (vp.HasRanks) {
            // اكتشف أعمدة الاسم الموجودة فعلاً في جدول Ranks
            const rankColsProbe = await pool.request().query(`
                SELECT
                    CASE WHEN COL_LENGTH('dbo.Ranks','Name')     IS NOT NULL THEN 1 ELSE 0 END AS HasName,
                    CASE WHEN COL_LENGTH('dbo.Ranks','RankName') IS NOT NULL THEN 1 ELSE 0 END AS HasRankName
            `);
            const rc = rankColsProbe.recordset[0] || {};
            const nameExpr = rc.HasName ? 'ISNULL(Name,\'\')' : (rc.HasRankName ? 'ISNULL(RankName,\'\')' : '\'\'');
            const altExpr  = rc.HasRankName ? 'ISNULL(RankName,\'\')' : '\'\'';

            const ranksRes = await pool.request().query(
                `SELECT RankID, ${nameExpr} AS N1, ${altExpr} AS N2 FROM dbo.Ranks`
            ).catch(e => { console.error('[IMPORT] Ranks query failed:', e.message); return { recordset: [] }; });

            for (const r of ranksRes.recordset) {
                const entry = { id: r.RankID, name: (r.N1 || r.N2 || '').trim() };
                if (r.N1 && r.N1.trim()) ranksLookup.set(r.N1.trim().toLowerCase(), entry);
                if (r.N2 && r.N2.trim() && r.N2 !== r.N1) ranksLookup.set(r.N2.trim().toLowerCase(), entry);
            }
        }

        console.log(`[IMPORT] HasJVRank=${vp.HasJVRank} jvRankIsInt=${jvRankIsInt} HasRanks=${vp.HasRanks} ranksCount=${ranksLookup.size} COL_RANK=${COL_RANK}`);

        // ---- 6. الإدراج في المعاملة ----
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        const excelIdToDbId = new Map(); // PositionID في الإكسل → DepartmentID الجديد في قاعدة البيانات
        let deptCount = 0;
        let vacCount  = 0;

        try {
            for (const row of insertOrder) {
                const excelPosId  = String(row[COL_POS_ID] || '').trim();
                const excelParent = COL_PARENT_ID ? String(row[COL_PARENT_ID] || '').trim() : '';
                const deptName    = String(row[COL_DEPT_AR] || '').trim() || `قسم مستورد`;
                const typeVal     = COL_TYPE ? String(row[COL_TYPE] || '').trim() : null;

                // تحديد الأب: إن كان موجوداً في الإكسل → ID الجديد منه، وإلا → القسم المحدد
                const dbParentId = (excelParent && posIdSet.has(excelParent))
                    ? (excelIdToDbId.get(excelParent) ?? parentDeptId)
                    : parentDeptId;

                // إيجاد اسم فريد: إذا كان الاسم مأخوذاً نضيف لاحقة (2)، (3)...
                let deptNameFinal = deptName;
                let nameCounter = 2;
                while (true) {
                    const nameCheck = await new sql.Request(transaction)
                        .input('EName', sql.NVarChar, deptNameFinal)
                        .query(`SELECT TOP 1 DepartmentID FROM dbo.Departments WHERE Name = @EName`);
                    if (!nameCheck.recordset[0]) break; // الاسم متاح
                    deptNameFinal = `${deptName} (${nameCounter++})`;
                }

                // إدراج القسم باسمه الفريد
                let newDeptId = null;
                const dReq = new sql.Request(transaction).input('Name', sql.NVarChar, deptNameFinal);
                let dCols = 'Name';
                let dVals = '@Name';

                if (cols.parentCol) {
                    dReq.input('Parent', sql.Int, dbParentId);
                    dCols += `, ${cols.parentCol}`;
                    dVals += ', @Parent';
                }
                if (cols.activeCol) { dCols += `, ${cols.activeCol}`; dVals += ', 1'; }
                if (cols.hasTypeCol && typeVal) {
                    dReq.input('Type', sql.NVarChar, typeVal);
                    dCols += ', Type';
                    dVals += ', @Type';
                }

                const dRes = await dReq.query(
                    `INSERT INTO dbo.Departments (${dCols}) OUTPUT INSERTED.DepartmentID VALUES (${dVals})`
                );
                newDeptId = dRes.recordset[0]?.DepartmentID;
                if (!newDeptId) throw new Error(`فشل إدراج القسم: ${deptNameFinal}`);
                deptCount++;

                excelIdToDbId.set(excelPosId, newDeptId);

                // ---- إدراج المنصب (JobVacancy) إن وُجد ----
                if (!vp.HasJV || !vp.HasJVDept || !vp.HasJVName) continue;
                const posName = COL_POS_AR ? String(row[COL_POS_AR] || '').trim() : '';
                if (!posName) continue;

                const vReq = new sql.Request(transaction)
                    .input('DID', sql.Int, newDeptId)
                    .input('VNAME', sql.NVarChar, posName);
                let vCols = 'DepartmentID, Name';
                let vVals = '@DID, @VNAME';
                if (vp.HasJVActive)    { vCols += ', IsActive';  vVals += ', 1'; }
                if (vp.HasJVCreatedAt) { vCols += ', CreatedAt'; vVals += ', GETDATE()'; }

                // البحث عن الرتبة وتخزينها في JobVacancies.Rank
                if (vp.HasJVRank && COL_RANK) {
                    const rankLabel = String(row[COL_RANK] || '').trim();
                    if (rankLabel) {
                        const rankEntry = ranksLookup.get(rankLabel.toLowerCase());
                        console.log(`[IMPORT] rank lookup: label="${rankLabel}" → found=${!!rankEntry} id=${rankEntry?.id}`);
                        if (rankEntry) {
                            if (jvRankIsInt) {
                                // عمود Rank من نوع INT → نخزّن RankID
                                vReq.input('RANK', sql.Int, rankEntry.id);
                            } else {
                                // عمود Rank من نوع NVarChar → نخزّن اسم الرتبة
                                vReq.input('RANK', sql.NVarChar, rankEntry.name);
                            }
                            vCols += ', Rank';
                            vVals += ', @RANK';
                        }
                    }
                }

                await vReq.query(
                    `INSERT INTO dbo.JobVacancies (${vCols}) VALUES (${vVals})`
                );
                vacCount++;
            }

            await transaction.commit();
            // مسح كاش الأعمدة ليُعاد حساب الشجرة
            _deptColsCache = null;
            res.status(200).json({
                message: `تم الاستيراد بنجاح`,
                deptCount,
                vacCount,
            });
        } catch (innerErr) {
            try { await transaction.rollback(); } catch (_) {}
            throw innerErr;
        }
    } catch (err) {
        console.error('IMPORT EXCEL ERROR:', err);
        res.status(500).json({ message: 'خطأ أثناء استيراد الملف', detail: err.message });
    }
};
