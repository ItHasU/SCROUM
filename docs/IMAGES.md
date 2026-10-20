# Génération d'images (ComfyUI)

SCROUM pilote un ComfyUI **que vous hébergez** (poste local ou machine GPU du réseau). Rien n'est généré sans action
explicite, et **aucun asset n'est jamais validé automatiquement** : Claude Code et la CLI déposent des *candidats* ;
c'est l'humain qui retient et valide dans l'Atelier d'images.

## 1. Installer ComfyUI

1. Installer ComfyUI (version récente : noeuds natifs Qwen Image / Qwen Image Edit) et le lancer **accessible depuis la machine de
   l'éditeur** : `python main.py --listen 0.0.0.0 --port 8188` (pare-feu : n'ouvrir qu'au réseau local).
2. Modèles (dossiers `ComfyUI/models/...`) pour les workflows génériques (texte → image et édition), à adapter à ce que vous avez :

| Rôle | Placeholder | Dossier | Exemple |
|---|---|---|---|
| Modèle de diffusion | `{{unet}}` | `diffusion_models/` (ou `unet/` pour un GGUF avec ComfyUI-GGUF) | `qwen_image_fp8_e4m3fn.safetensors`, `qwen_image_edit_fp8_e4m3fn.safetensors` |
| Encodeur de texte | `{{clip}}` | `text_encoders/` | `qwen_2.5_vl_7b_fp8_scaled.safetensors` |
| VAE | `{{vae}}` | `vae/` | `qwen_image_vae.safetensors` |
| Checkpoint tout-en-un (workflows SDXL/Flux perso) | `{{checkpoint}}` | `checkpoints/` | selon votre workflow |

   Les workflows d'édition (`char_edit`, `transform`) demandent un modèle **Qwen Image Edit** dans `{{unet}}` ; les workflows
   texte → image, un modèle Qwen Image (ou Z-Image : mêmes noeuds, ajuster `steps`/`cfg`/`shift`). Comme `{{unet}}` est un seul
   paramètre, utiliser un `comfyui.models` différent par jeu, ou copier le workflow dans `workflows/` du jeu avec un autre nom
   de paramètre (ex. `{{unet_edit}}`).
3. `remove_bg` exige le noeud personnalisé **ComfyUI-RMBG** (classe `BiRefNetRMBG`, https://github.com/1038lab/ComfyUI-RMBG) ;
   le modèle BiRefNet est téléchargé par le noeud au premier usage. Sans lui, ComfyUI répond « noeud inconnu » et SCROUM l'affiche.

## 2. Configurer SCROUM

`scroum.local.yaml` (gitignoré, propre à la machine) :

```yaml
comfyui:
  url: http://192.168.1.20:8188     # défaut http://127.0.0.1:8188
  models:                           # prime sur scroum.project.yaml
    unet: qwen_image_fp8_e4m3fn.safetensors
    clip: qwen_2.5_vl_7b_fp8_scaled.safetensors
    vae: qwen_image_vae.safetensors
  timeout_s: 900                    # par candidat (défaut 600)
```

`scroum.project.yaml` (versionné) peut porter les mêmes `comfyui.models` comme valeurs par défaut du jeu. L'éditeur affiche
« ComfyUI : … (connecté) » en haut de l'Atelier (`GET /api/comfyui`). Une valeur de modèle inconnue de ComfyUI est signalée avec la
liste des valeurs disponibles (`unknown_model`).

## 3. Utilisation

- **Atelier d'images** (onglet « Images ») : choisir un asset de `assets.yaml`, régler prompt, workflow, références (ids d'assets
  ayant une image retenue), graine, nombre de candidats ; **Générer** ; **Retenir** (copie dans `assets/images/`, `assets.yaml` mis à jour,
  statut `review`) ; **Variante** (édite le candidat avec le prompt courant comme instruction) ; **Comparaison** de deux assets
  (préselection du lien `persona.avatar` ↔ `identity.portrait` d'un même personnage) ; **Valider** (humain).
- **CLI** : `pnpm scroum gen-image --asset img_port_bg --n 4 [--prompt "…"] [--workflow bg] [--seed 42] [--variant-of 2] [--no-server]`.
  Utilise l'éditeur s'il tourne pour ce dépôt (port `editor.port`, ou `--url`), sinon appelle ComfyUI directement. Écrit dans
  `content/assets/_candidates/<id>/` et ne change aucun statut.
- Choix du workflow par défaut : `workflow` de l'asset, sinon selon `kind` (`background`/`ending` → `bg`, `character`/`portrait`/`avatar`/`sprite` →
  `char_sheet`, `item` → `item_icon`) ; avec des références → `char_edit`.
