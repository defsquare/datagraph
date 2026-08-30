export interface Theme {
  fonts: {
    body: string;
    mono: string;
  };
  colors: {
    background: string;
    nodeFill: string;
    nodeStroke: string;
    text: string;
    textMuted: string;
    entity: string;
    refEdge: string;
    containEdge: string;
    selection: string;
    searchHighlight: string;
    danglingRef: string;
  };
  byEntityType?: Record<string, { accent: string }>;
}

export interface ThemeOverride {
  fonts?: Partial<Theme["fonts"]>;
  colors?: Partial<Theme["colors"]>;
  byEntityType?: Theme["byEntityType"];
}

export const defsquareTheme: Theme = {
  fonts: {
    body: "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif",
    mono: "Fira Code, SF Mono, Menlo, Consolas, monospace",
  },
  colors: {
    background: "#f7f7f8",
    nodeFill: "#ffffff",
    nodeStroke: "#e5e7eb",
    text: "#070f19",
    textMuted: "#4b5563",
    entity: "#f65e5e",
    refEdge: "#2a5a98",
    containEdge: "#9ca3af",
    selection: "#1e416e",
    searchHighlight: "#E2CA9E",
    danglingRef: "#d97706",
  },
};

export const neutralLightTheme: Theme = {
  fonts: {
    body: "system-ui, sans-serif",
    mono: "monospace",
  },
  colors: {
    background: "#fafafa",
    nodeFill: "#ffffff",
    nodeStroke: "#e4e4e7",
    text: "#18181b",
    textMuted: "#52525b",
    entity: "#2563eb",
    refEdge: "#7c3aed",
    containEdge: "#a1a1aa",
    selection: "#2563eb",
    searchHighlight: "#fde047",
    danglingRef: "#dc2626",
  },
};

export const neutralDarkTheme: Theme = {
  fonts: {
    body: "system-ui, sans-serif",
    mono: "monospace",
  },
  colors: {
    background: "#18181b",
    nodeFill: "#27272a",
    nodeStroke: "#3f3f46",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    entity: "#60a5fa",
    refEdge: "#a78bfa",
    containEdge: "#52525b",
    selection: "#60a5fa",
    searchHighlight: "#ca8a04",
    danglingRef: "#f87171",
  },
};

export function resolveTheme(partial?: ThemeOverride): Theme {
  const base = defsquareTheme;
  return {
    fonts: { ...base.fonts, ...partial?.fonts },
    colors: { ...base.colors, ...partial?.colors },
    ...(partial?.byEntityType ? { byEntityType: { ...partial.byEntityType } } : {}),
  };
}
