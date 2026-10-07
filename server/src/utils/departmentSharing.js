// src/utils/departmentSharing.js
// تبادل المهام بين المديريات المستقلة: قناة مشاركة على مستوى المهمة (مدير القسم/المفوَّض له)،
// مشاركة فعلية على مستوى كل مهمة فرعية/تعليق (منشئ العنصر)، ومستوى بث التقويم (مدير/مفوَّض له).
// راجع النقاش المعماري في المحادثة لتفاصيل القرارات: الرؤية متماثلة تماماً (لا امتياز لمالك المهمة)،
// والبث على التقويم مستقل كلياً عن الوصول الفعلي للمهمة (عرض فقط، لا ولوج).

const sql = require('mssql');
const { isUserManagerOrAdmin } = require('./delegationUtils');
const { resolveActorContext, resolveIndependentDeptGroup } = require('./vacancyResolver');

// يتحقق هل المنصب الحالي للمستخدم يحمل تفويضاً إدارياً موسّعاً (فتح/إغلاق قنوات المشاركة +
// التحكم بمستوى بث التقويم) — يُمنح هذا التفويض من مدير القسم المستقل لمنصب ضمن مديريته.
async function isDelegatedSharingManager(pool, rawUserId) {
  const ctx = await resolveActorContext(pool, rawUserId);
  if (!ctx?.vacancyId) return false;
  try {
    const colProbe = await pool.request().query(
      `SELECT COL_LENGTH('dbo.JobVacancies','CanManageSharingAndBroadcast') AS Len`
    );
    if (!colProbe.recordset[0]?.Len) return false;
    const result = await pool.request()
      .input('VacancyID', sql.Int, ctx.vacancyId)
      .query(`SELECT CanManageSharingAndBroadcast FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
    return !!result.recordset[0]?.CanManageSharingAndBroadcast;
  } catch (_) {
    return false;
  }
}

// يتحقق هل صاحب الطلب يملك صلاحية إدارة المشاركة/البث لمهمة تابعة لـ anchorDepartmentId —
// مدير عام (أي قسم)، أو مدير قسم/مفوَّض له ضمن مديريته المستقلة فقط (anchorDepartmentId داخل نطاقه).
async function canManageDepartmentSharingAndBroadcast(pool, rawUserId, isAdminFlag, anchorDepartmentId) {
  if (isAdminFlag === true || isAdminFlag === 'true') return true;
  const anchorId = parseInt(String(anchorDepartmentId ?? '').trim(), 10);
  if (!Number.isInteger(anchorId)) return false;

  const [isManagerOrAdmin, isDelegate] = await Promise.all([
    isUserManagerOrAdmin(pool, rawUserId, false),
    isDelegatedSharingManager(pool, rawUserId),
  ]);
  if (!isManagerOrAdmin && !isDelegate) return false;

  const ctx = await resolveActorContext(pool, rawUserId);
  if (!ctx?.departmentId) return false;
  const scopeDeptIds = await resolveIndependentDeptGroup(pool, ctx.departmentId);
  return scopeDeptIds.map(String).includes(String(anchorId));
}

// يجلب سلسلة الأسلاف الكاملة لقسم، من القسم نفسه صعوداً حتى جذر النظام المطلق (بلا توقف عند
// حدود الأقسام المستقلة — هذا مقصود لأغراض اختيار مستوى البث).
async function resolveFullAncestorChain(pool, departmentId) {
  const colProbe = await pool.request().query(`
    SELECT
      CASE WHEN COL_LENGTH('dbo.Departments','ParentDepartmentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentDeptID,
      CASE WHEN COL_LENGTH('dbo.Departments','ParentID') IS NOT NULL THEN 1 ELSE 0 END AS HasParentID
  `);
  const p = colProbe.recordset[0] || {};
  const parentCol = p.HasParentDeptID ? 'ParentDepartmentID' : (p.HasParentID ? 'ParentID' : null);
  if (!parentCol) {
    const r = await pool.request().input('DepartmentID', sql.Int, departmentId)
      .query('SELECT DepartmentID, Name, [Type], CAST(NULL AS INT) AS ParentDepartmentID FROM dbo.Departments WHERE DepartmentID = @DepartmentID');
    return r.recordset;
  }
  const result = await pool.request().input('DepartmentID', sql.Int, departmentId).query(`
    ;WITH UpTree AS (
      SELECT DepartmentID, Name, [Type], ${parentCol} AS ParentDepartmentID, 0 AS Depth
      FROM dbo.Departments WHERE DepartmentID = @DepartmentID
      UNION ALL
      SELECT d.DepartmentID, d.Name, d.[Type], d.${parentCol} AS ParentDepartmentID, u.Depth + 1
      FROM dbo.Departments d INNER JOIN UpTree u ON d.DepartmentID = u.ParentDepartmentID
      WHERE u.Depth < 15
    )
    SELECT DepartmentID, Name, [Type], ParentDepartmentID FROM UpTree ORDER BY Depth ASC
    OPTION (MAXRECURSION 20)
  `);
  return result.recordset;
}

// الحد الأعلى لمستوى البث المسموح — يضبطه المدير العام للنظام فقط (SystemSettings). عند عدم
// ضبطه، الافتراضي استثناء جذر النظام المطلق فقط (القسم الذي لا أب له إطلاقاً).
async function getMaxBroadcastDepartmentId(pool) {
  try {
    const r = await pool.request().query(
      `SELECT SettingValue FROM dbo.SystemSettings WHERE SettingKey = 'MaxBroadcastDepartmentID'`
    );
    const parsed = parseInt(r.recordset[0]?.SettingValue, 10);
    return Number.isInteger(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function setMaxBroadcastDepartmentId(pool, deptId, actorUserId) {
  const value = deptId == null ? null : String(parseInt(deptId, 10));
  await pool.request()
    .input('Value', sql.NVarChar, value)
    .input('UserID', sql.NVarChar, String(actorUserId || ''))
    .query(`
      MERGE dbo.SystemSettings AS target
      USING (SELECT 'MaxBroadcastDepartmentID' AS K) AS src
      ON target.SettingKey = src.K
      WHEN MATCHED THEN UPDATE SET SettingValue = @Value, UpdatedAt = GETDATE(), UpdatedByUserID = @UserID
      WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedAt, UpdatedByUserID)
        VALUES ('MaxBroadcastDepartmentID', @Value, GETDATE(), @UserID);
    `);
}

// حد أعلى خاص بمنصب معيّن (JobVacancies.MaxBroadcastDepartmentID) — يضبطه المدير العام فقط، ويتجاوز
// الحد العام الافتراضي لهذا المنصب تحديداً عند وجوده. NULL = هذا المنصب يتبع الحد العام كالمعتاد.
async function getVacancyMaxBroadcastDepartmentId(pool, vacancyId) {
  if (vacancyId == null) return null;
  try {
    const colProbe = await pool.request().query(
      `SELECT COL_LENGTH('dbo.JobVacancies','MaxBroadcastDepartmentID') AS Len`
    );
    if (!colProbe.recordset[0]?.Len) return null;
    const r = await pool.request().input('VacancyID', sql.Int, vacancyId)
      .query(`SELECT MaxBroadcastDepartmentID FROM dbo.JobVacancies WHERE VacancyID = @VacancyID`);
    const val = r.recordset[0]?.MaxBroadcastDepartmentID;
    return Number.isInteger(val) ? val : null;
  } catch (_) {
    return null;
  }
}

async function setVacancyMaxBroadcastDepartmentId(pool, vacancyId, deptId) {
  const value = deptId == null ? null : parseInt(deptId, 10);
  await pool.request()
    .input('VacancyID', sql.Int, vacancyId)
    .input('Value', sql.Int, Number.isInteger(value) ? value : null)
    .query(`UPDATE dbo.JobVacancies SET MaxBroadcastDepartmentID = @Value WHERE VacancyID = @VacancyID`);
}

// يُرجع سلسلة الأسلاف "المسموحة" فقط لاختيار مستوى البث: حتى الحد الأعلى الخاص بمنصب الفاعل
// (vacancyId) إن كان مضبوطاً له تحديداً، وإلا الحد الأعلى العام الذي ضبطه المدير العام إن وُجد
// ضمن هذه السلسلة تحديداً، وإلا استثناء جذر النظام المطلق فقط (الافتراضي).
async function resolveAllowedBroadcastChain(pool, departmentId, vacancyId) {
  const chain = await resolveFullAncestorChain(pool, departmentId);
  let ceiling = vacancyId != null ? await getVacancyMaxBroadcastDepartmentId(pool, vacancyId) : null;
  if (ceiling == null) {
    ceiling = await getMaxBroadcastDepartmentId(pool);
  }
  if (ceiling != null) {
    const idx = chain.findIndex(d => d.DepartmentID === ceiling);
    if (idx !== -1) return chain.slice(0, idx + 1);
  }
  if (chain.length && chain[chain.length - 1].ParentDepartmentID == null) {
    return chain.slice(0, -1);
  }
  return chain;
}

// يتحقق هل قناة مشاركة مفتوحة بين المهمة وقسم مستقل معيّن (بأي قسم من نفس مجموعته المستقلة)
async function hasOpenTaskShareToIndependentGroup(pool, taskId, targetDepartmentId) {
  const group = await resolveIndependentDeptGroup(pool, targetDepartmentId);
  if (!group.length) return false;
  const placeholders = group.map((_, i) => `@g${i}`).join(',');
  const req = pool.request().input('TaskID', sql.Int, taskId);
  group.forEach((id, i) => req.input(`g${i}`, sql.Int, id));
  const result = await req.query(`
    SELECT TOP 1 1 AS found FROM dbo.TaskDepartmentShares
    WHERE TaskID = @TaskID AND SharedWithDepartmentID IN (${placeholders})
  `);
  return !!result.recordset[0];
}

// يُرجع قائمة الجهات المستقلة (DepartmentID + اسم الجذر المستقل) المفتوحة للمشاركة لهذه المهمة.
// تُستخدم أيضاً لعرض خيارات المشاركة على مستوى العنصر — فقناة فتحها مدير القسم هي ما تُدار (تُفتح/
// تُغلق) من هنا، أما مديرية المهمة الأصلية فمتاحة ضمنياً دوماً (راجع setItemDepartmentShares) ولا
// تحتاج قناة، فتُدرَج هنا تلقائياً لتظهر كخيار متاح للمشاركة معها دون أن تكون قناة فعلية قابلة للإغلاق.
async function listTaskShares(pool, taskId) {
  const result = await pool.request().input('TaskID', sql.Int, taskId).query(`
    SELECT s.SharedWithDepartmentID, d.Name AS DepartmentName, s.SharedByUserID, s.CreatedAt
    FROM dbo.TaskDepartmentShares s
    LEFT JOIN dbo.Departments d ON d.DepartmentID = s.SharedWithDepartmentID
    WHERE s.TaskID = @TaskID
    ORDER BY s.CreatedAt ASC
  `);
  return result.recordset;
}

// نفس listTaskShares، لكن تُضيف مديرية المهمة الأصلية كخيار دائم في المقدمة (لعرضها في نافذة
// مشاركة العنصر تحديداً — وليس في نافذة إدارة القنوات نفسها، حيث لا معنى لـ"إغلاق" قناة ضمنية).
// كما تستثني أي خيار يقع ضمن المديرية المستقلة لصاحب الطلب نفسه (viewerUserId) — فمشاركة عنصر مع
// جهتك الخاصة التي تراه افتراضياً بلا مشاركة أمر لا معنى له (هذا ما كان يظهر خطأً لمنشئ المهمة).
async function listItemShareOptions(pool, taskId, viewerUserId) {
  const channels = await listTaskShares(pool, taskId);
  const taskRow = await pool.request().input('TaskID', sql.Int, taskId)
    .query(`
      SELECT t.DepartmentID, d.Name AS DepartmentName
      FROM dbo.Tasks t
      LEFT JOIN dbo.Departments d ON d.DepartmentID = t.DepartmentID
      WHERE t.TaskID = @TaskID
    `);
  const ownDept = taskRow.recordset[0];

  let allOptions = channels;
  if (ownDept?.DepartmentID != null) {
    const alreadyListed = channels.some(c => c.SharedWithDepartmentID === ownDept.DepartmentID);
    if (!alreadyListed) {
      allOptions = [
        { SharedWithDepartmentID: ownDept.DepartmentID, DepartmentName: ownDept.DepartmentName, isOwnDepartment: true },
        ...channels,
      ];
    }
  }

  if (viewerUserId) {
    try {
      const viewerCtx = await resolveActorContext(pool, viewerUserId);
      if (viewerCtx?.departmentId != null) {
        const viewerGroup = await resolveIndependentDeptGroup(pool, viewerCtx.departmentId);
        allOptions = allOptions.filter(opt => !viewerGroup.includes(opt.SharedWithDepartmentID));
      }
    } catch (_) { /* تجاهل دفاعياً وأعد القائمة كاملة */ }
  }

  return allOptions;
}

// يفتح قناة مشاركة بين مهمة وقسم مستقل (يُحفظ القسم كما أُدخل — يُفضَّل تمرير الجذر المستقل نفسه)
async function openTaskShare(pool, taskId, departmentId, actorUserId) {
  await pool.request()
    .input('TaskID', sql.Int, taskId)
    .input('DepartmentID', sql.Int, departmentId)
    .input('UserID', sql.NVarChar, String(actorUserId))
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TaskDepartmentShares WHERE TaskID=@TaskID AND SharedWithDepartmentID=@DepartmentID)
        INSERT INTO dbo.TaskDepartmentShares (TaskID, SharedWithDepartmentID, SharedByUserID)
        VALUES (@TaskID, @DepartmentID, @UserID);
    `);
}

async function closeTaskShare(pool, taskId, departmentId) {
  await pool.request()
    .input('TaskID', sql.Int, taskId)
    .input('DepartmentID', sql.Int, departmentId)
    .query(`DELETE FROM dbo.TaskDepartmentShares WHERE TaskID=@TaskID AND SharedWithDepartmentID=@DepartmentID`);
}

// يستبدل قائمة الجهات المستقلة المشارك معها عنصر معيّن (مهمة فرعية أو تعليق)، بعد التحقق من
// أن كل جهة مطلوبة تملك قناة مفتوحة على مستوى المهمة نفسها — أو أنها مديرية المهمة الأصلية نفسها
// (مسموحة ضمنياً دوماً دون قناة، فهي الجهة المالكة للمهمة أصلاً — تسمح لمنتسب جهة أخرى اكتسب
// وصولاً بالإسناد المباشر أن يُشارك عنصره الجديد مرة أخرى مع الجهة المالكة دون قناة عكسية منفصلة).
async function setItemDepartmentShares(pool, { kind, itemId, taskId, departmentIds, actorUserId }) {
  const table = kind === 'subtask' ? 'SubtaskDepartmentShares' : 'CommentDepartmentShares';
  const idCol = kind === 'subtask' ? 'SubtaskID' : 'CommentID';

  const uniqueDeptIds = [...new Set((departmentIds || []).map(d => parseInt(d, 10)).filter(Number.isInteger))];

  const taskRow = await pool.request().input('TaskID', sql.Int, taskId)
    .query('SELECT DepartmentID FROM dbo.Tasks WHERE TaskID = @TaskID');
  const taskOwnDeptId = taskRow.recordset[0]?.DepartmentID ?? null;
  const taskOwnGroup = taskOwnDeptId != null ? await resolveIndependentDeptGroup(pool, taskOwnDeptId) : [];

  // تحقق أن كل قسم مطلوب لديه قناة مفتوحة على مستوى المهمة، أو هو مديرية المهمة الأصلية نفسها
  for (const deptId of uniqueDeptIds) {
    if (taskOwnGroup.includes(deptId)) continue;
    const ok = await hasOpenTaskShareToIndependentGroup(pool, taskId, deptId);
    if (!ok) {
      return { ok: false, reason: `لا توجد قناة مشاركة مفتوحة مع هذا القسم على مستوى المهمة (${deptId}).` };
    }
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).input('ItemID', sql.Int, itemId)
      .query(`DELETE FROM dbo.${table} WHERE ${idCol} = @ItemID`);
    for (const deptId of uniqueDeptIds) {
      await new sql.Request(tx)
        .input('ItemID', sql.Int, itemId)
        .input('DepartmentID', sql.Int, deptId)
        .input('UserID', sql.NVarChar, String(actorUserId))
        .query(`INSERT INTO dbo.${table} (${idCol}, SharedWithDepartmentID, SharedByUserID) VALUES (@ItemID, @DepartmentID, @UserID)`);
    }
    await tx.commit();
    return { ok: true };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// تفعيل/إيقاف "التقويم العام" في صفحة الدخول — إعداد عام واحد يضبطه المدير العام للنظام فقط
// (SystemSettings). عند الإيقاف، لا يُعرض التقويم العام لأي زائر حتى لو وُجدت عناصر عليها "بث مفتوح".
async function getPublicCalendarEnabled(pool) {
  try {
    const r = await pool.request().query(
      `SELECT SettingValue FROM dbo.SystemSettings WHERE SettingKey = 'PublicCalendarEnabled'`
    );
    return r.recordset[0]?.SettingValue === '1';
  } catch (_) {
    return false;
  }
}

async function setPublicCalendarEnabled(pool, enabled, actorUserId) {
  const value = enabled ? '1' : '0';
  await pool.request()
    .input('Value', sql.NVarChar, value)
    .input('UserID', sql.NVarChar, String(actorUserId || ''))
    .query(`
      MERGE dbo.SystemSettings AS target
      USING (SELECT 'PublicCalendarEnabled' AS K) AS src
      ON target.SettingKey = src.K
      WHEN MATCHED THEN UPDATE SET SettingValue = @Value, UpdatedAt = GETDATE(), UpdatedByUserID = @UserID
      WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedAt, UpdatedByUserID)
        VALUES ('PublicCalendarEnabled', @Value, GETDATE(), @UserID);
    `);
}

const DEFAULT_PUBLIC_CALENDAR_TITLE = 'التقويم العام';

// عنوان التقويم العام المعروض في صفحة الدخول — نص حر يضبطه المدير العام للنظام فقط، بنفس إعداد
// التفعيل/الإيقاف أعلاه.
async function getPublicCalendarTitle(pool) {
  try {
    const r = await pool.request().query(
      `SELECT SettingValue FROM dbo.SystemSettings WHERE SettingKey = 'PublicCalendarTitle'`
    );
    const v = r.recordset[0]?.SettingValue;
    return (v && v.trim()) ? v : DEFAULT_PUBLIC_CALENDAR_TITLE;
  } catch (_) {
    return DEFAULT_PUBLIC_CALENDAR_TITLE;
  }
}

async function setPublicCalendarTitle(pool, title, actorUserId) {
  const value = (title && String(title).trim()) ? String(title).trim().slice(0, 200) : DEFAULT_PUBLIC_CALENDAR_TITLE;
  await pool.request()
    .input('Value', sql.NVarChar, value)
    .input('UserID', sql.NVarChar, String(actorUserId || ''))
    .query(`
      MERGE dbo.SystemSettings AS target
      USING (SELECT 'PublicCalendarTitle' AS K) AS src
      ON target.SettingKey = src.K
      WHEN MATCHED THEN UPDATE SET SettingValue = @Value, UpdatedAt = GETDATE(), UpdatedByUserID = @UserID
      WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedAt, UpdatedByUserID)
        VALUES ('PublicCalendarTitle', @Value, GETDATE(), @UserID);
    `);
}

async function getPublicCalendarSettings(pool) {
  const [enabled, title] = await Promise.all([
    getPublicCalendarEnabled(pool),
    getPublicCalendarTitle(pool),
  ]);
  return { enabled, title };
}

// يتحقق هل صاحب الطلب مدير عام حقيقي للنظام (Role=1) — بعض إعدادات البث (الحد العام والحد الخاص
// بمنصب) حساسة ومخصصة للمدير العام فقط، وليس مديري الأقسام أو المفوَّضين. يتحقق من قاعدة البيانات
// دوماً (لا يعتمد على قيمة isAdmin القادمة من العميل وحدها).
async function isTrueSystemAdmin(pool, rawUserId) {
  const loginId = String(rawUserId || '').trim();
  if (!loginId) return false;
  try {
    const hasTable = await pool.request().query(
      `SELECT CASE WHEN OBJECT_ID('dbo.UserRoles','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTable`
    );
    if (!hasTable.recordset[0]?.HasTable) return false;
    const colProbe = await pool.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.Users','LegacyUserID') IS NOT NULL THEN 1 ELSE 0 END AS HasLegacyUserID,
        CASE WHEN COL_LENGTH('dbo.Users','ServiceID') IS NOT NULL THEN 1 ELSE 0 END AS HasServiceID
    `);
    const p = colProbe.recordset[0] || {};
    const whereParts = [`LTRIM(RTRIM(u.UserID)) = @LoginID`];
    if (p.HasLegacyUserID) whereParts.push(`LTRIM(RTRIM(u.LegacyUserID)) = @LoginID`);
    if (p.HasServiceID) whereParts.push(`LTRIM(RTRIM(u.ServiceID)) = @LoginID`);
    const result = await pool.request()
      .input('LoginID', sql.NVarChar, loginId)
      .query(`
        SELECT TOP 1 r.Role
        FROM dbo.Users u
        INNER JOIN dbo.UserRoles r ON r.UserID = u.UserID
        WHERE ${whereParts.join(' OR ')}
      `);
    return result.recordset[0]?.Role === 1;
  } catch (_) {
    return false;
  }
}

module.exports = {
  isDelegatedSharingManager,
  canManageDepartmentSharingAndBroadcast,
  hasOpenTaskShareToIndependentGroup,
  listTaskShares,
  listItemShareOptions,
  openTaskShare,
  closeTaskShare,
  setItemDepartmentShares,
  resolveFullAncestorChain,
  getMaxBroadcastDepartmentId,
  setMaxBroadcastDepartmentId,
  getVacancyMaxBroadcastDepartmentId,
  setVacancyMaxBroadcastDepartmentId,
  resolveAllowedBroadcastChain,
  isTrueSystemAdmin,
  getPublicCalendarEnabled,
  setPublicCalendarEnabled,
  getPublicCalendarTitle,
  setPublicCalendarTitle,
  getPublicCalendarSettings,
};
