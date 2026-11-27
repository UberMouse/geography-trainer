import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * On a pathname change (not on the first load, not on a search or hash change), scrolls the column
 * to its top and moves focus to the page's first `h1`, or to the column when the page has none yet.
 * A redirect (a replace) made before the learner has followed any link is part of the first load.
 * Returns the ref for the column element.
 */
export function useNewPageFocus() {
  const column = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const type = useNavigationType();
  const { pathname } = location;
  const firstKey = useRef(location.key);
  const followed = useRef(false);
  const shown = useRef(pathname);
  useEffect(() => {
    if (location.key === firstKey.current) return;
    if (type !== 'REPLACE') followed.current = true;
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (!followed.current) return;
    const el = column.current;
    if (!el) return;
    el.scrollTop = 0;
    const heading = el.querySelector<HTMLElement>('main h1');
    if (heading) heading.tabIndex = -1;
    (heading ?? el).focus({ preventScroll: true });
  }, [location.key, pathname, type]);
  return column;
}
