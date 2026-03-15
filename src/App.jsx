import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 1: CONFIGURATION                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const CFG = {
  poolSize: 9,
  clustersPerPool: 3,
  nodesPerCluster: 3,
  poolCount: 10,
  metaCount: 3,
  timing: { travelMs: 1000 },
  // Canvas: concentric orbits — commons at center, nodes orbit, then outer context
  canvas: { W: 700, H: 700 },
  orbits: {
    commonsR: 40,       // commons pool at center
    nodeR: 200,         // satellite nodes orbit
    nodeSize: 15,       // individual node circle radius
    siblingR: 270,      // sibling pools orbit (zoomed-in only)
    siblingSize: 14,    // sibling pool circle radius
    metaR: 320,         // meta commons orbit (zoomed-in only)
    metaSize: 18,       // meta commons circle radius
  },
  minFlight: 5,
  defaults: { outflowRate: 0.70, peerSplit: 0.70, fieldRate: 0.50, injectAmt: 10000, epochLength: 29 },
  demo: { intervalMs: 2500, startMs: 500 },
  log: { max: 500 },
};

const W = CFG.canvas.W, H = CFG.canvas.H;
const CX = W / 2, CY = H / 2;

const META_DEFS = [
  { id: 0, label: "What's Possible", short: "WP", pools: [0, 1, 2], color: "#c9854e" },
  { id: 1, label: "Come and Play", short: "CP", pools: [3, 4, 5], color: "#b05080" },
  { id: 2, label: "Happy Be-Earth Day", short: "BD", pools: [6, 7, 8, 9], color: "#4a9060" },
];

const POOL_DEFS = [
  // ── Meta 0: What's Possible ──
  {
    id: 0, label: "The Good", short: "GOOD", meta: 0,
    clusters: [
      { name: "Mycelium",    color: "#d4913a" },
      { name: "Canopy",      color: "#a3823a" },
      { name: "Understory",  color: "#c9a54e" },
    ],
    names: ["You","Blair","Casey","Dana","Ellis","Fern","Gray","Harper","Iris"],
    color: "#d4913a",
  },
  {
    id: 1, label: "The True", short: "TRUE", meta: 0,
    clusters: [
      { name: "Tidal", color: "#b87333" },
      { name: "Coral", color: "#8b5e3c" },
      { name: "Kelp",  color: "#d4a854" },
    ],
    names: ["Kai","Lane","Morgan","Noa","Owen","Page","Quinn","River","Sage"],
    color: "#b87333",
  },
  {
    id: 2, label: "The Beautiful", short: "BEAUTIFUL", meta: 0,
    clusters: [
      { name: "Ridge",     color: "#946b3c" },
      { name: "Meadow",    color: "#7a8b4e" },
      { name: "Watershed", color: "#c4783a" },
    ],
    names: ["Ash","Brook","Cedar","Dune","Elm","Flint","Glen","Heath","Ivy"],
    color: "#946b3c",
  },
  // ── Meta 1: Come and Play ──
  {
    id: 3, label: "Heart", short: "HEART", meta: 1,
    clusters: [
      { name: "Pulse",   color: "#c94050" },
      { name: "Embrace", color: "#a83545" },
      { name: "Rhythm",  color: "#d45a6a" },
    ],
    names: ["Love","Joy","Grace","Hope","Bliss","Valor","Mercy","Peace","Faith"],
    color: "#c94050",
  },
  {
    id: 4, label: "Mind", short: "MIND", meta: 1,
    clusters: [
      { name: "Spark", color: "#4a8bc2" },
      { name: "Depth", color: "#3a6ea0" },
      { name: "Prism", color: "#5ea0d4" },
    ],
    names: ["Logic","Muse","Sage","Nova","Zen","Atlas","Luna","Bolt","Lyric"],
    color: "#4a8bc2",
  },
  {
    id: 5, label: "Soul", short: "SOUL", meta: 1,
    clusters: [
      { name: "Flame", color: "#8b5ebf" },
      { name: "Still", color: "#6a45a0" },
      { name: "Dream", color: "#a070d4" },
    ],
    names: ["Spirit","Shadow","Light","Void","Aura","Storm","Calm","Dawn","Dusk"],
    color: "#8b5ebf",
  },
  // ── Meta 2: Happy Be-Earth Day ──
  {
    id: 6, label: "Earth", short: "EARTH", meta: 2,
    clusters: [
      { name: "Stone", color: "#6b8e3a" },
      { name: "Loam",  color: "#4a6e2a" },
      { name: "Seed",  color: "#8aae4a" },
    ],
    names: ["Clay","Granite","Moss","Pebble","Dust","Ore","Fossil","Amber","Jade"],
    color: "#6b8e3a",
  },
  {
    id: 7, label: "Wind", short: "WIND", meta: 2,
    clusters: [
      { name: "Gust",   color: "#7babc4" },
      { name: "Breeze", color: "#5a8aa4" },
      { name: "Drift",  color: "#90c0d8" },
    ],
    names: ["Gale","Whisper","Cyclone","Zephyr","Squall","Sigh","Tempest","Flutter","Haze"],
    color: "#7babc4",
  },
  {
    id: 8, label: "Fire", short: "FIRE", meta: 2,
    clusters: [
      { name: "Blaze", color: "#d45a2a" },
      { name: "Glow",  color: "#b04520" },
      { name: "Forge", color: "#e87040" },
    ],
    names: ["Flare","Ash","Cinder","Inferno","Smolder","Torch","Corona","Coal","Soot"],
    color: "#d45a2a",
  },
  {
    id: 9, label: "Water", short: "WATER", meta: 2,
    clusters: [
      { name: "Torrent", color: "#3a7e8b" },
      { name: "Dew",     color: "#2a6070" },
      { name: "Current", color: "#4a98a8" },
    ],
    names: ["Wave","Mist","Tide","Drop","Surge","Ripple","Stream","Frost","Rain"],
    color: "#3a7e8b",
  },
];

function metaGroupOf(poolIdx) { return POOL_DEFS[poolIdx].meta; }

const YOU = { poolIdx: 0, nodeIdx: 0 };

const LAYER_COLORS = ["#fcd34d", "#d4913a", "#b87333", "#946b3c"];

// ── Rate Interaction Summary ─────────────────────────────────────────────────
//
// Two controls, one formula, every level:
//
//   outflowRate (0–100%): how much of surplus above min flows outward
//   peerSplit   (0–100%): of that outflow, % to commoners vs the commons
//
//   Effective rates:
//     symbiontRate = outflowRate × peerSplit       → commoners
//     commonsRate  = outflowRate × (1 − peerSplit) → the commons
//     retention    = 1 − outflowRate
//
//   Person node receives R:
//     symbiontRate% → commoners         (via routeByActivation)
//     commonsRate%  → the commons       (instant, triggers cascade)
//     remainder     → retained in balance
//
//   Pool commons receives R:
//     fieldRate%    → satellite nodes   (via routeByActivation)
//     overflow      → siblings + parent meta   (commonsRate : fieldRate split)
//
//   Meta commons receives R:
//     fieldRate%    → pool commons      (via routeByActivation)
//     overflow      → sibling metas + field commons   (commonsRate : fieldRate split)
//
//   Field commons receives R:
//     fieldRate%    → meta commons      (via routeByActivation)
//     overflow      → fill metas (top level, no parent)
//

// Derive effective rates from the two-slider model
function deriveRates(p) {
  return {
    symbiontRate: p.outflowRate * p.peerSplit,
    commonsRate: p.outflowRate * (1 - p.peerSplit),
    fieldRate: p.fieldRate,
  };
}


// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 2: PURE UTILITIES                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function createRng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s >>>= 0; s ^= s << 5; s >>>= 0; return s / 0xffffffff; };
}

function shuffleWith(arr, rng) {
  const a = [...arr];
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
}

// ── Flow Mathematics ─────────────────────────────────────────────────────────
//
// Receipt Formula (per holon):
//   Given B (balance), R (received), [min, max], r_c (commons rate), r_f (field rate)
//
//   δ = max(0, (B+R) − max(B, min))     taxable surplus above minimum
//   C = δ · r_c                          commons contribution
//   F = δ · r_f                          field/peer flow
//   B' = B + R − C − F                   post-rate balance
//
//   If B' > max (overflow):
//     ω = B' − max
//     C += ω · r_c/(r_c + r_f)          overflow → commons (proportional)
//     F += ω − ω_c                       overflow → field (remainder)
//     B' = max
//
//   Conservation: R = (B' − B) + C + F
//   Suppression: sub-$1 stays in balance; sub-$5 not scheduled as flight
//
const FlowMath = {
  onReceipt(prevBalance, received, min, max, fieldRate, commonsRate) {
    const newTotal = prevBalance + received;

    if (newTotal <= min) return { toCommons: 0, toField: 0, overflow: 0, aboveMin: 0, newBalance: newTotal };

    // Step 1: How much of the received capital lands above min
    const aboveMin = Math.max(0, newTotal - Math.max(prevBalance, min));

    // Step 2: Apply proportional rates to capital above min
    // Normalize when rates sum > 1 so we never extract more than 100% of surplus
    let effField = fieldRate, effCommons = commonsRate;
    const totalRate = fieldRate + commonsRate;
    if (totalRate > 1) {
      effField = fieldRate / totalRate;
      effCommons = commonsRate / totalRate;
    }
    const rateCommons = aboveMin * effCommons;
    const rateField = aboveMin * effField;

    // Step 3: Does balance still exceed max after rates?
    const postRateBalance = newTotal - rateCommons - rateField;
    const rawOverflow = Math.max(0, postRateBalance - max);

    // Overflow exits 100%, split by commonsRate:fieldRate ratio
    let overflowCommons = 0, overflowField = 0;
    if (rawOverflow > 0) {
      const totalRate = commonsRate + fieldRate;
      overflowCommons = totalRate > 0 ? rawOverflow * (commonsRate / totalRate) : 0;
      overflowField = rawOverflow - overflowCommons;
    }

    let toCommons = rateCommons + overflowCommons;
    let toField = rateField + overflowField;

    // Round to whole dollars. Under $1 stays in balance — never move pennies.
    toCommons = toCommons >= 1 ? Math.round(toCommons) : 0;
    toField = toField >= 1 ? Math.round(toField) : 0;
    const overflow = rawOverflow >= 1 ? Math.round(rawOverflow) : 0;

    return { toCommons, toField, overflow, aboveMin: Math.round(aboveMin), newBalance: newTotal - toCommons - toField };
  },
};

// ── Activation-Priority Routing ──────────────────────────────────────────────
//
// Activation-Priority Distribution:
//   Given A (amount), candidates with deficit d_i and headroom h_i
//
//   Phase 1 — Activate (cheapest deficit first):
//     alloc_i = min(remaining, d_i, h_i)
//   Phase 2 — Equalize (split remainder across headroom):
//     share = ⌊remaining / |withRoom|⌋, capped by room_i
//   Phase 3 — Unroutable (all full):
//     returned to sender
//
//   Conservation: A = Σ alloc_i + unroutable
//
function routeByActivation(amount, recipientIds, getDeficit, getHeadroom) {
  amount = Math.floor(amount);
  if (amount < 1 || recipientIds.length === 0) return { allocs: [], unroutable: amount };

  // Filter out full nodes (no headroom) and annotate
  const candidates = recipientIds
    .map(id => ({ id, deficit: Math.round(getDeficit(id)), headroom: getHeadroom ? Math.round(getHeadroom(id)) : Infinity }))
    .filter(c => c.headroom > 0)
    .sort((a, b) => {
      if (a.deficit > 0 && b.deficit > 0) return a.deficit - b.deficit;
      if (a.deficit > 0) return -1;
      if (b.deficit > 0) return 1;
      return 0;
    });

  if (candidates.length === 0) return { allocs: [], unroutable: amount };

  let remaining = amount;
  const allocs = new Map();

  // Phase 1: Activate below-minimum nodes (cheapest first, only full activations)
  // Only fill a deficit when remaining is sufficient to fully activate the node.
  // When no node can be fully activated, capital falls through to Phase 2 equalization.
  for (const { id, deficit, headroom } of candidates) {
    if (remaining < 1) break;
    if (deficit <= 0) continue;
    if (remaining < deficit) continue; // can't fully activate — equalize instead
    const give = Math.min(deficit, headroom);
    if (give >= 1) {
      allocs.set(id, (allocs.get(id) || 0) + give);
      remaining -= give;
    }
  }

  // Phase 2: Concentrate on cheapest-to-activate first (fill one before next)
  // Candidates already sorted by deficit (cheapest first).
  // Pour remaining into each node up to its headroom, one at a time.
  for (const c of candidates) {
    if (remaining < 1) break;
    const already = allocs.get(c.id) || 0;
    const room = c.headroom - already;
    if (room < 1) continue;
    const give = Math.min(remaining, room);
    allocs.set(c.id, already + give);
    remaining -= give;
  }

  const result = [...allocs.entries()].filter(([, a]) => a >= 1).map(([id, a]) => ({ id, amount: a }));
  return { allocs: result, unroutable: remaining };
}

function lerpHex(a, b, t) {
  const [ah, bh] = [a, b].map(c => parseInt(c.slice(1), 16));
  const ch = [16, 8, 0].map(s => Math.round(((ah >> s) & 0xff) + (((bh >> s) & 0xff) - ((ah >> s) & 0xff)) * t));
  return `#${ch.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

// ── Traffic Light Colors ─────────────────────────────────────────────────────
//
// Health Color:
//   B ≤ 0    → RED
//   B < min  → lerp(RED, AMBER, B/min)
//   B < max  → lerp(AMBER, GREEN, (B−min)/(max−min))
//   B ≥ max  → GREEN
//
const TRAFFIC = { deficit: "#ef4444", flowing: "#f59e0b", atMax: "#22c55e" };

function nodeColor(bal, min, max) {
  if (bal <= 0)  return TRAFFIC.deficit;
  if (bal < min) return lerpHex(TRAFFIC.deficit, TRAFFIC.flowing, bal / min);
  if (bal >= max) return TRAFFIC.atMax;
  return lerpHex(TRAFFIC.flowing, TRAFFIC.atMax, (bal - min) / (max - min));
}

function getState(bal, min, max) {
  return bal < min ? "unengaged" : bal >= max ? "abundant" : "engaged";
}

// ── Balance Display ──────────────────────────────────────────────────────────
// Show actual dollars so every flow is visible. $0 hidden, under $100k full,
// over $100k abbreviated.
function fmtBal(bal) {
  if (bal <= 0) return "";
  const v = Math.round(bal);
  if (v >= 100000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toLocaleString()}`;
}

// Log-specific: always show value, even $0
function fmtL(v) { return `$${Math.round(v).toLocaleString()}`; }

function polarXY(i, total, cx, cy, r) {
  const a = (2 * Math.PI * i) / total - Math.PI / 2;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function bezCtrl(f, t) {
  return { cx: (f.x + t.x) / 2 + (t.y - f.y) * 0.14, cy: (f.y + t.y) / 2 - (t.x - f.x) * 0.14 };
}
function edgePath(f, t) { const { cx, cy } = bezCtrl(f, t); return `M${f.x},${f.y} Q${cx},${cy} ${t.x},${t.y}`; }
function bezAt(f, t, p) {
  const { cx, cy } = bezCtrl(f, t); const u = 1 - p;
  return { x: u*u*f.x + 2*u*p*cx + p*p*t.x, y: u*u*f.y + 2*u*p*cy + p*p*t.y };
}

function bfsLayers(id, graph, depth = 3) {
  const visited = new Set([id]), layers = [[id]];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const n of layers[d]) for (const s of (graph[n] || [])) if (!visited.has(s)) { visited.add(s); next.push(s); }
    layers.push(next);
  }
  return layers;
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 3: TOPOLOGY GENERATION                                             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function buildPoolTopology(poolDef, seed) {
  const N = CFG.poolSize;
  const rng = createRng(seed);
  const threshRng = createRng(seed + 0x1000);

  const clusterOf = i => Math.floor(i / CFG.nodesPerCluster);

  // Flow graph: 2 within-cluster + 1 bridge
  const flows = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const c = clusterOf(i);
    const peers = shuffleWith(
      Array.from({ length: CFG.nodesPerCluster }, (_, k) => c * CFG.nodesPerCluster + k).filter(j => j !== i), rng
    );
    flows[i].push(peers[0], peers[1]);
    const bc = (c + 1) % CFG.clustersPerPool;
    const bp = shuffleWith(Array.from({ length: CFG.nodesPerCluster }, (_, k) => bc * CFG.nodesPerCluster + k), rng);
    flows[i].push(bp[0]);
  }

  const nodes = poolDef.names.map((name, i) => ({
    id: i, name, cluster: clusterOf(i),
    min: Math.round((1000 + threshRng() * 2000) / 100) * 100,
    max: Math.round((5500 + threshRng() * 2500) / 100) * 100,
    flows: flows[i],
  }));

  const positions = nodes.map((_, i) => polarXY(i, N, CX, CY, CFG.orbits.nodeR));

  // Commons: default flows to first node of each cluster
  const commonsFlows = Array.from({ length: CFG.clustersPerPool }, (_, c) => c * CFG.nodesPerCluster);

  return { nodes, positions, flows, commonsFlows, clusters: poolDef.clusters };
}

const POOL_SEEDS = [
  0xdeadbeef, 0xcafebabe, 0xfeedface,          // meta 0
  0xbadf00d1, 0xc0ffee42, 0xbeefcafe,          // meta 1
  0xf00dcafe, 0xbaddcafe, 0xdeadc0de, 0xfacefeed, // meta 2
];
const POOL_TOPOS = POOL_DEFS.map((def, i) => buildPoolTopology(def, POOL_SEEDS[i]));

