const IMAGE_INPUT_NODE_TYPES = ["LoadImage", "VAEEncode"] as const;

export function workflowSupportsImageInput(graph: unknown): boolean {
  return workflowGraphHasAnyClassType(graph, IMAGE_INPUT_NODE_TYPES);
}

export function workflowGraphHasAnyClassType(
  graph: unknown,
  classTypes: readonly string[]
): boolean {
  if (!graph) return false;

  if (typeof graph === "string") {
    for (const classType of classTypes) {
      if (graph.includes(classType)) return true;
    }
    return false;
  }

  if (typeof graph !== "object") return false;

  const maybeGraph = graph as Record<string, unknown> & {
    nodes?: Array<Record<string, unknown>>;
  };

  if (Array.isArray(maybeGraph.nodes)) {
    for (const node of maybeGraph.nodes) {
      const classType = node?.class_type;
      if (typeof classType !== "string") continue;
      for (const needle of classTypes) {
        if (classType.includes(needle)) return true;
      }
    }
    return false;
  }

  for (const node of Object.values(maybeGraph)) {
    if (!node || typeof node !== "object") continue;
    const classType = (node as { class_type?: unknown }).class_type;
    if (typeof classType !== "string") continue;
    for (const needle of classTypes) {
      if (classType.includes(needle)) return true;
    }
  }

  return false;
}

