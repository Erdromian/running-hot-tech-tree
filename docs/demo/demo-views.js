// Screenshot demo: sets the page up for one view, chosen with ?view=… in the address.
(() => {
  const view = new URLSearchParams(location.search).get('view') || 'overview';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const scrollTo = (el, gap = 12) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - gap);
  (async () => {
    await wait(700);
    const api = window.RH_DEMO.api;
    if (api.table.state.turn) api.table.state.turn.startedAt = Date.now() - 71000;   // DTC is 1:11 into their turn
    document.body.classList.add('demo-' + view);
    if (view === 'tree') {
      api.setFocus(7);
      await wait(150);
      api.select('Advanced entrapment');
      scrollTo($('tree-dtc'), 110);
    } else if (view === 'handouts') {
      scrollTo($('handouts'));
    } else if (view === 'table') {
      scrollTo($('rtable'));
    } else if (view === 'corp') {
      const card = [...document.querySelectorAll('.corp')].find(c => c.textContent.includes('Genetic Equity'));
      const box = card.querySelector('.rp-adjust'); box.open = true;
      [...card.querySelectorAll('.held li')].find(li => li.querySelector('.n')?.textContent === 'Deer horns')?.querySelector('[data-destroy="open"]')?.click();
      await wait(100);
      scrollTo([...document.querySelectorAll('.corp')].find(c => c.textContent.includes('Genetic Equity')));
    } else if (view === 'builder') {
      api.composer.open('new');
      await wait(500);
      const m = $('composer');
      type(m.querySelector('#rcName'), 'Orchard Sentinels');
      const pre = m.querySelector('#rcPreInput');
      type(pre, 'enzy'); key(pre, 'Enter');
      type(pre, 'mythic'); key(pre, 'Enter');
      ['#rc_brain', '#rc_leaf', '#rc_maths'].forEach((s, i) => type(m.querySelector(s), [8, 10, 4][i]));
      m.querySelector('#rcNewCard').click();
      type(m.querySelector('#rcCardName'), 'Thornwatch');
      m.querySelector('#rcV_cyber').click();
      type(m.querySelector('#rcC_physical_challenge'), 'Brute (5)');
      type(m.querySelector('#rcC_physical_consequence'), '2 Wounds, End the Run');
      type(m.querySelector('#rcC_cyber_challenge'), 'Hack (5)');
      type(m.querySelector('#rcC_cyber_consequence'), '2 Tags');
      type(m.querySelector('#rcDesc'), 'Grafted hedges that watch the perimeter');
      type(m.querySelector('#rcEffect'), '');
      pre.blur();
    } else if (view === 'give') {
      const S = window.SAMPLE;
      const tech = api.state.model.techs.find(t => t.name === 'Understanding the Psyche');
      api.giver.open(tech, 8);
      await wait(200);
      const g = $('giver');
      g.querySelector('#gvCharge').click();
    }
    document.body.classList.add('demo-ready');
  })();
})();
