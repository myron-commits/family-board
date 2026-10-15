# Family Board — setup guide

Your own Skylight-style family calendar: a wall screen in the kitchen, the same board on every phone, and Siri for adding things hands-free. Everything lives on your free Cloudflare account, so the wall screen is just a window into it. If the tablet dies, plug in a new one and nothing is lost.

**What it does**

- **Today:** a column for each person (Dad, Mom, Ian, Avalia, Aerie, plus Everyone) with their events and chores.
- **Week and Month calendars:** color-coded by person, with repeating events.
- **Chores:** big tap-to-check circles, morning/afternoon/evening filters, and a progress bar for each kid.
- **Rewards:** kids earn points for chores and spend them on screen time, privileges, treats, outings, and more. A parent PIN approves each one.
- **Lists:** Groceries, To-do, Hardware store, plus any others you add.
- **Meal plan:** a week view, and one tap adds the week's ingredients to Groceries.
- **Extras:** countdowns (Christmas, trips, birthdays), weather for Shipshewana, a photo slideshow after 10 idle minutes, and night mode that dims the screen from 9:30 PM to 6 AM.
- **Siri and quick add:** type or say "Dentist Thursday 3pm Mom" and it lands on the calendar.

---

## 1. Put it online (about 10 minutes, one time)

You need a free Cloudflare account (you already have one) and Node.js on your laptop (already installed for Hoosier Fleet).

1. Unzip `family-board.zip` to a folder, for example `C:\FamilyBoard`.
2. Open a terminal in that folder and run:
   ```
   npm install
   npm run setup
   ```
3. The setup does these steps for you:
   - signs you in to Cloudflare in your browser
   - creates the database
   - loads your family, starter chores, and rewards
   - asks you to pick a **family key**, which works like a Wi-Fi password for the board
   - puts the app online
4. At the end it prints your **board link**, which looks like:
   `https://family-board.yourname.workers.dev/?key=YOURKEY`

Keep that link private. Anyone who has it can see and change the board.

**Cost:** $0. Cloudflare's free plan covers a family many times over.

**Changing the code later:** edit the files, then run `npx wrangler deploy`. Your data isn't touched. Don't re-run `schema.sql` against the live database, because that wipes it.

---

## 2. Set up the Fire HD 10 (wall screen)

1. On the Fire tablet, open the Silk browser and go to **fully-kiosk.com**. Download the **APK** for Fully Kiosk Browser.
2. When asked, allow Silk to install unknown apps, then install and open Fully Kiosk.
3. In Fully Kiosk settings:
   - **Start URL:** your board link (with `?key=…`)
   - **Device Management → Keep Screen On:** on
   - **Device Management → Launch on Boot:** on, so the board comes back after a power blip
   - **Web Content Settings → Enable JavaScript:** on (it's on by default)
4. Buy the **Fully Kiosk PLUS** license (about $7, one time, per device). It removes the watermark and unlocks launch-on-boot and kiosk lock.
5. Turn the tablet sideways (landscape) and mount it.

**Saving the battery:** a tablet charging 24/7 wears its battery out. Plug the charger into a smart plug and set a repeating schedule, for example 2 hours on and 3 hours off. Watch the battery level for a few days and adjust so it stays roughly between 30% and 90%.

---

## 3. Phones (Myron and Sharon)

1. Open the board link on each phone in Safari.
2. Tap **Share → Add to Home Screen.** It opens like a regular app.
3. Tap **+ Add** to type anything in plain English.

---

## 4. Siri

You'll build one shortcut on your iPhone, then share it to Sharon. It takes about 3 minutes.

**Shortcut 1: "Family board" (adds anything)**

1. Open the **Shortcuts** app and tap **+**.
2. Add the action **Dictate Text**.
3. Add the action **Get Contents of URL**, then tap the arrow to expand it:
   - **URL:** `https://family-board.yourname.workers.dev/api/say`
   - **Method:** POST
   - **Headers:** add one. Key: `x-family-key`, Value: *your family key*.
   - **Request Body:** JSON. Add a field with Key `text`, type Text, and set the value to the **Dictated Text** variable.
4. Add **Get Dictionary Value**. Get **Value** for key `reply` in **Contents of URL**.
5. Add **Speak Text** with the **Dictionary Value**.
6. Name the shortcut **Family board**.

Now say **"Hey Siri, family board,"** wait for the beep, and talk:

| You say | What happens |
|---|---|
| "Dentist Thursday at 3 for Mom" | Event for Sharon, Thu 3:00–4:00 PM |
| "Soccer every Tuesday at 5:30 Ian" | Repeating event for Ian |
| "Avalia dance class every Monday and Wednesday 4:30pm" | Repeats on both days |
| "Pumpkin patch Saturday 1pm family" | Whole-family event |
| "Add milk, eggs and diapers to groceries" | Three items on Groceries |
| "We need bananas" | Added to Groceries |
| "Add zip ties to hardware list" | Added to Hardware store |
| "Tacos for dinner Friday" | Meal plan |
| "Chore Ian feed the cat every day 5 points" | New chore for Ian |
| "Countdown Disney trip June 5" | New countdown |
| "What's on tomorrow" | Siri reads tomorrow's schedule |
| "What's on this week" | Siri reads the week |
| "What's for dinner tonight" | Siri tells you |
| "How many points does Ian have" | Siri reads Ian's balance |

The board understands names and nicknames (Myron/Dad, Sharon/Mom), "the kids," "the girls," "Mom and Dad," and "family."

**Shortcut 2 (optional): "What's today"**

Use **Get Contents of URL** with `https://family-board.yourname.workers.dev/api/today?key=YOURKEY` (method GET), then **Get Dictionary Value** for `reply`, then **Speak Text**.

**Sharing to Sharon:** in Shortcuts, long-press the shortcut, tap **Share**, and send it to her. It already contains the key.

---

## 5. First things to do on the board

- **Settings → Parent PIN:** change it from **1234**.
- **Chores → Edit chores:** the starter chores are guesses. Adjust them for each kid.
- **Rewards → Edit rewards:** change the costs. A starting rule of thumb: a normal day of chores earns 25–40 points.
- **Photos:** add some from your phone, and they'll play on the wall when nobody's using it.

---

## Moving to the Slim Edge 15.6" later

1. Mount the Slim Edge and connect it to Wi-Fi, or to Ethernet with a PoE+ injector for single-cable power.
2. Install Fully Kiosk Browser from the Play Store and set the same Start URL.

That's it. Every event, chore, point, and photo is already there, and Siri keeps working.

---

## Good to know

- **The screen updates within 30 seconds** of anything added from a phone or Siri, and right away on the device that made the change.
- **Weather** comes from Open-Meteo (free, no account). Change the town in Settings.
- **Night mode:** tap the dark screen to wake it for 90 seconds.
- **Undo:** after a quick add, tap **Undo** if it misheard.
- **Deleting a repeating event:** you can delete just that day or the whole series.
- **Points for grown-ups:** chores assigned to Mom or Dad are a shared checklist and don't earn points.
