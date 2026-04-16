# Database Guidelines

> Database patterns and conventions for `@jayden/jai-ai`.

---

Not Applicable -- this package uses a static JSON file (`models-snapshot.json`) as a read-only model registry, not a database. The snapshot is updated via the `update-models` script which fetches from the models.dev API:

```bash
pnpm --filter @jayden/jai-ai update-models
# Runs: curl -sL https://models.dev/api.json -o src/models-snapshot.json
```

The JSON is imported at module load time with `import registry from "./models-snapshot.json" with { type: "json" }` and accessed through typed lookup functions. There are no writes, no migrations, and no query patterns.
