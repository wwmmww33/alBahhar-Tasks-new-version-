// src/controllers/taskLineageController.js
// "المهمة المنبثقة": مهمة جديدة أصلاً تنشأ نتيجة لمهمة أخرى — نسَب/تفرّع (أب واحد فقط لكل مهمة)،
// عبر عمود Tasks.ParentTaskID. يختلف هذا عن TaskRelations (ارتباط أفقي تعريفي بين مهمتين قائمتين،
// راجع taskRelationController.js) في أنه علاقة اتجاهية (أم ← أبناء) تُستخدم لتتبع كيف ظهرت المهام.
const sql = require('mssql');
const encryptionConfig = require('../config/encryption.config');
const { checkTaskAccess } = require('../utils/delegationUtils');
const { detectSchema } = require('../utils/vacancyResolver');

function decryptTitle(raw) {
  if (!raw) return '';
  try { return encryptionConfig.decrypt(raw); } catch (_) { return raw; }
}

async function resolveCreatorIdentityCols(pool) {
  const schema = await detectSchema(pool);
  return {
    idTable: schema.isVacancy ? 'JobVacancies' : 'Users',
    idKey: schema.isVacancy ? 'VacancyID' : 'UserID',
    idName: schema.isVacancy ? 'Name' : 'FullName',
    taskCreatedCol: schema.tasksCreatedByCol,
  };
}

