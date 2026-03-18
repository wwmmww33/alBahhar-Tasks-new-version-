/*
  Post-migration verification script
  Purpose:
  1) Compare row counts between source and target for migrated operational tables.
  2) Detect referential-integrity issues in target.
  3) Estimate potential text truncation introduced by defensive LEFT(...) during migration.

  Update these names if needed.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SourceDb SYSNAME = N'AlBaharTaskManagement2';
DECLARE @TargetDb SYSNAME = N'AlBaharTaskManagement';

DECLARE @sql NVARCHAR(MAX);

IF OBJECT_ID('tempdb..#CountResults') IS NOT NULL DROP TABLE #CountResults;
CREATE TABLE #CountResults
(
  CheckName NVARCHAR(200) NOT NULL,
  SourceCount BIGINT NULL,
  TargetCount BIGINT NULL,
  Diff BIGINT NULL,
  Status NVARCHAR(20) NOT NULL
);

IF OBJECT_ID('tempdb..#IntegrityIssues') IS NOT NULL DROP TABLE #IntegrityIssues;
CREATE TABLE #IntegrityIssues
(
  CheckName NVARCHAR(200) NOT NULL,
  IssueCount BIGINT NOT NULL,
  Status NVARCHAR(20) NOT NULL
);

IF OBJECT_ID('tempdb..#LengthRisk') IS NOT NULL DROP TABLE #LengthRisk;
CREATE TABLE #LengthRisk
(
  CheckName NVARCHAR(200) NOT NULL,
  RiskCount BIGINT NOT NULL,
  Notes NVARCHAR(300) NULL
);

BEGIN TRY

  /* 1) Row-count comparisons */
  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''Tasks'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''Subtasks'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''Comments'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Comments) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Comments) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''CommentNotifications'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.CommentNotifications) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''TaskDelegations'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskDelegations) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegations) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''TaskDelegationPermissions'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskDelegationPermissions) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegationPermissions) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''TaskAssignmentNotifications'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskAssignmentNotifications) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskAssignmentNotifications) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''TaskViews'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.TaskViews) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskViews) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''UserTaskPriorities'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.UserTaskPriorities) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.UserTaskPriorities) t;';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'INSERT INTO #CountResults (CheckName, SourceCount, TargetCount, Diff, Status)
    SELECT N''PersonalCalendarEvents'', s.cnt, t.cnt, t.cnt - s.cnt, CASE WHEN t.cnt = s.cnt THEN N''OK'' ELSE N''DIFF'' END
    FROM (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@SourceDb) + N'.dbo.PersonalCalendarEvents) s
    CROSS JOIN (SELECT COUNT_BIG(1) AS cnt FROM ' + QUOTENAME(@TargetDb) + N'.dbo.PersonalCalendarEvents) t;';
  EXEC sys.sp_executesql @sql;

  /* 2) Referential/integrity checks in target */
  SET @sql = N'
    INSERT INTO #IntegrityIssues (CheckName, IssueCount, Status)
    SELECT N''Subtasks without parent Task'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks s
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks t ON t.TaskID = s.TaskID
    WHERE t.TaskID IS NULL

    UNION ALL
    SELECT N''Comments without parent Task'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Comments c
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks t ON t.TaskID = c.TaskID
    WHERE t.TaskID IS NULL

    UNION ALL
    SELECT N''CommentNotifications without parent Comment'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications n
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Comments c ON c.CommentID = n.CommentID
    WHERE c.CommentID IS NULL

    UNION ALL
    SELECT N''CommentNotifications without parent Task'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.CommentNotifications n
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks t ON t.TaskID = n.TaskID
    WHERE t.TaskID IS NULL

    UNION ALL
    SELECT N''TaskDelegationPermissions without parent Delegation'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegationPermissions p
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.TaskDelegations d ON d.DelegationID = p.DelegationID
    WHERE d.DelegationID IS NULL

    UNION ALL
    SELECT N''TaskAssignmentNotifications without parent Task'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskAssignmentNotifications n
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks t ON t.TaskID = n.TaskID
    WHERE t.TaskID IS NULL

    UNION ALL
    SELECT N''TaskViews without parent Task'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.TaskViews v
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks t ON t.TaskID = v.TaskID
    WHERE t.TaskID IS NULL

    UNION ALL
    SELECT N''UserTaskPriorities without parent Task'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.UserTaskPriorities p
    LEFT JOIN ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks t ON t.TaskID = p.TaskID
    WHERE t.TaskID IS NULL

    UNION ALL
    SELECT N''Tasks with NULL CreatedByVacancyID'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks
    WHERE CreatedByVacancyID IS NULL

    UNION ALL
    SELECT N''Subtasks with NULL CreatedByVacancyID'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks
    WHERE CreatedByVacancyID IS NULL

    UNION ALL
    SELECT N''Comments with NULL CommentedByVacancyID'', COUNT_BIG(1), CASE WHEN COUNT_BIG(1) = 0 THEN N''OK'' ELSE N''ISSUE'' END
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Comments
    WHERE CommentedByVacancyID IS NULL
  ';
  EXEC sys.sp_executesql @sql;

  /* 3) Potential truncation checks based on max length of target columns */
  SET @sql = N'
    INSERT INTO #LengthRisk (CheckName, RiskCount, Notes)
    SELECT N''Tasks.Title possibly truncated'', COUNT_BIG(1), N''Source LEN(Title) > target max chars''
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks s
    CROSS APPLY (
      SELECT CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN ty.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END AS MaxChars
      FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE tb.name = N''Tasks'' AND c.name = N''Title''
    ) x
    WHERE LEN(CONVERT(NVARCHAR(MAX), ISNULL(s.Title, N''''))) > x.MaxChars

    UNION ALL
    SELECT N''Tasks.Description possibly truncated'', COUNT_BIG(1), N''Source LEN(Description) > target max chars''
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks s
    CROSS APPLY (
      SELECT CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN ty.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END AS MaxChars
      FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE tb.name = N''Tasks'' AND c.name = N''Description''
    ) x
    WHERE LEN(CONVERT(NVARCHAR(MAX), ISNULL(s.Description, N''''))) > x.MaxChars

    UNION ALL
    SELECT N''Tasks.URL possibly truncated'', COUNT_BIG(1), N''Source LEN(URL) > target max chars''
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks s
    CROSS APPLY (
      SELECT CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN ty.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END AS MaxChars
      FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE tb.name = N''Tasks'' AND c.name = N''URL''
    ) x
    WHERE LEN(CONVERT(NVARCHAR(MAX), ISNULL(s.URL, N''''))) > x.MaxChars

    UNION ALL
    SELECT N''Subtasks.Title possibly truncated'', COUNT_BIG(1), N''Source LEN(Title) > target max chars''
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks s
    CROSS APPLY (
      SELECT CASE
        WHEN c.max_length = -1 THEN 2147483647
        WHEN ty.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2
        ELSE c.max_length
      END AS MaxChars
      FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables tb ON tb.object_id = c.object_id
      INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE tb.name = N''Subtasks'' AND c.name = N''Title''
    ) x
    WHERE LEN(CONVERT(NVARCHAR(MAX), ISNULL(s.Title, N''''))) > x.MaxChars
  ';
  EXEC sys.sp_executesql @sql;

  /* Outputs */
  SELECT CheckName, SourceCount, TargetCount, Diff, Status
  FROM #CountResults
  ORDER BY CheckName;

  SELECT CheckName, IssueCount, Status
  FROM #IntegrityIssues
  ORDER BY CheckName;

  SELECT CheckName, RiskCount, Notes
  FROM #LengthRisk
  ORDER BY CheckName;

  /* Quick pass/fail summary */
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM #CountResults WHERE Status <> N'OK')
        OR EXISTS (SELECT 1 FROM #IntegrityIssues WHERE Status <> N'OK')
      THEN N'REVIEW_REQUIRED'
      ELSE N'PASS'
    END AS VerificationStatus,
    (SELECT COUNT(1) FROM #CountResults WHERE Status <> N'OK') AS CountDiffChecks,
    (SELECT COUNT(1) FROM #IntegrityIssues WHERE Status <> N'OK') AS IntegrityIssueChecks;

END TRY
BEGIN CATCH
  SELECT
    ERROR_NUMBER() AS ErrorNumber,
    ERROR_MESSAGE() AS ErrorMessage,
    ERROR_LINE() AS ErrorLine,
    ERROR_PROCEDURE() AS ErrorProcedure;
END CATCH;
