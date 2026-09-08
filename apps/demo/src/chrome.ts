import { defsquareLight, defsquareDark, type DataGraph } from "@defsquare/data-graph";
import {
  createCluster,
  createClusterSeparator,
  createFindbar,
  createIconButton,
  createMenu,
  createMenuItem,
  createStatusLink,
} from "@defsquare/data-graph-chrome";

declare global {
  interface Window {
    __theme?: string;
  }
}

/** The viewer chrome: floating surfaces (unfolding search bar, ⋮ menu), status
 * bar, theme and view toggle. Everything here exists whatever the launch mode —
 * the demo-only tooling lives in `demo-mode.ts`. */
export interface Chrome {
  /** Recomputes the status bar counters and diagnostics link. */
  updateStatus(): void;
  applyTheme(): void;
  /** Aligns the toggle button on the view that is ACTUALLY active. */
  syncViewButton(): void;
  /** Marks the magnifier as carrying a live query. Folding the findbar cancels
   * nothing — the highlights stay on the canvas — so the button has to say that
   * something is still running behind it. */
  setSearchActive(active: boolean): void;
}

export interface ChromeHooks {
  /** Called when the search bar unfolds: the chrome does not know the input,
   * `search-ui.ts` is what gives it focus. */
  onSearchOpen(): void;
  /** Called when the diagnostics link is activated. The chrome owns the LINK,
   * not the panel: `main.ts` is what holds the detail panel and decides what
   * the surface shows. */
  onDiagnosticsOpen(): void;
}

