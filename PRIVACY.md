# Privacy

AlwaysOnlineTab (MSSOFT) does not collect, store remotely, sell or share any data.

- **Stored locally (`chrome.storage.local`)**: the list of sites you enabled and your settings.
- **Stored for the browser session only (`chrome.storage.session`)**: time and HTTP status of the last keep-alive request per site, shown in the popup.
- **Network**: the only requests the extension makes are `GET` requests to the page you already have open on a site you enabled, to keep that site's session alive. No other server is ever contacted.
- Removing a site deletes it from the list and revokes the extension's access to it. Uninstalling removes all stored data.
