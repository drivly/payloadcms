'use server'

import JSON5 from 'json5'
import yaml from 'yaml'

export function stringifyData(
  data: unknown,
  format: 'json' | 'json5' | 'yaml' = 'json',
): Promise<string> {
  try {
    if (format === 'yaml') {
      return Promise.resolve(yaml.stringify(data))
    } else if (format === 'json5') {
      return Promise.resolve(JSON5.stringify(data, null, 2))
    }
    return Promise.resolve(JSON.stringify(data, null, 2))
  } catch (error) {
    return Promise.resolve(JSON.stringify(data, null, 2))
  }
}

export function parseData(
  text: string,
  format: 'json' | 'json5' | 'yaml' = 'json',
): Promise<unknown> {
  try {
    if (format === 'yaml') {
      return Promise.resolve(yaml.parse(text))
    } else if (format === 'json5') {
      return Promise.resolve(JSON5.parse(text))
    }
    return Promise.resolve(JSON.parse(text))
  } catch (error) {
    throw new Error(`Error parsing ${format}: ${error.message}`)
  }
}
