# Architecture — Vue d'ensemble

## Diagramme global

```mermaid
flowchart LR
  subgraph Client["Navigateur"]
    FE[React + Vite<br/>staging.toftalclip.io]
  end

  subgraph Netlify
    NETLIFY[Netlify CDN<br/>front statique]
  end

  subgraph GCLB["Google Cloud Load Balancer"]
    LB[HTTPS LB<br/>api.staging.toftalclip.io]
    CDN_LB[HTTPS LB<br/>media.staging.toftalclip.io]
  end

  subgraph CloudRun["Cloud Run"]
    API[toftal-clip-api-staging<br/>Express + Prisma<br/>min 2 / max 20 instances]
    JOB_FAST[Job: faststart-worker<br/>16 Gi / 8 vCPU / gen2]
    JOB_PREVIEW[Job: preview-worker<br/>16 Gi / 8 vCPU / gen2]
    JOB_HLS[Job: hls-worker<br/>16 Gi / 8 vCPU / gen2]
  end

  subgraph CloudSQL["Cloud SQL"]
    DB[(PostgreSQL<br/>Prisma schema)]
  end

  subgraph Redis["Upstash Redis"]
    REDIS[(Sessions, locks,<br/>rate-limits)]
  end

  subgraph GCS["Google Cloud Storage"]
    BUCKET[(toftal-clip-media<br/>videos/, thumbnails/, hls/)]
  end

  subgraph Bictorys["Bictorys"]
    PAY[Checkout API<br/>Webhooks]
  end

  FE -->|HTTPS REST + WS| LB
  FE -->|fetch médias| CDN_LB
  CDN_LB -->|backend bucket| BUCKET

  LB --> API
  API <--> DB
  API <--> REDIS
  API <-->|signed URL + TUS| BUCKET
  API -->|trigger| JOB_FAST
  API -->|trigger| JOB_PREVIEW
  API -->|trigger| JOB_HLS
  JOB_FAST <--> BUCKET
  JOB_PREVIEW <--> BUCKET
  JOB_HLS <--> BUCKET
  JOB_FAST -->|notify done| API
  JOB_PREVIEW -->|notify done| API
  JOB_HLS -->|notify done| API

  FE -->|checkout| PAY
  PAY -->|webhook| LB

  NETLIFY -.serve front.-> FE
```

## Composants

| Composant | Rôle | Tech | Hébergement |
|---|---|---|---|
| Front-end | UI | React, Vite, TypeScript, Tailwind | Netlify (`staging.toftalclip.io`) |
| API | Endpoints REST + WebSocket | Express, Prisma, Socket.io | Cloud Run (`toftal-clip-api-staging`) |
| Base de données | Persistance | PostgreSQL 14 | Cloud SQL |
| Cache / sessions | Sessions, locks, rate-limits | Redis | Upstash |
| Stockage médias | Vidéos, thumbnails, HLS | GCS bucket `toftal-clip-media` | GCS + Cloud CDN |
| Worker faststart | Réécrit les MP4 avec moov atom au début | ffmpeg | Cloud Run Jobs |
| Worker preview | Génère un MP4 480p ultrafast | ffmpeg | Cloud Run Jobs |
| Worker HLS | Génère le master.m3u8 + segments multi-qualité | ffmpeg | Cloud Run Jobs |
| Paiements | Checkout + webhooks | Bictorys | Provider externe |

## Domaines

| Environnement | Front | API | Médias |
|---|---|---|---|
| Staging | `staging.toftalclip.io` | `api.staging.toftalclip.io` | `media.staging.toftalclip.io` (Cloud CDN) |
| Production | `toftalclip.io` | `api.toftalclip.io` | `media.toftalclip.io` |

## Choix d'archi notables

- **TUS via `@tus/gcs-store`** : les chunks d'upload sont écrits **directement
  sur GCS** au fur et à mesure. Cloud Run reste stateless, n'importe quelle
  instance peut servir n'importe quel chunk de n'importe quel upload — pas de
  sticky session nécessaire. Voir [Flows › Upload vidéo](../flows/video-upload.md).

- **Workers en Cloud Run Jobs gen2** : pour les vidéos de plusieurs Go (4K 1h+),
  `/tmp` étant RAM-backed, on a besoin de 16 Gi de RAM minimum. La gen2 donne
  aussi du SSD scratch pour les fichiers intermédiaires.

- **Cloud CDN sur backend bucket** : les vidéos sont servies via un Load Balancer
  HTTPS avec un backend bucket pointant sur GCS. Cache CDN edge → latence
  acceptable depuis l'Afrique de l'Ouest.

- **min-instances = 2** sur l'API : évite le cold-start sur le checkout-return
  (Bictorys redirige le user et on a 1-2 secondes pour répondre).