export function createChrome(graph: DataGraph, hooks: ChromeHooks): Chrome {
  // --- Building the chrome.
  //
  // The primitives come from the chrome package's factories; this file only
  // decides WHICH buttons exist, in what order, and what they do — that is, the
  // assembly, which is a product decision and stays here.
  //
  // The ids are set explicitly: the wiring below does without them (it holds the
  // references directly), but the end-to-end tests designate these elements by
  // id. Dropping them would break the e2e suite with nothing else reporting it.
  const searchToggleBtn = createIconButton({
    id: "search-toggle",
    icon: "search",
    label: "Rechercher",
    controls: "findbar",
    expanded: false,
  });
  const fitBtn = createIconButton({ id: "fit", icon: "fit", label: "Ajuster à la vue" });
  // "Ranger" (tidy): a global re-layout on demand, which repairs the drift
  // accumulated by successive expansions and reveals. No effect in graph view,
  // per `tidy()`'s contract.
  const tidyBtn = createIconButton({ id: "tidy", icon: "tidy", label: "Ranger" });
  // `data-target` carries the view a click WOULD activate: the icon shown is
  // therefore the target view's. `syncViewButton()` sets it from the real
  // `graph.currentView()`, never from what was requested.
  const toggleViewBtn = createIconButton({
    id: "toggle-view",
    icon: ["graph", "structure"],
    label: "Vue graphe",
  });
  toggleViewBtn.dataset.target = "graph";
  const menuToggleBtn = createIconButton({
    id: "menu-toggle",
    icon: "dots",
    label: "Menu",
    controls: "menu",
    expanded: false,
  });
  menuToggleBtn.setAttribute("aria-haspopup", "menu");

  const findbar = createFindbar({
    id: "findbar",
    inputId: "search",
    counterId: "match-counter",
    prevId: "prev-match",
    nextId: "next-match",
  });
  const findbarEl = findbar.root;

  // Menu items carry text only: their `textContent` is rewritten to reflect the
  // current state, which a child icon would not survive.
  const datasetItem = createMenuItem({
    id: "toggle-dataset",
    label: "Jeu de données étendu (4000)",
  });
  const themeBtn = createMenuItem({ id: "toggle-theme", label: "Thème sombre" });
  const menuEl = createMenu({ id: "menu", labelledBy: "menu-toggle" }, datasetItem, themeBtn);

  document
    .getElementById("toolbar")
    ?.append(
      createCluster(
        searchToggleBtn,
        fitBtn,
        tidyBtn,
        toggleViewBtn,
        createClusterSeparator(),
        menuToggleBtn,
      ),
      findbarEl,
      menuEl,
    );

  document
    .querySelector(".detail-head")
    ?.append(
      createIconButton({
        id: "detail-close",
        icon: "close",
        label: "Fermer le panneau",
        small: true,
      }),
    );

  // --- Floating chrome: search unfolding, ⋮ menu.
  // None of these toggles touches graph state — the search keeps its query and
  // its results when collapsed, the selection survives closing the panel. This
  // is display only.

  function setExpanded(panel: HTMLElement | null, trigger: HTMLElement | null, open: boolean): void {
    if (open) panel?.removeAttribute("hidden");
    else panel?.setAttribute("hidden", "");
    trigger?.setAttribute("aria-expanded", String(open));
  }

  function isOpen(panel: HTMLElement | null): boolean {
    return panel !== null && !panel.hasAttribute("hidden");
  }

  let searchActive = false;

  function syncSearchBadge(): void {
    // The badge only shows on the FOLDED bar: with the bar open the query is
    // right there, and a dot would repeat it.
    if (searchActive && !isOpen(findbarEl)) searchToggleBtn.dataset.badge = "true";
    else delete searchToggleBtn.dataset.badge;
  }

  function setSearchActive(active: boolean): void {
    searchActive = active;
    syncSearchBadge();
  }

  function openSearch(): void {
    setExpanded(findbarEl, searchToggleBtn, true);
    // Unfolding without giving focus would force a second click before typing.
    hooks.onSearchOpen();
    syncSearchBadge();
  }

  function closeSearch(): void {
    setExpanded(findbarEl, searchToggleBtn, false);
    syncSearchBadge();
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

  // Choosing an item closes the menu: that is what a dropdown is expected to do,
  // and the label updated by the item's handler stays correct for the next
  // opening.
  menuEl?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest(".menu-item")) closeMenu();
  });

  // Capture phase: a click on the canvas is consumed by Pixi, it would never
  // reach here while bubbling.
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
    // Escape closes one level at a time, the most recent one first.
    if (isOpen(menuEl)) {
      closeMenu();
      menuToggleBtn?.focus();
    } else if (isOpen(findbarEl)) {
      // Escape inside an `input[type=search]` natively clears its value WITHOUT
      // emitting an `input` event: the graph query and the counter would stay on
      // the old term while the field looked empty. Collapsing must cancel
      // nothing, so that clearing is held back.
      event.preventDefault();
      closeSearch();
      searchToggleBtn?.focus();
    }
  });

  // --- Status bar: counters and diagnostics.
  const statNodesEl = document.getElementById("stat-nodes");
  const statVisibleEl = document.getElementById("stat-visible");
  const statDiagEl = createStatusLink({ id: "stat-diagnostics" });
  document.getElementById("statusbar")?.append(statDiagEl);

  function updateStatus(): void {
    const stats = graph.stats();
    if (statNodesEl) statNodesEl.textContent = String(stats.logicalNodeCount);
    if (statVisibleEl) statVisibleEl.textContent = String(stats.visibleNodeCount);

    const diagnostics = graph.diagnostics();
    if (diagnostics.length === 0) {
      statDiagEl.setAttribute("hidden", "");
      return;
    }
    statDiagEl.removeAttribute("hidden");
    statDiagEl.textContent = `${diagnostics.length} diagnostic${diagnostics.length > 1 ? "s" : ""}`;
  }

  statDiagEl.addEventListener("click", () => {
    // The `console.warn` stays: in dev it is still the fastest way to read the
    // whole batch, and the packaged binary has no devtools — which is exactly
    // why the panel below had to exist.
    for (const d of graph.diagnostics()) console.warn(`[data-graph] ${d.code} @ ${d.path}: ${d.message}`);
    hooks.onDiagnosticsOpen();
  });

  // --- Theme: the library and the DOM shell switch together.
  const logoEl = document.getElementById("logo") as HTMLImageElement | null;
  let dark = false;

  function applyTheme(): void {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    if (logoEl) {
      logoEl.src = dark ? "/defsquare-short-white-red.svg" : "/defsquare-short-dark-red.svg";
    }
    // The menu item names the theme it WOULD activate, not the current one.
    themeBtn.textContent = dark ? "Thème clair" : "Thème sombre";
    graph.setTheme(dark ? defsquareDark : defsquareLight);
    window.__theme = dark ? "dark" : "light";
  }

  themeBtn.addEventListener("click", () => {
    dark = !dark;
    applyTheme();
  });

  // --- Structure / Graph toggle.

  /** Aligns the button's icon and accessible label on the view the next click
   * would activate. Reads the view that is ACTUALLY active, never the one that
   * was requested (see the handler's comment). */
  function syncViewButton(): void {
    const target = graph.currentView() === "graph" ? "structure" : "graph";
    const label = target === "graph" ? "Vue graphe" : "Vue structure";
    toggleViewBtn.dataset.target = target;
    toggleViewBtn.title = label;
    toggleViewBtn.setAttribute("aria-label", label);
  }

  /**
   * Marks the toggle button as BUSY while the view is being computed.
   *
   * There is now something to signal: the graph view layout has moved into a Web
   * Worker, so the page stays alive during the seconds the computation takes on
   * a large dataset — the structure view can still be panned and zoomed. That is
   * exactly what makes the indication necessary: without it, a perfectly
   * responsive interface that does not switch reads as a lost click.
   *
   * `aria-busy` carries the information and the class carries the style: the
   * attribute is what assistive technology reads, and it doubles as the CSS
   * selector, so the two cannot fall out of sync. `disabled` is still set
   * elsewhere — two simultaneous toggles would make no sense.
   */
  function setViewBusy(busy: boolean): void {
    if (busy) toggleViewBtn.setAttribute("aria-busy", "true");
    else toggleViewBtn.removeAttribute("aria-busy");
  }

  toggleViewBtn.addEventListener("click", () => {
    void (async () => {
      toggleViewBtn.disabled = true;
      // Inside the `try`/`finally` alongside `disabled`: both are lifted on ALL
      // paths — successful toggle, failure swallowed by `setView`, or bail-out
      // because a concurrent `setData` took over.
      setViewBusy(true);
      try {
        const next = graph.currentView() === "graph" ? "structure" : "graph";
        await graph.setView(next);
        // Icon and label are derived from the view that is ACTUALLY active, never
        // from the one requested: `setView` swallows two failures without
        // rejecting — the dynamic import of the graph view engine failing
        // (network, missing chunk), and the case where a concurrent `setData`
        // already took over. In both the promise resolves while the view has not
        // moved, and an icon set from `next` would announce a view that is not on
        // screen.
        syncViewButton();
      } finally {
        setViewBusy(false);
        toggleViewBtn.disabled = false;
      }
    })();
  });

  fitBtn.addEventListener("click", () => graph.fit());

  // `tidy()` is async (it redoes the full layout) but nothing here has to await
  // its result: the promise is explicitly discarded, and the instance guards
  // itself against concurrent operations.
  tidyBtn.addEventListener("click", () => void graph.tidy());

  return { updateStatus, applyTheme, syncViewButton, setSearchActive };
}
