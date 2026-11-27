import { placementPool, type PlacementItem } from '../engine/placement';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseItem } from '../exercises/types';
import { COUNTRIES_SCOPE } from '../storage/placementKeys';
import { usePageTitle } from '../components/usePageTitle';
import Status from './LoadStatus';
import PlacementRun from './PlacementRun';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

interface PlacementData extends WorldData {
  pool: PlacementItem[];
  /** The exercise item of every pool item, by item id. */
  items: ReadonlyMap<string, ExerciseItem>;
}

const loadPlacementData = async (): Promise<PlacementData> => {
  const world = await loadWorldData();
  const pool = placementPool(world.curriculum, world.progress, 'countries');
  // Built here so an item the data cannot build fails the load, with Retry, not the render.
  const items = new Map(
    pool.map(({ itemId }) => [
      itemId,
      buildExerciseItem(itemId, { countries: world.countries, places: world.places }),
    ]),
  );
  return { ...world, pool, items };
};

/** The placement test over the countries not yet started. */
export default function Placement() {
  usePageTitle('Placement test');
  const [data, retry] = useLoaded('placement', loadPlacementData);
  return (
    <Status state={data} retry={retry} failure="Could not load the map data or your saved progress:">
      {(loaded) => (
        <PlacementRun
          pool={loaded.pool}
          items={loaded.items}
          progress={loaded.progress}
          tier="countries"
          scope={COUNTRIES_SCOPE}
          heading="Placement test"
          back={{ to: '/', name: 'Home' }}
        />
      )}
    </Status>
  );
}
