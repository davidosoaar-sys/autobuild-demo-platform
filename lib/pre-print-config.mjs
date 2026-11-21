import { createProfileStore } from './pre-print-store.mjs';
export const DEFAULT_RESEARCH_MODEL = 'gpt-5.4-mini';

// Report local configuration only. Never call the paid provider or return env values.
export async function prePrintConfiguration(env, local = true) {
  const key = !!env.AUTOBUILD_RESEARCH_OPENAI_KEY?.trim();
  const model = !!env.AUTOBUILD_RESEARCH_MODEL?.trim();
  const research = key ? 'configured-unverified' : (model ? 'missing-key' : 'not-configured');
  let catalog = 'browser-only';
  if (local && env.AUTOBUILD_PROFILE_STORE_PATH) {
    try {
      await createProfileStore(env.AUTOBUILD_PROFILE_STORE_PATH).checkConfiguration();
      catalog = 'local-server';
    } catch { catalog = 'unavailable'; }
  }
  return {research, catalog};
}
