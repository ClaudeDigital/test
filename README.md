# A po pijmë kafe?

Ftesë për kafe, mobile-first. "Jo" ikën dhe bën pyetje qesharake, "Po" rritet derisa mbulon ekranin.
Pas "Po": emri, dita, ora, vendi → konfirmim → njoftim me email (Resend) + buqetë me lule.

- `server.js` — Node 20, pa varësi. `POST /api/confirm`, ruan te `data/konfirmimet.jsonl`.
- `.env`: `RESEND_API_KEY`, `MAIL_TO`, `MAIL_FROM`, `PORT`.
- Prodhimi: CT 104 `/opt/kafe`, systemd `kafe`, nginx :80 → 127.0.0.1:3000.
