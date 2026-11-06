# Settings data actions

Settings uses the existing theme and grouped, text-only action rows. Backup & restore contains Create backup and Restore from file; Import & export contains Export transactions CSV and Import from MoneyLover. CSV is a transaction portability format, not a full backup. Manage contains Lending & borrowing and Review transfer candidates. Updates and running-release details retain their existing behavior.

Data actions run directly from Settings. Restore first opens the file picker and validates the selected backup. Only a valid file triggers confirmation, showing its filename and explaining that Replace data replaces all current data. Cancellation and invalid files leave existing data intact; replacement remains atomic.

Progress, results, cancellation, and errors appear below the relevant row, with Retry on failure. While an operation is pending, data actions and other Settings controls are unavailable, leaving Settings is blocked, and back gestures are disabled. File pickers and confirmations can still be cancelled.

This changes organization and confirmation order, not platform support: backup creation still uses the existing Android document adapter. No cloud backup, scheduling, history, or last-backup tracking is introduced.
