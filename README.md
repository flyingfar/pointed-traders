# Pointed — Traders@UST edition

A live quiz app for the Traders@UST Weekly Monday Meeting. The projector shows the questions and everyone plays on their phone.
It has two game modes:

| Mode | Used for | Scoring |
|---|---|---|
| **Pointed** | Opening warm-up: last week's market headlines (modelled on Bloomberg's *Pointed*) | Accuracy and risk-taking only. Allocate points blind, lever up or hedge, no speed bonus |
| **Quickfire** | Closing recap: tests the education session (Kahoot-style) | Accuracy **and** speed. No categories, no allocation |

| Page | Who | What |
|---|---|---|
| `admin.html` | Committee | Write and edit weekly quizzes, import JSON, launch games, manage admins |
| `host.html?pin=…` | Lecture-room PC → projector | Lobby with QR code → categories → questions → reveal → standings → podium |
| `index.html` | Everyone's phone | Join with PIN → (Pointed: allocate + lever) → answer → see points and rank |

## Pointed rules
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

## Quickfire rules
1. **One tap locks in.** The question shows on the projector and the phones with a countdown (20s by default). There's no confirm button.
2. **Right + fast:** a right answer scores `1000 × (1 − time taken ÷ time limit ÷ 2)`, so about 1,000 for an instant answer and 500 on the buzzer.
   A wrong or missing answer scores 0. Max points and seconds per question are editable per quiz.
3. **Fair timing:** the question start and each answer are stamped by the **database server's clock**, and the security rules reject any other
   timestamp. Phone clocks and lag can't be gamed.
4. The reveal shows the fastest correct answer, how many got it right, and the average answer time. The podium adds *Fastest finger* and *Sharpest*.

## Try it locally (demo mode, no setup)
```bash
python3 -m http.server 8787
```
Open `http://localhost:8787/admin.html?demo` → **Launch** → open `index.html?demo` in a couple of other tabs to play.
Demo mode stores everything in `localStorage`, so it syncs only between tabs of one browser. It's used automatically when
`js/config.js` has no Firebase config, and `?demo` forces it (for that tab) even when Firebase is configured, so you can test without touching live data.

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
1. Before the meeting, on the admin page, click **Copy Pointed AI prompt** (paste in the week's headlines) or **Copy Quickfire AI prompt** (fill in the session topic).
   Run it in Claude or ChatGPT, then **Import JSON**. The JSON's `"mode"` field picks the mode. You can also write questions by hand with **+ New … quiz**.
2. **Fact-check** every question in the editor. The green letter marks the correct option. Save.
3. At the meeting: open the admin page on the lecture-room PC → **Launch** → press **F** for fullscreen on the projector. Advance with **Space / →**.
   Pointed opens the meeting and Quickfire closes it.
4. Keep drafts in `quiz-drafts/`. That folder is never published to the website, but it **is** in the GitHub repo, which must stay private.

## Security model
- Players sign in anonymously. They can only write their own name and allocation (lobby/allocation phase only), plus **one** answer per question while that question is open,
  and the answer must carry the server's timestamp.
- Correct answers live in `quizzes/` and `hostdata/`, which only admins can read. Phones get the answer only at the reveal.
- The host recomputes every score from the raw answers, so reused levers or out-of-range allocations are ignored.
- Known limitation: a technical player could read other players' answers while a question is open. That's fine for a club game.

## Files
```
index.html / host.html / admin.html
css/style.css         Bloomberg-Pointed-style UI (white/#f6f7fc, black buttons, Inter)
js/config.js          ← paste Firebase config here
js/db.js              Firebase Realtime DB adapter + local demo mock
js/game.js            mode-independent logic: leaderboard ranking, quiz validation
js/modes/index.js     game-mode registry. Add a mode by creating js/modes/<id>.js and listing it here
js/modes/pointed.js   Pointed: allocation, levers, P&L scoring, its screens, sample quiz, AI prompt
js/modes/quickfire.js Quickfire: speed + accuracy scoring, its screens, AI prompt
js/player.js / host.js / admin.js   shared flow (join → lobby → questions → reveal → standings → podium)
quiz-drafts/          weekly quiz JSON (holds answers: excluded from hosting)
database.rules.json   Realtime Database security rules
firebase.json         Hosting + rules deploy config
```
