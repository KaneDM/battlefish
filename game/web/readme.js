// Shows README.md as the "How to play" page. Handles the Markdown the README
// uses: headings, paragraphs, lists, tables, code blocks, rules, and inline
// code, bold, italics and links. Nested lists aren't supported.
(() => {
  "use strict";

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const LIST_ITEM = /^\s*([-*]|\d+\.)\s+(.*)$/;

  function inline(text) {
    // Pull code spans out first so their contents aren't formatted.
    const codes = [];
    let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
    s = esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  function isBlockStart(line) {
    return /^(#{1,4}\s|```|\||-{3,}\s*$)/.test(line) || LIST_ITEM.test(line);
  }

  function render(md) {
    const lines = md.replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) {
        i++;
      } else if (line.startsWith("```")) {
        const code = [];
        for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
        i++;
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        const n = m[1].length;
        out.push(`<h${n} id="${slug(m[2])}">${inline(m[2])}</h${n}>`);
        i++;
      } else if (/^-{3,}\s*$/.test(line)) {
        out.push("<hr>");
        i++;
      } else if (line.startsWith("|")) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
        const head = cells(rows[0]).map((c) => `<th>${c}</th>`).join("");
        const body = rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
        out.push(`<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      } else if ((m = line.match(LIST_ITEM))) {
        const tag = /\d/.test(m[1]) ? "ol" : "ul";
        const items = [];
        while (i < lines.length && (m = lines[i].match(LIST_ITEM))) {
          let item = m[2];
          // Indented lines that aren't new items continue the current one.
          for (i++; i < lines.length && /^\s+\S/.test(lines[i]) && !LIST_ITEM.test(lines[i]); i++) item += " " + lines[i].trim();
          items.push(`<li>${inline(item)}</li>`);
        }
        out.push(`<${tag}>${items.join("")}</${tag}>`);
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
        out.push(`<p>${inline(para.join(" "))}</p>`);
      }
    }
    return out.join("\n");
  }

  const doc = document.getElementById("doc");
  fetch("/readme.md", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(r.statusText);
      return r.text();
    })
    .then((md) => {
      doc.innerHTML = render(md);
      if (location.hash) {
        const target = document.getElementById(location.hash.slice(1));
        if (target) target.scrollIntoView();
      }
    })
    .catch(() => {
      doc.innerHTML = `<p class="msg error">Couldn't load the guide from the server.</p>`;
    });
})();
