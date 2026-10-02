# BPM Builder Prototype — source

See `../README.md` for what this is, the demo script, and next steps.

```bash
pnpm install            # node_modules here is only links into pnpm's global store (OneDrive-safe)
pnpm dev                # http://localhost:5180
pnpm test               # engine unit tests
pnpm typecheck
pnpm build:standalone   # single self-contained HTML in dist-standalone/index.html
```

Layout:

- `src/model` — design-time types, rules evaluation, linked-list helpers, sample apps
- `src/engine` — simulated process engine (routing, distribution, actions, admin ops, read model) + tests
- `src/store` — Zustand stores: design (persisted), UI, simulation loop
- `src/components` — UI kit, generated form renderer, app shell
- `src/features/*` — screens: workflow designer, object types, lists, people & security, monitor, object drawer
