#!/usr/bin/env bash
# Run by the Renovate bot after it updates npm dependencies. The bot generates
# package-lock.json with a newer npm than CI, which drops entries that CI's
# `npm ci` and `package-lock-integrity` job need, so regenerate the lock file
# with the npm version bundled with the Node.js version in mise/config.toml.
#
# Temporary: remove this script and its post-upgrade hook in renovate-gitlab-bot
# once CI is on Node 24 (https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/work_items/2331).
set -euo pipefail

node_version=$(sed -n 's/^node = "\(.*\)"$/\1/p' mise/config.toml)
npm_version=$(node -e '
  fetch("https://nodejs.org/dist/index.json", { signal: AbortSignal.timeout(30_000) })
    .then((res) => res.json())
    .then((releases) => {
      const release = releases.find(({ version }) => version === `v${process.argv[1]}`);
      if (!release) throw new Error(`Unknown Node.js version: ${process.argv[1]}`);
      console.log(release.npm);
    });
' "$node_version")

echo "Regenerating package-lock.json with npm ${npm_version} (Node.js ${node_version})"
npx --yes "npm@${npm_version}" install --package-lock-only --ignore-scripts --no-audit --no-fund
