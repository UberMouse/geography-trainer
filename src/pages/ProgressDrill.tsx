import { Fragment, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  countryItemId,
  placeItemId,
  regionItemId,
  unlockedBy,
  type Curriculum,
} from '../engine/curriculum';
import { canTestOut } from '../engine/placement';
import { loadRegions, type RegionsData } from '../data/loaders';
import { answerPoint, mainPart } from '../maps/geo';
import DrillMap, { type DrillDot } from '../maps/DrillMap';
import type { ProgressLook } from '../maps/ProgressMap';
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
import { STATE_LABELS, itemLook } from './progressView';
import { testOutLabel, testOutPath } from './testOutView';
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
      <>
        <h1>Not found</h1>
        <p>There is nothing to show at this address.</p>
        <Link to={route.back}>
          {route.back === '/progress' ? 'Back to the world' : 'Back to the country'}
        </Link>
      </>
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

const placeLook = (state: ProgressLook['state']): ProgressLook => ({
  state,
  fill: `var(--progress-${state})`,
});

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
  const { features, dots, fit, offMap } = useMemo(() => {
    const countryPlaces = data.places.filter((p) => p.country === countryId);
    const placeDots = (places: typeof countryPlaces): DrillDot[] =>
      places.map((p) => ({ id: p.id, name: p.name, at: [p.lng, p.lat] }));
    if (routeKind === 'region') {
      return {
        features: (regions?.features ?? []).filter((f) => f.id === regionId),
        dots: placeDots(countryPlaces.filter((p) => p.region === regionId)),
        fit: undefined,
        offMap: [] as OffMapEntry[],
      };
    }
    // The country page frames the main part of the country, as the exercises do: outlying
    // regions and places (overseas, far islands) stay off the map and are named under it.
    const outline = data.countries.features.find((f) => f.id === countryId)!;
    const frame = mainPart(outline);
    if (regions) {
      const split = splitByFrame(frame, regions.features, answerPoint);
      const offMap = split.off.map((f) => ({ id: f.id, name: f.properties.name, isRegion: true }));
      return { features: split.onMap, dots: [], fit: [frame], offMap };
    }
    const split = splitByFrame(frame, placeDots(countryPlaces), (d) => d.at);
    const offMap = split.off.map((d) => ({ id: d.id, name: d.name, isRegion: false }));
    return { features: [outline], dots: split.onMap, fit: [frame], offMap };
  }, [data.places, data.countries, regions, routeKind, regionId, countryId]);

  // A region with no places is not a curriculum item: drawn neutral, not a link.
  const lookShape = (id: string): ProgressLook | null =>
    regions && curriculum.items.has(regionItemId(id))
      ? itemLook(curriculum, data.progress, regionItemId(id))
      : null;
  const lookDot = (id: string): ProgressLook | null =>
    curriculum.items.has(placeItemId(id))
      ? placeLook(itemLook(curriculum, data.progress, placeItemId(id)).state)
      : null;

  const rows = childRows(curriculum, data.progress, itemId, names);
  const self = itemLook(curriculum, data.progress, itemId);
  const name = names.get(itemId) ?? itemId;
  const isRegion = route.kind === 'region';
  const testOutTier = canTestOut(curriculum, data.progress, itemId)
    ? (`${unlockedBy(curriculum, itemId)!.tier}s` as const)
    : null;
  const regionBase = `/progress/${countryId}`;

  return (
    <>
      <p>
        {isRegion ? (
          <Link to={regionBase}>Back to {country.name}</Link>
        ) : (
          <Link to="/progress">Back to the world</Link>
        )}
      </p>
      <h1>
        {name} <span data-testid="drill-state">({STATE_LABELS[self.state]})</span>
      </h1>
      {testOutTier && (
        <p>
          <Link to={testOutPath(itemId)}>{testOutLabel(name, testOutTier)}</Link>
        </p>
      )}
      <DrillMap
        features={features}
        dots={dots}
        fit={fit}
        look={lookShape}
        dotLook={lookDot}
        onSelect={
          isRegion || !regions
            ? undefined
            : (id) => {
                if (curriculum.items.has(regionItemId(id))) navigate(`${regionBase}/${id}`);
              }
        }
        label={`${name} progress map`}
      />
      {offMap.length > 0 && (
        <p data-testid="off-map">
          Not on this map:{' '}
          {sortOffMap(offMap).map((e, i) => (
            <Fragment key={e.id}>
              {i > 0 && ', '}
              {e.isRegion && curriculum.items.has(regionItemId(e.id)) ? (
                <Link to={`${regionBase}/${e.id}`}>{e.name}</Link>
              ) : (
                e.name
              )}
            </Fragment>
          ))}
        </p>
      )}
      {rows.length === 0 ? (
        <p>{NO_CHILDREN_TEXT}</p>
      ) : (
        <ul className="drill-list" data-testid="drill-list">
          {rows.map((row) => (
            <li key={row.itemId} data-item-id={row.itemId} data-state={row.state}>
              {row.href ? <Link to={row.href}>{row.name}</Link> : row.name}: {row.stateLabel}
              {row.unlockText && ` (${row.unlockText})`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
