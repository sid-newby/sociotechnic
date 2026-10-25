# Microsoft Azure skills provenance

Source: https://github.com/microsoft/azure-skills

Revision: `f3b512517ed86feceebfee480a46c971f6c6aff4` (reviewed October 24, 2026).
License: MIT, preserved verbatim in [LICENSE.md](LICENSE.md).

The eight directories under `upstream/` are byte-for-byte imports of the matching
`skills/` directories, including their references, templates and helper scripts.
They were installed with the Codex skill-installer at the exact revision.
The local `SKILL.md` is Sociotechnic's routing and role-adaptation layer, initially
v1.0.0; v1.0.1 adds Entra and optional identity/session guidance.
No upstream hooks, plugin manifests, MCP configuration or global installation was
adopted. Other upstream skills are intentionally outside this package.

Azure CLI tools remain existing shell capabilities, not a packaged executable.
The upstream plugin's `@azure/mcp@latest` server is not automatically started by
this skill. If a future task needs structured MCP access, configure and version
that integration explicitly rather than claiming tools that were not supplied.

Updates require reviewing a new upstream revision, publishing a higher semantic
agent release with a new snapshot, then exporting and checking the catalog.
Editing this directory cannot change existing releases or pinned runs.
