(() => {
  const HOST_ID = "neon-local-ai-selection-tools";
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; display: none;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bar { display:flex; align-items:center; gap:4px; padding:6px; border:1px solid rgba(129,255,231,.35); border-radius:14px; background:#071311; box-shadow:0 18px 52px rgba(0,0,0,.45); font-family:ui-sans-serif, system-ui, sans-serif; }
      button { appearance:none; border:0; border-radius:10px; padding:7px 9px; font:600 12px/1 ui-sans-serif, system-ui, sans-serif; color:#dcfff7; background:#123c34; cursor:pointer; }
      button:hover { background:#195649; }
      .brand { padding:0 6px 0 3px; color:#7fffe7; font:700 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing:.04em; }
    </style>
    <div class="bar" role="toolbar" aria-label="Tamper Ai selection tools">
      <span class="brand">TAMPER AI</span>
      <button data-action="Ask">Ask</button>
      <button data-action="Explain">Explain</button>
      <button data-action="Summarize">Summarize</button>
      <button data-action="Rewrite">Rewrite</button>
    </div>`;
  document.documentElement.appendChild(host);

  let selected = "";
  const hide = () => { host.style.display = "none"; };
  const position = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selected) return hide();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const width = 330;
    const left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.left + rect.width / 2 - width / 2));
    const top = Math.max(10, rect.top - 52);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.display = "block";
  };

  const onSelection = () => {
    window.setTimeout(() => {
      const text = window.getSelection?.().toString().trim() || "";
      if (text.length < 2) return hide();
      selected = text.slice(0, 24000);
      position();
    }, 0);
  };

  document.addEventListener("mouseup", onSelection, true);
  document.addEventListener("keyup", onSelection, true);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("mousedown", (event) => { if (!host.contains(event.target)) hide(); }, true);

  shadow.addEventListener("mousedown", (event) => event.preventDefault());
  shadow.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !selected) return;
    const action = button.dataset.action;
    const prompt = {
      Ask: "Answer my question about the selected text.",
      Explain: "Explain the selected text clearly. Define jargon and preserve nuance.",
      Summarize: "Summarize the selected text in the most useful way.",
      Rewrite: "Rewrite the selected text to be clearer and more natural. Keep the meaning."
    }[action];
    await chrome.runtime.sendMessage({
      type: "OPEN_SELECTION_IN_CHAT",
      payload: {
        kind: "selection",
        label: "Selected text",
        text: `Page title: ${document.title}\nURL: ${location.href}\n\nSelected text:\n${selected}`,
        summary: `${selected.length.toLocaleString()} selected characters from ${document.title}`,
        prompt
      }
    });
    hide();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "NEON_REMOVE_SELECTION_TOOLS") {
      document.removeEventListener("mouseup", onSelection, true);
      document.removeEventListener("keyup", onSelection, true);
      window.removeEventListener("resize", hide);
      host.remove();
    }
  });
})();
