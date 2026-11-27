import { useEffect } from 'react';

export const APP_NAME = 'Geography Trainer';

/** The tab title for a page: `<page> · <app name>`, or the app name alone when there is no page. */
export function pageTitle(page?: string): string {
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

/** The titles of the pages shown, the most recently set last. */
const titles: { title: string }[] = [];

/**
 * Sets the tab's title (see `pageTitle`) and returns a function that takes it back: the tab then
 * shows the most recently set title still in place, or the app name when none is left, whichever
 * order the pages go in.
 */
export function setPageTitle(page?: string): () => void {
  const entry = { title: pageTitle(page) };
  titles.push(entry);
  document.title = entry.title;
  return () => {
    const at = titles.indexOf(entry);
    if (at >= 0) titles.splice(at, 1);
    document.title = titles.at(-1)?.title ?? APP_NAME;
  };
}

/**
 * Sets the browser tab's title while the page is shown (see `pageTitle`). When it goes, the most
 * recently set title still in place shows, or the app name once none is left.
 */
export function usePageTitle(page?: string): void {
  useEffect(() => setPageTitle(page), [page]);
}
