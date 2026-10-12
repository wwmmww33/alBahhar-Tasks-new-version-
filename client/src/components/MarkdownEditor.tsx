// src/components/MarkdownEditor.tsx
// مربع نص يدعم Markdown المبسّطة (عريض/مائل/تلوين/قائمة نقطية/جدول) مع معاينة ولصق جدول Excel
// مباشرة — نفس الشريط والسلوك المستخدَم في مربع التعليقات (UnifiedTimeline.tsx)، مُستخرَج هنا
// كمكوّن قابل لإعادة الاستخدام في أي مربع نص آخر يحتاج الدعم نفسه.
import { useRef, useState } from 'react';
import { MD_COLORS, renderMarkdown, htmlTableToMarkdown } from '../utils/markdown';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  id?: string;
  className?: string;
};

const MarkdownEditor = ({ value, onChange, placeholder, rows = 5, required, id, className }: Props) => {
  const [showPreview, setShowPreview] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  const insertMarkdownSyntax = (prefix: string, suffix: string, placeholder: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = value.slice(start, end) || placeholder;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const inserted = prefix + selected + suffix;
    const next = before + inserted + after;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + prefix.length + selected.length;
      el.setSelectionRange(cursor, cursor);
      autoResize(el);
    });
  };

  const insertTableTemplate = () => {
    const tpl = '\n| العمود 1 | العمود 2 | العمود 3 |\n| --- | --- | --- |\n| بيانات | بيانات | بيانات |\n';
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? value.length;
    const next = value.slice(0, pos) + tpl + value.slice(pos);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); autoResize(el); });
  };

  const insertColor = (colorKey: string) => {
    setShowColorPicker(false);
    insertMarkdownSyntax(`[c=${colorKey}]`, '[/c]', 'نص ملوّن');
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    if (html && html.toLowerCase().includes('<table')) {
      const md = htmlTableToMarkdown(html);
      if (md) {
        e.preventDefault();
        const el = e.currentTarget;
        const s = el.selectionStart ?? 0;
        const en = el.selectionEnd ?? 0;
        const next = value.slice(0, s) + md + value.slice(en);
        onChange(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(s + md.length, s + md.length);
          autoResize(el);
        });
      }
    }
  };

  return (
    <div className={className}>
      {/* شريط أدوات Markdown */}
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        <button type="button" title="عريض (Bold)" onClick={() => insertMarkdownSyntax('**', '**', 'نص عريض')}
          className="px-2 py-0.5 text-sm font-bold border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">B</button>
        <button type="button" title="مائل (Italic)" onClick={() => insertMarkdownSyntax('*', '*', 'نص مائل')}
          className="px-2 py-0.5 text-sm italic border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">I</button>
        <div className="relative">
          <button type="button" title="تلوين النص"
            onClick={() => setShowColorPicker(v => !v)}
            className="px-2 py-0.5 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20 flex items-center gap-1">
            <span style={{ background: 'linear-gradient(135deg,#ef4444,#2563eb,#16a34a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700 }}>A</span>
            <span className="text-[9px] opacity-60">▼</span>
          </button>
          {showColorPicker && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-content/20 rounded-lg shadow-lg p-2 flex flex-wrap gap-1.5" style={{ width: 160 }}>
              {Object.entries(MD_COLORS).map(([key, hex]) => (
                <button key={key} type="button" title={key}
                  onMouseDown={(e) => { e.preventDefault(); insertColor(key); }}
                  style={{ background: hex, width: 24, height: 24, borderRadius: 4, border: '2px solid transparent' }}
                  className="hover:scale-110 transition-transform hover:border-white"
                />
              ))}
              <div className="w-full text-[10px] text-center text-content/50 mt-0.5">اختر لون النص</div>
            </div>
          )}
        </div>
        <button type="button" title="قائمة نقطية" onClick={() => insertMarkdownSyntax('\n- ', '', 'عنصر')}
          className="px-2 py-0.5 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">• قائمة</button>
        <button type="button" title="إدراج جدول" onClick={insertTableTemplate}
          className="px-2 py-0.5 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 border-content/20">⊞ جدول</button>
        <div className="flex-1" />
        <button type="button" onClick={() => setShowPreview(v => !v)}
          className={`px-2 py-0.5 text-xs border rounded border-content/20 ${showPreview ? 'bg-primary text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
          {showPreview ? 'تعديل' : 'معاينة'}
        </button>
      </div>
      {showPreview ? (
        <div
          className="w-full min-h-[80px] p-2 border rounded-md bg-white dark:bg-gray-900 border-content/20 text-content text-sm"
          dir="auto"
          dangerouslySetInnerHTML={{ __html: value.trim() ? renderMarkdown(value) : '<span style="opacity:0.4">لا يوجد محتوى للمعاينة</span>' }}
        />
      ) : (
        <textarea
          id={id}
          ref={textareaRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); autoResize(e.target); }}
          onPaste={handlePaste}
          onFocus={() => setShowColorPicker(false)}
          placeholder={placeholder}
          rows={rows}
          required={required}
          className="w-full p-2 border rounded-md bg-bkg border-content/20 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 resize-none overflow-hidden font-mono text-sm"
        />
      )}
    </div>
  );
};

export default MarkdownEditor;
