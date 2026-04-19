import { SceneOpening } from "./scene/scenes/scene-01-opening";
import { SceneMonday } from "./scene/scenes/scene-02-monday";
import { SceneScore } from "./scene/scenes/scene-03-score";
import { SceneScribe } from "./scene/scenes/scene-04-scribe";
import { SceneAi } from "./scene/scenes/scene-05-ai";
import { SceneReviews } from "./scene/scenes/scene-06-reviews";
import { SceneSpine } from "./scene/scenes/scene-07-spine";
import { SceneKudos } from "./scene/scenes/scene-08-kudos";
import { SceneModules } from "./scene/scenes/scene-09-modules";
import { SceneIndustries } from "./scene/scenes/scene-10-industries";
import { SceneCompliance } from "./scene/scenes/scene-11-compliance";
import { ScenePricing } from "./scene/scenes/scene-13-pricing";
import { SceneCta } from "./scene/scenes/scene-14-cta";

export function LandingPage() {
  return (
    <>
      <SceneOpening />
      <SceneMonday />
      <SceneScore />
      <SceneScribe />
      <SceneAi />
      <SceneReviews />
      <SceneSpine />
      <SceneKudos />
      <SceneModules />
      <SceneIndustries />
      <SceneCompliance />
      <ScenePricing />
      <SceneCta />
    </>
  );
}
