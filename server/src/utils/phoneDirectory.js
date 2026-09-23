// src/utils/phoneDirectory.js
// يقرأ ملفات PDF من مجلد "directory" ويستخرج منها قائمة (اسم/منصب، أرقام هاتف)
// قابلة للبحث عبر ميزة "@" في التعليقات والمهام الفرعية ووصف المهمة.
const fs = require('fs');
const path = require('path');
const { exeDir } = require('./runtimeEnv');

function resolveDirectoryDir() {
  const baseDir = exeDir() || path.resolve(__dirname, '../..');
  const dir = path.join(baseDir, 'directory');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

const PHONE_RE = /\d{5,13}/g;
const NUM_START_RE = /^(\d{1,3})\.\s*(.*)$/;
const PAGE_NUM_RE = /^-?\s*\d{1,4}\s*-?$/;

function isNoiseLine(line) {
  if (!line) return true;
  if (PAGE_NUM_RE.test(line)) return true;
  const upper = line.toUpperCase();
  if (upper.includes('APPOINTMENT') && upper.includes('TEL')) return true;
  return false;
}

function analyzeLine(line) {
  const phones = [];
  let lastEnd = 0;
  let firstStart = -1;
  let m;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(line))) {
    if (firstStart === -1) firstStart = m.index;
    phones.push(m[0]);
    lastEnd = m.index + m[0].length;
  }
  if (phones.length === 0) {
    return { phones: [], textBefore: line.trim(), textAfter: '' };
  }
  return {
    phones,
    textBefore: line.slice(0, firstStart).trim(),
    textAfter: line.slice(lastEnd).trim(),
  };
}

// محلّل نصي عام: يحوّل نص مستخرج من PDF (دليل هاتف بصيغة "رقم. تسمية ... هاتف ... تسمية إنجليزية")
// إلى قائمة إدخالات {section, label, labelEn, phones[]}. مصمم بمرونة للتعامل مع تلافيف الأسطر
// واختلاف ترتيب الحقول، وليس فقط تنسيقاً صارماً واحداً.
function parseDirectoryText(text) {
  const rawLines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  let section = '';

  const pushCurrent = () => {
    if (current && current.phones.length > 0) {
      entries.push({
        section: current.section,
        label: current.arabic.join(' ').replace(/\s+/g, ' ').trim(),
        labelEn: current.english.join(' ').replace(/\s+/g, ' ').trim(),
        phones: Array.from(new Set(current.phones)),
      });
    }
    current = null;
  };

  const feed = (content) => {
    const { phones, textBefore, textAfter } = analyzeLine(content);
    if (phones.length === 0) {
      if (!textBefore) return;
      if (current) current.arabic.push(textBefore);
      return;
    }
    if (!current) {
      current = { section, arabic: [], english: [], phones: [] };
      if (textBefore) current.arabic.push(textBefore);
    } else if (textBefore) {
      // نص قبل رقم جديد على سطر مستقل عن بداية الإدخال => إدخال جديد
      pushCurrent();
      current = { section, arabic: [textBefore], english: [], phones: [] };
    }
    current.phones.push(...phones);
    if (textAfter) current.english.push(textAfter);
  };

  for (const raw of rawLines) {
    const line = raw.trim();
    if (isNoiseLine(line)) continue;

    const numMatch = line.match(NUM_START_RE);
    if (numMatch) {
      pushCurrent();
      current = { section, arabic: [], english: [], phones: [] };
      if (numMatch[2]) feed(numMatch[2]);
      continue;
    }

    const { phones, textBefore } = analyzeLine(line);
    if (phones.length === 0) {
      if (current && current.phones.length === 0) {
        // إدخال نشط بلا رقم هاتف بعد: استمرار جمع التسمية (سطر عربي ملتفّ)
        if (textBefore) current.arabic.push(textBefore);
        continue;
      }
      // سطر بلا رقم هاتف بعد إدخال مكتمل: يغلقه ويصبح سياق القسم الجديد
      pushCurrent();
      if (textBefore) section = textBefore;
      continue;
    }

    feed(line);
  }
  pushCurrent();
  return entries;
}

// يبني الاسم المعروض/القابل للإدراج لكل إدخال، مع احتياطي عند غياب التسمية العربية
function toDisplayEntry(raw, id) {
  const label = raw.label || raw.labelEn || raw.section || 'بدون اسم';
  const searchText = [raw.label, raw.labelEn, raw.section, ...raw.phones].filter(Boolean).join(' ').toLowerCase();
  return {
    id,
    label,
    labelEn: raw.labelEn,
    section: raw.section,
    phones: raw.phones,
    searchText,
  };
}

let cache = { signature: '', entries: [] };

function computeSignature(dir, files) {
  return files
    .map(f => {
      try {
        const st = fs.statSync(path.join(dir, f));
        return `${f}:${st.mtimeMs}:${st.size}`;
      } catch (_) {
        return f;
      }
    })
    .join('|');
}

// يعيد قائمة الإدخالات المفهرسة، مع إعادة التحليل تلقائياً فقط عند تغيّر ملفات PDF في المجلد
// (بحسب وقت التعديل والحجم)، حتى يستطيع مدير النظام تحديث الملف دون إعادة تشغيل الخادم.
async function loadDirectoryEntriesAsync() {
  const dir = resolveDirectoryDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
  } catch (_) {
    files = [];
  }

  const signature = `${dir}::${computeSignature(dir, files)}`;
  if (signature === cache.signature) {
    return cache.entries;
  }

  let pdfParse;
  try {
    // نطلب ملف التنفيذ مباشرة (وليس pdf-parse/index.js) لتفادي كود تصحيح داخلي في تلك
    // الحزمة يحاول قراءة ملف اختبار وهمي عند تجميعه عبر esbuild (module.parent يصبح undefined).
    pdfParse = require('pdf-parse/lib/pdf-parse.js');
  } catch (err) {
    console.warn('⚠️ pdf-parse غير مثبت — ميزة دليل الهاتف معطّلة.', err.message);
    cache = { signature, entries: [] };
    return cache.entries;
  }

  const rawEntries = [];
  for (const file of files) {
    try {
      const buf = fs.readFileSync(path.join(dir, file));
      const data = await pdfParse(buf);
      const parsed = parseDirectoryText(data.text || '');
      rawEntries.push(...parsed);
    } catch (err) {
      console.warn(`⚠️ تعذر تحليل ملف الدليل ${file}:`, err.message);
    }
  }

  const entries = rawEntries.map((r, idx) => toDisplayEntry(r, idx + 1));
  cache = { signature, entries };
  console.log(`📇 دليل الهاتف: تم تحميل ${entries.length} إدخال من ${files.length} ملف PDF (${dir}).`);
  return entries;
}

async function searchDirectory(query, limit = 20) {
  const entries = await loadDirectoryEntriesAsync();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  const matched = entries.filter(e => terms.every(t => e.searchText.includes(t)));
  return matched.slice(0, limit);
}

module.exports = {
  resolveDirectoryDir,
  parseDirectoryText,
  loadDirectoryEntriesAsync,
  searchDirectory,
};
