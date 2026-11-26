import type { ReactNode } from 'react';
import classes from './GlobeLayout.module.css';

/**
 * The app's layout: the page's column beside the globe, covering the whole viewport. Wide screens
 * put the column in a 320px strip on the left; phone width puts the globe on top and the column
 * below it, or, with `hideGlobeOnPhone`, the column alone (the globe stays mounted, hidden by
 * CSS). Uses Mantine's CSS variables, so it renders inside a `MantineProvider`.
 */
export default function GlobeLayout({
  column,
  globe,
  hideGlobeOnPhone = false,
}: {
  column: ReactNode;
  globe: ReactNode;
  hideGlobeOnPhone?: boolean;
}) {
  return (
    <div className={hideGlobeOnPhone ? `${classes.root} ${classes.hideGlobe}` : classes.root}>
      <div className={classes.column} data-testid="column">
        {column}
      </div>
      <div className={classes.globe} data-testid="globe-slot">
        {globe}
      </div>
    </div>
  );
}
