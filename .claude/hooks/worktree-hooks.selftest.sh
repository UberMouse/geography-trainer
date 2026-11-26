#!/usr/bin/env bash
# Selftest for worktree-create.sh and worktree-remove.sh, against throwaway repos (a bare
# origin plus a clone), an isolated HOME and git config, and a fake npm. Run:
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

# Fake npm: records the call and makes node_modules.
cat >"$tmp/bin/npm" <<EOF
#!/usr/bin/env bash
echo "\$PWD \$*" >>"$tmp/npm.log"
mkdir -p node_modules
EOF
chmod +x "$tmp/bin/npm"
export PATH="$tmp/bin:$PATH"

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
check "head: npm ci ran in the worktree" 'grep -q "^$wt_bar ci " "$tmp/npm.log"'
(cd "$wt_bar" && echo c >c && git add c && git commit -qm C)
sha_c=$(git -C "$wt_bar" rev-parse HEAD)
run_create "$wt_bar" nested/baz
wt_baz="$repo/.claude/worktrees/nested/baz"
check "head: from a worktree, uses that worktree's HEAD and the main root" \
  '[[ $rc == 0 && "$out" == "$wt_baz" && "$(git -C "$wt_baz" rev-parse HEAD)" == "$sha_c" ]]'

# --- user settings lose to project settings ---
printf '{"worktree":{"baseRef":"fresh"}}\n' >"$HOME/.claude/settings.json"
run_create "$repo" qux
check "settings: local beats user" '[[ "$(git -C "$repo/.claude/worktrees/qux" rev-parse HEAD)" == "$sha_b" ]]'
rm "$repo/.claude/settings.local.json"

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

if ((fails)); then
  echo "$fails failure(s)"
  exit 1
fi
echo "all passed"
