var assert = require("assert");
var path = require("path");
var fs = require("fs");
var Q = require("q");
var createHash = require("crypto").createHash;
var getRequiredIDs = require("install").getRequiredIDs;
var util = require("./util");
var BuildContext = require("./context").BuildContext;
var DiskCache = require("./cache").DiskCache;
var slice = Array.prototype.slice;

function ModuleReader(context, resolvers, processors, wrapper) {
    var self = this;
    assert.ok(self instanceof ModuleReader);
    assert.ok(context instanceof BuildContext);
    assert.ok(resolvers instanceof Array);
    assert.ok(processors instanceof Array);

    var hash = createHash("sha1").update(context.configHash + "\0");

    function hashCallbacks(salt) {
        hash.update(salt + "\0");

        var cbs = util.flatten(slice.call(arguments, 1));

        cbs.forEach(function(cb) {
            assert.strictEqual(typeof cb, "function");
            hash.update(cb + "\0");
        });

        return cbs;
    }

    resolvers = hashCallbacks("resolvers", resolvers, warnMissingModule);

    var procArgs = [processors];
    if (!context.ignoreDependencies)
        procArgs.push(require("./relative").relativizeP);
    processors = hashCallbacks("processors", procArgs);

    Object.defineProperties(self, {
        context: { value: context },
        resolvers: { value: resolvers },
        processors: { value: processors },
        salt: { value: hash.digest("hex") },
        cache: { value: new DiskCache(context) }
    });
}

ModuleReader.prototype = {
    getSourceP: function(id) {
        var context = this.context;
        var copy = this.resolvers.slice(0).reverse();
        assert.ok(copy.length > 0, "no source resolvers registered");

        function tryNextResolverP() {
            var resolve = copy.pop();

            try {
                var promise = Q.resolve(resolve && resolve.call(context, id));
            } catch (e) {
                promise = Q.reject(e);
            }

            return resolve ? promise.then(function(result) {
                if (typeof result === "string")
                    return result;
                return tryNextResolverP();
            }, tryNextResolverP) : promise;
        }

        return tryNextResolverP();
    },

    readModuleP: util.cachedMethod(function(id) {
        var reader = this;

        var hash = createHash("sha1")
            .update("module\0")
            .update(id + "\0")
            .update(reader.salt + "\0");

        return reader.getSourceP(id).then(function(source) {
            assert.strictEqual(typeof source, "string");
            hash.update(source.length + "\0" + source);
            return reader.buildModuleP(id, hash.digest("hex"), source);
        });
    }),

    buildModuleP: function(id, hex, source) {
        var reader = this;
        var didBuild = false;

        return reader.cache.setDefaultP(hex, function() {
            var promise = Q.resolve(source);
            didBuild = true;

            reader.processors.forEach(function(build) {
                promise = promise.then(function(source) {
                    return build.call(reader.context, id, source);
                });
            });

            return promise;

        }, function(source) {
            var deps = getRequiredIDs(id, source);
            var module = new Module(reader, id, hex, deps, source);
            didBuild && util.log.err("built " + module, "cyan");
            return module;
        });
    },

    readMultiP: function(ids) {
        var reader = this;
        return Q.all(ids).then(function(ids) {
            return Q.all(ids.map(reader.readModuleP, reader));
        });
    }
};

exports.ModuleReader = ModuleReader;

function warnMissingModule(id) {
    // A missing module may be a false positive and therefore does not warrant
    // a fatal error, but a warning is certainly in order.
    util.log.err(
        "unable to resolve module " + JSON.stringify(id) + "; false positive?",
        "yellow");

    // Missing modules are installed as if they existed, but it's a run-time
    // error if one is ever actually required.
    var message = "nonexistent module required: " + id;
    return "throw new Error(" + JSON.stringify(message) + ");";
}

function Module(reader, id, hash, deps, source) {
    var self = this;
    assert.ok(self instanceof Module);
    assert.ok(reader instanceof ModuleReader);

    Object.defineProperties(self, {
        reader: { value: reader },
        id: { value: id },
        hash: { value: hash },
        deps: { value: deps },
        source: { value: source }
    });
}

Module.prototype = {
    getRequiredP: function() {
        return this.reader.readMultiP(this.deps);
    },

    writeVersionP: function(outputDir) {
        assert.strictEqual(typeof outputDir, "string");
        var commonJsFile = path.join(outputDir, this.id + ".js");
        return this.reader.cache.linkP(this.hash, commonJsFile);
    },

    toString: function() {
        return "Module(" + JSON.stringify(this.id) + ")";
    },

    resolveId: function(id) {
        return path.normalize(path.join(this.id, "..", id));
    }
};
