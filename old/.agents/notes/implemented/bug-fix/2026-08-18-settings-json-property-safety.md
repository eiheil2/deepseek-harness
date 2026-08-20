# Agent Note: preserve every JSON settings property as own data

Status: implemented

English | [中文](2026-08-18-settings-json-property-safety.zh.md)

## Problem

Settings write cloning and layer merging assigned dynamic JSON keys through ordinary bracket assignment. The valid JSON property `__proto__` therefore invoked the legacy object prototype setter instead of creating an own data property. The key disappeared before persistence and changed the prototype of an intermediate configuration object. The wire redactor rebuilt object and dictionary values the same way, while deep equality and schema-property checks used inherited membership. Together these paths could silently lose or misclassify valid configuration keys.

The reproduction observed local object prototype mutation and data loss. It did not mutate global `Object.prototype` and does not establish code execution.

## Decision

Dynamic JSON keys are written with `Object.defineProperty` as enumerable, configurable, writable own data properties. Merge and equality use `Object.hasOwn` instead of inherited membership. The redactor applies the same rules while copying unknown object fields, declared fields, and dictionary entries. Ordinary objects retain `Object.prototype`; special property names remain ordinary own values.

## Alternatives considered

**Reject special property names.** JSON permits these strings, settings schemas may legitimately model arbitrary dictionaries, and rejection would turn an implementation bug into an unnecessary format restriction.

**Use null-prototype objects everywhere.** That avoids the legacy setter but changes the object shape handed to schemas, providers, plugins, and equality consumers. Defining own data properties preserves the existing ordinary-object contract.

**Patch only write cloning.** A preserved key would still be lost during layer merge or wire redaction, and inherited membership could still produce false equality. The invariant must cover every dynamic-property reconstruction in the package.

## Consequences

Valid JSON property names round-trip through updates and redacted descriptors without changing intermediate prototypes. Own-property checks no longer confuse inherited built-ins with document data. The repair is limited to object construction and membership semantics; schemas, provider formats, and public settings APIs are unchanged. Regressions pin update persistence, object/dict redaction, normal prototypes, and inherited-key equality.
