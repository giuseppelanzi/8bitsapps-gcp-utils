const fs = require("fs/promises");
const { Storage: GoogleCloudStorage } = require("@google-cloud/storage");

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
      const configFileName = `Configurations/gcp-options-${this.configurationName}.json`;
      console.log(`Loading configuration: ${configFileName}.`);
      this.configuration = JSON.parse(await fs.readFile(configFileName, "utf8"));
      //
      const credentialsFileName = `Credentials/${this.configuration.credentialsFile}`;
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
}

module.exports = Storage;
