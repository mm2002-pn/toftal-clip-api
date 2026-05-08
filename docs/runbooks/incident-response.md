# Runbook — Incident response

## En cas d'alerte (production down / dégradée)

### 1. Trier la sévérité

| Symptôme | Sévérité |
|---|---|
| API renvoie 5xx > 50 % du traffic | P1 |
| Upload TUS échoue systématiquement | P1 |
| Lecture vidéo OK mais HLS non générée | P2 (preview MP4 dispo) |
| Webhook Bictorys non reçu | P2 |
| Lent mais ça passe | P3 |

### 2. Diagnostiquer (P1)

```bash
# Logs error API (5 dernières minutes)
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="toftal-clip-api"
   AND severity>=ERROR' \
  --limit=50 --freshness=5m \
  --project=toftal-clip-api \
  --format="value(timestamp,textPayload)"

# Trafic / latence (Cloud Monitoring → Cloud Run → toftal-clip-api)
# Métriques clés : request count, request latency, container CPU/memory
```

### 3. Mitiger

| Cause probable | Action |
|---|---|
| Bug dans la dernière deploy | Rollback Cloud Run (cf. [rollback](./rollback.md)) |
| Cloud SQL down | Vérifier `gcloud sql instances list` |
| Quota GCS dépassé | Vérifier console GCS, étendre quota si possible |
| OOM sur Cloud Run | Bumper `--memory` du service |
| Bictorys down | Communiquer aux users, désactiver le checkout |

### 4. Communiquer

- Slack #ops dès que P1 confirmé
- Status page (si disponible) : marquer l'incident
- Une fois résolu : post-mortem dans `docs/runbooks/incidents/` (à créer)

## Erreurs courantes

### TUS PATCH 404 "The file for this url was not found"

Possibilités :

1. **Cache localStorage stale** côté client (fingerprint d'un upload supprimé). Le client retry une fois, puis échoue. Solution : purger localStorage TUS.
2. **`getFileIdFromRequest` cassé** : le slash dans l'id (`videos/<uuid>.mp4`) doit être préservé. Voir [video-upload](../flows/video-upload.md).
3. **Permission GCS** : SA Cloud Run doit avoir `roles/storage.objectAdmin` sur le bucket.

### Worker faststart OOM kill

`/tmp` est en RAM sur Cloud Run gen2. Pour les vidéos > 4 GB on tape la limite. Bumper la mémoire à 16 Gi minimum.

### Worker preview "Stream map 'a:0' matches no streams"

Vidéo silencieuse. Le worker doit `ffprobe` avant pour conditionner `-map a:0`. Voir [workers](../infra/workers.md#preview-worker).

### Cloud SQL "terminating connection due to idle-session timeout"

Le worker attend trop longtemps entre la création de la version et le notify. Ajouter `await prisma.$disconnect()` avant le download GCS.

### Bictorys webhook 401 "signature invalid"

Vérifier que `BICTORYS_WEBHOOK_SECRET` correspond bien à celui configuré côté Bictorys (admin → webhooks). Ils peuvent en avoir plusieurs configurés simultanément — tester webhook par webhook.

### Cloud Run cold-start sur checkout-return

Bictorys redirige le user après paiement. Si on a 0 instances, le cold-start (~3s gen2) peut faire timeout côté browser. Vérifier `min-instances=2` sur le service.
