import { Anchor, List, Stack, Text, Title } from '@mantine/core';
import { Fragment, useEffect, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  countryItemId,
  itemState,
  masteredCountryCount,
  placeItemId,
  regionItemId,
  unlockedBy,
  type Curriculum,
} from '../engine/curriculum';
import { loadRegions, type RegionsData } from '../data/loaders';
import { answerPoint, mainPart, type LngLat } from '../maps/geo';
import { moveCamera, useGlobe } from '../maps/globeContext';
import {
  NO_CHILDREN_TEXT,
  childRows,
  resolveDrillRoute,
  sortOffMap,
  splitByFrame,
  type DrillRoute,
  type OffMapEntry,
} from './drillView';
import Status from './LoadStatus';
import { drillCamera, drillMode } from './progressGlobe';
import { PROGRESS_COLOURS, STATE_LABELS, itemLook } from './progressView';
import { showsTestOutLink, testOutLabel, testOutPath } from './testOutView';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

const LOAD_FAILURE = 'Could not load the map data or your saved progress:';

/** `/progress/:country` and `/progress/:country/:region` (a full `<country>.<region>` id). */
export default function ProgressDrill() {
  const { country = '', region } = useParams();
  const [data, reload] = useLoaded('progress-drill', loadWorldData);
  return (
    <Status state={data} retry={reload} failure={LOAD_FAILURE}>
      {(loaded) => <Resolved data={loaded} countryId={country} regionId={region} />}
    </Status>
  );
}

function Resolved({
  data,
  countryId,
  regionId,
}: {
  data: WorldData;
  countryId: string;
  regionId: string | undefined;
}) {
  const { curriculum } = data;
  const route = useMemo(
    () => resolveDrillRoute(curriculum, data.countries.countries, countryId, regionId),
    [curriculum, data.countries.countries, countryId, regionId],
  );
  if (route.kind === 'not-found') {
    return (
      <Stack align="flex-start">
        <Title order={1}>Not found</Title>
        <Text>There is nothing to show at this address.</Text>
        <Anchor component={Link} to={route.back}>
          {route.back === '/progress' ? 'Back to the world' : 'Back to the country'}
        </Anchor>
      </Stack>
    );
  }
  // Only a regions-tier country has a topology to fetch, and only a resolved route gets here.
  const needsRegions = route.kind === 'region' || route.hasRegions;
  return needsRegions ? (
    <WithRegions countryId={route.countryId}>
      {(regions) => <Drill data={data} curriculum={curriculum} route={route} regions={regions} />}
    </WithRegions>
  ) : (
    <Drill data={data} curriculum={curriculum} route={route} regions={null} />
  );
}

function WithRegions({
  countryId,
  children,
}: {
  countryId: string;
  children: (regions: RegionsData) => ReactNode;
}) {
  const [regions, reload] = useLoaded(`regions:${countryId}`, () => loadRegions(countryId));
  return (
    <Status state={regions} retry={reload} failure={LOAD_FAILURE}>
      {children}
    </Status>
  );
}

/** A place on the drill-down globe. */
interface PlaceDot {
  id: string;
  name: string;
  at: LngLat;
}

