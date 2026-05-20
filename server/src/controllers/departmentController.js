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
