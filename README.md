# GCP Utils

Interactive CLI tool for managing Google Cloud Platform (GCP) services, including firewall and storage operations.

## Features

### Update Firewall with current IP

Automatically updates a GCP firewall rule with your current public IP address. Useful for development environments with dynamic IPs that need access to firewall-protected resources.

- Automatically detects current public IP.
- Preserves configured fixed IP addresses.
- Adds current IP to the firewall rule's sourceRanges.

### Browse and manage GCS storage

Interactive navigator for Google Cloud Storage:

- Browse buckets and folders.
- View files with size information.
- Download files to current directory.
- Upload local files to GCS.
- Create folders in GCS.
- Delete files from GCS.
- Delete folders from GCS (recursive).
- Support for multiple buckets per configuration.

### Manage authentication

Logs in with short-lived Application Default Credentials (ADC), one identity per configuration, so that several GCP accounts from different organizations can be used side by side without static service account keys.

### Initialize configuration

Sets up the global configuration directory (`~/.8bitsapps-gcp-utils/`) with the required structure.

## Requirements

- **Node.js**: >= 18.0.0 (Node.js 22 LTS recommended)
- **Google Cloud SDK**: `gcloud` in `PATH`, used for the login flow.

## Installation

### Global installation (recommended)

```bash
npm install -g 8bitsapps-gcp-utils
```

After installation, the `gcpUtils` command will be available globally.

### Install from source

```bash
git clone https://github.com/giuseppelanzi-8bitsapps-gcp-utils.git
cd 8bitsapps-gcp-utils
npm install
npm link
```

The `npm link` command makes `gcpUtils` available globally. To remove:

```bash
npm unlink
```

## Configuration

### First run

On first run, the tool will prompt you to initialize:

```bash
gcpUtils
```

This creates the following structure:

```
~/.8bitsapps-gcp-utils/
├── configurations/
├── credentials/     (legacy service account keys)
└── gcloud/          (one directory per identity)
```

### Configuration file

Create a JSON file in `~/.8bitsapps-gcp-utils/configurations/` (e.g., `gcp-options-myproject.json`):

```json
{
  "auth": {
    "identity": "acme",
    "account": "me@acme.com",
    "impersonateServiceAccount": "gcp-utils@acme-prod.iam.gserviceaccount.com",
    "quotaProject": "acme-prod"
  },
  "defaultProjectId": "my-gcp-project-id",
  "defaultFirewallRule": "allow-my-ip",
  "defaultFixedIPAddresses": ["203.0.113.10/32"],
  "buckets": [
    { "name": "my-bucket-prod", "displayName": "Production" },
    { "name": "my-bucket-dev", "displayName": "Development" }
  ],
  "defaultBucket": "my-bucket-dev"
}
```

| Field | Description |
|-------|-------------|
| `auth.identity` | Name of the credentials set. Each identity gets its own `gcloud/<identity>/` directory. |
| `auth.account` | Google account to log in with (optional, pre-selects it in the browser). |
| `auth.impersonateServiceAccount` | Service account to impersonate (optional). Belongs to the identity, see below. |
| `auth.quotaProject` | Project billed for API usage. Per configuration. Only needed when not impersonating. |
| `credentialsFile` | **Deprecated.** Service account key filename in `credentials/`. |
| `defaultProjectId` | GCP project ID. |
| `defaultFirewallRule` | Firewall rule name to update. |
| `defaultFixedIPAddresses` | Array of fixed IPs to always keep in the rule. |
| `buckets` | Array of available buckets (optional). |
| `defaultBucket` | Default bucket for storage operations. |

### GCP Credentials

Run `gcpUtils`, choose **Manage authentication**, pick the configuration, then **Login**. A browser opens and the resulting credentials are written to `gcloud/<identity>/application_default_credentials.json`.

Credentials are per identity, so several accounts stay authenticated at the same time and the tool never touches your everyday `~/.config/gcloud`. The stored refresh token yields access tokens valid for one hour; nothing needs to be rotated by hand.

#### One login per identity

An **identity** is a set of credentials, not a project: it is the Google account you authenticate as, plus the service account it impersonates, if any. Configurations that share both can share an identity and one login, each keeping its own `defaultProjectId` and `quotaProject`.

Impersonation is written into the credentials file at login time, so it belongs to the identity: two configurations sharing an identity **must** agree on `impersonateServiceAccount`. If they disagree, the last login wins and the tool warns you before running any command. Give one of them its own identity instead.

The quota project works the other way around: it is per configuration. The credentials file may carry a `quota_project_id` of its own — whichever configuration happened to be current at login time — so the tool overrides it in memory with `auth.quotaProject` before handing the credentials to the client library. The file on disk is never modified, and configurations sharing an identity can bill their API calls to different projects.

Required roles:

- **Firewall**: `Compute Security Admin` or `Compute Network Admin`
- **Storage**: `Storage Object Admin`
- **Compute Engine (janitor)**: `Compute Viewer`

#### Service account impersonation (recommended)

Set `auth.impersonateServiceAccount` to act with the roles of a service account instead of your own. No key material is stored: the tool holds your user credentials and Google mints a one-hour token for the service account, which the audit log attributes to you.

It requires `roles/iam.serviceAccountTokenCreator` on that service account for your user, and the roles above granted to the service account rather than to you.

#### Migrating away from service account keys

Configurations with `credentialsFile` keep working and print a deprecation warning. To migrate, replace `credentialsFile` with an `auth` block, log in, verify with **Status**, and then delete the key from the GCP console — removing the local file alone does not invalidate it.

## Usage

```bash
gcpUtils
```

Navigate menus with arrow keys. Press `ESC` to go back or exit.

## License

ISC

## Author

**8BitsApps** - https://8bitsapps.com
