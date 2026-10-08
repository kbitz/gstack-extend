# Notes — Project spec

## Authority
This is the current authority for product scope, target and release policy.
Supporting documents own only the roles listed below.

## Purpose
The owner searches their local Markdown notes from the terminal.

```mermaid
graph LR; Notes-->Index-->Search
```

## Audience and target
- Current users: the owner
- Audience ceiling: personal-only
- Selected target: MVP-1
- Supported conditions: two personal Macs, notes under 10,000 files
- Current achieved stage and evidence: see PROGRESS.md

## Selected target acceptance
### O1: Find a known note
1. Searching a known phrase returns its file on each supported Mac.

## Release policy
- Before public-beta: ordinary releases default to patch
- Strict SemVer from: public-beta

## Deferral policy
- Destination: local docs/roadmap-future.md
- Promotion: trigger observed, then reassess against the selected target
