// fetch with a deadline, so a stalled connection fails the build instead of hanging it.

/** Fetches `url` and reads its body with `read`, all within `timeoutMs`; fails on a non-2xx. */
export async function fetchWithin<T>(
  url: string,
  timeoutMs: number,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`fetching ${url}: HTTP ${response.status}`);
    return await read(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`fetching ${url}: no complete response within ${timeoutMs / 1000} s`);
    }
    throw error;
  }
}
