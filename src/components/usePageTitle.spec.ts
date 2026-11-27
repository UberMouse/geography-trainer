import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME, pageTitle, setPageTitle } from './usePageTitle';

describe('[GLB-C18] tab titles', () => {
  it('names the app Geography Trainer', () => {
    expect(APP_NAME).toBe('Geography Trainer');
  });

  it('is the app name alone for Home, and <page> · <app name> for the rest', () => {
    expect(pageTitle()).toBe('Geography Trainer');
    expect(pageTitle('Progress')).toBe('Progress · Geography Trainer');
    expect(pageTitle('Test out of Texas')).toBe('Test out of Texas · Geography Trainer');
  });
});

describe('[GLB-C18] a page inside a page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives the parent page its title back when the inner page goes', () => {
    vi.stubGlobal('document', { title: APP_NAME });
    const parent = setPageTitle('Progress');
    const child = setPageTitle('Texas');
    expect(document.title).toBe('Texas · Geography Trainer');
    child();
    expect(document.title).toBe('Progress · Geography Trainer');
    parent();
    expect(document.title).toBe(APP_NAME);
  });
});
