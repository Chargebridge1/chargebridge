const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

if (Array.isArray(config.watchFolders)) {
  config.watchFolders = config.watchFolders.filter((folder) => {
    try {
      return fs.statSync(folder).isDirectory();
    } catch {
      return false;
    }
  });
}

const stubPath = path.resolve(__dirname, "utils/react-native-maps-stub.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return { filePath: stubPath, type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
