terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  # Some APIs (apikeys) demand an explicit quota project with user ADC
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
  # Firebase management APIs require a quota project with user creds
  user_project_override = true
  billing_project       = var.project_id
}

# ---------------------------------------------------------------------------
# APIs

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "cloudbuild.googleapis.com",
    "firebaserules.googleapis.com",
    "apikeys.googleapis.com",
    "iam.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Document storage: the GCS bucket behind STORAGE_DRIVER=objects

resource "google_storage_bucket" "docs" {
  name                        = var.bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  # Free time-travel for snapshots/metadata
  versioning {
    enabled = true
  }

  # Signaling mailbox entries are ephemeral by design; anything older
  # than a day is garbage
  lifecycle_rule {
    condition {
      age            = 1
      matches_prefix = ["signaling/"]
    }
    action {
      type = "Delete"
    }
  }

  # Keep object history bounded
  lifecycle_rule {
    condition {
      num_newer_versions = 10
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }
}

# ---------------------------------------------------------------------------
# Container registry

resource "google_artifact_registry_repository" "repo" {
  repository_id = "editwithme-registry"
  location      = var.region
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

data "google_project" "project" {}

# Cloud Run's service agent pulls images from the registry; on fresh
# projects the implicit grant can lag, so make it explicit
resource "google_artifact_registry_repository_iam_member" "run_agent_reader" {
  repository = google_artifact_registry_repository.repo.repository_id
  location   = var.region
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.project.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# ---------------------------------------------------------------------------
# Runtime identity: dedicated SA whose ONLY power is the docs bucket
# (part of the SSRF mitigation — a leaked metadata token grants little)

resource "google_service_account" "run" {
  account_id   = "editwithme-run"
  display_name = "EditWithMe Cloud Run runtime"
}

resource "google_storage_bucket_iam_member" "run_bucket" {
  bucket = google_storage_bucket.docs.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.run.email}"
}

# ---------------------------------------------------------------------------
# Firestore (native): the low-latency signaling transport

resource "google_firestore_database" "db" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}

resource "google_project_iam_member" "run_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Browser API key for the Firestore JS SDK (restricted to the Firestore
# API — no Firebase project registration needed; access control is done
# by the security rules, the key only attributes quota)
resource "google_apikeys_key" "signaling" {
  name         = "editwithme-signaling"
  display_name = "editwithme signaling (Firestore JS SDK)"
  restrictions {
    api_targets {
      service = "firestore.googleapis.com"
    }
  }
  depends_on = [google_project_service.apis]
}

# Security rules: only the signaling mailbox is client-accessible
# (payloads are edit-key-encrypted; everything expires via TTL)
resource "google_firebaserules_ruleset" "firestore" {
  provider = google-beta
  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/firestore.rules")
    }
  }
  depends_on = [google_firestore_database.db]
}

resource "google_firebaserules_release" "firestore" {
  provider     = google-beta
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
}

# Firestore TTL: signaling documents self-destruct
resource "google_firestore_field" "peers_ttl" {
  database   = google_firestore_database.db.name
  collection = "peers"
  field      = "expireAt"
  ttl_config {}
}

resource "google_firestore_field" "messages_ttl" {
  database   = google_firestore_database.db.name
  collection = "messages"
  field      = "expireAt"
  ttl_config {}
}

# ---------------------------------------------------------------------------
# The application: one Cloud Run service, scale-to-zero

resource "google_cloud_run_v2_service" "web" {
  name     = "editwithme-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.run.email

    scaling {
      min_instance_count = 0
      # Single writer: SQLite-free, but compaction/index assumptions and
      # cost control favor one instance until real scale demands more
      max_instance_count = 1
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          # Headless Chromium (PDF/thumbnails) needs the headroom
          memory = "2Gi"
        }
        cpu_idle = true
      }

      env {
        name  = "STORAGE_DRIVER"
        value = "objects"
      }
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.docs.name
      }
      env {
        name  = "CLOUDFLARE_TURN_KEY_ID"
        value = var.cloudflare_turn_key_id
      }
      env {
        name  = "CLOUDFLARE_TURN_API_TOKEN"
        value = var.cloudflare_turn_api_token
      }
      env {
        name  = "FIREBASE_API_KEY"
        value = google_apikeys_key.signaling.key_string
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "APP_PUBLIC_URL"
        value = var.app_public_url
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# Public app: capability links are the access model
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Custom domain mappings (free; Google auto-provisions and renews the SSL
# cert). Each domain must be verified for the deploying account first
# (Search Console). The DNS records to add at the registrar are exposed
# via the `domain_dns_records` output.

resource "google_cloud_run_domain_mapping" "custom" {
  for_each = toset(var.custom_domains)
  name     = each.value
  location = var.region
  metadata {
    namespace = var.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.web.name
  }
}
