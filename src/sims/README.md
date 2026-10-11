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
          phase: done ? 'Filled' : 'Growing',
          progress: target === 0 ? 1 : radius / target,
          done,
          metric: { label: 'Radius', value: radius },
        };
      },
      dispose() {},
    };
  },
};
```

`reset(params, seed)` starts a run. `step` advances one unit. `render(alpha)` draws the frame, with `alpha` from 0 up to 1 as the unit in progress. `getStatus` reports where the run is. `dispose` drops timers, listeners, and GL resources. Each visit gets a new canvas.

## Imports

Import from `src/harness/author.ts`.

| Export | Use |
| --- | --- |
| `SimModule`, `SimMeta`, `SimContext`, `SimStatus`, `SimInstance` | The types for `meta` and `sim`. |
| `SimHost`, `ToolbarControl`, `StatusPiece` | The toolbar controls and the footer pieces. |
| `ParamSchema`, `Params`, `SelectOption`, `UnavailableChoice` | Param definitions, when you want them named. |
| `SimChrome` | Hides Config. |
| `createRng` | A seeded random stream. `reset` receives the seed. |

## Toolbar

`toolbar()` returns the controls for this sim, in order. An empty list, or no method, leaves the toolbar blank. Each control handles its own click, input, or change. `shortcut` puts a key on that control and adds it to the hint line.

```ts
toolbar: () => [
  {
    type: 'button',
    id: 'play',
    label: host.paused ? 'Play' : 'Pause',
    shortcut: { key: ' ', hint: 'Space play/pause' },
    onClick: () => host.togglePaused(),
  },
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
  {
    type: 'select',
    id: 'mode',
    label: 'Mode',
    value: 'slow',
    options: [
      { value: 'slow', label: 'Slow' },
      { value: 'fast', label: 'Fast' },
    ],
    onChange: (value) => {
      mode = value;
    },
  },
],
```

`host` is the second argument of `create`. It can pause, step, restart, set the speed, and turn auto-restart on. A sim that never calls those leaves them unused.

A button may set `pressed: true`. Add `toggle: true` for the highlighted pressed style. A shortcut may set `repeat: true` so holding the key keeps firing.

## Status

`getStatus()` describes the footer. `row` is the left side, `aside` is the right side, `note` is the line underneath, and `banner` is the title of the done banner. Leave a list out and that part stays blank. `done` and `computing` are how the run is driven. They are not widgets.

```ts
row: [
  { type: 'label', id: 'phase', text: 'Growing' },
  { type: 'progress', id: 'progress', value: 0.4 }, // null is the indeterminate bar
  { type: 'readout', id: 'left', label: 'left', value: '12s' },
  { type: 'metric', id: 'radius', label: 'Radius', value: 3 }, // number plus a sparkline
],
aside: [{ type: 'readout', id: 'rings', label: 'rings', value: '4' }],
```

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
