// src/utils/dbMigrations.js
const sql = require('mssql');

async function ensureSubtasksCalendarFlag(pool) {
  const checkQuery = "SELECT COL_LENGTH('dbo.Subtasks', 'ShowInCalendar') AS Len";
  try {
    const check = await pool.request().query(checkQuery);
    const exists = !!(check.recordset && check.recordset[0] && check.recordset[0].Len);
    if (exists) {
      console.log('ℹ️ ShowInCalendar column already exists in Subtasks.');
      return { changed: false };
    }

    const alterQuery = `
      IF COL_LENGTH('dbo.Subtasks', 'ShowInCalendar') IS NULL
      BEGIN
          ALTER TABLE dbo.Subtasks ADD ShowInCalendar BIT NOT NULL CONSTRAINT DF_Subtasks_ShowInCalendar DEFAULT(0);
      END
    `;
    await pool.request().query(alterQuery);
    console.log('✅ Added ShowInCalendar column to Subtasks table.');
    return { changed: true };
  } catch (err) {
    console.error('❌ Failed ensuring ShowInCalendar column:', err);
    throw err;
  }
}

async function ensureCommentsCalendarFlag(pool) {
  const checkQuery = "SELECT COL_LENGTH('dbo.Comments', 'ShowInCalendar') AS Len";
  try {
    const check = await pool.request().query(checkQuery);
    const exists = !!(check.recordset && check.recordset[0] && check.recordset[0].Len);
    if (exists) {
      console.log('ℹ️ ShowInCalendar column already exists in Comments.');
      return { changed: false };
    }

    const alterQuery = `
      IF COL_LENGTH('dbo.Comments', 'ShowInCalendar') IS NULL
      BEGIN
          ALTER TABLE dbo.Comments ADD ShowInCalendar BIT NOT NULL CONSTRAINT DF_Comments_ShowInCalendar DEFAULT(0);
      END
    `;
    await pool.request().query(alterQuery);
    console.log('✅ Added ShowInCalendar column to Comments table.');
    return { changed: true };
  } catch (err) {
    console.error('❌ Failed ensuring ShowInCalendar column in Comments:', err);
    throw err;
  }
}

