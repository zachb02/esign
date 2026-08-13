#!/usr/bin/env bash
set -euo pipefail

createdb esign_app 2>/dev/null || echo "esign_app already exists"
createdb esign_app_test 2>/dev/null || echo "esign_app_test already exists"

echo "Databases ready: esign_app, esign_app_test"
