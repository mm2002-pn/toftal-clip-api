# Conventions — Git

## Branches

| Branche | Rôle |
|---|---|
| `main` | Production. Merge depuis `staging` après validation. |
| `staging` | Environnement de validation. Auto-deploy sur push. |
| `feature/<nom>` | Branches de feature, mergées dans `staging` |
| `fix/<nom>` | Branches de fix |
| `chore/<nom>` | Tâches techniques (deps, build, doc) |

## Commits

Style : **résumé impératif court** + corps explicatif.

✅ Bon :

```
TUS: parse pathname from fetch Request.url in getFileIdFromRequest

@tus/server hands the hook a fetch-API Request, where `req.url` is
the absolute URL (https://host/api/v1/tus/...), not the path. The
previous version called startsWith('/api/v1/tus/') against the full
URL, returned undefined, and every PATCH/HEAD/DELETE 404'd.

Parse the pathname first, then strip the configured TUS prefix.
```

❌ Pas ce qu'on veut :

- `fix bug` (pas assez précis)
- `WIP` (pas en `main`/`staging`)
- `Update file.ts` (qu'est-ce qui a changé et pourquoi ?)

## Pull requests

- Titre : même style que le commit principal, court et explicite
- Description : pourquoi (lien issue, contexte) + comment tester
- Reviewer obligatoire avant merge sur `main` (pas obligatoire sur `staging`)
- Squash merge préféré pour garder un historique propre

## Push direct sur staging

Toléré pour des fix urgents et de la doc, à éviter pour des features
complètes (préférer une PR pour la review). Ne **jamais** push direct
sur `main`.
