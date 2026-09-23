// src/hooks/useDirectoryMention.ts
// يفعّل اقتراحات دليل الهاتف عند كتابة "@" داخل أي حقل نصي (input أو textarea)
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';

export type DirectoryEntry = {
  id: number;
  label: string;
  labelEn?: string;
  section?: string;
  phones: string[];
};

type MentionElement = HTMLInputElement | HTMLTextAreaElement;

// يبحث للخلف من موضع المؤشر عن '@' يبدأ عندها الاستعلام — يسمح باستعلام من عدة كلمات
// (مثل "مدير الادارة") طالما لم يصطدم بسطر جديد أو تجاوز الحد الأقصى للطول
const MAX_QUERY_LEN = 40;
const detectTrigger = (text: string, cursor: number): { start: number; query: string } | null => {
  let i = cursor - 1;
  while (i >= 0 && text[i] !== '@') {
    if (text[i] === '\n' || cursor - i > MAX_QUERY_LEN) return null;
    i--;
  }
  if (i < 0 || text[i] !== '@') return null;
  // تجاهل '@' الملتصق بحرف قبله مباشرة (مثل بريد إلكتروني) — يجب أن يبدأ كلمة جديدة
  const prevChar = i > 0 ? text[i - 1] : '';
  if (prevChar && !/\s/.test(prevChar)) return null;
  return { start: i, query: text.slice(i + 1, cursor) };
};

export function useDirectoryMention<T extends MentionElement = HTMLTextAreaElement>(
  value: string,
  onChange: (next: string) => void,
  externalRef?: RefObject<T>
) {
  const ownRef = useRef<T>(null) as RefObject<T>;
  const ref = externalRef ?? ownRef;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DirectoryEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const triggerStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/directory/search?q=${encodeURIComponent(query)}&limit=8`);
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, isOpen]);

  const close = () => {
    setIsOpen(false);
    triggerStartRef.current = null;
  };

  const handleChange = (e: ChangeEvent<T>) => {
    const next = e.target.value;
    onChange(next);
    const cursor = e.target.selectionStart ?? next.length;
    const trig = detectTrigger(next, cursor);
    if (trig) {
      triggerStartRef.current = trig.start;
      setQuery(trig.query);
      setIsOpen(true);
      setActiveIndex(0);
    } else {
      close();
    }
  };

  const selectSuggestion = (entry: DirectoryEntry) => {
    const el = ref.current;
    if (triggerStartRef.current == null || !el) return;
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, triggerStartRef.current);
    const after = value.slice(cursor);
    const insertText = `${entry.label} (${entry.phones.join('/')})`;
    const next = `${before}${insertText}${after}`;
    onChange(next);
    close();
    requestAnimationFrame(() => {
      const pos = before.length + insertText.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<T>) => {
    if (!isOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return { ref, isOpen, query, suggestions, activeIndex, loading, handleChange, handleKeyDown, selectSuggestion, close, setActiveIndex };
}
