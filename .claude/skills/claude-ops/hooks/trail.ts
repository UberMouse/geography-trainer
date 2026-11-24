/**
 * The decision trail: one JSONL file per session, `~/.claude/state/<mod>/trail/<session id>.jsonl`,
 * where a mod records what it decided and why. `$.ui.log(…, { to: 'debug' })` lines are lost
 * (sessions do not run with debug logging), and a `$.session.append` system row persists but is
 * drawn to the person as a notice and carries no plugin field, so it is no place for a decision
 * per check. Read a session's rows with `jq` beside its transcript, matching by time.
 *
 * Pure: no `$`, no atoms. Each hook file that records keeps its own top-level `trace($, …)` (the
 * validator checks `$` one file at a time), which turns `traceArgv` into one `$.process.run`.
 *
 * Shared by any mod in this repo that wants a trail: plugins share no module across their
 * folders, so a second mod copies this file whole.
 */

/** A file over this many bytes is moved to `<file>.1` (replacing an older one) before the next row. */
export const TRAIL_MAX_BYTES = 1_048_576
/** Files in the trail folder older than this many days are deleted when a session writes its first row. */
export const TRAIL_KEEP_DAYS = 14
/** How long the append may take; a row lost to a slow disk is not worth a held hook. */
export const TRAIL_TIMEOUT_MS = 5_000
/** A row's text is cut to this many characters. */
export const TRAIL_TEXT_MAX = 2_000

/**
 * `sh` with: $1 the trail file, $2 the row. Appending with `>>` is one O_APPEND write, so rows
 * from hooks running at once never overwrite each other as a read and a write would. The first
 * row of a session prunes the folder (old files and old lock folders alike).
 *
 * Rotation runs under a `mkdir` lock (portable, unlike flock) and re-reads the size inside it: a
 * hook that saw the file over the cap before another rotated it would otherwise move the fresh
 * file over `.1` and lose the rotated rows. A hook that finds the lock taken skips rotating and
 * just appends. A lock older than a minute is taken to be a killed hook's and removed.
 *
 * A template literal: its only `${…}` are the two constants, so the shell's own expansions are
 * written without braces.
 */
export const TRAIL_SCRIPT = `
f="$1"
d=$(dirname "$f")
if [ ! -e "$f" ]; then
  mkdir -p "$d" || exit 1
  find "$d" -mindepth 1 -maxdepth 1 -mtime +${TRAIL_KEEP_DAYS} -delete 2>/dev/null
fi
if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt ${TRAIL_MAX_BYTES} ]; then
  [ -z "$(find "$f.lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] || rmdir "$f.lock" 2>/dev/null
  if mkdir "$f.lock" 2>/dev/null; then
    if [ "$(wc -c < "$f")" -gt ${TRAIL_MAX_BYTES} ]; then
      mv -f "$f" "$f.1"
    fi
    rmdir "$f.lock"
  fi
fi
printf '%s\\n' "$2" >> "$f"
`

/**
 * `sh` with $1 a plugin folder: the short id of the last commit that changed it, `+dirty` when
 * its files differ from that commit, `unknown` outside a git checkout.
 */
export const REV_SCRIPT = `
cd "$1" 2>/dev/null || { printf unknown; exit 0; }
r=$(git log -1 --format=%h -- . 2>/dev/null)
[ -n "$r" ] || { printf unknown; exit 0; }
[ -z "$(git status --porcelain -- . 2>/dev/null)" ] || r="$r+dirty"
printf %s "$r"
`

/** The argv[0] of every trail and rev run: a test's process mock tells them from the mod's own runs by it. */
export const TRAIL_SHELL = '/bin/sh'
/** `$0` of a trail append, after the script. */
export const TRAIL_ARGV0 = 'mod-trail'

/** Extra facts a row carries beside its text: ids, counts, outcomes. Kept small: it is one line. */
export type TraceData = Readonly<Record<string, string | number | boolean | null | readonly string[]>>

