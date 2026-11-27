import { Anchor, Group } from '@mantine/core';
import { NavLink, useLocation } from 'react-router';
import classes from './AppBar.module.css';
import { APP_NAME } from './usePageTitle';

/** A pathname without its trailing slashes (`/` stays `/`). */
function withoutTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** The parts of a click event the bar looks at. */
type BarClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
};

const LINKS = [
  { text: APP_NAME, to: '/', end: true },
  { text: 'Progress', to: '/progress', end: false },
  { text: 'Settings', to: '/settings', end: true },
];

/**
 * The bar at the top of every page's column: the app's name (Home), Progress and Settings. The link
 * to the page shown is marked current (Progress's also on its drill-down pages) and does nothing.
 */
export default function AppBar() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className={classes.bar}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        {LINKS.map(({ text, to, end }) => (
          <Anchor
            key={to}
            component={NavLink}
            to={to}
            end={end}
            size="sm"
            fw={to === '/' ? 700 : undefined}
            onClick={(event: BarClick) => {
              const plain =
                event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
              if (plain && withoutTrailingSlash(pathname) === to) event.preventDefault();
            }}
          >
            {text}
          </Anchor>
        ))}
      </Group>
    </nav>
  );
}
