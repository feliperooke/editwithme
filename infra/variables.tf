variable "project_id" {
  type        = string
  description = "GCP project id"
}

variable "region" {
  type        = string
  description = "Region for all resources"
  default     = "us-central1"
}

variable "bucket_name" {
  type        = string
  description = "Globally-unique GCS bucket for documents"
}

variable "image" {
  type        = string
  description = "Container image for the app (Artifact Registry URL)"
  # Placeholder so the service can be created before the first push
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "cloudflare_turn_key_id" {
  type        = string
  description = "Cloudflare Realtime TURN key id (empty = STUN-only)"
  default     = ""
}

variable "cloudflare_turn_api_token" {
  type        = string
  description = "Cloudflare Realtime TURN API token (empty = STUN-only)"
  default     = ""
  sensitive   = true
}

variable "workspace_password" {
  type        = string
  description = "Unused in the open-source build (kept so legacy tfvars files still parse)"
  default     = ""
  sensitive   = true
}

variable "app_public_url" {
  type        = string
  description = "Public URL of the app (used in links produced by the MCP tools). Empty = relative links; set after the first deploy reveals the Cloud Run URL."
  default     = ""
}

variable "custom_domains" {
  type        = list(string)
  description = "Custom domains to map to the Cloud Run service (must be verified for the deploying account). Empty = no mapping."
  default     = []
}
