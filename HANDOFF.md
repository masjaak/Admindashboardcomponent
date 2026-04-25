# Admin Dashboard Handoff

## Repo

- Path: `/Users/masjak/Documents/Freshbloom/Admindashboardcomponent`
- Branch: `main`
- Date: `2026-04-26`

## Current Status

Admin dashboard sudah dipindahkan ke repo ini, bukan ke guest app repo.

Yang sudah selesai:

- rebuild `HouseApp` jadi admin dashboard tablet-first untuk iPad
- login flow manager/staff via Firebase Auth + `admin_users`
- live orders page dengan realtime Firestore subscription
- unread/new order notification state
- menu manager untuk add, edit, remove, dan toggle ready/unavailable
- feedback page untuk kritik dan saran tamu
- revenue page untuk daily summary + export `.xls`
- guest QR generator + revoke guest session action
- Capacitor iOS wrapper sudah dibuat
- app iOS sudah berhasil build dan launch ke iPad simulator
- test harness `vitest` sudah ditambahkan

## Files Added / Changed

- `src/components/house/HouseApp.tsx`
- `src/lib/firebase.ts`
- `src/lib/adminAccess.ts`
- `src/admin/session.ts`
- `src/admin/notifications.ts`
- `src/admin/revenue.ts`
- `src/admin/menuCatalog.ts`
- `src/admin/__tests__/session.test.ts`
- `src/admin/__tests__/notifications.test.ts`
- `src/admin/__tests__/revenue.test.ts`
- `src/admin/__tests__/menuCatalog.test.ts`
- `capacitor.config.ts`
- `vitest.config.ts`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `ios/`

## Verification Done

- `npm run test` ✅
- `npm run build` ✅
- `xcodebuild ... build` for iPad simulator ✅
- app launched on simulator bundle id `com.freshbloom.admindashboard` ✅

## Simulator State

- Active simulator: `iPad Pro 11-inch (M4)`
- Status when handoff written: booted and app launched

## Important Implementation Notes

- current login label says `Username / Email`, but actual auth still uses Firebase email + password
- manager/staff distinction currently comes from Firestore `admin_users/{uid}.role`
- role normalized to `manager` or `staff`
- revenue export is HTML-table-based `.xls`, suitable for Excel open/import
- QR creation and revoke session use Firebase Functions through `src/lib/adminAccess.ts`
- Capacitor shell includes Cordova compatibility layer automatically through Capacitor iOS runtime

## Commands

Install deps:

```bash
npm install
```

Run web:

```bash
npm run dev
```

Run tests:

```bash
npm run test
```

Build web:

```bash
npm run build
```

Capacitor sync:

```bash
npm run cap:sync
```

Open Xcode project:

```bash
npm run ios:open
```

## What Is Still Not Finished

### High priority

- connect menu manager to the exact same menu source used by guest app
- confirm Firestore collection contract with guest app repo
- verify real production field names for `orders`, `products`, `feedbackDetails`, `admin_users`
- add graceful empty/error/loading states for all admin panels
- add toasts or inline success/failure handling on every write action

### Auth / roles

- if user wants true `username + password` login instead of email login, add a real username lookup/auth strategy
- lock manager-only actions more strictly in UI and Firestore rules
- verify `staff` permissions vs `manager` permissions in backend rules, not UI only

### Guest app integration

- confirm guest app reads menu availability from same Firestore source
- if guest app still uses static menu constants, migrate guest app to shared Firestore menu source
- test end-to-end:
  guest place order -> admin sees new order
  admin changes menu availability -> guest app reflects it
  guest submits feedback -> feedback page updates

### Revenue

- validate whether delivered orders, completed orders, or both count as revenue in business rule
- add date range options beyond daily if needed
- add room / payment / staff filters if requested

### Feedback

- surface structured feedback fields more completely if hotel wants category breakdown charts
- add export for feedback if needed

### UI / UX polish

- tune spacing and typography against final Stitch reference screenshots one more pass
- replace placeholder brand assets/icon with final hotel assets
- add proper app icon and splash screen for iOS shell
- review responsiveness on more iPad sizes

### Native shell

- run `npm run cap:sync` after each production build when web code changes
- open Xcode and confirm signing/team settings if deploying beyond simulator
- optional: add live reload workflow for Capacitor if wanted

### Cleanup

- `build/` exists locally from production build and is now ignored
- repo has local uncommitted changes; review before commit
- consider splitting large `HouseApp.tsx` into smaller modules after feature behavior is stable

## Suggested Next Task Order

1. Align Firestore schema with guest app repo exactly
2. Verify end-to-end realtime order flow
3. Verify menu availability sync with guest app
4. Tighten auth/role backend enforcement
5. Polish UI against Stitch references
6. Finalize iOS app assets and native workflow
