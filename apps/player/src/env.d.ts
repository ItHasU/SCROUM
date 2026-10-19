/** Variables d'environnement Vite utilisées par le player. */
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.css' {}
