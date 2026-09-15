import {
  createBadge,
  createCluster,
  createClusterSeparator,
  createFindbar,
  createIconButton,
  createMenu,
  createMenuItem,
  type IconName,
} from "@chrome/index.ts";

import "./ui-components.css";

/**
 * The « UI components » view: the DOM chrome's primitives — floating surface,
 * icon button, findbar, entity badge, menu item — each laid out as a row of
 * states.
 *
 * These specimens are the COMPONENTS THEMSELVES. They come out of
 * `@defsquare/datagraph-chrome`'s factories, the ones the demo calls, and are
 * dressed by the stylesheet the demo loads. Same regime as the graph components
 * board with respect to `draw.ts`: a specimen cannot lie about what the product
 * draws, because it IS what the product draws.
 *
 * This board did in fact start out copying the chrome's CSS and icons, for want
 * of being able to import them — that observation is what got the package
 * extracted. All that remains here is the caption around the objects on
 * display.
 *
 * Two stances found the board itself.
 *
 * 1. The states are REAL, never simulated. A "hover" cell is the real
 *    component, hovered; a "focus" cell is the real component, reached with
 *    Tab. No twin class of the `.is-hover` sort: it would only be a copy of the
 *    `:hover` rule, and would become false at the first touch-up. Owned
 *    corollary: several cells look alike at rest, and it is the CAPTION that
 *    states the gesture to perform.
 *
 * 2. The states that do not exist are DECLARED absent, not invented. The chrome
 *    defines neither `:active` for the menu item nor `:disabled` for the
 *    findbar's chevrons: the board shows that as it is and names it. A design
 *    system board must be usable to spot a hole; it cannot be if it patches the
 *    hole on the way past.
 *
 * No Pixi here, and that is the information: these components exist ONLY in the
 * DOM. Translucency, backdrop blur and drop shadows are exactly what the canvas
 * cannot do, and that is why the chrome stayed DOM above the canvas rather than
 * being drawn inside it.
 */

// --- The caption's DOM factories.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A section's frame: title, note, row of cells.
 *
 * The classes belong to this view (`uic-*`) and are not those of the Tokens
 * (`ds-*`) or Graph components (`gc-*`) views: those live in ANOTHER view's
 * stylesheet, and leaning on them would break the day that other view renames
 * or moves its sheet, with nothing to announce it.
 */
function section(title: string, note: string): { node: HTMLElement; row: HTMLElement } {
  const node = el("section", "uic-section");
  node.append(el("h2", "uic-section-title", title));
  node.append(el("p", "uic-note", note));
  const row = el("div", "uic-row");
  node.append(row);
  return { node, row };
}

/**
 * A cell: the specimen on the checkerboard, its caption underneath.
 *
 * The caption accepts light markup (`<code>`) because it names attributes and
 * selectors — `disabled`, `aria-busy="true"` — that bare text would not set
 * apart from the surrounding prose.
 */
function cell(label: string, ...content: Node[]): HTMLElement {
  const node = el("div", "uic-cell");
  const stage = el("div", "uic-stage");
  stage.append(...content);
  const caption = el("p", "uic-cell-label");
  caption.innerHTML = label;
  node.append(stage, caption);
  return node;
}

/** A bare floating surface. `.float` is a class one SETS, not a component one
 * builds: it comes from the chrome's stylesheet, there is nothing to
 * manufacture. */
function float(extraClass: string | null, ...content: Node[]): HTMLElement {
  const node = el("div", extraClass ? `float ${extraClass}` : "float");
  node.append(...content);
  return node;
}

// --- Section 1: the floating surface.