const COMMONS_POS = { x: CX, y: CY };

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 4: THRESHOLD INITIALIZATION                                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function makeInitThresholds() {
  // Commons are pass-through distributors: min = 0 (no hoarding).
  // Max = 1× average child max (buffer before overflow to siblings/parent).
  const pools = POOL_TOPOS.map(topo => {
    const nodes = topo.nodes.map(n => ({ min: n.min, max: n.max }));
    const avgMax = Math.round(nodes.reduce((s, n) => s + n.max, 0) / nodes.length);
    return { nodes, commons: { min: 0, max: avgMax } };
  });
  const metas = Array.from({ length: CFG.metaCount }, (_, mi) => {
    const childPools = META_DEFS[mi].pools;
    const avgMax = Math.round(childPools.reduce((s, pi) => s + pools[pi].commons.max, 0) / childPools.length);
    return { commons: { min: 0, max: avgMax } };
  });
  const fieldMax = Math.round(metas.reduce((s, m) => s + m.commons.max, 0) / metas.length);
  return { pools, metas, field: { commons: { min: 0, max: fieldMax } } };
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 5: SIMULATION ENGINE                                               ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

let _fid = 0;

function makeSimState() {
  return {
    pools: Array.from({ length: CFG.poolCount }, () => ({
      balances: new Float64Array(CFG.poolSize),
      banked: new Float64Array(CFG.poolSize),
      commonsBalance: 0,
      commonsBanked: 0,
    })),
    metaCommons: Array.from({ length: CFG.metaCount }, () => ({
      balance: 0,
      banked: 0,
    })),
    fieldCommonsBalance: 0,
    fieldCommonsBanked: 0,
    epochDay: 0,
    epochCount: 0,
    pending: [],
    flights: [],
    totalInjected: 0,
  };
}

function useSimulation() {
  const simRef = useRef(makeSimState());
  const paramsRef = useRef({ ...CFG.defaults });
  const threshRef = useRef(makeInitThresholds());
  const depthRef = useRef("field"); // "node" | "pool" | "meta" | "field" — simulation boundary
  const commonsFlowsRef = useRef(POOL_TOPOS.map(t => [...t.commonsFlows]));
  // Per-pool sibling peering (within same meta group)
  const metaFlowsRef = useRef(
    POOL_DEFS.map(p => META_DEFS[p.meta].pools.filter(idx => idx !== p.id))
  );
  // Per-meta commons → child pool flows
  const metaCommonsFlowsRef = useRef(META_DEFS.map(m => [...m.pools]));
  // Meta-meta peering (field level)
  const fieldFlowsRef = useRef([[1, 2], [0, 2], [0, 1]]);
  // Field commons → all meta commons
  const fieldCommonsFlowsRef = useRef([0, 1, 2]);

  const [params, _setP] = useState({ ...CFG.defaults });
  const [thresholds, _setT] = useState(makeInitThresholds);
  const [commonsFlows, _setCF] = useState(POOL_TOPOS.map(t => [...t.commonsFlows]));
  const [metaFlows, _setMF] = useState(
    POOL_DEFS.map(p => META_DEFS[p.meta].pools.filter(idx => idx !== p.id))
  );
  const [metaCommonsFlows, _setMCF] = useState(META_DEFS.map(m => [...m.pools]));
  const [fieldFlows, _setFF] = useState([[1, 2], [0, 2], [0, 1]]);
  const [fieldCommonsFlows, _setFCF] = useState([0, 1, 2]);
  const [log, setLog] = useState([]);
  const [commonsRipples, setCommonsRipples] = useState([]);
  const ripIdRef = useRef(0);

  const [snap, setSnap] = useState({
    pools: Array.from({ length: CFG.poolCount }, () => ({
      balances: new Float64Array(CFG.poolSize),
      banked: new Float64Array(CFG.poolSize),
      commonsBalance: 0,
      commonsBanked: 0,
    })),
    metaCommons: Array.from({ length: CFG.metaCount }, () => ({ balance: 0, banked: 0 })),
    fieldCommonsBalance: 0,
    fieldCommonsBanked: 0,
    epochDay: 0,
    epochCount: 0,
    flights: [],
    pendingTotal: 0,
    ts: Date.now(),
    totalInjected: 0,
  });

  // ── Synced setters ────────────────────────────────────────────────────────
  const setParam = useCallback((k, v) => {
    paramsRef.current = { ...paramsRef.current, [k]: v };
    _setP({ ...paramsRef.current });
  }, []);

  const setThreshold = useCallback((path, field, raw) => {
    const val = Math.max(0, Number(raw) || 0);
    const t = JSON.parse(JSON.stringify(threshRef.current));
    // path: ["pools", poolIdx, "nodes", nodeIdx] | ["pools", poolIdx, "commons"] | ["meta", "pools", poolIdx] | ["meta", "commons"]
    let obj = t;
    for (let i = 0; i < path.length; i++) obj = obj[path[i]];
    obj[field] = val;
    threshRef.current = t;
    _setT(JSON.parse(JSON.stringify(t)));
  }, []);

  const setPoolCommonsFlow = useCallback((poolIdx, slot, nodeId) => {
    const cf = commonsFlowsRef.current.map((a, i) => i === poolIdx ? a.map((v, j) => j === slot ? nodeId : v) : [...a]);
    commonsFlowsRef.current = cf;
    _setCF(cf.map(a => [...a]));
  }, []);

  const setMetaFlow = useCallback((poolIdx, slot, targetPoolIdx) => {
    const mf = metaFlowsRef.current.map((a, i) => i === poolIdx ? a.map((v, j) => j === slot ? targetPoolIdx : v) : [...a]);
    metaFlowsRef.current = mf;
    _setMF(mf.map(a => [...a]));
  }, []);

  const setMetaCommonsFlow = useCallback((metaIdx, slot, poolIdx) => {
    const mcf = metaCommonsFlowsRef.current.map((a, i) =>
      i === metaIdx ? a.map((v, j) => j === slot ? poolIdx : v) : [...a]
    );
    metaCommonsFlowsRef.current = mcf;
    _setMCF(mcf.map(a => [...a]));
  }, []);

  const setFieldFlow = useCallback((metaIdx, slot, targetMetaIdx) => {
    const ff = fieldFlowsRef.current.map((a, i) => i === metaIdx ? a.map((v, j) => j === slot ? targetMetaIdx : v) : [...a]);
    fieldFlowsRef.current = ff;
    _setFF(ff.map(a => [...a]));
  }, []);

  const setFieldCommonsFlow = useCallback((slot, metaIdx) => {
    const fcf = fieldCommonsFlowsRef.current.map((v, i) => i === slot ? metaIdx : v);
    fieldCommonsFlowsRef.current = fcf;
    _setFCF([...fcf]);
  }, []);

  const appendLog = useCallback((entries) => {
    setLog(prev => [...entries, ...prev].slice(0, CFG.log.max));
  }, []);

  const triggerRipple = useCallback((level) => {
    const id = ripIdRef.current++;
    setCommonsRipples(prev => [...prev, { id, ts: Date.now(), level }]);
    setTimeout(() => setCommonsRipples(prev => prev.filter(r => r.id !== id)), 1400);
  }, []);

  // ── Core flow processors ──────────────────────────────────────────────────

  const schedFlight = useCallback((from, to, ts, amount, level) => {
    const sim = simRef.current;
    sim.flights.push({ id: _fid++, from, to, startMs: ts, amount, level });
    sim.pending.push({ to, amount, deliverAt: ts + CFG.timing.travelMs, from, level });
  }, []);

  // Visual-only flight: no pending delivery. Used for flows already applied
  // instantly (commons tax, overflow to meta) that need animated edges.
  const schedVisual = useCallback((from, to, ts, amount, level) => {
    simRef.current.flights.push({ id: _fid++, from, to, startMs: ts, amount, level });
  }, []);

  // Process field-commons on receipt — pass-through distributor to meta commons
  // Commons are routing infrastructure: 100% of received cascades to children.
  // fromMetaIdx: if provided, exclude this meta from distribution (prevents sender bounce)
  const processFieldCommons = useCallback((received, ts, fromMetaIdx = -1) => {
    const sim = simRef.current;
    const th = threshRef.current.field.commons;
    const prevBal = sim.fieldCommonsBalance - received;
    const L = [];
    L.push(`  ★ FIELD COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(sim.fieldCommonsBalance)} [max ${fmtL(th.max)}]`);

    const allMetaIds = fromMetaIdx >= 0
      ? Array.from({ length: CFG.metaCount }, (_, i) => i).filter(i => i !== fromMetaIdx)
      : Array.from({ length: CFG.metaCount }, (_, i) => i);
    // Deficit = cheapest node activation in meta subtree (concentrate on most activatable path)
    const getDeficit = mIdx => {
      let cheapest = Infinity;
      for (const pIdx of META_DEFS[mIdx].pools) {
        for (let j = 0; j < CFG.poolSize; j++) {
          const d = Math.max(0, threshRef.current.pools[pIdx].nodes[j].min - sim.pools[pIdx].balances[j]);
          if (d > 0 && d < cheapest) cheapest = d;
        }
      }
      return cheapest === Infinity ? 0 : cheapest;
    };
    const getRoom = mIdx => META_DEFS[mIdx].pools.reduce((s, pIdx) =>
      s + threshRef.current.pools[pIdx].nodes.reduce((s2, nth, j) =>
        s2 + Math.max(0, nth.max - sim.pools[pIdx].balances[j]), 0), 0);

    // Step 1: Route ALL received to meta commons (activation priority)
    const toRoute = Math.floor(received);
    if (toRoute >= CFG.minFlight) {
      const { allocs } = routeByActivation(toRoute, allMetaIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id, amount } of allocs) {
        if (amount >= CFG.minFlight) { schedFlight("fc", `mc${id}`, ts, amount, "field"); distributed += amount; }
      }
      sim.fieldCommonsBalance -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    → metas: ${routed.map(a => `${META_DEFS[a.id].short} COMMONS ${fmtL(a.amount)}`).join(", ")}`);
    }

    // Step 2: overflow (accumulated balance > max) → fill meta commons
    const overflow = Math.max(0, sim.fieldCommonsBalance - th.max);
    if (overflow < 1) { appendLog(L); return; }
    L.push(`    overflow ${fmtL(overflow)} (bal ${fmtL(sim.fieldCommonsBalance)} > max ${fmtL(th.max)})`);

    let surplus = Math.floor(overflow);
    if (surplus >= CFG.minFlight) {
      const { allocs } = routeByActivation(surplus, allMetaIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id, amount } of allocs) {
        if (amount >= CFG.minFlight) { schedFlight("fc", `mc${id}`, ts, amount, "field"); distributed += amount; }
      }
      sim.fieldCommonsBalance -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    overflow → metas: ${routed.map(a => `${META_DEFS[a.id].short} COMMONS ${fmtL(a.amount)}`).join(", ")}`);
    }
    appendLog(L);
  }, [schedFlight, appendLog]);

  // Process meta-commons on receipt — pass-through distributor to child pool commons
  // 100% of received cascades to children. Overflow → siblings, then field.
  // fromPoolIdx: if provided, exclude this pool from distribution (prevents sender bounce)
  const processMetaCommons = useCallback((metaIdx, received, ts, fromPoolIdx = -1) => {
    const sim = simRef.current;
    const { fieldRate, commonsRate } = deriveRates(paramsRef.current);
    const th = threshRef.current.metas[metaIdx].commons;
    const metaDef = META_DEFS[metaIdx];
    const prevBal = sim.metaCommons[metaIdx].balance - received;
    const L = [];
    L.push(`  ◎ ${metaDef.short} COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(sim.metaCommons[metaIdx].balance)} [max ${fmtL(th.max)}]`);

    const childPoolIds = fromPoolIdx >= 0 ? metaDef.pools.filter(p => p !== fromPoolIdx) : metaDef.pools;
    // Deficit = cheapest node activation in pool (concentrate on most activatable path)
    const getDeficit = pIdx => {
      let cheapest = Infinity;
      for (let j = 0; j < CFG.poolSize; j++) {
        const d = Math.max(0, threshRef.current.pools[pIdx].nodes[j].min - sim.pools[pIdx].balances[j]);
        if (d > 0 && d < cheapest) cheapest = d;
      }
      return cheapest === Infinity ? 0 : cheapest;
    };
    const getRoom = pIdx => threshRef.current.pools[pIdx].nodes.reduce((s, nth, j) =>
      s + Math.max(0, nth.max - sim.pools[pIdx].balances[j]), 0);

    // Step 1: Route ALL received to child pool commons (activation priority)
    const toRoute = Math.floor(received);
    if (toRoute >= CFG.minFlight) {
      const { allocs } = routeByActivation(toRoute, childPoolIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id: pIdx, amount } of allocs) {
        if (amount >= CFG.minFlight) { schedFlight(`mc${metaIdx}`, `p${pIdx}`, ts, amount, `meta${metaIdx}`); distributed += amount; }
      }
      sim.metaCommons[metaIdx].balance -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    → pools: ${routed.map(a => `${POOL_DEFS[a.id].short} COMMONS ${fmtL(a.amount)}`).join(", ")}`);
    }

    // Step 2: overflow (accumulated balance > max) → children, then siblings, then field
    const overflow = Math.max(0, sim.metaCommons[metaIdx].balance - th.max);
    if (overflow < 1) { appendLog(L); return; }

    L.push(`    overflow ${fmtL(overflow)} (bal ${fmtL(sim.metaCommons[metaIdx].balance)} > max ${fmtL(th.max)})`);
    let surplus = Math.floor(overflow);

    // Step 2a: try children again (handles accumulated balance)
    if (surplus >= CFG.minFlight) {
      const { allocs } = routeByActivation(surplus, childPoolIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id: pIdx, amount } of allocs) {
        if (amount >= CFG.minFlight) { schedFlight(`mc${metaIdx}`, `p${pIdx}`, ts, amount, `meta${metaIdx}`); distributed += amount; }
      }
      sim.metaCommons[metaIdx].balance -= distributed;
      surplus -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    overflow → pools: ${routed.map(a => `${POOL_DEFS[a.id].short} COMMONS ${fmtL(a.amount)}`).join(", ")}`);
    }

    if (surplus < CFG.minFlight) { appendLog(L); return; }

    // Boundary check: at "meta" depth, no sibling meta or field routing
    const depth = depthRef.current;
    if (depth === "meta" || depth === "pool" || depth === "node") {
      L.push(`    surplus ${fmtL(surplus)} retained at meta boundary`);
      appendLog(L);
      return;
    }

    // Step 2b: sibling metas + field commons
    const siblingMetaIds = META_DEFS.map((_, i) => i).filter(i => i !== metaIdx);
    const commonsToField = commonsRate > 0 ? Math.round(surplus * commonsRate / (commonsRate + fieldRate)) : 0;
    const toSiblings = surplus - commonsToField;

    if (toSiblings >= CFG.minFlight && siblingMetaIds.length > 0) {
      const getSibDeficit = mIdx => {
        let cheapest = Infinity;
        for (const pIdx of META_DEFS[mIdx].pools) {
          for (let j = 0; j < CFG.poolSize; j++) {
            const d = Math.max(0, threshRef.current.pools[pIdx].nodes[j].min - sim.pools[pIdx].balances[j]);
            if (d > 0 && d < cheapest) cheapest = d;
          }
        }
        return cheapest === Infinity ? 0 : cheapest;
      };
      const getSibRoom = mIdx => META_DEFS[mIdx].pools.reduce((s, pIdx) =>
        s + threshRef.current.pools[pIdx].nodes.reduce((s2, nth, j) =>
          s2 + Math.max(0, nth.max - sim.pools[pIdx].balances[j]), 0), 0);
      const { allocs, unroutable } = routeByActivation(toSiblings, siblingMetaIds, getSibDeficit, getSibRoom);
      let distributed = 0;
      for (const { id: tgt, amount } of allocs) {
        if (amount >= CFG.minFlight) { schedFlight(`mc${metaIdx}`, `mc${tgt}`, ts, amount, "field"); distributed += amount; }
      }
      sim.metaCommons[metaIdx].balance -= distributed;
      if (distributed >= CFG.minFlight) {
        L.push(`    overflow → sibling metas: ${allocs.filter(a => a.amount >= CFG.minFlight).map(a => `${META_DEFS[a.id].short} COMMONS ${fmtL(a.amount)}`).join(", ")}`);
      }
      const extraToField = Math.floor(unroutable);
      if (extraToField >= CFG.minFlight) {
        sim.metaCommons[metaIdx].balance -= extraToField;
        sim.fieldCommonsBalance += extraToField;
        schedVisual(`mc${metaIdx}`, "fc", ts, extraToField, "field");
        L.push(`    overflow → field commons ${fmtL(extraToField)} (siblings full)`);
        appendLog(L); L.length = 0;
        processFieldCommons(extraToField, ts, metaIdx);
      }
    }

    if (commonsToField >= CFG.minFlight) {
      sim.metaCommons[metaIdx].balance -= commonsToField;
      sim.fieldCommonsBalance += commonsToField;
      schedVisual(`mc${metaIdx}`, "fc", ts, commonsToField, "field");
      L.push(`    resourced ${fmtL(commonsToField)} → Field Commons`);
      appendLog(L); L.length = 0;
      processFieldCommons(commonsToField, ts, metaIdx);
    }

    if (L.length) appendLog(L);
  }, [schedFlight, schedVisual, appendLog, processFieldCommons]);

  // Process pool commons on receipt — pass-through distributor to satellite nodes.
  // 100% of received cascades to children. Overflow → siblings, then parent meta.
  const processPoolCommons = useCallback((poolIdx, received, ts) => {
    const sim = simRef.current;
    const pool = sim.pools[poolIdx];
    const { fieldRate, commonsRate } = deriveRates(paramsRef.current);
    const th = threshRef.current.pools[poolIdx].commons;
    const pLabel = POOL_DEFS[poolIdx].short;
    const prevBal = pool.commonsBalance - received;
    const L = [];
    L.push(`  ⬇ ${pLabel} COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(pool.commonsBalance)} [max ${fmtL(th.max)}]`);

    const nodeTh = threshRef.current.pools[poolIdx].nodes;
    const allNodeIds = Array.from({ length: CFG.poolSize }, (_, i) => i);
    const getDeficit = id => Math.max(0, nodeTh[id].min - pool.balances[id]);
    const getRoom = id => Math.max(0, nodeTh[id].max - pool.balances[id]);

    // Step 1: Route ALL received to satellite nodes (activation priority)
    const toRoute = Math.floor(received);
    if (toRoute >= CFG.minFlight) {
      const { allocs } = routeByActivation(toRoute, allNodeIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id, amount } of allocs) {
        if (amount >= CFG.minFlight) {
          schedFlight(`c${poolIdx}`, id, ts, amount, `pool${poolIdx}`);
          distributed += amount;
        }
      }
      pool.commonsBalance -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    → nodes: ${routed.map(a => `${POOL_TOPOS[poolIdx].nodes[a.id].name} ${fmtL(a.amount)}`).join(", ")}`);
    }

    // Step 2: overflow (accumulated balance > max) → children, then siblings, then parent
    const overflow = Math.max(0, pool.commonsBalance - th.max);
    if (overflow < 1) { appendLog(L); return; }

    L.push(`    overflow ${fmtL(overflow)} (bal ${fmtL(pool.commonsBalance)} > max ${fmtL(th.max)})`);
    let surplus = Math.floor(overflow);

    // Step 2a: try children again (handles accumulated balance)
    if (surplus >= CFG.minFlight) {
      const { allocs } = routeByActivation(surplus, allNodeIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id, amount } of allocs) {
        if (amount >= CFG.minFlight) {
          schedFlight(`c${poolIdx}`, id, ts, amount, `pool${poolIdx}`);
          distributed += amount;
        }
      }
      pool.commonsBalance -= distributed;
      surplus -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    overflow → nodes: ${routed.map(a => `${POOL_TOPOS[poolIdx].nodes[a.id].name} ${fmtL(a.amount)}`).join(", ")}`);
    }

    if (surplus < CFG.minFlight) { appendLog(L); return; }

    // Boundary check: at "pool" depth, no sibling or meta routing
    const depth = depthRef.current;
    if (depth === "pool" || depth === "node") {
      L.push(`    surplus ${fmtL(surplus)} retained at pool boundary`);
      appendLog(L);
      return;
    }

    // Step 2b: Sibling pool commons + parent meta
    const myMeta = metaGroupOf(poolIdx);
    const siblingIds = META_DEFS[myMeta].pools.filter(p => p !== poolIdx);
    const commonsToMeta = commonsRate > 0 ? Math.round(surplus * commonsRate / (commonsRate + fieldRate)) : 0;
    const toSiblings = surplus - commonsToMeta;

    if (toSiblings >= CFG.minFlight && siblingIds.length > 0) {
      const getSibDeficit = pIdx => {
        let cheapest = Infinity;
        for (let j = 0; j < CFG.poolSize; j++) {
          const d = Math.max(0, threshRef.current.pools[pIdx].nodes[j].min - sim.pools[pIdx].balances[j]);
          if (d > 0 && d < cheapest) cheapest = d;
        }
        return cheapest === Infinity ? 0 : cheapest;
      };
      const getSibRoom = pIdx => threshRef.current.pools[pIdx].nodes.reduce((s, nth, j) =>
        s + Math.max(0, nth.max - sim.pools[pIdx].balances[j]), 0);
      const { allocs, unroutable } = routeByActivation(toSiblings, siblingIds, getSibDeficit, getSibRoom);
      let distributed = 0;
      for (const { id: tgt, amount } of allocs) {
        if (amount >= CFG.minFlight) {
          schedFlight(`c${poolIdx}`, `p${tgt}`, ts, amount, `meta${myMeta}`);
          distributed += amount;
        }
      }
      pool.commonsBalance -= distributed;
      if (distributed >= CFG.minFlight) {
        L.push(`    overflow → siblings: ${allocs.filter(a => a.amount >= CFG.minFlight).map(a => `${POOL_DEFS[a.id].short} COMMONS ${fmtL(a.amount)}`).join(", ")}`);
      }
      if (depth === "meta") {
        if (unroutable >= 1) L.push(`    unroutable ${fmtL(unroutable)} retained at meta boundary`);
      } else {
        const extraToMeta = Math.floor(unroutable);
        if (extraToMeta >= CFG.minFlight) {
          pool.commonsBalance -= extraToMeta;
          sim.metaCommons[myMeta].balance += extraToMeta;
          schedVisual(`c${poolIdx}`, `mc${myMeta}`, ts, extraToMeta, `meta${myMeta}`);
          L.push(`    overflow → ${META_DEFS[myMeta].short} commons ${fmtL(extraToMeta)} (siblings full)`);
          appendLog(L); L.length = 0;
          processMetaCommons(myMeta, extraToMeta, ts, poolIdx);
        }
      }
    }

    if (depth !== "meta" && commonsToMeta >= CFG.minFlight) {
      pool.commonsBalance -= commonsToMeta;
      sim.metaCommons[myMeta].balance += commonsToMeta;
      schedVisual(`c${poolIdx}`, `mc${myMeta}`, ts, commonsToMeta, `meta${myMeta}`);
      L.push(`    resourced ${fmtL(commonsToMeta)} → ${META_DEFS[myMeta].short} Commons`);
      appendLog(L); L.length = 0;
      processMetaCommons(myMeta, commonsToMeta, ts, poolIdx);
    }

    if (L.length) appendLog(L);
  }, [schedFlight, schedVisual, appendLog, processMetaCommons]);

  // ── Epoch settlement ────────────────────────────────────────────────────
  const settleEpoch = useCallback(() => {
    const sim = simRef.current;
    const ts = Date.now();
    const depth = depthRef.current;
    const logLines = [];
    logLines.push(`━━━ EPOCH ${sim.epochCount + 1} SETTLEMENT (boundary: ${depth}) ━━━`);

    // Phase 1: Person nodes — bank or return
    for (let p = 0; p < sim.pools.length; p++) {
      const pool = sim.pools[p];
      const pLabel = POOL_DEFS[p].short;
      const nodeTh = threshRef.current.pools[p].nodes;
      let returnToCommons = 0;

      for (let i = 0; i < CFG.poolSize; i++) {
        const bal = pool.balances[i];
        if (bal < 1) continue;
        const name = POOL_TOPOS[p].nodes[i].name;
        if (bal >= nodeTh[i].min) {
          pool.banked[i] += bal;
          logLines.push(`  ✓ BANKED ${name} (${pLabel}) ${fmtL(bal)}`);
        } else if (depth === "node") {
          // At node boundary, failed capital carries over (no commons to return to)
          logLines.push(`  ★ ${name} (${pLabel}) ${fmtL(bal)} carries over (node boundary)`);
        } else {
          returnToCommons += bal;
          logLines.push(`  ✗ RETURNED ${name} (${pLabel}) ${fmtL(bal)} → commons`);
        }
        if (depth !== "node" || bal >= nodeTh[i].min) pool.balances[i] = 0;
      }

      if (returnToCommons > 0) {
        pool.commonsBalance += returnToCommons;
        logLines.push(`  ↩ ${pLabel} COMMONS received ${fmtL(returnToCommons)} from failed nodes`);
      }
    }

    // Phase 2: Pool commons — bank or return to parent meta (skip at "node" depth)
    if (depth !== "node") {
      const returnToMeta = new Float64Array(CFG.metaCount);
      for (let p = 0; p < sim.pools.length; p++) {
        const pool = sim.pools[p];
        const pLabel = POOL_DEFS[p].short;
        const bal = pool.commonsBalance;
        if (bal < 1) { pool.commonsBalance = 0; continue; }
        const cTh = threshRef.current.pools[p].commons;
        if (bal >= cTh.min) {
          pool.commonsBanked += bal;
          logLines.push(`  ✓ BANKED ${pLabel} COMMONS ${fmtL(bal)}`);
        } else if (depth === "pool") {
          // At pool boundary, failed pool commons carries over
          logLines.push(`  ★ ${pLabel} COMMONS ${fmtL(bal)} carries over (pool boundary)`);
          continue; // don't zero out
        } else {
          returnToMeta[metaGroupOf(p)] += bal;
          logLines.push(`  ✗ RETURNED ${pLabel} COMMONS ${fmtL(bal)} → ${META_DEFS[metaGroupOf(p)].short}`);
        }
        pool.commonsBalance = 0;
      }

      if (depth !== "pool") {
        for (let m = 0; m < CFG.metaCount; m++) {
          if (returnToMeta[m] > 0) {
            sim.metaCommons[m].balance += returnToMeta[m];
            logLines.push(`  ↩ ${META_DEFS[m].short} COMMONS received ${fmtL(returnToMeta[m])} from failed pool commons`);
          }
        }
      }
    }

    // Phase 3: Meta commons — bank or return to field (skip at "node"/"pool" depth)
    if (depth === "meta" || depth === "field") {
      let returnToField = 0;
      for (let m = 0; m < CFG.metaCount; m++) {
        const metaBal = sim.metaCommons[m].balance;
        if (metaBal < 1) { sim.metaCommons[m].balance = 0; continue; }
        const metaTh = threshRef.current.metas[m].commons;
        if (metaBal >= metaTh.min) {
          sim.metaCommons[m].banked += metaBal;
          sim.metaCommons[m].balance = 0;
          logLines.push(`  ✓ BANKED ${META_DEFS[m].short} COMMONS ${fmtL(metaBal)}`);
        } else if (depth === "meta") {
          // At meta boundary, failed meta commons carries over
          logLines.push(`  ★ ${META_DEFS[m].short} COMMONS ${fmtL(metaBal)} carries over (meta boundary)`);
        } else {
          returnToField += metaBal;
          sim.metaCommons[m].balance = 0;
          logLines.push(`  ✗ RETURNED ${META_DEFS[m].short} COMMONS ${fmtL(metaBal)} → Field`);
        }
      }

      if (depth === "field" && returnToField > 0) {
        sim.fieldCommonsBalance += returnToField;
        logLines.push(`  ↩ FIELD COMMONS received ${fmtL(returnToField)} from failed meta commons`);
      }
    }

    // Phase 4: Field commons — bank or carry (only at "field" depth)
    if (depth === "field") {
      const fieldBal = sim.fieldCommonsBalance;
      if (fieldBal >= 1) {
        const fieldTh = threshRef.current.field.commons;
        if (fieldBal >= fieldTh.min) {
          sim.fieldCommonsBanked += fieldBal;
          sim.fieldCommonsBalance = 0;
          logLines.push(`  ✓ BANKED FIELD COMMONS ${fmtL(fieldBal)}`);
        } else {
          logLines.push(`  ★ FIELD COMMONS ${fmtL(fieldBal)} carries over (below min)`);
        }
      }
    }

    sim.epochDay = 0;
    sim.epochCount += 1;
    logLines.push(`━━━ EPOCH ${sim.epochCount} BEGINS ━━━`);

    // Phase 5: Kickstart — flush banked commons back into active commons (respect boundary)
    let anyKickstart = false;
    if (depth !== "node") {
      for (let p = 0; p < sim.pools.length; p++) {
        const pool = sim.pools[p];
        if (pool.commonsBanked < 1) continue;
        const amt = pool.commonsBanked;
        pool.commonsBalance += amt;
        pool.commonsBanked = 0;
        logLines.push(`  ⟳ KICKSTART ${POOL_DEFS[p].short} COMMONS ${fmtL(amt)} from bank`);
        anyKickstart = true;
      }
    }
    if (depth === "meta" || depth === "field") {
      for (let m = 0; m < CFG.metaCount; m++) {
        if (sim.metaCommons[m].banked >= 1) {
          const amt = sim.metaCommons[m].banked;
          sim.metaCommons[m].balance += amt;
          sim.metaCommons[m].banked = 0;
          logLines.push(`  ⟳ KICKSTART ${META_DEFS[m].short} COMMONS ${fmtL(amt)} from bank`);
          anyKickstart = true;
        }
      }
    }
    if (depth === "field" && sim.fieldCommonsBanked >= 1) {
      const amt = sim.fieldCommonsBanked;
      sim.fieldCommonsBalance += amt;
      sim.fieldCommonsBanked = 0;
      logLines.push(`  ⟳ KICKSTART FIELD COMMONS ${fmtL(amt)} from bank`);
      anyKickstart = true;
    }

    appendLog(logLines);

    // Distribute kickstarted funds top-down (respect boundary)
    if (anyKickstart) {
      if (depth === "field" && sim.fieldCommonsBalance >= 1) {
        processFieldCommons(sim.fieldCommonsBalance, ts);
      }
      if (depth === "meta" || depth === "field") {
        for (let m = 0; m < CFG.metaCount; m++) {
          if (sim.metaCommons[m].balance >= 1) {
            processMetaCommons(m, sim.metaCommons[m].balance, ts);
          }
        }
      }
      if (depth !== "node") {
        for (let p = 0; p < sim.pools.length; p++) {
          if (sim.pools[p].commonsBalance >= 1) {
            processPoolCommons(p, sim.pools[p].commonsBalance, ts);
          }
        }
      }
    }
  }, [appendLog, processPoolCommons, processMetaCommons, processFieldCommons]);

  // Apply receipt to a person node within a pool (user injections only).
  // Commons tax always applies to user injections.
  // Commons→node tax exemption is handled separately in the animation loop (line ~472).
  const applyPoolReceipt = useCallback((poolIdx, nodeIdx, amt, ts) => {
    const sim = simRef.current;
    const pool = sim.pools[poolIdx];
    const { symbiontRate, commonsRate } = deriveRates(paramsRef.current);
    const th = threshRef.current.pools[poolIdx].nodes[nodeIdx];
    const nodeName = POOL_TOPOS[poolIdx].nodes[nodeIdx].name;
    const pLabel = POOL_DEFS[poolIdx].short;

    const prevBal = pool.balances[nodeIdx];
    let { toCommons, toField, overflow, aboveMin, newBalance } = FlowMath.onReceipt(prevBal, amt, th.min, th.max, symbiontRate, commonsRate);
    // At "node" depth, all capital stays in node — no commons or peer flow
    if (depthRef.current === "node") { toCommons = 0; toField = 0; newBalance = prevBal + amt; }
    // Suppress sub-threshold flows — capital stays in balance
    if (toCommons < CFG.minFlight) { newBalance += toCommons; toCommons = 0; }
    if (toField < CFG.minFlight) { newBalance += toField; toField = 0; }
    pool.balances[nodeIdx] = newBalance;

    const prevState = getState(prevBal, th.min, th.max);
    const newState = getState(newBalance, th.min, th.max);
    const stateStr = prevState === newState ? newState.toUpperCase() : `${prevState.toUpperCase()}→${newState.toUpperCase()}`;
    const retained = Math.round(amt - toCommons - toField);

    // Collect log lines, flush before any processPoolCommons call
    const L = [];
    L.push(`  ↳ FLOW ${nodeName} (${pLabel}): +${fmtL(amt)} | bal ${fmtL(prevBal)}→${fmtL(newBalance)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${stateStr}`);
    L.push(`    retained ${fmtL(retained)} | commons ${Math.round(commonsRate * 100)}% = ${fmtL(toCommons)} | commoners ${Math.round(symbiontRate * 100)}% = ${fmtL(toField)}${overflow > 0 ? ` (includes overflow ${fmtL(overflow)})` : ""}`);

    if (toCommons >= CFG.minFlight) {
      schedVisual(nodeIdx, `c${poolIdx}`, ts, toCommons, `pool${poolIdx}`);
      pool.commonsBalance += toCommons;
      L.push(`    resourced ${fmtL(toCommons)} → ${pLabel} COMMONS`);
      // Flush log BEFORE processPoolCommons
      appendLog(L); L.length = 0;
      processPoolCommons(poolIdx, toCommons, ts);
    }
    if (toField >= CFG.minFlight) {
      const flows = POOL_TOPOS[poolIdx].flows[nodeIdx];
      if (flows && flows.length > 0) {
        const nodeTh = threshRef.current.pools[poolIdx].nodes;
        const getDeficit = id => Math.max(0, nodeTh[id].min - pool.balances[id]);
        const getRoom = id => Math.max(0, nodeTh[id].max - pool.balances[id]);
        const { allocs, unroutable } = routeByActivation(toField, flows, getDeficit, getRoom);
        const routed = allocs.filter(a => a.amount >= CFG.minFlight);
        if (routed.length) {
          L.push(`    commoners → ${routed.map(a => `${POOL_TOPOS[poolIdx].nodes[a.id].name} ${fmtL(a.amount)} (${getState(pool.balances[a.id], nodeTh[a.id].min, nodeTh[a.id].max)} deficit ${fmtL(getDeficit(a.id))})`).join(", ")}`);
        }
        // Only schedule flights above minFlight; sub-threshold amounts stay in balance
        let subThreshold = 0;
        for (const { id: to, amount } of allocs) {
          if (amount >= CFG.minFlight) schedFlight(nodeIdx, to, ts, amount, `pool${poolIdx}`);
          else subThreshold += amount;
        }
        if (subThreshold > 0) pool.balances[nodeIdx] += subThreshold;
        // Peers all full → surplus goes to commons instead
        if (unroutable >= 1) {
          schedVisual(nodeIdx, `c${poolIdx}`, ts, unroutable, `pool${poolIdx}`);
          pool.commonsBalance += unroutable;
          L.push(`    commoner unroutable ${fmtL(unroutable)} (commoners full) → ${pLabel} COMMONS`);
          // Flush log BEFORE processPoolCommons
          appendLog(L); L.length = 0;
          processPoolCommons(poolIdx, unroutable, ts);
        }
      }
    }
    if (L.length) appendLog(L);
  }, [schedFlight, schedVisual, processPoolCommons, appendLog]);

  // ── Conservation snapshot for log ──────────────────────────────────────
  const snapBalance = useCallback(() => {
    const sim = simRef.current;
    const metaParts = [];
    let poolTotal = 0, bankedTotal = 0;
    for (let m = 0; m < CFG.metaCount; m++) {
      let mNodes = 0, mCommons = 0, mBanked = 0;
      for (const pIdx of META_DEFS[m].pools) {
        mNodes += Math.round(sim.pools[pIdx].balances.reduce((s,v)=>s+v,0));
        mCommons += Math.round(sim.pools[pIdx].commonsBalance);
        mBanked += Math.round(sim.pools[pIdx].banked.reduce((s,v)=>s+v,0)) + Math.round(sim.pools[pIdx].commonsBanked);
      }
      const mc = Math.round(sim.metaCommons[m].balance);
      const mcb = Math.round(sim.metaCommons[m].banked);
      metaParts.push(`[${META_DEFS[m].short}: $${mNodes + mCommons + mc}${mBanked + mcb > 0 ? ` bk$${mBanked + mcb}` : ""}]`);
      poolTotal += mNodes + mCommons + mc;
      bankedTotal += mBanked + mcb;
    }
    const fc = Math.round(sim.fieldCommonsBalance);
    const fcb = Math.round(sim.fieldCommonsBanked);
    bankedTotal += fcb;
    const fl = Math.round(sim.pending.reduce((s,p)=>s+p.amount,0));
    const total = poolTotal + fc + fl + bankedTotal;
    const inj = Math.round(sim.totalInjected);
    const gap = inj - total;
    return `  ${metaParts.join(" ")} [FC $${fc}${fcb > 0 ? ` bk$${fcb}` : ""}] [fl $${fl}]${bankedTotal > 0 ? ` [bk $${bankedTotal}]` : ""} = $${total}/${inj}${gap !== 0 ? ` ⚠GAP $${gap}` : ' ✓'}`;
  }, []);

  // ── Public actions ────────────────────────────────────────────────────────
  const injectNode = useCallback((poolIdx, nodeIdx, silent = false, amt = null) => {
    amt = amt ?? paramsRef.current.injectAmt;
    const sim = simRef.current;
    const prevBal = sim.pools[poolIdx].balances[nodeIdx];
    const th = threshRef.current.pools[poolIdx].nodes[nodeIdx];
    const nodeName = POOL_TOPOS[poolIdx].nodes[nodeIdx].name;
    const pLabel = POOL_DEFS[poolIdx].short;
    const cluster = POOL_TOPOS[poolIdx].clusters[POOL_TOPOS[poolIdx].nodes[nodeIdx].cluster].name;
    sim.totalInjected += amt;
    applyPoolReceipt(poolIdx, nodeIdx, amt, Date.now());
    const src = silent ? "⚡ [demo]" : "⚡";
    appendLog([
      `${src} INJECT ${fmtL(amt)} → ${nodeName} (${pLabel} · ${cluster}) | pre-bal ${fmtL(prevBal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(prevBal, th.min, th.max).toUpperCase()}`,
      snapBalance(),
    ]);
    // Advance epoch day — each injection = 1 day of simulation time
    sim.epochDay += 1;
    if (sim.epochDay >= paramsRef.current.epochLength) {
      settleEpoch();
    }
  }, [applyPoolReceipt, appendLog, snapBalance, settleEpoch]);

  const injectPoolCommons = useCallback((poolIdx, amt = null) => {
    amt = amt ?? paramsRef.current.injectAmt;
    const sim = simRef.current;
    const th = threshRef.current.pools[poolIdx].commons;
    const prevBal = sim.pools[poolIdx].commonsBalance;
    sim.pools[poolIdx].commonsBalance += amt;
    sim.totalInjected += amt;
    processPoolCommons(poolIdx, amt, Date.now());
    appendLog([
      `⚡ INJECT ${fmtL(amt)} → ${POOL_DEFS[poolIdx].label} Commons | pre-bal ${fmtL(prevBal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(prevBal, th.min, th.max).toUpperCase()}`,
      snapBalance(),
    ]);
    triggerRipple(`pool${poolIdx}`);
  }, [processPoolCommons, appendLog, triggerRipple, snapBalance]);

  const injectMetaCommons = useCallback((metaIdx, amt = null) => {
    amt = amt ?? paramsRef.current.injectAmt;
    const sim = simRef.current;
    const th = threshRef.current.metas[metaIdx].commons;
    const prevBal = sim.metaCommons[metaIdx].balance;
    sim.metaCommons[metaIdx].balance += amt;
    sim.totalInjected += amt;
    processMetaCommons(metaIdx, amt, Date.now());
    appendLog([
      `⚡ INJECT ${fmtL(amt)} → ${META_DEFS[metaIdx].short} Commons | pre-bal ${fmtL(prevBal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(prevBal, th.min, th.max).toUpperCase()}`,
      snapBalance(),
    ]);
    triggerRipple(`meta${metaIdx}`);
  }, [processMetaCommons, appendLog, triggerRipple, snapBalance]);

  const injectFieldCommons = useCallback((amt = null) => {
    amt = amt ?? paramsRef.current.injectAmt;
    const sim = simRef.current;
    const th = threshRef.current.field.commons;
    const prevBal = sim.fieldCommonsBalance;
    sim.fieldCommonsBalance += amt;
    sim.totalInjected += amt;
    processFieldCommons(amt, Date.now());
    appendLog([
      `⚡ INJECT ${fmtL(amt)} → Field Commons | pre-bal ${fmtL(prevBal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(prevBal, th.min, th.max).toUpperCase()}`,
      snapBalance(),
    ]);
    triggerRipple("field");
  }, [processFieldCommons, appendLog, triggerRipple, snapBalance]);

  const fillNodeToMax = useCallback((poolIdx, nodeIdx) => {
    const bal = simRef.current.pools[poolIdx].balances[nodeIdx];
    const needed = Math.max(0, threshRef.current.pools[poolIdx].nodes[nodeIdx].max - bal + 1);
    injectNode(poolIdx, nodeIdx, false, needed);
  }, [injectNode]);

  const fillPoolCommonsToMax = useCallback((poolIdx) => {
    const needed = Math.max(0, threshRef.current.pools[poolIdx].commons.max - simRef.current.pools[poolIdx].commonsBalance + 1);
    injectPoolCommons(poolIdx, needed);
  }, [injectPoolCommons]);

  const fillMetaCommonsToMax = useCallback((metaIdx) => {
    const needed = Math.max(0, threshRef.current.metas[metaIdx].commons.max - simRef.current.metaCommons[metaIdx].balance + 1);
    injectMetaCommons(metaIdx, needed);
  }, [injectMetaCommons]);

  const fillFieldCommonsToMax = useCallback(() => {
    const needed = Math.max(0, threshRef.current.field.commons.max - simRef.current.fieldCommonsBalance + 1);
    injectFieldCommons(needed);
  }, [injectFieldCommons]);

  const tickDay = useCallback(() => {
    const sim = simRef.current;
    sim.epochDay += 1;
    if (sim.epochDay >= paramsRef.current.epochLength) {
      settleEpoch();
    }
  }, [settleEpoch]);

  const reset = useCallback(() => {
    simRef.current = makeSimState();
    setLog([]);
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const loop = () => {
      const sim = simRef.current;
      const ts = Date.now();
      const { symbiontRate, fieldRate, commonsRate } = deriveRates(paramsRef.current);
      const still = [], newP = [], newLog = [];

      for (const p of sim.pending) {
        if (p.deliverAt > ts) { still.push(p); continue; }

        if (p.level === "field") {
          // Field delivery: to a meta commons
          if (typeof p.to === "string" && p.to.startsWith("mc")) {
            const mIdx = parseInt(p.to.slice(2));
            const prevBal = sim.metaCommons[mIdx].balance;
            sim.metaCommons[mIdx].balance += p.amount;
            const fromLabel = typeof p.from === "string" && p.from === "fc" ? "Field Commons" : typeof p.from === "string" && p.from.startsWith("mc") ? `${META_DEFS[parseInt(p.from.slice(2))].short} COMMONS` : String(p.from);
            newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → ${META_DEFS[mIdx].short} COMMONS from ${fromLabel} | bal ${fmtL(prevBal)}→${fmtL(sim.metaCommons[mIdx].balance)}`);
            if (newLog.length) { appendLog(newLog.splice(0)); }
            processMetaCommons(mIdx, p.amount, ts);
          } else if (p.to === "fc") {
            const prevBal = sim.fieldCommonsBalance;
            sim.fieldCommonsBalance += p.amount;
            newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → Field Commons | bal ${fmtL(prevBal)}→${fmtL(sim.fieldCommonsBalance)}`);
            if (newLog.length) { appendLog(newLog.splice(0)); }
            processFieldCommons(p.amount, ts);
          }
        } else if (p.level.startsWith("meta")) {
          // Meta-level delivery: to a pool commons or meta commons
          if (typeof p.to === "string" && p.to.startsWith("p")) {
            const pIdx = parseInt(p.to.slice(1));
            const prevBal = sim.pools[pIdx].commonsBalance;
            sim.pools[pIdx].commonsBalance += p.amount;
            const fromLabel = typeof p.from === "string" && p.from.startsWith("mc") ? `${META_DEFS[parseInt(p.from.slice(2))].short} COMMONS` : typeof p.from === "string" && p.from.startsWith("c") ? `${POOL_DEFS[parseInt(p.from.slice(1))].short} COMMONS` : String(p.from);
            newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → ${POOL_DEFS[pIdx].short} COMMONS from ${fromLabel} | bal ${fmtL(prevBal)}→${fmtL(sim.pools[pIdx].commonsBalance)}`);
            if (newLog.length) { appendLog(newLog.splice(0)); }
            processPoolCommons(pIdx, p.amount, ts);
          } else if (typeof p.to === "string" && p.to.startsWith("mc")) {
            const mIdx = parseInt(p.to.slice(2));
            const prevBal = sim.metaCommons[mIdx].balance;
            sim.metaCommons[mIdx].balance += p.amount;
            const fromLabel = typeof p.from === "string" && p.from.startsWith("mc") ? `${META_DEFS[parseInt(p.from.slice(2))].short} COMMONS` : String(p.from);
            newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → ${META_DEFS[mIdx].short} COMMONS from ${fromLabel} | bal ${fmtL(prevBal)}→${fmtL(sim.metaCommons[mIdx].balance)}`);
            if (newLog.length) { appendLog(newLog.splice(0)); }
            processMetaCommons(mIdx, p.amount, ts);
          }
        } else {
          // Pool-level delivery
          const pIdx = parseInt(p.level.replace("pool", ""));
          const pool = sim.pools[pIdx];
          const nodeIdx = p.to;
          const pLabel = POOL_DEFS[pIdx].short;
          const nodeName = POOL_TOPOS[pIdx].nodes[nodeIdx].name;

          const prevBal = pool.balances[nodeIdx];
          const th = threshRef.current.pools[pIdx].nodes[nodeIdx];
          // Nodes are ambivalent: same rates regardless of source
          let { toCommons, toField, overflow, newBalance } = FlowMath.onReceipt(prevBal, p.amount, th.min, th.max, symbiontRate, commonsRate);
          // At "node" depth, all capital stays in node — no commons or peer flow
          if (depthRef.current === "node") { toCommons = 0; toField = 0; newBalance = prevBal + p.amount; }
          if (toCommons < CFG.minFlight) { newBalance += toCommons; toCommons = 0; }
          if (toField < CFG.minFlight) { newBalance += toField; toField = 0; }
          pool.balances[nodeIdx] = newBalance;

          const fromLabel = typeof p.from === "string" && p.from.startsWith("c") ? `${pLabel} COMMONS` : typeof p.from === "number" ? POOL_TOPOS[pIdx].nodes[p.from].name : String(p.from);
          const prevState = getState(prevBal, th.min, th.max);
          const newState = getState(newBalance, th.min, th.max);
          const stateStr = prevState === newState ? newState.toUpperCase() : `${prevState.toUpperCase()}→${newState.toUpperCase()}`;
          const retained = Math.round(p.amount - toCommons - toField);

          newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → ${nodeName} (${pLabel}) from ${fromLabel} | bal ${fmtL(prevBal)}→${fmtL(newBalance)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${stateStr}`);
          newLog.push(`    retained ${fmtL(retained)} | commons ${Math.round(commonsRate * 100)}% = ${fmtL(toCommons)} | commoners ${Math.round(symbiontRate * 100)}% = ${fmtL(toField)}${overflow > 0 ? ` (includes overflow ${fmtL(overflow)})` : ""}`);

          if (toCommons >= CFG.minFlight) {
            sim.flights.push({ id: _fid++, from: nodeIdx, to: `c${pIdx}`, startMs: ts, amount: toCommons, level: p.level });
            pool.commonsBalance += toCommons;
            newLog.push(`    resourced ${fmtL(toCommons)} → ${pLabel} COMMONS`);
            // Flush accumulated log before processPoolCommons (which adds its own entries)
            if (newLog.length) { appendLog(newLog.splice(0)); }
            processPoolCommons(pIdx, toCommons, ts);
          }
          if (toField >= CFG.minFlight) {
            const flows = POOL_TOPOS[pIdx].flows[nodeIdx];
            if (flows && flows.length > 0) {
              const poolNodeTh = threshRef.current.pools[pIdx].nodes;
              const getDeficit = id => Math.max(0, poolNodeTh[id].min - pool.balances[id]);
              const getRoom = id => Math.max(0, poolNodeTh[id].max - pool.balances[id]);
              const { allocs, unroutable } = routeByActivation(toField, flows, getDeficit, getRoom);
              const routed = allocs.filter(a => a.amount >= CFG.minFlight);
              if (routed.length) {
                newLog.push(`    commoners → ${routed.map(a => `${POOL_TOPOS[pIdx].nodes[a.id].name} ${fmtL(a.amount)} (${getState(pool.balances[a.id], poolNodeTh[a.id].min, poolNodeTh[a.id].max)} deficit ${fmtL(getDeficit(a.id))})`).join(", ")}`);
              }
              let subThreshold = 0;
              for (const { id: to, amount } of allocs) {
                if (amount >= CFG.minFlight) {
                  sim.flights.push({ id: _fid++, from: nodeIdx, to, startMs: ts, amount, level: p.level });
                  newP.push({ to, amount, deliverAt: ts + CFG.timing.travelMs, from: nodeIdx, level: p.level });
                } else {
                  subThreshold += amount;
                }
              }
              if (subThreshold > 0) pool.balances[nodeIdx] += subThreshold;
              // Peers full → surplus to commons
              if (unroutable >= 1) {
                sim.flights.push({ id: _fid++, from: nodeIdx, to: `c${pIdx}`, startMs: ts, amount: unroutable, level: p.level });
                pool.commonsBalance += unroutable;
                newLog.push(`    commoner unroutable ${fmtL(unroutable)} (commoners full) → ${pLabel} COMMONS`);
                if (newLog.length) { appendLog(newLog.splice(0)); }
                processPoolCommons(pIdx, unroutable, ts);
              }
            }
          }
        }
      }

      // Flush any remaining delivery log entries
      if (newLog.length) appendLog(newLog);

      sim.pending = [...still, ...newP];
      sim.flights = sim.flights.filter(f => ts - f.startMs < CFG.timing.travelMs + 80);

      setSnap({
        pools: sim.pools.map(p => ({
          balances: new Float64Array(p.balances),
          banked: new Float64Array(p.banked),
          commonsBalance: p.commonsBalance,
          commonsBanked: p.commonsBanked,
        })),
        metaCommons: sim.metaCommons.map(mc => ({ balance: mc.balance, banked: mc.banked })),
        fieldCommonsBalance: sim.fieldCommonsBalance,
        fieldCommonsBanked: sim.fieldCommonsBanked,
        epochDay: sim.epochDay,
        epochCount: sim.epochCount,
        flights: [...sim.flights],
        pendingTotal: sim.pending.reduce((s, p) => s + p.amount, 0),
        ts,
        totalInjected: sim.totalInjected,
      });

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [processPoolCommons, processMetaCommons, processFieldCommons, appendLog]);

  const setDepth = useCallback((d) => { depthRef.current = d; }, []);

  return {
    snap, params, thresholds, commonsFlows, metaFlows, metaCommonsFlows, fieldFlows, fieldCommonsFlows, log, commonsRipples,
    setParam, setThreshold, setPoolCommonsFlow, setMetaFlow, setMetaCommonsFlow, setFieldFlow, setFieldCommonsFlow,
    injectNode, injectPoolCommons, injectMetaCommons, injectFieldCommons,
    fillNodeToMax, fillPoolCommonsToMax, fillMetaCommonsToMax, fillFieldCommonsToMax,
    reset, appendLog, triggerRipple, settleEpoch, tickDay, setDepth, depthRef,
  };
}

// ── Depth levels (simulation boundary) ──────────────────────────────────────
// node → pool → meta → field (micro → macro)
const DEPTH_LEVELS = [
  { key: "node",  label: "NODE",  icon: "\u25CF" },
  { key: "pool",  label: "POOL",  icon: "\u25CE" },
  { key: "meta",  label: "META",  icon: "\u25C8" },
  { key: "field", label: "FIELD", icon: "\u2B21" },
];

// ── Demo Hook ───────────────────────────────────────────────────────────────
function useDemo(sim) {
  const [active, setActive] = useState(false);
  const ref = useRef(false);

  useEffect(() => {
    ref.current = active;
    if (!active) return;
    let timer, idx = 0;

    const tick = () => {
      if (!ref.current) return;
      const d = sim.depthRef.current;

      if (d === "node") {
        // Rotate through all pools, 2 nodes each
        const targets = [];
        for (let p = 0; p < CFG.poolCount; p++) targets.push([p, 0]);
        for (let p = 0; p < CFG.poolCount; p++) targets.push([p, 4]);
        const [p, n] = targets[idx % targets.length];
        sim.injectNode(p, n, true);
      } else if (d === "pool") {
        sim.injectPoolCommons(idx % CFG.poolCount);
        sim.tickDay();
      } else if (d === "meta") {
        sim.injectMetaCommons(idx % CFG.metaCount);
        sim.tickDay();
      } else {
        sim.injectFieldCommons();
        sim.tickDay();
      }

      idx++;
      timer = setTimeout(tick, CFG.demo.intervalMs);
    };
    timer = setTimeout(tick, CFG.demo.startMs);
    return () => clearTimeout(timer);
  }, [active, sim]);

  return { active, setActive };
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 6: ACTIVE EDGE EXTRACTION                                          ║
// ║  Converts raw flight data into deduplicated edge list for rendering.        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function useActiveEdges(flights, ts, levelFilter) {
  return useMemo(() => {
    const map = new Map();
    for (const fl of flights) {
      if (fl.level !== levelFilter) continue;
      const key = `${fl.from}-${fl.to}`;
      const progress = Math.min(1, (ts - fl.startMs) / CFG.timing.travelMs);
      if (!map.has(key) || map.get(key).progress < progress)
        map.set(key, { from: fl.from, to: fl.to, progress, amount: fl.amount });
    }
    return [...map.values()];
  }, [flights, ts, levelFilter]);
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 6b: RAMIFICATION VIEW — ALL FLOWS AT ONCE                         ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function flightIdToGlobal(id, level) {
  if (id === "fc") return "fc";
  if (typeof id === "string" && id.startsWith("mc")) return id;
  if (typeof id === "string" && (id.startsWith("c") || id.startsWith("p"))) return `c${id.slice(1)}`;
  if (typeof id === "number") {
    const poolIdx = parseInt(level.replace("pool", ""));
    return `n${poolIdx}_${id}`;
  }
  return String(id);
}

function useAllActiveEdges(flights, ts) {
  return useMemo(() => {
    const maps = { field: new Map(), meta: new Map(), pool: new Map() };
    for (const fl of flights) {
      const cat = fl.level === "field" ? "field" : fl.level.startsWith("meta") ? "meta" : "pool";
      const gFrom = flightIdToGlobal(fl.from, fl.level);
      const gTo = flightIdToGlobal(fl.to, fl.level);
      const key = `${gFrom}-${gTo}`;
      const progress = Math.min(1, (ts - fl.startMs) / CFG.timing.travelMs);
      if (!maps[cat].has(key) || maps[cat].get(key).progress < progress)
        maps[cat].set(key, { from: gFrom, to: gTo, progress, amount: fl.amount, level: fl.level });
    }
    return { field: [...maps.field.values()], meta: [...maps.meta.values()], pool: [...maps.pool.values()] };
  }, [flights, ts]);
}

const RAM_LAYOUT = (() => {
  const map = new Map();
  const GAP = 2;
  const sectors = [
    { metaIdx: 0, startDeg: 0, spanDeg: 120, pools: [0, 1, 2] },
    { metaIdx: 1, startDeg: 120, spanDeg: 120, pools: [3, 4, 5] },
    { metaIdx: 2, startDeg: 240, spanDeg: 120, pools: [6, 7, 8, 9] },
  ];
  map.set("fc", { x: CX, y: CY, r: 18, type: "field", color: "#fcd34d", label: "FIELD", poolIdx: -1, metaIdx: -1 });
  for (const sec of sectors) {
    const { metaIdx, startDeg, spanDeg, pools } = sec;
    const metaDef = META_DEFS[metaIdx];
    const mAngle = (startDeg + spanDeg / 2 - 90) * Math.PI / 180;
    map.set(`mc${metaIdx}`, { x: CX + 65 * Math.cos(mAngle), y: CY + 65 * Math.sin(mAngle), r: 14, type: "meta", color: metaDef.color, label: metaDef.short, poolIdx: -1, metaIdx });
    const poolSpan = (spanDeg - GAP * 2) / pools.length;
    for (let pi = 0; pi < pools.length; pi++) {
      const pIdx = pools[pi];
      const pAngle = (startDeg + GAP + poolSpan * (pi + 0.5) - 90) * Math.PI / 180;
      map.set(`c${pIdx}`, { x: CX + 150 * Math.cos(pAngle), y: CY + 150 * Math.sin(pAngle), r: 8, type: "pool", color: POOL_DEFS[pIdx].color, label: POOL_DEFS[pIdx].short.slice(0, 3), poolIdx: pIdx, metaIdx });
      for (let ni = 0; ni < CFG.poolSize; ni++) {
        const nAngle = (startDeg + GAP + poolSpan * pi + poolSpan * (ni + 0.5) / CFG.poolSize - 90) * Math.PI / 180;
        map.set(`n${pIdx}_${ni}`, { x: CX + 270 * Math.cos(nAngle), y: CY + 270 * Math.sin(nAngle), r: 4, type: "commoner", color: POOL_DEFS[pIdx].color, label: POOL_TOPOS[pIdx].nodes[ni].name, poolIdx: pIdx, metaIdx });
      }
    }
  }
  return map;
})();

const RAM_ENTRIES = [...RAM_LAYOUT.entries()];

// Own balance for each entity (not aggregated — all entities visible simultaneously)
function ramNodeData(gid, snap, thresholds) {
  if (gid === "fc") return { balance: snap.fieldCommonsBalance, banked: snap.fieldCommonsBanked, min: thresholds.field.commons.min, max: thresholds.field.commons.max };
  if (gid.startsWith("mc")) { const mi = parseInt(gid.slice(2)); return { balance: snap.metaCommons[mi].balance, banked: snap.metaCommons[mi].banked, min: thresholds.metas[mi].commons.min, max: thresholds.metas[mi].commons.max }; }
  if (gid.startsWith("c")) { const pi = parseInt(gid.slice(1)); return { balance: snap.pools[pi].commonsBalance, banked: snap.pools[pi].commonsBanked, min: thresholds.pools[pi].commons.min, max: thresholds.pools[pi].commons.max }; }
  if (gid.startsWith("n")) { const [pStr, nStr] = gid.slice(1).split("_"); const pi = parseInt(pStr), ni = parseInt(nStr); return { balance: snap.pools[pi].balances[ni], banked: snap.pools[pi].banked[ni], min: thresholds.pools[pi].nodes[ni].min, max: thresholds.pools[pi].nodes[ni].max }; }
  return { balance: 0, banked: 0, min: 0, max: 0 };
}

// Subtree aggregate for detail panel display
function ramSubtreeTotal(gid, snap) {
  if (gid === "fc") {
    let bal = snap.fieldCommonsBalance, bk = snap.fieldCommonsBanked;
    for (let mi = 0; mi < CFG.metaCount; mi++) { bal += snap.metaCommons[mi].balance; bk += snap.metaCommons[mi].banked; }
    for (const p of snap.pools) { bal += p.commonsBalance + p.balances.reduce((a, b) => a + b, 0); bk += p.commonsBanked + p.banked.reduce((a, b) => a + b, 0); }
    return { balance: bal, banked: bk };
  }
  if (gid.startsWith("mc")) {
    const mi = parseInt(gid.slice(2));
    let bal = snap.metaCommons[mi].balance, bk = snap.metaCommons[mi].banked;
    for (const pIdx of META_DEFS[mi].pools) {
      bal += snap.pools[pIdx].commonsBalance + snap.pools[pIdx].balances.reduce((a, b) => a + b, 0);
      bk += snap.pools[pIdx].commonsBanked + snap.pools[pIdx].banked.reduce((a, b) => a + b, 0);
    }
    return { balance: bal, banked: bk };
  }
  if (gid.startsWith("c")) {
    const pi = parseInt(gid.slice(1));
    return { balance: snap.pools[pi].commonsBalance + snap.pools[pi].balances.reduce((a, b) => a + b, 0),
             banked: snap.pools[pi].commonsBanked + snap.pools[pi].banked.reduce((a, b) => a + b, 0) };
  }
  return null; // commoners have no subtree
}

function ramInject(gid, sim) {
  if (gid === "fc") { sim.injectFieldCommons(); return; }
  if (gid.startsWith("mc")) { sim.injectMetaCommons(parseInt(gid.slice(2))); return; }
  if (gid.startsWith("c")) { sim.injectPoolCommons(parseInt(gid.slice(1))); return; }
  if (gid.startsWith("n")) { const [pStr, nStr] = gid.slice(1).split("_"); sim.injectNode(parseInt(pStr), parseInt(nStr)); return; }
}

function ramFill(gid, sim) {
  if (gid === "fc") { sim.fillFieldCommonsToMax(); return; }
  if (gid.startsWith("mc")) { sim.fillMetaCommonsToMax(parseInt(gid.slice(2))); return; }
  if (gid.startsWith("c")) { sim.fillPoolCommonsToMax(parseInt(gid.slice(1))); return; }
  if (gid.startsWith("n")) { const [pStr, nStr] = gid.slice(1).split("_"); sim.fillNodeToMax(parseInt(pStr), parseInt(nStr)); return; }
}

// avgChild always references leaf-node thresholds so multiplier sliders stay meaningful
function commonsAvgChildTh(gid, thresholds) {
  if (gid === "fc") {
    let sumMin = 0, sumMax = 0, count = 0;
    for (const pool of thresholds.pools) {
      for (const n of pool.nodes) { sumMin += n.min; sumMax += n.max; count++; }
    }
    return { avgChildMin: Math.round(sumMin / count), avgChildMax: Math.round(sumMax / count) };
  }
  if (gid.startsWith("mc")) {
    const cp = META_DEFS[parseInt(gid.slice(2))].pools;
    let sumMin = 0, sumMax = 0, count = 0;
    for (const pi of cp) {
      for (const n of thresholds.pools[pi].nodes) { sumMin += n.min; sumMax += n.max; count++; }
    }
    return { avgChildMin: Math.round(sumMin / count), avgChildMax: Math.round(sumMax / count) };
  }
  if (gid.startsWith("c")) {
    const ns = thresholds.pools[parseInt(gid.slice(1))].nodes;
    return {
      avgChildMin: Math.round(ns.reduce((s, n) => s + n.min, 0) / ns.length),
      avgChildMax: Math.round(ns.reduce((s, n) => s + n.max, 0) / ns.length),
    };
  }
  return null;
}

function ramSetThreshold(gid, sim, field, value) {
  if (gid === "fc") sim.setThreshold(["field", "commons"], field, value);
  else if (gid.startsWith("mc")) sim.setThreshold(["metas", parseInt(gid.slice(2)), "commons"], field, value);
  else if (gid.startsWith("c")) sim.setThreshold(["pools", parseInt(gid.slice(1)), "commons"], field, value);
  else if (gid.startsWith("n")) {
    const [pStr, nStr] = gid.slice(1).split("_");
    sim.setThreshold(["pools", parseInt(pStr), "nodes", parseInt(nStr)], field, value);
  }
}

function ramEdgeColor(level) {
  if (level === "field") return "#fcd34d";
  if (level.startsWith("meta")) return META_DEFS[parseInt(level.slice(4))].color;
  return POOL_DEFS[parseInt(level.replace("pool", ""))].color;
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 7: LEVEL VIEW NORMALIZER                                           ║
// ║  Transforms pool-level or meta-level data into the same shape.              ║
// ║  The canvas and panels never know which level they're rendering.             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function buildLevelView(zoom, snap, thresholds, sim, commonsFlows, metaFlows, metaCommonsFlows, fieldFlows, fieldCommonsFlows, commonsRipples) {

  // ── FIELD LEVEL: meta commons are nodes ────────────────────────────────
  if (zoom === "field") {
    const metaMetaFlows = fieldFlows; // [[1,2],[0,2],[0,1]]
    return {
      levelId: "field",
      nodeCount: CFG.metaCount,
      flightLevel: "field",
      nodes: META_DEFS.map((m, mi) => {
        // Aggregate health across all pools in this meta
        let anyDeficit = false, fullCount = 0, totalNodes = 0;
        let totalBal = snap.metaCommons[mi].balance, totalBanked = snap.metaCommons[mi].banked;
        for (const pIdx of m.pools) {
          const bals = snap.pools[pIdx].balances;
          const ths = thresholds.pools[pIdx].nodes;
          totalBal += snap.pools[pIdx].commonsBalance + bals.reduce((a, b) => a + b, 0);
          totalBanked += Math.round(snap.pools[pIdx].banked.reduce((a, b) => a + b, 0)) + snap.pools[pIdx].commonsBanked;
          for (let j = 0; j < ths.length; j++) {
            totalNodes++;
            if (bals[j] < ths[j].min) anyDeficit = true;
            if (bals[j] >= ths[j].max) fullCount++;
          }
        }
        const healthColor = anyDeficit ? TRAFFIC.deficit : lerpHex(TRAFFIC.flowing, TRAFFIC.atMax, fullCount / Math.max(totalNodes, 1));
        return {
          id: mi, name: m.label, shortName: m.short,
          balance: totalBal, banked: totalBanked,
          min: thresholds.metas[mi].commons.min, max: thresholds.metas[mi].commons.max,
          cluster: mi, flows: metaMetaFlows[mi], healthColor,
        };
      }),
      clusters: META_DEFS.map(m => ({ name: m.label, color: m.color })),
      positions: META_DEFS.map((_, i) => polarXY(i, CFG.metaCount, CX, CY, CFG.orbits.nodeR)),
      flowGraph: metaMetaFlows,
      commons: {
        balance: snap.fieldCommonsBalance,
        banked: snap.fieldCommonsBanked,
        min: thresholds.field.commons.min, max: thresholds.field.commons.max,
        label1: "FIELD", label2: "COMMONS", flows: fieldCommonsFlows,
        avgChildMin: Math.round(thresholds.pools.reduce((s, p) => s + p.nodes.reduce((s2, n) => s2 + n.min, 0), 0) / (CFG.poolCount * CFG.poolSize)),
        avgChildMax: Math.round(thresholds.pools.reduce((s, p) => s + p.nodes.reduce((s2, n) => s2 + n.max, 0), 0) / (CFG.poolCount * CFG.poolSize)),
      },
      ripples: commonsRipples.filter(r => r.level === "field"),
      normalizeId: (id) => {
        if (typeof id === "string") {
          if (id === "fc") return "commons";
          if (id.startsWith("mc")) return parseInt(id.slice(2));
        }
        return id;
      },
      outer: null,
      actions: {
        injectNode: (id) => sim.injectMetaCommons(id),
        injectCommons: () => sim.injectFieldCommons(),
        fillNode: (id) => sim.fillMetaCommonsToMax(id),
        fillCommons: () => sim.fillFieldCommonsToMax(),
        setNodeTh: (id, f, v) => sim.setThreshold(["metas", id, "commons"], f, v),
        setCommonsTh: (f, v) => sim.setThreshold(["field", "commons"], f, v),
        setCommonsFlow: (slot, nId) => sim.setFieldCommonsFlow(slot, nId),
      },
    };
  }

  // ── META LEVEL: pool commons are nodes ─────────────────────────────────
  if (typeof zoom === "string" && zoom.startsWith("meta")) {
    const metaIdx = parseInt(zoom.slice(4));
    const metaDef = META_DEFS[metaIdx];
    const childPools = metaDef.pools;
    const N = childPools.length;

    // Local flow graph: each pool peers with other pools in this meta (using local indices)
    const localFlowGraph = childPools.map((_, li) =>
      childPools.map((_, lj) => lj).filter(lj => lj !== li)
    );

    return {
      levelId: `meta${metaIdx}`,
      nodeCount: N,
      flightLevel: `meta${metaIdx}`,
      nodes: childPools.map((pIdx, li) => {
        const bals = snap.pools[pIdx].balances;
        const ths = thresholds.pools[pIdx].nodes;
        const anyDeficit = ths.some((th, j) => bals[j] < th.min);
        const fullCount = ths.filter((th, j) => bals[j] >= th.max).length;
        const healthColor = anyDeficit ? TRAFFIC.deficit : lerpHex(TRAFFIC.flowing, TRAFFIC.atMax, fullCount / ths.length);
        const poolBanked = Math.round(snap.pools[pIdx].banked.reduce((a, b) => a + b, 0)) + snap.pools[pIdx].commonsBanked;
        return {
          id: li, name: POOL_DEFS[pIdx].label, shortName: POOL_DEFS[pIdx].short,
          balance: snap.pools[pIdx].commonsBalance + snap.pools[pIdx].balances.reduce((a, b) => a + b, 0),
          banked: poolBanked,
          min: thresholds.pools[pIdx].commons.min, max: thresholds.pools[pIdx].commons.max,
          cluster: li, flows: localFlowGraph[li], healthColor,
          globalPoolIdx: pIdx,
        };
      }),
      clusters: childPools.map(pIdx => ({ name: POOL_DEFS[pIdx].label, color: POOL_DEFS[pIdx].color })),
      positions: childPools.map((_, li) => polarXY(li, N, CX, CY, CFG.orbits.nodeR)),
      flowGraph: localFlowGraph,
      commons: {
        balance: snap.metaCommons[metaIdx].balance,
        banked: snap.metaCommons[metaIdx].banked,
        min: thresholds.metas[metaIdx].commons.min, max: thresholds.metas[metaIdx].commons.max,
        label1: metaDef.short, label2: "COMMONS",
        flows: metaCommonsFlows[metaIdx].map(gIdx => childPools.indexOf(gIdx)),
        avgChildMin: Math.round(childPools.reduce((s, pi) => s + thresholds.pools[pi].nodes.reduce((s2, n) => s2 + n.min, 0), 0) / (childPools.length * CFG.poolSize)),
        avgChildMax: Math.round(childPools.reduce((s, pi) => s + thresholds.pools[pi].nodes.reduce((s2, n) => s2 + n.max, 0), 0) / (childPools.length * CFG.poolSize)),
      },
      ripples: commonsRipples.filter(r => r.level === `meta${metaIdx}`),
      normalizeId: (id) => {
        if (typeof id === "string") {
          if (id === `mc${metaIdx}`) return "commons";
          if (id.startsWith("c")) { const gi = parseInt(id.slice(1)); return childPools.indexOf(gi); }
          if (id.startsWith("p")) { const gi = parseInt(id.slice(1)); return childPools.indexOf(gi); }
        }
        return id;
      },
      // Outer context: sibling metas + field commons (periphery shows subtree aggregates)
      outer: {
        siblings: META_DEFS.filter((_, i) => i !== metaIdx).map(m => {
          let bal = snap.metaCommons[m.id].balance;
          for (const pIdx of m.pools) bal += snap.pools[pIdx].commonsBalance + snap.pools[pIdx].balances.reduce((a, b) => a + b, 0);
          return { id: m.id, label: m.short, color: m.color, balance: bal, flightIds: [`mc${m.id}`] };
        }),
        parent: {
          label: "FIELD",
          balance: snap.fieldCommonsBalance + snap.metaCommons.reduce((s, mc) => s + mc.balance, 0)
            + snap.pools.reduce((s, p) => s + p.commonsBalance + p.balances.reduce((a, b) => a + b, 0), 0),
          th: thresholds.field.commons, color: "#fcd34d",
          flightId: "fc",
        },
        thisCommonsFlightId: `mc${metaIdx}`,
        siblingLabel: "FIELD NETWORK",
        parentLabel: "FIELD COMMONS",
        metaFlights: snap.flights.filter(f => f.level === "field"),
      },
      actions: {
        injectNode: (localId) => sim.injectPoolCommons(childPools[localId]),
        injectCommons: () => sim.injectMetaCommons(metaIdx),
        fillNode: (localId) => sim.fillPoolCommonsToMax(childPools[localId]),
        fillCommons: () => sim.fillMetaCommonsToMax(metaIdx),
        setNodeTh: (localId, f, v) => sim.setThreshold(["pools", childPools[localId], "commons"], f, v),
        setCommonsTh: (f, v) => sim.setThreshold(["metas", metaIdx, "commons"], f, v),
        setCommonsFlow: (slot, localId) => sim.setMetaCommonsFlow(metaIdx, slot, childPools[localId]),
      },
      // Extra: for drill navigation, map local → global
      localToGlobal: childPools,
    };
  }

  // ── POOL LEVEL: people are nodes ────────────────────────────────────────
  const poolIdx = zoom;
  const topo = POOL_TOPOS[poolIdx];
  const poolSnap = snap.pools[poolIdx];
  const poolTh = thresholds.pools[poolIdx];
  const myMeta = metaGroupOf(poolIdx);

  return {
    levelId: `pool${poolIdx}`,
    nodeCount: CFG.poolSize,
    flightLevel: `pool${poolIdx}`,
    nodes: topo.nodes.map((n, i) => ({
      id: i, name: n.name, shortName: n.name.slice(0, 3).toUpperCase(),
      balance: poolSnap.balances[i],
      banked: poolSnap.banked[i],
      min: poolTh.nodes[i].min, max: poolTh.nodes[i].max,
      cluster: n.cluster, flows: n.flows,
    })),
    clusters: topo.clusters,
    positions: topo.positions,
    flowGraph: topo.flows,
    commons: {
      balance: poolSnap.commonsBalance,
      banked: poolSnap.commonsBanked,
      min: poolTh.commons.min, max: poolTh.commons.max,
      label1: POOL_DEFS[poolIdx].short, label2: "COMMONS",
      flows: commonsFlows[poolIdx],
      avgChildMin: Math.round(poolTh.nodes.reduce((s, n) => s + n.min, 0) / poolTh.nodes.length),
      avgChildMax: Math.round(poolTh.nodes.reduce((s, n) => s + n.max, 0) / poolTh.nodes.length),
    },
    ripples: commonsRipples.filter(r => r.level === `pool${poolIdx}`),
    normalizeId: (id) => {
      if (typeof id === "string") {
        if (id.startsWith("c")) return "commons";
      }
      return id;
    },
    // Outer context: sibling pools + parent meta (periphery shows subtree aggregates)
    outer: {
      siblings: META_DEFS[myMeta].pools.filter(p => p !== poolIdx).map(p => ({
        id: p, label: POOL_DEFS[p].short, color: POOL_DEFS[p].color,
        balance: snap.pools[p].commonsBalance + snap.pools[p].balances.reduce((a, b) => a + b, 0),
        flightIds: [`c${p}`, `p${p}`],
      })),
      parent: {
        label: META_DEFS[myMeta].short,
        balance: (() => {
          let bal = snap.metaCommons[myMeta].balance;
          for (const pIdx of META_DEFS[myMeta].pools) bal += snap.pools[pIdx].commonsBalance + snap.pools[pIdx].balances.reduce((a, b) => a + b, 0);
          return bal;
        })(),
        th: thresholds.metas[myMeta].commons, color: META_DEFS[myMeta].color,
        flightId: `mc${myMeta}`,
      },
      thisCommonsFlightId: `c${poolIdx}`,
      siblingLabel: META_DEFS[myMeta].label.toUpperCase(),
      parentLabel: `${META_DEFS[myMeta].short} COMMONS`,
      metaFlights: snap.flights.filter(f => f.level === `meta${myMeta}`),
    },
    actions: {
      injectNode: (id) => sim.injectNode(poolIdx, id),
      injectCommons: () => sim.injectPoolCommons(poolIdx),
      fillNode: (id) => sim.fillNodeToMax(poolIdx, id),
      fillCommons: () => sim.fillPoolCommonsToMax(poolIdx),
      setNodeTh: (id, f, v) => sim.setThreshold(["pools", poolIdx, "nodes", id], f, v),
      setCommonsTh: (f, v) => sim.setThreshold(["pools", poolIdx, "commons"], f, v),
      setCommonsFlow: (slot, nId) => sim.setPoolCommonsFlow(poolIdx, slot, nId),
    },
  };
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 8: SVG PRIMITIVES                                                  ║
// ║  Small, reusable SVG building blocks. Stateless.                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function SvgDefs() {
  return (
    <defs>
      <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <filter id="softglow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <filter id="nglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <marker id="arrFlow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0 0,6 3,0 6" fill="#92702a" opacity="0.9" /></marker>
      <marker id="arrMeta" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0 0,6 3,0 6" fill="#fcd34d" opacity="0.9" /></marker>
      {LAYER_COLORS.map((col, i) => (
        <marker key={i} id={`arrL${i}`} markerWidth="5" markerHeight="5" refX="4.5" refY="2.5" orient="auto"><polygon points="0 0,5 2.5,0 5" fill={col} opacity="0.6" /></marker>
      ))}
    </defs>
  );
}

// Orbit ring — a dashed circle representing an orbit path
function OrbitRing({ r, stroke = "#3d2b14", width = 1, dash = "3 8", opacity = 1 }) {
  return <circle cx={CX} cy={CY} r={r} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} opacity={opacity} />;
}

// Membrane — a labeled boundary ring. Each holonic level has one.
function Membrane({ r, label, color = "#3d2b14", opacity = 0.4 }) {
  const id = `mem-${r}`;
  return (
    <g>
      <circle cx={CX} cy={CY} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="6 4" opacity={opacity} />
      {label && <>
        <defs>
          <path id={id} d={`M${CX - r},${CY} A${r},${r} 0 0,1 ${CX + r},${CY}`} />
        </defs>
        <text fontSize={7} fontWeight={600} fill={color} opacity={opacity * 1.5} letterSpacing="0.18em">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle" style={{ pointerEvents: "none" }}>
            {label}
          </textPath>
        </text>
      </>}
    </g>
  );
}

// Commons pool circle at center of any level — flashes on receipt
function CommonsNode({ r, balance, min, max, selected, label1, label2, ripples, onClick }) {
  const col = nodeColor(balance, min, max);
  const pct = Math.min(1, Math.max(0, max > min ? (balance - min) / (max - min) : 0));
  const isFull = balance >= max;

  const prevBal = useRef(balance);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (Math.abs(balance - prevBal.current) > 0.5) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 400);
      prevBal.current = balance;
      return () => clearTimeout(t);
    }
    prevBal.current = balance;
  }, [balance]);

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      {(ripples || []).map(rp => (
        <circle key={rp.id} cx={CX} cy={CY} fill="none" stroke="#fcd34d"
          style={{ animation: "membraneripple 1.3s cubic-bezier(0.2,0,0.6,1) forwards" }} />
      ))}
      {isFull && <circle cx={CX} cy={CY} r={r + 16} fill="none" stroke={col} strokeWidth={2} style={{ animation: "overpulse 1.4s ease-in-out infinite" }} />}
      {flash && <circle cx={CX} cy={CY} r={r + 10} fill="none" stroke="#fef3c7" strokeWidth={2.5} opacity={0.7} style={{ animation: "receiptflash 0.4s ease-out forwards" }} />}
      <circle cx={CX} cy={CY} r={r + 6} fill="none" stroke={col} strokeWidth={selected ? 3 : 2} opacity={selected ? 0.9 : 0.5} filter={selected ? "url(#nglow)" : "none"} />
      <circle cx={CX} cy={CY} r={r} fill="#1a1008" />
      <circle cx={CX} cy={CY} r={r} fill={col} opacity={0.15 + pct * 0.5} />
      <text x={CX} y={CY - (label2 ? 7 : 0)} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={800} fill={balance > 0 ? col : "#6b4d2e"} style={{ pointerEvents: "none", letterSpacing: "0.06em" }}>{label1}</text>
      {label2 && <text x={CX} y={CY + 6} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={800} fill={balance > 0 ? col : "#6b4d2e"} style={{ pointerEvents: "none", letterSpacing: "0.06em" }}>{label2}</text>}
      {balance > 0 && <text x={CX} y={CY + r + 13} textAnchor="middle" fontSize={9} fontWeight={700} fill={flash ? "#fef3c7" : col} opacity={0.85}>{fmtBal(balance)}</text>}
    </g>
  );
}

// Satellite node on any orbit — flashes on receipt
function SatelliteNode({ x, y, r, name, balance, min, max, selected, layerIdx, dimmed, healthColor, isYou, onClick }) {
  const col = healthColor || nodeColor(balance, min, max);
  const state = getState(balance, min, max);
  const hasL = layerIdx !== undefined;
  const nr = selected ? r * 1.5 : hasL ? r * 1.12 : r;
  const op = selected ? 1 : hasL ? 1 : dimmed ? 0.28 : 0.85;
  const fillC = hasL && !selected ? lerpHex(col, LAYER_COLORS[layerIdx], 0.3) : col;

  // Flash on balance change
  const prevBal = useRef(balance);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (Math.abs(balance - prevBal.current) > 0.5) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 400);
      prevBal.current = balance;
      return () => clearTimeout(t);
    }
    prevBal.current = balance;
  }, [balance]);

  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      {isYou && <circle cx={x} cy={y} r={nr + 7} fill="none" stroke="#fcd34d" strokeWidth={1} opacity={0.4} strokeDasharray="3 3" />}
      {state === "abundant" && <circle cx={x} cy={y} r={nr + 12} fill="none" stroke={col} strokeWidth={1.5} style={{ animation: "overpulse 1.4s ease-in-out infinite" }} />}
      {/* Receipt flash */}
      {flash && <circle cx={x} cy={y} r={nr + 8} fill="none" stroke="#fef3c7" strokeWidth={2} opacity={0.7} style={{ animation: "receiptflash 0.4s ease-out forwards" }} />}
      <circle cx={x} cy={y} r={nr + 4} fill="none" stroke={col} strokeWidth={selected ? 2.5 : 1.5} opacity={op * (selected ? 0.9 : hasL ? 0.6 : 0.35)} filter={selected ? "url(#nglow)" : "none"} />
      <circle cx={x} cy={y} r={nr} fill={fillC} opacity={op} />
      {balance > 0 && <text x={x} y={y - nr - 7} textAnchor="middle" fontSize={7} fontWeight={700} fill={flash ? "#fef3c7" : col} opacity={0.85}>{fmtBal(balance)}</text>}
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={selected ? 8 : 6.5} fontWeight={700} fill={dimmed ? "#1a1008" : "#1a1008"} style={{ pointerEvents: "none", letterSpacing: "0.04em" }}>{name}</text>
    </g>
  );
}

// Ghost node on outer orbit (sibling pool or meta commons) — fainter, clickable
function GhostNode({ x, y, r, label, balance, color, onClick }) {
  return (
    <g onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <circle cx={x} cy={y} r={r + 3} fill="none" stroke={color} strokeWidth={1} opacity={0.2} />
      <circle cx={x} cy={y} r={r} fill={color} opacity={0.15} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={5.5} fontWeight={700} fill={color} opacity={0.55} style={{ pointerEvents: "none", letterSpacing: "0.05em" }}>{label}</text>
      {balance > 0 && <text x={x} y={y + r + 10} textAnchor="middle" fontSize={7} fontWeight={700} fill={color} opacity={0.35}>{fmtBal(balance)}</text>}
    </g>
  );
}

// Animated flow edges (marching dashes)
// Commons is ALWAYS visible — it connects to everything via tax/distribution.
function FlowEdges({ edges, posOf, nodeLayerMap, hasSel, color = "#92702a", marker = "arrFlow" }) {
  return edges.map(({ from, to }) => {
    const f = posOf(from), t = posOf(to);
    if (!f || !t) return null;
    const involvesCommons = from === "commons" || to === "commons";
    const inR = !hasSel || involvesCommons || (nodeLayerMap[from] !== undefined && nodeLayerMap[to] !== undefined);
    const dim = hasSel && !inR;
    return (
      <g key={`fe-${from}-${to}`}>
        <path d={edgePath(f, t)} fill="none" stroke={color} strokeWidth={dim ? 0.5 : 2} opacity={dim ? 0.06 : 0.3} filter={dim ? "none" : "url(#softglow)"} />
        <path d={edgePath(f, t)} fill="none" stroke={dim ? "#6b4d2e" : color} strokeWidth={dim ? 0.5 : 2} strokeDasharray="7 5" opacity={dim ? 0.1 : 0.85} markerEnd={dim ? undefined : `url(#${marker})`} style={{ animation: dim ? "none" : "march 0.4s linear infinite" }} />
      </g>
    );
  });
}

// Animated particles traveling along edges
// Commons is ALWAYS visible — never hidden by selection.
function FlowParticles({ edges, posOf, nodeLayerMap, hasSel, color = "#92702a", colorBright = "#c9a265" }) {
  return edges.map(({ from, to, progress }) => {
    const involvesCommons = from === "commons" || to === "commons";
    const inR = !hasSel || involvesCommons || (nodeLayerMap[from] !== undefined && nodeLayerMap[to] !== undefined);
    if (hasSel && !inR) return null;
    const f = posOf(from), t = posOf(to);
    if (!f || !t) return null;
    return [0, 0.42].map((off, pi) => {
      const { x, y } = bezAt(f, t, (progress + off) % 1);
      return <circle key={`pt-${from}-${to}-${pi}`} cx={x} cy={y} r={pi === 0 ? 4 : 2.5} fill={pi === 0 ? colorBright : color} opacity={pi === 0 ? 0.9 : 0.55} filter="url(#glow)" />;
    });
  });
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 8b: RAMIFICATION CANVAS                                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function SectorArc({ startDeg, spanDeg, color, r1, r2 }) {
  const s = (startDeg - 90) * Math.PI / 180;
  const e = (startDeg + spanDeg - 90) * Math.PI / 180;
  const large = spanDeg > 180 ? 1 : 0;
  const d = [
    `M${CX + r1 * Math.cos(s)},${CY + r1 * Math.sin(s)}`,
    `L${CX + r2 * Math.cos(s)},${CY + r2 * Math.sin(s)}`,
    `A${r2},${r2} 0 ${large},1 ${CX + r2 * Math.cos(e)},${CY + r2 * Math.sin(e)}`,
    `L${CX + r1 * Math.cos(e)},${CY + r1 * Math.sin(e)}`,
    `A${r1},${r1} 0 ${large},0 ${CX + r1 * Math.cos(s)},${CY + r1 * Math.sin(s)}`,
  ].join(" ");
  return <path d={d} fill={color} opacity={0.06} />;
}

const RamNode = memo(function RamNode({ layout, balance, min, max, selected, onClick }) {
  const { x, y, r, type, color, label } = layout;
  const fill = nodeColor(balance, min, max);
  const isCommoner = type === "commoner";
  const stroke = type === "field" ? "#fcd34d" : color;
  const sw = type === "field" ? 3 : type === "meta" ? 2 : type === "pool" ? 1.5 : 1;
  const sr = selected ? r * 1.3 : r;
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      {isCommoner && <circle cx={x} cy={y} r={10} fill="transparent" />}
      {selected && <circle cx={x} cy={y} r={sr + 6} fill="none" stroke={fill} strokeWidth={2} opacity={0.6} filter="url(#nglow)" />}
      <circle cx={x} cy={y} r={sr} fill={fill} opacity={selected ? 0.9 : 0.7} stroke={stroke} strokeWidth={sw} />
      {!isCommoner && <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={type === "field" ? 7 : type === "meta" ? 6.5 : 5.5} fontWeight={700} fill="#1a1008" style={{ pointerEvents: "none" }}>{label}</text>}
      {!isCommoner && balance > 0 && <text x={x} y={y + sr + 9} textAnchor="middle" fontSize={type === "field" ? 8 : 7} fontWeight={700} fill={fill} opacity={0.8}>{fmtBal(balance)}</text>}
    </g>
  );
});

const RamificationCanvas = memo(function RamificationCanvas({ snap, thresholds, ramSel, setRamSel, onInject }) {
  const allEdges = useAllActiveEdges(snap.flights, snap.ts);

  const posOf = useCallback((id) => {
    const l = RAM_LAYOUT.get(id);
    return l ? { x: l.x, y: l.y } : null;
  }, []);

  const connectedSet = useMemo(() => {
    if (!ramSel) return null;
    const s = new Set();
    for (const cat of ["field", "meta", "pool"])
      for (const e of allEdges[cat])
        if (e.from === ramSel || e.to === ramSel) s.add(`${e.from}-${e.to}`);
    return s;
  }, [ramSel, allEdges]);

  const renderEdges = (edges) => edges.map(({ from, to, level }) => {
    const f = posOf(from), t = posOf(to);
    if (!f || !t) return null;
    const color = ramEdgeColor(level);
    const cat = level === "field" ? "field" : level.startsWith("meta") ? "meta" : "pool";
    const baseOp = cat === "field" ? 0.4 : cat === "meta" ? 0.35 : 0.3;
    const baseW = cat === "field" ? 2.5 : cat === "meta" ? 1.8 : 1.4;
    const bright = ramSel && connectedSet && connectedSet.has(`${from}-${to}`);
    const dim = ramSel && !bright;
    const w = bright ? baseW * 1.8 : dim ? baseW * 0.4 : baseW;
    const op = bright ? Math.min(1, baseOp * 2.5) : dim ? baseOp * 0.15 : baseOp;
    const d = edgePath(f, t);
    return (<g key={`e-${from}-${to}`}>
      <path d={d} fill="none" stroke={color} strokeWidth={w} opacity={op * 0.4} />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeDasharray="5 4"
        opacity={op} style={dim ? undefined : { animation: "march 0.4s linear infinite" }} />
    </g>);
  });

  const renderParticles = (edges) => edges.map(({ from, to, progress, level }) => {
    if (ramSel && connectedSet && !connectedSet.has(`${from}-${to}`)) return null;
    const f = posOf(from), t = posOf(to);
    if (!f || !t) return null;
    const color = ramEdgeColor(level);
    const cat = level === "field" ? "field" : level.startsWith("meta") ? "meta" : "pool";
    const pr = cat === "field" ? 4 : cat === "meta" ? 3.5 : 3;
    const { x, y } = bezAt(f, t, progress);
    return <circle key={`p-${from}-${to}`} cx={x} cy={y} r={pr} fill={color} opacity={0.85} filter="url(#glow)" />;
  });

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <SvgDefs />
      <SectorArc startDeg={0} spanDeg={120} color={META_DEFS[0].color} r1={30} r2={310} />
      <SectorArc startDeg={120} spanDeg={120} color={META_DEFS[1].color} r1={30} r2={310} />
      <SectorArc startDeg={240} spanDeg={120} color={META_DEFS[2].color} r1={30} r2={310} />
      <OrbitRing r={65} stroke="#3d2b14" width={0.5} dash="3 8" opacity={0.15} />
      <OrbitRing r={150} stroke="#3d2b14" width={0.5} dash="3 8" opacity={0.15} />
      <OrbitRing r={270} stroke="#3d2b14" width={0.5} dash="3 8" opacity={0.1} />
      {renderEdges(allEdges.pool)}
      {renderEdges(allEdges.meta)}
      {renderEdges(allEdges.field)}
      {renderParticles(allEdges.pool)}
      {renderParticles(allEdges.meta)}
      {renderParticles(allEdges.field)}
      {RAM_ENTRIES.map(([gid, layout]) => {
        const data = ramNodeData(gid, snap, thresholds);
        return <RamNode key={gid} layout={layout} balance={data.balance} min={data.min} max={data.max}
          selected={ramSel === gid} onClick={() => ramSel === gid ? onInject(gid) : setRamSel(gid)} />;
      })}
    </svg>
  );
});

