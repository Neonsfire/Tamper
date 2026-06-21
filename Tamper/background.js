const CHAT_PAGE = "chat.html";
const NETWORK_SESSIONS = new Map();
const MAX_NETWORK_ENTRIES = 600;
const MAX_LIST = 180;
const SECURITY_HEADER_NAMES = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
  "server",
  "x-powered-by"
]);

function openChat() {
  return chrome.tabs.create({ url: chrome.runtime.getURL(CHAT_PAGE) });
}

async function setPending(payload) {
  await chrome.storage.local.set({ pendingNeonAction: { ...payload, createdAt: Date.now() } });
}

function installMenus() {
  chrome.contextMenus.removeAll(() => {
    const pageContexts = ["page", "selection", "link", "image", "video", "audio", "frame"];
    chrome.contextMenus.create({ id: "tamper-root", title: "Tamper Ai", contexts: pageContexts });
    chrome.contextMenus.create({ id: "tamper-scan-page", parentId: "tamper-root", title: "Scan this page", contexts: pageContexts });
    chrome.contextMenus.create({ id: "tamper-open-scan", parentId: "tamper-root", title: "Open Page Scan", contexts: pageContexts });
    chrome.contextMenus.create({ type: "separator", parentId: "tamper-root", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "tamper-ask", parentId: "tamper-root", title: "Ask about this", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "tamper-explain", parentId: "tamper-root", title: "Explain this", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "tamper-summarize", parentId: "tamper-root", title: "Summarize this", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "tamper-rewrite", parentId: "tamper-root", title: "Rewrite this", contexts: ["selection"] });
  });
}

chrome.runtime.onInstalled.addListener(() => installMenus());
chrome.runtime.onStartup.addListener(() => installMenus());
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-tamper-ai-workspace") openChat();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "tamper-scan-page" || info.menuItemId === "tamper-open-scan") {
      assertInspectable(tab, "Page scan");
      await setPending({
        kind: info.menuItemId === "tamper-scan-page" ? "run-page-screen" : "open-page-screen",
        targetTabId: tab.id,
        source: "context-menu"
      });
      await openChat();
      return;
    }

    const text = (info.selectionText || "").trim();
    if (!text) return;
    const prompts = {
      "tamper-ask": "Answer my question about the selected text.",
      "tamper-explain": "Explain the selected text clearly. Define jargon and preserve nuance.",
      "tamper-summarize": "Summarize the selected text in the most useful way.",
      "tamper-rewrite": "Rewrite the selected text to be clearer and more natural. Keep its meaning."
    };
    await setPending({
      kind: "selection",
      label: "Selected text",
      text: `Page title: ${tab?.title || "Unknown"}\nURL: ${tab?.url || "Unknown"}\n\nSelected text:\n${text.slice(0, 24000)}`,
      summary: `${text.length.toLocaleString()} selected characters from ${tab?.title || "this page"}`,
      prompt: prompts[info.menuItemId] || "Ask about the selected text."
    });
    await openChat();
  } catch {
    // Keep context-menu failures quiet; the normal Page Scan UI can show details.
  }
});

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getTargetTab(tabId) {
  if (Number.isInteger(tabId)) {
    try { return await chrome.tabs.get(tabId); } catch { throw new Error("The scanned tab is no longer available. Run the scan again on the page you want."); }
  }
  return getCurrentTab();
}

function assertInspectable(tab, capability = "Page tools") {
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    throw new Error(`${capability} works on normal http/https pages, not Opera internal pages.`);
  }
}

function startNetworkSession(tab) {
  const session = {
    tabId: tab.id,
    pageUrl: tab.url,
    startedAt: Date.now(),
    requests: new Map(),
    entries: [],
    headers: new Map(),
    errors: []
  };
  NETWORK_SESSIONS.set(tab.id, session);
  return session;
}

function getNetworkSnapshot(tabId) {
  const session = NETWORK_SESSIONS.get(tabId);
  if (!session) return { active: false, startedAt: null, entries: [], headers: [], errors: [] };
  return {
    active: true,
    startedAt: session.startedAt,
    entries: session.entries.slice(-MAX_NETWORK_ENTRIES),
    headers: [...session.headers.values()],
    errors: session.errors.slice(-100)
  };
}

