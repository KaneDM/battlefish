// Procedural sea-monster drawing, shared by the aquarium and the editor.
// Each shape is drawn facing right in a box about 100 units long centered on
// (0, 0); draw() scales that box to the requested size and facing.
const MonsterArt = (() => {
  const SHAPES = [
    { key: "fish", label: "Classic" },
    { key: "eel", label: "Eel" },
    { key: "puffer", label: "Puffer" },
    { key: "squid", label: "Squid" },
    { key: "seahorse", label: "Seahorse" },
    { key: "cuttlefish", label: "Cuttlefish" },
    { key: "prawn", label: "Prawn" },
    { key: "angler", label: "Anglerfish" },
    { key: "ray", label: "Ray" },
    { key: "school", label: "School" },
  ];
  const TAU = Math.PI * 2;

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // amt in -1..1: negative darkens toward black, positive lightens toward white.
  function shade(hex, amt) {
    const target = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    const [r, g, b] = rgb(hex).map((v) => Math.round(v + (target - v) * p));
    return `rgb(${r},${g},${b})`;
  }

  function bodyGradient(ctx, c, top, bottom) {
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, shade(c.body, -0.3));
    g.addColorStop(0.5, c.body);
    g.addColorStop(1, shade(c.body, 0.45));
    return g;
  }

  function outline(ctx, c, width = 1.6) {
    ctx.lineWidth = width;
    ctx.strokeStyle = shade(c.body, -0.6);
    ctx.stroke();
  }

  function eye(ctx, x, y, r, opts) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.stroke();
    if (opts.dazed) {
      const k = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
      ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
      ctx.lineWidth = r * 0.3;
      ctx.strokeStyle = "#222";
      ctx.stroke();
      return;
    }
    // Looks toward whichever end leads (opts.lead, see swimFace).
    const g = opts.lead ?? 1;
    ctx.beginPath();
    ctx.arc(x + r * 0.28 * g, y + r * 0.05, r * 0.5, 0, TAU);
    ctx.fillStyle = "#151515";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.12 * g, y - r * 0.22, r * 0.17, 0, TAU);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  // A row of teeth between x0 and x1 hanging from y (dir 1 = pointing down).
  function teeth(ctx, x0, x1, y, h, dir = 1) {
    const n = Math.max(2, Math.round((x1 - x0) / 4.5));
    const w = (x1 - x0) / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(x0 + i * w, y);
      ctx.lineTo(x0 + i * w + w / 2, y + h * dir);
      ctx.lineTo(x0 + (i + 1) * w, y);
    }
    ctx.fillStyle = "#fffdf4";
    ctx.fill();
  }

  function fish(ctx, c, t, opts) {
    const wag = Math.sin(t * 6) * 0.35;
    ctx.save();
    ctx.translate(-36, 0);
    ctx.rotate(wag);
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.quadraticCurveTo(-12, -6, -26, -24);
    ctx.quadraticCurveTo(-17, 0, -26, 24);
    ctx.quadraticCurveTo(-12, 6, 4, 0);
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c);
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(-20, -18);
    ctx.quadraticCurveTo(-8, -46 + Math.sin(t * 3) * 3, 14, -20);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c);

    ctx.beginPath();
    ctx.ellipse(0, 0, 42, 24, 0, 0, TAU);
    ctx.fillStyle = bodyGradient(ctx, c, -24, 24);
    ctx.fill();
    outline(ctx, c, 2);
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 5;
    for (const x of [-22, -8]) {
      ctx.beginPath();
      ctx.moveTo(x, -26);
      ctx.quadraticCurveTo(x + 7, 0, x, 26);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(2, 9);
    ctx.rotate(0.5 + Math.sin(t * 5) * 0.3);
    ctx.beginPath();
    ctx.ellipse(-7, 0, 11, 4.5, 0, 0, TAU);
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(25, 9);
    ctx.quadraticCurveTo(34, 11, 41, 4);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = shade(c.body, -0.7);
    ctx.stroke();
    teeth(ctx, 27, 38, 9.5, 4.5);
    eye(ctx, 24, -7, 7, opts);
  }

  function eel(ctx, c, t, opts) {
    const N = 28;
    const top = [], bot = [], mid = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = -58 + 100 * u;
      // + t sends the wave from head (u = 1) to tail, as a swimming eel's does.
      const y = Math.sin(u * 7 + t * 5) * 12 * Math.pow(1 - u, 1.5);
      const h = 2 + 12 * Math.pow(u, 0.6);
      top.push([x, y - h]);
      bot.push([x, y + h]);
      mid.push([x, y, h]);
    }

    // Frilled fin along the back, drawn first so the body covers its base.
    ctx.beginPath();
    ctx.moveTo(top[3][0], top[3][1]);
    for (let i = 3; i <= 22; i++) {
      ctx.lineTo(top[i][0], top[i][1] - 6 - 2 * Math.sin(i * 1.3 + t * 4));
    }
    for (let i = 22; i >= 3; i--) ctx.lineTo(top[i][0], top[i][1] + 2);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c, 1.2);

    const [hx, hy, hr] = mid[N];
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (const p of top) ctx.lineTo(p[0], p[1]);
    ctx.arc(hx, hy, hr, -Math.PI / 2, Math.PI / 2);
    for (let i = N; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
    ctx.fillStyle = bodyGradient(ctx, c, -16, 16);
    ctx.fill();
    outline(ctx, c, 2);

    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.85;
    for (const u of [0.3, 0.48, 0.66]) {
      const [x, y, h] = mid[Math.round(u * N)];
      ctx.beginPath();
      ctx.arc(x, y - h * 0.2, h * 0.38, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(hx - 6, hy + 5);
    ctx.lineTo(hx + hr * 0.95, hy + 3);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = shade(c.body, -0.7);
    ctx.stroke();
    teeth(ctx, hx - 4, hx + hr * 0.85, hy + 4.5, 4.5);
    eye(ctx, hx + 2, hy - 5, 5.5, opts);
  }

  function puffer(ctx, c, t, opts) {
    const r = 30 * (1 + Math.sin(t * 2.5) * 0.03);
    ctx.save();
    ctx.translate(-r + 2, 0);
    ctx.rotate(Math.sin(t * 7) * 0.4);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-18, -13);
    ctx.lineTo(-13, 0);
    ctx.lineTo(-18, 13);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c);
    ctx.restore();

    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.1;
      ctx.moveTo(Math.cos(a - 0.13) * r * 0.9, Math.sin(a - 0.13) * r * 0.9);
      ctx.lineTo(Math.cos(a) * (r + 11), Math.sin(a) * (r + 11));
      ctx.lineTo(Math.cos(a + 0.13) * r * 0.9, Math.sin(a + 0.13) * r * 0.9);
    }
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c, 1);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, shade(c.body, 0.4));
    g.addColorStop(0.6, c.body);
    g.addColorStop(1, shade(c.body, -0.35));
    ctx.fillStyle = g;
    ctx.fill();
    outline(ctx, c, 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.7;
    for (const [x, y, s] of [[-14, -14, 4], [-4, -20, 3], [-18, 2, 3.5], [-8, 14, 3], [4, -6, 2.5]]) {
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(-2, 8);
    ctx.rotate(0.6 + Math.sin(t * 6) * 0.35);
    ctx.beginPath();
    ctx.ellipse(-6, 0, 9, 4, 0, 0, TAU);
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(r * 0.5, 11);
    ctx.quadraticCurveTo(r * 0.8, 12, r * 0.97, 5);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = shade(c.body, -0.7);
    ctx.stroke();
    teeth(ctx, r * 0.52, r * 0.9, 11, 4.5);
    eye(ctx, r * 0.38, -r * 0.3, 9, opts);
  }

  function squid(ctx, c, t, opts) {
    // Tentacles reach forward, toward a foe; the head is drawn over their roots.
    // Swimming, a squid leads with its mantle instead (see swimFace).
    ctx.lineCap = "round";
    for (let k = 0; k < 6; k++) {
      const y0 = -9 + k * 3.6;
      const len = k === 1 || k === 4 ? 50 : 36;
      let px = 12, py = y0;
      for (let s = 1; s <= 12; s++) {
        const u = s / 12;
        const x = 12 + len * u;
        // - t sends the wave out from the head to the tips, so they ripple behind a squid swimming mantle first.
        const y = y0 * (1 + 0.7 * u) + Math.sin(u * 5 - t * 6 + k) * 6 * u;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.lineWidth = 5.5 - 4 * u;
        ctx.strokeStyle = k % 2 ? c.accent : shade(c.accent, -0.15);
        ctx.stroke();
        px = x; py = y;
      }
    }

    const flap = Math.sin(t * 4) * 4;
    ctx.beginPath();
    ctx.moveTo(-40, -6);
    ctx.lineTo(-60, -20 + flap);
    ctx.lineTo(-53, 0);
    ctx.lineTo(-60, 20 - flap);
    ctx.lineTo(-40, 6);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c);

    ctx.beginPath();
    ctx.moveTo(-56, 0);
    ctx.bezierCurveTo(-50, -24, -10, -25, 4, -14);
    ctx.lineTo(4, 14);
    ctx.bezierCurveTo(-10, 25, -50, 24, -56, 0);
    ctx.closePath();
    ctx.fillStyle = bodyGradient(ctx, c, -22, 22);
    ctx.fill();
    outline(ctx, c, 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.75;
    for (const [x, y, s] of [[-36, -7, 3.5], [-24, 6, 3], [-14, -9, 3], [-44, 5, 2.5], [-8, 4, 2.5]]) {
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.ellipse(10, 0, 13, 15, 0, 0, TAU);
    ctx.fillStyle = bodyGradient(ctx, c, -15, 15);
    ctx.fill();
    outline(ctx, c, 2);
    eye(ctx, 12, -5, 6.5, opts);
  }

  // Catmull-Rom curve through pts, n points per span.
  function spline(pts, n) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < n; s++) {
        const u = s / n, u2 = u * u, u3 = u2 * u;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function seahorse(ctx, c, t, opts) {
    // Upright, bobbing slightly; opts.lean (0..1) tips it forward about 25° to charge in a fight.
    ctx.save();
    ctx.rotate((opts.lean || 0) * 0.45 + Math.sin(t * 1.6) * 0.05);

    // Spine from inside the head down to the tail tip; the tail curls forward under the belly.
    const curl = 1 + Math.sin(t * 1.8) * 0.1;
    const tail = [[-7, 33], [-4, 41], [4, 41], [7, 34], [3, 30], [-0.5, 33.5]]
      .map(([x, y]) => [1 + (x - 1) * curl, 35 + (y - 35) * curl]);
    const spine = spline([[4, -31], [7, -15], [10, 0], [5, 15], [-4, 25], ...tail], 6);
    const ws = [7, 11, 13.5, 15, 11.5, 7, 5, 3.6, 2.8, 2.2, 1.6, 1];
    const N = spine.length - 1;
    const front = [], back = [], norm = [];
    for (let i = 0; i <= N; i++) {
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(N, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l; // toward the back
      const k = (i / N) * (ws.length - 1), j = Math.min(ws.length - 2, Math.floor(k));
      const w = ws[j] + (ws[j + 1] - ws[j]) * (k - j);
      norm.push([nx, ny, w]);
      front.push([spine[i][0] - nx * w, spine[i][1] - ny * w]);
      back.push([spine[i][0] + nx * w, spine[i][1] + ny * w]);
    }

    // Dorsal fin, fluttering fast the way a seahorse's does. Its rays point straight back:
    // the back is concave there, so along the normals they'd cross.
    const d0 = 10, d1 = 22, tip = [];
    for (let i = d0; i <= d1; i++) {
      const u = (i - d0) / (d1 - d0);
      const reach = 4 + 10 * Math.sin(u * Math.PI) ** 0.7;
      tip.push([back[i][0] - reach, back[i][1] + reach * 0.25 + Math.sin(t * 14 - i * 0.9) * 1.6]);
    }
    ctx.beginPath();
    ctx.moveTo(back[d0][0] + 2, back[d0][1]);
    for (const p of tip) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(back[d1][0] + 2, back[d1][1]);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    outline(ctx, c, 1.2);
    ctx.beginPath();
    for (let i = 0; i < tip.length; i += 3) {
      ctx.moveTo(back[d0 + i][0], back[d0 + i][1]);
      ctx.lineTo(tip[i][0], tip[i][1]);
    }
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = shade(c.accent, -0.4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(front[0][0], front[0][1]);
    for (const p of front) ctx.lineTo(p[0], p[1]);
    for (let i = N; i >= 0; i--) ctx.lineTo(back[i][0], back[i][1]);
    ctx.closePath();
    // Shaded back to belly rather than top to bottom, since it stands upright.
    const g = ctx.createLinearGradient(-14, 0, 22, 0);
    g.addColorStop(0, shade(c.body, -0.3));
    g.addColorStop(0.5, c.body);
    g.addColorStop(1, shade(c.body, 0.45));
    ctx.fillStyle = g;
    ctx.fill();
    outline(ctx, c, 2);
    // Bony rings across the body.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.6;
    for (let i = 5; i < N - 6; i += 4) {
      const [nx, ny, w] = norm[i];
      ctx.beginPath();
      ctx.moveTo(spine[i][0] - nx * w * 1.2, spine[i][1] - ny * w * 1.2);
      ctx.lineTo(spine[i][0] + nx * w * 1.2, spine[i][1] + ny * w * 1.2);
      ctx.stroke();
    }
    ctx.restore();

    // Head: the snout tube first, then the skull over its root.
    const hx = 5, hy = -30;
    ctx.beginPath();
    ctx.moveTo(hx + 4, hy - 4);
    ctx.lineTo(hx + 28, hy + 0.5);
    ctx.quadraticCurveTo(hx + 32, hy + 1, hx + 32, hy + 4.5);
    ctx.quadraticCurveTo(hx + 32, hy + 8, hx + 28, hy + 8);
    ctx.lineTo(hx + 4, hy + 6);
    ctx.closePath();
    ctx.fillStyle = c.body;
    ctx.fill();
    outline(ctx, c, 1.8);
    ctx.beginPath();
    ctx.moveTo(hx + 21, hy + 5);
    ctx.lineTo(hx + 31.5, hy + 4.5);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = shade(c.body, -0.7);
    ctx.stroke();
    teeth(ctx, hx + 21, hx + 30, hy + 5, 3.5);

    // Coronet: a little crown of spikes.
    ctx.beginPath();
    ctx.moveTo(hx - 7, hy - 6);
    ctx.lineTo(hx - 5, hy - 14);
    ctx.lineTo(hx - 2, hy - 9);
    ctx.lineTo(hx + 1, hy - 15);
    ctx.lineTo(hx + 3, hy - 9);
    ctx.lineTo(hx + 7, hy - 13);
    ctx.lineTo(hx + 6, hy - 5);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c, 1.2);

    ctx.beginPath();
    ctx.ellipse(hx, hy, 11, 9, 0.25, 0, TAU);
    const hg = ctx.createLinearGradient(hx - 11, 0, hx + 11, 0);
    hg.addColorStop(0, shade(c.body, -0.25));
    hg.addColorStop(1, shade(c.body, 0.3));
    ctx.fillStyle = hg;
    ctx.fill();
    outline(ctx, c, 2);

    // Pectoral fin just behind the head.
    ctx.save();
    ctx.translate(hx - 5, hy + 11);
    ctx.rotate(2.4 + Math.sin(t * 12) * 0.35);
    ctx.beginPath();
    ctx.ellipse(5, 0, 6, 3, 0, 0, TAU);
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();

    eye(ctx, hx + 3, hy - 1, 6, opts);
    ctx.restore();
  }

  // Fangs along the segment p0 -> p1, pointing to its left (n, alternating long and short).
  function fangs(ctx, p0, p1, n, h) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy);
    const nx = dy / l, ny = -dx / l;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i + 0.15) / n, b = (i + 0.85) / n, m = (a + b) / 2, len = h * (i % 2 ? 0.6 : 1);
      ctx.moveTo(p0[0] + dx * a, p0[1] + dy * a);
      ctx.lineTo(p0[0] + dx * m + nx * len, p0[1] + dy * m + ny * len);
      ctx.lineTo(p0[0] + dx * b, p0[1] + dy * b);
    }
    ctx.fillStyle = "#fffdf4";
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.stroke();
  }

  // ---- Cuttlefish -------------------------------------------------------------------------------------------
  // Broad oval mantle ringed by a rippling fin skirt, short arms bunched into a point, zebra bands and a W-shaped
  // pupil. Unlike the squid it swims arms first, so it leads with its head like the fish.
  function cuttlefish(ctx, c, t, opts) {
    // Arms: tapered filled shapes, two batched paths (alternate shades) instead of the squid's per-segment strokes.
    for (const odd of [0, 1]) {
      ctx.beginPath();
      for (let k = odd; k < 6; k += 2) {
        const y0 = -7.5 + k * 3;
        const len = 22 - Math.abs(k - 2.5) * 2.4;
        const L = [], R = [];
        for (let s = 0; s <= 6; s++) {
          const u = s / 6;
          const x = 17 + len * u;
          const y = y0 * (1 - 0.6 * u) + Math.sin(u * 4 - t * 4 + k * 1.3) * 2 * u;
          const w = 2.4 * (1 - u) + 0.5;
          L.push([x, y - w]); R.push([x, y + w]);
        }
        ctx.moveTo(L[0][0], L[0][1]);
        for (const p of L) ctx.lineTo(p[0], p[1]);
        for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
      }
      ctx.fillStyle = odd ? c.accent : shade(c.accent, -0.18);
      ctx.fill();
      outline(ctx, c, 1);
    }

    // Fin skirt: it runs flat along each side of the mantle, so in profile it's seen edge-on as a ribbon along
    // the middle. Its root is a straight line; its outer edge rises and falls as a wave runs head to tail, and
    // the ribbon shows the fin's surface between the two. The far fin is drawn behind the mantle and only peeks
    // out past its back end.
    const cx = -24, rx = 28, ry = 17;
    const finRibbon = (shift) => {
      // It reaches a little past the mantle and narrows to a rounded tip there, instead of ending in a cut.
      const N = 30, top = [], bot = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = 1 - 60 * u;
        const root = 2 - 1.5 * u;
        const tail = Math.sin(Math.min(1, (1 - u) / 0.2) * Math.PI / 2); // 1 until the last fifth, then easing to 0
        const edge = root + 6 * Math.sin(u * 13 - t * 8 + shift) * Math.min(1, u * 4) * tail;
        const half = 0.9 + 1.6 * (1 - tail) * tail; // swells slightly before closing, to round the tip
        top.push([x, Math.min(root, edge) - half * Math.sqrt(tail)]);
        bot.push([x, Math.max(root, edge) + half * Math.sqrt(tail)]);
      }
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      for (const p of top) ctx.lineTo(p[0], p[1]);
      for (let i = N; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
    };
    finRibbon(Math.PI);
    ctx.fillStyle = shade(c.accent, -0.3);
    ctx.fill();
    outline(ctx, c, 1.2);

    ctx.beginPath();
    ctx.ellipse(cx, 0, rx, ry, 0, 0, TAU);
    ctx.fillStyle = bodyGradient(ctx, c, -ry, ry);
    ctx.fill();
    outline(ctx, c, 2);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const x of [-46, -38, -30, -22, -14, -6]) {
      ctx.moveTo(x, -19);
      ctx.quadraticCurveTo(x + 4, -11, x - 1, -4);
    }
    ctx.stroke();
    ctx.restore();

    // Near fin, over the mantle.
    finRibbon(0);
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    outline(ctx, c, 1.2);

    ctx.beginPath();
    ctx.ellipse(11, 0.5, 10, 12.5, 0, 0, TAU);
    ctx.fillStyle = bodyGradient(ctx, c, -12, 13);
    ctx.fill();
    outline(ctx, c, 2);
    wEye(ctx, 11, -3, 6.8, opts);
  }

  // A cuttlefish eye: the shared eye's white and dazed cross, but a W-shaped pupil.
  function wEye(ctx, x, y, r, opts) {
    if (opts.dazed) return eye(ctx, x, y, r, opts);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.stroke();
    const g = opts.lead ?? 1, ox = x + r * 0.12 * g, oy = y + r * 0.05;
    ctx.beginPath();
    ctx.moveTo(ox - r * 0.6, oy - r * 0.28);
    ctx.lineTo(ox - r * 0.3, oy + r * 0.36);
    ctx.lineTo(ox, oy - r * 0.06);
    ctx.lineTo(ox + r * 0.3, oy + r * 0.36);
    ctx.lineTo(ox + r * 0.6, oy - r * 0.28);
    ctx.lineWidth = r * 0.36;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#151515";
    ctx.stroke();
  }

  // ---- Prawn ------------------------------------------------------------------------------------------------
  // Arched, banded abdomen ending in a tail fan, a carapace with a serrated rostrum, eye on a stalk, long
  // antennae swept back over the body, and swimmerets paddling underneath.
  function prawn(ctx, c, t, opts) {
    // In a fight the tail curls down and forward under the body, toward the foe.
    const curl = Math.sin(t * 2) * 0.07 - (opts.lean || 0) * 0.3;
    const pivot = [-2, -9];
    const rot = (p, k) => {
      const a = curl * k, dx = p[0] - pivot[0], dy = p[1] - pivot[1];
      return [pivot[0] + dx * Math.cos(a) - dy * Math.sin(a), pivot[1] + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    const ctrl = [[31, -3], [15, -8], [-2, -9], rot([-17, -6], 0.5), rot([-29, 0], 1), rot([-37, 8], 1.5), rot([-41, 17], 2)];
    const spine = spline(ctrl, 5);
    const ws = [7.5, 9.5, 10, 9, 7.5, 5.8, 4.5, 3.4];
    const N = spine.length - 1;
    const back = [], belly = [], norm = [];
    for (let i = 0; i <= N; i++) {
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(N, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l; // toward the back (up)
      const k = (i / N) * (ws.length - 1), j = Math.min(ws.length - 2, Math.floor(k));
      const w = ws[j] + (ws[j + 1] - ws[j]) * (k - j);
      norm.push([nx, ny, w]);
      back.push([spine[i][0] + nx * w, spine[i][1] + ny * w]);
      belly.push([spine[i][0] - nx * w, spine[i][1] - ny * w]);
    }
    const ic = spine.findIndex((p) => p[0] < -3); // where the carapace ends and the abdomen begins

    // Antennae, behind everything: two long whips arcing back over the body.
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [k, lift] of [[0, 0], [1, 6]]) {
      const w1 = Math.sin(t * 2.2 + k) * 4, w2 = Math.sin(t * 1.7 + k * 2) * 6;
      ctx.moveTo(33, -9);
      ctx.bezierCurveTo(46, -30 - lift + w1, 12, -46 - lift, -46 + w2, -34 - lift + w2 * 0.5);
    }
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = shade(c.accent, -0.3);
    ctx.stroke();

    // Walking legs under the carapace and swimmerets under the abdomen, each batched into one stroke.
    ctx.beginPath();
    for (let i = 2; i < ic; i += 2) {
      const [x, y] = belly[i], kick = Math.sin(t * 3 + i) * 1.5;
      ctx.moveTo(x, y - 1);
      ctx.lineTo(x + 3 + kick, y + 6);
      ctx.lineTo(x + 1 + kick, y + 11);
    }
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = shade(c.accent, -0.25);
    ctx.stroke();
    ctx.beginPath();
    for (let i = ic + 1, k = 0; i < N - 4; i += 3, k++) {
      const [x, y] = belly[i], [nx, ny] = norm[i], s = Math.sin(t * 10 - k * 0.9) * 3;
      ctx.moveTo(x + nx, y + ny);
      ctx.lineTo(x - nx * 7 + s, y - ny * 7);
    }
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = c.accent;
    ctx.stroke();

    // Tail fan: five lobes spread from the last segment, flicking a little.
    const end = spine[N], pre = spine[N - 2];
    ctx.save();
    ctx.translate(end[0], end[1]);
    ctx.rotate(Math.atan2(end[1] - pre[1], end[0] - pre[0]) + Math.sin(t * 3) * 0.12);
    ctx.beginPath();
    for (const a of [-0.75, -0.38, 0, 0.38, 0.75]) {
      const L = a === 0 ? 13 : 11.5;
      ctx.moveTo(-1, 0);
      ctx.quadraticCurveTo(Math.cos(a - 0.2) * L, Math.sin(a - 0.2) * L, Math.cos(a) * L, Math.sin(a) * L);
      ctx.quadraticCurveTo(Math.cos(a + 0.2) * L, Math.sin(a + 0.2) * L, -1, 0);
    }
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c, 1.2);
    ctx.restore();

    // Abdomen, then its segment bands.
    ctx.beginPath();
    ctx.moveTo(back[0][0], back[0][1]);
    for (const p of back) ctx.lineTo(p[0], p[1]);
    for (let i = N; i >= 0; i--) ctx.lineTo(belly[i][0], belly[i][1]);
    ctx.closePath();
    ctx.fillStyle = bodyGradient(ctx, c, -20, 14);
    ctx.fill();
    outline(ctx, c, 2);
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    for (let i = ic + 2; i < N - 1; i += 4) {
      const [nx, ny, w] = norm[i];
      ctx.moveTo(spine[i][0] + nx * w * 1.2, spine[i][1] + ny * w * 1.2);
      ctx.lineTo(spine[i][0] - nx * w * 1.2, spine[i][1] - ny * w * 1.2);
    }
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.65;
    ctx.stroke();
    ctx.restore();

    // Carapace over the front, with a serrated rostrum running forward off its top.
    ctx.beginPath();
    ctx.moveTo(belly[0][0] + 2, belly[0][1] - 1);
    ctx.lineTo(back[0][0] + 3, back[0][1] - 1);
    // rostrum: saw teeth along its top edge out to the tip, then back along its smooth underside
    const r0 = [back[0][0] + 1, back[0][1] - 1], tip = [49, -16];
    for (let i = 1; i <= 4; i++) {
      const u = i / 5;
      ctx.lineTo(r0[0] + (tip[0] - r0[0]) * (u - 0.1), r0[1] + (tip[1] - r0[1]) * (u - 0.1) - 3);
      ctx.lineTo(r0[0] + (tip[0] - r0[0]) * u, r0[1] + (tip[1] - r0[1]) * u);
    }
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(r0[0] + 6, r0[1] + 3);
    for (let i = 0; i <= ic; i++) ctx.lineTo(back[i][0] + norm[i][0] * 1.2, back[i][1] + norm[i][1] * 1.2);
    ctx.lineTo(belly[ic][0] + 1, belly[ic][1]);
    for (let i = ic; i >= 0; i--) ctx.lineTo(belly[i][0], belly[i][1] + 0.5);
    ctx.closePath();
    ctx.fillStyle = bodyGradient(ctx, c, -20, 6);
    ctx.fill();
    outline(ctx, c, 2);

    // Eye on a short stalk.
    ctx.beginPath();
    ctx.moveTo(26, -7);
    ctx.lineTo(31, -12);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = shade(c.body, -0.3);
    ctx.stroke();
    eye(ctx, 32, -13, 5, opts);
  }

  // ---- Anglerfish -------------------------------------------------------------------------------------------
  // Big round head and jutting underbite full of fangs, a glowing lure on a stalk, small tail. Anatomy is
  // softened to match the others: player colors instead of deep-sea black, and a normal-sized eye.
  function angler(ctx, c, t, opts) {
    ctx.save();
    ctx.translate(-34, 0);
    ctx.rotate(Math.sin(t * 5) * 0.3);
    ctx.beginPath();
    ctx.moveTo(3, 0);
    ctx.quadraticCurveTo(-7, -4, -15, -15);
    ctx.quadraticCurveTo(-10, 0, -15, 15);
    ctx.quadraticCurveTo(-7, 4, 3, 0);
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c);
    ctx.restore();

    // Spiny little dorsal fin.
    ctx.beginPath();
    ctx.moveTo(-24, -14);
    ctx.lineTo(-21, -25);
    ctx.lineTo(-17, -18);
    ctx.lineTo(-13, -28);
    ctx.lineTo(-9, -21);
    ctx.lineTo(-5, -28);
    ctx.lineTo(-2, -22);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c, 1.2);

    const gape = 2 + Math.sin(t * 1.5) * 2;
    ctx.beginPath();
    ctx.moveTo(-36, -3);
    ctx.bezierCurveTo(-24, -20, -6, -31, 12, -28);
    ctx.bezierCurveTo(26, -26, 34, -15, 35, -5);
    ctx.lineTo(41, 3 + gape);
    ctx.bezierCurveTo(40, 22, 10, 31, -10, 24);
    ctx.bezierCurveTo(-22, 20, -30, 10, -36, 3);
    ctx.closePath();
    ctx.fillStyle = bodyGradient(ctx, c, -30, 28);
    ctx.fill();
    outline(ctx, c, 2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (const [x, y, s] of [[-14, -12, 3.5], [-2, -20, 2.5], [-22, -2, 3], [-6, 8, 2.5], [4, -10, 2]]) {
      ctx.moveTo(x + s, y);
      ctx.arc(x, y, s, 0, TAU);
    }
    ctx.fill();
    ctx.restore();

    // Mouth: a dark wedge with fangs down from the upper jaw and up from the jutting lower jaw.
    const up = [35, -4], corner = [13, 4], low = [41, 4 + gape];
    ctx.beginPath();
    ctx.moveTo(up[0], up[1]);
    ctx.lineTo(corner[0], corner[1]);
    ctx.lineTo(low[0], low[1]);
    ctx.closePath();
    ctx.fillStyle = shade(c.body, -0.8);
    ctx.fill();
    fangs(ctx, corner, up, 4, 5.5);
    fangs(ctx, low, corner, 5, 6.5);
    ctx.beginPath();
    ctx.moveTo(up[0], up[1]);
    ctx.lineTo(corner[0], corner[1]);
    ctx.lineTo(low[0], low[1]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = shade(c.body, -0.7);
    ctx.stroke();

    ctx.save();
    ctx.translate(-4, 12);
    ctx.rotate(0.5 + Math.sin(t * 5) * 0.3);
    ctx.beginPath();
    ctx.ellipse(-7, 0, 10, 4.5, 0, 0, TAU);
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();

    blindEye(ctx, 17, -14, 5.5, opts);

    // The lure: a stalk off the forehead with a glowing bulb that bobs and pulses.
    const ex = 40 + Math.sin(t * 1.3) * 2.5, ey = -37 + Math.sin(t * 2.1) * 2;
    ctx.beginPath();
    ctx.moveTo(12, -28);
    ctx.quadraticCurveTo(22, -52, ex, ey);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = shade(c.body, -0.45);
    ctx.stroke();
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    const glow = ctx.createRadialGradient(ex, ey, 1, ex, ey, 12 * pulse);
    glow.addColorStop(0, shade(c.accent, 0.6));
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(ex, ey, 12 * pulse, 0, TAU);
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.6, 0, TAU);
    ctx.fillStyle = shade(c.accent, 0.55);
    ctx.fill();
    outline(ctx, c, 1);
  }

  // A blind eye: milky white with a faint, filmed-over pupil that doesn't follow anything. Knocked out it still
  // shows the shared X, so players can read the state.
  function blindEye(ctx, x, y, r, opts) {
    if (opts.dazed) return eye(ctx, x, y, r, opts);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = "#dfe8ea";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.1, y + r * 0.08, r * 0.48, 0, TAU);
    ctx.fillStyle = "rgba(90,110,120,.35)";
    ctx.fill();
    // a milky film across the top
    ctx.beginPath();
    ctx.ellipse(x - r * 0.15, y - r * 0.3, r * 0.6, r * 0.32, -0.3, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fill();
  }

  // ---- Ray ------------------------------------------------------------------------------------------------
  // Side-on: a thin flat body and whip tail, with the wing seen edge-on as a sheet that flaps up and down. Its
  // pale underside shows on the upstroke and its back on the downstroke. No teeth; one horn lobe at the front.
  function ray(ctx, c, t, opts) {
    const ph = t * 3;
    const s1 = Math.sin(ph), s2 = Math.sin(ph - 0.7);
    const tipY = -38 * s2, midY = -20 * s1;

    ctx.beginPath();
    ctx.moveTo(-26, 1);
    ctx.bezierCurveTo(-38, 1 + Math.sin(ph - 1) * 3, -48, Math.sin(ph - 1.6) * 5, -60, 2 + Math.sin(ph - 2.2) * 6);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = shade(c.body, -0.25);
    ctx.stroke();

    // The wing: a bowed leading edge out to a swept-back tip that lags the root, and a hollow trailing edge.
    const leading = (k, dy) => {
      ctx.moveTo(24, -1 + dy);
      ctx.bezierCurveTo(17, midY * k - 3 + dy, 2, tipY * k * 0.95 + dy, -11, tipY * k + dy);
    };
    const wing = (k, dy) => {
      ctx.beginPath();
      leading(k, dy);
      ctx.bezierCurveTo(-13, tipY * k * 0.55 + dy, -17, tipY * k * 0.2 + dy, -28, -0.5 + dy);
      ctx.closePath();
    };
    // Far wing, peeking out behind: we look from slightly above, so it sits a little higher.
    wing(0.85, -2.5);
    ctx.fillStyle = shade(c.body, -0.35);
    ctx.fill();
    outline(ctx, c, 1.2);

    ctx.beginPath();
    ctx.moveTo(-28, 0);
    ctx.quadraticCurveTo(0, -10, 30, -6);
    ctx.quadraticCurveTo(39, -5, 39, 1);
    ctx.quadraticCurveTo(37, 6, 28, 6);
    ctx.quadraticCurveTo(0, 9, -28, 0);
    ctx.closePath();
    ctx.fillStyle = bodyGradient(ctx, c, -8, 7);
    ctx.fill();
    outline(ctx, c, 2);

    // A horn lobe (cephalic fin) curling forward from the bottom of the head.
    ctx.beginPath();
    for (const [dy, a] of [[2, 1]]) {
      ctx.moveTo(33, dy - 2);
      ctx.quadraticCurveTo(44, dy - 2 + a * 2, 46, dy + a * 4 + Math.sin(t * 2 + a) * 1);
      ctx.quadraticCurveTo(41, dy + a * 2, 33, dy + 2);
    }
    ctx.fillStyle = c.accent;
    ctx.fill();
    outline(ctx, c, 1.2);

    // Near wing: underside showing on the upstroke, back on the downstroke.
    wing(1, 0);
    ctx.fillStyle = s2 > 0 ? shade(c.body, 0.35) : c.body;
    ctx.fill();
    outline(ctx, c, 1.6);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (const [u, v, s] of [[0.35, 0.45, 2.6], [0.6, 0.6, 2.2], [0.5, 0.25, 2], [0.75, 0.35, 1.8]]) {
      const x = 24 - 32 * u, y = tipY * v;
      ctx.moveTo(x + s, y);
      ctx.arc(x, y, s, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    leading(1, 0);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = c.accent;
    ctx.stroke();

    eye(ctx, 32, -2.5, 4.2, opts);
  }

  // ---- School of small fish ---------------------------------------------------------------------------------
  // 16 little fish milling in a tight cluster, led by one slightly bigger fish at the front that carries the
  // shared eye (so dazed and glance work) and the crown. Each depth layer is batched into one outline stroke, one
  // tail fill, one body fill, one belly fill and one eye fill, however many fish there are.
  // If the school makes a slow TV PC stutter, a cheaper version would pre-draw each little fish once to an
  // offscreen canvas and stamp copies of it.
  const layouts = new Map();
  function layout(n) {
    if (layouts.has(n)) return layouts.get(n);
    const hash = (x) => { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); };
    const fish = [];
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt((i + 0.5) / n), a = i * 2.39996;
      fish.push({ bx: r * Math.cos(a) * 34 - 4, by: r * Math.sin(a) * 21, z: hash(i * 12.9898 + 1),
        k: 0.85 + 0.3 * hash(i * 78.233 + 2), ph: i * 2.1 });
    }
    layouts.set(n, fish);
    return fish;
  }
  const SCHOOL_SIZE = 16;

  function school(ctx, c, t, opts) {
    // Loosen while dazed, bunch up and press forward in a fight.
    const spread = (opts.dazed ? 1.3 : 1) * (1 - 0.2 * (opts.lean || 0));
    const back = [], front = [];
    for (const f of layout(SCHOOL_SIZE)) {
      const x = f.bx * spread + Math.sin(t * 0.8 + f.ph) * 4 + (opts.lean || 0) * 4;
      const y = f.by * spread + Math.cos(t * 1.1 + f.ph * 1.3) * 3;
      (f.z < 0.45 ? back : front).push({ x, y, k: f.k * (f.z < 0.45 ? 0.82 : 1), ph: f.ph });
    }
    shoal(ctx, c, t, back, shade(c.body, -0.3), shade(c.accent, -0.3), false);
    shoal(ctx, c, t, front, c.body, c.accent, true);
    // The leader holds still at the front of the box, so its crown (a fixed spot in CROWN_AT) stays on it.
    const L = { x: 33, y: -2, k: 1.35, ph: 0 };
    shoal(ctx, c, t, [L], c.body, c.accent, false);
    ctx.beginPath();
    ctx.moveTo(L.x + 4.6, L.y + 1.6);
    ctx.lineTo(L.x + 7.8, L.y + 0.8);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = shade(c.body, -0.7);
    ctx.stroke();
    eye(ctx, L.x + 3.6, L.y - 1, 2.4, opts);
  }

  function shoal(ctx, c, t, list, bodyC, tailC, eyes) {
    const bodies = new Path2D(), tails = new Path2D(), bellies = new Path2D();
    for (const { x, y, k, ph } of list) {
      const w = Math.sin(t * 11 + ph) * 2.2 * k;
      tails.moveTo(x - 4 * k, y);
      tails.lineTo(x - 12 * k, y - 5 * k + w);
      tails.quadraticCurveTo(x - 9.5 * k, y + w, x - 12 * k, y + 5 * k + w);
      tails.closePath();
      bodies.moveTo(x + 6.5 * k, y);
      bodies.ellipse(x, y, 6.5 * k, 3.3 * k, 0, 0, TAU);
      bellies.moveTo(x + 4.7 * k, y + 1.3 * k);
      bellies.ellipse(x + 0.5 * k, y + 1.3 * k, 4.2 * k, 1.4 * k, 0, 0, TAU);
    }
    // Outline first, twice the width, then the fills over it: overlapping fish merge into one silhouette
    // instead of showing every outline through the fish in front.
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = shade(c.body, -0.6);
    ctx.stroke(tails);
    ctx.stroke(bodies);
    ctx.fillStyle = tailC;
    ctx.fill(tails);
    ctx.fillStyle = bodyC;
    ctx.fill(bodies);
    ctx.fillStyle = shade(c.body, 0.45);
    ctx.globalAlpha = 0.8;
    ctx.fill(bellies);
    ctx.globalAlpha = 1;
    if (!eyes) return;
    const whites = new Path2D(), pupils = new Path2D();
    for (const { x, y, k } of list) {
      whites.moveTo(x + 4.6 * k, y - 0.6 * k);
      whites.arc(x + 3.3 * k, y - 0.6 * k, 1.3 * k, 0, TAU);
      pupils.moveTo(x + 4.3 * k, y - 0.5 * k);
      pupils.arc(x + 3.6 * k, y - 0.5 * k, 0.7 * k, 0, TAU);
    }
    ctx.fillStyle = "#fff";
    ctx.fill(whites);
    ctx.fillStyle = "#151515";
    ctx.fill(pupils);
  }

  const DRAW = { fish, eel, puffer, squid, seahorse, cuttlefish, prawn, angler, ray, school };

  // The facing for a monster swimming in direction dir (1 = right, -1 = left). Squid swim
  // mantle first, like real ones, so they face away from where they're going; in a fight
  // they still turn their tentacles toward the foe. swimFace(shape, 1) is which end leads
  // while swimming (1 = head, -1 = tail); pass it to draw() as opts.lead so the eyes look
  // that way, and flip the tilt with it so the leading end points where it's going.
  function swimFace(shape, dir) {
    return shape === "squid" ? -dir : dir;
  }

  // Where last week's champion wears its crown on each shape, in the shape's own units (facing right): the crown's
  // base centre, its tilt (radians, following the head's curve) and scale. The seahorse's covers its coronet.
  const CROWN_AT = {
    fish: { x: 23, y: -18.5, tilt: 0.36, s: 1 },
    eel: { x: 41, y: -12.5, tilt: 0.12, s: 0.85 },
    puffer: { x: 5, y: -31.5, tilt: 0.12, s: 1.05 },
    squid: { x: 11, y: -13.5, tilt: 0.08, s: 0.85 },
    seahorse: { x: 5.5, y: -37, tilt: 0.25, s: 0.85 },
    cuttlefish: { x: 10, y: -12, tilt: 0.05, s: 0.85 },
    prawn: { x: 14, y: -17.5, tilt: -0.1, s: 0.8 },
    angler: { x: 2, y: -29.5, tilt: -0.08, s: 0.9 }, // behind the lure's stalk
    ray: { x: 31, y: -6, tilt: 0, s: 0.7 },
    school: { x: 33, y: -5, tilt: 0.05, s: 0.65 }, // on the leader fish
  };

  // A small gold crown: three points with pearls, a band and a red jewel. Base centre at (0, 0), pointing up.
  function crownShape(ctx) {
    const g = ctx.createLinearGradient(0, -14, 0, 0);
    g.addColorStop(0, "#fff0a0");
    g.addColorStop(0.45, "#ffcc33");
    g.addColorStop(1, "#d99a00");
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(-10, -11);
    ctx.lineTo(-5, -6);
    ctx.lineTo(0, -13);
    ctx.lineTo(5, -6);
    ctx.lineTo(10, -11);
    ctx.lineTo(9, 0);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#5c3d00";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9.3, -3.2);
    ctx.lineTo(9.3, -3.2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(92,61,0,0.7)";
    ctx.stroke();
    ctx.fillStyle = "#fffbe8";
    ctx.strokeStyle = "#5c3d00";
    ctx.lineWidth = 0.9;
    for (const [x, y] of [[-10, -11], [0, -13], [10, -11]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -1.6, 1.8, 0, TAU);
    ctx.fillStyle = "#e8344e";
    ctx.fill();
    ctx.stroke();
  }

  // The crown in the monster's own coordinates (same transform as draw()), so it scales, turns, rolls and tilts
  // with it. belly (0..1, where flip = cos(belly * PI)): while knocked out the crown drifts off the head along the
  // head's outward direction with a slight wobble, and settles back as the monster rights itself.
  const DEG = 180 / Math.PI;
  function crown(ctx, look, x, y, size, f, v, t, opts) {
    const a = CROWN_AT[look.shape] || CROWN_AT.fish;
    const s = size / 100;
    const belly = clamp01(opts.belly ?? Math.acos(Math.max(-1, Math.min(1, opts.flip ?? 1))) / Math.PI);
    let m = new DOMMatrix().translate(x, y).scale(f * s, v * s);
    if (opts.tilt) m = m.rotate(opts.tilt * DEG);
    if (look.shape === "seahorse") m = m.rotate(((opts.lean || 0) * 0.45 + Math.sin(t * 1.6) * 0.05) * DEG);
    m = m.translate(a.x, a.y).rotate(a.tilt * DEG);
    if (belly > 0) {
      const p = m.transformPoint(new DOMPoint(0, 0)), u = m.transformPoint(new DOMPoint(0, -10));
      const len = Math.hypot(u.x - p.x, u.y - p.y) || 1;
      const d = Math.sin((belly * Math.PI) / 2) * size * 0.16 + Math.sin(t * 3) * belly * size * 0.015;
      m = new DOMMatrix().translate(((u.x - p.x) / len) * d, ((u.y - p.y) / len) * d).multiply(m)
        .rotate(belly * 0.35 * Math.sin(t * 2.3) * DEG);
    }
    ctx.save();
    ctx.setTransform(ctx.getTransform().multiply(m));
    ctx.scale(a.s, a.s);
    ctx.lineJoin = "round";
    crownShape(ctx);
    ctx.restore();
  }
  const clamp01 = (n) => Math.max(0, Math.min(1, n || 0));

  // face: 1 = facing right, -1 = facing left; values between squash the
  // monster horizontally, which reads as turning around.
  // opts.crown: also draw the champion's crown on its head (see crown()); opts.belly feeds its knock-out drift.
  function draw(ctx, look, x, y, size, face, t, opts = {}) {
    const c = {
      body: (look.colors && look.colors.body) || "#3a8fd8",
      accent: (look.colors && look.colors.accent) || "#ffb02e",
    };
    const s = size / 100;
    const f = Math.abs(face) < 0.06 ? 0.06 * Math.sign(face || 1) : face;
    // flip: 1 = upright, -1 = upside down (belly-up); values between squash it vertically, like rolling over.
    // lead: which end the eyes look toward, 1 = head (the default), -1 = tail; values between glance across.
    // lean: 0 = swimming, 1 = in a fight; only the seahorse uses it, to tip forward and charge.
    const flip = opts.flip ?? 1;
    const v = Math.abs(flip) < 0.06 ? 0.06 * Math.sign(flip || 1) : flip;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f * s, v * s);
    if (opts.tilt) ctx.rotate(opts.tilt);
    ctx.lineJoin = "round";
    (DRAW[look.shape] || fish)(ctx, c, t, opts);
    ctx.restore();
    if (opts.crown) crown(ctx, look, x, y, size, f, v, t, opts);
  }

  return { SHAPES, draw, shade, swimFace };
})();
