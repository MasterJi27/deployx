# DeployX · CI/CD Pipeline Simulator

DeployX is an interactive, front-end-only console that simulates a modern CI/CD pipeline and teaches how it behaves when things go right and wrong:

**Git push → Checkout → Build → Testing ‖ Security scan → Approval → Deployment → Production**

The pipeline is drawn as a transit line. Each stage is a station, the run is a train that moves along the line in step with the real engine state, and the chosen environment is the terminus.

> **Everything is simulated.** No builds run, no API is called and no real infrastructure is touched. Repositories, commits, logs, timings, environments, incidents and chat are generated in the browser for learning and demonstration.

## Run it

The app loads its configuration from `data/*.json` with `fetch()`. Browsers block `fetch()` on `file://` pages, so open the folder through a local server.

**VS Code Live Server (recommended)**

1. Open the `deployx` folder in VS Code.
2. Install the *Live Server* extension.
3. Right-click `index.html` and choose **Open with Live Server**.

**Or from a terminal**

```bash
cd deployx
python3 -m http.server 5501
```

Then open <http://localhost:5501>. If the data files cannot load, the app shows a clear message explaining why instead of a blank page.

An internet connection is needed on first load for the Tailwind CSS browser CDN and Google Fonts (Barlow, Barlow Condensed, IBM Plex Mono). The Tailwind CDN is meant for prototypes; for production you would compile Tailwind instead.

## Technology

| Layer | Choice |
| --- | --- |
| Structure | Semantic HTML5 |
| Layout utilities | Tailwind CSS (official browser CDN, no build step) |
| Look and motion | Custom CSS3 with design tokens (`style.css`), light and dark themes |
| Logic | Vanilla JavaScript ES6+ (`script.js`), async/await, Promises and `AbortController` |
| Configuration and content | JSON files in `data/` |
| Persistence | LocalStorage (key `deployx:v1`) |
| Graphics | Inline SVG (line map, charts, icons) |

No React, Vue, Angular, TypeScript, jQuery, Bootstrap or backend.

## Folder structure

```
deployx/
├── index.html                 App shell, views, drawers, SVG icon sprite
├── style.css                  Design tokens, components, animation, dark theme
├── script.js                  Store, pipeline engine, rendering, actions
├── data/
│   ├── pipeline-config.json   Stage definitions, log steps, durations, failures, CI steps
│   ├── environments.json      Development, Staging, Production; approval gate; rollout settings
│   ├── demo-data.json         Demo repository, branches, commits, seed history
│   ├── stage-catalog.json     Extra stages the pipeline editor can add
│   ├── drills.json            Incident drill scenarios, scoring and ranks
│   ├── chaos.json             Chaos incidents, mitigations and intensity
│   └── tour.json              Guided tour copy for every stage
├── assets/
│   ├── icons/favicon.svg
│   └── images/line-map.svg    Empty-state illustration
└── README.md
```

## Sections

| Key | Section | What it is |
| --- | --- | --- |
| `1` | Overview | Statistics, the line map, stage cards, run controls, live terminal, approval, rollout and incident panels |
| `2` | Pipelines | The pipeline definition, and an editor with GitHub Actions YAML export |
| `3` | Deployments | Searchable, filterable, exportable history with details |
| `4` | Build History | Duration trend and stage-by-stage results |
| `5` | Environment | Network map of all environments, promotions, rollback, environment details |
| `6` | DORA Metrics | The four delivery metrics with bands and trends |
| `7` | Incident Drills | Guided troubleshooting scenarios with scoring and ranks |
| `8` | Chaos Mode | Random incidents to triage |
| `9` | Settings | Theme, simulation, data management, shortcuts |

The chat drawer (`C`), the guided tour (Tour button) and your **Profile** (the card at the bottom of the sidebar) are available from anywhere.

## Features

### The pipeline

