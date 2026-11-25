import type { ReactNode } from 'react';
import classes from './GlobeLayout.module.css';

/**
 * The question panel beside the globe, covering the whole viewport. Wide screens put the panel
 * in a 320px column on the left; phone width puts the globe on top and the panel below it.
 * Uses Mantine's CSS variables, so it renders inside a `MantineProvider`.
 */
export default function GlobeLayout({ panel, globe }: { panel: ReactNode; globe: ReactNode }) {
  return (
    <div className={classes.root}>
      <section className={classes.panel}>{panel}</section>
      <div className={classes.globe}>{globe}</div>
    </div>
  );
}
