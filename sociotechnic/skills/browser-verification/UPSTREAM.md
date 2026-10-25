# Provenance

This is a Sociotechnic integration guide, not a verbatim copy of an upstream skill.
It was verified on October 25, 2026 with agent-browser 0.39.2 and Chrome DevTools
MCP/CLI 1.12.0, using real page snapshots, record navigation, console/network
inspection and a saved performance trace on the local console.

- https://github.com/vercel-labs/agent-browser
- Version-matched `agent-browser skills get core` from the installed 0.39.2 CLI.
- https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/main/skills
- Installed 1.12.0 CLI help and its daemon session implementation.

Both upstream projects use Apache-2.0. No upstream source code is vendored here.
The Chrome DevTools session environment is verified against 1.12.0; review it
alongside commands, cleanup and Sandbox provisioning before changing that pin.
