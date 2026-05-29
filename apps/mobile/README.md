# Mobile App

## Android Development Build

`@react-native-ml-kit/text-recognition` is a native module, so OCR does not run inside Expo Go. Use an Expo Development Build on Android for real OCR testing.

### One-time setup

```bash
npm i -g eas-cli
eas login
```

### Build the Android dev client

```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
eas build --profile development --platform android
```

Rebuild the Android dev client whenever the OCR native dependency changes.

### Run the Metro server for the dev client

```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
npx expo start --dev-client
```

### Install and open on device

1. Install the generated APK on your Android device.
2. Open the installed development build app, not Expo Go.
3. Scan the QR code from `npx expo start --dev-client`.

### Expo Go behavior

Expo Go can still open the app for general navigation, but tapping OCR shows:

- `無法使用 OCR：請安裝開發版 App (OCR unavailable: please install the development build)`

Use the development build whenever you need real on-device OCR.

## OCR Engine

The app now uses `@react-native-ml-kit/text-recognition`.

- Native OCR entrypoint stays in `src/ocr/ocr.ts`
- Device OCR runs Chinese script recognition first
- The wrapper also runs Latin recognition and merges unique lines so mixed Chinese + English medicine text is more stable
- Web still uses the demo OCR fallback for testability

## OCR Troubleshooting

- If OCR says `無法使用 OCR：請安裝開發版 App (OCR unavailable: please install the development build)`, install the Android development build and open that app instead of Expo Go.
- If Chinese text is not being detected well, confirm the OCR path in `src/ocr/ocr.ts` is using `TextRecognitionScript.CHINESE`.
- After adding, removing, or changing the native OCR dependency, rebuild the Android development client before testing again.
