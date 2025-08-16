#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not in a valid Git working tree."
  exit 1
fi
# Remove existing submodule config to avoid conflicts
if git config --file .gitmodules --get-regexp "^submodule\..*\." >/dev/null 2>&1; then
  echo "Removing existing submodule config..."
  git submodule deinit -f . || true
  git rm -f . || true
  rm -rf .git/modules/*
fi
# Add submodule with token
echo "Adding private submodule..."
# Replace with your submodule's repo and path
git submodule add -f "https://${GITHUB_TOKEN}@github.com/joshuaolin/some-submodule.git" some-submodule
git submodule sync
git submodule update --init --recursive