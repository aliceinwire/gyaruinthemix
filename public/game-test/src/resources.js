/** Bounded art loading shared by title and route departure. */
import { preloadScenery, isSceneryReady } from "./scenery.js";
import { getDistrictScene, preloadDistrictArt } from "./district-art.js";
import { preloadSprites } from "./renderer.js";
import { preloadCampaign } from "./campaign.js";
export async function prepareRouteArt({
  cityId,
  locationIndex = 0,
  season = "summer",
}) {
  await Promise.all([
    preloadScenery([cityId]),
    preloadDistrictArt(cityId, locationIndex, season),
  ]);
  if (
    !getDistrictScene(cityId, locationIndex) &&
    !isSceneryReady(cityId, season)
  )
    throw new Error(`City art unavailable: ${cityId}/${season}`);
}
export async function prepareGameArt(state) {
  await Promise.all([
    prepareRouteArt({
      cityId: state.route.cityId,
      locationIndex: state.locationIndex,
      season: state.season,
    }),
    preloadSprites(),
    preloadCampaign(),
  ]);
}
