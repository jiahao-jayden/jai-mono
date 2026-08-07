# Define Agent Plugins Skill Import

Parent map: [Agent Plugins v1 Compatibility](../maps/agent-plugins-v1-compatibility.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root
Blocked by: [Define Agent Plugins Package Boundary](define-agent-plugins-package-boundary.md)

## Question

How should Skills discovered under a Plugin root map into `CodingSkillCatalog` and `CodingSkillsRuntime`: provenance, precedence against project/user Skills, refresh/update behavior, resource containment, duplicate names, and explicit activation when a package is installed or untrusted?

## Resolution

Agent Plugin Skills use the existing `CodingSkillCatalog` and `CodingSkillsRuntime`; PandaWork does not copy package files into `.jai/skills` and does not create a second catalog or activation protocol. The package manager supplies an immutable snapshot of already validated, installed, and enabled Plugin Skill candidates through a small snapshot/watch seam. `CodingSkillCatalog` combines those candidates with its direct filesystem roots and remains the only module that selects winners, publishes revisions, and produces shadowing diagnostics.

Installing and enabling a plugin makes its valid static Skills eligible for the catalog immediately. There is no separate Skill-content trust state or prompt. This matches the intended Claude Code user experience and avoids adding approval work that does not protect an actual side effect. File, Bash, MCP, and other tool calls prompted by Skill instructions remain subject to their existing runtime permission rules.

Skill identity remains the Agent Skills `name`; provenance is not a second model-visible identity. `/name` and `Skill({ skill: name })` resolve only the current catalog winner. PandaWork adds no plugin-qualified slash syntax and does not allow the model to select arbitrary Plugin roots or paths. A shadowed candidate is not invocable until the enabled-source set or precedence changes and a new snapshot selects it.

Precedence is deterministic:

1. Project direct `.jai/skills`
2. Project direct `.agents/skills`
3. Project-scoped enabled Plugin Skills
4. User direct `.jai/skills`
5. User direct `.agents/skills`
6. User-scoped enabled Plugin Skills

Within one Plugin tier, candidates sort by stable install identity, never directory enumeration or installation time. The first valid candidate wins and every loser receives a structured `shadowed` diagnostic with winner provenance.

`CodingSkillSource` becomes a discriminated union. Its Plugin variant carries scope, stable install identity, manifest name/version, package revision, and canonical Skill root; internal cards may retain canonical paths, while UI/RPC/events receive an explicit whitelist provenance DTO. Raw manifests, package descriptors, arbitrary filesystem handles, stack, and `cause` never cross that boundary.

Plugin roots are immutable and are not filesystem-watched. Install, enable/disable, update, and uninstall publish a new Plugin candidate snapshot, which invalidates the catalog. The next execution round captures the new catalog snapshot; a running round keeps its previous Skill cards, content revisions, and old Plugin root. The package manager retains old roots while a live snapshot lease exists and reclaims them afterward. Update is therefore visible between rounds, never halfway through Skill activation or resource reading.

Plugin Skill activation keeps the current runtime safeguards: the active run uses one fixed catalog snapshot; `SKILL.md` content must still match its recorded revision; every resource access performs lexical and canonical containment under the canonical Skill directory. Package-loader validation is not treated as permanent filesystem authority and does not replace these open-time checks.
