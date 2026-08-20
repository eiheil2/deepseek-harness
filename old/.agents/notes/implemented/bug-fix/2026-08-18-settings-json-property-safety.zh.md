# Agent Note: 所有 JSON settings 属性均保持为 own data

Status: implemented

[English](2026-08-18-settings-json-property-safety.md) | 中文

## Problem

settings 写入克隆与分层合并通过普通方括号赋值写入动态 JSON key。因此，合法 JSON 属性 `__proto__` 会调用遗留的对象原型 setter，而不是创建 own data property；该 key 在持久化前消失，并改变中间配置对象的原型。wire 脱敏器以同样方式重建 object 与 dictionary 值，深比较和 schema 属性检查则使用继承成员关系。这些路径组合后可能静默丢失或误判合法配置 key。

复现观察到的是局部对象原型变化和数据丢失；它没有修改全局 `Object.prototype`，也不能证明代码执行。

## Decision

动态 JSON key 统一通过 `Object.defineProperty` 写成 enumerable、configurable、writable 的 own data property。合并和相等判断改用 `Object.hasOwn`，不再查询继承成员。脱敏器复制未知 object 字段、已声明字段和 dictionary entry 时采用同一规则。普通对象仍保留 `Object.prototype`，特殊属性名则保持为普通 own value。

## Alternatives considered

**拒绝特殊属性名。** JSON 允许这些字符串，settings schema 也可能合法建模任意 dictionary；拒绝会把实现错误变成没有必要的格式限制。

**全面使用 null-prototype 对象。** 这可以避开遗留 setter，但会改变交给 schema、provider、插件和相等判断使用方的对象形态。定义 own data property 能保留现有普通对象契约。

**只修写入克隆。** 已保留的 key 仍会在分层合并或 wire 脱敏中丢失，继承成员关系也仍可能产生错误相等结果。该不变量必须覆盖包内每个动态属性重建点。

## Consequences

合法 JSON 属性名可以经 update 和脱敏 descriptor 往返，而不改变中间对象原型。own-property 检查不再把继承的内建属性误认为文档数据。修复只涉及对象构造与成员关系语义；schema、provider 格式和公开 settings API 均未改变。回归固定了 update 持久化、object/dict 脱敏、普通原型和继承 key 相等判断。
