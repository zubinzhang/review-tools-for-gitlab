# Repository Guidelines

## Project Structure & Module Organization

This repository contains the GitLab for VS Code extension. Shared extension logic lives in
`src/common/`, desktop-only code in `src/desktop/`, and Web IDE implementations in `src/browser/`.
Keep shared code independent of platform-specific modules and Node.js/browser APIs; use the platform
abstractions described in `docs/developer/architecture.md`.

Vue webviews live in `webviews/vue2/` and `webviews/vue3/`. Extension assets are in `src/assets/`;
integration tests are in `test/integration/`, end-to-end tests in `test/e2e/`, build scripts in
`scripts/`, and contributor documentation in `docs/developer/`.

## Build, Test, and Development Commands

Use the Node.js version pinned in `mise/config.toml` and npm rather than Yarn.

- `npm install`: install dependencies and run repository setup hooks.
- `npm run watch:desktop`: rebuild the desktop extension continuously; press F5 in VS Code to debug.
- `npm run build:desktop` / `npm run build:browser`: build the respective extension targets.
- `npm run test:unit -- src/desktop/git/git_remote_parser.test.ts`: run a focused Jest test.
- `npm test`: run extension unit and VS Code integration tests.
- `npm run lint`: check ESLint, Prettier, and both webview projects.
- `npm run autofix`: clean build output and apply automated lint/format fixes; review the resulting diff.

## Coding Style & Naming Conventions

Use two-space indentation, final newlines, and no trailing whitespace. Prettier specifies single
quotes, trailing commas, and a 100-character print width. Follow ESLint and
`docs/developer/coding-guidelines.md`.

Prefer TypeScript `interface` declarations for object structures and `type` for aliases or derived
types. Utility files use `snake_case` names with one `camelCase` function per file; extract utilities
only when reuse justifies it.

## Testing Guidelines

Colocate Jest unit tests with production modules as `*.test.ts`. Integration tests use JavaScript,
Mocha, and a VS Code instance. Vue 2 webviews use Jest; Vue 3 uses Vitest. Run their tests separately
with `npm --prefix webviews/vue2 test` and `npm --prefix webviews/vue3 test -- --run`.

Add regression coverage and manually verify changed behavior. CI collects coverage with
`npm run test:unit -- --coverage`. For user-visible changes, follow
`.agents/skills/ui-feature-testing/SKILL.md` for end-to-end verification.

## Commit & Merge Request Guidelines

Use Conventional Commits, as in existing history: `fix: ...`, `feat: ...`, or `chore(deps): ...`.
Keep commit-message lines within 72 characters. Squashed MRs need a conventional title; otherwise,
every commit must comply.

Follow `.gitlab/merge_request_templates/Default.md`: describe changes, link an open issue with
`Resolves #123`, record testing and environment details, and include screenshots for UI changes.
Consider Web IDE compatibility when modifying shared/browser code and discuss large changes in an
issue first.
