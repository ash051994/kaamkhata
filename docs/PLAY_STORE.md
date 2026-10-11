# Launching KaamKhata on Google Play

A practical checklist, in order. Policies change — check the Play Console help pages when you get to each step.

## 1. Create the signing key (once, keep it forever)

On your computer with Java installed:

```bash
keytool -genkeypair -v -keystore kaamkhata-release.jks -alias kaamkhata \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep the `.jks` file and both passwords somewhere safe (password manager + an offline copy). Losing it means you cannot update the app. Never commit it to git.

Add it to the repo as GitHub Actions secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `KEYSTORE_BASE64` | output of `base64 -w0 kaamkhata-release.jks` |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | `kaamkhata` |
| `KEY_PASSWORD` | key password |

The next push builds `KaamKhata-release.aab` (upload this to Play) and a signed APK. Tag a version to get them on a GitHub release:

```bash
git tag v1.0.0 && git push --tags
```

## 2. Play Console account

- Register at play.google.com/console (one-time fee, US$25).
- New **personal** accounts must run a **closed test with at least 12 testers opted in for 14 days in a row** before production access. Plan for this: ask contractor friends, family and colleagues with Android phones to join early.
- An organisation account (needs a D-U-N-S number) skips that rule — worth it later if you register a business.

## 3. Store listing (draft copy)

**App name:** KaamKhata – Contractor Register

**Short description (80 chars):**
Workers, attendance, wages, PF/ESIC & advances for labour contractors. Offline.

**Full description:**

> Run your labour contracting business from your phone — no register book, no calculator, no internet needed.
>
> Made for contractors who supply workers to factories in MIDC and industrial areas.
>
> WORKERS
> • Add workers with photo, company, work, daily rate or monthly salary
> • Fill details by speaking — English, Hindi or Marathi
> • Aadhaar, PAN, IFSC, UAN and mobile numbers checked as you type
> • Photograph documents and mark them verified
>
> ATTENDANCE
> • One tap per worker: present, absent, half day
> • Leave, weekly off, holidays and overtime
> • Monthly register for the company
>
> WAGES AND MONEY
> • Wages worked out automatically from attendance
> • PF, ESIC and Maharashtra profession tax
> • Advances, recovery and part payments tracked per worker
> • See who is still to be paid
>
> REPORTS
> • Payslips, wage register, attendance register, PF & ESIC summary
> • PDF or Excel, share on WhatsApp in one tap
>
> PRIVATE BY DESIGN
> • All data stays on your phone. No sign-up, no server.
> • PIN lock and backup file

**Category:** Business · **Tags:** payroll, attendance, HR

**Privacy policy URL:** https://ash051994.github.io/kaamkhata/privacy.html

**Graphics:** icon 512×512 is `www/icons/icon-512.png`. Phone screenshots are in `docs/screenshots/` (Play wants 2–8, 9:16 or 16:9; retake on a real phone for the store). You also need a 1024×500 feature graphic.

## 4. Forms in Play Console

- **Data safety:** the app does not collect or share user data (everything is stored on-device, no network calls). Microphone audio is processed by the device's speech service and not stored by the app.
- **Permissions:** `RECORD_AUDIO` — used only when the user taps the microphone to fill worker details by voice.
- **Content rating:** questionnaire → business app, no user-generated content shared.
- **Target audience:** 18+.
- **Ads:** none.
- **Financial features:** the app records wages paid offline; it does not move money. Declare accordingly.

## 5. Making money from it

Suggested path, simplest first:

1. **Free launch** to get real contractors using it and collect feedback (WhatsApp groups of contractors, MIDC associations, Facebook groups, local tea-stall word of mouth at factory gates).
2. **Freemium with Google Play Billing:** free for up to 15 workers; ₹999/year or ₹149/month for unlimited workers, multiple companies and Excel export. Payments for digital features must go through Play Billing.
3. **Setup service:** for ₹2,000–5,000, import a contractor's existing worker list and train them once. This often earns more early on than subscriptions.
4. **Later:** encrypted Google Drive backup and multi-device sync as a premium feature (needs a small backend).

## 6. Before each release

```bash
node tests/unit.mjs
npm run serve & node tests/smoke.mjs
# bump "version" in package.json, then
git tag vX.Y.Z && git push --tags
```

`versionCode` is set from the GitHub Actions run number automatically, so it always increases.
