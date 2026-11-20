#!/usr/bin/env node
// Single entrypoint: `bridge <command> [options]`.
//
// Each command is just a module that reads its own flags, so this only
// resolves the module and hands the remaining argv through unchanged.
const COMMANDS = {
  pair: { module: './service/pair.mjs' },
  login: { module: './service/auth.mjs', inject: ['--login'] },
  doctor: { module: './service/doctor.mjs' },
  'rules-check': { module: './service/rules-check.mjs' },
  start: { module: './service/index.mjs' },
};

const [name, ...rest] = process.argv.slice(2);
const command = COMMANDS[name?.replace(/^--/, '')];

if (!command) {
  console.log('usage: bridge <command> [options]\n');
  console.log('  pair [--rotate]   show the pairing QR; --rotate replaces the shared key');
  console.log('  login             sign in to Firebase as you');
  console.log('  doctor            check configuration and connectivity');
  console.log('  rules-check       prove the database rules deny what they should');
  console.log('  start [--once]    run the bridge service');
  process.exit(name ? 1 : 0);
}

const target = new URL(command.module, import.meta.url).pathname;
// Each module guards on `import.meta.url === file://${process.argv[1]}`, so
// argv[1] must name the module being run.
process.argv = [process.argv[0], target, ...(command.inject ?? []), ...rest];
await import(target);
