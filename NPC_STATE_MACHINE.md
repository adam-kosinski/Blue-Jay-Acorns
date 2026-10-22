# NPC blue jay state machine

Source: `src/game/npc.ts`. Update this chart whenever the AI changes.

- After gather fails, eat, or bury, an NPC "rests": it goes to **idle** if hunger is above 0.8 (`NPC_IDLE_HUNGER`), otherwise to **explore**.
- There are 5 NPCs (`NPC_COUNT`).
- Probabilistic transitions are evaluated **once per second** per NPC; all others are deterministic and checked every frame.
- Viewing distance = 1/3 of the screen width (`NPC_VIEW_FRACTION`). Hunger threshold = 0.5 (`HUNGER_THRESHOLD`).
- Each NPC has a random `nosiness` (0-1, shown above it with its hunger). It has no effect yet.
- `follow` and `hide` are placeholders: not reachable yet (an NPC in them falls back to explore).

```mermaid
flowchart TD
    START([spawn]) --> explore
    idle["<b>idle</b><br/>stand still (land if flying)"]

    explore["<b>explore</b><br/>fly in a random direction,<br/>vary altitude, bounce off world edges"]
    gather["<b>gather</b><br/>fly toward acorn, land nearby,<br/>walk to it, pick it up"]
    eat["<b>eat</b><br/>eating animation,<br/>acorn consumed, hunger +0.5"]
    find["<b>find burial spot</b><br/>pick a distance up to 2 screen<br/>widths either way, fly there, land"]
    bury["<b>bury</b><br/>bury the held acorn"]
    follow["<b>follow</b><br/>(not implemented)"]
    hide["<b>hide</b><br/>(not implemented)"]

    idle -- "each second: hunger below 0.8,<br/>small chance (p = 0.1)" --> explore
    explore -- "each second: free acorn within view<br/>and random roll succeeds (p = 0.5)" --> gather
    gather -- "target taken: another free acorn in view" --> gather
    gather -- "target taken: none in view" --> rest{{"hunger above 0.8?"}}
    gather -- "picked up, hunger below 0.5" --> eat
    gather -- "picked up, hunger 0.5 or above" --> find
    eat -- "animation done" --> rest
    find -- "landed at destination (always)" --> bury
    bury -- "always" --> rest
    rest -- "yes" --> idle
    rest -- "no" --> explore

    explore -. "TBD (nosiness)" .-> follow
    explore -. "TBD" .-> hide

    style follow stroke-dasharray: 4 4
    style hide stroke-dasharray: 4 4
```
