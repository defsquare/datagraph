import { defsquareLight, defsquareDark, type DataGraph } from "@defsquare/data-graph";

declare global {
  interface Window {
    __theme?: string;
  }
}

/** Le chrome du viewer : surfaces flottantes (recherche dépliable, menu ⋮),
 * barre d'état, thème et bascule de vue. Tout ce qui est ici existe quel que
 * soit le mode de lancement — l'outillage propre à la démo vit dans
 * `demo-mode.ts`. */
export interface Chrome {
  /** Recalcule les compteurs et le lien de diagnostics de la barre d'état. */
  updateStatus(): void;
  applyTheme(): void;
  /** Aligne le bouton de bascule sur la vue RÉELLEMENT active. */
  syncViewButton(): void;
}

export interface ChromeHooks {
  /** Appelé quand la barre de recherche se déplie : le chrome ne connaît pas le
   * champ, c'est `search-ui.ts` qui lui donne le focus. */
  onSearchOpen(): void;
}

export function createChrome(graph: DataGraph, hooks: ChromeHooks): Chrome {
  // --- Chrome flottant : dépliage de la recherche, menu ⋮.
  // Aucune de ces bascules ne touche à l'état du graphe — la recherche garde sa
  // requête et ses résultats quand on la replie, la sélection survit à la
  // fermeture du panneau. Ce n'est que de l'affichage.
  const searchToggleBtn = document.getElementById("search-toggle");
  const findbarEl = document.getElementById("findbar");
  const menuToggleBtn = document.getElementById("menu-toggle");
  const menuEl = document.getElementById("menu");

  function setExpanded(panel: HTMLElement | null, trigger: HTMLElement | null, open: boolean): void {
    if (open) panel?.removeAttribute("hidden");
    else panel?.setAttribute("hidden", "");
    trigger?.setAttribute("aria-expanded", String(open));
  }

  function isOpen(panel: HTMLElement | null): boolean {
    return panel !== null && !panel.hasAttribute("hidden");
  }

  function openSearch(): void {
    setExpanded(findbarEl, searchToggleBtn, true);
    // Déplier sans donner le focus obligerait à un second clic pour taper.
    hooks.onSearchOpen();
  }

  function closeSearch(): void {
    setExpanded(findbarEl, searchToggleBtn, false);
  }

  function closeMenu(): void {
    setExpanded(menuEl, menuToggleBtn, false);
  }

  searchToggleBtn?.addEventListener("click", () => {
    if (isOpen(findbarEl)) closeSearch();
    else openSearch();
  });

  menuToggleBtn?.addEventListener("click", () => {
    setExpanded(menuEl, menuToggleBtn, !isOpen(menuEl));
  });

  // Une entrée choisie referme le menu : c'est l'attente sur un menu déroulant,
  // et le libellé mis à jour par le gestionnaire de l'entrée reste correct pour
  // la prochaine ouverture.
  menuEl?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest(".menu-item")) closeMenu();
  });

  // Capture : un clic sur le canvas est consommé par Pixi, il ne remonterait pas
  // jusqu'ici en phase de bouillonnement.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (isOpen(findbarEl) && !findbarEl?.contains(target) && !searchToggleBtn?.contains(target)) closeSearch();
      if (isOpen(menuEl) && !menuEl?.contains(target) && !menuToggleBtn?.contains(target)) closeMenu();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Un seul niveau se ferme par Échap, le plus récent d'abord.
    if (isOpen(menuEl)) {
      closeMenu();
      menuToggleBtn?.focus();
    } else if (isOpen(findbarEl)) {
      // Échap dans un `input[type=search]` en vide nativement la valeur, SANS
      // émettre d'`input` : la requête du graphe et le compteur resteraient sur
      // l'ancien terme pendant que le champ, lui, paraîtrait vierge. Replier ne
      // doit rien annuler, donc on retient ce vidage.
      event.preventDefault();
      closeSearch();
      searchToggleBtn?.focus();
    }
  });

  // --- Barre d'état : compteurs et diagnostics.
  const statNodesEl = document.getElementById("stat-nodes");
  const statVisibleEl = document.getElementById("stat-visible");
  const statDiagEl = document.getElementById("stat-diagnostics");

  function updateStatus(): void {
    const stats = graph.stats();
    if (statNodesEl) statNodesEl.textContent = String(stats.logicalNodeCount);
    if (statVisibleEl) statVisibleEl.textContent = String(stats.visibleNodeCount);

    const diagnostics = graph.diagnostics();
    if (!statDiagEl) return;
    if (diagnostics.length === 0) {
      statDiagEl.setAttribute("hidden", "");
      return;
    }
    statDiagEl.removeAttribute("hidden");
    statDiagEl.textContent = `${diagnostics.length} diagnostic${diagnostics.length > 1 ? "s" : ""}`;
  }

  statDiagEl?.addEventListener("click", () => {
    for (const d of graph.diagnostics()) console.warn(`[data-graph] ${d.code} @ ${d.path}: ${d.message}`);
  });

  // --- Thème : la lib et le shell DOM basculent ensemble.
  const themeBtn = document.getElementById("toggle-theme");
  const logoEl = document.getElementById("logo") as HTMLImageElement | null;
  let dark = false;

  function applyTheme(): void {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    if (logoEl) {
      logoEl.src = dark ? "/defsquare-short-white-red.svg" : "/defsquare-short-dark-red.svg";
    }
    // L'entrée de menu nomme le thème qu'elle ACTIVERAIT, pas celui en place.
    if (themeBtn) themeBtn.textContent = dark ? "Thème clair" : "Thème sombre";
    graph.setTheme(dark ? defsquareDark : defsquareLight);
    window.__theme = dark ? "dark" : "light";
  }

  themeBtn?.addEventListener("click", () => {
    dark = !dark;
    applyTheme();
  });

  // --- Bascule Structure / Graphe.
  const toggleViewBtn = document.getElementById("toggle-view") as HTMLButtonElement | null;

  /** Aligne icône et libellé accessible du bouton sur la vue que le prochain clic
   * activerait. Lit la vue RÉELLEMENT active, jamais celle qu'on a demandée
   * (voir le commentaire du gestionnaire). */
  function syncViewButton(): void {
    if (!toggleViewBtn) return;
    const target = graph.currentView() === "graph" ? "structure" : "graph";
    const label = target === "graph" ? "Vue graphe" : "Vue structure";
    toggleViewBtn.dataset.target = target;
    toggleViewBtn.title = label;
    toggleViewBtn.setAttribute("aria-label", label);
  }

  toggleViewBtn?.addEventListener("click", () => {
    void (async () => {
      toggleViewBtn.disabled = true;
      try {
        const next = graph.currentView() === "graph" ? "structure" : "graph";
        await graph.setView(next);
        // L'icône et le libellé sont dérivés de la vue RÉELLEMENT active, jamais de celle
        // qu'on a demandée : `setView` avale deux échecs sans rejeter — l'import
        // dynamique du moteur de la vue graphe qui échoue (réseau, chunk absent)
        // et le cas où un `setData` concurrent a déjà pris la main. Dans les deux
        // cas la promesse se résout alors que la vue n'a pas bougé, et une icône
        // posée depuis `next` annoncerait une vue qui n'est pas à l'écran.
        syncViewButton();
        // La bascule change le nombre de nœuds affichés (l'arbre entier d'un
        // côté, les seules entités de l'autre) : sans ce rafraîchissement, le
        // compteur de la barre d'état reste sur la valeur de l'autre vue.
        updateStatus();
      } finally {
        toggleViewBtn.disabled = false;
      }
    })();
  });

  document.getElementById("fit")?.addEventListener("click", () => graph.fit());

  return { updateStatus, applyTheme, syncViewButton };
}
