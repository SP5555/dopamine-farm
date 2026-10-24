# Simulations

For the agent who adds or changes a simulation. The shell is [src/harness/README.md](../harness/README.md).

## Add a simulation

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
        return { done: radius >= target };
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
| `SimHost`, `BarPiece`, `WorldCard` | The host, a bar piece, and a frame pinned on the world. |
| `ParamSchema`, `Params`, `SelectOption`, `UnavailableChoice` | Param definitions, when you want them named. |
| `SimChrome` | Turns Config or the shell seed off. |
| `createRng`, `randomSeed` | A seeded stream, and a roll when the sim owns the seed. |

## Bars

The same pieces can go in either bar. Both bars start empty. `toolbar()` is the top bar. `row` and `aside` on `getStatus()` are the two sides of the footer. Add a piece only when this sim has something to put there. Sims differ a lot: some are played step by step, and some are not. A bar with nothing to show stays blank.

A piece is a `button`, `slider`, `select`, `label`, `progress`, `readout`, or `metric`. A button, slider, or dropdown handles its own click or change. The others are only display. `progress` uses `null` for the indeterminate bar. A `metric` is a number plus a sparkline.

```ts
toolbar: () => [
  { type: 'button', id: 'nudge', label: 'Nudge', onClick: () => { radius += 1 } },
]
```

```ts
row: [
  { type: 'label', id: 'phase', text: 'Growing' },
  { type: 'progress', id: 'progress', value: 0.4 },
],
aside: [{ type: 'metric', id: 'radius', label: 'Radius', value: radius }],
```

`row` is the left side of the footer and `aside` is the right side. `note` is the line underneath. `banner` is the title of the done banner. Leave any of these out and that part stays blank. A metric's sparkline is one trace for its id, its label, and its `series`. Change the label, or set `series` to a new string, to start a fresh line. The trace keeps the latest 600 samples.

`done` and `computing` ride along on `getStatus()`. They drive the run. They are not pieces, and neither bar has them unless you add pieces of your own.

`host` is the second argument of `create`. It can pause, step, replay the current seed, roll a new run, set the speed, turn auto-restart on, and pin a card on the world. `host.transport()` bundles play, step, replay, restart, speed, and auto-restart for a sim that is played back. Take the whole list, keep a few pieces, or skip it. A sim that does not play step by step leaves it out.

```ts
toolbar: () => host.transport().filter((piece) => piece.id === 'play' || piece.id === 'speed')
```

Omitting `toolbar()` leaves the top bar empty. The shell shows the seed there, and the address is the path: the sim id, the seed, and any param that differs from its default. Opening that address again plays the same run. `chrome: { seed: false }` means the sim owns the seed. The shell hides it, leaves it out of the address, and calls `reset` with no seed. Roll one inside the sim with `randomSeed()` if you need one. An old `#/id` link still opens, and the shell rewrites it to the path. When a speed piece is shown, its slider maps 0–1000 onto 0.5–240 steps per second, and a fresh page starts at 8. Switching to another sim starts at 8 again. Replay and Restart keep the speed set for this one.

A button may set `pressed: true`. Add `toggle: true` for the highlighted pressed style. `shortcut` adds a key and a hint. The hint line joins every shortcut from both bars. `repeat: true` keeps firing while the key is held.

## A card on the world

`host.card()` pins a frame on the world. The shell draws that frame. The sim fills the body: a grid, a second canvas, a button, whatever the run needs.

```ts
const card = host.card({ corner: 'bottom-right', caption: 'Counts' });
card.body.append(list);
```

`corner` is `top-left`, `top-right`, `bottom-left`, or `bottom-right`. Leave it off for the bottom-right. Leave `caption` off and there is no line. `setCaption` changes the line later. Call `card()` from `create`, and call `card.dispose()` from `dispose`. Leaving the sim drops a card that is still up. More than one card is fine.

A panel already pinned with `canvas-card` moves its contents into `body` and drops that class from the outer node. The shell draws the frame.

## Long runs

