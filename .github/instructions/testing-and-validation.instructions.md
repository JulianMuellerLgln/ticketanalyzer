---
description: Always add and run validation for product changes before finishing work.
---

Every change in this repository must include matching validation:

- run linting for frontend-impacting changes with `npm run lint`
- run the frontend regression suite with `npm run test:frontend`
- run the API/server regression suite with `npm run test:api`
- run the production build with `npm run build`

When behavior changes, extend the relevant automated coverage in the same task instead of relying on manual checks alone.
