// src/components/DepartmentTreeSelect.tsx
// منتقٍ قسم واحد على شكل شجرة قابلة للطي/التوسيع — بديل عن القائمة الأبجدية المسطّحة، يسهّل تحديد
// القسم الصحيح بصرياً عبر تتبّع الهرمية (قسم ← أقسامه الفرعية ← ...) بدلاً من البحث في قائمة طويلة.
// مُستخرَج هنا لاستخدامه من أكثر من مكوّن (DepartmentManagement وCalendarBroadcastSettings).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export type Department = {
  DepartmentID: number;
  Name: string;
  ParentID?: number | null;
  ParentDepartmentID?: number | null;
  IsActive?: boolean | number;
  Active?: boolean | number;
  Type?: number | string | null;
  IsIndependent?: boolean | number | null;
};

type TreeNode = Department & { children: TreeNode[] };

export const normalizeDeptParentId = (dep: Department): number | null => {
  const pid = dep.ParentID ?? dep.ParentDepartmentID;
  if (pid === undefined || pid === null) return null;
  const n = Number(pid);
  return Number.isFinite(n) ? n : null;
};

export const buildDeptTree = (items: Department[]): TreeNode[] => {
  const map = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];
  items.forEach((d) => map.set(d.DepartmentID, { ...d, children: [] }));
  map.forEach((node) => {
    const pid = normalizeDeptParentId(node);
    if (pid != null && map.has(pid)) {
      map.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.Name.localeCompare(b.Name));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
};

type DepartmentTreeSelectProps = {
  departments: Department[];
  value: number | null;
  onChange: (id: number | null) => void;
  noneLabel: string;
};

const DepartmentTreeSelect: React.FC<DepartmentTreeSelectProps> = ({ departments, value, onChange, noneLabel }) => {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildDeptTree(departments), [departments]);
  const nameById = useMemo(() => new Map(departments.map(d => [d.DepartmentID, d.Name])), [departments]);

  useEffect(() => {
    if (!open || value == null) return;
    const map = new Map(departments.map(d => [d.DepartmentID, d]));
    const toExpand: number[] = [];
    let cur = map.get(value);
    const visited = new Set<number>();
    while (cur && !visited.has(cur.DepartmentID)) {
      visited.add(cur.DepartmentID);
      const pid = normalizeDeptParentId(cur);
      if (pid == null) break;
      toExpand.push(pid);
      cur = map.get(pid);
    }
    if (toExpand.length) {
      setExpandedIds(prev => new Set([...prev, ...toExpand]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleNode = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderTreeNode = (node: TreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.DepartmentID);
    const isSelected = value === node.DepartmentID;
    return (
      <li key={node.DepartmentID}>
        <div
          className={`flex items-center gap-1 py-1 px-1 rounded cursor-pointer text-sm ${isSelected ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-content/5'}`}
          style={{ paddingRight: depth * 16 }}
          onClick={() => { onChange(node.DepartmentID); setOpen(false); }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleNode(node.DepartmentID); }}
              className="text-gray-400 shrink-0"
            >
              {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            </button>
          ) : <span className="w-[14px] shrink-0" />}
          <span>{node.Name}</span>
        </div>
        {hasChildren && isExpanded && (
          <ul>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm text-right flex items-center justify-between gap-2"
      >
        <span className={value == null ? 'text-gray-400' : ''}>
          {value == null ? noneLabel : (nameById.get(value) || `#${value}`)}
        </span>
        <ChevronDown size={14} className="text-gray-400 shrink-0"/>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-gray-800 dark:border-gray-600 border rounded shadow-lg p-2" dir="rtl">
          <div
            className={`py-1 px-1 rounded cursor-pointer text-sm mb-1 ${value == null ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-content/5 text-gray-600 dark:text-gray-400'}`}
            onClick={() => { onChange(null); setOpen(false); }}
          >
            {noneLabel}
          </div>
          <ul className="space-y-0.5">
            {tree.map(root => renderTreeNode(root, 0))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default DepartmentTreeSelect;
