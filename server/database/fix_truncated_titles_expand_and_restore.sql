/*
  Expand title columns and restore full values from source after migration.
  - Expands target dbo.Tasks.Title and dbo.Subtasks.Title to NVARCHAR(1000)
    while preserving current NULL/NOT NULL settings.
  - Restores full title values from source by TaskID/SubtaskID.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SourceDb SYSNAME = N'AlBaharTaskManagement2';
DECLARE @TargetDb SYSNAME = N'AlBaharTaskManagement';

DECLARE @sql NVARCHAR(MAX);
DECLARE @TasksTitleNullable BIT;
DECLARE @SubtasksTitleNullable BIT;

BEGIN TRY
  BEGIN TRAN;

  /* Read current nullability to keep column contract unchanged */
  SET @sql = N'
    SELECT @IsNullableOut = c.is_nullable
    FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables t ON t.object_id = c.object_id
    WHERE t.name = N''Tasks'' AND c.name = N''Title'';
  ';
  EXEC sys.sp_executesql @sql, N'@IsNullableOut BIT OUTPUT', @IsNullableOut = @TasksTitleNullable OUTPUT;

  SET @sql = N'
    SELECT @IsNullableOut = c.is_nullable
    FROM ' + QUOTENAME(@TargetDb) + N'.sys.columns c
    INNER JOIN ' + QUOTENAME(@TargetDb) + N'.sys.tables t ON t.object_id = c.object_id
    WHERE t.name = N''Subtasks'' AND c.name = N''Title'';
  ';
  EXEC sys.sp_executesql @sql, N'@IsNullableOut BIT OUTPUT', @IsNullableOut = @SubtasksTitleNullable OUTPUT;

  /* Expand column size */
  SET @sql = N'ALTER TABLE ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks ALTER COLUMN Title NVARCHAR(1000) '
    + CASE WHEN ISNULL(@TasksTitleNullable, 1) = 1 THEN N'NULL;' ELSE N'NOT NULL;' END;
  EXEC sys.sp_executesql @sql;

  SET @sql = N'ALTER TABLE ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks ALTER COLUMN Title NVARCHAR(1000) '
    + CASE WHEN ISNULL(@SubtasksTitleNullable, 1) = 1 THEN N'NULL;' ELSE N'NOT NULL;' END;
  EXEC sys.sp_executesql @sql;

  /* Restore full titles from source */
  SET @sql = N'
    UPDATE tgt
    SET tgt.Title = src.Title
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks tgt
    INNER JOIN ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks src ON src.TaskID = tgt.TaskID
    WHERE ISNULL(tgt.Title, N'''') <> ISNULL(src.Title, N'''');
  ';
  EXEC sys.sp_executesql @sql;

  SET @sql = N'
    UPDATE tgt
    SET tgt.Title = src.Title
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks tgt
    INNER JOIN ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks src ON src.SubtaskID = tgt.SubtaskID
    WHERE ISNULL(tgt.Title, N'''') <> ISNULL(src.Title, N'''');
  ';
  EXEC sys.sp_executesql @sql;

  COMMIT TRAN;

  /* Post-fix checks */
  SET @sql = N'
    SELECT
      N''Tasks.Title mismatches'' AS CheckName,
      COUNT_BIG(1) AS MismatchCount
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Tasks tgt
    INNER JOIN ' + QUOTENAME(@SourceDb) + N'.dbo.Tasks src ON src.TaskID = tgt.TaskID
    WHERE ISNULL(tgt.Title, N'''') <> ISNULL(src.Title, N'''')

    UNION ALL

    SELECT
      N''Subtasks.Title mismatches'' AS CheckName,
      COUNT_BIG(1) AS MismatchCount
    FROM ' + QUOTENAME(@TargetDb) + N'.dbo.Subtasks tgt
    INNER JOIN ' + QUOTENAME(@SourceDb) + N'.dbo.Subtasks src ON src.SubtaskID = tgt.SubtaskID
    WHERE ISNULL(tgt.Title, N'''') <> ISNULL(src.Title, N'''');
  ';
  EXEC sys.sp_executesql @sql;

  SELECT N'Expanded title columns and restored full title values successfully.' AS ResultMessage;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;

  SELECT
    ERROR_NUMBER() AS ErrorNumber,
    ERROR_MESSAGE() AS ErrorMessage,
    ERROR_LINE() AS ErrorLine,
    ERROR_PROCEDURE() AS ErrorProcedure;
END CATCH;
