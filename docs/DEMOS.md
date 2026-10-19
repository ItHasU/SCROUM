# Jeux de démo — liens et solutions

Ces mini-jeux servent à tester le moteur sans se gâcher un vrai jeu. Ils sont publiés à chaque push sur `main` :
- **Jouer dans le navigateur**
  - Le Phare de Kerbrume : https://ithasu.github.io/SCROUM/?game=games/demo.scroum.zip
  - Démo soft-lock : https://ithasu.github.io/SCROUM/?game=games/demo-softlock.scroum.zip
- **Télécharger les zips** : release `demos` du dépôt, à ouvrir avec « Charger un fichier ».

La solution ci-dessous suit le scénario automatique `packages/engine/test/scenarios/demo.ts` (« Verbe › Cible »).

---

## Le Phare de Kerbrume (`examples/demo`)

Margot doit rallumer le phare de son grand-père. Un monde réel (`plain`) et un monde onirique, le Songe (skin `rpg_bubbles`).

### Partie gagnante (fin « Le phare veille »)

**Au port**
1. Caisse de pêche › Fouiller : vous obtenez la **mèche**. Fouiller une seconde fois ne donne rien.
2. Rochers › Ramasser un coquillage, deux fois : vous avez **2 coquillages**. La première fois, Margot glisse : le compteur *maladresses* passe à 1 et son titre change.
3. Loïc › Parler, puis Suite.
   - « Comment rallumer le phare ? » : débloque le choix du briquet.
   - « Offrir deux coquillages » : l'humeur de Loïc monte, puis Suite.
   - « Vous me prêtez votre briquet ? », puis « S'il vous plaît… » : vous obtenez le **briquet** et le *courage* monte à 2.

**Au bas du phare** (sortie « Vers le phare »)

4. « Monter à la lanterne » : refusé, la porte est fermée à clé.
5. Coffre de marine › Ouvrir : la **clé rouillée** apparaît (objet caché révélé). Ramassez-la.
6. Clé rouillée › Utiliser sur la Porte de l'escalier : la porte s'ouvre et la clé est consommée.
7. Commode › Fouiller les tiroirs : vous obtenez la **photo ancienne**, et la collection « souvenir photo » se débloque.
8. Lit de camp › Faire une sieste : vous passez dans le Songe et la quête « secret du gardien » se débloque.

**Dans la grotte du Songe**

9. Briquet › Utiliser sur le Bassin : refus « hors monde » (l'objet n'a pas cours dans le Songe).
10. Silhouette d'écume › Parler.
    - Montrer la photo : le gardien est troublé. Suite.
    - Donner le briquet : refus. Suite.
    - Donner la photo : **révélation**. Le gardien était Yves Le Goff. Vous recevez l'**huile**, le *courage* monte à 3, la quête est terminée et la collection « souvenir gardien » se débloque.
11. « Se réveiller » : retour au bas du phare.

**Final**

12. Inventaire : combinez la mèche avec l'huile pour obtenir la **mèche huilée**.
13. « Monter à la lanterne ».
14. Briquet › Utiliser sur la Grande lampe : refus (« sans mèche ? Audacieux »).
15. Mèche huilée › Utiliser sur la Grande lampe : la lampe est prête.
16. Briquet › Utiliser sur la Grande lampe : **fin gagnante « Le phare veille »**, avec un *courage* de 5.

### Game over
À la lanterne : Balcon › Enjamber la rambarde. C'est la fin **« Plouf »**.

### Texte libre (avec Loïc, après le premier Suite)
| Ce que vous tapez | Résultat |
|---|---|
| « Bonjour Loïc ! » | Salut |
| « Quelle belle barbe ! » | Compliment, l'humeur monte |
| « Ça mord ? » | Blague, une maladresse de plus |
| « gloubiboulga » | Incompris (repli) |
| « Comment je rallume le phare ? » | Indice sur le feu |
| « je vous montre le briquet » sans l'avoir | Refus : l'objet manque |
| « Regardez cette photo » avec la photo | Indice sur le rêve |

---

## Démo soft-lock (`examples/demo-softlock`)

Elle montre volontairement une impasse, que l'analyse de jouabilité doit détecter.

1. Clé › Prendre.
2. Clé › Utiliser sur la Porte 1 : la porte s'ouvre et la clé est **consommée**.
3. Sortie « Cave ». La Porte 2 demande aussi la clé, qui n'existe plus : **impasse**. Plus aucune action ne mène à la fin.
