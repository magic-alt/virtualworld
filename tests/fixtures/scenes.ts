import { assembleWorld } from '@virtualworld/scene-builder';
import scene from './industrial/scene.json';
import story from './industrial/story.json';
import assets from './industrial/assets.json';
import worldScene from './world/scene.json';
import worldStory from './world/story.json';
import worldAssets from './world/assets.json';

/** Test-only geometry for edit/CAD/provider regressions; never part of the product catalog. */
export function industrialDemo() {
  return assembleWorld(scene, story, assets);
}
export function worldDemo() {
  return assembleWorld(worldScene, worldStory, worldAssets);
}
