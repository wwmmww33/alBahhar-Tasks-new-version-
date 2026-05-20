/* ============================================================
   Migration: Create UserRoles table
   Date:       2026-05-20
   Target DB:  AlBaharTaskManagement
   Purpose:
     إنشاء جدول UserRoles لتخزين أدوار المستخدمين:
       0 = مستخدم عادي  (الافتراضي، لا يحتاج سجلاً في الجدول)
       1 = مدير عام للنظام (صلاحيات كاملة)
       2 = مدير قسم مستقل (إدارة الأقسام والمناصب والتعيينات ضمن تقسيمه)
   ملاحظة: المستخدمون غير الموجودين في الجدول يُعاملون تلقائياً كـ Role=0
   ============================================================ */

SET NOCOUNT ON;
GO

/* ----------------------------------------------------------------
   1. إنشاء الجدول إن لم يكن موجوداً
   ---------------------------------------------------------------- */
IF OBJECT_ID('dbo.UserRoles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserRoles (
        UserID  NVARCHAR(50) NOT NULL,
        Role    INT          NOT NULL DEFAULT 0,

        CONSTRAINT PK_UserRoles PRIMARY KEY (UserID),
        CONSTRAINT FK_UserRoles_Users FOREIGN KEY (UserID)
            REFERENCES dbo.Users(UserID)
            ON DELETE CASCADE
            ON UPDATE CASCADE,
        CONSTRAINT CK_UserRoles_Role CHECK (Role IN (0, 1, 2))
    );
    PRINT 'Table UserRoles created.';
END
ELSE
BEGIN
    PRINT 'Table UserRoles already exists — skipped creation.';
END
GO

/* ----------------------------------------------------------------
   2. عرض المستخدمين الحاليين لتسهيل اختيار من تريد تعيينه مديراً
      (دفاعي: يستخدم SQL ديناميكي لتجنب خطأ parse-time على أعمدة غير موجودة)
   ---------------------------------------------------------------- */
DECLARE @sql2 NVARCHAR(MAX);

IF COL_LENGTH('dbo.Users', 'DepartmentID') IS NOT NULL
    SET @sql2 = N'
        SELECT u.UserID, u.FullName,
               ISNULL(d.Name, N''—'') AS DepartmentName,
               u.IsActive,
               ISNULL(ur.Role, 0) AS CurrentRole
        FROM dbo.Users u
        LEFT JOIN dbo.Departments d  ON d.DepartmentID = u.DepartmentID
        LEFT JOIN dbo.UserRoles   ur ON ur.UserID = u.UserID
        ORDER BY u.FullName;';
ELSE IF OBJECT_ID('dbo.Assignments','U') IS NOT NULL
     AND OBJECT_ID('dbo.JobVacancies','U') IS NOT NULL
    SET @sql2 = N'
        SELECT u.UserID, u.FullName,
               ISNULL(d.Name, N''—'') AS DepartmentName,
               u.IsActive,
               ISNULL(ur.Role, 0) AS CurrentRole
        FROM dbo.Users u
        LEFT JOIN dbo.Assignments  a  ON a.UserID = u.UserID
        LEFT JOIN dbo.JobVacancies jv ON jv.VacancyID = a.VacancyID
        LEFT JOIN dbo.Departments  d  ON d.DepartmentID = jv.DepartmentID
        LEFT JOIN dbo.UserRoles    ur ON ur.UserID = u.UserID
        ORDER BY u.FullName;';
ELSE
    SET @sql2 = N'
        SELECT u.UserID, u.FullName,
               N''—'' AS DepartmentName,
               u.IsActive,
               ISNULL(ur.Role, 0) AS CurrentRole
        FROM dbo.Users u
        LEFT JOIN dbo.UserRoles ur ON ur.UserID = u.UserID
        ORDER BY u.FullName;';

EXEC sp_executesql @sql2;
GO

/* ----------------------------------------------------------------
   3. تعيين المدير العام (Role = 1)
      *** عدّل @AdminUserID ليطابق معرّف المدير الذي تريده ***
   ---------------------------------------------------------------- */
DECLARE @AdminUserID NVARCHAR(50) = N'REPLACE_WITH_ADMIN_USERID'; -- ← ضع UserID هنا

IF @AdminUserID <> N'REPLACE_WITH_ADMIN_USERID'
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Users WHERE UserID = @AdminUserID)
    BEGIN
        MERGE dbo.UserRoles AS target
        USING (SELECT @AdminUserID AS UserID, 1 AS Role) AS src
            ON target.UserID = src.UserID
        WHEN MATCHED THEN
            UPDATE SET Role = 1
        WHEN NOT MATCHED THEN
            INSERT (UserID, Role) VALUES (@AdminUserID, 1);
        PRINT 'Admin role (1) assigned to: ' + @AdminUserID;
    END
    ELSE
        PRINT 'ERROR: UserID not found — ' + @AdminUserID;
END
ELSE
    PRINT 'Skipped admin assignment — replace REPLACE_WITH_ADMIN_USERID with the actual UserID.';
GO

/* ----------------------------------------------------------------
   4. (اختياري) تعيين مديري أقسام (Role = 2)
      أضف أسطر MERGE إضافية بنفس الأسلوب لكل مدير قسم مستقل
   ---------------------------------------------------------------- */
/*
DECLARE @ManagerID NVARCHAR(50) = N'REPLACE_WITH_MANAGER_USERID';
MERGE dbo.UserRoles AS target
USING (SELECT @ManagerID AS UserID, 2 AS Role) AS src
    ON target.UserID = src.UserID
WHEN MATCHED THEN UPDATE SET Role = 2
WHEN NOT MATCHED THEN INSERT (UserID, Role) VALUES (@ManagerID, 2);
*/

/* ----------------------------------------------------------------
   5. التحقق النهائي
   ---------------------------------------------------------------- */
SELECT
    ur.UserID,
    u.FullName,
    ur.Role,
    CASE ur.Role
        WHEN 0 THEN N'مستخدم عادي'
        WHEN 1 THEN N'مدير عام'
        WHEN 2 THEN N'مدير قسم'
        ELSE N'غير معروف'
    END AS RoleLabel
FROM dbo.UserRoles ur
JOIN dbo.Users u ON u.UserID = ur.UserID
ORDER BY ur.Role, u.FullName;
GO

PRINT 'Migration 002_create_user_roles completed.';
GO
