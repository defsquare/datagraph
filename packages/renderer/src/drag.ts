import type { Container, FederatedPointerEvent } from "pixi.js";

/**
 * Mouvement (en pixels ÉCRAN) toléré entre le `pointerdown` et le `pointertap`
 * avant qu'un geste ne cesse d'être un clic.
 *
 * La constante vit ICI parce qu'elle est le point de partage de DEUX gestes qui
 * doivent se répartir la droite réelle sans trou ni recouvrement : `attachTap`
 * (dans `create.ts`) ignore tout geste dont l'écart dépasse ce seuil,
 * `attachDrag` ne démarre qu'au-delà. Deux copies de la valeur laisseraient
 * apparaître, au premier réglage de l'une, soit une bande morte (un geste ni
 * tap ni drag) soit une bande double (une carte qu'on déplace ET qu'on
 * sélectionne du même geste).
 */
export const TAP_THRESHOLD = 4;

export interface DragHooks {
  /**
   * L'échelle courante de la caméra, relue à CHAQUE mouvement et non capturée à
   * l'attache : elle change sous le drag (molette d'une main, bouton de
   * l'autre), et une valeur figée ferait décrocher la carte du curseur.
   */
  scale(): number;
  /** Appelé une fois, au franchissement du seuil — pas au `pointerdown`, où
   * l'on ne sait pas encore si le geste est un clic ou un déplacement. */
  onStart?(): void;
  /** Deltas en unités MONDE, déjà divisés par l'échelle, et INCRÉMENTAUX
   * (depuis le mouvement précédent, ou depuis le point de pression pour le
   * premier). */
  onMove(dxWorld: number, dyWorld: number): void;
  onEnd?(): void;
}

/**
 * Câble un container pour qu'un clic gauche maintenu le déplace, à la
 * Cytoscape : presser, franchir `TAP_THRESHOLD` pixels écran, puis suivre le
 * pointeur jusqu'au relâchement.
 *
 * Ce module ne connaît NI le modèle ni la scène : il ne fait que traduire une
 * suite d'événements fédérés en deltas monde et les remettre à l'appelant.
 * C'est ce qui le rend testable sans canvas — et ce qui laisse `create.ts`
 * décider seul de ce qu'un déplacement met à jour (positions, arêtes,
 * enveloppes), sans que ce fichier ait à en connaître un seul.
 *
 * `globalpointermove` et non `pointermove` : le pointeur sort de la carte dès
 * qu'on va plus vite qu'elle ne le suit, et un `pointermove` local laisserait
 * le geste mourir au premier débordement. Même raison pour `pointerupoutside`,
 * qui est le cas NORMAL de fin d'un drag rapide et pas un cas limite — sans
 * lui, le drag resterait armé après le relâchement (et, côté `create.ts`, le
 * pan de la caméra inhibé pour toujours).
 */
export function attachDrag(target: Container, hooks: DragHooks): void {
  target.eventMode = "static";

  // `pressed` sans `dragging` est l'état d'un geste encore indécis : le bouton
  // est enfoncé, le seuil pas franchi, et ce peut encore devenir un tap.
  let pressed = false;
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  // Le curseur d'avant le drag, restauré à la fin : c'est `"pointer"` sur les
  // cartes, posé par `attachTap`, et l'écraser par une valeur en dur ferait
  // perdre la main au premier déplacement.
  let restoreCursor: Container["cursor"];

  target.on("pointerdown", (event: FederatedPointerEvent) => {
    // Bouton gauche seul, comme le pan de la caméra : le bouton droit est
    // réservé au menu contextuel de l'hôte.
    if (event.button !== 0) return;
    pressed = true;
    dragging = false;
    downX = lastX = event.global.x;
    downY = lastY = event.global.y;
  });

  target.on("globalpointermove", (event: FederatedPointerEvent) => {
    if (!pressed) return;
    const x = event.global.x;
    const y = event.global.y;

    if (!dragging) {
      if (Math.hypot(x - downX, y - downY) <= TAP_THRESHOLD) return;
      dragging = true;
      restoreCursor = target.cursor;
      target.cursor = "grabbing";
      hooks.onStart?.();
      // `lastX/lastY` valent encore le point de PRESSION : le premier delta
      // publié couvre donc tout le chemin parcouru depuis lui, seuil compris.
      // Compter à partir du franchissement laisserait la carte en retard de
      // `TAP_THRESHOLD` px sur le curseur pour le reste du geste.
    }

    // Une échelle nulle ou non finie ne peut pas venir de `Camera` (bornée à
    // [0.02, 3]) mais diviser par elle produirait des `Infinity` qui
    // contamineraient les positions du layout de façon irréversible.
    const scale = hooks.scale();
    const divisor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    hooks.onMove((x - lastX) / divisor, (y - lastY) / divisor);
    lastX = x;
    lastY = y;
  });

  const end = (): void => {
    if (!pressed) return;
    pressed = false;
    // Un geste qui n'a jamais franchi le seuil n'a rien commencé : ne pas
    // appeler `onEnd` évite que l'appelant ne défasse, à chaque simple clic, un
    // état qu'il n'a jamais posé.
    if (!dragging) return;
    dragging = false;
    target.cursor = restoreCursor;
    hooks.onEnd?.();
  };

  target.on("pointerup", end);
  target.on("pointerupoutside", end);
}
