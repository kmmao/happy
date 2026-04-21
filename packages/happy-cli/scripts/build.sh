#!/bin/bash
set -e

# Atomic build script for happy-cli
#
# Problem: The old build command "rm -rf dist && tsc --noEmit && pkgroll" deletes
# dist/ before type-checking, creating a long window (~20-30s) where the daemon
# can't spawn new workers or restart itself.
#
# Solution: Type-check first (no file changes), then build to a temp dir and
# atomically swap. This minimizes the window where dist/ is unavailable to just
# the instant of the mv command.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 1. Type check first — no file changes, safe to do while daemon is running
# Use the repo-local TypeScript binary directly so Yarn builds don't emit
# noisy npm "Unknown env config" warnings through npx.
echo "[build] Type checking..."
"$PROJECT_DIR/node_modules/.bin/tsc" --noEmit

# 2. Build into a temp directory (dist_next)
echo "[build] Building to dist_next..."
rm -rf dist_next

# Temporarily rename dist so pkgroll creates a fresh dist/
# pkgroll reads output paths from package.json (./dist/...) so we can't
# redirect it. Instead: move old dist aside, let pkgroll build fresh, clean up.
if [ -d dist ]; then
  mv dist dist_prev
fi

if pkgroll; then
  # 3. Success — clean up old build
  echo "[build] Build succeeded, cleaning up dist_prev..."
  rm -rf dist_prev
else
  # 4. Build failed — restore old dist so daemon keeps working
  echo "[build] Build FAILED, restoring previous dist..."
  rm -rf dist 2>/dev/null
  if [ -d dist_prev ]; then
    mv dist_prev dist
  fi
  exit 1
fi

echo "[build] Done."
