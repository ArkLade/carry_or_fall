# Supabase

The persistent account and progression schema. `docs/DATA_MODEL.md` is the specification; this
directory is its implementation, and `docs/DATA_MODEL.md` §8 is the rule set these files obey.

```
supabase/
  migrations/
    0001_accounts_and_progression.sql   tables, constraints, indexes, RLS policies
    0002_settlement_functions.sql       ensure_account, reserve/cancel, settlement, recovery
```

## The one rule

**The schema is never edited in the Supabase dashboard.** A dashboard change exists in exactly one
project and is invisible to every other environment, to CI, to a pull-request review, and to the
next person who creates a project from this repository. Every schema change is a new file here.

Two corollaries:

- **Never edit an applied migration.** An applied file is history; change is a new file.
- **Row-level security is enabled in the same migration that creates a table**, never in a
  follow-up. This repository is public (`docs/DECISIONS.md` D25) and a table that exists for one
  deployment without RLS was readable by every authenticated user of the project.

Migrations contain no value from any environment: no keys, no URLs, no project refs.

## Applying them to a clean project

The database must be reproducible from an empty Supabase project by applying these files in
filename order and nothing else.

1. Create a project. Under **Authentication → Sign In / Providers**, enable **Anonymous sign-ins**
   (technical plan §17.1 requires instant guest play).
2. Install the Supabase CLI, then link this checkout to the project once:

   ```sh
   supabase link --project-ref <project-ref>
   ```

   The link state is local and ignored. Do not apply schema through the dashboard SQL Editor; D53
   makes the checked-in migration history plus the CLI the only approved path.
3. Apply every unapplied migration in filename order through the linked CLI:

   ```sh
   supabase db push
   ```

4. Copy the project's URL, publishable key (`sb_publishable_…`), and secret key (`sb_secret_…`)
   into the repository-root `.env`, using the commented examples in `.env.example`. Replace the
   placeholders and uncomment all four lines together. That file is gitignored; only
   `.env.example` is ever tracked.

The publishable key is designed to be bundled into the browser. **The secret key bypasses row-level
security and must only ever exist in the server process** — never in a `VITE_*` variable, never in
this repository, never in a log line (technical plan §20.2; `docs/DEVELOPMENT_RULES.md`).

## Verifying a project

`pnpm test:supabase` runs the schema's contract and row-level-security suite against a real project,
using `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment. Without those variables it
skips rather than fails, which is what lets CI — which has no credentials and cannot reach a
project — pass on a fresh clone (`docs/DECISIONS.md` D46).

Only that suite proves the SQL is correct. The in-memory store CI exercises proves the server calls
the contract correctly, which is a different claim; `docs/DATA_MODEL.md` §9 states the split.
