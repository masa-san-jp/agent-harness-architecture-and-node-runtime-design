function fact(path, value, input) {
  return {
    path,
    value,
    status: "fact",
    provenance: [
      {
        kind: "source",
        source_refs: [input.artifact.artifact_id],
        observed_at: input.capturedAt,
      },
    ],
  };
}

export default {
  adapterId: "organization-example",
  version: "1.0.0",
  sourceKind: "other",
  supports({ relativePath, mediaType }) {
    return relativePath.endsWith(".org-export") && mediaType === "application/octet-stream";
  },
  parse(input) {
    const lines = input.bytes.toString("utf8").split(/\r?\n/);
    const records = [];
    const diagnostics = [];
    for (const [index, line] of lines.entries()) {
      if (line.trim() === "") continue;
      try {
        const value = JSON.parse(line);
        const eventId = value.event_id ?? `event:${index + 1}`;
        records.push({
          recordKind: "jsonl_record",
          sourceLocator: `${input.relativePath}#${index + 1}`,
          claims: [
            fact("event_id", eventId, input),
            fact("actor", value.actor ?? "unknown", input),
            fact("action", value.action ?? "unknown_action", input),
            ...(value.input_ref ? [fact("input_ref", value.input_ref, input)] : []),
            ...(value.output_ref ? [fact("output_ref", value.output_ref, input)] : []),
          ],
        });
      } catch {
        diagnostics.push({
          diagnostic_id: `diagnostic:organization-example:${index + 1}`,
          code: "MALFORMED_ORG_EXPORT",
          severity: "error",
          path: input.relativePath,
          line: index + 1,
          message: "The example organization export line is not valid JSON",
        });
      }
    }
    return { records, diagnostics };
  },
};
