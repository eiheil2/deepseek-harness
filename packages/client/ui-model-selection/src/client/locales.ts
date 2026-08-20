/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型、推理等级与输入能力',
  'menu.model': '模型',
  'menu.effort': 'Change reasoning effort',
  'menu.input': '接受输入',
  'input.text': '文字',
  'input.vision': '文字与图片',
  'input.unknown': '未声明',
  'input.visionRequired': '需要文字与图片',
  'input.imageModelRequired': '当前草稿含图片，需要支持图片的模型',
  'effort.providerDefault': 'Default',
  'effort.unavailable': 'Not declared',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model, reasoning effort, and accepted input',
  'menu.model': 'Model',
  'menu.effort': 'Change reasoning effort',
  'menu.input': 'Accepted input',
  'input.text': 'Text',
  'input.vision': 'Text and images',
  'input.unknown': 'Not declared',
  'input.visionRequired': 'Text and images required',
  'input.imageModelRequired': 'The draft contains an image; choose an image-capable model',
  'effort.providerDefault': 'Default',
  'effort.unavailable': 'Not declared',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>
