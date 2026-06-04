// src/server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const cors = require('cors');

// تحميل .env من مجلد الـ EXE (عند التشغيل كملف pkg) أو من جذر المشروع
const exeDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '../..');
const envPath = path.join(exeDir, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const app = express();
const port = process.env.PORT || 5001;

// --- Middlewares ---
app.use(cors());
app.use(express.json({ limit: '20mb' }));
// معالجة فشل تحليل الـ body (مثل تجاوز الحجم أو JSON مشوّه)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'حجم الطلب كبير جداً' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'تنسيق البيانات غير صحيح' });
  }
  next(err);
});

// ── تهيئة الواجهة الأمامية ────────────────────────────────────────────────
// في وضع الـ exe (process.pkg): الملفات مضمّنة كـ base64 داخل الكود
// في وضع التطوير:              express.static من مجلد dist على الملفات

let inlinedDist = null; // خريطة { 'path': [Buffer, mimeType] }
let distDir     = null; // للوضع الاعتيادي فقط

if (process.pkg) {
  try {
    const raw = require('./inlinedDist.generated');
    // حوّل base64 strings إلى Buffers مرة واحدة عند التشغيل
    inlinedDist = {};
    for (const [k, [b64, mime]] of Object.entries(raw)) {
      inlinedDist[k] = [Buffer.from(b64, 'base64'), mime];
    }
    console.log('📦 Frontend: embedded in exe (' + Object.keys(inlinedDist).length + ' files)');
  } catch (e) {
    console.warn('⚠️  Embedded dist not found, falling back to external dist/', e.message);
  }
}

if (!inlinedDist) {
  // وضع التطوير أو الـ exe بدون ملفات مضمّنة — ابحث على الملفات
  const exeDir = process.pkg ? path.dirname(process.execPath) : null;
  const candidates = [
    process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR),
    exeDir && path.join(exeDir, 'dist'),
    path.join(__dirname, '..', 'dist'),
    path.join(__dirname, '..', 'client', 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ].filter(Boolean);

  distDir = candidates.find(d => {
    try { return fs.existsSync(path.join(d, 'index.html')); } catch { return false; }
  }) || candidates[0];

  console.log('📦 Frontend: filesystem at', distDir);
  app.use(express.static(distDir));
} else {
  // middleware يخدم الملفات الثابتة المضمّنة (يُوضع قبل مسارات API)
  app.use((req, res, next) => {
    const rel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const entry = inlinedDist[rel];
    if (!entry) return next();
    const [buf, mime] = entry;
    if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', mime);
    res.send(buf);
  });
}


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
const vacancyRoutes = require('./routes/vacancyRoutes');
const ranksRoutes = require('./routes/ranksRoutes');
const myNotificationsRoutes = require('./routes/myNotificationsRoutes');
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
  ensureTaskQueryPerformanceIndexes,
  ensureSubtaskEndDateColumn,
  ensureUserRolesTable,
  ensureRegistrationRequestsVacancyID,
  ensureTaskRelationsTable,
  ensureTaskAssignmentNotificationsColumns,
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
app.use('/api/vacancies', vacancyRoutes);
app.use('/api/ranks', ranksRoutes);
app.use('/api/my-notifications', myNotificationsRoutes);


// --- 3. 404 لمسارات الـ API غير الموجودة ---
app.all('/api/*', (req, res) => {
  res.status(404).json({ message: `المسار ${req.method} ${req.path} غير موجود` });
});

// --- 4. المسار الشامل للـ SPA ---
app.get('*', (req, res) => {
  if (inlinedDist) {
    const [buf, mime] = inlinedDist['index.html'];
    res.setHeader('Content-Type', mime);
    return res.send(buf);
  }
  res.sendFile(path.join(distDir, 'index.html'));
});

// --- معالج الأخطاء العام ---
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ message: 'خطأ في الخادم', detail: err.message });
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

    // --- عمود تاريخ الانتهاء للمهام الفرعية ---
    try {
      await ensureSubtaskEndDateColumn(pool);
    } catch (endDateErr) {
      console.error('⚠️ Database migration (Subtasks.EndDate) failed. Server continues running.', endDateErr);
    }

    // --- جدول أدوار المستخدمين ---
    try {
      await ensureUserRolesTable(pool);
    } catch (userRolesErr) {
      console.error('⚠️ Database migration (UserRoles) failed. Server continues running.', userRolesErr);
    }

    // --- عمود VacancyID في طلبات التسجيل ---
    try {
      await ensureRegistrationRequestsVacancyID(pool);
    } catch (regVacErr) {
      console.error('⚠️ Database migration (RegistrationRequests.VacancyID) failed. Server continues running.', regVacErr);
    }

    // --- جدول المهام المرتبطة ---
    try {
      await ensureTaskRelationsTable(pool);
    } catch (relErr) {
      console.error('⚠️ Database migration (TaskRelations) failed. Server continues running.', relErr);
    }

    // --- أعمدة إشعارات إسناد المهام الفرعية ---
    try {
      await ensureTaskAssignmentNotificationsColumns(pool);
    } catch (tanErr) {
      console.error('⚠️ Database migration (TaskAssignmentNotifications) failed. Server continues running.', tanErr);
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
