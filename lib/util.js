var assert = require("assert");
var path = require("path");
var fs = require("fs");
var Q = require("q");
var createHash = require("crypto").createHash;
var uglify = require("uglify-js");
var Ap = Array.prototype;
var slice = Ap.slice;
var join = Ap.join;

var tags = {};
var hasOwn = tags.hasOwnProperty;
function makeTag() {
    do var tag = Math.random().toString(36).slice(2);
    while (hasOwn.call(tags, tag));
    return tags[tag] = tag;
}

exports.cachedMethod = function(fn, keyFn) {
    var tag = makeTag();

    function wrapper() {
        var self = this;
        if (!hasOwn.call(self, tag))
            Object.defineProperty(self, tag, { value: {} });
        var cache = self[tag];
        var args = arguments;
        var key = keyFn
            ? keyFn.apply(self, args)
            : join.call(args, "\0");
        if (hasOwn.call(cache, key))
            return cache[key];
        return cache[key] = fn.apply(self, args);
    }

    wrapper.originalFn = fn;

    return wrapper;
};

function readFileP(file) {
    var deferred = Q.defer();

    fs.readFile(file, "utf8", function(err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(data);
        }
    });

    return deferred.promise;
}
exports.readFileP = readFileP;

exports.readJsonFileP = function(file) {
    return readFileP(file).then(function(json) {
        return JSON.parse(json);
    });
};

exports.mkdirP = function(dir) {
    var deferred = Q.defer();

    function finish(err) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(dir);
        }
    }

    fs.stat(dir, function(err, stats) {
        if (err) {
            if (err.code == "ENOENT") {
                fs.mkdir(dir, finish);
            } else {
                finish(err);
            }
        } else if (stats.isDirectory()) {
            finish();
        } else {
            finish(dir + " is not a directory");
        }
    });

    return deferred.promise;
};

exports.readJsonFromStdinP = function() {
    var deferred = Q.defer();
    var stdin = process.stdin;
    var ins = [];

    stdin.resume();
    stdin.setEncoding("utf8");

    stdin.on("data", function(data) {
        ins.push(data);
    }).on("end", function() {
        deferred.resolve(JSON.parse(ins.join("")));
    });

    return deferred.promise;
};

function deepHash(val) {
    var hash = createHash("sha1");
    var type = typeof val;

    if (val === null) {
        type = "null";
    }

    switch (type) {
    case "object":
        Object.keys(val).sort().forEach(function(key) {
            hash.update(key + "\0")
                .update(deepHash(val[key]));
        });
        break;

    case "function":
        assert.ok(false, "cannot hash function objects");
        break;

    default:
        hash.update(val + "");
        break;
    }

    return hash.digest("hex");
}
exports.deepHash = deepHash;

exports.existsP = function(fullPath) {
    var deferred = Q.defer();

    fs.exists(fullPath, function(exists) {
        deferred.resolve(exists);
    });

    return deferred.promise;
};

exports.writeP = function(fullPath, source) {
    var deferred = Q.defer();

    fs.writeFile(fullPath, source, function(err) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(source);
        }
    });

    return deferred.promise;
};

exports.minify = function(code) {
    var options = {
        fromString: true
    };

    var untouchables = slice.call(arguments, 1);
    if (untouchables.length > 0) {
        options.mangle = { except: untouchables };
    }

    return uglify.minify(code, options).code;
};

var colors = {
    bold: "\033[1m",
    red: "\033[31m",
    green: "\033[32m",
    yellow: "\033[33m",
    cyan: "\033[36m",
    reset: "\033[0m"
};

Object.keys(colors).forEach(function(key) {
    if (key !== "reset") {
        exports[key] = function(text) {
            return colors[key] + text + colors.reset;
        };
    }
});
