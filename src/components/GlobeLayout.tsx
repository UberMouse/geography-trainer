import type { ReactNode, Ref } from 'react';
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
  columnRef,
}: {
  column: ReactNode;
  globe: ReactNode;
  hideGlobeOnPhone?: boolean;
  /** The column element, the page's scroll container and the focus target of a new page. */
  columnRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className={hideGlobeOnPhone ? `${classes.root} ${classes.hideGlobe}` : classes.root}>
      <div className={classes.column} data-testid="column" ref={columnRef} tabIndex={-1}>
        {column}
      </div>
      <div className={classes.globe} data-testid="globe-slot">
        {globe}
      </div>
    </div>
  );
}
