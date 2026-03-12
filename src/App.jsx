import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 1: CONFIGURATION                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const CFG = {
  poolSize: 9,
  clustersPerPool: 3,
  nodesPerCluster: 3,
  poolCount: 3,
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

const POOL_DEFS = [
  {
    id: 0, label: "The Good", short: "GOOD",
    clusters: [
      { name: "Mycelium",    color: "#d4913a" },
      { name: "Canopy",      color: "#a3823a" },
      { name: "Understory",  color: "#c9a54e" },
    ],
    names: ["You","Blair","Casey","Dana","Ellis","Fern","Gray","Harper","Iris"],
    color: "#d4913a",
  },
  {
    id: 1, label: "The True", short: "TRUE",
    clusters: [
      { name: "Tidal", color: "#b87333" },
      { name: "Coral", color: "#8b5e3c" },
      { name: "Kelp",  color: "#d4a854" },
    ],
    names: ["Kai","Lane","Morgan","Noa","Owen","Page","Quinn","River","Sage"],
    color: "#b87333",
  },
  {
    id: 2, label: "The Beautiful", short: "BEAUTIFUL",
    clusters: [
      { name: "Ridge",     color: "#946b3c" },
      { name: "Meadow",    color: "#7a8b4e" },
      { name: "Watershed", color: "#c4783a" },
    ],
    names: ["Ash","Brook","Cedar","Dune","Elm","Flint","Glen","Heath","Ivy"],
    color: "#946b3c",
  },
];

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
//     overflow      → siblings + meta   (commonsRate : fieldRate split)
//
//   Meta commons receives R:
//     fieldRate%    → pool commons      (via routeByActivation)
//     (no higher level)
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

  // Phase 1: Activate below-minimum nodes (cheapest first, capped at headroom)
  for (const { id, deficit, headroom } of candidates) {
    if (remaining < 1) break;
    if (deficit <= 0) continue;
    const give = Math.min(remaining, deficit, headroom);
    if (give >= 1) {
      allocs.set(id, (allocs.get(id) || 0) + give);
      remaining -= give;
    }
  }

  // Phase 2: Split among nodes with remaining headroom
  const withRoom = candidates.filter(c => {
    const already = allocs.get(c.id) || 0;
    return c.headroom - already > 0;
  });

  if (remaining >= 1 && withRoom.length > 0) {
    const share = Math.floor(remaining / withRoom.length);
    if (share >= 1) {
      for (const c of withRoom) {
        const already = allocs.get(c.id) || 0;
        const give = Math.min(share, c.headroom - already);
        if (give >= 1) {
          allocs.set(c.id, already + give);
          remaining -= give;
        }
      }
    }
    // Rounding residual to first with room
    for (const c of withRoom) {
      if (remaining < 1) break;
      const already = allocs.get(c.id) || 0;
      const room = c.headroom - already;
      if (room >= 1) {
        allocs.set(c.id, already + 1);
        remaining -= 1;
      }
    }
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

const POOL_TOPOS = [
  buildPoolTopology(POOL_DEFS[0], 0xdeadbeef),
  buildPoolTopology(POOL_DEFS[1], 0xcafebabe),
  buildPoolTopology(POOL_DEFS[2], 0xfeedface),
];

// Meta-level positions: 2 pool nodes on a ring around center
const META_POS = [0, 1, 2].map(i => polarXY(i, 3, CX, CY, CFG.orbits.nodeR));
const COMMONS_POS = { x: CX, y: CY };

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 4: THRESHOLD INITIALIZATION                                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function makeInitThresholds() {
  return {
    pools: POOL_TOPOS.map(topo => ({
      nodes: topo.nodes.map(n => ({ min: n.min, max: n.max })),
      commons: { min: 5000, max: 25000 },
    })),
    meta: {
      commons: { min: 5000, max: 50000 },
    },
  };
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
    metaCommonsBalance: 0,
    metaCommonsBanked: 0,
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
  const commonsFlowsRef = useRef(POOL_TOPOS.map(t => [...t.commonsFlows]));
  const metaFlowsRef = useRef([[1, 2], [0, 2], [0, 1]]);  // holonic: each pool peers with other 2
  const metaCommonsFlowsRef = useRef([0, 1, 2]);          // Meta commons → all 3 pools

  const [params, _setP] = useState({ ...CFG.defaults });
  const [thresholds, _setT] = useState(makeInitThresholds);
  const [commonsFlows, _setCF] = useState(POOL_TOPOS.map(t => [...t.commonsFlows]));
  const [metaFlows, _setMF] = useState([[1, 2], [0, 2], [0, 1]]);
  const [metaCommonsFlows, _setMCF] = useState([0, 1, 2]);
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
    metaCommonsBalance: 0,
    metaCommonsBanked: 0,
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

  const setMetaCommonsFlow = useCallback((slot, poolIdx) => {
    const mcf = metaCommonsFlowsRef.current.map((v, i) => i === slot ? poolIdx : v);
    metaCommonsFlowsRef.current = mcf;
    _setMCF([...mcf]);
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

  // Process meta-commons on receipt — distributes to pool commons (activation priority)
  const processMetaCommons = useCallback((received, ts) => {
    const sim = simRef.current;
    const { fieldRate } = paramsRef.current;
    const th = threshRef.current.meta.commons;
    const prevBal = sim.metaCommonsBalance - received;
    const { toField, overflow, aboveMin, newBalance } = FlowMath.onReceipt(prevBal, received, th.min, th.max, fieldRate, 0);
    sim.metaCommonsBalance = newBalance;
    const retained = Math.round(received - toField);
    if (toField < CFG.minFlight) {
      sim.metaCommonsBalance += toField; // retain sub-threshold amount
      appendLog([`  ◎ META COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(sim.metaCommonsBalance)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(sim.metaCommonsBalance, th.min, th.max).toUpperCase()} — retained 100%`]);
      return;
    }
    // Distribute to pool commons, closest-to-activation first
    const allPoolIds = Array.from({ length: CFG.poolCount }, (_, i) => i);
    // See through pool commons to the nodes inside — route to pools with internal need
    const getDeficit = pIdx => {
      const cDef = Math.max(0, threshRef.current.pools[pIdx].commons.min - sim.pools[pIdx].commonsBalance);
      const nDef = threshRef.current.pools[pIdx].nodes.reduce((s, th, j) => s + Math.max(0, th.min - sim.pools[pIdx].balances[j]), 0);
      return cDef + nDef;
    };
    const getRoom = pIdx => {
      const cRoom = Math.max(0, threshRef.current.pools[pIdx].commons.max - sim.pools[pIdx].commonsBalance);
      const nRoom = threshRef.current.pools[pIdx].nodes.reduce((s, th, j) => s + Math.max(0, th.max - sim.pools[pIdx].balances[j]), 0);
      return cRoom + nRoom;
    };
    const { allocs } = routeByActivation(toField, allPoolIds, getDeficit, getRoom);
    let actuallyRouted = 0;
    for (const { id: pIdx, amount } of allocs) {
      if (amount >= CFG.minFlight) { schedFlight("mc", `p${pIdx}`, ts, amount, "meta"); actuallyRouted += amount; }
    }
    // Conservation: return unrouted capital to meta commons
    const unrouted = toField - actuallyRouted;
    if (unrouted > 0) sim.metaCommonsBalance += unrouted;
    const routed = allocs.filter(a => a.amount >= CFG.minFlight);
    const routeDetail = routed.length
      ? routed.map(a => `${POOL_DEFS[a.id].short} COMMONS ${fmtL(a.amount)} (deficit ${fmtL(getDeficit(a.id))})`).join(", ")
      : "none (all pools full)";
    appendLog([
      `  ◎ META COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(sim.metaCommonsBalance)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(sim.metaCommonsBalance, th.min, th.max).toUpperCase()}`,
      `    field ${Math.round(fieldRate * 100)}% of above-min ${fmtL(aboveMin)} = ${fmtL(toField)}${overflow > 0 ? ` (includes overflow ${fmtL(overflow)})` : ""} → ${routeDetail}`,
    ]);
  }, [schedFlight, appendLog]);

  // Process pool commons on receipt.
  // Delta-only: routes only the RECEIVED amount through the rate-first model.
  //
  //   Below min  → retained. Commons is accumulating.
  //   Above min  → fieldRate% flows DOWN to nearest-to-activation satellite.
  //   Overflow   → IF balance still exceeds max AFTER field rate applied:
  //                FIRST fill ALL satellites to their min (nobody left behind).
  //                THEN remainder flows to SIBLING pool commons (activation priority).
  //                Whatever siblings can't absorb → meta commons.
  //
  const processPoolCommons = useCallback((poolIdx, received, ts) => {
    const sim = simRef.current;
    const pool = sim.pools[poolIdx];
    const { fieldRate, commonsRate } = deriveRates(paramsRef.current);
    const th = threshRef.current.pools[poolIdx].commons;
    const pLabel = POOL_DEFS[poolIdx].short;

    const prevBal = pool.commonsBalance - received;
    const newTotal = pool.commonsBalance;

    if (newTotal <= th.min) {
      appendLog([`  ⬇ ${pLabel} COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(newTotal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] UNENGAGED — retained 100%`]);
      return;
    }

    const nodeTh = threshRef.current.pools[poolIdx].nodes;
    const allNodeIds = Array.from({ length: CFG.poolSize }, (_, i) => i);
    const getDeficit = id => Math.max(0, nodeTh[id].min - pool.balances[id]);
    const getRoom = id => Math.max(0, nodeTh[id].max - pool.balances[id]);

    // Step 1: How much of the received capital is above min
    const aboveMin = Math.max(0, newTotal - Math.max(prevBal, th.min));

    // Collect log lines, flush before any processMetaCommons call
    const L = [];
    L.push(`  ⬇ ${pLabel} COMMONS +${fmtL(received)} | bal ${fmtL(prevBal)}→${fmtL(newTotal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(newTotal, th.min, th.max).toUpperCase()}`);

    // Step 2: Apply fieldRate to ALL capital above min → distribute to satellites
    const fieldFlow = Math.round(aboveMin * fieldRate);
    if (fieldFlow >= CFG.minFlight) {
      const { allocs } = routeByActivation(fieldFlow, allNodeIds, getDeficit, getRoom);
      let distributed = 0;
      for (const { id, amount } of allocs) {
        if (amount >= CFG.minFlight) {
          schedFlight(`c${poolIdx}`, id, ts, amount, `pool${poolIdx}`);
          distributed += amount;
        }
      }
      pool.commonsBalance -= distributed;
      const routed = allocs.filter(a => a.amount >= CFG.minFlight);
      if (routed.length) L.push(`    field ${Math.round(fieldRate * 100)}% of above-min ${fmtL(Math.round(aboveMin))} = ${fmtL(fieldFlow)} → ${routed.map(a => `${POOL_TOPOS[poolIdx].nodes[a.id].name} ${fmtL(a.amount)}`).join(", ")}`);
    }

    // Step 3: Check if balance still exceeds max AFTER field rate applied
    const overflow = Math.max(0, pool.commonsBalance - th.max);
    if (overflow < 1) {
      L.push(`    post-flow bal ${fmtL(pool.commonsBalance)} — no overflow`);
      appendLog(L);
      return;
    }

    L.push(`    post-flow overflow ${fmtL(overflow)} (bal ${fmtL(pool.commonsBalance)} > max ${fmtL(th.max)})`)
    let surplus = Math.floor(overflow);

    // Step 1: Distribute overflow to ALL satellites with room (deficits first, then equalize)
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
      if (routed.length) L.push(`    overflow → satellites ${fmtL(distributed)}: ${routed.map(a => `${POOL_TOPOS[poolIdx].nodes[a.id].name} ${fmtL(a.amount)} (bal ${fmtL(pool.balances[a.id])} room ${fmtL(getRoom(a.id))})`).join(", ")}`);
    }

    if (surplus < CFG.minFlight) { appendLog(L); return; }

    // Step 2: Sibling pool commons (activation priority, commonsRate% tax to meta)
    const siblingIds = POOL_DEFS.filter(p => p.id !== poolIdx).map(p => p.id);
    const commonsToMeta = commonsRate > 0 ? Math.round(surplus * commonsRate / (commonsRate + fieldRate)) : 0;
    const toSiblings = surplus - commonsToMeta;

    if (toSiblings >= CFG.minFlight && siblingIds.length > 0) {
      const getSibDeficit = pIdx => Math.max(0, threshRef.current.pools[pIdx].commons.min - sim.pools[pIdx].commonsBalance);
      const getSibRoom = pIdx => Math.max(0, threshRef.current.pools[pIdx].commons.max - sim.pools[pIdx].commonsBalance);
      const { allocs, unroutable } = routeByActivation(toSiblings, siblingIds, getSibDeficit, getSibRoom);
      let distributed = 0;
      for (const { id: tgt, amount } of allocs) {
        if (amount >= CFG.minFlight) {
          schedFlight(`c${poolIdx}`, `p${tgt}`, ts, amount, "meta");
          distributed += amount;
        }
      }
      pool.commonsBalance -= distributed;
      if (distributed >= CFG.minFlight) {
        L.push(`    overflow → siblings ${fmtL(distributed)}: ${allocs.filter(a => a.amount >= CFG.minFlight).map(a => `${POOL_DEFS[a.id].short} COMMONS ${fmtL(a.amount)} (deficit ${fmtL(getSibDeficit(a.id))})`).join(", ")}`);
      }
      // Unroutable (siblings full) → also goes to meta commons
      const extraToMeta = Math.floor(unroutable);
      if (extraToMeta >= CFG.minFlight) {
        pool.commonsBalance -= extraToMeta;
        sim.metaCommonsBalance += extraToMeta;
        schedVisual(`c${poolIdx}`, "mc", ts, extraToMeta, "meta");
        L.push(`    overflow → meta commons ${fmtL(extraToMeta)} (siblings full)`);
        // Flush log BEFORE processMetaCommons (which adds its own log entries)
        appendLog(L); L.length = 0;
        processMetaCommons(extraToMeta, ts);
      }
    }

    // Step 3: Commons tax → meta commons
    if (commonsToMeta >= CFG.minFlight) {
      pool.commonsBalance -= commonsToMeta;
      sim.metaCommonsBalance += commonsToMeta;
      schedVisual(`c${poolIdx}`, "mc", ts, commonsToMeta, "meta");
      L.push(`    resourced ${fmtL(commonsToMeta)} → Meta Commons`);
      // Flush log BEFORE processMetaCommons
      appendLog(L); L.length = 0;
      processMetaCommons(commonsToMeta, ts);
    }

    if (L.length) appendLog(L);
  }, [schedFlight, schedVisual, appendLog, processMetaCommons]);

  // ── Epoch settlement ────────────────────────────────────────────────────
  const settleEpoch = useCallback(() => {
    const sim = simRef.current;
    const ts = Date.now();
    const logLines = [];
    logLines.push(`━━━ EPOCH ${sim.epochCount + 1} SETTLEMENT ━━━`);

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
        } else {
          returnToCommons += bal;
          logLines.push(`  ✗ RETURNED ${name} (${pLabel}) ${fmtL(bal)} → commons`);
        }
        pool.balances[i] = 0;
      }

      if (returnToCommons > 0) {
        pool.commonsBalance += returnToCommons;
        logLines.push(`  ↩ ${pLabel} COMMONS received ${fmtL(returnToCommons)} from failed nodes`);
      }
    }

    // Phase 2: Pool commons — bank or return
    let returnToMeta = 0;
    for (let p = 0; p < sim.pools.length; p++) {
      const pool = sim.pools[p];
      const pLabel = POOL_DEFS[p].short;
      const bal = pool.commonsBalance;
      if (bal < 1) { pool.commonsBalance = 0; continue; }
      const cTh = threshRef.current.pools[p].commons;
      if (bal >= cTh.min) {
        pool.commonsBanked += bal;
        logLines.push(`  ✓ BANKED ${pLabel} COMMONS ${fmtL(bal)}`);
      } else {
        returnToMeta += bal;
        logLines.push(`  ✗ RETURNED ${pLabel} COMMONS ${fmtL(bal)} → meta`);
      }
      pool.commonsBalance = 0;
    }

    if (returnToMeta > 0) {
      sim.metaCommonsBalance += returnToMeta;
      logLines.push(`  ↩ META COMMONS received ${fmtL(returnToMeta)} from failed pool commons`);
    }

    // Phase 3: Meta commons — bank or carry
    const metaBal = sim.metaCommonsBalance;
    if (metaBal >= 1) {
      const metaTh = threshRef.current.meta.commons;
      if (metaBal >= metaTh.min) {
        sim.metaCommonsBanked += metaBal;
        sim.metaCommonsBalance = 0;
        logLines.push(`  ✓ BANKED META COMMONS ${fmtL(metaBal)}`);
      } else {
        logLines.push(`  ◎ META COMMONS ${fmtL(metaBal)} carries over (below min)`);
      }
    }

    sim.epochDay = 0;
    sim.epochCount += 1;
    logLines.push(`━━━ EPOCH ${sim.epochCount} BEGINS ━━━`);

    // Phase 4: Kickstart — flush banked commons back into active commons
    // Banked commons seed the new epoch; normal flow mechanics distribute the surplus.
    let anyKickstart = false;
    for (let p = 0; p < sim.pools.length; p++) {
      const pool = sim.pools[p];
      if (pool.commonsBanked < 1) continue;
      const amt = pool.commonsBanked;
      pool.commonsBalance += amt;
      pool.commonsBanked = 0;
      logLines.push(`  ⟳ KICKSTART ${POOL_DEFS[p].short} COMMONS ${fmtL(amt)} from bank`);
      anyKickstart = true;
    }
    if (sim.metaCommonsBanked >= 1) {
      const amt = sim.metaCommonsBanked;
      sim.metaCommonsBalance += amt;
      sim.metaCommonsBanked = 0;
      logLines.push(`  ⟳ KICKSTART META COMMONS ${fmtL(amt)} from bank`);
      anyKickstart = true;
    }

    // Flush settlement log before kickstart distribution (which adds its own entries)
    appendLog(logLines);

    // Distribute kickstarted funds through normal flow mechanics
    if (anyKickstart) {
      // Meta first (top-down: meta distributes to pools, then pools distribute to nodes)
      if (sim.metaCommonsBalance >= 1) {
        processMetaCommons(sim.metaCommonsBalance, ts);
      }
      for (let p = 0; p < sim.pools.length; p++) {
        if (sim.pools[p].commonsBalance >= 1) {
          processPoolCommons(p, sim.pools[p].commonsBalance, ts);
        }
      }
    }
  }, [appendLog, processPoolCommons, processMetaCommons]);

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
    pool.balances[nodeIdx] += amt;
    let { toCommons, toField, overflow, aboveMin, newBalance } = FlowMath.onReceipt(prevBal, amt, th.min, th.max, symbiontRate, commonsRate);
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
    const labels = ["GOOD", "TRUE", "BEAUTIFUL"];
    const poolParts = [];
    let poolTotal = 0, bankedTotal = 0;
    for (let i = 0; i < sim.pools.length; i++) {
      const nodes = Math.round(sim.pools[i].balances.reduce((s,v)=>s+v,0));
      const commons = Math.round(sim.pools[i].commonsBalance);
      const nb = Math.round(sim.pools[i].banked.reduce((s,v)=>s+v,0));
      const cb = Math.round(sim.pools[i].commonsBanked);
      poolParts.push(`[${labels[i]}: nodes $${nodes} commons $${commons}${nb + cb > 0 ? ` banked $${nb + cb}` : ""}]`);
      poolTotal += nodes + commons;
      bankedTotal += nb + cb;
    }
    const mc = Math.round(sim.metaCommonsBalance);
    const mcb = Math.round(sim.metaCommonsBanked);
    bankedTotal += mcb;
    const fl = Math.round(sim.pending.reduce((s,p)=>s+p.amount,0));
    const total = poolTotal + mc + fl + bankedTotal;
    const inj = Math.round(sim.totalInjected);
    const gap = inj - total;
    return `  ${poolParts.join(" ")} [META $${mc}${mcb > 0 ? ` banked $${mcb}` : ""}] [flight $${fl}]${bankedTotal > 0 ? ` [banked $${bankedTotal}]` : ""} = $${total}/${inj}${gap !== 0 ? ` ⚠GAP $${gap}` : ' ✓'}`;
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

  const injectMetaCommons = useCallback((amt = null) => {
    amt = amt ?? paramsRef.current.injectAmt;
    const sim = simRef.current;
    const th = threshRef.current.meta.commons;
    const prevBal = sim.metaCommonsBalance;
    sim.metaCommonsBalance += amt;
    sim.totalInjected += amt;
    processMetaCommons(amt, Date.now());
    appendLog([
      `⚡ INJECT ${fmtL(amt)} → Meta Commons | pre-bal ${fmtL(prevBal)} [min ${fmtL(th.min)} max ${fmtL(th.max)}] ${getState(prevBal, th.min, th.max).toUpperCase()}`,
      snapBalance(),
    ]);
    triggerRipple("meta");
  }, [processMetaCommons, appendLog, triggerRipple, snapBalance]);

  const fillNodeToMax = useCallback((poolIdx, nodeIdx) => {
    const bal = simRef.current.pools[poolIdx].balances[nodeIdx];
    const needed = Math.max(0, threshRef.current.pools[poolIdx].nodes[nodeIdx].max - bal + 1);
    injectNode(poolIdx, nodeIdx, false, needed);
  }, [injectNode]);

  const fillPoolCommonsToMax = useCallback((poolIdx) => {
    const needed = Math.max(0, threshRef.current.pools[poolIdx].commons.max - simRef.current.pools[poolIdx].commonsBalance + 1);
    injectPoolCommons(poolIdx, needed);
  }, [injectPoolCommons]);

  const fillMetaCommonsToMax = useCallback(() => {
    const needed = Math.max(0, threshRef.current.meta.commons.max - simRef.current.metaCommonsBalance + 1);
    injectMetaCommons(needed);
  }, [injectMetaCommons]);

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

        if (p.level === "meta") {
          // Meta delivery: to a pool commons or meta commons
          if (typeof p.to === "string" && p.to.startsWith("p")) {
            const pIdx = parseInt(p.to[1]);
            const prevBal = sim.pools[pIdx].commonsBalance;
            sim.pools[pIdx].commonsBalance += p.amount;
            const fromLabel = typeof p.from === "string" && p.from === "mc" ? "Meta Commons" : typeof p.from === "string" && p.from.startsWith("c") ? `${POOL_DEFS[parseInt(p.from[1])].short} COMMONS` : String(p.from);
            newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → ${POOL_DEFS[pIdx].short} COMMONS from ${fromLabel} | bal ${fmtL(prevBal)}→${fmtL(sim.pools[pIdx].commonsBalance)}`);
            processPoolCommons(pIdx, p.amount, ts);
          } else if (p.to === "mc") {
            const prevBal = sim.metaCommonsBalance;
            sim.metaCommonsBalance += p.amount;
            newLog.push(`⊕ DELIVER ${fmtL(p.amount)} → Meta Commons | bal ${fmtL(prevBal)}→${fmtL(sim.metaCommonsBalance)}`);
            processMetaCommons(p.amount, ts);
          }
        } else {
          // Pool-level delivery
          const pIdx = parseInt(p.level.replace("pool", ""));
          const pool = sim.pools[pIdx];
          const nodeIdx = p.to;
          const pLabel = POOL_DEFS[pIdx].short;
          const nodeName = POOL_TOPOS[pIdx].nodes[nodeIdx].name;

          const prevBal = pool.balances[nodeIdx];
          pool.balances[nodeIdx] += p.amount;
          const th = threshRef.current.pools[pIdx].nodes[nodeIdx];
          // Nodes are ambivalent: same rates regardless of source
          let { toCommons, toField, overflow, newBalance } = FlowMath.onReceipt(prevBal, p.amount, th.min, th.max, symbiontRate, commonsRate);
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
        metaCommonsBalance: sim.metaCommonsBalance,
        metaCommonsBanked: sim.metaCommonsBanked,
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
  }, [processPoolCommons, processMetaCommons, appendLog]);

  return {
    snap, params, thresholds, commonsFlows, metaFlows, metaCommonsFlows, log, commonsRipples,
    setParam, setThreshold, setPoolCommonsFlow, setMetaFlow, setMetaCommonsFlow,
    injectNode, injectPoolCommons, injectMetaCommons,
    fillNodeToMax, fillPoolCommonsToMax, fillMetaCommonsToMax,
    reset, appendLog, triggerRipple, settleEpoch, tickDay,
  };
}

// ── Demo Hook ───────────────────────────────────────────────────────────────
function useDemo(injectNode) {
  const [active, setActive] = useState(false);
  const ref = useRef(false);
  useEffect(() => {
    ref.current = active;
    if (!active) return;
    let timer, idx = 0;
    const targets = [
      [0, 0], [1, 0], [2, 0], [0, 4], [1, 4], [2, 4], [0, 2], [1, 2], [2, 2], [0, 7], [1, 7], [2, 7],
    ];
    const tick = () => {
      if (!ref.current) return;
      const [p, n] = targets[idx % targets.length];
      injectNode(p, n, true);
      idx++;
      timer = setTimeout(tick, CFG.demo.intervalMs);
    };
    timer = setTimeout(tick, CFG.demo.startMs);
    return () => clearTimeout(timer);
  }, [active, injectNode]);
  return [active, setActive];
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
// ║  SECTION 7: LEVEL VIEW NORMALIZER                                           ║
// ║  Transforms pool-level or meta-level data into the same shape.              ║
// ║  The canvas and panels never know which level they're rendering.             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function buildLevelView(zoom, snap, thresholds, sim, commonsFlows, metaFlows, metaCommonsFlows, commonsRipples) {

  // ── META LEVEL: pool commons are nodes ─────────────────────────────────
  if (zoom === "meta") {
    return {
      levelId: "meta",
      nodeCount: CFG.poolCount,
      flightLevel: "meta",
      // At meta level, each "node" IS a pool commons — color reflects aggregate node health
      nodes: POOL_DEFS.map((p, i) => {
        const bals = snap.pools[i].balances;
        const ths = thresholds.pools[i].nodes;
        const anyDeficit = ths.some((th, j) => bals[j] < th.min);
        const fullCount = ths.filter((th, j) => bals[j] >= th.max).length;
        const healthColor = anyDeficit ? TRAFFIC.deficit : lerpHex(TRAFFIC.flowing, TRAFFIC.atMax, fullCount / ths.length);
        const poolBanked = Math.round(snap.pools[i].banked.reduce((a, b) => a + b, 0)) + snap.pools[i].commonsBanked;
        return {
          id: i, name: p.label, shortName: p.short,
          balance: snap.pools[i].commonsBalance + snap.pools[i].balances.reduce((a, b) => a + b, 0),
          banked: poolBanked,
          min: thresholds.pools[i].commons.min, max: thresholds.pools[i].commons.max,
          cluster: i, flows: metaFlows[i], healthColor,
        };
      }),
      clusters: POOL_DEFS.map(p => ({ name: p.label, color: p.color })),
      positions: POOL_DEFS.map((_, i) => polarXY(i, CFG.poolCount, CX, CY, CFG.orbits.nodeR)),
      flowGraph: metaFlows,
      commons: {
        balance: snap.metaCommonsBalance,
        banked: snap.metaCommonsBanked,
        min: thresholds.meta.commons.min, max: thresholds.meta.commons.max,
        label1: "WHAT'S", label2: "POSSIBLE?", flows: metaCommonsFlows,
      },
      ripples: commonsRipples.filter(r => r.level === "meta"),
      normalizeId: (id) => {
        if (typeof id === "string") {
          if (id === "mc") return "commons";
          if (id.startsWith("p")) return parseInt(id[1]);
        }
        return id;
      },
      outer: null,
      actions: {
        injectNode: (id) => sim.injectPoolCommons(id),
        injectCommons: () => sim.injectMetaCommons(),
        fillNode: (id) => sim.fillPoolCommonsToMax(id),
        fillCommons: () => sim.fillMetaCommonsToMax(),
        setNodeTh: (id, f, v) => sim.setThreshold(["pools", id, "commons"], f, v),
        setCommonsTh: (f, v) => sim.setThreshold(["meta", "commons"], f, v),
        setCommonsFlow: (slot, nId) => sim.setMetaCommonsFlow(slot, nId),
      },
    };
  }

  // ── POOL LEVEL: people are nodes ────────────────────────────────────────
  const poolIdx = zoom;
  const topo = POOL_TOPOS[poolIdx];
  const poolSnap = snap.pools[poolIdx];
  const poolTh = thresholds.pools[poolIdx];

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
    },
    ripples: commonsRipples.filter(r => r.level === `pool${poolIdx}`),
    normalizeId: (id) => {
      if (typeof id === "string") {
        if (id.startsWith("c")) return "commons";
      }
      return id;
    },
    // Outer context: sibling pool commons + meta commons
    outer: {
      siblings: POOL_DEFS.filter(p => p.id !== poolIdx).map(p => ({
        id: p.id, label: p.short, color: p.color,
        balance: snap.pools[p.id].commonsBalance,
      })),
      metaCommons: { balance: snap.metaCommonsBalance, th: thresholds.meta.commons },
      metaFlights: snap.flights.filter(f => f.level === "meta"),
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
  const metaCommonsPos = useMemo(() => ({ x: CX, y: CY - CFG.orbits.metaR }), []);
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

  // Meta-level edge position resolver.
  // This pool's commons → center (COMMONS_POS). Siblings → their orbit positions. Meta commons → top.
  const metaPosOf = useCallback((id) => {
    if (id === "mc") return metaCommonsPos;
    if (typeof id === "string") {
      if (id.startsWith("c")) {
        const pIdx = parseInt(id[1]);
        const sib = siblingPositions.find(s => s.id === pIdx);
        if (sib) return { x: sib.x, y: sib.y };
        return COMMONS_POS; // this pool's commons → center
      }
      if (id.startsWith("p")) {
        const pIdx = parseInt(id[1]);
        const sib = siblingPositions.find(s => s.id === pIdx);
        if (sib) return { x: sib.x, y: sib.y };
        return COMMONS_POS; // this pool → center
      }
    }
    return metaCommonsPos;
  }, [siblingPositions, metaCommonsPos]);

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

      {/* ── MEMBRANE 3: Meta-level boundary (outermost) ── */}
      {outer && <>
        <Membrane r={CFG.orbits.metaR + 14} label="META NETWORK" color="#b87333" opacity={0.25} />
        <OrbitRing r={CFG.orbits.metaR} stroke="#b87333" width={0.5} dash="2 10" opacity={0.06} />
        <GhostNode x={metaCommonsPos.x} y={metaCommonsPos.y} r={CFG.orbits.metaSize}
          label="META" balance={outer.metaCommons.balance}
          color={nodeColor(outer.metaCommons.balance, outer.metaCommons.th.min, outer.metaCommons.th.max)}
          onClick={onZoomOut} />
      </>}

      {/* ── MEMBRANE 2: Inter-pool boundary ── */}
      {outer && <>
        <Membrane r={CFG.orbits.siblingR + 14} label="INTER-POOL" color="#5a4020" opacity={0.2} />
        <OrbitRing r={CFG.orbits.siblingR} stroke="#6b4d2e" width={0.5} dash="2 10" opacity={0.08} />
        {siblingPositions.map(sib => (
          <GhostNode key={sib.id} x={sib.x} y={sib.y} r={CFG.orbits.siblingSize}
            label={sib.label} balance={sib.balance} color={sib.color}
            onClick={() => onZoomToPool && onZoomToPool(sib.id)} />
        ))}

        {/* Meta-level inter-pool flow edges — same UI as normal flows, gold */}
        <FlowEdges edges={outerEdges} posOf={metaPosOf} nodeLayerMap={{}} hasSel={false} color="#fcd34d" marker="arrMeta" />
        <FlowParticles edges={outerEdges} posOf={metaPosOf} nodeLayerMap={{}} hasSel={false} color="#fcd34d" colorBright="#fef3c7" />
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
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#c4a97a", letterSpacing: "0.08em" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: "#fcd34d", fontFamily: "monospace" }}>{format(value)}</span>
      </div>
      <div style={{ position: "relative", height: 18 }}>
        <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 4, borderRadius: 2, background: "#3d2b14" }} />
        <div style={{ position: "absolute", top: 7, left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: "linear-gradient(90deg, #946b3c, #fcd34d)" }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
          aria-label={label}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 18, opacity: 0, cursor: "pointer", margin: 0 }} />
      </div>
      <div style={{ fontSize: 10, color: "#6b4d2e", marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function ViewToggle({ viewMode, onViewMode }) {
  const modes = [
    { key: "personal", icon: "\u25C9", label: "PERSONAL" },
    { key: "team",     icon: "\u25CE", label: "TEAM" },
    { key: "network",  icon: "\u25C8", label: "NETWORK" },
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
          EPOCH {epochCount + 1} {"\u00B7"} DAY {epochDay}/{epochLength}
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

      <ThresholdEditor value={{ min: commons.min, max: commons.max }} onChange={(f, v) => view.actions.setCommonsTh(f, v)} />
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
  { key: "outflowRate", label: "Outflow Rate", min: 0, max: 1.0, step: 0.01, fmt: v => `${Math.round(v * 100)}%`, hint: "% of surplus above min that resources outward" },
  { key: "peerSplit", label: "Commoners / Commons", min: 0, max: 1.0, step: 0.01, fmt: v => `${Math.round(v * 100)}% commoners · ${Math.round((1 - v) * 100)}% commons`, hint: "How outflow divides between commoners and the commons" },
  { key: "fieldRate", label: "Field Dispersal", min: 0.01, max: 1.0, step: 0.01, fmt: v => `${Math.round(v * 100)}%`, hint: "% of commons surplus dispersed to the field" },
];

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 13: APP                                                            ║
// ║  Pure composition. One canvas, one panel structure, at every level.         ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export default function App() {
  const sim = useSimulation();
  const { snap, params, thresholds, commonsFlows, metaFlows, metaCommonsFlows, log, commonsRipples } = sim;

  // ── Navigation state ──────────────────────────────────────────────────
  const [zoom, setZoom] = useState("meta");       // "meta" | poolIndex
  const [sel, setSel] = useState(null);            // null | "commons" | nodeIndex
  const [viewMode, setViewMode] = useState("network"); // "personal" | "team" | "network"
  const [demo, setDemo] = useDemo(sim.injectNode);
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
      case "network":  setZoom("meta"); setSel(null); break;
      case "team":     setZoom(YOU.poolIdx); setSel(null); break;
      case "personal": setZoom(YOU.poolIdx); setSel(YOU.nodeIdx); break;
    }
  }, []);

  const zoomIn = useCallback((i) => { setZoom(i); setSel(null); }, []);
  const zoomOut = useCallback(() => { setViewMode("network"); setZoom("meta"); setSel(null); }, []);
  const resetAll = useCallback(() => { sim.reset(); setSel(null); setDemo(false); setAutoTime(false); setViewMode("network"); }, [sim, setDemo]);

  const effectiveSel = viewMode === "personal" ? YOU.nodeIdx : sel;

  // ── Normalized level view ─────────────────────────────────────────────
  const view = useMemo(() =>
    buildLevelView(zoom, snap, thresholds, sim, commonsFlows, metaFlows, metaCommonsFlows, commonsRipples),
    [zoom, snap, thresholds, sim, commonsFlows, metaFlows, metaCommonsFlows, commonsRipples]
  );

  // ── Derived counts ────────────────────────────────────────────────────
  // At meta level, count all people across all pools (not the 3 pool nodes)
  const counts = useMemo(() => {
    let d = 0, f = 0, fl = 0;
    if (zoom === "meta") {
      for (let p = 0; p < CFG.poolCount; p++) {
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
    + snap.metaCommonsBalance;

  const canDrill = zoom === "meta"; // can zoom into a node only at meta level

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#1a1008", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace", color: "#f5e6d0" }}>
      <style>{CSS}</style>

      {/* ═══ LEFT PANEL — System Controls ═══ */}
      <aside style={{ width: 280, boxSizing: "border-box", flexShrink: 0, flexGrow: 0, background: "#120b04", borderRight: "1px solid #3d2b14", overflowY: "auto", maxHeight: "100vh", padding: 16 }}>

        {/* Branding */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#6b4d2e", marginBottom: 3 }}>A THRESHOLD BASED MODEL</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#faf0e2" }}>Resource the Commons</div>
        </div>

        {/* View Toggle */}
        <div style={{ marginBottom: 14 }}>
          <ViewToggle viewMode={viewMode} onViewMode={handleViewMode} />
        </div>

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

        {/* Controls */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button onClick={() => setDemo(d => !d)}
            aria-label={demo ? "Stop demo mode" : "Start demo mode"}
            style={{ flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.08em", background: demo ? `${TRAFFIC.atMax}20` : "transparent", border: `1px solid ${demo ? TRAFFIC.atMax : "#6b4d2e"}`, color: demo ? TRAFFIC.atMax : "#7a5c3a" }}>
            {demo ? "\u25FC DEMO" : "\u25B6 DEMO"}
          </button>
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
          const poolNodeBals = snap.pools.map(p => Math.round(p.balances.reduce((a, b) => a + b, 0)));
          const poolCommonsBals = snap.pools.map(p => Math.round(p.commonsBalance));
          const poolBanked = snap.pools.map(p => Math.round(p.banked.reduce((a, b) => a + b, 0)) + Math.round(p.commonsBanked));
          const metaComm = Math.round(snap.metaCommonsBalance);
          const inFlight = Math.round(snap.pendingTotal);
          const bankedTotal = poolBanked.reduce((s,v)=>s+v,0) + Math.round(snap.metaCommonsBanked);
          const tracked = poolNodeBals.reduce((s,v)=>s+v,0) + poolCommonsBals.reduce((s,v)=>s+v,0) + metaComm + inFlight + bankedTotal;
          const leaked = Math.round(snap.totalInjected) - tracked;

          return (
            <div style={{ marginTop: 10, fontSize: 9, color: "#7a5c3a", lineHeight: 2 }}>
              <div>Injected: <strong style={{ color: "#fcd34d" }}>${Math.round(snap.totalInjected).toLocaleString()}</strong></div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                {POOL_DEFS.map((p, i) => (
                  <div key={i} style={{ fontSize: 8 }}>
                    <span style={{ color: p.color }}>{p.short}:</span>{" "}
                    <span style={{ color: "#c4a97a" }}>nodes ${poolNodeBals[i].toLocaleString()}</span>{" "}
                    <span style={{ color: TRAFFIC.flowing }}>commons ${poolCommonsBals[i].toLocaleString()}</span>
                    {poolBanked[i] > 0 && <>{" "}<span style={{ color: "#fcd34d" }}>banked ${poolBanked[i].toLocaleString()}</span></>}
                  </div>
                ))}
                {metaComm > 0 && <div style={{ fontSize: 8 }}><span style={{ color: "#b87333" }}>meta commons ${metaComm.toLocaleString()}</span></div>}
                {inFlight > 0 && <div style={{ fontSize: 8 }}><span style={{ color: "#d4913a" }}>in flight ${inFlight.toLocaleString()}</span></div>}
                {bankedTotal > 0 && <div style={{ fontSize: 8 }}><span style={{ color: "#fcd34d" }}>total banked ${bankedTotal.toLocaleString()}</span></div>}
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
        <LevelCanvas view={view} snap={snap} sel={effectiveSel} setSel={setSel}
          onNodeDrill={canDrill ? zoomIn : null} onZoomOut={zoomOut} onZoomToPool={zoomIn} />
      </div>

      {/* ═══ RIGHT PANEL — Context Detail ═══ */}
      <div style={{ width: 280, boxSizing: "border-box", flexShrink: 0, flexGrow: 0, borderLeft: "1px solid #3d2b14", maxHeight: "100vh", overflowY: "auto", padding: 16 }}>
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
