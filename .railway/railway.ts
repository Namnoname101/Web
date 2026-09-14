import {
  defineRailway,
  postgres,
  preserve,
  project,
  service,
} from "railway/iac";

/**
 * Railway's project-level Infrastructure-as-Code definition.
 *
 * Secrets intentionally use preserve(): set them in Railway before the first
 * deployment and this file will never copy their values into source control.
 * The repository source/domain remain account-owned settings because neither
 * identifier is known until the project owner connects the deployment.
 */
export default defineRailway(() => {
  const database = postgres("PostgreSQL");

  const application = service("Personal Schedule", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    start: "node apps/api/dist/server.js",
    preDeploy: "npm run db:deploy",
    healthcheck: "/api/v1/ready",
    healthcheckTimeout: 120,
    replicas: 1,
    env: {
      DATABASE_URL: database.env.DATABASE_URL,
      NODE_ENV: "production",
      WORKER_ENABLED: "true",
      TRUST_PROXY_HOPS: "1",
      WEB_ORIGIN: preserve(),
      ENCRYPTION_KEY: preserve(),
      MICROSOFT_CLIENT_ID: preserve(),
      MICROSOFT_CLIENT_SECRET: preserve(),
      MICROSOFT_TENANT_ID: preserve(),
      MICROSOFT_REDIRECT_URI: preserve(),
      MICROSOFT_ALLOWED_EMAIL_DOMAINS: preserve(),
    },
  });

  return project("Personal Automated Schedule", {
    resources: [database, application],
  });
});
