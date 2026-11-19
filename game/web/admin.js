// Admin page: pause fights, manage fish and the week, edit the ticker, tune settings, reset.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let overview = null;
  let cfgTab = null; // open Settings tab, kept when the form is rebuilt

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/api/admin/login") {
      show("login");
      throw new Error(data.error || "Log in first.");
    }
    if (!res.ok) throw new Error(data.error || `The server said ${res.status}.`);
    return data;
  }

  function msg(text, kind = "error") {
    $("msg").className = `msg ${kind}`;
    $("msg").textContent = text;
  }

  function show(which) {
    $("notConfigured").hidden = which !== "setup";
    $("loginBox").hidden = which !== "login";
    $("panel").hidden = which !== "panel";
    $("logout").hidden = which !== "panel";
  }

  async function act(action, extra = {}, okText = "Done.") {
    try {
      await api("/api/admin/action", { action, ...extra });
      msg(okText, "ok");
      await refresh(action === "update_config");
    } catch (e) {
      msg(e.message);
    }
  }

  // The settings form is only rebuilt on request, so periodic refreshes don't wipe unsaved typing.
  async function refresh(withSettings = false) {
    overview = await api("/api/admin/overview");
    render();
    if (withSettings || !$("cfgForm").children.length) renderSettings();
  }

  // Form 1.0932 -> "+9%", 0.96 -> "−4%".
  function formPct(f) {
    const p = Math.round((Number(f) - 1) * 100);
    return p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : "0%";
  }

  const when = (secs) => new Date(secs * 1000).toLocaleString(undefined,
    { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  function renderWeek() {
    const o = overview;
    const w = o.week;
    const next = when(w.next_reset_at);
    // The server keeps the skipped date as next_reset_at; the reset after it is a week later.
    const after = new Date(w.next_reset_at * 1000);
    after.setDate(after.getDate() + 7);
    $("weekStatus").innerHTML = `Week started ${esc(when(w.started_at))}. `
      + (w.skip ? `<b class="warn">The next reset (${esc(next)}) will be skipped</b>, so this week carries on until ${esc(when(after / 1000))}.`
        : `Next reset ${esc(next)}.`)
      + ` ${o.weeks_saved} past week${o.weeks_saved === 1 ? "" : "s"} saved.`;
    $("skipBtn").textContent = w.skip ? "Don't skip the next reset" : "Skip the next weekly reset";
  }

  function render() {
    const o = overview;
    const secs = Math.round(o.next_fight_at - o.server_time);
    const n = o.fights_in_progress;
    const next = o.paused ? "Fights are paused."
      : secs > 0 ? `Next fight in about ${Math.ceil(secs / 60)} min.` : "Next fight any moment.";
    $("fightStatus").textContent = n ? `${n === 1 ? "A fight is" : `${n} fights are`} in progress. ${next}` : next;
    $("pauseBtn").textContent = o.paused ? "Resume fights" : "Pause fights";

    renderWeek();

    // Leave the table alone while a style dropdown is open, so the 15-second refresh doesn't close it.
    if (document.activeElement && document.activeElement.matches("#monsters select")) return;
    const styleName = (id) => (o.styles.find((st) => st.id === id) || { name: id }).name;
    $("monsters").innerHTML = o.monsters.length ? `<thead><tr><th>Player</th><th>Fish</th><th title="Fighting style this week; changing it lasts until the next weekly reset">Style</th>
        <th class="num" title="Hidden daily form: the multiplier on its stats today, rolled every day at the reset hour (Settings, Week). Hover a value for this week's rolls. Players see them only once the week is over">Form</th>
        <th class="num" title="Elo, and the multiplier on its stat points in fights">Elo</th><th class="num" title="Average of its Elo after each fight this week">Avg Elo</th>
        <th class="num">HP</th><th class="num">W–L</th><th>PIN</th><th></th></tr></thead><tbody>${o.monsters.map((m) => `<tr>
        <td>${esc(m.player)}</td><td>${m.id === o.champion ? '<span title="Champion: won last week">👑</span> ' : ""}${esc(m.name)}${m.in_fight ? ' <span class="muted">(fighting)</span>' : ""}</td>
        <td><select data-style="${m.id}" aria-label="Style for ${esc(m.name)}">${o.styles.map((st) => `<option value="${st.id}"${st.id === m.style ? " selected" : ""}>${esc(st.name)} (${esc(st.role)})</option>`).join("")}${o.styles.some((st) => st.id === m.style) ? "" : `<option selected>${esc(styleName(m.style))}</option>`}</select></td>
        <td class="num" title="${esc((m.forms || []).map(([t, f]) => `${new Date(t * 1000).toLocaleString("en-US", { weekday: "short" })} ${formPct(f)}`).join(", "))}">${formPct(m.form)}</td>
        <td class="num">${m.elo} <span class="muted">(×${m.elo_mult.toFixed(2)})</span></td>
        <td class="num">${m.avg_elo == null ? '<span class="muted">–</span>' : Math.round(m.avg_elo)}</td>
        <td class="num">${Math.round(m.hp)} / ${Math.round(m.max_hp)}</td>
        <td class="num">${m.record.wins}–${m.record.losses}</td>
        <td>${m.has_pin ? `Set <button data-clearpin="${m.id}">Clear</button>` : '<span class="muted">Not set yet</span>'}</td>
        <td class="num"><button class="danger" data-delete="${m.id}">Delete</button></td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="muted">No fish yet.</td></tr></tbody>`;
    for (const sel of document.querySelectorAll("[data-style]")) {
      sel.addEventListener("change", () => {
        const m = o.monsters.find((x) => x.id === sel.dataset.style);
        const to = sel.value;
        sel.blur();
        if (confirm(`Change ${m.name} (${m.player}) from ${styleName(m.style)} to ${styleName(to)} for the rest of this week? Its Elo and record stay.`)) {
          act("set_style", { id: m.id, style: to }, `${m.name} is a ${styleName(to)} until the next weekly reset.`);
        } else {
          sel.value = m.style;
          render();
        }
      });
    }
    for (const b of document.querySelectorAll("[data-clearpin]")) {
      b.addEventListener("click", () => {
        const m = o.monsters.find((x) => x.id === b.dataset.clearpin);
        if (confirm(`Clear the PIN for ${m.name} (${m.player})? The next person to open it in the editor sets a new one, so let ${m.player} know.`)) {
          act("clear_pin", { id: m.id }, `Cleared the PIN for ${m.name}.`);
        }
      });
    }
    for (const b of document.querySelectorAll("[data-delete]")) {
      b.addEventListener("click", () => {
        const m = o.monsters.find((x) => x.id === b.dataset.delete);
        if (confirm(`Delete ${m.name} (${m.player})? This can't be undone. Their past fights stay in the history.`)) {
          act("delete_monster", { id: m.id }, `Deleted ${m.name}.`);
        }
      });
    }
  }

  function renderSettings() {
    const o = overview;
    const groups = {};
    for (const f of o.config) (groups[f.group] = groups[f.group] || []).push(f);
    const names = Object.keys(groups);
    if (!names.includes(cfgTab)) cfgTab = names[0];
    $("cfgTabs").innerHTML = names.map((g) => `<button type="button" role="tab" data-cfgtab="${esc(g)}">${esc(g)}<span class="changed-dot" title="Unsaved changes" hidden></span></button>`).join("");
    $("cfgForm").innerHTML = Object.entries(groups).map(([g, fields]) => `<div class="cfg-group" data-group="${esc(g)}"><h3>${esc(g)}</h3>${fields.map((f) => {
      const off = Number(f.value) !== Number(f.default);
      // A setting with named choices (its value is the choice's index) gets a dropdown instead of a number box.
      const field = f.options
        ? `<select id="cfg-${f.key}" name="${f.key}" data-saved="${f.value}">${f.options.map((o, i) =>
          `<option value="${i}"${i === Number(f.value) ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
        : `<input type="number" id="cfg-${f.key}" name="${f.key}" value="${f.value}" data-saved="${f.value}" step="any" min="${f.min}" max="${f.max}">`;
      const dflt = f.options ? f.options[f.default] : f.default;
      return `
      <div class="cfg" data-find="${esc(`${f.label} ${f.key} ${(f.options || []).join(" ")}`.toLowerCase())}"><label for="cfg-${f.key}">${esc(f.label)}<small${off ? ' class="off-default"' : ""}>Default ${esc(String(dflt))}${off ? " · changed" : ""}</small></label>
      ${field}</div>`;
    }).join("")}</div>`).join("") + '<p class="muted" id="cfgNone" hidden>No settings match.</p>';
    for (const b of $("cfgTabs").children) {
      b.addEventListener("click", () => {
        cfgTab = b.dataset.cfgtab;
        $("cfgFind").value = "";
        showSettings();
      });
    }
    showSettings();
    markEdits();
  }

  // Shows the open tab, or every matching setting while the search box has text.
  function showSettings() {
    const q = $("cfgFind").value.trim().toLowerCase();
    let any = false;
    for (const g of $("cfgForm").querySelectorAll(".cfg-group")) {
      let shown = 0;
      for (const row of g.querySelectorAll(".cfg")) {
        row.hidden = Boolean(q) && !row.dataset.find.includes(q);
        if (!row.hidden) shown++;
      }
      g.hidden = q ? !shown : g.dataset.group !== cfgTab;
      any = any || !g.hidden;
    }
    $("cfgNone").hidden = any;
    for (const b of $("cfgTabs").children) b.setAttribute("aria-selected", !q && b.dataset.cfgtab === cfgTab);
  }

  // Flags fields, tabs, and the Save row with edits that aren't saved yet.
  function markEdits() {
    const edited = new Set();
    let n = 0;
    for (const input of $("cfgForm").querySelectorAll("input, select")) {
      const on = input.value.trim() === "" || Number(input.value) !== Number(input.dataset.saved);
      input.closest(".cfg").classList.toggle("edited", on);
      if (on) {
        n++;
        edited.add(input.closest(".cfg-group").dataset.group);
      }
    }
    for (const b of $("cfgTabs").children) b.querySelector(".changed-dot").hidden = !edited.has(b.dataset.cfgtab);
    $("cfgUnsaved").textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "";
  }

  // ---- ticker -------------------------------------------------------------------------
  // Shown when the server has a ticker. With the "admin" source the items are typed in here; with any other
  // source they come from somewhere else, and this section only says where and what's showing.

  const TICKER_TEXT = [["label", "Label", "Sales calls this week"], ["value", "Value", "142"],
    ["change", "Change", "+12"], ["group", "Group", "Optional heading"]];
  let ticker = null;  // {source, detail, items, limits} from the server
  let tickerRows = []; // the items being edited
  let tickerDirty = false;

  async function loadTicker() {
    ticker = await api("/api/admin/ticker");
    $("tickerSection").hidden = ticker.source === "off";
    if (ticker.source === "off") return;
    const editable = ticker.source === "admin";
    const n = ticker.items.length;
    $("tickerNote").textContent = editable
      ? "Items scroll along the bottom of the aquarium in this order. Only Label is needed. Trend colors the change (or the value): green when it moves the good way, red when it moves the bad way. Items with the same Group are shown together under that heading. An empty list hides the ticker."
      : `The ticker's items come from ${ticker.detail}, so they're changed there, not here. ${n ? `${n} item${n === 1 ? " is" : "s are"} showing now.` : "Nothing is showing yet."}`;
    $("tickerEdit").hidden = !editable;
    if (editable) {
      tickerRows = ticker.items.map((it) => ({ ...it }));
      tickerDirty = false;
      renderTickerRows();
    }
  }

  function renderTickerRows() {
    const sel = (i, key, options, value) => `<select data-i="${i}" data-k="${key}">${options.map(([v, label]) =>
      `<option value="${v}"${(value || "") === v ? " selected" : ""}>${label}</option>`).join("")}</select>`;
    $("tickerTable").innerHTML = tickerRows.length ? `<thead><tr>${TICKER_TEXT.map(([, label]) => `<th>${label}</th>`).join("")}
        <th>Trend</th><th>Good when</th><th></th></tr></thead><tbody>${tickerRows.map((it, i) => `<tr>
        ${TICKER_TEXT.map(([key, label, hint]) => `<td><input type="text" data-i="${i}" data-k="${key}" value="${esc(it[key] || "")}" placeholder="${esc(hint)}" aria-label="${label}" maxlength="${ticker.limits[key]}"></td>`).join("")}
        <td>${sel(i, "trend", [["", "None"], ["up", "Up"], ["down", "Down"]], it.trend)}</td>
        <td>${sel(i, "good", [["up", "Up"], ["down", "Down"]], it.good || "up")}</td>
        <td class="num"><button data-move="${i}" data-by="-1" title="Move up"${i ? "" : " disabled"}>↑</button><button data-move="${i}" data-by="1" title="Move down"${i < tickerRows.length - 1 ? "" : " disabled"}>↓</button><button class="danger" data-remove="${i}">Remove</button></td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="muted">No items. The ticker is hidden until you add one.</td></tr></tbody>`;
    $("tickerAdd").disabled = tickerRows.length >= ticker.limits.items;
    $("tickerUnsaved").textContent = tickerDirty ? "Unsaved changes" : "";
  }

  function tickerEdited() {
    tickerDirty = true;
    $("tickerUnsaved").textContent = "Unsaved changes";
  }

  function initTicker() {
    $("tickerTable").addEventListener("input", (ev) => {
      const el = ev.target.closest("[data-k]");
      if (!el) return;
      tickerRows[Number(el.dataset.i)][el.dataset.k] = el.value;
      tickerEdited();
    });
    $("tickerTable").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.remove != null) {
        tickerRows.splice(Number(b.dataset.remove), 1);
      } else if (b.dataset.move != null) {
        const i = Number(b.dataset.move), j = i + Number(b.dataset.by);
        [tickerRows[i], tickerRows[j]] = [tickerRows[j], tickerRows[i]];
      }
      tickerDirty = true;
      renderTickerRows();
    });
    $("tickerAdd").addEventListener("click", () => {
      tickerRows.push({ label: "", value: "", change: "", trend: "", good: "up", group: "" });
      tickerDirty = true;
      renderTickerRows();
      const inputs = $("tickerTable").querySelectorAll('input[data-k="label"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $("tickerSave").addEventListener("click", async () => {
      try {
        await api("/api/admin/ticker", { items: tickerRows });
        msg("Ticker saved. Open aquariums pick it up within a minute.", "ok");
        await loadTicker();
      } catch (e) {
        msg(e.message);
      }
    });
  }

  async function init() {
    initTicker();
    for (const [id, fn] of Object.entries({
      pauseBtn: () => act(overview.paused ? "resume" : "pause", {}, overview.paused ? "Fights resumed." : "Fights paused."),
      fightNow: () => act("fight_now", {}, "Fight started. Watch the aquarium."),
      healAll: () => act("heal_all", {}, "Every fish is back to full HP."),
      saveCfg: () => {
        const values = {};
        for (const input of $("cfgForm").querySelectorAll("input, select")) values[input.name] = input.value;
        act("update_config", { values }, "Settings saved.");
      },
      defaultsCfg: () => {
        for (const f of overview.config) $(`cfg-${f.key}`).value = f.default;
        markEdits();
        msg("Defaults filled in. Save settings to apply them.", "ok");
      },
      skipBtn: () => {
        const skip = !overview.week.skip;
        act("skip_reset", { skip }, skip ? "The next weekly reset will be skipped." : "The next weekly reset will happen as usual.");
      },
      reshuffle: () => {
        if (confirm("Deal every fish a new style for the rest of this week? Elo, records and form stay.")) {
          act("reshuffle", {}, "Styles reshuffled.");
        }
      },
      resetProgress: () => {
        if (prompt("End the week now, like the Monday reset? This saves the week's standings, crowns its champion, sets everyone's Elo back to 1500, clears records and fight history, and deals new styles. Type END WEEK to confirm.") === "END WEEK") {
          act("reset_progress", {}, "Week ended and new styles dealt. If anyone fought, the week is saved and its champion crowned.");
        }
      },
      resetAll: () => {
        if (prompt("Delete every fish, all fight history and every saved past week? Type DELETE EVERYTHING to confirm.") === "DELETE EVERYTHING") {
          act("reset_all", {}, "Everything has been reset.");
        }
      },
      logout: async () => {
        await api("/api/admin/logout", {});
        show("login");
        msg("");
      },
    })) $(id).addEventListener("click", fn);

    $("cfgForm").addEventListener("input", markEdits);
    $("cfgForm").addEventListener("change", markEdits);
    $("cfgFind").addEventListener("input", showSettings);

    $("loginForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await api("/api/admin/login", { password: $("password").value });
        $("password").value = "";
        msg("");
        show("panel");
        await refresh();
        await loadTicker();
      } catch (e) {
        msg(e.message);
      }
    });

    try {
      const status = await api("/api/admin/status");
      if (!status.configured) return show("setup");
      if (!status.logged_in) return show("login");
      show("panel");
      await refresh();
      await loadTicker();
    } catch (e) {
      msg(`Couldn't reach the game server: ${e.message}`);
    }
    setInterval(() => {
      if (!$("panel").hidden) refresh().catch(() => {});
    }, 15000);
  }

  init();
})();
