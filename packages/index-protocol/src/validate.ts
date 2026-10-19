import { readdirSync, readFileSync } from 'node:fs';

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import type { SchemaDocuments, SchemaName } from './types.ts';

/** Base of every schema `$id`: `${schemaBaseUrl}<name>.schema.json`. */
export const schemaBaseUrl = 'https://gotalk.sh/schemas/index/v1/';
export const schemasDir = new URL('../schemas/', import.meta.url);

export const schemaNames: readonly SchemaName[] = [
  'common',
  'directory',
  'well-known',
  'places-page',
  'board-topics-page',
  'topic',
  'event',
  'changes-page',
  'problem',
  'ping-request',
  'registration-request',
  'registration-response',
  'instance-status',
];

export function schemaId(name: SchemaName): string {
  return `${schemaBaseUrl}${name}.schema.json`;
}

export function isSchemaName(name: string): name is SchemaName {
  return (schemaNames as readonly string[]).includes(name);
}

/** Reads every schema file, keyed by schema name. */
export function loadSchemas(): Map<SchemaName, Record<string, unknown>> {
  const schemas = new Map<SchemaName, Record<string, unknown>>();
  for (const file of readdirSync(schemasDir)) {
    const name = file.replace(/\.schema\.json$/, '');
    if (name === file || !isSchemaName(name)) throw new Error(`unexpected file in schemas/: ${file}`);
    schemas.set(name, JSON.parse(readFileSync(new URL(file, schemasDir), 'utf8')) as Record<string, unknown>);
  }
  for (const name of schemaNames) if (!schemas.has(name)) throw new Error(`missing schema: ${name}`);
  return schemas;
}

// ajv-formats is CommonJS: under Node's ESM interop the default import is `module.exports`, whose `default`
// is the plugin.
const addFormats = addFormatsModule.default;

let ajv: Ajv2020 | undefined;
const compiled = new Map<SchemaName, ValidateFunction>();

function instance(): Ajv2020 {
  if (ajv) return ajv;
  const created = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  addFormats(created);
  for (const schema of loadSchemas().values()) created.addSchema(schema);
  ajv = created;
  return created;
}

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

/** Validates `data` against a schema by name, for example `validate('places-page', body)`. */
export function validate(name: SchemaName, data: unknown): ValidationResult {
  let fn = compiled.get(name);
  if (!fn) {
    const found = instance().getSchema(schemaId(name));
    if (!found) throw new Error(`unknown schema: ${name}`);
    fn = found;
    compiled.set(name, fn);
  }
  const valid = fn(data);
  return { valid, errors: valid ? [] : [...(fn.errors ?? [])] };
}

/** Renders Ajv errors as one line each: `/items/0/author must NOT have additional properties (email)`. */
export function formatErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => {
      const extra =
        e.keyword === 'additionalProperties'
          ? ` (${(e.params as { additionalProperty: string }).additionalProperty})`
          : '';
      return `${e.instancePath || '/'} ${e.message ?? e.keyword}${extra}`;
    })
    .join('\n');
}

export class SchemaValidationError extends Error {
  readonly schema: SchemaName;
  readonly errors: ErrorObject[];

  constructor(schema: SchemaName, errors: ErrorObject[]) {
    super(`document does not match ${schema}:\n${formatErrors(errors)}`);
    this.name = 'SchemaValidationError';
    this.schema = schema;
    this.errors = errors;
  }
}

/** Throws a SchemaValidationError unless `data` matches the schema. */
export function assertValid<N extends SchemaName>(
  name: N,
  data: unknown,
): asserts data is SchemaDocuments[N] {
  const result = validate(name, data);
  if (!result.valid) throw new SchemaValidationError(name, result.errors);
}
