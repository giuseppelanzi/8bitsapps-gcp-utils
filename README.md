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
- Support for multiple buckets per configuration.

### Initialize configuration

Sets up the global configuration directory (`~/.8bitsapps-gcp-utils/`) with the required structure.

## Requirements

- **Node.js**: >= 18.0.0 (Node.js 22 LTS recommended)

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
└── credentials/
```

### Configuration file

Create a JSON file in `~/.8bitsapps-gcp-utils/configurations/` (e.g., `gcp-options-myproject.json`):

```json
{
  "credentialsFile": "my-service-account.json",
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
| `credentialsFile` | GCP service account JSON filename (stored in `credentials/`). |
| `defaultProjectId` | GCP project ID. |
| `defaultFirewallRule` | Firewall rule name to update. |
| `defaultFixedIPAddresses` | Array of fixed IPs to always keep in the rule. |
| `buckets` | Array of available buckets (optional). |
| `defaultBucket` | Default bucket for storage operations. |

### GCP Credentials

Download your service account JSON from GCP Console and save it in `~/.8bitsapps-gcp-utils/credentials/`.

Required roles:

- **Firewall**: `Compute Security Admin` or `Compute Network Admin`
- **Storage**: `Storage Object Admin`

## Usage

```bash
gcpUtils
```

Navigate menus with arrow keys. Press `ESC` to go back or exit.

## License

ISC

## Author

**8BitsApps** - https://8bitsapps.com
