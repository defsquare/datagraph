# Sonde — raffinements du moteur de layout à deux niveaux

**Statut** : en cours. Trois étapes décidées par l'utilisateur, remplies au fil
de l'eau. A faite, B et C à venir.

| | étape | statut |
|---|---|---|
| A | placement intra-agrégat RADIAL (racine au centre, anneaux par distance) | **faite** |
| B | bruit déterministe contre la régularité du pavage | à venir |
| C | calibrage mesuré des constantes du niveau 2 | à venir |

Le moteur porté par ces trois étapes est `packages/core/src/layout-two-level.ts`.
Sa sonde d'origine, et la comparaison qui a retiré le pipeline fcose, sont dans
`2026-09-01-two-level-layout.md`.

---

## Étape A — placement radial intra-agrégat

**Question** : le packing en étagères posait les membres d'un agrégat par ordre
d'ID, sans regarder les références. Sur un agrégat profond, les chaînes de
références zigzaguent et la racine n'est nulle part en particulier. Un placement
radial — racine au centre, un anneau par distance de référence — fait-il mieux,
et à quel prix ?

**Réponse courte** : oui sur ce qu'il vise, franchement, et le prix est réel et
mesuré. Les références intra-agrégat raccourcissent de 39 % en moyenne et de
50 % au pire, et la racine passe du 40e au 1er rang par proximité au centre de
son propre disque. En échange le disque enfle : le remplissage global tombe de
12,3 % à 7,8 % sur le jeu du cœur et de 15,1 % à 10,9 % sur celui de la démo.
**Sur ces deux jeux-là, le radial ne gagne rien et ne fait que coûter** — leurs
agrégats font 1 à 5 cartes et n'ont aucune chaîne à redresser. Le gain n'existe
qu'à partir d'agrégats profonds, qu'aucun jeu réel du dépôt ne contient encore.

### Le fixture, parce qu'il n'y en avait pas

Aucun fixture du dépôt ne produisait un gros agrégat : `bigShop` en fait de 2
cartes, le jeu de la démo monte à 5. Impossible de mesurer quoi que ce soit sur
la connectivité intra-agrégat avec ça.

`deepAggregate()` (dans `packages/core/test/fixtures.ts`) produit **un seul
agrégat de 41 cartes sur quatre niveaux** :

```
Customer  ←  Order  ←  OrderLine  ←  Serial
dist. 0      dist. 1    dist. 2      dist. 3
   1            4          12           24
```

Les arités sont paramétrables (`deepAggregate(5, 3, 3)` → 66 cartes, dont un
anneau de 45 qui force la scission d'anneau).

Un détail qui n'en est pas un : la largeur des cartes vient d'une table de sept
longueurs (`NOTE_LENGTHS`), **première avec les arités de l'arbre** (4, 3, 2,
PPCM 12). Indexer cette table par un compteur dont la période diviserait une
arité donnerait à toutes les cartes d'un anneau la même largeur ; le placement
radial deviendrait un cas parfaitement régulier, et le calcul de circonférence
— qui existe précisément pour gérer des largeurs hétérogènes — ne serait jamais
exercé par un test qui passerait pourtant.

### La baseline — packing en étagères, sur `deepAggregate()`

| | étagères |
|---|---|
| référence intra-agrégat, moyenne | 591,4 px |
| référence intra-agrégat, max | 976,3 px |
| centralité de la racine (centre carte → centre disque) | 597,7 px |
| rang de la racine par proximité au centre | **40 / 41** |
| rayon du disque | 712,3 px |

Le rang 40 sur 41 n'est pas un hasard malheureux, c'est mécanique : le tri par
id posait la racine en tête de la première ligne, donc dans un COIN du bloc,
c'est-à-dire au point le plus éloigné du centre du cercle englobant. La carte
qui donne son nom et son sens à l'agrégat était la plus excentrée de toutes.

### Le résultat

| | étagères | radial |
|---|---|---|
| réf. intra, moyenne | 591,4 px | **363,0 px** (−39 %) |
| réf. intra, max | 976,3 px | **488,1 px** (−50 %) |
| centralité de la racine | 597,7 px | **16,4 px** (−97 %) |
| rang de la racine | 40 / 41 | **1 / 41** |
| rayon du disque | 712,3 px | 1 044,1 px (+47 %) |

### La géométrie, et ce qui porte la garantie

Le non-recouvrement avec marge `cardGap` reste acquis PAR CONSTRUCTION, en deux
conditions indépendantes, toutes deux écrites sur les **disques englobants** des
cartes (demi-diagonale) — une condition suffisante qui rend le problème
indépendant de l'angle.

