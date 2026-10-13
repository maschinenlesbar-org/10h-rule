#!/usr/bin/env bash
# Builds the 10H Explorer offline on this machine and publishes dist/ to the gh-pages branch.
# The build is too slow for CI (OCR and embeddings time out there), so it runs locally with the caches in .cache/.
#
#   ./publish-pages.sh              build offline, test, export, push
#   ./publish-pages.sh --no-build   push the existing dist/ as it is
#
# gh-pages is replaced by a single commit on every run, so old PDFs and databases do not pile up in the history.
# GitHub Pages: Settings → Pages → Build and deployment → Source: Deploy from a branch, gh-pages, / (root).
set -euo pipefail

APP=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$APP" rev-parse --show-toplevel)
BRANCH=gh-pages
REMOTE=$(git -C "$REPO" remote get-url origin)

cd "$APP"
if [[ "${1:-}" != "--no-build" ]]; then
  npm run build:offline
  npm test
  npm run export
fi
[[ -f dist/index.html && -f dist/.nojekyll ]] || { echo "dist/ is missing or incomplete; run without --no-build" >&2; exit 1; }

SRC=$(git -C "$REPO" rev-parse --short HEAD)
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || SRC="$SRC-dirty"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -R dist/. "$TMP"
git -C "$TMP" init -q -b "$BRANCH"
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$(git -C "$REPO" config user.name)" -c user.email="$(git -C "$REPO" config user.email)" \
  commit -q -m "Deploy 10H Explorer from $SRC"
git -C "$TMP" push --force "$REMOTE" "$BRANCH:$BRANCH"
echo "Published dist/ ($SRC) to $BRANCH"
