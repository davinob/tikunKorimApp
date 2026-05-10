# Tikun Korim — תיקון קוראים

A Flutter app for learning Torah reading in the classical
**"Ish Mazliach"** Tikun-Korim style: a 245-column scroll layout,
~42 lines per column, with vertical scroll inside a column and
swipe navigation between columns.

## Features

- **Authentic scroll layout** — 245 columns × ~42 lines, with
  proper *petucha* / *setumah* paragraph breaks, kashida-style
  letter-spacing justification, and special-case poetry layout
  for *Shirat HaYam* and *Ha'azinu*.
- **Three display modes** — tap any word (or use the top-bar
  pills) to cycle through *full* (nikud + ta'amim), *nikud only*,
  *ta'amim only*, and *consonants only* (Stam style).
- **Masoretic letter sizing** — *otiyot rabati* and *otiyot ze'irot*
  are rendered at the correct enlarged / reduced size, but only
  on the singled-out letter, not the whole word.
- **Monday / Thursday weekday stops** — small diamond markers
  appear at the exact verses where the weekday morning short
  reading stops, when ta'amim are shown.
- **Reading schedule** — defaults to *parashat hashavua*; the
  home page also exposes *chagim*, *rosh chodesh*, fasts, and
  the four special parashiyot. Switchable between *minhag eretz
  yisrael* and *minhag chu"l*.
- **Fast jump** — sefer / parasha / aliyah dropdowns from the
  reading view; full parasha grid from the home page.
- **Responsive** — column layout recomputes on rotation / resize.

## Tech stack

- **Flutter + WebView** (`flutter_inappwebview`) host running a
  local HTML/CSS/JS reader.
- **HTML/CSS/JS** for rendering, gesture handling, and display
  state. The reader is plain JS — no framework — so the WebView
  bundle stays small.
- **Hebrew typefaces**: Drugulin (Tikun-print style) and
  Stam Ashkenaz CLM, both bundled.

## Project layout

```
android/                     Android project (Flutter)
ios/                         iOS project (Flutter)
lib/                         Dart code (host shell + UpdateService)
assets/html/                 Reader frontend (HTML/CSS/JS)
assets/html/data/            Pre-built Torah JSON + layout
assets/html/fonts/           Bundled Hebrew typefaces
assets/icon/                 App-icon source PNGs
scripts/                     Test harnesses (test_engine.mjs, etc.)
```

## Running

Standard Flutter:

```bash
flutter pub get
flutter run                     # debug build on the connected device
flutter build apk --release     # release APK
flutter build appbundle         # release AAB for Play Store
```

Engine regression tests:

```bash
node scripts/test_engine.mjs
```

## Release signing (Android)

The release `signingConfig` reads credentials from
`android/key.properties`, which is **gitignored**. To produce a
release build, copy `android/key.properties.example` to
`android/key.properties` and fill in your own keystore details.

Without a `key.properties` file, release builds fall back to the
debug signing config (fine for local testing, not uploadable to
the Play Store).

## Privacy

See **[Privacy Policy](PRIVACY_POLICY.md)** (same file on GitHub — use this URL in Google Play Console after you push).

## License

This project bundles the GPL-2 licensed Culmus Hebrew typefaces
(Drugulin, Stam Ashkenaz CLM, Keter YG). See the font files for
their license terms.

The application code is © David Banon.
