# @throughline/studio

The browser app: **Studio** (design, administer, monitor, what-if) and **Workspace** (do the
work as any person in the sample organization). Runs entirely in the browser on the
`@throughline/core` engine with a simulated organization; designs are saved in the browser.

```bash
pnpm dev                  # from the repo root: http://localhost:5180
pnpm build:standalone     # one self-contained HTML file in apps/studio/dist-standalone/
```

`src/features/*` holds one folder per screen; `src/store` holds the design, UI and simulation
stores; `src/components` the UI kit and the form renderer generated from object types.
