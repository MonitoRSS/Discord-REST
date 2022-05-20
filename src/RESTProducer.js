"use strict";
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
var amqp_client_1 = require("@cloudamqp/amqp-client");
var nanoid_1 = require("nanoid");
var RESTProducer = /** @class */ (function () {
    function RESTProducer(rabbitmqUri, options) {
        this.rabbitmqUri = rabbitmqUri;
        this.options = options;
        this.rabbitmq = null;
    }
    RESTProducer.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var amqpClient, connection, channel, queue;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        amqpClient = new amqp_client_1.AMQPClient(this.rabbitmqUri);
                        return [4 /*yield*/, amqpClient.connect()];
                    case 1:
                        connection = _a.sent();
                        return [4 /*yield*/, connection.channel()];
                    case 2:
                        channel = _a.sent();
                        return [4 /*yield*/, channel.queue("discord-messages-" + this.options.clientId, {
                                durable: true
                            }, {
                                'x-single-active-consumer': true,
                                'x-max-priority': 255,
                                'x-queue-mode': 'lazy',
                                'x-message-ttl': 1000 * 60 * 60 * 24 // 1 day
                            })];
                    case 3:
                        queue = _a.sent();
                        this.rabbitmq = {
                            channel: channel,
                            connection: connection,
                            queue: queue
                        };
                        return [2 /*return*/];
                }
            });
        });
    };
    RESTProducer.prototype.close = function () {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, ((_a = this.rabbitmq) === null || _a === void 0 ? void 0 : _a.connection.close())];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Enqueue a request to Discord's API. If the API response is needed, the fetch method
     * should be used instead of enqueue.
     *
     * @param route The full HTTP route string
     * @param options node-fetch options
     * @param meta Metadata to attach to the job for the Consumer to access
     * @returns The enqueued job
     */
    RESTProducer.prototype.enqueue = function (route, options, meta) {
        if (options === void 0) { options = {}; }
        return __awaiter(this, void 0, void 0, function () {
            var jobData;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!route) {
                            throw new Error("Missing route for RESTProducer enqueue");
                        }
                        if (!this.rabbitmq) {
                            throw new Error("RESTProducer must be initialized with initialize() before enqueue");
                        }
                        jobData = {
                            id: nanoid_1.nanoid(),
                            route: route,
                            options: options,
                            meta: meta,
                            rpc: false
                        };
                        return [4 /*yield*/, this.rabbitmq.queue.publish(JSON.stringify(jobData), {
                                deliveryMode: 2
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Fetch a resource from Discord's API.
     *
     * @param route The full HTTP route string
     * @param options node-fetch options
     * @param meta Metadata to attach to the job for the Consumer to access
     * @returns Fetch response details
     */
    RESTProducer.prototype.fetch = function (route, options, meta) {
        if (options === void 0) { options = {}; }
        return __awaiter(this, void 0, void 0, function () {
            var jobData, replyQueue, response;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!route) {
                            throw new Error("Missing route for RESTProducer enqueue");
                        }
                        if (!this.rabbitmq) {
                            throw new Error("RESTProducer must be initialized with initialize() before enqueue");
                        }
                        jobData = {
                            id: nanoid_1.nanoid(),
                            route: route,
                            options: options,
                            meta: meta,
                            rpc: true
                        };
                        return [4 /*yield*/, this.rabbitmq.channel.queue("discord-messages-callback-" + jobData.id, {
                                autoDelete: true
                            }, {
                                'x-expires': 1000 * 60 * 5 // 5 minutes
                            })];
                    case 1:
                        replyQueue = _a.sent();
                        response = new Promise(function (resolve, reject) { return __awaiter(_this, void 0, void 0, function () {
                            var consumer_1, err_1;
                            var _this = this;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, replyQueue.subscribe({ noAck: true }, function (message) { return __awaiter(_this, void 0, void 0, function () {
                                                var parsedJson, err_2;
                                                return __generator(this, function (_a) {
                                                    switch (_a.label) {
                                                        case 0:
                                                            if (message.properties.correlationId !== jobData.id) {
                                                                return [2 /*return*/];
                                                            }
                                                            _a.label = 1;
                                                        case 1:
                                                            _a.trys.push([1, 2, 3, 5]);
                                                            parsedJson = JSON.parse(message.bodyToString() || '');
                                                            resolve(parsedJson);
                                                            return [3 /*break*/, 5];
                                                        case 2:
                                                            err_2 = _a.sent();
                                                            throw new Error('Failed to parse JSON from RPC response');
                                                        case 3: return [4 /*yield*/, consumer_1.cancel()];
                                                        case 4:
                                                            _a.sent();
                                                            return [7 /*endfinally*/];
                                                        case 5: return [2 /*return*/];
                                                    }
                                                });
                                            }); })];
                                    case 1:
                                        consumer_1 = _a.sent();
                                        return [3 /*break*/, 3];
                                    case 2:
                                        err_1 = _a.sent();
                                        reject(err_1);
                                        return [3 /*break*/, 3];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); });
                        return [4 /*yield*/, this.rabbitmq.queue.publish(JSON.stringify(jobData), {
                                deliveryMode: 2,
                                replyTo: replyQueue.name,
                                correlationId: jobData.id
                            })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, response];
                }
            });
        });
    };
    return RESTProducer;
}());
exports["default"] = RESTProducer;
