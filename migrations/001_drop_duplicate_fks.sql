/* ============================================================
   Migration: Drop duplicate foreign-key constraints (VacancyID)
   Date:       2026-04-21
   Target DB:  AlBaharTaskManagement
   Purpose:
     أثناء الانتقال من UserID إلى VacancyID تمّ إنشاء مجموعة من
     القيود المكرّرة (constraints) على نفس الأعمدة وبنفس المرجع
     (JobVacancies.VacancyID). لا يوجد أي فائدة وظيفية من بقاء
     نسختين لنفس القيد، بل يتسبّب ذلك في:
       1. بطء التحقق (INSERT/UPDATE يتحقق من نفس المفتاح مرتين)
       2. أخطاء مضلِّلة (ظهور اسمي قيد مختلفين لنفس الخرق)
       3. صعوبة الصيانة/المراجعة المستقبلية
     هذا الـ migration آمن (idempotent): يفحص وجود كل قيد قبل
     محاولة إسقاطه.
   ============================================================ */

SET NOCOUNT ON;
GO

/* ----------------------------------------------------------------
   1. Subtasks.AssignedToVacancyID — قيد مكرَّر
      نُبقي: FK_Subtasks_AssignedToVacancy
      نُسقِط: FK_Subtasks_AssignedTo_Vacancy
   ---------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.foreign_keys
           WHERE name = N'FK_Subtasks_AssignedTo_Vacancy'
             AND parent_object_id = OBJECT_ID(N'dbo.Subtasks'))
BEGIN
    ALTER TABLE [dbo].[Subtasks] DROP CONSTRAINT [FK_Subtasks_AssignedTo_Vacancy];
    PRINT 'Dropped FK_Subtasks_AssignedTo_Vacancy';
END
ELSE
BEGIN
    PRINT 'Skipped FK_Subtasks_AssignedTo_Vacancy (not present)';
END
GO

/* ----------------------------------------------------------------
   2. Tasks.CreatedByVacancyID — قيد مكرَّر
      نُبقي: FK_Tasks_CreatedByVacancy
      نُسقِط: FK_Tasks_CreatedBy_Vacancy
   ---------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.foreign_keys
           WHERE name = N'FK_Tasks_CreatedBy_Vacancy'
             AND parent_object_id = OBJECT_ID(N'dbo.Tasks'))
BEGIN
    ALTER TABLE [dbo].[Tasks] DROP CONSTRAINT [FK_Tasks_CreatedBy_Vacancy];
    PRINT 'Dropped FK_Tasks_CreatedBy_Vacancy';
END
ELSE
BEGIN
    PRINT 'Skipped FK_Tasks_CreatedBy_Vacancy (not present)';
END
GO

/* ----------------------------------------------------------------
   3. Tasks.LastActedByVacancyID — قيد مكرَّر
      نُبقي: FK_Tasks_LastActedByVacancy
      نُسقِط: FK_Tasks_ActedBy_Vacancy
   ---------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.foreign_keys
           WHERE name = N'FK_Tasks_ActedBy_Vacancy'
             AND parent_object_id = OBJECT_ID(N'dbo.Tasks'))
BEGIN
    ALTER TABLE [dbo].[Tasks] DROP CONSTRAINT [FK_Tasks_ActedBy_Vacancy];
    PRINT 'Dropped FK_Tasks_ActedBy_Vacancy';
END
ELSE
BEGIN
    PRINT 'Skipped FK_Tasks_ActedBy_Vacancy (not present)';
END
GO

/* ----------------------------------------------------------------
   4. Comments.CommentedByVacancyID — قيد مكرَّر
      نُبقي: FK_Comments_CommentedByVacancy
      نُسقِط: FK_Comments_User_Vacancy
   ---------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.foreign_keys
           WHERE name = N'FK_Comments_User_Vacancy'
             AND parent_object_id = OBJECT_ID(N'dbo.Comments'))
BEGIN
    ALTER TABLE [dbo].[Comments] DROP CONSTRAINT [FK_Comments_User_Vacancy];
    PRINT 'Dropped FK_Comments_User_Vacancy';
END
ELSE
BEGIN
    PRINT 'Skipped FK_Comments_User_Vacancy (not present)';
END
GO

/* ----------------------------------------------------------------
   التحقق: عدد القيود المتبقية على الأعمدة المستهدفة يجب أن يكون 1
   ---------------------------------------------------------------- */
SELECT
    t.name  AS TableName,
    c.name  AS ColumnName,
    COUNT(*) AS FKCount
FROM sys.foreign_keys fk
INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
INNER JOIN sys.tables  t ON t.object_id = fk.parent_object_id
INNER JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE c.name IN (
    N'AssignedToVacancyID',
    N'CreatedByVacancyID',
    N'LastActedByVacancyID',
    N'CommentedByVacancyID'
)
  AND t.name IN (N'Subtasks', N'Tasks', N'Comments')
GROUP BY t.name, c.name
ORDER BY t.name, c.name;
GO

PRINT 'Migration 001_drop_duplicate_fks completed.';
