'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Composer } from '@/components/Composer';
import { ExpandedNote } from '@/components/ExpandedNote';
import { Note } from '@/components/Note';
import { SectionFilter } from '@/components/SectionFilter';
import { CANVAS_SIZE } from '@/lib/placement';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { Note as NoteData, Section } from '@/types';

interface Props {
  initialNotes: NoteData[];
  activeSection: Section | null;
  initialFocus?: NoteData | null; // for /note/[id] direct links
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const DRAG_THRESHOLD_PX = 4;
const VIRTUALIZE_BUFFER_PX = 300;

const HINT_SEEN_KEY = 'wall_hint_seen_v1';

export function WallClient({ initialNotes, activeSection, initialFocus }: Props) {
  const [notes, setNotes] = useState<NoteData[]>(initialNotes);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<NoteData | null>(initialFocus ?? null);
  const [hintVisible, setHintVisible] = useState(false);

  // Pan/zoom state. translate-then-scale, transform-origin: 0 0.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(() => initialPan(initialFocus));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // -------- Realtime subscription --------
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    try {
      const supabase = getSupabaseBrowser();
      const channel = supabase
        .channel('notes-stream')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notes' },
          (payload) => {
            const incoming = payload.new as NoteData;
            if (!incoming.is_visible) return;
            if (activeSection && incoming.section !== activeSection) return;
            setNotes((prev) =>
              prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev],
            );
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notes' },
          (payload) => {
            const updated = payload.new as NoteData;
            setNotes((prev) => {
              if (!updated.is_visible) return prev.filter((n) => n.id !== updated.id);
              const idx = prev.findIndex((n) => n.id === updated.id);
              if (idx === -1) return [updated, ...prev];
              const next = prev.slice();
              next[idx] = updated;
              return next;
            });
          },
        )
        .subscribe();
      cleanup = () => {
        supabase.removeChannel(channel);
      };
    } catch {
      // Supabase env not configured — fall back silently.
    }
    return () => cleanup?.();
  }, [activeSection]);

  // -------- Track viewport size --------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -------- One-time drag hint --------
  useEffect(() => {
    try {
      if (window.localStorage.getItem(HINT_SEEN_KEY)) return;
    } catch {
      return;
    }
    setHintVisible(true);
    window.localStorage.setItem(HINT_SEEN_KEY, '1');
    const t = setTimeout(() => setHintVisible(false), 4500);
    return () => clearTimeout(t);
  }, []);

  // -------- Pan helpers --------
  // The wall scrolls infinitely — no edge clamp. Identity function for now,
  // kept so callers don't have to special-case "no clamp".
  function clampPan(p: { x: number; y: number }, _z: number, _vw: number, _vh: number) {
    return p;
  }

  // -------- Mouse drag pan --------
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  // Set on mouseup if the pointer actually moved past threshold; consumed by the next click
  // so a drag-release on a note doesn't open the expanded view.
  const justDraggedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  }, [pan.x, pan.y]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        d.moved = true;
        setIsDragging(true);
      }
      if (d.moved) {
        const next = clampPan({ x: d.panX + dx, y: d.panY + dy }, zoom, viewport.w, viewport.h);
        setPan(next);
      }
    }
    function onUp() {
      const d = dragRef.current;
      if (d?.moved) justDraggedRef.current = true;
      dragRef.current = null;
      setIsDragging(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, viewport.w, viewport.h]);

  // -------- Wheel zoom (centered on cursor) --------
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom((z) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
        const ratio = next / z;
        setPan((p) =>
          clampPan(
            { x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio },
            next,
            viewport.w,
            viewport.h,
          ),
        );
        return next;
      });
    },
    [viewport.w, viewport.h],
  );

  // -------- Touch: single-finger pan, two-finger pinch --------
  const touchRef = useRef<
    | { mode: 'pan'; startX: number; startY: number; panX: number; panY: number }
    | { mode: 'pinch'; startDist: number; startZoom: number; centerX: number; centerY: number; panX: number; panY: number }
    | null
  >(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchRef.current = {
          mode: 'pan',
          startX: t.clientX,
          startY: t.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      } else if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const rect = containerRef.current?.getBoundingClientRect();
        touchRef.current = {
          mode: 'pinch',
          startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          startZoom: zoom,
          centerX: (a.clientX + b.clientX) / 2 - (rect?.left ?? 0),
          centerY: (a.clientY + b.clientY) / 2 - (rect?.top ?? 0),
          panX: pan.x,
          panY: pan.y,
        };
      }
    },
    [pan.x, pan.y, zoom],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const tr = touchRef.current;
      if (!tr) return;
      if (tr.mode === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        setPan(
          clampPan(
            { x: tr.panX + (t.clientX - tr.startX), y: tr.panY + (t.clientY - tr.startY) },
            zoom,
            viewport.w,
            viewport.h,
          ),
        );
      } else if (tr.mode === 'pinch' && e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, tr.startZoom * (dist / tr.startDist)));
        const ratio = next / tr.startZoom;
        setZoom(next);
        setPan(
          clampPan(
            {
              x: tr.centerX - (tr.centerX - tr.panX) * ratio,
              y: tr.centerY - (tr.centerY - tr.panY) * ratio,
            },
            next,
            viewport.w,
            viewport.h,
          ),
        );
      }
    },
    [zoom, viewport.w, viewport.h],
  );

  const onTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  // -------- Virtualization --------
  const visibleNotes = useMemo(() => {
    if (viewport.w === 0) return notes;
    // Screen->canvas: x_canvas = (x_screen - pan.x) / zoom
    const x1 = (-pan.x) / zoom - VIRTUALIZE_BUFFER_PX;
    const y1 = (-pan.y) / zoom - VIRTUALIZE_BUFFER_PX;
    const x2 = (viewport.w - pan.x) / zoom + VIRTUALIZE_BUFFER_PX;
    const y2 = (viewport.h - pan.y) / zoom + VIRTUALIZE_BUFFER_PX;
    return notes.filter((n) => n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2);
  }, [notes, pan.x, pan.y, zoom, viewport.w, viewport.h]);

  function handleNoteClick(n: NoteData) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setExpanded(n);
  }

  function handlePosted(note: NoteData) {
    setNotes((prev) => [note, ...prev]);
    setRecentlyAdded((s) => new Set(s).add(note.id));
    // Pan to the new note so the user sees it land.
    const targetPanX = viewport.w / 2 - note.x * zoom;
    const targetPanY = viewport.h / 2 - note.y * zoom;
    setPan(clampPan({ x: targetPanX, y: targetPanY }, zoom, viewport.w, viewport.h));
  }

  return (
    <>
      <div
        ref={containerRef}
        className={`wall${isDragging ? ' wall--dragging' : ''}`}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="wall__canvas"
          style={{
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {visibleNotes.map((n) => (
            <Note
              key={n.id}
              note={n}
              onClick={handleNoteClick}
              appear={recentlyAdded.has(n.id)}
            />
          ))}
        </div>

        <header className="wall__header">
          <a href="/" className="wall__title">the wall</a>
          <a href="/about" className="wall__about">about</a>
        </header>

        {hintVisible && (
          <div className="wall__hint" aria-hidden>
            drag to explore
          </div>
        )}
      </div>

      <SectionFilter active={activeSection} />
      <Composer defaultSection={activeSection} onPosted={handlePosted} />

      {expanded && (
        <ExpandedNote note={expanded} onClose={() => setExpanded(null)} />
      )}
    </>
  );
}

function initialPan(focus?: NoteData | null) {
  if (typeof window === 'undefined') {
    return { x: -CANVAS_SIZE / 2 + 600, y: -CANVAS_SIZE / 2 + 400 };
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  if (focus) return { x: cx - focus.x, y: cy - focus.y };
  return { x: cx - CANVAS_SIZE / 2, y: cy - CANVAS_SIZE / 2 };
}
