// Engine input types, matching the committed data in public/data/. The engine reads no files.

export type PlaceType = string;

export interface Place {
  id: string;
  name: string;
  country: string;
  /** Region id, or null when the place is not in a region. */
  region: string | null;
  lat: number;
  lng: number;
  type: PlaceType;
  level: number;
  pop?: number;
}

export interface Country {
  id: string;
  name: string;
  places: number;
  hasRegions: boolean;
}

export interface Region {
  id: string;
  name: string;
  country: string;
  places: number;
}
