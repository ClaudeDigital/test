# A po pijmë një kafe? ☕

Faqe argëtuese për ta ftuar dikë në kafe. Live: https://test.gezimm.com

- **Po** rritet sa herë që dikush provon të klikojë **Jo**.
- **Jo** ikën nëpër ekran dhe nuk pranohet kurrë.
- Pas **Po**: zgjidhet data, ora dhe vendi, del timeri deri në takim dhe mesazhi për WhatsApp.

## Email kur pranon

Kur personi e cakton datën, faqja dërgon POST te `https://n8n.gezimm.com/webhook/kafe-date`
(fushat: `date`, `time`, `place`, `dateText`, `triesOnJo`, `sentAt`, `timezone`).

1. Në n8n: **Import from File** → `n8n/kafe-date-email.json`.
2. Te nyja **Gmail**: zgjidh kredencialin e Gmail-it dhe vendos emailin tënd te **To** (në vend të `EMAILI_YT@gmail.com`).
3. **Activate** workflow-n.
