/*
  Production -> New DB data migration using existing mapping in new.sql
  IMPORTANT:
  - Keeps mapping tables in target as-is: Users, JobVacancies, Assignments
  - Maps old production UserID to target VacancyID through target.Users.ServiceID (or LegacyUserID) + Assignments(IsCurrent=1)
  - Only migrates operational/business data.

  Before running:
  1) Restore production dump to a separate DB name (example: AlBaharTaskManagement_Prod)
  2) Restore new.sql to target DB name (example: AlBaharTaskManagement_New)
  3) Review @SourceDb and @TargetDb
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SourceDb SYSNAME = N'AlBaharTaskManagement2';
DECLARE @TargetDb SYSNAME = N'AlBaharTaskManagement';
DECLARE @AllowFallbackToSystemUser BIT = 1;
DECLARE @TaskTitleMaxChars INT;
DECLARE @TaskDescriptionMaxChars INT;
DECLARE @TaskUrlMaxChars INT;
DECLARE @SubtaskTitleMaxChars INT;

DECLARE @sql NVARCHAR(MAX);

BEGIN TRY
  BEGIN TRAN;

  /* 1) Build user/vacancy mapping from target only (authoritative mapping) */
  IF OBJECT_ID('tempdb..#UserMap') IS NOT NULL DROP TABLE #UserMap;

  CREATE TABLE #UserMap
  (
    SourceUserID NVARCHAR(100) NOT NULL,
    TargetUserID NVARCHAR(50) NOT NULL,
    TargetVacancyID INT NOT NULL
  );

  SET @sql = N'
    INSERT INTO #UserMap (SourceUserID, TargetUserID, TargetVacancyID)
    SELECT DISTINCT
      LTRIM(RTRIM(srcKey.SourceUserID)) AS SourceUserID,
      tgtU.UserID AS TargetUserID,
      pickA.VacancyID AS TargetVacancyID
    FROM (
      SELECT DISTINCT UserID AS SourceUserID
      FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Users
      WHERE UserID IS NOT NULL AND LTRIM(RTRIM(UserID)) <> ''''
      UNION
      SELECT DISTINCT ServiceID AS SourceUserID
      FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Users
      WHERE ServiceID IS NOT NULL AND LTRIM(RTRIM(ServiceID)) <> ''''
      UNION
      SELECT DISTINCT LegacyUserID AS SourceUserID
      FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Users
      WHERE LegacyUserID IS NOT NULL AND LTRIM(RTRIM(LegacyUserID)) <> ''''
    ) srcKey
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Users tgtU
      ON LTRIM(RTRIM(tgtU.UserID)) = LTRIM(RTRIM(srcKey.SourceUserID))
      OR LTRIM(RTRIM(tgtU.ServiceID)) = LTRIM(RTRIM(srcKey.SourceUserID))
      OR LTRIM(RTRIM(tgtU.LegacyUserID)) = LTRIM(RTRIM(srcKey.SourceUserID))
    OUTER APPLY (
      SELECT TOP (1) a.VacancyID
      FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Assignments a
      WHERE a.UserID = tgtU.UserID
      ORDER BY
        CASE WHEN a.IsCurrent = 1 THEN 0 ELSE 1 END,
        ISNULL(a.StartDate, ''19000101'') DESC,
        a.AssignmentID DESC
    ) pickA
    WHERE pickA.VacancyID IS NOT NULL;
  ';
  EXEC sys.sp_executesql @sql;

  /* Fallback for admin source ID when no assignment exists */
  SET @sql = N'
    INSERT INTO #UserMap (SourceUserID, TargetUserID, TargetVacancyID)
    SELECT
      N''admin'' AS SourceUserID,
      u.UserID AS TargetUserID,
      v.VacancyID AS TargetVacancyID
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Users u
    CROSS APPLY (
      SELECT TOP (1) j.VacancyID
      FROM ' + QUOTENAME(@TargetDb) + N'.dbo.JobVacancies j
      ORDER BY
        CASE WHEN j.Name LIKE N''%مدير النظام%'' THEN 0 ELSE 1 END,
        j.VacancyID
    ) v
    WHERE (LTRIM(RTRIM(u.ServiceID)) = N''admin'' OR LTRIM(RTRIM(u.UserID)) = N''admin'')
      AND NOT EXISTS (
        SELECT 1 FROM #UserMap m WHERE LTRIM(RTRIM(m.SourceUserID)) = N''admin''
      );
  ';
  EXEC sys.sp_executesql @sql;

  /* 2) Safety check: unmapped users that are used in source transactional tables */
  IF OBJECT_ID('tempdb..#UnmappedSourceUsers') IS NOT NULL DROP TABLE #UnmappedSourceUsers;

  CREATE TABLE #UnmappedSourceUsers
  (
    UserID NVARCHAR(100) NOT NULL
  );

  SET @sql = N'
    INSERT INTO #UnmappedSourceUsers (UserID)
    SELECT DISTINCT srcUsers.UserID
    FROM (
      SELECT CreatedBy AS UserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks
      UNION SELECT AssignedTo FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks WHERE AssignedTo IS NOT NULL
      UNION SELECT CreatedBy FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks
      UNION SELECT AssignedTo FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks WHERE AssignedTo IS NOT NULL
      UNION SELECT UserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Comments
      UNION SELECT ActedBy FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Comments WHERE ActedBy IS NOT NULL
      UNION SELECT CommentedByUserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.CommentNotifications
      UNION SELECT NotifyUserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.CommentNotifications
      UNION SELECT DelegatorUserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskDelegations
      UNION SELECT DelegateUserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskDelegations
      UNION SELECT UserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskViews
      UNION SELECT UserID FROM ' + QUOTENAME(@SourceDb) + N'.dbo.UserTaskPriorities
    ) srcUsers
    LEFT JOIN #UserMap m ON LTRIM(RTRIM(m.SourceUserID)) = LTRIM(RTRIM(srcUsers.UserID))
    WHERE srcUsers.UserID IS NOT NULL AND m.SourceUserID IS NULL;
  ';
  EXEC sys.sp_executesql @sql;

  /* Optional fallback: map any remaining source IDs to system/admin mapping */
  IF @AllowFallbackToSystemUser = 1
  BEGIN
    IF OBJECT_ID('tempdb..#SystemFallback') IS NOT NULL DROP TABLE #SystemFallback;

    CREATE TABLE #SystemFallback
    (
      TargetUserID NVARCHAR(50) NOT NULL,
      TargetVacancyID INT NOT NULL
    );

    SET @sql = N'
      INSERT INTO #SystemFallback (TargetUserID, TargetVacancyID)
      SELECT TOP (1)
        u.UserID,
        v.VacancyID
      FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Users u
      CROSS APPLY (
        SELECT TOP (1) j.VacancyID
        FROM ' + QUOTENAME(@TargetDb) + N'.dbo.JobVacancies j
        ORDER BY
          CASE WHEN j.Name LIKE N''%مدير النظام%'' THEN 0 ELSE 1 END,
          j.VacancyID
      ) v
      WHERE LTRIM(RTRIM(u.ServiceID)) = N''admin''
         OR LTRIM(RTRIM(u.UserID)) = N''1''
         OR LTRIM(RTRIM(u.UserID)) = N''admin''
      ORDER BY
        CASE WHEN LTRIM(RTRIM(u.ServiceID)) = N''admin'' THEN 0 ELSE 1 END,
        CASE WHEN LTRIM(RTRIM(u.UserID)) = N''1'' THEN 0 ELSE 1 END;
    ';
    EXEC sys.sp_executesql @sql;

    INSERT INTO #UserMap (SourceUserID, TargetUserID, TargetVacancyID)
    SELECT DISTINCT
      LTRIM(RTRIM(u.UserID)) AS SourceUserID,
      sf.TargetUserID,
      sf.TargetVacancyID
    FROM #UnmappedSourceUsers u
    CROSS JOIN #SystemFallback sf
    WHERE NOT EXISTS (
      SELECT 1 FROM #UserMap m
      WHERE LTRIM(RTRIM(m.SourceUserID)) = LTRIM(RTRIM(u.UserID))
    );

    DELETE u
    FROM #UnmappedSourceUsers u
    INNER JOIN #UserMap m
      ON LTRIM(RTRIM(m.SourceUserID)) = LTRIM(RTRIM(u.UserID));
  END

  IF EXISTS (SELECT 1 FROM #UnmappedSourceUsers)
  BEGIN
    SELECT DISTINCT UserID AS UnmappedUserID
    FROM #UnmappedSourceUsers
    ORDER BY UnmappedUserID;

    RAISERROR(N'Unmapped source UserID values found. Review #UnmappedSourceUsers before migration.', 16, 1);
  END

  /* 3) Clear target operational tables only (keep mapping tables untouched) */
  SET @sql = N'
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegationPermissions;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegations;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Comments;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskAssignmentNotifications;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskViews;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.UserTaskPriorities;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.PersonalCalendarEvents;
    IF OBJECT_ID(''' + QUOTENAME(@TargetDb) + N'.dbo.PersonalEvents'', ''U'') IS NOT NULL DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.PersonalEvents;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.ProcedureSubtasks;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Procedures;
    DELETE FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks;
  ';
  EXEC sys.sp_executesql @sql;

  /* Read target Tasks column lengths to avoid truncation errors (2628) */
  SET @sql = N'
    SELECT @Out =
      CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN t.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END
    FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types t ON t.user_type_id = c.user_type_id
    WHERE tb.name = N''Tasks'' AND c.name = N''Title'';
  ';
  EXEC sys.sp_executesql @sql, N'@Out INT OUTPUT', @Out = @TaskTitleMaxChars OUTPUT;

  SET @sql = N'
    SELECT @Out =
      CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN t.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END
    FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types t ON t.user_type_id = c.user_type_id
    WHERE tb.name = N''Tasks'' AND c.name = N''Description'';
  ';
  EXEC sys.sp_executesql @sql, N'@Out INT OUTPUT', @Out = @TaskDescriptionMaxChars OUTPUT;

  SET @sql = N'
    SELECT @Out =
      CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN t.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END
    FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types t ON t.user_type_id = c.user_type_id
    WHERE tb.name = N''Tasks'' AND c.name = N''URL'';
  ';
  EXEC sys.sp_executesql @sql, N'@Out INT OUTPUT', @Out = @TaskUrlMaxChars OUTPUT;

  SET @TaskTitleMaxChars = ISNULL(@TaskTitleMaxChars, 255);
  SET @TaskDescriptionMaxChars = ISNULL(@TaskDescriptionMaxChars, 4000);
  SET @TaskUrlMaxChars = ISNULL(@TaskUrlMaxChars, 2048);

  SET @sql = N'
    SELECT @Out =
      CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN t.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END
    FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types t ON t.user_type_id = c.user_type_id
    WHERE tb.name = N''Subtasks'' AND c.name = N''Title'';
  ';
  EXEC sys.sp_executesql @sql, N'@Out INT OUTPUT', @Out = @SubtaskTitleMaxChars OUTPUT;

  SET @SubtaskTitleMaxChars = ISNULL(@SubtaskTitleMaxChars, 255);

  /* 4) Migrate tasks */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks
    (
      TaskID, Title, Description, DepartmentID, Priority, Status, DueDate,
      CreatedAt, UpdatedAt, CategoryID, URL,
      CreatedByVacancyID, LastActedByVacancyID, ActedBy
    )
    SELECT
      s.TaskID,
      s.Title,
      CASE WHEN s.Description IS NULL THEN NULL ELSE LEFT(CONVERT(NVARCHAR(MAX), s.Description), ' + CAST(@TaskDescriptionMaxChars AS NVARCHAR(20)) + N') END,
      s.DepartmentID,
      s.Priority,
      s.Status,
      s.DueDate,
      s.CreatedAt,
      s.UpdatedAt,
      s.CategoryID,
      CASE WHEN s.URL IS NULL THEN NULL ELSE LEFT(CONVERT(NVARCHAR(MAX), s.URL), ' + CAST(@TaskUrlMaxChars AS NVARCHAR(20)) + N') END,
      mCreate.TargetVacancyID,
      mAct.TargetVacancyID,
      mAct.TargetUserID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks s
    INNER JOIN #UserMap mCreate ON mCreate.SourceUserID = s.CreatedBy
    LEFT JOIN #UserMap mAct ON mAct.SourceUserID = s.ActedBy;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks OFF;
  ';
  EXEC sys.sp_executesql @sql;

  /* 5) Migrate subtasks */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks
    (
      SubtaskID, TaskID, Title, IsCompleted, DueDate, CreatedAt, ShowInCalendar,
      CreatedByVacancyID, AssignedToVacancyID, LastActedByVacancyID, ActedBy
    )
    SELECT
      s.SubtaskID,
      s.TaskID,
      s.Title,
      s.IsCompleted,
      s.DueDate,
      s.CreatedAt,
      ISNULL(s.ShowInCalendar, 0),
      mCreate.TargetVacancyID,
      mAssign.TargetVacancyID,
      mAct.TargetVacancyID,
      mAct.TargetUserID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks s
    INNER JOIN #UserMap mCreate ON mCreate.SourceUserID = s.CreatedBy
    LEFT JOIN #UserMap mAssign ON mAssign.SourceUserID = s.AssignedTo
    LEFT JOIN #UserMap mAct ON mAct.SourceUserID = s.ActedBy;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks OFF;
  ';
  EXEC sys.sp_executesql @sql;

  /* 6) Migrate comments */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.Comments ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.Comments
    (
      CommentID, TaskID, Content, CreatedAt,
      CommentedByVacancyID, LastActedByVacancyID, ActedBy
    )
    SELECT
      c.CommentID,
      c.TaskID,
      c.Content,
      c.CreatedAt,
      mComment.TargetVacancyID,
      mAct.TargetVacancyID,
      mAct.TargetUserID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Comments c
    INNER JOIN #UserMap mComment ON mComment.SourceUserID = c.UserID
    LEFT JOIN #UserMap mAct ON mAct.SourceUserID = c.ActedBy;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.Comments OFF;
  ';
  EXEC sys.sp_executesql @sql;

  /* 7) Migrate comment notifications */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications
    (
      NotificationID, CommentID, TaskID, NotificationType, IsRead, CreatedAt, ReadAt,
      CommentedByVacancyID, NotifyVacancyID
    )
    SELECT
      n.NotificationID,
      n.CommentID,
      n.TaskID,
      n.NotificationType,
      n.IsRead,
      n.CreatedAt,
      n.ReadAt,
      mFrom.TargetVacancyID,
      mTo.TargetVacancyID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.CommentNotifications n
    INNER JOIN #UserMap mFrom ON mFrom.SourceUserID = n.CommentedByUserID
    INNER JOIN #UserMap mTo ON mTo.SourceUserID = n.NotifyUserID;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications OFF;
  ';
  EXEC sys.sp_executesql @sql;

  /* 8) Migrate delegations */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegations ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegations
    (
      DelegationID, DelegationType, StartDate, EndDate, IsActive, Reason,
      CreatedAt, UpdatedAt, DelegationSecretHash,
      DelegatorVacancyID, DelegateVacancyID, CreatedBy
    )
    SELECT
      d.DelegationID,
      d.DelegationType,
      d.StartDate,
      d.EndDate,
      d.IsActive,
      d.Reason,
      d.CreatedAt,
      d.UpdatedAt,
      d.DelegationSecretHash,
      mDelegator.TargetVacancyID,
      mDelegate.TargetVacancyID,
      mCreated.TargetVacancyID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskDelegations d
    INNER JOIN #UserMap mDelegator ON mDelegator.SourceUserID = d.DelegatorUserID
    INNER JOIN #UserMap mDelegate ON mDelegate.SourceUserID = d.DelegateUserID
    INNER JOIN #UserMap mCreated ON mCreated.SourceUserID = d.CreatedBy;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegations OFF;

    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegationPermissions ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegationPermissions (DelegationPermissionID, DelegationID, PermissionType, IsGranted)
    SELECT DelegationPermissionID, DelegationID, PermissionType, IsGranted
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskDelegationPermissions;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegationPermissions OFF;
  ';
  EXEC sys.sp_executesql @sql;

  /* 9) Migrate task assignments notifications */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskAssignmentNotifications ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.TaskAssignmentNotifications
    (
      NotificationID, TaskID, IsRead, CreatedAt, ReadAt,
      AssignedToVacancyID, AssignedByVacancyID
    )
    SELECT
      n.NotificationID,
      n.TaskID,
      n.IsRead,
      n.CreatedAt,
      n.ReadAt,
      mTo.TargetVacancyID,
      mBy.TargetVacancyID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskAssignmentNotifications n
    INNER JOIN #UserMap mTo ON mTo.SourceUserID = n.AssignedToUserID
    INNER JOIN #UserMap mBy ON mBy.SourceUserID = n.AssignedByUserID;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskAssignmentNotifications OFF;
  ';
  EXEC sys.sp_executesql @sql;

  /* 10) Migrate task views + priorities + personal events */
  SET @sql = N'
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskViews ON;
    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.TaskViews (ViewID, TaskID, LastViewedAt, ViewedByVacancyID)
    SELECT v.ViewID, v.TaskID, v.LastViewedAt, m.TargetVacancyID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskViews v
    INNER JOIN #UserMap m ON m.SourceUserID = v.UserID;
    SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.TaskViews OFF;

    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.UserTaskPriorities (TaskID, Priority, CreatedAt, UpdatedAt, VacancyID)
    SELECT p.TaskID, p.Priority, p.CreatedAt, p.UpdatedAt, m.TargetVacancyID
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.UserTaskPriorities p
    INNER JOIN #UserMap m ON m.SourceUserID = p.UserID;

    INSERT INTO ' + QUOTENAME(@TargetDb) + N'.dbo.PersonalCalendarEvents (UserID, Title, EventDate, CreatedAt)
    SELECT m.TargetUserID, e.Title, e.EventDate, e.CreatedAt
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.PersonalCalendarEvents e
    INNER JOIN #UserMap m ON m.SourceUserID = e.UserID;
  ';
  EXEC sys.sp_executesql @sql;

  COMMIT TRAN;

  SELECT N'Migration completed successfully using target mapping data only.' AS ResultMessage;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;

  SELECT
    ERROR_NUMBER() AS ErrorNumber,
    ERROR_MESSAGE() AS ErrorMessage,
    ERROR_LINE() AS ErrorLine,
    ERROR_PROCEDURE() AS ErrorProcedure;
END CATCH;
