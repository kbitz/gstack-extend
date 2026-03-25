# browse-native

See, interact with, and QA-test native macOS apps from Claude Code via [Peekaboo](https://peekaboo.dev) CLI.

## Prerequisites

- **Peekaboo CLI** — `brew install peekaboo` or download from [peekaboo.dev](https://peekaboo.dev)
- **macOS permissions** — Screen Recording and Accessibility (the skill will guide you through granting these on first run)

## Installation

Clone this repo into your project's `.claude/skills/` directory:

```bash
git clone git@github.com:kbitz/gstack-native.git .claude/skills/browse-native
```

Add `.claude/skills/browse-native` to your `.gitignore`:

```bash
echo ".claude/skills/browse-native" >> .gitignore
```

Claude Code will automatically discover the skill from `browse-native/SKILL.md`.

## Configuration

Add your app's details to your project's `CLAUDE.md`:

```yaml
## Native App
native_app_bundle_id: "com.example.MyApp"
native_app_scheme: "MyApp"
# native_workspace_path: "MyApp.xcworkspace"
# native_build_configuration: "Debug"
# native_launch_args: ""
# native_build_timeout: 120
```

## Usage

Once installed, use the `/browse-native` command in Claude Code to interact with your macOS app. The skill supports:

- **See-Act-See loop** — capture UI state, interact with elements, verify results
- **Dark mode testing** — toggle system appearance and compare screenshots
- **Window resize testing** — test layouts at different window sizes
- **Keyboard navigation audit** — verify Tab traversal and focus indicators
- **Accessibility audit** — check for missing labels, roles, and contrast issues
- **Crash detection** — detect and report app crashes with diagnostic logs

## Updating

Pull the latest version:

```bash
git -C .claude/skills/browse-native pull
```
