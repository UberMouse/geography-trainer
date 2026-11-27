import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * On a pathname change (not on the first load, not on a search or hash change), scrolls the column
 * to its top and moves focus to the page's first `h1`, or to the column when the page has none yet.
 * Returns the ref for the column element.
 */
export function useNewPageFocus() {
  const column = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const shown = useRef(pathname);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    const el = column.current;
    if (!el) return;
    el.scrollTop = 0;
    const heading = el.querySelector<HTMLElement>('main h1');
    if (heading) heading.tabIndex = -1;
    (heading ?? el).focus({ preventScroll: true });
  }, [pathname]);
  return column;
}
