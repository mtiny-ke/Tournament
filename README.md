# Pool Tournament App (Android + Backend)

```
backend/   Node.js API (Express + SQLite): accounts, roles, referee uploads, super-user approval, public dashboard
mobile/    Android app (React Native / Expo): followers, referees, super user
```

## Roles
| Role | Can do |
|---|---|
| **User** (default for sign-ups) | Follow published results, group tables, bracket and player ranking |
| **Referee** | Everything a user can + upload match results (they stay hidden until approved) |
| **Super user** | Approve/reject/publish results, add players and groups, set tiebreaks, change roles, edit tournament settings and prizes |

Only the super user can make someone a referee. Followers only ever see **published** results.

## Rules built in (same as the Excel workbook)
48 players, 12 groups of 4, best of 3, each match win = 3 points, loss = 0. Top 2 per group + 8 best 3rd places = 32.
Same-group players cannot meet before the quarter-finals. Final + 3rd place playoff.
Ranking = elimination stage first, then performance in that stage only (knockout exits: frame difference in the match lost;
group exits: group record). Tied players share a rank. The engine was checked against the Excel workbook: identical rankings.

## 1. Run the backend
```bash
cd backend
npm install
ADMIN_PHONE=0712345678 ADMIN_PASSWORD='choose-a-strong-one' JWT_SECRET='long-random-text' npm start
npm test        # optional: full 104-match simulation incl. approval flow
```
The first start creates the super user from `ADMIN_PHONE` / `ADMIN_PASSWORD`. Data is stored in `tournament.db`
(set `DB_PATH` to a persistent disk location when hosting).

**Hosting:** any Node host with a persistent disk and HTTPS (Render, Railway, Fly.io, or a VPS). Set the three variables above.
Android blocks plain `http://` in release builds, so use an `https://` address.

## 2. Build the Android app (APK you can install on phones)
```bash
cd mobile
# edit config.js -> API_URL = 'https://your-server/api'
npm install
npx expo install --fix            # aligns package versions
npx expo start                    # test quickly with the Expo Go app
npm install -g eas-cli
eas login                         # free Expo account
eas build -p android --profile preview
```
EAS builds in the cloud and gives a download link to an **.apk** – share it, phones install it directly
(allow "install unknown apps"). For Google Play use `--profile production` (creates an .aab) and a Play developer account.
Change `android.package` in `app.json` to your own id (e.g. `com.yourname.pooltournament`) before the first build.

### Easiest way to get the .apk (no installs on your computer)
1. Create a free GitHub account and a new **private** repository; upload the contents of this folder (keep the `.github` folder).
2. Repo > Settings > Secrets and variables > Actions > New secret: name `API_URL`, value `https://your-server/api`.
3. Repo > Actions > **Build Android APK** > Run workflow. After ~10 minutes download **pool-tournament-apk** from the run page and unzip it.
4. Send the `.apk` to phones (WhatsApp, Drive, cable). Allow "install unknown apps" when asked.

## 3. First use
1. Log in as the super user. **Manage** tab: set tournament name, venue, dates and prizes; add the 48 players with their group (A–L).
2. Players/followers create accounts in the app. In **Manage → Accounts** make referees by tapping *referee*.
3. Referees open **Referee**, pick a match, tap the frames won, submit.
4. Super user opens **Approvals** and publishes (or rejects) each result. Everyone sees it on **Results** and **Ranking**.
5. After all 72 group matches are published the knockout draw is created automatically.

## Notes
- Results already published can't be changed if it would alter later published matches (protects the bracket).
- Tied for the last wildcard place or within a group? Super user can set a tiebreak (API: `PATCH /api/admin/players/:id/tiebreak`).
- Change the default `JWT_SECRET` before going live.
