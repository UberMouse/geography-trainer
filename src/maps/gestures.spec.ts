import { describe, expect, it } from 'vitest';
import { GestureTracker, TAP_SLOP_PX } from './gestures';

describe('GestureTracker', () => {
  it('reports a press and lift that barely moves as a tap at the lift point', () => {
    const g = new GestureTracker();
    g.down(1, 100, 100);
    expect(g.move(1, 102, 101)).toEqual([]);
    expect(g.up(1, 103, 102)).toEqual([{ type: 'tap', x: 103, y: 102 }]);
  });

  it('treats a down for a held id as a fresh gesture, so a tap still taps', () => {
    const g = new GestureTracker();
    g.down(1, 50, 50);
    g.move(1, 80, 80);
    g.down(1, 10, 10);
    expect(g.active).toBe(1);
    expect(g.up(1, 10, 10)).toEqual([{ type: 'tap', x: 10, y: 10 }]);
  });

  it('counts total travel, so a wiggle that returns to the start is not a tap', () => {
    const g = new GestureTracker();
    g.down(1, 0, 0);
    g.move(1, 4, 0);
    g.move(1, 0, 0);
    expect(g.up(1, 0, 0)).toEqual([]);
  });

  it('starts dragging past the slop, and the first drag carries all movement since the press', () => {
    const g = new GestureTracker();
    g.down(1, 10, 10);
    expect(g.move(1, 13, 10)).toEqual([]);
    expect(g.move(1, 10 + TAP_SLOP_PX + 1, 12)).toEqual([
      { type: 'drag', dx: TAP_SLOP_PX + 1, dy: 2 },
    ]);
    expect(g.move(1, 30, 20)).toEqual([{ type: 'drag', dx: 30 - 17, dy: 8 }]);
    expect(g.up(1, 30, 20)).toEqual([]);
  });

  it('pinches with two pointers: factor is the change in spacing, plus the midpoint and its move', () => {
    const g = new GestureTracker();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    expect(g.move(2, 300, 100)).toEqual([
      { type: 'pinch', factor: 2, cx: 200, cy: 100, dx: 50, dy: 0 },
    ]);
  });

  it('never taps after a pinch, and the remaining finger drags on without a jump', () => {
    const g = new GestureTracker();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    expect(g.up(2, 200, 100)).toEqual([]);
    expect(g.move(1, 101, 100)).toEqual([{ type: 'drag', dx: 1, dy: 0 }]);
    expect(g.up(1, 101, 100)).toEqual([]);
  });

  it('ignores moves from pointers that are not down (a hovering mouse) and a third finger', () => {
    const g = new GestureTracker();
    expect(g.move(9, 5, 5)).toEqual([]);
    g.down(1, 0, 0);
    g.down(2, 10, 0);
    g.down(3, 50, 50);
    expect(g.active).toBe(2);
    expect(g.move(3, 60, 60)).toEqual([]);
  });

  it('ignores a cancel for a pointer it does not track (lost capture after pointerup)', () => {
    const g = new GestureTracker();
    g.down(1, 0, 0);
    g.cancel(9);
    expect(g.up(1, 0, 0)).toEqual([{ type: 'tap', x: 0, y: 0 }]);
  });

  it('a cancelled pointer is never a tap, and the next press starts afresh', () => {
    const g = new GestureTracker();
    g.down(1, 0, 0);
    g.cancel(1);
    expect(g.up(1, 0, 0)).toEqual([]);
    g.down(2, 0, 0);
    expect(g.up(2, 1, 1)).toEqual([{ type: 'tap', x: 1, y: 1 }]);
  });

  it('after a pinch, a cancelled finger leaves the other dragging on with no jump', () => {
    const g = new GestureTracker();
    g.down(1, 0, 0);
    g.down(2, 100, 0);
    g.move(1, 50, 50);
    g.cancel(2);
    expect(g.move(1, 52, 50)).toEqual([{ type: 'drag', dx: 2, dy: 0 }]);
  });
});
