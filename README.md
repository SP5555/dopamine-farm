# Dopamine Farm

A gallery of idle simulations. The app is the shell: adding a simulation is a new folder, not a change to that shell.

## Run

```bash
npm install
npm run dev
```

Other scripts:

- `npm run build` typechecks and builds
- `npm run preview` serves the production build
- `npm test` runs the unit tests once
- `npm run test:watch` keeps Vitest open
- `npm run typecheck`

There is no backend. The page does not fetch assets, fonts, or data at runtime.

## Watch

Open a simulation at `/{id}`. Once a run exists, the address keeps `seed` and any setting that differs from that simulation's defaults, so a refresh repeats the run. Viewer state stays on this machine. It is not part of the address.

Keyboard shortcuts are the ones that simulation declares. They are ignored while a field is focused.

## Add a simulation

A simulation is a new folder. The shell does not change. [How to add one](src/sims/README.md) covers the two files, what a sim can import, and how it declares its own controls and footer.
