# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Dark/light theme switcher with auto (OS), light, and dark modes
- Theme toggle button in top header bar (before help icon)
- User preference saved in cookie with 1-year expiry
- FOUC prevention via inline script in `<head>`
- Smooth transitions between themes
- Dark mode scrollbar styling (WebKit)
- Semantic CSS variables for theming (`--color-bg`, `--color-surface`, `--color-text`, `--color-border`, etc.)
- Graph node color variables for dark mode support

### Changed
- Migrated hardcoded hex colors across all CSS files to semantic CSS variables
- Bumped version to 0.3.0 for cache busting

---

## How to Update This Changelog

When making changes to the project, add entries under the `[Unreleased]` section using these categories:

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** in case of vulnerabilities

When releasing a new version:
1. Change `[Unreleased]` to the version number and date `[X.Y.Z] - YYYY-MM-DD`
2. Create a new `[Unreleased]` section above it
3. Follow semantic versioning:
   - **Major (X.0.0)**: Breaking changes
   - **Minor (0.Y.0)**: New features, backward compatible
   - **Patch (0.0.Z)**: Bug fixes, backward compatible
