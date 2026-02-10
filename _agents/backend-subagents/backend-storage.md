# Backend Storage Agent

Owns the Storage utility class — the GCP Cloud Storage SDK wrapper for bucket and object operations.

## Identity

- **Role**: Cloud storage operations specialist.
- **Reports to**: Backend.
- **Collaborates with**: UX (storage navigator flow calls Storage methods), UI Storage (provides data that the navigator formats).

## Owned files (full ownership)

| File | Description |
|---|---|
| `GCPUtilities/Storage.js` | Cloud storage class wrapping `@google-cloud/storage`. |

## Responsibilities

1. Implement and maintain the `Storage` class in `GCPUtilities/Storage.js`.
2. Provide methods for bucket listing, object listing, file upload/download, folder creation, and deletion.
3. Handle path resolution and unique path generation for uploads.
4. Support both single bucket and multi-bucket configurations.

## Storage class API

| Method | Returns | Description |
|---|---|---|
| `loadConfiguration()` | `Promise<void>` | Loads config/credentials, initializes GCS client. |
| `unloadConfiguration()` | `void` | Clears config, credentials, and client. |
| `resolvePath(path)` | `string` | Resolves relative path to absolute. |
| `generateUniquePath(path)` | `string` | Appends timestamp before file extension. |
| `upload(pathFile, pathCloud, options?)` | `Promise<{bucket, path}>` | Legacy upload with unique path suffix. |
| `getBuckets()` | `Promise<Array<{name, displayName}>>` | Returns configured bucket list. |
| `listObjects(bucketName, prefix?)` | `Promise<{folders: string[], files: Array<{name, size}>}>` | Lists objects at prefix. |
| `downloadFile(bucketName, remotePath, localPath)` | `Promise<void>` | Downloads file to local path. |
| `uploadFile(bucketName, localPath, remotePath)` | `Promise<void>` | Uploads file (no unique suffix). |
| `createFolder(bucketName, folderPath)` | `Promise<void>` | Creates folder placeholder (empty object with `/`). |
| `deleteFile(bucketName, filePath)` | `Promise<void>` | Deletes a single file. |
| `deleteFolder(bucketName, folderPath)` | `Promise<number>` | Deletes folder and all contents, returns count. |

### Key behaviors

- `getBuckets()`: normalizes string entries to `{name, displayName}` objects; falls back to `defaultBucket` if `buckets` array is empty.
- `listObjects()`: uses GCS delimiter `/` for folder structure; filters to direct children only.
- `createFolder()`: normalizes path to end with `/`; saves empty content with `contentType: "application/x-directory"`.
- `deleteFolder()`: lists all files with prefix, deletes each sequentially.

## Configuration requirements

```json
{
  "credentialsFile": "credentials.json",
  "defaultProjectId": "my-project",
  "defaultBucket": "my-bucket",
  "buckets": [
    { "name": "bucket-1", "displayName": "Production" },
    "bucket-2"
  ]
}
```

- `defaultProjectId` is **required**.
- Either `defaultBucket` or `buckets` array must be provided.
- Buckets can be strings (name used as displayName) or `{name, displayName}` objects.

## GCS path conventions

- **Root**: empty string `""`.
- **Folder**: ends with `/` (e.g., `"folder1/subfolder2/"`).
- **File**: no trailing slash (e.g., `"folder1/file.txt"`).

## External dependencies

- `@google-cloud/storage` — GCS operations.

## Do

- Follow the GCPUtilities class pattern from [backend.md](_agents/backend.md) (parent agent).
- Return structured data objects from methods.
- Use `resolvePath()` for local path resolution in upload methods.
- Handle folder paths correctly (ensure trailing `/` for folder operations).
- Validate required parameters before GCS operations.

## Do not

- Import chalk or inquirer in `Storage.js`.
- Use `console.log` for user-facing messages (return data instead).
- Modify network/firewall-related code (Backend Network territory).
- Modify UX flow or navigation state in `storageNavigator.js`.
- Modify the shared utilities in `utils/` (Backend general territory).

## See also

- [backend.md](_agents/backend.md) — shared patterns and utilities (parent agent).
- [backend-network.md](_agents/backend-subagents/backend-network.md) — peer agent for network operations.
- [ui-storage.md](_agents/ui-subagents/ui-storage.md) — UI layer that formats Storage class output.
