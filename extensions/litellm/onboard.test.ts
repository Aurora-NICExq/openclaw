// Litellm tests cover onboard plugin behavior.
import { expectProviderOnboardMergedLegacyConfig } from "openclaw/plugin-sdk/provider-test-contracts";
import { describe, expect, it } from "vitest";
import { applyLitellmProviderConfig } from "./onboard.js";

describe("litellm onboard", () => {
  it("preserves an explicit proxy's authored models, base URL, and API key", () => {
    const provider = expectProviderOnboardMergedLegacyConfig({
      applyProviderConfig: applyLitellmProviderConfig,
      providerId: "litellm",
      providerApi: "openai-completions",
      baseUrl: "https://litellm.example/v1",
      legacyApi: "anthropic-messages",
      legacyModelId: "custom-model",
      legacyModelName: "Custom",
      legacyBaseUrl: "https://litellm.example/v1",
      legacyApiKey: "  old-key  ",
    });

    expect(provider?.models.map((m) => m.id)).toEqual(["custom-model"]);
  });
});
