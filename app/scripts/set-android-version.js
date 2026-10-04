#!/usr/bin/env node

/**
 * This script stamps the Android release version into app.json before `expo prebuild`.
 * ANDROID_VERSION_CODE is required and must grow on every Play upload; ANDROID_VERSION_NAME is optional
 * and overrides the user facing version string. Only the CI working copy is rewritten.
 */

const fs = require("fs");
const path = require("path");

const appJsonPath = path.join(process.cwd(), "app.json");
const config = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));

const rawVersionCode = process.env.ANDROID_VERSION_CODE;
const versionCode = Number(rawVersionCode);

if (!Number.isInteger(versionCode) || versionCode < 1) {
  throw new Error(
    `ANDROID_VERSION_CODE must be an integer >= 1, got: ${rawVersionCode ?? "(unset)"}`
  );
}

config.expo.android = { ...config.expo.android, versionCode };

const versionName = process.env.ANDROID_VERSION_NAME;
if (versionName) {
  config.expo.version = versionName;
}

fs.writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(
  `✅ versionName=${config.expo.version}, versionCode=${versionCode}, package=${config.expo.android.package}`
);
