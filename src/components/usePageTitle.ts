import { useEffect } from 'react';

export const APP_NAME = 'Geography Trainer';

/** The tab title for a page: `<page> · <app name>`, or the app name alone when there is no page. */
export function pageTitle(page?: string): string {
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

/**
 * Sets the tab's title (see `pageTitle`) and returns a function that puts back the title that was
 * there before, so a page inside another page's title gives it back when it goes.
 */
export function setPageTitle(page?: string): () => void {
  const before = document.title;
  document.title = pageTitle(page);
  return () => {
    document.title = before;
  };
}

/**
 * Sets the browser tab's title while the page is shown (see `pageTitle`). When it goes, the title
 * before it comes back: the parent page's, or one the next page's own call replaces.
 */
export function usePageTitle(page?: string): void {
  useEffect(() => setPageTitle(page), [page]);
}
