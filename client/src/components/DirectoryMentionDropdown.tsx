// src/components/DirectoryMentionDropdown.tsx
import { Phone, User, Loader2 } from 'lucide-react';
import type { DirectoryEntry } from '../hooks/useDirectoryMention';

type Props = {
  isOpen: boolean;
  loading: boolean;
  suggestions: DirectoryEntry[];
  activeIndex: number;
  onSelect: (entry: DirectoryEntry) => void;
  onHover: (index: number) => void;
};

const DirectoryMentionDropdown = ({ isOpen, loading, suggestions, activeIndex, onSelect, onHover }: Props) => {
  if (!isOpen) return null;

  return (
    <div
      dir="rtl"
      className="absolute z-50 mt-1 w-full max-w-sm bg-white dark:bg-gray-800 border border-content/20 rounded-md shadow-lg max-h-64 overflow-y-auto"
      // منع فقدان تركيز الحقل عند الضغط على القائمة (mousedown يسبق blur)
      onMouseDown={(e) => e.preventDefault()}
    >
      {loading && suggestions.length === 0 ? (
        <div className="p-3 flex items-center gap-2 text-xs text-content-secondary">
          <Loader2 size={14} className="animate-spin" /> جاري البحث في دليل الهاتف...
        </div>
      ) : suggestions.length === 0 ? (
        <div className="p-3 text-xs text-content-secondary">لا توجد نتائج مطابقة في دليل الهاتف</div>
      ) : (
        suggestions.map((entry, i) => (
          <button
            type="button"
            key={entry.id}
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(entry)}
            className={`w-full text-right px-3 py-2 text-xs flex items-start gap-2 border-b border-content/5 last:border-b-0 ${
              i === activeIndex ? 'bg-primary/10' : 'hover:bg-content/5'
            }`}
          >
            {entry.source === 'employee' ? (
              <User size={13} className="text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <Phone size={13} className="text-primary shrink-0 mt-0.5" />
            )}
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-content block truncate">{entry.label}</span>
              {entry.section && (
                <span className="text-content-secondary block truncate text-[11px]">{entry.section}</span>
              )}
              {entry.details.length > 0 && (
                <span className={entry.source === 'employee' ? 'text-emerald-600 block truncate' : 'text-primary block'} dir={entry.source === 'phone' ? 'ltr' : undefined}>
                  {entry.details.join(' / ')}
                </span>
              )}
            </span>
          </button>
        ))
      )}
    </div>
  );
};

export default DirectoryMentionDropdown;