- Lecture de `bible/style.md` : préfixe/suffixe/négatif par monde (voir `docs/FORMAT.md` §4). Post-traitement au build : `images.postprocess`
  (projet) ou front-matter de `style.md`.

## 4. Workflows

Pour ouvrir un workflow directement dans ComfyUI (glisser-déposer) : fichiers prêts dans `workflows/comfyui/`, ou
`pnpm scroum workflow-export <nom> --out <fichier>.json` (modèles de `scroum.local.yaml`, valeurs d'exemple sinon).

Format **API** de ComfyUI (« Save (API Format) », nécessite *Dev mode options* activées), avec des `{{placeholders}}` à la place des valeurs.
Recherche : `workflows/<nom>.json` du jeu (clé `workflows` de `scroum.project.yaml`), puis `workflows/` de SCROUM. Génériques : `bg`, `char_sheet`,
`item_icon` (texte → image), `char_edit`, `transform` (Qwen Image Edit, 1 référence), `remove_bg` (BiRefNet).

| Placeholder | Type | Source |
|---|---|---|
| `{{prompt}}`, `{{negative}}` | texte | prompt (avec style) / instruction pour l'édition |
| `{{seed}}` | entier | graine du candidat (`seed + i`) |
| `{{width}}`, `{{height}}` | entiers | asset, sinon défauts par type (décor 1280×720, objet 512×512…) |
| `{{ref_image_1}}`, `{{ref_image_2}}`… | nom de fichier | références envoyées par `POST /upload/image` |
| `{{unet}}`, `{{clip}}`, `{{vae}}`, `{{checkpoint}}`, … | texte | `comfyui.models` |
| tout autre (`{{steps}}`, `{{cfg}}`, `{{sampler}}`, `{{shift}}`…) | selon la valeur | `_scroum.defaults` du workflow |

Règles : une chaîne qui est **exactement** `"{{seed}}"` prend le *type* de la valeur (nombre, booléen) ; un placeholder au milieu d'un texte
(`"{{prompt}}, plain background"`) est converti en texte. La substitution se fait sur le JSON parsé : guillemets et accolades d'un prompt ne cassent rien.
Un placeholder sans valeur est une erreur explicite. Une clé de premier niveau `"_scroum"` (retirée avant envoi) porte des métadonnées :
`description`, `requires`, `defaults`, `references`, `custom_nodes`.

### Brancher un workflow exporté de ComfyUI

1. Construire et tester le workflow dans ComfyUI, puis **Save (API Format)** → `workflows/mon_workflow.json` du jeu.
2. Remplacer les valeurs variables par des placeholders : le texte positif par `"{{prompt}}"`, le négatif par `"{{negative}}"`, `seed` par `"{{seed}}"`,
   les tailles du `EmptyLatentImage` par `"{{width}}"`/`"{{height}}"`, le nom de fichier d'un `LoadImage` par `"{{ref_image_1}}"`, les noms de
   modèles par `"{{unet}}"`… (garder les guillemets : le type est restauré à la substitution). S'assurer qu'un noeud `SaveImage` existe.
3. Optionnel : ajouter `"_scroum": { "defaults": { "steps": 20 } }` pour les placeholders supplémentaires.
4. Mettre `workflow: mon_workflow` sur l'asset (ou le choisir dans l'Atelier).

## 5. Erreurs fréquentes

| Message | Cause |
|---|---|
| `ComfyUI injoignable à …` | mauvaise `comfyui.url`, ComfyUI arrêté ou lancé sans `--listen` |
| `valeur manquante pour {{unet}}` | `comfyui.models` non renseigné |
| `valeur inconnue de ComfyUI pour « unet_name »` | fichier modèle absent ; la réponse liste les valeurs disponibles |
| `noeud ComfyUI inconnu` | noeud personnalisé non installé (ex. BiRefNet pour `remove_bg`) |
| `délai dépassé` | augmenter `comfyui.timeout_s` ; le premier candidat charge les modèles |

## 6. Limites connues

Les workflows génériques n'ont été validés que contre un faux ComfyUI (tests) : les noms de noeuds et de paramètres (Qwen Image, `TextEncodeQwenImageEdit`,
`CFGNorm`, `BiRefNetRMBG`) suivent la documentation de ComfyUI mais doivent être confirmés sur une instance réelle (export « Save (API) » à comparer).
Une seule génération à la fois par éditeur ; les candidats sont des PNG ; une référence est un asset *retenu* ou un candidat de l'asset courant.
