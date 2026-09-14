import { config as loadEnvironment } from "dotenv";
import { fileURLToPath } from "node:url";

import { defineConfig, env } from "prisma/config";

loadEnvironment({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
