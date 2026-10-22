# Proof by Intimidation

A number is rewritten, one true identity at a time, until the expression is large enough to stare at. Solve peels those identities back off, in a random legal order, until the same number is showing.

## Choices

The bar has four moves and Reset view. Obfuscate adds one identity. Grow to size keeps adding until the expression reaches the size. Solve peels one identity, chosen at random from the pieces nothing else is wrapped around. Solve all peels until the starting number is showing again. Click the running button again to stop after the step on screen.

A new identity usually lands outside the piece the previous step rewrote, so several parts of the expression stay open at once. Nothing about the shape is stored ahead of time. The seed decides each choice as it happens. A minus is not placed on something that already starts with a minus, so `--(inf+0)` does not show up.

There is no play, step, replay, restart, or speed control. The sim runs at 1 step a second, slow enough to read a rewrite. Changing start, size, or flavor rolls a new seed and returns to the starting number, paused.

Start is 1 or 0. The default is 1. The size slider defaults to 120 nodes and stops there. Flavor limits which identities are allowed: everything, trig and hyperbolic, calculus, series and combinatorics, or complex and exotic. The plain rewrites, such as adding zero, stay available in every flavor. A pass at the default is a few dozen steps each way. Typesetting and the numeric check get heavy past that, so the slider does not go further.

A small tree of the expression stays in the corner, in the shell's card, colored by kind. The piece about to change is drawn larger. Scroll and drag move that map, and its Reset button puts it back. Pointing at a node marks the same piece in the formula.

The seed in the bar is the shell seed. There is no second one. The same seed and the same start, size, and flavor repeat the same rewrites.

Collapse never restores a stale copy of a subexpression that later steps have rewritten. A wrapper records the piece it wrapped. Peeling it puts back whatever is there now. A constant identity records the whole replacement, and it can collapse only when no later step still sits inside it. The latest step with nothing inside it is always available, so the expression returns to the exact starting number.

Integrals that do not use the variable of an outer integral or sum are computed once per check. New integrals come from constant identities, so they do not depend on an outer bound variable. Infinite sums use 40 terms. The geometric series is the only infinite one, and its tail is far inside the badge tolerance.

The formula is HTML beside the canvas, typeset with KaTeX. `step` only edits the tree. `render` typesets when the expression on screen changes, and it drives the highlight and the slide from `alpha`. The piece about to change turns red. The result starts red and fades back to the normal color, whether the step obfuscates or solves. Motion is FLIP. Reduced motion swaps instead of sliding.

Pan and zoom use the pointer, on the formula and on the tree. Reset view eases both back into the frame. The tree's own Reset does the same for the map.
