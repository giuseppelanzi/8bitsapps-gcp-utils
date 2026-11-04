# GCP Utils

Interactive CLI tool for managing Google Cloud Platform (GCP) services, including firewall and storage operations, a Compute Engine inventory, and SSH access to VMs.

## Features

### Connect to a VM over SSH

Opens a shell on a running Compute Engine VM through `gcloud compute ssh`, as the identity of the selected configuration, so that access is governed by the Google account instead of personal keys copied onto every machine.

- Pick a running VM from a filterable list, or choose **Connect via SSH** from the VM detail card of the janitor.
- Set `ssh.tunnelThroughIap` to reach VMs through Identity-Aware Proxy, including those without an external IP.
- The equivalent `gcloud` command is printed before connecting, so the session can be reproduced by hand.

### Browse and manage GCS storage

Interactive navigator for Google Cloud Storage:

- Browse buckets and folders.
- Filter any listing incrementally by typing; `Load more` reveals further items.
- View files with size information.
- Download files to current directory.
- Upload local files to GCS.
- Create folders in GCS.
- Delete files from GCS.
- Delete folders from GCS (recursive).
- Support for multiple buckets per configuration.

### GCP Janitor - Resource Analyzer

Read-only inventory of the Compute Engine resources of a project, with a report of the "zombie" items that keep costing money without being used. Nothing is ever deleted or modified on GCP.

- **Resource Inventory**: filterable lists of VM instances, persistent disks, snapshots and static IP addresses.
- VM detail card with machine type, status, attached disks and static IPs; select a disk to see its snapshots, or choose **Connect via SSH**.
- Export the VM list, as currently filtered, to a timestamped CSV file in the current directory.
- **Zombie Items & Cleanup**: reports unattached disks, VMs stopped for longer than `janitor.stoppedVmThresholdDays`, snapshots whose source disk no longer exists, and reserved static IPs that nothing uses.
- Mark a zombie as an exception, with an optional reason, to hide it from later reports. Exceptions are saved per configuration in `janitor-exceptions-<config>.json`, next to the configuration files.

### Update Firewall with current IP

Automatically updates a GCP firewall rule with your current public IP address. Useful for development environments with dynamic IPs that need access to firewall-protected resources.

- Automatically detects current public IP.
- Preserves configured fixed IP addresses.
- Adds current IP to the firewall rule's sourceRanges.

### Manage authentication

Logs in with short-lived Application Default Credentials (ADC), one identity per configuration, so that several GCP accounts from different organizations can be used side by side without static service account keys.

### Manage configurations

Creates, edits, duplicates and deletes configurations from the menu, so the JSON files never need editing by hand.

- A wizard asks every option in turn and proposes the current value: ENTER keeps it, `-` clears an optional field, ESC discards the whole wizard without writing anything.
- The identity is picked from those already known, with their login state and the configurations that use them, or created anew. A warning shows up when configurations sharing an identity would log in with a different account or impersonate a different service account, and the login offer then defaults to No.
- A summary shows what changed before saving, and a login is offered when the credentials of the identity do not fit the configuration.
- **Duplicate** starts from the values of another configuration, which makes sharing an identity and its login easy.
- `DEL` deletes a configuration together with its janitor exceptions. When no other configuration uses its identity, revoking the credentials is offered too.
- Fields the wizard does not know about are kept as they are, and a value left unchanged keeps its original form in the file.

### Initialize configuration

Sets up the configuration directory with the required structure. When no configuration exists yet, it offers the wizard for the first one.

## Requirements

- **Node.js**: >= 18.0.0 (Node.js 22 LTS recommended)
- **Google Cloud SDK**: `gcloud` in `PATH`, used for the login flow and for SSH.

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

Initialization offers to create the first configuration with the wizard, then to log in. Declining writes an example configuration to edit by hand instead.

This creates the following structure:

```
~/.8bitsapps-gcp-utils/
├── configurations/
├── credentials/     (legacy service account keys)
└── gcloud/          (one directory per identity)
```

### Configuration file

Configurations are best created and edited with **Manage configurations**. They are plain JSON files in `~/.8bitsapps-gcp-utils/configurations/` (e.g., `gcp-options-myproject.json`), and can be edited by hand as well:

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
  "defaultBucket": "my-bucket-dev",
  "ssh": { "tunnelThroughIap": false }
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
| `ssh.tunnelThroughIap` | Connect over SSH through Identity-Aware Proxy (optional, default `false`). Needed for VMs without an external IP. |

### Settings file

List behavior is tuned through an optional `settings.json`, read from the current working directory first, then from `~/.8bitsapps-gcp-utils/`. Missing keys fall back to the defaults below:

```json
{
  "storage": { "maxItems": 30, "pageStep": 30 },
  "janitor": { "maxItems": 50, "pageStep": 50, "stoppedVmThresholdDays": 30 }
}
```

| Key | Description |
|-----|-------------|
| `maxItems` | Initial window of a list: how many items are shown before the `Load more` row. It is not a hard cap — every item stays reachable through `Load more` or by typing a filter. |
| `pageStep` | How many further items each `Load more` reveals. |
| `janitor.stoppedVmThresholdDays` | Days a VM must have been stopped to be reported as a zombie. |

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
- **SSH**: `Compute Viewer`, plus `Compute OS Login` (`roles/compute.osLogin`) on VMs with OS Login, or the permission to set instance or project metadata on VMs without it. Through IAP, also `IAP-secured Tunnel User` (`roles/iap.tunnelResourceAccessor`) and a firewall rule allowing `tcp:22` from `35.235.240.0/20`.

#### SSH sessions

The identity directory holds only the ADC file, not credentials of gcloud's own. The tool hands that file to `gcloud compute ssh` through gcloud's `auth/credential_file_override` property, and sets `core/account` to the account it carries — the service account, when the identity impersonates one — so no second login is needed and `~/.config/gcloud` is never touched. That property is undocumented, so a future gcloud release may change how it works.

`gcloud compute ssh` keeps its key pair in `~/.ssh/google_compute_engine`, shared by every identity. With OS Login the public key is registered on the profile of the account that connects; without it, gcloud adds the key to the instance or project metadata.

#### Service account impersonation (recommended)

Set `auth.impersonateServiceAccount` to act with the roles of a service account instead of your own. No key material is stored: the tool holds your user credentials and Google mints a one-hour token for the service account, which the audit log attributes to you.

It requires `roles/iam.serviceAccountTokenCreator` on that service account for your user, and the roles above granted to the service account rather than to you.

#### Migrating away from service account keys

Configurations with `credentialsFile` keep working and print a deprecation warning. To migrate, replace `credentialsFile` with an `auth` block, log in, verify with **Status**, and then delete the key from the GCP console — removing the local file alone does not invalidate it.

## Usage

```bash
gcpUtils
```

Navigate menus with arrow keys. Press `ESC` to go back or exit. In filterable lists (storage browser, janitor, SSH), type to narrow the list as you go: `ESC` first clears an active filter, then exits; the left arrow goes back one level when the filter is empty.

## License

ISC

## Author

**8BitsApps** - https://8bitsapps.com
