---
name: ui-feature-testing
description: >-
  Deterministic path to verify a user-visible feature of the GitLab VS Code
  extension end to end and, when needed, capture a recording. Use when adding or
  changing a command, webview, tree-view action, notification, or editor
  interaction and you need to confirm it works inside a real VS Code instance
  with WebdriverIO. Covers the tiered verification workflow (unit → build → E2E),
  building the extension under test, spec/helper conventions, how to invoke
  commands that are hidden from the palette, what cannot be tested
  deterministically, producing a non-empty video recording, and debugging.
---

# UI feature testing (E2E with WebdriverIO)

E2E tests drive a **real VS Code instance** with the extension installed from
source, talking to a **live GitLab instance** (`gitlab.com` by default). They use
[`wdio-vscode-service`](https://webdriver.io/docs/extension-testing/vscode-extensions/)
and the `mocha` framework. They are the only layer that can simulate real clicks
and inspect rendered UI (integration tests cannot — see
`docs/developer/testing-strategy.md`).

Everything in this skill lives under `test/e2e/`.

## 0. Decide if an E2E test is the right layer

E2E tests are **slow, network-dependent, and flaky-prone**. Add one only when the
behavior cannot be covered more cheaply:

- **Add an E2E test** to confirm a feature is "plugged in" to VS Code end to end —
  a command is contributed and reachable, a webview renders and responds, a
  notification appears, a tree-view/editor interaction works, or an AI feature
  (Code Suggestions, Duo Chat, Duo Workflow) produces real output. The strategy
  doc recommends an E2E test for **new major features** and flows integration
  tests can't reach.
- **Do NOT add an E2E test** for business logic (Jest unit tests in `src/`), for
  VS Code API-boundary behavior with a mocked GitLab API (mocha integration tests
  in `test/integration/`), or for webview component rendering in isolation (vitest
  in `webviews/vue3` / `webviews/vue2`). Keep the E2E suite a small set of
  high-value happy-path flows.

## 1. Recommended verification workflow (tiered, fastest signal first)

When asked to "test that a feature works", go cheap → expensive and stop early if
a tier fails:

1. **Unit tests for the feature** — fast, no build. e.g.
   `npx jest src/desktop/commands/<feature>.test.ts`. Proves the logic.
2. **Build the extension** (Section 2). This compiles the TypeScript; a build
   failure is the cheapest way to catch a broken change. Confirm your new code
   actually made it into the bundle:
   ```bash
   grep -c "gl.yourNewCommand" dist-desktop/extension.js   # expect ≥ 1
   ```
   Grep the command **id** (`gl.…`), not the palette **title**: titles, categories,
   and `when` clauses are declared in the **`contributes`** block of the manifest and
   do **not** appear in `extension.js`, so they give false negatives. Command ids are
   defined in `src/common/command_names.ts` and `src/desktop/command_names.ts` — look
   there to find the id for an existing feature (e.g. `AUTHENTICATE: 'gl.authenticate'`).
   ⚠️ Desktop contributions live in **`desktop.package.json`** (browser:
   `browser.package.json`); the root `package.json` only holds a shared subset, so a
   desktop-only command (e.g. `gl.refreshSidebar`) won't be found there. The built
   manifest the E2E service loads is the generated `dist-desktop/package.json`.
   ⚠️ The generated manifest can **differ from source** — some contributions are
   injected during the build. Notably activity-bar **view containers** (e.g. the
   `gitlab-duo` / "GitLab Duo Chat" icon) appear only in `dist-desktop/package.json`,
   not `desktop.package.json`. If a grep of the source manifest comes up empty for a
   view/container/icon, grep `dist-desktop/package.json` (rebuild first).
3. **E2E wiring check** (Sections 3–5) — launches real VS Code, authenticates, and
   asserts the feature is contributed/reachable. This catches "compiles and unit-
   tested but not wired into VS Code" regressions, which is exactly what E2E is
   for.

This sequence is the proven path; each tier adds confidence the previous can't.

## 2. Build the extension under test (run once per code change)

The E2E service loads the extension from the `dist-desktop/` **directory**
(`wdio.conf.js` sets `extensionPath` to it — there is no `.vsix` involved).
Rebuild whenever `src/` changes, or tests run against stale code.

From the **repo root**:

```bash
npm ci                 # only once / after dependency changes
npm run build:desktop  # builds dist-desktop/ (the bundle the service loads); ~5s
```

Then install the E2E project's own dependencies (separate `package.json`):

```bash
cd test/e2e
npm install            # only once / after test/e2e dep changes
```

Notes:

- Use `npm run build:desktop`, **not** `npm run package`. `build:desktop` is the
  fast (~5s) bundle-only build that produces `dist-desktop/extension.js`, which is
  what the E2E service loads. `npm run package` is a heavier full-VSIX build and is
  not needed here.
- On success it prints the bundle sizes and `⚡ Done`. Then verify your command id
  is in the bundle (step 1.2 above).
- **`tsc` errors in files you didn't touch usually mean a stale `node_modules`, not
  a real code problem.** Run `npm ci` to refresh it from the lockfile, then rebuild.
- **`dist-desktop/` holds whatever you last built — possibly from another branch.**
  A grep can show a command that exists on a _different_ branch (false positive) or
  miss one you just added but didn't rebuild (false negative). Always
  `build:desktop` on the current branch before trusting the bundle.
- The first E2E run downloads the requested VS Code build into
  `test/e2e/.wdio-vscode-service/` and reuses it afterwards ("Skipping download").
- **Shell cwd persists between commands here.** If a step does `cd test/e2e`, later
  repo-root commands (e.g. `ls dist-desktop`) will fail — use absolute paths or
  `cd` back. `dist-desktop/` lives at the **repo root**, not under `test/e2e/`.

## 3. Authentication

Most specs call `completeAuth()`, which requires a GitLab Personal Access Token
with the `api` scope (plus access to AI features if the test exercises them) in
the `TEST_GITLAB_TOKEN` environment variable.

**Check the environment before prompting the user** — in a configured checkout the
variable is usually already set (mise loads it on `cd` into the project):

```bash
[ -n "$TEST_GITLAB_TOKEN" ] && echo set || echo missing
```

Only ask the user for a token if it's actually missing. `completeAuth()` **throws
immediately** if `TEST_GITLAB_TOKEN` is unset. The token is fed through
`withLoggerAtError()` so it never leaks into wdio logs — keep that pattern for any
sensitive input.

## 4. Run the tests

From `test/e2e/`:

```bash
# whole suite
TEST_GITLAB_TOKEN=<PAT> npm run test:e2e

# a single spec while iterating (much faster)
TEST_GITLAB_TOKEN=<PAT> npm run test:e2e -- --spec specs/duo_chat.e2e.js
```

Useful environment overrides (defined in `wdio.conf.js`):

| Variable             | Purpose                                           | Default              |
| -------------------- | ------------------------------------------------- | -------------------- |
| `TEST_GITLAB_TOKEN`  | PAT for `completeAuth()` (required by most specs) | —                    |
| `E2E_VSCODE_VERSION` | `stable`, `insiders`, or e.g. `1.97.1`            | `stable`             |
| `E2E_GITLAB_HOST`    | Target GitLab instance                            | `https://gitlab.com` |
| `E2E_LOG_LEVEL`      | `trace`…`silent`                                  | `info`               |
| `E2E_MAX_INSTANCES`  | Parallel workers                                  | `1`                  |

The suite retries a failing spec file once (`specFileRetries: 1`), mirroring CI.

## 5. Write a new spec

Specs match `./specs/**/*.e2e.js` and use mocha BDD (`describe`/`it`/`before`/
`beforeEach`). Put reusable steps in `test/e2e/helpers/` and re-export them from
`helpers/index.js` (the barrel) — specs import from `../helpers/index.js`.

```js
import { browser } from '@wdio/globals';
import { completeAuth, waitForNotification } from '../helpers/index.js';

describe('GitLab Extension <Feature>', async () => {
  let workbench;

  before(async () => {
    await completeAuth(); // skip if the feature needs no auth
  });

  beforeEach(async () => {
    workbench = await browser.getWorkbench();
  });

  it('does the user-visible thing', async () => {
    await workbench.executeCommand('GitLab: <Your Command>');
    await waitForNotification('expected message');
  });
});
```

### Core APIs and patterns (used throughout existing specs)

- **Workbench / commands**: `const workbench = await browser.getWorkbench();` then
  `await workbench.executeCommand('Exact Command Title')` — the title must match the
  command palette string exactly. ⚠️ This only works for commands the palette shows
  (see "Invoking commands hidden from the palette" below).
- **Command prompts / quick picks**: a command that opens a prompt returns it from
  `executeCommand`, and you drive it with `prompt.getTitle()`, `prompt.setText()`,
  `prompt.selectQuickPick()`, `prompt.getQuickPicks()` / `pick.getLabel()`,
  `prompt.confirm()`. Don't reimplement these inline — the reusable steps live in
  `helpers/command_palette_helpers.js` and `helpers/auth_helpers.js`
  (e.g. `waitForPromptTitleToContain`, `selectPatAuthenticationAndOpenTokenInput`).
  Add new prompt interactions there. The existing specs `selectQuickPick(known)` a
  value they intend to pick; to instead **assert an option is offered**, read all the
  labels: `const labels = await Promise.all((await prompt.getQuickPicks()).map(p => p.getLabel()));`
  then `expect(labels).toContain('https://gitlab.com')`.
- **VS Code API access**: `await browser.executeWorkbench(async (vscode, ...args) => { … }, arg1, …)`
  runs code inside the extension host. Use it to set up state (open files/folders,
  run `vscode.commands.executeCommand(...)`) and to assert things the UI doesn't
  show. See `helpers/editor_helpers.js` (`openFolder`) and
  `specs/open_tab_in_background.e2e.js`.
- **Activity-bar views**:
  `const view = await workbench.getActivityBar().getViewControl('GitLab').openView();`
  opens the GitLab side panel (the `gitlab-workflow` view container) where tree-view
  actions live. There are **several distinct containers**, each its own activity-bar
  icon matched by its title — e.g. `'GitLab'` (`gitlab-workflow`) and the separate
  `'GitLab Duo Chat'` (`gitlab-duo`); don't assume one icon. To **assert an icon is
  available** (rather than open it), poll for the control:
  ```js
  await browser.waitUntil(
    async () => {
      const ctrl = await workbench.getActivityBar().getViewControl('GitLab Duo Chat');
      return Boolean(ctrl) && (await ctrl.getTitle()).includes('GitLab Duo Chat');
    },
    { timeout: 15000, timeoutMsg: 'GitLab Duo Chat activity-bar icon never appeared.' },
  );
  ```
  Note an activity-bar icon only renders if its container has a **visible** view, so
  `when`-gated views (Duo Chat needs auth + Duo access) make the icon conditional —
  `completeAuth()` first when the icon depends on it.
- **Webviews**: `const wv = await workbench.getWebviewByTitle('GitLab Duo Chat'); await wv.open();`
  Webview content lives in nested iframes. To query inside it you often must switch
  frames: `const frames = await browser.$$('iframe'); await browser.switchToFrame(frames[0]);`
  (see `specs/duo_chat.e2e.js` for the iframe-in-iframe case).
- **Selectors & assertions**: `browser.$(selector)` / `browser.$$(selector)` plus
  wdio's `expect`. Prefer stable hooks like `[data-testid="…"]` and `aria/…`
  selectors over brittle CSS (see `verifyDuoChatEmpty`, `checkFolderOpen`).
- **Waiting (never `pause` for state)**: wrap polling in
  `await browser.waitUntil(async () => <condition>, { timeout, timeoutMsg })`.
  Always give a descriptive `timeoutMsg` — it's the main signal when a test fails.
  ⚠️ The **mocha per-test timeout defaults to 60s** (`mochaOpts.timeout` in
  `wdio.conf.js`). A slow AI/agentic flow that polls for minutes will hit _that_
  limit first regardless of your `waitUntil` timeout — raise `mochaOpts.timeout`
  (or set `this.timeout(ms)` inside a non-arrow `it`/hook) for those specs.
- **Inspecting results on disk**: a spec runs in the wdio **Node** process, so it
  can use `fs`/`child_process` directly (read files the extension wrote, `git init`
  a workspace, etc.). For features that produce files (e.g. an agent editing code),
  polling `fs.existsSync(...)` on disk is far more reliable than scraping webview DOM.
- **Notifications**: `waitForNotification(text)` and `dismissAllNotifications()`
  from `helpers/notification_helpers.js`. Dismiss stray notifications before
  interacting with prompts.
- **Keyboard input**: `await browser.keys('Enter')` / `await browser.keys(text.split())`.
- **Logging**: winston `logger` from `helpers/logger_helpers.js`; wrap secrets in
  `withLoggerAtError()` from `helpers/general_helpers.js`.

### Invoking commands hidden from the palette

Many commands are gated by a `when` clause in `desktop.package.json` so they
**don't appear in the palette** in the test's default state. Two flavors:
`"when": "false"` (never in the palette — tree-view inline actions or webview
buttons), and a **state clause** like `"when": "gitlab:validState"` (hidden until a
GitLab-linked repo is open). Both are unreachable via the palette in a bare test
workspace. For these:

- `workbench.executeCommand('Approve Merge Request')` will **not** find them.
- For tree-view actions (`"when": "false"`), the handler usually takes a **tree-item
  model** argument (e.g. `MrItemModel` with `mr` and `projectInRepository`), so you
  can't meaningfully fire them with `vscode.commands.executeCommand(id)` either —
  you'd have to construct that model, which isn't available to the test harness.
  State-gated commands (e.g. `gl.refreshSidebar`) usually take no argument, but are
  still hidden from the palette in a bare workspace.
- To assert such a command is **wired in**, check it is registered (when-clauses
  affect UI visibility, not registration) — this works for both flavors:
  ```js
  const commands = await browser.executeWorkbench(vscode => vscode.commands.getCommands(true));
  expect(commands).toContain('gl.approveMergeRequest');
  ```
- To exercise the real action, drive the **UI surface**: open the GitLab view /
  webview and click the inline action / button — but that needs the right GitLab
  state (next section).

### What cannot be tested deterministically here

- **No workspace folder is opened by default.** The GitLab tree view
  (`issuesAndMrs`) only populates when the open folder is a git repo linked to a
  GitLab project. Specs that need a repo must open one (`openFolder`) — and even
  then the GitLab data must exist.
  ⚠️ **Opening a folder at runtime reloads the dev-host window and disables the
  extension** ("All installed extensions are temporarily disabled"). After an
  `openFolder`/`vscode.openFolder` the extension is gone, so anything that depends
  on it (commands, webviews) won't be there on the next step. If a spec needs to
  start _inside_ a workspace, **launch VS Code already pointed at it** instead of
  opening it at runtime — set `workspacePath` in `wdio.conf.js`:
  ```js
  // capabilities[].['wdio:vscodeOptions']
  extensionPath: path.join(dirname, '../../dist-desktop'),
  workspacePath: MY_WORKSPACE_DIR, // pre-created dir; no reload, extension stays enabled
  ```
  (`open_tab_in_background.e2e.js` sidesteps this by opening a single `/tmp` file,
  never a folder — that does not reload the window.)
- **Actions requiring specific live GitLab state.** Example: approving a merge
  request needs a workspace repo linked to a project _and_ an MR the test user is
  allowed to approve (GitLab blocks self-approval). This suite does not provision
  such fixtures, so the click-through cannot be made deterministic against
  gitlab.com. Cover the wiring (command registered, view renders) and leave the
  live action to manual testing, documenting the gap in the spec.

### Conventions to match

- One feature area per spec file, named `<feature>.e2e.js`.
- Extract multi-step interactions into named, JSDoc-commented helpers; keep `it`
  blocks readable as a user flow.
- Generate unique filenames with `generateRandomString()` to avoid cross-test
  collisions (see `createFile`).

## 6. Recordings

Recording is **opt-in via `E2E_RECORD=1`** (no file edits — `wdio.conf.js` is shared
with CI, whose committed default is failure-only videos). **Proactively offer it**;
record only if the user agrees:

```bash
E2E_RECORD=1 E2E_DUO_AGENT=1 TEST_GITLAB_TOKEN=<PAT> npm run test:e2e -- --spec specs/duo_workflow.e2e.js
```

The crisp-1080p pipeline is already wired in (`forceDeviceScaleFactor: 1`,
`videoScale: '1920:-2'`, and a `reencodeCrispVideos()` `onComplete` hook that emits
`<test-name>-…-crisp.mp4` at `-crf 16`). You only need to:

- **Put visible interactions in the `it` block.** The reporter screenshots one frame
  per WebdriverIO command _during the test body only_ — work done in `before`/`after`
  or pure `executeWorkbench` API calls produces a near-blank video. Add a real UI
  action (open a view, open the created file) so there's something to film.
- **Call `resizeVSCodeWindow(1920, 1080)` first thing in the `it` block**, before
  switching into any webview iframe (from `helpers/duo_workflow_helpers.js`; it uses
  `window.resizeTo` because `setWindowSize` fails on the Electron session and
  `--window-size` is ignored on macOS).

Then **share the `file://` link to the `-crisp.mp4`** (resolve the absolute path from
`test/e2e/`). Sanity-check first: a frame should be 1920×1080 and sharp, and the
frame dir (`wdio-logs/.video-reporter-screenshots/<test-name>-…/`) should hold dozens
of PNGs, not ~2. All output dirs are gitignored, so nothing needs reverting.

After sharing, **offer to clean up** any throwaway spec you created just to verify
(keep it if it's a real test worth committing — ask).

## 7. Debug failures

1. Re-read the `timeoutMsg` from the failing `waitUntil`/assertion — it usually
   names the missing state.
2. **Allure report** at `test/e2e/allure-report/` (single-file HTML, built in the
   `onComplete` hook). On CI it's a job artifact for 10 days.
3. **Failure videos**: by default only on a retry; raw videos in
   `test/e2e/allure-results/`. A screenshot is taken on every failing test
   (`afterTest` hook). See Section 6 to force-capture.
4. **WebdriverIO logs**: `test/e2e/wdio-logs/`. Raise verbosity with
   `E2E_LOG_LEVEL=debug` (or `trace`).
5. **Inspect the DOM live**: in the launched VS Code, `Help → Toggle Developer
Tools → Elements`; use the element picker to locate items nested under iframes,
   then craft selectors (README "Working with the VSCode DOM").
6. **Flake vs. real failure**: AI features are rate-limited (`ai_action` 160/8h,
   `code_suggestions_api_endpoint` 60/min). Failures right after many runs are
   likely rate limits — retry later or with a different token. Compare against the
   latest `main` pipeline to rule out upstream breakage.

## 8. Special cases

- **GitLab Duo Agent Platform / agentic chat** (`duo_workflow.e2e.js`) drives a
  real Duo session that **edits files in the workspace**. It's gated to internal
  GitLab members and is flaky — so it's **opt-in via the `E2E_DUO_AGENT=1` flag**
  and skipped otherwise. Run it with **one command, no config editing**:
  ```bash
  E2E_DUO_AGENT=1 TEST_GITLAB_TOKEN=<PAT> npm run test:e2e -- --spec specs/duo_workflow.e2e.js
  ```
  `E2E_DUO_AGENT` makes `wdio.conf.js` launch VS Code already pointed at a
  freshly `git init`-ed workspace (`.tmp-duo-agent-workspace/`, gitignored) with
  a `gitlab.com` remote for project context and the Duo settings
  (`editFileDiffBehavior: 'background'`, a `defaultNamespace`). When the flag is
  unset, the config and the spec (`describe.skip`) are inert, so the rest of the
  suite is unaffected. The PAT must have Duo Agent Platform access.
  - **How the spec works (template for new agentic checks):** (if recording, call
    `resizeVSCodeWindow(1920, 1080)` first — see Section 6), open the panel via
    `openAgentPlatformChat()` (executes `Gitlab: Show Duo Agent Platform`, opens
    the webview, and switches into the chat iframe), then `sendAgentChatPrompt(…)`,
    then **`waitUntil` the file appears on disk** with `fs` (the spec runs in Node)
    — far more reliable than scraping the chat DOM. Tell the agent "create the file
    now without asking for confirmation". To also show the result on screen, switch
    out of the iframe (`switchToFrame(null)`) and open the file in the editor.
  - **Webview internals (if selectors drift):** the panel is the **LSP-served
    agentic chat in nested iframes (depth 2)** — switch `top iframe[0]` →
    `inner iframe[0]` (done by `openAgentPlatformChat`). Current selectors:
    `[data-testid="chat-prompt-input"]` (textarea),
    `[data-testid="chat-prompt-submit-button"]`, `project-selector-dropdown`. The
    old `workflow-task-textarea` / `start-workflow-button` testids were a removed
    UI. To rediscover ids, dump them once after entering the inner frame:
    `await browser.execute(() => Array.from(document.querySelectorAll('[data-testid]')).map(e => e.dataset.testid))`.
- **AI features** require the PAT to have access to the corresponding GitLab Duo
  features.

## Worked examples

Read these merged specs as templates for the common patterns:

- **`test/e2e/specs/authorization.e2e.js`** — the simplest end-to-end flow: invoke
  a command, drive the resulting prompt, assert on the notification. Also shows the
  secret-masking pattern (`withLoggerAtError`) and helper reuse via `beforeEach`.
  Good starting point for "drive a command and check a user-visible result".
- **`test/e2e/specs/open_tab_in_background.e2e.js`** — the `executeWorkbench`
  VS Code-API pattern: set up editor state inside the extension host, pass params
  in, then assert on rendered editor tabs. No auth needed. Use this when the thing
  you need to set up or inspect isn't reachable through the command palette.

For a palette-hidden command (tree-view/webview action), assert registration via
`vscode.commands.getCommands(true)` or drive the UI surface directly — see Section 5
("Invoking commands hidden from the palette").

## Reference files

- `test/e2e/README.md` — canonical setup/run/debug instructions.
- `docs/developer/testing-strategy.md` — where E2E sits vs. unit/integration.
- `test/e2e/wdio.conf.js` — config, env vars, reporters, hooks.
- `test/e2e/specs/*.e2e.js` — worked examples (command, webview, editor, AI flows).
- `test/e2e/helpers/` — reusable steps; export new ones via `helpers/index.js`.
