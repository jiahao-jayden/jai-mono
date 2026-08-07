# Claude Code Artifact Semantics

Research date: 2026-08-07

## Executive finding

Claude Code has a first-class feature named `Artifact`, but it does **not** mean every file the agent creates or modifies. A Claude Code Artifact is a self-contained HTML or Markdown page generated from session work and published to a private or shared URL on `claude.ai`. Ordinary project-file changes are a separate concern handled by file tools, diffs, and file checkpointing.

## Claude Code definition

The official Claude Code documentation defines an Artifact as a live, interactive web page published from a session to a private URL on `claude.ai`. The page can be used for annotated diffs, dashboards, design comparisons, and investigation timelines. The same documentation explicitly says an Artifact is a capture of work, not an application: it is one self-contained page without its own backend or multiple routes.

Source: [Claude Code Artifacts](https://code.claude.com/docs/en/artifacts)

## Source file and publishing lifecycle

Claude Code writes the page to an HTML or Markdown file in the project, then publishes it. Publishing a new Artifact requires permission; republishing an already approved Artifact does not prompt again. A newly published Artifact gets a URL, a title, and an icon, and is listed in the user's Artifact gallery.

Republishing the same Artifact updates the same URL and creates a new version. A different session must be given the existing Artifact URL to update it; otherwise it creates a new Artifact.

Source: [Claude Code Artifacts - Create and Update](https://code.claude.com/docs/en/artifacts#create-an-artifact)

## Sharing and storage boundary

Artifacts are private to the author until shared. They can be shared within an organization or through a public link depending on plan and organization policy. The page is hosted by Anthropic rather than being only a local project file. The documentation also describes organization retention, audit-log events, and compliance endpoints for Artifact records.

Source: [Claude Code Artifacts - Share and Manage](https://code.claude.com/docs/en/artifacts#share-an-artifact)

## Page constraints

An Artifact is one static page. Its default CSP blocks external requests and prevents a backend, relative multi-page navigation, and ordinary browser-side network access. The published source must be `.html`, `.htm`, or `.md`, and the rendered page must be at most 16 MiB. MCP connector calls are a specific exception mediated by `claude.ai`.

Source: [Claude Code Artifacts - Page constraints](https://code.claude.com/docs/en/artifacts#page-constraints)

## Ordinary file changes are separate

Claude Code's overview describes the core coding workflow as reading the codebase, editing files, and running commands. Its file checkpointing feature tracks modifications made through `Write`, `Edit`, and `NotebookEdit`, including files created and modified during a session, so they can be restored. Changes made through Bash are not tracked by that checkpoint system.

Sources:

- [Claude Code Overview](https://code.claude.com/docs/en/overview)
- [Claude Agent SDK File Checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)

## Implication for PandaWork

Claude Code supports two distinct concepts that PandaWork currently conflates under `Outputs` / `Artifacts`:

1. **Project file output**: a real file created or modified in the user's workspace by an agent tool.
2. **Published Artifact**: a derived, self-contained, interactive page with its own URL, versions, sharing policy, and publish permission.

The current PandaWork design phrase “Agent 生成或修改的文件会出现在 Outputs” matches the first concept, not Claude Code's named `Artifact` feature. Before implementing the sidebar `Artifacts` entry, PandaWork must decide whether it wants the Claude Code-style published-page capability, a local project-file index, or two explicitly named concepts.
