#!/usr/bin/env python3
"""Run state.py against throwaway worktrees and assert the state.json it leaves behind.

    python3 -I .claude/skills/durable-state/scripts/state_selftest.py

Each case runs the script as a conductor would (a subprocess, args only, cwd in the worktree) and
checks the file, the exit code and the printed line. The rows pin what SKILL.md's write discipline
relies on: the first write creates `{skill, sessionId}`, a refused call leaves the file untouched,
an `rm` never turns an untracked `inFlight` into `[]` (autocompact reads that as "nothing is
running"), another session's run is refused until `claim`, and writes replace the file by rename.
Exit 0 = every case passed.
"""
import json
import os
import subprocess
import sys
import tempfile

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.py")
FAILS = []
PASSES = 0


def run(cwd, *args, sid="sess-me", umask=0o022):
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CODE_SESSION_ID"}
    if sid is not None:
        env["CLAUDE_CODE_SESSION_ID"] = sid
    p = subprocess.run([sys.executable, "-I", SCRIPT, *args], cwd=cwd, env=env,
                       capture_output=True, text=True, preexec_fn=lambda: os.umask(umask))
    return p.returncode, p.stdout + p.stderr


def worktree(root, name, state=None):
    d = os.path.join(root, name)
    os.makedirs(d)
    open(os.path.join(d, ".git"), "w").write("gitdir: /elsewhere\n")
    if state is not None:
        os.makedirs(os.path.join(d, ".durable-state"))
        with open(os.path.join(d, ".durable-state", "state.json"), "w") as f:
            f.write(state if isinstance(state, str) else json.dumps(state))
    return d


def read(d):
    with open(os.path.join(d, ".durable-state", "state.json")) as f:
        return json.load(f)


def raw(d):
    with open(os.path.join(d, ".durable-state", "state.json")) as f:
        return f.read()


def check(desc, cond, detail=""):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILS.append(f"FAIL  {desc}{'  ' + detail if detail else ''}")


def main():
    with tempfile.TemporaryDirectory() as root:
        return cases(root)


