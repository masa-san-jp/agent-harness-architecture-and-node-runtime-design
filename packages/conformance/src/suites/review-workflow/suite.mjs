import { join } from "node:path";

export const id = "review-workflow";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/review/review.json"));
  const schema = await readJson(
    join(fixtureRoot, "../../../schemas/review/review-contract.v1.schema.json"),
  );
  const questionSchema = await readJson(
    join(fixtureRoot, "../../../schemas/review/review-question.v1.schema.json"),
  );
  const approvalSchema = await readJson(
    join(fixtureRoot, "../../../schemas/review/approval.v1.schema.json"),
  );
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/review-contract.v1.json"),
  );

  assert(expected.contract_id === registry.contract_id, "Review contract id mismatch");
  assert(expected.version === registry.version, "Review contract version mismatch");
  assert(
    schema.$id === "urn:agent-harness-reference:review-contract:v1",
    "Review schema id mismatch",
  );
  assert(
    questionSchema.$id === "urn:agent-harness-reference:review-question:v1",
    "Question schema id mismatch",
  );
  assert(
    approvalSchema.$id === "urn:agent-harness-reference:approval:v1",
    "Approval schema id mismatch",
  );
  assert(expected.change_set_is_versioned === true, "Change set is not versioned");
  assert(expected.approved_version_is_immutable === true, "Approved version is mutable");
  assert(expected.self_approval === "deny", "Self approval is not denied");
  assert(expected.exception_requires_expiry === true, "Exceptions do not expire");
  for (const answerType of expected.answer_types)
    assert(answerType.length > 0, "Empty answer type");
  for (const source of expected.question_sources)
    assert(source.length > 0, "Empty question source");
}