function recordNetworkEntry(session, item) {
  if (session.entries.length >= MAX_NETWORK_ENTRIES) session.entries.shift();
  session.entries.push(item);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const session = NETWORK_SESSIONS.get(details.tabId);
    if (!session || details.timeStamp < session.startedAt) return;
    session.requests.set(details.requestId, {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      initiator: details.initiator || "",
      startedAt: details.timeStamp
    });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const session = NETWORK_SESSIONS.get(details.tabId);
    if (!session || details.timeStamp < session.startedAt) return;
    const pending = session.requests.get(details.requestId) || {};
    session.requests.delete(details.requestId);
    recordNetworkEntry(session, {
      url: details.url,
      method: pending.method || details.method || "GET",
      type: pending.type || details.type || "other",
      statusCode: details.statusCode || 0,
      fromCache: Boolean(details.fromCache),
      initiator: pending.initiator || "",
      durationMs: Math.max(0, Math.round(details.timeStamp - (pending.startedAt || details.timeStamp))),
      completedAt: details.timeStamp
    });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const session = NETWORK_SESSIONS.get(details.tabId);
    if (!session || details.timeStamp < session.startedAt) return;
    session.requests.delete(details.requestId);
    if (session.errors.length >= 100) session.errors.shift();
    session.errors.push({ url: details.url, type: details.type, error: details.error || "Unknown network error", at: details.timeStamp });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const session = NETWORK_SESSIONS.get(details.tabId);
    if (!session || details.timeStamp < session.startedAt || !Array.isArray(details.responseHeaders)) return;
    const selected = details.responseHeaders
      .filter((header) => SECURITY_HEADER_NAMES.has(String(header.name || "").toLowerCase()))
      .map((header) => ({ name: String(header.name || ""), value: String(header.value || "").slice(0, 1500) }));
    if (!selected.length) return;
    const key = `${details.url}|${details.statusCode || 0}`;
    session.headers.set(key, { url: details.url, type: details.type, statusCode: details.statusCode || 0, headers: selected });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

async function extractPage(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const title = document.title || "Untitled page";
      const url = location.href;
      const selected = window.getSelection?.().toString().trim() || "";
      const noisySelectors = [
        "script", "style", "noscript", "template", "svg", "canvas", "iframe",
        "nav", "footer", "header", "aside", "form", "button",
        "[role='navigation']", "[role='banner']", "[role='contentinfo']",
        ".ad", ".ads", ".advert", ".advertisement", ".cookie", ".modal", ".popup",
        ".sidebar", ".menu", ".comments", "#comments", ".social", ".share"
      ];
      const cleanNode = (node) => {
        const copy = node.cloneNode(true);
        copy.querySelectorAll(noisySelectors.join(",")).forEach((el) => el.remove());
        copy.querySelectorAll("[aria-hidden='true']").forEach((el) => el.remove());
        return copy;
      };
      const normalizeText = (text) => (text || "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      const candidates = [...document.querySelectorAll("article, main, [role='main'], .article, .post, .entry-content, .article-content")];
      if (!candidates.length) candidates.push(document.body);
      let bestText = "";
      let bestScore = -1;
      for (const candidate of candidates) {
        const text = normalizeText(cleanNode(candidate).innerText);
        const blockCount = candidate.querySelectorAll("p, li, pre, blockquote").length;
        const score = Math.min(text.length, 60000) + blockCount * 180;
        if (score > bestScore) {
          bestText = text;
          bestScore = score;
        }
      }
      let text = normalizeText(selected || bestText || document.body?.innerText || "");
      const lines = text.split("\n");
      const seen = new Map();
      const deduped = [];
      for (const line of lines) {
        const key = line.trim();
        if (!key) continue;
        const count = (seen.get(key) || 0) + 1;
        seen.set(key, count);
        if (count < 3 && key.length > 1) deduped.push(key);
      }
      text = deduped.join("\n").slice(0, 42000);
      const description = document.querySelector('meta[name="description"]')?.content || "";
      const heading = document.querySelector("h1")?.innerText || "";
      return { title, url, text, description: description.slice(0, 600), heading: heading.slice(0, 300), wasSelection: Boolean(selected) };
    }
  });
  return injection?.result;
}

