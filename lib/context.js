var assert = require("assert");
var path = require("path");
var Q = require("q");
var util = require("./util");
var spawn = require("child_process").spawn;
var Watcher = require("./watcher").Watcher;

function BuildContext(config, watcher, outputDir) {
    var self = this;
    assert.ok(self instanceof BuildContext);
    assert.ok(watcher instanceof Watcher);
    assert.strictEqual(typeof outputDir, "string");

    config = config || {};
    Object.freeze(config);

    Object.defineProperties(self, {
        watcher: { value: watcher },
        outputDir: { value: outputDir },
        config: { value: config },
        configHash: { value: util.deepHash(config) }
    });
}

var BCp = BuildContext.prototype;

BCp.defer = function() {
    return Q.defer();
};

BCp.makePromise = function(callback, context) {
    var deferred = Q.defer();

    process.nextTick(function() {
        callback.call(context || null, function(err, result) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(result);
            }
        });
    });

    return deferred.promise;
};

BCp.spawnP = function(command, args, kwargs) {
    args = args || [];
    kwargs = kwargs || {};

    var deferred = Q.defer();

    var outs = [];
    var errs = [];

    var options = {
        stdio: "pipe",
        env: process.env
    };

    if (kwargs.cwd) {
        options.cwd = kwargs.cwd;
    }

    var child = spawn(command, args, options);

    child.stdout.on("data", function(data) {
        outs.push(data);
    });

    child.stderr.on("data", function(data) {
        errs.push(data);
    });

    child.on("close", function(code) {
        if (errs.length > 0 || code !== 0) {
            var err = {
                code: code,
                text: errs.join("")
            };
        }

        deferred.resolve([err, outs.join("")]);
    });

    var stdin = kwargs && kwargs.stdin;
    if (stdin) {
        child.stdin.end(stdin);
    }

    return deferred.promise;
};

BCp.readFileP = function(file) {
    return this.watcher.readFileP(file);
};

BCp.getProvidedP = util.cachedMethod(function() {
    var pattern = "@providesModule\\s+\\S+";
    return this.watcher.grepP(pattern).then(function(pathToMatch) {
        var valueToPath = {};
        Object.keys(pathToMatch).sort().forEach(function(path) {
            var value = pathToMatch[path].split(/\s+/).pop();
            valueToPath[value] = path;
        });
        return valueToPath;
    });
});

exports.BuildContext = BuildContext;
