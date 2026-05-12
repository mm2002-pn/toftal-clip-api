# Backend — Base de données

PostgreSQL 14 sur Cloud SQL, accédée via Prisma.

## Layout

```
prisma/
├── schema.prisma       # source de vérité du modèle
├── seed.ts             # seed Prisma (npm run db:seed)
└── migrations/         # migrations versionnées générées par Prisma
```

Les migrations sont **commitées dans le repo**. On ne touche jamais une
migration déjà mergée — pour rectifier, on crée une nouvelle migration.

## Commandes principales

```bash
# Régénérer le client Prisma (TypeScript types) après edit du schema
npm run db:generate

# Pousser le schema sans migration (DEV uniquement)
npm run db:push

# Créer une migration localement (et l'appliquer sur ta base de dev)
npm run db:migrate

# Ouvrir Prisma Studio pour explorer la base
npm run db:studio

# Seed initial (données de référence)
npm run db:seed
```

## Migrations en staging / prod

Les migrations sont **manuelles**, pas dans le pipeline Cloud Build :

```bash
# 1. Récupérer la connection string
DATABASE_URL=$(gcloud secrets versions access latest \
  --secret=DATABASE_URL_STAGING --project=toftal-clip-api)

# 2. Appliquer
DATABASE_URL=$DATABASE_URL npx prisma migrate deploy
```

!!! danger "Avant une migration prod"
    1. **Backup obligatoire** : `gcloud sql export sql ...`
    2. **Aucune migration destructive** sans plan de rollback (DROP COLUMN,
       changement de type incompatible).
    3. **Tester en staging** d'abord pendant au moins 24h.

## Connexion en local

Deux options :

### Cloud SQL Proxy (recommandé)

```bash
# Démarrer le proxy
./cloud_sql_proxy.exe -instances=toftal-clip-api:europe-west1:toftal-clip-db=tcp:5432

# Dans .env
DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/toftal_clip"
```

### Postgres local

Si tu n'as pas accès à Cloud SQL ou tu veux bosser offline, lance un
Postgres local et applique le schema avec `npm run db:push`. Penser à
seed : `npm run db:seed` + `npm run seed:all` (cf. [Scripts](./scripts.md)).

## Seed Prisma

Le `prisma/seed.ts` insère les données **strictement nécessaires** pour
qu'un environnement vide fonctionne (rôles par défaut, paramètres système).
Les données de référence métier (feature flags, plans, templates email,
prompts IA) sont gérées par les seeders dédiés dans `scripts/` — voir
[Scripts](./scripts.md).

## Conventions de schema

- **Tables** : PascalCase singulier (`User`, `Version`)
- **Colonnes** : camelCase (`createdAt`)
- **FK** : `<entity>Id` (`projectId`)
- **Soft delete** : `deletedAt: DateTime?` plutôt que `DELETE`
  (pas systématique, à juger par table)
- **Index** : ajouter explicitement pour toute colonne souvent en `WHERE`
  ou `ORDER BY`. Les FK sont indexées automatiquement par Prisma.
- **Enums** : valeurs en SCREAMING_SNAKE_CASE (`PROCESSING`, `READY`)
