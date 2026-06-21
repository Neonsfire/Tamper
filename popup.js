const $ = (id) => document.getElementById(id);

async function openWorkspace(payload) {
  if (payload) await chrome.storage.local.set({ pendingNeonAction: payload });
  await chrome.runtime.sendMessage({ type: "OPEN_CHAT" });
  window.close();
}

async function refreshStatus() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const model = settings.model || "No model selected";
  $("modelLabel").textContent = model;
  const label = $("connection");
  if (!settings.apiToken) { label.textContent = "token needed"; label.className = "pill bad"; return; }
  label.textContent = "LM Studio ready";
  label.className = "pill ok";
}

$("openWorkspace").addEventListener("click", () => openWorkspace());
$("openSettings").addEventListener("click", () => openWorkspace({ kind: "open-settings" }));
$("attachPage").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" });
  if (!result?.ok) return alert(result?.error || "Could not read this page.");
  await openWorkspace({ ...result.context, prompt: "Give me a sharp, useful briefing on this page. Start with the most important point." });
});
$("enableSelection").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "ENABLE_SELECTION_TOOLS" });
  if (!result?.ok) return alert(result?.error || "Could not enable selection tools.");
  $("enableSelection").querySelector("small").textContent = "Enabled for this tab — highlight text now";
});
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => openWorkspace({ kind:"quick-prompt", prompt: button.dataset.prompt })));
refreshStatus();
