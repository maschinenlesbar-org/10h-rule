#!/usr/bin/env bash
# Builds the 10H Explorer offline on this machine and publishes dist/ to the gh-pages branch.
# The build is too slow for CI (OCR and embeddings time out there), so it runs locally with the caches in .cache/.
#
#   ./publish-pages.sh              build offline, test, export, push
#   ./publish-pages.sh --no-build   push the existing dist/ as it is
#   ./publish-pages.sh --force      also from a working tree that is not origin/main (uncommitted or unpushed changes)
#
# Only what is on origin/main goes live: the script stops when the working tree has changes or HEAD is not origin/main,
# unless --force is given (the deploy commit is then marked "-dirty" or "-unpushed").
# gh-pages is replaced by a single commit on every run, so old PDFs and databases do not pile up in the history. The push
# expects the gh-pages commit seen at the start, so a deploy made from elsewhere in the meantime is not overwritten.
# GitHub Pages: Settings → Pages → Build and deployment → Source: Deploy from a branch, gh-pages, / (root).
set -euo pipefail

BUILD=1 FORCE=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --force) FORCE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

APP=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$APP" rev-parse --show-toplevel)
BRANCH=gh-pages
REMOTE=$(git -C "$REPO" remote get-url origin)

git -C "$REPO" fetch -q origin main
SRC=$(git -C "$REPO" rev-parse --short HEAD)
PROBLEM=""
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || { PROBLEM="the working tree has uncommitted changes"; SRC="$SRC-dirty"; }
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$(git -C "$REPO" rev-parse origin/main)" ]] || { PROBLEM="${PROBLEM:+$PROBLEM, and }HEAD is not origin/main"; SRC="$SRC-unpushed"; }
if [[ -n "$PROBLEM" && "$FORCE" == 0 ]]; then
  echo "Not publishing: $PROBLEM. Commit and push first, or pass --force." >&2
  exit 1
fi
LEASE=$(git ls-remote "$REMOTE" "refs/heads/$BRANCH" | cut -f1) # empty when gh-pages does not exist yet

cd "$APP"
if [[ "$BUILD" == 1 ]]; then
  npm run build:offline
  npm test
  npm run export
fi
[[ -f dist/index.html && -f dist/.nojekyll ]] || { echo "dist/ is missing or incomplete; run without --no-build" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R dist/. "$TMP"
git -C "$TMP" init -q -b "$BRANCH"
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$(git -C "$REPO" config user.name)" -c user.email="$(git -C "$REPO" config user.email)" \
  commit -q -m "Deploy 10H Explorer from $SRC"
git -C "$TMP" push --force-with-lease="refs/heads/$BRANCH:$LEASE" "$REMOTE" "$BRANCH:$BRANCH"
echo "Published dist/ ($SRC) to $BRANCH"
