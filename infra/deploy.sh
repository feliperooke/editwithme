#!/usr/bin/env bash
# Build the container, push it to Artifact Registry and roll out via
# Terraform. Run from the repo root: ./infra/deploy.sh
#
# Set PROJECT/REGION/BUCKET for your GCP project (or export them first).
set -euo pipefail

PROJECT="${PROJECT:-your-gcp-project-id}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-your-unique-bucket-name}"
REPO="editwithme-registry"
TAG="$(git rev-parse --short HEAD)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/web:${TAG}"

echo "==> Building ${IMAGE} on Cloud Build (native amd64 — local
#     emulated builds crash Node under QEMU on Apple Silicon)"
gcloud builds submit --project "${PROJECT}" --region "${REGION}" --tag "${IMAGE}" .

echo "==> Applying Terraform"
cd "$(dirname "$0")"
terraform apply \
  -var "project_id=${PROJECT}" \
  -var "bucket_name=${BUCKET}" \
  -var "image=${IMAGE}"

terraform output app_url
