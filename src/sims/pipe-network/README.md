# Pipe network

A spanning tree of pipe tiles is scrambled by rotation, then solved by turning those tiles back into one leak-free network.

## Decisions

- The tree is a shuffled Kruskal spanning tree. A uniformly chosen source cell is kept for generation and connectivity checks, and it is not drawn. Generation and the scramble run before the first solve step. A grid that needs more than a short slice keeps a Building progress bar and yields, so the page stays responsive.
- Each tile is stored in a canonical orientation (the rotation with the smallest opening mask). The generated tree is a turn away from that, so a solver that tries low rotations first is not handed the answer. Any leak-free connected completion counts, not just that tree.
- Scramble picks uniformly among visually distinct turns. Crosses do not spin. Straights have two turns, everything else four.
- The solver prunes a rotation when it disagrees with every rotation a neighbor can still take, and it rejects two dead ends facing each other on a board larger than two cells. After each fixpoint it rejects cycles and sealed islands in the decided tiles, then guesses the tile with the fewest remaining turns. The same seed repeats the same decisions.
- One `step` is one visible event: a lock, an unlock, a turn onto a remaining orientation, or a recolor. Search between those events sets `computing`. A turn of three quarter-steps animates as one quarter the other way. A rotation holds the clock for a full step. A recolor with no rotation holds it for half a step (`span: 0.5` on the status). The run ends when the last tile locks.
- The sparkline is the leak count of the committed board. Every tile starts as dark iron. Once the solver eliminates a turn and more than one remains, the tile turns dusty blue, spinning onto a remaining turn when the one on screen was eliminated. A tile forced down to one rotation is a soft mint. A guess still being tried is brass. The same seed repeats those displayed turns.
- Pipes are Canvas 2D. One unit is a sixteenth of a cell: the channel is 3 units wide and each wall is 1. The channel is a darker shade of the wall color. Turns inside a cell are circular arcs, and a dead end closes with a semicircle. The end that meets a neighbor stays flat. The top bar is `host.transport()`.
