# Release 1.0.1 Checks

Date: 2026-11-04. Product: Review Tools for GitLab.
Repository: https://github.com/zubinzhang/review-tools-for-gitlab

## Identity and licensing

- Original split-code and review-comment icons replace the extension and sidebar logos.
- The account status indicator and system-note fallback use generic icons.
- The release package excludes the upstream logo PNG and GitLab-branded SVG icons.
- README and package metadata identify this as an independent extension and link to this fork.
- The upstream MIT license and copyright are retained. The source baseline is
  `43dcf78d09b3dc88b33a75ca67b72030c6e44910` from
  https://gitlab.com/gitlab-org/gitlab-vscode-extension.
- Bundled dependency inputs generate `THIRD_PARTY_NOTICES.txt`. Missing npm license texts
  are supplied under `third_party/licenses/` with their provenance; vue-resize uses its
  declared MIT license and author attribution because its archive omits a license file.
- Version 1.0.0 was reissued with identifier `zubinzhang.review-tools-for-gitlab`. The earlier
  `zubinzhang.gitlab-review` build must be uninstalled before enabling the replacement.
  Accounts require authentication again; saved review state is not migrated. Existing worktree
  metadata is recognized across extension IDs so clean snapshots can be reused and safely cleaned.
  Commands retain the `gitlab-review.*` namespace.

## Credential and data checks

- Gitleaks 8.30.1 inspected the available upstream Git history: seven findings were reviewed.
  Five were synthetic sanitizer fixtures, one was a public OAuth client identifier, and one
  was a historical hardcoded access token whose validity was not tested.
- The public repository starts from a clean source snapshot, without importing that history.
  The original local upstream checkout and its history are preserved.
- The exported source was scanned with default Gitleaks rules. Only the five known dummy
  sanitizer values are allowed, constrained to their exact values and fixture path.
- Source and VSIX checks cover GitLab token patterns, private keys, company service domains,
  and personal absolute paths. Raw scanner reports containing history metadata stay local.
- Review worktrees, authentication storage, node_modules, logs, and local build caches are
  excluded from the source snapshot. Source maps and build metadata are excluded from the VSIX.

## Dependency checks

- The compiled extension and webview contain 41 npm package/version entries. Their declared
  licenses are MIT, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, and MPL-2.0 OR Apache-2.0.
- Vue and its compatibility runtime use 3.5.44. No direct advisory in this run matches the
  compiled dependency versions. Audit metadata still propagates low-severity Vue 2 peer warnings
  to bundled v-tooltip and vue-resize, but the compiled module inventory resolves their Vue
  imports through the Vue 3 compatibility alias and contains no Vue 2 runtime modules.
- This does not mean the full repository dependency graph is clean. Root production dependency
  metadata still reports 27 advisories, including 9 high and 3 critical, in dependencies not
  included at affected versions in the release bundle. The webview lock also retains three
  low advisories through legacy Vue 2 peer dependencies that the Vue 3 compatibility alias
  excludes from its bundle. Development dependencies were not comprehensively remediated.
- Audit results are a registry snapshot, not a guarantee against undisclosed vulnerabilities
  or a full manual exploitability assessment.

## Verification

- Jest: 301 suites, 2717 tests passed.
- Webview Vitest: 8 files, 56 tests passed.
- Packaging and license-notice tests: 7 passed.
- Real VS Code integration: 30 tests passed, including TypeScript and Go/gopls hover,
  definition and implementation results, exact MR commits, diff restoration, and comment ranges.
  Added real-workspace checks cover detach/reuse, duplicate caches across extension IDs, and
  merged-MR cleanup that preserves an open source editor and the original dirty checkout.
- Integration tests validate VS Code API behavior. The final navigation checks activate the
  actual language-service target and verify its MR diff; they do not simulate mouse clicks or
  claim a complete keyboard/UI end-to-end run. Native Go navigation commands also passed in
  a separate foreground-window run; background runs did not reliably dispatch editor actions.
- TypeScript no-emit, scoped ESLint, Prettier, and Git whitespace checks passed. Webview lint
  has three pre-existing component-name warnings and no errors.
- Root and webview `npm ci --ignore-scripts --dry-run` checks passed after repairing peer
  dependency lock metadata. This verifies lock consistency, not an isolated full reinstall.

## Known feature limits

- Arbitrary function folding, including changed functions, is not available in the native diff.
- Hover and semantic navigation use the new side of a prepared exact-commit MR worktree and
  require a configured language extension and project dependencies.
- GitLab 15.11 compatibility uses the existing API-read verification and mocked write tests;
  this release check did not write comments to a live private GitLab instance.
- GitHub source and VSIX distribution do not publish to the VS Code Marketplace.

## Review cache maintenance

- Startup and review-sidebar visibility trigger background checks of exact project/MR identities.
  Missing list entries, unknown state, failed requests, and mismatched identities never imply closure.
- Status checks share concurrent runs, query at most two MRs at once, and throttle open MRs for
  five minutes. Cached revisions of the same MR share one status request.
- Inactive workspace folders detach after 30 quiet seconds; same-commit caches remain reusable.
  Disk deletion requires an idle duplicate or a confirmed closed/merged MR, a registered worktree
  with matching commit/repository, and no tracked, untracked, or ignored local data. Git removal
  does not use force, and eligibility is checked again just before removal.
- Unit tests cover cancellation, unknown/offline status, concurrent additions, dirty documents,
  malformed metadata, path aliases, different revisions, disposal, and rejected workspace updates.
- A local microbenchmark over ten temporary snapshot folders and a simulated workspace ran 200
  deduplication checks: median 1.65 ms, 95th percentile 1.99 ms. This excludes network requests,
  actual VS Code folder changes, Git cleanup processes, and language-service loading time.
