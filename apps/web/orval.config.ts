import { defineConfig } from "orval";

export default defineConfig({
  htmlEditor: {
    input: "./openapi.yaml",
    output: {
      target: "./src/api/generated/endpoints.ts",
      schemas: "./src/api/generated/model",
      client: "react-query",
      httpClient: "fetch",
      baseUrl: "/api",
      override: {
        mutator: {
          path: "./src/api/fetcher.ts",
          name: "customFetch",
        },
      },
    },
  },
});
