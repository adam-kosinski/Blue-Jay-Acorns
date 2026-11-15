# NPC squirrel state machine

Source: `src/game/squirrel.ts` (tree, sniffing, home stretch) plus the shared animal code in `src/game/npc.ts` (a squirrel is an `Npc` with `home` set; blue jays have `home = null`). Update this chart whenever the squirrel AI changes. It starts as a copy of the blue jay machine (`NPC_STATE_MACHINE.md`) and diverges where listed below; anything not listed behaves as described there (perception, noticing burial sites and digs, burial quality, hiding mounds, remembered burials, digging at the beak tip, ...).

- **Rectangles** are states; **diamonds** are decision points (checks made when entering a state or once per second).
- Probabilistic transitions are mostly rolled **once per second** per animal (the follow rolls are event-based, see `context.md`); everything else is checked every frame.
- **Differences from a blue jay:** one per oak, never flies (hops), fuzzy home stretch around its oak, idle = up the tree (hunger 0.8 / 0.7), double-size hunger bar, secrecy 0.5 with no oak term in burial quality, 0.1-0.4 s pause between hops while wandering, sniffing every 2-4 hops, no nosiness / follow / hide. Details in `context.md`, section "NPC squirrel behaviour reference".

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
