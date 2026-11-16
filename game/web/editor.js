// Fish Workshop: create a fish or change how yours looks. Fighting styles are dealt by the game each
// week, so the style card is read-only. The server checks every rule again on save, so this page only needs
// to be helpful, not authoritative.
(() => {
  "use strict";

  const NEW = "__new__";
  const STORE_KEY = "battlefish.monsterId";
  const BODY_PRESETS = ["#3a8fd8", "#2bb673", "#e2513c", "#8e5bd8", "#f2a93b", "#e85d9a", "#35c4c4", "#6b7b8c"];
  const ACCENT_PRESETS = ["#ffb02e", "#ffe14d", "#ff5f5f", "#7cf0c5", "#b48cff", "#ffffff", "#ff9ad5", "#1d2b3a"];
  const fmt = (v, digits) => Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
  const DERIVED_ROWS = [
    ["max_hp", "Max HP", (v) => fmt(v, 0)],
    ["damage", "Damage per hit", (v) => fmt(v, 1)],
    ["attack_rate", "Attacks per second", (v) => fmt(v, 2)],
    ["defense", "Damage blocked per hit", (v) => fmt(v, 1)],
    ["evasion", "Dodge chance", (v) => `${fmt(v * 100, 1)}%`],
    ["regen_combat", "Regeneration in fights", (v) => `${fmt(v, 1)} HP/s`],
    ["regen_idle", "Regeneration between fights", (v) => `${fmt(v, 1)} HP/s`],
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    who: $("who"), whoNote: $("whoNote"), editor: $("editor"), preview: $("preview"),
    playerField: $("playerField"), player: $("player"), name: $("name"), shapes: $("shapes"),
    body: $("body"), accent: $("accent"), bodyRow: $("bodyRow"), accentRow: $("accentRow"),
    styleCard: $("styleCard"), msg: $("msg"), save: $("save"), undo: $("undo"), record: $("record"),
    pinBox: $("pinBox"), pinTitle: $("pinTitle"), pinText: $("pinText"), pin: $("pin"), pin2: $("pin2"),
    pinBtn: $("pinBtn"), pinCancel: $("pinCancel"), pinMsg: $("pinMsg"),
    newPinField: $("newPinField"), newPin: $("newPin"), newPin2: $("newPin2"),
    changePin: $("changePin"), logout: $("logout"),
    suggestOpen: $("suggestOpen"), suggestBox: $("suggestBox"), suggestForm: $("suggestForm"),
    suggestNameField: $("suggestNameField"), suggestName: $("suggestName"), suggestAs: $("suggestAs"),
    suggestText: $("suggestText"), suggestCount: $("suggestCount"), suggestMsg: $("suggestMsg"),
    suggestSend: $("suggestSend"), suggestCancel: $("suggestCancel"),
  };
  const PIN_MODES = {
    needed: { title: "Enter your PIN", button: "Unlock",
      text: "Only this fish's owner can open it. Not yours? Pick your own name above." },
    unset: { title: "Set a PIN to claim this fish", button: "Set PIN",
      text: "This fish doesn't have a PIN yet (if it had one, an admin has cleared it). Choose a PIN (4 to 8 digits); you'll need it to edit the fish from now on. Not yours? Pick your own name above instead." },
    change: { title: "Change your PIN", button: "Save new PIN", text: "Choose a new PIN (4 to 8 digits)." },
  };

  let rules = null;
  let styleById = {};
  let week = null;          // {started_at, next_reset_at} from /api/state, once fetched
  let champion = null;      // last week's champion's id
  let monster = null;       // the saved monster from the server; null while creating one
  let look = { shape: "fish", colors: { body: BODY_PRESETS[0], accent: ACCENT_PRESETS[0] } };
  let newDirty = false;     // a new monster has been typed into
  let pinMode = null;       // which PIN_MODES entry the PIN box is showing, if any
  let pinFor = null;        // the monster id it's for

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (skill, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${skill.icon}</svg>`;
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const dayText = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const hourText = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "numeric" });

  // Unsaved changes: anything typed into a new fish, or a name or look that differs from the saved one.
  function lookChanged() {
    if (!monster) return false;
    return els.player.value.trim() !== monster.player || els.name.value !== monster.name || look.shape !== monster.shape ||
      look.colors.body !== monster.colors.body || look.colors.accent !== monster.colors.accent;
  }
  const dirty = () => (monster ? lookChanged() : newDirty);

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `The server said ${res.status}.`);
      err.pin = data.pin; // "needed" or "unset" when the monster wants its PIN first
      throw err;
    }
    return data;
  }

  function showMsg(text, kind = "error") {
    els.msg.className = `msg ${kind}`;
    els.msg.textContent = text;
  }

  function storeGet(key = STORE_KEY) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(v, key = STORE_KEY) {
    try { localStorage.setItem(key, v); } catch (e) { /* private window etc. */ }
  }

  // The week's dates and last week's champion. The style card is still useful without them.
  async function loadWeek() {
    try {
      const s = await api("/api/state");
      week = s.week || null;
      champion = s.champion || null;
    } catch (e) {
      /* keep what we had */
    }
  }

  // ---- who are you ---------------------------------------------------------

  async function loadWhoList(selected) {
    const list = await api("/api/monsters");
    els.who.innerHTML = `<option value="">Choose…</option>` +
      list.map((m) => `<option value="${esc(m.id)}"></option>`).join("") +
      `<option value="${NEW}">I'm new here</option>`;
    // Names are set as text, not HTML.
    list.forEach((m, i) => { els.who.options[i + 1].textContent = `${m.player} (${m.name})`; });
    els.who.value = list.some((m) => m.id === selected) || selected === NEW ? selected : "";
  }

  async function onWho() {
    showMsg("");
    hidePin();
    const v = els.who.value;
    if (!v) {
      els.editor.hidden = true;
      return;
    }
    if (v === NEW) {
      startNew();
      els.editor.hidden = false;
    } else {
      els.editor.hidden = !(await loadMonster(v));
    }
  }

  function startNew() {
    monster = null;
    newDirty = false;
    look = { shape: "fish", colors: { body: pick(BODY_PRESETS), accent: pick(ACCENT_PRESETS) } };
    els.player.value = "";
    els.name.value = "";
    els.newPin.value = els.newPin2.value = "";
    els.playerField.hidden = els.newPinField.hidden = false;
    els.changePin.hidden = els.logout.hidden = els.undo.hidden = true;
    els.save.textContent = "Add to the tank";
    els.record.textContent = "";
    syncLook();
    renderStyleCard();
    els.whoNote.textContent = "Make your fish, then add it to the tank. The game deals it a fighting style.";
    els.player.focus();
  }

  // Shows the monster and returns true, or asks for its PIN and returns false.
  async function loadMonster(id) {
    try {
      const [m] = await Promise.all([api(`/api/monster/${encodeURIComponent(id)}`), loadWeek()]);
      applySaved(m);
      storeSet(id);
      els.whoNote.textContent = "Your fish's look can change any time. Its fighting style is dealt each week.";
      return true;
    } catch (e) {
      if (e.pin) showPin(id, e.pin);
      else showPin(null, null, e.message);
      return false;
    }
  }

  function applySaved(m) {
    monster = m;
    newDirty = false;
    els.newPinField.hidden = true;  // a player can still correct their own name; the server keeps names unique
    els.changePin.hidden = els.logout.hidden = els.undo.hidden = false;
    els.save.textContent = "Save look";
    look = { shape: m.shape, colors: { ...m.colors } };
    els.player.value = m.player;
    els.name.value = m.name;
    syncLook();
    renderStyleCard();
  }

  // ---- PIN -----------------------------------------------------------------------

  // With no mode, the box only shows an error (e.g. the monster was deleted).
  function showPin(id, mode, error = "") {
    pinMode = mode;
    pinFor = id;
    const m = PIN_MODES[mode];
    els.pinBox.hidden = false;
    for (const el of [els.pinTitle, els.pinText, els.pin, els.pinBtn]) el.hidden = !m;
    els.pin2.hidden = !m || mode === "needed";
    els.pinCancel.hidden = mode !== "change";
    if (m) {
      els.pinTitle.textContent = m.title;
      els.pinText.textContent = m.text;
      els.pinBtn.textContent = m.button;
    }
    els.pin.value = els.pin2.value = "";
    pinError(error);
    if (m) els.pin.focus();
  }

  function hidePin() {
    pinMode = pinFor = null;
    els.pinBox.hidden = true;
  }

  function pinError(text) {
    els.pinMsg.className = "msg error";
    els.pinMsg.textContent = text;
  }

  async function submitPin(ev) {
    ev.preventDefault();
    const pin = els.pin.value.trim();
    if (pinMode !== "needed" && pin !== els.pin2.value.trim()) return pinError("Those PINs don't match.");
    els.pinBtn.disabled = true;
    try {
      await api(pinMode === "needed" ? "/api/monster/unlock" : "/api/monster/pin", { id: pinFor, pin });
      const done = pinMode === "change" ? "PIN changed." : "Unlocked. Save again to keep your changes.";
      // If the editor is already open on this monster (a PIN change, or a login that ran out mid-edit),
      // keep the unsaved edits instead of reloading.
      const keepEdits = !els.editor.hidden && monster && monster.id === pinFor;
      const id = pinFor;
      hidePin();
      if (keepEdits) showMsg(done, "ok");
      else els.editor.hidden = !(await loadMonster(id));
    } catch (e) {
      pinError(e.message);
    } finally {
      els.pinBtn.disabled = false;
    }
  }

  async function logout() {
    if (dirty() && !confirm("Log out without saving your changes?")) return;
    try {
      await api("/api/monster/logout", {});
    } catch (e) {
      return showMsg(e.message);
    }
    monster = null;
    els.who.value = "";
    await onWho();
    els.whoNote.textContent = "Logged out. Pick your name and enter your PIN to edit your fish again.";
  }

  // ---- look ----------------------------------------------------------------------

  function buildLookControls() {
    els.shapes.innerHTML = "";
    for (const s of MonsterArt.SHAPES) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.shape = s.key;
      b.innerHTML = `<canvas></canvas><span>${esc(s.label)}</span>`;
      b.addEventListener("click", () => { look.shape = s.key; edited(); syncLook(); });
      els.shapes.appendChild(b);
    }
    for (const [row, input, presets, key] of [[els.bodyRow, els.body, BODY_PRESETS, "body"], [els.accentRow, els.accent, ACCENT_PRESETS, "accent"]]) {
      for (const c of presets) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "preset";
        b.style.background = c;
        b.title = c;
        b.setAttribute("aria-label", `${key} color ${c}`);
        b.addEventListener("click", () => { look.colors[key] = c; edited(); syncLook(); });
        row.appendChild(b);
      }
      input.addEventListener("input", () => { look.colors[key] = input.value; edited(); });
    }
  }

  function syncLook() {
    els.body.value = look.colors.body;
    els.accent.value = look.colors.accent;
    for (const b of els.shapes.children) b.setAttribute("aria-pressed", String(b.dataset.shape === look.shape));
    syncButtons();
  }

  function syncButtons() {
    if (monster) {
      const changed = lookChanged();
      els.save.disabled = els.undo.disabled = !changed;
    } else {
      els.save.disabled = false;
    }
  }

  function edited() {
    if (!monster) newDirty = true;
    showMsg("");
    syncButtons();
  }

  function fitCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [g, c.clientWidth, c.clientHeight];
  }

  function water(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1386a6");
    grad.addColorStop(1, "#05263d");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  function animate() {
    // With reduced motion the monster holds still, facing right.
    const t = reducedMotion() ? 0 : performance.now() / 1000;
    if (!els.editor.hidden) {
      const [g, w, h] = fitCanvas(els.preview);
      water(g, w, h);
      // Swim slowly back and forth, turning at each end.
      const p = (t * 0.12) % 2;
      const face = MonsterArt.swimFace(look.shape, Math.max(-1, Math.min(1, Math.cos(p * Math.PI) * 6)));
      const x = w / 2 + Math.sin(p * Math.PI) * w * 0.18;
      MonsterArt.draw(g, look, x, h / 2 + Math.sin(t * 1.3) * h * 0.03, Math.min(w * 0.5, h * 0.75), face, t,
        { lead: MonsterArt.swimFace(look.shape, 1), crown: !!(monster && champion === monster.id) });
      for (const b of els.shapes.children) {
        const [sg, sw, sh] = fitCanvas(b.querySelector("canvas"));
        sg.clearRect(0, 0, sw, sh);
        MonsterArt.draw(sg, { shape: b.dataset.shape, colors: look.colors }, sw / 2, sh / 2, Math.min(sw * 0.8, sh), 1, t);
      }
    }
    requestAnimationFrame(animate);
  }

  // ---- fighting style ---------------------------------------------------------------

  function renderStyleCard() {
    const st = monster && styleById[monster.style];
    if (!st) {
      // Not in the tank yet (or a style this page doesn't know, which a reload fixes).
      els.styleCard.innerHTML = `<div class="sc-head"><h2>Fighting style</h2>` +
        `<span class="elo">${monster ? `Elo<b>${monster.elo}</b>` : "Elo starts at 1500"}</span></div>` +
        `<div class="pending">Your fish is dealt a <b>fighting style</b> when it joins the tank: a set of stats and ` +
        `skills it fights with until the next weekly shuffle, ${week ? `${esc(new Date(week.next_reset_at * 1000).toLocaleDateString(undefined, { weekday: "long" }))} around ${esc(hourText(week.next_reset_at))}` : "Monday morning"}. Every fish's style is ` +
        `shuffled each week, so everyone gets a turn with each one.</div>`;
      els.record.textContent = "";
      return;
    }
    const build = monster.build || st.build;
    const until = week
      ? `<p class="until">Dealt ${esc(dayText(Math.max(week.started_at, monster.created_at || 0)))}. Next shuffle: ${esc(dayText(week.next_reset_at))}, ` +
        `around ${esc(hourText(week.next_reset_at))}.</p>`
      : "";
    const skills = rules.skills_enabled && st.skills.length
      ? `<p class="sub">Skills</p><div class="skills">${st.skills.map((s) =>
        `<div class="skill">${icon(s)}<div><div class="nm">${esc(s.name)}</div><div class="bl">${esc(s.blurb)}</div></div></div>`).join("")}</div>`
      : "";
    const derived = monster.derived
      ? `<details><summary>In combat, before this week's adjustments</summary><table class="derived">` +
        DERIVED_ROWS.filter(([key]) => monster.derived[key] != null)
          .map(([key, label, show]) => `<tr><td>${label}</td><td class="num">${esc(show(monster.derived[key]))}</td></tr>`).join("") +
        `</table></details>`
      : "";
    els.styleCard.innerHTML = `<div class="sc-head"><h2>Fighting style this week</h2><span class="elo">Elo<b>${monster.elo}</b></span></div>
      ${champion && champion === monster.id ? `<p class="champ">👑 Last week's champion</p>` : ""}
      <div class="identity"><span class="cname">${esc(st.name)}</span><span class="role">${esc(st.role)}</span></div>
      <p class="blurb">${esc(st.blurb)}</p>
      ${until}
      <div class="sc-grid">
        <div><p class="sub">Stat Distribution</p>
          ${rules.stats.map((s) => {
            const v = Math.round(build[s.key] || 0);
            return `<div class="stat"><span class="name">${esc(s.label)}</span><span class="bar"><i style="width:${v}%"></i></span>` +
              `<span class="v">${v}%</span><span class="desc">${esc(s.blurb)}</span></div>`;
          }).join("")}
        </div>
        <div>${skills}${derived}</div>
      </div>`;
    const r = monster.record;
    els.record.textContent = `${plural(r.wins, "win", "wins")}, ${plural(r.losses, "loss", "losses")} this week`;
  }

  // The slot machine: style names flick past, slowing down, and land on the one the game dealt.
  function showReveal(m, done) {
    const st = styleById[m.style];
    if (!st) return done();
    const el = document.createElement("div");
    el.className = "reveal";
    const skills = rules.skills_enabled && st.skills.length
      ? `<span class="sk" data-after hidden>${st.skills.map((s) => `<span>${icon(s)}${esc(s.name)}</span>`).join("")}</span>`
      : "";
    const until = week ? `Until the next shuffle, ${new Date(week.next_reset_at * 1000).toLocaleDateString(undefined, { weekday: "long" })} ` +
      `around ${hourText(week.next_reset_at)}.` : "Until the next weekly shuffle.";
    el.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Your fighting style">
      <span class="small">${esc(m.name || "Your fish")} joins the tank as a…</span>
      <span class="spin" aria-live="polite"></span>
      <span class="role" data-after hidden>${esc(st.role)}</span>
      <span class="small" data-after hidden>${esc(st.blurb)}</span>
      ${skills}
      <span class="small" data-after hidden>${esc(until)}</span>
      <button class="primary" data-after hidden>Let's go</button></div>`;
    document.body.append(el);
    const spin = el.querySelector(".spin"), ok = el.querySelector("button");
    const names = rules.styles.map((s) => s.name);
    const finish = () => {
      spin.textContent = st.name;
      spin.className = "big";
      for (const x of el.querySelectorAll("[data-after]")) x.hidden = false;
      ok.focus();
    };
    if (reducedMotion()) {
      finish();
    } else {
      let i = Math.floor(Math.random() * names.length), delay = 60;
      const tick = () => {
        spin.textContent = names[i++ % names.length];
        delay *= 1.18;
        if (delay > 420) finish(); else setTimeout(tick, delay);
      };
      tick();
    }
    ok.addEventListener("click", () => { el.remove(); done(); });
  }

  // ---- save -----------------------------------------------------------------------------

  async function save() {
    const isNew = !monster;
    if (isNew && els.newPin.value.trim() !== els.newPin2.value.trim()) {
      return showMsg("The two PINs don't match.");
    }
    els.save.disabled = true;
    try {
      const m = await api("/api/monster", {
        id: isNew ? null : monster.id,
        player: els.player.value,
        name: els.name.value,
        shape: look.shape,
        colors: look.colors,
        pin: isNew ? els.newPin.value.trim() : undefined,
      });
      storeSet(m.id);
      await loadWhoList(m.id);
      if (isNew) {
        newDirty = false; // in the tank now, so leaving the page loses nothing
        await loadWeek();
        showReveal(m, () => {
          applySaved(m);
          showMsg("Your fish is in the tank!", "ok");
          els.whoNote.textContent = "Your fish's look can change any time. Its fighting style is dealt each week.";
        });
      } else {
        applySaved(m);
        showMsg("Saved.", "ok");
      }
    } catch (e) {
      showMsg(e.message);
      // The login ran out or the PIN was changed elsewhere: ask for it without losing the edits.
      if (e.pin && monster) showPin(monster.id, e.pin);
    } finally {
      syncButtons();
    }
  }

  function undo() {
    if (!monster) return;
    look = { shape: monster.shape, colors: { ...monster.colors } };
    els.player.value = monster.player;
    els.name.value = monster.name;
    showMsg("");
    syncLook();
  }

  // Elo, the record and (after the Monday reset) the style keep moving while the page is open; pick them up
  // without touching unsaved edits to the look.
  async function refreshMonster() {
    if (!monster || els.editor.hidden) return;
    try {
      const [m] = await Promise.all([api(`/api/monster/${encodeURIComponent(monster.id)}`), loadWeek()]);
      if (!monster || monster.id !== m.id) return;
      for (const key of ["elo", "avg_elo", "record", "style", "style_history", "build", "derived"]) monster[key] = m[key];
      renderStyleCard();
    } catch (e) {
      /* try again next time */
    }
  }

  // ---- suggestion box ------------------------------------------------------

  function openSuggest() {
    // A logged-in player is named by the server, so only ask for a name otherwise.
    els.suggestNameField.hidden = !!monster;
    els.suggestAs.hidden = !monster;
    if (monster) els.suggestAs.textContent = `Sent as ${monster.player}.`;
    showSuggestMsg("");
    els.suggestSend.disabled = false;
    els.suggestCancel.textContent = "Cancel";
    els.suggestBox.showModal();
    els.suggestText.focus();
  }

  function showSuggestMsg(text, kind = "error") {
    els.suggestMsg.className = `msg ${kind}`;
    els.suggestMsg.textContent = text;
  }

  async function sendSuggest(ev) {
    ev.preventDefault();
    els.suggestSend.disabled = true;
    try {
      await api("/api/suggest", { text: els.suggestText.value, name: els.suggestName.value });
      els.suggestText.value = "";
      els.suggestCount.textContent = `0 / ${els.suggestText.maxLength}`;
      els.suggestCancel.textContent = "Close";
      showSuggestMsg("Thanks! Your suggestion was sent.", "ok");
    } catch (e) {
      showSuggestMsg(e.message);
    }
    els.suggestSend.disabled = false;
  }

  async function init() {
    els.suggestOpen.addEventListener("click", openSuggest);
    els.suggestForm.addEventListener("submit", sendSuggest);
    els.suggestCancel.addEventListener("click", () => els.suggestBox.close());
    els.suggestText.addEventListener("input", () => {
      els.suggestCount.textContent = `${els.suggestText.value.length} / ${els.suggestText.maxLength}`;
    });
    try {
      rules = await api("/api/rules");
      styleById = Object.fromEntries(rules.styles.map((s) => [s.id, s]));
      buildLookControls();
      // /editor#new opens a blank monster; /editor#<id> opens that monster.
      const wanted = location.hash === "#new" ? NEW : location.hash.slice(1) || storeGet() || "";
      await loadWhoList(wanted);
      await onWho();
    } catch (e) {
      showMsg(`Couldn't reach the game server: ${e.message}`);
      els.editor.hidden = false;
      return;
    }
    els.who.addEventListener("change", onWho);
    els.save.addEventListener("click", save);
    els.undo.addEventListener("click", undo);
    els.pinBox.addEventListener("submit", submitPin);
    els.pinCancel.addEventListener("click", hidePin);
    els.changePin.addEventListener("click", () => showPin(monster.id, "change"));
    els.logout.addEventListener("click", logout);
    els.name.addEventListener("input", edited);
    for (const input of [els.player, els.newPin, els.newPin2]) input.addEventListener("input", edited);
    window.addEventListener("beforeunload", (ev) => {
      if (dirty()) ev.preventDefault();
    });
    setInterval(refreshMonster, 20000);
    requestAnimationFrame(animate);
  }

  init();
})();
