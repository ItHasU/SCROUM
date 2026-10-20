import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOWS_DIR, loadWorkflow } from '@scroum/images';
import { exportGraph } from './workflow-export';

describe('workflow-export', () => {
  for (const name of ['bg', 'char_sheet', 'char_edit', 'transform', 'remove_bg', 'item_icon']) {
    it(`${name} : plus aucun placeholder, nombres typés`, async () => {
      const wf = await loadWorkflow(name, [BUILTIN_WORKFLOWS_DIR]);
      const out = exportGraph(wf.graph, (wf.meta.defaults ?? {}) as Record<string, unknown>, {}, name);
      const json = JSON.stringify(out);
      expect(json).not.toContain('{{');
      expect(json).not.toContain('_scroum');
    });
  }

  it('les modèles du projet priment sur les exemples', async () => {
    const wf = await loadWorkflow('bg', [BUILTIN_WORKFLOWS_DIR]);
    const out = exportGraph(wf.graph, {}, { unet: 'mon_modele.safetensors' }, 'bg');
    expect(JSON.stringify(out)).toContain('mon_modele.safetensors');
    expect(JSON.stringify(out)).toContain('"width":1280');
  });
});
