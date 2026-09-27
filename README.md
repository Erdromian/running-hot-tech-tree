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
3. To follow a different game, paste its Control link (for example `https://running-hot.megagameadmin.co.uk/control/games/2`) into **Game** and press **Refresh now**.

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

## Research table

While Control has a research sitting open (it opens when the Action phase starts), the **Research table** section shows:

- who is researching, how long their turn has taken, and how long they have left
- the seats in turn order
- a **suggested limit** per turn: time left in the phase, minus a reserve, divided by the turns left. Turns left is the cards left to play divided by cards per turn. Cards left to play is the cards still in the research decks of the corps at the table, or the cards left in the public deck, whichever is smaller. Click **Use … as the limit** to copy it into your fixed limit.

Settings (remembered in the browser):

- **Skip automatically:** off by default. When on, anyone who goes over the limit has the turn passed on, the same as Control's **Pass the turn on** button, and it's logged in **Changes**. Before skipping, the tool re-reads the site; if the turn has already moved on, it does nothing, so the next researcher never loses time.
- **Time limit:** **Fixed** uses *Seconds per turn*. **Follow the suggestion** uses the suggested limit as it changes.
- **Cards per turn** and **Reserve at the end** tune the suggestion.
- **Skip now** passes the turn on by hand.

The site shows whose turn it is but not when it started, so the tool times each turn from when it first sees it. While a sitting is open it checks every 2 seconds, so timings are accurate to about 2 seconds. If the tab was closed when a turn began, that turn is timed from when the tab reopened.

## Hand-outs

When a corp gains a tech whose effect says **Unlock: …**, the **Hand-outs** section lists what that corp is owed and hands it out:

- **Protection cards** (Keresh, Beat Cop, Cerberus…): one copy into the corp's hand.
- **Equipment** (Amdumbla, Data card, Honey pot…): one copy to the corp's Security player, or its CEO if it has no Security player.
- **Facility types** (Power, Arms, ID…): skipped. There's nothing to hand out for them on the site.

**Hand out automatically** is on by default. Research the tool sees happen is handed out within one refresh and logged in **Changes**. Anything already owed when the tool first opened a game is marked **Owed from before**. It's never given automatically; click **Give**, or **Mark done** if you've dealt with it another way.

**It never gives twice.** An item counts as done once the corp has been seen holding the card (in hand or installed), the tool has given it, or you've marked it done. That's remembered in the browser even after the card is used up and returned to Control. Each item is recorded before it's sent, so a slow site can't cause a second copy.

After giving, the tool re-reads the site to confirm the card arrived. If the site refuses (for example, an expired sign-in), the item shows **Failed** with a **Retry** button, and automatic hand-outs switch off until you turn them back on.

This needs the extension's *cookies* permission, so it can send the site's security token with each change the way the site's own buttons do.

## The rules it assumes

- **Ready now** means three things: the corp holds every prerequisite, its Research Points cover the cost, and it has a free facility slot for the new tech.
- **Prerequisites:** any working copy counts, however the corp got it: researched, copied or stolen. So a corp can research into another corp's tree once it has stolen or copied the prerequisites, and those options show a dashed outline on its card.
- **Facility space:** every tech takes one slot. A tech with a *Housed in* type needs a free slot in a facility of that type; any other tech can go in any facility. A tech the corp holds that isn't in a facility yet counts against its free slots.
- **Affordability** uses Research Points only, not cards still in the hand.

## Placing techs

A tech a corp holds but hasn't put in a facility shows **Needs a facility** on its corp card, with a **Place in…** dropdown and a **Place** button. The dropdown lists the same facilities the Research page's *Move to…* does: available, with a free slot, and of the tech's required type. After placing, the tool re-reads the site to check it moved and logs it.

**Claimed** techs are copies a corp got by trade or theft and hasn't paid for yet. They take up a slot straight away, but don't work (and don't count as prerequisites or trigger hand-outs) until the corp's research player pays for them, at the research cost minus the copy's discount. Placing one doesn't change that.

## Research builder

**New research…** in the header (or **Edit this tech…** in the side panel) opens a form for adding techs to Control, instead of the site's own form:

- **Prerequisites** are picked from the game's real techs as you type. The matches show each tech's tree and code, and ↑/↓ then Enter adds one. Pick as many as you like; Backspace removes the last. The tool joins them with semicolons, so spelling and formatting are always right. To name a tech that doesn't exist yet, pick **Use "…"**; it shows as a red dashed chip. Pasting a semicolon list from the old form turns it into chips.
- **Tree** follows the prerequisites. If they come from one corp's tree, the new tech goes in that tree, with a note saying why. If they come from two corps' trees, it asks you to pick. Standard prerequisites don't change it.
- **Checks:** a name or card code that's already taken blocks saving. The preview shows the tier and tree it will land in, prerequisites from other trees, names not in the game yet, and a warning if no cost makes it a starting tech. **Use RGR105** fills in the next free card code for that tree.
- **Cost:** leave every suit blank for a starting tech. Once any suit has a price, blank suits count as 0.
- Nothing is sent until you confirm. Afterwards the tool re-reads the Cards page and tells you whether everything was saved.

**Editing** uses a route the site has but its own page doesn't offer. It was tested on the test game and changes every field, including name, tree, prerequisites and costs. After saving, the tool still re-reads the tech and reports anything that didn't take.

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
