# Backend — Jobs

Les jobs déclenchent des workers Cloud Run via `gcloud run jobs execute` avec
un override d'env var `VERSION_ID`.

## Triggers — `src/services/`

| Fichier | Job déclenché |
|---|---|
| `faststartTrigger.ts` | `faststart-worker-{env}` |
| `previewTrigger.ts` | `preview-worker-{env}` |
| `hlsTrigger.ts` | `hls-worker-{env}` |

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

## Workers — `src/workers/`

| Fichier | Worker |
|---|---|
| `faststart.ts` | Le code qui tourne dans le job faststart |
| `preview.ts` | Le code qui tourne dans le job preview |
| `hls.ts` | Le code qui tourne dans le job HLS |

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
