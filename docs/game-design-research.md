# NIGHTFALL MIX: design research and implementation contract

Research date: 20 October 2026. Scope: the existing `/game-test/` game, a side-scrolling car tour with automatic driving, hover, heart invitations, charging, route selection, twelve local roads and six city stops.

## Design conclusion

The strongest transferable ideas from successful platform action games and roguelites are responsive inputs, readable threats, distinct builds, intentional routes, and a world that remembers the player. Their camera perspective alone is not the important part. Turning this particular game into a melee dungeon crawler would discard its clearest identity: two DJs, one car, music, fashion and a tour through different streets.

The rewrite should make the existing car interaction expressive. It should offer an understandable reason to travel, different ways to solve each road, a rewarding arrival, and a new possibility to try next time. In this document, replay value means voluntary curiosity and mastery. It does not mean demonstrated addiction, nor a claim that a particular mechanic can guarantee retention.

## What the original structure needed

Source inspection showed useful foundations: a fixed-step simulation, seeded encounter plans, authored district art, mutually exclusive road alternatives, a garage, temporary build modifiers and checkpoint-based retries. Replacing these blindly would introduce regression risk without proving a better game.

The narrative, however, described successive destinations without establishing a sustained goal. The small road distances could also be mistaken for travel between distant regions. Several strings implied changing passing salarymen into gyaru regardless of their wishes. Ambient dialogue often described weather or maps without developing the relationship or acknowledging progress.

The new fiction is a six-night recording tour. Arinee drives while Chana navigates and sends invitations. The player reaches each city's street stop, selects another local road, and reaches a fictional club to record a soundcheck. Six recordings become the Kyoto finale mix. Long-distance transfers and rest occur between tour nights, outside the playable local roads. All six club names are fictional game locations, not claims about actual bookings, performances or businesses.

Hearts are invitations: people may respond, cheer, or join in their own style. The simulation's older internal identifiers such as `convert` are compatibility names, not instructions for the story to portray involuntary identity change.

## Source-to-design mapping

| Research finding                                                                                                                                           | Application to this game                                                                                                                                                                               | Implementation surface                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Dead Cells' lead developer emphasizes immediate player empowerment, responsive movement, and mastery of an available toolkit. [S1]                         | Hover, invitations, charging and rush should be understandable from the first road. Build rewards change how they interact instead of hiding the basic controls behind grinding.                       | Input handling, `simulation.js`, onboarding and road feedback |
| Celeste's creator describes grace periods, input buffering and positioning corrections that favor intended actions. [S2]                                   | Preserve quick input response, cancel held inputs at scene boundaries, and allow practical timing tolerances. Literal wall-jump or coyote-time mechanics are unnecessary in an auto-driving car.       | Input lifecycle and fixed-step simulation                     |
| Derek Yu explains Spelunky's safe-path generation using authored room templates and a preference for richer situations over simply longer runs. [S3]       | Generate from readable encounter patterns, leave usable recovery spaces, and check that available energy and hover time can solve the road. Route variation should change decisions, not just scenery. | `encounter-director.js`, `journey.js`, seeded scenario tests  |
| Hades' developers describe replay through different power combinations, continuing character memory and player-selected difficulty. [S4]                   | Give build styles a recognizable identity, preserve meaningful story knowledge, and provide assist settings. Story skipping must not prevent mechanical progression.                                   | Run builds, settings, `tour-story.js`                         |
| Hades' creator describes narrative events as data that can be revised separately from engine code. [S5]                                                    | Store scenes, prerequisites, choices and responses as plain authored data; keep narrative selection separate from money and stat settlement.                                                           | `tour-story.js`, scene integration                            |
| Noita's co-creator describes discovery from interacting systems, but warns that more simulation does not automatically produce better play. [S6]           | Prefer a few legible interactions among hover, charging, invitations and rush. New effects must improve a decision or a readable response; visual noise alone is not depth.                            | Build modifiers, encounter behavior, feedback                 |
| Dead Cells' official accessibility update includes HUD scaling, explicit synergy symbols, outlines, reduced particles and assist controls. [S7]            | Make status and build consequences readable; use labels alongside color; keep tutorial/help content outside the active road; preserve reduced-motion and safe pause behavior.                          | HUD, styles, menus, scene/UI controller                       |
| Original motivation research associates perceived competence and autonomy with enjoyment; a later review cautions against superficial theory use. [S8, S9] | Offer understandable choices and useful feedback, then evaluate with playtesting. Do not infer a guaranteed psychological effect from adding rewards or progression bars.                              | Playtest criteria and outcome reporting                       |

