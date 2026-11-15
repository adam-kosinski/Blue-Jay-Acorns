# NPC blue jay state machine

Source: `src/game/npc.ts`. Update this chart whenever the AI changes. Squirrels share this code and have their own state machine document, `SQUIRREL_STATE_MACHINE.md`.

- **Rectangles** are states; **diamonds** are decision points (checks made when entering a state or once per second).
- Probabilistic transitions are mostly rolled **once per second** per animal (the follow rolls are event-based, see `context.md`); everything else is checked every frame.
- **Perception:** a third of a typical screen width ahead and about one bird width behind (`NPC_PERCEIVE_AHEAD_IN_SIZES` / `NPC_PERCEIVE_BEHIND_IN_SIZES`). A standing bird always notices free acorns in view; a flying one rolls `NPC_NOTICE_PROBABILITY` (0.75).
- **Override:** a bird holding an acorn while below the eat threshold switches to **eat** whatever it was doing (except while finding a spot or burying, where only starvation does).
- **Pauses** of `NPC_WAIT_SECONDS` (1 s): after picking up an acorn, after landing to bury, and when entering explore.
- **Nosiness** drives **follow** (jays only); **secrecy** sets the cover hops and the burial-quality bar. No hide state.
- Everything else (burial quality, noticing sites, flight paths, follow details, impossible goals, acorn supply) is in `context.md`, section "NPC blue jay behaviour reference".

```mermaid
flowchart TD
    START([spawn]) --> rest

    rest{"Fed? hunger above 0.9"}
    rest -- "yes" --> idle
    rest -- "no" --> explore

    idle["<b>idle</b><br/>stand still (land if flying);<br/>sometimes (p = 0.3 per second) hop a short way<br/>or fly a short hop (35%) of 1.5-5 player sizes"]
    idle --> hungry{"Each second:<br/>hunger below 0.9?"}
    hungry -- "yes" --> explore
    hungry -- "no" --> idle

    explore["<b>explore</b><br/>pick the direction toward the nearest remembered free acorn or<br/>other-bird burial site (toward the nearest foreground oak if none); pause 1 s looking both ways<br/>(away from, then toward, that direction); fly that way, vary altitude,<br/>bounce off world edges; anything newly in view can distract it (see below)"]
    explore --> sees{"Each second: a remembered acorn<br/>or site currently in view?"}
    sees -- "yes (nearest free acorn or<br/>other bird's burial site, whichever is closer)" --> gather
    sees -- "no" --> starving{"Hunger below 1/3<br/>and remembers a burial spot?"}
    starving -- "yes" --> retrieve
    starving -- "no" --> explore

    retrieve["<b>retrieve</b><br/>fly to the nearest remembered<br/>burial spot, land, hop to it,<br/>forget the spot"]
    retrieve -- "a free acorn comes into view<br/>(any time before arriving)" --> gather
    retrieve --> still{"Dig with the beak on the spot: a buried acorn<br/>within 1/4 size of the beak?"}
    still -- "yes (nearest one)" --> dug["dig it up (animation)<br/>wait 1 s"]
    dug --> eat
    still -- "no" --> more{"More remembered spots?"}
    more -- "yes" --> retrieve
    more -- "no" --> rest

    gather["<b>gather</b><br/>fly toward the acorn or burial site, land nearby,<br/>hop to it, peck it up or dig there (animation)"]
    gather --> free{"Target still there?<br/>(acorn still free / site still remembered)"}
    free -- "yes" --> picked["got an acorn<br/>(a dug site stays remembered)<br/>wait 1 s"]
    free -- "dig came up empty" --> forget["forget the site"]
    forget --> another
    free -- "no" --> another{"Another free acorn<br/>in view?"}
    another -- "yes" --> gather
    another -- "no" --> rest

    picked --> hungryEat{"Hunger below 2/3?"}
    hungryEat -- "yes" --> eat
    hungryEat -- "no" --> find

    eat["<b>eat</b><br/>eating animation,<br/>acorn consumed, hunger +1/3"]
    eat --> rest

    find["<b>find burial spot</b><br/>pick a random direction and keep flying that way, judging every spot it can see<br/>(its perception region, nearest first; burial quality) until a spot's quality &gt; secrecy;<br/>land there and judge it again: still &gt; secrecy: wait 1 s and bury;<br/>otherwise take off and keep looking"]
    find -. "each second: another jay flying ahead the same way? 40% to turn around" .-> find
    find --> bury

    bury["<b>bury</b><br/>peck a hole and bury the acorn<br/>(animation); remember the spot"]
    bury --> cover

    cover["<b>cover</b><br/>hop over the fresh burial site back and forth:<br/>as many hops as its secrecy rounded up to the next tenth<br/>(at least 1; each hop fades the mound a bit more, 10 hide it completely)"]
    cover --> rest

    followEntry{"Idle or exploring, remembers no free acorn,<br/>hunger at least 1/3, not holding or doing anything<br/>(it may remember other birds' burial sites)"}
    explore --> followEntry
    idle --> followEntry
    followEntry -- "roll for each bird in view (acorn carriers first) the moment<br/>it becomes eligible, then for each bird entering its view:<br/>0.5 x nosiness (nosiness if that bird carries an acorn);<br/>not for a bird that is itself following, or on its 10 s cooldown;<br/>the first success follows, all may fail" --> follow
    follow["<b>follow</b><br/>stay a random 2-4 bird widths (drawn when starting) from the bird, facing it;<br/>target flies: take off, fly along, vary altitude while moving sideways, hover otherwise;<br/>target stands: land beside it (fly there if far, hop if near);<br/>switch to a bird carrying an acorn if the one followed has none"]
    follow -- "target more than half a screen away" --> rest
    follow -- "target stayed inside a 1-bird-wide window for 5 s:<br/>roll 1 - nosiness, repeated every 5 s while it stays" --> rest
    follow -- "a free acorn in view, or noticing a burial site<br/>(a new one, a known one coming back into view, or a burying;<br/>not a dig-up, not a site already in view when it began)" --> gather
    follow -- "hunger below 1/3 and remembers a burial of its own" --> retrieve
    follow -- "hunger below 1/3, no burial remembered" --> rest
```
