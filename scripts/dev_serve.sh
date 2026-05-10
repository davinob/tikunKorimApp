#!/usr/bin/env bash
# Serve assets/html/ over HTTP so the WebView's fetch() works in a desktop browser too.
# Usage:  bash scripts/dev_serve.sh
# Then open http://127.0.0.1:8000/

set -euo pipefail
cd "$(dirname "$0")/.."
echo "Serving $(pwd)/assets/html on http://127.0.0.1:8000"
exec python3 -m http.server 8000 --bind 127.0.0.1 --directory assets/html
