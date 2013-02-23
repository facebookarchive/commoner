var assert = require("assert");
var path = require("path");
var Q = require("q");
var util = require("./util");

function BuildContext(config, sourceDir, outputDir) {
    var self = this;
    assert.ok(self instanceof BuildContext);
    assert.strictEqual(typeof sourceDir, "string");
    assert.strictEqual(typeof outputDir, "string");

    config = config || {};
    Object.freeze(config);

    Object.defineProperties(self, {
        sourceDir: { value: sourceDir },
        outputDir: { value: outputDir },
        config: { value: config },
        configHash: { value: util.deepHash(config) },
        promiseCache: { value: {} }
    });
}

var BCp = BuildContext.prototype;

function defCachedMethod(name, impl) {
    BCp[name] = function() {
        var cache = this.promiseCache;
        var parts = [name];
        parts.push.apply(parts, arguments);
        var key = parts.join("\0");
        if (cache.hasOwnProperty(key))
            return cache[key];
        return cache[key] = impl.apply(this, arguments);
    };
}

defCachedMethod("readFileP", function(file) {
    return util.readFileP(path.join(this.sourceDir, file));
});

defCachedMethod("getProvidedP", function() {
    return util.findDirectiveP(
        "providesModule",
        this.sourceDir
    ).then(function(pathToValue) {
        var valueToPath = {};
        Object.keys(pathToValue).sort().forEach(function(path) {
            valueToPath[pathToValue[path]] = path;
        });
        return valueToPath;
    });
});

exports.BuildContext = BuildContext;