function floatSection(): HTMLElement {
  const { node, row } = section(
    "Floating surface",
    "The base of the whole chrome: translucent --float-bg, --float-border, --shadow-float, and a 16px blur saturated to 160% applied to whatever passes BEHIND. Laid on a checkerboard, without which « translucent » and « blurred » cannot be told apart from a flat fill. The surface itself is not interactive: hover, focus, active and disabled belong to its children — the four sections that follow.",
  );

  const body = el("div", "uic-float-body");
  body.append(
    el("div", undefined, "float-bg + float-border"),
    el("div", undefined, "shadow-float"),
    el("div", undefined, "backdrop-filter: blur(16px)"),
  );

  row.append(
    cell(
      "rest — <strong>its only state</strong>: a surface is not hovered, does not take focus and is never disabled.",
      float(null, body),
    ),
    cell(
      "the icon cluster (<code>createCluster</code>) — the same surface, tightened to 3px around its buttons, with its 1px separator. This is the demo toolbar's exact assembly.",
      createCluster(
        createIconButton({ icon: "search", label: "Search" }),
        createIconButton({ icon: "fit", label: "Fit to view" }),
        createIconButton({ icon: "graph", label: "Graph view" }),
        createClusterSeparator(),
        createIconButton({ icon: "dots", label: "Menu" }),
      ),
    ),
  );

  return node;
}

// --- Section 2: the icon button.

interface SpecimenButtonOptions {
  icon: IconName;
  label: string;
  small?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  busy?: boolean;
}

/**
 * One of the product's buttons, set in the state we want to show.
 *
 * `disabled` and `aria-busy` are not options of `createIconButton` and must not
 * be: they are RUNTIME states, which the application sets and clears as it
 * goes — a factory taking them as arguments would suggest they are decided at
 * construction. The board therefore sets them the way the demo does, by
 * attribute, after the fact.
 */
function specimenButton(opts: SpecimenButtonOptions): HTMLButtonElement {
  const button = createIconButton({
    icon: opts.icon,
    label: opts.label,
    small: opts.small,
    // `aria-expanded` IS a factory argument: a panel trigger carries it from
    // construction, folded, without which it would announce a panel it does not
    // open.
    expanded: opts.expanded,
  });
  if (opts.busy) button.setAttribute("aria-busy", "true");
  if (opts.disabled) button.disabled = true;
  return button;
}

/** A lone button, but on its cluster: outside a floating surface, its hover tint
 * (`--float-hover`) would composite over the canvas and not over the glass,
 * hence over a color the product never shows. */
function loneButton(opts: SpecimenButtonOptions): HTMLElement {
  return createCluster(specimenButton(opts));
}

function iconButtonSection(): HTMLElement {
  const { node, row } = section(
    "Icon button",
    "The chrome's only command: 30px, no background at rest, the icon in --ds-muted. Every cell below is a real button — the states are not simulated, they have to be provoked. The last two, on the other hand, hang on an attribute and read at rest.",
  );

  // `data-badge` is a runtime state too, exactly like `disabled` and
  // `aria-busy` above: not a `createIconButton` option, set here the way the
  // demo sets it on the magnifier once a query survives the findbar's fold.
  const badged = createIconButton({ icon: "search", label: "Search" });
  badged.dataset.badge = "true";

  row.append(
    cell("rest", loneButton({ icon: "search", label: "Search" })),
    cell(
      "hover — <strong>move the pointer over it</strong>: <code>--float-hover</code> background, icon in <code>--ds-ink</code>.",
      loneButton({ icon: "search", label: "Search" }),
    ),
    cell(
      "keyboard focus — <strong>reach it with Tab</strong>: 2px <code>--ds-primary</code> ring, offset 1px outwards. A click does not trigger it (<code>:focus-visible</code>).",
      loneButton({ icon: "search", label: "Search" }),
    ),
    cell(
      "active — <strong>hold the click</strong>: the button drops half a pixel, the whole of the press.",
      loneButton({ icon: "search", label: "Search" }),
    ),
    cell(
      "<code>disabled</code> — 0.45 opacity and the default cursor; it no longer takes focus.",
      loneButton({ icon: "search", label: "Search", disabled: true }),
    ),
    cell(
      "<code>aria-expanded=\"true\"</code> — the panel it opens is unfolded: the trigger stays lit in <code>--ds-primary</code> over a background washed to 14%.",
      loneButton({ icon: "dots", label: "Menu", expanded: true }),
    ),
    cell(
      "<code>aria-busy=\"true\"</code> + <code>disabled</code> — computation running. 0.7 opacity (lighter than plain disabled: « in progress » is not « unavailable ») and a slow pulse, dropped under <code>prefers-reduced-motion</code>.",
      loneButton({ icon: "fit", label: "Fit to view", busy: true, disabled: true }),
    ),
    cell(
      "<code>small</code> variant (<code>.ibtn-sm</code>) — 24px, the chrome's only other size; it serves nothing but closing the detail panel. Same states as above.",
      loneButton({ icon: "close", label: "Close panel", small: true }),
    ),
    cell(
      "two icons in one button — this is how the view toggle carries the current state AND the target state, the demo's stylesheet hiding one according to <code>data-target</code>. Outside the demo no rule separates them: both show, which is the bare structure.",
      createCluster(
        createIconButton({ icon: ["graph", "structure"], label: "Graph view" }),
      ),
    ),
    cell(
      "<code>data-badge=\"true\"</code> — a dot held by a pseudo-element: something is still running behind the folded button. Like <code>disabled</code> and <code>aria-busy</code>, it is not a <code>createIconButton</code> argument — the demo is what sets it, on the magnifier, when a query survives the bar being folded.",
      createCluster(badged),
    ),
  );

  return node;
}

