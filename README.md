# AlwaysOnlineTab

**MSSOFT** — Chrome / Edge (Manifest V3) extension that keeps your session alive on the sites you choose, so pages stop logging you out after a period of inactivity.

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

Belirli bir süre hareketsiz kalınca oturumu kapatan, sayfayı düşüren sitelerde AlwaysOnlineTab'ı açtığınızda oturum açık kalır.

### Nasıl çalışır

Yalnızca sizin etkinleştirdiğiniz sitelerde, seçtiğiniz aralıkla (30 sn – 10 dk):

| Yöntem | Ne yapar |
| --- | --- |
| Kullanıcı etkinliği taklidi | Sayfanın hareketsizlik sayacının dinlediği `mousemove`, `pointermove`, `keydown/keyup (Shift)` ve `scroll` olaylarını gönderir. Tıklama veya tuş girişi yapmaz. |
| Sekmeyi görünür tut | `document.hidden`, `visibilityState` ve `hasFocus()` değerlerini her zaman "görünür / odaklı" döndürür; sekme arka plandayken çıkış yapan sayfaları engeller. |
| Sunucu oturumunu yenile (varsayılan kapalı) | Sayfanın içinden, sayfanın kendi çerezleriyle sitenin kök adresine (`/`) `GET` isteği atar; sunucu tarafındaki oturum süresi sıfırlanır. Bazı yönetim panelleri ve güvenlik duvarları bu tür isteklerde oturumu kapatır; öyle bir sitede kapalı tutun. |
| Sekme atılmasını kapat | Chrome'un bellek tasarrufu için sekmeyi kapatmasını (`autoDiscardable: false`) engeller. |

### Kurulum

1. Bu depoyu indirin veya [Releases](../../releases) sayfasından zip'i alın.
2. `chrome://extensions` → sağ üstten **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** → depo klasörünü seçin.

### Kullanım

1. Oturumunun açık kalmasını istediğiniz siteye gidin.
2. Araç çubuğundaki AlwaysOnlineTab simgesine tıklayın ve **Bu site** anahtarını açın.
3. Chrome yalnızca o site için izin ister; onaylayın. Simgede `ON` görünür.
4. Kapatmak için anahtarı kapatın veya listeden **Kaldır**'a basın; izin de geri alınır.

### Sınırlamalar

- Sunucu, oturum süresinden bağımsız olarak **mutlak** bir süre sonra (ör. 8 saat) yeniden giriş istiyorsa bu engellenemez.
- Etkinliği `event.isTrusted` ile doğrulayan sayfalar sentetik olayları yok sayar; bu durumda sunucu yenilemesi ve görünürlük ayarı yine çalışır.
- Bilgisayar uykuya geçerse tarayıcı da durur.
- Sunucu yenilemesi yalnızca sitenin kök adresini (`/`) ister; açık sayfanın yolu ve sorgu dizesi asla tekrar istenmez. Yönlendirmeler izlenmez (popup'ta "yönlendirildi" olarak uyarı verilir), istek seçilen siteden dışarı çıkmaz ve hiçbir zaman sayfa dışından (çerezsiz) gönderilmez.
- Uzantı yalnızca popup'taki anahtarla açılır; Chrome'un uzantı menüsünden site izni vermek özelliği kendiliğinden açmaz.
- Bir site izni o host'un tüm portlarını kapsar (Chrome eşleşme kalıbı kısıtı).
- Site kapatıldığında açık sekmelerdeki görünürlük düzeltmesi geri alınır ve sekme atılabilir hale döner. Uzantıdan sinyal gelmezse (izin geri alındı, uzantı kaldırıldı) düzeltme en geç 30 dakikada kendiliğinden kalkar.

---

## English

Turn it on for a site that logs you out after inactivity and the session stays open.

### How it works

Only on sites you enable, at the interval you choose (30 s – 10 min):

- **Simulate user activity** — dispatches the `mousemove`, `pointermove`, `keydown/keyup (Shift)` and `scroll` events idle timers listen for. No clicks, no text input.
- **Keep tab visible** — `document.hidden`, `visibilityState` and `hasFocus()` always report visible/focused.
- **Refresh server session** (off by default) — a `GET` of the site root made from inside the page with the page's own cookies, so a server-side session timer resets. Some admin panels and firewalls end the session on such requests; keep it off there.
- **No tab discarding** — sets `autoDiscardable: false` on those tabs (restored when you disable the site).

The keep-alive request always targets the site root, never the open page's path or query, does **not follow redirects** (a redirect is shown as a warning) and is never sent from outside the page without its cookies, so one-time links are not replayed and no request leaves the chosen site. Only the popup toggle enables a site: a host grant made from Chrome's extensions menu does not. Disabling a site reverts the visibility patch in open tabs and re-allows tab discarding; if heartbeats from the extension stop (access revoked, extension removed) the patch removes itself within 30 minutes. One site grant covers every port of that host.

### Install

`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.

### Development

```bash
npm test                         # unit tests (no dependencies)
npm i --no-save puppeteer && node test/e2e/run.js   # end-to-end test in Chrome for Testing
npm run pack                     # dist/AlwaysOnlineTab-<version>.zip
npm run icons                    # regenerate icons (Python stdlib only)
```

The end-to-end test starts a local app that expires the server session after 45 s and logs the page out after 40 s of client inactivity, then checks that the protected tab survives 110 s while an unprotected tab on the same app is logged out.

## Security and privacy

- No analytics, no tracking, no remote code, no external servers. The only network request is the keep-alive `GET` to the page you already have open.
- Host access is requested **per site at runtime** (`optional_host_permissions`); nothing runs on sites you did not enable. Disabling a site revokes the permission.
- Minimal permissions: `storage`, `scripting`, `alarms`, `activeTab`.
- No message API for web pages or other extensions; content scripts accept messages only from this extension's service worker.
- Strict extension CSP: `script-src 'self'; object-src 'none'; base-uri 'none'`. The popup never uses `innerHTML`.
- Site keys are validated so they can never become wildcard match patterns.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © 2026 MSSOFT