1. **Dans un anneau** : une carte de disque ρ à la distance R se voit allouer la
   largeur angulaire `α = 2·asin((ρ + gap/2)/R)`. Deux cartes séparées d'au
   moins `α_i/2 + α_j/2` ont une corde `2R·sin(Δθ/2) ≥ ρ_i + ρ_j + gap`, parce
   que `sin x + sin y = 2·sin((x+y)/2)·cos((x−y)/2)` et que le cosinus vaut au
   plus 1. La condition de bouclage est `Σα ≤ 2π` : c'est elle qui traite la
   paire dernière/première.
2. **Entre anneaux** : `R_k = R_{k−1} + ρmax_{k−1} + ρmax_k + gap`, donc deux
   cartes d'anneaux différents sont distantes d'au moins la somme de leurs
   rayons plus la marge (le pire cas est l'alignement radial).

**Scission d'anneau.** Un anneau ne peut pas « échouer » — on pourrait toujours
grossir R —, mais ce R croît linéairement en N. On remplit donc gloutonnement au
rayon minimal autorisé, et le reste part sur un anneau suivant à la même
distance logique. Les sous-anneaux se comportent en tout point comme des anneaux
pour la condition 2, donc la garantie traverse la scission. Le remplissage se
termine toujours : `α ≤ π` pour toute carte, donc au moins une tient par
sous-anneau.

**Ordre dans l'anneau** : par angle du parent, puis par id. Chaque sous-anneau
est ensuite tourné en bloc pour que sa première carte se pose à l'angle de son
parent — une rotation rigide, donc sans effet sur la garantie.

### Le coût, chiffré

Le prix du radial est structurel, pas un défaut de réglage : **un anneau coûte
un diamètre de carte de rayon même s'il ne porte qu'une seule carte**. Le disque
enfle donc avec la PROFONDEUR plus qu'avec le nombre de cartes.

Rayon du disque d'un agrégat isolé, étagères → radial :

| cartes | forme | étagères | radial | ratio |
|---|---|---|---|---|
| 1 | racine seule | 121 px | 121 px | ×1,00 |
| 2 | 1 anneau | 162 px | 209 px | ×1,29 |
| 3 | 1 anneau | 225 px | 335 px | ×1,49 |
| 4 | 1 anneau | 280 px | 335 px | ×1,20 |
| 5 | 1 anneau | 258 px | 371 px | ×1,44 |
| 5 | **2 anneaux** | 296 px | 602 px | **×2,03** |
| 9 | 2 anneaux | 365 px | 597 px | ×1,64 |
| 10 | **3 anneaux** | 350 px | 899 px | **×2,57** |
| 41 | 3 anneaux | 712 px | 1 044 px | ×1,47 |
| 66 | 3 anneaux | 856 px | 1 352 px | ×1,58 |

Noter que le pire cas n'est PAS le petit agrégat, contrairement à l'intuition :
c'est l'agrégat **profond et maigre** (5 cartes sur 3 niveaux, ×2,03 ; 10 cartes
sur 4 niveaux, ×2,57), où chaque anneau paie son diamètre pour une ou deux
cartes.

Effets globaux, sur les deux jeux réels du dépôt :

| | étagères | radial |
|---|---|---|
| **A** `bigShop(3000)` cœur — 334 cartes, 167 agrégats de 2 | | |
| bbox | 6 026 × 5 929 | 7 588 × 7 396 (aire ×1,58) |
| remplissage | 12,3 % | **7,8 %** |
| rayon moyen des disques | 141,7 px | 187,0 px |
| temps (médiane de 3) | 175 ms | 168 ms |
| **B** démo `bigShop(4000)` — 350 cartes, 116 blocs | | |
| bbox | 8 083 × 8 437 | 9 710 × 9 780 (aire ×1,45) |
| remplissage | 15,1 % | **10,9 %** |
| rayon moyen des disques | 262 px | 331 px |
| réf. inter-agrégat moyenne | 1 364 px | 1 657 px (+21 %) |
| temps (médiane de 3) | 74 ms | 72 ms |

Le temps ne bouge pas : le placement reste linéaire en cartes et c'est la
simulation O(k²) du niveau 2 qui domine.

### L'hybride — chiffré, PAS retenu, décision laissée ouverte

Distribution réelle des tailles d'agrégats, mesurée :

- **A** : 167 agrégats, **tous de 2 cartes**.
- **B (démo)** : 30 de 1 carte, 26 de 3, 26 de 4, 26 de 5. **Maximum : 5.**

Un hybride « étagères en dessous d'un seuil, radial au-dessus » :

| seuil | A remplissage | B remplissage |
|---|---|---|
| étagères partout | 12,3 % | 15,1 % |
| **hybride ≤ 2** | **12,3 %** | 10,9 % |
| **hybride ≤ 3** | **12,3 %** | 12,2 % |
| **hybride ≤ 5** | **12,3 %** | **15,1 %** |
| radial partout (retenu) | 7,8 % | 10,9 % |

`hybride ≤ 5` récupère **100 %** de la densité sur les deux jeux, tout en
donnant le radial aux agrégats profonds. C'est tentant, et c'est précisément
pourquoi il n'est pas retenu ici : **5 est exactement la taille maximale
d'agrégat des deux fixtures**. Un seuil choisi pour qu'aucun jeu existant ne
prenne le chemin neuf est un seuil ajusté sur les fixtures, pas sur une raison —
il ferait passer les chiffres au vert sans qu'on sache ce qu'il vaudra sur un
jeu réel de forme différente.

Ce qu'il faudrait pour trancher honnêtement : un critère dérivé de la GÉOMÉTRIE
et non du cardinal — par exemple « radial si le placement radial ne dégrade pas
le rayon de plus de X % », c'est-à-dire calculer les deux et garder le meilleur.
C'est mesurable, ça ne dépend d'aucun seuil arbitraire, et ça coûte un packing
de plus par agrégat (linéaire, négligeable). **Proposé, non fait** : c'est une
décision de produit — veut-on la lisibilité radiale partout, ou seulement là où
elle est gratuite ?

### Micro-variante essayée et écartée

Poser l'anneau 1 à l'angle π/2 (première carte SOUS la racine) plutôt qu'à 0 (à
sa droite) : les cartes étant plus larges que hautes, empiler devrait être plus
dense. Mesuré : A 7,8 → **8,6 %** de remplissage (rayon moyen 187 → 174), mais
B 10,9 → **10,7 %** et référence inter-agrégat 1 657 → 1 729 px. Gain sur un
jeu, perte sur l'autre : pas de raison de payer une constante inexpliquée pour
ça. Écartée.

