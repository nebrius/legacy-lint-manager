import { dirname } from 'node:path';

import { ConfigArray } from '@eslint/config-array';
import TypeBox from 'typebox';
import Value from 'typebox/value';

const ruleSchema = TypeBox.Object({
  rules: TypeBox.Record(TypeBox.String(), TypeBox.Unknown()),
});

export async function getEslintRules(configFile: string) {
  const rawConfigs = ((await import(configFile)) as { default: unknown })
    .default;

  const configs = new ConfigArray(rawConfigs, {
    basePath: dirname(configFile),
  });
  await configs.normalize();

  const rules = new Set<string>();
  for (const config of configs) {
    // Cast from any to unknown so we can properly narrow it (any is viral and
    // never gets narrowed)
    const unknownConfig = config as unknown;
    if (Value.Check(ruleSchema, unknownConfig)) {
      for (const rule of Object.keys(unknownConfig.rules)) {
        rules.add(rule);
      }
    }
  }
  return Array.from(rules);
}