One visible event per `step`. Hold that event as pending and draw it with `alpha`, from 0 up to 1, until `step` commits it. The pulse sample above does this for the next ring: the committed radius plus `alpha` is what is on screen. `span` is how many speed ticks that event lasts. `0.5` commits halfway through a step. `3` holds the clock for three steps, and `alpha` still runs from 0 to 1 across all three. Omit it for one step. A value that is not finite, not positive, or above 8 counts as one step.

Set `computing` while the step has nothing to draw yet, such as a search between two visible events. The shell then runs a burst of about 12ms, at most 500 steps, and draws with `alpha` 0. The search does not freeze the page, and it does not play an empty step. `span` is ignored while `computing` is set.

After `done`, the shell keeps calling `render` every frame, and `alpha` stays 0. A flourish can finish on wall-clock time. The run does not step again.

`reset` must return in a few milliseconds. Mount calls it before the loop starts, and a restart paints `render(0)` in the same turn so the old frame does not linger. A loading bar for slow setup is a later phase: `computing: true`, a `progress` piece, and `step` advances it. Work left inside `reset` cannot show that bar, because the bar paints only after `reset` returns.

## The clock

`render` runs on every frame the monitor paints. How often `step` runs is the part you choose.

Leave `pace` off for one event per step. `step` runs at the speed slider, from 0.5 to 240 times per wall second, starting at 8. Draw the event in progress with `alpha`, from 0 up to 1. A faster monitor paints that in-between more often. It does not add steps.

For a fixed rate, such as 60 a second, stay on that clock and call `host.setSpeed(60)`. Each `step` is one slice of your own size. `alpha` is still the in-between, so the picture follows the monitor. A speed piece in the toolbar lets the viewer move that rate. Leave it out and the rate stays where `setSpeed` put it.

`chrome: { pace: 'frame' }` steps once per painted frame. `step(dt)` receives the seconds since the previous frame, scaled so the default speed is realtime. Integrate `dt`. A faster monitor passes a smaller `dt` and covers the same world time per wall second. `alpha` stays 0 and `span` is ignored. The speed slider becomes a time scale, and 8 reads as 1×.

```ts
chrome: { pace: 'frame' },
step(dt = 0) {
  angle += turnRate * dt;
},
render() {
  // Draw `angle`. This clock keeps alpha at 0.
},
```

A gap longer than a quarter of a second is cut off there, on either clock.

## Shell slots

Config is on when `params` has at least one key. `chrome: { params: false }` hides it anyway. `chrome: { seed: false }` leaves the seed to the sim. `reset` then receives no seed. `chrome: { pace: 'frame' }` is the display-rate clock above.

## Params

Each entry is a `number`, a `boolean`, or a `select`.

- `reset: true` restarts the run when the value changes. Leave it off and read the new value in `setParams(changed, all)`. `changed` is only the key that moved. `all` is the whole bag.
- `when(params)` hides the control. The value stays part of the run.
- `group: 'Name'` puts every control with that title in one folder.
- `detail` is the hover text for that control.
- On a select, `options` is `{ value, label, detail? }[]`. `detail` is the one-line hover text for that choice.
- `available(option, params)` returns `true` to keep a choice selectable. A string, or `{ note, detail }`, keeps it in the list but grayed out. `note` is appended to the label.

`normalize(params)` may rewrite the bag before a run starts and after each edit. Use it when one setting makes another illegal. The panel shows the bag after that rewrite.

## When the shell gets in the way

The shell is one contract for every simulation. A change to it applies to all of them, in the same way. It does not grow a special case for one sim.

When that contract is genuinely in the way, write it down. A person carries the note to the harness, and the harness changes the rule from that note. Put the note at `docs/harness-friction-<id>.md`. The harness replies at `docs/harness-reply-<id>.md`. Read that, then update the sim. The harness does not edit the sim.

Write one when you cannot do what the sim is for without fighting the rule, and the fix is a rule every sim could live under. Skip it when the sim can follow the contract, when you want a private exception, or when you are describing a need some other sim might have later.

Say four things, and no more than that:

- What you were doing.
- What the contract does that blocks it.
- What you did instead, if the sim had to ship anyway.
- The rule you want instead. Name the behavior every sim would get. Leave your sim out of that sentence.

One problem per request. When the sim no longer needs the change, including because you found a way to follow the contract, say there is nothing to do. An old complaint should not be built by mistake.
