# Infra — Cloud SQL Proxy

Le **Cloud SQL Proxy** ouvre un tunnel sécurisé entre ta machine et
l'instance Cloud SQL `toftal-clip-api:europe-west1:toftal-clip-db`. Tu
parles ensuite à `127.0.0.1:<port>` comme si c'était un Postgres local —
le proxy chiffre, authentifie et route vers GCP.

C'est le moyen **recommandé** pour :

- lancer `prisma migrate deploy` contre staging/prod depuis ta machine
- ouvrir Prisma Studio sur la base réelle
- exécuter un backfill ou une requête ad-hoc avec `psql`
- déboguer un état de base avant un fix

!!! danger "Tu touches une vraie base"
    Quand tu es connecté via le proxy, tu écris **vraiment** dans la base
    staging/prod. `DELETE FROM "User"` ne demande pas confirmation. Toujours
    faire un dump avant les écritures destructives ; toujours préfixer par
    `BEGIN;` si tu n'es pas sûr.

## Installation

Le binaire `cloud_sql_proxy.exe` est déjà dans le repo (Windows). Pour
les autres OS :

=== "Windows"
    Le binaire est versionné dans le repo : `cloud_sql_proxy.exe`. Si tu
    veux la dernière version :
    ```powershell
    Invoke-WebRequest `
      -Uri "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.13.0/cloud-sql-proxy.x64.exe" `
      -OutFile "cloud_sql_proxy.exe"
    ```

=== "macOS"
    ```bash
    curl -o cloud-sql-proxy \
      https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.13.0/cloud-sql-proxy.darwin.arm64
    chmod +x cloud-sql-proxy
    ```

=== "Linux"
    ```bash
    curl -o cloud-sql-proxy \
      https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.13.0/cloud-sql-proxy.linux.amd64
    chmod +x cloud-sql-proxy
    ```

## Authentification

Trois méthodes, du plus simple au plus contrôlé :

### 1. Auth gcloud (recommandé en local)

Le proxy utilise les credentials de ton `gcloud auth login` :

```bash
gcloud auth login
gcloud auth application-default login
```

Puis :

```bash
./cloud_sql_proxy.exe --gcloud-auth \
  toftal-clip-api:europe-west1:toftal-clip-db \
  --port=5433
```

C'est ce que font tous les scripts PowerShell du repo (`deploy.ps1`,
`redeploy-staging.ps1`, etc.) — flag `--gcloud-auth`.

### 2. Service account JSON

Si tu n'as pas envie de dépendre du contexte gcloud :

```bash
./cloud_sql_proxy.exe \
  --credentials-file=./gcs-key.json \
  toftal-clip-api:europe-west1:toftal-clip-db \
  --port=5433
```

Le SA doit avoir le rôle `roles/cloudsql.client` sur le projet.

### 3. IAM Auth (passwordless)

Pas en place actuellement. À considérer si on veut éliminer les mots de
passe DB en circulation.

## Connection string

L'instance Cloud SQL est `toftal-clip-api:europe-west1:toftal-clip-db`.
Trois parties séparées par `:` :

- `toftal-clip-api` — projet GCP
- `europe-west1` — région
- `toftal-clip-db` — nom de l'instance

!!! tip "Vérifier l'instance string"
    ```bash
    gcloud sql instances describe toftal-clip-db \
      --project=toftal-clip-api \
      --format="value(connectionName)"
    ```

## Ports

Convention dans le repo : **5433** (pas 5432) pour éviter le conflit
avec un Postgres local éventuel sur le port standard.

```bash
DATABASE_URL="postgresql://toftal_user:<password>@127.0.0.1:5433/toftal_clip?schema=public"
```

Le mot de passe se récupère depuis Secret Manager :

```bash
gcloud secrets versions access latest \
  --secret=DATABASE_URL_STAGING \
  --project=toftal-clip-api
```

(la valeur est la connection string complète — copie/colle)

## Workflow type

### Migration prod manuelle

```bash
# 1. Démarre le proxy
./cloud_sql_proxy.exe --gcloud-auth \
  toftal-clip-api:europe-west1:toftal-clip-db \
  --port=5433

# 2. Dans un autre terminal — set DATABASE_URL
export DATABASE_URL="postgresql://toftal_user:...@127.0.0.1:5433/toftal_clip?schema=public"

# 3. Backup
gcloud sql export sql toftal-clip-db \
  gs://toftal-clip-backups/prod-$(date +%Y%m%d-%H%M).sql.gz \
  --database=toftal_clip --project=toftal-clip-api

# 4. Migration
npx prisma migrate deploy

# 5. Stop le proxy (Ctrl+C dans le 1er terminal)
```

### Prisma Studio sur staging

```bash
./cloud_sql_proxy.exe --gcloud-auth \
  toftal-clip-api:europe-west1:toftal-clip-db --port=5433

# Autre terminal
DATABASE_URL="..." npx prisma studio
```

Studio s'ouvre sur `http://localhost:5555`.

### psql direct

```bash
psql "postgresql://toftal_user:<pwd>@127.0.0.1:5433/toftal_clip?sslmode=disable"
```

`sslmode=disable` parce que le proxy gère le TLS upstream — entre toi
et 127.0.0.1, c'est en clair (sur loopback, c'est OK).

## Pièges connus

!!! warning "Cloud SQL Proxy laissé tourner"
    Si tu lances le proxy puis ferme le terminal sans Ctrl+C, le process
    reste vivant et garde le port 5433 occupé. Symptôme au prochain run :
    `bind: address already in use`.
    
    Sur Windows :
    ```powershell
    Get-Process cloud_sql_proxy | Stop-Process -Force
    ```
    
    Sur Mac/Linux :
    ```bash
    pkill -f cloud-sql-proxy
    ```

!!! warning "Pare-feu Windows"
    Au premier lancement, Windows demande l'autorisation réseau. Refuser
    bloque le proxy silencieusement (le `connect` échoue avec timeout).
    Si tu vois `i/o timeout` dans les logs du proxy, vérifier le pare-feu.

!!! warning "VPN d'entreprise"
    Certains VPN intercept le SNI vers `*.googleapis.com` et cassent le
    handshake TLS du proxy. Symptôme : `tls: handshake failure` au boot.
    Workaround : désactiver le VPN le temps du proxy, ou whitelist
    `cloudsql.googleapis.com`.

!!! warning "Refresh des credentials"
    `--gcloud-auth` lit le token au démarrage. Si ton gcloud expire en
    cours de session, le proxy commence à 401. Re-`gcloud auth login` et
    relancer le proxy.

## Versions du proxy

Le binaire dans le repo est `v2.x` (v2 par défaut depuis 2023). Pour
compatibilité legacy avec un script qui attend la v1, voir la doc Google
— mais on ne supporte pas la v1 dans ce repo.

## Référence

- Doc officielle : https://cloud.google.com/sql/docs/postgres/sql-proxy
- Releases : https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases
