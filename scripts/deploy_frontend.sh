#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="$ROOT/terraform"
FRONT="$ROOT/frontend"

BUCKET="$(
  terraform -chdir="$TF" \
    output -raw frontend_bucket_name
)"

API="$(
  terraform -chdir="$TF" \
    output -raw api_url
)"

DIST="$(
  terraform -chdir="$TF" \
    output -raw cloudfront_distribution_id
)"

cat > "$FRONT/config.js" <<CONFIG
window.APP_CONFIG = {
  apiUrl: "$API"
};
CONFIG

aws s3 sync \
  "$FRONT/" \
  "s3://$BUCKET/" \
  --delete

aws cloudfront create-invalidation \
  --distribution-id "$DIST" \
  --paths "/*"

echo
echo "Frontend deployed."
echo
terraform -chdir="$TF" output cloudfront_url