The application column is our design inference. These sources do not prescribe the exact mechanics, thresholds or balancing values of this game.

## Moment-to-moment play

### Read, decide, act, understand

The player should see a road situation early enough to distinguish a safe hover, a heart invitation, a charging opportunity and a committed rush. The immediate outcome needs a visible cause: a successful response, a cleared hazard, lost integrity, gained energy or a completed mission condition. Avoid placing large instructional panels over the very situation they explain.

Road speed alone cannot create satisfying depth. At higher speed the warning distance must also grow, otherwise difficulty comes from reducing reaction time beyond what the interface communicates. A late district should ask for better sequencing of familiar actions or a different build, rather than merely spawning more objects closer together.

### Expressive builds

A useful build changes a decision. Example identities include sustained aerial movement, more effective invitations, or a more aggressive rush pattern. Each needs an advantage, a limitation and upgrades that visibly cooperate with it. Keep all offered options applicable to the current run; exclude completed upgrade tiers and give a useful fallback when a pool is exhausted.

Explain comparisons concretely. “More energy recovered at charging stops” is actionable; a decorative rarity label by itself is not. Preview existing route tradeoffs: recovery, more potential income or shorter travel. Narrative choices should not secretly modify those tradeoffs.

### Fair replay

Retries restore the start-of-road checkpoint, including earlier successful progress. They must neither duplicate income from failed attempts nor erase purchases made before departure. A result screen should distinguish what was retained from what the retry resets, identify an understandable failure cause, and offer an immediate next action.

Keep a natural stopping point at every arrival. No attendance streak, countdown, artificial waiting period or forfeited daily reward is necessary for this design. The next road and the next build provide the reason to return.

## Story and dialogue contract

The new story module defines 50 authored scenes: an opening, twelve departures, twelve arrivals, two retry scenes for each road, and the finale. Ordinary scenes are short. The first retry explains checkpoint continuity; later retries use shorter practical encouragement. Arinee is measured and dry, with concrete decisions about the road and the set. Chana is bright and playful, noticing people and sounds while handling navigation and invitations.

The opening offers two explicit narrative perspectives: remembering the people who respond, or discovering each city's different sound. These choices alter later dialogue. The descriptions state that ability and rewards do not change. Mechanical route selection and RPG build choices remain the places where gameplay tradeoffs occur. This avoids a second reward economy that could be replayed or duplicated through a dialogue modal.

Story memory and simulation state have different purposes:

```js
// Every memory helper returns a new normalized object. None mutate inputs.
const scene = getStoryScene(state, 'arrival', memory);
memory = markStorySeen(memory, scene.id); // only after it is displayed
memory = chooseStoryOption(memory, scene, optionId);
const journal = getStoryJournal(memory);
```

Supported triggers are `opening`, `departure`, `arrival`, `retry` and `finale`. Arrival requires a won road. The finale requires the won final road. Merely querying a scene does not consume it. First-time scenes are suppressed after being marked seen; retries retain a repeat response. Existing ambient crew dialogue supplies ongoing travel banter.

Persistent memory contains a schema version, known scene IDs, validated narrative choices and a bounded history of plain scene IDs. Unknown IDs are discarded. Choice definitions are resolved from the internal catalog rather than accepting arbitrary effects from a caller. The journal exposes plain titles and summaries, not executable markup. Scene selection grants no currency, fans, repairs or recordings as mechanical rewards.