function Drill({
  data,
  curriculum,
  route,
  regions,
}: {
  data: WorldData;
  curriculum: Curriculum;
  route: Exclude<DrillRoute, { kind: 'not-found' }>;
  regions: RegionsData | null;
}) {
  const navigate = useNavigate();
  const { countryId } = route;
  const country = data.countries.countries.find((c) => c.id === countryId)!;
  const itemId = route.kind === 'region' ? regionItemId(route.regionId) : countryItemId(countryId);

  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of data.countries.countries) out.set(countryItemId(c.id), c.name);
    for (const r of regions?.regions ?? []) out.set(regionItemId(r.id), r.name);
    for (const p of data.places) out.set(placeItemId(p.id), p.name);
    return out;
  }, [data.countries, data.places, regions]);

  const routeKind = route.kind;
  const regionId = route.kind === 'region' ? route.regionId : null;
  const outline = data.countries.features.find((f) => f.id === countryId)!;
  const { features, dots, offMap } = useMemo(() => {
    const countryPlaces = data.places.filter((p) => p.country === countryId);
    const placeDots = (places: typeof countryPlaces): PlaceDot[] =>
      places.map((p) => ({ id: p.id, name: p.name, at: [p.lng, p.lat] }));
    if (routeKind === 'region') {
      return {
        features: (regions?.features ?? []).filter((f) => f.id === regionId),
        dots: placeDots(countryPlaces.filter((p) => p.region === regionId)),
        offMap: [] as OffMapEntry[],
      };
    }
    // The country page is about the main part of the country, as the exercises are: outlying
    // regions and places (overseas, far islands) are not drawn, and are named in the column.
    const frame = mainPart(outline);
    if (regions) {
      const split = splitByFrame(frame, regions.features, answerPoint);
      const offMap = split.off.map((f) => ({ id: f.id, name: f.properties.name, isRegion: true }));
      return { features: split.onMap, dots: [], offMap };
    }
    const split = splitByFrame(frame, placeDots(countryPlaces), (d) => d.at);
    const offMap = split.off.map((d) => ({ id: d.id, name: d.name, isRegion: false }));
    return { features: [outline], dots: split.onMap, offMap };
  }, [data.places, outline, regions, routeKind, regionId, countryId]);

  // A region with no places is not a curriculum item: drawn unfilled, not a link. A place's dot
  // is its state's own colour (a mastered place `mastered`, not `complete`).
  const progress = data.progress;
  const mode = useMemo(() => {
    const masteredCountries = masteredCountryCount(curriculum, progress);
    return drillMode(
      features,
      (id) =>
        regions && curriculum.items.has(regionItemId(id))
          ? itemLook(curriculum, progress, regionItemId(id), masteredCountries).fill
          : null,
      dots,
      (id) =>
        curriculum.items.has(placeItemId(id))
          ? PROGRESS_COLOURS[itemState(curriculum, progress, placeItemId(id), masteredCountries)]
          : null,
    );
  }, [features, dots, regions, curriculum, progress]);
  const regionBase = `/progress/${countryId}`;
  const selects = route.kind === 'country' && regions !== null;
  const camera = useGlobe({
    mode,
    onSelect: selects
      ? (id) => {
          if (curriculum.items.has(regionItemId(id))) navigate(`${regionBase}/${id}`);
        }
      : undefined,
  });
  const shownRegion = route.kind === 'region' ? features[0] : undefined;
  useEffect(() => {
    moveCamera(camera, drillCamera(outline, shownRegion));
  }, [camera, outline, shownRegion]);

  const rows = childRows(curriculum, data.progress, itemId, names);
  const self = itemLook(curriculum, data.progress, itemId);
  const name = names.get(itemId) ?? itemId;
  const isRegion = route.kind === 'region';
  const testOutTier = showsTestOutLink(curriculum, data.progress, data.finishedTests, itemId)
    ? (`${unlockedBy(curriculum, itemId)!.tier}s` as const)
    : null;

  return (
    <Stack align="flex-start">
      {isRegion ? (
        <Anchor component={Link} to={regionBase}>
          Back to {country.name}
        </Anchor>
      ) : (
        <Anchor component={Link} to="/progress">
          Back to the world
        </Anchor>
      )}
      <Title order={1}>
        {name} <span data-testid="drill-state">({STATE_LABELS[self.state]})</span>
      </Title>
      {testOutTier && (
        <Anchor component={Link} to={testOutPath(itemId)}>
          {testOutLabel(name, testOutTier)}
        </Anchor>
      )}
      {offMap.length > 0 && (
        <Text data-testid="off-map">
          Not on this map:{' '}
          {sortOffMap(offMap).map((e, i) => (
            <Fragment key={e.id}>
              {i > 0 && ', '}
              {e.isRegion && curriculum.items.has(regionItemId(e.id)) ? (
                <Anchor component={Link} to={`${regionBase}/${e.id}`}>
                  {e.name}
                </Anchor>
              ) : (
                e.name
              )}
            </Fragment>
          ))}
        </Text>
      )}
      {rows.length === 0 ? (
        <Text>{NO_CHILDREN_TEXT}</Text>
      ) : (
        <List listStyleType="none" spacing={2} data-testid="drill-list">
          {rows.map((row) => (
            <List.Item key={row.itemId} data-item-id={row.itemId} data-state={row.state}>
              {row.href ? (
                <Anchor component={Link} to={row.href}>
                  {row.name}
                </Anchor>
              ) : (
                row.name
              )}
              : {row.stateLabel}
              {row.unlockText && ` (${row.unlockText})`}
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}
