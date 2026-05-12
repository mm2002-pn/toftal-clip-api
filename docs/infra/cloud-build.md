# Infra — Cloud Build

## Pipelines

| Branche | Fichier | Cible | Service |
|---|---|---|---|
| `staging` | `cloudbuild-staging.yaml` | API + workers | `toftal-clip-api-staging` |
| `main` | `cloudbuild.yaml` | API + workers | `toftal-clip-api` |

Chaque pipeline :

1. Build l'image Docker
2. Push sur GCR
3. `gcloud run deploy` pour le service API
4. `gcloud run jobs deploy` pour chacun des 3 workers (faststart, preview, hls)

## Setup d'un trigger (création initiale)

Si tu repars de zéro (nouveau repo, nouvel environnement), voici la
procédure pour brancher Cloud Build sur GitHub.

### 1. Connecter le repo GitHub

Console GCP → Cloud Build → **Triggers** → **Connect Repository** →
provider GitHub → autoriser → choisir `mm2002-pn/toftal-clip-api`.

### 2. Créer le trigger staging

| Champ | Valeur |
|---|---|
| Name | `toftal-clip-api-staging` |
| Region | `europe-west1` (ou `global`) |
| Event | **Push to a branch** |
| Source | repo connecté |
| Branch | `^staging$` (regex stricte, sinon le trigger fire sur les feature/staging-xxx) |
| Configuration | Cloud Build configuration file (yaml) |
| Location | Repository |
| File | `cloudbuild-staging.yaml` |

### 3. Filtres de fichiers

C'est la **section critique** pour ne pas builder pour rien.

**Included files** (laisser vide = tous les fichiers déclenchent) :
laisse vide.

**Ignored files** :
```
docs/**
mkdocs.yml
**.md
.github/workflows/docs.yml
requirements-docs.txt
```

Sans ça, modifier un Markdown lance un build complet (~7 min) pour rien.

### 4. Service account

Le trigger doit utiliser un SA qui a :

| Rôle | Pourquoi |
|---|---|
| `roles/run.admin` | Déployer Cloud Run services + jobs |
| `roles/storage.admin` (sur GCR) | Push des images Docker |
| `roles/secretmanager.secretAccessor` | Lire les secrets pendant le build |
| `roles/iam.serviceAccountUser` | Acter au nom du SA des services |
| `roles/cloudsql.client` (si build touche la DB) | Connecter Cloud SQL |

Par défaut Cloud Build utilise `<project-number>@cloudbuild.gserviceaccount.com`
— check ses rôles dans IAM.

### 5. Substitutions

Cloud Build remplit automatiquement :

| Variable | Valeur |
|---|---|
| `$SHORT_SHA` | 7 premiers caractères du commit SHA |
| `$COMMIT_SHA` | SHA complet |
| `$BRANCH_NAME` | `staging` |
| `$REPO_NAME` | `toftal-clip-api` |
| `$PROJECT_ID` | `toftal-clip-api` |

Pour ajouter une substitution custom (ex. `_GCS_BUCKET`) : section
**Substitution variables** du trigger. Référencer ensuite avec
`${_GCS_BUCKET}` dans le yaml.

### 6. Cloner le trigger pour prod

Idem mais :

- Name : `toftal-clip-api-prod`
- Branch : `^main$`
- File : `cloudbuild.yaml`
- (mêmes ignored files)

## Lecture / modification d'un trigger existant

```bash
# Liste
gcloud builds triggers list --project=toftal-clip-api --format="table(name,filename,github.push.branch)"

# Détail
gcloud builds triggers describe toftal-clip-api-staging --project=toftal-clip-api

# Export en yaml (pour versionning éventuel)
gcloud builds triggers export toftal-clip-api-staging \
  --destination=trigger-staging.yaml --project=toftal-clip-api
```

Pour modifier les `ignoredFiles` en CLI plutôt qu'en console :

```bash
gcloud builds triggers import --source=trigger-staging.yaml \
  --project=toftal-clip-api
```

(éditer le yaml local, ré-importer)

## Triggers

Configurés dans la console GCP → Cloud Build → Triggers. Settings clés :

| Trigger | Branch | `includedFiles` | `ignoredFiles` |
|---|---|---|---|
| `staging` | `^staging$` | `**` | `docs/**`, `mkdocs.yml`, `*.md`, `.github/workflows/docs.yml` |
| `prod` | `^main$` | `**` | idem |

!!! tip "Ajouter `ignoredFiles`"
    Sans `ignoredFiles`, modifier un Markdown de la doc déclenche un build
    complet de l'API (~7 min) pour rien. Réglage à faire **une fois** dans
    la console pour chaque trigger :
    
    Console GCP → Cloud Build → Triggers → cliquer sur le trigger →
    section **Files** → ajouter aux **Ignored files** : `docs/**`,
    `mkdocs.yml`, `**.md`, `.github/workflows/docs.yml`

## Lancer un build manuellement

```bash
gcloud builds submit \
  --config=cloudbuild-staging.yaml \
  --project=toftal-clip-api \
  --substitutions=SHORT_SHA=$(git rev-parse --short HEAD)
```

## Suivre un build

```bash
# Liste des derniers builds
gcloud builds list --project=toftal-clip-api --limit=5 \
  --format="table(id,status,createTime.date(tz=UTC),substitutions.SHORT_SHA)"

# Détails d'un build
gcloud builds describe <build-id> --project=toftal-clip-api

# Logs en stream (build en cours)
gcloud builds log <build-id> --project=toftal-clip-api --stream
```

## Durée typique

| Étape | Durée |
|---|---|
| Pull de l'image de base | 30s |
| `npm ci` | 1-2 min |
| `tsc` (build TypeScript) | 30s |
| `prisma generate` | 15s |
| Push image | 1 min |
| Deploy service API | 1-2 min |
| Deploy 3 jobs | 1-2 min (parallèle) |
| **Total** | **5-8 min** |
