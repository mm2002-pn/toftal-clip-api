# Frontend — Composants principaux

Liste des composants clés de `toftal-clip` (frontend), groupés par feature.

## Player vidéo

| Composant | Fichier | Rôle |
|---|---|---|
| `DeliverableDetailSections` | `components/deliverable/DeliverableDetailSections.tsx` | Layout principal de la page livrable, embed du player |
| Custom video element | inline | `<video>` natif + hls.js, avec custom controls |

Logique de sélection de la source vidéo :

1. Si HLS dispo (`Version.hlsUrl`) → priorité maximale
2. Sinon, preview MP4 si disponible (`Version.alternativeQualities.preview`)
3. Sinon, faststart MP4 (`Version.alternativeQualities.faststart`)
4. Sinon, source originale (`Version.videoUrl`)

Détection HLS : sniffing User-Agent (Safari/iOS uniquement, sinon hls.js).

## Upload

| Composant | Fichier | Rôle |
|---|---|---|
| `UploadContext` | `context/UploadContext.tsx` | State global des uploads en cours, retry, pause/resume |
| `UploadWidget` | `components/UploadWidget.tsx` | UI flottant en bas à droite |
| `mediaService` | `services/mediaService.ts` | Logique TUS / signed URL / backend upload |

Seuils :

- < 30 MB : upload backend (multipart)
- 30-100 MB : signed URL direct GCS
- ≥ 100 MB : TUS (resume + reprise réseau)

## Sharing

| Composant | Fichier | Rôle |
|---|---|---|
| `ShareDrawer` | `components/ShareDrawer.tsx` | Drawer de partage projet ou vidéo |
| `useProjectAccess` | `hooks/useProjectAccess.ts` | Membres + share links projet |
| `useDeliverableAccess` | `hooks/useDeliverableAccess.ts` | Membres + share links vidéo |
| `TeamMembersInProjectSection` | `components/TeamMembersInProjectSection.tsx` | Annuaire interne |

## Auth

| Composant | Fichier | Rôle |
|---|---|---|
| `AuthContext` | `context/AuthContext.tsx` | Login/logout/refresh |
| `LoginPage`, `RegisterPage` | `pages/...` | Forms auth |
| `AcceptInvitation` | `pages/AcceptInvitation.tsx` | Page d'atterrissage email d'invitation |

## Conventions

- **Tailwind only** pour le styling (pas de CSS modules sauf cas legacy).
- **Lucide** pour les icônes.
- **Framer Motion** pour les animations non-trivial (drawer, modal, toast).
- **React Context** pour le state global, **useState/useReducer** sinon.
- Pas de Redux.
