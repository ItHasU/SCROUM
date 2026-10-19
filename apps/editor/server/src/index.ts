/**
 * Serveur local de l'éditeur SCROUM : API REST sur `content/`, SSE `/events`,
 * `GET /api/game.json`, build du zip, Claude Code, player sous `/play/`.
 */
export { startEditorServer, type EditorServer, type EditorServerOptions } from './server';
export { FORMAT_DOC, buildSystemPrompt, validatedElements } from './claude';
