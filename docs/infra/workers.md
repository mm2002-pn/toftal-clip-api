# Infra — Workers vidéo

Trois workers Cloud Run Jobs traitent chaque nouvelle version de vidéo en
parallèle, déclenchés par l'API juste après la création de la `Version`.

## Faststart worker

**But** : réécrit le MP4 source avec le moov atom au début. Sur les fichiers
créés par certains encodeurs (ffmpeg sans `-movflags +faststart`, certaines
caméras), le moov atom est en fin de fichier — le browser doit télécharger
**tout** le fichier avant de pouvoir commencer la lecture. Avec moov en
début, le browser peut streamer en progressive download.

### Commande ffmpeg

```bash
ffmpeg -y -i input.mp4 \
  -c copy -movflags +faststart \
  output_faststart.mp4
```

`-c copy` → pas de réencodage, on déplace juste l'index. Très rapide
(quelques secondes même sur 4K 1h).

### Sortie

`gs://toftal-clip-media/videos/<id>_faststart.mp4` — référencé dans
`Version.alternativeQualities.faststart`.

## Preview worker

**But** : générer un MP4 480p **ultrafast** pour permettre au front d'avoir
quelque chose à lire **immédiatement**, en attendant que le HLS soit prêt.

### Commande ffmpeg

```bash
# Détection audio
HAS_AUDIO=$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=codec_type \
  -of csv=p=0 input.mp4)

if [ -n "$HAS_AUDIO" ]; then
  AUDIO_OPTS="-map a:0 -c:a aac -b:a 96k"
else
  AUDIO_OPTS=""
fi

ffmpeg -y -i input.mp4 \
  -map v:0 \
  -c:v libx264 -preset ultrafast -crf 28 \
  -vf "scale=854:-2:force_divisible_by=2" \
  -b:v 800k -maxrate 1000k -bufsize 1500k \
  $AUDIO_OPTS \
  -movflags +faststart \
  output_preview.mp4
```

!!! warning "force_divisible_by=2"
    libx264 plante si la hauteur ou la largeur n'est pas paire (ex. vertical
    1080x1920 scalé en 854:-2 donnerait 854x1518 → fail). Le filtre
    `force_divisible_by=2` arrondit.

!!! warning "Audio optionnel"
    Une vidéo silencieuse n'a pas de stream `a:0`. Sans le check `ffprobe`,
    `-map a:0 -c:a aac` plante avec "Stream map 'a:0' matches no streams".

### Sortie

`gs://toftal-clip-media/videos/<id>_preview.mp4` →
`Version.alternativeQualities.preview`.

## HLS worker

**But** : générer un master playlist + segments multi-qualité pour le
streaming adaptatif (hls.js sur les browsers non-Safari, natif sur Safari).

### Sortie

```
gs://toftal-clip-media/hls/<versionId>/
├── master.m3u8
├── 360p/
│   ├── playlist.m3u8
│   └── segment_000.ts ...
├── 480p/
├── 720p/
└── 1080p/
```

`Version.hlsUrl = https://media.<env>.toftalclip.io/hls/<versionId>/master.m3u8`

### Qualités générées

Le worker génère uniquement les qualités **inférieures ou égales** à la
résolution source. Pour une source 720p, on a 360p + 480p + 720p, pas de
1080p (upscale = qualité inférieure pour bande passante supérieure).

## Sizing — pourquoi 16 Gi / 8 vCPU ?

Cloud Run gen2 stocke `/tmp` en **RAM** (pas sur disque). Sur une vidéo 4K
d'1h :

- Source MP4 : ~3-5 GB
- Output HLS (toutes qualités) : ~2-4 GB
- Buffers ffmpeg : ~500 MB

Total : 6-10 GB. Avec 8 GB de RAM on tape l'OOM kill. 16 Gi laisse un confort
de sécurité.

8 vCPU : ffmpeg encode environ 2-3x plus vite à 8 vCPU qu'à 2. Le coût
marginal est faible (Cloud Run Jobs = facturation à la seconde) et ça améliore
fortement l'UX.

## Notification de fin

Chaque worker, à la fin du traitement :

1. `prisma.$disconnect()` (au cas où)
2. POST `/api/v1/internal/<faststart|preview|hls>-ready` avec :
   - Header `X-Internal-Secret: <INTERNAL_API_SECRET>`
   - Body `{ versionId, gcsUrl }`
3. L'API met à jour la `Version` et fan out les notifs WebSocket aux clients
   connectés
