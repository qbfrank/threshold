import { useState, useEffect, useRef } from "react";

// ── Animated particle field ──────────────────────────────────────────────────
function useParticles(count = 60) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const W = canvas.width, H = canvas.height;

    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      o: Math.random() * 0.5 + 0.1,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(252, 211, 77, ${p.o})`;
        ctx.fill();
      }
      // Draw faint connections between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(252, 211, 77, ${0.06 * (1 - d / 100)})`;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return ref;
}

// ── Glow ring SVG ────────────────────────────────────────────────────────────
function GlowRing({ phase }) {
  const r = 80;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - phase);
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(252,211,77,0.08)" strokeWidth="1" />
      <circle cx="100" cy="100" r={r} fill="none" stroke="#fcd34d" strokeWidth="2"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" filter="url(#glow)"
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
    </svg>
  );
}

// ── Landing Page ─────────────────────────────────────────────────────────────
export default function Landing({ onEnter }) {
  const canvasRef = useParticles(50);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 100);
    const t2 = setTimeout(() => setPhase(1), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleEnter = () => {
    setExiting(true);
    setTimeout(onEnter, 700);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#05091a",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'IBM Plex Mono', monospace", color: "#e8d5b0",
      overflow: "hidden", zIndex: 9999,
      opacity: exiting ? 0 : 1, transition: "opacity 0.6s ease",
    }}>
      {/* Particle background */}
      <canvas ref={canvasRef} width={800} height={800} style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.6,
      }} />

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 1, textAlign: "center",
        opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "all 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        {/* Title */}
        <h1 style={{
          fontSize: 42, fontWeight: 700, letterSpacing: "0.25em",
          color: "#fcd34d", marginBottom: 8,
          textShadow: "0 0 40px rgba(252,211,77,0.3)",
        }}>
          THRESHOLD
        </h1>

        <div style={{
          fontSize: 11, letterSpacing: "0.3em", color: "#8b7355",
          marginBottom: 60, fontWeight: 400,
        }}>
          FLOW FUNDING
        </div>

        {/* Center ring + enter */}
        <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto 50px" }}>
          <GlowRing phase={phase} />
          <button onClick={handleEnter} style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "none", border: "1px solid rgba(252,211,77,0.3)",
            color: "#fcd34d", fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, fontWeight: 700, letterSpacing: "0.2em",
            padding: "12px 28px", borderRadius: 4, cursor: "pointer",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={e => { e.target.style.background = "rgba(252,211,77,0.08)"; e.target.style.borderColor = "rgba(252,211,77,0.6)"; }}
          onMouseLeave={e => { e.target.style.background = "none"; e.target.style.borderColor = "rgba(252,211,77,0.3)"; }}
          >
            ENTER
          </button>
        </div>

        {/* Tagline */}
        <p style={{
          fontSize: 13, color: "#7a6a50", maxWidth: 380,
          lineHeight: 1.8, margin: "0 auto", fontWeight: 400,
        }}>
          Flow funding through purpose networks to create real change.
        </p>
      </div>
    </div>
  );
}
