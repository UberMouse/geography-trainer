#!/usr/bin/env bash
# Selftest for the worktree hooks (worktree-create.sh, worktree-setup.sh, worktree-remove.sh,
# worktree-cleanup.sh) and scripts/await-setup.sh, against throwaway repos (a bare origin plus a
# clone), an isolated HOME and git config, and a fake npm. Run:
#   bash .claude/hooks/worktree-hooks.selftest.sh
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
create="$here/worktree-create.sh"
remove="$here/worktree-remove.sh"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" GIT_CONFIG_GLOBAL="$tmp/gitconfig" GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
unset PLAYWRIGHT_BROWSERS_PATH
mkdir -p "$HOME/.claude" "$tmp/bin"
git config --global init.defaultBranch main

# Fake npm: records the call, takes a second, and leaves a finished install (with a cache dir).
cat >"$tmp/bin/npm" <<EOF
#!/usr/bin/env bash
echo "\$PWD \$*" >>"$tmp/npm.log"
sleep 1
mkdir -p node_modules/pkg node_modules/.vite
echo pkg >node_modules/pkg/index.js
echo cache >node_modules/.vite/dep.js
echo '{}' >node_modules/.package-lock.json
EOF
chmod +x "$tmp/bin/npm"
export PATH="$tmp/bin:$PATH" WORKTREE_SETUP_SLOT=0
await="$(cd "$here/../.." && pwd)/scripts/await-setup.sh"

setup_state() { echo "$(git -C "$1" rev-parse --absolute-git-dir)/worktree-setup"; }
wait_setup() { # dir: wait for the background setup to finish (max 30s)
  local s i
  s=$(setup_state "$1")
  for ((i = 0; i < 150; i++)); do [[ -f "$s/pending" ]] || return 0; sleep 0.2; done
  return 1
}

fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

run_create() { # cwd name -> sets out, rc
  out=$(jq -nc --arg cwd "$1" --arg name "$2" '{hook_event_name:"WorktreeCreate",cwd:$cwd,name:$name}' \
    | (cd "$1" && bash "$create") 2>"$tmp/err")
  rc=$?
}
run_remove() { # path -> sets rc
  jq -nc --arg p "$1" '{hook_event_name:"WorktreeRemove",worktree_path:$p}' | bash "$remove" 2>"$tmp/err"
  rc=$?
}

# origin has commit A; the clone's main is one commit ahead (B).
git init -q --bare "$tmp/origin.git"
git clone -q "$tmp/origin.git" "$tmp/seed" 2>/dev/null
(cd "$tmp/seed" && echo a >a && git add a && git commit -qm A && git push -q origin main)
git clone -q "$tmp/origin.git" "$tmp/repo"
repo=$(cd "$tmp/repo" && pwd -P)
(cd "$repo" && echo '{}' >package-lock.json && printf 'node_modules/\n' >.gitignore \
  && git add . && git commit -qm B)
sha_a=$(git -C "$repo" rev-parse origin/main)
sha_b=$(git -C "$repo" rev-parse HEAD)

# --- fresh (default) ---
run_create "$repo" foo
wt="$repo/.claude/worktrees/foo"
check "fresh: exits 0" '[[ $rc == 0 ]]'
check "fresh: stdout is exactly the path" '[[ "$out" == "$wt" ]]'
check "fresh: branch worktree-foo" '[[ "$(git -C "$wt" symbolic-ref --short HEAD)" == worktree-foo ]]'
check "fresh: based on origin/main" '[[ "$(git -C "$wt" rev-parse HEAD)" == "$sha_a" ]]'
check "fresh: no npm run without a lockfile" '[[ ! -f "$tmp/npm.log" ]]'

# --- head via project-local settings, from inside another worktree ---
printf '{"worktree":{"baseRef":"head"}}\n' >"$repo/.claude/settings.local.json"
run_create "$repo" bar
wt_bar="$repo/.claude/worktrees/bar"
check "head: based on the main checkout's HEAD" '[[ $rc == 0 && "$(git -C "$wt_bar" rev-parse HEAD)" == "$sha_b" ]]'
check "setup: hook returns before the install finishes (marker left)" '[[ -f "$(setup_state "$wt_bar")/pending" ]]'
check "setup: background install finishes" 'wait_setup "$wt_bar"'
check "setup: npm ci ran in the worktree (no donor yet)" 'grep -q "^$wt_bar ci " "$tmp/npm.log" && [[ -f "$wt_bar/node_modules/.package-lock.json" ]]'
check "setup: git status stays clean (state lives in the git dir)" '[[ -z "$(git -C "$wt_bar" status --porcelain)" ]]'
(cd "$wt_bar" && echo c >c && git add c && git commit -qm C)
sha_c=$(git -C "$wt_bar" rev-parse HEAD)
run_create "$wt_bar" nested/baz
wt_baz="$repo/.claude/worktrees/nested/baz"
wait_setup "$wt_baz"
check "head: from a worktree, uses that worktree's HEAD and the main root" \
  '[[ $rc == 0 && "$out" == "$wt_baz" && "$(git -C "$wt_baz" rev-parse HEAD)" == "$sha_c" ]]'

