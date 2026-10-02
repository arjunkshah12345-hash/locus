export function boardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Locus</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --canvas: #f7f7f8;
      --ink: #111111;
      --muted: #4d4d4d;
      --line: #e0e0e0;
      --orange: #f6821f;
      --orange-deep: #e06c12;
      --landed: #067647;
      --card: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--canvas);
      color: var(--ink);
    }
    a { color: inherit; }
    button, input, textarea {
      font: inherit;
      color: inherit;
    }
    header.bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; justify-content: space-between;
      height: 60px; padding: 0 24px;
      background: #fff; border-bottom: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 10px; background: none; border: 0; padding: 0; cursor: pointer; }
    .mark { width: 28px; height: 28px; border-radius: 6px; background: var(--orange); position: relative; }
    .mark:before {
      content: "";
      position: absolute; left: 5px; top: 11px;
      width: 18px; height: 9px; background: #fff; border-radius: 9px 9px 7px 7px;
    }
    .brand strong { font-size: 18px; letter-spacing: -0.03em; }
    .brand span { color: var(--muted); font-size: 13px; }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 64px; }
    h1 { font-size: 40px; line-height: 1.05; letter-spacing: -0.045em; font-weight: 650; margin: 0; }
    h2 { font-size: 18px; margin: 0; letter-spacing: -0.02em; font-weight: 650; }
    .lede { color: var(--muted); max-width: 46rem; margin: 10px 0 0; font-size: 17px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    button.btn, .btn {
      border: 1px solid var(--line); background: #fff; border-radius: 6px;
      padding: 8px 12px; cursor: pointer;
    }
    button.primary { background: var(--orange); border-color: var(--orange); color: #1a1006; font-weight: 650; }
    button.primary:hover { background: var(--orange-deep); }
    button:disabled { opacity: 0.55; cursor: wait; }
    input, textarea {
      width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: 9px 10px;
    }
    textarea { min-height: 72px; resize: vertical; }
    label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
    .panel {
      background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px;
    }
    .home-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; margin-top: 22px; }
    .projects { display: grid; gap: 10px; margin-top: 16px; }
    .project {
      display: flex; justify-content: space-between; gap: 12px; align-items: center;
      width: 100%; text-align: left; background: #fff;
    }
    .project small, .meta, .muted { color: var(--muted); }
    .layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; margin-top: 18px; }
    .stack { display: grid; gap: 12px; align-content: start; }
    .stats { display: flex; gap: 16px; color: var(--muted); margin-top: 8px; }
    .stats strong { color: var(--ink); font-weight: 650; }
    .arena { border: 1px solid var(--orange); background: #fff; border-radius: 8px; padding: 16px; }
    .lanes, .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .card, .lane { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 8px; }
    .card.contended, .lane { border-color: #f3c79a; }
    .status { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; }
    .status.contended, .status.ready { color: var(--orange-deep); }
    .status.landed { color: var(--landed); }
    .status.abandoned, .status.active { color: var(--muted); }
    pre {
      margin: 0; white-space: pre-wrap;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #111; color: #f6f6f6; border-radius: 6px; padding: 10px;
    }
    .crumb { color: var(--muted); margin-bottom: 8px; }
    .crumb button { background: none; border: 0; padding: 0; color: var(--orange-deep); cursor: pointer; }
    .activity { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .activity li { color: var(--muted); }
    .banner { color: var(--orange-deep); min-height: 1.3em; font-weight: 650; }
    .section-title { margin: 18px 0 8px; }
    @media (max-width: 860px) {
      .home-grid, .layout { grid-template-columns: 1fr; }
      h1 { font-size: 32px; }
    }
  </style>
</head>
<body>
  <header class="bar">
    <button class="brand" id="home" type="button">
      <span class="mark"></span>
      <strong>Locus</strong>
      <span>on Cloudflare</span>
    </button>
    <span class="muted">Agents claim. The canon lands one.</span>
  </header>
  <main id="app"></main>
  <script>
    const app = document.querySelector("#app");
    document.querySelector("#home").addEventListener("click", () => go("/"));

    function go(href) {
      history.pushState({}, "", href);
      route();
    }
    window.addEventListener("popstate", route);

    async function api(path, options) {
      const response = await fetch(path, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    }

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function pill(intent) {
      return intent.contended ? "contended" : intent.status;
    }

    function route() {
      const path = location.pathname;
      if (path.startsWith("/p/")) renderBoard(decodeURIComponent(path.slice(3)));
      else renderHome();
    }

    async function renderHome() {
      app.replaceChildren();
      const hero = el("section", "home-grid");
      const copy = el("div");
      copy.append(el("h1", "", "One canon for every agent."));
      copy.append(el("p", "lede", "Locus is the layer above Git. An agent claims a surface, works in its own fork, and the canon only lands the change that wins."));
      const form = el("form", "panel");
      form.style.marginTop = "18px";
      form.append(field("Project name", "name", "Flag service"));
      form.append(field("What this canon is", "summary", "Feature flags for the storefront", true));
      const submit = el("button", "btn primary", "Create project");
      submit.type = "submit";
      submit.style.marginTop = "8px";
      form.append(submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        const data = new FormData(form);
        try {
          const body = await api("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: data.get("name"), summary: data.get("summary") }),
          });
          go("/p/" + encodeURIComponent(body.project.id));
        } catch (error) {
          submit.disabled = false;
          alert(error.message);
        }
      });
      copy.append(form);
      const side = el("div");
      side.append(el("h2", "", "Projects"));
      const list = el("div", "projects");
      side.append(list);
      hero.append(copy, side);
      app.append(hero);
      const catalog = await api("/api/projects");
      if (!catalog.projects.length) {
        list.append(el("p", "muted", "No canons yet. Create the first one."));
        return;
      }
      for (const project of catalog.projects) {
        const button = el("button", "project panel");
        const text = el("div");
        text.append(el("strong", "", project.name));
        text.append(el("div", "meta", project.summary));
        button.append(text);
        button.append(el("small", "", project.active + " open · " + project.landed + " landed"));
        button.addEventListener("click", () => go("/p/" + encodeURIComponent(project.id)));
        list.append(button);
      }
    }

    function field(labelText, name, placeholder, area) {
      const label = el("label", "", labelText);
      const input = area ? document.createElement("textarea") : document.createElement("input");
      input.name = name;
      input.placeholder = placeholder;
      if (!area) input.autocomplete = "off";
      label.append(input);
      return label;
    }

    let flash = "";
    let currentProject = null;

    async function renderBoard(id) {
      paint(id, await api("/api/projects/" + encodeURIComponent(id) + "/state"));
    }

    function paint(id, state) {
      app.replaceChildren();
      const project = state.project || currentProject;
      currentProject = project;
      const crumb = el("div", "crumb");
      const back = el("button", "", "Projects");
      back.addEventListener("click", () => go("/"));
      crumb.append(back, document.createTextNode(" / " + project.name));
      app.append(crumb);
      app.append(el("h1", "", project.name));
      app.append(el("p", "lede", project.summary));
      const banner = el("p", "banner", flash);
      app.append(banner);

      const counts = count(state.intents);
      const stats = el("div", "stats");
      stats.innerHTML = "<span><strong>" + counts.holding + "</strong> holding</span><span><strong>" + counts.arena + "</strong> in the arena</span><span><strong>" + counts.landed + "</strong> in canon</span>";
      app.append(stats);

      const layout = el("div", "layout");
      const side = el("aside", "stack");
      side.append(claimForm(id, banner));
      side.append(whySearch(id));
      side.append(activityList(state.activity));
      const main = el("div", "stack");
      main.append(toolbar(id, banner));
      const arena = renderArena(state.intents);
      if (arena) main.append(arena);
      main.append(section("Holding a lease", state.intents.filter((intent) => (intent.status === "active" || intent.status === "ready") && !intent.contended), id));
      main.append(section("Canon", state.intents.filter((intent) => intent.status === "landed"), id));
      main.append(section("Did not land", state.intents.filter((intent) => intent.status === "abandoned"), id));
      layout.append(side, main);
      app.append(layout);
    }

    function count(intents) {
      return {
        holding: intents.filter((intent) => (intent.status === "active" || intent.status === "ready") && !intent.contended).length,
        arena: intents.filter((intent) => intent.contended).length,
        landed: intents.filter((intent) => intent.status === "landed").length,
      };
    }

    function claimForm(id, banner) {
      const form = el("form", "panel stack");
      form.append(el("h2", "", "Claim a surface"));
      form.append(field("Agent", "agentId", "agent-rate"));
      form.append(field("Title", "title", "Rate limit /flags"));
      form.append(field("Goal", "goal", "What should be true when this lands?", true));
      form.append(field("Paths", "paths", "src/index.ts"));
      form.append(field("Symbols", "symbols", "src/index.ts#fetch"));
      const submit = el("button", "btn primary", "Claim");
      submit.type = "submit";
      form.append(submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        const data = new FormData(form);
        const split = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
        try {
          const body = await api("/api/projects/" + encodeURIComponent(id) + "/intents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agentId: data.get("agentId"),
              title: data.get("title"),
              goal: data.get("goal"),
              surface: { paths: split(data.get("paths")), symbols: split(data.get("symbols")) },
            }),
          });
          banner.textContent = body.overlap && body.overlap.length
            ? "Claim overlaps " + body.overlap.join(", ")
            : "Claim is clear.";
          renderBoard(id);
        } catch (error) {
          submit.disabled = false;
          alert(error.message);
        }
      });
      return form;
    }

    function whySearch(id) {
      const form = el("form", "panel stack");
      form.append(el("h2", "", "Why does this file look like this?"));
      form.append(field("Path", "path", "src/flags.ts"));
      const submit = el("button", "btn", "Ask why");
      submit.type = "submit";
      form.append(submit);
      const answer = el("div", "stack");
      form.append(answer);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const body = await api("/api/projects/" + encodeURIComponent(id) + "/why?path=" + encodeURIComponent(data.get("path")));
        answer.replaceChildren();
        if (!body.intents.length) {
          answer.append(el("p", "muted", "Nothing in the canon has landed on that path."));
          return;
        }
        for (const intent of body.intents) {
          answer.append(el("strong", "", intent.title));
          answer.append(el("p", "meta", intent.capsule ? intent.capsule.file : intent.goal));
        }
      });
      return form;
    }

    function activityList(items) {
      const panel = el("section", "panel");
      panel.append(el("h2", "", "Activity"));
      const list = el("ul", "activity");
      if (!items.length) list.append(el("li", "", "Quiet so far."));
      for (const item of items) list.append(el("li", "", item.text));
      panel.append(list);
      return panel;
    }

    function toolbar(id, banner) {
      const bar = el("div", "row");
      const sample = el("button", "btn", "Load flag swarm");
      const watch = el("button", "btn", "Watch it arrive");
      const resolve = el("button", "btn primary", "Resolve arena");
      sample.addEventListener("click", () => runSample(id, false));
      watch.addEventListener("click", () => runSample(id, true));
      resolve.addEventListener("click", async () => {
        resolve.disabled = true;
        await api("/api/projects/" + encodeURIComponent(id) + "/referee", { method: "POST" });
        renderBoard(id);
      });
      bar.append(sample, watch, resolve);
      return bar;
    }

    async function runSample(id, animate) {
      const body = await api("/api/projects/" + encodeURIComponent(id) + "/sample", { method: "POST" });
      const frames = body.frames || [];
      if (!animate || !frames.length) {
        flash = "";
        renderBoard(id);
        return;
      }
      const trail = [];
      for (const frame of frames) {
        flash = frame.label;
        trail.unshift({ text: frame.label });
        paint(id, { project: currentProject, intents: frame.intents, activity: trail.slice(0, 8) });
        await new Promise((done) => setTimeout(done, 520));
      }
      flash = "";
      renderBoard(id);
    }

    function renderArena(intents) {
      const contended = intents.filter((intent) => intent.contended);
      const synthesis = intents.find((intent) => intent.id === "flag-synthesis" && intent.status === "landed");
      if (contended.length < 2 && !synthesis) return null;
      const box = el("section", "arena");
      if (contended.length >= 2) {
        box.append(el("h2", "", "Arena · " + (contended[0].surface.paths[0] || "overlap")));
        box.append(el("p", "muted", contended.length + " agents hold the same file. The canon has not picked."));
        const lanes = el("div", "lanes");
        for (const intent of contended) lanes.append(lane(intent));
        box.append(lanes);
        return box;
      }
      box.append(el("h2", "", "Canon accepted one change"));
      box.append(el("p", "muted", synthesis.capsule ? synthesis.capsule.file : synthesis.goal));
      box.append(lane(synthesis));
      return box;
    }

    function lane(intent) {
      const card = el("article", "lane");
      card.append(el("h2", "", intent.title));
      card.append(el("p", "meta", intent.goal));
      const patch = el("pre", "", intent.patch || intent.surface.paths.join(", "));
      card.append(patch);
      return card;
    }

    function section(title, intents, projectId) {
      const wrap = el("section");
      wrap.append(el("h2", "section-title", title));
      if (!intents.length) {
        wrap.append(el("p", "muted", "Nothing here."));
        return wrap;
      }
      const grid = el("div", "cards");
      for (const intent of intents) grid.append(card(intent, projectId));
      wrap.append(grid);
      return wrap;
    }

    function card(intent, projectId) {
      const node = el("article", "card" + (intent.contended ? " contended" : ""));
      node.append(el("div", "meta", intent.agentId));
      node.append(el("h2", "", intent.title));
      node.append(el("p", "meta", intent.goal));
      node.append(el("div", "status " + pill(intent), pill(intent)));
      if (intent.surface.paths.length) node.append(el("code", "meta", intent.surface.paths.join(", ")));
      if (intent.patch) node.append(el("pre", "", intent.patch));
      if (intent.conflicts && intent.conflicts.length) node.append(el("p", "meta", "Overlaps " + intent.conflicts.join(", ")));
      if (intent.abandonedReason) node.append(el("p", "meta", intent.abandonedReason));
      if (intent.contextNotes) {
        for (const note of intent.contextNotes) node.append(el("p", "meta", note));
      }
      if (intent.capsule) node.append(el("p", "meta", intent.capsule.file));
      if (intent.previewUrl) {
        const link = el("a", "", "Open preview");
        link.href = intent.previewUrl;
        node.append(link);
      }
      if (intent.remote) node.append(el("p", "meta", intent.remote));
      const actions = el("div", "row");
      if (intent.status === "active" || intent.status === "ready") {
        actions.append(actionButton(projectId, intent, "ready", "Ready"));
        actions.append(actionButton(projectId, intent, intent.contended ? "decide" : "land", intent.contended ? "Land this one" : "Land"));
        actions.append(actionButton(projectId, intent, "heartbeat", "Hold"));
      }
      if (intent.status === "active" || intent.status === "ready") {
        const noteForm = document.createElement("form");
        noteForm.className = "row";
        const input = document.createElement("input");
        input.name = "note";
        input.placeholder = "Context for the next agent";
        input.autocomplete = "off";
        const add = el("button", "btn", "Note");
        add.type = "submit";
        noteForm.append(input, add);
        noteForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const note = String(new FormData(noteForm).get("note") || "").trim();
          if (!note) return;
          add.disabled = true;
          await api("/api/projects/" + encodeURIComponent(projectId) + "/intents/" + encodeURIComponent(intent.id) + "/context", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ note }),
          });
          renderBoard(projectId);
        });
        node.append(noteForm);
      }
      if (actions.childNodes.length) node.append(actions);
      return node;
    }

    function actionButton(projectId, intent, name, label) {
      const button = el("button", "btn", label);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await api("/api/projects/" + encodeURIComponent(projectId) + "/intents/" + encodeURIComponent(intent.id) + "/" + name, { method: "POST" });
          renderBoard(projectId);
        } catch (error) {
          button.disabled = false;
          alert(error.message);
        }
      });
      return button;
    }

    route();
  </script>
</body>
</html>`;
}
