# Infra — Service Accounts IAM

Plutôt que d'utiliser le compte personnel ou un seul SA root pour
tout, on a une poignée de service accounts spécialisés, chacun avec un
minimum de droits. Ça réduit la surface d'attaque (un compromis sur
un SA n'expose pas tout) et clarifie « qui fait quoi » dans les audit
logs.

## Cartographie

| Service account | Type | Utilisé par | Rôles |
|---|---|---|---|
| `<project-number>-compute@developer.gserviceaccount.com` | Default | Cloud Run **service** API (runtime), Cloud Run **Jobs** (downscale, faststart, hls, preview, sweeper) | `roles/secretmanager.secretAccessor` (project-level), `roles/run.invoker` sur `downscale-worker`, `roles/cloudsql.client`, `roles/storage.objectAdmin` |
| `scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com` | User-created | Cloud Scheduler cron jobs qui déclenchent des Cloud Run Jobs | `roles/run.invoker` sur `downscale-sweeper[-staging]` |
| `backfill-job-sa@toftal-clip-api.iam.gserviceaccount.com` | User-created | Cloud Run Jobs de backfill (metadata, thumbnails, etc.) | Mêmes rôles que le compute SA mais pour exécutions ponctuelles |
| `toftal-storage@toftal-clip-api.iam.gserviceaccount.com` | User-created | Anciens services qui uploadent vers GCS depuis local dev | `roles/storage.admin`, `roles/storage.objectAdmin` |
| `service-<project-number>@gcp-sa-cloudscheduler.iam.gserviceaccount.com` | **Google-managed** (auto) | Cloud Scheduler interne, pour mint les OAuth tokens demandés par `--oauth-service-account-email` | (auto) ; doit avoir `roles/iam.serviceAccountTokenCreator` sur `scheduler-invoker-sa` |

## Détail par SA

### Compute SA par défaut

Le SA assigné automatiquement à toutes les ressources Cloud Run du
projet quand on n'en spécifie pas d'autre. Format
`<project-number>-compute@developer.gserviceaccount.com`. Sur notre
projet : `776016345965-compute@developer.gserviceaccount.com`.

**Pourquoi on l'utilise pour tout** : pragmatisme. On pourrait créer
un SA dédié par service Cloud Run (`api-runtime-sa`,
`downscale-worker-sa`, etc.) mais ça multiplie le nombre d'objets à
gérer. Le compute SA est nettement « over-privileged » mais on a
limité ses rôles aux strict nécessaires :

| Rôle | Niveau | Justification |
|---|---|---|
| `roles/secretmanager.secretAccessor` | Projet | Lit `DATABASE_URL`, `JWT_SECRET`, etc. depuis Secret Manager |
| `roles/cloudsql.client` | Projet | Le service API + jobs ont besoin de se connecter à Cloud SQL via le proxy |
| `roles/storage.objectAdmin` | Projet | Upload / read / delete sur GCS (vidéos, thumbnails) |
| `roles/run.invoker` | Job spécifique | L'API peut déclencher `downscale-worker` |

Le `roles/secretmanager.secretAccessor` est project-level — important
parce qu'on ajoute parfois de nouveaux secrets (`INTERNAL_API_SECRET`,
`BICTORYS_*`) et le binding project couvre automatiquement les
nouveaux sans qu'on ait à les binder secret-par-secret.

### `scheduler-invoker-sa`

Existence justifiée : Cloud Scheduler ne peut pas appeler la Cloud
Run Admin API anonymement. Il faut qu'il s'authentifie comme un user,
et on ne veut pas lui donner les droits du compute SA (qui peut tout
faire). Donc un SA minimal qui peut juste invoquer le Job sweeper.

```bash
gcloud iam service-accounts create scheduler-invoker-sa \
  --display-name="Cloud Scheduler -> Cloud Run Jobs invoker"

# Droit d'invoquer un Job spécifique (pas tous)
gcloud run jobs add-iam-policy-binding downscale-sweeper-staging \
  --region=europe-west1 \
  --member='serviceAccount:scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/run.invoker'

# Et le Cloud Scheduler service agent doit pouvoir mint des tokens
# comme scheduler-invoker-sa (sinon --oauth-service-account-email
# échoue avec 401 UNAUTHENTICATED)
PROJECT_NUM=$(gcloud projects describe toftal-clip-api --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com \
  --member="serviceAccount:service-${PROJECT_NUM}@gcp-sa-cloudscheduler.iam.gserviceaccount.com" \
  --role='roles/iam.serviceAccountTokenCreator'
```

### Cloud Scheduler service agent

