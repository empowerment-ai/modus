# Contributing to Throughline

Thanks for helping. Throughline is early: the studio is a working prototype, the server is a
skeleton, and the [roadmap](docs/ROADMAP.md) lists what comes next.

## Set up

```bash
corepack enable            # or install pnpm 11
pnpm install
pnpm dev                   # studio at http://localhost:5180
pnpm test                  # engine + server tests
pnpm typecheck
```

## Where things live

- `packages/core` — the model and the engine. Pure TypeScript, no UI, no I/O, deterministic.
  Every behavior change here needs a test in `src/engine/engine.test.ts`.
- `apps/studio` — the React studio and Workspace. One folder per screen in `src/features`.
- `apps/server` — the engine live behind the API.
- `docs` — architecture, concepts, roadmap, demo script.

## Ground rules

- Keep the engine deterministic: no `Date.now()` or `Math.random()` in `packages/core`; use the
  simulation clock and the seeded generator in `engine/rng.ts`.
- The engine enforces rules (field security, who may act); the UI only reflects them.
- Plain language in the product. Standard terms belong in hints and docs.
- Match the surrounding style (Prettier settings in `.prettierrc`); format only files you change.
- Never commit secrets. Services reference credentials by name only.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
