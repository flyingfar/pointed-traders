# Pointed — Traders@UST edition

A live, Kahoot-style version of Bloomberg's *Pointed* news quiz for the Monday meeting.
The projector shows the questions, everyone plays on their phone, and **only accuracy and risk-taking score — never speed.**

| Page | Who | What |
|---|---|---|
| `admin.html` | Committee | Write and edit weekly quizzes, import JSON, launch games, manage admins |
| `host.html?pin=…` | Lecture-room PC → projector | Lobby with QR code → categories → questions → reveal → standings → podium |
| `index.html` | Everyone's phone | Join with PIN → allocate 100 pts → play a lever (optional) + answer → see P&L and rank |

## Rules
1. **Allocate:** split 100 points across the 10 categories *before* seeing any question. Each category needs **5–30 points**.
   Everyone starts with an even split (10 each); anyone who doesn't lock in plays with that default. (Min/max/budget are editable per quiz.)
2. **Win or lose your stake:** a right answer adds that category's stake, a wrong one subtracts it.
   After reading a question you may play one of three levers. **Each works once per game**, and gains and losses scale the same way:

   | Choice | Right | Wrong |
   |---|---|---|
   | No lever (default) | +stake | −stake |
   | 0.5× Hedge | +½ stake | −½ stake |
   | 2× | +2× stake | −2× stake |
   | 3× | +3× stake | −3× stake |

   The strategy is to save 3× for the question you're surest of and the hedge for the one you're least sure of.
3. **Answer:** there's an optional timer (30s by default) but no speed bonus. The question reveals automatically when everyone has answered or time runs out.
4. **Podium:** top 3 on the projector, and every phone shows its own rank plus a per-question P&L breakdown. The host can download the results as CSV.

## Try it locally (demo mode, no setup)
```bash
python3 -m http.server 8787
```
Open `http://localhost:8787/admin.html` → **Launch** → open `index.html` in a couple of other tabs to play.
Demo mode stores everything in `localStorage`, so it syncs only between tabs of one browser.

## Go live for $0 (Firebase Spark plan, no credit card)
1. Go to <https://console.firebase.google.com> → **Add project** (you can turn Analytics off).
2. **Build → Realtime Database → Create database** (pick the Singapore region, start in *locked mode*).
3. **Build → Authentication → Get started**, then enable **Anonymous** (for players) and **Email/Password** (for admins).
   - Under **Users → Add user**, create an account for each committee admin.
4. **Project settings → Your apps → Web (</>)** → register the app → copy the `firebaseConfig` object into `js/config.js` (`firebase: { ... }`).
   Make sure it includes `databaseURL`.
5. Make the first admin: in **Realtime Database → Data**, add the key `admins` → child `<that user's UID>` = `true`.
   (Find the UID in Authentication → Users. After that, admins can add other admins from the dashboard.)
6. Deploy the security rules and the site:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy             # deploys database.rules.json + hosting
   ```
   Your game is now at `https://<project>.web.app`. Players open `/` and admins open `/admin.html`.

   *Alternative hosting:* push this folder to a GitHub repo and turn on GitHub Pages. You'll still need to paste
   `database.rules.json` into Realtime Database → Rules yourself.

### Free-tier limits (Spark)
- **100 simultaneous connections** on the Realtime Database, so about 95 players plus the host. That's plenty for a lecture room.
- 1 GB stored and 10 GB/month downloaded. A 50-person game uses only a few MB.
- Delete old games from the admin dashboard every so often.

## Weekly workflow
1. Over the weekend: on the admin page, click **Copy AI prompt**, paste it into Claude or ChatGPT along with the week's headlines, then **Import JSON**.
   (Or click **New quiz** and write the questions by hand.)
2. **Fact-check** every question in the editor. The green letter marks the correct option. Save.
3. Monday: open the admin page on the lecture-room PC → **Launch** → press **F** for fullscreen on the projector. Advance with **Space / →**.

## Security model
- Players sign in anonymously. They can only write their own name and allocation (lobby/allocation phase only), plus **one** answer per question while that question is open.
- Correct answers live in `quizzes/` and `hostdata/`, which only admins can read. Phones get the answer only at the reveal.
- The host recomputes every score from the raw answers, so reused levers or out-of-range allocations are ignored.
- Known limitation: a technical player could read other players' answers while a question is open. That's fine for a club game.

## Files
```
index.html / host.html / admin.html
css/style.css         Bloomberg-Pointed-style UI (white/#f6f7fc, black buttons, Inter)
js/config.js          ← paste Firebase config here
js/db.js              Firebase Realtime DB adapter + local demo mock
js/game.js            scoring rules, sample quiz, AI prompt
js/player.js / host.js / admin.js
database.rules.json   Realtime Database security rules
firebase.json         Hosting + rules deploy config
```
