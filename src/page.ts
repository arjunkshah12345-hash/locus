export function boardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Locus</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #10110f;
      --card: #1c1b17;
      --ink: #f4f0e6;
      --muted: #b7b1a4;
      --line: #343228;
      --orange: #f6821f;
      --landed: #9ccc8a;
      --abandoned: #8a8478;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.45 "Iowan Old Style", Palatino, Georgia, serif;
      background: var(--bg);
      color: var(--ink);
    }
    header, main { width: min(1100px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 28px 0 8px; display: flex; justify-content: space-between; gap: 16px; align-items: end; }
    h1 { font-size: 40px; font-weight: 500; letter-spacing: -0.04em; margin: 0; }
    p { color: var(--muted); margin: 6px 0 0; }
    button {
      font: inherit;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--ink);
      border-radius: 999px;
      padding: 8px 14px;
      cursor: pointer;
    }
    button.primary { background: var(--orange); border-color: var(--orange); color: #1a1006; }
    button:disabled { opacity: 0.5; cursor: wait; }
    .stats { display: flex; gap: 18px; color: var(--muted); padding: 8px 0 18px; }
    .stats strong { color: var(--ink); font-weight: 500; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding-bottom: 48px; }
    article {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      min-height: 180px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    article.contended { border-color: var(--orange); }
    article.landed { opacity: 0.72; }
    article.abandoned { opacity: 0.45; }
    .agent { color: var(--muted); font-size: 13px; }
    h2 { font-size: 18px; font-weight: 500; margin: 0; letter-spacing: -0.02em; }
    .goal, .meta { margin: 0; }
    .status { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    .status.contended { color: var(--orange); }
    .status.landed { color: var(--landed); }
    .status.abandoned { color: var(--abandoned); }
    .empty { color: var(--muted); padding: 24px 0 48px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Locus</h1>
      <p>Agents claim a surface. The canon lands the winner.</p>
    </div>
    <button class="primary" id="seed" type="button">Seed demo</button>
  </header>
  <main>
    <div class="stats" id="stats"></div>
    <div class="grid" id="grid"></div>
  </main>
  <script>
    const stats = document.querySelector("#stats");
    const grid = document.querySelector("#grid");
    const seed = document.querySelector("#seed");

    function pill(intent) {
      if (intent.contended) return "contended";
      return intent.status;
    }

    function render(intents) {
      const counts = { active: 0, contended: 0, landed: 0, abandoned: 0 };
      for (const intent of intents) {
        if (intent.contended) counts.contended += 1;
        else counts[intent.status] = (counts[intent.status] || 0) + 1;
      }
      stats.innerHTML = "<span><strong>" + counts.active + "</strong> active</span><span><strong>" + counts.contended + "</strong> contended</span><span><strong>" + counts.landed + "</strong> landed</span><span><strong>" + counts.abandoned + "</strong> abandoned</span>";
      grid.replaceChildren();
      if (intents.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Seed the demo to watch eight agents claim the flag service.";
        grid.append(empty);
        return;
      }
      for (const intent of intents) {
        const card = document.createElement("article");
        card.className = intent.contended ? "contended" : intent.status;
        const agent = document.createElement("div");
        agent.className = "agent";
        agent.textContent = intent.agentId;
        const title = document.createElement("h2");
        title.textContent = intent.title;
        const goal = document.createElement("p");
        goal.className = "goal";
        goal.textContent = intent.goal;
        const meta = document.createElement("p");
        meta.className = "meta";
        const paths = (intent.surface.paths || []).join(", ") || "no paths";
        meta.innerHTML = "<code></code>";
        meta.querySelector("code").textContent = paths;
        const status = document.createElement("div");
        status.className = "status " + pill(intent);
        status.textContent = pill(intent);
        card.append(agent, title, goal, meta, status);
        if (intent.conflicts && intent.conflicts.length) {
          const clash = document.createElement("p");
          clash.className = "meta";
          clash.textContent = "Overlaps " + intent.conflicts.join(", ");
          card.append(clash);
        }
        if (intent.abandonedReason) {
          const reason = document.createElement("p");
          reason.className = "meta";
          reason.textContent = intent.abandonedReason;
          card.append(reason);
        }
        if (intent.status === "active" || intent.status === "ready") {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = intent.contended ? "Land this one" : "Land";
          button.addEventListener("click", () => act(intent.contended ? "decide" : "land", intent.id, button));
          card.append(button);
        }
        grid.append(card);
      }
    }

    async function load() {
      const response = await fetch("/api/intents");
      const body = await response.json();
      render(body.intents || []);
    }

    async function act(name, id, button) {
      button.disabled = true;
      const response = await fetch("/api/intents/" + encodeURIComponent(id) + "/" + name, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        button.disabled = false;
        alert(body.error || "Request failed");
        return;
      }
      await load();
    }

    seed.addEventListener("click", async () => {
      seed.disabled = true;
      await fetch("/api/demo/seed", { method: "POST" });
      seed.disabled = false;
      await load();
    });

    load();
  </script>
</body>
</html>`;
}
