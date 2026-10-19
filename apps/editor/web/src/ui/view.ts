/** Contrat commun des vues de la zone centrale. */
export interface View {
  el: HTMLElement;
  /** Données du jeu, sélection ou validation modifiées. */
  update(): void;
  /** La vue vient d'être affichée. */
  onShow?(): void;
}
