'use strict';
// Running Hot live tech tree.
// Reads the Control research page (an Inertia app) as JSON using the browser's own sign-in,
// redraws the trees when anything changes, and keeps a log of what changed between refreshes.
(() => {
  const DEFAULT_GAME = 'https://running-hot.megagameadmin.co.uk/control/games/3';
  const TREE_VAR = { augmented: '--t-an', dtc: '--t-dtc', 'genetic-equity': '--t-ge', gordon: '--t-gor', mccullough: '--t-mcm', standard: '--t-std' };
  const NW = 200, NH = 64, COLW = NW + 60, ROWH = NH + 16, PADX = 16, PADY = 34;
  const FRESH_MS = 15 * 60 * 1000;
  const LOG_MAX = 300;

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  class SignInError extends Error {}

  const state = {
    gameUrl: store.get('rh.gameUrl', DEFAULT_GAME),
    interval: store.get('rh.interval', 10),
    paused: false,
    version: null,
    model: null,
    hash: null,
    focusCorp: store.get('rh.focusCorp', null),
    selected: null,
    lastOk: 0,
    skew: 0,
    timer: null,
    inflight: false,
    log: [],
    prevSnap: null,
  };

  // ---------- Fetching ----------
  function researchUrl(u) {
    const url = new URL(u);
    const m = url.pathname.match(/^(.*\/games\/\d+)/);
    if (!m) throw new Error('That link is not a game page. It should look like …/control/games/3');
    return `${url.origin}${m[1]}/research`;
  }
  const gameKey = () => 'rh.game:' + researchUrl(state.gameUrl);

  function parseHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const holder = [...doc.querySelectorAll('[data-page]')].find(e => e.getAttribute('data-page').trim().startsWith('{'));
    if (holder) return JSON.parse(holder.getAttribute('data-page'));
    const s = [...doc.querySelectorAll('script')].find(x => x.textContent.trim().startsWith('{"component"'));
    return s ? JSON.parse(s.textContent) : null;
  }

  async function fetchPage(url, retry = true) {
    const headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, application/xhtml+xml' };
    if (state.version) { headers['X-Inertia'] = 'true'; headers['X-Inertia-Version'] = state.version; }
    const r = await fetch(url, { credentials: 'include', headers, cache: 'no-store' });
    if (r.status === 409 && retry) { state.version = null; return fetchPage(url, false); }
    if (r.status === 401 || r.status === 419) throw new SignInError();
    if (/\/login\/?$/.test(new URL(r.url).pathname)) throw new SignInError();
    if (!r.ok) throw new Error(`The game site answered ${r.status}${r.statusText ? ' ' + r.statusText : ''}.`);
    const ct = r.headers.get('content-type') || '';
    const page = ct.includes('json') ? await r.json() : parseHtml(await r.text());
    if (!page || !page.props) throw new Error('Could not find the game data on that page. The site may have changed.');
    if (/(^|\/)(login|auth)/i.test(page.component || '')) throw new SignInError();
    if (!page.props.research) throw new Error('That page has no research data. Check that the game link points at a Control game.');
    if (page.version) state.version = page.version;
    return page;
  }

  // ---------- Model ----------
  const isUsable = h => h.usable !== false;
  const titleCase = s => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  const totalCost = t => Object.values(t.cost || {}).reduce((a, b) => a + (+b || 0), 0);
  const nameKey = s => String(s || '').normalize('NFKC').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  // Techs name facility types a little differently from facilities ("ID Facility" vs "ID").
  const normType = s => String(s || '').toLowerCase().replace(/\s*facility$/, '').trim();

  // Every tech a corp holds takes a slot in one of its facilities. Techs it holds that are
  // usable but not in a facility yet are still waiting for a slot, so they count against the free total.
  function spaceOf(c) {
    const facs = (c.facilities || []).map(f => ({
      ...f,
      free: f.available === false ? 0 : Math.max(0, (f.capacity || 0) - (f.stored || 0)),
    }));
    const byType = {};
    facs.forEach(f => { const k = normType(f.facility_type); byType[k] = (byType[k] || 0) + f.free; });
    const open = facs.reduce((a, f) => a + f.free, 0);
    const cap = facs.filter(f => f.available !== false).reduce((a, f) => a + (f.capacity || 0), 0);
    const waiting = c.holdings.filter(h => isUsable(h) && !h.facility_id).length;
    return { facs, byType, open, cap, waiting, free: Math.max(0, open - waiting) };
  }
  function roomFor(space, t) {
    if (space.free <= 0) return false;
    return t.required_facility_type ? (space.byType[normType(t.required_facility_type)] || 0) > 0 : true;
  }
  const slotWord = t => t.required_facility_type ? `${t.required_facility_type.replace(/\s*facility$/i, '')} facility` : 'facility';

  function buildModel(page) {
    const p = page.props, r = p.research;
    const suits = (r.suits && r.suits.length ? r.suits : ['cog', 'brain', 'leaf', 'maths'].map(v => ({ value: v, label: titleCase(v) })))
      .map(s => ({ ...s }));
    // One-letter labels keep four-suit costs on one line inside a tree node.
    suits.forEach(s => {
      const one = s.label.slice(0, 1).toUpperCase();
      s.abbr = suits.filter(x => x.label.slice(0, 1).toUpperCase() === one).length > 1 ? s.label.slice(0, 2) : one;
    });
    const techs = (r.technologies || []).map(t => ({
      ...t,
      cost: t.cost || {},
      // Control types prerequisites as titles separated by semicolons; accept either form.
      prerequisites: (Array.isArray(t.prerequisites) ? t.prerequisites : String(t.prerequisites || '').split(';')).map(n => String(n).trim()).filter(Boolean),
      kids: [],
      unknown: [],
    }));
    const byName = new Map(), byId = new Map(), byKey = new Map();
    techs.forEach(t => { byName.set(t.name, t); byId.set(t.id, t); if (!byKey.has(nameKey(t.name))) byKey.set(nameKey(t.name), t); });
    // Resolve typed prerequisite names to real techs, forgiving case, spacing and curly quotes.
    // Names that match nothing (typos, or research that doesn't exist yet) are kept as unknown.
    techs.forEach(t => {
      t.prerequisites = t.prerequisites.map(n => {
        const q = byKey.get(nameKey(n));
        if (q) return q.name;
        t.unknown.push(n);
        return n;
      });
    });
    techs.forEach(t => t.prerequisites.forEach(n => { const q = byName.get(n); if (q) q.kids.push(t.name); }));
    // Cards some tech unlocks (Honey pot, Honey bomb) aren't researched themselves.
    const unlocked = new Set();
    techs.forEach(t => {
      for (const mm of String(t.effect || '').matchAll(/Unlock:\s*([^.]+)/gi)) {
        mm[1].split(/,|\band\b/).forEach(n => { if (n.trim()) unlocked.add(nameKey(n)); });
      }
    });
    techs.forEach(t => {
      t.kind = t.starting ? 'start'
        : t.is_deck_customisation || (t.is_free && unlocked.has(nameKey(t.name))) ? 'extra'
        : 'research';
    });

    const slugOfCorp = new Map();
    techs.forEach(t => { if (t.corporation && !slugOfCorp.has(t.corporation)) slugOfCorp.set(t.corporation, t.tree); });
    const corps = (r.corporations || []).map(c => {
      const slug = slugOfCorp.get(c.name) || null;
      const corp = { ...c, slug, points: c.points || {}, hand: c.hand || [], holdings: c.holdings || [], facilities: c.facilities || [], color: treeColor(slug, c) };
      corp.space = spaceOf(corp);
      return corp;
    });
    const corpById = new Map(corps.map(c => [c.id, c]));

    const slugs = [];
    corps.forEach(c => { if (c.slug && !slugs.includes(c.slug)) slugs.push(c.slug); });
    techs.forEach(t => { if (!slugs.includes(t.tree)) slugs.push(t.tree); });
    slugs.sort((a, b) => (a === 'standard') - (b === 'standard'));
    const trees = slugs.map(slug => {
      const owner = corps.find(c => c.slug === slug);
      const any = techs.find(t => t.tree === slug && t.corporation);
      return { slug, name: owner ? owner.name : any ? any.corporation : titleCase(slug), color: treeColor(slug, owner), techs: techs.filter(t => t.tree === slug) };
    });
    const treeBySlug = new Map(trees.map(t => [t.slug, t]));

    const holders = new Map();
    const usableBy = new Map(corps.map(c => [c.id, new Set()]));
    corps.forEach(c => c.holdings.forEach(h => {
      const t = byId.get(h.technology_type_id) || byName.get(h.name);
      const name = t ? t.name : h.name;
      if (!holders.has(name)) holders.set(name, []);
      holders.get(name).push({ corp: c, h });
      if (isUsable(h)) usableBy.get(c.id).add(name);
    }));
    const game = p.game || {};
    return { page, p, r, game, phase: p.phase || game.phase || null, suits, techs, byName, byId, corps, corpById, trees, treeBySlug, holders, usableBy };
  }

  function treeColor(slug, corp) {
    if (slug && TREE_VAR[slug]) return `var(${TREE_VAR[slug]})`;
    if (corp && corp.colour) return corp.colour;
    return 'var(--t-std)';
  }

  function hashOf(m) {
    const ph = m.phase || {};
    return JSON.stringify([m.r, ph.id, ph.turn, ph.type, ph.status, ph.ends_at, m.game.name]);
  }

  // Options for one corp: techs it could go for, whether prerequisites are met, whether it can pay now,
  // and whether it has a free facility slot to house the result. Ready means all three.
  function optionsFor(m, c, scope) {
    const have = m.usableBy.get(c.id) || new Set();
    return m.techs
      .filter(t => t.kind === 'research' && !have.has(t.name) && (!scope || scope.has(t.tree)))
      .map(t => {
        const missing = t.prerequisites.filter(n => !have.has(n));
        const short = m.suits.filter(s => (t.cost[s.value] || 0) > (c.points[s.value] || 0));
        const open = !missing.length, afford = open && !short.length, room = roomFor(c.space, t);
        return { t, missing, short, open, afford, room, ready: afford && room, total: totalCost(t) };
      });
  }

  // ---------- Change log ----------
  function snapshot(m) {
    const ph = m.phase;
    return {
      phase: ph ? { turn: ph.turn, label: ph.type_label || ph.type, status: ph.status } : null,
      corps: Object.fromEntries(m.corps.map(c => [c.id, { name: c.name, points: { ...c.points } }])),
      holds: Object.fromEntries(m.corps.flatMap(c => c.holdings.map(h => [h.id, {
        corp: c.id, name: h.name, status: h.status, statusLabel: h.status_label, origin: h.origin, originLabel: h.origin_label, facility: h.facility, usable: isUsable(h),
      }]))),
      facs: Object.fromEntries(m.corps.flatMap(c => c.facilities.map(f => [f.id, {
        corp: c.id, name: f.name, type: f.facility_type, cap: f.capacity, available: f.available !== false,
      }]))),
      techs: Object.fromEntries(m.techs.map(t => [t.id, { name: t.name, tree: t.tree, pre: t.prerequisites.join('; ') }])),
    };
  }

  function diff(a, b, m) {
    const ev = [];
    const cn = id => (b.corps[id] || a.corps[id] || {}).name || 'A corp';
    if (a.phase && b.phase && (a.phase.turn !== b.phase.turn || a.phase.label !== b.phase.label)) {
      ev.push({ kind: 'phase', text: `Turn ${b.phase.turn} · ${b.phase.label} began` });
    }
    for (const [id, h] of Object.entries(b.holds)) {
      const o = a.holds[id];
      if (!o) {
        const how = h.origin && h.origin !== 'researched' ? ` as a ${String(h.originLabel || h.origin).toLowerCase()}` : '';
        ev.push({ kind: 'gain', corp: h.corp, tech: h.name, text: `${cn(h.corp)} gained ${h.name}${how}${h.facility ? ` · ${h.facility}` : ''}` });
        continue;
      }
      if (o.status !== h.status) {
        ev.push({ kind: h.usable ? 'status' : 'loss', corp: h.corp, tech: h.name, text: `${cn(h.corp)}’s ${h.name}: ${o.statusLabel || o.status} → ${h.statusLabel || h.status}` });
      } else if (o.usable !== h.usable) {
        ev.push({ kind: h.usable ? 'status' : 'loss', corp: h.corp, tech: h.name, text: `${cn(h.corp)}’s ${h.name} is ${h.usable ? 'working again' : 'no longer working'}` });
      }
      if (o.facility !== h.facility && h.facility) {
        ev.push({ kind: 'move', corp: h.corp, tech: h.name, text: `${cn(h.corp)} moved ${h.name} to ${h.facility}` });
      }
    }
    for (const [id, o] of Object.entries(a.holds)) {
      if (!b.holds[id]) ev.push({ kind: 'loss', corp: o.corp, tech: o.name, text: `${cn(o.corp)} no longer holds ${o.name}` });
    }
    for (const [id, c] of Object.entries(b.corps)) {
      const o = a.corps[id];
      if (!o) continue;
      const parts = m.suits.filter(s => (o.points[s.value] || 0) !== (c.points[s.value] || 0))
        .map(s => `${s.label} ${o.points[s.value] || 0} → ${c.points[s.value] || 0}`);
      if (parts.length) ev.push({ kind: 'points', corp: +id, text: `${c.name} Research Points: ${parts.join(', ')}` });
    }
    // Snapshots saved before facilities were tracked have no facs; skip rather than report every facility as new.
    if (a.facs && b.facs) {
      for (const [id, f] of Object.entries(b.facs)) {
        const o = a.facs[id];
        const slots = n => `${n} slot${n === 1 ? '' : 's'}`;
        if (!o) { ev.push({ kind: 'space', corp: f.corp, text: `${cn(f.corp)} added ${f.name} (${f.type}, ${slots(f.cap)})` }); continue; }
        if (o.cap !== f.cap) ev.push({ kind: 'space', corp: f.corp, text: `${cn(f.corp)}’s ${f.name}: ${slots(o.cap)} → ${slots(f.cap)}` });
        if (o.available !== f.available) ev.push({ kind: f.available ? 'space' : 'loss', corp: f.corp, text: `${cn(f.corp)}’s ${f.name} is ${f.available ? 'available again' : 'unavailable'}` });
      }
      for (const [id, o] of Object.entries(a.facs)) {
        if (!b.facs[id]) ev.push({ kind: 'loss', corp: o.corp, text: `${cn(o.corp)} lost ${o.name} (${o.type})` });
      }
    }
    // Custom research added or edited in Control.
    if (a.techs && b.techs) {
      const tn = slug => treeName(m, slug);
      for (const [id, t] of Object.entries(b.techs)) {
        const o = a.techs[id];
        if (!o) { ev.push({ kind: 'tech', tech: t.name, text: `New technology: ${t.name} (${tn(t.tree)} tree)${t.pre ? `, needs ${t.pre}` : ''}` }); continue; }
        if (o.name !== t.name) ev.push({ kind: 'tech', tech: t.name, text: `Technology renamed: ${o.name} → ${t.name}` });
        if (o.tree !== t.tree) ev.push({ kind: 'tech', tech: t.name, text: `${t.name} moved to the ${tn(t.tree)} tree` });
        if (o.pre !== t.pre) ev.push({ kind: 'tech', tech: t.name, text: `${t.name} now needs ${t.pre || 'nothing'}` });
      }
      for (const [id, o] of Object.entries(a.techs)) {
        if (!b.techs[id]) ev.push({ kind: 'loss', text: `Technology removed: ${o.name}` });
      }
    }
    const now = Date.now();
    return ev.map(e => ({ ...e, t: now }));
  }

  // Recently gained techs get a "New" tag, recently added custom techs an "Added" tag. Map of name → tag.
  function freshTechs() {
    const cut = Date.now() - FRESH_MS, out = new Map();
    [...state.log].reverse().forEach(e => {
      if (e.t < cut || !e.tech) return;
      if (e.kind === 'gain') out.set(e.tech, 'New');
      else if (e.kind === 'tech' && e.text.startsWith('New technology') && !out.has(e.tech)) out.set(e.tech, 'Added');
    });
    return out;
  }

  // ---------- Rendering helpers ----------
  const cv = color => `--c:${color}`;
  const costInline = (m, c) => {
    const parts = m.suits.filter(s => c[s.value]).map(s => `<span title="${c[s.value]} ${esc(s.label)}"><b>${c[s.value]}</b>${esc(s.abbr)}</span>`);
    return parts.length ? parts.join('') : '<span>Free</span>';
  };
  const costChips = (m, c, points) => m.suits.map(s => {
    const v = c[s.value] || 0;
    const short = points && v > (points[s.value] || 0);
    return `<span class="chip${v ? '' : ' zero'}${short ? ' short' : ''}">${v} ${esc(s.label)}</span>`;
  }).join('');
  const treeName = (m, slug) => (m.treeBySlug.get(slug) || { name: titleCase(slug) }).name;
  const treeCol = (m, slug) => (m.treeBySlug.get(slug) || { color: 'var(--t-std)' }).color;
  const fmtClock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtAgo = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`; };

  function setLive(kind, text) {
    $('live').className = 'live ' + kind;
    $('liveText').textContent = text;
  }

  function showBanner(html) { $('banner').innerHTML = html; $('banner').hidden = false; }
  function hideBanner() { $('banner').hidden = true; }

  function showError(e) {
    let origin = '';
    try { origin = new URL(state.gameUrl).origin; } catch { /* bad url */ }
    if (e instanceof SignInError) {
      showBanner(`You are signed out of the game site. <a href="${esc(origin)}/login" target="_blank" rel="noopener">Sign in</a> in this browser and this page will pick it up on the next refresh.`);
    } else if (e instanceof TypeError) {
      showBanner(`Could not reach the game site. Check your connection and the game link. The extension can only read sites on megagameadmin.co.uk. Retrying every ${state.interval} s.`);
    } else {
      showBanner(`${esc(e.message)} Retrying every ${state.interval} s.`);
    }
  }

  // ---------- Header ----------
  function renderStatus() {
    const m = state.model;
    if (!m) return;
    const ph = m.phase;
    const bits = [];
    if (ph) {
      bits.push(`<span>Turn ${esc(ph.turn)} · ${esc(ph.type_label || ph.type)}</span>`);
      if (ph.ends_at && ph.status === 'running') {
        bits.push(`<span class="timer">${fmtClock(Date.parse(ph.ends_at) - (Date.now() + state.skew))} left</span>`);
      } else if (ph.status_label) {
        bits.push(`<span>${esc(ph.status_label)}</span>`);
      }
    }
    if (m.r.public_deck_remaining != null) bits.push(`<span>${m.r.public_deck_remaining} cards left in the public deck</span>`);
    if (state.lastOk) bits.push(`<span>Updated ${fmtAgo(Date.now() - state.lastOk)}</span>`);
    $('status').innerHTML = bits.join('');
  }

  // ---------- Corps ----------
  function renderCorps(m) {
    $('corpNote').textContent = 'Options cover every tree: prerequisites can be researched, copied or stolen';
    $('corps').innerHTML = m.corps.map(c => {
      const opts = optionsFor(m, c, null);
      const open = opts.filter(o => o.open);
      const ready = open.filter(o => o.ready).sort((a, b) => a.total - b.total);
      const blocked = open.filter(o => o.afford && !o.room);
      const cheapest = open.filter(o => !o.afford).sort((a, b) => a.total - b.total).slice(0, 3);
      const sp = c.space;
      const beyond = c.holdings.filter(h => { const t = m.byId.get(h.technology_type_id) || m.byName.get(h.name); return t && t.kind === 'research' && isUsable(h); }).length;
      const ownTotal = c.slug ? m.techs.filter(t => t.tree === c.slug && t.kind === 'research').length : 0;
      const ownHave = c.slug ? m.techs.filter(t => t.tree === c.slug && t.kind === 'research' && m.usableBy.get(c.id).has(t.name)).length : 0;
      const stdTotal = m.techs.filter(t => t.tree === 'standard' && t.kind === 'research').length;
      const stdHave = m.techs.filter(t => t.tree === 'standard' && t.kind === 'research' && m.usableBy.get(c.id).has(t.name)).length;
      const otherHave = m.techs.filter(t => t.tree !== c.slug && t.tree !== 'standard' && t.kind === 'research' && m.usableBy.get(c.id).has(t.name)).length;
      const held = c.holdings.map(h => {
        const cls = [!isUsable(h) ? 'off' : '', h.origin && h.origin !== 'researched' ? 'copy' : ''].join(' ');
        const where = !isUsable(h) ? `${h.status_label || h.status || 'Not working'} · not working` : h.facility || 'Not in a facility';
        return `<li class="${cls}" data-origin="${esc(h.origin_label || '')}"><span class="n">${esc(h.name)}</span><span class="f">${esc(where)}</span></li>`;
      }).join('') || '<li><span class="n">Nothing held</span></li>';
      const sums = {}; m.suits.forEach(s => { sums[s.value] = 0; });
      c.hand.forEach(card => { if (sums[card.suit] != null) sums[card.suit] += +card.value || 0; });
      const handTotal = Object.values(sums).reduce((a, b) => a + b, 0);
      const wild = c.hand.filter(card => card.wild).length;
      // Options from another corp's tree are marked, since those usually rest on stolen or copied prerequisites.
      const lnk = o => {
        const foreign = o.t.tree !== c.slug && o.t.tree !== 'standard';
        const title = `${o.t.name} · ${treeName(m, o.t.tree)} tree · ${o.total} points`;
        return `<button type="button" class="lnk${foreign ? ' foreign' : ''}" data-go="${esc(o.t.name)}" style="${cv(treeCol(m, o.t.tree))}" title="${esc(title)}"><span class="sw"></span>${esc(o.t.name)} <span class="mini">${o.total}</span></button>`;
      };
      const pressed = state.focusCorp === c.id;
      const facRows = sp.facs.map(f => {
        const used = Math.min(f.stored || 0, f.capacity || 0);
        const slots = (f.capacity || 0) <= 12
          ? `<span class="slots">${Array.from({ length: f.capacity || 0 }, (_, i) => `<i class="${i < used ? 'used' : ''}"></i>`).join('')}</span>`
          : '';
        return `<li class="${f.available === false ? 'off' : f.free ? '' : 'full'}"><span class="n">${esc(f.name)}</span><span class="ty">${esc(f.facility_type)}</span>${slots}<span class="ct">${f.available === false ? 'unavailable' : `${f.stored || 0}/${f.capacity || 0}`}</span></li>`;
      }).join('');
      const typesFree = Object.entries(sp.byType).filter(([, n]) => n > 0).map(([k, n]) => {
        const f = sp.facs.find(x => normType(x.facility_type) === k);
        return `${n} ${esc(f ? f.facility_type : titleCase(k))}`;
      }).join(' · ');
      const spaceHead = sp.free
        ? `<b>${sp.free} of ${sp.cap} slots free</b>${typesFree ? ` · empty: ${typesFree}` : ''}`
        : `<b class="bad">No free slots</b> · ${sp.cap} slots, all used`;
      const waitNote = sp.waiting ? `<span class="warnline">${sp.waiting} tech${sp.waiting === 1 ? ' is' : 's are'} not in a facility yet and will take a slot</span>` : '';
      return `<article class="corp" style="${cv(c.color)}">
        <h3><span class="sw"></span>${esc(c.name)}</h3>
        <div class="pos">${beyond ? `<b>${beyond} tech${beyond === 1 ? '' : 's'} beyond the start</b>` : '<b>Starting techs only</b>'} · own tree ${ownHave}/${ownTotal} · Standard ${stdHave}/${stdTotal}${otherHave ? ` · ${otherHave} from other trees` : ''}</div>
        <ul class="held">${held}</ul>
        <div class="sub"><span class="mini">Facility space</span><span class="spacehead">${spaceHead}</span>${waitNote}<ul class="facs">${facRows || '<li><span class="n">No facilities</span></li>'}</ul></div>
        <div class="sub"><span class="mini">Research Points</span><div class="suits">${m.suits.map(s => `<span class="chip rp${c.points[s.value] ? '' : ' zero'}">${c.points[s.value] || 0} ${esc(s.label)}</span>`).join('')}</div></div>
        <div class="sub"><span class="mini">Hand: ${c.hand.length} cards, ${handTotal} points${wild ? `, ${wild} wild` : ''} · deck ${c.deck_remaining ?? '?'}</span><div class="suits">${m.suits.map(s => `<span class="chip${sums[s.value] ? '' : ' zero'}">${sums[s.value]} ${esc(s.label)}</span>`).join('')}</div></div>
        <div class="sub"><span class="mini">${open.length} open · ${ready.length} ready now (prerequisites, points and space)</span>
          ${ready.length ? `<div class="opts">${ready.slice(0, 8).map(lnk).join('')}${ready.length > 8 ? `<span class="mini">+${ready.length - 8} more</span>` : ''}</div>`
            : cheapest.length ? `<span class="mini">Cheapest open:</span><div class="opts">${cheapest.map(lnk).join('')}</div>` : ''}
          ${blocked.length ? `<span class="warnline">${blocked.length} more affordable but no free slot for ${blocked.length === 1 ? 'it' : 'them'}:</span><div class="opts">${blocked.slice(0, 6).map(lnk).join('')}</div>` : ''}
        </div>
        <button type="button" class="btn" data-focus="${c.id}" aria-pressed="${pressed}">${pressed ? 'Highlighted on the tree' : 'Highlight on the tree'}</button>
      </article>`;
    }).join('');
    $('corps').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => select(b.dataset.go, true)));
    $('corps').querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => setFocus(+b.dataset.focus)));
  }

  // ---------- Log ----------
  function renderLog() {
    const m = state.model;
    $('changeCount').textContent = state.log.length ? `${state.log.length} recorded` : '';
    if (!state.log.length) {
      $('log').innerHTML = '<li class="empty">No changes yet. New research, copies, thefts, moves, Research Points, facility changes, technologies added in Control and phase changes will appear here as they happen.</li>';
      return;
    }
    $('log').innerHTML = state.log.map(e => {
      const c = m && e.corp != null ? m.corpById.get(e.corp) : null;
      const t = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const text = e.tech && m && m.byName.has(e.tech) ? `<button type="button" data-go="${esc(e.tech)}">${esc(e.text)}</button>` : esc(e.text);
      return `<li><time>${t}</time><span class="sw" style="${cv(c ? c.color : 'var(--faint)')}"></span><span class="${e.kind === 'loss' ? 'bad' : ''}">${text}</span></li>`;
    }).join('');
    $('log').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => select(b.dataset.go, true)));
  }

  // ---------- Nav + legend ----------
  function renderNav(m) {
    const fc = m.corpById.get(state.focusCorp);
    $('focusRow').innerHTML = `<span class="lbl">Highlight</span><button type="button" class="focus-btn" data-focus="" aria-pressed="${!fc}">No corp</button>` +
      m.corps.map(c => `<button type="button" class="focus-btn" data-focus="${c.id}" aria-pressed="${state.focusCorp === c.id}" style="${cv(c.color)}"><span class="sw"></span>${esc(c.name)}</button>`).join('');
    $('treeLinks').innerHTML = `<span class="lbl">Jump to</span>` + m.trees.map(t => `<a href="#tree-${esc(t.slug)}" style="${cv(t.color)}"><span class="sw"></span>${esc(t.name)}</a>`).join('');
    $('focusRow').querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => setFocus(b.dataset.focus ? +b.dataset.focus : null)));
    const base = `<span><i class="h"></i>Held (pips show who: solid researched, hollow copy, striped not working)</span><span><i></i>Not held</span><span><i class="g"></i>Prerequisite from another tree</span>`;
    const focus = fc ? `<span><i class="m"></i>${esc(fc.name)} holds it</span><span><i class="o"></i>Prerequisites met</span><span><i class="a"></i>Ready now: prerequisites, points and a free slot</span><span><b class="tagkey">No space</b>Could pay, but no free slot of the right type</span>` : '';
    $('legend').style.cssText = fc ? `--fc:${fc.color}` : '';
    const key = `<span>Costs: ${m.suits.map(s => `${esc(s.abbr)} ${esc(s.label)}`).join(' · ')}</span>`;
    $('legend').innerHTML = base + focus + key + '<span>Click any tech to trace its prerequisite chain</span>';
  }

  function setFocus(id) {
    state.focusCorp = state.focusCorp === id ? null : id;
    store.set('rh.focusCorp', state.focusCorp);
    if (state.model) renderAll();
  }

  // ---------- Trees ----------
  let nodeEls = new Map(), edgeEls = [];
  const regNode = (name, el) => { if (!nodeEls.has(name)) nodeEls.set(name, []); nodeEls.get(name).push(el); };

  function pipsHTML(m, name) {
    const hs = m.holders.get(name) || [];
    if (!hs.length) return '';
    return `<span class="pips">${hs.map(({ corp, h }) => {
      const cls = !isUsable(h) ? 'off' : h.origin && h.origin !== 'researched' ? 'copy' : '';
      const title = `${corp.name} · ${h.origin_label || h.origin || ''}${!isUsable(h) ? ` · ${h.status_label || 'not working'}` : h.facility ? ` · ${h.facility}` : ''}`;
      return `<span class="pip ${cls}" style="${cv(corp.color)}" title="${esc(title)}"></span>`;
    }).join('')}</span>`;
  }

  function makeNode(m, t, ghost, treeSlug, ctx) {
    const b = document.createElement('button');
    b.type = 'button';
    const hs = m.holders.get(t.name) || [];
    const cls = ['node'];
    if (ghost) cls.push('ghost');
    if (hs.some(x => isUsable(x.h))) cls.push('held');
    let tag = '';
    if (!ghost && ctx.fc) {
      const o = ctx.opt.get(t.name);
      if (ctx.have.has(t.name)) cls.push('mine');
      else if (o && o.open) {
        cls.push('open');
        if (o.ready) { cls.push('afford'); tag = '<span class="tag afford">Ready</span>'; }
        else if (o.afford) tag = `<span class="tag nospace" title="No free ${esc(slotWord(t))} slot">No space</span>`;
      }
    }
    if (!ghost && ctx.fresh.has(t.name)) { cls.push('fresh'); tag = `<span class="tag new">${ctx.fresh.get(t.name)}</span>`; }
    b.className = cls.join(' ');
    b.style.cssText = `${cv(ghost ? treeCol(m, t.tree) : treeCol(m, treeSlug))};--nw:${NW}px;--nh:${NH}px`;
    b.innerHTML = ghost
      ? `<div class="top"><span class="cd">${esc(treeName(m, t.tree))} ↗</span></div><div class="nm">${esc(t.name)}</div><div class="cost">${costInline(m, t.cost)}</div>`
      : `${tag}<div class="top"><span class="nm">${esc(t.name)}</span>${pipsHTML(m, t.name) || `<span class="cd">${esc(t.code)}</span>`}</div><div class="cost">${costInline(m, t.cost)}</div>`;
    b.title = t.name + (t.effect ? ' · ' + t.effect : '');
    if (ghost) b.dataset.ghost = '1';
    b.addEventListener('click', () => select(t.name, ghost));
    regNode(t.name, b);
    return b;
  }

  function makeMissing(name) {
    const b = document.createElement('div');
    b.className = 'node ghost missing';
    b.style.cssText = `--c:var(--warn);--nw:${NW}px;--nh:${NH}px`;
    b.innerHTML = `<div class="top"><span class="cd">Not in the game</span></div><div class="nm">${esc(name)}</div><div class="cost"><span>No tech has this name</span></div>`;
    b.title = `${name} · no technology has this name yet. Check the spelling in Control, or add it.`;
    b.dataset.ghost = '1';
    return b;
  }

  function renderTrees(m) {
    nodeEls = new Map(); edgeEls = [];
    const fc = m.corpById.get(state.focusCorp) || null;
    const ctx = {
      fc,
      have: fc ? m.usableBy.get(fc.id) : new Set(),
      opt: fc ? new Map(optionsFor(m, fc, null).map(o => [o.t.name, o])) : new Map(),
      fresh: freshTechs(),
    };
    const frag = document.createDocumentFragment();
    const svgNS = 'http://www.w3.org/2000/svg';

    m.trees.forEach(tree => {
      const key = tree.slug;
      const all = tree.techs;
      const starts = all.filter(t => t.kind === 'start');
      const extras = all.filter(t => t.kind === 'extra');
      const res = all.filter(t => t.kind === 'research');
      const inTree = n => m.byName.has(n) && m.byName.get(n).tree === key;
      const hasLink = t => t.prerequisites.length > 0 || t.kids.some(inTree);
      const graph = res.filter(hasLink), solo = res.filter(t => !hasLink(t));

      // Nodes: in-tree techs plus a ghost for each prerequisite that lives in another tree.
      const N = {};
      // Prerequisites that match no tech get a "missing" ghost so the gap is visible instead of silently dropped.
      const pid = n => !m.byName.has(n) ? 'u:' + nameKey(n) : inTree(n) ? n : 'g:' + n;
      graph.forEach(t => { N[t.name] = { t, ghost: false, parents: t.prerequisites.map(pid) }; });
      graph.forEach(t => t.prerequisites.filter(n => !inTree(n)).forEach(n => {
        N[pid(n)] = m.byName.has(n)
          ? { t: m.byName.get(n), ghost: true, parents: [] }
          : { t: { name: n, tree: null, cost: {}, code: '' }, ghost: true, missing: true, parents: [] };
      }));
      const ids = Object.keys(N);
      const depth = id => { const o = N[id]; if (o.depth != null) return o.depth; o.depth = 0; o.depth = o.parents.length ? 1 + Math.max(...o.parents.map(depth)) : 0; return o.depth; };
      ids.forEach(depth);
      ids.filter(i => N[i].ghost).forEach(i => {
        const kids = ids.filter(k => N[k].parents.includes(i));
        N[i].depth = Math.max(0, Math.min(...kids.map(k => N[k].depth)) - 1);
      });

      // Connected groups, in data order, so related chains stay together.
      const comp = {}; let cc = 0;
      const adj = {}; ids.forEach(i => { adj[i] = new Set(); });
      ids.forEach(i => N[i].parents.forEach(p => { adj[i].add(p); adj[p].add(i); }));
      const order = graph.map(t => t.name);
      order.concat(ids).forEach(i => {
        if (comp[i] != null) return;
        const st = [i]; comp[i] = cc;
        while (st.length) { const x = st.pop(); adj[x].forEach(y => { if (comp[y] == null) { comp[y] = cc; st.push(y); } }); }
        cc++;
      });
      const maxD = ids.length ? Math.max(...ids.map(i => N[i].depth)) : 0;
      const Y = {};
      const cols = []; for (let d = 0; d <= maxD; d++) cols.push(ids.filter(i => N[i].depth === d));
      const idx = i => { const g = order.indexOf(i); return g < 0 ? -1 : g; };
      let y = 0, lastComp = null;
      (cols[0] || []).sort((a, b) => comp[a] - comp[b] || idx(a) - idx(b)).forEach(i => {
        if (lastComp != null && comp[i] !== lastComp) y += 10;
        Y[i] = y; y += ROWH; lastComp = comp[i];
      });
      for (let d = 1; d <= maxD; d++) {
        const col = cols[d].map(i => {
          const o = N[i];
          let ps;
          if (o.ghost) {
            const kids = ids.filter(k => N[k].parents.includes(i));
            ps = kids.flatMap(k => N[k].parents.filter(p => Y[p] != null));
          } else ps = o.parents.filter(p => Y[p] != null);
          const want = ps.length ? ps.reduce((a, p) => a + Y[p], 0) / ps.length : 0;
          return { i, want, c: comp[i] };
        });
        col.sort((a, b) => a.want - b.want || a.c - b.c);
        let prev = -Infinity;
        col.forEach(o => { const yy = Math.max(o.want, prev + ROWH); Y[o.i] = yy; prev = yy; });
      }
      const height = ids.length ? Math.max(...ids.map(i => Y[i])) + NH + PADY + 16 : 0;
      const width = (maxD + 1) * COLW - 60 + PADX * 2;

      const sec = document.createElement('section');
      sec.className = 'tree'; sec.id = 'tree-' + key; sec.style.cssText = cv(tree.color) + (fc ? `;--fc:${fc.color}` : '');
      const haveCount = fc ? res.filter(t => ctx.have.has(t.name)).length : null;
      sec.innerHTML = `<div class="tree-head"><h2>${esc(tree.name)}</h2><span class="count">${res.length} techs · deepest chain ${maxD + 1} step${maxD ? 's' : ''}${fc ? ` · ${esc(fc.name)} holds ${haveCount}` : ''}</span></div>`;
      const broken = all.filter(t => t.unknown.length);
      if (broken.length) {
        const p = document.createElement('p'); p.className = 'warnnote';
        p.innerHTML = `<b>Prerequisite not in the game:</b> ${broken.map(t => `${esc(t.name)} needs ${t.unknown.map(n => `“${esc(n)}”`).join(', ')}`).join('; ')}. No one can research ${broken.length === 1 ? 'it' : 'these'} until a tech with that exact name exists. Check the spelling in Control.`;
        sec.appendChild(p);
      }

      if (starts.length) {
        const sl = document.createElement('div');
        sl.className = 'startline';
        sl.innerHTML = '<span class="lbl">Start line</span>';
        starts.forEach(t => {
          const hs = m.holders.get(t.name) || [];
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'start' + (hs.length && hs.every(x => !isUsable(x.h)) ? ' off' : '');
          const where = hs.length ? hs.map(({ corp, h }) => isUsable(h)
            ? `${esc(corp.name)} · ${esc(h.facility || 'not in a facility')}`
            : `<span class="bad">${esc(corp.name)} · ${esc(h.status_label || h.status)} · not working</span>`).join('<br>') : 'Not held';
          b.innerHTML = `<span class="n">${esc(t.name)}</span><span class="f">${where}</span>`;
          b.addEventListener('click', () => select(t.name));
          regNode(t.name, b);
          sl.appendChild(b);
        });
        sec.appendChild(sl);
      }

      if (ids.length) {
        const wrap = document.createElement('div'); wrap.className = 'canvas-wrap';
        const canvas = document.createElement('div'); canvas.className = 'canvas';
        canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
        for (let d = 0; d <= maxD; d++) {
          const h = document.createElement('div'); h.className = 'colhead'; h.style.left = (PADX + d * COLW) + 'px'; h.textContent = 'Tier ' + (d + 1);
          canvas.appendChild(h);
        }
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', width); svg.setAttribute('height', height);
        canvas.appendChild(svg);
        const pos = {};
        ids.forEach(i => {
          const o = N[i];
          const x = PADX + o.depth * COLW, yy = PADY + Y[i];
          pos[i] = { x, y: yy };
          const el = o.missing ? makeMissing(o.t.name) : makeNode(m, o.t, o.ghost, key, ctx);
          el.style.left = x + 'px'; el.style.top = yy + 'px';
          canvas.appendChild(el);
        });
        ids.forEach(i => N[i].parents.forEach(p => {
          const a = pos[p], b = pos[i];
          const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(24, (x2 - x1) / 2);
          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
          const done = fc && ctx.have.has(N[p].t.name) && ctx.have.has(N[i].t.name);
          path.setAttribute('class', 'edge' + (N[p].ghost ? ' x' : '') + (N[p].missing ? ' missing' : '') + (done ? ' done' : ''));
          path.style.cssText = cv(N[p].missing ? 'var(--warn)' : N[p].ghost ? treeCol(m, N[p].t.tree) : tree.color);
          svg.appendChild(path);
          edgeEls.push({ from: N[p].t.name, to: N[i].t.name, el: path });
        }));
        wrap.appendChild(canvas); sec.appendChild(wrap);
      }

      if (solo.length) {
        const s = document.createElement('div'); s.className = 'solo';
        s.innerHTML = '<span class="lbl">Standalone techs · no prerequisites, nothing builds on them</span>';
        const g = document.createElement('div'); g.className = 'solo-grid';
        solo.forEach(t => g.appendChild(makeNode(m, t, false, key, ctx)));
        s.appendChild(g); sec.appendChild(s);
      }

      if (extras.length) {
        const deck = extras.filter(t => t.is_deck_customisation);
        const other = extras.filter(t => !t.is_deck_customisation);
        const bits = [];
        if (other.length) {
          bits.push(other.map(t => {
            const by = m.techs.filter(x => x !== t && x.effect && x.effect.includes('Unlock: ' + t.name)).map(x => x.name);
            const hs = (m.holders.get(t.name) || []).map(({ corp }) => corp.name);
            return `<b>${esc(t.name)}</b>${by.length ? ` (unlocked by ${esc(by.join(', '))})` : ''}${hs.length ? `, held by ${esc(hs.join(', '))}` : ''}`;
          }).join('; ') + '.');
        }
        if (deck.length) bits.push(`<b>${esc(deck.map(t => t.name).join(', '))}</b> are deck-customisation rules for adding cards to a research deck.`);
        const p = document.createElement('p'); p.className = 'others';
        p.innerHTML = 'Also in this set, not researched directly: ' + bits.join(' ');
        sec.appendChild(p);
      }
      frag.appendChild(sec);
    });
    $('trees').replaceChildren(frag);
  }

  // ---------- Selection / inspector ----------
  const walk = (m, start, key) => {
    const out = new Set(), st = [...start];
    while (st.length) { const x = st.pop(); if (out.has(x) || !m.byName.has(x)) continue; out.add(x); st.push(...m.byName.get(x)[key]); }
    return out;
  };
  const HINT = '<p class="hint">Click a tech to see its cost, effect, what it needs, what it leads to, and who holds it. Pick a corp under Highlight to see what that corp still needs, including facility space.</p>';

  function select(name, scroll) {
    const m = state.model;
    if (!m || !m.byName.has(name)) return;
    const t = m.byName.get(name);
    state.selected = name;
    const anc = walk(m, t.prerequisites, 'prerequisites'), desc = walk(m, t.kids, 'kids');
    const up = new Set([name, ...anc]), down = new Set([name, ...desc]);
    document.querySelectorAll('.tree').forEach(s => s.classList.add('focus'));
    nodeEls.forEach((els, n) => els.forEach(el => {
      el.classList.toggle('path', up.has(n) || down.has(n));
      el.classList.toggle('sel', n === name && !el.dataset.ghost);
    }));
    edgeEls.forEach(e => e.el.classList.toggle('path', (up.has(e.from) && up.has(e.to)) || (down.has(e.from) && down.has(e.to))));

    const fc = m.corpById.get(state.focusCorp) || null;
    const have = fc ? m.usableBy.get(fc.id) : new Set();
    const link = n => {
      const x = m.byName.get(n);
      if (!x) return `<span class="lnk miss" title="No technology has this name yet">${esc(n)} · not in the game</span>`;
      const cls = fc ? (have.has(n) ? ' have' : ' miss') : '';
      return `<button type="button" class="lnk${cls}" data-go="${esc(n)}" style="${cv(x ? treeCol(m, x.tree) : 'var(--faint)')}"><span class="sw"></span>${esc(n)}</button>`;
    };
    const hs = m.holders.get(name) || [];
    const heldBy = hs.length ? hs.map(({ corp, h }) => `<span style="${cv(corp.color)};display:inline-flex;gap:6px;align-items:center"><span class="sw"></span>${esc(corp.name)}</span> · ${esc(h.origin_label || h.origin || '')}${isUsable(h) ? (h.facility ? ` · ${esc(h.facility)}` : '') : ` · <span class="bad">${esc(h.status_label || h.status)}, not working</span>`}`).join('<br>') : 'No one';
    const total = {}; [name, ...anc].forEach(n => m.suits.forEach(s => { const v = m.byName.get(n).cost[s.value]; if (v) total[s.value] = (total[s.value] || 0) + v; }));
    const sum = Object.values(total).reduce((a, b) => a + b, 0);

    let corpBox = '';
    if (fc && t.kind === 'research') {
      if (have.has(name)) corpBox = `<div class="box"><span class="t">${esc(fc.name)}</span><span>Already holds this.</span></div>`;
      else {
        const todo = [name, ...anc].filter(n => !have.has(n));
        const rest = {}; todo.forEach(n => m.suits.forEach(s => { const v = m.byName.get(n).cost[s.value]; if (v) rest[s.value] = (rest[s.value] || 0) + v; }));
        const missing = t.prerequisites.filter(n => !have.has(n));
        const short = m.suits.filter(s => (t.cost[s.value] || 0) > (fc.points[s.value] || 0));
        const sp = fc.space, room = roomFor(sp, t);
        const typeFree = t.required_facility_type ? Math.min(sp.byType[normType(t.required_facility_type)] || 0, sp.free) : sp.free;
        const verdict = t.unknown.length ? `Can’t be researched yet: ${t.unknown.map(n => `“${n}”`).join(', ')} ${t.unknown.length === 1 ? 'is' : 'are'} not in the game.`
          : missing.length ? `Needs ${missing.length} more prerequisite${missing.length === 1 ? '' : 's'} first.`
          : short.length ? `Prerequisites met. Short on ${short.map(s => `${s.label} by ${(t.cost[s.value] || 0) - (fc.points[s.value] || 0)}`).join(', ')}.`
          : room ? 'Ready: prerequisites met, it can pay, and it has space.'
          : `Prerequisites met and it can pay, but it has no free ${slotWord(t)} slot.`;
        const article = /^[aeiou]/i.test(slotWord(t)) ? 'an' : 'a';
        const spaceLine = `Needs a slot in ${t.required_facility_type ? `${article} ${slotWord(t)}` : 'any facility'}: ${typeFree} free.`
          + (todo.length > 1 ? ` The whole chain takes ${todo.length} slots; ${sp.free} free in total.` : '');
        corpBox = `<div class="box" style="${cv(fc.color)}"><span class="t" style="display:flex;gap:6px;align-items:center"><span class="sw"></span>For ${esc(fc.name)}</span>
          <span>${esc(verdict)}</span>
          <span class="${room ? 'mini' : 'warnline'}">${esc(spaceLine)}</span>
          <span class="mini">Cost against current Research Points</span><div class="suits">${costChips(m, t.cost, fc.points)}</div>
          ${todo.length > 1 ? `<span class="mini">Still to research: ${todo.length} techs, ${Object.values(rest).reduce((a, b) => a + b, 0)} points</span><div class="suits">${costChips(m, rest)}</div>` : ''}</div>`;
      }
    }

    $('inspBody').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;${cv(treeCol(m, t.tree))}">
        <span class="eyebrow" style="display:flex;gap:6px;align-items:center"><span class="sw"></span>${esc(treeName(m, t.tree))} · ${esc(t.code)}</span>
        <h3>${esc(t.name)}</h3>
        ${t.description && t.description !== 'Starting tech' ? `<p class="flav">${esc(t.description)}</p>` : ''}
      </div>
      <dl>
        <dt>Effect</dt><dd>${esc(t.effect || '—')}</dd>
        <dt>Cost</dt><dd>${t.kind !== 'research' ? (t.kind === 'start' ? 'Starting tech, no cost' : 'No research cost') : `<div class="suits">${costChips(m, t.cost)}</div>`}</dd>
        <dt>Housed in</dt><dd>${esc(t.required_facility_type || 'Anywhere')}</dd>
        <dt>Needs</dt><dd>${t.prerequisites.length ? `<div class="links">${t.prerequisites.map(link).join('')}</div>` : 'Nothing'}</dd>
        <dt>Leads to</dt><dd>${t.kids.length ? `<div class="links">${t.kids.map(link).join('')}</div>` : 'Nothing'}</dd>
        <dt>Held by</dt><dd>${heldBy}</dd>
      </dl>
      ${corpBox}
      ${t.kind === 'research' ? `<div class="box"><span class="t">Cost from scratch · ${anc.size + 1} tech${anc.size ? 's' : ''}</span><div class="suits">${costChips(m, total)}</div><span class="mini">${sum} Research Points in total${anc.size ? `, including ${esc([...anc].join(', '))}` : ''}</span></div>` : ''}`;
    $('insp').classList.remove('empty');
    $('inspBody').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => select(b.dataset.go, true)));
    if (scroll) {
      const el = (nodeEls.get(name) || []).find(e => !e.dataset.ghost);
      if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
  }

  function clearSelection() {
    state.selected = null;
    document.querySelectorAll('.tree').forEach(s => s.classList.remove('focus'));
    nodeEls.forEach(els => els.forEach(el => el.classList.remove('path', 'sel')));
    edgeEls.forEach(e => e.el.classList.remove('path'));
    $('insp').classList.add('empty');
    $('inspBody').innerHTML = HINT;
  }

  // ---------- Orchestration ----------
  function renderAll() {
    const m = state.model;
    $('gameName').textContent = `${m.game.name || 'Running Hot'} · Research`;
    document.title = `${m.phase ? `T${m.phase.turn} ` : ''}Running Hot Tech Tree`;
    renderStatus();
    renderCorps(m);
    renderLog();
    renderNav(m);
    renderTrees(m);
    if (state.selected && m.byName.has(state.selected)) select(state.selected, false);
    else clearSelection();
  }

  function loadGameMemory() {
    state.log = store.get(gameKey() + ':log', []);
    state.prevSnap = store.get(gameKey() + ':snap', null);
  }

  async function refresh() {
    if (state.inflight) return;
    state.inflight = true;
    clearTimeout(state.timer);
    setLive('busy', 'Updating…');
    try {
      const page = await fetchPage(researchUrl(state.gameUrl));
      const m = buildModel(page);
      state.skew = m.game.server_time ? Date.parse(m.game.server_time) - Date.now() : 0;
      state.lastOk = Date.now();
      hideBanner();
      const hash = hashOf(m);
      if (hash !== state.hash) {
        const snap = snapshot(m);
        if (state.prevSnap) {
          const ev = diff(state.prevSnap, snap, m);
          if (ev.length) { state.log = [...ev, ...state.log].slice(0, LOG_MAX); store.set(gameKey() + ':log', state.log); }
        }
        state.prevSnap = snap;
        store.set(gameKey() + ':snap', snap);
        state.hash = hash;
        state.model = m;
        renderAll();
      } else {
        state.model = m;
        renderStatus();
      }
      setLive(state.paused ? 'paused' : 'ok', state.paused ? 'Paused' : 'Live');
    } catch (e) {
      console.error(e);
      showError(e);
      setLive('err', e instanceof SignInError ? 'Signed out' : 'Update failed');
    } finally {
      state.inflight = false;
      schedule();
    }
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!state.paused) state.timer = setTimeout(refresh, state.interval * 1000);
  }

  // ---------- Controls ----------
  $('gameUrl').value = state.gameUrl;
  $('interval').value = String(state.interval);
  $('inspBody').innerHTML = HINT;
  $('trees').innerHTML = '<p class="hint">Loading the research page…</p>';

  $('controls').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('gameUrl').value.trim();
    try { researchUrl(v); } catch (err) { showBanner(esc(err.message)); return; }
    if (v !== state.gameUrl) {
      state.gameUrl = v; store.set('rh.gameUrl', v);
      state.version = null; state.hash = null; state.model = null; state.selected = null;
      loadGameMemory();
    }
    refresh();
  });
  $('interval').addEventListener('change', () => {
    state.interval = +$('interval').value || 10;
    store.set('rh.interval', state.interval);
    schedule();
  });
  $('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('pause').setAttribute('aria-pressed', String(state.paused));
    $('pause').textContent = state.paused ? 'Resume' : 'Pause';
    if (state.paused) { clearTimeout(state.timer); setLive('paused', 'Paused'); } else refresh();
  });
  $('clearLog').addEventListener('click', () => {
    state.log = []; store.set(gameKey() + ':log', []);
    if (state.model) { renderLog(); renderTrees(state.model); if (state.selected) select(state.selected, false); }
  });
  $('closeInsp').addEventListener('click', clearSelection);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') clearSelection(); });
  document.addEventListener('click', e => {
    if (state.selected && !e.target.closest('.node,.start,.insp,.lnk,.log,.corp,.treenav')) clearSelection();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.paused && Date.now() - state.lastOk > state.interval * 1000) refresh();
  });
  setInterval(renderStatus, 1000);

  loadGameMemory();
  refresh();
})();
