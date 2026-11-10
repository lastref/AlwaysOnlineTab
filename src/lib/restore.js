// Serialised and executed in the page's MAIN world via
// chrome.scripting.executeScript({ func }). It must stay self-contained.
export function restorePageVisibility() {
  const restore = window[Symbol.for('mssoft.alwaysOnlineTab.restoreVisibility')];
  if (typeof restore === 'function') restore();
}
