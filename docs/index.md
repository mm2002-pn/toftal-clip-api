---
title: Toftal Clip — Documentation interne
---

# Toftal Clip

Documentation technique interne pour l'équipe : architecture, infrastructure,
flows métier, configuration Google Cloud et runbooks d'exploitation.

!!! info "Public visé"
    Cette doc est faite **pour les contributeurs** (dev front, dev back, ops).
    Pour la doc utilisateur final, voir le site marketing.

## Vue d'ensemble

Toftal Clip est une plateforme de collaboration vidéo : les studios et freelances
y livrent des vidéos à leurs clients, qui peuvent commenter, annoter et valider
chaque version. La stack en deux mots :

- **Front-end** : React + Vite + TypeScript, hébergé sur Netlify
- **Back-end** : Express + Prisma sur Cloud Run, base PostgreSQL Cloud SQL,
  cache Redis, médias sur Google Cloud Storage + Cloud CDN
- **Workers vidéo** : Cloud Run Jobs (faststart, preview MP4, HLS)
- **Paiements** : Bictorys (mobile money + cartes — marché ouest-africain)

## Par où commencer ?

| Tu veux… | Va voir |
|---|---|
| Comprendre l'archi globale | [Architecture › Vue d'ensemble](architecture/overview.md) |
| Comprendre comment une vidéo est uploadée | [Flows › Upload vidéo](flows/video-upload.md) |
| Déployer en staging ou prod | [Runbooks › Déploiement](runbooks/deploy-staging.md) |
| Configurer un nouveau projet GCP | [Infra › Google Cloud](infra/google-cloud.md) |
| Comprendre les workers vidéo | [Infra › Workers](infra/workers.md) |

## Conventions de cette doc

- Les diagrammes sont en **Mermaid** — éditables directement dans le markdown.
- Les blocs `!!! warning` signalent des pièges qui ont déjà coûté du temps à l'équipe.
- Les pages `runbooks/` sont des procédures **étape par étape** à suivre en cas
  d'incident ou de déploiement — n'improvise pas, suis le runbook puis mets-le
  à jour si tu trouves un trou.
