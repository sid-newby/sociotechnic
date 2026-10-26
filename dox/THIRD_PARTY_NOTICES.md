# Third-party notices

Sociotechnic's own code and documentation use the [MIT license](LICENSE).
The following bundled sources retain their original licenses and notices.

| Material | Source and revision | Bundled license |
| --- | --- | --- |
| Team writing references: PStack Unslop and Technical Writing | [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude), exact upstream blobs in [sources.json](../sociotechnic/skills/team-writing/sources.json) | [MIT](../sociotechnic/skills/team-writing/LICENSE.md), [upstream notices](../sociotechnic/skills/team-writing/NOTICE.md) |
| Microsoft Azure skills | [microsoft/azure-skills](https://github.com/microsoft/azure-skills), `f3b512517ed86feceebfee480a46c971f6c6aff4` | [MIT, Microsoft Corporation](sociotechnic/skills/azure-sme/LICENSE.md) |
| Terraform skill v1.17.2 | [antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill), `9c1e92d962a5407c227e5566416e962a2f057240` | [Apache-2.0, Anton Babenko](sociotechnic/skills/terraform-skill/LICENSE.md) |
| shadcn skill and references | [shadcn-ui/ui](https://github.com/shadcn-ui/ui), `617134d5810bba521803b3ed787190bacbb80b35` | [MIT, shadcn](sociotechnic/scaffolds/react-nest/template/docs/ui-standards/upstream/shadcn/LICENSE) |
| shadcn stylesheet inlined in the console's `index.css` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui), npm `shadcn@4.22.1` `dist/tailwind.css` | [MIT, shadcn](../sociotechnic/scaffolds/react-nest/template/docs/ui-standards/upstream/shadcn/LICENSE) |
| TweakCN theme presets (42) in `sociotechnic/ui/web/src/theme/presets/` | [jnsahaj/tweakcn](https://github.com/jnsahaj/tweakcn), registry `https://tweakcn.com/r/themes/<key>.json` fetched 2026-10-25; `font-*` variables and the `$schema`, `type` and `css` fields removed | [Apache-2.0, jnsahaj/tweakcn](../sociotechnic/ui/web/src/theme/presets/LICENSE-tweakcn) |
| Tailwind design system skill | [wshobson/agents](https://github.com/wshobson/agents), `0874a27b17a22e2b7c2e2bcd725768e0803cad06` | [MIT, Seth Hobson](sociotechnic/scaffolds/react-nest/template/docs/ui-standards/upstream/tailwind-design-system/LICENSE) |

[Azure provenance](sociotechnic/skills/azure-sme/UPSTREAM.md),
[Terraform provenance](sociotechnic/skills/terraform-skill/UPSTREAM.md) and the
[scaffold source manifest](sociotechnic/scaffolds/react-nest/template/.agents/skills/scaffold-ui/references/sources.json)
record the imports. Immutable agent release bundles also embed upstream skill
text; retain the corresponding licenses when redistributing those bundles.

Installed dependencies have their own licenses. Their resolved versions are
pinned in the pnpm lockfiles. Preserve their notices when distributing built
assets or packages.

Sociotechnic's [design lineage](sociotechnic/docs/development.md#design-lineage)
credits Swamp by swamp-club. Local upstream study copies are not part of this
repository's public source snapshot.