// GET /api/tasks/:id/children?userId=...&isAdmin=...
// يُرجع المهام المنبثقة مباشرة من هذه المهمة. للمهام التي لا يملك الفاعل صلاحية الوصول إليها،
// يُعاد العنوان ومنشئها فقط (دون وصف/تفاصيل) — نفس اتفاقية findSimilarTasks.
exports.getTaskChildren = async (req, res) => {
  try {
    const pool = req.app.locals.db;
    const taskId = parseInt(req.params.id, 10);
    const { userId, isAdmin } = req.query;
    if (isNaN(taskId)) return res.status(400).json({ message: 'معرف المهمة غير صحيح.' });
    if (!userId) return res.status(401).json({ message: 'User identification is required.' });

    const colProbe = await pool.request().query(`SELECT COL_LENGTH('dbo.Tasks','ParentTaskID') AS Len`);
    if (!colProbe.recordset[0]?.Len) return res.json([]);

    const result = await pool.request().input('PID', sql.Int, taskId).query(`
      SELECT TaskID, Title, Status, Priority, DueDate, CreatedAt
      FROM dbo.Tasks WHERE ParentTaskID = @PID
      ORDER BY CreatedAt DESC
    `);

    const isAdminFlag = isAdmin === 'true' || isAdmin === true;
    const ids = await resolveCreatorIdentityCols(pool);

    const children = [];
    for (const row of result.recordset) {
      const access = await checkTaskAccess(pool, row.TaskID, userId, isAdminFlag, 'view');
      const title = decryptTitle(row.Title);
      if (access.hasAccess) {
        children.push({
          TaskID: row.TaskID, Title: title, Status: row.Status, Priority: row.Priority,
          DueDate: row.DueDate, hasAccess: true,
        });
      } else {
        const creatorInfo = await pool.request().input('TID', sql.Int, row.TaskID).query(`
          SELECT creator.${ids.idName} AS CreatedByName
          FROM dbo.Tasks t
          LEFT JOIN ${ids.idTable} creator ON t.${ids.taskCreatedCol} = creator.${ids.idKey}
          WHERE t.TaskID = @TID
        `);
        children.push({
          TaskID: row.TaskID, Title: title, hasAccess: false,
          CreatedByName: creatorInfo.recordset[0]?.CreatedByName || null,
        });
      }
    }
    res.json(children);
  } catch (err) {
    console.error('getTaskChildren error:', err);
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/tasks/:id/parent — body: { userId, isAdmin, parentTaskId } (parentTaskId: null لإزالة الربط)
exports.setTaskParent = async (req, res) => {
  try {
    const pool = req.app.locals.db;
    const taskId = parseInt(req.params.id, 10);
    const { userId, isAdmin, parentTaskId } = req.body || {};
    if (isNaN(taskId)) return res.status(400).json({ message: 'معرف المهمة غير صحيح.' });
    if (!userId) return res.status(401).json({ message: 'User identification is required.' });

    const isAdminFlag = isAdmin === true || isAdmin === 'true';
    const accessCheck = await checkTaskAccess(pool, taskId, userId, isAdminFlag, 'view');
    if (!accessCheck.hasAccess) {
      return res.status(403).json({ message: accessCheck.reason || 'ليس لديك صلاحية لتعديل هذه المهمة' });
    }

    const colProbe = await pool.request().query(`SELECT COL_LENGTH('dbo.Tasks','ParentTaskID') AS Len`);
    if (!colProbe.recordset[0]?.Len) {
      return res.status(400).json({ message: 'ميزة المهمة المنبثقة غير مفعّلة على هذه القاعدة.' });
    }

    // إزالة الربط
    if (parentTaskId == null || String(parentTaskId).trim() === '') {
      await pool.request().input('TaskID', sql.Int, taskId)
        .query(`UPDATE dbo.Tasks SET ParentTaskID = NULL WHERE TaskID = @TaskID`);
      return res.status(200).json({ message: 'تم إزالة ربط المهمة الأم.', ParentTaskID: null });
    }

    const parentIdInt = parseInt(parentTaskId, 10);
    if (!Number.isInteger(parentIdInt)) {
      return res.status(400).json({ message: 'معرّف المهمة الأم غير صالح.' });
    }
    if (parentIdInt === taskId) {
      return res.status(400).json({ message: 'لا يمكن أن تكون المهمة أماً لنفسها.' });
    }

    const parentAccess = await checkTaskAccess(pool, parentIdInt, userId, isAdminFlag, 'view');
    if (!parentAccess.hasAccess) {
      return res.status(400).json({ message: 'المهمة الأم المحددة غير موجودة أو لا تملك صلاحية الوصول إليها.' });
    }

    // منع الدورات: المهمة الأم المقترحة يجب ألا تكون من سلالة (أبناء/أحفاد) المهمة الحالية —
    // نصعد من المهمة الأم المقترحة عبر أسلافها؛ إن ظهرت المهمة الحالية بينهم فهذا يعني أنها أصلاً
    // سلف لتلك المهمة، وربطها كأمٍّ لها الآن سيُنشئ دورة.
    const cycleRequest = pool.request()
      .input('StartID', sql.Int, parentIdInt)
      .input('TargetID', sql.Int, taskId);
    const cycleResult = await cycleRequest.query(`
      ;WITH Ancestors AS (
        SELECT TaskID, ParentTaskID, 0 AS Depth
        FROM dbo.Tasks WHERE TaskID = @StartID
        UNION ALL
        SELECT t.TaskID, t.ParentTaskID, a.Depth + 1
        FROM dbo.Tasks t
        INNER JOIN Ancestors a ON t.TaskID = a.ParentTaskID
        WHERE a.Depth < 50
      )
      SELECT COUNT(*) AS cnt FROM Ancestors WHERE TaskID = @TargetID
      OPTION (MAXRECURSION 50)
    `);
    if ((cycleResult.recordset[0]?.cnt || 0) > 0) {
      return res.status(400).json({ message: 'لا يمكن اختيار هذه المهمة أماً — ستُنشئ دورة في سلسلة النسَب (هي بالفعل من سلالة المهمة الحالية).' });
    }

    await pool.request()
      .input('TaskID', sql.Int, taskId)
      .input('ParentTaskID', sql.Int, parentIdInt)
      .query(`UPDATE dbo.Tasks SET ParentTaskID = @ParentTaskID WHERE TaskID = @TaskID`);

    res.status(200).json({ message: 'تم تحديد المهمة الأم بنجاح.', ParentTaskID: parentIdInt });
  } catch (err) {
    console.error('setTaskParent error:', err);
    res.status(500).json({ message: err.message });
  }
};
