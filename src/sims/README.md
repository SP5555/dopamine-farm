# Add a simulation

Create `src/sims/<id>/meta.ts` and `src/sims/<id>/index.ts`. The nav picks up `meta.ts` on its own, and `index.ts` loads when that sim is opened.

```ts
// src/sims/pulse/meta.ts
export const meta = {
  id: 'pulse',
  title: 'Pulse',
  description: 'A circle that grows until it fills the frame.',
};
```

```ts
// src/sims/pulse/index.ts
import { createRng, type SimModule } from '../../harness/author';

export const sim: SimModule = {
  params: {
    rings: {
      type: 'number',
      label: 'Rings',
      default: 4,
      min: 1,
      max: 12,
      step: 1,
      reset: true,
    },
  },
  create(ctx) {
    let radius = 0;
    let target = 4;
    const context = ctx.canvas.getContext('2d')!;
    return {
      reset(params, seed) {
        target = Number(params.rings);
        radius = createRng(seed).int(3);
      },
      step() {
        if (radius < target) radius += 1;
      },
      render(alpha) {
        const shown = radius + (radius < target ? alpha : 0);
        context.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
        context.clearRect(0, 0, ctx.width, ctx.height);
        context.strokeStyle = '#e0a45a';
        context.beginPath();
        context.arc(ctx.width / 2, ctx.height / 2, 20 + shown * 16, 0, Math.PI * 2);
        context.stroke();
      },
      getStatus() {
        const done = radius >= target;
        return {
          done,
          row: [
            { type: 'label', id: 'phase', text: done ? 'Filled' : 'Growing' },
            { type: 'progress', id: 'progress', value: target === 0 ? 1 : radius / target },
            { type: 'metric', id: 'radius', label: 'Radius', value: radius },
          ],
        };
      },
      dispose() {},
    };
  },
};
```

`reset(params, seed)` starts a run. It must return quickly. `step` advances one unit. `render(alpha)` draws the frame, with `alpha` from 0 up to 1 as the unit in progress. `getStatus` reports where the run is. `dispose` drops timers, listeners, and GL resources. Each visit gets a new canvas.

`order` on `meta` is the nav position. Lower comes first, and the first sim is what opens when the address has no id. Leave it off and the sim sorts after every numbered one, then by title.

## Imports

Import from `src/harness/author.ts`.

| Export | Use |
| --- | --- |
| `SimModule`, `SimMeta`, `SimContext`, `SimStatus`, `SimInstance` | The types for `meta` and `sim`. |
| `SimHost`, `BarPiece` | The host, and a piece either bar can show. |
| `ParamSchema`, `Params`, `SelectOption`, `UnavailableChoice` | Param definitions, when you want them named. |
| `SimChrome` | Hides Config. |
| `createRng` | A seeded random stream. `reset` receives the seed. |

## Bars

The same pieces go in either bar. `toolbar()` fills the top bar. `getStatus()` fills the footer, and also reports the run. An empty list, or no `toolbar`, leaves that bar blank.

A piece is a `button`, `slider`, `select`, `label`, `progress`, `readout`, or `metric`. A button, slider, or dropdown handles its own click or change. The others are only display. `progress` uses `null` for the indeterminate bar. A `metric` is a number plus a sparkline.

```ts
toolbar: () => [
  {
    type: 'button',
    id: 'play',
    label: host.paused ? 'Play' : 'Pause',
    shortcut: { key: ' ', hint: 'Space play/pause' },
    onClick: () => host.togglePaused(),
  },
  { type: 'readout', id: 'radius', label: 'Radius', value: String(radius) },
  {
    type: 'slider',
    id: 'speed',
    label: 'Speed',
    min: 0,
    max: 100,
    step: 1,
    value: 40,
    text: '40',
    onChange: (value) => host.setSpeed(value),
  },
],
```

```ts
row: [
  { type: 'label', id: 'phase', text: 'Growing' },
  { type: 'progress', id: 'progress', value: 0.4 },
  {
    type: 'button',
    id: 'nudge',
    label: 'Nudge',
    onClick: () => {
      radius += 1;
    },
  },
],
aside: [{ type: 'metric', id: 'radius', label: 'Radius', value: radius }],
```

`row` is the left side of the footer and `aside` is the right side. `note` is the line underneath. `banner` is the title of the done banner. Leave a list out and that part stays blank.

`done` and `computing` ride along on `getStatus()`. They drive the run. They are not pieces, and the top bar does not have them.

`host` is the second argument of `create`. It can pause, step, replay the current seed, roll a new run, set the speed, and turn auto-restart on. `host.transport()` is the shared play, step, replay, restart, speed, and auto-restart pieces. Spread it into `toolbar()` and add your own:

```ts
toolbar: () => [...host.transport(), { type: 'readout', id: 'radius', label: 'Radius', value: String(radius) }],
```

A sim that never calls those leaves them unused. Omitting `toolbar()` still leaves the top bar empty. The shell shows the seed there either way. The speed slider maps 0–1000 onto 0.5–240 steps per second, and a fresh page starts at 8. Switching to another sim starts at 8 again. Replay and Restart keep the speed set for this one.

A button may set `pressed: true`. Add `toggle: true` for the highlighted pressed style. `shortcut` adds a key and a hint. The hint line joins every shortcut from both bars. `repeat: true` keeps firing while the key is held.

## Long runs

One visible event per `step`. Hold that event as pending and draw it with `alpha`, from 0 up to 1, until `step` commits it. The pulse sample above does this for the next ring: the committed radius plus `alpha` is what is on screen. `span` on the status shortens that wait: `0.5` commits halfway through a step, and `alpha` still covers the whole event. Omit it for a full step.

Set `computing` while the step has nothing to draw yet, such as a search between two visible events. The shell then runs a burst of about 12ms, at most 500 steps, and draws with `alpha` 0. The search does not freeze the page, and it does not play an empty slide.

`reset` must return in a few milliseconds. Mount calls it before the loop starts, and a restart paints `render(0)` in the same turn so the old frame does not linger. A loading bar for slow setup is a later phase: `computing: true`, a `progress` piece, and `step` advances it. Work left inside `reset` cannot show that bar, because the bar paints only after `reset` returns.

## Shell slots

Config is on when `params` has at least one key. `chrome: { params: false }` hides it anyway.

## Params

Each entry is a `number`, a `boolean`, or a `select`.

- `reset: true` restarts the run when the value changes. Leave it off and read the new value in `setParams(changed, all)`. `changed` is only the key that moved. `all` is the whole bag.
- `when(params)` hides the control. The value stays part of the run.
- `group: 'Name'` puts every control with that title in one folder.
- On a select, `options` is `{ value, label, detail? }[]`. `detail` is the one-line hover text.
- `available(option, params)` returns `true` to keep a choice selectable. A string, or `{ note, detail }`, keeps it in the list but grayed out. `note` is appended to the label.

`normalize(params)` may rewrite the bag before a run starts and after each edit. Use it when one setting makes another illegal.
