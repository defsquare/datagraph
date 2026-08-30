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

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

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

export function resolveTheme(partial?: DeepPartial<Theme>): Theme {
  if (!partial) {
    return JSON.parse(JSON.stringify(defsquareTheme));
  }

  const result: Theme = JSON.parse(JSON.stringify(defsquareTheme));

  if (partial.fonts) {
    if (partial.fonts.body !== undefined) {
      result.fonts.body = partial.fonts.body;
    }
    if (partial.fonts.mono !== undefined) {
      result.fonts.mono = partial.fonts.mono;
    }
  }

  if (partial.colors) {
    if (partial.colors.background !== undefined) {
      result.colors.background = partial.colors.background;
    }
    if (partial.colors.nodeFill !== undefined) {
      result.colors.nodeFill = partial.colors.nodeFill;
    }
    if (partial.colors.nodeStroke !== undefined) {
      result.colors.nodeStroke = partial.colors.nodeStroke;
    }
    if (partial.colors.text !== undefined) {
      result.colors.text = partial.colors.text;
    }
    if (partial.colors.textMuted !== undefined) {
      result.colors.textMuted = partial.colors.textMuted;
    }
    if (partial.colors.entity !== undefined) {
      result.colors.entity = partial.colors.entity;
    }
    if (partial.colors.refEdge !== undefined) {
      result.colors.refEdge = partial.colors.refEdge;
    }
    if (partial.colors.containEdge !== undefined) {
      result.colors.containEdge = partial.colors.containEdge;
    }
    if (partial.colors.selection !== undefined) {
      result.colors.selection = partial.colors.selection;
    }
    if (partial.colors.searchHighlight !== undefined) {
      result.colors.searchHighlight = partial.colors.searchHighlight;
    }
    if (partial.colors.danglingRef !== undefined) {
      result.colors.danglingRef = partial.colors.danglingRef;
    }
  }

  if (partial.byEntityType !== undefined) {
    result.byEntityType = partial.byEntityType as Record<string, { accent: string }>;
  }

  return result;
}
