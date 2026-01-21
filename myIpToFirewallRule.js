const GCPUtils = require('./GCPUtils');

(async () => {
  const configName = process.argv[2];
  const networkManager = new GCPUtils.Network(configName);
  await networkManager.updateFirewall();
})();