def cases(root):

    d = worktree(root, "fresh")
    rc, out = run(d, "set", "phase", "plan")
    check("a first write without --skill is refused", rc == 2 and "--skill" in out, out)
    check("a refused first write creates nothing", not os.path.exists(os.path.join(d, ".durable-state")))
    rc, out = run(d, "--skill", "sdd-loop", "set", "phase", "plan", sid=None)
    check("a first write without CLAUDE_CODE_SESSION_ID is refused, so no file is unowned",
          rc == 2 and not os.path.exists(os.path.join(d, ".durable-state", "state.json")), out)
    pu = worktree(root, "private")
    rc, out = run(pu, "--skill", "sdd-loop", "set", "phase", "plan", umask=0o077)
    mode = os.stat(os.path.join(pu, ".durable-state", "state.json")).st_mode & 0o777
    check("a new file honours the umask", rc == 0 and mode == 0o600, f"{oct(mode)} {out}")
    pw = worktree(root, "shared")
    run(pw, "--skill", "sdd-loop", "set", "phase", "plan", umask=0o022)
    mode = os.stat(os.path.join(pw, ".durable-state", "state.json")).st_mode & 0o777
    check("a new file under umask 022 is 0644", mode == 0o644, oct(mode))
    rc, out = run(d, "--skill", "sdd-loop", "set", "phase", "plan")
    check("a first write with --skill creates {skill, sessionId} plus the field",
          rc == 0 and read(d) == {"skill": "sdd-loop", "sessionId": "sess-me", "phase": "plan"}, out)
    check("the first write says it created the file and what it set", "created" in out and "set phase" in out, out)

    rc, out = run(d, "set", "openGate", '{"kind":"gateA","doc":"/abs/a.md"}')
    check("a JSON value is stored as JSON", read(d)["openGate"] == {"kind": "gateA", "doc": "/abs/a.md"}, out)
    run(d, "set", "openGate", "null")
    check("null clears a field", read(d)["openGate"] is None)
    run(d, "set", "gates.B", "approved")
    check("a dotted key creates the nested object, a non-JSON value is a string",
          read(d)["gates"] == {"B": "approved"})
    run(d, "--string", "set", "prNumber", "123")
    check("--string keeps a number-like value a string", read(d)["prNumber"] == "123")
    rc, out = run(d, "set", "phase.sub", "x")
    check("a dotted key through a non-object is refused", rc == 2 and read(d)["phase"] == "plan", out)

    rc, out = run(d, "task", "T01", "status=pending", "title=first task")
    check("task adds a missing task with its fields",
          rc == 0 and read(d)["tasks"] == [{"id": "T01", "status": "pending", "title": "first task"}], out)
    rc, out = run(d, "task", "T01", "status=done", "commit=abc123")
    check("task updates the existing entry in place",
          read(d)["tasks"] == [{"id": "T01", "status": "done", "title": "first task", "commit": "abc123"}], out)
    before = raw(d)
    rc, out = run(d, "task", "T01", "status=finished")
    check("an unknown task status is refused and the file is untouched", rc == 2 and raw(d) == before, out)
    for bad in ("[]", '{"a":1}', "3"):
        rc, out = run(d, "task", "T01", f"status={bad}")
        check(f"a non-string status {bad} is refused with exit 2, not a traceback",
              rc == 2 and raw(d) == before and "Traceback" not in out, out)
    rc, out = run(d, "task", "T01", "nokeyvalue")
    check("a field without = is refused", rc == 2 and raw(d) == before, out)
    rc, out = run(d, "task", "--in", "layers", "L1", "pr=10530", "status=open")
    check("task --in layers edits layers[] and does not check task statuses",
          rc == 0 and read(d)["layers"] == [{"id": "L1", "pr": 10530, "status": "open"}], out)

    rc, out = run(d, "inflight", "rm", "agent-1")
    check("rm on an untracked inFlight never creates []", rc == 0 and "inFlight" not in read(d), out)
    rc, out = run(d, "inflight", "add", "agent", "agent-1", "T02", "implementer")
    check("inflight add appends {kind, id, what}",
          read(d)["inFlight"] == [{"kind": "agent", "id": "agent-1", "what": "T02 implementer"}], out)
    run(d, "inflight", "add", "gate", "g1", "plannotator on /abs/a.md")
    rc, out = run(d, "inflight", "add", "agent", "agent-1", "T02 fixer")
    check("inflight add with a known id replaces that entry",
          [e["what"] for e in read(d)["inFlight"]] == ["plannotator on /abs/a.md", "T02 fixer"] and "replaced" in out, out)
    rc, out = run(d, "inflight", "add", "shell", "b1", "x")
    check("an unknown inFlight kind is refused", rc == 2, out)
    rc, out = run(d, "inflight", "rm", "agent-9")
    check("rm of an id not listed is reported, not an error", rc == 0 and "nothing removed" in out, out)
    run(d, "inflight", "rm", "agent-1")
    run(d, "inflight", "rm", "g1")
    check("removing the last entry leaves [] (nothing running)", read(d)["inFlight"] == [])

    run(d, "note", "PR", "#10530", "opened")
    run(d, "note", "master red on lint")
    check("note appends each text in order", read(d)["notes"] == ["PR #10530 opened", "master red on lint"])

    st = os.stat(os.path.join(d, ".durable-state", "state.json"))
    run(d, "set", "phase", "implement")
    st2 = os.stat(os.path.join(d, ".durable-state", "state.json"))
    left = [f for f in os.listdir(os.path.join(d, ".durable-state")) if f != "state.json"]
    check("a write replaces the file by rename and leaves no temp file", st.st_ino != st2.st_ino and not left,
          f"inode {st.st_ino}->{st2.st_ino}, left {left}")

    sub = os.path.join(d, "src", "deep")
    os.makedirs(sub)
    rc, out = run(sub, "set", "phase", "review")
    check("the file is found from a subdirectory of the worktree", rc == 0 and read(d)["phase"] == "review", out)

    rc, out = run(d, "--skill", "other-skill", "set", "phase", "x")
    check("--skill naming another owner is refused", rc == 2 and read(d)["skill"] == "sdd-loop", out)

    o = worktree(root, "owned", {"skill": "sdd-loop", "sessionId": "sess-other", "phase": "implement", "custom": [1]})
    before = raw(o)
    rc, out = run(o, "set", "phase", "done")
    check("another session's run is refused", rc == 2 and raw(o) == before and "claim" in out, out)
    rc, out = run(o, "claim")
    check("claim takes the run over with this session's id", rc == 0 and read(o)["sessionId"] == "sess-me", out)
    rc, out = run(o, "set", "phase", "done")
    check("after claim, writes go through and unknown keys survive",
          rc == 0 and read(o) == {"skill": "sdd-loop", "sessionId": "sess-me", "phase": "done", "custom": [1]}, out)
    rc, out = run(o, "claim", sid=None)
    check("claim without CLAUDE_CODE_SESSION_ID is refused", rc == 2, out)

    g = worktree(root, "garbage", "{nope")
    rc, out = run(g, "note", "x")
    check("an unparseable state.json is refused and left as it was", rc == 2 and raw(g) == "{nope", out)

    f = os.path.join(root, "explicit", "s.json")
    rc, out = run(root, "--file", f, "--skill", "durable-state", "note", "standalone")
    check("--file creates the named file", rc == 0 and json.load(open(f))["notes"] == ["standalone"], out)
    ff = os.path.join(o, ".durable-state", "state.json")
    before = raw(o)
    rc, out = run(root, "--file", ff, "note", "x", sid="sess-third")
    check("--file on another session's run is refused too", rc == 2 and raw(o) == before, out)
    rc, out = run(o, "note", "x", sid=None)
    check("an owned run is refused when CLAUDE_CODE_SESSION_ID is unset",
          rc == 2 and raw(o) == before and "unset" in out, out)

    b = worktree(root, "shapes", {"skill": "sdd-loop", "tasks": [{"id": 3, "status": "pending"}],
                                  "inFlight": "agent-1", "notes": {"a": 1}})
    before = raw(b)
    for args, desc in [(("task", "3", "id=T09"), "a task id= field"),
                       (("inflight", "add", "agent", "a1", "x"), "inflight add over a non-array inFlight"),
                       (("inflight", "rm", "a1"), "inflight rm over a non-array inFlight"),
                       (("note", "x"), "note over a non-array notes")]:
        rc, out = run(b, *args)
        check(f"{desc} is refused and the file is untouched", rc == 2 and raw(b) == before, out)
    rc, out = run(b, "task", "3", "status=done")
    check("a hand-written numeric task id is found, not duplicated",
          rc == 0 and read(b)["tasks"] == [{"id": 3, "status": "done"}], out)
    run(b, "set", "inFlight", "null")
    rc, out = run(b, "inflight", "rm", "a1")
    check("rm on a null inFlight leaves it null", rc == 0 and read(b)["inFlight"] is None, out)
    rc, out = run(b, "inflight", "add", "gate", "g1", "gate B")
    check("add on a null inFlight starts the list",
          rc == 0 and read(b)["inFlight"] == [{"kind": "gate", "id": "g1", "what": "gate B"}], out)
    rc, out = run(b, "set", "ratio", "NaN")
    check("NaN is stored as a string, so the file stays valid JSON",
          rc == 0 and read(b)["ratio"] == "NaN" and "NaN," not in raw(b) and ": NaN" not in raw(b), out)

    p = os.path.join(b, ".durable-state", "state.json")
    os.chmod(p, 0o640)
    rc, out = run(b, "set", "notes", "[]")
    check("a write keeps the file's mode", rc == 0 and os.stat(p).st_mode & 0o777 == 0o640,
          f"{oct(os.stat(p).st_mode)} {out}")

    for line in FAILS:
        print(line)
    print(f"\nstate_selftest.py: {PASSES} passed, {len(FAILS)} failed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