// --- Section 3: the findbar.

interface FindbarSpecimenOptions {
  value?: string;
  counter?: string;
  disabled?: boolean;
}

function findbar(opts: FindbarSpecimenOptions = {}): HTMLElement {
  const bar = createFindbar();
  // The factory returns it FOLDED, as the demo needs: in the product, the
  // findbar only appears on a click on the magnifier. On the board it is the
  // object on display, hence permanently unfolded.
  bar.root.removeAttribute("hidden");

  if (opts.value !== undefined) bar.input.value = opts.value;
  if (opts.counter !== undefined) bar.counter.textContent = opts.counter;
  if (opts.disabled) {
    bar.input.disabled = true;
    bar.prev.disabled = true;
    bar.next.disabled = true;
  }
  return bar.root;
}

function findbarSection(): HTMLElement {
  const { node, row } = section(
    "Search field",
    "The unfolding bar: a 296×36 floating surface carrying the icon, the bare field (neither border nor outline of its own — it is the BAR that reacts to focus), the monospace counter and the two navigation chevrons. The chevrons have their own hover and keyboard focus, in every one of the cells.",
  );

  row.append(
    cell("rest, empty field — the counter stays absent as long as no search has run.", findbar()),
    cell(
      "focus — <strong>click into the field or reach it with Tab</strong>: this is <code>:focus-within</code>, so the whole bar lights up — tinted border and a 3px halo — while the field itself stays outline-free.",
      findbar(),
    ),
    cell(
      "with results — the « current/total » counter appears between the field and the chevrons, and pushes them without ever changing the bar's width (fixed at 296px).",
      findbar({ value: "order", counter: "3/17" }),
    ),
    cell(
      "<code>disabled</code> on the field and the chevrons — <strong>and this is a hole</strong>: the chrome defines no disabled rule for them. What shows is the browser's default style, not a design system decision.",
      findbar({ value: "order", counter: "0/0", disabled: true }),
    ),
  );

  return node;
}

// --- Section 4: the entity badge.

function badgeSample(type: string, label: string): HTMLElement {
  return float("uic-detail-sample", createBadge({ text: type }), el("p", "uic-detail-label", label));
}

