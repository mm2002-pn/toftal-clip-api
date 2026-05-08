# Backend — Uploads classiques (Multer)

Pour les uploads **non-vidéo-volumineuse** (images, audio, documents,
petits fichiers), on utilise **Multer** comme middleware Express. Multer
parse le `multipart/form-data` et écrit le fichier sur disque ou en
mémoire avant de passer la main au controller.

!!! info "Multer vs TUS"
    - **Multer** : tout ce qui est < 5 GB, pas de reprise sur perte réseau.
      Simple, dégaine, parfait pour images / audio / documents.
    - **TUS** : vidéos > 100 MB, resume sur perte réseau, chunks directs
      vers GCS. Voir [Flows › Upload vidéo](../flows/video-upload.md).
    
    Le frontend choisit automatiquement le bon canal selon le type et la
    taille du fichier (cf. `services/mediaService.ts`).

## Configuration (`src/middlewares/upload.ts`)

5 instances Multer prêtes à monter sur une route :

| Middleware | Disk/Memory | Limite taille | Types acceptés |
|---|---|---|---|
| `uploadImage` | disk | 10 MB | JPEG, PNG, GIF, WebP, SVG |
| `uploadVideo` | disk | 5 GB | MP4, MOV, AVI, WebM |
| `uploadDocument` | disk | 100 MB | PDF, DOC, DOCX, TXT |
| `uploadAny` | disk | 5 GB | Tous les types ci-dessus + audio |
| `uploadToMemory` | memory | 5 GB | Aucun filtre — pour transit direct vers GCS/Cloudinary |

### Disk storage

Les fichiers atterrissent dans `uploads/` (au cwd du process), avec un
nom unique `<uuid>.<ext>`. C'est volontairement **éphémère** : le
controller doit immédiatement traiter le fichier (upload sur GCS,
parse, etc.) puis le supprimer.

### Memory storage

`uploadToMemory` met le buffer en RAM (`req.file.buffer`). Utile quand
on veut piper directement vers GCS sans toucher le disque — typique
pour le voice notes audio ou les thumbnails.

## Usage type

```typescript
import { uploadImage } from '../../middlewares/upload';

router.post(
  '/profile/avatar',
  authenticate,
  uploadImage.single('avatar'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    // req.file.path = uploads/<uuid>.jpg
    const gcsUrl = await uploadToGCS(req.file.path, 'avatars/');
    await fs.unlink(req.file.path); // cleanup disk
    return res.json({ url: gcsUrl });
  }
);
```

Pour plusieurs fichiers : `uploadAny.array('files', 10)` — le 2ème arg
est le nombre max de fichiers acceptés.

## Pourquoi pas TUS pour tout ?

TUS apporte la reprise mais coûte plus cher en complexité (state à
gérer, fingerprints, lifecycle d'upload). Pour un avatar de 200 KB ça
n'a aucun intérêt — un POST classique est plus rapide à coder, plus
rapide à exécuter, et l'user retry en un click si ça échoue.

Seuils retenus dans le front :

- **< 30 MB** : POST direct au backend (qui passe par Multer)
- **30-100 MB** : Signed URL direct GCS (bypasse le backend)
- **≥ 100 MB** : TUS

Les 3 chemins finissent au même endroit côté GCS, mais l'overhead
réseau et CPU côté backend est très différent.

## Erreurs

`src/middlewares/errorHandler.ts` capture les erreurs Multer et les
mappe sur des codes HTTP propres :

| Code Multer | Réponse |
|---|---|
| `LIMIT_FILE_SIZE` | 413 — "Fichier trop volumineux" |
| `LIMIT_FILE_COUNT` | 400 — "Trop de fichiers" |
| `LIMIT_UNEXPECTED_FILE` | 400 — "Champ inattendu" |
| `LIMIT_FIELD_VALUE` | 400 — "Champ trop long" |

## Pièges

!!! warning "Cleanup du disque obligatoire"
    Multer écrit dans `uploads/` mais ne nettoie pas tout seul. Si le
    controller oublie le `fs.unlink()`, le disque Cloud Run se remplit
    silencieusement (et `/tmp` est en RAM, donc ça **bouffe la mémoire**
    de l'instance).

!!! warning "MIME type non fiable"
    Multer fait confiance au header `Content-Type` envoyé par le
    client — facilement falsifiable. Pour les uploads sensibles
    (documents), valider le **magic number** côté serveur après réception
    (lib `file-type`) ou au minimum re-checker l'extension après le
    `path.extname()`.

!!! warning "uploads/ jamais commit"
    `uploads/` est dans `.gitignore` et `.dockerignore`. Si tu vois des
    fichiers personnels y traîner, c'est une fuite locale — efface
    avant un share du repo.