- **Engine** — sequential and parallel async execution, per-stage status, timers and progress, cancellation, and a guard against simultaneous runs. Progress bars and train positions come from real elapsed time against each stage's planned duration; nothing animates independently of engine state. The engine has no DOM access and emits `update`, `log`, `gate` and `rollout` events.
- **Line map and stage cards** — SVG metro line with animated connectors and per-stage status, progress and duration.
- **Parallel tracks** — stages sharing a `parallel` group in `pipeline-config.json` run side by side. Testing and Security fork after Build on two tracks (each with its own train) and merge again before the approval stop. If one fails the other is cancelled (fail-fast). The terminal reports how much time parallelism saved. Groups must be contiguous and hold at most two stages.
- **Terminal** — timestamped, colour-coded live logs with auto-scroll, clear, copy and `.txt` download.
- **Failure and recovery** — failure simulation at a chosen stage or at random, readable errors with hints, and Retry that reruns the same commit with the fault cleared.
- **Approval gates** — the Manual Approval stage passes straight through for Development and Staging. Production is protected (`gate` in `environments.json`): the train stops, a panel with a countdown appears, and two reviewers other than the change's author must approve (four-eyes principle). A rejection or timeout stops the run as cancelled, not failed; the wait counts toward lead time. Settings can auto-approve with simulated reviewers.
- **Canary and blue/green rollouts** — Production deploys with a canary by default: traffic moves 10% → 50% → 100%, the new version's error rate is sampled against a 2% budget at every step, and two bad samples in a row roll everything back automatically. Promote now and Abort are available, and a traffic bar sits above the Deploy station. Blue/green moves all traffic in one switch. Choose a strategy per run in Settings or the Dispatch card; failure simulation at Deployment injects a bad release.
- **Rollback (the return train)** — each environment can return to its previous successful build. Only the Deploy stage runs, the train runs in amber, and a rolled-back build is never offered as a target again.
- **Network map and promotion** — all three environments on one map, with interchanges for promoting the live build to the next line.

### Learning

- **Guided tour** — a simulated run that pauses before every stop and explains what a real pipeline does there, what to watch for and the classic way it breaks. You can break a stage to see a failure. It adapts to your configured pipeline.
- **Incident drills** — seven scenarios where a real run fails; read the evidence, pick the fix, get scored (S to C) and ranked from Passenger to Station Master.
- **Chaos mode** — arm a game day (Calm, Normal or Wild) and random incidents strike a live environment: a bad release, memory leak, traffic spike, failing dependency or expired certificate. Pick a mitigation; wrong calls are explained and cost points, a correct rollback is a real rollback run. Resolved incidents feed the DORA board.
- **DORA metrics** — deployment frequency, lead time, change failure rate and time to restore, computed from your history with simplified Elite / High / Medium / Low bands, daily trends, a focus-area suggestion, failure hotspots and recent restores. Releases that caused incidents count as failed changes, and incident time counts toward time to restore.

### Working with it

- **Pipeline editor** — rename, reorder, switch off, pair as parallel and add stages from a library (lint, end-to-end tests, license audit, performance test, database migration, smoke test). Apply switches the whole app to your pipeline. Deployment is required. The YAML panel exports a GitHub Actions workflow (Git stage as trigger, other stages as jobs, parallel stages sharing `needs`). The YAML is a starting point to review, not a drop-in workflow.
- **ChatOps** — a chat drawer with `#deployments` and `#incidents` channels. A bot posts live cards for deploys, rollbacks, approvals (with working Approve and Reject buttons), canary aborts and incidents, with unread and `@here` badges. Slash commands drive the real actions without changing your page: `/help`, `/status`, `/deploy <env>`, `/rollback <env>` (asks to confirm), `/promote <from> <to>`, `/approve`, `/reject [reason]`, `/retry`, `/cancel`, `/dora`.
- **Profile** — your identity in the app: display name, role, team and avatar colour, shown in the sidebar and as your name in ChatOps, plus the reviewer you act as by default at the approval gate. It also shows your activity in numbers, 15 achievement badges earned from real use (first run, five deploys in a row, Production, rollback, approving and rejecting, a canary saving you, drills, chaos incidents, a custom pipeline, chat commands, finishing the tour) that raise your level from Trainee to Principal, and a recent-activity timeline. Demo history, drills and tours are not counted as your runs. **Download backup** saves everything in this browser to a JSON file, and **Restore backup** loads one back after a confirmation.
- **Deployments and exports** — history table with search and filters, details dialog, JSON and CSV export.
- **Interface** — light / dark / system theme, responsive layout down to phone width, collapsible sidebar, command palette, toasts, confirmation dialogs, empty and loading states, and persisted preferences.

