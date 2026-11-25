const cache = new Map<string, Promise<unknown>>();

/** URL under the app's base path for a file in `public/`. */
export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/**
 * Run `load` once per key and cache its promise. A rejected promise is dropped from the cache, so
 * the next call retries.
 */
export function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached as Promise<T>;
  const promise = load();
  cache.set(key, promise);
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

/** Fetch and parse JSON once per URL. Rejects with an Error naming the URL and the HTTP status. */
export function fetchJsonOnce<T>(url: string): Promise<T> {
  return once(url, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
    return (await res.json()) as T;
  });
}

/** Forget every cached response (for specs). */
export function clearDataCache(): void {
  cache.clear();
}
