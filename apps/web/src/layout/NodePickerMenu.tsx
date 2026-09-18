/**
 * 「添加节点」菜单 —— 底部工具栏 ＋ 按钮点开的内容（对应错误3 的诉求）。
 *
 * 按分组列出全部节点类型，点一下就加到画布可视区中心；也可以继续拖到画布上精确摆放。
 */
import { useEffect, useRef, useState } from 'react';
import { NODE_DEFS, type NodeKind } from '@h3/shared';
import { useCanvasBridge } from '../canvas/canvas-bridge.ts';
import { DRAG_MIME } from '../canvas/FlowCanvas.tsx';
import { classNames } from '../lib/media.ts';

const GROUP_ORDER = ['输入', '组织', '任务', '管理'] as const;

interface Props {
  onClose: () => void;
  onAdded?: (kind: NodeKind) => void;
}

export function NodePickerMenu({ onClose, onAdded }: Props) {
  const addNodeAtCenter = useCanvasBridge((s) => s.addNodeAtCenter);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // 延后一帧再挂监听，否则打开菜单的那次点击会立刻把它关掉
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: Object.values(NODE_DEFS).filter(
      (def) =>
        def.group === group &&
        (query.length === 0 || `${def.label}${def.description}`.toLowerCase().includes(query.toLowerCase())),
    ),
  })).filter((entry) => entry.items.length > 0);

  return (
    <div
      ref={ref}
      className="absolute bottom-[68px] left-1/2 z-50 max-h-[52vh] w-[460px] -translate-x-1/2 overflow-y-auto rounded-xl border border-ink-600 bg-ink-900/98 p-3 shadow-2xl backdrop-blur"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] text-mist-200">添加节点</span>
        <span className="text-[10px] text-mist-500">点击加到画布中心，或拖到画布上</span>
        <button type="button" className="ml-auto text-[11px] text-mist-400 hover:text-mist-100" onClick={onClose}>
          ×
        </button>
      </div>

      <input
        autoFocus
        className="field mb-2 !py-1 !text-[12px]"
        placeholder="搜索节点…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            const first = groups[0]?.items[0];
            if (first) {
              const id = addNodeAtCenter(first.kind);
              if (id) onAdded?.(first.kind);
            }
          }
        }}
      />

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="mb-1 text-[10px] text-mist-500">{group}</div>
            <div className="space-y-1">
              {items.map((def) => (
                <button
                  key={def.kind}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_MIME, def.kind);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => {
                    const id = addNodeAtCenter(def.kind);
                    if (id) {
                      onAdded?.(def.kind);
                      onClose();
                    }
                  }}
                  className={classNames(
                    'flex w-full cursor-pointer items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left',
                    'hover:border-ink-600 hover:bg-ink-850',
                  )}
                  title={def.description}
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: def.accent }} />
                  <span className="min-w-0">
                    <span className="block text-[12px] text-mist-200">{def.label}</span>
                    <span className="block truncate text-[10px] text-mist-500">{def.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-[11px] text-mist-500">没有匹配的节点。</p>}
      </div>
    </div>
  );
}
