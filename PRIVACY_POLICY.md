# Privacy Policy — Tikun Korim (תיקון קוראים)

**Last updated:** May 10, 2026

This policy describes how the mobile application **Tikun Korim** (“the App”) handles information when you use it. The App is published by the maintainer of the open-source project [tikunKorimApp](https://github.com/davinob/tikunKorimApp) on GitHub.

## Summary

The App is designed to work **without an account**. It does **not** sell your data, show third-party ads, or use analytics SDKs. The App stores **reading preferences and position only on your device** and may download **public content updates** from GitHub over the internet.

## Information the App processes

### Data stored on your device (not sent to us)

- **Reading state inside the WebView**, such as last-opened column, display options (e.g. vowels / cantillation toggles), and similar UI preferences — typically using the browser’s **local storage** mechanism inside the in-app WebView.
- **Copied reading content** — HTML, JavaScript, fonts, and text data the App saves under its **private app storage** so the reader can work offline after the first load.

We do not receive this data; it stays on your phone or tablet unless your device is backed up or synced by your operating system vendor under their own policies.

### Network access

The App declares **Internet** and **access network state** so it can:

- Check for and download **updates to reading content** from the **public GitHub repository** `davinob/tikunKorimApp` (branch `main`), using GitHub’s public API and `raw.githubusercontent.com`.
- These requests are **not tied to a user account** in the App. GitHub may log standard technical data (such as IP address and request metadata) under [GitHub’s privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).

If the network is unavailable, the App continues to use **content bundled with the app** and any content already stored on your device.

### Data we do not collect

- We do **not** ask for your name, email, phone number, or payment information in the App.
- We do **not** run **Firebase**, **crash reporting**, or **advertising** analytics in the App as shipped from this repository (see dependencies in `pubspec.yaml`).
- We do **not** access your contacts, photos, microphone, or location.

If this changes in a future version, this policy will be updated and the Play Store listing will reflect new practices where required.

## Children’s privacy

The App is suitable for general audiences, including families. We do not knowingly collect personal information from children. If you believe we should correct something, please contact us (see below).

## Changes to this policy

We may update this file when the App’s behavior changes. The **“Last updated”** date at the top will change, and updates will appear in the Git history of this repository.

## Contact

For privacy questions or requests, please open an issue on  
**https://github.com/davinob/tikunKorimApp/issues**  
or contact the publisher through the Google Play listing.

---

*This document is provided for convenience. It is not legal advice.*
