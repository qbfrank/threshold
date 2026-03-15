# Threshold

Flow funding through purpose networks to create real change.

Threshold is an interactive simulation of a holonic funding model where capital cascades through nested commons pools to activate individual nodes. The system demonstrates how threshold-based flow dynamics can concentrate resources where they're needed most, creating emergent activation patterns across a network of 104 entities.

## Architecture

### Holonic Hierarchy

The network is a four-level holon — each entity is both a whole and a part of something larger:

```
Field Commons (1)
  └─ Meta Commons (3): What's Possible, Come and Play, Happy Be-Earth Day
       └─ Pool Commons (10): Good, True, Beautiful, Heart, Mind, Soul, Earth, Wind, Fire, Water
            └─ Nodes (90): Named individuals, 9 per pool, grouped in 3 clusters of 3
```

Capital enters at any level and cascades downward. Engaged nodes generate outflows upward (to commons) and laterally (to peers), creating feedback loops that fund the wider ecosystem.

### Two Visualisations

- **Holonic view** — Zoom into one level at a time. Center shows the focus entity; orbiting nodes show its children; periphery shows siblings and parent. Drill down by clicking.
- **Ramification view** — All 104 entities at once on concentric rings (field at center, nodes at edge), grouped by meta sector. Every flow visible simultaneously.

Both views render the same simulation state.

## The Maths

### Entity State

Every entity (node or commons) has a balance `B` and a threshold pair `[min, max]`:

| State | Condition | Meaning |
|-------|-----------|---------|
| Unengaged | `B < min` | Not yet activated — accumulating capital |
| Engaged | `min <= B < max` | Active — generating outflows to peers and commons |
| Abundant | `B >= max` | Full — all received capital overflows outward |

Nodes have randomised thresholds: `min` in $1,000–$3,000, `max` in $5,500–$8,000. Commons pools have `min = 0` (they never hoard) and `max = average child max` (buffer before overflow).

### Receipt Formula (Node Level)

When a node with balance `B` receives `R` dollars, given commons rate `r_c` and field/peer rate `r_f`:

```
taxable_surplus  = max(0, (B + R) - max(B, min))
to_commons       = taxable_surplus * r_c
to_peers         = taxable_surplus * r_f
new_balance      = B + R - to_commons - to_peers
```

If `new_balance > max` (overflow):

```
overflow         = new_balance - max
to_commons      += overflow * r_c / (r_c + r_f)
to_peers        += overflow - overflow_commons
new_balance      = max
```

**Conservation invariant:** `R = (new_balance - B) + to_commons + to_peers`. Every dollar is accounted for. Sub-$1 amounts stay in balance; sub-$5 amounts are not scheduled as flights.

**Default rates:** `r_c = 0.21` (commons contribution), `r_f = 0.49` (peer symbiont flows). The remaining `0.30` stays in the node's balance. These derive from a single `outflow_rate` (default 0.70) and `peer_split` (default 0.70): `r_f = outflow * peer_split`, `r_c = outflow * (1 - peer_split)`.

### Commons Pass-Through

Commons pools (pool, meta, field) are routing infrastructure, not accumulators. On receipt:

1. **Route 100%** of received capital to children via activation-priority distribution
2. **Overflow** (balance > max after routing) also routes to children, then siblings, then parent

Commons never apply `FlowMath.onReceipt` — they have their own pass-through logic.

### Activation-Priority Distribution

The core routing algorithm. Given amount `A` to distribute among candidates with deficit `d_i = max(0, min_i - B_i)` and headroom `h_i = max_i - B_i`:

**Phase 1 — Full Activation:** Sort candidates by deficit (cheapest first). For each, if `remaining >= d_i`, allocate `min(d_i, h_i)` and subtract from remaining. Skip any that can't be fully activated.

**Phase 2 — Concentration:** Pour remaining capital into candidates one at a time (still cheapest-deficit first), each up to their headroom. This ensures capital concentrates on the node closest to activation rather than spreading thin.

**Phase 3 — Unroutable:** If all candidates are full, return remainder to sender.

```
Conservation: A = sum(alloc_i) + unroutable
```

**Deficit at commons levels:** When a meta commons routes to pool commons (or field to metas), the "deficit" of a child is the cheapest single-node activation cost in that child's subtree — not the total subtree deficit. This concentrates capital into the most activatable path.

### Epoch Settlement

Time is divided into epochs (default 29 days). At epoch end, each level settles bottom-up:

1. **Nodes:** If `B >= min`, bank the balance (success). Otherwise, return capital to pool commons (failure).
2. **Pool commons:** If `B >= min` (always true since min=0), bank. Otherwise, return to meta commons.
3. **Meta commons:** Same pattern — bank or return to field.
4. **Field commons:** Bank or carry over.
5. **Kickstart:** Flush banked commons back into active commons to restart the cascade.

The boundary depth setting controls how far settlement reaches. At "pool" depth, failed nodes return to pool commons but pool commons carries over rather than returning upward.

### Health Colour Encoding

Nodes are coloured by a traffic-light interpolation:

```
B <= 0        RED
B < min       lerp(RED, AMBER, B / min)
min <= B < max  lerp(AMBER, GREEN, (B - min) / (max - min))
B >= max      GREEN
```

### Peer Flow Topology

Each pool has 9 nodes in 3 clusters of 3. Each node has 3 outflow targets: 2 within-cluster peers and 1 bridge to an adjacent cluster. This creates a small-world network where capital circulates locally but can traverse the full pool. Pools within the same meta group also peer at the pool level (sibling spillover), and meta commons peer at the field level.

## Running

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Click **ENTER** on the landing page, then use the left panel controls to inject capital and run the demo.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — Share and adapt freely with attribution, non-commercial use only, same license for derivatives.
