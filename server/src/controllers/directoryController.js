// src/controllers/directoryController.js
const fs = require('fs');
const path = require('path');
const {
  resolveDirectoryDir,
  searchPhoneDirectory,
  getPhoneDirectoryStatus,
} = require('../utils/phoneDirectory');
const {
  inspectExcelBuffer,
  finalizeEmployeeFile,
  deleteEmployeeFile,
  getEmployeeDirectoryStatus,
  searchEmployeeDirectory,
} = require('../utils/employeeDirectory');

const resolveIsAdmin = (req) =>
  req.body?.isAdmin === true || req.body?.isAdmin === 'true' || req.query?.isAdmin === 'true';

// GET /api/directory/search?q=...&limit=20 — يدمج نتائج دليل الهاتف (PDF) وأسماء الموظفين (Excel)
exports.search = async (req, res) => {
  try {
    const { q, limit } = req.query;
    const parsedLimit = Number.isInteger(parseInt(limit)) ? parseInt(limit) : 20;
    const safeLimit = Math.min(Math.max(parsedLimit, 1), 50);
    const [phoneEntries, employeeEntries] = await Promise.all([
      searchPhoneDirectory(q, safeLimit),
      searchEmployeeDirectory(q, safeLimit),
    ]);
    res.status(200).json([...phoneEntries, ...employeeEntries]);
  } catch (error) {
    console.error('Error searching directory:', error);
    res.status(500).json({ message: 'خطأ في البحث بالدليل', detail: error.message });
  }
};

// GET /api/directory/status — حالة الملفين الحاليين لعرضها لمدير النظام
exports.status = async (req, res) => {
  try {
    const [phone, employee] = await Promise.all([
      getPhoneDirectoryStatus(),
      getEmployeeDirectoryStatus(),
    ]);
    res.status(200).json({ phone, employee });
  } catch (error) {
    console.error('Error fetching directory status:', error);
    res.status(500).json({ message: 'خطأ في جلب حالة الدليل', detail: error.message });
  }
};

// POST /api/directory/pdf/upload (multipart: file) — يستبدل كل ملفات PDF الحالية بالملف الجديد
exports.uploadPdf = async (req, res) => {
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة لرفع ملف الدليل.' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'الرجاء إرفاق ملف PDF.' });
  if (!file.originalname.toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ message: 'يجب أن يكون الملف بصيغة PDF.' });
  }

  try {
    const dir = resolveDirectoryDir();
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase().endsWith('.pdf')) {
        try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
      }
    }
    const safeName = file.originalname.replace(/[\\/:*?"<>|]/g, '_');
    fs.writeFileSync(path.join(dir, safeName), file.buffer);

    const status = await getPhoneDirectoryStatus();
    res.status(200).json({ message: 'تم رفع ملف دليل الهاتف بنجاح.', ...status });
  } catch (error) {
    console.error('Error uploading phone directory PDF:', error);
    res.status(500).json({ message: 'خطأ في رفع الملف', detail: error.message });
  }
};

// POST /api/directory/excel/inspect (multipart: file) — يكتشف صف العناوين ويعيد الأعمدة والصفوف
exports.inspectExcel = async (req, res) => {
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة.' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'الرجاء إرفاق ملف Excel.' });

  try {
    const result = inspectExcelBuffer(file.buffer);
    if (result.headers.length === 0) {
      return res.status(400).json({ message: 'تعذر العثور على صف عناوين في الملف.' });
    }
    res.status(200).json(result);
  } catch (error) {
    console.error('Error inspecting employee Excel file:', error);
    res.status(500).json({ message: 'تعذرت قراءة ملف Excel. تأكد من صحة الملف.', detail: error.message });
  }
};

// POST /api/directory/excel/finalize { selectedColumns, rows, isAdmin, userId } — ينشئ employees.xlsx
exports.finalizeExcel = async (req, res) => {
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة.' });
  }
  const { selectedColumns, rows } = req.body;
  if (!Array.isArray(selectedColumns) || selectedColumns.length === 0) {
    return res.status(400).json({ message: 'اختر عموداً واحداً على الأقل.' });
  }
  if (!Array.isArray(rows)) {
    return res.status(400).json({ message: 'بيانات الصفوف مفقودة.' });
  }

  try {
    const result = finalizeEmployeeFile(selectedColumns, rows);
    const status = await getEmployeeDirectoryStatus();
    res.status(200).json({ message: 'تم إنشاء ملف دليل الموظفين بنجاح.', ...result, ...status });
  } catch (error) {
    console.error('Error finalizing employee directory:', error);
    res.status(500).json({ message: 'خطأ في إنشاء ملف دليل الموظفين', detail: error.message });
  }
};

// DELETE /api/directory/excel?userId=...&isAdmin=true — يحذف ملف دليل الموظفين الحالي
exports.deleteExcel = async (req, res) => {
  if (!resolveIsAdmin(req)) {
    return res.status(403).json({ message: 'صلاحيات الإدارة مطلوبة.' });
  }
  deleteEmployeeFile();
  res.status(200).json({ message: 'تم حذف ملف دليل الموظفين.' });
};
