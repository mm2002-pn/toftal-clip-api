# Frontend — Routing

React Router v6, défini dans `App.tsx`. Les pages sont dans `pages/`.

## Routes principales

| Path | Page | Auth ? |
|---|---|---|
| `/` | `HomePage` | non |
| `/login` | `LoginPage` | non |
| `/register` | `RegisterPage` | non |
| `/accept-invitation/:token` | `AcceptInvitation` | non |
| `/dashboard` | `DashboardPage` | oui |
| `/projects` | `ProjectsPage` | oui |
| `/projects/:id` | `ProjectDetailPage` | oui |
| `/deliverable/:id` | `DeliverableDetailPage` | oui ou guest token |
| `/share/:token` | `SharePage` | guest |
| `/shared-video/:token` | `SharedVideoPage` | guest |
| `/checkout/return` | `CheckoutReturnPage` | non |
| `/talents` | `Talents` | oui |
| `/opportunities` | `Opportunities` | oui |
| `/settings` | `SettingsPage` | oui |

## Garde d'auth

`<RequireAuth>` (composant wrapper) — redirige vers `/login` avec query
`?next=...` pour reprendre après login.

## Lazy loading

Les pages volumineuses (DeliverableDetailPage, SharePage) sont en
`React.lazy()` pour split le bundle. Le main bundle reste autour de
~450 kB gzipped.