async function inspectPagePassive(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const cap = (items, count = 120) => Array.from(items || []).slice(0, count);
      const toUrl = (value) => {
        try { return new URL(value, location.href); } catch { return null; }
      };
      const hostOf = (value) => toUrl(value)?.hostname || "";
      const isThirdParty = (host) => Boolean(host && host !== location.hostname && !host.endsWith(`.${location.hostname}`) && !location.hostname.endsWith(`.${host}`));
      const hostCounts = new Map();
      const noteHost = (value, kind) => {
        const host = hostOf(value);
        if (!host || !isThirdParty(host)) return;
        const item = hostCounts.get(host) || { host, count: 0, kinds: new Set() };
        item.count += 1;
        item.kinds.add(kind);
        hostCounts.set(host, item);
      };
      const keywordHits = (text) => {
        const patterns = [
          ["eval", /\beval\s*\(/g],
          ["Function", /\bnew\s+Function\b|\bFunction\s*\(/g],
          ["document.write", /document\.write\s*\(/g],
          ["innerHTML", /\.innerHTML\s*=/g],
          ["postMessage", /\.postMessage\s*\(/g],
          ["localStorage", /\blocalStorage\b/g],
          ["sessionStorage", /\bsessionStorage\b/g],
          ["fetch", /\bfetch\s*\(/g],
          ["XMLHttpRequest", /\bXMLHttpRequest\b/g],
          ["WebSocket", /\bWebSocket\b/g]
        ];
        const result = {};
        for (const [name, pattern] of patterns) {
          const matches = text.match(pattern);
          if (matches?.length) result[name] = matches.length;
        }
        return result;
      };

      const scripts = cap(document.scripts, 180).map((script, index) => {
        const src = script.src || "";
        if (src) noteHost(src, "script");
        const inline = !src;
        const inlineText = inline ? (script.textContent || "") : "";
        return {
          index,
          external: Boolean(src),
          src: src || null,
          host: src ? hostOf(src) : "",
          type: script.type || "classic",
          async: Boolean(script.async),
          defer: Boolean(script.defer),
          noModule: Boolean(script.noModule),
          integrity: Boolean(script.integrity),
          crossOrigin: script.crossOrigin || "",
          referrerPolicy: script.referrerPolicy || "",
          inlineBytes: inline ? inlineText.length : 0,
          indicators: inline ? keywordHits(inlineText) : {}
        };
      });

      const resourceEntries = cap(performance.getEntriesByType("resource"), 420).map((entry) => {
        noteHost(entry.name, entry.initiatorType || "resource");
        return {
          url: entry.name,
          host: hostOf(entry.name),
          initiatorType: entry.initiatorType || "other",
          durationMs: Math.round(entry.duration || 0),
          transferSize: Number(entry.transferSize || 0),
          encodedBodySize: Number(entry.encodedBodySize || 0),
          nextHopProtocol: entry.nextHopProtocol || ""
        };
      });

      const forms = cap(document.forms, 80).map((form, index) => {
        const action = form.action || location.href;
        const actionUrl = toUrl(action);
        const passwordInputs = form.querySelectorAll('input[type="password"]').length;
        const targetBlank = form.target === "_blank";
        const rel = form.getAttribute("rel") || "";
        return {
          index,
          method: (form.method || "get").toUpperCase(),
          action,
          actionHost: actionUrl?.hostname || "",
          externalAction: Boolean(actionUrl && actionUrl.origin !== location.origin),
          insecureAction: Boolean(actionUrl && location.protocol === "https:" && actionUrl.protocol === "http:"),
          passwordInputs,
          autocompleteOff: form.getAttribute("autocomplete") === "off",
          targetBlank,
          rel
        };
      });

      const iframes = cap(document.querySelectorAll("iframe"), 80).map((frame, index) => {
        const src = frame.src || "";
        if (src) noteHost(src, "iframe");
        return {
          index,
          src: src || null,
          host: src ? hostOf(src) : "",
          sandbox: frame.getAttribute("sandbox") || "",
          allow: frame.getAttribute("allow") || "",
          referrerPolicy: frame.referrerPolicy || ""
        };
      });

      const meta = {};
      for (const node of cap(document.querySelectorAll("meta[http-equiv], meta[name]"), 120)) {
        const key = String(node.getAttribute("http-equiv") || node.getAttribute("name") || "").toLowerCase();
        const content = String(node.content || "").trim();
        if (["content-security-policy", "content-security-policy-report-only", "referrer", "referrer-policy", "permissions-policy"].includes(key) && content) {
          meta[key] = content.slice(0, 4000);
        }
      }

      const mixedContent = resourceEntries.filter((resource) => location.protocol === "https:" && resource.url.startsWith("http:")).map((resource) => resource.url).slice(0, 80);
      const localStorageKeys = (() => { try { return cap(Object.keys(localStorage), 100); } catch { return []; } })();
      const sessionStorageKeys = (() => { try { return cap(Object.keys(sessionStorage), 100); } catch { return []; } })();
      let cacheNames = [];
      try { cacheNames = cap(await caches.keys(), 50); } catch { /* not available */ }
      let indexedDbNames = [];
      try {
        if (typeof indexedDB.databases === "function") indexedDbNames = cap((await indexedDB.databases()).map((item) => item.name).filter(Boolean), 50);
      } catch { /* not available */ }

      const linksWithTargetBlank = cap(document.querySelectorAll('a[target="_blank"]'), 200).map((link) => ({
        href: link.href || "",
        rel: link.getAttribute("rel") || ""
      }));
      for (const link of linksWithTargetBlank) if (link.href) noteHost(link.href, "link");

      const security = {
        https: location.protocol === "https:",
        secureContext: Boolean(window.isSecureContext),
        cspMeta: Boolean(meta["content-security-policy"] || meta["content-security-policy-report-only"]),
        referrerPolicyMeta: meta.referrer || meta["referrer-policy"] || "",
        mixedContentCount: mixedContent.length,
        insecureFormActions: forms.filter((form) => form.insecureAction).length,
        externalPasswordForms: forms.filter((form) => form.passwordInputs && form.externalAction).length,
        targetBlankWithoutNoopener: linksWithTargetBlank.filter((link) => !/\bnoopener\b/i.test(link.rel)).length
      };

      return {
        generatedAt: new Date().toISOString(),
        page: {
          title: document.title || "Untitled page",
          url: location.href,
          origin: location.origin,
          host: location.hostname,
          protocol: location.protocol,
          language: document.documentElement.lang || "",
          charset: document.characterSet || "",
          doctype: document.doctype?.name || "",
          secureContext: Boolean(window.isSecureContext)
        },
        security,
        meta,
        scripts,
        resources: resourceEntries,
        forms,
        iframes,
        mixedContent,
        thirdPartyHosts: [...hostCounts.values()]
          .map((item) => ({ host: item.host, count: item.count, kinds: [...item.kinds] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 120),
        storage: { localStorageKeys, sessionStorageKeys, cacheNames, indexedDbNames },
        links: { targetBlank: linksWithTargetBlank },
        summary: {
          scriptCount: scripts.length,
          externalScriptCount: scripts.filter((script) => script.external).length,
          inlineScriptCount: scripts.filter((script) => !script.external).length,
          resourceCount: resourceEntries.length,
          formCount: forms.length,
          iframeCount: iframes.length,
          thirdPartyHostCount: hostCounts.size,
          localStorageKeyCount: localStorageKeys.length,
          sessionStorageKeyCount: sessionStorageKeys.length
        }
      };
    }
  });
  return injection?.result;
}

async function getCookieMetadata(url) {
  const cookies = await chrome.cookies.getAll({ url });
  return cookies.slice(0, MAX_LIST).map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || "unspecified",
    session: Boolean(cookie.session),
    hostOnly: Boolean(cookie.hostOnly),
    partitioned: Boolean(cookie.partitionKey),
    expiresAt: cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toISOString() : null
  }));
}

function simpleDuplicates(tabs) {
  const buckets = new Map();
  for (const tab of tabs.filter((item) => /^https?:/i.test(item.url || ""))) {
    try {
      const url = new URL(tab.url);
      url.hash = "";
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) url.searchParams.delete(key);
      const normalized = url.toString().replace(/\/$/, "");
      if (!buckets.has(normalized)) buckets.set(normalized, []);
      buckets.get(normalized).push(tab);
    } catch { /* ignore malformed URLs */ }
  }
  return [...buckets.values()].filter((group) => group.length > 1);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "OPEN_CHAT") {
        await openChat();
        return sendResponse({ ok: true });
      }

      if (message.type === "GET_PAGE_CONTEXT") {
        const tab = await getTargetTab(message.tabId);
        assertInspectable(tab, "Page tools");
        const page = await extractPage(tab.id);
        if (!page?.text) throw new Error("No readable text was found on this page.");
        const intro = [page.heading ? `Heading: ${page.heading}` : "", page.description ? `Description: ${page.description}` : ""].filter(Boolean).join("\n");
        return sendResponse({ ok: true, context: {
          kind: page.wasSelection ? "selection" : "page",
          label: page.wasSelection ? "Current selection" : "Reader view",
          text: `Page title: ${page.title}\nURL: ${page.url}${intro ? `\n${intro}` : ""}\n\n${page.text}`,
          summary: `${page.title} · cleaned ${page.text.length.toLocaleString()} characters`
        }});
      }

      if (message.type === "RUN_PAGE_SCREEN") {
        const tab = await getTargetTab(message.tabId);
        assertInspectable(tab, "Page scan");
        const session = startNetworkSession(tab);
        const [page, cookies] = await Promise.all([inspectPagePassive(tab.id), getCookieMetadata(tab.url)]);
        if (!page) throw new Error("Could not inspect the selected page.");
        return sendResponse({ ok: true, report: { ...page, tabId: tab.id, tabTitle: tab.title || "", cookies, network: getNetworkSnapshot(tab.id), watcherStartedAt: session.startedAt } });
      }

      if (message.type === "GET_NETWORK_CAPTURE") {
        const tab = await getTargetTab(message.tabId);
        assertInspectable(tab, "Network observer");
        return sendResponse({ ok: true, tabId: tab.id, network: getNetworkSnapshot(tab.id) });
      }

      if (message.type === "CLEAR_NETWORK_CAPTURE") {
        const tab = await getTargetTab(message.tabId);
        assertInspectable(tab, "Network observer");
        const session = startNetworkSession(tab);
        return sendResponse({ ok: true, tabId: tab.id, startedAt: session.startedAt });
      }

      if (message.type === "RELOAD_FOR_NETWORK_CAPTURE") {
        const tab = await getTargetTab(message.tabId);
        assertInspectable(tab, "Network observer");
        const session = startNetworkSession(tab);
        await chrome.tabs.reload(tab.id, { bypassCache: true });
        return sendResponse({ ok: true, tabId: tab.id, startedAt: session.startedAt });
      }

      if (message.type === "CAPTURE_SCREENSHOT") {
        const tab = await getCurrentTab();
        assertInspectable(tab, "Screenshots");
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        return sendResponse({ ok: true, dataUrl });
      }

      if (message.type === "ENABLE_SELECTION_TOOLS") {
        const tab = await getCurrentTab();
        assertInspectable(tab, "Selection tools");
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        return sendResponse({ ok: true });
      }

      if (message.type === "OPEN_SELECTION_IN_CHAT") {
        await setPending(message.payload);
        await openChat();
        return sendResponse({ ok: true });
      }

      if (message.type === "LIST_TABS") {
        const current = await chrome.tabs.query({ currentWindow: true });
        const tabs = current.map((tab) => ({ id: tab.id, title: tab.title || "Untitled tab", url: tab.url || "", active: Boolean(tab.active), pinned: Boolean(tab.pinned), index: tab.index }));
        return sendResponse({ ok: true, tabs, duplicates: simpleDuplicates(tabs) });
      }

      if (message.type === "ACTIVATE_TAB") {
        await chrome.tabs.update(message.tabId, { active: true });
        return sendResponse({ ok: true });
      }

      if (message.type === "CLOSE_TAB") {
        if (!message.confirmed) throw new Error("Closing a tab requires confirmation.");
        await chrome.tabs.remove(message.tabId);
        return sendResponse({ ok: true });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Something went wrong." });
    }
  })();
  return true;
});
