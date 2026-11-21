# Family Picks ⚽

A free web app for the family's Saturday 3pm football picks game. Install it to the home screen on Android, iPhone and iPad.

## The rules it follows

- Each player picks **10 matches** that kick off at **3pm UK time** on Saturday. Players can pick from the English Premier League down to the National League, the Scottish Premiership down to League Two, and the NIFL Premiership.
- A match scores **1 point** if one team scores and **2 points** if both teams score. The maximum is **20**.
- Entry is **£10**. The highest score wins the pot, and a tie splits it equally.
- Picks lock at 3pm, and everyone's picks become visible then.
- **Postponed or abandoned:** the pick moves to the next 3pm match below it on Flashscore, in the same league. If it was the last match in its league, it moves to the first match of the next league down (Premier League → Championship → League One → League Two → National League, and the same in Scotland). It skips matches that are also off and matches the player already picked. After the National League, Scottish League Two or the NIFL Premiership, the player chooses a replacement on **My picks**. The admin can also set a postponement by hand.

## How it works (all free)

| Part | Service | Cost |
|---|---|---|
| The app (website) | GitHub Pages | Free |
| Logins, picks, results | Supabase free plan | Free |
| Fixtures and scores | ESPN's public scoreboard feed | Free |
| Automatic updates | GitHub Actions schedule | Free |
| Reading screenshots | Tesseract, running on the phone | Free |

Results update by themselves on **Friday evening** (to load fixtures) and on **Saturday at about 9am, 3:50pm, 4:30pm, 5pm and 5:30pm** UK time. GitHub can start these up to about 15 minutes late. During the games, the app also pulls live scores every 2 minutes while it's open. The admin has a **Refresh** button as well.

## One-time setup (about 15 minutes)

### 1. Create the database (Supabase)
1. Sign up free at <https://supabase.com> and create a new project. Pick the London region if it's offered.
2. Open **SQL Editor → New query**, paste in all of [`supabase/schema.sql`](supabase/schema.sql), then press **Run**.
3. Open **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". This lets the family sign up without a confirmation email. You can leave it on if you prefer.
4. Open **Authentication → URL Configuration** and set **Site URL** to the app's address from step 3 below.
5. Open **Project Settings → API** (or **API Keys**) and copy:
   - the **Project URL**,
   - the **anon / publishable** key, which goes in the app,
   - the **service_role / secret** key, which goes only into a GitHub secret. **Never put it in a file.**

### 2. Connect the app to the database
Edit [`js/config.js`](js/config.js) and paste in the Project URL and the anon/publishable key.

### 3. Turn on the website (GitHub Pages)
Open the repo's **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, then **main** and **/ (root)**, and save. A few minutes later the app is live at `https://<your-username>.github.io/familybettingapp/`.

### 4. Turn on automatic results
Open the repo's **Settings → Secrets and variables → Actions → New repository secret** and add:
- `SUPABASE_URL`: the Project URL
- `SUPABASE_SERVICE_KEY`: the service_role / secret key

Then open **Actions → Update results → Run workflow** once to check that it works. The log lists how many matches it found in each league.

### 5. Sign up first
**The first person to create an account becomes the admin.** Then send the link to the family:
- **iPhone / iPad:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in Chrome, tap **⋮**, then **Add to Home screen** (or **Install app**).

## Using it

- **My picks:** tap **Choose screenshot** and pick your Flashscore Favourites screenshot. The app ticks the matches it recognises, and marks with **check** any it found from only one team. Fix anything it got wrong, then tap **Save picks**. You can also just tick the matches yourself.
- **Saturday:** before 3pm it shows who's in and the pot. After 3pm it shows the live table. Tap a name to see their 10 matches. When everything has finished, it names the winner and their winnings.
- **History:** a money table (wins, winnings, profit), the highest score, the 20-point club, lucky teams, winning runs and every past Saturday.
- **Admin:** refresh results, load another Saturday, mark matches postponed by hand, rename players and add players who don't use the app (then enter their picks on **My picks** with "Entering picks for").

## For developers

- No build step. It's plain HTML, CSS and JavaScript modules.
- `npm test` runs the rules, feed and screenshot-matching tests (Node 20+).
- `node scripts/update-results.mjs [YYYY-MM-DD]` runs the results update by hand. It needs the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` environment variables.
