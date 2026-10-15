import { defineConfig } from "vitest/config";

// base "./" gera assets com caminho relativo: funciona em https://<user>.github.io/Reviva/ sem configurar o nome do repo.
export default defineConfig({
  base: "./",
  build: {
    // three.js sozinho tem ~600 kB minificado e é todo necessário no boot: dividir não reduz o tempo até jogar.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
