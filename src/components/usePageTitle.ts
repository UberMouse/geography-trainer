import { useEffect } from 'react';

export const APP_NAME = 'Geography Trainer';

/** The tab title for a page: `<page> · <app name>`, or the app name alone when there is no page. */
export function pageTitle(page?: string): string {
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

/**
 * Sets the browser tab's title while the page is shown (see `pageTitle`), and puts the app name
 * back when it goes, so a page that sets none shows the app's name.
 */
export function usePageTitle(page?: string): void {
  useEffect(() => {
    document.title = pageTitle(page);
    return () => {
      document.title = APP_NAME;
    };
  }, [page]);
}
