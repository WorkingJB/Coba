# Gameplay direction

## The promise

“Read the other player, coordinate your side, and turn a small tactical victory into a meaningful contribution to your faction.” The first release slice tests the tactical half. A war map is valuable only if players want another match.

Keep hero identity, hidden simultaneous planning, three positional objectives, short sessions, and a persistent social identity. Reconsider the POC's numerical balance, territory buffs, card-access rewards, and assumption that 2v2 should have no meaningful in-match coordination.

## Implemented rules: frontier-1

- Two players choose Warden (durable presence) or Shade (removal plus seizure); mirror matches are allowed. Every hero has a fixed twelve-card deck.
- Three zones accumulate team presence. Each round allows one card, one selected target zone, and an optional free signature ability. Board-wide cards affect every zone, while an ability still uses the selected target.
- Start with four cards, including one playable Pathfinder. Draw one per resolved turn, to a hand cap of five. Exhausted draws reshuffle the discard using persisted PRNG state.
- Energy equals the turn number, capped at six, and refreshes each turn. Unspent energy does not carry over. Each ability is available again four turns after use.
- Plans are hidden and immutable after lock. Resolve immediately when both lock, otherwise after 30 seconds. Presence additions and removal aggregate simultaneously, clamped at zero, with no seat-order priority.
- At resolution, each zone with a strict presence lead awards its team one point; ties award neither side. First to 15 wins, evaluated after both teams score. If both reach the target, compare totals; equal totals draw. At turn 16, the higher total wins; equal totals draw.
- An absent player passes. Three consecutive missing submissions forfeit; an intentional pass counts as participation. If both teams abandon, draw. Reconnect can happen throughout a match using the same session cookie.

Fifteen points, sixteen turns, and the new card numbers are experimental, not inherited balance guarantees. Longest normal planning time is eight minutes; immediate locks shorten that. The history explains card/ability actions and zone point deltas. The UI shows numeric presence, control ownership, energy, cooldowns, and deadlines without relying solely on color.

## In development: frontier-2 (rules engine only)

`packages/game/src/frontier2` holds the next ruleset. It is covered by rules tests and a CI balance bench, but **nothing serves it yet**: the API, database and client still run frontier-1. Wiring it in needs the ruleset dispatcher described in the architecture record.

What changes, and why:

- **Spend energy across several cards.** Energy still equals the turn number (cap 6), but a plan may commit up to three cards, each to its own zone, plus the ability aimed separately. Draw two per turn to a hand cap of six. In frontier-1 the cap outgrew every card, so cost stopped mattering by turn four.
- **Reads inside the turn.** _Shield_ blocks removal in a zone this turn. _Ambush_ removes more where the enemy deployed a unit this turn. Deploying beats a shield, a strike beats a deployment, a shield beats a strike.
- **Securing.** Lead a zone three turns running and it is secured: two bonus points, then the zone clears for both teams. Surplus presence is lost, so winning by exactly enough matters.
- **Bounded boosts.** Amplify scales only what a team deploys in that zone that turn. Because presence is shared, a teammate's units are boosted too, which is the first real 2v2 combination.
- **Six commanders and four theaters**, re-themed for a hard-science-fiction setting and expressed entirely as data. Names are placeholders.
- **An event list per turn** (deploy, amplify, strike, control, secure) so a client can animate a resolution instead of diffing two snapshots.
- First to 16, twelve turns at most, 45-second planning window.

What the bench has and has not shown (bots, so direction only):

- Seat order is fair: team 0 wins about half of decisive games.
- Matches run about ten turns and nearly all end on the score target.
- **Bot win rate badly overstates imbalance.** Bots are so consistent that a one-point average edge in a 16-point game shows up as a 95% win rate. The bench therefore reports average score margin and treats win rate as a footnote. The POC's 90% matchups deserve the same caution.
- Carry-over is not what makes matchups lopsided. Halving presence every turn halved blowouts but also cut comebacks and lead changes by about a quarter, so presence stays permanent for now. A rotating bonus zone shortened games and also reduced comebacks, so it stays off. Both remain as rule switches.
- The roster is **not balanced yet**. The margin gate (five points) is report-only in CI; see the latest bench log for the current table. Commander numbers should next move on human play, not on more bot passes.

## Repeated loop

| Horizon     | Player action                                    | Payoff                              | State of implementation                         |
| ----------- | ------------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| One turn    | Predict a rival, choose a contested position     | Understand why a zone flipped       | Implemented                                     |
| One match   | Adapt across three zones                         | Win/loss, readable exchange history | Implemented                                     |
| One session | Change hero, invite a rival, try again           | Discover a counterplay pattern      | New room flow; direct rematch/tutorial/bot next |
| One day     | Join friends in a campaign objective             | Visible capped faction contribution | Designed, not implemented                       |
| One season  | Commit to faction and complete cooperative goals | Cosmetics, identity, story changes  | Designed, not implemented                       |

## 2v2 direction

Build one shared three-zone battlefield, two players per team, independent hands/energy/cooldowns, and simultaneous four-player resolution. Team presence aggregates; players do not own separate isolated lanes. This creates reasons to coordinate a reinforcement plus attack without requiring voice chat.

The new engine already represents teams explicitly and tests four seats. Before exposing 2v2, implement parties, seat assignment, team pings, teammate intent visibility rules, a team-specific projection, and fair fill/reconnect policies. An absent teammate auto-passes without holding the team hostage. Do not expose this through a “mode” toggle until the client and matchmaker support all four players.

Start with preset decks to isolate hero/zone strategy from collection power. Test whether a 25–30-second window is comfortable for team planning; offer a relaxed unranked queue if needed. Avoid fragmenting small populations across many ranked regions/modes.

## Faction war without runaway power

Every eligible completed match emits a unique result. A later consumer applies capped war influence, with participation, anti-collusion, and replay deduplication. Defeats can grant a small participation contribution; do not make abandoning optimal. Publish a clear daily cap and an underpopulation balancing policy.

Territory control should unlock narrative, missions, cosmetic identity, or symmetric rotating rule sets. Do not revoke a player's ranked deck because their faction lost overnight. Prototype the old card-availability idea only in a clearly separate limited/unranked event with equal competitive access. Avoid paying for combat power.

Faction commitments can reset by season. Fair territory resets, time-zone coverage, faction population imbalance, exploit recovery, and contribution reversals must be designed before persistent rewards ship.

## Playtest gates

First cohort: 10–20 people playing several mirrored/alternating-seat games. Record understanding after one match, time to first legal move, completion rate, desire to replay, perceived agency, stall turns, and whether all three zones matter. Interview players after losses; win rate alone does not measure fun.

Investigate dominant two-zone strategies and runaway permanent presence. Candidate experiments: rotating bonus objectives, limited repositioning, delayed effects, or capped entrenchment. Change one rule at a time, stamp a new ruleset, and compare human play. The POC's terrain-dependent win rates and greedy bots are evidence of sensitivity, not proof that its roster is balanced.

Open product decisions: desired team size for launch, art direction, mobile priorities, cosmetic business model, and faction campaign cadence. They do not prevent building the current deterministic foundation.