# --- user settings lose to project settings ---
printf '{"worktree":{"baseRef":"fresh"}}\n' >"$HOME/.claude/settings.json"
npm_calls=$(wc -l <"$tmp/npm.log")
run_create "$repo" qux
wt_qux="$repo/.claude/worktrees/qux"
check "settings: local beats user" '[[ "$(git -C "$wt_qux" rev-parse HEAD)" == "$sha_b" ]]'
wait_setup "$wt_qux"
check "donor: node_modules hardlinked from a checkout with the same lockfile" \
  '[[ "$wt_qux/node_modules/pkg/index.js" -ef "$wt_bar/node_modules/pkg/index.js" ]]'
check "donor: npm not run" '[[ "$(wc -l <"$tmp/npm.log")" == "$npm_calls" ]]'
check "donor: per-checkout cache dirs are not shared" '[[ ! -e "$wt_qux/node_modules/.vite" && -f "$wt_bar/node_modules/.vite/dep.js" ]]'
check "donor: hidden lockfile kept" '[[ -f "$wt_qux/node_modules/.package-lock.json" ]]'
rm "$repo/.claude/settings.local.json"

# --- await-setup.sh ---
st=$(setup_state "$wt_qux")
sleep 3 &
sleeper=$!
echo "$sleeper" >"$st/pending"
(sleep 1.5; rm -f "$st/pending") &
t0=$SECONDS
out=$(cd "$wt_qux" && bash "$await" echo ran 2>"$tmp/err")
check "await: waits while a live setup's marker exists, then runs the command" \
  '[[ "$out" == ran ]] && grep -q "waiting for" "$tmp/err" && grep -q "install finished" "$tmp/err"'
wait "$sleeper" 2>/dev/null
echo 999999 >"$st/pending"
out=$(cd "$wt_qux" && bash "$await" echo ran 2>"$tmp/err")
check "await: a dead setup pid does not block" '[[ "$out" == ran ]] && grep -q "gone without finishing" "$tmp/err"'
echo "starting $(($(date +%s) - 600))" >"$st/pending"
out=$(cd "$wt_qux" && bash "$await" echo ran 2>"$tmp/err")
check "await: a setup that never started does not block" '[[ "$out" == ran ]] && grep -q "never started" "$tmp/err"'
rm -f "$st/pending"
echo "npm ci failed" >"$st/failed"
out=$(cd "$wt_qux" && bash "$await" echo ran 2>"$tmp/err")
check "await: a failed setup is reported and the command still runs" '[[ "$out" == ran ]] && grep -q "setup failed: npm ci failed" "$tmp/err"'
rm -f "$st/failed"
out=$(cd "$tmp" && bash "$await" echo ran 2>"$tmp/err")
check "await: outside git, just runs the command" '[[ "$out" == ran && ! -s "$tmp/err" ]]'

# --- reuse ---
npm_calls=$(wc -l <"$tmp/npm.log")
run_create "$repo" bar
check "reuse: same name returns the same path" '[[ $rc == 0 && "$out" == "$wt_bar" ]]'
check "reuse: node_modules present, npm not rerun" '[[ "$(wc -l <"$tmp/npm.log")" == "$npm_calls" ]]'

# --- invalid names ---
for bad in "../x" "a/../b" "" "has space" "/abs"; do
  run_create "$repo" "$bad"
  check "invalid name '$bad' is refused" '[[ $rc != 0 && -z "$out" ]]'
done

# --- no remote falls back to HEAD ---
git init -q "$tmp/solo"
(cd "$tmp/solo" && echo s >s && git add s && git commit -qm S)
solo=$(cd "$tmp/solo" && pwd -P)
run_create "$solo" one
check "no remote: based on HEAD" \
  '[[ $rc == 0 && "$(git -C "$solo/.claude/worktrees/one" rev-parse HEAD)" == "$(git -C "$solo" rev-parse HEAD)" ]]'

# --- remove ---
run_remove "$repo/.claude/worktrees/qux"
check "remove: clean worktree removed" '[[ $rc == 0 && ! -d "$repo/.claude/worktrees/qux" ]]'
check "remove: merged branch deleted" '! git -C "$repo" show-ref --quiet refs/heads/worktree-qux'

run_remove "$wt_baz"
check "remove: worktree with an unmerged commit removed" '[[ $rc == 0 && ! -d "$wt_baz" ]]'
check "remove: unmerged branch kept" 'git -C "$repo" show-ref --quiet refs/heads/worktree-nested/baz'

echo dirty >>"$wt/a"
run_remove "$wt"
check "remove: dirty worktree refused and left on disk" '[[ $rc != 0 && -d "$wt" ]]'

run_remove "$wt_bar"
check "remove: ignored node_modules does not block removal" '[[ $rc == 0 && ! -d "$wt_bar" ]]'

