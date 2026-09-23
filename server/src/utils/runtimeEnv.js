// src/utils/runtimeEnv.js
// يكتشف ما إذا كان التطبيق يعمل كملف EXE مُجمَّع (Node SEA) عبر build.mjs، أو كعملية node.js عادية.
// process.pkg غير موجود في حزم Node SEA (هو خاص بأداة pkg التقليدية)، و process.isSea() غير متوفر
// في إصدار Node المستخدم هنا رغم توثيقه — تحقّقنا عملياً عبر حزمة تجريبية بنفس خط أنابيب البناء.
// الإشارة الموثوقة الوحيدة: في حزم SEA لا يوجد ملف سكربت منفصل يُمرَّر كوسيط، لذا يجعل Node
// argv[0] و argv[1] متطابقين (كلاهما مسار الملف التنفيذي نفسه) — بخلاف node.exe script.js العادي.
const path = require('path');

function isPackagedExe() {
  return !!process.pkg
    || (typeof process.isSea === 'function' && process.isSea())
    || (process.argv.length >= 2 && !!process.argv[0] && process.argv[0] === process.argv[1]);
}

// مجلد الملف التنفيذي عند التشغيل كحزمة SEA، أو null في وضع node.js العادي (لاستخدام مسار احتياطي بديل)
function exeDir() {
  return isPackagedExe() ? path.dirname(process.execPath) : null;
}

module.exports = { isPackagedExe, exeDir };
