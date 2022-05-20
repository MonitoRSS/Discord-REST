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
var RESTHandler_1 = require("./RESTHandler");
var events_1 = require("events");
var amqp_client_1 = require("@cloudamqp/amqp-client");
var errors_1 = require("./errors");
var yup = require("yup");
var jobDataSchema = yup.object().required().shape({
    id: yup.string().required(),
    route: yup.string().required(),
    options: yup.object().required(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: yup.object().shape({}).optional(),
    rpc: yup.boolean().optional()
});
/**
 * Used to consume and enqueue Discord API requests. There should only ever be one consumer that's
 * executing requests across all services for proper rate limit handling.
 *
 * For sending API requests to the consumer, the RESTProducer should be used instead.
 */
var RESTConsumer = /** @class */ (function (_super) {
    __extends(RESTConsumer, _super);
    function RESTConsumer(
    /**
     * The RabbitMQ URI for the queue handler.
     */
    rabbitmqUri, consumerOptions, options) {
        var _this = _super.call(this) || this;
        _this.rabbitmqUri = rabbitmqUri;
        _this.consumerOptions = consumerOptions;
        _this.options = options;
        /**
         * The handler that will actually run the API requests.
         */
        _this.handler = null;
        _this.rabbitmq = null;
        return _this;
    }
    RESTConsumer.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var amqpClient, connection, channel, queue, consumer;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        amqpClient = new amqp_client_1.AMQPClient(this.rabbitmqUri);
                        this.handler = new RESTHandler_1["default"](this.options);
                        return [4 /*yield*/, amqpClient.connect()];
                    case 1:
                        connection = _a.sent();
                        return [4 /*yield*/, connection.channel()];
                    case 2:
                        channel = _a.sent();
                        return [4 /*yield*/, channel.queue("discord-messages-" + this.consumerOptions.clientId, {
                                durable: true
                            }, {
                                'x-single-active-consumer': true,
                                'x-max-priority': 255,
                                'x-queue-mode': 'lazy',
                                'x-message-ttl': 1000 * 60 * 60 * 24 // 1 day
                            })];
                    case 3:
                        queue = _a.sent();
                        return [4 /*yield*/, queue.subscribe({ noAck: false }, function (message) { return __awaiter(_this, void 0, void 0, function () {
                                var data, err_1, response, callbackQueue, err_2;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            _a.trys.push([0, 9, 10, 12]);
                                            data = void 0;
                                            _a.label = 1;
                                        case 1:
                                            _a.trys.push([1, 3, , 4]);
                                            return [4 /*yield*/, this.validateMessage(message)];
                                        case 2:
                                            data = _a.sent();
                                            return [3 /*break*/, 4];
                                        case 3:
                                            err_1 = _a.sent();
                                            this.emit('error', new errors_1.MessageParseError(err_1.message));
                                            return [2 /*return*/];
                                        case 4: return [4 /*yield*/, this.processJobData(data)];
                                        case 5:
                                            response = _a.sent();
                                            if (!data.rpc) return [3 /*break*/, 8];
                                            return [4 /*yield*/, channel.queue(message.properties.replyTo, {
                                                    autoDelete: true
                                                }, {
                                                    'x-expires': 1000 * 60 * 5 // 5 minutes
                                                })];
                                        case 6:
                                            callbackQueue = _a.sent();
                                            return [4 /*yield*/, callbackQueue.publish(JSON.stringify(response), {
                                                    correlationId: message.properties.correlationId
                                                })];
                                        case 7:
                                            _a.sent();
                                            _a.label = 8;
                                        case 8: return [3 /*break*/, 12];
                                        case 9:
                                            err_2 = _a.sent();
                                            this.emit('error', new errors_1.MessageProcessingError(err_2.message).message);
                                            return [3 /*break*/, 12];
                                        case 10: return [4 /*yield*/, message.ack()];
                                        case 11:
                                            _a.sent();
                                            return [7 /*endfinally*/];
                                        case 12: return [2 /*return*/];
                                    }
                                });
                            }); })];
                    case 4:
                        consumer = _a.sent();
                        this.rabbitmq = {
                            channel: channel,
                            connection: connection,
                            consumer: consumer
                        };
                        return [2 /*return*/];
                }
            });
        });
    };
    RESTConsumer.prototype.close = function () {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0: return [4 /*yield*/, ((_a = this.rabbitmq) === null || _a === void 0 ? void 0 : _a.consumer.cancel())];
                    case 1:
                        _d.sent();
                        return [4 /*yield*/, ((_b = this.rabbitmq) === null || _b === void 0 ? void 0 : _b.consumer.wait())];
                    case 2:
                        _d.sent();
                        return [4 /*yield*/, ((_c = this.rabbitmq) === null || _c === void 0 ? void 0 : _c.connection.close())];
                    case 3:
                        _d.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    RESTConsumer.prototype.validateMessage = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var json;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        json = JSON.parse(message.bodyToString() || '');
                        return [4 /*yield*/, jobDataSchema.validate(json)];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    RESTConsumer.prototype.processJobData = function (data) {
        return __awaiter(this, void 0, void 0, function () {
            var handler;
            var _this = this;
            return __generator(this, function (_a) {
                handler = this.handler;
                if (!handler) {
                    throw new Error('Handler not initialized');
                }
                return [2 /*return*/, new Promise(function (resolve, reject) { return __awaiter(_this, void 0, void 0, function () {
                        var timeout, res, parsedData, err_3;
                        var _this = this;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 3, , 4]);
                                    timeout = setTimeout(function () {
                                        _this.emit('timeout', data);
                                        reject(new Error('Timed Out'));
                                    }, 1000 * 60 * 5);
                                    return [4 /*yield*/, handler.fetch(data.route, __assign(__assign({}, data.options), { headers: __assign({ Authorization: this.consumerOptions.authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' }, data.options.headers) }))];
                                case 1:
                                    res = _a.sent();
                                    return [4 /*yield*/, this.handleJobFetchResponse(res)];
                                case 2:
                                    parsedData = _a.sent();
                                    clearTimeout(timeout);
                                    resolve(parsedData);
                                    return [3 /*break*/, 4];
                                case 3:
                                    err_3 = _a.sent();
                                    reject(err_3);
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); })];
            });
        });
    };
    RESTConsumer.prototype.handleJobFetchResponse = function (res) {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var body;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (res.status.toString().startsWith('5')) {
                            throw new Error("Bad status code (" + res.status + ")");
                        }
                        if (!(res.status === 204)) return [3 /*break*/, 1];
                        body = null;
                        return [3 /*break*/, 5];
                    case 1:
                        if (!((_a = res.headers.get('Content-Type')) === null || _a === void 0 ? void 0 : _a.includes('application/json'))) return [3 /*break*/, 3];
                        return [4 /*yield*/, res.json()];
                    case 2:
                        body = _b.sent();
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, res.text()];
                    case 4:
                        body = _b.sent();
                        _b.label = 5;
                    case 5: return [2 /*return*/, {
                            status: res.status,
                            body: body
                        }];
                }
            });
        });
    };
    return RESTConsumer;
}(events_1.EventEmitter));
exports["default"] = RESTConsumer;
