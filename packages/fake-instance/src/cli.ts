#!/usr/bin/env node
// Starts a fake Gotalk instance and prints its origin. Node runs this file directly (type stripping):
//   node packages/fake-instance/src/cli.ts --port 8787 [--control] [--coalesce] [--public-origin URL]
import { parseArgs } from 'node:util';

import { createFakeInstance } from './server.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '0' },
    host: { type: 'string', default: '127.0.0.1' },
    'public-origin': { type: 'string' },
    seed: { type: 'string' },
    control: { type: 'boolean', default: false },
    coalesce: { type: 'boolean', default: false },
    unlisted: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`Usage: node packages/fake-instance/src/cli.ts [options]

  --port N               Port to listen on (default: a free port)
  --host ADDR            Address to bind (default 127.0.0.1)
  --public-origin URL    Origin to advertise, if it differs from the listening address
  --seed B64URL          32-byte Ed25519 seed for directory.keys (default: the signing vector's seed)
  --control              Serve /__fake/* routes to drive mutations and faults over HTTP
  --coalesce             Coalesce feed events per object
  --unlisted             Start with directory.listed false`);
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid --port: ${values.port}`);
  process.exit(2);
}

const fake = await createFakeInstance({
  port,
  host: values.host,
  control: values.control,
  coalesce: values.coalesce,
  ...(values['public-origin'] ? { publicOrigin: values['public-origin'] } : {}),
  ...(values.seed ? { seed: values.seed } : {}),
});
if (values.unlisted) fake.setListed(false);

console.log(fake.origin);
console.error(`fake Gotalk instance listening on ${fake.url}
  well-known  ${fake.wellKnownUrl}
  index       ${fake.indexUrl}
  ping key    ${fake.publicKey}${values.control ? `\n  control     ${fake.url}/__fake/state, POST /__fake/call, POST /__fake/faults` : ''}`);

const stop = () => {
  fake.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
