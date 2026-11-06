# Expense Tracker

A local-first personal finance app built with Expo, React Native, and SQLite. Track expenses and income across accounts, import MoneyLover history, and keep portable backups of your data.

## Features

- Amount-first quick entry, with categories, dates, notes, and tags.
- Accounts with separate currencies and same-currency transfers.
- Transaction search and filters, monthly summaries, and spending by category.
- Lending and borrowing tracked by person and currency.
- MoneyLover CSV import with duplicate detection and review of uncertain transfers.
- JSON backup and restore, plus CSV export for portability.

## Status

This project is under active development. Android has been exercised in Expo Go; iOS has not yet been device-verified. Web is not a verified target.

Keep an independent copy of your financial records before trying imports or restore. CSV export is not a full backup. Automatic scheduled backups are not implemented, and backup values above JavaScript's safe integer limit cannot round-trip reliably.

## Run locally

Use Node.js 22.19 or newer and pnpm 10.33.2, as pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open the project in an Expo Go version compatible with Expo SDK 57. You can also start directly on a configured Android emulator or iOS simulator:

```sh
pnpm android
pnpm ios
```

The iOS simulator requires macOS and Xcode. No backend service or API credentials are required.

## Checks

```sh
# TypeScript
pnpm typecheck

# Tests, including SQLite integration and component checks
pnpm test

# Backup format fixtures
pnpm test:backup

# ESLint, with warnings treated as failures
pnpm lint

# All of the above
pnpm check
```

## Android APK releases

Use **GitHub Actions → Build Android APK → Run workflow** on `main` to build a signed ARM64 APK and create a draft GitHub prerelease. See [Android releases](docs/android-release.md) for required secrets, device testing, automatic OTA updates, and the local `pnpm android:apk` fallback. Signing credentials stay outside Git.

## Project layout

- `src/app/`: Expo Router screens.
- `src/components/`: shared UI components.
- `src/lib/`: finance logic, SQLite access, import/export, and tests.
- `src/theme.ts`: shared theme.
- `scripts/fixtures/`: backup format fixtures.
- `docs/product.md`: intended behavior and scope.
- `docs/adr/`: architectural decisions.
- `CONTEXT.md`: domain terminology.

## Financial data and contributions

Do not commit real financial exports, backups, databases, credentials, or screenshots containing personal information. Use synthetic examples in tests and bug reports. CSV exports, local databases, environment files, and `.private/` are ignored by default, but JSON backups still require care.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE). Bundled third-party material retains its own license notices.
