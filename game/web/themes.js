// Seasonal aquarium themes. A theme only decorates the tank: the water, the sand and kelp, the far background and
// the "glass" in front of the monsters. It never changes the monsters or fights. tank.js calls in at these points:
//   decorate(g, scene)  while it builds the cached scenery (static decorations cost nothing per frame)
//   layout(scene)       after a resize or theme change, to cache the glass layer and place things
//   far(t, dt)          behind the light rays and kelp (distant swimmers)
//   back(t, dt)         after the kelp, behind the monsters (lights, glows)
//   glass()             a cached canvas drawn over the monsters, under the damage numbers
//   front(t)            animated bits on the glass
// Glows use pre-drawn sprites: per-frame gradients and canvas filters made fights stutter on the office TV.
const Seasons = (() => {
  "use strict";
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Date windows, by the browser's local date, checked in order: the first match wins, so New Year's takes Dec 30-31
  // from December. Holidays that close the office start a week early, so people see them on days they're in.
  const md = (m, d) => m * 100 + d; // months are 1-12
  const within = (from, to) => (date) => { const v = md(date.getMonth() + 1, date.getDate()); return v >= from && v <= to; };
  const dayOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const DAY_MS = 86400000;
  function easterSunday(year) { // the Gregorian computus (Meeus/Jones/Butcher)
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  // Monday to Sunday of the week Good Friday falls in. (Rounded, so a daylight-saving change in that week doesn't
  // shift it by an hour.)
  function easterWeek(date) {
    const sunday = dayOf(easterSunday(date.getFullYear())), t = dayOf(date);
    const days = Math.round((sunday - t) / DAY_MS);
    return days >= 0 && days <= 6;
  }
  // Monday of the week before Thanksgiving through the Friday of Thanksgiving week (the fourth Thursday in
  // November), since many people are out for Thanksgiving week itself. Always within November.
  function thanksgivingWeek(date) {
    if (date.getMonth() !== 10) return false;
    const first = new Date(date.getFullYear(), 10, 1).getDay(); // 0 = Sunday
    const thursday = 1 + ((4 - first + 7) % 7) + 21;
    return date.getDate() >= thursday - 10 && date.getDate() <= thursday + 1;
  }
  const WINDOWS = [
    { key: "newyear", test: (d) => within(md(12, 30), md(12, 31))(d) || within(md(1, 1), md(1, 1))(d) },
    { key: "valentines", test: within(md(2, 7), md(2, 14)) },
    { key: "stpatricks", test: within(md(3, 10), md(3, 17)) },
    { key: "easter", test: easterWeek },
    { key: "july4", test: within(md(6, 27), md(7, 4)) },
    { key: "halloween", test: within(md(10, 24), md(10, 31)) },
    { key: "thanksgiving", test: thanksgivingWeek },
    { key: "december", test: within(md(12, 1), md(12, 31)) },
  ];

  // Set by scene(): the tank's drawing context and the current layout.
  let ctx = null, W = 0, H = 0, dpr = 1, cw = 0, ch = 0, sandY = () => 0, sandTop = 0, rocks = [], kelp = [], kelpPoint = null;
  let theme = null, key = null, glassCanvas = null, previewDay = null;

  function scene(s) {
    ({ ctx, W, H, dpr } = s);
    cw = s.canvasW; ch = s.canvasH;
    if (s.sandY) sandY = s.sandY;
    if (s.sandTop) sandTop = s.sandTop;
    if (s.rocks) rocks = s.rocks;
    if (s.kelp) kelp = s.kelp;
    if (s.kelpPoint) kelpPoint = s.kelpPoint;
  }

  // mode is the admin setting: "off", "auto" (by date) or a theme key to show all the time. A ?theme= override in
  // the page's address beats it, in that browser only.
  function pick(date, mode, override) {
    if (override) return THEMES[override] ? override : null; // "off" or an unknown name shows no theme
    if (mode === "off") return null;
    if (mode && mode !== "auto") return THEMES[mode] ? mode : null;
    for (const w of WINDOWS) if (w.test(date)) return w.key;
    return null;
  }
  function activate(k) {
    key = k;
    theme = k ? THEMES[k] : null;
    if (theme && theme.start) theme.start();
  }

  // ---- shared bits ----------------------------------------------------------------------------------

  const glowCache = new Map();
  function glow(color) {
    if (glowCache.has(color)) return glowCache.get(color);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,0.95)");
    rg.addColorStop(0.18, color);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
  }
  // Additive glow sprite; leaves the context's alpha and blend mode as it found them.
  function drawGlow(color, x, y, r, a) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }
  function layerCanvas() {
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    return { c, g };
  }

  // Far-background swimmers are drawn into a small offscreen canvas and hazed with water color, so they read as
  // distant and nobody mistakes them for monsters. They aren't actors, so they can't be clicked.
  const haze = { c: document.createElement("canvas") };
  haze.g = haze.c.getContext("2d");
  function hazed(wU, hU, scalePx, hazeColor, drawFn) {
    const wp = Math.max(1, Math.ceil(wU * scalePx * dpr)), hp = Math.max(1, Math.ceil(hU * scalePx * dpr));
    if (haze.c.width !== wp || haze.c.height !== hp) { haze.c.width = wp; haze.c.height = hp; }
    const g = haze.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, wp, hp);
    g.setTransform(scalePx * dpr, 0, 0, scalePx * dpr, 0, 0);
    g.lineJoin = "round";
    g.lineCap = "round";
    drawFn(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = hazeColor;
    g.fillRect(0, 0, wp, hp);
    g.globalCompositeOperation = "source-over";
    return haze.c;
  }

  const BULBS = ["rgba(255,70,70,0.85)", "rgba(255,206,84,0.85)", "rgba(80,230,120,0.85)", "rgba(90,160,255,0.85)", "rgba(255,240,220,0.85)"];
  const BULB_CORE = ["#ff5a5a", "#ffd25a", "#5ef08a", "#6eaaff", "#fff4e0"];

  // ---- December -------------------------------------------------------------------------------------

  // The day of December the decorations show; outside December (a ?theme= preview) the full set.
  function decDay() {
    if (previewDay) return previewDay;
    const d = new Date();
    return d.getMonth() === 11 ? d.getDate() : 24;
  }

  function tailFin(g, x, t, color, wag) {
    g.save();
    g.translate(x, 0);
    g.rotate(Math.sin(t * 6) * wag);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(4, 0);
    g.quadraticCurveTo(-12, -6, -22, -18);
    g.quadraticCurveTo(-15, 0, -22, 18);
    g.quadraticCurveTo(-12, 6, 4, 0);
    g.fill();
    g.restore();
  }
  function fishEye(g, x, y, r) {
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = "#1a1a1a";
    g.beginPath(); g.arc(x + r * 0.25, y, r * 0.55, 0, TAU); g.fill();
  }
  // A reindeer-fish, 100 units nose to tail, facing right.
  function reindeerFish(g, t, lead) {
    tailFin(g, -38, t, "#6b4426", 0.3);
    g.save();
    g.beginPath(); g.ellipse(0, 0, 42, 21, 0, 0, TAU);
    const bg = g.createLinearGradient(0, -21, 0, 21);
    bg.addColorStop(0, "#9a6638"); bg.addColorStop(1, "#5c381c");
    g.fillStyle = bg; g.fill();
    g.clip();
    g.fillStyle = "#e2c79a";
    g.beginPath(); g.ellipse(6, 16, 34, 11, 0, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = "#d8b27a";
    g.lineWidth = 3.4;
    for (const [ax, lean] of [[16, -0.15], [26, 0.1]]) {
      g.beginPath();
      g.moveTo(ax, -18);
      g.quadraticCurveTo(ax - 6 + lean * 20, -36, ax - 16 + lean * 20, -46);
      g.moveTo(ax - 3 + lean * 6, -30); g.lineTo(ax + 6 + lean * 10, -40);
      g.moveTo(ax - 9 + lean * 14, -39); g.lineTo(ax - 6 + lean * 16, -50);
      g.moveTo(ax - 2 + lean * 4, -25); g.lineTo(ax - 14 + lean * 6, -31);
      g.stroke();
    }
    g.fillStyle = "#7a4e2a";
    g.beginPath();
    g.ellipse(4, 6, 11, 5, 0.6 + Math.sin(t * 7) * 0.35, 0, TAU);
    g.fill();
    fishEye(g, 25, -5, 5.5);
    g.fillStyle = lead ? "#ff2a2a" : "#3a2414";
    g.beginPath(); g.arc(42, 2, lead ? 5.5 : 3.6, 0, TAU); g.fill();
  }
  // Santa-fish riding in a sleigh, about 120 units long, facing right.
  function santaSleigh(g, t) {
    g.fillStyle = "#7a5230";
    g.beginPath(); g.ellipse(-44, -14, 20, 22, -0.3, 0, TAU); g.fill();
    g.fillStyle = "#2f9e5b"; g.fillRect(-62, -44, 15, 13);
    g.fillStyle = "#e63946"; g.fillRect(-56, -44, 3, 13); g.fillRect(-62, -39, 15, 3);
    g.fillStyle = "#4a7bd0"; g.fillRect(-48, -40, 12, 11);
    g.fillStyle = "#ffd166"; g.fillRect(-43, -40, 2.5, 11);
    g.save();
    g.translate(10, -26 + Math.sin(t * 3) * 1.5);
    tailFin(g, -36, t, "#a51c1c", 0.15);
    g.beginPath(); g.ellipse(0, 0, 40, 21, 0, 0, TAU);
    const sg = g.createLinearGradient(0, -21, 0, 21);
    sg.addColorStop(0, "#e23b3b"); sg.addColorStop(1, "#981414");
    g.fillStyle = sg; g.fill();
    g.save(); g.clip();
    g.fillStyle = "#151515"; g.fillRect(-12, -22, 9, 44);
    g.restore();
    g.strokeStyle = "#ffd166"; g.lineWidth = 2.2; g.strokeRect(-11, -4, 7, 8);
    fishEye(g, 26, -6, 5);
    g.fillStyle = "#f4f7fb";
    for (const [bx, by, br] of [[32, 8, 8], [24, 13, 8], [36, 15, 6], [28, 20, 6], [17, 14, 6]]) {
      g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
    }
    const flop = Math.sin(t * 3) * 3;
    g.fillStyle = "#d62828";
    g.beginPath();
    g.moveTo(10, -17); g.lineTo(36, -17);
    g.quadraticCurveTo(26, -38, 4 + flop, -40);
    g.closePath(); g.fill();
    g.fillStyle = "#f4f7fb";
    g.beginPath(); g.arc(3 + flop, -40, 5.5, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(23, -17, 15, 5, 0, 0, TAU); g.fill();
    g.restore();
    g.fillStyle = "#b81d24";
    g.beginPath();
    g.moveTo(-62, -6); g.lineTo(44, -6);
    g.quadraticCurveTo(58, -6, 56, 10);
    g.quadraticCurveTo(50, 22, 30, 22);
    g.lineTo(-56, 22);
    g.quadraticCurveTo(-66, 10, -62, -6);
    g.fill();
    g.strokeStyle = "#ffd166"; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-58, 2); g.lineTo(48, 2); g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-58, 30); g.lineTo(46, 30);
    g.quadraticCurveTo(64, 30, 62, 18);
    g.quadraticCurveTo(60, 10, 54, 14);
    g.moveTo(-40, 22); g.lineTo(-40, 30); g.moveTo(28, 22); g.lineTo(28, 30);
    g.stroke();
  }

  // Every 4-6 minutes, or every 1.5-2.5 minutes on Christmas Eve and Christmas Day.
  const PARADE_S = 30;
  const PARADE_U = { w: 640, h: 170 };
  const parade = { start: -Infinity, next: 0, dir: 1, y: 0.25, sparks: [] };
  function paradeGap() {
    const d = decDay();
    return d === 24 || d === 25 ? rand(90, 150) : rand(240, 360);
  }
  function drawParade(t, dt) {
    if (!parade.next) parade.next = t + rand(20, 60);
    if (t >= parade.next && t - parade.start > PARADE_S) {
      parade.start = t;
      parade.dir = parade.dir === 1 ? -1 : 1;
      parade.y = rand(0.2, 0.36);
      parade.next = t + PARADE_S + paradeGap();
    }
    const L = H * 0.065, scalePx = L / 100;
    const p = (t - parade.start) / PARADE_S;
    const wPx = PARADE_U.w * scalePx, hPx = PARADE_U.h * scalePx;
    if (p >= 0 && p <= 1) {
      const left = parade.dir === 1 ? -wPx + p * (W + wPx) : W - p * (W + wPx);
      const top = H * parade.y - hPx / 2 + Math.sin(t * 0.6) * H * 0.01;
      const deer = [565, 435, 305].map((x, i) => ({ x, y: 95 + Math.sin(t * 2.2 + i * 1.3) * 7 }));
      const img = hazed(PARADE_U.w, PARADE_U.h, scalePx, "rgba(16,98,130,0.42)", (g) => {
        g.strokeStyle = "#c9a44a"; g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(178, 88);
        for (const d of [...deer].reverse()) g.quadraticCurveTo(d.x - 70, d.y + 14, d.x - 20, d.y + 2);
        g.stroke();
        deer.forEach((d, i) => { g.save(); g.translate(d.x, d.y); reindeerFish(g, t + i, i === 0); g.restore(); });
        g.save(); g.translate(110, 98 + Math.sin(t * 2) * 4); santaSleigh(g, t); g.restore();
      });
      ctx.save();
      if (parade.dir === 1) ctx.drawImage(img, left, top, wPx, hPx);
      else { ctx.translate(left + wPx, top); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, wPx, hPx); }
      ctx.restore();
      const nx = parade.dir === 1 ? left + (565 + 42) * scalePx : left + wPx - (565 + 42) * scalePx;
      drawGlow("rgba(255,60,60,0.8)", nx, top + (deer[0].y + 2) * scalePx, L * 0.22, 0.6 + 0.3 * Math.sin(t * 5));
      if (Math.random() < dt * 14) {
        const sx = parade.dir === 1 ? left + 50 * scalePx : left + wPx - 50 * scalePx;
        parade.sparks.push({ x: sx, y: top + 125 * scalePx + rand(-4, 4), vx: -parade.dir * rand(4, 14), vy: rand(4, 12), life: 0, max: rand(2, 3.5) });
      }
    }
    for (const s of parade.sparks) {
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      drawGlow("rgba(255,214,110,0.7)", s.x, s.y, H * 0.006, 0.7 * (1 - s.life / s.max) * (0.6 + 0.4 * Math.sin(s.life * 20)));
    }
    for (let i = parade.sparks.length - 1; i >= 0; i--) if (parade.sparks[i].life >= parade.sparks[i].max) parade.sparks.splice(i, 1);
  }

  // Christmas lights wound round each kelp strand, swaying with it. Bulbs behind the strand are dimmed.
  function drawKelpLights(t) {
    if (!kelpPoint) return;
    const wraps = 3.2, steps = 40;
    kelp.forEach((k, ki) => {
      const pt = (u) => {
        const p = kelpPoint(k, u, t), a = u * wraps * TAU + ki;
        return { x: p.x + Math.sin(a) * k.w * 1.7 * (1.1 - u * 0.5), y: p.y + Math.cos(a) * k.w * 0.5, front: Math.cos(a) };
      };
      ctx.strokeStyle = "rgba(18,38,24,0.85)";
      ctx.lineWidth = Math.max(1, k.w * 0.18);
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const q = pt(0.06 + (s / steps) * 0.9);
        s ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
      const n = 13;
      for (let j = 0; j < n; j++) {
        const q = pt(0.08 + (j / (n - 1)) * 0.86), ci = (j + ki) % BULBS.length;
        const lit = 0.55 + 0.45 * Math.sin(t * 2.4 - j * 0.8 + ki * 1.3);
        const depth = q.front > -0.2 ? 1 : 0.35;
        drawGlow(BULBS[ci], q.x, q.y, k.w * 2.1 * (0.7 + 0.4 * lit), 0.45 * lit * depth);
        ctx.globalAlpha = 0.5 + 0.5 * depth;
        ctx.fillStyle = BULB_CORE[ci];
        ctx.beginPath(); ctx.arc(q.x, q.y, k.w * 0.42 * (0.6 + 0.4 * depth), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
  }

  // A coral Christmas tree in the gap between the rock at 30% and the kelp cluster from 48% of the width (the kelp
  // and rocks come from fixed seeds, so they're always there). Baked into the scenery; ornaments and star twinkle.
  const tree = { x: 0, base: 0, h: 0, top: 0, ornaments: [] };
  function decorateTree(g) {
    tree.x = W * 0.395;
    tree.base = sandY(tree.x) + H * 0.012;
    tree.h = H * 0.2;
    tree.ornaments = [];
    const rnd = seeded(23);
    const { x, base, h } = tree;
    g.fillStyle = "#c97a6a";
    g.fillRect(x - h * 0.04, base - h * 0.16, h * 0.08, h * 0.17);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const yb = base - h * (0.12 + i * 0.2), yt = yb - h * 0.34, half = h * (0.34 - i * 0.065);
      const tg = g.createLinearGradient(0, yt, 0, yb);
      tg.addColorStop(0, "#3fae7e"); tg.addColorStop(1, "#1a5c43");
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(x, yt);
      g.quadraticCurveTo(x + half * 0.45, yt + (yb - yt) * 0.5, x + half, yb);
      const lumps = 5;
      for (let l = lumps; l > 0; l--) {
        const x0 = x - half + (2 * half * (l - 1)) / lumps, xm = x - half + (2 * half * (l - 0.5)) / lumps;
        g.quadraticCurveTo(xm, yb + h * 0.05, x0, yb);
      }
      g.quadraticCurveTo(x - half * 0.45, yt + (yb - yt) * 0.5, x, yt);
      g.fill();
      g.fillStyle = "rgba(170,255,210,0.35)";
      for (let d = 0; d < 14; d++) {
        const v = rnd(), yy = yt + (yb - yt) * (0.25 + 0.7 * v), spread = half * (0.25 + 0.7 * v);
        g.beginPath(); g.arc(x + (rnd() * 2 - 1) * spread, yy, h * 0.008, 0, TAU); g.fill();
      }
    }
    // Ornaments spread evenly along the visible lower band of each tier (the tier above hides the upper part),
    // staggered from tier to tier so they don't line up in columns. The top tier is narrow, so it gets just one.
    for (let i = 0; i < tiers; i++) {
      const yb = base - h * (0.12 + i * 0.2), yt = yb - h * 0.34, half = h * (0.34 - i * 0.065);
      const n = i === tiers - 1 ? 1 : 3 - (i >= 2 ? 1 : 0);
      for (let o = 0; o < n; o++) {
        const v = (i === tiers - 1 ? 0.62 : 0.74) + (rnd() - 0.5) * 0.1;
        const slot = n === 1 ? 0 : ((o + (i % 2 ? 0.3 : 0)) / (n - 1 + (i % 2 ? 0.6 : 0))) * 2 - 1;
        tree.ornaments.push({ x: x + slot * half * v * 0.72, y: yt + (yb - yt) * v, c: (i * 2 + o) % BULBS.length, ph: rnd() * TAU });
      }
    }
    tree.top = base - h * (0.12 + (tiers - 1) * 0.2) - h * 0.34;
  }
  function drawTreeLights(t) {
    for (const o of tree.ornaments) {
      ctx.fillStyle = BULB_CORE[o.c];
      ctx.beginPath(); ctx.arc(o.x, o.y, tree.h * 0.028, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.arc(o.x - tree.h * 0.009, o.y - tree.h * 0.009, tree.h * 0.008, 0, TAU); ctx.fill();
      drawGlow(BULBS[o.c], o.x, o.y, tree.h * 0.07, 0.35 + 0.3 * Math.sin(t * 1.8 + o.ph));
    }
    const r = tree.h * 0.07, sx = tree.x, sy = tree.top - r * 0.45; // the star's lower points rest on the tip
    drawGlow("rgba(255,214,110,0.8)", sx, sy, r * 3, 0.55 + 0.25 * Math.sin(t * 1.3));
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  // Presents under the tree: one more each day to Christmas Eve, then the pile stays. The layout is seeded, so it
  // grows the same way on every screen, in rows of 7, 6, 5, 4 and 2, each row filled before the next starts. It
  // stays on a stretch of sand with no kelp or rocks (34%-46% of the width) and is drawn in front of the kelp and
  // the tree, so no strand looks like it's growing out of a box. Every 5-10 minutes the newest one sinks in again.
  const PILE = { x0: 0.338, x1: 0.455, rows: [7, 6, 5, 4, 2] };
  const GIFT_COLORS = [["#c62828", "#ffd166"], ["#2e7d32", "#f4f7fb"], ["#1e5fb4", "#ffd166"], ["#f4f7fb", "#d62828"],
    ["#7b3fa0", "#f4f7fb"], ["#e8a33d", "#2e7d32"], ["#d94f8a", "#ffffff"]];
  const gifts = { list: [], falling: null, nextDrop: 0 };
  function buildPile() {
    const rnd = seeded(41), bins = 70, hm = new Array(bins).fill(0);
    const x0 = PILE.x0 * W, x1 = PILE.x1 * W, bw = (x1 - x0) / bins, sw = (x1 - x0) / PILE.rows[0];
    gifts.list = [];
    gifts.falling = null;
    PILE.rows.forEach((n, r) => {
      const order = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const placed = order.map((slot) => {
        const w = sw * (0.72 + rnd() * 0.22), h = w * (0.55 + rnd() * 0.4);
        const cx = x0 + sw * (slot + 0.5 + (PILE.rows[0] - n) / 2) + (rnd() - 0.5) * sw * 0.12;
        const b0 = Math.max(0, Math.floor((cx - w / 2 - x0) / bw)), b1 = Math.min(bins - 1, Math.floor((cx + w / 2 - x0) / bw));
        let base = 0;
        for (let b = b0; b <= b1; b++) base = Math.max(base, hm[b]);
        return { cx, w, h, b0, b1, base };
      });
      // Commit a row's heights only after the whole row is placed, so boxes in one row don't climb onto each other.
      for (const p of placed) {
        for (let b = p.b0; b <= p.b1; b++) hm[b] = Math.max(hm[b], p.base + p.h);
        const sink = r ? 0 : H * 0.012;
        gifts.list.push({ x: p.cx, y: sandY(p.cx) + sink - p.base - p.h / 2 + (r ? p.h * 0.08 : 0), w: p.w, h: p.h,
          c: GIFT_COLORS[Math.floor(rnd() * GIFT_COLORS.length)], tilt: (rnd() - 0.5) * (r ? 0.16 : 0.05), bow: rnd() < 0.75 });
      }
    });
  }
  function drawGift(p, x, y, tilt) {
    const { w, h } = p, [box, rib] = p.c;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = box;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(w * 0.18, -h / 2, w * 0.32, h);
    ctx.fillStyle = rib;
    ctx.fillRect(-w * 0.07, -h / 2, w * 0.14, h);
    ctx.fillRect(-w / 2, -h * 0.08, w, h * 0.16);
    ctx.strokeStyle = "rgba(10,20,30,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    if (p.bow) {
      ctx.fillStyle = rib;
      ctx.beginPath();
      ctx.ellipse(-w * 0.14, -h / 2 - w * 0.07, w * 0.15, w * 0.08, 0.5, 0, TAU);
      ctx.ellipse(w * 0.14, -h / 2 - w * 0.07, w * 0.15, w * 0.08, -0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawPresents(t, dt) {
    const day = decDay(), count = Math.min(day, gifts.list.length);
    if (!gifts.nextDrop) gifts.nextDrop = t + rand(60, 180);
    if (!gifts.falling && t > gifts.nextDrop && count > 0 && day <= 24) {
      gifts.falling = { i: count - 1, y: -H * 0.06, ph: Math.random() * TAU };
      gifts.nextDrop = t + rand(300, 600);
    }
    const f = gifts.falling;
    for (let i = 0; i < count; i++) {
      if (f && f.i === i) continue;
      const p = gifts.list[i];
      drawGift(p, p.x, p.y, p.tilt);
    }
    if (f) {
      const p = gifts.list[f.i];
      if (!p) { gifts.falling = null; return; }
      f.y += H * 0.045 * dt;
      const near = clamp((p.y - f.y) / (H * 0.15), 0, 1); // the sway settles as it lands
      if (f.y >= p.y) { gifts.falling = null; drawGift(p, p.x, p.y, p.tilt); }
      else drawGift(p, p.x + Math.sin(t * 1.3 + f.ph) * H * 0.03 * near, f.y, p.tilt + Math.sin(t * 1.1 + f.ph) * 0.35 * near);
    }
  }

  // Frost on the glass, mostly in the corners and along the edges, outside where the monsters swim.
  function buildFrost() {
    const { c, g } = layerCanvas();
    const edge = Math.min(W, H) * 0.045;
    const sides = [[0, 0, edge, 0], [W, 0, W - edge, 0], [0, 0, 0, edge], [0, H, 0, H - edge]];
    for (const [x0, y0, x1, y1] of sides) {
      const lg = g.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, "rgba(230,242,252,0.2)"); lg.addColorStop(1, "rgba(230,242,252,0)");
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
    }
    const cr = H * 0.22;
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
      rg.addColorStop(0, "rgba(236,246,255,0.4)"); rg.addColorStop(0.5, "rgba(236,246,255,0.12)"); rg.addColorStop(1, "rgba(236,246,255,0)");
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    const rnd = seeded(99);
    g.lineCap = "round";
    function fern(x, y, ang, len, depth) {
      if (depth <= 0 || len < 2) return;
      const segs = 4;
      let px = x, py = y, a = ang;
      for (let s = 0; s < segs; s++) {
        a += (rnd() - 0.5) * 0.3;
        const nx = px + Math.cos(a) * len / segs, ny = py + Math.sin(a) * len / segs;
        g.strokeStyle = `rgba(245,251,255,${0.18 + depth * 0.08})`;
        g.lineWidth = 0.6 + depth * 0.35;
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
        if (depth > 1) {
          fern(nx, ny, a - 1.05, len * 0.38, depth - 1);
          fern(nx, ny, a + 1.05, len * 0.38, depth - 1);
        }
        px = nx; py = ny;
      }
    }
    const startsOn = (side, v) => side === 0 ? [v * W, 0, Math.PI / 2] : side === 1 ? [v * W, H, -Math.PI / 2]
      : side === 2 ? [0, v * H, 0] : [W, v * H, Math.PI];
    for (let i = 0; i < 28; i++) {
      const side = Math.floor(rnd() * 4);
      let v = rnd(); // pushed towards the corners
      v = v < 0.5 ? 0.5 * Math.pow(v * 2, 2.2) : 1 - 0.5 * Math.pow((1 - v) * 2, 2.2);
      const [x, y, inward] = startsOn(side, v);
      const corner = 1 - Math.min(v, 1 - v) * 2;
      const len = H * (0.035 + 0.08 * corner * rnd() + 0.015 * rnd());
      fern(x, y, inward + (v < 0.5 ? 1 : -1) * (side < 2 ? -1 : 1) * rnd() * 0.6 * corner, len, 3);
    }
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 400; i++) {
      const side = Math.floor(rnd() * 4), d = Math.pow(rnd(), 2.5) * edge * 1.6, v = rnd();
      const [x, y] = side === 0 ? [v * W, d] : side === 1 ? [v * W, H - d] : side === 2 ? [d, v * H] : [W - d, v * H];
      g.fillRect(x, y, 1.2, 1.2);
    }
    return c;
  }

  // ---- Halloween -------------------------------------------------------------------------------------

  // A jack-o'-lantern clear of the rocks at 55-57% and the kelp at 58%, and left of the bubble vent at 77%.
  const pumpkin = { x: 0, y: 0, r: 0 };
  function pumpkinFace(g, x, y, r) {
    g.beginPath();
    g.moveTo(x - r * 0.55, y - r * 0.12); g.lineTo(x - r * 0.3, y - r * 0.5); g.lineTo(x - r * 0.1, y - r * 0.12); g.closePath();
    g.moveTo(x + r * 0.55, y - r * 0.12); g.lineTo(x + r * 0.3, y - r * 0.5); g.lineTo(x + r * 0.1, y - r * 0.12); g.closePath();
    g.moveTo(x - r * 0.62, y + r * 0.12);
    const teeth = 6;
    for (let i = 0; i <= teeth; i++) g.lineTo(x - r * 0.62 + (1.24 * r * i) / teeth, y + r * (i % 2 ? 0.3 : 0.18));
    g.quadraticCurveTo(x, y + r * 0.85, x - r * 0.62, y + r * 0.12);
    g.closePath();
  }
  function decoratePumpkin(g) {
    pumpkin.r = H * 0.045;
    pumpkin.x = W * 0.67;
    pumpkin.y = sandY(pumpkin.x) + pumpkin.r * 0.35;
    const { x, y, r } = pumpkin;
    for (const [dx, w, col] of [[-0.55, 0.6, "#c4560f"], [0.55, 0.6, "#c4560f"], [0, 0.7, "#e8771e"]]) {
      const pg = g.createLinearGradient(0, y - r, 0, y + r);
      pg.addColorStop(0, col); pg.addColorStop(1, "#7a3006");
      g.fillStyle = pg;
      g.beginPath(); g.ellipse(x + dx * r, y, r * w, r * 0.8, 0, 0, TAU); g.fill();
    }
    g.fillStyle = "#4a5a1c";
    g.fillRect(x - r * 0.08, y - r * 1.02, r * 0.16, r * 0.3);
    g.fillStyle = "#2a1405";
    pumpkinFace(g, x, y, r);
    g.fill();
  }
  function drawPumpkinGlow(t) {
    const flick = 0.75 + 0.15 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23.7);
    drawGlow("rgba(255,150,40,0.55)", pumpkin.x, pumpkin.y, pumpkin.r * 4, 0.55 * flick);
    ctx.fillStyle = `rgba(255,${190 + 40 * flick},70,${clamp(flick, 0, 1)})`;
    pumpkinFace(ctx, pumpkin.x, pumpkin.y, pumpkin.r);
    ctx.fill();
  }

  const ghosts = [];
  let nextGhost = 0;
  function drawGhosts(t, dt) {
    if (t > nextGhost) {
      nextGhost = t + rand(6, 12);
      ghosts.push({ x: rand(0.1, 0.9) * W, y: H * 0.85, vx: rand(-0.01, 0.01) * W, vy: -H * rand(0.018, 0.03), s: H * rand(0.035, 0.055), ph: rand(0, TAU) });
    }
    for (const gh of ghosts) {
      gh.x += gh.vx * dt + Math.sin(t * 0.7 + gh.ph) * H * 0.01 * dt;
      gh.y += gh.vy * dt * (0.6 + 0.6 * Math.max(0, Math.sin(t * 1.6 + gh.ph)));
      const s = gh.s, pulse = 1 + 0.08 * Math.sin(t * 1.6 + gh.ph);
      const img = hazed(120, 150, s / 100, "rgba(20,70,80,0.35)", (g) => {
        g.translate(60, 55);
        g.scale(pulse, 1 / pulse);
        g.fillStyle = "rgba(235,250,245,0.8)";
        g.beginPath();
        g.moveTo(-40, 10);
        g.bezierCurveTo(-42, -55, 42, -55, 40, 10);
        for (let i = 0; i <= 6; i++) g.lineTo(40 - (80 * i) / 6, 10 + (i % 2 ? 9 : 0));
        g.fill();
        g.strokeStyle = "rgba(235,250,245,0.6)"; g.lineWidth = 3.5;
        for (let i = 0; i < 5; i++) {
          const tx = -28 + i * 14;
          g.beginPath(); g.moveTo(tx, 14);
          g.quadraticCurveTo(tx + Math.sin(t * 2 + i) * 9, 45, tx + Math.sin(t * 2 + i + 1) * 6, 80);
          g.stroke();
        }
        g.fillStyle = "rgba(10,20,25,0.85)";
        g.beginPath(); g.ellipse(-13, -12, 6, 9, 0, 0, TAU); g.ellipse(13, -12, 6, 9, 0, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(0, 4, 5, 6, 0, 0, TAU); g.fill();
      });
      ctx.globalAlpha = clamp((gh.y - H * 0.05) / (H * 0.1), 0, 1) * 0.85;
      ctx.drawImage(img, gh.x - s * 0.6, gh.y - s * 0.55, s * 1.2, s * 1.5);
      ctx.globalAlpha = 1;
    }
    for (let i = ghosts.length - 1; i >= 0; i--) if (ghosts[i].y < -H * 0.1) ghosts.splice(i, 1);
  }

  function buildCobwebs() {
    const { c, g } = layerCanvas();
    const R = H * 0.26;
    for (const [cx, sx] of [[0, 1], [W, -1]]) {
      const spokes = 7, ang = (i) => (i / (spokes - 1)) * (Math.PI / 2);
      const end = (i, f) => [cx + sx * Math.cos(ang(i)) * R * f, Math.sin(ang(i)) * R * f];
      g.strokeStyle = "rgba(225,235,240,0.5)";
      g.lineWidth = 1.1;
      for (let i = 0; i < spokes; i++) {
        const [x, y] = end(i, 1 - (i % 2) * 0.12);
        g.beginPath(); g.moveTo(cx, 0); g.lineTo(x, y); g.stroke();
      }
      g.lineWidth = 0.9;
      for (let ring = 1; ring <= 7; ring++) {
        const f = ring / 7.5;
        g.beginPath();
        for (let i = 0; i < spokes; i++) {
          const [x, y] = end(i, f);
          if (!i) { g.moveTo(x, y); continue; }
          const [px, py] = end(i - 1, f), mx = (px + x) / 2, my = (py + y) / 2;
          const toC = Math.hypot(mx - cx, my);
          g.quadraticCurveTo(cx + ((mx - cx) * (toC - R * 0.04 * f)) / toC, (my * (toC - R * 0.04 * f)) / toC, x, y);
        }
        g.stroke();
      }
    }
    return c;
  }
  function drawSpider(t) {
    const x = W - H * 0.12, y = H * (0.16 + 0.05 * Math.sin(t * 0.5)), s = H * 0.014;
    ctx.strokeStyle = "rgba(225,235,240,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, H * 0.07); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = "#14181b"; ctx.lineWidth = s * 0.25;
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.45, wig = Math.sin(t * 6 + i) * 0.1;
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.2);
      ctx.quadraticCurveTo(x + side * s * 1.4, y - s * 0.6 + a * s * 1.5, x + side * s * 2.1, y + s * 0.6 + (a + wig) * s * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#14181b";
    ctx.beginPath(); ctx.arc(x, y + s * 0.3, s, 0, TAU); ctx.arc(x, y - s * 0.6, s * 0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath(); ctx.arc(x - s * 0.22, y + s * 1.0, s * 0.13, 0, TAU); ctx.arc(x + s * 0.22, y + s * 1.0, s * 0.13, 0, TAU); ctx.fill();
  }

  // ---- shared by the holiday themes --------------------------------------------------------------------

  // Sand decorations keep clear of every kelp base and rock, so nothing looks like it's growing out of them.
  function clearSpot(x, margin) {
    for (const k of kelp) if (Math.abs(x - k.x) < margin + k.w * 4) return false;
    for (const r of rocks) if (Math.abs(x - r.x) < margin + r.r * 1.4) return false;
    return x > margin && x < W - margin;
  }
  function clearSpots(n, seed, margin, spacing) {
    const rnd = seeded(seed), out = [];
    for (let tries = 0; out.length < n && tries < 600; tries++) {
      const x = W * (0.03 + rnd() * 0.94);
      if (clearSpot(x, margin) && out.every((o) => Math.abs(o - x) > spacing)) out.push(x);
    }
    return out;
  }
  function heartPath(g, x, y, s) { // s is about half the width; the point is at the bottom
    g.beginPath();
    g.moveTo(x, y + s * 0.9);
    g.bezierCurveTo(x - s * 1.3, y + s * 0.1, x - s * 0.9, y - s * 0.95, x, y - s * 0.35);
    g.bezierCurveTo(x + s * 0.9, y - s * 0.95, x + s * 1.3, y + s * 0.1, x, y + s * 0.9);
    g.closePath();
  }
  // Clip to everything above the sand line (plus a little), so things look half-buried.
  function clipAboveSand(g, sinkPx) {
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(W, 0);
    for (let x = W; x >= 0; x -= W / 96) g.lineTo(x, sandY(x) + sinkPx);
    g.closePath();
    g.clip();
  }

  // A far-background swimmer that crosses every 4-6 minutes (the first 20-60 s after the theme starts), alternating
  // direction, hazed like the sleigh so nobody mistakes it for a monster.
  function passer(dur) { return { start: -Infinity, next: 0, dir: -1, dur, y: 0.28 }; }
  function resetPasser(st) { st.start = -Infinity; st.next = 0; }
  function passProgress(st, t) {
    if (!st.next) st.next = t + rand(20, 60);
    if (t >= st.next && t - st.start > st.dur) {
      st.start = t; st.dir = -st.dir; st.next = t + st.dur + rand(240, 360);
      st.y = rand(0.2, 0.36);
    }
    const p = (t - st.start) / st.dur;
    return p >= 0 && p <= 1 ? p : null;
  }
  // Draws drawFn (units, facing right) hazed and flipped for direction; returns a units -> screen mapper.
  function drawPasser(st, p, wU, hU, sizePx, y, drawFn) {
    const scalePx = sizePx / 100, wPx = wU * scalePx, hPx = hU * scalePx;
    const left = st.dir === 1 ? -wPx + p * (W + wPx) : W - p * (W + wPx);
    const top = y - hPx / 2;
    const img = hazed(wU, hU, scalePx, "rgba(16,98,130,0.42)", drawFn);
    ctx.save();
    if (st.dir === 1) ctx.drawImage(img, left, top, wPx, hPx);
    else { ctx.translate(left + wPx, top); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, wPx, hPx); }
    ctx.restore();
    return (ux, uy) => ({ x: st.dir === 1 ? left + ux * scalePx : left + wPx - ux * scalePx, y: top + uy * scalePx });
  }
  function simpleFish(g, t, body, belly, tailColor) {
    tailFin(g, -36, t, tailColor, 0.25);
    g.save();
    g.beginPath(); g.ellipse(0, 0, 40, 21, 0, 0, TAU);
    const bg = g.createLinearGradient(0, -21, 0, 21);
    bg.addColorStop(0, body[0]); bg.addColorStop(1, body[1]);
    g.fillStyle = bg; g.fill();
    g.clip();
    g.fillStyle = belly;
    g.beginPath(); g.ellipse(6, 16, 32, 10, 0, 0, TAU); g.fill();
    g.restore();
    g.fillStyle = tailColor;
    g.beginPath(); g.ellipse(2, 6, 10, 4.5, 0.6 + Math.sin(t * 7) * 0.35, 0, TAU); g.fill();
  }

  // Fireworks above the water surface, seen through it: soft glows only.
  const fireworks = { bursts: [], next: 0 };
  function drawFireworks(t, dt, palette) {
    if (t > fireworks.next) {
      fireworks.next = t + rand(1.2, 3.5);
      const n = 26, c = palette[Math.floor(Math.random() * palette.length)];
      const x = rand(0.1, 0.9) * W, y = rand(0.03, 0.12) * H, sp = H * rand(0.06, 0.09);
      const parts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(-0.1, 0.1), v = sp * rand(0.8, 1.1);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 });
      }
      fireworks.bursts.push({ x, y, c, parts, life: 0, max: 2.4 });
    }
    for (const b of fireworks.bursts) {
      b.life += dt;
      const u = b.life / b.max;
      if (b.life < 0.3) drawGlow(b.c, b.x, b.y, H * 0.1, (1 - b.life / 0.3) * 0.65);
      for (const q of b.parts) {
        q.vx *= 1 - dt * 1.4;
        q.vy = q.vy * (1 - dt * 1.4) + H * 0.03 * dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
        drawGlow(b.c, q.x, q.y, H * 0.018, 0.8 * (1 - u * u) * (0.7 + 0.3 * Math.sin(b.life * 30 + q.x)));
      }
    }
    for (let i = fireworks.bursts.length - 1; i >= 0; i--) if (fireworks.bursts[i].life >= fireworks.bursts[i].max) fireworks.bursts.splice(i, 1);
  }

  // ---- New Year's ------------------------------------------------------------------------------------

  const confetti = [];
  const CONFETTI = ["#ffd166", "#e6e9ef", "#ff8fc7", "#7fd8ff", "#c9a2ff"];
  function drawConfetti(t, dt) {
    const fill = confetti.length === 0;
    while (confetti.length < 70) {
      confetti.push({ x: rand(0, W), y: fill ? rand(0, H * 0.85) : -6, s: H * rand(0.006, 0.011), vy: H * rand(0.015, 0.035),
        ph: rand(0, TAU), spin: rand(2, 5), c: CONFETTI[Math.floor(Math.random() * CONFETTI.length)] });
    }
    for (const q of confetti) {
      q.y += q.vy * dt;
      q.x += Math.sin(t * 0.9 + q.ph) * H * 0.01 * dt;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.ph + t * 0.7);
      ctx.scale(1, Math.cos(t * q.spin + q.ph) || 0.01);
      ctx.globalAlpha = clamp((H * 0.87 - q.y) / (H * 0.04), 0, 1) * 0.85;
      ctx.fillStyle = q.c;
      ctx.fillRect(-q.s / 2, -q.s * 0.3, q.s, q.s * 0.6);
      ctx.restore();
    }
    for (let i = confetti.length - 1; i >= 0; i--) if (confetti[i].y > H * 0.88) confetti.splice(i, 1);
  }
  // Curly streamers hanging from the top edge of the glass, short enough to stay above the monsters' names.
  function drawStreamers(t) {
    const rnd = seeded(61), colors = ["#ffd166", "#e6e9ef", "#ff8fc7", "#7fd8ff"];
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const x0 = W * (0.04 + i * 0.115 + (rnd() - 0.5) * 0.03), len = H * (0.06 + rnd() * 0.07), ph = rnd() * TAU;
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = H * 0.006;
      let px = x0, py = 0;
      for (let s = 1; s <= 18; s++) {
        const u = s / 18;
        const x = x0 + Math.sin(u * 9 + ph + Math.sin(t * 0.8 + ph) * 0.6) * H * 0.008 * (0.4 + u), y = u * len;
        ctx.globalAlpha = 0.65 + 0.35 * Math.cos(u * 9 + ph); // the twist catching the light
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        px = x; py = y;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- Valentine's -------------------------------------------------------------------------------------

  function loveFish(g, t, body, tilt) {
    g.save();
    g.rotate(tilt);
    simpleFish(g, t, body, "#ffe1ec", body[1]);
    fishEye(g, 24, -5, 5);
    g.fillStyle = "#e0245e";
    g.beginPath(); g.ellipse(40, 4, 4.5, 3.2, 0, 0, TAU); g.fill();
    g.restore();
  }
  const kissers = passer(30), kissHearts = [];
  let wasKissing = false;
  function drawKissingFish(t, dt) {
    const p = passProgress(kissers, t);
    if (p !== null) {
      const close = clamp((Math.sin(t * 1.1) - 0.3) / 0.7, 0, 1);
      const gap = 50 - 22 * close;
      const map = drawPasser(kissers, p, 140, 150, H * 0.06, H * kissers.y, (g) => {
        g.save(); g.translate(70, 75 - gap / 2); loveFish(g, t, ["#ff8fb8", "#d64f84"], close * 0.3); g.restore();
        g.save(); g.translate(70, 75 + gap / 2); loveFish(g, t + 1, ["#ffb3c9", "#e0708f"], -close * 0.3); g.restore();
      });
      const kissing = close > 0.95;
      if (kissing && !wasKissing) {
        const m = map(118, 75);
        for (let i = 0; i < 3; i++) kissHearts.push({ x: m.x, y: m.y, vx: rand(-6, 6), vy: -H * rand(0.02, 0.035), s: H * rand(0.006, 0.01), life: 0, max: 3 });
      }
      wasKissing = kissing;
    }
    for (const h of kissHearts) {
      h.life += dt; h.x += h.vx * dt; h.y += h.vy * dt;
      ctx.fillStyle = `rgba(255,120,170,${clamp(0.6 * (1 - h.life / h.max), 0, 1)})`;
      heartPath(ctx, h.x, h.y, h.s);
      ctx.fill();
    }
    for (let i = kissHearts.length - 1; i >= 0; i--) if (kissHearts[i].life >= kissHearts[i].max) kissHearts.splice(i, 1);
  }
  // A lipstick heart and "xo" scrawled on the glass in the top-right corner: tilted, sheared and lopsided, with
  // strokes that don't quite meet, all in one frame so they read as one scrawl.
  function scrawledHeart(g, s, rnd) {
    const j = () => (rnd() - 0.5) * s * 0.12;
    g.beginPath();
    g.moveTo(j() + s * 0.05, s * 0.95);
    g.bezierCurveTo(-s * 1.45 + j(), s * 0.15 + j(), -s * 1.0 + j(), -s * 1.05 + j(), -s * 0.05 + j(), -s * 0.3 + j());
    g.bezierCurveTo(s * 0.7 + j(), -s * 0.85 + j(), s * 1.15 + j(), s * 0.05 + j(), -s * 0.08 + j(), s * 1.02 + j());
  }
  function buildLipstick() {
    const { c, g } = layerCanvas();
    const x = W - H * 0.1, y = H * 0.075, s = H * 0.05, rnd = seeded(81);
    g.lineCap = "round"; g.lineJoin = "round";
    g.translate(x, y);
    g.rotate(-0.24);
    g.transform(1, 0.06, -0.2, 1, 0, 0);
    g.scale(1.08, 0.92);
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = `rgba(205,25,70,${0.3 + rnd() * 0.14})`;
      g.lineWidth = H * (0.0045 + rnd() * 0.0035);
      g.save();
      g.translate((rnd() - 0.5) * H * 0.005, (rnd() - 0.5) * H * 0.005);
      scrawledHeart(g, s * (0.96 + rnd() * 0.08), rnd);
      g.stroke();
      g.restore();
    }
    g.font = `italic 700 ${H * 0.034}px "Segoe Script", "Brush Script MT", cursive`;
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = 0; i < 2; i++) {
      const dx = (rnd() - 0.5) * H * 0.003, dy = (rnd() - 0.5) * H * 0.003;
      g.strokeStyle = `rgba(205,25,70,${0.3 + rnd() * 0.1})`;
      g.lineWidth = H * (0.0024 + rnd() * 0.0008);
      g.strokeText("xo", s * 0.5 + dx, s * 1.32 + dy);
    }
    return c;
  }

  // ---- St Patrick's ------------------------------------------------------------------------------------

  function shamrockLeaf(x, y, k, side, u) {
    const cx = x + side * k.w * 2.2, cy = y, s = k.w * 1.15;
    ctx.fillStyle = `hsl(125 50% ${26 + u * 10}%)`;
    for (const a of [-Math.PI / 2 + side * 0.4, Math.PI / 6 + side * 0.4, (5 * Math.PI) / 6 + side * 0.4]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a + Math.PI / 2);
      heartPath(ctx, 0, -0.9 * s, s);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = "hsl(125 45% 22%)";
    ctx.lineWidth = Math.max(1, k.w * 0.2);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
  }
  function coin(g, x, y, r) {
    const cg = g.createLinearGradient(x - r, y - r, x + r, y + r);
    cg.addColorStop(0, "#fff0a0"); cg.addColorStop(0.5, "#f2c230"); cg.addColorStop(1, "#a87710");
    g.fillStyle = cg;
    g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, 0, TAU); g.fill();
    g.strokeStyle = "rgba(120,80,10,0.7)"; g.lineWidth = 0.8;
    g.stroke();
  }
  const coinGlints = [];
  function decorateCoins(g) {
    const xs = clearSpots(9, 91, W * 0.015, W * 0.05), rnd = seeded(92);
    coinGlints.length = 0;
    for (const x0 of xs) {
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const x = x0 + (rnd() - 0.5) * H * 0.03, y = sandY(x) + H * (0.012 + rnd() * 0.05), r = H * (0.007 + rnd() * 0.003);
        const stack = rnd() < 0.3 ? 2 + Math.floor(rnd() * 3) : 1;
        for (let s = 0; s < stack; s++) coin(g, x, y - s * r * 0.35, r);
        if (rnd() < 0.5) coinGlints.push({ x: x - r * 0.3, y: y - (stack - 1) * r * 0.35 - r * 0.2, ph: rnd() * TAU });
      }
    }
  }
  function drawCoinGlints(t) {
    for (const c of coinGlints) {
      const a = Math.max(0, Math.sin(t * 0.9 + c.ph * 3)) ** 8;
      if (a > 0.02) drawGlow("rgba(255,240,170,0.9)", c.x, c.y, H * 0.012, a * 0.8);
    }
  }
  const leprechaun = passer(30);
  function drawLeprechaun(t) {
    const p = passProgress(leprechaun, t);
    if (p === null) return;
    const map = drawPasser(leprechaun, p, 130, 190, H * 0.065, H * leprechaun.y, (g) => {
      g.translate(65, 95);
      g.strokeStyle = "#3a3a3a"; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, 12); g.quadraticCurveTo(-2, 30, -4, 42); g.stroke();
      g.fillStyle = "#1d1d1d";
      g.beginPath(); g.moveTo(-22, 46); g.quadraticCurveTo(-24, 78, -4, 80); g.quadraticCurveTo(16, 78, 14, 46); g.closePath(); g.fill();
      g.fillStyle = "#ffd23f";
      for (const [cx, cy] of [[-14, 44], [-6, 41], [2, 43], [8, 46], [-10, 47], [-2, 46]]) { g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill(); }
      g.fillStyle = "#2b2b2b"; g.fillRect(-25, 45, 42, 5);
      simpleFish(g, t, ["#47b864", "#1f6e37"], "#c9efc9", "#2c8a46");
      fishEye(g, 24, -5, 5);
      g.fillStyle = "#e0782c";
      for (const [bx, by, br] of [[32, 9, 7], [25, 13, 7], [36, 15, 5], [29, 19, 5]]) { g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill(); }
      g.fillStyle = "#1f7a35";
      g.fillRect(12, -58, 24, 40);
      g.beginPath(); g.ellipse(24, -18, 19, 4.5, 0, 0, TAU); g.fill();
      g.fillStyle = "#111"; g.fillRect(12, -30, 24, 6);
      g.strokeStyle = "#ffd23f"; g.lineWidth = 2; g.strokeRect(20, -31, 8, 8);
    });
    const glint = map(53, 137);
    drawGlow("rgba(255,230,120,0.9)", glint.x, glint.y, H * 0.016, 0.5 + 0.3 * Math.sin(t * 4));
  }
  // A rainbow across the top-left corner of the glass, bowing toward the corner. The bands are concentric arcs of a
  // circle centred out in the tank on the corner's diagonal, so they stay evenly spaced; red is nearest the corner.
  function buildRainbow() {
    const { c, g } = layerCanvas();
    const colors = ["255,70,70", "255,160,60", "255,230,80", "90,220,110", "80,160,255", "170,110,255"];
    const cc = H * 0.55, inner = H * 0.36, band = H * 0.011;
    const r0 = Math.hypot(cc - inner, cc);
    colors.forEach((col, i) => {
      const r = r0 + (colors.length - 1 - i) * band;
      const edge = cc - Math.sqrt(r * r - cc * cc);
      const aLeft = Math.atan2(edge - cc, -cc) - 0.03, aTop = Math.atan2(-cc, edge - cc) + 0.03;
      for (const [w, a] of [[band * 1.5, 0.05], [band, 0.12]]) {
        g.strokeStyle = `rgba(${col},${a})`;
        g.lineWidth = w;
        g.beginPath(); g.arc(cc, cc, r, aLeft, aTop); g.stroke();
      }
    });
    return c;
  }

  // ---- Easter ------------------------------------------------------------------------------------------

  const PASTELS = ["#f7a8c8", "#a8d8f7", "#fff1a8", "#c8b4f0", "#b4f0c8", "#ffc8a0"];
  function decorateEggs(g) {
    const xs = clearSpots(7, 101, W * 0.018, W * 0.06), rnd = seeded(102);
    g.save();
    clipAboveSand(g, H * 0.006);
    for (const x of xs) {
      const h = H * (0.028 + rnd() * 0.014), w = h * 0.76, tilt = (rnd() - 0.5) * 0.8;
      const y = sandY(x) + h * 0.12, base = PASTELS[Math.floor(rnd() * PASTELS.length)];
      const deco = PASTELS[Math.floor(rnd() * PASTELS.length)], style = Math.floor(rnd() * 3);
      g.save();
      g.translate(x, y); g.rotate(tilt);
      g.beginPath(); g.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
      g.fillStyle = base; g.fill();
      g.save(); g.clip();
      g.fillStyle = deco; g.strokeStyle = deco; g.lineWidth = h * 0.07;
      if (style === 0) { g.fillRect(-w, -h * 0.18, w * 2, h * 0.1); g.fillRect(-w, h * 0.08, w * 2, h * 0.1); }
      else if (style === 1) {
        g.beginPath();
        for (let i = 0; i <= 8; i++) g.lineTo(-w / 2 + (w * i) / 8, (i % 2 ? -1 : 1) * h * 0.06);
        g.stroke();
      } else for (const [dx, dy] of [[-0.18, -0.2], [0.15, -0.05], [-0.1, 0.15], [0.2, 0.25], [0, -0.32]]) {
        g.beginPath(); g.arc(dx * w, dy * h, h * 0.055, 0, TAU); g.fill();
      }
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.beginPath(); g.ellipse(-w * 0.18, -h * 0.22, w * 0.1, h * 0.14, -0.3, 0, TAU); g.fill();
      g.restore();
      g.strokeStyle = "rgba(60,40,30,0.25)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); g.stroke();
      g.restore();
    }
    g.restore();
  }
  // A pastel ribbon wound round each kelp strand, only the front turns showing, with a bow near the top.
  function drawKelpRibbons(t) {
    if (!kelpPoint) return;
    const wraps = 2.4, steps = 48;
    kelp.forEach((k, ki) => {
      const col = PASTELS[ki % PASTELS.length];
      const pt = (u) => {
        const q = kelpPoint(k, u, t), a = u * wraps * TAU + ki;
        return { x: q.x + Math.sin(a) * k.w * 1.3 * (1.1 - u * 0.5), y: q.y + Math.cos(a) * k.w * 0.6, front: Math.cos(a) };
      };
      ctx.lineCap = "round";
      ctx.strokeStyle = col;
      ctx.lineWidth = k.w * 0.6;
      let prev = pt(0.05);
      for (let s = 1; s <= steps; s++) {
        const q = pt(0.05 + (s / steps) * 0.85);
        ctx.globalAlpha = q.front > -0.15 ? 0.9 : 0.25;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        prev = q;
      }
      ctx.globalAlpha = 1;
      const b = pt(0.9);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(b.x - k.w * 1.1, b.y, k.w * 1.2, k.w * 0.7, 0.4, 0, TAU);
      ctx.ellipse(b.x + k.w * 1.1, b.y, k.w * 1.2, k.w * 0.7, -0.4, 0, TAU);
      ctx.fill();
    });
  }
  // A bunny-fish hopping along the far sand line.
  const bunny = passer(26);
  function drawBunny(t) {
    const p = passProgress(bunny, t);
    if (p === null) return;
    const hops = 10, hp = (p * hops) % 1, lift = Math.sin(hp * Math.PI);
    const y = sandTop - H * 0.035 - lift * H * 0.06;
    drawPasser(bunny, p, 130, 140, H * 0.06, y, (g) => {
      g.translate(70, 85);
      g.rotate(-Math.cos(hp * Math.PI) * 0.25);
      for (const [ex, lean] of [[14, -0.35], [24, -0.15]]) {
        g.save(); g.translate(ex, -16); g.rotate(lean);
        g.fillStyle = "#e8e2da"; g.beginPath(); g.ellipse(0, -22, 7, 22, 0, 0, TAU); g.fill();
        g.fillStyle = "#f3b6c6"; g.beginPath(); g.ellipse(0, -22, 3.5, 16, 0, 0, TAU); g.fill();
        g.restore();
      }
      simpleFish(g, t * 0.3, ["#f1ece6", "#b9aea3"], "#ffffff", "#cfc5bb");
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(-34, -8, 9, 0, TAU); g.fill();
      fishEye(g, 24, -6, 5);
      g.fillStyle = "#f08aa6"; g.beginPath(); g.arc(40, 0, 3.5, 0, TAU); g.fill();
      g.strokeStyle = "rgba(90,80,70,0.7)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(40, 2); g.lineTo(54, -2); g.moveTo(40, 3); g.lineTo(54, 6); g.stroke();
    });
  }

  // ---- Independence Day ----------------------------------------------------------------------------------

  // Bunting across the top of the glass: shallow swags of red, white and blue pennants, with rosettes.
  function buildBunting() {
    const { c, g } = layerCanvas();
    const swags = 5, sag = H * 0.035, flags = ["#c8102e", "#f4f4f4", "#1d3f8f"];
    const at = (x) => { const u = (x / W) * swags, f = u - Math.floor(u); return H * 0.006 + sag * Math.sin(f * Math.PI); };
    g.strokeStyle = "rgba(240,240,240,0.8)"; g.lineWidth = 1.2;
    g.beginPath();
    for (let x = 0; x <= W; x += W / 200) g.lineTo(x, at(x));
    g.stroke();
    const per = 9, fw = (W / (swags * per)) * 0.7, fh = H * 0.03;
    for (let i = 0; i < swags * per; i++) {
      const x = ((i + 0.5) / (swags * per)) * W, y = at(x);
      g.fillStyle = flags[i % 3];
      g.beginPath(); g.moveTo(x - fw / 2, y); g.lineTo(x + fw / 2, y); g.lineTo(x, y + fh); g.closePath(); g.fill();
      g.strokeStyle = "rgba(0,0,0,0.15)"; g.lineWidth = 0.8; g.stroke();
    }
    for (let i = 0; i <= swags; i++) {
      const x = (i * W) / swags, r = H * 0.018;
      for (const [rr, col] of [[1, "#1d3f8f"], [0.7, "#f4f4f4"], [0.42, "#c8102e"]]) {
        g.fillStyle = col; g.beginPath(); g.arc(x, H * 0.01, r * rr, 0, TAU); g.fill();
      }
    }
    return c;
  }

  // ---- Thanksgiving ------------------------------------------------------------------------------------

  const LEAF_COLORS = ["#d9541e", "#e8892a", "#c23b22", "#e3b23c", "#8a4b2a"];
  function leafPath(g, s) { // a simple maple leaf centred on 0,0, pointing up
    const pts = [[0, -1], [0.22, -0.55], [0.62, -0.72], [0.48, -0.25], [0.92, -0.1], [0.42, 0.18], [0.5, 0.55], [0.12, 0.35],
      [0, 0.7], [-0.12, 0.35], [-0.5, 0.55], [-0.42, 0.18], [-0.92, -0.1], [-0.48, -0.25], [-0.62, -0.72], [-0.22, -0.55]];
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s)));
    g.closePath();
  }
  function decorateLeaves(g) {
    const xs = clearSpots(22, 111, W * 0.012, W * 0.02), rnd = seeded(112);
    for (const x of xs) {
      const y = sandY(x) + H * (0.004 + rnd() * 0.05), s = H * (0.011 + rnd() * 0.006);
      g.save();
      g.translate(x, y); g.rotate(rnd() * TAU); g.scale(1, 0.55); // lying flat on the sand
      g.fillStyle = LEAF_COLORS[Math.floor(rnd() * LEAF_COLORS.length)];
      g.globalAlpha = 0.9;
      leafPath(g, s); g.fill();
      g.restore();
    }
  }
  const leaves = [];
  function drawFallingLeaves(t, dt) {
    const fill = leaves.length === 0;
    while (leaves.length < 16) {
      leaves.push({ x: rand(0, W), y: fill ? rand(0, H * 0.8) : -H * 0.03, s: H * rand(0.011, 0.017), vy: H * rand(0.018, 0.032),
        ph: rand(0, TAU), spin: rand(0.6, 1.4), c: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)] });
    }
    for (const l of leaves) {
      l.y += l.vy * dt;
      l.x += Math.sin(t * 0.8 + l.ph) * H * 0.03 * dt;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(Math.sin(t * l.spin + l.ph) * 0.9);
      ctx.scale(Math.cos(t * l.spin * 0.7 + l.ph) || 0.01, 1);
      ctx.globalAlpha = clamp((H * 0.87 - l.y) / (H * 0.04), 0, 1) * 0.9;
      ctx.fillStyle = l.c;
      leafPath(ctx, l.s); ctx.fill();
      ctx.restore();
    }
    for (let i = leaves.length - 1; i >= 0; i--) if (leaves[i].y > H * 0.88) leaves.splice(i, 1);
  }
  // A turkey-fish (a fan of tail feathers) waddling along the far sand line.
  const turkey = passer(40);
  function drawTurkey(t) {
    const p = passProgress(turkey, t);
    if (p === null) return;
    const y = sandTop - H * 0.05 - Math.abs(Math.sin(t * 5)) * H * 0.006;
    drawPasser(turkey, p, 170, 170, H * 0.06, y, (g) => {
      g.translate(95, 100);
      g.rotate(Math.sin(t * 5) * 0.12);
      const feathers = 9;
      for (const [len, col] of [[62, "#6b3b1c"], [50, "#c4561e"], [40, "#e3a33a"], [30, "#a8331d"]]) {
        g.fillStyle = col;
        for (let i = 0; i < feathers; i++) {
          const a = Math.PI + 0.25 + (i / (feathers - 1)) * (Math.PI - 0.5);
          g.save(); g.translate(-22, -4); g.rotate(a + Math.PI / 2);
          g.beginPath(); g.ellipse(0, -len / 2, 9, len / 2, 0, 0, TAU); g.fill();
          g.restore();
        }
      }
      g.beginPath(); g.ellipse(0, 0, 38, 26, 0, 0, TAU);
      const bg = g.createLinearGradient(0, -26, 0, 26);
      bg.addColorStop(0, "#8a5a32"); bg.addColorStop(1, "#4e2f17");
      g.fillStyle = bg; g.fill();
      fishEye(g, 22, -8, 5);
      g.fillStyle = "#f0a830";
      g.beginPath(); g.moveTo(36, -4); g.lineTo(48, 0); g.lineTo(36, 4); g.closePath(); g.fill();
      g.fillStyle = "#d42a2a";
      g.beginPath(); g.ellipse(36, 10, 4, 9, 0.2, 0, TAU); g.fill();
    });
  }

  // ---- the themes ------------------------------------------------------------------------------------

  const THEMES = {
    newyear: {
      bubbleTint: () => (Math.random() < 0.7 ? "255,214,110" : null), // gold "champagne" bubbles
      start() { confetti.length = 0; fireworks.bursts.length = 0; },
      far(t, dt) { drawFireworks(t, dt, ["rgba(255,214,110,0.85)", "rgba(240,240,255,0.85)", "rgba(255,170,90,0.85)"]); },
      back(t, dt) { drawConfetti(t, dt); },
      front(t) { drawStreamers(t); },
    },
    valentines: {
      rays: "rgba(255,190,220,0.09)",
      heartBubbles: true,
      bubbleTint: () => "255,200,222",
      start() { resetPasser(kissers); kissHearts.length = 0; },
      layout() { return buildLipstick(); },
      far(t, dt) { drawKissingFish(t, dt); },
    },
    stpatricks: {
      rays: "rgba(170,255,170,0.08)",
      kelpLeaf: shamrockLeaf,
      start() { resetPasser(leprechaun); },
      decorate(g) { decorateCoins(g); },
      layout() { return buildRainbow(); },
      far(t) { drawLeprechaun(t); },
      back(t) { drawCoinGlints(t); },
    },
    easter: {
      start() { resetPasser(bunny); },
      decorate(g) { decorateEggs(g); },
      far(t) { drawBunny(t); },
      back(t) { drawKelpRibbons(t); },
    },
    july4: {
      bubbleTint: () => ["255,110,110", "240,248,255", "120,165,255"][Math.floor(Math.random() * 3)],
      start() { fireworks.bursts.length = 0; },
      layout() { return buildBunting(); },
      far(t, dt) { drawFireworks(t, dt, ["rgba(255,80,80,0.85)", "rgba(240,240,255,0.85)", "rgba(90,140,255,0.85)"]); },
    },
    thanksgiving: {
      rays: "rgba(255,205,150,0.09)",
      start() { resetPasser(turkey); leaves.length = 0; },
      decorate(g) { decorateLeaves(g); },
      far(t) { drawTurkey(t); },
      back(t, dt) { drawFallingLeaves(t, dt); },
    },
    december: {
      water: ["#1a8bb0", "#0b5578", "#04223a"],
      start() { parade.start = -Infinity; parade.next = 0; parade.sparks.length = 0; gifts.nextDrop = 0; },
      decorate(g) { decorateTree(g); },
      layout() { buildPile(); return buildFrost(); },
      far(t, dt) { drawParade(t, dt); },
      back(t, dt) { drawTreeLights(t); drawKelpLights(t); drawPresents(t, dt); },
    },
    halloween: {
      water: ["#2a7068", "#123e48", "#050d18"],
      rays: "rgba(170,255,190,0.06)",
      sand: ["#a8956a", "#5a4a2e"],
      bubbleTint: () => (Math.random() < 0.6 ? "160,255,150" : null),
      start() { ghosts.length = 0; nextGhost = 0; },
      decorate(g) { decoratePumpkin(g); },
      layout() { return buildCobwebs(); },
      far(t, dt) { drawGhosts(t, dt); },
      back(t) { drawPumpkinGlow(t); },
      front(t) { drawSpider(t); },
    },
  };

  return {
    scene, pick, activate,
    get key() { return key; },
    set previewDay(d) { previewDay = d; },
    water: () => (theme && theme.water) || null,
    sand: () => (theme && theme.sand) || null,
    rays: () => (theme && theme.rays) || null,
    bubbleTint: () => (theme && theme.bubbleTint ? theme.bubbleTint() : null),
    heartBubble: () => Boolean(theme && theme.heartBubbles && Math.random() < 0.5),
    heartPath,
    // Draws a kelp leaf the theme's way (St Patrick's shamrocks); false means draw the usual leaf.
    kelpLeaf(x, y, k, side, u) { if (!theme || !theme.kelpLeaf) return false; theme.kelpLeaf(x, y, k, side, u); return true; },
    decorate(g) { if (theme && theme.decorate) theme.decorate(g); },
    layout() { glassCanvas = theme && theme.layout ? theme.layout() : null; },
    far(t, dt) { if (theme && theme.far) theme.far(t, dt); },
    back(t, dt) { if (theme && theme.back) theme.back(t, dt); },
    glass: () => (theme ? glassCanvas : null),
    front(t) { if (theme && theme.front) theme.front(t); },
  };
})();
