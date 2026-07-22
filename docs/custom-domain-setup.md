# Custom domain setup — editwith.me

Points `editwith.me` (root) and `www.editwith.me` at the EditWithMe
Cloud Run service (`editwithme-web`, project `editwithme`, region
`us-central1`). The Cloud Run domain mappings are already created via
Terraform (`google_cloud_run_domain_mapping.custom`); what remains is
adding the DNS records at the registrar (**Hostinger**).

## DNS records to add (Hostinger)

hPanel → Domains → `editwith.me` → DNS / Nameservers → **Manage DNS records**.

### `www.editwith.me` — 1 record

| Type  | Name  | Value                   | TTL         |
| ----- | ----- | ----------------------- | ----------- |
| CNAME | `www` | `ghs.googlehosted.com.` | 3600 / Auto |

### `editwith.me` (root) — 8 records

| Type | Name | Value                     |
| ---- | ---- | ------------------------- |
| A    | `@`  | `216.239.32.21`           |
| A    | `@`  | `216.239.34.21`           |
| A    | `@`  | `216.239.36.21`           |
| A    | `@`  | `216.239.38.21`           |
| AAAA | `@`  | `2001:4860:4802:32::15`   |
| AAAA | `@`  | `2001:4860:4802:34::15`   |
| AAAA | `@`  | `2001:4860:4802:36::15`   |
| AAAA | `@`  | `2001:4860:4802:38::15`   |

> These A/AAAA values are Google's stable anycast IPs for Cloud Run
> domain mappings. If they ever need re-checking, run in `infra/`:
> `terraform output -json domain_dns_records`.

## Before adding — remove conflicts

Hostinger ships default parking records that will conflict. Delete, if present:

- Any **A** record on `@` pointing to a Hostinger IP (e.g. `84.32.x.x`).
- Any existing **CNAME** on `www`.

## After saving

1. DNS propagation takes minutes to a few hours.
2. Once Google sees the DNS, it provisions a **free, auto-renewing SSL
   certificate** (another ~15 min to a few hours). A certificate warning
   may show until then — it clears on its own.
3. Both `https://editwith.me` and `https://www.editwith.me` then serve
   the app.

## App configuration

`APP_PUBLIC_URL` is set to `https://editwith.me` (canonical), so
share links and MCP connector URLs use the custom domain.

## Verification commands

```sh
# DNS propagation
dig +short editwith.me A
dig +short www.editwith.me CNAME

# Cloud Run mapping + certificate status
gcloud beta run domain-mappings describe --domain editwith.me \
  --region us-central1 --project editwithme

# End-to-end once live
curl -sI https://editwith.me | head -1
curl -sI https://www.editwith.me | head -1
```

## Prerequisites

- Domain ownership verified for the deploying Google account via Google
  Search Console.
- Domain mappings created (`terraform apply` with
  `custom_domains=["your-domain.com","www.your-domain.com"]`).

## Notes

- Cost: **$0** — Cloud Run domain mappings and the managed SSL cert are
  free. (A Global External Load Balancer would cost ~$18/mo and is not
  needed here.)
- Alternative not used: pointing Hostinger nameservers at Google Cloud
  DNS. The direct A/AAAA/CNAME records above are simpler and leave the
  nameservers unchanged.
