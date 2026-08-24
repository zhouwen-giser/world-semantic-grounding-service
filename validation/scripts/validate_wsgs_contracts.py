#!/usr/bin/env python3
import json
import pathlib
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)
from jsonschema import Draft202012Validator, RefResolver

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMA_ROOT = ROOT / "contracts" / "wsgs-v0.1" / "contracts"
EXAMPLE_ROOT = ROOT / "contracts" / "wsgs-v0.1" / "examples"

schemas = {
    path.name: json.loads(path.read_text(encoding="utf-8"))
    for path in sorted(SCHEMA_ROOT.glob("*.schema.json"))
}
if len(schemas) != 19:
    raise SystemExit(f"expected 19 schemas, received {len(schemas)}")

for schema in schemas.values():
    Draft202012Validator.check_schema(schema)

store = dict(schemas)
store.update({schema["$id"]: schema for schema in schemas.values()})
request_schema = schemas["grounding-request.schema.json"]
resolver = RefResolver("", request_schema, store=store)
validator = Draft202012Validator(request_schema, resolver=resolver)

examples = sorted(EXAMPLE_ROOT.glob("*.json"))
request_examples = [path for path in examples if path.name != "12-no-data-normalization.json"]
for path in request_examples:
    instance = json.loads(path.read_text(encoding="utf-8"))
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
    if errors:
        formatted = "; ".join(error.message for error in errors)
        raise SystemExit(f"{path.name} invalid: {formatted}")

negative = json.loads(request_examples[0].read_text(encoding="utf-8"))
negative["intent"] = "forbidden"
if not list(validator.iter_errors(negative)):
    raise SystemExit("unknown/forbidden request field was accepted")

print(
    f"WSGS_JSON_SCHEMA_PASS schemas={len(schemas)} "
    f"valid_requests={len(request_examples)} unknown_field_rejected=true"
)
