# Proof by Intimidation

A starting expression is rewritten, one true identity at a time, until it is large enough to stare at. Solve reads the formula on screen and peels one identity that is still there, until the start is showing again.

## Choices

The bar has four moves and Reset view. Obfuscate adds one identity. Grow to size keeps adding until the expression reaches the size. Solve peels one identity that the formula still has, chosen at random. Solve all peels until the start is showing again. Click the running button again to stop after the step on screen.

Obfuscate and Solve do not remember the previous step. Each one looks at the formula and picks a piece. Alternating them is a random back and forth. A leaf near the root is much more likely than a leaf buried deep, so the expression spreads out instead of growing one long branch. Nothing about the shape is stored ahead of time. A minus is not placed on something that already starts with a minus, so `--(inf+0)` does not show up.

There is no play, step, replay, restart, or speed control. The sim runs at 1 step a second, slow enough to read a rewrite. Changing start, size, or flavor rolls a new seed and returns to the start, paused.

Start is 1, 0, 2, e, π, ln 2, or 1/2. The default is 1. The size slider defaults to 100 nodes and stops there. Flavor limits which identities are allowed: everything, trig and hyperbolic, calculus, series and combinatorics, or complex and exotic. The plain rewrites, such as adding zero, stay available in every flavor. A pass at the default is a few dozen steps each way. Typesetting and the numeric check get heavy past that, so the slider does not go further.

A rewrite can match a shape, not only a bare number. A sine can become a shifted cosine, a square can become the other square in an identity, an exponential can become cosh plus sinh, and a binomial can split by Pascal's rule or swap its lower index. That is what keeps a flavor changing after the original number is gone.

A small tree of the expression stays in the corner, in the shell's card, colored by kind. The piece about to change is drawn larger. Scroll and drag move that map, and its Reset button puts it back. Pointing at a node marks the same piece in the formula.

The seed stays inside the run. It is not shown, and it is not in the address. Opening the page, or changing start, size, or flavor, rolls a new one.

Solve never looks up how a piece was written. A pattern comes off only when the formula still has that identity's shape. A rule that uses a subexpression twice, such as sin² A + cos² A, comes off only when both copies still agree. If one copy has been rewritten and the other has not, that identity stays, and the solver peels whatever is still recognizable on its own. A full pass still returns to the exact start.

Integrals that do not use the variable of an outer integral or sum are computed once per check. New integrals come from constant identities, so they do not depend on an outer bound variable. Infinite sums use 40 terms. A fast series stays inside the badge. Leibniz, Basel, and the alternating harmonic series are included anyway, and their tails can miss the badge. The limit at infinity is read at a large finite stand-in.

The formula is HTML beside the canvas, typeset with KaTeX. `step` only edits the tree. `render` typesets when the expression on screen changes, and it drives the highlight and the slide from `alpha`. The piece about to change turns red. The result starts red and fades back to the normal color, whether the step obfuscates or solves. Motion is FLIP. Reduced motion swaps instead of sliding.

Pan and zoom use the pointer, on the formula and on the tree. Reset view eases both back into the frame. The tree's own Reset does the same for the map.