module.exports = {
  ensureSubtasksCalendarFlag,
  ensureCommentsCalendarFlag,
  // يضمن وجود جدول أحداث التقويم الخاصة بالمستخدم (آمن للتشغيل المتكرر)
  ensurePersonalEventsTable: async function ensurePersonalEventsTable(pool) {
    try {
      const tableCheck = await pool.request().query(`
        SELECT COUNT(*) as tableExists 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_NAME = 'PersonalCalendarEvents'
      `);
      const exists = tableCheck.recordset[0].tableExists > 0;
      if (exists) {
        console.log('ℹ️ PersonalCalendarEvents table already exists.');
        return { changed: false };
      }

      const createQuery = `
        CREATE TABLE dbo.PersonalCalendarEvents (
          EventID INT IDENTITY(1,1) PRIMARY KEY,
          UserID NVARCHAR(50) NOT NULL,
          Title NVARCHAR(400) NOT NULL,
          EventDate DATE NOT NULL,
          CreatedAt DATETIME NOT NULL CONSTRAINT DF_PersonalCalendarEvents_CreatedAt DEFAULT(GETDATE())
        );
        CREATE INDEX IX_PersonalCalendarEvents_UserDate ON dbo.PersonalCalendarEvents(UserID, EventDate);
      `;
      await pool.request().query(createQuery);
      console.log('✅ Created PersonalCalendarEvents table.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring PersonalCalendarEvents table:', err);
      throw err;
    }
  }
  ,
  // إضافة أعمدة ActedBy إلى الجداول Tasks/Subtasks/Comments إذا لم تكن موجودة
  ensureActedByColumns: async function ensureActedByColumns(pool) {
    try {
      const queries = `
        IF COL_LENGTH('dbo.Tasks', 'ActedBy') IS NULL BEGIN
          ALTER TABLE dbo.Tasks ADD ActedBy NVARCHAR(50) NULL;
        END;

        IF COL_LENGTH('dbo.Subtasks', 'ActedBy') IS NULL BEGIN
          ALTER TABLE dbo.Subtasks ADD ActedBy NVARCHAR(50) NULL;
        END;

        IF COL_LENGTH('dbo.Comments', 'ActedBy') IS NULL BEGIN
          ALTER TABLE dbo.Comments ADD ActedBy NVARCHAR(50) NULL;
        END;
      `;
      await pool.request().query(queries);
      console.log('✅ Ensured ActedBy columns exist in Tasks/Subtasks/Comments.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring ActedBy columns:', err);
      throw err;
    }
  },

  // إضافة عمود DelegationPasswordHash إلى جدول Users إذا لم يكن موجودًا
  ensureDelegationPasswordHashInUsers: async function ensureDelegationPasswordHashInUsers(pool) {
    try {
      const query = `
        IF COL_LENGTH('dbo.Users', 'DelegationPasswordHash') IS NULL BEGIN
          ALTER TABLE dbo.Users ADD DelegationPasswordHash NVARCHAR(256) NULL;
        END;
      `;
      await pool.request().query(query);
      console.log('✅ Ensured DelegationPasswordHash column exists in Users.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring DelegationPasswordHash column in Users:', err);
      throw err;
    }
  },

  // إضافة عمود DelegationSecretHash إلى جدول TaskDelegations إذا لم يكن موجودًا
  ensureDelegationSecretHashInTaskDelegations: async function ensureDelegationSecretHashInTaskDelegations(pool) {
    try {
      const query = `
        IF COL_LENGTH('dbo.TaskDelegations', 'DelegationSecretHash') IS NULL BEGIN
          ALTER TABLE dbo.TaskDelegations ADD DelegationSecretHash NVARCHAR(256) NULL;
        END;
      `;
      await pool.request().query(query);
      console.log('✅ Ensured DelegationSecretHash column exists in TaskDelegations.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring DelegationSecretHash column in TaskDelegations:', err);
      throw err;
    }
  },

  // إنشاء جدول TaskDelegations إذا لم يكن موجودًا (آمن للتشغيل المتكرر)
  ensureTaskDelegationsTable: async function ensureTaskDelegationsTable(pool) {
    try {
      const tableCheck = await pool.request().query(`
        SELECT COUNT(*) as tableExists 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TaskDelegations'
      `);
      const exists = tableCheck.recordset[0].tableExists > 0;
      if (exists) {
        console.log('ℹ️ TaskDelegations table already exists.');
        return { changed: false };
      }

      const createQuery = `
        CREATE TABLE dbo.TaskDelegations (
          DelegationID INT IDENTITY(1,1) PRIMARY KEY,
          DelegatorUserID NVARCHAR(50) NOT NULL,
          DelegateUserID NVARCHAR(50) NOT NULL,
          DelegationType NVARCHAR(20) NOT NULL CONSTRAINT CK_TaskDelegations_Type CHECK (DelegationType IN ('full','limited')),
          StartDate DATETIME NOT NULL CONSTRAINT DF_TaskDelegations_StartDate DEFAULT(GETDATE()),
          EndDate DATETIME NULL,
          IsActive BIT NOT NULL CONSTRAINT DF_TaskDelegations_IsActive DEFAULT(1),
          Reason NVARCHAR(500) NULL,
          CreatedAt DATETIME NOT NULL CONSTRAINT DF_TaskDelegations_CreatedAt DEFAULT(GETDATE()),
          UpdatedAt DATETIME NULL,
          CreatedBy NVARCHAR(50) NOT NULL,
          CONSTRAINT FK_TaskDelegations_Delegator FOREIGN KEY (DelegatorUserID) REFERENCES dbo.Users(UserID),
          CONSTRAINT FK_TaskDelegations_Delegate FOREIGN KEY (DelegateUserID) REFERENCES dbo.Users(UserID)
        );
        CREATE INDEX IX_TaskDelegations_Delegator ON dbo.TaskDelegations(DelegatorUserID);
        CREATE INDEX IX_TaskDelegations_Delegate ON dbo.TaskDelegations(DelegateUserID);
        CREATE INDEX IX_TaskDelegations_ActivePeriod ON dbo.TaskDelegations(IsActive, StartDate, EndDate);
      `;
      await pool.request().query(createQuery);
      console.log('✅ Created TaskDelegations table.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring TaskDelegations table:', err);
      throw err;
    }
  },
  
  // إنشاء جدول TaskDelegationPermissions إذا لم يكن موجودًا (آمن للتشغيل المتكرر)
  ensureTaskDelegationPermissionsTable: async function ensureTaskDelegationPermissionsTable(pool) {
    try {
      const tableCheck = await pool.request().query(`
        SELECT COUNT(*) as tableExists 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TaskDelegationPermissions'
      `);
      const exists = tableCheck.recordset[0].tableExists > 0;
      if (exists) {
        console.log('ℹ️ TaskDelegationPermissions table already exists.');
        return { changed: false };
      }

      const createQuery = `
        CREATE TABLE dbo.TaskDelegationPermissions (
          PermissionID INT IDENTITY(1,1) PRIMARY KEY,
          DelegationID INT NOT NULL,
          PermissionType NVARCHAR(50) NOT NULL CONSTRAINT CK_TaskDelegationPermissions_Type CHECK (PermissionType IN ('view','edit','assign','close','delete','create')),
          IsGranted BIT NOT NULL CONSTRAINT DF_TaskDelegationPermissions_IsGranted DEFAULT(1),
          CONSTRAINT FK_TaskDelegationPermissions_Delegation FOREIGN KEY (DelegationID) REFERENCES dbo.TaskDelegations(DelegationID) ON DELETE CASCADE
        );
        CREATE INDEX IX_TaskDelegationPermissions_Delegation ON dbo.TaskDelegationPermissions(DelegationID, PermissionType);
      `;
      await pool.request().query(createQuery);
      console.log('✅ Created TaskDelegationPermissions table.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring TaskDelegationPermissions table:', err);
      throw err;
    }
  },

  // إنشاء/تحديث دالة fn_CheckTaskDelegationPermission (آمن للتشغيل في كل مرة)
  ensureCheckTaskDelegationPermissionFunction: async function ensureCheckTaskDelegationPermissionFunction(pool) {
    try {
      const schemaProbe = await pool.request().query(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorVacancyID') IS NOT NULL
                 AND COL_LENGTH('dbo.TaskDelegations', 'DelegateVacancyID') IS NOT NULL
               THEN 1 ELSE 0 END AS IsVacancySchema,
          CASE WHEN COL_LENGTH('dbo.TaskDelegations', 'DelegatorUserID') IS NOT NULL
                 AND COL_LENGTH('dbo.TaskDelegations', 'DelegateUserID') IS NOT NULL
               THEN 1 ELSE 0 END AS IsUserSchema
      `);

      const isVacancySchema = !!(schemaProbe.recordset && schemaProbe.recordset[0] && schemaProbe.recordset[0].IsVacancySchema);
      const isUserSchema = !!(schemaProbe.recordset && schemaProbe.recordset[0] && schemaProbe.recordset[0].IsUserSchema);

      if (!isVacancySchema && !isUserSchema) {
        throw new Error('TaskDelegations schema is not recognized: no Delegator/Delegate user or vacancy columns found.');
      }

      const delegatorCol = isVacancySchema ? 'DelegatorVacancyID' : 'DelegatorUserID';
      const delegateCol = isVacancySchema ? 'DelegateVacancyID' : 'DelegateUserID';

      await pool.request().query(`
        DROP FUNCTION IF EXISTS dbo.fn_CheckTaskDelegationPermission;
      `);

      const createFn = `
        CREATE FUNCTION dbo.fn_CheckTaskDelegationPermission(
          @DelegatorUserID NVARCHAR(50),
          @DelegateUserID NVARCHAR(50),
          @PermissionType NVARCHAR(50)
        )
        RETURNS BIT
        AS
        BEGIN
          DECLARE @HasPermission BIT = 0;

          IF EXISTS (
            SELECT 1 FROM dbo.TaskDelegations 
            WHERE ${delegatorCol} = @DelegatorUserID 
              AND ${delegateCol} = @DelegateUserID 
              AND IsActive = 1
              AND StartDate <= GETDATE()
              AND (EndDate IS NULL OR EndDate >= GETDATE())
          )
          BEGIN
            DECLARE @DelegationType NVARCHAR(20);
            SELECT TOP 1 @DelegationType = DelegationType 
            FROM dbo.TaskDelegations 
            WHERE ${delegatorCol} = @DelegatorUserID 
              AND ${delegateCol} = @DelegateUserID 
              AND IsActive = 1
              AND StartDate <= GETDATE()
              AND (EndDate IS NULL OR EndDate >= GETDATE());

            IF @DelegationType = 'full'
            BEGIN
              SET @HasPermission = 1;
            END
            ELSE IF @DelegationType = 'limited'
            BEGIN
              IF EXISTS (
                SELECT 1 FROM dbo.TaskDelegations td
                INNER JOIN dbo.TaskDelegationPermissions tdp ON td.DelegationID = tdp.DelegationID
                WHERE td.${delegatorCol} = @DelegatorUserID 
                  AND td.${delegateCol} = @DelegateUserID 
                  AND td.IsActive = 1
                  AND td.StartDate <= GETDATE()
                  AND (td.EndDate IS NULL OR td.EndDate >= GETDATE())
                  AND tdp.PermissionType = @PermissionType
                  AND tdp.IsGranted = 1
              )
              BEGIN
                SET @HasPermission = 1;
              END
            END
          END

          RETURN @HasPermission;
        END
      `;
      await pool.request().query(createFn);
      console.log('✅ (Re)created dbo.fn_CheckTaskDelegationPermission function.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring fn_CheckTaskDelegationPermission function:', err);
      throw err;
    }
  }
  ,
  // إضافة عمود URL إلى جدول Tasks إن لم يكن موجودًا (آمن للتشغيل المتكرر)
  ensureTaskUrlColumn: async function ensureTaskUrlColumn(pool) {
    try {
      const check = await pool.request().query(`SELECT COL_LENGTH('dbo.Tasks', 'URL') AS Len`);
      const exists = !!(check.recordset && check.recordset[0] && check.recordset[0].Len);
      if (exists) {
        console.log('ℹ️ URL column already exists in Tasks.');
        return { changed: false };
      }
      const alter = `
        IF COL_LENGTH('dbo.Tasks', 'URL') IS NULL
        BEGIN
          ALTER TABLE dbo.Tasks ADD URL NVARCHAR(1000) NULL;
        END
      `;
      await pool.request().query(alter);
      console.log('✅ Added URL column to Tasks table.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring URL column in Tasks:', err);
      throw err;
    }
  },

  // إضافة فهارس أداء للمسارات الثقيلة (آمن للتشغيل المتكرر)
  ensureTaskQueryPerformanceIndexes: async function ensureTaskQueryPerformanceIndexes(pool) {
    try {
      const sqlBatch = `
        IF COL_LENGTH('dbo.TaskViews', 'UserID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskViews_Task_User_LastViewed' AND object_id = OBJECT_ID('dbo.TaskViews'))
          CREATE INDEX IX_TaskViews_Task_User_LastViewed ON dbo.TaskViews(TaskID, UserID, LastViewedAt);

        IF COL_LENGTH('dbo.TaskViews', 'ViewedByVacancyID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskViews_Task_ViewedByVacancy_LastViewed' AND object_id = OBJECT_ID('dbo.TaskViews'))
          CREATE INDEX IX_TaskViews_Task_ViewedByVacancy_LastViewed ON dbo.TaskViews(TaskID, ViewedByVacancyID, LastViewedAt);

        IF COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToUserID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskAssignmentNotifications_Task_AssignedTo_Read_CreatedAt' AND object_id = OBJECT_ID('dbo.TaskAssignmentNotifications'))
          CREATE INDEX IX_TaskAssignmentNotifications_Task_AssignedTo_Read_CreatedAt
          ON dbo.TaskAssignmentNotifications(TaskID, AssignedToUserID, IsRead, CreatedAt);

        IF COL_LENGTH('dbo.TaskAssignmentNotifications', 'AssignedToVacancyID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskAssignmentNotifications_Task_AssignedToVacancy_Read_CreatedAt' AND object_id = OBJECT_ID('dbo.TaskAssignmentNotifications'))
          CREATE INDEX IX_TaskAssignmentNotifications_Task_AssignedToVacancy_Read_CreatedAt
          ON dbo.TaskAssignmentNotifications(TaskID, AssignedToVacancyID, IsRead, CreatedAt);

        IF COL_LENGTH('dbo.CommentNotifications', 'NotifyUserID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CommentNotifications_Task_Notify_Read_CreatedAt' AND object_id = OBJECT_ID('dbo.CommentNotifications'))
          CREATE INDEX IX_CommentNotifications_Task_Notify_Read_CreatedAt
          ON dbo.CommentNotifications(TaskID, NotifyUserID, IsRead, CreatedAt);

        IF COL_LENGTH('dbo.CommentNotifications', 'NotifyVacancyID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CommentNotifications_Task_NotifyVacancy_Read_CreatedAt' AND object_id = OBJECT_ID('dbo.CommentNotifications'))
          CREATE INDEX IX_CommentNotifications_Task_NotifyVacancy_Read_CreatedAt
          ON dbo.CommentNotifications(TaskID, NotifyVacancyID, IsRead, CreatedAt);

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_Status_CreatedAt' AND object_id = OBJECT_ID('dbo.Tasks'))
          CREATE INDEX IX_Tasks_Status_CreatedAt ON dbo.Tasks(Status, CreatedAt DESC);

        IF COL_LENGTH('dbo.Subtasks', 'AssignedTo') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Subtasks_Task_AssignedTo_CreatedAt' AND object_id = OBJECT_ID('dbo.Subtasks'))
          CREATE INDEX IX_Subtasks_Task_AssignedTo_CreatedAt ON dbo.Subtasks(TaskID, AssignedTo, CreatedAt DESC);

        IF COL_LENGTH('dbo.Subtasks', 'AssignedToVacancyID') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Subtasks_Task_AssignedToVacancy_CreatedAt' AND object_id = OBJECT_ID('dbo.Subtasks'))
          CREATE INDEX IX_Subtasks_Task_AssignedToVacancy_CreatedAt ON dbo.Subtasks(TaskID, AssignedToVacancyID, CreatedAt DESC);
      `;

      await pool.request().query(sqlBatch);
      console.log('✅ Ensured performance indexes for task notifications/search endpoints.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring performance indexes:', err);
      throw err;
    }
  },

  // إضافة عمود EndDate إلى جدول Subtasks إذا لم يكن موجودًا
  ensureSubtaskEndDateColumn: async function ensureSubtaskEndDateColumn(pool) {
    try {
      const query = `
        IF COL_LENGTH('dbo.Subtasks', 'EndDate') IS NULL BEGIN
          ALTER TABLE dbo.Subtasks ADD EndDate DATE NULL;
        END;
      `;
      await pool.request().query(query);
      console.log('✅ Ensured EndDate column exists in Subtasks.');
      return { changed: true };
    } catch (err) {
      console.error('❌ Failed ensuring EndDate column in Subtasks:', err);
      throw err;
    }
  }
};
