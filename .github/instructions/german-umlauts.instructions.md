---
description: Use proper German umlauts in all German UI and documentation text.
applyTo: "client/src/**/*,server/src/**/*,README.md,client/e2e/**/*"
---

For all German texts, always use proper umlauts and Eszett where appropriate:
- `Ä Ö Ü`
- `ä ö ü`
- `ß`

Do not replace umlauts with transliterations like `ae`, `oe`, `ue`, or `ss` when the correct German spelling requires umlauts/Eszett.

Keep files in UTF-8 encoding to avoid broken special characters in the UI and tests.
