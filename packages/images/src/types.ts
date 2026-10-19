/** Abstraction de génération d'images (SPEC §7.1). */

export type Params = Record<string, string | number | boolean>;

/** Un résultat de génération. */
export interface Candidate {
  /** Octets de l'image (PNG pour ComfyUI). */
  data: Uint8Array;
  ext: string;
  seed: number;
  workflow: string;
  /** Prompt effectivement envoyé. */
  prompt: string;
  negative?: string;
  width?: number;
  height?: number;
  /** Modèles résolus (`unet`, `clip`, `vae`, `checkpoint`…). */
  model?: string;
  references?: string[];
}

export interface Progress {
  /** Index du candidat en cours (0-based) et total. */
  index: number;
  total: number;
  /** Étape d'échantillonnage (0..max) si connue. */
  value?: number;
  max?: number;
  phase: 'upload' | 'queued' | 'running' | 'fetching' | 'done';
}

export interface RunOptions {
  /** Nombre de candidats (défaut 1). Les graines sont `seed`, `seed+1`… */
  n?: number;
  onProgress?: (p: Progress) => void;
  onCandidate?: (c: Candidate, index: number) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface GenerateRequest {
  prompt: string;
  negative?: string;
  width: number;
  height: number;
  seed?: number;
  workflow: string;
  params?: Record<string, unknown>;
  /** Chemins locaux d'images de référence (workflows qui en utilisent). */
  references?: string[];
}

export interface EditRequest {
  /** Chemins locaux des images de référence (`{{ref_image_1}}`…). */
  references: string[];
  instruction: string;
  negative?: string;
  workflow: string;
  seed?: number;
  width?: number;
  height?: number;
  params?: Record<string, unknown>;
}

export interface ImageProvider {
  generate(req: GenerateRequest, opts?: RunOptions): Promise<Candidate[]>;
  edit(req: EditRequest, opts?: RunOptions): Promise<Candidate[]>;
}

export type ImageErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'workflow_not_found'
  | 'workflow_invalid'
  | 'missing_param'
  | 'unknown_node'
  | 'unknown_model'
  | 'rejected'
  | 'execution'
  | 'no_output'
  | 'aborted';

export class ImageError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}
