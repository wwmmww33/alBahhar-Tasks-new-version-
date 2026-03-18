// src/server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5001;

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// تهيئة خدمة الملفات الثابتة للواجهة الأمامية (dist) بمسارات احتياطية مرنة
const candidateStaticDirs = [
  process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR),
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'client', 'dist'),
  path.resolve(process.cwd(), 'dist'),
].filter(Boolean);

let distDir = candidateStaticDirs.find((dir) => {
  try {
    return fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'));
  } catch {
    return false;
  }
});

if (!distDir) {
  // إذا لم نعثر على مجلد dist، استخدم أول مرشح كافتراضي (قد يؤدي إلى 404)
  distDir = candidateStaticDirs[0];
}

console.log('📦 Static frontend directory:', distDir);
app.use(express.static(distDir));


// --- 1. استيراد كل ملفات التوجيه (Routes) ---
const authRoutes = require('./routes/authRoutes');
const taskRoutes = require('./routes/taskRoutes');
const subtaskRoutes = require('./routes/subtaskRoutes');
const commentRoutes = require('./routes/commentRoutes');
const procedureRoutes = require('./routes/procedureRoutes');
const departmentRoutes = require('./routes/departmentRoutes');
const userRoutes = require('./routes/userRoutes');
const profileRoutes = require('./routes/profileRoutes');
const commentNotificationRoutes = require('./routes/commentNotificationRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const delegationRoutes = require('./routes/delegationRoutes');
const {
  ensureSubtasksCalendarFlag,
  ensureCommentsCalendarFlag,
  ensurePersonalEventsTable,
  ensureActedByColumns,
  ensureDelegationPasswordHashInUsers,
  ensureDelegationSecretHashInTaskDelegations,
  ensureTaskDelegationsTable,
  ensureTaskDelegationPermissionsTable,
  ensureCheckTaskDelegationPermissionFunction,
  ensureTaskUrlColumn,
  ensureTaskQueryPerformanceIndexes
} = require('./utils/dbMigrations');


// --- 2. تسجيل كل مسارات الـ API ---
// (يجب أن يكون هذا الجزء قبل المسار الشامل '*')
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/subtasks', subtaskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/procedures', procedureRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/comment-notifications', commentNotificationRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/delegations', delegationRoutes);


// --- 3. المسار الشامل (Catch-all) يجب أن يكون هو الأخير دائماً ---
// إعادة تفعيل مسار SPA لإرجاع index.html لأي طلب غير API
app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});


// --- 4. بدء تشغيل الخادم ---
const startServer = async () => {
  try {
    const dbConfig = require('./config/db.config');
    const pool = await new sql.ConnectionPool(dbConfig).connect();
    app.locals.db = pool;
    
    console.log('✅ Connected to SQL Server successfully!');

    // --- تشغيل ترحيل آمن لضمان أعمدة ShowInCalendar ---
    try {
      await ensureSubtasksCalendarFlag(pool);
      await ensureCommentsCalendarFlag(pool);
    } catch (migrationErr) {
      console.error('⚠️ Database migration (ShowInCalendar) failed. Server continues running.', migrationErr);
    }
    // --- تشغيل ترحيل آمن لإنشاء جدول الأحداث الخاصة إذا لم يوجد ---
    try {
      await ensurePersonalEventsTable(pool);
    } catch (eventsMigrationErr) {
      console.error('⚠️ Database migration (PersonalCalendarEvents) failed. Server continues running.', eventsMigrationErr);
    }
    // --- أعمدة ActedBy في الجداول الأساسية + عمود كلمة سر التفويض في المستخدمين ---
    try {
      await ensureActedByColumns(pool);
      await ensureDelegationPasswordHashInUsers(pool);
    } catch (actedByOrPassMigrationErr) {
      console.error('⚠️ Database migration (ActedBy/DelegationPasswordHash) failed. Server continues running.', actedByOrPassMigrationErr);
    }
    // --- ترحيلات التفويض: الجداول والدالة المساعدة ---
    try {
      await ensureTaskDelegationsTable(pool);
      await ensureDelegationSecretHashInTaskDelegations(pool);
      await ensureTaskDelegationPermissionsTable(pool);
      await ensureCheckTaskDelegationPermissionFunction(pool);
    } catch (delegationMigrationErr) {
      console.error('⚠️ Database migration (Delegation) failed. Server continues running.', delegationMigrationErr);
    }

    // --- ترحيل عمود URL في جدول المهام ---
    try {
      await ensureTaskUrlColumn(pool);
    } catch (urlMigrationErr) {
      console.error('⚠️ Database migration (Tasks.URL) failed. Server continues running.', urlMigrationErr);
    }

    // --- فهارس أداء للاستعلامات الثقيلة ---
    try {
      await ensureTaskQueryPerformanceIndexes(pool);
    } catch (perfIndexErr) {
      console.error('⚠️ Database migration (Performance Indexes) failed. Server continues running.', perfIndexErr);
    }
    
    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server is running on http://0.0.0.0:${port}`);
      console.log(`🌐 Access from network: http://<your-ip>:${port}`);
    });

  } catch (err) {
    console.error('❌ Database Connection Failed!', err);
    process.exit(1); // إيقاف التطبيق إذا فشل الاتصال بقاعدة البيانات
  }
};

startServer();
