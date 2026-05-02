# Marker Scanner

React Native assignment implementation for the Alemeno custom-marker brief. This project targets `Marker1` from the provided assets and uses a shared pure-TypeScript detector so the same logic can be exercised on fixture images and on-device camera captures.

## What the app does

- Opens a live Android camera preview with React Native via Expo.
- Selects the closest supported capture size in the `2000px` to `3000px` range.
- Captures frames while scanning, searches each frame for `Marker1`, corrects orientation, and extracts a tightly cropped `300x300` result.
- Keeps the first `20` accepted detections and shows them in the UI.

## Project structure

- `App.tsx`: camera screen, scan loop, result gallery, and UI state.
- `src/lib/marker`: marker detection, perspective warp, orientation correction, and JPEG encode/decode helpers.
- `fixtures/marker1`: copied assignment samples for local validation.
- `scripts/validate-fixtures.ts`: fixture test runner that verifies correct images are detected and incorrect images are rejected.
- `scripts/render_approach_pdf.py`: regenerates the approach PDF from `APPROACH.md`.
- `APPROACH.md`: delivery notes you can turn into the required explanation PDF.
- `deliverables/Alemeno-Approach.pdf`: generated approach PDF for submission.

## Setup

```bash
npm install
npm run typecheck
npm run validate:fixtures
npm start
```

To open the Android build locally, use:

```bash
npm run android
```

## Validation

The fixture validator writes extracted `300x300` outputs to `artifacts/validation/` for the positive cases.

```bash
npm run validate:fixtures
```

## Notes

- This implementation focuses on `Marker1`, which is allowed by the brief because only one of the two provided markers needs to be used.
- The detector rejects empty or near-empty frames by checking for both the marker geometry and visible encoded content inside the border.
- I did not generate an APK in this workspace because an Android SDK / device build pipeline was not configured here, but the project is scaffolded to run through Expo on Android.
