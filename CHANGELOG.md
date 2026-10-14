# Changelog

Goal Lite follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). This changelog records changes relevant to people using the plugin or contributing to the repository.

## [0.1.0] - 2026-10-13

### Added

- A completed session goal can be reopened for missing work without losing its prior completion history. Reopening requires fresh evidence and a new reviewer pass when a reviewer is configured.
- Project-local skills for test-first work, commit checks, clear documentation, changelog entries, and commit messages; a `/shipit` command checks the release gates before remote handoff.
- A pre-commit hook and CI checks for formatting, type checking, builds, and tests.

### Changed

- The README now explains the OpenCode V2 goal workflow and shows how to install the plugin from a checkout.

### Fixed

### Deprecated

### Breaking changes

### Security

- Updated the locked `http-cache-semantics` dependency to a version that fixes [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).