run_remove "$repo"
check "remove: refuses a path outside .claude/worktrees" '[[ $rc != 0 && -d "$repo" ]]'

# --- cleanup (SubagentStop / sweep) ---
cleanup="$here/worktree-cleanup.sh"
subagents="$HOME/.claude/projects/proj/sess/subagents"
mkdir -p "$subagents"
# Agents branch from local main (B, which has the lockfile), so a merge into main fast-forwards.
printf '{"worktree":{"baseRef":"head"}}\n' >"$repo/.claude/settings.local.json"
make_agent() { # name finished(true|false|none) -> creates worktree + meta, sets agent_dir
  run_create "$repo" "$1"
  agent_dir="$repo/.claude/worktrees/$1"
  wait_setup "$agent_dir"
  [[ "$2" == none ]] && return
  jq -n --arg p "$agent_dir" --arg b "worktree-$1" --argjson f "$2" \
    '{spawnedWithWorktree:true,worktreePath:$p,worktreeBranch:$b,finished:$f}' >"$subagents/$1.meta.json"
}
run_stop() { # name -> SubagentStop for that agent
  jq -nc --arg t "$subagents/$1.jsonl" --arg cwd "$repo" \
    '{hook_event_name:"SubagentStop",cwd:$cwd,agent_id:"x",agent_transcript_path:$t}' \
    | bash "$cleanup" 2>"$tmp/err"
  rc=$?
}
gone() { [[ ! -d "$repo/.claude/worktrees/$1" ]] && ! git -C "$repo" show-ref --quiet "refs/heads/worktree-$1"; }
kept() { [[ -d "$repo/.claude/worktrees/$1" ]]; }

make_agent agent-clean false
make_agent agent-dirty false
echo x >"$agent_dir/untracked"
make_agent agent-commit false
(cd "$agent_dir" && echo y >y && git add y && git commit -qm Y)
make_agent agent-merged true
(cd "$agent_dir" && echo z >z && git add z && git commit -qm Z)
git -C "$repo" merge -q --ff-only worktree-agent-merged
make_agent agent-running false
make_agent agent-nometa none
make_agent agent-locked true
git -C "$repo" worktree lock "$agent_dir"
make_agent agent-lockedstop false
git -C "$repo" worktree lock "$agent_dir"
run_create "$repo" plain-session
check "cleanup: node_modules made in agent worktrees (ignored files)" '[[ -d "$repo/.claude/worktrees/agent-clean/node_modules" ]]'

jq -nc --arg t "$subagents/agent-clean.jsonl" '{agent_transcript_path:$t}' | bash "$cleanup" --dry-run 2>"$tmp/err"
check "cleanup: --dry-run removes nothing" 'kept agent-clean && kept agent-merged && grep -q "would remove agent-clean" "$tmp/err"'

run_stop agent-clean
check "cleanup: stopping agent's unchanged worktree and branch removed" '[[ $rc == 0 ]] && gone agent-clean'
check "cleanup: sweep removed a finished agent whose commits are merged" 'gone agent-merged'
check "cleanup: finished but locked is kept" 'kept agent-locked'
check "cleanup: unfinished agent (still running) is kept" 'kept agent-running'
check "cleanup: worktree with no meta is kept" 'kept agent-nometa'
check "cleanup: non-agent worktree is never touched" 'kept plain-session'

run_stop agent-dirty
check "cleanup: untracked files keep it" 'kept agent-dirty && grep -q "uncommitted or untracked" "$tmp/err"'
run_stop agent-commit
check "cleanup: an unmerged commit keeps it" 'kept agent-commit && grep -q "1 commit(s) on no other branch" "$tmp/err"'
run_stop agent-lockedstop
check "cleanup: the stopping agent's own lock does not keep it" 'gone agent-lockedstop'

make_agent agent-installing false
st=$(setup_state "$agent_dir")
setsid -f bash -c 'echo $$ >"$1"; exec sleep 60' _ "$st/pending" </dev/null >/dev/null 2>&1
for ((i = 0; i < 50; i++)); do [[ "$(cat "$st/pending" 2>/dev/null)" =~ ^[0-9]+$ ]] && break; sleep 0.1; done
installer=$(cat "$st/pending")
run_stop agent-installing
check "cleanup: a still-running install is stopped and the worktree removed" \
  'gone agent-installing && ! kill -0 "$installer" 2>/dev/null'

jq -n '{spawnedWithWorktree:false}' >"$subagents/agent-noworktree.meta.json"
run_stop agent-noworktree
check "cleanup: agent without a worktree is a no-op" '[[ $rc == 0 ]] && kept agent-dirty && kept agent-running'
bash "$cleanup" </dev/null 2>"$tmp/err"
check "cleanup: plain sweep with no stdin exits 0" '[[ $? == 0 ]]'

if ((fails)); then
  echo "$fails failure(s)"
  exit 1
fi
echo "all passed"
