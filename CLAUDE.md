# Native Interaction Runtime

Native macOS app interaction and QA via Peekaboo CLI.

## Versioning

SemVer. Source of truth: `VERSION` file. Status: `docs/PROGRESS.md`. Backlog: `docs/TODOS.md`.

## Testing

Run the validation gates:

```bash
./scripts/validate.sh
```

To test against a specific app:

```bash
./scripts/validate.sh --app "MyApp"
```

To run a single gate:

```bash
./scripts/validate.sh --gate 1  # AX Tree Quality
./scripts/validate.sh --gate 2  # Interaction Reliability
./scripts/validate.sh --gate 3  # Latency
```

## Native App

Configure these for build integration:

```yaml
native_app_bundle_id: ""
native_app_scheme: ""
# native_workspace_path: ""
# native_build_configuration: "Debug"
# native_launch_args: ""
# native_build_timeout: 120
```

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