function RamDetailPanel({ ramSel, snap, thresholds, setRamSel, sim }) {
  if (!ramSel) {
    const total = snap.pools.reduce((s, p) => s + p.balances.reduce((a, b) => a + b, 0) + p.commonsBalance, 0)
      + snap.metaCommons.reduce((s, mc) => s + mc.balance, 0) + snap.fieldCommonsBalance;
    const banked = snap.pools.reduce((s, p) => s + p.banked.reduce((a, b) => a + b, 0) + p.commonsBanked, 0)
      + snap.metaCommons.reduce((s, mc) => s + mc.banked, 0) + snap.fieldCommonsBanked;
    return (
      <div style={{ animation: "fadein 0.25s ease" }}>
        <PanelHeader title="Ramification" subtitle="ALL 104 ENTITIES" color="#fcd34d" />
        <div style={{ ...S.panel, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div><div style={{ fontSize: 18, fontWeight: 700, color: "#fcd34d" }}>${Math.round(total).toLocaleString()}</div><div style={{ ...S.label }}>ACTIVE</div></div>
            {banked > 0 && <div><div style={{ fontSize: 18, fontWeight: 700, color: "#fcd34d" }}>${Math.round(banked).toLocaleString()}</div><div style={{ ...S.label }}>BANKED</div></div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {META_DEFS.map((m, mi) => {
              let mTotal = snap.metaCommons[mi].balance;
              for (const pIdx of m.pools) mTotal += snap.pools[pIdx].balances.reduce((a, b) => a + b, 0) + snap.pools[pIdx].commonsBalance;
              return <div key={mi} style={{ fontSize: 9 }}><span style={{ color: m.color }}>{m.short}:</span> <span style={{ color: "#c4a97a" }}>${Math.round(mTotal).toLocaleString()}</span></div>;
            })}
          </div>
        </div>
        <div style={{ fontSize: 9, color: "#6b4d2e", lineHeight: 1.8 }}>
          Click any node to see details.<br />
          1 field · 3 meta · 10 pool commons · 90 commoners
        </div>
      </div>
    );
  }
  const layout = RAM_LAYOUT.get(ramSel);
  const data = ramNodeData(ramSel, snap, thresholds);
  const subtree = ramSubtreeTotal(ramSel, snap);
  if (!layout || !data) return null;
  const col = nodeColor(data.balance, data.min, data.max);
  const state = getState(data.balance, data.min, data.max);
  const levelLabel = layout.type === "field" ? "FIELD COMMONS" : layout.type === "meta" ? "META COMMONS" : layout.type === "pool" ? "POOL COMMONS" : "COMMONER";
  const parentLabel = layout.metaIdx >= 0 ? (layout.poolIdx >= 0 ? POOL_DEFS[layout.poolIdx].label + " · " + META_DEFS[layout.metaIdx].short : META_DEFS[layout.metaIdx].short) : "";
  return (
    <div style={{ animation: "fadein 0.25s ease" }}>
      <PanelHeader title={layout.label} subtitle={`${levelLabel}${parentLabel ? " · " + parentLabel : ""} · ${state.toUpperCase()}`} color={col} onBack={() => setRamSel(null)} />
      <BalanceBar balance={data.balance} min={data.min} max={data.max} color={col} />
      {subtree && (
        <div style={{ ...S.panel, padding: "8px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...S.label }}>SUBTREE TOTAL</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#c4a97a" }}>${Math.round(subtree.balance).toLocaleString()}</div>
          </div>
          {subtree.banked > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <div style={{ ...S.label, color: "#fcd34d" }}>SUBTREE BANKED</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fcd34d" }}>${Math.round(subtree.banked).toLocaleString()}</div>
          </div>}
        </div>
      )}
      {(() => {
        const childTh = commonsAvgChildTh(ramSel, thresholds);
        return childTh
          ? <CommonsThresholdEditor value={{ min: data.min, max: data.max }}
              avgChildMin={childTh.avgChildMin} avgChildMax={childTh.avgChildMax}
              onChange={(f, v) => ramSetThreshold(ramSel, sim, f, v)} />
          : <ThresholdEditor value={{ min: data.min, max: data.max }}
              onChange={(f, v) => ramSetThreshold(ramSel, sim, f, v)} />;
      })()}
      <ActionButtons onInject={() => ramInject(ramSel, sim)} amt={CFG.defaults.injectAmt}
        onFill={() => ramFill(ramSel, sim)} showFill={data.balance < data.max} />
      {data.banked > 0 && (
        <div style={{ ...S.panel, padding: "10px 14px", marginBottom: 10, borderLeft: "3px solid #fcd34d", borderTop: "1px solid #fcd34d18", borderRight: "1px solid #fcd34d18", borderBottom: "1px solid #fcd34d18" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...S.label, color: "#fcd34d" }}>BANKED</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fcd34d" }}>${Math.round(data.banked).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 9: LEVEL CANVAS                                                    ║
// ║  The SINGLE canvas component. Self-similar at every holonic level.          ║
// ║                                                                              ║
// ║  Visual structure (concentric orbits from center outward):                  ║
// ║    1. Commons pool at CX,CY                                                 ║
// ║    2. Satellite nodes on orbits.nodeR                                        ║
// ║    3. Membrane ring around the node orbit                                    ║
// ║    4. [If outer exists] Sibling pools on orbits.siblingR                    ║
// ║    5. [If outer exists] Meta commons on orbits.metaR                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function LevelCanvas({ view, snap, sel, setSel, onNodeDrill, onZoomOut, onZoomToPool }) {
  const { nodes, clusters, positions, commons, ripples, normalizeId, flightLevel, outer } = view;
  const N = view.nodeCount;
  const npc = Math.ceil(N / clusters.length);

  // ── Normalize flight IDs to canvas IDs ────────────────────────────────
  const rawEdges = useActiveEdges(snap.flights, snap.ts, flightLevel);
  const activeEdges = useMemo(() => rawEdges.map(e => ({
    ...e, from: normalizeId(e.from), to: normalizeId(e.to),
  })), [rawEdges, normalizeId]);

  // ── Selection ripple (BFS from selected node) ────────────────────────
  const isNodeSel = typeof sel === "number";
  const ripple = useMemo(() => isNodeSel ? bfsLayers(sel, view.flowGraph) : null, [sel, isNodeSel, view.flowGraph]);
  const nodeLayerMap = useMemo(() => {
    const m = {};
    if (ripple) ripple.forEach((l, li) => l.forEach(id => { m[id] = li; }));
    return m;
  }, [ripple]);

  // ── Outer context positions (must be defined before posOf) ────────────
  const parentPos = useMemo(() => ({ x: CX, y: CY - CFG.orbits.metaR }), []);
  const siblingPositions = useMemo(() => {
    if (!outer) return [];
    return outer.siblings.map((sib, i) => {
      const angle = (2 * Math.PI * i) / Math.max(outer.siblings.length, 1) + Math.PI / 4;
      return { ...sib, x: CX + CFG.orbits.siblingR * Math.cos(angle), y: CY + CFG.orbits.siblingR * Math.sin(angle) };
    });
  }, [outer]);

  // ── Position resolver for this level's flights ────────────────────────
  const posOf = useCallback((id) => {
    if (id === "commons") return COMMONS_POS;
    return positions[id] || COMMONS_POS;
  }, [positions]);

  // Outer-level edge position resolver.
  // Maps flight IDs from the parent level to canvas positions.
  const outerPosOf = useCallback((id) => {
    if (!outer) return parentPos;
    // Parent commons (meta commons or field commons)
    if (id === outer.parent.flightId) return parentPos;
    // This level's commons → center
    if (id === outer.thisCommonsFlightId) return COMMONS_POS;
    // Check siblings by flightIds
    for (const sib of siblingPositions) {
      if (sib.flightIds && sib.flightIds.some(fid => fid === id)) return { x: sib.x, y: sib.y };
      // Also match "p{id}" targets → same position as "c{id}" sibling
      if (typeof id === "string" && id.startsWith("p")) {
        const gi = parseInt(id.slice(1));
        if (sib.id === gi) return { x: sib.x, y: sib.y };
      }
      if (typeof id === "string" && id.startsWith("mc")) {
        const mi = parseInt(id.slice(2));
        if (sib.id === mi) return { x: sib.x, y: sib.y };
      }
    }
    return parentPos;
  }, [outer, siblingPositions, parentPos]);

  const outerEdges = useMemo(() => {
    if (!outer) return [];
    const map = new Map();
    for (const f of outer.metaFlights) {
      if (snap.ts - f.startMs >= CFG.timing.travelMs + 80) continue;
      const key = `${f.from}-${f.to}`;
      const progress = Math.min(1, (snap.ts - f.startMs) / CFG.timing.travelMs);
      if (!map.has(key) || map.get(key).progress < progress)
        map.set(key, { from: f.from, to: f.to, progress });
    }
    return [...map.values()];
  }, [outer, snap.ts]);

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <SvgDefs />

      {/* ── MEMBRANE 3: Parent boundary (outermost) ── */}
      {outer && <>
        <Membrane r={CFG.orbits.metaR + 14} label={outer.parentLabel} color={outer.parent.color || "#b87333"} opacity={0.25} />
        <OrbitRing r={CFG.orbits.metaR} stroke={outer.parent.color || "#b87333"} width={0.5} dash="2 10" opacity={0.06} />
        <GhostNode x={parentPos.x} y={parentPos.y} r={CFG.orbits.metaSize}
          label={outer.parent.label} balance={outer.parent.balance}
          color={nodeColor(outer.parent.balance, outer.parent.th.min, outer.parent.th.max)}
          onClick={onZoomOut} />
      </>}

      {/* ── MEMBRANE 2: Sibling boundary ── */}
      {outer && <>
        <Membrane r={CFG.orbits.siblingR + 14} label={outer.siblingLabel} color="#5a4020" opacity={0.2} />
        <OrbitRing r={CFG.orbits.siblingR} stroke="#6b4d2e" width={0.5} dash="2 10" opacity={0.08} />
        {siblingPositions.map(sib => (
          <GhostNode key={sib.id} x={sib.x} y={sib.y} r={CFG.orbits.siblingSize}
            label={sib.label} balance={sib.balance} color={sib.color}
            onClick={() => onZoomToPool && onZoomToPool(sib.id)} />
        ))}

        {/* Outer-level flow edges — gold */}
        <FlowEdges edges={outerEdges} posOf={outerPosOf} nodeLayerMap={{}} hasSel={false} color="#fcd34d" marker="arrMeta" />
        <FlowParticles edges={outerEdges} posOf={outerPosOf} nodeLayerMap={{}} hasSel={false} color="#fcd34d" colorBright="#fef3c7" />
      </>}

      {/* ── MEMBRANE 1: This pool's boundary ── */}
      <Membrane r={CFG.orbits.nodeR + 14} label={commons.label1 + " MEMBRANE"} color="#3d2b14" opacity={0.5} />

      {/* ── Cluster arcs (subtle tints on the node orbit) ── */}
      {clusters.map((cl, c) => {
        const r = CFG.orbits.nodeR + 20;
        const start = c * npc, end = Math.min(start + npc - 1, N - 1);
        const s = (2 * Math.PI * start) / N - Math.PI / 2;
        const e = (2 * Math.PI * end) / N - Math.PI / 2;
        return <path key={c} d={`M${CX + r * Math.cos(s)},${CY + r * Math.sin(s)} A${r},${r} 0 ${Math.abs(e - s) > Math.PI ? 1 : 0},1 ${CX + r * Math.cos(e)},${CY + r * Math.sin(e)}`} fill="none" stroke={cl.color} strokeWidth={1.5} opacity={0.18} />;
      })}

      {/* ── ORBIT 1: Node orbit ring (faint guide) ── */}
      <OrbitRing r={CFG.orbits.nodeR} stroke="#3d2b14" width={0.5} dash="1 8" opacity={0.3} />

      {/* ── CENTER: Commons pool ── */}
      <CommonsNode r={CFG.orbits.commonsR}
        balance={commons.balance} min={commons.min} max={commons.max}
        selected={sel === "commons"} label1={commons.label1} label2={commons.label2}
        ripples={ripples}
        onClick={() => sel === "commons" ? view.actions.injectCommons() : setSel("commons")} />

      {/* ── Flow edges between nodes ── */}
      <FlowEdges edges={activeEdges} posOf={posOf} nodeLayerMap={nodeLayerMap} hasSel={isNodeSel}
        color={outer ? "#92702a" : "#fcd34d"} marker={outer ? "arrFlow" : "arrMeta"} />

      {/* ── Ripple topology edges (dashed, when node selected) ── */}
      {ripple && ripple.slice(0, -1).map((layer, li) =>
        layer.map(from =>
          (view.flowGraph[from] || [])
            .filter(to => ripple[li + 1]?.includes(to))
            .filter(to => !activeEdges.some(e => e.from === from && e.to === to))
            .map(to => <path key={`rip-${from}-${to}`} d={edgePath(positions[from], positions[to])} fill="none" stroke={LAYER_COLORS[li]} strokeWidth={li === 0 ? 1.8 : 1.2} strokeDasharray="3 6" opacity={0.4} markerEnd={`url(#arrL${li})`} />)
        )
      )}

      {/* ── Flow particles ── */}
      <FlowParticles edges={activeEdges} posOf={posOf} nodeLayerMap={nodeLayerMap} hasSel={isNodeSel}
        color={outer ? "#92702a" : "#fcd34d"} colorBright={outer ? "#c9a265" : "#fef3c7"} />

      {/* ── Satellite nodes on ORBIT 1 ── */}
      {nodes.map((node, i) => (
        <SatelliteNode key={i} x={positions[i].x} y={positions[i].y} r={CFG.orbits.nodeSize}
          name={node.shortName} balance={node.balance} min={node.min} max={node.max}
          selected={sel === i} layerIdx={nodeLayerMap[i]} healthColor={node.healthColor}
          dimmed={sel !== null && nodeLayerMap[i] === undefined}
          isYou={view.levelId === `pool${YOU.poolIdx}` && i === YOU.nodeIdx}
          onClick={() => sel === i ? (onNodeDrill ? onNodeDrill(i) : view.actions.injectNode(i)) : setSel(i)} />
      ))}
    </svg>
  );
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 10: REUSABLE PANEL COMPONENTS                                      ║
// ║  Small building blocks for the side panel. Stateless.                       ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const S = {
  panel: { background: "#120b04", borderRadius: 4, border: "1px solid #3d2b14" },
  label: { fontSize: 10, letterSpacing: "0.14em", color: "#6b4d2e" },
};

function HoverBtn({ onClick, bg, hoverBg, color, border, style, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      style={{ background: hover ? hoverBg : bg, border: border || "none", borderRadius: 5, cursor: "pointer", color, fontFamily: "inherit", ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>{children}</button>
  );
}

function PanelHeader({ title, subtitle, color, onBack }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: "-0.02em" }}>{title}</div>
        <div style={{ ...S.label }}>{subtitle}</div>
      </div>
      {onBack && <button onClick={onBack} style={{ ...S.panel, color: "#7a5c3a", padding: "4px 10px", cursor: "pointer", fontSize: 9, fontFamily: "inherit" }}>← BACK</button>}
    </div>
  );
}

function BalanceBar({ balance, min, max, color }) {
  const pct = Math.min(100, max > 0 ? (balance / max) * 100 : 0);
  const minPct = Math.min(100, max > 0 ? (min / max) * 100 : 0);
  const state = getState(balance, min, max);
  const toMax = Math.max(0, max - balance);
  return (
    <div style={{ ...S.panel, padding: "12px 14px", marginBottom: 10, borderLeft: `3px solid ${color}`, borderTop: `1px solid ${color}20`, borderRight: `1px solid ${color}20`, borderBottom: `1px solid ${color}20` }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 6, color: "#8b6d45" }}>
        <span style={{ color: TRAFFIC.deficit }}>MIN ${min.toLocaleString()}</span>
        <span style={{ color: "#faf0e2", fontWeight: 700, fontSize: 12 }}>${Math.round(balance).toLocaleString()}</span>
        <span style={{ color: TRAFFIC.atMax }}>MAX ${max.toLocaleString()}</span>
      </div>
      <div style={{ height: 12, background: "#3d2b14", borderRadius: 6, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${TRAFFIC.deficit}, ${color})`, borderRadius: 6, transition: "width 0.4s ease" }} />
        <div style={{ position: "absolute", top: 0, left: `${minPct}%`, width: 2, height: "100%", background: `${TRAFFIC.deficit}80` }} />
      </div>
      <div style={{ fontSize: 9, marginTop: 6, color }}>
        {state === "unengaged" && `↓ $${Math.round(min - balance).toLocaleString()} to minimum`}
        {state === "engaged" && `↑ $${Math.round(toMax).toLocaleString()} to maximum · engaged`}
        {state === "abundant" && `At maximum · routing 100% of surplus outward`}
      </div>
    </div>
  );
}

function ThresholdEditor({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 10 }}>
      {[["min", TRAFFIC.deficit, "MIN"], ["max", TRAFFIC.atMax, "MAX"]].map(([f, c, l]) => (
        <div key={f} style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: c, letterSpacing: "0.1em", marginBottom: 3 }}>{l}</div>
          <input type="number" value={value[f]} step={1000} onChange={e => onChange(f, e.target.value)}
            aria-label={l + " threshold"}
            style={{ width: "100%", boxSizing: "border-box", background: "#3d2b14", border: `1px solid ${c}40`, borderRadius: 4, color: c, fontSize: 10, fontWeight: 700, padding: "4px 6px", fontFamily: "monospace" }} />
        </div>
      ))}
    </div>
  );
}

function CommonsThresholdEditor({ value, avgChildMin, avgChildMax, onChange }) {
  const minMult = avgChildMin > 0 ? value.min / avgChildMin : 0;
  const maxMult = avgChildMax > 0 ? value.max / avgChildMax : 0;
  return (
    <div style={{ marginTop: 10, marginBottom: 10 }}>
      {[
        { field: "min", color: TRAFFIC.deficit, label: "MIN", mult: minMult, avg: avgChildMin },
        { field: "max", color: TRAFFIC.atMax, label: "MAX", mult: maxMult, avg: avgChildMax },
      ].map(({ field, color, label, mult, avg }) => (
        <div key={field} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
            <span style={{ fontSize: 10, color, letterSpacing: "0.1em" }}>{label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>
              <span style={{ color }}>{mult.toFixed(1)}{"\u00D7"}</span>
              <span style={{ color: "#8b6d45", fontWeight: 400, fontSize: 9 }}> avg child {field}</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, position: "relative", height: 18 }}>
              <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 4, borderRadius: 2, background: "#3d2b14" }} />
              <div style={{ position: "absolute", top: 7, left: 0, width: `${Math.min(100, mult / 5 * 100)}%`, height: 4, borderRadius: 2, background: `linear-gradient(90deg, #946b3c, ${color})` }} />
              <input type="range" min={0} max={5} step={0.1} value={mult}
                aria-label={`${label} multiplier`}
                onChange={e => onChange(field, Math.round(parseFloat(e.target.value) * avg))}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 18, opacity: 0, cursor: "pointer", margin: 0 }} />
            </div>
            <span style={{ fontSize: 9, color: "#8b6d45", minWidth: 55, textAlign: "right" }}>
              ${Math.round(mult * avg).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionButtons({ onInject, amt, onFill, showFill }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
      <HoverBtn onClick={onInject} bg="#fcd34d" hoverBg="#fbbf24" color="#1a1008"
        style={{ flex: 1, padding: "9px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>
        ⚡ +${amt.toLocaleString()}
      </HoverBtn>
      {showFill && (
        <HoverBtn onClick={onFill} bg="transparent" hoverBg="#b8733315" color="#b87333" border="1px solid #b8733350"
          style={{ flex: 1, padding: "9px 0", fontSize: 9, fontWeight: 700, letterSpacing: "0.04em" }}>FILL TO MAX</HoverBtn>
      )}
    </div>
  );
}

const FlowLog = memo(function FlowLog({ log }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!log.length) return null;
  const recent = log.slice(0, 12);
  const logText = log.join("\n");
  const handleCopy = () => {
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{ ...S.panel, padding: "8px 12px", marginBottom: 10, borderLeft: "3px solid #fcd34d", borderTop: "1px solid #fcd34d15", borderRight: "1px solid #fcd34d15", borderBottom: "1px solid #fcd34d15" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ ...S.label, color: "#fcd34d", letterSpacing: "0.18em" }}>FLOW LOG ({log.length})</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={handleCopy}
            style={{ background: copied ? "#4ade8030" : "#3d2b14", border: `1px solid ${copied ? "#4ade80" : "#fcd34d60"}`, borderRadius: 4, color: copied ? "#4ade80" : "#fcd34d", fontSize: 10, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", padding: "4px 10px", letterSpacing: "0.06em" }}>
            {copied ? "COPIED" : "COPY"}
          </button>
          <button onClick={() => setExpanded(e => !e)}
            style={{ background: expanded ? "#fcd34d20" : "#3d2b14", border: "1px solid #fcd34d60", borderRadius: 4, color: "#fcd34d", fontSize: 10, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", padding: "4px 10px", letterSpacing: "0.06em" }}>
            {expanded ? "HIDE" : "EXPAND"}
          </button>
        </div>
      </div>
      {recent.map((l, i) => (
        <div key={i} style={{ fontSize: 9, marginBottom: 2, color: i === 0 ? "#fef9c3" : `rgba(139,109,69,${Math.max(0.15, 1 - i * 0.1)})`, animation: i === 0 ? "slideup 0.3s ease" : "none" }}>{l}</div>
      ))}
      {expanded && (
        <textarea readOnly value={logText}
          onClick={e => e.target.select()}
          style={{ width: "100%", boxSizing: "border-box", height: 200, marginTop: 8, background: "#1a1008", border: "1px solid #6b4d2e", borderRadius: 4, color: "#c4a97a", fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", padding: 8, resize: "vertical" }} />
      )}
    </div>
  );
});

function ParamSlider({ label, hint, value, min, max, step, format, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#c4a97a", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#fcd34d", fontFamily: "monospace", whiteSpace: "nowrap", marginLeft: 8 }}>{format(value)}</span>
      </div>
      <div style={{ position: "relative", height: 18 }}>
        <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 4, borderRadius: 2, background: "#3d2b14" }} />
        <div style={{ position: "absolute", top: 7, left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: "linear-gradient(90deg, #946b3c, #fcd34d)" }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
          aria-label={label}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 18, opacity: 0, cursor: "pointer", margin: 0 }} />
      </div>
      <div style={{ fontSize: 9, color: "#6b4d2e", marginTop: 3, fontStyle: "italic" }}>{hint}</div>
    </div>
  );
}

function ViewToggle({ viewMode, onViewMode }) {
  const modes = [
    { key: "personal", icon: "\u25CF", label: "YOU" },
    { key: "team",     icon: "\u25CE", label: "POOL" },
    { key: "meta",     icon: "\u25C8", label: "META" },
    { key: "network",  icon: "\u2B21", label: "FIELD" },
  ];
  return (
    <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #3d2b14" }}>
      {modes.map(m => {
        const active = viewMode === m.key;
        return (
          <button key={m.key} onClick={() => onViewMode(m.key)}
            style={{ flex: 1, padding: "7px 0", fontSize: 9, fontWeight: 700, fontFamily: "inherit",
              letterSpacing: "0.08em", cursor: "pointer", border: "none",
              background: active ? "#3d2b14" : "transparent",
              color: active ? "#fcd34d" : "#6b4d2e" }}>
            {m.icon} {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 10b: EPOCH CONTROLS                                                ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const EPOCH_PRESETS = [
  { label: "DAILY", value: 1, name: "Daily" },
  { label: "WEEKLY", value: 7, name: "Weekly" },
  { label: "LUNAR", value: 29, name: "Lunar" },
  { label: "SEASONAL", value: 91, name: "Seasonal" },
  { label: "SOLAR", value: 365, name: "Solar" },
];

function EpochSelector({ epochLength, epochDay, epochCount, onSetEpochLength }) {
  const [customMode, setCustomMode] = useState(false);
  const presetMatch = EPOCH_PRESETS.find(p => p.value === epochLength);
  const pct = epochLength > 0 ? Math.min(100, (epochDay / epochLength) * 100) : 0;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#fcd34d", fontWeight: 700 }}>
          EPOCH {epochCount + 1} {"\u00B7"} DAY {epochDay + 1}/{epochLength}
        </div>
        <div style={{ fontSize: 9, color: "#8b6d45" }}>
          {presetMatch ? presetMatch.name : "Custom"}
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, background: "#3d2b14", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
        <div style={{
          height: "100%", borderRadius: 3,
          width: `${pct}%`,
          background: pct < 50 ? `linear-gradient(90deg, ${TRAFFIC.deficit}, ${TRAFFIC.flowing})` : `linear-gradient(90deg, ${TRAFFIC.flowing}, ${TRAFFIC.atMax})`,
          transition: "width 0.3s ease",
        }} />
      </div>
      {/* Preset pills */}
      <div style={{ display: "flex", gap: 3 }}>
        {EPOCH_PRESETS.map(p => {
          const active = epochLength === p.value && !customMode;
          return (
            <button key={p.value} onClick={() => { setCustomMode(false); onSetEpochLength(p.value); }}
              style={{
                flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer",
                fontSize: 9, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.06em",
                background: active ? "#3d2b14" : "transparent",
                border: `1px solid ${active ? "#fcd34d" : "#3d2b14"}`,
                color: active ? "#fcd34d" : "#6b4d2e",
              }}>
              {p.label}
            </button>
          );
        })}
        <button onClick={() => setCustomMode(true)}
          style={{
            flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer",
            fontSize: 9, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.06em",
            background: customMode || !presetMatch ? "#3d2b14" : "transparent",
            border: `1px solid ${customMode || !presetMatch ? "#fcd34d" : "#3d2b14"}`,
            color: customMode || !presetMatch ? "#fcd34d" : "#6b4d2e",
          }}>
          CUSTOM
        </button>
      </div>
      {(customMode || !presetMatch) && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#8b6d45" }}>Days:</span>
          <input type="number" value={epochLength} min={1} max={9999}
            onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 1); onSetEpochLength(v); }}
            style={{ width: 60, background: "#3d2b14", border: "1px solid #fcd34d40", borderRadius: 4, color: "#fcd34d", fontSize: 10, fontWeight: 700, padding: "3px 6px", fontFamily: "monospace" }} />
        </div>
      )}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 11: UNIFIED SIDE PANELS                                            ║
// ║  Same panel renders for person nodes and pool nodes.                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function FlowPeerChip({ peer, flowing, onClick }) {
  const [hover, setHover] = useState(false);
  const c = nodeColor(peer.balance, peer.min, peer.max);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ padding: "5px 10px", borderRadius: 4, background: hover ? `${c}30` : `${c}18`, border: `1px solid ${flowing ? "#fcd34d" : c + "50"}`, cursor: "pointer", fontSize: 10, color: c, display: "flex", gap: 5, alignItems: "center", fontFamily: "inherit" }}>
      {peer.name}{flowing && <span style={{ color: "#fcd34d" }}>↝</span>}
    </button>
  );
}

function NodePanel({ nodeId, view, snap, setSel, onDrill }) {
  const node = view.nodes[nodeId];
  const col = node.healthColor || nodeColor(node.balance, node.min, node.max);
  const state = getState(node.balance, node.min, node.max);
  const toMax = Math.max(0, node.max - node.balance);
  const ripple = useMemo(() => bfsLayers(nodeId, view.flowGraph), [nodeId, view.flowGraph]);
  const totalReach = ripple.slice(1).reduce((s, l) => s + l.length, 0);
  const rawEdges = useActiveEdges(snap.flights, snap.ts, view.flightLevel);
  const activeEdges = useMemo(() => rawEdges.map(e => ({ ...e, from: view.normalizeId(e.from), to: view.normalizeId(e.to) })), [rawEdges, view.normalizeId]);
  const banked = node.banked || 0;
  const onTrack = node.balance >= node.min;

  return (
    <div style={{ animation: "fadein 0.25s ease" }}>
      <PanelHeader title={node.name} subtitle={`${(view.clusters[node.cluster]?.name || "").toUpperCase()} · ${state.toUpperCase()}`} color={col} onBack={() => setSel(null)} />
      <BalanceBar balance={node.balance} min={node.min} max={node.max} color={col} />

      {/* Epoch status hint */}
      {snap.totalInjected > 0 && (
        <div style={{ fontSize: 9, marginBottom: 8, padding: "4px 8px", borderRadius: 4, background: onTrack ? "#22c55e12" : "#f59e0b12", color: onTrack ? TRAFFIC.atMax : TRAFFIC.flowing }}>
          {onTrack ? "\u2713 On track to bank" : "\u26A0 Below minimum \u2014 will return to commons"}
        </div>
      )}

      {/* Banked display */}
      {banked > 0 && (
        <div style={{ ...S.panel, padding: "10px 14px", marginBottom: 10, borderLeft: "3px solid #fcd34d", borderTop: "1px solid #fcd34d18", borderRight: "1px solid #fcd34d18", borderBottom: "1px solid #fcd34d18" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...S.label, color: "#fcd34d" }}>BANKED</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fcd34d" }}>${Math.round(banked).toLocaleString()}</div>
          </div>
          <div style={{ fontSize: 9, color: "#8b6d45", marginTop: 4 }}>Earned across {snap.epochCount} epoch{snap.epochCount !== 1 ? "s" : ""}. Free to spend.</div>
        </div>
      )}

      <ThresholdEditor value={{ min: node.min, max: node.max }} onChange={(f, v) => view.actions.setNodeTh(nodeId, f, v)} />

      {/* Declared flows */}
      <div style={{ ...S.panel, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ ...S.label, marginBottom: 8 }}>DECLARED COMMONERS</div>
        <div style={{ fontSize: 9, color: "#8b6d45", marginBottom: 8, lineHeight: 1.6 }}>When {node.name} exceeds maximum, surplus resources:</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {node.flows.map(j => {
            const peer = view.nodes[j]; if (!peer) return null;
            const flowing = activeEdges.some(e => e.from === nodeId && e.to === j);
            return <FlowPeerChip key={j} peer={peer} flowing={flowing} onClick={() => setSel(j)} />;
          })}
        </div>
      </div>

      <ActionButtons onInject={() => view.actions.injectNode(nodeId)} amt={CFG.defaults.injectAmt}
        onFill={() => view.actions.fillNode(nodeId)} showFill={toMax > 0} />

      {/* Zoom into this node (meta level only) */}
      {onDrill && (
        <HoverBtn onClick={() => onDrill(nodeId)} bg="#3d2b14" hoverBg="#6b4d2e" color={col} border={`1px solid ${col}50`}
          style={{ width: "100%", padding: "10px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>
          ⬚ ZOOM INTO {node.name.toUpperCase()}
        </HoverBtn>
      )}

      {/* Ripple hop layers */}
      {[1, 2, 3].map(li => {
        const ln = ripple[li] ?? [];
        if (!ln.length) return null;
        return (
          <div key={li} style={{ ...S.panel, padding: "9px 11px", marginBottom: 6, borderLeft: `3px solid ${LAYER_COLORS[li]}`, borderTop: `1px solid ${LAYER_COLORS[li]}18`, borderRight: `1px solid ${LAYER_COLORS[li]}18`, borderBottom: `1px solid ${LAYER_COLORS[li]}18` }}>
            <div style={{ ...S.label, color: LAYER_COLORS[li], marginBottom: 6 }}>HOP {li} · {ln.length} HOLONS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {ln.map(id => { const n = view.nodes[id]; if (!n) return null; const c = nodeColor(n.balance, n.min, n.max);
                return <button key={id} onClick={() => setSel(id)} style={{ padding: "3px 8px", background: `${c}15`, border: `1px solid ${c}45`, borderRadius: 3, fontSize: 9, color: c, cursor: "pointer", fontFamily: "inherit" }}>{n.name}</button>; })}
            </div>
          </div>
        );
      })}

      {/* Membrane reach */}
      <div style={{ ...S.panel, padding: "10px 14px", marginTop: 2 }}>
        <div style={{ ...S.label, marginBottom: 6 }}>MEMBRANE REACH</div>
        <div style={{ display: "flex", gap: 20 }}>
          {[{ l: "HOLONS", v: 1 + totalReach }, { l: "COVERAGE", v: `${Math.round((1 + totalReach) / view.nodeCount * 100)}%` }, { l: "UNREACHED", v: view.nodeCount - 1 - totalReach }].map(s => (
            <div key={s.l}><div style={{ fontSize: 18, fontWeight: 700, color: "#c4a97a" }}>{s.v}</div><div style={{ ...S.label }}>{s.l}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommonsPanel({ view, snap, setSel }) {
  const { commons, nodes: allNodes } = view;
  const col = nodeColor(commons.balance, commons.min, commons.max);
  const state = getState(commons.balance, commons.min, commons.max);
  const toMax = Math.max(0, commons.max - commons.balance);
  const banked = commons.banked || 0;
  return (
    <div style={{ animation: "fadein 0.25s ease" }}>
      <PanelHeader title={`${commons.label1} ${commons.label2}`} subtitle={`SHARED MEMBRANE · ${state.toUpperCase()}`} color={col} onBack={() => setSel(null)} />
      <BalanceBar balance={commons.balance} min={commons.min} max={commons.max} color={col} />

      {/* Banked display */}
      {banked > 0 && (
        <div style={{ ...S.panel, padding: "10px 14px", marginBottom: 10, borderLeft: "3px solid #fcd34d", borderTop: "1px solid #fcd34d18", borderRight: "1px solid #fcd34d18", borderBottom: "1px solid #fcd34d18" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...S.label, color: "#fcd34d" }}>BANKED</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fcd34d" }}>${Math.round(banked).toLocaleString()}</div>
          </div>
          <div style={{ fontSize: 9, color: "#8b6d45", marginTop: 4 }}>Earned across {snap.epochCount} epoch{snap.epochCount !== 1 ? "s" : ""}. Free to spend.</div>
        </div>
      )}

      <CommonsThresholdEditor value={{ min: commons.min, max: commons.max }}
        avgChildMin={commons.avgChildMin} avgChildMax={commons.avgChildMax}
        onChange={(f, v) => view.actions.setCommonsTh(f, v)} />
      <ActionButtons onInject={() => view.actions.injectCommons()} amt={CFG.defaults.injectAmt}
        onFill={() => view.actions.fillCommons()} showFill={toMax > 0} />
      <div style={{ ...S.panel, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ ...S.label, marginBottom: 8 }}>DECLARED COMMONERS</div>
        {commons.flows.map((nId, slot) => (
          <div key={slot} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 8, color: "#7a5c3a", width: 14 }}>{slot + 1}.</span>
            <select value={nId} onChange={e => view.actions.setCommonsFlow(slot, Number(e.target.value))}
              style={{ flex: 1, background: "#3d2b14", border: "1px solid #6b4d2e", borderRadius: 4, color: "#c4a97a", fontSize: 9, padding: "4px 6px", fontFamily: "inherit", cursor: "pointer" }}>
              {allNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
        ))}
        <div style={{ fontSize: 8, color: "#6b4d2e", marginTop: 6, lineHeight: 1.6 }}>Surplus above max resources outward through declared commoners.</div>
      </div>
    </div>
  );
}

function NodeListItem({ node, onClick }) {
  const [hover, setHover] = useState(false);
  const col = nodeColor(node.balance, node.min, node.max);
  return (
    <li style={{ listStyle: "none" }}>
      <button onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 10px", width: "100%", boxSizing: "border-box", ...S.panel, borderLeft: `3px solid ${col}`, cursor: "pointer", marginBottom: 3, background: hover ? "#2a1c0e" : "#120b04", fontFamily: "inherit" }}>
        <span style={{ fontSize: 10, color: "#f5e6d0", fontWeight: 600 }}>{node.name}</span>
        <span style={{ fontSize: 9, color: col }}>${Math.round(node.balance).toLocaleString()}</span>
      </button>
    </li>
  );
}

function NodeList({ view, setSel }) {
  const npc = Math.ceil(view.nodeCount / view.clusters.length);
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {view.clusters.map((cl, c) => (
        <div key={c}>
          <div style={{ fontSize: 10, letterSpacing: "0.16em", color: cl.color, marginBottom: 4, marginTop: c > 0 ? 8 : 0, paddingLeft: 4 }}>{cl.name.toUpperCase()}</div>
          <ul style={{ margin: 0, padding: 0 }}>
            {view.nodes.filter(n => n.cluster === c).map(node => (
              <NodeListItem key={node.id} node={node} onClick={() => setSel(node.id)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 12: STYLES + PARAM DEFINITIONS                                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const CSS = `
  @keyframes march { to { stroke-dashoffset: -20; } }
  @keyframes overpulse { 0%,100%{opacity:.2} 50%{opacity:.6} }
  @keyframes fadein { from{opacity:0} to{opacity:1} }
  @keyframes slideup { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes receiptflash {
    0%   { opacity: 0.8; stroke-width: 3px; }
    100% { opacity: 0;   stroke-width: 1px; }
  }
  @keyframes membraneripple {
    0%   { r: 40px;  opacity: 0.2;  stroke-width: 1.5px; }
    70%  { r: 170px; opacity: 0.5;  stroke-width: 2.5px; }
    88%  { r: 200px; opacity: 1;    stroke-width: 5px;   }
    95%  { r: 208px; opacity: 1;    stroke-width: 7px;   }
    100% { r: 214px; opacity: 0;    stroke-width: 9px;   }
  }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #1a1008; }
  ::-webkit-scrollbar-thumb { background: #6b4d2e; border-radius: 2px; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 2px solid #d4913a;
    outline-offset: 2px;
  }
`;

const PARAM_DEFS = [
  { key: "outflowRate", label: "Outflow Rate", min: 0, max: 1.0, step: 0.01, fmt: v => `${Math.round(v * 100)}%`, hint: "% of surplus above min that flows outward" },
  { key: "peerSplit", label: "Peer / Commons Split", min: 0, max: 1.0, step: 0.01, fmt: v => `${Math.round(v * 100)}/${Math.round((1 - v) * 100)}`, hint: "Outflow split: commoners vs commons" },
  { key: "fieldRate", label: "Field Dispersal", min: 0.01, max: 1.0, step: 0.01, fmt: v => `${Math.round(v * 100)}%`, hint: "% of commons surplus dispersed to the field" },
];

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 13: APP                                                            ║
// ║  Pure composition. One canvas, one panel structure, at every level.         ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export default function App() {
  const sim = useSimulation();
  const { snap, params, thresholds, commonsFlows, metaFlows, metaCommonsFlows, fieldFlows, fieldCommonsFlows, log, commonsRipples } = sim;

  // ── Navigation state ──────────────────────────────────────────────────
  const [zoom, setZoom] = useState("field");       // "field" | "meta0"|"meta1"|"meta2" | poolIndex
  const [sel, setSel] = useState(null);            // null | "commons" | nodeIndex
  const [viewMode, setViewMode] = useState("network"); // "personal" | "team" | "network"
  const [vizMode, setVizMode] = useState("holonic"); // "holonic" | "ramification"
  const [ramSel, setRamSel] = useState(null);
  const { active: demo, setActive: setDemo } = useDemo(sim);
  const [depth, setDepthState] = useState("field");
  const handleDepth = useCallback((d) => { setDepthState(d); sim.setDepth(d); }, [sim]);
  const [showLog, setShowLog] = useState(false);
  const [injectMax, setInjectMax] = useState(100000);

  // ── Auto-time: advance epoch days on a timer ────────────────────────
  const [autoTime, setAutoTime] = useState(false);
  const [timeSpeed, setTimeSpeed] = useState(0);   // 0 (slow) → 1 (fast)
  // Power law: 10s/day at speed=0, ~30ms/day at speed=1
  const tickMs = useMemo(() => Math.round(10000 * Math.pow(30 / 10000, timeSpeed)), [timeSpeed]);

  useEffect(() => {
    if (!autoTime) return;
    const id = setInterval(() => sim.tickDay(), tickMs);
    return () => clearInterval(id);
  }, [autoTime, tickMs, sim.tickDay]);

  const handleViewMode = useCallback((mode) => {
    setViewMode(mode);
    switch (mode) {
      case "network":  setZoom("field"); setSel(null); break;
      case "meta":     setZoom(`meta${metaGroupOf(YOU.poolIdx)}`); setSel(null); break;
      case "team":     setZoom(YOU.poolIdx); setSel(null); break;
      case "personal": setZoom(YOU.poolIdx); setSel(YOU.nodeIdx); break;
    }
  }, []);

  // Navigate to a specific zoom target. Context-aware:
  // - At field: i is meta index → "meta{i}"
  // - At meta: i is local pool index → globalPoolIdx
  // - At pool: i is global pool index (for sibling navigation)
  const zoomIn = useCallback((i) => {
    if (zoom === "field") {
      setZoom(`meta${i}`); setSel(null);
    } else if (typeof zoom === "string" && zoom.startsWith("meta")) {
      const metaIdx = parseInt(zoom.slice(4));
      const globalPoolIdx = META_DEFS[metaIdx].pools[i];
      setZoom(globalPoolIdx); setSel(null);
    } else {
      // At pool level: i is a global pool index (sibling click)
      setZoom(i); setSel(null);
    }
  }, [zoom]);

  // Direct navigation for sibling ghost nodes (always uses global IDs)
  const zoomToSibling = useCallback((globalId) => {
    if (typeof zoom === "number") {
      // At pool level: sibling is another pool
      setZoom(globalId); setSel(null);
    } else if (typeof zoom === "string" && zoom.startsWith("meta")) {
      // At meta level: sibling is another meta
      setZoom(`meta${globalId}`); setSel(null);
    }
  }, [zoom]);

  const zoomOut = useCallback(() => {
    if (typeof zoom === "number") {
      // Pool → parent meta
      setZoom(`meta${metaGroupOf(zoom)}`); setSel(null);
    } else if (typeof zoom === "string" && zoom.startsWith("meta")) {
      // Meta → field
      setZoom("field"); setSel(null);
    } else {
      // Already at field
      setViewMode("network"); setZoom("field"); setSel(null);
    }
  }, [zoom]);

  const resetAll = useCallback(() => { sim.reset(); setSel(null); setDemo(false); setAutoTime(false); setViewMode("network"); setZoom("field"); handleDepth("field"); }, [sim, setDemo, handleDepth]);

  const effectiveSel = viewMode === "personal" ? YOU.nodeIdx : sel;

  // ── Normalized level view ─────────────────────────────────────────────
  const view = useMemo(() =>
    buildLevelView(zoom, snap, thresholds, sim, commonsFlows, metaFlows, metaCommonsFlows, fieldFlows, fieldCommonsFlows, commonsRipples),
    [zoom, snap, thresholds, sim, commonsFlows, metaFlows, metaCommonsFlows, fieldFlows, fieldCommonsFlows, commonsRipples]
  );

  // ── Derived counts ────────────────────────────────────────────────────
  // At field/meta level, count all people across relevant pools
  const counts = useMemo(() => {
    let d = 0, f = 0, fl = 0;
    if (zoom === "field" || (typeof zoom === "string" && zoom.startsWith("meta"))) {
      const poolRange = zoom === "field"
        ? Array.from({ length: CFG.poolCount }, (_, i) => i)
        : META_DEFS[parseInt(zoom.slice(4))].pools;
      for (const p of poolRange) {
        const ths = thresholds.pools[p].nodes;
        for (let i = 0; i < CFG.poolSize; i++) {
          const s = getState(snap.pools[p].balances[i], ths[i].min, ths[i].max);
          if (s === "unengaged") d++; else if (s === "abundant") f++; else fl++;
        }
      }
    } else {
      for (const n of view.nodes) { const s = getState(n.balance, n.min, n.max); if (s === "unengaged") d++; else if (s === "abundant") f++; else fl++; }
    }
    return { unengaged: d, engaged: fl, abundant: f };
  }, [zoom, view.nodes, snap.pools, thresholds.pools]);

  const totalInNetwork = snap.pools.reduce((s, p) => s + p.balances.reduce((a, b) => a + b, 0) + p.commonsBalance, 0)
    + snap.metaCommons.reduce((s, mc) => s + mc.balance, 0) + snap.fieldCommonsBalance;

  const canDrill = zoom === "field" || (typeof zoom === "string" && zoom.startsWith("meta"));

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#1a1008", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace", color: "#f5e6d0" }}>
      <style>{CSS}</style>

      {/* ═══ LEFT PANEL — System Controls ═══ */}
      <aside style={{ width: 320, boxSizing: "border-box", flexShrink: 0, flexGrow: 0, background: "#120b04", borderRight: "1px solid #3d2b14", overflowY: "auto", maxHeight: "100vh", padding: 16 }}>

        {/* Branding */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#6b4d2e", marginBottom: 3 }}>A THRESHOLD BASED MODEL</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#faf0e2" }}>Resource the Commons</div>
        </div>

        {/* Viz Mode Toggle */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #3d2b14" }}>
            {["holonic", "ramification"].map(m => (
              <button key={m} onClick={() => { setVizMode(m); if (m === "ramification") { setRamSel(null); handleDepth("field"); } }}
                style={{ flex: 1, padding: "7px 0", fontSize: 9, fontWeight: 700, fontFamily: "inherit",
                  letterSpacing: "0.08em", cursor: "pointer", border: "none",
                  background: vizMode === m ? "#3d2b14" : "transparent",
                  color: vizMode === m ? "#fcd34d" : "#6b4d2e" }}>
                {m === "holonic" ? "\u25CE HOLONIC" : "\u269B RAMIFICATION"}
              </button>
            ))}
          </div>
        </div>

        {/* View Toggle (holonic only) */}
        {vizMode === "holonic" && (
          <div style={{ marginBottom: 14 }}>
            <ViewToggle viewMode={viewMode} onViewMode={handleViewMode} />
          </div>
        )}

        {/* Epoch Controls */}
        <EpochSelector
          epochLength={params.epochLength}
          epochDay={snap.epochDay}
          epochCount={snap.epochCount}
          onSetEpochLength={v => sim.setParam("epochLength", v)}
        />

        {/* Time speed */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 14 }}>
          <button onClick={() => setAutoTime(a => !a)}
            style={{
              padding: "5px 10px", borderRadius: 4, cursor: "pointer",
              fontSize: 9, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.06em",
              background: autoTime ? `${TRAFFIC.atMax}20` : "transparent",
              border: `1px solid ${autoTime ? TRAFFIC.atMax : "#3d2b14"}`,
              color: autoTime ? TRAFFIC.atMax : "#6b4d2e", whiteSpace: "nowrap",
            }}>
            {autoTime ? "\u25FC" : "\u25B6"} TIME
          </button>
          <div style={{ flex: 1, position: "relative", height: 18 }}>
            <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 4, borderRadius: 2, background: "#3d2b14" }} />
            <div style={{ position: "absolute", top: 7, left: 0, width: `${timeSpeed * 100}%`, height: 4, borderRadius: 2, background: "linear-gradient(90deg, #946b3c, #fcd34d)" }} />
            <input type="range" min={0} max={1} step={0.02} value={timeSpeed}
              onChange={e => setTimeSpeed(parseFloat(e.target.value))}
              aria-label="Time speed"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 18, opacity: 0, cursor: "pointer", margin: 0 }} />
          </div>
          <span style={{ fontSize: 8, color: "#8b6d45", whiteSpace: "nowrap", minWidth: 42, textAlign: "right" }}>
            {tickMs >= 1000 ? `${(tickMs / 1000).toFixed(1)}s` : `${tickMs}ms`}/d
          </span>
        </div>

        {/* Simulation boundary */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 8, color: "#6b4d2e", letterSpacing: "0.12em", marginBottom: 4, fontWeight: 700 }}>BOUNDARY</div>
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #3d2b14" }}>
            {DEPTH_LEVELS.map(d => {
              const active = depth === d.key;
              return (
                <button key={d.key} onClick={() => handleDepth(d.key)}
                  style={{ flex: 1, padding: "5px 0", fontSize: 8, fontWeight: 700, fontFamily: "inherit",
                    letterSpacing: "0.06em", cursor: "pointer", border: "none",
                    background: active ? "#3d2b14" : "transparent",
                    color: active ? "#fcd34d" : "#6b4d2e" }}>
                  {d.icon} {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button onClick={() => setDemo(d => !d)}
            aria-label={demo ? "Stop demo mode" : "Start demo mode"}
            style={{ flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.08em", background: demo ? `${TRAFFIC.atMax}20` : "transparent", border: `1px solid ${demo ? TRAFFIC.atMax : "#6b4d2e"}`, color: demo ? TRAFFIC.atMax : "#7a5c3a" }}>
            {demo ? "\u25FC DEMO" : "\u25B6 DEMO"}
          </button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <HoverBtn onClick={resetAll} bg="transparent" hoverBg="transparent" color="#7a5c3a" border="1px solid #6b4d2e" style={{ flex: 1, padding: "5px 0", fontSize: 9, letterSpacing: "0.08em" }}>{"\u21BA"} RESET</HoverBtn>
          {log.length > 0 && (
            <button onClick={() => setShowLog(true)}
              style={{ flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.08em", background: "#fcd34d20", border: "1px solid #fcd34d", color: "#fcd34d" }}>
              LOG ({log.length})
            </button>
          )}
        </div>

        {/* Traffic light counters */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[
            { k: "unengaged", col: TRAFFIC.deficit,  l: "UNENGAGED" },
            { k: "engaged",  col: TRAFFIC.flowing,  l: "ENGAGED" },
            { k: "abundant", col: TRAFFIC.atMax,    l: "ABUNDANT" },
          ].map(({ k, col, l }) => (
            <div key={k} style={{ flex: 1, background: "#1a1008", borderRadius: 4, padding: "6px 8px", borderTop: `2px solid ${col}`, borderRight: `1px solid ${col}18`, borderBottom: `1px solid ${col}18`, borderLeft: `1px solid ${col}18` }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: col }}>{counts[k]}</div>
              <div style={{ fontSize: 10, color: "#6b4d2e", letterSpacing: "0.12em" }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Traffic light scale */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
            {[TRAFFIC.deficit, lerpHex(TRAFFIC.deficit, TRAFFIC.flowing, 0.5), TRAFFIC.flowing, lerpHex(TRAFFIC.flowing, TRAFFIC.atMax, 0.5), TRAFFIC.atMax].map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b4d2e" }}>
            <span>$0</span><span>MIN</span><span>{"\u2192"} engaged</span><span>MAX</span>
          </div>
        </div>

        {/* Parameters */}
        <div style={{ borderTop: "1px solid #6b4d2e", paddingTop: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#7a5c3a", marginBottom: 8 }}>FLOW PARAMETERS</div>
          {PARAM_DEFS.map(p => (
            <ParamSlider key={p.key} label={p.label} hint={p.hint} value={params[p.key]} min={p.min} max={p.max} step={p.step} format={p.fmt} onChange={v => sim.setParam(p.key, v)} />
          ))}

          {/* Inject size: slider with ×10 / ÷10 scale buttons */}
          <ParamSlider label="Inject Size" hint="Capital per click or demo pulse"
            value={params.injectAmt} min={0} max={injectMax} step={Math.max(1, injectMax / 10)}
            format={v => `$${v.toLocaleString()}`}
            onChange={v => sim.setParam("injectAmt", v)} />
          <div style={{ display: "flex", gap: 4, marginTop: -4, marginBottom: 10 }}>
            <HoverBtn onClick={() => { const m = Math.max(100, injectMax / 10); setInjectMax(m); if (params.injectAmt > m) sim.setParam("injectAmt", m); }}
              bg="#3d2b14" hoverBg="#6b4d2e" color="#c4a97a" border="1px solid #6b4d2e"
              style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700 }}>{"\u00F7"}10</HoverBtn>
            <div style={{ flex: 1, fontSize: 9, color: "#8b6d45", display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "0.06em" }}>
              0 {"\u2013"} {injectMax >= 1000000 ? `${injectMax / 1000000}M` : `${injectMax / 1000}K`}
            </div>
            <HoverBtn onClick={() => setInjectMax(Math.min(100000000, injectMax * 10))}
              bg="#3d2b14" hoverBg="#6b4d2e" color="#c4a97a" border="1px solid #6b4d2e"
              style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700 }}>{"\u00D7"}10</HoverBtn>
          </div>
        </div>

        {/* Conservation audit */}
        {snap.totalInjected > 0 && (() => {
          let poolNodesTotal = 0, poolCommonsTotal = 0, poolBankedTotal = 0;
          const metaBals = [], metaBankedArr = [];
          for (let m = 0; m < CFG.metaCount; m++) {
            let mNodes = 0, mCommons = 0, mBanked = 0;
            for (const pIdx of META_DEFS[m].pools) {
              mNodes += Math.round(snap.pools[pIdx].balances.reduce((a, b) => a + b, 0));
              mCommons += Math.round(snap.pools[pIdx].commonsBalance);
              mBanked += Math.round(snap.pools[pIdx].banked.reduce((a, b) => a + b, 0)) + Math.round(snap.pools[pIdx].commonsBanked);
            }
            poolNodesTotal += mNodes; poolCommonsTotal += mCommons; poolBankedTotal += mBanked;
            metaBals.push(Math.round(snap.metaCommons[m].balance));
            metaBankedArr.push(Math.round(snap.metaCommons[m].banked));
          }
          const metaTotal = metaBals.reduce((s,v)=>s+v,0);
          const metaBanked = metaBankedArr.reduce((s,v)=>s+v,0);
          const fc = Math.round(snap.fieldCommonsBalance);
          const fcb = Math.round(snap.fieldCommonsBanked);
          const inFlight = Math.round(snap.pendingTotal);
          const bankedTotal = poolBankedTotal + metaBanked + fcb;
          const tracked = poolNodesTotal + poolCommonsTotal + metaTotal + fc + inFlight + bankedTotal;
          const leaked = Math.round(snap.totalInjected) - tracked;

          return (
            <div style={{ marginTop: 10, fontSize: 9, color: "#7a5c3a", lineHeight: 2 }}>
              <div>Injected: <strong style={{ color: "#fcd34d" }}>${Math.round(snap.totalInjected).toLocaleString()}</strong></div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                {META_DEFS.map((m, mi) => {
                  let mTotal = metaBals[mi];
                  for (const pIdx of m.pools) mTotal += Math.round(snap.pools[pIdx].balances.reduce((a,b)=>a+b,0)) + Math.round(snap.pools[pIdx].commonsBalance);
                  return (
                    <div key={mi} style={{ fontSize: 8 }}>
                      <span style={{ color: m.color }}>{m.short}:</span>{" "}
                      <span style={{ color: "#c4a97a" }}>${mTotal.toLocaleString()}</span>
                    </div>
                  );
                })}
                {fc > 0 && <div style={{ fontSize: 8 }}><span style={{ color: "#fcd34d" }}>field ${fc.toLocaleString()}</span></div>}
                {inFlight > 0 && <div style={{ fontSize: 8 }}><span style={{ color: "#d4913a" }}>flight ${inFlight.toLocaleString()}</span></div>}
                {bankedTotal > 0 && <div style={{ fontSize: 8 }}><span style={{ color: "#fcd34d" }}>banked ${bankedTotal.toLocaleString()}</span></div>}
              </div>
              <div style={{ marginTop: 2 }}>
                Accounted: <strong style={{ color: leaked !== 0 ? TRAFFIC.deficit : TRAFFIC.atMax }}>${tracked.toLocaleString()}</strong>
                {leaked !== 0 && <span style={{ color: TRAFFIC.deficit, fontWeight: 700 }}> {"\u26A0"} DISCREPANCY: ${leaked.toLocaleString()}</span>}
                {leaked === 0 && <span style={{ color: TRAFFIC.atMax }}> {"\u2713"}</span>}
              </div>
            </div>
          );
        })()}
      </aside>

      {/* ═══ CENTER — Canvas ═══ */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start", minWidth: 0 }}>
        {vizMode === "ramification"
          ? <RamificationCanvas snap={snap} thresholds={thresholds} ramSel={ramSel} setRamSel={setRamSel} onInject={(gid) => { ramInject(gid, sim); setRamSel(null); }} />
          : <LevelCanvas view={view} snap={snap} sel={effectiveSel} setSel={setSel}
              onNodeDrill={canDrill ? zoomIn : null} onZoomOut={zoomOut} onZoomToPool={zoomToSibling} />}
      </div>

      {/* ═══ RIGHT PANEL — Context Detail ═══ */}
      <div style={{ width: 320, boxSizing: "border-box", flexShrink: 0, flexGrow: 0, borderLeft: "1px solid #3d2b14", maxHeight: "100vh", overflowY: "auto", padding: 16 }}>
        {vizMode === "ramification" ? (<>
          <RamDetailPanel ramSel={ramSel} snap={snap} thresholds={thresholds} setRamSel={setRamSel} sim={sim} />
          {log.length > 0 && <FlowLog log={log} />}
        </>) : (<>
        {effectiveSel === "commons" && <CommonsPanel view={view} snap={snap} setSel={setSel} />}
        {typeof effectiveSel === "number" && <NodePanel nodeId={effectiveSel} view={view} snap={snap} setSel={setSel} onDrill={canDrill ? zoomIn : null} />}

        {effectiveSel === null && snap.totalInjected === 0 && (
          <div style={{ padding: "12px 14px", ...S.panel, fontSize: 10, color: "#7a5c3a", lineHeight: 1.9, marginBottom: 14, animation: "fadein 0.5s ease" }}>
            {view.nodeCount} holons orbit a shared commons pool.<br />
            Same rules at every level: purpose, thresholds, surplus flows outward.<br /><br />
            <span style={{ color: "#8b6d45" }}>Click a node to select.</span>{" "}
            <span style={{ color: "#8b6d45" }}>Click again to {canDrill ? "zoom in" : "inject capital"}.</span><br />
            <span style={{ color: TRAFFIC.atMax }}>{"\u25B6"} DEMO</span> auto-injects to demonstrate cascade.
          </div>
        )}

        {effectiveSel === null && <FlowLog log={log} />}
        {effectiveSel === null && <NodeList view={view} setSel={setSel} />}

        {/* Flow log always accessible at bottom */}
        {effectiveSel !== null && log.length > 0 && <FlowLog log={log} />}
        </>)}
      </div>

      {/* ═══ LOG OVERLAY ═══ */}
      {showLog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,16,8,0.92)", zIndex: 999, display: "flex", flexDirection: "column", padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowLog(false); }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fcd34d", letterSpacing: "0.08em" }}>FLOW LOG {"\u2014"} {log.length} entries</div>
            <button onClick={() => setShowLog(false)}
              style={{ background: "#3d2b14", border: "1px solid #fcd34d60", borderRadius: 4, color: "#fcd34d", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", padding: "6px 16px" }}>
              {"\u2715"} CLOSE
            </button>
          </div>
          <textarea readOnly value={log.join("\n")}
            onClick={e => e.target.select()}
            style={{ flex: 1, width: "100%", boxSizing: "border-box", background: "#120b04", border: "1px solid #6b4d2e", borderRadius: 6, color: "#f5e6d0", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", padding: 16, resize: "none", lineHeight: 1.8 }} />
          <div style={{ marginTop: 8, fontSize: 10, color: "#8b6d45" }}>Click the text to select all, then Cmd+C / Ctrl+C to copy.</div>
        </div>
      )}
    </div>
  );
}
