"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var Bucket_1 = require("./Bucket");
var APIRequest_1 = require("./APIRequest");
var events_1 = require("events");
var p_queue_1 = require("p-queue");
/**
 * The entry point for all requests
 */
var RESTHandler = /** @class */ (function (_super) {
    __extends(RESTHandler, _super);
    function RESTHandler(options) {
        var _this = _super.call(this) || this;
        /**
         * Buckets mapped by IDs, where the IDs are the routes
         * themselves. This is the default bucket type that is
         * used for every route until their actual bucket is
         * known after a fetch.
         */
        _this.temporaryBucketsByUrl = new Map();
        /**
         * Buckets mapped by their IDs, where the IDs are
         * resolved based on route major parameters and the
         * X-RateLimit-Bucket header returned by Discord.
         */
        _this.buckets = new Map();
        /**
         * Buckets mapped by the route URLs. These buckets are
         * considered the "true" buckets for their specified
         * routes since their IDs were returned by Discord.
         *
         * This is a convenience map that is made alongside
         * the "buckets" instance variable whenever subsequent
         * requests are made.
         */
        _this.bucketsByUrl = new Map();
        /**
         * Number of invalid requests made within 10 minutes. If
         * the number of invalid requests reaches a certain hard
         * limit (specified by Discord - currently 10,000),
         * Discord will block the application's IP from accessing
         * its API.
         */
        _this.invalidRequestsCount = 0;
        _this.queueBlockTimer = null;
        _this.userOptions = options || {};
        _this.invalidRequestsThreshold = (options === null || options === void 0 ? void 0 : options.invalidRequestsThreshold) || 5000;
        _this.globalBlockDurationMultiple = (options === null || options === void 0 ? void 0 : options.globalBlockDurationMultiple) || 1;
        _this.queue = new p_queue_1["default"](__assign({ 
            // 30/sec as a safe default
            interval: 1000, intervalCap: 30 }, options === null || options === void 0 ? void 0 : options.pqueueOptions));
        if ((options === null || options === void 0 ? void 0 : options.delayOnInvalidThreshold) !== false) {
            /**
             * Reset the invalid requests count every 10 minutes
             * since that is the duration specified by Discord.
             */
            setInterval(function () {
                _this.invalidRequestsCount = 0;
            }, 1000 * 60 * 10);
        }
        return _this;
    }
    /**
     * Increase the number of invalid requests. Invalid
     * requests have responses with status codes 401, 403,
     * 429.
     */
    RESTHandler.prototype.increaseInvalidRequestCount = function () {
        ++this.invalidRequestsCount;
        if (this.invalidRequestsCount === this.invalidRequestsThreshold) {
            // Block all buckets from executing requests for 10 min
            this.blockGloballyByDuration(1000 * 60 * 10);
            this.emit('invalidRequestsThreshold', this.invalidRequestsCount);
        }
    };
    /**
     * Handle events from buckets
     */
    RESTHandler.prototype.registerBucketListener = function (bucket) {
        var _this = this;
        bucket.on('recognizeURLBucket', this.recognizeURLBucket.bind(this));
        bucket.on('globalRateLimit', function (apiRequest, durationMs) {
            var blockDuration = durationMs * _this.globalBlockDurationMultiple;
            _this.blockGloballyByDuration(blockDuration);
            _this.emit('globalRateLimit', apiRequest, blockDuration);
        });
        bucket.on('rateLimit', function (apiRequest, durationMs) {
            _this.emit('rateLimit', apiRequest, durationMs);
        });
        bucket.on('invalidRequest', function (apiRequest) {
            _this.increaseInvalidRequestCount();
            _this.emit('invalidRequest', apiRequest, _this.invalidRequestsCount);
        });
        bucket.on('cloudflareRateLimit', function (apiRequest, durationMs) {
            var blockDuration = durationMs * _this.globalBlockDurationMultiple;
            _this.blockGloballyByDuration(blockDuration);
            _this.emit('cloudflareRateLimit', apiRequest, blockDuration);
        });
    };
    /**
     * Create a permanent bucket for a route
     */
    RESTHandler.prototype.createBucket = function (route, bucketId) {
        var bucket = new Bucket_1["default"](bucketId);
        this.buckets.set(bucketId, bucket);
        this.bucketsByUrl.set(route, bucket);
        this.registerBucketListener(bucket);
        return bucket;
    };
    /**
     * Creates a temporary bucket for a route whose bucket is unknown
     */
    RESTHandler.prototype.createTemporaryBucket = function (route) {
        var bucket = new Bucket_1["default"](route);
        this.temporaryBucketsByUrl.set(route, bucket);
        this.registerBucketListener(bucket);
        return bucket;
    };
    /**
     * Removes a temporary bucket, and copies its rate limit settings
     * to the other bucket
     */
    RESTHandler.prototype.scheduleTemporaryBucketRemoval = function (route, newBucket) {
        var _this = this;
        var tempBucket = this.temporaryBucketsByUrl.get(route);
        if (tempBucket) {
            // Wait for the bucket's queue to be empty for remaining requests
            tempBucket.once('finishedAll', function () {
                tempBucket.removeAllListeners();
                // Copy the bucket block over to the new bucket if it exists
                tempBucket.copyBlockTo(newBucket);
                _this.temporaryBucketsByUrl["delete"](route);
            });
        }
    };
    /**
     * Create a bucket for a new URL, or map a
     * url to its bucket if it exists for later reference
     */
    RESTHandler.prototype.recognizeURLBucket = function (route, bucketID) {
        if (!this.bucketExists(bucketID)) {
            var newBucket = this.createBucket(route, bucketID);
            // Remove the temporary bucket since it has a bucket ID assigned
            this.scheduleTemporaryBucketRemoval(route, newBucket);
        }
        else if (!this.bucketExistsForURL(route)) {
            var bucket = this.buckets.get(bucketID);
            this.bucketsByUrl.set(route, bucket);
        }
    };
    /**
     * Blocks all queued API requests and buckets for a duration
     * If there's already a timer, the previous timer is cleared
     * and is recreated
     */
    RESTHandler.prototype.blockGloballyByDuration = function (durationMs) {
        var _this = this;
        this.blockBucketsByDuration(durationMs);
        if (this.queueBlockTimer) {
            clearTimeout(this.queueBlockTimer);
        }
        this.queue.pause();
        this.queueBlockTimer = setTimeout(function () {
            _this.queue.start();
            _this.queueBlockTimer = null;
        }, durationMs);
    };
    /**
     * Block all buckets from running, or override buckets'
     * own timers if it's longer with the specified
     * duration
     */
    RESTHandler.prototype.blockBucketsByDuration = function (durationMs) {
        this.buckets.forEach(function (bucket) {
            var blockedUntil = bucket.blockedUntil;
            if (!blockedUntil) {
                // Block the bucket if it's not blocked
                bucket.block(durationMs);
            }
            else {
                var now = new Date().getTime();
                var globalBlockUntil = new Date(now + durationMs);
                // Choose the longer duration for blocking
                if (globalBlockUntil > blockedUntil) {
                    bucket.block(durationMs);
                }
            }
        });
    };
    /**
     * Check if a permanent bucket exists by ID
     */
    RESTHandler.prototype.bucketExists = function (bucketId) {
        return this.buckets.has(bucketId);
    };
    /**
     * Check if a permanent bucket exists for a route
     */
    RESTHandler.prototype.bucketExistsForURL = function (route) {
        return this.bucketsByUrl.has(route);
    };
    /**
     * Gets the bucket assigned for a URL.
     */
    RESTHandler.prototype.getBucketForUrl = function (url) {
        var bucket = this.bucketsByUrl.get(url);
        if (bucket) {
            // Return the temporary bucket if there are enqueued items to maintain order
            // The temporary bucket will eventually be removed once the queue is empty
            var temporaryBucket = this.temporaryBucketsByUrl.get(url);
            if (temporaryBucket && temporaryBucket.hasPendingRequests()) {
                return temporaryBucket;
            }
            return bucket;
        }
        else {
            var temporaryBucket = this.temporaryBucketsByUrl.get(url);
            if (!temporaryBucket) {
                return this.createTemporaryBucket(url);
            }
            else {
                return temporaryBucket;
            }
        }
    };
    /**
     * Fetch a resource from Discord's API
     *
     * @param route The full HTTP route string
     * @param options node-fetch options
     * @returns node-fetch response
     */
    RESTHandler.prototype.fetch = function (route, options) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, requestTimeout, requestTimeoutRetries, apiRequest, url, bucket, result;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = this.userOptions, requestTimeout = _a.requestTimeout, requestTimeoutRetries = _a.requestTimeoutRetries;
                        apiRequest = new APIRequest_1["default"](route, options, {
                            timeout: requestTimeout,
                            maxAttempts: requestTimeoutRetries
                        });
                        url = apiRequest.route;
                        bucket = this.getBucketForUrl(url);
                        return [4 /*yield*/, this.queue.add(function () { return bucket.enqueue(apiRequest); })];
                    case 1:
                        result = _b.sent();
                        return [2 /*return*/, result];
                }
            });
        });
    };
    return RESTHandler;
}(events_1.EventEmitter));
exports["default"] = RESTHandler;
