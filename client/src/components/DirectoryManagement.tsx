// src/components/DirectoryManagement.tsx
// لوحة المدير لإدارة ملفي دليل الهاتف (PDF) ودليل الموظفين (Excel) المستخدمين في ميزة "@"
import { useEffect, useRef, useState } from 'react';
import { FileText, Users, Upload, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { CurrentUser } from '../types';

type PhoneStatus = {
  files: { name: string; size: number; mtime: string }[];
  entryCount: number;
};
type EmployeeStatus = {
  exists: boolean;
  mtime?: string;
  entryCount: number;
  columns: string[];
};
type InspectResult = {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
};

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const DirectoryManagement = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const userId = String(currentUser?.UserID || '');

  const [phoneStatus, setPhoneStatus] = useState<PhoneStatus | null>(null);
  const [employeeStatus, setEmployeeStatus] = useState<EmployeeStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfMessage, setPdfMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [excelInspecting, setExcelInspecting] = useState(false);
  const [excelMessage, setExcelMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [finalizing, setFinalizing] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/directory/status');
      const data = await res.json();
      setPhoneStatus(data.phone || null);
      setEmployeeStatus(data.employee || null);
    } catch (_) {
      setPhoneStatus(null);
      setEmployeeStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handlePdfUpload = async (file: File) => {
    setPdfUploading(true);
    setPdfMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      formData.append('isAdmin', 'true');
      const res = await fetch('/api/directory/pdf/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setPdfMessage({ type: 'err', text: data.message || 'فشل رفع الملف.' });
        return;
      }
      setPdfMessage({ type: 'ok', text: `تم رفع الملف — ${data.entryCount} إدخال.` });
      await fetchStatus();
    } catch (_) {
      setPdfMessage({ type: 'err', text: 'تعذر الاتصال بالخادم.' });
    } finally {
      setPdfUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const handleExcelSelected = async (file: File) => {
    setExcelInspecting(true);
    setExcelMessage(null);
    setInspectResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      formData.append('isAdmin', 'true');
      const res = await fetch('/api/directory/excel/inspect', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setExcelMessage({ type: 'err', text: data.message || 'فشل قراءة الملف.' });
        return;
      }
      setInspectResult(data);
      setSelectedColumns(data.headers); // كل الأعمدة مختارة افتراضياً
    } catch (_) {
      setExcelMessage({ type: 'err', text: 'تعذر الاتصال بالخادم.' });
    } finally {
      setExcelInspecting(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns(prev => {
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      // نحافظ على ترتيب الأعمدة كما في الملف الأصلي بغض النظر عن ترتيب النقر
      return inspectResult!.headers.filter(h => next.includes(h));
    });
  };

  const handleFinalize = async () => {
    if (!inspectResult || selectedColumns.length === 0) return;
    setFinalizing(true);
    setExcelMessage(null);
    try {
      const res = await fetch('/api/directory/excel/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedColumns, rows: inspectResult.rows, userId, isAdmin: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExcelMessage({ type: 'err', text: data.message || 'فشل إنشاء الملف.' });
        return;
      }
      setExcelMessage({ type: 'ok', text: `تم إنشاء دليل الموظفين — ${data.entryCount} إدخال.` });
      setInspectResult(null);
      setSelectedColumns([]);
      await fetchStatus();
    } catch (_) {
      setExcelMessage({ type: 'err', text: 'تعذر الاتصال بالخادم.' });
    } finally {
      setFinalizing(false);
    }
  };

  const handleDeleteEmployeeFile = async () => {
    if (!window.confirm('هل تريد حذف دليل الموظفين الحالي؟ لن يظهر بعد الآن في نتائج "@".')) return;
    try {
      await fetch(`/api/directory/excel?userId=${encodeURIComponent(userId)}&isAdmin=true`, { method: 'DELETE' });
      setExcelMessage(null);
      await fetchStatus();
    } catch (_) {}
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-content mb-1">دليل الهاتف والموظفين</h2>
        <p className="text-sm text-content-secondary">
          يُستخدم هذان الملفان في اقتراحات البحث عند كتابة <span dir="ltr" className="font-mono">@</span> داخل التعليقات والمهام الفرعية ووصف المهام.
        </p>
      </div>

      {/* قسم دليل الهاتف (PDF) */}
      <div className="p-4 bg-white dark:bg-gray-800 border border-content/10 rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="text-primary" size={20} />
          <h3 className="font-semibold text-content">دليل الهاتف (PDF)</h3>
        </div>

        {loadingStatus ? (
          <p className="text-sm text-content-secondary">جاري التحميل...</p>
        ) : phoneStatus && phoneStatus.files.length > 0 ? (
          <div className="mb-3 text-sm text-content-secondary space-y-1">
            {phoneStatus.files.map(f => (
              <div key={f.name}>
                📄 {f.name} — {formatSize(f.size)} — آخر تحديث: {formatDate(f.mtime)}
              </div>
            ))}
            <div className="font-medium text-content">إجمالي الإدخالات المستخرجة: {phoneStatus.entryCount}</div>
          </div>
        ) : (
          <p className="mb-3 text-sm text-content-secondary">لا يوجد ملف دليل هاتف حالياً.</p>
        )}

        <p className="text-xs text-content-secondary mb-2">رفع ملف جديد يستبدل الملف الحالي تلقائياً.</p>
        <div className="flex items-center gap-3">
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }}
            disabled={pdfUploading}
            className="text-sm"
          />
          {pdfUploading && <span className="text-sm text-content-secondary">جاري الرفع...</span>}
        </div>
        {pdfMessage && (
          <p className={`mt-2 text-sm flex items-center gap-1.5 ${pdfMessage.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {pdfMessage.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {pdfMessage.text}
          </p>
        )}
      </div>

      {/* قسم دليل الموظفين (Excel) */}
      <div className="p-4 bg-white dark:bg-gray-800 border border-content/10 rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <Users className="text-emerald-600" size={20} />
          <h3 className="font-semibold text-content">دليل الموظفين (Excel)</h3>
        </div>

        {loadingStatus ? (
          <p className="text-sm text-content-secondary">جاري التحميل...</p>
        ) : employeeStatus?.exists ? (
          <div className="mb-3 text-sm text-content-secondary space-y-1">
            <div>الأعمدة الحالية: {employeeStatus.columns.join('، ')}</div>
            <div className="font-medium text-content">عدد الموظفين: {employeeStatus.entryCount}</div>
            {employeeStatus.mtime && <div>آخر تحديث: {formatDate(employeeStatus.mtime)}</div>}
            <button
              onClick={handleDeleteEmployeeFile}
              className="mt-1 flex items-center gap-1.5 text-red-600 hover:underline text-xs"
            >
              <Trash2 size={13} /> حذف دليل الموظفين
            </button>
          </div>
        ) : (
          <p className="mb-3 text-sm text-content-secondary">لا يوجد دليل موظفين حالياً.</p>
        )}

        {!inspectResult && (
          <>
            <p className="text-xs text-content-secondary mb-2">
              ارفع ملف Excel يحتوي أسماء الموظفين ومعلوماتهم — سيكتشف النظام صف عناوين الأعمدة تلقائياً، ثم تختار الأعمدة التي تريد ظهورها.
            </p>
            <div className="flex items-center gap-3">
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExcelSelected(f); }}
                disabled={excelInspecting}
                className="text-sm"
              />
              {excelInspecting && <span className="text-sm text-content-secondary">جاري القراءة...</span>}
            </div>
          </>
        )}

        {excelMessage && (
          <p className={`mt-2 text-sm flex items-center gap-1.5 ${excelMessage.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {excelMessage.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {excelMessage.text}
          </p>
        )}

        {inspectResult && (
          <div className="mt-3 p-3 bg-bkg dark:bg-gray-900 border border-content/10 rounded-md">
            <p className="text-sm font-medium text-content mb-2">
              تم العثور على {inspectResult.rowCount} صف بيانات (صف العناوين رقم {inspectResult.headerRowIndex + 1}). اختر الأعمدة التي تريد إظهارها — أول عمود مختار يظهر كاسم رئيسي، والباقي كتفاصيل بجانبه:
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {inspectResult.headers.map(h => (
                <label key={h} className="flex items-center gap-1.5 px-2 py-1 border rounded-md border-content/20 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(h)}
                    onChange={() => toggleColumn(h)}
                  />
                  {h}
                </label>
              ))}
            </div>
            {inspectResult.rows.length > 0 && selectedColumns.length > 0 && (
              <div className="mb-3 text-xs text-content-secondary">
                معاينة: {selectedColumns.map(c => inspectResult.rows[0][c]).filter(Boolean).join(' — ')}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleFinalize}
                disabled={finalizing || selectedColumns.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-60 text-sm"
              >
                <Upload size={14} /> {finalizing ? 'جارٍ الإنشاء...' : 'تأكيد وإنشاء الملف'}
              </button>
              <button
                onClick={() => { setInspectResult(null); setSelectedColumns([]); }}
                className="px-4 py-1.5 text-content-secondary hover:bg-content/10 rounded-md text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectoryManagement;
