---
name: cloudflare-static-page
description: Create and deploy a static HTML page to Cloudflare Pages. Use when asked to create, deploy, or publish a static page, site, or HTML to Cloudflare.
---

Deploy a static page to Cloudflare Pages using wrangler.

## Steps

1. **Collect inputs** — ask for (or infer from context):
   - Project name (kebab-case, e.g. `my-site`) — becomes `<name>.pages.dev`
   - Page content — HTML string, file path, or description to generate

2. **Set up the token**

```bash
export CLOUDFLARE_API_TOKEN=<your-cloudflare-api-token>
```

3. **Create the page files**

```bash
mkdir -p /tmp/<PROJECT_NAME>
cat > /tmp/<PROJECT_NAME>/index.html << 'EOF'
<HTML_CONTENT>
EOF
```

4. **Deploy with wrangler**

```bash
npx wrangler pages deploy /tmp/<PROJECT_NAME> --project-name <PROJECT_NAME> --branch main
```

Wrangler creates the project automatically if it doesn't exist.

5. **Report the result** — the deployment URL is printed by wrangler:
   - Preview URL: `https://<hash>.<PROJECT_NAME>.pages.dev`
   - Production URL: `https://<PROJECT_NAME>.pages.dev` (after first deploy)

## Notes

- Multiple files (CSS, JS, images) are supported — just add them to the directory
- Re-running the deploy command creates a new deployment; the production URL stays stable
- Account ID: `efde4535147d1f57932ffa014132c731`
- Pages projects are free with no usage limits for static content
