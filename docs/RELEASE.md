# Releasing MAX

A tag is the only thing that publishes. Everything else builds and checks.

```bash
# 1. bump the version in one place
cd app && npm version patch --no-git-tag-version   # or minor / major
npm install --package-lock-only --ignore-scripts   # the lockfile must agree

# 2. add the release notes the app will show, in src/lib/changelog.ts
#    (the gauntlet fails if the newest entry is not the package version)

# 3. check it like CI does
npm test && npm run qa

# 4. commit, tag, push
git commit -am "0.6.1"
git tag v0.6.1
git push origin main --tags
```

`Release MAX` then builds Windows, macOS and Linux, and publishes a GitHub
Release with the notes written in step 2. If the tag does not match
`package.json`, the publish job fails on purpose rather than shipping a version
nobody can identify.

## What gets published

| Platform | File | Install |
| --- | --- | --- |
| Windows | `MAX-<version>-win-x64.exe` | Run the installer. |
| Windows | `MAX-<version>-portable.exe` | Run it, nothing is installed. |
| macOS | `MAX-<version>.dmg` (arm64 + x64) | Open, drag to Applications. |
| Linux | `MAX-<version>.AppImage` | `chmod +x MAX-*.AppImage && ./MAX-*.AppImage` |
| Every platform | `latest*.yml` | What the in-app updater reads. |

Windows is built first and is required: if it fails, nothing is published.
macOS and Linux are allowed to fail without stopping the release (see below).

## The honest bit: these builds are unsigned

Signing identities cost money, so the default is unsigned and the install pages
say so. That means:

- **Windows** shows *"Windows protected your PC"*. Click **More info → Run
  anyway**. This appears whenever an installer is not signed by a certificate
  Windows already trusts; it is not a virus warning.
- **macOS** shows *"Apple cannot check it for malicious software"*. Right-click
  the app → **Open** → **Open** again, or run
  `xattr -dr com.apple.quarantine /Applications/MAX.app`.
- **Linux** needs the executable bit, which the download may strip.

### When you have certificates

Nothing in the pipeline changes shape, only secrets get added:

| Secret | What it does |
| --- | --- |
| `CSC_LINK` (base64 `.pfx`) + `CSC_KEY_PASSWORD` | Signs the Windows installer and the app, so SmartScreen is quiet. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarizes the macOS disk image so Gatekeeper opens it without a warning. |
| `WIN_CSC_LINK` | A second Windows identity, if you want a separate one for portable builds. |

`release.yml` sets `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` only so an unsigned
runner never fails looking for a keychain identity. Remove that line once the
secrets exist, and electron-builder signs automatically.

## Updating

The installed app checks `latest.yml` from the newest release. It only checks
when `app.isPackaged` is true, so a development build never calls home. Updates
are downloaded in the background and applied when you choose **Restart to
update** in Settings.

## Rolling back

1. Delete the release on GitHub (the tag stays).
2. Fix forward and tag `v<next>`.

Deleting the *tag* as well makes existing installs fail their update check for
one cycle and then recover — they never uninstall, because the app data lives in
`%APPDATA%\MAX` and is untouched by installers.
