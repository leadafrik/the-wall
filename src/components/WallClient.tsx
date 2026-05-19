'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Composer } from '@/components/Composer';
import { ExpandedNote } from '@/components/ExpandedNote';
import { Note } from '@/components/Note';
import { SectionFilter } from '@/components/SectionFilter';
import { CANVAS_SIZE } from '@/lib/placement';
import { containsStrongLanguage } from '@/lib/profanity';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { Note as NoteData, Section } from '@/types';

interface Props {
  initialNotes: NoteData[];
  activeSection: Section | null;
  initialFocus?: NoteData | null; // for /note/[id] direct links
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.5;
const DRAG_THRESHOLD_PX = 4;
// Buffer past the visible viewport for rendering notes. Bigger = fewer
// notes flash in at the edges during fast pans, more notes mounted at once.
const VIRTUALIZE_BUFFER_PX = 600;
// Pixels per arrow-key press (in canvas coords, before zoom).
const ARROW_STEP_PX = 160;
// Multiplier on trackpad/wheel deltas for two-finger pan. Tuned so a normal
// macOS swipe feels like the wall is moving with your fingers.
const WHEEL_PAN_FACTOR = 1;

// -------- Touch tuning --------
// Pan-momentum decay per frame at 60fps. 0.92 → velocity halves in ~8 frames
// (~130ms), feels like a flick on a touchscreen rather than infinite glide.
const MOMENTUM_DECAY = 0.92;
// Minimum speed (px/ms) needed to start momentum after a touch release.
const MOMENTUM_MIN_SPEED = 0.08;
// Stop momentum when speed drops below this.
const MOMENTUM_STOP_SPEED = 0.02;
// Time window (ms) over which we average finger velocity before release.
const VELOCITY_SAMPLE_MS = 60;
// Double-tap window: a second tap within this many ms and within
// DOUBLE_TAP_RADIUS px of the first is treated as a double-tap.
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_RADIUS = 36;
// Zoom levels that double-tap toggles between.
const DOUBLE_TAP_ZOOM_OUT = 1;
const DOUBLE_TAP_ZOOM_IN = 2.2;

const HINT_SEEN_KEY = 'wall_hint_seen_v1';
const GENTLE_MODE_KEY = 'wall_gentle_mode_v1';

export function WallClient({ initialNotes, activeSection, initialFocus }: Props) {
  const [notes, setNotes] = useState<NoteData[]>(initialNotes);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<NoteData | null>(initialFocus ?? null);
  const [hintVisible, setHintVisible] = useState(false);
  const [arrowAnimating, setArrowAnimating] = useState(false);

  // Pan/zoom state. translate-then-scale, transform-origin: 0 0.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(() => initialPan(initialFocus));

  // Gentle mode — reader-controlled, client-side, opt-in. Default off.
  const [gentle, setGentle] = useState(false);
  useEffect(() => {
    try {
      setGentle(window.localStorage.getItem(GENTLE_MODE_KEY) === '1');
    } catch {
      // localStorage unavailable (private mode etc.) — stay off.
    }
  }, []);
  const toggleGentle = useCallback(() => {
    setGentle((g) => {
      const next = !g;
      try {
        if (next) window.localStorage.setItem(GENTLE_MODE_KEY, '1');
        else window.localStorage.removeItem(GENTLE_MODE_KEY);
      } catch {
        // Ignore — toggle still works for this session.
      }
      return next;
    });
  }, []);

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

  // -------- Arrow-key panning (smooth) --------
  // Each press nudges the wall by ARROW_STEP_PX in canvas coords. We toggle
  // a CSS transition on the canvas for ~180ms so it eases instead of jumping
  // — and we don't run it during drag/wheel so those stay instant.
  const arrowTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't steal arrow keys when the user is typing in the composer.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case 'ArrowLeft':  dx =  ARROW_STEP_PX; break;
        case 'ArrowRight': dx = -ARROW_STEP_PX; break;
        case 'ArrowUp':    dy =  ARROW_STEP_PX; break;
        case 'ArrowDown':  dy = -ARROW_STEP_PX; break;
        default: return;
      }
      e.preventDefault();
      setArrowAnimating(true);
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      window.clearTimeout(arrowTimerRef.current);
      arrowTimerRef.current = window.setTimeout(
        () => setArrowAnimating(false),
        200,
      );
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(arrowTimerRef.current);
    };
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

  // -------- Wheel: two-finger trackpad pan OR pinch-zoom --------
  // Attached imperatively (not via React's onWheel) so we can register a
  // *non-passive* listener and preventDefault. Without that, ctrlKey+wheel
  // also triggers the browser's own zoom — which shrinks every fixed-position
  // element (composer, filter, header) right out of view.
  //
  // Browsers report trackpad pinch as wheel + ctrlKey true. Two-finger swipe
  // and mouse-wheel are wheel without ctrlKey. macOS / Windows precision
  // trackpads both follow this.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      e.preventDefault();
      const target = containerRef.current;
      if (!target) return;

      if (e.ctrlKey) {
        const rect = target.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.012);
        setZoom((z) => {
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
          const ratio = next / z;
          setPan((p) => ({
            x: cx - (cx - p.x) * ratio,
            y: cy - (cy - p.y) * ratio,
          }));
          return next;
        });
        return;
      }

      setPan((p) => ({
        x: p.x - e.deltaX * WHEEL_PAN_FACTOR,
        y: p.y - e.deltaY * WHEEL_PAN_FACTOR,
      }));
    }
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  // -------- Touch: single-finger pan (+momentum), two-finger pinch, double-tap --------
  //
  // Pinch: we capture the start state once and re-derive pan on every move
  // as if it's a single transform from start → now. The on-screen finger
  // midpoint moves; the canvas point originally under that midpoint stays
  // under the moving midpoint. That kills the wobble where fingers drift
  // and the zoom anchors to wherever they started.
  //
  // Momentum: while panning we record the most recent samples in a small
  // ring. On release we project velocity from the last VELOCITY_SAMPLE_MS
  // window and run a per-frame decay until it falls below STOP_SPEED.
  //
  // Double-tap: a quick second finger-down near the same spot toggles zoom
  // between DOUBLE_TAP_ZOOM_OUT and DOUBLE_TAP_ZOOM_IN, anchored under the
  // tap so the user sees the spot they tapped grow in place.
  const touchRef = useRef<
    | {
        mode: 'pan';
        startX: number;
        startY: number;
        panX: number;
        panY: number;
        samples: Array<{ x: number; y: number; t: number }>;
      }
    | {
        mode: 'pinch';
        startDist: number;
        startZoom: number;
        startCenterX: number;
        startCenterY: number;
        startPanX: number;
        startPanY: number;
      }
    | null
  >(null);

  // Last tap info (for double-tap detection). Lives across touch events.
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // Momentum animation frame handle. Cancelled when a new touch starts or
  // the user opens the expanded view.
  const momentumRafRef = useRef<number | null>(null);
  const cancelMomentum = useCallback(() => {
    if (momentumRafRef.current != null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      cancelMomentum();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchRef.current = {
          mode: 'pan',
          startX: t.clientX,
          startY: t.clientY,
          panX: pan.x,
          panY: pan.y,
          samples: [{ x: t.clientX, y: t.clientY, t: performance.now() }],
        };
      } else if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const rect = containerRef.current?.getBoundingClientRect();
        const cx = (a.clientX + b.clientX) / 2 - (rect?.left ?? 0);
        const cy = (a.clientY + b.clientY) / 2 - (rect?.top ?? 0);
        touchRef.current = {
          mode: 'pinch',
          startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          startZoom: zoom,
          startCenterX: cx,
          startCenterY: cy,
          startPanX: pan.x,
          startPanY: pan.y,
        };
      }
    },
    [pan.x, pan.y, zoom, cancelMomentum],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const tr = touchRef.current;
      if (!tr) return;
      if (tr.mode === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        const now = performance.now();
        // Trim ring to the velocity window so old samples don't dilute it.
        tr.samples.push({ x: t.clientX, y: t.clientY, t: now });
        while (
          tr.samples.length > 2 &&
          now - tr.samples[0].t > VELOCITY_SAMPLE_MS
        ) {
          tr.samples.shift();
        }
        setPan(
          clampPan(
            {
              x: tr.panX + (t.clientX - tr.startX),
              y: tr.panY + (t.clientY - tr.startY),
            },
            zoom,
            viewport.w,
            viewport.h,
          ),
        );
      } else if (tr.mode === 'pinch' && e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const rect = containerRef.current?.getBoundingClientRect();
        const cx = (a.clientX + b.clientX) / 2 - (rect?.left ?? 0);
        const cy = (a.clientY + b.clientY) / 2 - (rect?.top ?? 0);
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, tr.startZoom * (dist / tr.startDist)),
        );
        // Canvas point originally under the start-center.
        const anchorX = (tr.startCenterX - tr.startPanX) / tr.startZoom;
        const anchorY = (tr.startCenterY - tr.startPanY) / tr.startZoom;
        setZoom(nextZoom);
        setPan(
          clampPan(
            { x: cx - anchorX * nextZoom, y: cy - anchorY * nextZoom },
            nextZoom,
            viewport.w,
            viewport.h,
          ),
        );
      }
    },
    [zoom, viewport.w, viewport.h],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const tr = touchRef.current;
      touchRef.current = null;

      // Double-tap: only when no other fingers remain and we ended a single-
      // finger interaction that didn't really pan (treated as a tap).
      if (
        tr?.mode === 'pan' &&
        e.touches.length === 0 &&
        tr.samples.length > 0
      ) {
        const first = tr.samples[0];
        const last = tr.samples[tr.samples.length - 1];
        const moved = Math.hypot(last.x - first.x, last.y - first.y);
        if (moved < DRAG_THRESHOLD_PX) {
          const now = performance.now();
          const prev = lastTapRef.current;
          if (
            prev &&
            now - prev.t < DOUBLE_TAP_MS &&
            Math.hypot(last.x - prev.x, last.y - prev.y) < DOUBLE_TAP_RADIUS
          ) {
            // Double-tap! Zoom toggling anchored under the tap point.
            const rect = containerRef.current?.getBoundingClientRect();
            const tx = last.x - (rect?.left ?? 0);
            const ty = last.y - (rect?.top ?? 0);
            const nextZoom =
              zoom > (DOUBLE_TAP_ZOOM_OUT + DOUBLE_TAP_ZOOM_IN) / 2
                ? DOUBLE_TAP_ZOOM_OUT
                : DOUBLE_TAP_ZOOM_IN;
            const ratio = nextZoom / zoom;
            setZoom(nextZoom);
            setPan((p) => ({
              x: tx - (tx - p.x) * ratio,
              y: ty - (ty - p.y) * ratio,
            }));
            // Don't fall through to letting the underlying note click open
            // the expanded view — the next tap that lands on a note will.
            justDraggedRef.current = true;
            lastTapRef.current = null;
            return;
          }
          lastTapRef.current = { x: last.x, y: last.y, t: now };
          // Real tap → let the note's onClick fire normally.
          return;
        }
      }

      // Momentum from single-finger pan release. Average velocity over the
      // last few samples so a tiny finger jitter at the end doesn't dominate.
      if (tr?.mode === 'pan' && e.touches.length === 0 && tr.samples.length >= 2) {
        const last = tr.samples[tr.samples.length - 1];
        const first = tr.samples[0];
        const dt = last.t - first.t;
        if (dt > 0) {
          let vx = (last.x - first.x) / dt;
          let vy = (last.y - first.y) / dt;
          const speed = Math.hypot(vx, vy);
          if (speed > MOMENTUM_MIN_SPEED) {
            let prevT = performance.now();
            const step = () => {
              const now = performance.now();
              const frameDt = now - prevT;
              prevT = now;
              setPan((p) => ({ x: p.x + vx * frameDt, y: p.y + vy * frameDt }));
              // Convert per-frame decay to a time-based one so 30fps phones
              // don't decay twice as slow as 60fps ones.
              const decay = Math.pow(MOMENTUM_DECAY, frameDt / (1000 / 60));
              vx *= decay;
              vy *= decay;
              if (Math.hypot(vx, vy) > MOMENTUM_STOP_SPEED) {
                momentumRafRef.current = requestAnimationFrame(step);
              } else {
                momentumRafRef.current = null;
              }
            };
            momentumRafRef.current = requestAnimationFrame(step);
            justDraggedRef.current = true;
          }
        }
      }
    },
    [zoom],
  );

  // Cancel momentum when the expanded view opens (it covers the wall and
  // we don't want a stale animation tugging the canvas behind it).
  useEffect(() => {
    if (expanded) cancelMomentum();
  }, [expanded, cancelMomentum]);

  // Stop any running momentum on unmount.
  useEffect(() => cancelMomentum, [cancelMomentum]);

  // Apply gentle mode before virtualization so hidden notes never mount.
  // No "N notes hidden" indicator — the whole point is a calmer surface.
  const readableNotes = useMemo(
    () => (gentle ? notes.filter((n) => !containsStrongLanguage(n.text)) : notes),
    [notes, gentle],
  );

  // -------- Virtualization --------
  const visibleNotes = useMemo(() => {
    if (viewport.w === 0) return readableNotes;
    // Screen->canvas: x_canvas = (x_screen - pan.x) / zoom
    const x1 = (-pan.x) / zoom - VIRTUALIZE_BUFFER_PX;
    const y1 = (-pan.y) / zoom - VIRTUALIZE_BUFFER_PX;
    const x2 = (viewport.w - pan.x) / zoom + VIRTUALIZE_BUFFER_PX;
    const y2 = (viewport.h - pan.y) / zoom + VIRTUALIZE_BUFFER_PX;
    return readableNotes.filter((n) => n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2);
  }, [readableNotes, pan.x, pan.y, zoom, viewport.w, viewport.h]);

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

  const [shuffling, setShuffling] = useState(false);

  async function handleShuffle() {
    if (shuffling) return;
    setShuffling(true);
    try {
      const params = activeSection ? `?section=${encodeURIComponent(activeSection)}` : '';
      const res = await fetch(`/api/notes/shuffle${params}`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { notes: NoteData[] };
      if (!body.notes?.length) return;
      setNotes(body.notes);
      // Pan to a random note from the new set so the page visibly refreshes.
      const target = body.notes[Math.floor(Math.random() * body.notes.length)];
      const targetPanX = viewport.w / 2 - target.x * zoom;
      const targetPanY = viewport.h / 2 - target.y * zoom;
      setArrowAnimating(true);
      setPan({ x: targetPanX, y: targetPanY });
      window.setTimeout(() => setArrowAnimating(false), 220);
    } finally {
      setShuffling(false);
    }
  }

  return (
    <>
      <div
        ref={containerRef}
        className={`wall${isDragging ? ' wall--dragging' : ''}`}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={`wall__canvas${arrowAnimating ? ' wall__canvas--easing' : ''}`}
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

      <SectionFilter
        active={activeSection}
        onShuffle={handleShuffle}
        shuffling={shuffling}
        gentle={gentle}
        onToggleGentle={toggleGentle}
      />
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
