// src/config/db.config.js
require('dotenv').config(); // تحميل متغيرات .env (سيتم استخدامها فقط في التطوير)

const config = {
  // --- إعدادات الإنتاج (Production) ---
  production: {
    user: 'user', // من ملف الشبكة
    password: 'P@ssw0rd', // من ملف الشبكة
    server: 'mamrnosqldbp01', // من ملف الشبكة
    database: 'AlBaharTaskManagement', // من ملف الشبكة
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
      useUTC: false, // استخدام التوقيت المحلي
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    parseJSON: true, // تحليل JSON تلقائياً
    charset: 'utf8', // ترميز UTF-8
  },
  
  // --- إعدادات التطوير (Development) ---
  development: {
    user: process.env.DB_USER, // من ملف .env
    password: process.env.DB_PASSWORD, // من ملف .env
    server: process.env.DB_SERVER, // من ملف .env
    database: process.env.DB_DATABASE || 'AlBaharTaskManagement',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
      enableArithAbort: true,
      useUTC: false, // استخدام التوقيت المحلي
      language: 'Arabic',
      textsize: 2147483647,
      packetSize: 32768,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: 30000, // 30 seconds
    connectionTimeout: 30000, // 30 seconds
    parseJSON: true, // تحليل JSON تلقائياً
    charset: 'utf8', // ترميز UTF-8
    beforeConnect: (conn) => {
      conn.on('connect', () => {
        console.log('Database connected with Arabic language support');
      });
    }
  },
};

// تحديد البيئة الحالية مع تمييز وضع الـ exe (pkg)
let env;
if (process.env.NODE_ENV) {
  env = process.env.NODE_ENV;
} else if (process.pkg) {
  // عند تشغيل الملف الناتج عن pkg (bahar.exe) نستخدم إعدادات الإنتاج افتراضياً
  env = 'production';
} else {
  // في تشغيل node العادي بدون تحديد NODE_ENV نستخدم إعدادات التطوير
  env = 'development';
}

// تصدير الإعدادات المناسبة للبيئة الحالية
module.exports = config[env];
