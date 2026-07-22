output "app_url" {
  value       = google_cloud_run_v2_service.web.uri
  description = "Public URL of the application"
}

output "bucket" {
  value = google_storage_bucket.docs.name
}

output "image_repo" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
  description = "Push images here (see deploy.sh)"
}

# DNS records to add at the registrar for each mapped custom domain
output "domain_dns_records" {
  value = {
    for domain, mapping in google_cloud_run_domain_mapping.custom :
    domain => mapping.status[0].resource_records
  }
  description = "Add these records at the domain registrar (Hostinger)"
}
