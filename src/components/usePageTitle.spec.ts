import { describe, expect, it } from 'vitest';
import { APP_NAME, pageTitle } from './usePageTitle';

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