### Welzl : l'avertissement de `hull.ts` vérifié

`hull.ts` n'est pas mélangé, et son commentaire annonçait sans l'avoir mesuré
que l'ordre fixe « cesserait d'être le bon compromis sur des agrégats de
plusieurs centaines de cartes ». C'est juste, et le radial rapproche l'échéance :
il pose les cartes SUR DES CERCLES, donc une grande part des coins se retrouve
près du bord du cercle englobant — le cas adverse de Welzl non mélangé.

Temps par appel, étagères → radial :

| cartes | coins | étagères | radial |
|---|---|---|---|
| 41 | 164 | 0,0187 ms | 0,0352 ms |
| 66 | 264 | 0,0261 ms | 0,0686 ms |
| 157 | 628 | 0,0673 ms | 0,2834 ms |
| 297 | 1 188 | 0,2158 ms | 1,6732 ms |

Croissance bien superlinéaire (×7,2 en cartes → ×48 en temps). **`hull.ts` n'est
pas modifié** : à l'échelle visée (60 cartes) c'est 0,07 ms, et même à 297
cartes ces 1,7 ms pèsent 21 % d'un layout de 7,8 ms, très loin derrière la
simulation O(k²) du niveau 2 (169 ms à 167 disques). Seul son commentaire est
mis à jour, pour porter les chiffres au lieu d'une estimation.

### Ce que l'étape A ne tranche pas

1. **L'hybride ci-dessus**, laissé à l'utilisateur avec ses chiffres.
2. **Le critère par disques englobants est conservateur.** Il ajoute un surcoût
   constant à la marge — 28,6 px mesurés entre deux cartes de `bigShop`, soit
   `ρ₁ + ρ₂ − (w₁ + w₂)/2`. Un test exact rectangle-rectangle récupérerait ces
   pixels, mais l'estimation donne ~13 % du rayon d'anneau, pas les ~50 % qui
   séparent radial et étagères : ce n'est pas le bon levier.
3. **Les orphelins.** Un membre dont le maillon intermédiaire est masqué n'est
   pas atteint par le BFS local et part sur un anneau supplémentaire. Correct et
   déterministe, mais jamais observé sur un jeu réel — la vue graphe ne masque
   rien aujourd'hui.
4. **Rien n'oriente les anneaux entre agrégats.** Le niveau 2 tourne les disques
   librement ; un agrégat pourrait présenter ses feuilles vers son voisin plutôt
   que sa racine. Non sondé.
