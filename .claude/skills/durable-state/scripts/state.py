#!/usr/bin/env python3
"""Args-only writer for the common `.durable-state/state.json` transitions (durable-state SKILL.md).

    python3 -I <abs>/.claude/skills/durable-state/scripts/state.py [--file F] [--skill S] <command> …

    set <dotted.key> <value>              phase, openGate, a nested owner field (`gates.B`)
    task <id> <key>=<value> …             a task's status or any field; adds the task if absent
    inflight add <kind> <id> <what…>      kind: agent | workflow | gate | monitor; same id replaces
    inflight rm <id>                      a missing id is reported, not an error
    note <text…>                          appends to `notes`
    claim                                 sessionId := $CLAUDE_CODE_SESSION_ID (resume step 2)

A <value> is JSON when it parses as JSON (`null`, `3`, `{"kind":"gateA"}`), otherwise the literal
string; `--string` makes it a string whatever it looks like. `task --in layers` edits `layers[]`.

Why a script: a conductor updates state on every transition, and inline jq costs a hand-written
program per call, gets refused by the worktree guard whenever git or `$(…)` rides along, and the
write-a-temp-python workaround doubled the calls. Arguments only, no stdin, so the guard can read
every call.

The file is found by walking up from cwd to the first `.durable-state/state.json`, else created at
the first directory holding `.git` (the worktree root), which needs `--skill`; it then starts as
`{skill, sessionId}` from $CLAUDE_CODE_SESSION_ID. A file whose `sessionId` names another session
is refused unless the command is `claim`: SKILL.md §Resuming says that run is not yours. While
$CLAUDE_CODE_SESSION_ID is unset, creating the file and writing an owned one are refused too,
since the owner can be neither recorded nor checked. Every write is atomic (temp file in the same
directory, fsync, rename; an existing file keeps its mode, a new one follows the umask). Prints
one line per change.
Exit 0 = written (a no-op `rm` still rewrites the file unchanged), 2 = refused or bad arguments.
"""
import argparse
import json
import os
import sys
import tempfile

# Mirror SKILL.md's *Generic fields* table (`tasks` and `inFlight` rows), which is the source:
# change them with it.
TASK_STATUSES = {"pending", "in-progress", "done", "blocked-needs-human", "skipped"}
INFLIGHT_KINDS = {"agent", "workflow", "gate", "monitor"}


class Refused(Exception):
    pass


def session_id():
    return os.environ.get("CLAUDE_CODE_SESSION_ID", "")


def same_id(entry, wanted):
    """An id written by hand may be a number; the CLI's is always a string."""
    return isinstance(entry, dict) and "id" in entry and str(entry["id"]) == wanted


def reject_constant(name):
    raise ValueError(f"{name} is not JSON")


# durable_state_file in .claude/hooks/lib/hook-common.sh is the resume hook's lookup of the same
# file: a change to either location rule belongs in both.
def find_state(start):
    d = os.path.abspath(start)
    while True:
        cand = os.path.join(d, ".durable-state", "state.json")
        if os.path.isfile(cand):
            return cand, False
        if os.path.exists(os.path.join(d, ".git")):
            return cand, True
        parent = os.path.dirname(d)
        if parent == d:
            raise Refused("no .durable-state/state.json and no .git above cwd; pass --file")
        d = parent


def parse_value(raw, force_string):
    if force_string:
        return raw
    try:
        # NaN/Infinity would be written back as bare tokens that jq and the resume hook reject.
        return json.loads(raw, parse_constant=reject_constant)
    except ValueError:
        return raw


def load(path, create, skill):
    sid = session_id()
    if create:
        if not skill:
            raise Refused(f"{path} does not exist; pass --skill <owner> to create it")
        # An unowned file would let any later session write it without a claim.
        if not sid:
            raise Refused(f"{path} does not exist and CLAUDE_CODE_SESSION_ID is unset; a new file "
                          "must record its owning session")
        return {"skill": skill, "sessionId": sid}, [f"created {path} (skill={skill})"]
    with open(path) as f:
        try:
            state = json.load(f)
        except ValueError as e:
            raise Refused(f"{path} does not parse ({e}); Read and repair it by hand")
    if not isinstance(state, dict):
        raise Refused(f"{path} is not a JSON object")
    if skill and state.get("skill") != skill:
        raise Refused(f"{path} is owned by skill {state.get('skill')!r}, not {skill!r}: keep your "
                      "fields under a top-level key of your own (SKILL.md, One owner per file)")
    return state, []


