// The aquarium page. It polls the server once a second and animates what the
// server reports; the server decides everything (fights, damage, Elo).
(() => {
  "use strict";

  const POLL_MS = 1000;
  const EVENT_DELAY = 1.1;    // seconds: play hits slightly behind the server so each poll's hits arrive in time
  const IDLE_RESUME_S = 180;  // after this long without anyone using the side panel, clear its monster filter
  const HISTORY_REFRESH_S = 30;
  const FOLLOW_S = 4;         // monsters follow the mouse until it's been still this long
  const MAX_CLICK_BUBBLES = 80;

  const $ = (id) => document.getElementById(id);
  const canvas = $("tank");
  const ctx = canvas.getContext("2d");
  const els = {
    banner: $("banner"), empty: $("empty"), status: $("status"), joinHint: $("joinHint"), version: $("version"),
    filter: $("filter"), week: $("week"), weekRow: $("weekRow"), historyView: $("historyView"), leaderView: $("leaderView"),
    tabs: [$("tabHistory"), $("tabLeaders")], panelToggle: $("panelToggle"),
  };

  let W = 0, H = 0, dpr = 1, remPx = 16, scenery = null;
  let monsters = [];
  let sizePerElo = 100; // Elo that doubles a fish's size; an admin setting sent with each state
  let seasonMode = "auto"; // seasonal decorations (themes.js): "off", "auto" (by date) or a theme key; an admin setting
  // ?theme=december (or another theme's key, or off) previews a theme in this browser only; ?day=N picks the day of
  // December.
  const params = new URLSearchParams(location.search);
  const themeOverride = (params.get("theme") || "").toLowerCase() || null;
  if (+params.get("day") >= 1) Seasons.previewDay = Math.min(31, Math.floor(+params.get("day")));
  let styleNames = {}, styleCount = 6, rulesVersion = 0; // fighting style id -> name, from /api/rules
  let week = null;               // the live week: {started_at, next_reset_at}
  let champion = null, championWeek = null; // last week's champion (wears the crown) and that week's id
  let weeks = null, weeksFor = null, weeksRetryAt = 0, weeksVersion = 0, weekKey = ""; // past weeks, oldest first
  const actors = new Map();      // monster id -> what's drawn for it
  const fightViews = new Map();  // fight id -> local fight animation
  const queue = [];              // [{at, fn}] sorted by local time
  const particles = [];
  const floaters = [];
  const kelp = [];
  let shownResultId = null, firstState = true, bannerTimer = 0;
  let lastInteraction = -Infinity, lastHistoryLoad = 0, boardKey = "", filterKey = "";
  const pointer = { x: 0, y: 0, moved: -Infinity };

  const now = () => performance.now() / 1000;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const swatch = (m) => `<span class="swatch" style="--body-color:${m.colors.body};--accent-color:${m.colors.accent}"></span>`;

  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function bounds() {
    return { x0: W * 0.07, x1: W * 0.93, y0: H * 0.16, y1: H * 0.78 };
  }

  // ---- scenery ------------------------------------------------------------

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    rebuildScene();
  }

  function rebuildScene() {
    if (!W || !H) return; // the sand loops step by W/48 and would never end at zero size
    Seasons.scene({ ctx, W, H, dpr, canvasW: canvas.width, canvasH: canvas.height, kelp, kelpPoint });
    buildKelp();
    scenery = buildScenery();
    Seasons.layout();
  }

  // Which seasonal theme is showing: checked on load, every minute, and when the admin setting changes.
  function checkSeason() {
    const k = Seasons.pick(new Date(), seasonMode, themeOverride);
    if (k === Seasons.key) return;
    Seasons.activate(k);
    rebuildScene();
  }

  function buildScenery() {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const wc = Seasons.water() || ["#1386a6", "#0b5a7a", "#05263d"];
    const water = g.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, wc[0]);
    water.addColorStop(0.35, wc[1]);
    water.addColorStop(1, wc[2]);
    g.fillStyle = water;
    g.fillRect(0, 0, W, H);

    const rnd = seeded(7);
    const sandTop = H * 0.86;
    const sandY = (x) => sandTop + Math.sin((x / W) * 9) * H * 0.012 + Math.sin((x / W) * 23) * H * 0.005;
    const rocks = []; // where the rocks are, so seasonal decorations on the sand can keep clear of them
    g.fillStyle = "rgba(3, 30, 48, 0.5)";
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(rnd() * W, sandTop, W * (0.06 + rnd() * 0.09), H * (0.08 + rnd() * 0.14), 0, Math.PI, 0);
      g.fill();
    }

    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 1; x += W / 48) {
      g.lineTo(x, sandY(x));
    }
    g.lineTo(W, H);
    g.closePath();
    const sand = g.createLinearGradient(0, sandTop, 0, H);
    const sc = Seasons.sand() || ["#c9b27a", "#7d6a42"];
    sand.addColorStop(0, sc[0]);
    sand.addColorStop(1, sc[1]);
    g.fillStyle = sand;
    g.fill();
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,.14)" : "rgba(60,40,10,.2)";
      g.fillRect(rnd() * W, sandTop + H * 0.02 + rnd() * (H - sandTop), 1.5, 1.5);
    }
    for (let i = 0; i < 5; i++) {
      const x = rnd() * W, r = H * (0.02 + rnd() * 0.03);
      rocks.push({ x, r });
      const rg = g.createRadialGradient(x - r * 0.4, sandTop - r * 0.2, r * 0.1, x, sandTop + r * 0.3, r * 1.4);
      rg.addColorStop(0, "#7a8a90");
      rg.addColorStop(1, "#283338");
      g.fillStyle = rg;
      g.beginPath();
      g.ellipse(x, sandTop + r * 0.5, r * 1.4, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    Seasons.scene({ ctx, W, H, dpr, canvasW: canvas.width, canvasH: canvas.height, sandY, sandTop, rocks });
    Seasons.decorate(g);
    return c;
  }

  function buildKelp() {
    kelp.length = 0;
    const rnd = seeded(11);
    for (let i = 0; i < 8; i++) {
      kelp.push({ x: W * (0.03 + rnd() * 0.94), h: H * (0.25 + rnd() * 0.35), phase: rnd() * 10,
        hue: 95 + rnd() * 45, w: H * (0.008 + rnd() * 0.006) });
    }
  }

  function kelpPoint(k, u, t) {
    return { x: k.x + Math.sin(t * 0.7 + k.phase + u * 3) * u * H * 0.04, y: H * 0.89 - k.h * u };
  }

  function drawRays(t) {
    const top = Seasons.rays() || "rgba(180,240,255,0.09)";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const x = W * (0.1 + i * 0.2) + Math.sin(t * 0.15 + i * 2) * W * 0.04;
      const w = W * (0.04 + 0.025 * Math.sin(t * 0.2 + i));
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.85);
      g.addColorStop(0, top);
      g.addColorStop(1, "rgba(180,240,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.3, 0);
      ctx.lineTo(x + w * 0.3, 0);
      ctx.lineTo(x + w + W * 0.08, H * 0.85);
      ctx.lineTo(x - w + W * 0.08, H * 0.85);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawKelp(t) {
    const base = H * 0.89;
    ctx.lineCap = "round";
    for (const k of kelp) {
      let px = k.x, py = base;
      for (let i = 1; i <= 14; i++) {
        const u = i / 14;
        const { x, y } = kelpPoint(k, u, t);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.lineWidth = k.w * (1.2 - u * 0.8);
        ctx.strokeStyle = `hsl(${k.hue} 45% ${20 + u * 12}%)`;
        ctx.stroke();
        if (i % 3 === 0) {
          const side = i % 2 ? 1 : -1;
          if (Seasons.kelpLeaf(x, y, k, side, u)) { px = x; py = y; continue; }
          ctx.beginPath();
          ctx.ellipse(x + side * k.w * 1.8, y, k.w * 2.2, k.w * 0.8, -side * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${k.hue} 45% ${24 + u * 10}%)`;
          ctx.fill();
        }
        px = x;
        py = y;
      }
    }
  }

  // ---- monsters -------------------------------------------------------------

  function sizeFor(m) {
    const crowd = clamp(Math.sqrt(8 / Math.max(1, monsters.length)), 0.6, 1);
    // Bigger with higher Elo: ×1.25 at the starting 1500, doubling every sizePerElo (an admin setting) above it
    // and halving every sizePerElo below, within reason.
    const grow = sizePerElo > 0 ? 2 ** (((m.elo ?? 1500) - 1500) / sizePerElo) : 1;
    return H * 0.15 * crowd * clamp(1.25 * grow, 0.6, 2) * (SHAPE_SCALE[m.shape] ?? 1);
  }
  // Shapes drawn smaller than the others at the same size. The seahorse is tall and fills more of its box; the prawn
  // is just meant to be a small one.
  const SHAPE_SCALE = { seahorse: 0.9, prawn: 0.8 };

  function newActor(m) {
    const b = bounds();
    const facing = Math.random() < 0.5 ? -1 : 1;
    return { id: m.id, m, x: rand(b.x0, b.x1), y: rand(b.y0, b.y1), vx: 0, vy: 0, tx: 0, ty: 0, retarget: 0,
      facing, face: facing, phase: rand(0, 100), speed: rand(0.75, 1.2), hpShown: m.hp,
      flash: 0, lunge: 0, knock: 0, dodge: 0, startled: 0, dazed: false, belly: 0, lead: MonsterArt.swimFace(m.shape, 1), lean: 0, fightId: null };
  }

  function updateActors(dt, t) {
    const b = bounds();
    for (const a of actors.values()) {
      const size = sizeFor(a.m);
      const fv = a.fightId != null ? fightViews.get(a.fightId) : null;
      a.dazed = !fv && a.m.max_hp > 0 && a.hpShown / a.m.max_hp < 0.2;
      let speed, accel = 2.5, vertical = 0.6;
      if (fv) {
        const side = fv.a === a.id ? -1 : 1;
        const fighting = t >= fv.startLocal;
        const gap = fighting ? size * 0.42 : size * 0.9;
        a.tx = fv.meet.x + side * gap + (fighting ? Math.sin(t * 9 + a.phase) * size * 0.05 : 0);
        a.ty = fv.meet.y + (fighting ? Math.sin(t * 7 + a.phase) * size * 0.08 : 0);
        speed = W * 0.12;
        accel = fighting ? 8 : 3;
        vertical = 1;
        a.facing = -side;
      } else if (a.dazed) {
        a.tx = a.x;
        // Float belly-up toward the top while recovering, low enough to keep its name and HP bar in view.
        a.ty = Math.max(b.y0 - H * 0.06, size * 0.5 + remPx * 1.4);
        a.retarget = 0;
        speed = H * 0.03;
        vertical = 1;
      } else if (t - pointer.moved < FOLLOW_S && a.startled <= 0) {
        // Each monster aims a little off the cursor so they gather round it instead of piling up.
        a.tx = clamp(pointer.x + Math.cos(a.phase) * size * 0.7, b.x0, b.x1);
        a.ty = clamp(pointer.y + Math.sin(a.phase) * size * 0.4, b.y0, b.y1);
        a.retarget = 0; // pick a fresh wander target once the mouse goes still
        speed = W * 0.06 * a.speed;
      } else {
        a.retarget -= dt;
        if (a.retarget <= 0 || Math.hypot(a.tx - a.x, a.ty - a.y) < size * 0.3) {
          a.tx = rand(b.x0, b.x1);
          a.ty = rand(b.y0, b.y1);
          a.retarget = rand(6, 14);
        }
        speed = W * 0.035 * a.speed;
      }
      const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy) || 1;
      const want = speed * Math.min(1, dist / (size * 0.8));
      let dvx = (dx / dist) * want, dvy = (dy / dist) * want * vertical;
      if (!fv) {
        for (const o of actors.values()) {
          if (o === a || o.fightId != null) continue;
          const ox = a.x - o.x, oy = a.y - o.y, d = Math.hypot(ox, oy);
          const min = (size + sizeFor(o.m)) * 0.45;
          if (d > 0 && d < min) {
            dvx += (ox / d) * W * 0.03;
            dvy += (oy / d) * W * 0.03;
          }
        }
      }
      const k = Math.min(1, dt * accel);
      a.vx += (dvx - a.vx) * k;
      a.vy += (dvy - a.vy) * k;
      a.x = clamp(a.x + a.vx * dt, W * 0.03, W * 0.97);
      a.y = clamp(a.y + a.vy * dt, H * 0.1, H * 0.84);
      if (!fv && Math.abs(a.vx) > W * 0.004) a.facing = MonsterArt.swimFace(a.m.shape, Math.sign(a.vx));
      a.face += (a.facing - a.face) * Math.min(1, dt * 5);
      // Which end leads: the head in a fight, the mantle for an idle squid. Eased, so a squid turns its eyes and tilt
      // round smoothly as a fight starts or ends.
      a.lead += ((fv ? 1 : MonsterArt.swimFace(a.m.shape, 1)) - a.lead) * Math.min(1, dt * 5);
      a.lean += ((fv ? 1 : 0) - a.lean) * Math.min(1, dt * 3);
      a.flash = Math.max(0, a.flash - dt * 4);
      a.lunge = Math.max(0, a.lunge - dt * 4);
      a.knock = Math.max(0, a.knock - dt * 3);
      a.dodge = Math.max(0, a.dodge - dt * 3);
      a.startled = Math.max(0, a.startled - dt);
      if (a.aura && (a.aura.left -= dt) <= 0) a.aura = null;
      a.belly = clamp(a.belly + (a.dazed ? dt : -dt) * 1.5, 0, 1);
      if (!fv) a.hpShown += (a.m.hp - a.hpShown) * Math.min(1, dt * 3);
    }
  }

  function drawActor(a, t) {
    const size = sizeFor(a.m);
    const x = a.x + Math.sin(a.lunge * Math.PI) * size * 0.28 * a.facing - a.knock * size * 0.12 * a.facing;
    const y = a.y + Math.sin(t * 1.3 + a.phase) * size * 0.04 - Math.sin(a.dodge * Math.PI) * size * 0.3;
    const tilt = a.dazed ? 0.12 : clamp(a.vy / (W * 0.05), -0.35, 0.35) * a.lead;
    // Rolls over onto its back when dazed: the vertical scale runs from 1 through 0 to −1.
    const flip = Math.cos(a.belly * Math.PI);
    // Last week's champion wears a crown, which drifts off its head while it's belly-up.
    MonsterArt.draw(ctx, a.m, x, y, size, a.face, t * a.speed + a.phase,
      { tilt, flip, lead: a.lead, lean: a.lean, dazed: a.dazed, crown: a.id === champion, belly: a.belly });
    if (a.flash > 0) {
      // An expanding ring for a hit. Brightening the monster with ctx.filter looked nicer but made fights stutter.
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * a.flash})`;
      ctx.lineWidth = size * 0.04;
      ctx.beginPath();
      ctx.arc(x, y, size * (0.6 - 0.2 * a.flash), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (a.aura) {
      // A pulsing ring while Last Stand or Second Wind lasts, fading out over its last half second.
      ctx.globalAlpha = Math.min(1, a.aura.left * 2) * (0.55 + 0.25 * Math.sin(t * 9));
      ctx.strokeStyle = a.aura.color;
      ctx.lineWidth = size * 0.035;
      ctx.beginPath();
      ctx.arc(x, y, size * (0.62 + 0.03 * Math.sin(t * 9)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const ly = y - size * 0.46 - remPx * 0.3;
    ctx.font = `600 ${remPx * 0.72}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.lineWidth = remPx * 0.22;
    ctx.strokeStyle = "rgba(2,14,24,.8)";
    ctx.strokeText(a.m.name, x, ly);
    ctx.fillStyle = "#fff";
    ctx.fillText(a.m.name, x, ly);

    const frac = a.m.max_hp > 0 ? clamp(a.hpShown / a.m.max_hp, 0, 1) : 0;
    const bw = Math.max(size * 0.7, remPx * 3), bh = remPx * 0.28;
    const bx = x - bw / 2, by = ly + remPx * 0.15;
    ctx.fillStyle = "rgba(2,14,24,.75)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = frac > 0.5 ? "#6be38f" : frac > 0.25 ? "#ffcc66" : "#ff7a6b";
    ctx.fillRect(bx, by, bw * frac, bh);
  }

  // ---- fight effects -----------------------------------------------------------

  // How each kind of fight text looks: its color, and its size and how long it lasts relative to a plain hit.
  const TEXT = {
    hit: { color: "#ffd2c6" },
    crit: { color: "#ff5a3c", scale: 1.4 },
    counter: { color: "#6ec3ff" },                       // Riposte's counterattack
    venom: { color: "#c99bff", scale: 0.72 },            // Spikes and Poison
    dodge: { color: "#9fe9ff" },
    immune: { color: "#ffd166", scale: 0.72 },
    heal: { color: "#7cf0a0" },
    last_stand: { color: "#ffd166", scale: 1.1, life: 1.9, label: "Last Stand!" },
    second_wind: { color: "#7cf0a0", scale: 1.1, life: 1.9, label: "Second Wind!" },
  };
  const amount = (n) => (n >= 10 ? Math.round(n) : n);

  function playEvent(ev) {
    if (ev.kind === "skill") return playSkill(ev);
    if (ev.kind === "dot") {
      const a = actors.get(ev.to);
      if (a) {
        floater(a, `-${amount(ev.dmg)}`, TEXT.venom);
        a.hpShown = ev.hp;
      }
      return;
    }
    const atk = actors.get(ev.by), tgt = actors.get(ev.to);
    if (!atk || !tgt) return;
    const tags = ev.tags || [];
    atk.lunge = 1;
    if (ev.dodged) {
      tgt.dodge = 1;
      floater(tgt, "dodge!", TEXT.dodge);
    } else if (tags.includes("immune")) {
      tgt.flash = 1;
      floater(tgt, "immune", TEXT.immune);
    } else {
      tgt.flash = 1;
      tgt.knock = 1;
      floater(tgt, `-${amount(ev.dmg)}`, tags.includes("crit") ? TEXT.crit : tags.includes("counter") ? TEXT.counter : TEXT.hit);
      if (ev.spikes) {
        floater(atk, `-${amount(ev.spikes)}`, TEXT.venom);
        if (ev.by_hp != null) atk.hpShown = ev.by_hp;
      }
      const size = sizeFor(tgt.m);
      for (let i = 0; i < 6; i++) {
        const ang = rand(0, Math.PI * 2), sp = rand(0.8, 1.6) * size;
        particles.push({ kind: "spark", x: (atk.x + tgt.x) / 2, y: (atk.y + tgt.y) / 2, vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp, r: size * 0.06, life: 0, max: 0.25 });
      }
    }
    tgt.hpShown = ev.hp;
  }

  // Last Stand and Second Wind: their name pops up, and a ring glows round the monster while the effect lasts.
  function playSkill(ev) {
    const a = actors.get(ev.to), style = TEXT[ev.skill];
    if (!a || !style) return;
    floater(a, style.label, style, -0.25);
    if (ev.heal > 0) floater(a, `+${amount(ev.heal)}`, TEXT.heal, 0.1);
    a.aura = { color: style.color, left: Math.max(ev.seconds || 0, 0.8), max: Math.max(ev.seconds || 0, 0.8) };
    a.hpShown = ev.hp;
  }

  // style: one of TEXT. dy shifts where it starts, in monster sizes (negative is higher), so two at once don't overlap.
  function floater(a, text, style, dy = 0) {
    if (floaters.length > 30) return;
    const size = sizeFor(a.m);
    floaters.push({ x: a.x + rand(-0.15, 0.15) * size, y: a.y - size * (0.2 - dy), rise: size * 0.6, text,
      color: style.color, scale: style.scale || 1, life: 0, max: style.life || 1.2 });
  }

  function spawnScuffle(dt, t) {
    for (const fv of fightViews.values()) {
      if (t < fv.startLocal || (fv.ended && t > fv.endLocal)) continue;
      const A = actors.get(fv.a);
      const size = A ? sizeFor(A.m) : H * 0.12;
      fv.spawn = (fv.spawn || 0) + dt * 6;
      while (fv.spawn >= 1) {
        fv.spawn -= 1;
        const puff = Math.random() < 0.55;
        particles.push({
          kind: puff ? "puff" : "bubble",
          x: fv.meet.x + rand(-0.6, 0.6) * size, y: fv.meet.y + rand(-0.35, 0.35) * size,
          r: puff ? rand(0.15, 0.32) * size : rand(0.02, 0.05) * size,
          vx: rand(-20, 20), vy: puff ? rand(-15, 5) : rand(-70, -35),
          life: 0, max: puff ? rand(0.6, 1.1) : rand(1, 2),
        });
      }
    }
  }

  function spawnAmbient(dt) {
    for (const vx of [0.18, 0.77]) {
      if (Math.random() < dt * 3) {
        particles.push({ kind: "bubble", x: W * vx + rand(-6, 6), y: H * 0.87, r: rand(0.004, 0.011) * H,
          vx: 0, vy: -rand(0.06, 0.12) * H, life: 0, max: 14, wobble: rand(0, 6), tint: Seasons.bubbleTint(),
          heart: Seasons.heartBubble() });
      }
    }
  }

  function updateParticles(dt, t) {
    spawnScuffle(dt, t);
    spawnAmbient(dt);
    for (const p of particles) {
      p.life += dt;
      p.x += (p.vx + (p.wobble != null ? Math.sin(t * 3 + p.wobble) * 8 : 0)) * dt;
      p.y += p.vy * dt;
      if (p.kind === "puff") p.r *= 1 + dt * 0.6;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.life >= p.max || p.y < -20) particles.splice(i, 1);
    }
    for (const f of floaters) f.life += dt;
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].life >= floaters[i].max) floaters.splice(i, 1);
  }

  function drawParticles(front) {
    for (const p of particles) {
      const fade = 1 - p.life / p.max;
      if (p.kind === "puff") {
        if (!front) continue;
        // A flat fill: a gradient per puff per frame was one of the costs that made fights stutter.
        ctx.fillStyle = `rgba(225,238,242,${0.22 * fade})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "spark") {
        if (!front) continue;
        ctx.strokeStyle = `rgba(255,240,180,${fade})`;
        ctx.lineWidth = p.r * 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
        ctx.stroke();
      } else if (front === (p.front || p.wobble == null)) {
        // Scuffle and click bubbles go in front of the monsters; the vents' ambient bubbles behind.
        ctx.strokeStyle = `rgba(${p.tint || "220,245,255"},${0.55 * Math.min(1, fade * 3)})`;
        if (p.heart) { // Valentine's
          ctx.lineWidth = Math.max(1, p.r * 0.18);
          Seasons.heartPath(ctx, p.x, p.y, p.r * 1.1);
          ctx.stroke();
          continue;
        }
        ctx.lineWidth = Math.max(1, p.r * 0.18);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of floaters) {
      ctx.font = `700 ${remPx * 0.95 * f.scale}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = remPx * 0.25 * Math.min(1, f.scale);
      const u = f.life / f.max;
      ctx.globalAlpha = 1 - u * u;
      const y = f.y - f.rise * u;
      ctx.strokeStyle = "rgba(2,14,24,.85)";
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- frame loop --------------------------------------------------------------

  let lastFrame = now();
  function frame() {
    const t = now();
    const dt = Math.min(0.05, t - lastFrame);
    lastFrame = t;
    while (queue.length && queue[0].at <= t) queue.shift().fn();
    for (const fv of [...fightViews.values()]) {
      if (fv.ended && t >= fv.endLocal) {
        fightViews.delete(fv.id);
        for (const id of [fv.a, fv.b]) {
          const a = actors.get(id);
          if (a && a.fightId === fv.id) a.fightId = null;
        }
      }
    }
    updateActors(dt, t);
    updateParticles(dt, t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (scenery) ctx.drawImage(scenery, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Seasons.far(t, dt);
    drawRays(t);
    drawKelp(t);
    Seasons.back(t, dt);
    drawParticles(false);
    for (const a of [...actors.values()].sort((p, q) => p.y - q.y)) drawActor(a, t);
    drawParticles(true);
    const glass = Seasons.glass();
    if (glass) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(glass, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    Seasons.front(t);
    drawFloaters();
    requestAnimationFrame(frame);
  }

  // ---- server state --------------------------------------------------------------

  function applyState(s) {
    const tl = now();
    const toLocal = (serverTs) => serverTs - s.server_time + tl + EVENT_DELAY;
    monsters = s.monsters;
    sizePerElo = s.size_per_elo ?? 100;
    const mode = s.seasonal_theme ?? "auto";
    if (mode !== seasonMode) {
      seasonMode = mode;
      checkSeason();
    }
    const reset = week && s.week && s.week.started_at !== week.started_at;
    week = s.week || null;
    champion = s.champion ?? null;
    championWeek = s.champion_week ?? null;

    const ids = new Set();
    for (const m of s.monsters) {
      ids.add(m.id);
      let a = actors.get(m.id);
      if (!a) actors.set(m.id, (a = newActor(m)));
      a.m = m;
    }
    for (const id of [...actors.keys()]) if (!ids.has(id)) actors.delete(id);

    const live = new Set();
    for (const f of s.fights) {
      live.add(f.id);
      let fv = fightViews.get(f.id);
      if (!fv) {
        const A = actors.get(f.a), B = actors.get(f.b);
        if (!A || !B) continue;
        const left = A.x <= B.x ? A : B; // whoever is already on the left stays there
        fv = { id: f.id, a: left.id, b: left === A ? B.id : A.id, lastSeq: 0, lastEventAt: 0, ended: false,
          endLocal: Infinity, meet: meetPoint(A, B) };
        fightViews.set(f.id, fv);
        A.fightId = B.fightId = f.id;
        if (!firstState) showBanner(`${A.m.name} vs ${B.m.name}!`, 5000);
      }
      fv.startLocal = toLocal(f.start);
      for (const ev of f.events) {
        if (ev.seq <= fv.lastSeq) continue;
        fv.lastSeq = ev.seq;
        const at = Math.max(tl, toLocal(ev.t));
        fv.lastEventAt = Math.max(fv.lastEventAt, at);
        queue.push({ at, fn: () => playEvent(ev) });
      }
    }
    for (const fv of fightViews.values()) {
      if (!live.has(fv.id) && !fv.ended) {
        fv.ended = true;
        fv.endLocal = Math.max(tl + EVENT_DELAY, fv.lastEventAt + 0.5);
      }
    }

    const r = s.last_result;
    if (r && r.id !== shownResultId) {
      shownResultId = r.id;
      if (!firstState || s.server_time - r.ended_at < 20) {
        const fv = fightViews.get(r.id);
        queue.push({ at: fv ? fv.endLocal : tl, fn: () => { showBanner(resultText(r), 9000); loadHistory(); } });
      }
    }
    queue.sort((p, q) => p.at - q.at);
    firstState = false;

    updateStatus(s);
    els.empty.hidden = s.monsters.length > 0;
    els.empty.textContent = `The tank is empty. Create the first fish at ${location.host}/editor`;
    // Past weeks: fetched at the start and again after each weekly reset (when the live week's start changes).
    if (reset) loadHistory();
    if (week && weeksFor !== week.started_at && now() >= weeksRetryAt) loadWeeks();
    updateWeekOptions();
    updateFilterOptions();
    renderLeaders();
  }

  // Halfway between the two, moved sideways if that's on top of another fight.
  function meetPoint(A, B) {
    const y = clamp((A.y + B.y) / 2, H * 0.25, H * 0.7);
    let x = clamp((A.x + B.x) / 2, W * 0.2, W * 0.8);
    for (let tries = 0; tries < 4; tries++) {
      const near = [...fightViews.values()].find((fv) => !fv.ended && Math.abs(fv.meet.x - x) < W * 0.3 && Math.abs(fv.meet.y - y) < H * 0.3);
      if (!near) break;
      x = clamp(near.meet.x + (near.meet.x > W * 0.5 ? -1 : 1) * W * 0.3, W * 0.2, W * 0.8);
    }
    return { x, y };
  }

  function resultText(r) {
    const how = r.reason === "ko" ? "KO" : "time limit";
    return `${r.winner.name} defeated ${r.loser.name} (${how}, ${fmtDuration(r.duration)})`;
  }

  function showBanner(text, ms) {
    els.banner.textContent = text;
    els.banner.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => els.banner.classList.remove("show"), ms);
  }

  function updateStatus(s) {
    const byId = new Map(s.monsters.map((m) => [m.id, m]));
    let text;
    if (s.fights.length) {
      const pairs = s.fights.map((f) => `${(byId.get(f.a) || {}).name} vs ${(byId.get(f.b) || {}).name}`);
      text = `${pairs.length > 1 ? "Scuffles" : "Scuffle"}: ${pairs.join(" · ")}`;
    } else if (s.paused) {
      text = "Fights are paused";
    } else if (s.monsters.length < 2) {
      text = "Waiting for at least two fish";
    } else {
      const secs = s.next_fight_at - s.server_time;
      text = secs <= 45 ? "Next scuffle any moment" : `Next scuffle in about ${Math.round(secs / 60)} min`;
    }
    els.status.textContent = text;
    els.status.classList.remove("offline");
    // Set once: rebuilding the link on every poll would flicker under the mouse.
    if (!els.joinHint.firstChild) {
      els.joinHint.innerHTML = `Make your fish: <a href="/editor" target="_blank">${esc(location.host)}/editor</a>`;
    }
    els.version.textContent = s.version ? `v${s.version}` : "";
  }

  async function poll() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      applyState(await res.json());
    } catch (e) {
      els.status.textContent = "Can't reach the server. Retrying…";
      els.status.classList.add("offline");
    }
    setTimeout(poll, POLL_MS);
  }

  // ---- ticker -------------------------------------------------------------------------
  // Office news and stats from /api/ticker, scrolling under the tank. The server sends ready-to-show items (see
  // the ticker section of DESIGN.md): {label, value?, change?, trend?, good?, group?}. Items that share a group
  // are shown together after a group heading. When the system asks for reduced motion, the ticker doesn't
  // slide: it shows a screenful of items at a time and swaps to the next screenful every few seconds.

  const TICKER_MS = 60 * 1000;     // how often to ask the server; it refreshes its own source on its own schedule
  const TICKER_REM_PER_S = 4;      // scroll speed
  const TICKER_PAGE_MS = 7000;     // reduced motion: how long each screenful shows
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const TICKER_STALE_MIN = 30;     // a fetched source not updated for this long: the lead-in turns amber and says since when
  // items: [{html, group}] in order; headers: group name -> its heading, repeated at the start of any
  // reduced-motion page that opens partway through a group so the numbers still read.
  const ticker = { el: $("ticker"), track: $("tickerTrack"), key: "", items: [], headers: {}, pages: [], page: 0, timer: 0 };

  const tickerItem = (inner, cls = "") => `<span class="ticker-item${cls ? " " + cls : ""}">${inner}</span>`;
  // Green when the trend is the good direction, red when it's the bad one; plain when there's no trend.
  const trendClass = (it) => (it.trend === "up" || it.trend === "down"
    ? (it.trend === (it.good === "down" ? "down" : "up") ? "up" : "down") : "");
  const ARROWS = { up: "▲ ", down: "▼ " };

  function tickerItems(list) {
    const items = [];
    ticker.headers = {};
    let group = null;
    for (const it of list) {
      if (!it || typeof it.label !== "string" || !it.label) continue;
      const g = typeof it.group === "string" && it.group ? it.group : null;
      if (g && g !== group) {
        ticker.headers[g] = tickerItem(`<span class="k">${esc(g)}</span>`, "group");
        items.push({ html: ticker.headers[g], group: null });
      }
      group = g;
      const cls = trendClass(it);
      const has = (v) => typeof v === "string" && v !== "";
      // The trend colors the change when there is one, otherwise the value.
      let inner = `<span class="k">${esc(it.label)}</span>`;
      if (has(it.value)) inner += `<span class="v ${has(it.change) ? "" : cls}">${esc(it.value)}</span>`;
      if (has(it.change)) inner += ` <span class="v ${cls}">${ARROWS[it.trend] || ""}${esc(it.change)}</span>`;
      items.push({ html: tickerItem(inner), group: g });
    }
    return items;
  }

  function renderTicker(data) {
    const list = Array.isArray(data && data.items) ? data.items : [];
    let lead = (data && typeof data.title === "string" && data.title) || "", stale = false;
    const at = data && data.fetched_at ? new Date(data.fetched_at * 1000) : null;
    if (at && !isNaN(at) && Date.now() - at > TICKER_STALE_MIN * 60e3) {
      stale = true;
      const sameDay = at.toDateString() === new Date().toDateString();
      const when = at.toLocaleString(undefined, sameDay ? { hour: "numeric", minute: "2-digit" }
        : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      lead = `${lead || "Ticker"} · not updated since ${when}`;
    }
    // Keyed on what's shown, not the fetch time, so a refresh with the same items doesn't restart the scroll.
    const key = JSON.stringify([list, lead]);
    if (key === ticker.key) return;
    ticker.key = key;
    const items = tickerItems(list);
    const wasHidden = ticker.el.hidden;
    if (!items.length) {
      ticker.el.hidden = true;
      ticker.track.innerHTML = "";
      if (!wasHidden) resize();
      return;
    }
    if (lead) items.unshift({ html: `<span class="ticker-item asof${stale ? " stale" : ""}"><span class="k">${esc(lead)}</span></span>`, group: null });
    ticker.items = items;
    ticker.el.hidden = false;
    if (wasHidden) resize(); // the band takes its height from the tank
    layoutTicker();
  }

  // Lay the items out for the current motion preference: one long scrolling strip, or screenfuls that swap.
  function layoutTicker() {
    clearInterval(ticker.timer);
    ticker.timer = 0;
    if (ticker.el.hidden || !ticker.items.length) return;
    if (!reducedMotion.matches) {
      const once = ticker.items.map((it) => it.html).join("");
      ticker.track.innerHTML = once + once; // two copies: scrolling by one copy's width loops seamlessly
      tickerSpeed();
      return;
    }
    // Measure every item (and each group heading) in one pass, then fill each page up to the band's width.
    const groups = Object.keys(ticker.headers);
    ticker.track.innerHTML = ticker.items.map((it) => it.html).join("") + groups.map((g) => ticker.headers[g]).join("");
    const widths = [...ticker.track.children].map((c) => c.getBoundingClientRect().width);
    const headerW = {};
    groups.forEach((g, i) => { headerW[g] = widths[ticker.items.length + i]; });
    const room = ticker.el.clientWidth;
    const pages = [];
    let page = null, used = 0;
    ticker.items.forEach((it, i) => {
      if (!page || used + widths[i] > room) {
        page = [];
        used = 0;
        pages.push(page);
        if (it.group) {
          page.push(ticker.headers[it.group]);
          used += headerW[it.group];
        }
      }
      page.push(it.html);
      used += widths[i];
    });
    ticker.pages = pages;
    ticker.page = ticker.page % pages.length;
    showTickerPage();
    if (pages.length > 1) {
      ticker.timer = setInterval(() => {
        ticker.page = (ticker.page + 1) % ticker.pages.length;
        showTickerPage();
      }, TICKER_PAGE_MS);
    }
  }

  function showTickerPage() {
    ticker.track.innerHTML = ticker.pages[ticker.page].join("");
  }

  function tickerSpeed() {
    if (ticker.el.hidden || reducedMotion.matches) return;
    const seconds = ticker.track.scrollWidth / 2 / (remPx * TICKER_REM_PER_S);
    ticker.track.style.setProperty("--ticker-s", `${Math.max(10, seconds).toFixed(1)}s`);
  }

  // Scrolling only needs a new speed after a resize; pages need refilling to the new width.
  function tickerResized() {
    if (reducedMotion.matches) layoutTicker();
    else tickerSpeed();
  }
  reducedMotion.addEventListener("change", layoutTicker);

  async function pollTicker() {
    let got = false;
    try {
      const res = await fetch("/api/ticker", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        got = true;
        renderTicker(data); // no items (ticker off, or nothing to show): the band hides
      }
    } catch (e) {
      // Keep showing the last items; the next poll tries again.
    }
    // Right after a server restart its first fetch may still be on the way, so check back soon.
    setTimeout(pollTicker, got ? TICKER_MS : 15000);
  }

  // ---- side panel -------------------------------------------------------------------

  function fmtDuration(sec) {
    sec = Math.round(sec);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  function ago(ts) {
    const s = Date.now() / 1000 - ts;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    return new Date(ts * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const winRate = (m) => {
    const n = m.wins + m.losses;
    return n ? m.wins / n : 0;
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const streak = (s) => (s > 0 ? `<span class="win">W${s}</span>` : s < 0 ? `<span class="loss">L${-s}</span>` : `<span class="muted">–</span>`);
  const best = (b) => (b > 0 ? `W${b}` : "–");
  const whole = (n) => (n == null ? "–" : String(Math.round(n)));
  const styleName = (id) => (id ? styleNames[id] || id.charAt(0).toUpperCase() + id.slice(1) : "–");
  const crownSvg = (title) => `<svg class="crown" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>`;
  const tag = (text) => `<span class="gone">${text}</span>`;
  // Form is rolled every morning, hidden during the week and revealed once it ends: a stat multiplier, shown as
  // a percentage change.
  const fmtForm = (f) => {
    if (f == null) return "–";
    const p = Math.round((f - 1) * 100);
    return p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : "±0%";
  };
  // A past week's daily forms as one line for the Avg form stat's tooltip ("Mon +12% · Tue −3% · …"). Kept
  // out of sight on purpose: casual viewers see only the average. A fish that joined late in a week has fewer rolls.
  function formTip(m) {
    if (!m.forms.length) return "";
    const day = ([t, f]) => `${new Date(t * 1000).toLocaleString("en-US", { weekday: "short" })} ${fmtForm(f)}`;
    return `Daily form: ${m.forms.map(day).join(" · ")}`;
  }

  // ---- weeks ----
  const day = (ts, o) => new Date(ts * 1000).toLocaleString("en-US", o);
  // "Nov 2 – 9", or "Oct 26 – Nov 2" across months.
  function weekLabel(w) {
    const a = new Date(w.started_at * 1000), b = new Date(w.ended_at * 1000);
    const mon = (d) => d.toLocaleString("en-US", { month: "short" });
    return mon(a) === mon(b) ? `${mon(a)} ${a.getDate()} – ${b.getDate()}` : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
  }
  const liveLabel = () => (week ? `This week (since ${day(week.started_at, { weekday: "short", month: "short", day: "numeric" }).replace(",", "")})` : "This week");
  // "Monday, November 9, 6:57 AM" (weekday optional).
  const longTime = (ts, weekday) => `${day(ts, { ...(weekday ? { weekday: "long" } : {}), month: "long", day: "numeric" })}, ${day(ts, { hour: "numeric", minute: "2-digit" })}`;
  const weekById = (id) => (weeks || []).find((w) => w.id === id);
  const selectedWeek = () => (els.week.value && els.week.value !== "live" ? weekById(Number(els.week.value)) || null : null);

  async function loadWeeks() {
    const start = week && week.started_at;
    weeksRetryAt = now() + 30;
    try {
      const res = await fetch("/api/weeks", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      weeks = await res.json();
      weeksFor = start;
      weeksVersion++;
      updateWeekOptions();
      updateFilterOptions();
      renderLeaders();
    } catch (e) {
      /* try again in a while */
    }
  }

  function updateWeekOptions() {
    const list = [...(weeks || [])].reverse();
    const key = JSON.stringify([liveLabel(), list.map((w) => [w.id, w.started_at, w.ended_at])]);
    if (key === weekKey) return;
    weekKey = key;
    const current = els.week.value || "live";
    els.week.innerHTML = `<option value="live">${esc(liveLabel())}</option>` +
      list.map((w) => `<option value="${w.id}">${esc(weekLabel(w))}</option>`).join("");
    els.week.value = list.some((w) => String(w.id) === current) ? current : "live";
  }

  // One board's rows, live or a past week, in the same shape.
  function boardRows(w) {
    if (!w) {
      return monsters.map((m) => ({ id: m.id, name: m.name, player: m.player, colors: m.colors, style: m.style,
        elo: m.elo, avg: m.avg_elo, wins: m.record.wins, losses: m.record.losses, streak: m.record.streak,
        best: m.record.best_streak, damage: m.record.damage_dealt, vs: m.record.vs, history: m.style_history || [],
        q: true, gone: false }));
    }
    const live = new Set(monsters.map((m) => m.id));
    return w.monsters.map((m) => ({ id: m.id, name: m.name, player: m.player, colors: m.colors, style: m.style,
      elo: m.elo, avg: m.avg_elo, wins: m.wins, losses: m.losses, best: m.best_streak, damage: m.damage_dealt,
      vs: m.vs || {}, form: m.form, forms: m.forms || [], q: m.wins + m.losses >= w.min_fights && m.avg_elo != null, gone: !live.has(m.id) }));
  }

  // The live board ranks by current Elo; a past week by average Elo among monsters with enough fights (q), then
  // the rest (too few fights) below, unranked. The ties break the way the server picks the champion.
  function ranked(w) {
    const rows = boardRows(w);
    const tie = (x, y) => winRate(y) - winRate(x) || y.wins - x.wins || x.name.localeCompare(y.name);
    if (!w) return rows.sort((x, y) => (y.elo ?? 1500) - (x.elo ?? 1500) || tie(x, y));
    return rows.sort((x, y) => y.q - x.q || (y.avg ?? -Infinity) - (x.avg ?? -Infinity) || tie(x, y));
  }

  // Who wears the crown on a board, and its tooltip: last week's champion on the live board, that week's champion
  // on a past one.
  function crownOf(w) {
    if (w) return { id: w.champion, title: "Highest avg Elo this week" };
    const cw = weekById(championWeek);
    return { id: champion, title: `Highest avg Elo last week${cw ? ` (${weekLabel(cw)})` : ""}` };
  }

  function updateFilterOptions() {
    const w = selectedWeek();
    const live = new Set(monsters.map((m) => m.id));
    // Monsters that have left the tank are listed only while a week they were in is shown.
    const list = [...monsters.map((m) => ({ id: m.id, name: m.name, player: m.player, gone: false })),
      ...(w ? w.monsters.filter((m) => !live.has(m.id)).map((m) => ({ id: m.id, name: m.name, player: m.player, gone: true })) : [])]
      .sort((x, y) => x.name.localeCompare(y.name));
    const key = list.map((m) => `${m.id}|${m.name}|${m.player}|${m.gone}`).join(";");
    if (key === filterKey) return;
    filterKey = key;
    const current = els.filter.value;
    els.filter.innerHTML = `<option value="">All fish</option>` +
      list.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.player)}${m.gone ? ", left" : ""})</option>`).join("");
    els.filter.value = list.some((m) => m.id === current) ? current : "";
    if (els.filter.value !== current) {
      boardKey = "";
      loadHistory();
    }
  }

  function renderLeaders() {
    const focus = els.filter.value, w = selectedWeek();
    const key = JSON.stringify([focus, w ? w.id : "live", weeksVersion, rulesVersion, champion, championWeek, week,
      w ? monsters.map((m) => m.id) : monsters.map((m) => [m.id, m.name, m.player, m.colors, m.record, m.elo, m.avg_elo, m.style, m.style_history])]);
    if (key === boardKey) return;
    boardKey = key;
    if (focus) {
      els.leaderView.innerHTML = focusCard(w, focus);
      return;
    }
    const list = ranked(w);
    if (!list.length) {
      els.leaderView.innerHTML = `<p class="muted">No fish yet.</p>`;
      return;
    }
    const crown = crownOf(w);
    let note;
    if (w) {
      note = `<b>Final standings</b>, ranked by average Elo over the week. ${esc(longTime(w.started_at))} to ${esc(longTime(w.ended_at))}.`;
    } else {
      const next = week && week.next_reset_at;
      const when = next && (next - Date.now() / 1000 < 6.5 * 86400 ? day(next, { weekday: "long" })
        : day(next, { weekday: "short", month: "short", day: "numeric" }));
      const champ = monsters.find((m) => m.id === champion);
      const cw = weekById(championWeek);
      note = `Live.${week ? ` Styles were dealt <b>${esc(longTime(week.started_at, true))}</b>${next ? `; next shuffle ${esc(when)} around ${esc(day(next, { hour: "numeric" }))}` : ""}.` : ""}` +
        (champ ? `<br><span class="gold">👑 ${esc(champ.name)} won last week${cw ? ` (${esc(weekLabel(cw))})` : ""}.</span>` : "");
    }
    const short = w ? list.filter((r) => !r.q) : [];
    els.leaderView.innerHTML = `<p class="week-note">${note}</p><table class="board">
      <thead><tr><th>#</th><th>Fish</th>${w
        ? `<th class="num" title="Average Elo after each fight that week">Avg Elo</th>`
        : `<th class="num" title="Fish are ranked by Elo">Elo</th>`}<th class="num">Overall</th><th class="num" title="Wins over losses">W–L</th>${w
        ? `<th class="num streak" title="Best win streak">Best</th>` : `<th class="num streak">Streak</th>`}</tr></thead>
      <tbody>${list.map((r, i) => `<tr data-id="${esc(r.id)}">
        <td class="num">${r.q ? i + 1 : "–"}</td>
        <td class="name"><div class="name-cell">${swatch(r)}<div><span class="n"><span>${esc(r.name)}</span>${r.id === crown.id ? crownSvg(crown.title) : ""}${r.gone ? tag("left") : ""}${r.q ? "" : tag("few fights")}</span><span class="p">${esc(r.player)} · <span class="st">${esc(styleName(r.style))}</span></span></div></div></td>
        <td class="num">${w ? whole(r.avg) : r.elo ?? "–"}</td>
        <td class="num">${r.wins + r.losses ? pct(winRate(r)) : "–"}</td>
        <td class="num"><span class="wl"><span class="win">${r.wins}</span><span class="loss">${r.losses}</span></span></td>
        <td class="num streak">${w ? (r.best > 0 ? `<span class="win">W${r.best}</span>` : "–") : streak(r.streak)}</td></tr>`).join("")}</tbody></table>
      ${short.length ? `<p class="week-note after">“Few fights”: fewer than ${w.min_fights} fights (half the week's median), so not ranked for the crown.</p>` : ""}`;
  }

  function focusCard(w, id) {
    const back = `<button class="back" data-back>← All fish</button>`;
    const list = ranked(w);
    const m = list.find((r) => r.id === id);
    if (!m) {
      const known = monsters.find((x) => x.id === id);
      return `${back}<p class="muted">${known ? `${esc(known.name)} wasn't in the tank that week.` : "That fish isn't in the tank any more."}</p>`;
    }
    const rank = list.indexOf(m) + 1;
    const cw = weekById(championWeek);
    const champTag = w ? (w.champion === id ? "👑 Highest avg Elo" : "")
      : (champion === id ? `👑 Highest avg Elo last week${cw ? ` (${esc(weekLabel(cw))})` : ""}` : "");
    const rankText = !w ? `rank ${rank} of ${list.length}`
      : m.q ? `final rank ${rank} of ${list.filter((r) => r.q).length}` : "too few fights to rank";
    const byId = new Map(list.map((r) => [r.id, r]));
    const vs = Object.entries(m.vs)
      .filter(([oid]) => byId.has(oid))
      .sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]));
    // Recent styles, oldest to newest, up to one per style there is.
    const history = (w ? (weeks || []).filter((x) => x.id <= w.id).map((x) => (x.monsters.find((r) => r.id === id) || {}).style) : m.history)
      .filter(Boolean).slice(-styleCount).map(styleName);
    const fact = (k, v, tip) => `<div class="fact"${tip ? ` title="${esc(tip)}" style="cursor: help"` : ""}><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const record = `<span class="win">${m.wins}</span>–<span class="loss">${m.losses}</span>${m.wins + m.losses ? ` (${pct(winRate(m))})` : ""}`;
    const damage = Math.round(m.damage || 0).toLocaleString();
    const facts = w
      ? [fact("Avg Elo", whole(m.avg)), fact("Final Elo", whole(m.elo)), fact("Record", record),
        fact("Best streak", best(m.best)), fact("Damage dealt", damage), fact("Avg form", fmtForm(m.form), formTip(m))]
      : [fact("Elo", m.elo ?? "–"), fact("Avg Elo so far", whole(m.avg)), fact("Record", record), fact("Streak", streak(m.streak)),
        fact("Best streak", best(m.best)), fact("Damage dealt", damage)];
    return `${back}<div class="card">
      ${champTag ? `<div class="champ">${champTag}</div>` : ""}
      <h2>${swatch(m)}${esc(m.name)}${m.gone ? tag("left the tank") : ""}</h2>
      <div class="sub">${esc(m.player)} · ${rankText}${w ? ` · ${esc(weekLabel(w))}` : ""}</div>
      <div class="section-title first">${w ? "Fighting style that week" : "Fighting style this week"}</div>
      <div class="cname">${esc(styleName(m.style))}</div>
      <div class="facts">${facts.join("")}</div>
      <div class="section-title">Head-to-head ${w ? "that week" : "this week"}</div>
      ${vs.length ? `<table class="board"><tbody>${vs.map(([oid, [wn, l]]) => {
        const o = byId.get(oid);
        return `<tr><td class="name"><div class="name-cell">${swatch(o)}<div><span class="n"><span>${esc(o.name)}</span></span><span class="p"><span class="st">${esc(styleName(o.style))}</span></span></div></div></td><td class="num"><span class="win">${wn}</span>–<span class="loss">${l}</span></td></tr>`;
      }).join("")}</tbody></table>` : `<p class="muted">No fights yet.</p>`}
      ${history.length > 1 ? `<div class="section-title">Recent styles</div><div class="styles">${history.map(esc).join(" → ")}</div>` : ""}
    </div>`;
  }

  async function loadHistory() {
    lastHistoryLoad = now();
    const focus = els.filter.value;
    try {
      const res = await fetch(`/api/history?limit=40${focus ? `&monster=${encodeURIComponent(focus)}` : ""}`, { cache: "no-store" });
      const list = await res.json();
      if (focus !== els.filter.value) return; // the filter changed while loading
      renderHistory(list, focus);
    } catch (e) {
      /* keep what's shown; the next refresh will try again */
    }
  }

  function renderHistory(list, focus) {
    if (!list.length) {
      els.historyView.innerHTML = `<p class="muted">No fights yet.</p>`;
      return;
    }
    const name = (side) => `${swatch(side)}<strong class="${side.id === focus ? "focus" : ""}">${esc(side.name)}</strong>`;
    els.historyView.innerHTML = list.map((e) => {
      const tag = focus ? (e.winner.id === focus ? `<span class="win">W</span> ` : `<span class="loss">L</span> `) : "";
      return `<div class="fight">
        <div class="who">${tag}${name(e.winner)} <span class="muted">beat</span> ${name(e.loser)}</div>
        <div class="meta">${e.reason === "ko" ? "KO" : "Time limit"} · ${fmtDuration(e.duration)} · ${ago(e.ended_at)}
          · damage ${Math.round(e.winner.damage)}–${Math.round(e.loser.damage)} · dodges ${e.winner.dodges}–${e.loser.dodges}</div>
      </div>`;
    }).join("");
  }

  function selectTab(btn) {
    for (const b of els.tabs) {
      const on = b === btn;
      b.setAttribute("aria-selected", String(on));
      $(b.dataset.view).hidden = !on;
    }
    // Recent fights are always this week's, so the week picker is only for the leaderboard.
    els.weekRow.hidden = btn.dataset.view !== "leaderView";
  }

  function noteInteraction() {
    lastInteraction = now();
  }

  function filterChanged() {
    boardKey = "";
    renderLeaders();
    loadHistory();
  }

  function weekChanged() {
    updateFilterOptions();
    boardKey = "";
    renderLeaders();
  }

  // ---- clicking the tank ---------------------------------------------------------

  function bubbleBurst(x, y, size, count) {
    if (particles.filter((p) => p.front).length > MAX_CLICK_BUBBLES) return;
    for (let i = 0; i < count; i++) {
      particles.push({ kind: "bubble", front: true, x: x + rand(-0.3, 0.3) * size, y: y + rand(-0.2, 0.2) * size,
        r: rand(0.015, 0.045) * size, vx: rand(-15, 15), vy: -rand(0.08, 0.16) * H, life: 0, max: rand(2, 3.5),
        wobble: rand(0, 6) });
    }
  }

  // The monster drawn on top at a point, if any. They're drawn back to front by y.
  function actorAt(x, y) {
    let hit = null;
    for (const a of actors.values()) {
      const size = sizeFor(a.m);
      if (Math.abs(x - a.x) < size * 0.5 && Math.abs(y - a.y) < size * 0.4 && (!hit || a.y > hit.y)) hit = a;
    }
    return hit;
  }

  function tankPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    Object.assign(pointer, tankPoint(e), { moved: now() });
  });
  canvas.addEventListener("pointerleave", () => { pointer.moved = -Infinity; });
  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = tankPoint(e);
    const a = actorAt(x, y);
    if (!a) {
      bubbleBurst(x, y, H * 0.12, 6);
      return;
    }
    const size = sizeFor(a.m);
    bubbleBurst(a.x + a.face * size * 0.35, a.y, size, 8);
    if (a.fightId == null && !a.dazed) {
      // A startled hop, then a dart away from the click.
      a.dodge = 1;
      const b = bounds(), away = Math.sign(a.x - x) || a.facing;
      a.tx = clamp(a.x + away * size * 2, b.x0, b.x1);
      a.ty = clamp(a.y + rand(-0.5, 0.5) * size, b.y0, b.y1);
      a.vx += away * W * 0.15;
      a.retarget = rand(3, 6);
      a.startled = 2; // seconds before it'll follow the mouse again
    }
    // Show that monster in the side panel; clicking it again shows everyone.
    els.filter.value = els.filter.value === a.id ? "" : a.id;
    noteInteraction();
    filterChanged();
  });

  for (const b of els.tabs) b.addEventListener("click", () => selectTab(b));
  els.filter.addEventListener("change", filterChanged);
  els.week.addEventListener("change", weekChanged);
  // Clicking a leaderboard row opens that monster's card; "All monsters" goes back.
  els.leaderView.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]"), back = e.target.closest("[data-back]");
    if (!row && !back) return;
    els.filter.value = row ? row.dataset.id : "";
    filterChanged();
  });
  for (const type of ["pointerdown", "pointermove", "wheel", "keydown"]) {
    document.querySelector(".panel").addEventListener(type, noteInteraction, { passive: true });
  }

  setInterval(() => {
    const t = now();
    const idle = t - lastInteraction > IDLE_RESUME_S;
    if (idle && (els.filter.value || els.week.value !== "live")) {
      // Don't leave the TV stuck on one person's filter or an old week.
      els.filter.value = "";
      els.week.value = "live";
      updateFilterOptions();
      boardKey = "";
      renderLeaders();
      loadHistory();
    }
    if (t - lastHistoryLoad > HISTORY_REFRESH_S) loadHistory();
  }, 1000);

  // The side panel can be hidden so the tank fills the width. Each browser remembers its own choice.
  const PANEL_KEY = "designMonsters.panelCollapsed";
  function setPanelCollapsed(collapsed, remember) {
    document.body.classList.toggle("panel-collapsed", collapsed);
    const label = collapsed ? "Show the side panel" : "Hide the side panel";
    els.panelToggle.setAttribute("aria-expanded", String(!collapsed));
    els.panelToggle.setAttribute("aria-label", label);
    els.panelToggle.title = label;
    if (remember) {
      try { localStorage.setItem(PANEL_KEY, collapsed ? "1" : "0"); } catch { /* private window: just don't remember */ }
    }
    resize();
  }
  els.panelToggle.addEventListener("click", () =>
    setPanelCollapsed(!document.body.classList.contains("panel-collapsed"), true));
  let startCollapsed = false;
  try { startCollapsed = localStorage.getItem(PANEL_KEY) === "1"; } catch { /* no storage: start open */ }
  document.body.classList.toggle("panel-collapsed", startCollapsed);
  setPanelCollapsed(startCollapsed, false);

  window.addEventListener("resize", () => { resize(); tickerResized(); });
  resize();
  checkSeason();
  setInterval(checkSeason, 60000);
  fetch("/api/rules").then((r) => r.json()).then((rules) => {
    styleNames = Object.fromEntries((rules.styles || []).map((st) => [st.id, st.name]));
    styleCount = (rules.styles || []).length || styleCount;
    rulesVersion++;
    renderLeaders();
  }).catch(() => {});
  loadHistory();
  poll();
  pollTicker();
  requestAnimationFrame(frame);
})();
