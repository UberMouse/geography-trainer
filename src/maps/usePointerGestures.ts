import { useEffect, useRef, type RefObject } from 'react';
import { GestureTracker, type GestureEvent } from './gestures';

export interface GestureHandlers {
  onGesture: (event: GestureEvent) => void;
  /**
   * Wheel zoom: `deltaY` in px (line and page deltas converted) about (`x`, `y`). Returns whether
   * it zoomed: false (already at the zoom limit that way) leaves the page to scroll.
   */
  onWheel: (deltaY: number, x: number, y: number) => boolean;
}

/**
 * Feed an element's pointer and wheel events (coordinates relative to the element, CSS px) into a
 * `GestureTracker`. The element needs `touch-action: none` so the browser leaves touch to us; the
 * wheel listener is non-passive so it can stop the page scrolling, which it does only when
 * `onWheel` returns true.
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
    // Window listeners for presses that could not be captured, removed on their release or on cleanup.
    const uncaptured = new Set<() => void>();
    const emit = (events: GestureEvent[]) => events.forEach((ev) => latest.current.onGesture(ev));

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // InvalidStateError: the pointer is no longer active. Track the press without capture, and
        // since its release may land outside the element, let go of it when the window sees that.
        const id = e.pointerId;
        const stop = () => {
          window.removeEventListener('pointerup', release);
          window.removeEventListener('pointercancel', release);
          uncaptured.delete(stop);
        };
        const release = (ev: PointerEvent) => {
          if (ev.pointerId !== id) return;
          stop();
          tracker.cancel(id);
        };
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        uncaptured.add(stop);
      }
      tracker.down(e.pointerId, ...local(e));
    };
    const move = (e: PointerEvent) => emit(tracker.move(e.pointerId, ...local(e)));
    const up = (e: PointerEvent) => emit(tracker.up(e.pointerId, ...local(e)));
    // Also on lost capture, so a pointerup we never see cannot leave a stale pointer that would
    // turn the next press into a pinch. After a normal pointerup the tracker has already let go.
    const cancel = (e: PointerEvent) => tracker.cancel(e.pointerId);
    const wheel = (e: WheelEvent) => {
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      if (latest.current.onWheel(e.deltaY * scale, ...local(e))) e.preventDefault();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      uncaptured.forEach((stop) => stop());
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('lostpointercapture', cancel);
      el.removeEventListener('wheel', wheel);
    };
  }, [ref]);
}