function badgeSection(): HTMLElement {
  const { node, row } = section(
    "Entity badge",
    "The selected node's type, at the head of the detail panel: capitals, open tracking, --ds-primary background. Like the floating surface it is not interactive — no hover, no focus, no disabled state. Shown above the node's label, the only place it is used, so its size can be judged against it.",
  );

  row.append(
    cell("rest — <strong>its only state</strong>.", badgeSample("Order", "Order #4821")),
    cell(
      "long label — the badge has neither a width nor truncation: it takes its text's room, so a verbose type stretches the line.",
      badgeSample("PurchaseOrderLine", "PurchaseOrderLine #77-3"),
    ),
    cell(
      "the ink is a <code>#ffffff</code> hard-coded in <code>chrome.css</code>, not a token — <strong>the design system has no « on accent » ink</strong>. The real rule is what applies here, so the hole shows as it is.",
      badgeSample("Customer", "Customer #c1"),
    ),
  );

  return node;
}

// --- Section 5: the menu item.

interface MenuItemSpecimen {
  text: string;
  disabled?: boolean;
}

/**
 * The product's menu panel, unfolded.
 *
 * `createMenu` sets `role="menu"` and `hidden`, as the demo needs. The board
 * removes `hidden` — here the panel is the object on display — but keeps the
 * role: the board shows the component as it is, ARIA included. That role
 * promises arrow-key navigation which neither the demo nor the board
 * implements; it is a gap in the product, and hiding it here would amount to
 * precisely what this board exists to prevent.
 */
function menuPanel(items: MenuItemSpecimen[]): HTMLElement {
  const panel = createMenu(
    {},
    ...items.map((item) => {
      const button = createMenuItem({ label: item.text });
      if (item.disabled) button.disabled = true;
      return button;
    }),
  );
  panel.removeAttribute("hidden");
  return panel;
}

function menuSection(): HTMLElement {
  const { node, row } = section(
    "Menu item",
    "The ⋮ menu's entries: text alone, across the panel's whole width. They carry no icon by construction — the demo rewrites their textContent to reflect the current state (« Dark theme » / « Light theme »), which an icon child would not survive. Here every entry carries in its own label the state it asks for.",
  );

  row.append(
    cell(
      "the four states, one entry each. Keyboard focus lays its ring INSIDE (<code>outline-offset: -2px</code>): the entry spanning the full width, an outer ring would overflow the panel.",
      menuPanel([
        { text: "Rest" },
        { text: "Hover me" },
        { text: "Tab here for focus" },
        { text: "Disabled", disabled: true },
      ]),
    ),
    cell(
      "<strong>no active state</strong>: the chrome defines no <code>:active</code> rule for the menu item, where the icon button has one. Holding the click therefore produces nothing — an asymmetry observed, not patched here.",
      menuPanel([{ text: "Hold the click: nothing moves" }]),
    ),
    cell(
      "the demo's real menu, for scale: two entries, a 216px-wide panel, 5px of inner padding.",
      menuPanel([{ text: "Extended dataset (4000)" }, { text: "Dark theme" }]),
    ),
  );

  return node;
}

// --- Mounting.

/**
 * Mounts the view. Conforms to `PlaygroundView.mount`'s contract: `root` is
 * empty and ours, the return unmounts.
 *
 * The contract's `state` parameter is not declared — this view does not need
 * it. Everything it draws is dressed by the generated CSS variables, which
 * follow `data-theme` on `<html>`; the theme therefore arrives through the
 * cascade, without the view having to read it. That is also what makes it the
 * only one to survive a mode toggle as it stands — the shell remounts it
 * anyway, for uniformity with the Pixi views, which cannot.
 *
 * No resource to release either: no canvas, no subscription, no listener
 * outside `root`. The cleanup is thus limited to removing the subtree.
 */
export function mountUiComponentsView(root: HTMLElement): () => void {
  const page = el("div", "ui-components-view");
  page.append(
    floatSection(),
    iconButtonSection(),
    findbarSection(),
    badgeSection(),
    menuSection(),
  );
  root.append(page);

  return () => {
    page.remove();
  };
}
