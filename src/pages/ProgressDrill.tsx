import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { countryItemId, placeItemId, regionItemId, type Curriculum } from '../engine/curriculum';
import { loadRegions, type RegionsData } from '../data/loaders';
import DrillMap, { type DrillDot, type DrillFeature } from '../maps/DrillMap';
import type { ProgressLook } from '../maps/ProgressMap';
import { NO_CHILDREN_TEXT, childRows, resolveDrillRoute, type DrillRoute } from './drillView';
import Status from './LoadStatus';
import { STATE_LABELS, itemLook } from './progressView';
import { useLoaded } from './useLoaded';
import { loadWorldData, useCurriculum, type WorldData } from './worldData';

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
  const curriculum = useCurriculum(data);
  const route = resolveDrillRoute(curriculum, data.countries.countries, countryId, regionId);
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

  const { features, dots } = useMemo(() => {
    const countryPlaces = data.places.filter((p) => p.country === countryId);
    const placeDots = (places: typeof countryPlaces): DrillDot[] =>
      places.map((p) => ({ id: p.id, name: p.name, at: [p.lng, p.lat] }));
    if (route.kind === 'region') {
      return {
        features: (regions?.features ?? []).filter((f) => f.id === route.regionId),
        dots: placeDots(countryPlaces.filter((p) => p.region === route.regionId)),
      };
    }
    if (regions) return { features: regions.features, dots: [] };
    return {
      features: data.countries.features.filter((f) => f.id === countryId) as DrillFeature[],
      dots: placeDots(countryPlaces),
    };
  }, [data.places, data.countries, regions, route, countryId]);

  const look = (id: string): ProgressLook | null => {
    const place = curriculum.items.get(placeItemId(id));
    if (place) return placeLook(itemLook(curriculum, data.progress, place.id).state);
    // The country outline of a regionless country stays neutral: its places carry the colour.
    if (!regions) return null;
    const region = regionItemId(id);
    // A region with no places is not a curriculum item: drawn neutral, not a link.
    return curriculum.items.has(region) ? itemLook(curriculum, data.progress, region) : null;
  };

  const rows = childRows(curriculum, data.progress, itemId, names);
  const self = itemLook(curriculum, data.progress, itemId);
  const name = names.get(itemId) ?? itemId;
  const isRegion = route.kind === 'region';
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
      <DrillMap
        features={features}
        dots={dots}
        look={look}
        onSelect={
          isRegion || !regions
            ? undefined
            : (id) => {
                if (curriculum.items.has(regionItemId(id))) navigate(`${regionBase}/${id}`);
              }
        }
        label={`${name} progress map`}
      />
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
