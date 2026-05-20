// src/middleware/auth.js
const sql = require('mssql');
const {
  detectSchema,
  resolveActorContext,
  ensureVacancyId,
} = require('../utils/vacancyResolver');

// Middleware للتحقق من صحة الرمز المميز (Token)
// ملاحظة: النظام لا يستخدم JWT حقيقياً بل UserID يُمرَّر في الهيدر.
// الوظيفة تحشو req.user بسياق كامل: userId, vacancyId, assignmentId,
// departmentId, fullName, vacancyName, isAdmin, isActive.
const authenticateToken = async (req, res, next) => {
  try {
    const pool = req.app.locals.db;
    if (!pool) {
      return res.status(503).json({ error: 'قاعدة البيانات غير متاحة حالياً.' });
    }

    // مصدر UserID (Header > Query > Body)
    const rawUserId = req.headers['user-id'] || req.query.userId || req.body.userId;
    if (!rawUserId) {
      return res.status(401).json({ error: 'معرف المستخدم مطلوب للوصول' });
    }

    // حلّ سياق الفاعل الكامل (userId, vacancyId, assignmentId, departmentId, ...)
    // defensive: يعمل سواء كان المخطط قديماً (UserID-only) أو جديداً (VacancyID).
    const actor = await resolveActorContext(pool, rawUserId);

    if (!actor) {
      return res.status(401).json({ error: 'المستخدم غير موجود أو غير نشط' });
    }
    if (!actor.isActive) {
      return res.status(403).json({ error: 'هذا الحساب موقوف.' });
    }

    req.user = {
      userId: actor.userId,
      vacancyId: actor.vacancyId,
      assignmentId: actor.assignmentId,
      departmentId: actor.departmentId,
      fullName: actor.fullName,
      vacancyName: actor.vacancyName,
      isAdmin: actor.isAdmin,
      isActive: actor.isActive,
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'خطأ في التحقق من الهوية' });
  }
};

// Middleware للتحقق من صلاحيات الإدارة
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'صلاحيات الإدارة مطلوبة للوصول' });
  }
  next();
};

// Middleware للتحقق من صلاحيات التفويض
// يتعامل مع المخططين (UserID-based أو VacancyID-based) عبر فحص المخطط.
const checkDelegationPermission = (permissionType) => {
  return async (req, res, next) => {
    try {
      const pool = req.app.locals.db;
      if (!pool) {
        return res.status(503).json({ error: 'قاعدة البيانات غير متاحة حالياً.' });
      }

      const userId = req.user && req.user.userId;
      const taskCreatorId = req.params.taskCreatorId || req.body.taskCreatorId;

      // إذا كان المستخدم هو منشئ المهمة الأصلي، فله جميع الصلاحيات
      if (userId && taskCreatorId && String(userId).trim() === String(taskCreatorId).trim()) {
        return next();
      }

      const schema = await detectSchema(pool);

      // مسار VacancyID الجديد: نحوّل UserIDs إلى VacancyIDs ثم نستدعي الدالة بها.
      if (schema.hasDelegationVacancy) {
        const delegateVacancyId = await ensureVacancyId(pool, req.user);
        // نحل VacancyID الخاص بالمفوِّض (منشئ المهمة) من UserID
        const { resolveVacancyId } = require('../utils/vacancyResolver');
        const delegatorVacancyId = await resolveVacancyId(pool, taskCreatorId);

        if (!delegateVacancyId || !delegatorVacancyId) {
          return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' });
        }

        const request = pool.request();
        request.input('delegatorVacancyID', sql.Int, delegatorVacancyId);
        request.input('delegateVacancyID', sql.Int, delegateVacancyId);
        request.input('permissionType', sql.NVarChar(50), permissionType);

        // الدالة التخزينية قد تكون بتواقيع مختلفة؛ نحاول بصيغة VacancyID أولاً.
        // إن لم تدعم الدالة هذه الصيغة سيقع خطأ SQL ونعيد 500 ونطلب الترقية.
        const result = await request.query(`
          SELECT dbo.fn_CheckTaskDelegationPermission(@delegatorVacancyID, @delegateVacancyID, @permissionType) AS HasPermission
        `);

        if (!result.recordset[0] || !result.recordset[0].HasPermission) {
          return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' });
        }
        return next();
      }

      // مسار UserID القديم: نمرّر UserIDs كما هي.
      const request = pool.request();
      request.input('delegatorUserID', sql.NVarChar(50), taskCreatorId);
      request.input('delegateUserID', sql.NVarChar(50), userId);
      request.input('permissionType', sql.NVarChar(50), permissionType);

      const result = await request.query(`
        SELECT dbo.fn_CheckTaskDelegationPermission(@delegatorUserID, @delegateUserID, @permissionType) AS HasPermission
      `);

      if (!result.recordset[0] || !result.recordset[0].HasPermission) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' });
      }

      next();
    } catch (error) {
      console.error('Delegation permission check error:', error);
      res.status(500).json({ error: 'خطأ في التحقق من صلاحيات التفويض' });
    }
  };
};

module.exports = {
  authenticateToken,
  requireAdmin,
  checkDelegationPermission,
};
