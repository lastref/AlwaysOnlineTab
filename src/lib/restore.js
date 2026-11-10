// Serialised and executed in the page via chrome.scripting.executeScript
// ({ func }). It must stay self-contained. It asks the visibility patch to
// undo itself; no function is exposed on the page's window.
export function restorePageVisibility() {
  document.dispatchEvent(new Event('mssoft-aot-restore'));
}
