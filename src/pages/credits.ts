/** A runtime dependency as the Credits page lists it. */
export interface Credit {
  name: string;
  licence: string;
  url: string;
}

/**
 * Every runtime dependency in `package.json`, with the licence its package declares and a link to
 * its project. `credits.spec.ts` fails when a dependency is missing here.
 */
export const DEPENDENCY_CREDITS: readonly Credit[] = [
  { name: 'd3-geo', licence: 'ISC', url: 'https://d3js.org/d3-geo/' },
  { name: 'dexie', licence: 'Apache-2.0', url: 'https://dexie.org' },
  { name: 'react', licence: 'MIT', url: 'https://react.dev/' },
  { name: 'react-dom', licence: 'MIT', url: 'https://react.dev/' },
  { name: 'react-router', licence: 'MIT', url: 'https://reactrouter.com' },
  { name: 'topojson-client', licence: 'ISC', url: 'https://github.com/topojson/topojson-client' },
  { name: 'ts-fsrs', licence: 'MIT', url: 'https://github.com/open-spaced-repetition/ts-fsrs' },
];
