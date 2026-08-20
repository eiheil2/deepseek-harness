# Agent Note: resynchronize replacement settings registrations after in-flight persistence

Status: implemented

English | [中文](2026-08-18-settings-replacement-resync.zh.md)

## Problem

A settings write may enter provider persistence before its registrant fiber disposes. Dynamic plugin replacement can then register the same namespace before that persistence settles. The completed write updates storage and the provider's raw document, but notifying the disposed registration would violate lifecycle ownership. Leaving the replacement untouched creates two current values: storage contains the completed write while `SettingsScope.get()` and configuration views retain the value resolved before it landed.

## Decision

The persistence commit point reads the latest cached raw section before publishing the completed section. When the original registration still owns the namespace, the ordinary `update` commit proceeds. When another registration owns it, that replacement resolves the completed section through its own schema, composition base, and validation hook. A valid resolved value advances the replacement's raw-section revision and commits with source `provider`; an invalid value keeps the replacement's last good value and emits the same warning policy used by provider hot reload.

No notification reaches a disposed registration. When the namespace remains unregistered or the settings service is stopping, the write reaches storage without a consumer commit.

## Alternatives considered

**Block replacement registration until old writes drain.** `register()` is synchronous and effect-scoped. Turning dynamic plugin registration into an asynchronous wait would spread persistence timing into every registrant and delay unrelated HMR setup.

**Cancel or discard the old write.** Once `persist()` has begun, the provider may already have committed externally and cannot promise cancellation. Ignoring the completion would preserve the storage/runtime split this decision removes.

**Apply the old registration's resolved value to the replacement.** Replacement plugins may carry a different schema, base, or validation rule. Reusing the old value would bypass the current owner and could admit configuration it cannot serve.

## Consequences

Dynamic replacement converges the runtime and configuration views to the provider's completed write without reviving the disposed owner. A replacement that rejects the old owner's value remains operational on its last good value, but the raw document still contains the rejected section and requires a later valid edit. Package tests pin successful resynchronization, revision movement, `provider` event attribution, watcher delivery, and incompatible-schema containment.
