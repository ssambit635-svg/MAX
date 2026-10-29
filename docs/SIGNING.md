# Code signing

The Windows installer in [`build.yml`](../.github/workflows/build.yml) is unsigned
until a certificate is provided. Everything else is wired: the moment a certificate
exists as repository secrets, the same workflow signs the installer, the portable exe
and the uninstaller, and auto-update starts from a trusted publisher.

## What you need

An **Authenticode code-signing certificate** — either

- an EV/OV certificate from a CA (DigiCert, Sectigo, GlobalSign…), or
- a **cloud signing** subscription (Azure Trusted Signing, DigiCert KeyLocker), which
  is what new projects should use: no USB token, and the key never touches the runner.

## Wiring it up (certificate as a file)

1. Export the certificate as a `.pfx` with a password.
2. Base64 the file:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("max-sign.pfx")) | Set-Clipboard
   ```

3. Add two repository secrets (`Settings → Secrets and variables → Actions`):

   | Secret | Value |
   | --- | --- |
   | `CSC_LINK` | the base64 blob |
   | `CSC_KEY_PASSWORD` | the `.pfx` password |

4. Re-run **Build MAX**. `electron-builder` picks these up with no config change —
   `win.signingHashAlgorithms` is already `sha256`, and the `nsis` installer plus the
   portable exe both get signed.

## Wiring it up (Azure Trusted Signing)

Add these secrets instead, then flip the `azureSignOptions` block in
`app/package.json`:

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID` | tenant id |
| `AZURE_CLIENT_ID` | app registration id |
| `AZURE_CLIENT_SECRET` | app registration secret |

```json
"win": {
  "azureSignOptions": {
    "publisherName": "Your legal name",
    "endpoint": "https://eus.codesigning.azure.net",
    "certificateProfileName": "max",
    "codeSigningAccountName": "your-account"
  }
}
```

## Checking it worked

```powershell
Get-AuthenticodeSignature .\MAX-Setup-0.4.0.exe | Format-List Status, SignerCertificate
```

`Status` must be `Valid`. If it says `NotSigned`, the secrets are not visible to the
workflow (they are not passed to pull requests from forks — that is deliberate).

## Without a certificate

Nothing breaks: builds are simply unsigned. SmartScreen shows a warning on first run,
and auto-update still works because it verifies the release file hashes in
`latest.yml`. Signing is about trust in the publisher, not about the update path.
