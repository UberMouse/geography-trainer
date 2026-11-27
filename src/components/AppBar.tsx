import { Anchor, Group } from '@mantine/core';
import { NavLink, useLocation } from 'react-router';
import classes from './AppBar.module.css';
import { APP_NAME } from './usePageTitle';

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
            onClick={(event: { preventDefault: () => void }) => {
              if (pathname === to) event.preventDefault();
            }}
          >
            {text}
          </Anchor>
        ))}
      </Group>
    </nav>
  );
}
