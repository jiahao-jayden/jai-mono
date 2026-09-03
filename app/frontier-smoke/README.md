# Jai Frontier local smoke

This tool runs one local, task-definition-compatible smoke trial for a public
`frontier-harness-eval` task. It does **not** run an official verifier and does
not produce an official Frontier score.

Run from the Jai mono workspace after checking out the public task repository at
`0c402ae23724e2d937df0c7038b82203a829a385`. The checkout must be clean; this
prevents the result from claiming the pinned public task definition while running
different task files:

```sh
bun run frontier:smoke -- \
  --task-dir /path/to/frontier-harness-eval/tasks/build-cython-ext \
  --model provider/model \
  --output-dir /path/to/frontier-results
```

The local smoke runner enforces container filesystem and network isolation. It
also applies the task's CPU and memory limits. The public task's
`storage_mb` value is retained in the result as task metadata, but is not
enforced as a writable-layer quota because macOS Docker backends commonly do
not expose XFS project quotas.

Once a supported Docker context is active, rerun the same command. Each trial is
written to its own `trial-*` directory; inspect `result.json` for the final CLI
projection, diagnostics, timing, and any collected artifacts.

`provider/model` must be an enabled profile/model in the local Server-owned JAI
configuration (`~/.jai` by default). The runner reads that profile through the
Server configuration API. Its API key is passed only to a per-trial provider
gateway; the task container receives an isolated `JAI_HOME` with an
authentication-free gateway profile instead.

The task container is on an internal Docker network only. The provider gateway
is the sole component attached to a second egress network and only proxies the
selected model to its configured upstream.

Each run creates a new `trial-*` directory containing `result.json` and any
declared task artifacts that could be collected. `completed` means the JAI CLI
finished and emitted its final ACP projection. It does not mean the task passed:
the public repository does not include Frontier's verifier or checkpoint.
