// Screenshot demo: stands in for the game site. Every page request is answered from the made-up
// sample game in sample-data.js; anything that would change the game is dropped. Nothing leaves the page.
(() => {
  const S = window.SAMPLE;
  const BASE = 'https://running-hot.megagameadmin.co.uk/control/games/2';
  const KEY = 'rh.game:' + BASE + '/research';
  window.RH_DEMO = {};
  const minutes = n => Date.now() - n * 60000;
  const ids = S.research.corporations.flatMap(c => c.holdings.map(h => h.id));
  const pc = n => S.cards.protectionCards.find(p => p.name.toLowerCase() === n.toLowerCase());
  const holdingOf = (corp, name) => S.research.corporations.find(c => c.id === corp).holdings.find(h => h.name === name);
  try {
    localStorage.clear();
    localStorage.setItem('rh.gameUrl', JSON.stringify(BASE));
    localStorage.setItem('rh.corpSections', JSON.stringify({ techs: true, unlocked: true }));
    localStorage.setItem('rh.table.settings', JSON.stringify({ auto: true, mode: 'fixed', limit: 90, cardsPerTurn: 1, reserve: 30 }));
    // Treat most research as already seen, so the hand-outs show a realistic mix.
    localStorage.setItem(KEY + ':handout-baseline', JSON.stringify(ids.filter(id => id !== holdingOf(9, 'Mirror, Mirror').id)));
    localStorage.setItem(KEY + ':handout-ledger', JSON.stringify({ [`6|protection:${pc('Heimskringla').id}`]: { state: 'given', how: 'auto', t: minutes(26) } }));
    localStorage.setItem(KEY + ':handout-seen', JSON.stringify({ [`9|protection:${S.cards.protectionCards.find(p => p.code === 'PX012').id}`]: minutes(2) }));
    localStorage.setItem(KEY + ':log', JSON.stringify([
      { kind: 'gain', corp: 9, tech: 'Mirror, Mirror', text: 'Gordon gained Mirror, Mirror · Fitzalan Chambers', t: minutes(2) },
      { kind: 'points', corp: 7, text: 'Digital Tactical Control Research Points: Brain 12 → 18, Maths 3 → 7', t: minutes(4) },
      { kind: 'skip', corp: 10, text: 'Skipped McCullough Calibrated Mechanical’s research turn after 1:31 (limit 1:30)', t: minutes(6) },
      { kind: 'move', corp: 7, tech: 'Entrapment', text: 'Digital Tactical Control moved Entrapment to Wincobank Keep', t: minutes(11) },
      { kind: 'status', corp: 6, tech: 'Power (Part 3/4)', text: 'Augmented Nucleotech’s Power (Part 3/4): Researched → Stolen', t: minutes(19) },
      { kind: 'handout', corp: 6, tech: 'Stories of kings', text: 'Automatically gave Heimskringla to Augmented Nucleotech (unlocked by Stories of kings)', t: minutes(26) },
      { kind: 'phase', text: 'Turn 4 · Action began', t: minutes(30) },
    ]));
  } catch { /* storage unavailable */ }

  const page = props => ({
    component: 'demo', version: 'demo',
    props: { errors: {}, game: { ...S.game, server_time: new Date().toISOString() }, phase: { ...S.phase, ends_at: new Date(Date.now() + 7.5 * 60000).toISOString() }, ...props },
  });
  // A stand-in sign-in token, so the page's buttons work against the sample game.
  try { Object.defineProperty(document, 'cookie', { get: () => 'XSRF-TOKEN=demo', set: () => {}, configurable: true }); } catch { /* ignore */ }
  // Changes are applied to the sample game in memory, so hand-outs show as given.
  const apply = (path, body) => {
    if (path.endsWith('/protection-card-holdings/give')) {
      const h = S.facilities.cardHoldings.find(x => x.corporation_id === body.corporation_id);
      const e = h.cards.find(x => x.card_type_id === body.protection_card_type_id);
      if (e) e.copies_in_hand += body.copies; else h.cards.push({ card_type_id: body.protection_card_type_id, copies_in_hand: body.copies, installed: 0 });
    } else if (path.endsWith('/equipment-holdings/give')) {
      const mb = S.cards.equipmentHoldings.flatMap(g => g.members).find(x => x.character_id === body.character_id);
      if (mb) mb.cards.push({ card_type_id: body.equipment_card_type_id, copies: body.copies });
    }
  };
  window.fetch = async (url, opt = {}) => {
    if (opt.method && opt.method !== 'GET') {
      try { apply(new URL(url, BASE).pathname, JSON.parse(opt.body || '{}')); } catch { /* ignore */ }
      return { status: 0, type: 'opaqueredirect', ok: false, url };
    }
    const path = new URL(url, BASE).pathname;
    const body = path.endsWith('/research') ? page({ research: S.research })
      : path.endsWith('/facilities') ? page(S.facilities)
      : path.endsWith('/cards') ? page(S.cards) : page({});
    return { status: 200, ok: true, url, headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(body)) };
  };
})();
