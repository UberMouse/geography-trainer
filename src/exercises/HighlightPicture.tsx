import HighlightMap from '../maps/HighlightMap';
import { NEIGHBOURHOOD_VIEW_KM } from '../maps/view';
import type { ExerciseItem } from './types';

/**
 * The item in context, as L1 shows it: a country shaded on the globe; a region shaded, or a place
 * dotted, on its country's regions (on the globe when it is outside the country's flat map,
 * `onGlobe`). A point-only item's globe is zoomed to its neighbourhood, to tell it from the
 * options beside it.
 */
export default function HighlightPicture({ item }: { item: ExerciseItem }) {
  const { target } = item;
  const onGlobe = item.tier === 'country' || item.onGlobe;
  return (
    <HighlightMap
      mode={onGlobe ? 'globe' : 'fit'}
      features={onGlobe ? item.world : item.context}
      frame={onGlobe ? undefined : item.frame}
      highlightId={'feature' in target ? String(target.feature.id) : undefined}
      point={'point' in target ? target.point : undefined}
      spanKm={item.pointOnly ? NEIGHBOURHOOD_VIEW_KM : undefined}
    />
  );
}