Auto-créé par Google quand on active l'API `cloudscheduler.googleapis.com`.
Format : `service-<project-number>@gcp-sa-cloudscheduler.iam.gserviceaccount.com`.

C'est l'identité que Cloud Scheduler utilise EN INTERNE pour mint des
OAuth tokens. Quand on configure un cron HTTP avec
`--oauth-service-account-email=foo@…`, le scheduler dit à IAM « give
me a token AS foo@… » — l'IAM check que **le scheduler agent** a le
droit `iam.serviceAccountTokenCreator` sur `foo@…`.

Sans ce binding, le scheduler envoie une requête HTTP sans Authorization
header → Cloud Run Admin API répond 401 → le Job n'est jamais
déclenché. Symptôme dans les logs Cloud Scheduler :

```
debugInfo: URL_ERROR-ERROR_AUTHENTICATION. Original HTTP response code number = 401
status: UNAUTHENTICATED
```

C'est le piège qu'on a hit la première fois qu'on a setup le sweeper.

### `backfill-job-sa`

User-created pour les Cloud Run Jobs de backfill (`backfill-staging`
référencé dans `cloudrun-jobs/backfill-staging.yaml`). Mêmes droits
que le compute SA, mais isolé : un script de migration buggé qui
écrit n'importe quoi en DB peut être audit-tracé sur ce SA.

Note : pour les nouveaux downscale + sweeper jobs déployés via
`cloudbuild*.yaml`, on a finalement utilisé le **compute SA** par
défaut au lieu de `backfill-job-sa` parce que les YAMLs cloudbuild
les définissent inline et il était plus simple de réutiliser le SA
déjà configuré.

### `toftal-storage`

Legacy. Créé tôt dans le projet pour permettre aux devs locaux de
push vers GCS depuis leur machine via un service account JSON. Le
fichier `gcs-key.json` (ignoré par git) embarque sa clé privée. En
prod / staging, le compute SA prend le relais via Application
Default Credentials, donc ce SA n'est utile QUE en dev local.

À envisager : revoke et migrer les devs vers `gcloud auth
application-default login` qui utilise leur propre compte Google avec
les droits qu'ils ont déjà.

## Workflow pour ajouter un nouveau SA

Cas type : créer un SA spécifique pour le worker `downscale-worker`
au lieu d'utiliser le compute SA par défaut.

```bash
# 1. Créer le SA
gcloud iam service-accounts create downscale-worker-sa \
  --display-name="Downscale Worker Job runtime"

# 2. Donner les rôles strict nécessaires
gcloud projects add-iam-policy-binding toftal-clip-api \
  --member='serviceAccount:downscale-worker-sa@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/cloudsql.client'

gcloud projects add-iam-policy-binding toftal-clip-api \
  --member='serviceAccount:downscale-worker-sa@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/storage.objectAdmin'

# 3. Le compute SA (qui déclenche le job depuis l'API) doit pouvoir
# act-as le nouveau SA
gcloud iam service-accounts add-iam-policy-binding \
  downscale-worker-sa@toftal-clip-api.iam.gserviceaccount.com \
  --member='serviceAccount:776016345965-compute@developer.gserviceaccount.com' \
  --role='roles/iam.serviceAccountUser'

# 4. Modifier cloudbuild*.yaml : `--service-account=downscale-worker-sa@…`
```

## Patterns à éviter

- ❌ Pas de service account = Cloud Run utilise par défaut le
  compute SA → 90 % des prod l'utilisent et c'est *globalement* OK
  mais empêche le least-privilege

- ❌ Donner `roles/owner` à un SA → cherche les ennuis. Un SA
  compromis a alors les pleins droits, peut supprimer les buckets,
  exfiltrer les secrets, etc.

- ❌ Mettre la clé JSON d'un SA dans le code / dans un fichier de
  config commité → l'attaquant qui clone le repo a accès à GCP. Si
  c'est nécessaire pour le dev local, mettre la clé dans Secret
  Manager + script qui la fetch à la session.

- ❌ Oublier `iam.serviceAccountTokenCreator` quand on utilise
  `--oauth-service-account-email` sur Cloud Scheduler ou un autre
  service Google qui doit emprunter un SA → erreurs 401 silent

## Voir aussi

- `infra/secrets.md` — quels secrets sont stockés, à quel SA ils sont
  accessibles
- `infra/cloud-run.md` — comment Cloud Run injecte les SA dans les
  containers (env var `GOOGLE_APPLICATION_CREDENTIALS` n'est pas
  nécessaire — Cloud Run le fait via metadata server)
- `cloudrun-jobs/README.md` — checklist IAM pour staging / prod des
  jobs downscale + sweeper
