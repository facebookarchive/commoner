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
