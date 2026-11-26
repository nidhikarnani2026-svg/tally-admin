'use strict';
// Online version: no key is kept in these files. It asks the server for the public key, then starts the app.
(async () => {
  const stop = t => { const m = document.getElementById('msg'); m.textContent = t; m.hidden = false; };
  if (window.top !== window.self) return stop('Please open this page on its own.');
  const url = 'https://pvixwpksfniwwwktrygw.supabase.co';
  const r = await fetch(url + '/functions/v1/tally/signin').then(x => x.ok ? x.json() : null).catch(() => null);
  if (!r || !/^sb_publishable_/.test(r.key)) return stop('Cannot reach the server. Check the internet and reload.');
  window.CFG = { url, key: r.key };
  const s = document.createElement('script'); s.src = 'app.js'; document.body.append(s);
})();