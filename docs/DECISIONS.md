# Decisions

1. Electron + React + TypeScript + Vite, with esbuild main/preload bundling. Native Windows app with a narrow sandboxed bridge.
2. sql.js avoids native module ABI/rebuild friction. Its exported file is standard SQLite. Atomic persistence and single-instance ownership are required; future large databases can migrate to native SQLite.
3. All mutation paths go through ActionService and revision checks. AI proposes, user applies, and common local changes can be undone.
4. OS-backed Electron safeStorage encrypts API and Apple credentials outside SQLite. No plaintext fallback.
5. Configurable OpenAI model behind a provider. Offline fixture interpreter supports representative examples and asks about unclear input; it is explicitly not a full offline LLM.
6. iCloud uses an isolated CalDAV adapter and app-specific password flow pending user credentials. Research and limitations will be recorded by calendar owner. Flexible tasks never enter the provider.
7. No invented Git identity. Commit failures due to missing identity will be reported while implementation continues.
