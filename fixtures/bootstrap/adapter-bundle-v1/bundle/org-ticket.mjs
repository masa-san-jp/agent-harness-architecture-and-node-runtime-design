export default {
  adapterId: "reference-org-ticket",
  version: "1.0.0",
  sourceKind: "other",
  supports: ({ relativePath, mediaType }) =>
    relativePath === "ticket.org-export" && mediaType === "application/octet-stream",
  parse: (input) => {
    if ("credentials" in input || "networkClient" in input) {
      throw new Error("Adapter received a forbidden capability");
    }
    const text = input.bytes.toString("utf8");
    const ticketId = text.match(/^ticket_id=(.+)$/m)?.[1]?.trim() ?? "unknown";
    const requester = text.match(/^requester=(.+)$/m)?.[1]?.trim() ?? "unknown";
    const action = text.match(/^action=(.+)$/m)?.[1]?.trim() ?? "unknown_action";
    return {
      records: [
        {
          recordKind: "jsonl_record",
          sourceLocator: `ticket:${ticketId}`,
          claims: [
            {
              path: "event_id",
              value: "EVT-CUSTOM-001",
              status: "fact",
              provenance: [{ kind: "source", source_refs: [input.sourceId] }],
            },
            {
              path: "actor",
              value: requester,
              status: "fact",
              provenance: [{ kind: "source", source_refs: [input.sourceId] }],
            },
            {
              path: "action",
              value: action,
              status: "fact",
              provenance: [{ kind: "source", source_refs: [input.sourceId] }],
            },
            {
              path: "input_ref",
              value: ticketId,
              status: "fact",
              provenance: [{ kind: "source", source_refs: [input.sourceId] }],
            },
            {
              path: "output_ref",
              value: `request:${ticketId}`,
              status: "fact",
              provenance: [{ kind: "source", source_refs: [input.sourceId] }],
            },
          ],
        },
      ],
    };
  },
};
