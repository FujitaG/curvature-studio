/** English is the only released UI language. Keep message keys and interpolation
 * centralized so additional locales can be introduced later. Legacy browser
 * language preferences intentionally do not affect the current UI.
 */
export function t(key: string, values: Record<string, string | number> = {}): string {
  return key.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
