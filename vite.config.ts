import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

type DeploymentEnvironment = "development" | "production";

const defaultBasePath = (
  environment: DeploymentEnvironment,
  command: string,
  isPreview: boolean | undefined,
) =>
  environment === "production" && (command === "build" || isPreview) ? "/DoongDoong/" : "/";

const defaultPublicUrl = (environment: DeploymentEnvironment, basePath: string) =>
  environment === "production"
    ? `https://sorryrlrud.github.io${basePath}`
    : `http://localhost:5173${basePath}`;

const normalizeBasePath = (value: string): string => {
  if (!value.startsWith("/") || !value.endsWith("/") || value.includes("//")) {
    throw new Error("VITE_BASE_PATH must start and end with '/' and cannot contain '//'.");
  }
  return value;
};

const normalizePublicUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString();
};

export default defineConfig(({ command, isPreview, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const deploymentEnvironment = (
    env.VITE_DEPLOYMENT_ENV ?? (mode === "development" ? "development" : "production")
  ) as DeploymentEnvironment;
  if (!(["development", "production"] as const).includes(deploymentEnvironment)) {
    throw new Error("VITE_DEPLOYMENT_ENV must be 'development' or 'production'.");
  }

  const basePath = normalizeBasePath(
    env.VITE_BASE_PATH ?? defaultBasePath(deploymentEnvironment, command, isPreview),
  );
  const publicUrl = normalizePublicUrl(
    env.VITE_PUBLIC_APP_URL ?? defaultPublicUrl(deploymentEnvironment, basePath),
  );

  return {
    base: basePath,
    define: {
      "import.meta.env.VITE_DEPLOYMENT_ENV": JSON.stringify(deploymentEnvironment),
    },
    plugins: [
      react(),
      {
        name: "doongdoong-deployment-html",
        transformIndexHtml(html) {
          return html.replaceAll("__DOONGDOONG_PUBLIC_URL__", publicUrl);
        },
      },
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
  };
});
