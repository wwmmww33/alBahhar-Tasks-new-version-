// src/utils/employeeDirectory.js
// يقرأ ملف Excel (يُنشئه النظام نفسه من رفعة مدير النظام) يحتوي أسماء الموظفين ومعلومات عنهم،
// قابل للبحث عبر ميزة "@" جنباً إلى جنب مع دليل الهاتف (phoneDirectory.js).
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { resolveDirectoryDir } = require('./phoneDirectory');

const EMPLOYEE_FILE_NAME = 'employees.xlsx';

function resolveEmployeeFilePath() {
  return path.join(resolveDirectoryDir(), EMPLOYEE_FILE_NAME);
}

// يحوّل صفاً (مصفوفة خلايا) من ورقة Excel إلى عدد الخلايا غير الفارغة — يُستخدم لتخمين صف العناوين
function nonEmptyCellCount(row) {
  if (!Array.isArray(row)) return 0;
  return row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length;
}

// يخمّن صف عناوين الأعمدة تلقائياً: أول صف (ضمن أول 15 صفاً) له أكبر عدد خلايا غير فارغة
// — الصفوف التمهيدية (عنوان، فراغ) عادة أقل امتلاءً من صف العناوين الفعلي.
function detectHeaderRowIndex(rowsAsArrays) {
  const scanLimit = Math.min(rowsAsArrays.length, 15);
  let bestIndex = 0;
  let bestCount = -1;
  for (let i = 0; i < scanLimit; i++) {
    const count = nonEmptyCellCount(rowsAsArrays[i]);
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// يحلّل ملف Excel مرفوع من مدير النظام: يكتشف صف العناوين تلقائياً، ويعيد العناوين + كل الصفوف
// ككائنات (المفتاح = اسم العمود الأصلي) لعرضها في واجهة اختيار الأعمدة على الواجهة الأمامية.
function inspectExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rowsAsArrays = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  const headerRowIndex = detectHeaderRowIndex(rowsAsArrays);
  const headerRow = (rowsAsArrays[headerRowIndex] || []).map(h => String(h ?? '').trim());
  const headers = headerRow.filter(h => h !== '');

  const rows = [];
  for (let i = headerRowIndex + 1; i < rowsAsArrays.length; i++) {
    const raw = rowsAsArrays[i];
    if (!raw || nonEmptyCellCount(raw) === 0) continue;
    const obj = {};
    headerRow.forEach((h, colIdx) => {
      if (!h) return;
      obj[h] = String(raw[colIdx] ?? '').trim();
    });
    rows.push(obj);
  }

  return { sheetName, headerRowIndex, headers, rows, rowCount: rows.length };
}

// يكتب ملف employees.xlsx نهائياً باحتفاظ الأعمدة المختارة فقط، بنفس مسمياتها الأصلية وترتيب الاختيار
function finalizeEmployeeFile(selectedColumns, rows) {
  const cols = (selectedColumns || []).filter(Boolean);
  if (cols.length === 0) throw new Error('يجب اختيار عمود واحد على الأقل');

  const filteredRows = (rows || []).map(row => {
    const out = {};
    cols.forEach(c => { out[c] = row[c] ?? ''; });
    return out;
  });

  const sheet = XLSX.utils.json_to_sheet(filteredRows, { header: cols });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Employees');

  const dir = resolveDirectoryDir();
  fs.mkdirSync(dir, { recursive: true });
  XLSX.writeFile(workbook, resolveEmployeeFilePath());

  return { entryCount: filteredRows.length, columns: cols };
}

function deleteEmployeeFile() {
  try { fs.unlinkSync(resolveEmployeeFilePath()); } catch (_) {}
}

// يبني اسماً معروضاً/قابلاً للإدراج من صف موظف: أول عمود = التسمية، البقية = تفاصيل بين قوسين
function rowToEntry(row, columns, id) {
  const values = columns.map(c => String(row[c] ?? '').trim());
  const label = values[0] || 'بدون اسم';
  const details = values.slice(1).filter(Boolean);
  const section = columns.slice(1)
    .map((c, i) => (values[i + 1] ? `${c}: ${values[i + 1]}` : ''))
    .filter(Boolean)
    .join('، ');
  const searchText = [...columns, ...values].join(' ').toLowerCase();
  return { id: `xlsx-${id}`, source: 'employee', label, details, section, searchText };
}

let cache = { signature: '', entries: [] };

async function loadEmployeeEntriesAsync() {
  const filePath = resolveEmployeeFilePath();
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    cache = { signature: 'missing', entries: [] };
    return cache.entries;
  }

  const signature = `${filePath}:${stat.mtimeMs}:${stat.size}`;
  if (signature === cache.signature) {
    return cache.entries;
  }

  try {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // الملف الذي ننشئه نحن دائماً بصف عناوين أول (لا حاجة لتخمين الصف هنا)
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const entries = rows.map((row, idx) => rowToEntry(row, columns, idx + 1));
    cache = { signature, entries };
    console.log(`👤 دليل الموظفين: تم تحميل ${entries.length} إدخال (${filePath}).`);
  } catch (err) {
    console.warn('⚠️ تعذر قراءة ملف دليل الموظفين:', err.message);
    cache = { signature, entries: [] };
  }

  return cache.entries;
}

async function searchEmployeeDirectory(query, limit = 20) {
  const entries = await loadEmployeeEntriesAsync();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  const matched = entries.filter(e => terms.every(t => e.searchText.includes(t)));
  return matched.slice(0, limit);
}

async function getEmployeeDirectoryStatus() {
  const filePath = resolveEmployeeFilePath();
  try {
    const stat = fs.statSync(filePath);
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rowsAsArrays = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const columns = (rowsAsArrays[0] || []).map(h => String(h ?? '').trim()).filter(Boolean);
    const entries = await loadEmployeeEntriesAsync();
    return { exists: true, mtime: stat.mtime, entryCount: entries.length, columns };
  } catch (_) {
    return { exists: false, entryCount: 0, columns: [] };
  }
}

module.exports = {
  resolveEmployeeFilePath,
  inspectExcelBuffer,
  finalizeEmployeeFile,
  deleteEmployeeFile,
  loadEmployeeEntriesAsync,
  searchEmployeeDirectory,
  getEmployeeDirectoryStatus,
};
