// mapshaper ships no types; this declares the one function the build script calls.
declare module 'mapshaper' {
  /** Runs mapshaper commands over in-memory inputs; resolves to the output files by name. */
  export function applyCommands(
    commands: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, string | Uint8Array>>;
  const mapshaper: { applyCommands: typeof applyCommands };
  export default mapshaper;
}
