/**
 * 「添加节点」菜单 —— 底部工具栏 ＋ 按钮点开的内容（对应错误3 的诉求）。
 *
 * 按分组列出全部节点类型，点一下就加到画布可视区中心；也可以继续拖到画布上精确摆放。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NODE_DEFS, type NodeDef, type NodeKind, type PortDef, type PortKind } from '@h3/shared';
import type { HandleType, XYPosition } from '@xyflow/react';
import { compatibleNodePorts } from '../canvas/connections.ts';
import { useCanvasBridge } from '../canvas/canvas-bridge.ts';
import { DRAG_MIME } from '../canvas/FlowCanvas.tsx';
import { classNames } from '../lib/media.ts';

const GROUP_ORDER = ['输入', '组织', '任务', '管理'] as const;

interface Props {
  onClose: () => void;
  onAdded?: (kind: NodeKind) => void;
  connection?: {
    anchor: XYPosition;
    portKind: PortKind;
    direction: HandleType;
    label: string;
    onSelect: (kind: NodeKind, handleId: string) => void;
  };
}

export function NodePickerMenu({ onClose, onAdded, connection }: Props) {
  const addNodeAtCenter = useCanvasBridge((s) => s.addNodeAtCenter);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<XYPosition | null>(null);

  useLayoutEffect(() => {
    const menu = ref.current;
    const parent = menu?.parentElement;
    if (!connection || !menu || !parent) return;
    const place = () => setPlacement({
      x: Math.max(8, Math.min(connection.anchor.x, parent.clientWidth - menu.offsetWidth - 8)),
      y: Math.max(8, Math.min(connection.anchor.y, parent.clientHeight - menu.offsetHeight - 8)),
    });
    place();
    const observer = new ResizeObserver(place);
    observer.observe(parent);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [connection?.anchor.x, connection?.anchor.y]);

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
    items: Object.values(NODE_DEFS).flatMap<{ def: NodeDef; port?: PortDef }>((def) => connection
      ? compatibleNodePorts(def.kind, connection.portKind, connection.direction).map((port) => ({ def, port }))
      : [{ def, port: undefined }],
    ).filter(
      ({ def, port }) =>
        def.group === group &&
        (query.length === 0 || `${def.label}${def.description}${port?.label ?? ''}`.toLowerCase().includes(query.toLowerCase())),
    ),
  })).filter((entry) => entry.items.length > 0);

  const select = (kind: NodeKind, handleId?: string) => {
    if (connection && handleId) {
      connection.onSelect(kind, handleId);
      onClose();
    } else {
      const id = addNodeAtCenter(kind);
      if (id) {
        onAdded?.(kind);
        onClose();
      }
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={connection ? '添加并连接节点' : '添加节点'}
      className={classNames(
        'absolute z-50 overflow-y-auto rounded-xl border border-ink-600 bg-ink-900/98 p-3 shadow-2xl backdrop-blur',
        connection ? 'w-[360px] max-w-[calc(100%-16px)] max-h-[min(420px,calc(100%-16px))]' : 'bottom-[68px] left-1/2 max-h-[52vh] w-[460px] -translate-x-1/2',
      )}
      style={connection ? { left: placement?.x ?? connection.anchor.x, top: placement?.y ?? connection.anchor.y } : undefined}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] text-mist-200">{connection ? '添加并连接节点' : '添加节点'}</span>
        {!connection && <span className="text-[10px] text-mist-500">点击加到画布中心，或拖到画布上</span>}
        <button type="button" aria-label="关闭节点菜单" className="ml-auto text-[11px] text-mist-400 hover:text-mist-100" onClick={onClose}>
          ×
        </button>
      </div>
      {connection && <p className="mb-2 text-[11px] text-mist-400">{connection.label} · 选择{connection.direction === 'source' ? '下游' : '上游'}节点自动连接</p>}

      <input
        autoFocus
        className="field mb-2 !py-1 !text-[12px]"
        placeholder="搜索节点…"
        aria-label="搜索节点"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter') {
            event.preventDefault();
            const first = groups[0]?.items[0];
            if (first) select(first.def.kind, first.port?.id);
          }
        }}
      />

      <div className={classNames('grid gap-x-3 gap-y-2', !connection && 'grid-cols-2')}>
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="mb-1 text-[10px] text-mist-500">{group}</div>
            <div className="space-y-1">
              {items.map(({ def, port }) => (
                <button
                  key={`${def.kind}-${port?.id ?? ''}`}
                  type="button"
                  aria-label={port ? `${def.label} ${port.label}` : def.label}
                  draggable={!connection}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_MIME, def.kind);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => select(def.kind, port?.id)}
                  className={classNames(
                    'flex w-full cursor-pointer items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left',
                    'hover:border-ink-600 hover:bg-ink-850',
                  )}
                  title={def.description}
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: def.accent }} />
                  <span className="min-w-0">
                    <span className="block text-[12px] text-mist-200">{def.label}{port && <span className="ml-2 text-[10px] text-mist-400">{port.label}</span>}</span>
                    <span className="block truncate text-[10px] text-mist-500">{def.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-[11px] text-mist-500">没有匹配的节点。</p>}
      </div>
      {connection && <p className="mt-3 border-t border-ink-700 pt-2 text-[10px] text-mist-500">仅显示兼容端口 · Enter 添加 · Esc 取消</p>}
    </div>
  );
}
