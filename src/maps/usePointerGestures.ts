import { useEffect, useRef, type RefObject } from 'react';
import { GestureTracker, type GestureEvent } from './gestures';

export interface GestureHandlers {
  onGesture: (event: GestureEvent) => void;
  /** Wheel zoom: `deltaY` in px (line and page deltas converted) about (`x`, `y`). */
  onWheel: (deltaY: number, x: number, y: number) => void;
}

/**
 * Feed an element's pointer and wheel events (coordinates relative to the element, CSS px) into a
 * `GestureTracker`. The element needs `touch-action: none` so the browser leaves touch to us; the
 * wheel listener is non-passive so it can stop the page scrolling.
 */
export function usePointerGestures(ref: RefObject<Element | null>, handlers: GestureHandlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const el = ref.current as HTMLElement | null;
    if (!el) return;
    const tracker = new GestureTracker();
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const emit = (events: GestureEvent[]) => events.forEach((ev) => latest.current.onGesture(ev));

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      tracker.down(e.pointerId, ...local(e));
    };
    const move = (e: PointerEvent) => emit(tracker.move(e.pointerId, ...local(e)));
    const up = (e: PointerEvent) => emit(tracker.up(e.pointerId, ...local(e)));
    const cancel = (e: PointerEvent) => tracker.cancel(e.pointerId);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      latest.current.onWheel(e.deltaY * scale, ...local(e));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
    };
  }, [ref]);
}
