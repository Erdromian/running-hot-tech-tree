// Clicking the toolbar icon focuses the tree tab if one is open, otherwise opens one.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('tree.html');
  try {
    const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    if (ctx && ctx.tabId >= 0) {
      await chrome.tabs.update(ctx.tabId, { active: true });
      await chrome.windows.update(ctx.windowId, { focused: true });
      return;
    }
  } catch (e) {
    // getContexts needs Chrome 116+; fall through and open a new tab.
  }
  chrome.tabs.create({ url });
});
