# NPC blue jay state machine

Source: `src/game/npc.ts`. Update this chart whenever the AI changes.

- **Rectangles** are states; **diamonds** are decision points (checks made when entering a state or once per second).
- Probabilistic transitions are rolled **once per second** per NPC; everything else is checked every frame.
- **Noticing:** a standing bird always notices every free acorn in view (so on landing everything in view counts as seen). A flying bird gets one roll (`NPC_NOTICE_PROBABILITY` = 0.75) for each acorn that newly enters its view. Once noticed, an acorn is **remembered even after it leaves view** and never rolls again; the bird remembers the spot where it last saw it. When that spot comes back into view and the acorn is no longer there, it is forgotten immediately (the bird does not have to land). Until then a taken acorn is still remembered and still draws the bird's explore direction. An acorn that failed its roll can roll again when it re-enters view. What is in view depends on the direction the bird faces.
- Acorn perception: a third of a typical (16:9) screen width ahead and about one bird-width behind (`NPC_PERCEIVE_AHEAD_IN_SIZES` / `NPC_PERCEIVE_BEHIND_IN_SIZES`, measured in player sizes so it never depends on the window). Hunger thresholds: eat below 2/3 (`HUNGER_THRESHOLD`), idle above 0.9 (`NPC_IDLE_HUNGER`).
- Pauses (`NPC_WAIT_SECONDS` = 1 s, no movement or action): after picking up an acorn, after landing to bury, and when entering explore.
- Walking on the ground is done in hops; picking up, burying and digging play short animations (`PICKUP_DURATION`, `BURY_DURATION`).
- **Override:** a bird holding an acorn while below the eat threshold always switches to **eat**, whatever state it was in, except while finding a burial spot or burying, where it only eats the acorn when starving (below `NPC_STARVING_HUNGER`, 1/3, the same threshold that sends it to retrieve). A bird holding an acorn it cannot eat (hunger above the threshold) in explore or idle goes to find a burial spot instead.
- Each NPC remembers the x position of every acorn it buries (`memory`); a spot is forgotten when it is visited, whether or not an acorn is still there. A dig is tied to a place, not to a remembered acorn: whichever buried acorn is nearest the beak (within `DIG_RESPONSE_IN_SIZES`, 0.5 player sizes) comes up.
- **Other birds' burial sites:** when any bird (the player or another NPC) is burying an acorn or digging one up, an NPC can notice it at **any moment from the action's halfway point to its end** (when the head touches the ground while burying, or the acorn enters the beak while digging; an attempted dig that finds nothing is never noticed) (the first moment the spot is in view, e.g. after turning or landing; one roll per observer per action, same view as for free acorns: standing = always, flying = 75%, but a flying bird that missed its roll notices anyway once it lands with the spot in view) and remembers the spot in `sites` and a dashed white line from the NPC to the spot is drawn and fades over `NOTICE_LINE_FADE_SECONDS` (2 s), following the bird as it moves. The site is remembered without needing to be noticed again. While in view it is treated like a free acorn: the NPC gathers it by digging there (a dig is tied to the place, so any buried acorn within `DIG_RESPONSE_IN_SIZES` of the beak comes up) and then eats or buries what it got. A dug-up spot is remembered too, since birds often bury near each other, even though it may now be empty. A site stays remembered after a successful dig and is dropped only when a dig by this NPC within range of it comes up empty.
- **Flying to a ground target** (gather, retrieve, find burial spot, idle trips) follows a straight line: the bird starts at its current altitude (taking off only to a low cruising height of about one bird-size when the target is more than 2 bird widths away; nearer ground targets are hopped to, never flown to) and descends steadily along the direct line, or along the steepest glide it can manage, so it never climbs more than necessary and arrives at ground level.
- Each NPC has a random `nosiness` (0-1, shown above it with its hunger). It has no effect yet.
- `follow` and `hide` are placeholders: not reachable yet (an NPC in them falls back to explore).

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

    explore["<b>explore</b><br/>pick the direction toward the nearest remembered free acorn or<br/>other-bird burial site (random if none); pause 1 s looking both ways<br/>(away from, then toward, that direction); fly that way, vary altitude,<br/>bounce off world edges; anything newly in view can distract it (see below)"]
    explore --> sees{"Each second: a remembered acorn<br/>or site currently in view?"}
    sees -- "yes (nearest free acorn or<br/>other bird's burial site, whichever is closer)" --> gather
    sees -- "no" --> starving{"Hunger below 1/3<br/>and remembers a burial spot?"}
    starving -- "yes" --> retrieve
    starving -- "no" --> explore

    retrieve["<b>retrieve</b><br/>fly to the nearest remembered<br/>burial spot, land, hop to it,<br/>forget the spot"]
    retrieve -- "a free acorn comes into view<br/>(any time before arriving)" --> gather
    retrieve --> still{"Dig at the spot: a buried acorn<br/>within 0.5 sizes of the beak?"}
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

    find["<b>find burial spot</b><br/>pick a distance up to 2 typical<br/>screen widths either way, fly there, land,<br/>wait 1 s"]
    find --> bury

    bury["<b>bury</b><br/>peck a hole and bury the acorn<br/>(animation); remember the spot"]
    bury --> rest

    explore -. "TBD (nosiness)" .-> follow
    explore -. "TBD" .-> hide
    follow["<b>follow</b><br/>(not implemented)"]
    hide["<b>hide</b><br/>(not implemented)"]

    style follow stroke-dasharray: 4 4
    style hide stroke-dasharray: 4 4
```

## Acorn supply

Each second every oak has a small chance (`ACORN_DROP_CHANCE_PER_SECOND`) to drop a group of 3-10 acorns from random points in its canopy; they fall under gravity and become ordinary free acorns.
