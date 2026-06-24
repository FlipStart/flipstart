module.exports = function (api) {
  api.cache(true);
  let plugins = [];

  plugins.push("react-native-worklets/plugin");

  // Strip console.log from PRODUCTION builds only (keeps warn/error for crash
  // diagnostics). Prevents debug output — including any auth/user details — from
  // being written to the device system log in release builds. Dev keeps all logs.
  if (process.env.NODE_ENV === "production" || process.env.BABEL_ENV === "production") {
    plugins.push(["transform-remove-console", { exclude: ["error", "warn"] }]);
  }

  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    plugins,
  };
};