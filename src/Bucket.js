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
var events_1 = require("events");
var debug_1 = require("./util/debug");
/**
 * Handles queuing and exectuion of API requests that share
 * the same rate limits
 */
var Bucket = /** @class */ (function (_super) {
    __extends(Bucket, _super);
    function Bucket(id) {
        var _this = _super.call(this) || this;
        /**
         * The queue of pending API requests
         */
        _this.queue = [];
        _this.id = id;
        _this.debug = debug_1.createBucketDebug(id);
        return _this;
    }
    Object.defineProperty(Bucket, "constants", {
        /**
         * Discord header constants
         */
        // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
        get: function () {
            return {
                // The bucket id encountered
                RATELIMIT_BUCKET: 'X-RateLimit-Bucket',
                // Number of remaining requests for this bucket
                RATELIMIT_REMAINING: 'X-RateLimit-Remaining',
                // Seconds to wait until the limit resets
                RATELIMIT_RESET_AFTER: 'X-RateLimit-Reset-After',
                // If the encountered route has hit a global limit
                RATELIMIT_GLOBAL: 'X-RateLimit-Global',
                // Seconds to wait until global limit is reset
                // Only available when a global limit is hit
                RETRY_AFTER: 'Retry-After'
            };
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Create a bucket's ID using major route parameters and the bucket
     * header defined in X-RateLimit-Bucket. If it cannot be resolved,
     * use the route as the bucket ID.
     *
     * @param route API Route
     * @param rateLimitBucket Bucket defined in X-RateLimit-Bucket header
     */
    Bucket.resolveBucketId = function (route, rateLimitBucket) {
        var _a, _b, _c;
        var guildId = ((_a = route.match(/\/guilds\/(\d+)/)) === null || _a === void 0 ? void 0 : _a[1]) || '';
        var channelId = ((_b = route.match(/\/channels\/(\d+)/)) === null || _b === void 0 ? void 0 : _b[1]) || '';
        var webhookId = ((_c = route.match(/\/webhooks\/(\d+)/)) === null || _c === void 0 ? void 0 : _c[1]) || '';
        var headerBucket = rateLimitBucket || '';
        var firstTry = [headerBucket, guildId, channelId, webhookId];
        if (firstTry.filter(function (item) { return item; }).length > 0) {
            return firstTry.join('-');
        }
        else {
            return route;
        }
    };
    /**
     * If there are queued up requests in this bucket
     */
    Bucket.prototype.hasPendingRequests = function () {
        return this.queue.length > 0;
    };
    /**
     * If a bucket limit is available within these headers from request headers
     */
    Bucket.hasBucketLimits = function (headers) {
        var RATELIMIT_BUCKET = Bucket.constants.RATELIMIT_BUCKET;
        return !!headers.get(RATELIMIT_BUCKET);
    };
    /**
     * Determine how long the bucket block is in ms from request headers.
     * Discord may also still return 429 if remaining is >0. We ignore
     * remaining in the event of a 429 response. Discord returns the
     * duration as seconds.
     *
     * Returns -1 if no block duration is found in headers
     *
     * @returns {number} Milliseconds
     */
    Bucket.getBucketBlockDurationMs = function (headers, ignoreRemaining) {
        var _a = Bucket.constants, RATELIMIT_REMAINING = _a.RATELIMIT_REMAINING, RATELIMIT_RESET_AFTER = _a.RATELIMIT_RESET_AFTER;
        var rateLimitRemaining = Number(headers.get(RATELIMIT_REMAINING));
        if (rateLimitRemaining === 0 || ignoreRemaining) {
            // Reset-After contains seconds
            var resetAfterMs = Number(headers.get(RATELIMIT_RESET_AFTER)) * 1000;
            if (isNaN(resetAfterMs)) {
                return -1;
            }
            else {
                return resetAfterMs;
            }
        }
        return -1;
    };
    /**
     * If the headers indicate global blockage from request headers
     */
    Bucket.isGloballyBlocked = function (headers) {
        var RATELIMIT_GLOBAL = Bucket.constants.RATELIMIT_GLOBAL;
        return !!headers.get(RATELIMIT_GLOBAL);
    };
    /**
     * Determine how long in ms the global block is from request headers
     * Returns -1 if no block duration is found in headers. Discord returns
     * this value as milliseconds.
     *
     * @returns {number} Milliseconds.
     */
    Bucket.getGlobalBlockDurationMs = function (headers) {
        var RETRY_AFTER = Bucket.constants.RETRY_AFTER;
        var retryAfterMs = Number(headers.get(RETRY_AFTER));
        if (!isNaN(retryAfterMs)) {
            return retryAfterMs;
        }
        return -1;
    };
    /**
     * Determine how long to block this bucket in ms from
     * request headers before executing any further requests
     * Returns -1 if no block duration is found in headers
     *
     * @returns {number} Milliseconds
     */
    Bucket.getBlockedDuration = function (headers, ignoreRemaining) {
        if (ignoreRemaining === void 0) { ignoreRemaining = false; }
        // Global limits take priority
        if (this.isGloballyBlocked(headers)) {
            return this.getGlobalBlockDurationMs(headers);
        }
        else if (this.hasBucketLimits(headers)) {
            return this.getBucketBlockDurationMs(headers, ignoreRemaining);
        }
        else {
            return -1;
        }
    };
    /**
     * Emit the bucket ID from request headers as an event for
     * the RESTHandler to map a url to its bucket in the future.
     *
     * API requests by default are allocated to temporary buckets.
     * Recognizing it will de-allocate it from the temporary buckets.
     */
    Bucket.prototype.recognizeURLBucket = function (url, headers) {
        if (!Bucket.hasBucketLimits(headers)) {
            return;
        }
        var RATELIMIT_BUCKET = Bucket.constants.RATELIMIT_BUCKET;
        var rateLimitBucket = headers.get(RATELIMIT_BUCKET) || '';
        var bucketID = Bucket.resolveBucketId(url, rateLimitBucket);
        this.emit('recognizeURLBucket', url, bucketID);
    };
    /**
     * Block this bucket from executing new requests for a duration
     */
    Bucket.prototype.block = function (durationMs) {
        var _this = this;
        if (this.timer) {
            clearTimeout(this.timer);
        }
        var nowMs = new Date().getTime();
        this.blockedUntil = new Date(nowMs + durationMs);
        this.timer = setTimeout(function () {
            _this.blockedUntil = undefined;
        }, durationMs);
    };
    /**
     * Copys the block to another bucket. Used when a new bucket will
     * replace a temporary bucket, but the temporary bucket still has
     * a block on it. The block is then transferred from the temporary
     * bucket to the new one.
     */
    Bucket.prototype.copyBlockTo = function (otherBucket) {
        if (!this.blockedUntil) {
            return;
        }
        var now = new Date().getTime();
        var future = this.blockedUntil.getTime();
        var diff = future - now;
        otherBucket.block(diff);
    };
    /**
     * Delay the execution and resolution of an API request
     */
    Bucket.prototype.delayExecution = function (apiRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var now, future;
            var _this = this;
            return __generator(this, function (_a) {
                now = new Date().getTime();
                future = this.blockedUntil.getTime();
                return [2 /*return*/, new Promise(function (resolve) {
                        setTimeout(function () {
                            resolve(_this.execute(apiRequest));
                        }, future - now);
                    })];
            });
        });
    };
    /**
     * Wait for previous API requests to finish
     */
    Bucket.prototype.waitForRequest = function (apiRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                if (!apiRequest) {
                    return [2 /*return*/];
                }
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.once("finishedRequest-" + apiRequest.id, resolve);
                    })];
            });
        });
    };
    /**
     * Queue up an API request for execution.
     *
     * This function must not be prefixed with async since
     * the queue push must be synchronous
     *
     * @returns Node fetch response
     */
    Bucket.prototype.enqueue = function (apiRequest) {
        var _this = this;
        this.debug("Enqueuing request " + apiRequest.toString());
        /**
         * Access the last one in the queue *before* we enter the
         * promise since the call is synchronous with this part of
         * the function.
         */
        var previousRequest = this.queue[this.queue.length - 1];
        this.queue.push(apiRequest);
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(function (resolve, reject) { return __awaiter(_this, void 0, void 0, function () {
            var result, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, 4, 5]);
                        /**
                         * Every request waits for the previous request in a
                         * recursive-like pattern, and is guaranteed to only
                         * be executed after all previous requests were executed
                         */
                        return [4 /*yield*/, this.waitForRequest(previousRequest)];
                    case 1:
                        /**
                         * Every request waits for the previous request in a
                         * recursive-like pattern, and is guaranteed to only
                         * be executed after all previous requests were executed
                         */
                        _a.sent();
                        return [4 /*yield*/, this.execute(apiRequest)];
                    case 2:
                        result = _a.sent();
                        this.queue.splice(this.queue.indexOf(apiRequest), 1);
                        /**
                         * If the queue is empty, emit an event that allows the
                         * RESTHandler to delete this bucket if it is pending deletion
                         */
                        if (this.queue.length === 0) {
                            this.debug('Finished entire queue');
                            this.emit('finishedAll');
                        }
                        resolve(result);
                        return [3 /*break*/, 5];
                    case 3:
                        err_1 = _a.sent();
                        reject(err_1);
                        return [3 /*break*/, 5];
                    case 4:
                        this.debug("Finished " + apiRequest.toString());
                        this.finishHandling(apiRequest);
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        }); });
    };
    /**
     * Execute a APIRequest by fetching it
     */
    Bucket.prototype.execute = function (apiRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var res, status, headers;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.blockedUntil) {
                            this.debug("Delaying execution until " + this.blockedUntil + " for " + apiRequest.toString());
                            return [2 /*return*/, this.delayExecution(apiRequest)];
                        }
                        this.debug("Executing " + apiRequest.toString());
                        return [4 /*yield*/, apiRequest.execute()];
                    case 1:
                        res = _a.sent();
                        status = res.status, headers = res.headers;
                        this.recognizeURLBucket(apiRequest.route, headers);
                        if (status === 429) {
                            return [2 /*return*/, this.handle429Response(apiRequest, res)];
                        }
                        else {
                            return [2 /*return*/, this.handleResponse(apiRequest, res)];
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Mark an API request as finished to proceed with the queue
     * for other enqueued requests
     */
    Bucket.prototype.finishHandling = function (apiRequest) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.emit("finishedRequest-" + apiRequest.id);
    };
    /**
     * Handle 429 status code response (rate limited)
     */
    Bucket.prototype.handle429Response = function (apiRequest, res) {
        return __awaiter(this, void 0, void 0, function () {
            var headers, blockedDurationMs, futureResult;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        headers = res.headers;
                        blockedDurationMs = Bucket.getBlockedDuration(headers, true);
                        this.debug("429 hit for " + apiRequest.toString());
                        if (Bucket.isGloballyBlocked(headers)) {
                            this.debug("Global limit was hit after " + apiRequest.toString());
                            this.emit('globalRateLimit', apiRequest, blockedDurationMs);
                        }
                        else {
                            this.emit('rateLimit', apiRequest, blockedDurationMs);
                        }
                        if (blockedDurationMs === -1) {
                            // Typically when the IP has been blocked by Cloudflare. Wait 3 hours if this happens.
                            blockedDurationMs = 1000 * 60 * 60 * 3;
                            this.emit('cloudflareRateLimit', apiRequest, blockedDurationMs);
                        }
                        /**
                         * 429 is considered an invalid request, and is counted towards
                         * a hard limit that will result in an temporary IP ban if
                         * exceeded
                         */
                        this.emit('invalidRequest', apiRequest);
                        this.debug("Blocking for " + blockedDurationMs + "ms after 429 response for " + apiRequest.toString());
                        this.block(blockedDurationMs);
                        return [4 /*yield*/, this.delayExecution(apiRequest)];
                    case 1:
                        futureResult = _a.sent();
                        return [2 /*return*/, futureResult];
                }
            });
        });
    };
    /**
     * Handle any responses that is not a rate limit block
     */
    Bucket.prototype.handleResponse = function (apiRequest, res) {
        return __awaiter(this, void 0, void 0, function () {
            var blockedDurationMs;
            return __generator(this, function (_a) {
                this.debug("Non-429 response for " + apiRequest.toString());
                blockedDurationMs = Bucket.getBlockedDuration(res.headers);
                if (blockedDurationMs !== -1) {
                    this.debug("Blocking for " + blockedDurationMs + "ms after non-429 response for " + apiRequest.toString());
                    this.block(blockedDurationMs);
                }
                /**
                 * 401 and 403 are considered invalid requests, and are counted
                 * towards a hard limit that will result in a temporary IP ban
                 * if exceeded
                 */
                if (res.status === 401 || res.status === 403) {
                    this.emit('invalidRequest', apiRequest);
                }
                return [2 /*return*/, res];
            });
        });
    };
    return Bucket;
}(events_1.EventEmitter));
exports["default"] = Bucket;