def write_atomic(path, state):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".state.", suffix=".tmp")
    try:
        # mkstemp makes the file 0600: an existing file keeps its own mode through the rename, and
        # a new one gets what open() would have given it under the process umask.
        if os.path.exists(path):
            mode = os.stat(path).st_mode & 0o7777
        else:
            umask = os.umask(0)
            os.umask(umask)
            mode = 0o666 & ~umask
        os.chmod(tmp, mode)
        with os.fdopen(fd, "w") as f:
            json.dump(state, f, indent=2, ensure_ascii=False, allow_nan=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def cmd_set(state, a):
    keys = a.key.split(".")
    if not all(keys):
        raise Refused(f"bad key {a.key!r}")
    node = state
    for k in keys[:-1]:
        if not isinstance(node.get(k), dict):
            if k in node:
                raise Refused(f"{a.key}: {k} is a {type(node[k]).__name__}, not an object")
            node[k] = {}
        node = node[k]
    node[keys[-1]] = parse_value(a.value, a.string)
    return [f"set {a.key}"]


def cmd_task(state, a):
    lst = state.setdefault(a.list, [])
    if not isinstance(lst, list):
        raise Refused(f"{a.list} is not an array")
    pairs = []
    for kv in a.fields:
        k, sep, v = kv.partition("=")
        if not sep or not k:
            raise Refused(f"expected key=value, got {kv!r}")
        val = parse_value(v, a.string)
        if k == "status" and a.list == "tasks" and not (isinstance(val, str) and val in TASK_STATUSES):
            raise Refused(f"status {val!r} is not one of {', '.join(sorted(TASK_STATUSES))}")
        if k == "id":
            raise Refused("the id is the first argument, not a field")
        pairs.append((k, val))
    entry = next((t for t in lst if same_id(t, a.id)), None)
    out = []
    if entry is None:
        entry = {"id": a.id}
        lst.append(entry)
        out.append(f"added {a.list} {a.id}")
    for k, val in pairs:
        entry[k] = val
    if pairs:
        out.append(f"{a.list} {a.id}: " + ", ".join(k for k, _ in pairs))
    return out


def cmd_inflight(state, a):
    lst = state.get("inFlight")
    if not isinstance(lst, list):
        if "inFlight" in state and lst is not None:
            raise Refused("inFlight is not an array")
        # A missing inFlight means "not tracked"; `[]` would assert nothing is running, which the
        # autocompact acts on, so only an add starts the list.
        if a.op == "rm":
            return ["inFlight is not tracked; nothing removed"]
        lst = []
    kept = [e for e in lst if not same_id(e, a.id)]
    if a.op == "add":
        if a.kind not in INFLIGHT_KINDS:
            raise Refused(f"kind {a.kind!r} is not one of {', '.join(sorted(INFLIGHT_KINDS))}")
        verb = "replaced" if len(kept) < len(lst) else "added"
        state["inFlight"] = kept + [{"kind": a.kind, "id": a.id, "what": " ".join(a.what)}]
        return [f"inFlight {verb} {a.kind} {a.id}"]
    if len(kept) == len(lst):
        return [f"inFlight has no {a.id}; nothing removed"]
    state["inFlight"] = kept
    return [f"inFlight removed {a.id} ({len(kept)} left)"]


def cmd_note(state, a):
    notes = state.setdefault("notes", [])
    if not isinstance(notes, list):
        raise Refused("notes is not an array")
    notes.append(" ".join(a.text))
    return [f"notes appended ({len(notes)})"]


def cmd_claim(state, _a):
    sid = session_id()
    if not sid:
        raise Refused("CLAUDE_CODE_SESSION_ID is not set")
    state["sessionId"] = sid
    return [f"set sessionId {sid}"]


def main(argv):
    p = argparse.ArgumentParser(prog="state.py", description=__doc__.split("\n\n")[0])
    p.add_argument("--file", help="state.json path (default: found from cwd)")
    p.add_argument("--skill", help="owner skill; required to create the file, checked otherwise")
    p.add_argument("--string", action="store_true", help="take every value as a literal string")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("set")
    s.add_argument("key")
    s.add_argument("value")
    t = sub.add_parser("task")
    t.add_argument("--in", dest="list", default="tasks", help="array to edit (default tasks)")
    t.add_argument("id")
    t.add_argument("fields", nargs="*")
    i = sub.add_parser("inflight")
    isub = i.add_subparsers(dest="op", required=True)
    ia = isub.add_parser("add")
    ia.add_argument("kind")
    ia.add_argument("id")
    ia.add_argument("what", nargs="+")
    ir = isub.add_parser("rm")
    ir.add_argument("id")
    n = sub.add_parser("note")
    n.add_argument("text", nargs="+")
    sub.add_parser("claim")
    a = p.parse_args(argv)

    try:
        if a.file:
            path, create = os.path.abspath(a.file), not os.path.exists(a.file)
        else:
            path, create = find_state(os.getcwd())
        state, out = load(path, create, a.skill)
        sid = session_id()
        owner = state.get("sessionId")
        if a.cmd != "claim" and isinstance(owner, str) and owner and owner != sid:
            if not sid:
                raise Refused(f"{path} is owned by session {owner} and CLAUDE_CODE_SESSION_ID is unset, "
                              "so ownership cannot be checked")
            raise Refused(f"{path} names session {owner} in sessionId, not this one: it is not your run "
                          "to write (SKILL.md §Resuming step 2). If it is yours under a new id, run `claim` first")
        out += {"set": cmd_set, "task": cmd_task, "inflight": cmd_inflight,
                "note": cmd_note, "claim": cmd_claim}[a.cmd](state, a)
        write_atomic(path, state)
    except Refused as e:
        print(f"state.py: refused: {e}", file=sys.stderr)
        return 2
    for line in out:
        print(f"state.py: {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
