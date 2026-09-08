# Passe UX globale — feedback, cohérence, finition

Date : 2026-09-08
Statut : audit validé en discussion, spec en attente de relecture
Origine : audit manuel complet du viewer (Playwright, viewport 1440×900,
DPR 1) — sélection, références, pli/dépli, recherche, thèmes, vues,
zoom sémantique, jeu 4000 nœuds, clavier.

## Contexte

Le socle interactif est sain et **vérifié** : sélection (anneau + estompage +
panneau), suivi de référence animé, survol (curseur + scale + soulignement des
lignes-référence), drag de carte, pan/zoom (molette = pan, Ctrl/Cmd+molette =
zoom, contrat `classifyWheel`), zoom sémantique, bascule de vue avec
`aria-busy`, perfs à 4000 nœuds (~2,7 s chargement + layout, recherche < 5 ms),
chrome DOM accessible (aria-label, focus visible, ordre de Tab). **Ne pas
« réparer » ces comportements.**

Les défauts relevés sont concentrés sur le *feedback* : des actions qui
réussissent ou échouent sans le dire. Trois lots, par priorité décroissante ;
chaque lot est committable séparément.

## Décisions actées

- Les surlignages de recherche qui survivent au repli de la findbar sont un
  **choix assumé** (le repli n'annule rien, cf. commentaire `chrome.ts`
  gestionnaire Escape). On ne le supprime pas : on le **signale** (badge sur la
  loupe) et on garde le vidage du champ comme geste d'effacement.
- Le renderer n'expose ni événement de désélection ni événement de changement
  de stats : on **étend l'API publique** (`deselect`, `statschange`). C'est une
  décision d'architecture → ADR à créer (voir « ADR » plus bas).
- Panneau de diagnostics : pas de nouveau panneau flottant — on réutilise la
  surface du panneau de détail (même emplacement, même primitive `float`).
- Navigation clavier du graphe (lot C) : minimale — flèches entre voisins
  visibles, Entrée = sélection, Échap = désélection. Pas de virtualisation
  ARIA du canvas en v1.

## Lot A — flux cassés ou trompeurs (P1)

### A1. Le lien « 1 diagnostic » doit montrer les diagnostics dans l'UI

Constat : `chrome.ts` (`statDiagEl.addEventListener("click", …)`) ne fait que
`console.warn`. Pour l'utilisateur du binaire Tauri (pas de devtools), le
bouton rouge est mort.

Fix (démo seule, aucun changement de lib) :
- Le clic ouvre le panneau (surface du panneau de détail) en mode
  « Diagnostics » : liste `code` / `path` / `message` depuis
  `graph.diagnostics()`.
- Chaque entrée dont le `path` correspond à un nœud existant est cliquable →
  `graph.select(id)` + `graph.focus(id)` (même geste que les boutons-référence
  du panneau). Une entrée sans nœud cible reste inerte mais lisible.
- Un `select` ultérieur re-rend le panneau en mode détail (comportement
  actuel) — pas d'état modal à gérer, le dernier rendu gagne.

Critères : cliquer « 1 diagnostic » affiche la liste ; cliquer une entrée
centre la caméra sur le nœud fautif ; test e2e (le jeu réduit a exactement un
diagnostic : la ref GHOST de `#o2`).

### A2. Événement `deselect` + fermeture du panneau de détail

Constat : clic sur le fond → `doDeselect()` (`create.ts`) nettoie la scène
mais n'émet rien ; le panneau reste ouvert sur le nœud précédent (vérifié),
y compris à travers une bascule de vue.

Fix :
- Renderer : émettre `"deselect"` (sans payload) depuis `doDeselect()` — même
  émetteur que `select`/`followRef`, à déclarer dans les types publics
  (`index.ts`, type des événements de `on`).
- Démo (`main.ts`) : `graph.on("deselect", …)` → `detail.clear()` +
  `chrome.updateStatus()`.
