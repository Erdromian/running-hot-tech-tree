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

- **Skip automatically:** off by default. When on, anyone who goes over the limit is skipped, and it's logged in **Changes**. The skip names that corp. It takes them out of the sitting and sits them straight back down, which moves the turn on only if it is still theirs, and they keep their seat. So if they finish just before the deadline, the next researcher isn't skipped by mistake, which Control's **Pass the turn on** button can do. The game log shows each skip as a take-out and sit-down.
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

**Cards with several versions** (two protection cards with the same name, like Doppleganger PX011 and PX012) are owed one of *each* version. Each version is listed, checked and given separately, and **Mint another** gives one of each version for the one price.

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

## Giving a tech

**Give a tech…** in the header (or **Give to a corp…** in the side panel) hands a corp a technology card in one step:

- Search for the tech, pick the corp, and it goes into the facility with the most room that can take it: a free slot, of the tech's required type. You can pick another facility, or none.
- **How they got it** defaults to **Researched**, which arrives working. The copy options (shared, weak, good, stolen) arrive **Claimed** and still have to be paid for.
- **Charge them the research cost** (Researched only) also takes the full cost off the corp's Research Points, one adjustment per suit with a reason in the game log. It won't send if they can't afford it.
- It warns if the corp already holds that tech. After giving, it re-reads the site to confirm the tech and the charge.

## Minting extra unlocked cards

Each corp card lists the **Unlocked cards** its working techs have unlocked (protection cards and equipment), with how many copies the corp holds. **Mint another** gives one more copy, into the corp's hand for protection cards or to its Security player (else CEO) for equipment. It charges half the unlocking tech's research cost, rounded up in each suit; if two techs unlock the same card, the cheaper one sets the price. The button shows the price and needs a second click to confirm. It checks the corp's current points first and won't mint if they can't afford it. After minting, it re-reads the site to confirm the new copy and logs it. Minting is deliberate, so the hand-outs' "never give twice" rule doesn't block it.

**Refund one** undoes a mint. It takes back one copy of each version and refunds the same half price, with a reason in the game log. It only takes copies still in the corp's hand (or, for equipment, held by its Security player or whoever has one). If every copy is installed, uninstall one on the Facility Defence page first. Hand-outs won't re-give a card after it's taken back.

## Charging or adding Research Points

Each corp card's Research Points section has **Charge or add points**. Enter an amount in any suits and an optional reason (it goes in the game log), then click **Charge** to take the points off, or **Add** to give them. Each needs a second click to confirm. **Charge** is blocked if the corp doesn't have enough. It makes the same per-suit adjustment as the game panel's point buttons, then re-reads the site and shows the new totals. What you've typed is kept while the page refreshes, and the cards don't redraw while you're typing in them.

## Destroying a tech

Every tech on a corp card has **Destroy…**. It asks you to confirm, with **Refund what they paid** ticked by default. The refund gives back exactly what the site recorded them paying for that copy; techs Control handed over for free show they paid nothing. It does the same as the Research page's Destroy (the tech is marked Destroyed and its slot freed), then refunds per suit with a reason in the game log.

## Settling claimed copies

Each **Claimed** tech on a corp card has two buttons, each needing a second click to confirm:

- **Charge … and mark paid:** takes the research cost minus the copy's discount (rounded up) off their Research Points, and turns it into a working copy.
- **Mark paid, no charge:** turns it into a working copy for free.

The site has no "mark as paid", so the tool swaps the claimed copy for a Researched one: it adds the new copy first, then destroys the claimed one, then moves the new copy into the same facility. That way the corp never loses the tech part-way. If something fails, the message says exactly which steps were done.

## Research builder

**New research…** in the header (or **Edit this tech…** in the side panel) opens a form for adding techs to Control, instead of the site's own form:

- **Prerequisites** are picked from the game's real techs as you type. The matches show each tech's tree and code, and ↑/↓ then Enter adds one. Pick as many as you like; Backspace removes the last. The tool joins them with semicolons, so spelling and formatting are always right. To name a tech that doesn't exist yet, pick **Use "…"**; it shows as a red dashed chip. Pasting a semicolon list from the old form turns it into chips.
- **Tree** follows the prerequisites. If they come from one corp's tree, the new tech goes in that tree, with a note saying why. If they come from two corps' trees, it asks you to pick. Standard prerequisites don't change it.
- **Checks:** a name or card code that's already taken blocks saving. The preview shows the tier and tree it will land in, prerequisites from other trees, names not in the game yet, and a warning if no cost makes it a starting tech. **Use RGR105** fills in the next free card code for that tree.
- **Cost:** leave every suit blank for a starting tech. Once any suit has a price, blank suits count as 0.
- Nothing is sent until you confirm. Afterwards the tool re-reads the Cards page and tells you whether everything was saved.

**New cards to unlock:** tick **Also create a new card for it to unlock** and choose the kind:

- **Defence card:** a name (it defaults to the tech's name), an availability (Research only by default), then a **Physical** version, a **Cyber** version, or both, each with its own challenge, consequence, charge and code.
- **Equipment card:** a name, a type (Permanent, This run or Single use), the card's effect, and an optional cost and code.

The card is created first, and the tech's effect gets "Unlock: card name" added, so hand-outs and minting give it out: defence cards (every version) to the corp's hand, equipment to its Security player. The preview also checks every "Unlock:" name in the effect against the game's cards, equipment, techs and facility types, and warns when one is misspelled or missing.

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
