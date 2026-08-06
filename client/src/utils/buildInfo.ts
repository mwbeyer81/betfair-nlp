import { Platform } from "react-native";

// `apps/web/deploy.sh` stamps <meta name="build-commit" content="<sha>"> (and
// build-branch) into dist/index.html as the last step before uploading to S3.
// Reading that tag back at runtime means the badge always shows the commit
// that was actually deployed, without the bundle itself having to be rebuilt
// with the SHA baked in — nothing in the build pipeline changes to keep this
// honest. Returns null off-web and in local dev builds, where nothing stamps
// index.html and there is no commit to show.
export function getBuildCommit(): string | null {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const content = document
    .querySelector('meta[name="build-commit"]')
    ?.getAttribute("content")
    ?.trim();
  return content ? content : null;
}
