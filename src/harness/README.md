# Harness

For the agent who changes the shell. Simulations follow [src/sims/README.md](../sims/README.md).

The shell loads a sim, steps the clock, and owns the bars, the address, and the seed. Every sim lives under one contract. A change applies to all of them the same way.

## A note from a sim

An implementor who is blocked writes `docs/harness-friction-<id>.md`, in the shape described under [When the shell gets in the way](../sims/README.md#when-the-shell-gets-in-the-way). That file is brought to you. Read it, then decide.

Land the change when the sim cannot do its job under the current rule, and the replacement is a rule every sim can live under.

Leave the contract alone when the request is a private exception, a workaround dressed up as an API, or a rule that would break a sim that already follows the contract. Say so in the reply. An unclear note is a question, not a change. If the note says there is nothing to do, do nothing.

Ask for a call when the note is choosing what every sim should do. Decide for yourself how the contract carries that behavior out.

## The reply

Write `docs/harness-reply-<id>.md`. One problem from the note, one decision. A note that bundles several problems gets an answer for each.

Say what changed and how a sim uses it. Say what you left and why. Update [src/sims/README.md](../sims/README.md) when the contract changed, so the next sim follows the new rule. Leave the requesting sim's code alone. Its author picks up the reply.
