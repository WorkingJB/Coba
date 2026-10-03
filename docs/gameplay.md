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
