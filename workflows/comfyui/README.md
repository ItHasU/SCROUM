# Workflows ouvrables dans ComfyUI

Versions des workflows génériques (`../*.json`) **prêtes à glisser-déposer dans ComfyUI**, pour les tester ou les retoucher
à la main. Les placeholders y sont remplacés par des valeurs d'exemple (prompt, graine 42, 1280×720, modèles Qwen Image fp8).
Pour les références (`char_edit`, `transform`, `remove_bg`), choisir une image dans le noeud « Load Image ».

Régénérer avec ses propres modèles (lus dans `scroum.local.yaml` du dépôt de jeu) :

    pnpm scroum workflow-export bg --out bg.json [chemin du jeu]

Après retouche dans ComfyUI : « Save (API) », puis remettre les placeholders (`{{prompt}}`, `{{seed}}`…) et déposer le
fichier dans `workflows/` du jeu (voir `docs/IMAGES.md`). Ces fichiers ne sont pas utilisés par SCROUM, seulement par vous.
