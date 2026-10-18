#!/usr/bin/env node
// Lanceur du binaire `scroum` : enregistre tsx pour exécuter directement les
// sources TypeScript (paquets « source-first », pas d'étape de build).
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../src/index.ts');
process.exitCode = await main(process.argv.slice(2));