export interface TraceRow {
  at: string;
  mod: string;
  feature: string;
  text: string;
  data?: TraceData;
}

/** `text` as one line of at most `max` characters: control characters collapse to a space. */
function oneLine(text: string, max: number): string {
  const line = text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** `<mod> <feature>: <text>`, the shape every mod text has, so one grep for the mod finds its rows. */
export function traceText(mod: string, feature: string, text: string): string {
  return oneLine(`${mod} ${feature}: ${text}`, TRAIL_TEXT_MAX)
}

/** The folder that holds a mod's trail files. */
export function trailDir(home: string, mod: string): string {
  return `${home}/.claude/state/${mod}/trail`
}

export function trailPath(home: string, mod: string, sessionId: string): string {
  return `${trailDir(home, mod)}/${sessionId}.jsonl`
}

/** One row as the line the file holds. */
export function traceLine(row: TraceRow): string {
  return JSON.stringify(row)
}

export interface TraceInput {
  mod: string;
  /** `$.env.get('HOME')`; no row is written without it. */
  home: string | undefined;
  sessionId: string;
  feature: string;
  text: string;
  now: number;
  data?: TraceData;
}

/** The `$.process.run` argv that appends one row; null when there is no HOME to put the file under. */
export function traceArgv(input: TraceInput): string[] | null {
  if (input.home === undefined || input.home === '' || input.sessionId === '') {
    return null
  }
  const row: TraceRow = {
    at: new Date(input.now).toISOString(),
    mod: input.mod,
    feature: input.feature,
    text: traceText(input.mod, input.feature, input.text),
    ...(input.data === undefined ? {} : { data: input.data }),
  }
  return [TRAIL_SHELL, '-c', TRAIL_SCRIPT, TRAIL_ARGV0, trailPath(input.home, input.mod, input.sessionId), traceLine(row)]
}

/** `sh` with $1 a file beside the trail and $2 its whole content: a tombstone, written once. */
export const TRAIL_WRITE_SCRIPT = `
mkdir -p "$(dirname "$1")" && printf '%s\\n' "$2" > "$1"
`

/** The `$.process.run` argv that writes `text` to `path` in the trail folder (TRAIL_WRITE_SCRIPT). */
export function trailWriteArgv(path: string, text: string): string[] {
  return [TRAIL_SHELL, '-c', TRAIL_WRITE_SCRIPT, 'mod-trail-write', path, text]
}

/** The `$.process.run` argv that prints the plugin folder's rev (REV_SCRIPT). */
export function revArgv(pluginRoot: string): string[] {
  return [TRAIL_SHELL, '-c', REV_SCRIPT, 'mod-rev', pluginRoot]
}

/** Whether `argv` is a trail append; what a test's process mock answers and collects. */
export function isTraceArgv(argv: readonly string[]): boolean {
  return argv[0] === TRAIL_SHELL && argv[3] === TRAIL_ARGV0
}

/** The row a trail append writes, parsed back; null for any other argv. */
export function tracedRow(argv: readonly string[]): TraceRow | null {
  const line = isTraceArgv(argv) ? argv[5] : undefined
  return line === undefined ? null : (JSON.parse(line) as TraceRow)
}

/** The plugin.json `version`, or `?` when the manifest does not parse or has none. */
export function manifestVersion(manifest: string): string {
  try {
    const version = (JSON.parse(manifest) as { version?: unknown }).version
    return typeof version === 'string' ? version : '?'
  } catch {
    return '?'
  }
}

/** The loaded row's text: the version and rev that answer "which code was this session running". */
export function loadedText(version: string, rev: string, pluginRoot: string): string {
  return `loaded: v${version} rev=${rev === '' ? 'unknown' : rev} from ${pluginRoot}`
}

/**
 * Whether two decision reasons say the same thing but for their numbers (`at 41%` and `at 42%`,
 * `3m ago` and `4m ago`): a check repeated every minute is recorded only when its gist changes.
 */
export function isSameGist(a: string | null, b: string): boolean {
  return a !== null && a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#')
}
