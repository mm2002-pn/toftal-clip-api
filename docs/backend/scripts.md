# Backend — Scripts (seeders & backfills)

`scripts/` regroupe les **scripts one-shot** : seeders de données de
référence et backfills de migration. Tous sont exécutables via `ts-node`
et exposés en alias npm.

## Seeders de référence

Données métier nécessaires au bon fonctionnement de l'app. À lancer une
fois par environnement, puis quand on enrichit la liste.

| Commande | Rôle | Reset ? |
|---|---|---|
| `npm run seed:feature-flags` | Crée/sync les feature flags | `--reset` pour wipe |
| `npm run seed:email-templates` | Templates emails (invitation, partage, alerte) | non |
| `npm run seed:ai-prompts` | Prompts IA (transcription, suggestions) | non |
| `npm run seed:subscription-plans` | Plans Bictorys (Free, Pro, Studio) | `--reset` |
| `npm run seed:all` | Lance les 4 ci-dessus en séquence | non |

Conventions communes :

- Idempotents : ré-exécuter ne crée pas de doublon (upsert sur `name`/`slug`)
- Logs explicites : `[seed:feature-flags] created flag X`, `updated`, `skipped`
- Mode `--reset` quand pertinent : supprime puis recrée (utile en staging)

## Backfills (migrations de données)

Quand on ajoute une colonne ou qu'on corrige des données déjà en base.
**Toujours** disponible avec `--dry-run` pour valider l'impact avant
écriture.

| Commande | Rôle |
|---|---|
| `npm run backfill:thumbnails` | Génère les thumbnails manquantes |
| `npm run backfill:metadata` | ffprobe sur les vidéos sans `Version.metadata` |
| `npm run backfill:cache-control` | Pose les headers `Cache-Control` sur les objets GCS |
| `npm run backfill:audio-mime` | Corrige les content-types audio mal taggués |
| `npm run backfill:file-sizes` | Renseigne `Version.fileSize` à partir de la taille GCS |
| `npm run backfill:all` | Lance les 5 ci-dessus en séquence |

Toutes les commandes ont une variante `:dry` (ex. `backfill:thumbnails:dry`)
qui logue ce qui **serait** modifié sans toucher la DB ni GCS.

!!! tip "Workflow recommandé"
    1. Lancer la version `:dry` → vérifier le compte et un échantillon
    2. Lancer la vraie sur **staging**
    3. Lancer la vraie sur **prod** uniquement après validation staging

## Utilitaires

| Script | Rôle |
|---|---|
| `scripts/create-test-users.ts` | Seed des comptes de test pour QA staging |
| `scripts/create-test-users-prod.sh` | Idem, version prod (à utiliser avec parcimonie) |
| `scripts/create-missing-talent-profiles.ts` | One-shot historique — voir avec git log |
| `scripts/transcode-webm-to-mp4.ts` | Transcode les WebM legacy en MP4 |

Ces scripts sont volontairement **non-aliasés** dans `package.json` parce
qu'ils sont rarement utiles et leur exécution doit être délibérée.

## Cloud Run Job pour backfills longs

`cloudrun-jobs/backfill-staging.yaml` définit un job Cloud Run dédié
pour les backfills qui dépasseraient le timeout d'un script local
(grosse base, accès GCS lent depuis l'extérieur).

Voir `cloudrun-jobs/README.md` pour la procédure de déclenchement.

## Quand créer un nouveau script ?

- ✅ Migration de données ponctuelle après merge d'une feature
- ✅ Nettoyage one-shot (objects GCS orphelins, comptes inactifs, etc.)
- ✅ Seed de données de référence qui doivent vivre dans toute la durée
  du projet

- ❌ Logique métier appelée par les users (→ controller / service)
- ❌ Tâche périodique (→ Cloud Scheduler + endpoint authentifié, ou Cloud Run Job programmé)