Drill, tour and chaos activity is kept out of the headline statistics where it would distort them: drill and tour runs are tagged and excluded from Overview statistics, live builds and DORA.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl` / `⌘` + `K` | Command palette |
| `R` | Run pipeline |
| `X` | Cancel the running pipeline |
| `Shift` + `R` | Retry the last failed or cancelled run |
| `T` | Toggle theme |
| `C` | Open or close ChatOps |
| `1` – `9` | Jump to a section |
| `/` | Search deployments |
| `?` | Show shortcuts |
| `Esc` | Close dialogs, the tour or the chat drawer |

## A five-minute demo

1. **Tour** — press the Tour button, ride to Production, and read the stops.
2. **Approval and canary** — run the pipeline to Production. Approve as two reviewers and watch traffic shift 10% → 50% → 100%.
3. **Auto-rollback** — turn on Failure simulation, pick Deployment, run again, and watch the canary abort and roll back by itself.
4. **Chaos** — open Chaos Mode, arm it, press Strike now and fix the incident.
5. **DORA** — open DORA Metrics and see the incident reflected in time to restore.
6. **Pipeline as code** — in Pipelines → Editor add a stage, run two side by side, Apply, and copy the YAML.
7. **ChatOps** — press `C` and type `/status`, `/deploy staging` and `/dora`.

## Code organisation (`script.js`)

1. **Utilities** — formatting, escaping, download and clipboard helpers.
2. **Store** — loads, validates and saves preferences, history, drill scores, incidents, the custom pipeline and chat in LocalStorage.
3. **PipelineEngine** — waves of parallel stages, gate, rollout, fail-fast and cancellation. No DOM access.
4. **App state** — preference validation, statistics, demo seeding, run orchestration.
5. **Feature modules** — map layout, DORA, drills, rollback and promotion, pipeline editor, approval, rollouts, tour, chaos and ChatOps, each with its own render and action functions.
6. **Rendering** — view functions that paint from state.
7. **Overlays** — modal, command palette, toasts.
8. **Actions and events** — one delegated click handler dispatches every `data-action` control.
9. **Boot** — fetches and validates the JSON files, then starts the app.

## Customising

- Add, remove or retime stages in `data/pipeline-config.json`, or use the editor. Each stage's `ci` entry defines how it appears in the exported YAML.
- Edit environments, the approval gate and canary settings in `data/environments.json` (`line` may be `blue`, `orange` or `green`).
- Add incidents or mitigations in `data/chaos.json`, drill scenarios in `data/drills.json`, and tour copy in `data/tour.json`.
- Change the demo repository, branches, commits and seed history in `data/demo-data.json`. Use **Settings → Restore demo data** to reload the seed history, or **Reset everything** to start fresh.

## Known limitations

- All timings and error rates are generated; the DORA bands are a simplified teaching version, and simulated pipelines finish in seconds, so lead time and restore time read as elite.
- Data lives in the browser's LocalStorage, so it is per browser and per address.
- Seeded demo history uses the default pipeline, so it can look slightly different if you customise the pipeline.
- The exported YAML has not been run against a real CI system.
