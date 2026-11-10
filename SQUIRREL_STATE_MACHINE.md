# NPC squirrel state machine

Source: `src/game/squirrel.ts` (tree, sniffing, home stretch) plus the shared animal code in `src/game/npc.ts` (a squirrel is an `Npc` with `home` set; blue jays have `home = null`). Update this chart whenever the squirrel AI changes. It starts as a copy of the blue jay machine (`NPC_STATE_MACHINE.md`) and diverges where listed below; anything not listed behaves as described there (perception, noticing burial sites and digs, burial quality, hiding mounds, remembered burials, digging at the beak tip, ...).

- **Rectangles** are states; **diamonds** are decision points (checks made when entering a state or once per second).
- Probabilistic transitions are rolled **once per second** per animal; everything else is checked every frame.

## How a squirrel differs from a blue jay

- **One per oak.** Every oak tree has one squirrel (`createSquirrels`, `world.squirrels`). It is the same size as the jay (`SQUIRREL_SIZE_FRACTION` = 1): its body is as long as a jay's (nose to rump), gray with a pale belly, and its slim bushy tail has an S-shaped sweep and adds 0.8 of a body length when stretched out fully; in motion it is raised over the back (curled up behind it when the squirrel sits upright to eat, trailing when it climbs). Its haunch and big hind foot look the same in every pose; only the body (which tips up to sit upright) and the tail change.
- **Never flies.** All movement is hopping on the ground (`npc.keys.w` is forced off), at `SQUIRREL_SPEED_SCALE` (1.0 of the player's walking speed; jays use 0.75). Anything a jay would fly to (a far acorn, a burial spot) a squirrel hops to.
- **A fuzzy home stretch.** `home = { tree, trunkX, left, right }`: the ground within the reach of its oak (`acornReach`: the oak's acorns land within half the width of its leaf clusters, `ACORN_SPREAD_FACTOR` = 0.5) on either side of the trunk. It **explores** only inside it (turning round at the edges), and it **buries** only inside it (candidate burial points outside the stretch are never chosen; `inHome`). But it perceives everything in view, also outside the stretch, and **ventures out** to gather any free acorn or other animal's burial site it sees there (gather, retrieve of its own burials, idle's trip to the trunk are not limited). Whenever it is outside the stretch (by more than 0.3 of its size) and is in explore or looking for a burial spot, it walks back toward it (`returnHome`) instead: no exploring, no sniffing and no burial search until it is back inside. On the way back it still notices acorns in view and, at the once-per-second check, can go gather another one (and eats it if hungry); if it picked an acorn up and is not hungry, it walks back before looking for a spot to bury it.
- **Noticing is acted on at once.** When it notices a free acorn or a burial site (also by sniffing; a sniff in progress finishes first), the decision runs immediately, so it gathers it instead of wandering out of view first. While exploring with nothing in view it heads toward the nearest acorn or burial site it remembers inside its home stretch (turning round if it must), until the spot is in view again. (Jays now do the same.)
- **No nosiness.** Squirrels have no nosiness score (`Npc.nosiness` is null, no 'nosy' bar in their label) and no **follow** state is planned for them. There is no hide state (neither for squirrels nor for jays).
- **Idle = up the tree.** A squirrel starts idling when its hunger is above 0.8 (`SQUIRREL_IDLE_ENTER_HUNGER`) and gets up again when it falls below 0.7 (`SQUIRREL_IDLE_LEAVE_HUNGER`), so it does not flip between the two (a jay uses 0.9 for both). An acorn fills only a sixth of a squirrel's bar, so it rarely gets above 0.83: with 0.9 / 0.8 a squirrel idled about 1% of the time in simulation, with 0.8 / 0.7 about 20%. In **idle** it walks to the foot of its home trunk and climbs up the side of the trunk (animation, `SQUIRREL_CLIMB_SPEED_IN_SIZES` = 4.8 sizes per second) **all the way up out of the play area** (its body entirely above the top edge of the world); it is then **hidden** (`bird.hidden`): not drawn, perceives nothing, not perceived by anyone, not counted for burial quality. The oak's leaves are drawn in front of a squirrel climbing its trunk (`drawOakCrown`, a crown-only bitmap clipped around the squirrel). It stays up there until it leaves idle, then climbs down the trunk (animation) and starts exploring. Squirrels start with a random hunger from 0.7 to 0.9 (jays 0.4 to 1); those that start above 0.8 begin hidden in their tree.
- **Hunger.** The bar is twice as large (`SQUIRREL_HUNGER_SCALE` = 2): it drains in 120 s instead of 60 s and an acorn fills 1/6 of it instead of 1/3 (`Player.hungerScale`). The thresholds are still fractions of the bar (eat below 2/3, retrieve below 1/3, idle above 0.8 and leave idle below 0.7). Each squirrel needs the same number of acorns per second as a jay, so the acorn drop chance and the world cap are multiplied by (birds + squirrels) / birds in `updateTreeDrops`.
- **Secrecy is always 0.5** (`SQUIRREL_SECRECY`): it hops over a fresh burial 5 times, and only buries at spots with burial quality above 0.5. **Oaks are ignored in its burial quality** (`burialQuality(..., useOaks = false)`).
- **Hop pause.** A squirrel stands still for a random 0.1 to 0.4 s (`SQUIRREL_HOP_PAUSE_MIN_SECONDS` / `SQUIRREL_HOP_PAUSE_MAX_SECONDS`) after every hop before it hops again (jays hop continuously), but only while it **explores with no destination or searches for a burial spot**. On the way to somewhere it hops without pausing: to a chosen burial spot, back to its home stretch, to an acorn or burial site it has seen or remembers (gather, retrieve, exploring toward a remembered acorn or site), or to its trunk. Its legs only move while it is actually hopping (`squirrelHopRest` in npc.ts). This rest is part of the hop physics (`hopOnGround`, `Player.hopRest`), so it also holds while a movement key stays pressed through the landing.
- **Sniffing.** While exploring, a squirrel hops 2, 3 or 4 times (`SQUIRREL_SNIFF_EVERY_HOPS_MIN/MAX`; the hop that makes the count still travels as normal; the key is let go just before it lands so no further hop starts), pauses and sniffs for `SQUIRREL_SNIFF_SECONDS` (0.9 s), nose to the ground and the head hardly moving, then **keeps exploring the same way**. (Burying and digging up are different: the head works up and down and the two front paws scratch the ground; picking an acorn up is one smooth stoop. All head movements ease in and out so the head never jumps.) When a sniff starts, every buried acorn of another animal within one squirrel width of its nose (`SQUIRREL_SNIFF_RADIUS_IN_SIZES` = 1, measured from the nose tip) gets one roll to be noticed, with the usual chance (it falls with the hops that disguised the mound) **doubled** (`SQUIRREL_SNIFF_NOTICE_FACTOR` = 2, capped at 1): 100% for a fresh mound, 44% at 3 hops, and never below 50% (`SQUIRREL_SNIFF_MIN_CHANCE`), even for a completely hidden mound, so a squirrel that explores its stretch finds every acorn buried in it within a couple of minutes (simulated with fully hidden mounds: median 16 s, 95% within 63 s, 98% within two minutes while it does nothing but explore; real squirrels also eat, bury and rest, so it takes longer). A noticed mound joins the squirrel's list of other animals' burial sites like any noticed site, and the dashed notice line is drawn from its eye.
- **Its nose is the beak.** Burying and digging act at the nose tip: 44 sprite units ahead of its centre (`SQUIRREL_NOSE_REACH_X`, scaled by size). The dig range (1/4 of a bird size) and everything derived from it scale with the squirrel's own size.
- **Interacting with jays.** Squirrels and jays (and the player) are all "birds" as far as perception goes: a visible squirrel counts for a jay's burial quality, jays and squirrels notice each other's burials and digs, they compete for free acorns, and everyone's hops kick leaves onto mounds. Only the squirrel's hidden/climbing state changes that: a hidden squirrel is ignored.

## States

Same states as the jay: idle, explore, gather, eat, retrieve, find burial spot, bury, cover (no follow, no hide). Differences:

```mermaid
flowchart TD
    START([spawn: one per oak]) --> rest

    rest{"Fed? hunger above 0.8"}
    rest -- "yes" --> idle
    rest -- "no" --> explore

    idle["<b>idle</b><br/>walk to the foot of the home trunk,<br/>climb up the side of the trunk (animation) all the way<br/>out of the play area; hidden up there; stay"]
    idle --> hungry{"Each second:<br/>hunger below 0.7?"}
    hungry -- "yes" --> down["climb down the trunk (animation)"]
    down --> explore
    hungry -- "no" --> idle

    explore["<b>explore</b><br/>outside the home stretch: walk back to it (no sniffing);<br/>inside: hop around it, turning at its edges;<br/>after every 2-4 hops: pause and <b>sniff</b> 0.9 s (rolling to notice<br/>buried acorns within 1 squirrel width of the nose, double chance),<br/>then keep going the same way"]
    explore --> sees{"Each second: a remembered acorn<br/>or site currently in view (also outside the home stretch)?"}
    sees -- "yes" --> gather
    sees -- "no" --> starving{"Hunger below 1/3<br/>and remembers a burial spot?"}
    starving -- "yes" --> retrieve
    starving -- "no" --> explore

    retrieve["<b>retrieve</b><br/>hop to the remembered burial spot (nose exactly on it) and dig"]
    gather["<b>gather</b><br/>hop to the acorn or burial site and peck it up or dig there<br/>(never bringing up its own acorn)"]
    eat["<b>eat</b><br/>sit up and eat, acorn consumed, hunger +1/6"]
    find["<b>find burial spot</b><br/>outside the home stretch: walk back to it first;<br/>then walk in a random direction inside it,<br/>judging every spot it can see inside it (burial quality without oaks)<br/>until one is above 0.5; walk there with the nose on it, judge again, bury or keep looking"]
    bury["<b>bury</b><br/>nose to the ground, bury the acorn (animation); remember the spot"]
    cover["<b>cover</b><br/>hop over the fresh burial 5 times (secrecy 0.5)"]

    retrieve --> eat
    gather --> eat
    gather --> find
    find --> bury --> cover --> rest
    eat --> rest
```

## Acorn supply

The acorn drop chance per oak (and the cap on acorns in the world) is multiplied by (birds + squirrels) / birds, because each squirrel needs as many acorns per second as a jay (twice the bar, drained half as fast, an acorn filling half as much of it). With 3 jays, the player and 3 squirrels that is 7/4. Acorns land within half the width of the oak's leaf clusters (`ACORN_SPREAD_FACTOR` = 0.5).
