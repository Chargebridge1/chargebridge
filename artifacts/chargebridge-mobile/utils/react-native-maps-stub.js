const React = require("react");
const { View } = require("react-native");

const Stub = () => React.createElement(View, null);
Stub.displayName = "MapViewStub";

module.exports = Stub;
module.exports.default = Stub;
module.exports.Marker = Stub;
module.exports.Polyline = Stub;
module.exports.Circle = Stub;
module.exports.PROVIDER_DEFAULT = null;
module.exports.PROVIDER_GOOGLE = "google";
