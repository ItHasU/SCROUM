# Démo « soft-lock » (fixture de test)

Mini-jeu volontairement **bloquant** servant à tester l'analyse de jouabilité
(jalon M1b) : la clé est consommable, elle est requise par deux portes, mais on
ne peut l'obtenir qu'une fois. Après avoir ouvert la première porte, la fin
`sortie` (win) devient inatteignable.

Le contenu est valide au sens du schéma et de la cohérence des références
(`scroum validate examples/demo-softlock` passe au niveau 1) ; seul le niveau
« jouabilité » doit le rejeter, avec le chemin :

1. `couloir` : prendre la clé (`cle.take`) ;
2. `couloir` : utiliser la clé sur la porte 1 (consommée) ;
3. passer dans `cave` → la porte 2 réclame la clé : bloqué.
