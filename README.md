# Running Hot Tech Tree

A Chrome extension that shows a live research tech tree for a Running Hot game. It reads the Control research page with your existing sign-in, so you don't need to copy any passwords or cookies.

## Install (once)

1. Open `chrome://extensions` (in Edge it's `edge://extensions`; Brave and Arc work the same way).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Optional: pin the extension from the puzzle-piece menu so its icon stays on the toolbar.

Keep this folder where it is. Chrome loads the extension from this folder, so moving or deleting it breaks the extension.

## Use

1. Sign in to the game site in the same browser as usual (Continue with Discord).
2. Click the extension icon. The tree opens in a tab and refreshes on its own. The default is every 10 seconds; you can change it to 5 s, 30 s or 1 minute.
3. To follow a different game, paste its Control link (for example `https://running-hot.megagameadmin.co.uk/control/games/3`) into **Game** and press **Refresh now**.

## What it shows

- **Header:** turn, phase, time left in the phase, and cards left in the public deck.
- **One card per corp:**
  - every tech it holds and where it's housed, with copied, stolen and not-working cards marked
  - its facility space: every facility with its type and used/total slots, how many slots are free, and a warning when a tech it holds isn't in a facility yet
  - its Research Points
  - its current hand added up by suit
  - how many techs it has open in any tree, which are ready now, and which it could pay for but has no room for
- **Changes:** a log of new research, copies, thefts, cards moved between facilities, Research Point changes, facilities added, lost, resized or made unavailable, techs added or edited in Control, and phase changes, with times. It's saved in the browser, so reopening the tab shows what changed while it was closed. A tech gained in the last 15 minutes gets a **New** tag on the tree.
- **Trees:**
  - Each tree is laid out in tiers, with its starting techs above.
  - Dashed boxes are prerequisites that come from another tree.
  - Coloured pips on a tech show who holds it: solid for researched, hollow for a copy, striped for not working.
- **Highlight a corp:** shows what it holds, what it has the prerequisites for (dashed outline), and what is **Ready** now. A tech tagged **No space** is one it could pay for but has no free slot of the right facility type for.

## The rules it assumes

- **Ready now** means three things: the corp holds every prerequisite, its Research Points cover the cost, and it has a free facility slot for the new tech.
- **Prerequisites:** any working copy counts, however the corp got it: researched, copied or stolen. So a corp can research into another corp's tree once it has stolen or copied the prerequisites, and those options show a dashed outline on its card.
- **Facility space:** every tech takes one slot. A tech with a *Housed in* type needs a free slot in a facility of that type; any other tech can go in any facility. A tech the corp holds that isn't in a facility yet counts against its free slots.
- **Affordability** uses Research Points only, not cards still in the hand.

## Custom research

Techs added on the Control **Cards** page appear on the next refresh, in the tree you picked, placed after their prerequisites. The change log records them as "New technology" and they get an **Added** tag for 15 minutes.

- **Prerequisites:** names are matched loosely, so differences in capitalisation, spacing, or straight vs curly apostrophes don't matter.
- **A prerequisite that doesn't match any tech** (a typo, or research that doesn't exist yet) shows as a red dashed **Not in the game** box, with a warning under that tree. No one can research that tech until a tech with that name exists.
- **Zero cost:** a custom tech with a cost of 0 is still researchable and appears in the tree. Only cards another tech unlocks (like Honey pot) and deck-customisation rules go in the "not researched directly" note.
- **Click any tech:** highlights its whole prerequisite chain. The side panel shows its cost, effect, where it must be housed, and the total cost to reach it. If a corp is highlighted, the panel also shows what that corp still needs.

## If something goes wrong

- **"Signed out"**: sign in to the game site again in this browser. The tree picks it up on the next refresh.
- **"Could not reach the game site"**: check your connection and the game link. The extension can only read sites on `megagameadmin.co.uk`.
- **It suddenly stops understanding the page**: the site's data format has probably changed. The logic is all in `tree.js`, in the `buildModel` function.
