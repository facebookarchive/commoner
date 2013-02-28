var assert = require("assert");
var path = require("path");
var Q = require("q");
var createHash = require("crypto").createHash;
var getRequiredIDs = require("install").getRequiredIDs;
var slice = Array.prototype.slice;

var BuildContext = require("./context").BuildContext;

function ModuleReader(context, resolvers, builders) {
    var self = this;
    assert.ok(self instanceof ModuleReader);
    assert.ok(context instanceof BuildContext);
    assert.ok(resolvers instanceof Array);
    assert.ok(builders instanceof Array);

    var hash = createHash("sha1").update(context.configHash + "\0");

    function hashCallbacks(salt, cbs) {
        hash.update(salt + "\0");

        cbs = cbs.concat(slice.call(arguments, 2));
        cbs.forEach(function(cb) {
            assert.strictEqual(typeof cb, "function");
            hash.update(cb + "\0");
        });

        return cbs;
    }

    resolvers = hashCallbacks("resolvers", resolvers);
    builders = hashCallbacks("builders", builders, wrapModule);

    Object.defineProperties(self, {
        context: { value: context },
        resolvers: { value: resolvers },
        builders: { value: builders },
        salt: { value: hash.digest("hex") },
        promiseCache: { value: {} }
    });
}

ModuleReader.prototype = {
    getSourceP: function(id) {
        var context = this.context;
        var copy = this.resolvers.slice(0).reverse();
        assert.ok(copy.length > 0, "no source resolvers registered");

        function tryNextResolverP() {
            var resolve = copy.pop();
            var result = resolve && resolve.call(context, id);
            var promise = Q.resolve(result);
            return resolve ? promise.then(function(result) {
                return result || tryNextResolverP();
            }) : promise;
        }

        return tryNextResolverP();
    },

    readModuleP: function(id) {
        var cache = this.promiseCache;
        if (cache.hasOwnProperty(id))
            return cache[id];

        // TODO Invalidate cache when files change on disk.
        return cache[id] = this.noCacheReadModuleP(id);
    },

    noCacheReadModuleP: function(id) {
        var reader = this;

        var hash = createHash("sha1")
            .update("module\0")
            .update(id + "\0")
            .update(reader.salt + "\0");

        var promise = reader.getSourceP(id).then(function(source) {
            assert.strictEqual(
                typeof source, "string",
                "unable to resolve module " + JSON.stringify(id));
            hash.update(source.length + "\0" + source);
            return source;
        });

        reader.builders.forEach(function(build) {
            promise = promise.then(function(source) {
                return build.call(reader.context, id, source);
            });
        });

        return promise.then(function(source) {
            var deps = getRequiredIDs(id, source);
            return new Module(reader, id, hash.digest("hex"), deps, source);
        });
    },

    readMultiP: function(ids) {
        return Q.all(ids.map(this.readModuleP, this));
    }
};

exports.ModuleReader = ModuleReader;

function wrapModule(id, source) {
    return "install(" + JSON.stringify(id) +
        ",function(require,exports,module){" +
        source +
        "});";
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

    toString: function() {
        return "Module(" + JSON.stringify(this.id) + ")";
    },

    resolveId: function(id) {
        return path.normalize(path.join(this.id, "..", id));
    }
};
