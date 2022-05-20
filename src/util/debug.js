"use strict";
exports.__esModule = true;
exports.createBucketDebug = void 0;
var debug_1 = require("debug");
var createBucketDebug = function (bucketId) {
    return debug_1["default"]("discordrest:bucket:" + bucketId);
};
exports.createBucketDebug = createBucketDebug;
