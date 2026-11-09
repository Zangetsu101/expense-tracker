# Google Drive backups

Automatic backups use the Drive REST API with the `drive.file` scope. See [ADR 0007](adr/0007-google-drive-backups.md) for the decision.

## Set up Google Cloud

Do this once for each Google Cloud project.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, for example "Expense Tracker".
2. Open **APIs & Services → Library**, then turn on the **Google Drive API**.
3. Open **Google Auth Platform → Branding** (the OAuth consent screen). Set the app name and the support email.
4. Open **Audience**. Keep the publishing status **Testing**, and add each Google account that will sign in as a **test user**. In Testing, Google allows only these accounts.
5. Open **Data Access → Add or remove scopes**. Add `https://www.googleapis.com/auth/drive.file`.
6. Open **Clients → Create client → Android**. Make one client for each build:

   | Build        | Package name                              | SHA-1                                                                                      |
   | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
   | Release APK  | `com.zangetsu101.expensetracker`          | SHA-1 of `release.keystore`                                                                |
   | Emulator APK | `com.zangetsu101.expensetracker.emulator` | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (the React Native debug key) |

   To get the SHA-1 of the release key, run:

   ```sh
   keytool -list -v -keystore release.keystore -alias expense-tracker
   ```

The app needs no client ID or secret in the code. Google Play services finds the Android client from the package name and the signing key.

## Troubleshooting

- `DEVELOPER_ERROR` at sign-in: the package name or the SHA-1 does not agree with an Android client in the project.
- "Access blocked" or "has not completed the Google verification process": add the account as a test user.
- Sign-in on the emulator needs an image with Google Play services (`google_apis` or `google_apis_playstore`) and a Google account on the device.
