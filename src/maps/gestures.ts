/**
 * A pointer gesture that never strays this far (CSS px) from where it was pressed is a tap, not a
 * drag. The farthest it got counts, not the path length, so finger jitter over a slow press is
 * still a tap.
 */
export const TAP_SLOP_PX = 6;

export type GestureEvent =
  | { type: 'tap'; x: number; y: number }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'pinch'; factor: number; cx: number; cy: number; dx: number; dy: number };

type Point = { x: number; y: number };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Turns pointer down/move/up into taps, drags and pinches. Coordinates are CSS px relative to the
 * surface. One pointer that never gets `TAP_SLOP_PX` or more from its press point is a tap; once it
 * does (even if it comes back), it is a drag, and its movement is reported as drags (the first
 * drag carries everything since the press).
 * Two pointers pinch: each move reports the change in their spacing (`factor`), their midpoint and
 * the midpoint's movement. A gesture that ever had two pointers is never a tap. Pointers past the
 * second are ignored.
 */
export class GestureTracker {
  private pointers = new Map<number, Point>();
  /** Where the single pointer was pressed, and the farthest it has been from there. */
  private origin: Point = { x: 0, y: 0 };
  private farthest = 0;
  private multi = false;
  /** Where the single-pointer drag last reported from. */
  private anchor: Point | null = null;

  get active(): number {
    return this.pointers.size;
  }

  down(id: number, x: number, y: number): void {
    // A down for an id we still hold means its up was never seen: the old press is stale.
    this.pointers.delete(id);
    if (this.pointers.size >= 2) return;
    if (this.pointers.size === 0) {
      this.farthest = 0;
      this.multi = false;
      this.origin = { x, y };
      this.anchor = { x, y };
    } else {
      this.multi = true;
    }
    this.pointers.set(id, { x, y });
  }

  move(id: number, x: number, y: number): GestureEvent[] {
    const prev = this.pointers.get(id);
    if (!prev) return [];
    const next = { x, y };
    if (this.pointers.size === 1) {
      this.farthest = Math.max(this.farthest, dist(this.origin, next));
      this.pointers.set(id, next);
      if (!this.multi && this.farthest < TAP_SLOP_PX) return [];
      const from = this.anchor ?? prev;
      this.anchor = next;
      return [{ type: 'drag', dx: x - from.x, dy: y - from.y }];
    }
    const [otherId] = [...this.pointers.keys()].filter((k) => k !== id);
    const other = this.pointers.get(otherId!)!;
    this.pointers.set(id, next);
    const before = dist(prev, other);
    const after = dist(next, other);
    const m0 = mid(prev, other);
    const m1 = mid(next, other);
    return [
      {
        type: 'pinch',
        factor: before > 0 ? after / before : 1,
        cx: m1.x,
        cy: m1.y,
        dx: m1.x - m0.x,
        dy: m1.y - m0.y,
      },
    ];
  }

  /** A pointer lifted: a tap when it ends a short single-pointer gesture. */
  up(id: number, x: number, y: number): GestureEvent[] {
    if (!this.pointers.has(id)) return [];
    const single = this.pointers.size === 1;
    this.pointers.delete(id);
    if (single) {
      this.anchor = null;
      const farthest = Math.max(this.farthest, dist(this.origin, { x, y }));
      return !this.multi && farthest < TAP_SLOP_PX ? [{ type: 'tap', x, y }] : [];
    }
    this.reanchor();
    return [];
  }

  /** A pointer the browser took away (pointercancel, lost capture): never a tap. */
  cancel(id: number): void {
    if (!this.pointers.delete(id)) return;
    this.multi = true;
    this.reanchor();
  }

  /** One finger of a pinch is gone: the other drags on from where it is, with no jump. */
  private reanchor(): void {
    const [rest] = [...this.pointers.values()];
    this.anchor = rest ?? null;
  }
}