- `doDeselect` est appelé aussi par `setData`/résets internes : n'émettre que
  si une sélection existait (pas d'événement fantôme au boot).

Critères : sélection → clic sur le fond → panneau disparu ; test unitaire
renderer (émission une seule fois, pas d'émission sans sélection préalable)
+ e2e démo.

### A3. Événement `statschange` + compteurs à jour

Constat : « N visibles » n'est rafraîchi que sur `select`, bascule de vue et
bascule de dataset (`main.ts`). Après pli/dépli/révélation, le compteur ment
(vérifié : pli de `categories` → toujours « 9 visibles »).

Fix :
- Renderer : émettre `"statschange"` (sans payload — le shell relit
  `graph.stats()`) à la fin de chaque opération qui change l'ensemble visible :
  `doExpand`, `doCollapse`, `doReveal`, `tidy`, `setView`, `setData`,
  `toggleAggregate`. Point d'accroche unique de préférence (là où
  `layoutResult` est publié + `rebuild()`), pour ne pas éparpiller sept
  émissions — attention aux abandons par `opGen` : un op annulé n'émet pas.
- Démo : `graph.on("statschange", () => chrome.updateStatus())` ; retirer les
  appels manuels devenus redondants (garder celui du rappel `setupDatasetToggle`
  si `setData` couvre déjà — vérifier l'ordre).

Critères : déplier/replier/révéler met le compteur à jour sans sélection ;
test e2e (compteur avant/après pli).

### A4. Référence cassée : un retour visible au clic

Constat : cliquer la ligne `GHOST ✕` déclenche `followRef` sur une arête
`dangling` → la démo se contente d'un `console.warn` (`main.ts`). Aucun
retour à l'écran.

Fix (démo, sur l'événement `followRef` existant — `edge.dangling` est déjà
dans le payload) :
- Faire clignoter/flasher le lien de la barre d'état en le remplaçant
  temporairement par « référence cassée : Type#id » (2 s, puis retour au
  compteur de diagnostics), OU ouvrir directement le panneau Diagnostics de
  A1 avec l'entrée correspondante mise en évidence. Choisir la seconde option
  si A1 est déjà en place (moins d'états transitoires).
- Garder le `console.warn` (utile en dev).

Critères : clic sur GHOST → un changement visible à l'écran ; e2e.

### A5. Thème sombre : la carte racine reste claire

Constat : en thème sombre, toutes les cartes basculent sauf la carte agrégat
racine « Boutique » (vérifié par capture). Cause à localiser : couleurs de la
carte agrégat/racine non dérivées du thème actif (chercher dans `theme.ts` /
`draw.ts` le style des cartes de pli/agrégat de la vue structure — probable
couleur codée en dur ou dérivée du seul thème clair).

Fix : dériver ces couleurs du `Theme` courant comme les cartes d'entité ;
vérifier aussi les jetons « 2 items ▾ » (fond des pilules) dans les deux
thèmes.

Critères : capture sombre sans surface claire résiduelle ; si un test
visuel n'existe pas, test unitaire sur la fonction de style (les couleurs de
la carte agrégat appartiennent à la palette du thème passé).

## Lot B — frictions (P2)

### B1. Findbar : sauter au premier résultat, dire « aucun résultat »

Constat : après saisie, compteur « 0/3 » et aucun résultat ciblé tant qu'on
n'a pas tapé Entrée ; requête sans correspondance → compteur vide (aucun
feedback). Code : `search-ui.ts` (`matchCursor = -1` après `runSearch`,
`updateMatchCounter` rend `""` quand `matchTotal === 0`).

Fix :
- Après un `runSearch` avec résultats, appeler `goToNextMatch()`
  (via le debounce existant) → l'état de repos devient « 1/N » et la caméra
  montre le premier résultat, comme les findbars standard.
- `matchTotal === 0` **avec une requête non vide** → compteur « 0 résultat »
  (le champ vide garde le compteur vide). La distinction requête vide/pleine
  se lit sur `searchInput.value`.

Critères : taper « camille » → 1/3 et caméra déplacée ; taper « zzz » →
« 0 résultat » ; champ vidé → compteur vide ; tests e2e sur les trois états.

### B2. Surlignage de recherche : emphase sans délavage, distinct de la sélection

Constat : le voile beige plein posé sur les cartes trouvées **réduit** le
contraste de leur texte (l'emphase rend le résultat moins lisible), et le
match courant porte un liseré rouge quasi identique à l'anneau rouge de
sélection — deux concepts, un seul langage visuel.

Fix (renderer, styles de recherche dans `draw.ts`/`theme.ts`) :
- Remplacer le voile plein par un traitement qui n'altère pas le texte :
  liseré + halo, ou voile limité à l'en-tête, au choix du thème — contrainte
  dure : le contraste du corps de carte ne baisse pas.
- Différencier match courant et sélection : la sélection garde le rouge
  accent ; les matches passent sur une autre teinte du thème (ex. l'ambre déjà
  utilisé pour le ✕ GHOST est exclu — choisir une teinte non porteuse d'un
  autre sens, à ajouter aux tokens si besoin ; toute nouvelle couleur passe
  par `packages/tokens` + régénération CSS, sinon `pnpm test` casse).
- Les deux thèmes (clair/sombre) sont concernés.

Critères : capture avant/après dans les deux thèmes ; texte des cartes
trouvées au même contraste qu'au repos ; sélection et match courant
distinguables côte à côte.

### B3. Badge « recherche active » sur la loupe

Constat : findbar repliée avec une requête active → surlignages à l'écran
sans aucun indicateur ni geste d'effacement visible (choix assumé, cf.
Décisions).

Fix : quand `searchInput.value` est non vide et la findbar repliée, la loupe
porte un point/badge (primitive badge du paquet chrome ou pseudo-élément CSS
sur `.ibtn`). Rouvrir la loupe montre la requête (comportement existant) ;
vider le champ efface tout (existant).

Critères : repli avec requête → badge visible ; champ vidé → badge absent.

### B4. Cmd/Ctrl+F ouvre la recherche

Fix : dans le keydown global de `chrome.ts`, capter Cmd+F (mac) / Ctrl+F,
`preventDefault()`, ouvrir la findbar (réutiliser `openSearch()` — le focus
suit déjà via `onSearchOpen`). Ne pas capter si un champ de saisie a le focus
et que la findbar est déjà ouverte.

