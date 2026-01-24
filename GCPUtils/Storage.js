const fs = require("fs/promises");
const { Storage: GoogleCloudStorage } = require("@google-cloud/storage");
const { getConfigPath, getCredentialsPath } = require("../utils/paths.js");

class Storage {
  constructor(configName) {
    this.configurationName = configName;
    this.configuration = null;
    this.credentials = null;
    this.storage = null;
  }

  async loadConfiguration() {
    if (this.configuration) {
      return; // Already loaded.
    }
    if (!this.configurationName)
      throw new Error("Missing configuration name.");
    //
    try {
      const configFileName = getConfigPath(this.configurationName);
      console.log(`Loading configuration: ${configFileName}.`);
      this.configuration = JSON.parse(await fs.readFile(configFileName, "utf8"));
      //
      const credentialsFileName = getCredentialsPath(this.configuration.credentialsFile);
      console.log(`Loading credentials: ${credentialsFileName}.`);
      this.credentials = JSON.parse(await fs.readFile(credentialsFileName, "utf8"));
      //
      this.storage = new GoogleCloudStorage({
        credentials: this.credentials,
        projectId: this.configuration.defaultProjectId
      });
    }
    catch (ex) {
      console.error(`Error while reading the config file: ${ex}.`);
      throw ex;
    }
  }

  unloadConfiguration() {
    this.configuration = null;
    this.credentials = null;
    this.storage = null;
  }

  resolvePath(path) {
    if (path[0] !== "/") {
      return `${process.cwd()}/${path}`;
    }
    return path;
  }

  generateUniquePath(path) {
    const uid = new Date().valueOf();
    const lastDotPos = path.lastIndexOf(".");
    if (lastDotPos < 0) {
      return `${path}-${uid}`;
    }
    return `${path.substring(0, lastDotPos)}-${uid}${path.substring(lastDotPos)}`;
  }

  async upload(pathFile, pathCloud, options) {
    await this.loadConfiguration();
    //
    if (!pathFile || !pathCloud) {
      throw new Error("Must specify both the path of the local file and the cloud path on the bucket.");
    }
    //
    const bucket = options?.bucket ?? this.configuration?.defaultBucket;
    if (!bucket) {
      throw new Error("Bucket must be specified either in options or in the configuration file.");
    }
    //
    const resolvedPathFile = this.resolvePath(pathFile);
    const uniquePathCloud = this.generateUniquePath(pathCloud);
    //
    try {
      await this.storage.bucket(bucket).upload(resolvedPathFile, {
        destination: uniquePathCloud,
        resumable: false,
      });
      console.log(`File uploaded to ${bucket}/${uniquePathCloud}.`);
    } catch (err) {
      throw new Error(`Error uploading file ${resolvedPathFile} to GCloud ${uniquePathCloud}: ${err}`);
    }
  }
  //
  /**
   * Returns the list of configured buckets.
   * @returns {Array<{name: string, displayName: string}>} List of buckets.
   */
  async getBuckets() {
    await this.loadConfiguration();
    //
    if (this.configuration.buckets && this.configuration.buckets.length > 0) {
      // Normalize buckets to objects with name and displayName.
      return this.configuration.buckets.map(b => {
        if (typeof b === "string") {
          return { name: b, displayName: b };
        }
        return b;
      });
    }
    //
    // Fallback to defaultBucket if buckets array is not defined.
    if (this.configuration.defaultBucket) {
      return [{ name: this.configuration.defaultBucket, displayName: this.configuration.defaultBucket }];
    }
    //
    return [];
  }
  //
  /**
   * Lists objects in a bucket at the given prefix.
   * @param {string} bucketName - The bucket name.
   * @param {string} prefix - The folder prefix (empty for root).
   * @returns {Promise<{folders: string[], files: Array<{name: string, size: number}>}>} Folders and files.
   */
  async listObjects(bucketName, prefix = "") {
    await this.loadConfiguration();
    //
    const bucket = this.storage.bucket(bucketName);
    const [files] = await bucket.getFiles({
      prefix: prefix,
      delimiter: "/",
      autoPaginate: false
    });
    //
    // Get folder prefixes from API response.
    const [, , apiResponse] = await bucket.getFiles({
      prefix: prefix,
      delimiter: "/"
    });
    //
    const folders = apiResponse?.prefixes || [];
    //
    // Filter out the prefix itself and get only direct files.
    const directFiles = files
      .filter(file => {
        const relativePath = file.name.slice(prefix.length);
        return relativePath && !relativePath.includes("/");
      })
      .map(file => ({
        name: file.name,
        size: parseInt(file.metadata.size, 10) || 0
      }));
    //
    return { folders, files: directFiles };
  }
  //
  /**
   * Downloads a file from the bucket to a local path.
   * @param {string} bucketName - The bucket name.
   * @param {string} remotePath - The remote file path.
   * @param {string} localPath - The local destination path.
   */
  async downloadFile(bucketName, remotePath, localPath) {
    await this.loadConfiguration();
    //
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(remotePath);
    //
    await file.download({ destination: localPath });
  }
  //
  /**
   * Uploads a file to the bucket.
   * @param {string} bucketName - The bucket name.
   * @param {string} localPath - The local file path.
   * @param {string} remotePath - The remote destination path.
   */
  async uploadFile(bucketName, localPath, remotePath) {
    await this.loadConfiguration();
    //
    const resolvedPath = this.resolvePath(localPath);
    const bucket = this.storage.bucket(bucketName);
    //
    await bucket.upload(resolvedPath, {
      destination: remotePath,
      resumable: false
    });
  }
}

module.exports = Storage;
