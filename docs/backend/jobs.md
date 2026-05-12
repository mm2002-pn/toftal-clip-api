# Backend — Jobs

Les jobs déclenchent des workers Cloud Run via le SDK `@google-cloud/run`
avec un override d'env vars.

## Triggers — `src/services/`

| Fichier | Job déclenché | Env override |
|---|---|---|
| `faststartTrigger.ts` | `faststart-worker[-staging]` | `VERSION_ID` |
| `previewTrigger.ts` | `preview-worker[-staging]` | `VERSION_ID` |
| `hlsTrigger.ts` | `hls-worker[-staging]` | `VERSION_ID` |
| `downscaleJobsService.ts` | `downscale-worker[-staging]` | `VERSION_ID`, `QUALITY`, `JOB_ROW_ID` |

Le sweeper `downscale-sweeper[-staging]` ne passe pas par un trigger
applicatif : Cloud Scheduler le lance directement toutes les 5 min via
l'API admin Cloud Run.

Pattern commun :

```typescript
export const triggerXxxJob = async (versionId: string) => {
  const jobName = process.env.XXX_JOB_NAME;
  if (!jobName) {
    console.warn('[xxx] XXX_JOB_NAME not set, skipping');
    return;
  }
  try {
    await runCloudRunJob(jobName, { VERSION_ID: versionId });
  } catch (err) {
    console.error('[xxx] failed to trigger job:', err);
  }
};
```

L'API ne **bloque pas** sur le résultat : trigger fire-and-forget, le worker
notifie la fin via l'endpoint internal.

## Workers — `src/workers/` et `scripts/`

| Fichier | Worker | Entrypoint Docker |
|---|---|---|
| `src/workers/faststart.ts` | faststart | `node dist/workers/faststart.js` |
| `src/workers/preview.ts` | preview | `node dist/workers/preview.js` |
| `src/workers/hls.ts` | hls | `node dist/workers/hls.js` |
| `scripts/downscale-version.ts` | downscale | `npm run downscale:run` (ts-node) |
| `scripts/sweep-downscale-zombies.ts` | sweeper | `npm run downscale:sweep` (ts-node) |

Note : les 3 anciens workers sont compilés vers `dist/` ; les 2 nouveaux
tournent en ts-node depuis `scripts/` parce qu'ils partagent le même
pattern que les backfills déjà en place dans ce dossier.

Tous suivent le même pattern :

1. Lit `VERSION_ID` depuis l'env
2. Lit la `Version` depuis Prisma
3. `prisma.$disconnect()` (libère la connexion idle pendant le download)
4. Download du MP4 source depuis GCS vers `/tmp`
5. Spawn `ffmpeg` avec les bons args
6. Upload du résultat sur GCS
7. POST `/internal/<xxx>-ready`
8. Cleanup `/tmp`
9. Exit 0

## Points d'attention

!!! warning "Cloud Run Jobs ≠ Cloud Run Services"
    Les jobs n'ont pas de port HTTP. Ils exécutent un binaire et sortent.
    L'image Docker est la même que l'API, mais on override le `CMD` au deploy
    avec `--command="node" --args="dist/workers/<xxx>.js"`.

!!! warning "Limite de timeout"
    Cloud Run Jobs : max 24 h théorique mais on plafonne à 30 min pour les
    encodes. Si une vidéo de plus prend plus longtemps, c'est qu'on a un
    problème (sizing ou format pathologique) — investiguer plutôt que monter
    le timeout.

!!! tip "Test en local"
    On peut lancer un worker localement avec :
    ```bash
    DATABASE_URL=... GCS_KEY_FILE=./gcs-key.json \
      VERSION_ID=<uuid> \
      npx ts-node src/workers/faststart.ts
    ```
    Pratique pour debug une vidéo qui échoue en prod sans avoir à attendre
    un Cloud Build complet à chaque essai.
