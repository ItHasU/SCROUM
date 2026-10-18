import type { ResolvedProject } from '@scroum/build';

export interface EditorServerOptions {
  project: ResolvedProject;
  port?: number;
  host?: string;
}

export interface EditorServer {
  url: string;
  close(): Promise<void>;
}

export async function startEditorServer(_options: EditorServerOptions): Promise<EditorServer> {
  throw new Error('serveur de l’éditeur : en cours d’implémentation');
}