The six soundcheck milestones correspond to the six successful club roads. The intervening street arrivals explicitly say that recording remains ahead. Tokyo-to-Kansai travel is stated at both the end of the Asakusa night and the beginning of Osaka. Kyoto is a later tour night, not an instantaneous short road from the previous city.

## Evidence limits and evaluation

Developer accounts explain successful design decisions in their own projects; they are not controlled demonstrations that copying a feature will reproduce commercial success. Those games differ in controls, budgets, production history and audience. The research supports hypotheses worth testing, not a promise to create an addictive game.

The 2006 motivation paper used several studies and linked perceived competence and autonomy with enjoyment and related outcomes. It does not establish an ideal run length, reward frequency or upgrade count for this game. The 2024 review examined 259 HCI games papers and warns that theory is often applied shallowly. Therefore any numerical tuning here should be reported as a design choice and assessed through play, not described as scientifically optimal.

Automated checks establish narrower properties: memory purity, sane save restoration, one-time decisions, a valid ending condition, no early soundcheck claims, deterministic retry selection and no duplicated mechanical rewards. They cannot establish whether a run is fun.

Human playtesting should answer:

1. Can a first-time player explain the four main actions after the first road without leaving the game?
2. Can the player name the cause of a collision or failed run and a plausible adjustment?
3. Do two build styles produce meaningfully different decisions on the same seeded road?
4. Can the player explain a route choice before committing to it?
5. Does story memory feel responsive without slowing repeated attempts?
6. Can touch and keyboard players see threats, read text, pause, and resume without accidental input?
7. Does the player voluntarily want to try another approach after a complete run?

No player study, retention measurement or addiction assessment is claimed by this change. Keep performance checks, gameplay correctness and perceived enjoyment separate when describing results.

## Sources

- **S1:** Sébastien Bénard, Motion Twin lead developer. [Rogue-Lite Action Platformer Dead Cells Coming to PS4 This Year](https://blog.playstation.com/2018/01/25/rogue-lite-action-platformer-dead-cells-coming-to-ps4-this-year/), 2018. First-person design explanation.
- **S2:** Maddy Thorson. [Celeste & Forgiveness](https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html). First-person account of movement forgiveness mechanisms.
- **S3:** Derek Yu interview. [First look at Spelunky 2 gameplay, plus new Derek Yu interview](https://blog.playstation.com/archive/2018/08/29/first-look-at-spelunky-2-gameplay-plus-new-derek-yu-interview/), 2018. Primary developer explanation of authored templates, safe paths and systemic depth.
- **S4:** Supergiant Games. [Hades FAQ](https://www.supergiantgames.com/blog/hades-faq/). Official explanation of progression, expression, narrative and difficulty.
- **S5:** Greg Kasavin interview. [Supergiant's fourth outing Hades introduces a more mature, organized dev process](https://www.gamedeveloper.com/design/supergiant-s-fourth-outing-i-hades-i-introduces-a-more-mature-organized-dev-process), 2019. Direct developer account, including data-driven narrative events.
- **S6:** Petri Purho interview. [Road to the IGF: Nolla Games' Noita](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-nolla-games-i-noita-i-), 2019. Direct developer account of emergence and discarded simulation ideas. Companion primary presentation: [Exploring the Tech and Design of Noita](https://www.gdcvault.com/play/1025695/Exploring-the-Tech-and-Design), GDC 2019.
- **S7:** Motion Twin / Evil Empire. [Dead Cells update 29 official patch notes](https://deadcells.com/patchnotes/29), 2022. Concrete accessibility and feedback changes.
- **S8:** Richard M. Ryan, C. Scott Rigby and Andrew Przybylski. [The Motivational Pull of Video Games: A Self-Determination Theory Approach](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf), 2006. DOI: 10.1007/s11031-006-9051-8.
- **S9:** April Tyack and Elisa D. Mekler. [Self-Determination Theory and HCI Games Research: Unfulfilled Promises and Unquestioned Paradigms](https://arxiv.org/abs/2405.12639), 2024. A critical review qualifying the use of motivational theory in game design.
