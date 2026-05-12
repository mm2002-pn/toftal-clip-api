# Infra — Secrets

Tous les secrets vivent dans **Google Secret Manager**, jamais en clair dans
le code ou les yaml. Les services Cloud Run y accèdent via le rôle
`roles/secretmanager.secretAccessor`.

## Liste des secrets

| Nom | Usage | Rotation |
|---|---|---|
| `DATABASE_URL` (prod) | URL Postgres prod | jamais (auto via Cloud SQL connector si possible) |
| `DATABASE_URL_STAGING` | URL Postgres staging | jamais |
| `JWT_SECRET` | Signature access tokens | si compromis → invalide tous les access tokens |
| `JWT_REFRESH_SECRET` | Signature refresh tokens | si compromis → relog tous les users |
| `EMAIL_PASSWORD` | SMTP (Resend / SendGrid) | côté provider |
| `GROQ_API_KEY` | API LLM | côté provider |
| `UPSTASH_REDIS_REST_TOKEN` | API REST Upstash | côté provider |
| `REDIS_TCP_URL` | Connexion TCP Upstash | côté provider |
| `BICTORYS_PUBLIC_KEY*` | ID marchand | jamais (sauf changement compte) |
| `BICTORYS_SECRET_KEY*` | Auth API | si compromis |
| `BICTORYS_WEBHOOK_SECRET*` | Vérif signature webhook | si compromis |
| `INTERNAL_API_SECRET*` | Auth worker → API | rotation possible (changer simultanément côté workers) |

`*` = suffixé par environnement (`_STAGING`, vide pour prod).

## Lire un secret

```bash
gcloud secrets versions access latest --secret=DATABASE_URL_STAGING \
  --project=toftal-clip-api
```

## Mettre à jour un secret

```bash
echo -n "<nouvelle-valeur>" | gcloud secrets versions add JWT_SECRET \
  --data-file=- --project=toftal-clip-api
```

⚠️ Ça crée une **nouvelle version** ; les anciens services Cloud Run en
production lisent toujours la version sur laquelle ils ont été déployés
(parce que `--set-secrets=KEY=NAME:latest` résout `latest` au moment du
deploy, pas à chaque request). Pour pousser le nouveau secret, redéploie le
service : `gcloud run services update --revision-suffix=...` ou re-push.

## Rotation d'un secret critique

Procédure pour, par exemple, `JWT_SECRET` :

1. `gcloud secrets versions add JWT_SECRET --data-file=-` → nouvelle version
2. Redéploie l'API → utilise la nouvelle version
3. Tous les access tokens en circulation deviennent invalides → les users
   relogguent. Pour éviter ça, on peut implémenter une période de grâce
   (l'API accepte les deux secrets pendant 24 h) — mais ça n'est pas en place
   aujourd'hui.

## Anti-pattern à éviter

!!! danger "NE PAS commiter de `.env` dans le repo"
    Les fichiers `.env` sont dans `.gitignore` (vérifier !). Si un secret
    fuite par erreur, **rotation immédiate** côté provider, puis squash de
    l'historique git si on est encore en pré-public.

!!! danger "NE PAS hardcoder des fallbacks de secrets"
    Pattern dangereux qu'on a déjà eu : `process.env.JWT_SECRET || 'dev-secret'`.
    En cas de mauvais déploiement, la valeur dev se retrouve en prod. Préférer
    un crash explicite : `if (!process.env.JWT_SECRET) throw new Error('...')`.