Critères : e2e — Cmd+F ouvre et focus le champ ; le natif du navigateur ne
s'ouvre pas.

### B5. La caméra suit le contenu révélé/déplié hors écran

Constat : cliquer « 3 items ▸ » insère les cartes sous le bord de la fenêtre
sans déplacement de caméra ni indication (vérifié).

Fix (renderer, `doReveal` et `doExpand`) : après publication du layout, si la
boîte englobante des nouvelles cartes est entièrement hors du viewport
courant, déplacer la caméra du minimum nécessaire pour en rendre une part
visible (pan animé, pas de zoom). Ne rien faire si au moins une nouvelle
carte est déjà partiellement visible — ne pas voler la caméra à l'utilisateur.

Critères : e2e — révélation dont les enfants tombent sous la fenêtre → la
caméra bouge ; révélation visible → la caméra ne bouge pas.

### B6. « Ranger » a un état occupé

Constat : `tidy()` (re-layout complet, asynchrone) est muet ; la bascule de
vue, elle, gère `disabled` + `aria-busy` — copier ce motif.

Fix (`chrome.ts`, gestionnaire de `tidyBtn`) : `disabled` + `aria-busy`
pendant l'attente de la promesse de `graph.tidy()`, dans un `try/finally`
comme `toggle-view`. Le style `aria-busy` existe déjà côté CSS des boutons
(vérifier, sinon reprendre celui du bouton de vue).

Critères : sur le jeu 4000, le bouton montre l'état occupé pendant le calcul.

## Lot C — finition / accessibilité (P3)

- **C1. Clavier graphe (minimal)** : Échap = désélection — attention à la
  priorité : le keydown global de `chrome.ts` ferme d'abord menu puis findbar ;
  la désélection ne prend Échap que si ni l'un ni l'autre n'est ouvert (même
  cascade « un niveau à la fois ») ; flèches = déplacer la
  sélection vers le voisin visible le plus proche dans la direction ; Entrée
  sur une carte sélectionnée = plier/déplier (structure). S'appuyer sur les
  positions du layout publié. Hors scope : lecture d'écran du canvas.
- **C2. Bornes de zoom arrière** : clamp du zoom-out au cadrage `fit` du
  contenu (on ne peut pas réduire le graphe à un point perdu) ; le zoom avant
  garde sa borne actuelle.
- **C3. Contrastes barre d'état** : passer les textes de la barre d'état et le
  lien diagnostic au niveau AA sur fond canvas dans les deux thèmes (ajuster
  les tokens, régénérer le CSS).
- **C4. Résolution vivante** : `resolution` est figé à l'init
  (`create.ts`, `Math.min(devicePixelRatio ?? 1, 2)`) — écouter les
  changements de DPR (matchMedia `resolution`) et re-résoudre, pour que
  zoom navigateur/changement d'écran ne laissent pas un rendu flou.
- **C5. Étiquettes des disques d'agrégats** : taille de police plancher au
  dézoom (lisibilité des `c67` minuscules).
- Tooltips custom (remplacer les `title` natifs) : **hors scope** — coût
  disproportionné tant que le chrome reste minimal.

## ADR

Les événements publics `deselect` et `statschange` (A2/A3) étendent le
contrat du renderer : créer `docs/adr/0030-renderer-lifecycle-events.md`
(format Nygard) au moment du commit du lot A, et mettre à jour
`docs/adr/README.md`. Les lots B et C ne touchent a priori pas de décision
d'architecture (le vérifier au diff : B2 ajoute peut-être un token de
couleur — pas un ADR).

## Méthode et garde-fous pour l'implémentation

- Un lot = une branche/série de commits ; TDD (superpowers) ; passe ADR avant
  chaque commit (hook `adr-gate.sh` — trailer `ADR-Reviewed:` obligatoire).
- Commentaires de code nouveaux **en anglais** (CLAUDE.md), même si le legacy
  est en français.
- Renderer : toute opération asynchrone mutante reste gardée par
  `opGen`/`destroyed` (voir `doExpand` dans `create.ts`) ; un op annulé
  n'émet pas `statschange`.
- `draw.ts` ne reçoit que des données nues — les styles de B2/A5 passent par
  ses paramètres, pas par un accès à l'état.
- Couleurs : source de vérité `packages/tokens` ; après modification,
  `pnpm --filter @defsquare/data-graph-tokens generate:css`, sinon
  `test/css.test.ts` casse.
- E2e : réutiliser les motifs existants (`apps/demo/e2e/*.spec.ts`) —
  `window.__graph` + `focus(id)` puis clic au **centre du canvas**, zoom via
  Ctrl+molette (`zoom()` de `culling.spec.ts`). Le compteur/chrome se teste
  par le DOM (`#match-counter`, `#statusbar`, `aria-busy`).
- `pnpm test` inclut `cargo test` (toolchain Rust requise) ; `pnpm typecheck`
  avant commit.

## Hors scope de cette passe

- Liste de résultats de recherche (au-delà du compteur N/total).
- Tooltips custom.
- Accessibilité lecteur d'écran du canvas.
- Toute refonte visuelle au-delà des points listés.
