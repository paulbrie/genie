const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  // Chrome extensions CSP forbids eval — use source-map instead
  devtool: "source-map",
  entry: {
    background: "./src/background/service-worker.ts",
    content: "./src/content/content-script.ts",
    "floating-widget": "./src/content/floating-widget.ts",
    "widget-bridge": "./src/widget/widget-bridge.ts",
    bridge: "./src/sidepanel/bridge.ts",
    popup: "./src/popup/index.tsx",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader", "postcss-loader"],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "icons", to: "icons" },
        { from: "src/sidepanel/index.html", to: "sidepanel.html" },
        { from: "src/widget/index.html", to: "widget.html" },
        { from: "src/popup/index.html", to: "popup.html" },
      ],
    }),
  ],
  optimization: {
    splitChunks: false,
  },
};
