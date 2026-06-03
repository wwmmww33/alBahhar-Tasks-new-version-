// src/controllers/taskRelationController.js
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');

function decryptTitle(raw) {
  if (!raw) return '';
  try { return encryptionConfig.decrypt(raw); } catch (_) { return raw; }
}

// GET /api/tasks/:id/related
exports.getRelatedTasks = async (req, res) => {
  try {
    const pool = req.app.locals.db;
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId)) return res.status(400).json({ message: 'معرف المهمة غير صحيح.' });

    const result = await pool.request()
      .input('TID', sql.Int, taskId)
      .query(`
        SELECT
          t.TaskID,
          t.Title,
          t.Status,
          t.Priority,
          t.DueDate,
          r.CreatedAt AS LinkedAt
        FROM dbo.TaskRelations r
        JOIN dbo.Tasks t
          ON t.TaskID = CASE WHEN r.TaskID1 = @TID THEN r.TaskID2 ELSE r.TaskID1 END
        WHERE r.TaskID1 = @TID OR r.TaskID2 = @TID
        ORDER BY r.CreatedAt DESC
      `);

    const tasks = result.recordset.map(t => ({
      ...t,
      Title: decryptTitle(t.Title)
    }));

    res.json(tasks);
  } catch (err) {
    console.error('getRelatedTasks error:', err);
    res.status(500).json({ message: err.message });
  }
};

// POST /api/tasks/:id/related
exports.addRelatedTask = async (req, res) => {
  try {
    const pool = req.app.locals.db;
    const taskId = parseInt(req.params.id, 10);
    const { relatedTaskId, userId } = req.body;

    if (isNaN(taskId)) return res.status(400).json({ message: 'معرف المهمة غير صحيح.' });
    if (!relatedTaskId) return res.status(400).json({ message: 'relatedTaskId مطلوب.' });

    const relId = parseInt(relatedTaskId, 10);
    if (isNaN(relId)) return res.status(400).json({ message: 'معرف المهمة المرتبطة غير صحيح.' });
    if (relId === taskId) return res.status(400).json({ message: 'لا يمكن ربط المهمة بنفسها.' });

    // الأصغر دائماً في TaskID1 لضمان التفرد
    const id1 = Math.min(taskId, relId);
    const id2 = Math.max(taskId, relId);

    // التحقق من وجود كلتا المهمتين
    const existCheck = await pool.request()
      .input('T1', sql.Int, id1)
      .input('T2', sql.Int, id2)
      .query('SELECT TaskID FROM dbo.Tasks WHERE TaskID IN (@T1, @T2)');

    if (existCheck.recordset.length < 2)
      return res.status(404).json({ message: 'إحدى المهمتين غير موجودة.' });

    // التحقق من عدم وجود ارتباط مسبق
    const dupCheck = await pool.request()
      .input('T1', sql.Int, id1)
      .input('T2', sql.Int, id2)
      .query('SELECT RelationID FROM dbo.TaskRelations WHERE TaskID1 = @T1 AND TaskID2 = @T2');

    if (dupCheck.recordset.length)
      return res.status(409).json({ message: 'المهمتان مرتبطتان بالفعل.' });

    await pool.request()
      .input('T1', sql.Int, id1)
      .input('T2', sql.Int, id2)
      .input('CreatedBy', sql.NVarChar, userId ? String(userId) : null)
      .query(`
        INSERT INTO dbo.TaskRelations (TaskID1, TaskID2, CreatedBy)
        VALUES (@T1, @T2, @CreatedBy)
      `);

    res.status(201).json({ message: 'تم ربط المهمتين بنجاح.' });
  } catch (err) {
    console.error('addRelatedTask error:', err);
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/tasks/:id/related/:relatedId
exports.removeRelatedTask = async (req, res) => {
  try {
    const pool = req.app.locals.db;
    const taskId = parseInt(req.params.id, 10);
    const relId = parseInt(req.params.relatedId, 10);

    if (isNaN(taskId) || isNaN(relId))
      return res.status(400).json({ message: 'معرفات المهام غير صحيحة.' });

    const id1 = Math.min(taskId, relId);
    const id2 = Math.max(taskId, relId);

    await pool.request()
      .input('T1', sql.Int, id1)
      .input('T2', sql.Int, id2)
      .query('DELETE FROM dbo.TaskRelations WHERE TaskID1 = @T1 AND TaskID2 = @T2');

    res.json({ message: 'تم إزالة الارتباط بنجاح.' });
  } catch (err) {
    console.error('removeRelatedTask error:', err);
    res.status(500).json({ message: err.message });
  }
};
