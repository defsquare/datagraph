import type { DataGraph, DataGraphConfig } from "@defsquare/data-graph";
import { shopData, shopConfig, bigShop, bigShopConfig } from "./sample-data";

// Tout ce qui n'existe QU'EN MODE DÉMO — le jeu d'exemple, son générateur et la
// bascule petit/grand jeu — vit ici, et ce module n'est atteint que par l'import
// dynamique de `main.ts`. C'est ce qui garantit qu'en mode fichier
// (`datagraph data.json`) `sample-data.ts` n'est ni téléchargé ni évalué : son
// générateur y fabriquerait ~4000 nœuds dont personne n'a besoin.

/** Le jeu du chargement initial de la démo. */
export const demoDataset: { data: unknown; config: DataGraphConfig } = {
  data: shopData,
  config: shopConfig,
};

// Le grand jeu est généré À LA DEMANDE, au premier clic, puis mémorisé : le
// construire au chargement du module coûterait ~4000 nœuds à chaque démarrage,
// y compris aux visites qui ne toucheront jamais la bascule. `bigShop` est
// déterministe, donc la mémorisation ne fait qu'éviter un recalcul identique.
let bigShopData: ReturnType<typeof bigShop> | undefined;

function bigDataset(): ReturnType<typeof bigShop> {
  bigShopData ??= bigShop(4000);
  return bigShopData;
}

/**
 * Bascule de jeu de données : exerce `setData()` avec le petit `shopData` face
 * à un `bigShop(4000)` généré (4061 nœuds logiques exactement : 78 clients, 234
 * commandes, 30 produits, 8 catégories — 350 entités).
 *
 * La config est passée EXPLICITEMENT dans les deux sens : le petit jeu déclare
 * `reviews[*].customerId`, que le grand — sans reviews — ne peut pas
 * satisfaire, et réutiliser la même config afficherait un
 * `unresolved-reference` légitime mais déroutant dans la barre d'état. Le
 * chemin « setData(data) sans config réutilise la config courante » n'est donc
 * plus exercé ici ; il l'est par un test e2e dédié (smoke.spec.ts).
 *
 * `onSwapped` remet l'interface hôte (recherche, panneau, barre d'état) en
 * phase avec l'état que `setData()` vient de réinitialiser côté renderer.
 */
export function setupDatasetToggle(graph: DataGraph, onSwapped: () => void): void {
  const toggleDatasetBtn = document.getElementById("toggle-dataset") as HTMLButtonElement | null;
  if (!toggleDatasetBtn) return;

  let usingBigDataset = false;

  toggleDatasetBtn.addEventListener("click", () => {
    void (async () => {
      toggleDatasetBtn.disabled = true;
      try {
        usingBigDataset = !usingBigDataset;
        await graph.setData(
          usingBigDataset ? bigDataset() : shopData,
          usingBigDataset ? bigShopConfig : shopConfig,
        );
        toggleDatasetBtn.textContent = usingBigDataset ? "Jeu de données réduit" : "Jeu de données étendu (4000)";
        onSwapped();
      } finally {
        toggleDatasetBtn.disabled = false;
      }
    })();
  });
}
