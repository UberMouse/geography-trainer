import { Anchor, Stack, Text, Title } from '@mantine/core';
import { Link, useParams } from 'react-router';
import { regionItemId } from '../engine/curriculum';
import { placementPool, type PlacementItem } from '../engine/placement';
import { loadRegions } from '../data/loaders';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseItem } from '../exercises/types';
import { usePageTitle } from '../components/usePageTitle';
import Status from './LoadStatus';
import PlacementRun from './PlacementRun';
import { resolveTestOutRoute, testOutLabel, type TestOutRoute } from './testOutView';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

const LOAD_FAILURE = 'Could not load the map data or your saved progress:';

/** `/placement/:country` and `/placement/:country/:region` (a full `<country>.<region>` id). */
export default function TestOut() {
  usePageTitle('Test out');
  const { country = '', region } = useParams();
  const [data, reload] = useLoaded(`test-out-world/${country}/${region ?? ''}`, loadWorldData);
  return (
    <Status state={data} retry={reload} failure={LOAD_FAILURE}>
      {(world) => <Resolved world={world} countryId={country} regionId={region} />}
    </Status>
  );
}

function Resolved({
  world,
  countryId,
  regionId,
}: {
  world: WorldData;
  countryId: string;
  regionId: string | undefined;
}) {
  const route = resolveTestOutRoute(
    world.curriculum,
    world.countries.countries,
    world.progress,
    countryId,
    regionId,
  );
  if (route.kind === 'unavailable') {
    return (
      <Stack>
        <Title order={1} size="h3">
          Test out
        </Title>
        <Text>This test is not available.</Text>
        <Anchor component={Link} to={route.back}>
          {route.back === '/progress' ? 'Back to the world' : 'Back to the country'}
        </Anchor>
      </Stack>
    );
  }
  return <Loaded key={route.itemId} world={world} route={route} />;
}

interface TestOutData {
  name: string;
  pool: PlacementItem[];
  items: ReadonlyMap<string, ExerciseItem>;
}

function Loaded({ world, route }: { world: WorldData; route: Extract<TestOutRoute, { kind: 'run' }> }) {
  const { itemId, countryId } = route;
  const [data, reload] = useLoaded(`test-out:${itemId}`, async (): Promise<TestOutData> => {
    const { countries, places, progress, curriculum } = world;
    // The regions of a regions-tier country are needed for its regions and for their places.
    const regions = route.needsRegions ? await loadRegions(countryId) : undefined;
    const pool = placementPool(curriculum, progress, itemId);
    // Built here so an item the data cannot build fails the load, with Retry, not the render.
    const items = new Map(
      pool.map((p) => [p.itemId, buildExerciseItem(p.itemId, { countries, places, regions })]),
    );
    const name = itemId.startsWith('region:')
      ? (regions?.regions.find((r) => regionItemId(r.id) === itemId)?.name ?? itemId)
      : (countries.countries.find((c) => c.id === countryId)?.name ?? countryId);
    return { name, pool, items };
  });
  return (
    <Status state={data} retry={reload} failure={LOAD_FAILURE}>
      {(loaded) => (
        <PlacementRun
          pool={loaded.pool}
          items={loaded.items}
          progress={world.progress}
          tier={route.tier}
          scope={itemId}
          heading={testOutLabel(loaded.name, route.tier)}
          scopeName={loaded.name}
          back={{ to: route.back, name: loaded.name }}
        />
      )}
    </Status>
  );
}
