'use strict';
// Hand-outs: when a corp gains a tech whose effect says "Unlock: X", Control owes that corp X.
//   Protection cards go into the corp's hand (one copy).
//   Equipment goes to the corp's Security player, or its CEO if it has no Security player.
//   Facility-type unlocks are skipped: there is nothing to hand out for them on the site.
// Nothing is ever given twice. An item counts as done once the corp has been seen holding it, the tool
// has sent it, or you mark it done, and that is remembered even after the card is used up and returned.
// Automatic hand-outs only fire for research that appears after the tool starts watching a game;
// anything already owed at that point is listed for you to give by hand.
window.RHHandouts = function createHandouts(deps) {
  const { store, esc, cv, keyOf, fetchPage, gameBase, gameKey, post, addLog, select, getModel } = deps;
  const AUTO_MAX_PER_CYCLE = 5;
  const AUX_MAX_AGE = 60 * 1000;
  const DONE = new Set(['held', 'seen', 'given', 'manual']);
  const st = { key: null, aux: null, auxAt: 0, claimSig: '', items: [], ledger: {}, baseline: null, auto: true, busy: false, error: null, seen: {} };
  const $ = id => document.getElementById(id);

  function load() {
    const k = gameKey();
    if (st.key === k) return;
    st.key = k;
    st.ledger = store.get(k + ':handout-ledger', {});
    st.baseline = store.get(k + ':handout-baseline', null);
    st.auto = store.get(k + ':handout-auto', true);
    st.seen = store.get(k + ':handout-seen', {});
    st.aux = null; st.auxAt = 0; st.claimSig = ''; st.items = []; st.error = null;
  }
  const saveLedger = () => store.set(st.key + ':handout-ledger', st.ledger);

  function unlockNames(effect) {
    const out = [];
    for (const mm of String(effect || '').matchAll(/Unlock:\s*([^.]+)/gi)) {
      mm[1].split(/,|\band\b/).forEach(n => { n = n.trim(); if (n) out.push(n); });
    }
    return out;
  }

  // Every (corp, unlocked thing) pair owed by the corps' current working techs. Starting techs only
  // unlock facility types, so they are left out.
  function claims(m) {
    const out = new Map();
    m.corps.forEach(c => c.holdings.forEach(h => {
      if (h.usable === false) return;
      const t = m.byId.get(h.technology_type_id) || m.byName.get(h.name);
      if (!t || t.starting) return;
      unlockNames(t.effect).forEach(n => {
        if (/\bfacility$/i.test(n)) return;
        const k = c.id + '|' + keyOf(n);
        if (!out.has(k)) out.set(k, { corp: c, name: n, techs: new Set(), holdingIds: [] });
        const o = out.get(k);
        o.techs.add(t.name);
        o.holdingIds.push(h.id);
        o.first = Math.min(o.first ?? Infinity, h.id);
      });
    }));
    return [...out.values()];
  }

  async function loadAux() {
    const base = gameBase();
    const [F, C] = await Promise.all([fetchPage(base + '/facilities', 'cardHoldings'), fetchPage(base + '/cards', 'protectionCards')]);
    st.aux = {
      F: F.props,
      C: C.props,
      // Grouped by name: a game can have two cards with the same name (e.g. two Dopplegangers).
      pcByKey: groupByName(C.props.protectionCards || []),
      eqByKey: groupByName(C.props.equipment || []),
      ftKeys: new Set((F.props.facilityTypes || []).map(f => keyOf(f.name))),
    };
    st.auxAt = Date.now();
  }

  function groupByName(list) {
    const g = new Map();
    list.forEach(c => { const k = keyOf(c.name); if (!g.has(k)) g.set(k, []); g.get(k).push(c); });
    return g;
  }
  const idsOf = card => (card && card.sameIds) || (card ? [card.id] : []);
  // Copies held, counting every card that shares the name.
  const protectionCount = (corpId, card) => {
    const e = (st.aux.F.cardHoldings || []).find(h => h.corporation_id === corpId);
    const ids = idsOf(card);
    return ((e && e.cards) || []).filter(x => ids.includes(x.card_type_id)).reduce((a, x) => a + (x.copies_in_hand || 0) + (x.installed || 0), 0);
  };
  const corpMembers = corpId => {
    const g = (st.aux.C.equipmentHoldings || []).find(x => x.key === 'corporation:' + corpId);
    return g ? g.members || [] : [];
  };
  const equipmentCount = (corpId, card) => { const ids = idsOf(card); return corpMembers(corpId).reduce((a, mb) => a + (mb.cards || []).filter(x => ids.includes(x.card_type_id)).reduce((b, x) => b + (x.copies || 1), 0), 0); };
  const recipientFor = corpId => {
    const ms = corpMembers(corpId);
    return ms.find(x => x.role === 'security') || ms.find(x => x.role === 'ceo') || null;
  };

  function build(m) {
    const baseline = new Set(st.baseline || []);
    const items = [];
    for (const cl of claims(m)) {
      const k = keyOf(cl.name);
      if (st.aux.ftKeys.has(k)) continue;
      const pcs = st.aux.pcByKey.get(k), eqs = pcs ? null : st.aux.eqByKey.get(k);
      const kind = pcs ? 'protection' : eqs ? 'equipment' : 'other';
      const isNew = cl.holdingIds.some(h => !baseline.has(h));
      // Some cards come in more than one version under the same name (e.g. Doppleganger PX011 and PX012).
      // The corp is owed every version, so each one is its own item, checked and given separately.
      const versions = pcs || eqs || [null];
      // Versions usually differ by kind (Physical and Cyber); label them by that, else by card code.
      const byKind = versions.length > 1 && new Set(versions.map(v => v && v.kind_label)).size === versions.length;
      const versionLabel = card => (byKind ? card.kind_label : card.code || `#${card.id}`);
      for (const card of versions) {
        const it = {
          id: `${cl.corp.id}|${card ? `${kind}:${card.id}` : `other:${k}`}`,
          corp: cl.corp, kind, card,
          name: card ? card.name + (versions.length > 1 ? ` (${versionLabel(card)})` : '') : cl.name,
          version: card && versions.length > 1 ? versionLabel(card) : null,
          techs: [...cl.techs],
          isNew,
          // Held techs' ids go up in the order they were gained, so they order hand-outs even for
          // research from before the tool was watching.
          order: cl.first,
        };
        if (isNew && !st.seen[it.id]) st.seen[it.id] = Date.now();
        it.seenAt = st.seen[it.id] || null;
        let held = false;
        if (kind === 'protection') held = protectionCount(cl.corp.id, card) > 0;
        if (kind === 'equipment') {
          it.recipient = recipientFor(cl.corp.id);
          // Honey pot and Honey bomb also exist as technology cards; holding either form counts.
          const sameTech = m.techs.find(t => keyOf(t.name) === k);
          held = equipmentCount(cl.corp.id, card) > 0
            || !!(sameTech && m.usableBy.get(cl.corp.id).has(sameTech.name));
        }
        const led = st.ledger[it.id];
        if (held) {
          if (!led || !DONE.has(led.state)) st.ledger[it.id] = { state: led && (led.state === 'sent' || led.state === 'failed') ? 'given' : 'seen', t: Date.now(), how: led && led.how };
          it.status = 'held';
        } else if (led) {
          it.status = led.state;
        } else if (kind === 'other' || (kind === 'equipment' && !it.recipient)) {
          it.status = 'manual-needed';
        } else {
          it.status = st.auto && it.isNew ? 'auto' : 'owed';
        }
        it.led = st.ledger[it.id];
        items.push(it);
      }
    }
    store.set(st.key + ':handout-seen', st.seen);
    // Oldest first: the order the research happened, then corp, then card.
    return items.sort((a, b) => a.order - b.order || a.corp.name.localeCompare(b.corp.name) || a.name.localeCompare(b.name));
  }

  async function give(it, how) {
    // Recorded before sending, so a slow or failed confirmation can never lead to a second copy.
    st.ledger[it.id] = { state: 'sent', t: Date.now(), how };
    saveLedger();
    const who = it.kind === 'equipment' ? `${it.recipient.name}` : it.corp.name;
    try {
      if (it.kind === 'protection') {
        await post('/protection-card-holdings/give', { corporation_id: it.corp.id, protection_card_type_id: it.card.id, copies: 1 });
      } else {
        await post('/equipment-holdings/give', { character_id: it.recipient.character_id, equipment_card_type_id: it.card.id, copies: 1 });
      }
      addLog({ kind: 'handout', corp: it.corp.id, tech: it.techs[0], text: `${how === 'auto' ? 'Automatically gave' : 'Gave'} ${it.name} to ${who} (unlocked by ${it.techs.join(', ')})` });
    } catch (e) {
      st.ledger[it.id] = { state: 'failed', t: Date.now(), how, msg: e.message };
      saveLedger();
      addLog({ kind: 'loss', corp: it.corp.id, tech: it.techs[0], text: `Could not give ${it.name} to ${who}: ${e.message}` });
      if (e.auth && st.auto) {
        st.auto = false;
        store.set(st.key + ':handout-auto', false);
        st.error = `Automatic hand-outs are off because ${e.message}`;
      }
    }
  }

  async function update(m) {
    load();
    if (!st.baseline) {
      st.baseline = m.corps.flatMap(c => c.holdings.map(h => h.id));
      store.set(st.key + ':handout-baseline', st.baseline);
    }
    const cls = claims(m);
    const sig = cls.map(c => c.corp.id + '|' + keyOf(c.name) + '|' + c.holdingIds.join(',')).sort().join(';');
    if (!cls.length) { st.items = []; st.claimSig = sig; render(); return; }
    const open = st.items.some(i => !DONE.has(i.status));
    try {
      if (!st.aux || sig !== st.claimSig || open || Date.now() - st.auxAt > AUX_MAX_AGE) await loadAux();
      st.claimSig = sig;
      st.items = build(m);
      saveLedger();
      if (st.auto && !st.busy) {
        const todo = st.items.filter(i => i.status === 'auto').slice(0, AUTO_MAX_PER_CYCLE);
        if (todo.length) {
          st.busy = true;
          try {
            for (const it of todo) await give(it, 'auto');
            await loadAux();
            st.items = build(m);
            saveLedger();
          } finally { st.busy = false; }
        }
      }
      if (!st.error || !st.error.startsWith('Automatic')) st.error = null;
    } catch (e) {
      console.error(e);
      st.error = `Could not check hand-outs: ${e.message}`;
    }
    render();
  }

  async function giveByHand(id) {
    const it = st.items.find(i => i.id === id);
    // Only items still owed can be given; this also stops a double click from sending a second copy.
    if (!it || st.busy || !['owed', 'failed', 'sent'].includes(it.status)) return;
    st.busy = true; render();
    try {
      await give(it, 'manual');
      await loadAux();
      st.items = build(getModel());
      saveLedger();
    } catch (e) {
      st.error = `Could not check hand-outs: ${e.message}`;
    } finally { st.busy = false; render(); }
  }

  function markDone(id) {
    const it = st.items.find(i => i.id === id);
    st.ledger[id] = { state: 'manual', t: Date.now() };
    saveLedger();
    if (it) { it.status = 'manual'; it.led = st.ledger[id]; }
    render();
  }

  // ---------- Rendering ----------
  const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const KIND = { protection: 'Protection card', equipment: 'Equipment', other: 'Unlock' };

  function statusHTML(it) {
    const l = it.led || {};
    switch (it.status) {
      case 'held': return l.state === 'given' ? `<span class="hs ok">Given ${l.how === 'auto' ? 'automatically' : 'by you'} · ${time(l.t)}</span>` : '<span class="hs ok">Already has it</span>';
      case 'seen': return '<span class="hs ok">Handed out before</span>';
      case 'given': return `<span class="hs ok">Given · ${time(l.t)}, since used or moved</span>`;
      case 'manual': return '<span class="hs ok">Marked done</span>';
      case 'sent': return `<span class="hs warn">Sent ${time(l.t)}, not showing on the site yet</span>`;
      case 'failed': return `<span class="hs bad">Failed: ${esc(l.msg || 'unknown error')}</span>`;
      case 'auto': return '<span class="hs busy">Handing out…</span>';
      case 'manual-needed': return `<span class="hs warn">${it.kind === 'equipment' ? 'No CEO or Security player to give it to' : 'Not a card the tool can give'}</span>`;
      default: return `<span class="hs owed">Owed${it.isNew ? '' : ' from before'}</span>`;
    }
  }

  function actionsHTML(it) {
    const b = [];
    if (['owed', 'failed', 'sent'].includes(it.status)) b.push(`<button type="button" class="btn" data-give="${esc(it.id)}"${st.busy ? ' disabled' : ''}>${it.status === 'owed' ? 'Give' : 'Retry'}</button>`);
    if (!DONE.has(it.status) && it.status !== 'auto') b.push(`<button type="button" class="btn quiet" data-done="${esc(it.id)}">Mark done</button>`);
    return b.join('');
  }

  function rowHTML(it) {
    const to = it.kind === 'equipment' && it.recipient ? `${esc(it.corp.name)} · ${esc(it.recipient.role_label || it.recipient.name)}` : esc(it.corp.name);
    const techs = it.techs.map(t => `<button type="button" class="linkish" data-tech="${esc(t)}">${esc(t)}</button>`).join(', ');
    return `<li class="ho s-${it.status}" style="${cv(it.corp.color)}">
      <span class="sw"></span>
      <div class="what"><span><b>${esc(it.name)}</b> → ${to}</span><span class="mini">${KIND[it.kind]} · unlocked by ${techs}${it.seenAt ? ` · seen ${time(it.seenAt)}` : ''}</span></div>
      <div class="state">${statusHTML(it)}</div>
      <div class="acts">${actionsHTML(it)}</div>
    </li>`;
  }

  function render() {
    const sec = $('handouts');
    if (!sec) return;
    const open = st.items.filter(i => !DONE.has(i.status));
    const done = st.items.filter(i => DONE.has(i.status));
    $('autoHand').checked = st.auto;
    $('handoutCount').textContent = st.items.length ? `${open.length} to do · ${done.length} done` : '';
    $('handoutNote').textContent = st.auto
      ? 'New research is handed out as soon as it appears. Anything owed from before the tool started watching waits for you.'
      : 'Nothing is given until you click Give. Items tick off on their own once the corp holds the card.';
    $('handoutError').hidden = !st.error;
    $('handoutError').textContent = st.error || '';
    $('handoutList').innerHTML = open.length ? open.map(rowHTML).join('') : '<li class="empty">Nothing to hand out.</li>';
    $('handoutDone').hidden = !done.length;
    $('handoutDoneCount').textContent = `Done (${done.length})`;
    $('handoutDoneList').innerHTML = done.map(rowHTML).join('');
    sec.querySelectorAll('[data-give]').forEach(b => b.addEventListener('click', () => giveByHand(b.dataset.give)));
    sec.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => markDone(b.dataset.done)));
    sec.querySelectorAll('[data-tech]').forEach(b => b.addEventListener('click', () => select(b.dataset.tech, true)));
  }

  function setAuto(on) {
    load();
    st.auto = on;
    store.set(st.key + ':handout-auto', on);
    if (on && st.error && st.error.startsWith('Automatic')) st.error = null;
    const m = getModel();
    if (m) update(m); else render();
  }

  // ---------- Minting extra copies ----------
  // A corp can mint another copy of a card one of its working techs unlocked, for half that tech's
  // research cost (rounded up in each suit). A card that comes in several versions mints one of each
  // version for that one price. It's a deliberate extra copy, so the "never give twice" rule doesn't
  // apply. The cards are given first, then the points charged, then everything is checked.
  const MINT_SHARE = 0.5;
  const totalOf = t => Object.values(t.cost || {}).reduce((a, b) => a + (+b || 0), 0);
  function mintOptions(corpId) {
    const m = getModel();
    if (!st.aux || !m) return [];
    const byName = new Map();
    st.items
      .filter(i => i.corp.id === corpId && (i.kind === 'protection' || (i.kind === 'equipment' && i.recipient)))
      .forEach(i => {
        const k = `${i.kind}:${keyOf(i.card.name)}`;
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(i);
      });
    return [...byName.entries()].map(([k, versions]) => {
      const first = versions[0];
      const tech = [...new Set(versions.flatMap(v => v.techs))].map(n => m.byName.get(n)).filter(Boolean).sort((a, b) => totalOf(a) - totalOf(b))[0];
      const cost = m.suits.map(s => ({ s, n: Math.ceil(((tech && tech.cost[s.value]) || 0) * MINT_SHARE) })).filter(x => x.n > 0);
      const count = v => (v.kind === 'protection' ? protectionCount(corpId, v.card) : equipmentCount(corpId, v.card));
      return {
        removable: versions.every(v => removableFrom(corpId, v) !== null),
        takesFrom: versions.map(v => { const f = removableFrom(corpId, v); return f && f.installed ? f.installed.facilityName : null; }).filter(Boolean),
        id: `${corpId}|mint:${k}`, name: first.card.name, kind: first.kind,
        versions: versions.map(v => ({ item: v, code: v.version || v.card.code || `#${v.card.id}`, held: count(v) })),
        held: versions.reduce((a, v) => a + count(v), 0),
        tech: tech ? tech.name : first.techs[0], cost, to: first.kind === 'equipment' ? first.recipient.name : first.corp.name,
      };
    });
  }

  // Where one copy of a version can be taken back from. Protection cards come from the corp's hand if
  // there's one there; otherwise the most recently installed copy is uninstalled (which returns it to the
  // hand) and then taken. Equipment comes from its Security player or whoever holds one.
  function removableFrom(corpId, v) {
    if (v.kind === 'protection') {
      const e = (st.aux.F.cardHoldings || []).find(h => h.corporation_id === corpId);
      const c = e && (e.cards || []).find(x => x.card_type_id === v.card.id);
      const inHand = c ? c.copies_in_hand || 0 : 0;
      if (inHand > 0) return { inHand };
      const corp = (st.aux.F.facilities || []).find(x => x.id === corpId);
      const installed = ((corp && corp.facilities) || []).flatMap(f => (f.stacks || []).flatMap(s => (s.cards || [])
        .filter(x => x.card_type_id === v.card.id).map(x => ({ facility: f.id, facilityName: f.name, cardId: x.id }))));
      if (!installed.length) return null;
      return { inHand: 0, installed: installed.sort((a, b) => b.cardId - a.cardId)[0] };
    }
    const holders = corpMembers(corpId).map(mb => ({ mb, n: (mb.cards || []).filter(x => x.card_type_id === v.card.id).reduce((a, x) => a + (x.copies || 1), 0) })).filter(x => x.n > 0);
    const pick = holders.find(x => v.recipient && x.mb.character_id === v.recipient.character_id) || holders[0];
    return pick ? { character: pick.mb, copies: pick.n } : null;
  }

  // Undo a mint: take back one copy of each version and refund the same half price.
  async function unmint(corpId, optionId) {
    const m = getModel(), c = m.corpById.get(corpId);
    await loadAux();
    st.items = build(m);
    const opt = mintOptions(corpId).find(o => o.id === optionId);
    if (!opt || !c) throw new Error('that card isn’t on their list any more.');
    const plan = opt.versions.map(v => ({ v, from: removableFrom(corpId, v.item) }));
    const stuck = plan.filter(p => !p.from);
    if (stuck.length) throw new Error(`no copy of ${stuck.map(p => p.v.code).join(', ')} to take back: ${opt.kind === 'protection' ? 'they don’t hold one' : 'nobody on the corp holds one'}.`);
    const taken = [];
    for (const { v, from } of plan) {
      try {
        if (v.item.kind === 'protection' && from.installed) {
          // Uninstalling puts it back in their hand; then the hand goes back to what it was before.
          await post(`/facilities/${from.installed.facility}/cards/${from.installed.cardId}`, {}, { method: 'DELETE' });
          await post('/protection-card-holdings', { corporation_id: corpId, protection_card_type_id: v.item.card.id, copies: from.inHand }, { method: 'PATCH' });
        } else if (v.item.kind === 'protection') await post('/protection-card-holdings', { corporation_id: corpId, protection_card_type_id: v.item.card.id, copies: from.inHand - 1 }, { method: 'PATCH' });
        else await post('/equipment-holdings', { character_id: from.character.character_id, equipment_card_type_id: v.item.card.id, copies: from.copies - 1 }, { method: 'PATCH' });
        taken.push(from.installed ? `${v.code} from ${from.installed.facilityName}` : v.code);
      } catch (e) {
        if (!taken.length) throw e;
        throw Object.assign(new Error(`took back ${taken.join(', ')} but not ${v.code}: ${e.message} Nothing was refunded.`), { partial: true });
      }
    }
    const refunded = [];
    try {
      for (const x of opt.cost) {
        await post('/trackers', { subject_type: 'corporation', subject_id: corpId, tracker: `research_${x.s.value}`, mode: 'adjust', value: x.n, reason: `Refund: took back a minted ${opt.name}` });
        refunded.push(`${x.n} ${x.s.label}`);
      }
    } catch (e) {
      throw Object.assign(new Error(`${opt.name} was taken back, but the refund stopped after ${refunded.join(', ') || 'nothing'}: ${e.message} Adjust their points by hand.`), { partial: true });
    }
    await loadAux();
    st.items = build(m);
    saveLedger();
    const now = mintOptions(corpId).find(o => o.id === optionId);
    const still = now ? opt.versions.filter(v => { const n = now.versions.find(x => x.item.id === v.item.id); return n && n.held >= v.held; }) : [];
    if (still.length) throw Object.assign(new Error(`${opt.name} was refunded, but ${still.map(v => v.code).join(', ')} still shows the same count. Check ${opt.to} on the site.`), { partial: true });
    const what = opt.versions.length > 1 ? `${opt.name} (${taken.join(' and ')})` : opt.name;
    addLog({ kind: 'handout', corp: corpId, tech: opt.tech, text: `Took back a minted ${what} from ${opt.to}, refunded ${refunded.join(', ') || 'nothing'}` });
    return { held: now ? now.held : 0, refunded, taken };
  }

  async function mint(corpId, optionId) {
    const m = getModel(), c = m.corpById.get(corpId);
    const opt = mintOptions(corpId).find(o => o.id === optionId);
    if (!opt || !c) throw new Error('that card isn’t available to mint any more.');
    // Check against their points right now, not the last refresh, so two quick mints can't overspend.
    const fresh = (await fetchPage(gameBase() + '/research')).props.research.corporations.find(x => x.id === corpId);
    const points = (fresh && fresh.points) || c.points;
    const short = opt.cost.filter(x => (points[x.s.value] || 0) < x.n);
    if (short.length) throw new Error(`${c.name} is short by ${short.map(x => `${x.n - (points[x.s.value] || 0)} ${x.s.label}`).join(', ')}.`);
    const given = [];
    for (const v of opt.versions) {
      const it = v.item;
      try {
        if (it.kind === 'protection') await post('/protection-card-holdings/give', { corporation_id: corpId, protection_card_type_id: it.card.id, copies: 1 });
        else await post('/equipment-holdings/give', { character_id: it.recipient.character_id, equipment_card_type_id: it.card.id, copies: 1 });
        given.push(v.code);
      } catch (e) {
        if (!given.length) throw e;
        throw Object.assign(new Error(`gave ${given.join(', ')} but not ${v.code}: ${e.message} Nothing was charged.`), { partial: true });
      }
    }
    const charged = [];
    try {
      for (const x of opt.cost) {
        await post('/trackers', { subject_type: 'corporation', subject_id: corpId, tracker: `research_${x.s.value}`, mode: 'adjust', value: -x.n, reason: `Minted another ${opt.name} (half of ${opt.tech})` });
        charged.push(`${x.n} ${x.s.label}`);
      }
    } catch (e) {
      throw Object.assign(new Error(`${opt.name} was given, but charging stopped after ${charged.join(', ') || 'nothing'}: ${e.message} Adjust their points by hand.`), { partial: true });
    }
    await loadAux();
    st.items = build(m);
    saveLedger();
    const now = mintOptions(corpId).find(o => o.id === optionId);
    const missing = now ? opt.versions.filter(v => { const n = now.versions.find(x => x.item.id === v.item.id); return !n || n.held <= v.held; }) : opt.versions;
    if (missing.length) throw Object.assign(new Error(`${opt.name} was charged for, but ${missing.map(v => v.code).join(', ')} isn’t showing yet. Check ${opt.to} on the site.`), { partial: true });
    const what = opt.versions.length > 1 ? `${opt.name} (${given.join(' and ')})` : opt.name;
    addLog({ kind: 'handout', corp: corpId, tech: opt.tech, text: `Minted another ${what} for ${opt.to}, charged ${charged.join(', ') || 'nothing'} (half of ${opt.tech})` });
    return { held: now.held, charged, given };
  }

  return { update, setAuto, render, giveByHand, markDone, mintOptions, mint, unmint, state: st };
};
