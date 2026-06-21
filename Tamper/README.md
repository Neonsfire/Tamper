# Tamper Ai v1.4.3 — Reader + searchable Page Scan

Tamper Ai is a local, Qwen-only Opera sidebar assistant that connects to LM Studio on your computer.

## New in v1.4.3

- **Read page in chat**: the chat quick-action button attaches clean reader text from the active page before you ask a question.
- **Read scanned page**: after a Page Scan, this button attaches reader text from the exact tab that was scanned, even if another tab is now active.
- **Search scan data**: use the Page Scan search box to search scripts, cookie metadata, third-party hosts, resource URLs, response headers, storage-key names, and captured network entries.
- **Ask Qwen about matches**: sends only the local search matches from the current scan into chat as explicit context.
- **Use full report in chat**: attaches the complete manual scan report when you need broader analysis.

The Page Scan remains manual. It inventories browser-visible data only after you click Scan; it does not attempt logins, probe endpoints, guess paths, modify requests, or retrieve cookie values, request bodies, response bodies, or credentials.

## Updating

Replace the files in the same Tamper Ai extension folder you already load at `opera://extensions`, then click **Reload**. Keeping the same folder preserves local extension storage such as chats, notes, prompts, themes, and LM Studio settings.
